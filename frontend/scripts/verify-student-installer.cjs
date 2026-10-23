// Isolated browser fixtures: no accounts, teaching data or real package downloads.
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(process.env.STUDENT_BUILD_DIR || path.join(__dirname, '../dist'));
const filename = 'SFLS-0.1.14-offline-windows.zip';
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const group of ['pdt', 'ai_pbl']) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      await context.addInitScript(() => localStorage.setItem('cognisync-token', 'isolated-installer-test'));
      let failManifest = true, hasTask = false, manifestCalls = 0;
      const errors = [], unknown = [];
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await context.route('**/*', async route => {
        const pathname = new URL(route.request().url()).pathname;
        const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
        if (pathname === '/api/auth/me') return json({ success: true, data: { user: { id: group, name: '测试同学', experimentGroup: group, hasCompletedOnboarding: true }, profile: null } });
        if (pathname === '/api/assessments/pending' || pathname === '/api/project-review/current') return json({ success: true, data: null });
        if (pathname === '/api/learning-support/state') return json({ success: true, data: { level: 0, paused: false, history: [] } });
        if (pathname === '/api/classroom/state') return json({ success: true, data: { session: null, prompt: null, lesson_entry: null } });
        if (pathname === '/api/preparation/records') return json({ success: true, data: [] });
        if (pathname === '/api/materials') return json({ success: true, data: hasTask ? [{ id: 'task', title: '贪吃蛇初体验', kind: 'sfls', configuration: { task: '从一个功能开始，表达你的设计想法。', phase: 'practice' }, submission: { count: 0 } }] : [] });
        if (pathname === '/downloads/sfls/installers.json') {
          if (process.env.REAL_MANIFEST === '1') return route.continue();
          manifestCalls++;
          if (failManifest) return json({}, 503);
          return json({ version: '0.1.14', kind: 'offline', files: [{ platform: 'windows', file: filename, bytes: 111537891, sha256: 'a'.repeat(64) }, { platform: 'mac', file: 'SFLS-0.1.14-offline-mac.zip', bytes: 253150533, sha256: 'b'.repeat(64) }] });
        }
        if (pathname === '/downloads/sfls/' + filename) return route.fulfill({ contentType: 'application/zip', body: Buffer.from('fixture-only'), headers: { 'Content-Disposition': `attachment; filename="${filename}"` } });
        if (pathname.startsWith('/api/')) { unknown.push(pathname); return json({}, 404); }
        if (process.env.STUDENT_URL) return route.continue();
        const candidate = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : decodeURIComponent(pathname)));
        if (!candidate.startsWith(root + '/')) return route.abort();
        try {
          const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
          return route.fulfill({ body: await fs.readFile(candidate), contentType: types[path.extname(candidate)] || 'application/octet-stream' });
        } catch { return route.fulfill({ status: 404, body: 'not found' }); }
      });
      await page.goto(process.env.STUDENT_URL || 'http://localhost:8003/');
      await page.getByRole('heading', { name: '今天的创作，即将开始' }).waitFor();
      if (process.env.REAL_MANIFEST !== '1') {
        const retry = page.getByRole('button', { name: '重试安装包下载' });
        await retry.waitFor();
        failManifest = false;
        await retry.click();
      }
      const link = page.getByRole('link', { name: '安装 SFLS · Windows' });
      await link.waitFor();
      if (process.env.REAL_MANIFEST !== '1') assert.equal(manifestCalls, 2);
      assert.equal(await link.getAttribute('href'), '/downloads/sfls/' + filename);
      assert.equal(await page.locator('a[href*="offline-mac"]').count(), 0);
      const downloaded = page.waitForEvent('download');
      await link.click();
      assert.equal((await downloaded).suggestedFilename(), filename);
      hasTask = true;
      await page.reload();
      await page.getByRole('heading', { name: '贪吃蛇初体验' }).waitFor();
      assert.equal(await link.isVisible(), true);
      await page.getByRole('button', { name: '使用指南', exact: true }).click();
      await page.getByText('第一次使用：安装与密钥', { exact: true }).click();
      await page.getByText('Install.cmd', { exact: false }).first().waitFor();
      assert.ok(await page.locator('a[href*="gitee.com/kerorororo/sfls-install"]').count());
      await page.getByRole('button', { name: '任务', exact: true }).click();
      for (const width of [1280, 375]) {
        await page.setViewportSize({ width, height: width === 375 ? 812 : 720 });
        await link.scrollIntoViewIfNeeded();
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no horizontal page overflow');
        await page.screenshot({ path: `/tmp/sfls-installer-${group}-${width}.png` });
      }
      assert.deepEqual(errors, []);
      assert.deepEqual(unknown, []);
      console.log(`${group}: no-task entry, ${process.env.REAL_MANIFEST === '1' ? 'live manifest' : 'retry'}, native Windows-only download, published task, guide and responsive layout passed`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
