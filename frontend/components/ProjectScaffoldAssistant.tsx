import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, GripHorizontal, Lightbulb, MessageCircleMore, Sparkles, X } from 'lucide-react';
import type { Language } from '../types';
import {
  STAGE_SCAFFOLDS,
  formatSnakeEvidence,
  type ProjectStage,
  type SnakeRuntimeEvidence,
} from '../data/snakeProjectBlueprint';
import './ProjectScaffoldAssistant.css';

export interface ScaffoldCompletion {
  requestId: string;
  evidenceId?: string;
  text: string;
}

interface Props {
  language: Language;
  taskId: string;
  stage: ProjectStage;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  evidence: SnakeRuntimeEvidence[];
  observationCount: number;
  onApplyCompletion: (completion: ScaffoldCompletion) => void;
}

interface Position {
  x: number;
  y: number;
}

const STAGE_LABELS: Record<ProjectStage, { zh: string; en: string }> = {
  observe: { zh: '运行与观察', en: 'Run and observe' },
  decompose: { zh: '功能拆解', en: 'Function decomposition' },
  model: { zh: '关系建模', en: 'Relation modeling' },
  plan: { zh: '实现规划', en: 'Implementation planning' },
  build: { zh: '编码验证', en: 'Build and verify' },
};

const getDefaultPosition = (): Position => {
  if (typeof window === 'undefined') return { x: 720, y: 160 };
  return {
    x: Math.max(16, window.innerWidth - Math.min(370, window.innerWidth - 32) - 24),
    y: Math.max(86, window.innerHeight - 440),
  };
};

export const ProjectScaffoldAssistant: React.FC<Props> = ({
  language,
  taskId,
  stage,
  open,
  onOpenChange,
  evidence,
  observationCount,
  onApplyCompletion,
}) => {
  const isZh = language === 'zh';
  const [position, setPosition] = useState<Position>(getDefaultPosition);
  const [levels, setLevels] = useState<Record<ProjectStage, number>>({
    observe: -1,
    decompose: -1,
    model: -1,
    plan: -1,
    build: -1,
  });
  const panelRef = useRef<HTMLElement>(null);
  const wasOpenRef = useRef(false);
  const dragRef = useRef({ pointerId: -1, offsetX: 0, offsetY: 0 });
  const level = levels[stage];
  const hint = level >= 0 ? STAGE_SCAFFOLDS[stage][level] : null;
  const stageLabel = STAGE_LABELS[stage];

  const latestEvidence = useMemo(() => {
    const meaningful = [...evidence].reverse().find(item => !['opened', 'started', 'paused'].includes(item.type));
    return meaningful ?? evidence[evidence.length - 1];
  }, [evidence]);

  const clampPosition = useCallback((x: number, y: number): Position => {
    const width = panelRef.current?.offsetWidth ?? Math.min(370, window.innerWidth - 32);
    const height = panelRef.current?.offsetHeight ?? 390;
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

  const recordEvent = useCallback((event: Record<string, unknown>) => {
    const storageKey = `cognisync:scaffold-events:v1:${taskId}`;
    try {
      const stored = window.localStorage.getItem(storageKey);
      const current = stored ? JSON.parse(stored) : [];
      const next = [...current, {
        id: `scaffold-${Date.now()}-${current.length + 1}`,
        timestamp: new Date().toISOString(),
        stage,
        evidenceCount: evidence.length,
        observationCount,
        ...event,
      }].slice(-120);
      window.localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Local prototype logging must never interrupt the learning task.
    }
  }, [evidence.length, observationCount, stage, taskId]);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setPosition(current => clampPosition(current.x, current.y));
      recordEvent({ action: 'assistant_opened', level: Math.max(level, 0) });
    }
    wasOpenRef.current = open;
  }, [clampPosition, level, open, recordEvent]);

  const requestHint = () => {
    const nextLevel = Math.min(3, level + 1);
    setLevels(current => ({ ...current, [stage]: nextLevel }));
    recordEvent({ action: 'hint_requested', level: nextLevel });
  };

  const applyMinimumCompletion = () => {
    if (stage !== 'observe' || !latestEvidence) return;
    const evidenceText = formatSnakeEvidence(latestEvidence, language);
    const completion: ScaffoldCompletion = {
      requestId: `completion-${Date.now()}`,
      evidenceId: latestEvidence.id,
      text: isZh ? `我观察到：${evidenceText}。` : `I observed that ${evidenceText}.`,
    };
    onApplyCompletion(completion);
    recordEvent({
      action: 'minimum_completion_applied',
      level: 3,
      evidenceId: latestEvidence.id,
      completionText: completion.text,
    });
    onOpenChange(false);
  };

  const handleDragStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - position.x,
      offsetY: event.clientY - position.y,
    };
  };

  const handleDragMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current.pointerId !== event.pointerId) return;
    setPosition(clampPosition(
      event.clientX - dragRef.current.offsetX,
      event.clientY - dragRef.current.offsetY,
    ));
  };

  const handleDragEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current.pointerId = -1;
  };

  if (!open) return null;

  return (
    <aside
      ref={panelRef}
      className="project-scaffold-panel"
      style={{ left: position.x, top: position.y }}
      aria-label={isZh ? '项目学习提示助手' : 'Project scaffold assistant'}
    >
      <div
        className="project-scaffold-titlebar"
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        onPointerCancel={handleDragEnd}
      >
        <div>
          <GripHorizontal size={15} />
          <span>
            <small>COGNISYNC / SCAFFOLD</small>
            <strong>{isZh ? '项目学习助手' : 'Project learning assistant'}</strong>
          </span>
        </div>
        <button type="button" onClick={() => onOpenChange(false)} aria-label={isZh ? '收起助手' : 'Close assistant'}>
          <X size={16} />
        </button>
      </div>

      <div className="project-scaffold-body" aria-live="polite">
        <div className="project-scaffold-context">
          <span>{isZh ? stageLabel.zh : stageLabel.en}</span>
          <small>{isZh ? `已记录 ${observationCount} 张观察卡` : `${observationCount} observation cards`}</small>
        </div>

        {hint ? (
          <div className="project-scaffold-message">
            <span><Sparkles size={17} /></span>
            <div>
              <small>{isZh ? hint.labelZh : hint.labelEn}</small>
              <p>{isZh ? hint.bodyZh : hint.bodyEn}</p>
            </div>
          </div>
        ) : (
          <div className="project-scaffold-empty">
            <MessageCircleMore size={26} />
            <p>{isZh ? '我会结合你当前的运行证据和作品，只提示推进所需的最小一步。' : 'I will use your current evidence and work to give only the smallest helpful step.'}</p>
          </div>
        )}

        <div className="project-scaffold-actions">
          {!hint ? (
            <button type="button" className="is-primary" onClick={requestHint}>
              <Lightbulb size={16} />{isZh ? '提示一下' : 'Give me a hint'}
            </button>
          ) : (
            <>
              <button type="button" onClick={() => onOpenChange(false)}>{isZh ? '我来试试' : 'I will try'}</button>
              {level < 3 ? (
                <button type="button" className="is-primary" onClick={requestHint}>
                  {isZh ? '再具体一点' : 'More specific'}<ArrowRight size={16} />
                </button>
              ) : stage === 'observe' && latestEvidence ? (
                <button type="button" className="is-primary" onClick={applyMinimumCompletion}>
                  {isZh ? '帮我补上这一步' : 'Complete this step'}<ArrowRight size={16} />
                </button>
              ) : null}
            </>
          )}
        </div>

        <p className="project-scaffold-footnote">
          {isZh ? '提示等级、采用情况和后续修改将作为过程证据记录。' : 'Hint level, adoption and later revisions are recorded as process evidence.'}
        </p>
      </div>
    </aside>
  );
};
