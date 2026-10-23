// Isolated UI fixtures; no real research data is downloaded.
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'exports-qa-'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const requests = [], errors = [];
  let failed = false;
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(() => localStorage.setItem('auth_token', 'fixture'));
    await ctx.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/auth/me')) return route.fulfill({ json: { success: true, data: { user: { id: 'teacher', name: '验收教师', role: 'admin' } } } });
      if (url.pathname === '/api/admin/export/research-package') {
        requests.push(Object.fromEntries(url.searchParams));
        if (failed) return route.fulfill({ status: 413, json: { detail: '超过上限，请分班导出' } });
        return route.fulfill({ contentType: 'application/zip', body: 'fixture-not-real-data' });
      }
      throw new Error('Unexpected API: ' + url.pathname);
    });
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://localhost:8003/admin/exports');
    const button = page.getByRole('button', { name: '下载实验数据', exact: true });
    await button.waitFor();
    assert.equal(await page.locator('.exports-options').getAttribute('open'), null);
    assert.equal(await page.locator('.exports-page button').count(), 1);
    await page.screenshot({ path: path.join(output, 'desktop.png') });
    await page.getByLabel('选择班级').selectOption('解构班');
    const download = page.waitForEvent('download'); await button.click(); await download;
    await page.getByRole('status').waitFor();
    assert.deepEqual(requests[0], { include_identity: 'false', include_graph: 'true', include_originals: 'true', class_name: '解构班' });
    await page.getByText('导出选项与数据说明', { exact: true }).click();
    await page.getByLabel('包含姓名、学号、邮箱（仅内部核对）').check();
    await page.getByLabel('包含当前知识图谱').uncheck();
    await page.getByLabel('包含上传原件').uncheck();
    await page.getByLabel('选择班级').selectOption('开发班');
    failed = true; await button.click();
    await page.getByRole('alert').waitFor();
    assert.deepEqual(requests[1], { include_identity: 'true', include_graph: 'false', include_originals: 'false', class_name: '开发班' });
    assert.equal(await button.isEnabled(), true);
    for (const width of [1280, 768, 390]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    await page.getByRole('button', { name: '深色模式', exact: true }).click();
    await page.screenshot({ path: path.join(output, 'mobile-dark.png') });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'PASS', output, checks: ['single primary action', 'two-class filter', 'privacy defaults', 'explicit error and retry', 'responsive/dark'] }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
