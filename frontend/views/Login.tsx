import React, { useState } from 'react';
import { LogIn, Hash, Lock, AlertCircle } from 'lucide-react';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
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
    } catch (err: any) {
      setError(err.message || t.loginError);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center gradient-mesh p-4">
      <div className="w-full max-w-md animate-scale-in">
        {/* Logo/Title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white mb-4 shadow-lg">
            <LogIn className="w-8 h-8" />
          </div>
          <h1 className="text-3xl font-bold text-gradient mb-2">
            {t.loginTitle}
          </h1>
          <p style={{ color: 'var(--text-light)' }}>
            {t.loginDesc}
          </p>
        </div>

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="glass-card p-8 space-y-6">
          {error && (
            <div className="border border-red-200 rounded-lg p-4 flex items-start gap-3 animate-fade-in" style={{ backgroundColor: 'rgba(239,68,68,0.08)' }}>
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-500">{error}</p>
            </div>
          )}

          <div>
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
          </div>

          <div>
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
          </div>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            isLoading={isLoading}
            className="w-full"
          >
            <Hash className="w-5 h-5 mr-2" />
            {isLoading ? t.loggingIn : t.loginButton}
          </Button>

          <div className="text-center text-sm" style={{ color: 'var(--text-light)' }}>
            {t.noAccount}{' '}
            <button
              type="button"
              onClick={onNavigateToRegister}
              className="text-blue-500 hover:text-blue-600 font-medium transition-colors"
            >
              {t.signUp}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
