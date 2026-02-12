# AI Onboarding - AI 引导注册流程

## 📋 概述

AI 引导注册流程通过自然对话方式深入了解用户的学习特征，生成个性化的初始三维学习画像，并收集细粒度的用户属性和概念种子，为后续知识图谱构建提供基础。

---

## 🏗️ 目录结构

```
frontend/features/onboarding/ai/
├── types.ts                        # 类型定义
├── api.ts                          # API 调用
├── AiOnboardingPage.tsx            # 主页面组件
└── components/
    ├── ChatBubble.tsx              # 聊天气泡组件（复用 Chat.tsx 样式）
    ├── SummaryPanel.tsx            # 已确认信息面板
    └── OnboardingStepper.tsx       # 步骤指示器
```

---

## 🔄 完整流程

```
┌─────────────────────────────────────────────────────────┐
│                  用户进入 /register/ai                   │
└───────────────────┬─────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────┐
│              自动调用 start                              │
│  POST /api/onboarding/ai/start                          │
│    ↓                                                    │
│  返回: { sessionId, question, summary }                 │
└───────────────────┬─────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────┐
│              显示第一个问题                              │
│  - AI 消息气泡：question                                │
│  - 右侧面板：summary（初始为空）                        │
│  - 输入框 + 发送按钮                                    │
└───────────────────┬─────────────────────────────────────┘
                    │
                    │ [用户输入回答 + 点击发送]
                    ▼
┌─────────────────────────────────────────────────────────┐
│              调用 step                                   │
│  POST /api/onboarding/ai/step                           │
│  Body: { sessionId, answer }                            │
│    ↓                                                    │
│  返回: { question, summary, draftProfile?, status }    │
└───────────────────┬─────────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        │                       │
        ▼                       ▼
   status='ongoing'        status='done' 或 question=null
        │                       │
        │                       ▼
        │            ┌─────────────────────────────────┐
        │            │       调用 finish                │
        │            │  POST /api/onboarding/ai/finish │
        │            │  Body: { sessionId }            │
        │            │    ↓                            │
        │            │  返回: {                        │
        │            │    initialProfile,              │
        │            │    attributes,                  │
        │            │    conceptSeeds                 │
        │            │  }                              │
        │            └─────────┬───────────────────────┘
        │                      │
        ▼                      ▼
   显示下一个问题         保存数据 + 显示完成页
        │                      │
        │                      ├─→ updateProfile(initialProfile)
        │                      ├─→ localStorage.setItem('userAttributes', ...)
        │                      ├─→ localStorage.setItem('conceptSeeds', ...)
        │                      │
        └──────────────────────┼──────────────────────────────┐
                               │                              │
                               ▼                              ▼
                         显示雷达图                     "进入系统"按钮
                         三维数据                        → 跳转 /chat
```

---

## 📝 API 接口详解

### 1. POST /api/onboarding/ai/start

**功能：** 启动 AI 引导对话

**请求：**
```http
POST /api/onboarding/ai/start
Authorization: Bearer {token}
Content-Type: application/json

{}
```

**响应：**
```json
{
  "sessionId": "session-uuid-123",
  "question": "您好！我是您的学习助手。首先，能告诉我您想通过这个平台学习什么吗？",
  "summary": []
}
```

---

### 2. POST /api/onboarding/ai/step

**功能：** 提交用户回答，获取下一个问题

**请求：**
```http
POST /api/onboarding/ai/step
Authorization: Bearer {token}
Content-Type: application/json

{
  "sessionId": "session-uuid-123",
  "answer": "我想学习 Python 编程，特别是数据分析相关的内容"
}
```

**响应：**
```json
{
  "question": "太好了！您之前有编程经验吗？或者是完全零基础？",
  "summary": [
    {
      "key": "学习目标",
      "value": "Python 编程 - 数据分析",
      "confidence": 0.95
    }
  ],
  "draftProfile": {
    "cognition": 65,
    "affect": 70,
    "behavior": 60
  },
  "status": "ongoing"
}
```

**结束信号：**
```json
{
  "question": null,
  "summary": [...],
  "status": "done"
}
```

---

### 3. POST /api/onboarding/ai/finish

**功能：** 完成引导，生成最终画像

**请求：**
```http
POST /api/onboarding/ai/finish
Authorization: Bearer {token}
Content-Type: application/json

{
  "sessionId": "session-uuid-123"
}
```

**响应：**
```json
{
  "sessionId": "session-uuid-123",
  "initialProfile": {
    "cognition": 75,
    "affect": 80,
    "behavior": 70
  },
  "attributes": {
    "learningGoals": ["Python 编程", "数据分析"],
    "strengths": ["逻辑思维", "数学基础"],
    "weaknesses": ["编程经验不足"],
    "interests": ["数据可视化", "机器学习"],
    "preferredStyle": "实战为主",
    "background": "大学本科，数学专业"
  },
  "conceptSeeds": [
    {
      "concept": "Python",
      "category": "编程语言",
      "importance": 0.9,
      "relatedConcepts": ["数据分析", "Pandas", "NumPy"]
    },
    {
      "concept": "数据分析",
      "category": "技能",
      "importance": 0.95,
      "relatedConcepts": ["统计学", "可视化"]
    }
  ]
}
```

---

## 🎨 UI 复用说明

### 1. ChatBubble 组件

**完全复用 views/Chat.tsx 的样式：**

| 元素 | 复用源 | 说明 |
|------|--------|------|
| 用户消息气泡 | Chat.tsx 第 97-114 行 | 蓝紫渐变背景，右对齐，rounded-tr-sm |
| AI 消息气泡 | Chat.tsx 第 97-114 行 | 白色/深色背景，左对齐，rounded-tl-sm |
| 用户头像 | Chat.tsx 第 99-101 行 | `from-indigo-500 to-purple-600` + User 图标 |
| AI 头像 | Chat.tsx 第 99-101 行 | `from-emerald-500 to-green-600` + Bot 图标 |
| 打字指示器 | Chat.tsx 第 116-141 行 | 三个跳动的点 |

**实现代码：**

```tsx
// components/ChatBubble.tsx
export const ChatBubble: React.FC<ChatBubbleProps> = ({ message, theme }) => {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} animate-scale-in`}>
      <div className={`max-w-[80%] flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
        {/* 头像 */}
        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
          isUser
            ? 'bg-gradient-to-br from-indigo-500 to-purple-600'
            : 'bg-gradient-to-br from-emerald-500 to-green-600'
        } text-white shadow-lg`}>
          {isUser ? <User size={16} /> : <Bot size={16} />}
        </div>

        {/* 消息气泡 */}
        <div className={`p-4 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap shadow-md transition-all duration-300 hover:shadow-lg ${
          isUser
            ? 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white rounded-tr-sm'
            : 'rounded-tl-sm'
        }`} style={!isUser ? {
          backgroundColor: theme === 'light' ? '#ffffff' : '#1e293b',
          color: theme === 'light' ? '#000000' : '#ffffff',
          border: `1px solid ${theme === 'light' ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)'}`
        } : {}}>
          {message.text}
        </div>
      </div>
    </div>
  );
};
```

---

### 2. 输入框

**复用 Chat.tsx 第 144-169 行：**

```tsx
<form onSubmit={handleSubmit}>
  <div className="relative">
    <input
      type="text"
      value={input}
      onChange={(e) => setInput(e.target.value)}
      placeholder="输入您的回答..."
      disabled={isTyping}
      className="w-full rounded-xl py-3 pl-4 pr-12 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all disabled:opacity-50 shadow-sm"
      style={{
        backgroundColor: theme === 'light' ? '#ffffff' : '#1e293b',
        border: `1px solid ${theme === 'light' ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)'}`,
        color: theme === 'light' ? '#000000' : '#ffffff'
      }}
    />
    <button
      type="submit"
      disabled={!input.trim() || isTyping}
      className="absolute right-2 top-2 p-1.5 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-lg hover:shadow-lg hover:shadow-indigo-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 active:scale-95"
    >
      <Send size={18} />
    </button>
  </div>
</form>
```

---

### 3. SummaryPanel（已确认信息面板）

**复用 Chat.tsx 侧边栏样式（第 173-265 行）：**

```tsx
// components/SummaryPanel.tsx
<div className="glass-card p-5 space-y-4 animate-slide-in-right hover:shadow-xl transition-all duration-300">
  <div className="flex items-center space-x-2 text-emerald-500 dark:text-emerald-300 mb-2">
    <CheckCircle size={16} />
    <span className="font-semibold text-sm">画像构建中</span>
  </div>

  <div className="space-y-3">
    {summary.map((info, index) => (
      <div key={index} className="pb-3 border-b border-gray-200 dark:border-gray-700 last:border-0">
        <span className="text-xs block mb-1 font-medium">{info.key}</span>
        <p className="text-sm">{info.value}</p>
      </div>
    ))}
  </div>
</div>
```

---

## 🎯 使用示例

### 基础使用

```tsx
import { AiOnboardingPage } from './features/onboarding/ai/AiOnboardingPage';

function AiRoute() {
  const navigate = useNavigate();

  const handleComplete = () => {
    // 完成后跳转到聊天页面
    navigate('/chat');
  };

  const handleBack = () => {
    // 返回到模式选择页
    navigate('/register');
  };

  return (
    <AiOnboardingPage
      language="zh"
      onComplete={handleComplete}
      onBack={handleBack}
    />
  );
}
```

### 配合路由守卫

```tsx
import { RequireAuth } from './routes/RequireAuth';

function AiRoute() {
  return (
    <RequireAuth onUnauthorized={() => navigate('/login')}>
      <AiOnboardingPage
        language="zh"
        onComplete={() => navigate('/chat')}
      />
    </RequireAuth>
  );
}
```

---

## 🔐 数据流向

```
┌────────────────────────────────────────────────────────┐
│                   前端组件                              │
│  AiOnboardingPage                                      │
│    ↓                                                   │
│  startAiOnboarding() → 获取第一问                      │
│    ↓                                                   │
│  用户回答 → stepAiOnboarding(sessionId, answer)       │
│    ↓                                                   │
│  更新 summary + draftProfile                           │
│    ↓                                                   │
│  status='done' → finishAiOnboarding(sessionId)        │
└────────────────┬───────────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────────────┐
│              features/onboarding/ai/api.ts             │
│  finishAiOnboarding(data) {                            │
│    return apiClient.post(                             │
│      '/api/onboarding/ai/finish',                     │
│      data                                             │
│    );                                                 │
│  }                                                    │
└────────────────┬───────────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────────────┐
│               lib/apiClient.ts                         │
│  apiClient.post() {                                    │
│    headers['Authorization'] = `Bearer ${token}`;      │
│    fetch('/api/onboarding/ai/finish', { ... })       │
│  }                                                    │
└────────────────┬───────────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────────────┐
│               后端 API                                  │
│  POST /api/onboarding/ai/finish                        │
│  { "sessionId": "xxx" }                                │
│    ↓                                                   │
│  1. 从 token 识别 userId                               │
│  2. 从会话记录中分析对话                               │
│  3. 生成最终画像（cognition/affect/behavior）          │
│  4. 提取用户属性（learningGoals, strengths...）        │
│  5. 生成概念种子（concept graph seeds）                │
│  6. 存储会话记录（user_id, session_id, messages）      │
│  7. 返回 { initialProfile, attributes, conceptSeeds } │
└────────────────┬───────────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────────────┐
│           前端更新全局状态                              │
│  authStore.updateProfile(initialProfile)              │
│  localStorage.setItem('userAttributes', JSON)         │
│  localStorage.setItem('conceptSeeds', JSON)           │
└────────────────┬───────────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────────────┐
│           显示完成页面                                  │
│  - 雷达图展示三维画像                                  │
│  - "进入系统"按钮 → 跳转 /chat                         │
└────────────────────────────────────────────────────────┘
```

---

## 💾 数据存储

### 1. initialProfile

**存储位置：** 全局 authStore

```typescript
updateProfile(initialProfile); // 自动同步到 localStorage
```

---

### 2. userAttributes

**存储位置：** localStorage

```typescript
localStorage.setItem('userAttributes', JSON.stringify(attributes));

// 后续读取
const attributes = JSON.parse(localStorage.getItem('userAttributes') || '{}');
```

**用途：**
- 个性化推荐
- 学习路径定制
- 内容过滤

---

### 3. conceptSeeds

**存储位置：** localStorage

```typescript
localStorage.setItem('conceptSeeds', JSON.stringify(conceptSeeds));

// 后续读取
const seeds = JSON.parse(localStorage.getItem('conceptSeeds') || '[]');
```

**用途：**
- 初始化知识图谱
- 推荐相关主题
- 建立概念关联

---

## 🔮 未来扩展

### 1. 支持撤回上一步

**实现思路：**

```typescript
const [conversationHistory, setConversationHistory] = useState<AiStepResponse[]>([]);

const handleUndo = () => {
  if (conversationHistory.length > 0) {
    const previousState = conversationHistory[conversationHistory.length - 1];
    setSummary(previousState.summary);
    setMessages(messages.slice(0, -2)); // 删除最后两条（用户 + AI）
    setConversationHistory(conversationHistory.slice(0, -1));
  }
};
```

**后端支持：**
```http
POST /api/onboarding/ai/undo
Body: { sessionId }

Response: { question, summary }
```

---

### 2. 保存对话记录

**数据库设计：**

```sql
CREATE TABLE ai_onboarding_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  session_id VARCHAR(255) UNIQUE NOT NULL,
  messages JSONB NOT NULL,  -- 所有消息
  summary JSONB NOT NULL,   -- 已确认信息
  initial_profile JSONB,    -- 最终画像
  attributes JSONB,         -- 用户属性
  concept_seeds JSONB,      -- 概念种子
  status VARCHAR(50),       -- 状态（ongoing/completed）
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_ai_sessions_user ON ai_onboarding_sessions(user_id);
CREATE INDEX idx_ai_sessions_session ON ai_onboarding_sessions(session_id);
```

---

### 3. 管理员查看对话

**后台页面：**
```
/admin/onboarding/ai/sessions
  - 列表：显示所有 AI 引导会话
  - 详情：查看完整对话历史
  - 分析：统计常见问题、用户属性分布
```

**API：**
```http
GET /api/admin/onboarding/ai/sessions?user_id=xxx

Response:
{
  "sessions": [
    {
      "id": "session-123",
      "user": { "id": "user-456", "name": "张三" },
      "messages": [...],"summary": [...],
      "initialProfile": { cognition: 75, ... },
      "created_at": "2026-02-12T10:00:00Z"
    }
  ]
}
```

---

### 4. 多语言支持

**翻译文件扩展：**

```typescript
// utils/translations.ts
export const translations = {
  zh: {
    aiOnboardingTitle: 'AI 引导注册',
    aiOnboardingDesc: '通过对话深入了解您的学习特征',
    skipQuestion: '跳过此问题',
    // ...
  },
  en: {
    aiOnboardingTitle: 'AI-Guided Registration',
    aiOnboardingDesc: 'Understanding your learning profile through conversation',
    skipQuestion: 'Skip this question',
    // ...
  }
};
```

---

### 5. 优化对话策略

**后端 AI 优化：**
- 根据用户回答长度调整问题深度
- 识别用户情绪，调整提问方式
- 动态跳过无关问题
- 自适应问题数量（3-10 个问题）

---

## 🚨 错误处理

### 1. 会话无效或过期

```tsx
catch (error: any) {
  if (error.code === 'INVALID_SESSION') {
    setApiError('会话已过期，请重新开始');
    // 自动重新开始
    setTimeout(() => {
      window.location.reload();
    }, 2000);
  }
}
```

---

### 2. 网络错误

```tsx
catch (error: any) {
  if (error.code === 'NETWORK_ERROR') {
    setApiError('网络连接失败，请检查网络');
    // 显示重试按钮
  }
}
```

---

### 3. 信息不足无法生成画像

```tsx
catch (error: any) {
  if (error.code === 'INSUFFICIENT_DATA') {
    setApiError('信息不足，请继续对话');
    setStatus('chatting');
  }
}
```

---

## ✅ 最佳实践

### 1. 自动滚动到底部

```tsx
useEffect(() => {
  if (scrollRef.current) {
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }
}, [messages, isTyping]);
```

---

### 2. 防抖输入

```tsx
import { debounce } from 'lodash';

const debouncedSubmit = debounce(handleSubmit, 300);
```

---

### 3. 保存草稿

```tsx
useEffect(() => {
  // 自动保存到 localStorage
  if (messages.length > 0) {
    localStorage.setItem('aiOnboardingDraft', JSON.stringify({
      sessionId,
      messages,
      summary
    }));
  }
}, [messages, summary]);
```

---

## 📊 性能优化

### 1. 消息虚拟滚动

对于超长对话（>100 条消息），使用虚拟滚动：

```tsx
import { VirtualList } from 'react-virtualized';

<VirtualList
  height={600}
  itemCount={messages.length}
  itemSize={80}
  renderItem={({ index }) => <ChatBubble message={messages[index]} />}
/>
```

---

### 2. 防止重复提交

```tsx
const [isSubmitting, setIsSubmitting] = useState(false);

const handleSubmit = async () => {
  if (isSubmitting) return;
  setIsSubmitting(true);
  try {
    // ...
  } finally {
    setIsSubmitting(false);
  }
};
```

---

## 🎯 总结

### 核心特性

- ✅ 自动启动 AI 引导对话
- ✅ 完全复用 Chat.tsx 的聊天 UI 样式
- ✅ 实时显示已确认信息（summary）
- ✅ 草稿画像预览（draftProfile）
- ✅ 支持跳过问题
- ✅ 自动判断结束并调用 finish
- ✅ 生成最终画像 + 用户属性 + 概念种子
- ✅ 更新全局 profile
- ✅ 雷达图可视化
- ✅ 完整错误处理

### UI 复用

- ✅ ChatBubble：完全复用 Chat.tsx 样式（第 97-141 行）
- ✅ 输入框：复用 Chat.tsx（第 144-169 行）
- ✅ SummaryPanel：复用 Chat.tsx 侧边栏样式（第 173-265 行）
- ✅ 渐变、动画、主题切换：完全一致

### 未来扩展

- 🔮 支持撤回上一步
- 🔮 保存对话记录到数据库
- 🔮 管理员查看和分析对话
- 🔮 多语言支持
- 🔮 优化 AI 对话策略

---

**最后更新**: 2026-02-12
**版本**: 1.0.0
