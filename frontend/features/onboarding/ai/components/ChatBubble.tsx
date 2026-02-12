/**
 * ChatBubble - 聊天气泡组件
 * 完全复用 Chat.tsx 的样式，确保 UI 一致性
 */

import React from 'react';
import { Bot, User } from 'lucide-react';
import type { AiMessage } from '../types';

export interface ChatBubbleProps {
  message: AiMessage;
  theme?: 'light' | 'dark';
}

/**
 * 单个聊天气泡组件
 * 样式完全复用 views/Chat.tsx (第 97-114 行)
 */
export const ChatBubble: React.FC<ChatBubbleProps> = ({
  message,
  theme = 'light',
}) => {
  const isUser = message.role === 'user';

  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'} animate-scale-in`}
    >
      <div
        className={`max-w-[80%] flex gap-3 ${
          isUser ? 'flex-row-reverse' : 'flex-row'
        }`}
      >
        {/* 头像 */}
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
            isUser
              ? 'bg-gradient-to-br from-indigo-500 to-purple-600'
              : 'bg-gradient-to-br from-emerald-500 to-green-600'
          } text-white shadow-lg`}
        >
          {isUser ? <User size={16} /> : <Bot size={16} />}
        </div>

        {/* 消息气泡 */}
        <div
          className={`p-4 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap shadow-md transition-all duration-300 hover:shadow-lg ${
            isUser
              ? 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white rounded-tr-sm'
              : 'rounded-tl-sm'
          }`}
          style={
            !isUser
              ? {
                  backgroundColor: theme === 'light' ? '#ffffff' : '#1e293b',
                  color: theme === 'light' ? '#000000' : '#ffffff',
                  border: `1px solid ${
                    theme === 'light'
                      ? 'rgba(0, 0, 0, 0.1)'
                      : 'rgba(255, 255, 255, 0.1)'
                  }`,
                }
              : {}
          }
        >
          {message.text}
        </div>
      </div>
    </div>
  );
};

/**
 * 打字指示器组件（AI 正在思考）
 * 样式复用 views/Chat.tsx (第 116-141 行)
 */
export const TypingIndicator: React.FC<{ theme?: 'light' | 'dark' }> = ({
  theme = 'light',
}) => {
  return (
    <div className="flex justify-start animate-fade-in">
      <div className="flex gap-3">
        {/* AI 头像 */}
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center shrink-0 animate-pulse text-white shadow-lg">
          <Bot size={16} />
        </div>

        {/* 动画点点点 */}
        <div
          className="p-4 rounded-2xl rounded-tl-sm flex space-x-1 items-center shadow-md"
          style={{
            backgroundColor: theme === 'light' ? '#ffffff' : '#1e293b',
            border: `1px solid ${
              theme === 'light'
                ? 'rgba(0, 0, 0, 0.1)'
                : 'rgba(255, 255, 255, 0.1)'
            }`,
          }}
        >
          <div
            className="w-2 h-2 rounded-full animate-bounce"
            style={{
              backgroundColor: theme === 'light' ? '#9ca3af' : '#64748b',
              animationDelay: '0ms',
            }}
          ></div>
          <div
            className="w-2 h-2 rounded-full animate-bounce"
            style={{
              backgroundColor: theme === 'light' ? '#9ca3af' : '#64748b',
              animationDelay: '150ms',
            }}
          ></div>
          <div
            className="w-2 h-2 rounded-full animate-bounce"
            style={{
              backgroundColor: theme === 'light' ? '#9ca3af' : '#64748b',
              animationDelay: '300ms',
            }}
          ></div>
        </div>
      </div>
    </div>
  );
};
