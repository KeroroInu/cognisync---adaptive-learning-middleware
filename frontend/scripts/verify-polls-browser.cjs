// Real Chrome with isolated API fixtures. Never changes teaching data.
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'poll-qa-'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [], unknown = [], votes = [];
  const sessions = ['解构班', '开发班'].map((name, i) => ({ id: `s${i}`, class_name: name, title: '课堂投票验收', state: 'open', is_current: true, created_at: new Date().toISOString(), prompt: null, response_count: 0 }));
  const polls = [];
  let failVote = false;
  try {
    async function context(role, classIndex = 0) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await ctx.addInitScript(role => localStorage.setItem(role === 'teacher' ? 'auth_token' : 'cognisync-token', 'fixture'), role);
      await ctx.route('**/api/**', async route => {
        const req = route.request(), url = new URL(req.url()), p = url.pathname;
        const reply = (data, status = 200) => route.fulfill({ status, json: status === 200 ? { success: true, data } : { detail: data } });
        if (p.endsWith('/auth/me')) return reply({ user: { id: role, name: '验收用户', role: role === 'teacher' ? 'admin' : 'learner', experimentGroup: 'pdt', hasCompletedOnboarding: true }, profile: null });
        if (p === '/api/admin/classroom/sessions') return reply(sessions);
        if (p === '/api/admin/classroom/workspace') return reply(sessions.find(s => s.class_name === req.postDataJSON().class_name));
        if (p === '/api/admin/classroom/notices') return reply(null);
        if (/\/sessions\/s[01]\/polls$/.test(p)) {
          const sid = p.split('/')[5];
          if (req.method() === 'POST') {
            const body = req.postDataJSON();
            const poll = { id: body.request_id, kind: 'poll', session_id: sid, question: { id: 'poll', type: 'choice', required: true, text: body.topic, options: [{ value: 'a', label: body.option_a }, { value: 'b', label: body.option_b }] }, counts: { a: 0, b: 0 }, published_at: new Date().toISOString(), closed_at: null };
            polls.unshift(poll); sessions.find(s => s.id === sid).prompt = poll;
            return reply(poll);
          }
          const items = polls.filter(p => p.session_id === sid);
          return reply({ total: items.length, items });
        }
        if (/\/prompts\/[^/]+\/close$/.test(p)) { const poll = polls.find(x => p.includes(x.id)); poll.closed_at = new Date().toISOString(); return reply(poll); }
        if (/\/sessions\/s[01]\/state$/.test(p)) { const s = sessions.find(s => p.includes(s.id)); s.state = 'closed'; polls.filter(x => x.session_id === s.id).forEach(p => p.closed_at = new Date().toISOString()); return reply(s); }
        if (p.endsWith('/evidence')) return reply({ total: 0, items: [], knowledge_points: [] });
        if (p.endsWith('/lesson')) return reply(null);
        if (p === '/api/classroom/state') {
          const session = sessions[classIndex];
          const prompt = polls.find(p => p.session_id === session.id && !p.closed_at && !votes.some(v => v.id === p.id && v.user === role));
          return reply({ session, prompt: prompt || null, lesson_entry: null });
        }
        if (/\/prompts\/[^/]+\/responses$/.test(p)) {
          if (failVote) { failVote = false; return reply('模拟网络中断，请重试', 503); }
          const poll = polls.find(x => p.includes(x.id)), body = req.postDataJSON();
          assert.ok(!poll.closed_at);
          votes.push({ id: poll.id, user: role, answer: body.answer }); poll.counts[body.answer]++;
          return reply({ id: 'receipt' });
        }
        if (['/api/project-review/current', '/api/assessments/pending'].includes(p)) return reply(null);
        if (p === '/api/learning-support/state') return reply({ level: 0, paused: false, history: [] });
        if (p.endsWith('/materials') || p === '/api/preparation/records' || p.endsWith('/lesson-tasks')) return reply([]);
        unknown.push(p); return reply('Unmocked', 404);
      });
      return ctx;
    }
    const teacher = await context('teacher'), first = await context('first'), second = await context('second'), other = await context('other', 1);
    const tp = await teacher.newPage(), sp = await first.newPage(), sp2 = await second.newPage(), op = await other.newPage();
    for (const p of [tp, sp, sp2, op]) { p.setDefaultTimeout(10000); p.on('pageerror', e => errors.push(e.message)); }
    await tp.goto('http://localhost:8003/admin/classroom');
    await tp.getByRole('button', { name: '发起投票', exact: true }).click();
    await tp.getByLabel('投票主题', { exact: true }).fill('你会先试哪种方法？');
    await tp.getByLabel('选项 A', { exact: true }).fill('使用列表');
    await tp.getByLabel('选项 B', { exact: true }).fill('使用列表');
    assert.equal(await tp.getByRole('button', { name: '开启投票', exact: true }).isDisabled(), true);
    await tp.getByLabel('选项 B', { exact: true }).fill('使用字典');
    await tp.screenshot({ path: path.join(output, 'teacher-compose.png'), fullPage: true });
    await tp.getByRole('button', { name: '开启投票', exact: true }).click();
    await tp.getByRole('button', { name: '结束投票', exact: true }).waitFor();
    await Promise.all([sp.goto('http://localhost:8003/'), sp2.goto('http://localhost:8003/'), op.goto('http://localhost:8003/')]);
    const dialog = sp.getByRole('dialog', { name: '你会先试哪种方法？' });
    await dialog.waitFor();
    assert.equal(await op.locator('.student-poll').count(), 0);
    await sp.getByRole('button', { name: '稍后投票', exact: true }).click();
    await sp.getByRole('button', { name: '参与投票', exact: true }).click();
    await sp.setViewportSize({ width: 390, height: 844 });
    await sp.screenshot({ path: path.join(output, 'student-mobile.png') });
    assert.equal(await sp.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await sp.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await sp.screenshot({ path: path.join(output, 'student-dark.png') });
    failVote = true;
    await dialog.getByRole('button', { name: /使用列表/ }).click();
    await dialog.getByRole('alert').waitFor();
    assert.equal(await dialog.getByRole('button', { name: /使用字典/ }).isDisabled(), true);
    await dialog.getByRole('button', { name: /使用列表/ }).click();
    await dialog.waitFor({ state: 'hidden' });
    await sp.reload();
    assert.equal(await sp.locator('.student-poll').count(), 0);
    await tp.getByText('投票中 · 1 票', { exact: true }).waitFor();
    await tp.screenshot({ path: path.join(output, 'teacher-results.png'), fullPage: true });
    await tp.getByRole('button', { name: '结束投票', exact: true }).click();
    await sp2.locator('.student-poll').waitFor({ state: 'hidden' });
    await tp.getByText('已结束的投票', { exact: true }).click();
    await tp.getByText('已结束 · 1 票', { exact: true }).waitFor();
    await tp.reload();
    await tp.getByText('已结束的投票', { exact: true }).click();
    await tp.getByText('已结束 · 1 票', { exact: true }).waitFor();
    await tp.getByRole('button', { name: '开发班', exact: true }).click();
    assert.equal(await tp.locator('.teacher-poll-result').count(), 0);
    assert.equal(votes.length, 1);
    assert.deepEqual(unknown, []); assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'PASS', output, checks: ['teacher create/results/history', 'student dismiss/vote/retry', 'class isolation', 'closed popup disappears', 'mobile/dark', 'no browser errors'] }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
