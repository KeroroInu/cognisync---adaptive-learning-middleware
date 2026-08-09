import { describe, expect, it } from 'vitest';
import { resolveApiBaseUrl } from './lib/apiClient';

describe('resolveApiBaseUrl', () => {
  it('uses the unified reverse-proxy path in production', () => {
    expect(resolveApiBaseUrl(true, 'http://localhost:8000/api')).toBe('/api');
  });

  it('keeps a custom development target when explicitly configured', () => {
    expect(resolveApiBaseUrl(false, 'http://localhost:8000/api')).toBe('http://localhost:8000/api');
  });

  it('falls back to the unified path when no target is configured', () => {
    expect(resolveApiBaseUrl(false, undefined)).toBe('/api');
  });
});
