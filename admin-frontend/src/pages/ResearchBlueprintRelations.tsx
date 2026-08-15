import { useMemo, useState } from 'react';
import { AlertTriangle, GitBranch, Layers3, Plus, Trash2 } from 'lucide-react';

import { analyzeBlueprintRelations, toBlueprintKey, wouldCreateBlueprintCycle } from '../lib/projectBlueprint';
import type { BlueprintAlternative, ProjectBlueprintConfig } from '../types';

interface ResearchBlueprintRelationsProps {
  config: ProjectBlueprintConfig;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onMutate: (mutate: (draft: ProjectBlueprintConfig) => void) => void;
}

const ALTERNATIVE_LABELS: Record<BlueprintAlternative['kind'], string> = {
  merge: '允许合并',
  split: '允许拆分',
  substitute: '允许替代',
};

const graphLayout = (config: ProjectBlueprintConfig) => {
  const analysis = analyzeBlueprintRelations(config.nodes);
  const layers = analysis.layers.map(layer => [...layer]);
  if (analysis.cycleNodeIds.length) layers.push(analysis.cycleNodeIds);
  const maxRows = Math.max(1, ...layers.map(layer => layer.length));
  const width = Math.max(760, layers.length * 230 + 80);
  const height = Math.max(370, maxRows * 116 + 72);
  const positions = new Map<string, { x: number; y: number }>();

  layers.forEach((layer, layerIndex) => {
    const columnHeight = layer.length * 92 + Math.max(0, layer.length - 1) * 24;
    const startY = Math.max(34, (height - columnHeight) / 2);
    layer.forEach((nodeId, rowIndex) => {
      positions.set(nodeId, { x: 34 + layerIndex * 230, y: startY + rowIndex * 116 });
    });
  });
  return { analysis, positions, width, height };
};

export const ResearchBlueprintRelations = ({
  config,
  selectedNodeId,
  onSelectNode,
  onMutate,
}: ResearchBlueprintRelationsProps) => {
  const [relationError, setRelationError] = useState('');
  const layout = useMemo(() => graphLayout(config), [config]);
  const selectedNode = config.nodes.find(node => node.id === selectedNodeId) ?? config.nodes[0] ?? null;

  const setPrerequisite = (prerequisiteId: string, checked: boolean) => {
    if (!selectedNode) return;
    const next = checked
      ? [...new Set([...selectedNode.prerequisiteIds, prerequisiteId])]
      : selectedNode.prerequisiteIds.filter(id => id !== prerequisiteId);
    if (wouldCreateBlueprintCycle(config.nodes, selectedNode.id, next)) {
      setRelationError('这条关系会形成循环：两个功能将互相等待，无法生成建构层级。');
      return;
    }
    setRelationError('');
    onMutate(draft => {
      const node = draft.nodes.find(item => item.id === selectedNode.id);
      if (node) node.prerequisiteIds = next;
    });
  };

  const addAlternative = () => {
    let index = config.alternatives.length + 1;
    let id = `alternative-${index}`;
    while (config.alternatives.some(item => item.id === id)) id = `alternative-${++index}`;
    onMutate(draft => {
      draft.alternatives.push({
        id,
        kind: 'merge',
        nodeIds: draft.nodes.slice(0, Math.min(2, draft.nodes.length)).map(node => node.id),
        descriptionZh: '说明哪些合理表达可以被视为同一种结构。',
      });
    });
  };

  if (!config.nodes.length) {
    return (
      <section className="blueprint-editor-section">
        <div className="blueprint-empty-callout">
          <GitBranch />
          <strong>先在第 02 部分建立功能模块</strong>
          <span>有了模块边界后，才能设计模块之间的必要关系。</span>
        </div>
      </section>
    );
  }

  return (
    <section className="blueprint-relations">
      <div className="blueprint-relation-main">
        <div className="blueprint-section-heading">
          <div>
            <h4>参考关系图</h4>
            <p>点击模块后，在右侧设置它开始前必须已有的结果；连线只表达必要依赖。</p>
          </div>
          <span className="blueprint-relation-count"><GitBranch /> {config.nodes.reduce((sum, node) => sum + node.prerequisiteIds.length, 0)} 条关系</span>
        </div>

        {(layout.analysis.cycleNodeIds.length > 0 || layout.analysis.unknownReferences.length > 0) && (
          <div className="blueprint-relation-warning">
            <AlertTriangle />
            <span>
              {layout.analysis.cycleNodeIds.length > 0
                ? `检测到循环关系：${layout.analysis.cycleNodeIds.map(id => config.nodes.find(node => node.id === id)?.titleZh ?? id).join('、')}`
                : '存在指向已删除模块的关系，请重新选择前置模块。'}
            </span>
          </div>
        )}

        <div className="blueprint-relation-canvas" role="region" aria-label="教师参考关系图">
          <div className="blueprint-relation-canvas__stage" style={{ width: layout.width, height: layout.height }}>
            <svg viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true">
              <defs>
                <marker id="blueprint-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
                  <path d="M0,0 L0,6 L9,3 z" />
                </marker>
              </defs>
              {config.nodes.flatMap(node => node.prerequisiteIds.map(prerequisiteId => {
                const from = layout.positions.get(prerequisiteId);
                const to = layout.positions.get(node.id);
                if (!from || !to) return null;
                const startX = from.x + 178;
                const startY = from.y + 46;
                const endX = to.x;
                const endY = to.y + 46;
                const bend = Math.max(36, (endX - startX) / 2);
                return (
                  <path
                    key={`${prerequisiteId}-${node.id}`}
                    d={`M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`}
                    markerEnd="url(#blueprint-arrow)"
                  />
                );
              }))}
            </svg>
            {config.nodes.map((node, index) => {
              const position = layout.positions.get(node.id);
              if (!position) return null;
              const inCycle = layout.analysis.cycleNodeIds.includes(node.id);
              return (
                <button
                  key={node.id}
                  className={`blueprint-relation-node ${selectedNode?.id === node.id ? 'is-active' : ''} ${inCycle ? 'is-cycle' : ''}`}
                  style={{ left: position.x, top: position.y }}
                  onClick={() => { setRelationError(''); onSelectNode(node.id); }}
                  aria-pressed={selectedNode?.id === node.id}
                >
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <strong>{node.titleZh}</strong>
                  <small>{node.prerequisiteIds.length ? `${node.prerequisiteIds.length} 个前置结果` : '起点 / 可并行'}</small>
                </button>
              );
            })}
          </div>
        </div>

        <div className="blueprint-build-layers">
          <div className="blueprint-subsection__heading">
            <div><strong>系统推导的参考建构层级</strong><span>用于诊断蓝图是否可执行，不是学生唯一作答顺序</span></div>
            <Layers3 />
          </div>
          {layout.analysis.cycleNodeIds.length === 0 ? (
            <div className="blueprint-layer-track">
              {layout.analysis.layers.map((layer, index) => (
                <div key={`layer-${index}`}>
                  <span>S{index + 1}</span>
                  <p>{layer.map(id => config.nodes.find(node => node.id === id)?.titleZh ?? id).join(' · ')}</p>
                </div>
              ))}
            </div>
          ) : <p className="blueprint-muted">解决循环关系后才能推导层级。</p>}
        </div>
      </div>

      <aside className="blueprint-relation-inspector">
        <div className="blueprint-relation-inspector__section">
          <p className="blueprint-kicker">SELECTED MODULE</p>
          <h4>{selectedNode?.titleZh ?? '未选择模块'}</h4>
          <p>这项功能开始前，必须先获得哪些结果？</p>
          {relationError && <div className="blueprint-inline-error">{relationError}</div>}
          <div className="blueprint-relation-options">
            {config.nodes.filter(node => node.id !== selectedNode?.id).map(node => (
              <label key={node.id} className={selectedNode?.prerequisiteIds.includes(node.id) ? 'is-selected' : ''}>
                <input
                  type="checkbox"
                  checked={selectedNode?.prerequisiteIds.includes(node.id) ?? false}
                  onChange={event => setPrerequisite(node.id, event.target.checked)}
                />
                <span><strong>{node.titleZh}</strong><small>{node.contract.outputs.join('、') || '尚未定义输出'}</small></span>
              </label>
            ))}
          </div>
        </div>

        <div className="blueprint-relation-inspector__section">
          <div className="blueprint-subsection__heading">
            <div><strong>允许的结构变体</strong><span>承认合理拆分、合并或替代表达</span></div>
            <button onClick={addAlternative} disabled={config.nodes.length === 0}><Plus /> 添加</button>
          </div>
          <div className="blueprint-alternatives">
            {config.alternatives.map((alternative, index) => (
              <article key={alternative.id}>
                <div className="blueprint-alternative-topline">
                  <select value={alternative.kind} onChange={event => onMutate(draft => { draft.alternatives[index].kind = event.target.value as BlueprintAlternative['kind']; })}>
                    {Object.entries(ALTERNATIVE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                  </select>
                  <button onClick={() => onMutate(draft => { draft.alternatives.splice(index, 1); })} aria-label="删除结构变体"><Trash2 /></button>
                </div>
                <label><span>规则标识</span><input defaultValue={alternative.id} onBlur={event => {
                  const normalized = toBlueprintKey(event.target.value, alternative.id);
                  if (config.alternatives.some((item, itemIndex) => itemIndex !== index && item.id === normalized)) {
                    setRelationError(`规则标识“${normalized}”已经存在。`);
                    event.currentTarget.value = alternative.id;
                    return;
                  }
                  setRelationError('');
                  onMutate(draft => { draft.alternatives[index].id = normalized; });
                }} /></label>
                <label><span>教师说明</span><textarea value={alternative.descriptionZh} onChange={event => onMutate(draft => { draft.alternatives[index].descriptionZh = event.target.value; })} /></label>
                <div className="blueprint-alternative-nodes">
                  {config.nodes.map(node => (
                    <label key={node.id} className={alternative.nodeIds.includes(node.id) ? 'is-selected' : ''}>
                      <input
                        type="checkbox"
                        checked={alternative.nodeIds.includes(node.id)}
                        onChange={event => {
                          if (!event.target.checked && alternative.nodeIds.length === 1) {
                            setRelationError('每条结构变体至少要关联一个功能；不再需要时可删除整条规则。');
                            return;
                          }
                          setRelationError('');
                          onMutate(draft => {
                            const current = draft.alternatives[index];
                            current.nodeIds = event.target.checked
                              ? [...new Set([...current.nodeIds, node.id])]
                              : current.nodeIds.filter(id => id !== node.id);
                          });
                        }}
                      />
                      {node.titleZh}
                    </label>
                  ))}
                </div>
              </article>
            ))}
            {config.alternatives.length === 0 && <p className="blueprint-muted">尚未配置。学生仍可提出不同表达，但系统暂时无法识别哪些结构可以等价接受。</p>}
          </div>
        </div>
      </aside>
    </section>
  );
};
