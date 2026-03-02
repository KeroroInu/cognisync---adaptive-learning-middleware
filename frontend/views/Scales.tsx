import React, { useState, useEffect, useRef } from 'react';
import { CheckCircle, ArrowLeft, Loader, ClipboardList, RefreshCw } from 'lucide-react';
import { getAllActiveScales, getScaleTemplateById, submitScaleAnswers } from '../services/api';
import type {
  Language,
  ScaleTemplate,
  ScaleAnswer,
  ScaleListItem,
  Dimension,
  UserProfile,
} from '../types';

interface Props {
  language: Language;
  theme: 'light' | 'dark';
  onUpdateProfile: (profile: UserProfile) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const DIM_LABEL: Record<string, string> = {
  CT: '计算思维', SE: '自我效能感', LM: '学习动机',
  CPS: '复杂问题解决', PA: '编程能力', AIL: 'AI 素养',
};

function getDimensionColor(dimension: string): string {
  switch (dimension) {
    case 'CT':  return 'from-blue-500 to-cyan-600';
    case 'SE':  return 'from-purple-500 to-violet-600';
    case 'LM':  return 'from-pink-500 to-rose-600';
    case 'CPS': return 'from-amber-500 to-orange-600';
    case 'PA':  return 'from-green-500 to-emerald-600';
    case 'AIL': return 'from-indigo-500 to-blue-700';
    case 'Cognition': return 'from-blue-500 to-cyan-600';
    case 'Affect':    return 'from-purple-500 to-pink-600';
    case 'Behavior':  return 'from-green-500 to-emerald-600';
    default:          return 'from-gray-500 to-gray-600';
  }
}

// ── Component ──────────────────────────────────────────────────────────────

export const Scales: React.FC<Props> = ({ language, theme, onUpdateProfile }) => {
  const isZh = language === 'zh';

  // ── List state ───────────────────────────────────────────────────────────
  const [scales, setScales] = useState<ScaleListItem[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // ── Screen state ─────────────────────────────────────────────────────────
  type Screen = 'list' | 'fill' | 'complete';
  const [screen, setScreen] = useState<Screen>('list');

  // ── Fill state ───────────────────────────────────────────────────────────
  const [template, setTemplate] = useState<ScaleTemplate | null>(null);
  const [loadingTemplate, setLoadingTemplate] = useState(false);
  const [answers, setAnswers] = useState<ScaleAnswer[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fillError, setFillError] = useState<string | null>(null);
  const [warningModal, setWarningModal] = useState<{
    message: string;
    onContinue: (() => void) | null;
  } | null>(null);

  const startTimeRef = useRef<number | null>(null);
  const recentAnswersRef = useRef<Array<{ value: number; duration: number }>>([]);
  const lastAnswerTimeRef = useRef<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // ── Load list ────────────────────────────────────────────────────────────

  const loadScales = async () => {
    try {
      setLoadingList(true);
      setListError(null);
      const items = await getAllActiveScales();
      setScales(items);
    } catch (err) {
      setListError(err instanceof Error ? err.message : (isZh ? '加载失败' : 'Failed to load'));
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => { loadScales(); }, []);

  // ── Timer ────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (screen !== 'fill' || !startTimeRef.current) return;
    const timer = setInterval(() => {
      if (startTimeRef.current) {
        setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [screen]);

  // ── Select scale → load template ─────────────────────────────────────────

  const handleSelectScale = async (scaleId: string) => {
    setLoadingTemplate(true);
    setFillError(null);
    try {
      const tpl = await getScaleTemplateById(scaleId);
      setTemplate(tpl);
      setAnswers(tpl.questions.map(q => ({ questionId: q.id, value: 0 })));
      setCurrentQuestionIndex(0);
      startTimeRef.current = Date.now();
      setElapsedSeconds(0);
      recentAnswersRef.current = [];
      lastAnswerTimeRef.current = null;
      setScreen('fill');
    } catch (err) {
      setFillError(err instanceof Error ? err.message : (isZh ? '加载量表失败' : 'Failed to load scale'));
    } finally {
      setLoadingTemplate(false);
    }
  };

  const handleBackToList = () => {
    setScreen('list');
    setTemplate(null);
    setFillError(null);
  };

  // ── Suspicious behavior check ─────────────────────────────────────────────

  const checkSuspiciousAnswers = (finalAnswers: ScaleAnswer[]): string | null => {
    const elapsed = startTimeRef.current ? Date.now() - startTimeRef.current : Infinity;
    if (elapsed < 60000) return '您的作答速度有点快，建议仔细阅读每道题目后再选择哦 😊';
    const validAnswers = finalAnswers.filter(a => a.value > 0);
    if (validAnswers.length >= 5) {
      const counts: Record<number, number> = {};
      validAnswers.forEach(a => { counts[a.value] = (counts[a.value] || 0) + 1; });
      const maxCount = Math.max(...Object.values(counts));
      if (maxCount / validAnswers.length >= 0.75) {
        return '您的答案较为集中，请根据自身实际情况如实作答哦 😊';
      }
    }
    return null;
  };

  // ── Submit ────────────────────────────────────────────────────────────────

  const doSubmit = (finalAnswers: ScaleAnswer[]) => {
    if (!template) return;
    setIsSubmitting(true);
    setFillError(null);
    const answersDict = finalAnswers.reduce((acc, a) => {
      acc[a.questionId] = a.value;
      return acc;
    }, {} as Record<string, number>);
    submitScaleAnswers(template.id, {
      answers: answersDict,
      started_at: startTimeRef.current ? new Date(startTimeRef.current).toISOString() : undefined,
    })
      .then(response => {
        if (response.success && response.data) {
          onUpdateProfile(response.data.initialProfile);
          setScreen('complete');
          setTimeout(() => {
            loadScales();        // 刷新列表，此量表变为「已完成」
            setScreen('list');
            setTemplate(null);
          }, 2000);
        }
      })
      .catch(err => {
        setFillError(err instanceof Error ? err.message : (isZh ? '提交失败' : 'Failed to submit'));
      })
      .finally(() => setIsSubmitting(false));
  };

  // ── Likert select ─────────────────────────────────────────────────────────

  const handleLikertSelect = (value: number) => {
    if (!template) return;
    const now = Date.now();
    const duration = lastAnswerTimeRef.current ? now - lastAnswerTimeRef.current : Infinity;
    lastAnswerTimeRef.current = now;

    const newAnswers = [...answers];
    newAnswers[currentQuestionIndex] = {
      questionId: template.questions[currentQuestionIndex].id,
      value,
    };
    setAnswers(newAnswers);

    const recent = recentAnswersRef.current;
    recent.push({ value, duration });
    if (recent.length > 5) recent.shift();

    const isLast = currentQuestionIndex === template.questions.length - 1;

    if (!isLast && recent.length >= 5) {
      const allSameValue = recent.every(a => a.value === recent[0].value);
      const allVeryFast = recent.every(a => a.duration < 2000);
      if (allSameValue) {
        setWarningModal({
          message: '检测到您连续 5 题都选了同一选项，请根据实际情况如实作答哦 😊',
          onContinue: () => { setWarningModal(null); recentAnswersRef.current = []; setCurrentQuestionIndex(prev => prev + 1); },
        });
        return;
      }
      if (allVeryFast) {
        setWarningModal({
          message: '您连续 5 题均在 2 秒内作答，请仔细阅读每道题目后再选择哦 😊',
          onContinue: () => { setWarningModal(null); recentAnswersRef.current = []; setCurrentQuestionIndex(prev => prev + 1); },
        });
        return;
      }
    }

    setTimeout(() => {
      if (isLast) {
        const warning = checkSuspiciousAnswers(newAnswers);
        if (warning) {
          setWarningModal({ message: warning, onContinue: null });
        } else {
          doSubmit(newAnswers);
        }
      } else {
        setCurrentQuestionIndex(prev => prev + 1);
      }
    }, 300);
  };

  // ── Render: complete ──────────────────────────────────────────────────────

  if (screen === 'complete') {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="glass-card p-12 max-w-md w-full text-center">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="w-12 h-12 text-white" />
          </div>
          <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
            {isZh ? '提交成功！' : 'Submitted!'}
          </h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            {isZh ? '正在更新学习画像...' : 'Updating your learning profile...'}
          </p>
          <div className="flex justify-center gap-2 mt-6">
            <div className="w-3 h-3 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-3 h-3 rounded-full bg-purple-500 animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-3 h-3 rounded-full bg-pink-500 animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        </div>
      </div>
    );
  }

  // ── Render: fill ──────────────────────────────────────────────────────────

  if (screen === 'fill') {
    if (loadingTemplate || !template) {
      return (
        <div className="flex items-center justify-center h-full">
          <Loader className="w-8 h-8 text-blue-500 animate-spin" />
        </div>
      );
    }

    const currentQuestion = template.questions[currentQuestionIndex];
    const currentAnswer = answers[currentQuestionIndex]?.value || 0;
    const progress = ((currentQuestionIndex + 1) / template.questions.length) * 100;
    const isLastQuestion = currentQuestionIndex === template.questions.length - 1;

    return (
      <div className="h-full overflow-y-auto">
        {/* Warning modal */}
        {warningModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="glass-card p-8 max-w-sm w-full text-center rounded-2xl shadow-2xl">
              <div className="text-5xl mb-4">⚠️</div>
              <h3 className="text-xl font-bold mb-3" style={{ color: 'var(--text-primary)' }}>温馨提示</h3>
              <p className="mb-6 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                {warningModal.message}
              </p>
              <div className="flex gap-3 justify-center">
                {warningModal.onContinue === null ? (
                  <button
                    onClick={() => setWarningModal(null)}
                    className="flex-1 px-4 py-3 bg-gradient-to-r from-blue-500 to-cyan-600 text-white font-medium rounded-xl transition-all hover:scale-105 shadow-lg"
                  >
                    重新作答
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => setWarningModal(null)}
                      className="flex-1 px-4 py-3 font-medium rounded-xl border-2 transition-all hover:scale-105"
                      style={{ backgroundColor: 'var(--glass-bg)', color: 'var(--text-secondary)', borderColor: 'var(--glass-border)' }}
                    >
                      重新选择
                    </button>
                    <button
                      onClick={warningModal.onContinue}
                      className="flex-1 px-4 py-3 bg-gradient-to-r from-blue-500 to-cyan-600 text-white font-medium rounded-xl transition-all hover:scale-105 shadow-lg"
                    >
                      知道了，继续
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="max-w-3xl mx-auto py-6 px-4">
          {/* Back + title */}
          <div className="flex items-center gap-3 mb-6">
            <button
              onClick={handleBackToList}
              className="flex items-center gap-2 px-3 py-2 rounded-xl border-2 text-sm font-medium transition-all hover:scale-105"
              style={{ backgroundColor: 'var(--glass-bg)', color: 'var(--text-secondary)', borderColor: 'var(--glass-border)' }}
            >
              <ArrowLeft size={16} />
              {isZh ? '返回' : 'Back'}
            </button>
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{template.name}</h2>
          </div>

          {/* Progress bar */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                {currentQuestionIndex + 1} / {template.questions.length}
              </span>
              <div className="flex items-center gap-3">
                {startTimeRef.current && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-mono" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-light)' }}>
                    ⏱ {Math.floor(elapsedSeconds / 60).toString().padStart(2, '0')}:{(elapsedSeconds % 60).toString().padStart(2, '0')}
                  </span>
                )}
                <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                  {Math.round(progress)}%
                </span>
              </div>
            </div>
            <div className="h-3 rounded-full overflow-hidden shadow-inner" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
              <div
                className="h-full bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 transition-all duration-500 ease-out rounded-full"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* Question card */}
          <div className="glass-card p-8 mb-6">
            <div className="flex justify-center mb-6">
              <div className={`inline-flex items-center px-4 py-2 rounded-full bg-gradient-to-r ${getDimensionColor(currentQuestion.dimension)} text-white shadow-lg font-medium text-sm`}>
                <div className="w-2 h-2 rounded-full bg-white mr-2 animate-pulse" />
                {DIM_LABEL[currentQuestion.dimension] || currentQuestion.dimension}
              </div>
            </div>
            <h2 className="text-2xl font-bold text-center mb-8 leading-relaxed" style={{ color: 'var(--text-primary)' }}>
              {currentQuestion.text}
            </h2>

            {/* Likert buttons */}
            <div className="flex justify-center items-center gap-3 md:gap-6 mb-4">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  onClick={() => handleLikertSelect(value)}
                  className={`group relative w-14 h-14 md:w-16 md:h-16 rounded-full transition-all duration-300 ${
                    currentAnswer === value
                      ? `bg-gradient-to-br ${getDimensionColor(currentQuestion.dimension)} text-white scale-110 shadow-xl`
                      : 'hover:scale-105 hover:shadow-lg border-2'
                  }`}
                  style={currentAnswer !== value ? {
                    backgroundColor: 'var(--glass-bg)',
                    color: 'var(--text-primary)',
                    borderColor: 'var(--glass-border)',
                  } : undefined}
                >
                  <span className="text-xl md:text-2xl font-bold">{value}</span>
                </button>
              ))}
            </div>

            {/* Scale labels */}
            <div className="flex justify-between text-xs md:text-sm px-2" style={{ color: 'var(--text-light)' }}>
              <span>{isZh ? '完全不同意' : 'Strongly Disagree'}</span>
              <span>{isZh ? '完全同意' : 'Strongly Agree'}</span>
            </div>
          </div>

          {/* Error */}
          {fillError && (
            <div className="glass-card p-4 mb-4 border-l-4 border-red-500">
              <p className="text-red-500 text-sm">{fillError}</p>
            </div>
          )}

          {/* Navigation */}
          <div className="flex gap-3">
            <button
              onClick={() => setCurrentQuestionIndex(prev => Math.max(0, prev - 1))}
              disabled={currentQuestionIndex === 0}
              className="px-5 py-3 font-medium rounded-xl border-2 transition-all disabled:opacity-40 hover:enabled:scale-105 flex items-center gap-2"
              style={{ backgroundColor: 'var(--glass-bg)', color: 'var(--text-secondary)', borderColor: 'var(--glass-border)' }}
            >
              <ArrowLeft size={16} />
              {isZh ? '上一题' : 'Previous'}
            </button>

            {isLastQuestion && isSubmitting && (
              <div className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white font-medium rounded-xl shadow-lg">
                <Loader className="w-5 h-5 animate-spin" />
                {isZh ? '提交中...' : 'Submitting...'}
              </div>
            )}
          </div>

          {/* Dots */}
          <div className="flex justify-center gap-2 mt-6 flex-wrap">
            {template.questions.map((_, index) => (
              <button
                key={index}
                onClick={() => setCurrentQuestionIndex(index)}
                className={`h-2.5 rounded-full transition-all duration-300 ${
                  index === currentQuestionIndex
                    ? 'w-8 bg-gradient-to-r from-blue-500 to-purple-500'
                    : answers[index]?.value > 0
                      ? 'w-2.5 bg-green-500'
                      : 'w-2.5'
                }`}
                style={index !== currentQuestionIndex && !(answers[index]?.value > 0) ? { backgroundColor: 'var(--bg-tertiary)' } : undefined}
                title={`${index + 1}`}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Render: list (default) ────────────────────────────────────────────────

  return (
    <div className="h-full overflow-y-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
            {isZh ? '量表' : 'Scales'}
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {isZh ? '选择量表填写，已完成的量表将更新您的学习画像' : 'Fill out a scale to update your learning profile'}
          </p>
        </div>
        <button
          onClick={loadScales}
          disabled={loadingList}
          className="flex items-center gap-2 px-3 py-2 rounded-xl border text-sm transition-all hover:scale-105 disabled:opacity-50"
          style={{ backgroundColor: 'var(--glass-bg)', color: 'var(--text-secondary)', borderColor: 'var(--glass-border)' }}
          title={isZh ? '刷新' : 'Refresh'}
        >
          <RefreshCw size={14} className={loadingList ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Error */}
      {listError && (
        <div className="glass-card p-4 rounded-xl border" style={{ background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.3)' }}>
          <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{listError}</p>
        </div>
      )}

      {/* Loading */}
      {loadingList && (
        <div className="flex items-center justify-center py-16">
          <Loader className="w-8 h-8 text-blue-500 animate-spin" />
        </div>
      )}

      {/* Scale cards */}
      {!loadingList && scales.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <ClipboardList size={48} style={{ color: 'var(--text-light)' }} />
          <p style={{ color: 'var(--text-secondary)' }}>
            {isZh ? '暂无可用量表' : 'No scales available'}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {scales.map(scale => (
          <div
            key={scale.id}
            className={`glass-card rounded-2xl p-6 border transition-all duration-200 ${
              scale.is_completed ? 'opacity-70' : 'hover:shadow-lg hover:scale-[1.01] cursor-pointer'
            }`}
            style={{ borderColor: scale.is_completed ? 'rgba(16,185,129,0.4)' : 'var(--glass-border)' }}
            onClick={() => !scale.is_completed && handleSelectScale(scale.id)}
          >
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-base font-semibold leading-tight pr-2" style={{ color: 'var(--text-primary)' }}>
                {scale.name}
              </h3>
              {scale.is_completed ? (
                <span className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">
                  <CheckCircle size={12} />
                  {isZh ? '已完成' : 'Completed'}
                </span>
              ) : (
                <span className="shrink-0 px-2.5 py-1 rounded-full text-xs font-medium"
                  style={{ background: 'rgba(99,102,241,0.12)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.25)' }}>
                  {isZh ? '待填写' : 'Pending'}
                </span>
              )}
            </div>

            {scale.description && (
              <p className="text-sm mb-3 line-clamp-2" style={{ color: 'var(--text-secondary)' }}>
                {scale.description}
              </p>
            )}

            <div className="flex items-center justify-between mt-4">
              <span className="text-xs" style={{ color: 'var(--text-light)' }}>
                {scale.question_count} {isZh ? '道题' : 'questions'}
              </span>
              {!scale.is_completed && (
                <button
                  onClick={e => { e.stopPropagation(); handleSelectScale(scale.id); }}
                  disabled={loadingTemplate}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-white rounded-lg transition-all hover:opacity-90 disabled:opacity-50"
                  style={{ background: 'linear-gradient(to right, #3b82f6, #6366f1)' }}
                >
                  {loadingTemplate ? <Loader size={13} className="animate-spin" /> : null}
                  {isZh ? '开始填写' : 'Start'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
