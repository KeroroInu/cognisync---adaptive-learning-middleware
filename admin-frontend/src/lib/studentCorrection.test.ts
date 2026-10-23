import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminApi } from './adminApi';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('student identity correction', () => {
  it('sends identity updates against immutable UUID without a password', async () => {
    vi.stubGlobal('localStorage', { getItem: () => 'test-only-token' });
    const fetch = vi.fn(async () => new Response(JSON.stringify({ success: true, data: { id: 'student-uuid' } })));
    vi.stubGlobal('fetch', fetch);
    const update = { name: '更正姓名', student_id: 'G202600001', gender: 'female' as const, class_name: '开发班', experiment_group: 'ai_pbl' as const };
    await adminApi.updateUser('student-uuid', update);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/users/student-uuid'), expect.objectContaining({ method: 'PATCH', body: JSON.stringify(update) }));
    expect(fetch.mock.calls[0]).not.toContain('password');
  });
  it('shows validation text instead of object Object', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('localStorage', { getItem: () => 'test-only-token' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: [{ msg: '请填写完整学号' }] }), { status: 422 })));
    await expect(adminApi.updateUser('student-uuid', { student_id: '' })).rejects.toThrow('请填写完整学号');
  });
});
