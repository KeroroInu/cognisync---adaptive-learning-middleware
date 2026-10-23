// Isolated UI checks; every API is mocked, no real student data is created.
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addInitScript(() => localStorage.setItem('auth_token', 'isolated-advice-ui-test'));
    const page = await context.newPage(), errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    let fail = false;
    const content = '<script>window.feedbackInjected=true</script> 希望多解释列表\n这是原文';
    await context.route('**/api/**', route => {
      const url = new URL(route.request().url());
      const json = data => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
      if (url.pathname === '/api/admin/auth/me') return json({ user: { id: 'teacher', name: '测试教师', role: 'admin' }, profile: null });
      if (url.pathname === '/api/admin/advice') {
        requests.push(url.searchParams.toString());
        assert.equal(route.request().method(), 'GET');
        if (fail) return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
        if (url.searchParams.get('class_name') === '开发班') return json({ total: 0, items: [] });
        const offset = Number(url.searchParams.get('offset'));
        return json({ total: 21, items: [{ id: String(offset), name: '测试学生', student_id: 'test-001', class_name: '解构班', content: offset ? '最后一条建议' : content, received_at: '2026-10-14T04:00:00Z', client_context: { title: '第一课' } }] });
      }
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    });
    await page.goto('http://localhost:8003/admin/exports');
    await page.getByText('学生建议', { exact: true }).waitFor();
    assert.equal(requests.length, 0, 'collapsed panel must not poll');
    await page.getByText('学生建议', { exact: true }).click();
    await page.getByText(content, { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.feedbackInjected), undefined);
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await page.getByText('最后一条建议', { exact: true }).waitFor();
    assert.match(requests.at(-1), /offset=20/);
    await page.locator('.student-advice select').selectOption('开发班');
    await page.getByText('共 0 条，收到后会显示在这里。').waitFor();
    assert.match(requests.at(-1), /offset=0/);
    fail = true;
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    await page.getByRole('alert').waitFor();
    fail = false;
    await page.locator('.student-advice select').selectOption('解构班');
    await page.getByText(content, { exact: true }).waitFor();
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 800 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${width}`);
    }
    assert.deepEqual(errors, []);
    console.log('PASS advice UI: lazy load, raw text escaping, pagination, class filter, error/retry, desktop/mobile; mocked APIs only.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
