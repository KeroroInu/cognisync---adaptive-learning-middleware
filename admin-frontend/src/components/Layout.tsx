import React, { useState } from 'react';
import { LayoutDashboard, Database, Users, Settings as SettingsIcon } from 'lucide-react';
import { useTheme } from '@shared/hooks/useTheme';
import { Switch } from '@shared/components/Switch';

interface LayoutProps {
  children: React.ReactNode;
}

type View = 'dashboard' | 'explorer' | 'users' | 'settings';

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const { theme, toggleTheme } = useTheme();

  const navItems = [
    { id: 'dashboard' as View, label: 'Dashboard', icon: LayoutDashboard },
    { id: 'explorer' as View, label: 'Data Explorer', icon: Database },
    { id: 'users' as View, label: 'Users', icon: Users },
    { id: 'settings' as View, label: 'Settings', icon: SettingsIcon },
  ];

  return (
    <div className="flex h-screen" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Sidebar */}
      <aside className="w-64 glass-card rounded-r-3xl border-r-0 flex flex-col shadow-xl m-2 ml-0 animate-slide-in-left">
        <div
          className="p-6"
          style={{ borderBottom: `1px solid var(--glass-border)` }}
        >
          <h1 className="text-2xl font-semibold text-gradient">CogniSync Admin</h1>
          <p
            className="text-xs mt-1.5 uppercase tracking-wider font-medium"
            style={{ color: 'var(--text-light)' }}
          >
            后台管理系统
          </p>
        </div>

        <nav className="flex-1 p-4 space-y-1.5">
          {navItems.map((item, idx) => (
            <button
              key={item.id}
              onClick={() => setCurrentView(item.id)}
              className={`w-full flex items-center space-x-3 px-4 py-3.5 rounded-xl transition-all duration-300 group stagger-${
                idx + 1
              } animate-fade-in ${
                currentView === item.id
                  ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-500/30 scale-[1.02]'
                  : ''
              }`}
              style={
                currentView !== item.id ? { color: 'var(--text-primary)' } : {}
              }
            >
              <item.icon size={20} />
              <span className="font-medium text-sm">{item.label}</span>
            </button>
          ))}
        </nav>

        <div
          className="p-4 space-y-3"
          style={{ borderTop: `1px solid var(--glass-border)` }}
        >
          <div className="glass-card p-3.5 rounded-xl border shadow-sm">
            <Switch
              checked={theme === 'dark'}
              onChange={toggleTheme}
              label={theme === 'light' ? '浅色模式' : '深色模式'}
            />
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden relative flex flex-col m-2 ml-0">
        <header
          className="h-16 flex items-center justify-between px-8 glass-card rounded-t-3xl shadow-sm animate-slide-in-right stagger-1"
          style={{ borderBottom: `1px solid var(--glass-border)` }}
        >
          <h2
            className="text-xl font-semibold capitalize"
            style={{ color: 'var(--text-primary)' }}
          >
            {navItems.find((n) => n.id === currentView)?.label}
          </h2>
          <div className="flex items-center space-x-3">
            <span className="flex h-2 w-2 rounded-full bg-green-500 shadow-lg shadow-green-500/50 animate-pulse"></span>
            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              System Active
            </span>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto glass-card rounded-b-3xl border-t-0 shadow-xl animate-fade-in stagger-2">
          {children}
        </div>
      </main>
    </div>
  );
};
