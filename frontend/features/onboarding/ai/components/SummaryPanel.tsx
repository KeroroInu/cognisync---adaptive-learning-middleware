/**
 * SummaryPanel - 已确认信息面板
 * 显示 AI 对话中已确认的用户信息
 */

import React from 'react';
import { CheckCircle, Sparkles } from 'lucide-react';
import type { ConfirmedInfo, DraftProfile } from '../types';
import type { Language } from '../../../../types';

export interface SummaryPanelProps {
  summary: ConfirmedInfo[];
  draftProfile?: DraftProfile | null;
  language?: Language;
  theme?: 'light' | 'dark';
}

/**
 * 已确认信息面板
 * 样式复用 views/Chat.tsx 的侧边栏 (第 173-265 行)
 */
export const SummaryPanel: React.FC<SummaryPanelProps> = ({
  summary,
  draftProfile,
  language = 'zh',
  theme = 'light',
}) => {
  return (
    <div className="space-y-4">
      {/* 标题 */}
      <h3
        className="text-sm font-semibold uppercase tracking-wider mb-2"
        style={{
          color: theme === 'light' ? '#404040' : '#cbd5e1',
        }}
      >
        {language === 'zh' ? '已确认信息' : 'Confirmed Information'}
      </h3>

      {/* 已确认信息列表 */}
      {summary.length > 0 ? (
        <div className="glass-card p-5 space-y-4 animate-slide-in-right hover:shadow-xl transition-all duration-300">
          <div className="flex items-center space-x-2 text-emerald-500 dark:text-emerald-300 mb-2">
            <CheckCircle size={16} />
            <span className="font-semibold text-sm">
              {language === 'zh' ? '画像构建中' : 'Profile Building'}
            </span>
          </div>

          {/* 信息条目 */}
          <div className="space-y-3">
            {summary.map((info, index) => (
              <div key={index} className="pb-3 border-b border-gray-200 dark:border-gray-700 last:border-0">
                <span
                  className="text-xs block mb-1 font-medium"
                  style={{
                    color: theme === 'light' ? '#404040' : '#cbd5e1',
                  }}
                >
                  {info.key}
                </span>
                <div className="flex items-start justify-between gap-2">
                  <p
                    className="text-sm flex-1"
                    style={{
                      color: theme === 'light' ? '#000000' : '#ffffff',
                    }}
                  >
                    {info.value}
                  </p>
                  {info.confidence !== undefined && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 whitespace-nowrap">
                      {Math.round(info.confidence * 100)}%
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="glass-card p-5 hover:shadow-xl transition-all duration-300">
          <p
            className="text-sm text-center"
            style={{
              color: theme === 'light' ? '#6b7280' : '#cbd5e1',
            }}
          >
            {language === 'zh'
              ? '暂无确认信息，请开始对话'
              : 'No confirmed info yet, start chatting'}
          </p>
        </div>
      )}

      {/* 草稿画像（如果有） */}
      {draftProfile && (
        <div className="glass-card p-5 hover:shadow-xl transition-all duration-300">
          <div className="flex items-center space-x-2 text-indigo-500 dark:text-indigo-300 mb-3">
            <Sparkles size={16} />
            <span className="font-semibold text-sm">
              {language === 'zh' ? '预估画像' : 'Draft Profile'}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {draftProfile.cognition !== undefined && (
              <div className="text-center p-2 rounded bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-700">
                <p className="text-xs text-blue-600 dark:text-blue-400 mb-1">
                  {language === 'zh' ? '认知' : 'Cog'}
                </p>
                <p className="text-lg font-bold text-blue-700 dark:text-blue-300">
                  {draftProfile.cognition}
                </p>
              </div>
            )}

            {draftProfile.affect !== undefined && (
              <div className="text-center p-2 rounded bg-purple-50 dark:bg-purple-950 border border-purple-200 dark:border-purple-700">
                <p className="text-xs text-purple-600 dark:text-purple-400 mb-1">
                  {language === 'zh' ? '情感' : 'Aff'}
                </p>
                <p className="text-lg font-bold text-purple-700 dark:text-purple-300">
                  {draftProfile.affect}
                </p>
              </div>
            )}

            {draftProfile.behavior !== undefined && (
              <div className="text-center p-2 rounded bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-700">
                <p className="text-xs text-green-600 dark:text-green-400 mb-1">
                  {language === 'zh' ? '行为' : 'Beh'}
                </p>
                <p className="text-lg font-bold text-green-700 dark:text-green-300">
                  {draftProfile.behavior}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 系统状态 */}
      <div className="glass-card p-5 hover:shadow-xl transition-all duration-300">
        <h4
          className="text-xs mb-2 font-semibold uppercase tracking-wider"
          style={{
            color: theme === 'light' ? '#404040' : '#cbd5e1',
          }}
        >
          {language === 'zh' ? '系统状态' : 'System Status'}
        </h4>
        <div className="flex items-center space-x-2">
          <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-lg shadow-emerald-500/50 animate-pulse"></span>
          <span
            className="text-sm font-medium"
            style={{
              color: theme === 'light' ? '#000000' : '#ffffff',
            }}
          >
            {language === 'zh' ? 'AI 引导进行中' : 'AI Guidance Active'}
          </span>
        </div>
        <p
          className="text-xs mt-2"
          style={{
            color: theme === 'light' ? '#6b7280' : '#cbd5e1',
          }}
        >
          {language === 'zh'
            ? '通过对话深入了解您的学习特征'
            : 'Understanding your learning profile through conversation'}
        </p>
      </div>
    </div>
  );
};
