import React from 'react';

export interface TableColumn<T> {
  key: keyof T | string;
  header: string;
  render?: (value: any, row: T) => React.ReactNode;
  width?: string;
}

export interface TablePagination {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

export interface TableProps<T> {
  columns: TableColumn<T>[];
  data: T[];
  pagination?: TablePagination;
  className?: string;
  emptyMessage?: string;
}

export function Table<T extends Record<string, any>>({
  columns,
  data,
  pagination,
  className = '',
  emptyMessage = 'No data available'
}: TableProps<T>) {
  const getCellValue = (row: T, column: TableColumn<T>) => {
    const value = row[column.key as keyof T];
    return column.render ? column.render(value, row) : value;
  };

  return (
    <div className={className}>
      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full glass-card">
          <thead>
            <tr className="border-b" style={{ borderColor: 'var(--glass-border)' }}>
              {columns.map((col, idx) => (
                <th
                  key={idx}
                  className="text-left p-3 font-semibold"
                  style={{ width: col.width, color: 'var(--text-primary)' }}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="text-center p-8"
                  style={{ color: 'var(--text-light)' }}
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              data.map((row, rowIdx) => (
                <tr
                  key={rowIdx}
                  className="border-b hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  style={{ borderColor: 'var(--glass-border)' }}
                >
                  {columns.map((col, colIdx) => (
                    <td key={colIdx} className="p-3" style={{ color: 'var(--text-primary)' }}>
                      {getCellValue(row, col)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination && data.length > 0 && (
        <div className="flex justify-between items-center mt-4 px-2">
          <span className="text-sm" style={{ color: 'var(--text-light)' }}>
            Page {pagination.page} of {Math.ceil(pagination.total / pagination.pageSize)} ({pagination.total} total)
          </span>
          <div className="space-x-2">
            <button
              onClick={() => pagination.onPageChange(pagination.page - 1)}
              disabled={pagination.page === 1}
              className="px-3 py-1 glass-card rounded transition-all hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ color: 'var(--text-primary)' }}
            >
              Previous
            </button>
            <button
              onClick={() => pagination.onPageChange(pagination.page + 1)}
              disabled={pagination.page * pagination.pageSize >= pagination.total}
              className="px-3 py-1 glass-card rounded transition-all hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ color: 'var(--text-primary)' }}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
