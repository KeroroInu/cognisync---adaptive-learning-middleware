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

## 文档

- [完整项目规格](docs/PROJECT_SPECIFICATION.md)
- [API 实现指南](docs/API_IMPLEMENTATION_GUIDE.md)
- [后端 README](backend/README.md)
- [前端 README](frontend/README.md)

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！
