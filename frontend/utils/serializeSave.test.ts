import { describe, it, expect, vi } from 'vitest';
import { SerializedSaveQueue } from './serializeSave';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('SerializedSaveQueue', () => {
  it('should serialize consecutive saves and not drop any calls', async () => {
    const queue = new SerializedSaveQueue<number>();
    const saveCalls: number[] = [];

    const deferred1 = createDeferred<boolean>();
    const deferred2 = createDeferred<boolean>();

    const mockSave = vi.fn().mockImplementation((data: number) => {
      saveCalls.push(data);
      if (data === 1) return deferred1.promise;
      if (data === 2) return deferred2.promise;
      return Promise.resolve(true);
    });

    // 第一次保存延迟；
    const p1 = queue.enqueue(mockSave, 1);

    // 第二次保存排队；
    const p2 = queue.enqueue(mockSave, 2);

    await Promise.resolve(); // Wait for microtask

    // Initial state: mockSave should have been called for the first item, but not the second
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(saveCalls).toEqual([1]);

    // Resolve the first one
    deferred1.resolve(true);
    await p1;

    // After first resolves, second should start
    expect(mockSave).toHaveBeenCalledTimes(2);
    expect(saveCalls).toEqual([1, 2]);

    // Resolve the second one
    deferred2.resolve(true);
    await p2;

    // 两个调用最终都结束；调用顺序稳定；第二份快照最后落地；
    expect(saveCalls).toEqual([1, 2]);
  });

  it('should not block subsequent saves if an earlier save fails', async () => {
    const queue = new SerializedSaveQueue<number>();
    const saveCalls: number[] = [];

    const deferred1 = createDeferred<boolean>();
    const deferred2 = createDeferred<boolean>();

    const mockSave = vi.fn().mockImplementation((data: number) => {
      saveCalls.push(data);
      if (data === 1) return deferred1.promise;
      if (data === 2) return deferred2.promise;
      return Promise.resolve(true);
    });

    const p1 = queue.enqueue(mockSave, 1);
    const p2 = queue.enqueue(mockSave, 2);

    await Promise.resolve(); // Wait for microtask

    expect(mockSave).toHaveBeenCalledTimes(1);

    // Fail the first save
    deferred1.reject(new Error('Network error'));

    const result1 = await p1;
    // The queue wrapper catches errors and returns false
    expect(result1).toBe(false);

    // The second save should still run
    expect(mockSave).toHaveBeenCalledTimes(2);
    expect(saveCalls).toEqual([1, 2]);

    deferred2.resolve(true);
    const result2 = await p2;
    expect(result2).toBe(true);
  });

  it('should abort pending saves if destroyed', async () => {
    const queue = new SerializedSaveQueue<number>();
    const mockSave = vi.fn().mockResolvedValue(true);

    queue.destroy();

    const result = await queue.enqueue(mockSave, 1);
    expect(result).toBe(false);
    expect(mockSave).not.toHaveBeenCalled();
  });
});
