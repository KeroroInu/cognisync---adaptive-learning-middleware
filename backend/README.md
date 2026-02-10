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

### 学生端 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| POST | `/api/chat` | 发送聊天消息（核心功能） |
| GET | `/api/profile/{userId}` | 获取用户画像 |
| PUT | `/api/profile/{userId}` | 更新用户画像 |
| GET | `/api/graph/{userId}` | 获取知识图谱 |
| PUT | `/api/graph/node/{nodeId}` | 更新知识节点 |
| POST | `/api/calibration` | 记录校准日志 |

### Admin API（需要 X-ADMIN-KEY Header）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/explorer/tables` | 列出所有可视化表 |
| GET | `/api/admin/explorer/tables/{table}/schema` | 获取表结构 |
| GET | `/api/admin/explorer/tables/{table}/data` | 分页查询表数据 |
| GET | `/api/admin/explorer/tables/{table}/export` | 导出表数据（JSON） |
| GET | `/api/admin/users` | 用户列表（分页） |
| GET | `/api/admin/analytics/overview` | 系统统计概览 |

**Admin API 使用示例**：
```bash
# 获取所有表
curl -H "X-ADMIN-KEY: your_admin_key" http://localhost:8000/api/admin/explorer/tables

# 查看 users 表数据
curl -H "X-ADMIN-KEY: your_admin_key" http://localhost:8000/api/admin/explorer/tables/users/data?page=1&page_size=10
```

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

### 运行测试

```bash
# 安装开发依赖（首次运行）
pip install -r requirements-dev.txt

# 运行所有测试
pytest tests/ -v

# 运行特定测试文件
pytest tests/test_admin_endpoints.py -v

# 运行特定测试用例
pytest tests/test_admin_endpoints.py::test_list_tables -v -s

# 查看测试覆盖率
pytest tests/ --cov=app --cov-report=html
```

**测试文件说明**：
- `tests/test_api_endpoints.py` - 学生端 API 集成测试
  - 聊天接口测试
  - 画像管理测试
  - 知识图谱测试
  - 用户数据导出测试
  - 完整用户流程测试

- `tests/test_admin_endpoints.py` - Admin API 集成测试（13 个测试用例）
  - 鉴权测试（无 Key、错误 Key、正确 Key）
  - 数据浏览器测试（列表表、获取结构、获取数据、分页、导出）
  - 用户管理测试
  - 数据分析测试
  - 完整 Admin 工作流测试

- `tests/test_text_analyzer.py` - 文本分析服务单元测试

**测试数据库**：
- 所有测试使用内存 SQLite 数据库（不影响生产数据）
- 测试数据会在测试结束后自动清理

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
