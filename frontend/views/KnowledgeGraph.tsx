import React, { useEffect, useState, useRef } from 'react';
import * as d3 from 'd3';
import { Node, Edge, CalibrationLog, Language } from '../types';
import { Search, AlertTriangle, Edit3, X, BookOpen, Brain, TrendingUp, Maximize2 } from 'lucide-react';
import { translations } from '../utils/translations';
import { getKnowledgeGraph } from '../services/api';

interface Props {
  nodes: Node[];
  edges: Edge[];
  onNodeUpdate: (id: string, updates: Partial<Node>) => void;
  onLogCalibration: (log: Omit<CalibrationLog, 'id' | 'timestamp'>) => void;
  language: Language;
  theme: 'light' | 'dark';
  userId?: string;
}

// Academic knowledge graph category color palette
const CATEGORY_COLORS: Record<string, string> = {
  '机器学习': '#718636',
  '数学': '#b9863e',
  '编程': '#9ab34b',
  '自然语言处理': '#b5c981',
  '计算机视觉': '#628c70',
  '通用': '#918e82',
};

function getCategoryColor(category?: string): string {
  return CATEGORY_COLORS[category || '通用'] || CATEGORY_COLORS['通用'];
}

export const KnowledgeGraph: React.FC<Props> = ({ nodes: propNodes, edges: propEdges, onNodeUpdate, onLogCalibration, language, theme, userId }) => {
  const t = translations[language];
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [graphNodes, setGraphNodes] = useState<Node[]>(propNodes);
  const [graphEdges, setGraphEdges] = useState<Edge[]>(propEdges);
  const [isLoading, setIsLoading] = useState(false);

  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const positionsRef = useRef<{[id: string]: {x: number, y: number, fx?: number | null, fy?: number | null}}>({});
  const simulationRef = useRef<d3.Simulation<any, undefined> | null>(null);
  const searchTermRef = useRef('');
  const applyGraphFocusRef = useRef<(nodeId: string | null, query?: string) => void>(() => undefined);
  const fitGraphRef = useRef<() => void>(() => undefined);

  // Load real knowledge graph from backend
  useEffect(() => {
    if (!userId) return;
    setIsLoading(true);
    getKnowledgeGraph(userId)
      .then(({ nodes, edges }) => {
        if (nodes.length > 0) {
          setGraphNodes(nodes);
          setGraphEdges(edges);
        } else if (propNodes.length > 0) {
          // Fallback: show locally-collected concepts from chat sessions
          setGraphNodes(propNodes);
          setGraphEdges(propEdges);
        }
      })
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, [userId]);

  // When prop nodes update (e.g. after new chat messages), sync them in if graph is still empty
  useEffect(() => {
    if (!isLoading && graphNodes.length === 0 && propNodes.length > 0) {
      setGraphNodes(propNodes);
      setGraphEdges(propEdges);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propNodes.length]);

  // Obsidian-inspired force graph: compact clusters, degree hierarchy and local focus.
  useEffect(() => {
    if (!svgRef.current || !containerRef.current || graphNodes.length === 0) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;
    const canvasBg = theme === 'light' ? '#f2eee3' : '#11120f';
    const nodeFill = theme === 'light' ? '#454a38' : '#e8e4d7';
    const mutedNodeFill = theme === 'light' ? '#8d8c80' : '#85897d';
    const labelColor = theme === 'light' ? '#252720' : '#f4f1e8';

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr('viewBox', `0 0 ${width} ${height}`);

    const g = svg.append("g");
    const zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on("zoom", (event) => g.attr("transform", event.transform))
    svg.call(zoomBehavior);

    const stableSeed = (value: string) => {
      let hash = 0;
      for (let index = 0; index < value.length; index += 1) {
        hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
      }
      return Math.abs(hash);
    };

    const d3Nodes = graphNodes.map(n => {
      const prev = positionsRef.current[n.id];
      const seed = stableSeed(n.id);
      const angle = (seed % 360) * (Math.PI / 180);
      const seededRadius = 36 + (seed % Math.max(48, Math.min(width, height) * 0.22));
      const previousX = Number.isFinite(prev?.x) ? prev.x : width / 2 + Math.cos(angle) * seededRadius;
      const previousY = Number.isFinite(prev?.y) ? prev.y : height / 2 + Math.sin(angle) * seededRadius;
      return {
        ...n,
        x: Math.max(36, Math.min(width - 36, previousX)),
        y: Math.max(36, Math.min(height - 36, previousY)),
        fx: null,
        fy: null,
      };
    });

    const nodeById = new Map(d3Nodes.map(n => [n.id, n]));
    const d3Links = graphEdges
      .filter(e => nodeById.has(e.source) && nodeById.has(e.target))
      .map(e => ({ source: e.source, target: e.target, relType: e.relType, weight: e.weight || 1 }));

    const endpointId = (endpoint: string | { id: string }) => typeof endpoint === 'string' ? endpoint : endpoint.id;
    const adjacency = new Map<string, Set<string>>(d3Nodes.map(node => [node.id, new Set<string>()]));
    const degree = new Map<string, number>(d3Nodes.map(node => [node.id, 0]));
    d3Links.forEach(linkItem => {
      const sourceId = endpointId(linkItem.source as any);
      const targetId = endpointId(linkItem.target as any);
      adjacency.get(sourceId)?.add(targetId);
      adjacency.get(targetId)?.add(sourceId);
      degree.set(sourceId, (degree.get(sourceId) || 0) + 1);
      degree.set(targetId, (degree.get(targetId) || 0) + 1);
    });

    const importance = (node: any) => (degree.get(node.id) || 0) * 2.2 + Math.log2((node.frequency || 0) + 1);
    const importantIds = new Set(
      [...d3Nodes]
        .sort((a, b) => importance(b) - importance(a))
        .slice(0, Math.max(4, Math.min(8, Math.ceil(d3Nodes.length * 0.18))))
        .map(node => node.id)
    );
    const radius = (node: any) => Math.min(
      19,
      4.8 + Math.sqrt(Math.max(1, degree.get(node.id) || 0)) * 2.7 + Math.log2((node.frequency || 0) + 1) * 1.25
    );

    const simulation = d3.forceSimulation(d3Nodes)
      .force("link", d3.forceLink(d3Links).id((d: any) => d.id)
        .distance((d: any) => Math.max(54, 92 - Math.log2((d.weight || 1) + 1) * 10))
        .strength((d: any) => Math.min(0.9, 0.42 + (d.weight || 1) * 0.07)))
      .force("charge", d3.forceManyBody<any>()
        .strength((d: any) => -58 - Math.sqrt(Math.max(1, degree.get(d.id) || 0)) * 18)
        .distanceMax(310))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("x", d3.forceX(width / 2).strength(0.045))
      .force("y", d3.forceY(height / 2).strength(0.045))
      .force("collide", d3.forceCollide<any>().radius((d: any) => radius(d) + 14).strength(0.78))
      .alphaDecay(0.035)
      .velocityDecay(0.42);

    simulationRef.current = simulation;

    const linkGroup = g.append("g").attr("class", "links");
    const link = linkGroup.selectAll("line")
      .data(d3Links)
      .join("line")
      .attr("stroke", theme === 'light' ? '#858779' : '#737a67')
      .attr("stroke-width", (d: any) => Math.min(2.2, 0.7 + Math.log2((d.weight || 1) + 1) * 0.45))
      .attr("stroke-linecap", "round")
      .attr("opacity", (d: any) => Math.min(0.34, 0.13 + Math.log2((d.weight || 1) + 1) * 0.06));

    const nodeGroup = g.append("g").attr("class", "nodes");
    const node = nodeGroup.selectAll("g")
      .data(d3Nodes)
      .join("g")
      .attr("cursor", "pointer")
      .call(d3.drag<any, any>()
        .on("start", (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x; d.fy = d.y;
        })
        .on("drag", (event, d) => { d.fx = event.x; d.fy = event.y; })
        .on("end", (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null; d.fy = null;
          positionsRef.current[d.id] = { x: d.x, y: d.y, fx: null, fy: null };
        })
      )
      .on("click", (event, d) => {
        const original = graphNodes.find(n => n.id === d.id);
        if (original) setSelectedNode(original);
      });

    node.append("circle")
      .attr("class", "node-halo")
      .attr("r", (d: any) => radius(d) + 4)
      .attr("fill", (d: any) => getCategoryColor(d.category))
      .attr("fill-opacity", 0.08)
      .attr("stroke", (d: any) => getCategoryColor(d.category))
      .attr("stroke-width", 1.2)
      .attr("stroke-opacity", 0.24);

    node.append("circle")
      .attr("class", "node-core")
      .attr("r", (d: any) => radius(d))
      .attr("fill", nodeFill)
      .attr("fill-opacity", (d: any) => 0.66 + (d.mastery / 100) * 0.3)
      .attr("stroke", (d: any) => d.isFlagged ? '#ef4444' : getCategoryColor(d.category))
      .attr("stroke-width", (d: any) => d.isFlagged ? 2.5 : 1.5)
      .attr("stroke-opacity", 0.72);

    const arcGen = d3.arc<any>()
      .innerRadius((d: any) => radius(d))
      .outerRadius((d: any) => radius(d) + 2.5)
      .startAngle(-Math.PI / 2)
      .endAngle((d: any) => -Math.PI / 2 + (d.mastery / 100) * 2 * Math.PI);

    node.append("path")
      .attr("class", "node-mastery")
      .attr("d", arcGen)
      .attr("fill", (d: any) => {
        if (d.mastery < 40) return '#f43f5e';
        if (d.mastery < 70) return '#f59e0b';
        return '#9fc72e';
      });

    node.filter((d: any) => d.isFlagged)
      .append("circle")
      .attr("r", 4)
      .attr("cx", (d: any) => radius(d) - 1)
      .attr("cy", (d: any) => -(radius(d) - 1))
      .attr("fill", "#ef4444")
      .attr("stroke", theme === 'light' ? '#f8faff' : '#0f172a')
      .attr("stroke-width", 1.5);

    node.append("text")
      .attr("class", "node-label")
      .attr("dy", (d: any) => radius(d) + 15)
      .attr("text-anchor", "middle")
      .text((d: any) => d.name.length > 14 ? d.name.substring(0, 13) + '…' : d.name)
      .attr("fill", labelColor)
      .attr("stroke", canvasBg)
      .attr("stroke-width", 3)
      .attr("paint-order", "stroke")
      .attr("font-size", (d: any) => importantIds.has(d.id) ? "11px" : "10px")
      .attr("font-weight", "600")
      .attr("opacity", (d: any) => importantIds.has(d.id) ? 0.86 : 0)
      .style("pointer-events", "none")
      .style("user-select", "none");

    const applyGraphFocus = (nodeId: string | null, query = '') => {
      const normalizedQuery = query.trim().toLowerCase();
      const directNeighbors = nodeId ? adjacency.get(nodeId) || new Set<string>() : new Set<string>();
      const matchingIds = new Set<string>(
        normalizedQuery
          ? d3Nodes.filter(item => item.name.toLowerCase().includes(normalizedQuery)).map(item => item.id)
          : []
      );
      const focusIds = new Set<string>();

      if (nodeId) {
        focusIds.add(nodeId);
        directNeighbors.forEach(id => focusIds.add(id));
      } else if (matchingIds.size > 0) {
        matchingIds.forEach(id => {
          focusIds.add(id);
          adjacency.get(id)?.forEach(neighborId => focusIds.add(neighborId));
        });
      }

      const hasFocus = focusIds.size > 0;
      const isActiveLink = (linkItem: any) => {
        const sourceId = endpointId(linkItem.source);
        const targetId = endpointId(linkItem.target);
        if (nodeId) return sourceId === nodeId || targetId === nodeId;
        return matchingIds.has(sourceId) || matchingIds.has(targetId);
      };

      node.interrupt()
        .transition().duration(140)
        .style("opacity", (item: any) => !hasFocus || focusIds.has(item.id) ? 1 : 0.1);

      node.select(".node-core").interrupt()
        .transition().duration(140)
        .attr("r", (item: any) => radius(item) + (item.id === nodeId ? 3 : 0))
        .attr("fill", (item: any) => item.id === nodeId ? getCategoryColor(item.category) : (hasFocus && !focusIds.has(item.id) ? mutedNodeFill : nodeFill))
        .attr("fill-opacity", (item: any) => item.id === nodeId ? 1 : 0.9);

      node.select(".node-halo").interrupt()
        .transition().duration(140)
        .attr("r", (item: any) => radius(item) + (item.id === nodeId ? 9 : 4))
        .attr("stroke-opacity", (item: any) => item.id === nodeId ? 0.95 : (hasFocus && focusIds.has(item.id) ? 0.58 : 0.22))
        .attr("fill-opacity", (item: any) => item.id === nodeId ? 0.24 : 0.08);

      node.select(".node-label").interrupt()
        .transition().duration(140)
        .attr("opacity", (item: any) => {
          if (nodeId) return focusIds.has(item.id) ? 1 : 0;
          if (matchingIds.size > 0) return matchingIds.has(item.id) ? 1 : 0;
          return importantIds.has(item.id) ? 0.86 : 0;
        });

      link.interrupt()
        .transition().duration(140)
        .attr("stroke", (linkItem: any) => isActiveLink(linkItem) ? '#9fc72e' : (theme === 'light' ? '#858779' : '#737a67'))
        .attr("stroke-width", (linkItem: any) => isActiveLink(linkItem) ? Math.min(3, 1.4 + Math.log2((linkItem.weight || 1) + 1) * 0.6) : Math.min(2.2, 0.7 + Math.log2((linkItem.weight || 1) + 1) * 0.45))
        .attr("opacity", (linkItem: any) => {
          if (!hasFocus) return Math.min(0.34, 0.13 + Math.log2((linkItem.weight || 1) + 1) * 0.06);
          return isActiveLink(linkItem) ? 0.92 : 0.035;
        });
    };

    applyGraphFocusRef.current = applyGraphFocus;

    node
      .on("mouseenter.focus", (event, d: any) => {
        event.currentTarget.parentNode?.appendChild(event.currentTarget);
        applyGraphFocus(d.id, searchTermRef.current);
      })
      .on("mouseleave.focus", () => applyGraphFocus(null, searchTermRef.current));

    simulation.on("tick", () => {
      link
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x)
        .attr("y2", (d: any) => d.target.y);
      node.attr("transform", (d: any) => `translate(${d.x},${d.y})`);
      d3Nodes.forEach(d => {
        positionsRef.current[d.id] = { x: d.x, y: d.y, fx: d.fx, fy: d.fy };
      });
    });

    const fitGraph = () => {
      const graphElement = g.node();
      if (!graphElement) return;
      const bounds = graphElement.getBBox();
      if (!bounds.width || !bounds.height) return;
      const padding = 72;
      const scale = Math.max(0.38, Math.min(1.35, Math.min(
        (width - padding * 2) / bounds.width,
        (height - padding * 2) / bounds.height
      )));
      const translateX = width / 2 - (bounds.x + bounds.width / 2) * scale;
      const translateY = height / 2 - (bounds.y + bounds.height / 2) * scale;
      svg.transition()
        .duration(520)
        .call(zoomBehavior.transform, d3.zoomIdentity.translate(translateX, translateY).scale(scale));
    };

    fitGraphRef.current = fitGraph;
    const fitTimer = window.setTimeout(fitGraph, 850);
    simulation.on("end.fit", fitGraph);

    return () => {
      window.clearTimeout(fitTimer);
      simulation.stop();
      applyGraphFocusRef.current = () => undefined;
      fitGraphRef.current = () => undefined;
    };
  }, [graphNodes.length, graphEdges.length, theme]);

  // Search uses the same focus system as node hover, preserving graph context.
  useEffect(() => {
    searchTermRef.current = searchTerm;
    applyGraphFocusRef.current(null, searchTerm);
  }, [searchTerm]);

  // Calibration state
  const getNodeColor = (mastery: number) => {
    if (mastery < 40) return '#f43f5e';
    if (mastery < 70) return '#f59e0b';
    return '#9fc72e';
  };

  const [calibrateValue, setCalibrateValue] = useState(0);
  const [calibrateReason, setCalibrateReason] = useState('');
  const [isCalibrating, setIsCalibrating] = useState(false);

  useEffect(() => {
    if (selectedNode) setCalibrateValue(selectedNode.mastery);
  }, [selectedNode]);

  const submitCalibration = () => {
    if (!selectedNode) return;
    onLogCalibration({
      type: 'Node',
      targetId: selectedNode.id,
      modelValue: selectedNode.mastery,
      userValue: calibrateValue,
      reason: calibrateReason,
      disagreementIndex: Math.abs(selectedNode.mastery - calibrateValue)
    });
    onNodeUpdate(selectedNode.id, { mastery: calibrateValue, isFlagged: true });
    setIsCalibrating(false);
    setSelectedNode(prev => prev ? { ...prev, mastery: calibrateValue, isFlagged: true } : null);
  };

  // Stats
  const categoryGroups = graphNodes.reduce((acc, n) => {
    const cat = n.category || '通用';
    acc[cat] = (acc[cat] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const topNodes = [...graphNodes].sort((a, b) => b.frequency - a.frequency).slice(0, 3);

  const cardBg = theme === 'light' ? '#faf7ee' : '#1b1d18';
  const cardBorder = `1px solid ${theme === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'}`;
  const textPrimary = theme === 'light' ? '#1a1b17' : '#f4f1e8';
  const textSecondary = theme === 'light' ? '#4d4d44' : '#cccbc0';
  const textMuted = theme === 'light' ? '#747369' : '#96998d';
  const bgMuted = theme === 'light' ? '#e9e3d5' : '#242720';

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-6">
      {/* Graph Area */}
      <div ref={containerRef} className="flex-1 glass-card relative overflow-hidden flex flex-col animate-fade-in" style={{
        background: theme === 'light'
          ? 'radial-gradient(circle at 78% 18%, rgba(159,199,46,0.13), transparent 34%), radial-gradient(circle at 18% 82%, rgba(113,134,54,0.08), transparent 30%), #f2eee3'
          : 'radial-gradient(circle at 78% 18%, rgba(159,199,46,0.18), transparent 38%), radial-gradient(circle at 24% 78%, rgba(113,134,54,0.12), transparent 34%), linear-gradient(145deg, #0e100d 0%, #171a14 100%)'
      }}>
        {/* Search */}
        <div className="absolute top-4 left-4 z-10 w-64">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-3" style={{ color: textMuted }} />
            <input
              type="text"
              placeholder={t.searchConcept}
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full backdrop-blur rounded-lg py-2 pl-9 pr-4 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/20 shadow-sm"
              style={{ backgroundColor: cardBg, border: cardBorder, color: textPrimary }}
            />
          </div>
        </div>

        <button
          type="button"
          onClick={() => fitGraphRef.current()}
          className="absolute right-4 top-4 z-10 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold backdrop-blur transition-transform hover:-translate-y-0.5"
          style={{ backgroundColor: cardBg, border: cardBorder, color: textSecondary, boxShadow: 'var(--shadow-sm)' }}
          title={language === 'zh' ? '重新适配图谱视图' : 'Fit graph to view'}
        >
          <Maximize2 size={14} />
          {language === 'zh' ? '适配视图' : 'Fit view'}
        </button>

        {/* Legend */}
        <div className="absolute bottom-4 left-4 z-10 flex flex-wrap gap-2 max-w-sm">
          {Object.entries(CATEGORY_COLORS)
            .filter(([cat]) => cat !== '通用' && graphNodes.some(n => (n.category || '通用') === cat))
            .map(([cat, color]) => (
              <div key={cat} className="flex items-center gap-1 px-2 py-1 rounded-full text-xs backdrop-blur shadow-sm" style={{
                backgroundColor: cardBg, border: cardBorder, color: textSecondary
              }}>
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                {cat}
              </div>
            ))
          }
          <div className="flex items-center gap-2 px-2 py-1 rounded-full text-xs backdrop-blur shadow-sm" style={{
            backgroundColor: cardBg, border: cardBorder, color: textSecondary
          }}>
            <div className="w-2 h-2 rounded-full bg-rose-500" />
            {t.legendWeak}
            <div className="w-2 h-2 rounded-full bg-amber-500" />
            {t.legendDeveloping}
            <div className="w-2 h-2 rounded-full bg-fuchsia-500" />
            {t.legendMastered}
          </div>
        </div>

        <div
          className="absolute bottom-4 right-4 z-10 rounded-full px-3 py-1.5 text-[11px] backdrop-blur"
          style={{ backgroundColor: cardBg, border: cardBorder, color: textMuted }}
        >
          {language === 'zh' ? '悬停聚焦 · 拖拽节点 · 滚轮缩放' : 'Hover to focus · Drag nodes · Scroll to zoom'}
        </div>

        <svg
          ref={svgRef}
          className="w-full h-full cursor-grab active:cursor-grabbing"
          role="img"
          aria-label={language === 'zh' ? '可交互知识图谱' : 'Interactive knowledge graph'}
        />

        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center" style={{
            backgroundColor: theme === 'light' ? 'rgba(248,250,255,0.85)' : 'rgba(15,23,42,0.85)'
          }}>
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm" style={{ color: textMuted }}>
                {language === 'zh' ? '加载知识图谱...' : 'Loading knowledge graph...'}
              </span>
            </div>
          </div>
        )}

        {!isLoading && graphNodes.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8">
            <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ backgroundColor: bgMuted }}>
              <Brain size={32} style={{ color: textMuted }} />
            </div>
            <p className="text-base font-semibold text-center" style={{ color: textPrimary }}>
              {language === 'zh' ? '知识图谱正在生长' : 'Knowledge Graph is Growing'}
            </p>
            <p className="text-sm text-center max-w-sm" style={{ color: textMuted }}>
              {language === 'zh'
                ? '去「对话」页面与 AI 交流，系统会自动从对话中提取知识概念，节点将在这里可视化展示'
                : 'Chat with AI on the Chat page — concepts are auto-extracted and will appear here as graph nodes'}
            </p>
          </div>
        )}
      </div>

      {/* Right Panel */}
      <div className="w-80 shrink-0 flex flex-col gap-4 overflow-y-auto">
        {selectedNode ? (
          <div className="glass-card p-5 flex flex-col gap-4 animate-slide-in-right">
            <div className="flex justify-between items-start">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: getCategoryColor(selectedNode.category) }} />
                  <span className="text-xs" style={{ color: textMuted }}>{selectedNode.category || '通用'}</span>
                </div>
                <h3 className="text-lg font-bold" style={{ color: textPrimary }}>{selectedNode.name}</h3>
              </div>
              <button onClick={() => { setSelectedNode(null); setIsCalibrating(false); }}>
                <X size={18} style={{ color: textMuted }} />
              </button>
            </div>

            {/* Mastery bar */}
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span style={{ color: textSecondary }}>{t.masteryLevel}</span>
                <span className="font-mono font-bold" style={{ color: getNodeColor(selectedNode.mastery) }}>
                  {Math.round(selectedNode.mastery)}%
                </span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: bgMuted }}>
                <div className="h-full rounded-full transition-all duration-500" style={{
                  width: `${selectedNode.mastery}%`,
                  backgroundColor: getNodeColor(selectedNode.mastery)
                }} />
              </div>
              <div className="flex justify-between text-xs mt-1" style={{ color: textMuted }}>
                <span>{language === 'zh' ? `出现 ${selectedNode.frequency} 次` : `Seen ${selectedNode.frequency}×`}</span>
                {selectedNode.isFlagged && (
                  <span className="flex items-center gap-1 text-amber-500">
                    <AlertTriangle size={10} /> {t.flagged}
                  </span>
                )}
              </div>
            </div>

            {/* Description */}
            {selectedNode.description && (
              <div className="rounded-lg p-3" style={{ backgroundColor: bgMuted, border: cardBorder }}>
                <span className="text-xs font-semibold block mb-1" style={{ color: textSecondary }}>{t.definition}</span>
                <p className="text-xs leading-relaxed" style={{ color: textPrimary }}>{selectedNode.description}</p>
              </div>
            )}

            {/* Calibration */}
            {!isCalibrating ? (
              <button
                onClick={() => setIsCalibrating(true)}
                className="w-full py-2 flex items-center justify-center gap-2 rounded-lg text-xs transition-all"
                style={{ border: cardBorder, color: textSecondary, backgroundColor: 'transparent' }}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = bgMuted; }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                <Edit3 size={12} />
                {t.disagree}
              </button>
            ) : (
              <div className="rounded-lg p-4 space-y-3" style={{ backgroundColor: bgMuted, border: cardBorder }}>
                <h4 className="text-xs font-semibold" style={{ color: '#718636' }}>{t.calibrateNode}</h4>
                <div>
                  <label className="text-xs block mb-1" style={{ color: textSecondary }}>{t.yourEstimate}</label>
                  <input
                    type="range" min="0" max="100"
                    value={calibrateValue}
                    onChange={e => setCalibrateValue(parseInt(e.target.value))}
                    className="w-full accent-indigo-500 h-2 rounded-lg appearance-none cursor-pointer"
                    style={{ backgroundColor: theme === 'light' ? '#e5e7eb' : '#475569' }}
                  />
                  <div className="text-right text-xs font-mono" style={{ color: '#718636' }}>{calibrateValue}%</div>
                </div>
                <div>
                  <label className="text-xs block mb-1" style={{ color: textSecondary }}>{t.reason}</label>
                  <textarea
                    value={calibrateReason}
                    onChange={e => setCalibrateReason(e.target.value)}
                    className="w-full rounded p-2 text-xs focus:outline-none"
                    rows={2}
                    placeholder="..."
                    style={{ backgroundColor: cardBg, border: cardBorder, color: textPrimary }}
                  />
                </div>
                <div className="flex gap-2">
                  <button onClick={submitCalibration} className="flex-1 bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-xs py-2 rounded">{t.submit}</button>
                  <button onClick={() => setIsCalibrating(false)} className="px-3 text-xs py-2 rounded" style={{ backgroundColor: theme === 'light' ? '#e5e7eb' : '#475569', color: textPrimary }}>{t.cancel}</button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Graph Overview */}
            <div className="glass-card p-5 space-y-3 animate-fade-in">
              <h3 className="text-sm font-bold flex items-center gap-2" style={{ color: textPrimary }}>
                <TrendingUp size={16} className="text-indigo-500" />
                {language === 'zh' ? '知识图谱概况' : 'Graph Overview'}
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg p-3 text-center" style={{ backgroundColor: bgMuted, border: cardBorder }}>
                  <div className="text-2xl font-bold" style={{ color: textPrimary }}>{graphNodes.length}</div>
                  <div className="text-xs" style={{ color: textMuted }}>{language === 'zh' ? '知识节点' : 'Concepts'}</div>
                </div>
                <div className="rounded-lg p-3 text-center" style={{ backgroundColor: bgMuted, border: cardBorder }}>
                  <div className="text-2xl font-bold" style={{ color: textPrimary }}>{graphEdges.length}</div>
                  <div className="text-xs" style={{ color: textMuted }}>{language === 'zh' ? '关联关系' : 'Relations'}</div>
                </div>
              </div>
            </div>

            {/* Domain Distribution */}
            {Object.keys(categoryGroups).length > 0 && (
              <div className="glass-card p-5 space-y-3">
                <h3 className="text-sm font-bold flex items-center gap-2" style={{ color: textPrimary }}>
                  <BookOpen size={16} className="text-fuchsia-400" />
                  {language === 'zh' ? '知识领域分布' : 'Domain Distribution'}
                </h3>
                <div className="space-y-2">
                  {(Object.entries(categoryGroups) as [string, number][])
                    .sort(([, a], [, b]) => b - a)
                    .map(([cat, count]) => (
                      <div key={cat}>
                        <div className="flex justify-between text-xs mb-1">
                          <div className="flex items-center gap-1.5">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: getCategoryColor(cat) }} />
                            <span style={{ color: textSecondary }}>{cat}</span>
                          </div>
                          <span className="font-mono" style={{ color: textMuted }}>{count}</span>
                        </div>
                        <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: bgMuted }}>
                          <div className="h-full rounded-full transition-all duration-500" style={{
                            width: `${((count as number) / graphNodes.length) * 100}%`,
                            backgroundColor: getCategoryColor(cat)
                          }} />
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Top Concepts */}
            {topNodes.length > 0 && (
              <div className="glass-card p-5 space-y-3">
                <h3 className="text-sm font-bold flex items-center gap-2" style={{ color: textPrimary }}>
                  <Brain size={16} className="text-violet-500" />
                  {language === 'zh' ? '高频知识点' : 'Top Concepts'}
                </h3>
                <div className="space-y-2">
                  {topNodes.map((node, idx) => (
                    <button
                      key={node.id}
                      onClick={() => setSelectedNode(node)}
                      className="w-full flex items-center gap-3 p-2.5 rounded-lg text-left transition-all hover:shadow-sm"
                      style={{ backgroundColor: bgMuted, border: cardBorder }}
                    >
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0" style={{
                        backgroundColor: getCategoryColor(node.category)
                      }}>
                        {idx + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold truncate" style={{ color: textPrimary }}>{node.name}</div>
                        <div className="text-xs" style={{ color: textMuted }}>
                          {language === 'zh' ? `掌握度 ${Math.round(node.mastery)}%` : `Mastery ${Math.round(node.mastery)}%`}
                        </div>
                      </div>
                      <div className="w-1.5 h-8 rounded-full shrink-0" style={{ backgroundColor: getNodeColor(node.mastery) }} />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {graphNodes.length === 0 && !isLoading && (
              <div className="glass-card p-6 text-center" style={{ color: textMuted }}>
                <p className="text-sm">{language === 'zh' ? '开始对话以构建您的知识图谱' : 'Start chatting to build your knowledge graph'}</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
