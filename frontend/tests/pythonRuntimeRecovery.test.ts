import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { disposePythonModuleRunner, runPythonProgram } from '../services/pythonModuleRunner';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  messages: { id: string; source: string }[] = [];
  terminate = vi.fn();
  constructor() { FakeWorker.instances.push(this); }
  postMessage(message: { id: string; source: string }) { this.messages.push(message); }
  reply(type: string, extra: Record<string, unknown> = {}) {
    this.onmessage?.({ data: { type, id: this.messages.at(-1)!.id, ...extra } });
  }
}
const pendingWorker = async () => {
  await Promise.resolve(); await Promise.resolve();
  return FakeWorker.instances.at(-1)!;
};
beforeEach(() => { FakeWorker.instances = []; vi.stubGlobal('Worker', FakeWorker); vi.useFakeTimers(); });
afterEach(() => { disposePythonModuleRunner(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Python cold-start recovery', () => {
  it('discards a failed initialization so the next click can retry instead of reusing a rejected runtime', async () => {
    const first = runPythonProgram('print(1)');
    const failure = expect(first).rejects.toThrow('download failed');
    const failedWorker = await pendingWorker();
    failedWorker.reply('error', { message: 'download failed' });
    await failure;
    expect(failedWorker.terminate).toHaveBeenCalledOnce();
    const retry = runPythonProgram('print(2)');
    const freshWorker = await pendingWorker();
    expect(freshWorker).not.toBe(failedWorker);
    freshWorker.reply('executing');
    freshWorker.reply('result', { result: JSON.stringify({ completed: true, output: ['2'], canPreview: false }) });
    await expect(retry).resolves.toMatchObject({ completed: true, output: ['2'] });
  });

  it('keeps a loaded runtime after a Python error instead of downloading again', async () => {
    const first = runPythonProgram('broken');
    const failure = expect(first).rejects.toThrow('python error');
    const worker = await pendingWorker();
    worker.reply('executing'); worker.reply('error', { message: 'python error' }); await failure;
    expect(worker.terminate).not.toHaveBeenCalled();
    const retry = runPythonProgram('print(2)'); await pendingWorker();
    expect(FakeWorker.instances).toHaveLength(1);
    worker.reply('executing'); worker.reply('result', { result: '{}' }); await retry;
  });

  it('starts the five-second execution limit after initialization, not during download', async () => {
    const result = runPythonProgram('while True: pass');
    const failure = expect(result).rejects.toThrow('execution-timeout');
    const worker = await pendingWorker();
    await vi.advanceTimersByTimeAsync(10000);
    expect(worker.terminate).not.toHaveBeenCalled();
    worker.reply('executing');
    await vi.advanceTimersByTimeAsync(4999); expect(worker.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); await failure;
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
