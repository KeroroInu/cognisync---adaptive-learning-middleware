// Isolated API fixtures: never publishes a draft or submits a real student's answer.
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');

(async () => {
  const catalog = JSON.parse(await fs.readFile(path.resolve(__dirname, '../../backend/app/resources/instrument_drafts_20261012.json'), 'utf8'));
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'instrument-qa-'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [], writes = [];
  try {
    const teacher = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await teacher.addInitScript(() => localStorage.setItem('auth_token', 'isolated-test'));
    await teacher.route('**/api/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (route.request().method() !== 'GET') writes.push(pathname);
      const data = pathname.endsWith('/auth/me') ? { user: { id: 'teacher', name: '验收教师', role: 'admin' }, profile: null }
        : pathname === '/api/admin/assessments' ? catalog.instruments.map(i => ({ ...i.draft, id: i.key, enabled: false, published_at: null, revision: 1, response_count: 0 })) : [];
      await route.fulfill({ json: { success: true, data } });
    });
    const tp = await teacher.newPage(); tp.on('pageerror', e => errors.push(e.message));
    await tp.goto('http://localhost:8003/admin/assessments');
    await tp.getByRole('heading', { name: '问卷与试题', exact: true }).waitFor();
    assert.equal(await tp.getByText('未开放草稿', { exact: true }).count(), 7);
    await tp.screenshot({ path: path.join(output, 'teacher.png'), fullPage: true });
    const card = tp.locator('article').filter({ hasText: '编程知识与程序理解 · A卷' });
    await card.getByRole('button', { name: '试填预览', exact: true }).click();
    assert.equal(await tp.locator('pre code').innerText(), 'n = input()\nprint(int(n) + 1)');
    assert.equal(await tp.locator('input[type=radio]').first().evaluate(el => el.getBoundingClientRect().width <= 22), true);
    await tp.screenshot({ path: path.join(output, 'teacher-preview.png') });
    await tp.getByRole('button', { name: '关闭预览', exact: true }).click();
    assert.deepEqual(writes, []);
    await teacher.close();

    const student = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await student.addInitScript(() => localStorage.setItem('cognisync-token', 'isolated-survey'));
    let instrument = catalog.instruments.find(i => i.key === 'background');
    let submitted = null;
    await student.route('**/api/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      let data = [];
      if (pathname === '/api/auth/me') data = { user: { id: 'instrument-test', name: '验收同学', experimentGroup: 'ai_pbl', hasCompletedOnboarding: true }, profile: null };
      else if (pathname === '/api/project-review/current') data = null;
      else if (pathname === '/api/assessments/pending') data = submitted ? null : { id: instrument.key, phase: instrument.draft.phase, revision: 1, questions: instrument.draft.questions, served_at: new Date().toISOString() };
      else if (pathname === '/api/assessments/status') data = submitted ? null : { id: instrument.key, revision: 1 };
      else if (pathname.endsWith('/responses')) { submitted = route.request().postDataJSON(); data = { id: 'fixture-receipt' }; }
      else if (pathname === '/api/classroom/state') data = { session: null, prompt: null, lesson_entry: null };
      await route.fulfill({ json: { success: true, data } });
    });
    const sp = await student.newPage(); sp.on('pageerror', e => errors.push(e.message));
    await sp.goto('http://localhost:8003/');
    const next = () => sp.getByRole('button', { name: '下一题', exact: true }).click();
    await sp.getByRole('heading', { name: '你接触或学习过哪些编程语言或工具？（多选）' }).waitFor();
    assert.equal(await sp.locator('.floating-companion').count(), 0);
    await sp.getByLabel('其他', { exact: true }).check();
    await sp.getByRole('textbox', { name: '第1题补充：其他', exact: true }).fill('补充工具');
    await sp.getByLabel('没有接触过', { exact: true }).check();
    assert.equal(await sp.getByRole('textbox', { name: '第1题补充：其他', exact: true }).count(), 0);
    await next(); await next();
    await sp.getByLabel('没有动手做过编程任务', { exact: true }).check();
    await next();
    await sp.getByRole('heading', { name: '你使用AI工具的情况最接近哪一种？' }).waitFor();
    await sp.getByLabel('从未使用过', { exact: true }).check(); await next();
    await sp.getByRole('heading', { name: '最近一次编程任务中，你怎样检查程序是否达到要求？（多选）' }).waitFor();
    await sp.getByLabel('看能否运行', { exact: true }).check();
    await sp.getByLabel('没有检查', { exact: true }).check();
    assert.equal(await sp.getByLabel('看能否运行', { exact: true }).isChecked(), false);
    await next(); await next();
    await sp.getByLabel('看懂任务要求', { exact: true }).check();
    await sp.getByLabel('暂未遇到明显困难', { exact: true }).check();
    assert.equal(await sp.getByLabel('看懂任务要求', { exact: true }).isChecked(), false);
    await sp.setViewportSize({ width: 390, height: 844 });
    assert.equal(await sp.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await sp.screenshot({ path: path.join(output, 'student-mobile.png'), fullPage: true });
    await sp.reload(); await next(); await next(); await next();
    await sp.getByLabel('以前用过，但最近一个月没有使用', { exact: true }).check();
    await next(); await next();
    await sp.getByLabel('不记得名称', { exact: true }).check();
    assert.equal(await sp.getByRole('textbox', { name: '你的回答', exact: true }).isDisabled(), true);
    await next(); await sp.getByLabel('不确定', { exact: true }).check(); await next();
    await sp.getByRole('heading', { name: '最近一次编程任务中，你怎样检查程序是否达到要求？（多选）' }).waitFor();
    for (let n = 14; n < 19; n++) await next();
    await sp.getByRole('button', { name: '提交回答', exact: true }).click();
    await sp.waitForFunction(() => !document.querySelector('.question-dialog'));
    assert.equal(submitted.answers.q10, '__skip__');
    assert.equal(submitted.answers.q1_other, undefined);
    assert.equal(submitted.answers.q12, undefined);
    assert.deepEqual(submitted.answers.q14, ['7']);
    assert.deepEqual(submitted.answers.q16, ['9']);
    instrument = catalog.instruments.find(i => i.key === 'knowledge_a'); submitted = null;
    await sp.setViewportSize({ width: 1280, height: 800 }); await sp.reload();
    await sp.locator('.question-code').waitFor();
    assert.equal(await sp.locator('.question-code').innerText(), 'n = input()\nprint(int(n) + 1)');
    await sp.screenshot({ path: path.join(output, 'student-code.png') });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'PASS', scope: 'Chrome with isolated API fixtures; no real submissions', screenshots: output }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
