import React, { useState, useEffect } from 'react';
import { Layout } from './components/Layout';
import { Dashboard } from './views/Dashboard';
import { Chat } from './views/Chat';
import { KnowledgeGraph } from './views/KnowledgeGraph';
import { Calibration } from './views/Calibration';
import { Evidence } from './views/Evidence';
import { Login } from './views/Login';
import { Register } from './views/Register';
import { RegisterScale } from './views/RegisterScale';
import { RegisterAI } from './views/RegisterAI';
import { useAppStore } from './services/store';
import type { UserProfile } from './types';

// 视图类型定义
type AppView = 'dashboard' | 'chat' | 'graph' | 'calibration' | 'evidence';
type AuthView = 'login' | 'register' | 'register-scale' | 'register-ai';
type View = AppView | AuthView;

function App() {
  const {
    state,
    theme,
    toggleTheme,
    toggleResearchMode,
    setLanguage,
    addMessage,
    addCalibrationLog,
    updateNode,
    updateProfile,
    setAuth,
    clearAuth
  } = useAppStore();

  const [currentView, setCurrentView] = useState<View>(
    state.user ? 'dashboard' : 'login'
  );

  // 监听认证状态变化
  useEffect(() => {
    if (!state.user && !['login', 'register', 'register-scale', 'register-ai'].includes(currentView)) {
      setCurrentView('login');
    }
  }, [state.user, currentView]);

  // 登录成功处理
  const handleLoginSuccess = (token: string, user: any, profile?: UserProfile) => {
    setAuth(user, token, profile);

    // 检查是否完成了onboarding
    if (user.hasCompletedOnboarding) {
      setCurrentView('dashboard');
    } else {
      // 根据 onboarding 模式跳转
      const mode = user.onboardingMode || 'scale';
      setCurrentView(mode === 'ai' ? 'register-ai' : 'register-scale');
    }
  };

  // 注册成功处理（设置认证信息并跳转到onboarding）
  const handleRegisterSuccess = (token: string, user: any, mode: 'scale' | 'ai') => {
    setAuth(user, token);
    setCurrentView(mode === 'scale' ? 'register-scale' : 'register-ai');
  };

  // 注册完成处理
  const handleRegistrationComplete = (
    initialProfile: UserProfile,
    attributes?: string[],
    conceptSeeds?: string[]
  ) => {
    updateProfile(initialProfile);
    setCurrentView('dashboard');
  };

  // 登出处理
  const handleLogout = () => {
    clearAuth();
    setCurrentView('login');
  };

  // 路由守卫：检查是否需要认证
  const requiresAuth = (view: View): boolean => {
    return ['dashboard', 'chat', 'graph', 'calibration', 'evidence'].includes(view);
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
            onNavigateToLogin={() => setCurrentView('login')}
          />
        );

      case 'register-scale':
        return (
          <RegisterScale
            language={state.language}
            onComplete={handleRegistrationComplete}
            onBack={() => setCurrentView('register')}
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
          />
        );

      case 'chat':
        return (
          <Chat
            messages={state.messages}
            onSendMessage={addMessage}
            onUpdateProfile={updateProfile}
            language={state.language}
            isResearchMode={state.isResearchMode}
            theme={theme}
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

      default:
        return (
          <Dashboard
            profile={state.profile}
            onNavigate={setCurrentView as (view: AppView) => void}
            language={state.language}
            theme={theme}
          />
        );
    }
  };

  // 主渲染逻辑
  if (!state.user) {
    // 未登录状态：显示认证相关视图（无 Layout）
    return <>{renderAuthView()}</>;
  }

  // 已登录但未完成 onboarding：显示 onboarding 视图（无 Layout）
  if (['register-scale', 'register-ai'].includes(currentView)) {
    return <>{renderAuthView()}</>;
  }

  // 已登录且完成 onboarding：使用 Layout 包裹应用内容
  return (
    <Layout
      currentView={currentView as AppView}
      onViewChange={setCurrentView as (view: AppView) => void}
      isResearchMode={state.isResearchMode}
      onToggleResearch={toggleResearchMode}
      language={state.language}
      onSetLanguage={setLanguage}
      theme={theme}
      onToggleTheme={toggleTheme}
      user={state.user}
      onLogout={handleLogout}
    >
      {renderProtectedContent()}
    </Layout>
  );
}

export default App;
