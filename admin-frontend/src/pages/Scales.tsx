import { useEffect, useState } from 'react';
import { adminApi } from '../lib/adminApi';
import type { ScaleTemplate } from '../types';
import { Upload, CheckCircle, Archive, Eye } from 'lucide-react';

export const Scales = () => {
  const [scales, setScales] = useState<ScaleTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [previewData, setPreviewData] = useState<ScaleTemplate | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  useEffect(() => {
    loadScales();
  }, []);

  const loadScales = async () => {
    try {
      setLoading(true);
      const data = await adminApi.getScales();
      setScales(data);
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

  const handleViewResponses = async (scaleId: string) => {
    try {
      await adminApi.getScaleResponses(scaleId);
    } catch (err) {
      console.error(err);
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
          <h1 className="text-3xl font-bold mb-2">Scale Management</h1>
          <p className="text-gray-600 dark:text-gray-400">Manage and deploy assessment scales</p>
        </div>
        <button
          onClick={() => setShowUploadModal(true)}
          className="flex items-center gap-2 px-6 py-3 rounded-xl font-medium bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:shadow-lg hover:scale-105 transition-all duration-300"
        >
          <Upload size={20} />
          Upload Scale
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
            <h2 className="text-2xl font-bold mb-4">Upload Scale Template</h2>

            <div className="space-y-4">
              {!selectedFile ? (
                <div className="border-2 border-dashed border-indigo-300 dark:border-indigo-700 rounded-xl p-8 text-center cursor-pointer hover:border-indigo-500 transition-colors"
                  onClick={() => document.getElementById('file-input')?.click()}
                >
                  <Upload size={40} className="mx-auto mb-2 text-indigo-500" />
                  <p className="font-semibold mb-1">Click to select JSON file</p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">or drag and drop</p>
                  <input
                    id="file-input"
                    type="file"
                    accept=".json"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                    <p className="text-sm font-semibold text-green-700 dark:text-green-300">
                      File selected: {selectedFile.name}
                    </p>
                  </div>

                  {previewData && (
                    <div>
                      <p className="font-semibold mb-2">Preview:</p>
                      <pre className="p-3 bg-gray-100 dark:bg-gray-900 rounded-lg text-xs overflow-auto max-h-48">
                        {JSON.stringify(previewData, null, 2)}
                      </pre>
                    </div>
                  )}

                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        setSelectedFile(null);
                        setPreviewData(null);
                      }}
                      className="flex-1 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleUpload}
                      disabled={uploading}
                      className="flex-1 px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                    >
                      {uploading ? 'Uploading...' : 'Upload'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={() => {
                setShowUploadModal(false);
                setSelectedFile(null);
                setPreviewData(null);
              }}
              className="mt-4 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-300"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Scales Table */}
      <div className="glass-card rounded-2xl overflow-hidden stagger-2">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead style={{ backgroundColor: 'var(--bg-tertiary)' }}>
              <tr>
                <th className="px-6 py-4 text-left text-sm font-semibold">Name</th>
                <th className="px-6 py-4 text-left text-sm font-semibold">Version</th>
                <th className="px-6 py-4 text-left text-sm font-semibold">Status</th>
                <th className="px-6 py-4 text-left text-sm font-semibold">Created</th>
                <th className="px-6 py-4 text-left text-sm font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {scales.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                    No scales found
                  </td>
                </tr>
              ) : (
                scales.map((scale) => (
                  <tr
                    key={scale.id}
                    className="border-t cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    style={{ borderColor: 'var(--glass-border)' }}
                  >
                    <td className="px-6 py-4 text-sm font-medium">{scale.name}</td>
                    <td className="px-6 py-4 text-sm">v{scale.version}</td>
                    <td className="px-6 py-4 text-sm">
                      <span className={`px-3 py-1 rounded-lg text-xs font-semibold inline-flex items-center gap-1 ${
                        scale.status === 'active'
                          ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300'
                          : scale.status === 'draft'
                          ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
                      }`}>
                        {scale.status === 'active' && <CheckCircle size={14} />}
                        {scale.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                      {new Date(scale.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <div className="flex gap-2">
                        {scale.status === 'draft' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleActivate(scale.id);
                            }}
                            className="px-3 py-1 rounded-lg bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-800 transition-colors text-xs font-semibold"
                          >
                            Activate
                          </button>
                        )}
                        {scale.status === 'active' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleArchive(scale.id);
                            }}
                            className="px-3 py-1 rounded-lg bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-800 transition-colors text-xs font-semibold inline-flex items-center gap-1"
                          >
                            <Archive size={14} />
                            Archive
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleViewResponses(scale.id);
                          }}
                          className="px-3 py-1 rounded-lg bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-800 transition-colors text-xs font-semibold inline-flex items-center gap-1"
                        >
                          <Eye size={14} />
                          Responses
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
    </div>
  );
};
