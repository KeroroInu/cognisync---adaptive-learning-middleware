"""研究事件服务的**离线**单元测试。

范围说明（重要）：

本文件只覆盖不依赖数据库语义的纯逻辑——内容哈希、载荷限制、以及在参数明显
非法时的提前返回。

版本号递增、幂等去重、并发安全这些行为现在依赖 PostgreSQL 的
``INSERT ... ON CONFLICT DO NOTHING RETURNING`` 与 ``SELECT ... FOR UPDATE``。
用假 session 模拟这些语句只能断言「我的桩返回了我让它返回的东西」，
无法验证真正的并发正确性，反而会给出虚假的安全感。因此这部分测试放在
``tests/test_research_stage_events_api.py``（需要真实 PostgreSQL）中。
"""
import uuid

import pytest

from app.models.sql.research_event import (
    ArtifactChangeSource,
    ArtifactType,
    ProjectStage,
    StageEventType,
)
from app.services import research_event_service as svc


# ── 内容哈希 ──────────────────────────────────────────────────────────────────

def test_canonical_json_is_key_order_independent():
    """键顺序不同不应被判定为实质修改。

    前端序列化的键顺序不稳定；若直接对原始字符串哈希，学生什么都没改也会
    产生新版本，「修订次数」这一核心研究指标会被污染。
    """
    a = {"responsibility": "移动蛇身", "input": "方向"}
    b = {"input": "方向", "responsibility": "移动蛇身"}

    assert svc.canonical_json(a) == svc.canonical_json(b)
    assert svc.content_fingerprint(a) == svc.content_fingerprint(b)


def test_content_fingerprint_detects_real_change():
    a = {"responsibility": "移动蛇身"}
    b = {"responsibility": "移动蛇身并检测边界"}

    assert svc.content_fingerprint(a) != svc.content_fingerprint(b)


def test_list_order_is_treated_as_substantive_change():
    """列表顺序在本项目中有教学含义，顺序变化属于实质修改。

    实现路径的先后、流程节点的顺序都是学生的判断结果，不能被规范化掉。
    """
    a = {"orderedCardIds": ["c1", "c2"]}
    b = {"orderedCardIds": ["c2", "c1"]}

    assert svc.content_fingerprint(a) != svc.content_fingerprint(b)


def test_nested_key_order_is_also_normalized():
    a = {"path": {"nodes": [{"id": "n1", "label": "开始"}]}}
    b = {"path": {"nodes": [{"label": "开始", "id": "n1"}]}}

    assert svc.content_fingerprint(a) == svc.content_fingerprint(b)


# ── 载荷限制 ──────────────────────────────────────────────────────────────────

def test_oversized_single_artifact_is_rejected():
    huge = {"blob": "x" * (svc.MAX_ARTIFACT_CONTENT_BYTES + 10)}

    with pytest.raises(svc.ArtifactTooLargeError):
        svc.ensure_event_payload_within_limits({}, [huge])


def test_oversized_detail_is_rejected():
    huge_detail = {"blob": "x" * (svc.MAX_EVENT_DETAIL_BYTES + 10)}

    with pytest.raises(svc.EventPayloadTooLargeError):
        svc.ensure_event_payload_within_limits(huge_detail, [])


def test_many_small_artifacts_can_exceed_request_total():
    """逐产物限制不够：40 个各自合法的产物加起来仍可能压垮请求。

    这正是只做单产物校验会漏掉的场景。
    """
    # 每个 ~32KB，合法；20 个合计 ~640KB，超过 256KB 的请求总量上限。
    chunk = {"blob": "x" * (32 * 1024)}
    artifacts = [chunk for _ in range(20)]

    for item in artifacts:
        assert svc.payload_size(item) <= svc.MAX_ARTIFACT_CONTENT_BYTES

    with pytest.raises(svc.EventPayloadTooLargeError):
        svc.ensure_event_payload_within_limits({}, artifacts)


def test_normal_payload_passes():
    detail = {"confirmedCards": 3}
    artifacts = [
        {"responsibility": "移动蛇身", "input": "方向", "output": "新坐标"},
        {"responsibility": "生成食物", "input": "网格", "output": "坐标"},
    ]

    svc.ensure_event_payload_within_limits(detail, artifacts)


# ── 支架事件的提前返回（不触达数据库） ────────────────────────────────────────

class _UnusedSession:
    """任何数据库调用都说明提前返回失效了。"""

    async def scalar(self, *_args, **_kwargs):
        raise AssertionError("should have returned before touching the database")

    async def execute(self, *_args, **_kwargs):
        raise AssertionError("should have returned before touching the database")

    async def get(self, *_args, **_kwargs):
        raise AssertionError("should have returned before touching the database")


def _scaffold_metadata(**overrides) -> dict:
    base = {
        "requestId": "req-1",
        "taskId": str(uuid.uuid4()),
        "stage": "build",
        "trigger": "hint_button",
        "requestedLevel": 3,
        "level": 2,
        "policyWasClamped": True,
        "policySource": "teacher_blueprint",
        "policyMaxCodeLines": 5,
        "profileSnapshot": {"cognition": 42, "affect": 55, "behavior": 61},
        "codeLength": 128,
        "codeFingerprint": "abc123",
    }
    base.update(overrides)
    return base


@pytest.mark.asyncio
async def test_scaffold_event_requires_request_id():
    """没有 requestId 就无法保证幂等，宁可不记录也不能产生无法去重的行。"""
    event = await svc.record_scaffold_event(
        db=_UnusedSession(),
        user_id=uuid.uuid4(),
        scaffold_metadata=_scaffold_metadata(requestId=""),
    )

    assert event is None


@pytest.mark.asyncio
async def test_scaffold_event_skips_invalid_stage():
    """阶段不在枚举内说明客户端上下文异常，不应写入脏数据。"""
    event = await svc.record_scaffold_event(
        db=_UnusedSession(),
        user_id=uuid.uuid4(),
        scaffold_metadata=_scaffold_metadata(stage="not_a_stage"),
    )

    assert event is None


# ── 安全转换辅助函数 ──────────────────────────────────────────────────────────

def test_safe_uuid_rejects_garbage():
    assert svc._safe_uuid("not-a-uuid") is None
    assert svc._safe_uuid(None) is None
    assert svc._safe_uuid("") is None

    valid = uuid.uuid4()
    assert svc._safe_uuid(str(valid)) == valid
    assert svc._safe_uuid(valid) == valid


def test_safe_int_falls_back_on_garbage():
    assert svc._safe_int("abc", 7) == 7
    assert svc._safe_int(None, 0) == 0
    assert svc._safe_int("3", 0) == 3


def test_safe_optional_int_returns_none_on_garbage():
    assert svc._safe_optional_int("abc") is None
    assert svc._safe_optional_int(None) is None
    assert svc._safe_optional_int(55) == 55


# ── 阶段—事件—产物组合矩阵（P1-C） ────────────────────────────────────────────
#
# 后端是最终裁决者，不能只校验「枚举成员是否存在」。只做枚举校验时，
# stage=observe + event_type=module_test 这类不可能发生的组合会照常入库，
# 分析阶段再也无法区分「学生真的这么操作」与「前端传错了」。

def test_module_test_is_rejected_outside_build_stages():
    with pytest.raises(svc.StageCombinationError):
        svc.validate_stage_event_combination(
            ProjectStage.OBSERVE, StageEventType.MODULE_TEST, []
        )


def test_final_submit_is_rejected_in_early_stages():
    with pytest.raises(svc.StageCombinationError):
        svc.validate_stage_event_combination(
            ProjectStage.DECOMPOSE, StageEventType.FINAL_SUBMIT, []
        )


def test_module_test_allowed_in_build_and_reflect():
    for stage in (ProjectStage.BUILD, ProjectStage.REFLECT):
        svc.validate_stage_event_combination(stage, StageEventType.MODULE_TEST, [])


def test_help_request_allowed_in_every_stage():
    """求助在任何阶段都可能发生，这正是支架依赖分析要观察的对象。"""
    for stage in ProjectStage:
        svc.validate_stage_event_combination(stage, StageEventType.HELP_REQUEST, [])


def test_artifact_outside_its_native_stage_is_rejected():
    """观察阶段不可能产出实现路径。"""
    with pytest.raises(svc.StageCombinationError):
        svc.validate_stage_event_combination(
            ProjectStage.OBSERVE, StageEventType.STAGE_CONFIRM, [ArtifactType.PATH]
        )


def test_module_code_cannot_be_reported_before_build():
    with pytest.raises(svc.StageCombinationError):
        svc.validate_stage_event_combination(
            ProjectStage.PLAN, StageEventType.STAGE_CONFIRM, [ArtifactType.MODULE_CODE]
        )


def test_build_stage_may_revise_earlier_artifacts():
    """「回到解构结果进行修订」是本教学法的核心机制，不是异常路径。

    依据 docs/PROJECT_WORKBENCH_V02.md 第 7、30、246 行：测试失败时学生要能
    返回对应功能或关系进行修订。若把矩阵做成严格单向，这条主线会被 422 挡死。
    """
    for artifact_type in (
        ArtifactType.OBSERVATION,
        ArtifactType.FUNCTION_CARD,
        ArtifactType.FUNCTION_MAPPING,
        ArtifactType.MECHANISM,
        ArtifactType.PATH,
    ):
        svc.validate_stage_event_combination(
            ProjectStage.BUILD, StageEventType.STRUCTURE_CHANGE, [artifact_type]
        )


def test_cross_stage_revision_is_an_explicit_whitelist_not_a_blanket_pass():
    """白名单必须是显式条目：反向（早期阶段产出后期产物）仍应被拒。"""
    assert (ProjectStage.BUILD, ArtifactType.FUNCTION_CARD) in svc.CROSS_STAGE_REVISION
    assert (ProjectStage.OBSERVE, ArtifactType.MODULE_CODE) not in svc.CROSS_STAGE_REVISION
    assert (ProjectStage.PLAN, ArtifactType.MODULE_CODE) not in svc.CROSS_STAGE_REVISION


def test_every_artifact_type_has_a_declared_native_stage():
    """新增产物类型时必须同步声明其阶段，否则会悄悄绕过校验。"""
    missing = set(ArtifactType) - set(svc.ARTIFACT_NATIVE_STAGES)
    assert not missing, f"这些产物类型没有声明原生阶段: {missing}"


def test_every_event_type_has_a_declared_stage_set():
    missing = set(StageEventType) - set(svc.STAGE_EVENT_MATRIX)
    assert not missing, f"这些事件类型没有声明允许阶段: {missing}"


# ── 幂等键指纹（P1-A，指纹范围见 P3-A 扩展） ────────────────────────────────

def _art(**overrides) -> svc.ArtifactFingerprintInput:
    base = {
        "artifact_type": ArtifactType.FUNCTION_CARD,
        "artifact_key": "fc-1",
        "content": {"responsibility": "移动"},
        "change_source": ArtifactChangeSource.STAGE_CONFIRM,
        "change_reason": "首次确认",
    }
    base.update(overrides)
    return svc.ArtifactFingerprintInput(**base)


def _fp(task_id=None, stage=ProjectStage.BUILD, event_type=StageEventType.STAGE_CONFIRM,
        detail=None, artifacts=None):
    return svc.stage_event_fingerprint(
        task_id=task_id or uuid.UUID(int=1),
        stage=stage,
        event_type=event_type,
        detail=detail if detail is not None else {"confirmed": 3},
        artifacts=artifacts if artifacts is not None else [_art()],
    )


def test_identical_request_yields_identical_fingerprint():
    """真正的网络重试内容完全一致，必须被识别为重放而不是键复用。"""
    assert _fp() == _fp()


def test_fingerprint_is_key_order_independent():
    a = _fp(artifacts=[_art(content={"input": "方向", "output": "坐标"})])
    b = _fp(artifacts=[_art(content={"output": "坐标", "input": "方向"})])
    assert a == b


def test_fingerprint_distinguishes_task():
    """跨任务复用 request_id 是最危险的情形：唯一键只含 (user_id, request_id)，

    不比对指纹就会把另一个任务的旧事件当作本次结果返回。
    """
    assert _fp(task_id=uuid.UUID(int=1)) != _fp(task_id=uuid.UUID(int=2))


def test_fingerprint_covers_artifact_identity_and_provenance():
    """只纳入 content 会漏掉这四类真实差异，导致新数据被当成重放丢弃。"""
    base = _fp()
    assert base != _fp(artifacts=[_art(artifact_key="fc-2")]), "换一张卡"
    assert base != _fp(
        artifacts=[_art(artifact_type=ArtifactType.FUNCTION_MAPPING)]
    ), "换一类产物"
    assert base != _fp(
        artifacts=[_art(change_source=ArtifactChangeSource.SCAFFOLD_FOLLOWUP)]
    ), "换修改来源——这是研究变量，区分学生自发与支架跟进"
    assert base != _fp(artifacts=[_art(change_reason="测试失败后修订")]), "换修改原因"


def test_fingerprint_covers_artifact_order():
    """产物顺序写入关联表的 position，顺序不同即为不同的上报。"""
    a, b = _art(artifact_key="fc-1"), _art(artifact_key="fc-2")
    assert _fp(artifacts=[a, b]) != _fp(artifacts=[b, a])


def test_fingerprint_distinguishes_stage_event_type_detail_and_artifacts():
    base = _fp()
    assert base != _fp(stage=ProjectStage.REFLECT)
    assert base != _fp(event_type=StageEventType.STRUCTURE_CHANGE)
    assert base != _fp(detail={"confirmed": 4})
    assert base != _fp(artifacts=[_art(content={"responsibility": "移动并检测边界"})])


# ── 请求内重复产物（P3-A） ───────────────────────────────────────────────────

def test_duplicate_artifact_identity_is_rejected():
    """关联表的唯一约束只会让第二项静默消失，必须在写库前显式拒绝。"""
    with pytest.raises(svc.DuplicateArtifactError):
        svc.ensure_no_duplicate_artifacts([
            _art(artifact_key="fc-1", content={"responsibility": "移动"}),
            _art(artifact_key="fc-1", content={"responsibility": "移动并检测边界"}),
        ])


def test_same_key_with_different_type_is_allowed():
    """去重键是 (type, key)：一张卡的功能卡与契约共用卡片 ID 是合法的。"""
    svc.ensure_no_duplicate_artifacts([
        _art(artifact_type=ArtifactType.FUNCTION_CARD, artifact_key="fc-1"),
        _art(artifact_type=ArtifactType.FUNCTION_MAPPING, artifact_key="fc-1"),
    ])


def test_distinct_keys_are_allowed():
    svc.ensure_no_duplicate_artifacts([
        _art(artifact_key="fc-1"),
        _art(artifact_key="fc-2"),
        _art(artifact_key="fc-3"),
    ])


def test_empty_artifact_list_is_allowed():
    """模块测试、最终提交等事件可以不带产物。"""
    svc.ensure_no_duplicate_artifacts([])
