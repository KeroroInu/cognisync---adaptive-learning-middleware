import { useEffect, useState } from 'react';
import { adminApi } from '../lib/adminApi';
import type { ScaleTemplate, ScaleResponse } from '../types';
import { Upload, CheckCircle, Archive, Eye, Trash2, Download, X, Loader } from 'lucide-react';

const ADMIN_KEY = (import.meta.env.VITE_ADMIN_KEY as string) || '';
const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string) || 'http://localhost:8000/api';

// 状态规范化（兼容数据库存储的大小写）
const normalizeStatus = (s: string) => s.toLowerCase();

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
  const [exportingScale, setExportingScale] = useState<string | null>(null);

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
    setResponsesModal({ scale, responses: [], loading: true });
    try {
      const responses = await adminApi.getScaleResponses(scale.id);
      setResponsesModal({ scale, responses, loading: false });
    } catch (err) {
      setResponsesModal({ scale, responses: [], loading: false });
      console.error(err);
    }
  };

  const handleExportScaleCSV = async (scaleId: string) => {
    setExportingScale(scaleId);
    try {
      const url = `${BASE_URL}/admin/export/csv/scale/${scaleId}/responses`;
      const response = await fetch(url, { headers: { 'X-ADMIN-KEY': ADMIN_KEY } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `scale_${scaleId.slice(0, 8)}_responses_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } catch (err) {
      alert('导出失败：' + (err instanceof Error ? err.message : String(err)));
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
          <p className="text-gray-600 dark:text-gray-400">管理和部署评估量表</p>
        </div>
        <button
          onClick={() => setShowUploadModal(true)}
          className="flex items-center gap-2 px-6 py-3 rounded-xl font-medium bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:shadow-lg hover:scale-105 transition-all duration-300"
        >
          <Upload size={20} />
          上传量表
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <div className="glass-card p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
          <p className="text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* Upload Modal */}
      {showUploadModal && (
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
                  <p className="text-sm text-gray-600 dark:text-gray-400">或拖拽至此</p>
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
                      <pre className="p-3 bg-gray-100 dark:bg-gray-900 rounded-lg text-xs overflow-auto max-h-48">
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
              className="mt-4 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-300">
              关闭
            </button>
          </div>
        </div>
      )}

      {/* View Responses Modal */}
      {responsesModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass-card rounded-2xl w-full max-w-3xl max-h-[80vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-white/10">
              <div>
                <h2 className="text-xl font-bold">{responsesModal.scale.name}</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                  共 {responsesModal.responses.length} 份填写记录
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleExportScaleCSV(responsesModal.scale.id)}
                  disabled={exportingScale === responsesModal.scale.id}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-800 transition-colors text-sm font-semibold disabled:opacity-50"
                >
                  {exportingScale === responsesModal.scale.id
                    ? <Loader size={15} className="animate-spin" />
                    : <Download size={15} />}
                  导出 CSV
                </button>
                <button onClick={() => setResponsesModal(null)}
                  className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                  <X size={20} />
                </button>
              </div>
            </div>

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
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="text-left py-3 px-2 font-semibold text-gray-600 dark:text-gray-400">用户 ID</th>
                      <th className="text-right py-3 px-2 font-semibold text-gray-600 dark:text-gray-400">认知</th>
                      <th className="text-right py-3 px-2 font-semibold text-gray-600 dark:text-gray-400">情感</th>
                      <th className="text-right py-3 px-2 font-semibold text-gray-600 dark:text-gray-400">行为</th>
                      <th className="text-right py-3 px-2 font-semibold text-gray-600 dark:text-gray-400">总分</th>
                      <th className="text-right py-3 px-2 font-semibold text-gray-600 dark:text-gray-400">填写时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {responsesModal.responses.map((resp) => {
                      const scores = resp.scores_json as Record<string, number> | null;
                      return (
                        <tr key={resp.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                          <td className="py-3 px-2 font-mono text-xs text-gray-500">
                            {resp.user_id.slice(0, 8)}…
                          </td>
                          <td className="py-3 px-2 text-right">
                            <span className="px-2 py-0.5 rounded text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 font-mono">
                              {scores?.cognition?.toFixed(0) ?? '—'}
                            </span>
                          </td>
                          <td className="py-3 px-2 text-right">
                            <span className="px-2 py-0.5 rounded text-xs bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 font-mono">
                              {scores?.affect?.toFixed(0) ?? '—'}
                            </span>
                          </td>
                          <td className="py-3 px-2 text-right">
                            <span className="px-2 py-0.5 rounded text-xs bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 font-mono">
                              {scores?.behavior?.toFixed(0) ?? '—'}
                            </span>
                          </td>
                          <td className="py-3 px-2 text-right font-mono text-xs text-gray-700 dark:text-gray-300">
                            {scores?.total_score ?? '—'} / {scores?.max_score ?? '—'}
                          </td>
                          <td className="py-3 px-2 text-right text-xs text-gray-500">
                            {new Date(resp.created_at).toLocaleString('zh-CN')}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

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
                          {status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                        {(scale as any).responses_count ?? 0} 份
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                        {new Date(scale.created_at).toLocaleDateString('zh-CN')}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <div className="flex gap-2">
                          {status === 'draft' && (
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
                          <button onClick={(e) => { e.stopPropagation(); handleExportScaleCSV(scale.id); }}
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
    </div>
  );
};
