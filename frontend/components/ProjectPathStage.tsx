import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  CircleDot,
  GitBranch,
  Link2,
  ListChecks,
  Minus,
  Move,
  MousePointer2,
  Plus,
  RotateCcw,
  Route,
  Trash2,
  X,
} from 'lucide-react';
import type { Language } from '../types';
import {
  buildTopologicalOrder,
  createDefaultCanvasPositions,
  createInitialPathPlan,
  inferBlueprintNode,
  readStoredList,
  readStoredObject,
  STUDENT_CANVAS_LAYOUT_VERSION,
  type StudentCanvasPosition,
  type StudentDiagramEdge,
  type StudentFlowNode,
  type StudentFlowNodeKind,
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

const CANVAS_NODE_WIDTH = 270;
const CANVAS_NODE_HEIGHT = 158;
const FLOW_NODE_WIDTH = 164;
const FLOW_NODE_HEIGHT = 76;
const DECISION_NODE_SIZE = 116;
const CANVAS_PADDING = 20;
const CANVAS_WIDTH = 1600;
const CANVAS_HEIGHT = 720;
const MIN_CANVAS_ZOOM = .7;
const MAX_CANVAS_ZOOM = 1.4;

const FLOW_NODE_LIBRARY: Array<{ kind: StudentFlowNodeKind; labelZh: string; labelEn: string }> = [
  { kind: 'start', labelZh: '开始', labelEn: 'Start' },
  { kind: 'process', labelZh: '处理步骤', labelEn: 'Process' },
  { kind: 'decision', labelZh: '条件成立？', labelEn: 'Decision?' },
  { kind: 'input-output', labelZh: '输入 / 输出', labelEn: 'Input / output' },
  { kind: 'end', labelZh: '结束', labelEn: 'End' },
];

type CanvasNodeType = 'card' | 'flow';

interface DragState {
  nodeId: string;
  nodeType: CanvasNodeType;
  pointerId: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

interface PaletteDragPayload {
  type: 'card' | 'shape';
  id?: string;
  kind?: StudentFlowNodeKind;
}

const isCanvasPosition = (value: StudentCanvasPosition | undefined): value is StudentCanvasPosition => (
  Boolean(value) && Number.isFinite(value?.x) && Number.isFinite(value?.y)
);

const getFlowNodeSize = (kind: StudentFlowNodeKind) => (
  kind === 'decision'
    ? { width: DECISION_NODE_SIZE, height: DECISION_NODE_SIZE }
    : { width: FLOW_NODE_WIDTH, height: FLOW_NODE_HEIGHT }
);

const makeEdgeId = (sourceId: string, targetId: string) => `${sourceId}->${targetId}`;

const prerequisitesToEdges = (prerequisites: Record<string, string[]>): StudentDiagramEdge[] => (
  Object.entries(prerequisites).flatMap(([targetId, sourceIds]) => sourceIds.map(sourceId => ({
    id: makeEdgeId(sourceId, targetId),
    sourceId,
    targetId,
  })))
);

const derivePrerequisites = (
  cardIds: string[],
  edges: StudentDiagramEdge[],
): Record<string, string[]> => {
  const cardIdSet = new Set(cardIds);
  const incoming = new Map<string, string[]>();
  edges.forEach(edge => incoming.set(edge.targetId, [...(incoming.get(edge.targetId) ?? []), edge.sourceId]));

  const findPreviousCards = (targetId: string) => {
    const found = new Set<string>();
    const visited = new Set<string>();
    const stack = [...(incoming.get(targetId) ?? [])];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current || current === targetId || visited.has(current)) continue;
      visited.add(current);
      if (cardIdSet.has(current)) {
        found.add(current);
      } else {
        stack.push(...(incoming.get(current) ?? []));
      }
    }
    return [...found];
  };

  return Object.fromEntries(cardIds.map(cardId => [cardId, findPreviousCards(cardId)]));
};

const createsDiagramCycle = (edges: StudentDiagramEdge[], sourceId: string, targetId: string) => {
  const outgoing = new Map<string, string[]>();
  edges.forEach(edge => outgoing.set(edge.sourceId, [...(outgoing.get(edge.sourceId) ?? []), edge.targetId]));
  const stack = [targetId];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || visited.has(current)) continue;
    if (current === sourceId) return true;
    visited.add(current);
    stack.push(...(outgoing.get(current) ?? []));
  }
  return false;
};

const mergePlanWithCards = (stored: StudentPathPlan, cards: StudentFunctionCard[]): StudentPathPlan => {
  const cardIds = new Set(cards.map(card => card.id));
  const defaultPositions = createDefaultCanvasPositions(cards);
  const useStoredPositions = stored.canvasLayoutVersion === STUDENT_CANVAS_LAYOUT_VERSION;
  const flowNodes = (stored.flowNodes ?? []).filter(node => isCanvasPosition(node.position));
  const validNodeIds = new Set([...cardIds, ...flowNodes.map(node => node.id)]);
  const orderedCardIds = stored.orderedCardIds.filter(id => cardIds.has(id));
  cards.forEach(card => {
    if (!orderedCardIds.includes(card.id)) orderedCardIds.push(card.id);
  });
  const placedCardIds = stored.placedCardIds
    ? stored.placedCardIds.filter(id => cardIds.has(id))
    : orderedCardIds;
  const diagramEdges = (stored.diagramEdges ?? prerequisitesToEdges(stored.prerequisites))
    .filter(edge => validNodeIds.has(edge.sourceId) && validNodeIds.has(edge.targetId) && edge.sourceId !== edge.targetId);

  return {
    ...stored,
    orderedCardIds,
    placedCardIds,
    flowNodes,
    diagramEdges,
    canvasLayoutVersion: STUDENT_CANVAS_LAYOUT_VERSION,
    canvasPositions: Object.fromEntries(cards.map(card => [
      card.id,
      useStoredPositions && isCanvasPosition(stored.canvasPositions?.[card.id])
        ? stored.canvasPositions[card.id]
        : defaultPositions[card.id],
    ])),
    prerequisites: derivePrerequisites(placedCardIds, diagramEdges),
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
  const [selectedId, setSelectedId] = useState(() => plan.placedCardIds?.[0] ?? '');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [connectMode, setConnectMode] = useState(false);
  const [connectionSourceId, setConnectionSourceId] = useState<string | null>(null);
  const [canvasNotice, setCanvasNotice] = useState('');
  const [canvasZoom, setCanvasZoom] = useState(1);
  const canvasRef = useRef<HTMLDivElement>(null);
  const canvasScrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    if (draggingId) return;
    window.localStorage.setItem(pathKey, JSON.stringify(plan));
  }, [draggingId, pathKey, plan]);

  const cardsById = useMemo(() => new Map(cards.map(card => [card.id, card])), [cards]);
  const placedCardIds = plan.placedCardIds ?? plan.orderedCardIds;
  const orderedCards = useMemo(
    () => placedCardIds.map(id => cardsById.get(id)).filter((card): card is StudentFunctionCard => Boolean(card)),
    [cardsById, placedCardIds],
  );
  const selectedCard = placedCardIds.includes(selectedId) ? cardsById.get(selectedId) : undefined;
  const flowNodes = plan.flowNodes ?? [];
  const selectedFlowNode = flowNodes.find(node => node.id === selectedId);
  const diagramEdges = plan.diagramEdges ?? prerequisitesToEdges(plan.prerequisites);
  const topology = useMemo(() => buildTopologicalOrder(orderedCards, plan), [orderedCards, plan]);
  const buildOrder = useMemo(
    () => topology.orderedIds.map(id => cardsById.get(id)).filter((card): card is StudentFunctionCard => Boolean(card)),
    [cardsById, topology.orderedIds],
  );
  const relationCount = diagramEdges.length;
  const canvasPositions = plan.canvasPositions ?? createDefaultCanvasPositions(cards);
  const canvasNodeIds = useMemo(() => new Set([...placedCardIds, ...flowNodes.map(node => node.id)]), [flowNodes, placedCardIds]);
  const relationEdges = useMemo(
    () => diagramEdges.filter(edge => canvasNodeIds.has(edge.sourceId) && canvasNodeIds.has(edge.targetId)),
    [canvasNodeIds, diagramEdges],
  );
  const selectedEdges = relationEdges.filter(edge => edge.sourceId === selectedId || edge.targetId === selectedId);

  const getNodeGeometry = (nodeId: string) => {
    const card = cardsById.get(nodeId);
    if (card && placedCardIds.includes(nodeId)) {
      const position = canvasPositions[nodeId] ?? { x: CANVAS_PADDING, y: CANVAS_PADDING };
      return { ...position, width: CANVAS_NODE_WIDTH, height: CANVAS_NODE_HEIGHT };
    }
    const flowNode = flowNodes.find(node => node.id === nodeId);
    if (!flowNode) return undefined;
    return { ...flowNode.position, ...getFlowNodeSize(flowNode.kind) };
  };
  const getNodeLabel = (nodeId: string) => (
    cardsById.get(nodeId)?.responsibility
    ?? flowNodes.find(node => node.id === nodeId)?.label
    ?? (isZh ? '未命名节点' : 'Untitled node')
  );

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

  const updateFlowNode = (nodeId: string, patch: Partial<StudentFlowNode>) => {
    setPlan(current => ({
      ...current,
      flowNodes: (current.flowNodes ?? []).map(node => node.id === nodeId ? { ...node, ...patch } : node),
      confirmedAt: undefined,
    }));
  };

  const beginNodeDrag = (
    event: React.PointerEvent<HTMLElement>,
    nodeId: string,
    nodeType: CanvasNodeType,
    position: StudentCanvasPosition,
    size: { width: number; height: number },
  ) => {
    if (event.button !== 0 || !canvasRef.current || connectMode) return;
    if (!position) return;
    const bounds = canvasRef.current.getBoundingClientRect();
    dragRef.current = {
      nodeId,
      nodeType,
      pointerId: event.pointerId,
      offsetX: (event.clientX - bounds.left) / canvasZoom - position.x,
      offsetY: (event.clientY - bounds.top) / canvasZoom - position.y,
      ...size,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    setSelectedId(nodeId);
    setDraggingId(nodeId);
  };

  const moveDraggedCard = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const canvas = canvasRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const maxX = Math.max(CANVAS_PADDING, canvas.clientWidth - drag.width - CANVAS_PADDING);
    const maxY = Math.max(CANVAS_PADDING, canvas.clientHeight - drag.height - CANVAS_PADDING);
    const position = {
      x: Math.round(Math.min(maxX, Math.max(CANVAS_PADDING, (event.clientX - bounds.left) / canvasZoom - drag.offsetX))),
      y: Math.round(Math.min(maxY, Math.max(CANVAS_PADDING, (event.clientY - bounds.top) / canvasZoom - drag.offsetY))),
    };
    if (drag.nodeType === 'card') updateCanvasPosition(drag.nodeId, position);
    else updateFlowNode(drag.nodeId, { position });
  };

  const finishCardDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDraggingId(null);
  };

  const nudgeNode = (
    event: React.KeyboardEvent<HTMLElement>,
    nodeId: string,
    nodeType: CanvasNodeType,
    current: StudentCanvasPosition,
    size: { width: number; height: number },
  ) => {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      removeNodeFromCanvas(nodeId, nodeType);
      return;
    }
    const deltaByKey: Record<string, StudentCanvasPosition> = {
      ArrowLeft: { x: -16, y: 0 },
      ArrowRight: { x: 16, y: 0 },
      ArrowUp: { x: 0, y: -16 },
      ArrowDown: { x: 0, y: 16 },
    };
    const delta = deltaByKey[event.key];
    if (!delta) return;
    event.preventDefault();
    if (!current) return;
    const canvas = canvasRef.current;
    const maxX = canvas ? Math.max(CANVAS_PADDING, canvas.clientWidth - size.width - CANVAS_PADDING) : Number.POSITIVE_INFINITY;
    const maxY = canvas ? Math.max(CANVAS_PADDING, canvas.clientHeight - size.height - CANVAS_PADDING) : Number.POSITIVE_INFINITY;
    const position = {
      x: Math.min(maxX, Math.max(CANVAS_PADDING, current.x + delta.x)),
      y: Math.min(maxY, Math.max(CANVAS_PADDING, current.y + delta.y)),
    };
    if (nodeType === 'card') updateCanvasPosition(nodeId, position);
    else updateFlowNode(nodeId, { position });
  };

  const resetCanvasLayout = () => {
    setPlan(current => ({
      ...current,
      canvasPositions: createDefaultCanvasPositions(orderedCards),
      flowNodes: (current.flowNodes ?? []).map((node, index) => ({
        ...node,
        position: { x: 60 + index * 205, y: 500 },
      })),
      confirmedAt: undefined,
    }));
  };

  const getCenteredCanvasPosition = (size: { width: number; height: number }) => {
    const scroll = canvasScrollRef.current;
    const canvas = canvasRef.current;
    if (!scroll || !canvas) return { x: CANVAS_PADDING, y: CANVAS_PADDING };
    return {
      x: Math.round(Math.max(CANVAS_PADDING, Math.min(canvas.clientWidth - size.width - CANVAS_PADDING, scroll.scrollLeft / canvasZoom + scroll.clientWidth / (2 * canvasZoom) - size.width / 2))),
      y: Math.round(Math.max(CANVAS_PADDING, Math.min(canvas.clientHeight - size.height - CANVAS_PADDING, scroll.scrollTop / canvasZoom + scroll.clientHeight / (2 * canvasZoom) - size.height / 2))),
    };
  };

  const placeCardOnCanvas = (cardId: string, position = getCenteredCanvasPosition({ width: CANVAS_NODE_WIDTH, height: CANVAS_NODE_HEIGHT })) => {
    setPlan(current => {
      const activeIds = current.placedCardIds ?? current.orderedCardIds;
      if (activeIds.includes(cardId)) {
        return { ...current, canvasPositions: { ...current.canvasPositions, [cardId]: position }, confirmedAt: undefined };
      }
      const nextIds = [...activeIds, cardId];
      return {
        ...current,
        placedCardIds: nextIds,
        orderedCardIds: [...current.orderedCardIds.filter(id => id !== cardId), cardId],
        canvasPositions: { ...current.canvasPositions, [cardId]: position },
        prerequisites: derivePrerequisites(nextIds, current.diagramEdges ?? []),
        confirmedAt: undefined,
      };
    });
    setSelectedId(cardId);
    setCanvasNotice(isZh ? '功能卡已放入画布' : 'Function card added');
  };

  const addFlowNode = (
    kind: StudentFlowNodeKind,
    position = getCenteredCanvasPosition(getFlowNodeSize(kind)),
  ) => {
    const definition = FLOW_NODE_LIBRARY.find(item => item.kind === kind) ?? FLOW_NODE_LIBRARY[1];
    const id = `flow-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const node: StudentFlowNode = {
      id,
      kind,
      label: isZh ? definition.labelZh : definition.labelEn,
      position,
    };
    setPlan(current => ({ ...current, flowNodes: [...(current.flowNodes ?? []), node], confirmedAt: undefined }));
    setSelectedId(id);
    setCanvasNotice(isZh ? '流程图形已放入画布，可在右侧改名' : 'Flow shape added; rename it in the panel');
  };

  const startPaletteDrag = (event: React.DragEvent<HTMLElement>, payload: PaletteDragPayload) => {
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('application/x-cognisync-node', JSON.stringify(payload));
    event.dataTransfer.setData('text/plain', payload.id ?? payload.kind ?? 'node');
  };

  const dropPaletteNode = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const payload = JSON.parse(event.dataTransfer.getData('application/x-cognisync-node')) as PaletteDragPayload;
      const bounds = canvas.getBoundingClientRect();
      if (payload.type === 'card' && payload.id) {
        const position = {
          x: Math.round(Math.max(CANVAS_PADDING, Math.min(canvas.clientWidth - CANVAS_NODE_WIDTH - CANVAS_PADDING, (event.clientX - bounds.left) / canvasZoom - CANVAS_NODE_WIDTH / 2))),
          y: Math.round(Math.max(CANVAS_PADDING, Math.min(canvas.clientHeight - CANVAS_NODE_HEIGHT - CANVAS_PADDING, (event.clientY - bounds.top) / canvasZoom - CANVAS_NODE_HEIGHT / 2))),
        };
        placeCardOnCanvas(payload.id, position);
      } else if (payload.type === 'shape' && payload.kind) {
        const size = getFlowNodeSize(payload.kind);
        const position = {
          x: Math.round(Math.max(CANVAS_PADDING, Math.min(canvas.clientWidth - size.width - CANVAS_PADDING, (event.clientX - bounds.left) / canvasZoom - size.width / 2))),
          y: Math.round(Math.max(CANVAS_PADDING, Math.min(canvas.clientHeight - size.height - CANVAS_PADDING, (event.clientY - bounds.top) / canvasZoom - size.height / 2))),
        };
        addFlowNode(payload.kind, position);
      }
    } catch {
      setCanvasNotice(isZh ? '没有识别到可放入的素材' : 'The dropped item could not be read');
    }
  };

  const addDiagramEdge = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    const edgeId = makeEdgeId(sourceId, targetId);
    if (diagramEdges.some(edge => edge.id === edgeId)) {
      setCanvasNotice(isZh ? '这条连线已经存在' : 'This connection already exists');
      return;
    }
    if (createsDiagramCycle(diagramEdges, sourceId, targetId)) {
      setCanvasNotice(isZh ? '这条连线会形成循环，请换一个方向' : 'This link would create a cycle');
      return;
    }
    setPlan(current => {
      const nextEdges = [...(current.diagramEdges ?? []), { id: edgeId, sourceId, targetId }];
      const activeIds = current.placedCardIds ?? current.orderedCardIds;
      return {
        ...current,
        diagramEdges: nextEdges,
        prerequisites: derivePrerequisites(activeIds, nextEdges),
        confirmedAt: undefined,
      };
    });
    setCanvasNotice(isZh ? '连线已建立' : 'Connection created');
  };

  const removeDiagramEdge = (edgeId: string) => {
    setPlan(current => {
      const nextEdges = (current.diagramEdges ?? []).filter(edge => edge.id !== edgeId);
      const activeIds = current.placedCardIds ?? current.orderedCardIds;
      return {
        ...current,
        diagramEdges: nextEdges,
        prerequisites: derivePrerequisites(activeIds, nextEdges),
        confirmedAt: undefined,
      };
    });
  };

  const handleCanvasNodeClick = (nodeId: string) => {
    setSelectedId(nodeId);
    if (!connectMode) return;
    if (!connectionSourceId) {
      setConnectionSourceId(nodeId);
      setCanvasNotice(isZh ? '已选起点，请点击要连接到的节点' : 'Start selected; choose the destination');
      return;
    }
    addDiagramEdge(connectionSourceId, nodeId);
    setConnectionSourceId(null);
  };

  const removeNodeFromCanvas = (nodeId: string, nodeType: CanvasNodeType) => {
    setPlan(current => {
      const nextEdges = (current.diagramEdges ?? []).filter(edge => edge.sourceId !== nodeId && edge.targetId !== nodeId);
      const nextPlacedIds = nodeType === 'card'
        ? (current.placedCardIds ?? current.orderedCardIds).filter(id => id !== nodeId)
        : (current.placedCardIds ?? current.orderedCardIds);
      return {
        ...current,
        placedCardIds: nextPlacedIds,
        flowNodes: nodeType === 'flow' ? (current.flowNodes ?? []).filter(node => node.id !== nodeId) : current.flowNodes,
        diagramEdges: nextEdges,
        prerequisites: derivePrerequisites(nextPlacedIds, nextEdges),
        confirmedAt: undefined,
      };
    });
    setSelectedId('');
    setConnectionSourceId(source => source === nodeId ? null : source);
    setCanvasNotice(nodeType === 'card'
      ? (isZh ? '功能卡已移回右侧素材区' : 'Card returned to the palette')
      : (isZh ? '流程图形已删除' : 'Flow shape deleted'));
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
          <div className={`path-validity ${topology.hasCycle ? 'has-error' : orderedCards.length > 0 ? 'is-valid' : ''}`}>
            {topology.hasCycle ? <GitBranch size={18} /> : orderedCards.length > 0 ? <Check size={18} /> : <CircleDot size={18} />}
            <span>{topology.hasCycle
              ? (isZh ? '关系中出现了循环' : 'Cycle detected')
              : orderedCards.length > 0
                ? (isZh ? '路径可执行' : 'Route executable')
                : (isZh ? '尚未放入功能卡' : 'No function cards placed')}</span>
          </div>
        </header>

        <div className="build-route-strip">
          {buildOrder.length === 0 && (
            <div className="build-route-empty">
              <Route size={28} />
              <strong>{isZh ? '画布中还没有参与建构的功能卡' : 'No function cards are participating yet'}</strong>
              <span>{isZh ? '返回关系画板，从右侧把需要的功能卡拖入画布。' : 'Return to the relation canvas and add cards from the palette.'}</span>
            </div>
          )}
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
          <button type="button" className="is-primary" disabled={topology.hasCycle || orderedCards.length === 0} onClick={continueFromPlan}>
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
          <p>{isZh ? '从右侧拖入功能卡与流程图形，自由排列后用箭头表达先后、判断和分支。' : 'Drag in cards and flow shapes, then connect them to express order, decisions and branches.'}</p>
        </div>
        <div className={`path-validity ${topology.hasCycle ? 'has-error' : relationCount > 0 ? 'is-valid' : ''}`}>
          <Link2 size={18} />
          <span>{isZh ? `${relationCount} 条关系` : `${relationCount} relations`}</span>
        </div>
      </header>

      <div className="relation-workspace">
        <section className="relation-canvas">
          <header className="relation-canvas-toolbar">
            <div className="relation-canvas-label"><GitBranch size={15} /><span>{isZh ? '我的系统流程画板' : 'MY SYSTEM CANVAS'}</span></div>
            <div>
              <div className="relation-zoom-controls" aria-label={isZh ? '画板缩放' : 'Canvas zoom'}>
                <button
                  type="button"
                  aria-label={isZh ? '缩小画板' : 'Zoom out'}
                  disabled={canvasZoom <= MIN_CANVAS_ZOOM}
                  onClick={() => setCanvasZoom(value => Math.max(MIN_CANVAS_ZOOM, Math.round((value - .1) * 10) / 10))}
                ><Minus size={13} /></button>
                <span>{Math.round(canvasZoom * 100)}%</span>
                <button
                  type="button"
                  aria-label={isZh ? '放大画板' : 'Zoom in'}
                  disabled={canvasZoom >= MAX_CANVAS_ZOOM}
                  onClick={() => setCanvasZoom(value => Math.min(MAX_CANVAS_ZOOM, Math.round((value + .1) * 10) / 10))}
                ><Plus size={13} /></button>
              </div>
              <button
                type="button"
                className={connectMode ? 'is-active' : ''}
                onClick={() => {
                  setConnectMode(active => !active);
                  setConnectionSourceId(null);
                  setCanvasNotice(isZh ? '连线模式：依次点击起点和终点' : 'Connect mode: click source, then destination');
                }}
              >
                {connectMode ? <X size={13} /> : <Link2 size={13} />}
                {connectMode ? (isZh ? '退出连线' : 'Exit connect') : (isZh ? '连接节点' : 'Connect nodes')}
              </button>
              <button type="button" onClick={resetCanvasLayout}><RotateCcw size={13} />{isZh ? '整理画布' : 'Reset layout'}</button>
            </div>
          </header>
          <div ref={canvasScrollRef} className="relation-board-scroll">
            <div
              className="relation-board-zoom-shell"
              style={{ width: CANVAS_WIDTH * canvasZoom, height: CANVAS_HEIGHT * canvasZoom }}
            >
              <div
                ref={canvasRef}
                className={`relation-board ${connectMode ? 'is-connecting' : ''}`}
                style={{ transform: `scale(${canvasZoom})` }}
                onPointerMove={moveDraggedCard}
                onPointerUp={finishCardDrag}
                onPointerCancel={finishCardDrag}
                onDragOver={event => event.preventDefault()}
                onDrop={dropPaletteNode}
              >
              <svg className="relation-wire-layer" aria-hidden="true">
                <defs>
                  <marker id="relation-arrow-head" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
                    <path d="M0,0 L8,4 L0,8 Z" />
                  </marker>
                </defs>
                {relationEdges.map(edge => {
                  const source = getNodeGeometry(edge.sourceId);
                  const target = getNodeGeometry(edge.targetId);
                  if (!source || !target) return null;
                  const movesRight = target.x >= source.x;
                  const sourceX = movesRight ? source.x + source.width : source.x;
                  const targetX = movesRight ? target.x : target.x + target.width;
                  const sourceY = source.y + source.height / 2;
                  const targetY = target.y + target.height / 2;
                  const bend = Math.max(55, Math.abs(targetX - sourceX) * .46);
                  const path = `M ${sourceX} ${sourceY} C ${sourceX + (movesRight ? bend : -bend)} ${sourceY}, ${targetX + (movesRight ? -bend : bend)} ${targetY}, ${targetX} ${targetY}`;
                  return <path key={edge.id} d={path} className={selectedId === edge.targetId || selectedId === edge.sourceId ? 'is-selected' : ''} markerEnd="url(#relation-arrow-head)" />;
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
                    onClick={() => handleCanvasNodeClick(card.id)}
                    onKeyDown={event => nudgeNode(event, card.id, 'card', position, { width: CANVAS_NODE_WIDTH, height: CANVAS_NODE_HEIGHT })}
                    onPointerDown={event => beginNodeDrag(event, card.id, 'card', position, { width: CANVAS_NODE_WIDTH, height: CANVAS_NODE_HEIGHT })}
                  >
                    <header><span>{String(index + 1).padStart(2, '0')}</span>{connectionSourceId === card.id ? <Link2 size={14} /> : <Move size={14} />}</header>
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
              {flowNodes.map(node => {
                const size = getFlowNodeSize(node.kind);
                const selected = selectedFlowNode?.id === node.id;
                return (
                  <React.Fragment key={node.id}>
                    <article
                      className={`flowchart-node is-${node.kind} ${selected ? 'is-selected' : ''} ${draggingId === node.id ? 'is-dragging' : ''} ${connectionSourceId === node.id ? 'is-connection-source' : ''}`}
                      style={{ left: node.position.x, top: node.position.y, width: size.width, height: size.height }}
                      role="button"
                      tabIndex={0}
                      aria-label={`${isZh ? '流程节点' : 'Flow node'}: ${node.label}`}
                      onClick={() => handleCanvasNodeClick(node.id)}
                      onKeyDown={event => nudgeNode(event, node.id, 'flow', node.position, size)}
                      onPointerDown={event => beginNodeDrag(event, node.id, 'flow', node.position, size)}
                    >
                      <div className="flowchart-node-shape"><span>{node.label}</span></div>
                    </article>
                    {selected && (
                      <button
                        type="button"
                        className="flowchart-node-delete"
                        style={{ left: node.position.x + size.width - 13, top: node.position.y - 13 }}
                        aria-label={`${isZh ? '删除流程元素' : 'Delete flow element'}: ${node.label}`}
                        onPointerDown={event => event.stopPropagation()}
                        onClick={event => {
                          event.stopPropagation();
                          removeNodeFromCanvas(node.id, 'flow');
                        }}
                      ><X size={14} /></button>
                    )}
                  </React.Fragment>
                );
              })}
              {orderedCards.length === 0 && flowNodes.length === 0 && (
                <div className="relation-board-empty">
                  <MousePointer2 size={28} />
                  <strong>{isZh ? '从右侧拖入功能卡或流程图形' : 'Drag a card or flow shape from the right'}</strong>
                  <span>{isZh ? '也可以直接点击素材，将它放到画布中央。' : 'You can also click an item to place it in the center.'}</span>
                </div>
              )}
              </div>
            </div>
          </div>
        </section>

        <aside className="relation-toolbox">
          <section className="toolbox-section">
            <div className="relation-canvas-label"><GitBranch size={15} /><span>{isZh ? '流程图形' : 'FLOW SHAPES'}</span></div>
            <p>{isZh ? '拖入画布，补充开始、处理和判断逻辑。' : 'Drag shapes in to express process logic.'}</p>
            <div className="flow-shape-palette">
              {FLOW_NODE_LIBRARY.map(item => (
                <button
                  key={item.kind}
                  type="button"
                  draggable
                  onDragStart={event => startPaletteDrag(event, { type: 'shape', kind: item.kind })}
                  onClick={() => addFlowNode(item.kind)}
                >
                  <i className={`palette-flow-icon is-${item.kind}`}><span /></i>
                  <span>{isZh ? item.labelZh : item.labelEn}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="toolbox-section is-cards">
            <div className="relation-canvas-label"><ListChecks size={15} /><span>{isZh ? '我的功能卡' : 'MY FUNCTION CARDS'}</span></div>
            <p>{isZh ? '把需要参与流程的卡片拖入画布。' : 'Drag the cards that belong in your system.'}</p>
            <div className="function-card-palette">
              {cards.map((card, index) => {
                const onCanvas = placedCardIds.includes(card.id);
                return (
                  <button
                    key={card.id}
                    type="button"
                    draggable
                    className={onCanvas ? 'is-on-canvas' : ''}
                    onDragStart={event => startPaletteDrag(event, { type: 'card', id: card.id })}
                    onClick={() => onCanvas ? setSelectedId(card.id) : placeCardOnCanvas(card.id)}
                  >
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <strong>{card.responsibility}</strong>
                    {onCanvas ? <Check size={13} /> : <Plus size={13} />}
                  </button>
                );
              })}
            </div>
          </section>

          {(selectedCard || selectedFlowNode) && (
            <section className="toolbox-selection">
              <div className="relation-canvas-label"><MousePointer2 size={15} /><span>{isZh ? '当前选中' : 'SELECTED'}</span></div>
              {selectedFlowNode ? (
                <label>
                  <span>{isZh ? '节点文字' : 'Node label'}</span>
                  <input value={selectedFlowNode.label} maxLength={28} onChange={event => updateFlowNode(selectedFlowNode.id, { label: event.target.value })} />
                </label>
              ) : (
                <div className="selected-card-summary">
                  <strong>{selectedCard?.responsibility}</strong>
                  <span>IN · {selectedCard?.input}</span>
                  <span>OUT · {selectedCard?.output}</span>
                </div>
              )}
              <div className="selected-edge-list">
                {selectedEdges.map(edge => (
                  <div key={edge.id}>
                    <span>{getNodeLabel(edge.sourceId)} → {getNodeLabel(edge.targetId)}</span>
                    <button type="button" aria-label={isZh ? '删除连线' : 'Delete connection'} onClick={() => removeDiagramEdge(edge.id)}><X size={12} /></button>
                  </div>
                ))}
                {selectedEdges.length === 0 && <small>{isZh ? '还没有与该节点相连的箭头' : 'No arrows connected yet'}</small>}
              </div>
              <button type="button" className="remove-canvas-node" onClick={() => removeNodeFromCanvas(selectedId, selectedFlowNode ? 'flow' : 'card')}>
                <Trash2 size={13} />{selectedFlowNode ? (isZh ? '删除图形' : 'Delete shape') : (isZh ? '移回素材区' : 'Return to palette')}
              </button>
            </section>
          )}

          <div className={`toolbox-notice ${connectMode ? 'is-connecting' : ''}`}>
            {connectMode ? <Link2 size={15} /> : <Move size={15} />}
            <span>{canvasNotice || (isZh ? '拖动素材到画布；需要连线时点击上方“连接节点”。' : 'Drag items to the canvas; use Connect nodes for arrows.')}</span>
          </div>
        </aside>
      </div>

      {topology.hasCycle && <div className="relation-cycle-warning"><GitBranch size={17} />{isZh ? '出现了循环依赖：A 等 B，B 又等 A。请取消其中一条关系。' : 'Circular dependency detected. Remove one of the links.'}</div>}

      <footer className="path-stage-footer">
        <button type="button" onClick={onBack}>{isZh ? '返回功能卡' : 'Back to functions'}</button>
        <span>{isZh ? '这里保留的是你的关系判断，不会自动改成教师答案' : 'Your relations are preserved; they are not replaced by the teacher answer.'}</span>
        <button type="button" className="is-primary" disabled={topology.hasCycle || orderedCards.length === 0} onClick={onContinue}>
          {isZh ? '生成实现路径' : 'Generate build route'}<ArrowRight size={17} />
        </button>
      </footer>
    </section>
  );
};
