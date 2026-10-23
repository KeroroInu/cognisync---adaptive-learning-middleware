import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, Settings2 } from 'lucide-react';
import { classroomAdmin, type ClassroomSession } from '../lib/classroom';
import './Classroom.css';
import { TEACHING_CLASSES } from '../lib/teachingClasses';
import { LessonMaterials, LessonEvidence } from './LessonMaterials';
import { ClassroomPolls } from '../components/ClassroomPolls';
import { ClassroomNotices } from '../components/ClassroomNotices';

const errorMessage = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试。';
const dateLabel = (value: string) => new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function Classroom() {
  const [sessions, setSessions] = useState<ClassroomSession[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [className, setClassName] = useState('解构班');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const selected = sessions.find(item => item.id === selectedId);
  const sequence = useRef(0);

  const load = useCallback(async (signal?: AbortSignal, ensure = false) => {
    const request = ++sequence.current;
    try {
      // Only first entry/class change resolves the container. No start/end action.
      const workspace = ensure ? await classroomAdmin<ClassroomSession>('/workspace', { class_name: className }, signal) : null;
      const result = await classroomAdmin<ClassroomSession[]>('/sessions', undefined, signal);
      if (signal?.aborted || request !== sequence.current) return;
      setSessions(result);
      setSelectedId(previous => workspace?.id || (result.some(item => item.id === previous && item.class_name === className) ? previous : result.find(item => item.class_name === className && item.is_current)?.id || ''));
      setError('');
    } catch (cause) {
      if (!signal?.aborted && request === sequence.current) setError(errorMessage(cause));
    } finally { if (!signal?.aborted && request === sequence.current) setLoading(false); }
  }, [className]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setSelectedId(''); setError('');
    let timer: ReturnType<typeof setTimeout>;
    const poll = async (ensure = false) => {
      if (document.visibilityState !== 'hidden' || ensure) await load(controller.signal, ensure);
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 8000);
    };
    void poll(true);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [load]);

  const history = sessions.filter(item => item.class_name === className && !item.is_current);
  return <div className="classroom-admin">
    <header className="classroom-page-header"><div><h1>课堂工作台</h1><p>发布本课任务，查看学生提交，开展课堂互动。</p></div>
      <div className="classroom-actions"><Link className="teacher-utility-link" to="/tools"><Settings2 size={16} aria-hidden="true" />工具与设置</Link>
        <button aria-label="刷新课堂" disabled={loading} onClick={() => void load(undefined, !selected)}><RefreshCw size={16} aria-hidden="true" />刷新</button>
      </div>
    </header>
    <div className="classroom-context-bar"><nav className="classroom-class-tabs" aria-label="切换班级">{TEACHING_CLASSES.map(item =>
      <button key={item.name} aria-pressed={className === item.name} onClick={() => { if (className !== item.name) { setSelectedId(''); setLoading(true); setClassName(item.name); } }}>{item.name}</button>
    )}</nav><span className="classroom-context-label">当前班级的任务与互动</span></div>
    {error && <p className="classroom-error" role="alert">{error}</p>}
    {loading ? <p role="status">正在读取…</p> : <>
      {history.length > 0 && <details className="classroom-history"><summary>历史记录</summary>
        <label>查看记录<select value={selectedId} onChange={event => setSelectedId(event.target.value)}>
          {sessions.filter(item => item.class_name === className).map(item => <option key={item.id} value={item.id}>{item.is_current ? '当前发布' : item.title + ' · ' + dateLabel(item.created_at)}</option>)}
        </select></label>
      </details>}
      {selected && <>
        {!selected.is_current && <p className="classroom-message">正在查看历史记录。切回“当前发布”即可布置任务。</p>}
        <div className="classroom-teaching-grid">
          <LessonMaterials key={'materials-' + selected.id} sessionId={selected.id} open={selected.is_current} className={className} />
          <aside className="classroom-interactions" aria-label="课堂互动">
            <ClassroomNotices key={className} className={className} />
            <ClassroomPolls key={'polls-' + selected.id} sessionId={selected.id} open={selected.is_current} />
          </aside>
        </div>
        <LessonEvidence key={'evidence-' + selected.id} sessionId={selected.id} />
      </>}
      {!selected && <ClassroomNotices key={className} className={className} />}
    </>}
    <footer className="classroom-footnote">问卷、对话和历次作品可在 <Link to="/exports">数据导出</Link> 下载。</footer>
  </div>;
}
