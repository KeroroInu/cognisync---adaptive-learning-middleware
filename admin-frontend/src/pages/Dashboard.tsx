import { useEffect, useState } from 'react';
import { adminApi } from '../lib/adminApi';
import type { OverviewStats } from '../types';
import { Users, MessageSquare, FileText, Activity } from 'lucide-react';

export const Dashboard = () => {
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
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-card p-6 rounded-2xl">
        <p className="text-red-500">Error: {error}</p>
      </div>
    );
  }

  const statCards = [
    { label: 'Total Users', value: stats?.users_count || 0, icon: Users, color: 'from-blue-500 to-indigo-600' },
    { label: 'Chat Sessions', value: stats?.sessions_count || 0, icon: MessageSquare, color: 'from-purple-500 to-pink-600' },
    { label: 'Messages', value: stats?.messages_count || 0, icon: Activity, color: 'from-green-500 to-teal-600' },
    { label: 'Scale Templates', value: stats?.templates_count || 0, icon: FileText, color: 'from-orange-500 to-red-600' },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((card, idx) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className={`glass-card p-6 rounded-2xl hover:shadow-xl transition-all duration-300 stagger-${idx + 1}`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">{card.label}</p>
                  <p className="text-3xl font-bold mt-2">{card.value.toLocaleString()}</p>
                </div>
                <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${card.color} flex items-center justify-center shadow-lg`}>
                  <Icon size={28} className="text-white" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="glass-card p-6 rounded-2xl">
        <h2 className="text-lg font-semibold mb-4">System Overview</h2>
        <div className="space-y-3">
          <div className="flex justify-between items-center py-2">
            <span className="text-gray-600 dark:text-gray-400">Scale Responses</span>
            <span className="font-semibold">{stats?.responses_count || 0}</span>
          </div>
          <div className="flex justify-between items-center py-2">
            <span className="text-gray-600 dark:text-gray-400">Avg Messages per Session</span>
            <span className="font-semibold">
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
