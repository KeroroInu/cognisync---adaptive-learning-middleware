const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await context.addInitScript(() => localStorage.setItem('cognisync-token', 'isolated-survey'));
    const survey = JSON.parse(await fs.readFile(path.resolve(__dirname, '../../backend/app/resources/programming_ai_survey_v1.json'), 'utf8'));
    let submitted = null, failed = false;
    const errors = [], unknown = [];
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await context.route('**/*', async route => {
      const pathname = new URL(route.request().url()).pathname;
      const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
      if (pathname === '/api/auth/me') return json({ success: true, data: { user: { id: 'survey-user', name: '试填同学', experimentGroup: 'ai_pbl', hasCompletedOnboarding: true }, profile: null } });
      if (pathname === '/api/project-review/current') return json({success:true,data:null});
      if (pathname === '/api/assessments/pending') return json({ success: true, data: submitted ? null : { id: 'survey', phase: 'pre', revision: 1, questions: survey.questions, served_at: new Date().toISOString() } });
      if (pathname === '/api/assessments/survey/responses') {
        if (!failed) { failed = true; return json({ detail: '模拟网络中断，请重试' }, 503); }
        submitted = route.request().postDataJSON(); return json({ success: true, data: { id: 'receipt' } });
      }
      if (pathname === '/api/classroom/state') return json({ success: true, data: { session: null, prompt: null, lesson_entry: null } });
      if (pathname === '/api/preparation/records' || pathname === '/api/materials') return json({ success: true, data: [] });
      if (pathname.startsWith('/api/')) { unknown.push(pathname); return json({}, 404); }
      const file = path.resolve(__dirname, '../dist', '.' + (pathname === '/' ? '/index.html' : pathname));
      const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' };
      return route.fulfill({ body: await fs.readFile(file), contentType: mime[path.extname(file)] || 'application/octet-stream' });
    });
    const next = () => page.getByRole('button', { name: '下一题', exact: true }).click();
    await page.goto('http://localhost:8003/');
    await page.getByLabel('Python', { exact: true }).check();
    await page.getByLabel('没有接触过', { exact: true }).check();
    assert.equal(await page.getByLabel('Python', { exact: true }).isChecked(), false);
    await next(); await page.getByLabel('还没有学过 Python', { exact: true }).check();
    await next(); await page.getByLabel('还没有动手做过', { exact: true }).check();
    await next(); await page.getByLabel('从未用过', { exact: true }).check();
    await next();
    assert.match(await page.locator('h1').innerText(), /最希望得到/);
    await page.getByLabel('有简短注释、方便读懂的代码', { exact: true }).check();
    await page.getByLabel('只需补写关键部分的代码模板', { exact: true }).check();
    await page.getByLabel('可以运行的示例', { exact: true }).check();
    assert.equal(await page.getByLabel('讲清任务要求', { exact: true }).isDisabled(), true);
    await page.reload(); await page.getByLabel('没有接触过', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('没有接触过', { exact: true }).isChecked(), true);
    for (let i = 0; i < 4; i++) await next();
    assert.equal(await page.getByLabel('有简短注释、方便读懂的代码', { exact: true }).isChecked(), true);
    await page.screenshot({ path: path.join(require('node:os').tmpdir(), 'cognisync-survey-1280.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(require('node:os').tmpdir(), 'cognisync-survey-mobile.png'), fullPage: true });
    await next(); await page.getByLabel('还没用过这些工具', { exact: true }).check();
    await next(); await page.getByRole('button', { name: '提交回答', exact: true }).click();
    await page.getByText('模拟网络中断，请重试', { exact: true }).waitFor();
    await page.getByRole('button', { name: '提交回答', exact: true }).click();
    await page.getByText('准备区', { exact: true }).waitFor();
    assert.deepEqual(Object.keys(submitted.answers), ['q1', 'q2', 'q3', 'q8', 'q17', 'q18', 'q19']);
    assert.equal(submitted.answers.q19, null);
    assert.equal(submitted.answers.q17.length, 3);
    assert.deepEqual(errors, []); assert.deepEqual(unknown, []);
    console.log('PASS: survey skip logic, exclusive choices, max selection, refresh, retry, blank answer, entry, 1280/390 layout (mock API)');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
