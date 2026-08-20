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

// 同源加载，不走公共 CDN。
//
// 原实现从 cdn.jsdelivr.net 拉取，在国内课堂环境经常极慢甚至不可达，
// 而建构阶段的模块测试完全依赖它——加载不出来学生就卡在「正在加载 Python 环境」。
// 运行时文件由 scripts/fetch-pyodide.sh 在构建期放进 public/pyodide/，
// 随前端镜像一起分发。
//
// 注意：这里是 Worker 作用域，没有 import.meta.env，因此用绝对路径而非构建期变量。
// 若前端部署在子路径下，需同步修改此处与 Research.tsx 中的 PYODIDE_BASE_URL。
const PYODIDE_BASE_URL = '/pyodide/';

const getRuntime = () => {
  if (runtimePromise) return runtimePromise;
  workerScope.postMessage({ type: 'runtime-loading' });
  workerScope.importScripts(`${PYODIDE_BASE_URL}pyodide.js`);
  if (!workerScope.loadPyodide) throw new Error('Python runtime failed to initialize');
  runtimePromise = workerScope.loadPyodide({
    indexURL: PYODIDE_BASE_URL,
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
