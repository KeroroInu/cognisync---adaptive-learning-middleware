# 创意卡「测试通过但运行时炸卡」缺陷问题单

> 文档状态：**问题报告，未实施修复**
> 适用分支：`codex/final-quasi-experiment-dev`
> 复现基线：`89f383f fix: show the rejected field in the runtime isolation banner`
> 发现方式：2026-08-29 真实浏览器试用（kero 手动测试贪吃蛇创意卡「炸弹」）
> 处理约定：本单交由 Codex 实施；Claude 本轮只做了问题定位与证据固化，未改动测试判定逻辑。

---

## 1. 现象

学生写了一张「炸弹」创意卡，点「测试」得到绿色通过：

```
[炸弹] $ test --events all-events
[炸弹] ✓ 安全检查通过，可以启用并在左侧游戏中观察效果。
[炸弹] 测试状态生成 1 个可视对象（bomb）；启用后会由左侧统一运行器绘制。
```

学生据此启用了卡片。游戏跑起来之后，卡片被运行时隔离并自动停用：

```
运行异常已隔离并自动停用：CREATIVE_UNSUPPORTED_STATE
```

**同一份代码，测试判定通过，运行时判定非法。** 学生拿到的绿勾是一个假保证。

逐卡隔离机制本身工作正常（其余创意卡与基础游戏继续运行），需要修的不是隔离，
而是**测试判定的可信度**。

---

## 2. 根因

`runPythonCreativeTest`（`frontend/services/pythonModuleRunner.ts:912`）从固定的
`SAMPLE_CREATIVE_STATE`（同文件 `:857`）出发，把七个事件依次跑一遍，状态在事件之间
向下传递，只要**任一事件造成了状态变化**就判定通过（`:944` 的 `changed ||=`）。

问题在于这块测试板是静止的：

```ts
const SAMPLE_CREATIVE_STATE: PythonGameState = {
  snake: [[6, 5], [5, 5], [4, 5]],
  direction: 'right',
  food: [9, 5],
  score: 0,
  game_over: false,
  interval: 0.36,
  objects: [],
};
```

七个事件跑完，蛇头始终停在 `[6, 5]`，食物始终在 `[9, 5]`，蛇一步都不会走。因此
**所有以游戏局面为条件的分支在测试中都不会执行**：`head == 某对象位置`、
`snake[0] == food`、`len(snake) > N`、`score >= N` 全部为假。

学生这张卡的非法写入 `state["bomb_time"] = ...` 正好位于
`if o["type"] == "bomb" and o["position"] == head:` 之内。测试里炸弹被放在 `[3, 3]`，
蛇头在 `[6, 5]`，这一行一次都没跑到；而卡片往 `objects` 里加了一个炸弹，
`changed` 为真，于是判定通过。

启用后蛇真的走到 `[3, 3]`，该行执行，运行器按契约拒绝非法顶层字段，卡片被隔离。

### 2.1 复现（已实测，非推断）

用真实沙箱源码 `buildCreativeHarnessSource` 在 CPython 下执行，复刻测试路径与运行时路径：

```
【测试路径】 PASSED
【测试末态 objects】 [{"id":"bomb-1","type":"bomb","position":[3,3]}]
【运行时 蛇头压在炸弹上】 CREATIVE_UNSUPPORTED_STATE | 不支持的字段：bomb_time
【state 里有 time 吗】 没有，get("time",0) 永远返回 0
```

复现脚本的做法：`esbuild` 打包一个 Node 脚本，导入 `buildCreativeHarnessSource` 与
`validateSceneState`，按 `runPythonCreativeTest` 的顺序跑七个事件并向下传状态，
再单独构造一个「蛇头压在炸弹上」的状态跑一次 `move`。
`frontend/tests/creativeSandbox.test.ts` 里已有同样的 `runSandbox` 写法可直接复用。

### 2.2 同一类缺陷的第二种表现：未知事件名零反馈

同一位学生的上一版代码里写了 `if event["type"] == "timer":`。沙箱里**没有** `timer`
这个事件（只有 `start / key / before_move / move / eat / loop / end`）。这个分支永远
不执行，而系统**不报任何错**——不是拒绝，是静默什么都不做。

更麻烦的是 `usesCreativeEventRouting`（`frontend/data/snakeCreativeFunctions.ts:86`）
只检测代码里是否出现 `event["type"]` / `event.get("type")`，不校验比较的字面量。
所以写错事件名的卡片会被当成「事件路由器」正常挂到全部七个事件上，然后一个分支都不命中。

学生侧的观感是「代码看着没问题、测试也过了、就是没效果」，只能逐行猜。
`bomb_count → set_timer → bomb_time` 三轮反复，本质上都是这条反馈链断掉的结果。

---

## 3. 建议修法

推荐**静态扫描**，而不是把测试板改成会动的模拟：

在创意沙箱已有的 AST 白名单遍历里（`frontend/services/pythonModuleRunner.ts:810-821`，
即 `ast.walk(_creative_tree)` 那一趟）追加两类检查，在代码**执行之前**就判定：

1. **字面量非法顶层写入**——`ast.Assign` / `ast.AugAssign` / `ast.AnnAssign` 的目标是
   `ast.Subscript`，且 `value` 为 `Name('state')`、下标是字符串常量、该字符串不在
   `CREATIVE_STATE_KEYS` 中。同样处理 `state.setdefault("xxx", ...)` 与
   `state.update({...})` 的字面量键。命中则报 `CREATIVE_UNSUPPORTED_STATE`，
   detail 沿用现有的「不支持的字段：xxx」措辞。
2. **未知事件名**——比较运算中出现 `event["type"]` / `event.get("type")`
   （以及 `hook` 的同形写法）与字符串常量比较，且该常量不在 `CREATIVE_EVENT_TYPES`
   中。命中则报新的结果码（建议 `CREATIVE_UNKNOWN_EVENT`），detail 点名写错的事件名
   并列出七个合法值。

两者都只处理**字面量**：`state[some_var] = ...` 这类动态键仍然只能等运行时拒绝。
这是刻意的取舍——静态扫描要保证零误报，宁可漏掉罕见写法，也不能把合法代码判死。

### 3.1 需要同步改的地方

- `frontend/data/creativeCapabilities.ts`：如新增 `CREATIVE_UNKNOWN_EVENT`，
  结果码与文案需在注册表登记。
- `frontend/services/pythonModuleRunner.ts` 的 `RESULT_MESSAGES`：补中英文案。
- `backend/app/services/creative_capability.py`：契约里说明「事件名写错会被静态检查
  拒绝」，并保持 `tests/test_creative_capability_contract.py` 的跨语言防漂移比对通过。
- `backend/tests/test_scaffold_service.py::test_creative_prompt_exposes_only_the_safe_visible_runner_contract`
  会因为契约文本变化而失败，需一并更新断言。

### 3.2 明确**不**建议的做法

- 不要为了让分支跑到而在测试里模拟若干帧游戏推进。测试板一旦会动，学生就要靠
  猜「测试时蛇走到哪」来理解结论，而且仍然无法保证覆盖任意条件分支。
- 不要放宽 `CREATIVE_STATE_KEYS` 去容纳学生自造字段。顶层状态是渲染契约，
  放开等于让主线程去信任 Worker 的任意输出。
- 不要把「没跑到的分支」降级成警告后仍判通过。绿勾必须是可信的。

---

## 4. 验收标准

1. 本单 §2.1 那份炸弹代码在**测试阶段**即判定失败，并在 detail 中点名 `bomb_time`。
2. 写了 `event["type"] == "timer"` 的卡片在测试阶段失败，并点名 `timer` 与七个合法事件名。
3. 合法卡片（`frontend/tests/creativeSandbox.test.ts` 现有 20 条用例覆盖的写法）
   全部仍然通过，无误报。
4. 动态键 `state[key] = 1` 不被静态检查拦下（保持零误报），运行时行为不变。
5. `frontend` 全量 `vitest run`、`tsc --noEmit`、`vite build` 通过；
   `backend` 的 `test_scaffold_service.py` 与 `test_creative_capability_contract.py` 通过。
6. 历史创意卡（`workspace_data` / `artifact_versions` 里已保存的学生代码）仍可读取，
   不因新增结果码而无法加载。

---

## 5. 已在本轮完成、不需要 Codex 重做的部分

| 提交 | 内容 |
| --- | --- |
| `8247315` | 沙箱在拒绝非法顶层字段时给出「不支持的字段：xxx」，不再只回一个结果码 |
| `67356ee` | 后端能力契约与沙箱同步，明确写出「自造顶层字段会被拒绝」「平台不会自动生成创意对象」 |
| `89f383f` | 运行时隔离横幅显示 detail，不再只显示 `CREATIVE_UNSUPPORTED_STATE` |

这三项修的是「拒绝之后说不说得清」。本单要修的是「该拒绝的时候没拒绝」，
两者不重叠。

---

## 6. 与教学设计的关系（供判断优先级）

创意卡是学生从「照着七个基础函数实现」走向「自己提出并实现一个功能」的唯一环节，
也是准实验里观察迁移能力的主要证据来源。一个会发假绿勾的测试会同时污染两件事：
学生的学习体验（反复试错却得不到有效反馈），以及研究证据（`module_test` 事件里
记录的 `passed: true` 与实际可运行性不一致）。

因此这个缺陷的优先级应高于 §9 后续各项能力扩展。
