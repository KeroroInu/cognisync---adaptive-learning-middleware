export const codeDraftKey = (scope: string) => `cognisync:code-draft:v1:${scope}`;
export function readCodeDraft(scope: string): string | null {
  try {
    const value = JSON.parse(localStorage.getItem(codeDraftKey(scope)) || 'null');
    return typeof value?.code === 'string' ? value.code : null;
  } catch { return null; }
}

/** Latest-value queue: acknowledged old saves cannot erase a newer local draft. */
export function createCodePersistence({ scope, save, current, onStatus, onStorageError }: {
  scope: string; save: (code: string, keepalive: boolean) => Promise<void>;
  current: () => boolean; onStatus: (status: 'saved' | 'saving' | 'unsaved') => void;
  onStorageError: () => void;
}) {
  let pending: string | null = null;
  let running: Promise<void> | null = null;
  return {
    enqueue(code: string) {
      pending = code;
      try { localStorage.setItem(codeDraftKey(scope), JSON.stringify({ code })); } catch { onStorageError(); }
      if (current()) onStatus('unsaved');
    },
    flush(keepalive = false): Promise<void> {
      if (running) return running;
      // Schedule asynchronously so even an empty queue cannot leave a settled promise in the lock.
      running = Promise.resolve().then(async () => {
        while (pending !== null && current()) {
          const code = pending; pending = null; onStatus('saving');
          try {
            await save(code, keepalive);
            if (!current()) return;
            try { if (readCodeDraft(scope) === code) localStorage.removeItem(codeDraftKey(scope)); } catch { /* Server save succeeded. */ }
          } catch {
            pending ??= code;
            if (current()) onStatus('unsaved');
            return;
          }
        }
        if (current()) onStatus('saved');
      }).finally(() => { running = null; });
      return running;
    },
  };
}
