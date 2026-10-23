import { useEffect, useRef, useState } from 'react';
import { Download, MessageSquare, RefreshCw, Search } from 'lucide-react';
import { studentArtifactsApi, type StudentArtifactDetail } from '../lib/studentArtifacts';
import { appendMessages, conversationBrowserApi, conversationDate, conversationIdentity, publicMessages, type ArtifactConversation, type ArtifactVersions, type ConversationSource, type WebConversation, type WebConversationMessage } from '../lib/conversationBrowser';
import { TEACHING_CLASSES } from '../lib/teachingClasses';
import './Conversations.css';

const errorText = (error: unknown) => error instanceof Error ? error.message : '读取失败，请重试。';
type PreviewMessage = { id: string; role: string; text: string; at: string | null; truncated?: boolean };
const recordId = (item: ArtifactConversation | WebConversation) => 'receipt_id' in item ? item.receipt_id : item.user_id;

export function ConversationMessages({ messages, assistantLabel }: { messages: PreviewMessage[]; assistantLabel: string }) {
  return <div className="conversation-messages">{messages.filter(message => message.role === 'user' || message.role === 'assistant').map(message => <article key={message.id} className={`conversation-message is-${message.role}`}>
    <header><strong>{message.role === 'user' ? '学生' : assistantLabel}</strong><time>{conversationDate(message.at)}</time></header>
    <pre>{message.text || '（此条内容为空）'}</pre>
    {message.truncated && <p className="conversation-muted">此条较长，仅预览前段。</p>}
  </article>)}</div>;
}

function ErrorNotice({ error, retry }: { error: string; retry: () => void }) {
  return <div className="conversation-error" role="alert"><span>{error}</span><button type="button" onClick={retry}>重试</button></div>;
}

function ArtifactPreview({ item }: { item: ArtifactConversation }) {
  const [detail, setDetail] = useState<StudentArtifactDetail | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [visible, setVisible] = useState(40), [downloading, setDownloading] = useState(false), [downloadError, setDownloadError] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    setLoading(true); setDetail(null); setError(''); setVisible(40);
    void studentArtifactsApi.detail(item.user_id, item.receipt_id, controller.signal).then(result => { if (active) setDetail(result); })
      .catch(cause => { if (active) setError(errorText(cause)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [item.user_id, item.receipt_id, retry]);
  async function download() {
    if (downloading) return;
    setDownloading(true); setDownloadError('');
    try {
      const blob = await studentArtifactsApi.archive(item.receipt_id);
      if (!mounted.current) return;
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = item.filename || 'student-work.zip'; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (cause) { if (mounted.current) setDownloadError(errorText(cause)); }
    finally { if (mounted.current) setDownloading(false); }
  }
  const messages = detail?.messages.filter(message => message.role === 'user' || message.role === 'assistant') ?? [];
  return <>
    <header className="conversation-preview-heading"><div><h2>{conversationIdentity(item)}</h2><p>{item.student_id || '未记录学号'} · {item.class_name || item.school_class || '未分班'}</p></div><button type="button" className="conversation-download" disabled={downloading} onClick={() => void download()}><Download size={16} aria-hidden="true" />{downloading ? '下载中…' : '下载原始作品包'}</button></header>
    <div className="conversation-preview-meta"><strong>{item.task_title || '未命名任务'}</strong><span>{conversationDate(item.created_at)}</span></div>
    <p className="conversation-source-note">仅展示此提交包中的学生与 SFLS 发言，可能不包含完整开发过程。工具调用等原始记录请下载作品包查看。</p>
    {downloadError && <p className="conversation-error" role="alert">{downloadError}</p>}
    {loading && <p className="conversation-empty" role="status">正在读取所选作品包…</p>}
    {error && <ErrorNotice error={error} retry={() => setRetry(value => value + 1)} />}
    {detail && <>
      <p className="conversation-muted">{detail.evidence.message_count_is_lower_bound ? '至少 ' : ''}{detail.evidence.message_count} 条发言 · 当前可预览 {messages.length} 条{detail.evidence.truncated ? ' · 部分预览' : ''}</p>
      {detail.warnings.length > 0 && <details className="conversation-warnings"><summary>预览提示（{detail.warnings.length}）</summary><ul>{detail.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
      {!messages.length ? <p className="conversation-empty">此包未发现可预览的学生 / SFLS 对话，可下载原包核对。</p> : <ConversationMessages assistantLabel="SFLS" messages={messages.slice(0, visible).map((message, index) => ({ ...message, id: `${message.session_path}-${message.line}-${index}` }))} />}
      {visible < messages.length && <button type="button" className="conversation-load-more" onClick={() => setVisible(value => value + 40)}>再看 40 条对话（还有 {messages.length - visible} 条）</button>}
      {detail.evidence.truncated && <p className="conversation-source-note">此处为部分预览，完整记录请下载原始作品包。</p>}
    </>}
  </>;
}

function WebPreview({ item }: { item: WebConversation }) {
  const [messages, setMessages] = useState<WebConversationMessage[]>([]), [offset, setOffset] = useState(0), [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [retry, setRetry] = useState(0), [hasMore, setHasMore] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    setLoading(true); setError('');
    void conversationBrowserApi.messages(item.user_id, offset, controller.signal).then(result => {
      if (!active) return;
      setMessages(previous => offset === 0 ? publicMessages(result.messages) : appendMessages(previous, result.messages));
      setTotal(result.total); setHasMore(result.offset + result.messages.length < result.total);
    }).catch(cause => { if (active) setError(errorText(cause)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [item.user_id, offset, retry]);
  return <>
    <header className="conversation-preview-heading"><div><h2>{conversationIdentity(item)}</h2><p>{item.student_id || '未记录学号'} · {item.class_name || item.school_class || '未分班'}</p></div><span className="conversation-kind-label">网页助手</span></header>
    <p className="conversation-source-note">按学生汇集网页助手中的学生与 AI 发言，按时间正序展示；与本地 SFLS 作品包分开记录。</p>
    {!!messages.length && <p className="conversation-muted">已加载 {messages.length} / {total} 条发言</p>}
    {loading && !messages.length && <p className="conversation-empty" role="status">正在读取网页对话…</p>}
    {error && <ErrorNotice error={error} retry={() => setRetry(value => value + 1)} />}
    {!loading && !error && !messages.length && <p className="conversation-empty">这个学生尚无可查看的网页对话。</p>}
    <ConversationMessages assistantLabel="网页 AI" messages={messages.map(message => ({ ...message, at: message.timestamp }))} />
    {hasMore && <button type="button" className="conversation-load-more" disabled={loading || !!error} onClick={() => setOffset(value => value + 50)}>{loading ? '读取中…' : '加载后面 50 条'}</button>}
  </>;
}

export const Conversations = () => {
  const [source, setSource] = useState<ConversationSource>('artifacts'), [versions, setVersions] = useState<ArtifactVersions>('latest');
  const [draftQuery, setDraftQuery] = useState(''), [draftClass, setDraftClass] = useState('');
  const [query, setQuery] = useState(''), [className, setClassName] = useState(''), [page, setPage] = useState(1), [refresh, setRefresh] = useState(0);
  const [items, setItems] = useState<Array<ArtifactConversation | WebConversation>>([]), [total, setTotal] = useState(0), [loadedKey, setLoadedKey] = useState('');
  const [selectedId, setSelectedId] = useState(''), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const requestKey = JSON.stringify([source, versions, query, className, page, refresh]);
  const currentItems = loadedKey === requestKey ? items : [];
  const selected = currentItems.find(item => recordId(item) === selectedId);
  const pending = loading || loadedKey !== requestKey;
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    setLoading(true); setError('');
    const filters = { query, className, page, versions };
    const request = source === 'artifacts' ? conversationBrowserApi.artifacts(filters, controller.signal) : conversationBrowserApi.web(filters, controller.signal);
    void request.then(result => {
      if (!active) return;
      setItems(result.items); setTotal(result.total); setLoadedKey(requestKey);
      setSelectedId(previous => result.items.some(item => recordId(item) === previous) ? previous : result.items[0] ? recordId(result.items[0]) : '');
    }).catch(cause => { if (active) { setItems([]); setTotal(0); setLoadedKey(requestKey); setError(errorText(cause)); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [source, versions, query, className, page, refresh, requestKey]);
  function changeSource(next: ConversationSource) { if (next === source) return; setSource(next); setPage(1); setSelectedId(''); }
  const totalPages = Math.max(1, Math.ceil(total / 30));
  return <div className="conversation-browser">
    <header className="conversation-page-heading"><div><h1>对话速览</h1><p>选学生、选任务，查看学生与 AI 的原始发言。</p></div><button type="button" disabled={pending} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={16} aria-hidden="true" />刷新</button></header>
    <div className="conversation-filter-panel">
      <nav className="conversation-source-tabs" aria-label="对话来源"><button type="button" aria-pressed={source === 'artifacts'} onClick={() => changeSource('artifacts')}>SFLS 作品包</button><button type="button" aria-pressed={source === 'web'} onClick={() => changeSource('web')}>网页助手</button></nav>
      <form className="conversation-filters" onSubmit={event => { event.preventDefault(); setQuery(draftQuery.trim()); setClassName(draftClass.trim()); setPage(1); setRefresh(value => value + 1); }}>
        <label>查找<input type="search" value={draftQuery} onChange={event => setDraftQuery(event.target.value)} maxLength={100} placeholder={source === 'artifacts' ? '姓名、学号或任务' : '姓名或学号'} /></label>
        <label>班级<input list="conversation-class-options" value={draftClass} maxLength={100} onChange={event => setDraftClass(event.target.value)} placeholder="全部班级" /><datalist id="conversation-class-options">{TEACHING_CLASSES.map(item => <option key={item.name} value={item.name} />)}</datalist></label>
        {source === 'artifacts' && <label>提交版本<select value={versions} onChange={event => { setVersions(event.target.value as ArtifactVersions); setPage(1); setSelectedId(''); }}><option value="latest">每人每任务最新提交</option><option value="all">全部历史提交</option></select></label>}
        <button type="submit" className="conversation-search"><Search size={16} aria-hidden="true" />查询</button>
      </form>
    </div>
    <p className="conversation-scope-note">{source === 'artifacts' ? 'SFLS 仅显示已上传并接收的作品包，不含学生电脑上尚未提交的对话。' : '网页助手按学生汇总，不与 SFLS 对话混合；这里只读，不删除记录。'}</p>
    <div className="conversation-browser-layout">
      <section className="conversation-records" aria-label="对话记录列表"><header><h2>{source === 'artifacts' ? '作品包记录' : '学生记录'}</h2><span>{pending ? '读取中…' : `共 ${total} ${source === 'artifacts' ? '份' : '人'}`}</span></header>
        {pending && <p className="conversation-empty" role="status">正在读取记录…</p>}
        {!pending && error && <ErrorNotice error={error} retry={() => setRefresh(value => value + 1)} />}
        {!pending && !error && !currentItems.length && <div className="conversation-empty"><MessageSquare size={24} aria-hidden="true" /><p>暂无符合条件的记录。</p></div>}
        <ul>{currentItems.map(item => <li key={recordId(item)}><button type="button" className="conversation-record" aria-pressed={selectedId === recordId(item)} onClick={() => setSelectedId(recordId(item))}>
          <span className="conversation-record-identity"><strong>{conversationIdentity(item)}</strong><small>{item.student_id || '未记录学号'}</small></span>
          <span className="conversation-record-task">{'task_title' in item ? item.task_title || '未命名任务' : `${item.message_count} 条网页发言`}</span>
          <span className="conversation-record-meta">{item.class_name || item.school_class || '未分班'} · {conversationDate('updated_at' in item ? item.updated_at : item.created_at)}</span>
          {'version_count' in item && <small className="conversation-record-version">{versions === 'latest' ? `此任务共 ${item.version_count} 个提交版本` : '历史提交版本'}</small>}
        </button></li>)}</ul>
        {!pending && total > 0 && <footer className="conversation-pagination"><span>第 {page} / {totalPages} 页</span><div><button type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>上一页</button><button type="button" disabled={page >= totalPages} onClick={() => setPage(value => value + 1)}>下一页</button></div></footer>}
      </section>
      <section className="conversation-preview" aria-label="对话内容">{selected ? 'receipt_id' in selected ? <ArtifactPreview key={`artifact-${selected.user_id}-${selected.receipt_id}-${refresh}`} item={selected} /> : <WebPreview key={`web-${selected.user_id}-${refresh}`} item={selected} /> : <div className="conversation-empty conversation-preview-empty"><MessageSquare size={28} aria-hidden="true" /><p>{pending ? '正在读取记录…' : '选择左侧记录，查看对话内容。'}</p></div>}</section>
    </div>
  </div>;
};
