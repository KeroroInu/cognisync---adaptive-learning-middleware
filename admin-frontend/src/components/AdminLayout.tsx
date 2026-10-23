import { ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { BookOpen, ClipboardList, Users, Download, MessageSquare, Settings2, Moon, Sun, LogOut } from 'lucide-react';
import { useTheme } from '../lib/useTheme';
import { useAuth } from '../features/auth/hooks';
import './AdminWorkspace.css';

const navigation = [
  { path: '/classroom', label: '布置任务', icon: BookOpen },
  { path: '/assessments', label: '测试与量表', icon: ClipboardList },
  { path: '/users', label: '学生', icon: Users },
  { path: '/conversations', label: '对话速览', icon: MessageSquare },
  { path: '/exports', label: '数据导出', icon: Download },
];

export const AdminLayout = ({ children }: { children: ReactNode }) => {
  const location = useLocation(), navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { logout, user } = useAuth();
  return <div className="teacher-workspace">
    <header className="teacher-topbar">
      <Link to="/classroom" className="teacher-brand"><span>S</span><strong>SFLS<small>教师工作台</small></strong></Link>
      <nav aria-label="教师端导航">{navigation.map(item => <Link key={item.path} to={item.path} aria-current={location.pathname.startsWith(item.path) ? 'page' : undefined}><item.icon size={17} />{item.label}</Link>)}</nav>
      <div className="teacher-account">
        <span>{user?.name || '老师'}</span>
        <details className="teacher-settings"><summary aria-label="工作台设置" title="工作台设置"><Settings2 size={18} /></summary><div><Link to="/tools">工具与设置</Link><Link to="/config">高级模型设置</Link></div></details>
        <button onClick={toggleTheme} aria-label={theme === 'light' ? '深色模式' : '浅色模式'} title="切换显示模式">{theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}</button>
        <button aria-label="退出登录" title="退出登录" onClick={() => { logout(); navigate('/login', { replace: true }); }}><LogOut size={17} /></button>
      </div>
    </header>
    <main className="teacher-content">{children}</main>
  </div>;
};
