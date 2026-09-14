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
    page.on('pageerror', e => errors.push(e.message));
    const tasks = [{ id: 'ordinary', title: '贪吃蛇：常规协作', target_group: 'ai_pbl' }, { id: 'decompose', title: '贪吃蛇：解构协作', target_group: 'pdt' }];
    let plan = null; const materials = [];
    await context.route('**/*', async route => {
      const pathname = new URL(route.request().url()).pathname;
      const json = data => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
      if (pathname === '/api/admin/auth/me') return json({ user: { id: 'teacher', name: '测试教师', role: 'admin' }, profile: null });
      if (pathname === '/api/admin/classroom/sessions') return json([{ id: 's', class_name: '隔离班', title: '条件与列表', state: 'open', closes_at: null, created_at: new Date().toISOString(), is_current: true, prompt: null, response_count: 0 }]);
      if (pathname.endsWith('/lesson-tasks')) return json(tasks);
      if (pathname.endsWith('/sessions/s/materials')) return json(materials);
      if (pathname.endsWith('/sessions/s/packages')) { const body = route.request().postDataJSON(); materials.push({ id: body.request_id, title: body.title, kind: 'pi', closed_at: null, configuration: body }); return json(materials.at(-1)); }
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
    await page.getByRole('heading', { name: '本课安排' }).waitFor();
    await page.getByRole('combobox', { name: /常规 AI 协作/ }).selectOption('ordinary');
    await page.getByRole('combobox', { name: /解构式协作/ }).selectOption('decompose');
    await page.getByLabel('本课知识点', { exact: false }).fill('条件判断\n列表');
    assert.equal(await page.getByRole('button', { name: '开始本课' }).isDisabled(), true);
    await page.getByRole('button', { name: '保存安排' }).click();
    await page.getByRole('button', { name: '安排已保存' }).waitFor();
    assert.deepEqual(writes[0].tasks, { ai_pbl: 'ordinary', pdt: 'decompose' });
    assert.deepEqual(writes[0].knowledge_points, ['条件判断', '列表']);
    await page.getByRole('button', { name: '开始本课' }).click();
    await page.getByText('已启动，任务和知识目标已冻结。', { exact: true }).waitFor();
    assert.equal(await page.getByRole('combobox', { name: /常规 AI 协作/ }).isDisabled(), true);
    assert.equal(writes.filter(x => x === 'start').length, 1);
    await page.getByText('资料与本地任务包', { exact: true }).click();
    await page.getByText('制作 Mac / Windows 任务包', { exact: true }).click();
    await page.getByLabel('名称', { exact: true }).fill('独立创作');
    await page.getByLabel('任务要求', { exact: true }).fill('制作一个小游戏');
    await page.getByLabel('给 Pi 的支持要求', { exact: true }).fill('只用简短注释');
    await page.getByRole('button', { name: '发布任务包', exact: true }).click();
    await page.getByText('独立创作', { exact: true }).waitFor();
    assert.equal(materials.length, 1);
    await page.getByText('资料与本地任务包', { exact: true }).click();
    await page.getByText('本课证据 · 对话与知识点', { exact: true }).click();
    await page.getByText(/同学甲 · 001/).click();
    await page.getByText('学生原话', { exact: true }).waitFor();
    await page.getByText('AI 提供', { exact: true }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(require('node:os').tmpdir(), 'cognisync-lesson-teacher-1280.png'), fullPage: true });
    assert.deepEqual(errors, []); assert.deepEqual(unknown, []);
    console.log('Teacher lesson configuration, explicit start, frozen inputs, 1280 layout: PASS (mock API)');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
