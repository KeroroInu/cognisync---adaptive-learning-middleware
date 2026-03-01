import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminApi } from '../lib/adminApi';
import type { User } from '../types';
import { Search, ChevronLeft, ChevronRight, Edit2, Trash2, Eye, X, Save, Download } from 'lucide-react';

const ADMIN_KEY = (import.meta.env.VITE_ADMIN_KEY as string) || '';
const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string) || 'http://localhost:8000/api';

export const Users = () => {
  const navigate = useNavigate();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 10;

  // Edit modal state
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editName, setEditName] = useState('');
  const [editIsActive, setEditIsActive] = useState(true);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState('');

  useEffect(() => {
    loadUsers();
  }, [page, query]);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const data = await adminApi.getUsers(page, pageSize, query);
      setUsers(data.users);
      setTotal(data.total);
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (value: string) => {
    setQuery(value);
    setPage(1);
  };

  const handleEdit = (e: React.MouseEvent, user: User) => {
    e.stopPropagation();
    setEditingUser(user);
    setEditName(user.name || '');
    setEditIsActive(user.is_active ?? true);
    setEditError('');
  };

  const handleEditSave = async () => {
    if (!editingUser) return;
    try {
      setEditLoading(true);
      setEditError('');
      await adminApi.updateUser(editingUser.id, {
        name: editName,
        is_active: editIsActive,
      });
      setEditingUser(null);
      await loadUsers();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setEditLoading(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent, user: User) => {
    e.stopPropagation();
    if (window.confirm(`确定要删除用户 ${user.name}（学号：${user.student_id}）吗？此操作不可撤销。`)) {
      try {
        await adminApi.deleteUser(user.id);
        await loadUsers();
      } catch (err) {
        console.error('Failed to delete user:', err);
        alert('删除失败：' + (err instanceof Error ? err.message : String(err)));
      }
    }
  };

  const handleExportUser = async (e: React.MouseEvent, user: User) => {
    e.stopPropagation();
    try {
      const url = `${BASE_URL}/admin/export/csv/user/${user.id}`;
      const response = await fetch(url, { headers: { 'X-ADMIN-KEY': ADMIN_KEY } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `user_${user.student_id}_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } catch (err) {
      alert('导出失败：' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Edit Modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="glass-card rounded-2xl p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">编辑用户</h2>
              <button
                onClick={() => setEditingUser(null)}
                className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">学号（只读）</label>
                <input
                  type="text"
                  value={editingUser.student_id}
                  disabled
                  className="w-full px-3 py-2 rounded-lg opacity-50 cursor-not-allowed"
                  style={{
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px solid var(--glass-border)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">邮箱（只读，可选）</label>
                <input
                  type="text"
                  value={editingUser.email ?? '—'}
                  disabled
                  className="w-full px-3 py-2 rounded-lg opacity-50 cursor-not-allowed"
                  style={{
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px solid var(--glass-border)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">用户名称</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="输入用户名称"
                  className="w-full px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  style={{
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px solid var(--glass-border)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>

              <div className="flex items-center gap-3">
                <label className="text-sm font-medium">账户状态</label>
                <button
                  onClick={() => setEditIsActive(!editIsActive)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    editIsActive ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      editIsActive ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
                <span className="text-sm" style={{ color: 'var(--text-light)' }}>
                  {editIsActive ? '已激活' : '已禁用'}
                </span>
              </div>

              {editError && (
                <p className="text-sm text-red-500">{editError}</p>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setEditingUser(null)}
                  className="flex-1 px-4 py-2 rounded-lg border transition-colors hover:bg-gray-50 dark:hover:bg-gray-900"
                  style={{ borderColor: 'var(--glass-border)' }}
                >
                  取消
                </button>
                <button
                  onClick={handleEditSave}
                  disabled={editLoading}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                >
                  <Save size={16} />
                  {editLoading ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="glass-card p-4 rounded-xl">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
          <input
            type="text"
            placeholder="搜索用户（姓名、学号或邮箱）"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            style={{
              backgroundColor: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--glass-border)',
            }}
          />
        </div>
      </div>

      {/* Users Table */}
      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead style={{ backgroundColor: 'var(--bg-tertiary)' }}>
              <tr>
                <th className="px-6 py-4 text-left text-sm font-semibold dark:text-white">学号</th>
                <th className="px-6 py-4 text-left text-sm font-semibold dark:text-white">姓名</th>
                <th className="px-6 py-4 text-left text-sm font-semibold dark:text-white">邮箱</th>
                <th className="px-6 py-4 text-left text-sm font-semibold dark:text-white">角色</th>
                <th className="px-6 py-4 text-left text-sm font-semibold dark:text-white">状态</th>
                <th className="px-6 py-4 text-left text-sm font-semibold dark:text-white">最后活跃</th>
                <th className="px-6 py-4 text-left text-sm font-semibold dark:text-white">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center">
                    <div className="flex justify-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
                    </div>
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                    暂无用户
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr
                    key={user.id}
                    className="border-t hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    style={{ borderColor: 'var(--glass-border)' }}
                  >
                    <td className="px-6 py-4 text-sm font-mono dark:text-white">{user.student_id}</td>
                    <td className="px-6 py-4 text-sm">{user.name}</td>
                    <td className="px-6 py-4 text-sm" style={{ color: 'var(--text-light)' }}>{user.email ?? '—'}</td>
                    <td className="px-6 py-4 text-sm">
                      <span className="px-2 py-1 rounded text-xs" style={{
                        backgroundColor: 'var(--bg-tertiary)',
                        border: '1px solid var(--glass-border)',
                      }}>
                        {user.role}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <span className={`px-2 py-1 rounded text-xs ${user.is_active ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'}`}>
                        {user.is_active ? '已激活' : '已禁用'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {user.last_active_at ? new Date(user.last_active_at).toLocaleDateString('zh-CN') : '—'}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => navigate(`/admin/users/${user.id}`)}
                          className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-800 transition-colors"
                          title="查看详情"
                        >
                          <Eye size={16} />
                        </button>
                        <button
                          onClick={(e) => handleEdit(e, user)}
                          className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors"
                          title="编辑用户"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={(e) => handleExportUser(e, user)}
                          className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-800 transition-colors"
                          title="导出用户数据 (CSV)"
                        >
                          <Download size={16} />
                        </button>
                        <button
                          onClick={(e) => handleDelete(e, user)}
                          className="p-2 rounded-lg bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-800 transition-colors"
                          title="删除用户"
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
              共 {total} 位，第 {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} 位
            </div>
            <div className="flex space-x-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-4 py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <ChevronLeft size={20} />
              </button>
              <span className="px-4 py-2">
                第 {page} / {totalPages} 页
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-4 py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <ChevronRight size={20} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
