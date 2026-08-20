import React, { useState } from 'react';
import { Hash, AlertCircle } from 'lucide-react';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { SpotlightCard } from '../components/SpotlightCard';
import { RetroLearningTerminal } from '../components/RetroLearningTerminal';
import { login } from '../services/api';
import { translations } from '../utils/translations';
import type { Language } from '../types';

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!studentId || !password) {
      setError(language === 'zh' ? '请填写学号和密码' : 'Please enter your student ID and password');
      return;
    }

    setIsLoading(true);

    try {
      const response = await login({ student_id: studentId, password });

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
    <div className="auth-shell auth-shell-login">
      <div className="login-stage">
        <section className="auth-wrap login-panel animate-scale-in">
          <div className="login-brandline">
            <span className="login-brandmark">C</span>
            <span>COGNISYNC / PROJECT DECONSTRUCTION</span>
          </div>
          <div className="auth-header login-header">
            <p className="login-kicker">WELCOME BACK / 2026</p>
            <h1 className="auth-title">{t.loginTitle}</h1>
            <p className="auth-copy">{t.loginDesc}</p>
          </div>

          <SpotlightCard className="auth-card login-card" spotlightColor="rgba(142, 169, 68, 0.13)">
            <form onSubmit={handleSubmit} className="space-y-6">
              {error && (
                <div className="auth-error animate-fade-in">
                  <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" />
                  <p className="m-0 text-sm">{error}</p>
                </div>
              )}

              <Input
                type="text"
                label={t.studentId}
                placeholder={t.studentIdPlaceholder}
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                disabled={isLoading}
                autoComplete="username"
                required
              />

              <Input
                type="password"
                label={t.password}
                placeholder={t.passwordPlaceholder}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                autoComplete="current-password"
                required
              />

              <Button type="submit" variant="primary" size="lg" isLoading={isLoading} className="w-full login-submit">
                <Hash className="w-5 h-5 mr-2" />
                {isLoading ? t.loggingIn : t.loginButton}
              </Button>

              <div className="auth-footer">
                {t.noAccount}{' '}
                <button type="button" onClick={onNavigateToRegister} className="auth-link">
                  {t.signUp}
                </button>
              </div>

              {/*
                忘记密码的出路。

                系统没有自助找回（学生多数没填邮箱，也不宜为测试期引入新的认证面），
                管理端本来就有重置密码功能，缺的只是让学生知道该找谁。
                另外注册中断的账号只能用原密码登录续做，忘了密码就彻底卡死，
                这里必须给一句明确指引，否则学生只会反复重填学号。
              */}
              <p className="auth-footer" style={{ marginTop: '0.5rem', opacity: 0.75 }}>
                {language === 'zh'
                  ? '忘记密码，或注册中断后登不进来？请联系老师重置密码。'
                  : 'Forgot your password, or stuck after an interrupted sign-up? Ask your teacher to reset it.'}
              </p>
            </form>
          </SpotlightCard>
          <p className="login-footnote">OBSERVE · DECONSTRUCT · REBUILD · VERIFY</p>
        </section>

        <section className="login-visual animate-fade-in stagger-2">
          <RetroLearningTerminal language={language} />
        </section>
      </div>
    </div>
  );
};
