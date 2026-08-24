import React, { Suspense, useCallback, useState, useEffect } from 'react';
import { Layout } from './components/Layout';
import { Login } from './views/Login';
import { Register } from './views/Register';
import type { PendingScaleRegistration } from './views/Register';
import { RegisterScale } from './views/RegisterScale';
import { RegisterAI } from './views/RegisterAI';
import { useAppStore } from './services/store';
import { getActiveResearchTask } from './services/api';
import type { User, UserProfile } from './types';

const Dashboard = React.lazy(() => import('./views/Dashboard').then(module => ({ default: module.Dashboard })));
const Chat = React.lazy(() => import('./views/Chat').then(module => ({ default: module.Chat })));
const KnowledgeGraph = React.lazy(() => import('./views/KnowledgeGraph').then(module => ({ default: module.KnowledgeGraph })));
const Calibration = React.lazy(() => import('./views/Calibration').then(module => ({ default: module.Calibration })));
const Evidence = React.lazy(() => import('./views/Evidence').then(module => ({ default: module.Evidence })));
const Research = React.lazy(() => import('./views/Research').then(module => ({ default: module.Research })));
const Scales = React.lazy(() => import('./views/Scales').then(module => ({ default: module.Scales })));

// 视图类型定义
type AppView = 'dashboard' | 'chat' | 'graph' | 'calibration' | 'evidence' | 'research' | 'scales';
type AuthView = 'login' | 'register' | 'register-scale' | 'register-ai';
type View = AppView | AuthView;

function App() {
  const {
    state,
    theme,
    toggleTheme,
    setLanguage,
    addMessage,
    addCalibrationLog,
    updateNode,
    updateProfile,
    clearMessages,
    setAuth,
    clearAuth
  } = useAppStore();

  const [currentView, setCurrentView] = useState<View>(
    state.user ? 'dashboard' : 'login'
  );

  // 入口解析状态：已登录会话在解析出当前开放任务之前不渲染学习首页，避免闪现
  const [entryResolved, setEntryResolved] = useState(false);

  // Scale 模式注册暂存数据（选择模式后，量表提交前）
  const [pendingScaleReg, setPendingScaleReg] = useState<PendingScaleRegistration | null>(null);

  // Track chat key to remount Chat when starting a new conversation
  const [chatKey, setChatKey] = useState(0);

  const handleNewConversation = () => {
    clearMessages();
    setChatKey(k => k + 1);
  };

  // 监听认证状态变化
  useEffect(() => {
    if (!state.user && !['login', 'register', 'register-scale', 'register-ai'].includes(currentView)) {
      setCurrentView('login');
    }
  }, [state.user, currentView]);

  useEffect(() => {
    if (!state.user) return;
    const allowed: Record<User['experimentGroup'], AppView[]> = {
      pdt: ['dashboard', 'chat', 'evidence', 'research', 'scales'],
      ai_pbl: ['dashboard', 'chat', 'evidence', 'research', 'scales'],
      lecture: ['dashboard', 'evidence', 'research', 'scales'],
      unassigned: ['dashboard', 'scales'],
    };
    if (requiresAuth(currentView) && !allowed[state.user.experimentGroup ?? 'unassigned'].includes(currentView as AppView)) {
      setCurrentView('dashboard');
    }
  }, [state.user, currentView]);

  /**
   * 解析登录后的落地视图。
   * 未完成 onboarding 的学生进入注册流程；已分组学生若存在教师开放的当前任务，
   * 直接进入该任务工作区；只有在无开放任务或后端不可用时才回退到学习首页。
   */
  const resolveEntryView = useCallback(async (user: User | null): Promise<View> => {
    if (!user) return 'login';
    if (!user.hasCompletedOnboarding) {
      return (user.onboardingMode || 'scale') === 'ai' ? 'register-ai' : 'register-scale';
    }
    if ((user.experimentGroup ?? 'unassigned') === 'unassigned') return 'dashboard';
    try {
      const task = await getActiveResearchTask();
      if (task) return 'research';
    } catch {
      // 无法读取当前任务时不阻塞登录，回退到学习首页
    }
    return 'dashboard';
  }, []);

  // 会话恢复（刷新、重新打开标签页）时同样直达当前开放任务
  useEffect(() => {
    if (entryResolved) return;
    if (!state.user) {
      setEntryResolved(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      const view = await resolveEntryView(state.user);
      if (cancelled) return;
      setCurrentView(view);
      setEntryResolved(true);
    })();
    return () => { cancelled = true; };
  }, [entryResolved, resolveEntryView, state.user]);

  // 登录成功处理
  const handleLoginSuccess = async (token: string, user: any, profile?: UserProfile) => {
    setAuth(user, token, profile);
    setCurrentView(await resolveEntryView(user as User));
    setEntryResolved(true);
  };

  // 注册成功处理（设置认证信息并跳转到onboarding）
  const handleRegisterSuccess = (token: string, user: any, mode: 'scale' | 'ai') => {
    setAuth(user, token);
    setCurrentView(mode === 'scale' ? 'register-scale' : 'register-ai');
  };

  // Scale 模式：暂存注册数据，直接跳转到量表（不建账号）
  const handlePendingScale = (data: PendingScaleRegistration) => {
    setPendingScaleReg(data);
    setCurrentView('register-scale');
  };

  // 注册完成处理
  const handleRegistrationComplete = async (
    initialProfile: UserProfile,
    attributes?: string[],
    conceptSeeds?: string[],
    auth?: { token: string; user: User }
  ) => {
    setPendingScaleReg(null);
    if (auth) {
      setAuth(auth.user, auth.token, initialProfile);
    } else {
      updateProfile(initialProfile);
    }
    const user = auth?.user ?? state.user;
    setCurrentView(user ? await resolveEntryView({ ...user, hasCompletedOnboarding: true }) : 'dashboard');
    setEntryResolved(true);
  };

  // 登出处理
  const handleLogout = () => {
    clearAuth();
    setEntryResolved(true);
    setCurrentView('login');
  };

  // 路由守卫：检查是否需要认证
  const requiresAuth = (view: View): boolean => {
    return ['dashboard', 'chat', 'graph', 'calibration', 'evidence', 'research', 'scales'].includes(view);
  };

  // 渲染认证相关视图
  const renderAuthView = () => {
    switch (currentView) {
      case 'login':
        return (
          <Login
            language={state.language}
            onLoginSuccess={handleLoginSuccess}
            onNavigateToRegister={() => setCurrentView('register')}
          />
        );

      case 'register':
        return (
          <Register
            language={state.language}
            onRegisterSuccess={handleRegisterSuccess}
            onPendingScale={handlePendingScale}
            onNavigateToLogin={() => setCurrentView('login')}
          />
        );

      case 'register-scale':
        return (
          <RegisterScale
            language={state.language}
            onComplete={(profile, auth) => handleRegistrationComplete(profile, undefined, undefined, auth)}
            onBack={() => { setPendingScaleReg(null); setCurrentView('register'); }}
            pendingRegistration={pendingScaleReg ?? undefined}
          />
        );

      case 'register-ai':
        return (
          <RegisterAI
            language={state.language}
            onComplete={handleRegistrationComplete}
            onBack={() => setCurrentView('register')}
          />
        );

      default:
        return null;
    }
  };

  // 渲染应用内容（需要认证）
  const renderProtectedContent = () => {
    // 路由守卫：如果未登录，重定向到登录页
    if (!state.user) {
      return null;
    }

    switch (currentView) {
      case 'dashboard':
        return (
          <Dashboard
            profile={state.profile}
            onNavigate={setCurrentView as (view: AppView) => void}
            language={state.language}
            theme={theme}
            userId={state.user?.id}
            userName={state.user?.name}
            experimentGroup={state.user.experimentGroup ?? 'unassigned'}
          />
        );

      case 'chat':
        return (
          <Chat
            key={chatKey}
            messages={state.messages}
            profile={state.profile}
            onSendMessage={addMessage}
            onUpdateProfile={updateProfile}
            language={state.language}
            isResearchMode={state.isResearchMode}
            theme={theme}
            userId={state.user?.id}
            studentId={state.user?.student_id}
            experimentGroup={state.user.experimentGroup ?? 'unassigned'}
            onNewConversation={handleNewConversation}
          />
        );

      case 'graph':
        return (
          <KnowledgeGraph
            nodes={state.nodes}
            edges={state.edges}
            onNodeUpdate={updateNode}
            onLogCalibration={addCalibrationLog}
            language={state.language}
            theme={theme}
            userId={state.user?.id}
          />
        );

      case 'calibration':
        return (
          <Calibration
            profile={state.profile}
            onLogCalibration={addCalibrationLog}
            language={state.language}
            theme={theme}
          />
        );

      case 'evidence':
        return (
          <Evidence
            logs={state.logs}
            messages={state.messages}
            language={state.language}
            theme={theme}
          />
        );

      case 'research':
        return (
          <Research
            onUpdateProfile={updateProfile}
            onExit={() => setCurrentView('dashboard')}
            language={state.language}
            theme={theme}
            userId={state.user?.id}
            studentId={state.user?.student_id}
            experimentGroup={state.user.experimentGroup ?? 'unassigned'}
          />
        );

      case 'scales':
        return (
          <Scales
            language={state.language}
            theme={theme}
            onUpdateProfile={updateProfile}
          />
        );

      default:
        return (
          <Dashboard
            profile={state.profile}
            onNavigate={setCurrentView as (view: AppView) => void}
            language={state.language}
            theme={theme}
            userName={state.user?.name}
            experimentGroup={state.user.experimentGroup ?? 'unassigned'}
          />
        );
    }
  };

  // 主渲染逻辑
  if (!state.user) {
    // 未登录状态：显示认证相关视图（无 Layout）
    return <>{renderAuthView()}</>;
  }

  // 已登录但尚未解析当前开放任务：先不渲染学习首页，避免闪现后再跳转
  if (!entryResolved) {
    return <div className="view-loading" role="status">正在读取当前项目…</div>;
  }

  // 已登录但未完成 onboarding：显示 onboarding 视图（无 Layout）
  if (['register', 'register-scale', 'register-ai'].includes(currentView)) {
    return <>{renderAuthView()}</>;
  }

  // 已登录且完成 onboarding：使用 Layout 包裹应用内容
  return (
    <Layout
      currentView={currentView as AppView}
      onViewChange={setCurrentView as (view: AppView) => void}
      language={state.language}
      onSetLanguage={setLanguage}
      theme={theme}
      onToggleTheme={toggleTheme}
      user={state.user}
      onLogout={handleLogout}
    >
      <Suspense fallback={<div className="view-loading" role="status">正在加载学习界面…</div>}>
        {renderProtectedContent()}
      </Suspense>
    </Layout>
  );
}

export default App;
