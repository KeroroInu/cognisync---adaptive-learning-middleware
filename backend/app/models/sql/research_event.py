"""
Research Process Models - 阶段产物版本与关键教学事件

设计要点（对应 docs/PROJECT_WORKBENCH_V02.md「后端数据最小模型」）：

- ``research_task_submissions.workspace_data`` 仍然是**最新工作区快照**，只负责
  跨设备恢复，不做整份版本化；本模块负责正式实验所需的、不可覆盖的证据链。
- ``StageArtifact`` 保存单个学习产物的**稳定身份**（任务、学生、阶段、产物类型、
  产物键）与当前版本指针；``ArtifactVersion`` 以**追加方式**保存每次修订的完整
  JSONB 快照。修改差异在查询或导出时计算，不把增量 diff 作为唯一数据源。
- 版本只在阶段确认和有意义的结构修改时生成。连续拖拽坐标、逐字输入和游戏运行帧
  一律不记录。
- ``StageEvent`` 与 ``ScaffoldEvent`` 独立建表，不混入 ``ArtifactVersion``。

两条贯穿全表的约束：

1. **枚举以 value 入库**。SQLAlchemy 的 ``Enum`` 默认持久化 Python 成员名
   （``STAGE_CONFIRM``），与 API 契约和 CSV 导出约定的小写 ``stage_confirm`` 不一致。
   因此所有枚举统一通过 :func:`_enum` 声明 ``values_callable``。
2. **研究证据不随管理操作物理消失**。指向 ``users`` / ``research_tasks`` 的外键一律
   ``RESTRICT``：存在证据链时禁止物理删除主体，需先归档或匿名化。
   仅 ``artifact_versions -> stage_artifacts`` 保留 ``CASCADE``，因为其父行本身
   已被 ``RESTRICT`` 保护，不会被管理端直接删除。
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import (
    Boolean,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.sql.base import Base, UUIDMixin


__all__ = [
    "ArtifactChangeSource",
    "ArtifactType",
    "ArtifactVersion",
    "ProjectStage",
    "ScaffoldDeliveryStatus",
    "ScaffoldEvent",
    "StageArtifact",
    "StageEvent",
    "StageEventArtifact",
    "StageEventType",
]


def _enum(enum_cls: type[enum.Enum], name: str) -> Enum:
    """声明以 ``.value`` 持久化的字符串枚举列。

    默认的 ``Enum(SomeEnum, native_enum=False)`` 会把成员名写进数据库
    （``STAGE_CONFIRM``），导致数据库取值、API 契约和 CSV 导出三者不一致。
    ``values_callable`` 让 CHECK 约束与存储值都使用 ``.value``。
    """
    return Enum(
        enum_cls,
        name=name,
        native_enum=False,
        values_callable=lambda cls: [item.value for item in cls],
        validate_strings=True,
    )


class ProjectStage(str, enum.Enum):
    """项目解构式学习的阶段标识。

    与 ``ProjectScaffoldContext.stage`` 保持一致，额外增加 ``reflect``
    以容纳迁移反思阶段（教师蓝图 L0–L3 策略已包含该阶段）。
    """

    OBSERVE = "observe"
    DECOMPOSE = "decompose"
    MODEL = "model"
    PLAN = "plan"
    BUILD = "build"
    REFLECT = "reflect"


class ArtifactType(str, enum.Enum):
    """可版本化的学习产物类型。

    粒度对应学生在界面上能够单独修改的对象，而不是整份工作区。
    """

    OBSERVATION = "observation"            # 观察卡
    FUNCTION_CARD = "function_card"        # 功能卡
    FUNCTION_MAPPING = "function_mapping"  # 学生确认的契约映射
    MECHANISM = "mechanism"                # 单功能内部流程图
    PATH = "path"                          # 系统关系与实现路径
    MODULE_CODE = "module_code"            # 单个建构单元的代码
    REVISION_NOTE = "revision_note"        # 学生的关键修订说明


class ArtifactChangeSource(str, enum.Enum):
    """版本产生的来源，用于区分自主修改与支架/测试驱动的修改。"""

    STAGE_CONFIRM = "stage_confirm"          # 学生确认阶段产物
    STRUCTURE_EDIT = "structure_edit"        # 有意义的结构修改
    TEST_REVISION = "test_revision"          # 因模块测试失败而返回修改
    SCAFFOLD_FOLLOWUP = "scaffold_followup"  # 求助之后的修改
    IMPORT = "import"                        # 演示数据或历史快照回填


class StageEventType(str, enum.Enum):
    """有教学意义的关键时刻。

    刻意不包含拖拽、滚动、逐字输入和游戏帧——这些不构成研究证据，
    且会在 40–50 人课堂并发下形成无意义的写入压力。
    """

    STAGE_CONFIRM = "stage_confirm"        # 阶段确认
    STRUCTURE_CHANGE = "structure_change"  # 结构修改完成
    MODULE_TEST = "module_test"            # 模块测试
    HELP_REQUEST = "help_request"          # 主动求助
    FINAL_SUBMIT = "final_submit"          # 最终提交


class ScaffoldDeliveryStatus(str, enum.Enum):
    """支架建议是否真正送达学生。

    ``ScaffoldEvent`` 只在助手回复成功保存后写入，因此正常路径恒为
    ``delivered``；``failed`` 预留给未来需要显式记录送达失败的场景。
    「学生发起了求助」本身由 ``StageEvent(help_request)`` 承担，
    两者语义不同，不可互相替代。
    """

    DELIVERED = "delivered"
    FAILED = "failed"


class StageArtifact(Base, UUIDMixin):
    """单个学习产物的稳定身份与当前版本指针。"""

    __tablename__ = "stage_artifacts"
    __table_args__ = (
        UniqueConstraint(
            "task_id",
            "user_id",
            "artifact_type",
            "artifact_key",
            name="uq_stage_artifact_identity",
        ),
        Index("ix_stage_artifacts_user_task", "user_id", "task_id"),
        Index("ix_stage_artifacts_task_stage", "task_id", "stage"),
        {"comment": "学习产物稳定身份表"},
    )

    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        # RESTRICT：存在研究证据时不允许物理删除任务，避免一次管理操作
        # 清空整条不可覆盖的证据链。
        ForeignKey("research_tasks.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
        comment="所属研究任务",
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
        comment="所属学生",
    )

    stage: Mapped[ProjectStage] = mapped_column(
        _enum(ProjectStage, "project_stage"),
        nullable=False,
        comment="产物所属阶段",
    )

    artifact_type: Mapped[ArtifactType] = mapped_column(
        _enum(ArtifactType, "artifact_type"),
        nullable=False,
        comment="产物类型",
    )

    artifact_key: Mapped[str] = mapped_column(
        String(120),
        nullable=False,
        comment="学生端稳定标识，例如功能卡 ID 或建构单元键",
    )

    current_version_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "artifact_versions.id",
            ondelete="SET NULL",
            use_alter=True,
            name="fk_stage_artifact_current_version",
        ),
        nullable=True,
        comment="当前版本指针",
    )

    current_version: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        comment="当前版本号；0 表示尚未产生版本",
    )

    blueprint_version_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("project_blueprint_versions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        comment="产物创建时学生所冻结的教师蓝图版本",
    )

    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    versions: Mapped[list["ArtifactVersion"]] = relationship(
        "ArtifactVersion",
        back_populates="artifact",
        cascade="all, delete-orphan",
        foreign_keys="ArtifactVersion.artifact_id",
        order_by="ArtifactVersion.version",
        lazy="raise",
    )

    def __repr__(self) -> str:
        return (
            f"<StageArtifact(type={self.artifact_type}, key={self.artifact_key}, "
            f"version={self.current_version})>"
        )


class ArtifactVersion(Base, UUIDMixin):
    """产物的一次修订；仅追加，不可原地覆盖。"""

    __tablename__ = "artifact_versions"
    __table_args__ = (
        UniqueConstraint("artifact_id", "version", name="uq_artifact_version_seq"),
        Index("ix_artifact_versions_artifact_created", "artifact_id", "created_at"),
        {"comment": "学习产物版本表（追加式）"},
    )

    artifact_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        # 父行 stage_artifacts 已由 RESTRICT 保护，不会被管理端直接删除，
        # 因此这里保留 CASCADE 以维持「产物与其版本共存亡」的一致性。
        ForeignKey("stage_artifacts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="所属产物",
    )

    version: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment="产物内递增版本号，从 1 开始",
    )

    content: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        comment="该产物当时的完整快照；差异在查询/导出时计算",
    )

    content_hash: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        comment="规范化 JSON 的 SHA-256，用于判定是否发生实质变化",
    )

    previous_version_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("artifact_versions.id", ondelete="SET NULL"),
        nullable=True,
        comment="上一版本，形成修订链",
    )

    change_source: Mapped[ArtifactChangeSource] = mapped_column(
        _enum(ArtifactChangeSource, "artifact_change_source"),
        nullable=False,
        comment="修改来源",
    )

    change_reason: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="学生或系统给出的修改原因",
    )

    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )

    artifact: Mapped[StageArtifact] = relationship(
        "StageArtifact",
        back_populates="versions",
        foreign_keys=[artifact_id],
        lazy="raise",
    )

    def __repr__(self) -> str:
        return f"<ArtifactVersion(artifact_id={self.artifact_id}, version={self.version})>"


class StageEvent(Base, UUIDMixin):
    """阶段确认、结构修改、模块测试、求助与提交等关键时刻。

    幂等：``(user_id, request_id)`` 唯一。``request_id`` 由前端生成并在网络重试中
    保持稳定，因此浏览器重试、反向代理重发或学生重复点击不会把同一个关键时刻
    重复计入「阶段确认数 / 求助数 / 模块测试次数」。
    """

    __tablename__ = "stage_events"
    __table_args__ = (
        UniqueConstraint("user_id", "request_id", name="uq_stage_event_request"),
        Index("ix_stage_events_user_task_created", "user_id", "task_id", "created_at"),
        Index("ix_stage_events_task_type_created", "task_id", "event_type", "created_at"),
        {"comment": "关键教学事件表"},
    )

    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("research_tasks.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    request_id: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        comment="客户端生成、重试中保持稳定的请求 ID；与 user_id 构成幂等键",
    )

    request_fingerprint: Mapped[Optional[str]] = mapped_column(
        String(64),
        nullable=True,
        comment=(
            "请求语义指纹（sha256）。仅有唯一键不足以保证幂等正确："
            "前端若错误复用 request_id 提交了不同内容，只按键去重会静默丢弃新数据、"
            "并把另一个任务的旧事件当作本次结果返回。指纹不一致时接口返回 409。"
        ),
    )

    stage: Mapped[ProjectStage] = mapped_column(
        _enum(ProjectStage, "project_stage"),
        nullable=False,
    )

    event_type: Mapped[StageEventType] = mapped_column(
        _enum(StageEventType, "stage_event_type"),
        nullable=False,
    )

    blueprint_version_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("project_blueprint_versions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        comment="事件发生时学生冻结的教师蓝图版本",
    )

    detail: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        comment="事件的最小结构化载荷；不保存连续坐标或游戏帧",
    )

    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )

    artifact_links: Mapped[list["StageEventArtifact"]] = relationship(
        "StageEventArtifact",
        back_populates="event",
        cascade="all, delete-orphan",
        order_by="StageEventArtifact.position",
        lazy="raise",
    )

    def __repr__(self) -> str:
        return f"<StageEvent(type={self.event_type}, stage={self.stage})>"


class StageEventArtifact(Base, UUIDMixin):
    """事件与产物版本的多对多关联。

    一次阶段确认往往同时涉及功能卡、关系图和路径等多个产物。若事件只记录
    第一个产物，其余关联会被静默丢失，导出时无法完整追溯该关键时刻。
    """

    __tablename__ = "stage_event_artifacts"
    __table_args__ = (
        UniqueConstraint("event_id", "artifact_id", name="uq_stage_event_artifact"),
        Index("ix_stage_event_artifacts_artifact", "artifact_id"),
        {"comment": "关键事件与产物版本的关联表"},
    )

    event_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("stage_events.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    artifact_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("stage_artifacts.id", ondelete="RESTRICT"),
        nullable=False,
    )

    artifact_version_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("artifact_versions.id", ondelete="SET NULL"),
        nullable=True,
        comment="事件发生时该产物的版本",
    )

    version_created: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        comment="本次事件是否真的产生了新版本；False 表示内容无实质变化",
    )

    position: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        comment="上报顺序，保证导出稳定",
    )

    event: Mapped[StageEvent] = relationship(
        "StageEvent",
        back_populates="artifact_links",
        lazy="raise",
    )

    def __repr__(self) -> str:
        return f"<StageEventArtifact(event={self.event_id}, artifact={self.artifact_id})>"


class ScaffoldEvent(Base, UUIDMixin):
    """一次 **成功送达** 的 L0–L3 支架交互。

    语义边界（重要）：

    - 「学生发起求助」由 ``StageEvent(help_request)`` 记录，在请求进入时写入；
    - 本表只在**助手回复成功保存之后**写入，与助手消息同一事务提交。
      因此不会出现「事件表显示已给出 L3 支架，学生却什么都没收到」的假记录。

    当前与 ``chat_messages.analysis.scaffoldContext`` 双写：本表作为后续研究分析
    的规范数据源，旧 JSONB 保留以兼容既有页面与导出。等后续建立
    「求助—建议—修改—结果」关联后，再把新版导出切换到本表。

    注意：最新裁定不让学生额外填写采用理由；``adopted`` 默认保持 NULL，
    后续研究分析依据建议、代码版本和测试结果推断，不把“未判定”误写为 False。
    """

    __tablename__ = "scaffold_events"
    __table_args__ = (
        UniqueConstraint("user_id", "request_id", name="uq_scaffold_event_request"),
        Index("ix_scaffold_events_user_task_created", "user_id", "task_id", "created_at"),
        Index("ix_scaffold_events_stage_level", "stage", "applied_level"),
        {"comment": "L0-L3 支架事件表"},
    )

    task_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("research_tasks.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
        comment="研究任务；历史对话可能没有合法任务 ID",
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    request_id: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        comment="客户端一次支架交互的请求 ID，用于幂等与前后端对齐",
    )

    student_message_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("chat_messages.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
        comment=(
            "触发本次支架的学生消息。RESTRICT 而非 SET NULL："
            "导出的「学生提问原文」依赖这条关联，SET NULL 会让删除会话时"
            "静默切断原文链路，事件行还在但只剩等级与元数据。"
            "应用层的 409 检查是「先查再删」，存在竞态且可被其他删除路径绕过，"
            "因此保护必须落在数据库约束上。"
        ),
    )

    assistant_message_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("chat_messages.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
        comment="实际送达学生的助手消息；同样为 RESTRICT，理由见 student_message_id",
    )

    delivery_status: Mapped[ScaffoldDeliveryStatus] = mapped_column(
        _enum(ScaffoldDeliveryStatus, "scaffold_delivery_status"),
        nullable=False,
        default=ScaffoldDeliveryStatus.DELIVERED,
        comment="建议是否真正送达；本表只在送达后写入",
    )

    stage: Mapped[ProjectStage] = mapped_column(
        _enum(ProjectStage, "project_stage"),
        nullable=False,
    )

    trigger: Mapped[str] = mapped_column(
        String(40),
        nullable=False,
        comment="hint_button | student_message | level_up | minimum_completion | l3_confirmed",
    )

    requested_level: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment="学生请求的支架等级 L0-L3",
    )

    applied_level: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment="教师策略实际允许的等级",
    )

    was_clamped: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        comment="请求等级是否被教师策略下调",
    )

    policy_source: Mapped[str] = mapped_column(
        String(40),
        nullable=False,
        default="platform_default",
        comment="teacher_blueprint | platform_default | platform_latest",
    )

    policy_max_code_lines: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        comment="本轮允许补全的最大代码行数；0 表示不允许生成代码",
    )

    blueprint_version_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("project_blueprint_versions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    current_module: Mapped[Optional[str]] = mapped_column(
        String(300),
        nullable=True,
        comment="建构阶段正在实现的模块",
    )

    profile_cognition: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    profile_affect: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    profile_behavior: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    code_length: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        comment="求助时学生代码长度；只保存长度与指纹，不重复保存完整代码",
    )

    code_fingerprint: Mapped[Optional[str]] = mapped_column(
        String(32),
        nullable=True,
        comment="学生代码 SHA-256 前 16 位",
    )

    adopted: Mapped[Optional[bool]] = mapped_column(
        Boolean,
        nullable=True,
        comment="学生是否采用了建议；不新增学生表单，NULL 表示尚未判定",
    )

    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )

    def __repr__(self) -> str:
        return (
            f"<ScaffoldEvent(stage={self.stage}, "
            f"L{self.requested_level}->L{self.applied_level})>"
        )
