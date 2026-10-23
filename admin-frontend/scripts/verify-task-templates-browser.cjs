// All network routes are fulfilled locally: no publication reaches a teaching server.
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const source = JSON.parse(await fs.readFile(path.resolve(__dirname, '../../backend/app/resources/worksheet_templates.json'), 'utf8'));
  const templates = source.lessons.flatMap(lesson => Object.entries(lesson.conditions).map(([condition, prompts]) => ({
    lesson_id: lesson.lesson_id, template_version: source.template_version,
    condition: condition === 'deconstruction' ? 'pdt' : 'ai_pbl', title: lesson.title, objective: lesson.goal,
    rules: [], acceptance: lesson.acceptance, analysis_prompt: prompts.analysis_prompt, change_prompt: prompts.plan_prompt,
    test_hint: lesson.common_test_hint, teacher_review: lesson.teacher_review[condition], common_exit: lesson.common_exit,
  })));
  const sessions = ['解构班', '开发班'].map((class_name, index) => ({ id: `s${index}`, class_name, title: class_name,
    state: 'open', is_current: true, created_at: '2026-10-14T00:00:00Z', closes_at: null, prompt: null, response_count: 0 }));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [], unexpected = [], publications = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(() => localStorage.setItem('auth_token', 'fixture-only'));
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url()), p = url.pathname;
      const reply = data => route.fulfill({ json: { success: true, data } });
      if (p === '/api/admin/auth/me') return reply({ user: { id: 'teacher', name: '测试教师', role: 'admin' } });
      if (p === '/api/admin/classroom/workspace') return reply(sessions.find(s => s.class_name === req.postDataJSON().class_name));
      if (p === '/api/admin/classroom/sessions') return reply(sessions);
      if (p === '/api/admin/classroom/worksheet-templates') return reply(templates);
      if (p === '/api/admin/classroom/notices') return reply(null);
      if (/\/sessions\/s[01]\/polls$/.test(p)) return reply({ total: 0, items: [] });
      if (/\/sessions\/s[01]\/materials$/.test(p)) return reply([]);
      if (/\/sessions\/s[01]\/packages$/.test(p)) {
        const body = req.postDataJSON(); publications.push({ session: p.split('/')[5], ...body });
        return reply({ id: body.request_id });
      }
      if (p.startsWith('/api/')) { unexpected.push(`${req.method()} ${p}`); return route.fulfill({ status: 500, json: { detail: 'Unexpected fixture API' } }); }
      const root = process.env.ADMIN_BUILD_DIR || path.resolve(__dirname, '../dist');
      const relative = p.startsWith('/admin/assets/') ? p.slice('/admin'.length) : '/index.html';
      const file = path.resolve(root, '.' + relative);
      assert.ok(file.startsWith(root + path.sep));
      return route.fulfill({ contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html', body: await fs.readFile(file) });
    });
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://localhost:8003/admin/classroom');
    for (const [className, condition] of [['解构班', 'pdt'], ['开发班', 'ai_pbl']]) {
      await page.getByRole('button', { name: className, exact: true }).click();
      await page.getByRole('button', { name: '＋ 布置任务', exact: true }).click();
      const panel = page.getByRole('region', { name: '作业与资料', exact: true });
      for (const lessonId of ['C01', 'C02']) {
        const template = templates.find(t => t.condition === condition && t.lesson_id === lessonId);
        await panel.locator('[aria-label="课次模板"] select').selectOption(lessonId);
        assert.equal(await panel.getByLabel('名称', { exact: true }).inputValue(), `第 ${Number(lessonId.slice(1))} 课 · ${template.title}`);
        assert.equal(await panel.getByLabel('带上学生上次已交的代码').isChecked(), lessonId !== 'C01');
        const task = await panel.getByLabel(/^任务要求/).inputValue();
        assert.ok(task.includes(template.analysis_prompt) && task.includes(template.change_prompt));
        assert.ok(template.acceptance.every(line => task.includes(line)));
        await panel.getByRole('button', { name: '发布给本班', exact: true }).filter({ visible: true }).click();
        await page.waitForFunction(() => document.querySelector('.lesson-publish-row input')?.value === '');
        const saved = publications.at(-1);
        assert.equal(saved.worksheet.condition, condition);
        assert.equal(saved.worksheet.lesson_id, lessonId);
        assert.equal(saved.inherit_previous, lessonId !== 'C01');
        assert.equal(saved.session, className === '解构班' ? 's0' : 's1');
        assert.equal(saved.task, task);
      }
      // Same-template edits must reach the task prose actually delivered to students.
      await panel.locator('[aria-label="课次模板"] select').selectOption('C02');
      await panel.getByLabel('带上学生上次已交的代码').uncheck();
      await panel.getByText(/预览与调整 · 模板/).click();
      const updated = `${className}修改后的第一条提示`;
      await panel.getByLabel(/^第一条分析提示/).fill(updated);
      assert.ok((await panel.getByLabel(/^任务要求/).inputValue()).includes(updated), 'template edits must update delivered task prose');
      await panel.getByLabel(/^共同验收/).fill('验收一\n验收二');
      const revisedTask = await panel.getByLabel(/^任务要求/).inputValue();
      assert.ok(revisedTask.includes('- 验收一') && revisedTask.includes('- 验收二'));
      assert.equal(await panel.getByLabel('带上学生上次已交的代码').isChecked(), false, 'editing prompts must preserve explicit inheritance choice');
      await panel.getByRole('button', { name: '发布给本班', exact: true }).filter({ visible: true }).click();
      await page.waitForFunction(() => document.querySelector('.lesson-publish-row input')?.value === '');
      assert.equal(publications.at(-1).task, revisedTask);
      assert.equal(publications.at(-1).worksheet.analysis_prompt, updated);
      assert.deepEqual(publications.at(-1).worksheet.acceptance, ['验收一', '验收二']);
      assert.equal(publications.at(-1).inherit_previous, false);
    }
    assert.equal(publications.length, 6);
    assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'PASS', publications: publications.length, checks: ['class-specific prompts', 'shared acceptance', 'C01 fresh/C02 inherit', 'edited-template synchronization'], actualServerWrites: 0 }));
    await context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
