import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Archive, Trash2, Users, ChevronDown, ChevronUp, Loader, X, CheckCircle, Download, GitBranch } from 'lucide-react';
import { adminApi } from '../lib/adminApi';
import type { ResearchTask, ResearchTaskSubmission } from '../types';
import { ResearchBlueprintEditor } from './ResearchBlueprintEditor';

// ── CSV helpers ──────────────────────────────────────────────────────────────

export const normalizeIso = (iso: string): string =>
  /Z$|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z';

export const formatDate = (iso: string): string => {
  const d = new Date(normalizeIso(iso));
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const downloadResearchCSV = (submissions: ResearchTaskSubmission[], taskTitle: string) => {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const headers = ['序号', '姓名', '学号', '完成状态', '所用时间(秒)', '提交时间', '代码'];
  const rows = submissions.map((sub, i) => {
    const durationSec = sub.started_at && sub.submitted_at
      ? String(Math.round((new Date(sub.submitted_at).getTime() - new Date(sub.started_at).getTime()) / 1000))
      : '';
    return [
      String(i + 1),
      sub.user_name || '',
      sub.student_id || sub.user_id.slice(0, 8),
      sub.is_completed ? '已完成' : '进行中',
      durationSec,
      sub.submitted_at ? formatDate(sub.submitted_at) : (sub.created_at ? formatDate(sub.created_at) : ''),
      sub.code_submitted || '',
    ].map(esc).join(',');
  });

  const csv = '\uFEFF' + [headers.map(esc).join(','), ...rows].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${taskTitle}_提交记录_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
};

const STATUS_LABEL: Record<string, string> = { active: '活跃', draft: '草稿', archived: '已归档' };
const TARGET_GROUPS: Array<{ value: ResearchTask['target_group']; label: string }> = [
  { value: 'all', label: '全部实验组（公共任务）' },
  { value: 'pdt', label: '项目解构式教学组' },
  { value: 'ai_pbl', label: '常规 AI 协作' },
  { value: 'lecture', label: '历史讲授组' },
  { value: 'unassigned', label: '未分组学生' },
];

export const ResearchManagement = () => {
  const [tasks, setTasks] = useState<ResearchTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [submissionsModal, setSubmissionsModal] = useState<{
    task: ResearchTask;
    submissions: ResearchTaskSubmission[];
    loading: boolean;
  } | null>(null);
  const [expandedCode, setExpandedCode] = useState<string | null>(null);
  const [selectedSubmissionIds, setSelectedSubmissionIds] = useState<Set<string>>(new Set());
  const [deletingSubmissions, setDeletingSubmissions] = useState(false);
  const [blueprintTask, setBlueprintTask] = useState<ResearchTask | null>(null);

  const [exportingRow, setExportingRow] = useState<string | null>(null);

  const loadTasks = async (showLoading = true) => {
    try {
      if (showLoading) setLoading(true);
      setError('');
      const result = await adminApi.getResearchTasks();
      setTasks(result.tasks
        .filter(task => task.task_kind === 'learning')
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .slice(0, 1));
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  useEffect(() => { loadTasks(); }, []);

  const handleActivate = async (taskId: string) => {
    try {
      await adminApi.activateResearchTask(taskId);
      await loadTasks();
    } catch (e) {
      setError(e instanceof Error ? e.message : '激活失败');
    }
  };

  const handleArchive = async (taskId: string) => {
    try {
      await adminApi.archiveResearchTask(taskId);
      await loadTasks();
    } catch (e) {
      setError(e instanceof Error ? e.message : '归档失败');
    }
  };

  const handleViewSubmissions = async (task: ResearchTask) => {
    setSelectedSubmissionIds(new Set());
    setSubmissionsModal({ task, submissions: [], loading: true });
    try {
      const result = await adminApi.getResearchTaskSubmissions(task.id);
      setSubmissionsModal({ task, submissions: result.submissions, loading: false });
    } catch (e) {
      setSubmissionsModal({ task, submissions: [], loading: false });
    }
  };

  const handleDeleteSelectedSubmissions = async () => {
    if (selectedSubmissionIds.size === 0 || !submissionsModal) return;
    if (!window.confirm(`确定要删除选中的 ${selectedSubmissionIds.size} 条提交记录？此操作不可撤销。`)) return;
    setDeletingSubmissions(true);
    try {
      await adminApi.deleteResearchSubmissions(Array.from(selectedSubmissionIds));
      const remaining = submissionsModal.submissions.filter(s => !selectedSubmissionIds.has(s.id));
      setSubmissionsModal({ ...submissionsModal, submissions: remaining });
      setSelectedSubmissionIds(new Set());
      await loadTasks();
    } catch (e) {
      alert('删除失败：' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setDeletingSubmissions(false);
    }
  };

  const handleExportFromRow = async (task: ResearchTask) => {
    setExportingRow(task.id);
    try {
      const result = await adminApi.getResearchTaskSubmissions(task.id);
      downloadResearchCSV(result.submissions, task.title);
    } catch (err) {
      alert('加载数据失败：' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setExportingRow(null);
    }
  };

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
      <div className="glass-card rounded-2xl p-6 flex items-center justify-between gap-6">
        <div>
          <p className="text-xs font-bold tracking-widest mb-2" style={{ color: 'var(--brand-green)' }}>PROJECT 01 / LEARNING</p>
          <h1 className="text-3xl font-bold mb-2">贪吃蛇学习项目</h1>
          <p style={{ color: 'var(--text-secondary)' }}>本次实验固定使用该项目。教师可管理蓝图、发布状态与过程数据，不再创建其他学习任务。</p>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="glass-card p-4 rounded-xl border" style={{ background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.3)' }}>
          <p style={{ color: '#ef4444' }}>{error}</p>
        </div>
      )}

      {/* Task Table */}
      <div className="glass-card rounded-2xl overflow-hidden stagger-2">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead style={{ backgroundColor: 'var(--bg-tertiary)' }}>
              <tr>
                <th className="px-6 py-4 text-left text-sm font-semibold dark:text-white">任务名称</th>
                <th className="px-6 py-4 text-left text-sm font-semibold dark:text-white">语言</th>
                <th className="px-6 py-4 text-left text-sm font-semibold dark:text-white">适用实验组</th>
                <th className="px-6 py-4 text-left text-sm font-semibold dark:text-white">状态</th>
                <th className="px-6 py-4 text-left text-sm font-semibold dark:text-white">提交数</th>
                <th className="px-6 py-4 text-left text-sm font-semibold dark:text-white">创建时间</th>
                <th className="px-6 py-4 text-left text-sm font-semibold dark:text-white">操作</th>
              </tr>
            </thead>
            <tbody>
              {tasks.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                    固定贪吃蛇项目尚未就绪；后端重启后会自动补齐，不需要教师手工创建。
                  </td>
                </tr>
              ) : (
                tasks.map((task) => (
                  <tr
                    key={task.id}
                    className="border-t hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    style={{ borderColor: 'var(--glass-border)' }}
                  >
                    <td className="px-6 py-4 text-sm">
                      <p className="font-medium">{task.title}</p>
                      {task.description && (
                        <p className="text-xs mt-0.5 truncate max-w-xs" style={{ color: 'var(--text-light)' }}>{task.description}</p>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded-lg text-xs font-mono">
                        {task.language}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {TARGET_GROUPS.find(group => group.value === task.target_group)?.label || task.target_group}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <span className={`px-3 py-1 rounded-lg text-xs font-semibold inline-flex items-center gap-1 ${
                        task.status === 'active'
                          ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300'
                          : task.status === 'draft'
                          ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
                      }`}>
                        {task.status === 'active' && <CheckCircle size={12} />}
                        {STATUS_LABEL[task.status]}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {task.submissions_count ?? 0} 份
                    </td>
                    <td className="px-6 py-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {new Date(task.created_at).toLocaleDateString('zh-CN')}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <div className="flex gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); setBlueprintTask(task); }}
                          className="p-2 rounded-lg transition-colors"
                          style={{ color: '#161713', background: task.current_blueprint_version_id ? 'var(--brand-purple)' : 'var(--surface-muted)', border: '1px solid var(--line-strong)' }}
                          title={task.current_blueprint_version_id ? '编辑项目蓝图（已有发布版本）' : '配置项目蓝图'}
                        >
                          <GitBranch size={14} />
                        </button>
                        {task.status !== 'active' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleActivate(task.id); }}
                            className="px-3 py-1 rounded-lg bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-800 transition-colors text-xs font-semibold"
                          >
                            激活
                          </button>
                        )}
                        {task.status === 'active' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleArchive(task.id); }}
                            className="p-2 rounded-lg bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-200 dark:hover:bg-yellow-800 transition-colors"
                            title="归档任务"
                          >
                            <Archive size={14} />
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleViewSubmissions(task); }}
                          className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-800 transition-colors"
                          title="查看提交记录"
                        >
                          <Users size={14} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleExportFromRow(task); }}
                          disabled={exportingRow === task.id}
                          className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-800 transition-colors disabled:opacity-50"
                          title="导出提交记录 CSV"
                        >
                          {exportingRow === task.id
                            ? <Loader size={14} className="animate-spin" />
                            : <Download size={14} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Submissions Modal — rendered via portal to escape layout overflow */}
      {submissionsModal && createPortal(
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
          <div className="glass-card rounded-2xl w-full max-w-3xl max-h-[80vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-white/10">
              <div>
                <h2 className="text-xl font-bold">学生提交记录</h2>
                <p className="text-sm mt-0.5" style={{ color: 'var(--text-light)' }}>{submissionsModal.task.title}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => !submissionsModal.loading && downloadResearchCSV(submissionsModal.submissions, submissionsModal.task.title)}
                  disabled={submissionsModal.loading || submissionsModal.submissions.length === 0}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-800 transition-colors text-sm font-semibold disabled:opacity-50"
                >
                  <Download size={15} />
                  导出 CSV
                </button>
                <button
                  onClick={() => { setSubmissionsModal(null); setSelectedSubmissionIds(new Set()); }}
                  className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Bulk Action Bar */}
            {selectedSubmissionIds.size > 0 && (
              <div className="px-6 py-2.5 flex items-center justify-between gap-3 border-b border-white/10"
                style={{ background: 'rgba(239,68,68,0.06)' }}>
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  已选 {selectedSubmissionIds.size} 条记录
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={handleDeleteSelectedSubmissions}
                    disabled={deletingSubmissions}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                    style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}
                  >
                    <Trash2 size={13} />
                    {deletingSubmissions ? '删除中...' : '删除所选'}
                  </button>
                  <button
                    onClick={() => setSelectedSubmissionIds(new Set())}
                    className="px-3 py-1.5 rounded-lg text-xs transition-colors"
                    style={{ color: 'var(--text-light)' }}
                  >
                    取消
                  </button>
                </div>
              </div>
            )}

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6">
              {submissionsModal.loading ? (
                <div className="flex justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" />
                </div>
              ) : submissionsModal.submissions.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p>暂无学生提交记录</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {submissionsModal.submissions.map((sub) => {
                    const isSelected = selectedSubmissionIds.has(sub.id);
                    return (
                    <div key={sub.id} className="border rounded-xl overflow-hidden transition-colors"
                      style={{ borderColor: isSelected ? 'rgba(99,102,241,0.5)' : 'var(--glass-border)', background: isSelected ? 'rgba(99,102,241,0.05)' : undefined }}>
                      <div
                        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                        style={{ backgroundColor: isSelected ? 'transparent' : 'var(--bg-tertiary)' }}
                        onClick={() => setSelectedSubmissionIds(prev => {
                          const next = new Set(prev);
                          isSelected ? next.delete(sub.id) : next.add(sub.id);
                          return next;
                        })}
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => setSelectedSubmissionIds(prev => {
                              const next = new Set(prev);
                              isSelected ? next.delete(sub.id) : next.add(sub.id);
                              return next;
                            })}
                            onClick={e => e.stopPropagation()}
                            className="w-3.5 h-3.5 rounded accent-indigo-500 cursor-pointer shrink-0"
                          />
                          <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                            {(sub.user_name || 'U')[0].toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-medium">{sub.user_name || '—'}</p>
                            <p className="text-xs font-mono" style={{ color: 'var(--text-light)' }}>
                              {sub.student_id || sub.user_id.slice(0, 8)}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${
                            sub.is_completed
                              ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300'
                              : 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300'
                          }`}>
                            {sub.is_completed ? '已完成' : '进行中'}
                          </span>
                          {sub.started_at && sub.submitted_at && (() => {
                            const sec = Math.round((new Date(normalizeIso(sub.submitted_at)).getTime() - new Date(normalizeIso(sub.started_at)).getTime()) / 1000);
                            const mm = Math.floor(sec / 60).toString().padStart(2, '0');
                            const ss = (sec % 60).toString().padStart(2, '0');
                            return (
                              <span className="text-xs font-mono text-gray-400">⏱ {mm}:{ss}</span>
                            );
                          })()}
                          <span className="text-xs text-gray-400">
                            {sub.submitted_at
                              ? new Date(normalizeIso(sub.submitted_at)).toLocaleString('zh-CN')
                              : new Date(normalizeIso(sub.created_at)).toLocaleString('zh-CN')}
                          </span>
                          <button
                            onClick={e => { e.stopPropagation(); setExpandedCode(expandedCode === sub.id ? null : sub.id); }}
                            className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
                          >
                            {expandedCode === sub.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </button>
                        </div>
                      </div>
                      {expandedCode === sub.id && (
                        <pre className="px-4 py-3 text-xs font-mono overflow-x-auto max-h-64 overflow-y-auto" style={{ color: 'var(--text-secondary)', background: 'var(--bg-tertiary)' }}>
                          {sub.code_submitted || '（空）'}
                        </pre>
                      )}
                    </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          </div>
        </div>,
        document.body
      )}

      {blueprintTask && (
        <ResearchBlueprintEditor
          task={blueprintTask}
          onClose={() => setBlueprintTask(null)}
          onPublished={async blueprintVersionId => {
            setBlueprintTask(current => current
              ? { ...current, current_blueprint_version_id: blueprintVersionId }
              : current);
            await loadTasks(false);
          }}
        />
      )}
    </div>
  );
};
