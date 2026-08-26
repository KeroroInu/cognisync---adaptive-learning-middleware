import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Bot,
  Check,
  GripHorizontal,
  Lightbulb,
  LoaderCircle,
  MessageCircleMore,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import type { Language, UserProfile } from '../types';
import { sendChatMessage } from '../services/api';
import { createRequestId } from '../services/stageEvents';
import { formatSnakeEvidence, type ProjectStage, type SnakeRuntimeEvidence } from '../data/snakeProjectBlueprint';
import './ProjectScaffoldAssistant.css';

export interface ScaffoldCompletion {
  requestId: string;
  evidenceId?: string;
  text: string;
}

export interface ScaffoldArtifactContext {
  summary: string;
  currentModule?: string;
  currentCode?: string;
  testFeedback?: string;
}

interface Props {
  language: Language;
  taskId: string;
  taskTitle: string;
  taskPrompt?: string;
  userId?: string;
  stage: ProjectStage;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  evidence: SnakeRuntimeEvidence[];
  observationCount: number;
  /** 建构阶段为固定函数 ID；用于按函数保存连续对话与 L3 确认。 */
  contextKey?: string;
  getArtifactContext: () => ScaffoldArtifactContext;
  onProfileUpdate: (profile: UserProfile) => void;
  onApplyCompletion: (completion: ScaffoldCompletion) => void;
}

interface Position { x: number; y: number }
interface PanelSize { width: number; height: number }
type ResizeDirection = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
interface ScaffoldMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  stage: ProjectStage;
  contextKey: string;
  /** 助手气泡显示的是**实际生效**等级；学生气泡显示的是他请求的等级。 */
  level: number;
  /** 仅助手气泡：被教师蓝图降级时，记下学生原本请求的等级，用于说明差异。 */
  clampedFrom?: number;
}

const STAGE_LABELS: Record<ProjectStage, { zh: string; en: string }> = {
  observe: { zh: '运行与观察', en: 'Run and observe' },
  decompose: { zh: '功能拆解', en: 'Function decomposition' },
  model: { zh: '功能流程', en: 'Function flow' },
  plan: { zh: '实现规划', en: 'Implementation planning' },
  build: { zh: '编码验证', en: 'Build and verify' },
  transfer: { zh: '迁移测试', en: 'Transfer test' },
};

const LEVEL_LABELS = {
  zh: ['情境澄清', '概念提示', '策略提示', '最小补全'],
  en: ['Clarify', 'Concept cue', 'Strategy cue', 'Minimum completion'],
};

const BUILD_LEVEL_LABELS = {
  zh: ['测试定位', '关键代码', '函数结构', '完整函数'],
  en: ['Locate with tests', 'Key code', 'Function structure', 'Complete function'],
};

const confirmedL3Key = (taskId: string) => `cognisync:build-l3-confirmed:v1:${taskId}`;

const readConfirmedL3 = (taskId: string): Set<string> => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(confirmedL3Key(taskId)) ?? '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : []);
  } catch {
    return new Set();
  }
};

const getDefaultPosition = (): Position => {
  if (typeof window === 'undefined') return { x: 748, y: 92 };
  const width = Math.min(520, window.innerWidth - 24);
  return { x: Math.max(12, window.innerWidth - width - 24), y: 92 };
};

const getDefaultSize = (): PanelSize => {
  if (typeof window === 'undefined') return { width: 520, height: 680 };
  return {
    width: Math.min(520, window.innerWidth - 24),
    height: Math.min(680, window.innerHeight - 90),
  };
};

export const ProjectScaffoldAssistant: React.FC<Props> = ({
  language,
  taskId,
  taskTitle,
  taskPrompt,
  userId,
  stage,
  open,
  onOpenChange,
  evidence,
  observationCount,
  contextKey,
  getArtifactContext,
  onProfileUpdate,
  onApplyCompletion,
}) => {
  const isZh = language === 'zh';
  const [position, setPosition] = useState<Position>(getDefaultPosition);
  const [panelSize, setPanelSize] = useState<PanelSize>(getDefaultSize);
  const [levels, setLevels] = useState<Record<string, number>>({});
  const [messages, setMessages] = useState<ScaffoldMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [confirmedL3, setConfirmedL3] = useState<Set<string>>(() => readConfirmedL3(taskId));
  const [l3ConfirmationOpen, setL3ConfirmationOpen] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ pointerId: -1, offsetX: 0, offsetY: 0 });
  const resizeRef = useRef({
    pointerId: -1,
    direction: 'se' as ResizeDirection,
    startX: 0,
    startY: 0,
    position: { x: 0, y: 0 },
    size: { width: 0, height: 0 },
  });
  const isCodingStage = stage === 'build' || stage === 'transfer';
  const activeContextKey = isCodingStage ? (contextKey || `${stage}-unselected`) : stage;
  const l3IsConfirmed = isCodingStage && confirmedL3.has(activeContextKey);
  // L3 是当前函数卡的持续协作权限，不是只对确认按钮后的第一条回复有效。
  // 刷新或重新进入建构时，已确认的卡必须继续以 L3 讨论代码，不能悄悄退回 L0。
  const level = l3IsConfirmed ? 3 : (levels[activeContextKey] ?? 0);
  const stageLabel = STAGE_LABELS[stage];
  const levelLabels = isCodingStage ? BUILD_LEVEL_LABELS : LEVEL_LABELS;
  const visibleMessages = messages.filter(message => message.contextKey === activeContextKey);
  const hasOpenedProject = evidence.some(item => item.type === 'opened');
  const observationStageReady = stage === 'observe' && hasOpenedProject && observationCount >= 2;

  const latestEvidence = useMemo(() => {
    const meaningful = [...evidence].reverse().find(item => !['opened', 'started', 'paused'].includes(item.type));
    return meaningful ?? evidence[evidence.length - 1];
  }, [evidence]);

  const clampPosition = useCallback((x: number, y: number): Position => {
    const width = panelRef.current?.offsetWidth ?? Math.min(520, window.innerWidth - 24);
    const height = panelRef.current?.offsetHeight ?? Math.min(720, window.innerHeight - 100);
    return {
      x: Math.min(Math.max(12, x), Math.max(12, window.innerWidth - width - 12)),
      y: Math.min(Math.max(76, y), Math.max(76, window.innerHeight - height - 12)),
    };
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setPanelSize(current => ({
        width: Math.min(current.width, window.innerWidth - 24),
        height: Math.min(current.height, window.innerHeight - 90),
      }));
      setPosition(current => clampPosition(current.x, current.y));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [clampPosition]);

  useEffect(() => {
    if (open) setPosition(current => clampPosition(current.x, current.y));
  }, [clampPosition, open, panelSize]);

  useEffect(() => {
    streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  useEffect(() => {
    setL3ConfirmationOpen(false);
  }, [activeContextKey]);

  const submit = useCallback(async (
    text: string,
    trigger: 'hint_button' | 'student_message' | 'level_up' | 'l3_confirmed',
    requestedLevel = level,
    l3ConfirmedForRequest = requestedLevel === 3 && l3IsConfirmed,
  ) => {
    const clean = text.trim();
    if (!clean || sending) return;
    // 幂等键必须是 UUID 且在同一次求助的所有重试中保持不变。
    // 原先的 `scaffold-${Date.now()}` 有两个问题：毫秒精度在多标签页下会碰撞；
    // 更关键的是它在每次提交时重新生成，后端的 (user_id, request_id) 幂等约束
    // 实际从未生效——手动重试会被计成一次全新的求助。
    //
    // 注意：这里保证 ID 本身正确；聊天消息、模型调用、画像分析与支架事件的
    // 事务级幂等仍是证据链技术债。当前前端不自动重放请求，正常交互不会触发它。
    const requestId = createRequestId();
    const artifactContext = getArtifactContext();
    setError('');
    setDraft('');
    const requestContextKey = activeContextKey;
    setMessages(current => [...current, { id: `${requestId}-user`, role: 'user', text: clean, stage, contextKey: requestContextKey, level: requestedLevel }]);
    setSending(true);
    try {
      const observationStageStatus = stage === 'observe'
        ? `【观察阶段状态】已运行项目：${hasOpenedProject ? '是' : '否'}；观察卡：${observationCount}；完成条件：${observationStageReady ? '已满足' : '未满足'}。`
        : '';
      const response = await sendChatMessage({
        userId: userId || 'guest',
        message: clean,
        language,
        isResearchMode: true,
        currentCode: isCodingStage ? artifactContext.currentCode?.slice(0, 10000) : undefined,
        taskPrompt,
        scaffoldContext: {
          requestId,
          taskId,
          taskTitle,
          stage,
          level: requestedLevel as 0 | 1 | 2 | 3,
          trigger,
          l3Confirmed: l3ConfirmedForRequest,
          artifactSummary: [observationStageStatus, artifactContext.summary].filter(Boolean).join('\n').slice(0, 6000),
          currentModule: artifactContext.currentModule,
          testFeedback: artifactContext.testFeedback,
        },
      });
      // 除建构阶段已确认的 L3 外，后端仍可能按教师蓝图压低等级。
      // 气泡按实际生效等级标注；沿用请求等级会让学生高估自己拿到的支持。
      const appliedLevel = response.scaffold?.appliedLevel ?? requestedLevel;
      const wasClamped = response.scaffold?.wasClamped ?? false;
      setMessages(current => [...current, {
        id: `${requestId}-assistant`,
        role: 'assistant',
        text: response.message,
        stage,
        contextKey: requestContextKey,
        level: appliedLevel,
        clampedFrom: wasClamped ? requestedLevel : undefined,
      }]);
      if (response.updatedProfile) onProfileUpdate(response.updatedProfile);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : (isZh ? '暂时无法获得建议，请稍后重试。' : 'Unable to get advice. Please retry.'));
    } finally {
      setSending(false);
    }
  }, [activeContextKey, getArtifactContext, hasOpenedProject, isCodingStage, isZh, l3IsConfirmed, language, level, observationCount, observationStageReady, onProfileUpdate, sending, stage, taskId, taskPrompt, taskTitle, userId]);

  const requestHint = () => void submit(
    observationStageReady
      ? (isZh ? '请先核对我已有的观察卡和阶段完成条件，再告诉我下一步，不要重复要求已完成的观察。' : 'Check my saved observations and stage completion first, then tell me the next step without repeating completed observation work.')
      : (isZh ? '请结合我当前的阶段产物，只提示我接下来最小的一步。' : 'Use my current work and give me only the smallest next step.'),
    'hint_button',
    level,
  );

  const requestMoreSpecific = () => {
    const nextLevel = Math.min(3, level + 1);
    if (isCodingStage && nextLevel === 3 && !l3IsConfirmed) {
      setL3ConfirmationOpen(true);
      return;
    }
    setLevels(current => ({ ...current, [activeContextKey]: nextLevel }));
    void submit(
      isCodingStage && nextLevel === 3
        ? (isZh ? '我已确认需要当前函数的完整正确实现。请给出代码，我会自行复制并运行。' : 'I confirmed that I need the complete correct implementation for this function. I will copy and run it myself.')
        : (isZh ? '我尝试后仍然没有推进，请再具体一级。' : 'I am still stuck. Be one level more specific.'),
      'level_up',
      nextLevel,
    );
  };

  const confirmBuildL3 = () => {
    if (!isCodingStage) return;
    const next = new Set(confirmedL3).add(activeContextKey);
    setConfirmedL3(next);
    setL3ConfirmationOpen(false);
    setLevels(current => ({ ...current, [activeContextKey]: 3 }));
    try {
      window.localStorage.setItem(confirmedL3Key(taskId), JSON.stringify([...next]));
    } catch {
      // 本轮确认仍有效；只是刷新后需要再次确认。
    }
    void submit(
      isZh ? '我确认需要当前函数的完整正确实现。我会自行复制到编辑器并运行测试。' : 'I confirm that I need the complete correct implementation for this function. I will copy it into the editor and run the test.',
      'l3_confirmed',
      3,
      true,
    );
  };

  const applyMinimumCompletion = () => {
    if (stage !== 'observe' || observationStageReady || !latestEvidence) return;
    const evidenceText = formatSnakeEvidence(latestEvidence, language);
    onApplyCompletion({
      requestId: createRequestId(),
      evidenceId: latestEvidence.id,
      text: isZh ? `我观察到：${evidenceText}。` : `I observed that ${evidenceText}.`,
    });
    onOpenChange(false);
  };

  const handleDragStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, offsetX: event.clientX - position.x, offsetY: event.clientY - position.y };
  };
  const handleDragMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current.pointerId !== event.pointerId) return;
    setPosition(clampPosition(event.clientX - dragRef.current.offsetX, event.clientY - dragRef.current.offsetY));
  };
  const handleDragEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current.pointerId = -1;
  };

  const handleResizeStart = (direction: ResizeDirection) => (event: React.PointerEvent<HTMLDivElement>) => {
    if (window.innerWidth <= 760) return;
    event.preventDefault();
    event.stopPropagation();
    resizeRef.current = {
      pointerId: event.pointerId,
      direction,
      startX: event.clientX,
      startY: event.clientY,
      position: { ...position },
      size: { ...panelSize },
    };
  };

  const handleResizeMove = useCallback((event: PointerEvent) => {
    const active = resizeRef.current;
    if (active.pointerId !== event.pointerId) return;
    const dx = event.clientX - active.startX;
    const dy = event.clientY - active.startY;
    const minWidth = Math.min(400, window.innerWidth - 24);
    const minHeight = Math.min(520, window.innerHeight - 90);
    const maxWidth = window.innerWidth - 24;
    const maxHeight = window.innerHeight - 90;
    const nextPosition = { ...active.position };
    const nextSize = { ...active.size };

    if (active.direction.includes('e')) {
      nextSize.width = Math.min(
        Math.max(minWidth, active.size.width + dx),
        Math.min(maxWidth, window.innerWidth - active.position.x - 12),
      );
    }
    if (active.direction.includes('s')) {
      nextSize.height = Math.min(
        Math.max(minHeight, active.size.height + dy),
        Math.min(maxHeight, window.innerHeight - active.position.y - 12),
      );
    }
    if (active.direction.includes('w')) {
      const right = active.position.x + active.size.width;
      nextPosition.x = Math.min(
        Math.max(12, active.position.x + dx, right - maxWidth),
        right - minWidth,
      );
      nextSize.width = right - nextPosition.x;
    }
    if (active.direction.includes('n')) {
      const bottom = active.position.y + active.size.height;
      nextPosition.y = Math.min(
        Math.max(76, active.position.y + dy, bottom - maxHeight),
        bottom - minHeight,
      );
      nextSize.height = bottom - nextPosition.y;
    }

    setPosition(nextPosition);
    setPanelSize(nextSize);
  }, []);

  const handleResizeEnd = useCallback((event: PointerEvent) => {
    if (resizeRef.current.pointerId !== event.pointerId) return;
    resizeRef.current.pointerId = -1;
  }, []);

  useEffect(() => {
    window.addEventListener('pointermove', handleResizeMove);
    window.addEventListener('pointerup', handleResizeEnd);
    window.addEventListener('pointercancel', handleResizeEnd);
    return () => {
      window.removeEventListener('pointermove', handleResizeMove);
      window.removeEventListener('pointerup', handleResizeEnd);
      window.removeEventListener('pointercancel', handleResizeEnd);
    };
  }, [handleResizeEnd, handleResizeMove]);

  const handleComposerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!draft.trim() || sending) return;
    void submit(draft, 'student_message');
  };

  if (!open) return null;

  return (
    <aside
      ref={panelRef}
      className="project-scaffold-panel"
      style={{ left: position.x, top: position.y, width: panelSize.width, height: panelSize.height }}
      aria-label={isZh ? '项目学习提示助手' : 'Project scaffold assistant'}
    >
      {(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as ResizeDirection[]).map(direction => (
        <div
          key={direction}
          className={`project-scaffold-resize project-scaffold-resize--${direction}`}
          onPointerDown={handleResizeStart(direction)}
          aria-hidden="true"
        />
      ))}
      <div className="project-scaffold-titlebar" onPointerDown={handleDragStart} onPointerMove={handleDragMove} onPointerUp={handleDragEnd} onPointerCancel={handleDragEnd}>
        <div>
          <GripHorizontal size={17} />
          <span><small>COGNISYNC / SCAFFOLD</small><strong>{isZh ? '项目学习助手' : 'Project learning assistant'}</strong></span>
        </div>
        <button type="button" onClick={() => onOpenChange(false)} aria-label={isZh ? '收起助手' : 'Close assistant'}><X size={20} /></button>
      </div>

      <div className="project-scaffold-body">
        <header className="project-scaffold-context">
          <div><span>{isZh ? stageLabel.zh : stageLabel.en}</span><b>L{level} · {levelLabels[language][level]}</b></div>
          <small><Sparkles size={13} />{isZh ? '已读取本任务各环节产物与学习画像' : 'Uses every stage of this task and your learner profile'}</small>
        </header>

        <div ref={streamRef} className="project-scaffold-stream" aria-live="polite">
          {visibleMessages.length === 0 ? (
            <div className="project-scaffold-empty">
              <MessageCircleMore size={34} />
              <h4>{observationStageReady
                ? (isZh ? '这个观察环节已经完成' : 'This observation stage is complete')
                : (isZh ? '我知道你现在正在做什么' : 'I know what you are working on')}</h4>
              <p>{observationStageReady
                ? (isZh
                    ? `我已读到你保存的 ${observationCount} 张观察卡，也确认你运行过完整项目；不会再重复要求你观察。`
                    : `I read your ${observationCount} saved observation cards and confirmed that you ran the complete project. I will not ask you to repeat observations.`)
                : (isZh
                    ? `当前处于“${stageLabel.zh}”。我会参考本任务已保存的观察卡、功能卡和函数进度；建构阶段还会读取当前代码与测试反馈。`
                    : `You are at “${stageLabel.en}”. I can use this task's observations, function cards and function progress, plus current code and tests during build.`)}</p>
              <small>{observationStageReady
                ? (isZh ? '下一步：进入功能拆解' : 'Next: continue to function decomposition')
                : (isZh ? `当前证据：${observationCount} 张观察卡` : `${observationCount} observation cards`)}</small>
            </div>
          ) : visibleMessages.map(message => (
            <article key={message.id} className={`project-scaffold-chat is-${message.role}`}>
              <span>{message.role === 'assistant' ? <Bot size={16} /> : <MessageCircleMore size={16} />}</span>
              <div>
                <small>{message.role === 'assistant'
                  ? `L${message.level} · ${((message.stage === 'build' || message.stage === 'transfer') ? BUILD_LEVEL_LABELS : LEVEL_LABELS)[language][message.level]}${
                      message.clampedFrom !== undefined
                        ? (isZh
                            ? `（教师蓝图上限，已从 L${message.clampedFrom} 下调）`
                            : ` (capped by the teacher blueprint, requested L${message.clampedFrom})`)
                        : ''
                    }`
                  : (isZh ? '我的问题' : 'My question')}</small>
                <p>{message.text}</p>
              </div>
            </article>
          ))}
          {sending ? <div className="project-scaffold-thinking"><LoaderCircle size={16} className="is-spinning" />{isZh ? '正在查看当前阶段产物…' : 'Reviewing the current work…'}</div> : null}
        </div>

        {error ? <p className="project-scaffold-error">{error}</p> : null}

        {l3ConfirmationOpen ? (
          <section className="project-scaffold-l3-confirm" role="alertdialog" aria-labelledby="build-l3-confirm-title">
            <div>
              <strong id="build-l3-confirm-title">{isZh ? '确认查看当前函数的完整实现？' : 'Show the complete implementation?'}</strong>
              <p>{isZh
                ? '确认后，助手会给出这一张函数卡的完整正确代码。代码不会自动写入编辑器；你仍需自行复制或输入，并运行测试。'
                : 'After confirmation, the assistant gives the complete correct code for this function only. It will not edit the editor; you still copy or type and run it yourself.'}</p>
            </div>
            <div>
              <button type="button" onClick={() => setL3ConfirmationOpen(false)}>{isZh ? '先不用' : 'Not now'}</button>
              <button type="button" className="is-confirm" onClick={confirmBuildL3}>{isZh ? '确认，给我完整函数' : 'Confirm complete function'}</button>
            </div>
          </section>
        ) : null}

        <form className="project-scaffold-composer" onSubmit={event => { event.preventDefault(); void submit(draft, 'student_message'); }}>
          <textarea
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder={isZh ? '说说你正在想什么…（Enter 发送）' : 'Describe what you are thinking… (Enter to send)'}
            aria-label={isZh ? '向项目学习助手提问；Enter 发送，Shift+Enter 换行' : 'Ask the project assistant; Enter sends, Shift+Enter starts a new line'}
            title={isZh ? 'Enter 发送，Shift+Enter 换行' : 'Enter to send, Shift+Enter for a new line'}
            maxLength={800}
            rows={2}
          />
          <button type="submit" disabled={!draft.trim() || sending} aria-label={isZh ? '发送问题' : 'Send question'}><Send size={18} /></button>
        </form>

        <div className="project-scaffold-actions">
          <button type="button" className="is-primary" onClick={requestHint} disabled={sending}><Lightbulb size={16} />{observationStageReady
            ? (isZh ? '确认下一步' : 'Confirm next step')
            : (isZh ? `提示一下 · L${level}` : `Hint · L${level}`)}</button>
          {visibleMessages.some(message => message.role === 'assistant')
            && !observationStageReady
            && level < 3
            ? (
            <button type="button" onClick={requestMoreSpecific} disabled={sending}>{isZh ? '再具体一级' : 'One level more'}<ArrowRight size={16} /></button>
          ) : null}
          {level === 3 && stage === 'observe' && !observationStageReady && latestEvidence ? (
            <button type="button" onClick={applyMinimumCompletion}><Check size={16} />{isZh ? '采用最小补全' : 'Apply minimum completion'}</button>
          ) : null}
        </div>

        <p className="project-scaffold-footnote">{isZh ? '每轮问题、AI 建议、支架等级和画像快照都会进入教师端对话导出。' : 'Questions, advice, scaffold levels and profile snapshots are included in teacher exports.'}</p>
      </div>
    </aside>
  );
};
