import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureCurrentSession, createWorkspaceScope } from '../data/workspaceScope';
import { collectSnakeProjectWorkspace, hydrateSnakeProjectWorkspace, seedSnakeProjectDemo } from '../data/snakeProjectDemo';
import { postStageEvent, postFinalResearchSubmission } from '../services/api';
import { reportStageEvent, reportFinalSubmission } from '../services/stageEvents';

vi.mock('../services/api', () => ({ postStageEvent: vi.fn(), postFinalResearchSubmission: vi.fn() }));

let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map([['cognisync-token', 'session-a']]);
  vi.stubGlobal('window', { localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  } });
  vi.clearAllMocks();
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('learner + task workspace isolation', () => {
  it('does not import a previous learner’s legacy demo into a new learner', () => {
    seedSnakeProjectDemo('task-1');
    // This is the old path that caused the observed contamination.
    expect(collectSnakeProjectWorkspace('task-1').observations.length).toBeGreaterThan(0);
    const fresh = collectSnakeProjectWorkspace(createWorkspaceScope('new-student', 'task-1'));
    expect(fresh.observations).toEqual([]);
    expect(fresh.functions).toEqual([]);
    expect(fresh.evidence).toEqual([]);
    expect(fresh.path).toEqual({ orderedCardIds: [], prerequisites: {}, relationKinds: {} });
    expect(fresh.progress).toEqual({});
    expect(fresh.creativeFunctions).toEqual([]);
  });

  it('restores each learner’s cloud content without overwriting the other learner', () => {
    const first = createWorkspaceScope('kero-id', 'task-1');
    const second = createWorkspaceScope('new-student', 'task-1');
    const original = seedSnakeProjectDemo(first).workspace;
    const blank = collectSnakeProjectWorkspace(second);
    hydrateSnakeProjectWorkspace(second, { ...blank, observations: [original.observations[0]] });
    expect(collectSnakeProjectWorkspace(first).observations).toEqual(original.observations);
    expect(collectSnakeProjectWorkspace(second).observations).toEqual([original.observations[0]]);
    // A server reset must also replace stale data in the account's local cache.
    hydrateSnakeProjectWorkspace(second, blank);
    expect(collectSnakeProjectWorkspace(second).observations).toEqual([]);
    expect(collectSnakeProjectWorkspace(first).progress).toEqual(original.progress);
  });

  it('separates tasks and delimiter-containing identities; refuses anonymous fallbacks', () => {
    expect(createWorkspaceScope('a:b', 'c')).not.toBe(createWorkspaceScope('a', 'b:c'));
    expect(createWorkspaceScope('a', 'task1')).not.toBe(createWorkspaceScope('a', 'task2'));
    expect(() => createWorkspaceScope('', 'task')).toThrow();
    expect(() => createWorkspaceScope('a', '')).toThrow();
  });

  it('invalidates queued callbacks on logout or account switch', () => {
    const current = captureCurrentSession();
    expect(current()).toBe(true);
    storage.set('cognisync-token', 'session-b');
    expect(current()).toBe(false);
    storage.delete('cognisync-token');
    expect(current()).toBe(false);
    expect(captureCurrentSession()()).toBe(false);
  });
});

describe('research retries are tied to the originating login', () => {
  it.each(['event', 'final'] as const)('does not retry %s with a different student’s token', async kind => {
    vi.useFakeTimers();
    const endpoint = kind === 'event' ? vi.mocked(postStageEvent) : vi.mocked(postFinalResearchSubmission);
    endpoint.mockRejectedValue(new Error('network unavailable'));
    const result = kind === 'event'
      ? reportStageEvent('task-1', { request_id: 'same-id', stage: 'observe', event_type: 'stage_confirm' })
      : reportFinalSubmission('task-1', { request_id: 'same-id', stage: 'build', code_submitted: '' });
    expect(endpoint).toHaveBeenCalledTimes(1);
    storage.set('cognisync-token', 'session-b');
    await vi.advanceTimersByTimeAsync(2000);
    expect((await result).status).toBe('failed');
    expect(endpoint).toHaveBeenCalledTimes(1);
  });

  it('still retries with the same request body while the session is unchanged', async () => {
    vi.useFakeTimers();
    vi.mocked(postStageEvent).mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce({ replayed: false } as Awaited<ReturnType<typeof postStageEvent>>);
    const body = { request_id: 'same-id', stage: 'observe', event_type: 'stage_confirm' } as const;
    const result = reportStageEvent('task-1', body);
    await vi.advanceTimersByTimeAsync(600);
    expect((await result).status).toBe('recorded');
    expect(postStageEvent).toHaveBeenNthCalledWith(2, 'task-1', body, undefined);
  });
});
