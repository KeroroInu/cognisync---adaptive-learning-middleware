import type { StudentCreativeFunction } from '../data/snakeCreativeFunctions';
export const REVIEW_HOLD_EVENT = 'cognisync:project-review-hold';
let generation = 0;
let holding = false;
export function setReviewHold(value: boolean) {
  if (value !== holding) { holding = value; generation++; window.dispatchEvent(new CustomEvent(REVIEW_HOLD_EVENT, {detail:value})); }
}
export const reviewGeneration = () => generation;
export function assertReviewResponse(epoch: number) {
  if (holding || epoch !== generation) throw new Error('项目回顾期间暂停 AI，本条在途回复不展示。');
}
export type ReviewCase = {expected:string; before:number|null; after:number|null; status:string; reason:string; run_id?:string|null};
export type ReviewAnswers = {snippets:{file:string;start:number;end:number}[]; q1:string;q2_choice:string;q2_reason:string;move:ReviewCase;eat:ReviewCase};
export const emptyReviewAnswers = ():ReviewAnswers => ({snippets:[],q1:'',q2_choice:'',q2_reason:'',
  move:{expected:'',before:null,after:null,status:'',reason:''},eat:{expected:'',before:null,after:null,status:'',reason:''}});
export type Review = {id:string;round_id:string;title:string;round_status:string;ai_hold:boolean;revision:number;submitted_at:string|null;started_at:string|null;
  template:{version:string;questions:{id:string;title:string;text:string;code?:string;options?:string[];max_length:number}[]};template_hash:string;
  snapshot:{files:Record<string,string>;runtime?:string;creative_functions?:StudentCreativeFunction[];note:string}|null;snapshot_hash:string|null;answers:Partial<ReviewAnswers>;
  first_prediction:{choice:string;reason:string}|null;test_plan:Record<string,string>|null;results_published:boolean;
  grade?:{scores:number[];notes:string[];total:number}|null;rubric?:Record<string,string[]|string>};
export async function reviewRequest<T>(path:string,body?:unknown,signal?:AbortSignal):Promise<T> {
  const controller=new AbortController(),abort=()=>controller.abort();
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(abort,15000);
  try {
  const response=await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ''}/api/project-review${path}`,{
    method:body===undefined?'GET':'POST',signal:controller.signal,headers:{'Content-Type':'application/json',Authorization:`Bearer ${localStorage.getItem('cognisync-token')||''}`},
    body:body===undefined?undefined:JSON.stringify(body)});
  const result=await response.json();
  if(!response.ok||!result.success) throw new Error(typeof result.detail==='string'?result.detail:result.detail?.message||'未保存成功，请重试。');
  return result.data;
  } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
