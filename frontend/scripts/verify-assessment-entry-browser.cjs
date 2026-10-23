// Browser acceptance with isolated API fixtures; no teaching answers or publications.
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');

async function verifyPalette(page, theme) {
  const palette = await page.evaluate(() => {
    const read = selector => {
      const style = getComputedStyle(document.querySelector(selector));
      return { color: style.color, background: style.backgroundColor, scheme: style.colorScheme };
    };
    return { room: read('.question-room'), caption: read('.question-caption'), selected: read('.question-options .is-selected'), option: read('.question-options label:not(.is-selected)'), input: read('.question-options input'), textarea: read('.question-dialog textarea'), primary: read('.question-primary'), placeholder: getComputedStyle(document.querySelector('.question-dialog textarea'), '::placeholder').color };
  });
  const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
  const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  assert.ok(theme === 'dark' ? luminance(palette.room.background) < .1 : luminance(palette.room.background) > .8, `${theme}: full paper background matches theme`);
  assert.equal(palette.input.scheme, theme, `${theme}: native controls match paper palette`);
  for (const field of ['room', 'selected', 'option', 'textarea', 'primary']) assert.ok(contrast(palette[field].color, palette[field].background) >= 4.5, `${theme}: ${field} text contrast >= 4.5`);
  assert.ok(contrast(palette.caption.color, palette.room.background) >= 4.5, `${theme}: hint contrast >= 4.5`);
  assert.ok(contrast(palette.placeholder, palette.textarea.background) >= 4.5, `${theme}: placeholder contrast >= 4.5`);
  assert.notEqual(palette.selected.background, palette.option.background, `${theme}: selected option has distinct fill`);
}

(async () => {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'assessment-entry-qa-'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [], unknown = [], submissions = [];
  let pending = null, failure = false, requestCount = 0, statusCount = 0;
  const round = { id: 'entry-round', phase: 'pre', revision: 1, served_at: new Date().toISOString(), questions: [{ id: 'q1', type: 'choice', required: true, text: '这次准备先做什么？', options: [{ value: 'a', label: '先看任务' }, { value: 'b', label: '先提问' }] }] };
  round.questions.push({ id: 'q1-note', parent_id: 'q1', type: 'text', required: false, text: '补充一句（可不填）', options: [] });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addInitScript(() => localStorage.setItem('cognisync-token', 'fixture-entry'));
    await context.route('**/api/**', async route => {
      const req = route.request(), p = new URL(req.url()).pathname;
      const reply = data => route.fulfill({ json: { success: true, data } });
      if (p === '/api/auth/me') return reply({ user: { id: 'entry-user', name: '验收同学', experimentGroup: 'pdt', hasCompletedOnboarding: true }, profile: null });
      if (p === '/api/project-review/current') return reply(null);
      if (p === '/api/assessments/status') {
        statusCount++;
        if (failure) return route.fulfill({ status: 503, json: { detail: '临时连接失败' } });
        return reply(pending ? { id: pending.id, revision: pending.revision } : null);
      }
      if (p === '/api/assessments/pending') {
        requestCount++;
        if (failure) return route.fulfill({ status: 503, json: { detail: '临时连接失败' } });
        return reply(pending);
      }
      if (p === '/api/assessments/entry-round/responses') { submissions.push(req.postDataJSON()); pending = null; return reply({ id: 'receipt' }); }
      if (p === '/api/classroom/state') return reply({ session: { id: 's', title: '第 1 课', class_name: '解构班', state: 'open' }, prompt: null, lesson_entry: null });
      if (p === '/api/materials' || p === '/api/preparation/records') return reply([]);
      if (p === '/api/learning-support/state') return reply({ level: 0, paused: false, history: [] });
      unknown.push(p); return route.fulfill({ status: 404, json: { detail: 'Unmocked' } });
    });
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://localhost:8003/');
    const entry = page.getByRole('button', { name: /问卷与测试/ });
    await entry.waitFor();
    const before = requestCount;
    await entry.click();
    await page.getByText('暂时没有需要填写的内容。', { exact: true }).waitFor();
    assert.ok(requestCount > before, 'entry always checks current server state');
    await page.getByRole('button', { name: '返回课堂', exact: true }).click();
    failure = true;
    await entry.click();
    await page.getByRole('dialog').getByRole('alert').waitFor();
    assert.equal(await page.getByText('暂时没有需要填写的内容。', { exact: true }).count(), 0);
    failure = false;
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await page.getByText('暂时没有需要填写的内容。', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    pending = round;
    // No click/focus required: the scheduled status poll opens a full-page paper.
    await page.getByRole('heading', { name: round.questions[0].text, exact: true }).waitFor({ timeout: 14000 });
    assert.equal(await entry.count(), 0);
    assert.equal(await page.locator('.floating-companion').count(), 0);
    await page.getByLabel('先看任务', { exact: true }).check();
    const loadedCount = requestCount;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForResponse(r => new URL(r.url()).pathname === '/api/assessments/status');
    assert.equal(requestCount, loadedCount, 'unchanged poll never fetches all questions again');
    assert.equal(await page.getByLabel('先看任务', { exact: true }).isChecked(), true);
    await verifyPalette(page, 'light');
    await page.screenshot({ path: path.join(output, 'entry-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(output, 'entry-mobile.png') });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await verifyPalette(page, 'dark');
    await page.screenshot({ path: path.join(output, 'entry-dark.png') });
    // Failed polling must leave the paper and selected answer intact.
    failure = true;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForResponse(r => new URL(r.url()).pathname === '/api/assessments/status');
    assert.equal(await page.getByLabel('先看任务', { exact: true }).isChecked(), true);
    failure = false;
    // Teacher withdrawal returns to the classroom; a new round opens automatically.
    pending = null;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await entry.waitFor();
    await entry.click();
    await page.getByText('暂时没有需要填写的内容。', { exact: true }).waitFor();
    await page.getByRole('button', { name: '返回课堂', exact: true }).click();
    pending = round;
    await entry.click();
    await page.getByRole('heading', { name: round.questions[0].text, exact: true }).waitFor();
    assert.equal(await page.locator('.floating-companion').count(), 0);
    await page.getByLabel('先看任务', { exact: true }).check();
    await page.reload();
    assert.equal(await page.getByLabel('先看任务', { exact: true }).isChecked(), true);
    await page.getByRole('button', { name: '提交回答', exact: true }).click();
    await entry.waitFor();
    assert.equal(await page.getByRole('img', { name: '有待填写内容' }).count(), 0);
    await entry.click();
    await page.getByText('暂时没有需要填写的内容。', { exact: true }).waitFor();
    assert.equal(submissions.length, 1);
    assert.equal(submissions[0].answers.q1, 'a');
    assert.deepEqual(errors, []); assert.deepEqual(unknown, []);
    assert.ok(statusCount >= 4);
    console.log(JSON.stringify({ status: 'PASS', output, checks: ['entry/empty/error/retry', 'automatic fullscreen delivery without clicks', 'metadata-only unchanged polls preserve answers', 'network failure keeps draft', 'withdrawal respected', 'refresh draft/submit', 'mobile/light/dark contrast >= 4.5 and native controls', 'no teaching writes'] }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
