/**
 * ScaleProgress - 量表填写进度条
 * 显示已完成/总题数 + 进度条
 */

import React from 'react';
import { CheckCircle, Circle } from 'lucide-react';

export interface ScaleProgressProps {
  total: number; // 总题数
  answered: number; // 已答题数
  className?: string;
}

export const ScaleProgress: React.FC<ScaleProgressProps> = ({
  total,
  answered,
  className = '',
}) => {
  const percentage = total > 0 ? Math.round((answered / total) * 100) : 0;
  const isComplete = answered === total;

  return (
    <div className={`glass-card p-4 rounded-xl ${className}`}>
      {/* 标题和数字 */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {isComplete ? (
            <CheckCircle className="w-5 h-5 text-green-500" />
          ) : (
            <Circle className="w-5 h-5 text-blue-500" />
          )}
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            填写进度
          </span>
        </div>
        <div className="text-sm font-semibold">
          <span className={isComplete ? 'text-green-600 dark:text-green-400' : 'text-blue-600 dark:text-blue-400'}>
            {answered}
          </span>
          <span className="text-gray-500 dark:text-gray-400">
            {' / '}
            {total}
          </span>
        </div>
      </div>

      {/* 进度条 */}
      <div className="relative w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`absolute top-0 left-0 h-full transition-all duration-500 ease-out rounded-full ${
            isComplete
              ? 'bg-gradient-to-r from-green-500 to-emerald-600'
              : 'bg-gradient-to-r from-blue-500 to-indigo-600'
          }`}
          style={{ width: `${percentage}%` }}
        />
      </div>

      {/* 百分比文本 */}
      <div className="mt-2 text-center">
        <span className={`text-xs font-medium ${
          isComplete
            ? 'text-green-600 dark:text-green-400'
            : 'text-gray-600 dark:text-gray-400'
        }`}>
          {percentage}% 完成
        </span>
      </div>
    </div>
  );
};
