import React, { useEffect, useState, useRef } from 'react';
import * as d3 from 'd3';
import { Node, Edge, CalibrationLog, Language } from '../types';
import { Search, AlertTriangle, Edit3, X, BookOpen, Brain, TrendingUp } from 'lucide-react';
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
  '机器学习': '#6366f1',
  '数学': '#f59e0b',
  '编程': '#10b981',
  '自然语言处理': '#8b5cf6',
  '计算机视觉': '#06b6d4',
  '通用': '#94a3b8',
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

  // D3 Visualization
  useEffect(() => {
    if (!svgRef.current || !containerRef.current || graphNodes.length === 0) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    // Zoomable group
    const g = svg.append("g");
    svg.call(d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on("zoom", (event) => g.attr("transform", event.transform))
    );

    // Prepare D3 nodes
    const d3Nodes = graphNodes.map(n => {
      const prev = positionsRef.current[n.id];
      return {
        ...n,
        x: prev?.x ?? (width / 2 + (Math.random() - 0.5) * 80),
        y: prev?.y ?? (height / 2 + (Math.random() - 0.5) * 80),
        fx: prev?.fx ?? null,
        fy: prev?.fy ?? null,
      };
    });

    const nodeById = new Map(d3Nodes.map(n => [n.id, n]));
    const d3Links = graphEdges
      .filter(e => nodeById.has(e.source) && nodeById.has(e.target))
      .map(e => ({ source: e.source, target: e.target, relType: e.relType, weight: e.weight || 1 }));

    // Force simulation
    const simulation = d3.forceSimulation(d3Nodes)
      .force("link", d3.forceLink(d3Links).id((d: any) => d.id).distance(130).strength(0.35))
      .force("charge", d3.forceManyBody().strength(-260))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide().radius((d: any) => 18 + d.frequency * 1.5 + 10));

    simulationRef.current = simulation;

    // Draw links
    const linkGroup = g.append("g").attr("class", "links");
    const link = linkGroup.selectAll("line")
      .data(d3Links)
      .join("line")
      .attr("stroke", (d: any) => d.relType === "related" ? "#818cf8" : "#94a3b8")
      .attr("stroke-width", (d: any) => Math.min(3, 1 + Math.log(d.weight || 1)))
      .attr("stroke-dasharray", (d: any) => d.relType === "related" ? "5,3" : "none")
      .attr("opacity", 0.3);

    // Draw nodes
    const nodeGroup = g.append("g").attr("class", "nodes");
    const node = nodeGroup.selectAll("g")
      .data(d3Nodes)
      .join("g")
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

    const radius = (d: any) => 14 + d.frequency * 1.5;

    // Outer glow ring (category color)
    node.append("circle")
      .attr("r", (d: any) => radius(d) + 4)
      .attr("fill", "none")
      .attr("stroke", (d: any) => getCategoryColor(d.category))
      .attr("stroke-width", 1)
      .attr("stroke-opacity", 0.25);

    // Main node circle (category color + mastery opacity)
    node.append("circle")
      .attr("r", (d: any) => radius(d))
      .attr("fill", (d: any) => getCategoryColor(d.category))
      .attr("fill-opacity", (d: any) => 0.2 + (d.mastery / 100) * 0.5)
      .attr("stroke", (d: any) => d.isFlagged ? '#ef4444' : getCategoryColor(d.category))
      .attr("stroke-width", (d: any) => d.isFlagged ? 2.5 : 1.5)
      .attr("stroke-opacity", 0.8)
      .attr("cursor", "pointer");

    // Mastery arc on the outer ring
    const arcGen = d3.arc<any>()
      .innerRadius((d: any) => radius(d))
      .outerRadius((d: any) => radius(d) + 2.5)
      .startAngle(-Math.PI / 2)
      .endAngle((d: any) => -Math.PI / 2 + (d.mastery / 100) * 2 * Math.PI);

    node.append("path")
      .attr("d", arcGen)
      .attr("fill", (d: any) => {
        if (d.mastery < 40) return '#f43f5e';
        if (d.mastery < 70) return '#f59e0b';
        return '#10b981';
      });

    // Flag indicator
    node.filter((d: any) => d.isFlagged)
      .append("circle")
      .attr("r", 4)
      .attr("cx", (d: any) => radius(d) - 1)
      .attr("cy", (d: any) => -(radius(d) - 1))
      .attr("fill", "#ef4444")
      .attr("stroke", theme === 'light' ? '#f8faff' : '#0f172a')
      .attr("stroke-width", 1.5);

    // Labels
    const labelColor = theme === 'light' ? '#374151' : '#e2e8f0';
    node.append("text")
      .attr("dy", (d: any) => radius(d) + 14)
      .attr("text-anchor", "middle")
      .text((d: any) => d.name.length > 10 ? d.name.substring(0, 9) + '…' : d.name)
      .attr("fill", labelColor)
      .attr("font-size", "10px")
      .attr("font-weight", "600")
      .style("pointer-events", "none")
      .style("user-select", "none");

    // Tick
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

    return () => { simulation.stop(); };
  }, [graphNodes.length, graphEdges.length, theme]);

  // Search highlight
  useEffect(() => {
    if (!svgRef.current) return;
    d3.select(svgRef.current).selectAll(".nodes g").style("opacity", (d: any) => {
      if (!searchTerm) return 1;
      return d.name.toLowerCase().includes(searchTerm.toLowerCase()) ? 1 : 0.1;
    });
  }, [searchTerm]);

  // Calibration state
  const getNodeColor = (mastery: number) => {
    if (mastery < 40) return '#f43f5e';
    if (mastery < 70) return '#f59e0b';
    return '#10b981';
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

  const cardBg = theme === 'light' ? '#ffffff' : '#1e293b';
  const cardBorder = `1px solid ${theme === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'}`;
  const textPrimary = theme === 'light' ? '#000000' : '#ffffff';
  const textSecondary = theme === 'light' ? '#404040' : '#cbd5e1';
  const textMuted = theme === 'light' ? '#6b7280' : '#94a3b8';
  const bgMuted = theme === 'light' ? '#f3f4f6' : '#334155';

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-6">
      {/* Graph Area */}
      <div ref={containerRef} className="flex-1 glass-card relative overflow-hidden flex flex-col animate-fade-in" style={{
        background: theme === 'light' ? '#f8faff' : 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)'
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
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
            {t.legendMastered}
          </div>
        </div>

        <svg ref={svgRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

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
                <h4 className="text-xs font-semibold" style={{ color: '#818cf8' }}>{t.calibrateNode}</h4>
                <div>
                  <label className="text-xs block mb-1" style={{ color: textSecondary }}>{t.yourEstimate}</label>
                  <input
                    type="range" min="0" max="100"
                    value={calibrateValue}
                    onChange={e => setCalibrateValue(parseInt(e.target.value))}
                    className="w-full accent-indigo-500 h-2 rounded-lg appearance-none cursor-pointer"
                    style={{ backgroundColor: theme === 'light' ? '#e5e7eb' : '#475569' }}
                  />
                  <div className="text-right text-xs font-mono" style={{ color: '#818cf8' }}>{calibrateValue}%</div>
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
                  <BookOpen size={16} className="text-emerald-500" />
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
