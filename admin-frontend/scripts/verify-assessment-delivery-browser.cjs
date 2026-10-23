// Real Chrome + isolated API fixtures. No publication to real classes.
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
(async () => {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'assessment-delivery-qa-'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [], deliveries = [];
  const rounds = [{ id: 'trial', phase: 'post', name: 'CPS16 · 审题稿', class_name: '预试班', source: '仅供预览，仍需审题', revision: 1, enabled: true, published_at: new Date().toISOString(), response_count: 0,
    questions: [{ id: 'q1', type: 'choice', required: true, text: '这项任务你打算怎样开始？', options: [{ value: '1', label: '先看要求' }, { value: '2', label: '先做尝试' }] }] }];
  let failDelivery = true;
  try {
    async function context(teacher) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await ctx.addInitScript(t => localStorage.setItem(t ? 'auth_token' : 'cognisync-token', 'fixture'), teacher);
      await ctx.route('**/api/**', async route => {
        const req = route.request(), p = new URL(req.url()).pathname;
        const reply = data => route.fulfill({ json: { success: true, data } });
        if (p.endsWith('/auth/me')) return reply({ user: { id: teacher ? 'teacher' : 'kero-fixture', name: '验收用户', role: teacher ? 'admin' : 'student', experimentGroup: 'pdt', hasCompletedOnboarding: true }, profile: null });
        if (p === '/api/admin/assessments') return reply(rounds);
        if (p.endsWith('/distribute')) {
          const body = req.postDataJSON(); deliveries.push(body);
          if (failDelivery) { failDelivery = false; return route.fulfill({ status: 503, json: { detail: '模拟连接失败，请重试' } }); }
          assert.equal(body.class_name, '解构班');
          const delivered = { ...rounds[0], id: body.request_id, class_name: body.class_name, revision: 2 };
          rounds.push(delivered); return reply(delivered);
        }
        if (p === '/api/assessments/pending') {
          const pending = rounds.find(r => r.class_name === '解构班' && r.enabled);
          return reply(pending ? { ...pending, served_at: new Date().toISOString() } : null);
        }
        if (p === '/api/project-review/current') return reply(null);
        if (p === '/api/classroom/state') return reply({ session: null, prompt: null, lesson_entry: null });
        if (p === '/api/learning-support/state') return reply({ level: 0, history: [], paused: false });
        return reply([]);
      });
      return ctx;
    }
    const teacher = await context(true), student = await context(false);
    const tp = await teacher.newPage(), sp = await student.newPage();
    for (const p of [tp, sp]) { p.setDefaultTimeout(10000); p.on('pageerror', e => errors.push(e.message)); }
    await sp.goto('http://localhost:8003/');
    await sp.getByRole('button', { name: /问卷与测试/ }).click();
    await sp.getByText('暂时没有需要填写的内容。', { exact: true }).waitFor();
    await sp.getByRole('button', { name: '返回课堂', exact: true }).click();
    await tp.goto('http://localhost:8003/admin/assessments');
    await tp.getByRole('heading', { name: '题本与发放记录', exact: true }).waitFor();
    assert.equal(await tp.getByRole('heading', { name: '首次填写', exact: true }).count(), 0);
    assert.equal(await tp.getByRole('heading', { name: '课后填写', exact: true }).count(), 0);
    assert.equal(await tp.getByRole('button', { name: '新建题本', exact: true }).count(), 1);
    await tp.getByRole('button', { name: '开发班', exact: true }).click();
    await tp.getByRole('button', { name: '发给开发班', exact: true }).waitFor();
    await tp.getByRole('button', { name: '解构班', exact: true }).click();
    await tp.getByRole('button', { name: '发给解构班', exact: true }).click();
    await tp.getByRole('dialog', { name: '发给解构班？', exact: true }).waitFor();
    await tp.screenshot({ path: path.join(output, 'confirm-class.png') });
    await tp.getByRole('button', { name: '确认发放', exact: true }).click();
    await tp.getByRole('dialog').getByRole('alert').waitFor();
    await tp.getByRole('button', { name: '确认发放', exact: true }).click();
    await tp.getByRole('button', { name: '解构班填写中', exact: true }).waitFor();
    assert.equal(deliveries.length, 2);
    assert.equal(deliveries[0].request_id, deliveries[1].request_id);
    await tp.screenshot({ path: path.join(output, 'unified-teacher.png'), fullPage: true });
    await sp.getByRole('button', { name: /问卷与测试/ }).click();
    await sp.getByRole('heading', { name: '这项任务你打算怎样开始？', exact: true }).waitFor();
    await sp.screenshot({ path: path.join(output, 'student-received.png') });
    await tp.setViewportSize({ width: 390, height: 844 });
    assert.equal(await tp.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'PASS', output, checks: ['one interface', 'two explicit classes', 'trial template to selected class', 'retry same request', 'student sees classroom assignment'] }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
