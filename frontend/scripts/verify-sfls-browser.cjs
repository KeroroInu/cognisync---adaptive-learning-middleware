// Real Chromium, isolated API fixtures: no teaching accounts, database, or model calls.
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = process.env.STUDENT_BUILD_DIR || path.resolve(__dirname, '../dist');
const liveOrigin = process.env.LIVE_ORIGIN;
const origin = liveOrigin || 'http://localhost:8003';
const vendorRoot = path.resolve(__dirname, '../public');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const group of ['pdt', 'ai_pbl']) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      await context.addInitScript(() => localStorage.setItem('cognisync-token', 'isolated-ui-test'));
      let revision = 0, current = null, failSave = true, failLoad = true, brokenDesign = false;
      let taskId = 'material';
      const requests = [], errors = [], unknown = [], diagramRequests = [];
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      page.on('pageerror', error => { errors.push(error.message); console.error('PAGE ERROR', error.message); });
      await context.route('**/*', async route => {
        const url = new URL(route.request().url()), pathname = url.pathname;
        if (pathname.startsWith('/drawio/')) diagramRequests.push(pathname);
        const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
        if (pathname === '/api/auth/me') return json({ success: true, data: { user: { id: group, name: '测试同学', experimentGroup: group, hasCompletedOnboarding: true }, profile: null } });
        if (pathname === '/api/assessments/pending' || pathname === '/api/assessments/status' || pathname === '/api/project-review/current') return json({ success: true, data: null });
        if (pathname === '/api/learning-support/state') return json({ success: true, data: { level: 0, paused: false, history: [] } });
        if (pathname === '/api/classroom/state') return json({ success: true, data: { session: { id: 'session', title: '第一课', state: 'open', class_name: '测试班' }, prompt: null, lesson_entry: null } });
        if (pathname === '/api/preparation/records') { assert.equal(route.request().method(), 'GET', 'viewing tasks must not create Python save records'); return json({ success: true, data: [] }); }
        if (pathname === '/api/materials') return json({ success: true, data: taskId ? [{ id: taskId, title: taskId === 'material' ? '贪吃蛇初体验' : '第二次创作', kind: 'sfls', configuration: { task: '用方向键控制蛇。\n\n' + '观察输入、数据更新与画面变化。\n'.repeat(24), phase: 'practice', inherit_previous: true }, submission: { count: 0 } }] : [] });
        if (pathname === '/api/materials/material/design') {
          if (route.request().method() === 'GET') {
            if (failLoad) { failLoad = false; return json({ detail: '模拟读取失败' }, 503); }
            return json({ success: true, data: { current: brokenDesign ? { revision: 1, requirements: '', nodes: null, edges: [] } : current, revision } });
          }
          const body = route.request().postDataJSON(); requests.push(body);
          if (failSave) { failSave = false; return json({ detail: '模拟断线，草稿仍在' }, 503); }
          assert.equal(body.base_revision, revision);
          current = { ...body, revision: ++revision };
          return json({ success: true, data: current });
        }
        if (pathname === '/api/materials/material/readme') return json({success:true,data:{receipt_id:'receipt',created_at:new Date().toISOString(),text:'# 我的作品\n\n未验证 <script>test</script>',message:'',task_validation_status:'matched'}});
        if (pathname === '/api/materials/material/design/download') return route.fulfill({contentType:'application/zip',body:Buffer.from('fixture-only')});
        if (pathname === '/api/materials/material/download') return route.fulfill({ contentType: 'application/zip', body: Buffer.from('fixture-only') });
        if (pathname.startsWith('/api/')) { unknown.push(pathname); return json({ detail: 'Unmocked request' }, 404); }
        if (url.origin !== new URL(origin).origin) return route.abort();
        if (liveOrigin) return route.continue();
        if (process.env.LIVE_DRAWIO === '1' && pathname.startsWith('/drawio/')) return route.continue();
        const staticRoot = pathname.startsWith('/drawio/') ? vendorRoot : root;
        const candidate = path.resolve(staticRoot, '.' + (pathname === '/' ? '/index.html' : decodeURIComponent(pathname)));
        if (!candidate.startsWith(staticRoot + '/')) return route.abort();
        try {
          const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' };
          return route.fulfill({ body: await fs.readFile(candidate), contentType: types[path.extname(candidate)] || 'application/octet-stream' });
        } catch { return route.fulfill({ status: 404, body: 'not found' }); }
      });
      await page.goto(origin);
      await page.getByRole('heading', { name: '贪吃蛇初体验' }).waitFor();
      assert.equal(await page.locator('.studio-lessons').isVisible(), false, 'task sidebar starts collapsed');
      await page.getByRole('button', { name: '展开任务栏' }).click();
      await page.getByRole('heading', { name: '当前开放' }).waitFor();
      await page.getByRole('button', { name: '收起任务栏' }).click();
      assert.equal(await page.locator('.cm-content').count(), 0, 'heavy editor is not mounted on task entry');
      await page.getByRole('button', { name: '工具包', exact: true }).click();
      await page.locator('.studio-tool-list').getByRole('button', { name: /^需求文档/ }).click();
      await page.getByRole('button', { name: '重新读取设计' }).click();
      await page.getByRole('textbox', { name: '我的需求' }).fill('我想用方向键控制蛇，吃食物后增加分数。');
      assert.equal(await page.locator('.drawio-host iframe').count(), 0, 'document entry does not mount draw.io');
      assert.deepEqual(diagramRequests, [], 'document entry does not download draw.io resources');
      const designDownload = page.getByRole('button', { name: '下载设计', exact: true });
      assert.equal(await designDownload.isDisabled(), true);
      await page.getByRole('button', { name: '保存设计', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: '模拟断线' }).waitFor();
      await page.getByRole('button', { name: '保存设计', exact: true }).click();
      await page.getByRole('status').filter({ hasText: '已保存' }).waitFor();
      assert.equal(requests[0].request_id, requests[1].request_id);
      assert.equal(await designDownload.isEnabled(), true);
      await page.getByRole('button', { name: '架构画板', exact: true }).click();
      await page.locator('.drawio-host[aria-busy=false]').waitFor({timeout:30000});
      const board = page.frameLocator('iframe[title="draw.io 设计画板"]');
      await board.locator('.geDiagramContainer').waitFor();
      await page.screenshot({path:'/tmp/sfls-board-debug.png'});
      // Exercise the real upstream editor through a double-click and text entry.
      await board.locator('[title="矩形 (D)"]').click();
      await board.locator('.geDiagramContainer svg rect[width="160"]').first().dblclick();
      await board.locator('[contenteditable=true]').waitFor();
      await page.keyboard.type('move');
      await page.keyboard.press('Meta+Enter');
      await board.locator('.geDiagramContainer').click({position:{x:600,y:300}});
      await page.waitForTimeout(1200);
      await page.getByRole('button', { name: '需求文档', exact: true }).click();
      const requirements = page.getByRole('textbox', { name: '我的需求' });
      assert.equal(await requirements.inputValue(), '我想用方向键控制蛇，吃食物后增加分数。');
      await requirements.fill('我想用方向键控制蛇，吃食物后增加分数。还可以重新开始。');
      assert.equal(await designDownload.isDisabled(), true, 'switching tools keeps the unsaved dirty guard');
      const retainedFrame = page.frames().find(frame => frame.url().includes('/drawio/index.html'));
      await page.getByRole('button', { name: '架构画板', exact: true }).click();
      assert.equal(page.frames().find(frame => frame.url().includes('/drawio/index.html')), retainedFrame, 'tool changes keep one draw.io instance');
      await board.locator('.geDiagramContainer').getByText('move', { exact: true }).first().waitFor();
      await page.screenshot({path:'/tmp/sfls-board-edited.png'});
      await page.getByRole('button', { name: '保存设计', exact: true }).click();
      await page.getByRole('status').filter({hasText:'已保存'}).waitFor();
      assert.ok(current.drawio_xml.includes('move'), 'real draw.io edit is saved as XML');
      assert.ok(current.requirements.includes('重新开始'), 'saving the board also preserves the document draft');
      const downloadEvent = page.waitForEvent('download');
      await designDownload.click(); await downloadEvent;
      await page.reload();
      await page.getByRole('heading', { name: '贪吃蛇初体验' }).waitFor();
      await page.getByRole('button', { name: '架构画板', exact: true }).click();
      await page.locator('.drawio-host[aria-busy=false]').waitFor({timeout:30000});
      assert.equal(await page.getByRole('textbox', { name: '我的需求' }).isVisible(), false, 'direct board entry opens the board, not the document');
      await page.getByRole('button', { name: '需求文档', exact: true }).click();
      await page.getByRole('textbox', { name: '我的需求' }).waitFor();
      assert.equal(await page.getByRole('textbox', { name: '我的需求' }).inputValue(), current.requirements);
      await page.getByRole('button', { name: '架构画板', exact: true }).click();
      await page.locator('.drawio-host[aria-busy=false]').waitFor({timeout:30000});
      await page.setViewportSize({width:1280,height:720});
      await page.getByRole('button', {name:'任务',exact:true}).click();
      await page.screenshot({path:'/tmp/sfls-studio-light.png'});
      await page.getByRole('button', {name:'作品记录',exact:true}).click();
      await page.getByText('未验证 <script>test</script>', {exact:false}).waitFor();
      assert.equal(await page.locator('.studio-readme script').count(),0);
      await page.getByRole('button', {name:'任务',exact:true}).click();
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
        for (const width of [1920, 1280, 980, 390]) {
          await page.setViewportSize({ width, height: 720 });
          await page.waitForTimeout(250);
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no horizontal page overflow');
          if(width===390) assert.ok(await page.evaluate(()=>document.querySelector('.studio-main').getBoundingClientRect().bottom <= document.querySelector('.studio-handoff').getBoundingClientRect().top + 1),'mobile content does not overlap upload controls');
          else {
            for (const expanded of [true, false]) {
              await page.getByRole('button', {name: expanded ? '展开任务栏' : '收起任务栏'}).click();
              assert.ok(await page.evaluate(() => {
                const main = document.querySelector('.studio-main').getBoundingClientRect();
                const handoff = document.querySelector('.studio-handoff').getBoundingClientRect();
                return Math.abs(main.top - handoff.top) < 1 && main.right <= handoff.left + 1 && handoff.bottom <= innerHeight + 1;
              }), 'desktop download rail stays beside document, within viewport');
              assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1), 'desktop page itself does not scroll');
            }
            await page.locator('.studio-main').evaluate(el => { el.scrollTop = el.scrollHeight; });
            assert.ok(await page.locator('.studio-main').evaluate(el => el.scrollTop > 0), 'long task remains scrollable');
            await page.locator('.studio-main').evaluate(el => { el.scrollTop = 0; });
          }
          await page.screenshot({ path: `/tmp/sfls-${group}-${theme}-${width}.png` });
        }
      }
      await page.setViewportSize({width:1280,height:720});
      await page.locator('.studio-main').evaluate(el => { el.scrollTop = el.scrollHeight; });
      taskId = 'next-material';
      await page.getByRole('heading', {name:'第二次创作'}).waitFor({timeout:16000});
      assert.equal(await page.locator('.studio-main').evaluate(el => el.scrollTop),0,'teacher switch resets task scroll');
      assert.equal(await page.getByRole('heading',{name:'贪吃蛇初体验'}).count(),0,'previous task is removed');
      taskId = '';
      await page.getByRole('heading',{name:'今天的创作，即将开始'}).waitFor({timeout:16000});
      assert.equal(await page.getByRole('button',{name:'下载 Windows 包'}).count(),0,'closed task cannot be downloaded');
      await page.getByRole('button', { name: '贪贪：展开工具' }).click();
      await page.getByRole('button', {name:'工具包',exact:true}).last().click();
      await page.getByRole('heading', {name:'把想法表达出来'}).waitFor();
      await page.getByRole('button', { name: 'Python 小实验', exact: true }).first().click();
      await page.locator('.cm-content').waitFor();
      assert.equal(await page.getByRole('textbox', { name: '向 AI 提问', exact: true }).isVisible(), true);
      assert.deepEqual(errors, []); assert.deepEqual(unknown, []);
      // A synthetic render failure must leave the task navigation available, not blank the App.
      taskId = 'material'; brokenDesign = true;
      await page.reload();
      await page.getByRole('heading', { name: '贪吃蛇初体验' }).waitFor();
      await page.getByRole('button', { name: '架构画板', exact: true }).click();
      await page.getByRole('heading', { name: '工具没有成功打开' }).waitFor();
      assert.equal(await page.getByRole('button', { name: '重新载入工具' }).isVisible(), true);
      await page.getByRole('button', { name: '任务', exact: true }).click();
      await page.getByRole('heading', { name: '贪吃蛇初体验' }).waitFor();
      console.log(`${group}: separate document/board entry, no eager draw.io, shared drafts/XML, save/reload/download, error boundary, themes/resolutions, optional Python passed`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
