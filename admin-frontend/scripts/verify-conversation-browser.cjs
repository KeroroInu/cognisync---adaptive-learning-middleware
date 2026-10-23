// Isolated browser acceptance: synthetic records only; all traffic is intercepted.
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const root = path.resolve(process.env.DIST_DIR || path.resolve(__dirname, '../dist'));
  const output = process.env.QA_DIR || '/tmp/sfls-conversation-browser-qa';
  await fs.mkdir(output, { recursive: true });
  const errors = [], unexpected = [], requests = [];
  let failList = false, failDetail = false, failMore = true, slowDetail = false;
  const identity = n => ({ user_id: `student-${n}`, user_name: `测试同学${n}`, student_id: `G2026000${n}`, school_class: '高一（1）班', class_name: '解构班' });
  const artifact = n => ({ ...identity(n), receipt_id: `receipt-${n}`, material_id: 'task-1', task_title: '第1课 · 编程体验', task_kind: 'sfls', created_at: '2026-10-22T08:00:00Z', filename: `fixture-${n}.zip`, size: 12345, sha256: 'a'.repeat(64), task_validation_status: 'matched', manual_import: false, download_url: `/api/admin/classroom/receipts/receipt-${n}/file`, version_count: 3 });
  const detail = n => ({ ...artifact(n), readme: null, code_files: [], messages: Array.from({ length: 43 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: i === 0 ? `学生${n}的原始发言 <img src=x onerror="window.fixtureXss=1">` : `学生${n}第${i + 1}条对话`, at: '2026-10-22T08:00:00Z', session_path: 'evidence/sessions/one.jsonl', line: i + 1 })), evidence: { has_events: true, has_sessions: true, code_file_count: 0, message_count: 65, displayed_message_count: 43, truncated: true, omitted_message_count: 22 }, warnings: ['在线预览已截取，原始记录保留在作品包中。'] });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, reducedMotion: 'reduce' });
    await context.addInitScript(() => localStorage.setItem('auth_token', 'fixture-only'));
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url()), p = url.pathname;
      assert.equal(url.hostname, 'fixture.local', 'never contact an external or classroom server');
      if (p.startsWith('/api/')) {
        requests.push({ path: p, search: url.search, method: req.method() });
        assert.equal(req.method(), 'GET', 'preview must not modify data');
        assert.equal(req.headers().authorization, 'Bearer fixture-only');
      }
      const reply = data => route.fulfill({ json: { success: true, data } });
      if (p === '/api/admin/auth/me') return reply({ user: { id: 'teacher', name: '验收教师', role: 'admin' } });
      if (p === '/api/admin/conversations/artifacts') {
        if (failList) { failList = false; return route.fulfill({ status: 503, json: { detail: '列表暂不可用' } }); }
        const page = Number(url.searchParams.get('page'));
        const items = url.searchParams.get('query') === '无记录' ? [] : page === 2 ? [artifact(3)] : [artifact(1), artifact(2)];
        return reply({ items, total: items.length ? 31 : 0, page, page_size: 30 });
      }
      if (p.match(/^\/api\/admin\/users\/student-\d\/artifacts\/receipt-\d$/)) {
        const n = Number(p.at(-1));
        if (n === 2 && failDetail) { failDetail = false; return route.fulfill({ status: 503, json: { detail: '预览暂不可用' } }); }
        if (n === 1 && slowDetail) await new Promise(resolve => setTimeout(resolve, 500));
        return reply(detail(n));
      }
      if (p.match(/^\/api\/admin\/classroom\/receipts\/receipt-\d\/file$/)) return route.fulfill({ contentType: 'application/zip', body: 'synthetic-archive-only' });
      if (p === '/api/admin/conversations/web') return reply({ items: [{ ...identity(1), message_count: 53, created_at: '2026-10-21T08:00:00Z', updated_at: '2026-10-22T08:00:00Z' }], total: 1, page: 1, page_size: 30 });
      if (p === '/api/admin/conversations/web/student-1/messages') {
        const offset = Number(url.searchParams.get('offset'));
        if (offset === 50 && failMore) { failMore = false; return route.fulfill({ status: 503, json: { detail: '后续对话暂不可用' } }); }
        return reply({ messages: Array.from({ length: offset ? 3 : 50 }, (_, i) => ({ id: `web-${offset + i}`, role: i % 2 ? 'assistant' : 'user', text: `网页对话${offset + i}`, timestamp: '2026-10-22T08:00:00Z' })), total: 53, limit: 50, offset });
      }
      if (p.startsWith('/api/')) { unexpected.push(p); return route.fulfill({ status: 500, json: { detail: 'Unmocked API' } }); }
      const file = path.resolve(root, '.' + (p.startsWith('/admin/assets/') ? p.slice(6) : '/index.html'));
      assert.ok(file.startsWith(root + path.sep));
      return route.fulfill({ contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html', body: await fs.readFile(file) });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://fixture.local/admin/conversations');
    const records = page.getByRole('region', { name: '对话记录列表' }), preview = page.getByRole('region', { name: '对话内容' });
    await preview.getByRole('heading', { name: '测试同学1', exact: true }).waitFor();
    await page.locator('.conversation-message').first().waitFor();
    assert.equal(await page.locator('.conversation-message').count(), 40);
    assert.equal(requests.filter(r => /\/artifacts\/receipt-/.test(r.path)).length, 1, 'only selected ZIP is previewed');
    assert.equal(await preview.locator('img').count(), 0);
    assert.equal(await page.evaluate(() => window.fixtureXss), undefined);
    assert.equal(await page.getByRole('button', { name: /删除/ }).count(), 0);
    await page.getByRole('button', { name: /再看 40 条对话/ }).click();
    assert.equal(await page.locator('.conversation-message').count(), 43);
    await preview.getByText('此处为部分预览，完整记录请下载原始作品包。', { exact: true }).waitFor();
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载原始作品包', exact: true }).click();
    assert.equal((await event).suggestedFilename(), 'fixture-1.zip');
    await page.screenshot({ path: path.join(output, 'conversation-desktop.png'), fullPage: false });
    failDetail = true;
    await records.getByRole('button', { name: /测试同学2/ }).click();
    await preview.getByRole('alert').filter({ hasText: '预览暂不可用' }).waitFor();
    await preview.getByRole('button', { name: '重试', exact: true }).click();
    await preview.getByText(/学生2的原始发言/).waitFor();
    slowDetail = true;
    await records.getByRole('button', { name: /测试同学1/ }).click();
    await records.getByRole('button', { name: /测试同学2/ }).click();
    await preview.getByText(/学生2的原始发言/).waitFor();
    await page.waitForTimeout(600);
    assert.equal(await preview.getByText(/学生1的原始发言/).count(), 0, 'late response must not replace selected student');
    slowDetail = false;
    await page.getByRole('combobox', { name: /提交版本/ }).selectOption('all');
    await preview.getByText(/学生1的原始发言/).waitFor();
    assert.ok(requests.some(r => r.path.endsWith('/conversations/artifacts') && r.search.includes('versions=all')));
    await records.getByRole('button', { name: '下一页', exact: true }).click();
    await preview.getByRole('heading', { name: '测试同学3', exact: true }).waitFor();
    await page.getByLabel('查找', { exact: true }).fill('无记录');
    await page.getByLabel('班级', { exact: true }).fill('解构班');
    await page.getByRole('button', { name: '查询', exact: true }).click();
    await records.getByText('暂无符合条件的记录。', { exact: true }).waitFor();
    assert.equal(await page.locator('.conversation-message').count(), 0);
    await page.getByLabel('查找', { exact: true }).fill('');
    await page.getByLabel('班级', { exact: true }).fill('');
    failList = true;
    await page.getByRole('button', { name: '查询', exact: true }).click();
    await records.getByRole('alert').filter({ hasText: '列表暂不可用' }).waitFor();
    await records.getByRole('button', { name: '重试', exact: true }).click();
    await preview.getByText(/学生1的原始发言/).waitFor();
    await page.getByRole('navigation', { name: '对话来源' }).getByRole('button', { name: '网页助手', exact: true }).click();
    await preview.getByText('网页对话0', { exact: true }).waitFor();
    assert.equal(await page.locator('.conversation-message').count(), 50);
    await page.getByRole('button', { name: '加载后面 50 条', exact: true }).click();
    await preview.getByRole('alert').filter({ hasText: '后续对话暂不可用' }).waitFor();
    assert.equal(await page.locator('.conversation-message').count(), 50, 'failed next page must retain earlier turns');
    await preview.getByRole('button', { name: '重试', exact: true }).click();
    await preview.getByText('网页对话52', { exact: true }).waitFor();
    assert.equal(await page.locator('.conversation-message').count(), 53);
    for (const theme of ['light', 'dark']) {
      for (const width of [375, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
        const overflowing = await page.locator('.conversation-browser').evaluateAll(nodes => nodes.flatMap(root => Array.from(root.querySelectorAll('input,select,button,pre'))).filter(node => { const r = node.getBoundingClientRect(); return r.width && (r.left < -1 || r.right > innerWidth + 1); }).map(node => node.tagName));
        assert.deepEqual(overflowing, [], `controls fit at ${width}/${theme}`);
      }
    }
    // Fresh pages avoid resize artifacts and also test direct entry.
    const mobile = await context.newPage(); await mobile.setViewportSize({ width: 375, height: 900 });
    await mobile.goto('http://fixture.local/admin/conversations');
    await mobile.locator('.conversation-message').first().waitFor();
    await mobile.screenshot({ path: path.join(output, 'conversation-mobile.png'), fullPage: false });
    const dark = await context.newPage();
    await dark.goto('http://fixture.local/admin/conversations');
    await dark.locator('.conversation-message').first().waitFor();
    await dark.getByRole('button', { name: '深色模式', exact: true }).click();
    assert.equal(await dark.locator('html').getAttribute('data-theme'), 'dark');
    await dark.screenshot({ path: path.join(output, 'conversation-dark.png'), fullPage: false });
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    console.log(JSON.stringify({ status: 'PASS', output, checks: ['selected-only ZIP preview', 'escaped text', 'no delete', 'local expansion', 'partial preview warning', 'authenticated download', 'detail/list errors and retry', 'stale requests', 'history filters', 'pagination', 'empty state', 'web message paging and retry', 'light/dark 375/768/1440', 'GET-only fixtures'] }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
