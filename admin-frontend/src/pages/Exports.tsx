import { useEffect, useState } from 'react';
import { adminApi } from '../lib/adminApi';
import type { TableInfo } from '../types';
import { Download, Copy, Check, Calendar } from 'lucide-react';

interface ExportRecord {
  id: string;
  table_name: string;
  format: 'json';
  created_at: string;
  row_count: number;
}

export const Exports = () => {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [selectedFormat, setSelectedFormat] = useState<'json'>('json');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [exportHistory, setExportHistory] = useState<ExportRecord[]>([]);

  useEffect(() => {
    loadTables();
  }, []);

  const loadTables = async () => {
    try {
      setLoading(true);
      const data = await adminApi.getTables();
      setTables(data);

      // Load mock export history
      const mockHistory: ExportRecord[] = [
        {
          id: '1',
          table_name: 'users',
          format: 'json',
          created_at: new Date(Date.now() - 3600000).toISOString(),
          row_count: 250,
        },
        {
          id: '2',
          table_name: 'chat_sessions',
          format: 'json',
          created_at: new Date(Date.now() - 86400000).toISOString(),
          row_count: 1250,
        },
      ];
      setExportHistory(mockHistory);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tables');
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    if (!selectedTable) return;
    try {
      setExporting(true);
      const data = await adminApi.exportTable(selectedTable, 'json');
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selectedTable}_export_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);

      // Add to history
      const newRecord: ExportRecord = {
        id: Date.now().toString(),
        table_name: selectedTable,
        format: 'json',
        created_at: new Date().toISOString(),
        row_count: Array.isArray(data) ? data.length : 0,
      };
      setExportHistory([newRecord, ...exportHistory]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const copyExportUrl = (tableName: string) => {
    const text = `export/${tableName}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
      <div>
        <h1 className="text-3xl font-bold mb-2">Data Export</h1>
        <p className="text-gray-600 dark:text-gray-400">Export database tables in various formats</p>
      </div>

      {/* Error Message */}
      {error && (
        <div className="glass-card p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
          <p className="text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* Export Panel */}
      <div className="glass-card rounded-2xl p-6 stagger-1">
        <h2 className="text-xl font-bold mb-6">Export Configuration</h2>

        <div className="space-y-6">
          {/* Table Selection */}
          <div>
            <label className="block text-sm font-semibold mb-3">Select Table</label>
            <select
              value={selectedTable || ''}
              onChange={(e) => setSelectedTable(e.target.value)}
              className="w-full px-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              style={{
                backgroundColor: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--glass-border)',
              }}
            >
              <option value="">Choose a table...</option>
              {tables.map((table) => (
                <option key={table.table_name} value={table.table_name}>
                  {table.table_name} ({table.row_count.toLocaleString()} rows)
                </option>
              ))}
            </select>
          </div>

          {/* Format Selection */}
          <div>
            <label className="block text-sm font-semibold mb-3">Export Format</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg border-2 border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20">
                <input
                  type="radio"
                  name="format"
                  value="json"
                  checked={selectedFormat === 'json'}
                  onChange={(e) => setSelectedFormat(e.target.value as 'json')}
                  className="w-4 h-4"
                />
                <span className="font-medium text-indigo-700 dark:text-indigo-300">JSON</span>
              </label>
            </div>
          </div>

          {/* Export Button */}
          <button
            onClick={handleExport}
            disabled={!selectedTable || exporting}
            className="w-full px-6 py-4 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-lg hover:scale-105 transition-all duration-300 flex items-center justify-center gap-2"
          >
            <Download size={20} />
            {exporting ? 'Exporting...' : 'Export Now'}
          </button>
        </div>
      </div>

      {/* Export History */}
      <div className="glass-card rounded-2xl overflow-hidden stagger-2">
        <div className="p-6 border-b border-white/10">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Calendar size={24} />
            Recent Exports
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead style={{ backgroundColor: 'var(--bg-tertiary)' }}>
              <tr>
                <th className="px-6 py-4 text-left text-sm font-semibold">Table</th>
                <th className="px-6 py-4 text-left text-sm font-semibold">Format</th>
                <th className="px-6 py-4 text-left text-sm font-semibold">Rows Exported</th>
                <th className="px-6 py-4 text-left text-sm font-semibold">Exported At</th>
                <th className="px-6 py-4 text-left text-sm font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {exportHistory.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                    No exports yet
                  </td>
                </tr>
              ) : (
                exportHistory.map((record) => (
                  <tr
                    key={record.id}
                    className="border-t hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    style={{ borderColor: 'var(--glass-border)' }}
                  >
                    <td className="px-6 py-4 text-sm font-medium">{record.table_name}</td>
                    <td className="px-6 py-4 text-sm">
                      <span className="px-3 py-1 rounded-lg bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 text-xs font-semibold">
                        {record.format.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                      {record.row_count.toLocaleString()} rows
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                      {new Date(record.created_at).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <button
                        onClick={() => copyExportUrl(record.table_name)}
                        className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg transition-all ${
                          copied
                            ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300'
                            : 'bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-800'
                        }`}
                      >
                        {copied ? <Check size={16} /> : <Copy size={16} />}
                        Copy
                      </button>
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
