import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight,
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
  Trash2,
  X,
} from 'lucide-react';
import type { Language } from '../types';
import {
  createInitialPathPlan,
  readStoredList,
  readStoredObject,
  type StudentCanvasPosition,
  type StudentConnectorSide,
  type StudentDiagramEdge,
  type StudentFlowNode,
  type StudentFlowNodeKind,
  type StudentFunctionMechanism,
  type StudentPathPlan,
} from '../data/projectPath';
import type { StudentFunctionCard } from './ProjectFunctionStage';
import './ProjectMechanismStage.css';

interface Props {
  language: Language;
  taskId: string;
  onBack: () => void;
  onContinue: () => void;
}

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

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 620;
const CANVAS_PADDING = 24;
const FLOW_NODE_WIDTH = 176;
const FLOW_NODE_HEIGHT = 78;
const DECISION_NODE_SIZE = 118;
const MIN_ZOOM = .7;
const MAX_ZOOM = 1.4;
const CONNECTION_SNAP_HALO = 48;
const EMPTY_MECHANISM: StudentFunctionMechanism = { flowNodes: [], diagramEdges: [] };
const CONNECTOR_SIDES: StudentConnectorSide[] = ['top', 'right', 'bottom', 'left'];

const FLOW_NODE_LIBRARY: Array<{ kind: StudentFlowNodeKind; labelZh: string; labelEn: string }> = [
  { kind: 'start', labelZh: '开始', labelEn: 'Start' },
  { kind: 'process', labelZh: '处理步骤', labelEn: 'Process' },
  { kind: 'decision', labelZh: '条件成立？', labelEn: 'Decision?' },
  { kind: 'input-output', labelZh: '输入 / 输出', labelEn: 'Input / output' },
  { kind: 'end', labelZh: '结束', labelEn: 'End' },
];

const getFlowNodeSize = (kind: StudentFlowNodeKind) => (
  kind === 'decision'
    ? { width: DECISION_NODE_SIZE, height: DECISION_NODE_SIZE }
    : { width: FLOW_NODE_WIDTH, height: FLOW_NODE_HEIGHT }
);

const makeEdgeId = (sourceId: string, targetId: string) => `${sourceId}->${targetId}`;

const oppositeSide = (side: StudentConnectorSide): StudentConnectorSide => ({
  top: 'bottom',
  right: 'left',
  bottom: 'top',
  left: 'right',
})[side] as StudentConnectorSide;

const getAnchorPoint = (
  position: StudentCanvasPosition,
  size: { width: number; height: number },
  side: StudentConnectorSide,
) => {
  if (side === 'top') return { x: position.x + size.width / 2, y: position.y, dx: 0, dy: -1 };
  if (side === 'bottom') return { x: position.x + size.width / 2, y: position.y + size.height, dx: 0, dy: 1 };
  if (side === 'left') return { x: position.x, y: position.y + size.height / 2, dx: -1, dy: 0 };
  return { x: position.x + size.width, y: position.y + size.height / 2, dx: 1, dy: 0 };
};

const getHandlePosition = (
  position: StudentCanvasPosition,
  size: { width: number; height: number },
  side: StudentConnectorSide,
) => {
  if (side === 'top') return { left: position.x + size.width / 2 - 7, top: position.y - 7 };
  if (side === 'bottom') return { left: position.x + size.width / 2 - 7, top: position.y + size.height - 7 };
  if (side === 'left') return { left: position.x - 7, top: position.y + size.height / 2 - 7 };
  return { left: position.x + size.width - 7, top: position.y + size.height / 2 - 7 };
};

const diagramIsReady = (diagram: StudentFunctionMechanism | undefined) => Boolean(
  diagram?.confirmedAt && diagram.flowNodes.length >= 3 && diagram.diagramEdges.length >= 2,
);

export const ProjectMechanismStage: React.FC<Props> = ({
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
    const stored = readStoredObject(pathKey, initial);
    return { ...initial, ...stored, functionMechanisms: stored.functionMechanisms ?? {} };
  });
  const [activeCardId, setActiveCardId] = useState(() => plan.orderedCardIds[0] ?? cards[0]?.id ?? '');
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [selectedEdgeId, setSelectedEdgeId] = useState('');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [connectMode, setConnectMode] = useState(false);
  const [connectionSourceId, setConnectionSourceId] = useState<string | null>(null);
  const [connectionSourceAnchor, setConnectionSourceAnchor] = useState<StudentConnectorSide | null>(null);
  const [connectionPreview, setConnectionPreview] = useState<StudentCanvasPosition | null>(null);
  const [connectionTarget, setConnectionTarget] = useState<ConnectionSnapTarget | null>(null);
  const [notice, setNotice] = useState('');
  const [zoom, setZoom] = useState(1);
  const canvasRef = useRef<HTMLDivElement>(null);
  const canvasScrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const connectionDragRef = useRef<ConnectionDragState | null>(null);
  const connectionTargetRef = useRef<ConnectionSnapTarget | null>(null);

  useEffect(() => {
    if (draggingId) return;
    window.localStorage.setItem(pathKey, JSON.stringify(plan));
  }, [draggingId, pathKey, plan]);

  const activeCard = cards.find(card => card.id === activeCardId) ?? cards[0];
  const diagram = activeCard ? plan.functionMechanisms?.[activeCard.id] ?? EMPTY_MECHANISM : EMPTY_MECHANISM;
  const selectedNode = diagram.flowNodes.find(node => node.id === selectedNodeId);
  const selectedEdge = diagram.diagramEdges.find(edge => edge.id === selectedEdgeId);
  const selectedEdges = diagram.diagramEdges.filter(edge => edge.sourceId === selectedNodeId || edge.targetId === selectedNodeId);
  const completedCount = useMemo(
    () => cards.reduce((count, card) => count + (diagramIsReady(plan.functionMechanisms?.[card.id]) ? 1 : 0), 0),
    [cards, plan.functionMechanisms],
  );
  const allCompleted = cards.length > 0 && completedCount === cards.length;

  const updateDiagram = (updater: (current: StudentFunctionMechanism) => StudentFunctionMechanism) => {
    if (!activeCard) return;
    setPlan(current => {
      const currentDiagram = current.functionMechanisms?.[activeCard.id] ?? EMPTY_MECHANISM;
      return {
        ...current,
        functionMechanisms: {
          ...current.functionMechanisms,
          [activeCard.id]: updater(currentDiagram),
        },
        confirmedAt: undefined,
      };
    });
  };

  const updateNode = (nodeId: string, patch: Partial<StudentFlowNode>) => {
    updateDiagram(current => ({
      ...current,
      confirmedAt: undefined,
      flowNodes: current.flowNodes.map(node => node.id === nodeId ? { ...node, ...patch } : node),
    }));
  };

  const getCenteredPosition = (size: { width: number; height: number }) => {
    const scroll = canvasScrollRef.current;
    const canvas = canvasRef.current;
    if (!scroll || !canvas) return { x: CANVAS_PADDING, y: CANVAS_PADDING };
    return {
      x: Math.round(Math.max(CANVAS_PADDING, Math.min(canvas.clientWidth - size.width - CANVAS_PADDING, scroll.scrollLeft / zoom + scroll.clientWidth / (2 * zoom) - size.width / 2))),
      y: Math.round(Math.max(CANVAS_PADDING, Math.min(canvas.clientHeight - size.height - CANVAS_PADDING, scroll.scrollTop / zoom + scroll.clientHeight / (2 * zoom) - size.height / 2))),
    };
  };

  const addNode = (
    kind: StudentFlowNodeKind,
    label?: string,
    position = getCenteredPosition(getFlowNodeSize(kind)),
  ) => {
    const definition = FLOW_NODE_LIBRARY.find(item => item.kind === kind) ?? FLOW_NODE_LIBRARY[1];
    const node: StudentFlowNode = {
      id: `mechanism-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      kind,
      label: label ?? (isZh ? definition.labelZh : definition.labelEn),
      position,
    };
    updateDiagram(current => ({ ...current, confirmedAt: undefined, flowNodes: [...current.flowNodes, node] }));
    setSelectedNodeId(node.id);
    setNotice(isZh ? '流程元素已放入画布，可以在右侧修改文字' : 'Shape added; edit its label in the panel');
  };

  const beginNodeDrag = (
    event: React.PointerEvent<HTMLElement>,
    node: StudentFlowNode,
  ) => {
    if (event.button !== 0 || !canvasRef.current || connectMode) return;
    const size = getFlowNodeSize(node.kind);
    const bounds = canvasRef.current.getBoundingClientRect();
    dragRef.current = {
      nodeId: node.id,
      pointerId: event.pointerId,
      offsetX: (event.clientX - bounds.left) / zoom - node.position.x,
      offsetY: (event.clientY - bounds.top) / zoom - node.position.y,
      ...size,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    setSelectedNodeId(node.id);
    setDraggingId(node.id);
  };

  const moveDraggedNode = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const canvas = canvasRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const maxX = Math.max(CANVAS_PADDING, canvas.clientWidth - drag.width - CANVAS_PADDING);
    const maxY = Math.max(CANVAS_PADDING, canvas.clientHeight - drag.height - CANVAS_PADDING);
    updateNode(drag.nodeId, {
      position: {
        x: Math.round(Math.min(maxX, Math.max(CANVAS_PADDING, (event.clientX - bounds.left) / zoom - drag.offsetX))),
        y: Math.round(Math.min(maxY, Math.max(CANVAS_PADDING, (event.clientY - bounds.top) / zoom - drag.offsetY))),
      },
    });
  };

  const finishNodeDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDraggingId(null);
  };

  const removeNode = (nodeId: string) => {
    updateDiagram(current => ({
      ...current,
      confirmedAt: undefined,
      flowNodes: current.flowNodes.filter(node => node.id !== nodeId),
      diagramEdges: current.diagramEdges.filter(edge => edge.sourceId !== nodeId && edge.targetId !== nodeId),
    }));
    setSelectedNodeId('');
    if (selectedEdge && (selectedEdge.sourceId === nodeId || selectedEdge.targetId === nodeId)) setSelectedEdgeId('');
    setConnectionSourceId(source => source === nodeId ? null : source);
    if (connectionSourceId === nodeId) setConnectionSourceAnchor(null);
    setNotice(isZh ? '流程元素已删除' : 'Flow element deleted');
  };

  const handleNodeKeyDown = (event: React.KeyboardEvent<HTMLElement>, node: StudentFlowNode) => {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      removeNode(node.id);
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
    const size = getFlowNodeSize(node.kind);
    updateNode(node.id, {
      position: {
        x: Math.max(CANVAS_PADDING, Math.min(CANVAS_WIDTH - size.width - CANVAS_PADDING, node.position.x + delta.x)),
        y: Math.max(CANVAS_PADDING, Math.min(CANVAS_HEIGHT - size.height - CANVAS_PADDING, node.position.y + delta.y)),
      },
    });
  };

  const addEdge = (
    sourceId: string,
    targetId: string,
    sourceAnchor?: StudentConnectorSide,
    targetAnchor?: StudentConnectorSide,
  ) => {
    if (sourceId === targetId) return;
    const id = makeEdgeId(sourceId, targetId);
    if (diagram.diagramEdges.some(edge => edge.id === id)) {
      setNotice(isZh ? '这条箭头已经存在' : 'This arrow already exists');
      return;
    }
    updateDiagram(current => ({
      ...current,
      confirmedAt: undefined,
      diagramEdges: [...current.diagramEdges, {
        id,
        sourceId,
        targetId,
        sourceAnchor,
        targetAnchor: targetAnchor ?? (sourceAnchor ? oppositeSide(sourceAnchor) : undefined),
      }],
    }));
    setSelectedEdgeId(id);
    setNotice(isZh ? '箭头已建立' : 'Arrow created');
  };

  const handleNodeClick = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    setSelectedEdgeId('');
    if (!connectMode) return;
    if (!connectionSourceId) {
      setConnectionSourceId(nodeId);
      setConnectionSourceAnchor(null);
      setNotice(isZh ? '已选起点，请点击下一个流程元素' : 'Start selected; choose the next element');
      return;
    }
    addEdge(connectionSourceId, nodeId, connectionSourceAnchor ?? undefined);
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
    setSelectedNodeId(nodeId);
    setSelectedEdgeId('');
    setConnectMode(true);
    setConnectionSourceId(nodeId);
    setConnectionSourceAnchor(side);
    setConnectionTarget(null);
    connectionTargetRef.current = null;
    setConnectionPreview({ x: (event.clientX - bounds.left) / zoom, y: (event.clientY - bounds.top) / zoom });
    setNotice(isZh ? '拖到另一个流程元素上松开' : 'Drag onto another flow element and release');
  };

  const moveConnectionDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const current = connectionDragRef.current;
    const canvas = canvasRef.current;
    if (!current || current.pointerId !== event.pointerId || !canvas) return;
    if (Math.hypot(event.clientX - current.startClientX, event.clientY - current.startClientY) > 4) current.moved = true;
    const bounds = canvas.getBoundingClientRect();
    const pointer = {
      x: Math.max(0, Math.min(CANVAS_WIDTH, (event.clientX - bounds.left) / zoom)),
      y: Math.max(0, Math.min(CANVAS_HEIGHT, (event.clientY - bounds.top) / zoom)),
    };
    let nearest: { target: ConnectionSnapTarget; distance: number } | null = null;
    diagram.flowNodes.forEach(node => {
      if (node.id === current.sourceId) return;
      const size = getFlowNodeSize(node.kind);
      const insideHalo = pointer.x >= node.position.x - CONNECTION_SNAP_HALO
        && pointer.x <= node.position.x + size.width + CONNECTION_SNAP_HALO
        && pointer.y >= node.position.y - CONNECTION_SNAP_HALO
        && pointer.y <= node.position.y + size.height + CONNECTION_SNAP_HALO;
      if (!insideHalo) return;
      CONNECTOR_SIDES.forEach(anchor => {
        const point = getAnchorPoint(node.position, size, anchor);
        const distance = Math.hypot(pointer.x - point.x, pointer.y - point.y);
        if (!nearest || distance < nearest.distance) nearest = { target: { nodeId: node.id, anchor }, distance };
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
      addEdge(current.sourceId, target.nodeId, current.sourceAnchor, target.anchor);
      return;
    }
    setNotice(isZh ? '未连接；请按住圆点拖到另一个图形' : 'Not connected; drag the handle onto another shape');
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

  const removeEdge = (edgeId: string) => {
    updateDiagram(current => ({
      ...current,
      confirmedAt: undefined,
      diagramEdges: current.diagramEdges.filter(edge => edge.id !== edgeId),
    }));
    setSelectedEdgeId(current => current === edgeId ? '' : current);
  };

  const reverseEdge = (edge: StudentDiagramEdge) => {
    const nextId = makeEdgeId(edge.targetId, edge.sourceId);
    if (diagram.diagramEdges.some(item => item.id === nextId && item.id !== edge.id)) {
      setNotice(isZh ? '反向箭头已经存在' : 'The reversed arrow already exists');
      return;
    }
    updateDiagram(current => ({
      ...current,
      confirmedAt: undefined,
      diagramEdges: current.diagramEdges.map(item => item.id === edge.id ? {
        ...item,
        id: nextId,
        sourceId: edge.targetId,
        targetId: edge.sourceId,
        sourceAnchor: edge.targetAnchor,
        targetAnchor: edge.sourceAnchor,
      } : item),
    }));
    setSelectedEdgeId(nextId);
    setNotice(isZh ? '箭头方向已反转' : 'Arrow direction reversed');
  };

  const resetLayout = () => {
    updateDiagram(current => ({
      ...current,
      confirmedAt: undefined,
      flowNodes: current.flowNodes.map((node, index) => ({
        ...node,
        position: {
          x: 70 + (index % 5) * 225,
          y: 80 + Math.floor(index / 5) * 220,
        },
      })),
    }));
  };

  const startPaletteDrag = (event: React.DragEvent<HTMLElement>, kind: StudentFlowNodeKind) => {
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('application/x-cognisync-flow-shape', kind);
  };

  const dropPaletteNode = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const kind = event.dataTransfer.getData('application/x-cognisync-flow-shape') as StudentFlowNodeKind;
    const canvas = canvasRef.current;
    if (!kind || !canvas || !FLOW_NODE_LIBRARY.some(item => item.kind === kind)) return;
    const size = getFlowNodeSize(kind);
    const bounds = canvas.getBoundingClientRect();
    addNode(kind, undefined, {
      x: Math.round(Math.max(CANVAS_PADDING, Math.min(canvas.clientWidth - size.width - CANVAS_PADDING, (event.clientX - bounds.left) / zoom - size.width / 2))),
      y: Math.round(Math.max(CANVAS_PADDING, Math.min(canvas.clientHeight - size.height - CANVAS_PADDING, (event.clientY - bounds.top) / zoom - size.height / 2))),
    });
  };

  const confirmDiagram = () => {
    if (!activeCard || diagram.flowNodes.length < 3 || diagram.diagramEdges.length < 2) return;
    updateDiagram(current => ({ ...current, confirmedAt: new Date().toISOString() }));
    setNotice(isZh ? '这张功能卡的实现流程已记录' : 'This function flow has been recorded');
  };

  if (cards.length === 0) {
    return (
      <section className="project-mechanism-stage is-empty">
        <GitBranch size={34} />
        <h3>{isZh ? '还没有可以分析的功能卡' : 'No function cards to analyse yet'}</h3>
        <p>{isZh ? '先完成“拆功能”，再为每张功能卡画出内部实现流程。' : 'Decompose the project before drawing each function flow.'}</p>
        <button type="button" onClick={onBack}>{isZh ? '返回功能拆解' : 'Back to functions'}</button>
      </section>
    );
  }

  return (
    <section className="project-mechanism-stage">
      <header className="mechanism-stage-heading">
        <div>
          <span>03 / FUNCTION MECHANISM</span>
          <h3>{isZh ? '选择一张功能卡，把它内部如何实现画出来' : 'Choose a function and draw how it works inside'}</h3>
          <p>{isZh ? '这里只思考单个功能的输入、处理、判断与输出；功能卡之间的先后关系留到下一阶段。' : 'Focus on one function’s input, process, decisions and output. Connect functions in the next stage.'}</p>
        </div>
        <div className={`mechanism-progress ${allCompleted ? 'is-complete' : ''}`}>
          {allCompleted ? <Check size={18} /> : <CircleDot size={18} />}
          <span>{completedCount}/{cards.length} {isZh ? '张已形成流程' : 'flows recorded'}</span>
        </div>
      </header>

      <div className="mechanism-workspace">
        <aside className="mechanism-card-rail">
          <div className="mechanism-section-label"><ListChecks size={15} /><span>{isZh ? '选择功能卡' : 'CHOOSE A FUNCTION'}</span></div>
          <p>{isZh ? '一次只处理一张，避免把项目层关系混进函数内部。' : 'Work on one card at a time.'}</p>
          <div className="mechanism-card-list">
            {cards.map((card, index) => {
              const completed = diagramIsReady(plan.functionMechanisms?.[card.id]);
              return (
                <button
                  key={card.id}
                  type="button"
                  className={`${activeCard?.id === card.id ? 'is-active' : ''} ${completed ? 'is-complete' : ''}`}
                  onClick={() => {
                    setActiveCardId(card.id);
                    setSelectedNodeId('');
                    setSelectedEdgeId('');
                    setConnectionSourceId(null);
                    setConnectionSourceAnchor(null);
                    setConnectionPreview(null);
                    setConnectionTarget(null);
                    connectionDragRef.current = null;
                    connectionTargetRef.current = null;
                    setConnectMode(false);
                    setNotice('');
                  }}
                >
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <strong>{card.responsibility}</strong>
                  <i>{completed ? <Check size={13} /> : <CircleDot size={13} />}</i>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="mechanism-canvas">
          <header className="mechanism-canvas-toolbar">
            <div className="mechanism-section-label"><GitBranch size={15} /><span>{isZh ? '本卡实现流程' : 'FUNCTION FLOW'}</span></div>
            <div>
              <div className="mechanism-zoom-controls" aria-label={isZh ? '画板缩放' : 'Canvas zoom'}>
                <button type="button" aria-label={isZh ? '缩小画板' : 'Zoom out'} disabled={zoom <= MIN_ZOOM} onClick={() => setZoom(value => Math.max(MIN_ZOOM, Math.round((value - .1) * 10) / 10))}><Minus size={13} /></button>
                <span>{Math.round(zoom * 100)}%</span>
                <button type="button" aria-label={isZh ? '放大画板' : 'Zoom in'} disabled={zoom >= MAX_ZOOM} onClick={() => setZoom(value => Math.min(MAX_ZOOM, Math.round((value + .1) * 10) / 10))}><Plus size={13} /></button>
              </div>
              <button type="button" className={connectMode && !connectionPreview ? 'is-active' : ''} onClick={() => { setConnectMode(value => !value); setConnectionSourceId(null); setConnectionSourceAnchor(null); setConnectionPreview(null); setConnectionTarget(null); connectionDragRef.current = null; connectionTargetRef.current = null; }}>
                {connectMode ? <X size={13} /> : <Link2 size={13} />}{connectMode ? (isZh ? '退出连线' : 'Exit connect') : (isZh ? '连接流程' : 'Connect')}
              </button>
              <button type="button" onClick={resetLayout}><RotateCcw size={13} />{isZh ? '整理' : 'Arrange'}</button>
            </div>
          </header>

          <div ref={canvasScrollRef} className="mechanism-board-scroll">
            <div className="mechanism-board-zoom-shell" style={{ width: CANVAS_WIDTH * zoom, height: CANVAS_HEIGHT * zoom }}>
              <div
                ref={canvasRef}
                className={`mechanism-board ${connectMode ? 'is-connecting' : ''}`}
                style={{ transform: `scale(${zoom})` }}
                onPointerMove={moveDraggedNode}
                onPointerUp={finishNodeDrag}
                onPointerCancel={finishNodeDrag}
                onDragOver={event => event.preventDefault()}
                onDrop={dropPaletteNode}
              >
                <svg className="mechanism-wire-layer" aria-hidden="true">
                  <defs>
                    <marker id="mechanism-arrow-head" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
                      <path d="M0,0 L8,4 L0,8 Z" />
                    </marker>
                  </defs>
                  {diagram.diagramEdges.map(edge => {
                    const sourceNode = diagram.flowNodes.find(node => node.id === edge.sourceId);
                    const targetNode = diagram.flowNodes.find(node => node.id === edge.targetId);
                    if (!sourceNode || !targetNode) return null;
                    const sourceSize = getFlowNodeSize(sourceNode.kind);
                    const targetSize = getFlowNodeSize(targetNode.kind);
                    const deltaX = targetNode.position.x + targetSize.width / 2 - sourceNode.position.x - sourceSize.width / 2;
                    const deltaY = targetNode.position.y + targetSize.height / 2 - sourceNode.position.y - sourceSize.height / 2;
                    const fallbackSourceSide: StudentConnectorSide = Math.abs(deltaX) >= Math.abs(deltaY)
                      ? (deltaX >= 0 ? 'right' : 'left')
                      : (deltaY >= 0 ? 'bottom' : 'top');
                    const sourcePoint = getAnchorPoint(sourceNode.position, sourceSize, edge.sourceAnchor ?? fallbackSourceSide);
                    const targetPoint = getAnchorPoint(targetNode.position, targetSize, edge.targetAnchor ?? oppositeSide(edge.sourceAnchor ?? fallbackSourceSide));
                    const distance = Math.hypot(targetPoint.x - sourcePoint.x, targetPoint.y - sourcePoint.y);
                    const bend = Math.max(48, distance * .32);
                    const path = `M ${sourcePoint.x} ${sourcePoint.y} C ${sourcePoint.x + sourcePoint.dx * bend} ${sourcePoint.y + sourcePoint.dy * bend}, ${targetPoint.x + targetPoint.dx * bend} ${targetPoint.y + targetPoint.dy * bend}, ${targetPoint.x} ${targetPoint.y}`;
                    const selected = selectedEdgeId === edge.id || selectedNodeId === edge.sourceId || selectedNodeId === edge.targetId;
                    const midpoint = { x: (sourcePoint.x + targetPoint.x) / 2, y: (sourcePoint.y + targetPoint.y) / 2 };
                    const selectEdge = () => {
                      setSelectedNodeId('');
                      setSelectedEdgeId(edge.id);
                    };
                    return (
                      <React.Fragment key={edge.id}>
                        <path d={path} className={`mechanism-edge-path ${selected ? 'is-selected' : ''}`} markerEnd="url(#mechanism-arrow-head)" />
                        <path
                          d={path}
                          className="mechanism-edge-hit"
                          role="button"
                          tabIndex={0}
                          aria-label={`${isZh ? '连线' : 'Arrow'}: ${sourceNode.label} → ${targetNode.label}`}
                          onClick={event => {
                            event.stopPropagation();
                            selectEdge();
                          }}
                          onKeyDown={event => {
                            if (event.key === 'Delete' || event.key === 'Backspace') {
                              event.preventDefault();
                              removeEdge(edge.id);
                            }
                          }}
                        />
                        <circle
                          cx={midpoint.x}
                          cy={midpoint.y}
                          r={7}
                          className={`mechanism-edge-selector ${selectedEdgeId === edge.id ? 'is-selected' : ''}`}
                          role="button"
                          tabIndex={0}
                          aria-label={`${isZh ? '编辑连线' : 'Edit arrow'}: ${sourceNode.label} → ${targetNode.label}`}
                          onClick={event => { event.stopPropagation(); selectEdge(); }}
                          onKeyDown={event => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              selectEdge();
                            }
                            if (event.key === 'Delete' || event.key === 'Backspace') {
                              event.preventDefault();
                              removeEdge(edge.id);
                            }
                          }}
                        />
                      </React.Fragment>
                    );
                  })}
                  {connectionPreview && connectionSourceId && connectionSourceAnchor ? (() => {
                    const sourceNode = diagram.flowNodes.find(node => node.id === connectionSourceId);
                    if (!sourceNode) return null;
                    const sourcePoint = getAnchorPoint(sourceNode.position, getFlowNodeSize(sourceNode.kind), connectionSourceAnchor);
                    const targetNode = connectionTarget
                      ? diagram.flowNodes.find(node => node.id === connectionTarget.nodeId)
                      : undefined;
                    const targetPoint = targetNode && connectionTarget
                      ? getAnchorPoint(targetNode.position, getFlowNodeSize(targetNode.kind), connectionTarget.anchor)
                      : { ...connectionPreview, dx: 0, dy: 0 };
                    const distance = Math.hypot(targetPoint.x - sourcePoint.x, targetPoint.y - sourcePoint.y);
                    const bend = Math.max(42, distance * .28);
                    const previewPath = `M ${sourcePoint.x} ${sourcePoint.y} C ${sourcePoint.x + sourcePoint.dx * bend} ${sourcePoint.y + sourcePoint.dy * bend}, ${targetPoint.x + targetPoint.dx * bend} ${targetPoint.y + targetPoint.dy * bend}, ${targetPoint.x} ${targetPoint.y}`;
                    return <path d={previewPath} className="mechanism-connection-preview" markerEnd="url(#mechanism-arrow-head)" />;
                  })() : null}
                </svg>

                {diagram.flowNodes.map(node => {
                  const size = getFlowNodeSize(node.kind);
                  const selected = selectedNodeId === node.id;
                  return (
                    <React.Fragment key={node.id}>
                      <article
                        className={`mechanism-flow-node is-${node.kind} ${selected ? 'is-selected' : ''} ${draggingId === node.id ? 'is-dragging' : ''} ${connectionSourceId === node.id ? 'is-connection-source' : ''} ${connectionTarget?.nodeId === node.id ? 'is-connection-target' : ''}`}
                        style={{ left: node.position.x, top: node.position.y, width: size.width, height: size.height }}
                        role="button"
                        tabIndex={0}
                        data-mechanism-node-id={node.id}
                        aria-label={`${isZh ? '流程元素' : 'Flow element'}: ${node.label}`}
                        onClick={() => handleNodeClick(node.id)}
                        onKeyDown={event => handleNodeKeyDown(event, node)}
                        onPointerDown={event => beginNodeDrag(event, node)}
                      >
                        <div className="mechanism-flow-shape">
                          {selected ? (
                            <input
                              autoFocus
                              value={node.label}
                              maxLength={40}
                              aria-label={`${isZh ? '编辑流程元素' : 'Edit flow element'}: ${node.label}`}
                              onPointerDown={event => event.stopPropagation()}
                              onClick={event => event.stopPropagation()}
                              onChange={event => updateNode(node.id, { label: event.target.value })}
                            />
                          ) : <span>{node.label}</span>}
                        </div>
                      </article>
                      {(selected || connectionTarget?.nodeId === node.id) ? CONNECTOR_SIDES.map(side => (
                        <button
                          key={side}
                          type="button"
                          className={`mechanism-connection-handle is-${side} ${connectionTarget?.nodeId === node.id ? 'is-target-handle' : ''} ${connectionTarget?.nodeId === node.id && connectionTarget.anchor === side ? 'is-snap-active' : ''}`}
                          style={getHandlePosition(node.position, size, side)}
                          aria-label={`${isZh ? '从此方向拖出连线' : 'Drag a connection from'} ${side}: ${node.label}`}
                          title={isZh ? '按住并拖到另一个流程元素' : 'Hold and drag onto another flow element'}
                          onPointerDown={event => {
                            if (connectionTarget?.nodeId === node.id) {
                              event.preventDefault();
                              return;
                            }
                            beginConnectionDrag(event, node.id, side);
                          }}
                          onPointerMove={moveConnectionDrag}
                          onPointerUp={finishConnectionDrag}
                          onPointerCancel={cancelConnectionDrag}
                        />
                      )) : null}
                      {selected ? (
                        <button
                          type="button"
                          className="mechanism-node-delete"
                          style={{ left: node.position.x + size.width - 13, top: node.position.y - 13 }}
                          aria-label={`${isZh ? '删除流程元素' : 'Delete flow element'}: ${node.label}`}
                          onPointerDown={event => event.stopPropagation()}
                          onClick={event => { event.stopPropagation(); removeNode(node.id); }}
                        ><X size={14} /></button>
                      ) : null}
                    </React.Fragment>
                  );
                })}

                {diagram.flowNodes.length === 0 ? (
                  <div className="mechanism-board-empty">
                    <MousePointer2 size={28} />
                    <strong>{isZh ? '从右侧放入第一个流程元素' : 'Add the first flow element'}</strong>
                    <span>{isZh ? '建议从“开始”或“输入”出发，再添加处理和判断。' : 'Start with Start or Input, then add process and decisions.'}</span>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        <aside className="mechanism-toolbox">
          {activeCard ? (
            <section className="mechanism-card-brief">
              <span>{isZh ? '当前功能' : 'CURRENT FUNCTION'}</span>
              <h4>{activeCard.responsibility}</h4>
              <dl>
                <div><dt>IN</dt><dd>{activeCard.input}</dd></div>
                <div><dt>OUT</dt><dd>{activeCard.output}</dd></div>
              </dl>
              <div className="mechanism-knowledge-list">{activeCard.knowledge.map(item => <span key={item}>{item}</span>)}</div>
              <div className="mechanism-quick-add">
                <button type="button" onClick={() => addNode('input-output', `${isZh ? '读取' : 'Read'}：${activeCard.input}`)}>{isZh ? '放入输入' : 'Add input'}</button>
                <button type="button" onClick={() => addNode('input-output', `${isZh ? '输出' : 'Return'}：${activeCard.output}`)}>{isZh ? '放入输出' : 'Add output'}</button>
              </div>
            </section>
          ) : null}

          {selectedEdge ? (
            <section className="mechanism-selection is-edge-selection">
              <div className="mechanism-section-label"><Link2 size={15} /><span>{isZh ? '当前连线' : 'SELECTED ARROW'}</span></div>
              <strong>
                {diagram.flowNodes.find(node => node.id === selectedEdge.sourceId)?.label ?? ''}
                {' → '}
                {diagram.flowNodes.find(node => node.id === selectedEdge.targetId)?.label ?? ''}
              </strong>
              <div className="mechanism-edge-actions">
                <button type="button" onClick={() => reverseEdge(selectedEdge)}><ArrowLeftRight size={14} />{isZh ? '反转方向' : 'Reverse'}</button>
                <button type="button" className="is-danger" onClick={() => removeEdge(selectedEdge.id)}><Trash2 size={14} />{isZh ? '删除连线' : 'Delete'}</button>
              </div>
            </section>
          ) : null}

          <section className="mechanism-toolbox-section">
            <div className="mechanism-section-label"><GitBranch size={15} /><span>{isZh ? '流程图形' : 'FLOW SHAPES'}</span></div>
            <p>{isZh ? '点击或拖入画布，再修改图形中的文字。' : 'Click or drag a shape into the canvas.'}</p>
            <div className="mechanism-shape-palette">
              {FLOW_NODE_LIBRARY.map(item => (
                <button key={item.kind} type="button" draggable onDragStart={event => startPaletteDrag(event, item.kind)} onClick={() => addNode(item.kind)}>
                  <i className={`mechanism-palette-icon is-${item.kind}`}><span /></i>
                  <span>{isZh ? item.labelZh : item.labelEn}</span>
                </button>
              ))}
            </div>
          </section>

          {selectedNode ? (
            <section className="mechanism-selection">
              <div className="mechanism-section-label"><MousePointer2 size={15} /><span>{isZh ? '当前元素' : 'SELECTED'}</span></div>
              <label><span>{isZh ? '图形中的文字' : 'Label'}</span><input value={selectedNode.label} maxLength={40} onChange={event => updateNode(selectedNode.id, { label: event.target.value })} /></label>
              <div className="mechanism-edge-list">
                {selectedEdges.map(edge => {
                  const source = diagram.flowNodes.find(node => node.id === edge.sourceId)?.label ?? '';
                  const target = diagram.flowNodes.find(node => node.id === edge.targetId)?.label ?? '';
                  return <div key={edge.id}><span>{source} → {target}</span><button type="button" aria-label={isZh ? '删除箭头' : 'Delete arrow'} onClick={() => removeEdge(edge.id)}><X size={12} /></button></div>;
                })}
                {selectedEdges.length === 0 ? <small>{isZh ? '还没有与它相连的箭头' : 'No connected arrows yet'}</small> : null}
              </div>
              <button type="button" className="mechanism-remove-node" onClick={() => removeNode(selectedNode.id)}><Trash2 size={13} />{isZh ? '删除图形' : 'Delete shape'}</button>
            </section>
          ) : null}

          <div className={`mechanism-notice ${connectMode ? 'is-connecting' : ''}`}>
            {connectMode ? <Link2 size={15} /> : <Move size={15} />}
            <span>{notice || (isZh ? '拖图形本体可移动；按住蓝色圆点拖出连线；点击图形可直接改字。' : 'Drag shapes to move them; drag a blue handle to connect; select a shape to edit text.')}</span>
          </div>

          <button
            type="button"
            className="mechanism-confirm"
            disabled={diagram.flowNodes.length < 3 || diagram.diagramEdges.length < 2}
            onClick={confirmDiagram}
          >
            {diagram.confirmedAt ? <Check size={16} /> : <CircleDot size={16} />}
            {diagram.confirmedAt ? (isZh ? '本卡流程已记录' : 'Flow recorded') : (isZh ? '完成本卡流程' : 'Record this flow')}
          </button>
        </aside>
      </div>

      <footer className="mechanism-stage-footer">
        <button type="button" onClick={onBack}>{isZh ? '返回功能卡' : 'Back to functions'}</button>
        <span>{isZh ? '每张功能卡的流程会作为后续编码和 AI 提示的依据' : 'Each flow guides later coding and AI scaffolding.'}</span>
        <button type="button" className="is-primary" disabled={!allCompleted} onClick={onContinue}>
          {isZh ? '进入项目路径规划' : 'Plan the project route'}<ArrowRight size={17} />
        </button>
      </footer>
    </section>
  );
};
