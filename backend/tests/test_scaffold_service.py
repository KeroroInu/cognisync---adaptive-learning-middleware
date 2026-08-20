from app.schemas.chat import ProjectScaffoldContext
from app.schemas.project_blueprint import BlueprintScaffoldPolicy
from app.schemas.profile import UserProfile
from app.services.scaffold_service import (
    LEVEL_RULES,
    build_profile_adaptation,
    build_scaffold_metadata,
    build_scaffold_prompt,
    resolve_scaffold_rule,
    summarize_project_workspace,
)


def scaffold_context(level: int = 2) -> ProjectScaffoldContext:
    return ProjectScaffoldContext(
        requestId="req-1",
        taskId="task-1",
        taskTitle="贪吃蛇",
        stage="build",
        level=level,
        trigger="student_message",
        artifactSummary="当前实现移动模块",
        currentModule="根据方向移动蛇身一格",
        testFeedback="边界用例失败",
    )


def test_profile_changes_wording_not_requested_level():
    profile = UserProfile(cognition=20, affect=25, behavior=30)
    prompt = build_scaffold_prompt(scaffold_context(level=1), profile)

    assert "明确请求 L1" in prompt
    assert LEVEL_RULES[1] in prompt
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

    assert "教师蓝图边界：最多补全当前函数的5行局部代码" in prompt
    assert metadata["policySource"] == "teacher_blueprint"
    assert metadata["policyMaxCodeLines"] == 5
    assert metadata["blueprintVersionId"] == "blueprint-v2"


def test_build_level_above_teacher_limit_is_explicitly_clamped():
    policy = BlueprintScaffoldPolicy(coreImplementationMaxLevel=2)
    resolved = resolve_scaffold_rule(scaffold_context(level=3), policy)

    assert resolved["requestedLevel"] == 3
    assert resolved["appliedLevel"] == 2
    assert resolved["wasClamped"] is True


def test_workspace_summary_contains_every_student_stage_without_raw_code():
    workspace = {
        "savedAt": "2026-08-14T10:00:00Z",
        "observations": [{"observationText": "蛇头每次向前移动一格"}],
        "functions": [{
            "id": "move",
            "responsibility": "移动蛇身",
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
    }

    summary = summarize_project_workspace(workspace)

    assert "蛇头每次向前移动一格" in summary
    assert "移动蛇身｜输入 蛇身与方向｜输出 新蛇身" in summary
    assert "读取方向 → 更新蛇头" in summary
    assert "最近测试 未通过(wrong_head)" in summary
    assert "SECRET_RAW_CODE" not in summary


def test_metadata_carries_cap_so_frontend_can_show_the_effective_level():
    """被钳制时，元数据必须同时给出「降到几」和「上限是多少」。

    只有 wasClamped 一个布尔值，学生端无法在下一次求助**之前**知道点「再具体一级」
    会不会白点，界面只能继续显示一个兑现不了的等级——这正是内部效度问题的来源。
    """
    policy = BlueprintScaffoldPolicy(coreImplementationMaxLevel=2)
    profile = UserProfile(cognition=45, affect=60, behavior=80)

    metadata = build_scaffold_metadata(
        scaffold_context(level=3), profile, "def move():\n    pass", policy
    )

    assert metadata["requestedLevel"] == 3
    assert metadata["level"] == 2
    assert metadata["policyWasClamped"] is True
    assert metadata["coreImplementationMaxLevel"] == 2
    # 提示词也必须按实际生效等级给边界，否则模型会照 L3 的尺度回答。
    assert metadata["levelRule"] == LEVEL_RULES[2]


def test_cap_is_reported_even_when_no_clamp_happened():
    """没有触发降级时也要回传上限，否则前端只能等撞了墙才知道有墙。"""
    policy = BlueprintScaffoldPolicy(coreImplementationMaxLevel=2)
    profile = UserProfile(cognition=45, affect=60, behavior=80)

    metadata = build_scaffold_metadata(
        scaffold_context(level=1), profile, "", policy
    )

    assert metadata["policyWasClamped"] is False
    assert metadata["level"] == 1
    assert metadata["coreImplementationMaxLevel"] == 2
