import { useEffect, useRef, useState } from 'react';
import { classroomAdmin } from '../lib/classroom';

interface Notice { id: string; expires_at: string; target_user_ids: string[] }
interface Student { id: string; name: string; student_id: string }

export function ClassroomNotices({ className }: { className: string }) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState('');
  const [audience, setAudience] = useState('class');
  const [students, setStudents] = useState<Student[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [rosterError, setRosterError] = useState('');
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterAttempt, setRosterAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [message, setMessage] = useState('');
  const lock = useRef(false);
  const version = useRef(0);
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  const mounted = useRef(true);
  const needsRoster = (editing && audience === 'students') || notices.some(notice => notice.target_user_ids.length > 0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const started = version.current;
      try {
        if (!lock.current && document.visibilityState !== 'hidden') {
          const data = await classroomAdmin<Notice[]>('/notices/sent?class_name=' + encodeURIComponent(className), undefined, controller.signal);
          if (!controller.signal.aborted && started === version.current) { setNotices(data); setLoadError(''); }
        }
      } catch { if (!controller.signal.aborted && started === version.current) setLoadError('发送记录暂时未读到，正在重试。'); }
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 8000);
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [className]);
  useEffect(() => {
    if (!needsRoster) return;
    const controller = new AbortController();
    setRosterLoading(true); setRosterError('');
    void classroomAdmin<Student[]>('/notices/students?class_name=' + encodeURIComponent(className), undefined, controller.signal)
      .then(rows => { if (!controller.signal.aborted) { setStudents(rows); setSelected(ids => ids.filter(id => rows.some(row => row.id === id))); } })
      .catch(() => { if (!controller.signal.aborted) setRosterError('学生名单没有加载成功。'); })
      .finally(() => { if (!controller.signal.aborted) setRosterLoading(false); });
    return () => controller.abort();
  }, [className, needsRoster, rosterAttempt]);

  const targets = audience === 'class' ? [] : [...selected].sort();
  const destination = audience === 'class' ? className : selected.length === 1 ? students.find(s => s.id === selected[0])?.name || '这位学生' : '所选 ' + selected.length + ' 位学生';
  const invalid = !content.trim() || (audience === 'students' && (!selected.length || rosterLoading || !!rosterError));
  async function act(withdrawId?: string) {
    if (lock.current || (!withdrawId && invalid)) return;
    lock.current = true; version.current++; setBusy(true); setError(''); setMessage('');
    try {
      if (withdrawId) {
        await classroomAdmin('/notices/' + withdrawId + '/withdraw', {});
        if (!mounted.current) return;
        setNotices(rows => rows.filter(row => row.id !== withdrawId)); setMessage('已撤回。已复制的内容无法收回；若是密钥，请另行停用。');
      } else {
        const fingerprint = JSON.stringify([className, content.trim(), targets]);
        if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
        const data = await classroomAdmin<Notice | null>('/notices', { request_id: request.current.id, class_name: className, content: content.trim(), target_user_ids: targets });
        if (!mounted.current) return;
        if (data) setNotices(rows => [data, ...rows.filter(row => row.id !== data.id && JSON.stringify(row.target_user_ids) !== JSON.stringify(targets))]);
        setContent(''); setEditing(false); request.current = null;
        setMessage(data ? '已发送给' + destination + '，学生页面会自动弹出。' : '这次内容已失效；如需再次发送，请重新填写。');
      }
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : '操作失败，请重试。'); }
    finally { lock.current = false; version.current++; if (mounted.current) setBusy(false); }
  }

  return <section className="classroom-panel classroom-notices" aria-label="发送内容">
    <header className="classroom-toolbar"><div><h2>发送内容</h2><p>文字、链接或临时密钥，学生收到后可一键复制。</p></div>
      <button className={editing ? '' : 'classroom-info'} disabled={busy} aria-expanded={editing} onClick={() => setEditing(value => !value)}>{editing ? '收起' : '发给学生'}</button>
    </header>
    {editing && <form onSubmit={event => { event.preventDefault(); void act(); }}>
      <fieldset className="notice-audience" disabled={busy}><legend>接收人 · {className}</legend>
        <label><input type="radio" name="notice-audience" checked={audience === 'class'} onChange={() => setAudience('class')} />全班</label>
        <label><input type="radio" name="notice-audience" checked={audience === 'students'} onChange={() => setAudience('students')} />选择学生</label>
      </fieldset>
      {audience === 'students' && <div className="notice-picker">
        <input aria-label="搜索学生" placeholder="搜索姓名或学号" value={search} onChange={event => setSearch(event.target.value)} disabled={busy} />
        <span>已选 {selected.length} 人 · 勾选一人即可单独发送</span>
        {rosterLoading ? <p role="status">正在读取学生名单…</p> : rosterError ? <p role="alert">{rosterError} <button type="button" onClick={() => setRosterAttempt(n => n + 1)}>重试</button></p> :
          <div className="notice-students">{students.filter(s => (s.name + ' ' + s.student_id).toLowerCase().includes(search.trim().toLowerCase())).map(s => <label key={s.id}>
            <input type="checkbox" checked={selected.includes(s.id)} disabled={busy} onChange={event => setSelected(ids => event.target.checked ? [...ids, s.id] : ids.filter(id => id !== s.id))} />
            <span>{s.name}<small>{s.student_id}</small></span>
          </label>)}{!students.length && <p>这个班还没有学生。</p>}</div>}
      </div>}
      <label>发送内容<textarea aria-label="发送内容" rows={4} maxLength={4000} value={content} autoComplete="off" spellCheck={false} onChange={event => setContent(event.target.value)} placeholder="粘贴需要学生复制的文字、链接、指令或 API key" disabled={busy} /></label>
      <p className="classroom-footnote">今日有效，可随时撤回。同一接收范围的新内容替换旧内容；不进入研究导出。密钥需另行停用。</p>
      <button className="classroom-primary" disabled={busy || invalid}>{busy ? '正在处理…' : '发送给' + destination}</button>
    </form>}
    {!!notices.length && <ul className="notice-sent" aria-label="正在显示的内容">{notices.map(notice => <li key={notice.id}>
      <span>{notice.target_user_ids.length ? notice.target_user_ids.length === 1 ? '单独发送 · 1 人' : '部分学生 · ' + notice.target_user_ids.length + ' 人' : className + ' · 全班'}<small>{notice.target_user_ids.length ? notice.target_user_ids.map(id => students.find(student => student.id === id)?.name || '学生').join('、') : '今日有效'}</small></span>
      <button className="classroom-danger" disabled={busy} onClick={() => void act(notice.id)}>撤回</button>
    </li>)}</ul>}
    {message && <p role="status" className="classroom-message">{message}</p>}
    {loadError && <p role="status" className="classroom-error">{loadError}</p>}
    {error && <p role="alert" className="classroom-error">{error}</p>}
  </section>;
}
