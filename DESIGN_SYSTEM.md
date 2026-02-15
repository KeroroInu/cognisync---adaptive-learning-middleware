# CogniSync 设计系统

## 🎨 核心设计原则

本设计系统遵循现代化、可访问性和用户体验优先的原则。

---

## 1. 颜色系统

### 主色调（Primary）
```css
--color-primary-50: #EEF2FF;
--color-primary-100: #E0E7FF;
--color-primary-500: #6366F1; /* Indigo 500 - 主要品牌色 */
--color-primary-600: #4F46E5;
--color-primary-700: #4338CA;
--color-primary-900: #312E81;
```

### 次要色调（Secondary）
```css
--color-secondary-500: #8B5CF6; /* Purple 500 */
--color-secondary-600: #7C3AED;
```

### 功能色（Functional）
```css
/* 成功 */
--color-success-500: #10B981;
--color-success-700: #047857;

/* 警告 */
--color-warning-500: #F59E0B;
--color-warning-700: #B45309;

/* 错误 */
--color-error-500: #EF4444;
--color-error-700: #B91C1C;

/* 信息 */
--color-info-500: #3B82F6;
--color-info-700: #1D4ED8;
```

### 中性色（Neutral）
```css
--color-gray-50: #F9FAFB;
--color-gray-100: #F3F4F6;
--color-gray-200: #E5E7EB;
--color-gray-300: #D1D5DB;
--color-gray-400: #9CA3AF;
--color-gray-500: #6B7280;
--color-gray-600: #4B5563;
--color-gray-700: #374151;
--color-gray-800: #1F2937;
--color-gray-900: #111827;
```

### 对比度要求
- **正常文本**: 最小 4.5:1
- **大文本**: 最小 3:1
- **UI 组件**: 最小 3:1

---

## 2. 排版系统

### 字体家族
```css
--font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
--font-mono: 'Fira Code', 'Consolas', 'Monaco', monospace;
```

### 字体大小
```css
--text-xs: 0.75rem;    /* 12px */
--text-sm: 0.875rem;   /* 14px */
--text-base: 1rem;     /* 16px */
--text-lg: 1.125rem;   /* 18px */
--text-xl: 1.25rem;    /* 20px */
--text-2xl: 1.5rem;    /* 24px */
--text-3xl: 1.875rem;  /* 30px */
--text-4xl: 2.25rem;   /* 36px */
--text-5xl: 3rem;      /* 48px */
```

### 字重
```css
--font-normal: 400;
--font-medium: 500;
--font-semibold: 600;
--font-bold: 700;
```

### 行高
```css
--leading-tight: 1.25;   /* 标题 */
--leading-normal: 1.5;   /* 正文 */
--leading-relaxed: 1.75; /* 长文本 */
```

---

## 3. 间距系统

### 间距刻度（基于 4px）
```css
--space-1: 0.25rem;  /* 4px */
--space-2: 0.5rem;   /* 8px */
--space-3: 0.75rem;  /* 12px */
--space-4: 1rem;     /* 16px */
--space-5: 1.25rem;  /* 20px */
--space-6: 1.5rem;   /* 24px */
--space-8: 2rem;     /* 32px */
--space-10: 2.5rem;  /* 40px */
--space-12: 3rem;    /* 48px */
--space-16: 4rem;    /* 64px */
--space-20: 5rem;    /* 80px */
```

### 容器内边距
- **卡片**: 20-24px
- **按钮**: 12px 24px
- **输入框**: 12px 16px
- **模态框**: 24px 32px

---

## 4. 圆角系统

```css
--radius-sm: 0.25rem;  /* 4px - 小元素 */
--radius-md: 0.5rem;   /* 8px - 按钮、输入框 */
--radius-lg: 0.75rem;  /* 12px - 卡片 */
--radius-xl: 1rem;     /* 16px - 大卡片 */
--radius-2xl: 1.5rem;  /* 24px - 模态框 */
--radius-full: 9999px; /* 圆形 */
```

---

## 5. 阴影系统

```css
/* 层级 1 - 悬浮卡片 */
--shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);

/* 层级 2 - 下拉菜单 */
--shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1),
             0 2px 4px -1px rgba(0, 0, 0, 0.06);

/* 层级 3 - 模态框 */
--shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1),
             0 4px 6px -2px rgba(0, 0, 0, 0.05);

/* 层级 4 - 弹出层 */
--shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.1),
             0 10px 10px -5px rgba(0, 0, 0, 0.04);

/* 内阴影 */
--shadow-inner: inset 0 2px 4px 0 rgba(0, 0, 0, 0.06);
```

---

## 6. 动画系统

### 持续时间
```css
--duration-fast: 150ms;
--duration-normal: 250ms;
--duration-slow: 350ms;
```

### 缓动函数
```css
--ease-in: cubic-bezier(0.4, 0, 1, 1);
--ease-out: cubic-bezier(0, 0, 0.2, 1);
--ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
```

### 常用过渡
```css
.transition-colors {
  transition: color var(--duration-normal) var(--ease-in-out),
              background-color var(--duration-normal) var(--ease-in-out),
              border-color var(--duration-normal) var(--ease-in-out);
}

.transition-transform {
  transition: transform var(--duration-normal) var(--ease-in-out);
}

.transition-all {
  transition: all var(--duration-normal) var(--ease-in-out);
}
```

---

## 7. 断点系统

```css
/* 移动优先 */
--breakpoint-sm: 640px;   /* 手机横屏 */
--breakpoint-md: 768px;   /* 平板 */
--breakpoint-lg: 1024px;  /* 桌面 */
--breakpoint-xl: 1280px;  /* 大桌面 */
--breakpoint-2xl: 1536px; /* 超大桌面 */
```

---

## 8. 组件设计规范

### 按钮

#### 主要按钮（Primary）
```tsx
<button className="
  px-6 py-3
  bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800
  text-white font-semibold
  rounded-lg shadow-md hover:shadow-lg
  transition-all duration-250
  disabled:opacity-50 disabled:cursor-not-allowed
">
  Primary Action
</button>
```

#### 次要按钮（Secondary）
```tsx
<button className="
  px-6 py-3
  bg-gray-100 dark:bg-gray-800
  hover:bg-gray-200 dark:hover:bg-gray-700
  text-gray-900 dark:text-gray-100 font-medium
  rounded-lg
  transition-colors duration-250
">
  Secondary Action
</button>
```

#### 危险按钮（Danger）
```tsx
<button className="
  px-6 py-3
  bg-red-600 hover:bg-red-700
  text-white font-semibold
  rounded-lg shadow-md
  transition-all duration-250
">
  Delete
</button>
```

### 卡片

```tsx
<div className="
  p-6
  bg-white dark:bg-gray-800
  rounded-xl shadow-md
  border border-gray-200 dark:border-gray-700
  hover:shadow-lg
  transition-shadow duration-250
">
  {/* 内容 */}
</div>
```

### 输入框

```tsx
<input className="
  w-full px-4 py-3
  bg-white dark:bg-gray-800
  border border-gray-300 dark:border-gray-600
  rounded-lg
  focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
  transition-all duration-200
  placeholder:text-gray-400
" />
```

### 加载状态

```tsx
<div className="flex items-center justify-center">
  <div className="
    w-12 h-12
    border-4 border-gray-200
    border-t-indigo-600
    rounded-full
    animate-spin
  "></div>
</div>
```

---

## 9. 可访问性检查清单

### 键盘导航
- [ ] 所有交互元素可通过 Tab 键访问
- [ ] 焦点状态清晰可见（focus ring）
- [ ] 逻辑的 Tab 顺序
- [ ] 支持 Esc 关闭模态框

### 语义化 HTML
- [ ] 使用 `<nav>`, `<main>`, `<section>`, `<article>`
- [ ] 按钮使用 `<button>`，链接使用 `<a>`
- [ ] 表单使用 `<label>` 和 `<input>` 关联
- [ ] 标题层级正确（H1 → H2 → H3）

### ARIA 属性
- [ ] 复杂组件添加 `role` 属性
- [ ] 动态内容使用 `aria-live`
- [ ] 隐藏内容使用 `aria-hidden="true"`
- [ ] 图标按钮添加 `aria-label`

### 颜色对比
- [ ] 文本与背景对比度 ≥ 4.5:1
- [ ] 大文本对比度 ≥ 3:1
- [ ] 不仅依靠颜色传达信息

### 触摸目标
- [ ] 按钮最小尺寸 44x44px
- [ ] 交互元素之间有足够间距
- [ ] 移动端优化触摸体验

---

## 10. 响应式设计

### 移动优先方法

```css
/* 基础样式（移动端） */
.container {
  padding: 1rem;
}

/* 平板 */
@media (min-width: 768px) {
  .container {
    padding: 2rem;
  }
}

/* 桌面 */
@media (min-width: 1024px) {
  .container {
    padding: 3rem;
    max-width: 1280px;
    margin: 0 auto;
  }
}
```

### 断点使用建议
- **< 640px**: 单列布局
- **640px - 768px**: 2 列布局
- **768px - 1024px**: 3 列布局
- **> 1024px**: 4 列或更多

---

## 11. 玻璃态效果（Glassmorphism）

```css
.glass-card {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.15);
}

/* 暗色模式 */
.dark .glass-card {
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.1);
}
```

---

## 12. 加载骨架屏

```tsx
<div className="animate-pulse">
  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-4"></div>
  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
</div>
```

---

## 13. 要避免的事项

### ❌ 不要做
- 使用过多的颜色（超过 3-4 种主色）
- 忽略移动端体验
- 缺少加载和错误状态
- 使用纯黑色（#000）或纯白色（#FFF）作为背景
- 过度使用动画（会导致晕眩）
- 忽略键盘导航
- 使用固定像素宽度（应使用 rem/em）
- 在小屏幕上使用悬浮效果（移动端无 hover）

### ✅ 应该做
- 保持一致的间距和对齐
- 提供清晰的视觉反馈
- 使用语义化的 HTML
- 优先考虑性能
- 测试多种设备和屏幕尺寸
- 提供暗色模式支持
- 使用渐进增强策略
- 优化图片和资源

---

## 14. 代码组织

### 文件结构
```
src/
├── components/
│   ├── ui/           # 基础 UI 组件
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── Input.tsx
│   │   └── ...
│   └── features/     # 功能组件
├── styles/
│   ├── globals.css   # 全局样式
│   ├── variables.css # CSS 变量
│   └── utilities.css # 工具类
└── lib/
    └── theme.ts      # 主题配置
```

### CSS 命名约定
- 使用 BEM（Block Element Modifier）或语义化类名
- 保持类名简短但有意义
- 避免使用 ID 选择器

---

## 15. 性能优化

### 图片优化
- 使用 WebP 格式
- 实现懒加载
- 提供多种尺寸（srcset）
- 压缩图片

### CSS 优化
- 移除未使用的 CSS
- 使用 CSS Grid 和 Flexbox
- 避免深层嵌套选择器
- 最小化重绘和重排

### JavaScript 优化
- 代码分割（Code Splitting）
- 延迟加载非关键组件
- 使用 React.memo 或 useMemo
- 虚拟化长列表

---

## 16. 暗色模式

### 颜色调整
```css
:root {
  --bg-primary: #FFFFFF;
  --text-primary: #111827;
}

.dark {
  --bg-primary: #111827;
  --text-primary: #F9FAFB;
}
```

### 实现策略
1. 使用 CSS 变量
2. 提供切换开关
3. 保存用户偏好
4. 尊重系统偏好（prefers-color-scheme）

---

## 快速参考

### 间距记忆口诀
- **4px**: 极小间距（图标间距）
- **8px**: 小间距（标签内边距）
- **16px**: 标准间距（元素间距）
- **24px**: 大间距（节间距）
- **32px**: 更大间距（组间距）
- **48px+**: 页面级间距

### 文字大小建议
- **12px**: 辅助文本、标签
- **14px**: 正文（移动端）
- **16px**: 正文（桌面端）
- **18-20px**: 副标题
- **24-30px**: 标题
- **36px+**: 大标题

---

**设计系统版本**: v1.0.0
**最后更新**: 2026-02-15
**维护者**: CogniSync 团队
