import React, { useState, useEffect } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle, Loader } from 'lucide-react';
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
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load scale template');
        console.error('Failed to load template:', err);
      } finally {
        setIsLoading(false);
      }
    };

    loadTemplate();
  }, []);

  // 处理 Likert 选择
  const handleLikertSelect = (value: number) => {
    if (!template) return;

    const newAnswers = [...answers];
    newAnswers[currentQuestionIndex] = {
      questionId: template.questions[currentQuestionIndex].id,
      value
    };
    setAnswers(newAnswers);
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
      // 从 [{questionId: "item_1", value: 5}, ...] 转为 {"item_1": 5, ...}
      const answersDict = answers.reduce((acc, answer) => {
        acc[answer.questionId] = answer.value;
        return acc;
      }, {} as Record<string, number>);

      const response = await submitScaleAnswers(template.id, { answers: answersDict });

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
      case 'Cognition':
        return 'from-blue-500 to-cyan-600';
      case 'Affect':
        return 'from-purple-500 to-pink-600';
      case 'Behavior':
        return 'from-green-500 to-emerald-600';
      default:
        return 'from-gray-500 to-gray-600';
    }
  };

  // 获取维度文本颜色
  const getDimensionTextColor = (dimension: Dimension): string => {
    switch (dimension) {
      case 'Cognition':
        return 'text-blue-600 dark:text-blue-400';
      case 'Affect':
        return 'text-purple-600 dark:text-purple-400';
      case 'Behavior':
        return 'text-green-600 dark:text-green-400';
      default:
        return 'text-gray-600 dark:text-gray-400';
    }
  };

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
          <p className="text-lg text-gray-700 dark:text-gray-300">{t.loading}</p>
        </div>
      </div>
    );
  }

  // 错误状态
  if (error && !template) {
    return (
      <div className="min-h-screen flex items-center justify-center gradient-mesh p-4">
        <div className="glass-card p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">{t.error}</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-6">{error}</p>
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
          <p className="text-lg text-gray-600 dark:text-gray-400">{t.scaleCompleteDesc}</p>

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
          <p className="text-gray-600 dark:text-gray-400 mb-4">{t.scaleOnboardingDesc}</p>
          <p className="text-sm text-gray-500 dark:text-gray-500">{t.scaleInstruction}</p>
        </div>

        {/* Progress Bar */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t.questionProgress
                .replace('{current}', String(currentQuestionIndex + 1))
                .replace('{total}', String(template.questions.length))}
            </span>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {Math.round(progress)}%
            </span>
          </div>
          <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden shadow-inner">
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
              {currentQuestion.dimension}
            </div>
          </div>

          {/* Question Text */}
          <h2 className="text-2xl md:text-3xl font-bold text-center text-gray-900 dark:text-white mb-8 leading-relaxed">
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
                    : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:scale-105 hover:shadow-lg border-2 border-gray-300 dark:border-gray-600'
                  }
                `}
              >
                <span className="text-xl md:text-2xl font-bold">{value}</span>

                {/* Hover tooltip */}
                <div className="absolute -bottom-8 left-1/2 transform -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap">
                  <span className="text-xs text-gray-600 dark:text-gray-400">
                    {value === 1 && t.stronglyDisagree}
                    {value === 5 && t.stronglyAgree}
                  </span>
                </div>
              </button>
            ))}
          </div>

          {/* Scale Labels */}
          <div className="flex justify-between items-center text-xs md:text-sm text-gray-500 dark:text-gray-500 px-2">
            <span>{t.stronglyDisagree}</span>
            <span>{t.stronglyAgree}</span>
          </div>
        </div>

        {/* Error Message */}
        {error && template && (
          <div className="glass-card p-4 mb-6 border-l-4 border-red-500 bg-red-50 dark:bg-red-900/20">
            <p className="text-red-700 dark:text-red-400 text-sm">{error}</p>
          </div>
        )}

        {/* Navigation Buttons */}
        <div className="flex gap-4">
          {/* Back Button */}
          <button
            onClick={onBack}
            className="px-6 py-3 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-medium rounded-xl shadow-md hover:shadow-lg transition-all duration-300 border-2 border-gray-300 dark:border-gray-600 flex items-center gap-2 hover:scale-105"
          >
            <ArrowLeft className="w-5 h-5" />
            {t.back}
          </button>

          <div className="flex-1 flex gap-4">
            {/* Previous Button */}
            <button
              onClick={handlePrevious}
              disabled={currentQuestionIndex === 0}
              className="flex-1 px-6 py-3 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-medium rounded-xl shadow-md hover:shadow-lg transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed border-2 border-gray-300 dark:border-gray-600 flex items-center justify-center gap-2 hover:enabled:scale-105"
            >
              <ArrowLeft className="w-5 h-5" />
              {t.previous}
            </button>

            {/* Next/Submit Button */}
            {isLastQuestion ? (
              <button
                onClick={handleSubmit}
                disabled={!canProceed || isSubmitting}
                className="flex-1 px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-medium rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 hover:enabled:scale-105"
              >
                {isSubmitting ? (
                  <>
                    <Loader className="w-5 h-5 animate-spin" />
                    {t.submittingScale}
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-5 h-5" />
                    {t.submitScale}
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={handleNext}
                disabled={!canProceed}
                className="flex-1 px-6 py-3 bg-gradient-to-r from-blue-500 to-cyan-600 hover:from-blue-600 hover:to-cyan-700 text-white font-medium rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 hover:enabled:scale-105"
              >
                {t.next}
                <ArrowRight className="w-5 h-5" />
              </button>
            )}
          </div>
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
                    : 'bg-gray-300 dark:bg-gray-600'
                }
              `}
              title={`Question ${index + 1}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
