# CogniSync - 自适应学习中间件

基于多模态学习者画像的智能教育系统，支持实时对话分析、知识图谱构建和自适应教学。

## 项目概述

CogniSync 是一个前后端分离的教育智能体中间件，包含学生端和管理端两个独立前端应用。通过分析学习者的对话内容，实时构建和更新三维学习者画像（认知、情感、行为），并维护个性化知识图谱，从而提供自适应的教学支持。

### 核心特性

- 🤖 **智能对话分析** - 基于 DeepSeek LLM 的实时文本分析
- 👤 **多维画像追踪** - 认知、情感、行为三维度动态画像
- 🧠 **知识图谱构建** - 自动识别和关联学习概念
- 🎯 **自适应教学** - 根据学习者状态调整教学策略
- 📊 **校准机制** - 系统评估与用户自评对比分析
- 🔧 **Admin 后台** - 数据浏览、用户管理、统计分析

---

## 项目结构

```
cognisync---adaptive-learning-middleware/
├── frontend/                           # 学生端前端（React + TypeScript + Vite）
│   ├── src/
│   │   ├── views/                      # 页面组件（Dashboard、Chat、KnowledgeGraph 等）
│   │   ├── components/                 # 通用组件（Layout、RadarDisplay）
│   │   ├── services/                   # API 服务和状态管理
│   │   ├── utils/                      # 工具函数和翻译
│   │   └── types.ts                    # TypeScript 类型定义
│   ├── index.css                       # 样式文件
│   ├── package.json
│   └── vite.config.ts
│
├── admin-frontend/                     # Admin 后台前端（React + TypeScript + Vite）
│   ├── src/
│   │   ├── pages/                      # 页面组件
│   │   │   ├── Dashboard.tsx           # 概览页
│   │   │   ├── DataExplorer.tsx        # 数据浏览器（核心功能）
│   │   │   └── UsersManagement.tsx     # 用户管理
│   │   ├── components/                 # 组件（Layout）
│   │   ├── services/                   # API 客户端
│   │   ├── types/                      # TypeScript 类型定义
│   │   └── hooks/                      # React Hooks
│   ├── .env                            # 环境变量（ADMIN_KEY）
│   ├── package.json
│   ├── tailwind.config.js              # Tailwind 配置（复用 frontend UI token）
│   └── vite.config.ts
│
├── backend/                            # 后端 FastAPI 应用
│   ├── app/
│   │   ├── api/
│   │   │   ├── router.py               # 主 API 路由
│   │   │   ├── admin_router.py         # Admin API 路由
│   │   │   └── endpoints/
│   │   │       ├── admin/              # Admin 端点（explorer、users、analytics）
│   │   │       └── ...                 # 其他端点（chat、profile、graph 等）
│   │   ├── core/
│   │   │   ├── config.py               # 配置管理
│   │   │   ├── security.py             # Admin 鉴权
│   │   │   └── logging.py              # 日志配置
│   │   ├── models/                     # 数据模型（SQL/Neo4j）
│   │   ├── schemas/                    # Pydantic Schema
│   │   ├── services/                   # 业务逻辑层
│   │   └── db/                         # 数据库连接
│   ├── main.py                         # 应用入口
│   ├── .env                            # 环境变量（包含 ADMIN_KEY）
│   ├── requirements.txt
│   ├── setup.sh
│   └── run.sh
│
├── shared/                             # 共享 UI 组件库
│   ├── styles/                         # CSS Variables、动画系统
│   │   ├── variables.css
│   │   ├── animations.css
│   │   └── glass-card.css
│   ├── components/                     # 可复用 React 组件
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── Table.tsx
│   │   ├── Modal.tsx
│   │   ├── Input.tsx
│   │   └── Switch.tsx
│   ├── hooks/
│   │   └── useTheme.ts                 # 主题切换 Hook
│   ├── package.json
│   └── README.md
│
├── scripts/                            # 开发脚本
│   ├── dev-frontend.sh                 # 启动学生端前端
│   ├── dev-admin.sh                    # 启动 Admin 后台
│   ├── dev-backend.sh                  # 启动后端
│   └── dev-db.sh                       # 启动数据库
│
├── docs/                               # 项目文档
├── .editorconfig                       # 编辑器配置
├── .prettierrc.json                    # 代码格式化配置
├── .eslintrc.cjs                       # ESLint 配置
├── docker-compose.yml                  # 数据库服务配置
└── README.md                           # 本文件
```

---

## 技术栈

### 学生端前端（frontend/）
- React 19.2 + TypeScript 5.8
- Vite 6.2（构建工具）
- D3.js（知识图谱可视化）
- Recharts（雷达图）
- Tailwind CSS（样式）
- Lucide React（图标）

### Admin 后台前端（admin-frontend/）
- React 19.2 + TypeScript 5.8
- Vite 6.2（构建工具）
- TanStack Query（数据获取）
- TanStack Table（数据表格）
- Tailwind CSS（复用 frontend UI token）
- Lucide React（图标）

### 后端（backend/）
- FastAPI 0.109（Python Web 框架）
- SQLAlchemy 2.0（异步 ORM）
- PostgreSQL（用户数据、画像、消息）
- Neo4j（知识图谱，可选）
- Redis（缓存）
- DeepSeek AI（LLM，支持多种 Provider）

### 共享 UI 库（shared/）
- React 组件（Button、Card、Table、Modal、Input、Switch）
- CSS Variables（主题系统）
- 动画系统（glassmorphism 效果）

---

## 快速开始

### 环境要求

- **Python** 3.13+
- **Node.js** 18+
- **Docker Desktop**（用于数据库）
- **DeepSeek API Key**（或其他 LLM Provider）

---

### 1. 克隆项目

```bash
git clone <repository-url>
cd cognisync---adaptive-learning-middleware
```

---

### 2. 启动数据库

使用提供的脚本启动 PostgreSQL 和 Redis：

```bash
./scripts/dev-db.sh
```

或手动启动：

```bash
docker-compose up -d postgres redis
```

**验证**：
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`

---

### 3. 启动后端

```bash
./scripts/dev-backend.sh
```

或手动启动：

```bash
cd backend

# 安装依赖
./setup.sh

# 配置环境变量（首次运行）
cp .env.example .env
# 编辑 .env，添加以下内容：
# - DEEPSEEK_API_KEY=your-deepseek-api-key
# - ADMIN_KEY=cognisync_admin_key_2024_secure（已默认配置）

# 启动后端
./run.sh
```

**验证**：
- 后端 API: http://localhost:8000
- API 文档: http://localhost:8000/docs
- 健康检查: http://localhost:8000/health

---

### 4. 启动学生端前端

```bash
./scripts/dev-frontend.sh
```

或手动启动：

```bash
cd frontend
npm install  # 首次运行
npm run dev
```

**访问**：http://localhost:3001

---

### 5. 启动 Admin 后台

```bash
./scripts/dev-admin.sh
```

或手动启动：

```bash
cd admin-frontend

# 首次运行：安装依赖
npm install

# 确保 .env 文件存在
# VITE_ADMIN_KEY=cognisync_admin_key_2024_secure
# VITE_API_URL=http://localhost:8000

npm run dev
```

**访问**：http://localhost:5173

**Admin Key**：`cognisync_admin_key_2024_secure`（已在 `.env` 中配置）

---

## 应用访问

| 应用 | URL | 说明 |
|------|-----|------|
| **学生端前端** | http://localhost:3001 | 学习者界面（对话、画像、知识图谱） |
| **Admin 后台** | http://localhost:5173 | 管理员后台（数据浏览器、用户管理、统计） |
| **后端 API** | http://localhost:8000 | RESTful API 服务 |
| **API 文档** | http://localhost:8000/docs | Swagger UI 交互文档 |
| **PostgreSQL** | localhost:5432 | 数据库（用户：cognisync，密码：见 .env） |
| **Redis** | localhost:6379 | 缓存服务 |

---

## Admin 后台功能

### 数据浏览器（Data Explorer）

**核心功能**：
- 列出所有可视化表（users、chat_messages、profile_snapshots、calibration_logs）
- 查看表结构（字段名、类型、约束）
- 分页浏览表数据（每页 50 条）
- 导出 JSON 数据
- 敏感字段脱敏（自动过滤 password、token、api_key 等）

**使用方法**：
1. 访问 http://localhost:5173
2. 点击侧边栏的 "Data Explorer"
3. 从左侧列表选择表
4. 右侧显示表结构和数据
5. 点击"导出 JSON"按钮下载数据

### 用户管理

- 查看所有用户列表
- 用户统计信息（消息数、最后活跃时间）
- 分页浏览用户数据

### Dashboard 概览

- 系统统计数据（总用户数、总消息数、活跃用户数）
- 7日活跃度趋势图表
- 快速访问各功能模块

---

## 开发指南

### 前端开发（学生端）

```bash
cd frontend
npm run dev      # 启动开发服务器
npm run build    # 构建生产版本
npm run preview  # 预览生产版本
```

**技术要点**：
- 使用 `shared/` 中的 UI 组件和样式
- 状态管理：`services/store.ts`（Zustand）
- API 调用：`services/api.ts`
- 主题切换：`data-theme` 属性（light/dark）

### Admin 后台开发

```bash
cd admin-frontend
npm run dev         # 启动开发服务器
npm run build       # 构建生产版本
npm run type-check  # TypeScript 类型检查
npm run lint        # ESLint 检查
```

**技术要点**：
- **完全复用** frontend 的 UI token（通过 `@import '../shared/styles/*.css'`）
- API 客户端：`src/services/apiClient.ts`（自动携带 X-ADMIN-KEY Header）
- 数据获取：TanStack Query
- 表格组件：使用 `@shared/components/Table`

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

**技术要点**：
- Admin API 鉴权：`app/core/security.py`（verify_admin_key 依赖）
- 分层架构：api → service → repository → models
- 统一响应格式：`SuccessResponse[T]` / `ErrorResponse`
- Admin 路由：`/api/admin/*`（需要 X-ADMIN-KEY Header）

### 后端测试

```bash
cd backend

# 安装开发依赖（首次运行）
pip install -r requirements-dev.txt

# 运行所有测试
pytest tests/ -v

# 运行特定测试文件
pytest tests/test_admin_endpoints.py -v

# 运行特定测试用例
pytest tests/test_admin_endpoints.py::test_list_tables -v

# 查看测试覆盖率（可选）
pytest tests/ --cov=app --cov-report=html
```

**测试文件**：
- `tests/test_api_endpoints.py` - 学生端 API 测试（7 个测试用例）
- `tests/test_admin_endpoints.py` - Admin API 测试（13 个测试用例）
- `tests/test_text_analyzer.py` - 文本分析服务测试

**Admin API 测试覆盖**：
- ✅ Admin 鉴权测试（无 Key、错误 Key、正确 Key）
- ✅ 数据浏览器测试（列表表、获取结构、获取数据、分页、导出）
- ✅ 用户管理测试（用户列表、分页）
- ✅ 数据分析测试（系统概览、活跃度趋势）
- ✅ 完整工作流测试（模拟管理员从登录到浏览数据的全流程）

---

## UI Token 共享机制

### 设计 Token 位置

**CSS Variables**（`shared/styles/variables.css`）：
```css
:root {
  --bg-primary: #ffffff;
  --text-primary: #000000;
  --brand-blue: #3b82f6;
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  --radius-lg: 16px;
  /* ... 更多变量 */
}

[data-theme="dark"] {
  --bg-primary: #0f172a;
  --text-primary: #ffffff;
  /* ... 深色模式变量 */
}
```

### 前端复用方式

**admin-frontend/src/index.css**：
```css
@import '../shared/styles/variables.css';
@import '../shared/styles/animations.css';
@import '../shared/styles/glass-card.css';
```

**admin-frontend/tailwind.config.js**：
```js
export default {
  content: [
    "./src/**/*.{ts,tsx}",
    "../shared/components/**/*.{ts,tsx}",  // 包含 shared 组件
  ],
  theme: {
    extend: {
      colors: {
        'brand-blue': '#3b82f6',  // 与 frontend 一致
        // ...
      },
    },
  },
};
```

---

## API 端点

### 学生端 API（/api/）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/chat` | 智能对话（核心功能） |
| GET | `/api/profile/{userId}` | 获取学习者画像 |
| PUT | `/api/profile/{userId}` | 更新画像 |
| GET | `/api/graph/{userId}` | 获取知识图谱 |
| POST | `/api/calibration` | 创建校准日志 |

### Admin API（/api/admin/）

**需要 Header**：`X-ADMIN-KEY: cognisync_admin_key_2024_secure`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/explorer/tables` | 列出所有可视化表 |
| GET | `/api/admin/explorer/tables/{table}/schema` | 获取表结构 |
| GET | `/api/admin/explorer/tables/{table}/data` | 分页查询表数据 |
| GET | `/api/admin/explorer/tables/{table}/export` | 导出表数据（JSON） |
| GET | `/api/admin/users` | 用户列表（分页） |
| GET | `/api/admin/analytics/overview` | 系统统计概览 |

详细 API 文档：http://localhost:8000/docs

---

## 配置文件

### 环境变量

**backend/.env**：
```bash
# 数据库配置
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=cognisync
POSTGRES_PASSWORD=cognisync_dev_password_2024
POSTGRES_DB=cognisync_db

# LLM 配置
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=your-api-key-here

# Admin 配置
ADMIN_KEY=cognisync_admin_key_2024_secure
```

**admin-frontend/.env**：
```bash
VITE_ADMIN_KEY=cognisync_admin_key_2024_secure
VITE_API_URL=http://localhost:8000
```

---

## 故障排查

### 后端启动失败

- 检查 Python 版本：`python3 --version`（需要 3.13+）
- 确保虚拟环境已激活：`source venv/bin/activate`
- 检查依赖安装：`pip list`

### 数据库连接失败

- 确保 Docker Desktop 正在运行
- 检查容器状态：`docker ps`
- 验证数据库配置与 docker-compose.yml 一致

### Admin 后台无法访问

- 检查 `.env` 文件中的 `VITE_ADMIN_KEY` 是否与后端 `ADMIN_KEY` 一致
- 检查后端是否正常运行：`curl http://localhost:8000/health`
- 查看浏览器开发者工具的 Network 标签，确认请求是否携带 `X-ADMIN-KEY` Header

### 前端样式异常

- 确保 `shared/` 目录存在且可访问
- 检查 `index.css` 中的 `@import` 路径是否正确
- 清除浏览器缓存并刷新（Ctrl+Shift+R / Cmd+Shift+R）

---

## 项目文档

- [完整项目规格](docs/PROJECT_SPECIFICATION.md)
- [API 实现指南](docs/API_IMPLEMENTATION_GUIDE.md)
- [后端 README](backend/README.md)
- [前端 README](frontend/README.md)
- [共享 UI 库 README](shared/README.md)

---

## 许可证

MIT License

---

## 贡献

欢迎提交 Issue 和 Pull Request！
