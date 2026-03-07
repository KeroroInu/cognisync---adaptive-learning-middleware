import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, MessageSquare, User, Calendar, Clock } from 'lucide-react';
import { adminApi } from '../lib/adminApi';
import type { SessionDetail, SessionMessageItem } from '../types';

export const ConversationDetail = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [messages, setMessages] = useState<SessionMessageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (sessionId) {
      loadSessionData();
    }
  }, [sessionId]);

  const loadSessionData = async () => {
    if (!sessionId) return;

    try {
      setLoading(true);
      setError('');

      // Load session details and messages in parallel
      const [sessionData, messagesData] = await Promise.all([
        adminApi.getSessionDetail(sessionId),
        adminApi.getSessionMessages(sessionId, 500, 0)
      ]);

      setSession(sessionData);
      setMessages(messagesData.messages);
    } catch (err) {
      console.error('Failed to load session:', err);
      setError(err instanceof Error ? err.message : 'Failed to load session');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <button
          onClick={() => navigate('/admin/conversations')}
          className="inline-flex items-center gap-2 transition-colors"
          style={{ color: 'var(--text-secondary)' }}
        >
          <ArrowLeft size={20} />
          返回对话列表
        </button>
        <div className="glass-card p-6 rounded-xl border" style={{ background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.3)' }}>
          <p style={{ color: '#ef4444' }}>{error}</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="space-y-6">
        <button
          onClick={() => navigate('/admin/conversations')}
          className="inline-flex items-center gap-2 transition-colors"
          style={{ color: 'var(--text-secondary)' }}
        >
          <ArrowLeft size={20} />
          返回对话列表
        </button>
        <div className="glass-card p-6 rounded-xl">
          <p className="text-gray-500">会话不存在</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Back Button */}
      <button
        onClick={() => navigate('/admin/conversations')}
        className="inline-flex items-center gap-2 transition-colors"
        style={{ color: 'var(--text-secondary)' }}
      >
        <ArrowLeft size={20} />
        返回对话列表
      </button>

      {/* Header */}
      <div className="glass-card p-6 rounded-2xl stagger-1">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">对话详情</h1>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>会话 ID: {session.id}</p>
          </div>
          <div className="px-4 py-2 bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 rounded-lg font-medium">
            {session.message_count} 条消息
          </div>
        </div>

        {/* Session Info */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
          <div className="flex items-center gap-3 p-4 rounded-lg" style={{ background: 'var(--bg-secondary)' }}>
            <User size={20} className="text-indigo-500" />
            <div>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>用户</p>
              <p className="font-medium">{session.user_name || '—'}</p>
              {(session.student_id || session.user_email) && (
                <p className="text-xs font-mono" style={{ color: 'var(--text-light)' }}>
                  {session.student_id || session.user_email}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 p-4 rounded-lg" style={{ background: 'var(--bg-secondary)' }}>
            <Calendar size={20} className="text-green-500" />
            <div>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>创建时间</p>
              <p className="font-medium">{new Date(session.created_at).toLocaleDateString('zh-CN')}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-4 rounded-lg" style={{ background: 'var(--bg-secondary)' }}>
            <Clock size={20} className="text-blue-500" />
            <div>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>最后更新</p>
              <p className="font-medium">
                {session.updated_at ? new Date(session.updated_at).toLocaleDateString('zh-CN') : '—'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="glass-card p-6 rounded-2xl stagger-2">
        <h2 className="text-xl font-bold mb-4 flex items-center gap-2 dark:text-white">
          <MessageSquare size={24} className="text-indigo-500" />
          消息记录
        </h2>

        {messages.length === 0 ? (
          <div className="text-center py-12" style={{ color: 'var(--text-light)' }}>
            该对话暂无消息
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className="p-4 rounded-xl border"
                style={
                  message.role === 'user'
                    ? { background: 'rgba(99,102,241,0.08)', borderColor: 'rgba(99,102,241,0.25)' }
                    : { background: 'var(--bg-secondary)', borderColor: 'var(--glass-border)' }
                }
              >
                <div className="flex items-start justify-between mb-2">
                  <span
                    className="px-3 py-1 rounded-full text-sm font-medium"
                    style={
                      message.role === 'user'
                        ? { background: 'rgba(99,102,241,0.15)', color: 'var(--brand-indigo)' }
                        : { background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }
                    }
                  >
                    {message.role === 'user' ? '用户' : '助手'}
                  </span>
                  <span className="text-sm" style={{ color: 'var(--text-light)' }}>
                    {new Date(message.timestamp).toLocaleString()}
                  </span>
                </div>
                <p className="whitespace-pre-wrap" style={{ color: 'var(--text-primary)' }}>{message.text}</p>
                {message.analysis && (
                  <details className="mt-3">
                    <summary className="text-sm cursor-pointer" style={{ color: 'var(--text-light)' }}>
                      查看分析数据
                    </summary>
                    <pre className="mt-2 p-3 rounded text-xs overflow-x-auto" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
                      {JSON.stringify(message.analysis, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
