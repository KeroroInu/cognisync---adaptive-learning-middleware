import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { adminApi } from '../lib/adminApi';
import type { ScaleTemplate, ScaleResponse } from '../types';
import {
  Upload, CheckCircle, Archive, Eye, Trash2, Download, X, Loader,
  ChevronDown, ChevronRight, Plus, Pencil,
} from 'lucide-react';

const normalizeStatus = (s: string) => s.toLowerCase();

const STATUS_LABEL: Record<string, string> = {
  active: '活跃', draft: '草稿', archived: '已归档',
};

const FIXED_COLS = [
  { key: 'index',         label: '序号',        group: '基本信息' },
  { key: 'created_at',   label: '提交时间',     group: '基本信息' },
  { key: 'duration_sec', label: '所用时间(秒)', group: '基本信息' },
  { key: 'student_id',   label: '学号',         group: '基本信息' },
  { key: 'user_name',    label: '姓名',         group: '基本信息' },
  { key: 'cognition',    label: '认知分',       group: '分数信息' },
  { key: 'affect',       label: '情感分',       group: '分数信息' },
  { key: 'behavior',     label: '行为分',       group: '分数信息' },
  { key: 'total_score',  label: '总分',         group: '分数信息' },
  { key: 'max_score',    label: '满分',         group: '分数信息' },
] as const;

type FixedColKey = typeof FIXED_COLS[number]['key'];

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
      const diff = Math.round((new Date(normalizeIso(resp.created_at)).getTime() - new Date(normalizeIso(resp.started_at)).getTime()) / 1000);
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

// ── Builder types ─────────────────────────────────────────────────────────────
interface BuilderQ {
  id: string;
  text: string;
  dimension: string;
  type: 'likert5' | 'text';
  reverse_scored: boolean;
}

interface SchemaQuestion {
  id: string;
  text?: string;
}

interface ScaleSchemaShape {
  items?: SchemaQuestion[];
  questions?: SchemaQuestion[];
}

interface UploadedScalePreview {
  name?: string;
  schema_json?: ScaleSchemaShape;
  [key: string]: unknown;
}

const PRESET_DIMS = ['CT', 'SE', 'LM', 'CPS', 'PA', 'AIL'];
const PORTRAIT_DIMS = ['cognition', 'affect', 'behavior'] as const;
const PORTRAIT_LABELS: Record<string, string> = {
  cognition: '认知', affect: '情感', behavior: '行为',
};

const emptyNewQ = (): Omit<BuilderQ, 'id'> => ({
  text: '', dimension: '', type: 'likert5', reverse_scored: false,
});

// ── Component ─────────────────────────────────────────────────────────────────
export const Scales = () => {
  const [scales, setScales] = useState<ScaleTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [previewData, setPreviewData] = useState<UploadedScalePreview | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // View Responses modal
  const [responsesModal, setResponsesModal] = useState<{
    scale: ScaleTemplate; responses: ScaleResponse[]; loading: boolean;
  } | null>(null);
  const [prevRoundExpanded, setPrevRoundExpanded] = useState(false);
  const [exportingScale, setExportingScale] = useState<string | null>(null);
  const [selectedResponseIds, setSelectedResponseIds] = useState<Set<string>>(new Set());
  const [deletingResponses, setDeletingResponses] = useState(false);

  // Export column-selection modal
  const [exportModal, setExportModal] = useState<{
    scale: ScaleTemplate; responses: ScaleResponse[];
    selected: Set<string>; questionCols: Array<{ key: string; label: string }>;
  } | null>(null);

  // ── Builder state ──────────────────────────────────────────────────────────
  const [showBuilderModal, setShowBuilderModal] = useState(false);
  const [bName, setBName] = useState('');
  const [bDesc, setBDesc] = useState('');
  const [bDims, setBDims] = useState<string[]>([...PRESET_DIMS]);
  const [bCustomDimInput, setBCustomDimInput] = useState('');
  const [bQuestions, setBQuestions] = useState<BuilderQ[]>([]);
  const [bPortrait, setBPortrait] = useState<Record<string, string[]>>({
    cognition: [], affect: [], behavior: [],
  });
  const [bNewQ, setBNewQ] = useState(emptyNewQ());
  const [builderSubmitting, setBuilderSubmitting] = useState(false);
  const [bEditIdx, setBEditIdx] = useState<number | null>(null);

  useEffect(() => { loadScales(); }, []);

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

  // ── Upload handlers ────────────────────────────────────────────────────────
  const getSchemaQuestions = (schema: unknown): SchemaQuestion[] => {
    if (!schema || typeof schema !== 'object') return [];
    const { items, questions } = schema as ScaleSchemaShape;
    return items ?? questions ?? [];
  };

  const handleSelectedFile = (file: File) => {
    if (!file) return;
    setUploadError('');
    file.text().then(content => {
      try {
        const json = JSON.parse(content) as UploadedScalePreview;
        if (!json.name || getSchemaQuestions(json.schema_json).length === 0) {
          setUploadError('JSON 格式错误：缺少 name 或 schema_json.questions 字段');
          return;
        }
        setSelectedFile(file);
        setPreviewData(json);
      } catch {
        setUploadError('文件解析失败，请确认是合法的 JSON 文件');
      }
    });
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleSelectedFile(file);
    }
    e.target.value = '';
  };

  const handleUpload = async () => {
    if (!previewData) return;
    try {
      setUploading(true);
      setUploadError('');
      await adminApi.uploadScale(previewData);
      setShowUploadModal(false);
      setSelectedFile(null);
      setPreviewData(null);
      await loadScales();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setUploading(false);
    }
  };

  const resetUploadModal = () => {
    setShowUploadModal(false);
    setSelectedFile(null);
    setPreviewData(null);
    setUploadError('');
  };

  // ── Scale actions ──────────────────────────────────────────────────────────
  const handleActivate = async (scaleId: string) => {
    try { await adminApi.activateScale(scaleId); await loadScales(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to activate scale'); }
  };

  const handleArchive = async (scaleId: string) => {
    try { await adminApi.archiveScale(scaleId); await loadScales(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to archive scale'); }
  };

  const handleViewResponses = async (scale: ScaleTemplate) => {
    setSelectedResponseIds(new Set());
    setResponsesModal({ scale, responses: [], loading: true });
    try {
      const responses = await adminApi.getScaleResponses(scale.id);
      setResponsesModal({ scale, responses, loading: false });
    } catch (err) {
      setResponsesModal({ scale, responses: [], loading: false });
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
      await loadScales();
    } catch (err) {
      alert('删除失败：' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setDeletingResponses(false);
    }
  };

  const openExportModal = (scale: ScaleTemplate, responses: ScaleResponse[]) => {
    const answerKeys = responses.length > 0
      ? Object.keys(responses[0].answers_json as Record<string, unknown>).sort() : [];
    const schemaItems = getSchemaQuestions(scale.schema_json);
    const questionCols = answerKeys.map((k, i) => {
      const q = schemaItems.find(q => q.id === k);
      return { key: k, label: q?.text ? q.text : `Q${i + 1}` };
    });
    const allKeys = [...FIXED_COLS.map(c => c.key), ...questionCols.map(c => c.key)];
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
    if (!window.confirm(`确定要删除量表 "${scale.name}" 吗？这将同时删除所有相关响应记录，此操作不可撤销。`)) return;
    try {
      await adminApi.deleteScale(scale.id);
      await loadScales();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  };

  // ── Builder handlers ───────────────────────────────────────────────────────
  const resetBuilder = () => {
    setBName(''); setBDesc(''); setBDims([...PRESET_DIMS]); setBCustomDimInput('');
    setBQuestions([]); setBPortrait({ cognition: [], affect: [], behavior: [] });
    setBNewQ(emptyNewQ()); setBEditIdx(null);
  };

  const addCustomDim = () => {
    const d = bCustomDimInput.trim().toUpperCase();
    if (d && !bDims.includes(d)) setBDims(prev => [...prev, d]);
    setBCustomDimInput('');
  };

  const removeDim = (dim: string) => {
    setBDims(prev => prev.filter(d => d !== dim));
    setBPortrait(prev => {
      const next = { ...prev };
      (Object.keys(next) as string[]).forEach(k => {
        next[k] = next[k].filter(d => d !== dim);
      });
      return next;
    });
  };

  const addOrSaveQuestion = () => {
    if (!bNewQ.text.trim()) return;
    if (bEditIdx !== null) {
      setBQuestions(prev => prev.map((q, i) =>
        i === bEditIdx ? { ...q, ...bNewQ } : q
      ));
      setBEditIdx(null);
    } else {
      const id = `q${Date.now()}`;
      setBQuestions(prev => [...prev, { id, ...bNewQ }]);
    }
    setBNewQ(emptyNewQ());
  };

  const editQuestion = (idx: number) => {
    const q = bQuestions[idx];
    setBNewQ({ text: q.text, dimension: q.dimension, type: q.type, reverse_scored: q.reverse_scored });
    setBEditIdx(idx);
  };

  const removeQuestion = (idx: number) => {
    setBQuestions(prev => prev.filter((_, i) => i !== idx));
    if (bEditIdx === idx) { setBEditIdx(null); setBNewQ(emptyNewQ()); }
  };

  const togglePortraitDim = (portrait: string, dim: string) => {
    setBPortrait(prev => {
      const cur = prev[portrait] || [];
      return { ...prev, [portrait]: cur.includes(dim) ? cur.filter(d => d !== dim) : [...cur, dim] };
    });
  };

  const handleBuilderSubmit = async () => {
    if (!bName.trim() || bQuestions.length === 0) return;

    const schema_json: Record<string, unknown> = {
      description: bDesc || undefined,
      questions: bQuestions.map(q => ({
        id: q.id, text: q.text, dimension: q.dimension,
        type: q.type, reverse_scored: q.reverse_scored,
      })),
    };
    if (bQuestions.some(q => q.type === 'likert5')) {
      schema_json.likert_scale = {
        min: 1, max: 5,
        labels: { '1': '非常不同意', '2': '不同意', '3': '一般', '4': '同意', '5': '非常同意' },
      };
    }

    const likertQs = bQuestions.filter(q => q.type === 'likert5');
    const dimMap: Record<string, string[]> = {};
    for (const q of likertQs) {
      if (q.dimension) (dimMap[q.dimension] ??= []).push(q.id);
    }
    const scoredDims = Object.keys(dimMap);
    const reverseItems = likertQs.filter(q => q.reverse_scored).map(q => q.id);
    const scoring_json = scoredDims.length > 0 ? {
      method: 'dimension_average', dimensions: scoredDims,
      mapping: dimMap, reverse_items: reverseItems, score_range: [0, 100],
    } : null;

    const mapping_json: Record<string, unknown> = {};
    for (const key of PORTRAIT_DIMS) {
      const dims = bPortrait[key] || [];
      if (dims.length > 0) {
        mapping_json[key] = { source_dimensions: dims, weights: dims.map(() => 1 / dims.length) };
      }
    }

    setBuilderSubmitting(true);
    try {
      await adminApi.uploadScale({
        name: bName,
        schema_json,
        scoring_json,
        mapping_json: Object.keys(mapping_json).length > 0 ? mapping_json : null,
      });
      setShowBuilderModal(false);
      resetBuilder();
      await loadScales();
    } catch (err) {
      alert('创建失败：' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBuilderSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500" />
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
        <div className="flex gap-2">
          <button
            onClick={() => { resetBuilder(); setShowBuilderModal(true); }}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium border transition-all hover:shadow-md"
            style={{ borderColor: 'var(--glass-border)', color: 'var(--text-primary)' }}
          >
            <Pencil size={17} />
            在线编辑
          </button>
          <button
            onClick={() => setShowUploadModal(true)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:shadow-lg hover:scale-105 transition-all duration-300"
          >
            <Upload size={17} />
            上传 JSON
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="glass-card p-4 rounded-xl border" style={{ background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.3)' }}>
          <p style={{ color: '#ef4444' }}>{error}</p>
        </div>
      )}

      {/* ── Upload JSON Modal ── */}
      {showUploadModal && createPortal(
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass-card rounded-2xl w-full max-w-2xl flex flex-col max-h-[85vh]">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-white/10 shrink-0">
              <h2 className="text-xl font-bold">上传量表模板</h2>
              <button onClick={resetUploadModal} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                <X size={20} />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {!selectedFile ? (
                <div
                  className="border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors"
                  style={{ borderColor: 'var(--glass-border)' }}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => {
                    e.preventDefault();
                    const file = e.dataTransfer.files[0];
                    if (file) handleSelectedFile(file);
                  }}
                >
                  <Upload size={40} className="mx-auto mb-3 text-indigo-500" />
                  <p className="font-semibold mb-1">点击或拖拽 JSON 文件到此处</p>
                  <p className="text-sm" style={{ color: 'var(--text-light)' }}>
                    需包含 <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1 rounded">name</code> 和 <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1 rounded">schema_json.questions</code>
                  </p>
                  <input ref={fileInputRef} id="file-input" type="file" accept=".json" onChange={handleFileSelect} className="hidden" />
                </div>
              ) : (
                <>
                  <div className="p-3 rounded-lg flex items-center gap-2" style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)' }}>
                    <CheckCircle size={16} className="text-emerald-500 shrink-0" />
                    <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300 truncate">{selectedFile.name}</p>
                    <button onClick={() => { setSelectedFile(null); setPreviewData(null); setUploadError(''); }}
                      className="ml-auto text-gray-400 hover:text-gray-600 shrink-0">
                      <X size={14} />
                    </button>
                  </div>
                  {previewData && (
                    <div>
                      <p className="text-sm font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                        量表名称：<span style={{ color: 'var(--text-primary)' }}>{previewData.name as string}</span>
                        &nbsp;·&nbsp;共 {getSchemaQuestions(previewData.schema_json).length} 题
                      </p>
                      <pre className="p-3 rounded-xl text-xs overflow-auto max-h-52"
                        style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
                        {JSON.stringify(previewData, null, 2)}
                      </pre>
                    </div>
                  )}
                </>
              )}
              {uploadError && (
                <p className="text-sm text-red-500">{uploadError}</p>
              )}
            </div>

            {/* Footer */}
            <div className="flex gap-3 p-6 border-t border-white/10 shrink-0">
              <button onClick={resetUploadModal}
                className="flex-1 px-4 py-2 rounded-lg border hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors text-sm"
                style={{ borderColor: 'var(--glass-border)' }}>
                取消
              </button>
              <button onClick={handleUpload} disabled={!previewData || uploading}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors text-sm font-semibold">
                {uploading ? <Loader size={15} className="animate-spin" /> : <Upload size={15} />}
                {uploading ? '上传中...' : '上传'}
              </button>
            </div>
          </div>
        </div>
      , document.body)}

      {/* ── Online Builder Modal ── */}
      {showBuilderModal && createPortal(
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 overflow-y-auto">
          <div className="flex min-h-full items-start justify-center p-4 py-8">
            <div className="glass-card rounded-2xl w-full max-w-2xl">
              {/* Header */}
              <div className="flex items-center justify-between p-6 border-b border-white/10">
                <div>
                  <h2 className="text-xl font-bold">在线编辑量表</h2>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-light)' }}>逐题录入，支持 5 点李克特量表与文字填空</p>
                </div>
                <button onClick={() => { setShowBuilderModal(false); resetBuilder(); }}
                  className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                  <X size={20} />
                </button>
              </div>

              <div className="p-6 space-y-6">
                {/* ① 基本信息 */}
                <section>
                  <h3 className="text-sm font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-light)' }}>① 基本信息</h3>
                  <div className="space-y-3">
                    <input
                      value={bName}
                      onChange={e => setBName(e.target.value)}
                      placeholder="量表名称 *"
                      className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                      style={{ background: 'var(--bg-secondary)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)' }}
                    />
                    <textarea
                      value={bDesc}
                      onChange={e => setBDesc(e.target.value)}
                      placeholder="量表描述（可选）"
                      rows={2}
                      className="w-full px-3 py-2 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                      style={{ background: 'var(--bg-secondary)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)' }}
                    />
                  </div>
                </section>

                {/* ② 维度设置 */}
                <section>
                  <h3 className="text-sm font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-light)' }}>② 题目维度</h3>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {bDims.map(d => (
                      <span key={d} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold"
                        style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8' }}>
                        {d}
                        <button onClick={() => removeDim(d)} className="hover:text-red-400 transition-colors">
                          <X size={11} />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={bCustomDimInput}
                      onChange={e => setBCustomDimInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomDim(); } }}
                      placeholder="添加自定义维度（如 MT）"
                      className="flex-1 px-3 py-1.5 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                      style={{ background: 'var(--bg-secondary)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)' }}
                    />
                    <button onClick={addCustomDim}
                      className="px-3 py-1.5 rounded-lg text-sm bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-800 transition-colors font-semibold">
                      <Plus size={14} />
                    </button>
                  </div>
                </section>

                {/* ③ 题目列表 */}
                <section>
                  <h3 className="text-sm font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-light)' }}>
                    ③ 题目列表 <span className="normal-case font-normal text-xs ml-1">（{bQuestions.length} 题）</span>
                  </h3>

                  {/* Existing questions */}
                  {bQuestions.length > 0 && (
                    <div className="space-y-2 mb-4 max-h-52 overflow-y-auto pr-1">
                      {bQuestions.map((q, idx) => (
                        <div key={q.id}
                          className="flex items-start gap-2 p-3 rounded-lg text-sm"
                          style={{ background: bEditIdx === idx ? 'rgba(99,102,241,0.08)' : 'var(--bg-tertiary)', border: `1px solid ${bEditIdx === idx ? 'rgba(99,102,241,0.4)' : 'var(--glass-border)'}` }}>
                          <span className="text-xs font-mono text-gray-400 mt-0.5 shrink-0 w-5">{idx + 1}.</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{q.text}</p>
                            <div className="flex gap-2 mt-1">
                              <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8' }}>{q.dimension || '—'}</span>
                              <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: q.type === 'likert5' ? 'rgba(16,185,129,0.15)' : 'rgba(251,146,60,0.15)', color: q.type === 'likert5' ? '#34d399' : '#fb923c' }}>
                                {q.type === 'likert5' ? '5点李克特' : '填空'}
                              </span>
                              {q.reverse_scored && <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400">反向</span>}
                            </div>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <button onClick={() => editQuestion(idx)}
                              className="p-1.5 rounded hover:bg-indigo-100 dark:hover:bg-indigo-900 text-indigo-500 transition-colors">
                              <Pencil size={13} />
                            </button>
                            <button onClick={() => removeQuestion(idx)}
                              className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900 text-red-500 transition-colors">
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add/Edit question form */}
                  <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--glass-border)' }}>
                    <p className="text-xs font-semibold" style={{ color: 'var(--text-light)' }}>
                      {bEditIdx !== null ? `编辑第 ${bEditIdx + 1} 题` : '添加新题'}
                    </p>
                    <textarea
                      value={bNewQ.text}
                      onChange={e => setBNewQ(q => ({ ...q, text: e.target.value }))}
                      placeholder="输入题目内容..."
                      rows={2}
                      className="w-full px-3 py-2 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                      style={{ background: 'var(--bg-secondary)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)' }}
                    />
                    <div className="flex gap-2 flex-wrap">
                      {/* Dimension */}
                      <select
                        value={bNewQ.dimension}
                        onChange={e => setBNewQ(q => ({ ...q, dimension: e.target.value }))}
                        className="flex-1 min-w-28 px-3 py-1.5 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)' }}
                      >
                        <option value="">选择维度</option>
                        {bDims.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>

                      {/* Type */}
                      <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: 'var(--glass-border)' }}>
                        {(['likert5', 'text'] as const).map(t => (
                          <button key={t}
                            onClick={() => setBNewQ(q => ({ ...q, type: t, reverse_scored: t === 'text' ? false : q.reverse_scored }))}
                            className="px-3 py-1.5 text-xs font-semibold transition-colors"
                            style={{
                              background: bNewQ.type === t ? (t === 'likert5' ? 'rgba(16,185,129,0.2)' : 'rgba(251,146,60,0.2)') : 'var(--bg-secondary)',
                              color: bNewQ.type === t ? (t === 'likert5' ? '#34d399' : '#fb923c') : 'var(--text-light)',
                            }}>
                            {t === 'likert5' ? '5点李克特' : '文字填空'}
                          </button>
                        ))}
                      </div>

                      {/* Reverse scored (Likert only) */}
                      {bNewQ.type === 'likert5' && (
                        <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none" style={{ color: 'var(--text-secondary)' }}>
                          <input type="checkbox" checked={bNewQ.reverse_scored}
                            onChange={e => setBNewQ(q => ({ ...q, reverse_scored: e.target.checked }))}
                            className="w-3.5 h-3.5 rounded accent-yellow-500" />
                          反向计分
                        </label>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {bEditIdx !== null && (
                        <button onClick={() => { setBEditIdx(null); setBNewQ(emptyNewQ()); }}
                          className="px-3 py-1.5 rounded-lg text-xs border transition-colors"
                          style={{ borderColor: 'var(--glass-border)', color: 'var(--text-light)' }}>
                          取消编辑
                        </button>
                      )}
                      <button onClick={addOrSaveQuestion} disabled={!bNewQ.text.trim()}
                        className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors">
                        <Plus size={13} />
                        {bEditIdx !== null ? '保存修改' : '添加题目'}
                      </button>
                    </div>
                  </div>
                </section>

                {/* ④ 画像维度映射 */}
                <section>
                  <h3 className="text-sm font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-light)' }}>④ 画像映射（可选）</h3>
                  <p className="text-xs mb-3" style={{ color: 'var(--text-light)' }}>选择哪些维度参与认知 / 情感 / 行为三维画像计算（等权重平均）</p>
                  <div className="space-y-2">
                    {PORTRAIT_DIMS.map(portrait => (
                      <div key={portrait} className="flex items-center gap-3">
                        <span className="text-sm font-semibold w-8 shrink-0" style={{ color: 'var(--text-secondary)' }}>
                          {PORTRAIT_LABELS[portrait]}
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {bDims.map(d => {
                            const active = (bPortrait[portrait] || []).includes(d);
                            return (
                              <button key={d} onClick={() => togglePortraitDim(portrait, d)}
                                className="px-2.5 py-1 rounded-full text-xs font-semibold transition-colors"
                                style={{
                                  background: active ? 'rgba(99,102,241,0.2)' : 'var(--bg-tertiary)',
                                  color: active ? '#818cf8' : 'var(--text-light)',
                                  border: `1px solid ${active ? 'rgba(99,102,241,0.4)' : 'var(--glass-border)'}`,
                                }}>
                                {d}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              {/* Footer */}
              <div className="flex gap-3 p-6 border-t border-white/10">
                <button onClick={() => { setShowBuilderModal(false); resetBuilder(); }}
                  className="flex-1 px-4 py-2 rounded-lg border text-sm hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors"
                  style={{ borderColor: 'var(--glass-border)' }}>
                  取消
                </button>
                <button
                  onClick={handleBuilderSubmit}
                  disabled={builderSubmitting || !bName.trim() || bQuestions.length === 0}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors text-sm font-semibold">
                  {builderSubmitting ? <Loader size={15} className="animate-spin" /> : <CheckCircle size={15} />}
                  {builderSubmitting ? '创建中...' : `创建量表（${bQuestions.length} 题）`}
                </button>
              </div>
            </div>
          </div>
        </div>
      , document.body)}

      {/* ── View Responses Modal ── */}
      {responsesModal && createPortal(
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass-card rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-white/10">
              <div>
                <h2 className="text-xl font-bold">{responsesModal.scale.name}</h2>
                <p className="text-sm text-gray-500 mt-0.5">共 {responsesModal.responses.length} 份填写记录</p>
              </div>
              <button onClick={() => { setResponsesModal(null); setPrevRoundExpanded(false); setSelectedResponseIds(new Set()); }}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                <X size={20} />
              </button>
            </div>

            {selectedResponseIds.size > 0 && (
              <div className="px-6 py-2.5 flex items-center justify-between gap-3 border-b"
                style={{ borderColor: 'var(--glass-border)', background: 'rgba(239,68,68,0.06)' }}>
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>已选 {selectedResponseIds.size} 条记录</span>
                <div className="flex gap-2">
                  <button onClick={handleDeleteSelectedResponses} disabled={deletingResponses}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                    style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}>
                    <Trash2 size={13} />
                    {deletingResponses ? '删除中...' : '删除所选'}
                  </button>
                  <button onClick={() => setSelectedResponseIds(new Set())}
                    className="px-3 py-1.5 rounded-lg text-xs" style={{ color: 'var(--text-light)' }}>
                    取消
                  </button>
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-6">
              {responsesModal.loading ? (
                <div className="flex justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" />
                </div>
              ) : responsesModal.responses.length === 0 ? (
                <div className="text-center py-12 text-gray-500"><p>暂无用户填写记录</p></div>
              ) : (() => {
                const activatedAt = responsesModal.scale.activated_at
                  ? new Date(responsesModal.scale.activated_at) : null;
                const currentRound = activatedAt
                  ? responsesModal.responses.filter(r => new Date(r.created_at) >= activatedAt)
                  : responsesModal.responses;
                const prevRounds = activatedAt
                  ? responsesModal.responses.filter(r => new Date(r.created_at) < activatedAt) : [];

                const ResponseTable = ({ rows }: { rows: ScaleResponse[] }) => {
                  const allSelected = rows.length > 0 && rows.every(r => selectedResponseIds.has(r.id));
                  const toggleAll = () => setSelectedResponseIds(prev => {
                    const next = new Set(prev);
                    allSelected ? rows.forEach(r => next.delete(r.id)) : rows.forEach(r => next.add(r.id));
                    return next;
                  });
                  return (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-white/10">
                          <th className="py-3 px-2 w-8">
                            <input type="checkbox" checked={allSelected} onChange={toggleAll}
                              className="w-3.5 h-3.5 rounded accent-indigo-500 cursor-pointer" />
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
                        {rows.map(resp => {
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
                              style={isSelected ? { background: 'rgba(99,102,241,0.08)' } : undefined}>
                              <td className="py-3 px-2" onClick={e => e.stopPropagation()}>
                                <input type="checkbox" checked={isSelected}
                                  onChange={() => setSelectedResponseIds(prev => {
                                    const next = new Set(prev);
                                    isSelected ? next.delete(resp.id) : next.add(resp.id);
                                    return next;
                                  })}
                                  className="w-3.5 h-3.5 rounded accent-indigo-500 cursor-pointer" />
                              </td>
                              <td className="py-3 px-2">
                                <div className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>{resp.user_name || '—'}</div>
                                <div className="text-xs text-gray-500 font-mono">{resp.student_id || resp.user_id.slice(0, 8)}</div>
                              </td>
                              <td className="py-3 px-2 text-center">
                                <span className="px-2 py-0.5 rounded text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 font-mono">{scores?.cognition?.toFixed(0) ?? '—'}</span>
                              </td>
                              <td className="py-3 px-2 text-center">
                                <span className="px-2 py-0.5 rounded text-xs bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 font-mono">{scores?.affect?.toFixed(0) ?? '—'}</span>
                              </td>
                              <td className="py-3 px-2 text-center">
                                <span className="px-2 py-0.5 rounded text-xs bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 font-mono">{scores?.behavior?.toFixed(0) ?? '—'}</span>
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
                        <button onClick={() => openExportModal(responsesModal.scale, currentRound)}
                          disabled={currentRound.length === 0}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-800 transition-colors text-xs font-semibold disabled:opacity-40">
                          <Download size={13} />导出
                        </button>
                      </div>
                      {currentRound.length === 0
                        ? <p className="text-sm text-gray-400 text-center py-4">本轮暂无填写记录</p>
                        : <ResponseTable rows={currentRound} />}
                    </div>
                    {prevRounds.length > 0 && (
                      <div className="border-t border-white/10 pt-4">
                        <div className="flex items-center justify-between mb-2">
                          <button onClick={() => setPrevRoundExpanded(v => !v)}
                            className="flex items-center gap-2 text-sm font-semibold text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
                            {prevRoundExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            历史数据（前测）
                            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500">{prevRounds.length} 份</span>
                          </button>
                          {prevRoundExpanded && (
                            <button onClick={() => openExportModal(responsesModal.scale, prevRounds)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 transition-colors text-xs font-semibold">
                              <Download size={13} />导出
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

      {/* ── Scales Table ── */}
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
                <tr><td colSpan={6} className="px-6 py-12 text-center text-gray-500">暂无量表</td></tr>
              ) : scales.map(scale => {
                const status = normalizeStatus(scale.status);
                return (
                  <tr key={scale.id} className="border-t hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    style={{ borderColor: 'var(--glass-border)' }}>
                    <td className="px-6 py-4 text-sm font-medium">{scale.name}</td>
                    <td className="px-6 py-4 text-sm">v{scale.version}</td>
                    <td className="px-6 py-4 text-sm">
                      <span className={`px-3 py-1 rounded-lg text-xs font-semibold inline-flex items-center gap-1 ${
                        status === 'active' ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300'
                          : status === 'draft' ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'}`}>
                        {status === 'active' && <CheckCircle size={12} />}
                        {STATUS_LABEL[status] ?? status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">{scale.responses_count ?? 0} 份</td>
                    <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">
                      {new Date(scale.created_at).toLocaleDateString('zh-CN')}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <div className="flex gap-2">
                        {(status === 'draft' || status === 'archived') && (
                          <button onClick={e => { e.stopPropagation(); handleActivate(scale.id); }}
                            className="px-3 py-1 rounded-lg bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-800 transition-colors text-xs font-semibold">
                            激活
                          </button>
                        )}
                        {status === 'active' && (
                          <button onClick={e => { e.stopPropagation(); handleArchive(scale.id); }}
                            className="p-2 rounded-lg bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-200 dark:hover:bg-yellow-800 transition-colors" title="归档量表">
                            <Archive size={14} />
                          </button>
                        )}
                        <button onClick={e => { e.stopPropagation(); handleViewResponses(scale); }}
                          className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-800 transition-colors" title="查看填写记录">
                          <Eye size={14} />
                        </button>
                        <button onClick={e => { e.stopPropagation(); handleExportFromRow(scale); }}
                          disabled={exportingScale === scale.id}
                          className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-800 transition-colors disabled:opacity-50" title="导出填写数据 CSV">
                          {exportingScale === scale.id ? <Loader size={14} className="animate-spin" /> : <Download size={14} />}
                        </button>
                        <button onClick={e => handleDelete(e, scale)}
                          className="p-2 rounded-lg bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-800 transition-colors" title="删除量表">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
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
        const toggleAll = () => setExportModal({ ...exportModal, selected: isAllSelected ? new Set() : new Set(allKeys) });
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
              <div className="flex items-center justify-between p-5 border-b border-white/10">
                <div>
                  <h2 className="text-lg font-bold">选择导出字段</h2>
                  <p className="text-xs text-gray-500 mt-0.5">{scale.name} · 共 {responses.length} 份</p>
                </div>
                <button onClick={() => setExportModal(null)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"><X size={18} /></button>
              </div>
              <div className="overflow-y-auto flex-1 p-5 space-y-4">
                <label className="flex items-center gap-2 cursor-pointer select-none font-semibold text-sm">
                  <input type="checkbox" checked={isAllSelected} onChange={toggleAll} className="w-4 h-4 rounded accent-indigo-500" />
                  全选 / 取消全选
                </label>
                <hr className="border-white/10" />
                {Object.entries(groups).map(([groupName, cols]) => (
                  <div key={groupName}>
                    <label className="flex items-center gap-2 cursor-pointer select-none text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                      <input type="checkbox" checked={cols.every(c => selected.has(c.key))} onChange={() => toggleGroup(cols.map(c => c.key))} className="w-3.5 h-3.5 rounded accent-indigo-500" />
                      {groupName}
                    </label>
                    <div className="grid grid-cols-3 gap-1.5 pl-2">
                      {cols.map(c => (
                        <label key={c.key} className="flex items-center gap-1.5 cursor-pointer text-sm select-none">
                          <input type="checkbox" checked={selected.has(c.key)} onChange={() => toggle(c.key)} className="w-3.5 h-3.5 rounded accent-indigo-500" />
                          {c.label}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                {questionCols.length > 0 && (
                  <div>
                    <label className="flex items-center gap-2 cursor-pointer select-none text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                      <input type="checkbox" checked={questionCols.every(c => selected.has(c.key))} onChange={() => toggleGroup(questionCols.map(c => c.key))} className="w-3.5 h-3.5 rounded accent-indigo-500" />
                      题目答案（{questionCols.length} 题）
                    </label>
                    <div className="grid grid-cols-3 gap-1.5 pl-2 max-h-40 overflow-y-auto">
                      {questionCols.map(c => (
                        <label key={c.key} className="flex items-center gap-1.5 cursor-pointer text-xs select-none truncate">
                          <input type="checkbox" checked={selected.has(c.key)} onChange={() => toggle(c.key)} className="w-3.5 h-3.5 rounded accent-indigo-500 shrink-0" />
                          <span className="truncate" title={c.label}>{c.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between p-5 border-t border-white/10 gap-3">
                <span className="text-xs text-gray-500">已选 {selected.size} / {allKeys.length} 列</span>
                <div className="flex gap-2">
                  <button onClick={() => setExportModal(null)}
                    className="px-4 py-2 rounded-lg border text-sm font-medium transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
                    style={{ borderColor: 'var(--glass-border)' }}>取消</button>
                  <button disabled={selected.size === 0}
                    onClick={() => { downloadCSV(responses, scale.name, selected, questionCols); setExportModal(null); }}
                    className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors disabled:opacity-50 flex items-center gap-1.5">
                    <Download size={14} />导出 CSV
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
