import { useRef, useState } from 'react';
import { adminApi } from '../lib/adminApi';
import { Download } from 'lucide-react';

export function ResearchPackagePanel() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [className, setClassName] = useState('');
  const [identity, setIdentity] = useState(false);
  const [graph, setGraph] = useState(true);
  const [originals, setOriginals] = useState(true);
  const lock = useRef(false);
  async function download() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true); setError(''); setMessage('');
    try {
      const params = new URLSearchParams({ include_identity: String(identity), include_graph: String(graph), include_originals: String(originals) });
      if (className.trim()) params.set('class_name', className.trim());
      const blob = await adminApi.exportCsv(`/export/research-package?${params}`);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `cognisync_research_${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('已开始下载。解压后先看「分析说明.md」，原始记录也在包内。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '导出失败，请重试');
    } finally { lock.current = false; setBusy(false); }
  }
  return <section className="research-download" aria-label="完整研究包" aria-busy={busy}>
    <div className="exports-controls">
      <label>选择班级<select value={className} onChange={event => setClassName(event.target.value)} disabled={busy}>
        <option value="">全部学生（含历史班级）</option><option value="解构班">解构班</option><option value="开发班">开发班</option>
      </select></label>
      <button onClick={download} disabled={busy} className="exports-download"><Download size={18} />{busy ? '正在打包…' : '下载实验数据'}</button>
    </div>
    <div className="exports-included"><h2>一个压缩包，保留完整记录</h2>
      <ul><li>问卷、试卷和课堂投票的题目与回答</li><li>历次提交原件、代码和设计版本</li><li>已采集的对话、时间、支架与操作记录</li><li>教师备注、画像和当前知识图谱</li></ul>
      <p>附 CSV 表格、JSONL 原始数据和分析说明，按学生与任务编号关联。本地 SFLS 记录以学生实际上传的内容为准。</p>
    </div>
    <details className="exports-options"><summary>导出选项与数据说明</summary>
      <label><input type="checkbox" checked={identity} onChange={event => setIdentity(event.target.checked)} disabled={busy} />包含姓名、学号、邮箱（仅内部核对）</label>
      <label><input type="checkbox" checked={graph} onChange={event => setGraph(event.target.checked)} disabled={busy} />包含当前知识图谱</label>
      <label><input type="checkbox" checked={originals} onChange={event => setOriginals(event.target.checked)} disabled={busy} />包含上传原件</label>
      {!originals && <p>本次只下载完整结构化数据、可解析的 SFLS 日志索引和原件清单，不附作品 ZIP。原件仍保存在服务器，可在任务收件处下载。</p>}
      <p>默认以学生编号关联，自由文本仍需脱敏。密码、登录令牌和课堂密钥通知不导出；上传原件也请勿夹带密钥。图谱是当前快照，不代表每节课的历史状态。</p>
      <p>超过打包上限时，可分班导出，或取消“包含上传原件”后下载分析数据，再到任务收件处下载原件。不截断记录。</p>
    </details>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
