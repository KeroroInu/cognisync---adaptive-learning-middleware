import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowRight,
  ArrowUp,
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
  readStoredList,
  readStoredObject,
  STUDENT_CANVAS_LAYOUT_VERSION,
  type StudentCanvasPosition,
  type StudentConnectorSide,
  type StudentDiagramEdge,
  type StudentPathPlan,
} from '../data/projectPath';
import type { StudentFunctionCard } from './ProjectFunctionStage';
import { ProjectMechanismStage } from './ProjectMechanismStage';
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
const CANVAS_PADDING = 20;
const CANVAS_WIDTH = 1600;
const CANVAS_HEIGHT = 720;
const MIN_CANVAS_ZOOM = .7;
const MAX_CANVAS_ZOOM = 1.4;
const CONNECTION_SNAP_HALO = 52;
const CONNECTOR_SIDES: StudentConnectorSide[] = ['top', 'right', 'bottom', 'left'];

interface DragState {
  nodeId: string;
  pointerId: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

interface ConnectionDragState {
  pointerId: number;
  sourceId: string;
  sourceAnchor: StudentConnectorSide;
  startClientX: number;
  startClientY: number;
  moved: boolean;
}

interface ConnectionSnapTarget {
  nodeId: string;
  anchor: StudentConnectorSide;
}

interface PaletteDragPayload {
  type: 'card';
  id: string;
}

const isCanvasPosition = (value: StudentCanvasPosition | undefined): value is StudentCanvasPosition => (
  Boolean(value) && Number.isFinite(value?.x) && Number.isFinite(value?.y)
);

const oppositeConnectorSide = (side: StudentConnectorSide): StudentConnectorSide => ({
  top: 'bottom',
  right: 'left',
  bottom: 'top',
  left: 'right',
})[side] as StudentConnectorSide;

const getConnectorPoint = (
  geometry: { x: number; y: number; width: number; height: number },
  side: StudentConnectorSide,
) => {
  if (side === 'top') return { x: geometry.x + geometry.width / 2, y: geometry.y, dx: 0, dy: -1 };
  if (side === 'bottom') return { x: geometry.x + geometry.width / 2, y: geometry.y + geometry.height, dx: 0, dy: 1 };
  if (side === 'left') return { x: geometry.x, y: geometry.y + geometry.height / 2, dx: -1, dy: 0 };
  return { x: geometry.x + geometry.width, y: geometry.y + geometry.height / 2, dx: 1, dy: 0 };
};

const getCardHandlePosition = (position: StudentCanvasPosition, side: StudentConnectorSide) => {
  if (side === 'top') return { left: position.x + CANVAS_NODE_WIDTH / 2 - 7, top: position.y - 7 };
  if (side === 'bottom') return { left: position.x + CANVAS_NODE_WIDTH / 2 - 7, top: position.y + CANVAS_NODE_HEIGHT - 7 };
  if (side === 'left') return { left: position.x - 7, top: position.y + CANVAS_NODE_HEIGHT / 2 - 7 };
  return { left: position.x + CANVAS_NODE_WIDTH - 7, top: position.y + CANVAS_NODE_HEIGHT / 2 - 7 };
};

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
  const validNodeIds = new Set(cardIds);
  const orderedCardIds = stored.orderedCardIds.filter(id => cardIds.has(id));
  cards.forEach(card => {
    if (!orderedCardIds.includes(card.id)) orderedCardIds.push(card.id);
  });
  const placedCardIds = stored.placedCardIds
    ? stored.placedCardIds.filter(id => cardIds.has(id))
    : orderedCardIds;
  const storedCardEdges = (stored.diagramEdges ?? [])
    .filter(edge => validNodeIds.has(edge.sourceId) && validNodeIds.has(edge.targetId) && edge.sourceId !== edge.targetId);
  const diagramEdges = storedCardEdges.length > 0
    ? storedCardEdges
    : prerequisitesToEdges(stored.prerequisites)
      .filter(edge => validNodeIds.has(edge.sourceId) && validNodeIds.has(edge.targetId) && edge.sourceId !== edge.targetId);

  return {
    ...stored,
    orderedCardIds,
    placedCardIds,
    flowNodes: [],
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

const ProjectSystemPathStage: React.FC<Props> = ({
  language,
  taskId,
  onBack,
  onContinue,
}) => {
  const isZh = language === 'zh';
  const functionKey = `cognisync:project-function-cards:v1:${taskId}`;
  const pathKey = `cognisync:project-path-plan:v1:${taskId}`;
  const [cards] = useState<StudentFunctionCard[]>(() => readStoredList(functionKey));
  const [plan, setPlan] = useState<StudentPathPlan>(() => {
    const initial = createInitialPathPlan(readStoredList<StudentFunctionCard>(functionKey));
    return mergePlanWithCards(readStoredObject(pathKey, initial), readStoredList(functionKey));
  });
  const [selectedId, setSelectedId] = useState(() => plan.placedCardIds?.[0] ?? '');
  const [selectedEdgeId, setSelectedEdgeId] = useState('');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [connectMode, setConnectMode] = useState(false);
  const [connectionSourceId, setConnectionSourceId] = useState<string | null>(null);
  const [connectionSourceAnchor, setConnectionSourceAnchor] = useState<StudentConnectorSide | null>(null);
  const [connectionPreview, setConnectionPreview] = useState<StudentCanvasPosition | null>(null);
  const [connectionTarget, setConnectionTarget] = useState<ConnectionSnapTarget | null>(null);
  const [canvasNotice, setCanvasNotice] = useState('');
  const [canvasZoom, setCanvasZoom] = useState(1);
  const canvasRef = useRef<HTMLDivElement>(null);
  const canvasScrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const connectionDragRef = useRef<ConnectionDragState | null>(null);
  const connectionTargetRef = useRef<ConnectionSnapTarget | null>(null);

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
  const diagramEdges = plan.diagramEdges ?? prerequisitesToEdges(plan.prerequisites);
  const topology = useMemo(() => buildTopologicalOrder(orderedCards, plan), [orderedCards, plan]);
  const implementationCards = useMemo(() => {
    const preferredIds = plan.orderedCardIds.filter(id => placedCardIds.includes(id));
    placedCardIds.forEach(id => {
      if (!preferredIds.includes(id)) preferredIds.push(id);
    });
    return preferredIds.map(id => cardsById.get(id)).filter((card): card is StudentFunctionCard => Boolean(card));
  }, [cardsById, placedCardIds, plan.orderedCardIds]);
  const routeIssues = useMemo(() => {
    const orderIndex = new Map(implementationCards.map((card, index) => [card.id, index]));
    return implementationCards.flatMap(card => (plan.prerequisites[card.id] ?? []).flatMap(dependencyId => {
      const dependencyIndex = orderIndex.get(dependencyId);
      const cardIndex = orderIndex.get(card.id);
      if (dependencyIndex === undefined || cardIndex === undefined || dependencyIndex < cardIndex) return [];
      return [{ cardId: card.id, dependencyId }];
    }));
  }, [implementationCards, plan.prerequisites]);
  const relationCount = diagramEdges.length;
  const canvasPositions = plan.canvasPositions ?? createDefaultCanvasPositions(cards);
  const canvasNodeIds = useMemo(() => new Set(placedCardIds), [placedCardIds]);
  const relationEdges = useMemo(
    () => diagramEdges.filter(edge => canvasNodeIds.has(edge.sourceId) && canvasNodeIds.has(edge.targetId)),
    [canvasNodeIds, diagramEdges],
  );
  const selectedEdge = relationEdges.find(edge => edge.id === selectedEdgeId);
  const selectedEdges = relationEdges.filter(edge => edge.sourceId === selectedId || edge.targetId === selectedId);

  const getNodeGeometry = (nodeId: string) => {
    const card = cardsById.get(nodeId);
    if (card && placedCardIds.includes(nodeId)) {
      const position = canvasPositions[nodeId] ?? { x: CANVAS_PADDING, y: CANVAS_PADDING };
      return { ...position, width: CANVAS_NODE_WIDTH, height: CANVAS_NODE_HEIGHT };
    }
    return undefined;
  };
  const getNodeLabel = (nodeId: string) => (
    cardsById.get(nodeId)?.responsibility
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

  const beginNodeDrag = (
    event: React.PointerEvent<HTMLElement>,
    nodeId: string,
    position: StudentCanvasPosition,
    size: { width: number; height: number },
  ) => {
    if (event.button !== 0 || !canvasRef.current || connectMode) return;
    if (!position) return;
    const bounds = canvasRef.current.getBoundingClientRect();
    dragRef.current = {
      nodeId,
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
    updateCanvasPosition(drag.nodeId, position);
  };

  const finishCardDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDraggingId(null);
  };

  const nudgeNode = (
    event: React.KeyboardEvent<HTMLElement>,
    nodeId: string,
    current: StudentCanvasPosition,
    size: { width: number; height: number },
  ) => {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      removeNodeFromCanvas(nodeId);
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
    updateCanvasPosition(nodeId, position);
  };

  const resetCanvasLayout = () => {
    setPlan(current => ({
      ...current,
      canvasPositions: createDefaultCanvasPositions(orderedCards),
      flowNodes: [],
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

  const startPaletteDrag = (event: React.DragEvent<HTMLElement>, payload: PaletteDragPayload) => {
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('application/x-cognisync-node', JSON.stringify(payload));
    event.dataTransfer.setData('text/plain', payload.id);
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
      }
    } catch {
      setCanvasNotice(isZh ? '没有识别到可放入的素材' : 'The dropped item could not be read');
    }
  };

  const addDiagramEdge = (
    sourceId: string,
    targetId: string,
    sourceAnchor?: StudentConnectorSide,
    targetAnchor?: StudentConnectorSide,
  ) => {
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
      const nextEdges = [...(current.diagramEdges ?? []), {
        id: edgeId,
        sourceId,
        targetId,
        sourceAnchor,
        targetAnchor: targetAnchor ?? (sourceAnchor ? oppositeConnectorSide(sourceAnchor) : undefined),
      }];
      const activeIds = current.placedCardIds ?? current.orderedCardIds;
      return {
        ...current,
        diagramEdges: nextEdges,
        prerequisites: derivePrerequisites(activeIds, nextEdges),
        confirmedAt: undefined,
      };
    });
    setSelectedEdgeId(edgeId);
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
    setSelectedEdgeId(current => current === edgeId ? '' : current);
  };

  const reverseDiagramEdge = (edge: StudentDiagramEdge) => {
    const remainingEdges = diagramEdges.filter(item => item.id !== edge.id);
    const nextId = makeEdgeId(edge.targetId, edge.sourceId);
    if (remainingEdges.some(item => item.id === nextId)) {
      setCanvasNotice(isZh ? '反向关系已经存在' : 'The reversed relation already exists');
      return;
    }
    if (createsDiagramCycle(remainingEdges, edge.targetId, edge.sourceId)) {
      setCanvasNotice(isZh ? '反转后会形成循环依赖，无法保存' : 'Reversing this relation would create a cycle');
      return;
    }
    setPlan(current => {
      const nextEdges = (current.diagramEdges ?? []).map(item => item.id === edge.id ? {
        ...item,
        id: nextId,
        sourceId: edge.targetId,
        targetId: edge.sourceId,
        sourceAnchor: edge.targetAnchor,
        targetAnchor: edge.sourceAnchor,
      } : item);
      const activeIds = current.placedCardIds ?? current.orderedCardIds;
      return {
        ...current,
        diagramEdges: nextEdges,
        prerequisites: derivePrerequisites(activeIds, nextEdges),
        confirmedAt: undefined,
      };
    });
    setSelectedEdgeId(nextId);
    setCanvasNotice(isZh ? '关系方向已反转' : 'Relation direction reversed');
  };

  const handleCanvasNodeClick = (nodeId: string) => {
    setSelectedId(nodeId);
    setSelectedEdgeId('');
    if (!connectMode) return;
    if (!connectionSourceId) {
      setConnectionSourceId(nodeId);
      setConnectionSourceAnchor(null);
      setCanvasNotice(isZh ? '已选起点，请点击要连接到的节点' : 'Start selected; choose the destination');
      return;
    }
    addDiagramEdge(connectionSourceId, nodeId, connectionSourceAnchor ?? undefined);
    setConnectionSourceId(null);
    setConnectionSourceAnchor(null);
  };

  const beginConnectionDrag = (event: React.PointerEvent<HTMLButtonElement>, nodeId: string, side: StudentConnectorSide) => {
    if (event.button !== 0 || !canvasRef.current) return;
    event.stopPropagation();
    event.preventDefault();
    const bounds = canvasRef.current.getBoundingClientRect();
    connectionDragRef.current = {
      pointerId: event.pointerId,
      sourceId: nodeId,
      sourceAnchor: side,
      startClientX: event.clientX,
      startClientY: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedId(nodeId);
    setSelectedEdgeId('');
    setConnectMode(true);
    setConnectionSourceId(nodeId);
    setConnectionSourceAnchor(side);
    setConnectionTarget(null);
    connectionTargetRef.current = null;
    setConnectionPreview({ x: (event.clientX - bounds.left) / canvasZoom, y: (event.clientY - bounds.top) / canvasZoom });
    setCanvasNotice(isZh ? '拖到另一张功能卡上松开' : 'Drag onto another function card and release');
  };

  const moveConnectionDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const current = connectionDragRef.current;
    const canvas = canvasRef.current;
    if (!current || current.pointerId !== event.pointerId || !canvas) return;
    if (Math.hypot(event.clientX - current.startClientX, event.clientY - current.startClientY) > 4) current.moved = true;
    const bounds = canvas.getBoundingClientRect();
    const pointer = {
      x: Math.max(0, Math.min(CANVAS_WIDTH, (event.clientX - bounds.left) / canvasZoom)),
      y: Math.max(0, Math.min(CANVAS_HEIGHT, (event.clientY - bounds.top) / canvasZoom)),
    };
    let nearest: { target: ConnectionSnapTarget; distance: number } | null = null;
    placedCardIds.forEach(nodeId => {
      if (nodeId === current.sourceId) return;
      const geometry = getNodeGeometry(nodeId);
      if (!geometry) return;
      const insideHalo = pointer.x >= geometry.x - CONNECTION_SNAP_HALO
        && pointer.x <= geometry.x + geometry.width + CONNECTION_SNAP_HALO
        && pointer.y >= geometry.y - CONNECTION_SNAP_HALO
        && pointer.y <= geometry.y + geometry.height + CONNECTION_SNAP_HALO;
      if (!insideHalo) return;
      CONNECTOR_SIDES.forEach(anchor => {
        const point = getConnectorPoint(geometry, anchor);
        const distance = Math.hypot(pointer.x - point.x, pointer.y - point.y);
        if (!nearest || distance < nearest.distance) nearest = { target: { nodeId, anchor }, distance };
      });
    });
    const nextTarget = nearest?.target ?? null;
    connectionTargetRef.current = nextTarget;
    setConnectionTarget(previous => (
      previous?.nodeId === nextTarget?.nodeId && previous?.anchor === nextTarget?.anchor ? previous : nextTarget
    ));
    setConnectionPreview(pointer);
  };

  const finishConnectionDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const current = connectionDragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const target = connectionTargetRef.current;
    connectionDragRef.current = null;
    connectionTargetRef.current = null;
    setConnectionPreview(null);
    setConnectionTarget(null);
    setConnectMode(false);
    setConnectionSourceId(null);
    setConnectionSourceAnchor(null);
    if (current.moved && target && target.nodeId !== current.sourceId) {
      addDiagramEdge(current.sourceId, target.nodeId, current.sourceAnchor, target.anchor);
      return;
    }
    setCanvasNotice(isZh ? '未连接；请按住圆点拖到另一张功能卡' : 'Not connected; drag the handle onto another card');
  };

  const cancelConnectionDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (connectionDragRef.current?.pointerId !== event.pointerId) return;
    connectionDragRef.current = null;
    connectionTargetRef.current = null;
    setConnectionPreview(null);
    setConnectionTarget(null);
    setConnectMode(false);
    setConnectionSourceId(null);
    setConnectionSourceAnchor(null);
  };

  const removeNodeFromCanvas = (nodeId: string) => {
    setPlan(current => {
      const nextEdges = (current.diagramEdges ?? []).filter(edge => edge.sourceId !== nodeId && edge.targetId !== nodeId);
      const nextPlacedIds = (current.placedCardIds ?? current.orderedCardIds).filter(id => id !== nodeId);
      return {
        ...current,
        placedCardIds: nextPlacedIds,
        diagramEdges: nextEdges,
        prerequisites: derivePrerequisites(nextPlacedIds, nextEdges),
        confirmedAt: undefined,
      };
    });
    setSelectedId('');
    if (selectedEdge && (selectedEdge.sourceId === nodeId || selectedEdge.targetId === nodeId)) setSelectedEdgeId('');
    setConnectionSourceId(source => source === nodeId ? null : source);
    if (connectionSourceId === nodeId) setConnectionSourceAnchor(null);
    setCanvasNotice(isZh ? '功能卡已移回右侧素材区' : 'Card returned to the palette');
  };

  const continueFromPlan = () => {
    setPlan(current => ({
      ...current,
      confirmedAt: new Date().toISOString(),
    }));
    onContinue();
  };

  const moveImplementationCard = (cardId: string, direction: -1 | 1) => {
    setPlan(current => {
      const activeIds = current.placedCardIds ?? current.orderedCardIds;
      const orderedIds = current.orderedCardIds.filter(id => activeIds.includes(id));
      activeIds.forEach(id => {
        if (!orderedIds.includes(id)) orderedIds.push(id);
      });
      const currentIndex = orderedIds.indexOf(cardId);
      const targetIndex = currentIndex + direction;
      if (currentIndex < 0 || targetIndex < 0 || targetIndex >= orderedIds.length) return current;
      const nextIds = [...orderedIds];
      [nextIds[currentIndex], nextIds[targetIndex]] = [nextIds[targetIndex], nextIds[currentIndex]];
      return { ...current, orderedCardIds: nextIds, confirmedAt: undefined };
    });
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

  return (
    <section className="project-path-stage is-model is-system-plan">
      <header className="path-stage-heading">
        <div>
          <span>04 / SYSTEM & BUILD ROUTE</span>
          <h3>{isZh ? '先连清系统如何协作，再排出自己的实现顺序' : 'Connect the system, then choose your build order'}</h3>
          <p>{isZh ? '画布表达功能之间的数据与前置关系；右侧顺序表达你准备先实现哪一张、后实现哪一张。' : 'The canvas shows dependencies; the list shows the order you will implement them.'}</p>
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
                className={connectMode && !connectionPreview ? 'is-active' : ''}
                onClick={() => {
                  setConnectMode(active => !active);
                  setConnectionSourceId(null);
                  setConnectionSourceAnchor(null);
                  setConnectionPreview(null);
                  setConnectionTarget(null);
                  connectionDragRef.current = null;
                  connectionTargetRef.current = null;
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
                  const deltaX = target.x + target.width / 2 - source.x - source.width / 2;
                  const deltaY = target.y + target.height / 2 - source.y - source.height / 2;
                  const fallbackSourceSide: StudentConnectorSide = Math.abs(deltaX) >= Math.abs(deltaY)
                    ? (deltaX >= 0 ? 'right' : 'left')
                    : (deltaY >= 0 ? 'bottom' : 'top');
                  const sourcePoint = getConnectorPoint(source, edge.sourceAnchor ?? fallbackSourceSide);
                  const targetPoint = getConnectorPoint(target, edge.targetAnchor ?? oppositeConnectorSide(edge.sourceAnchor ?? fallbackSourceSide));
                  const distance = Math.hypot(targetPoint.x - sourcePoint.x, targetPoint.y - sourcePoint.y);
                  const bend = Math.max(52, distance * .32);
                  const path = `M ${sourcePoint.x} ${sourcePoint.y} C ${sourcePoint.x + sourcePoint.dx * bend} ${sourcePoint.y + sourcePoint.dy * bend}, ${targetPoint.x + targetPoint.dx * bend} ${targetPoint.y + targetPoint.dy * bend}, ${targetPoint.x} ${targetPoint.y}`;
                  const selected = selectedEdgeId === edge.id || selectedId === edge.targetId || selectedId === edge.sourceId;
                  const midpoint = { x: (sourcePoint.x + targetPoint.x) / 2, y: (sourcePoint.y + targetPoint.y) / 2 };
                  const selectEdge = () => {
                    setSelectedId('');
                    setSelectedEdgeId(edge.id);
                  };
                  return (
                    <React.Fragment key={edge.id}>
                      <path d={path} className={`relation-edge-path ${selected ? 'is-selected' : ''}`} markerEnd="url(#relation-arrow-head)" />
                      <path
                        d={path}
                        className="relation-edge-hit"
                        role="button"
                        tabIndex={0}
                        aria-label={`${isZh ? '功能关系' : 'Function relation'}: ${getNodeLabel(edge.sourceId)} → ${getNodeLabel(edge.targetId)}`}
                        onClick={event => {
                          event.stopPropagation();
                          selectEdge();
                        }}
                        onKeyDown={event => {
                          if (event.key === 'Delete' || event.key === 'Backspace') {
                            event.preventDefault();
                            removeDiagramEdge(edge.id);
                          }
                        }}
                      />
                      <circle
                        cx={midpoint.x}
                        cy={midpoint.y}
                        r={7}
                        className={`relation-edge-selector ${selectedEdgeId === edge.id ? 'is-selected' : ''}`}
                        role="button"
                        tabIndex={0}
                        aria-label={`${isZh ? '编辑功能关系' : 'Edit relation'}: ${getNodeLabel(edge.sourceId)} → ${getNodeLabel(edge.targetId)}`}
                        onClick={event => { event.stopPropagation(); selectEdge(); }}
                        onKeyDown={event => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            selectEdge();
                          }
                          if (event.key === 'Delete' || event.key === 'Backspace') {
                            event.preventDefault();
                            removeDiagramEdge(edge.id);
                          }
                        }}
                      />
                    </React.Fragment>
                  );
                })}
                {connectionPreview && connectionSourceId && connectionSourceAnchor ? (() => {
                  const source = getNodeGeometry(connectionSourceId);
                  if (!source) return null;
                  const sourcePoint = getConnectorPoint(source, connectionSourceAnchor);
                  const targetGeometry = connectionTarget ? getNodeGeometry(connectionTarget.nodeId) : undefined;
                  const targetPoint = targetGeometry && connectionTarget
                    ? getConnectorPoint(targetGeometry, connectionTarget.anchor)
                    : { ...connectionPreview, dx: 0, dy: 0 };
                  const distance = Math.hypot(targetPoint.x - sourcePoint.x, targetPoint.y - sourcePoint.y);
                  const bend = Math.max(46, distance * .28);
                  const previewPath = `M ${sourcePoint.x} ${sourcePoint.y} C ${sourcePoint.x + sourcePoint.dx * bend} ${sourcePoint.y + sourcePoint.dy * bend}, ${targetPoint.x + targetPoint.dx * bend} ${targetPoint.y + targetPoint.dy * bend}, ${targetPoint.x} ${targetPoint.y}`;
                  return <path d={previewPath} className="relation-connection-preview" markerEnd="url(#relation-arrow-head)" />;
                })() : null}
              </svg>
              {orderedCards.map((card, index) => {
                const dependencies = plan.prerequisites[card.id] ?? [];
                const selected = selectedCard?.id === card.id;
                const position = canvasPositions[card.id] ?? { x: CANVAS_PADDING, y: CANVAS_PADDING };
                return (
                  <React.Fragment key={card.id}>
                    <article
                      className={`relation-node ${selected ? 'is-selected' : ''} ${draggingId === card.id ? 'is-dragging' : ''} ${connectionTarget?.nodeId === card.id ? 'is-connection-target' : ''}`}
                      style={{ left: position.x, top: position.y }}
                      role="button"
                      tabIndex={0}
                      data-relation-node-id={card.id}
                      aria-label={`${isZh ? '功能卡' : 'Function card'} ${index + 1}: ${card.responsibility}`}
                      onClick={() => handleCanvasNodeClick(card.id)}
                      onKeyDown={event => nudgeNode(event, card.id, position, { width: CANVAS_NODE_WIDTH, height: CANVAS_NODE_HEIGHT })}
                      onPointerDown={event => beginNodeDrag(event, card.id, position, { width: CANVAS_NODE_WIDTH, height: CANVAS_NODE_HEIGHT })}
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
                    {(selected || connectionTarget?.nodeId === card.id) ? CONNECTOR_SIDES.map(side => (
                      <button
                        key={side}
                        type="button"
                        className={`relation-connection-handle is-${side} ${connectionTarget?.nodeId === card.id ? 'is-target-handle' : ''} ${connectionTarget?.nodeId === card.id && connectionTarget.anchor === side ? 'is-snap-active' : ''}`}
                        style={getCardHandlePosition(position, side)}
                        aria-label={`${isZh ? '从此方向拖出连线' : 'Drag a connection from'} ${side}: ${card.responsibility}`}
                        title={isZh ? '按住并拖到另一张功能卡' : 'Hold and drag onto another function card'}
                        onPointerDown={event => {
                          if (connectionTarget?.nodeId === card.id) {
                            event.preventDefault();
                            return;
                          }
                          beginConnectionDrag(event, card.id, side);
                        }}
                        onPointerMove={moveConnectionDrag}
                        onPointerUp={finishConnectionDrag}
                        onPointerCancel={cancelConnectionDrag}
                      />
                    )) : null}
                  </React.Fragment>
                );
              })}
              {orderedCards.length === 0 && (
                <div className="relation-board-empty">
                  <MousePointer2 size={28} />
                  <strong>{isZh ? '从右侧放入需要参与项目的功能卡' : 'Add the function cards used by the project'}</strong>
                  <span>{isZh ? '画布只表达功能之间的数据和前置关系。' : 'This canvas only expresses dependencies between functions.'}</span>
                </div>
              )}
              </div>
            </div>
          </div>
        </section>

        <aside className="relation-toolbox">
          {selectedEdge && (
            <section className="toolbox-selection is-edge-selection">
              <div className="relation-canvas-label"><Link2 size={15} /><span>{isZh ? '当前关系' : 'SELECTED RELATION'}</span></div>
              <strong>{getNodeLabel(selectedEdge.sourceId)} → {getNodeLabel(selectedEdge.targetId)}</strong>
              <div className="selected-edge-actions">
                <button type="button" onClick={() => reverseDiagramEdge(selectedEdge)}><ArrowLeftRight size={14} />{isZh ? '反转方向' : 'Reverse'}</button>
                <button type="button" className="is-danger" onClick={() => removeDiagramEdge(selectedEdge.id)}><Trash2 size={14} />{isZh ? '删除连线' : 'Delete'}</button>
              </div>
            </section>
          )}

          <section className="toolbox-section">
            <div className="relation-canvas-label"><Route size={15} /><span>{isZh ? '我的实现顺序' : 'MY BUILD ORDER'}</span></div>
            <p>{isZh ? '这不是游戏运行顺序，而是你准备逐张编写和验证功能的顺序。' : 'This is your coding order, not the runtime sequence.'}</p>
            <div className="implementation-order-list">
              {implementationCards.map((card, index) => (
                <article key={card.id} className={routeIssues.some(issue => issue.cardId === card.id) ? 'has-issue' : ''}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <strong>{card.responsibility}</strong>
                  <div>
                    <button type="button" aria-label={`${isZh ? '提前实现' : 'Move earlier'}: ${card.responsibility}`} disabled={index === 0} onClick={() => moveImplementationCard(card.id, -1)}><ArrowUp size={13} /></button>
                    <button type="button" aria-label={`${isZh ? '稍后实现' : 'Move later'}: ${card.responsibility}`} disabled={index === implementationCards.length - 1} onClick={() => moveImplementationCard(card.id, 1)}><ArrowDown size={13} /></button>
                  </div>
                </article>
              ))}
            </div>
            {routeIssues.length > 0 ? <small className="implementation-order-warning">{isZh ? '有功能排在它所依赖的结果之前，请调整右侧顺序。' : 'A function appears before one of its dependencies.'}</small> : null}
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

          {selectedCard && (
            <section className="toolbox-selection">
              <div className="relation-canvas-label"><MousePointer2 size={15} /><span>{isZh ? '当前选中' : 'SELECTED'}</span></div>
              <div className="selected-card-summary">
                <strong>{selectedCard.responsibility}</strong>
                <span>IN · {selectedCard.input}</span>
                <span>OUT · {selectedCard.output}</span>
              </div>
              <div className="selected-edge-list">
                {selectedEdges.map(edge => (
                  <div key={edge.id}>
                    <span>{getNodeLabel(edge.sourceId)} → {getNodeLabel(edge.targetId)}</span>
                    <button type="button" aria-label={isZh ? '删除连线' : 'Delete connection'} onClick={() => removeDiagramEdge(edge.id)}><X size={12} /></button>
                  </div>
                ))}
                {selectedEdges.length === 0 && <small>{isZh ? '还没有与该节点相连的箭头' : 'No arrows connected yet'}</small>}
              </div>
              <button type="button" className="remove-canvas-node" onClick={() => removeNodeFromCanvas(selectedId)}>
                <Trash2 size={13} />{isZh ? '移回素材区' : 'Return to palette'}
              </button>
            </section>
          )}

          <div className={`toolbox-notice ${connectMode ? 'is-connecting' : ''}`}>
            {connectMode ? <Link2 size={15} /> : <Move size={15} />}
            <span>{canvasNotice || (isZh ? '拖功能卡本体可移动；按住蓝色圆点拖出关系；点击线中间圆点可编辑。' : 'Drag cards to move them; drag a blue handle to connect; select the midpoint to edit a relation.')}</span>
          </div>
        </aside>
      </div>

      {topology.hasCycle && <div className="relation-cycle-warning"><GitBranch size={17} />{isZh ? '出现了循环依赖：A 等 B，B 又等 A。请取消其中一条关系。' : 'Circular dependency detected. Remove one of the links.'}</div>}

      <footer className="path-stage-footer">
        <button type="button" onClick={onBack}>{isZh ? '返回功能流程' : 'Back to function flows'}</button>
        <span>{routeIssues.length > 0
          ? (isZh ? '实现顺序与功能依赖冲突，请先调整右侧顺序' : 'Build order conflicts with dependencies.')
          : (isZh ? '缺失功能会在后续综合运行中表现为可观察的问题' : 'Missing functions become observable problems later.')}</span>
        <button type="button" className="is-primary" disabled={topology.hasCycle || orderedCards.length === 0 || routeIssues.length > 0} onClick={continueFromPlan}>
          {isZh ? '按此路径开始建构' : 'Build this route'}<ArrowRight size={17} />
        </button>
      </footer>
    </section>
  );
};

export const ProjectPathStage: React.FC<Props> = props => (
  props.stage === 'model'
    ? <ProjectMechanismStage language={props.language} taskId={props.taskId} onBack={props.onBack} onContinue={props.onContinue} />
    : <ProjectSystemPathStage {...props} />
);
