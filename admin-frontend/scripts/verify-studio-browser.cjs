const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await context.addInitScript(() => localStorage.setItem('auth_token', 'isolated-teacher-test'));
    const page = await context.newPage(), errors = [], unknown = [], writes = [];
    page.setDefaultTimeout(12000);
    page.on('pageerror', e => errors.push(e.message));
    const tasks = [{ id: 'ordinary', title: '贪吃蛇：常规协作', target_group: 'ai_pbl' }, { id: 'decompose', title: '贪吃蛇：解构协作', target_group: 'pdt' }];
    let plan = null; const materials = Array.from({length:8},(_,i)=>({id:`task-${i}`,title:`第 ${i+1} 个任务`,kind:'sfls',closed_at:null,student_visible:false,configuration:{task:'完成本课创作'}})), questionSets = [], sentSets = [];
    let prompt = null;
    const practice = { id:'list-append-v1', question:'运行后有几个元素？', code:'items = [1, 2]\nitems.append(3)',
      answer:'3', explanation:'在末尾加一个。', rubric:'只判断本题，不代表掌握。', knowledge_id:'lists',
      kind:'understanding_check', content_hash:'frozen-test-hash', approved:false };
    const reviews = [];
    const projectMode = process.env.PROJECT_REVIEW === '1';
    const worksheetMode = process.env.WORKSHEET === '1';
    const sourceTemplates = JSON.parse(await fs.readFile(path.resolve(__dirname, '../../backend/app/resources/worksheet_templates.json'), 'utf8'));
    const worksheetTemplates = sourceTemplates.lessons.flatMap(lesson => Object.entries(lesson.conditions).map(([condition, prompts]) => ({
      lesson_id: lesson.lesson_id, template_version: sourceTemplates.template_version, condition: condition === 'deconstruction' ? 'pdt' : 'ai_pbl',
      title: lesson.title, objective: lesson.goal, rules: [], acceptance: lesson.acceptance, analysis_prompt: prompts.analysis_prompt, change_prompt: prompts.plan_prompt,
      test_hint: lesson.common_test_hint, teacher_review: lesson.teacher_review[condition], common_exit: lesson.common_exit,
    })));
    const projectTemplate = projectMode ? JSON.parse(require('node:child_process').execFileSync(process.env.TEST_PYTHON || 'python3', ['-c', 'import json; from app.services.project_review import TEMPLATE; print(json.dumps(TEMPLATE))'], {cwd:path.resolve(__dirname,'../../backend'),encoding:'utf8'})) : null;
    const projectRounds = [], projectActions = [];
    const projectResponse = {id:'response',name:'测试同学',student_id:'001',group_snapshot:'ai_pbl',started_at:'now',submitted_at:'now',ai_hold:true,revision:3,snapshot:{files:{'main.py':'snake = []'}},snapshot_hash:'code-hash',answers:{q1:'我的解释'},first_prediction:{choice:'3 0'},test_plan:{move:'不变',eat:'增加1'},grade:null};
    await context.route('**/*', async route => {
      const pathname = new URL(route.request().url()).pathname;
      const json = data => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
      if (pathname === '/api/admin/auth/me') return json({ user: { id: 'teacher', name: '测试教师', role: 'admin' }, profile: null });
      if (pathname === '/api/admin/classroom/worksheet-templates') return json(worksheetTemplates);
      if (pathname.endsWith('/worksheets')) return json({total:1,items:[{name:'学生甲',student_id:'001',user_id:'u',worksheet_revision_id:'revision-1',revision:1,action:'plan',saved_at:new Date().toISOString(),plan_revision_id:'revision-1',design_revision:null,answers:{analysis_note:'先检查障碍位置',change_plan:'先实现一次绕行',sources:['ai'],advice_choice:null,decision_note:'',tests:[],closing_note:''}}]});
      if (projectMode && pathname.startsWith('/api/admin/project-review/')) {
        if (pathname.endsWith('/template')) return json({template:projectTemplate,template_hash:'question-hash'});
        if (pathname.endsWith('/rounds')) {
          if (route.request().method()==='POST') {const body=route.request().postDataJSON();projectRounds.push({id:body.request_id,status:'draft',template_hash:'question-hash',template:projectTemplate,session_ids:body.session_ids,results_published:false});return json({id:body.request_id});}
          return json(projectRounds);
        }
        if (pathname.endsWith('/control')) {const body=route.request().postDataJSON();projectActions.push(body);const r=projectRounds[0];assert.equal(body.template_hash,r.template_hash);if(body.action==='open')r.status='open';if(body.action==='end'){r.status='ended';projectResponse.ai_hold=false;}if(body.action==='publish'){assert.ok(body.confirmed_both_groups_ended);r.results_published=true;}return json({});}
        if (pathname.endsWith('/responses')) return json(projectRounds[0]?.status==='draft'?[]:[projectResponse]);
        if (pathname.endsWith('/events')) return json({items:[{kind:'run',payload:{verified_by_server:false,length_source:'student_report'}}]});
        if (pathname.endsWith('/grade')) {const body=route.request().postDataJSON();projectResponse.grade={...body,total:body.scores.reduce((a,b)=>a+b,0)};return json({});}
      }
      if (pathname === '/api/learning-support/practice-templates') return json([practice]);
      if (pathname === '/api/learning-support/practice-templates/list-append-v1/review') {
        const params = new URL(route.request().url()).searchParams;
        assert.equal(route.request().method(), 'POST');
        assert.equal(params.get('content_hash'), practice.content_hash);
        practice.approved = params.get('approved') === 'true'; reviews.push(practice.approved);
        return json({approved:practice.approved});
      }
      if (pathname === '/api/admin/assessments/templates/learning-background') return json(JSON.parse(await fs.readFile(path.resolve(__dirname, '../../backend/app/resources/programming_ai_survey_v2.json'), 'utf8')));
      if (pathname === '/api/admin/assessments') { assert.equal(route.request().method(), 'GET', 'opening a template must not publish or save'); return json([]); }
      if (pathname === '/api/admin/classroom/sessions') return json([{ id: 's', class_name: '开发班', title: '条件与列表', state: 'open', closes_at: null, created_at: new Date().toISOString(), is_current: true, prompt, response_count: 0 }]);
      if (pathname.endsWith('/question-sets')) {
        if (route.request().method() === 'POST') { const body = route.request().postDataJSON(); questionSets.push({ ...body, id: body.request_id }); return json(questionSets.at(-1)); }
        return json(questionSets);
      }
      if (pathname.endsWith('/question-sets/send')) { const body = route.request().postDataJSON(); sentSets.push(body); const set = questionSets.find(s => s.id === body.set_id); prompt = { id: body.request_id, questions: set.questions, question: set.questions[0], title: set.title, closed_at: null }; return json(prompt); }
      if (pathname.endsWith('/responses')) return json({ prompt, total: 0, total_students: 30, responses: [] });
      if (pathname.endsWith('/lesson-tasks')) return json(tasks);
      if (pathname.endsWith('/sessions/s/materials')) return json(materials);
      const control = pathname.match(/^\/api\/admin\/classroom\/materials\/(task-\d+)\/(open|close)$/);
      if (control) {
        assert.equal(route.request().method(),'POST');
        for (const item of materials) {
          if (control[2] === 'open' || item.id === control[1]) {
            item.student_visible = control[2] === 'open' && item.id === control[1];
            item.closed_at = item.student_visible ? null : new Date().toISOString();
          }
        }
        return json(materials.find(item=>item.id===control[1]));
      }
      if (pathname.endsWith('/sessions/s/files')) { const query = new URL(route.request().url()).searchParams; assert.equal(query.get('accept_submissions'), 'true'); materials.push({ id: query.get('request_id'), title: query.get('filename'), kind: 'file', closed_at: null, configuration: { accept_submissions: true } }); return json(materials.at(-1)); }
      if (pathname.endsWith('/sessions/s/packages')) { const body = route.request().postDataJSON(); assert.equal(body.runtime, 'sfls'); if (!worksheetMode) { assert.equal(body.phase, 'pre'); assert.equal(body.inherit_previous, false); } materials.push({ id: body.request_id, title: body.title, kind: body.runtime, closed_at: null, configuration: body }); return json(materials.at(-1)); }
      if (pathname.endsWith('/sessions/s/evidence')) return json({ total: 1, knowledge_points: ['列表'], limitation: '同名提及，不是掌握度。', items: [{ id: 'e', user_id: 'u', name: '同学甲', student_id: '001', at: new Date().toISOString(), parts: [{ role: 'student', kind: 'chat', text: '列表如何添加元素', mentioned_targets: ['列表'] }, { role: 'assistant', kind: 'reply', text: '先试 append', mentioned_targets: [] }], payload: {} }] });
      if (pathname.endsWith('/sessions/s/lesson/start')) { writes.push('start'); plan.started_at = new Date().toISOString(); return json({ id: plan.id, started_at: plan.started_at }); }
      if (pathname.endsWith('/sessions/s/lesson')) {
        if (route.request().method() === 'POST') {
          const body = route.request().postDataJSON(); writes.push(body);
          plan = { id: 'plan', started_at: null, configuration: { ...body, tasks: Object.fromEntries(Object.entries(body.tasks).map(([group, id]) => [group, tasks.find(t => t.id === id)])) } };
        }
        return json(plan);
      }
      if (pathname.startsWith('/api/')) { unknown.push(pathname); return route.fulfill({ status: 404, body: '{}' }); }
      const root = process.env.ADMIN_BUILD_DIR || path.resolve(__dirname, '../dist');
      const relative = pathname.startsWith('/admin/assets/') ? pathname.slice('/admin'.length) : '/index.html';
      const candidate = path.resolve(root, '.' + relative);
      const type = path.extname(candidate) === '.js' ? 'text/javascript' : path.extname(candidate) === '.css' ? 'text/css' : 'text/html';
      return route.fulfill({ contentType: type, body: await fs.readFile(candidate) });
    });
    await page.goto('http://localhost:8003/admin/classroom');
    await page.getByRole('button', {name:'＋ 布置任务',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'开放此任务',exact:true}).count(),8);
    const row = title => page.locator('.lesson-materials li').filter({has:page.getByText(title,{exact:true})});
    await row('第 3 个任务').getByRole('button',{name:'开放此任务',exact:true}).click();
    await row('第 3 个任务').getByText('学生正在看',{exact:false}).waitFor();
    assert.equal(await page.getByRole('button',{name:'收起任务',exact:true}).count(),1);
    await row('第 4 个任务').getByRole('button',{name:'开放此任务',exact:true}).click();
    await row('第 4 个任务').getByRole('button',{name:'收起任务',exact:true}).waitFor();
    assert.equal(await row('第 3 个任务').getByRole('button',{name:'开放此任务',exact:true}).count(),1);
    await row('第 4 个任务').getByRole('button',{name:'收起任务',exact:true}).click();
    await row('第 4 个任务').getByRole('button',{name:'开放此任务',exact:true}).waitFor();
    assert.equal(await page.getByRole('button', {name:'开始分组课堂'}).count(),0);
    for (const theme of ['light','dark']) {
      await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme);
      await page.waitForTimeout(250);
      await page.screenshot({path:'/tmp/sfls-teacher-'+theme+'.png',fullPage:true});
    }
    await page.getByRole('button', {name:'＋ 布置任务',exact:true}).click();
    await page.screenshot({path:'/tmp/sfls-teacher-compose.png',fullPage:true});
    await page.getByRole('link', {name:'测试与量表',exact:true}).click();
    await page.getByRole('heading', {name:'问卷与量表',exact:true}).waitFor();
    assert.deepEqual(errors,[]); assert.deepEqual(unknown,[]);
    console.log('teacher simplified navigation, task composer and assessments passed');
    await context.close();
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
