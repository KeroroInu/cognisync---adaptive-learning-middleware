import { ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard,
  Users,
  MessageSquare,
  Presentation,
  FileText,
  FlaskConical,
  Download,
  Settings2,
  HeartPulse,
  Sun,
  Moon,
  Menu,
  X,
  LogOut,
} from 'lucide-react';
import { useTheme } from '../lib/useTheme';
import { LanguageSwitcher } from './LanguageSwitcher';
import { useState } from 'react';
import { useAuth } from '../features/auth/hooks';

interface AdminLayoutProps {
  children: ReactNode;
}

export const AdminLayout = ({ children }: AdminLayoutProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { t } = useTranslation();
  const { logout, user } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 860);

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  const navItems = [
    { path: '/', icon: LayoutDashboard, label: t('nav.dashboard') },
    { path: '/users', icon: Users, label: t('nav.users') },
    { path: '/classroom', icon: Presentation, label: '课堂与作业' },
    { path: '/conversations', icon: MessageSquare, label: t('nav.conversations') },
    { path: '/assessments', icon: FileText, label: '问卷与量表' },
    { path: '/exports', icon: Download, label: t('nav.exports') },
  ];
  const extraItems = [
    { path: '/research', icon: FlaskConical, label: '教学任务设置' },
    { path: '/config', icon: Settings2, label: t('nav.modelConfig') },
    { path: '/scales', icon: FileText, label: '旧量表记录' },
    { path: '/emotions', icon: HeartPulse, label: t('nav.emotions') },
  ];

  return (
    <div className={`admin-shell gradient-mesh ${sidebarOpen ? '' : 'is-sidebar-collapsed'}`}>
      <aside className={`admin-sidebar glass-card animate-slide-in-left ${sidebarOpen ? 'is-open' : 'is-collapsed'}`}>
        <div className="admin-brand-block">
          {sidebarOpen && (
            <div className="admin-brand-row">
              <div className="min-w-0">
                <p className="admin-brand-title">CogniSync</p>
                <p className="admin-brand-subtitle">教师工作台</p>
              </div>
            </div>
          )}
          <button 
            onClick={() => setSidebarOpen(!sidebarOpen)} 
            className="admin-icon-button"
            aria-label={sidebarOpen ? '收起导航' : '展开导航'}
            aria-expanded={sidebarOpen}
            aria-controls="admin-navigation"
            title={sidebarOpen ? '收起导航' : '展开导航'}
          >
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        <nav id="admin-navigation" className="admin-nav" aria-label="教师端导航">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.path === '/'
              ? location.pathname === '/'
              : location.pathname.startsWith(item.path);
            
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`admin-nav-item ${isActive ? 'is-active' : ''} ${sidebarOpen ? '' : 'is-collapsed'}`}
                title={sidebarOpen ? undefined : item.label}
                aria-label={item.label}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon size={20} />
                {sidebarOpen && <span className="font-medium">{item.label}</span>}
              </Link>
            );
          })}
          <details open={extraItems.some(item => location.pathname.startsWith(item.path)) || undefined}>
            <summary aria-label="更多设置与历史记录" style={{ padding: '12px', cursor: 'pointer' }}>{sidebarOpen ? '更多设置与历史记录' : '更多'}</summary>
            {extraItems.map(item => <Link key={item.path} to={item.path} className={`admin-nav-item ${location.pathname.startsWith(item.path) ? 'is-active' : ''}`} aria-label={item.label} title={item.label}><item.icon size={20} />{sidebarOpen && item.label}</Link>)}
          </details>
        </nav>

        <div className="admin-sidebar-footer">
          <div className="admin-appearance-tools"><button
            onClick={toggleTheme}
            className={`admin-tool-button ${sidebarOpen ? '' : 'is-collapsed'}`}
            title={theme === 'light' ? t('common.darkMode') : t('common.lightMode')}
            aria-label={theme === 'light' ? t('common.darkMode') : t('common.lightMode')}
          >
            {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
          </button>
          <LanguageSwitcher compact />
          </div>
          <button
            onClick={handleLogout}
            title={sidebarOpen ? undefined : '退出登录'}
            aria-label="退出登录"
            className={`admin-tool-button is-danger ${sidebarOpen ? '' : 'is-collapsed'}`}
          >
            <LogOut size={20} />
            {sidebarOpen && (
              <span className="text-sm">
                退出登录
              </span>
            )}
          </button>
        </div>
      </aside>

      <main className="admin-main glass-card">
        <header className="admin-header">
          <div>
            <h1 className="admin-page-title">
              {[...navItems, ...extraItems].find(item => (
                item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path)
              ))?.label || t('common.adminPanel')}
            </h1>
          </div>
          <div className="admin-status-pill">
            <span className="status-dot" />
            <span>{user?.name || t('common.adminPanel')}</span>
          </div>
        </header>

        <div className="admin-content">
          {children}
        </div>
      </main>
    </div>
  );
};
