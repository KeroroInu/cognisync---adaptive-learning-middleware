import React, { useState } from 'react';
import { ClipboardList, MessageSquare, Check, ArrowLeft, User, Loader, Eye, EyeOff } from 'lucide-react';
import { Input } from '../components/Input';
import { register as registerAPI, AuthError } from '../services/api';
import { translations } from '../utils/translations';
import type { Language } from '../types';
import './Register.css';
import { ClassroomRegister } from './ClassroomRegister';

export interface PendingScaleRegistration {
  student_id: string;
  name: string;
  email?: string;
  password: string;
  className?: string;
}

export interface RegisterProps {
  classroomOnly?: boolean;
  language: Language;
  onRegisterSuccess: (token: string, user: any, mode: 'scale' | 'ai') => void;
  /** scale 模式：不创建账号，把表单数据传给量表页面 */
  onPendingScale: (data: PendingScaleRegistration) => void;
  onNavigateToLogin: () => void;
}

export const Register: React.FC<RegisterProps> = (props) => props.classroomOnly
  ? <ClassroomRegister language={props.language} onRegisterSuccess={props.onRegisterSuccess} onNavigateToLogin={props.onNavigateToLogin} />
  : <LegacyRegister {...props} />;

const LegacyRegister: React.FC<RegisterProps> = ({
  language,
  classroomOnly = false,
  onRegisterSuccess,
  onPendingScale,
  onNavigateToLogin
}) => {
  const t = translations[language];

  // Form state
  const [step, setStep] = useState<'info' | 'mode'>('info');
  const [name, setName] = useState('');
  const [studentId, setStudentId] = useState('');
  const [className, setClassName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [gender, setGender] = useState<'male' | 'female' | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 该学号已开始注册但未完成时置真：错误框下方额外给出「去登录继续」入口。 */
  const [resumeHint, setResumeHint] = useState(false);

  // Validate and proceed to mode selection
  const handleNext = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError(language === 'zh' ? '请填写姓名' : 'Please enter your name');
      return;
    }

    if (!studentId.trim()) {
      setError(language === 'zh' ? '请填写学号' : 'Please enter your student ID');
      return;
    }

    if (!password) {
      setError(language === 'zh' ? '请填写密码' : 'Please enter a password');
      return;
    }

    if (password.length < 6) {
      setError(language === 'zh' ? '密码至少需要6个字符' : 'Password must be at least 6 characters');
      return;
    }

    if (!classroomOnly && password !== confirmPassword) {
      setError(language === 'zh' ? '两次密码不一致' : 'Passwords do not match');
      return;
    }

    // 如果填了邮箱，验证格式
    if (email.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        setError(language === 'zh' ? '邮箱格式不正确' : 'Invalid email format');
        return;
      }
    }

    if (classroomOnly) {
      await handleModeSelect('scale');
    } else {
      setStep('mode');
    }
  };

  // Handle mode selection and registration
  const handleModeSelect = async (mode: 'scale' | 'ai') => {
    // Scale 模式：不在此处创建账号，把表单数据传给量表页面
    // 账号将在量表填写完成提交时原子性创建
    if (mode === 'scale' && !classroomOnly) {
      onPendingScale({
        student_id: studentId.trim(),
        name: name.trim(),
        email: email.trim() || undefined,
        password,
        className: className.trim() || undefined,
      });
      return;
    }

    // AI 模式：需要先建账号（AI 对话需要后端 session）
    setIsLoading(true);
    setError(null);

    try {
      const response = await registerAPI({
        student_id: studentId.trim(),
        name: name.trim(),
        email: classroomOnly ? undefined : email.trim() || undefined,
        password,
        mode: classroomOnly ? 'classroom' : mode,
        className: classroomOnly ? undefined : className.trim() || undefined,
        ...(classroomOnly ? { gender } : {}),
      });

      const token = response.success && response.data ? response.data.token : '';
      const user = response.success && response.data ? response.data.user : null;

      if (token && user) {
        onRegisterSuccess(token, user, mode);
      } else {
        throw new Error('Invalid registration response');
      }
    } catch (err: any) {
      // 「该学号已开始注册但没完成」必须给出出口。
      //
      // 后端刻意不允许重复注册覆盖未完成账号的密码（学号可猜，覆盖等于账号劫持），
      // 正确的恢复路径是用原密码登录——登录后 App.tsx 会依据 hasCompletedOnboarding
      // 自动跳回未完成的那一步。但此前这里只显示后端原文 "Student ID already
      // registered"，学生根本不知道该去登录，只会反复重填学号，真实测试中就卡在这里。
      if (err instanceof AuthError && err.code === 'REGISTRATION_INCOMPLETE') {
        setResumeHint(true);
        setError(err.message);
      } else {
        setResumeHint(false);
        setError(err?.message || (language === 'zh' ? '注册失败，请重试' : 'Registration failed, please try again'));
      }
      setIsLoading(false);
    }
  };

  // Render basic info form
  if (step === 'info') {
    if (classroomOnly) return <main className="classroom-register">
      <section aria-labelledby="classroom-register-heading">
        <header><span className="classroom-register-mark"><User size={26} /></span><p>CogniSync · 编程课堂</p><h1 id="classroom-register-heading">先认识一下你</h1></header>
        <form onSubmit={handleNext}>
          <Input label={language === 'zh' ? '姓名' : 'Name'} placeholder="你的姓名" value={name} onChange={e => setName(e.target.value)} required autoComplete="name" maxLength={100} disabled={isLoading} />
          <Input label={t.studentId} placeholder="你的学号" value={studentId} onChange={e => setStudentId(e.target.value)} required autoComplete="username" maxLength={50} disabled={isLoading} />
          <div className="classroom-register-password"><Input label={t.password} placeholder="自己设一个密码，至少 6 位" type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} required minLength={6} maxLength={128} autoComplete="new-password" disabled={isLoading} />
            <button type="button" aria-label={showPassword ? '隐藏密码' : '显示密码'} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={20} /> : <Eye size={20} />}</button></div>
          <fieldset className="classroom-register-gender" disabled={isLoading}><legend>性别 <small>选填</small></legend>
            {[{ value: 'male' as const, icon: '♂', label: '男' }, { value: 'female' as const, icon: '♀', label: '女' }, { value: null, icon: '—', label: '暂不填写' }].map(option => <label key={option.value ?? 'skip'} className={gender === option.value ? 'is-selected' : ''}>
              <input type="radio" name="gender" checked={gender === option.value} onChange={() => setGender(option.value)} /><span aria-hidden="true">{option.icon}</span>{option.label}
            </label>)}
          </fieldset>
          {error ? <p role="alert">{error}</p> : null}
          <button type="submit" className="classroom-register-submit" disabled={isLoading}>{isLoading ? '正在注册…' : '注册并进入课堂'}</button>
          <button type="button" className="classroom-register-login" onClick={onNavigateToLogin}>已有账号？直接登录</button>
        </form>
      </section>
    </main>;
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
            <p style={{ color: 'var(--text-light)' }}>
              {language === 'zh' ? '创建您的账号以开始使用' : 'Create your account to get started'}
            </p>
          </div>

          {/* Registration Form */}
          <form onSubmit={handleNext} className="glass-card p-8 space-y-5">
            {error && (
              <div className="border border-red-200 rounded-lg p-4 animate-fade-in" style={{ backgroundColor: 'rgba(239,68,68,0.08)' }}>
                <p className="text-sm text-red-500">{error}</p>
              </div>
            )}

            {/* 姓名（必填） */}
            <div>
              <Input
                type="text"
                label={language === 'zh' ? '姓名' : 'Name'}
                placeholder={language === 'zh' ? '请输入您的姓名' : 'Enter your name'}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isLoading}
                autoComplete="name"
                required
              />
            </div>

            {/* 学号（必填） */}
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

            {/* 密码（必填） */}
            <div>
              <Input
                type="text"
                label={language === 'zh' ? '班级' : 'Class'}
                placeholder={language === 'zh' ? '例如：高二（3）班' : 'e.g. Class 3'}
                value={className}
                onChange={(e) => setClassName(e.target.value)}
                disabled={isLoading}
                autoComplete="organization"
              />
            </div>

            {/* 密码（必填） */}
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

            {/* 确认密码（必填） */}
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

            {/* 邮箱（选填） */}
            <div>
              <Input
                type="email"
                label={t.email}
                placeholder={t.emailPlaceholder}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading}
                autoComplete="email"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full px-6 py-3 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white font-medium rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isLoading ? (language === 'zh' ? '正在注册…' : 'Registering…') : classroomOnly ? (language === 'zh' ? '注册并进入课堂' : 'Join classroom') : (language === 'zh' ? '下一步' : 'Next')}
            </button>

            <div className="text-center text-sm" style={{ color: 'var(--text-light)' }}>
              {t.hasAccount}{' '}
              <button
                type="button"
                onClick={onNavigateToLogin}
                className="text-blue-500 hover:text-blue-600 font-medium transition-colors"
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
            <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gradient mb-4">
            {t.chooseOnboardingMode}
          </h1>
          <p className="text-lg max-w-2xl mx-auto" style={{ color: 'var(--text-light)' }}>
            {t.chooseOnboardingDesc}
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="max-w-2xl mx-auto mb-8 border border-red-200 rounded-lg p-4" style={{ backgroundColor: 'rgba(239,68,68,0.08)' }}>
            <p className="text-sm text-red-500 text-center">{error}</p>
            {resumeHint && (
              <div className="mt-3 text-center">
                <button
                  type="button"
                  onClick={onNavigateToLogin}
                  className="text-sm font-medium underline"
                  style={{ color: 'var(--primary, #6366f1)' }}
                >
                  {language === 'zh' ? '去登录，继续未完成的注册' : 'Log in to finish your registration'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Mode Selection Cards */}
        <div className="grid md:grid-cols-2 gap-8 mb-8">
          {/* Scale Mode Card */}
          <div className="glass-card p-8 group hover:shadow-2xl transition-all duration-300 hover:scale-[1.02] relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-cyan-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
            <div className="relative z-10">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-600 text-white mb-6 shadow-lg group-hover:scale-110 transition-transform duration-300">
                <ClipboardList className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-bold mb-3 bg-gradient-to-r from-blue-600 to-cyan-600 bg-clip-text text-transparent">
                {t.scaleMode}
              </h2>
              <p className="mb-6" style={{ color: 'var(--text-light)' }}>
                {t.scaleModeDesc}
              </p>
              <ul className="space-y-3 mb-8">
                {t.scaleModeFeatures.map((feature: string, index: number) => (
                  <li key={index} className="flex items-start gap-3 animate-fade-in" style={{ animationDelay: `${index * 100}ms`, color: 'var(--text-secondary)' }}>
                    <div className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center mt-0.5">
                      <Check className="w-3 h-3 text-blue-600" />
                    </div>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => handleModeSelect('scale')}
                disabled={isLoading}
                className="w-full px-6 py-4 bg-gradient-to-r from-blue-500 to-cyan-600 hover:from-blue-600 hover:to-cyan-700 text-white font-medium rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 flex items-center justify-center gap-2 group-hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <><Loader className="w-5 h-5 animate-spin" />{language === 'zh' ? '注册中...' : 'Registering...'}</>
                ) : (
                  <><ClipboardList className="w-5 h-5" />{t.selectMode}</>
                )}
              </button>
            </div>
          </div>

          {/* AI Mode Card */}
          <div className="glass-card p-8 group hover:shadow-2xl transition-all duration-300 hover:scale-[1.02] relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-pink-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
            <div className="relative z-10">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-600 text-white mb-6 shadow-lg group-hover:scale-110 transition-transform duration-300">
                <MessageSquare className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-bold mb-3 bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
                {t.aiMode}
              </h2>
              <p className="mb-6" style={{ color: 'var(--text-light)' }}>
                {t.aiModeDesc}
              </p>
              <ul className="space-y-3 mb-8">
                {t.aiModeFeatures.map((feature: string, index: number) => (
                  <li key={index} className="flex items-start gap-3 animate-fade-in" style={{ animationDelay: `${index * 100}ms`, color: 'var(--text-secondary)' }}>
                    <div className="flex-shrink-0 w-5 h-5 rounded-full bg-purple-100 flex items-center justify-center mt-0.5">
                      <Check className="w-3 h-3 text-purple-600" />
                    </div>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => handleModeSelect('ai')}
                disabled={isLoading}
                className="w-full px-6 py-4 bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 text-white font-medium rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 flex items-center justify-center gap-2 group-hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <><Loader className="w-5 h-5 animate-spin" />{language === 'zh' ? '注册中...' : 'Registering...'}</>
                ) : (
                  <><MessageSquare className="w-5 h-5" />{t.selectMode}</>
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
            className="inline-flex items-center gap-2 font-medium transition-colors group disabled:opacity-50 hover:text-blue-500"
            style={{ color: 'var(--text-light)' }}
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform duration-300" />
            <span>{language === 'zh' ? '返回上一步' : 'Back'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
