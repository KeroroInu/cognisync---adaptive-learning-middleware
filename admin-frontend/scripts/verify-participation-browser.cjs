// Browser integration regression with synthetic API fixtures only. No production access.
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');

(async () => {
  const root = path.resolve(process.env.DIST_DIR || path.resolve(__dirname, '../dist'));
  const output = process.env.QA_DIR || await fs.mkdtemp(path.join(os.tmpdir(), 'sfls-participation-qa-'));
  await fs.mkdir(output, { recursive: true });
  const session = { id: 'fixture-session', class_name: '解构班', title: '当前任务', state: 'open', is_current: true, created_at: '2026-10-22T00:00:00Z' };
  const summary = { eligible_user_count: 56, download_user_count: 42, submission_user_count: 20, pending_user_count: 36, statistics_started_at: '2026-10-22T06:00:00Z', excluded_student_ids: ['1'] };
  const make = (id, lesson, visible, version = '2026-10-22.1') => ({ id, title: lesson === 1 ? '第1课 · AI 会写代码以后' : `第${lesson}课 · 完整贪吃蛇`, kind: 'sfls', created_at: '2026-10-22T00:00:00Z', closed_at: visible ? null : '2026-10-21T00:00:00Z', student_visible: visible, submission_count: 0, download_count: 0, participation: summary, configuration: { library: { version, lesson_number: lesson, slides_path: '/slides/fixture.html' }, task: '先说自己的想法，再尝试关键代码。', inherit_previous: lesson !== 1 } });
  const materials = [{ ...make('active', 1, true), submission_count: 40, download_count: 126 }, { ...make('old', 1, false, '2026-10-19.1'), submission_count: 4, download_count: 27 }, make('future', 2, false), make('old-future', 2, false, '2026-10-19.1'), make('later', 3, false)];
  const participants = Array.from({ length: 56 }, (_, index) => ({ user_id: `user-${index + 1}`, name: `学生${String(index + 1).padStart(2, '0')}`, student_id: `G2026${String(index + 1).padStart(4, '0')}`, school_class: '高一（1）班', download_count: index < 42 ? 3 : 0, submission_count: index < 20 ? 2 : 0, downloaded: index < 42, submitted: index < 20, last_downloaded_at: index < 42 ? '2026-10-22T06:01:00Z' : null, last_submitted_at: index < 20 ? '2026-10-22T06:02:00Z' : null, latest_submission_id: index < 20 ? '00000000-0000-4000-8000-000000000001' : null }));
  const fixtureBytes = Buffer.from('PK\x03\x04synthetic-archive-only');
  const receipt = { id: '00000000-0000-4000-8000-000000000001', kind: 'submission', name: '学生01', student_id: 'G20260001', created_at: '2026-10-22T05:00:00Z', size: fixtureBytes.length };
  const unexpected = [], pageErrors = [], consoleErrors = [], requests = [], aborted = [], visibilityActions = [];
  let firstParticipationFails = true, delayNext = false, materialReads = 0;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    await context.addInitScript(() => localStorage.setItem('auth_token', 'fixture-only'));
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url()), p = url.pathname;
      assert.equal(url.hostname, 'fixture.local', 'never contact a live server');
      const toggle = p.match(/^\/api\/admin\/classroom\/materials\/([^/]+)\/(open|close)$/);
      if (p !== '/api/admin/classroom/workspace' && !toggle) assert.equal(req.method(), 'GET', `unexpected fixture mutation: ${p}`);
      requests.push(p + url.search);
      const reply = data => route.fulfill({ json: { success: true, data } });
      if (p === '/api/admin/auth/me') return reply({ user: { id: 'fixture-teacher', name: '演示教师', role: 'admin' } });
      if (p === '/api/admin/classroom/workspace') return reply(session);
      if (p === '/api/admin/classroom/sessions') return reply([session]);
      if (p === '/api/admin/classroom/notices/sent') return reply([]);
      if (p.endsWith('/polls')) return reply({ total: 0, items: [] });
      if (p === '/api/admin/classroom/sessions/fixture-session/materials') { materialReads++; return reply(materials); }
      if (toggle) {
        assert.equal(req.method(), 'POST');
        const item = materials.find(material => material.id === toggle[1]);
        assert.ok(item, 'toggle must refer to a known synthetic material');
        visibilityActions.push(toggle.slice(1));
        item.student_visible = toggle[2] === 'open';
        item.closed_at = item.student_visible ? null : '2026-10-22T06:10:00Z';
        return reply(item);
      }
      if (/\/materials\/[^/]+\/participation$/.test(p)) {
        if (firstParticipationFails) { firstParticipationFails = false; return route.fulfill({ status: 503, json: { detail: '合成测试：首次加载失败' } }); }
        if (delayNext) { delayNext = false; await new Promise(resolve => setTimeout(resolve, 800)); }
        const status = url.searchParams.get('status'), offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 50);
        const filtered = participants.filter(item => status === 'pending' ? !item.submitted : status === 'submitted' ? item.submitted : status === 'not_downloaded' ? !item.downloaded : true);
        return reply({ total: filtered.length, summary, items: filtered.slice(offset, offset + limit) }).catch(() => {});
      }
      if (/\/materials\/[^/]+\/receipts$/.test(p)) return reply({ total: 1, submission_count: 4, download_count: 27, items: [receipt] });
      if (p === `/api/admin/classroom/receipts/${receipt.id}/file`) return route.fulfill({ contentType: 'application/zip', body: fixtureBytes });
      if (p === '/downloads/sfls/installers.json') return route.fulfill({ json: { files: [] } });
      if (p.startsWith('/api/')) { unexpected.push(req.method() + ' ' + p); return route.fulfill({ status: 500, json: { detail: 'Unexpected fixture API' } }); }
      const file = path.resolve(root, '.' + (p.startsWith('/admin/assets/') ? p.slice('/admin'.length) : '/index.html'));
      assert.ok(file.startsWith(root + path.sep));
      return route.fulfill({ contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html', body: await fs.readFile(file) });
    });
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('requestfailed', req => aborted.push({ url: req.url(), error: req.failure()?.errorText }));
    await page.goto('http://fixture.local/admin/classroom');
    const panel = page.getByRole('region', { name: '作业与资料', exact: true });
    const main = panel.getByRole('list', { name: '当前开放任务', exact: true });
    await main.getByRole('heading', { name: materials[0].title, exact: true }).waitFor();
    assert.equal(await main.locator('.lesson-material-card').count(), 1);
    assert.equal(await main.getByText('学生正在看', { exact: true }).count(), 1);
    await panel.getByText('历史任务与资料 · 2 个', { exact: true }).click();
    const history = panel.locator('.lesson-material-history').filter({ hasText: '历史任务与资料 · 2 个' });
    assert.equal(await history.locator('.lesson-material-card').count(), 2);
    await history.getByText('版本 2026-10-19.1', { exact: false }).first().waitFor();
    assert.equal(await history.getByRole('button', { name: '重新开放', exact: true }).count(), 2);
    await history.locator('summary').first().click();
    await panel.getByText('待发布任务库 · 2 个', { exact: true }).click();
    const library = panel.locator('.lesson-material-history').filter({ hasText: '待发布任务库 · 2 个' });
    assert.equal(await library.getByRole('button', { name: '发布给本班', exact: true }).count(), 2);
    await library.locator('summary').first().click();
    const card = main.locator('.lesson-material-card');
    await card.getByRole('button', { name: '未交 36 人', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '学生下载与提交', exact: true });
    await dialog.getByRole('alert').getByText('合成测试：首次加载失败', { exact: false }).waitFor();
    await dialog.getByRole('button', { name: '重试', exact: true }).click();
    await dialog.getByText('未交 36 人 · 第 1 / 1 页', { exact: true }).waitFor();
    assert.equal(await dialog.locator('tbody tr').count(), 36);
    assert.equal(await dialog.getByText('未下载', { exact: true }).count(), 15); // 14 rows + filter
    assert.equal(await dialog.getByText('学生56', { exact: true }).count(), 1);
    await dialog.getByRole('button', { name: '全部', exact: true }).click();
    await dialog.getByText('全部 56 人 · 第 1 / 2 页', { exact: true }).waitFor();
    assert.equal(await dialog.locator('tbody tr').count(), 50);
    await dialog.getByRole('button', { name: '下一页', exact: true }).click();
    await dialog.getByText('全部 56 人 · 第 2 / 2 页', { exact: true }).waitFor();
    assert.equal(await dialog.locator('tbody tr').count(), 6);
    await dialog.getByRole('button', { name: '上一页', exact: true }).click();
    await dialog.getByText('全部 56 人 · 第 1 / 2 页', { exact: true }).waitFor();
    await dialog.getByRole('button', { name: '已交', exact: true }).click();
    await dialog.getByText('已交 20 人 · 第 1 / 1 页', { exact: true }).waitFor();
    assert.equal(await dialog.locator('tbody tr').count(), 20);
    const recentDownloadPromise = page.waitForEvent('download');
    await dialog.getByRole('button', { name: '下载最近作品', exact: true }).first().click();
    const recentDownload = await recentDownloadPromise;
    assert.deepEqual(await fs.readFile(await recentDownload.path()), fixtureBytes);
    assert.ok(recentDownload.suggestedFilename().startsWith('G20260001_学生01_'));
    await dialog.getByRole('button', { name: '未下载', exact: true }).click();
    await dialog.getByText('未下载 14 人 · 第 1 / 1 页', { exact: true }).waitFor();
    assert.equal(await dialog.locator('tbody tr').count(), 14);
    await dialog.getByRole('button', { name: '全部', exact: true }).click();
    await dialog.getByText('全部 56 人 · 第 1 / 2 页', { exact: true }).waitFor();
    await dialog.locator('button').first().focus();
    await page.keyboard.press('Shift+Tab');
    assert.equal(await dialog.getByRole('button', { name: '下一页', exact: true }).evaluate(el => document.activeElement === el), true);
    await page.keyboard.press('Tab');
    assert.equal(await dialog.getByRole('button', { name: '关闭学生名单', exact: true }).evaluate(el => document.activeElement === el), true);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    assert.equal(await card.getByRole('button', { name: '未交 36 人', exact: true }).evaluate(el => document.activeElement === el), true);
    await card.getByRole('button', { name: '全部版本记录', exact: true }).click();
    const receipts = page.getByRole('dialog', { name: '全部版本记录', exact: true });
    await receipts.getByText('学生01 · G20260001', { exact: true }).waitFor();
    const rawDownloadPromise = page.waitForEvent('download');
    await receipts.getByRole('button', { name: '下载原件', exact: true }).click();
    assert.deepEqual(await fs.readFile(await (await rawDownloadPromise).path()), fixtureBytes);
    await page.keyboard.press('Escape');
    await receipts.waitFor({ state: 'detached' });
    const oldReads = materialReads;
    await panel.getByRole('button', { name: '刷新人数', exact: true }).click();
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(el => el.textContent === '刷新人数')?.disabled);
    assert.ok(materialReads > oldReads);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(t => document.documentElement.dataset.theme = t, theme);
      for (const width of [375, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        const overflow = await panel.evaluate(el => [...el.querySelectorAll('.lesson-material-card h3,.lesson-action,.lesson-material-heading,.lesson-material-meta')].filter(x => { const r = x.getBoundingClientRect(); return r.width > 0 && (r.left < 0 || r.right > innerWidth + 1); }).map(x => x.textContent));
        assert.deepEqual(overflow, [], `${theme}/${width}: card stays within viewport`);
        await panel.screenshot({ path: path.join(output, `participation-tasks-${theme}-${width}.png`) });
        await card.getByRole('button', { name: '未交 36 人', exact: true }).click();
        await dialog.getByText('未交 36 人 · 第 1 / 1 页', { exact: true }).waitFor();
        const bounds = await dialog.boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1, `${theme}/${width}: dialog stays in viewport`);
        const rowOverflow = await dialog.evaluate(el => el.scrollWidth > el.clientWidth + 1);
        assert.equal(rowOverflow, false, `${theme}/${width}: table scroll is contained`);
        await page.screenshot({ path: path.join(output, `participation-dialog-${theme}-${width}.png`) });
        await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
      }
    }
    delayNext = true;
    await card.getByRole('button', { name: '查看学生名单', exact: true }).click();
    await dialog.getByRole('status').waitFor();
    await dialog.getByRole('button', { name: '关闭学生名单', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.waitForTimeout(1000);
    assert.ok(aborted.some(item => item.url.includes('/participation?') && item.error?.includes('ABORTED')), 'closing cancels the pending request');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await card.getByRole('button', { name: '收起任务', exact: true }).click();
    await panel.getByText('当前没有向学生开放的任务。', { exact: true }).waitFor();
    assert.equal(await main.locator('.lesson-material-card').count(), 0);
    await panel.getByText('历史任务与资料 · 3 个', { exact: true }).click();
    const closedCurrent = panel.locator('.lesson-material-card.is-history').filter({ hasText: '版本 2026-10-22.1' });
    assert.equal(await closedCurrent.count(), 1);
    await closedCurrent.getByText('共收 40 份 · 下载 126 次', { exact: true }).waitFor();
    await closedCurrent.getByRole('button', { name: '重新开放', exact: true }).click();
    await main.getByText('学生正在看', { exact: true }).waitFor();
    assert.equal(await main.locator('.lesson-material-card').count(), 1);
    assert.deepEqual(visibilityActions, [['active', 'close'], ['active', 'open']]);
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(unexpected, []);
    const unplannedConsole = consoleErrors.filter(message => !message.includes('503 (Service Unavailable)'));
    assert.deepEqual(unplannedConsole, []);
    const result = { status: 'PASS', output, realServerWrites: 0, participantRequests: requests.filter(x => x.includes('/participation?')).length, materialReads, intentional503: 1, browserRuntimeErrors: pageErrors, unexpectedApi: unexpected, abortedRequests: aborted.length, syntheticVisibilityActions: visibilityActions };
    await fs.writeFile(path.join(output, 'participation-browser-result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
