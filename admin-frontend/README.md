# CogniSync Admin Frontend

React + TypeScript + Vite 管理后台前端，用于管理 CogniSync 自适应学习系统。

## 技术栈

- **React 19** - 用户界面库
- **TypeScript** - 类型安全
- **Vite** - 快速构建工具
- **React Router** - 路由管理
- **Tailwind CSS** - 样式框架（CDN）
- **Lucide React** - 图标库

## 项目结构

```
admin-frontend/
├── src/
│   ├── components/          # 通用组件
│   │   └── AdminLayout.tsx  # 主布局（侧边栏 + 顶部栏）
│   ├── pages/               # 页面组件
│   │   ├── Dashboard.tsx    # 概览统计
│   │   ├── Users.tsx        # 用户列表
│   │   ├── UserDetail.tsx   # 用户详情
│   │   ├── Scales.tsx       # 量表管理
│   │   ├── DataExplorer.tsx # 数据浏览器（核心）
│   │   ├── Conversations.tsx # 对话管理
│   │   └── Exports.tsx      # 数据导出
│   ├── lib/                 # 工具库
│   │   ├── adminApi.ts      # API 客户端
│   │   └── useTheme.ts      # 主题切换 Hook
│   ├── types/               # TypeScript 类型定义
│   │   └── index.ts
│   ├── index.css            # 全局样式（从 /frontend 复用）
│   ├── App.tsx              # 应用主组件
│   └── main.tsx             # 入口文件
├── index.html               # HTML 模板
├── vite.config.ts           # Vite 配置
├── tsconfig.json            # TypeScript 配置
├── package.json             # 依赖管理
└── .env                     # 环境变量
```

## 快速开始

### 1. 安装依赖

```bash
cd admin-frontend
npm install
```

### 2. 配置环境变量

编辑 `.env` 文件：

```bash
VITE_API_BASE_URL=http://localhost:8000/api
VITE_ADMIN_KEY=your_admin_key_here
```

> **重要**: 确保 `VITE_ADMIN_KEY` 与后端 `.env` 中的 `ADMIN_KEY` 一致。

### 3. 启动开发服务器

```bash
npm run dev
```

访问：http://localhost:3001/admin

### 4. 构建生产版本

```bash
npm run build
```

构建产物在 `dist/` 目录。

### 5. 预览生产构建

```bash
npm run preview
```

## 功能模块

### 1. Dashboard（概览）

- **路由**: `/admin`
- **功能**:
  - 显示用户数、会话数、消息数、量表数统计
  - 计算平均消息数等衍生指标
  - 实时加载最新数据

### 2. Users（用户管理）

- **路由**: `/admin/users`
- **功能**:
  - 用户列表（分页，每页 10 条）
  - 搜索功能（按 email 或 name）
  - 状态显示（Active/Inactive）
  - 点击行进入用户详情

### 3. User Detail（用户详情）

- **路由**: `/admin/users/:userId`
- **功能**:
  - 用户基本信息（email、name、role）
  - 三维画像可视化（Cognition、Affect、Behavior）
  - **Tabs 切换**:
    - **Messages**: 对话历史（user/assistant 区分样式）
    - **Profiles**: 画像快照时间线（system/user 来源）
    - **Scale Responses**: 用户提交的量表记录

### 4. Scales（量表管理）

- **路由**: `/admin/scales`
- **功能**:
  - 量表模板列表（名称、版本、状态）
  - **上传量表**: JSON 文件 → 预览 → 提交
  - **状态管理**:
    - `draft` → `active` (激活)
    - `active` → `archived` (归档)
  - 查看量表提交记录

### 5. Data Explorer（数据浏览器）⭐️

- **路由**: `/admin/explorer`
- **功能**:
  - **左侧**: 表列表（8 个允许查看的表）
  - **右侧**: 数据表格
    - 列信息展示
    - 分页查询（50 条/页）
    - 列头排序（点击切换 asc/desc）
    - 导出为 JSON（下载或复制到剪贴板）
  - **安全机制**: 表名白名单 + 敏感字段过滤

### 6. Conversations（对话管理）

- **路由**: `/admin/conversations`
- **功能**:
  - 对话会话列表
  - 显示用户、消息数、时间
  - 分页查询

### 7. Exports（数据导出）

- **路由**: `/admin/exports`
- **功能**:
  - 选择表 + 格式（JSON）
  - 一键导出
  - 导出历史记录

## UI 风格规范

### 统一的设计语言

本项目与 `/frontend` 保持一致的 UI 风格：

#### 1. 玻璃卡片（Glass Card）

```tsx
<div className="glass-card p-6 rounded-2xl hover:shadow-xl transition-all duration-300">
  {/* 内容 */}
</div>
```

#### 2. 渐变按钮（Primary Button）

```tsx
<button className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white px-4 py-3 
                   rounded-xl hover:shadow-lg hover:shadow-indigo-500/30 
                   transition-all duration-300 active:scale-95">
  确认
</button>
```

#### 3. 状态徽章（Badge）

```tsx
<span className="px-2 py-1 rounded text-xs bg-green-100 dark:bg-green-900 
                 text-green-700 dark:text-green-300">
  Active
</span>
```

#### 4. 动画

- `animate-fade-in` - 淡入
- `animate-slide-in-right` - 右滑入场
- `stagger-{1-6}` - 延迟动画

### 颜色系统

| 用途 | 浅色 | 深色 |
|------|------|------|
| 主背景 | #ffffff | #0f172a |
| 次背景 | #f9fafb | #1e293b |
| 文本 | #000000 | #ffffff |
| 品牌蓝 | #3b82f6 | - |
| 品牌紫 | #8b5cf6 | - |
| 品牌绿 | #10b981 | - |

### 主题切换

- 左下角主题切换按钮
- localStorage 持久化
- 使用 `data-theme` attribute 控制

## API 集成

### API Client（`lib/adminApi.ts`）

统一的 API 客户端，封装所有后端接口：

```typescript
import { adminApi } from '@/lib/adminApi';

// 使用示例
const stats = await adminApi.getOverview();
const users = await adminApi.getUsers(page, pageSize, query);
const userDetail = await adminApi.getUserDetail(userId);
```

### 统一响应格式

所有接口返回：

```typescript
{
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}
```

### 错误处理

API Client 会自动：
1. 添加 `X-ADMIN-KEY` Header
2. 解析响应并检查 `success` 字段
3. 抛出错误（包含错误信息）
4. 在控制台记录详细错误

## 开发指南

### 添加新页面

1. 在 `src/pages/` 创建新组件
2. 在 `src/App.tsx` 添加路由
3. 在 `src/components/AdminLayout.tsx` 添加导航菜单项

### 添加新 API 接口

在 `src/lib/adminApi.ts` 的 `AdminApiClient` 类中添加方法：

```typescript
async getNewData(): Promise<NewDataType> {
  return this.request<NewDataType>('/new-endpoint');
}
```

### 样式定制

修改 `src/index.css` 中的 CSS 变量：

```css
:root {
  --bg-primary: #ffffff;
  --brand-blue: #3b82f6;
  /* ... */
}
```

## 与现有前端的关系

### 共享的内容

1. **CSS 样式**: `index.css` 完全复用自 `/frontend/index.css`
2. **主题系统**: 使用相同的 `data-theme` 切换机制
3. **颜色变量**: 完全一致的 CSS 变量定义
4. **动画**: 相同的关键帧动画和延迟类

### 差异点

1. **路由**: Admin 使用 `/admin/*`，前端使用 `/`
2. **功能**: Admin 专注管理，前端专注学习体验
3. **权限**: Admin 需要 `X-ADMIN-KEY` 认证

## 安全注意事项

1. **Admin Key**: 不要在代码中硬编码，使用环境变量
2. **HTTPS**: 生产环境必须使用 HTTPS
3. **CORS**: 确保后端正确配置 CORS 允许的来源
4. **输入验证**: 虽然后端有验证，前端也应做基础校验

## 故障排查

### 1. API 请求失败（401/403）

检查 `.env` 中的 `VITE_ADMIN_KEY` 是否正确。

### 2. CORS 错误

确保后端 `config.py` 中的 `CORS_ORIGINS` 包含 `http://localhost:3001`。

### 3. 样式不生效

检查 `index.html` 是否正确加载 Tailwind CDN：

```html
<script src="https://cdn.tailwindcss.com"></script>
```

### 4. 路由 404

检查 Vite 的代理配置（`vite.config.ts`）。

## 测试

### 手动测试步骤

1. 启动后端：`cd backend && python main.py`
2. 启动前端：`cd admin-frontend && npm run dev`
3. 访问：http://localhost:3001/admin
4. 测试各个页面的功能

### 自动化测试（TODO）

```bash
npm run test
```

## 部署

### 构建

```bash
npm run build
```

### Nginx 配置示例

```nginx
server {
    listen 80;
    server_name admin.cognisync.com;

    root /var/www/admin-frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api {
        proxy_pass http://localhost:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## 贡献指南

1. Fork 项目
2. 创建功能分支：`git checkout -b feature/xxx`
3. 提交代码：`git commit -m 'Add xxx'`
4. 推送分支：`git push origin feature/xxx`
5. 创建 Pull Request

## 许可证

MIT License
