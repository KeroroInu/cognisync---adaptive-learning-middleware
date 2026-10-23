import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseFunctionDiscussion, functionDiscussionSummary, hasFunctionIdea, type FunctionDiscussionDraft } from '../data/functionDiscussion';
import { collectSnakeProjectWorkspace, hydrateSnakeProjectWorkspace } from '../data/snakeProjectDemo';
import { functionCardArtifacts } from '../services/stageEvents';
import type { StudentFunctionCard } from '../components/ProjectFunctionStage';

const draft: FunctionDiscussionDraft = { id: 'discussion-a', responsibility: '吃到食物', implementation: '如果碰到食物：\n    分数加十', acceptedDraftRequestId: 'r1', messages: [
  { requestId: 'r1', role: 'assistant', text: '草稿\n```steps\n如果碰到食物：\n    分数加十\n```', steps: '如果碰到食物：\n    分数加十', createdAt: '2026-09-15T00:00:00Z' },
] };
afterEach(() => vi.unstubAllGlobals());
describe('function discussion drafts and evidence', () => {
  it('does not present historical analysis JSON as a student-facing hint', () => {
    const raw = JSON.stringify({ intent: 'reflection', delta: {}, detectedConcepts: [] });
    expect(parseFunctionDiscussion(raw).text).toContain('异常的内部分析');
    expect(parseFunctionDiscussion('{"score": 10}')).toEqual({ text: '{"score": 10}' });
  });
  it('does not count a hint request as the student expressing an implementation idea', () => {
    const empty = { ...draft, implementation: '', messages: [] };
    expect(hasFunctionIdea(empty)).toBe(false);
    const message = { role: 'user' as const, requestId: 'hint', createdAt: '', text: '给我一点提示' };
    expect(hasFunctionIdea({ ...empty, messages: [{ ...message, action: 'idea_hint' }] })).toBe(false);
    expect(hasFunctionIdea({ ...empty, messages: [{ ...message, action: 'message', text: '如果碰到食物，分数加十' }] })).toBe(true);
  });
  it('only recognizes explicit complete steps blocks', () => {
    expect(parseFunctionDiscussion(draft.messages[0].text)).toEqual({ text: '草稿', steps: draft.implementation });
    for (const text of ['你觉得应该先做什么？', '```python\nprint(1)\n```', '```steps\n未完成', `\n\`\`\`steps\n${'字'.repeat(801)}\n\`\`\``]) expect(parseFunctionDiscussion(text)).toEqual({ text });
  });
  it('sends artifact data without re-inserting transcript or code instructions', () => {
    const summary = JSON.parse(functionDiscussionSummary('食物出现', draft));
    expect(summary.functionName).toBe(draft.responsibility);
    expect(summary.studentSteps).toBe(draft.implementation);
    expect(summary).not.toHaveProperty('messages');
  });
  it('round-trips unsaved discussions, isolates students and accepts older workspaces', () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } });
    const workspace = collectSnakeProjectWorkspace('student-a:task');
    workspace.functionDiscussions = { observation: draft };
    hydrateSnakeProjectWorkspace('student-a:task', workspace);
    expect(collectSnakeProjectWorkspace('student-a:task').functionDiscussions).toEqual({ observation: draft });
    expect(collectSnakeProjectWorkspace('student-b:task').functionDiscussions).toEqual({});
    delete workspace.functionDiscussions;
    hydrateSnakeProjectWorkspace('student-a:task', workspace);
    expect(collectSnakeProjectWorkspace('student-a:task').functionDiscussions).toEqual({});
  });
  it('keeps AI draft and final student-edited steps together in exported artifacts', () => {
    const card = { id: 'card-a', observationId: 'o', responsibility: draft.responsibility, implementation: '学生修改后的步骤', discussion: draft, source: 'ai-assisted' } as StudentFunctionCard;
    const artifact = functionCardArtifacts([card], 'structure_edit')[0];
    expect(artifact.content.implementation).toBe('学生修改后的步骤');
    expect(artifact.content.discussion).toEqual(draft);
    expect(artifact.content.source).toBe('ai-assisted');
  });
});
