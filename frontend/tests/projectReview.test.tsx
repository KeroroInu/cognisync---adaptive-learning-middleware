import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {ProjectReview} from '../components/ProjectReviewGate';
import {emptyReviewAnswers,type Review} from '../services/projectReview';

const row:Review={id:'isolated',round_id:'round',title:'项目回顾',round_status:'open',ai_hold:true,revision:0,
  started_at:null,submitted_at:null,template:{version:'v1',questions:[{id:'q1',title:'找到代码',text:'两句说明',max_length:200}]},
  template_hash:'sha',snapshot:null,snapshot_hash:null,answers:emptyReviewAnswers(),first_prediction:null,test_plan:null,results_published:false};
const render=(patch:Partial<Review>)=>renderToStaticMarkup(<ProjectReview initial={{...row,...patch}} update={()=>{}}/>);
it('does not run games or offer AI on entry',()=>{
  const html=render({});expect(html).toContain('开始回顾');expect(html).not.toContain('打开冻结作品验证');expect(html).not.toContain('问 AI');
});
it('keeps submission read-only and unpublished grade hidden',()=>{
  const html=render({submitted_at:'now',grade:{scores:[3,3,4],notes:['secret','',''],total:10}});
  expect(html).toContain('站内 AI 仍暂停');expect(html).not.toContain('secret');expect(html).not.toContain('保存草稿');
});
it('distinguishes ungraded from zero after publication and shows reviewed rubric',()=>{
  const html=render({ai_hold:false,submitted_at:'now',results_published:true,grade:null,rubric:{q1:['教师判据'],notes:'不是能力量表'}});
  expect(html).toContain('尚未评分');expect(html).toContain('教师判据');expect(html).not.toContain('0 / 10');
});
