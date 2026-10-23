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
    let plan = null; const materials = [], questionSets = [], sentSets = [];
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
    await page.getByRole('heading', { name: '学生在准备区' }).waitFor();
    if (worksheetMode) {
      const panel=page.getByRole('region',{name:'作业与资料',exact:true});
      const config=panel.getByRole('region',{name:'任务单模板'});
      await config.locator('select').first().selectOption('L07');
      await config.locator('select').last().selectOption('ai_pbl');
      await panel.getByRole('button',{name:'发布给本班',exact:true}).last().click();
      await panel.getByRole('button',{name:'查看学生任务单',exact:true}).waitFor();
      assert.equal(materials.length,1); assert.equal(materials[0].configuration.worksheet.condition,'ai_pbl');
      assert.equal(materials[0].configuration.worksheet.analysis_prompt,worksheetTemplates.find(t=>t.lesson_id==='L07'&&t.condition==='ai_pbl').analysis_prompt);
      await panel.getByRole('button',{name:'查看学生任务单',exact:true}).click();
      await panel.getByText(/学生甲 · 001 · 版本 1/).click(); await panel.getByText('先检查障碍位置\n\n先实现一次绕行',{exact:true}).waitFor();
      await panel.getByLabel('用途',{exact:true}).selectOption('post'); assert.equal(await panel.getByRole('region',{name:'任务单模板'}).count(),0);
      await page.screenshot({path:'/tmp/worksheet-teacher.png',fullPage:true});
      assert.deepEqual(errors,[]); assert.deepEqual(unknown,[]);
      console.log('teacher worksheet: catalog, condition selection, immutable publication payload, history review, assessment exclusion passed');
      await context.close(); return;
    }
    if (projectMode) {
      await page.getByText('项目回顾 · 两组同题，不提供 AI',{exact:true}).click();
      const panel=page.locator('.teacher-project-review');
      await panel.getByText(/审阅题目与暂定 10 分标准/).click();
      await panel.getByText('预测输出 3 0（1分）',{exact:true}).waitFor();assert.equal(projectRounds.length,0);assert.deepEqual(projectActions,[]);
      await panel.getByRole('checkbox',{name:'开发班 · 条件与列表'}).check();await panel.getByRole('button',{name:'保存为草稿'}).click();
      const open=panel.getByRole('button',{name:'确认开放回顾'});await open.waitFor();assert.equal(await open.isDisabled(),true);
      await panel.getByRole('checkbox',{name:/我已核对本版本/}).check();await open.click();
      await panel.locator('.review-mark > summary').click();
      assert.equal(await panel.getByRole('button',{name:'保存人工评分'}).isDisabled(),true);
      for(let i=0;i<3;i++)await panel.locator('.review-score input').nth(i).fill(String([2,3,2][i]));
      await panel.getByRole('button',{name:'保存人工评分'}).click();await panel.getByText(/测试同学 · 001 · ai_pbl · 已提交 · 7\/10/).waitFor();
      await panel.getByRole('checkbox',{name:/结束本轮并恢复/}).check();await panel.getByRole('button',{name:'结束本轮回顾'}).click();
      const publish=panel.getByRole('button',{name:'发布回顾结果'});await publish.waitFor();assert.equal(await publish.isDisabled(),true);
      await panel.getByRole('checkbox',{name:/我确认两个班均已结束/}).check();await publish.click();await publish.waitFor({state:'detached'});
      assert.deepEqual(projectActions.map(a=>a.action),['open','end','publish']);
      await page.screenshot({path:path.join(require('node:os').tmpdir(),'cognisync-teacher-project-review.png'),fullPage:true});
      assert.deepEqual(errors,[]);assert.deepEqual(unknown,[]);console.log('PASS teacher project review: read does not publish; draft/open confirmation, manual grading, end, two-class confirmation and publish; isolated APIs.');return;
    }
    assert.equal(await page.getByRole('navigation', { name: '切换班级' }).getByRole('button').count(), 2);
    await page.getByRole('button', { name: '解构班', exact: true }).click();
    assert.deepEqual(await page.getByRole('combobox', { name: '班级', exact: true }).locator('option').allTextContents(), ['解构班', '开发班']);
    await page.getByRole('button', { name: '开发班', exact: true }).click();
    await page.getByText('课前设置：两组任务与知识点', { exact: true }).click();
    await page.getByRole('combobox', { name: /常规 AI 协作/ }).selectOption('ordinary');
    await page.getByRole('combobox', { name: /解构式协作/ }).selectOption('decompose');
    await page.getByLabel('本课知识点', { exact: false }).fill('条件判断\n列表');
    assert.equal(await page.getByRole('button', { name: '开始本课' }).isDisabled(), true);
    await page.getByRole('button', { name: '保存安排' }).click();
    await page.getByRole('button', { name: '安排已保存' }).waitFor();
    assert.deepEqual(writes[0].tasks, { ai_pbl: 'ordinary', pdt: 'decompose' });
    assert.deepEqual(writes[0].knowledge_points, ['条件判断', '列表']);
    await page.getByRole('button', { name: '开始本课' }).click();
    await page.getByRole('heading', { name: '分组课堂已开始' }).waitFor();
    assert.equal(await page.getByRole('combobox', { name: /常规 AI 协作/ }).isDisabled(), true);
    assert.equal(writes.filter(x => x === 'start').length, 1);
    await page.getByText('课前设置：两组任务与知识点', { exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '准备一组题' }).count(), 0);
    assert.equal(sentSets.length, 0);
    await page.getByLabel('选择作业包或资料').setInputFiles({ name: '我的作业.zip', mimeType: 'application/zip', buffer: Buffer.from('mock ZIP') });
    assert.equal(await page.getByLabel('学生需要交回作品').isChecked(), true);
    await page.locator('.lesson-materials > fieldset > .classroom-actions').getByRole('button', { name: '发布给本班', exact: true }).click();
    await page.getByText('我的作业.zip', { exact: true }).waitFor();
    await page.evaluate(() => { for (const element of document.querySelectorAll('*')) if (element.scrollTop) element.scrollTop = 0; });
    await page.screenshot({ path: path.join(require('node:os').tmpdir(), 'cognisync-classroom-simple-1280.png'), fullPage: true });
    await page.getByLabel('名称', { exact: true }).fill('独立创作');
    await page.getByLabel('任务要求', { exact: true }).fill('制作一个小游戏');
    await page.getByLabel('本课知识提示（可选）', { exact: true }).fill('列表用来记录多个坐标。');
    await page.getByLabel('用途', { exact: true }).selectOption('pre');
    assert.equal(await page.getByRole('checkbox', {name:'带上学生上次已交的代码'}).count(), 0);
    await page.locator('.lesson-materials > fieldset > details').getByRole('button', { name: '发布给本班', exact: true }).click();
    await page.getByText('独立创作', { exact: true }).waitFor();
    assert.equal(materials.length, 2);
    await page.getByText('本课学习过程 · 对话、修改与测试', { exact: true }).click();
    assert.equal(await page.getByRole('combobox', {name:'查看', exact:true}).inputValue(), 'process');
    await page.getByText(/同学甲 · 001/).click();
    await page.getByText('学生原话', { exact: true }).waitFor();
    await page.getByText('AI 提供', { exact: true }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(require('node:os').tmpdir(), 'cognisync-lesson-teacher-1280.png'), fullPage: true });
    await page.goto('http://localhost:8003/admin/assessments');
    await page.getByRole('button', {name:'使用精简背景问卷 · 12 题，按经历跳题'}).click();
    await page.getByRole('dialog').waitFor();
    assert.equal(await page.locator('.assessment-question').count(), 12);
    assert.equal(await page.getByRole('button', {name:'确认开放'}).count(), 0);
    await page.screenshot({ path: path.join(require('node:os').tmpdir(), 'cognisync-background-template-1280.png'), fullPage: true });
    await page.getByRole('button', {name:'关闭编辑'}).click();
    assert.equal(reviews.length, 0, 'opening the page must not approve any draft');
    await page.getByText('课堂短题 · 审核后两组均可选用', {exact:true}).click();
    await page.getByText(/答案：3/).waitFor();
    assert.equal(reviews.length, 0, 'reading the answer must not approve the draft');
    await page.getByRole('button', {name:'已核对，允许学生选用'}).click();
    await page.getByRole('button', {name:'停止提供新题'}).waitFor();
    await page.screenshot({path:path.join(require('node:os').tmpdir(), 'cognisync-practice-review-1280.png'), fullPage:true});
    await page.getByRole('button', {name:'停止提供新题'}).click();
    await page.getByRole('button', {name:'已核对，允许学生选用'}).waitFor();
    assert.deepEqual(reviews, [true, false]);
    assert.deepEqual(errors, []); assert.deepEqual(unknown, []);
    console.log('Teacher lesson, template draft, explicit practice approval and stop, frozen inputs, 1280 layout: PASS (mock API)');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
