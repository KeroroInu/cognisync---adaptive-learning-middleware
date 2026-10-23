// Fixture-only visual/interaction checks. Never edits student records.
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const baseline = process.argv.includes('--baseline');
  const output = await fs.mkdtemp(path.join(os.tmpdir(), baseline ? 'users-before-' : 'users-after-'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [], requests = [];
  const users = Array.from({ length: 6 }, (_, i) => ({ id: 'student-' + i, student_id: i ? '2026100' + i : 'kero', name: ['李同学', '王同学', '陈同学', '周同学', '孙同学', '教师'][i], email: i === 2 ? 'student.long.address@example.com' : null, role: i === 5 ? 'admin' : 'learner', is_active: i !== 3, class_name: i === 5 ? null : i % 2 ? '开发班' : '解构班', experiment_group: i % 2 ? 'ai_pbl' : 'pdt', last_active_at: i === 4 ? null : '2026-10-13T08:00:00Z' }));
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(() => localStorage.setItem('auth_token', 'fixture'));
    await ctx.route('**/api/**', async route => {
      const req = route.request(), url = new URL(req.url());
      const reply = data => route.fulfill({ json: { success: true, data } });
      requests.push({ path: url.pathname, method: req.method() });
      if (url.pathname.endsWith('/auth/me')) return reply({ user: { id: 'teacher', name: '验收教师', role: 'admin' } });
      if (url.pathname === '/api/admin/users') {
        const q = url.searchParams.get('q') || url.searchParams.get('query') || '';
        const rows = users.filter(u => (u.name + u.student_id + u.email).includes(q));
        return reply({ users: rows, total: rows.length, page: 1, page_size: 10 });
      }
      return route.fulfill({ status: 500, json: { detail: 'Unexpected request' } });
    });
    const p = await ctx.newPage(); p.setDefaultTimeout(10000); p.on('pageerror', e => errors.push(e.message));
    await p.goto('http://localhost:8003/admin/users');
    await p.getByText('kero', { exact: true }).waitFor();
    await p.screenshot({ path: path.join(output, 'desktop.png') });
    if (baseline) { console.log(JSON.stringify({ status: 'BASELINE', output })); return; }
    assert.equal(await p.getByText('learner', { exact: true }).count(), 0);
    assert.equal(await p.locator('.users-badge.is-active').count(), 5);
    assert.equal(await p.locator('.users-badge.is-inactive').count(), 1);
    for (const width of [1440, 1280, 1024, 768, 390]) {
      await p.setViewportSize({ width, height: 900 });
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await p.locator('.users-badge').evaluateAll(nodes => nodes.every(n => getComputedStyle(n).whiteSpace === 'nowrap' && n.getBoundingClientRect().height <= 30)), true);
      assert.equal(await p.locator('.users-search').evaluate(el => { const svg = el.querySelector('svg').getBoundingClientRect(), input = el.querySelector('input').getBoundingClientRect(); return input.left - svg.right >= 8 && input.width > 140; }), true);
    }
    await p.getByRole('button', { name: '深色模式', exact: true }).click();
    await p.screenshot({ path: path.join(output, 'mobile-dark.png') });
    await p.setViewportSize({ width: 1440, height: 900 });
    await p.screenshot({ path: path.join(output, 'desktop-dark.png') });
    await p.getByRole('button', { name: '浅色模式', exact: true }).click();
    await p.getByRole('searchbox', { name: '搜索学生' }).fill('kero');
    await p.waitForFunction(() => document.querySelectorAll('.users-table tbody tr').length === 1 && document.querySelector('.users-table tbody').textContent.includes('kero'));
    await p.screenshot({ path: path.join(output, 'search.png') });
    await p.getByRole('button', { name: '编辑用户', exact: true }).click();
    await p.getByRole('dialog', { name: '编辑用户' }).waitFor();
    const toggle = p.getByRole('switch', { name: '启用账号' });
    assert.equal(await toggle.getAttribute('aria-checked'), 'true');
    await toggle.click(); assert.equal(await toggle.getAttribute('aria-checked'), 'false');
    await toggle.click(); assert.equal(await toggle.getAttribute('aria-checked'), 'true');
    assert.equal(await toggle.evaluate(el => el.getBoundingClientRect().height), 26);
    await p.screenshot({ path: path.join(output, 'edit.png') });
    await p.getByRole('button', { name: '关闭编辑' }).click();
    await p.getByRole('button', { name: '重置密码', exact: true }).click();
    await p.getByRole('dialog', { name: '帮助学生重设密码' }).waitFor();
    await p.getByRole('button', { name: '关闭重设密码' }).click();
    await p.getByRole('checkbox', { name: '选择李同学' }).check();
    await p.getByRole('button', { name: '导出量表数据', exact: true }).waitFor();
    await p.getByRole('button', { name: '取消', exact: true }).click();
    assert.ok(requests.every(r => r.method === 'GET')); assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'PASS', output, checks: ['search spacing', 'single-line badges', 'Chinese roles', 'five viewport widths', 'light/dark', 'search/edit/reset/selection', 'no data writes'] }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
