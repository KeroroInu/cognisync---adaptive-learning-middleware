/**
 * LikertItem - Likert 量表题目组件
 * 渲染单个题目和 1-5 单选按钮
 */

import React from 'react';
import type { ScaleItem, LikertOption, LikertValue } from '../types';

export interface LikertItemProps {
  item: ScaleItem;
  index: number; // 题目序号（从 1 开始）
  options: LikertOption[];
  value: LikertValue | null;
  onChange: (itemId: string, value: LikertValue) => void;
  error?: string;
  disabled?: boolean;
}

export const LikertItem: React.FC<LikertItemProps> = ({
  item,
  index,
  options,
  value,
  onChange,
  error,
  disabled = false,
}) => {
  return (
    <div
      id={`item-${item.id}`}
      className={`glass-card p-6 rounded-xl transition-all duration-200 ${
        error ? 'ring-2 ring-red-500' : ''
      }`}
    >
      {/* 题目文本 */}
      <div className="mb-4">
        <h3 className="text-base font-medium text-gray-900 dark:text-white">
          <span className="text-blue-500 mr-2">{index}.</span>
          {item.text}
          {item.required !== false && (
            <span className="text-red-500 ml-1">*</span>
          )}
        </h3>
        {item.subscale && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            [{item.subscale}]
          </p>
        )}
      </div>

      {/* Likert 选项 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          {options.map((option) => (
            <label
              key={option.value}
              className={`flex-1 cursor-pointer ${
                disabled ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              <div
                className={`p-3 rounded-lg border-2 transition-all duration-200 text-center ${
                  value === option.value
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600'
                }`}
              >
                <input
                  type="radio"
                  name={`item-${item.id}`}
                  value={option.value}
                  checked={value === option.value}
                  onChange={() => onChange(item.id, option.value)}
                  disabled={disabled}
                  className="sr-only"
                />
                <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {option.value}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {option.label}
                </div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mt-3 text-sm text-red-600 dark:text-red-400 animate-fade-in">
          {error}
        </div>
      )}
    </div>
  );
};
