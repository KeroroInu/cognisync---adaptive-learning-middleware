interface PyodideRuntime {
  runPythonAsync: (source: string) => Promise<unknown>;
}

interface WorkerScope {
  importScripts: (...urls: string[]) => void;
  loadPyodide?: (options: { indexURL: string }) => Promise<PyodideRuntime>;
  postMessage: (message: unknown) => void;
  onmessage: ((event: MessageEvent<{ id: string; source: string }>) => void) | null;
}

const workerScope = self as unknown as WorkerScope;
let runtimePromise: Promise<PyodideRuntime> | null = null;

const getRuntime = () => {
  if (runtimePromise) return runtimePromise;
  workerScope.postMessage({ type: 'runtime-loading' });
  workerScope.importScripts('https://cdn.jsdelivr.net/pyodide/v0.27.0/full/pyodide.js');
  if (!workerScope.loadPyodide) throw new Error('Python runtime failed to initialize');
  runtimePromise = workerScope.loadPyodide({
    indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.27.0/full/',
  });
  return runtimePromise;
};

workerScope.onmessage = async event => {
  const { id, source } = event.data;
  try {
    const runtime = await getRuntime();
    workerScope.postMessage({ type: 'executing', id });
    const result = await runtime.runPythonAsync(source);
    workerScope.postMessage({ type: 'result', id, result: String(result ?? '') });
  } catch (error) {
    workerScope.postMessage({
      type: 'error',
      id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
