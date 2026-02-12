/**
 * RegisterModePage - 注册模式选择页面
 * 先收集基础信息（name, email, password），然后选择注册模式
 */

import React, { useState, useEffect } from 'react';
import { UserPlus, Mail, Lock, User, ClipboardList, MessageSquare, AlertCircle, Check, ArrowLeft } from 'lucide-react';
import { Button } from '../../../components/Button';
import { Input } from '../../../components/Input';
import { useAuth } from '../hooks';
import { translations } from '../../../utils/translations';
import type { Language } from '../../../types';

export interface RegisterModePageProps {
  language: Language;
  onRegisterSuccess: (mode: 'scale' | 'ai') => void;
  onNavigateToLogin: () => void;
}

// 表单错误类型
interface FormErrors {
  name?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
}

/**
 * 验证姓名
 */
function validateName(name: string, language: Language): string | null {
  // 姓名可选，但如果填写了需要验证
  if (name && name.length < 2) {
    return language === 'zh' ? '姓名至少需要2个字符' : 'Name must be at least 2 characters';
  }
  return null;
}

/**
 * 验证邮箱格式
 */
function validateEmail(email: string, language: Language): string | null {
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
  if (!password) {
    return language === 'zh' ? '请输入密码' : 'Password is required';
  }

  if (password.length < 6) {
    return language === 'zh' ? '密码至少需要6个字符' : 'Password must be at least 6 characters';
  }

  // 可选：密码强度检查
  const hasNumber = /\d/.test(password);
  const hasLetter = /[a-zA-Z]/.test(password);
  if (!hasNumber || !hasLetter) {
    return language === 'zh' ? '密码需要包含字母和数字' : 'Password must contain letters and numbers';
  }

  return null;
}

/**
 * 验证确认密码
 */
function validateConfirmPassword(
  password: string,
  confirmPassword: string,
  language: Language
): string | null {
  if (!confirmPassword) {
    return language === 'zh' ? '请再次输入密码' : 'Please confirm your password';
  }

  if (password !== confirmPassword) {
    return language === 'zh' ? '两次密码不一致' : 'Passwords do not match';
  }

  return null;
}

export const RegisterModePage: React.FC<RegisterModePageProps> = ({
  language,
  onRegisterSuccess,
  onNavigateToLogin
}) => {
  const t = translations[language];
  const { register } = useAuth();

  // 表单状态
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [selectedMode, setSelectedMode] = useState<'scale' | 'ai' | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [showModeSelection, setShowModeSelection] = useState(false);

  // 清除 API 错误（当用户修改表单时）
  useEffect(() => {
    if (apiError) {
      setApiError(null);
    }
  }, [name, email, password, confirmPassword]);

  /**
   * 验证基础信息表单
   */
  const validateBasicForm = (): boolean => {
    const errors: FormErrors = {};

    const nameError = validateName(name, language);
    if (nameError) {
      errors.name = nameError;
    }

    const emailError = validateEmail(email, language);
    if (emailError) {
      errors.email = emailError;
    }

    const passwordError = validatePassword(password, language);
    if (passwordError) {
      errors.password = passwordError;
    }

    const confirmPasswordError = validateConfirmPassword(password, confirmPassword, language);
    if (confirmPasswordError) {
      errors.confirmPassword = confirmPasswordError;
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  /**
   * 处理"下一步"（显示模式选择）
   */
  const handleNext = (e: React.FormEvent) => {
    e.preventDefault();

    // 清除之前的错误
    setApiError(null);
    setFormErrors({});

    // 前端验证
    if (!validateBasicForm()) {
      return;
    }

    // 显示模式选择
    setShowModeSelection(true);
  };

  /**
   * 处理模式选择和注册
   */
  const handleModeSelect = async (mode: 'scale' | 'ai') => {
    setSelectedMode(mode);
    setIsLoading(true);
    setApiError(null);

    try {
      // 调用注册 API（内部会自动保存 token）
      await register({
        name: name.trim() || undefined as any, // 如果为空则不传
        email: email.trim(),
        password,
        mode,
      });

      // 注册成功，跳转到对应的入职流程
      onRegisterSuccess(mode);
    } catch (err: any) {
      setIsLoading(false);
      setSelectedMode(null);

      // 处理特定错误码
      if (err.code === 'EMAIL_EXISTS' || err.message?.includes('exists')) {
        setApiError(
          language === 'zh'
            ? '该邮箱已被注册'
            : 'This email is already registered'
        );
      } else if (err.code === 'NETWORK_ERROR') {
        setApiError(
          language === 'zh'
            ? '网络连接失败，请检查网络'
            : 'Network error. Please check your connection.'
        );
      } else {
        setApiError(err.message || (language === 'zh' ? '注册失败' : 'Registration failed'));
      }
    }
  };

  /**
   * 返回基础信息填写
   */
  const handleBack = () => {
    setShowModeSelection(false);
    setSelectedMode(null);
  };

  /**
   * 处理字段失焦验证
   */
  const handleNameBlur = () => {
    const error = validateName(name, language);
    setFormErrors(prev => ({ ...prev, name: error || undefined }));
  };

  const handleEmailBlur = () => {
    const error = validateEmail(email, language);
    setFormErrors(prev => ({ ...prev, email: error || undefined }));
  };

  const handlePasswordBlur = () => {
    const error = validatePassword(password, language);
    setFormErrors(prev => ({ ...prev, password: error || undefined }));
  };

  const handleConfirmPasswordBlur = () => {
    const error = validateConfirmPassword(password, confirmPassword, language);
    setFormErrors(prev => ({ ...prev, confirmPassword: error || undefined }));
  };

  return (
    <div className="min-h-screen flex items-center justify-center gradient-mesh p-4">
      <div className="w-full max-w-4xl animate-scale-in">
        {/* 标题区域 */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-600 text-white mb-4 shadow-lg animate-float">
            <UserPlus className="w-8 h-8" />
          </div>
          <h1 className="text-3xl font-bold text-gradient mb-2">
            {t.registerTitle}
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            {t.registerDesc}
          </p>
        </div>

        {!showModeSelection ? (
          /* ==================== 第一步：填写基础信息 ==================== */
          <form onSubmit={handleNext} className="glass-card p-8 space-y-6 max-w-md mx-auto">
            {/* API 错误提示 */}
            {apiError && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-start gap-3 animate-fade-in">
                <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-800 dark:text-red-200 mb-1">
                    {language === 'zh' ? '注册失败' : 'Registration Failed'}
                  </p>
                  <p className="text-sm text-red-600 dark:text-red-400">
                    {apiError}
                  </p>
                  {apiError.includes('已被注册') || apiError.includes('already registered') && (
                    <button
                      type="button"
                      onClick={onNavigateToLogin}
                      className="mt-2 text-sm text-red-700 dark:text-red-300 underline hover:no-underline"
                    >
                      {language === 'zh' ? '返回登录' : 'Go to login'}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* 姓名（可选） */}
            <div>
              <Input
                type="text"
                label={`${t.name} ${language === 'zh' ? '（可选）' : '(Optional)'}`}
                placeholder={t.namePlaceholder}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={handleNameBlur}
                disabled={isLoading}
                error={formErrors.name}
                autoComplete="name"
              />
            </div>

            {/* Email */}
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

            {/* Password */}
            <div>
              <Input
                type="password"
                label={t.password}
                placeholder={language === 'zh' ? '至少6个字符，包含字母和数字' : 'At least 6 characters, letters and numbers'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={handlePasswordBlur}
                disabled={isLoading}
                error={formErrors.password}
                autoComplete="new-password"
                required
              />
            </div>

            {/* Confirm Password */}
            <div>
              <Input
                type="password"
                label={language === 'zh' ? '确认密码' : 'Confirm Password'}
                placeholder={language === 'zh' ? '再次输入密码' : 'Re-enter password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onBlur={handleConfirmPasswordBlur}
                disabled={isLoading}
                error={formErrors.confirmPassword}
                autoComplete="new-password"
                required
              />
            </div>

            {/* 下一步按钮 */}
            <Button
              type="submit"
              variant="primary"
              size="lg"
              disabled={isLoading}
              className="w-full"
            >
              {language === 'zh' ? '下一步：选择注册方式' : 'Next: Choose Registration Mode'}
            </Button>

            {/* 登录入口 */}
            <div className="text-center text-sm text-gray-600 dark:text-gray-400 pt-4 border-t border-gray-200 dark:border-gray-700">
              {t.hasAccount}{' '}
              <button
                type="button"
                onClick={onNavigateToLogin}
                className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 font-medium transition-colors"
                disabled={isLoading}
              >
                {t.login}
              </button>
            </div>
          </form>
        ) : (
          /* ==================== 第二步：选择注册模式 ==================== */
          <div className="space-y-6">
            {/* 返回按钮 */}
            <button
              onClick={handleBack}
              disabled={isLoading}
              className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="text-sm font-medium">
                {language === 'zh' ? '返回修改信息' : 'Back to edit info'}
              </span>
            </button>

            {/* API 错误提示 */}
            {apiError && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-start gap-3 animate-fade-in">
                <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-800 dark:text-red-200 mb-1">
                    {language === 'zh' ? '注册失败' : 'Registration Failed'}
                  </p>
                  <p className="text-sm text-red-600 dark:text-red-400">
                    {apiError}
                  </p>
                  {(apiError.includes('已被注册') || apiError.includes('already registered')) && (
                    <button
                      type="button"
                      onClick={onNavigateToLogin}
                      className="mt-2 text-sm text-red-700 dark:text-red-300 underline hover:no-underline"
                    >
                      {language === 'zh' ? '返回登录' : 'Go to login'}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* 模式选择卡片 */}
            <div className="grid md:grid-cols-2 gap-6">
              {/* 量表注册 */}
              <div className={`glass-card p-6 rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.02] ${
                selectedMode === 'scale' ? 'ring-2 ring-blue-500 shadow-xl' : ''
              }`}>
                <div className="flex flex-col h-full">
                  {/* 图标和标题 */}
                  <div className="flex items-start gap-4 mb-4">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-600 flex items-center justify-center text-white shadow-lg flex-shrink-0">
                      <ClipboardList className="w-6 h-6" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-1">
                        {t.scaleMode}
                      </h3>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        {t.scaleModeDesc}
                      </p>
                    </div>
                  </div>

                  {/* 特点列表 */}
                  <ul className="space-y-2 mb-6 flex-1">
                    {t.scaleModeFeatures.map((feature: string, index: number) => (
                      <li key={index} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                        <Check className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>

                  {/* 选择按钮 */}
                  <Button
                    variant="primary"
                    size="md"
                    onClick={() => handleModeSelect('scale')}
                    disabled={isLoading}
                    isLoading={selectedMode === 'scale' && isLoading}
                    className="w-full"
                  >
                    {selectedMode === 'scale' && isLoading
                      ? (language === 'zh' ? '注册中...' : 'Registering...')
                      : t.selectMode}
                  </Button>
                </div>
              </div>

              {/* AI 引导注册 */}
              <div className={`glass-card p-6 rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.02] ${
                selectedMode === 'ai' ? 'ring-2 ring-purple-500 shadow-xl' : ''
              }`}>
                <div className="flex flex-col h-full">
                  {/* 图标和标题 */}
                  <div className="flex items-start gap-4 mb-4">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center text-white shadow-lg flex-shrink-0">
                      <MessageSquare className="w-6 h-6" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-1">
                        {t.aiMode}
                      </h3>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        {t.aiModeDesc}
                      </p>
                    </div>
                  </div>

                  {/* 特点列表 */}
                  <ul className="space-y-2 mb-6 flex-1">
                    {t.aiModeFeatures.map((feature: string, index: number) => (
                      <li key={index} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                        <Check className="w-4 h-4 text-purple-500 flex-shrink-0 mt-0.5" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>

                  {/* 选择按钮 */}
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={() => handleModeSelect('ai')}
                    disabled={isLoading}
                    isLoading={selectedMode === 'ai' && isLoading}
                    className="w-full"
                  >
                    {selectedMode === 'ai' && isLoading
                      ? (language === 'zh' ? '注册中...' : 'Registering...')
                      : t.selectMode}
                  </Button>
                </div>
              </div>
            </div>

            {/* 提示文本 */}
            <p className="text-center text-sm text-gray-500 dark:text-gray-400">
              {language === 'zh'
                ? '💡 提示：两种方式都能生成准确的学习画像，请根据个人偏好选择'
                : '💡 Tip: Both methods generate accurate learning profiles, choose based on your preference'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
