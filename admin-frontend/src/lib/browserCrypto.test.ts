import { afterEach, describe, expect, it, vi } from 'vitest';
import { installRandomUUID } from './browserCrypto';
import { installRandomUUID as installStudentRandomUUID } from '../../../frontend/utils/browserCrypto';

afterEach(() => { vi.unstubAllGlobals(); });

describe.each([['teacher', installRandomUUID], ['student', installStudentRandomUUID]] as const)('%s HTTP UUID compatibility', (_, install) => {
  it('keeps native UUID generation unchanged on HTTPS', () => {
    const native = vi.fn();
    vi.stubGlobal('crypto', { randomUUID: native });
    install();
    expect(crypto.randomUUID).toBe(native);
  });
  it('generates RFC 4122 v4 UUIDs using secure random bytes on HTTP', () => {
    const random = vi.fn((bytes: Uint8Array) => { bytes.fill(255); return bytes; });
    vi.stubGlobal('crypto', { getRandomValues: random });
    install();
    expect(crypto.randomUUID()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(random).toHaveBeenCalledTimes(1);
    const uuid = crypto.randomUUID;
    install();
    expect(crypto.randomUUID).toBe(uuid);
  });
  it('does not substitute insecure randomness when Web Crypto is absent', () => {
    vi.stubGlobal('crypto', undefined);
    expect(install).not.toThrow();
    expect(globalThis.crypto).toBeUndefined();
  });
});
