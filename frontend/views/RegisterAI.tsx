import React, { useState, useRef, useEffect } from 'react';
import { Language, UserProfile } from '../types';
import { Bot, User, Send, ArrowLeft, CheckCircle, Sparkles } from 'lucide-react';
import { translations } from '../utils/translations';
import { startAIOnboarding, stepAIOnboarding, finishAIOnboarding } from '../services/api';

interface Message {
  role: 'ai' | 'user';
  text: string;
}

interface Props {
  language: Language;
  onComplete: (initialProfile: UserProfile, attributes: string[], conceptSeeds: string[]) => void;
  onBack: () => void;
}

export const RegisterAI: React.FC<Props> = ({ language, onComplete, onBack }) => {
  const t = translations[language];
  const scrollRef = useRef<HTMLDivElement>(null);

  // State management
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<string | null>(null);
  const [sessionSummary, setSessionSummary] = useState<string>('');
  const [draftProfile, setDraftProfile] = useState<Partial<UserProfile> | null>(null);
  const [userAnswer, setUserAnswer] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isThinking]);

  // Start session on mount
  useEffect(() => {
    const initSession = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await startAIOnboarding();
        if (response.success && response.data) {
          setSessionId(response.data.sessionId);
          setCurrentQuestion(response.data.question);
          setSessionSummary(response.data.summary);
          setMessages([{ role: 'ai', text: response.data.question }]);
        } else {
          throw new Error(response.error?.message || 'Failed to start session');
        }
      } catch (err) {
        console.error('Failed to start AI onboarding:', err);
        setError(err instanceof Error ? err.message : 'Failed to start AI onboarding');
      } finally {
        setIsLoading(false);
      }
    };

    initSession();
  }, []);

  // Handle sending answer
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userAnswer.trim() || !sessionId || isThinking) return;

    const answer = userAnswer;
    setUserAnswer('');
    setError(null);

    // Add user message immediately
    setMessages(prev => [...prev, { role: 'user', text: answer }]);
    setIsThinking(true);

    try {
      const response = await stepAIOnboarding({ sessionId, answer });

      if (response.success && response.data) {
        setSessionSummary(response.data.summary);

        if (response.data.draftProfile) {
          setDraftProfile(response.data.draftProfile);
        }

        if (response.data.isComplete) {
          setIsComplete(true);
          setCurrentQuestion(null);

          // Add completion message
          const completionMessage = language === 'zh'
            ? '太好了！我们已经收集到足够的信息。您可以查看右侧的草稿画像，确认无误后点击"完成注册"按钮。'
            : 'Great! We have collected enough information. You can review the draft profile on the right and click "Complete Registration" when ready.';
          setMessages(prev => [...prev, { role: 'ai', text: completionMessage }]);
        } else if (response.data.question) {
          setCurrentQuestion(response.data.question);
          setMessages(prev => [...prev, { role: 'ai', text: response.data.question! }]);
        }
      } else {
        throw new Error(response.error?.message || 'Failed to process answer');
      }
    } catch (err) {
      console.error('Failed to send answer:', err);
      setError(err instanceof Error ? err.message : 'Failed to send answer');

      const errorMessage = language === 'zh'
        ? '抱歉，出现了一些问题。请重试。'
        : 'Sorry, something went wrong. Please try again.';
      setMessages(prev => [...prev, { role: 'ai', text: errorMessage }]);
    } finally {
      setIsThinking(false);
    }
  };

  // Handle completion
  const handleComplete = async () => {
    if (!sessionId || isCompleting) return;

    setIsCompleting(true);
    setError(null);

    try {
      const response = await finishAIOnboarding(sessionId);

      if (response.success && response.data) {
        onComplete(
          response.data.initialProfile,
          response.data.attributes,
          response.data.conceptSeeds
        );
      } else {
        throw new Error(response.error?.message || 'Failed to complete onboarding');
      }
    } catch (err) {
      console.error('Failed to complete onboarding:', err);
      setError(err instanceof Error ? err.message : 'Failed to complete onboarding');
      setIsCompleting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">{t.loading}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <button
              onClick={onBack}
              className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors mb-2"
            >
              <ArrowLeft size={20} />
              <span>{t.back}</span>
            </button>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
              {t.aiOnboarding}
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">
              {t.aiOnboardingDesc}
            </p>
          </div>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="mb-4 bg-rose-500/10 dark:bg-rose-900/40 border border-rose-300 dark:border-rose-700 px-4 py-3 rounded-lg text-rose-600 dark:text-rose-300">
            {error}
          </div>
        )}

        {/* Main Content */}
        <div className="flex gap-6">
          {/* Chat Area */}
          <div className="flex-1 flex flex-col glass-card overflow-hidden animate-fade-in" style={{ height: 'calc(100vh - 240px)' }}>
            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6" ref={scrollRef}>
              {messages.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-scale-in`}>
                  <div className={`max-w-[80%] flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                      msg.role === 'user'
                        ? 'bg-gradient-to-br from-indigo-500 to-purple-600'
                        : 'bg-gradient-to-br from-emerald-500 to-green-600'
                    } text-white shadow-lg`}>
                      {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                    </div>
                    <div className={`p-4 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap shadow-md transition-all duration-300 hover:shadow-lg ${
                      msg.role === 'user'
                        ? 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white rounded-tr-sm'
                        : 'bg-white dark:bg-slate-800 text-gray-900 dark:text-white border border-gray-200 dark:border-slate-700 rounded-tl-sm'
                    }`}>
                      {msg.text}
                    </div>
                  </div>
                </div>
              ))}

              {/* Thinking indicator */}
              {isThinking && (
                <div className="flex justify-start animate-fade-in">
                  <div className="flex gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center shrink-0 animate-pulse text-white shadow-lg">
                      <Bot size={16} />
                    </div>
                    <div className="p-4 rounded-2xl rounded-tl-sm flex space-x-1 items-center shadow-md bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700">
                      <div className="w-2 h-2 rounded-full bg-gray-400 dark:bg-slate-500 animate-bounce" style={{ animationDelay: '0ms' }}></div>
                      <div className="w-2 h-2 rounded-full bg-gray-400 dark:bg-slate-500 animate-bounce" style={{ animationDelay: '150ms' }}></div>
                      <div className="w-2 h-2 rounded-full bg-gray-400 dark:bg-slate-500 animate-bounce" style={{ animationDelay: '300ms' }}></div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Input Area */}
            <form onSubmit={handleSubmit} className="p-4 border-t border-gray-200 dark:border-slate-700">
              <div className="relative">
                <input
                  type="text"
                  value={userAnswer}
                  onChange={(e) => setUserAnswer(e.target.value)}
                  placeholder={t.answerPlaceholder}
                  disabled={isThinking || isComplete}
                  className="w-full rounded-xl py-3 pl-4 pr-12 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all disabled:opacity-50 shadow-sm"
                />
                <button
                  type="submit"
                  disabled={!userAnswer.trim() || isThinking || isComplete}
                  className="absolute right-2 top-2 p-1.5 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-lg hover:shadow-lg hover:shadow-indigo-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 active:scale-95"
                >
                  <Send size={18} />
                </button>
              </div>
            </form>
          </div>

          {/* Sidebar */}
          <div className="w-80 shrink-0 space-y-4">
            {/* Session Summary */}
            <div className="glass-card p-5 animate-slide-in-right">
              <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 mb-3">
                <Sparkles size={16} />
                <h3 className="font-semibold text-sm">{t.sessionSummary}</h3>
              </div>
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                {sessionSummary || (language === 'zh' ? '对话刚刚开始...' : 'Session just started...')}
              </p>
            </div>

            {/* Draft Profile */}
            {draftProfile && (
              <div className="glass-card p-5 animate-slide-in-right stagger-1">
                <div className="flex items-center gap-2 text-purple-600 dark:text-purple-400 mb-3">
                  <User size={16} />
                  <h3 className="font-semibold text-sm">{t.draftProfile}</h3>
                </div>
                <div className="space-y-3">
                  {draftProfile.cognition !== undefined && (
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-xs text-gray-600 dark:text-gray-400">{t.cognition}</span>
                        <span className="text-sm font-semibold text-gray-900 dark:text-white">{draftProfile.cognition}</span>
                      </div>
                      <div className="h-2 bg-gray-200 dark:bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-blue-500 to-indigo-600 transition-all duration-500"
                          style={{ width: `${draftProfile.cognition}%` }}
                        ></div>
                      </div>
                    </div>
                  )}
                  {draftProfile.affect !== undefined && (
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-xs text-gray-600 dark:text-gray-400">{t.affect}</span>
                        <span className="text-sm font-semibold text-gray-900 dark:text-white">{draftProfile.affect}</span>
                      </div>
                      <div className="h-2 bg-gray-200 dark:bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-pink-500 to-rose-600 transition-all duration-500"
                          style={{ width: `${draftProfile.affect}%` }}
                        ></div>
                      </div>
                    </div>
                  )}
                  {draftProfile.behavior !== undefined && (
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-xs text-gray-600 dark:text-gray-400">{t.behavior}</span>
                        <span className="text-sm font-semibold text-gray-900 dark:text-white">{draftProfile.behavior}</span>
                      </div>
                      <div className="h-2 bg-gray-200 dark:bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-500 to-green-600 transition-all duration-500"
                          style={{ width: `${draftProfile.behavior}%` }}
                        ></div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Complete Button */}
            {isComplete && (
              <button
                onClick={handleComplete}
                disabled={isCompleting}
                className="w-full glass-card p-5 animate-slide-in-right stagger-2 hover:shadow-xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed group"
              >
                <div className="flex items-center justify-center gap-3">
                  <CheckCircle
                    size={24}
                    className="text-emerald-600 dark:text-emerald-400 group-hover:scale-110 transition-transform"
                  />
                  <div className="text-left">
                    <div className="font-semibold text-gray-900 dark:text-white">
                      {isCompleting ? t.completingOnboarding : t.completeOnboarding}
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">
                      {language === 'zh' ? '点击确认并进入系统' : 'Click to confirm and enter system'}
                    </div>
                  </div>
                </div>
              </button>
            )}

            {/* System Status */}
            <div className="glass-card p-5 hover:shadow-xl transition-all duration-300">
              <h4 className="text-xs mb-2 font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400">
                {t.systemStatus}
              </h4>
              <div className="flex items-center space-x-2">
                <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-lg shadow-emerald-500/50 animate-pulse"></span>
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  {isThinking
                    ? (language === 'zh' ? 'AI 正在思考...' : 'AI is thinking...')
                    : (language === 'zh' ? '等待您的回答' : 'Waiting for your answer')}
                </span>
              </div>
              <p className="text-xs mt-2 text-gray-600 dark:text-gray-400">
                {language === 'zh'
                  ? 'AI 引导式对话，深入了解您的学习特征'
                  : 'AI-guided conversation to deeply understand your learning characteristics'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
