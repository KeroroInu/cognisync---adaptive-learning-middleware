# CogniSync — 自适应学习中间件

> 面向编程教学的 AI 伴学系统，实时追踪学生认知、情感与行为状态，提供个性化引导。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.13+-green.svg)](https://python.org)
[![React](https://img.shields.io/badge/React-19-blue.svg)](https://react.dev)
[![Docker](https://img.shields.io/badge/Deploy-Docker_Compose-blue.svg)](https://docs.docker.com/compose/)

---

## 这个系统是做什么的？

CogniSync 是一个专为**编程课堂教学研究**设计的 AI 中间件系统。教师部署后，学生通过 AI 助手完成代码练习，系统在后台自动：

1. **分析每条消息**的学习意图与情感状态（10 种情绪类别）
2. **动态更新三维学习者画像**：认知（0-100）/ 情感（0-100）/ 行为（0-100）
3. **构建个人知识图谱**，追踪概念掌握轨迹
4. **调整 AI 的教学策略**（苏格拉底式引导 / 直接讲解），适配学生当前状态
5. **记录前后测量表数据**，供教学研究分析

教师通过管理后台可实时查看每位学生的学习状态、对话记录和量表结果，并可导出 CSV 数据用于研究。

---

## 系统架构

```
学生浏览器                    管理员浏览器
     │                              │
     ▼                              ▼
  /（用户前端）            /admin/（管理后台）
     │                              │
     └──────────┬───────────────────┘
                ▼
         Nginx 反向代理（单端口）
                │
     ┌──────────┼──────────┐
     ▼          ▼          ▼
  FastAPI    PostgreSQL   Neo4j
  后端 API    用户/画像    知识图谱
     │
  Redis（缓存）+ DeepSeek / OpenAI / Ollama（LLM）
```

**技术栈**

| 层 | 技术 |
|---|---|
| 学生前端 | React 19 + TypeScript + Vite + Tailwind CSS |
| 管理后台 | React 19 + TypeScript + Vite + Tailwind CSS |
| 后端 API | FastAPI + SQLAlchemy 2.0（异步） |
| 主数据库 | PostgreSQL 15 |
| 知识图谱 | Neo4j 5.15 |
| 缓存 | Redis 7 |
| LLM | DeepSeek / OpenAI / Ollama / LM Studio（可配置） |
| 部署 | Docker Compose |

---

## 核心功能

### 学生端
- **AI 对话练习**：基于代码填空任务，AI 引导学生思考，不直接给答案
- **学习画像可视化**：雷达图展示认知 / 情感 / 行为三维度实时变化
- **知识图谱**：D3.js 可视化个人概念掌握网络
- **自我校准**：学生可对 AI 评估进行自我修正，系统记录分歧程度
- **前后测量表**：课前课后填写 42 题问卷（计算思维 / 自我效能 / 学习动机 / 复杂问题解决 / 编程能力 / AI 素养）

### 管理后台
- **数据总览**：用户总数、消息数、活跃度趋势
- **用户管理**：查看所有学生的三维画像、对话记录、量表评分、校准日志
- **对话分析**：查看每条对话的情感分析数据
- **教学研究任务**：创建/编辑代码填空练习，设置 AI 教学提示，查看和导出学生提交记录
- **量表管理**：发布前测/后测问卷，导出评分数据
- **数据导出**：CSV 格式导出学生提交记录、量表评分

---

## 快速部署（Docker Compose，推荐）

### 前置条件

- 安装 [Docker Desktop](https://www.docker.com/products/docker-desktop/)（含 Docker Compose）
- 准备一个 LLM API Key（DeepSeek / OpenAI 二选一，或本地 Ollama）

### 1. 克隆项目

```bash
git clone https://github.com/KeroroInu/cognisync---adaptive-learning-middleware.git
cd cognisync---adaptive-learning-middleware
```

### 2. 配置环境变量

```bash
cp backend/.env.example backend/.env
```

编辑 `backend/.env`，填写必填项：

```bash
# ── LLM 配置（选择一种）────────────────────────────
LLM_PROVIDER=deepseek          # 可选：deepseek / openai / ollama / lmstudio

# DeepSeek（推荐，性价比高）
DEEPSEEK_API_KEY=sk-your-key-here
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat

# OpenAI（可选）
# LLM_PROVIDER=openai
# OPENAI_API_KEY=sk-your-key-here
# OPENAI_MODEL=gpt-4o-mini

# 本地 Ollama（可选，无需 API Key）
# LLM_PROVIDER=ollama
# OLLAMA_BASE_URL=http://host.docker.internal:11434/v1
# OLLAMA_MODEL=llama3.2:latest

# ── 管理员账号（首次启动自动创建）──────────────────
ADMIN_DEFAULT_STUDENT_ID=admin
ADMIN_DEFAULT_PASSWORD=your-admin-password
ADMIN_DEFAULT_NAME=系统管理员

# ── 安全配置（生产环境请修改）──────────────────────
ADMIN_KEY=your-admin-api-key
JWT_SECRET=your-random-jwt-secret-at-least-32-chars
```

### 3. 一键启动

```bash
docker compose up -d --build
```

首次启动需要拉取镜像和构建，约 5-10 分钟。

### 4. 验证部署

```bash
docker compose ps          # 检查所有容器状态
curl http://localhost:8003/health  # 检查后端健康
```

所有容器应显示 `Up`。

### 访问地址

| 地址 | 说明 |
|------|------|
| `http://localhost:8003/` | 学生端 |
| `http://localhost:8003/admin/` | 管理后台 |
| `http://localhost:8003/docs` | API 文档（Swagger） |

> 部署到公网服务器时，将 `localhost` 替换为服务器 IP，如 `http://124.x.x.x:8003/`

---

## 默认账号

| 角色 | 账号 | 密码 | 说明 |
|------|------|------|------|
| 管理员 | `admin` | 见 `.env` 中 `ADMIN_DEFAULT_PASSWORD` | 可登录管理后台 |
| 测试学生 | `kero` | `kero` | 用于验证学生端功能 |

> 生产使用时建议在管理后台删除 `kero` 测试账号，或通过管理后台为真实学生批量创建账号。

---

## 教学使用流程

### 第一步：发布前测量表

1. 登录管理后台 → **量表管理**
2. 激活「AI 教育研究量表 v1.0」（首次启动已自动创建）
3. 通知学生登录并完成前测

### 第二步：创建代码练习任务

1. 管理后台 → **教学研究** → 点击「创建任务」
2. 填写任务标题、给学生的说明
3. 在「AI 教学提示」栏填写本节课的教学目标（例如：*本节课讲解 Python 列表推导式。学生应理解语法，能将 for 循环改写为推导式。请引导学生自己发现规律，不要直接给出答案。*）
4. 粘贴或上传代码文件（带 TODO 注释的填空模板）
5. 点击「激活」发布给学生

> 已发布的任务可随时点击铅笔图标修改内容，不影响已有提交记录。

### 第三步：课堂练习

学生在 `http://你的服务器:8003/` 登录后：
- 与 AI 对话获得引导
- 在代码编辑器中填写答案
- 完成后点击「完成任务」提交

管理后台可实时查看每位学生的提交进度和代码内容。

### 第四步：发布后测 & 导出数据

1. 量表管理 → 再次激活量表（发布后测）
2. 等学生完成后测
3. 教学研究 → 点击下载图标导出提交记录（CSV）
4. 用户管理 → 进入学生详情页查看三维画像变化曲线

---

## 情感计算说明

系统通过 LLM 对每条学生消息进行分析，识别以下 10 种情绪：

| 情绪 | 说明 | 对情感维度的影响 |
|------|------|----------------|
| `curious` 好奇 | 主动探索，感兴趣 | +5 |
| `excited` 兴奋 | 热情高涨 | +8 |
| `motivated` 有动力 | 目标明确，积极 | +8 |
| `confident` 自信 | 笃定，有把握 | +3 |
| `satisfied` 满意 | 完成感 | +5 |
| `thoughtful` 深思 | 认真思考中 | +3 |
| `neutral` 中性 | 平淡，无明显情绪 | 0 |
| `anxious` 焦虑 | 担忧，不确定 | -2 |
| `confused` 困惑 | 迷茫，不理解 | -8 |
| `frustrated` 沮丧 | 受挫，想放弃 | -10 |

情感分数（0-100）实时影响 AI 的教学语气：
- **0-30**：温和鼓励，避免压力
- **31-60**：友好耐心，适当鼓励
- **61-80**：积极热情，引导深入探索
- **81-100**：挑战性语气，鼓励创新思考

---

## 环境变量完整说明

`backend/.env` 所有配置项：

```bash
# ── 应用 ──────────────────────────────────────────────
APP_NAME=CogniSync
APP_ENV=production
DEBUG=false

# ── 数据库（Docker 环境保持默认即可）──────────────────
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_USER=cognisync
POSTGRES_PASSWORD=cognisync_dev_password_2024
POSTGRES_DB=cognisync_db
DATABASE_URL=postgresql+asyncpg://cognisync:cognisync_dev_password_2024@postgres:5432/cognisync_db

# ── Neo4j ──────────────────────────────────────────────
NEO4J_URI=bolt://neo4j:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=cognisync_neo4j_2024

# ── LLM（选择一种 Provider）────────────────────────────
LLM_PROVIDER=deepseek

DEEPSEEK_API_KEY=sk-your-key-here
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat

OPENAI_API_KEY=sk-your-openai-key-here
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini

OLLAMA_BASE_URL=http://localhost:11434/v1
OLLAMA_MODEL=llama3.2:latest

# ── 安全 ──────────────────────────────────────────────
ADMIN_KEY=your-admin-api-key
JWT_SECRET=your-random-jwt-secret

# ── 默认管理员（首次启动自动创建）──────────────────────
ADMIN_DEFAULT_STUDENT_ID=admin
ADMIN_DEFAULT_PASSWORD=your-password
ADMIN_DEFAULT_NAME=系统管理员
```

---

## 常见问题

**Q: 容器启动后访问空白页？**
确认所有容器都已启动：`docker compose ps`，等待约 30 秒让后端完成数据库初始化。

**Q: 学生无法登录？**
- 登录界面使用「学号」登录，不是邮箱
- 通过管理后台 → 用户管理 → 创建账号（或让学生自行注册）

**Q: AI 回复很慢或不回复？**
检查 `backend/.env` 中的 `DEEPSEEK_API_KEY` 是否正确，或查看日志：
```bash
docker compose logs backend --tail=50
```

**Q: 如何切换 LLM？**
修改 `backend/.env` 中的 `LLM_PROVIDER`，然后重启后端：
```bash
docker compose restart backend
```

**Q: 如何备份数据？**
数据存储在 Docker 命名卷中，备份 PostgreSQL：
```bash
docker exec cognisync-postgres pg_dump -U cognisync cognisync_db > backup.sql
```

**Q: 如何更新到新版本？**
```bash
git pull
docker compose up -d --build
```
数据卷不会被删除，所有数据保留。

---

## 本地开发

如需修改代码，可以在本地运行各服务：

```bash
# 启动数据库（PostgreSQL + Redis + Neo4j）
docker compose up -d postgres redis neo4j

# 启动后端
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# 启动学生前端
cd frontend
npm install && npm run dev     # http://localhost:3000

# 启动管理后台
cd admin-frontend
npm install && npm run dev     # http://localhost:3001
```

---

## 项目结构

```
cognisync---adaptive-learning-middleware/
├── frontend/              # 学生端前端（React + Vite）
├── admin-frontend/        # 管理后台前端（React + Vite）
├── backend/               # FastAPI 后端
│   ├── app/
│   │   ├── api/           # API 路由和端点
│   │   ├── models/        # 数据模型（SQL + Neo4j）
│   │   ├── services/      # 业务逻辑（LLM、画像、图谱）
│   │   └── db/            # 数据库连接和初始化
│   ├── main.py
│   └── requirements.txt
├── nginx-proxy/           # Nginx 反向代理配置
├── docker-compose.yml     # 一键部署配置
└── deploy.sh              # 打包部署脚本
```

---

## 引用

如果本项目对你的教学研究有帮助，欢迎在论文中引用：

```
CogniSync: An Adaptive Learning Middleware for Programming Education
https://github.com/KeroroInu/cognisync---adaptive-learning-middleware
```

---

## 许可证

[MIT License](LICENSE) — 免费用于教学和研究目的。

---

## 反馈与贡献

欢迎通过 [Issues](https://github.com/KeroroInu/cognisync---adaptive-learning-middleware/issues) 提交问题或建议。
