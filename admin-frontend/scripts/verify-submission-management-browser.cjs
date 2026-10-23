// Fixture-only regression: every request is intercepted; no real student data is read or changed.
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');

(async () => {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'sfls-submission-management-'));
  const root = process.env.ADMIN_BUILD_DIR || path.resolve(__dirname, '../dist');
  const users = [
    { id: 'u1', student_id: 'G20261001', name: '张同学', class_name: '开发班', experiment_group: 'ai_pbl', submission_count: 3, download_count: 2, last_submitted_at: '2026-10-21T06:00:00Z' },
    { id: 'u2', student_id: 'G20261002', name: '李同学', class_name: null, experiment_group: 'unassigned', submission_count: 0, download_count: 1 },
    { id: 'u3', student_id: 'G20261003', name: '王同学', class_name: null, experiment_group: 'unassigned' },
  ].map(row => ({ ...row, role: 'learner', is_active: true, school_class: '高一（1）班', last_active_at: null }));
  const session = { id: 's1', class_name: '解构班', title: '当前发布', is_current: true, state: 'open', created_at: '2026-10-21T00:00:00Z' };
  const materials = ['m1', 'm2'].map((id, index) => ({ id, title: index ? '第二课空记录' : '第一课体验任务', kind: 'sfls', student_visible: index === 0, closed_at: null, submission_count: index ? 0 : 2, download_count: index ? 0 : 49,
    configuration: { library: { version: 'fixture', lesson_number: index + 1, slides_path: '/slides/fixture.html' } } }));
  const receipt = index => ({ id: 'r' + index, student_id: 'G20261001', name: '张同学', kind: index === 0 || index === 50 ? 'submission' : 'download', size: 123, created_at: '2026-10-21T06:00:00Z' });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [], unexpected = [], offsets = [], assignments = [];
  let failNextReceipt = true, receiptRequests = 0, fileRequests = 0;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    await context.addInitScript(() => localStorage.setItem('auth_token', 'fixture-only'));
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url()), p = url.pathname;
      const reply = data => route.fulfill({ json: { success: true, data } });
      if (p === '/api/admin/auth/me') return reply({ user: { id: 'teacher', name: '测试教师', role: 'admin' } });
      if (p === '/api/admin/users') {
        const group = url.searchParams.get('experiment_group'), query = url.searchParams.get('query') || '';
        const rows = users.filter(user => (!group || user.experiment_group === group) && (user.name + user.student_id).includes(query));
        return reply({ users: rows, total: rows.length, page: 1, page_size: 10 });
      }
      if (p === '/api/admin/users/unassigned-ids') return reply({ ids: users.filter(user => user.experiment_group === 'unassigned').map(user => user.id) });
      if (p === '/api/admin/users/batch-assign') {
        const body = req.postDataJSON(); assignments.push(body);
        body.user_ids.forEach(id => { const user = users.find(item => item.id === id); assert.equal(user.experiment_group, 'unassigned'); user.class_name = body.class_name; user.experiment_group = 'pdt'; });
        return reply({ assigned: body.user_ids.length, class_name: body.class_name });
      }
      if (p === '/api/admin/classroom/workspace') return reply(session);
      if (p === '/api/admin/classroom/sessions') return reply([session]);
      if (p === '/api/admin/classroom/notices/sent') return reply([]);
      if (p === '/api/admin/classroom/sessions/s1/polls') return reply({ total: 0, items: [] });
      if (p === '/api/admin/classroom/sessions/s1/materials') return reply(materials);
      if (p === '/api/admin/classroom/materials/m1/receipts') {
        receiptRequests++; const offset = Number(url.searchParams.get('offset') || 0); offsets.push(offset);
        await new Promise(resolve => setTimeout(resolve, 150));
        if (failNextReceipt) { failNextReceipt = false; return route.fulfill({ status: 503, json: { detail: '模拟记录读取失败，请刷新记录' } }); }
        return reply({ total: 51, submission_count: 2, download_count: 49, items: Array.from({ length: offset ? 1 : 50 }, (_, index) => receipt(offset + index)) });
      }
      if (p === '/api/admin/classroom/materials/m2/receipts') return reply({ total: 0, submission_count: 0, download_count: 0, items: [] });
      if (p === '/api/admin/classroom/receipts/r0/file') { fileRequests++; return route.fulfill({ contentType: 'application/zip', body: Buffer.from('PK-fixture-only') }); }
      if (p === '/downloads/sfls/installers.json') return route.fulfill({ json: { files: ['windows', 'mac'].map(platform => ({ platform, file: `SFLS-0.1.20-offline-${platform}.zip`, bytes: 100, sha256: 'a'.repeat(64) })) } });
      if (p.startsWith('/api/')) { unexpected.push(req.method() + ' ' + p); return route.fulfill({ status: 500, json: { detail: 'Unexpected fixture API' } }); }
      assert.equal(url.hostname, 'fixture.local', 'test must not contact a real server');
      const relative = p.startsWith('/admin/assets/') ? p.slice('/admin'.length) : '/index.html';
      const file = path.resolve(root, '.' + relative); assert.ok(file.startsWith(root + path.sep));
      return route.fulfill({ contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html', body: await fs.readFile(file) });
    });
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.goto('http://fixture.local/admin/users');
    const studentRow = page.getByRole('row').filter({ hasText: 'G20261001' });
    await studentRow.getByText('3 份', { exact: true }).waitFor();
    assert.equal(await studentRow.getByText('下载 2 次', { exact: true }).count(), 1);
    assert.equal(await page.getByRole('row').filter({ hasText: 'G20261003' }).getByText('0 份', { exact: true }).count(), 1, 'legacy rows retain zero default');
    await page.screenshot({ path: path.join(output, 'students-counts.png') });
    await page.getByRole('button', { name: '全选未分组（跨页）' }).click();
    await page.getByRole('button', { name: '分入解构班', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '已将 2 位学生分入解构班' }).waitFor();
    assert.equal(assignments.length, 1); assert.deepEqual(assignments[0], { user_ids: ['u2', 'u3'], class_name: '解构班' });
    await page.getByRole('link', { name: '布置任务', exact: true }).click();
    await page.getByText('第一课体验任务', { exact: true }).waitFor();
    await page.getByText(/已收 2 份 · 下载 49 次/).waitFor();
    const firstButton = page.getByRole('button', { name: '查看下载与提交', exact: true }).first();
    await firstButton.click();
    let dialog = page.getByRole('dialog', { name: '下载与提交', exact: true });
    await dialog.getByRole('status').waitFor();
    await dialog.getByRole('alert').filter({ hasText: '模拟记录读取失败' }).waitFor();
    await dialog.getByRole('button', { name: '刷新记录' }).click();
    await dialog.getByText('共 51 条 · 第 1 / 2 页', { exact: true }).waitFor();
    assert.equal(await dialog.locator('.lesson-receipt').count(), 50);
    await page.screenshot({ path: path.join(output, 'receipts-desktop.png') });
    const downloadPromise = page.waitForEvent('download');
    await dialog.getByRole('button', { name: '下载原件', exact: true }).click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /^G20261001_张同学_第一课体验任务_r0\.zip$/);
    assert.equal(fileRequests, 1);
    await dialog.getByRole('button', { name: '下一页', exact: true }).click();
    await dialog.getByText('共 51 条 · 第 2 / 2 页', { exact: true }).waitFor();
    await dialog.getByRole('button', { name: '上一页', exact: true }).click();
    await dialog.getByText('共 51 条 · 第 1 / 2 页', { exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await dialog.evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; }), true);
    await page.screenshot({ path: path.join(output, 'receipts-mobile.png') });
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
    const requestsBeforeReopen = receiptRequests;
    await firstButton.click(); dialog = page.getByRole('dialog', { name: '下载与提交', exact: true });
    await dialog.getByText('共 51 条 · 第 1 / 2 页', { exact: true }).waitFor();
    assert.equal(receiptRequests, requestsBeforeReopen + 1, 'same task reopens with fresh data');
    await dialog.getByRole('button', { name: '关闭下载与提交' }).click();
    await page.getByRole('button', { name: '查看下载与提交', exact: true }).nth(1).click();
    await page.getByRole('dialog').getByText('还没有下载或提交记录。', { exact: true }).waitFor();
    assert.ok(offsets.includes(50)); assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    console.log(JSON.stringify({ status: 'PASS', output, checks: ['student counts/defaults', 'cross-page unassigned grouping', 'task counts', 'visible receipt dialog', 'loading/error/retry', 'refresh/reopen', 'pagination', 'original ZIP download label', 'empty state', 'Escape close', 'mobile bounds', 'fixture only'] }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
