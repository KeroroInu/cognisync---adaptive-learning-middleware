// Isolated browser fixtures: never download or upload a real student's work.
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

(async () => {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'sfls-handoff-qa-'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const group of ['pdt', 'ai_pbl']) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await context.addInitScript(() => localStorage.setItem('cognisync-token', 'fixture-handoff'));
      let count = 3, maximum = 20, failUpload = true;
      const uploads = [], downloads = [], unknown = [], errors = [];
      await context.route('**/api/**', async route => {
        const request = route.request(), url = new URL(request.url()), p = url.pathname;
        const reply = data => route.fulfill({ json: { success: true, data } });
        if (p === '/api/auth/me') return reply({ user: { id: `fixture-${group}`, name: '验收同学', experimentGroup: group, hasCompletedOnboarding: true }, profile: null });
        if (['/api/assessments/pending', '/api/assessments/status', '/api/project-review/current'].includes(p)) return reply(null);
        if (p === '/api/learning-support/state') return reply({ level: 0, paused: false, history: [] });
        if (p === '/api/classroom/state') return reply({ session: { id: 'fixture-class', title: '第三课', state: 'open', class_name: group === 'pdt' ? '解构班' : '开发班' }, prompt: null, lesson_entry: null });
        if (p === '/api/preparation/records') return reply([]);
        if (p === '/api/materials') return reply([{ id: 'fixture-task', title: '本课任务：在旧作品上修改', kind: 'sfls', max_submissions: maximum, configuration: { phase: 'practice', task: '先检查旧作品，再添加本课功能。', inherit_previous: true, worksheet: { lesson_id: 'L03', rules: [], acceptance: [] } }, submission: { count, last_submitted_at: null } }]);
        if (p === '/api/materials/fixture-task/download') {
          assert.equal(request.method(), 'POST'); downloads.push(url.searchParams.get('platform'));
          return route.fulfill({ contentType: 'application/zip', body: Buffer.from('fixture-only-not-a-student-archive') });
        }
        if (p === '/api/materials/fixture-task/submit') {
          assert.equal(request.method(), 'POST');
          uploads.push({ id: url.searchParams.get('request_id'), body: request.postDataBuffer() });
          if (failUpload) { failUpload = false; return route.fulfill({ status: 503, json: { detail: '模拟网络中断，请重试' } }); }
          count += 1;
          return reply({ id: `fixture-receipt-${count}`, created_at: new Date().toISOString(), detail: { task_validation: { status: 'matched' } } });
        }
        if (p === '/api/materials/fixture-task/readme') return reply({ receipt_id: 'fixture-receipt', created_at: new Date().toISOString(), text: '# 我的作品\n学生原话：先保存旧蛇身。\n<script>window.fixtureUnsafe=true</script>', message: '', task_validation_status: 'matched' });
        unknown.push(p); return route.fulfill({ status: 404, json: { detail: 'Unmocked API' } });
      });
      const page = await context.newPage(); page.setDefaultTimeout(12000);
      page.on('pageerror', e => errors.push(e.message));
      await page.goto('http://localhost:8003/');
      await page.getByRole('heading', { name: '本课任务：在旧作品上修改' }).waitFor();
      await page.getByText('已提交 3 / 20 次', { exact: true }).waitFor();
      const input = page.getByLabel('选择作品 ZIP', { exact: true });
      assert.equal(await input.isEnabled(), true, 'practice uploads must not stop at legacy count 3');
      for (const [label, platform] of [['下载 Windows 包', 'windows'], ['下载 Mac 包', 'mac']]) {
        const nextDownload = page.waitForEvent('download');
        await page.getByRole('button', { name: label, exact: true }).click();
        assert.equal((await nextDownload).suggestedFilename(), `SFLS-L03-${platform}.zip`);
      }
      assert.deepEqual(downloads, ['windows', 'mac']);
      const fixture = { name: 'submission.zip', mimeType: 'application/zip', buffer: Buffer.from('fixture-upload-only') };
      await input.setInputFiles(fixture);
      const upload = page.getByRole('button', { name: '上传作品', exact: true });
      await upload.click();
      await page.getByRole('alert').filter({ hasText: '模拟网络中断' }).waitFor();
      await upload.click();
      await page.getByRole('status').filter({ hasText: '作品已提交' }).waitFor();
      await page.getByText('已提交 4 / 20 次', { exact: true }).waitFor();
      assert.equal(uploads.length, 2);
      assert.ok(uploads[0].id);
      assert.equal(uploads[0].id, uploads[1].id, 'retry retains idempotency key');
      assert.deepEqual(uploads[0].body, uploads[1].body, 'retry retains original bytes');
      assert.equal(await upload.isDisabled(), true, 'accepted upload clears file selection');
      await page.getByRole('button', { name: '作品记录', exact: true }).click();
      await page.locator('.studio-readme').filter({ hasText: '学生原话：先保存旧蛇身。' }).waitFor();
      assert.equal(await page.locator('.studio-readme script').count(), 0);
      assert.equal(await page.evaluate(() => window.fixtureUnsafe), undefined);
      await page.getByRole('button', { name: '任务', exact: true }).click();
      count = 20;
      await page.reload();
      await page.getByText('已提交 20 / 20 次，如需修改请联系老师。', { exact: true }).waitFor();
      assert.equal(await input.isDisabled(), true);
      assert.equal(await upload.isDisabled(), true);
      maximum = undefined; count = 3;
      await page.reload();
      await page.getByText('已提交 3 / 3 次，如需修改请联系老师。', { exact: true }).waitFor();
      assert.equal(await input.isDisabled(), true, 'legacy API response retains safe limit');
      await page.screenshot({ path: path.join(output, `${group}-handoff.png`) });
      assert.deepEqual(errors, []); assert.deepEqual(unknown, []);
      await context.close();
      console.log(`${group}: Win/Mac download, upload/retry, README safety, dynamic and legacy limits PASS`);
    }
    console.log(JSON.stringify({ status: 'PASS', output, teachingWrites: 0 }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
