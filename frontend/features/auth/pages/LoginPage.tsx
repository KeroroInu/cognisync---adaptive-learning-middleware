/**
 * LoginPage - 登录页面
 * 完全复用现有系统 UI 风格（glass-card、渐变、动画）
 */

import React, { useState, useEffect } from 'react';
import { LogIn, Mail, Lock, AlertCircle, Sparkles } from 'lucide-react';
import { Button } from '../../../components/Button';
import { Input } from '../../../components/Input';
import { useAuth } from '../hooks';
import { translations } from '../../../utils/translations';
import type { Language } from '../../../types';

export interface LoginPageProps {
  language: Language;
  onLoginSuccess: () => void;
  onNavigateToRegister: () => void;
}

// 表单错误类型
interface FormErrors {
  email?: string;
  password?: string;
}

/**
 * 验证邮箱格式
 */
function validateEmail(email: string, language: Language): string | null {
  const t = translations[language];

  if (!email) {
    return language === 'zh' ? '请输入邮箱地址' : 'Email is required';
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return language === 'zh' ? '邮箱格式不正确' : 'Invalid email format';
  }

  return null;
}

/**
 * 验证密码
 */
function validatePassword(password: string, language: Language): string | null {
  const t = translations[language];

  if (!password) {
    return language === 'zh' ? '请输入密码' : 'Password is required';
  }

  if (password.length < 6) {
    return language === 'zh' ? '密码至少需要6个字符' : 'Password must be at least 6 characters';
  }

  return null;
}

export const LoginPage: React.FC<LoginPageProps> = ({
  language,
  onLoginSuccess,
  onNavigateToRegister
}) => {
  const t = translations[language];
  const { login } = useAuth();

  // 表单状态
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<FormErrors>({});

  // 清除 API 错误（当用户修改表单时）
  useEffect(() => {
    if (apiError) {
      setApiError(null);
    }
  }, [email, password]);

  /**
   * 验证整个表单
   */
  const validateForm = (): boolean => {
    const errors: FormErrors = {};

    const emailError = validateEmail(email, language);
    if (emailError) {
      errors.email = emailError;
    }

    const passwordError = validatePassword(password, language);
    if (passwordError) {
      errors.password = passwordError;
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  /**
   * 处理表单提交
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // 清除之前的错误
    setApiError(null);
    setFormErrors({});

    // 前端验证
    if (!validateForm()) {
      return;
    }

    setIsLoading(true);

    try {
      // 调用 authStore.login（内部会调用 POST /api/auth/login）
      await login({ email, password });

      // 登录成功
      onLoginSuccess();
    } catch (err: any) {
      // 显示 API 错误
      const errorMessage = err.message || t.loginError;
      setApiError(errorMessage);

      // 如果是特定错误码，可以做特殊处理
      if (err.code === 'INVALID_CREDENTIALS') {
        setApiError(
          language === 'zh'
            ? '邮箱或密码错误'
            : 'Invalid email or password'
        );
      } else if (err.code === 'NETWORK_ERROR') {
        setApiError(
          language === 'zh'
            ? '网络连接失败，请检查网络'
            : 'Network error. Please check your connection.'
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * 处理字段失焦验证
   */
  const handleEmailBlur = () => {
    const error = validateEmail(email, language);
    setFormErrors(prev => ({ ...prev, email: error || undefined }));
  };

  const handlePasswordBlur = () => {
    const error = validatePassword(password, language);
    setFormErrors(prev => ({ ...prev, password: error || undefined }));
  };

  return (
    <div className="min-h-screen flex items-center justify-center gradient-mesh p-4">
      <div className="w-full max-w-6xl flex items-center justify-center gap-12">
        {/* 左侧：系统简介（可选，桌面端显示） */}
        <div className="hidden lg:flex flex-1 flex-col items-start justify-center animate-slide-in-left">
          <div className="glass-card p-8 rounded-2xl">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white shadow-lg">
                <Sparkles className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gradient">CogniSync</h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {language === 'zh' ? 'AI 时代的项目解构式编程学习平台' : 'Project Deconstruction Learning for the AI Era'}
                </p>
              </div>
            </div>

            <div className="space-y-4 text-gray-700 dark:text-gray-300">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-blue-600 dark:text-blue-400 font-semibold">01</span>
                </div>
                <div>
                  <h3 className="font-semibold mb-1">
                    {language === 'zh' ? '实时学习者建模' : 'Real-time Learner Modeling'}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {language === 'zh'
                      ? '多维度追踪认知、情感和行为状态'
                      : 'Multi-dimensional tracking of cognition, affect, and behavior'}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-purple-600 dark:text-purple-400 font-semibold">02</span>
                </div>
                <div>
                  <h3 className="font-semibold mb-1">
                    {language === 'zh' ? 'AI 驱动的个性化' : 'AI-Powered Personalization'}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {language === 'zh'
                      ? '智能对话分析与概念图谱构建'
                      : 'Intelligent dialogue analysis and concept graph construction'}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-violet-500 dark:text-violet-300 font-semibold">03</span>
                </div>
                <div>
                  <h3 className="font-semibold mb-1">
                    {language === 'zh' ? '模型校准与纠偏' : 'Model Calibration & Correction'}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {language === 'zh'
                      ? '用户可主动参与模型调整，提升准确性'
                      : 'User-driven model adjustment for improved accuracy'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 右侧：登录表单 */}
        <div className="w-full max-w-md animate-scale-in">
          {/* Logo/Title */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white mb-4 shadow-lg animate-float">
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
            {/* API 错误提示 */}
            {apiError && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-start gap-3 animate-fade-in">
                <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-800 dark:text-red-200 mb-1">
                    {language === 'zh' ? '登录失败' : 'Login Failed'}
                  </p>
                  <p className="text-sm text-red-600 dark:text-red-400">
                    {apiError}
                  </p>
                </div>
              </div>
            )}

            {/* Email 输入框 */}
            <div>
              <Input
                type="email"
                label={t.email}
                placeholder={t.emailPlaceholder}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={handleEmailBlur}
                disabled={isLoading}
                error={formErrors.email}
                autoComplete="email"
                required
              />
            </div>

            {/* Password 输入框 */}
            <div>
              <Input
                type="password"
                label={t.password}
                placeholder={t.passwordPlaceholder}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={handlePasswordBlur}
                disabled={isLoading}
                error={formErrors.password}
                autoComplete="current-password"
                required
              />
            </div>

            {/* 忘记密码链接（可选） */}
            <div className="flex items-center justify-end">
              <button
                type="button"
                className="text-sm text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 font-medium transition-colors"
                onClick={() => {
                  // 跳转到忘记密码页面（未实现）
                  console.log('Navigate to forgot password');
                }}
              >
                {language === 'zh' ? '忘记密码？' : 'Forgot password?'}
              </button>
            </div>

            {/* 登录按钮 */}
            <Button
              type="submit"
              variant="primary"
              size="lg"
              isLoading={isLoading}
              disabled={isLoading}
              className="w-full"
            >
              <Mail className="w-5 h-5 mr-2" />
              {isLoading ? t.loggingIn : t.loginButton}
            </Button>

            {/* 注册入口 */}
            <div className="text-center text-sm text-gray-600 dark:text-gray-400 pt-4 border-t border-gray-200 dark:border-gray-700">
              {t.noAccount}{' '}
              <button
                type="button"
                onClick={onNavigateToRegister}
                className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 font-medium transition-colors"
                disabled={isLoading}
              >
                {t.signUp}
              </button>
            </div>
          </form>

          {/* 移动端显示的简短说明 */}
          <div className="lg:hidden mt-6 text-center text-sm text-gray-600 dark:text-gray-400">
            <p>
              {language === 'zh'
                ? '🚀 开启个性化学习之旅'
                : '🚀 Start Your Personalized Learning Journey'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
