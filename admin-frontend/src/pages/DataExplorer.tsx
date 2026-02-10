import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../services/apiClient';
import { Table } from '@shared/components/Table';
import { Card } from '@shared/components/Card';
import { Button } from '@shared/components/Button';
import type { TableInfo, TableSchema, TableData } from '../types/admin';

export const DataExplorer: React.FC = () => {
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  // 获取表列表
  const { data: tablesData, isLoading: tablesLoading } = useQuery({
    queryKey: ['tables'],
    queryFn: () => adminApi.listTables(),
  });

  // 获取表结构
  const { data: schemaData } = useQuery<TableSchema>({
    queryKey: ['table-schema', selectedTable],
    queryFn: () => adminApi.getTableSchema(selectedTable!),
    enabled: !!selectedTable,
  });

  // 获取表数据
  const { data: tableData, isLoading: dataLoading } = useQuery<TableData>({
    queryKey: ['table-data', selectedTable, page],
    queryFn: () => adminApi.getTableData(selectedTable!, page),
    enabled: !!selectedTable,
  });

  const handleExport = async () => {
    if (!selectedTable) return;
    const data = await adminApi.exportTable(selectedTable);
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedTable}_export.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const tables = tablesData?.tables || [];
  const columns = schemaData?.columns || [];
  const rows = tableData?.rows || [];

  return (
    <div className="p-8 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Data Explorer
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-light)' }}>
            浏览和导出数据库表数据
          </p>
        </div>
        {selectedTable && (
          <Button onClick={handleExport} variant="primary">
            导出 JSON
          </Button>
        )}
      </div>

      <div className="grid grid-cols-4 gap-6">
        {/* 左侧：表列表 */}
        <Card className="col-span-1">
          <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
            数据表
          </h2>
          {tablesLoading ? (
            <p style={{ color: 'var(--text-light)' }}>加载中...</p>
          ) : (
            <ul className="space-y-2">
              {tables.map((table: TableInfo) => (
                <li key={table.name}>
                  <button
                    className={`w-full text-left px-3 py-2 rounded-lg transition ${
                      selectedTable === table.name
                        ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white'
                        : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                    }`}
                    onClick={() => {
                      setSelectedTable(table.name);
                      setPage(1);
                    }}
                    style={
                      selectedTable !== table.name
                        ? { color: 'var(--text-primary)' }
                        : {}
                    }
                  >
                    <div className="font-medium">{table.name}</div>
                    <div className="text-xs opacity-70">{table.rowCount} rows</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* 右侧：表详情 */}
        <div className="col-span-3 space-y-6">
          {selectedTable ? (
            <>
              {/* 表结构 */}
              <Card>
                <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
                  Schema: {selectedTable}
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr
                        className="border-b"
                        style={{ borderColor: 'var(--glass-border)' }}
                      >
                        <th className="text-left py-2 px-3">Column</th>
                        <th className="text-left py-2 px-3">Type</th>
                        <th className="text-left py-2 px-3">Nullable</th>
                        <th className="text-left py-2 px-3">Primary Key</th>
                      </tr>
                    </thead>
                    <tbody>
                      {columns.map((col) => (
                        <tr
                          key={col.name}
                          className="border-b"
                          style={{ borderColor: 'var(--glass-border)' }}
                        >
                          <td className="py-2 px-3 font-medium">{col.name}</td>
                          <td className="py-2 px-3" style={{ color: 'var(--text-light)' }}>
                            {col.type}
                          </td>
                          <td className="py-2 px-3">{col.nullable ? 'Yes' : 'No'}</td>
                          <td className="py-2 px-3">{col.primary_key ? '🔑' : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              {/* 表数据 */}
              <Card>
                <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
                  Data
                </h3>
                {dataLoading ? (
                  <p style={{ color: 'var(--text-light)' }}>加载中...</p>
                ) : (
                  <Table
                    columns={columns.map((col) => ({
                      key: col.name,
                      header: col.name,
                      render: (value: any) => (
                        <span className="text-sm">
                          {value === null
                            ? 'NULL'
                            : typeof value === 'object'
                            ? JSON.stringify(value)
                            : String(value)}
                        </span>
                      ),
                    }))}
                    data={rows}
                    pagination={
                      tableData?.pagination
                        ? {
                            page: tableData.pagination.page,
                            pageSize: tableData.pagination.pageSize,
                            total: tableData.pagination.total,
                            onPageChange: setPage,
                          }
                        : undefined
                    }
                  />
                )}
              </Card>
            </>
          ) : (
            <Card>
              <p
                className="text-center py-12"
                style={{ color: 'var(--text-light)' }}
              >
                请从左侧选择一个表以查看数据
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};
