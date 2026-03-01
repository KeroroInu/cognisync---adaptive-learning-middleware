import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, ChevronRight, Eye, Trash2 } from 'lucide-react';
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

  const handleDelete = async (e: React.MouseEvent, session: SessionItem) => {
    e.stopPropagation();
    if (window.confirm(`确定要删除该会话吗？\n用户: ${session.user_email}\n消息数: ${session.message_count}\n此操作不可撤销。`)) {
      try {
        await adminApi.deleteSession(session.id);
        await loadSessions();
      } catch (err) {
        console.error('Failed to delete session:', err);
        alert('删除失败：' + (err instanceof Error ? err.message : String(err)));
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
        <h1 className="text-3xl font-bold mb-2">对话管理</h1>
        <p style={{ color: 'var(--text-secondary)' }}>浏览和管理所有聊天会话</p>
      </div>

      {/* Error Message */}
      {error && (
        <div className="glass-card p-4 rounded-xl border" style={{ background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.3)' }}>
          <p style={{ color: 'var(--text-primary)' }}>{error}</p>
        </div>
      )}

      {/* Sessions List */}
      <div className="glass-card rounded-2xl overflow-hidden stagger-1">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead style={{ backgroundColor: 'var(--bg-tertiary)' }}>
              <tr>
                <th className="px-6 py-4 text-left text-sm font-semibold dark:text-white">用户邮箱</th>
                <th className="px-6 py-4 text-left text-sm font-semibold dark:text-white">消息数</th>
                <th className="px-6 py-4 text-left text-sm font-semibold dark:text-white">创建时间</th>
                <th className="px-6 py-4 text-left text-sm font-semibold dark:text-white">最后更新</th>
                <th className="px-6 py-4 text-left text-sm font-semibold dark:text-white">操作</th>
              </tr>
            </thead>
            <tbody>
              {sessions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                    暂无对话记录
                  </td>
                </tr>
              ) : (
                sessions.map((session) => (
                  <tr
                    key={session.id}
                    className="border-t hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    style={{ borderColor: 'var(--glass-border)' }}
                  >
                    <td className="px-6 py-4 text-sm font-medium dark:text-white">{session.user_email}</td>
                    <td className="px-6 py-4 text-sm">
                      <div className="flex items-center gap-2">
                        <MessageSquare size={16} className="text-indigo-500" />
                        {session.message_count} 条消息
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {new Date(session.created_at).toLocaleDateString('zh-CN')}
                    </td>
                    <td className="px-6 py-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {session.updated_at ? new Date(session.updated_at).toLocaleDateString('zh-CN') : '—'}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => navigate(`/admin/conversations/${session.id}`)}
                          className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-800 transition-colors"
                          title="查看对话"
                        >
                          <Eye size={16} />
                        </button>
                        <button
                          onClick={(e) => handleDelete(e, session)}
                          className="p-2 rounded-lg bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-800 transition-colors"
                          title="删除会话"
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
            <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              共 {total} 条，第 {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} 条
            </div>
            <div className="flex space-x-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-4 py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                上一页
              </button>
              <span className="px-4 py-2">
                第 {page} / {totalPages} 页
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-4 py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                下一页
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
