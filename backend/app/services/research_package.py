"""Bounded, consistent SQL research exports; never include credentials/config secrets."""
import asyncio
import csv
from datetime import date, datetime, timezone
from enum import Enum
import hashlib
import io
import json
from pathlib import Path
import tempfile
import uuid
import zipfile

from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import sql as models
from app.db.neo4j import get_driver

# Explicit table allowlist: system_config (including model API keys) is NOT research data.
EXPORT_MODELS = (
    models.User, models.ResearchTask, models.ProjectBlueprintVersion,
    models.ResearchTaskSubmission, models.StageArtifact, models.ArtifactVersion,
    models.StageEvent, models.StageEventArtifact, models.ScaffoldEvent,
    models.ChatSession, models.ChatMessage, models.ProfileSnapshot,
    models.BehaviorLog, models.EmotionLog, models.CalibrationLog,
    models.ScaleTemplate, models.ScaleResponse, models.OnboardingSession, models.TeacherNote,
    models.AssessmentRound, models.AssessmentResponse,
    models.ClassroomSession, models.ClassroomPublication, models.ClassroomResponse, models.ClassroomControlEvent,
    models.LessonPlan, models.PreparationRecord,
    models.ClassroomMaterial, models.MaterialReceipt,
)
USER_FIELDS = {"id", "role", "class_name", "experiment_group", "is_active", "created_at", "last_active_at", "onboarding_mode", "has_completed_onboarding", "gender"}
MAX_BYTES = 128 * 1024 * 1024  # Uncompressed, including CSV + JSONL. Fail rather than truncate.
EXPORT_LOCK = 739204821
LEARNER_ROLES = ("learner", "student", "user")  # Earlier imports used student/user.


def json_default(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, Enum):
        return value.value
    if hasattr(value, "iso_format"):  # Neo4j temporal properties
        return value.iso_format()
    raise TypeError(f"Unsupported export type: {type(value).__name__}")


def json_text(value):
    return json.dumps(value, ensure_ascii=False, default=json_default, separators=(",", ":"))


def csv_cell(value):
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return json_text(value)
    if isinstance(value, (datetime, date, uuid.UUID, Enum)):
        value = json_default(value)
    # Only strings are escaped; real negative numeric scores remain numbers.
    if isinstance(value, str) and (value.lstrip().startswith(("=", "+", "-", "@")) or value.startswith(("\t", "\r", "\n"))):
        return "'" + value
    return value


def export_queries(class_name=None, group=None, include_identity=False):
    students = select(models.User.id).where(models.User.role.in_(LEARNER_ROLES))
    if class_name is not None:
        students = students.where(models.User.class_name == class_name)
    if group is not None:
        students = students.where(models.User.experiment_group == group)
    artifact_ids = select(models.StageArtifact.id).where(models.StageArtifact.user_id.in_(students))
    event_ids = select(models.StageEvent.id).where(models.StageEvent.user_id.in_(students))
    classroom_ids = select(models.ClassroomSession.id)
    if class_name is not None:
        classroom_ids = classroom_ids.where(models.ClassroomSession.class_name == class_name)
    if group is not None:
        classroom_ids = classroom_ids.where(models.ClassroomSession.class_name.in_(
            select(models.User.class_name).where(models.User.id.in_(students))))
    # A moved student still needs the original question/session behind each answer.
    answered_sessions = select(models.ClassroomPublication.session_id).join(
        models.ClassroomResponse, models.ClassroomResponse.publication_id == models.ClassroomPublication.id,
    ).where(models.ClassroomResponse.user_id.in_(students))
    preparation_sessions = select(models.PreparationRecord.session_id).where(
        models.PreparationRecord.user_id.in_(students), models.PreparationRecord.session_id.is_not(None),
    )
    # Compare text IDs instead of casting historical JSON values to UUID.
    from sqlalchemy import String, cast
    lesson_messages = select(models.ChatMessage.analysis["lesson"]["session_id"].astext).where(
        models.ChatMessage.user_id.in_(students),
    )
    lesson_events = select(models.StageEvent.detail["lesson"]["session_id"].astext).where(
        models.StageEvent.user_id.in_(students),
    )
    evidence_sessions = select(models.ClassroomSession.id).where(
        cast(models.ClassroomSession.id, String).in_(lesson_messages.union(lesson_events)),
    )
    material_sessions = select(models.ClassroomMaterial.session_id).join(models.MaterialReceipt).where(models.MaterialReceipt.user_id.in_(students))
    classroom_ids = classroom_ids.union(answered_sessions, preparation_sessions, evidence_sessions, material_sessions)
    for model in EXPORT_MODELS:
        table = model.__table__
        columns = list(table.columns)
        if model in (models.ClassroomMaterial, models.MaterialReceipt):
            columns = [c for c in columns if c.name != 'content']
        if model is models.User:
            allowed = USER_FIELDS | ({"name", "student_id", "email"} if include_identity else set())
            columns = [c for c in columns if c.name in allowed]
        elif model is models.TeacherNote and not include_identity:
            columns = [c for c in columns if c.name != "teacher_name"]
        query = select(*columns)
        if model is models.User:
            # Preserve author keys for notes and classroom controls in filtered packages.
            teachers = select(models.TeacherNote.teacher_id).where(models.TeacherNote.student_id.in_(students))
            teachers = teachers.union(
                select(models.ClassroomSession.created_by).where(models.ClassroomSession.id.in_(classroom_ids)),
                select(models.ClassroomPublication.created_by).where(models.ClassroomPublication.session_id.in_(classroom_ids)),
                select(models.ClassroomControlEvent.teacher_id).where(models.ClassroomControlEvent.session_id.in_(classroom_ids)),
            )
            query = query.where(table.c.id.in_(students) | table.c.id.in_(teachers))
        elif "user_id" in table.c:
            query = query.where(table.c.user_id.in_(students))
        elif model is models.TeacherNote:
            query = query.where(table.c.student_id.in_(students))
        elif model is models.ArtifactVersion:
            query = query.where(table.c.artifact_id.in_(artifact_ids))
        elif model is models.StageEventArtifact:
            query = query.where(table.c.event_id.in_(event_ids))
        elif model is models.ClassroomSession:
            query = query.where(table.c.id.in_(classroom_ids))
        elif model in (models.ClassroomPublication, models.ClassroomControlEvent, models.LessonPlan, models.ClassroomMaterial):
            query = query.where(table.c.session_id.in_(classroom_ids))
        # Task/blueprint/scale catalogs stay complete to preserve foreign-key interpretation.
        query = query.order_by(*table.primary_key.columns)
        yield table.name, columns, query


def encode_batch(rows, fields, raw, csv_file):
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer)
    for row in rows:
        raw.write((json_text(dict(row)) + "\n").encode("utf-8"))
        writer.writerow([csv_cell(row[field]) for field in fields])
    csv_file.write(buffer.getvalue().encode("utf-8"))


def add_file(archive, name, source):
    source.seek(0)
    digest = hashlib.sha256()
    size = 0
    with archive.open(name, "w", force_zip64=True) as target:
        while chunk := source.read(64 * 1024):
            digest.update(chunk)
            size += len(chunk)
            target.write(chunk)
    return {"path": name, "sha256": digest.hexdigest(), "bytes": size}


async def graph_batches(student_ids):
    """Raw learner interactions + concept properties + shared concept edges; no display caps."""
    query = """
    UNWIND $ids AS uid
    MATCH (s:Student {id: uid})-[r:INTERACTED_WITH]->(c:Concept)
    RETURN uid AS user_id, 'interaction' AS kind,
           {concept: properties(c), relationship: properties(r)} AS data
    UNION ALL
    UNWIND $ids AS uid
    MATCH (s:Student {id: uid})-[:INTERACTED_WITH]->(a:Concept)
    MATCH (s)-[:INTERACTED_WITH]->(b:Concept)
    MATCH (a)-[r]->(b)
    WHERE type(r) IN ['CO_OCCURRED_WITH', 'REL', 'PREREQUISITE_OF']
    RETURN DISTINCT uid AS user_id, 'shared_concept_edge' AS kind,
           {source: a.uid, target: b.uid, type: type(r), properties: properties(r)} AS data
    """
    async with get_driver().session(default_access_mode="READ", fetch_size=200) as session:
        async with await session.begin_transaction(timeout=20) as transaction:
            result = await transaction.run(query, ids=student_ids)
            batch = []
            async for record in result:
                batch.append(dict(record))
                if len(batch) == 200:
                    yield batch
                    batch = []
            if batch:
                yield batch


async def offload(function, *args):
    # A timeout must not close temporary files while a writer thread still uses them.
    task = asyncio.create_task(asyncio.to_thread(function, *args))
    try:
        return await asyncio.shield(task)
    except asyncio.CancelledError:
        await task
        raise


async def build_package(db: AsyncSession, *, class_name=None, group=None, include_identity=False, include_graph=True):
    output = tempfile.TemporaryFile()
    manifest = {
        "schema_version": "cognisync-research-package/1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "filters": {"class_name": class_name, "experiment_group": group},
        "include_identity": include_identity,
        "graph": {"included": include_graph, "consistency": "separate Neo4j read transaction; not atomic with SQL"},
        "consistency": "PostgreSQL REPEATABLE READ / READ ONLY",
        "files": [], "tables": {},
        "limitations": [
            "学生筛选依据当前班级/分组；teacher_notes 与 classroom_responses 保留当时的快照。历史改组无法由当前 users 反推。",
            "任务、蓝图和量表目录完整保留，包含教师专用材料，不得分发给学生。",
            "默认移除结构化姓名、学号、邮箱；对话、代码、备注自由文本仍可能含身份信息。不是匿名数据。",
            "画像及情感分析是系统推断，不是已验证的能力测评。adopted=null 表示未知。",
            "本地 Pi 日志仅包含学生已上传的作品包，不保证完整或不可修改；不会收集电脑其他文件。Neo4j 是当前快照。",
            "图谱 shared_concept_edge 是共享概念关系，不是这位学生独立生成关系的证据。",
            "时间为原始 ISO 时间；事件间隔包含离开页面时间，不等于有效学习时长。",
            "量表目录是当前保存的模板；旧答卷没有模板快照时不能重建其当时题本。",
            "classroom_publications.question 是发布时冻结的题目；每次发布单独计次，回答中的 null 不代表零分。发布不等于学生已读。",
        ],
    }
    total_bytes = 0
    student_ids = []
    try:
        async with asyncio.timeout(90):
            # A separate read-only transaction: authentication may already have used db.
            async with AsyncSession(bind=db.bind) as snapshot:
                await snapshot.connection(execution_options={"isolation_level": "REPEATABLE READ"})
                await snapshot.execute(text("SET TRANSACTION READ ONLY"))
                await snapshot.execute(text("SET LOCAL statement_timeout = '15s'"))
                if not await snapshot.scalar(text("SELECT pg_try_advisory_xact_lock(:key)"), {"key": EXPORT_LOCK}):
                    raise HTTPException(429, "已有研究包正在生成，请稍后重试", headers={"Retry-After": "30"})
                with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=1) as archive:
                    for name, columns, query in export_queries(class_name, group, include_identity):
                        fields = [column.name for column in columns]
                        count = 0
                        with tempfile.TemporaryFile() as raw, tempfile.TemporaryFile() as csv_file:
                            csv_file.write(b"\xef\xbb\xbf" + (",".join(fields) + "\r\n").encode())
                            result = await snapshot.stream(query.execution_options(yield_per=200))
                            try:
                                async for batch in result.mappings().partitions(200):
                                    if name == "users":
                                        student_ids.extend(str(row["id"]) for row in batch if row["role"] in LEARNER_ROLES)
                                    await offload(encode_batch, batch, fields, raw, csv_file)
                                    count += len(batch)
                                    if total_bytes + raw.tell() + csv_file.tell() > MAX_BYTES:
                                        raise HTTPException(413, "研究包超过 128 MiB，请按班级或实验组分别导出")
                            finally:
                                await result.close()
                            total_bytes += raw.tell() + csv_file.tell()
                            for extension, source in (("jsonl", raw), ("csv", csv_file)):
                                manifest["files"].append(await offload(add_file, archive, f"{name}.{extension}", source))
                        manifest["tables"][name] = {"rows": count, "columns": [{
                            "name": c.name, "type": str(c.type), "description": c.comment,
                            "references": sorted(f.target_fullname for f in c.foreign_keys),
                        } for c in columns]}
                    # Private originals are separate entries, not base64 fields in every CSV row.
                    for name, _columns, query in export_queries(class_name, group, include_identity):
                        model = {'classroom_materials': models.ClassroomMaterial, 'classroom_material_receipts': models.MaterialReceipt}.get(name)
                        if model is None:
                            continue
                        selected = query.subquery()
                        result = await snapshot.stream(select(model.id, model.content).where(model.id.in_(select(selected.c.id)), model.content.is_not(None)).execution_options(yield_per=1))
                        try:
                            async for record in result:
                                total_bytes += len(record.content)
                                if total_bytes > MAX_BYTES:
                                    raise HTTPException(413, '包含作品的研究包超过 128 MiB，请分班导出或在课次页逐份下载')
                                with io.BytesIO(record.content) as source:
                                    manifest['files'].append(await offload(add_file, archive, f'originals/{name}/{record.id}.bin', source))
                        finally:
                            await result.close()
                    if include_graph:
                        count = 0
                        with tempfile.TemporaryFile() as raw, tempfile.TemporaryFile() as csv_file:
                            fields = ["user_id", "kind", "data"]
                            csv_file.write(b"\xef\xbb\xbfuser_id,kind,data\r\n")
                            try:
                                if student_ids:
                                    async for batch in graph_batches(student_ids):
                                        await offload(encode_batch, batch, fields, raw, csv_file)
                                        count += len(batch)
                                        if total_bytes + raw.tell() + csv_file.tell() > MAX_BYTES:
                                            raise HTTPException(413, "图谱研究包超过上限，请按班级分别导出")
                            except HTTPException:
                                raise
                            except Exception as error:
                                raise HTTPException(503, "图谱读取失败，未生成不完整包。请稍后重试，或明确取消包含图谱后导出 SQL 证据") from error
                            for extension, source in (("jsonl", raw), ("csv", csv_file)):
                                manifest["files"].append(await offload(add_file, archive, f"knowledge_graph.{extension}", source))
                            manifest["graph"]["rows"] = count
                    curriculum = Path(__file__).resolve().parents[1] / "resources/curriculum/hsd_data_computing.json"
                    with curriculum.open("rb") as source:
                        manifest["files"].append(await offload(add_file, archive, "resources/textbook.json", source))
                    archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
                    archive.writestr("README.txt", PACKAGE_README)
        output.seek(0)
        return output
    except BaseException:
        output.close()
        raise


PACKAGE_README = """CogniSync 教师研究包（不是数据库备份，也不是匿名公开数据）
先读 manifest.json：筛选条件、各表行数、字段/外键、文件 SHA-256 与已知缺口。
JSONL 是完整原始值（保留 null 与嵌套结构）；CSV 供表格软件使用，UTF-8 BOM。
CSV 文本以 = + - @ 等字符开头时加单引号，防止公式执行；还原原文请读 JSONL。
users.id 是研究关联主键；teacher_notes.student_id 也是 users.id，而非登录学号。
stage_event_artifacts 连接事件与产物版本，一次事件可能关联多个版本；按事件 id 去重计数。
研究任务提交中的 workspace_data 是最后保存状态；artifact_versions 是已采集的版本证据。
scaffold_events 关联提问、回答和事件；不能仅凭 AI 生成内容断言学生采用或理解。
所有时间保留原始时区。空表仍有 CSV 表头，JSONL 为空；缺失不补零、不代造。
默认不导出姓名/学号/邮箱，但自由文本仍需人工脱敏。教师蓝图/测试答案须保密。
问卷是自陈资料，画像是模型推断；都不能直接充当复杂问题解决能力的客观分数。
本包不导出密码、令牌、API 密钥、系统配置。图谱是否包含见 manifest.graph。
knowledge_graph 为当前原始快照（无页面 50 条上限/频次压缩），不是历史图谱；共享概念边不能归因为单个学生行为。
"""
