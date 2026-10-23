// App → preparation → classroom, two groups, real local Pyodide; all APIs isolated.
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const root = process.env.STUDENT_BUILD_DIR || path.resolve(__dirname, '../dist');
const taskId = 'c3e5359c-4da8-4e62-a757-8c0b661ce135';
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const report = [];
  try {
    for (const group of ['pdt', 'ai_pbl']) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      await context.addInitScript(() => { localStorage.setItem('cognisync-token', 'isolated-basic-snake'); });
      const page = await context.newPage();
      const errors = [], unknown = [], saves = [], events = [], chats = [];
      let remote = null, failLoad = false, failSave = false, failEvent = false, failChat = false;
      let chatGate = Promise.resolve();
      page.on('pageerror', error => errors.push(error.message));
      await context.route('**/*', async route => {
        const url = new URL(route.request().url()), pathname = url.pathname;
        const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
        if (pathname === '/api/auth/me') return json({ success: true, data: { user: { id: `basic-${group}`, name: '验收同学', experimentGroup: group, hasCompletedOnboarding: true }, profile: null } });
        if (pathname === '/api/assessments/pending' || pathname === '/api/project-review/current') return json({ success: true, data: null });
        if (pathname === '/api/classroom/state') return json({ success: true, data: { session: { id: 'session', title: '基础蛇', state: 'open', class_name: group, closes_at: null }, prompt: null,
          lesson_entry: { task_id: taskId, lesson_id: 'lesson', session_id: 'session', title: '共同基础蛇', group } } });
        if (pathname === '/api/preparation/records' || pathname === '/api/materials') return json({ success: true, data: [] });
        if (pathname === '/api/research/active-task') return failLoad ? json({ detail: '读取暂时失败' }, 503) : json({ success: true, data: {
          id: taskId, title: '共同基础蛇', instructions: '运行后试试用 WASD 转向。', ai_prompt: '', code_content: 'legacy teacher sample', language: 'python', target_group: 'all', task_kind: 'learning', ai_enabled: true,
          code_submitted: remote?.code ?? 'print("legacy student code")', workspace_data: { observations: ['keep old card'], ...(remote ? { basicSnake: remote } : {}) },
        } });
        if (pathname.endsWith('/save-basic-snake')) {
          const body = route.request().postDataJSON(); saves.push(body);
          if (failSave) return json({ detail: '模拟保存失败，草稿还在本机' }, 503);
          assert.equal(body.runtime, 'basic-snake/v1');
          remote = { ...body, revision: (remote?.revision ?? 0) + 1, legacy_code_submitted: 'print("legacy student code")' };
          return json({ success: true, data: { saved: true, revision: remote.revision } });
        }
        if (pathname.endsWith('/stage-events')) {
          const body = route.request().postDataJSON(); events.push(body);
          if (failEvent) return json({ detail: '模拟证据写入失败' }, 422);
          return json({ success: true, data: { event_id: body.request_id, stage: 'build', event_type: 'module_test', artifacts: [], replayed: false } });
        }
        if (pathname === '/api/learning-support/state') return json({ success: true, data: { level: 0, paused: false, history: [] } });
        if (pathname === '/api/chat') {
          const body = route.request().postDataJSON(); chats.push(body);
          assert.equal(body.scaffoldContext.currentModule, 'basic-snake/v1');
          assert.ok(body.scaffoldContext.testFeedback.length <= 2000);
          await chatGate;
          if (failChat) return json({ detail: '模拟 AI 连接失败' }, 503);
          return json({ success: true, data: { message: '先看看 head 的行和列怎样变化。', support: { level: 0, paused: false }, updatedProfile: null, analysis: { intent: 'learning-support', emotion: 'unknown', detectedConcepts: [], delta: { cognition: 0, affect: 0, behavior: 0 } } } });
        }
        if (pathname.startsWith('/api/')) { unknown.push(pathname); return json({ detail: 'Unmocked API' }, 404); }
        const candidate = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : decodeURIComponent(pathname)));
        if (!candidate.startsWith(root + '/')) return route.abort();
        try {
          const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.zip': 'application/zip' };
          return route.fulfill({ body: await fs.readFile(candidate), contentType: types[path.extname(candidate)] || 'application/octet-stream' });
        } catch { return route.fulfill({ status: 404, body: 'not found' }); }
      });
      const enter = async () => { await page.getByRole('button', { name: '进入本课：共同基础蛇' }).click(); await page.locator('.basic-snake-editor .cm-content').waitFor(); };
      const head = cell => page.locator(`.basic-snake-cell.head[data-cell="${cell}"]`);
      // A cell lasts only 360ms now; sample each animation frame rather than
      // locator.waitFor's increasing polling intervals, which can skip it.
      const waitHead = cell => page.waitForFunction(cell => !!document.querySelector(`.basic-snake-cell.head[data-cell="${cell}"]`), cell, { timeout: 90000 });
      const score = () => page.getByTestId('snake-score').innerText();
      const run = async () => { await page.getByRole('button', { name: '运行代码', exact: true }).click(); await page.getByRole('button', { name: '运行代码', exact: true }).isEnabled(); };
      const editor = () => page.locator('.basic-snake-editor .cm-content');
      // Use real editor commands. Replacing a virtualized contenteditable DOM
      // with fill() bypasses CodeMirror's full-document selection/transaction.
      const edit = async code => { await editor().press('ControlOrMeta+A'); await page.keyboard.insertText(code); };
      const readableChat = async () => {
        const contrast = await page.locator('.basic-snake-messages article').evaluateAll(articles => {
          const luminance = color => {
            const rgb = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
            return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
          };
          return articles.map(article => {
            const p = article.querySelector('p'), style = getComputedStyle(p), background = getComputedStyle(article).backgroundColor;
            const a = luminance(style.color), b = luminance(background);
            return { ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), size: parseFloat(style.fontSize) };
          });
        });
        assert.ok(contrast.length >= 2);
        assert.ok(contrast.every(item => item.ratio >= 4.5 && item.size >= 15), JSON.stringify(contrast));
      };
      await page.goto('http://localhost:8003/');
      await enter();
      assert.equal(saves.length, 0, 'read/entry must not replace historical code');
      assert.equal(await page.locator('.basic-snake-cell.head').count(), 0, 'no demo before execution');
      assert.equal(await page.getByRole('button', { name: '上 W', exact: true }).isEnabled(), false);
      let source = await editor().innerText();
      assert.ok(source.includes('ROWS, COLS = 10, 10'));
      await run(); await waitHead('4,6');
      source = events.find(event => event.detail.action === 'run_or_reset').artifacts[0].content.code;
      assert.equal(await score(), '0');
      // The first move/eat needs no input at all.
      await waitHead('4,7'); assert.equal(await score(), '1');
      assert.equal(await page.locator('.basic-snake-cell.body').count(), 3);
      await page.getByRole('button', { name: '暂停', exact: true }).click();
      await page.waitForTimeout(800); assert.equal(await head('4,7').count(), 1, 'pause freezes the board');
      await page.locator('.basic-snake-board').dispatchEvent('keydown', { key: 'd', repeat: true });
      const stepsStart = saves.length;
      await page.getByRole('button', { name: '上 W', exact: true }).click();
      assert.equal(await head('4,7').count(), 1, 'turn input does not itself move');
      await page.getByRole('button', { name: '继续', exact: true }).click();
      await waitHead('3,7');
      await waitHead('2,7');
      await page.getByRole('button', { name: '暂停', exact: true }).click();
      assert.equal(saves.length, stepsStart, 'no network save per move');
      await page.getByRole('button', { name: '重新开始', exact: true }).click(); await waitHead('4,6');
      await page.getByRole('button', { name: '左 A', exact: true }).click(); await page.getByText('游戏结束', { exact: true }).waitFor();
      assert.equal(await head('4,6').count(), 1);
      const afterEnd = events.length;
      await page.waitForTimeout(800); assert.equal(events.length, afterEnd, 'game over stops the loop');
      await run(); await waitHead('4,6');
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.waitForTimeout(800); assert.equal(await head('4,6').count(), 1, 'hidden tab pauses');
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      assert.ok(await page.getByRole('button', { name: '继续', exact: true }).isVisible(), 'returning to tab requires explicit resume');
      await page.getByRole('button', { name: '问 AI', exact: true }).click();
      const input = page.getByRole('textbox', { name: '向 AI 提问', exact: true });
      await input.fill('这里的坐标先写行还是列？');
      await input.press('Shift+Enter'); assert.ok((await input.inputValue()).includes('\n')); assert.equal(chats.length, 0);
      await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true, keyCode: 229 });
      assert.equal(chats.length, 0, 'Chinese composition must not send');
      let releaseChat;
      chatGate = new Promise(resolve => { releaseChat = resolve; });
      await input.press('Enter');
      assert.equal(await input.inputValue(), '', 'send clears immediately, not after response');
      await page.getByText('正在回复…', { exact: true }).waitFor();
      await input.fill('下一句还没写完');
      await input.press('Enter');
      releaseChat(); await page.getByText('先看看 head 的行和列怎样变化。').waitFor();
      assert.equal(chats.length, 1, 'busy enter must not duplicate a request');
      assert.equal(await input.inputValue(), '下一句还没写完', 'reply cannot erase the next draft');
      await readableChat();
      assert.ok(await page.getByRole('region', { name: '游戏预览', exact: true }).isVisible());
      assert.ok(await editor().isVisible());
      await page.screenshot({ path: path.join(os.tmpdir(), `basic-snake-${group}-1280.png`) });
      for (const size of [{ width: 1024, height: 600 }, { width: 1440, height: 900 }]) {
        await page.setViewportSize(size);
        const geometry = await page.evaluate(() => { const board = document.querySelector('.basic-snake-board').getBoundingClientRect(); const main = document.querySelector('.basic-snake').getBoundingClientRect(); return { width: board.width, height: board.height, bottom: main.bottom, scroll: document.documentElement.scrollWidth, view: innerWidth }; });
        assert.ok(Math.abs(geometry.width - geometry.height) < 1, JSON.stringify(geometry));
        assert.ok(geometry.width > 180, JSON.stringify(geometry));
        assert.ok(geometry.bottom <= size.height + 2, JSON.stringify(geometry));
        assert.ok(geometry.scroll <= geometry.view, JSON.stringify(geometry));
      }
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.getByRole('button', { name: '收起 AI', exact: true }).click();
      const pet = page.getByRole('button', { name: '小精灵：展开工具', exact: true });
      await pet.click(); await page.getByRole('button', { name: '提问', exact: true }).click();
      assert.equal(await page.getByRole('textbox', { name: '向 AI 提问', exact: true }).count(), 1, 'pet opens the same chat');
      assert.equal(chats.length, 1, 'opening pet does not send a model request');
      await pet.click(); await page.getByRole('button', { name: '切换模式', exact: true }).click();
      await readableChat();
      await page.screenshot({ path: path.join(os.tmpdir(), `basic-snake-${group}-dark.png`) });
      failChat = true;
      await input.fill('失败后请保留这个问题');
      await page.getByRole('button', { name: '发送', exact: true }).click();
      await page.locator('.basic-snake-chat-error').waitFor();
      assert.equal(await input.inputValue(), '失败后请保留这个问题');
      failChat = false;
      await page.getByRole('button', { name: '收起 AI', exact: true }).click();
      const altered = source.replace('"score": 0', '"score": 8').replace('state["score"] += 1', 'state["score"] += 7');
      await edit(altered); await page.getByText('代码已修改，运行后更新画面', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: '右 D', exact: true }).isEnabled(), false);
      await run(); await page.waitForFunction(() => document.querySelector('[data-testid="snake-score"]').textContent === '8');
      await page.waitForFunction(() => document.querySelector('[data-testid="snake-score"]').textContent === '15');
      // Editor WASD keys must not move the game.
      await editor().press('End'); await editor().press('w');
      await page.waitForTimeout(800);
      assert.equal(await head('4,7').count(), 1);
      await edit('def broken(:'); await run(); await page.locator('.basic-snake-output [role="alert"]').waitFor();
      assert.equal(await page.locator('.basic-snake-cell.head').count(), 0, 'invalid Python cannot display fallback snake');
      const syntaxOutput = await page.locator('.basic-snake-output').innerText();
      assert.ok(syntaxOutput.includes('第 1 行'), syntaxOutput);
      await edit(source.replace('state["score"] += 1', 'state["score"] += missing'));
      await run(); await page.locator('.basic-snake-output [role="alert"]').waitFor();
      assert.ok((await page.locator('.basic-snake-output').innerText()).includes('NameError'));
      assert.equal(await page.locator('.basic-snake-cell.head').count(), 0, 'tick error cannot display fallback');
      const failedCount = events.length;
      await page.waitForTimeout(800); assert.equal(events.length, failedCount, 'tick error stops retries');
      await edit(altered); failEvent = true; await run(); await page.getByText(/条运行记录未同步/).waitFor();
      failEvent = false; await page.getByRole('button', { name: '重试同步', exact: true }).click(); await page.getByText(/条运行记录未同步/).waitFor({ state: 'hidden' });
      failEvent = true; await run(); await page.getByText(/条运行记录未同步/).waitFor();
      const replayId = events.at(-1).request_id;
      failEvent = false; await page.reload(); await enter();
      await page.waitForTimeout(300);
      assert.equal(events.filter(event => event.request_id === replayId).length, 2, 'refresh replays durable evidence with the same id');
      failSave = true; await edit(altered + '\n# 草稿保留'); await page.getByText('模拟保存失败，草稿还在本机').waitFor();
      failSave = false; await page.getByRole('button', { name: '重试保存', exact: true }).click(); await page.getByText('已保存', { exact: true }).waitFor();
      await page.reload(); await enter();
      await editor().press('ControlOrMeta+End');
      assert.ok((await editor().innerText()).includes('# 草稿保留'));
      assert.equal(await page.locator('.basic-snake-cell.head').count(), 0, 'refresh restores draft, not automatic execution');
      const challenge = `${source}\n# 草稿保留\ndef on_board_click(state, row, col):\n    state["food"] = (row, col)\n    state["obstacles"] = [(0, 1)]\n    state["path"] = [(0, 0), (1, 0)]\n    return state\n`;
      await edit(challenge); await run(); await waitHead('4,6');
      await page.getByRole('button', { name: '暂停', exact: true }).click();
      await page.locator('.basic-snake-cell[data-cell="0,0"]').click();
      await page.locator('.basic-snake-cell.food[data-cell="0,0"]').waitFor();
      assert.equal(await page.locator('.basic-snake-cell.obstacle[data-cell="0,1"]').count(), 1);
      assert.equal(await page.locator('.basic-snake-cell.path').count(), 2);
      assert.ok(events.some(event => event.detail.action === 'board_click' && event.detail.clicked_cell.join(',') === '0,0'), 'click and Python outcome must be recorded for both groups');
      await page.locator('.basic-snake-cell.head').click();
      await page.getByRole('alert').filter({ hasText: '食物不能与蛇身重叠' }).waitFor();
      await page.locator('.basic-snake-cell[data-cell="0,0"]').click();
      await page.getByRole('alert').filter({ hasText: '食物不能与蛇身重叠' }).waitFor({ state: 'hidden' });
      await page.locator('.basic-snake-board.interactive').waitFor();
      await page.locator('.basic-snake-board').focus();
      await page.keyboard.press('ArrowDown');
      assert.equal(await page.locator('.basic-snake-board').getAttribute('aria-activedescendant'), 'snake-cell-10');
      await page.keyboard.press('Enter');
      await page.locator('.basic-snake-cell.food[data-cell="1,0"]').waitFor();
      await page.screenshot({ path: path.join(os.tmpdir(), `basic-snake-${group}-challenge.png`) });
      await page.reload(); await enter();
      assert.equal(await page.locator('.basic-snake-cell.head').count(), 0, 'challenge code also restores without running');
      await page.setViewportSize({ width: 390, height: 844 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: path.join(os.tmpdir(), `basic-snake-${group}-mobile.png`), fullPage: true });
      await page.locator('.basic-snake-output').scrollIntoViewIfNeeded();
      assert.ok((await page.locator('.basic-snake-output').boundingBox()).y < 844, 'mobile output remains reachable by inner scrolling');
      failLoad = true; await page.reload(); await page.getByRole('button', { name: '进入本课：共同基础蛇' }).click();
      await page.getByRole('button', { name: '重新读取', exact: true }).waitFor(); assert.equal(await editor().count(), 0);
      assert.deepEqual(errors, []); assert.deepEqual(unknown, []);
      assert.ok(events.some(event => event.detail.executed === false));
      assert.ok(events.every(event => !('passed' in event.detail)), 'execution is not a correctness badge');
      assert.equal(chats.length, 2);
      report.push({ group, saves: saves.length, events: events.length, chatFocus: chats[0].scaffoldContext.currentModule });
      await context.close();
    }
    console.log(JSON.stringify({ passed: true, realPythonWorker: true, report }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
