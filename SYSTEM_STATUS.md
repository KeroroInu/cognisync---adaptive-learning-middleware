# CogniSync 系统运行状态

## ✅ 所有系统已启动并运行

### 系统概览

| 系统 | 端口 | URL | 状态 | PID |
|------|------|-----|------|-----|
| 后端 API | 8000 | http://localhost:8000 | ✅ 运行中 | 7456 |
| 用户前端 | 3000 | http://localhost:3000 | ✅ 运行中 | 11746 |
| 后台管理系统 | 3001 | http://localhost:3001 | ✅ 运行中 | 17156 |

---

## 1. 后端 API (FastAPI)

**访问地址:**
- API 服务: http://localhost:8000
- API 文档: http://localhost:8000/docs
- 交互式文档: http://localhost:8000/redoc

**状态:** ✅ 正常运行
- Neo4j 数据库: ✅ 已连接
- PostgreSQL: ⚠️ 未连接（使用内存存储，无影响）

**可用 API 端点:**
- `POST /api/auth/register` - 用户注册
- `POST /api/auth/login` - 用户登录
- `GET /api/auth/me` - 获取当前用户信息
- `GET /api/forms/active` - 获取量表模板
- `POST /api/forms/{template_id}/submit` - 提交量表答案
- `POST /api/onboarding/ai/start` - 开始AI引导对话
- `POST /api/onboarding/ai/step` - AI对话单步
- `POST /api/onboarding/ai/finish` - 完成AI引导
- 其他已有端点 (chat, profile, graph, etc.)

**日志文件:** `/tmp/cognisync-backend.log`

---

## 2. 用户前端

**访问地址:** http://localhost:3000

**状态:** ✅ 正常运行

**功能模块:**
- 登录页面: `/login`
- 注册页面: `/register`
- 量表注册: `/onboarding/scale`
- AI引导注册: `/onboarding/ai`
- 聊天界面: `/chat` (需要登录)
- 用户画像: `/profile` (需要登录)
- 知识图谱: `/knowledge-graph` (需要登录)
- 学习证据: `/evidence` (需要登录)

**已实现功能:**
- ✅ 完整的认证系统（注册、登录、退出）
- ✅ JWT Token 管理
- ✅ 路由访问控制 (RequireAuth, PublicOnly)
- ✅ 自动 401 处理
- ✅ 用户信息显示
- ✅ 量表问卷流程
- ✅ AI引导对话流程

**日志文件:** `/tmp/cognisync-frontend.log`

---

## 3. 后台管理系统

**访问地址:** http://localhost:3001

**状态:** ✅ 正常运行

**功能模块:**
- 用户管理
- 量表管理
- 系统配置
- 数据统计

**日志文件:** `/tmp/cognisync-admin.log`

---

## 管理命令

### 启动所有服务
```bash
./start-all.sh
```
自动启动：
1. 后端 API (FastAPI)
2. 用户前端 (Vite)
3. 后台管理系统 (Vite)

### 停止所有服务
```bash
./stop-all.sh
```

### 检查系统状态
```bash
./status.sh
```

### 查看实时日志
```bash
# 后端日志
tail -f /tmp/cognisync-backend.log

# 用户前端日志
tail -f /tmp/cognisync-frontend.log

# 后台管理系统日志
tail -f /tmp/cognisync-admin.log

# 查看所有日志
tail -f /tmp/cognisync-backend.log /tmp/cognisync-frontend.log /tmp/cognisync-admin.log
```

---

## 认证系统说明

### 注册流程
1. 用户访问 http://localhost:3000/register
2. 选择注册模式：量表注册 or AI引导注册
3. 填写邮箱、密码、姓名
4. 后端创建用户，返回 JWT token
5. 前端自动跳转到对应的 onboarding 流程

### 登录流程
1. 用户访问 http://localhost:3000/login
2. 输入邮箱和密码
3. 后端验证凭据，返回 JWT token
4. 前端保存 token 到 localStorage
5. 自动跳转到主页面（如果已完成 onboarding）

### Token 管理
- **存储位置:** localStorage
- **过期时间:** 24小时
- **自动刷新:** 目前无（MVP版本）
- **401 处理:** 自动清除 token 并跳转到登录页

---

## 数据存储

### MVP 版本（当前）
- **用户数据:** 内存存储（`users_db` 字典）
- **画像数据:** 内存存储（`profiles_db` 字典）
- **会话数据:** 内存存储（`sessions` 字典）

⚠️ **注意:** 服务器重启后所有数据会丢失

### 生产版本（未来）
- 用户和画像数据迁移到 PostgreSQL
- 会话数据迁移到 Redis
- 知识图谱数据使用 Neo4j（已配置）

---

## 已知问题

### PostgreSQL 连接失败
**错误信息:**
```
password authentication failed for user "cognisync"
```

**影响:** 无影响，认证系统使用内存存储

**解决方案:**
1. 检查 `backend/.env` 中的数据库配置
2. 确保 PostgreSQL 服务正在运行
3. 创建 `cognisync` 数据库和用户
4. 或者继续使用内存存储（MVP 可接受）

---

## 快速测试

### 测试用户注册
```bash
curl -X POST http://localhost:8000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "test123",
    "name": "Test User",
    "mode": "scale"
  }'
```

### 测试用户登录
```bash
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "test123"
  }'
```

### 测试获取当前用户
```bash
# 先登录获取 token
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123"}' \
  | python3 -c "import sys, json; print(json.load(sys.stdin)['token'])")

# 使用 token 获取用户信息
curl -X GET http://localhost:8000/api/auth/me \
  -H "Authorization: Bearer $TOKEN"
```

---

## 更新历史

### 2026-02-12
- ✅ 修复前端 404 错误
- ✅ 实现完整的认证 API
- ✅ 实现量表注册流程
- ✅ 实现 AI 引导注册流程
- ✅ 启动后台管理系统
- ✅ 更新启动/停止/状态脚本

---

## 技术栈

### 后端
- **框架:** FastAPI
- **认证:** JWT (PyJWT)
- **密码:** bcrypt
- **数据库:** Neo4j (已连接), PostgreSQL (未连接)
- **服务器:** Uvicorn

### 前端（用户端）
- **框架:** React 19
- **构建工具:** Vite
- **路由:** React Router v6
- **状态管理:** Zustand
- **API 客户端:** Fetch API

### 后台管理系统
- **框架:** React 19
- **构建工具:** Vite
- **路由:** React Router v6
- **UI 库:** 自定义组件

---

## 联系信息

**项目位置:** `/Users/kero_o/Desktop/cognisync---adaptive-learning-middleware`

**文档:**
- [AUTHENTICATION_FIX.md](AUTHENTICATION_FIX.md) - 认证系统修复详情
- [STARTUP_GUIDE.md](STARTUP_GUIDE.md) - 启动指南
- [README.md](README.md) - 项目说明

**时间:** 2026-02-12 22:20

---

🎉 **系统状态:** 全部正常运行
