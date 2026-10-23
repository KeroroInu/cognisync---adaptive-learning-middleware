import { useEffect, useRef, useState } from 'react';
import { Download, FileText, PenTool, Save } from 'lucide-react';
import { DrawioEditor, EMPTY_DIAGRAM } from './DrawioEditor';
import './TaskDesign.css';

type Node = { id: string; title: string; purpose: string; x: number; y: number };
type Edge = { source: string; target: string };
type Design = { revision: number; requirements: string; nodes: Node[]; edges: Edge[]; drawio_xml?: string };
const EMPTY: Design = { revision: 0, requirements: '', nodes: [], edges: [], drawio_xml: '' };
const escapeXml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));
export function legacyDiagram(design: Design): string {
  if (design.drawio_xml) return design.drawio_xml;
  if (!design.nodes.length) return EMPTY_DIAGRAM;
  // Keep original modules and coordinates. Opening the editor never overwrites history.
  const ids = new Map(design.nodes.map((node, i) => [node.id, 'module-' + i]));
  const nodes = design.nodes.map(node => `<mxCell id="${ids.get(node.id)}" value="${escapeXml(node.title + (node.purpose ? '\n' + node.purpose : ''))}" style="rounded=1;whiteSpace=wrap;html=0;" vertex="1" parent="1"><mxGeometry x="${node.x}" y="${node.y}" width="170" height="84" as="geometry"/></mxCell>`).join('');
  const edges = design.edges.map((edge, i) => `<mxCell id="edge-${i}" edge="1" parent="1" source="${ids.get(edge.source)}" target="${ids.get(edge.target)}"><mxGeometry relative="1" as="geometry"/></mxCell>`).join('');
  return `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${nodes}${edges}</root></mxGraphModel>`;
}
async function request(materialId: string, body?: unknown, signal?: AbortSignal) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ''}/api/materials/${materialId}/design`, {
    method: body ? 'POST' : 'GET', signal: signal ?? AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('cognisync-token') || ''}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : '设计没有保存，请重试');
  return data.data;
}

export function TaskDesign({ materialId, userId, onDirty, tool = 'requirements' }: { materialId: string; userId: string; onDirty: (value: boolean) => void; tool?: 'requirements' | 'board' }) {
  const key = `sfls:design:${userId}:${materialId}`;
  const [design, setDesign] = useState<Design>(EMPTY), [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [localDraft, setLocalDraft] = useState<Design | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0), [editorRevision, setEditorRevision] = useState(0);
  const pendingDraft = useRef<Design | null>(null), draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false), requestId = useRef(crypto.randomUUID());
  const dirtyCallback = useRef(onDirty); dirtyCallback.current = onDirty;
  const currentDesign = useRef(design); currentDesign.current = design;
  const [boardVisited, setBoardVisited] = useState(tool === 'board');
  useEffect(() => { if (tool === 'board') setBoardVisited(true); }, [tool]);
  const editorSave = useRef<(() => void) | null>(null);
  useEffect(() => {
    const controller = new AbortController(); setError('');
    void request(materialId, undefined, controller.signal).then(data => {
      if (controller.signal.aborted) return;
      const remote = data.current ?? EMPTY;
      setDesign(remote); setReady(true);
      try {
        const stored = JSON.parse(localStorage.getItem(key) || 'null');
        if (stored && typeof stored.requirements === 'string' && Array.isArray(stored.nodes) && Array.isArray(stored.edges) && (!stored.drawio_xml || typeof stored.drawio_xml === 'string' && stored.drawio_xml.length <= 250000) && JSON.stringify(stored) !== JSON.stringify(remote)) setLocalDraft(stored);
      } catch { /* Invalid local data never replaces server records. */ }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => { controller.abort(); dirtyCallback.current(false); };
  }, [materialId, key, loadAttempt]);
  useEffect(() => {
    const flush = () => {
      if (!pendingDraft.current) return;
      try { localStorage.setItem(key, JSON.stringify(pendingDraft.current)); pendingDraft.current = null; }
      catch { setError('本机草稿保存失败，请保存到服务器'); }
    };
    window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('pagehide', flush); if (draftTimer.current) clearTimeout(draftTimer.current); flush(); };
  }, [key]);
  useEffect(() => { dirtyCallback.current(dirty); }, [dirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function change(next: Design) {
    if (saving.current) return;
    currentDesign.current = next; setDesign(next); setDirty(true); setNotice(''); requestId.current = crypto.randomUUID();
    pendingDraft.current = next;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      try { localStorage.setItem(key, JSON.stringify(next)); pendingDraft.current = null; }
      catch { setError('本机草稿保存失败，请保存到服务器'); }
    }, 300);
  }
  async function save(xml?: string) {
    if (saving.current) return;
    const snapshot = { ...currentDesign.current, ...(xml !== undefined ? { drawio_xml: xml } : {}) };
    saving.current = true; setBusy(true); setError('');
    try {
      const saved = await request(materialId, { request_id: requestId.current, base_revision: snapshot.revision, requirements: snapshot.requirements, nodes: snapshot.nodes, edges: snapshot.edges, drawio_xml: snapshot.drawio_xml });
      currentDesign.current = saved; setDesign(saved); setDirty(false); setNotice('已保存，可以下载给 SFLS。'); setLocalDraft(null);
      pendingDraft.current = null; if (draftTimer.current) clearTimeout(draftTimer.current);
      try { localStorage.removeItem(key); } catch { /* Server receipt is authoritative. */ }
    } catch (cause) { setError(cause instanceof Error ? cause.message : '没有保存成功'); }
    finally { saving.current = false; setBusy(false); }
  }
  async function download() {
    setError('');
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ''}/api/materials/${materialId}/design/download`, { headers: { Authorization: `Bearer ${localStorage.getItem('cognisync-token') || ''}` }, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('设计下载失败，请重试。');
      const url = URL.createObjectURL(await response.blob()), anchor = document.createElement('a');
      anchor.href = url; anchor.download = '我的设计.zip'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
      setNotice('已下载。将解压得到的 design 文件夹合入本课文件夹，再告诉 SFLS 读取设计；先保留已有修改。');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '下载失败'); }
  }
  return <div className="task-design task-design-studio" aria-label="我的任务设计">
    <header className="task-design-topbar"><h2 className="task-design-title">{tool === 'board' ? <><PenTool size={18} />架构画板</> : <><FileText size={18} />需求文档</>}</h2>
      <div><small>{dirty ? '有未同步修改' : design.revision ? `已保存 · v${design.revision}` : '按需要使用'}</small>
      <button disabled={!ready || busy || dirty || !design.revision} onClick={() => void download()}><Download size={15} />下载设计</button>
      <button className="prep-primary" disabled={!dirty || busy || (!design.revision && !design.requirements.trim() && !design.nodes.length && !design.drawio_xml)} onClick={() => { if (tool === 'board' && editorSave.current) editorSave.current(); else void save(); }}><Save size={15} />{busy ? '保存中…' : '保存设计'}</button></div>
    </header>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {localDraft && <p>本机有未同步草稿。<button disabled={!ready || busy} onClick={() => { change({ ...localDraft, revision: design.revision }); setEditorRevision(n => n + 1); setLocalDraft(null); }}>恢复草稿</button><button onClick={() => { localStorage.removeItem(key); setLocalDraft(null); }}>使用云端版本</button></p>}
    {!ready ? <p>{error ? <button onClick={() => setLoadAttempt(value => value + 1)}>重新读取设计</button> : '正在读取你的设计…'}</p> : <>
      <div hidden={tool !== 'requirements'} className="task-requirements"><span className="studio-eyebrow">我的需求文档</span><h2>先把想法说清楚。</h2><p>想做什么？有哪些规则？怎样算做好了？已有想法写下来就行。</p>
        <label>我的需求<textarea aria-label="我的需求" value={design.requirements} disabled={busy} maxLength={6000} rows={10} placeholder="写下你想做的作品：给谁使用、需要哪些功能、遵循什么规则，以及怎样算完成。" onChange={event => change({ ...design, requirements: event.target.value })} /></label>
        <small>只保存你的表达。已保存的文档和图会随任务包下载，也可单独下载设计。</small>
      </div>
      {boardVisited && <div hidden={tool !== 'board'} className="task-drawio-panel"><DrawioEditor key={editorRevision} saveRequest={editorSave} xml={legacyDiagram(design)} disabled={busy} onChange={xml => { if (xml !== currentDesign.current.drawio_xml) change({ ...currentDesign.current, drawio_xml: xml }); }} onSave={save} /></div>}
    </>}
  </div>;
}
