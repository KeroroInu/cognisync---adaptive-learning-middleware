# CogniSync Backend

基于 FastAPI 的自适应学习中间件后端服务。

## 快速开始

### 1. 安装依赖

```bash
./setup.sh
```

这将创建虚拟环境并安装所有必需的依赖。

### 2. 配置环境变量

创建 `.env` 文件（参考 `.env.example`）：

```bash
# LLM Provider
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=your-api-key-here
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat

# Database
DATABASE_URL=postgresql+asyncpg://cognisync:cognisync123@localhost:5432/cognisync_db
REDIS_URL=redis://localhost:6379/0

# Neo4j (Optional)
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=cognisync123

# CORS
CORS_ORIGINS=http://localhost:3000,http://localhost:3001
```

### 3. 启动数据库

```bash
# 确保 Docker Desktop 正在运行
cd ..
docker-compose up -d postgres redis
```

### 4. 启动服务

```bash
./run.sh
```

服务将在 http://localhost:8000 启动。

访问：
- API 文档: http://localhost:8000/docs
- 健康检查: http://localhost:8000/health
- 聊天接口: http://localhost:8000/api/chat

## 核心功能

### 1. 聊天接口 (`POST /api/chat`)
- 支持多语言（中文/英文）
- 实时文本分析（意图、情感、概念检测）
- 自适应画像更新
- DeepSeek LLM 集成

### 2. 学习者画像 (`/api/profile`)
- 三维画像（认知、情感、行为）
- 增量更新机制
- 用户校准功能

### 3. 知识图谱 (`/api/graph`)
- 概念节点管理
- 关系追踪
- 掌握度评估

### 4. 校准日志 (`/api/calibration`)
- 系统评估 vs 用户自评
- 冲突等级计算
- 信任度评分

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| POST | `/api/chat` | 发送聊天消息（核心功能） |
| GET | `/api/profile/{userId}` | 获取用户画像 |
| PUT | `/api/profile/{userId}` | 更新用户画像 |
| GET | `/api/graph/{userId}` | 获取知识图谱 |
| PUT | `/api/graph/node/{nodeId}` | 更新知识节点 |
| POST | `/api/calibration` | 记录校准日志 |

## 技术栈

- **框架**: FastAPI 0.109+
- **数据库**: PostgreSQL (用户数据) + Redis (缓存)
- **可选**: Neo4j (知识图谱)
- **ORM**: SQLAlchemy 2.0 (async)
- **LLM**: DeepSeek (推荐) / OpenAI / Ollama / LMStudio
- **验证**: Pydantic v2

## 项目结构

```
backend/
├── app/
│   ├── api/           # API 路由和端点
│   ├── core/          # 核心配置
│   ├── models/        # 数据模型 (SQL/Graph)
│   ├── schemas/       # Pydantic 模式
│   ├── services/      # 业务逻辑服务
│   └── db/            # 数据库连接
├── main.py            # 应用入口
├── setup.sh           # 依赖安装脚本
├── run.sh             # 启动脚本
├── requirements.txt   # 依赖列表
└── .env               # 环境变量
```

## LLM Provider 支持

系统支持多种 LLM Provider，通过 `.env` 中的 `LLM_PROVIDER` 切换：

- **deepseek** - DeepSeek AI (推荐，高性价比)
- **openai** - OpenAI GPT
- **ollama** - Ollama (本地部署)
- **lmstudio** - LM Studio (本地部署)
- **mock** - Mock 模式 (测试用)

## 开发

### 激活虚拟环境
```bash
source venv/bin/activate
```

### 手动启动服务
```bash
python3 -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 代码格式化
```bash
black app/
isort app/
```

## 故障排查

### 数据库连接失败
- 确保 Docker Desktop 正在运行
- 检查容器状态: `docker ps`
- 验证数据库密码与 docker-compose.yml 一致

### LLM API 错误
- 检查 API Key 是否正确
- 确认网络连接正常
- 查看日志: 服务启动时会显示 LLM Provider 配置

### CORS 错误
- 确保前端 URL 已添加到 `CORS_ORIGINS`
- 格式: `http://localhost:3000,http://localhost:3001`

## 许可证

MIT License
