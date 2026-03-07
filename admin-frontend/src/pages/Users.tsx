import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminApi } from '../lib/adminApi';
import type { User } from '../types';
import { Search, ChevronLeft, ChevronRight, Edit2, Trash2, Eye, X, Save, Download, KeyRound } from 'lucide-react';

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

  // Multi-select state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  // Edit modal state
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editName, setEditName] = useState('');
  const [editIsActive, setEditIsActive] = useState(true);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState('');

  // Reset password modal state
  const [resetUser, setResetUser] = useState<User | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState('');
  const [resetSuccess, setResetSuccess] = useState(false);

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

  const handleOpenReset = (e: React.MouseEvent, user: User) => {
    e.stopPropagation();
    setResetUser(user);
    setResetPassword('');
    setResetConfirm('');
    setResetError('');
    setResetSuccess(false);
  };

  const handleResetSave = async () => {
    if (!resetUser) return;
    if (resetPassword.length < 6) {
      setResetError('密码长度不能少于 6 位');
      return;
    }
    if (resetPassword !== resetConfirm) {
      setResetError('两次输入的密码不一致');
      return;
    }
    try {
      setResetLoading(true);
      setResetError('');
      await adminApi.resetUserPassword(resetUser.id, resetPassword);
      setResetSuccess(true);
    } catch (err) {
      setResetError(err instanceof Error ? err.message : '重置失败');
    } finally {
      setResetLoading(false);
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

  const toggleSelect = (userId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(userId) ? next.delete(userId) : next.add(userId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (users.every(u => selectedIds.has(u.id))) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        users.forEach(u => next.delete(u.id));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        users.forEach(u => next.add(u.id));
        return next;
      });
    }
  };

  const handleExportSelected = async () => {
    if (selectedIds.size === 0) return;
    setBulkLoading(true);
    try {
      const ids = Array.from(selectedIds).join(',');
      const url = `${BASE_URL}/admin/export/csv/scale-responses?user_ids=${encodeURIComponent(ids)}`;
      const response = await fetch(url, { headers: { 'X-ADMIN-KEY': ADMIN_KEY } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `scale_responses_selected_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } catch (err) {
      alert('导出失败：' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBulkLoading(false);
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`确定要删除选中的 ${selectedIds.size} 位用户及其全部数据？此操作不可撤销。`)) return;
    setBulkLoading(true);
    try {
      for (const userId of selectedIds) {
        await adminApi.deleteUser(userId);
      }
      setSelectedIds(new Set());
      await loadUsers();
    } catch (err) {
      alert('删除失败：' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBulkLoading(false);
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  const inputStyle: React.CSSProperties = {
    backgroundColor: 'var(--bg-secondary)',
    border: '1px solid var(--glass-border)',
    color: 'var(--text-primary)',
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Edit Modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="glass-card rounded-2xl p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>编辑用户</h2>
              <button
                onClick={() => setEditingUser(null)}
                className="p-1 rounded-lg transition-opacity hover:opacity-60"
                style={{ color: 'var(--text-light)' }}
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-tertiary)' }}>学号（只读）</label>
                <input
                  type="text"
                  value={editingUser.student_id}
                  disabled
                  className="w-full px-3 py-2 rounded-lg opacity-50 cursor-not-allowed"
                  style={inputStyle}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-tertiary)' }}>邮箱（只读，可选）</label>
                <input
                  type="text"
                  value={editingUser.email ?? '—'}
                  disabled
                  className="w-full px-3 py-2 rounded-lg opacity-50 cursor-not-allowed"
                  style={inputStyle}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-tertiary)' }}>用户名称</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="输入用户名称"
                  className="w-full px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  style={inputStyle}
                />
              </div>

              <div className="flex items-center gap-3">
                <label className="text-sm font-medium" style={{ color: 'var(--text-tertiary)' }}>账户状态</label>
                <button
                  onClick={() => setEditIsActive(!editIsActive)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    editIsActive ? 'bg-green-500' : 'bg-gray-400'
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
                  className="flex-1 px-4 py-2 rounded-lg border transition-opacity hover:opacity-70"
                  style={{ borderColor: 'var(--glass-border)', color: 'var(--text-secondary)' }}
                >
                  取消
                </button>
                <button
                  onClick={handleEditSave}
                  disabled={editLoading}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  <Save size={16} />
                  {editLoading ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resetUser && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="glass-card rounded-2xl p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <KeyRound size={20} style={{ color: '#f59e0b' }} />
                <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>重置密码</h2>
              </div>
              <button
                onClick={() => setResetUser(null)}
                className="p-1 rounded-lg transition-opacity hover:opacity-60"
                style={{ color: 'var(--text-light)' }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Student info */}
            <div className="mb-4 px-3 py-2 rounded-lg text-sm" style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>
              为 <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{resetUser.name}</span>
              {' '}（学号：<span className="font-mono">{resetUser.student_id}</span>）重置密码
            </div>

            {resetSuccess ? (
              <div className="space-y-4">
                <div className="p-4 rounded-xl text-center" style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)' }}>
                  <p className="text-emerald-600 font-medium">密码已重置成功！</p>
                  <p className="text-sm mt-1" style={{ color: 'var(--text-light)' }}>学生下次登录时使用新密码即可</p>
                </div>
                <button
                  onClick={() => setResetUser(null)}
                  className="w-full px-4 py-2 rounded-lg bg-indigo-600 text-white hover:opacity-90 transition-opacity"
                >
                  关闭
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-tertiary)' }}>新密码</label>
                  <input
                    type="password"
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                    placeholder="至少 6 位"
                    className="w-full px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-tertiary)' }}>确认新密码</label>
                  <input
                    type="password"
                    value={resetConfirm}
                    onChange={(e) => setResetConfirm(e.target.value)}
                    placeholder="再次输入新密码"
                    className="w-full px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                    style={inputStyle}
                  />
                </div>

                {resetError && (
                  <p className="text-sm text-red-500">{resetError}</p>
                )}

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => setResetUser(null)}
                    className="flex-1 px-4 py-2 rounded-lg border transition-opacity hover:opacity-70"
                    style={{ borderColor: 'var(--glass-border)', color: 'var(--text-secondary)' }}
                  >
                    取消
                  </button>
                  <button
                    onClick={handleResetSave}
                    disabled={resetLoading}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
                    style={{ background: 'linear-gradient(135deg, #f59e0b, #ef4444)' }}
                  >
                    <KeyRound size={16} />
                    {resetLoading ? '重置中...' : '确认重置'}
                  </button>
                </div>
              </div>
            )}
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

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div className="glass-card p-3 rounded-xl flex items-center justify-between gap-4"
          style={{ border: '1px solid rgba(99,102,241,0.4)', background: 'rgba(99,102,241,0.08)' }}>
          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            已选 {selectedIds.size} 位用户
          </span>
          <div className="flex gap-2">
            <button
              onClick={handleExportSelected}
              disabled={bulkLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
              style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981' }}
            >
              <Download size={14} />
              导出量表数据
            </button>
            <button
              onClick={handleDeleteSelected}
              disabled={bulkLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
              style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}
            >
              <Trash2 size={14} />
              删除所选
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="px-3 py-1.5 rounded-lg text-sm transition-colors"
              style={{ color: 'var(--text-light)' }}
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* Users Table */}
      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead style={{ backgroundColor: 'var(--bg-tertiary)' }}>
              <tr>
                <th className="px-4 py-4 text-left">
                  <input
                    type="checkbox"
                    checked={users.length > 0 && users.every(u => selectedIds.has(u.id))}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded accent-indigo-500 cursor-pointer"
                  />
                </th>
                <th className="px-6 py-4 text-left text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>学号</th>
                <th className="px-6 py-4 text-left text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>姓名</th>
                <th className="px-6 py-4 text-left text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>邮箱</th>
                <th className="px-6 py-4 text-left text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>角色</th>
                <th className="px-6 py-4 text-left text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>状态</th>
                <th className="px-6 py-4 text-left text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>最后活跃</th>
                <th className="px-6 py-4 text-left text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center">
                    <div className="flex justify-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
                    </div>
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center" style={{ color: 'var(--text-light)' }}>
                    暂无用户
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr
                    key={user.id}
                    className="border-t transition-colors"
                    style={{ borderColor: 'var(--glass-border)' }}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--bg-secondary)')}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = '')}
                  >
                    <td className="px-4 py-4">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(user.id)}
                        onChange={() => toggleSelect(user.id)}
                        onClick={e => e.stopPropagation()}
                        className="w-4 h-4 rounded accent-indigo-500 cursor-pointer"
                      />
                    </td>
                    <td className="px-6 py-4 text-sm font-mono" style={{ color: 'var(--text-primary)' }}>{user.student_id}</td>
                    <td className="px-6 py-4 text-sm" style={{ color: 'var(--text-primary)' }}>{user.name}</td>
                    <td className="px-6 py-4 text-sm" style={{ color: 'var(--text-light)' }}>{user.email ?? '—'}</td>
                    <td className="px-6 py-4 text-sm">
                      <span className="px-2 py-1 rounded text-xs" style={{
                        backgroundColor: 'var(--bg-tertiary)',
                        border: '1px solid var(--glass-border)',
                        color: 'var(--text-secondary)',
                      }}>
                        {user.role}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <span className={`px-2 py-1 rounded text-xs ${user.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                        {user.is_active ? '已激活' : '已禁用'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {user.last_active_at ? new Date(user.last_active_at).toLocaleDateString('zh-CN') : '—'}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => navigate(`/users/${user.id}`)}
                          className="p-2 rounded-lg transition-opacity hover:opacity-70"
                          style={{ background: 'rgba(99,102,241,0.1)', color: '#6366f1' }}
                          title="查看详情"
                        >
                          <Eye size={16} />
                        </button>
                        <button
                          onClick={(e) => handleEdit(e, user)}
                          className="p-2 rounded-lg transition-opacity hover:opacity-70"
                          style={{ background: 'rgba(59,130,246,0.1)', color: '#3b82f6' }}
                          title="编辑用户"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={(e) => handleOpenReset(e, user)}
                          className="p-2 rounded-lg transition-opacity hover:opacity-70"
                          style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b' }}
                          title="重置密码"
                        >
                          <KeyRound size={16} />
                        </button>
                        <button
                          onClick={(e) => handleExportUser(e, user)}
                          className="p-2 rounded-lg transition-opacity hover:opacity-70"
                          style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981' }}
                          title="导出用户数据 (CSV)"
                        >
                          <Download size={16} />
                        </button>
                        <button
                          onClick={(e) => handleDelete(e, user)}
                          className="p-2 rounded-lg transition-opacity hover:opacity-70"
                          style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}
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
                className="px-4 py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-opacity hover:opacity-70"
                style={{ color: 'var(--text-secondary)' }}
              >
                <ChevronLeft size={20} />
              </button>
              <span className="px-4 py-2" style={{ color: 'var(--text-secondary)' }}>
                第 {page} / {totalPages} 页
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-4 py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-opacity hover:opacity-70"
                style={{ color: 'var(--text-secondary)' }}
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
