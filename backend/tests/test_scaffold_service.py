from app.schemas.chat import ProjectScaffoldContext
from app.schemas.profile import UserProfile
from app.services.scaffold_service import (
    LEVEL_RULES,
    build_profile_adaptation,
    build_scaffold_metadata,
    build_scaffold_prompt,
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
