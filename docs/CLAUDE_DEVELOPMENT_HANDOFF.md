# CogniSync 后续开发交接（给 Claude）

> 交接分支：`codex/final-quasi-experiment-dev`
> 起点：包含提交 `feat: add student-owned function mapping` 的最新 HEAD。
> 产品定位：CogniSync——AI 时代的项目解构式编程学习平台；从解构，到建构。

## 可直接复制给 Claude 的提示词

你将接手 CogniSync 的后续开发。请先完整阅读本提示词列出的文件，再检查当前分支、工作树、Docker 服务与已有测试。不要凭截图重新发明架构，也不要一次性重写学生端或教师端。

当前研究目标是支持“人智协同环境下高中生编程复杂技能培养的项目解构式教学设计”。平台不是普通在线编程题库：学生需要从完整项目的可观察运行证据出发，形成观察卡、功能卡、单功能内部流程、系统功能关系、实现路径，再逐模块建构和验证。教师蓝图是诊断参照和安全边界，不是直接展示给学生的标准答案。

必须保持以下边界：

1. 学生保留核心认知责任。系统可以给候选、反馈和 L0—L3 渐进支架，但不得自动判整张图、自动替学生确定模块或偷偷补全路径。
2. 教师蓝图发布后不可原地覆盖；学生产生记录后始终关联冻结的蓝图版本。不得向学生下发教师同义词、标准前置关系、隐藏测试、支架内部规则和完整函数答案。
3. “理关系”表达单个功能内部如何实现；“定路径”表达多个功能如何协作及学生准备按什么顺序建构。不要再次混合这两层。
4. 默认适配 `1366×768`、`1280×720` 和学校低配置电脑。画布、游戏与拓扑在浏览器本地运行；拖拽、按键和每帧状态不得请求服务器。AI 只在学生主动求助或明确诊断时调用。
5. 当前课堂规模按 40—50 人并发设计。继续使用 PostgreSQL 最新工作区快照做跨设备恢复，但研究证据需逐步迁移为不可覆盖的版本/事件；不要为了“性能”提前引入 Redis。只有在压测证明存在跨进程共享缓存、限流或任务队列需求时再评估。
6. `kero/kero` 是开发验收账号，允许自动补齐演示数据，但只能给固定 demo ID 做缺字段迁移，不能覆盖该账号之后的人工修改，更不能影响真实学生。
7. 不要修改或提交用户的论文与比赛材料目录。特别不要纳入：`edustar比赛材料重新准备/`、`项目报告配图重绘提示词.md`。

当前已经完成：

- 教师蓝图版本、草稿、发布与学生冻结版本；
- 教师端项目与现象、模块契约、关系规划、隐藏测试、六阶段 L0—L3 支架策略；
- 学生端完整项目观察、功能卡、单功能流程画布、系统关系/路径画布、逐模块 Python Worker 测试和局部游戏装配；
- 浮动 AI 助手读取当前任务工作区、阶段、代码与测试信息，记录提示等级；当前主链路已可用，但仍需随第 5 项补全可审计的“建议—采用—修改—结果”事件关系；
- 学生功能边界、人机责任标签和开放映射：后端从冻结蓝图返回去敏候选，学生可以多选、拒绝或未映射；建构页只读取学生确认结果，一张功能卡可以展开为多个建构单元；
- 教师当前蓝图 `docs/teacher-blueprints/snake-project-v2.json` 已发布到本地数据库。

按下面顺序继续，每一项独立开发、测试、浏览器验收和提交：

1. **阶段产物版本与关键事件**：保留 `workspace_data` 最新快照用于恢复；新增不可覆盖的 `artifact_version` / `stage_event` / `scaffold_event` 最小表与 API。只在阶段确认、结构修改完成、模块测试、主动求助和最终提交时写事件，不记录连续拖拽坐标或游戏帧。优先完成数据模型、迁移、服务与导出测试，再接前端。
2. **建构反向关联补全**：让模块测试记录同时关联学生功能卡、学生确认契约、对应单功能流程节点和蓝图版本；编辑上游功能、流程或映射时，明确使下游验证失效并记录原因。不得只存在 localStorage。
3. **功能卡拆分/合并/自定义**：在现有开放映射基础上允许学生把卡拆成两张、把多张合并、或明确创建未对应教师节点的自定义卡。操作必须保留来源链和修订版本；教师蓝图只用于诊断覆盖，不把“不一致”等同“错误”。
4. **教师单生过程诊断**：在教师端按时间显示观察、功能、流程、路径、代码/测试、支架与修订；支持查看原版本与后版本差异、教师反馈和过程量规。先做单生详情，不做实时全班鼠标监控。
5. **支架采用链**：把“学生尝试→主动求助/系统诊断→L0—L3 建议→学生修改→测试结果”关联起来，导出 requested/effective level、是否采用、采用后的修改与结果。核心理解责任为 student-core 的模块，L3 必须留下明确标记并可触发教师介入。
6. **低支架变式任务**：教师从原任务复制变式条件和受影响测试，学生只修改受影响功能/关系/代码；用于迁移测评，不重复完整入门流程。
7. **部署验收**：自托管固定 Pyodide 资源，做 40—50 人并发、网络中断恢复、1280×720/1366×768、数据库导出一致性和无外部 CDN 场景验证。

每完成一项先运行对应测试，再运行全量回归。不得用“测试暂时不方便”跳过。浏览器验收至少覆盖 kero 的正常链路、一个空白新学生链路、拒绝/未映射/一对多映射、循环依赖、刷新恢复和窄屏滚动。发现既有问题可以修，但不要顺手重构无关模块。

提交规则：

- 开始前运行 `git status --short`，确认并保留用户未跟踪文件；
- 每个提交只包含一个完整能力，提交信息使用简单动词，例如 `feat: record stage artifact versions`，不要使用 alpha、milestone 等复杂版本名；
- 提交前必须通过 `git diff --check`，检查 diff，不得使用 `git add .`；只显式暂存本项文件；
- 后端至少执行 `backend/venv/bin/ruff check ...` 和 `cd backend && venv/bin/pytest -q`；
- 学生端执行 `npm run type-check`、`npm run build`；教师端涉及变更时执行 `npm run lint`、`npm test -- --run`、`npm run build`；
- 重建相应 Docker 服务并检查 `http://localhost:8003/health`；完成浏览器验收后再提交；
- 不要删除历史蓝图版本、学生工作区或研究事件；任何迁移都要有兼容测试。

## 必读文件（按顺序）

1. `AGENTS.md`（若当前环境提供）
2. `docs/PROJECT_WORKBENCH_V02.md`
3. `docs/STUDENT_FRONTEND_DESIGN.md`
4. `docs/teacher-blueprints/snake-project-v2.json`
5. `backend/app/schemas/project_blueprint.py`
6. `backend/app/models/sql/research.py`
7. `backend/app/api/endpoints/admin/project_blueprints.py`
8. `backend/app/api/endpoints/research.py`
9. `backend/app/api/endpoints/chat.py`
10. `backend/app/services/scaffold_context.py`
11. `frontend/views/Research.tsx`
12. `frontend/components/ProjectFactory.tsx`
13. `frontend/components/ProjectFunctionStage.tsx`
14. `frontend/components/ProjectMechanismStage.tsx`
15. `frontend/components/ProjectPathStage.tsx`
16. `frontend/components/ProjectBuildStage.tsx`
17. `frontend/components/ProjectScaffoldAssistant.tsx`
18. `frontend/data/projectPath.ts`
19. `frontend/data/snakeProjectBlueprint.ts`
20. `frontend/data/snakeProjectDemo.ts`
21. `admin-frontend/src/pages/ResearchManagement.tsx`
22. `admin-frontend/src/lib/projectBlueprint.ts`

## 当前仍需注意的技术债

- 最新工作区仍是 JSONB 整份快照，尚不是正式研究所需的细粒度不可覆盖版本链；
- 新开放映射已由后端读取冻结蓝图，但学生确认本身仍随工作区快照保存，尚未形成独立映射事件；
- 本地 `snakeProjectBlueprint.ts` 仍用于旧任务兼容和浏览器测试模板，不能把它重新当成所有任务的教师答案源；
- 建构进度已支持 `cardId::blueprintNodeId` 单元键，并兼容旧 `cardId` 键；后续迁移必须保持读取兼容；
- `ResearchCodeEditor` 构建块仍较大，但已按阶段懒加载；在没有性能数据前不要为了消除 Vite 警告引入复杂依赖；
- Pyodide 仍来自公共 CDN，是正式部署前必须解决的问题；
- 后端测试存在 4 条 Pydantic `schema_json` 命名警告，不是当前功能回归，但可以单独提交修复，不能混入研究功能提交。
