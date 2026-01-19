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
