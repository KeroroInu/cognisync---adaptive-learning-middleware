import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, BarChart3, Brain, ChevronLeft, ChevronRight, Loader2, RefreshCw, Search, TrendingUp, UserRound } from 'lucide-react';

import { adminApi } from '../lib/adminApi';
import type {
  EmotionDistributionResponse,
  EmotionTrendResponse,
  EmotionUserDetailResponse,
  User,
} from '../types';

const dayOptions = [7, 14, 30, 90];
const userPageSize = 20;

const intensityTone: Record<string, string> = {
  low: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  high: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
};

const formatDateTime = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN');
};

const formatSigned = (value: number | null | undefined) => {
  if (value == null) return '—';
  return value > 0 ? `+${value}` : String(value);
};

export const EmotionAnalytics = () => {
  const [selectedDays, setSelectedDays] = useState(30);
  const [distribution, setDistribution] = useState<EmotionDistributionResponse | null>(null);
  const [trends, setTrends] = useState<EmotionTrendResponse | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [userQuery, setUserQuery] = useState('');
  const [userPage, setUserPage] = useState(1);
  const [userTotal, setUserTotal] = useState(0);
  const [userDetail, setUserDetail] = useState<EmotionUserDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [userListLoading, setUserListLoading] = useState(false);
  const [userLoading, setUserLoading] = useState(false);
  const [error, setError] = useState('');
  const [userError, setUserError] = useState('');

  const loadOverviewData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [distributionData, trendData] = await Promise.all([
        adminApi.getEmotionDistribution(selectedDays, 12),
        adminApi.getEmotionTrends(selectedDays),
      ]);
      setDistribution(distributionData);
      setTrends(trendData);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载情感统计失败');
    } finally {
      setLoading(false);
    }
  }, [selectedDays]);

  const loadUserOptions = useCallback(async () => {
    try {
      setUserListLoading(true);
      setUserError('');
      const userList = await adminApi.getUsers(userPage, userPageSize, userQuery.trim() || undefined);
      setUsers(userList.users);
      setUserTotal(userList.total);

      if (userList.users.length === 0) {
        setSelectedUserId('');
        setUserDetail(null);
        return;
      }

      const selectedExists = userList.users.some((user) => user.id === selectedUserId);
      if (!selectedExists) {
        setSelectedUserId(userList.users[0].id);
      }
    } catch (err) {
      setUserError(err instanceof Error ? err.message : '加载用户列表失败');
    } finally {
      setUserListLoading(false);
    }
  }, [selectedUserId, userPage, userQuery]);

  const loadUserDetail = useCallback(async (userId: string) => {
    if (!userId) {
      setUserDetail(null);
      return;
    }

    try {
      setUserLoading(true);
      setUserError('');
      const detail = await adminApi.getEmotionUserDetail(userId, 20);
      setUserDetail(detail);
    } catch (err) {
      setUserError(err instanceof Error ? err.message : '加载用户情感明细失败');
    } finally {
      setUserLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverviewData();
  }, [loadOverviewData]);

  useEffect(() => {
    void loadUserOptions();
  }, [loadUserOptions]);

  useEffect(() => {
    if (selectedUserId) {
      void loadUserDetail(selectedUserId);
    }
  }, [selectedUserId, loadUserDetail]);

  const maxDistributionCount = useMemo(
    () => Math.max(...(distribution?.items.map((item) => item.count) ?? [1])),
    [distribution]
  );

  const peakTrendCount = useMemo(
    () => Math.max(...(trends?.points.map((point) => point.totalCount) ?? [1])),
    [trends]
  );

  const activeUser = useMemo(
    () => users.find((item) => item.id === selectedUserId) ?? null,
    [users, selectedUserId]
  );
  const userTotalPages = Math.max(1, Math.ceil(userTotal / userPageSize));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-card p-6 rounded-2xl">
        <p className="text-red-500">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">情感统计分析</h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            查看情感分布、时间趋势与用户级明细，辅助教学研究中的情绪轨迹解释与样本筛查。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-xl border px-3 py-2">
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>统计窗口</span>
            <select
              value={selectedDays}
              onChange={(event) => setSelectedDays(Number(event.target.value))}
              className="bg-transparent text-sm outline-none"
            >
              {dayOptions.map((day) => (
                <option key={day} value={day}>
                  最近 {day} 天
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={() => void loadOverviewData()}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors"
          >
            <RefreshCw size={16} />
            刷新
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          {
            label: '情感日志总数',
            value: distribution?.totalLogs ?? 0,
            icon: Activity,
          },
          {
            label: '情感类别数',
            value: distribution?.items.length ?? 0,
            icon: BarChart3,
          },
          {
            label: '趋势数据点',
            value: trends?.points.filter((point) => point.totalCount > 0).length ?? 0,
            icon: TrendingUp,
          },
          {
            label: '当前用户样本',
            value: userDetail?.summary.totalLogs ?? 0,
            icon: UserRound,
          },
        ].map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="glass-card rounded-2xl p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>{card.label}</p>
                  <p className="text-3xl font-bold">{card.value}</p>
                </div>
                <div className="w-12 h-12 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 flex items-center justify-center">
                  <Icon size={24} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_1fr] gap-6">
        <section className="glass-card rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-300 flex items-center justify-center">
              <BarChart3 size={20} />
            </div>
            <div>
              <h2 className="text-lg font-semibold">情感分布</h2>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                展示近期高频情感编码及平均置信度，便于观察主要情绪构成。
              </p>
            </div>
          </div>
          {distribution && distribution.items.length > 0 ? (
            <div className="space-y-4">
              {distribution.items.map((item) => (
                <div key={`${item.emotionCode}-${item.intensity}`} className="rounded-xl border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{item.emotionName}</span>
                        <span className="text-xs px-2 py-1 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-300">
                          {item.emotionCode}
                        </span>
                        <span className={`text-xs px-2 py-1 rounded-full ${intensityTone[item.intensity] ?? intensityTone.medium}`}>
                          {item.intensity}
                        </span>
                      </div>
                      <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                        兼容旧值 {item.legacyEmotion} · 平均置信度 {(item.avgConfidence * 100).toFixed(1)}%
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-semibold">{item.count}</p>
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{item.percentage.toFixed(1)}%</p>
                    </div>
                  </div>
                  <div className="h-3 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-600"
                      style={{ width: `${(item.count / maxDistributionCount) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed p-8 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
              当前统计窗口没有情感日志。
            </div>
          )}
        </section>

        <section className="glass-card rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 flex items-center justify-center">
              <TrendingUp size={20} />
            </div>
            <div>
              <h2 className="text-lg font-semibold">情感趋势</h2>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                按日查看情感日志波动、效价与唤醒度，适合教学干预时序分析。
              </p>
            </div>
          </div>
          {trends && trends.points.length > 0 ? (
            <div className="space-y-3">
              {trends.points.map((point) => (
                <div key={point.date} className="rounded-xl border p-4">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div>
                      <p className="font-medium">{point.date}</p>
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        平均效价 {point.averageValence.toFixed(2)} · 平均唤醒度 {point.averageArousal.toFixed(2)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-semibold">{point.totalCount}</p>
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        置信度 {(point.averageConfidence * 100).toFixed(1)}%
                      </p>
                    </div>
                  </div>
                  <div className="h-2.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden mb-3">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-500"
                      style={{ width: `${peakTrendCount > 0 ? (point.totalCount / peakTrendCount) * 100 : 0}%` }}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(point.emotionCounts).length > 0 ? (
                      Object.entries(point.emotionCounts).map(([code, count]) => (
                        <span
                          key={`${point.date}-${code}`}
                          className="text-xs px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-800"
                        >
                          {code}: {count}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        当日无详细情感计数
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed p-8 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
              暂无趋势数据。
            </div>
          )}
        </section>
      </div>

      <section className="glass-card rounded-2xl p-6 space-y-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-300 flex items-center justify-center">
              <Brain size={20} />
            </div>
            <div>
              <h2 className="text-lg font-semibold">用户情感明细</h2>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                结合最近画像快照查看单个学生的情绪轨迹和消息证据。
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-xl border px-3 py-2 min-w-[280px]">
              <Search size={16} style={{ color: 'var(--text-secondary)' }} />
              <input
                value={userQuery}
                onChange={(event) => {
                  setUserQuery(event.target.value);
                  setUserPage(1);
                }}
                placeholder="搜索用户名 / 学号"
                className="w-full bg-transparent outline-none text-sm"
              />
            </div>
            <select
              value={selectedUserId}
              onChange={(event) => setSelectedUserId(event.target.value)}
              className="min-w-[260px] rounded-xl border px-3 py-2 bg-transparent"
              disabled={userListLoading}
            >
              {users.length === 0 && <option value="">暂无可选用户</option>}
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name} · {user.student_id}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-2 rounded-xl border px-2 py-2">
              <button
                onClick={() => setUserPage((prev) => Math.max(1, prev - 1))}
                className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
                disabled={userPage <= 1 || userListLoading}
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-sm min-w-[72px] text-center">
                {userPage} / {userTotalPages}
              </span>
              <button
                onClick={() => setUserPage((prev) => Math.min(userTotalPages, prev + 1))}
                className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
                disabled={userPage >= userTotalPages || userListLoading}
              >
                <ChevronRight size={16} />
              </button>
            </div>
            <button
              onClick={() => {
                if (selectedUserId) {
                  void loadUserDetail(selectedUserId);
                }
              }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors"
              disabled={!selectedUserId}
            >
              <RefreshCw size={16} />
              刷新明细
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
          <span>
            {userListLoading ? '正在加载用户列表…' : `匹配 ${userTotal} 位用户，每页 ${userPageSize} 位`}
          </span>
          {userQuery.trim() && (
            <span>
              当前关键词：{userQuery.trim()}
            </span>
          )}
        </div>

        {userError && (
          <div className="rounded-xl border px-4 py-3 text-sm text-red-500" style={{ borderColor: 'rgba(239,68,68,0.35)' }}>
            {userError}
          </div>
        )}

        {userLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={24} className="animate-spin text-indigo-500" />
          </div>
        ) : userDetail ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
              <div className="rounded-xl border p-4">
                <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>学生</p>
                <p className="font-semibold">{userDetail.summary.name}</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                  {activeUser?.student_id ?? userDetail.summary.studentId}
                </p>
              </div>
              <div className="rounded-xl border p-4">
                <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>日志数</p>
                <p className="text-2xl font-semibold">{userDetail.summary.totalLogs}</p>
              </div>
              <div className="rounded-xl border p-4">
                <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>最近情感</p>
                <p className="font-semibold">
                  {userDetail.summary.latestEmotionName || '—'}
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                  {userDetail.summary.latestEmotionCode || '—'}
                </p>
              </div>
              <div className="rounded-xl border p-4">
                <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>最近分析时间</p>
                <p className="font-semibold text-sm">{formatDateTime(userDetail.summary.lastAnalyzedAt)}</p>
              </div>
              <div className="rounded-xl border p-4">
                <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>当前画像</p>
                <p className="text-sm font-semibold">
                  C {userDetail.summary.currentCognition ?? '—'} / A {userDetail.summary.currentAffect ?? '—'} / B {userDetail.summary.currentBehavior ?? '—'}
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[1200px]">
                <thead style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                  <tr>
                    {['时间', '情感', '强度', '意图', '效价/唤醒', '画像快照', 'Delta', '概念与证据'].map((header) => (
                      <th key={header} className="px-4 py-3 text-left text-sm font-semibold">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {userDetail.logs.map((log) => (
                    <tr key={log.id} className="border-t" style={{ borderColor: 'var(--glass-border)' }}>
                      <td className="px-4 py-3 text-sm whitespace-nowrap">{formatDateTime(log.createdAt)}</td>
                      <td className="px-4 py-3 text-sm">
                        <div className="font-medium">{log.emotionName}</div>
                        <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                          {log.emotionCode} / {log.emotion}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`text-xs px-2 py-1 rounded-full ${intensityTone[log.intensity] ?? intensityTone.medium}`}>
                          {log.intensity}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm">{log.intent}</td>
                      <td className="px-4 py-3 text-sm">
                        <div>V {log.valence.toFixed(2)}</div>
                        <div>A {log.arousal.toFixed(2)}</div>
                        <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                          {(log.confidence * 100).toFixed(1)}%
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        C {log.profileCognition ?? '—'} / A {log.profileAffect ?? '—'} / B {log.profileBehavior ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <div>C {formatSigned(log.deltaCognition)}</div>
                        <div>A {formatSigned(log.deltaAffect)}</div>
                        <div>B {formatSigned(log.deltaBehavior)}</div>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <div className="mb-2">
                          {(log.detectedConcepts?.length ?? 0) > 0 ? log.detectedConcepts.join('、') : '无概念'}
                        </div>
                        <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                          {(log.evidence?.length ?? 0) > 0 ? log.evidence.join('；') : '无证据'}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="rounded-xl border border-dashed p-8 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
            请选择一个用户查看情感明细。
          </div>
        )}
      </section>
    </div>
  );
};
