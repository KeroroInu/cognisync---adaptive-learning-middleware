import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Bot,
  Check,
  GripHorizontal,
  Lightbulb,
  LoaderCircle,
  MessageCircleMore,
  Send,
  X,
} from 'lucide-react';
import type { Language, UserProfile } from '../types';
import { sendChatMessage } from '../services/api';
import { createRequestId } from '../services/stageEvents';
import { captureCurrentSession } from '../data/workspaceScope';
import { hasProjectRun, type ProjectStage, type SnakeRuntimeEvidence } from '../data/snakeProjectBlueprint';
import './ProjectScaffoldAssistant.css';
import { AssistantMessage } from './AssistantMessage';
import { SupportTools, type SupportChoice, type SupportState } from './SupportTools';

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
  userId: string;
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

const getDefaultPosition = (): Position => {
  if (typeof window === 'undefined') return { x: 748, y: 92 };
  const width = Math.min(460, window.innerWidth - 24);
  return { x: Math.max(12, window.innerWidth - width - 24), y: 76 };
};

const getDefaultSize = (): PanelSize => {
  if (typeof window === 'undefined') return { width: 460, height: 620 };
  return {
    width: Math.min(460, window.innerWidth - 24),
    height: Math.min(620, window.innerHeight - 90),
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
}) => {
  const sessionIsCurrent = useRef(captureCurrentSession()).current;
  const isZh = language === 'zh';
  const [position, setPosition] = useState<Position>(getDefaultPosition);
  const [panelSize, setPanelSize] = useState<PanelSize>(getDefaultSize);
  const [messages, setMessages] = useState<ScaffoldMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [support, setSupport] = useState<SupportState | null>(null);
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
  const activeContextKey = `${stage}:${contextKey || 'workspace'}`;
  const level = support?.level ?? 0;
  const l3IsConfirmed = level === 3;
  const currentContext = useRef(activeContextKey);
  currentContext.current = activeContextKey;
  const stageLabel = STAGE_LABELS[stage];
  const visibleMessages = messages.filter(message => message.contextKey === activeContextKey);
  const hasOpenedProject = hasProjectRun(evidence);
  const observationStageReady = stage === 'observe' && hasOpenedProject && observationCount >= 2;

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
    setSupport(null);
  }, [activeContextKey, taskId, userId]);

  const submit = useCallback(async (
    text: string,
    trigger: 'hint_button' | 'student_message' | 'level_up' | 'l3_confirmed',
    requestedLevel = level,
    l3ConfirmedForRequest = requestedLevel === 3 && l3IsConfirmed,
    choice?: SupportChoice,
  ) => {
    const clean = text.trim();
    if (!clean || sending || !sessionIsCurrent()) return;
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
        ? `【观察阶段状态】已运行项目：${hasOpenedProject ? '是' : '未读取到运行记录'}；观察卡：${observationCount}；完成条件：${observationStageReady ? '已满足' : '未满足'}。`
        : '';
      const response = await sendChatMessage({
        supportRequestId: requestId,
        supportAction: choice?.action ?? 'message', supportPracticeId: choice?.practiceId, supportAnswer: choice?.answer,
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
      if (!sessionIsCurrent()) return;
      if (response.support && currentContext.current === requestContextKey) setSupport(response.support);
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
  }, [activeContextKey, getArtifactContext, hasOpenedProject, isCodingStage, isZh, l3IsConfirmed, language, level, observationCount, observationStageReady, onProfileUpdate, sending, stage, taskId, taskPrompt, taskTitle, userId, sessionIsCurrent]);

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
          <span><strong>{isZh ? '学习助手' : 'Learning assistant'}</strong></span>
        </div>
        <button type="button" onClick={() => onOpenChange(false)} aria-label={isZh ? '收起助手' : 'Close assistant'}><X size={20} /></button>
      </div>

      <div className="project-scaffold-body">
        <header className="project-scaffold-context">
          <div><span>{isZh ? stageLabel.zh : stageLabel.en}</span><b>{isZh ? '一起想办法' : 'Let’s work through it'}</b></div>
        </header>

        <div ref={streamRef} className="project-scaffold-stream" aria-live="polite">
          {visibleMessages.length === 0 ? (
            <div className="project-scaffold-empty">
              <MessageCircleMore size={34} />
              <h4>{observationStageReady
                ? (isZh ? '这个观察环节已经完成' : 'This observation stage is complete')
                : (isZh ? '一起看看当前进展' : 'Let’s check your progress')}</h4>
              <p>{observationStageReady
                ? (isZh
                    ? `你保存了 ${observationCount} 张观察卡，可以继续拆功能了。`
                    : `You saved ${observationCount} observations. You can move on to identifying functions.`)
                : (isZh
                    ? (stage === 'observe' ? '说说你发现了什么，我们一起看看。这里不用改代码。' : isCodingStage ? '我会看当前函数和运行结果。你想改哪里？' : '我会看你正在做的卡片。哪里还没想清楚？')
                    : stage === 'observe' ? 'Tell me what you noticed. You do not need to change code here.' : isCodingStage ? 'I can look at this function and its results. What would you like to change?' : 'Let’s look at your current card. What is unclear?')}</p>
              {stage === 'observe' && <small>{observationStageReady
                ? (isZh ? '下一步：进入功能拆解' : 'Next: continue to function decomposition')
                : (isZh ? `${hasOpenedProject ? '已记录运行' : '暂未读到运行记录'} · ${observationCount} 张观察卡` : `${hasOpenedProject ? 'Run recorded' : 'No run evidence available'} · ${observationCount} observation cards`)}</small>}
            </div>
          ) : visibleMessages.map(message => (
            <article key={message.id} className={`project-scaffold-chat is-${message.role}`}>
              <span>{message.role === 'assistant' ? <Bot size={16} /> : <MessageCircleMore size={16} />}</span>
              <div>
                <small>{message.role === 'assistant' ? (isZh ? '一起看看' : 'Let’s see') : (isZh ? '我的问题' : 'My question')}</small>
                <AssistantMessage text={message.text} language={language} />
              </div>
            </article>
          ))}
          {sending ? <div className="project-scaffold-thinking"><LoaderCircle size={16} className="is-spinning" />{isZh ? '正在看你的内容…' : 'Reviewing your work…'}</div> : null}
        </div>

        {error ? <p className="project-scaffold-error" role="alert">{error}</p> : null}

        <form className="project-scaffold-composer" onSubmit={event => { event.preventDefault(); void submit(draft, 'student_message'); }}>
          <textarea
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder={isZh ? '哪里卡住了？Enter 发送，Shift+Enter 换行' : 'What are you working on? Enter sends, Shift+Enter starts a line'}
            aria-label={isZh ? '向项目学习助手提问；Enter 发送，Shift+Enter 换行' : 'Ask the project assistant; Enter sends, Shift+Enter starts a new line'}
            title={isZh ? 'Enter 发送，Shift+Enter 换行' : 'Enter to send, Shift+Enter for a new line'}
            maxLength={800}
            rows={2}
          />
          <button type="submit" disabled={!draft.trim() || sending} aria-label={sending ? (isZh ? '正在回复' : 'Replying') : (isZh ? '发送问题' : 'Send question')}>{sending ? <LoaderCircle size={18} className="is-spinning" /> : <Send size={18} />}</button>
        </form>

        <SupportTools key={activeContextKey} taskId={taskId} stage={stage} focus={getArtifactContext().currentModule || 'workspace'}
          busy={sending} response={support} onAction={choice => void submit(choice.text, 'student_message', level, false, choice)}
          onRestore={history => setMessages(current => [...current.filter(m => m.contextKey !== activeContextKey), ...history.flatMap(item => [
            { id: `${item.id}-user`, role: 'user' as const, text: item.question, stage, contextKey: activeContextKey, level: 0 },
            ...(item.reply ? [{ id: `${item.id}-assistant`, role: 'assistant' as const, text: item.reply, stage, contextKey: activeContextKey, level: 0 }] : []),
          ])])} />
        <p className="project-scaffold-footnote">{isZh ? '对话会保存，老师可查看。' : 'Conversations are saved for your teacher.'}</p>
      </div>
    </aside>
  );
};
