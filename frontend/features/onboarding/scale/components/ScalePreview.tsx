/**
 * ScalePreview - 量表预览组件
 * 显示量表基本信息（标题、描述、题数）
 */

import React from 'react';
import { ClipboardList, FileText, Hash } from 'lucide-react';
import type { ScaleTemplate } from '../types';

export interface ScalePreviewProps {
  template: ScaleTemplate;
  onStart?: () => void;
  showStartButton?: boolean;
}

export const ScalePreview: React.FC<ScalePreviewProps> = ({
  template,
  onStart,
  showStartButton = false,
}) => {
  const { schema_json } = template;
  const totalItems = schema_json.items.length;
  const subscalesCount = schema_json.subscales?.length || 0;

  return (
    <div className="glass-card p-6 rounded-2xl">
      {/* 标题 */}
      <div className="flex items-start gap-4 mb-4">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-600 flex items-center justify-center text-white shadow-lg flex-shrink-0">
          <ClipboardList className="w-6 h-6" />
        </div>
        <div className="flex-1">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">
            {schema_json.title}
          </h2>
          {schema_json.description && (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {schema_json.description}
            </p>
          )}
        </div>
      </div>

      {/* 基本信息 */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="flex items-center gap-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
          <Hash className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          <div>
            <p className="text-xs text-gray-600 dark:text-gray-400">题目数量</p>
            <p className="text-lg font-semibold text-gray-900 dark:text-white">
              {totalItems} 题
            </p>
          </div>
        </div>

        {subscalesCount > 0 && (
          <div className="flex items-center gap-3 p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
            <FileText className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            <div>
              <p className="text-xs text-gray-600 dark:text-gray-400">分量表</p>
              <p className="text-lg font-semibold text-gray-900 dark:text-white">
                {subscalesCount} 个
              </p>
            </div>
          </div>
        )}
      </div>

      {/* 分量表列表（如果有） */}
      {subscalesCount > 0 && schema_json.subscales && (
        <div className="mb-6">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            分量表维度
          </h3>
          <div className="space-y-2">
            {schema_json.subscales.map((subscale, index) => (
              <div
                key={subscale.id}
                className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400"
              >
                <div className="w-6 h-6 rounded-md bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white text-xs font-semibold">
                  {index + 1}
                </div>
                <span className="font-medium">{subscale.name}</span>
                {subscale.description && (
                  <span className="text-xs text-gray-500">
                    - {subscale.description}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 提示信息 */}
      <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-4">
        <p className="text-sm text-yellow-800 dark:text-yellow-200">
          💡 <strong>温馨提示：</strong>请根据您的真实感受作答，没有对错之分。预计耗时 5-10 分钟。
        </p>
      </div>

      {/* 开始按钮 */}
      {showStartButton && onStart && (
        <button
          onClick={onStart}
          className="w-full px-6 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-medium rounded-lg hover:shadow-lg transition-all duration-200"
        >
          开始填写
        </button>
      )}
    </div>
  );
};
