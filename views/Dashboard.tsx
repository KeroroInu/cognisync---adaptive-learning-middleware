import React from 'react';
import { RadarDisplay } from '../components/RadarDisplay';
import { UserProfile, Language } from '../types';
import { ArrowRight, Activity, Brain, Target } from 'lucide-react';
import { translations } from '../utils/translations';

interface Props {
  profile: UserProfile;
  onNavigate: (view: any) => void;
  language: Language;
}

export const Dashboard: React.FC<Props> = ({ profile, onNavigate, language }) => {
  const t = translations[language];

  return (
    <div className="grid grid-cols-12 gap-6 h-full">
      {/* Top Row: Metrics */}
      <div className="col-span-12 grid grid-cols-3 gap-6">
        {[
          { label: t.cognition, value: profile.cognition, icon: <Brain className="text-blue-400" />, desc: "Knowledge retention & reasoning" },
          { label: t.affect, value: profile.affect, icon: <Activity className="text-rose-400" />, desc: "Engagement & frustration levels" },
          { label: t.behavior, value: profile.behavior, icon: <Target className="text-emerald-400" />, desc: "Interaction patterns & consistency" },
        ].map((metric) => (
          <div key={metric.label} className="bg-slate-900 border border-slate-800 p-6 rounded-xl flex flex-col justify-between">
            <div className="flex justify-between items-start mb-4">
              <div className="p-2 bg-slate-800 rounded-lg">{metric.icon}</div>
              <span className={`text-2xl font-bold ${metric.value < 50 ? 'text-amber-500' : 'text-slate-200'}`}>
                {metric.value}/100
              </span>
            </div>
            <div>
                <h3 className="text-lg font-medium text-slate-200">{metric.label}</h3>
                <p className="text-xs text-slate-500 mt-1">{metric.desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Main Vis: Radar */}
      <div className="col-span-8 bg-slate-900 border border-slate-800 rounded-xl p-6 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-500 opacity-50" />
        <h3 className="text-lg font-medium text-slate-200 mb-2">Real-time Learner Model</h3>
        <p className="text-sm text-slate-500 mb-6">Triangulated analysis based on last 5 interactions.</p>
        <div className="h-[300px] w-full">
            <RadarDisplay data={profile} language={language} />
        </div>
      </div>

      {/* Side Actions & Trends */}
      <div className="col-span-4 flex flex-col space-y-6">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex-1">
            <h3 className="text-lg font-medium text-slate-200 mb-4">{t.recentShifts}</h3>
            <ul className="space-y-4">
                <li className="flex items-center justify-between text-sm">
                    <span className="text-slate-400">Cognitive Load</span>
                    <span className="text-emerald-400 flex items-center">+5 <Activity size={12} className="ml-1"/></span>
                </li>
                <li className="flex items-center justify-between text-sm">
                    <span className="text-slate-400">Frustration</span>
                    <span className="text-rose-400 flex items-center">+12 <Activity size={12} className="ml-1"/></span>
                </li>
            </ul>
        </div>
        
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <h3 className="text-lg font-medium text-slate-200 mb-4">{t.quickActions}</h3>
            <div className="space-y-2">
                <button onClick={() => onNavigate('calibration')} className="w-full flex items-center justify-between p-3 rounded-lg bg-indigo-600/10 text-indigo-400 border border-indigo-500/20 hover:bg-indigo-600/20 transition-all group">
                    <span>{t.calibrateModel}</span>
                    <ArrowRight size={16} className="transform group-hover:translate-x-1 transition-transform" />
                </button>
                <button onClick={() => onNavigate('graph')} className="w-full flex items-center justify-between p-3 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition-all">
                    <span>{t.exploreGraph}</span>
                    <ArrowRight size={16} />
                </button>
                <button onClick={() => onNavigate('chat')} className="w-full flex items-center justify-between p-3 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition-all">
                    <span>{t.startDialogue}</span>
                    <ArrowRight size={16} />
                </button>
            </div>
        </div>
      </div>
    </div>
  );
};