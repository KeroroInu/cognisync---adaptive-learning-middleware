"""Research Process Service - 阶段产物版本与关键教学事件的写入逻辑。

职责边界：

- 后端是**最终裁决者**：校验任务归属、阶段与事件类型，并比较当前产物与上一版本；
  内容没有实质变化时不创建新的 ``ArtifactVersion``。
- 后端**不**根据整份工作区快照 diff 猜测学生行为。哪一次操作具有教学含义由前端
  在明确的交互点上报，后端只做校验与去重。
- ``workspace_data`` 仍是恢复用的最新快照，本模块不修改它。

并发策略（40–50 人课堂 + 学生多标签页 + 客户端重试）：

所有写入路径都必须能承受「两个请求同时到达」，因此一律使用 PostgreSQL 原子语句，
不使用「先 SELECT 再 INSERT」这种在并发下必然产生 ``IntegrityError`` 的写法：

- 产物身份：``INSERT ... ON CONFLICT DO NOTHING RETURNING`` + 冲突后重查；
- 版本分配：先 ``SELECT ... FOR UPDATE`` 锁住 ``StageArtifact`` 行，再在同一事务内
  重新读取最新版本、比较哈希、分配版本号并更新指针；
- 事件幂等：``INSERT ... ON CONFLICT DO NOTHING RETURNING`` + 冲突后重查。

这样并发重复请求只会得到既有行，不会让事务进入失败状态——这一点对 ``ScaffoldEvent``
尤其关键，因为它与学生的聊天消息共用事务，一次 ``IntegrityError`` 会直接让对话返回 500。
"""
from __future__ import annotations

import hashlib
import json
import logging
import uuid
from dataclasses import dataclass
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.sql.research import ResearchTask
from app.models.sql.research_event import (
    ArtifactChangeSource,
    ArtifactType,
    ArtifactVersion,
    ProjectStage,
    ScaffoldDeliveryStatus,
    ScaffoldEvent,
    StageArtifact,
    StageEvent,
    StageEventArtifact,
    StageEventType,
)

logger = logging.getLogger(__name__)

# 单个产物快照的上限。整份工作区快照上限为 256 KB（见 research.py），
# 单个产物远小于此；超限通常意味着前端误传了整份工作区。
MAX_ARTIFACT_CONTENT_BYTES = 64 * 1024

# 单次事件 detail 载荷上限。detail 只承载「本次关键时刻的最小结构化说明」，
# 不应该塞入产物内容本身。
MAX_EVENT_DETAIL_BYTES = 16 * 1024

# 单次 stage-event 请求的总载荷上限（detail + 全部产物）。
# 仅做逐产物限制不够：80 个产物 × 64 KB 理论上可达 5 MB，
# 50 人同时提交会对应用内存、数据库 WAL 和后续导出造成明显压力。
# 产物**条数**上限（见 StageEventRequest.artifacts）挡的是异常批量，
# 这里的字节数才是真正的载荷护栏。
MAX_EVENT_REQUEST_BYTES = 256 * 1024


class ArtifactTooLargeError(ValueError):
    """单个产物快照超过限制。"""


class EventPayloadTooLargeError(ValueError):
    """事件 detail 或整请求总载荷超过限制。"""


class StageCombinationError(ValueError):
    """阶段、事件类型与产物类型的组合不符合教学流程。"""


class DuplicateArtifactError(ValueError):
    """一次请求内重复提交了同一 (artifact_type, artifact_key)。"""


class IdempotencyKeyReuseError(ValueError):
    """同一 request_id 被用于内容不同的请求。"""


@dataclass(frozen=True)
class ArtifactFingerprintInput:
    """指纹与去重校验所需的产物语义字段。

    与 API 层的 ``StageArtifactPayload`` 解耦：服务层不该依赖 Pydantic 模型，
    否则每次接口 schema 变动都会波及业务逻辑与其单元测试。
    """

    artifact_type: ArtifactType
    artifact_key: str
    content: Any
    change_source: ArtifactChangeSource
    change_reason: Optional[str] = None


# ── 阶段—事件—产物的合法组合 ──────────────────────────────────────────────────
#
# 后端是最终裁决者，不能只校验「枚举成员是否存在」。只做枚举校验时，
# ``stage=observe + event_type=module_test`` 这类不可能发生的组合会照常入库，
# 而这类脏数据在准实验分析阶段无法区分「学生真的这么操作」与「前端传错了」。

# 每种事件类型允许发生的阶段。
STAGE_EVENT_MATRIX: dict[StageEventType, frozenset[ProjectStage]] = {
    # 每个阶段都需要学生显式确认，才进入下一阶段。
    StageEventType.STAGE_CONFIRM: frozenset(ProjectStage),
    # 修订行为本身可以发生在任何阶段；真正受约束的是「修订了哪类产物」，
    # 见 ARTIFACT_NATIVE_STAGES 与 CROSS_STAGE_REVISION。
    StageEventType.STRUCTURE_CHANGE: frozenset(ProjectStage),
    # 求助在任何阶段都可能发生，这正是支架依赖分析要观察的。
    StageEventType.HELP_REQUEST: frozenset(ProjectStage),
    # 只有写了代码才谈得上模块测试。
    StageEventType.MODULE_TEST: frozenset(
        {ProjectStage.BUILD, ProjectStage.TRANSFER, ProjectStage.REFLECT}
    ),
    # 最终提交发生在建构完成之后。
    StageEventType.FINAL_SUBMIT: frozenset(
        {ProjectStage.BUILD, ProjectStage.TRANSFER, ProjectStage.REFLECT}
    ),
}

# 每种产物「原生」的阶段，即首次产出该产物的阶段。
ARTIFACT_NATIVE_STAGES: dict[ArtifactType, frozenset[ProjectStage]] = {
    ArtifactType.OBSERVATION: frozenset({ProjectStage.OBSERVE}),
    ArtifactType.FUNCTION_CARD: frozenset({ProjectStage.DECOMPOSE, ProjectStage.MODEL}),
    ArtifactType.FUNCTION_MAPPING: frozenset(
        {ProjectStage.DECOMPOSE, ProjectStage.MODEL}
    ),
    ArtifactType.MECHANISM: frozenset({ProjectStage.MODEL}),
    ArtifactType.PATH: frozenset({ProjectStage.PLAN}),
    ArtifactType.MODULE_CODE: frozenset({ProjectStage.BUILD, ProjectStage.TRANSFER}),
    ArtifactType.REVISION_NOTE: frozenset({ProjectStage.REFLECT}),
}

# 跨阶段修订白名单。
#
# 「回到解构结果进行修订」是本教学法的核心机制，不是异常路径。依据
# ``docs/archive/PROJECT_WORKBENCH_V02.md``：
#
# - 第 7 行：「遗漏会在综合运行中表现为可观察的问题，促使学生回到解构结果进行修订」
# - 第 30 行：「建构阶段持续引用学生的解构产物，测试失败能够返回对应功能或关系进行修订」
# - 第 246 行：「返回修订后的失效传播记录」
#
# 因此建构与反思阶段可以修订更早阶段的产物。反过来不成立：观察阶段不可能
# 产生模块代码。新增条目必须在此处显式列出并说明依据，不要改成全放开。
CROSS_STAGE_REVISION: frozenset[tuple[ProjectStage, ArtifactType]] = frozenset(
    {
        (ProjectStage.BUILD, ArtifactType.OBSERVATION),
        (ProjectStage.BUILD, ArtifactType.FUNCTION_CARD),
        (ProjectStage.BUILD, ArtifactType.FUNCTION_MAPPING),
        (ProjectStage.BUILD, ArtifactType.MECHANISM),
        (ProjectStage.BUILD, ArtifactType.PATH),
        (ProjectStage.REFLECT, ArtifactType.OBSERVATION),
        (ProjectStage.REFLECT, ArtifactType.FUNCTION_CARD),
        (ProjectStage.REFLECT, ArtifactType.FUNCTION_MAPPING),
        (ProjectStage.REFLECT, ArtifactType.MECHANISM),
        (ProjectStage.REFLECT, ArtifactType.PATH),
        (ProjectStage.REFLECT, ArtifactType.MODULE_CODE),
    }
)


def validate_stage_event_combination(
    stage: ProjectStage,
    event_type: StageEventType,
    artifact_types: list[ArtifactType],
) -> None:
    """校验阶段、事件类型与产物类型的组合，不合法抛 :class:`StageCombinationError`。

    在写入任何一行之前调用，避免脏组合留下半截证据。
    """
    allowed_stages = STAGE_EVENT_MATRIX.get(event_type)
    if allowed_stages is not None and stage not in allowed_stages:
        raise StageCombinationError(
            f"Event type '{event_type.value}' is not allowed in stage "
            f"'{stage.value}'; allowed stages: "
            f"{sorted(item.value for item in allowed_stages)}"
        )

    for artifact_type in artifact_types:
        native = ARTIFACT_NATIVE_STAGES.get(artifact_type)
        if native is None:
            continue
        if stage in native:
            continue
        if (stage, artifact_type) in CROSS_STAGE_REVISION:
            continue
        raise StageCombinationError(
            f"Artifact type '{artifact_type.value}' cannot be reported in stage "
            f"'{stage.value}'; it belongs to "
            f"{sorted(item.value for item in native)} and is not in the "
            f"cross-stage revision whitelist"
        )


def canonical_json(payload: Any) -> str:
    """生成稳定的规范化 JSON，用于内容哈希。

    键顺序会因前端序列化方式而变化，直接对原始字符串哈希会把「只是键顺序不同」
    误判为实质修改，从而产生大量无意义版本。

    注意：列表顺序**不**做规范化，因为在本项目中列表顺序有教学含义
    （例如实现路径的先后、流程节点的顺序），顺序变化属于实质修改。
    """
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def content_fingerprint(payload: Any) -> str:
    return hashlib.sha256(canonical_json(payload).encode("utf-8")).hexdigest()


def payload_size(payload: Any) -> int:
    return len(canonical_json(payload).encode("utf-8"))


def ensure_event_payload_within_limits(detail: Any, contents: list[Any]) -> None:
    """在写入任何一行之前，先校验整请求体量。

    先校验再写入，避免「写了一半才发现超限」而留下部分证据。
    """
    detail_bytes = payload_size(detail)
    if detail_bytes > MAX_EVENT_DETAIL_BYTES:
        raise EventPayloadTooLargeError(
            f"Event detail exceeds {MAX_EVENT_DETAIL_BYTES} bytes"
        )

    total = detail_bytes
    for content in contents:
        size = payload_size(content)
        if size > MAX_ARTIFACT_CONTENT_BYTES:
            raise ArtifactTooLargeError(
                f"Artifact content exceeds {MAX_ARTIFACT_CONTENT_BYTES} bytes"
            )
        total += size

    if total > MAX_EVENT_REQUEST_BYTES:
        raise EventPayloadTooLargeError(
            f"Stage event request exceeds {MAX_EVENT_REQUEST_BYTES} bytes"
        )


async def freeze_blueprint_version(
    db: AsyncSession,
    task: ResearchTask,
    user_id: uuid.UUID,
) -> Optional[uuid.UUID]:
    """向后兼容的转发入口。

    实际实现已移到 :mod:`app.services.research_task_service`，与 save-workspace /
    save-progress / complete 共用同一个原子 upsert。此前这里自带一份
    「先查、没有再 ``ON CONFLICT`` 插入」的逻辑，与那三个端点各写各的，
    结果是加上唯一约束后并发会 500（见交接文档 P0-B）。
    """
    from app.services.research_task_service import (
        freeze_blueprint_version as _freeze,
    )

    return await _freeze(db=db, task=task, user_id=user_id)


async def get_or_create_artifact(
    db: AsyncSession,
    task_id: uuid.UUID,
    user_id: uuid.UUID,
    stage: ProjectStage,
    artifact_type: ArtifactType,
    artifact_key: str,
    blueprint_version_id: Optional[uuid.UUID] = None,
) -> StageArtifact:
    """原子地取得产物的稳定身份记录。

    使用 ``ON CONFLICT DO NOTHING RETURNING``：同一学生开两个标签页同时确认
    同一张功能卡时，两个请求都能安全拿到同一行，而不是其中一个撞唯一约束报 500。
    """
    stmt = (
        pg_insert(StageArtifact)
        .values(
            id=uuid.uuid4(),
            task_id=task_id,
            user_id=user_id,
            stage=stage,
            artifact_type=artifact_type,
            artifact_key=artifact_key,
            blueprint_version_id=blueprint_version_id,
            current_version=0,
        )
        .on_conflict_do_nothing(constraint="uq_stage_artifact_identity")
        .returning(StageArtifact.id)
    )
    new_id = await db.scalar(stmt)

    if new_id is not None:
        artifact = await db.get(StageArtifact, new_id)
        if artifact is not None:
            return artifact

    artifact = await db.scalar(
        select(StageArtifact).where(
            StageArtifact.task_id == task_id,
            StageArtifact.user_id == user_id,
            StageArtifact.artifact_type == artifact_type,
            StageArtifact.artifact_key == artifact_key,
        )
    )
    if artifact is None:
        # 理论上不可达：插入未返回行即意味着冲突，冲突即意味着存在既有行。
        raise RuntimeError("Failed to resolve stage artifact identity")
    return artifact


async def record_artifact_version(
    db: AsyncSession,
    artifact: StageArtifact,
    content: dict,
    change_source: ArtifactChangeSource,
    change_reason: Optional[str] = None,
) -> tuple[Optional[ArtifactVersion], bool]:
    """追加一个产物版本；内容无实质变化时不创建。

    并发安全：先对 ``StageArtifact`` 行加 ``FOR UPDATE`` 行锁，再在锁内重新读取
    当前版本。否则两个并发请求可能读到相同的 ``current_version`` 并计算出相同的
    下一个版本号，撞 ``uq_artifact_version_seq`` 或造成指针丢失更新。

    ``populate_existing=True`` 不可省略：``get_or_create_artifact`` 已经把这一行
    放进了 Session 的 identity map，而 SQLAlchemy 默认**不会**用新查询的列值覆盖
    identity map 中已有对象的属性。少了它，``FOR UPDATE`` 虽然真的拿到了行锁，
    锁内读到的 ``current_version`` 仍是加锁前的旧值——等于锁白加了：并发的两次
    确认会算出同一个版本号，唯一约束报错、整个事件回滚。

    Returns:
        (version, created)。``created=False`` 时 ``version`` 为当前已存在的最新版本，
        便于调用方把事件关联到正确的版本上。
    """
    if payload_size(content) > MAX_ARTIFACT_CONTENT_BYTES:
        raise ArtifactTooLargeError(
            f"Artifact content exceeds {MAX_ARTIFACT_CONTENT_BYTES} bytes"
        )

    # 行锁：本事务内后续读取到的 current_version 不会被并发事务插队修改。
    # populate_existing 强制用本次查询的结果刷新 identity map 中的同一对象，
    # 否则读到的是加锁前的旧属性（见上方 docstring）。
    locked = await db.scalar(
        select(StageArtifact)
        .where(StageArtifact.id == artifact.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if locked is None:
        raise RuntimeError("Stage artifact disappeared before versioning")

    fingerprint = content_fingerprint(content)

    latest: Optional[ArtifactVersion] = None
    if locked.current_version_id is not None:
        latest = await db.get(ArtifactVersion, locked.current_version_id)

    # 内容未变则不产生新版本——学生反复点击「确认」不应污染修订次数这一研究指标。
    if latest is not None and latest.content_hash == fingerprint:
        return latest, False

    version = ArtifactVersion(
        artifact_id=locked.id,
        version=locked.current_version + 1,
        content=content,
        content_hash=fingerprint,
        previous_version_id=latest.id if latest else None,
        change_source=change_source,
        change_reason=change_reason,
    )
    db.add(version)
    await db.flush()

    locked.current_version_id = version.id
    locked.current_version = version.version
    await db.flush()

    return version, True


def stage_event_fingerprint(
    task_id: uuid.UUID,
    stage: ProjectStage,
    event_type: StageEventType,
    detail: Optional[dict],
    artifacts: list["ArtifactFingerprintInput"],
) -> str:
    """计算一次 stage-event 请求的**完整语义指纹**。

    必须覆盖所有会改变请求含义的字段。只纳入 ``content`` 是不够的：同一份内容
    换成另一张卡（``artifact_key``）、另一类产物（``artifact_type``）或另一种
    修改来源（``change_source``）都是**不同的上报**，若指纹相同就会被误判为重放，
    这次真实数据被静默丢弃。

    产物顺序纳入指纹：``position`` 会写入关联表，顺序不同即为不同的上报。

    刻意排除的内容：服务器生成的时间戳、事件 ID、蓝图版本 ID。这些由服务端决定，
    纳入后同一次网络重试会得到不同指纹，反而破坏幂等。
    """
    return content_fingerprint(
        {
            "task_id": str(task_id),
            "stage": stage.value,
            "event_type": event_type.value,
            "detail": detail or {},
            "artifacts": [
                {
                    "position": position,
                    "artifact_type": item.artifact_type.value,
                    "artifact_key": item.artifact_key,
                    "change_source": item.change_source.value,
                    "change_reason": item.change_reason,
                    "content": item.content,
                }
                for position, item in enumerate(artifacts)
            ],
        }
    )


def ensure_no_duplicate_artifacts(
    artifacts: list["ArtifactFingerprintInput"],
) -> None:
    """禁止一次请求内重复提交同一 ``(artifact_type, artifact_key)``。

    关联表的 ``uq_stage_event_artifact`` 会让第二项 ``ON CONFLICT DO NOTHING``
    静默消失：接口返回 200、响应里却少了一个产物，客户端无从察觉。更糟的是
    两项内容不同时，先写入的那一版会被后一次 ``record_artifact_version``
    追加成新版本，于是「一次关键时刻」凭空多出一次修订，污染修订次数指标。

    因此在写入任何一行之前显式拒绝，由端点返回 422。
    """
    seen: set[tuple[str, str]] = set()
    for item in artifacts:
        identity = (item.artifact_type.value, item.artifact_key)
        if identity in seen:
            raise DuplicateArtifactError(
                f"Duplicated artifact in one request: "
                f"type='{identity[0]}', key='{identity[1]}'"
            )
        seen.add(identity)


async def record_stage_event(
    db: AsyncSession,
    task_id: uuid.UUID,
    user_id: uuid.UUID,
    request_id: str,
    stage: ProjectStage,
    event_type: StageEventType,
    detail: Optional[dict] = None,
    blueprint_version_id: Optional[uuid.UUID] = None,
    request_fingerprint: Optional[str] = None,
) -> tuple[StageEvent, bool]:
    """写入一次关键教学事件。

    幂等：``(user_id, request_id)`` 唯一。浏览器重试、反向代理重发或学生重复点击
    只会得到同一条事件，不会把一个关键时刻重复计入研究指标。

    但**唯一键本身不足以保证幂等语义正确**。若前端错误复用了 request_id 而内容
    不同（最典型的是跨任务复用），只按键去重会返回另一个任务的旧事件、同时静默
    丢弃这次真实上报。因此这里额外比对 ``request_fingerprint``：

    - 键相同且指纹相同 → 真正的重放，返回既有事件，``created=False``；
    - 键相同但指纹不同 → 抛 :class:`IdempotencyKeyReuseError`，由端点返回 409。

    Returns:
        (event, created)。``created=False`` 表示这是一次重放，调用方不应再追加
        产物关联，也不应把它当作新的关键时刻。
    """
    stmt = (
        pg_insert(StageEvent)
        .values(
            id=uuid.uuid4(),
            task_id=task_id,
            user_id=user_id,
            request_id=request_id,
            request_fingerprint=request_fingerprint,
            stage=stage,
            event_type=event_type,
            blueprint_version_id=blueprint_version_id,
            detail=detail or {},
        )
        .on_conflict_do_nothing(constraint="uq_stage_event_request")
        .returning(StageEvent.id)
    )
    new_id = await db.scalar(stmt)

    if new_id is not None:
        event = await db.get(StageEvent, new_id)
        if event is not None:
            return event, True

    existing = await db.scalar(
        select(StageEvent).where(
            StageEvent.user_id == user_id,
            StageEvent.request_id == request_id,
        )
    )
    if existing is None:
        raise RuntimeError("Failed to resolve stage event identity")

    # 键被复用但内容不同：这不是重试，是前端的 ID 生成缺陷。
    # 静默返回旧事件会同时造成两个后果——本次真实上报丢失，
    # 且调用方拿到的是另一次（可能属于另一个任务的）事件。
    if (
        request_fingerprint is not None
        and existing.request_fingerprint is not None
        and existing.request_fingerprint != request_fingerprint
    ):
        raise IdempotencyKeyReuseError(
            f"request_id '{request_id}' was already used for a different payload"
        )

    return existing, False


async def link_event_artifact(
    db: AsyncSession,
    event: StageEvent,
    artifact: StageArtifact,
    artifact_version: Optional[ArtifactVersion],
    version_created: bool,
    position: int,
) -> None:
    """把一个产物版本关联到事件上。

    一次阶段确认可能同时涉及多个产物，事件必须能全部追溯，
    否则导出时只能看到第一个，其余关联静默丢失。
    """
    stmt = (
        pg_insert(StageEventArtifact)
        .values(
            id=uuid.uuid4(),
            event_id=event.id,
            artifact_id=artifact.id,
            artifact_version_id=artifact_version.id if artifact_version else None,
            version_created=version_created,
            position=position,
        )
        .on_conflict_do_nothing(constraint="uq_stage_event_artifact")
    )
    await db.execute(stmt)


async def record_scaffold_event(
    db: AsyncSession,
    user_id: uuid.UUID,
    scaffold_metadata: dict,
    student_message_id: Optional[uuid.UUID] = None,
    assistant_message_id: Optional[uuid.UUID] = None,
    delivery_status: ScaffoldDeliveryStatus = ScaffoldDeliveryStatus.DELIVERED,
) -> Optional[ScaffoldEvent]:
    """把一次**已送达**的支架交互落成规范事件行。

    调用时机：助手回复成功保存之后，与助手消息同一事务提交。若在生成回复之前写入，
    模型超时或失败时会留下「已应用 L0–L3 支架」但学生什么也没收到的假记录。
    「学生发起求助」这一行为由 ``StageEvent(help_request)`` 单独记录。

    与 ``chat_messages.analysis.scaffoldContext`` 双写；本表是后续研究分析的
    规范数据源，旧 JSONB 保留以兼容既有页面与导出。

    幂等：同一 ``(user_id, request_id)`` 只写一条。使用 ``ON CONFLICT DO NOTHING``
    而非「先查再插」——后者在并发下会让事务进入失败状态，而本函数与学生聊天消息
    共用事务，那将直接导致对话返回 500。
    """
    request_id = str(scaffold_metadata.get("requestId") or "").strip()
    if not request_id:
        logger.warning("Scaffold event skipped: missing requestId")
        return None

    stage_raw = str(scaffold_metadata.get("stage") or "")
    try:
        stage = ProjectStage(stage_raw)
    except ValueError:
        logger.warning("Scaffold event skipped: unknown stage %r", stage_raw)
        return None

    task_id = _safe_uuid(scaffold_metadata.get("taskId"))
    if task_id is not None:
        exists = await db.scalar(select(ResearchTask.id).where(ResearchTask.id == task_id))
        if exists is None:
            task_id = None

    profile = scaffold_metadata.get("profileSnapshot") or {}

    stmt = (
        pg_insert(ScaffoldEvent)
        .values(
            id=uuid.uuid4(),
            task_id=task_id,
            user_id=user_id,
            request_id=request_id,
            student_message_id=student_message_id,
            assistant_message_id=assistant_message_id,
            delivery_status=delivery_status,
            stage=stage,
            trigger=str(scaffold_metadata.get("trigger") or "student_message")[:40],
            requested_level=_safe_int(scaffold_metadata.get("requestedLevel"), 0),
            applied_level=_safe_int(scaffold_metadata.get("level"), 0),
            was_clamped=bool(scaffold_metadata.get("policyWasClamped")),
            policy_source=str(scaffold_metadata.get("policySource") or "platform_default")[:40],
            policy_max_code_lines=_safe_int(scaffold_metadata.get("policyMaxCodeLines"), 0),
            blueprint_version_id=_safe_uuid(scaffold_metadata.get("blueprintVersionId")),
            current_module=(
                str(scaffold_metadata["currentModule"])[:300]
                if scaffold_metadata.get("currentModule")
                else None
            ),
            profile_cognition=_safe_optional_int(profile.get("cognition")),
            profile_affect=_safe_optional_int(profile.get("affect")),
            profile_behavior=_safe_optional_int(profile.get("behavior")),
            code_length=_safe_int(scaffold_metadata.get("codeLength"), 0),
            code_fingerprint=(
                str(scaffold_metadata["codeFingerprint"])[:32]
                if scaffold_metadata.get("codeFingerprint")
                else None
            ),
            # adopted 留空：任务 5 建立「建议—采用—修改—结果」链路后才可判定。
            # 不得依据当前不完整的字段推测学生是否采用了建议。
            adopted=None,
        )
        .on_conflict_do_nothing(constraint="uq_scaffold_event_request")
        .returning(ScaffoldEvent.id)
    )
    new_id = await db.scalar(stmt)

    if new_id is not None:
        return await db.get(ScaffoldEvent, new_id)

    # 冲突：同一 request_id 已写入（客户端重试或并发重复提交）。
    return await db.scalar(
        select(ScaffoldEvent).where(
            ScaffoldEvent.user_id == user_id,
            ScaffoldEvent.request_id == request_id,
        )
    )


def _safe_uuid(value: Any) -> Optional[uuid.UUID]:
    if isinstance(value, uuid.UUID):
        return value
    if not value:
        return None
    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        return None


def _safe_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _safe_optional_int(value: Any) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
