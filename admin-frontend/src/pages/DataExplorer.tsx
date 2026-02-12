import { useEffect, useState } from 'react';
import { adminApi } from '../lib/adminApi';
import type { TableInfo, ColumnInfo, TableRowsResponse } from '../types';
import { Download, Copy, Check, Filter, ArrowUpDown } from 'lucide-react';

export const DataExplorer = () => {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [tableData, setTableData] = useState<TableRowsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [page, setPage] = useState(1);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [copied, setCopied] = useState(false);
  const pageSize = 50;

  useEffect(() => {
    loadTables();
  }, []);

  useEffect(() => {
    if (selectedTable) {
      loadTableData();
    }
  }, [selectedTable, page, sortColumn, sortOrder]);

  const loadTables = async () => {
    try {
      setLoading(true);
      const data = await adminApi.getTables();
      setTables(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tables');
    } finally {
      setLoading(false);
    }
  };

  const loadTableData = async () => {
    if (!selectedTable) return;
    try {
      setDataLoading(true);
      const offset = (page - 1) * pageSize;

      // Load columns
      const colsData = await adminApi.getTableColumns(selectedTable as string);
      setColumns(colsData);

      // Load rows
      const rowsData = await adminApi.getTableRows(
        selectedTable as string,
        pageSize,
        offset,
        sortColumn || undefined,
        sortOrder
      );
      setTableData(rowsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load table data');
    } finally {
      setDataLoading(false);
    }
  };

  const handleSort = (columnName: string) => {
    if (sortColumn === columnName) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(columnName);
      setSortOrder('asc');
    }
    setPage(1);
  };

  const handleExport = async () => {
    if (!selectedTable) return;
    try {
      const data = await adminApi.exportTable(selectedTable as string);
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selectedTable as string}_export.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    }
  };

  const handleCopyJson = () => {
    if (!tableData) return;
    navigator.clipboard.writeText(JSON.stringify(tableData.rows, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const totalPages = tableData ? Math.ceil(tableData.total / pageSize) : 1;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Data Explorer</h1>
          <p className="text-gray-600 dark:text-gray-400">Browse and export database tables</p>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="glass-card p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
          <p className="text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* Main Content */}
      <div className="flex gap-6 h-[calc(100vh-300px)]">
        {/* Left Sidebar - Tables List */}
        <div className="w-64 glass-card rounded-2xl p-4 overflow-hidden flex flex-col stagger-1">
          <h2 className="text-lg font-semibold mb-4">Tables ({tables.length})</h2>
          <div className="flex-1 overflow-y-auto space-y-2">
            {tables.length === 0 ? (
              <p className="text-center text-gray-500 dark:text-gray-400 py-8">No tables found</p>
            ) : (
              tables.map((table) => (
                <button
                  key={table.table_name}
                  onClick={() => {
                    setSelectedTable(table.table_name);
                    setPage(1);
                  }}
                  className={`w-full text-left px-4 py-3 rounded-lg transition-all duration-200 ${
                    selectedTable === table.table_name
                      ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-lg'
                      : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-900 dark:text-gray-100'
                  }`}
                >
                  <p className="font-semibold text-sm">{table.table_name}</p>
                  <p className="text-xs opacity-70">{table.row_count.toLocaleString()} rows</p>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right Content - Table Data */}
        <div className="flex-1 flex flex-col gap-6 overflow-hidden">
          {!selectedTable ? (
            <div className="glass-card rounded-2xl p-12 flex items-center justify-center flex-1 stagger-2">
              <div className="text-center">
                <Filter size={48} className="mx-auto mb-4 text-gray-400" />
                <p className="text-lg text-gray-600 dark:text-gray-400">
                  Select a table from the left to view data
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Controls */}
              <div className="glass-card rounded-2xl p-4 flex items-center justify-between stagger-1">
                <div>
                  <h2 className="text-lg font-semibold">
                    {selectedTable} ({tableData?.total || 0} rows)
                  </h2>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleCopyJson}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${
                      copied
                        ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300'
                        : 'bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-800'
                    }`}
                  >
                    {copied ? <Check size={18} /> : <Copy size={18} />}
                    {copied ? 'Copied!' : 'Copy JSON'}
                  </button>
                  <button
                    onClick={handleExport}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-600 text-white hover:shadow-lg transition-all"
                  >
                    <Download size={18} />
                    Export JSON
                  </button>
                </div>
              </div>

              {/* Table */}
              <div className="glass-card rounded-2xl overflow-hidden flex-1 flex flex-col stagger-2">
                {dataLoading ? (
                  <div className="flex items-center justify-center flex-1">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500"></div>
                  </div>
                ) : tableData && tableData.rows.length > 0 ? (
                  <>
                    <div className="flex-1 overflow-x-auto overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                          <tr>
                            {columns.map((col) => (
                              <th
                                key={col.column_name}
                                className="px-4 py-3 text-left font-semibold cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                                onClick={() => handleSort(col.column_name)}
                              >
                                <div className="flex items-center gap-2">
                                  {col.column_name}
                                  <ArrowUpDown size={14} className="opacity-50" />
                                </div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {tableData.rows.map((row, idx) => (
                            <tr
                              key={idx}
                              className="border-t hover:bg-gray-50 dark:hover:bg-gray-900/30 transition-colors"
                              style={{ borderColor: 'var(--glass-border)' }}
                            >
                              {columns.map((col) => (
                                <td
                                  key={col.column_name}
                                  className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300"
                                  title={
                                    typeof row[col.column_name] === 'object'
                                      ? JSON.stringify(row[col.column_name])
                                      : String(row[col.column_name])
                                  }
                                >
                                  <div className="max-w-xs truncate">
                                    {row[col.column_name] === null ? (
                                      <span className="text-gray-400 dark:text-gray-600">NULL</span>
                                    ) : typeof row[col.column_name] === 'object' ? (
                                      <code className="text-xs bg-gray-100 dark:bg-gray-900 px-2 py-1 rounded">
                                        [object]
                                      </code>
                                    ) : (
                                      String(row[col.column_name])
                                    )}
                                  </div>
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between px-4 py-3 border-t" style={{ borderColor: 'var(--glass-border)' }}>
                        <div className="text-sm text-gray-600 dark:text-gray-400">
                          Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, tableData.total)} of {tableData.total}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                            disabled={page === 1}
                            className="px-3 py-1 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-sm"
                          >
                            Previous
                          </button>
                          <span className="px-3 py-1 text-sm">
                            Page {page} of {totalPages}
                          </span>
                          <button
                            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                            disabled={page === totalPages}
                            className="px-3 py-1 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-sm"
                          >
                            Next
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex items-center justify-center flex-1">
                    <p className="text-gray-500 dark:text-gray-400">No data found</p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
