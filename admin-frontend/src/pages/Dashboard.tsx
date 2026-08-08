import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminApi } from '../lib/adminApi';
import type { OverviewStats } from '../types';
import { Users, MessageSquare, FileText, Activity } from 'lucide-react';

export const Dashboard = () => {
  const { t } = useTranslation();
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      setLoading(true);
      const data = await adminApi.getOverview();
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stats');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[color:var(--brand-purple)]"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-card p-6 rounded-2xl">
        <p className="text-red-500">{t('common.error')}: {error}</p>
      </div>
    );
  }

  const statCards = [
    { label: t('dashboard.totalUsers'), value: stats?.users_count || 0, icon: Users },
    { label: t('dashboard.totalSessions'), value: stats?.sessions_count || 0, icon: MessageSquare },
    { label: t('dashboard.totalMessages'), value: stats?.messages_count || 0, icon: Activity },
    { label: t('dashboard.scaleTemplates'), value: stats?.templates_count || 0, icon: FileText },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <p className="admin-page-kicker">系统总览</p>
        <h1 className="metallic-text text-3xl font-bold leading-tight">CogniSync 过程诊断控制台</h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--text-tertiary)' }}>
          汇总学生、项目任务、会话与量表数据，为从解构到建构的课堂过程提供诊断入口。
        </p>
      </div>

      <div className="admin-dashboard-grid">
        {statCards.map((card, idx) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className={`admin-stat-card glass-card transition-all duration-300 stagger-${idx + 1}`}>
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-bold" style={{ color: 'var(--text-tertiary)' }}>{card.label}</p>
                  <p className="mt-2 text-4xl font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>{card.value.toLocaleString()}</p>
                </div>
                <div className="admin-stat-icon flow-surface">
                  <Icon size={26} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="admin-overview-card glass-card">
        <h2 className="mb-4 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{t('dashboard.overview')}</h2>
        <div className="space-y-3">
          <div className="admin-divider-row">
            <span style={{ color: 'var(--text-secondary)' }}>{t('dashboard.scaleResponses')}</span>
            <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{stats?.responses_count || 0}</span>
          </div>
          <div className="admin-divider-row">
            <span style={{ color: 'var(--text-secondary)' }}>平均每会话消息数</span>
            <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
              {stats && stats.sessions_count > 0
                ? (stats.messages_count / stats.sessions_count).toFixed(1)
                : '0'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
