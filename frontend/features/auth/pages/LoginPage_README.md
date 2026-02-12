# LoginPage.tsx - 使用说明

## 📋 概述

LoginPage 是企业级登录页面组件，完全复用 CogniSync 现有系统 UI 风格，提供完整的表单验证、错误处理和响应式布局。

---

## 🎨 UI 设计特点

### 1. 布局结构

**桌面端（≥1024px）：**
```
┌──────────────────────────────────────────────────────────┐
│                    gradient-mesh 背景                     │
│  ┌────────────────────┐    ┌────────────────────┐       │
│  │  左侧：系统简介     │    │  右侧：登录表单     │       │
│  │  - Logo + 标题     │    │  - Logo            │       │
│  │  - 3个功能特性     │    │  - Email           │       │
│  │  - 编号标签        │    │  - Password        │       │
│  │  glass-card 效果   │    │  - 登录按钮        │       │
│  │                    │    │  - 注册链接        │       │
│  └────────────────────┘    └────────────────────┘       │
└──────────────────────────────────────────────────────────┘
```

**移动端（<1024px）：**
```
┌──────────────────────────────┐
│   gradient-mesh 背景          │
│   ┌──────────────────────┐   │
│   │  登录表单（居中）     │   │
│   │  - Logo              │   │
│   │  - Email             │   │
│   │  - Password          │   │
│   │  - 登录按钮          │   │
│   │  - 注册链接          │   │
│   └──────────────────────┘   │
│   简短说明文本               │
└──────────────────────────────┘
```

---

## 🧩 复用的现有组件

### 1. Button 组件

**路径：** `components/Button.tsx`

**使用：**
```tsx
<Button
  type="submit"
  variant="primary"      // 蓝色渐变主按钮
  size="lg"              // 大尺寸
  isLoading={isLoading}  // 加载状态（显示spinner）
  disabled={isLoading}
  className="w-full"
>
  <Mail className="w-5 h-5 mr-2" />
  {isLoading ? t.loggingIn : t.loginButton}
</Button>
```

**复用特性：**
- ✅ 渐变背景（`from-blue-500 to-indigo-600`）
- ✅ Loading spinner 动画
- ✅ Hover 阴影效果
- ✅ Disabled 状态样式

---

### 2. Input 组件

**路径：** `components/Input.tsx`

**使用：**
```tsx
<Input
  type="email"
  label={t.email}
  placeholder={t.emailPlaceholder}
  value={email}
  onChange={(e) => setEmail(e.target.value)}
  onBlur={handleEmailBlur}        // 失焦验证
  disabled={isLoading}
  error={formErrors.email}        // 错误提示
  autoComplete="email"
  required
/>
```

**复用特性：**
- ✅ Label + Input 组合
- ✅ Error 提示（红色边框 + 错误图标）
- ✅ Placeholder 样式
- ✅ Focus ring 效果
- ✅ Disabled 状态

---

### 3. Lucide Icons

**路径：** `lucide-react`

**使用的图标：**
- `LogIn` - 登录图标
- `Mail` - 邮件图标
- `Lock` - 锁图标
- `AlertCircle` - 警告图标
- `Sparkles` - 特色图标（系统简介）

---

### 4. CSS 类名

**完全复用现有系统的 CSS 变量和类：**

| 类名 | 用途 | 位置 |
|------|------|------|
| `.gradient-mesh` | 渐变网格背景 | `index.css` |
| `.glass-card` | 玻璃态卡片 | `index.css` |
| `.text-gradient` | 渐变文字 | `index.css` |
| `.animate-scale-in` | 缩放进场动画 | `index.css` |
| `.animate-slide-in-left` | 左侧滑入动画 | `index.css` |
| `.animate-fade-in` | 淡入动画 | `index.css` |
| `.animate-float` | 浮动动画 | `index.css` |

---

### 5. Translations

**路径：** `utils/translations.ts`

**使用的翻译键：**
```typescript
t.loginTitle        // "登录 CogniSync" / "Login to CogniSync"
t.loginDesc         // "欢迎回来！请登录您的账户" / "Welcome back! Please login..."
t.email             // "邮箱地址" / "Email Address"
t.emailPlaceholder  // "your@email.com"
t.password          // "密码" / "Password"
t.passwordPlaceholder // "输入密码" / "Enter password"
t.loginButton       // "登录" / "Login"
t.loggingIn         // "登录中..." / "Logging in..."
t.loginError        // "登录失败" / "Login failed"
t.noAccount         // "还没有账户？" / "Don't have an account?"
t.signUp            // "注册" / "Sign up"
```

---

## ✅ 表单验证

### 1. 前端验证规则

**Email 验证：**
```typescript
// 必填
if (!email) {
  return '请输入邮箱地址' / 'Email is required';
}

// 格式验证
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
if (!emailRegex.test(email)) {
  return '邮箱格式不正确' / 'Invalid email format';
}
```

**Password 验证：**
```typescript
// 必填
if (!password) {
  return '请输入密码' / 'Password is required';
}

// 最小长度
if (password.length < 6) {
  return '密码至少需要6个字符' / 'Password must be at least 6 characters';
}
```

### 2. 验证时机

| 时机 | 触发 |
|------|------|
| **实时验证** | 失焦时（onBlur） |
| **提交验证** | 点击登录按钮时 |
| **错误清除** | 用户修改输入时自动清除 |

---

## 🚨 错误处理

### 1. API 错误展示

```tsx
{apiError && (
  <div className="bg-red-50 dark:bg-red-900/20 border ...">
    <AlertCircle />
    <div>
      <p>登录失败 / Login Failed</p>
      <p>{apiError}</p>
    </div>
  </div>
)}
```

### 2. 错误码处理

```typescript
// 特定错误码友好提示
if (err.code === 'INVALID_CREDENTIALS') {
  setApiError('邮箱或密码错误' / 'Invalid email or password');
}

if (err.code === 'NETWORK_ERROR') {
  setApiError('网络连接失败，请检查网络' / 'Network error...');
}
```

### 3. 字段级错误

```tsx
<Input
  error={formErrors.email}  // 显示在输入框下方
/>
```

---

## 🎯 使用示例

### 基础使用

```tsx
import { LoginPage } from './features/auth/pages/LoginPage';

function App() {
  const handleLoginSuccess = () => {
    // 登录成功，跳转到 Dashboard
    navigate('/dashboard');
  };

  const handleNavigateToRegister = () => {
    // 跳转到注册页
    navigate('/register');
  };

  return (
    <LoginPage
      language="zh"
      onLoginSuccess={handleLoginSuccess}
      onNavigateToRegister={handleNavigateToRegister}
    />
  );
}
```

### 配合路由守卫

```tsx
import { PublicOnly } from './routes/PublicOnly';
import { LoginPage } from './features/auth/pages/LoginPage';

function LoginRoute() {
  const navigate = useNavigate();

  return (
    <PublicOnly onAuthorized={() => navigate('/dashboard')}>
      <LoginPage
        language="zh"
        onLoginSuccess={() => navigate('/dashboard')}
        onNavigateToRegister={() => navigate('/register')}
      />
    </PublicOnly>
  );
}
```

---

## 📱 响应式设计

### 桌面端（≥1024px）

- ✅ 左侧显示系统简介（3个功能特性）
- ✅ 右侧登录表单
- ✅ 最大宽度 6xl（1152px）
- ✅ 两列布局，间距 3rem

### 移动端（<1024px）

- ✅ 隐藏左侧简介
- ✅ 仅显示登录表单
- ✅ 最大宽度 md（448px）
- ✅ 底部显示简短说明

---

## 🎨 视觉效果

### 1. 动画

| 元素 | 动画 | 效果 |
|------|------|------|
| 左侧简介 | `animate-slide-in-left` | 从左侧滑入 |
| 登录表单 | `animate-scale-in` | 缩放进场 |
| Logo 图标 | `animate-float` | 浮动效果 |
| 错误提示 | `animate-fade-in` | 淡入 |

### 2. 颜色系统

**功能特性编号标签：**
- 01: 蓝色 (`bg-blue-100 dark:bg-blue-900/30`)
- 02: 紫色 (`bg-purple-100 dark:bg-purple-900/30`)
- 03: 绿色 (`bg-green-100 dark:bg-green-900/30`)

**按钮渐变：**
- Primary: `from-blue-500 to-indigo-600`

**错误提示：**
- 背景: `bg-red-50 dark:bg-red-900/20`
- 边框: `border-red-200 dark:border-red-800`
- 文字: `text-red-600 dark:text-red-400`

---

## 🔒 安全特性

### 1. 自动补全

```tsx
<Input autoComplete="email" />      // 邮箱自动补全
<Input autoComplete="current-password" />  // 密码自动补全
```

### 2. 防止双重提交

```tsx
disabled={isLoading}  // Loading 时禁用按钮和输入框
```

### 3. 错误自动清除

```tsx
useEffect(() => {
  if (apiError) {
    setApiError(null);  // 用户修改输入时清除 API 错误
  }
}, [email, password]);
```

---

## 🌐 国际化

### 翻译文件位置

`utils/translations.ts`

### 扩展新语言

```typescript
export const translations = {
  zh: { /* 中文 */ },
  en: { /* 英文 */ },
  ja: { /* 日文（新增） */
    loginTitle: "CogniSyncにログイン",
    loginDesc: "お帰りなさい！アカウントにログインしてください",
    // ...
  }
};
```

---

## ✅ 样式一致性检查清单

- [x] 使用 `gradient-mesh` 背景
- [x] 使用 `glass-card` 玻璃态效果
- [x] 使用现有 `Button` 组件
- [x] 使用现有 `Input` 组件
- [x] 使用 `Lucide` 图标库
- [x] 使用 `translations` 国际化
- [x] 使用现有动画类名
- [x] 使用现有颜色渐变
- [x] 支持深色模式
- [x] 响应式布局

---

## 🔧 定制建议

### 1. 修改布局

**隐藏左侧简介：**
```tsx
// 删除或注释 hidden lg:flex 部分
<div className="hidden lg:flex ...">
  {/* 系统简介 */}
</div>
```

**调整宽度：**
```tsx
// 修改 max-w-6xl 为其他尺寸
<div className="w-full max-w-4xl flex ...">
```

### 2. 添加社交登录

```tsx
{/* 在登录按钮下方添加 */}
<div className="relative">
  <div className="absolute inset-0 flex items-center">
    <div className="w-full border-t border-gray-300"></div>
  </div>
  <div className="relative flex justify-center text-sm">
    <span className="px-2 bg-white text-gray-500">或</span>
  </div>
</div>

<Button variant="outline" className="w-full">
  <Github className="w-5 h-5 mr-2" />
  使用 GitHub 登录
</Button>
```

### 3. 添加记住我选项

```tsx
<div className="flex items-center justify-between">
  <label className="flex items-center">
    <input type="checkbox" className="..." />
    <span className="ml-2 text-sm">记住我</span>
  </label>
  <a href="/forgot-password">忘记密码？</a>
</div>
```

---

## 📞 常见问题

### Q1: 如何修改密码最小长度？

**A:** 修改 `validatePassword` 函数：
```typescript
if (password.length < 8) {  // 改为 8
  return '密码至少需要8个字符';
}
```

### Q2: 如何添加验证码？

**A:** 在表单中添加验证码输入框：
```tsx
<Input
  label="验证码"
  value={captcha}
  onChange={(e) => setCaptcha(e.target.value)}
/>
```

### Q3: 如何自定义错误提示样式？

**A:** 修改错误提示的 className：
```tsx
<div className="bg-red-50 ...">  // 修改颜色
```

---

**最后更新**: 2026-02-12
**版本**: 1.0.0
