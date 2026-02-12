# 认证模块 (Authentication Module)

完整的用户认证解决方案，提供登录、注册、用户状态管理等功能。

## 文件结构

```
features/auth/
├── types.ts          # TypeScript 类型定义
├── api.ts            # API 调用函数
├── authStore.ts      # 认证状态管理（React Context）
├── hooks.ts          # 认证相关 hooks
├── index.ts          # 统一导出
└── README.md         # 使用文档
```

## 安装与设置

### 1. 包装应用

在应用的根组件中使用 `AuthProvider` 包装：

```typescript
// main.tsx 或 App.tsx
import { AuthProvider } from './features/auth';

function App() {
  return (
    <AuthProvider>
      {/* 你的应用组件 */}
      <YourApp />
    </AuthProvider>
  );
}
```

### 2. 初始化认证状态

在应用启动时调用 `bootstrap()` 方法来检查用户是否已登录：

```typescript
import { useAuth } from './features/auth';
import { useEffect } from 'react';

function App() {
  const { bootstrap } = useAuth();

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  return <YourApp />;
}
```

## 使用方法

### 基本认证 Hook

```typescript
import { useAuth } from './features/auth';

function MyComponent() {
  const {
    status,      // 'unknown' | 'authed' | 'guest'
    user,        // 当前用户信息
    profile,     // 用户 profile
    token,       // 认证 token
    isAuthed,    // 是否已认证
    isGuest,     // 是否是访客
    isLoading,   // 是否正在加载
    login,       // 登录函数
    logout,      // 登出函数
    bootstrap,   // 初始化函数
  } = useAuth();

  return (
    <div>
      {isAuthed ? (
        <p>Welcome, {user?.name}!</p>
      ) : (
        <p>Please login</p>
      )}
    </div>
  );
}
```

### 登录

```typescript
import { useAuth } from './features/auth';

function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login({ email, password });
      // 登录成功，会自动更新状态
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Login failed');
    }
  };

  return (
    <form onSubmit={handleLogin}>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button type="submit">Login</button>
      {error && <p>{error}</p>}
    </form>
  );
}
```

### 注册

```typescript
import { register } from './features/auth/api';

async function handleRegister() {
  try {
    const response = await register({
      email: 'user@example.com',
      password: 'password123',
      name: 'John Doe',
      mode: 'scale', // 或 'ai'
    });

    // 注册成功后手动登录
    await login({
      email: 'user@example.com',
      password: 'password123'
    });
  } catch (error) {
    console.error('Registration failed:', error);
  }
}
```

### 需要登录的页面

使用 `useRequireAuth` hook 自动重定向未登录用户：

```typescript
import { useRequireAuth } from './features/auth';

function ProtectedPage() {
  const auth = useRequireAuth(); // 未登录会自动跳转到登录页

  if (auth.isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div>
      <h1>Protected Content</h1>
      <p>Welcome, {auth.user?.name}!</p>
    </div>
  );
}
```

### 登出

```typescript
import { useAuth } from './features/auth';

function LogoutButton() {
  const { logout } = useAuth();

  const handleLogout = () => {
    logout();
    // 状态会自动清除，可以导航到登录页
    navigate('/login');
  };

  return <button onClick={handleLogout}>Logout</button>;
}
```

## 与现有系统集成

### Profile 更新回调

如果你的应用中有其他模块需要监听 profile 更新（比如全局状态管理），可以注册回调：

```typescript
import { registerProfileUpdateCallback } from './features/auth';

// 在应用初始化时
registerProfileUpdateCallback((profile) => {
  console.log('Profile updated:', profile);
  // 触发其他状态更新
  updateGlobalProfile(profile);
});
```

### 手动更新 Profile

```typescript
import { updateProfile } from './features/auth';

// 当 profile 在其他地方更新时
updateProfile({
  cognition: 0.8,
  affect: 0.6,
  behavior: 0.7,
  lastUpdate: new Date().toISOString(),
});
```

## API 端点

认证模块依赖以下后端 API 端点：

- `POST /api/auth/login` - 用户登录
- `POST /api/auth/register` - 用户注册
- `GET /api/auth/me` - 获取当前用户信息

### API 响应格式

所有 API 返回统一格式：

```typescript
{
  success: boolean;
  data: T;
  error?: {
    code: string;
    message: string;
  };
}
```

## 类型定义

### User

```typescript
interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  hasCompletedOnboarding: boolean;
}
```

### UserProfile

```typescript
interface UserProfile {
  cognition: number;   // 0-1
  affect: number;      // 0-1
  behavior: number;    // 0-1
  lastUpdate: string;  // ISO 8601
}
```

### AuthResponse

```typescript
interface AuthResponse {
  token: string;
  user: User;
  initialProfile?: UserProfile;
}
```

## 高级用法

### 直接使用 API 函数

如果不需要自动状态管理，可以直接使用 API 函数：

```typescript
import { login, logout, getCurrentUser } from './features/auth/api';

// 登录
const response = await login({ email, password });

// 获取当前用户
const { user, profile } = await getCurrentUser();

// 登出
logout();
```

### 自定义 Token 存储

默认使用 localStorage，可以修改 `lib/apiClient.ts` 来使用其他存储方式：

```typescript
// 例如使用 sessionStorage
sessionStorage.setItem('auth_token', token);
```

## 故障排查

### 1. "useAuthContext must be used within AuthProvider"

确保你的组件被 `<AuthProvider>` 包装。

### 2. Token 无效或过期

`bootstrap()` 会自动检测无效 token 并清除状态。

### 3. API 请求失败

检查：
- 后端服务是否运行
- `VITE_API_URL` 环境变量是否正确配置
- 网络连接是否正常

## 环境变量

在 `.env` 文件中配置：

```bash
VITE_API_URL=http://localhost:8000
```

## 最佳实践

1. **总是使用 `useAuth` hook** - 不要直接导入 Context
2. **在应用启动时调用 `bootstrap()`** - 确保用户状态正确初始化
3. **使用 `useRequireAuth` 保护需要登录的页面** - 自动处理重定向
4. **错误处理** - 总是捕获 login/register 的异常
5. **Token 管理** - 让模块自动处理，不要手动操作 localStorage

## 示例：完整的应用设置

```typescript
// main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from './features/auth';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>
);

// App.tsx
import { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useAuth } from './features/auth';
import LoginPage from './pages/LoginPage';
import Dashboard from './pages/Dashboard';

function App() {
  const { bootstrap, isLoading } = useAuth();

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/dashboard" element={<Dashboard />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
```
