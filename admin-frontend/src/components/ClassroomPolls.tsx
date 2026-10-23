import { useCallback, useEffect, useRef, useState } from 'react';
import { classroomAdmin, type ClassroomPrompt } from '../lib/classroom';
import './ClassroomPolls.css';

interface Poll extends ClassroomPrompt { counts: { a: number; b: number } }
interface Results { total: number; items: Poll[] }

export function ClassroomPolls({ sessionId, open }: { sessionId: string; open: boolean }) {
  const [data, setData] = useState<Results>({ total: 0, items: [] });
  const [loaded, setLoaded] = useState(false);
  const [topic, setTopic] = useState('');
  const [optionA, setOptionA] = useState('');
  const [optionB, setOptionB] = useState('');
  const [composing, setComposing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [page, setPage] = useState(0);
  const lock = useRef(false);
  const request = useRef<{ key: string; id: string } | null>(null);
  const sequence = useRef(0);
  const live = useRef(true);
  const active = data.items.find(p => !p.closed_at);
  const load = useCallback(async (signal?: AbortSignal) => {
    const seq = ++sequence.current;
    try {
      const next = await classroomAdmin<Results>(`/sessions/${sessionId}/polls?limit=10&offset=${page * 10}`, undefined, signal);
      if (!signal?.aborted && live.current && seq === sequence.current) { setData(next); setLoaded(true); setLoadError(''); }
    } catch (e) { if (!signal?.aborted && live.current && seq === sequence.current) setLoadError(e instanceof Error ? e.message : '票数读取失败'); }
  }, [sessionId, page]);
  useEffect(() => {
    live.current = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (document.visibilityState !== 'hidden') await load(controller.signal);
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 4000);
    };
    const refresh = () => { if (document.visibilityState !== 'hidden') void load(controller.signal); };
    void poll(); document.addEventListener('visibilitychange', refresh);
    return () => { live.current = false; controller.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [load]);
  async function act(operation: () => Promise<unknown>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await operation(); await load(); }
    catch (e) { if (live.current) setError(e instanceof Error ? e.message : '操作失败，请重试。'); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  }
  function publish() {
    const body = { topic: topic.trim(), option_a: optionA.trim(), option_b: optionB.trim() };
    const key = JSON.stringify(body);
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
    void act(async () => {
      await classroomAdmin(`/sessions/${sessionId}/polls`, { ...body, request_id: request.current!.id });
      if (live.current) { setComposing(false); setTopic(''); setOptionA(''); setOptionB(''); request.current = null; }
    });
  }
  function result(p: Poll) {
    const total = p.counts.a + p.counts.b;
    return <article key={p.id} className="teacher-poll-result">
      <header><strong>{p.question.text}</strong><span>{p.closed_at ? '已结束' : '投票中'} · {total} 票</span></header>
      {p.question.options.map(o => { const count = p.counts[o.value as 'a' | 'b'] || 0; const percent = total ? Math.round(count / total * 100) : 0;
        return <div className="teacher-poll-count" key={o.value}><div><span>{o.value.toUpperCase()} · {o.label}</span><b>{count} 票 · {percent}%</b></div><progress max={100} value={percent} aria-label={`${o.label} ${count} 票`} /></div>;
      })}
      {!p.closed_at && open && <button className="classroom-warning" disabled={busy} onClick={() => void act(() => classroomAdmin(`/prompts/${p.id}/close`, {}))}>结束投票</button>}
    </article>;
  }
  return <section className="classroom-panel teacher-polls" aria-label="课堂投票">
    <header><div><h2>课堂投票</h2><p>一个主题，两个选项。不计分。</p></div>
      <button className={composing ? '' : 'classroom-poll-action'} disabled={!open || busy || !loaded || !!active || page !== 0} aria-expanded={composing} onClick={() => setComposing(v => !v)}>{composing ? '收起' : '发起投票'}</button></header>
    {loadError && <p role="alert">{loadError} · 正在重试</p>}{error && <p role="alert">{error}</p>}
    {!open && <p>历史投票仅供查看，切回当前发布可发起投票。</p>}
    {composing && open && <form onSubmit={e => { e.preventDefault(); publish(); }}><fieldset disabled={busy || !!active}>
      <label>投票主题<input required maxLength={200} placeholder="例如：你会先试哪种方法？" value={topic} onChange={e => setTopic(e.target.value)} /></label>
      <div className="teacher-poll-options"><label>选项 A<input required maxLength={80} value={optionA} onChange={e => setOptionA(e.target.value)} /></label><label>选项 B<input required maxLength={80} value={optionB} onChange={e => setOptionB(e.target.value)} /></label></div>
      {optionA.trim() && optionA.trim().toLowerCase() === optionB.trim().toLowerCase() && <p role="alert">两个选项不能相同。</p>}
      <button type="submit" className="classroom-primary" disabled={!topic.trim() || !optionA.trim() || !optionB.trim() || optionA.trim().toLowerCase() === optionB.trim().toLowerCase()}>{busy ? '正在开启…' : '开启投票'}</button>
    </fieldset></form>}
    {active && result(active)}
    {data.items.some(p => p.closed_at) && <details><summary>已结束的投票</summary>{data.items.filter(p => p.closed_at).map(result)}</details>}
    {data.total > 10 && <div className="classroom-actions"><button disabled={!page || busy} onClick={() => setPage(p => p - 1)}>较新的投票</button><span>第 {page + 1} 页</span><button disabled={(page + 1) * 10 >= data.total || busy} onClick={() => setPage(p => p + 1)}>较早的投票</button></div>}
  </section>;
}
