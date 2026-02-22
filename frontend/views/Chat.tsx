import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage, Language, UserProfile } from '../types';
import { Send, Bot, User, Sparkles, AlertCircle } from 'lucide-react';
import { translations } from '../utils/translations';
import { sendChatMessage } from '../services/api';

interface Props {
  messages: ChatMessage[];
  onSendMessage: (text: string, role: 'user' | 'assistant', analysis?: any) => void;
  onUpdateProfile: (profile: UserProfile) => void;
  language: Language;
  isResearchMode: boolean;
  theme: 'light' | 'dark';
  userId?: string;
}

export const Chat: React.FC<Props> = ({
  messages,
  onSendMessage,
  onUpdateProfile,
  language,
  isResearchMode,
  theme,
  userId
}) => {
  const t = translations[language];
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userText = input;
    setInput('');
    setError(null);

    // Add user message immediately
    onSendMessage(userText, 'user');
    setIsTyping(true);

    try {
      // Call real backend API
      const response = await sendChatMessage({
        userId: userId || 'guest',
        message: userText,
        language,
        isResearchMode
      });

      // Add AI response with analysis
      onSendMessage(response.message, 'assistant', response.analysis);

      // Update profile with backend data
      onUpdateProfile(response.updatedProfile);

    } catch (err) {
      console.error('Failed to send message:', err);
      setError(err instanceof Error ? err.message : 'Failed to connect to backend');

      // Show error message in chat
      const errorMessage = language === 'zh'
        ? '抱歉，我现在无法回复。请稍后再试。'
        : 'Sorry, I cannot respond right now. Please try again later.';

      onSendMessage(errorMessage, 'assistant', {
        intent: 'error',
        emotion: 'neutral',
        detectedConcepts: [],
        delta: { cognition: 0, affect: 0, behavior: 0 }
      });
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-6">
      {/* Chat Area */}
      <div className="flex-1 flex flex-col glass-card overflow-hidden animate-fade-in">
        {/* Error Banner */}
        {error && (
          <div className="bg-rose-500/10 dark:bg-rose-900/40 border-b border-rose-300 dark:border-rose-700 px-4 py-2 flex items-center gap-2 text-rose-600 dark:text-rose-300 text-sm">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6 space-y-6" ref={scrollRef}>
          {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-scale-in`}>
              <div className={`max-w-[80%] flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-gradient-to-br from-indigo-500 to-purple-600' : 'bg-gradient-to-br from-emerald-500 to-green-600'} text-white shadow-lg`}>
                    {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                </div>
                <div className={`p-4 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap shadow-md transition-all duration-300 hover:shadow-lg ${
                    msg.role === 'user'
                    ? 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white rounded-tr-sm'
                    : 'rounded-tl-sm'
                }`} style={msg.role !== 'user' ? {
                  backgroundColor: theme === 'light' ? '#ffffff' : '#1e293b',
                  color: theme === 'light' ? '#000000' : '#ffffff',
                  border: `1px solid ${theme === 'light' ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)'}`
                } : {}}>
                    {msg.text}
                </div>
              </div>
            </div>
          ))}
          {isTyping && (
             <div className="flex justify-start animate-fade-in">
                 <div className="flex gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center shrink-0 animate-pulse text-white shadow-lg">
                         <Bot size={16} />
                    </div>
                    <div className="p-4 rounded-2xl rounded-tl-sm flex space-x-1 items-center shadow-md" style={{
                      backgroundColor: theme === 'light' ? '#ffffff' : '#1e293b',
                      border: `1px solid ${theme === 'light' ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)'}`
                    }}>
                        <div className="w-2 h-2 rounded-full animate-bounce" style={{
                          backgroundColor: theme === 'light' ? '#9ca3af' : '#64748b',
                          animationDelay: '0ms'
                        }}></div>
                        <div className="w-2 h-2 rounded-full animate-bounce" style={{
                          backgroundColor: theme === 'light' ? '#9ca3af' : '#64748b',
                          animationDelay: '150ms'
                        }}></div>
                        <div className="w-2 h-2 rounded-full animate-bounce" style={{
                          backgroundColor: theme === 'light' ? '#9ca3af' : '#64748b',
                          animationDelay: '300ms'
                        }}></div>
                    </div>
                 </div>
             </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="p-4" style={{
          borderTop: `1px solid ${theme === 'light' ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)'}`
        }}>
            <div className="relative">
                <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={t.inputPlaceholder}
                    disabled={isTyping}
                    className="w-full rounded-xl py-3 pl-4 pr-12 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all disabled:opacity-50 shadow-sm"
                    style={{
                      backgroundColor: theme === 'light' ? '#ffffff' : '#1e293b',
                      border: `1px solid ${theme === 'light' ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)'}`,
                      color: theme === 'light' ? '#000000' : '#ffffff'
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
        </form>
      </div>

      {/* Analysis Sidebar (Last Message Context) */}
      <div className="w-80 shrink-0 space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider mb-2" style={{
          color: theme === 'light' ? '#404040' : '#cbd5e1'
        }}>{t.turnAnalysis}</h3>

        {messages.filter(m => m.role === 'assistant' && m.analysis).slice(-1).map((msg) => (
             <div key={`analysis-${msg.id}`} className="glass-card p-5 space-y-4 animate-slide-in-right stagger-2 hover:shadow-xl transition-all duration-300">
                <div className="flex items-center space-x-2 text-indigo-500 dark:text-indigo-300 mb-2">
                    <Sparkles size={16} />
                    <span className="font-semibold text-sm">{t.turnAnalysis}</span>
                </div>

                <div className="space-y-3">
                    <div>
                        <span className="text-xs block mb-1" style={{
                          color: theme === 'light' ? '#404040' : '#cbd5e1'
                        }}>{t.detectedIntent}</span>
                        <span className="inline-block px-2 py-1 rounded text-xs capitalize shadow-sm" style={{
                          backgroundColor: theme === 'light' ? '#f3f4f6' : '#334155',
                          border: `1px solid ${theme === 'light' ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)'}`,
                          color: theme === 'light' ? '#000000' : '#ffffff'
                        }}>
                            {msg.analysis?.intent}
                        </span>
                    </div>
                    <div>
                         <span className="text-xs block mb-1" style={{
                          color: theme === 'light' ? '#404040' : '#cbd5e1'
                        }}>{t.emotionState}</span>
                         <span className="inline-block px-2 py-1 rounded text-xs capitalize shadow-sm" style={{
                          backgroundColor: theme === 'light' ? '#f3f4f6' : '#334155',
                          border: `1px solid ${theme === 'light' ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)'}`,
                          color: theme === 'light' ? '#000000' : '#ffffff'
                        }}>
                            {msg.analysis?.emotion}
                         </span>
                    </div>
                    {msg.analysis?.detectedConcepts && msg.analysis.detectedConcepts.length > 0 && (
                      <div>
                        <span className="text-xs block mb-1" style={{
                          color: theme === 'light' ? '#404040' : '#cbd5e1'
                        }}>检测到的概念</span>
                        <div className="flex flex-wrap gap-1">
                          {msg.analysis.detectedConcepts.map((concept: string, idx: number) => (
                            <span key={idx} className="inline-block px-2 py-1 rounded bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-700 text-xs text-emerald-700 dark:text-emerald-300 shadow-sm">
                              {concept}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    <div>
                        <span className="text-xs block mb-1" style={{
                          color: theme === 'light' ? '#404040' : '#cbd5e1'
                        }}>{t.profileImpact}</span>
                        <div className="grid grid-cols-3 gap-2">
                            {Object.entries(msg.analysis?.delta || {}).map(([key, val]) => (
                                <div key={key} className={`text-center p-1 rounded border text-xs ${
                                    (val as number) > 0
                                    ? 'bg-emerald-50 dark:bg-emerald-950 border-emerald-200 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300'
                                    : (val as number) < 0
                                        ? 'bg-rose-50 dark:bg-rose-950 border-rose-200 dark:border-rose-700 text-rose-700 dark:text-rose-300'
                                        : 'bg-gray-100 dark:bg-slate-700 border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-300'
                                }`}>
                                    {t[key as keyof typeof t]?.toString().substring(0,3)} {(val as number) > 0 ? '+' : ''}{val}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
             </div>
        ))}

        <div className="glass-card p-5 hover:shadow-xl transition-all duration-300">
            <h4 className="text-xs mb-2 font-semibold uppercase tracking-wider" style={{
              color: theme === 'light' ? '#404040' : '#cbd5e1'
            }}>{t.systemStatus}</h4>
            <div className="flex items-center space-x-2">
                <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-lg shadow-emerald-500/50 animate-pulse"></span>
                <span className="text-sm font-medium" style={{
                  color: theme === 'light' ? '#000000' : '#ffffff'
                }}>
                  {isTyping ? (language === 'zh' ? '正在生成回复...' : 'Generating response...') : t.trackingConcepts}
                </span>
            </div>
            <p className="text-xs mt-2" style={{
              color: theme === 'light' ? '#6b7280' : '#cbd5e1'
            }}>
              {language === 'zh'
                ? '使用 DeepSeek 模型进行智能分析和回复'
                : 'Using DeepSeek model for intelligent analysis and responses'}
            </p>
        </div>
      </div>
    </div>
  );
};
