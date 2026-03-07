import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { adminApi } from '../lib/adminApi';
import type { ScaleTemplate, ScaleResponse } from '../types';
import { Upload, CheckCircle, Archive, Eye, Trash2, Download, X, Loader, ChevronDown, ChevronRight } from 'lucide-react';

const ADMIN_KEY = (import.meta.env.VITE_ADMIN_KEY as string) || '';

// 状态规范化（兼容数据库存储的大小写）
const normalizeStatus = (s: string) => s.toLowerCase();

// 状态中文标签
const STATUS_LABEL: Record<string, string> = {
  active: '活跃',
  draft: '草稿',
  archived: '已归档',
};

// ── CSV 导出列定义 ──────────────────────────────────────────
const FIXED_COLS = [
  { key: 'index',         label: '序号',    group: '基本信息' },
  { key: 'created_at',   label: '提交时间', group: '基本信息' },
  { key: 'duration_sec', label: '所用时间(秒)', group: '基本信息' },
  { key: 'student_id',   label: '学号',    group: '基本信息' },
  { key: 'user_name',    label: '姓名',    group: '基本信息' },
  { key: 'cognition',    label: '认知分',  group: '分数信息' },
  { key: 'affect',       label: '情感分',  group: '分数信息' },
  { key: 'behavior',     label: '行为分',  group: '分数信息' },
  { key: 'total_score',  label: '总分',    group: '分数信息' },
  { key: 'max_score',    label: '满分',    group: '分数信息' },
] as const;

type FixedColKey = typeof FIXED_COLS[number]['key'];

// 补充 'Z' 使无时区信息的 UTC 字符串被正确解析为 UTC，再转本地时间显示
const normalizeIso = (iso: string): string =>
  /Z$|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z';

const formatDate = (iso: string): string => {
  const d = new Date(normalizeIso(iso));
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const getCellValue = (col: string, resp: ScaleResponse, idx: number): string => {
  const scores = resp.scores_json as Record<string, unknown>;
  const answers = resp.answers_json as Record<string, unknown>;
  switch (col as FixedColKey) {
    case 'index':       return String(idx + 1);
    case 'created_at':  return resp.created_at ? formatDate(resp.created_at) : '';
    case 'duration_sec': {
      if (!resp.started_at || !resp.created_at) return '';
      const diff = Math.round((new Date(resp.created_at).getTime() - new Date(resp.started_at).getTime()) / 1000);
      return diff >= 0 ? String(diff) : '';
    }
    case 'student_id':  return resp.student_id || '';
    case 'user_name':   return resp.user_name || '';
    case 'cognition':   return scores?.cognition != null ? String(scores.cognition) : '';
    case 'affect':      return scores?.affect != null ? String(scores.affect) : '';
    case 'behavior':    return scores?.behavior != null ? String(scores.behavior) : '';
    case 'total_score': return scores?.total_score != null ? String(scores.total_score) : '';
    case 'max_score':   return scores?.max_score != null ? String(scores.max_score) : '';
    default:            return answers?.[col] != null ? String(answers[col]) : '';
  }
};

const downloadCSV = (
  responses: ScaleResponse[],
  scaleName: string,
  selected: Set<string>,
  questionCols: Array<{ key: string; label: string }>
) => {
  const allCols = [
    ...FIXED_COLS.map(c => ({ key: c.key, label: c.label })),
    ...questionCols,
  ].filter(c => selected.has(c.key));

  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const header = allCols.map(c => esc(c.label)).join(',');
  const rows = responses.map((r, i) =>
    allCols.map(c => esc(getCellValue(c.key, r, i))).join(',')
  );
  const csv = '\uFEFF' + [header, ...rows].join('\r\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${scaleName}_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
};

export const Scales = () => {
  const [scales, setScales] = useState<ScaleTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [previewData, setPreviewData] = useState<ScaleTemplate | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // View Responses modal
  const [responsesModal, setResponsesModal] = useState<{ scale: ScaleTemplate; responses: ScaleResponse[]; loading: boolean } | null>(null);
  const [prevRoundExpanded, setPrevRoundExpanded] = useState(false);
  const [exportingScale, setExportingScale] = useState<string | null>(null);
  const [selectedResponseIds, setSelectedResponseIds] = useState<Set<string>>(new Set());
  const [deletingResponses, setDeletingResponses] = useState(false);

  // Export column-selection modal
  const [exportModal, setExportModal] = useState<{
    scale: ScaleTemplate;
    responses: ScaleResponse[];
    selected: Set<string>;
    questionCols: Array<{ key: string; label: string }>;
  } | null>(null);

  useEffect(() => {
    loadScales();
  }, []);

  const loadScales = async () => {
    try {
      setLoading(true);
      const data = await adminApi.getScales();
      setScales(data.templates);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load scales');
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      try {
        const text = file.text();
        text.then((content) => {
          const json = JSON.parse(content);
          setSelectedFile(file);
          setPreviewData(json);
        });
      } catch (err) {
        setError('Invalid JSON file');
      }
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    try {
      setUploading(true);
      const formData = new FormData();
      formData.append('file', selectedFile);
      await adminApi.uploadScale(formData);
      setShowUploadModal(false);
      setSelectedFile(null);
      setPreviewData(null);
      await loadScales();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleActivate = async (scaleId: string) => {
    try {
      await adminApi.activateScale(scaleId);
      await loadScales();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to activate scale');
    }
  };

  const handleArchive = async (scaleId: string) => {
    try {
      await adminApi.archiveScale(scaleId);
      await loadScales();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to archive scale');
    }
  };

  const handleViewResponses = async (scale: ScaleTemplate) => {
    setSelectedResponseIds(new Set());
    setResponsesModal({ scale, responses: [], loading: true });
    try {
      const responses = await adminApi.getScaleResponses(scale.id);
      setResponsesModal({ scale, responses, loading: false });
    } catch (err) {
      setResponsesModal({ scale, responses: [], loading: false });
      console.error(err);
    }
  };

  const handleDeleteSelectedResponses = async () => {
    if (selectedResponseIds.size === 0 || !responsesModal) return;
    if (!window.confirm(`确定要删除选中的 ${selectedResponseIds.size} 条填写记录？此操作不可撤销。`)) return;
    setDeletingResponses(true);
    try {
      await adminApi.deleteScaleResponses(Array.from(selectedResponseIds));
      const remaining = responsesModal.responses.filter(r => !selectedResponseIds.has(r.id));
      setResponsesModal({ ...responsesModal, responses: remaining });
      setSelectedResponseIds(new Set());
      // 刷新量表列表（更新回答数）
      await loadScales();
    } catch (err) {
      alert('删除失败：' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setDeletingResponses(false);
    }
  };

  // 打开列选择导出弹窗（从已加载的 responses 构建列表）
  const openExportModal = (scale: ScaleTemplate, responses: ScaleResponse[]) => {
    // 从第一条响应的 answers_json 提取题目列（按 key 排序）
    const answerKeys = responses.length > 0
      ? Object.keys(responses[0].answers_json as Record<string, unknown>).sort()
      : [];
    // schema_json 存储格式用 items 键（与 forms.py 一致），兼容 questions 键
    const schemaItems = ((scale.schema_json as any)?.items ?? (scale.schema_json as any)?.questions ?? []) as Array<{ id: string; text?: string }>;
    const questionCols = answerKeys.map((k, i) => {
      const q = schemaItems.find(q => q.id === k);
      return { key: k, label: q?.text ? q.text : `Q${i + 1}` };
    });
    // 默认全选；但若无任何 started_at 数据则自动取消"所用时间"列
    const allKeys = [
      ...FIXED_COLS.map(c => c.key),
      ...questionCols.map(c => c.key),
    ];
    const hasTimingData = responses.some(r => r.started_at != null);
    const defaultSelected = new Set(hasTimingData ? allKeys : allKeys.filter(k => k !== 'duration_sec'));
    setExportModal({ scale, responses, questionCols, selected: defaultSelected });
  };

  const handleExportFromRow = async (scale: ScaleTemplate) => {
    setExportingScale(scale.id);
    try {
      const responses = await adminApi.getScaleResponses(scale.id);
      openExportModal(scale, responses);
    } catch (err) {
      alert('加载数据失败：' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setExportingScale(null);
    }
  };

  const handleDelete = async (e: React.MouseEvent, scale: ScaleTemplate) => {
    e.stopPropagation();
    if (window.confirm(`确定要删除量表 "${scale.name}" 吗？这将同时删除所有相关响应记录，此操作不可撤销。`)) {
      try {
        await adminApi.deleteScale(scale.id);
        await loadScales();
      } catch (err) {
        console.error('Failed to delete scale:', err);
        setError(err instanceof Error ? err.message : '删除失败');
      }
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
          <h1 className="text-3xl font-bold mb-2">量表管理</h1>
          <p style={{ color: 'var(--text-secondary)' }}>管理和部署评估量表</p>
        </div>
        <button
          onClick={() => setShowUploadModal(true)}
          className="flex items-center gap-2 px-6 py-3 rounded-xl font-medium bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:shadow-lg hover:scale-105 transition-all duration-300"
        >
          <Upload size={20} />
          上传量表
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <div className="glass-card p-4 rounded-xl border" style={{ background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.3)' }}>
          <p style={{ color: '#ef4444' }}>{error}</p>
        </div>
      )}

      {/* Upload Modal */}
      {showUploadModal && createPortal(
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="glass-card rounded-2xl p-6 max-w-2xl w-full mx-4 max-h-96 overflow-y-auto stagger-1">
            <h2 className="text-2xl font-bold mb-4">上传量表模板</h2>
            <div className="space-y-4">
              {!selectedFile ? (
                <div className="border-2 border-dashed border-indigo-300 dark:border-indigo-700 rounded-xl p-8 text-center cursor-pointer hover:border-indigo-500 transition-colors"
                  onClick={() => document.getElementById('file-input')?.click()}
                >
                  <Upload size={40} className="mx-auto mb-2 text-indigo-500" />
                  <p className="font-semibold mb-1">点击选择 JSON 文件</p>
                  <p className="text-sm" style={{ color: 'var(--text-light)' }}>或拖拽至此</p>
                  <input id="file-input" type="file" accept=".json" onChange={handleFileSelect} className="hidden" />
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                    <p className="text-sm font-semibold text-green-700 dark:text-green-300">已选择：{selectedFile.name}</p>
                  </div>
                  {previewData && (
                    <div>
                      <p className="font-semibold mb-2">预览：</p>
                      <pre className="p-3 rounded-lg text-xs overflow-auto max-h-48" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
                        {JSON.stringify(previewData, null, 2)}
                      </pre>
                    </div>
                  )}
                  <div className="flex gap-3">
                    <button onClick={() => { setSelectedFile(null); setPreviewData(null); }}
                      className="flex-1 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors">
                      取消
                    </button>
                    <button onClick={handleUpload} disabled={uploading}
                      className="flex-1 px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                      {uploading ? '上传中...' : '上传'}
                    </button>
                  </div>
                </div>
              )}
            </div>
            <button onClick={() => { setShowUploadModal(false); setSelectedFile(null); setPreviewData(null); }}
              className="mt-4 transition-colors"
              style={{ color: 'var(--text-light)' }}>
              关闭
            </button>
          </div>
        </div>
      , document.body)}

      {/* View Responses Modal */}
      {responsesModal && createPortal(
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass-card rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-white/10">
              <div>
                <h2 className="text-xl font-bold">{responsesModal.scale.name}</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                  共 {responsesModal.responses.length} 份填写记录
                </p>
              </div>
              <button onClick={() => { setResponsesModal(null); setPrevRoundExpanded(false); setSelectedResponseIds(new Set()); }}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                <X size={20} />
              </button>
            </div>

            {/* Bulk Action Bar */}
            {selectedResponseIds.size > 0 && (
              <div className="px-6 py-2.5 flex items-center justify-between gap-3 border-b"
                style={{ borderColor: 'var(--glass-border)', background: 'rgba(239,68,68,0.06)' }}>
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  已选 {selectedResponseIds.size} 条记录
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={handleDeleteSelectedResponses}
                    disabled={deletingResponses}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                    style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}
                  >
                    <Trash2 size={13} />
                    {deletingResponses ? '删除中...' : '删除所选'}
                  </button>
                  <button
                    onClick={() => setSelectedResponseIds(new Set())}
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
              {responsesModal.loading ? (
                <div className="flex justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" />
                </div>
              ) : responsesModal.responses.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <p>暂无用户填写记录</p>
                </div>
              ) : (() => {
                const activatedAt = responsesModal.scale.activated_at
                  ? new Date(responsesModal.scale.activated_at)
                  : null;
                const currentRound = activatedAt
                  ? responsesModal.responses.filter(r => new Date(r.created_at) >= activatedAt)
                  : responsesModal.responses;
                const prevRounds = activatedAt
                  ? responsesModal.responses.filter(r => new Date(r.created_at) < activatedAt)
                  : [];

                const ResponseTable = ({ rows }: { rows: ScaleResponse[] }) => {
                  const allSelected = rows.length > 0 && rows.every(r => selectedResponseIds.has(r.id));
                  const toggleAll = () => {
                    setSelectedResponseIds(prev => {
                      const next = new Set(prev);
                      if (allSelected) rows.forEach(r => next.delete(r.id));
                      else rows.forEach(r => next.add(r.id));
                      return next;
                    });
                  };
                  return (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10">
                        <th className="py-3 px-2 w-8">
                          <input
                            type="checkbox"
                            checked={allSelected}
                            onChange={toggleAll}
                            className="w-3.5 h-3.5 rounded accent-indigo-500 cursor-pointer"
                          />
                        </th>
                        <th className="text-left py-3 px-2 font-semibold" style={{ color: 'var(--text-light)' }}>学生</th>
                        <th className="text-center py-3 px-2 font-semibold" style={{ color: 'var(--text-light)' }}>认知</th>
                        <th className="text-center py-3 px-2 font-semibold" style={{ color: 'var(--text-light)' }}>情感</th>
                        <th className="text-center py-3 px-2 font-semibold" style={{ color: 'var(--text-light)' }}>行为</th>
                        <th className="text-center py-3 px-2 font-semibold" style={{ color: 'var(--text-light)' }}>总分</th>
                        <th className="text-center py-3 px-2 font-semibold" style={{ color: 'var(--text-light)' }}>填写时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((resp) => {
                        const scores = resp.scores_json as Record<string, number> | null;
                        const isSelected = selectedResponseIds.has(resp.id);
                        return (
                          <tr key={resp.id}
                            className="border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer"
                            onClick={() => setSelectedResponseIds(prev => {
                              const next = new Set(prev);
                              isSelected ? next.delete(resp.id) : next.add(resp.id);
                              return next;
                            })}
                            style={isSelected ? { background: 'rgba(99,102,241,0.08)' } : undefined}
                          >
                            <td className="py-3 px-2" onClick={e => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => setSelectedResponseIds(prev => {
                                  const next = new Set(prev);
                                  isSelected ? next.delete(resp.id) : next.add(resp.id);
                                  return next;
                                })}
                                className="w-3.5 h-3.5 rounded accent-indigo-500 cursor-pointer"
                              />
                            </td>
                            <td className="py-3 px-2">
                              <div className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
                                {resp.user_name || '—'}
                              </div>
                              <div className="text-xs text-gray-500 font-mono">
                                {resp.student_id || resp.user_id.slice(0, 8)}
                              </div>
                            </td>
                            <td className="py-3 px-2 text-center">
                              <span className="px-2 py-0.5 rounded text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 font-mono">
                                {scores?.cognition?.toFixed(0) ?? '—'}
                              </span>
                            </td>
                            <td className="py-3 px-2 text-center">
                              <span className="px-2 py-0.5 rounded text-xs bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 font-mono">
                                {scores?.affect?.toFixed(0) ?? '—'}
                              </span>
                            </td>
                            <td className="py-3 px-2 text-center">
                              <span className="px-2 py-0.5 rounded text-xs bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 font-mono">
                                {scores?.behavior?.toFixed(0) ?? '—'}
                              </span>
                            </td>
                            <td className="py-3 px-2 text-center font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
                              {scores?.total_score ?? '—'} / {scores?.max_score ?? '—'}
                            </td>
                            <td className="py-3 px-2 text-center text-xs text-gray-500">
                              {new Date(normalizeIso(resp.created_at)).toLocaleString('zh-CN')}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  );
                };

                return (
                  <div className="space-y-4">
                    {/* 本轮数据 */}
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                            {prevRounds.length > 0 ? '本轮（后测）' : '当前轮次'}
                          </span>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-300">
                            {currentRound.length} 份
                          </span>
                        </div>
                        <button
                          onClick={() => openExportModal(responsesModal.scale, currentRound)}
                          disabled={currentRound.length === 0}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-800 transition-colors text-xs font-semibold disabled:opacity-40"
                        >
                          <Download size={13} />
                          导出
                        </button>
                      </div>
                      {currentRound.length === 0 ? (
                        <p className="text-sm text-gray-400 text-center py-4">本轮暂无填写记录</p>
                      ) : (
                        <ResponseTable rows={currentRound} />
                      )}
                    </div>

                    {/* 历史轮次（折叠） */}
                    {prevRounds.length > 0 && (
                      <div className="border-t border-white/10 pt-4">
                        <div className="flex items-center justify-between mb-2">
                          <button
                            onClick={() => setPrevRoundExpanded(v => !v)}
                            className="flex items-center gap-2 text-sm font-semibold text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                          >
                            {prevRoundExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            历史数据（前测）
                            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500">
                              {prevRounds.length} 份
                            </span>
                          </button>
                          {prevRoundExpanded && (
                            <button
                              onClick={() => openExportModal(responsesModal.scale, prevRounds)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors text-xs font-semibold"
                            >
                              <Download size={13} />
                              导出
                            </button>
                          )}
                        </div>
                        {prevRoundExpanded && <ResponseTable rows={prevRounds} />}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      , document.body)}

      {/* Scales Table */}
      <div className="glass-card rounded-2xl overflow-hidden stagger-2">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead style={{ backgroundColor: 'var(--bg-tertiary)' }}>
              <tr>
                <th className="px-6 py-4 text-left text-sm font-semibold">量表名称</th>
                <th className="px-6 py-4 text-left text-sm font-semibold">版本</th>
                <th className="px-6 py-4 text-left text-sm font-semibold">状态</th>
                <th className="px-6 py-4 text-left text-sm font-semibold">回答数</th>
                <th className="px-6 py-4 text-left text-sm font-semibold">创建时间</th>
                <th className="px-6 py-4 text-left text-sm font-semibold">操作</th>
              </tr>
            </thead>
            <tbody>
              {scales.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                    暂无量表
                  </td>
                </tr>
              ) : (
                scales.map((scale) => {
                  const status = normalizeStatus(scale.status);
                  return (
                    <tr key={scale.id} className="border-t hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                      style={{ borderColor: 'var(--glass-border)' }}>
                      <td className="px-6 py-4 text-sm font-medium">{scale.name}</td>
                      <td className="px-6 py-4 text-sm">v{scale.version}</td>
                      <td className="px-6 py-4 text-sm">
                        <span className={`px-3 py-1 rounded-lg text-xs font-semibold inline-flex items-center gap-1 ${
                          status === 'active'
                            ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300'
                            : status === 'draft'
                            ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
                        }`}>
                          {status === 'active' && <CheckCircle size={12} />}
                          {STATUS_LABEL[status] ?? status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">
                        {(scale as any).responses_count ?? 0} 份
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">
                        {new Date(scale.created_at).toLocaleDateString('zh-CN')}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <div className="flex gap-2">
                          {(status === 'draft' || status === 'archived') && (
                            <button onClick={(e) => { e.stopPropagation(); handleActivate(scale.id); }}
                              className="px-3 py-1 rounded-lg bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-800 transition-colors text-xs font-semibold">
                              激活
                            </button>
                          )}
                          {status === 'active' && (
                            <button onClick={(e) => { e.stopPropagation(); handleArchive(scale.id); }}
                              className="p-2 rounded-lg bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-200 dark:hover:bg-yellow-800 transition-colors"
                              title="归档量表">
                              <Archive size={14} />
                            </button>
                          )}
                          {/* View Responses */}
                          <button onClick={(e) => { e.stopPropagation(); handleViewResponses(scale); }}
                            className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-800 transition-colors"
                            title="查看填写记录">
                            <Eye size={14} />
                          </button>
                          {/* Export CSV */}
                          <button onClick={(e) => { e.stopPropagation(); handleExportFromRow(scale); }}
                            disabled={exportingScale === scale.id}
                            className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-800 transition-colors disabled:opacity-50"
                            title="导出填写数据 CSV">
                            {exportingScale === scale.id
                              ? <Loader size={14} className="animate-spin" />
                              : <Download size={14} />}
                          </button>
                          {/* Delete */}
                          <button onClick={(e) => handleDelete(e, scale)}
                            className="p-2 rounded-lg bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-800 transition-colors"
                            title="删除量表">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 列选择导出弹窗 ── */}
      {exportModal && (() => {
        const { scale, responses, questionCols, selected } = exportModal;
        const allKeys = [...FIXED_COLS.map(c => c.key), ...questionCols.map(c => c.key)];
        const isAllSelected = allKeys.every(k => selected.has(k));

        const toggle = (key: string) => {
          const next = new Set(selected);
          next.has(key) ? next.delete(key) : next.add(key);
          setExportModal({ ...exportModal, selected: next });
        };

        const toggleAll = () => {
          setExportModal({
            ...exportModal,
            selected: isAllSelected ? new Set() : new Set(allKeys),
          });
        };

        const toggleGroup = (keys: string[]) => {
          const allOn = keys.every(k => selected.has(k));
          const next = new Set(selected);
          keys.forEach(k => allOn ? next.delete(k) : next.add(k));
          setExportModal({ ...exportModal, selected: next });
        };

        const groups: Record<string, typeof FIXED_COLS[number][]> = {};
        FIXED_COLS.forEach(c => { (groups[c.group] ??= []).push(c); });

        return createPortal(
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
            <div className="glass-card rounded-2xl w-full max-w-lg flex flex-col max-h-[85vh]">
              {/* Header */}
              <div className="flex items-center justify-between p-5 border-b border-white/10">
                <div>
                  <h2 className="text-lg font-bold">选择导出字段</h2>
                  <p className="text-xs text-gray-500 mt-0.5">{scale.name} · 共 {responses.length} 份</p>
                </div>
                <button onClick={() => setExportModal(null)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                  <X size={18} />
                </button>
              </div>

              {/* Body */}
              <div className="overflow-y-auto flex-1 p-5 space-y-4">
                {/* 全选 */}
                <label className="flex items-center gap-2 cursor-pointer select-none font-semibold text-sm">
                  <input type="checkbox" checked={isAllSelected} onChange={toggleAll}
                    className="w-4 h-4 rounded accent-indigo-500" />
                  全选 / 取消全选
                </label>

                <hr className="border-white/10" />

                {/* 固定列分组 */}
                {Object.entries(groups).map(([groupName, cols]) => (
                  <div key={groupName}>
                    <label className="flex items-center gap-2 cursor-pointer select-none text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                      <input type="checkbox"
                        checked={cols.every(c => selected.has(c.key))}
                        onChange={() => toggleGroup(cols.map(c => c.key))}
                        className="w-3.5 h-3.5 rounded accent-indigo-500" />
                      {groupName}
                    </label>
                    <div className="grid grid-cols-3 gap-1.5 pl-2">
                      {cols.map(c => (
                        <label key={c.key} className="flex items-center gap-1.5 cursor-pointer text-sm select-none">
                          <input type="checkbox" checked={selected.has(c.key)} onChange={() => toggle(c.key)}
                            className="w-3.5 h-3.5 rounded accent-indigo-500" />
                          {c.label}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}

                {/* 题目答案列 */}
                {questionCols.length > 0 && (
                  <div>
                    <label className="flex items-center gap-2 cursor-pointer select-none text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                      <input type="checkbox"
                        checked={questionCols.every(c => selected.has(c.key))}
                        onChange={() => toggleGroup(questionCols.map(c => c.key))}
                        className="w-3.5 h-3.5 rounded accent-indigo-500" />
                      题目答案（{questionCols.length} 题）
                    </label>
                    <div className="grid grid-cols-3 gap-1.5 pl-2 max-h-40 overflow-y-auto">
                      {questionCols.map(c => (
                        <label key={c.key} className="flex items-center gap-1.5 cursor-pointer text-xs select-none truncate">
                          <input type="checkbox" checked={selected.has(c.key)} onChange={() => toggle(c.key)}
                            className="w-3.5 h-3.5 rounded accent-indigo-500 shrink-0" />
                          <span className="truncate" title={c.label}>{c.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between p-5 border-t border-white/10 gap-3">
                <span className="text-xs text-gray-500">已选 {selected.size} / {allKeys.length} 列</span>
                <div className="flex gap-2">
                  <button onClick={() => setExportModal(null)}
                    className="px-4 py-2 rounded-lg border text-sm font-medium transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
                    style={{ borderColor: 'var(--glass-border)' }}>
                    取消
                  </button>
                  <button
                    disabled={selected.size === 0}
                    onClick={() => {
                      downloadCSV(responses, scale.name, selected, questionCols);
                      setExportModal(null);
                    }}
                    className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors disabled:opacity-50 flex items-center gap-1.5">
                    <Download size={14} />
                    导出 CSV
                  </button>
                </div>
              </div>
            </div>
          </div>
        , document.body);
      })()}
    </div>
  );
};
