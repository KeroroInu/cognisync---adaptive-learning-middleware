// Entirely isolated fixture QA. All API requests are intercepted; no student data is changed.
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'sfls-artifact-ui-'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [], requests = [];
  const base = process.env.QA_BASE_URL || 'http://127.0.0.1:5178';
  const summary = id => ({ receipt_id: id, material_id: 'task-1', task_title: '第1课 · AI会写代码以后', task_kind: 'sfls', created_at: id === 'r1' ? '2026-10-22T08:00:00Z' : '2026-10-22T07:50:00Z', filename: 'G20260001_测试同学.zip', size: 22222, sha256: 'fixture-hash', task_validation_status: 'matched', manual_import: false, download_url: `/api/admin/classroom/receipts/${id}/file` });
  const detail = id => ({ ...summary(id), readme: { path: 'project/README.md', text: '# 我的作品\n想解决的问题或实现的效果\n需要哪些功能？怎样算完成？', truncated: false, is_template: true }, code_files: [{ path: 'project/snake.py', text: id === 'r1' ? '# 当前版本\nprint("<script>not executed</script>")\n' + '# 很长的行'.repeat(80) : '# 历史版本\nprint("old")', truncated: false }, { path: 'project/config.py', text: 'FPS = 12', truncated: false }], messages: Array.from({ length: 43 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: i % 2 ? `第${i}条 SFLS 回答\n下一行` : `第${i}条 学生思路`, at: null, session_path: 'evidence/sessions/one.jsonl', line: i + 1 })), evidence: { has_events: true, has_sessions: true, code_file_count: 2, message_count: 43, displayed_message_count: 43, truncated: false }, warnings: [] });
  let failDetail = true;
  let slowOldVersion = false;
  let graphResolved = false;
  let artifactsBeforeLegacyGraph = false;
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    await ctx.addInitScript(() => localStorage.setItem('auth_token', 'fixture-teacher'));
    await ctx.route('**/api/**', async route => {
      const req = route.request(), url = new URL(req.url());
      requests.push({ path: url.pathname, method: req.method(), auth: req.headers().authorization });
      const reply = data => route.fulfill({ json: { success: true, data } });
      if (url.pathname === '/api/admin/auth/me') return reply({ user: { id: 'teacher', name: '验收教师', role: 'admin' }, profile: null });
      if (url.pathname.match(/\/receipts\/[^/]+\/file$/)) return route.fulfill({ contentType: 'application/zip', headers: { 'content-disposition': 'attachment; filename="fixture.zip"' }, body: 'synthetic-zip-bytes' });
      if (url.pathname.match(/\/artifacts\/r[123]$/)) {
        const id = url.pathname.split('/').pop();
        if (id === 'r3' && failDetail) { failDetail = false; return route.fulfill({ status: 503, json: { detail: '作品预览暂时繁忙' } }); }
        if (id === 'r2' && slowOldVersion) await new Promise(resolve => setTimeout(resolve, 350));
        return reply(detail(id));
      }
      if (url.pathname.endsWith('/artifacts')) {
        if (!graphResolved) artifactsBeforeLegacyGraph = true;
        return reply({ items: url.pathname.includes('student-b') ? [] : ['r1', 'r2', 'r3'].map(summary), total: url.pathname.includes('student-b') ? 0 : 3, page: 1, page_size: 20 });
      }
      if (url.pathname.endsWith('/messages')) return reply({ messages: [], total: 0 });
      if (url.pathname.endsWith('/profiles')) return reply({ profiles: [], total: 0 });
      if (url.pathname.endsWith('/scale-responses')) return reply({ responses: [], total: 0 });
      if (url.pathname.endsWith('/calibration-logs')) return reply({ logs: [], total: 0 });
      if (url.pathname.endsWith('/graph')) { await new Promise(resolve => setTimeout(resolve, 400)); graphResolved = true; return reply({ nodes: [], edges: [] }); }
      if (url.pathname.endsWith('/teacher-notes')) return reply({ notes: [], has_more: false });
      if (url.pathname.endsWith('/teacher-note-evidence')) return reply({ events: [] });
      if (url.pathname.match(/\/users\/student-[ab]$/)) return reply({ id: url.pathname.split('/').pop(), name: '测试同学', student_id: 'G20260001', role: 'learner', is_active: true, class_name: '解构班', experiment_group: 'pdt', created_at: '2026-10-22T00:00:00Z', messages_count: 0, sessions_count: 0, responses_count: 0 });
      throw new Error(`Unmocked API: ${req.method()} ${url.pathname}`);
    });
    const p = await ctx.newPage(); p.setDefaultTimeout(10000); p.on('pageerror', error => errors.push(error.message));
    await p.goto(`${base}/users/student-a`);
    await p.getByRole('heading', { name: '已交作品与 SFLS 对话' }).waitFor();
    await p.getByText('# 当前版本', { exact: false }).waitFor();
    assert.equal(await p.getByRole('tab', { name: '作品与 SFLS 对话', exact: true }).getAttribute('aria-selected'), 'true');
    assert.equal(await p.getByRole('tab', { name: '画像变化', exact: true }).count(), 0);
    assert.equal(await p.getByText('保存点评', { exact: true }).count(), 0);
    assert.equal(await p.locator('.student-artifact-source script').count(), 0);
    await p.getByLabel('代码文件').selectOption('1');
    await p.getByText('FPS = 12', { exact: true }).waitFor();
    await p.getByRole('tab', { name: 'SFLS 对话', exact: true }).click();
    assert.equal(await p.locator('.student-artifact-message').count(), 40);
    assert.equal(await p.locator('.student-artifact-message.is-user').count(), 20);
    await p.getByRole('button', { name: '继续看后面的对话', exact: false }).click();
    assert.equal(await p.locator('.student-artifact-message').count(), 43);
    await p.getByRole('tab', { name: 'README 回顾', exact: true }).click();
    await p.getByText('README 看起来仍是初始模板', { exact: false }).waitFor();
    const download = p.waitForEvent('download');
    await p.getByRole('button', { name: '下载完整作品包', exact: true }).click();
    assert.equal((await download).suggestedFilename(), 'G20260001_测试同学.zip');
    await p.getByLabel('课次与提交版本').selectOption('r3');
    await p.getByText('作品预览暂时繁忙', { exact: true }).waitFor();
    await p.getByRole('button', { name: '重试', exact: true }).click();
    await p.getByText('# 历史版本', { exact: false }).waitFor();
    slowOldVersion = true;
    await p.getByLabel('课次与提交版本').selectOption('r2');
    await p.getByLabel('课次与提交版本').selectOption('r1');
    await p.getByText('# 当前版本', { exact: false }).waitFor();
    await p.waitForTimeout(500);
    assert.equal(await p.locator('.student-artifact-source').textContent().then(text => text.includes('# 当前版本')), true);
    for (const width of [1440, 1024, 768, 390]) {
      await p.setViewportSize({ width, height: 1000 });
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `page overflow at ${width}`);
    }
    await p.getByRole('button', { name: '深色模式', exact: true }).click();
    await p.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await p.screenshot({ path: path.join(output, 'mobile-dark.png') });
    await p.setViewportSize({ width: 1440, height: 1000 });
    await p.getByRole('button', { name: '浅色模式', exact: true }).click();
    await p.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await p.screenshot({ path: path.join(output, 'desktop.png') });
    await p.evaluate(() => { history.pushState({}, '', '/users/student-b'); window.dispatchEvent(new PopStateEvent('popstate')); });
    await p.getByText('这个学生还没有已接收的作品包。', { exact: true }).waitFor();
    assert.equal(await p.locator('.student-artifact-source').count(), 0);
    assert.deepEqual(errors, []);
    assert.equal(artifactsBeforeLegacyGraph, true, 'offline artifacts must not wait for the legacy graph');
    assert.ok(requests.every(request => request.method === 'GET'));
    assert.ok(requests.filter(request => request.path.includes('/receipts/')).every(request => request.auth === 'Bearer fixture-teacher'));
    console.log(JSON.stringify({ status: 'PASS', output, checks: ['actual submissions default', 'empty legacy tabs hidden', 'code selection', 'HTML escaped', 'student/AI styles', '40-message pagination', 'template README warning', 'authenticated ZIP download', 'error retry', 'stale preview cancellation', 'student route isolation', 'four viewport widths', 'light/dark', 'GET-only synthetic fixture'] }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
