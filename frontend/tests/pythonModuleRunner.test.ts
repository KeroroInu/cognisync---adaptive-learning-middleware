import { describe, expect, it } from 'vitest';

import { CREATIVE_SAFE_BUILTIN_NAMES } from '../services/pythonModuleRunner';

describe('creative runner contract', () => {
  it('supports bounded terminal diagnostics without opening unsafe capabilities', () => {
    expect(CREATIVE_SAFE_BUILTIN_NAMES).toContain('print');
    expect(CREATIVE_SAFE_BUILTIN_NAMES).not.toContain('open');
    expect(CREATIVE_SAFE_BUILTIN_NAMES).not.toContain('eval');
    expect(CREATIVE_SAFE_BUILTIN_NAMES).not.toContain('__import__');
  });
});
