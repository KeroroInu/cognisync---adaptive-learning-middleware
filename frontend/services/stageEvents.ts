/**
 * 关键教学事件上报。
 *
 * 与 `save-workspace` 的分工：
 * - `save-workspace` 保存最新整份快照，会被覆盖，只用于跨设备恢复；
 * - 本模块写入**不可覆盖**的产物版本与事件，是正式实验的证据链。
 *
 * 只在有明确教学含义的操作完成时调用。**不要**接到逐字输入、拖拽坐标或游戏帧上：
 * 那些不构成研究证据，还会在 40–50 人并发下形成无意义写入。
 *
 * ## request_id 的正确用法
 *
 * `request_id` 是幂等键。它必须在**同一次关键时刻**内保持稳定，包括所有网络重试。
 * 现有支架助手里的 `scaffold-${Date.now()}` 是反例：它在每次提交时重新生成，
 * 手动重试会被后端计成一次新的求助，幂等键实际从未生效；毫秒精度在多标签页下
 * 也不足以保证唯一。因此这里统一用 `crypto.randomUUID()`，并且**在重试循环之外**
 * 生成一次。
 *
 * 同理，重试必须重发**完全相同的请求体**。后端会比对语义指纹：同一个 `request_id`
 * 配上不同内容会返回 409 而不是被当作重放，所以载荷要构建一次、复用到底。
 */
import {
  postFinalResearchSubmission,
  postStageEvent,
  type FinalSubmitRequestBody,
  type FinalSubmitResponse,
  type StageEventRequestBody,
  type StageEventResponse,
} from './api';
import type { StudentObservationCard } from '../components/ProjectFactory';
import type { StudentFunctionCard } from '../components/ProjectFunctionStage';
import type {
  StudentFunctionMechanism,
  StudentModuleProgress,
  StudentPathPlan,
} from '../data/projectPath';
import type { StudentCreativeFunction } from '../data/snakeCreativeFunctions';

/** 后端 ProjectStage 枚举。 */
export type BackendStage = 'observe' | 'decompose' | 'model' | 'plan' | 'build' | 'transfer' | 'reflect';

export type StageEventType =
  | 'stage_confirm'
  | 'structure_change'
  | 'module_test'
  | 'help_request'
  | 'final_submit';

export type ArtifactType =
  | 'observation'
  | 'function_card'
  | 'function_mapping'
  | 'mechanism'
  | 'path'
  | 'module_code'
  | 'revision_note';

export type ArtifactChangeSource =
  | 'stage_confirm'
  | 'structure_edit'
  | 'test_revision'
  | 'scaffold_followup'
  | 'import';

export interface StageArtifactPayload {
  artifact_type: ArtifactType;
  artifact_key: string;
  content: Record<string, unknown>;
  change_source: ArtifactChangeSource;
  change_reason?: string;
}

/**
 * 上报结果。**不抛异常**——调用方是学生的确认操作，证据写入失败不应该让
 * 界面卡死；但也绝不能静默吞掉，否则会出现「界面提示已确认、证据其实没写入」。
 * 调用方必须根据非成功状态给出提示。
 */
export type StageEventOutcome =
  | { status: 'recorded'; data: StageEventResponse }
  | { status: 'replayed'; data: StageEventResponse }
  | { status: 'task-not-active' }
  | { status: 'idempotency-conflict' }
  | { status: 'invalid-combination'; message: string }
  | { status: 'rejected-payload' }
  | { status: 'too-large' }
  | { status: 'not-found' }
  | { status: 'failed'; message: string };

export const isStageEventPersisted = (outcome: StageEventOutcome): boolean =>
  outcome.status === 'recorded' || outcome.status === 'replayed';

export type FinalSubmissionOutcome =
  | { status: 'recorded'; data: FinalSubmitResponse }
  | { status: 'replayed'; data: FinalSubmitResponse }
  | { status: 'task-not-active' }
  | { status: 'idempotency-conflict' }
  | { status: 'invalid-combination'; message: string }
  | { status: 'rejected-payload' }
  | { status: 'too-large' }
  | { status: 'not-found' }
  | { status: 'failed'; message: string };

export const isFinalSubmissionPersisted = (outcome: FinalSubmissionOutcome): boolean =>
  outcome.status === 'recorded' || outcome.status === 'replayed';

/**
 * 由 `Research.tsx` 注入给各阶段组件的上报入口。
 *
 * 组件不直接调用 `reportStageEvent`：幂等键生成、「先保存工作区再写事件」的
 * 顺序、以及失败提示都集中在 `Research.tsx` 的 `reportKeyMoment` 里，
 * 分散实现必然出现某个阶段忘了其中一环。
 *
 * 返回 `true` 表示证据已落库（新记录或幂等重放）。
 */
export type ReportKeyMoment = (params: {
  stage: BackendStage;
  eventType: StageEventType;
  detail?: Record<string, unknown>;
  artifacts?: StageArtifactPayload[];
  keepalive?: boolean;
}) => Promise<boolean>;

/** 生成幂等键。必须在重试循环之外调用一次。 */
export const createRequestId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // 老浏览器兜底：仍然基于随机数而非时间戳，避免多标签页同毫秒碰撞。
  const random = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).slice(1);
  return `${random()}${random()}-${random()}-${random()}-${random()}-${random()}${random()}${random()}`;
};

const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 600;

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

type TerminalFailure = Exclude<
  StageEventOutcome,
  { status: 'recorded'; data: StageEventResponse } | { status: 'replayed'; data: StageEventResponse }
>;

/** 把共用的 HTTP 终态映射集中起来，避免阶段事件与最终提交语义漂移。 */
const classifyTerminalFailure = (error: unknown): TerminalFailure | null => {
  const status = (error as { status?: number }).status;
  const detail = (error as { detail?: unknown }).detail;
  const detailCode =
    detail && typeof detail === 'object' ? (detail as { code?: string }).code : undefined;

  if (status === 409) {
    return detailCode === 'TASK_NOT_ACTIVE'
      ? { status: 'task-not-active' }
      : { status: 'idempotency-conflict' };
  }
  if (status === 422) {
    return typeof detail === 'string'
      ? { status: 'invalid-combination', message: detail }
      : { status: 'rejected-payload' };
  }
  if (status === 413) return { status: 'too-large' };
  if (status === 404) return { status: 'not-found' };
  if (status === 401 || status === 403) {
    return { status: 'failed', message: '登录状态已失效，请重新登录' };
  }
  return null;
};

/**
 * 发送一次关键事件，失败时按指数退避重试。
 *
 * 只重试网络错误和 5xx：4xx 全部是终态，重试没有意义，反而会拖慢学生的界面。
 */
export async function reportStageEvent(
  taskId: string,
  body: StageEventRequestBody,
  options?: { keepalive?: boolean },
): Promise<StageEventOutcome> {
  let lastMessage = '';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      // 每次重试都重发同一个 body 对象，保证语义指纹一致。
      const result = await postStageEvent(taskId, body, options);
      return result.replayed
        ? { status: 'replayed', data: result }
        : { status: 'recorded', data: result };
    } catch (error) {
      const terminal = classifyTerminalFailure(error);
      if (terminal) return terminal;

      lastMessage = error instanceof Error ? error.message : String(error);
      if (attempt < MAX_ATTEMPTS) {
        await delay(RETRY_BASE_DELAY_MS * attempt);
      }
    }
  }

  return { status: 'failed', message: lastMessage || '网络异常' };
}

/**
 * 提交最终产物并完成任务。与 `reportStageEvent` 保持相同的重试约定：
 * 只重试网络错误/5xx，且全程重发同一个 body 和 request_id。
 */
export async function reportFinalSubmission(
  taskId: string,
  body: FinalSubmitRequestBody,
): Promise<FinalSubmissionOutcome> {
  let lastMessage = '';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const result = await postFinalResearchSubmission(taskId, body);
      return result.replayed
        ? { status: 'replayed', data: result }
        : { status: 'recorded', data: result };
    } catch (error) {
      const terminal = classifyTerminalFailure(error);
      if (terminal) return terminal;

      lastMessage = error instanceof Error ? error.message : String(error);
      if (attempt < MAX_ATTEMPTS) {
        await delay(RETRY_BASE_DELAY_MS * attempt);
      }
    }
  }

  return { status: 'failed', message: lastMessage || '网络异常' };
}

// ── 产物构建 ─────────────────────────────────────────────────────────────────
//
// 统一原则：
// 1. `artifact_key` 一律使用工作区里的稳定 ID（卡片/节点/模块 ID），绝不用数组下标；
// 2. `content` 是该产物的**完整快照**，但剔除画布坐标——坐标不是教学证据，
//    而且每次拖动都会改变内容哈希，凭空制造大量无意义版本，污染「修订次数」；
// 3. 时间戳类字段保留（confirmedAt 等有教学含义），但不引入本地生成的当前时间，
//    否则同一次重试的指纹会变。

/** 去掉与教学无关的布局坐标。 */
const stripLayout = <T extends Record<string, unknown>>(value: T): Record<string, unknown> => {
  const { position, canvasPositions, canvasLayoutVersion, ...rest } = value as Record<string, unknown>;
  void position;
  void canvasPositions;
  void canvasLayoutVersion;
  return rest;
};

export const observationArtifacts = (
  cards: StudentObservationCard[],
  changeSource: ArtifactChangeSource = 'stage_confirm',
): StageArtifactPayload[] =>
  cards.map(card => ({
    artifact_type: 'observation',
    artifact_key: card.id,
    content: {
      evidenceId: card.evidenceId,
      evidenceText: card.evidenceText,
      observationText: card.observationText,
      source: card.source,
      createdAt: card.createdAt,
    },
    change_source: changeSource,
  }));

export const functionCardArtifacts = (
  cards: StudentFunctionCard[],
  changeSource: ArtifactChangeSource = 'stage_confirm',
): StageArtifactPayload[] =>
  cards.map(card => ({
    artifact_type: 'function_card',
    artifact_key: card.id,
    content: {
      observationId: card.observationId,
      evidenceId: card.evidenceId,
      observationText: card.observationText,
      responsibility: card.responsibility,
      implementation: card.implementation ?? '',
      input: card.input,
      output: card.output,
      knowledge: card.knowledge,
      verification: card.verification,
      boundaryReason: card.boundaryReason,
      responsibilityOwner: card.responsibilityOwner,
      source: card.source,
      createdAt: card.createdAt,
      updatedAt: card.updatedAt,
    },
    change_source: changeSource,
  }));

/**
 * 学生对教师蓝图契约的采纳决定。
 *
 * 它没有独立 ID（是功能卡上的嵌套字段），因此用 `${card.id}::mapping` 作为稳定键——
 * 与功能卡本身区分开，同时保持可追溯。后端的去重键是 `(type, key)`，
 * 即便这里直接用 `card.id` 也不会与功能卡冲突，但显式后缀更利于导出时人读。
 */
export const functionMappingArtifacts = (
  cards: StudentFunctionCard[],
  changeSource: ArtifactChangeSource = 'stage_confirm',
): StageArtifactPayload[] =>
  cards
    .filter(card => card.mappingDecision && card.mappingDecision.status !== 'pending')
    .map(card => ({
      artifact_type: 'function_mapping',
      artifact_key: `${card.id}::mapping`,
      content: {
        cardId: card.id,
        status: card.mappingDecision!.status,
        blueprintVersionId: card.mappingDecision!.blueprintVersionId,
        acceptedNodeIds: card.mappingDecision!.acceptedNodeIds,
        // 只记录学生看到过哪些建议节点，不复制建议全文——
        // 那是教师蓝图派生内容，不是学生产物。
        suggestedNodeIds: card.mappingDecision!.suggestions.map(item => item.node_id),
        suggestedAt: card.mappingDecision!.suggestedAt,
        decidedAt: card.mappingDecision!.decidedAt,
      },
      change_source: changeSource,
    }));

export const mechanismArtifact = (
  cardId: string,
  mechanism: StudentFunctionMechanism,
  changeSource: ArtifactChangeSource = 'stage_confirm',
  changeReason?: string,
): StageArtifactPayload => ({
  artifact_type: 'mechanism',
  artifact_key: cardId,
  content: {
    cardId,
    // 节点保留 id/kind/label（教学含义），剔除 position（画布坐标）。
    flowNodes: mechanism.flowNodes.map(node => stripLayout(node as unknown as Record<string, unknown>)),
    diagramEdges: mechanism.diagramEdges,
    confirmedAt: mechanism.confirmedAt,
  },
  change_source: changeSource,
  change_reason: changeReason,
});

/** 系统关系与实现路径。整个任务只有一份，用固定键。 */
export const pathArtifact = (
  plan: StudentPathPlan,
  changeSource: ArtifactChangeSource = 'stage_confirm',
  changeReason?: string,
): StageArtifactPayload => ({
  artifact_type: 'path',
  artifact_key: 'project-path',
  content: {
    orderedCardIds: plan.orderedCardIds,
    prerequisites: plan.prerequisites,
    relationKinds: plan.relationKinds,
    confirmedAt: plan.confirmedAt,
    // 刻意不含 functionMechanisms / canvasPositions：
    // 前者已作为独立的 mechanism 产物逐卡记录，重复计入会让同一次修改
    // 同时改变两个产物的哈希；后者是画布坐标。
  },
  change_source: changeSource,
  change_reason: changeReason,
});

/**
 * 模块代码产物。
 *
 * `content` 只放**代码本身及其判定结果**，刻意排除 `updatedAt`、`attemptCount`
 * 和 `lastAttempt`：
 *
 * - `lastAttempt` 带随机 id 和本地时间戳，`updatedAt`/`attemptCount` 每次运行必变；
 * - 三者任一进入 content，内容哈希就每次都不同，后端「内容无实质变化不建新版本」
 *   的去重永远不会命中；
 * - 于是学生把同一段代码反复跑几次测试，就会凭空产生几个版本，直接抬高
 *   「修订次数」——而去重机制存在的目的正是保护这个研究指标。
 *
 * 这次测试的结果（passed / resultCode / durationMs）记在 `stage_events.detail` 里，
 * 因此排除它们不丢任何信息：每次运行仍有一条 module_test 事件，只是代码没变时
 * 不再多出一个代码版本。
 */
export const moduleCodeArtifact = (
  unitId: string,
  progress: StudentModuleProgress,
  changeSource: ArtifactChangeSource = 'structure_edit',
  changeReason?: string,
): StageArtifactPayload => ({
  artifact_type: 'module_code',
  artifact_key: unitId,
  content: {
    cardId: progress.cardId,
    blueprintNodeId: progress.blueprintNodeId,
    code: progress.code,
    verified: progress.verified,
  },
  change_source: changeSource,
  change_reason: changeReason,
});

/** 创意函数沿用 module_code 产物类型，以 `creative::<UUID>` 稳定键与基础函数区分。 */
export const creativeCodeArtifact = (
  card: StudentCreativeFunction,
  changeSource: ArtifactChangeSource = 'structure_edit',
  changeReason?: string,
  deleted = false,
): StageArtifactPayload => ({
  artifact_type: 'module_code',
  artifact_key: `creative::${card.id}`,
  content: {
    creative: true,
    cardId: card.id,
    title: card.title,
    hook: card.hook,
    code: card.code,
    enabled: deleted ? false : card.enabled,
    verified: deleted ? false : card.verified,
    deleted,
  },
  change_source: changeSource,
  change_reason: changeReason,
});
