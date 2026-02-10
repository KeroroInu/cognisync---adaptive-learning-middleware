import React, { useEffect, useState, useMemo, useRef } from 'react';
import * as d3 from 'd3';
import { Node, Edge, CalibrationLog, Language } from '../types';
import { Search, AlertTriangle, Edit3, X } from 'lucide-react';
import { translations } from '../utils/translations';

interface Props {
  nodes: Node[];
  edges: Edge[];
  onNodeUpdate: (id: string, updates: Partial<Node>) => void;
  onLogCalibration: (log: Omit<CalibrationLog, 'id' | 'timestamp'>) => void;
  language: Language;
  theme: 'light' | 'dark';
}

export const KnowledgeGraph: React.FC<Props> = ({ nodes, edges, onNodeUpdate, onLogCalibration, language, theme }) => {
  const t = translations[language];
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Store node positions to prevent reset on re-render
  const positionsRef = useRef<{[id: string]: {x: number, y: number, fx?: number | null, fy?: number | null}}>({});

  // Simulation State
  const simulationRef = useRef<d3.Simulation<any, undefined> | null>(null);
  
  // D3 Initialization & Update
  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove(); // Clear previous

    // Prepare data
    // Map existing nodes to preserve x,y if they exist in local ref, else init center
    const d3Nodes = nodes.map(n => {
        const prev = positionsRef.current[n.id];
        return {
            ...n,
            x: prev?.x ?? (width/2 + (Math.random() - 0.5) * 50),
            y: prev?.y ?? (height/2 + (Math.random() - 0.5) * 50),
            fx: prev?.fx ?? null,
            fy: prev?.fy ?? null
        };
    });
    
    const d3Links = edges.map(e => ({ source: e.source, target: e.target }));

    // Create Simulation
    const simulation = d3.forceSimulation(d3Nodes)
        .force("link", d3.forceLink(d3Links).id((d: any) => d.id).distance(100))
        .force("charge", d3.forceManyBody().strength(-300))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collide", d3.forceCollide().radius((d: any) => 15 + (d.frequency * 2) + 10));

    simulationRef.current = simulation;

    // Draw elements
    const linkGroup = svg.append("g").attr("class", "links");
    const nodeGroup = svg.append("g").attr("class", "nodes");

    const link = linkGroup.selectAll("line")
        .data(d3Links)
        .join("line")
        .attr("stroke", "#94a3b8")
        .attr("stroke-width", 1.5)
        .attr("opacity", 0.4);

    const node = nodeGroup.selectAll("g")
        .data(d3Nodes)
        .join("g")
        .call(d3.drag<any, any>() // Add Drag behavior
            .on("start", (event, d) => {
                if (!event.active) simulation.alphaTarget(0.3).restart();
                d.fx = d.x;
                d.fy = d.y;
            })
            .on("drag", (event, d) => {
                d.fx = event.x;
                d.fy = event.y;
            })
            .on("end", (event, d) => {
                if (!event.active) simulation.alphaTarget(0);
                d.fx = null;
                d.fy = null;
                
                // Update refs for position memory
                positionsRef.current[d.id] = { x: d.x, y: d.y, fx: null, fy: null };
            })
        )
        .on("click", (event, d) => {
            // Find original node object to set as selected
            const original = nodes.find(n => n.id === d.id);
            if (original) setSelectedNode(original);
        });

    // Node Circles
    node.append("circle")
        .attr("r", (d: any) => 15 + (d.frequency * 2))
        .attr("fill", (d: any) => {
            if (d.mastery < 50) return '#f43f5e';
            if (d.mastery < 80) return '#f59e0b';
            return '#10b981';
        })
        .attr("stroke", (d: any) => d.isFlagged ? '#fff' : 'none')
        .attr("stroke-width", (d: any) => d.isFlagged ? 3 : 0)
        .attr("class", "transition-colors duration-300 shadow-lg cursor-pointer hover:stroke-indigo-400 hover:stroke-[2px]");

    // Flag indicator
    node.filter((d: any) => d.isFlagged)
        .append("circle")
        .attr("r", 4)
        .attr("cx", 10)
        .attr("cy", -10)
        .attr("fill", "#ef4444")
        .attr("stroke", "#0f172a");

    // Labels
    node.append("text")
        .attr("dy", (d: any) => 30 + d.frequency)
        .attr("text-anchor", "middle")
        .text((d: any) => d.name)
        .attr("fill", "#94a3b8")
        .attr("font-size", "11px")
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

        node
            .attr("transform", (d: any) => `translate(${d.x},${d.y})`);
            
        // Sync positions to ref constantly for smoothness if unmount happens
        d3Nodes.forEach(d => {
             positionsRef.current[d.id] = { x: d.x, y: d.y, fx: d.fx, fy: d.fy };
        });
    });

    // Cleanup
    return () => {
        simulation.stop();
    };
  }, [nodes.length, edges.length]); // Re-run if graph structure changes significantly

  // Highlight effect for search
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    const nodesG = svg.selectAll(".nodes g");
    
    nodesG.style("opacity", (d: any) => {
        if (!searchTerm) return 1;
        return d.name.toLowerCase().includes(searchTerm.toLowerCase()) ? 1 : 0.1;
    });
  }, [searchTerm]);


  // Node Calibration Logic
  const getNodeColor = (mastery: number) => {
    if (mastery < 50) return '#f43f5e'; // Rose
    if (mastery < 80) return '#f59e0b'; // Amber
    return '#10b981'; // Emerald
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
    setSelectedNode(prev => prev ? {...prev, mastery: calibrateValue, isFlagged: true} : null);
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-6">
      {/* Graph Area */}
      <div ref={containerRef} className="flex-1 glass-card relative overflow-hidden flex flex-col animate-fade-in">
         {/* Controls */}
         <div className="absolute top-4 left-4 z-10 w-64">
            <div className="relative">
                <Search size={16} className="absolute left-3 top-3" style={{
                  color: theme === 'light' ? '#9ca3af' : '#94a3b8'
                }} />
                <input
                    type="text"
                    placeholder={t.searchConcept}
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="w-full backdrop-blur rounded-lg py-2 pl-9 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 shadow-sm"
                    style={{
                      backgroundColor: theme === 'light' ? 'rgba(255, 255, 255, 0.9)' : '#1e293b',
                      border: `1px solid ${theme === 'light' ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)'}`,
                      color: theme === 'light' ? '#000000' : '#f8fafc'
                    }}
                />
            </div>
         </div>

         {/* Legends */}
         <div className="absolute bottom-4 left-4 z-10 flex space-x-4 backdrop-blur p-2 rounded-lg shadow-md" style={{
           backgroundColor: theme === 'light' ? 'rgba(255, 255, 255, 0.9)' : '#1e293b',
           border: `1px solid ${theme === 'light' ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)'}`
         }}>
            <div className="flex items-center space-x-1">
              <div className="w-3 h-3 rounded-full bg-rose-500 shadow-sm"></div>
              <span className="text-xs" style={{ color: theme === 'light' ? '#404040' : '#e2e8f0' }}>{t.legendWeak}</span>
            </div>
            <div className="flex items-center space-x-1">
              <div className="w-3 h-3 rounded-full bg-amber-500 shadow-sm"></div>
              <span className="text-xs" style={{ color: theme === 'light' ? '#404040' : '#e2e8f0' }}>{t.legendDeveloping}</span>
            </div>
            <div className="flex items-center space-x-1">
              <div className="w-3 h-3 rounded-full bg-emerald-500 shadow-sm"></div>
              <span className="text-xs" style={{ color: theme === 'light' ? '#404040' : '#e2e8f0' }}>{t.legendMastered}</span>
            </div>
         </div>

         {/* SVG Visualization */}
         <svg ref={svgRef} className="w-full h-full cursor-grab active:cursor-grabbing" style={{
           background: theme === 'light' ? '#ffffff' : 'linear-gradient(to bottom right, #0f172a, #1e293b)'
         }}></svg>
      </div>

      {/* Detail Sidebar */}
      {selectedNode ? (
          <div className="w-80 shrink-0 glass-card p-6 flex flex-col h-full overflow-y-auto animate-slide-in-right stagger-2 hover:shadow-xl transition-all duration-300">
            <div className="flex justify-between items-start mb-4">
                <h3 className="text-xl font-bold" style={{ color: theme === 'light' ? '#000000' : '#ffffff' }}>{selectedNode.name}</h3>
                <button onClick={() => setSelectedNode(null)} className="transition-colors" style={{
                  color: theme === 'light' ? '#9ca3af' : '#94a3b8'
                }}>
                  <X size={20}/>
                </button>
            </div>

            <div className="space-y-6">
                <div>
                    <span className="text-xs font-semibold uppercase tracking-wider" style={{
                      color: theme === 'light' ? '#404040' : '#e2e8f0'
                    }}>{t.masteryLevel}</span>
                    <div className="flex items-center space-x-3 mt-2">
                        <div className="flex-1 h-2 rounded-full overflow-hidden" style={{
                          backgroundColor: theme === 'light' ? '#e5e7eb' : '#334155'
                        }}>
                            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${selectedNode.mastery}%`, backgroundColor: getNodeColor(selectedNode.mastery) }}></div>
                        </div>
                        <span className="text-sm font-mono" style={{
                          color: theme === 'light' ? '#000000' : '#ffffff'
                        }}>{selectedNode.mastery}%</span>
                    </div>
                </div>

                <div>
                    <span className="text-xs font-semibold uppercase tracking-wider" style={{
                      color: theme === 'light' ? '#404040' : '#e2e8f0'
                    }}>{t.definition}</span>
                    <p className="text-sm mt-1 leading-relaxed" style={{
                      color: theme === 'light' ? '#000000' : '#ffffff'
                    }}>{selectedNode.description}</p>
                </div>

                {/* Evidence Section */}
                <div className="rounded-lg p-3" style={{
                  backgroundColor: theme === 'light' ? '#f0f4ff' : '#334155',
                  border: `1px solid ${theme === 'light' ? '#d0d9ff' : '#475569'}`
                }}>
                    <span className="text-xs font-semibold uppercase tracking-wider block mb-2" style={{
                      color: theme === 'light' ? '#4338ca' : '#a5b4fc'
                    }}>{t.evidenceSection}</span>
                    <p className="text-xs italic" style={{
                      color: theme === 'light' ? '#404040' : '#e2e8f0'
                    }}>"User correctly identified gradient descent usage in turn #4..."</p>
                </div>

                {/* Calibration Section */}
                {!isCalibrating ? (
                     <button
                        onClick={() => setIsCalibrating(true)}
                        className="w-full py-2 flex items-center justify-center space-x-2 rounded-lg transition-all text-sm shadow-sm"
                        style={{
                          border: `1px solid ${theme === 'light' ? '#d1d5db' : '#475569'}`,
                          color: theme === 'light' ? '#000000' : '#ffffff',
                          backgroundColor: 'transparent'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = theme === 'light' ? '#f9fafb' : '#334155';
                          e.currentTarget.style.borderColor = theme === 'light' ? '#9ca3af' : '#64748b';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = 'transparent';
                          e.currentTarget.style.borderColor = theme === 'light' ? '#d1d5db' : '#475569';
                        }}
                     >
                        <Edit3 size={14} />
                        <span>{t.disagree}</span>
                     </button>
                ) : (
                    <div className="rounded-lg p-4 space-y-4 shadow-sm" style={{
                      backgroundColor: theme === 'light' ? '#f0f4ff' : '#334155',
                      border: `1px solid ${theme === 'light' ? '#d0d9ff' : '#475569'}`
                    }}>
                        <h4 className="text-sm font-semibold" style={{
                          color: theme === 'light' ? '#4338ca' : '#a5b4fc'
                        }}>{t.calibrateNode}</h4>

                        <div>
                            <label className="text-xs block mb-1" style={{
                              color: theme === 'light' ? '#404040' : '#e2e8f0'
                            }}>{t.yourEstimate}</label>
                            <input
                                type="range"
                                min="0" max="100"
                                value={calibrateValue}
                                onChange={(e) => setCalibrateValue(parseInt(e.target.value))}
                                className="w-full accent-indigo-500 h-2 rounded-lg appearance-none cursor-pointer"
                                style={{
                                  backgroundColor: theme === 'light' ? '#e5e7eb' : '#475569'
                                }}
                            />
                            <div className="text-right text-xs font-mono" style={{
                              color: theme === 'light' ? '#4338ca' : '#a5b4fc'
                            }}>{calibrateValue}%</div>
                        </div>

                        <div>
                            <label className="text-xs block mb-1" style={{
                              color: theme === 'light' ? '#404040' : '#e2e8f0'
                            }}>{t.reason}</label>
                            <textarea
                                value={calibrateReason}
                                onChange={e => setCalibrateReason(e.target.value)}
                                className="w-full rounded p-2 text-xs focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                                rows={2}
                                placeholder="..."
                                style={{
                                  backgroundColor: theme === 'light' ? '#ffffff' : '#1e293b',
                                  border: `1px solid ${theme === 'light' ? '#d1d5db' : '#475569'}`,
                                  color: theme === 'light' ? '#000000' : '#ffffff'
                                }}
                            />
                        </div>

                        <div className="flex space-x-2">
                            <button onClick={submitCalibration} className="flex-1 bg-gradient-to-r from-indigo-500 to-purple-600 hover:shadow-lg hover:shadow-indigo-500/30 text-white text-xs py-2 rounded transition-all duration-300 active:scale-95">{t.submit}</button>
                            <button
                              onClick={() => setIsCalibrating(false)}
                              className="px-3 text-xs py-2 rounded transition-colors"
                              style={{
                                backgroundColor: theme === 'light' ? '#e5e7eb' : '#475569',
                                color: theme === 'light' ? '#000000' : '#ffffff'
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor = theme === 'light' ? '#d1d5db' : '#64748b';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = theme === 'light' ? '#e5e7eb' : '#475569';
                              }}
                            >{t.cancel}</button>
                        </div>
                    </div>
                )}

                {selectedNode.isFlagged && !isCalibrating && (
                    <div className="flex items-center space-x-2 p-2 rounded text-xs" style={{
                      color: theme === 'light' ? '#92400e' : '#fbbf24',
                      backgroundColor: theme === 'light' ? '#fef3c7' : '#78350f',
                      border: `1px solid ${theme === 'light' ? '#fde68a' : '#92400e'}`
                    }}>
                        <AlertTriangle size={14} />
                        <span>{t.flagged}</span>
                    </div>
                )}
            </div>
          </div>
      ) : (
          <div className="w-80 shrink-0 flex items-center justify-center border border-dashed rounded-xl text-sm" style={{
            borderColor: theme === 'light' ? '#d1d5db' : '#475569',
            color: theme === 'light' ? '#9ca3af' : '#94a3b8'
          }}>
              <span>Select a node to view details</span>
          </div>
      )}
    </div>
  );
};