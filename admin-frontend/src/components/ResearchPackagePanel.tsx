import { useEffect, useRef, useState } from 'react';
import { adminApi, type ResearchExportLesson } from '../lib/adminApi';
import { Download } from 'lucide-react';
import { TEACHING_CLASSES } from '../lib/teachingClasses';

interface LessonCatalog {
  className: string;
  status: 'loading' | 'ready' | 'error';
  lessons: ResearchExportLesson[];
  error: string;
}

export function researchPackageFilename(className: string, lessonLabel: string, date = new Date()) {
  const safePart = (value: string) => [...value].filter(char => char.charCodeAt(0) > 31 && char.charCodeAt(0) !== 127).join('')
    .replace(/[\\/:*?"<>|]/g, '').trim().replace(/\s+/g, '_').replace(/^[. ]+|[. ]+$/g, '').slice(0, 24);
  const lessonNumber = lessonLabel.match(/第\s*(\d+)\s*课/);
  const lesson = lessonNumber ? `第${Number(lessonNumber[1])}课` : lessonLabel;
  return `SFLS_实验数据_${safePart(lesson) || '全部课次'}_${safePart(className) || '全部班级'}_${date.toISOString().slice(0, 10)}.zip`;
}

export function ResearchPackagePanel() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [className, setClassName] = useState('');
  const [lessonKey, setLessonKey] = useState('');
  const [catalog, setCatalog] = useState<LessonCatalog>({ className: '', status: 'loading', lessons: [], error: '' });
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [identity, setIdentity] = useState(false);
  const [graph, setGraph] = useState(true);
  const [originals, setOriginals] = useState(true);
  const lock = useRef(false);
  const catalogReady = catalog.className === className && catalog.status === 'ready';
  const selectedLesson = catalogReady ? catalog.lessons.find(item => item.key === lessonKey) : undefined;

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    const timer = setTimeout(() => controller.abort(), 15000);
    setCatalog({ className, status: 'loading', lessons: [], error: '' });
    void adminApi.getResearchExportLessons(className, controller.signal).then(result => {
      if (!Array.isArray(result.lessons)) throw new Error('课次目录格式异常，请重试。');
      if (!disposed) setCatalog({ className, status: 'ready', lessons: result.lessons, error: '' });
    }).catch(cause => {
      if (!disposed) setCatalog({
        className, status: 'error', lessons: [],
        error: controller.signal.aborted ? '课次读取超时，请重试。' : cause instanceof Error ? cause.message : '暂时无法读取课次，请重试。',
      });
    }).finally(() => clearTimeout(timer));
    return () => { disposed = true; clearTimeout(timer); controller.abort(); };
  }, [className, catalogRevision]);

  function changeClass(nextClass: string) {
    setClassName(nextClass);
    setLessonKey('');
    setCatalog({ className: nextClass, status: 'loading', lessons: [], error: '' });
    setError(''); setMessage('');
  }

  async function download() {
    if (lock.current || !catalogReady || (lessonKey && !selectedLesson)) return;
    lock.current = true;
    setBusy(true); setError(''); setMessage('');
    try {
      const params = new URLSearchParams({ include_identity: String(identity), include_graph: String(graph), include_originals: String(originals) });
      if (className.trim()) params.set('class_name', className.trim());
      if (lessonKey) params.set('lesson_key', lessonKey);
      const blob = await adminApi.exportCsv(`/export/research-package?${params}`);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = researchPackageFilename(className, selectedLesson?.label || '全部课次');
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('已开始下载。解压后先看「归档说明.md」了解本次范围，题目数据另见「分析说明.md」。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '导出失败，请重试');
    } finally { lock.current = false; setBusy(false); }
  }
  return <section className="research-download" aria-label="完整研究包" aria-busy={busy || catalog.status === 'loading'}>
    <div className="exports-controls">
      <div className="exports-field"><label htmlFor="research-export-class">选择班级</label><select id="research-export-class" value={className} onChange={event => changeClass(event.target.value)} disabled={busy}>
        <option value="">全部学生（含体验组与历史班级）</option>{TEACHING_CLASSES.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}
      </select></div>
      <div className="exports-field"><label htmlFor="research-export-lesson">选择课次</label><select id="research-export-lesson" value={lessonKey} onChange={event => { setLessonKey(event.target.value); setError(''); setMessage(''); }} disabled={busy || !catalogReady} aria-describedby="research-export-scope">
        <option value="">全部课次</option>{catalogReady && catalog.lessons.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
      </select></div>
      <button type="button" onClick={download} disabled={busy || !catalogReady} className="exports-download"><Download size={18} />{busy ? '正在打包…' : '下载实验数据'}</button>
    </div>
    {catalog.status === 'loading' && <p className="exports-catalog-status" role="status">正在读取课次…</p>}
    {catalog.status === 'error' && <div className="exports-catalog-error" role="alert"><span>课次目录读取失败：{catalog.error}</span><button type="button" onClick={() => { setLessonKey(''); setCatalogRevision(value => value + 1); }}>重新读取</button></div>}
    <p id="research-export-scope" className="exports-scope">{selectedLesson ? `${selectedLesson.students} 位学生 · ${selectedLesson.submissions} 次提交。` : catalogReady && catalog.lessons.length === 0 ? '暂无可单独导出的课次，可下载全部记录。' : ''}按课次、班级、学生与历次提交整理；问卷、量表等跨课资料仍保留，无法确认课次的记录单独保留，不猜测归类。</p>
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
      <p>超过打包上限时，可按课次或班级分批导出，或取消“包含上传原件”后下载分析数据，再到任务收件处下载原件。不截断记录。</p>
    </details>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
