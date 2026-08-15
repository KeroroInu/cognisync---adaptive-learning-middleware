import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BookOpenCheck,
  Boxes,
  Check,
  CircleDot,
  FileStack,
  FlaskConical,
  GitBranch,
  Loader,
  Plus,
  Save,
  Send,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';

import { adminApi } from '../lib/adminApi';
import {
  cloneBlueprint,
  createBlueprintNode,
  createEmptyBlueprint,
  createPhenomenon,
  splitBlueprintList,
  toBlueprintKey,
  wouldCreateBlueprintCycle,
} from '../lib/projectBlueprint';
import type {
  BlueprintKnowledgeResponsibility,
  BlueprintNode,
  BlueprintStage,
  ProjectBlueprintConfig,
  ProjectBlueprintVersion,
  ResearchTask,
} from '../types';
import { ResearchBlueprintRelations } from './ResearchBlueprintRelations';
import { ResearchBlueprintScaffolds } from './ResearchBlueprintScaffolds';
import { ResearchBlueprintTests } from './ResearchBlueprintTests';
import './ResearchBlueprintEditor.css';

type BlueprintTab = 'phenomena' | 'modules' | 'relations' | 'tests' | 'scaffolds';

interface ResearchBlueprintEditorProps {
  task: ResearchTask;
  onClose: () => void;
  onPublished: (blueprintVersionId: string) => void | Promise<void>;
}

const RESPONSIBILITY_LABELS: Record<BlueprintKnowledgeResponsibility, string> = {
  student_core: '学生核心判断',
  ai_supported: 'AI 可提供支架',
  generated_process: '过程自动生成',
};

const compactDate = (value: string): string => new Date(value).toLocaleString('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export const ResearchBlueprintEditor = ({ task, onClose, onPublished }: ResearchBlueprintEditorProps) => {
  const [versions, setVersions] = useState<ProjectBlueprintVersion[]>([]);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  const [config, setConfig] = useState<ProjectBlueprintConfig | null>(null);
  const [tab, setTab] = useState<BlueprintTab>('phenomena');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedScaffoldStage, setSelectedScaffoldStage] = useState<BlueprintStage>('observe');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [currentPublishedVersionId, setCurrentPublishedVersionId] = useState(task.current_blueprint_version_id);

  const activeVersion = versions.find(version => version.id === activeVersionId) ?? null;
  const selectedNode = config?.nodes.find(node => node.id === selectedNodeId) ?? null;
  const publishReady = Boolean(config?.phenomena.length && config?.nodes.length);

  const requestClose = () => {
    if (dirty && !window.confirm('当前蓝图还有未保存修改，确定关闭吗？')) return;
    onClose();
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        const result = await adminApi.getProjectBlueprints(task.id);
        if (cancelled) return;
        setVersions(result.blueprints);
        const latest = result.blueprints[0];
        if (latest) {
          setActiveVersionId(latest.id);
          setConfig(cloneBlueprint(latest.config));
          setSelectedNodeId(latest.config.nodes[0]?.id ?? null);
        } else {
          setConfig(createEmptyBlueprint(task));
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : '蓝图加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [task]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      requestClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const mutateConfig = (mutate: (draft: ProjectBlueprintConfig) => void) => {
    setConfig(current => {
      if (!current) return current;
      const next = cloneBlueprint(current);
      mutate(next);
      return next;
    });
    setDirty(true);
    setNotice('');
  };

  const selectVersion = (version: ProjectBlueprintVersion) => {
    if (dirty && !window.confirm('当前修改尚未保存，确定切换版本吗？')) return;
    setActiveVersionId(version.id);
    setConfig(cloneBlueprint(version.config));
    setSelectedNodeId(version.config.nodes[0]?.id ?? null);
    setDirty(false);
    setError('');
    setNotice('');
  };

  const upsertVersion = (version: ProjectBlueprintVersion) => {
    setVersions(current => [version, ...current.filter(item => item.id !== version.id)]
      .sort((a, b) => b.version - a.version));
    setActiveVersionId(version.id);
  };

  const persistDraft = async (): Promise<ProjectBlueprintVersion> => {
    if (!config) throw new Error('蓝图尚未载入');
    if (!config.projectKey.trim() || !config.demoKey.trim() || !config.titleZh.trim()) {
      throw new Error('项目标识、演示标识和蓝图名称不能为空');
    }
    const normalized: ProjectBlueprintConfig = {
      ...config,
      projectKey: toBlueprintKey(config.projectKey, `project-${task.id.slice(0, 8)}`),
      demoKey: toBlueprintKey(config.demoKey, 'project-demo'),
    };
    const saved = await adminApi.saveProjectBlueprintDraft(task.id, normalized);
    setConfig(cloneBlueprint(saved.config));
    upsertVersion(saved);
    setDirty(false);
    return saved;
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError('');
      const saved = await persistDraft();
      setNotice(`草稿 v${saved.version} 已保存`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!publishReady) {
      setError('发布前至少需要一个观察现象和一个功能模块');
      return;
    }
    try {
      setPublishing(true);
      setError('');
      const draft = await persistDraft();
      const published = await adminApi.publishProjectBlueprint(task.id, draft.id);
      upsertVersion(published);
      setCurrentPublishedVersionId(published.id);
      setNotice(`蓝图 v${published.version} 已发布，学生新提交将绑定此版本`);
      await onPublished(published.id);
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : '发布失败');
    } finally {
      setPublishing(false);
    }
  };

  const addPhenomenon = () => {
    mutateConfig(draft => { draft.phenomena.push(createPhenomenon(draft.phenomena.length + 1)); });
  };

  const addNode = () => {
    const next = createBlueprintNode((config?.nodes.length ?? 0) + 1);
    while (config?.nodes.some(node => node.id === next.id)) next.id = `${next.id}-new`;
    mutateConfig(draft => { draft.nodes.push(next); });
    setSelectedNodeId(next.id);
    setTab('modules');
  };

  const updateNode = (nodeId: string, mutate: (node: BlueprintNode) => void) => {
    mutateConfig(draft => {
      const node = draft.nodes.find(item => item.id === nodeId);
      if (node) mutate(node);
    });
  };

  const updateNodeId = (oldId: string, nextId: string) => {
    const normalized = toBlueprintKey(nextId, oldId);
    if (config?.nodes.some(node => node.id === normalized && node.id !== oldId)) {
      setError(`模块标识“${normalized}”已存在`);
      return;
    }
    mutateConfig(draft => {
      const node = draft.nodes.find(item => item.id === oldId);
      if (!node) return;
      node.id = normalized;
      draft.nodes.forEach(item => {
        item.prerequisiteIds = item.prerequisiteIds.map(id => id === oldId ? normalized : id);
      });
      draft.alternatives.forEach(item => {
        item.nodeIds = item.nodeIds.map(id => id === oldId ? normalized : id);
      });
    });
    setSelectedNodeId(normalized);
  };

  const removeNode = (nodeId: string) => {
    mutateConfig(draft => {
      draft.nodes = draft.nodes.filter(node => node.id !== nodeId);
      draft.nodes.forEach(node => {
        node.prerequisiteIds = node.prerequisiteIds.filter(id => id !== nodeId);
      });
      draft.alternatives = draft.alternatives
        .map(item => ({ ...item, nodeIds: item.nodeIds.filter(id => id !== nodeId) }))
        .filter(item => item.nodeIds.length > 0);
    });
    setSelectedNodeId(current => current === nodeId ? null : current);
  };

  const toggleNodePrerequisite = (nodeId: string, prerequisiteId: string, checked: boolean) => {
    if (!config) return;
    const node = config.nodes.find(item => item.id === nodeId);
    if (!node) return;
    const next = checked
      ? [...new Set([...node.prerequisiteIds, prerequisiteId])]
      : node.prerequisiteIds.filter(id => id !== prerequisiteId);
    if (wouldCreateBlueprintCycle(config.nodes, nodeId, next)) {
      setError('这条前置关系会形成循环，请到第 03 部分检查整体关系图。');
      return;
    }
    setError('');
    updateNode(nodeId, current => { current.prerequisiteIds = next; });
  };

  const nodeDependencyCount = useMemo(() => config?.nodes.reduce(
    (total, node) => total + node.prerequisiteIds.length,
    0,
  ) ?? 0, [config]);

  return createPortal(
    <div className="blueprint-overlay" role="dialog" aria-modal="true" aria-label={`${task.title} 项目蓝图编辑器`}>
      <div className="blueprint-studio">
        <header className="blueprint-studio__header">
          <div className="blueprint-studio__brand">
            <span className="blueprint-studio__mark"><GitBranch size={22} /></span>
            <div>
              <p>COGNISYNC / BLUEPRINT STUDIO</p>
              <h2>{task.title}</h2>
            </div>
          </div>
          <div className="blueprint-studio__header-actions">
            <span className={`blueprint-state ${dirty ? 'is-dirty' : ''}`}>
              {dirty ? '有未保存修改' : activeVersion ? `v${activeVersion.version} · ${activeVersion.status === 'published' ? '已发布' : '草稿'}` : '新蓝图'}
            </span>
            <button className="blueprint-icon-button" onClick={requestClose} aria-label="关闭蓝图编辑器"><X /></button>
          </div>
        </header>

        <div className="blueprint-studio__body">
          <aside className="blueprint-version-rail">
            <div className="blueprint-section-label"><FileStack size={16} /> 版本记录</div>
            <div className="blueprint-version-list">
              {versions.map(version => (
                <button
                  key={version.id}
                  className={`blueprint-version-card ${activeVersionId === version.id ? 'is-active' : ''}`}
                  onClick={() => selectVersion(version)}
                >
                  <span className="blueprint-version-card__top">
                    <strong>VERSION {String(version.version).padStart(2, '0')}</strong>
                    <em className={version.status === 'published' ? 'is-published' : ''}>
                      {version.status === 'published' ? '已发布' : '草稿'}
                    </em>
                  </span>
                  <span>{compactDate(version.updated_at)}</span>
                  <code>{version.content_hash.slice(0, 10)}</code>
                  {currentPublishedVersionId === version.id && <small><Check size={13} /> 学生当前版本</small>}
                </button>
              ))}
              {versions.length === 0 && (
                <div className="blueprint-empty-version">
                  <FileStack size={24} />
                  <p>尚无版本</p>
                  <span>第一次保存后生成 v1 草稿</span>
                </div>
              )}
            </div>
            <div className="blueprint-rail-note">
              <BookOpenCheck size={17} />
              <p>发布版本不可覆盖。学生开始任务后会冻结所用版本，保证研究数据可追溯。</p>
            </div>
          </aside>

          <main className="blueprint-workspace">
            {loading || !config ? (
              <div className="blueprint-loading"><Loader className="animate-spin" /> 正在读取教师蓝图…</div>
            ) : (
              <>
                <section className="blueprint-workspace__topbar">
                  <div>
                    <p className="blueprint-kicker">教师预设 / 学生不可见完整答案</p>
                    <h3>给学生留出判断空间，只固定项目边界</h3>
                  </div>
                  <div className="blueprint-primary-actions">
                    <button className="blueprint-button is-secondary" onClick={handleSave} disabled={saving || publishing}>
                      {saving ? <Loader className="animate-spin" /> : <Save />} 保存草稿
                    </button>
                    <button className="blueprint-button is-primary" onClick={handlePublish} disabled={saving || publishing}>
                      {publishing ? <Loader className="animate-spin" /> : <Send />} 发布版本
                    </button>
                  </div>
                </section>

                {(error || notice) && (
                  <div className={`blueprint-message ${error ? 'is-error' : 'is-success'}`}>{error || notice}</div>
                )}

                <section className="blueprint-identity-grid">
                  <label>
                    <span>蓝图名称</span>
                    <input value={config.titleZh} onChange={event => mutateConfig(draft => { draft.titleZh = event.target.value; })} />
                  </label>
                  <label>
                    <span>项目标识</span>
                    <input value={config.projectKey} onChange={event => mutateConfig(draft => { draft.projectKey = event.target.value; })} />
                  </label>
                  <label>
                    <span>演示标识</span>
                    <input value={config.demoKey} onChange={event => mutateConfig(draft => { draft.demoKey = event.target.value; })} />
                  </label>
                </section>

                <nav className="blueprint-tabs" aria-label="蓝图编辑部分">
                  <button className={tab === 'phenomena' ? 'is-active' : ''} onClick={() => setTab('phenomena')}>
                    <CircleDot /> 01 可观察现象 <strong>{config.phenomena.length}</strong>
                  </button>
                  <button className={tab === 'modules' ? 'is-active' : ''} onClick={() => setTab('modules')}>
                    <Boxes /> 02 功能模块与契约 <strong>{config.nodes.length}</strong>
                  </button>
                  <button className={tab === 'relations' ? 'is-active' : ''} onClick={() => setTab('relations')}>
                    <GitBranch /> 03 关系与实现路径 <strong>{nodeDependencyCount}</strong>
                  </button>
                  <button className={tab === 'tests' ? 'is-active' : ''} onClick={() => setTab('tests')}>
                    <FlaskConical /> 04 测试与建构支架 <strong>{config.nodes.reduce((sum, node) => sum + node.tests.length, 0)}</strong>
                  </button>
                  <button className={tab === 'scaffolds' ? 'is-active' : ''} onClick={() => setTab('scaffolds')}>
                    <ShieldCheck /> 05 L0–L3 辅导边界 <strong>{Object.keys(config.scaffoldPolicy.stageLevels).length}</strong>
                  </button>
                </nav>

                {tab === 'phenomena' ? (
                  <section className="blueprint-editor-section">
                    <div className="blueprint-section-heading">
                      <div>
                        <h4>学生运行完整项目时，能够观察到什么？</h4>
                        <p>这里只定义可引用的运行证据，不替学生解释现象背后的机制。</p>
                      </div>
                      <button className="blueprint-button is-compact" onClick={addPhenomenon}><Plus /> 添加现象</button>
                    </div>
                    <div className="blueprint-phenomena-list">
                      {config.phenomena.map((phenomenon, index) => (
                        <article className="blueprint-phenomenon" key={`${activeVersionId ?? 'new'}-${index}`}>
                          <span className="blueprint-card-index">{String(index + 1).padStart(2, '0')}</span>
                          <div className="blueprint-form-grid">
                            <label className="span-2">
                              <span>现象描述</span>
                              <input value={phenomenon.labelZh} onChange={event => mutateConfig(draft => { draft.phenomena[index].labelZh = event.target.value; })} />
                            </label>
                            <label>
                              <span>引用标识</span>
                              <input defaultValue={phenomenon.id} onBlur={event => mutateConfig(draft => { draft.phenomena[index].id = toBlueprintKey(event.target.value, `phenomenon-${index + 1}`); })} />
                            </label>
                            <label>
                              <span>证据类型</span>
                              <select value={phenomenon.evidenceType} onChange={event => mutateConfig(draft => { draft.phenomena[index].evidenceType = event.target.value; })}>
                                <option value="runtime_event">运行事件</option>
                                <option value="visual_change">画面变化</option>
                                <option value="score_change">数值变化</option>
                                <option value="error_state">边界/错误状态</option>
                              </select>
                            </label>
                            <label className="span-2">
                              <span>教师备注（学生不可见）</span>
                              <textarea value={phenomenon.descriptionZh ?? ''} onChange={event => mutateConfig(draft => { draft.phenomena[index].descriptionZh = event.target.value; })} />
                            </label>
                          </div>
                          <div className="blueprint-card-actions">
                            <label className="blueprint-check"><input type="checkbox" checked={phenomenon.required} onChange={event => mutateConfig(draft => { draft.phenomena[index].required = event.target.checked; })} /> 必须观察</label>
                            <button onClick={() => mutateConfig(draft => { draft.phenomena.splice(index, 1); })} aria-label="删除现象"><Trash2 /></button>
                          </div>
                        </article>
                      ))}
                      {config.phenomena.length === 0 && (
                        <button className="blueprint-empty-callout" onClick={addPhenomenon}>
                          <CircleDot />
                          <strong>先添加一个可观察现象</strong>
                          <span>例如画面变化、输入响应或边界状态，但不要在这里写出机制答案。</span>
                        </button>
                      )}
                    </div>
                  </section>
                ) : tab === 'modules' ? (
                  <section className="blueprint-module-layout">
                    <div className="blueprint-module-list">
                      <div className="blueprint-module-list__header">
                        <div><strong>功能卡蓝图</strong><span>定义允许学生发现的模块边界</span></div>
                        <button onClick={addNode} aria-label="添加功能模块"><Plus /></button>
                      </div>
                      <div className="blueprint-module-list__scroll">
                        {config.nodes.map((node, index) => (
                          <button
                            key={node.id}
                            className={selectedNodeId === node.id ? 'is-active' : ''}
                            onClick={() => setSelectedNodeId(node.id)}
                          >
                            <span>{String(index + 1).padStart(2, '0')}</span>
                            <div><strong>{node.titleZh}</strong><small>{node.prerequisiteIds.length ? `依赖 ${node.prerequisiteIds.length} 个模块` : '可作为起点或并行任务'}</small></div>
                          </button>
                        ))}
                        {config.nodes.length === 0 && <p className="blueprint-module-empty">添加第一张功能卡，开始定义项目边界。</p>}
                      </div>
                    </div>

                    <div className="blueprint-module-editor">
                      {selectedNode ? (
                        <>
                          <div className="blueprint-module-editor__title">
                            <div><span>MODULE CONTRACT</span><h4>{selectedNode.titleZh}</h4></div>
                            <button onClick={() => removeNode(selectedNode.id)}><Trash2 /> 删除模块</button>
                          </div>
                          <div className="blueprint-form-grid">
                            <label className="span-2"><span>功能职责</span><input value={selectedNode.titleZh} onChange={event => updateNode(selectedNode.id, node => { node.titleZh = event.target.value; })} /></label>
                            <label><span>模块标识</span><input key={selectedNode.id} defaultValue={selectedNode.id} onBlur={event => updateNodeId(selectedNode.id, event.target.value)} /></label>
                            <label><span>同义表达（逗号分隔）</span><input key={`${selectedNode.id}-synonyms`} defaultValue={selectedNode.synonyms.join('，')} onBlur={event => updateNode(selectedNode.id, node => { node.synonyms = splitBlueprintList(event.target.value); })} /></label>
                            <label className="span-2"><span>出现在哪种运行情境</span><textarea value={selectedNode.scenarioZh} onChange={event => updateNode(selectedNode.id, node => { node.scenarioZh = event.target.value; })} placeholder="描述学生在什么现象或问题中需要意识到这个功能，不写实现答案" /></label>
                            <label><span>输入（逗号或换行分隔）</span><textarea key={`${selectedNode.id}-inputs`} defaultValue={selectedNode.contract.inputs.join('，')} onBlur={event => updateNode(selectedNode.id, node => { node.contract.inputs = splitBlueprintList(event.target.value); })} /></label>
                            <label><span>输出（逗号或换行分隔）</span><textarea key={`${selectedNode.id}-outputs`} defaultValue={selectedNode.contract.outputs.join('，')} onBlur={event => updateNode(selectedNode.id, node => { node.contract.outputs = splitBlueprintList(event.target.value); })} /></label>
                            <label><span>前置条件</span><textarea key={`${selectedNode.id}-pre`} defaultValue={selectedNode.contract.preconditions.join('\n')} onBlur={event => updateNode(selectedNode.id, node => { node.contract.preconditions = splitBlueprintList(event.target.value); })} /></label>
                            <label><span>完成后应满足</span><textarea key={`${selectedNode.id}-post`} defaultValue={selectedNode.contract.postconditions.join('\n')} onBlur={event => updateNode(selectedNode.id, node => { node.contract.postconditions = splitBlueprintList(event.target.value); })} /></label>
                          </div>

                          <div className="blueprint-subsection">
                            <div className="blueprint-subsection__heading"><div><strong>前置关系</strong><span>只勾选实现此模块前必须已有的结果</span></div></div>
                            <div className="blueprint-prerequisites">
                              {config.nodes.filter(node => node.id !== selectedNode.id).map(node => (
                                <label key={node.id} className={selectedNode.prerequisiteIds.includes(node.id) ? 'is-selected' : ''}>
                                  <input
                                    type="checkbox"
                                    checked={selectedNode.prerequisiteIds.includes(node.id)}
                                    onChange={event => toggleNodePrerequisite(selectedNode.id, node.id, event.target.checked)}
                                  />
                                  <GitBranch /> {node.titleZh}
                                </label>
                              ))}
                              {config.nodes.length < 2 && <span className="blueprint-muted">添加其他模块后可设置前置关系。</span>}
                            </div>
                          </div>

                          <div className="blueprint-subsection">
                            <div className="blueprint-subsection__heading">
                              <div><strong>知识责任</strong><span>明确哪些判断必须由学生完成</span></div>
                              <button onClick={() => updateNode(selectedNode.id, node => { node.knowledge.push({ labelZh: '待定义知识点', responsibility: 'student_core' }); })}><Plus /> 添加</button>
                            </div>
                            <div className="blueprint-knowledge-list">
                              {selectedNode.knowledge.map((item, index) => (
                                <div key={`${item.labelZh}-${index}`}>
                                  <input value={item.labelZh} onChange={event => updateNode(selectedNode.id, node => { node.knowledge[index].labelZh = event.target.value; })} />
                                  <select value={item.responsibility} onChange={event => updateNode(selectedNode.id, node => { node.knowledge[index].responsibility = event.target.value as BlueprintKnowledgeResponsibility; })}>
                                    {Object.entries(RESPONSIBILITY_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                                  </select>
                                  <button onClick={() => updateNode(selectedNode.id, node => { node.knowledge.splice(index, 1); })}><X /></button>
                                </div>
                              ))}
                              {selectedNode.knowledge.length === 0 && <span className="blueprint-muted">尚未标注知识责任，发布不受影响，但不利于后续支架控制。</span>}
                            </div>
                          </div>

                          <label className="blueprint-required-toggle"><input type="checkbox" checked={selectedNode.required} onChange={event => updateNode(selectedNode.id, node => { node.required = event.target.checked; })} /> 这是完整项目必须具备的功能</label>
                        </>
                      ) : (
                        <button className="blueprint-empty-callout" onClick={addNode}>
                          <Boxes /><strong>添加并选择一张功能卡</strong><span>再定义职责、输入输出和知识责任。</span>
                        </button>
                      )}
                    </div>
                  </section>
                ) : tab === 'relations' ? (
                  <ResearchBlueprintRelations
                    config={config}
                    selectedNodeId={selectedNodeId}
                    onSelectNode={setSelectedNodeId}
                    onMutate={mutateConfig}
                  />
                ) : tab === 'tests' ? (
                  <ResearchBlueprintTests
                    config={config}
                    selectedNodeId={selectedNodeId}
                    onSelectNode={setSelectedNodeId}
                    onMutate={mutateConfig}
                  />
                ) : (
                  <ResearchBlueprintScaffolds
                    config={config}
                    selectedStage={selectedScaffoldStage}
                    onSelectStage={setSelectedScaffoldStage}
                    onMutate={mutateConfig}
                  />
                )}
              </>
            )}
          </main>
        </div>
      </div>
    </div>,
    document.body,
  );
};
