import React from 'react';
import { LayoutDashboard, MessageSquareText, Network, Scale, FileText, FlaskConical, Languages, Sun, Moon } from 'lucide-react';
import { translations } from '../utils/translations';
import { Language } from '../types';

type View = 'dashboard' | 'chat' | 'graph' | 'calibration' | 'evidence';
type Theme = 'light' | 'dark';

interface Props {
  currentView: View;
  onViewChange: (view: View) => void;
  isResearchMode: boolean;
  onToggleResearch: () => void;
  language: Language;
  onSetLanguage: (lang: Language) => void;
  theme: Theme;
  onToggleTheme: () => void;
  children: React.ReactNode;
}

export const Layout: React.FC<Props> = ({
  currentView,
  onViewChange,
  children,
  isResearchMode,
  onToggleResearch,
  language,
  onSetLanguage,
  theme,
  onToggleTheme
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
    <div className="flex h-screen font-sans" style={{
      backgroundColor: theme === 'light' ? '#fafafa' : '#0f172a'
    }}>
      {/* 侧边栏 */}
      <aside className="w-64 glass-card rounded-r-3xl border-r-0 flex flex-col shadow-xl m-2 ml-0 animate-slide-in-left">
        <div className="p-6" style={{
          borderBottom: `1px solid ${theme === 'light' ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)'}`
        }}>
          <h1 className="text-2xl font-semibold text-gradient tracking-tight">
            CogniSync
          </h1>
          <p className="text-xs mt-1.5 uppercase tracking-wider font-medium" style={{
            color: theme === 'light' ? '#6b7280' : '#cbd5e1'
          }}>
            Research Prototype
          </p>
        </div>

        <nav className="flex-1 p-4 space-y-1.5">
          {navItems.map((item, idx) => (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id)}
              className={`w-full flex items-center space-x-3 px-4 py-3.5 rounded-xl transition-all duration-300 group stagger-${idx + 1} animate-fade-in ${
                currentView === item.id
                  ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-500/30 scale-[1.02]'
                  : ''
              }`}
              style={currentView !== item.id ? {
                color: theme === 'light' ? '#000000' : '#ffffff',
                backgroundColor: 'transparent'
              } : {}}
            >
              <span className={`transition-transform duration-300 ${currentView === item.id ? '' : 'group-hover:scale-110'}`}>
                {item.icon}
              </span>
              <span className="font-medium text-sm">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="p-4 space-y-3" style={{
          borderTop: `1px solid ${theme === 'light' ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)'}`
        }}>
          {/* 主题切换 */}
          <div className="glass-card p-3.5 rounded-xl border shadow-sm hover:shadow-md transition-all duration-300">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                {theme === 'light' ? <Sun size={16} className="text-amber-500" /> : <Moon size={16} className="text-indigo-400" />}
                <span className="text-xs font-semibold" style={{
                  color: theme === 'light' ? '#000000' : '#ffffff'
                }}>
                  {theme === 'light' ? '浅色模式' : '深色模式'}
                </span>
              </div>
              <button
                onClick={onToggleTheme}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-all duration-300 shadow-inner ${
                  theme === 'dark'
                    ? 'bg-gradient-to-r from-indigo-500 to-purple-500'
                    : 'bg-gradient-to-r from-amber-400 to-orange-400'
                }`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-all duration-300 shadow-md ${theme === 'dark' ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
          </div>

          {/* 语言切换 */}
          <div className="glass-card p-3.5 rounded-xl border shadow-sm hover:shadow-md transition-all duration-300">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Languages size={16} style={{
                  color: theme === 'light' ? '#6b7280' : '#cbd5e1'
                }} />
                <span className="text-xs font-semibold" style={{
                  color: theme === 'light' ? '#000000' : '#ffffff'
                }}>
                  Language
                </span>
              </div>
              <button
                onClick={() => onSetLanguage(language === 'zh' ? 'en' : 'zh')}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-all duration-200 shadow-sm hover:shadow-md"
                style={{
                  backgroundColor: theme === 'light' ? '#ffffff' : '#334155',
                  color: theme === 'light' ? '#000000' : '#ffffff',
                  border: `1px solid ${theme === 'light' ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)'}`
                }}
              >
                {language === 'zh' ? '中文' : 'EN'}
              </button>
            </div>
          </div>

          {/* 研究模式 */}
          <div className="glass-card p-3.5 rounded-xl border shadow-sm hover:shadow-md transition-all duration-300">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <FlaskConical size={16} className={isResearchMode ? "text-green-500" : ""} style={!isResearchMode ? {
                  color: theme === 'light' ? '#9ca3af' : '#94a3b8'
                } : {}} />
                <span className="text-xs font-semibold" style={{
                  color: theme === 'light' ? '#000000' : '#ffffff'
                }}>
                  {t.researchMode}
                </span>
              </div>
              <button
                onClick={onToggleResearch}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-all duration-300 shadow-inner ${
                  isResearchMode ? 'bg-gradient-to-r from-green-400 to-green-500' : theme === 'light' ? 'bg-gray-300' : 'bg-slate-600'
                }`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-all duration-300 shadow-md ${isResearchMode ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* 主内容区 */}
      <main className="flex-1 overflow-hidden relative flex flex-col m-2 ml-0">
        <header className="h-16 flex items-center justify-between px-8 glass-card rounded-t-3xl shadow-sm animate-slide-in-right stagger-1" style={{
          borderBottom: `1px solid ${theme === 'light' ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)'}`
        }}>
          <h2 className="text-xl font-semibold capitalize tracking-tight" style={{
            color: theme === 'light' ? '#000000' : '#ffffff'
          }}>
            {navItems.find(n => n.id === currentView)?.label}
          </h2>
          <div className="flex items-center space-x-3">
            <span className="flex h-2 w-2 rounded-full bg-green-500 shadow-lg shadow-green-500/50 animate-pulse"></span>
            <span className="text-sm font-medium" style={{
              color: theme === 'light' ? '#000000' : '#ffffff'
            }}>
              {t.systemActive}
            </span>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto p-8 relative glass-card rounded-b-3xl border-t-0 shadow-xl animate-fade-in stagger-2">
          {children}
        </div>
      </main>
    </div>
  );
};
