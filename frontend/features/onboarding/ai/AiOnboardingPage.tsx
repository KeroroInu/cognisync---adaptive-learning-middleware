/**
 * AiOnboardingPage - AI 引导注册流程主页面
 * 功能：自动 start → 对话 step → finish → 显示结果 → 更新画像
 */

import React, { useState, useEffect, useRef } from 'react';
import { Send, Loader, CheckCircle, AlertCircle, ArrowLeft, SkipForward } from 'lucide-react';
import { Button } from '../../../components/Button';
import { RadarDisplay } from '../../../components/RadarDisplay';
import { useAuth } from '../../auth/hooks';
import { startAiOnboarding, stepAiOnboarding, finishAiOnboarding } from './api';
import { ChatBubble, TypingIndicator } from './components/ChatBubble';
import { SummaryPanel } from './components/SummaryPanel';
import { OnboardingStepper } from './components/OnboardingStepper';
import type {
  AiMessage,
  ConfirmedInfo,
  DraftProfile,
  InitialProfile,
  AiOnboardingStatus,
  UserAttributes,
  ConceptSeed,
} from './types';
import type { Language } from '../../../types';

export interface AiOnboardingPageProps {
  language?: Language;
  onComplete: () => void; // 完成后跳转
  onBack?: () => void; // 返回上一步
}

export const AiOnboardingPage: React.FC<AiOnboardingPageProps> = ({
  language = 'zh',
  onComplete,
  onBack,
}) => {
  // 认证状态
  const { updateProfile } = useAuth();

  // 页面状态
  const [status, setStatus] = useState<AiOnboardingStatus>('initializing');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [summary, setSummary] = useState<ConfirmedInfo[]>([]);
  const [draftProfile, setDraftProfile] = useState<DraftProfile | null>(null);
  const [initialProfile, setInitialProfile] = useState<InitialProfile | null>(null);
  const [userAttributes, setUserAttributes] = useState<UserAttributes | null>(null);
  const [conceptSeeds, setConceptSeeds] = useState<ConceptSeed[]>([]);

  // 输入和交互状态
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  // 滚动引用
  const scrollRef = useRef<HTMLDivElement>(null);

  // 主题（可以从全局获取，这里简化为 light）
  const theme = 'light';

  /**
   * 自动滚动到底部
   */
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  /**
   * 页面进入时自动 start
   */
  useEffect(() => {
    const initialize = async () => {
      setStatus('initializing');
      setApiError(null);

      try {
        const response = await startAiOnboarding();

        // 保存会话 ID
        setSessionId(response.sessionId);

        // 添加第一个 AI 问题
        setMessages([
          {
            id: '1',
            role: 'assistant',
            text: response.question,
            timestamp: new Date().toISOString(),
          },
        ]);

        // 更新摘要
        setSummary(response.summary);

        // 切换到对话状态
        setStatus('chatting');
      } catch (error: any) {
        setApiError(error.message || '启动引导失败');
        setStatus('error');
      }
    };

    initialize();
  }, []);

  /**
   * 添加消息
   */
  const addMessage = (role: 'user' | 'assistant', text: string) => {
    const newMessage: AiMessage = {
      id: `${Date.now()}-${Math.random()}`,
      role,
      text,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, newMessage]);
  };

  /**
   * 提交用户回答
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !sessionId || status !== 'chatting') return;

    const userAnswer = input.trim();
    setInput('');
    setApiError(null);

    // 添加用户消息
    addMessage('user', userAnswer);

    // 显示打字指示器
    setIsTyping(true);

    try {
      // 调用 step API
      const response = await stepAiOnboarding({
        sessionId,
        answer: userAnswer,
      });

      // 更新摘要
      setSummary(response.summary);

      // 更新草稿画像（如果有）
      if (response.draftProfile) {
        setDraftProfile(response.draftProfile);
      }

      // 判断是否结束
      if (response.status === 'done' || response.question === null) {
        // 需要调用 finish
        await handleFinish();
      } else {
        // 添加下一个问题
        addMessage('assistant', response.question!);
      }
    } catch (error: any) {
      setApiError(error.message || '提交失败');
      addMessage(
        'assistant',
        language === 'zh'
          ? '抱歉，我现在无法回复。请稍后再试。'
          : 'Sorry, I cannot respond right now. Please try again later.'
      );
    } finally {
      setIsTyping(false);
    }
  };

  /**
   * 跳过当前问题（MVP 功能）
   */
  const handleSkip = async () => {
    if (!sessionId || status !== 'chatting') return;

    const skipAnswer = language === 'zh' ? '跳过' : 'Skip';
    setApiError(null);

    // 添加用户消息
    addMessage('user', skipAnswer);

    // 显示打字指示器
    setIsTyping(true);

    try {
      // 调用 step API
      const response = await stepAiOnboarding({
        sessionId,
        answer: skipAnswer,
      });

      // 更新摘要
      setSummary(response.summary);

      // 更新草稿画像
      if (response.draftProfile) {
        setDraftProfile(response.draftProfile);
      }

      // 判断是否结束
      if (response.status === 'done' || response.question === null) {
        await handleFinish();
      } else {
        addMessage('assistant', response.question!);
      }
    } catch (error: any) {
      setApiError(error.message || '跳过失败');
    } finally {
      setIsTyping(false);
    }
  };

  /**
   * 完成引导，生成最终画像
   */
  const handleFinish = async () => {
    if (!sessionId) return;

    setStatus('finishing');
    setIsTyping(true);

    try {
      const response = await finishAiOnboarding({ sessionId });

      // 保存结果
      setInitialProfile(response.initialProfile);
      setUserAttributes(response.attributes);
      setConceptSeeds(response.conceptSeeds);

      // 更新全局 profile
      updateProfile(response.initialProfile);

      // 保存 attributes 和 conceptSeeds 到本地（可以存到 authStore.userMeta）
      // 这里简化为 localStorage
      localStorage.setItem('userAttributes', JSON.stringify(response.attributes));
      localStorage.setItem('conceptSeeds', JSON.stringify(response.conceptSeeds));

      // 切换到完成状态
      setStatus('completed');
    } catch (error: any) {
      setApiError(error.message || '完成引导失败');
      setStatus('chatting');
    } finally {
      setIsTyping(false);
    }
  };

  /**
   * 渲染初始化中
   */
  const renderInitializing = () => (
    <div className="min-h-screen flex items-center justify-center gradient-mesh p-4">
      <div className="glass-card p-8 rounded-2xl max-w-md w-full text-center">
        <Loader className="w-12 h-12 text-indigo-500 animate-spin mx-auto mb-4" />
        <p className="text-gray-700 dark:text-gray-300">
          {language === 'zh' ? '启动 AI 引导中...' : 'Starting AI Guidance...'}
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
            {language === 'zh' ? '启动失败' : 'Failed to Start'}
          </h2>
        </div>
        <p className="text-gray-600 dark:text-gray-400 mb-6">{apiError}</p>
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
   * 渲染对话中
   */
  const renderChatting = () => (
    <div className="min-h-screen gradient-mesh p-4 py-8">
      <div className="max-w-7xl mx-auto">
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
            {language === 'zh' ? 'AI 引导注册' : 'AI-Guided Registration'}
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            {language === 'zh'
              ? '通过对话深入了解您的学习特征'
              : 'Understanding your learning profile through conversation'}
          </p>
        </div>

        {/* 主体区域 */}
        <div className="flex gap-6">
          {/* 聊天区域（左侧） */}
          <div className="flex-1 flex flex-col glass-card overflow-hidden animate-fade-in">
            {/* API 错误提示 */}
            {apiError && (
              <div className="bg-rose-500/10 dark:bg-rose-900/40 border-b border-rose-300 dark:border-rose-700 px-4 py-2 flex items-center gap-2 text-rose-600 dark:text-rose-300 text-sm">
                <AlertCircle size={16} />
                <span>{apiError}</span>
              </div>
            )}

            {/* 消息列表 */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6" ref={scrollRef}>
              {messages.map((msg) => (
                <ChatBubble key={msg.id} message={msg} theme={theme} />
              ))}
              {isTyping && <TypingIndicator theme={theme} />}
            </div>

            {/* 输入区域 */}
            <form
              onSubmit={handleSubmit}
              className="p-4"
              style={{
                borderTop: `1px solid ${
                  theme === 'light' ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)'
                }`,
              }}
            >
              <div className="flex items-center gap-2">
                {/* 跳过按钮 */}
                <button
                  type="button"
                  onClick={handleSkip}
                  disabled={isTyping}
                  className="px-3 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                  title={language === 'zh' ? '跳过此问题' : 'Skip this question'}
                >
                  <SkipForward size={16} />
                  <span className="hidden md:inline">
                    {language === 'zh' ? '跳过' : 'Skip'}
                  </span>
                </button>

                {/* 输入框 */}
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={
                      language === 'zh' ? '输入您的回答...' : 'Type your answer...'
                    }
                    disabled={isTyping}
                    className="w-full rounded-xl py-3 pl-4 pr-12 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all disabled:opacity-50 shadow-sm"
                    style={{
                      backgroundColor: theme === 'light' ? '#ffffff' : '#1e293b',
                      border: `1px solid ${
                        theme === 'light' ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)'
                      }`,
                      color: theme === 'light' ? '#000000' : '#ffffff',
                    }}
                  />
                  <button
                    type="submit"
                    disabled={!input.trim() || isTyping}
                    className="absolute right-2 top-2 p-1.5 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-lg hover:shadow-lg hover:shadow-indigo-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 active:scale-95"
                  >
                    <Send size={18} />
                  </button>
                </div>
              </div>
            </form>
          </div>

          {/* 右侧面板 */}
          <div className="w-80 shrink-0 space-y-4">
            {/* 步骤指示器 */}
            <OnboardingStepper currentStep={messages.filter(m => m.role === 'user').length} language={language} theme={theme} />

            {/* 摘要面板 */}
            <SummaryPanel summary={summary} draftProfile={draftProfile} language={language} theme={theme} />
          </div>
        </div>
      </div>
    </div>
  );

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
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white mb-4 shadow-lg">
              <CheckCircle className="w-8 h-8" />
            </div>
            <h1 className="text-3xl font-bold text-gradient mb-2">
              {language === 'zh' ? '注册完成！' : 'Registration Complete!'}
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              {language === 'zh'
                ? '您的个性化学习画像已生成'
                : 'Your personalized learning profile has been generated'}
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
                <p className="text-2xl font-bold text-violet-500 dark:text-violet-300">
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
                ? '系统已根据您的回答生成个性化画像，并将在学习过程中不断优化。'
                : 'The system has generated a personalized profile based on your answers and will continuously optimize during learning.'}
            </p>
          </div>

          {/* 进入系统按钮 */}
          <Button variant="primary" size="lg" onClick={onComplete} className="w-full">
            {language === 'zh' ? '进入系统' : 'Enter System'}
          </Button>
        </div>
      </div>
    );
  };

  // 根据状态渲染
  if (status === 'initializing') {
    return renderInitializing();
  }

  if (status === 'error') {
    return renderError();
  }

  if (status === 'completed') {
    return renderCompleted();
  }

  return renderChatting();
};
