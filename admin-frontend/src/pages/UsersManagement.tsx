import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../services/apiClient';
import { Card } from '@shared/components/Card';
import { Table } from '@shared/components/Table';
import type { UserSummary } from '../types/admin';

export const UsersManagement: React.FC = () => {
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['users', page],
    queryFn: () => adminApi.listUsers(page),
  });

  const users: UserSummary[] = data?.users || [];
  const total = data?.total || 0;
  const pageSize = data?.pageSize || 20;

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
          Users Management
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-light)' }}>
          用户管理和统计
        </p>
      </div>

      <Card>
        {isLoading ? (
          <p style={{ color: 'var(--text-light)' }}>加载中...</p>
        ) : (
          <Table
            columns={[
              { key: 'email', header: 'Email' },
              {
                key: 'created_at',
                header: 'Created At',
                render: (value: string) => new Date(value).toLocaleDateString('zh-CN'),
              },
              { key: 'message_count', header: 'Messages' },
              {
                key: 'last_active',
                header: 'Last Active',
                render: (value: string | null) =>
                  value ? new Date(value).toLocaleDateString('zh-CN') : 'N/A',
              },
            ]}
            data={users}
            pagination={{
              page,
              pageSize,
              total,
              onPageChange: setPage,
            }}
          />
        )}
      </Card>
    </div>
  );
};
