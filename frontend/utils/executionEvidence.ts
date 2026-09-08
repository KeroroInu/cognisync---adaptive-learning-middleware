import type { StageArtifactPayload } from '../services/stageEvents';

// 整文件执行记录与函数正确性测试分开解释，不补造 passed 或 verified=true。
export function executionEvidence(code: string, completed: boolean, error: string, durationMs: number) {
  const artifacts: StageArtifactPayload[] = [{
    artifact_type: 'module_code', artifact_key: 'whole-file',
    content: { code, verified: false }, change_source: 'structure_edit',
    change_reason: '执行时的代码快照，不表示功能通过或已发生测试驱动修订',
  }];
  return {
    detail: { verification: 'execution_only', execution_completed: completed,
      error: error.slice(0, 1000), duration_ms: durationMs },
    artifacts,
  };
}
