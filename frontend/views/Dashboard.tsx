import React from 'react';
import { RadarDisplay } from '../components/RadarDisplay';
import { UserProfile, Language } from '../types';
import { ArrowRight, Activity, Brain, Target, TrendingUp } from 'lucide-react';
import { translations } from '../utils/translations';

interface Props {
  profile: UserProfile;
  onNavigate: (view: any) => void;
  language: Language;
  theme: 'light' | 'dark';
}

export const Dashboard: React.FC<Props> = ({ profile, onNavigate, language, theme }) => {
  const t = translations[language];

  return (
    <div className="grid grid-cols-12 gap-6 h-full">
      {/* Top Row: Metrics Cards */}
      <div className="col-span-12 grid grid-cols-3 gap-6">
        {[
          {
            label: t.cognition,
            value: profile.cognition,
            icon: <Brain size={28} strokeWidth={2} />,
            desc: "Knowledge retention & reasoning",
            gradient: "from-blue-500 to-cyan-500",
            iconColor: "text-white",
            bgColor: "bg-gradient-to-br from-blue-500 to-cyan-500"
          },
          {
            label: t.affect,
            value: profile.affect,
            icon: <Activity size={28} strokeWidth={2} />,
            desc: "Engagement & frustration levels",
            gradient: "from-rose-500 to-pink-500",
            iconColor: "text-white",
            bgColor: "bg-gradient-to-br from-rose-500 to-pink-500"
          },
          {
            label: t.behavior,
            value: profile.behavior,
            icon: <Target size={28} strokeWidth={2} />,
            desc: "Interaction patterns & consistency",
            gradient: "from-green-500 to-emerald-500",
            iconColor: "text-white",
            bgColor: "bg-gradient-to-br from-green-500 to-emerald-500"
          },
        ].map((metric, idx) => (
          <div
            key={metric.label}
            className={`glass-card p-6 rounded-2xl flex flex-col justify-between hover:shadow-xl transition-all duration-300 animate-scale-in group stagger-${idx + 1}`}
          >
            <div className="flex justify-between items-start mb-6">
              <div className={`p-3.5 rounded-xl ${metric.bgColor} shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                <span className={metric.iconColor}>
                  {metric.icon}
                </span>
              </div>
              <div className="text-right">
                <span className="text-3xl font-semibold" style={{
                  color: theme === 'light' ? '#000000' : '#f8fafc'
                }}>
                  {metric.value}
                </span>
                <span className="text-lg" style={{
                  color: theme === 'light' ? '#000000' : '#cbd5e1'
                }}>/100</span>
              </div>
            </div>
            <div>
              <h3 className="text-lg font-semibold mb-1" style={{
                color: theme === 'light' ? '#000000' : '#ffffff'
              }}>{metric.label}</h3>
              <p className="text-xs leading-relaxed" style={{
                color: theme === 'light' ? '#404040' : '#e2e8f0'
              }}>{metric.desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Main Visualization: Radar Chart */}
      <div className="col-span-8 glass-card rounded-2xl p-8 relative overflow-hidden group hover:shadow-xl transition-all duration-300 animate-fade-in stagger-4">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-green-500 opacity-60" />
        <h3 className="text-2xl font-semibold mb-2" style={{
          color: theme === 'light' ? '#000000' : '#ffffff'
        }}>Real-time Learner Model</h3>
        <p className="text-sm mb-8" style={{
          color: theme === 'light' ? '#404040' : '#e2e8f0'
        }}>Triangulated analysis based on last 5 interactions.</p>
        <div className="h-[320px] w-full flex items-center justify-center">
          <RadarDisplay data={profile} language={language} />
        </div>
      </div>

      {/* Side Column: Actions & Trends */}
      <div className="col-span-4 flex flex-col space-y-6">
        {/* Recent Shifts Card */}
        <div className="glass-card rounded-2xl p-6 flex-1 hover:shadow-xl transition-all duration-300 animate-slide-in-right stagger-5">
          <div className="flex items-center space-x-2 mb-5">
            <TrendingUp size={20} className="text-indigo-500" />
            <h3 className="text-lg font-semibold" style={{
              color: theme === 'light' ? '#000000' : '#ffffff'
            }}>{t.recentShifts}</h3>
          </div>
          <ul className="space-y-4">
            <li className="flex items-center justify-between p-3 rounded-xl transition-colors duration-200" style={{
              backgroundColor: theme === 'light' ? '#f0fdf4' : '#14532d',
              border: `1px solid ${theme === 'light' ? '#bbf7d0' : '#166534'}`
            }}>
              <span className="text-sm font-medium" style={{
                color: theme === 'light' ? '#000000' : '#ffffff'
              }}>Cognitive Load</span>
              <span className="text-green-600 dark:text-green-300 flex items-center font-semibold text-sm">
                +5 <Activity size={14} className="ml-1" />
              </span>
            </li>
            <li className="flex items-center justify-between p-3 rounded-xl transition-colors duration-200" style={{
              backgroundColor: theme === 'light' ? '#fff1f2' : '#881337',
              border: `1px solid ${theme === 'light' ? '#fecdd3' : '#9f1239'}`
            }}>
              <span className="text-sm font-medium" style={{
                color: theme === 'light' ? '#000000' : '#ffffff'
              }}>Frustration</span>
              <span className="text-rose-600 dark:text-rose-300 flex items-center font-semibold text-sm">
                +12 <Activity size={14} className="ml-1" />
              </span>
            </li>
          </ul>
        </div>

        {/* Quick Actions Card */}
        <div className="glass-card rounded-2xl p-6 hover:shadow-xl transition-all duration-300 animate-slide-in-right stagger-6">
          <h3 className="text-lg font-semibold mb-5" style={{
            color: theme === 'light' ? '#000000' : '#ffffff'
          }}>{t.quickActions}</h3>
          <div className="space-y-3">
            <button
              onClick={() => onNavigate('calibration')}
              className="w-full flex items-center justify-between p-4 rounded-xl bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-500/30 hover:shadow-xl hover:shadow-blue-500/40 transition-all duration-300 group"
            >
              <span className="font-medium">{t.calibrateModel}</span>
              <ArrowRight size={18} className="transform group-hover:translate-x-2 transition-transform duration-300" />
            </button>
            <button
              onClick={() => onNavigate('graph')}
              className="w-full flex items-center justify-between p-4 rounded-xl glass-card hover:shadow-md transition-all duration-300 group"
              style={{
                color: theme === 'light' ? '#000000' : '#ffffff',
                border: `1px solid ${theme === 'light' ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)'}`
              }}
            >
              <span className="font-medium">{t.exploreGraph}</span>
              <ArrowRight size={18} className="transform group-hover:translate-x-2 transition-transform duration-300" />
            </button>
            <button
              onClick={() => onNavigate('chat')}
              className="w-full flex items-center justify-between p-4 rounded-xl glass-card hover:shadow-md transition-all duration-300 group"
              style={{
                color: theme === 'light' ? '#000000' : '#ffffff',
                border: `1px solid ${theme === 'light' ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)'}`
              }}
            >
              <span className="font-medium">{t.startDialogue}</span>
              <ArrowRight size={18} className="transform group-hover:translate-x-2 transition-transform duration-300" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
