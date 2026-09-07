import { it, expect } from 'vitest';
import { createRequestId } from './requestId';

it('creates distinct server-compatible UUIDs', () => {
  const ids = Array.from({ length: 30 }, createRequestId);
  expect(new Set(ids).size).toBe(30);
  expect(ids.every(id => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))).toBe(true);
});
