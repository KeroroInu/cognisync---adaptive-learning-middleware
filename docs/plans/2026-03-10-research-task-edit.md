# Research Task Edit Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an Edit button + modal to the admin Research Management page so admins can modify task content after creation.

**Architecture:** Frontend-only change. The backend `PATCH /research/tasks/{task_id}` and `adminApi.updateResearchTask()` already exist. We add `editingTask` state and an Edit Modal (portal) that reuses the same form fields as the Create Modal but pre-fills them with the selected task's data.

**Tech Stack:** React, TypeScript, Tailwind CSS, lucide-react icons, existing `adminApi` client.

---

### Task 1: Fix `adminApi.ts` — add missing `ai_prompt` field

**Files:**
- Modify: `admin-frontend/src/lib/adminApi.ts:267-278`

**Step 1: Open the file and locate `updateResearchTask`**

The current signature is missing `ai_prompt`. Find this block (around line 267):

```typescript
async updateResearchTask(taskId: string, data: {
  title?: string;
  description?: string;
  instructions?: string;
  code_content?: string;
  language?: string;
}): Promise<ResearchTask> {
```

**Step 2: Add `ai_prompt` to the type**

Replace the data type with:

```typescript
async updateResearchTask(taskId: string, data: {
  title?: string;
  description?: string;
  instructions?: string;
  ai_prompt?: string;
  code_content?: string;
  language?: string;
}): Promise<ResearchTask> {
```

**Step 3: Verify no TypeScript errors**

```bash
cd admin-frontend && npx tsc --noEmit
```

Expected: no errors (or same errors as before, none new).

**Step 4: Commit**

```bash
git add admin-frontend/src/lib/adminApi.ts
git commit -m "fix: add ai_prompt to updateResearchTask type signature"
```

---

### Task 2: Add edit state and handlers to `ResearchManagement.tsx`

**Files:**
- Modify: `admin-frontend/src/pages/ResearchManagement.tsx`

**Step 1: Add `Pencil` to the lucide-react import**

Find this line at the top of the file:
```typescript
import { FlaskConical, Plus, Play, Archive, Trash2, Users, ChevronDown, ChevronUp, Loader, Upload, X, CheckCircle, Download } from 'lucide-react';
```

Add `Pencil` to the import list:
```typescript
import { FlaskConical, Plus, Play, Archive, Trash2, Users, ChevronDown, ChevronUp, Loader, Upload, X, CheckCircle, Download, Pencil } from 'lucide-react';
```

**Step 2: Add edit state variables**

Inside the `ResearchManagement` component, after the existing `const [creating, setCreating] = useState(false);` line, add:

```typescript
const [editingTask, setEditingTask] = useState<ResearchTask | null>(null);
const [editForm, setEditForm] = useState({
  title: '',
  description: '',
  instructions: '',
  ai_prompt: '',
  code_content: '',
  language: 'python',
});
const [saving, setSaving] = useState(false);
const editFileInputRef = useRef<HTMLInputElement>(null);
```

**Step 3: Add `handleEdit` function**

After the `handleExportFromRow` function, add:

```typescript
const handleEdit = (task: ResearchTask) => {
  setEditForm({
    title: task.title,
    description: task.description || '',
    instructions: task.instructions || '',
    ai_prompt: task.ai_prompt || '',
    code_content: task.code_content,
    language: task.language,
  });
  setEditingTask(task);
};

const handleSave = async () => {
  if (!editingTask || !editForm.title.trim() || !editForm.code_content.trim()) return;
  try {
    setSaving(true);
    await adminApi.updateResearchTask(editingTask.id, {
      title: editForm.title,
      description: editForm.description || undefined,
      instructions: editForm.instructions || undefined,
      ai_prompt: editForm.ai_prompt || undefined,
      code_content: editForm.code_content,
      language: editForm.language,
    });
    setEditingTask(null);
    await loadTasks();
  } catch (e) {
    setError(e instanceof Error ? e.message : '保存失败');
  } finally {
    setSaving(false);
  }
};

const handleEditFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    setEditForm(f => ({ ...f, code_content: ev.target?.result as string || '' }));
  };
  reader.readAsText(file);
};
```

**Step 4: Verify no TypeScript errors**

```bash
cd admin-frontend && npx tsc --noEmit
```

Expected: no errors.

---

### Task 3: Add Edit button to the actions column

**Files:**
- Modify: `admin-frontend/src/pages/ResearchManagement.tsx`

**Step 1: Find the actions `<div>` in the table row**

Locate this block in the `<td>` for actions (around line 291):
```tsx
<div className="flex gap-2">
  {task.status !== 'active' && (
    <button ... >激活</button>
  )}
```

**Step 2: Add the Edit button as the first button in the actions div**

Insert this button immediately after the opening `<div className="flex gap-2">`:

```tsx
<button
  onClick={(e) => { e.stopPropagation(); handleEdit(task); }}
  className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors"
  title="编辑任务"
>
  <Pencil size={14} />
</button>
```

**Step 3: Verify the button appears in the browser**

Start the dev server and check the Research Management page — each task row should now have a blue pencil icon button before the existing action buttons.

---

### Task 4: Add the Edit Modal

**Files:**
- Modify: `admin-frontend/src/pages/ResearchManagement.tsx`

**Step 1: Find where the Create Modal ends**

Locate the closing of the Create Modal portal (around line 479):
```tsx
        document.body
      )}
```
This is `{showCreateModal && createPortal(..., document.body)}`.

**Step 2: Add the Edit Modal portal immediately after the Create Modal**

Insert this block after the Create Modal's closing `)}`:

```tsx
{/* Edit Task Modal */}
{editingTask && createPortal(
  <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 overflow-y-auto">
    <div className="flex min-h-full items-center justify-center p-4">
    <div className="glass-card rounded-2xl p-6 w-full max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">编辑任务</h2>
        <button
          onClick={() => setEditingTask(null)}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <X size={20} />
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">任务标题 *</label>
          <input
            type="text"
            value={editForm.title}
            onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))}
            className="w-full px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)' }}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">任务描述</label>
          <textarea
            value={editForm.description}
            onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
            rows={2}
            className="w-full px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 resize-none"
            style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)' }}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">给学生的说明</label>
          <textarea
            value={editForm.instructions}
            onChange={e => setEditForm(f => ({ ...f, instructions: e.target.value }))}
            rows={2}
            className="w-full px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 resize-none"
            style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)' }}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            AI 教学提示
            <span className="ml-1.5 text-xs font-normal" style={{ color: 'var(--text-light)' }}>
              （告诉 AI 本节课的教学目标，让它更有针对性地引导学生）
            </span>
          </label>
          <textarea
            value={editForm.ai_prompt}
            onChange={e => setEditForm(f => ({ ...f, ai_prompt: e.target.value }))}
            rows={4}
            className="w-full px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 resize-none"
            style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)' }}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">编程语言 *</label>
          <select
            value={editForm.language}
            onChange={e => setEditForm(f => ({ ...f, language: e.target.value }))}
            className="w-full px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)' }}
          >
            {LANGUAGES.map(l => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium">代码内容 *</label>
            <button
              type="button"
              onClick={() => editFileInputRef.current?.click()}
              className="flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:underline transition-colors"
            >
              <Upload size={13} />
              重新上传文件
            </button>
            <input
              ref={editFileInputRef}
              type="file"
              accept=".py,.js,.ts,.java,.cpp,.c,.go,.txt"
              className="hidden"
              onChange={handleEditFileUpload}
            />
          </div>
          <textarea
            value={editForm.code_content}
            onChange={e => setEditForm(f => ({ ...f, code_content: e.target.value }))}
            rows={12}
            className="w-full px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 font-mono text-sm resize-none"
            style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)' }}
          />
        </div>
      </div>

      <div className="flex gap-3 mt-6">
        <button
          onClick={() => setEditingTask(null)}
          className="flex-1 px-4 py-2 rounded-lg border hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors"
          style={{ borderColor: 'var(--glass-border)' }}
        >
          取消
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !editForm.title.trim() || !editForm.code_content.trim()}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {saving ? <Loader size={16} className="animate-spin" /> : <Pencil size={16} />}
          {saving ? '保存中...' : '保存修改'}
        </button>
      </div>
    </div>
    </div>
  </div>,
  document.body
)}
```

**Step 5: Verify end-to-end in browser**

1. Open Research Management page
2. Click the pencil icon on any task → modal opens with pre-filled data
3. Modify any field (e.g., change title)
4. Click "保存修改" → modal closes, task list refreshes with new data
5. Verify active tasks can also be edited

**Step 6: Commit**

```bash
git add admin-frontend/src/pages/ResearchManagement.tsx
git commit -m "feat: add edit modal for research tasks in admin panel"
```
