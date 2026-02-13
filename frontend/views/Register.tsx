import React, { useState } from 'react';
import { ClipboardList, MessageSquare, Check, ArrowLeft, Mail, Lock, User, Loader } from 'lucide-react';
import { Input } from '../components/Input';
import { register as registerAPI } from '../services/api';
import { translations } from '../utils/translations';
import type { Language } from '../types';

export interface RegisterProps {
  language: Language;
  onRegisterSuccess: (token: string, user: any, mode: 'scale' | 'ai') => void;
  onNavigateToLogin: () => void;
}

export const Register: React.FC<RegisterProps> = ({
  language,
  onRegisterSuccess,
  onNavigateToLogin
}) => {
  const t = translations[language];

  // Form state
  const [step, setStep] = useState<'info' | 'mode'>('info');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Validate and proceed to mode selection
  const handleNext = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validation
    if (!email || !password) {
      setError(language === 'zh' ? '请填写邮箱和密码' : 'Please fill in email and password');
      return;
    }

    if (password.length < 6) {
      setError(language === 'zh' ? '密码至少需要6个字符' : 'Password must be at least 6 characters');
      return;
    }

    if (password !== confirmPassword) {
      setError(language === 'zh' ? '两次密码不一致' : 'Passwords do not match');
      return;
    }

    // Proceed to mode selection
    setStep('mode');
  };

  // Handle mode selection and registration
  const handleModeSelect = async (mode: 'scale' | 'ai') => {
    setIsLoading(true);
    setError(null);

    try {
      // Call registration API
      const response = await registerAPI({
        name: name.trim() || undefined,
        email: email.trim(),
        password,
        mode
      });

      // Registration successful, token is saved automatically in registerAPI()
      // Extract token and user from response
      const token = response.success && response.data ? response.data.token : '';
      const user = response.success && response.data ? response.data.user : null;

      if (token && user) {
        onRegisterSuccess(token, user, mode);
      } else {
        throw new Error('Invalid registration response');
      }
    } catch (err: any) {
      setError(err.message || (language === 'zh' ? '注册失败，请重试' : 'Registration failed, please try again'));
      setIsLoading(false);
    }
  };

  // Render basic info form
  if (step === 'info') {
    return (
      <div className="min-h-screen flex items-center justify-center gradient-mesh p-4">
        <div className="w-full max-w-md animate-scale-in">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white mb-4 shadow-lg animate-float">
              <User className="w-8 h-8" />
            </div>
            <h1 className="text-3xl font-bold text-gradient mb-2">
              {t.signUp}
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              {language === 'zh' ? '创建您的账号以开始使用' : 'Create your account to get started'}
            </p>
          </div>

          {/* Registration Form */}
          <form onSubmit={handleNext} className="glass-card p-8 space-y-6">
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            <div>
              <Input
                type="text"
                label={language === 'zh' ? '姓名（可选）' : 'Name (Optional)'}
                placeholder={language === 'zh' ? '请输入您的姓名' : 'Enter your name'}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isLoading}
                autoComplete="name"
              />
            </div>

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
                placeholder={language === 'zh' ? '至少6个字符' : 'At least 6 characters'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                autoComplete="new-password"
                required
              />
            </div>

            <div>
              <Input
                type="password"
                label={language === 'zh' ? '确认密码' : 'Confirm Password'}
                placeholder={language === 'zh' ? '再次输入密码' : 'Enter password again'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={isLoading}
                autoComplete="new-password"
                required
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full px-6 py-3 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white font-medium rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {language === 'zh' ? '下一步' : 'Next'}
            </button>

            <div className="text-center text-sm text-gray-600 dark:text-gray-400">
              {t.hasAccount}{' '}
              <button
                type="button"
                onClick={onNavigateToLogin}
                className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 font-medium transition-colors"
              >
                {t.login}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // Render mode selection (Step 2)
  return (
    <div className="min-h-screen flex items-center justify-center gradient-mesh p-4">
      <div className="w-full max-w-6xl animate-scale-in">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white mb-6 shadow-xl animate-float">
            <svg
              className="w-10 h-10"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
              />
            </svg>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gradient mb-4">
            {t.chooseOnboardingMode}
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
            {t.chooseOnboardingDesc}
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="max-w-2xl mx-auto mb-8 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <p className="text-sm text-red-600 dark:text-red-400 text-center">{error}</p>
          </div>
        )}

        {/* Mode Selection Cards */}
        <div className="grid md:grid-cols-2 gap-8 mb-8">
          {/* Scale Mode Card */}
          <div className="glass-card p-8 group hover:shadow-2xl transition-all duration-300 hover:scale-[1.02] relative overflow-hidden">
            {/* Background Gradient Effect */}
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-cyan-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>

            <div className="relative z-10">
              {/* Icon */}
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-600 text-white mb-6 shadow-lg group-hover:scale-110 transition-transform duration-300">
                <ClipboardList className="w-8 h-8" />
              </div>

              {/* Title & Description */}
              <h2 className="text-2xl font-bold mb-3 bg-gradient-to-r from-blue-600 to-cyan-600 dark:from-blue-400 dark:to-cyan-400 bg-clip-text text-transparent">
                {t.scaleMode}
              </h2>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                {t.scaleModeDesc}
              </p>

              {/* Features List */}
              <ul className="space-y-3 mb-8">
                {t.scaleModeFeatures.map((feature: string, index: number) => (
                  <li
                    key={index}
                    className="flex items-start gap-3 text-gray-700 dark:text-gray-300 animate-fade-in"
                    style={{ animationDelay: `${index * 100}ms` }}
                  >
                    <div className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mt-0.5">
                      <Check className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                    </div>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              {/* Select Button */}
              <button
                onClick={() => handleModeSelect('scale')}
                disabled={isLoading}
                className="w-full px-6 py-4 bg-gradient-to-r from-blue-500 to-cyan-600 hover:from-blue-600 hover:to-cyan-700 text-white font-medium rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 flex items-center justify-center gap-2 group-hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <>
                    <Loader className="w-5 h-5 animate-spin" />
                    {language === 'zh' ? '注册中...' : 'Registering...'}
                  </>
                ) : (
                  <>
                    <ClipboardList className="w-5 h-5" />
                    {t.selectMode}
                  </>
                )}
              </button>
            </div>
          </div>

          {/* AI Mode Card */}
          <div className="glass-card p-8 group hover:shadow-2xl transition-all duration-300 hover:scale-[1.02] relative overflow-hidden">
            {/* Background Gradient Effect */}
            <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-pink-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>

            <div className="relative z-10">
              {/* Icon */}
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-600 text-white mb-6 shadow-lg group-hover:scale-110 transition-transform duration-300">
                <MessageSquare className="w-8 h-8" />
              </div>

              {/* Title & Description */}
              <h2 className="text-2xl font-bold mb-3 bg-gradient-to-r from-purple-600 to-pink-600 dark:from-purple-400 dark:to-pink-400 bg-clip-text text-transparent">
                {t.aiMode}
              </h2>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                {t.aiModeDesc}
              </p>

              {/* Features List */}
              <ul className="space-y-3 mb-8">
                {t.aiModeFeatures.map((feature: string, index: number) => (
                  <li
                    key={index}
                    className="flex items-start gap-3 text-gray-700 dark:text-gray-300 animate-fade-in"
                    style={{ animationDelay: `${index * 100}ms` }}
                  >
                    <div className="flex-shrink-0 w-5 h-5 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center mt-0.5">
                      <Check className="w-3 h-3 text-purple-600 dark:text-purple-400" />
                    </div>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              {/* Select Button */}
              <button
                onClick={() => handleModeSelect('ai')}
                disabled={isLoading}
                className="w-full px-6 py-4 bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 text-white font-medium rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 flex items-center justify-center gap-2 group-hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <>
                    <Loader className="w-5 h-5 animate-spin" />
                    {language === 'zh' ? '注册中...' : 'Registering...'}
                  </>
                ) : (
                  <>
                    <MessageSquare className="w-5 h-5" />
                    {t.selectMode}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Back Button */}
        <div className="text-center">
          <button
            onClick={() => setStep('info')}
            disabled={isLoading}
            className="inline-flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 font-medium transition-colors group disabled:opacity-50"
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform duration-300" />
            <span>{language === 'zh' ? '返回上一步' : 'Back'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
