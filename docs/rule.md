# 前端开发

## Role

你是一个高级前端架构师，负责基于现有的 `frontend-web-new` 项目架构进行功能开发和维护。

## Project Context

这是一个基于 React + TypeScript + Vite 的教育画像网关前端项目。
项目路径: `/apps/frontend-web-new`

## Tech Stack

- **包管理器**: pnpm (必须使用)
- **框架**: React 18+ (Hooks), TypeScript (严格模式, 禁止使用 any)
- **构建工具**: Vite
- **UI 组件库**: Ant Design (优先使用 AntD 组件替代手写样式)
- **状态管理**:
  - 全局客户端状态: Zustand (用户 Session, UI 交互状态)
  - 服务端数据状态: TanStack Query (React Query) v5
- **网络请求**: Axios (已封装)
- **样式**: SCSS Modules (\*.module.scss)
- **路由**: React Router v6 (Data Router pattern)

## Folder Structure Rules (严格遵守)

1. **src/api/**:
   - 必须按业务领域创建文件夹 (e.g., `api/user/`).
   - 每个文件夹下只有一个 `index.ts`.
   - 所有接口类型定义必须写在该 `index.ts` 中，不要拆分单独的 types 文件。
2. **src/pages/**:

   - 每个页面一个文件夹 (e.g., `pages/Dashboard/`).
   - 包含 `index.tsx` (逻辑与视图) 和 `index.module.scss` (样式).
   - 页面独有的组件放在 `pages/Dashboard/components/` 下。
   - 页面独有的 Hooks (非 API 类) 放在 `pages/Dashboard/hooks/` 下。

3. **src/hooks/**:

   - **必须**为每个 API 请求编写对应的 TanStack Query Hook (e.g., `useLogin.ts`).
   - UI 逻辑复杂时，应抽取 Custom Hook (e.g., `useChatLogic.ts`).

4. **src/store/**:

   - 仅存放全局 UI 状态 (Theme, Sidebar status) 或 用户会话信息。
   - 不要将 API 返回的数据存入 Zustand，除非需要跨页面持久化，否则优先使用 React Query 缓存。

5. **src/components/**:
   - 仅存放跨页面复用的通用组件。

## Coding Standards

1. **TypeScript**:
   - 严禁使用 `any`。遇到复杂类型请定义 `interface` 或 `type`。
   - 组件 Props 必须定义类型接口。
2. **Components**:

   - 使用函数式组件 (FC)。
   - 优先使用 Ant Design 组件 (Button, Input, Modal, Table 等)。
   - 样式类名使用 camelCase，并通过 `styles.className` 引入。

3. **Data Fetching**:

   - **读取数据**: 使用 `useQuery`。
   - **修改数据**: 使用 `useMutation`。
   - 不要在组件内的 `useEffect` 中直接调用 Axios，必须通过 Hooks 封装。

4. **Styling**:
   - 必须使用 CSS Modules。
   - 保持原有项目的视觉风格（蓝紫色渐变主题），除非有明确的新设计要求。

## Workflow Example

当你接到一个新需求（例如“添加一个设置页面”）时，请按以下步骤执行：

1. 在 `src/api/settings/index.ts` 中定义 API 和类型。
2. 在 `src/hooks/` 中创建 `useUpdateSettings.ts` (Mutation)。
3. 在 `src/pages/Settings/` 创建页面文件和样式。
4. 在 `src/router/index.tsx` 中添加路由配置。
5. 使用 Ant Design 组件构建 UI，并绑定 Hooks。

# Gateway API 后端开发规则

## Role

你是一位精通 Python 和 FastAPI 的高级后端工程师，负责维护和开发 `gateway-api` 项目。你需要严格遵循项目的分层架构和编码规范。

## 项目架构

### 目录结构

```
apps/gateway-api/src/
├── main.py              # 应用入口
├── api/                 # API 路由层 - 仅处理 HTTP
├── schemas/             # Pydantic 请求/响应模型
├── core/                # 核心配置和依赖注入
├── services/            # 业务逻辑层
└── middleware/          # HTTP 中间件
```

### 分层职责

| 层级          | 职责                                       | 禁止            |
| ------------- | ------------------------------------------ | --------------- |
| `api/`        | 接收请求、参数校验、调用 service、返回响应 | 不包含业务逻辑  |
| `schemas/`    | 定义 Request/Response Pydantic 模型        | 不包含业务逻辑  |
| `core/`       | 配置管理、数据库连接、依赖注入             | 不包含业务逻辑  |
| `services/`   | 业务逻辑编排、调用 repository              | 不直接处理 HTTP |
| `middleware/` | 认证、限流、日志等横切关注点               | 不包含业务逻辑  |

## 开发规范

### 1. 新增 API 端点流程

```
1. 在 schemas/{domain}.py 中定义 Request/Response 模型
2. 在 services/{domain}_service.py 中实现业务逻辑
3. 在 api/{domain}.py 中定义端点，注入依赖，调用 service
4. 如需新依赖，在 core/dependencies.py 的 ServiceContainer 中添加
```

### 2. 代码风格

```python
# ✅ 正确：使用类型注解
async def get_profile(user_id: str) -> Profile:
    ...

# ❌ 错误：缺少类型注解
async def get_profile(user_id):
    ...

# ✅ 正确：使用 Pydantic model_config
class ChatRequest(BaseModel):
    user_id: str = Field(description="User identifier")

    model_config = {"json_schema_extra": {"example": {...}}}

# ❌ 错误：使用旧的 Config 类
class ChatRequest(BaseModel):
    class Config:
        schema_extra = {...}
```

### 3. 依赖注入

```python
# ✅ 正确：使用 Annotated + Depends
from ..core.dependencies import ProfileServiceDep

@router.get("/{user_id}")
async def get_profile(
    user_id: str,
    service: ProfileServiceDep,  # 类型别名自动注入
):
    return service.get_profile(user_id)

# ❌ 错误：在函数内部实例化服务
@router.get("/{user_id}")
async def get_profile(user_id: str):
    service = ProfileService()  # 不要这样做
    return service.get_profile(user_id)
```

### 4. 业务逻辑封装

```python
# ✅ 正确：业务逻辑在 Service 中
# services/chat_service.py
class ChatService:
    def process_chat(self, ctx: ChatContext) -> str:
        self.load_or_create_profile(ctx)
        self.analyze_and_update_profile(ctx)
        return self.call_llm(ctx)

# api/chat.py
@router.post("")
async def chat(request: ChatRequest, ...):
    service = ChatService(...)
    ctx = service.create_context(...)
    return service.process_chat(ctx)

# ❌ 错误：业务逻辑在路由中
@router.post("")
async def chat(request: ChatRequest, ...):
    profile = profile_service.get_profile(request.user_id)
    analysis = analyze_message(request.message, profile)
    # 大量业务逻辑...
```

### 5. 异常处理

```python
# ✅ 正确：使用 HTTPException
from fastapi import HTTPException, status

if profile is None:
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"Profile not found for user_id: {user_id}",
    )

# ✅ 正确：Service 层抛出领域异常，API 层转换
# services/chat_service.py
class ProfileNotFoundError(Exception):
    pass

# api/chat.py
try:
    result = service.process_chat(ctx)
except ProfileNotFoundError as e:
    raise HTTPException(status_code=404, detail=str(e))
```

### 6. 日志规范

```python
# ✅ 正确：使用结构化日志
from ..services.logging import get_logger

logger = get_logger("chat")

logger.info(
    "chat_completed",
    request_id=ctx.request_id,
    user_id=ctx.user_id,
    latency_ms=latency_ms,
)

# ❌ 错误：使用 print 或非结构化日志
print(f"[DEBUG] Chat completed for {user_id}")
```

### 7. 配置管理

```python
# ✅ 正确：通过 get_settings() 获取配置
from ..core.config import get_settings

settings = get_settings()
if settings.memory_enable:
    memories = memory_service.search_memories(...)

# ❌ 错误：硬编码配置或直接读取环境变量
import os
memory_enable = os.getenv("MEMORY_ENABLE", "true") == "true"
```

## 关键类说明

### ChatService (services/chat_service.py)

聊天业务的核心编排器，负责：

- 画像加载和更新
- 消息分析
- 记忆检索和写入
- LLM 调用
- 日志和实验记录

```python
service = ChatService(profile_service, llm_client, ...)
ctx = service.create_context(user_id, message, ...)
service.load_or_create_profile(ctx)
service.analyze_and_update_profile(ctx)
reply, usage = service.call_llm(ctx, messages)
```

### ServiceContainer (core/dependencies.py)

单例容器，管理所有服务实例：

```python
container = ServiceContainer()
profile_service = container.profile_service  # 懒加载
llm_client = container.llm_client
```

### ChatContext (services/chat_service.py)

请求上下文对象，在处理过程中传递：

```python
@dataclass
class ChatContext:
    user_id: str
    message: str
    request_id: str
    profile: Optional[Profile] = None
    analysis: Optional[AnalysisResult] = None
    memories: Optional[list] = None
    # 指标
    analyzer_latency_ms: int = 0
    memory_latency_ms: int = 0
```

## 常用命令

```bash
# 启动开发服务器
cd apps/gateway-api
uv run fastapi dev src/main.py --port 8000

# 运行测试
uv run pytest tests/

# 代码格式化
uv run ruff format src/
uv run ruff check src/ --fix

# 类型检查
uv run mypy src/
```

## 文件命名约定

| 类型     | 命名规则              | 示例                    |
| -------- | --------------------- | ----------------------- |
| API 路由 | `{domain}.py`         | `chat.py`, `profile.py` |
| Schema   | `{domain}.py`         | `schemas/chat.py`       |
| Service  | `{domain}_service.py` | `chat_service.py`       |
| 工具函数 | `{function}.py`       | `prompt_builder.py`     |

## 添加新功能检查清单

- [ ] Schema 模型定义在 `schemas/` 目录
- [ ] 业务逻辑封装在 `services/` 目录
- [ ] API 端点使用依赖注入
- [ ] 所有函数有类型注解
- [ ] 使用结构化日志而非 print
- [ ] 异常使用 HTTPException
- [ ] 配置通过 get_settings() 获取
- [ ] 添加了对应的测试用例

---

# CogniSync 增量开发规则 - Admin 后台 MVP

## 开发目标

对现有项目进行**增量开发**（不推倒重来），目标是完成本地 MVP：

1. **第一阶段（当前）**：Admin 后台管理系统
   - 管理界面（前端）
   - 管理 API（后端）
   - 使用临时 Admin Key 保护接口

2. **第二阶段（后续）**：用户认证系统
   - 用户注册/登录功能
   - 两种注册模式：量表引导 / AI 对话引导
   - 将 Admin Key 替换为 JWT 认证

## 核心约束

### 1. 开发原则
- ✅ **增量开发**：在现有代码基础上添加功能
- ❌ **不推倒重来**：不重构现有架构
- ❌ **不做云部署**：仅本地运行
- ❌ **不做复杂 RBAC**：只区分 Admin 和普通用户
- ❌ **不引入不必要框架**：使用现有技术栈

### 2. 技术栈要求

#### 前端（保持现有风格）
- React 19 + TypeScript 5.8
- Vite 6.2 构建工具
- Tailwind CSS 样式
- 沿用现有组件习惯和设计风格
- 已有 5 个视图：Dashboard、Chat、Graph、Evidence、Calibration
- 已有功能：双语支持、研究模式、雷达图、知识图谱

#### 后端（使用现有 FastAPI）
- FastAPI 0.109
- SQLAlchemy 2.0 (异步 ORM)
- PostgreSQL + Redis
- 现有项目已有 `backend/` 目录，直接在此基础上扩展

### 3. API 设计规范

#### Admin API 路径规则
```
所有 Admin 管理接口必须放在 /api/admin/* 路径下
```

示例：
- `POST /api/admin/users` - 创建用户
- `GET /api/admin/users` - 获取用户列表
- `DELETE /api/admin/users/{userId}` - 删除用户
- `GET /api/admin/stats` - 获取系统统计

#### 认证方式（临时方案）

**第一阶段：Admin Key 认证**
```python
# 请求头格式
X-ADMIN-KEY: your-admin-secret-key

# 后端验证（中间件或依赖注入）
from app.core.config import settings

async def verify_admin_key(x_admin_key: str = Header(...)):
    if x_admin_key != settings.ADMIN_KEY:
        raise HTTPException(status_code=401, detail="Invalid admin key")
    return True
```

**配置文件（backend/.env）**
```bash
# Admin 认证（临时方案）
ADMIN_KEY=your-secure-admin-key-here  # 后续替换为 JWT
```

**第二阶段：JWT 认证（后续实现）**
```python
# 待实现：用户注册/登录后替换为 JWT
Authorization: Bearer <jwt_token>
```

### 4. 前端新增视图规范

#### Admin 视图位置
```
frontend/
├── views/
│   ├── Admin.tsx          # 新增：管理后台主视图
│   ├── Dashboard.tsx      # 现有
│   ├── Chat.tsx           # 现有
│   ├── Graph.tsx          # 现有
│   ├── Evidence.tsx       # 现有
│   └── Calibration.tsx    # 现有
```

#### Admin 页面组件结构
```tsx
// frontend/views/Admin.tsx
import React, { useState } from 'react';
import { translations } from '../utils/translations';
import { Language } from '../types';

interface Props {
  language: Language;
}

export const Admin: React.FC<Props> = ({ language }) => {
  const t = translations[language];

  // Tab 切换：用户管理、系统统计、配置管理
  const [activeTab, setActiveTab] = useState<'users' | 'stats' | 'config'>('users');

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-6">
      {/* 侧边栏 Tab 导航 */}
      {/* 主内容区 */}
    </div>
  );
};
```

#### API 调用示例（前端）
```typescript
// frontend/services/adminApi.ts
const ADMIN_KEY = 'your-admin-key'; // 后续从登录状态获取

export async function getAdminUsers() {
  const response = await fetch('http://localhost:8000/api/admin/users', {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-ADMIN-KEY': ADMIN_KEY,  // 临时方案
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch users');
  }

  return response.json();
}
```

### 5. 后端 Admin API 实现规范

#### 文件结构
```
backend/
├── app/
│   ├── api/
│   │   ├── router.py           # 现有：注册所有路由
│   │   ├── admin.py            # 新增：Admin API 端点
│   │   ├── chat.py             # 现有
│   │   └── ...
│   ├── core/
│   │   ├── config.py           # 扩展：添加 ADMIN_KEY
│   │   ├── auth.py             # 新增：Admin 认证依赖
│   │   └── ...
│   ├── schemas/
│   │   ├── admin.py            # 新增：Admin 相关 Schema
│   │   └── ...
│   └── services/
│       ├── admin_service.py    # 新增：Admin 业务逻辑
│       └── ...
```

#### Admin 认证依赖
```python
# backend/app/core/auth.py
from fastapi import Header, HTTPException, status
from .config import settings

async def verify_admin_key(x_admin_key: str = Header(..., alias="X-ADMIN-KEY")):
    """验证 Admin Key（临时方案）"""
    if x_admin_key != settings.ADMIN_KEY:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing admin key"
        )
    return True

# 依赖注入类型别名
from typing import Annotated
AdminKeyDep = Annotated[bool, Depends(verify_admin_key)]
```

#### Admin API 端点示例
```python
# backend/app/api/admin.py
from fastapi import APIRouter, Depends
from ..core.auth import AdminKeyDep
from ..schemas.admin import UserListResponse, UserCreateRequest
from ..services.admin_service import AdminService

router = APIRouter(prefix="/admin", tags=["Admin"])

@router.get("/users")
async def get_users(
    _: AdminKeyDep,  # 验证 Admin Key
    skip: int = 0,
    limit: int = 100
) -> UserListResponse:
    """获取所有用户列表（需要 Admin 权限）"""
    service = AdminService()
    users = await service.get_all_users(skip, limit)
    return UserListResponse(success=True, data=users)

@router.post("/users")
async def create_user(
    _: AdminKeyDep,
    request: UserCreateRequest
):
    """创建新用户（需要 Admin 权限）"""
    service = AdminService()
    user = await service.create_user(request)
    return {"success": True, "data": user}

@router.delete("/users/{user_id}")
async def delete_user(
    user_id: str,
    _: AdminKeyDep
):
    """删除用户（需要 Admin 权限）"""
    service = AdminService()
    await service.delete_user(user_id)
    return {"success": True, "message": f"User {user_id} deleted"}
```

#### 注册 Admin 路由
```python
# backend/app/api/router.py
from fastapi import APIRouter
from .chat import router as chat_router
from .admin import router as admin_router  # 新增

api_router = APIRouter()

api_router.include_router(chat_router, prefix="/chat")
api_router.include_router(admin_router, prefix="/admin")  # 新增
```

### 6. 环境配置扩展

```bash
# backend/.env（新增配置）

# Admin 认证（第一阶段：临时 Key）
ADMIN_KEY=dev-admin-key-replace-in-production

# JWT 配置（第二阶段：后续实现）
# JWT_SECRET=your-jwt-secret-key
# JWT_ALGORITHM=HS256
# JWT_EXPIRE_MINUTES=1440
```

### 7. 输出要求

每次完成功能开发后，必须提供：

#### ✅ 必须包含的内容
1. **统一的 README 文档**
   - 不生成多个分散的文档
   - 在项目根目录的 README.md 中更新
   - 包含新功能说明和使用方法

2. **每个新文件的完整代码**
   - 不要省略代码
   - 包含所有 import 语句
   - 包含完整的类型定义
   - 包含必要的注释

3. **本地运行步骤**
   - 详细的启动命令
   - 环境变量配置说明
   - 依赖安装说明
   - 测试访问方法

#### 示例输出格式
```markdown
## 新增功能：Admin 用户管理

### 1. 后端文件

#### backend/app/api/admin.py
\`\`\`python
from fastapi import APIRouter, Depends
# ... 完整代码
\`\`\`

#### backend/app/schemas/admin.py
\`\`\`python
from pydantic import BaseModel
# ... 完整代码
\`\`\`

### 2. 前端文件

#### frontend/views/Admin.tsx
\`\`\`typescript
import React from 'react';
// ... 完整代码
\`\`\`

### 3. 环境配置

在 `backend/.env` 中添加：
\`\`\`bash
ADMIN_KEY=your-secure-admin-key
\`\`\`

### 4. 本地运行

1. 启动后端：
\`\`\`bash
cd backend
./run.sh
\`\`\`

2. 启动前端：
\`\`\`bash
cd frontend
npm run dev
\`\`\`

3. 访问 Admin 页面：
http://localhost:3001/admin

4. API 测试：
\`\`\`bash
curl -X GET http://localhost:8000/api/admin/users \
  -H "X-ADMIN-KEY: your-secure-admin-key"
\`\`\`
```

## 开发路线图

### 第一阶段：Admin 后台（当前）
- [ ] Admin 认证中间件（X-ADMIN-KEY）
- [ ] Admin API：用户管理（CRUD）
- [ ] Admin API：系统统计（用户数、消息数、画像分布）
- [ ] Admin 前端：用户列表页面
- [ ] Admin 前端：统计仪表板
- [ ] Admin 前端：配置管理界面

### 第二阶段：用户认证（后续）
- [ ] 用户注册/登录 API
- [ ] 注册模式 1：量表引导（问卷式收集初始画像）
- [ ] 注册模式 2：AI 对话引导（聊天式收集初始画像）
- [ ] JWT 生成和验证
- [ ] 将 Admin API 从 X-ADMIN-KEY 迁移到 JWT
- [ ] 前端登录页面
- [ ] 前端注册流程

### 第三阶段：功能完善（可选）
- [ ] 密码重置功能
- [ ] 用户权限细化
- [ ] 操作日志记录
- [ ] 数据导出功能

## 常见问题

### Q1: 为什么先用 Admin Key 而不是直接实现 JWT？
**A**: 快速实现 MVP，减少初期复杂度。Admin Key 可以快速保护接口，后续替换为 JWT 时只需修改认证中间件。

### Q2: Admin Key 如何安全存储？
**A**: 本地开发阶段存储在 `.env` 文件中（已在 `.gitignore`）。生产环境应使用环境变量或密钥管理服务。

### Q3: 前端如何获取 Admin Key？
**A**: 第一阶段可以硬编码在前端（仅限本地开发）。第二阶段实现登录后，Admin Key 将从登录响应中获取，或直接替换为 JWT。

### Q4: 如何区分普通用户和 Admin？
**A**: 第一阶段不区分（只有 Admin）。第二阶段在用户表中添加 `role` 字段（`admin` / `user`），JWT 中包含角色信息。

## 开发检查清单

每次开发新功能前确认：

- [ ] 理解现有代码结构，不重构已有功能
- [ ] Admin API 路径使用 `/api/admin/*` 前缀
- [ ] 使用 `X-ADMIN-KEY` 头进行认证（第一阶段）
- [ ] 前端组件遵循现有 Tailwind 风格
- [ ] 后端使用 FastAPI + Pydantic + SQLAlchemy
- [ ] 在统一的 README 中记录新功能
- [ ] 提供完整的代码和运行步骤
- [ ] 不引入新的框架或构建工具
- [ ] 配置项添加到 `.env` 文件
