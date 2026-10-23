import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Eye, EyeOff } from 'lucide-react';
import { Input } from '../components/Input';
import { RetroLearningTerminal } from '../components/RetroLearningTerminal';
import { login } from '../services/api';
import { translations } from '../utils/translations';
import type { Language } from '../types';
import { normalizeStudentId } from '../utils/studentRegistration';
import './StudentAccess.css';

export interface LoginProps {
  language: Language;
  onLoginSuccess: (token: string, user: any, profile?: any) => void;
  onNavigateToRegister: () => void;
}

export const Login: React.FC<LoginProps> = ({
  language,
  onLoginSuccess,
  onNavigateToRegister
}) => {
  const t = translations[language];
  const [studentId, setStudentId] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showVisual, setShowVisual] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(min-width: 761px)').matches,
  );
  const visualRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const viewport = window.matchMedia('(min-width: 761px)');
    const update = () => setShowVisual(viewport.matches);
    update();
    viewport.addEventListener('change', update);
    return () => viewport.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const visual = visualRef.current;
    if (!visual || !showVisual) return;
    const fit = () => {
      const sceneHeight = visual.querySelector<HTMLElement>('.retro-terminal-scene')?.offsetHeight || 800;
      visual.style.setProperty('--access-terminal-scale', String(Math.min(
        Math.max(0, visual.clientWidth - 64) / 640,
        Math.max(0, visual.clientHeight - 40) / sceneHeight,
        1,
      )));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(visual);
    return () => observer.disconnect();
  }, [showVisual]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    setError(null);

    if (!studentId || !password) {
      setError(language === 'zh' ? '请填写学号和密码' : 'Please enter your student ID and password');
      return;
    }

    setIsLoading(true);

    try {
      const response = await login({ student_id: normalizeStudentId(studentId), password });

      if (response.success && response.data) {
        onLoginSuccess(
          response.data.token,
          response.data.user,
          response.data.initialProfile
        );
      }
    } catch (err: unknown) {
      const rawMessage = err instanceof Error ? err.message : '';
      const isBrowserRequestError = /string did not match the expected pattern|failed to fetch|networkerror/i.test(rawMessage);

      setError(
        isBrowserRequestError
          ? (language === 'zh' ? '暂时无法连接登录服务，请刷新页面后重试' : 'Unable to reach the login service. Refresh and try again.')
          : (rawMessage || t.loginError),
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="student-access student-access-login">
      <div className="student-access-layout">
        {showVisual && <aside ref={visualRef} className="student-access-visual" aria-hidden="true">
          <RetroLearningTerminal language={language} />
        </aside>}
        <section className="student-access-card" aria-labelledby="login-title">
          <header className="student-access-heading">
            <p className="student-access-brand"><span>SFLS</span> 编程课堂</p>
            <h1 id="login-title">登录课堂</h1>
            <p>查看本课任务，继续你的作品。</p>
          </header>
            <form onSubmit={handleSubmit} aria-busy={isLoading}>
              {error && (
                <p className="student-access-error" role="alert">{error}</p>
              )}

              <Input
                type="text"
                label={t.studentId}
                placeholder="填写完整学号"
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                disabled={isLoading}
                autoComplete="username"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={50}
                required
              />

              <div className="student-access-password"><Input
                type={showPassword ? 'text' : 'password'}
                label={t.password}
                placeholder={t.passwordPlaceholder}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                autoComplete="current-password"
                required
              />
              <button type="button" disabled={isLoading} aria-label={showPassword ? '隐藏密码' : '显示密码'} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={19} /> : <Eye size={19} />}</button></div>
              <button type="submit" disabled={isLoading} className="student-access-primary">{isLoading ? '正在登录…' : '登录'}<ArrowRight size={18} aria-hidden="true" /></button>
              <button type="button" disabled={isLoading} onClick={onNavigateToRegister} className="student-access-link">第一次来？创建账号</button>
              <p className="student-access-hint">忘记密码或资料填错了？请联系老师。</p>
            </form>
        </section>
      </div>
    </main>
  );
};
