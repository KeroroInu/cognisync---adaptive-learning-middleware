import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  CircleDot,
  GitBranch,
  Link2,
  ListChecks,
  Move,
  RotateCcw,
  Route,
  Unlink,
} from 'lucide-react';
import type { Language } from '../types';
import {
  buildTopologicalOrder,
  createDefaultCanvasPositions,
  createInitialPathPlan,
  inferBlueprintNode,
  readStoredList,
  readStoredObject,
  type StudentCanvasPosition,
  type StudentPathPlan,
} from '../data/projectPath';
import type { StudentObservationCard } from './ProjectFactory';
import type { StudentFunctionCard } from './ProjectFunctionStage';
import './ProjectPathStage.css';

interface Props {
  language: Language;
  taskId: string;
  stage: 'model' | 'plan';
  onBack: () => void;
  onContinue: () => void;
}

const CANVAS_NODE_WIDTH = 214;
const CANVAS_NODE_HEIGHT = 126;
const CANVAS_PADDING = 16;

interface DragState {
  cardId: string;
  pointerId: number;
  offsetX: number;
  offsetY: number;
}

const isCanvasPosition = (value: StudentCanvasPosition | undefined): value is StudentCanvasPosition => (
  Boolean(value) && Number.isFinite(value?.x) && Number.isFinite(value?.y)
);

const mergePlanWithCards = (stored: StudentPathPlan, cards: StudentFunctionCard[]): StudentPathPlan => {
  const cardIds = new Set(cards.map(card => card.id));
  const defaultPositions = createDefaultCanvasPositions(cards);
  const orderedCardIds = stored.orderedCardIds.filter(id => cardIds.has(id));
  cards.forEach(card => {
    if (!orderedCardIds.includes(card.id)) orderedCardIds.push(card.id);
  });

  return {
    ...stored,
    orderedCardIds,
    canvasPositions: Object.fromEntries(cards.map(card => [
      card.id,
      isCanvasPosition(stored.canvasPositions?.[card.id])
        ? stored.canvasPositions[card.id]
        : defaultPositions[card.id],
    ])),
    prerequisites: Object.fromEntries(
      Object.entries(stored.prerequisites)
        .filter(([id]) => cardIds.has(id))
        .map(([id, dependencies]) => [id, dependencies.filter(dep => cardIds.has(dep) && dep !== id)]),
    ),
  };
};

export const ProjectPathStage: React.FC<Props> = ({
  language,
  taskId,
  stage,
  onBack,
  onContinue,
}) => {
  const isZh = language === 'zh';
  const functionKey = `cognisync:project-function-cards:v1:${taskId}`;
  const observationKey = `cognisync:project-observation-cards:v2:${taskId}`;
  const pathKey = `cognisync:project-path-plan:v1:${taskId}`;
  const [cards] = useState<StudentFunctionCard[]>(() => readStoredList(functionKey));
  const [observations] = useState<StudentObservationCard[]>(() => readStoredList(observationKey));
  const [plan, setPlan] = useState<StudentPathPlan>(() => {
    const initial = createInitialPathPlan(readStoredList<StudentFunctionCard>(functionKey));
    return mergePlanWithCards(readStoredObject(pathKey, initial), readStoredList(functionKey));
  });
  const [selectedId, setSelectedId] = useState(() => plan.orderedCardIds[0] ?? '');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    if (draggingId) return;
    window.localStorage.setItem(pathKey, JSON.stringify(plan));
  }, [draggingId, pathKey, plan]);

  const cardsById = useMemo(() => new Map(cards.map(card => [card.id, card])), [cards]);
  const orderedCards = useMemo(
    () => plan.orderedCardIds.map(id => cardsById.get(id)).filter((card): card is StudentFunctionCard => Boolean(card)),
    [cardsById, plan.orderedCardIds],
  );
  const selectedCard = cardsById.get(selectedId) ?? orderedCards[0];
  const topology = useMemo(() => buildTopologicalOrder(cards, plan), [cards, plan]);
  const buildOrder = useMemo(
    () => topology.orderedIds.map(id => cardsById.get(id)).filter((card): card is StudentFunctionCard => Boolean(card)),
    [cardsById, topology.orderedIds],
  );
  const relationCount = (Object.values(plan.prerequisites) as string[][]).reduce((count, ids) => count + ids.length, 0);
  const canvasPositions = plan.canvasPositions ?? createDefaultCanvasPositions(cards);
  const relationEdges = useMemo(() => orderedCards.flatMap(card => (
    (plan.prerequisites[card.id] ?? []).map(prerequisiteId => ({
      id: `${prerequisiteId}->${card.id}`,
      sourceId: prerequisiteId,
      targetId: card.id,
    }))
  )), [orderedCards, plan.prerequisites]);

  const updateCanvasPosition = (cardId: string, position: StudentCanvasPosition) => {
    setPlan(current => {
      const previous = current.canvasPositions?.[cardId];
      if (previous?.x === position.x && previous.y === position.y) return current;
      return {
        ...current,
        canvasPositions: { ...current.canvasPositions, [cardId]: position },
        confirmedAt: undefined,
      };
    });
  };

  const beginCardDrag = (event: React.PointerEvent<HTMLElement>, cardId: string) => {
    if (event.button !== 0 || !canvasRef.current) return;
    const position = canvasPositions[cardId];
    if (!position) return;
    const bounds = canvasRef.current.getBoundingClientRect();
    dragRef.current = {
      cardId,
      pointerId: event.pointerId,
      offsetX: event.clientX - bounds.left - position.x,
      offsetY: event.clientY - bounds.top - position.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    setSelectedId(cardId);
    setDraggingId(cardId);
  };

  const moveDraggedCard = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const canvas = canvasRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const maxX = Math.max(CANVAS_PADDING, canvas.clientWidth - CANVAS_NODE_WIDTH - CANVAS_PADDING);
    const maxY = Math.max(CANVAS_PADDING, canvas.clientHeight - CANVAS_NODE_HEIGHT - CANVAS_PADDING);
    updateCanvasPosition(drag.cardId, {
      x: Math.round(Math.min(maxX, Math.max(CANVAS_PADDING, event.clientX - bounds.left - drag.offsetX))),
      y: Math.round(Math.min(maxY, Math.max(CANVAS_PADDING, event.clientY - bounds.top - drag.offsetY))),
    });
  };

  const finishCardDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDraggingId(null);
  };

  const nudgeCard = (event: React.KeyboardEvent<HTMLElement>, cardId: string) => {
    const deltaByKey: Record<string, StudentCanvasPosition> = {
      ArrowLeft: { x: -16, y: 0 },
      ArrowRight: { x: 16, y: 0 },
      ArrowUp: { x: 0, y: -16 },
      ArrowDown: { x: 0, y: 16 },
    };
    const delta = deltaByKey[event.key];
    if (!delta) return;
    event.preventDefault();
    const current = canvasPositions[cardId];
    if (!current) return;
    const canvas = canvasRef.current;
    const maxX = canvas ? Math.max(CANVAS_PADDING, canvas.clientWidth - CANVAS_NODE_WIDTH - CANVAS_PADDING) : Number.POSITIVE_INFINITY;
    const maxY = canvas ? Math.max(CANVAS_PADDING, canvas.clientHeight - CANVAS_NODE_HEIGHT - CANVAS_PADDING) : Number.POSITIVE_INFINITY;
    updateCanvasPosition(cardId, {
      x: Math.min(maxX, Math.max(CANVAS_PADDING, current.x + delta.x)),
      y: Math.min(maxY, Math.max(CANVAS_PADDING, current.y + delta.y)),
    });
  };

  const resetCanvasLayout = () => {
    setPlan(current => ({
      ...current,
      canvasPositions: createDefaultCanvasPositions(cards),
      confirmedAt: undefined,
    }));
  };

  const togglePrerequisite = (cardId: string, prerequisiteId: string) => {
    setPlan(current => {
      const active = current.prerequisites[cardId] ?? [];
      const next = active.includes(prerequisiteId)
        ? active.filter(id => id !== prerequisiteId)
        : [...active, prerequisiteId];
      return {
        ...current,
        prerequisites: { ...current.prerequisites, [cardId]: next },
        confirmedAt: undefined,
      };
    });
  };

  const continueFromPlan = () => {
    setPlan(current => ({
      ...current,
      orderedCardIds: topology.orderedIds,
      confirmedAt: new Date().toISOString(),
    }));
    onContinue();
  };

  if (cards.length === 0) {
    return (
      <section className="project-path-stage is-empty">
        <GitBranch size={34} />
        <h3>{isZh ? '还没有可建模的功能卡' : 'No function cards to model yet'}</h3>
        <p>{isZh ? '先从观察中形成功能卡，这里才会出现你自己的项目路径。' : 'Create function cards from your observations before building a project path.'}</p>
        <button type="button" onClick={onBack}>{isZh ? '返回功能拆解' : 'Back to functions'}</button>
      </section>
    );
  }

  if (stage === 'plan') {
    return (
      <section className="project-path-stage is-plan">
        <header className="path-stage-heading">
          <div>
            <span>04 / BUILD ROUTE</span>
            <h3>{isZh ? '把关系图变成自己的建构路径' : 'Turn relations into your build route'}</h3>
            <p>{isZh ? '系统只为你已提出的功能卡准备安全函数接口；没有提出的功能不会被自动补齐。' : 'Only your own cards receive safe function contracts. Missing functions are not added automatically.'}</p>
          </div>
          <div className={`path-validity ${topology.hasCycle ? 'has-error' : 'is-valid'}`}>
            {topology.hasCycle ? <GitBranch size={18} /> : <Check size={18} />}
            <span>{topology.hasCycle ? (isZh ? '关系中出现了循环' : 'Cycle detected') : (isZh ? '路径可执行' : 'Route executable')}</span>
          </div>
        </header>

        <div className="build-route-strip">
          {buildOrder.map((card, index) => {
            const node = inferBlueprintNode(card, observations);
            return (
              <React.Fragment key={card.id}>
                <article>
                  <header><span>{String(index + 1).padStart(2, '0')}</span><Route size={16} /></header>
                  <p>{card.responsibility}</p>
                  <div><small>{isZh ? '接入函数' : 'FUNCTION CONTRACT'}</small><code>{node.functionTemplate}</code></div>
                  <footer>{(isZh ? node.knowledgeZh : node.knowledgeEn).slice(0, 3).map(item => <span key={item}>{item}</span>)}</footer>
                </article>
                {index < buildOrder.length - 1 && <ArrowRight className="build-route-arrow" size={22} />}
              </React.Fragment>
            );
          })}
        </div>

        <section className="route-boundary-note">
          <CircleDot size={18} />
          <div>
            <strong>{isZh ? '平台负责的部分' : 'Provided by the platform'}</strong>
            <span>{isZh ? '画面绘制、键盘监听、定时运行和模块装配已锁定，学生只实现自己规划的功能。' : 'Rendering, keyboard events, timing and module assembly are locked; students implement only their planned functions.'}</span>
          </div>
        </section>

        <footer className="path-stage-footer">
          <button type="button" onClick={onBack}>{isZh ? '返回关系图' : 'Back to relations'}</button>
          <span>{isZh ? '缺失的功能将在综合运行中表现为可观察的问题' : 'Missing functions become observable problems during integration.'}</span>
          <button type="button" className="is-primary" disabled={topology.hasCycle} onClick={continueFromPlan}>
            {isZh ? '按此路径开始建构' : 'Build this route'}<ArrowRight size={17} />
          </button>
        </footer>
      </section>
    );
  }

  return (
    <section className="project-path-stage is-model">
      <header className="path-stage-heading">
        <div>
          <span>03 / RELATION MAP</span>
          <h3>{isZh ? '把功能卡连成你理解的系统' : 'Connect your cards into a system'}</h3>
          <p>{isZh ? '选中一张卡，点选它开始前必须已经完成的功能。没有前置的卡可以作为起点或并行任务。' : 'Select a card and mark what must already be complete. A card without prerequisites can start or run in parallel.'}</p>
        </div>
        <div className={`path-validity ${topology.hasCycle ? 'has-error' : relationCount > 0 ? 'is-valid' : ''}`}>
          <Link2 size={18} />
          <span>{isZh ? `${relationCount} 条关系` : `${relationCount} relations`}</span>
        </div>
      </header>

      <div className="relation-workspace">
        <section className="relation-canvas">
          <header className="relation-canvas-toolbar">
            <div className="relation-canvas-label"><GitBranch size={15} /><span>{isZh ? '我的功能关系画板' : 'MY FUNCTION CANVAS'}</span></div>
            <div>
              <span><Move size={13} />{isZh ? '拖动卡片整理关系' : 'Drag cards to arrange'}</span>
              <button type="button" onClick={resetCanvasLayout}><RotateCcw size={13} />{isZh ? '整理画布' : 'Reset layout'}</button>
            </div>
          </header>
          <div className="relation-board-scroll">
            <div
              ref={canvasRef}
              className="relation-board"
              onPointerMove={moveDraggedCard}
              onPointerUp={finishCardDrag}
              onPointerCancel={finishCardDrag}
            >
              <svg className="relation-wire-layer" aria-hidden="true">
                <defs>
                  <marker id="relation-arrow-head" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
                    <path d="M0,0 L8,4 L0,8 Z" />
                  </marker>
                </defs>
                {relationEdges.map(edge => {
                  const source = canvasPositions[edge.sourceId];
                  const target = canvasPositions[edge.targetId];
                  if (!source || !target) return null;
                  const movesRight = target.x >= source.x;
                  const sourceX = movesRight ? source.x + CANVAS_NODE_WIDTH : source.x;
                  const targetX = movesRight ? target.x : target.x + CANVAS_NODE_WIDTH;
                  const sourceY = source.y + CANVAS_NODE_HEIGHT / 2;
                  const targetY = target.y + CANVAS_NODE_HEIGHT / 2;
                  const bend = Math.max(55, Math.abs(targetX - sourceX) * .46);
                  const path = `M ${sourceX} ${sourceY} C ${sourceX + (movesRight ? bend : -bend)} ${sourceY}, ${targetX + (movesRight ? -bend : bend)} ${targetY}, ${targetX} ${targetY}`;
                  return <path key={edge.id} d={path} className={selectedCard?.id === edge.targetId ? 'is-selected' : ''} markerEnd="url(#relation-arrow-head)" />;
                })}
              </svg>
              {orderedCards.map((card, index) => {
                const dependencies = plan.prerequisites[card.id] ?? [];
                const selected = selectedCard?.id === card.id;
                const position = canvasPositions[card.id] ?? { x: CANVAS_PADDING, y: CANVAS_PADDING };
                return (
                  <article
                    key={card.id}
                    className={`relation-node ${selected ? 'is-selected' : ''} ${draggingId === card.id ? 'is-dragging' : ''}`}
                    style={{ left: position.x, top: position.y }}
                    role="button"
                    tabIndex={0}
                    aria-label={`${isZh ? '功能卡' : 'Function card'} ${index + 1}: ${card.responsibility}`}
                    onClick={() => setSelectedId(card.id)}
                    onKeyDown={event => nudgeCard(event, card.id)}
                    onPointerDown={event => beginCardDrag(event, card.id)}
                  >
                    <header><span>{String(index + 1).padStart(2, '0')}</span><Move size={14} /></header>
                    <h4>{card.responsibility}</h4>
                    <dl>
                      <div><dt>IN</dt><dd>{card.input}</dd></div>
                      <div><dt>OUT</dt><dd>{card.output}</dd></div>
                    </dl>
                    <footer>
                      {dependencies.length === 0
                        ? <><CircleDot size={13} />{isZh ? '起点 / 可并行' : 'Start / parallel'}</>
                        : <><Link2 size={13} />{isZh ? `依赖 ${dependencies.length} 张卡` : `${dependencies.length} prerequisites`}</>}
                    </footer>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <aside className="relation-inspector">
          <div className="relation-canvas-label"><ListChecks size={15} /><span>{isZh ? '设置前置关系' : 'SET PREREQUISITES'}</span></div>
          {selectedCard && (
            <>
              <blockquote>{selectedCard.responsibility}</blockquote>
              <p>{isZh ? '这张卡开始前，必须先有哪些结果？' : 'What must exist before this card can start?'}</p>
              <div className="prerequisite-options">
                {orderedCards.filter(card => card.id !== selectedCard.id).map(card => {
                  const active = (plan.prerequisites[selectedCard.id] ?? []).includes(card.id);
                  return (
                    <button key={card.id} type="button" className={active ? 'is-active' : ''} onClick={() => togglePrerequisite(selectedCard.id, card.id)}>
                      {active ? <Check size={14} /> : <CircleDot size={14} />}
                      <span>{card.responsibility}</span>
                    </button>
                  );
                })}
              </div>
              <div className="relation-meaning">
                {(plan.prerequisites[selectedCard.id] ?? []).length === 0 ? <Unlink size={16} /> : <Link2 size={16} />}
                <span>{(plan.prerequisites[selectedCard.id] ?? []).length === 0
                  ? (isZh ? '当前无前置，它会成为起点或与其他任务并行。' : 'No prerequisite: this becomes a start or parallel task.')
                  : (isZh ? '连线表示“先有前置卡的输出，再完成当前卡”。' : 'A link means the prerequisite output must exist first.')}</span>
              </div>
            </>
          )}
        </aside>
      </div>

      {topology.hasCycle && <div className="relation-cycle-warning"><GitBranch size={17} />{isZh ? '出现了循环依赖：A 等 B，B 又等 A。请取消其中一条关系。' : 'Circular dependency detected. Remove one of the links.'}</div>}

      <footer className="path-stage-footer">
        <button type="button" onClick={onBack}>{isZh ? '返回功能卡' : 'Back to functions'}</button>
        <span>{isZh ? '这里保留的是你的关系判断，不会自动改成教师答案' : 'Your relations are preserved; they are not replaced by the teacher answer.'}</span>
        <button type="button" className="is-primary" disabled={topology.hasCycle} onClick={onContinue}>
          {isZh ? '生成实现路径' : 'Generate build route'}<ArrowRight size={17} />
        </button>
      </footer>
    </section>
  );
};
