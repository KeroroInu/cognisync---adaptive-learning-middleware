# CogniSync — AI 时代的项目解构式编程学习平台

> **从解构，到建构。**
>
> 以项目解构为学习主线、以 AI 过程支架为中间层，帮助学生从观察完整项目走向自主建构、验证与反思。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.13+-green.svg)](https://python.org)
[![React](https://img.shields.io/badge/React-19-blue.svg)](https://react.dev)
[![Docker](https://img.shields.io/badge/Deploy-Docker_Compose-blue.svg)](https://docs.docker.com/compose/)

---

## 这个系统是做什么的？

CogniSync 是一个面向**编程课堂教学研究**的项目解构学习与过程诊断平台，也是项目解构式教学（Project Deconstruction Teaching, PDT）的数字化实施载体。系统围绕以下学习主线组织学生端体验：

> 完整项目运行与观察 → 命名功能并描述实现 → 单功能流程表达 → 七函数协同建构 → 完整运行与创意扩展

AI 不代替学生完成解构和代码建构，而是在关键节点分析过程信息、提出追问并提供适量支架。当前系统已经提供项目任务、AI 对话、学习者画像、知识图谱、校准、量表、过程记录和研究数据导出等基础能力；专用项目解构工作台是当前迭代的核心方向。

在运行过程中，系统可以：

1. **承载完整编程项目与分步任务**，为“解构—建构—验证”提供共同项目环境。
2. **分析学生对话与过程信息**，识别学习意图、情感状态和概念线索。
3. **动态更新三维学习者画像**：认知（0-100）/ 情感（0-100）/ 行为（0-100）。
4. **构建个人知识图谱**，呈现学生接触的概念及其关系。
5. **调整 AI 支架方式**，在追问、解释和局部提示之间匹配学生当前状态。
6. **记录量表、校准、代码进度与提交数据**，供课堂诊断和教学研究分析。

教师通过管理后台可实时查看每位学生的学习状态、对话记录和量表结果，并可导出 CSV 数据用于研究。

---

## 系统架构

### 总体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         客户端层                                  │
├──────────────────────────┬──────────────────────────────────────┤
│   学生端 (React)         │      管理端 (React)                   │
│   Port: 3000/8003       │      Port: 3001/8003/admin/          │
│   - 学习对话            │      - 用户管理                       │
│   - 知识图谱可视化       │      - 数据分析                       │
│   - 研究任务编程         │      - 研究数据导出                   │
└──────────────┬───────────┴──────────────┬───────────────────────┘
               │                          │
               │    HTTP/REST API        │
               ▼                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                  应用服务层 (FastAPI)                             │
│                      Port: 8000/8003                             │
├─────────────────────────────────────────────────────────────────┤
│  API层           │  核心服务层          │  数据访问层             │
│  /api/auth       │  TextAnalyzer       │  SQLAlchemy ORM       │
│  /api/chat       │  Personalization    │  Neo4j Driver         │
│  /api/profile    │  EmotionCoding      │  Async connection pool│
│  /api/graph      │  GraphService       │                       │
│  /api/admin      │  ProfileService     │                       │
└──────┬──────────┴──────────┬───────────┴──────────┬─────────────┘
       │                     │                      │
       ▼                     ▼                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                        数据持久层                                 │
├──────────────────┬──────────────────┬───────────────────────────┤
│  PostgreSQL 15   │   Neo4j 5.x      │   可降级依赖              │
│  Port: 5432      │   Port: 7687     │   图谱短暂不可用时       │
│                  │                  │   学生对话与画像仍可继续   │
│  - 用户数据      │   - 知识图谱     │                           │
│  - 对话记录      │   - 概念关系     │                           │
│  - 学习画像      │   - 学习路径     │                           │
│  - 过程研究数据  │                  │                           │
└──────────────────┴──────────────────┴───────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    外部服务层 (LLM)                               │
├─────────────────────────────────────────────────────────────────┤
│  OpenAI API  │  DeepSeek API  │  Ollama (本地)  │  LMStudio     │
└─────────────────────────────────────────────────────────────────┘
```

**技术栈**

| 层 | 技术 | 说明 |
|---|---|---|
| 学生前端 | React 19 + TypeScript + Vite | D3.js 知识图谱可视化、CodeMirror 代码编辑、Pyodide 浏览器端 Python 运行时 |
| 管理后台 | React 19 + TypeScript + Vite | React Router 6、react-i18next、React Query、Recharts 数据可视化 |
| 后端 API | FastAPI 0.128 + SQLAlchemy 2.0 | 全异步架构、Pydantic 数据验证、JWT 认证 |
| 主数据库 | PostgreSQL 15 | 用户、对话、学习画像、情感分析结果 |
| 知识图谱 | Neo4j 6.1.0 | 概念节点、学习关系、知识路径推理 |
| LLM | DeepSeek / OpenAI / Ollama / LM Studio | 多模型抽象层、统一接口、降级策略 |
| 部署 | Docker Compose | 单命令启动、Nginx 反向代理 |

> 当前版本不引入 Redis。40–50 人课堂规模先优化 LLM 调用、数据库查询和代码执行链路；只有在压测证明需要跨进程热缓存、分布式限流或异步任务队列时，再将 Redis 作为独立基础设施引入。

### 核心技术创新

#### 1. 三维学习画像模型 (C-A-B Model)

系统实时追踪并量化学生的三个维度状态（0-100分）：

- **Cognition (认知)**：知识掌握度、理解深度、问题解决能力
- **Affect (情感)**：学习动机、情绪状态、心理韧性
- **Behavior (行为)**：学习习惯、自主性、坚持度

画像以注册量表或 AI 问答的初始快照为起点；之后认知信号优先由知识图谱计算，情感和行为信号按可追溯的过程记录更新，所有维度约束在 0–100。

#### 2. 十三情感编码系统

基于 Valence-Arousal 心理学模型，识别 13 种精细化学习情感状态（E01-E13），每种情感映射到具体的教学干预策略：

| 代码 | 情感 | 效价 | 唤醒度 | 教学策略 |
|------|------|------|--------|---------|
| E01 | confused | -0.55 | 0.35 | 提供脚手架支持 |
| E02 | curious | 0.35 | 0.45 | 引导探索 |
| E03 | frustrated | -0.75 | 0.70 | 降低难度+鼓励 |
| E04 | engaged | 0.60 | 0.65 | 保持挑战 |
| E05 | bored | -0.30 | 0.10 | 增加趣味性 |
| E06 | confident | 0.70 | 0.50 | 提高难度 |
| E07 | anxious | -0.60 | 0.75 | 情感支持 |
| E08 | satisfied | 0.65 | 0.30 | 总结巩固 |
| E09 | overwhelmed | -0.70 | 0.80 | 分解任务 |
| E10 | neutral | 0.00 | 0.30 | 激发兴趣 |
| E11 | excited | 0.80 | 0.85 | 引导深入 |
| E12 | reflective | 0.20 | 0.25 | 促进元认知 |
| E13 | discouraged | -0.80 | 0.40 | 强化鼓励 |

#### 3. 苏格拉底式 AI 教学法

系统通过提示词工程强制 LLM 采用问答式引导，而非直接给出答案：
- 根据认知水平（C）调整问题开放性
- 结合情感状态（A）调整语气和支持力度
- 依据行为特征（B）决定引导的主动/被动程度

#### 4. 双数据库混合架构

- **PostgreSQL**：结构化数据（用户、对话、分析结果），保证事务一致性
- **Neo4j**：知识图谱（概念节点、学习关系、路径推理），支持复杂图查询

优势：既保证数据完整性，又支持知识图谱的高效遍历和推理

---

## 核心功能

### 学生端
- **单项目直达工作区**：已分组学生登录后直接进入当前课堂项目
- **项目观察与功能表达**：从真实运行证据创建观察卡、功能卡和单功能流程图
- **七函数建构**：在浏览器内编写、测试并组合七个基础函数，测试通过后才接入共享游戏
- **受控创意扩展**：通过安全事件和对象协议实现加速、障碍、炸弹、传送门等奖励或规则变化
- **阶段感知 AI 支架**：读取当前任务、环节、功能卡、代码和测试反馈，L0—L3 受教师冻结蓝图约束
- **前后测量表**：按教师发布的量表完成课堂测量

### 管理后台
- **数据总览**：用户总数、消息数、活跃度趋势
- **用户管理**：查看所有学生的三维画像、对话记录、量表评分、校准日志
- **对话分析**：查看每条对话的情感分析数据
- **情感分析**：查看情绪编码分布、时间趋势与学生级过程明细
- **教学研究任务**：创建/编辑代码填空练习，设置 AI 教学提示，查看和导出学生提交记录
- **量表管理**：发布前测/后测问卷，导出评分数据
- **数据导出**：CSV 格式导出学生提交记录、量表评分

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

# ── 生产环境不自动创建默认账号或演示数据 ─────────
SEED_DEFAULT_ADMIN=false
SEED_TEST_DATA=false

# ── 安全配置（生产环境请修改）──────────────────────
ADMIN_KEY=replace-with-a-random-key-at-least-24-chars
JWT_SECRET=your-random-jwt-secret-at-least-32-chars
```

### 3. 一键启动

```bash
export ADMIN_KEY='replace-with-a-random-key-at-least-24-chars'
docker compose up -d --build
```

`ADMIN_KEY` 由 Compose 在启动时显式注入后端，不能使用示例短密钥。仅在本机预览时，可通过
`APP_ENV=development` 启动；服务器部署应保持默认的 `production`。

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
| 管理员 | `admin` | `admin` | 可登录管理后台 |
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

系统通过 LLM 对每条学生消息进行分析，基于 **Valence-Arousal 心理学模型**识别 13 种精细化学习情感（E01-E13）：

| 代码 | 情绪 | 效价 | 唤醒度 | 对情感维度影响 | 教学策略 |
|------|------|------|--------|---------------|---------|
| E01 | `confused` 困惑 | -0.55 | 0.35 | -8 | 提供脚手架支持，分解问题 |
| E02 | `curious` 好奇 | 0.35 | 0.45 | +5 | 引导探索，激发兴趣 |
| E03 | `frustrated` 沮丧 | -0.75 | 0.70 | -10 | 降低难度，强化鼓励 |
| E04 | `engaged` 投入 | 0.60 | 0.65 | +8 | 保持挑战，深化学习 |
| E05 | `bored` 无聊 | -0.30 | 0.10 | -5 | 增加趣味性，变化形式 |
| E06 | `confident` 自信 | 0.70 | 0.50 | +3 | 提高难度，拓展思维 |
| E07 | `anxious` 焦虑 | -0.60 | 0.75 | -2 | 情感支持，降低压力 |
| E08 | `satisfied` 满意 | 0.65 | 0.30 | +5 | 总结巩固，迁移应用 |
| E09 | `overwhelmed` 不知所措 | -0.70 | 0.80 | -9 | 分解任务，逐步引导 |
| E10 | `neutral` 中性 | 0.00 | 0.30 | 0 | 激发兴趣，主动引导 |
| E11 | `excited` 兴奋 | 0.80 | 0.85 | +8 | 引导深入，鼓励创新 |
| E12 | `reflective` 深思 | 0.20 | 0.25 | +3 | 促进元认知，鼓励反思 |
| E13 | `discouraged` 气馁 | -0.80 | 0.40 | -7 | 强化鼓励，小步成功 |

**情感分数（0-100）实时影响 AI 的教学策略：**
- **0-30**：温和鼓励，避免压力，提供大量支持
- **31-60**：友好耐心，适当鼓励，平衡引导
- **61-80**：积极热情，引导深入探索
- **81-100**：挑战性语气，鼓励创新思考和自主探索

**核心对话流程：**

```
学生发送消息
    ↓
TextAnalyzer 分析
    ├─ LLM 提取：主题、情感、认知关键词
    ├─ 情感编码：映射到 E01-E13
    └─ 结合历史画像精炼结果
    ↓
ProfileService 更新三维画像
    ├─ C (认知) = 0.7 * 历史C + 0.3 * 当前分析
    ├─ A (情感) = f(Valence, Arousal)
    └─ B (行为) = f(参与度, 一致性)
    ↓
GraphService 更新知识图谱
    ├─ 创建概念节点 (Neo4j)
    ├─ 建立学习关系
    └─ 更新掌握度
    ↓
PersonalizationService 生成个性化回复
    ├─ 根据 C 调整问题难度
    ├─ 根据 A 调整语气支持
    └─ 根据 B 调整引导方式
    ↓
返回 AI 回复 + 更新后的画像
```

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

SEED_DEFAULT_ADMIN=false
SEED_TEST_DATA=false
```

系统不内置默认管理员密码。首次部署后，用 `ADMIN_KEY` 调用一次 `/api/admin/auth/create-admin` 创建管理员，随后通过管理端的学号和密码登录。

```bash
curl -X POST http://localhost:8003/api/admin/auth/create-admin \
  -H 'Content-Type: application/json' \
  -H 'X-ADMIN-KEY: 你配置的ADMIN_KEY' \
  -d '{"student_id":"teacher-admin","password":"请换成强密码","name":"系统管理员"}'
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
# 启动数据库（PostgreSQL + Neo4j）
docker compose up -d postgres neo4j

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
CogniSync: Project Deconstruction Learning for the AI Era
https://github.com/KeroroInu/cognisync---adaptive-learning-middleware
```

---

## 许可证

[MIT License](LICENSE) — 免费用于教学和研究目的。

---

## 反馈与贡献

欢迎通过 [Issues](https://github.com/KeroroInu/cognisync---adaptive-learning-middleware/issues) 提交问题或建议。

---

## 附录：论文写作建议

### A. 推荐章节结构

```
第一章 绪论
  1.1 研究背景
  1.2 研究意义
  1.3 国内外研究现状
  1.4 研究内容与创新点

第二章 系统需求分析
  2.1 功能需求
  2.2 非功能需求
  2.3 用例分析

第三章 关键技术研究
  3.1 学习者建模理论 (C-A-B三维模型)
  3.2 情感计算与 Valence-Arousal 模型
  3.3 苏格拉底式教学法的计算实现
  3.4 知识图谱构建技术

第四章 系统架构设计
  4.1 总体架构 (引用本文档「系统架构」章节)
  4.2 后端服务架构
  4.3 数据库设计
  4.4 前端架构

第五章 核心算法实现
  5.1 三维画像更新算法
  5.2 十三情感编码算法
  5.3 个性化提示词生成
  5.4 知识图谱推理算法

第六章 系统实现与测试
  6.1 开发环境与工具链
  6.2 关键模块实现
  6.3 功能测试
  6.4 性能测试

第七章 总结与展望
  7.1 工作总结
  7.2 创新点总结
  7.3 不足与改进方向
```

### B. 核心技术亮点（可直接引用）

#### 三维学习画像数学定义

```
Profile(u,t) = (C(u,t), A(u,t), B(u,t))

其中:
C(u,t) ∈ [0,100] - 用户 u 在时间 t 的认知水平
A(u,t) ∈ [0,100] - 情感状态
B(u,t) ∈ [0,100] - 行为习惯

更新公式（加权移动平均）:
C(u,t+1) = α·C(u,t) + (1-α)·f_cog(msg, history)
其中 α = 0.7 为历史权重
```

#### 系统性能指标

- **并发基线**：以单班 40–50 人同时使用为最低压测目标。
- **浏览器侧运行**：七函数、创意函数和游戏循环由 Pyodide Worker 在学生设备本地执行，不把每帧计算集中到后端。
- **连接控制**：PostgreSQL 连接池、分析/对话模型各自的并发限制、HTTP Keep-Alive、总超时和有限重试均可配置。
- **验证边界**：已有研究事件并发测试和 50 并发画像读取冒烟测试；完整聊天链路仍必须在目标服务器与实际模型供应商上压测。

#### 技术选型理由

- **FastAPI**：原生异步请求处理，适合数据库和模型 API 等 I/O 密集链路
- **Neo4j**：保存学生概念节点、掌握度与概念关系
- **React 19**：承载学生工作台与管理端交互界面
- **PostgreSQL 15**：成熟的事务支持，丰富的数据类型

### C. 数据库设计详解

#### PostgreSQL 核心表

```sql
-- 用户表
users (id, student_id, email, password_hash, role, experiment_group, created_at)

-- 学习画像快照
profile_snapshots (id, user_id, cognition, affect, behavior, source, created_at)

-- 对话消息表
chat_sessions (id, user_id, created_at)
chat_messages (id, user_id, session_id, role, text, analysis, timestamp)

-- 情感过程日志
emotion_logs (id, user_id, session_id, message_id, emotion_code,
              intensity, valence, arousal, confidence, created_at)

-- 研究任务、工作区与冻结蓝图
research_tasks (id, title, status, target_group, current_blueprint_version_id)
research_task_submissions (id, task_id, user_id, workspace_data,
                           blueprint_version_id, started_at, submitted_at)

-- 不可覆盖的过程证据
stage_events / stage_artifacts / artifact_versions / scaffold_events
```

#### Neo4j 图数据模型

```cypher
// 节点类型
(:Student {id})
(:Concept {uid, name, category})

// 关系类型
(:Student)-[:INTERACTED_WITH {mastery, count, lastUpdated}]→(:Concept)
(:Concept)-[:CO_OCCURRED_WITH {count}]→(:Concept)
(:Concept)-[:PREREQUISITE_OF]→(:Concept)

// 典型查询：获取用户知识图谱
MATCH (s:Student {id: $user_id})-[r:INTERACTED_WITH]→(c:Concept)
RETURN c.uid, c.name, c.category, r.mastery, r.count
ORDER BY r.lastUpdated DESC
```

### D. 当前工程边界与下一步

#### 高优先级 (P0)

1. **聊天链路容量与重构**（`backend/app/api/endpoints/chat.py`）
   - 当前：外部模型等待前已显式结束只读事务；该文件仍同时编排消息、分析、画像、图谱、支架与回复。
   - 改进：只做保持行为和研究事件语义不变的服务拆分，不与教学流程改动混合。
2. **LLM 总超时与单层重试**（`backend/app/services/llm_provider.py`）
   - 当前：已只保留 Provider 的一层有限重试；分析和回复分别使用 15 秒与 30 秒整轮时限。
   - 边界：这是故障放大保护，真实模型吞吐仍需在目标服务器定容。
3. **学生端保持单项目入口**（`frontend/App.tsx`）
   - 当前：已分组学生登录后直接进入唯一课堂项目，使用有限状态切换而不是多页面导航。
   - 边界：除非未来重新开放多个学生页面，否则不为形式统一引入 React Router。
4. **补完整聊天并发测试**
   - 当前：后端已有 219 项测试，包含 40 名独立学生完整聊天并发基线；模型等待时连接池无检出连接，40 个请求均完成。
   - 改进：增加聊天、工作区保存与研究事件混合负载；在目标服务器和真实模型供应商上记录 P50/P95、错误率、模型排队与连接池等待。

#### 中优先级 (P1)

1. **对话幂等**：让相同请求 ID 的网络重放复用原结果，不重复写消息、画像和模型调用。
2. **前端协调器拆分**：逐步拆分 `Research.tsx` 与 `ProjectBuildStage.tsx`，但不与教学流程改动混在同一提交。
3. **后端协调器拆分**：逐步拆分 `chat.py` 与 `research.py`，保留现有事务和研究证据语义。
4. **轻量观测**：先记录请求总耗时、模型等待和连接池等待；压测证明需要后再选择监控基础设施。

#### 低优先级 (P2)

1. **多实例部署**：迁移改为独立任务或咨询锁后，再评估多 worker / 多副本。
2. **缓存或队列**：只有跨进程共享、限流或后台任务被压测证明为瓶颈时才引入 Redis。

---

## 附录：核心代码文件清单

### 后端核心文件

```
backend/app/
├── api/endpoints/
│   ├── chat.py - 一轮对话与支架送达编排
│   ├── research.py - 学生任务、工作区与蓝图接口
│   └── admin/ - 管理、诊断与研究导出接口
├── services/
│   ├── learning_agent_harness.py - 环节、功能卡与历史作用域
│   ├── scaffold_service.py - 蓝图策略与 L0—L3 边界
│   ├── research_event_service.py - 过程证据、幂等和版本
│   ├── text_analyzer.py / profile_service.py - 情感分析与画像
│   ├── graph_service.py - 知识图谱
│   └── llm_provider.py / llm_config.py - 模型抽象和连接复用
├── models/sql/ - SQLAlchemy 模型
├── schemas/ - Pydantic 契约
└── core/、db/ - 配置、安全、PostgreSQL 与 Neo4j
```

### 前端核心文件

```
frontend/
├── App.tsx - 登录、分组守卫和唯一项目入口
├── views/Research.tsx - 项目工作台总协调器
├── components/ProjectFunctionStage.tsx - 功能卡
├── components/ProjectMechanismStage.tsx - 单功能流程图
├── components/ProjectBuildStage.tsx - 七函数与创意扩展
├── components/ProjectScaffoldAssistant.tsx - 阶段感知 AI
├── services/pythonModuleRunner.ts - 浏览器安全 Python 运行器
└── services/stageEvents.ts - 研究过程证据上报

admin-frontend/
├── App.tsx - React Router
├── features/auth/ - 管理员认证
└── lib/
    ├── adminApi.ts - 管理接口
    └── projectBlueprint.ts - 教师蓝图契约
```
