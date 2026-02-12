/**
 * 认证模块使用示例
 *
 * 这个文件展示如何在实际应用中使用认证模块
 */

// ============ 1. 在应用根组件中设置 AuthProvider ============

// main.tsx 或 App.tsx
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from './features/auth';
import App from './App';

function Root() {
  return (
    <StrictMode>
      <AuthProvider>
        <BrowserRouter>
          <AppWithAuth />
        </BrowserRouter>
      </AuthProvider>
    </StrictMode>
  );
}

// ============ 2. 在应用启动时初始化认证状态 ============

function AppWithAuth() {
  const { bootstrap, isLoading } = useAuth();

  useEffect(() => {
    // 应用启动时检查是否有有效的登录状态
    bootstrap();
  }, [bootstrap]);

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return <App />;
}

// ============ 3. 登录页面示例 ============

import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from './features/auth';

function LoginPage() {
  const { login, isAuthed } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // 如果已登录，重定向
  useEffect(() => {
    if (isAuthed) {
      const redirect = searchParams.get('redirect') || '/dashboard';
      navigate(redirect);
    }
  }, [isAuthed, navigate, searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login({ email, password });
      // 登录成功，状态会自动更新，上面的 useEffect 会处理重定向
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <h1>Login</h1>
      <form onSubmit={handleSubmit}>
        <div>
          <label>Email:</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <label>Password:</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? 'Logging in...' : 'Login'}
        </button>
      </form>
    </div>
  );
}

// ============ 4. 注册页面示例 ============

import { register } from './features/auth/api';

function RegisterPage() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    email: '',
    password: '',
    name: '',
    mode: 'scale' as 'scale' | 'ai',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // 注册
      await register(formData);

      // 注册成功后自动登录
      await login({
        email: formData.email,
        password: formData.password,
      });

      // 登录成功后跳转
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="register-page">
      <h1>Register</h1>
      <form onSubmit={handleSubmit}>
        <div>
          <label>Name:</label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            required
          />
        </div>
        <div>
          <label>Email:</label>
          <input
            type="email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            required
          />
        </div>
        <div>
          <label>Password:</label>
          <input
            type="password"
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            required
          />
        </div>
        <div>
          <label>Mode:</label>
          <select
            value={formData.mode}
            onChange={(e) => setFormData({ ...formData, mode: e.target.value as 'scale' | 'ai' })}
          >
            <option value="scale">Scale</option>
            <option value="ai">AI</option>
          </select>
        </div>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? 'Registering...' : 'Register'}
        </button>
      </form>
    </div>
  );
}

// ============ 5. 需要登录的页面 ============

import { useRequireAuth } from './features/auth';

function DashboardPage() {
  // 使用 useRequireAuth 自动保护页面
  const { user, profile, logout } = useRequireAuth();

  // 如果未登录，会自动重定向到登录页
  // 这里的代码只会在已登录状态下执行

  return (
    <div className="dashboard">
      <h1>Dashboard</h1>
      <div className="user-info">
        <p>Welcome, {user?.name}!</p>
        <p>Email: {user?.email}</p>
        {profile && (
          <div className="profile">
            <h2>Your Profile</h2>
            <p>Cognition: {profile.cognition}</p>
            <p>Affect: {profile.affect}</p>
            <p>Behavior: {profile.behavior}</p>
            <p>Last Updated: {new Date(profile.lastUpdate).toLocaleString()}</p>
          </div>
        )}
        <button onClick={logout}>Logout</button>
      </div>
    </div>
  );
}

// ============ 6. 可选登录的页面（显示不同内容） ============

function HomePage() {
  const { isAuthed, user } = useAuth();

  return (
    <div className="home">
      <h1>Welcome to CogniSync</h1>
      {isAuthed ? (
        <div>
          <p>Hello, {user?.name}!</p>
          <a href="/dashboard">Go to Dashboard</a>
        </div>
      ) : (
        <div>
          <p>Please login to continue</p>
          <a href="/login">Login</a>
          <a href="/register">Register</a>
        </div>
      )}
    </div>
  );
}

// ============ 7. 导航栏组件 ============

function Navbar() {
  const { isAuthed, user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <nav>
      <a href="/">Home</a>
      {isAuthed ? (
        <>
          <a href="/dashboard">Dashboard</a>
          <span>Hi, {user?.name}</span>
          <button onClick={handleLogout}>Logout</button>
        </>
      ) : (
        <>
          <a href="/login">Login</a>
          <a href="/register">Register</a>
        </>
      )}
    </nav>
  );
}

// ============ 8. 与全局状态集成 ============

import { registerProfileUpdateCallback } from './features/auth';

// 在应用初始化时注册 profile 更新回调
function setupProfileSync() {
  registerProfileUpdateCallback((profile) => {
    console.log('Profile updated:', profile);

    // 例如：更新到其他状态管理系统
    // globalStore.updateProfile(profile);

    // 例如：发送分析事件
    // analytics.track('profile_updated', profile);

    // 例如：更新 UI
    // updateUIWithNewProfile(profile);
  });
}

// 在 main.tsx 或 App.tsx 中调用
setupProfileSync();

// ============ 9. 手动更新 Profile ============

import { updateProfile } from './features/auth';

function SomeComponent() {
  const handleUpdateProfile = async () => {
    // 从 API 获取新的 profile
    const newProfile = await fetchProfileFromAPI();

    // 更新到认证状态
    updateProfile(newProfile);

    // 这会触发所有监听的回调
  };

  return <button onClick={handleUpdateProfile}>Refresh Profile</button>;
}

// ============ 10. 完整的 App 路由示例 ============

import { Routes, Route, Navigate } from 'react-router-dom';

function App() {
  const { isAuthed, isLoading } = useAuth();

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="app">
      <Navbar />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />

        {/* 重定向未登录用户 */}
        <Route
          path="/protected"
          element={
            isAuthed ? <ProtectedPage /> : <Navigate to="/login" />
          }
        />
      </Routes>
    </div>
  );
}

export default App;
