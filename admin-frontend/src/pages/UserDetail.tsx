import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { adminApi } from '../lib/adminApi';
import type { UserDetail as UserDetailType, ChatMessage, ProfileSnapshot, ScaleResponse } from '../types';
import { ArrowLeft, MessageSquare, TrendingUp, FileText } from 'lucide-react';

export const UserDetail = () => {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const [userDetail, setUserDetail] = useState<UserDetailType | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [profiles, setProfiles] = useState<ProfileSnapshot[]>([]);
  const [scaleResponses, setScaleResponses] = useState<ScaleResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'messages' | 'profiles' | 'scales'>('messages');

  useEffect(() => {
    if (userId) loadData();
  }, [userId]);

  const loadData = async () => {
    if (!userId) return;
    try {
      setLoading(true);
      setError('');
      const [userRes, messagesRes, profilesRes, scalesRes] = await Promise.all([
        adminApi.getUserDetail(userId),
        adminApi.getUserMessages(userId),
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  if (error || !userDetail) {
    return (
      <div className="space-y-6 animate-fade-in">
        <button
          onClick={() => navigate('/admin/users')}
          className="flex items-center gap-2 text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 transition-colors"
        >
          <ArrowLeft size={20} />
          Back to Users
        </button>
        <div className="glass-card p-6 rounded-2xl">
          <p className="text-red-500">Error: {error || 'User not found'}</p>
        </div>
      </div>
    );
  }

  const radarData = [
    { label: 'Cognition', value: userDetail.current_profile.cognition },
    { label: 'Affect', value: userDetail.current_profile.affect },
    { label: 'Behavior', value: userDetail.current_profile.behavior },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Back Button */}
      <button
        onClick={() => navigate('/admin/users')}
        className="flex items-center gap-2 text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 transition-colors"
      >
        <ArrowLeft size={20} />
        Back to Users
      </button>

      {/* User Info Card */}
      <div className="glass-card p-6 rounded-2xl stagger-1">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold mb-2">{userDetail.name}</h1>
            <p className="text-gray-600 dark:text-gray-400">{userDetail.email}</p>
            <div className="flex gap-2 mt-3">
              <span className="px-3 py-1 rounded-lg text-sm font-medium bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300">
                {userDetail.role}
              </span>
              <span className={`px-3 py-1 rounded-lg text-sm font-medium ${
                userDetail.is_active
                  ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
              }`}>
                {userDetail.is_active ? 'Active' : 'Inactive'}
              </span>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-600 dark:text-gray-400">Created</p>
            <p className="font-semibold">{new Date(userDetail.created_at).toLocaleDateString()}</p>
            {userDetail.last_active_at && (
              <>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">Last Active</p>
                <p className="font-semibold">{new Date(userDetail.last_active_at).toLocaleDateString()}</p>
              </>
            )}
          </div>
        </div>

        {/* 3D Profile */}
        <div className="grid grid-cols-3 gap-4 mt-6 pt-6 border-t border-white/10">
          {radarData.map((item, idx) => (
            <div key={item.label} className={`stagger-${idx + 2}`}>
              <div className="text-center">
                <div className="relative w-20 h-20 mx-auto mb-3">
                  <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="45" fill="none" stroke="var(--glass-border)" strokeWidth="2" />
                    <circle
                      cx="50"
                      cy="50"
                      r="45"
                      fill="none"
                      stroke="url(#gradient-active)"
                      strokeWidth="2"
                      strokeDasharray={`${(item.value / 100) * 282.7} 282.7`}
                      style={{ transition: 'stroke-dasharray 0.3s ease' }}
                    />
                    <defs>
                      <linearGradient id="gradient-active" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="rgb(99, 102, 241)" />
                        <stop offset="100%" stopColor="rgb(168, 85, 247)" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-sm font-bold">{item.value}%</span>
                  </div>
                </div>
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">{item.label}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="glass-card rounded-2xl overflow-hidden stagger-2">
        <div className="flex border-b border-white/10">
          {(['messages', 'profiles', 'scales'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 px-6 py-4 font-medium transition-colors ${
                activeTab === tab
                  ? 'border-b-2 border-indigo-500 text-indigo-600 dark:text-indigo-400'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-300'
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                {tab === 'messages' && <MessageSquare size={18} />}
                {tab === 'profiles' && <TrendingUp size={18} />}
                {tab === 'scales' && <FileText size={18} />}
                <span className="capitalize">{tab}</span>
              </div>
            </button>
          ))}
        </div>

        <div className="p-6">
          {/* Messages Tab */}
          {activeTab === 'messages' && (
            <div className="space-y-4">
              {messages.length === 0 ? (
                <p className="text-center text-gray-500 dark:text-gray-400 py-8">No messages found</p>
              ) : (
                <div className="space-y-4 max-h-96 overflow-y-auto">
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`p-4 rounded-lg ${
                        msg.role === 'user'
                          ? 'bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800'
                          : 'bg-gray-50 dark:bg-gray-900/20 border border-gray-200 dark:border-gray-800'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-sm font-semibold ${
                          msg.role === 'user'
                            ? 'text-indigo-600 dark:text-indigo-400'
                            : 'text-gray-600 dark:text-gray-400'
                        }`}>
                          {msg.role === 'user' ? 'User' : 'Assistant'}
                        </span>
                        <span className="text-xs text-gray-500 dark:text-gray-500">
                          {new Date(msg.timestamp).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-sm text-gray-700 dark:text-gray-300">{msg.text}</p>
                      {msg.analysis && (
                        <details className="mt-2 text-xs">
                          <summary className="cursor-pointer text-gray-500 dark:text-gray-500">Analysis</summary>
                          <pre className="mt-1 p-2 bg-gray-100 dark:bg-gray-800 rounded text-xs overflow-auto">
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

          {/* Profiles Tab */}
          {activeTab === 'profiles' && (
            <div className="space-y-4">
              {profiles.length === 0 ? (
                <p className="text-center text-gray-500 dark:text-gray-400 py-8">No profile snapshots found</p>
              ) : (
                <div className="space-y-3">
                  {profiles.map((profile) => (
                    <div
                      key={profile.id}
                      className={`p-4 rounded-lg border ${
                        profile.source === 'system'
                          ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
                          : 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <span className={`inline-block px-2 py-1 text-xs font-semibold rounded ${
                            profile.source === 'system'
                              ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
                              : 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300'
                          }`}>
                            {profile.source === 'system' ? 'System' : 'User'}
                          </span>
                        </div>
                        <span className="text-xs text-gray-500 dark:text-gray-500">
                          {new Date(profile.created_at).toLocaleString()}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <p className="text-xs text-gray-600 dark:text-gray-400">Cognition</p>
                          <p className="text-lg font-bold text-indigo-600 dark:text-indigo-400">{profile.cognition}%</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-600 dark:text-gray-400">Affect</p>
                          <p className="text-lg font-bold text-purple-600 dark:text-purple-400">{profile.affect}%</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-600 dark:text-gray-400">Behavior</p>
                          <p className="text-lg font-bold text-pink-600 dark:text-pink-400">{profile.behavior}%</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Scale Responses Tab */}
          {activeTab === 'scales' && (
            <div className="space-y-4">
              {scaleResponses.length === 0 ? (
                <p className="text-center text-gray-500 dark:text-gray-400 py-8">No scale responses found</p>
              ) : (
                <div className="space-y-4 max-h-96 overflow-y-auto">
                  {scaleResponses.map((response) => (
                    <div
                      key={response.id}
                      className="p-4 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/20"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <p className="font-semibold text-gray-900 dark:text-gray-100">Scale: {response.template_id}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-500">Response ID: {response.id}</p>
                        </div>
                        <span className="text-xs text-gray-500 dark:text-gray-500">
                          {new Date(response.created_at).toLocaleString()}
                        </span>
                      </div>
                      <details className="text-sm">
                        <summary className="cursor-pointer font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300">
                          View Answers & Scores
                        </summary>
                        <div className="mt-3 space-y-2">
                          <div>
                            <p className="text-xs text-gray-600 dark:text-gray-400 font-semibold mb-1">Answers:</p>
                            <pre className="p-2 bg-gray-200 dark:bg-gray-800 rounded text-xs overflow-auto">
                              {JSON.stringify(response.answers_json, null, 2)}
                            </pre>
                          </div>
                          <div>
                            <p className="text-xs text-gray-600 dark:text-gray-400 font-semibold mb-1">Scores:</p>
                            <pre className="p-2 bg-gray-200 dark:bg-gray-800 rounded text-xs overflow-auto">
                              {JSON.stringify(response.scores_json, null, 2)}
                            </pre>
                          </div>
                        </div>
                      </details>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
