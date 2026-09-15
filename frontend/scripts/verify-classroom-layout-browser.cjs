const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../dist');
const probe = process.env.PROBE === '1';
(async () => {
 const browser = await chromium.launch({ channel: 'chrome', headless: true });
 try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.addInitScript(() => {
    window.gameCommands = [];
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(message, ...args) {
      if (message.source?.includes('_game_bundle_source')) window.gameCommands.push({ time: performance.now(), reset: message.source.includes('if "reset" ==') });
      return post.call(this, message, ...args);
    };
  });
  const texts = ['转向后蛇改变方向', '蛇向前走一格', '食物不在蛇身上', '吃到食物得分加十', '碰墙游戏结束', '重开后得分为零'];
  const code = {
    'initial-state': "def create_initial_state():\n    return [(6,5),(5,5),(4,5)], 'right', 0",
    movement: 'def move_snake(snake, direction):\n    x, y = snake[0]\n    return [((x + 1) % 12, y)] + snake[:-1]',
  };
  let workspace = { version: 1, savedAt: new Date().toISOString(), evidence: [{ id: 'run', type: 'started', timestamp: new Date().toISOString() }], observations: texts.map((text, i) => ({ id: `c${i}`, evidenceId: 'run', evidenceText: '开始游戏', observationText: text, source: 'student', createdAt: new Date().toISOString() })), functions: texts.map((text, i) => ({ id: `f${i}`, observationId: `c${i}`, observationText: text, responsibility: text, implementation: '先读取状态，再判断条件，最后更新结果。', createdAt: new Date().toISOString() })), path: { orderedCardIds: [], prerequisites: {}, relationKinds: {}, functionMechanisms: {} }, progress: Object.fromEntries(Object.entries(code).map(([id, source]) => [`base::${id}`, { cardId: id, blueprintNodeId: id, code: source, verified: true }])) };
  let group = 'pdt';
  const errors = [], unknown = [];
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await context.route('**/*', async route => {
    const pathname = new URL(route.request().url()).pathname;
    const json = data => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
    if (pathname === '/api/auth/me') return json({ user: { id: 'ui-layout', name: '测试同学', experimentGroup: group, hasCompletedOnboarding: true }, profile: null });
    if (pathname === '/api/assessments/pending') return json(null);
    if (pathname === '/api/classroom/state') return json({ session: { id: 's', title: '课堂', state: 'open', class_name: '解构班' }, lesson_entry: { task_id: 't', lesson_id: 'l', session_id: 's', title: '课堂', group } });
    if (pathname === '/api/materials' || pathname === '/api/preparation/records') return json([]);
    if (pathname === '/api/research/active-task') return json({ id: 't', title: '贪吃蛇', language:'python', code_content: '', workspace_data: workspace, is_completed: false });
    if (pathname.endsWith('/save-workspace')) { workspace = route.request().postDataJSON().workspace_data; return json({}); }
    if (pathname.startsWith('/api/')) { unknown.push(pathname); return route.fulfill({ status: 404, body: '{}' }); }
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : decodeURIComponent(pathname)));
    if (!file.startsWith(root + '/')) return route.abort();
    try { return route.fulfill({ body: await fs.readFile(file), contentType: ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.zip': 'application/zip' })[path.extname(file)] || 'application/octet-stream' }); }
    catch { return route.fulfill({ status: 404, body: 'not found' }); }
  });
  const screenshot = async name => { await page.waitForTimeout(350); return page.screenshot({ path: path.join(os.tmpdir(), `cognisync-${name}.png`) }); };
  const fits = async selector => {
    const box = await page.locator(selector).boundingBox();
    const size = page.viewportSize();
    assert.ok(box && box.x >= -1 && box.y >= -1 && box.x + box.width <= size.width + 1 && box.y + box.height <= size.height + 1, `${selector} outside ${JSON.stringify(size)}: ${JSON.stringify(box)}`);
  };
  await page.goto('http://localhost:8003/');
  await page.locator('.login-submit').waitFor();
  if (!probe) {
    for (const size of [{ width:1280,height:720 }, { width:1366,height:768 }, { width:1024,height:600 }, { width:390,height:844 }]) {
      await page.setViewportSize(size); await fits('.login-card'); await fits('.auth-link');
      assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1));
      await screenshot(`login-${size.width}`);
    }
    await page.locator('.auth-link').click();
    await page.locator('.classroom-register-submit').waitFor();
    for (const size of [{ width:1280,height:720 }, { width:1024,height:600 }, { width:390,height:844 }]) {
      await page.setViewportSize(size); await fits('.classroom-register > section');
      await screenshot(`register-${size.width}`);
    }
    await page.locator('.classroom-register-login').click();
  }
  await page.setViewportSize({ width:1280,height:720 });
  await page.evaluate(() => { localStorage.setItem('cognisync-token','isolated-ui-test'); localStorage.setItem('cognisync:classroom-task-seen:v1:ui-layout:t:pdt','1'); });
  await page.reload();
  await page.getByRole('button', { name: '进入本课：课堂' }).click();
  await page.locator('.project-build-workspace').waitFor();
  const close = page.getByRole('button', { name: '关闭，以后可从右上角查看' });
  if (await close.isVisible()) await close.click();
  await page.locator('.cm-content').waitFor();
  await page.waitForFunction(() => window.gameCommands.length > 0);
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: /04 生成食物/ }).click();
  await page.getByRole('button', { name: '运行当前版本', exact: true }).click();
  const before = await page.evaluate(() => window.gameCommands.filter(x => x.reset).length);
  await page.locator('.cm-content').press('ControlOrMeta+End');
  await page.locator('.cm-content').pressSequentially('\n# draft', { delay:100 });
  await page.waitForTimeout(1800);
  const after = await page.evaluate(() => window.gameCommands.filter(x => x.reset).length);
  console.log({ before, after, commands: await page.evaluate(() => window.gameCommands) });
  if (probe) return;
  assert.equal(after, before, 'unverified draft edits must not reset the game');
  assert.equal(await page.getByRole('button', { name: '暂停', exact: true }).count(), 1);
  const board = await page.locator('.construction-board').boundingBox();
  const score = await page.locator('.construction-scorebar').boundingBox();
  assert.ok(Math.abs(board.width - board.height) < 1);
  assert.ok(Math.abs(board.x - score.x) < 1 && Math.abs(board.width - score.width) < 1, 'score and board align');
  await fits('.build-workspace-footer'); await fits('.module-test-bar'); await screenshot('build-1280');
  await page.getByRole('button', { name:'暂停',exact:true }).click();
  await page.getByRole('button', { name:'展开函数卡侧栏',exact:true }).click();
  await page.locator('.build-terminal > header button').first().click();
  await page.setViewportSize({ width:1024,height:600 });
  await fits('.module-test-bar'); await fits('.construction-controls'); await fits('.build-workspace-footer');
  await screenshot('build-1024');
  await page.setViewportSize({ width:1280,height:720 });
  for (const [name, rootSelector, footer] of [['拆功能','.project-function-stage','.function-stage-footer'], ['画流程','.project-mechanism-stage','.mechanism-stage-footer']]) {
    await page.locator('.project-stage-rail').getByRole('button', { name }).click();
    await page.locator(rootSelector).waitFor(); await fits(footer); await screenshot(`${name}-1280`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.setViewportSize({ width:1024,height:600 }); await fits(footer);
    if (name === '画流程') { await fits('.mechanism-confirm'); await fits('.mechanism-board-empty'); await fits('.mechanism-shape-palette'); }
    await screenshot(`${name}-1024`);
    await page.setViewportSize({ width:1280,height:720 });
  }
  group = 'ai_pbl';
  await page.evaluate(() => localStorage.setItem('cognisync:classroom-task-seen:v1:ui-layout:t:ai_pbl','1'));
  await page.reload();
  await page.getByRole('button', { name:'进入本课：课堂' }).click();
  await page.locator('.free-game-panel').waitFor();
  if (await close.isVisible()) await close.click();
  for (const size of [{ width:1280,height:720 }, { width:1024,height:600 }]) {
    await page.setViewportSize(size);
    await fits('.research-actionbar'); await fits('.construction-controls');
    const b = await page.locator('.construction-board').boundingBox();
    const s = await page.locator('.construction-scorebar').boundingBox();
    assert.ok(b.width > 100 && Math.abs(b.width - b.height) < 1 && Math.abs(b.width - s.width) < 1);
    await screenshot(`ordinary-${size.width}`);
  }
  assert.deepEqual(errors, []); assert.deepEqual(unknown, []);
  console.log('PASS: login responsive, stage actions fit viewport, board aligned, unverified typing does not reset/pause running game');
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
