# CogniSync 前端认证底座 - 企业级架构文档

## 📋 概述

本文档介绍 CogniSync 前端认证底座的企业级架构重构，采用 **features 模块化** 设计，提供可扩展、可维护的认证系统。

---

## 🏗️ 新增目录结构

```
frontend/
├── lib/                              # 基础设施层
│   ├── apiClient.ts                  # 统一 HTTP 请求客户端
│   └── tokenStorage.ts               # Token 存储抽象层
│
├── features/                         # 业务功能模块
│   ├── auth/                         # 认证模块
│   │   ├── types.ts                  # 认证类型定义
│   │   ├── api.ts                    # 认证 API 调用
│   │   ├── authStore.ts              # 认证状态管理
│   │   ├── hooks.ts                  # 认证 Hooks
│   │   └── pages/                    # 认证页面
│   │       └── LoginPage.tsx         # 登录页面
│   │
│   └── onboarding/                   # 入职流程模块（预留）
│       ├── scale/                    # 量表注册
│       └── ai/                       # AI 引导注册
│
├── routes/                           # 路由守卫
│   ├── RequireAuth.tsx               # 要求已认证守卫
│   └── PublicOnly.tsx                # 仅公开路由守卫
│
├── .env                              # 环境变量（不提交到 Git）
└── .env.example                      # 环境变量示例
```

---

## 🔑 核心文件详解

### 1. lib/tokenStorage.ts

**功能：** 抽象 Token 存储层，未来可无缝切换为 httpOnly cookie

**API：**
```typescript
tokenStorage.getToken(): string | null
tokenStorage.setToken(token: string): void
tokenStorage.clearToken(): void
tokenStorage.hasToken(): boolean
```

**特点：**
- MVP 使用 localStorage（key: 'access_token'）
- 封装存储逻辑，业务代码不直接操作 localStorage
- 预留 refresh_token 支持

---

### 2. lib/apiClient.ts

**功能：** 统一 HTTP 请求客户端，自动处理认证、响应格式、错误

**特点：**
- **自动添加 Authorization 头**：从 tokenStorage 读取 token
- **统一响应格式**：`{ success, data, error }`
- **401 自动处理**：清除 token 并触发 `auth:unauthorized` 事件
- **防止重定向死循环**：`isRedirecting` 标志位

**API：**
```typescript
apiClient.get<T>(endpoint, config?)
apiClient.post<T>(endpoint, data?, config?)
apiClient.put<T>(endpoint, data?, config?)
apiClient.patch<T>(endpoint, data?, config?)
apiClient.delete<T>(endpoint, config?)
```

**配置选项：**
```typescript
interface RequestConfig {
  skipAuth?: boolean;         // 跳过自动添加 Authorization
  skipErrorHandling?: boolean; // 跳过统一错误处理
}
```

**使用示例：**
```typescript
// 需要认证的请求
const user = await apiClient.get('/api/auth/me');

// 不需要认证的请求（登录）
const response = await apiClient.post('/api/auth/login', data, { skipAuth: true });
```

---

### 3. features/auth/types.ts

**类型定义：**

```typescript
// 用户信息
interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  hasCompletedOnboarding: boolean;
}

// 用户画像
interface UserProfile {
  cognition: number;
  affect: number;
  behavior: number;
  lastUpdate: string;
}

// 认证状态
type AuthStatus = 'unknown' | 'authed' | 'guest';

interface AuthState {
  status: AuthStatus;
  user: User | null;
  profile: UserProfile | null;
  token: string | null;
}
```

---

### 4. features/auth/api.ts

**认证 API 调用：**

```typescript
// 登录
async function login(data: LoginRequest): Promise<AuthResponse>

// 注册
async function register(data: RegisterRequest): Promise<AuthResponse>

// 获取当前用户
async function getCurrentUser(): Promise<{ user: User; profile: UserProfile }>

// 登出
function logout(): void
```

**特点：**
- 登录/注册成功自动存储 token
- 使用 `apiClient`，无需手动处理 headers

---

### 5. features/auth/authStore.ts

**认证状态管理 Hook：**

```typescript
const {
  authState,      // { status, user, profile, token }
  bootstrap,      // 应用启动时初始化认证状态
  login,          // 登录
  register,       // 注册
  logout,         // 登出
  updateProfile,  // 更新画像
  setAuthData,    // 设置完整认证状态（兼容旧代码）
} = useAuthStore();
```

**bootstrap() 逻辑：**
1. 检查 localStorage 是否有 token
2. 有 token → 调用 `GET /api/auth/me` 验证
3. 验证成功 → 设置 status = 'authed'
4. 验证失败 → 清除 token，设置 status = 'guest'

---

### 6. features/auth/hooks.ts

**认证 Hooks：**

```typescript
// 获取认证状态和方法
const {
  status,         // 'unknown' | 'authed' | 'guest'
  user,           // User | null
  profile,        // UserProfile | null
  token,          // string | null
  isAuthed,       // boolean
  isGuest,        // boolean
  isLoading,      // boolean
  login,
  logout,
  updateProfile,
} = useAuth();

// 要求认证（组件内使用）
useRequireAuth(onUnauthorized);
```

**全局单例模式：**
```typescript
// App.tsx 中初始化
initAuthStore(authStore);

// 其他组件中使用
const auth = useAuth();
```

---

### 7. routes/RequireAuth.tsx

**要求已认证路由守卫：**

```typescript
<RequireAuth onUnauthorized={() => setView('login')}>
  <Dashboard />
</RequireAuth>
```

**逻辑：**
- 未登录 (`status === 'guest'`) → 触发 `onUnauthorized`
- 加载中 (`status === 'unknown'`) → 不渲染
- 已登录 (`status === 'authed'`) → 渲染子组件

---

### 8. routes/PublicOnly.tsx

**仅公开路由守卫：**

```typescript
<PublicOnly onAuthorized={() => setView('dashboard')}>
  <LoginPage />
</PublicOnly>
```

**逻辑：**
- 已登录 (`status === 'authed'`) → 触发 `onAuthorized`
- 未登录或加载中 → 渲染子组件

---

## 🚀 使用流程

### 1. 应用启动（App.tsx）

```typescript
import { useAuthStore, initAuthStore } from './features/auth/authStore';
import { useAuth } from './features/auth/hooks';

function App() {
  // 1. 初始化认证 Store
  const authStore = useAuthStore();

  // 2. 注册全局 Store（单例模式）
  useEffect(() => {
    initAuthStore(authStore);
    authStore.bootstrap(); // 启动时验证 token
  }, []);

  // 3. 监听 401 事件（可选）
  useEffect(() => {
    const handleUnauthorized = () => {
      setCurrentView('login');
    };

    window.addEventListener('auth:unauthorized', handleUnauthorized);

    return () => {
      window.removeEventListener('auth:unauthorized', handleUnauthorized);
    };
  }, []);

  // 4. 根据认证状态渲染
  const auth = useAuth();

  if (auth.isLoading) {
    return <LoadingScreen />;
  }

  if (auth.isGuest) {
    return <PublicRoutes />;
  }

  return <ProtectedRoutes />;
}
```

---

### 2. 登录页面

```typescript
import { LoginPage } from './features/auth/pages/LoginPage';
import { useAuth } from './features/auth/hooks';

function LoginRoute() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleLoginSuccess = async (token, user, profile) => {
    // authStore 已自动处理 token 和状态更新
    navigate('/dashboard');
  };

  return (
    <PublicOnly onAuthorized={() => navigate('/dashboard')}>
      <LoginPage
        language="zh"
        onLoginSuccess={handleLoginSuccess}
        onNavigateToRegister={() => navigate('/register')}
      />
    </PublicOnly>
  );
}
```

---

### 3. 受保护页面

```typescript
function DashboardRoute() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();

  return (
    <RequireAuth onUnauthorized={() => navigate('/login')}>
      <Dashboard user={user} profile={profile} />
    </RequireAuth>
  );
}
```

---

### 4. 组件内使用认证

```typescript
function UserProfile() {
  const { user, isAuthed, logout } = useAuth();

  if (!isAuthed) {
    return <Navigate to="/login" />;
  }

  return (
    <div>
      <h1>Welcome, {user?.name}</h1>
      <button onClick={logout}>Logout</button>
    </div>
  );
}
```

---

## 🔒 安全特性

### 1. 自动 401 处理

```typescript
// apiClient.ts 自动处理
if (response.status === 401) {
  tokenStorage.clearToken();
  window.dispatchEvent(new CustomEvent('auth:unauthorized'));
  throw new ApiError('Unauthorized', 'UNAUTHORIZED', 401);
}
```

### 2. 防止重定向死循环

```typescript
// 全局标志位
let isRedirecting = false;

if (response.status === 401 && !isRedirecting) {
  isRedirecting = true;
  // ... 处理 401
  setTimeout(() => { isRedirecting = false; }, 1000);
}
```

### 3. Token 验证

```typescript
// bootstrap() 启动时验证
const token = tokenStorage.getToken();
if (token) {
  try {
    const { user, profile } = await getCurrentUser();
    // Token 有效
  } catch (error) {
    // Token 无效，清除
    tokenStorage.clearToken();
  }
}
```

---

## 🌐 环境变量

### .env
```bash
VITE_API_BASE_URL=http://localhost:8000
```

### 使用
```typescript
const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
```

### 不同环境

**开发环境 (.env.local):**
```bash
VITE_API_BASE_URL=http://localhost:8000
```

**生产环境 (.env.production):**
```bash
VITE_API_BASE_URL=https://api.cognisync.com
```

---

## 📦 与现有系统兼容

### 兼容 useAppStore

```typescript
// authStore.ts 中的兼容方法
const setAuthData = (user, token, profile) => {
  tokenStorage.setToken(token);
  setAuthState({ status: 'authed', user, profile, token });
};

// 登录成功后同步到全局状态
const { updateProfile } = useAppStore();
authStore.updateProfile(profile); // 新架构
updateProfile(profile);            // 旧架构
```

### 渐进式迁移

**阶段 1（当前）：**
- 保留 views/Login.tsx、views/Register.tsx 等旧组件
- 新增 features/auth/ 模块并存
- App.tsx 可选择使用新或旧架构

**阶段 2（未来）：**
- 逐步迁移所有认证逻辑到 features/auth/
- 删除旧的 services/api.ts 中的认证部分
- 使用 features/onboarding/ 替代 views/RegisterScale.tsx

---

## 🎯 最佳实践

### 1. 状态管理

✅ **推荐：** 使用 features/auth/hooks
```typescript
const { user, login, logout } = useAuth();
```

❌ **避免：** 直接操作 tokenStorage
```typescript
// 不要这样做
localStorage.setItem('access_token', token);
```

### 2. API 调用

✅ **推荐：** 使用 apiClient
```typescript
const data = await apiClient.get('/api/users');
```

❌ **避免：** 直接 fetch
```typescript
// 不要这样做
fetch('/api/users', {
  headers: { Authorization: `Bearer ${token}` }
});
```

### 3. 路由守卫

✅ **推荐：** 使用守卫组件
```typescript
<RequireAuth onUnauthorized={() => navigate('/login')}>
  <Dashboard />
</RequireAuth>
```

❌ **避免：** 组件内判断
```typescript
// 不要这样做
if (!user) return <Navigate to="/login" />;
```

---

## 🔄 未来扩展

### 1. 切换为 httpOnly Cookie

**修改 tokenStorage.ts：**
```typescript
export const tokenStorage = {
  getToken(): string | null {
    // Cookie 会自动发送，返回 null 即可
    return null;
  },
  setToken(token: string): void {
    // 不需要客户端存储
  },
  clearToken(): void {
    // 调用后端 logout API
    fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  },
};
```

**修改 apiClient.ts：**
```typescript
const response = await fetch(url, {
  ...fetchConfig,
  credentials: 'include', // 自动发送 cookie
  headers,
});
```

**业务代码无需改动！**

---

### 2. 添加刷新 Token

**tokenStorage.ts：**
```typescript
getRefreshToken(): string | null
setRefreshToken(token: string): void
```

**apiClient.ts：**
```typescript
if (response.status === 401) {
  const refreshed = await refreshAccessToken();
  if (refreshed) {
    return request(endpoint, config); // 重试原请求
  }
}
```

---

### 3. 添加多租户支持

**types.ts：**
```typescript
interface User {
  // ... 现有字段
  tenantId: string;
  role: 'admin' | 'user';
}
```

**apiClient.ts：**
```typescript
headers['X-Tenant-ID'] = user.tenantId;
```

---

## ✅ 检查清单

- [ ] 环境变量 `.env` 已配置
- [ ] `App.tsx` 中调用 `initAuthStore()` 和 `bootstrap()`
- [ ] 监听 `auth:unauthorized` 事件
- [ ] 所有受保护路由使用 `<RequireAuth>`
- [ ] 公开路由使用 `<PublicOnly>`
- [ ] API 调用统一使用 `apiClient`
- [ ] 认证状态使用 `useAuth()` Hook
- [ ] Token 操作通过 `tokenStorage`

---

## 📞 常见问题

### Q1: 如何调试 401 错误？

**A:** 检查以下几点：
1. `localStorage.getItem('access_token')` 是否有值
2. 后端 `/api/auth/me` 是否返回 401
3. 浏览器 Network 面板查看 `Authorization` 头

### Q2: 刷新页面后需要重新登录？

**A:** 检查 `bootstrap()` 是否在 App 启动时调用：
```typescript
useEffect(() => {
  authStore.bootstrap();
}, []);
```

### Q3: 多个 401 请求导致重复跳转？

**A:** `apiClient.ts` 已内置防重复机制（`isRedirecting` 标志位）。如仍有问题，检查是否有其他地方手动处理 401。

---

## 📄 相关文档

- [前端认证模块使用指南](./README_AUTH.md)
- [API 接口文档](../backend/README.md)
- [部署指南](./DEPLOYMENT_GUIDE.md)

---

**最后更新日期**: 2026-02-12
**版本**: 2.0.0 - 企业级架构
