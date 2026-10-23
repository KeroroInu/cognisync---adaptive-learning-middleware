// Isolated API fixtures; never sends a real notice or changes teaching data.
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'notice-qa-'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [], unknown = [], notices = new Map(), sends = [];
  const sessions = ['解构班', '开发班'].map((name, i) => ({ id: 's' + i, class_name: name, title: name, state: 'open', is_current: true, created_at: new Date().toISOString(), prompt: null, response_count: 0 }));
  let failSend = false, failState = false;
  try {
    async function context(role, classIndex = 0) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['clipboard-read', 'clipboard-write'] });
      await ctx.addInitScript(role => localStorage.setItem(role === 'teacher' ? 'auth_token' : 'cognisync-token', 'fixture'), role);
      await ctx.route('**/api/**', async route => {
        const req = route.request(), url = new URL(req.url()), p = url.pathname;
        const reply = (data, status = 200) => route.fulfill({ status, json: status === 200 ? { success: true, data } : { detail: data } });
        if (p.endsWith('/auth/me')) return reply({ user: { id: role, name: '验收用户', role: role === 'teacher' ? 'admin' : 'learner', experimentGroup: 'pdt', hasCompletedOnboarding: true }, profile: null });
        if (p === '/api/admin/classroom/workspace') return reply(sessions.find(s => s.class_name === req.postDataJSON().class_name));
        if (p === '/api/admin/classroom/sessions') return reply(sessions);
        if (p === '/api/admin/classroom/notices/sent') return reply([...notices.values()].filter(n => n.class_name === url.searchParams.get('class_name')).reverse());
        if (p === '/api/admin/classroom/notices/students') return reply([{ id: 'first', name: '甲同学', student_id: '001' }, { id: 'second', name: '乙同学', student_id: '002' }]);
        if (p === '/api/admin/classroom/notices') {
          if (req.method() === 'GET') return reply(notices.get(url.searchParams.get('class_name')) || null);
          const data = req.postDataJSON(); sends.push(data);
          const note = { id: data.request_id, class_name: data.class_name, target_user_ids: data.target_user_ids, content: data.content, expires_at: new Date(Date.now() + 300000).toISOString() };
          notices.set(data.class_name + JSON.stringify(data.target_user_ids), note);
          if (failSend) { failSend = false; return reply('连接超时，请重试', 503); }
          return reply(note);
        }
        if (/\/notices\/[^/]+\/withdraw$/.test(p)) {
          for (const [name, note] of notices) if (p.includes(note.id)) notices.delete(name);
          return reply(null);
        }
        if (p === '/api/classroom/state') {
          if (failState && role === 'first') return reply('连接暂时断开', 503);
          const visible = [...notices.values()].filter(n => n.class_name === sessions[classIndex].class_name && (!n.target_user_ids.length || n.target_user_ids.includes(role))).reverse();
          return reply({ session: sessions[classIndex], prompt: null, lesson_entry: null, notice: visible[0] || null, notices: visible });
        }
        if (p.endsWith('/polls')) return reply({ total: 0, items: [] });
        if (p === '/api/assessments/status') return reply(null);
        if (p.endsWith('/evidence')) return reply({ total: 0, items: [], knowledge_points: [] });
        if (p.endsWith('/lesson') || ['/api/project-review/current', '/api/assessments/pending'].includes(p)) return reply(null);
        if (p === '/api/learning-support/state') return reply({ level: 0, paused: false, history: [] });
        if (p.endsWith('/materials') || p === '/api/preparation/records' || p.endsWith('/lesson-tasks')) return reply([]);
        unknown.push(p); return reply('Unmocked', 404);
      });
      return ctx;
    }
    const teacher = await context('teacher'), first = await context('first'), other = await context('other', 1), second = await context('second');
    const tp = await teacher.newPage(), sp = await first.newPage(), op = await other.newPage(), sp2 = await second.newPage();
    for (const page of [tp, sp, op, sp2]) { page.setDefaultTimeout(12000); page.on('pageerror', e => errors.push(e.message)); }
    await Promise.all([tp.goto('http://localhost:8003/admin/classroom'), sp.goto('http://localhost:8003/'), op.goto('http://localhost:8003/'), sp2.goto('http://localhost:8003/')]);
    await tp.getByRole('button', { name: '发给学生', exact: true }).click();
    assert.equal(await tp.getByRole('button', { name: /开始上课|下课|新的一课/ }).count(), 0);
    await tp.getByRole('textbox', { name: '发送内容', exact: true }).fill('fake-demo-key-for-browser-test');
    failSend = true;
    await tp.getByRole('button', { name: '发送给解构班', exact: true }).click();
    await tp.getByRole('alert').waitFor();
    await tp.getByRole('button', { name: '发送给解构班', exact: true }).click();
    await tp.getByText('已发送给解构班，学生页面会自动弹出。', { exact: true }).waitFor();
    assert.equal(sends[0].request_id, sends[1].request_id);
    const popup = sp.getByRole('dialog', { name: '老师发来一条通知' });
    await popup.waitFor();
    assert.equal(await op.getByRole('dialog').count(), 0);
    await sp.getByRole('button', { name: '复制内容', exact: true }).click();
    assert.equal(await sp.evaluate(() => navigator.clipboard.readText()), 'fake-demo-key-for-browser-test');
    await sp.screenshot({ path: path.join(output, 'student-notice.png') });
    await sp.getByRole('button', { name: '关闭通知' }).click();
    await sp.reload();
    await sp.getByRole('button', { name: '查看通知' }).waitFor();
    assert.equal(await popup.count(), 0);
    await sp.getByRole('button', { name: '查看通知' }).click();
    await popup.waitFor();
    await sp.evaluate(() => Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async () => { throw new Error('denied'); } }));
    await sp.getByRole('button', { name: '复制内容', exact: true }).click();
    await sp.getByText('请按 Ctrl+C（Mac 用 ⌘C）复制所选内容', { exact: true }).waitFor();
    assert.equal(await sp.getByLabel('老师的通知').evaluate(el => el.selectionEnd - el.selectionStart), 'fake-demo-key-for-browser-test'.length);
    assert.equal(await sp.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }).includes('fake-demo-key')), false);
    await sp.setViewportSize({ width: 390, height: 844 });
    await sp.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await sp.screenshot({ path: path.join(output, 'student-mobile-dark.png') });
    assert.equal(await sp.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await tp.getByRole('button', { name: '撤回', exact: true }).click();
    await popup.waitFor({ state: 'hidden' });
    assert.equal(await sp.getByRole('button', { name: '查看通知' }).count(), 0);
    // A private message and a shared message reach only their intended recipients.
    await tp.getByRole('button', { name: '发给学生', exact: true }).click();
    await tp.getByRole('radio', { name: '选择学生' }).check();
    const radioSize = await tp.getByRole('radio', { name: '选择学生' }).boundingBox();
    assert.ok(radioSize.width <= 20 && radioSize.height <= 20, 'radio must not inherit full-width text-input styling');
    await tp.getByRole('textbox', { name: '发送内容', exact: true }).fill('个人指令：python main.py');
    assert.equal(await tp.getByRole('button', { name: '发送给所选 0 位学生' }).isDisabled(), true);
    await tp.getByLabel('搜索学生').fill('001');
    await tp.getByRole('checkbox', { name: /甲同学/ }).check();
    await tp.getByRole('button', { name: '发送给甲同学', exact: true }).click();
    await popup.waitFor();
    assert.equal(await sp.getByLabel('老师的通知').inputValue(), '个人指令：python main.py');
    await sp2.reload(); assert.equal(await sp2.getByRole('dialog').count(), 0);
    await tp.getByRole('button', { name: '发给学生', exact: true }).click();
    await tp.getByLabel('搜索学生').fill('');
    await tp.getByRole('checkbox', { name: /乙同学/ }).check();
    await tp.getByRole('textbox', { name: '发送内容', exact: true }).fill('小组链接：https://example.org/map');
    await tp.getByRole('button', { name: '发送给所选 2 位学生', exact: true }).click();
    await sp.getByRole('button', { name: '查看第 2 条内容' }).waitFor();
    await sp2.getByLabel('老师的通知').waitFor();
    assert.equal(await sp2.getByLabel('老师的通知').inputValue(), '小组链接：https://example.org/map');
    assert.equal(await op.getByRole('dialog').count(), 0);
    await sp.getByRole('button', { name: '关闭通知' }).click();
    await sp.getByRole('button', { name: '关闭通知' }).click();
    await sp.reload(); await sp.getByRole('button', { name: '查看通知' }).waitFor();
    assert.equal(await popup.count(), 0);
    await tp.getByRole('list', { name: '正在显示的内容' }).getByRole('button', { name: '撤回', exact: true }).first().click();
    await tp.getByRole('list', { name: '正在显示的内容' }).getByRole('button', { name: '撤回', exact: true }).first().click();
    await tp.getByRole('button', { name: '发给学生', exact: true }).click();
    await tp.getByRole('radio', { name: '选择学生' }).check();
    await tp.screenshot({ path: path.join(output, 'teacher-recipients.png'), fullPage: true });
    await tp.setViewportSize({ width: 390, height: 844 });
    assert.equal(await tp.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await tp.screenshot({ path: path.join(output, 'teacher-mobile.png'), fullPage: true });
    await tp.setViewportSize({ width: 1280, height: 800 });
    await tp.getByRole('button', { name: '开发班', exact: true }).click();
    await tp.getByRole('button', { name: '发给学生', exact: true }).click();
    await tp.getByRole('textbox', { name: '发送内容', exact: true }).fill('开发班专属通知');
    await tp.getByRole('button', { name: '发送给开发班', exact: true }).click();
    await op.getByLabel('老师的通知').waitFor();
    assert.equal(await popup.count(), 0);
    await tp.screenshot({ path: path.join(output, 'teacher-classroom.png'), fullPage: true });
    // Local expiry must hide a notice even without another successful state poll.
    notices.set('解构班', { id: 'expires-soon', class_name: '解构班', target_user_ids: [], content: '临时测试', expires_at: new Date(Date.now() + 7000).toISOString() });
    await sp.reload();
    await popup.waitFor();
    await popup.waitFor({ state: 'hidden' });
    notices.set('解构班', { id: 'disconnect', class_name: '解构班', target_user_ids: [], content: '断线不保留', expires_at: new Date(Date.now() + 60000).toISOString() });
    await sp.reload(); await popup.waitFor(); failState = true;
    await popup.waitFor({ state: 'hidden' });
    assert.deepEqual(unknown, []); assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'PASS', output, checks: ['no class gate', 'send + idempotent retry', 'two class isolation', 'one/multiple recipients', 'empty selection blocked', 'search roster', 'coexisting content and dismissed IDs', 'copy/fallback', 'dismiss/reopen/reload', 'withdraw', 'expiry', 'no content in browser storage', 'disconnect hides content', 'mobile/dark'] }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
