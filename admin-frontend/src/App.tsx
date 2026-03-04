import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './features/auth/authStore';
import { useRequireAuth } from './features/auth/hooks';
import { AdminLayout } from './components/AdminLayout';
import { Dashboard } from './pages/Dashboard';
import { Users } from './pages/Users';
import { UserDetail } from './pages/UserDetail';
import { Scales } from './pages/Scales';
import { ResearchManagement } from './pages/ResearchManagement';
import { Conversations } from './pages/Conversations';
import { ConversationDetail } from './pages/ConversationDetail';
import { Exports } from './pages/Exports';
import { ModelConfig } from './pages/ModelConfig';
import { Login } from './pages/Login';

/**
 * 所有受保护的 /admin/* 路由容器。
 * - 启动时调用 bootstrap() 尝试从 localStorage 恢复登录状态
 * - useRequireAuth() 在 status='guest' 时自动跳转 /login
 * - status='unknown'（校验中）时显示 loading
 */
function AdminApp() {
  const auth = useRequireAuth();

  useEffect(() => {
    auth.bootstrap();
  }, [auth.bootstrap]);

  // 正在校验 token，等待结果
  if (auth.isLoading) {
    return (
      <div className="flex items-center justify-center h-screen gradient-mesh">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500" />
      </div>
    );
  }

  // 未登录：useRequireAuth 已触发跳转，此处渲染 null 避免闪烁
  if (!auth.isAuthed) return null;

  return (
    <Routes>
      <Route index element={<AdminLayout><Dashboard /></AdminLayout>} />
      <Route path="users" element={<AdminLayout><Users /></AdminLayout>} />
      <Route path="users/:userId" element={<AdminLayout><UserDetail /></AdminLayout>} />
      <Route path="scales" element={<AdminLayout><Scales /></AdminLayout>} />
      <Route path="explorer" element={<AdminLayout><ResearchManagement /></AdminLayout>} />
      <Route path="conversations" element={<AdminLayout><Conversations /></AdminLayout>} />
      <Route path="conversations/:sessionId" element={<AdminLayout><ConversationDetail /></AdminLayout>} />
      <Route path="exports" element={<AdminLayout><Exports /></AdminLayout>} />
      <Route path="config" element={<AdminLayout><ModelConfig /></AdminLayout>} />
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/admin/*" element={<AdminApp />} />
          <Route path="/" element={<Navigate to="/admin" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
