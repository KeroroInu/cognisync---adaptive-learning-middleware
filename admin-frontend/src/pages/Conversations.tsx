import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, ChevronRight, Eye, Edit2, Trash2 } from 'lucide-react';
import { adminApi } from '../lib/adminApi';
import type { SessionItem } from '../types';

export const Conversations = () => {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 10;

  useEffect(() => {
    loadSessions();
  }, [page]);

  const loadSessions = async () => {
    try {
      setLoading(true);
      const data = await adminApi.getSessions(page, pageSize);
      setSessions(data.sessions);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sessions');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (e: React.MouseEvent, session: SessionItem) => {
    e.stopPropagation();
    // TODO: Implement edit modal
    alert(`Edit session: ${session.id}\n(Edit functionality will be implemented)`);
  };

  const handleDelete = async (e: React.MouseEvent, session: SessionItem) => {
    e.stopPropagation();
    if (window.confirm(`Are you sure you want to delete this conversation?\nUser: ${session.user_email}\nMessages: ${session.message_count}`)) {
      try {
        // TODO: Implement delete API endpoint
        alert(`Delete session: ${session.id}\n(Delete API endpoint needs to be implemented)`);
        // await adminApi.deleteSession(session.id);
        // loadSessions();
      } catch (err) {
        console.error('Failed to delete session:', err);
        alert('Failed to delete session');
      }
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold mb-2">Conversations</h1>
        <p className="text-gray-600 dark:text-gray-400">Browse and manage all chat sessions</p>
      </div>

      {/* Error Message */}
      {error && (
        <div className="glass-card p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
          <p className="text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* Sessions List */}
      <div className="glass-card rounded-2xl overflow-hidden stagger-1">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead style={{ backgroundColor: 'var(--bg-tertiary)' }}>
              <tr>
                <th className="px-6 py-4 text-left text-sm font-semibold">User Email</th>
                <th className="px-6 py-4 text-left text-sm font-semibold">Messages</th>
                <th className="px-6 py-4 text-left text-sm font-semibold">Created</th>
                <th className="px-6 py-4 text-left text-sm font-semibold">Last Updated</th>
                <th className="px-6 py-4 text-left text-sm font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sessions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                    No conversations found
                  </td>
                </tr>
              ) : (
                sessions.map((session) => (
                  <tr
                    key={session.id}
                    className="border-t hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    style={{ borderColor: 'var(--glass-border)' }}
                  >
                    <td className="px-6 py-4 text-sm font-medium">{session.user_email}</td>
                    <td className="px-6 py-4 text-sm">
                      <div className="flex items-center gap-2">
                        <MessageSquare size={16} className="text-indigo-500" />
                        {session.message_count} messages
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                      {new Date(session.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                      {session.updated_at ? new Date(session.updated_at).toLocaleDateString() : 'N/A'}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => navigate(`/admin/conversations/${session.id}`)}
                          className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-800 transition-colors"
                          title="View Conversation"
                        >
                          <Eye size={16} />
                        </button>
                        <button
                          onClick={(e) => handleEdit(e, session)}
                          className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors"
                          title="Edit Session"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={(e) => handleDelete(e, session)}
                          className="p-2 rounded-lg bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-800 transition-colors"
                          title="Delete Session"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > pageSize && (
          <div className="flex items-center justify-between px-6 py-4 border-t" style={{ borderColor: 'var(--glass-border)' }}>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, total)} of {total} conversations
            </div>
            <div className="flex space-x-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-4 py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                Previous
              </button>
              <span className="px-4 py-2">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-4 py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
