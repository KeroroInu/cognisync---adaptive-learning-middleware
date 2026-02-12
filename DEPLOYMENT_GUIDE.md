# CogniSync 完整部署指南

## 📋 项目概览

本项目包含三个主要部分：
1. **Backend** - FastAPI 后端 API（端口 8000）
2. **Frontend** - 学生端前端（端口 3000）
3. **Admin Frontend** - 管理后台前端（端口 3001）

---

## 🚀 快速启动（本地开发）

### 1. 启动数据库

```bash
cd backend
docker-compose up -d postgres neo4j
```

等待数据库启动完成（约 10 秒）。

### 2. 配置后端环境变量

```bash
cd backend
cp .env.example .env
```

编辑 `.env` 文件，设置关键配置：

```bash
# 数据库
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/cognisync

# Admin Key（重要！）
ADMIN_KEY=your_secure_admin_key_here

# LLM 提供商
LLM_PROVIDER=mock  # 或 openai, deepseek
```

### 3. 初始化数据库（两种方式）

**方式 A: 使用 create_all()（快速，开发环境）**

```bash
cd backend
pip install -r requirements.txt
python main.py
```

数据库表会在启动时自动创建。

**方式 B: 使用 Alembic（推荐，生产环境）**

```bash
cd backend
pip install -r requirements.txt

# 生成初始迁移
alembic revision --autogenerate -m "Initial migration"

# 应用迁移
alembic upgrade head

# 启动服务
python main.py
```

详细的 Alembic 使用指南见 [backend/ALEMBIC_GUIDE.md](backend/ALEMBIC_GUIDE.md)。

### 4. 启动后端服务

```bash
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

访问 API 文档：
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

### 5. 启动学生端前端（可选）

```bash
cd frontend
npm install
npm run dev
```

访问：http://localhost:3000

### 6. 启动管理后台前端

```bash
cd admin-frontend

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env，设置 VITE_ADMIN_KEY 与后端一致

# 启动开发服务器
npm run dev
```

访问：http://localhost:3001/admin

---

## 🔐 Admin 后台使用指南

### 登录认证

管理后台使用 Header 认证方式：
- Header 名称：`X-ADMIN-KEY`
- Header 值：后端 `.env` 中的 `ADMIN_KEY`

环境变量会自动添加此 Header，无需手动操作。

### 功能模块

| 模块 | 路由 | 功能 |
|------|------|------|
| Dashboard | `/admin` | 系统概览统计 |
| Users | `/admin/users` | 用户列表、搜索、分页 |
| User Detail | `/admin/users/:id` | 用户详情、对话历史、画像时间线 |
| Scales | `/admin/scales` | 量表管板模上传、激活、归档 |
| Data Explorer | `/admin/explorer` | **核心功能**：浏览所有表数据 |
| Conversations | `/admin/conversations` | 对话管理 |
| Exports | `/admin/exports` | 数据导出 |

### Data Explorer 核心功能

这是管理后台的**最重要功能**，提供：
- ✅ 表列表（8个允许查看的表）
- ✅ 列信息展示
- ✅ 分页查询（50条/页）
- ✅ 列头排序（点击切换升序/降序）
- ✅ 导出为 JSON（下载或复制到剪贴板）
- ✅ 安全机制：表名白名单 + 敏感字段过滤

**允许查看的表：**
1. users
2. chat_sessions
3. chat_messages
4. profile_snapshots
5. calibration_logs
6. scale_templates
7. scale_responses
8. onboarding_sessions

---

## 📝 API 测试示例

### 1. 获取系统概览

```bash
curl -X GET "http://localhost:8000/api/admin/overview" \
  -H "X-ADMIN-KEY: your_admin_key_here"
```

**响应示例：**
```json
{
  "success": true,
  "data": {
    "users_count": 10,
    "sessions_count": 25,
    "messages_count": 150,
    "templates_count": 3,
    "responses_count": 45
  }
}
```

### 2. 获取用户列表

```bash
curl -X GET "http://localhost:8000/api/admin/users?page=1&page_size=10" \
  -H "X-ADMIN-KEY: your_admin_key_here"
```

### 3. 数据浏览器 - 获取表列表

```bash
curl -X GET "http://localhost:8000/api/admin/db/tables" \
  -H "X-ADMIN-KEY: your_admin_key_here"
```

**响应示例：**
```json
{
  "success": true,
  "data": [
    {"table_name": "users", "row_count": 10},
    {"table_name": "chat_sessions", "row_count": 25}
  ]
}
```

### 4. 查看表数据

```bash
curl -X GET "http://localhost:8000/api/admin/db/tables/users/rows?limit=10&offset=0&order_by=created_at&order=desc" \
  -H "X-ADMIN-KEY: your_admin_key_here"
```

### 5. 上传量表模板

```bash
curl -X POST "http://localhost:8000/api/admin/scales/upload" \
  -H "X-ADMIN-KEY: your_admin_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "认知风格量表",
    "version": 1,
    "schema_json": {
      "questions": [
        {"id": "q1", "text": "你更倾向于系统性思考吗？", "type": "likert"}
      ]
    },
    "scoring_json": {"q1": {"1": 0, "5": 100}},
    "mapping_json": {"cognition": ["q1"]}
  }'
```

### 6. 导出表数据

```bash
curl -X GET "http://localhost:8000/api/admin/db/export?table=users&format=json" \
  -H "X-ADMIN-KEY: your_admin_key_here" > users_export.json
```

---

## 🎨 UI 风格统一说明

Admin Frontend 与现有 Frontend 完全一致的 UI 风格：

### 共享的设计元素

1. **CSS 样式文件**：直接复用 `frontend/index.css`
2. **主题系统**：Light/Dark 双主题，localStorage 持久化
3. **颜色变量**：完全相同的 CSS 变量定义
4. **动画系统**：fadeIn、slideInRight、slideInLeft、scaleIn
5. **玻璃卡片**：glass-card 样式
6. **渐变按钮**：indigo-purple 渐变

### 风格规范

| 元素 | 样式 |
|------|------|
| 卡片 | `glass-card p-6 rounded-2xl` |
| 按钮 | `bg-gradient-to-r from-indigo-500 to-purple-600` |
| 输入框 | `rounded-xl py-3 px-4 focus:ring-2 focus:ring-indigo-500/20` |
| Badge | `px-2 py-1 rounded text-xs` |
| 动画 | `animate-fade-in stagger-{1-6}` |

### 颜色系统

| 用途 | 浅色 | 深色 |
|------|------|------|
| 主背景 | #ffffff | #0f172a |
| 次背景 | #f9fafb | #1e293b |
| 品牌蓝 | #3b82f6 | - |
| 品牌紫 | #8b5cf6 | - |
| 品牌绿 | #10b981 | - |

---

## 📁 项目文件结构

```
cognisync---adaptive-learning-middleware/
├── backend/                          # FastAPI 后端
│   ├── alembic/                      # 数据库迁移
│   │   ├── versions/                 # 迁移脚本
│   │   ├── env.py                    # Alembic 环境配置
│   │   └── script.py.mako            # 迁移模板
│   ├── app/
│   │   ├── api/
│   │   │   ├── admin_router.py       # Admin 路由聚合
│   │   │   ├── router.py             # 常规 API 路由
│   │   │   └── endpoints/
│   │   │       ├── admin/            # Admin 端点（7个）
│   │   │       │   ├── overview.py
│   │   │       │   ├── users.py
│   │   │       │   ├── user_detail.py
│   │   │       │   ├── scales.py
│   │   │       │   ├── explorer.py   # 数据浏览器
│   │   │       │   ├── analytics.py
│   │   │       │   └── export.py
│   │   │       └── onboarding.py     # 新增：入职流程 API
│   │   ├── models/sql/               # SQLAlchemy 模型（8个表）
│   │   ├── schemas/                  # Pydantic 数据模型
│   │   ├── services/                 # 业务逻辑层
│   │   ├── core/                     # 配置、安全、日志
│   │   └── db/                       # 数据库连接管理
│   ├── tests/                        # 单元测试
│   │   ├── test_admin_endpoints.py
│   │   ├── test_api_endpoints.py
│   │   └── test_onboarding_endpoints.py  # 新增
│   ├── alembic.ini                   # Alembic 配置
│   ├── ALEMBIC_GUIDE.md              # Alembic 使用指南
│   ├── docker-compose.yml            # 数据库编排
│   ├── main.py                       # FastAPI 应用入口
│   └── requirements.txt              # 依赖（新增 alembic）
│
├── frontend/                         # 学生端前端
│   ├── src/
│   │   ├── components/
│   │   ├── views/
│   │   └── services/
│   ├── index.css                     # **核心样式文件**
│   └── package.json
│
└── admin-frontend/                   # 管理后台前端（新建）
    ├── src/
    │   ├── components/
    │   │   └── AdminLayout.tsx       # 主布局（侧边栏 + 顶部栏）
    │   ├── pages/
    │   │   ├── Dashboard.tsx         # 概览
    │   │   ├── Users.tsx             # 用户列表
    │   │   ├── UserDetail.tsx        # 用户详情
    │   │   ├── Scales.tsx            # 量表管理
    │   │   ├── DataExplorer.tsx      # 数据浏览器（核心）
    │   │   ├── Conversations.tsx     # 对话管理
    │   │   └── Exports.tsx           # 数据导出
    │   ├── lib/
    │   │   ├── adminApi.ts           # API 客户端
    │   │   └── useTheme.ts           # 主题切换 Hook
    │   ├── types/
    │   │   └── index.ts              # TypeScript 类型
    │   ├── index.css                 # 样式（复制自 frontend）
    │   ├── App.tsx                   # 路由配置
    │   └── main.tsx                  # 入口文件
    ├── index.html                    # HTML 模板
    ├── vite.config.ts                # Vite 配置
    ├── package.json                  # 依赖管理
    ├── README.md                     # 详细文档
    └── .env                          # 环境变量
```

---

## ✅ 完成功能清单

### 后端补充（任务2完善）

- [x] Alembic 数据库迁移配置
  - [x] alembic.ini 配置文件
  - [x] env.py 环境配置（支持异步）
  - [x] script.py.mako 迁移模板
  - [x] ALEMBIC_GUIDE.md 使用指南
  - [x] requirements.txt 添加 alembic==1.13.1

- [x] 入职流程 API 端点
  - [x] onboarding.py 模型（已存在）
  - [x] onboarding.py schema
  - [x] onboarding.py 端点（CRUD 操作）
  - [x] test_onboarding_endpoints.py 测试

- [x] 扩展测试覆盖
  - [x] test_onboarding_endpoints.py（6个测试用例）

### 前端完成（任务3）

- [x] 项目初始化
  - [x] package.json（React 19 + TypeScript + Vite）
  - [x] tsconfig.json / tsconfig.node.json
  - [x] vite.config.ts（端口 3001 + API 代理）
  - [x] index.html（Tailwind CDN）
  - [x] .env / .env.example

- [x] 核心库和工具
  - [x] types/index.ts（完整类型定义）
  - [x] lib/adminApi.ts（API 客户端，统一响应处理）
  - [x] lib/useTheme.ts（主题切换 Hook）
  - [x] index.css（复制自 frontend，完全一致）

- [x] 布局和组件
  - [x] AdminLayout.tsx（左侧导航 + 顶部栏 + 主题切换）

- [x] 页面组件（7个）
  - [x] Dashboard.tsx（系统概览统计，4个卡片）
  - [x] Users.tsx（用户列表，搜索 + 分页）
  - [x] UserDetail.tsx（用户详情，3个 Tabs）
  - [x] Scales.tsx（量表管理，上传 + 激活 + 归档）
  - [x] DataExplorer.tsx（数据浏览器，核心功能）
  - [x] Conversations.tsx（对话管理）
  - [x] Exports.tsx（数据导出）

- [x] 路由和入口
  - [x] App.tsx（React Router 配置，7条路由）
  - [x] main.tsx（应用入口）

- [x] 文档
  - [x] README.md（完整使用指南）
  - [x] DEPLOYMENT_GUIDE.md（本文档）

---

## 🔍 验证步骤

### 1. 后端验证

```bash
# 启动后端
cd backend
python main.py

# 测试 Admin API
curl http://localhost:8000/api/admin/overview \
  -H "X-ADMIN-KEY: your_admin_key_here"

# 测试入职流程 API
curl http://localhost:8000/api/onboarding \
  -H "Content-Type: application/json" \
  -d '{"user_id": "...","mode": "guided"}'
```

### 2. 前端验证

```bash
# 启动管理后台
cd admin-frontend
npm run dev

# 访问各个页面
- http://localhost:3001/admin
- http://localhost:3001/admin/users
- http://localhost:3001/admin/explorer
```

### 3. 功能验证

- [ ] Dashboard 显示正确的统计数据
- [ ] Users 列表可以搜索和分页
- [ ] UserDetail 显示用户信息和三维画像
- [ ] Scales 可以上传 JSON 文件
- [ ] DataExplorer 可以浏览所有表
- [ ] 主题切换（Light/Dark）正常工作
- [ ] 导出功能可以下载 JSON

---

## 🐛 常见问题

### 1. API 请求 401 错误

**原因**: Admin Key 不匹配

**解决方案**:
```bash
# 检查后端 .env
grep ADMIN_KEY backend/.env

# 检查前端 .env
grep VITE_ADMIN_KEY admin-frontend/.env

# 确保两者一致
```

### 2. CORS 错误

**原因**: 后端 CORS 配置未包含前端地址

**解决方案**:
编辑 `backend/app/core/config.py`：
```python
CORS_ORIGINS: list[str] = [
    "http://localhost:3000",
    "http://localhost:3001",  # 添加这行
]
```

### 3. 数据库连接失败

**原因**: PostgreSQL 未启动或配置错误

**解决方案**:
```bash
# 检查数据库状态
docker ps

# 重启数据库
cd backend
docker-compose restart postgres

# 检查连接字符串
grep DATABASE_URL backend/.env
```

### 4. Alembic 迁移失败

**原因**: 表已存在或迁移冲突

**解决方案**:
```bash
# 查看当前版本
alembic current

# 标记现有数据库为最新
alembic stamp head

# 重新生成迁移
alembic revision --autogenerate -m "Fix migration"
```

---

## 📊 性能建议

### 后端优化

1. **数据库连接池**: 已配置 SQLAlchemy 异步连接池
2. **索引优化**: 所有查询字段已添加索引
3. **分页查询**: 所有列表接口支持分页
4. **缓存**: 考虑添加 Redis 缓存（TODO）

### 前端优化

1. **代码分割**: Vite 自动进行代码分割
2. **懒加载**: 考虑对大页面使用 React.lazy（TODO）
3. **图片优化**: 使用 WebP 格式（TODO）
4. **API 缓存**: 考虑使用 TanStack Query（TODO）

---

## 🔒 安全检查清单

- [x] Admin Key 使用环境变量
- [x] 敏感字段（hashed_password）已过滤
- [x] 表名使用白名单（防止 SQL 注入）
- [x] 列名验证（防止 SQL 注入）
- [ ] 生产环境使用 HTTPS（TODO）
- [ ] 设置 Rate Limiting（TODO）
- [ ] 添加审计日志（TODO）

---

## 📈 下一步计划

### 短期（1-2周）

1. 添加更多测试覆盖（目标 80%）
2. 实现 Redis 缓存
3. 添加 Rate Limiting
4. 完善错误处理和用户提示

### 中期（1-2月）

1. 实现完整的用户认证系统（JWT）
2. 添加权限管理（RBAC）
3. 实现实时通知（WebSocket）
4. 添加数据可视化图表

### 长期（3-6月）

1. 微服务架构拆分
2. 实现分布式追踪
3. 添加 Kubernetes 部署配置
4. 实现 CI/CD 流程

---

## 🤝 贡献指南

欢迎贡献代码！请遵循以下步骤：

1. Fork 项目
2. 创建功能分支：`git checkout -b feature/xxx`
3. 提交代码：`git commit -m 'Add xxx'`
4. 推送分支：`git push origin feature/xxx`
5. 创建 Pull Request

**代码规范**:
- 后端：Black + isort + mypy
- 前端：ESLint + Prettier
- 提交信息：遵循 Conventional Commits

---

## 📞 联系方式

- 项目文档：[README.md](README.md)
- 后端文档：[backend/README.md](backend/README.md)
- 前端文档：[admin-frontend/README.md](admin-frontend/README.md)
- Issue 提交：GitHub Issues

---

## 📄 许可证

MIT License

Copyright (c) 2025 CogniSync Team
