import { useEffect, useRef, useState } from 'react';
import { adminApi } from '../lib/adminApi';
import { createRequestId } from '../lib/requestId';
import type { TeacherNote, TeacherNoteInput, TeacherNoteEvidence } from '../types';

const eventLabels: Record<string, string> = { module_test: '运行测试', structure_change: '修改方案', stage_confirm: '阶段确认', help_request: '向 AI 求助', final_submit: '提交作品' };
const stageLabels: Record<string, string> = { observe: '观察', decompose: '功能', model: '流程', build: '建构', transfer: '历史迁移', plan: '历史规划' };
const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

export function TeacherNotes({ userId }: { userId: string }) {
  const [notes, setNotes] = useState<TeacherNote[]>([]);
  const [events, setEvents] = useState<TeacherNoteEvidence[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [lessonDate, setLessonDate] = useState(today);
  const [lessonLabel, setLessonLabel] = useState('');
  const [observation, setObservation] = useState('');
  const [interpretation, setInterpretation] = useState('');
  const [nextStep, setNextStep] = useState('');
  const [evidenceId, setEvidenceId] = useState('');
  const [supersedes, setSupersedes] = useState<string | null>(null);
  const retry = useRef<{ payload: string; id: string } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const submissionLock = useRef(false);

  useEffect(() => {
    let active = true;
    setError('');
    Promise.all([adminApi.getTeacherNotes(userId), adminApi.getTeacherNoteEvidence(userId)])
      .then(([result, evidence]) => {
        if (!active) return;
        setNotes(result.notes); setHasMore(result.has_more); setEvents(evidence.events); setLoaded(true);
      })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : '记录加载失败，请重新打开此页'); });
    return () => { active = false; };
  }, [userId, loadAttempt]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (submissionLock.current || !loaded) return;
    submissionLock.current = true; setSaving(true); setError(''); setNotice('');
    const content: Omit<TeacherNoteInput, 'request_id'> = {
      lesson_date: lessonDate, lesson_label: lessonLabel.trim(), observation: observation.trim(),
      interpretation: interpretation.trim(), next_step: nextStep.trim(),
      evidence_ids: evidenceId ? [evidenceId] : [], supersedes_id: supersedes,
    };
    const serialized = JSON.stringify(content);
    try {
      if (retry.current?.payload !== serialized) retry.current = { payload: serialized, id: createRequestId() };
      const note = await adminApi.createTeacherNote(userId, { ...content, request_id: retry.current.id });
      setNotes(previous => [note, ...previous.filter(item => item.id !== note.id)]);
      setObservation(''); setInterpretation(''); setNextStep(''); setEvidenceId(''); setSupersedes(null);
      retry.current = null; setNotice('已保存，仅教师可见；不会作为学生能力分数。');
    } catch (err) { setError(err instanceof Error ? err.message : '保存失败，内容已保留，可以重试'); }
    finally { submissionLock.current = false; setSaving(false); }
  }

  async function loadMore() {
    setLoadingMore(true); setError('');
    try {
      const result = await adminApi.getTeacherNotes(userId, notes.length);
      setNotes(previous => [...previous, ...result.notes.filter(row => !previous.some(item => item.id === row.id))]);
      setHasMore(result.has_more);
    } catch (err) { setError(err instanceof Error ? err.message : '加载失败'); }
    finally { setLoadingMore(false); }
  }

  async function exportNotes() {
    setExporting(true); setError('');
    try {
      const blob = await adminApi.exportCsv(`/export/csv/teacher-notes?student_id=${encodeURIComponent(userId)}`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = '课堂点评.csv';
      document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    } catch (err) { setError(err instanceof Error ? err.message : '导出失败'); }
    finally { setExporting(false); }
  }

  return <section className="space-y-6">
    <div className="flex flex-wrap justify-between items-start gap-3">
      <div><h3 className="font-bold text-lg">课堂点评</h3><p className="text-sm mt-1" style={{ color: 'var(--text-light)' }}>先记具体行为，判断和建议可稍后补充。学生不需要填写。</p></div>
      <button className="rounded-lg border border-current disabled:opacity-50 px-4 py-2" onClick={exportNotes} disabled={exporting}>{exporting ? '导出中…' : '导出记录'}</button>
    </div>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {error && !loaded && <button type="button" className="underline" onClick={() => setLoadAttempt(value => value + 1)}>重新读取</button>}
    {notice && <p role="status" className="text-green-700">{notice}</p>}
    <form ref={formRef} onSubmit={save} className="space-y-4">
      <fieldset disabled={saving || !loaded} className="space-y-4">
        {supersedes && <div className="flex flex-wrap items-center gap-3 text-sm"><span>正在追加更正，原记录保留。</span><button type="button" className="underline" onClick={() => setSupersedes(null)}>取消更正关联</button></div>}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">日期<input className="admin-input w-full mt-1" type="date" required value={lessonDate} onChange={event => setLessonDate(event.target.value)} /></label>
          <label className="block">课次<input className="admin-input w-full mt-1" required maxLength={120} value={lessonLabel} onChange={event => setLessonLabel(event.target.value)} placeholder="例如：第 2 课 · 功能分析" /></label>
        </div>
        <label className="block">看到的行为<textarea className="admin-input w-full mt-1" rows={3} required maxLength={2000} value={observation} onChange={event => setObservation(event.target.value)} placeholder="例如：发现移动时也在加分，修改了判断条件并重新测试。" /></label>
        <details className="rounded-xl border p-3" style={{ borderColor: 'var(--glass-border)' }}>
          <summary className="cursor-pointer">补充判断、建议或证据（选填）</summary>
          <div className="space-y-3 mt-4">
            <label className="block">教师判断<textarea className="admin-input w-full mt-1" rows={2} maxLength={1000} value={interpretation} onChange={event => setInterpretation(event.target.value)} placeholder="与观察事实分开记录，不必打分。" /></label>
            <label className="block">已给的指导 / 下次关注<textarea className="admin-input w-full mt-1" rows={2} maxLength={1000} value={nextStep} onChange={event => setNextStep(event.target.value)} /></label>
            <label className="block">关联学习事件<select className="admin-input w-full mt-1" value={evidenceId} onChange={event => setEvidenceId(event.target.value)}>
              <option value="">暂不关联</option>
              {events.map(item => <option key={item.id} value={item.id}>{new Date(item.created_at).toLocaleString('zh-CN')} · {stageLabels[item.stage] || item.stage} · {eventLabels[item.event_type] || item.event_type} · {item.task_title}</option>)}
            </select></label>
          </div>
        </details>
        <button type="submit" className="rounded-lg border border-current disabled:opacity-50 px-5 py-2 font-bold" disabled={saving || !loaded || !observation.trim() || !lessonLabel.trim()}>{saving ? '保存中…' : '保存点评'}</button>
      </fieldset>
    </form>
    <div className="space-y-4">
      {!loaded && !error && <p role="status">正在读取课堂记录…</p>}
      {loaded && !notes.length && <p style={{ color: 'var(--text-light)' }}>还没有记录。从本节课的一次具体表现开始即可。</p>}
      {notes.map(note => <article key={note.id} className="rounded-xl border p-4 space-y-2" style={{ borderColor: 'var(--glass-border)' }}>
        <div className="flex flex-wrap justify-between gap-2"><h4 className="font-bold">{note.lesson_date} · {note.lesson_label}</h4><span className="text-sm">{note.teacher_name}</span></div>
        {note.supersedes_id && <p className="text-sm">更正记录 · 原编号 {note.supersedes_id.slice(0, 8)}</p>}
        <p className="whitespace-pre-wrap break-words">{note.observation}</p>
        {note.interpretation && <p className="whitespace-pre-wrap break-words"><span className="font-semibold">教师判断：</span>{note.interpretation}</p>}
        {note.next_step && <p className="whitespace-pre-wrap break-words"><span className="font-semibold">指导 / 下次关注：</span>{note.next_step}</p>}
        {note.evidence.length > 0 && <details><summary className="text-sm cursor-pointer">已关联 {note.evidence.length} 条学习证据</summary>{note.evidence.map(item => <p className="text-sm break-all mt-1" key={item.event_id}>{eventLabels[item.event_type] || item.event_type} · {item.created_at} · {item.event_id}</p>)}</details>}
        <div className="flex justify-between gap-3 text-sm" style={{ color: 'var(--text-light)' }}><span>记录于 {new Date(note.created_at).toLocaleString('zh-CN')}</span><button type="button" className="underline" disabled={saving} onClick={() => { setSupersedes(note.id); setLessonDate(note.lesson_date); setLessonLabel(note.lesson_label); formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>追加更正</button></div>
      </article>)}
      {hasMore && <button type="button" className="rounded-lg border border-current disabled:opacity-50 px-4 py-2" onClick={loadMore} disabled={loadingMore}>{loadingMore ? '加载中…' : '更早记录'}</button>}
    </div>
    <p className="text-sm" style={{ color: 'var(--text-light)' }}>导出使用内部研究关联编号，不包含姓名列；自由文本仍可能含个人信息，对外分享前请核对。</p>
  </section>;
}
