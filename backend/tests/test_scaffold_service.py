from app.schemas.chat import ProjectScaffoldContext
from app.schemas.project_blueprint import BlueprintScaffoldPolicy
from app.schemas.profile import UserProfile
from app.services.learning_agent_harness import learning_agent_harness
from app.services.scaffold_service import (
    BUILD_LEVEL_RULES,
    LEVEL_RULES,
    SNAKE_L3_SOLUTIONS,
    build_confirmed_l3_response,
    build_controlled_build_response,
    build_controlled_scaffold_response,
    build_profile_adaptation,
    build_scaffold_metadata,
    build_scaffold_prompt,
    resolve_scaffold_rule,
    summarize_project_workspace,
)


def scaffold_context(level: int = 2, *, l3_confirmed: bool | None = None) -> ProjectScaffoldContext:
    return ProjectScaffoldContext(
        requestId="req-1",
        taskId="task-1",
        taskTitle="贪吃蛇",
        stage="build",
        level=level,
        trigger="student_message",
        artifactSummary="当前实现移动模块",
        currentModule="movement",
        testFeedback="边界用例失败",
        l3Confirmed=level == 3 if l3_confirmed is None else l3_confirmed,
    )


def test_profile_changes_wording_not_requested_level():
    profile = UserProfile(cognition=20, affect=25, behavior=30)
    prompt = build_scaffold_prompt(scaffold_context(level=1), profile)

    assert "明确请求 L1" in prompt
    assert BUILD_LEVEL_RULES[1] in prompt
    assert "不得擅自升降等级" in prompt
    assert build_profile_adaptation(profile)["cognitionBand"] == "low"


def test_metadata_records_profile_and_code_fingerprint_without_code_copy():
    profile = UserProfile(cognition=45, affect=60, behavior=80)
    metadata = build_scaffold_metadata(scaffold_context(level=3), profile, "def move():\n    pass")

    assert metadata["levelLabel"] == "L3"
    assert metadata["profileSnapshot"] == {"cognition": 45, "affect": 60, "behavior": 80}
    assert metadata["codeLength"] == 20
    assert len(metadata["codeFingerprint"]) == 16
    assert "codeExcerpt" not in metadata


def test_all_four_levels_have_distinct_boundaries():
    assert list(LEVEL_RULES) == [0, 1, 2, 3]
    assert len(set(LEVEL_RULES.values())) == 4
    assert len(set(BUILD_LEVEL_RULES.values())) == 4


def test_teacher_blueprint_rule_is_applied_and_exported_with_version():
    policy = BlueprintScaffoldPolicy.model_validate({
        "requireAttemptBeforeUpgrade": True,
        "coreImplementationMaxLevel": 3,
        "stageLevels": {
            "build": [{
                "level": 3,
                "goalZh": "补足当前阻塞点",
                "allowedHelpZh": "最多补全当前函数的5行局部代码",
                "maxCodeLines": 5,
            }],
        },
    })
    profile = UserProfile(cognition=45, affect=60, behavior=80)

    prompt = build_scaffold_prompt(scaffold_context(level=3), profile, policy=policy)
    metadata = build_scaffold_metadata(
        scaffold_context(level=3),
        profile,
        "def move():\n    pass",
        policy,
        "blueprint-v2",
    )

    assert BUILD_LEVEL_RULES[3] in prompt
    assert metadata["policySource"] == "platform_latest"
    assert metadata["policyGoal"] == (
        "围绕当前基础函数按 L0-L3 提供可复制运行的代码支持，不自动覆盖学生代码"
    )
    assert metadata["policyMaxCodeLines"] == 100
    assert metadata["blueprintVersionId"] == "blueprint-v2"


def test_confirmed_build_l3_overrides_legacy_teacher_line_cap():
    policy = BlueprintScaffoldPolicy(coreImplementationMaxLevel=2)
    resolved = resolve_scaffold_rule(scaffold_context(level=3), policy)

    assert resolved["requestedLevel"] == 3
    assert resolved["appliedLevel"] == 3
    assert resolved["wasClamped"] is False
    assert resolved["coreImplementationMaxLevel"] == 3


def test_unconfirmed_build_l3_stays_at_l2():
    resolved = resolve_scaffold_rule(scaffold_context(level=3, l3_confirmed=False))

    assert resolved["requestedLevel"] == 3
    assert resolved["appliedLevel"] == 2
    assert resolved["wasClamped"] is True


def test_transfer_l3_uses_same_explicit_confirmation_boundary_as_build():
    unconfirmed = scaffold_context(level=3, l3_confirmed=False)
    unconfirmed.stage = "transfer"
    confirmed = scaffold_context(level=3, l3_confirmed=True)
    confirmed.stage = "transfer"

    assert resolve_scaffold_rule(unconfirmed)["appliedLevel"] == 2
    assert resolve_scaffold_rule(confirmed)["appliedLevel"] == 3
    prompt = build_scaffold_prompt(
        confirmed,
        UserProfile(cognition=50, affect=50, behavior=50),
    )
    assert BUILD_LEVEL_RULES[3] in prompt
    assert "已进入 L3 代码协作" in prompt


def test_workspace_summary_contains_every_student_stage_without_raw_code():
    workspace = {
        "savedAt": "2026-08-14T10:00:00Z",
        "observations": [{"observationText": "蛇头每次向前移动一格"}],
        "functions": [{
            "id": "move",
            "responsibility": "移动蛇身",
            "implementation": "先算新蛇头；当移动时去掉蛇尾；最后返回蛇身",
            "observationText": "蛇头向前一格",
            "input": "蛇身与方向",
            "output": "新蛇身",
            "knowledge": ["列表", "坐标"],
            "verification": "比较移动前后坐标",
        }],
        "path": {
            "orderedCardIds": ["move"],
            "prerequisites": {"move": []},
            "functionMechanisms": {
                "move": {
                    "flowNodes": [{"label": "读取方向"}, {"label": "更新蛇头"}],
                    "diagramEdges": [{"sourceId": "a", "targetId": "b"}],
                },
            },
        },
        "progress": {
            "move": {
                "verified": False,
                "code": "SECRET_RAW_CODE",
                "testAttempts": [{"passed": False, "resultCode": "wrong_head"}],
            },
        },
        "creativeFunctions": [{
            "id": "creative-1",
            "title": "移动后加分",
            "hook": "after_move",
            "enabled": True,
            "verified": True,
            "testAttempts": [{"passed": True, "resultCode": "PASSED"}],
        }],
    }

    summary = summarize_project_workspace(workspace)

    assert "蛇头每次向前移动一格" in summary
    assert "移动蛇身｜实现描述 先算新蛇头" in summary
    assert "移动后加分｜钩子 after_move｜已启用｜最近测试 通过(PASSED)" in summary
    assert "读取方向 → 更新蛇头" in summary
    assert "最近测试 未通过(wrong_head)" in summary
    assert "SECRET_RAW_CODE" not in summary


def test_metadata_records_unconfirmed_l3_as_l2():
    """被钳制时，元数据必须同时给出「降到几」和「上限是多少」。

    只有 wasClamped 一个布尔值，学生端无法在下一次求助**之前**知道点「再具体一级」
    会不会白点，界面只能继续显示一个兑现不了的等级——这正是内部效度问题的来源。
    """
    policy = BlueprintScaffoldPolicy(coreImplementationMaxLevel=2)
    profile = UserProfile(cognition=45, affect=60, behavior=80)

    metadata = build_scaffold_metadata(
        scaffold_context(level=3, l3_confirmed=False), profile, "def move():\n    pass", policy
    )

    assert metadata["requestedLevel"] == 3
    assert metadata["level"] == 2
    assert metadata["policyWasClamped"] is True
    assert metadata["coreImplementationMaxLevel"] == 3
    # 提示词也必须按实际生效等级给边界，否则模型会照 L3 的尺度回答。
    assert metadata["levelRule"] == BUILD_LEVEL_RULES[2]


def test_cap_is_reported_even_when_no_clamp_happened():
    """没有触发降级时也要回传上限，否则前端只能等撞了墙才知道有墙。"""
    policy = BlueprintScaffoldPolicy(coreImplementationMaxLevel=2)
    profile = UserProfile(cognition=45, affect=60, behavior=80)

    metadata = build_scaffold_metadata(
        scaffold_context(level=1), profile, "", policy
    )

    assert metadata["policyWasClamped"] is False
    assert metadata["level"] == 1
    assert metadata["coreImplementationMaxLevel"] == 3


def test_confirmed_l3_returns_each_controlled_function_without_llm_rewrite():
    for node_id, solution in SNAKE_L3_SOLUTIONS.items():
        context = scaffold_context(level=3)
        context.currentModule = node_id
        response = build_confirmed_l3_response(context)

        assert response is not None
        assert solution in response
        assert "不会自动覆盖" in response


def test_l3_solution_is_not_returned_without_explicit_confirmation():
    assert build_confirmed_l3_response(
        scaffold_context(level=3, l3_confirmed=False)
    ) is None


def test_fixed_build_levels_return_exact_scaffold_shapes():
    context = scaffold_context(level=0)
    context.testFeedback = "新蛇头坐标不正确"
    current_code = "def move_snake(snake, direction):\n    return snake"
    l0 = build_controlled_build_response(
        context,
        0,
        student_message="我的代码哪里有问题",
        current_code=current_code,
    )
    assert l0 is not None
    assert "移动蛇身" in l0
    assert "move_snake" in l0
    assert "新蛇头坐标不正确" in l0
    assert "assert after[0]" in l0
    assert "new_head =" in build_controlled_build_response(context, 1)
    assert "TODO" in build_controlled_build_response(context, 2)

    context.level = 3
    context.l3Confirmed = True
    context.trigger = "l3_confirmed"
    l3 = build_controlled_build_response(context, 3)
    assert l3 is not None and SNAKE_L3_SOLUTIONS["movement"] in l3


def test_confirmed_l3_followup_enters_code_collaboration_instead_of_repeating_answer():
    context = scaffold_context(level=3)
    context.trigger = "student_message"

    controlled = build_controlled_build_response(
        context,
        3,
        student_message="为什么这里要去掉蛇尾？",
        current_code=SNAKE_L3_SOLUTIONS["movement"],
    )
    prompt = build_scaffold_prompt(
        context,
        UserProfile(cognition=50, affect=50, behavior=50),
    )

    assert controlled is None
    assert "已进入 L3 代码协作" in prompt
    assert "不得退回 L0 式反复定位" in prompt
    assert SNAKE_L3_SOLUTIONS["movement"] in prompt


def test_creative_prompt_exposes_only_the_safe_visible_runner_contract():
    context = scaffold_context(level=3)
    context.currentModule = "creative::student-card-1"
    context.trigger = "student_message"

    prompt = build_scaffold_prompt(
        context,
        UserProfile(cognition=50, affect=50, behavior=50),
    )

    assert "event.type 为 start、key、before_move、move、eat、loop 或 end" in prompt
    assert "objects 最多 48 个字典" in prompt
    assert "obstacle/wall、bomb、portal、bonus、shield" in prompt
    assert "creative_feature(event, state)" in prompt
    assert "包含 print 在内的安全基础函数" in prompt
    assert "L0 诊断必须读取本轮真实 event/state" in prompt
    assert "纯打印诊断可以运行" in prompt
    assert "不会通过" in prompt
    assert "JSON 列表，不是 (3, 5) 元组" in prompt


def test_creative_l0_rule_rejects_detached_or_unavailable_diagnostics():
    context = scaffold_context(level=0)
    context.currentModule = "creative::student-card-1"
    context.trigger = "student_message"

    prompt = build_scaffold_prompt(
        context,
        UserProfile(cognition=50, affect=50, behavior=50),
    )

    assert "直接放进当前 creative_feature(event, state) 中运行" in prompt
    assert "必须读取本轮 event/state" in prompt
    assert "不得给独立测试文件" in prompt
    assert "脱离当前状态的硬编码棋盘结论" in prompt


def test_controlled_build_response_can_identify_the_current_card():
    response = build_controlled_build_response(
        scaffold_context(level=0),
        0,
        student_message="你知道我问的是哪段吗",
        current_code="def move_snake(snake, direction):\n    return snake",
    )

    assert response is not None
    assert "基础函数卡「移动蛇身」" in response
    assert "不会跳到其他功能卡" in response


def test_completed_observation_stage_advances_instead_of_repeating_questions():
    context = scaffold_context(level=3)
    context.stage = "observe"
    context.currentModule = None
    context.trigger = "level_up"
    context.artifactSummary = (
        "【观察阶段状态】已运行项目：是；观察卡：7；完成条件：已满足。\n"
        "观察记录：蛇头向前移动；碰到果实后增长。"
    )

    response = build_controlled_scaffold_response(
        context,
        3,
        student_message="我尝试后仍然没有推进，请再具体一级。",
    )

    assert response is not None
    assert "读到你保存的 7 张观察卡" in response
    assert "不需要为了获得提示再重复观察" in response
    assert "进入「拆功能」" in response
    assert "坐标" not in response


def test_completed_observation_stage_still_allows_specific_student_questions():
    context = scaffold_context(level=1)
    context.stage = "observe"
    context.currentModule = None
    context.trigger = "student_message"
    context.artifactSummary = "【观察阶段状态】已运行项目：是；观察卡：3；完成条件：已满足。"

    response = build_controlled_scaffold_response(
        context,
        1,
        student_message="我的第三张观察卡描述得清楚吗？",
    )
    prompt = build_scaffold_prompt(
        context,
        UserProfile(cognition=50, affect=50, behavior=50),
    )

    assert response is None
    assert "不得再要求新增或重复观察" in prompt


def test_learning_agent_harness_scopes_history_by_task_stage_and_function():
    messages = [
        {
            "role": "assistant",
            "text": "初始化函数旧回复",
            "scaffoldContext": {"taskId": "task-1", "stage": "build", "currentModule": "initial-state"},
        },
        {
            "role": "assistant",
            "text": "观察阶段回复",
            "scaffoldContext": {"taskId": "task-1", "stage": "observe"},
        },
        {
            "role": "user",
            "text": "移动函数当前问题",
            "scaffoldContext": {"taskId": "task-1", "stage": "build", "currentModule": "movement"},
        },
        {
            "role": "assistant",
            "text": "另一个任务的移动回复",
            "scaffoldContext": {"taskId": "task-2", "stage": "build", "currentModule": "movement"},
        },
    ]

    build_turn = learning_agent_harness.prepare_turn(scaffold_context(level=0), messages)
    assert build_turn.key.serialize() == "task:task-1|stage:build|focus:movement"
    assert build_turn.focus_title == "移动蛇身"
    assert build_turn.history == [{"role": "user", "text": "移动函数当前问题"}]
    assert "初始化函数旧回复" not in build_turn.prompt_section

    observe = scaffold_context(level=0)
    observe.stage = "observe"
    observe.currentModule = None
    observe_turn = learning_agent_harness.prepare_turn(observe, messages)
    assert observe_turn.history == [{"role": "assistant", "text": "观察阶段回复"}]
    assert "运行与观察" in observe_turn.prompt_section


def test_all_controlled_l3_solutions_pass_the_shared_snake_contract():
    namespace: dict = {}
    for solution in SNAKE_L3_SOLUTIONS.values():
        exec(solution, namespace)

    snake, direction, score = namespace["create_initial_state"]()
    assert len(snake) == 3 and direction == "right" and score == 0
    assert namespace["change_direction"]("right", "left") == "right"
    assert namespace["change_direction"]("right", "up") == "up"
    assert namespace["move_snake"]([(2, 2), (1, 2), (0, 2)], "right") == [
        (3, 2), (2, 2), (1, 2)
    ]
    food = namespace["spawn_food"]([(1, 1), (1, 2)], 4)
    assert 0 <= food[0] < 4 and 0 <= food[1] < 4 and food not in [(1, 1), (1, 2)]
    grown, grown_score, needs_food = namespace["apply_food_effect"](
        [(2, 2), (1, 2), (0, 2)], (2, 2), 0
    )
    assert len(grown) == 4 and grown_score == 10 and needs_food is True
    assert namespace["check_collision"]([(-1, 2), (0, 2)], 12) is True

    state = {
        "snake": [(6, 5), (5, 5), (4, 5)],
        "direction": "right",
        "food": (10, 10),
        "score": 0,
        "game_over": False,
    }
    next_state = namespace["step_game"](state, None)
    assert next_state == {
        "snake": [(7, 5), (6, 5), (5, 5)],
        "direction": "right",
        "food": (10, 10),
        "score": 0,
        "game_over": False,
    }
