import React, { useEffect, useState } from 'react';
import {
  Activity,
  ClipboardList,
  FileText,
  FlaskConical,
  Grid3X3,
  Home,
  Languages,
  LayoutDashboard,
  LogOut,
  MessageSquareText,
  Moon,
  Network,
  Scale,
  Sun,
  User as UserIcon,
  X,
} from 'lucide-react';
import { translations } from '../utils/translations';
import type { Language, User } from '../types';

type View = 'dashboard' | 'chat' | 'graph' | 'calibration' | 'evidence' | 'research' | 'scales';
type Theme = 'light' | 'dark';

interface Props {
  currentView: View;
  onViewChange: (view: View) => void;
  language: Language;
  onSetLanguage: (lang: Language) => void;
  theme: Theme;
  onToggleTheme: () => void;
  user?: User | null;
  onLogout?: () => void;
  children: React.ReactNode;
}

interface NavigationItem {
  id: View;
  label: string;
  description: string;
  icon: React.ReactNode;
}

export const Layout: React.FC<Props> = ({
  currentView,
  onViewChange,
  children,
  language,
  onSetLanguage,
  theme,
  onToggleTheme,
  user,
  onLogout,
}) => {
  const t = translations[language];
  const [menuOpen, setMenuOpen] = useState(false);

  const allNavItems: NavigationItem[] = [
    {
      id: 'dashboard',
      label: t.dashboard,
      description: language === 'zh' ? '查看今天的学习入口' : 'Your learning starting point',
      icon: <LayoutDashboard size={18} />,
    },
    {
      id: 'chat',
      label: t.chat,
      description: language === 'zh' ? '与 AI 一起分析和推进任务' : 'Work through tasks with AI',
      icon: <MessageSquareText size={18} />,
    },
    {
      id: 'graph',
      label: t.graph,
      description: language === 'zh' ? '整理概念及其连接' : 'Organize concepts and links',
      icon: <Network size={18} />,
    },
    {
      id: 'research',
      label: language === 'zh' ? '项目工坊' : 'Project studio',
      description: language === 'zh' ? '从项目解构走向重新建构' : 'Move from deconstruction to reconstruction',
      icon: <FlaskConical size={18} />,
    },
    {
      id: 'calibration',
      label: t.calibration,
      description: language === 'zh' ? '检查并修正学习判断' : 'Review and revise the learner model',
      icon: <Scale size={18} />,
    },
    {
      id: 'evidence',
      label: t.evidence,
      description: language === 'zh' ? '回看调试、提问和反思记录' : 'Review debugging and reflection evidence',
      icon: <FileText size={18} />,
    },
    {
      id: 'scales',
      label: t.scales,
      description: language === 'zh' ? '完成教师发布的测量任务' : 'Complete assigned measurement tasks',
      icon: <ClipboardList size={18} />,
    },
  ];

  const group = user?.experimentGroup ?? 'unassigned';
  // 2026-08-24 裁定：知识图谱与自我校准不再作为学生端入口，相关数据迁入教师端单生详情。
  // 视图代码与后端接口保留，便于教师端承接后再决定是否清理。
  const allowedViews: Record<User['experimentGroup'], View[]> = {
    pdt: ['research', 'evidence', 'scales'],
    ai_pbl: ['research', 'evidence', 'scales'],
    lecture: ['research', 'evidence', 'scales'],
    unassigned: ['dashboard', 'scales'],
  };
  const navItems = allNavItems.filter(item => allowedViews[group].includes(item.id));

  const primaryViews: View[] = ['dashboard', 'chat', 'research'];
  const primaryItems = navItems.filter(item => primaryViews.includes(item.id));
  const currentItem = navItems.find(item => item.id === currentView) ?? navItems[0];
  const userMeta = user?.email || user?.student_id || user?.id;
  const isProjectMode = currentView === 'research';

  useEffect(() => {
    setMenuOpen(false);
  }, [currentView]);

  useEffect(() => {
    if (!menuOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [menuOpen]);

  const navigate = (view: View) => {
    onViewChange(view);
    setMenuOpen(false);
  };

  return (
    <div className={`app-shell app-shell-fullscreen ${isProjectMode ? 'is-project-mode' : ''}`}>
      <main className="app-main app-main-fullscreen animate-fade-in">
        {!isProjectMode && <header className="app-header workspace-header">
          <div className="workspace-identity">
            <button
              type="button"
              className="workspace-brand"
              onClick={() => navigate(group === 'unassigned' ? 'dashboard' : 'research')}
              aria-label={language === 'zh' ? '返回当前学习任务' : 'Return to current learning task'}
            >
              <span className="brand-mark">C</span>
              <span className="workspace-brand-copy">
                <span className="brand-title">CogniSync</span>
                <span className="brand-subtitle">
                  {language === 'zh' ? 'AI 时代编程学习平台' : 'AI-era programming platform'}
                </span>
              </span>
            </button>

            <span className="workspace-title-divider" aria-hidden="true" />

            <div className="workspace-current min-w-0">
              <p className="page-kicker">
                {language === 'zh' ? '当前视图' : 'Current view'}
              </p>
              <h2 className="page-title truncate-text">{currentItem.label}</h2>
            </div>
          </div>

          <nav className="workspace-primary-nav" aria-label={language === 'zh' ? '解构学习路径' : 'Deconstruction learning path'}>
            {primaryItems.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => navigate(item.id)}
                className={`workspace-nav-button ${currentView === item.id ? 'is-active' : ''}`}
                aria-current={currentView === item.id ? 'page' : undefined}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </nav>

          <div className="workspace-actions">
            <div className="workspace-online" title={t.systemActive}>
              <span className="status-dot" />
              <Activity size={14} />
              <span>{language === 'zh' ? '在线' : 'Live'}</span>
            </div>
            <button
              type="button"
              className={`workspace-menu-button ${menuOpen ? 'is-open' : ''}`}
              onClick={() => setMenuOpen(open => !open)}
              aria-expanded={menuOpen}
              aria-controls="workspace-navigation-panel"
            >
              {menuOpen ? <X size={18} /> : <Grid3X3 size={18} />}
              <span>{language === 'zh' ? '更多' : 'More'}</span>
            </button>
          </div>
        </header>}

        {!isProjectMode && menuOpen && (
          <>
            <button
              type="button"
              className="workspace-menu-scrim"
              onClick={() => setMenuOpen(false)}
              aria-label={language === 'zh' ? '关闭功能面板' : 'Close navigation panel'}
            />
            <section
              id="workspace-navigation-panel"
              className={`workspace-menu-panel ${navItems.length <= 2 ? 'is-compact' : ''}`}
              aria-label={language === 'zh' ? '全部学习功能' : 'All learning tools'}
            >
              <div className="workspace-menu-user">
                <div className="user-avatar">
                  <UserIcon size={18} />
                </div>
                <div className="min-w-0">
                  <p>{user?.name || (language === 'zh' ? '学习者' : 'Learner')}</p>
                  <span>{userMeta}</span>
                </div>
                <span className="workspace-menu-state">
                  <span className="status-dot" />
                  {language === 'zh' ? '学习中' : 'Learning'}
                </span>
              </div>

              <div className="workspace-menu-heading">
                <div>
                  <p>{language === 'zh' ? '从解构到建构' : 'From deconstruction to reconstruction'}</p>
                  <span>{language === 'zh' ? '选择你接下来要推进的学习阶段' : 'Choose the learning stage to move forward'}</span>
                </div>
                <Home size={18} />
              </div>

              <nav className="workspace-menu-grid">
                {navItems.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => navigate(item.id)}
                    className={`workspace-menu-item ${currentView === item.id ? 'is-active' : ''}`}
                  >
                    <span className="workspace-menu-index">{String(index + 1).padStart(2, '0')}</span>
                    <span className="workspace-menu-icon">{item.icon}</span>
                    <span className="workspace-menu-copy">
                      <strong>{item.label}</strong>
                      <small>{item.description}</small>
                    </span>
                  </button>
                ))}
              </nav>

              <div className="workspace-menu-tools">
                <button type="button" onClick={onToggleTheme} className="workspace-tool-button">
                  {theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
                  <span>{theme === 'light' ? (language === 'zh' ? '深色模式' : 'Dark mode') : (language === 'zh' ? '浅色模式' : 'Light mode')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onSetLanguage(language === 'zh' ? 'en' : 'zh')}
                  className="workspace-tool-button"
                >
                  <Languages size={17} />
                  <span>{language === 'zh' ? 'English' : '中文'}</span>
                </button>
                {onLogout && (
                  <button type="button" onClick={onLogout} className="workspace-tool-button is-danger">
                    <LogOut size={17} />
                    <span>{t.logout}</span>
                  </button>
                )}
              </div>
            </section>
          </>
        )}

        <section className={`app-content app-content-fullscreen ${isProjectMode ? 'is-project-content' : ''}`}>{children}</section>
      </main>
    </div>
  );
};
