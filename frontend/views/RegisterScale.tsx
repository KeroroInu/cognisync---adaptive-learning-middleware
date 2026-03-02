import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, CheckCircle, Loader } from 'lucide-react';
import { getActiveScaleTemplate, submitScaleAnswers } from '../services/api';
import { translations } from '../utils/translations';
import type {
  Language,
  UserProfile,
  ScaleTemplate,
  ScaleAnswer,
  Dimension
} from '../types';

export interface RegisterScaleProps {
  language: Language;
  onComplete: (initialProfile: UserProfile) => void;
  onBack: () => void;
}

export const RegisterScale: React.FC<RegisterScaleProps> = ({
  language,
  onComplete,
  onBack
}) => {
  const t = translations[language];

  // 状态管理
  const [template, setTemplate] = useState<ScaleTemplate | null>(null);
  const [answers, setAnswers] = useState<ScaleAnswer[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isComplete, setIsComplete] = useState(false);
  const [warningModal, setWarningModal] = useState<{
    message: string;
    /** 非 null = 软提示（继续按钮）; null = 硬拦截（仅"重新作答"） */
    onContinue: (() => void) | null;
  } | null>(null);

  // 记录开始答题时间（加载完模板后）
  const startTimeRef = useRef<number | null>(null);
  // 滚动窗口：记录最近 5 次选择的值和耗时
  const recentAnswersRef = useRef<Array<{ value: number; duration: number }>>([]);
  const lastAnswerTimeRef = useRef<number | null>(null);

  // 加载量表模板
  useEffect(() => {
    const loadTemplate = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const data = await getActiveScaleTemplate();
        setTemplate(data);
        // 初始化空答案数组
        setAnswers(data.questions.map(q => ({ questionId: q.id, value: 0 })));
        // 模板加载完成后开始计时
        startTimeRef.current = Date.now();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load scale template');
        console.error('Failed to load template:', err);
      } finally {
        setIsLoading(false);
      }
    };

    loadTemplate();
  }, []);

  // 检测最终提交时的可疑行为（用于硬拦截）
  const checkSuspiciousAnswers = (finalAnswers: ScaleAnswer[]): string | null => {
    // 1. 完成时间过短（< 60 秒）
    const elapsed = startTimeRef.current ? Date.now() - startTimeRef.current : Infinity;
    if (elapsed < 60000) {
      return '您的作答速度有点快，建议仔细阅读每道题目后再选择哦 😊';
    }

    // 2. 大量相同选项（≥ 75% 答案为同一值，题目数 ≥ 5）
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

  // 实际执行提交
  const doSubmit = (finalAnswers: ScaleAnswer[]) => {
    if (!template) return;
    setIsSubmitting(true);
    setError(null);
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
          setIsComplete(true);
          setTimeout(() => onComplete(response.data!.initialProfile), 2000);
        }
      })
      .catch(err => {
        setError(err instanceof Error ? err.message : 'Failed to submit scale');
      })
      .finally(() => setIsSubmitting(false));
  };

  // 处理 Likert 选择（选完自动跳下一题 / 最后一题自动提交）
  const handleLikertSelect = (value: number) => {
    if (!template) return;

    const now = Date.now();
    const duration = lastAnswerTimeRef.current ? now - lastAnswerTimeRef.current : Infinity;
    lastAnswerTimeRef.current = now;

    // 更新答案
    const newAnswers = [...answers];
    newAnswers[currentQuestionIndex] = {
      questionId: template.questions[currentQuestionIndex].id,
      value
    };
    setAnswers(newAnswers);

    // 更新滚动窗口（最近 5 次）
    const recent = recentAnswersRef.current;
    recent.push({ value, duration });
    if (recent.length > 5) recent.shift();

    const isLast = currentQuestionIndex === template.questions.length - 1;

    // ── 实时检测（中途，非最后一题，积累到 5 次后开始检查）──
    if (!isLast && recent.length >= 5) {
      const allSameValue = recent.every(a => a.value === recent[0].value);
      const allVeryFast = recent.every(a => a.duration < 2000); // < 2 秒/题

      if (allSameValue) {
        setWarningModal({
          message: '检测到您连续 5 题都选了同一选项，请根据实际情况如实作答哦 😊',
          onContinue: () => {
            setWarningModal(null);
            recentAnswersRef.current = []; // 重置窗口，给一次机会
            setCurrentQuestionIndex(prev => prev + 1);
          },
        });
        return; // 不自动跳题，等用户确认
      }

      if (allVeryFast) {
        setWarningModal({
          message: '您连续 5 题均在 2 秒内作答，请仔细阅读每道题目后再选择哦 😊',
          onContinue: () => {
            setWarningModal(null);
            recentAnswersRef.current = [];
            setCurrentQuestionIndex(prev => prev + 1);
          },
        });
        return;
      }
    }

    // ── 正常流程 ──
    setTimeout(() => {
      if (isLast) {
        // 最后一题：最终检测（硬拦截，不提供"确认提交"选项）
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

  // 上一题
  const handlePrevious = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(currentQuestionIndex - 1);
    }
  };

  // 下一题
  const handleNext = () => {
    if (template && currentQuestionIndex < template.questions.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
    }
  };

  // 提交问卷
  const handleSubmit = async () => {
    if (!template) return;

    // 验证所有问题都已回答
    const unansweredQuestions = answers.filter(a => a.value === 0);
    if (unansweredQuestions.length > 0) {
      setError('Please answer all questions before submitting');
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);

      // 转换答案格式：数组 -> 对象
      const answersDict = answers.reduce((acc, answer) => {
        acc[answer.questionId] = answer.value;
        return acc;
      }, {} as Record<string, number>);

      const response = await submitScaleAnswers(template.id, {
        answers: answersDict,
        started_at: startTimeRef.current ? new Date(startTimeRef.current).toISOString() : undefined,
      });

      if (response.success && response.data) {
        setIsComplete(true);

        // 延迟后调用 onComplete
        setTimeout(() => {
          onComplete(response.data!.initialProfile);
        }, 2000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit scale');
      console.error('Failed to submit scale:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 获取维度颜色
  const getDimensionColor = (dimension: Dimension): string => {
    switch (dimension) {
      case 'CT':  return 'from-blue-500 to-cyan-600';
      case 'SE':  return 'from-purple-500 to-violet-600';
      case 'LM':  return 'from-pink-500 to-rose-600';
      case 'CPS': return 'from-amber-500 to-orange-600';
      case 'PA':  return 'from-green-500 to-emerald-600';
      case 'AIL': return 'from-indigo-500 to-blue-700';
      // 旧维度兼容
      case 'Cognition': return 'from-blue-500 to-cyan-600';
      case 'Affect':    return 'from-purple-500 to-pink-600';
      case 'Behavior':  return 'from-green-500 to-emerald-600';
      default:          return 'from-gray-500 to-gray-600';
    }
  };

  // 维度显示名（中文标签）
  const DIM_LABEL: Record<string, string> = {
    CT: '计算思维', SE: '自我效能感', LM: '学习动机',
    CPS: '复杂问题解决', PA: '编程能力', AIL: 'AI 素养',
  };
  const getDimensionLabel = (dim: string) => DIM_LABEL[dim] || dim;

  // 计算进度
  const progress = template ? ((currentQuestionIndex + 1) / template.questions.length) * 100 : 0;
  const currentAnswer = answers[currentQuestionIndex]?.value || 0;
  const isLastQuestion = template ? currentQuestionIndex === template.questions.length - 1 : false;
  const canProceed = currentAnswer > 0;

  // 加载中
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center gradient-mesh">
        <div className="glass-card p-8 flex flex-col items-center gap-4">
          <Loader className="w-12 h-12 text-blue-500 animate-spin" />
          <p className="text-lg" style={{ color: 'var(--text-secondary)' }}>{t.loading}</p>
        </div>
      </div>
    );
  }

  // 错误状态
  if (error && !template) {
    return (
      <div className="min-h-screen flex items-center justify-center gradient-mesh p-4">
        <div className="glass-card p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>{t.error}</h2>
          <p className="mb-6" style={{ color: 'var(--text-light)' }}>{error}</p>
          <button
            onClick={onBack}
            className="px-6 py-3 bg-gradient-to-r from-blue-500 to-cyan-600 hover:from-blue-600 hover:to-cyan-700 text-white font-medium rounded-xl shadow-lg hover:shadow-xl transition-all duration-300"
          >
            {t.back}
          </button>
        </div>
      </div>
    );
  }

  // 完成动画
  if (isComplete) {
    return (
      <div className="min-h-screen flex items-center justify-center gradient-mesh">
        <div className="glass-card p-12 max-w-md w-full text-center animate-scale-in">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center mx-auto mb-6 animate-bounce-in">
            <CheckCircle className="w-12 h-12 text-white" />
          </div>
          <h2 className="text-3xl font-bold text-gradient mb-3">{t.scaleComplete}</h2>
          <p className="text-lg" style={{ color: 'var(--text-light)' }}>{t.scaleCompleteDesc}</p>

          {/* Loading dots animation */}
          <div className="flex justify-center gap-2 mt-6">
            <div className="w-3 h-3 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '0ms' }}></div>
            <div className="w-3 h-3 rounded-full bg-purple-500 animate-bounce" style={{ animationDelay: '150ms' }}></div>
            <div className="w-3 h-3 rounded-full bg-pink-500 animate-bounce" style={{ animationDelay: '300ms' }}></div>
          </div>
        </div>
      </div>
    );
  }

  if (!template) return null;

  const currentQuestion = template.questions[currentQuestionIndex];

  return (
    <div className="min-h-screen flex items-center justify-center gradient-mesh p-4">
      {/* 可疑行为警告弹窗 */}
      {warningModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="glass-card p-8 max-w-sm w-full text-center animate-scale-in rounded-2xl shadow-2xl">
            <div className="text-5xl mb-4">⚠️</div>
            <h3 className="text-xl font-bold mb-3" style={{ color: 'var(--text-primary)' }}>
              温馨提示
            </h3>
            <p className="mb-6 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              {warningModal.message}
            </p>
            <div className="flex gap-3 justify-center">
              {/* 硬拦截：仅"重新作答" */}
              {warningModal.onContinue === null && (
                <button
                  onClick={() => setWarningModal(null)}
                  className="flex-1 px-4 py-3 bg-gradient-to-r from-blue-500 to-cyan-600 hover:from-blue-600 hover:to-cyan-700 text-white font-medium rounded-xl transition-all duration-200 hover:scale-105 shadow-lg"
                >
                  重新作答
                </button>
              )}
              {/* 软提示：继续 + 重新作答 */}
              {warningModal.onContinue !== null && (
                <>
                  <button
                    onClick={() => setWarningModal(null)}
                    className="flex-1 px-4 py-3 font-medium rounded-xl border-2 transition-all duration-200 hover:scale-105"
                    style={{
                      backgroundColor: 'var(--glass-bg)',
                      color: 'var(--text-secondary)',
                      borderColor: 'var(--glass-border)',
                    }}
                  >
                    重新选择
                  </button>
                  <button
                    onClick={warningModal.onContinue}
                    className="flex-1 px-4 py-3 bg-gradient-to-r from-blue-500 to-cyan-600 hover:from-blue-600 hover:to-cyan-700 text-white font-medium rounded-xl transition-all duration-200 hover:scale-105 shadow-lg"
                  >
                    知道了，继续
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="w-full max-w-4xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-600 text-white mb-4 shadow-lg animate-float">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
            </svg>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-gradient mb-2">
            {t.scaleOnboarding}
          </h1>
          <p className="mb-4" style={{ color: 'var(--text-light)' }}>{t.scaleOnboardingDesc}</p>
          <p className="text-sm" style={{ color: 'var(--text-light)' }}>{t.scaleInstruction}</p>
        </div>

        {/* Progress Bar */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
              {t.questionProgress
                .replace('{current}', String(currentQuestionIndex + 1))
                .replace('{total}', String(template.questions.length))}
            </span>
            <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
              {Math.round(progress)}%
            </span>
          </div>
          <div className="h-3 rounded-full overflow-hidden shadow-inner" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
            <div
              className="h-full bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 transition-all duration-500 ease-out rounded-full"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Question Card */}
        <div className="glass-card p-8 mb-6 animate-fade-in">
          {/* Dimension Badge */}
          <div className="flex justify-center mb-6">
            <div className={`inline-flex items-center px-4 py-2 rounded-full bg-gradient-to-r ${getDimensionColor(currentQuestion.dimension)} text-white shadow-lg font-medium text-sm`}>
              <div className="w-2 h-2 rounded-full bg-white mr-2 animate-pulse" />
              {getDimensionLabel(currentQuestion.dimension)}
            </div>
          </div>

          {/* Question Text */}
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-8 leading-relaxed" style={{ color: 'var(--text-primary)' }}>
            {currentQuestion.text}
          </h2>

          {/* Likert Scale Buttons */}
          <div className="flex justify-center items-center gap-3 md:gap-6 mb-4">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                onClick={() => handleLikertSelect(value)}
                className={`
                  group relative w-14 h-14 md:w-16 md:h-16 rounded-full transition-all duration-300
                  ${currentAnswer === value
                    ? `bg-gradient-to-br ${getDimensionColor(currentQuestion.dimension)} text-white scale-110 shadow-xl`
                    : 'hover:scale-105 hover:shadow-lg border-2'
                  }
                `}
                style={currentAnswer !== value ? {
                  backgroundColor: 'var(--glass-bg)',
                  color: 'var(--text-primary)',
                  borderColor: 'var(--glass-border)',
                } : undefined}
              >
                <span className="text-xl md:text-2xl font-bold">{value}</span>

                {/* Hover tooltip */}
                <div className="absolute -bottom-8 left-1/2 transform -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap">
                  <span className="text-xs" style={{ color: 'var(--text-light)' }}>
                    {value === 1 && t.stronglyDisagree}
                    {value === 5 && t.stronglyAgree}
                  </span>
                </div>
              </button>
            ))}
          </div>

          {/* Scale Labels */}
          <div className="flex justify-between items-center text-xs md:text-sm px-2" style={{ color: 'var(--text-light)' }}>
            <span>{t.stronglyDisagree}</span>
            <span>{t.stronglyAgree}</span>
          </div>
        </div>

        {/* Error Message */}
        {error && template && (
          <div className="glass-card p-4 mb-6 border-l-4 border-red-500">
            <p className="text-red-500 text-sm">{error}</p>
          </div>
        )}

        {/* Navigation Buttons */}
        <div className="flex gap-4">
          {/* Back Button */}
          <button
            onClick={onBack}
            className="px-6 py-3 font-medium rounded-xl shadow-md hover:shadow-lg transition-all duration-300 border-2 flex items-center gap-2 hover:scale-105"
            style={{
              backgroundColor: 'var(--glass-bg)',
              color: 'var(--text-secondary)',
              borderColor: 'var(--glass-border)',
            }}
          >
            <ArrowLeft className="w-5 h-5" />
            {t.back}
          </button>

          {/* Previous Button */}
          <button
            onClick={handlePrevious}
            disabled={currentQuestionIndex === 0}
            className="px-6 py-3 font-medium rounded-xl shadow-md hover:shadow-lg transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed border-2 flex items-center justify-center gap-2 hover:enabled:scale-105"
            style={{
              backgroundColor: 'var(--glass-bg)',
              color: 'var(--text-secondary)',
              borderColor: 'var(--glass-border)',
            }}
          >
            <ArrowLeft className="w-5 h-5" />
            {t.previous}
          </button>

          {/* Submitting indicator (last question only) */}
          {isLastQuestion && isSubmitting && (
            <div className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white font-medium rounded-xl shadow-lg">
              <Loader className="w-5 h-5 animate-spin" />
              {t.submittingScale}
            </div>
          )}
        </div>

        {/* Question Navigation Dots */}
        <div className="flex justify-center gap-2 mt-8">
          {template.questions.map((_, index) => (
            <button
              key={index}
              onClick={() => setCurrentQuestionIndex(index)}
              className={`
                w-2.5 h-2.5 rounded-full transition-all duration-300
                ${index === currentQuestionIndex
                  ? 'bg-gradient-to-r from-blue-500 to-purple-500 w-8'
                  : answers[index]?.value > 0
                    ? 'bg-green-500'
                    : ''
                }
              `}
              style={
                index !== currentQuestionIndex && !(answers[index]?.value > 0)
                  ? { backgroundColor: 'var(--bg-tertiary)' }
                  : undefined
              }
              title={`Question ${index + 1}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
