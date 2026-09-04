# CogniSync 后续开发交接（给 Claude）

> 交接分支：`codex/final-quasi-experiment-dev`
> 起点：提交 `7bd2ce4 feat: complete traceable project learning workflow`。
> 产品定位：CogniSync——AI 时代的项目解构式编程学习平台；从解构，到建构。
> 最新产品裁定：2026-09-04。若旧文档、旧组件或历史测试与本节冲突，以本节、`docs/PROJECT_WORKBENCH_V02.md` 顶部“最新设计裁定”和 `docs/CREATIVE_RUNTIME_V2_DEVELOPMENT_HANDOFF.md` 为准。

> 最新统一定位：CogniSync 是课堂中的项目解构教学与学习过程采集平台。网页迷宫迁移原型已从当前学生端、教师端和新环境播种中移除；旧数据库记录继续兼容读取。是否采用本地 Pi 任务包留待教学主流程完成后另行讨论，不属于当前实现。

## 可直接复制给 Claude 的提示词

你将接手 CogniSync 的后续开发。请先完整阅读本提示词列出的文件，再检查当前分支、工作树、Docker 服务与已有测试。不要凭截图重新发明架构，也不要一次性重写学生端或教师端。

当前研究目标是支持“人智协同环境下高中生编程复杂技能培养的项目解构式教学设计”。平台不是普通在线编程题库：学生从完整项目的可观察运行证据出发，把现象命名为功能并简要描述实现思路，再为每张功能卡绘制内部流程图，然后进入七个基础函数的 AI 协同建构、测试、整体运行和创意扩展。教师蓝图是诊断参照、安全装配边界和隐藏测试来源。当前开发止于贪吃蛇创意扩展；迁移测量方案暂不进入产品实现。

必须保持以下边界：

1. 学生端新任务必须保留“针对每张功能卡绘制内部流程图”；不再包含系统关系画布和“定路径”规划，也不要求拓扑排序后才能建构。旧组件和旧工作区不能删除历史数据。
2. 教师蓝图发布后不可原地覆盖；学生产生记录后始终关联冻结的蓝图版本。不得向学生下发教师同义词、标准依赖和隐藏测试。唯一例外是建构阶段 L3：学生一次确认后，AI可以给出当前函数经过测试的完整正确实现。
3. 功能卡只保留引用观察、功能名称和一句实现描述，淡化模板为“先……；当……时……；最后……”，并提供少量快捷短语。不要恢复职责、输入、输出、知识点和验证方式等冗长表单。
4. 默认适配 `1366×768`、`1280×720` 和学校低配置电脑。游戏、Python、函数装配与创意钩子在浏览器本地运行；按键和每帧状态不得请求服务器。AI 只在学生主动求助、测试失败后的主动继续或明确覆盖检查时调用。
5. 当前课堂规模按 40—50 人并发设计。继续使用 PostgreSQL 最新工作区快照做跨设备恢复，但研究证据需逐步迁移为不可覆盖的版本/事件；不要为了“性能”提前引入 Redis。只有在压测证明存在跨进程共享缓存、限流或任务队列需求时再评估。
6. `kero/kero` 是开发验收账号，允许自动补齐演示数据，但只能给固定 demo ID 做缺字段迁移，不能覆盖该账号之后的人工修改，更不能影响真实学生。
7. 不要修改或提交用户的论文与比赛材料目录。特别不要纳入：`edustar比赛材料重新准备/`、`项目报告配图重绘提示词.md`。

当前旧版已经完成：

- 教师蓝图版本、草稿、发布与学生冻结版本；
- 教师端项目与现象、模块契约、关系规划、隐藏测试、六阶段 L0—L3 支架策略；
- 学生端完整项目观察、旧功能卡、单功能流程画布、系统关系/路径画布、逐模块 Python Worker 测试和局部游戏装配；单功能流程画布继续进入新主流程，退出的是系统关系与实现路径规划；
- 浮动 AI 助手读取当前任务工作区、阶段、代码与测试信息并记录提示等级；需要按新的功能卡、七函数建构、创意函数和迁移上下文收敛；
- 学生功能边界、人机责任标签和开放映射：后端从冻结蓝图返回去敏候选，学生可以多选、拒绝或未映射；建构页只读取学生确认结果，一张功能卡可以展开为多个建构单元；
- 教师当前蓝图 `docs/teacher-blueprints/snake-project-v2.json` 已发布到本地数据库。

按下面顺序继续，每一项独立开发、测试、浏览器验收和提交：

1. **学生入口收敛**：项目解构组登录后直接进入教师已开放的当前项目，不再先显示学生画像、雷达图和知识图谱首页。把这些信息迁入教师端单生详情。保留三组实验条件隔离，不能让 AI-PBL 和讲授组继承 PDT 流程。
2. **功能卡简化**：学生引用一张观察卡，填写功能名称和一句“如何实现”；提供“读取按键、判断条件、更新坐标、修改列表、返回结果”等快捷插入。AI/规则对照冻结蓝图检查七个基础职责是否覆盖，用简短问题提醒遗漏，不把蓝图名称直接当答案展示。
3. **保留单功能流程、移除系统路径门槛**：功能卡后进入 `ProjectMechanismStage`，学生逐张完成内部流程图，再直接进入建构；`ProjectPathStage`、全局系统关系、实现路径和前置拓扑锁定退出新 UI。旧工作区、旧产物和旧事件必须仍可读取，不得通过迁移删除。
4. **七函数建构工作区**：固定七张基础卡：初始化、方向、移动、食物、进食计分、碰撞、循环。左侧始终是同一个可运行贪吃蛇，右侧按响应式一行或一列切换函数；每卡包含连续 AI 对话、代码编辑、运行、报错、隐藏测试反馈和完成状态。七个函数必须由统一运行器真实组合，不能做七个互不相关的假演示。
5. **建构阶段 L0—L3**：L0 给定位用测试/打印代码，L1 给少量关键代码，L2 给接近完整的结构，L3 显示一次确认后给出当前函数经过测试的完整正确实现。学生自行输入或粘贴并运行；不得静默覆盖编辑器，也不得增加“原来哪里错了”“解释采用原因”等额外表单。记录 requested/effective level、AI 建议文本、后续代码版本和测试结果。
6. **创意功能卡**：基础功能完成后允许自由新增、命名、删除、启用和停用。每卡提供空白函数模板和连续 AI 对话，通过游戏开始、按键、移动前后、吃到食物、循环、结束等受控事件钩子接入同一运行器。限制文件、网络、动态依赖和无限循环；单个创意函数失败不能拖垮基础游戏。
7. **迁移任务（已退出当前开发）**：不要恢复网页迷宫学生工作台、教师“迁移测试”入口或自动播种。旧 `transfer_test` 数据仅作历史兼容；新的迁移测量需等待后续研究设计另行裁定。
8. **教师单生诊断**：集中查看画像、雷达图、知识图谱、观察/功能卡、七函数代码与测试、L0—L3 分布和创意功能。画像只影响 AI 语言具体程度和单轮颗粒度，不作为阶段门槛或能力排名。
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
- **未做**：浏览器验收、后端 pytest、Docker 健康检查。当前开发沙箱没有 Docker、没有 psql，`backend/venv` 是 macOS 二进制无法在此执行；本项只改学生端三个文件，未触碰后端。

**浏览器验收结果（使用者本机，2026-08-24）**：通过。登录后直接进入项目，不再经过学习首页。

### 第 2 项：功能卡简化 — 已完成并验收

提交：`816fd22 feat: simplify function cards to name and one sentence`。

设计要点：

- 新建功能卡只有三项：引用的观察卡、学生命名的功能、一句「这个功能如何实现」。实现描述用 `textarea`，淡化模板作为 placeholder（`先……；当……时……；最后……`），下方五个快捷短语「读取按键 / 判断条件 / 更新坐标 / 修改列表 / 返回结果」点击后插入**光标位置**，不覆盖已写内容。
- 移除的旧表单：输入、输出、知识点、验证方式、功能边界理由、人机责任标签、教师契约映射面板。这些字段**保留在 `StudentFunctionCard` 类型和历史数据里**，编辑一张旧卡时按 `...existing` 原值保留，不会被清空；`functionMappingArtifacts` 仍会上报历史卡已有的映射决定。
- 七函数覆盖检查改为新端点，**规则匹配、不调用模型**：`POST /api/research/tasks/{task_id}/blueprint/function-coverage`。复用 `_mapping_suggestions` 的评分，保证「覆盖检查」与「契约建议」对同一段文字给出一致判断。
- **不泄漏**是这个端点的核心约束：响应只有 `required_total` / `covered_total` / `uncovered_total` / `unmatched_card_count` / 每张卡 `matched` 布尔值 / 不含任何蓝图文本的简短问题。契约名称、同义表达、输入输出、场景描述、前置关系和隐藏测试一律不下发。提醒问题把学生推回自己的运行观察和未被引用的观察卡。
- 请求时机：只在保存卡片、删除卡片和学生主动点「重新检查一次」时请求，不随输入实时触发。

改动文件：

| 文件 | 改动 |
|---|---|
| `backend/app/api/endpoints/research.py` | 新增 `FunctionCoverage*` schema、`_coverage_result()`、`_coverage_questions()` 和 `function-coverage` 端点；沿用 `get_visible_task(require_active=True)` 与冻结蓝图读取 |
| `backend/tests/test_research_function_coverage.py` | 新增 13 条离线单元测试：required 才计入分母、实现描述参与匹配、可选节点不虚高覆盖、两张重复卡只覆盖一个节点、空名称卡不 422、提醒问题**不得出现蓝图文本**（参数化 4 条） |
| `frontend/components/ProjectFunctionStage.tsx` | 重写为简化功能卡；新增 `implementation` 字段、快捷插入、覆盖检查面板；已引用过的观察卡显示虚线边框 |
| `frontend/components/ProjectFunctionStage.css` | 新增实现描述框、快捷短语胶囊、覆盖检查面板样式 |
| `frontend/types.ts`、`frontend/services/api.ts` | 新增 `FunctionCoverageResponse` 与 `checkResearchFunctionCoverage()` |
| `frontend/services/stageEvents.ts` | `function_card` 产物内容增加 `implementation`，其余字段不变（保持旧产物可比） |
| `frontend/data/snakeProjectDemo.ts` | 给 7 张固定 demo 卡补 `implementation`，只补缺失值（`card.implementation ?? meta.implementation`），不覆盖 kero 之后的人工修改 |
| `frontend/views/Research.tsx` | 助手上下文摘要改为「功能名 + 实现描述 + 引用观察」，旧字段仅在历史卡上附带显示 |

验证状态（如实）：

```text
frontend/ npx tsc --noEmit                 通过
frontend/ npx vite build                   通过
backend/  python3 -m py_compile            通过（语法）
backend/  覆盖统计算法用等价桩核对          4/4 与预期一致
git diff --check                           通过
```

- 本机复核：覆盖检查针对性测试 `15 passed`；后端全量 `203 passed, 4 warnings`；改动后端文件 Ruff 通过；学生端 type-check / build 通过；管理端 lint / `15 passed` / build 通过。4 条 warning 仍是既有 `schema_json` Pydantic 命名提示。
- 浏览器验收：覆盖检查返回 `7/7` 且未出现教师函数名称、输入输出、同义词或隐藏测试文本；`1280×720` 无横向溢出，覆盖面板与底部操作区顺序正常。
- 验收时修复一处存量兼容遗漏：`upgradeSnakeProjectFunctionCards()` 已能只补缺失的 `implementation`，但 `Research.tsx` 的 kero 升级触发条件没有检查该字段，导致完整旧工作区永远不进入升级分支。补上 `!card.implementation` 后，7 张旧卡均获得实现描述且不会覆盖已有值。

### 第 3 项：移除流程/路径门槛 — 2026-08-24 历史实施，已被次日裁定部分撤销

> 本节保留当时的实施与验收记录，用于解释 git 历史；其中“移除单功能流程图”不再是当前产品要求。2026-08-25 的更正见本节末尾。

改动目标：PDT 新任务从功能卡直接进入函数建构，不再要求学生完成单功能机制图、系统关系图或实现路径；教师依赖和旧学生画布继续保存在工作区与研究证据中，只退出新任务主流程。

实施内容：

- PDT 顶部阶段栏由五步收敛为 `观察 → 拆功能 → 再建构`；AI-PBL 与讲授组仍保留自己的既有五阶段预览，不继承 PDT 的新流程。
- 功能卡确认成功并写入 `decompose/stage_confirm` 后直接进入 `build`。`Research.tsx` 不再挂载 `ProjectMechanismStage` / `ProjectPathStage`，也不再产生新的 `model` / `plan` 阶段确认事件；旧组件和事件类型没有删除。
- 过渡建构页按功能卡稳定顺序形成建构单元，不再读取学生路径的拓扑顺序；移除前置函数锁定，任一函数均可直接编辑与运行测试。第 4 项仍会把该过渡页升级为固定七张基础函数卡与统一运行器。
- 测试失败后只提供“补充观察 / 修订功能卡 / 继续在这里改”，不再把学生送回已退出主流程的机制图或路径图。
- 建构页回退统一返回功能卡；旧 `input/output/verification` 不再作为主要建构信息，卡内显示引用观察和一句实现描述，历史卡没有实现描述时才用旧输入输出作兼容回显。
- 浮动助手的新任务说明只引用观察卡、功能卡、函数进度、当前代码与测试反馈，不再引导学生填写流程图和实现路径。

兼容边界：

- `SnakeProjectWorkspace.path`、`functionMechanisms`、`orderedCardIds`、`prerequisites`、旧机制/路径产物与 `model/plan` 事件均未迁移、删除或覆盖；工作区收集、保存和教师侧读取路径保持原状。
- 建构进度继续读取 `cardId::blueprintNodeId`，并保留旧 `cardId` 键回退。
- 本地数据库只读核验 kero 最新快照仍含：7 张功能卡、7 张旧机制图、7 个旧顺序项、6 组旧前置关系和 6 个旧进度项。

验证状态：

```text
backend/  pytest -q                         203 passed, 4 warnings
frontend/ npm run type-check                passed
frontend/ npm run build                     passed
admin/    lint + 15 tests + build           passed（第 2 项回归）
Docker    backend/frontend rebuild          passed
GET       http://localhost:8003/health      200，PostgreSQL / Neo4j connected
git diff --check                            passed
```

真实浏览器 `kero` 验收：顶部只显示三阶段；功能卡按钮文案为“进入函数建构”且成功直达建构；第 6 个函数可在未按旧路径逐步解锁的情况下直接运行测试并通过；返回按钮回到功能卡；浏览器控制台无 error/warning。`1280×720` 下页面宽度为 1280、无横向溢出，阶段栏、游戏、编辑器、模块测试与底部按钮均可达。

尚未覆盖：空白新学生的完整新链路仍需在第 4 项固定七函数工作区完成后一起验收；本项没有新增前端测试运行器。

下一项：**第 4 项 七函数建构工作区** —— 固定七张基础功能卡，左侧同一个贪吃蛇由七个学生函数真实组合，右侧统一呈现对话、代码、运行、错误与隐藏测试反馈。

### 2026-08-25 第 3 项裁定更正：恢复单功能流程图

使用者确认“针对功能的流程图还是需要学生画”。最终边界修正为：

- 2026-08-25 当时的 PDT 主流程是 `运行观察 → 功能卡 → 单功能流程图 → 七函数建构 → 创意扩展 → 网页迷宫寻宝`；2026-09-01 进一步把正式迁移改为本地 Pi 目标方案，网页迷宫保留为原型；
- 恢复 `ProjectMechanismStage` 及其 `model/structure_change`、`model/stage_confirm` 证据；学生必须逐张完成自己功能卡的内部流程；
- 流程画布只读取学生自己的观察引用、功能名称和一句实现描述，不恢复旧功能卡的输入、输出、知识点、验证方式，也不下发教师蓝图文本；
- `ProjectPathStage`、全局系统关系、实现路径、拓扑排序和前置编码锁定继续退出新流程；
- 建构页返回与测试失败后的修订入口均可回到单功能流程图；
- 七函数与创意卡切换区改为类似 VS Code 的可折叠侧栏，默认折叠，给代码编辑器保留更多横向与纵向空间；展开/折叠偏好按任务保存在本机。

本次更正不迁移或删除任何旧 `functionMechanisms`、路径、产物版本或事件。

验证状态：

```text
frontend/ npm run type-check                passed
frontend/ npm run build                     passed
backend/  pytest -q                         210 passed, 4 existing warnings
admin/    15 tests + build                  passed
Docker    frontend/backend rebuild          passed
GET       http://localhost:8003/health      200，PostgreSQL / Neo4j connected
git diff --check                            passed
```

全仓 Ruff 仍报告 28 个既有问题，均不在本次前端改动文件，未混入无关修复。

真实浏览器 `kero` 验收（`1280×720`）：顶部显示 `观察 → 拆功能 → 画流程 → 再建构`；当前 6/7 流程时直接点“再建构”会停在流程阶段并显示门槛提示，确认最后一张后成为 7/7 并成功进入建构；页面不存在系统关系或路径规划入口。流程页只显示引用观察与实现描述。建构页函数/创意卡侧栏默认折叠为 54px，代码区约 `746×230px`；展开为 224px 后显示名称和签名，折叠/展开偏好与当前阶段均可刷新恢复。页面无横向溢出，控制台无 warning/error。

### 2026-08-24 第 4 项完成记录（Codex）

提交前状态：代码与浏览器验收均已完成，提交号见本节后的 git log。

实施内容：

- 建构单元不再从学生旧功能卡、契约映射或路径推断。右侧始终固定呈现七张公开基础卡：初始化与重置、更新方向、移动蛇身、生成食物、进食/增长/计分、碰撞判断、游戏循环；学生可以从任意卡开始。
- 学生可见卡片元数据收敛到 `frontend/data/snakeBuildFunctions.ts`，只含固定名称、函数签名、空白起始代码和通过后的可观察效果；教师同义表达、推荐依赖、场景、知识点、测试数据和支架规则不进入该文件或学生 API。
- 第七个 `step_game(state, user_input)` 由“平台提供”改为学生可编辑、可运行和可验证的真实函数。循环测试与实际运行会在同一 Python 命名空间中读取前六段已通过代码；前六段未通过时只给短问题，不做界面锁定。
- 单函数检查、重置和连续游戏帧共用一个 Pyodide Web Worker，并用串行队列避免测试与游戏帧争用。代码集合不变时复用 Worker 内的 Python 命名空间；离开建构页后释放。
- 左侧不再按能力 ID 用 JavaScript 假演示。未完成循环前，由同一 Worker 的安全装配器逐项调用已通过函数；循环通过后，每一帧直接执行学生的 `step_game`。游戏状态经受限 JSON 契约往返，不向服务器发送按键、代码运行帧或中间状态。
- Worker 在 Pyodide 同源启动后关闭 `fetch` / `WebSocket`，拒绝超过 200 KB 的返回值；单次执行 5 秒超时会终止 Worker。主线程额外校验方向、坐标、蛇身长度、得分和结束状态，异常帧停止但不拖垮页面，后续正确代码可重新启动 Worker。
- 新进度写到稳定键 `base::<blueprintNodeId>`；读取时先查新键，再按 `blueprintNodeId` 兼容旧 `cardId::nodeId` 和旧 `cardId` 记录。修改任一前六函数会撤销旧循环的已验证状态，但不会锁住学生继续编辑或测试。
- 刷新恢复补齐两层：有持久化 token 时先等待用户与当前任务解析，不再提前落到总览；项目阶段写入任务级本地键，存量工作区没有阶段键但已有测试进度时恢复到建构。工作区与旧路径/机制数据保持原样。

测试边界：

- 浏览器内执行的是**本地行为检查**，学生界面只显示通过或短问题；它不是教师蓝图正式隐藏用例的副本。正式隐藏测试数据仍只保存在管理员蓝图，没有通过学生 API 下发。由于产品同时要求“全部代码只在浏览器执行”和“测试对检查浏览器源码的学生严格保密”，两者无法形成密码学意义上的真隐藏；当前实现按课堂 UI 隐藏处理，后续若要求对源码检查也保密，必须重新裁定是否允许服务器执行或可信执行环境。
- 空白新学生无需功能卡映射也能看到固定七卡，但本轮尚未创建第二个真实账号走完观察→功能→七函数的全链路；该项与三组实验条件的完整浏览器矩阵仍列入总验收。

验证状态：

```text
frontend/ npm run type-check                passed
frontend/ npm run build                     passed
backend/  pytest -q                         203 passed, 4 existing warnings
admin/    15 tests + build                  passed
Docker    frontend rebuild                  passed
git diff --check                            passed
backend/  ruff check app/ tests/            failed: 28 个既有全仓 lint 问题，本项未改后端且未混入清理
```

真实浏览器 `kero` 验收（`1280×720`）：固定七卡与 `7/7` 状态可见；六段旧代码兼容装配；补上循环后棋盘由七段 Python 代码连续推进；把食物固定在蛇头下一格后，同一运行帧完成移动、进食、增长和 `010` 计分；刷新后自动回到建构并恢复 `7/7`；网络访问被拒绝；无限循环 5 秒终止，恢复正确代码后无需刷新即可再次通过；页面 `body/document scrollWidth = 1280`，无横向溢出，浏览器日志为空。验收中临时代码均已恢复为 kero 原函数，循环函数保留为新增第七段兼容样例。

下一项：**第 5 项 建构阶段 L0—L3** —— 按当前固定函数、代码和最近测试反馈收敛支架；L3 一次确认后给出完整正确函数，不自动写入编辑器、不新增解释表单。

### 2026-08-25 第 5 项完成记录（Codex）

实施内容：

- 建构支架从通用四级规则中独立出来：L0 只给测试、断言或打印代码；L1 只给少量关键代码；L2 给当前函数接近完整、保留明确空位的结构；L3 在一次明确确认后给当前函数完整正确实现。冻结蓝图中的四级描述和代码行边界同步到这套裁定。
- 七个固定函数的 L0—L3 代码由后端按稳定函数 ID 受控返回，不把服务端蓝图、隐藏测试或其他函数答案下发，也不让模型越级改写已通过行为检查的 L3 实现。未知模块和其他项目/阶段继续走原 AI 链路。
- 未确认的建构 L3 在服务端按 L2 生效；确认后以 `l3_confirmed + l3Confirmed` 请求 L3，旧冻结策略中的 5 行上限不再压低最新建构 L3。请求等级、生效等级、建议文本、代码指纹、最近测试反馈和消息关联仍进入既有聊天/支架事件链；后续代码与测试版本继续由建构测试事件记录，没有新增数据库表或学生填写项。
- 助手用固定函数 ID 作为上下文键，每张函数卡分别保存本次页面会话中的等级与消息；切换任务时通过组件 `key={task.id}` 隔离状态。L3 确认按“任务 + 函数”保存在本地，刷新后不重复确认。
- L3 只在助手中展示代码，学生必须自行复制或输入并运行；没有调用编辑器写入接口，也没有增加“解释原错误”“采用理由”等表单。

验证状态：

```text
backend/  pytest -q                         209 passed, 4 existing warnings
backend/  changed-file ruff                 passed
frontend/ npm run type-check                passed
frontend/ npm run build                     passed
admin/    15 tests + build                  passed
git diff --check                            passed
backend/  ruff check app/ tests/            failed: 28 个既有全仓 lint 问题，本项改动文件为 0
```

真实浏览器 `kero` 验收（`1280×720`）：移动蛇身依次得到 L0 定位断言、L1 关键代码、L2 带单一 `TODO` 的函数结构；从 L2 升 L3 时先显示确认面板，确认后返回经过组合测试的完整 `move_snake`。全过程编辑器内容保持不变，未出现额外解释表单。收起助手后切换到生成食物，显示独立 L0 空会话；切回移动蛇身恢复原 L3 历史。刷新后项目恢复到建构阶段，再次走到 L3 时直接返回完整函数、不重复确认；浏览器控制台为空。

尚未覆盖：空白新学生和三组实验条件的完整浏览器矩阵仍留到总验收；创意函数异常隔离属于第 6 项。聊天链路在正常前端交互下使用唯一 UUID，但消息、模型调用、画像分析与支架事件的事务级并发幂等仍是独立证据链技术债，本项没有把部分修补写成已经完成。

下一项：**第 6 项 创意功能卡与受控事件钩子** —— 基础功能完成后允许自由新增、命名、删除、启停，通过统一运行器的受控游戏事件接入，并保证单卡异常隔离。

### 2026-08-25 第 6 项完成记录（Codex）

实施内容：

- 七个基础函数全部通过后解锁创意区；学生可新增、命名、删除、测试、启用和停用创意卡。每张卡使用独立稳定 UUID、空白 `creative_feature(event, state)` 模板、独立测试历史和任务级本地/服务端工作区恢复；单项目最多 12 张、单卡代码最多 12000 字符，避免低配置课堂设备被无界数据拖慢。
- 公共受控钩子固定为：游戏开始、有效方向输入、移动前、移动后、吃到食物、每次循环、游戏结束。历史卡可保留单一钩子；新卡默认接收所有受控事件，由函数通过 `event.type` 区分 `start/key/before_move/move/eat/loop/end`。函数可修改 `snake/direction/food/score/game_over/interval/objects` 安全状态，返回状态应用修改，返回 `None` 保持原状态。
- 基础函数和创意函数复用同一个浏览器 Worker 与串行执行队列。每张已启用创意卡单独执行：普通异常、非法状态和 200 KB 结果上限在当前卡内捕获；无限循环触发 5 秒终止并重建 Worker。出错卡自动停用、写入一次运行失败证据，基础游戏与其他卡继续。
- 创意命名空间只暴露基础 Python 值与集合操作；AST 拒绝导入、文件访问、动态执行、反射和双下划线属性。Worker 仍在 Pyodide 加载后关闭 `fetch/WebSocket`，因此创意代码不能访问文件、网络或动态依赖。
- 创意卡复用既有 `module_code` 产物类型，以 `creative::<UUID>` 稳定键记录新增、代码测试、启停、运行隔离和删除墓碑；工作区签名、跨设备快照、最终代码拼装与 AI 摘要均加入 `creativeFunctions`。旧工作区字段可缺省，读取时自动视为空数组。
- 浮动助手以创意卡稳定 ID 保存独立连续会话；创意 L0—L2 继续走等级边界，确认后的 L3 允许模型只补全当前创意函数。修复了研究模式通用提示与创意 L3 “可给完整当前函数”互相冲突的问题。
- 基础项目通过后的底部动作改为“开始/继续创意扩展”，不再提前把整个研究任务标记完成；正式完成动作留给下一项迷宫迁移。

验证状态：

```text
backend/  pytest -q                         210 passed, 4 existing warnings
backend/  changed-file ruff                 passed
frontend/ npm run type-check                passed
frontend/ npm run build                     passed
admin/    15 tests + build                  passed
Docker    backend/frontend rebuild          passed
git diff --check                            passed
```

真实浏览器 `kero` 验收（`1280×720`）：创意卡创建后先测试再启用；“移动后得分 +1”在同一个游戏中连续三帧得到 `003`，不是独立假演示。条件性普通异常出现后卡片自动停用而基础循环仍在运行；条件性无限循环在 5 秒后显示隔离提示，Worker 恢复后基础循环继续。`import os` 与 `open(...)` 均被拒绝。刷新后卡名、代码、钩子、验证状态和停用状态恢复；基础函数与创意卡助手会话分别为 0/2 条消息，切回创意卡可恢复原对话。页面 `body/document/innerWidth = 1280`，无横向溢出，浏览器 warning/error 日志为空。

验收账号最终保留一张**已验证但未启用**的安全样例“验收样例：移动后加分”，方便早晨直接检查；异常与无限循环临时代码均已移除。空白新学生和三组实验条件的完整矩阵仍留到总验收。

当时的下一项：**第 7 项 网页迷宫寻宝迁移原型** —— 用迁移项目预测试学生能否迁移状态、输入、规则、边界与测试方法，并把迁移过程纳入证据链。正式实验目标后来调整为本地 Pi 任务包。

### 2026-08-25 项目学习助手 Harness 完成记录（Codex）

实施定位：

- 参考 DeepSeek Harness 的“可重建上下文、作用域化动态提示、事件持久化”思想，在现有 CogniSync 聊天、支架策略和研究事件链之上增加 `LearningAgentHarness` 编排层；没有直接引入其运行时或插件系统。
- 当前实现是**项目学习助手的教学智能体编排层**，不是已经完成的全平台通用自主智能体。模型没有文件、网络、学生代码执行或隐藏测试工具；教师蓝图策略、L0—L3 受控回复和浏览器本地运行器仍由现有确定性服务负责。

实施内容：

- 每轮项目助手请求生成稳定上下文键 `task + stage + focus`。建构环节的 `focus` 是当前基础/创意函数 ID；其他环节使用当前阶段。该键随聊天消息元数据持久化，可在教师导出和后续分析中重建。
- 模型历史先读取较宽的持久化窗口，再只保留同任务、同阶段、同功能卡的消息；项目助手不再注入普通聊天的跨会话主题。当前 UI 阶段和功能卡作为权威上下文，旧对话不能反向覆盖。
- 前端按当前阶段裁剪可见产物：观察只提供运行与观察卡；拆功能增加学生功能卡；画流程增加学生功能内部流程；建构只增加当前函数代码、测试反馈和当前模块进度。历史教师契约映射名称不再进入助手摘要。
- 七个基础函数的受控 L0—L3 回复会先说明当前函数卡，并概括当前编辑器函数名、代码行数和最近测试反馈；询问“我在哪张卡”时直接回答当前卡，不再重复一段与提问无关的固定测试代码。L3 一次确认、冻结答案和不自动写入编辑器的边界保持不变。
- 学生产物仍被视为不可信数据：名称、实现描述、代码与摘要不能在系统提示中充当指令；本项没有扩大模型权限，也没有下发教师隐藏测试文本。

验证状态：

```text
backend/  pytest -q                         212 passed, 4 existing warnings
backend/  changed-file ruff                 passed
backend/  changed-file py_compile           passed
frontend/ npx tsc --noEmit                  passed
frontend/ npm run build                     passed（仅既有 >500 KB 编辑器块警告）
admin/    npm run build                     passed
git diff --check                            passed
```

真实浏览器 `kero` 验收（`1280×720`）：在初始化卡提问时助手明确识别“初始化与重置”；切回观察后只提示蛇的可观察坐标变化，不再引用函数语法错误；再进入建构并切换到 `movement`，助手明确识别“移动蛇身”，当前编辑器也保持同一张卡。一次修复前的错误观察回复已作为真实研究消息留在 kero 历史中，没有为了让验收记录好看而删除；后续同环节回复已验证纠正。

论文表述边界：可以写“系统实现了面向项目学习的智能体式上下文与支架编排层”，不能据此写成“已实现具有自主规划、工具调用和多智能体协作的通用智能体平台”，也不能把本轮浏览器验收写成学习效果已经得到实证验证。

#### 2026-08-25 观察完成态补充修复（Codex）

- 观察页原本只在“进入功能拆解”按钮中判断“运行过项目 + 至少 2 张观察卡”，Agent 虽能读到观察卡文本，却没有完成态决策，因此会在 L0—L3 中重复追问。现在学生端把同一完成条件写入本轮助手上下文，后端对已完成观察阶段的通用提示和升级请求使用确定性回复：确认已有卡片，不再要求重复观察，并引导进入拆功能。
- 已完成时助手空状态直接显示观察环节完成、已读取卡片数量和下一阶段；隐藏“再具体一级”与“采用最小补全”。学生如果针对某张观察卡提出具体问题，仍进入正常 Agent 回答链路，不会被强制跳转。
- 回归：后端 `214 passed`；学生端类型检查与构建、管理端构建、改动文件 Ruff/py_compile、`git diff --check` 均通过。`kero` 在 `1280×720` 下读取 7 张观察卡并得到“进入拆功能”的完成态回复，未再出现坐标追问。

#### 2026-08-25 助手窗口输入与尺寸调整（Codex）

- 对话输入改为 `Enter` 发送、`Shift+Enter` 换行，并避开中文输入法组合态；输入框的 placeholder、无障碍标签和悬停说明同步提示快捷键。
- 桌面端助手默认宽度从 `680px` 收窄到 `520px`，高度使用可用视口；四条边和四个角均可拖动缩放，窗口移动、缩放及浏览器尺寸变化后仍限制在可见区域。移动端继续使用固定的近全屏布局，不启用边框缩放。
- 学生端 `tsc --noEmit`、`vite build`、`git diff --check` 通过。真实浏览器在 `1280×720` 验证：默认窗口 `520×630`；左边框可拉宽到 `620px` 且右缘保持不动，右边框可再拉回；`Shift+Enter` 得到两行文本且消息数不变；临时关闭本地后端后按 `Enter`，前端只生成 1 条消息并清空输入框，确认未把 QA 对话写入研究数据。

#### 2026-08-25 单项目直达与分组课堂任务（Codex）

- 已分组的 PDT、AI-PBL 和 Lecture 学生登录或刷新后直接进入唯一项目工作区，不再经过画像/学习首页；首页与独立 AI 对话也从这三组的视图权限和导航中移除。未分组账号仍进入等待页，避免教师尚未分组时出现无路可走的空白界面。
- 项目顶部删除返回按钮、`PROJECT_001`、重复的项目名称和工作台标题，只保留阶段导航、图标化保存状态、课堂任务、组内允许的提示、完整项目和退出登录。Lecture 组不渲染提示入口；教师尚未发布任务的空状态也补有退出登录，避免单项目直达后把学生锁在页面里。
- 三组各有一份短课堂任务：PDT 为“项目侦探，集合”，AI-PBL 为“和 AI 组队，方向盘在你手里”，Lecture 为“最后的代码手艺人”。文案不使用“实验组/对照组”等比较性称呼，避免向学生暗示组间优劣。首次进入当前任务自动显示小浮窗，关闭后以 `用户 + 任务 + 分组 + 文案版本` 为键保存在浏览器本地；刷新不再弹出，右上角课堂任务图标可随时重开。该偏好不写入研究事件或学生产物。
- 真实浏览器 `kero` 验收（`1280×720`）：登录直接到项目；顶部高度约 `71px`，`PROJECT_001`、重复标题、学习首页和独立 AI 对话不可见；首次浮窗为 `440×341px`，关闭后刷新不再出现，任务图标可重新打开；`body/document scrollWidth = 1280`，无横向溢出，浏览器控制台无 warning/error。学生端 `tsc --noEmit`、生产构建和 `git diff --check` 通过；构建只有既有 Monaco 大分包警告。

#### 2026-08-26 可观察创意运行器、调试终端与 L3 持续协作（Codex）

- 建构编辑器下方增加默认收起的 Python 调试终端，展示测试命令、`print()`/标准错误输出、测试结果与创意状态摘要；输出最多保留 180 行，每次 Python 运行最多接收 200 行，展开偏好按任务本地保存。
- 修复“创意测试通过但页面无变化”的根因：`interval` 现在从初始帧就是真实游戏状态，统一运行器直接用它调整每帧间隔，不再使用独立的页面隐式变速。未接入的顶层状态会返回 `CREATIVE_UNSUPPORTED_STATE`；安全运行但无任何可观察变化会返回 `CREATIVE_NO_EFFECT`，不再出现假通过。
- 创意安全状态增加 `objects`协议：每帧最多 48 个对象，对象可使用 `id/type/position/label/solid/active/data`；坐标、类型、数量和 `data` 基础类型都在主线程重新校验。共享棋盘已为 `obstacle/wall`、`bomb`、`portal`、`bonus`、`shield` 和 `custom` 提供可视化；学生通过同一事件函数修改状态来定义碰撞、爆炸、传送、奖励等行为。这是可扩展的受控协议，不是任意 DOM、文件或网络权限。
- 新创意卡仍只有名称和空白函数，默认接收七类受控事件。为兼容存量卡，未读取事件的历史函数仍按原 hook 执行；显式读取 `event.type/event.hook` 的函数由自身路由所有受控事件。学生可见 `event.type` 统一为 `start/key/before_move/move/eat/loop/end`，内部 hook 仍保留用于历史与研究记录。
- 建构 L3 确认改为当前函数的持续协作权限：首次确认仍返回平台验证的完整函数，后续问题不再机械重复标准答案，而是围绕当前代码直接引用、修改、补全和解释完整当前函数。确认状态刷新后恢复为 L3，不再退回 L0。模型仍没有编辑器写入、代码执行、文件或网络权限。
- 真实浏览器 `kero` 验收（`1280×720`）：存量“加速”卡使用 `event.type == "eat"` 且保留历史 `after_move` hook，兼容路由后本地测试通过；真实控制蛇吃到食物，得分 `000 → 010`、间隔 `360ms → 324ms`。同一卡临时产生 4 个对象，棋盘实际绘制“墙”、炸弹、传送门和奖励星；验收后已恢复原加速代码、重新测试并启用，没有保留临时对象代码。
- 验证：后端 `pytest -q` 为 `216 passed, 4 existing warnings`；改动文件 Ruff 通过；学生端 `tsc --noEmit` 与生产构建通过；管理端生产构建通过；学生端只有既有 Monaco `>500 KB` 分包警告。

#### 2026-08-26 仓库清理与聊天容量边界修复（Codex）

- 已将误纳入 Git 的 `测试/myenv/` 本地 Conda/Python 环境从版本跟踪中移除，并加入 `.gitignore`；本地环境文件保留可用，没有改写 Git 历史。历史提交中曾包含一个 token 形态文件，新 HEAD 已不再跟踪，但远端历史仍需后续单独决定是否轮换密钥与清理历史。
- 删除了已证实无引用的旧 `ProjectPathStage` 与两个学生画像组件；`ProjectMechanismStage` 保留，它是学生必须完成的“单个功能内部流程图”，不得再与已放弃的建构路径规划混淆。
- 修复聊天事务边界：历史消息和跨会话上下文读取后，在等待外部模型前显式结束只读事务，避免全班齐发时用模型等待占满 PostgreSQL 连接池。
- 文本分析和对话生成分别使用 `LLM_ANALYSIS_TIMEOUT_SECONDS=15` 与 `LLM_CHAT_TIMEOUT_SECONDS=30` 整轮预算。重试只由 provider 层统一处理，端点不再叠加第二层两次重试，避免上游故障时把一轮学生操作放大为最多六次请求。分析超时使用原有规则降级；对话最终失败仍返回 503，不伪造建议。
- 新增真实 PostgreSQL 的 40 名独立学生聊天并发测试。所有请求同时停在可控模型等待点时，连接池 `checkedout()==0`，释放后 40 个完整聊天请求均返回 200。这证明数据库事务边界，**不证明真实 DeepSeek 供应商容量**；正式学校实验前仍需在目标服务器记录 P50/P95、错误率与模型排队时间。
- 验证：后端 `219 passed, 4 existing warnings`；改动文件 Ruff、`git diff --check` 通过。

#### 2026-08-26 教师“布置测试”与迷宫迁移工作台（Codex，`c87591b`）

- 任务模型新增 `learning` 与 `transfer_test` 两种用途；激活唯一性改为“实验条件 + 任务用途”，因此发布迁移测试不会归档正在使用的贪吃蛇学习任务。学生有活动测试时优先进入测试，教师归档后自动回到原学习任务。
- 教师端新增独立“布置测试”页。首版只允许冻结的 `maze_treasure_v1` 可视化模板，可选发布范围和是否开启 AI。发布后任务用途、模板和 AI 条件冻结，需改动时新建版本，避免正式实验中途改变条件。
- 学生端为左侧迷宫可视化运行器 + 右侧函数建构台。函数侧栏可收起，学生可添加、命名、删除辅助函数；统一入口为 `next_move(state)`。下方终端显示打印、语法错误、撞墙、越界、无效方向与未到终点等结果。
- Python 代码仅在浏览器 Worker 中运行，禁止导入、文件、动态执行和双下划线属性，单次上限 5 秒。它是可视化行为检查，不下发教师隐藏测试，也不应在论文中写成服务器安全沙箱。
- AI 开关由后端强制：关闭时伪造支架请求仍在任何消息、求助事件或支架证据写入前返回 403。开启时，Harness 使用 `task + transfer + 当前函数卡` 隔离对话，读取当前代码和测试反馈。该段落记录的是 2026-08-26 的旧实现；2026-09-01 最新裁定已改为正式迁移测试从第一轮直接开放 L3，不再沿用学习建构阶段的逐级确认边界。
- 工作区快照、代码进度、模块测试事件、模块代码版本和最终提交仍进入原有研究证据链，没有另建无法导出的平行数据孤岛。
- 验证：新增 6 条迁移回归用例与 1 条 L3 边界用例；后端完整 `226 passed, 4 existing warnings`，Ruff 通过；学生端和管理端 `tsc --noEmit` 通过，两端生产构建通过，管理端 15 条 Vitest 通过。**尚未进行真实浏览器验收**：本机 gstack browse 需要用户同意的一次性构建，不得把自动验证写成浏览器通过。

#### 2026-09-01 个性化可运行模板与迁移 AI 开放裁定（Codex）

- 学习阶段的 Agent 模板由现有单 Harness 编排，不新增多智能体：复用画像、Neo4j 知识图谱、冻结蓝图知识点、当前代码/测试反馈和 `creative-v2` 能力契约；模板必须语法正确、可运行、有注释和少量 TODO。
- 画像和知识图谱只调节模板颗粒度，不改变学习目标或 L0—L3等级。知识图谱现在向 Harness保留掌握度、频次和学生标记；只采用与当前冻结课程概念匹配的节点，避免无关知识越界。
- 当前仓库没有正式教材及版本化教材检索，`textbookRetrievalEnabled=false`。本轮以冻结蓝图知识点和教师任务目标作为课程边界，不能在论文中写成教材 RAG 已实现。
- 正式迷宫迁移测试仍为所有学生提供同一空白骨架；教师开启 AI 时，前后端从第一轮直接进入 L3完整代码协作，不再要求逐级解锁。教师关闭 AI 时后端继续在写消息和事件前返回 403。
- 支架计划随消息元数据保存上下文版本、模板密度、蓝图版本、课程概念和实际图谱证据；没有新增数据库表、模型角色或第二次 DeepSeek 调用。
- 架构、研究假设、开源参考、4 GB 最低配置与 8 GB 推荐配置详见 `docs/LEARNING_AGENT_HARNESS_ARCHITECTURE.md` 第 19 节。

#### 2026-09-01 平台定位与本地 Pi 迁移包裁定

- CogniSync 的主要用途确定为课堂项目解构教学与前期学习过程采集，平台内主流程止于完整项目运行和创意扩展；它不以通用代码工作站或全流程自主 Agent 平台为目标。
- 正式迁移目标为个人化下载包：学生点击开始时平台记录 `issued_at` 并绑定 `assignment_id`；解压后由统一脚本记录 `started_at`，以该目录启动固定版本 Pi；提交脚本按白名单打包最终代码、测试事件、任务/模型版本、哈希和 Pi 会话 JSONL，平台记录 `submitted_at` 后运行最终隐藏测试。
- `REPORT.md` 只承担少量事后反思，不能代替自动过程日志。API Key、`.env`、个人目录和依赖文件不得进入提交包；正式实验只能统一使用一种 Agent、同一模型、提示、工具权限和任务骨架。
- 当前网页 `maze_treasure_v1`、教师“布置测试”和证据链全部保留，作为已实现原型和预测试工具。下载生成、跨平台脚本、Pi 固定配置、短期令牌、上传解析、日志脱敏与教师迁移轨迹页均尚未实现，后续不得把目标设计写成现有功能。

## 必读文件（按顺序）

后续讨论智能体架构、学校实验或论文方法部分时，先读 `docs/LEARNING_AGENT_HARNESS_ARCHITECTURE.md`；该文档区分了当前实现、论文可用表述、待验证主张和未来规划/多智能体演进。

2026-08-28 起开发“学生 Python 创意逻辑 + 通用浏览器渲染 + Agent 个性化模板 + DeepSeek API 调度优化”时，必须再完整阅读 `docs/CREATIVE_RUNTIME_V2_DEVELOPMENT_HANDOFF.md`。该文件是下一阶段方案，不代表功能已经实现；开发必须按其中提交边界逐项完成。

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
20. `frontend/components/ProjectBuildStage.tsx`
21. `frontend/components/ProjectScaffoldAssistant.tsx`
22. `frontend/data/snakeProjectBlueprint.ts`
23. `frontend/data/snakeProjectDemo.ts`
24. `admin-frontend/src/pages/ResearchManagement.tsx`
25. `admin-frontend/src/lib/projectBlueprint.ts`

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

### 尚未纳入当前学生流程改造的证据链专项

- 聊天链路的完整幂等：消息、LLM 调用、画像分析、支架事件需要一起幂等。
  当前前端不会自动重放聊天请求，因此暂不会产生重复记录；
  `_record_help_request_event` 传 `request_fingerprint=None`，chat 路径的
  幂等键复用检测目前不生效（只会重放）；
- 不新增“是否采用/解释原因”表单；`scaffold_events.adopted` 继续保持 `NULL`，后续研究分析根据 AI 建议、代码版本和测试结果推断，不能用额外填写增加学生负担；
- 更复杂的 AI 依赖分析。

## 当前仍需注意的技术债

- 最新工作区仍是 JSONB 整份快照，用于跨设备恢复；正式研究分析请读
  `artifact_versions` 版本链，两者是双写关系，本轮**没有**切换读取源；
- 学生对教师契约的采纳决定已作为独立的 `function_mapping` 产物记录，
  不再只随工作区快照保存；
- 本地 `snakeProjectBlueprint.ts` 仍用于旧任务兼容和浏览器测试模板，不能把它重新当成所有任务的教师答案源；
- 建构进度已支持 `cardId::blueprintNodeId` 单元键，并兼容旧 `cardId` 键；后续迁移必须保持读取兼容；
- `ResearchCodeEditor` 构建块仍较大，但已按阶段懒加载；在没有性能数据前不要为了消除 Vite 警告引入复杂依赖；
- Pyodide 已由前端构建脚本下载为本地静态资源；正式部署仍需验证缓存策略、无外部 CDN 和学校机房首次加载；
- 学生端已引入 Vitest 并开始覆盖运行器纯逻辑；后续创意能力、确定性随机和场景协议必须继续补行为测试，不能只依赖 `tsc` 与构建；
- 重复提交检测的 `RAISE EXCEPTION` 在 `init_db` 中执行，一条历史重复行会阻止后端启动。
  不删数据是刻意的，但这个检查更适合放进一次性运维任务；处理脚本是
  `scripts/repair_duplicate_submissions.sql`；
- 后端测试存在 4 条 Pydantic `schema_json` 命名警告，不是当前功能回归，但可以单独提交修复，不能混入研究功能提交。
