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
}

export const KnowledgeGraph: React.FC<Props> = ({ nodes, edges, onNodeUpdate, onLogCalibration, language }) => {
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
        .attr("stroke", "#334155")
        .attr("stroke-width", 1.5);

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
        .attr("fill", "#cbd5e1")
        .attr("font-size", "10px")
        .attr("font-weight", "500")
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
      <div ref={containerRef} className="flex-1 bg-slate-900 border border-slate-800 rounded-xl relative overflow-hidden flex flex-col">
         {/* Controls */}
         <div className="absolute top-4 left-4 z-10 w-64">
            <div className="relative">
                <Search size={16} className="absolute left-3 top-3 text-slate-500" />
                <input 
                    type="text" 
                    placeholder={t.searchConcept}
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="w-full bg-slate-950/80 backdrop-blur border border-slate-700 rounded-lg py-2 pl-9 pr-4 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                />
            </div>
         </div>
         
         {/* Legends */}
         <div className="absolute bottom-4 left-4 z-10 flex space-x-4 bg-slate-950/80 p-2 rounded-lg border border-slate-800">
            <div className="flex items-center space-x-1"><div className="w-3 h-3 rounded-full bg-rose-500"></div><span className="text-xs text-slate-400">{t.legendWeak}</span></div>
            <div className="flex items-center space-x-1"><div className="w-3 h-3 rounded-full bg-amber-500"></div><span className="text-xs text-slate-400">{t.legendDeveloping}</span></div>
            <div className="flex items-center space-x-1"><div className="w-3 h-3 rounded-full bg-emerald-500"></div><span className="text-xs text-slate-400">{t.legendMastered}</span></div>
         </div>

         {/* SVG Visualization */}
         <svg ref={svgRef} className="w-full h-full cursor-grab active:cursor-grabbing bg-slate-950/50"></svg>
      </div>

      {/* Detail Sidebar */}
      {selectedNode ? (
          <div className="w-80 shrink-0 bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col h-full overflow-y-auto animate-in slide-in-from-right duration-300">
            <div className="flex justify-between items-start mb-4">
                <h3 className="text-xl font-bold text-slate-100">{selectedNode.name}</h3>
                <button onClick={() => setSelectedNode(null)} className="text-slate-500 hover:text-slate-300"><X size={20}/></button>
            </div>
            
            <div className="space-y-6">
                <div>
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t.masteryLevel}</span>
                    <div className="flex items-center space-x-3 mt-2">
                        <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${selectedNode.mastery}%`, backgroundColor: getNodeColor(selectedNode.mastery) }}></div>
                        </div>
                        <span className="text-sm font-mono text-slate-300">{selectedNode.mastery}%</span>
                    </div>
                </div>

                <div>
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t.definition}</span>
                    <p className="text-sm text-slate-400 mt-1 leading-relaxed">{selectedNode.description}</p>
                </div>

                {/* Evidence Section */}
                <div className="bg-slate-800/50 rounded-lg p-3">
                    <span className="text-xs font-semibold text-indigo-400 uppercase tracking-wider block mb-2">{t.evidenceSection}</span>
                    <p className="text-xs text-slate-400 italic">"User correctly identified gradient descent usage in turn #4..."</p>
                </div>

                {/* Calibration Section */}
                {!isCalibrating ? (
                     <button 
                        onClick={() => setIsCalibrating(true)}
                        className="w-full py-2 flex items-center justify-center space-x-2 border border-slate-600 rounded-lg text-slate-300 hover:bg-slate-800 hover:border-slate-500 transition-colors text-sm"
                     >
                        <Edit3 size={14} />
                        <span>{t.disagree}</span>
                     </button>
                ) : (
                    <div className="bg-slate-800 rounded-lg p-4 space-y-4 border border-indigo-500/30">
                        <h4 className="text-sm font-semibold text-indigo-300">{t.calibrateNode}</h4>
                        
                        <div>
                            <label className="text-xs text-slate-400 block mb-1">{t.yourEstimate}</label>
                            <input 
                                type="range" 
                                min="0" max="100" 
                                value={calibrateValue} 
                                onChange={(e) => setCalibrateValue(parseInt(e.target.value))}
                                className="w-full accent-indigo-500"
                            />
                            <div className="text-right text-xs text-indigo-400 font-mono">{calibrateValue}%</div>
                        </div>

                        <div>
                            <label className="text-xs text-slate-400 block mb-1">{t.reason}</label>
                            <textarea 
                                value={calibrateReason}
                                onChange={e => setCalibrateReason(e.target.value)}
                                className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-xs text-slate-200"
                                rows={2}
                                placeholder="..."
                            />
                        </div>

                        <div className="flex space-x-2">
                            <button onClick={submitCalibration} className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs py-2 rounded">{t.submit}</button>
                            <button onClick={() => setIsCalibrating(false)} className="px-3 bg-slate-700 hover:bg-slate-600 text-white text-xs py-2 rounded">{t.cancel}</button>
                        </div>
                    </div>
                )}
                
                {selectedNode.isFlagged && !isCalibrating && (
                    <div className="flex items-center space-x-2 text-amber-500 bg-amber-500/10 p-2 rounded text-xs">
                        <AlertTriangle size={14} />
                        <span>{t.flagged}</span>
                    </div>
                )}
            </div>
          </div>
      ) : (
          <div className="w-80 shrink-0 flex items-center justify-center border border-dashed border-slate-800 rounded-xl text-slate-600">
              <span className="text-sm">Select a node to view details</span>
          </div>
      )}
    </div>
  );
};