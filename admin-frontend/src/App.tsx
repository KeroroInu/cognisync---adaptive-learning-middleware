import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './features/auth/authStore';
import { useRequireAuth } from './features/auth/hooks';
import { AdminLayout } from './components/AdminLayout';
import { Login } from './pages/Login';

const Dashboard = lazy(() => import('./pages/Dashboard').then(module => ({ default: module.Dashboard })));
const Users = lazy(() => import('./pages/Users').then(module => ({ default: module.Users })));
const UserDetail = lazy(() => import('./pages/UserDetail').then(module => ({ default: module.UserDetail })));
const Scales = lazy(() => import('./pages/Scales').then(module => ({ default: module.Scales })));
const ResearchManagement = lazy(() => import('./pages/ResearchManagement').then(module => ({ default: module.ResearchManagement })));
const TestAssignments = lazy(() => import('./pages/TestAssignments').then(module => ({ default: module.TestAssignments })));
const Conversations = lazy(() => import('./pages/Conversations').then(module => ({ default: module.Conversations })));
const ConversationDetail = lazy(() => import('./pages/ConversationDetail').then(module => ({ default: module.ConversationDetail })));
const Exports = lazy(() => import('./pages/Exports').then(module => ({ default: module.Exports })));
const ModelConfig = lazy(() => import('./pages/ModelConfig').then(module => ({ default: module.ModelConfig })));
const EmotionAnalytics = lazy(() => import('./pages/EmotionAnalytics').then(module => ({ default: module.EmotionAnalytics })));

const PageFallback = () => (
  <div className="admin-page-loading" role="status" aria-label="页面加载中">
    <div className="admin-page-loading-spinner" />
  </div>
);

/**
 * 所有受保护的 /admin/* 路由容器。
 * - 启动时调用 bootstrap() 尝试从 localStorage 恢复登录状态
 * - useRequireAuth() 在 status='guest' 时自动跳转 /login
 * - status='unknown'（校验中）时显示 loading
 */
function AdminApp() {
  const { bootstrap, isLoading, isAuthed } = useRequireAuth();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // 正在校验 token，等待结果
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen gradient-mesh">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500" />
      </div>
    );
  }

  // 未登录：useRequireAuth 已触发跳转，此处渲染 null 避免闪烁
  if (!isAuthed) return null;

  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
      <Route index element={<AdminLayout><Dashboard /></AdminLayout>} />
      <Route path="users" element={<AdminLayout><Users /></AdminLayout>} />
      <Route path="users/:userId" element={<AdminLayout><UserDetail /></AdminLayout>} />
      <Route path="scales" element={<AdminLayout><Scales /></AdminLayout>} />
      <Route path="research" element={<AdminLayout><ResearchManagement /></AdminLayout>} />
      <Route path="tests" element={<AdminLayout><TestAssignments /></AdminLayout>} />
      <Route path="conversations" element={<AdminLayout><Conversations /></AdminLayout>} />
      <Route path="conversations/:sessionId" element={<AdminLayout><ConversationDetail /></AdminLayout>} />
      <Route path="emotions" element={<AdminLayout><EmotionAnalytics /></AdminLayout>} />
      <Route path="exports" element={<AdminLayout><Exports /></AdminLayout>} />
      <Route path="config" element={<AdminLayout><ModelConfig /></AdminLayout>} />
      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter basename={import.meta.env.PROD ? '/admin' : '/'}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/*" element={<AdminApp />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
