import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage, Language, UserProfile } from '../types';
import {
  Send,
  Bot,
  User,
  Sparkles,
  AlertCircle,
  History,
  Plus,
  X,
  Clock,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Activity,
} from 'lucide-react';
import { translations } from '../utils/translations';
import {
  sendChatMessage,
  getChatGreeting,
  getChatSessions,
  getSessionMessages,
  ChatSession,
  SessionMessage,
} from '../services/api';
import { SpotlightCard } from '../components/SpotlightCard';

interface Props {
  messages: ChatMessage[];
  profile: UserProfile;
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
  profile,
  onSendMessage,
  onUpdateProfile,
  language,
  isResearchMode,
  userId,
  onNewConversation,
}) => {
  const t = translations[language];
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latestProfile, setLatestProfile] = useState<UserProfile | null>(profile);
  const [profileBeforeLatest, setProfileBeforeLatest] = useState<UserProfile | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const greetingFetchedRef = useRef(false);

  const [historyExpanded, setHistoryExpanded] = useState(true);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [selectedSession, setSelectedSession] = useState<{ session: ChatSession; messages: SessionMessage[] } | null>(null);

  useEffect(() => {
    if (messages.length === 0 && userId && !greetingFetchedRef.current) {
      greetingFetchedRef.current = true;
      setIsTyping(true);
      getChatGreeting(language)
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

  useEffect(() => {
    if (userId) {
      setSessionsLoading(true);
      getChatSessions()
        .then(setSessions)
        .finally(() => setSessionsLoading(false));
    }
  }, [userId]);

  const refreshSessions = () => {
    if (userId) getChatSessions().then(setSessions);
  };

  useEffect(() => {
    setLatestProfile(profile);
  }, [profile]);

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
    const baselineProfile = latestProfile ?? profile;
    setProfileBeforeLatest(baselineProfile);

    try {
      const response = await sendChatMessage({
        userId: userId || 'guest',
        message: userText,
        language,
        isResearchMode,
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
        delta: { cognition: 0, affect: 0, behavior: 0 },
      });
    } finally {
      setIsTyping(false);
    }
  };

  const handleViewSession = async (session: ChatSession) => {
    const msgs = await getSessionMessages(session.sessionStart, session.sessionEnd);
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
    }
    if (diffDays === 1) {
      return language === 'zh' ? '昨天' : 'Yesterday';
    }
    if (diffDays < 7) {
      return language === 'zh' ? `${diffDays}天前` : `${diffDays}d ago`;
    }
    return d.toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' });
  };

  const latestAnalysis = [...messages].reverse().find(m => m.role === 'assistant' && m.analysis);
  const detectedConcepts = latestAnalysis?.analysis?.detectedConcepts ?? [];
  const activeProfile = latestProfile ?? profile;
  const dimensions = [
    { key: 'cognition', label: language === 'zh' ? '认知' : 'Cognition' },
    { key: 'affect', label: language === 'zh' ? '情感' : 'Affect' },
    { key: 'behavior', label: language === 'zh' ? '行为' : 'Behavior' },
  ] as const;
  const formatDelta = (value: number) => `${value > 0 ? '+' : ''}${value}`;

  return (
    <div className="chat-grid">
      <SpotlightCard className="chat-panel animate-fade-in">
        {error && (
          <div className="flex items-center gap-2 border-b border-[color:var(--line)] bg-rose-500/10 px-4 py-2 text-sm text-[color:var(--brand-rose)]">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        <div className="chat-stream" ref={scrollRef}>
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`message-row animate-scale-in ${msg.role === 'user' ? 'message-row-user' : ''}`}
            >
              <div className="message-inner">
                <div className="message-avatar">
                  {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                </div>
                <div className="message-bubble">{msg.text}</div>
              </div>
            </div>
          ))}

          {isTyping && (
            <div className="message-row animate-fade-in">
              <div className="message-inner">
                <div className="message-avatar">
                  <Bot size={16} />
                </div>
                <div className="message-bubble typing-bubble">
                  <span className="typing-dot" />
                  <span className="typing-dot" style={{ animationDelay: '140ms' }} />
                  <span className="typing-dot" style={{ animationDelay: '280ms' }} />
                </div>
              </div>
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="chat-composer">
          <div className="composer-row">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t.inputPlaceholder}
              disabled={isTyping}
              className="composer-input"
            />
            <button
              type="submit"
              disabled={!input.trim() || isTyping}
              className="send-button"
              aria-label={language === 'zh' ? '发送' : 'Send'}
              title={language === 'zh' ? '发送' : 'Send'}
            >
              <Send size={18} />
            </button>
          </div>
        </form>
      </SpotlightCard>

      <aside className="chat-sidebar">
        <button type="button" onClick={handleNewConversation} className="new-conversation">
          <Plus size={16} />
          {t.newConversation}
        </button>

        <SpotlightCard className="side-panel profile-analysis-panel animate-slide-in-right" spotlightColor="rgba(142, 169, 68, 0.14)">
          <div className="chat-panel-heading mb-3">
            <div>
              <h3 className="panel-title">{t.turnAnalysis}</h3>
              <p className="panel-copy">
                {isTyping
                  ? (language === 'zh' ? '正在生成回复...' : 'Generating...')
                  : t.trackingConcepts}
              </p>
            </div>
            <Sparkles size={18} className="text-[color:var(--brand-cyan)]" />
          </div>

          {latestAnalysis?.analysis ? (
            <div className="analysis-stack">
              <div className="profile-current-card">
                <div className="profile-current-header">
                  <span>{language === 'zh' ? '当前画像' : 'Current profile'}</span>
                  {activeProfile.lastUpdate && (
                    <span>
                      {new Date(activeProfile.lastUpdate).toLocaleTimeString(language === 'zh' ? 'zh-CN' : 'en-US', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  )}
                </div>
                <div className="profile-score-grid">
                  {dimensions.map(({ key, label }) => (
                    <div key={key} className="profile-score-tile">
                      <span className="profile-score-label">{label}</span>
                      <span className="profile-score-value">{Math.round(activeProfile[key])}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="analysis-chip">
                <span className="analysis-chip-label">{t.detectedIntent}</span>
                <span className="analysis-chip-value capitalize">{latestAnalysis.analysis.intent}</span>
              </div>
              <div className="analysis-chip">
                <span className="analysis-chip-label">{t.emotionState}</span>
                <span className="analysis-chip-value capitalize">{latestAnalysis.analysis.emotion}</span>
              </div>

              {detectedConcepts.length > 0 && (
                <div className="analysis-chip">
                  <span className="analysis-chip-label">
                    {language === 'zh' ? '检测概念' : 'Detected concepts'}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {detectedConcepts.map((concept: string, idx: number) => (
                      <span
                        key={`${concept}-${idx}`}
                        className="rounded-full border border-[color:var(--line)] bg-[color:var(--surface-muted)] px-2 py-1 text-xs font-semibold text-[color:var(--text-secondary)]"
                      >
                        {concept}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <span className="analysis-chip-label">{t.profileImpact}</span>
                <div className="impact-grid">
                  {dimensions.map(({ key, label }) => {
                    const delta = (latestAnalysis.analysis.delta as Record<string, number>)?.[key] ?? 0;
                    const currentValue = activeProfile[key];
                    const beforeValue = profileBeforeLatest?.[key];
                    const actualDelta = beforeValue !== undefined
                      ? Math.round(currentValue - beforeValue)
                      : delta;
                    const isCapped =
                      (beforeValue !== undefined && currentValue >= 100 && delta > 0) ||
                      (beforeValue !== undefined && currentValue <= 0 && delta < 0);

                    return (
                      <div key={key} className="impact-tile">
                        <div className="impact-label">{label}</div>
                        <div className="impact-value">{Math.round(currentValue)}</div>
                        <div className={`change-delta justify-center ${
                          actualDelta > 0 ? 'delta-positive' : actualDelta < 0 ? 'delta-negative' : 'delta-stable'
                        }`}>
                          {formatDelta(actualDelta)}
                        </div>
                        <div className="impact-meta">
                          {beforeValue !== undefined
                            ? `${Math.round(beforeValue)} -> ${Math.round(currentValue)}`
                            : `${language === 'zh' ? '信号' : 'signal'} ${formatDelta(delta)}`}
                        </div>
                        {delta !== actualDelta && (
                          <div className="impact-meta">
                            {language === 'zh' ? '模型信号' : 'model'} {formatDelta(delta)}
                          </div>
                        )}
                        {isCapped && (
                          <div className="impact-limit">
                            {currentValue >= 100
                              ? (language === 'zh' ? '已达上限' : 'maxed')
                              : (language === 'zh' ? '已达下限' : 'min')}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="empty-state">
              {language === 'zh' ? '发送消息后查看分析' : 'Send a message to see analysis'}
            </div>
          )}

          <div className="mt-3 flex items-center gap-2 border-t border-[color:var(--line)] pt-3 text-xs text-[color:var(--text-tertiary)]">
            <span className="status-dot" />
            <Activity size={14} />
            <span>{isTyping ? (language === 'zh' ? '生成中' : 'Generating') : t.systemActive}</span>
          </div>
        </SpotlightCard>

        <SpotlightCard className="chat-panel chat-history-panel animate-slide-in-right" spotlightColor="rgba(245, 184, 75, 0.12)">
          <button
            type="button"
            onClick={() => setHistoryExpanded(prev => !prev)}
            className="history-toggle"
          >
            <span className="inline-flex min-w-0 items-center gap-2">
              <History size={15} />
              <span className="truncate">{t.chatHistory}</span>
              {sessions.length > 0 && (
                <span className="rounded-full border border-[color:var(--line)] px-2 py-0.5 text-xs text-[color:var(--text-tertiary)]">
                  {sessions.length}
                </span>
              )}
            </span>
            {historyExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>

          {historyExpanded && selectedSession && (
            <div className="flex max-h-[360px] min-h-0 flex-col">
              <div className="flex items-center justify-between gap-2 border-b border-[color:var(--line)] px-3 py-2">
                <span className="truncate text-xs font-bold text-[color:var(--text-primary)]">
                  {selectedSession.session.title}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedSession(null)}
                  className="icon-button !min-h-7 !min-w-7"
                  aria-label={language === 'zh' ? '关闭历史会话' : 'Close session'}
                >
                  <X size={13} />
                </button>
              </div>
              <div className="session-list">
                {selectedSession.messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`message-row ${msg.role === 'user' ? 'message-row-user' : ''}`}
                  >
                    <div className="message-inner !max-w-[95%]">
                      <div className="message-bubble !p-2 !text-xs">{msg.text}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {historyExpanded && !selectedSession && (
            <div className="session-list">
              {sessionsLoading && <div className="loading-state">{t.loading}</div>}
              {!sessionsLoading && sessions.length === 0 && (
                <div className="empty-state">
                  <div>
                    <MessageSquare size={26} className="mx-auto mb-2 opacity-50" />
                    <p className="m-0">{t.noHistory}</p>
                  </div>
                </div>
              )}
              {sessions.map((session, idx) => (
                <button
                  key={`${session.sessionStart}-${idx}`}
                  type="button"
                  onClick={() => handleViewSession(session)}
                  className="session-card"
                >
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <span className="session-title truncate">{session.title}</span>
                    <span className="session-meta inline-flex shrink-0 items-center gap-1">
                      <Clock size={10} />
                      {formatTime(session.sessionStart)}
                    </span>
                  </div>
                  <p className="session-preview m-0 truncate">{session.preview}</p>
                  <p className="session-meta m-0 mt-1">
                    {session.messageCount} {t.messagesCount}
                  </p>
                </button>
              ))}
            </div>
          )}
        </SpotlightCard>
      </aside>
    </div>
  );
};
