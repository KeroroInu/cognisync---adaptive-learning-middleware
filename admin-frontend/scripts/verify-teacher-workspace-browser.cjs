// Synthetic browser fixtures only: no classroom server or real credentials.
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const root = path.resolve(process.env.DIST_DIR || path.resolve(__dirname, '../dist'));
  const output = process.env.QA_DIR || '/tmp/sfls-teacher-workspace-qa';
  const baseline = process.env.WORKSPACE_BASELINE === '1';
  await fs.mkdir(output, { recursive: true });
  const sessions = ['解构班', '开发班'].map((class_name, index) => ({ id: `fixture-${index}`, class_name, title: '当前发布', state: 'open', is_current: true, created_at: '2026-10-22T00:00:00Z' }));
  const summary = { eligible_user_count: 40, download_user_count: 38, submission_user_count: 32, pending_user_count: 8, statistics_started_at: null };
  const material = (id, visible, title, lesson) => ({ id, title, kind: 'sfls', student_visible: visible, closed_at: visible ? null : '2026-10-21T00:00:00Z', download_count: visible ? 38 : 0, submission_count: visible ? 32 : 0, participation: summary, configuration: { task: '明确自己的方案，完成程序并测试，交回任务包。', inherit_previous: lesson > 1, library: { version: '2026-10-22.1', lesson_number: lesson, slides_path: '/slides/fixture.html' } } });
  const files = ['windows', 'mac'].map((platform, index) => ({ platform, file: `SFLS-0.1.12-offline-${platform}.zip`, bytes: (index ? 241 : 107) * 1024 * 1024, sha256: 'a'.repeat(64) }));
  const role = { provider: 'mock', model: '', base_url: '', has_api_key: false };
  const errors = [], unexpected = [], requests = [];
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    await context.addInitScript(() => localStorage.setItem('auth_token', 'fixture-only'));
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url()), p = url.pathname;
      assert.equal(url.hostname, 'fixture.local', 'never contact a live server');
      requests.push(p);
      const reply = data => route.fulfill({ json: { success: true, data } });
      if (p === '/api/admin/auth/me') return reply({ user: { id: 'fixture-teacher', name: '老师', role: 'admin' } });
      if (p === '/api/admin/classroom/workspace') {
        assert.equal(req.method(), 'POST');
        return reply(sessions.find(item => item.class_name === req.postDataJSON().class_name));
      }
      assert.equal(req.method(), 'GET', `unexpected write: ${p}`);
      if (p === '/api/admin/classroom/sessions') return reply(sessions);
      if (p === '/api/admin/classroom/notices/sent') return reply([]);
      if (p.endsWith('/polls')) return reply({ total: 0, items: [] });
      if (p.match(/^\/api\/admin\/classroom\/sessions\/fixture-[01]\/materials$/)) return reply([material('active', true, '第2课 · 设计与构建基础贪吃蛇', 2), material('next', false, '第3课 · 让蛇自主寻找食物', 3)]);
      if (p === '/api/admin/config/llm') return reply({ chat: role, analysis: role });
      if (p === '/downloads/sfls/installers.json') return route.fulfill({ json: { files } });
      if (p.match(/^\/downloads\/sfls\/SFLS-.*\.zip$/)) return route.fulfill({ contentType: 'application/zip', headers: { 'Content-Disposition': `attachment; filename="${p.split('/').at(-1)}"` }, body: Buffer.from('synthetic-installer') });
      if (p.startsWith('/api/')) { unexpected.push(p); return route.fulfill({ status: 500, json: { detail: 'Unexpected fixture API' } }); }
      const file = path.resolve(root, '.' + (p.startsWith('/admin/assets/') ? p.slice('/admin'.length) : '/index.html'));
      assert.ok(file.startsWith(root + path.sep));
      return route.fulfill({ contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html', body: await fs.readFile(file) });
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://fixture.local/admin/classroom');
    await page.getByRole('heading', { name: '第2课 · 设计与构建基础贪吃蛇', exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'classroom-desktop.png'), fullPage: true });
    if (baseline) { console.log(JSON.stringify({ status: 'BASELINE', output })); return; }
    assert.equal(requests.includes('/downloads/sfls/installers.json'), false, 'classroom should not load installers');
    await page.getByRole('button', { name: '开发班', exact: true }).click();
    await page.getByRole('heading', { name: '第2课 · 设计与构建基础贪吃蛇', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '开发班', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: '发给学生', exact: true }).click();
    await page.getByRole('textbox', { name: '发送内容', exact: true }).fill('合成课堂通知，不发送');
    await page.getByRole('button', { name: '收起', exact: true }).click();
    await page.getByRole('button', { name: '发起投票', exact: true }).click();
    await page.getByRole('textbox', { name: '投票主题', exact: true }).fill('先尝试哪一种方案？');
    await page.getByRole('button', { name: '收起', exact: true }).click();
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
      for (const width of [375, 768, 1280, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        assert.equal(await page.locator('.teacher-content').evaluate(el => el.scrollWidth > el.clientWidth + 1), false, `${theme}/${width}: no content overflow`);
        const overflow = await page.locator('.classroom-admin').evaluate(el => [...el.querySelectorAll('button,a,h1,h2,h3')].filter(node => { const r = node.getBoundingClientRect(); return r.width && (r.left < -1 || r.right > innerWidth + 1); }).map(node => node.textContent));
        assert.deepEqual(overflow, [], `${theme}/${width}: controls stay inside viewport`);
        if (width === 375 || width === 1440) await page.screenshot({ path: path.join(output, `classroom-${theme}-${width}.png`), fullPage: true });
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => document.documentElement.dataset.theme = 'light');
    await page.getByRole('link', { name: '工具与设置', exact: true }).first().click();
    const toggle = page.getByRole('button', { name: '学生平台 AI 助手 配置 API key', exact: true });
    await toggle.waitFor();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    await page.getByRole('link', { name: /Windows 下载/ }).waitFor();
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('link', { name: /Windows 下载/ }).click();
    assert.equal((await downloadEvent).suggestedFilename(), files[0].file);
    await toggle.click();
    const key = page.getByLabel('API key', { exact: true });
    await key.waitFor();
    assert.equal(await key.getAttribute('type'), 'password');
    await key.fill('synthetic-test-value');
    await page.getByRole('button', { name: '学生平台 AI 助手 收起', exact: true }).click();
    await toggle.click();
    assert.equal(await key.inputValue(), '', 'closing clears the unsubmitted key');
    await page.getByRole('button', { name: '学生平台 AI 助手 收起', exact: true }).click();
    await page.reload(); // Test direct /admin/tools entry and its independently loaded CSS.
    await page.getByRole('link', { name: /Windows 下载/ }).waitFor();
    assert.equal(await page.locator('.teacher-tools-layout').evaluate(el => getComputedStyle(el).display), 'grid');
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
      for (const width of [375, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        assert.equal(await page.locator('.teacher-content').evaluate(el => el.scrollWidth > el.clientWidth + 1), false, `${theme}/${width}: tools fit`);
        assert.equal(await page.locator('.teacher-topbar').count(), 1, 'tools page mounts only one workspace');
        const sizes = await page.locator('.teacher-workspace').evaluate(el => ({ workspaceHeight: el.getBoundingClientRect().height, viewportHeight: innerHeight }));
        assert.ok(Math.abs(sizes.workspaceHeight - sizes.viewportHeight) < 1);
        await page.screenshot({ path: path.join(output, `tools-${theme}-${width}.png`) });
      }
    }
    await page.getByRole('link', { name: '返回课堂', exact: true }).click();
    await page.getByRole('heading', { name: '课堂工作台', exact: true }).waitFor();
    await page.getByLabel('工作台设置').click();
    await page.locator('.teacher-settings').getByRole('link', { name: '工具与设置', exact: true }).click();
    await toggle.waitFor();
    // Also inspect a fresh direct-entry page, independently of resize/navigation history.
    const direct = await context.newPage();
    await direct.setViewportSize({ width: 1440, height: 1000 });
    await direct.goto('http://fixture.local/admin/tools');
    await direct.getByRole('link', { name: /Windows 下载/ }).waitFor();
    await direct.screenshot({ path: path.join(output, 'tools-direct-entry.png'), animations: 'disabled' });
    await direct.close();
    assert.deepEqual(errors, []);
    assert.deepEqual(unexpected, []);
    const result = { status: 'PASS', output, realServerWrites: 0, browserRuntimeErrors: errors, unexpectedApi: unexpected, viewports: [375, 768, 1280, 1440], themes: ['light', 'dark'] };
    await fs.writeFile(path.join(output, 'teacher-workspace-result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
