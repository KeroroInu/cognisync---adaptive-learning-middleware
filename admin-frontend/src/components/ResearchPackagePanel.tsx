import { useRef, useState } from 'react';
import { adminApi } from '../lib/adminApi';

export function ResearchPackagePanel() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [className, setClassName] = useState('');
  const [group, setGroup] = useState('');
  const [identity, setIdentity] = useState(false);
  const [graph, setGraph] = useState(true);
  const lock = useRef(false);
  async function download() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true); setError(''); setMessage('');
    try {
      const params = new URLSearchParams({ include_identity: String(identity), include_graph: String(graph) });
      if (className.trim()) params.set('class_name', className.trim());
      if (group) params.set('group', group);
      const blob = await adminApi.exportCsv(`/export/research-package?${params}`);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `cognisync_research_${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('研究包已交给浏览器下载，请查看其中的 manifest.json 和 README.txt。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '导出失败，请重试');
    } finally { lock.current = false; setBusy(false); }
  }
  return <section className="glass-card rounded-2xl p-6 space-y-4" aria-label="完整研究包">
    <h2 className="text-xl font-bold">课堂研究包</h2>
    <p>一次下载对话、代码与卡片版本、测试与支架事件、课堂点评、问卷原始答卷、课堂互动题与逐人回答和画像快照。附关联字段、行数与文件校验值。</p>
    <div className="flex flex-wrap gap-4 items-end">
      <label>班级（留空为全部）<input className="block border rounded-lg p-2" value={className} maxLength={100}
        onChange={event => setClassName(event.target.value)} disabled={busy} /></label>
      <label>实验组<select className="block border rounded-lg p-2" value={group} onChange={event => setGroup(event.target.value)} disabled={busy}>
        <option value="">全部（含历史组）</option><option value="pdt">项目解构＋AI</option>
        <option value="ai_pbl">常规 AI 协作</option><option value="unassigned">未分组</option><option value="lecture">历史讲授组</option>
      </select></label>
      <label className="flex gap-2 items-center"><input type="checkbox" checked={identity} onChange={event => setIdentity(event.target.checked)} disabled={busy} />包含姓名、学号、邮箱（仅内部核对）</label>
      <label className="flex gap-2 items-center"><input type="checkbox" checked={graph} onChange={event => setGraph(event.target.checked)} disabled={busy} />包含当前知识图谱</label>
      <button onClick={download} disabled={busy} className="px-5 py-3 rounded-xl bg-slate-900 text-white disabled:opacity-50">{busy ? '正在打包…' : '下载研究包 ZIP'}</button>
    </div>
    <p className="text-sm">不是数据库备份或匿名数据：自由文本仍需脱敏。教师蓝图仅供教师分析；图谱是当前快照。超过上限或图谱读取失败会明确报错，不悄悄截断。</p>
    {message && <p role="status">{message}</p>}{error && <p role="alert" className="text-red-600">{error}</p>}
  </section>;
}
