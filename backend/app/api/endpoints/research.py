"""
用户端研究任务 API 端点
"""
import uuid
import json
import re
from datetime import datetime, timezone
from typing import Literal, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import case, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.endpoints.auth import get_current_user
from app.db.postgres import get_db
from app.schemas.base import SuccessResponse
from app.models.sql.research import (
    ProjectBlueprintVersion,
    ResearchTask,
    ResearchTaskSubmission,
    ResearchTaskStatus,
)
from app.models.sql.research_event import (
    ArtifactChangeSource,
    ArtifactType,
    ArtifactVersion,
    ProjectStage,
    StageArtifact,
    StageEventArtifact,
    StageEventType,
)
from app.schemas.project_blueprint import BlueprintNode, ProjectBlueprintConfig
from app.services.research_event_service import (
    ArtifactFingerprintInput,
    ArtifactTooLargeError,
    DuplicateArtifactError,
    EventPayloadTooLargeError,
    IdempotencyKeyReuseError,
    StageCombinationError,
    content_fingerprint,
    ensure_event_payload_within_limits,
    ensure_no_duplicate_artifacts,
    freeze_blueprint_version,
    get_or_create_artifact,
    link_event_artifact,
    record_artifact_version,
    record_stage_event,
    stage_event_fingerprint,
    validate_stage_event_combination,
)
from app.services.research_task_service import (
    get_visible_task,
    parse_task_uuid,
    upsert_submission,
)
from app.models.sql.user import User

router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────

class ActiveTaskResponse(BaseModel):
    id: str
    title: str
    description: Optional[str]
    instructions: Optional[str]
    ai_prompt: Optional[str]
    code_content: str
    language: str
    target_group: str
    # 当前用户的提交状态（若无提交记录则为默认值）
    is_completed: bool = False
    code_submitted: Optional[str] = None
    workspace_data: Optional[dict] = None
    blueprint_version_id: Optional[str] = None


class SaveProgressRequest(BaseModel):
    code_submitted: str
    started_at: Optional[str] = None


class CompleteTaskRequest(BaseModel):
    code_submitted: str
    started_at: Optional[str] = None


class SaveWorkspaceRequest(BaseModel):
    workspace_data: dict


class StageArtifactPayload(BaseModel):
    """一次事件中随附的单个学习产物快照。"""

    artifact_type: Literal[
        "observation",
        "function_card",
        "function_mapping",
        "mechanism",
        "path",
        "module_code",
        "revision_note",
    ]
    artifact_key: str = Field(min_length=1, max_length=120)
    content: dict
    change_source: Literal[
        "stage_confirm",
        "structure_edit",
        "test_revision",
        "scaffold_followup",
        "import",
    ] = "structure_edit"
    change_reason: Optional[str] = Field(default=None, max_length=500)

    @field_validator("artifact_key")
    @classmethod
    def _clean_artifact_key(cls, value: str) -> str:
        """产物键必须是稳定标识，去空白后不得为空。

        Pydantic 的 ``min_length`` 不会拒绝 ``"   "``；若允许前后空格，
        ``"card-1"`` 与 ``"card-1 "`` 会被当成两个不同的产物身份。
        """
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("artifact_key must not be blank")
        return cleaned

    @field_validator("change_reason")
    @classmethod
    def _clean_change_reason(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


class StageEventRequest(BaseModel):
    """学生端在有明确教学含义的操作完成后上报。

    刻意不接收拖拽坐标、逐字输入和游戏运行帧：这些不构成研究证据，
    且会在 40–50 人并发下形成无意义写入。
    """

    request_id: str = Field(
        min_length=1,
        max_length=100,
        description="前端生成、在网络重试中保持稳定的请求 ID；与当前用户构成幂等键",
    )
    stage: Literal["observe", "decompose", "model", "plan", "build", "reflect"]
    event_type: Literal[
        "stage_confirm",
        "structure_change",
        "module_test",
        "help_request",
        "final_submit",
    ]
    detail: dict = Field(default_factory=dict)
    # 上限按「功能拆解阶段确认」这个最大的一次上报来定：它同时携带功能卡和
    # 学生对教师契约的采纳决定，产物数是功能卡数的两倍。40 只够 20 张卡，
    # 认真拆解的学生会超出，然后整个阶段确认被 Pydantic 拒成 422 而丢失。
    # 真正的载荷护栏是 ensure_event_payload_within_limits 的字节数检查（413），
    # 这里只挡住明显异常的批量，取 80。
    artifacts: list[StageArtifactPayload] = Field(default_factory=list, max_length=80)

    @field_validator("request_id")
    @classmethod
    def _clean_request_id(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("request_id must not be blank")
        return cleaned


class StageEventArtifactResult(BaseModel):
    artifact_id: str
    artifact_type: str
    artifact_key: str
    version: int
    version_created: bool


class StageEventResponse(BaseModel):
    event_id: str
    stage: str
    event_type: str
    blueprint_version_id: Optional[str]
    artifacts: list[StageEventArtifactResult]
    replayed: bool = Field(
        default=False,
        description="True 表示该 request_id 已记录过，本次为重放，未新增事件",
    )


class FinalSubmitRequest(BaseModel):
    """一次最终提交。

    刻意把「写 final_submit 事件」与「标记任务完成」合并成一个请求：分成两次调用时
    它们不在同一个事务里，第二次失败后前端重试会生成新的 request_id，于是同一次
    提交产生两条 final_submit 事件；反过来若先标记完成再写事件，则会出现「已完成
    但没有提交证据」的记录。两种结果都让「学生何时真正提交」无法从数据里还原。
    """

    request_id: str = Field(
        min_length=1,
        max_length=100,
        description="前端生成、在整次提交的所有重试中保持稳定的幂等键",
    )
    # 允许 reflect：STAGE_EVENT_MATRIX 里 final_submit 就是 build/reflect 两个阶段，
    # 这里不额外收窄，否则以后开放 reflect 阶段还要改两处。
    stage: Literal["build", "reflect"] = "build"
    code_submitted: str = Field(default="", max_length=200000)
    started_at: Optional[str] = None
    detail: dict = Field(default_factory=dict)
    artifacts: list[StageArtifactPayload] = Field(default_factory=list, max_length=80)

    @field_validator("request_id")
    @classmethod
    def _clean_request_id(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("request_id must not be blank")
        return cleaned


class FinalSubmitResponse(BaseModel):
    event_id: str
    stage: str
    blueprint_version_id: Optional[str]
    artifacts: list[StageEventArtifactResult]
    completed: bool
    submitted_at: Optional[str]
    replayed: bool = Field(
        default=False,
        description="True 表示这次是同一 request_id 的重放，未新增事件、版本或提交记录",
    )


class FunctionMappingSuggestionRequest(BaseModel):
    observation_text: str = Field(default="", max_length=500)
    responsibility: str = Field(min_length=1, max_length=100)
    boundary_reason: str = Field(default="", max_length=300)
    input_text: str = Field(default="", max_length=300)
    output_text: str = Field(default="", max_length=300)
    knowledge: list[str] = Field(default_factory=list, max_length=20)


class FunctionMappingSuggestionItem(BaseModel):
    node_id: str
    title_zh: str
    match_reasons: list[str]
    score: int


class FunctionMappingSuggestionResponse(BaseModel):
    blueprint_version_id: str
    suggestions: list[FunctionMappingSuggestionItem]


def _parse_client_timestamp(raw: Optional[str]) -> Optional[datetime]:
    """解析客户端上报的 ISO 时间戳，非法值按「没有提供」处理。

    学生端可能因时区库差异或本地时间被改动而发来无法解析的字符串。
    这只是辅助统计学习时长的字段，不值得让整次保存失败。
    """
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None


async def _load_student_blueprint(
    db: AsyncSession,
    task: ResearchTask,
    user_id: uuid.UUID,
) -> tuple[ProjectBlueprintConfig | None, uuid.UUID | None]:
    """Load the immutable blueprint version assigned to this student."""

    blueprint_id = await db.scalar(
        select(ResearchTaskSubmission.blueprint_version_id).where(
            ResearchTaskSubmission.task_id == task.id,
            ResearchTaskSubmission.user_id == user_id,
        )
    )
    effective_id = blueprint_id or task.current_blueprint_version_id
    if effective_id is None:
        return None, None
    raw_config = await db.scalar(
        select(ProjectBlueprintVersion.config).where(
            ProjectBlueprintVersion.id == effective_id,
            ProjectBlueprintVersion.task_id == task.id,
        )
    )
    if not raw_config:
        return None, effective_id
    return ProjectBlueprintConfig.model_validate(raw_config), effective_id


def _mapping_suggestions(
    data: FunctionMappingSuggestionRequest,
    nodes: list[BlueprintNode],
) -> list[FunctionMappingSuggestionItem]:
    """Rank teacher contracts without exposing aliases, tests or dependencies."""

    query = " ".join(
        [
            data.observation_text,
            data.responsibility,
            data.boundary_reason,
            data.input_text,
            data.output_text,
            *data.knowledge,
        ]
    ).lower()
    query = re.sub(r"\s+", " ", query)
    ranked: list[FunctionMappingSuggestionItem] = []
    for node in nodes:
        score = 0
        reasons: list[str] = []

        responsibility_terms = [node.titleZh, *node.synonyms]
        if any(term.strip().lower() in query for term in responsibility_terms if term.strip()):
            score += 5
            reasons.append("职责表达相近")

        contract_terms = [*node.contract.inputs, *node.contract.outputs]
        contract_hits = sum(
            1 for term in contract_terms if term.strip() and term.strip().lower() in query
        )
        if contract_hits:
            score += min(contract_hits, 3) * 2
            reasons.append("输入输出相近")

        knowledge_hits = sum(
            1
            for item in node.knowledge
            if item.labelZh.strip() and item.labelZh.strip().lower() in query
        )
        if knowledge_hits:
            score += min(knowledge_hits, 3)
            reasons.append("所需知识相近")

        if node.scenarioZh.strip() and node.scenarioZh.strip().lower() in query:
            score += 2
            reasons.append("运行场景相近")

        if score > 0:
            ranked.append(
                FunctionMappingSuggestionItem(
                    node_id=node.id,
                    title_zh=node.titleZh,
                    match_reasons=reasons,
                    score=score,
                )
            )

    ranked.sort(key=lambda item: (-item.score, item.title_zh, item.node_id))
    return ranked[:3]


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/active-task")
async def get_active_task(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SuccessResponse[ActiveTaskResponse]:
    """获取当前激活的研究任务"""
    result = await db.execute(
        select(ResearchTask)
        .where(
            ResearchTask.status == ResearchTaskStatus.ACTIVE,
            or_(
                ResearchTask.target_group == "all",
                ResearchTask.target_group == current_user.experiment_group,
            ),
        )
        .order_by(
            case((ResearchTask.target_group == current_user.experiment_group, 0), else_=1),
            ResearchTask.updated_at.desc(),
        )
        .limit(1)
    )
    task = result.scalar_one_or_none()

    if not task:
        raise HTTPException(status_code=404, detail="No active research task")

    # 查询该用户的提交记录
    sub_result = await db.execute(
        select(ResearchTaskSubmission)
        .where(
            ResearchTaskSubmission.task_id == task.id,
            ResearchTaskSubmission.user_id == current_user.id,
        )
    )
    submission = sub_result.scalar_one_or_none()
    effective_blueprint_id = (
        submission.blueprint_version_id
        if submission and submission.blueprint_version_id
        else task.current_blueprint_version_id
    )

    return SuccessResponse(data=ActiveTaskResponse(
        id=str(task.id),
        title=task.title,
        description=task.description,
        instructions=task.instructions,
        ai_prompt=task.ai_prompt,
        code_content=task.code_content,
        language=task.language,
        target_group=task.target_group,
        is_completed=submission.is_completed if submission else False,
        code_submitted=submission.code_submitted if submission else None,
        workspace_data=submission.workspace_data if submission else None,
        blueprint_version_id=str(effective_blueprint_id) if effective_blueprint_id else None,
        # 当前只向学生端暴露版本标识，不返回同义表达、标准前置关系、
        # 隐藏测试和支架内部规则；后续按阶段设计专用公开视图。
    ))


@router.post("/tasks/{task_id}/blueprint/function-mapping-suggestions")
async def suggest_function_mapping(
    task_id: str,
    data: FunctionMappingSuggestionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SuccessResponse[FunctionMappingSuggestionResponse]:
    """Return safe contract suggestions from the student's frozen blueprint.

    The response intentionally excludes synonyms, prerequisites, hidden tests,
    scaffold rules and function templates. Mapping remains a student decision.
    """

    try:
        tid = uuid.UUID(task_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid task_id") from exc

    # 这里读取的是教师蓝图派生出的契约建议，属于按实验组分发的教学内容，
    # 因此必须同时校验可见性与 ACTIVE：归档任务不应再向学生下发策略派生物。
    task = await get_visible_task(db, current_user, tid, require_active=True)

    blueprint, blueprint_id = await _load_student_blueprint(db, task, current_user.id)
    if blueprint is None or blueprint_id is None:
        raise HTTPException(status_code=404, detail="No published project blueprint")

    return SuccessResponse(
        data=FunctionMappingSuggestionResponse(
            blueprint_version_id=str(blueprint_id),
            suggestions=_mapping_suggestions(data, blueprint.nodes),
        )
    )


def _build_artifact_inputs(
    payloads: list[StageArtifactPayload],
) -> list[ArtifactFingerprintInput]:
    return [
        ArtifactFingerprintInput(
            artifact_type=ArtifactType(payload.artifact_type),
            artifact_key=payload.artifact_key,
            content=payload.content,
            change_source=ArtifactChangeSource(payload.change_source),
            change_reason=payload.change_reason,
        )
        for payload in payloads
    ]


def _validate_event_request(
    stage: ProjectStage,
    event_type: StageEventType,
    detail: dict,
    artifact_inputs: list[ArtifactFingerprintInput],
) -> None:
    """写入任何一行之前完成全部校验。

    顺序是有意的：组合校验先于体量校验（不合法的组合无论多小都不该入库），
    体量校验先于写入（避免写到一半才发现超限，留下半截证据）。

    由 ``stage-events`` 与 ``final-submit`` 共用，避免两处校验逐渐走样——
    只在一处放宽，另一处就成了绕过校验的入口。
    """
    try:
        validate_stage_event_combination(
            stage, event_type, [item.artifact_type for item in artifact_inputs]
        )
    except StageCombinationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    try:
        ensure_no_duplicate_artifacts(artifact_inputs)
    except DuplicateArtifactError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    try:
        ensure_event_payload_within_limits(
            detail, [item.content for item in artifact_inputs]
        )
    except (ArtifactTooLargeError, EventPayloadTooLargeError) as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc


async def _load_replayed_artifacts(
    db: AsyncSession,
    event_id: uuid.UUID,
) -> list[StageEventArtifactResult]:
    """取事件**当时**关联的产物版本。

    必须用关联表里记下的 ``artifact_version_id``，而不是产物的 ``current_version``：
    学生在该事件之后又修订出 v2/v3 时，重放旧 request_id 会把旧事件误报成最新版本，
    导出与接口返回互相矛盾。
    """
    links = (
        await db.execute(
            select(StageEventArtifact, StageArtifact, ArtifactVersion)
            .join(StageArtifact, StageEventArtifact.artifact_id == StageArtifact.id)
            .outerjoin(
                ArtifactVersion,
                StageEventArtifact.artifact_version_id == ArtifactVersion.id,
            )
            .where(StageEventArtifact.event_id == event_id)
            .order_by(StageEventArtifact.position)
        )
    ).all()

    return [
        StageEventArtifactResult(
            artifact_id=str(artifact.id),
            artifact_type=artifact.artifact_type.value,
            artifact_key=artifact.artifact_key,
            # 关联版本为空只可能出现在「本次未产生新版本且此前也从未有过版本」
            # 的边界；此时退回当前版本是唯一可用值。
            version=(
                version.version if version is not None else artifact.current_version
            ),
            version_created=link.version_created,
        )
        for link, artifact, version in links
    ]


async def _persist_event_artifacts(
    db: AsyncSession,
    event,
    task_id: uuid.UUID,
    user_id: uuid.UUID,
    stage: ProjectStage,
    blueprint_version_id: Optional[uuid.UUID],
    artifact_inputs: list[ArtifactFingerprintInput],
) -> list[StageEventArtifactResult]:
    """追加产物版本并全部关联到事件上。

    事件关联**全部**产物而不只是第一个——一次阶段确认常同时涉及功能卡、
    关系图和路径，只记第一个会让其余关联静默丢失。
    """
    results: list[StageEventArtifactResult] = []

    for position, item in enumerate(artifact_inputs):
        artifact = await get_or_create_artifact(
            db=db,
            task_id=task_id,
            user_id=user_id,
            stage=stage,
            artifact_type=item.artifact_type,
            artifact_key=item.artifact_key,
            blueprint_version_id=blueprint_version_id,
        )
        try:
            version, version_created = await record_artifact_version(
                db=db,
                artifact=artifact,
                content=item.content,
                change_source=item.change_source,
                change_reason=item.change_reason,
            )
        except ArtifactTooLargeError as exc:
            await db.rollback()
            raise HTTPException(status_code=413, detail=str(exc)) from exc

        await link_event_artifact(
            db=db,
            event=event,
            artifact=artifact,
            artifact_version=version,
            version_created=version_created,
            position=position,
        )

        results.append(
            StageEventArtifactResult(
                artifact_id=str(artifact.id),
                artifact_type=artifact.artifact_type.value,
                artifact_key=artifact.artifact_key,
                version=version.version if version else artifact.current_version,
                version_created=version_created,
            )
        )

    return results


@router.post("/tasks/{task_id}/stage-events")
async def create_stage_event(
    task_id: str,
    data: StageEventRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SuccessResponse[StageEventResponse]:
    """记录一次关键教学事件，并按需追加相关产物版本。

    与 ``save-workspace`` 的分工：
    - ``save-workspace`` 保存最新整份快照，只用于跨设备恢复，会被覆盖；
    - 本接口写入**不可覆盖**的产物版本与事件，作为正式实验的证据链。

    后端是最终裁决者：校验任务归属与可见性、阶段—事件—产物组合是否符合教学流程，
    并比较产物内容与上一版本；内容没有实质变化时不创建新版本（学生反复点确认
    不会污染修订次数）。但后端不会仅凭工作区快照 diff 猜测学生行为——哪一次操作
    具有教学含义由前端在明确交互点上报。
    """
    tid = parse_task_uuid(task_id)
    # 归档/草稿任务不再接收新证据：研究数据里不应出现「任务已结束之后
    # 仍在产生过程数据」这种无法解释的记录。
    task = await get_visible_task(db, current_user, tid, require_active=True)

    stage = ProjectStage(data.stage)
    event_type = StageEventType(data.event_type)
    artifact_inputs = [
        ArtifactFingerprintInput(
            artifact_type=ArtifactType(payload.artifact_type),
            artifact_key=payload.artifact_key,
            content=payload.content,
            change_source=ArtifactChangeSource(payload.change_source),
            change_reason=payload.change_reason,
        )
        for payload in data.artifacts
    ]

    # 组合校验先于体量校验：不合法的组合无论多小都不该入库。
    try:
        validate_stage_event_combination(
            stage, event_type, [item.artifact_type for item in artifact_inputs]
        )
    except StageCombinationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # 请求内重复产物必须显式拒绝：关联表的唯一约束只会让第二项静默消失，
    # 接口仍返回 200，客户端无从察觉少写了证据。
    try:
        ensure_no_duplicate_artifacts(artifact_inputs)
    except DuplicateArtifactError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # 再校验整请求体量，仍在写入任何一行之前，避免写到一半才发现超限。
    try:
        ensure_event_payload_within_limits(
            data.detail, [item.content for item in artifact_inputs]
        )
    except (ArtifactTooLargeError, EventPayloadTooLargeError) as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc

    # 首次关键事件即冻结教师蓝图版本，避免同一学习过程跨越两个版本。
    blueprint_version_id = await freeze_blueprint_version(db, task, current_user.id)

    fingerprint = stage_event_fingerprint(
        task_id=tid,
        stage=stage,
        event_type=event_type,
        detail=data.detail,
        artifacts=artifact_inputs,
    )

    try:
        event, created = await record_stage_event(
            db=db,
            task_id=tid,
            user_id=current_user.id,
            request_id=data.request_id,
            stage=stage,
            event_type=event_type,
            detail=data.detail,
            blueprint_version_id=blueprint_version_id,
            request_fingerprint=fingerprint,
        )
    except IdempotencyKeyReuseError as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "IDEMPOTENCY_KEY_REUSED",
                "message": str(exc),
            },
        ) from exc

    if not created:
        # 重放：同一 request_id 且内容一致。返回既有事件及其产物关联，
        # 不再追加版本，避免网络重试污染「修订次数」与「阶段确认数」。
        #
        # 版本号必须取**事件发生当时**关联的那一版，而不是产物的当前版本：
        # 学生在该事件之后又修订出 v2/v3 时，重放旧 request_id 会把旧事件
        # 误报成最新版本，导出与接口返回互相矛盾。
        links = (
            await db.execute(
                select(StageEventArtifact, StageArtifact, ArtifactVersion)
                .join(StageArtifact, StageEventArtifact.artifact_id == StageArtifact.id)
                .outerjoin(
                    ArtifactVersion,
                    StageEventArtifact.artifact_version_id == ArtifactVersion.id,
                )
                .where(StageEventArtifact.event_id == event.id)
                .order_by(StageEventArtifact.position)
            )
        ).all()
        await db.commit()
        return SuccessResponse(
            data=StageEventResponse(
                event_id=str(event.id),
                stage=event.stage.value,
                event_type=event.event_type.value,
                blueprint_version_id=(
                    str(event.blueprint_version_id) if event.blueprint_version_id else None
                ),
                artifacts=[
                    StageEventArtifactResult(
                        artifact_id=str(artifact.id),
                        artifact_type=artifact.artifact_type.value,
                        artifact_key=artifact.artifact_key,
                        # 关联版本为空只可能出现在「本次未产生新版本且此前也
                        # 从未有过版本」的边界；此时退回当前版本是唯一可用值。
                        version=(
                            version.version
                            if version is not None
                            else artifact.current_version
                        ),
                        version_created=link.version_created,
                    )
                    for link, artifact, version in links
                ],
                replayed=True,
            )
        )

    artifact_results: list[StageEventArtifactResult] = []

    for position, item in enumerate(artifact_inputs):
        artifact = await get_or_create_artifact(
            db=db,
            task_id=tid,
            user_id=current_user.id,
            stage=stage,
            artifact_type=item.artifact_type,
            artifact_key=item.artifact_key,
            blueprint_version_id=blueprint_version_id,
        )
        try:
            version, version_created = await record_artifact_version(
                db=db,
                artifact=artifact,
                content=item.content,
                change_source=item.change_source,
                change_reason=item.change_reason,
            )
        except ArtifactTooLargeError as exc:
            await db.rollback()
            raise HTTPException(status_code=413, detail=str(exc)) from exc

        # 事件关联全部产物，而不只是第一个——一次阶段确认常同时涉及
        # 功能卡、关系图和路径，只记第一个会让其余关联静默丢失。
        await link_event_artifact(
            db=db,
            event=event,
            artifact=artifact,
            artifact_version=version,
            version_created=version_created,
            position=position,
        )

        artifact_results.append(
            StageEventArtifactResult(
                artifact_id=str(artifact.id),
                artifact_type=artifact.artifact_type.value,
                artifact_key=artifact.artifact_key,
                version=version.version if version else artifact.current_version,
                version_created=version_created,
            )
        )

    await db.commit()

    return SuccessResponse(
        data=StageEventResponse(
            event_id=str(event.id),
            stage=stage.value,
            event_type=event_type.value,
            blueprint_version_id=str(blueprint_version_id) if blueprint_version_id else None,
            artifacts=artifact_results,
            replayed=False,
        )
    )


@router.post("/tasks/{task_id}/final-submit")
async def final_submit_task(
    task_id: str,
    data: FinalSubmitRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SuccessResponse[FinalSubmitResponse]:
    """原子地记录最终提交证据并完成任务。

    ``final_submit`` 事件、关联产物版本和 ``research_task_submissions`` 完成状态
    必须在同一个事务里提交。任何一步失败都会回滚全部写入，避免出现“有提交事件但
    任务未完成”或“任务已完成但没有最终证据”的半完成状态。

    ``request_id`` 同时保护浏览器自动重试和学生手动重试：同键同内容返回第一次
    提交结果；同键不同内容返回 409，不会把另一版代码误判成重放。
    """
    tid = parse_task_uuid(task_id)
    task = await get_visible_task(db, current_user, tid, require_active=True)
    stage = ProjectStage(data.stage)
    event_type = StageEventType.FINAL_SUBMIT
    artifact_inputs = _build_artifact_inputs(data.artifacts)
    _validate_event_request(stage, event_type, data.detail, artifact_inputs)

    started_at = _parse_client_timestamp(data.started_at)
    event_fingerprint = stage_event_fingerprint(
        task_id=tid,
        stage=stage,
        event_type=event_type,
        detail=data.detail,
        artifacts=artifact_inputs,
    )
    # 最终提交的语义还包括整份代码与开始时间。只复用 stage-event 指纹会让两份
    # 长度相同但内容不同的代码在错误复用 request_id 时被静默当作同一次提交。
    request_fingerprint = content_fingerprint(
        {
            "event_fingerprint": event_fingerprint,
            "code_submitted": data.code_submitted,
            "started_at": started_at.isoformat() if started_at else None,
        }
    )

    try:
        blueprint_version_id = await freeze_blueprint_version(
            db, task, current_user.id
        )
        event, created = await record_stage_event(
            db=db,
            task_id=tid,
            user_id=current_user.id,
            request_id=data.request_id,
            stage=stage,
            event_type=event_type,
            detail=data.detail,
            blueprint_version_id=blueprint_version_id,
            request_fingerprint=request_fingerprint,
        )

        if created:
            artifact_results = await _persist_event_artifacts(
                db=db,
                event=event,
                task_id=tid,
                user_id=current_user.id,
                stage=stage,
                blueprint_version_id=blueprint_version_id,
                artifact_inputs=artifact_inputs,
            )
        else:
            artifact_results = await _load_replayed_artifacts(db, event.id)

        # event.created_at 是第一次成功提交时生成的稳定服务器时间。重放继续写入同一
        # 时间，而不是用“本次重试时间”覆盖 submitted_at，保证幂等响应可复现。
        submission = await upsert_submission(
            db=db,
            task=task,
            user_id=current_user.id,
            code_submitted=data.code_submitted,
            started_at=started_at,
            submitted_at=event.created_at,
            is_completed=True,
        )
        await db.commit()
    except IdempotencyKeyReuseError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail={
                "code": "IDEMPOTENCY_KEY_REUSED",
                "message": str(exc),
            },
        ) from exc
    except Exception:
        await db.rollback()
        raise

    return SuccessResponse(
        data=FinalSubmitResponse(
            event_id=str(event.id),
            stage=event.stage.value,
            blueprint_version_id=(
                str(event.blueprint_version_id) if event.blueprint_version_id else None
            ),
            artifacts=artifact_results,
            completed=submission.is_completed,
            submitted_at=(
                submission.submitted_at.isoformat()
                if submission.submitted_at is not None
                else None
            ),
            replayed=not created,
        )
    )


@router.post("/tasks/{task_id}/save-workspace")
async def save_workspace(
    task_id: str,
    data: SaveWorkspaceRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SuccessResponse[dict]:
    """保存观察卡、功能卡、关系路径和模块进度（账号级 upsert）。"""
    tid = parse_task_uuid(task_id)

    # 防止异常客户端提交超大 JSON；正常完整贪吃蛇蓝图约数十 KB。
    if len(json.dumps(data.workspace_data, ensure_ascii=False)) > 262_144:
        raise HTTPException(status_code=413, detail="Workspace data too large")

    task = await get_visible_task(db, current_user, tid, require_active=True)

    await upsert_submission(
        db=db,
        task=task,
        user_id=current_user.id,
        workspace_data=data.workspace_data,
    )

    await db.commit()
    return SuccessResponse(data={"saved": True})


@router.post("/tasks/{task_id}/save-progress")
async def save_progress(
    task_id: str,
    data: SaveProgressRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SuccessResponse[dict]:
    """自动保存学生当前代码进度（upsert）"""
    tid = parse_task_uuid(task_id)
    task = await get_visible_task(db, current_user, tid, require_active=True)

    started = _parse_client_timestamp(data.started_at)

    await upsert_submission(
        db=db,
        task=task,
        user_id=current_user.id,
        code_submitted=data.code_submitted,
        started_at=started,
    )

    await db.commit()
    return SuccessResponse(data={"saved": True})


@router.post("/tasks/{task_id}/complete")
async def complete_task(
    task_id: str,
    data: CompleteTaskRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SuccessResponse[dict]:
    """标记任务完成并保存最终代码"""
    tid = parse_task_uuid(task_id)
    task = await get_visible_task(db, current_user, tid, require_active=True)

    await upsert_submission(
        db=db,
        task=task,
        user_id=current_user.id,
        code_submitted=data.code_submitted,
        started_at=_parse_client_timestamp(data.started_at),
        submitted_at=datetime.now(timezone.utc),
        is_completed=True,
    )

    await db.commit()
    return SuccessResponse(data={"completed": True})


@router.post("/tasks/{task_id}/reopen")
async def reopen_task(
    task_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SuccessResponse[dict]:
    """撤回完成状态，允许学生重新编辑并再次提交"""
    tid = parse_task_uuid(task_id)
    # 此前这里没有任何任务可见性校验，学生可用其他实验组的任务 ID 调用。
    # 虽然 submission 查询本身带 user_id 因此改不到别人的记录，
    # 但缺少校验会让「哪些任务 ID 存在提交记录」成为可探测信息。
    await get_visible_task(db, current_user, tid, require_active=True)

    result = await db.execute(
        select(ResearchTaskSubmission)
        .where(
            ResearchTaskSubmission.task_id == tid,
            ResearchTaskSubmission.user_id == current_user.id,
        )
    )
    submission = result.scalar_one_or_none()
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")

    submission.is_completed = False
    submission.submitted_at = None
    submission.started_at = None   # 重置计时，下次保存时重新记录
    submission.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return SuccessResponse(data={"reopened": True})
