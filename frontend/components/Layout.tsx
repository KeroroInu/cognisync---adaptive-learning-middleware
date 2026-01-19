import React from 'react';
import { LayoutDashboard, MessageSquareText, Network, Scale, FileText, FlaskConical, Languages } from 'lucide-react';
import { translations } from '../utils/translations';
import { Language } from '../types';

type View = 'dashboard' | 'chat' | 'graph' | 'calibration' | 'evidence';

interface Props {
  currentView: View;
  onViewChange: (view: View) => void;
  isResearchMode: boolean;
  onToggleResearch: () => void;
  language: Language;
  onSetLanguage: (lang: Language) => void;
  children: React.ReactNode;
}

export const Layout: React.FC<Props> = ({ 
  currentView, 
  onViewChange, 
  children, 
  isResearchMode, 
  onToggleResearch,
  language,
  onSetLanguage
}) => {
  const t = translations[language];

  const navItems: { id: View; label: string; icon: React.ReactNode }[] = [
    { id: 'dashboard', label: t.dashboard, icon: <LayoutDashboard size={20} /> },
    { id: 'chat', label: t.chat, icon: <MessageSquareText size={20} /> },
    { id: 'graph', label: t.graph, icon: <Network size={20} /> },
    { id: 'calibration', label: t.calibration, icon: <Scale size={20} /> },
    { id: 'evidence', label: t.evidence, icon: <FileText size={20} /> },
  ];

  return (
    <div className="flex h-screen bg-slate-950 text-slate-200 font-sans selection:bg-indigo-500/30">
      {/* Sidebar */}
      <aside className="w-64 border-r border-slate-800 flex flex-col">
        <div className="p-6 border-b border-slate-800">
          <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
            CogniSync
          </h1>
          <p className="text-xs text-slate-500 mt-1 uppercase tracking-wider">Research Prototype</p>
        </div>

        <nav className="flex-1 p-4 space-y-2">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id)}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${
                currentView === item.id
                  ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                  : 'hover:bg-slate-900 text-slate-400 hover:text-slate-200'
              }`}
            >
              {item.icon}
              <span className="font-medium text-sm">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-800 space-y-3">
             <div className="flex items-center justify-between bg-slate-900 p-3 rounded-lg border border-slate-800">
                <div className="flex items-center space-x-2">
                    <Languages size={16} className="text-slate-500" />
                    <span className="text-xs font-semibold text-slate-400">Language</span>
                </div>
                <button 
                    onClick={() => onSetLanguage(language === 'zh' ? 'en' : 'zh')}
                    className="text-xs font-bold bg-slate-800 px-2 py-1 rounded text-slate-300 hover:text-white transition-colors"
                >
                    {language === 'zh' ? '中文' : 'EN'}
                </button>
            </div>

            <div className="flex items-center justify-between bg-slate-900 p-3 rounded-lg border border-slate-800">
                <div className="flex items-center space-x-2">
                    <FlaskConical size={16} className={isResearchMode ? "text-emerald-400" : "text-slate-600"} />
                    <span className="text-xs font-semibold text-slate-400">{t.researchMode}</span>
                </div>
                <button 
                    onClick={onToggleResearch}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${isResearchMode ? 'bg-emerald-600' : 'bg-slate-700'}`}
                >
                    <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition transition-transform ${isResearchMode ? 'translate-x-5' : 'translate-x-1'}`} />
                </button>
            </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden relative flex flex-col">
        <header className="h-16 border-b border-slate-800 flex items-center justify-between px-8 bg-slate-950/50 backdrop-blur-sm z-10">
          <h2 className="text-lg font-medium text-slate-200 capitalize">{navItems.find(n => n.id === currentView)?.label}</h2>
          <div className="flex items-center space-x-4">
            <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-xs text-slate-400">{t.systemActive}</span>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto p-8 relative">
          {children}
        </div>
      </main>
    </div>
  );
};