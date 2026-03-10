# Design: Research Task Edit Feature

**Date:** 2026-03-10
**Status:** Approved

## Problem

Admins can create research tasks but cannot edit them after creation. The backend `PATCH /research/tasks/{task_id}` endpoint and `adminApi.updateResearchTask()` method already exist; only the frontend UI is missing.

## Approach

Reuse the existing Create Modal in "edit mode" — same fields, same layout, pre-filled with current task data. Minimal code change confined to one file.

## Changes

### 1. `admin-frontend/src/lib/adminApi.ts`
- Add missing `ai_prompt` field to `updateResearchTask()` type signature.

### 2. `admin-frontend/src/pages/ResearchManagement.tsx`
- Add `editingTask` state (`ResearchTask | null`).
- Add `editForm` state (same shape as `form`), populated when edit opens.
- Add `saving` state for loading indicator.
- Add `handleEdit(task)` — sets `editingTask` and pre-fills `editForm`.
- Add `handleSave()` — calls `adminApi.updateResearchTask()`, closes modal, refreshes list.
- Add edit button (Pencil icon) in the actions column, visible for all task statuses.
- Add Edit Modal (portal, same structure as Create Modal) with title "编辑任务" and a "保存修改" submit button.
- Edit Modal supports file re-upload for code content.

## Constraints
- All task statuses (draft / active / archived) can be edited at any time.
- Edit does not change task status.
