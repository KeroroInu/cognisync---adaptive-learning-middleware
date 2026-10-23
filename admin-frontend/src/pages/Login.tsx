import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../features/auth/hooks';
import { useTheme } from '../lib/useTheme';
import { Sun, Moon, Shield } from 'lucide-react';

export const Login = () => {
  const { login, isAuthed, isLoading, bootstrap } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();

  const [studentId, setStudentId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // 已登录则直接跳转
  useEffect(() => {
    if (isAuthed) {
      const params = new URLSearchParams(location.search);
      const redirect = params.get('redirect') || '/';
      navigate(redirect, { replace: true });
    }
  }, [isAuthed, navigate, location.search]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentId.trim() || !password.trim()) {
      setError('请输入账号和密码');
      return;
    }

    setError('');
    setSubmitting(true);
    try {
      await login({ student_id: studentId.trim(), password });
      const params = new URLSearchParams(location.search);
      const redirect = params.get('redirect') || '/';
      navigate(redirect, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败，请检查账号和密码');
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen gradient-mesh">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[color:var(--brand-purple)]" />
      </div>
    );
  }

  return (
    <div className="admin-login-shell gradient-mesh">
      <button
        onClick={toggleTheme}
        className="admin-icon-button admin-theme-toggle glass-card"
        aria-label={theme === 'dark' ? '切换浅色模式' : '切换深色模式'}
        title={theme === 'dark' ? '切换浅色模式' : '切换深色模式'}
      >
        {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
      </button>

      <div className="admin-login-wrap">
        <div className="admin-login-card glass-card animate-slide-in-left">
          <div className="mb-8 flex flex-col items-center text-center">
            <div className="admin-login-mark flow-surface">
              <Shield size={28} />
            </div>
            <h1 className="metallic-text text-3xl font-bold leading-tight">
              SFLS 教师端
            </h1>
            <p className="mt-2 text-sm" style={{ color: 'var(--text-tertiary)' }}>
              布置任务、查看学生与导出数据
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="mb-1.5 block text-sm font-bold" style={{ color: 'var(--text-secondary)' }}>
                账号
              </label>
              <input
                type="text"
                value={studentId}
                onChange={e => setStudentId(e.target.value)}
                placeholder="请输入管理员账号"
                autoComplete="username"
                className="admin-input"
                disabled={submitting}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-bold" style={{ color: 'var(--text-secondary)' }}>
                密码
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="请输入密码"
                autoComplete="current-password"
                className="admin-input"
                disabled={submitting}
              />
            </div>

            {error && (
              <div className="rounded-lg border px-4 py-3" style={{ borderColor: 'rgba(240,30,156,0.38)', background: 'rgba(240,30,156,0.1)' }}>
                <p className="text-sm" style={{ color: 'var(--brand-rose)' }}>{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="admin-flow-button"
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  登录中...
                </span>
              ) : (
                '登录'
              )}
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>
          仅限授权管理员访问
        </p>
      </div>
    </div>
  );
};
