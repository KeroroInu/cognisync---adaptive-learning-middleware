import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminApi } from '../lib/adminApi';
import type { User } from '../types';
import './Users.css';
import { TEACHING_CLASSES, isTeachingClass } from '../lib/teachingClasses';
import { Search, ChevronLeft, ChevronRight, Edit2, Trash2, Eye, X, Save, Download, KeyRound } from 'lucide-react';

const ROLE_LABELS: Record<string, string> = { learner: '学生', student: '学生', user: '学生', admin: '管理员', teacher: '教师' };

const GROUP_LABELS: Record<User['experiment_group'], string> = {
  unassigned: '未分组',
  pdt: '项目解构式',
  ai_pbl: '常规 AI 协作',
  experience: '体验组',
  lecture: '历史讲授组',
};

export const Users = () => {
  const navigate = useNavigate();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [bulkError, setBulkError] = useState('');
  const bulkLock = useRef(false);
  const listSequence = useRef(0);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 10;

  // Multi-select state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  // Edit modal state
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editName, setEditName] = useState('');
  const [editStudentId, setEditStudentId] = useState('');
  const [editGender, setEditGender] = useState<User['gender']>(null);
  const [editSchoolClass, setEditSchoolClass] = useState('');
  const [saveNotice, setSaveNotice] = useState('');
  const [editIsActive, setEditIsActive] = useState(true);
  const [editClassName, setEditClassName] = useState('');
  const [editExperimentGroup, setEditExperimentGroup] = useState<User['experiment_group']>('unassigned');
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState('');
  const editLock = useRef(false);
  const editDialog = useRef<HTMLDivElement>(null);
  const closeEdit = useCallback(() => { if (!editLock.current) setEditingUser(null); }, []);

  useEffect(() => {
    if (!editingUser) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = editDialog.current;
    dialog?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); closeEdit(); }
      if (event.key !== 'Tab' || !dialog) return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)'));
      const first = controls[0]; const last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previousFocus?.focus(); };
  }, [editingUser, closeEdit]);

  // Reset password modal state
  const [resetUser, setResetUser] = useState<User | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState('');
  const [resetSuccess, setResetSuccess] = useState(false);
  const [resetAcknowledged, setResetAcknowledged] = useState(false);
  const resetLock = useRef(false);
  const resetDialog = useRef<HTMLDivElement>(null);

  const closeReset = useCallback(() => {
    if (resetLock.current) return;
    setResetUser(null);
    setResetPassword('');
    setResetConfirm('');
    setResetAcknowledged(false);
  }, []);

  useEffect(() => {
    if (!resetUser) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = resetDialog.current;
    dialog?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); closeReset(); }
      if (event.key !== 'Tab' || !dialog) return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]'));
      const first = controls[0]; const last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previousFocus?.focus(); };
  }, [resetUser, closeReset]);

  const loadUsers = useCallback(async () => {
    const sequence = ++listSequence.current;
    try {
      setLoading(true);
      const data = await adminApi.getUsers(page, pageSize, query, groupFilter);
      if (sequence !== listSequence.current) return;
      setUsers(data.users);
      setTotal(data.total);
    } catch (err) {
      if (sequence === listSequence.current) setBulkError(err instanceof Error ? err.message : '学生名单加载失败，请刷新');
    } finally {
      if (sequence === listSequence.current) setLoading(false);
    }
  }, [page, query, groupFilter]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const handleSearch = (value: string) => {
    setQuery(value);
    setPage(1);
    setSelectedIds(new Set());
  };

  const handleEdit = (e: React.MouseEvent, user: User) => {
    e.stopPropagation();
    setEditingUser(user);
    setEditName(user.name || '');
    setEditStudentId(user.student_id);
    setEditGender(user.gender ?? null);
    setEditSchoolClass(user.school_class || '');
    setSaveNotice('');
    setEditIsActive(user.is_active ?? true);
    setEditClassName(user.class_name || '');
    setEditExperimentGroup(user.experiment_group || 'unassigned');
    setEditError('');
  };

  const handleEditSave = async () => {
    if (!editingUser || editLock.current) return;
    if (!editName.trim() || !editStudentId.trim() || /\s/.test(editStudentId.trim())) {
      setEditError('请填写姓名和完整学号，学号中不要包含空格。'); return;
    }
    try {
      editLock.current = true;
      setEditLoading(true);
      setEditError('');
      await adminApi.updateUser(editingUser.id, {
        ...(editName.trim() !== editingUser.name ? { name: editName.trim() } : {}),
        ...(editStudentId.trim() !== editingUser.student_id ? { student_id: editStudentId.trim() } : {}),
        ...(editGender !== (editingUser.gender ?? null) ? { gender: editGender } : {}),
        ...(editSchoolClass !== (editingUser.school_class || '') ? { school_class: editSchoolClass || null } : {}),
        ...(editIsActive !== editingUser.is_active ? { is_active: editIsActive } : {}),
        ...(editClassName !== (editingUser.class_name || '') ? { class_name: editClassName, experiment_group: editExperimentGroup } : {}),
      });
      setSaveNotice('资料已保存。作品和答卷仍保留在原账号下。');
      setEditingUser(null);
      await loadUsers();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      editLock.current = false;
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
    setResetAcknowledged(false);
  };

  const handleResetSave = async () => {
    if (!resetUser || resetLock.current) return;
    if (resetPassword.length < 6) {
      setResetError('密码长度不能少于 6 位');
      return;
    }
    if (resetPassword !== resetConfirm) {
      setResetError('两次输入的密码不一致');
      return;
    }
    if (!resetAcknowledged) {
      setResetError('请确认已经核对学生身份，并告知原密码将失效。');
      return;
    }
    try {
      resetLock.current = true;
      setResetLoading(true);
      setResetError('');
      await adminApi.resetUserPassword(resetUser.id, resetPassword);
      setResetPassword('');
      setResetConfirm('');
      setResetSuccess(true);
    } catch (err) {
      setResetError(err instanceof Error ? err.message : '重置失败');
    } finally {
      resetLock.current = false;
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
      const blob = await adminApi.exportCsv(`/export/csv/user/${user.id}`);
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
    const students = users.filter(u => ['learner', 'student', 'user'].includes(u.role));
    if (students.every(u => selectedIds.has(u.id))) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        students.forEach(u => next.delete(u.id));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        students.forEach(u => next.add(u.id));
        return next;
      });
    }
  };

  const selectUnassigned = async () => {
    if (bulkLock.current) return;
    bulkLock.current = true; setBulkLoading(true); setBulkError(''); setSaveNotice('');
    try {
      const { ids } = await adminApi.getUnassignedStudentIds(query);
      setSelectedIds(new Set(ids)); setGroupFilter('unassigned'); setPage(1);
      if (!ids.length) setSaveNotice('当前没有符合搜索条件的未分组学生。');
    } catch (err) { setBulkError(err instanceof Error ? err.message : '选择失败，请重试'); }
    finally { bulkLock.current = false; setBulkLoading(false); }
  };

  const assignSelected = async (className: string) => {
    if (bulkLock.current || !selectedIds.size) return;
    if (!window.confirm(`将所选 ${selectedIds.size} 位未分组学生分入${className}？`)) return;
    bulkLock.current = true; setBulkLoading(true); setBulkError(''); setSaveNotice('');
    try {
      const result = await adminApi.assignStudents(Array.from(selectedIds), className);
      setSelectedIds(new Set()); setPage(1);
      setSaveNotice(`已将 ${result.assigned} 位学生分入${result.class_name}。学校班级、作品和答卷不变。`);
      await loadUsers();
    } catch (err) { setBulkError(err instanceof Error ? err.message : '分组失败，请重试'); }
    finally { bulkLock.current = false; setBulkLoading(false); }
  };

  const handleExportSelected = async () => {
    if (selectedIds.size === 0) return;
    setBulkLoading(true);
    try {
      const ids = Array.from(selectedIds).join(',');
      const blob = await adminApi.exportCsv(`/export/csv/scale-responses?user_ids=${encodeURIComponent(ids)}`);
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
    <div className="users-page">
      {/* Edit Modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div ref={editDialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="编辑用户" className="glass-card users-dialog users-edit-dialog rounded-2xl p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>修改学生资料</h2>
              <button
                onClick={closeEdit}
                disabled={editLoading}
                aria-label="关闭编辑"
                className="p-1 rounded-lg transition-opacity hover:opacity-60"
                style={{ color: 'var(--text-light)' }}
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label htmlFor="edit-student-id" className="block text-sm font-medium mb-1" style={{ color: 'var(--text-tertiary)' }}>学号（完整序号）</label>
                <input
                  id="edit-student-id"
                  type="text"
                  value={editStudentId}
                  onChange={event => setEditStudentId(event.target.value)}
                  disabled={editLoading || editingUser.role === 'admin'}
                  maxLength={50}
                  aria-describedby="edit-student-id-help"
                  className="w-full px-3 py-2 rounded-lg"
                  style={inputStyle}
                />
                <p id="edit-student-id-help" className="users-edit-hint">G 开头、含 20xx 的完整学号。修改后用新学号登录。</p>
              </div>

              <div>
                <label htmlFor="edit-student-name" className="block text-sm font-medium mb-1" style={{ color: 'var(--text-tertiary)' }}>姓名</label>
                <input
                  id="edit-student-name"
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="填写学生姓名"
                  disabled={editLoading}
                  maxLength={50}
                  className="w-full px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  style={inputStyle}
                />
              </div>

              <div>
                <label htmlFor="edit-student-gender" className="block text-sm font-medium mb-1" style={{ color: 'var(--text-tertiary)' }}>性别</label>
                <select id="edit-student-gender" value={editGender ?? ''} onChange={event => setEditGender((event.target.value || null) as User['gender'])} disabled={editLoading} className="w-full px-3 py-2 rounded-lg" style={inputStyle}>
                  <option value="">未填写</option><option value="male">男</option><option value="female">女</option>
                </select>
              </div>

              <div>
                <label htmlFor="edit-school-class" className="block text-sm font-medium mb-1" style={{ color: 'var(--text-tertiary)' }}>学校班级</label>
                <select id="edit-school-class" value={editSchoolClass} onChange={event => setEditSchoolClass(event.target.value)} disabled={editLoading} className="w-full px-3 py-2 rounded-lg" style={inputStyle}>
                  <option value="">未填写</option>{['高一', '高二', '高三'].flatMap(grade => [1, 2, 3, 4, 5, 6, 7].map(number => { const value = `${grade}（${number}）班`; return <option key={value} value={value}>{value}</option>; }))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-tertiary)' }}>教学分组（仅教师设置）</label>
                <div role="group" aria-label="学生班级" className="flex gap-3">{TEACHING_CLASSES.map(item => <button key={item.name} type="button" disabled={editLoading} aria-pressed={editClassName === item.name}
                  className="flex-1 px-3 py-2 rounded-lg border" style={{ ...inputStyle, background: editClassName === item.name ? 'var(--teacher-accent)' : 'var(--bg-secondary)', color: editClassName === item.name ? '#263719' : 'var(--text-primary)' }}
                  onClick={() => { setEditClassName(item.name); setEditExperimentGroup(item.group); }}>{item.name}</button>)}</div>
                {!isTeachingClass(editClassName) && <p className="text-sm mt-2" style={{ color: 'var(--text-tertiary)' }}>当前：{editClassName || '未分班'}。选班后保存，才会调整归属。</p>}
              </div>

              <p className="users-edit-hint">改班只影响后续任务。已提交的作品、答卷和原班级记录不变。</p>

              <div className="flex items-center gap-3">
                <label className="text-sm font-medium" style={{ color: 'var(--text-tertiary)' }}>账户状态</label>
                <button
                  disabled={editLoading}
                  onClick={() => setEditIsActive(!editIsActive)}
                  className="users-status-toggle"
                  role="switch"
                  aria-label="启用账号"
                  aria-checked={editIsActive}
                >
                  <span />
                </button>
                <span className="text-sm" style={{ color: 'var(--text-light)' }}>
                  {editIsActive ? '正常' : '已停用'}
                </span>
              </div>

              {editError && (
                <p role="alert" className="text-sm text-red-500">{editError}</p>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={closeEdit}
                  disabled={editLoading}
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
                  {editLoading ? '保存中…' : '保存'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resetUser && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div ref={resetDialog} role="dialog" aria-modal="true" aria-labelledby="reset-password-title" tabIndex={-1} className="glass-card users-dialog rounded-2xl p-6 w-full max-w-md mx-4" style={{ maxHeight: '92dvh', overflowY: 'auto' }}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <KeyRound size={20} style={{ color: '#f59e0b' }} />
                <h2 id="reset-password-title" className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>帮助学生重设密码</h2>
              </div>
              <button
                onClick={closeReset}
                disabled={resetLoading}
                aria-label="关闭重设密码"
                className="p-1 rounded-lg transition-opacity hover:opacity-60"
                style={{ color: 'var(--text-light)' }}
              >
                <X size={20} />
              </button>
            </div>

            <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>系统不保存可查看的原密码。学生忘记密码时，教师可以在核对身份后设置新密码。</p>

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
                  onClick={closeReset}
                  className="w-full px-4 py-2 rounded-lg bg-indigo-600 text-white hover:opacity-90 transition-opacity"
                >
                  关闭
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label htmlFor="teacher-reset-password" className="block text-sm font-medium mb-1" style={{ color: 'var(--text-tertiary)' }}>新密码</label>
                  <input
                    id="teacher-reset-password"
                    type="password"
                    autoComplete="new-password"
                    disabled={resetLoading}
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                    placeholder="至少 6 位"
                    className="w-full px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label htmlFor="teacher-reset-password-confirm" className="block text-sm font-medium mb-1" style={{ color: 'var(--text-tertiary)' }}>确认新密码</label>
                  <input
                    id="teacher-reset-password-confirm"
                    type="password"
                    autoComplete="new-password"
                    disabled={resetLoading}
                    value={resetConfirm}
                    onChange={(e) => setResetConfirm(e.target.value)}
                    placeholder="再次输入新密码"
                    className="w-full px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                    style={inputStyle}
                  />
                </div>

                <label className="flex items-start gap-2" style={{ color: 'var(--text-secondary)' }}><input type="checkbox" checked={resetAcknowledged} disabled={resetLoading} onChange={event => setResetAcknowledged(event.target.checked)} className="mt-1" />我已核对学生身份，并告知原密码将失效。</label>

                {resetError && (
                  <p role="alert" className="text-sm text-red-500">{resetError}</p>
                )}

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={closeReset}
                    disabled={resetLoading}
                    className="flex-1 px-4 py-2 rounded-lg border transition-opacity hover:opacity-70"
                    style={{ borderColor: 'var(--glass-border)', color: 'var(--text-secondary)' }}
                  >
                    取消
                  </button>
                  <button
                    onClick={handleResetSave}
                    disabled={resetLoading || !resetAcknowledged}
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

      <header className="users-heading">
        <div><h1>学生管理</h1><p>查看学生信息、分班和账号状态。</p></div>
        <p className="users-password-help">忘记密码？点击学生右侧的钥匙重设，原密码不可查看。</p>
      </header>
      {saveNotice && <p className="users-save-notice" role="status">{saveNotice}</p>}
      {bulkError && <p className="classroom-error" role="alert">{bulkError}</p>}
      <div className="users-toolbar">
        <label className="users-search">
          <Search size={18} aria-hidden="true" />
          <input type="search" aria-label="搜索学生" disabled={bulkLoading} placeholder="搜索姓名、学号或邮箱" value={query} onChange={e => handleSearch(e.target.value)} />
        </label>
        <select aria-label="按教学分组筛选" value={groupFilter} disabled={bulkLoading} onChange={event => { setGroupFilter(event.target.value); setPage(1); setSelectedIds(new Set()); }}>
          <option value="">全部账号</option><option value="unassigned">未分组学生</option>{TEACHING_CLASSES.map(item => <option key={item.group} value={item.group}>{item.name}</option>)}
        </select>
        <button type="button" disabled={bulkLoading} onClick={() => void selectUnassigned()}>全选未分组（跨页）</button>
        <button type="button" disabled={loading || bulkLoading} onClick={() => void loadUsers()}>刷新名单</button>
        <span className="users-count" aria-live="polite">{loading ? '正在读取…' : query ? '找到 ' + total + ' 个账号' : '共 ' + total + ' 个账号'}</span>
      </div>

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div className="users-bulk-bar">
          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            已选 {selectedIds.size} 位用户
          </span>
          <div className="flex gap-2">
            {TEACHING_CLASSES.map(item => <button key={item.name} className="users-assign-button" disabled={bulkLoading} onClick={() => void assignSelected(item.name)}>分入{item.name}</button>)}
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
              disabled={bulkLoading}
              className="px-3 py-1.5 rounded-lg text-sm transition-colors"
              style={{ color: 'var(--text-light)' }}
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* Users Table */}
      <div className="users-table-panel">
        <div className="users-table-scroll" role="region" aria-label="学生名单" tabIndex={0}>
          <table className="users-table">
            <thead>
              <tr>
                <th className="px-4 py-4 text-left">
                  <input
                    type="checkbox"
                    aria-label="选择本页全部学生"
                    checked={users.some(u => ['learner', 'student', 'user'].includes(u.role)) && users.filter(u => ['learner', 'student', 'user'].includes(u.role)).every(u => selectedIds.has(u.id))}
                    disabled={loading || bulkLoading}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded accent-indigo-500 cursor-pointer"
                  />
                </th>
                <th className="px-6 py-4 text-left text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>学号</th>
                <th className="px-6 py-4 text-left text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>姓名</th>
                <th className="px-6 py-4 text-left text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>性别</th>
                <th className="px-6 py-4 text-left text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>角色</th>
                <th className="px-6 py-4 text-left text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>班级</th>
                <th className="px-6 py-4 text-left text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>作品提交</th>
                <th className="px-6 py-4 text-left text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>账号状态</th>
                <th className="px-6 py-4 text-left text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>最后活跃</th>
                <th className="px-6 py-4 text-left text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} className="px-6 py-12 text-center">
                    <div className="flex justify-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
                    </div>
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-6 py-12 text-center" style={{ color: 'var(--text-light)' }}>
                    暂无用户
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr
                    key={user.id}
                    className={selectedIds.has(user.id) ? 'is-selected' : ''}
                  >
                    <td className="px-4 py-4">
                      <input
                        type="checkbox"
                        aria-label={'选择' + user.name}
                        checked={selectedIds.has(user.id)}
                        disabled={bulkLoading || !['learner', 'student', 'user'].includes(user.role)}
                        onChange={() => toggleSelect(user.id)}
                        onClick={e => e.stopPropagation()}
                        className="w-4 h-4 rounded accent-indigo-500 cursor-pointer"
                      />
                    </td>
                    <td className="px-6 py-4 text-sm font-mono" style={{ color: 'var(--text-primary)' }}>{user.student_id}</td>
                    <td className="px-6 py-4 text-sm" style={{ color: 'var(--text-primary)' }}>{user.name}</td>
                    <td className="px-6 py-4 text-sm" style={{ color: 'var(--text-light)' }}>{user.gender === 'male' ? '男' : user.gender === 'female' ? '女' : '未填写'}</td>
                    <td className="px-6 py-4 text-sm">
                      <span className="users-badge users-role">{ROLE_LABELS[user.role] || '其他'}</span>
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <div className="font-medium" style={{ color: 'var(--text-primary)' }}>{user.school_class || user.class_name || '—'}</div>
                      {user.school_class && user.class_name && <div className="users-group-note">{user.class_name}</div>}
                      {!isTeachingClass(user.class_name || '') && <div className="users-group-note">{GROUP_LABELS[user.experiment_group || 'unassigned']}</div>}
                    </td>
                    <td className="users-work-count" title={user.last_submitted_at ? `最近提交：${new Date(user.last_submitted_at).toLocaleString('zh-CN')}` : '尚未提交作品'}>
                      <strong>{user.submission_count ?? 0} 份</strong>
                      <span>下载 {user.download_count ?? 0} 次</span>
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <span className={'users-badge ' + (user.is_active ? 'is-active' : 'is-inactive')}><i aria-hidden="true" />{user.is_active ? '正常' : '已停用'}</span>
                    </td>
                    <td className="px-6 py-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {user.last_active_at ? new Date(user.last_active_at).toLocaleDateString('zh-CN') : '—'}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <div className="users-row-actions">
                        <button
                          onClick={() => navigate(`/users/${user.id}`)}
                          className="users-icon-button"
                          title="查看详情"
                          aria-label="查看详情"
                        >
                          <Eye size={16} />
                        </button>
                        <button
                          onClick={(e) => handleEdit(e, user)}
                          className="users-icon-button"
                          title="编辑用户"
                          aria-label="编辑用户"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={(e) => handleOpenReset(e, user)}
                          className="users-icon-button"
                          title="重置密码"
                          aria-label="重置密码"
                        >
                          <KeyRound size={16} />
                        </button>
                        <button
                          onClick={(e) => handleExportUser(e, user)}
                          className="users-icon-button"
                          title="导出用户数据 (CSV)"
                          aria-label="导出用户数据 (CSV)"
                        >
                          <Download size={16} />
                        </button>
                        <button
                          onClick={(e) => handleDelete(e, user)}
                          className="users-icon-button is-danger"
                          title="删除用户"
                          aria-label="删除用户"
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
          <div className="users-pagination">
            <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              共 {total} 位，第 {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} 位
            </div>
            <div className="flex space-x-2">
              <button
                aria-label="上一页"
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
                aria-label="下一页"
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
