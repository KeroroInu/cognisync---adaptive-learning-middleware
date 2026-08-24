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
  getArtifactContext: () => ScaffoldArtifactContext;
  onProfileUpdate: (profile: UserProfile) => void;
  onApplyCompletion: (completion: ScaffoldCompletion) => void;
}

interface Position { x: number; y: number }
interface ScaffoldMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  stage: ProjectStage;
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
};

const LEVEL_LABELS = {
  zh: ['情境澄清', '概念提示', '策略提示', '最小补全'],
  en: ['Clarify', 'Concept cue', 'Strategy cue', 'Minimum completion'],
};

const getDefaultPosition = (): Position => {
  if (typeof window === 'undefined') return { x: 680, y: 92 };
  const width = Math.min(680, window.innerWidth - 24);
  return { x: Math.max(12, window.innerWidth - width - 24), y: 92 };
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
  getArtifactContext,
  onProfileUpdate,
  onApplyCompletion,
}) => {
  const isZh = language === 'zh';
  const [position, setPosition] = useState<Position>(getDefaultPosition);
  const [levels, setLevels] = useState<Record<ProjectStage, number>>({ observe: 0, decompose: 0, model: 0, plan: 0, build: 0 });
  const [messages, setMessages] = useState<ScaffoldMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  // 教师蓝图在当前阶段实际封顶到的等级。null 表示本阶段未受限或尚未问过一次。
  // 后端只在建构阶段应用 coreImplementationMaxLevel，因此只有 build 才会有值。
  // 仅用于界面提示，不参与任何等级计算——真正的裁定永远在后端，
  // 前端复制一份阈值只会两处走样。
  const [effectiveCap, setEffectiveCap] = useState<number | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ pointerId: -1, offsetX: 0, offsetY: 0 });
  const level = levels[stage];
  const stageLabel = STAGE_LABELS[stage];

  const latestEvidence = useMemo(() => {
    const meaningful = [...evidence].reverse().find(item => !['opened', 'started', 'paused'].includes(item.type));
    return meaningful ?? evidence[evidence.length - 1];
  }, [evidence]);

  const clampPosition = useCallback((x: number, y: number): Position => {
    const width = panelRef.current?.offsetWidth ?? Math.min(680, window.innerWidth - 24);
    const height = panelRef.current?.offsetHeight ?? Math.min(720, window.innerHeight - 100);
    return {
      x: Math.min(Math.max(12, x), Math.max(12, window.innerWidth - width - 12)),
      y: Math.min(Math.max(76, y), Math.max(76, window.innerHeight - height - 12)),
    };
  }, []);

  useEffect(() => {
    const handleResize = () => setPosition(current => clampPosition(current.x, current.y));
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [clampPosition]);

  useEffect(() => {
    if (open) setPosition(current => clampPosition(current.x, current.y));
  }, [clampPosition, open]);

  useEffect(() => {
    streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  // 封顶是按阶段生效的（只有 build 会被 coreImplementationMaxLevel 限制），
  // 换阶段后必须清掉，否则会在不受限的阶段继续显示"已封顶"。
  useEffect(() => {
    setEffectiveCap(null);
  }, [stage]);

  const submit = useCallback(async (
    text: string,
    trigger: 'hint_button' | 'student_message' | 'level_up',
    requestedLevel = level,
  ) => {
    const clean = text.trim();
    if (!clean || sending) return;
    // 幂等键必须是 UUID 且在同一次求助的所有重试中保持不变。
    // 原先的 `scaffold-${Date.now()}` 有两个问题：毫秒精度在多标签页下会碰撞；
    // 更关键的是它在每次提交时重新生成，后端的 (user_id, request_id) 幂等约束
    // 实际从未生效——手动重试会被计成一次全新的求助。
    //
    // 注意：本轮只保证 ID 本身正确。「消息、LLM 调用与支架事件的完整幂等」
    // 仍属于任务 5；当前前端不会自动重放聊天请求，因此不会产生重复记录。
    const requestId = createRequestId();
    const artifactContext = getArtifactContext();
    setError('');
    setDraft('');
    setMessages(current => [...current, { id: `${requestId}-user`, role: 'user', text: clean, stage, level: requestedLevel }]);
    setSending(true);
    try {
      const response = await sendChatMessage({
        userId: userId || 'guest',
        message: clean,
        language,
        isResearchMode: true,
        currentCode: stage === 'build' ? artifactContext.currentCode?.slice(0, 10000) : undefined,
        taskPrompt,
        scaffoldContext: {
          requestId,
          taskId,
          taskTitle,
          stage,
          level: requestedLevel as 0 | 1 | 2 | 3,
          trigger,
          artifactSummary: artifactContext.summary.slice(0, 6000),
          currentModule: artifactContext.currentModule,
          testFeedback: artifactContext.testFeedback,
        },
      });
      // 后端可能因教师蓝图上限把等级压低。气泡按实际生效等级标注，
      // 并把"从 L3 降到 L2"这件事明说；沿用请求等级会让学生高估自己拿到的支持。
      const appliedLevel = response.scaffold?.appliedLevel ?? requestedLevel;
      const wasClamped = response.scaffold?.wasClamped ?? false;
      setMessages(current => [...current, {
        id: `${requestId}-assistant`,
        role: 'assistant',
        text: response.message,
        stage,
        level: appliedLevel,
        clampedFrom: wasClamped ? requestedLevel : undefined,
      }]);
      setEffectiveCap(stage === 'build' ? (response.scaffold?.coreImplementationMaxLevel ?? null) : null);
      if (response.updatedProfile) onProfileUpdate(response.updatedProfile);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : (isZh ? '暂时无法获得建议，请稍后重试。' : 'Unable to get advice. Please retry.'));
    } finally {
      setSending(false);
    }
  }, [getArtifactContext, isZh, language, level, onProfileUpdate, sending, stage, taskId, taskPrompt, taskTitle, userId]);

  const requestHint = () => void submit(
    isZh ? '请结合我当前的阶段产物，只提示我接下来最小的一步。' : 'Use my current work and give me only the smallest next step.',
    'hint_button',
    level,
  );

  const requestMoreSpecific = () => {
    const nextLevel = Math.min(3, level + 1);
    setLevels(current => ({ ...current, [stage]: nextLevel }));
    void submit(
      isZh ? '我尝试后仍然没有推进。请在不直接给完整答案的前提下，再具体一级。' : 'I am still stuck. Be one level more specific without giving the full answer.',
      'level_up',
      nextLevel,
    );
  };

  const applyMinimumCompletion = () => {
    if (stage !== 'observe' || !latestEvidence) return;
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

  if (!open) return null;

  return (
    <aside ref={panelRef} className="project-scaffold-panel" style={{ left: position.x, top: position.y }} aria-label={isZh ? '项目学习提示助手' : 'Project scaffold assistant'}>
      <div className="project-scaffold-titlebar" onPointerDown={handleDragStart} onPointerMove={handleDragMove} onPointerUp={handleDragEnd} onPointerCancel={handleDragEnd}>
        <div>
          <GripHorizontal size={17} />
          <span><small>COGNISYNC / SCAFFOLD</small><strong>{isZh ? '项目学习助手' : 'Project learning assistant'}</strong></span>
        </div>
        <button type="button" onClick={() => onOpenChange(false)} aria-label={isZh ? '收起助手' : 'Close assistant'}><X size={20} /></button>
      </div>

      <div className="project-scaffold-body">
        <header className="project-scaffold-context">
          <div><span>{isZh ? stageLabel.zh : stageLabel.en}</span><b>L{level} · {LEVEL_LABELS[language][level]}</b></div>
          <small><Sparkles size={13} />{isZh ? '已读取本任务各环节产物与学习画像' : 'Uses every stage of this task and your learner profile'}</small>
        </header>

        <div ref={streamRef} className="project-scaffold-stream" aria-live="polite">
          {messages.length === 0 ? (
            <div className="project-scaffold-empty">
              <MessageCircleMore size={34} />
              <h4>{isZh ? '我知道你现在正在做什么' : 'I know what you are working on'}</h4>
              <p>{isZh
                ? `当前处于“${stageLabel.zh}”。我会参考本任务已保存的观察卡、功能卡和函数进度；建构阶段还会读取当前代码与测试反馈。`
                : `You are at “${stageLabel.en}”. I can use this task's observations, function cards and function progress, plus current code and tests during build.`}</p>
              <small>{isZh ? `当前证据：${observationCount} 张观察卡` : `${observationCount} observation cards`}</small>
            </div>
          ) : messages.map(message => (
            <article key={message.id} className={`project-scaffold-chat is-${message.role}`}>
              <span>{message.role === 'assistant' ? <Bot size={16} /> : <MessageCircleMore size={16} />}</span>
              <div>
                <small>{message.role === 'assistant'
                  ? `L${message.level} · ${LEVEL_LABELS[language][message.level]}${
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

        <form className="project-scaffold-composer" onSubmit={event => { event.preventDefault(); void submit(draft, 'student_message'); }}>
          <textarea value={draft} onChange={event => setDraft(event.target.value)} placeholder={isZh ? '说说你正在想什么，或哪里没有按预期运行…' : 'Describe what you are thinking or what did not work…'} maxLength={800} rows={2} />
          <button type="submit" disabled={!draft.trim() || sending} aria-label={isZh ? '发送问题' : 'Send question'}><Send size={18} /></button>
        </form>

        <div className="project-scaffold-actions">
          {/* 按钮显示的是「这一轮实际会拿到的等级」。教师蓝图封顶后仍写 L3，
              等于让学生按一个永远兑现不了的承诺去点。 */}
          <button type="button" className="is-primary" onClick={requestHint} disabled={sending}><Lightbulb size={16} />{
            effectiveCap !== null && effectiveCap < level
              ? (isZh ? `提示一下 · L${effectiveCap}（上限）` : `Hint · L${effectiveCap} (capped)`)
              : (isZh ? `提示一下 · L${level}` : `Hint · L${level}`)
          }</button>
          {messages.some(message => message.role === 'assistant' && message.stage === stage)
            && level < 3
            && (effectiveCap === null || level < effectiveCap) ? (
            <button type="button" onClick={requestMoreSpecific} disabled={sending}>{isZh ? '再具体一级' : 'One level more'}<ArrowRight size={16} /></button>
          ) : null}
          {level === 3 && stage === 'observe' && latestEvidence ? (
            <button type="button" onClick={applyMinimumCompletion}><Check size={16} />{isZh ? '采用最小补全' : 'Apply minimum completion'}</button>
          ) : null}
        </div>

        <p className="project-scaffold-footnote">{isZh ? '每轮问题、AI 建议、支架等级和画像快照都会进入教师端对话导出。' : 'Questions, advice, scaffold levels and profile snapshots are included in teacher exports.'}</p>
      </div>
    </aside>
  );
};
