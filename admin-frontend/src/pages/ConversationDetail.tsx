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
          className="inline-flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
        >
          <ArrowLeft size={20} />
          Back to Conversations
        </button>
        <div className="glass-card p-6 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
          <p className="text-red-700 dark:text-red-300">{error}</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="space-y-6">
        <button
          onClick={() => navigate('/admin/conversations')}
          className="inline-flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
        >
          <ArrowLeft size={20} />
          Back to Conversations
        </button>
        <div className="glass-card p-6 rounded-xl">
          <p className="text-gray-500">Session not found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Back Button */}
      <button
        onClick={() => navigate('/admin/conversations')}
        className="inline-flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
      >
        <ArrowLeft size={20} />
        Back to Conversations
      </button>

      {/* Header */}
      <div className="glass-card p-6 rounded-2xl stagger-1">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">Conversation Detail</h1>
            <p className="text-gray-600 dark:text-gray-400">Session ID: {session.id}</p>
          </div>
          <div className="px-4 py-2 bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 rounded-lg font-medium">
            {session.message_count} messages
          </div>
        </div>

        {/* Session Info */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
          <div className="flex items-center gap-3 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <User size={20} className="text-indigo-500" />
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">User</p>
              <p className="font-medium">{session.user_email}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <Calendar size={20} className="text-green-500" />
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Created</p>
              <p className="font-medium">{new Date(session.created_at).toLocaleDateString()}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <Clock size={20} className="text-blue-500" />
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Last Updated</p>
              <p className="font-medium">
                {session.updated_at ? new Date(session.updated_at).toLocaleDateString() : 'N/A'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="glass-card p-6 rounded-2xl stagger-2">
        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
          <MessageSquare size={24} className="text-indigo-500" />
          Messages
        </h2>

        {messages.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            No messages in this conversation
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`p-4 rounded-xl ${
                  message.role === 'user'
                    ? 'bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800'
                    : 'bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700'
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <span
                    className={`px-3 py-1 rounded-full text-sm font-medium ${
                      message.role === 'user'
                        ? 'bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    {message.role === 'user' ? 'User' : 'Assistant'}
                  </span>
                  <span className="text-sm text-gray-500">
                    {new Date(message.timestamp).toLocaleString()}
                  </span>
                </div>
                <p className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{message.text}</p>
                {message.analysis && (
                  <details className="mt-3">
                    <summary className="text-sm text-gray-500 cursor-pointer hover:text-gray-700 dark:hover:text-gray-300">
                      View Analysis
                    </summary>
                    <pre className="mt-2 p-3 bg-gray-100 dark:bg-gray-900 rounded text-xs overflow-x-auto">
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
