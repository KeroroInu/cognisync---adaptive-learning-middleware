/* Real Chrome, synthetic API only. Never reads or changes production data.
 * Run against a local Vite server:
 * PLAYWRIGHT_PACKAGE=/absolute/path/to/playwright node scripts/verify-assessment-library-browser.cjs
 */
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const target = new URL(process.env.ASSESSMENT_QA_URL || 'http://127.0.0.1:5178/assessments');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) {
  throw new Error('QA target must be a loopback host; production testing is prohibited.');
}
const fixturePath = process.env.ASSESSMENT_QA_FIXTURES;
const tinyQuestions = [{ id: 'qa1', text: '请描述你的实现思路。', type: 'text', required: false, options: [] }];
const clone = value => JSON.parse(JSON.stringify(value));

async function repositoryFixtures() {
  const resources = path.resolve(__dirname, '../../backend/app/resources');
  const [drafts, papers, selfReport] = await Promise.all(['instrument_drafts_20261012.json', 'python_papers_20261015.json', 'cps_programming_self_report_20261023.json']
    .map(async file => JSON.parse(await fs.readFile(path.join(resources, file), 'utf8'))));
  const draft = (catalog, key) => {
    const instrument = catalog.instruments.find(item => item.key === key);
    assert.ok(instrument?.draft, `repository catalog must contain ${key}`);
    return clone(instrument.draft);
  };
  const templates = [draft(drafts, 'background'), draft(drafts, 'ct_pre'), draft(drafts, 'cps_pre'), draft(papers, 'knowledge_a'), draft(papers, 'knowledge_b'), draft(selfReport, 'cps12_20261023')];
  const result = templates.map((item, index) => ({ ...item, id: `library-${index}`, enabled: false, published_at: null, revision: 1, response_count: 0 }));
  // Only definitions come from repository resources; all publications and counts below are synthetic.
  result.push({ ...clone(templates[0]), id: 'open', class_name: '解构班', enabled: true, published_at: '2026-10-22T07:20:00Z', revision: 1, response_count: 34 });
  result.push({ ...clone(templates[1]), id: 'closed', class_name: '解构班', enabled: false, published_at: '2026-10-20T07:20:00Z', revision: 1, response_count: 35 });
  return result;
}

(async () => {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'assessment-library-qa-'));
  let source;
  try { source = fixturePath ? JSON.parse(await fs.readFile(fixturePath, 'utf8')) : await repositoryFixtures(); }
  catch (error) { throw new Error(`Cannot load isolated assessment fixtures: ${error.message}`); }
  assert.ok(Array.isArray(source), 'fixture file must contain an assessment array');
  const rounds = clone(source);
  rounds.push({ id: 'custom', name: '课堂互动自定义题本', phase: 'pre', class_name: '', source: '浏览器验收用自定义题本', questions: clone(tinyQuestions), published_at: null, enabled: false, revision: 1, response_count: 0 });
  rounds.push({ id: 'other-history', name: '开发班专用历史', phase: 'pre', class_name: '开发班', source: '浏览器隔离数据', questions: clone(tinyQuestions), published_at: '2026-10-20T08:00:00Z', enabled: false, revision: 1, response_count: 7 });
  const before = clone(rounds);
  const pythonA = rounds.find(item => /Python.*A.*卷/.test(item.name) && !item.published_at);
  const cps = rounds.find(item => item.source.includes('题本代码：cps_') && !item.published_at);
  const cps12 = rounds.find(item => item.source.includes('题本代码：cps12_20261023') && !item.published_at);
  assert.ok(pythonA && cps && cps12, 'fixtures need a Python A paper, withheld old CPS draft, and confirmed CPS12');
  const writes = [], deliveries = [], exports = [], apiErrors = [], pageErrors = [], external = [], checks = [], screenshots = [];
  let failFirstDelivery = true;
  let failFirstSave = true;
  const idempotent = new Map();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => pageErrors.push(error.message));
  await context.addInitScript(() => {
    localStorage.setItem('auth_token', 'isolated-assessment-qa-token');
    localStorage.setItem('cognisync-admin-theme', 'light');
    localStorage.setItem('cognisync-admin-theme-version', 'terminal-v2');
    // Exercise the HTTP compatibility path, even though loopback Chrome is secure.
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined });
  });
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== target.origin) {
      external.push({ url: url.toString(), method: req.method() });
      return route.abort('blockedbyclient');
    }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const p = url.pathname, method = req.method();
    const json = data => route.fulfill({ status: 200, json: { success: true, data: clone(data) } });
    const error = (status, detail) => route.fulfill({ status, json: { detail } });
    if (p.endsWith('/auth/me')) return json({ user: { id: 'teacher-fixture', name: '验收老师', role: 'admin' }, profile: null });
    if (p === '/api/admin/assessments' && method === 'GET') return json(rounds);
    if (p === '/api/admin/assessments' && method === 'POST') {
      const body = req.postDataJSON();
      writes.push({ path: p, method, body });
      if (failFirstSave) { failFirstSave = false; return error(422, '模拟校验失败；请核对题本后重试'); }
      const item = { ...clone(body), id: `draft-${writes.length}`, enabled: false, published_at: null, revision: 3, response_count: 0 };
      rounds.unshift(item);
      return json(item);
    }
    const match = p.match(/^\/api\/admin\/assessments\/([^/]+)(?:\/(distribute|availability|export|definition))?$/);
    if (match) {
      const item = rounds.find(r => r.id === match[1]);
      if (!item) return error(404, '找不到这份题本');
      if (match[2] === 'distribute' && method === 'POST') {
        const body = req.postDataJSON();
        deliveries.push({ source: item.id, ...clone(body) });
        writes.push({ path: p, method, body });
        assert.ok(['解构班', '开发班', '体验组'].includes(body.class_name));
        assert.match(body.request_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
        if (failFirstDelivery) { failFirstDelivery = false; return error(503, '模拟网络失败，请重试'); }
        const key = `${item.id}:${body.class_name}:${body.request_id}`;
        if (idempotent.has(key)) return json(idempotent.get(key));
        rounds.filter(r => r.class_name === body.class_name && r.enabled).forEach(r => { r.enabled = false; });
        const delivered = { ...clone(item), id: `delivery-${deliveries.length}`, class_name: body.class_name, enabled: true, published_at: new Date().toISOString(), revision: item.revision + 1, response_count: 0 };
        rounds.unshift(delivered);
        idempotent.set(key, delivered);
        return json(delivered);
      }
      if (match[2] === 'availability' && method === 'POST') {
        const body = req.postDataJSON();
        writes.push({ path: p, method, body });
        assert.equal(body.enabled, false, 'the UI must not silently reopen a past delivery');
        item.enabled = false;
        return json(item);
      }
      if (['export', 'definition'].includes(match[2]) && method === 'GET') {
        exports.push({ id: item.id, kind: match[2] });
        return route.fulfill({ status: 200, contentType: match[2] === 'export' ? 'text/csv; charset=utf-8' : 'application/json', body: match[2] === 'export' ? '\ufeffround_id,response_count\n' + item.id + ',' + item.response_count + '\n' : JSON.stringify(item) });
      }
      if (!match[2] && method === 'PUT') {
        const body = req.postDataJSON();
        writes.push({ path: p, method, body });
        if (item.published_at) return error(409, '已开放的题本不能改写，请另存新版');
        Object.assign(item, clone(body));
        return json(item);
      }
    }
    apiErrors.push({ path: p, method });
    return error(500, 'QA fixture does not allow this API');
  });

  const library = () => page.getByRole('region', { name: '可发放题本', exact: true });
  const sidebar = () => page.getByRole('complementary', { name: '本班发放记录', exact: true });
  const readyCards = () => library().locator('.assessment-library-list > article');
  const paper = () => readyCards().filter({ hasText: pythonA.name });
  const selectClass = async name => {
    await page.getByRole('navigation', { name: '发放班级', exact: true }).getByRole('button', { name, exact: true }).click();
    await page.getByRole('navigation', { name: '发放班级', exact: true }).getByRole('button', { name, exact: true }).getAttribute('aria-pressed').then(value => assert.equal(value, 'true'));
  };
  const summary = (scope, text) => scope.locator('summary').filter({ hasText: text });
  const capture = async name => {
    await page.mouse.move(1, 1);
    await page.evaluate(() => {
      for (const animation of document.getAnimations()) {
        if (animation.effect?.getTiming().iterations === Infinity) continue;
        try { animation.finish(); } catch { /* Unsupported animation is irrelevant to the screenshot. */ }
      }
    });
    const file = path.join(output, `${name}.png`);
    await page.screenshot({ path: file, fullPage: true }); screenshots.push(file);
  };
  const assertNoOverflow = async label => {
    const result = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, overflowing: [...document.querySelectorAll('.assessment-admin, .assessment-overlay, .assessment-editor, .assessment-confirm')].map(el => ({ className: el.className, right: el.getBoundingClientRect().right, left: el.getBoundingClientRect().left })).filter(r => r.left < -1 || r.right > innerWidth + 1) }));
    assert.ok(result.scroll <= result.width + 1, `${label}: document overflows ${JSON.stringify(result)}`);
    assert.deepEqual(result.overflowing, [], `${label}: assessment region escapes viewport`);
  };
  const report = { status: 'RUNNING', target: target.href, output, checks, screenshots, writes, deliveries, exports, apiErrors, pageErrors, external };
  try {
    await page.goto(target.href);
    await page.getByRole('heading', { name: '题本库', exact: true }).waitFor();
    await readyCards().first().waitFor();
    assert.equal(await page.getByRole('heading', { name: '首次填写', exact: true }).count(), 0);
    assert.equal(await page.getByRole('heading', { name: '课后填写', exact: true }).count(), 0);
    const searchable = page.getByRole('searchbox', { name: '搜索题本', exact: true });
    await searchable.fill('Python');
    assert.equal(await readyCards().count(), 2);
    await searchable.fill('不存在的题本QA');
    assert.equal(await readyCards().count(), 0);
    assert.ok((await library().innerText()).includes('没有'));
    await searchable.fill('');
    const categories = page.getByRole('navigation', { name: '题本分类', exact: true });
    for (const [category, count] of [['试卷', 2], ['问卷', 1], ['量表', 2], ['其他', 1]]) {
      await categories.getByRole('button', { name: category, exact: true }).click();
      assert.equal(await readyCards().count(), count, `${category} count`);
    }
    await categories.getByRole('button', { name: '全部', exact: true }).click();
    assert.equal(await readyCards().filter({ hasText: cps.name }).count(), 0, 'CPS review draft must never appear in releasable library');
    const reviewSummary = page.locator('summary').filter({ hasText: '待审阅' });
    await reviewSummary.click();
    const cpsCard = page.locator('article').filter({ hasText: cps.name });
    await cpsCard.waitFor();
    assert.equal(await cpsCard.getByRole('button', { name: /发给/ }).count(), 0);
    assert.equal(await page.locator('.assessment-review article').filter({ hasText: cps12.name }).count(), 0);
    await reviewSummary.click();
    checks.push('search, all four categories, empty state, and CPS withheld from shortcut delivery');

    await categories.getByRole('button', { name: '量表', exact: true }).click();
    const confirmedCpsCard = readyCards().filter({ hasText: cps12.name });
    assert.equal(await confirmedCpsCard.count(), 1);
    assert.equal(await confirmedCpsCard.getByRole('button', { name: '发给解构班', exact: true }).count(), 1);
    const writesBeforeCpsPreview = writes.length;
    await confirmedCpsCard.getByRole('button', { name: '预览题目', exact: true }).click();
    const cpsDialog = page.getByRole('dialog', { name: '试填预览', exact: true });
    await cpsDialog.waitFor();
    assert.equal(await cpsDialog.locator('.assessment-preserve-text').innerText(), cps12.questions[0].hint);
    await capture('cps12-preview-first-page');
    const uniformLabels = ['非常不同意', '不同意', '中立', '同意', '非常同意'];
    assert.equal(cps12.questions.length, 12);
    for (let index = 0; index < 12; index += 1) {
      assert.equal(await cpsDialog.getByRole('heading', { level: 3 }).innerText(), cps12.questions[index].text);
      assert.ok((await cpsDialog.innerText()).includes(`${index + 1} / 12`));
      assert.equal(await cpsDialog.getByRole('radio').count(), 5);
      assert.deepEqual(await cpsDialog.locator('fieldset label').allInnerTexts(), uniformLabels);
      await cpsDialog.getByRole('radio').nth(index % 5).check();
      if (index < 11) await cpsDialog.getByRole('button', { name: '下一题', exact: true }).click();
    }
    await cpsDialog.getByRole('button', { name: '关闭预览', exact: true }).click();
    assert.equal(writes.length, writesBeforeCpsPreview);
    await categories.getByRole('button', { name: '全部', exact: true }).click();
    checks.push('confirmed CPS12 is releasable under scales, not review-only; all 12 preview pages retain exact questions and five uniform labels');

    assert.ok((await sidebar().innerText()).includes('34'));
    assert.equal(await sidebar().getByText('开发班专用历史', { exact: true }).count(), 0);
    await selectClass('开发班');
    assert.ok((await sidebar().innerText()).includes('已结束'));
    assert.equal(await sidebar().getByText(before.find(r => r.id === 'open').name, { exact: true }).count(), 0);
    await summary(sidebar(), '已结束').click();
    await sidebar().getByText('开发班专用历史', { exact: true }).waitFor();
    await selectClass('体验组');
    assert.equal(await sidebar().getByText('开发班专用历史', { exact: true }).count(), 0);
    assert.equal(await sidebar().getByRole('button', { name: '结束填写', exact: true }).count(), 0);
    await selectClass('解构班');
    checks.push('three explicit teaching groups with independent current/history records');
    await capture('current-delivery-1280-light');

    const writesBeforePreview = writes.length;
    await paper().getByRole('button', { name: '预览题目', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: '试填预览', exact: true });
    await dialog.waitFor();
    assert.equal(await dialog.locator('pre code').innerText(), pythonA.questions[0].code);
    await dialog.getByRole('radio').first().check();
    await dialog.getByRole('button', { name: '下一题', exact: true }).click();
    await dialog.getByRole('button', { name: '上一题', exact: true }).click();
    assert.equal(await dialog.getByRole('radio').first().isChecked(), true);
    await dialog.getByRole('button', { name: '关闭预览', exact: true }).click();
    assert.equal(writes.length, writesBeforePreview, 'preview may not create or submit any record');
    checks.push('preview code indentation, in-memory answers, no API writes');

    await paper().getByRole('button', { name: '发给解构班', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '发给解构班？', exact: true });
    await dialog.waitFor();
    assert.ok((await dialog.innerText()).includes('结束'));
    // Even a background keyboard/programmatic state change must not retarget an open confirmation.
    await page.getByRole('navigation', { name: '发放班级', exact: true }).getByRole('button', { name: '开发班', exact: true }).evaluate(el => el.click());
    assert.equal(await dialog.count(), 1, 'confirmation must retain its captured class');
    await dialog.getByRole('button', { name: '确认发放', exact: true }).click();
    await dialog.getByRole('alert').waitFor();
    await dialog.getByRole('button', { name: '确认发放', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(deliveries.length, 2);
    assert.equal(deliveries[0].class_name, '解构班');
    assert.equal(deliveries[1].class_name, '解构班');
    assert.equal(deliveries[0].request_id, deliveries[1].request_id);
    await selectClass('解构班');
    await paper().getByRole('button', { name: '发给解构班', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '发给解构班？', exact: true });
    await dialog.getByRole('button', { name: '确认发放', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(deliveries.length, 3);
    assert.notEqual(deliveries[2].request_id, deliveries[1].request_id, 'intentional new delivery must get a new identity');
    checks.push('captured confirmation class, failed-request retry keeps ID, next intentional delivery uses a fresh ID');

    const availabilityBefore = writes.filter(item => item.path.endsWith('/availability')).length;
    await sidebar().getByRole('button', { name: '结束填写', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '结束填写？', exact: true });
    await dialog.waitFor();
    assert.equal(writes.filter(item => item.path.endsWith('/availability')).length, availabilityBefore);
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(writes.filter(item => item.path.endsWith('/availability')).length, availabilityBefore);
    await sidebar().getByRole('button', { name: '结束填写', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '结束填写？', exact: true });
    await dialog.getByRole('button', { name: '确认结束', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(writes.filter(item => item.path.endsWith('/availability')).length, availabilityBefore + 1);
    await summary(sidebar(), '已结束').evaluate(el => { if (!el.parentElement.open) el.click(); });
    const oldRound = sidebar().locator('article').filter({ hasText: before.find(r => r.id === 'closed').name });
    await oldRound.waitFor();
    const downloadPromise = page.waitForEvent('download');
    await oldRound.getByRole('button', { name: /导出.*CSV/ }).click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /\.csv$/);
    await download.saveAs(path.join(output, 'fixture-answers.csv'));
    assert.deepEqual(exports.at(-1), { id: 'closed', kind: 'export' });
    checks.push('ending requires confirmation; cancel is read-only; history CSV exports the selected immutable round');

    const originalForEdit = before.find(r => r.id === 'open');
    const publishedForEdit = sidebar().locator('article').filter({ hasText: originalForEdit.name });
    await summary(publishedForEdit, '更多').click();
    await publishedForEdit.getByRole('button', { name: '修改为新版', exact: true }).click();
    dialog = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: '保存草稿', exact: true }) });
    await dialog.waitFor();
    const titleInput = dialog.getByLabel('教师看到的名称', { exact: true });
    await titleInput.fill('浏览器验收 · 另存新版');
    await dialog.getByRole('button', { name: '保存草稿', exact: true }).click();
    await dialog.getByRole('alert').waitFor();
    assert.equal(await titleInput.inputValue(), '浏览器验收 · 另存新版', 'failed save must retain the edited draft');
    await dialog.getByRole('button', { name: '保存草稿', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    const saved = writes.find(item => item.path === '/api/admin/assessments' && item.method === 'POST');
    assert.ok(saved, 'editing a published round must POST a new draft');
    assert.equal(saved.body.name, '浏览器验收 · 另存新版');
    assert.deepEqual(saved.body.questions, originalForEdit.questions);
    assert.equal(writes.filter(item => item.method === 'PUT' && item.path.endsWith('/open')).length, 0);
    for (const original of before) {
      const current = rounds.find(item => item.id === original.id);
      assert.equal(current.response_count, original.response_count);
      assert.equal(current.class_name, original.class_name);
      assert.deepEqual(current.questions, original.questions);
    }
    checks.push('failed save keeps draft; published edits create new drafts with branching / child / exclusive fields intact; originals remain unchanged');

    const copyStart = writes.length;
    const confirmedCpsSource = readyCards().filter({ hasText: cps12.name });
    await summary(confirmedCpsSource, '更多').click();
    await confirmedCpsSource.getByRole('button', { name: '复制', exact: true }).click();
    dialog = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: '保存草稿', exact: true }) });
    await dialog.waitFor();
    await summary(dialog, '数据标记').click();
    const phaseField = dialog.getByRole('combobox', { name: '测量阶段', exact: true });
    assert.equal(await phaseField.isEnabled(), true);
    assert.equal(await phaseField.inputValue(), 'pre');
    await phaseField.selectOption('post');
    await dialog.getByRole('button', { name: '保存草稿', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    const savedCpsPost = writes.slice(copyStart).find(item => item.path === '/api/admin/assessments' && item.method === 'POST');
    assert.ok(savedCpsPost);
    assert.equal(savedCpsPost.body.phase, 'post');
    assert.equal(savedCpsPost.body.name, cps12.name);
    assert.deepEqual(savedCpsPost.body.questions, cps12.questions);
    assert.equal(rounds.find(item => item.id === cps12.id).phase, 'pre');
    assert.deepEqual(rounds.find(item => item.id === cps12.id).questions, cps12.questions);
    checks.push('copy CPS12 with post marker saves a new POST definition while keeping all questions/options and original pre draft unchanged');

    // Every group can deliberately receive the selected library item.
    for (const className of ['开发班', '体验组']) {
      await selectClass(className);
      await paper().getByRole('button', { name: `发给${className}`, exact: true }).click();
      dialog = page.getByRole('dialog', { name: `发给${className}？`, exact: true });
      await dialog.getByRole('button', { name: '确认发放', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(deliveries.at(-1).class_name, className);
    }
    checks.push('explicit independent delivery works for both development and experience groups');

    await selectClass('解构班');
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => {
          document.documentElement.dataset.theme = theme;
          document.documentElement.classList.toggle('dark', theme === 'dark');
        }, theme);
        await assertNoOverflow(`${width}-${theme}`);
        await capture(`library-${width}-${theme}`);
      }
    }
    await page.setViewportSize({ width: 375, height: 844 });
    await paper().getByRole('button', { name: '预览题目', exact: true }).click();
    await assertNoOverflow('mobile preview');
    await capture('mobile-preview');
    await page.getByRole('button', { name: '关闭预览', exact: true }).click();
    await paper().getByRole('button', { name: '发给解构班', exact: true }).click();
    await assertNoOverflow('mobile confirmation');
    await capture('mobile-confirmation');
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '自定义题本', exact: true }).click();
    await assertNoOverflow('mobile editor');
    await capture('mobile-editor');
    await page.getByRole('dialog').getByLabel('教师看到的名称', { exact: true }).fill('尚未保存的题本');
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('button', { name: '关闭编辑', exact: true }).click();
    assert.equal(await page.getByRole('dialog').getByLabel('教师看到的名称', { exact: true }).inputValue(), '尚未保存的题本');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '关闭编辑', exact: true }).click();
    assert.equal(await page.getByRole('dialog').count(), 0);
    checks.push('unsaved changes require explicit discard and cancel retains the draft');
    checks.push('375 / 768 / 1280 light and dark layouts, mobile preview / confirmation / editor stay within viewport');
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(apiErrors, []);
    assert.deepEqual(external, []);
    report.status = 'PASS';
  } catch (error) {
    report.status = 'FAIL'; report.error = error.stack || String(error);
    await capture('failure').catch(() => {});
    await fs.writeFile(path.join(output, 'failure-page.txt'), await page.locator('body').innerText().catch(() => 'unavailable'));
    process.exitCode = 1;
  } finally {
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, output, checks, error: report.error || null }, null, 2));
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
