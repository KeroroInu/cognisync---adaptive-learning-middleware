// Isolated API fixtures, built frontend and real browser Python Worker; no teaching writes/listener.
const {chromium}=require(process.env.PLAYWRIGHT_PACKAGE||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const root=process.env.STUDENT_BUILD_DIR||path.resolve(__dirname,'../dist');
const basic=process.env.BASIC_SNAKE_REVIEW==='1';
const template=JSON.parse(execFileSync(process.env.TEST_PYTHON||'python3',['-c','import json; from app.services.project_review import TEMPLATE; print(json.dumps(TEMPLATE))'],{cwd:path.resolve(__dirname,'../../backend'),encoding:'utf8'}));
const blankCase=()=>({expected:'',before:null,after:null,status:'',reason:''});
let code={
  'base::initial-state':'def create_initial_state():\n    return [(6,5),(5,5),(4,5)], "right", 0',
  'base::movement':'def move_snake(snake, direction):\n    x, y = snake[0]\n    return [((x+1)%12,y)] + snake[:-1]',
};
(async()=>{
 if(basic){const source=await fs.readFile(path.resolve(__dirname,'../data/basicSnake.ts'),'utf8');code={'main.py':source.match(/BASIC_SNAKE_CODE = `([\s\S]*?)`;/)[1]};}
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  for(const group of ['pdt','ai_pbl']){
   const context=await browser.newContext({viewport:{width:1280,height:720}}),unknown=[],errors=[],runs=[];
   let row={id:`review-${group}`,round_id:'round',title:'项目回顾',round_status:'open',ai_hold:true,revision:0,started_at:null,submitted_at:null,
    template:{version:template.version,questions:template.questions},template_hash:'frozen-question',snapshot:null,snapshot_hash:null,
    answers:{snippets:[],q1:'',q2_choice:'',q2_reason:'',move:blankCase(),eat:blankCase()},first_prediction:null,test_plan:null,results_published:false};
   await context.addInitScript(()=>localStorage.setItem('cognisync-token','isolated-review-test'));
   await context.route('**/*',async route=>{
    const pathname=new URL(route.request().url()).pathname,json=data=>route.fulfill({contentType:'application/json',body:JSON.stringify({success:true,data})});
    if(pathname==='/api/auth/me')return json({user:{id:`review-user-${group}`,name:'测试同学',experimentGroup:group,hasCompletedOnboarding:true},profile:null});
    if(pathname==='/api/project-review/current')return json(new URL(route.request().url()).searchParams.has('status_only')?Object.fromEntries(['id','revision','ai_hold','round_status','results_published','started_at','submitted_at'].map(k=>[k,row[k]])):row);
    if(pathname.endsWith('/begin')){row.started_at=new Date().toISOString();row.snapshot={files:code,...(basic?{runtime:'basic-snake/v1'}:{}),note:'浏览器运行记录，不是服务器正确性证明'};row.snapshot_hash='frozen-code';return json(row);}
    if(pathname.endsWith('/save')){
     const body=route.request().postDataJSON();assert.equal(body.revision,row.revision);assert.ok(!row.submitted_at);
     row.answers=body.answers;row.revision++;
     if(body.action==='prediction')row.first_prediction={choice:body.answers.q2_choice,reason:body.answers.q2_reason};
     if(body.action==='plan')row.test_plan={move:body.answers.move.expected,eat:body.answers.eat.expected};
     if(body.action==='submit')row.submitted_at=new Date().toISOString();
     return json(row);
    }
    if(pathname.endsWith('/runs')){assert.ok(row.test_plan&&row.first_prediction);const body=route.request().postDataJSON();runs.push(body);assert.equal(body.snapshot_hash,'frozen-code');return json({id:`run-${runs.length}`});}
    if(pathname.startsWith('/api/')){unknown.push(pathname);return route.fulfill({status:404,body:'{}'});}
    const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':decodeURIComponent(pathname)));
    if(!file.startsWith(root+'/'))return route.abort();
    try{return route.fulfill({body:await fs.readFile(file),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.zip':'application/zip'})[path.extname(file)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:'not found'});}
   });
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   await page.goto('http://localhost:8003/');await page.getByRole('button',{name:'开始回顾',exact:true}).click();
   await page.getByRole('button',{name:'小精灵：展开工具',exact:true}).click();
   assert.equal(await page.getByRole('button',{name:'提问',exact:true}).isDisabled(),true);await page.keyboard.press('Escape');
   await page.getByLabel('代码片段').selectOption(basic?'main.py':'base::movement');await page.getByLabel('结束行').fill('3');
   await page.getByRole('button',{name:'引用这段',exact:true}).click();await page.getByLabel('简单解释').fill('从蛇头坐标向右增加一格，切掉旧尾巴。');
   await page.reload();assert.equal(await page.getByLabel('简单解释').inputValue(),'从蛇头坐标向右增加一格，切掉旧尾巴。');
   await page.getByRole('button',{name:'保存草稿',exact:true}).click();await page.getByRole('status').filter({hasText:'已保存'}).waitFor();
   await page.screenshot({path:path.join(os.tmpdir(),`cognisync-review-${group}-q1.png`)});
   await page.getByRole('button',{name:'下一题',exact:true}).click();
   assert.equal(await page.getByRole('button',{name:'下一题',exact:true}).isDisabled(),true);
   await page.getByRole('radio',{name:'3 0',exact:true}).check();await page.getByLabel('一句理由').fill('相同所以不满足不等于，不进入分支。');
   await page.getByRole('button',{name:'保存预测',exact:true}).click();await page.getByText(/首次预测已锁定/).waitFor();
   assert.equal(await page.getByRole('radio',{name:'3 0',exact:true}).isDisabled(),true);
   await page.getByRole('button',{name:'下一题',exact:true}).click();
   assert.equal(await page.getByRole('button',{name:'打开冻结作品验证'}).count(),0);
   await page.getByLabel('我预计长度').nth(0).selectOption('不变');await page.getByLabel('我预计长度').nth(1).selectOption('增加1');
   await page.getByRole('button',{name:'保存预期，再验证'}).click();await page.getByRole('button',{name:'打开冻结作品验证'}).waitFor();
   if(group==='pdt'){
    await page.getByRole('button',{name:'打开冻结作品验证'}).click();
    if(basic){
     await page.getByRole('button',{name:'运行冻结代码 / 重置',exact:true}).click();
     await page.locator('.basic-snake-cell.head[data-cell="4,6"]').waitFor({timeout:90000});
     await page.getByRole('button',{name:'W',exact:true}).click();
     await page.locator('.basic-snake-cell.head[data-cell="3,6"]').waitFor();
    }else{
     const play=page.getByRole('button',{name:'运行当前版本',exact:true});await play.waitFor();await play.click();
     await page.waitForFunction(()=>{
      const board=document.querySelector('.construction-board'),head=board?.querySelector('.is-head');
      return head&&Array.from(board.children).indexOf(head)!==66;
     });
    }
    await page.getByRole('button',{name:'引用刚才运行的记录'}).first().click();await page.getByText('已关联本次运行记录',{exact:true}).waitFor();
    assert.equal(runs[0].length_source,'browser_runner');assert.equal(runs[0].before,3);assert.equal(runs[0].after,3);assert.ok(runs[0].observed_at);
    await page.getByRole('button',{name:'收起游戏',exact:true}).click();
   }
   await page.getByLabel('我的判断').nth(0).selectOption(group==='pdt'?'符合预期':'无法完成');await page.getByLabel('move依据').fill(group==='pdt'?'移动前后都是三格。':'我的代码还没有完成。');
   await page.getByLabel('我的判断').nth(1).selectOption('证据不足');await page.getByLabel('eat依据').fill('还没测到吃食物。');
   await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.screenshot({path:path.join(os.tmpdir(),`cognisync-review-${group}-mobile.png`),fullPage:true});
   await page.getByRole('button',{name:'交给老师',exact:true}).click();await page.getByRole('button',{name:'确认提交',exact:true}).click();
   await page.getByRole('heading',{name:'已提交给老师'}).waitFor();assert.ok(row.ai_hold);assert.equal(await page.getByRole('button',{name:'保存草稿'}).count(),0);
   row.grade={scores:[2,3,2],notes:['理解有依据','',''],total:7};
   await page.reload();assert.equal(await page.getByText(/本次核查：/).count(),0);
   // Teacher publish appears only after an explicit teacher end in real API integration tests.
   row.results_published=true;row.rubric=template.rubric;
   await page.reload();await page.getByText(/本次核查：7/).waitFor();await page.getByText('查看本次答案与评分说明').click();
   await page.getByText('预测输出 3 0（1分）',{exact:true}).waitFor();
   assert.deepEqual(errors,[]);assert.deepEqual(unknown,[]);
   await context.close();
  }
  console.log('PASS review UI: both groups; local refresh, cloud draft, first prediction, plan-before-run, real Python frame, cannot-run submission, held AI, hidden/ungraded results, mobile; isolated APIs.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
