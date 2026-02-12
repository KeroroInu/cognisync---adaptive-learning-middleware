import React, { useState } from 'react';
import { LogIn, Mail, Lock, AlertCircle } from 'lucide-react';
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
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email || !password) {
      setError(language === 'zh' ? '请填写所有字段' : 'Please fill in all fields');
      return;
    }

    setIsLoading(true);

    try {
      const response = await login({ email, password });

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
          <p className="text-gray-600 dark:text-gray-400">
            {t.loginDesc}
          </p>
        </div>

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="glass-card p-8 space-y-6">
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-start gap-3 animate-fade-in">
              <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          <div>
            <Input
              type="email"
              label={t.email}
              placeholder={t.emailPlaceholder}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isLoading}
              autoComplete="email"
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
            <Mail className="w-5 h-5 mr-2" />
            {isLoading ? t.loggingIn : t.loginButton}
          </Button>

          <div className="text-center text-sm text-gray-600 dark:text-gray-400">
            {t.noAccount}{' '}
            <button
              type="button"
              onClick={onNavigateToRegister}
              className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 font-medium transition-colors"
            >
              {t.signUp}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
