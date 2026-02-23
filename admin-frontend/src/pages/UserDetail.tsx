import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { adminApi } from '../lib/adminApi';
import type { UserDetail as UserDetailType, ChatMessage, ProfileSnapshot, ScaleResponse } from '../types';
import {
  ArrowLeft, MessageSquare, TrendingUp, FileText,
  ArrowUp, ArrowDown, Minus, Brain, Heart, Zap,
} from 'lucide-react';

// ── Mini SVG trend chart ──────────────────────────────────────────────────────
const ProfileChart = ({ data }: { data: ProfileSnapshot[] }) => {
  if (data.length < 2) return null;
  const sorted = [...data].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  const W = 400, H = 100, PX = 16, PY = 12;
  const cW = W - PX * 2, cH = H - PY * 2;
  const x = (i: number) => PX + (i / (sorted.length - 1)) * cW;
  const y = (v: number) => H - PY - (v / 100) * cH;
  const path = (key: 'cognition' | 'affect' | 'behavior') =>
    sorted.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(d[key]).toFixed(1)}`).join(' ');

  const gridValues = [0, 25, 50, 75, 100];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 100 }}>
      {gridValues.map(v => (
        <line key={v} x1={PX} y1={y(v)} x2={W - PX} y2={y(v)}
          stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
      ))}
      <path d={path('cognition')} fill="none" stroke="rgb(99,102,241)" strokeWidth="1.5" strokeLinejoin="round" />
      <path d={path('affect')} fill="none" stroke="rgb(168,85,247)" strokeWidth="1.5" strokeLinejoin="round" />
      <path d={path('behavior')} fill="none" stroke="rgb(236,72,153)" strokeWidth="1.5" strokeLinejoin="round" />
      {sorted.map((d, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(d.cognition)} r={d.source === 'user' ? 4 : 2.5}
            fill={d.source === 'user' ? 'rgb(99,102,241)' : 'rgba(99,102,241,0.5)'}
            stroke="rgba(255,255,255,0.3)" strokeWidth="0.5" />
          <circle cx={x(i)} cy={y(d.affect)} r={d.source === 'user' ? 4 : 2.5}
            fill={d.source === 'user' ? 'rgb(168,85,247)' : 'rgba(168,85,247,0.5)'}
            stroke="rgba(255,255,255,0.3)" strokeWidth="0.5" />
          <circle cx={x(i)} cy={y(d.behavior)} r={d.source === 'user' ? 4 : 2.5}
            fill={d.source === 'user' ? 'rgb(236,72,153)' : 'rgba(236,72,153,0.5)'}
            stroke="rgba(255,255,255,0.3)" strokeWidth="0.5" />
        </g>
      ))}
    </svg>
  );
};

// ── Delta badge ───────────────────────────────────────────────────────────────
const Delta = ({ curr, prev }: { curr: number; prev: number }) => {
  const d = curr - prev;
  if (d === 0) return <Minus size={12} className="text-gray-400" />;
  if (d > 0) return (
    <span className="flex items-center gap-0.5 text-green-500 text-xs font-medium">
      <ArrowUp size={10} />+{d}
    </span>
  );
  return (
    <span className="flex items-center gap-0.5 text-red-400 text-xs font-medium">
      <ArrowDown size={10} />{d}
    </span>
  );
};

// ── Ring progress ─────────────────────────────────────────────────────────────
const Ring = ({ value, color, label, Icon }: { value: number; color: string; label: string; Icon: React.ElementType }) => {
  const r = 36, circ = 2 * Math.PI * r;
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-20 h-20">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 88 88">
          <circle cx="44" cy="44" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
          <circle cx="44" cy="44" r={r} fill="none" stroke={color} strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${(value / 100) * circ} ${circ}`}
            style={{ transition: 'stroke-dasharray 0.6s ease' }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <Icon size={14} style={{ color }} />
          <span className="text-sm font-bold mt-0.5">{value}</span>
        </div>
      </div>
      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</span>
    </div>
  );
};

// ── Main component ────────────────────────────────────────────────────────────
export const UserDetail = () => {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const [userDetail, setUserDetail] = useState<UserDetailType | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [profiles, setProfiles] = useState<ProfileSnapshot[]>([]);
  const [scaleResponses, setScaleResponses] = useState<ScaleResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'messages' | 'profiles' | 'scales'>('messages');
  const [profileFilter, setProfileFilter] = useState<'all' | 'system' | 'user'>('all');
  const [expandedScales, setExpandedScales] = useState<Set<string>>(new Set());

  useEffect(() => { if (userId) loadData(); }, [userId]);

  const loadData = async () => {
    if (!userId) return;
    try {
      setLoading(true);
      setError('');
      const [userRes, messagesRes, profilesRes, scalesRes] = await Promise.all([
        adminApi.getUserDetail(userId),
        adminApi.getUserMessages(userId, 100),
        adminApi.getUserProfiles(userId),
        adminApi.getUserScaleResponses(userId),
      ]);
      setUserDetail(userRes);
      setMessages(messagesRes.messages);
      setProfiles(profilesRes);
      setScaleResponses(scalesRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load user data');
    } finally {
      setLoading(false);
    }
  };

  const toggleScale = (id: string) => {
    setExpandedScales(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500" />
      </div>
    );
  }

  if (error || !userDetail) {
    return (
      <div className="space-y-6 animate-fade-in">
        <button onClick={() => navigate('/admin/users')}
          className="flex items-center gap-2 text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 transition-colors">
          <ArrowLeft size={20} />返回用户列表
        </button>
        <div className="glass-card p-6 rounded-2xl">
          <p className="text-red-500">{error || '用户不存在'}</p>
        </div>
      </div>
    );
  }

  // Derive current profile from latest snapshot
  const sortedProfiles = [...profiles].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  const currentProfile = sortedProfiles[0] ?? null;

  // Profile filtered list
  const filteredProfiles = sortedProfiles.filter(p =>
    profileFilter === 'all' ? true : p.source === profileFilter
  );

  // User-modified records count
  const userModifiedCount = profiles.filter(p => p.source === 'user').length;

  // Initials avatar
  const initials = (userDetail.name || userDetail.email).slice(0, 2).toUpperCase();

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Back button */}
      <button onClick={() => navigate('/admin/users')}
        className="flex items-center gap-2 text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 transition-colors">
        <ArrowLeft size={20} />返回用户列表
      </button>

      {/* ── User Info Header ── */}
      <div className="glass-card p-6 rounded-2xl stagger-1">
        <div className="flex flex-col md:flex-row md:items-start gap-6">
          {/* Avatar + basic info */}
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-xl font-bold text-white flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, rgb(99,102,241), rgb(168,85,247))' }}>
              {initials}
            </div>
            <div>
              <h1 className="text-2xl font-bold">{userDetail.name || '(未命名)'}</h1>
              <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">{userDetail.email}</p>
              <div className="flex gap-2 mt-2 flex-wrap">
                <span className="px-2 py-0.5 rounded text-xs font-medium"
                  style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--glass-border)' }}>
                  {userDetail.role}
                </span>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                  userDetail.is_active
                    ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-500'
                }`}>
                  {userDetail.is_active ? '已激活' : '已禁用'}
                </span>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="flex gap-6 md:ml-auto flex-wrap">
            {[
              { label: '消息总数', value: userDetail.messages_count, icon: MessageSquare, color: 'text-indigo-500' },
              { label: '会话数', value: userDetail.sessions_count, icon: TrendingUp, color: 'text-purple-500' },
              { label: '量表完成', value: userDetail.responses_count, icon: FileText, color: 'text-pink-500' },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="text-center">
                <div className={`flex items-center gap-1 justify-center ${color}`}>
                  <Icon size={16} />
                  <span className="text-2xl font-bold">{value}</span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          {/* Dates */}
          <div className="text-sm text-gray-500 dark:text-gray-400 space-y-1 md:text-right flex-shrink-0">
            <p>注册：{new Date(userDetail.created_at).toLocaleDateString('zh-CN')}</p>
            {userDetail.last_active_at && (
              <p>活跃：{new Date(userDetail.last_active_at).toLocaleDateString('zh-CN')}</p>
            )}
          </div>
        </div>

        {/* Current profile rings */}
        {currentProfile && (
          <div className="mt-6 pt-6 border-t" style={{ borderColor: 'var(--glass-border)' }}>
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-semibold text-gray-600 dark:text-gray-400">当前画像</p>
              <span className="text-xs text-gray-500 dark:text-gray-500">
                更新于 {new Date(currentProfile.created_at).toLocaleString('zh-CN')}
                {currentProfile.source === 'user' && (
                  <span className="ml-2 px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-300">用户自评</span>
                )}
              </span>
            </div>
            <div className="flex justify-around">
              <Ring value={currentProfile.cognition} color="rgb(99,102,241)" label="认知" Icon={Brain} />
              <Ring value={currentProfile.affect} color="rgb(168,85,247)" label="情感" Icon={Heart} />
              <Ring value={currentProfile.behavior} color="rgb(236,72,153)" label="行为" Icon={Zap} />
            </div>
          </div>
        )}
      </div>

      {/* ── Tabs ── */}
      <div className="glass-card rounded-2xl overflow-hidden stagger-2">
        <div className="flex border-b" style={{ borderColor: 'var(--glass-border)' }}>
          {([
            { key: 'messages', label: '对话记录', icon: MessageSquare, count: messages.length },
            { key: 'profiles', label: '画像变化', icon: TrendingUp, count: profiles.length },
            { key: 'scales', label: '量表评分', icon: FileText, count: scaleResponses.length },
          ] as const).map(({ key, label, icon: Icon, count }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex-1 px-4 py-4 text-sm font-medium transition-colors ${
                activeTab === key
                  ? 'border-b-2 border-indigo-500 text-indigo-600 dark:text-indigo-400'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-300'
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                <Icon size={16} />
                <span>{label}</span>
                <span className="px-1.5 py-0.5 rounded text-xs"
                  style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                  {count}
                </span>
              </div>
            </button>
          ))}
        </div>

        <div className="p-6">

          {/* ════ MESSAGES TAB ════ */}
          {activeTab === 'messages' && (
            <div>
              {messages.length === 0 ? (
                <p className="text-center text-gray-500 py-12">暂无对话记录</p>
              ) : (
                <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
                  {[...messages].reverse().map((msg) => (
                    <div key={msg.id}
                      className={`p-4 rounded-xl ${
                        msg.role === 'user'
                          ? 'bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800/50 ml-0 mr-8'
                          : 'bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-700/50 ml-8 mr-0'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className={`text-xs font-semibold ${
                          msg.role === 'user' ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-500 dark:text-gray-400'
                        }`}>
                          {msg.role === 'user' ? '学生' : 'AI 教师'}
                        </span>
                        <span className="text-xs text-gray-400">
                          {new Date(msg.timestamp).toLocaleString('zh-CN')}
                        </span>
                      </div>
                      <p className="text-sm leading-relaxed">{msg.text}</p>
                      {msg.analysis && Object.keys(msg.analysis).length > 0 && (
                        <details className="mt-2">
                          <summary className="text-xs text-indigo-500 cursor-pointer hover:text-indigo-600 select-none">
                            查看分析数据
                          </summary>
                          <pre className="mt-2 p-2 rounded text-xs overflow-x-auto"
                            style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                            {JSON.stringify(msg.analysis, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ════ PROFILES TAB ════ */}
          {activeTab === 'profiles' && (
            <div className="space-y-5">
              {/* Chart */}
              {profiles.length >= 2 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">变化趋势</p>
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block rounded" style={{ backgroundColor: 'rgb(99,102,241)' }} />认知</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block rounded" style={{ backgroundColor: 'rgb(168,85,247)' }} />情感</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block rounded" style={{ backgroundColor: 'rgb(236,72,153)' }} />行为</span>
                      <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full inline-block border border-white/30" style={{ backgroundColor: 'rgb(168,85,247)' }} />用户自评</span>
                    </div>
                  </div>
                  <div className="rounded-xl p-3" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                    <ProfileChart data={profiles} />
                  </div>
                </div>
              )}

              {/* Filter + summary */}
              <div className="flex items-center justify-between">
                <div className="flex gap-2">
                  {([
                    { key: 'all', label: `全部 (${profiles.length})` },
                    { key: 'system', label: `AI 分析 (${profiles.length - userModifiedCount})` },
                    { key: 'user', label: `用户自评 (${userModifiedCount})` },
                  ] as const).map(({ key, label }) => (
                    <button key={key} onClick={() => setProfileFilter(key)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        profileFilter === key
                          ? 'bg-indigo-600 text-white'
                          : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                      }`}
                      style={profileFilter !== key ? { border: '1px solid var(--glass-border)' } : {}}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Snapshots list */}
              {filteredProfiles.length === 0 ? (
                <p className="text-center text-gray-500 py-8">暂无{profileFilter === 'user' ? '用户自评' : ''}画像记录</p>
              ) : (
                <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2">
                  {filteredProfiles.map((profile, idx) => {
                    const prev = filteredProfiles[idx + 1];
                    const isUserModified = profile.source === 'user';
                    return (
                      <div key={profile.id}
                        className={`p-4 rounded-xl border ${
                          isUserModified
                            ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800/50'
                            : 'bg-blue-50 dark:bg-blue-900/10 border-blue-100 dark:border-blue-800/30'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                              isUserModified
                                ? 'bg-purple-100 dark:bg-purple-900/60 text-purple-700 dark:text-purple-300'
                                : 'bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300'
                            }`}>
                              {isUserModified ? '用户自评' : 'AI 分析'}
                            </span>
                            {idx === 0 && (
                              <span className="px-2 py-0.5 rounded text-xs font-semibold bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300">
                                当前
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-gray-400">
                            {new Date(profile.created_at).toLocaleString('zh-CN')}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-4">
                          {[
                            { key: 'cognition', label: '认知', color: 'text-indigo-600 dark:text-indigo-400' },
                            { key: 'affect', label: '情感', color: 'text-purple-600 dark:text-purple-400' },
                            { key: 'behavior', label: '行为', color: 'text-pink-600 dark:text-pink-400' },
                          ].map(({ key, label, color }) => {
                            const curr = profile[key as 'cognition' | 'affect' | 'behavior'];
                            const prevVal = prev?.[key as 'cognition' | 'affect' | 'behavior'];
                            return (
                              <div key={key}>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</p>
                                <div className="flex items-center gap-2">
                                  <span className={`text-xl font-bold ${color}`}>{curr}</span>
                                  {prevVal !== undefined && <Delta curr={curr} prev={prevVal} />}
                                </div>
                                <div className="mt-1.5 h-1.5 rounded-full overflow-hidden"
                                  style={{ backgroundColor: 'var(--glass-border)' }}>
                                  <div className="h-full rounded-full transition-all duration-500"
                                    style={{
                                      width: `${curr}%`,
                                      background: key === 'cognition'
                                        ? 'rgb(99,102,241)'
                                        : key === 'affect'
                                        ? 'rgb(168,85,247)'
                                        : 'rgb(236,72,153)'
                                    }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ════ SCALE RESPONSES TAB ════ */}
          {activeTab === 'scales' && (
            <div className="space-y-4">
              {scaleResponses.length === 0 ? (
                <p className="text-center text-gray-500 py-12">暂无量表响应记录</p>
              ) : (
                <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
                  {scaleResponses.map((resp) => {
                    const expanded = expandedScales.has(resp.id);
                    const scores = resp.scores_json ?? {};
                    const scoreEntries = Object.entries(scores);
                    return (
                      <div key={resp.id} className="rounded-xl border overflow-hidden"
                        style={{ borderColor: 'var(--glass-border)' }}>
                        {/* Header */}
                        <button
                          onClick={() => toggleScale(resp.id)}
                          className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                        >
                          <div>
                            <p className="font-semibold text-sm">
                              {resp.template_name || `量表 ${resp.template_id.slice(0, 8)}…`}
                            </p>
                            <p className="text-xs text-gray-400 mt-0.5">
                              {new Date(resp.created_at).toLocaleString('zh-CN')}
                            </p>
                          </div>
                          <div className="flex items-center gap-3">
                            {/* Score summary pills */}
                            {scoreEntries.slice(0, 3).map(([k, v]) => (
                              <span key={k} className="px-2 py-0.5 rounded text-xs font-medium"
                                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--glass-border)' }}>
                                {k}: {typeof v === 'number' ? v.toFixed(0) : String(v)}
                              </span>
                            ))}
                            <span className="text-gray-400 text-xs ml-2">{expanded ? '▲' : '▼'}</span>
                          </div>
                        </button>

                        {/* Expanded content */}
                        {expanded && (
                          <div className="border-t px-4 pb-4 pt-3 space-y-3"
                            style={{ borderColor: 'var(--glass-border)', backgroundColor: 'var(--bg-secondary)' }}>
                            {/* Scores */}
                            {scoreEntries.length > 0 && (
                              <div>
                                <p className="text-xs font-semibold text-gray-500 mb-2">评分结果</p>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                  {scoreEntries.map(([k, v]) => (
                                    <div key={k} className="p-2 rounded-lg text-center"
                                      style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                                      <p className="text-xs text-gray-500">{k}</p>
                                      <p className="text-lg font-bold text-indigo-600 dark:text-indigo-400">
                                        {typeof v === 'number' ? v.toFixed(1) : String(v)}
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {/* Answers */}
                            <div>
                              <p className="text-xs font-semibold text-gray-500 mb-2">原始作答</p>
                              <pre className="p-3 rounded-lg text-xs overflow-x-auto"
                                style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                                {JSON.stringify(resp.answers_json, null, 2)}
                              </pre>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
