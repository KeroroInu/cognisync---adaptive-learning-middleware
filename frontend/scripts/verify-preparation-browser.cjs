const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = process.env.STUDENT_BUILD_DIR || path.resolve(__dirname, '../dist');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await context.addInitScript(() => localStorage.setItem('cognisync-token', 'isolated-ui-test'));
    let failLoad = true, student = 'ui-student-a', count = 0, failAnswer = true, failUpload = true;
    let pending = null, submission = { count: 0, last_submitted_at: null };
    const uploadRequests = [];
    const records = { 'ui-student-a': [{ id: 'cloud-save', kind: 'save', payload: { request: { code: 'print(7)', message: '', output: [], error: '' }, status: 'saved' } }], 'ui-student-b': [] };
    const posts = [], errors = [], unknown = [];
    let classroom = { session: { id: 's', title: '课堂测试', state: 'open', class_name: '隔离班', closes_at: null }, prompt: null, lesson_entry: null };
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      const url = new URL(route.request().url()), pathname = url.pathname;
      const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
      if (pathname === '/api/auth/me') return json({ success: true, data: { user: { id: student, name: '测试同学', experimentGroup: 'ai_pbl', hasCompletedOnboarding: true }, profile: null } });
      if (pathname === '/api/assessments/pending') return json({ success: true, data: pending });
      if (pathname === '/api/classroom/state') return json({ success: true, data: classroom });
      if (pathname === '/api/assessments/batch/responses') {
        const body = route.request().postDataJSON();
        if (failAnswer) { failAnswer = false; return json({ detail: '模拟提交失败，草稿保留' }, 503); }
        assert.deepEqual(body.answers, { q1: 'run', q2: '先检查结果再提问' });
        assert.ok(body.started_at); posts.push({ kind: 'assessment', ...body }); pending = null;
        return json({ success: true, data: { id: 'answer-1' } });
      }
      if (pathname === '/api/materials') return json({ success: true, data: [{ id: 'material-1', title: '独立创作任务', kind: 'file', filename: 'task.zip', configuration: { task: '做一个小游戏，记录验证过程。', accept_submissions: true }, submission }] });
      if (pathname === '/api/materials/material-1/download') return route.fulfill({ contentType: 'application/zip', headers: { 'content-disposition': 'attachment; filename="task.zip"' }, body: Buffer.from('browser-fixture-only') });
      if (pathname === '/api/materials/material-1/submit') {
        uploadRequests.push(url.searchParams.get('request_id'));
        if (failUpload) { failUpload = false; return json({ detail: '网络暂时断开，请重试上传' }, 503); }
        submission = { count: 1, last_submitted_at: new Date().toISOString() };
        posts.push({ kind: 'submission' }); return json({ success: true, data: { id: 'receipt-1', created_at: submission.last_submitted_at } });
      }
      if (pathname === '/api/preparation/records') {
        if (route.request().method() === 'GET') return failLoad ? json({ detail: '模拟读取失败' }, 503) : json({ success: true, data: records[student] });
        const body = route.request().postDataJSON(); posts.push(body);
        const record = { id: `record-${++count}`, kind: body.kind, payload: { request: body, status: body.kind === 'chat' ? 'answered' : 'saved', reply: body.kind === 'chat' ? '这句会输出 7。\n```python\nprint(7)  # 显示结果\n```' : undefined } };
        records[student].push(record); return json({ success: true, data: record });
      }
      if (pathname.startsWith('/api/')) { unknown.push(pathname); return json({ detail: 'Unmocked request' }, 404); }
      const candidate = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : decodeURIComponent(pathname)));
      if (!candidate.startsWith(root + '/')) return route.abort();
      try {
        const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.zip': 'application/zip' };
        return route.fulfill({ body: await fs.readFile(candidate), contentType: types[path.extname(candidate)] || 'application/octet-stream' });
      } catch { return route.fulfill({ status: 404, body: 'not found' }); }
    });
    await page.goto('http://localhost:8003/');
    await page.getByRole('button', { name: '重新读取', exact: true }).waitFor({ timeout: 12000 }).catch(async error => { console.log({ text: await page.locator('body').innerText(), errors, unknown }); throw error; });
    await page.waitForTimeout(1400);
    assert.equal(posts.length, 0, 'read failure must not overwrite cloud');
    assert.equal(await page.locator('.cm-content').count(), 0);
    failLoad = false;
    await page.getByRole('button', { name: '重新读取', exact: true }).click();
    await page.locator('.cm-content').waitFor();
    assert.equal(await page.locator('.cm-content').innerText(), 'print(7)');
    await page.getByRole('button', { name: /作业与资料/ }).click();
    await page.getByRole('heading', { name: '独立创作任务' }).waitFor();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '下载作业包' }).click()]);
    assert.ok(download.suggestedFilename().endsWith('.zip'));
    await page.locator('input[type=file]').setInputFiles({ name: 'submission.zip', mimeType: 'application/zip', buffer: Buffer.from('fixture-only') });
    assert.equal(posts.filter(p => p.kind === 'submission').length, 0, 'file selection must not silently upload');
    await page.getByRole('button', { name: '上传作品', exact: true }).click();
    await page.getByText('网络暂时断开，请重试上传').waitFor();
    await page.getByRole('button', { name: '上传作品', exact: true }).click();
    await page.getByText('作品已提交，老师可以查看了。', { exact: true }).waitFor();
    assert.equal(uploadRequests.length, 2);
    assert.equal(uploadRequests[0], uploadRequests[1]);
    await page.reload(); await page.locator('.cm-content').waitFor();
    await page.getByRole('button', { name: /作业与资料/ }).click();
    await page.getByText(/已提交 1 次/).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(require('node:os').tmpdir(), 'cognisync-homework-mobile.png') });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.screenshot({ path: path.join(require('node:os').tmpdir(), 'cognisync-homework-1280.png') });
    await page.getByRole('button', { name: '关闭作业与资料' }).click();
    await page.getByRole('button', { name: '运行', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="运行输出"]')?.textContent.trim() === '7', { timeout: 60000 });
    await page.locator('.cm-content').fill('print(19)');
    await page.waitForTimeout(1400);
    assert.ok(posts.some(p => p.kind === 'save' && p.code === 'print(19)'));
    const question = page.getByRole('textbox', { name: '向 AI 提问' });
    await question.fill('解释一下'); await question.press('Shift+Enter');
    assert.equal(posts.filter(p => p.kind === 'chat').length, 0);
    await question.press('Enter');
    await page.getByText('这句会输出 7。', { exact: true }).waitFor();
    assert.equal(posts.filter(p => p.kind === 'chat').length, 1);
    assert.equal(posts.at(-1).code, 'print(19)');
    assert.equal(posts.at(-1).last_run_code, 'print(7)');
    await page.reload(); await page.locator('.cm-content').waitFor();
    assert.equal(await page.locator('.cm-content').innerText(), 'print(19)');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(require('node:os').tmpdir(), 'cognisync-preparation-1280.png'), fullPage: true });
    const questions = [{ id: 'q1', type: 'choice', required: true, text: '遇到问题你先做什么？', options: [{ value: 'run', label: '看运行结果' }, { value: 'ai', label: '问 AI' }] }, { id: 'q2', type: 'text', required: true, text: '说说你的理由', options: [] }];
    classroom.prompt = { id: 'batch', question: questions[0], questions, title: '本课小结', served_at: new Date().toISOString() };
    await page.reload(); await page.locator('.cm-content').waitFor();
    assert.equal(await page.getByRole('dialog', { name: '课堂小问答' }).count(), 0, 'retired classroom prompts must not interrupt');
    pending = { id: 'batch', phase: 'pre', revision: 1, questions, served_at: new Date().toISOString() };
    await page.reload();
    await page.getByRole('region', { name: '课堂问卷' }).waitFor();
    assert.equal(await page.getByRole('button', { name: '下一题', exact: true }).isDisabled(), true);
    await page.getByLabel('看运行结果', { exact: true }).check();
    await page.getByRole('button', { name: '下一题', exact: true }).click();
    await page.getByLabel('你的回答', { exact: true }).fill('先检查结果再提问');
    await page.reload();
    await page.getByRole('region', { name: '课堂问卷' }).waitFor();
    assert.equal(await page.getByLabel('看运行结果', { exact: true }).isChecked(), true);
    await page.getByRole('button', { name: '下一题', exact: true }).click();
    assert.equal(await page.getByLabel('你的回答', { exact: true }).inputValue(), '先检查结果再提问');
    await page.screenshot({ path: path.join(require('node:os').tmpdir(), 'cognisync-classroom-set-student-1280.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(require('node:os').tmpdir(), 'cognisync-classroom-set-student-mobile.png') });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByRole('button', { name: '提交回答', exact: true }).click();
    await page.getByText('模拟提交失败，草稿保留', { exact: true }).waitFor();
    assert.equal(await page.getByRole('region', { name: '课堂问卷' }).isVisible(), true);
    await page.getByRole('button', { name: '提交回答', exact: true }).click();
    await page.getByRole('region', { name: '课堂问卷' }).waitFor({ state: 'detached' });
    await page.locator('.cm-content').waitFor();
    assert.equal(posts.filter(p => p.kind === 'assessment').length, 1);
    assert.equal(await page.locator('.cm-content').innerText(), 'print(19)');
    classroom = { ...classroom, lesson_entry: { task_id: 't', lesson_id: 'l', session_id: 's', title: '条件判断', group: 'ai_pbl' } };
    await page.getByRole('button', { name: '进入本课：条件判断' }).waitFor();
    classroom = { ...classroom, lesson_entry: null, session: { ...classroom.session, state: 'closed' } };
    await page.waitForFunction(() => document.querySelector('textarea')?.placeholder.includes('老师已关闭 AI'));
    assert.equal(await page.getByRole('button', { name: '发送问题' }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: '运行', exact: true }).isDisabled(), false);
    student = 'ui-student-b';
    await page.reload(); await page.locator('.cm-content').waitFor();
    assert.ok(!(await page.locator('.cm-content').innerText()).includes('19'));
    assert.equal(await page.getByText('解释一下', { exact: true }).count(), 0);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(require('node:os').tmpdir(), 'cognisync-preparation-mobile.png'), fullPage: true });
    assert.deepEqual(errors, []); assert.deepEqual(unknown, []);
    console.log(JSON.stringify({ passed: ['download-upload-explicit', 'upload-retry-same-id', 'submission-refresh', 'retired-prompts-hidden', 'initial-assessment-refresh-retry', 'failed-load-no-overwrite', 'remote-restore', 'real-browser-python-output', 'serialized-save', 'enter-send', 'shift-enter', 'refresh', 'teacher-entry', 'closed-ai-local-python', 'student-isolation', '1280-layout', '390-layout'], posts: posts.length }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
