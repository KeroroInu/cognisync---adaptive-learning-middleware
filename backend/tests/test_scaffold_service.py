from app.schemas.chat import ProjectScaffoldContext
from app.schemas.profile import UserProfile
from app.services.scaffold_service import (
    LEVEL_RULES,
    build_profile_adaptation,
    build_scaffold_metadata,
    build_scaffold_prompt,
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
