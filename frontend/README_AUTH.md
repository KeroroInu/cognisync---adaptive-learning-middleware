# CogniSync 登录注册模块 - 使用指南

## 📋 概述

本文档介绍 CogniSync 前端系统的登录注册模块实现。该模块支持用户认证和两种注册方式（量表注册 + AI引导注册），完全融入现有系统风格。

---

## 🎯 功能特性

### 1. 用户认证
- ✅ 邮箱密码登录
- ✅ Token 自动存储和恢复
- ✅ 登出功能
- ✅ 路由守卫（未登录自动跳转）

### 2. 注册方式

#### A. 量表注册（Scale-based Registration）
- 完成标准化 Likert 量表问卷
- 每题 1-5 分五级评分
- 自动计算初始学习画像
- 预计耗时：5-10 分钟

#### B. AI 引导注册（AI-Guided Registration）
- 与 AI 自然对话
- 个性化问题探索
- 生成更丰富的初始画像
- 预计耗时：10-15 分钟

---

## 📁 文件结构

### 新增文件清单

```
frontend/
├── types.ts                      # [修改] 新增认证相关类型
├── constants.ts                  # [修改] 添加 user/token 初始状态
├── services/
│   ├── api.ts                   # [修改] 新增认证和注册 API
│   └── store.ts                 # [修改] 新增认证状态管理
├── utils/
│   └── translations.ts          # [修改] 新增登录注册翻译
├── components/
│   ├── Layout.tsx               # [修改] 添加登出按钮
│   ├── Button.tsx               # [新增] 统一按钮组件
│   ├── Input.tsx                # [新增] 统一输入框组件
│   └── Modal.tsx                # [新增] 模态框组件
├── views/
│   ├── Login.tsx                # [新增] 登录页面
│   ├── Register.tsx             # [新增] 注册模式选择
│   ├── RegisterScale.tsx        # [新增] 量表注册
│   └── RegisterAI.tsx           # [新增] AI引导注册
└── App.tsx                      # [修改] 路由和守卫逻辑
```

---

## 🚀 本地运行步骤

### 前置条件
确保后端 API 已启动并运行在 `http://localhost:8000`

### 1. 安装依赖（如已安装可跳过）
```bash
cd frontend
npm install
```

### 2. 启动前端开发服务器
```bash
npm run dev
```

访问：`http://localhost:3000`

---

## 🔐 API 接口对接

### 认证接口

#### 1. 登录
```typescript
POST /api/auth/login
Request: { email: string, password: string }
Response: {
  success: boolean,
  data?: {
    token: string,
    user: User,
    initialProfile?: UserProfile
  },
  error?: { code: string, message: string }
}
```

#### 2. 注册
```typescript
POST /api/auth/register
Request: {
  email: string,
  password: string,
  name: string,
  mode: 'scale' | 'ai'
}
Response: { token, user }
```

#### 3. 获取当前用户
```typescript
GET /api/auth/me
Headers: { Authorization: `Bearer ${token}` }
Response: { user: User, profile: UserProfile }
```

### 量表注册接口

#### 1. 获取激活量表
```typescript
GET /api/forms/active
Response: {
  success: boolean,
  data?: {
    template: {
      id: string,
      name: string,
      description: string,
      questions: Array<{
        id: string,
        text: string,
        dimension: 'Cognition' | 'Affect' | 'Behavior'
      }>
    }
  }
}
```

#### 2. 提交量表答案
```typescript
POST /api/forms/{id}/submit
Headers: { Authorization: `Bearer ${token}` }
Request: {
  answers: Array<{
    questionId: string,
    value: number  // 1-5
  }>
}
Response: {
  scores: { cognition: number, affect: number, behavior: number },
  initialProfile: UserProfile
}
```

### AI 引导注册接口

#### 1. 开始会话
```typescript
POST /api/onboarding/ai/start
Headers: { Authorization: `Bearer ${token}` }
Response: {
  sessionId: string,
  question: string,
  summary: string
}
```

#### 2. 回答问题
```typescript
POST /api/onboarding/ai/step
Headers: { Authorization: `Bearer ${token}` }
Request: { sessionId: string, answer: string }
Response: {
  sessionId: string,
  question?: string,
  summary: string,
  draftProfile?: Partial<UserProfile>,
  isComplete: boolean
}
```

#### 3. 完成注册
```typescript
POST /api/onboarding/ai/finish
Headers: { Authorization: `Bearer ${token}` }
Request: { sessionId: string }
Response: {
  initialProfile: UserProfile,
  attributes: string[],
  conceptSeeds: string[]
}
```

---

## 🎨 UI 组件库

### Button 组件
```typescript
import { Button } from './components/Button';

<Button variant="primary" size="lg" isLoading={false}>
  登录
</Button>

// Variants: 'primary' | 'secondary' | 'outline' | 'ghost'
// Sizes: 'sm' | 'md' | 'lg'
```

### Input 组件
```typescript
import { Input } from './components/Input';

<Input
  label="邮箱地址"
  type="email"
  placeholder="your@email.com"
  value={email}
  onChange={(e) => setEmail(e.target.value)}
  error={errorMessage}
/>
```

### Modal 组件
```typescript
import { Modal } from './components/Modal';

<Modal isOpen={true} onClose={() => {}} title="标题">
  <p>模态框内容</p>
</Modal>

// Sizes: 'sm' | 'md' | 'lg' | 'xl'
```

---

## 🛡️ 路由守卫机制

### 工作原理
1. App.tsx 监听 `state.user` 状态
2. 未登录时自动跳转到登录页
3. 登录成功后自动跳转到 Dashboard
4. Token 自动存储在 localStorage
5. 刷新页面自动恢复登录状态

### 代码示例
```typescript
// App.tsx 中的路由守卫逻辑
useEffect(() => {
  if (!state.user && !['login', 'register', 'register-scale', 'register-ai'].includes(currentView)) {
    setCurrentView('login');
  }
}, [state.user, currentView]);
```

---

## 🌐 国际化支持

### 翻译键
所有新增的翻译键位于 `utils/translations.ts`：

```typescript
// 中文（zh）
login: "登录"
loginTitle: "登录 CogniSync"
email: "邮箱地址"
password: "密码"
register: "注册"
chooseOnboardingMode: "选择注册方式"
scaleMode: "量表注册"
aiMode: "AI引导注册"
logout: "登出"
...

// 英文（en）
login: "Login"
loginTitle: "Login to CogniSync"
email: "Email Address"
password: "Password"
register: "Register"
chooseOnboardingMode: "Choose Onboarding Mode"
scaleMode: "Scale-based Registration"
aiMode: "AI-Guided Registration"
logout: "Logout"
...
```

---

## 🔄 状态管理

### useAppStore Hook
新增的认证相关方法：

```typescript
const {
  state,              // AppState
  setAuth,            // 设置认证信息
  clearAuth,          // 清除认证信息
  setUser,            // 设置用户
  setToken,           // 设置 token
  updateProfile       // 更新画像
} = useAppStore();

// 使用示例
setAuth(user, token, profile);  // 登录成功
clearAuth();                     // 登出
```

### AppState 结构
```typescript
interface AppState {
  // 原有状态
  profile: UserProfile;
  nodes: Node[];
  edges: Edge[];
  messages: ChatMessage[];
  logs: CalibrationLog[];
  isResearchMode: boolean;
  language: Language;

  // 新增认证状态
  user: User | null;
  token: string | null;
}
```

---

## 🎯 用户流程

### 登录流程
```
1. 访问系统 → 自动跳转登录页
2. 输入邮箱密码 → 点击登录
3. API 返回 token 和 user
4. 自动存储 token 到 localStorage
5. 跳转到 Dashboard
```

### 注册流程 A：量表注册
```
1. 点击"注册" → 选择"量表注册"
2. 获取量表模板（API: /api/forms/active）
3. 逐题回答（1-5分）
4. 提交答案（API: /api/forms/{id}/submit）
5. 获取初始画像
6. 自动跳转到 Dashboard
```

### 注册流程 B：AI 引导注册
```
1. 点击"注册" → 选择"AI引导注册"
2. 开始会话（API: /api/onboarding/ai/start）
3. 回答 AI 提出的问题
4. AI 动态生成下一个问题
5. 显示草稿画像（实时更新）
6. 点击"完成注册"
7. 提交最终结果（API: /api/onboarding/ai/finish）
8. 获取初始画像和概念种子
9. 自动跳转到 Dashboard
```

---

## 🐛 常见问题

### Q1: 刷新页面后需要重新登录？
**A:** 检查 `localStorage` 是否正确存储了 token。正常情况下，token 会在 `useAppStore` 初始化时自动恢复。

### Q2: 登录后立即跳转到登录页？
**A:** 检查后端 `/api/auth/me` 接口是否正常返回用户信息。如果 token 无效，会自动清除并跳转到登录页。

### Q3: 量表注册时没有问题？
**A:** 检查后端 `/api/forms/active` 接口是否返回了有效的量表模板。

### Q4: AI 引导注册卡住不动？
**A:** 检查后端 `/api/onboarding/ai/step` 接口响应。确保 `isComplete` 字段正确返回。

---

## 🎨 样式一致性

### 设计原则
1. **玻璃态效果**：所有卡片使用 `.glass-card` 类
2. **渐变背景**：按钮和图标使用渐变色
3. **动画**：使用现有的动画类（`animate-fade-in`、`animate-scale-in`）
4. **颜色系统**：
   - Cognition: 蓝色系（from-blue-500 to-cyan-600）
   - Affect: 紫色系（from-purple-500 to-pink-600）
   - Behavior: 绿色系（from-green-500 to-emerald-600）
5. **深色模式**：所有组件支持 `theme` prop

### Tailwind 类名示例
```css
/* 玻璃卡片 */
.glass-card

/* 渐变文字 */
.text-gradient

/* 渐变背景 */
.gradient-mesh

/* 动画 */
.animate-fade-in
.animate-scale-in
.animate-slide-in-left
.animate-slide-in-right
```

---

## 📦 依赖说明

### 核心依赖
- **React 19.2.3**: 前端框架
- **TypeScript ~5.8.2**: 类型安全
- **Vite 6.2.0**: 构建工具
- **Tailwind CSS**: 样式（CDN）
- **Lucide React 0.562.0**: 图标库

### 无需额外安装
所有依赖已在现有 `package.json` 中，无需额外安装。

---

## 🔧 开发建议

### 1. 添加新的认证功能
在 `services/api.ts` 中添加新的 API 函数：
```typescript
export async function newAuthFunction(data: any): Promise<any> {
  const response = await fetch(`${API_BASE_URL}/api/auth/new`, {
    method: 'POST',
    headers: getHeaders(true),  // 包含 token
    body: JSON.stringify(data),
  });
  // 处理响应...
}
```

### 2. 扩展用户状态
在 `types.ts` 中修改 `User` 接口：
```typescript
export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  hasCompletedOnboarding: boolean;
  // 添加新字段
  avatarUrl?: string;
  role?: 'student' | 'teacher' | 'admin';
}
```

### 3. 添加新的注册方式
1. 在 `views/` 中创建新组件
2. 在 `Register.tsx` 中添加新的模式选项
3. 在 `App.tsx` 中添加路由逻辑

---

## ✅ 测试检查清单

- [ ] 登录功能正常
- [ ] 注册功能正常（量表模式）
- [ ] 注册功能正常（AI模式）
- [ ] 登出功能正常
- [ ] 刷新页面后登录状态保持
- [ ] 未登录时访问功能页面自动跳转
- [ ] 中英双语切换正常
- [ ] 深色模式切换正常
- [ ] 所有表单验证生效
- [ ] 错误提示正确显示

---

## 📞 技术支持

如有问题，请检查：
1. 浏览器控制台错误
2. Network 面板查看 API 响应
3. localStorage 中的 token
4. 后端 API 是否正常运行

---

## 📄 许可证

本项目遵循 MIT 许可证。

---

**最后更新日期**: 2026-02-12
**版本**: 1.0.0
