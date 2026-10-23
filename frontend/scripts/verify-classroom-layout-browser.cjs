const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../dist');
const probe = process.env.PROBE === '1';
const discussionMode = process.env.FUNCTION_DISCUSSION === '1';
const referenceMode = process.env.FUNCTION_REFERENCE === '1';
const darkAudit = process.env.DARK_THEME === '1';
const commonMode = process.env.COMMON_SUPPORT === '1';
(async () => {
 const browser = await chromium.launch({ channel: 'chrome', headless: true });
 try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  if (darkAudit) await context.addInitScript(() => { localStorage.setItem('cognisync-theme', 'dark'); localStorage.setItem('cognisync-theme-version', 'terminal-v2'); });
  await context.addInitScript(() => {
    window.gameCommands = [];
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(message, ...args) {
      if (message.source?.includes('_game_bundle_source')) window.gameCommands.push({ time: performance.now(), reset: message.source.includes('if "reset" ==') });
      return post.call(this, message, ...args);
    };
  });
  const texts = ['转向后蛇改变方向', '蛇向前走一格', '食物不在蛇身上', '吃到食物得分加十', '碰墙游戏结束', '重开后得分为零'];
  const code = {
    'initial-state': "def create_initial_state():\n    return [(6,5),(5,5),(4,5)], 'right', 0",
    movement: 'def move_snake(snake, direction):\n    x, y = snake[0]\n    return [((x + 1) % 12, y)] + snake[:-1]',
  };
  let workspace = { version: 1, savedAt: new Date().toISOString(), evidence: [{ id: 'run', type: 'started', timestamp: new Date().toISOString() }], observations: texts.map((text, i) => ({ id: `c${i}`, evidenceId: 'run', evidenceText: '开始游戏', observationText: text, source: 'student', createdAt: new Date().toISOString() })), functions: texts.map((text, i) => ({ id: `f${i}`, observationId: `c${i}`, observationText: text, responsibility: text, implementation: '先读取状态，再判断条件，最后更新结果。', createdAt: new Date().toISOString() })), path: { orderedCardIds: [], prerequisites: {}, relationKinds: {}, functionMechanisms: {} }, progress: Object.fromEntries(Object.entries(code).map(([id, source]) => [`base::${id}`, { cardId: id, blueprintNodeId: id, code: source, verified: true }])) };
  let group = 'pdt';
  if (referenceMode) workspace.path.functionMechanisms = Object.fromEntries(workspace.functions.map(card => [card.id, {
    flowNodes: ['start','process','end'].map((kind,i) => ({id:`n${i}`,kind,label:kind,position:{x:100+i*200,y:100}})),
    diagramEdges: [{id:'e1',sourceId:'n0',targetId:'n1'},{id:'e2',sourceId:'n1',targetId:'n2'}],
  }]));
  const errors = [], unknown = [];
  const chats = [], events = [];
  const supportStates = new Map();
  const supportState = focus => {
    const key = `${group}:${focus || 'workspace'}`;
    if (!supportStates.has(key)) supportStates.set(key, { level: 0, paused: false, history: [], practice_available: true });
    return supportStates.get(key);
  };
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await context.route('**/*', async route => {
    const pathname = new URL(route.request().url()).pathname;
    const json = data => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
    if (pathname === '/api/learning-support/state') return json(supportState(new URL(route.request().url()).searchParams.get('focus')));
    if (pathname === '/api/project-review/current') return json(null);
    if (commonMode && pathname === '/api/chat') {
      const body = route.request().postDataJSON(); chats.push(body);
      const state = supportState(body.scaffoldContext?.currentModule);
      const action = body.supportAction || 'message';
      if (action === 'more') state.level = Math.min(2, state.level + 1);
      if (action === 'complete') state.level = 3;
      if (action === 'try_self') state.paused = true;
      if (action === 'restore') state.paused = false;
      if (action === 'practice') state.practice = { instance_id:'p1', question:'几个元素？', code:'items = [1, 2]', options:['1','2'] };
      if (action === 'answer' || action === 'show_answer') state.practice.answered = true;
      if (action === 'return_project') state.practice = null;
      const reply = `收到 ${action}`;
      state.history.push({ id:String(chats.length), question:body.message, reply, status:'answered' });
      return json({ message:reply, updatedProfile:null, support:state });
    }
    if (pathname === '/api/auth/me') return json({ user: { id: 'ui-layout', name: '测试同学', experimentGroup: group, hasCompletedOnboarding: true }, profile: null });
    if (pathname === '/api/assessments/pending') return json(null);
    if (pathname === '/api/classroom/state') return json({ session: { id: 's', title: '课堂', state: 'open', class_name: '解构班' }, lesson_entry: { task_id: 't', lesson_id: 'l', session_id: 's', title: '课堂', group } });
    if (pathname === '/api/materials' || pathname === '/api/preparation/records') return json([]);
    if (pathname === '/api/research/active-task') return json({ id: 't', title: '贪吃蛇', language:'python', code_content: '', workspace_data: workspace, is_completed: false });
    if (pathname.endsWith('/save-workspace')) { workspace = route.request().postDataJSON().workspace_data; return json({}); }
    if (discussionMode && pathname === '/api/chat') {
      const body = route.request().postDataJSON(); chats.push(body);
      if (body.message === '测试失败恢复') return route.fulfill({ status:503, contentType:'application/json', body:JSON.stringify({ detail:'暂时没连上' }) });
      return json({ message: body.supportAction !== 'organize' ? '吃到以后，分数应该怎么变？' : '按你刚才说的整理好了，可以改一改。\n```steps\n如果蛇头碰到食物：\n    蛇身增加一格\n    分数增加10\n```', updatedProfile:null });
    }
    if (pathname.endsWith('/stage-events')) { const body = route.request().postDataJSON(); events.push(body); return json({ event_id:'event-test', replayed:false }); }
    if (pathname.startsWith('/api/')) { unknown.push(pathname); return route.fulfill({ status: 404, body: '{}' }); }
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : decodeURIComponent(pathname)));
    if (!file.startsWith(root + '/')) return route.abort();
    try { return route.fulfill({ body: await fs.readFile(file), contentType: ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.zip': 'application/zip' })[path.extname(file)] || 'application/octet-stream' }); }
    catch { return route.fulfill({ status: 404, body: 'not found' }); }
  });
  const contrastIssues = [];
  const auditContrast = async name => {
    if (!darkAudit || !await page.locator('.project-factory').count()) return;
    const issues = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d');
      const rgba = color => { ctx.clearRect(0,0,1,1); ctx.fillStyle=color; ctx.fillRect(0,0,1,1); return [...ctx.getImageData(0,0,1,1).data]; };
      const blend = (a,b) => a.slice(0,3).map((c,i)=>c*a[3]/255+b[i]*(1-a[3]/255));
      const background = el => { if (!el) return [17,18,15]; const c=rgba(getComputedStyle(el).backgroundColor); return c[3]===255 ? c.slice(0,3) : blend(c,background(el.parentElement)); };
      const luminance = rgb => rgb.map(c=>{ c/=255; return c<=.04045?c/12.92:((c+.055)/1.055)**2.4; }).reduce((s,c,i)=>s+c*[.2126,.7152,.0722][i],0);
      return [...document.querySelectorAll('.project-factory button, .project-factory input, .project-factory textarea, .project-factory p, .project-factory small, .project-factory label, .project-factory dt, .project-factory span')].flatMap(el=>{
        const s=getComputedStyle(el), box=el.getBoundingClientRect();
        if (!el.checkVisibility({visibilityProperty:true})||!box.width||!box.height||box.bottom<0||box.top>innerHeight||s.visibility==='hidden'||el.closest('[disabled], .cm-editor, .construction-board, .companion-fluid')) return [];
        const text=[...el.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent.trim()).join(' ') || (el.matches('input,textarea')?el.value:'');
        if (!text || Number(s.opacity)<1) return [];
        const bg=background(el), fg=blend(rgba(s.color),bg), a=luminance(fg), b=luminance(bg), ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
        const min=parseFloat(s.fontSize)>=24||(parseFloat(s.fontSize)>=18.66&&parseInt(s.fontWeight)>=700)?3:4.5;
        return ratio+.05<min ? [{text:text.slice(0,55),class:el.className,ratio:ratio.toFixed(2)}] : [];
      });
    });
    contrastIssues.push(...issues.map(issue=>({screen:name,...issue})));
  };
  const screenshot = async name => { await page.waitForTimeout(350); await auditContrast(name); return page.screenshot({ path: path.join(os.tmpdir(), `cognisync-${darkAudit?'dark-':''}${name}.png`) }); };
  const fits = async selector => {
    const box = await page.locator(selector).boundingBox();
    const size = page.viewportSize();
    assert.ok(box && box.x >= -1 && box.y >= -1 && box.x + box.width <= size.width + 1 && box.y + box.height <= size.height + 1, `${selector} outside ${JSON.stringify(size)}: ${JSON.stringify(box)}`);
  };
  await page.goto('http://localhost:8003/');
  await page.locator('.login-submit').waitFor();
  const pet = page.getByRole('button', { name:'小精灵：展开工具',exact:true });
  await pet.click();
  assert.equal(await page.getByRole('button', { name:'提问',exact:true }).isDisabled(), true);
  await page.keyboard.press('Escape');
  if (!probe) {
    for (const size of [{ width:1280,height:720 }, { width:1366,height:768 }, { width:1024,height:600 }, { width:390,height:844 }]) {
      await page.setViewportSize(size); await fits('.login-card'); await fits('.auth-link');
      assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1));
      await screenshot(`login-${size.width}`);
    }
    await page.locator('.auth-link').click();
    await page.locator('.classroom-register-submit').waitFor();
    for (const size of [{ width:1280,height:720 }, { width:1024,height:600 }, { width:390,height:844 }]) {
      await page.setViewportSize(size); await fits('.classroom-register > section');
      await screenshot(`register-${size.width}`);
    }
    await page.locator('.classroom-register-login').click();
  }
  await page.setViewportSize({ width:1280,height:720 });
  await page.evaluate(() => { localStorage.setItem('cognisync-token','isolated-ui-test'); localStorage.setItem('cognisync:classroom-task-seen:v1:ui-layout:t:pdt','1'); });
  await page.reload();
  await page.getByRole('button', { name: '进入本课：课堂' }).click();
  await page.locator('.project-build-workspace').waitFor();
  const close = page.getByRole('button', { name: '关闭，以后可从右上角查看' });
  if (await close.isVisible()) await close.click();
  assert.equal(await page.locator('.floating-companion').count(), 1);
  await pet.click();
  await page.getByRole('button', {name:'提问',exact:true}).click();
  await page.getByRole('complementary', { name:'项目学习提示助手' }).waitFor();
  if (commonMode) {
    const exerciseControls = async container => {
      await container.getByRole('button', {name:'没理解',exact:true}).click();
      await page.getByText('收到 rephrase',{exact:true}).waitFor();
      assert.equal(chats.at(-1).supportAction,'rephrase');
      await container.locator('.support-tools summary').click();
      for (let i=0;i<2;i++) { await container.getByRole('button',{name:'再具体一点',exact:true}).click(); await page.waitForTimeout(100); }
      await container.getByRole('button',{name:'看看完整示例',exact:true}).click();
      await container.getByRole('button',{name:'确认查看',exact:true}).click();
      await page.getByText('收到 complete',{exact:true}).waitFor();
      await container.getByRole('button',{name:'我先试试',exact:true}).click();
      await container.getByRole('button',{name:'继续帮我',exact:true}).waitFor();
      assert.ok(!/L[0-3]/.test(await container.innerText()));
      await container.getByRole('button',{name:'理解了',exact:true}).click();
      await page.getByText('收到 understood',{exact:true}).waitFor();
      await container.getByRole('button',{name:'继续帮我',exact:true}).click();
      await container.getByRole('button',{name:'试一道',exact:true}).click();
      await container.getByRole('button',{name:'2',exact:true}).click();
      await page.getByText('收到 answer',{exact:true}).waitFor();
      await container.getByRole('button',{name:'回到项目',exact:true}).click();
      await page.getByText('收到 return_project',{exact:true}).waitFor();
    };
    await exerciseControls(page.getByRole('complementary', { name:'项目学习提示助手' }));
    await screenshot('common-support-pdt');
    await page.reload(); await page.getByRole('button',{name:'进入本课：课堂'}).click();
    await pet.click(); await page.getByRole('button',{name:'提问',exact:true}).click();
    await page.getByText('收到 complete',{exact:true}).waitFor();
    group='ai_pbl';
    await page.reload(); await page.getByRole('button',{name:'进入本课：课堂'}).click();
    if (await close.isVisible()) await close.click();
    await pet.click(); await page.getByRole('button',{name:'提问',exact:true}).click();
    await exerciseControls(page.locator('.research-assistant-panel'));
    await screenshot('common-support-ordinary');
    assert.deepEqual(errors,[]); assert.deepEqual(unknown,[]);
    console.log('PASS common support: both group controls, confirmation, self-report, pause/restore, practice/exit, refresh history; isolated API');
    return;
  }
  await page.getByRole('button', {name:'收起助手',exact:true}).click();
  if (referenceMode) {
    await page.getByRole('button', {name:'画流程',exact:true}).click();
    await screenshot('reference-before-open');
    assert.deepEqual(errors,[]);
    await page.getByRole('button', {name:'对照后开始编程',exact:true}).click();
    const dialog = page.getByRole('dialog', {name:'把想法接到代码上'});
    assert.ok(await dialog.isVisible());
    assert.equal(await dialog.locator('.function-reference-list > div').count(),7);
    assert.ok((await dialog.innerText()).includes('不是唯一答案'));
    for (const size of [{width:1280,height:720},{width:1024,height:600}]) {
      await page.setViewportSize(size); await fits('.function-reference-dialog');
      await fits('.function-reference-dialog footer');
      await screenshot(`function-reference-${size.width}`);
    }
    await page.keyboard.press('Escape'); assert.ok(!await dialog.isVisible());
    await page.getByRole('button', {name:'对照后开始编程',exact:true}).click();
    await dialog.getByRole('button', {name:'开始编程',exact:true}).click();
    await page.locator('.project-build-workspace').waitFor();
    assert.equal(workspace.functions.length,6);
    assert.deepEqual(errors,[]); assert.deepEqual(unknown,[]); assert.deepEqual(contrastIssues,[]);
    console.log('PASS: seven-function reference, six student cards preserved, keyboard close, coding transition and dark/small-screen layout');
    return;
  }
  if (discussionMode) {
    await page.getByRole('button', { name:'拆功能',exact:true }).click();
    await page.locator('.function-observation-list button').nth(3).click();
    await page.locator('.is-responsibility input').fill('吃到食物');
    const chat = page.getByRole('textbox', { name:'说说功能怎么做' });
    assert.equal(await page.locator('.function-discussion').getByRole('button', {name:'没理解',exact:true}).count(),0);
    const organize = page.getByRole('button', {name:'帮我整理思路',exact:true});
    assert.ok(await organize.isDisabled());
    await chat.fill('碰到食物以后蛇身增长一格，分数加10');
    await page.getByRole('button', {name:'给我一点提示',exact:true}).click();
    await page.getByText('吃到以后，分数应该怎么变？', { exact:true }).waitFor();
    assert.equal(chats[0].supportAction,'idea_hint');
    assert.equal(await chat.inputValue(),'碰到食物以后蛇身增长一格，分数加10');
    assert.ok(await organize.isDisabled());
    assert.equal(await page.getByRole('textbox', { name:'我的步骤',exact:true }).count(),0);
    await chat.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('.function-discussion-message.is-assistant').length === 2);
    await organize.click();
    await page.getByRole('button', { name:'用这份草稿，再改一改' }).waitFor();
    assert.equal(chats[2].supportAction,'organize');
    assert.equal(chats[0].scaffoldContext.currentModule,chats[1].scaffoldContext.currentModule);
    assert.equal(chats[0].scaffoldContext.stage,'decompose');
    assert.equal(chats[0].scaffoldContext.interaction,'function_discussion');
    assert.equal(JSON.parse(chats[0].scaffoldContext.artifactSummary).observation,'吃到食物得分加十');
    await page.getByRole('button', { name:'用这份草稿，再改一改' }).click();
    const steps = page.getByRole('textbox', { name:'我的步骤',exact:true });
    const finalSteps = '如果蛇头碰到食物：\n    蛇身增加一格\n    分数增加10\n    生成新食物';
    await steps.fill(finalSteps);
    await page.locator('.function-observation-list button').nth(0).click();
    assert.equal(await page.locator('.function-discussion-message').count(),0);
    await page.locator('.function-observation-list button').nth(3).click();
    assert.equal(await steps.inputValue(),finalSteps);
    assert.equal(await page.locator('.function-discussion-message').count(),6);
    for (const size of [{width:1280,height:720},{width:1024,height:600}]) {
      await page.setViewportSize(size); await fits('.function-stage-footer'); await fits('.function-composer-actions');
      await screenshot(`function-discussion-${size.width}`);
    }
    await page.getByRole('button', { name:'形成一张功能卡',exact:true }).click();
    await page.waitForFunction(() => document.querySelector('.saved-function-grid')?.textContent.includes('生成新食物'));
    await page.waitForTimeout(500);
    const card = workspace.functions.find(item => item.responsibility === '吃到食物');
    assert.ok(card); assert.equal(card.implementation,finalSteps); assert.equal(card.source,'ai-assisted');
    assert.equal(card.discussion.messages.length,6);
    assert.ok(events.some(event => event.artifacts?.some(a => a.content.discussion?.acceptedDraftRequestId)));
    await page.getByRole('button', {name:'画流程',exact:true}).click();
    await page.getByRole('button', {name:/吃到食物/}).last().click();
    await page.getByText('查看观察与实现描述').click();
    assert.ok((await page.locator('.mechanism-card-context').innerText()).includes('生成新食物'));
    await page.getByRole('button', { name:'拆功能',exact:true }).click();
    await page.locator('.saved-function-grid article').last().getByRole('button',{name:'编辑功能卡'}).click();
    assert.equal(await page.locator('.function-discussion-message').count(),6);
    await page.getByRole('button', {name:'继续讨论',exact:true}).click();
    await chat.fill('测试失败恢复'); await chat.press('Enter');
    await page.locator('.function-discussion-error').waitFor();
    assert.equal(await chat.inputValue(),'测试失败恢复');
    await page.getByRole('button', {name:'看我的步骤',exact:true}).click();
    assert.equal(await steps.inputValue(),finalSteps);
    await page.waitForTimeout(3500);
    await page.reload(); await page.getByRole('button', {name:'进入本课：课堂'}).click();
    await page.getByRole('button', {name:'拆功能',exact:true}).click();
    await page.locator('.saved-function-grid article').last().getByRole('button',{name:'编辑功能卡'}).click();
    assert.equal(await steps.inputValue(),finalSteps);
    assert.equal(await page.locator('.function-discussion-message').count(),7);
    assert.deepEqual(errors,[]); assert.deepEqual(unknown,[]);
    console.log('PASS: card-scoped chat, opt-in editable draft, preserved evidence, flow reference, failure and refresh recovery');
    return;
  }
  await page.locator('.cm-content').waitFor();
  await page.waitForFunction(() => window.gameCommands.length > 0);
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: /04 生成食物/ }).click();
  await page.getByRole('button', { name: '运行当前版本', exact: true }).click();
  const before = await page.evaluate(() => window.gameCommands.filter(x => x.reset).length);
  await page.locator('.cm-content').press('ControlOrMeta+End');
  await page.locator('.cm-content').pressSequentially('\n# draft', { delay:100 });
  await page.waitForTimeout(1800);
  const after = await page.evaluate(() => window.gameCommands.filter(x => x.reset).length);
  console.log({ before, after, commands: await page.evaluate(() => window.gameCommands) });
  if (probe) return;
  assert.equal(after, before, 'unverified draft edits must not reset the game');
  assert.equal(await page.getByRole('button', { name: '暂停', exact: true }).count(), 1);
  const board = await page.locator('.construction-board').boundingBox();
  const score = await page.locator('.construction-scorebar').boundingBox();
  assert.ok(Math.abs(board.width - board.height) < 1);
  assert.ok(Math.abs(board.x - score.x) < 1 && Math.abs(board.width - score.width) < 1, 'score and board align');
  await fits('.build-workspace-footer'); await fits('.module-test-bar'); await screenshot('build-1280');
  await page.getByRole('button', { name:'暂停',exact:true }).click();
  await page.getByRole('button', { name:'展开函数卡侧栏',exact:true }).click();
  await page.locator('.build-terminal > header button').first().click();
  await page.setViewportSize({ width:1024,height:600 });
  await fits('.module-test-bar'); await fits('.construction-controls'); await fits('.build-workspace-footer');
  await screenshot('build-1024');
  await page.setViewportSize({ width:1280,height:720 });
  for (const [name, rootSelector, footer] of [['拆功能','.project-function-stage','.function-stage-footer'], ['画流程','.project-mechanism-stage','.mechanism-stage-footer']]) {
    await page.locator('.project-stage-rail').getByRole('button', { name }).click();
    await page.locator(rootSelector).waitFor(); await fits(footer); await screenshot(`${name}-1280`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.setViewportSize({ width:1024,height:600 }); await fits(footer);
    if (name === '画流程') { await fits('.mechanism-confirm'); await fits('.mechanism-board-empty'); await fits('.mechanism-shape-palette'); }
    await screenshot(`${name}-1024`);
    await page.setViewportSize({ width:1280,height:720 });
  }
  // Shape editors must remain centered; clipped rectangles used to lose both slanted borders.
  await page.locator('.mechanism-shape-palette').getByRole('button', {name:'条件成立？',exact:true}).click();
  const decision = page.locator('.mechanism-flow-node.is-decision');
  const assertCentered = async node => {
    const box = await node.boundingBox(), input = await node.locator('input').boundingBox();
    assert.ok(Math.abs(box.x + box.width / 2 - input.x - input.width / 2) < 2, 'shape editor is horizontally centered');
    assert.ok(Math.abs(box.y + box.height / 2 - input.y - input.height / 2) < 2, 'shape editor is vertically centered');
  };
  await assertCentered(decision);
  // New shapes start at the canvas center; move this one before adding the next.
  const decisionBox = await decision.boundingBox();
  await page.mouse.move(decisionBox.x + decisionBox.width / 2, decisionBox.y + 20);
  await page.mouse.down();
  await page.mouse.move(decisionBox.x + decisionBox.width / 2 - 180, decisionBox.y + 20, {steps: 8});
  await page.mouse.up();
  await assertCentered(decision);
  await screenshot('flow-decision-edit');
  await page.locator('.mechanism-shape-palette').getByRole('button', {name:'输入 / 输出',exact:true}).click();
  const io = page.locator('.mechanism-flow-node.is-input-output');
  await assertCentered(io);
  const outline = await io.locator('.mechanism-flow-shape').evaluate(el => {
    const s = getComputedStyle(el);
    return {clip: s.clipPath, left: s.borderLeftWidth, right: s.borderRightWidth, transform: s.transform};
  });
  assert.equal(outline.clip, 'none', 'slanted borders are drawn rather than clipped away');
  assert.ok(parseFloat(outline.left) > 0 && parseFloat(outline.right) > 0 && outline.transform !== 'none');
  await screenshot('flow-input-output-edit');
  await page.getByRole('button',{name:'观察',exact:true}).click();
  await page.locator('.saved-observation-list article').first().waitFor();
  for (const size of [{width:1280,height:720},{width:1024,height:600},{width:390,height:844}]) {
    await page.setViewportSize(size);
    const cards=page.locator('.saved-observation-list article');
    assert.equal(await cards.count(),6);
    const first=await cards.nth(0).boundingBox(), second=await cards.nth(1).boundingBox();
    assert.ok(first.width<=181 && first.height===244,'observation cards keep a compact portrait size');
    assert.ok(Math.abs(first.y-second.y)<1,`cards sit side by side at ${size.width}: ${JSON.stringify([first,second])}`);
    assert.equal(await cards.first().getByRole('button',{name:'修改观察卡'}).count(),1);
    assert.equal(await cards.first().getByRole('button',{name:'删除观察卡'}).count(),1);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await screenshot(`observation-deck-${size.width}`);
  }
  await page.setViewportSize({width:1280,height:720});
  // The runtime record can be saved without rewriting it; later notes keep a version trail.
  await page.locator('.runtime-evidence-list button').first().click();
  assert.equal(await page.locator('.observation-composer textarea').inputValue(), '');
  await page.getByRole('button',{name:'保存观察卡',exact:true}).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('cognisync:project-observation-cards:v2:learner-v2:ui-layout:t') || '[]').length === 7);
  await page.getByRole('button',{name:'保存观察卡',exact:true}).waitFor();
  const direct = events.findLast(e => e.detail?.action === 'observation_confirmed');
  assert.ok(direct, 'confirmation event is recorded');
  assert.equal(direct.artifacts[0].content.provenance.kind, 'runtime-record');
  assert.equal(direct.artifacts[0].content.provenance.studentNote, '');
  const cardId = direct.artifacts[0].artifact_key;
  const savedCard = page.locator('.saved-observation-list article').last();
  await savedCard.getByRole('button',{name:'修改观察卡'}).click();
  await page.locator('.observation-composer textarea').fill('如果换一个方向，会发生什么？');
  await page.getByRole('button',{name:'保存修改',exact:true}).click();
  await page.getByRole('button',{name:'保存观察卡',exact:true}).waitFor();
  const revised = events.findLast(e => e.detail?.action === 'observation_revised');
  assert.equal(revised.artifacts[0].artifact_key,cardId);
  assert.equal(revised.artifacts[0].content.provenance.kind,'student-note');
  await savedCard.getByRole('button',{name:'删除观察卡'}).click();
  await page.waitForFunction(() => document.querySelectorAll('.saved-observation-list article').length === 6);
  assert.equal(events.findLast(e => e.detail?.action === 'observation_deleted').artifacts[0].content.deleted,true);
  // Sparse decks still fill the desk; individual playing cards keep their size.
  await page.locator('.saved-observation-list article').evaluateAll(cards => cards.slice(2).forEach(card => card.remove()));
  for (const size of [{width:1280,height:720},{width:1440,height:900},{width:1024,height:600}]) {
    await page.setViewportSize(size);
    const left = await page.locator('.observation-work-column').boundingBox();
    const right = await page.locator('.observation-summary-card').boundingBox();
    assert.ok(Math.abs(left.y - right.y) < 2 && Math.abs(left.height - right.height) < 2, 'observation panels align at both ends');
    assert.ok(size.height - right.y - right.height < 20, 'observation desk fills the viewport');
    await fits('.observation-summary-card .observation-evidence-strip');
    if (size.height >= 720) await fits('.observation-composer-actions');
    assert.equal((await page.locator('.saved-observation-list article').first().boundingBox()).height,244);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1));
    await screenshot(`observation-filled-${size.width}`);
  }
  group = 'ai_pbl';
  await page.evaluate(() => localStorage.setItem('cognisync:classroom-task-seen:v1:ui-layout:t:ai_pbl','1'));
  await page.reload();
  await page.getByRole('button', { name:'进入本课：课堂' }).click();
  await page.locator('.free-game-panel').waitFor();
  if (await close.isVisible()) await close.click();
  await pet.click();
  await page.getByRole('button', {name:'提问',exact:true}).click();
  await page.locator('.research-assistant-panel').waitFor();
  await page.getByRole('button', {name:'收起对话',exact:true}).click();
  for (const size of [{ width:1280,height:720 }, { width:1024,height:600 }]) {
    await page.setViewportSize(size);
    await fits('.research-actionbar'); await fits('.construction-controls');
    const b = await page.locator('.construction-board').boundingBox();
    const s = await page.locator('.construction-scorebar').boundingBox();
    assert.ok(b.width > 100 && Math.abs(b.width - b.height) < 1 && Math.abs(b.width - s.width) < 1);
    await screenshot(`ordinary-${size.width}`);
  }
  assert.deepEqual(errors, []); assert.deepEqual(unknown, []);
  if (darkAudit) {
    workspace = { ...workspace, observations:[], functions:[] };
    group='pdt';
    await page.evaluate(() => { const keep=['cognisync-token','cognisync-theme','cognisync-theme-version']; for(const key of Object.keys(localStorage)) if(!keep.includes(key))localStorage.removeItem(key); localStorage.setItem('cognisync:classroom-task-seen:v1:ui-layout:t:pdt','1'); });
    await page.reload(); await page.getByRole('button',{name:'进入本课：课堂'}).click();
    await page.getByRole('button',{name:'拆功能',exact:true}).click();
    const back=page.getByRole('button',{name:'返回观察阶段',exact:true});
    await back.waitFor(); await screenshot('empty-functions');
    await back.hover(); await auditContrast('empty-functions-hover');
    await back.click(); await screenshot('observe');
    console.log(JSON.stringify(contrastIssues,null,2));
    assert.deepEqual(contrastIssues,[], 'dark classroom text contrast');
  }
  console.log('PASS: login responsive, stage actions fit viewport, board aligned, unverified typing does not reset/pause running game');
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
