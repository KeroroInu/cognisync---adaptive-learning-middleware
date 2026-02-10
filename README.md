# CogniSync - 自适应学习中间件

基于多模态学习者画像的智能教育系统，支持实时对话分析、知识图谱构建和自适应教学。

## 项目概述

CogniSync 是一个前后端分离的教育智能体中间件，通过分析学习者的对话内容，实时构建和更新三维学习者画像（认知、情感、行为），并维护个性化知识图谱，从而提供自适应的教学支持。

### 核心特性

- 🤖 **智能对话分析** - 基于 DeepSeek LLM 的实时文本分析
- 👤 **多维画像追踪** - 认知、情感、行为三维度动态画像
- 🧠 **知识图谱构建** - 自动识别和关联学习概念
- 🎯 **自适应教学** - 根据学习者状态调整教学策略
- 📊 **校准机制** - 系统评估与用户自评对比分析

## 技术栈

### 前端
- React 19.2 + TypeScript 5.8
- Vite 6.2 (构建工具)
- D3.js (知识图谱可视化)
- Tailwind CSS (样式)
- Lucide React (图标)

### 后端
- FastAPI 0.109 (Python Web 框架)
- SQLAlchemy 2.0 (异步 ORM)
- PostgreSQL (用户数据、画像、消息)
- Redis (缓存)
- Neo4j (知识图谱，可选)
- DeepSeek AI (LLM，支持多种 Provider)

### 基础设施
- Docker + Docker Compose
- uvicorn (ASGI 服务器)
- asyncpg (PostgreSQL 异步驱动)

## 项目结构

```
cognisync/
├── frontend/                 # 前端 React 应用
│   ├── views/                # 页面组件 (Dashboard, Chat, Graph, etc.)
│   ├── components/           # 通用组件
│   ├── services/             # API 服务和状态管理
│   ├── utils/                # 工具函数
│   └── package.json
│
├── backend/                  # 后端 FastAPI 应用
│   ├── app/
│   │   ├── api/              # API 路由和端点
│   │   ├── core/             # 核心配置
│   │   ├── models/           # 数据模型 (SQL/Graph)
│   │   ├── schemas/          # Pydantic 模式
│   │   ├── services/         # 业务逻辑 (LLM, 画像, 图谱)
│   │   └── db/               # 数据库连接
│   ├── main.py               # 应用入口
│   ├── setup.sh              # 依赖安装
│   ├── run.sh                # 启动脚本
│   └── requirements.txt      # Python 依赖
│
├── docs/                     # 项目文档
│   ├── PROJECT_SPECIFICATION.md
│   └── API_IMPLEMENTATION_GUIDE.md
│
├── docker-compose.yml        # 数据库服务配置
└── README.md                 # 本文件
```

## 快速开始

### 环境要求

- Python 3.13+
- Node.js 18+
- Docker Desktop
- DeepSeek API Key (或其他 LLM Provider)

### 1. 克隆项目

```bash
git clone <repository-url>
cd cognisync---adaptive-learning-middleware
```

### 2. 启动后端

```bash
cd backend

# 安装依赖
./setup.sh

# 配置环境变量
cp .env.example .env
# 编辑 .env，添加 DEEPSEEK_API_KEY

# 启动数据库
cd ..
docker-compose up -d postgres redis

# 启动后端服务
cd backend
./run.sh
```

后端将在 http://localhost:8000 启动。

### 3. 启动前端

```bash
cd frontend

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

前端将在 http://localhost:3001 启动。

### 4. 访问应用

- **前端界面**: http://localhost:3001
- **API 文档**: http://localhost:8000/docs
- **健康检查**: http://localhost:8000/health

## 核心功能

### 1. 智能对话 (Chat)
- 与 AI 助手进行学习对话
- 实时分析用户消息（意图、情感、概念）
- 根据用户状态自适应调整回复风格
- 支持研究模式（苏格拉底式提问）

### 2. 学习者画像 (Dashboard & Calibration)
- 三维雷达图展示认知、情感、行为维度
- 实时更新画像数据
- 用户可手动校准系统评估
- 记录系统评估与用户自评的差异

### 3. 知识图谱 (Knowledge Graph)
- 自动识别对话中的学习概念
- 可视化概念关系网络
- 跟踪概念掌握度和学习频率
- 标记薄弱概念

### 4. 证据追踪 (Evidence)
- 查看历史对话记录
- 分析校准日志
- 追溯画像变化原因

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| POST | `/api/chat` | 智能对话（核心功能） |
| GET | `/api/profile/{userId}` | 获取学习者画像 |
| PUT | `/api/profile/{userId}` | 更新画像 |
| GET | `/api/graph/{userId}` | 获取知识图谱 |
| PUT | `/api/graph/node/{nodeId}` | 更新节点 |
| POST | `/api/calibration` | 创建校准日志 |

详细 API 文档: http://localhost:8000/docs

## 开发

### 后端开发

```bash
cd backend

# 激活虚拟环境
source venv/bin/activate

# 启动开发服务器（热重载）
python3 -m uvicorn main:app --reload

# 代码格式化
black app/
isort app/
```

### 前端开发

```bash
cd frontend

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build

# 预览生产版本
npm run preview
```

### 数据库管理

```bash
# 查看容器状态
docker ps

# 查看日志
docker logs cognisync-postgres
docker logs cognisync-redis

# 停止数据库
docker-compose down

# 清理数据（谨慎操作）
docker-compose down -v
```

## 配置

### LLM Provider 配置

系统支持多种 LLM Provider，在 `backend/.env` 中配置：

```bash
# DeepSeek (推荐)
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=sk-xxxxx
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat

# 或使用 OpenAI
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-xxxxx
OPENAI_MODEL=gpt-4

# 或使用本地 Ollama
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama2
```

### CORS 配置

在 `backend/.env` 中添加前端 URL：

```bash
CORS_ORIGINS=http://localhost:3000,http://localhost:3001
```

## 故障排查

### 后端启动失败
- 检查 Python 版本: `python3 --version` (需要 3.13+)
- 确保虚拟环境已激活
- 检查依赖安装: `pip list`

### 数据库连接失败
- 确保 Docker Desktop 正在运行
- 检查容器状态: `docker ps`
- 验证数据库配置与 docker-compose.yml 一致

### 前端 API 调用失败
- 检查后端服务是否运行: `curl http://localhost:8000/health`
- 验证 CORS 配置
- 查看浏览器开发者工具的 Network 标签

### LLM 调用失败
- 检查 API Key 是否正确
- 确认网络连接
- 查看后端日志获取详细错误信息

---

## 🎨 前端UI优化 - 浅白色 Apple 风格

### ✨ 更新内容

前端界面已全面升级为**浅白色磨砂质感**设计，采用类似 Apple 官网的动效和交互体验：

####  1. 设计语言
- **配色方案**：从深色主题切换到浅白色主题
  - 主背景：`#fafafa` (浅灰白色)
  - 卡片背景：半透明白色 + 毛玻璃效果（Glassmorphism）
  - 品牌色：`#007aff`（Apple 蓝）、`#34c759`（翠绿）、`#ff2d55`（粉红）

- **视觉效果**：
  - Glassmorphism（毛玻璃）卡片
  - 柔和阴影和圆角
  - 渐变网格背景

#### 2. 动效系统
- **页面过渡**：淡入淡出 + 平滑滑动
- **元素动画**：
  - `fadeIn` - 元素淡入
  - `slideInRight/Left` - 左右滑入
  - `scaleIn` - 缩放进入
  - `float` - 悬浮动画
- **交互反馈**：
  - 按钮悬停放大效果
  - 卡片悬停阴影增强
  - 图标微动效果

#### 3. 核心样式文件

##### `frontend/index.css`
完整的 CSS 变量系统 + 动画库：

```css
/* 主题变量 */
:root {
  --bg-primary: #fafafa;
  --glass-bg: rgba(255, 255, 255, 0.75);
  --brand-primary: #007aff;
  --shadow-md: 0 4px 12px 0 rgba(0, 0, 0, 0.08);
  --transition-base: 250ms cubic-bezier(0.4, 0, 0.2, 1);
  --blur-md: 20px;
}

/* 毛玻璃卡片 */
.glass-card {
  background: var(--glass-bg);
  backdrop-filter: blur(var(--blur-md)) saturate(180%);
  border: 1px solid rgba(0, 0, 0, 0.08);
  box-shadow: var(--shadow-md);
  border-radius: 16px;
}

/* 动画关键帧 */
@keyframes fadeIn { /* ... */ }
@keyframes slideInRight { /* ... */ }
@keyframes scaleIn { /* ... */ }
```

#### 4. 组件更新

##### `components/Layout.tsx`
- 侧边栏：玻璃效果 + 圆角边框 + 滑入动画
- 导航按钮：渐变激活状态 + 悬停阴影
- 主内容区：圆角卡片容器 + 淡入动画

```tsx
// 激活状态按钮
className="bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-500/30"

// 玻璃卡片
className="glass-card rounded-r-3xl shadow-xl animate-slide-in-left"
```

#### 5. 已优化的视图组件

以下组件已更新为浅色主题（保持原有功能，仅样式优化）：

- ✅ **Layout（布局）** - 毛玻璃侧边栏 + 渐变激活效果 + **浅色/深色主题切换**
- ✅ **Dashboard（仪表盘）** - 毛玻璃卡片 + 渐变图标 + 悬停动效
- ⏳ **Chat（对话）** - 待更新样式
- ⏳ **KnowledgeGraph（知识图谱）** - 待更新样式
- ⏳ **Calibration（校准）** - 待更新样式
- ⏳ **Evidence（证据）** - 待更新样式

#### 6. 🌗 主题切换功能（新增）

**位置**：侧边栏左下角，语言切换上方

**功能**：
- 一键切换浅色/深色主题
- 自动保存到 localStorage
- 流畅的过渡动画
- 渐变开关效果（浅色模式：橙色，深色模式：紫色）

**使用方法**：
点击侧边栏底部的主题切换开关，即可在浅色和深色模式之间切换。

**技术实现**：
- 状态管理：在 `store.ts` 中添加 `theme` 状态
- 持久化：使用 `localStorage` 保存用户偏好
- 样式切换：通过 `data-theme` 属性控制CSS变量

### 🚀 如何使用

#### 1. 已完成的更新

以下文件已自动更新，无需手动操作：

- ✅ `frontend/index.css` - 新主题样式系统
- ✅ `frontend/index.html` - 背景和样式引用
- ✅ `frontend/components/Layout.tsx` - 布局组件 + 主题切换按钮
- ✅ `frontend/views/Dashboard.tsx` - 仪表盘组件（Apple风格）
- ✅ `frontend/services/store.ts` - 状态管理（添加主题状态）
- ✅ `frontend/App.tsx` - 主组件（传递主题props）

#### 2. 查看效果

重启前端开发服务器即可看到新UI：

```bash
cd frontend
npm run dev
```

访问 http://localhost:3001 查看浅白色 Apple 风格界面。

#### 3. Dashboard 优化亮点

- **毛玻璃卡片**：顶部三个指标卡片使用glass-card效果
- **渐变图标背景**：每个图标有独特的渐变色背景
- **悬停动效**：
  - 图标放大效果
  - 卡片阴影增强
  - 箭头滑动效果
- **圆角统一**：所有卡片使用16px-20px圆角
- **渐进动画**：元素依次淡入（stagger animation）

#### 4. 渐进式更新（可选）

其他视图组件（Chat、Graph等）可根据需要逐步更新。主要改动模式：

```tsx
// 旧样式（深色）
className="bg-slate-900 border border-slate-800 text-slate-200"

// 新样式（浅色毛玻璃）
className="glass-card text-gray-900 shadow-md hover:shadow-lg transition-all duration-300"
```

### 🎯 设计亮点

| 特性 | 说明 |
|-----|------|
| **Glassmorphism** | 半透明毛玻璃效果，backdrop-filter 实现 |
| **Smooth Transitions** | 所有交互使用 cubic-bezier 缓动函数 |
| **Stagger Animation** | 页面元素依次渐入，层次感强 |
| **Micro-interactions** | 按钮、卡片的细腻悬停效果 |
| **Color Palette** | Apple 设计语言的蓝绿粉配色 |
| **Rounded Corners** | 8px - 20px 渐进圆角系统 |
| **Soft Shadows** | 多层阴影模拟真实光照 |

### 📝 CSS 类名速查

常用工具类：

- `.glass-card` - 毛玻璃卡片
- `.text-gradient` - 渐变文字
- `.animate-fade-in` - 淡入动画
- `.animate-slide-in-right` - 右滑入
- `.interactive` - 交互元素（悬停效果）
- `.stagger-1` ~ `.stagger-5` - 延迟动画

### 🔧 自定义配置

修改 `index.css` 中的 CSS 变量即可调整主题：

```css
:root {
  --brand-primary: #007aff;  /* 主品牌色 */
  --blur-md: 20px;            /* 毛玻璃模糊度 */
  --transition-base: 250ms;   /* 默认过渡时间 */
}
```

---

## 文档

- [完整项目规格](docs/PROJECT_SPECIFICATION.md)
- [API 实现指南](docs/API_IMPLEMENTATION_GUIDE.md)
- [后端 README](backend/README.md)
- [前端 README](frontend/README.md)

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！
