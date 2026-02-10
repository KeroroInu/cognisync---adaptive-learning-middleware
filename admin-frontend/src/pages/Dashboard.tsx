import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../services/apiClient';
import { Card } from '@shared/components/Card';
import { Activity, Users, MessageSquare, TrendingUp } from 'lucide-react';
import type { SystemOverview, UserActivity } from '../types/admin';

export const Dashboard: React.FC = () => {
  const { data: analyticsData, isLoading } = useQuery({
    queryKey: ['analytics-overview'],
    queryFn: () => adminApi.getAnalyticsOverview(),
  });

  const overview: SystemOverview = analyticsData?.overview;
  const activityTrend: UserActivity[] = analyticsData?.activityTrend || [];

  const stats = [
    {
      label: '总用户数',
      value: overview?.totalUsers || 0,
      icon: Users,
      color: '#3b82f6',
    },
    {
      label: '总消息数',
      value: overview?.totalMessages || 0,
      icon: MessageSquare,
      color: '#10b981',
    },
    {
      label: '7日活跃用户',
      value: overview?.activeUsersLast7Days || 0,
      icon: Activity,
      color: '#f59e0b',
    },
    {
      label: '人均消息数',
      value: overview?.avgMessagesPerUser?.toFixed(1) || '0',
      icon: TrendingUp,
      color: '#8b5cf6',
    },
  ];

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
          Dashboard
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-light)' }}>
          系统概览和统计数据
        </p>
      </div>

      {isLoading ? (
        <Card>
          <p style={{ color: 'var(--text-light)' }}>加载中...</p>
        </Card>
      ) : (
        <>
          {/* 统计卡片 */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {stats.map((stat, index) => (
              <Card
                key={index}
                className="animate-fade-in"
                style={{ animationDelay: `${index * 100}ms` }}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm" style={{ color: 'var(--text-light)' }}>
                      {stat.label}
                    </p>
                    <p className="text-3xl font-bold mt-2" style={{ color: 'var(--text-primary)' }}>
                      {stat.value}
                    </p>
                  </div>
                  <div
                    className="w-12 h-12 rounded-lg flex items-center justify-center"
                    style={{ backgroundColor: `${stat.color}20` }}
                  >
                    <stat.icon size={24} style={{ color: stat.color }} />
                  </div>
                </div>
              </Card>
            ))}
          </div>

          {/* 活跃度趋势 */}
          <Card>
            <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
              7日活跃度趋势
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr
                    className="border-b"
                    style={{ borderColor: 'var(--glass-border)' }}
                  >
                    <th className="text-left py-2 px-3">日期</th>
                    <th className="text-left py-2 px-3">活跃用户数</th>
                    <th className="text-left py-2 px-3">消息总数</th>
                  </tr>
                </thead>
                <tbody>
                  {activityTrend.map((item) => (
                    <tr
                      key={item.date}
                      className="border-b"
                      style={{ borderColor: 'var(--glass-border)' }}
                    >
                      <td className="py-2 px-3">{item.date}</td>
                      <td className="py-2 px-3">{item.activeUsers}</td>
                      <td className="py-2 px-3">{item.totalMessages}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
};
