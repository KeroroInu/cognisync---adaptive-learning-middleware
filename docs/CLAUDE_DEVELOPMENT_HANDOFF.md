# CogniSync 后续开发交接（给 Claude）

> 交接分支：`codex/final-quasi-experiment-dev`
> 起点：提交 `7bd2ce4 feat: complete traceable project learning workflow`。
> 产品定位：CogniSync——AI 时代的项目解构式编程学习平台；从解构，到建构。
> 最新产品裁定：2026-08-24。若旧文档、旧组件或历史测试与本节冲突，以本节和 `docs/PROJECT_WORKBENCH_V02.md` 顶部“最新设计裁定”为准。

## 可直接复制给 Claude 的提示词

你将接手 CogniSync 的后续开发。请先完整阅读本提示词列出的文件，再检查当前分支、工作树、Docker 服务与已有测试。不要凭截图重新发明架构，也不要一次性重写学生端或教师端。

当前研究目标是支持“人智协同环境下高中生编程复杂技能培养的项目解构式教学设计”。平台不是普通在线编程题库：学生从完整项目的可观察运行证据出发，把现象命名为功能并简要描述实现思路，然后直接进入七个基础函数的 AI 协同建构、测试和整体运行，最后通过创意扩展与“迷宫寻宝”检验迁移。教师蓝图是诊断参照、安全装配边界和隐藏测试来源。

必须保持以下边界：

1. 学生端新任务流程不再包含“理关系”和“定路径”两个独立画布，也不再要求拓扑排序后才能建构。旧组件和旧工作区只保留读取兼容，不能删除历史数据。
2. 教师蓝图发布后不可原地覆盖；学生产生记录后始终关联冻结的蓝图版本。不得向学生下发教师同义词、标准依赖和隐藏测试。唯一例外是建构阶段 L3：学生一次确认后，AI可以给出当前函数经过测试的完整正确实现。
3. 功能卡只保留引用观察、功能名称和一句实现描述，淡化模板为“先……；当……时……；最后……”，并提供少量快捷短语。不要恢复职责、输入、输出、知识点和验证方式等冗长表单。
4. 默认适配 `1366×768`、`1280×720` 和学校低配置电脑。游戏、Python、函数装配与创意钩子在浏览器本地运行；按键和每帧状态不得请求服务器。AI 只在学生主动求助、测试失败后的主动继续或明确覆盖检查时调用。
5. 当前课堂规模按 40—50 人并发设计。继续使用 PostgreSQL 最新工作区快照做跨设备恢复，但研究证据需逐步迁移为不可覆盖的版本/事件；不要为了“性能”提前引入 Redis。只有在压测证明存在跨进程共享缓存、限流或任务队列需求时再评估。
6. `kero/kero` 是开发验收账号，允许自动补齐演示数据，但只能给固定 demo ID 做缺字段迁移，不能覆盖该账号之后的人工修改，更不能影响真实学生。
7. 不要修改或提交用户的论文与比赛材料目录。特别不要纳入：`edustar比赛材料重新准备/`、`项目报告配图重绘提示词.md`。

当前旧版已经完成：

- 教师蓝图版本、草稿、发布与学生冻结版本；
- 教师端项目与现象、模块契约、关系规划、隐藏测试、六阶段 L0—L3 支架策略；
- 学生端完整项目观察、旧功能卡、单功能流程画布、系统关系/路径画布、逐模块 Python Worker 测试和局部游戏装配；其中两个画布将退出新任务主流程；
- 浮动 AI 助手读取当前任务工作区、阶段、代码与测试信息并记录提示等级；需要按新的功能卡、七函数建构、创意函数和迁移上下文收敛；
- 学生功能边界、人机责任标签和开放映射：后端从冻结蓝图返回去敏候选，学生可以多选、拒绝或未映射；建构页只读取学生确认结果，一张功能卡可以展开为多个建构单元；
- 教师当前蓝图 `docs/teacher-blueprints/snake-project-v2.json` 已发布到本地数据库。

按下面顺序继续，每一项独立开发、测试、浏览器验收和提交：

1. **学生入口收敛**：项目解构组登录后直接进入教师已开放的当前项目，不再先显示学生画像、雷达图和知识图谱首页。把这些信息迁入教师端单生详情。保留三组实验条件隔离，不能让 AI-PBL 和讲授组继承 PDT 流程。
2. **功能卡简化**：学生引用一张观察卡，填写功能名称和一句“如何实现”；提供“读取按键、判断条件、更新坐标、修改列表、返回结果”等快捷插入。AI/规则对照冻结蓝图检查七个基础职责是否覆盖，用简短问题提醒遗漏，不把蓝图名称直接当答案展示。
3. **移除流程/路径门槛**：新任务从功能卡直接进入建构；移除新 UI 中的 `ProjectMechanismStage`、`ProjectPathStage` 和前置拓扑锁定。旧工作区、旧产物和旧事件必须仍可读取，不得通过迁移删除；历史学生可显示只读旧产物或兼容转换，但不要求重新填写。
4. **七函数建构工作区**：固定七张基础卡：初始化、方向、移动、食物、进食计分、碰撞、循环。左侧始终是同一个可运行贪吃蛇，右侧按响应式一行或一列切换函数；每卡包含连续 AI 对话、代码编辑、运行、报错、隐藏测试反馈和完成状态。七个函数必须由统一运行器真实组合，不能做七个互不相关的假演示。
5. **建构阶段 L0—L3**：L0 给定位用测试/打印代码，L1 给少量关键代码，L2 给接近完整的结构，L3 显示一次确认后给出当前函数经过测试的完整正确实现。学生自行输入或粘贴并运行；不得静默覆盖编辑器，也不得增加“原来哪里错了”“解释采用原因”等额外表单。记录 requested/effective level、AI 建议文本、后续代码版本和测试结果。
6. **创意功能卡**：基础功能完成后允许自由新增、命名、删除、启用和停用。每卡提供空白函数模板和连续 AI 对话，通过游戏开始、按键、移动前后、吃到食物、循环、结束等受控事件钩子接入同一运行器。限制文件、网络、动态依赖和无限循环；单个创意函数失败不能拖垮基础游戏。
7. **迷宫寻宝迁移**：新增独立教师蓝图、演示、函数契约和测试，复用网格、方向、碰撞、目标物、计分和循环结构。学生不重复画像首页或旧路径画布；坦克大战不在首批范围。
8. **教师单生诊断**：集中查看画像、雷达图、知识图谱、观察/功能卡、七函数代码与测试、L0—L3 分布、创意功能和迁移表现。画像只影响 AI 语言具体程度和单轮颗粒度，不作为阶段门槛或能力排名。
9. **部署验收**：自托管固定 Pyodide 资源，做 40—50 人并发、网络中断恢复、1280×720/1366×768、数据库导出一致性和无外部 CDN 场景验证。

每完成一项先运行对应测试，再运行全量回归。浏览器验收至少覆盖 `kero` 的存量兼容、一个空白新学生的完整新链路、七函数组合、L3 确认、创意函数异常隔离、刷新恢复和窄屏滚动。发现既有问题可以修，但不要顺手重构无关模块。

提交规则：

- 开始前运行 `git status --short`，确认并保留用户未跟踪文件；
- 每个提交只包含一个完整能力，提交信息使用简单动词，例如 `feat: record stage artifact versions`，不要使用 alpha、milestone 等复杂版本名；
- 提交前必须通过 `git diff --check`，检查 diff，不得使用 `git add .`；只显式暂存本项文件；
- 后端至少执行 `backend/venv/bin/ruff check ...` 和 `cd backend && venv/bin/pytest -q`；
- 学生端执行 `npm run type-check`、`npm run build`；教师端涉及变更时执行 `npm run lint`、`npm test -- --run`、`npm run build`；
- 重建相应 Docker 服务并检查 `http://localhost:8003/health`；完成浏览器验收后再提交；
- 不要删除历史蓝图版本、学生工作区或研究事件；任何迁移都要有兼容测试。

## 逐项进展记录（2026-08-24 起）

### 第 1 项：学生入口收敛 — 代码完成，待浏览器验收

提交：`38762cf feat: land students in the open project on entry`（基线 `353f529`）。

产品裁定确认（本轮由使用者裁定）：

- 画像卡、雷达图、画像变化趋势、知识图谱、自我校准在学生端**只做去链接**，视图文件、路由分支和后端接口全部保留，等第 8 项教师端承接后再决定是否清理。不删除任何画像/图谱数据。
- 直达当前开放任务适用于 `pdt`、`ai_pbl`、`lecture` 三组；工作区内容仍由 `experimentGroup` 决定，条件隔离不变。`unassigned` 仍停留在学习首页与量表。

改动文件：

| 文件 | 改动 |
|---|---|
| `frontend/App.tsx` | 抽出 `resolveEntryView()`：未完成 onboarding → 注册流程；已分组且存在教师开放任务 → `research`；无任务或后端不可用 → `dashboard`。登录、注册完成、**会话恢复（刷新/重开标签页）**三条路径统一走它；新增 `entryResolved` 门，解析完成前不渲染学习首页，避免闪现后跳转；`pdt` 的 `allowed` 视图去掉 `graph`、`calibration` |
| `frontend/components/Layout.tsx` | `allowedViews` 与 `primaryViews` 去掉 `graph`、`calibration`；`allNavItems` 条目保留，仅被过滤掉 |
| `frontend/views/Dashboard.tsx` | 移除 `LearnerCardDeck`、`RadarDisplay`、三张画像指标卡、`ProfileTrendChart` 和「查看结构关系」按钮；首页收敛为「当前无开放任务」时的回退入口 |

修复的既有缺陷：原实现只在**登录那一次**检查开放任务，刷新页面后会回到学习首页；现在会话恢复同样直达当前项目。

验证状态（如实）：

```text
frontend/ npx tsc --noEmit        通过
frontend/ npx vite build          通过（2714 modules，5.2s）
git diff --check                  通过
```

- 静态核查：全仓已无学生端指向 `graph` / `calibration` 的导航或按钮，只剩类型声明与 `renderProtectedContent` 的 case 分支（刻意保留）。
- **未做**：浏览器验收、后端 pytest、Docker 健康检查。当前开发沙箱没有 Docker、没有 psql，`backend/venv` 是 macOS 二进制无法在此执行；本项只改学生端三个文件，未触碰后端。**请在本机执行浏览器验收后再进入第 2 项**：`kero` 登录后直达当前任务、刷新后仍在任务内、退出登录后重新登录正常、无开放任务时回退到学习首页且首页不再出现画像与雷达图、`1280×720` 顶部导航只剩「学习首页 / 对话 / 项目工坊」。

下一项：**第 2 项 功能卡简化** —— 把 `ProjectFunctionStage` 的多字段表单改为「引用观察卡 + 功能命名 + 一句实现描述 + 快捷短语」，并接入七函数覆盖检查；旧功能卡字段保持读取兼容。

## 必读文件（按顺序）

1. `AGENTS.md`（若当前环境提供）
2. `docs/TASK1_REVIEW_HANDOFF.md`（研究证据链的三方滚动记录，改动前必读）
3. `docs/PROJECT_WORKBENCH_V02.md`
4. `docs/STUDENT_FRONTEND_DESIGN.md`
5. `docs/teacher-blueprints/snake-project-v2.json`
6. `backend/app/schemas/project_blueprint.py`
7. `backend/app/models/sql/research.py`
8. `backend/app/models/sql/research_event.py`
9. `backend/app/services/research_event_service.py`
10. `backend/app/services/research_task_service.py`
11. `backend/app/api/endpoints/admin/project_blueprints.py`
12. `backend/app/api/endpoints/research.py`
13. `backend/app/api/endpoints/chat.py`
14. `backend/app/services/scaffold_context.py`
15. `frontend/services/stageEvents.ts`
16. `frontend/views/Research.tsx`
17. `frontend/components/ProjectFactory.tsx`
18. `frontend/components/ProjectFunctionStage.tsx`
19. `frontend/components/ProjectMechanismStage.tsx`
20. `frontend/components/ProjectPathStage.tsx`
21. `frontend/components/ProjectBuildStage.tsx`
22. `frontend/components/ProjectScaffoldAssistant.tsx`
23. `frontend/data/projectPath.ts`
24. `frontend/data/snakeProjectBlueprint.ts`
25. `frontend/data/snakeProjectDemo.ts`
26. `admin-frontend/src/pages/ResearchManagement.tsx`
27. `admin-frontend/src/lib/projectBlueprint.ts`

## 任务 1（研究证据链）当前状态

**代码已完成并提交到 `7bd2ce4`。** 详见 `docs/TASK1_REVIEW_HANDOFF.md`
第 16 节最终收尾；那份文档是三方（Claude / Codex / 使用者）的滚动记录，改动前先读它。

已落地的能力：

- 五张新表：`stage_artifacts`、`artifact_versions`、`stage_events`、
  `stage_event_artifacts`、`scaffold_events`。产物版本是**完整 JSONB 快照**，
  追加写入、不可覆盖，与 `workspace_data` 双写（后者仍只用于跨设备恢复）；
- 学生端上报入口 `POST /api/research/tasks/{task_id}/stage-events`；
- 阶段—事件—产物严格组合校验，跨阶段修订走显式白名单；
- 研究证据受数据库级 `RESTRICT` 外键保护，删除被引用的消息/会话/任务一律 409。

### 前端调用契约（新增关键时刻时必须遵守）

统一走 `frontend/services/stageEvents.ts`，不要直接调 `postStageEvent`：

1. **只上报有明确教学含义的操作完成**。逐字输入、拖拽坐标、游戏运行帧一律不报——
   它们不构成研究证据，还会在 40–50 人并发下形成无意义写入；
2. **幂等键用 `createRequestId()`（UUID），且在重试循环之外生成一次**。请求体
   构建一次后全程复用：后端比对语义指纹，同键不同内容返回 409 而非重放；
3. **`artifact_key` 必须是工作区里的稳定 ID**（卡片/节点/模块 ID），绝不用数组下标。
   `content` 是该产物的完整快照，但要剔除画布坐标和每次必变的字段（随机 id、
   本地时间戳、尝试次数）——否则内容哈希每次都变，去重失效，「修订次数」被凭空抬高；
4. **先确认工作区快照保存成功，再写事件**。走 `Research.tsx::reportKeyMoment`，
   它已经把这个顺序和失败提示集中实现好了；
5. **上报失败就不要推进界面**。`reportKeyMoment` 返回 `false` 时必须停在原地
   （`if (!recorded) return;`）。界面显示「已确认」而证据没写入，学生不会再确认
   第二次，这条证据就永久缺失且无人察觉；
6. **求助只走 chat 链路**，前端不得重复上报 `help_request`。

### 明确延后到任务 5 的事项

- 聊天链路的完整幂等：消息、LLM 调用、画像分析、支架事件需要一起幂等。
  当前前端不会自动重放聊天请求，因此暂不会产生重复记录；
  `_record_help_request_event` 传 `request_fingerprint=None`，chat 路径的
  幂等键复用检测目前不生效（只会重放）；
- 不新增“是否采用/解释原因”表单；`scaffold_events.adopted` 可以继续保持 `NULL`，后续研究分析根据 AI 建议、代码版本和测试结果推断，不能用额外填写增加学生负担；
- 更复杂的 AI 依赖分析。

## 当前仍需注意的技术债

- 最新工作区仍是 JSONB 整份快照，用于跨设备恢复；正式研究分析请读
  `artifact_versions` 版本链，两者是双写关系，本轮**没有**切换读取源；
- 学生对教师契约的采纳决定已作为独立的 `function_mapping` 产物记录，
  不再只随工作区快照保存；
- 本地 `snakeProjectBlueprint.ts` 仍用于旧任务兼容和浏览器测试模板，不能把它重新当成所有任务的教师答案源；
- 建构进度已支持 `cardId::blueprintNodeId` 单元键，并兼容旧 `cardId` 键；后续迁移必须保持读取兼容；
- `ResearchCodeEditor` 构建块仍较大，但已按阶段懒加载；在没有性能数据前不要为了消除 Vite 警告引入复杂依赖；
- Pyodide 仍来自公共 CDN，是正式部署前必须解决的问题；
- 学生端**没有任何前端测试运行器**（`package.json` 只有 `dev`/`build`/`preview`/`type-check`）。
  前端改动目前只能靠 `tsc --noEmit` 和人工核查，引入测试框架需要先确认；
- 重复提交检测的 `RAISE EXCEPTION` 在 `init_db` 中执行，一条历史重复行会阻止后端启动。
  不删数据是刻意的，但这个检查更适合放进一次性运维任务；处理脚本是
  `scripts/repair_duplicate_submissions.sql`；
- 后端测试存在 4 条 Pydantic `schema_json` 命名警告，不是当前功能回归，但可以单独提交修复，不能混入研究功能提交。
