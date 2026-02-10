# CogniSync Shared UI

共享 UI 组件库，供学生端前端和 Admin 后台前端复用。

## 特性

- 🎨 统一的设计系统（CSS Variables）
- 🌗 深色/浅色模式支持
- ✨ 玻璃形态设计（Glassmorphism）
- 🎭 流畅的动画系统
- 🔧 TypeScript 类型支持
- ♻️ 可复用的 React 组件

## 组件列表

### Button
通用按钮组件，支持多种变体和尺寸。

```tsx
import { Button } from '@cognisync/shared-ui';

<Button variant="primary" size="md" onClick={handleClick}>
  Click Me
</Button>
```

### Card
玻璃卡片容器组件。

```tsx
import { Card } from '@cognisync/shared-ui';

<Card padding={true}>
  Card Content
</Card>
```

### Table
通用表格组件，支持分页。

```tsx
import { Table } from '@cognisync/shared-ui';

<Table
  columns={[
    { key: 'id', header: 'ID' },
    { key: 'name', header: 'Name' }
  ]}
  data={rows}
  pagination={{
    page: 1,
    pageSize: 50,
    total: 100,
    onPageChange: setPage
  }}
/>
```

### Modal
模态框组件。

```tsx
import { Modal } from '@cognisync/shared-ui';

<Modal isOpen={isOpen} onClose={handleClose} title="Modal Title">
  Modal Content
</Modal>
```

### Input
输入框组件，支持错误提示。

```tsx
import { Input } from '@cognisync/shared-ui';

<Input
  value={value}
  onChange={setValue}
  label="Username"
  error={error}
/>
```

### Switch
开关组件。

```tsx
import { Switch } from '@cognisync/shared-ui';

<Switch checked={checked} onChange={setChecked} label="Enable Feature" />
```

## Hooks

### useTheme
主题切换 Hook。

```tsx
import { useTheme } from '@cognisync/shared-ui/hooks/useTheme';

const { theme, toggleTheme } = useTheme();
```

## 样式

### 引入样式

在你的应用中引入样式文件：

```css
@import '@cognisync/shared-ui/styles/variables.css';
@import '@cognisync/shared-ui/styles/animations.css';
@import '@cognisync/shared-ui/styles/glass-card.css';
```

### CSS Variables

所有组件使用 CSS Variables，支持主题切换：

- 背景：`--bg-primary`, `--bg-secondary`, `--bg-tertiary`
- 文字：`--text-primary`, `--text-secondary`, `--text-tertiary`, `--text-light`
- 品牌色：`--brand-blue`, `--brand-indigo`, `--brand-purple`, `--brand-green`, `--brand-rose`
- 阴影：`--shadow-sm`, `--shadow-md`, `--shadow-lg`, `--shadow-xl`
- 圆角：`--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-xl`

### 工具类

- `.glass-card` - 玻璃卡片效果
- `.text-gradient` - 渐变文字
- `.gradient-mesh` - 渐变背景网格
- `.animate-fade-in` - 淡入动画
- `.animate-slide-in-right` - 右滑入动画
- `.animate-slide-in-left` - 左滑入动画
- `.animate-scale-in` - 缩放入动画
- `.animate-float` - 悬浮动画
- `.stagger-1` ~ `.stagger-6` - 动画延迟

## 使用方法

### 在项目中引用

**方法 1: npm link（开发阶段）**

```bash
# 在 shared-ui 目录
npm link

# 在 frontend 或 admin-frontend 目录
npm link @cognisync/shared-ui
```

**方法 2: 文件路径（monorepo）**

在 `package.json` 中添加：

```json
{
  "dependencies": {
    "@cognisync/shared-ui": "file:../shared-ui"
  }
}
```

### 在 Vite 中配置路径别名

`vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@cognisync/shared-ui': path.resolve(__dirname, '../shared-ui')
    }
  }
});
```

## 许可证

MIT License
