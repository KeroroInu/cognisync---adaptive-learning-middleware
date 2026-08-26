import { ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard,
  Users,
  MessageSquare,
  FileText,
  FlaskConical,
  ClipboardCheck,
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
    { path: '/conversations', icon: MessageSquare, label: t('nav.conversations') },
    { path: '/emotions', icon: HeartPulse, label: t('nav.emotions') },
    { path: '/scales', icon: FileText, label: t('nav.scales') },
    { path: '/research', icon: FlaskConical, label: '贪吃蛇项目' },
    { path: '/tests', icon: ClipboardCheck, label: '迁移测试' },
    { path: '/exports', icon: Download, label: t('nav.exports') },
    { path: '/config', icon: Settings2, label: t('nav.modelConfig') },
  ];

  return (
    <div className={`admin-shell gradient-mesh ${sidebarOpen ? '' : 'is-sidebar-collapsed'}`}>
      <aside className={`admin-sidebar glass-card animate-slide-in-left ${sidebarOpen ? 'is-open' : 'is-collapsed'}`}>
        <div className="admin-brand-block">
          {sidebarOpen && (
            <div className="admin-brand-row">
              <div className="admin-brand-mark flow-surface">
                A
              </div>
              <div className="min-w-0">
                <p className="admin-brand-title metallic-text">CogniSync Teacher</p>
                <p className="admin-brand-subtitle">PDT teaching & evidence console</p>
              </div>
            </div>
          )}
          <button 
            onClick={() => setSidebarOpen(!sidebarOpen)} 
            className="admin-icon-button"
            aria-label={sidebarOpen ? '收起导航' : '展开导航'}
            title={sidebarOpen ? '收起导航' : '展开导航'}
          >
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        <nav className="admin-nav">
          {navItems.map((item, index) => {
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
              >
                {sidebarOpen && <span className="admin-nav-index">{String(index + 1).padStart(2, '0')}</span>}
                <Icon size={20} />
                {sidebarOpen && <span className="font-medium">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="admin-sidebar-footer">
          <button
            onClick={toggleTheme}
            className={`admin-tool-button ${sidebarOpen ? '' : 'is-collapsed'}`}
            title={theme === 'light' ? t('common.darkMode') : t('common.lightMode')}
          >
            {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
            {sidebarOpen && <span>{theme === 'light' ? t('common.darkMode') : t('common.lightMode')}</span>}
          </button>
          <LanguageSwitcher compact={!sidebarOpen} />
          <button
            onClick={handleLogout}
            title={sidebarOpen ? undefined : '退出登录'}
            className={`admin-tool-button is-danger ${sidebarOpen ? '' : 'is-collapsed'}`}
          >
            <LogOut size={20} />
            {sidebarOpen && (
              <span className="text-sm">
                {user?.name ? `退出 (${user.name})` : '退出登录'}
              </span>
            )}
          </button>
        </div>
      </aside>

      <main className="admin-main glass-card">
        <header className="admin-header">
          <div>
            <p className="admin-page-kicker">COGNISYNC / PDT 教学控制台</p>
            <h1 className="admin-page-title">
              {navItems.find(item => (
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
