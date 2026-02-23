import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage, Language, UserProfile } from '../types';
import { Send, Bot, User, Sparkles, AlertCircle, History, Plus, X, Clock, MessageSquare, ChevronDown, ChevronUp } from 'lucide-react';
import { translations } from '../utils/translations';
import { sendChatMessage, getChatGreeting, getChatSessions, getSessionMessages, ChatSession, SessionMessage } from '../services/api';

interface Props {
  messages: ChatMessage[];
  onSendMessage: (text: string, role: 'user' | 'assistant', analysis?: any) => void;
  onUpdateProfile: (profile: UserProfile) => void;
  language: Language;
  isResearchMode: boolean;
  theme: 'light' | 'dark';
  userId?: string;
  onNewConversation?: () => void;
}

export const Chat: React.FC<Props> = ({
  messages,
  onSendMessage,
  onUpdateProfile,
  language,
  isResearchMode,
  theme,
  userId,
  onNewConversation
}) => {
  const t = translations[language];
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latestProfile, setLatestProfile] = useState<UserProfile | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const greetingFetchedRef = useRef(false);

  // History panel state
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [selectedSession, setSelectedSession] = useState<{ session: ChatSession; messages: SessionMessage[] } | null>(null);

  // Fetch greeting on first load
  useEffect(() => {
    if (messages.length === 0 && userId && !greetingFetchedRef.current) {
      greetingFetchedRef.current = true;
      setIsTyping(true);
      getChatGreeting(userId, language)
        .then(({ message }) => {
          onSendMessage(message, 'assistant', {
            intent: 'greeting',
            emotion: 'neutral',
            detectedConcepts: [],
            delta: { cognition: 0, affect: 0, behavior: 0 },
          });
        })
        .catch(console.error)
        .finally(() => setIsTyping(false));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Load history sessions
  useEffect(() => {
    if (userId) {
      setSessionsLoading(true);
      getChatSessions(userId)
        .then(setSessions)
        .finally(() => setSessionsLoading(false));
    }
  }, [userId]);

  const refreshSessions = () => {
    if (userId) getChatSessions(userId).then(setSessions);
  };

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

    onSendMessage(userText, 'user');
    setIsTyping(true);

    try {
      const response = await sendChatMessage({
        userId: userId || 'guest',
        message: userText,
        language,
        isResearchMode
      });

      onSendMessage(response.message, 'assistant', response.analysis);
      onUpdateProfile(response.updatedProfile);
      setLatestProfile(response.updatedProfile);
      refreshSessions();

    } catch (err) {
      console.error('Failed to send message:', err);
      setError(err instanceof Error ? err.message : 'Failed to connect to backend');

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

  const handleViewSession = async (session: ChatSession) => {
    if (!userId) return;
    const msgs = await getSessionMessages(userId, session.sessionStart, session.sessionEnd);
    setSelectedSession({ session, messages: msgs });
  };

  const handleNewConversation = () => {
    setSelectedSession(null);
    onNewConversation?.();
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return d.toLocaleTimeString(language === 'zh' ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
      return language === 'zh' ? '昨天' : 'Yesterday';
    } else if (diffDays < 7) {
      return language === 'zh' ? `${diffDays}天前` : `${diffDays}d ago`;
    } else {
      return d.toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' });
    }
  };

  const cardBg = theme === 'light' ? '#ffffff' : '#1e293b';
  const cardBorder = `1px solid ${theme === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'}`;
  const textPrimary = theme === 'light' ? '#000000' : '#ffffff';
  const textSecondary = theme === 'light' ? '#404040' : '#cbd5e1';
  const textMuted = theme === 'light' ? '#6b7280' : '#94a3b8';
  const bgMuted = theme === 'light' ? '#f3f4f6' : '#334155';

  // Latest assistant message with analysis
  const latestAnalysis = [...messages].reverse().find(m => m.role === 'assistant' && m.analysis);

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-6">
      {/* Chat Area */}
      <div className="flex-1 flex flex-col glass-card overflow-hidden animate-fade-in">
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
                  backgroundColor: cardBg,
                  color: textPrimary,
                  border: cardBorder
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
                      backgroundColor: cardBg,
                      border: cardBorder
                    }}>
                        <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: textMuted, animationDelay: '0ms' }}></div>
                        <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: textMuted, animationDelay: '150ms' }}></div>
                        <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: textMuted, animationDelay: '300ms' }}></div>
                    </div>
                 </div>
             </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="p-4" style={{ borderTop: cardBorder }}>
            <div className="relative">
                <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={t.inputPlaceholder}
                    disabled={isTyping}
                    className="w-full rounded-xl py-3 pl-4 pr-12 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all disabled:opacity-50 shadow-sm"
                    style={{ backgroundColor: cardBg, border: cardBorder, color: textPrimary }}
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

      {/* Right Sidebar — scrollable column, no tabs */}
      <div className="w-80 shrink-0 flex flex-col gap-3 overflow-y-auto">

        {/* New Conversation Button */}
        <button
          onClick={handleNewConversation}
          className="w-full shrink-0 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 text-white text-sm font-semibold shadow hover:shadow-lg hover:shadow-emerald-500/30 transition-all active:scale-95"
        >
          <Plus size={16} />
          {t.newConversation}
        </button>

        {/* Live Analysis Card */}
        <div className="glass-card p-4 shrink-0 space-y-3 animate-slide-in-right">
          <div className="flex items-center gap-2 text-indigo-500 dark:text-indigo-300">
            <Sparkles size={14} />
            <span className="font-semibold text-sm">{t.turnAnalysis}</span>
          </div>

          {latestAnalysis?.analysis ? (
            <div className="space-y-2.5">
              <div>
                <span className="text-xs block mb-1" style={{ color: textSecondary }}>{t.detectedIntent}</span>
                <span className="inline-block px-2 py-1 rounded text-xs capitalize shadow-sm" style={{ backgroundColor: bgMuted, border: cardBorder, color: textPrimary }}>
                  {latestAnalysis.analysis.intent}
                </span>
              </div>
              <div>
                <span className="text-xs block mb-1" style={{ color: textSecondary }}>{t.emotionState}</span>
                <span className="inline-block px-2 py-1 rounded text-xs capitalize shadow-sm" style={{ backgroundColor: bgMuted, border: cardBorder, color: textPrimary }}>
                  {latestAnalysis.analysis.emotion}
                </span>
              </div>
              {latestAnalysis.analysis.detectedConcepts && latestAnalysis.analysis.detectedConcepts.length > 0 && (
                <div>
                  <span className="text-xs block mb-1" style={{ color: textSecondary }}>
                    {language === 'zh' ? '检测到的概念' : 'Detected Concepts'}
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {latestAnalysis.analysis.detectedConcepts.map((concept: string, idx: number) => (
                      <span key={idx} className="inline-block px-2 py-1 rounded bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-700 text-xs text-emerald-700 dark:text-emerald-300 shadow-sm">
                        {concept}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <span className="text-xs block mb-1" style={{ color: textSecondary }}>{t.profileImpact}</span>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['cognition', 'affect', 'behavior'] as const).map((key) => {
                    const delta = (latestAnalysis.analysis.delta as Record<string, number>)?.[key] ?? 0;
                    const absVal = latestProfile?.[key];
                    const label = language === 'zh'
                      ? { cognition: '认知', affect: '情感', behavior: '行为' }[key]
                      : key.slice(0, 3);
                    return (
                      <div key={key} className={`text-center p-1.5 rounded border text-xs ${
                        delta > 0
                          ? 'bg-emerald-50 dark:bg-emerald-950 border-emerald-200 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300'
                          : delta < 0
                            ? 'bg-rose-50 dark:bg-rose-950 border-rose-200 dark:border-rose-700 text-rose-700 dark:text-rose-300'
                            : 'bg-gray-100 dark:bg-slate-700 border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-300'
                      }`}>
                        <div className="font-medium">{label}</div>
                        {absVal !== undefined && (
                          <div className="font-bold text-sm">{absVal}</div>
                        )}
                        <div className="opacity-80">{delta > 0 ? '+' : ''}{delta}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs" style={{ color: textMuted }}>
              {language === 'zh' ? '发送消息后查看实时分析' : 'Send a message to see live analysis'}
            </p>
          )}

          {/* System status */}
          <div className="pt-2 flex items-center gap-2" style={{ borderTop: cardBorder }}>
            <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-lg shadow-emerald-500/50 animate-pulse shrink-0" />
            <span className="text-xs" style={{ color: textMuted }}>
              {isTyping
                ? (language === 'zh' ? '正在生成回复...' : 'Generating...')
                : t.trackingConcepts}
            </span>
          </div>
        </div>

        {/* Conversation History Card */}
        <div className="glass-card flex flex-col animate-slide-in-right" style={{ minHeight: 0 }}>
          {/* Header — clickable to expand/collapse */}
          <button
            onClick={() => setHistoryExpanded(prev => !prev)}
            className="flex items-center justify-between px-4 py-3 w-full text-left hover:opacity-80 transition-opacity"
            style={{ borderBottom: historyExpanded ? cardBorder : 'none' }}
          >
            <div className="flex items-center gap-2">
              <History size={14} style={{ color: textMuted }} />
              <span className="text-sm font-semibold" style={{ color: textPrimary }}>{t.chatHistory}</span>
              {sessions.length > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ backgroundColor: bgMuted, color: textMuted }}>
                  {sessions.length}
                </span>
              )}
            </div>
            {historyExpanded ? <ChevronUp size={14} style={{ color: textMuted }} /> : <ChevronDown size={14} style={{ color: textMuted }} />}
          </button>

          {historyExpanded && (
            <div className="flex flex-col overflow-hidden" style={{ maxHeight: '360px' }}>
              {/* Inline session viewer */}
              {selectedSession && (
                <div className="flex flex-col" style={{ maxHeight: '360px' }}>
                  <div className="flex items-center justify-between px-3 py-2 shrink-0" style={{ borderBottom: cardBorder }}>
                    <span className="text-xs font-semibold truncate flex-1" style={{ color: textPrimary }}>
                      {selectedSession.session.title}
                    </span>
                    <button onClick={() => setSelectedSession(null)} className="shrink-0 ml-2 hover:opacity-70 transition-opacity">
                      <X size={13} style={{ color: textMuted }} />
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-3 space-y-2">
                    {selectedSession.messages.map((msg) => (
                      <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[90%] px-3 py-2 rounded-xl text-xs leading-relaxed ${
                          msg.role === 'user'
                            ? 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white rounded-tr-sm'
                            : 'rounded-tl-sm'
                        }`} style={msg.role !== 'user' ? { backgroundColor: bgMuted, color: textPrimary, border: cardBorder } : {}}>
                          {msg.text}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Session list */}
              {!selectedSession && (
                <div className="overflow-y-auto p-2 space-y-1.5">
                  {sessionsLoading && (
                    <div className="text-center py-6 text-sm" style={{ color: textMuted }}>
                      {t.loading}
                    </div>
                  )}
                  {!sessionsLoading && sessions.length === 0 && (
                    <div className="text-center py-8 space-y-2">
                      <MessageSquare size={28} className="mx-auto opacity-30" style={{ color: textMuted }} />
                      <p className="text-xs" style={{ color: textMuted }}>{t.noHistory}</p>
                    </div>
                  )}
                  {sessions.map((session, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleViewSession(session)}
                      className="w-full text-left rounded-lg p-2.5 space-y-1 hover:opacity-80 transition-all duration-150 active:scale-[0.98]"
                      style={{ backgroundColor: bgMuted, border: cardBorder }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-semibold line-clamp-1 flex-1" style={{ color: textPrimary }}>
                          {session.title}
                        </span>
                        <span className="text-xs shrink-0 flex items-center gap-0.5" style={{ color: textMuted }}>
                          <Clock size={9} />
                          {formatTime(session.sessionStart)}
                        </span>
                      </div>
                      <p className="text-xs line-clamp-1" style={{ color: textSecondary }}>
                        {session.preview}
                      </p>
                      <span className="text-xs" style={{ color: textMuted }}>
                        {session.messageCount} {t.messagesCount}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
