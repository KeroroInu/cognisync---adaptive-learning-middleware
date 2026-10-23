import React,{Suspense,useCallback,useEffect,useMemo,useRef,useState} from 'react';
import { reviewRequest,setReviewHold,emptyReviewAnswers,type Review,type ReviewAnswers,type ReviewCase } from '../services/projectReview';
import type { PythonGameState, PythonCreativeHookError } from '../services/pythonModuleRunner';
import './ProjectReviewGate.css';
const Preview=React.lazy(()=>import('./ProjectBuildStage').then(m=>({default:m.SnakeBuildPreview})));
const BasicPreview=React.lazy(()=>import('./BasicSnakeReviewPreview'));

/** Pause normal workspace execution; its existing scoped drafts stay untouched. */
export const ProjectReviewGate:React.FC<{children:React.ReactNode;userId:string}>=({children,userId})=>{
  const [row,setRow]=useState<Review|null>(null),[error,setError]=useState(''),[ready,setReady]=useState(false),[showResult,setShowResult]=useState(false);
  const refresh=useRef<()=>void>(()=>{});
  useEffect(()=>{
    const controller=new AbortController();let pending=false,previousKey:string|undefined,lastFullId:string|undefined;
    const load=async()=>{if(pending)return;pending=true;try{
      const status=await reviewRequest<Pick<Review,'id'|'revision'|'ai_hold'|'round_status'|'results_published'>|null>('/current?status_only=true',undefined,controller.signal);
      if(controller.signal.aborted)return;
      setReviewHold(Boolean(status?.ai_hold));
      if(status?.ai_hold&&status.id!==lastFullId)setReady(false);
      if(status)setRow(old=>old?.id===status.id&&(old.ai_hold!==status.ai_hold||old.round_status!==status.round_status)?{...old,ai_hold:status.ai_hold,round_status:status.round_status}:old);
      const key=JSON.stringify(status);
      if(key!==previousKey){
        const next=status?await reviewRequest<Review>('/current',undefined,controller.signal):null;
        if(controller.signal.aborted)return;
        setRow(next);setReviewHold(Boolean(next?.ai_hold));lastFullId=next?.id;previousKey=key;
      }
      setReady(true);setError('');
    }catch{if(!controller.signal.aborted)setError('未能确认回顾状态，请检查连接后重试。');}finally{pending=false;}};
    refresh.current=()=>void load();void load();const timer=setInterval(()=>{if(document.visibilityState!=='hidden')void load();},3000);
    window.addEventListener('focus',refresh.current);
    return()=>{controller.abort();clearInterval(timer);window.removeEventListener('focus',refresh.current);setReviewHold(false);};
  },[userId]);
  return <>
    {ready&&!row?.ai_hold&&!showResult?children:null}
    {!ready?<section className="project-review"><h1>正在确认课堂安排…</h1>{error&&<p role="alert">{error}<button onClick={()=>refresh.current()}>重试</button></p>}</section>:null}
    {ready&&row&&(row.ai_hold||showResult)?<ProjectReview key={row.id} initial={row} update={setRow} />:null}
    {row&&!row.ai_hold?<button className="review-result-toggle" onClick={()=>setShowResult(v=>!v)}>{showResult?'返回课堂':'查看项目回顾'}</button>:null}
    {ready&&error?<p className="review-network" role="alert">{error}<button onClick={()=>refresh.current()}>重试</button></p>:null}
  </>;
}

function restored(row:Review):ReviewAnswers{
  const blank=emptyReviewAnswers(),server={...blank,...row.answers};
  try{const saved=JSON.parse(localStorage.getItem(`cognisync:review:${row.id}`)||'null');
    if(!row.submitted_at&&saved?.revision===row.revision&&saved.answers&&typeof saved.answers.q1==='string')return {...server,...saved.answers};
  }catch{/* Server draft remains available. */}
  return server;
}

export const ProjectReview:React.FC<{initial:Review;update:(row:Review)=>void}>=({initial,update})=>{
  const [row,setRow]=useState(initial),[answers,setAnswers]=useState(()=>restored(initial));
  const [step,setStep]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState(''),[label,setLabel]=useState('');
  const [file,setFile]=useState(''),[start,setStart]=useState(1),[end,setEnd]=useState(1),[runOpen,setRunOpen]=useState(false);
  const [confirm,setConfirm]=useState(false);
  const lock=useRef(false),retry=useRef<{hash:string;id:string}|null>(null),lastRun=useRef<{before:Pick<PythonGameState,'snake'> & Partial<Pick<PythonGameState,'food'|'score'>>;after:Pick<PythonGameState,'snake'> & Partial<Pick<PythonGameState,'food'|'score'>>;at:string}|null>(null);
  const output=useRef<string[]>([]);
  const readOnly=Boolean(row.submitted_at)||!initial.ai_hold||initial.round_status!=='open';
  const question=row.template.questions[step];
  const files=row.snapshot?.files||{};
  const selected=file||Object.keys(files)[0]||'';
  const previewBundle=useMemo(()=>{
    const basic=Object.entries(row.snapshot?.files||{}).filter(([key])=>key.startsWith('base::')).map(([key,value])=>[key.slice(6),value]);
    return basic.length?Object.fromEntries(basic):row.snapshot?.files['main.py']?{'free-program':row.snapshot.files['main.py']}:{};
  },[row.snapshot]);
  const capabilities=useMemo(()=>new Set('free-program' in previewBundle?['initial-state','movement','direction-input','game-loop']:Object.keys(previewBundle)),[previewBundle]);
  const creatives=useMemo(()=>(row.snapshot?.creative_functions||[]).filter(c=>c.enabled&&c.verified),[row.snapshot]);
  const transition=useCallback((before:Pick<PythonGameState,'snake'> & Partial<Pick<PythonGameState,'food'|'score'>>,after:Pick<PythonGameState,'snake'> & Partial<Pick<PythonGameState,'food'|'score'>>)=>{lastRun.current={before,after,at:new Date().toISOString()};},[]);
  const onOutput=useCallback((source:string,lines:string[])=>{output.current=[...output.current,...lines.map(l=>`${source}: ${l}`)].slice(-25);},[]);
  const onCreativeError=useCallback((errors:PythonCreativeHookError[])=>{onOutput('创意运行错误',errors.map(e=>`${e.cardId}: ${e.detail}`));},[onOutput]);
  useEffect(()=>{if(readOnly)return;try{localStorage.setItem(`cognisync:review:${row.id}`,JSON.stringify({revision:row.revision,answers}));}catch{setError('本机草稿未能保存，请点保存草稿。');}},[answers,row.id,row.revision,readOnly]);
  const adopt=(next:Review)=>{setRow(next);update(next);setAnswers({...emptyReviewAnswers(),...next.answers});};
  const act=async(action:'begin'|'save'|'prediction'|'plan'|'submit')=>{
    if(lock.current)return false;lock.current=true;setBusy(true);setError('');
    try{
      const payload=action==='begin'?{}:{revision:row.revision,action,answers};
      const hash=JSON.stringify(payload);if(retry.current?.hash!==hash)retry.current={hash,id:crypto.randomUUID()};
      const next=await reviewRequest<Review>(`/${row.id}/${action==='begin'?'begin':'save'}`,action==='begin'?{}:{...payload,request_id:retry.current.id});
      adopt(next);retry.current=null;setLabel('已保存');setConfirm(false);return true;
    }catch(cause){setError(cause instanceof Error?cause.message:'保存失败');return false;}finally{lock.current=false;setBusy(false);}
  };
  const change=(patch:Partial<ReviewAnswers>)=>{setAnswers(a=>({...a,...patch}));setLabel('未同步，请保存');};
  const changeCase=(key:'move'|'eat',patch:Partial<ReviewCase>)=>change({[key]:{...answers[key],...patch}});
  const capture=async(key:'move'|'eat')=>{
    if(lock.current)return;lock.current=true;setBusy(true);setError('');
    try{
      const frame=lastRun.current;
      const result=await reviewRequest<{id:string}>(`/${row.id}/runs`,{request_id:crypto.randomUUID(),scenario:key,snapshot_hash:row.snapshot_hash,
        length_source:frame?'browser_runner':'student_report',observed_at:frame?.at||null,
        before:frame?.before.snake.length??answers[key].before,after:frame?.after.snake.length??answers[key].after,
        output:[...output.current,...(frame?[JSON.stringify({before:{head:frame.before.snake[0],food:frame.before.food,length:frame.before.snake.length,score:frame.before.score},after:{head:frame.after.snake[0],food:frame.after.food,length:frame.after.snake.length,score:frame.after.score},source:'last_browser_step'})]:['没有自动帧证据；数值由学生自报'])].slice(-30).map(line=>line.slice(0,1000))});
      changeCase(key,{run_id:result.id,...(frame?{before:frame.before.snake.length,after:frame.after.snake.length}:{})});setLabel('运行记录已留存，请保存草稿');
    }catch(cause){setError(cause instanceof Error?cause.message:'记录失败');}finally{lock.current=false;setBusy(false);}
  };
  if(row.submitted_at||!initial.ai_hold)return <section className="project-review review-status"><small>项目回顾</small><h1>{row.submitted_at?'已提交给老师':'本轮已结束'}</h1>
    <p>{initial.ai_hold?'站内 AI 仍暂停，等老师结束本轮。':'你的原作品没有被修改。未提交的草稿也会保留。'}</p>
    {initial.results_published?<>{initial.grade?<p>本次核查：{initial.grade.total} / 10<br/>{initial.grade.notes.join(' ')}</p>:<p>老师尚未评分。</p>}
      {initial.rubric?<details><summary>查看本次答案与评分说明</summary>{initial.template.questions.map(q=><section key={q.id}><h3>{q.title}</h3><ul>{(initial.rubric?.[q.id] as string[]||[]).map(line=><li key={line}>{line}</li>)}</ul></section>)}<p>{initial.rubric.notes}</p></details>:null}</>:<p>暂不公布答案和分数。</p>}</section>;
  return <section className="project-review" aria-label="项目回顾">
    <header><div><small>自己的作品，自己说清楚</small><h1>项目回顾</h1></div><span>本页不提供 AI · 无硬性倒计时</span></header>
    {!row.started_at?<div className="review-intro"><p>三个小问题。选择代码片段、预测结果，再用自己的游戏检查。写短句就好，不会也可如实说明。</p><p>开始时会保留服务器已保存的作品副本，不改你的原作品。若作品未同步，请先联系老师。</p><button disabled={busy} onClick={()=>void act('begin')}>开始回顾</button></div>:<>
      <nav aria-label="回顾题目">{row.template.questions.map((q,i)=><button key={q.id} disabled={busy||(i===2&&!row.first_prediction)} aria-current={step===i?'step':undefined} onClick={async()=>{if(await act('save'))setStep(i);}}>{i+1} · {q.title}</button>)}</nav>
      <h2>{question.title}</h2><p>{question.text}</p>
      {step===0?<div className="review-code-layout"><section><label>代码片段<select value={selected} onChange={e=>{setFile(e.target.value);setStart(1);setEnd(1);}}>{Object.keys(files).map(key=><option key={key}>{key}</option>)}</select></label>
        <pre className="review-code">{(files[selected]||'尚无已保存的代码，可直接说明。').split('\n').map((line,i)=><span key={i}><b>{i+1}</b>{line+'\n'}</span>)}</pre>
        {selected?<div className="review-ranges"><label>起始行<input type="number" min={1} value={start} onChange={e=>setStart(Number(e.target.value))}/></label><label>结束行<input type="number" min={start} value={end} onChange={e=>setEnd(Number(e.target.value))}/></label><button disabled={busy||answers.snippets.length>=8} onClick={()=>change({snippets:[...answers.snippets,{file:selected,start,end}]})}>引用这段</button></div>:null}
      </section><section>{answers.snippets.map((s,i)=><p key={i}>{s.file} · {s.start}—{s.end} 行 <button aria-label={`移除片段${i+1}`} onClick={()=>change({snippets:answers.snippets.filter((_,j)=>j!==i)})}>移除</button></p>)}
        <label>简单解释<textarea maxLength={200} value={answers.q1} onChange={e=>change({q1:e.target.value})} placeholder="两句即可；也可以指出自己的代码哪里不对。"/></label><small>{answers.q1.length}/200</small></section></div>:null}
      {step===1?<><pre className="review-code">{question.code}</pre><fieldset disabled={busy||Boolean(row.first_prediction)}><legend>修改后输出什么？</legend><div className="review-options">{question.options?.map(option=><label key={option}><input type="radio" name="q2" checked={answers.q2_choice===option} onChange={()=>change({q2_choice:option})}/>{option}</label>)}</div><label>一句理由<textarea maxLength={150} value={answers.q2_reason} onChange={e=>change({q2_reason:e.target.value})}/></label></fieldset>
        {row.first_prediction?<p>首次预测已锁定：{row.first_prediction.choice}。继续下一题即可，暂不揭晓答案。</p>:<button disabled={busy||!answers.q2_choice} onClick={()=>void act('prediction')}>保存预测</button>}</>:null}
      {step===2?<><div className="review-cases">{(['move','eat'] as const).map(key=><section key={key}><h3>{key==='move'?'普通移动，没有吃到食物':'吃到一次食物'}</h3>
        <label>我预计长度<select disabled={!!row.test_plan} value={answers[key].expected} onChange={e=>changeCase(key,{expected:e.target.value})}>{['','不变','增加1','减少1','其他'].map(v=><option key={v} value={v}>{v||'请选择'}</option>)}</select></label>
        {row.test_plan?<><div className="review-ranges">{(['before','after'] as const).map(field=><label key={field}>{field==='before'?'之前长度':'之后长度'}<input type="number" min={0} max={10000} value={answers[key][field]??''} onChange={e=>changeCase(key,{[field]:e.target.value===''?null:Number(e.target.value)})}/></label>)}</div>
          <button disabled={busy} onClick={()=>void capture(key)}>引用刚才运行的记录</button>{answers[key].run_id?<small>已关联本次运行记录</small>:null}
          <label>我的判断<select value={answers[key].status} onChange={e=>changeCase(key,{status:e.target.value})}>{['','符合预期','不符合预期','证据不足','无法完成','无法判断'].map(v=><option key={v} value={v}>{v||'请选择'}</option>)}</select></label>
          <textarea aria-label={`${key}依据`} maxLength={150} placeholder="一句依据；无法运行时写原因。" value={answers[key].reason} onChange={e=>changeCase(key,{reason:e.target.value})}/></>:null}
      </section>)}</div>
      {!row.test_plan?<button disabled={busy||!answers.move.expected||!answers.eat.expected} onClick={()=>void act('plan')}>保存预期，再验证</button>:<><p className="review-note">引用的是刚才最后一步的浏览器记录，情境由你判断；手填数值属于自报，不是系统判定。没运行成功也可记录原因。</p><button onClick={()=>{lastRun.current=null;setRunOpen(v=>!v);}}>{runOpen?'收起游戏':'打开冻结作品验证'}</button>
        {runOpen?<div className="review-preview"><Suspense fallback={<p>正在加载运行器…</p>}>{row.snapshot?.runtime === 'basic-snake/v1' ? <BasicPreview code={files['main.py'] ?? ''} onTransition={transition} onOutput={onOutput}/> : <Preview language="zh" capabilities={capabilities} codeByNode={previewBundle} creativeFunctions={creatives} demonstration={null} onCreativeRuntimeErrors={onCreativeError} onRuntimeOutput={onOutput} onReviewTransition={transition}/>}</Suspense></div>:null}
        <small>{row.snapshot?.note}</small></>}</>:null}
      <footer><span role="status">{busy?'正在保存…':label||'草稿可保存'}</span><button disabled={busy||readOnly} onClick={()=>void act('save')}>保存草稿</button>
        {step<2?<button disabled={busy||(step===1&&!row.first_prediction)} onClick={async()=>{if(await act('save'))setStep(s=>s+1);}}>下一题</button>:<button disabled={busy||!row.test_plan} onClick={()=>setConfirm(true)}>交给老师</button>}</footer>
      {confirm?<section role="alertdialog" aria-label="确认提交"><p>提交后不能修改。站内 AI 要等老师结束本轮才恢复。</p><button disabled={busy} onClick={()=>void act('submit')}>确认提交</button><button disabled={busy} onClick={()=>setConfirm(false)}>再看看</button></section>:null}
    </>}
    {error?<p role="alert">{error}</p>:null}
  </section>;
}
