import { describe, expect, it } from 'vitest';
import { hasProjectRun, retainSnakeEvidence, type SnakeRuntimeEvidence } from '../data/snakeProjectBlueprint';

const event = (type: SnakeRuntimeEvidence['type'], id: string): SnakeRuntimeEvidence => ({
  type, id, timestamp: '2026-09-07T00:00:00Z',
});

describe('observation stage runtime evidence', () => {
  it('does not equate opening or resetting a window with running', () => {
    expect(hasProjectRun([])).toBe(false);
    expect(hasProjectRun([event('opened', 'o'), event('reset', 'r')])).toBe(false);
  });
  it.each(['started', 'moved', 'food_eaten', 'collision', 'paused'] as const)(
    'recognizes legacy %s evidence even after opened was evicted', type => {
      expect(hasProjectRun([event(type, 'legacy')])).toBe(true);
    },
  );
  it('keeps proof of running after 100 later operations and a storage round trip', () => {
    let records = [event('opened', 'open'), event('started', 'first-run')];
    for (let i = 0; i < 100; i++) records = retainSnakeEvidence([...records, event('direction', `key-${i}`)]);
    expect(records).toHaveLength(30);
    expect(records.map(row => row.id)).toContain('first-run');
    expect(records.at(-1)?.id).toBe('key-99');
    expect(hasProjectRun(JSON.parse(JSON.stringify(records)))).toBe(true);
    expect(new Set(records.map(row => row.id)).size).toBe(records.length);
  });
  it('preserves actual legacy run proof when a later window is opened and reset', () => {
    const records = retainSnakeEvidence([event('collision', 'old'), event('opened', 'new'), event('reset', 'reset')]);
    expect(hasProjectRun(records)).toBe(true);
    expect(retainSnakeEvidence(records)).toEqual(records);
  });
});
