/**
 * ScaleOnboardingPage - 量表注册流程主页面
 * 功能：获取模板 → 填写问卷 → 提交 → 显示结果 → 更新画像
 */

import React, { useState, useEffect } from 'react';
import { AlertCircle, CheckCircle, ArrowLeft, Loader } from 'lucide-react';
import { Button } from '../../../components/Button';
import { RadarDisplay } from '../../../components/RadarDisplay';
import { useAuth } from '../../auth/hooks';
import { getActiveTemplate, submitScaleAnswers } from './api';
import { LikertItem } from './components/LikertItem';
import { ScaleProgress } from './components/ScaleProgress';
import { ScalePreview } from './components/ScalePreview';
import type {
  ScaleTemplate,
  ScaleAnswers,
  LikertValue,
  OnboardingStatus,
  ValidationError,
  InitialProfile,
} from './types';
import type { Language } from '../../../types';

export interface ScaleOnboardingPageProps {
  language?: Language;
  onComplete: () => void; // 完成后跳转（如 /chat 或 /）
  onBack?: () => void; // 返回上一步（可选）
}

export const ScaleOnboardingPage: React.FC<ScaleOnboardingPageProps> = ({
  language = 'zh',
  onComplete,
  onBack,
}) => {
  // 认证状态
  const { updateProfile } = useAuth();

  // 页面状态
  const [status, setStatus] = useState<OnboardingStatus>('loading');
  const [template, setTemplate] = useState<ScaleTemplate | null>(null);
  const [answers, setAnswers] = useState<ScaleAnswers>({});
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [apiError, setApiError] = useState<string | null>(null);
  const [initialProfile, setInitialProfile] = useState<InitialProfile | null>(null);

  /**
   * 加载激活的量表模板
   */
  useEffect(() => {
    const fetchTemplate = async () => {
      setStatus('loading');
      try {
        const data = await getActiveTemplate();
        setTemplate(data);
        setStatus('filling');
      } catch (error: any) {
        setApiError(error.message || '获取量表失败');
        setStatus('error');
      }
    };

    fetchTemplate();
  }, []);

  /**
   * 处理答案变化
   */
  const handleAnswerChange = (itemId: string, value: LikertValue) => {
    setAnswers((prev) => ({
      ...prev,
      [itemId]: value,
    }));

    // 清除该题的错误
    setErrors((prev) => prev.filter((err) => err.itemId !== itemId));
  };

  /**
   * 验证所有必填题是否已答
   */
  const validateAnswers = (): boolean => {
    if (!template) return false;

    const requiredItems = template.schema_json.items.filter(
      (item) => item.required !== false
    );

    const unansweredItems: ValidationError[] = [];

    for (const item of requiredItems) {
      if (!answers[item.id]) {
        unansweredItems.push({
          itemId: item.id,
          message: language === 'zh' ? '此题为必填' : 'This question is required',
        });
      }
    }

    if (unansweredItems.length > 0) {
      setErrors(unansweredItems);

      // 滚动到第一个未答题
      const firstUnanswered = unansweredItems[0];
      const element = document.getElementById(`item-${firstUnanswered.itemId}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }

      return false;
    }

    return true;
  };

  /**
   * 提交问卷
   */
  const handleSubmit = async () => {
    if (!template) return;

    // 前端验证
    if (!validateAnswers()) {
      return;
    }

    setStatus('submitting');
    setApiError(null);

    try {
      const response = await submitScaleAnswers(template.id, { answers });

      // 保存初始画像
      setInitialProfile(response.initialProfile);

      // 更新全局 profile
      updateProfile(response.initialProfile);

      // 切换到完成状态
      setStatus('completed');
    } catch (error: any) {
      setApiError(error.message || '提交失败');
      setStatus('filling');
    }
  };

  /**
   * 计算已答题数
   */
  const getAnsweredCount = (): number => {
    if (!template) return 0;
    const requiredItems = template.schema_json.items.filter(
      (item) => item.required !== false
    );
    return requiredItems.filter((item) => answers[item.id] !== undefined).length;
  };

  /**
   * 渲染加载骨架
   */
  const renderLoading = () => (
    <div className="min-h-screen flex items-center justify-center gradient-mesh p-4">
      <div className="glass-card p-8 rounded-2xl max-w-md w-full text-center">
        <Loader className="w-12 h-12 text-blue-500 animate-spin mx-auto mb-4" />
        <p className="text-gray-700 dark:text-gray-300">
          {language === 'zh' ? '加载量表中...' : 'Loading questionnaire...'}
        </p>
      </div>
    </div>
  );

  /**
   * 渲染错误状态
   */
  const renderError = () => (
    <div className="min-h-screen flex items-center justify-center gradient-mesh p-4">
      <div className="glass-card p-8 rounded-2xl max-w-md w-full">
        <div className="flex items-center gap-3 mb-4">
          <AlertCircle className="w-8 h-8 text-red-500" />
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            {language === 'zh' ? '加载失败' : 'Failed to Load'}
          </h2>
        </div>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          {apiError}
        </p>
        {onBack && (
          <Button variant="secondary" onClick={onBack} className="w-full">
            <ArrowLeft className="w-4 h-4 mr-2" />
            {language === 'zh' ? '返回' : 'Go Back'}
          </Button>
        )}
      </div>
    </div>
  );

  /**
   * 渲染填写中状态
   */
  const renderFilling = () => {
    if (!template) return null;

    const totalRequired = template.schema_json.items.filter(
      (item) => item.required !== false
    ).length;
    const answeredCount = getAnsweredCount();

    // 按分量表分组（如果有）
    const itemsBySubscale: Record<string, typeof template.schema_json.items> = {};

    if (template.schema_json.subscales && template.schema_json.subscales.length > 0) {
      // 有分量表，按分量表分组
      for (const subscale of template.schema_json.subscales) {
        itemsBySubscale[subscale.id] = template.schema_json.items.filter((item) =>
          subscale.itemIds.includes(item.id)
        );
      }
    } else {
      // 无分量表，全部放在一个组
      itemsBySubscale['all'] = template.schema_json.items;
    }

    return (
      <div className="min-h-screen gradient-mesh p-4 py-8">
        <div className="max-w-3xl mx-auto">
          {/* 返回按钮 */}
          {onBack && (
            <button
              onClick={onBack}
              className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors mb-6"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="text-sm font-medium">
                {language === 'zh' ? '返回' : 'Back'}
              </span>
            </button>
          )}

          {/* 标题 */}
          <div className="text-center mb-6">
            <h1 className="text-3xl font-bold text-gradient mb-2">
              {template.schema_json.title}
            </h1>
            {template.schema_json.description && (
              <p className="text-gray-600 dark:text-gray-400">
                {template.schema_json.description}
              </p>
            )}
          </div>

          {/* 进度条 */}
          <ScaleProgress
            total={totalRequired}
            answered={answeredCount}
            className="mb-6"
          />

          {/* API 错误 */}
          {apiError && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6 flex items-start gap-3 animate-fade-in">
              <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-800 dark:text-red-200">
                  {language === 'zh' ? '提交失败' : 'Submission Failed'}
                </p>
                <p className="text-sm text-red-600 dark:text-red-400">
                  {apiError}
                </p>
              </div>
            </div>
          )}

          {/* 题目列表 */}
          <div className="space-y-4 mb-6">
            {Object.entries(itemsBySubscale).map(([subscaleId, items]) => (
              <div key={subscaleId}>
                {/* 分量表标题 */}
                {subscaleId !== 'all' && (
                  <div className="mb-4">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                      {template.schema_json.subscales?.find((s) => s.id === subscaleId)?.name}
                    </h2>
                    {template.schema_json.subscales?.find((s) => s.id === subscaleId)
                      ?.description && (
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        {
                          template.schema_json.subscales?.find((s) => s.id === subscaleId)
                            ?.description
                        }
                      </p>
                    )}
                  </div>
                )}

                {/* 题目 */}
                {items.map((item, index) => {
                  const globalIndex = template.schema_json.items.indexOf(item) + 1;
                  const error = errors.find((err) => err.itemId === item.id);

                  return (
                    <LikertItem
                      key={item.id}
                      item={item}
                      index={globalIndex}
                      options={template.schema_json.likertOptions}
                      value={answers[item.id] || null}
                      onChange={handleAnswerChange}
                      error={error?.message}
                      disabled={status === 'submitting'}
                    />
                  );
                })}
              </div>
            ))}
          </div>

          {/* 提交按钮 */}
          <div className="sticky bottom-4">
            <Button
              variant="primary"
              size="lg"
              onClick={handleSubmit}
              isLoading={status === 'submitting'}
              disabled={status === 'submitting'}
              className="w-full shadow-xl"
            >
              {status === 'submitting'
                ? language === 'zh'
                  ? '提交中...'
                  : 'Submitting...'
                : language === 'zh'
                ? '提交问卷'
                : 'Submit'}
            </Button>
          </div>
        </div>
      </div>
    );
  };

  /**
   * 渲染完成状态
   */
  const renderCompleted = () => {
    if (!initialProfile) return null;

    return (
      <div className="min-h-screen flex items-center justify-center gradient-mesh p-4">
        <div className="glass-card p-8 rounded-2xl max-w-2xl w-full animate-scale-in">
          {/* 成功图标 */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 text-white mb-4 shadow-lg">
              <CheckCircle className="w-8 h-8" />
            </div>
            <h1 className="text-3xl font-bold text-gradient mb-2">
              {language === 'zh' ? '注册完成！' : 'Registration Complete!'}
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              {language === 'zh'
                ? '您的初始学习画像已生成'
                : 'Your initial learning profile has been generated'}
            </p>
          </div>

          {/* 雷达图 */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 text-center">
              {language === 'zh' ? '您的学习画像' : 'Your Learning Profile'}
            </h2>
            <div className="h-80">
              <RadarDisplay data={initialProfile} language={language} />
            </div>

            {/* 画像数据 */}
            <div className="grid grid-cols-3 gap-4 mt-6">
              <div className="text-center">
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">
                  {language === 'zh' ? '认知能力' : 'Cognition'}
                </p>
                <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                  {initialProfile.cognition}
                </p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">
                  {language === 'zh' ? '情感状态' : 'Affect'}
                </p>
                <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                  {initialProfile.affect}
                </p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">
                  {language === 'zh' ? '行为特征' : 'Behavior'}
                </p>
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {initialProfile.behavior}
                </p>
              </div>
            </div>
          </div>

          {/* 提示信息 */}
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6">
            <p className="text-sm text-blue-800 dark:text-blue-200">
              💡{' '}
              {language === 'zh'
                ? '系统将根据您的画像推荐个性化学习内容，并在学习过程中不断优化。'
                : 'The system will recommend personalized learning content based on your profile and continuously optimize during learning.'}
            </p>
          </div>

          {/* 进入系统按钮 */}
          <Button
            variant="primary"
            size="lg"
            onClick={onComplete}
            className="w-full"
          >
            {language === 'zh' ? '进入系统' : 'Enter System'}
          </Button>
        </div>
      </div>
    );
  };

  // 根据状态渲染
  if (status === 'loading') {
    return renderLoading();
  }

  if (status === 'error') {
    return renderError();
  }

  if (status === 'completed') {
    return renderCompleted();
  }

  return renderFilling();
};
