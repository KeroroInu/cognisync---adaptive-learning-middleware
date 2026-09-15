// Isolated API fixtures: never reads or changes classroom accounts.
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../dist');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await context.addInitScript(() => {
      localStorage.setItem('cognisync-token', 'isolated-ui-test');
      localStorage.setItem('cognisync:classroom-task-seen:v1:ui-observer:t:pdt', '1');
    });
    const texts = ['方向键可以改变前进方向，但不能立即向相反方向掉头。', '运行时蛇头每隔一段时间前进一格，蛇尾同时少一格。', '果实出现在网格内，并且不会与当前蛇身重合。', '蛇头碰到果实后，蛇身增加一格，得分增加 10。', '蛇头撞到边界或自己的身体后，游戏会停止运行。', '点击开始后，移动、进食和碰撞等行为会被持续组合执行。'];
    let workspace = { version: 1, savedAt: new Date().toISOString(), evidence: [{ id: 'run', type: 'started', timestamp: new Date().toISOString() }], observations: texts.map((text, i) => ({ id: `c${i}`, evidenceId: 'run', evidenceText: '开始游戏', observationText: text, source: 'student', createdAt: new Date().toISOString() })), functions: [], path: { orderedCardIds: [], prerequisites: {}, relationKinds: {} }, progress: {} };
    const errors = [], unknown = [];
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await context.route('**/*', async route => {
      const pathname = new URL(route.request().url()).pathname;
      const json = data => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
      if (pathname === '/api/auth/me') return json({ user: { id: 'ui-observer', name: '测试同学', experimentGroup: 'pdt', hasCompletedOnboarding: true }, profile: null });
      if (pathname === '/api/assessments/pending') return json(null);
      if (pathname === '/api/classroom/state') return json({ session: { id: 's', title: '观察课堂', state: 'open', class_name: '解构班' }, prompt: null, lesson_entry: { task_id: 't', lesson_id: 'l', session_id: 's', title: '观察课堂', group: 'pdt' } });
      if (pathname === '/api/materials' || pathname === '/api/preparation/records') return json([]);
      if (pathname === '/api/research/active-task') return json({ id: 't', title: '贪吃蛇', code_content: '', workspace_data: workspace, is_completed: false });
      if (pathname === '/api/research/tasks/t/save-workspace') { workspace = route.request().postDataJSON().workspace_data; return json({}); }
      if (pathname.startsWith('/api/')) { unknown.push(pathname); return route.fulfill({ status: 404, body: '{}' }); }
      const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : decodeURIComponent(pathname)));
      if (!file.startsWith(root + '/')) return route.abort();
      try { return route.fulfill({ body: await fs.readFile(file), contentType: ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[path.extname(file)] || 'application/octet-stream' }); }
      catch { return route.fulfill({ status: 404, body: 'not found' }); }
    });
    await page.goto('http://localhost:8003/');
    await page.getByRole('button', { name: '进入本课：观察课堂' }).click();
    await page.locator('.observation-summary-card').waitFor();
    const close = page.getByRole('button', { name: '关闭，以后可从右上角查看' });
    if (await close.isVisible()) await close.click();
    assert.equal(await page.locator('.lesson-return').count(), 0);
    const cards = page.locator('.saved-observation-list article');
    assert.equal(await cards.count(), 6);
    const last = await cards.last().boundingBox();
    assert.ok(last.y + last.height <= 720, `sixth card below viewport: ${JSON.stringify(last)}`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(os.tmpdir(), 'cognisync-observation-1280.png') });
    await page.getByRole('button', { name: '返回准备区', exact: true }).click();
    await page.getByRole('button', { name: '进入本课：观察课堂' }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('cognisync-token')), 'isolated-ui-test');
    await page.getByRole('button', { name: '进入本课：观察课堂' }).click();
    await cards.first().waitFor();
    assert.equal(await cards.count(), 6);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await cards.last().scrollIntoViewIfNeeded();
    assert.ok(await cards.last().isVisible());
    await page.screenshot({ path: path.join(os.tmpdir(), 'cognisync-observation-mobile.png') });
    await cards.last().getByRole('button', { name: '修改观察卡' }).click();
    const draft = page.locator('.observation-composer textarea');
    assert.equal(await draft.inputValue(), texts[5]);
    await draft.fill('我按下方向键，蛇改变了方向。');
    await page.locator('.observation-composer-actions button').last().click();
    assert.equal(await cards.count(), 6, 'editing must not add another card');
    assert.ok((await cards.last().innerText()).includes('我按下方向键'));
    for (let i = 0; i < 6; i++) await cards.first().getByRole('button', { name: '删除观察卡' }).click();
    await page.getByText('保存后，你的发现会放在这里。', { exact: true }).waitFor();
    assert.deepEqual(errors, []); assert.deepEqual(unknown, []);
    console.log('PASS: six cards above desktop fold, return preserves login/cards, mobile cards reachable, edit/save/delete and empty state, no horizontal overflow or runtime errors');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
