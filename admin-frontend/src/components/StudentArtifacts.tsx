import { useEffect, useRef, useState } from 'react';
import { Code2, Download, FileText, MessageSquare, RefreshCw } from 'lucide-react';
import { studentArtifactsApi, type StudentArtifactDetail, type StudentArtifactSummary } from '../lib/studentArtifacts';
import './StudentArtifacts.css';

export function artifactDate(value: string | null): string {
  if (!value) return '时间未记录';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '时间未记录' : date.toLocaleString('zh-CN', { hour12: false });
}

function ArtifactNotice({ error, retry }: { error: string; retry: () => void }) {
  return <div className="student-artifact-error" role="alert"><span>{error}</span><button type="button" onClick={retry}>重试</button></div>;
}

/** These are source excerpts, not HTML or an automatically inferred learning score. */
export function ArtifactContents({ detail }: { detail: StudentArtifactDetail }) {
  const [section, setSection] = useState<'code' | 'messages' | 'readme'>(() => detail.code_files.length ? 'code' : detail.messages.length ? 'messages' : 'readme');
  const [fileIndex, setFileIndex] = useState(0);
  const [visibleMessages, setVisibleMessages] = useState(40);
  const file = detail.code_files[fileIndex] ?? detail.code_files[0];
  const messageCount = detail.evidence.message_count;
  const missing = [
    !detail.evidence.has_events && '过程事件',
    !detail.evidence.has_sessions && 'SFLS 会话文件',
    !detail.evidence.code_file_count && '源代码',
  ].filter(Boolean);

  return <div className="student-artifact-contents">
    <div className="student-artifact-facts">
      <span>{detail.evidence.code_file_count} 个代码文件</span><span>{detail.evidence.message_count_is_lower_bound ? '至少 ' : ''}{messageCount} 条学生 / AI 发言</span>
      <span>{detail.evidence.has_events ? '含过程事件' : '未发现过程事件'}</span>
      {detail.manual_import && <span>手工压缩补交</span>}
    </div>
    {missing.length > 0 && <p className="student-artifact-warning">此包未发现：{missing.join('、')}。这不代表学生没有完成；请核对原文件夹。</p>}
    {detail.warnings.length > 0 && <details className="student-artifact-warning"><summary>预览提示（{detail.warnings.length}）</summary><ul>{detail.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></details>}
    <div className="student-artifact-tabs" role="tablist" aria-label="提交包内容">
      {([
        { key: 'code', label: '源代码', Icon: Code2 },
        { key: 'messages', label: 'SFLS 对话', Icon: MessageSquare },
        { key: 'readme', label: 'README 回顾', Icon: FileText },
      ] as const).map(({ key, label, Icon }) => <button key={key} type="button" role="tab" aria-selected={section === key} aria-controls={`artifact-panel-${detail.receipt_id}`} onClick={() => setSection(key)}><Icon size={16} />{label}</button>)}
    </div>
    <div role="tabpanel" id={`artifact-panel-${detail.receipt_id}`} className="student-artifact-panel">
      {section === 'code' && <>
        {file ? <>
          <label className="student-artifact-file-label">代码文件<select value={fileIndex} onChange={event => setFileIndex(Number(event.target.value))}>{detail.code_files.map((item, index) => <option key={item.path} value={index}>{item.path}</option>)}</select></label>
          <pre className="student-artifact-source" tabIndex={0} aria-label={file.path}>{file.text || '（文件内容为空）'}</pre>
          {file.truncated && <p className="student-artifact-muted">文件较长，此处仅预览前段；完整内容在作品包中。</p>}
        </> : <p className="student-artifact-empty">此提交包中未发现可预览的源代码，可下载作品包核对。</p>}
      </>}
      {section === 'messages' && <>
        <p className="student-artifact-muted">按原会话记录排列。这里只展示学生与 SFLS 的发言，工具调用等原始记录保留在作品包中。</p>
        {!detail.messages.length ? <p className="student-artifact-empty">此提交包没有可预览的学生 / AI 对话；代码和 README 可单独查看。</p> : <div className="student-artifact-messages">{detail.messages.slice(0, visibleMessages).map((message, index) => <article key={`${message.session_path}-${message.line}-${index}`} className={`student-artifact-message is-${message.role}`}>
          <header><strong>{message.role === 'user' ? '学生' : 'SFLS'}</strong><time>{artifactDate(message.at)}</time></header>
          <pre>{message.text}</pre>
          {message.truncated && <p className="student-artifact-muted">此条内容较长，仅预览前段。</p>}
        </article>)}</div>}
        {visibleMessages < detail.messages.length && <button type="button" className="student-artifact-more" onClick={() => setVisibleMessages(value => value + 40)}>继续看后面的对话（还有 {detail.messages.length - visibleMessages} 条）</button>}
        {detail.evidence.truncated && <p className="student-artifact-muted">对话较长，当前为部分预览。完整记录请下载作品包查看。</p>}
      </>}
      {section === 'readme' && <>
        {detail.readme ? <>
          {detail.readme.is_template && <p className="student-artifact-warning">README 看起来仍是初始模板，尚未写入本次作品回顾。这不影响已收到的代码和对话。</p>}
          <p className="student-artifact-path">{detail.readme.path}</p>
          <pre className="student-artifact-readme" tabIndex={0}>{detail.readme.text || '（文件内容为空）'}</pre>
          {detail.readme.truncated && <p className="student-artifact-muted">README 较长，仅显示前段；完整版在作品包中。</p>}
        </> : <p className="student-artifact-empty">此提交包中没有 README，仍可查看代码和 SFLS 对话。</p>}
      </>}
    </div>
  </div>;
}

function StudentArtifactsContent({ userId }: { userId: string }) {
  const [items, setItems] = useState<StudentArtifactSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState('');
  const [detail, setDetail] = useState<StudentArtifactDetail | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [detailRetry, setDetailRetry] = useState(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setListLoading(true); setListError('');
    studentArtifactsApi.list(userId, page, controller.signal).then(result => {
      if (!active) return;
      setItems(previous => page === 1 ? result.items : [...previous, ...result.items.filter(item => !previous.some(old => old.receipt_id === item.receipt_id))]);
      setTotal(result.total);
      if (page === 1) setSelected(previous => result.items.some(item => item.receipt_id === previous) ? previous : result.items[0]?.receipt_id ?? '');
    }).catch(error => { if (active) setListError(error instanceof Error ? error.message : '读取提交记录失败，请重试。'); })
      .finally(() => { if (active) setListLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [userId, page, refresh]);

  useEffect(() => {
    if (!selected) { setDetail(null); setDetailLoading(false); return; }
    const controller = new AbortController();
    let active = true;
    setDetail(null); setDetailLoading(true); setDetailError(''); setDownloadError('');
    studentArtifactsApi.detail(userId, selected, controller.signal).then(result => { if (active) setDetail(result); })
      .catch(error => { if (active) setDetailError(error instanceof Error ? error.message : '读取作品包失败，请重试。'); })
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [userId, selected, detailRetry]);

  async function download() {
    if (!detail || downloading) return;
    setDownloading(true); setDownloadError('');
    try {
      const blob = await studentArtifactsApi.archive(detail.receipt_id);
      if (!mounted.current) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = detail.filename || 'student-work.zip';
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { if (mounted.current) setDownloadError(error instanceof Error ? error.message : '下载失败，请重试。'); }
    finally { if (mounted.current) setDownloading(false); }
  }

  return <section className="student-artifacts" aria-label="学生提交作品">
    <div className="student-artifact-heading"><div><h2>已交作品与 SFLS 对话</h2><p>查看服务器实际收到的代码、回顾与对话；每次提交的版本都保留。</p></div><button type="button" disabled={listLoading} onClick={() => { setPage(1); setRefresh(value => value + 1); }}><RefreshCw size={16} />刷新</button></div>
    {listError && <ArtifactNotice error={listError} retry={() => setRefresh(value => value + 1)} />}
    {listLoading && !items.length && <p role="status" className="student-artifact-empty">正在读取提交记录…</p>}
    {!listLoading && !listError && !items.length && <div className="student-artifact-empty"><p>这个学生还没有已接收的作品包。</p><p className="student-artifact-muted">学生提交成功后，这里会显示代码和 SFLS 对话；无需先填写课堂点评。</p></div>}
    {!!items.length && <>
      <div className="student-artifact-selector"><label>课次与提交版本<select value={selected} onChange={event => setSelected(event.target.value)}>{items.map((item, index) => <option key={item.receipt_id} value={item.receipt_id}>{item.task_title || '未命名任务'} · {artifactDate(item.created_at)}{index === 0 ? '（最近提交）' : ''}</option>)}</select></label><span>共 {total} 个提交版本</span>{items.length < total && <button type="button" disabled={listLoading || !!listError} onClick={() => setPage(value => value + 1)}>{listLoading ? '读取中…' : '加载更早提交'}</button>}</div>
      {detailLoading && <p role="status" className="student-artifact-empty">正在读取作品包…</p>}
      {detailError && <ArtifactNotice error={detailError} retry={() => setDetailRetry(value => value + 1)} />}
      {detail && <>
        <div className="student-artifact-receipt"><div><strong>{detail.task_title}</strong><p>{artifactDate(detail.created_at)} · {(detail.size / 1024 / 1024).toFixed(2)} MB</p></div><button type="button" disabled={downloading} onClick={download}><Download size={16} />{downloading ? '下载中…' : '下载完整作品包'}</button></div>
        {downloadError && <p role="alert" className="student-artifact-warning">{downloadError}</p>}
        <ArtifactContents key={detail.receipt_id} detail={detail} />
      </>}
    </>}
  </section>;
}

export function StudentArtifacts({ userId }: { userId: string }) {
  // A route change must never display the previous student's files while loading.
  return <StudentArtifactsContent key={userId} userId={userId} />;
}
