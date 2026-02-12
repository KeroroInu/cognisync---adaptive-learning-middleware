# CogniSync 系统启动指南

## 🎉 系统已成功启动！

### 📊 服务状态

| 服务 | 地址 | 状态 | 说明 |
|------|------|------|------|
| **后端 API** | http://localhost:8000 | ✅ 运行中 | FastAPI + Uvicorn |
| **API 文档** | http://localhost:8000/docs | ✅ 可访问 | Swagger UI |
| **前端界面** | http://localhost:3000 | ✅ 运行中 | React + Vite |
| **Neo4j** | bolt://localhost:7687 | ✅ 已连接 | 知识图谱数据库 |
| **PostgreSQL** | localhost:5432 | ⚠️ 连接失败 | 需要配置密码 |

---

## 🚀 快速访问

### 1. 前端界面
打开浏览器访问：**http://localhost:3000**

默认路由：
- 登录页面：`/login`
- 注册页面：`/register`
- 量表注册：`/register/scale`（需登录）
- AI 引导：`/register/ai`（需登录）
- 主面板：`/dashboard`（需登录）
- 聊天：`/chat`（需登录）
- 知识图谱：`/graph`（需登录）

### 2. 后端 API 文档
打开浏览器访问：**http://localhost:8000/docs**

主要 API 端点：
- `/api/auth/login` - 用户登录
- `/api/auth/register` - 用户注册
- `/api/auth/me` - 获取当前用户
- `/api/forms/active` - 获取激活的量表模板
- `/api/forms/{id}/submit` - 提交量表答案
- `/api/onboarding/ai/start` - 开始 AI 引导
- `/api/onboarding/ai/step` - AI 引导单步
- `/api/onboarding/ai/finish` - 完成 AI 引导

---

## 🔧 管理命令

### 查看实时日志

```bash
# 查看后端日志
tail -f /tmp/cognisync-backend.log

# 查看前端日志
tail -f /tmp/cognisync-frontend.log

# 同时查看两个日志
tail -f /tmp/cognisync-backend.log -f /tmp/cognisync-frontend.log
```

### 停止服务

```bash
# 停止所有服务
./stop-all.sh

# 或者手动停止
kill $(cat /tmp/cognisync-backend.pid)
kill $(cat /tmp/cognisync-frontend.pid)
```

### 重启服务

```bash
# 停止并重新启动
./stop-all.sh
./start-all.sh
```

---

## ⚠️ 当前问题

### PostgreSQL 连接失败

**错误信息：**
```
password authentication failed for user "cognisync"
```

**解决方法：**

1. 检查 `backend/.env` 文件中的数据库配置：
```bash
DATABASE_URL=postgresql://cognisync:your_password@localhost:5432/cognisync_dev
```

2. 确保 PostgreSQL 服务正在运行：
```bash
# macOS
brew services list | grep postgresql

# 启动 PostgreSQL（如果未运行）
brew services start postgresql
```

3. 创建数据库和用户：
```bash
# 登录 PostgreSQL
psql postgres

# 创建用户和数据库
CREATE USER cognisync WITH PASSWORD 'your_password';
CREATE DATABASE cognisync_dev OWNER cognisync;
GRANT ALL PRIVILEGES ON DATABASE cognisync_dev TO cognisync;
\q
```

4. 运行数据库迁移：
```bash
cd backend
source venv/bin/activate
alembic upgrade head
```

---

## 📁 项目结构

```
cognisync---adaptive-learning-middleware/
├── backend/                    # 后端服务
│   ├── app/                    # 应用代码
│   │   ├── api/                # API 路由
│   │   ├── core/               # 核心配置
│   │   ├── db/                 # 数据库连接
│   │   ├── models/             # 数据模型
│   │   ├── schemas/            # Pydantic 模式
│   │   └── services/           # 业务逻辑
│   ├── main.py                 # 应用入口
│   ├── .env                    # 环境变量
│   └── venv/                   # Python 虚拟环境
│
├── frontend/                   # 前端界面
│   ├── features/               # 功能模块
│   │   ├── auth/               # 认证模块
│   │   └── onboarding/         # 入职流程
│   ├── components/             # UI 组件
│   ├── views/                  # 页面视图
│   ├── App.tsx                 # 应用入口
│   └── .env                    # 环境变量
│
├── start-all.sh                # 启动脚本
└── stop-all.sh                 # 停止脚本
```

---

## 🔐 环境变量配置

### 后端 (backend/.env)

```bash
# 应用配置
APP_NAME=CogniSync
APP_ENV=development
HOST=0.0.0.0
PORT=8000

# 数据库配置
DATABASE_URL=postgresql://cognisync:password@localhost:5432/cognisync_dev

# Neo4j 配置
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=your_neo4j_password

# JWT 配置
SECRET_KEY=your-secret-key-here
ACCESS_TOKEN_EXPIRE_MINUTES=30

# DeepSeek API（可选）
DEEPSEEK_API_KEY=your-deepseek-key
```

### 前端 (frontend/.env)

```bash
VITE_API_BASE_URL=http://localhost:8000
```

---

## 🧪 测试功能

### 1. 测试登录功能

访问：http://localhost:3000/login

测试账号（需先注册）：
- 邮箱：test@example.com
- 密码：Test123

### 2. 测试注册功能

访问：http://localhost:3000/register

选择注册方式：
- **量表注册**：标准化 Likert 量表（5-10 分钟）
- **AI 引导注册**：自然对话方式（10-15 分钟）

### 3. 测试 API

访问：http://localhost:8000/docs

在 Swagger UI 中测试各个 API 端点。

---

## 📝 日志位置

| 日志文件 | 路径 |
|----------|------|
| 后端日志 | `/tmp/cognisync-backend.log` |
| 前端日志 | `/tmp/cognisync-frontend.log` |
| 后端 PID | `/tmp/cognisync-backend.pid` |
| 前端 PID | `/tmp/cognisync-frontend.pid` |

---

## 🆘 故障排查

### 前端无法连接后端

1. 检查后端是否运行：
```bash
curl http://localhost:8000/docs
```

2. 检查 CORS 配置（后端 main.py）

3. 检查前端 .env 中的 API 地址

### 端口冲突

```bash
# 查看占用 8000 端口的进程
lsof -i:8000

# 查看占用 3000 端口的进程
lsof -i:3000

# 杀死进程
kill -9 <PID>
```

### 虚拟环境问题

```bash
# 重新创建虚拟环境
cd backend
rm -rf venv
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

---

## 📚 相关文档

- [认证架构文档](frontend/ARCHITECTURE_AUTH.md)
- [量表注册流程](frontend/features/onboarding/scale/README.md)
- [AI 引导注册](frontend/features/onboarding/ai/README.md)
- [后端 API 文档](backend/README.md)
- [部署指南](DEPLOYMENT_GUIDE.md)

---

## ✅ 启动成功标志

当你看到以下日志时，表示系统启动成功：

**后端日志：**
```
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8000
✅ Neo4j connected
```

**前端日志：**
```
VITE v6.4.1  ready in 399 ms
➜  Local:   http://localhost:3000/
```

---

**最后更新**: 2026-02-12
**版本**: 1.0.0
