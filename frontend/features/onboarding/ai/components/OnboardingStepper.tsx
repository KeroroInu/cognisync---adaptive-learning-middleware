/**
 * OnboardingStepper - 引导步骤指示器
 * 显示当前对话进度（可选组件）
 */

import React from 'react';
import { CheckCircle, Circle, Sparkles } from 'lucide-react';
import type { Language } from '../../../../types';

export interface OnboardingStepperProps {
  currentStep: number; // 当前步骤（从 1 开始）
  totalSteps?: number; // 总步骤数（可选，如果后端不返回则不显示）
  language?: Language;
  theme?: 'light' | 'dark';
}

/**
 * 步骤指示器组件
 * 显示对话进度
 */
export const OnboardingStepper: React.FC<OnboardingStepperProps> = ({
  currentStep,
  totalSteps,
  language = 'zh',
  theme = 'light',
}) => {
  return (
    <div className="glass-card p-4 rounded-xl">
      {/* 标题 */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
          <span
            className="text-sm font-medium"
            style={{
              color: theme === 'light' ? '#000000' : '#ffffff',
            }}
          >
            {language === 'zh' ? '引导进度' : 'Guidance Progress'}
          </span>
        </div>
        {totalSteps !== undefined && (
          <span
            className="text-xs font-semibold"
            style={{
              color: theme === 'light' ? '#6b7280' : '#cbd5e1',
            }}
          >
            {currentStep} / {totalSteps}
          </span>
        )}
      </div>

      {/* 进度条 */}
      {totalSteps !== undefined ? (
        <>
          <div className="relative w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden mb-2">
            <div
              className="absolute top-0 left-0 h-full transition-all duration-500 ease-out rounded-full bg-gradient-to-r from-indigo-500 to-purple-600"
              style={{ width: `${(currentStep / totalSteps) * 100}%` }}
            />
          </div>
          <div className="text-center">
            <span
              className="text-xs font-medium"
              style={{
                color: theme === 'light' ? '#6b7280' : '#cbd5e1',
              }}
            >
              {Math.round((currentStep / totalSteps) * 100)}%{' '}
              {language === 'zh' ? '完成' : 'Complete'}
            </span>
          </div>
        </>
      ) : (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div className="h-full w-full bg-gradient-to-r from-indigo-500 to-purple-600 animate-pulse" />
          </div>
          <span
            className="text-xs whitespace-nowrap"
            style={{
              color: theme === 'light' ? '#6b7280' : '#cbd5e1',
            }}
          >
            {language === 'zh' ? '进行中...' : 'In Progress...'}
          </span>
        </div>
      )}
    </div>
  );
};

/**
 * 步骤列表（可选的详细版本）
 */
export interface OnboardingStepListProps {
  steps: string[]; // 步骤名称列表
  currentStep: number; // 当前步骤（从 0 开始）
  language?: Language;
  theme?: 'light' | 'dark';
}

export const OnboardingStepList: React.FC<OnboardingStepListProps> = ({
  steps,
  currentStep,
  language = 'zh',
  theme = 'light',
}) => {
  return (
    <div className="glass-card p-5 rounded-xl">
      <h3
        className="text-sm font-semibold mb-4"
        style={{
          color: theme === 'light' ? '#000000' : '#ffffff',
        }}
      >
        {language === 'zh' ? '引导流程' : 'Guidance Steps'}
      </h3>

      <div className="space-y-3">
        {steps.map((step, index) => {
          const isCompleted = index < currentStep;
          const isCurrent = index === currentStep;

          return (
            <div key={index} className="flex items-start gap-3">
              {/* 图标 */}
              <div className="flex-shrink-0 mt-0.5">
                {isCompleted ? (
                  <CheckCircle className="w-5 h-5 text-emerald-500" />
                ) : isCurrent ? (
                  <div className="w-5 h-5 rounded-full border-2 border-indigo-500 flex items-center justify-center">
                    <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                  </div>
                ) : (
                  <Circle className="w-5 h-5 text-gray-400 dark:text-gray-600" />
                )}
              </div>

              {/* 文本 */}
              <div className="flex-1">
                <p
                  className={`text-sm ${
                    isCompleted || isCurrent
                      ? 'font-medium'
                      : 'font-normal'
                  }`}
                  style={{
                    color: isCompleted
                      ? theme === 'light'
                        ? '#10b981'
                        : '#34d399'
                      : isCurrent
                      ? theme === 'light'
                        ? '#6366f1'
                        : '#818cf8'
                      : theme === 'light'
                      ? '#9ca3af'
                      : '#6b7280',
                  }}
                >
                  {step}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
