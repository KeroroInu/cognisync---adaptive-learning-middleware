import { useState, useEffect, useRef } from 'react';
import { FlaskConical, Plus, Play, Archive, Trash2, Users, ChevronDown, ChevronUp, Loader, Upload, X, CheckCircle } from 'lucide-react';
import { adminApi } from '../lib/adminApi';
import type { ResearchTask, ResearchTaskSubmission } from '../types';

const LANGUAGES = [
  { value: 'python', label: 'Python' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'java', label: 'Java' },
  { value: 'cpp', label: 'C++' },
  { value: 'go', label: 'Go' },
  { value: 'other', label: 'Other' },
];

const STATUS_LABEL: Record<string, string> = { active: '活跃', draft: '草稿', archived: '已归档' };

export const ResearchManagement = () => {
  const [tasks, setTasks] = useState<ResearchTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [submissionsModal, setSubmissionsModal] = useState<{
    task: ResearchTask;
    submissions: ResearchTaskSubmission[];
    loading: boolean;
  } | null>(null);
  const [expandedCode, setExpandedCode] = useState<string | null>(null);

  // Create form state
  const [form, setForm] = useState({
    title: '',
    description: '',
    instructions: '',
    code_content: '',
    language: 'python',
  });
  const [creating, setCreating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadTasks = async () => {
    try {
      setLoading(true);
      setError('');
      const result = await adminApi.getResearchTasks();
      setTasks(result.tasks);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadTasks(); }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setForm(f => ({ ...f, code_content: ev.target?.result as string || '' }));
    };
    reader.readAsText(file);
  };

  const handleCreate = async () => {
    if (!form.title.trim() || !form.code_content.trim()) return;
    try {
      setCreating(true);
      await adminApi.createResearchTask({
        title: form.title,
        description: form.description || undefined,
        instructions: form.instructions || undefined,
        code_content: form.code_content,
        language: form.language,
      });
      setShowCreateModal(false);
      setForm({ title: '', description: '', instructions: '', code_content: '', language: 'python' });
      await loadTasks();
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建失败');
    } finally {
      setCreating(false);
    }
  };

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

  const handleDelete = async (e: React.MouseEvent, taskId: string) => {
    e.stopPropagation();
    if (!confirm('确定要删除这个任务吗？所有学生提交记录也会被删除。')) return;
    try {
      await adminApi.deleteResearchTask(taskId);
      await loadTasks();
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    }
  };

  const handleViewSubmissions = async (task: ResearchTask) => {
    setSubmissionsModal({ task, submissions: [], loading: true });
    try {
      const result = await adminApi.getResearchTaskSubmissions(task.id);
      setSubmissionsModal({ task, submissions: result.submissions, loading: false });
    } catch (e) {
      setSubmissionsModal({ task, submissions: [], loading: false });
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">教学研究</h1>
          <p className="text-gray-700 dark:text-gray-300">管理代码填空练习任务与学生提交记录</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-6 py-3 rounded-xl font-medium bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:shadow-lg hover:scale-105 transition-all duration-300"
        >
          <Plus size={20} />
          创建任务
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <div className="glass-card p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
          <p className="text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* Task Table */}
      <div className="glass-card rounded-2xl overflow-hidden stagger-2">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead style={{ backgroundColor: 'var(--bg-tertiary)' }}>
              <tr>
                <th className="px-6 py-4 text-left text-sm font-semibold">任务名称</th>
                <th className="px-6 py-4 text-left text-sm font-semibold">语言</th>
                <th className="px-6 py-4 text-left text-sm font-semibold">状态</th>
                <th className="px-6 py-4 text-left text-sm font-semibold">提交数</th>
                <th className="px-6 py-4 text-left text-sm font-semibold">创建时间</th>
                <th className="px-6 py-4 text-left text-sm font-semibold">操作</th>
              </tr>
            </thead>
            <tbody>
              {tasks.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                    暂无研究任务，点击「创建任务」上传代码填空练习
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
                        <p className="text-xs text-gray-500 mt-0.5 truncate max-w-xs">{task.description}</p>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded-lg text-xs font-mono">
                        {task.language}
                      </span>
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
                    <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">
                      {task.submissions_count ?? 0} 份
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">
                      {new Date(task.created_at).toLocaleDateString('zh-CN')}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <div className="flex gap-2">
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
                          onClick={(e) => handleDelete(e, task.id)}
                          className="p-2 rounded-lg bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-800 transition-colors"
                          title="删除任务"
                        >
                          <Trash2 size={14} />
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

      {/* Create Task Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass-card rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto stagger-1">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold">创建研究任务</h2>
              <button
                onClick={() => { setShowCreateModal(false); setForm({ title: '', description: '', instructions: '', code_content: '', language: 'python' }); }}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">任务标题 *</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)' }}
                  placeholder="例：Python 列表推导式填空练习"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">任务描述</label>
                <textarea
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 resize-none"
                  style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)' }}
                  placeholder="简短描述任务目的..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">给学生的说明</label>
                <textarea
                  value={form.instructions}
                  onChange={e => setForm(f => ({ ...f, instructions: e.target.value }))}
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 resize-none"
                  style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)' }}
                  placeholder="例：请填写所有标注 TODO 的空白处，完成后点击「完成任务」。"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">编程语言 *</label>
                <select
                  value={form.language}
                  onChange={e => setForm(f => ({ ...f, language: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)' }}
                >
                  {LANGUAGES.map(l => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium">代码内容 *</label>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:underline transition-colors"
                  >
                    <Upload size={13} />
                    上传文件
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".py,.js,.ts,.java,.cpp,.c,.go,.txt"
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                </div>
                <textarea
                  value={form.code_content}
                  onChange={e => setForm(f => ({ ...f, code_content: e.target.value }))}
                  rows={12}
                  className="w-full px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 font-mono text-sm resize-none"
                  style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)' }}
                  placeholder="# 在此粘贴代码，或点击「上传文件」&#10;&#10;def bubble_sort(arr):&#10;    # TODO: 实现冒泡排序&#10;    pass"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  支持直接粘贴代码，也可上传 .py / .js / .java / .cpp 等文件
                </p>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => { setShowCreateModal(false); setForm({ title: '', description: '', instructions: '', code_content: '', language: 'python' }); }}
                className="flex-1 px-4 py-2 rounded-lg border hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors"
                style={{ borderColor: 'var(--glass-border)' }}
              >
                取消
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !form.title.trim() || !form.code_content.trim()}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {creating ? <Loader size={16} className="animate-spin" /> : <Plus size={16} />}
                {creating ? '创建中...' : '创建任务'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Submissions Modal */}
      {submissionsModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass-card rounded-2xl w-full max-w-3xl max-h-[80vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-white/10">
              <div>
                <h2 className="text-xl font-bold">学生提交记录</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{submissionsModal.task.title}</p>
              </div>
              <button
                onClick={() => setSubmissionsModal(null)}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

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
                  {submissionsModal.submissions.map((sub) => (
                    <div key={sub.id} className="border rounded-xl overflow-hidden" style={{ borderColor: 'var(--glass-border)' }}>
                      <div
                        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                        style={{ backgroundColor: 'var(--bg-tertiary)' }}
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                            {(sub.user_name || sub.user_email || 'U')[0].toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-medium">{sub.user_name || '—'}</p>
                            <p className="text-xs text-gray-500 font-mono">{sub.user_email || sub.user_id.slice(0, 8)}</p>
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
                          <span className="text-xs text-gray-400">
                            {sub.submitted_at
                              ? new Date(sub.submitted_at).toLocaleString('zh-CN')
                              : new Date(sub.created_at).toLocaleString('zh-CN')}
                          </span>
                          <button
                            onClick={() => setExpandedCode(expandedCode === sub.id ? null : sub.id)}
                            className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
                          >
                            {expandedCode === sub.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </button>
                        </div>
                      </div>
                      {expandedCode === sub.id && (
                        <pre className="px-4 py-3 text-xs font-mono text-gray-700 dark:text-gray-300 bg-gray-900/5 dark:bg-gray-900/50 overflow-x-auto max-h-64 overflow-y-auto">
                          {sub.code_submitted || '（空）'}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
