import { describe, expect, it } from 'vitest';

import { formatDate, normalizeIso } from './ResearchManagement';

describe('ResearchManagement date helpers', () => {
  it('appends UTC suffix when timezone is missing', () => {
    expect(normalizeIso('2026-03-29T10:20:30')).toBe('2026-03-29T10:20:30Z');
  });

  it('preserves explicit timezone values', () => {
    expect(normalizeIso('2026-03-29T10:20:30+08:00')).toBe('2026-03-29T10:20:30+08:00');
    expect(normalizeIso('2026-03-29T10:20:30Z')).toBe('2026-03-29T10:20:30Z');
  });

  it('returns empty string for invalid dates', () => {
    expect(formatDate('not-a-date')).toBe('');
  });
});
