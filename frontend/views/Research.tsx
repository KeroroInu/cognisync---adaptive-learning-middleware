import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Send, CheckCircle, FlaskConical, Loader, Save, Play, Terminal, Trash2, X } from 'lucide-react';
import type { ChatMessage, Language, User, UserProfile, ResearchTask } from '../types';
import {
  sendChatMessage,
  getActiveResearchTask,
  saveResearchProgress,
  saveResearchWorkspace,
  reopenResearchTask,
} from '../services/api';
import { SnakeProjectDemo } from '../components/SnakeProjectDemo';
import {
  ProjectScaffoldAssistant,
  type ScaffoldArtifactContext,
  type ScaffoldCompletion,
} from '../components/ProjectScaffoldAssistant';
import {
  ProjectFactoryHeader,
  ProjectObservationStage,
  ProjectStagePreview,
  type ProjectStage,
} from '../components/ProjectFactory';
import { ProjectFunctionStage } from '../components/ProjectFunctionStage';
import { ProjectBuildStage, type ProjectBuildAssistantContext } from '../components/ProjectBuildStage';
import type { SnakeRuntimeEvidence } from '../data/snakeProjectBlueprint';
import {
  collectSnakeProjectWorkspace,
  createSnakeProjectMechanisms,
  hydrateSnakeProjectWorkspace,
  isSnakeProjectWorkspace,
  seedSnakeProjectDemo,
  upgradeSnakeProjectFunctionCards,
  type SnakeProjectWorkspace,
} from '../data/snakeProjectDemo';
import {
  createRequestId,
  functionCardArtifacts,
  functionMappingArtifacts,
  isFinalSubmissionPersisted,
  isStageEventPersisted,
  moduleCodeArtifact,
  observationArtifacts,
  reportFinalSubmission,
  reportStageEvent,
  type ArtifactChangeSource,
  type BackendStage,
  type StageArtifactPayload,
  type StageEventType,
} from '../services/stageEvents';

const ResearchCodeEditor = React.lazy(() => import('../components/ResearchCodeEditor'));

// ── Types ──────────────────────────────────────────────────────────────────

interface TerminalLine {
  type: 'stdout' | 'stderr' | 'info' | 'error';
  text: string;
}

interface Props {
  onUpdateProfile: (profile: UserProfile) => void;
  onExit: () => void;
  language: Language;
  theme: 'light' | 'dark';
  userId?: string;
  studentId?: string;
  experimentGroup: User['experimentGroup'];
}

type WorkspaceSaveStatus = 'saved' | 'saving' | 'unsaved' | 'error';

const workspaceSignature = (workspace: SnakeProjectWorkspace) => JSON.stringify({
  version: workspace.version,
  evidence: workspace.evidence,
  observations: workspace.observations,
  functions: workspace.functions,
  path: workspace.path,
  progress: workspace.progress,
  creativeFunctions: workspace.creativeFunctions ?? [],
});

const summarizeStudentTaskWorkspace = (workspace: SnakeProjectWorkspace) => {
  const functionById = new Map(workspace.functions.map(card => [card.id, card.responsibility]));
  const lines = [
    `【当前任务完整过程数据】观察卡 ${workspace.observations.length} 张；功能卡 ${workspace.functions.length} 张；模块记录 ${Object.keys(workspace.progress).length} 个。`,
  ];

  if (workspace.observations.length > 0) {
    lines.push('观察记录：');
    workspace.observations.slice(-8).forEach((item, index) => {
      lines.push(`${index + 1}. ${item.observationText}`);
    });
  }

  if (workspace.functions.length > 0) {
    lines.push('功能卡：');
    workspace.functions.slice(-10).forEach((item, index) => {
      const mappedTitles = item.mappingDecision?.status === 'accepted'
        ? item.mappingDecision.suggestions
          .filter(suggestion => item.mappingDecision?.acceptedNodeIds.includes(suggestion.node_id))
          .map(suggestion => suggestion.title_zh)
          .join('、')
        : item.mappingDecision?.status ?? '旧数据未判断';
      lines.push(
        `${index + 1}. ${item.responsibility}｜实现描述 ${item.implementation || '未填'}`
        + `｜引用观察 ${item.observationText || '未记录'}`
        // 以下为旧版字段，只在历史卡片上还有值；新流程不再采集
        + (item.input || item.output ? `｜旧IN ${item.input || '-'}｜旧OUT ${item.output || '-'}` : '')
        + (mappedTitles ? `｜旧契约判断 ${mappedTitles}` : ''),
      );
    });
  }

  const mechanisms = workspace.path.functionMechanisms ?? {};
  const mechanismEntries = Object.entries(mechanisms);
  if (mechanismEntries.length > 0) {
    lines.push('功能内部流程图：');
    mechanismEntries.slice(-10).forEach(([cardId, mechanism]) => {
      const labels = mechanism.flowNodes.map(node => node.label).filter(Boolean);
      lines.push(
        `- ${functionById.get(cardId) ?? cardId}：${labels.slice(0, 8).join(' → ') || '尚未放置节点'}`
        + `；${mechanism.diagramEdges.length} 条连线`,
      );
    });
  }

  const relationCount = Object.values(workspace.path.prerequisites)
    .reduce((sum, ids) => sum + ids.length, 0);
  const orderedNames = workspace.path.orderedCardIds.map(id => functionById.get(id) ?? id);
  lines.push(`项目实现路径：${orderedNames.join(' → ') || '尚未排序'}；前置关系 ${relationCount} 条。`);

  const progressEntries = Object.entries(workspace.progress);
  if (progressEntries.length > 0) {
    lines.push('模块建构：');
    progressEntries.slice(-10).forEach(([, item]) => {
      const latestAttempt = item.testAttempts?.[item.testAttempts.length - 1];
      lines.push(
        `- ${functionById.get(item.cardId) ?? item.cardId} / ${item.blueprintNodeId}：${item.verified ? '已验证' : '未验证'}`
        + (latestAttempt ? `；最近测试 ${latestAttempt.passed ? '通过' : '未通过'}(${latestAttempt.resultCode})` : '；尚无测试记录'),
      );
    });
  }

  const creativeFunctions = workspace.creativeFunctions ?? [];
  if (creativeFunctions.length > 0) {
    lines.push('创意功能：');
    creativeFunctions.slice(-12).forEach(item => {
      const latestAttempt = item.testAttempts?.[item.testAttempts.length - 1];
      lines.push(
        `- ${item.title}｜钩子 ${item.hook}｜${item.enabled ? '已启用' : item.verified ? '已验证未启用' : '待验证'}`
        + (latestAttempt ? `｜最近测试 ${latestAttempt.passed ? '通过' : '未通过'}(${latestAttempt.resultCode})` : ''),
      );
    });
  }

  return lines.join('\n').slice(0, 5200);
};

const WORKSPACE_CHECK_INTERVAL_MS = 400;
const WORKSPACE_SAVE_DEBOUNCE_MS = 900;
const WORKSPACE_RETRY_DELAY_MS = 4000;

// Pyodide 运行时的同源路径。
//
// 不走公共 CDN：建构阶段的模块测试完全依赖它在浏览器里跑 Python，而
// cdn.jsdelivr.net 在国内课堂环境经常极慢甚至不可达，40–50 人同时首次加载
// 会进一步放大。运行时由 scripts/fetch-pyodide.sh 在构建期放进 public/pyodide/，
// 随前端镜像分发。改动此常量时必须同步改 workers/pythonModuleWorker.ts。
const PYODIDE_BASE_URL = '/pyodide/';

const projectStageKey = (taskId: string) => `cognisync:project-stage:v1:${taskId}`;

const restoreProjectStage = (taskId: string, workspace: SnakeProjectWorkspace | null): ProjectStage => {
  try {
    const stored = window.localStorage.getItem(projectStageKey(taskId));
    if (stored === 'observe' || stored === 'decompose' || stored === 'build') return stored;
    if (stored === 'model' || stored === 'plan') return 'build';
  } catch {
    // localStorage 不可用时仍可进入默认观察阶段。
  }
  // 存量工作区没有阶段键；已有函数测试进度说明学生此前已进入建构。
  return workspace && Object.keys(workspace.progress ?? {}).length > 0 ? 'build' : 'observe';
};

// Extend Window so TS knows about the self-hosted Pyodide loader
declare global {
  interface Window {
    loadPyodide: (options?: Record<string, unknown>) => Promise<any>;
  }
}

// ── Component ──────────────────────────────────────────────────────────────

export const Research: React.FC<Props> = ({
  onUpdateProfile,
  onExit,
  language,
  theme,
  userId,
  studentId,
  experimentGroup,
}) => {
  // Task / code state
  const [task, setTask] = useState<ResearchTask | null>(null);
  const [loadingTask, setLoadingTask] = useState(true);
  const [code, setCode] = useState('');
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const [workspaceSaveStatus, setWorkspaceSaveStatus] = useState<WorkspaceSaveStatus>('saved');
  const [factoryStage, setFactoryStage] = useState<ProjectStage>('observe');
  const [demoOpen, setDemoOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [runtimeEvidence, setRuntimeEvidence] = useState<SnakeRuntimeEvidence[]>([]);
  const [observationCardCount, setObservationCardCount] = useState(0);
  const [scaffoldCompletion, setScaffoldCompletion] = useState<ScaffoldCompletion | null>(null);
  const [buildAssistantContext, setBuildAssistantContext] = useState<ProjectBuildAssistantContext>({ artifactSummary: '' });
  /** 关键事件未能记录时给学生的提示。绝不静默失败。 */
  const [eventNotice, setEventNotice] = useState<string | null>(null);

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  // Task completion
  const [completing, setCompleting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [reopening, setReopening] = useState(false);

  // Terminal / Pyodide
  const [terminalLines, setTerminalLines] = useState<TerminalLine[]>([]);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [pyodideReady, setPyodideReady] = useState(false);
  const pyodideRef = useRef<any>(null);
  const terminalScrollRef = useRef<HTMLDivElement>(null);

  // Refs
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workspaceSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workspaceRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workspaceSaveRunningRef = useRef<Promise<void> | null>(null);
  const workspacePendingRef = useRef<SnakeProjectWorkspace | null>(null);
  const workspaceLastSavedSignatureRef = useRef('');
  const flushWorkspaceRef = useRef<(keepalive?: boolean) => Promise<void>>(async () => {});
  const chatScrollRef = useRef<HTMLDivElement>(null);
  /**
   * 响应丢失后学生手动重试时，必须复用第一次的幂等键。
   * 只有提交内容变化才生成新 ID。
   */
  const finalSubmitAttemptRef = useRef<{ signature: string; requestId: string } | null>(null);

  // Elapsed timer
  const startTimeRef = useRef<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const isZh = language === 'zh';
  const isPython = task?.language?.toLowerCase() === 'python';
  const allowAI = experimentGroup === 'pdt' || experimentGroup === 'ai_pbl';
  const factorySaveLabel = experimentGroup === 'pdt'
    ? (workspaceSaveStatus === 'saving'
      ? (isZh ? '保存中' : 'Saving')
      : workspaceSaveStatus === 'unsaved'
        ? (isZh ? '待保存' : 'Unsaved')
        : workspaceSaveStatus === 'error'
          ? (isZh ? '同步失败 · 已存本机' : 'Sync failed · saved locally')
          : (isZh ? '已同步' : 'Synced'))
    : factoryStage === 'build'
      ? (saveStatus === 'saving'
        ? (isZh ? '保存中' : 'Saving')
        : saveStatus === 'unsaved'
          ? (isZh ? '待保存' : 'Unsaved')
          : (isZh ? '已保存' : 'Saved'))
      : (isZh ? '过程已暂存' : 'Progress saved');

  const flushWorkspaceQueue = useCallback(async (keepalive = false): Promise<void> => {
    if (!task || experimentGroup !== 'pdt') return;

    // 已经有一轮在跑时**等它结束**，而不是直接返回。
    //
    // 直接返回会造成一个隐蔽的证据丢失：`reportKeyMoment` 先 `queueWorkspaceSave(0)`
    // 再 flush，若此刻恰好有一轮保存在途，flush 立即空转返回，待保存标记仍在，
    // 于是被判定为「工作区没保存成功」而丢弃这次关键事件。工作区其实会被在途的
    // 那一轮正常保存，丢掉的只有研究证据，而且提示语还是错的（说成网络异常）。
    const inFlight = workspaceSaveRunningRef.current;
    if (inFlight) {
      await inFlight;
      // 在途的那一轮可能已经把我们刚入队的快照一并保存了。
      if (!workspacePendingRef.current) return;
      // 也可能另一个调用者已经抢先开了新一轮，交给它即可。
      if (workspaceSaveRunningRef.current) {
        await workspaceSaveRunningRef.current;
        return;
      }
    }

    // 闸门必须在任何 await 之前同步装好，否则「无待保存内容」时整个函数体会
    // 同步跑完，之后再赋值就会留下一个永不清空的陈旧 Promise。
    let release: () => void = () => {};
    workspaceSaveRunningRef.current = new Promise<void>(resolve => { release = resolve; });
    try {
      while (workspacePendingRef.current) {
        const snapshot = workspacePendingRef.current;
        const signature = workspaceSignature(snapshot);
        workspacePendingRef.current = null;
        if (signature === workspaceLastSavedSignatureRef.current) continue;
        setWorkspaceSaveStatus('saving');
        try {
          await saveResearchWorkspace(task.id, snapshot, { keepalive });
          workspaceLastSavedSignatureRef.current = signature;
        } catch {
          workspacePendingRef.current ??= snapshot;
          setWorkspaceSaveStatus('error');
          if (workspaceRetryTimerRef.current) clearTimeout(workspaceRetryTimerRef.current);
          workspaceRetryTimerRef.current = setTimeout(() => {
            workspaceRetryTimerRef.current = null;
            void flushWorkspaceRef.current();
          }, WORKSPACE_RETRY_DELAY_MS);
          return;
        }
      }
      setWorkspaceSaveStatus('saved');
    } finally {
      workspaceSaveRunningRef.current = null;
      release();
    }
  }, [experimentGroup, task]);

  useEffect(() => {
    flushWorkspaceRef.current = flushWorkspaceQueue;
  }, [flushWorkspaceQueue]);

  const queueWorkspaceSave = useCallback((delay = WORKSPACE_SAVE_DEBOUNCE_MS) => {
    if (!task || experimentGroup !== 'pdt') return;
    const snapshot = collectSnakeProjectWorkspace(task.id);
    const signature = workspaceSignature(snapshot);
    const pendingSignature = workspacePendingRef.current
      ? workspaceSignature(workspacePendingRef.current)
      : '';
    if (signature === workspaceLastSavedSignatureRef.current || signature === pendingSignature) return;
    workspacePendingRef.current = snapshot;
    setWorkspaceSaveStatus('unsaved');
    if (workspaceSaveTimerRef.current) clearTimeout(workspaceSaveTimerRef.current);
    if (workspaceRetryTimerRef.current) {
      clearTimeout(workspaceRetryTimerRef.current);
      workspaceRetryTimerRef.current = null;
    }
    workspaceSaveTimerRef.current = setTimeout(() => {
      workspaceSaveTimerRef.current = null;
      void flushWorkspaceRef.current();
    }, delay);
  }, [experimentGroup, task]);

  // ── 关键教学事件上报 ────────────────────────────────────────────────────
  //
  // 顺序是刻意的：**先把工作区快照存成功，再写事件**。
  // 事件里的产物版本是不可覆盖的研究证据；若事件先写入而快照保存失败，
  // 学生刷新后看到的界面状态会与证据链对不上。反过来则只是少一条事件，
  // 下次确认还能补，代价小得多。
  //
  // 幂等键在这里生成一次，`reportStageEvent` 内部的重试全程复用它和同一个
  // 请求体——后端会比对语义指纹，同键不同内容会被判 409 而不是重放。

  const reportKeyMoment = useCallback(async (
    params: {
      stage: BackendStage;
      eventType: StageEventType;
      detail?: Record<string, unknown>;
      artifacts?: StageArtifactPayload[];
      /** 页面即将卸载时用 keepalive，保证请求仍能发出。 */
      keepalive?: boolean;
    },
  ): Promise<boolean> => {
    if (!task || experimentGroup !== 'pdt') return true;

    // 先确保快照落库。失败时不写事件，并如实告知学生。
    //
    // 必须先主动入队一次：工作区改动是靠 400ms 轮询发现的，学生在最后一次编辑
    // 之后立刻点确认时，待保存队列可能还是空的，只 flush 会漏掉这次改动。
    queueWorkspaceSave(0);
    if (workspacePendingRef.current) {
      if (workspaceSaveTimerRef.current) {
        clearTimeout(workspaceSaveTimerRef.current);
        workspaceSaveTimerRef.current = null;
      }
      await flushWorkspaceRef.current(params.keepalive ?? false);
      if (workspacePendingRef.current) {
        setEventNotice(isZh
          ? '工作区还没保存成功，这一步暂时没有记录。请检查网络后重试。'
          : 'Your workspace has not been saved yet, so this step was not recorded. Check your connection and retry.');
        return false;
      }
    }

    const outcome = await reportStageEvent(
      task.id,
      {
        request_id: createRequestId(),
        stage: params.stage,
        event_type: params.eventType,
        detail: params.detail,
        artifacts: params.artifacts,
      },
      { keepalive: params.keepalive },
    );

    if (isStageEventPersisted(outcome)) {
      setEventNotice(null);
      return true;
    }

    // 绝不静默失败：界面提示「已确认」而证据没写入，会让研究数据凭空缺口。
    switch (outcome.status) {
      case 'task-not-active':
        setEventNotice(isZh
          ? '这个任务已归档，无法再记录新的学习过程。请联系老师。'
          : 'This task is archived and no longer records new progress. Please contact your teacher.');
        break;
      case 'idempotency-conflict':
        // 同一个 requestId 配上不同内容。UUID 下几乎不可能，出现即为客户端缺陷。
        setEventNotice(isZh
          ? '这一步的记录出现冲突，请刷新页面后重新确认。'
          : 'This step conflicted with an earlier record. Please refresh and confirm again.');
        break;
      case 'invalid-combination':
        setEventNotice(isZh
          ? '这一步的阶段与产物不匹配，已跳过记录。请把该提示反馈给老师。'
          : 'This step did not match the expected stage; it was skipped. Please report this to your teacher.');
        break;
      case 'rejected-payload':
        // 请求体本身被校验拒绝（字段超长、产物条数超限）。学生自己改不了，
        // 但也不能让他以为是网络问题而反复重试。
        setEventNotice(isZh
          ? '这一步的内容不符合记录格式，没有保存成功。你的作品已存好，请把该提示反馈给老师。'
          : 'This step could not be recorded because of its format. Your work is saved — please report this to your teacher.');
        break;
      case 'too-large':
        setEventNotice(isZh
          ? '本次内容过大，未能记录。请精简后再确认。'
          : 'This step was too large to record. Please simplify and confirm again.');
        break;
      case 'not-found':
        setEventNotice(isZh
          ? '找不到当前任务，请刷新页面。'
          : 'The current task could not be found. Please refresh.');
        break;
      default:
        setEventNotice(isZh
          ? '这一步没有记录成功，你的内容已保存，可稍后重新确认。'
          : 'This step was not recorded. Your work is saved; you can confirm again later.');
    }
    return false;
  }, [experimentGroup, isZh, queueWorkspaceSave, task]);

  // ── Load task ──────────────────────────────────────────────────────────

  useEffect(() => {
    const loadTask = async () => {
      try {
        const t = await getActiveResearchTask();
        setTask(t);
        if (t) {
          let workspace = isSnakeProjectWorkspace(t.workspace_data) ? t.workspace_data : null;
          // kero 是开发验收账号：首次进入时自动生成一套完整蓝图，并写入账号记录。
          if (!workspace && studentId === 'kero' && experimentGroup === 'pdt') {
            const demo = seedSnakeProjectDemo(t.id);
            workspace = demo.workspace;
            await saveResearchWorkspace(t.id, workspace);
          } else if (workspace && studentId === 'kero' && experimentGroup === 'pdt' && (
            !workspace.path.functionMechanisms
            || workspace.functions.some(card => !card.boundaryReason || !card.mappingDecision || !card.implementation)
          )) {
            workspace = {
              ...workspace,
              functions: upgradeSnakeProjectFunctionCards(workspace.functions),
              path: {
                ...workspace.path,
                functionMechanisms: workspace.path.functionMechanisms ?? createSnakeProjectMechanisms(),
              },
              savedAt: new Date().toISOString(),
            };
            await saveResearchWorkspace(t.id, workspace);
            hydrateSnakeProjectWorkspace(t.id, workspace);
          } else if (workspace) {
            hydrateSnakeProjectWorkspace(t.id, workspace);
          }

          workspaceLastSavedSignatureRef.current = workspace ? workspaceSignature(workspace) : '';
          workspacePendingRef.current = null;
          setWorkspaceSaveStatus('saved');
          setFactoryStage(restoreProjectStage(t.id, workspace));

          // 优先使用学生已保存的代码，否则用模板原始代码
          setCode(t.code_submitted || t.code_content);
          // 若已提交过，直接标记为完成（停止计时器）
          if (t.is_completed) {
            setCompleted(true);
          }
          try {
            const evidence = workspace?.evidence ?? [];
            setRuntimeEvidence(evidence);
            setObservationCardCount(workspace?.observations.length ?? 0);
          } catch {
            setRuntimeEvidence([]);
          }
        }
      } catch {
        setTask(null);
      } finally {
        setLoadingTask(false);
      }
    };
    void loadTask();
  }, [experimentGroup, studentId]);

  useEffect(() => {
    if (!task || experimentGroup !== 'pdt') return;
    const interval = window.setInterval(() => queueWorkspaceSave(), WORKSPACE_CHECK_INTERVAL_MS);
    const flushBeforeLeaving = () => {
      queueWorkspaceSave(0);
      void flushWorkspaceRef.current(true);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushBeforeLeaving();
    };
    window.addEventListener('pagehide', flushBeforeLeaving);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('pagehide', flushBeforeLeaving);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [experimentGroup, queueWorkspaceSave, task]);

  useEffect(() => () => {
    if (workspaceSaveTimerRef.current) clearTimeout(workspaceSaveTimerRef.current);
    if (workspaceRetryTimerRef.current) clearTimeout(workspaceRetryTimerRef.current);
  }, []);

  const handleSnakeEvidence = useCallback((event: SnakeRuntimeEvidence) => {
    setRuntimeEvidence(current => {
      const previous = current[current.length - 1];
      if (
        previous
        && previous.type === event.type
        && JSON.stringify(previous.details ?? {}) === JSON.stringify(event.details ?? {})
        && Date.parse(event.timestamp) - Date.parse(previous.timestamp) < 300
      ) {
        return current;
      }
      const next = [...current, event].slice(-30);
      if (task?.id) {
        try {
          window.localStorage.setItem(`cognisync:snake-runtime-evidence:v1:${task.id}`, JSON.stringify(next));
        } catch {
          // Runtime evidence persistence must not interrupt project operation.
        }
      }
      return next;
    });
  }, [task?.id]);

  const handleFactoryStageChange = useCallback((stage: ProjectStage) => {
    queueWorkspaceSave(0);
    const nextStage = experimentGroup === 'pdt' && (stage === 'model' || stage === 'plan') ? 'build' : stage;
    setFactoryStage(nextStage);
    if (task?.id) {
      try {
        window.localStorage.setItem(projectStageKey(task.id), nextStage);
      } catch {
        // 阶段仍在内存中正常切换；只是不提供刷新恢复。
      }
    }
  }, [experimentGroup, queueWorkspaceSave, task?.id]);

  // 各阶段的确认动作。刻意**不**挂在 handleFactoryStageChange 上：
  // 那个函数同时服务于「确认进入下一阶段」和「点导航条往回走」，
  // 挂在它上面会把返回浏览也记成阶段确认，污染阶段确认次数这一研究指标。
  //
  // 证据写入失败时**不推进阶段**。界面显示「已进入下一阶段」而这一阶段的
  // stage_confirm 没有落库，是最坏的情况：学生不会再确认第二次，这条证据
  // 就永久缺失且无人察觉。停在原地并给出提示，学生再点一次即可重试
  // （requestId 每次重新生成，不会与失败的那次冲突）。

  const confirmObserveStage = useCallback(async () => {
    if (!task) return;
    const workspace = collectSnakeProjectWorkspace(task.id);
    const recorded = await reportKeyMoment({
      stage: 'observe',
      eventType: 'stage_confirm',
      detail: {
        observationCount: workspace.observations.length,
        evidenceCount: workspace.evidence.length,
      },
      artifacts: observationArtifacts(workspace.observations),
    });
    if (!recorded) return;
    handleFactoryStageChange('decompose');
  }, [handleFactoryStageChange, reportKeyMoment, task]);

  const confirmDecomposeStage = useCallback(async () => {
    if (!task) return;
    const workspace = collectSnakeProjectWorkspace(task.id);
    const recorded = await reportKeyMoment({
      stage: 'decompose',
      eventType: 'stage_confirm',
      detail: {
        functionCardCount: workspace.functions.length,
        decidedMappingCount: workspace.functions.filter(
          card => card.mappingDecision && card.mappingDecision.status !== 'pending',
        ).length,
      },
      // 功能卡与学生对教师契约的采纳决定一并记录：两者在同一次确认中产生，
      // 分开上报会让「学生是否参考了教师蓝图」失去时间对应关系。
      artifacts: [
        ...functionCardArtifacts(workspace.functions),
        ...functionMappingArtifacts(workspace.functions),
      ],
    });
    if (!recorded) return;
    handleFactoryStageChange(experimentGroup === 'pdt' ? 'build' : 'model');
  }, [experimentGroup, handleFactoryStageChange, reportKeyMoment, task]);

  const getScaffoldArtifactContext = useCallback((): ScaffoldArtifactContext => {
    if (!task) return { summary: '' };
    const workspace = collectSnakeProjectWorkspace(task.id);
    const taskWorkspaceSummary = summarizeStudentTaskWorkspace(workspace);
    if (factoryStage === 'build') return {
      summary: [taskWorkspaceSummary, '【当前建构焦点】', buildAssistantContext.artifactSummary].filter(Boolean).join('\n'),
      currentModule: buildAssistantContext.currentModuleId,
      currentCode: buildAssistantContext.currentCode,
      testFeedback: buildAssistantContext.testFeedback,
    };
    if (factoryStage === 'observe') return {
      summary: [
        taskWorkspaceSummary,
        '【当前观察焦点】',
        `本轮浏览器已记录运行证据 ${runtimeEvidence.length} 条。`,
      ].join('\n'),
    };
    if (factoryStage === 'decompose') return {
      summary: [
        taskWorkspaceSummary,
        '【当前功能拆解焦点】',
        `学生正在用功能名称、实现描述和观察引用整理 ${workspace.functions.length} 张功能卡。`,
      ].join('\n'),
    };
    if (factoryStage === 'model') {
      const mechanisms = workspace.path.functionMechanisms ?? {};
      return {
        summary: [
          taskWorkspaceSummary,
          '【当前功能流程焦点】',
          `正在为功能卡绘制内部实现流程；已保存 ${Object.keys(mechanisms).length} 张流程图。`,
        ].join('\n'),
      };
    }
    const relationCount = workspace.path.diagramEdges?.length ?? Object.values(workspace.path.prerequisites).reduce((sum, ids) => sum + ids.length, 0);
    return {
      summary: [
        taskWorkspaceSummary,
        '【当前实现路径焦点】',
        `已放置 ${workspace.path.placedCardIds?.length ?? 0} 张卡，建立 ${relationCount} 条有向关系。学生正在判断功能之间的数据与前置依赖。`,
      ].join('\n'),
    };
  }, [buildAssistantContext, factoryStage, runtimeEvidence.length, task]);

  // ── Auto-scroll chat ────────────────────────────────────────────────────

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  // ── Auto-scroll terminal ────────────────────────────────────────────────

  useEffect(() => {
    if (terminalScrollRef.current) {
      terminalScrollRef.current.scrollTop = terminalScrollRef.current.scrollHeight;
    }
  }, [terminalLines]);

  // ── Code change + auto-save ─────────────────────────────────────────────

  // Start timer when task first loads
  useEffect(() => {
    if (task && !startTimeRef.current) {
      startTimeRef.current = Date.now();
    }
  }, [task]);

  // Tick every second until completed
  useEffect(() => {
    if (!task || completed) return;
    const timer = setInterval(() => {
      if (startTimeRef.current) {
        setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [task, completed]);

  const handleCodeChange = useCallback((value: string) => {
    setCode(value);
    setSaveStatus('unsaved');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (!task) return;
    saveTimerRef.current = setTimeout(async () => {
      setSaveStatus('saving');
      try {
        await saveResearchProgress(task.id, value, startTimeRef.current ? new Date(startTimeRef.current).toISOString() : undefined);
        setSaveStatus('saved');
      } catch {
        setSaveStatus('unsaved');
      }
    }, 2000);
  }, [task]);

  // ── Chat submit ─────────────────────────────────────────────────────────

  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !task) return;
    const userText = input;
    setInput('');
    setChatError(null);

    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}`,
      role: 'user',
      text: userText,
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setIsTyping(true);

    try {
      const response = await sendChatMessage({
        userId: userId || 'guest',
        message: userText,
        language,
        isResearchMode: true,
        currentCode: code,
        taskPrompt: task.ai_prompt ?? undefined,
      });
      const assistantMsg: ChatMessage = {
        id: `msg_${Date.now() + 1}`,
        role: 'assistant',
        text: response.message,
        timestamp: new Date().toISOString(),
        analysis: response.analysis,
      };
      setMessages(prev => [...prev, assistantMsg]);
      if (response.updatedProfile) onUpdateProfile(response.updatedProfile);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : isZh ? '发送失败' : 'Failed to send');
    } finally {
      setIsTyping(false);
    }
  };

  // ── Complete task ───────────────────────────────────────────────────────

  const handleComplete = async () => {
    if (!task || completing || completed) return;
    setCompleting(true);
    setCompleteError(null);
    try {
      // PDT 组的代码分散在各模块（progress[unitId].code）里，旧的整文件编辑器
      // 缓冲区 `code` 在这条流程下始终为空。直接提交它会让最终提交记录不含
      // 任何学生代码，因此按实现路径顺序拼装模块代码。
      let submitted = code;
      let workspace: SnakeProjectWorkspace | null = null;
      if (experimentGroup === 'pdt') {
        workspace = collectSnakeProjectWorkspace(task.id);
        const byCard = new Map(workspace.functions.map(card => [card.id, card.responsibility]));
        const ordered = workspace.path.orderedCardIds.length > 0
          ? workspace.path.orderedCardIds
          : workspace.functions.map(card => card.id);
        const seen = new Set<string>();
        const blocks: string[] = [];
        ordered.forEach(cardId => {
          Object.entries(workspace.progress).forEach(([unitId, item]) => {
            if (item.cardId !== cardId || seen.has(unitId)) return;
            seen.add(unitId);
            blocks.push(`# ── ${byCard.get(cardId) ?? cardId} / ${item.blueprintNodeId}\n${item.code}`);
          });
        });
        // 未进入路径的模块也要提交，否则学生写过的代码会凭空消失。
        Object.entries(workspace.progress).forEach(([unitId, item]) => {
          if (seen.has(unitId)) return;
          blocks.push(`# ── ${byCard.get(item.cardId) ?? item.cardId} / ${item.blueprintNodeId}\n${item.code}`);
        });
        (workspace.creativeFunctions ?? []).forEach(card => {
          blocks.push(`# ── 创意功能：${card.title} / ${card.hook} / ${card.enabled ? 'enabled' : 'disabled'}\n${card.code}`);
        });
        submitted = blocks.join('\n\n');
      }

      // 项目解构组的最终产物来自多个模块。提交前先强制保存工作区，
      // 保证学生刷新后看到的界面与不可覆盖的最终产物版本一致。
      if (workspace) {
        queueWorkspaceSave(0);
        if (workspaceSaveTimerRef.current) {
          clearTimeout(workspaceSaveTimerRef.current);
          workspaceSaveTimerRef.current = null;
        }
        if (workspacePendingRef.current) {
          await flushWorkspaceRef.current();
        }
        if (workspacePendingRef.current) {
          setCompleteError(isZh
            ? '工作区还没有同步成功，暂时不能最终提交。内容已保留在本机，请检查网络后重试。'
            : 'The workspace has not synced yet, so it cannot be submitted. Your work remains on this device; check the network and retry.');
          return;
        }
      }

      const artifacts: StageArtifactPayload[] = workspace
        ? Object.entries(workspace.progress).map(([unitId, progress]) =>
          moduleCodeArtifact(unitId, progress, 'stage_confirm'))
        : [{
          artifact_type: 'module_code',
          artifact_key: 'final-code',
          content: { code: submitted, verified: false },
          change_source: 'stage_confirm',
        }];
      const detail: Record<string, unknown> = workspace
        ? {
          moduleCount: Object.keys(workspace.progress).length,
          verifiedCount: Object.values(workspace.progress).filter(item => item.verified).length,
          functionCardCount: workspace.functions.length,
          observationCount: workspace.observations.length,
          codeLength: submitted.length,
        }
        : { codeLength: submitted.length };
      const startedAt = startTimeRef.current
        ? new Date(startTimeRef.current).toISOString()
        : undefined;
      // 签名不含 request_id：响应丢失后再点提交，只要作品没改，
      // 就会复用原 ID，后端返回第一次的事件而不会重复调用。
      const signature = JSON.stringify({ taskId: task.id, submitted, startedAt, detail, artifacts });
      if (!finalSubmitAttemptRef.current || finalSubmitAttemptRef.current.signature !== signature) {
        finalSubmitAttemptRef.current = { signature, requestId: createRequestId() };
      }

      const outcome = await reportFinalSubmission(task.id, {
        request_id: finalSubmitAttemptRef.current.requestId,
        stage: 'build',
        code_submitted: submitted,
        started_at: startedAt,
        detail,
        artifacts,
      });
      if (isFinalSubmissionPersisted(outcome)) {
        finalSubmitAttemptRef.current = null;
        setEventNotice(null);
        setCompleted(true);
        return;
      }

      switch (outcome.status) {
        case 'task-not-active':
          setCompleteError(isZh ? '这个任务已归档，无法继续提交。请联系老师。' : 'This task is archived. Please contact your teacher.');
          break;
        case 'idempotency-conflict':
          setCompleteError(isZh ? '提交记录出现冲突。请刷新页面后再提交。' : 'The submission conflicted with an earlier attempt. Refresh and submit again.');
          break;
        case 'invalid-combination':
          setCompleteError(isZh ? '最终产物与当前阶段不匹配，请将此提示反馈给老师。' : 'The final artifacts do not match this stage. Please report this to your teacher.');
          break;
        case 'rejected-payload':
          setCompleteError(isZh ? '最终产物格式校验未通过，请将此提示反馈给老师。' : 'The final artifacts failed validation. Please report this to your teacher.');
          break;
        case 'too-large':
          setCompleteError(isZh ? '最终产物过大，暂时无法提交。' : 'The final submission is too large.');
          break;
        case 'not-found':
          setCompleteError(isZh ? '找不到当前任务，请刷新页面。' : 'The current task could not be found. Refresh the page.');
          break;
        default:
          setCompleteError(isZh
            ? '提交没有完成，你的作品已保留，可以稍后再试。'
            : 'The submission did not complete. Your work is saved; try again shortly.');
      }
    } catch (err) {
      setCompleteError(err instanceof Error ? err.message : isZh ? '提交失败' : 'Failed to submit');
    } finally {
      setCompleting(false);
    }
  };

  // ── Reopen task ─────────────────────────────────────────────────────────

  const handleReopen = async () => {
    if (!task || reopening) return;
    setReopening(true);
    setCompleteError(null);
    try {
      await reopenResearchTask(task.id);
      setCompleted(false);
      // 重置计时器，从本次重新开始算
      startTimeRef.current = Date.now();
      setElapsedSeconds(0);
    } catch (err) {
      setCompleteError(err instanceof Error ? err.message : isZh ? '退回失败' : 'Failed to reopen');
    } finally {
      setReopening(false);
    }
  };

  // ── Pyodide: load from CDN ──────────────────────────────────────────────

  const ensurePyodide = useCallback(async (): Promise<any> => {
    if (pyodideRef.current) return pyodideRef.current;

    setTerminalLines(prev => [
      ...prev,
      {
        type: 'info',
        text: isZh
          ? '⏳ 正在加载 Python 环境（首次约需 10-20 秒）...'
          : '⏳ Loading Python environment (first time ~10-20s)...',
      },
    ]);

    // Inject the Pyodide script once (same-origin, self-hosted)
    if (!window.loadPyodide) {
      await new Promise<void>((resolve, reject) => {
        const existing = document.getElementById('pyodide-cdn');
        if (existing) { resolve(); return; }
        const s = document.createElement('script');
        s.id = 'pyodide-cdn';
        s.src = `${PYODIDE_BASE_URL}pyodide.js`;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('Failed to load the local Python runtime'));
        document.head.appendChild(s);
      });
    }

    const pyodide = await window.loadPyodide({
      indexURL: PYODIDE_BASE_URL,
      // Route Python stdout/stderr directly into terminal lines
      stdout: (text: string) =>
        setTerminalLines(prev => [...prev, { type: 'stdout', text: text.replace(/\n$/, '') }]),
      stderr: (text: string) =>
        setTerminalLines(prev => [...prev, { type: 'stderr', text: text.replace(/\n$/, '') }]),
    });

    pyodideRef.current = pyodide;
    setPyodideReady(true);
    setTerminalLines(prev => [
      ...prev,
      { type: 'info', text: isZh ? '✓ Python 环境就绪' : '✓ Python ready' },
    ]);
    return pyodide;
  }, [isZh]);

  // ── Run code ────────────────────────────────────────────────────────────

  const handleRun = async () => {
    if (running) return;
    setRunning(true);
    setTerminalOpen(true);

    // Run separator with timestamp
    const ts = new Date().toLocaleTimeString('en-GB');
    setTerminalLines(prev => [
      ...prev,
      { type: 'info', text: `─── ${ts} ${'─'.repeat(28)}` },
    ]);

    const startMs = Date.now();

    try {
      const pyodide = await ensurePyodide();

      try {
        await pyodide.runPythonAsync(code);
      } catch (err: any) {
        // Pyodide already sent the full traceback via the stderr callback.
        // Extract just the last line for a compact error entry.
        const raw: string = err?.message ?? String(err);
        const lastLine = raw.trim().split('\n').pop() ?? raw;
        setTerminalLines(prev => [...prev, { type: 'error', text: lastLine }]);
        return;
      }

      const elapsed = ((Date.now() - startMs) / 1000).toFixed(2);
      setTerminalLines(prev => [
        ...prev,
        {
          type: 'info',
          text: isZh ? `✓ 执行完毕（${elapsed}s）` : `✓ Done (${elapsed}s)`,
        },
      ]);
    } catch (err: any) {
      setTerminalLines(prev => [
        ...prev,
        {
          type: 'error',
          text: isZh
            ? `环境加载失败: ${err?.message}`
            : `Load failed: ${err?.message}`,
        },
      ]);
    } finally {
      setRunning(false);
    }
  };

  // ── Guard states ────────────────────────────────────────────────────────

  if (loadingTask) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader className="w-8 h-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (!task) {
    return (
      <div
        className="flex flex-col items-center justify-center py-24"
        style={{ color: theme === 'light' ? '#6b7280' : '#94a3b8' }}
      >
        <FlaskConical className="w-16 h-16 mb-4 opacity-20" />
        <p className="text-lg font-medium">
          {isZh ? '暂无活跃的研究任务' : 'No active research task'}
        </p>
        <p className="text-sm mt-2">
          {isZh
            ? '教师发布任务后，将会在此处显示。'
            : 'Tasks will appear here once published by your instructor.'}
        </p>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="project-factory">
      <ProjectFactoryHeader
        language={language}
        taskTitle={task.title}
        experimentGroup={experimentGroup}
        activeStage={factoryStage}
        onExit={onExit}
        onStageChange={handleFactoryStageChange}
        onOpenProject={() => setDemoOpen(true)}
        onOpenAssistant={() => setAssistantOpen(true)}
        saveLabel={factorySaveLabel}
      />

      {/*
        关键事件未能记录时必须让学生看见。若界面提示「已确认」而证据没写入，
        研究数据会出现无法解释的缺口，而且事后无从判断是学生没做还是没记上。
      */}
      {eventNotice && (
        <div className="project-event-notice" role="status">
          <span>{eventNotice}</span>
          <button type="button" onClick={() => setEventNotice(null)}>
            {isZh ? '知道了' : 'Dismiss'}
          </button>
        </div>
      )}

      <SnakeProjectDemo
        language={language}
        open={demoOpen}
        onOpenChange={setDemoOpen}
        variant="viewer"
        showLauncher={false}
        onEvidence={handleSnakeEvidence}
      />

      {experimentGroup !== 'lecture' && (
        <ProjectScaffoldAssistant
          key={task.id}
          language={language}
          taskId={task.id}
          taskTitle={task.title}
          taskPrompt={task.ai_prompt ?? undefined}
          userId={userId}
          stage={factoryStage}
          open={assistantOpen}
          onOpenChange={setAssistantOpen}
          evidence={runtimeEvidence}
          observationCount={observationCardCount}
          contextKey={factoryStage === 'build' ? buildAssistantContext.currentModuleId : factoryStage}
          getArtifactContext={getScaffoldArtifactContext}
          onProfileUpdate={onUpdateProfile}
          onApplyCompletion={setScaffoldCompletion}
        />
      )}

      {factoryStage === 'observe' && (
        <ProjectObservationStage
          language={language}
          taskId={task.id}
          evidence={runtimeEvidence}
          scaffoldCompletion={scaffoldCompletion}
          onOpenProject={() => setDemoOpen(true)}
          onContinue={() => { void confirmObserveStage(); }}
          onCardCountChange={setObservationCardCount}
        />
      )}

      {factoryStage === 'decompose' && (
        <ProjectFunctionStage
          language={language}
          taskId={task.id}
          onBack={() => handleFactoryStageChange('observe')}
          onContinue={() => { void confirmDecomposeStage(); }}
        />
      )}

      {factoryStage === 'model' && experimentGroup !== 'pdt' && (
        <ProjectStagePreview
          language={language}
          stage="model"
          onBack={() => handleFactoryStageChange('decompose')}
          onContinue={() => handleFactoryStageChange('plan')}
        />
      )}

      {factoryStage === 'plan' && experimentGroup !== 'pdt' && (
        <ProjectStagePreview
          language={language}
          stage="plan"
          onBack={() => handleFactoryStageChange('model')}
          onContinue={() => handleFactoryStageChange('build')}
        />
      )}

      {factoryStage === 'build' && experimentGroup === 'pdt' && (
        <ProjectBuildStage
          language={language}
          theme={theme}
          taskId={task.id}
          onBack={() => handleFactoryStageChange('decompose')}
          onAssistantContextChange={setBuildAssistantContext}
          onReportKeyMoment={reportKeyMoment}
          onReviseEarlierStage={handleFactoryStageChange}
          onFinalSubmit={handleComplete}
          completing={completing}
          completed={completed}
        />
      )}

      {factoryStage === 'build' && experimentGroup !== 'pdt' && (
      <div className="project-build-stage">
      <div className={`research-workbench ${allowAI ? '' : 'research-workbench-solo'}`}>

      {/* ── Left: Code Editor + Terminal ─────────────────────────────── */}
      <div className="research-panel research-code-panel">
        {/* Task header */}
        <div className="research-panel-header research-code-header">
          <div className="research-title-row">
            <FlaskConical size={16} className="research-title-icon" />
            <span className="research-task-title">
              {task.title}
            </span>
            <span className="research-language-badge">
              {task.language}
            </span>
          </div>
          {task.instructions && (
            <span className="research-instructions">
              {task.instructions}
            </span>
          )}
        </div>

        {/* CodeMirror editor — flex-1 shrinks when terminal opens */}
        <div className="research-editor-wrap">
          <React.Suspense fallback={<div className="view-loading">{isZh ? '正在准备编辑器…' : 'Preparing editor…'}</div>}>
            <ResearchCodeEditor
              value={code}
              onChange={handleCodeChange}
              language={task.language}
              theme={theme}
            />
          </React.Suspense>
        </div>

        {/* ── Terminal panel ─────────────────────────────────────────── */}
        {terminalOpen && (
          <div className="research-terminal">
            {/* Terminal title bar */}
            <div className="research-terminal-bar">
              <div className="flex items-center gap-1.5">
                <Terminal size={12} className="text-violet-300" />
                <span className="research-terminal-title">
                  {isZh ? '输出' : 'Output'}
                  {pyodideReady && (
                    <span className="research-python-status">● Python 3.x</span>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setTerminalLines([])}
                  className="research-icon-button"
                  title={isZh ? '清空' : 'Clear'}
                >
                  <Trash2 size={12} />
                </button>
                <button
                  onClick={() => setTerminalOpen(false)}
                  className="research-icon-button"
                  title={isZh ? '关闭' : 'Close'}
                >
                  <X size={12} />
                </button>
              </div>
            </div>

            {/* Terminal output lines */}
            <div
              ref={terminalScrollRef}
              className="research-terminal-output"
            >
              {terminalLines.length === 0 ? (
                <span className="research-terminal-empty">
                  {isZh ? '点击"运行"执行代码' : 'Click "Run" to execute code'}
                </span>
              ) : (
                terminalLines.map((line, i) => (
                  <div
                    key={i}
                    className="leading-5 whitespace-pre-wrap break-all"
                    style={{
                      color:
                        line.type === 'stdout' ? '#e6edf3'
                        : line.type === 'stderr' ? '#f85149'
                        : line.type === 'error'  ? '#ff7b72'
                        : '#8b949e',  // info
                    }}
                  >
                    {line.text}
                  </div>
                ))
              )}
              {running && (
                <div className="research-running-line">
                  <Loader size={10} className="animate-spin" />
                  <span>{isZh ? '运行中...' : 'Running...'}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer: save status + run + complete */}
        <div className="research-actionbar">
          {/* Save status */}
          <div className="research-save-status">
            <div className="flex items-center gap-1.5">
              <Save size={12} />
              <span>
                {saveStatus === 'saving'
                  ? (isZh ? '保存中...' : 'Saving...')
                  : saveStatus === 'saved'
                  ? (isZh ? '已保存' : 'Saved')
                  : (isZh ? '未保存' : 'Unsaved')}
              </span>
            </div>
            {startTimeRef.current !== null && (
              <span className="font-mono">
                ⏱ {Math.floor(elapsedSeconds / 60).toString().padStart(2, '0')}:{(elapsedSeconds % 60).toString().padStart(2, '0')}
              </span>
            )}
          </div>

          {/* Action buttons */}
          <div className="research-action-buttons">

            {/* Run button — only shown for Python tasks */}
            {isPython && (
              <button
                onClick={handleRun}
                disabled={running || completed}
                className="research-run-button"
                title={isZh ? '运行代码 (Pyodide)' : 'Run code (Pyodide)'}
              >
                {running
                  ? <Loader size={13} className="animate-spin" />
                  : <Play size={13} />}
                <span>{isZh ? '运行' : 'Run'}</span>
              </button>
            )}

            {/* Complete / Submit button */}
            <button
              onClick={handleComplete}
              disabled={completing || completed}
              className={`research-submit-button ${completed ? 'research-submit-button-done' : ''}`}
            >
              {completing
                ? <Loader size={14} className="animate-spin" />
                : <CheckCircle size={14} />}
              <span>
                {completed
                  ? (isZh ? '已提交' : 'Submitted')
                  : (isZh ? '完成任务' : 'Submit Task')}
              </span>
            </button>

            {/* Reopen button — only shown after submitted */}
            {completed && (
              <button
                onClick={handleReopen}
                disabled={reopening}
                className="research-reopen-button"
                title={isZh ? '撤回提交，重新编辑' : 'Reopen to edit again'}
              >
                {reopening
                  ? <Loader size={13} className="animate-spin" />
                  : <span>↩</span>}
                <span>{isZh ? '退回重做' : 'Reopen'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Complete error */}
        {completeError && (
          <div className="research-error-line">
            {completeError}
          </div>
        )}
      </div>

      {/* ── Right: Chat Panel ─────────────────────────────────────── */}
      {allowAI && <div className="research-panel research-assistant-panel">
        {/* Chat header */}
        <div className="research-panel-header research-assistant-header">
          <p className="research-assistant-title">
            {isZh ? 'AI 学习助手' : 'AI Learning Assistant'}
          </p>
          <p className="research-assistant-subtitle">
            {isZh ? '遇到问题？和我聊聊吧' : 'Stuck? Chat with me'}
          </p>
        </div>

        {/* Messages */}
        <div ref={chatScrollRef} className="research-chat-stream">
          {messages.length === 0 && (
            <div className="research-empty-chat">
              {isZh
                ? '开始提问，我会帮助你完成代码！'
                : "Start asking — I'll help you complete the code!"}
            </div>
          )}
          {messages.map(msg => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`research-chat-bubble ${
                  msg.role === 'user'
                    ? 'research-chat-bubble-user'
                    : 'research-chat-bubble-assistant'
                }`}
              >
                {msg.text}
              </div>
            </div>
          ))}
          {isTyping && (
            <div className="flex justify-start">
              <div className="research-typing-bubble">
                <div className="flex gap-1">
                  {[0, 150, 300].map(delay => (
                    <span
                      key={delay}
                      className="research-typing-dot animate-bounce"
                      style={{ animationDelay: `${delay}ms` }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Chat error */}
        {chatError && (
          <div className="research-error-line">{chatError}</div>
        )}

        {/* Input */}
        <form onSubmit={handleChatSubmit} className="research-composer">
          <div className="research-composer-row">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={isZh ? '问我任何问题...' : 'Ask me anything...'}
              disabled={completed}
              className="research-composer-input"
            />
            <button
              type="submit"
              disabled={!input.trim() || isTyping || completed}
              className="research-send-button"
              title={isZh ? '发送' : 'Send'}
            >
              <Send size={16} />
            </button>
          </div>
        </form>
      </div>}
      </div>
      </div>
      )}
    </div>
  );
};
