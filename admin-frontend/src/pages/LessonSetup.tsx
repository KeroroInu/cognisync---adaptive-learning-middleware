import { useEffect, useState } from 'react';
import { classroomAdmin } from '../lib/classroom';

type Task = { id: string; title: string; target_group: string };
type Plan = { id: string; started_at: string | null; configuration: { tasks: Record<string, { id: string; title: string }>; knowledge_points: string[] } };
export function LessonSetup({ sessionId, open }: { sessionId: string; open: boolean }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [points, setPoints] = useState('');
  const [ready, setReady] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    void Promise.all([classroomAdmin<Task[]>('/lesson-tasks', undefined, controller.signal), classroomAdmin<Plan | null>(`/sessions/${sessionId}/lesson`, undefined, controller.signal)])
      .then(([items, lesson]) => {
        if (controller.signal.aborted) return;
        setTasks(items); setPlan(lesson);
        setSelected(Object.fromEntries(Object.entries(lesson?.configuration.tasks || {}).map(([group, task]) => [group, task.id])));
        setPoints(lesson?.configuration.knowledge_points.join('\n') || ''); setSaved(Boolean(lesson)); setReady(true);
      }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [sessionId, loadAttempt]);
  async function save() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const result = await classroomAdmin<Plan>(`/sessions/${sessionId}/lesson`, {
        tasks: Object.fromEntries(Object.entries(selected).filter(([, id]) => id)),
        knowledge_points: points.split('\n').map(point => point.trim()).filter(Boolean),
      });
      setPlan(result); setSaved(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败'); }
    finally { setBusy(false); }
  }
  async function start() {
    if (busy || !saved) return;
    setBusy(true); setError('');
    try {
      await classroomAdmin(`/sessions/${sessionId}/lesson/start`, {});
      setPlan(await classroomAdmin<Plan>(`/sessions/${sessionId}/lesson`));
    } catch (cause) { setError(cause instanceof Error ? cause.message : '启动失败'); }
    finally { setBusy(false); }
  }
  return <section className="classroom-panel" aria-label="本课安排">
    <h2>本课安排</h2><p>{plan?.started_at ? '已启动，任务和知识目标已冻结。' : '学生先在准备区。保存安排后，由你启动分组课堂。'}</p>
    {error && <p role="alert" className="classroom-error">{error} {!ready && <button onClick={() => setLoadAttempt(value => value + 1)}>重新读取</button>}</p>}
    <fieldset disabled={!ready || busy || !open || Boolean(plan?.started_at)}>
      <div className="classroom-fields">{([['ai_pbl', '常规 AI 协作'], ['pdt', '解构式协作']] as const).map(([group, label]) => <label key={group}>{label}<select value={selected[group] || ''} onChange={event => { setSelected(previous => ({ ...previous, [group]: event.target.value })); setSaved(false); }}><option value="">本课不开放此组</option>{tasks.filter(task => task.target_group === 'all' || task.target_group === group).map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label>)}</div>
      <label>本课知识点（每行一个，可稍后完善再启动）<textarea rows={2} value={points} maxLength={2000} placeholder={'条件判断\n列表操作'} onChange={event => { setPoints(event.target.value); setSaved(false); }} /></label>
      <div className="classroom-actions"><button disabled={busy || Boolean(plan?.started_at)} onClick={() => void save()}>{saved ? '安排已保存' : '保存安排'}</button><button className="classroom-primary" disabled={!saved || !Object.values(selected).some(Boolean)} onClick={() => void start()}>开始本课</button></div>
    </fieldset>
  </section>;
}
