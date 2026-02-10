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
}

export const Chat: React.FC<Props> = ({
  messages,
  onSendMessage,
  onUpdateProfile,
  language,
  isResearchMode
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
        userId: 'user123', // TODO: Get from auth context
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
      <div className="flex-1 flex flex-col bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        {/* Error Banner */}
        {error && (
          <div className="bg-rose-900/20 border-b border-rose-900/50 px-4 py-2 flex items-center gap-2 text-rose-400 text-sm">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6 space-y-6" ref={scrollRef}>
          {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-indigo-600' : 'bg-emerald-600'}`}>
                    {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                </div>
                <div className={`p-4 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'user'
                    ? 'bg-indigo-600/20 text-indigo-100 border border-indigo-500/30 rounded-tr-sm'
                    : 'bg-slate-800 text-slate-200 border border-slate-700 rounded-tl-sm'
                }`}>
                    {msg.text}
                </div>
              </div>
            </div>
          ))}
          {isTyping && (
             <div className="flex justify-start">
                 <div className="flex gap-3">
                    <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center shrink-0 animate-pulse">
                         <Bot size={16} />
                    </div>
                    <div className="bg-slate-800 p-4 rounded-2xl rounded-tl-sm flex space-x-1 items-center">
                        <div className="w-2 h-2 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '0ms'}}></div>
                        <div className="w-2 h-2 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '150ms'}}></div>
                        <div className="w-2 h-2 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '300ms'}}></div>
                    </div>
                 </div>
             </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="p-4 border-t border-slate-800 bg-slate-900">
            <div className="relative">
                <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={t.inputPlaceholder}
                    disabled={isTyping}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl py-3 pl-4 pr-12 text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors disabled:opacity-50"
                />
                <button
                    type="submit"
                    disabled={!input.trim() || isTyping}
                    className="absolute right-2 top-2 p-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    <Send size={18} />
                </button>
            </div>
        </form>
      </div>

      {/* Analysis Sidebar (Last Message Context) */}
      <div className="w-80 shrink-0 space-y-4">
        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">{t.turnAnalysis}</h3>

        {messages.filter(m => m.role === 'assistant' && m.analysis).slice(-1).map((msg) => (
             <div key={`analysis-${msg.id}`} className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 animate-in fade-in slide-in-from-right-4 duration-500">
                <div className="flex items-center space-x-2 text-indigo-400 mb-2">
                    <Sparkles size={16} />
                    <span className="font-semibold text-sm">{t.turnAnalysis}</span>
                </div>

                <div className="space-y-3">
                    <div>
                        <span className="text-xs text-slate-500 block mb-1">{t.detectedIntent}</span>
                        <span className="inline-block px-2 py-1 rounded bg-slate-800 border border-slate-700 text-xs text-slate-300 capitalize">
                            {msg.analysis?.intent}
                        </span>
                    </div>
                    <div>
                         <span className="text-xs text-slate-500 block mb-1">{t.emotionState}</span>
                         <span className="inline-block px-2 py-1 rounded bg-slate-800 border border-slate-700 text-xs text-slate-300 capitalize">
                            {msg.analysis?.emotion}
                         </span>
                    </div>
                    {msg.analysis?.detectedConcepts && msg.analysis.detectedConcepts.length > 0 && (
                      <div>
                        <span className="text-xs text-slate-500 block mb-1">检测到的概念</span>
                        <div className="flex flex-wrap gap-1">
                          {msg.analysis.detectedConcepts.map((concept: string, idx: number) => (
                            <span key={idx} className="inline-block px-2 py-1 rounded bg-emerald-950/30 border border-emerald-900 text-xs text-emerald-400">
                              {concept}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    <div>
                        <span className="text-xs text-slate-500 block mb-1">{t.profileImpact}</span>
                        <div className="grid grid-cols-3 gap-2">
                            {Object.entries(msg.analysis?.delta || {}).map(([key, val]) => (
                                <div key={key} className={`text-center p-1 rounded border text-xs ${
                                    (val as number) > 0
                                    ? 'bg-emerald-950/30 border-emerald-900 text-emerald-400'
                                    : (val as number) < 0
                                        ? 'bg-rose-950/30 border-rose-900 text-rose-400'
                                        : 'bg-slate-800 border-slate-700 text-slate-500'
                                }`}>
                                    {t[key as keyof typeof t]?.toString().substring(0,3)} {(val as number) > 0 ? '+' : ''}{val}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
             </div>
        ))}

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h4 className="text-xs text-slate-500 mb-2">{t.systemStatus}</h4>
            <div className="flex items-center space-x-2">
                <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
                <span className="text-sm text-slate-300">
                  {isTyping ? (language === 'zh' ? '正在生成回复...' : 'Generating response...') : t.trackingConcepts}
                </span>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              {language === 'zh'
                ? '使用 DeepSeek 模型进行智能分析和回复'
                : 'Using DeepSeek model for intelligent analysis and responses'}
            </p>
        </div>
      </div>
    </div>
  );
};
