// Fully isolated fixtures: no production API, student data, or model requests.
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

(async () => {
  const root = process.env.STUDENT_BUILD_DIR || path.resolve(__dirname, '../dist');
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'sfls-experience-browser-'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addInitScript(() => localStorage.setItem('cognisync-token', 'fixture-experience'));
    let published = true, count = 0, failUpload = true;
    let design = { revision: 0, requirements: '', nodes: [], edges: [], drawio_xml: '' };
    const designWrites = [];
    const uploads = [], downloads = [], unknown = [], errors = [];
    const fixture = {
      id: 'experience-task', title: '校园图书借阅助手', kind: 'sfls', max_submissions: 20,
      configuration: { phase: 'practice', task: '制作一个终端图书借阅系统，可以查询、借出和归还。' },
    };
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url()), p = url.pathname;
      const reply = data => route.fulfill({ json: { success: true, data } });
      if (p === '/api/auth/me') return reply({ user: { id: 'fixture-experience', name: '体验同学', experimentGroup: 'experience', hasCompletedOnboarding: true }, profile: null });
      if (['/api/assessments/pending', '/api/assessments/status', '/api/project-review/current'].includes(p)) return reply(null);
      if (p === '/api/learning-support/state') return reply({ level: 0, paused: false, history: [] });
      if (p === '/api/classroom/state') return reply({ session: null, prompt: null, lesson_entry: null });
      if (p === '/api/preparation/records') return reply([]);
      if (p === '/downloads/sfls/installers.json') return route.fulfill({ json: { kind: 'offline', version: '0.1.20', files: [{ platform: 'windows', file: 'SFLS-0.1.20-offline-windows.zip', bytes: 111724544, sha256: 'a'.repeat(64) }] } });
      if (p === '/api/materials') return reply(published ? [{ ...fixture, submission: { count, last_submitted_at: null } }] : []);
      if (p === '/api/materials/experience-task/design') {
        if (request.method() === 'GET') return reply({ current: design });
        const payload = request.postDataJSON(); designWrites.push(payload);
        design = { ...payload, revision: design.revision + 1 };
        return reply(design);
      }
      if (p === '/api/materials/experience-task/download') {
        assert.equal(request.method(), 'POST'); downloads.push(url.searchParams.get('platform'));
        return route.fulfill({ contentType: 'application/zip', body: Buffer.from('fixture-only-not-a-student-archive') });
      }
      if (p === '/api/materials/experience-task/manual-submit') {
        assert.equal(request.method(), 'POST');
        uploads.push({ id: url.searchParams.get('request_id'), body: request.postDataBuffer() });
        if (failUpload) { failUpload = false; return route.fulfill({ status: 503, json: { detail: '模拟网络中断，请重试' } }); }
        count += 1;
        return reply({ id: 'fixture-receipt', created_at: new Date().toISOString(), detail: { task_validation: { status: 'matched' }, manual_import: { redaction_count: 0, evidence_presence: { code: true, events: true, sessions: true } } } });
      }
      if (p === '/api/materials/experience-task/readme') return reply({ receipt_id: 'fixture-receipt', created_at: new Date().toISOString(), text: '# 图书借阅助手\n学生原话：用字典保存图书库存。\n<script>window.fixtureUnsafe=true</script>', message: '', task_validation_status: 'matched' });
      if (p.startsWith('/api/')) { unknown.push(p); return route.fulfill({ status: 404, json: { detail: 'Unmocked API' } }); }
      const candidate = path.resolve(root, '.' + (p === '/' ? '/index.html' : decodeURIComponent(p)));
      if (!candidate.startsWith(root + path.sep)) return route.abort();
      try {
        const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
        return route.fulfill({ body: await fs.readFile(candidate), contentType: types[path.extname(candidate)] || 'application/octet-stream' });
      } catch { return route.fulfill({ status: 404, body: 'not found' }); }
    });
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://experience-fixture.local/');
    await page.getByRole('heading', { name: fixture.title, exact: true }).waitFor();
    assert.ok(!(await page.locator('body').innerText()).includes('贪吃蛇'));
    assert.equal(await page.locator('.project-factory').count(), 0);
    await page.getByRole('link', { name: '安装 SFLS · Windows', exact: true }).waitFor();
    await page.getByRole('button', { name: '需求文档', exact: true }).click();
    const requirements = page.getByRole('textbox', { name: '我的需求', exact: true });
    await requirements.waitFor();
    assert.ok(!(await requirements.getAttribute('placeholder')).includes('贪吃蛇'));
    await requirements.fill('借出后库存减一，归还后库存加一，库存为零时不能借出。');
    await page.getByRole('button', { name: '保存设计', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '已保存，可以下载给 SFLS' }).waitFor();
    assert.equal(designWrites.length, 1);
    assert.equal(designWrites[0].requirements, '借出后库存减一，归还后库存加一，库存为零时不能借出。');
    await page.getByRole('button', { name: '任务', exact: true }).click();
    for (const [label, platform] of [['下载 Windows 包', 'windows'], ['下载 Mac 包', 'mac']]) {
      const nextDownload = page.waitForEvent('download');
      await page.getByRole('button', { name: label, exact: true }).click();
      assert.equal((await nextDownload).suggestedFilename(), `SFLS-${platform}.zip`);
    }
    assert.deepEqual(downloads, ['windows', 'mac']);
    await page.getByLabel('选择作品 ZIP', { exact: true }).setInputFiles({ name: 'G20990001_体验同学.zip', mimeType: 'application/zip', buffer: Buffer.from('fixture-upload-only') });
    const submit = page.getByRole('button', { name: '上传作品', exact: true });
    await submit.click();
    await page.getByRole('alert').filter({ hasText: '模拟网络中断' }).waitFor();
    await submit.click();
    await page.getByRole('status').filter({ hasText: '服务器已收到作品' }).waitFor();
    await page.getByText('已提交 1 / 20 次', { exact: true }).waitFor();
    assert.equal(uploads.length, 2); assert.ok(uploads[0].id);
    assert.equal(uploads[0].id, uploads[1].id);
    assert.deepEqual(uploads[0].body, uploads[1].body);
    await page.getByRole('button', { name: '作品记录', exact: true }).click();
    await page.locator('.studio-readme').filter({ hasText: '用字典保存图书库存' }).waitFor();
    assert.equal(await page.locator('.studio-readme script').count(), 0);
    assert.equal(await page.evaluate(() => window.fixtureUnsafe), undefined);
    await page.getByRole('button', { name: '任务', exact: true }).click();
    await page.screenshot({ path: path.join(output, 'experience-task.png') });
    published = false;
    await page.reload();
    await page.getByRole('heading', { name: '今天的创作，即将开始', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '下载 Windows 包', exact: true }).count(), 0);
    assert.equal(await page.locator('.project-factory').count(), 0);
    assert.deepEqual(errors, []); assert.deepEqual(unknown, []);
    await context.close();
    console.log(JSON.stringify({ status: 'PASS', output, checks: ['experience generic task', 'Windows installer', 'requirements save', 'Win/Mac download', 'manual ZIP retry/idempotency', 'README', 'task withdraw', 'no Snake workspace'], productionWrites: 0 }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
