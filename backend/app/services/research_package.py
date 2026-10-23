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
from app.services.process_evidence import INDEX_FIELDS, process_index
from app.services.sfls_evidence import FIELDS as SFLS_FIELDS, write_index
from app.services.worksheet import EXPORT_FIELDS as WORKSHEET_FIELDS, export_row as worksheet_row
from app.services.assessment_analysis import FIELDS as ASSESSMENT_FIELDS, item_rows, ANALYSIS_GUIDE
from app.services.sfls_task_access import public_receipt_detail

# Explicit table allowlist: system_config (including model API keys) is NOT research data.
EXPORT_MODELS = (
    models.StudentAdvice,
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
    models.ClassroomQuestionSet,
    models.LearningSupportTurn, models.LearningPracticeReview,
    models.ProjectReviewRound, models.ProjectReviewResponse, models.ProjectReviewEvent,
)
USER_FIELDS = {"id", "role", "class_name", "school_class", "experiment_group", "is_active", "created_at", "last_active_at", "onboarding_mode", "has_completed_onboarding", "gender"}
MAX_BYTES = 128 * 1024 * 1024  # Uncompressed, including CSV + JSONL. Fail rather than truncate.
EXPORT_LOCK = 739204821
LEARNER_ROLES = ("learner", "student", "user")  # Earlier imports used student/user.

# Explicit descriptions for derived columns: these are not SQL columns and have no comments.
ANALYSIS_FIELD_DESCRIPTIONS = {
    'source_table': '原始来源表；与 source_id 一起回查，不能仅按 source_id 混表合并',
    'source_id': '原始记录 UUID；保留字符串', 'user_id': '学生 UUID，关联 users.id',
    'research_id': 'S- 加学生 UUID，不是完全匿名标识',
    'task_id': '来源中的任务编号；worksheets 指 classroom_materials.id，learning_process 须结合 source_table 回查',
    'session_id': '来源会话 ID；平台表可能是跨课班级工作区，SFLS 为客户端会话标识，不可混用',
    'at': '服务器保存的原始时间；按时区统一后排序，不代表持续学习时间',
    'kind': '原始事件/记录类型，不是能力等级', 'response_to': '明确记录的提问 ID；空值不按时间猜测',
    'stage': '记录时的学习环节', 'focus_id': '记录时聚焦的模块或功能标识',
    'reply_generation_ms': '服务器生成回答耗时，含排队；不是学生思考时间',
    'code_sha256': '记录所关联代码内容的 SHA-256', 'adopted': '是否采用；当前无独立证据时为空，不补 false',
    'mastery': '是否掌握；当前无独立证据时为空，不作为能力得分',
    'project_id': '跨课项目编号', 'lesson_id': '任务模板的课时编号，需与教师实际课表核对',
    'condition': '发放的教学条件编码，不等于从行为推断的学生类型',
    'template_version': '发布时任务单模板版本', 'template_hash': '发布时任务单模板内容哈希',
    'worksheet_revision_id': '本次任务单保存版本 ID', 'parent_revision_id': '上一任务单版本 ID',
    'plan_revision_id': '明确保存本轮计划时的版本 ID，不证明此前未开始编码',
    'revision': '任务单递增版本号', 'action': 'plan/progress/closing 等保存动作',
    'saved_at': '任务单保存时间', 'design_revision': '关联的网页设计版本号',
    'analysis_note': '学生填写的问题分析/结构描述', 'change_plan': '学生填写的修改计划',
    'sources': '学生自述帮助来源数组（self/peer/teacher/ai）',
    'advice_choice': '学生自述对建议的采用选择，不是自动认定采用', 'decision_note': '学生自述选择理由',
    'tests': '学生填写的测试用例、预期/实际/状态数组，不是服务器自动判题结果',
    'closing_note': '学生本轮总结', 'record_source': '学生声明任务单为自己填写或 AI 协助',
    'source': '证据来源及可信度说明，不是事实验证结果',
    'receipt_id': '服务器收件 UUID，关联 classroom_material_receipts.id；重复上传的同一事件可有不同收件 ID',
    'material_id': '教师发布任务 UUID，关联 classroom_materials.id',
    'received_at': '服务器接受上传的时间，不是事件发生时间', 'archive_path': '原 ZIP 内定位路径；original_files 中为空表示未嵌入原件',
    'line': '原日志中的行号，从 1 起；与 receipt_id/archive_path 一起定位',
    'role': '消息/运行输出的原始角色；program 不是学生回答', 'client_at': '客户端上报时间，未校验时钟',
    'text': '提取的可见正文/程序输出；原始结构仍在上传原件',
    'status': 'ok/invalid_json_line/archive_not_indexed；解析异常应回查原件，不能按缺记录处理',
    'task_validation_status': '上传时任务契约校验结果，不是程序功能成绩',
    'phase': '客户端报告的任务阶段', 'task_mode': '客户端报告的智能体任务模式',
    'policy_version': '客户端使用的支架策略版本', 'scaffold_revision': '客户端使用的支架修订号',
    'request_id': '客户端请求标识；不等于服务器上传幂等请求号', 'project_run_id': '作品运行标识',
    'exit_code': '作品进程退出码；0 不表示功能正确', 'verification': '原日志的验证范围声明',
    'run_id': '客户端本次智能体运行标识；与 sequence 联合识别事件',
    'sequence': '同一 run_id 内的事件序号；不能跨 run_id 合并',
    'elapsed_ms': '同一次运行的单调经过时间，不是有效学习时间',
    'duration_ms': '请求或程序运行耗时；含义见 duration_kind', 'duration_kind': '耗时对应的操作类型',
    'support_record_status': '支架记录是否存在；missing 不等于 L0',
    'support_level': 'AI 报告的支架等级，不是学生能力分', 'previous_support_level': 'AI 报告的上一支架等级',
    'topic': '本轮支架关注知识点/主题', 'reason': 'AI 报告的调整理由',
    'coverage': 'AI 报告的支架覆盖情况', 'evidence_quote': 'AI 引用的学生话语',
    'support_source': '支架信息来源说明', 'quote_verified': '引文是否匹配本轮输入，不代表理解正确',
    'reported_coverage': 'AI 最初报告的覆盖情况；保留用于与客户端规则修正结果 coverage 比较',
    'coverage_adjustment': '客户端对覆盖报告的规则修正原因；不是人工判断或能力分',
    'evidence_kind': 'AI 声明的解释/预测/理由选择/纠错等候选证据类型；仍须核验对话',
    'event_id': '原日志事件 ID；结合学生及日志来源去重，不能跨学生单独作为主键',
    'parent_id': '原日志父事件 ID', 'tool_call_id': '原日志工具调用关联 ID',
    'model': '原日志模型名', 'provider': '原日志模型服务商', 'sfls_version': '客户端 SFLS 版本',
    'pi_version': '客户端 Pi 版本', 'input_tokens': '模型报告的输入 token 数，缺值不补零',
    'output_tokens': '模型报告的输出 token 数，缺值不补零', 'total_tokens': '模型报告的总 token 数',
    'bytes': '服务器保存的原件字节数', 'sha256': '服务器保存原件的 SHA-256',
    'download_path': '原件教师认证下载接口；无值时查看原始材料表，不是公开链接',
}
DERIVED_FIELDS = {'learning_process': INDEX_FIELDS, 'worksheets': WORKSHEET_FIELDS,
                  'sfls_process': SFLS_FIELDS,
                  'original_files': ('source_table', 'source_id', 'archive_path', 'bytes', 'sha256', 'download_path')}
RAW_FIELD_DESCRIPTIONS = {
    'created_at': '服务器创建本记录的时间', 'updated_at': '本记录最后更新时间',
    'gender': '用户登记的性别编码', 'stage': '记录所属学习环节', 'event_type': '原始事件类型',
    'profile_cognition': '当时认知画像快照，系统推断而非客观能力测验',
    'profile_affect': '当时情感画像快照，系统推断', 'profile_behavior': '当时行为画像快照，系统推断',
    'group_snapshot': '保存记录时的教学组别', 'class_snapshot': '保存记录时的班级',
    'lesson_date': '教师备注指定的课堂日期', 'lesson_label': '教师备注指定的课时名称',
    'observation': '教师记录的观察事实', 'interpretation': '教师对观察的解释，须与事实区分',
    'next_step': '教师建议的后续行动', 'evidence': '教师引用的证据列表',
    'phase': '历史 pre/post 阶段标签，实际测量时点需结合发放安排',
    'class_name': '记录配置的教学班组；用户表中表示当前教学班组', 'school_class': '学生实际年级与班级（如高一（1）班），不自动推断实验组', 'name': '保存的名称',
    'title': '保存的标题', 'revision': '记录的版本号；跨发放或跨对象不能单独作为唯一键',
    'source': '保存的来源说明', 'questions': '题目及选项的完整 JSON 定义',
    'question': '本次课堂发布冻结的题目/投票定义', 'enabled': '当前是否开放',
    'published_at': '发布时刻，不代表学生已经阅读', 'answers': '原始回答对象，空值不补零',
    'answer': '单题/投票的原始回答，按 publication_id 关联冻结题目',
    'started_at': '系统记录的开始时间，不是有效学习时长',
    'is_current': '是否当前班级工作区', 'state': '历史课堂状态，当前不再作为学生访问开关',
    'closes_at': '历史预定关闭时间', 'closed_at': '实际关闭记录时间',
    'action': '原始操作类型', 'configuration': '完整配置 JSON；包含任务绑定/知识点等，按所属表解释',
    'request_id': '请求幂等标识；用于识别同次操作的重试', 'kind': '原始记录类型',
    'payload': '完整原始结构化载荷；不把其中模型自述视为已验证事实',
    'filename': '原文件名称', 'sha256': '文件内容 SHA-256', 'size': '文件字节数',
    'detail': '回执/事件附带的原始上下文、校验及绑定信息',
    'scope': '支持请求所属场景', 'template_id': '练习模板标识', 'content_hash': '被审核内容哈希',
    'approved': '教师审核是否批准', 'template': '发布时冻结的模板', 'template_hash': '冻结模板哈希',
    'session_ids': '关联班级工作区 ID 列表', 'status': '记录的业务状态，非能力等级',
    'results_published': '是否已公布结果', 'reviewed_at': '审核时间', 'ended_at': '结束时间',
    'ai_hold': '该测评响应的 AI 暂停状态', 'snapshot': '提交/测评上下文的冻结快照',
    'snapshot_hash': '冻结快照哈希', 'first_prediction': '学生首次预测的原始记录',
    'test_plan': '学生提交的测试计划', 'grade': '该条评测保存的评分对象，须结合模板/规则解释',
    'submitted_at': '提交时间',
}


def column_description(column):
    if column.comment:
        return column.comment
    references = sorted(f.target_fullname for f in column.foreign_keys)
    if references:
        return '关联 ' + '、'.join(references) + ' 的稳定 ID（字符串）'
    return RAW_FIELD_DESCRIPTIONS.get(column.name, '原始数据库字段；结合表定义和关联记录解释，不自动推算分数')


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
    support_sessions = select(models.LearningSupportTurn.session_id).where(models.LearningSupportTurn.user_id.in_(students))
    review_sessions = select(models.ProjectReviewResponse.session_id).where(models.ProjectReviewResponse.user_id.in_(students))
    classroom_ids = classroom_ids.union(answered_sessions, preparation_sessions, evidence_sessions, material_sessions, support_sessions, review_sessions)
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
                select(models.LearningPracticeReview.reviewed_by),
                select(models.ProjectReviewRound.created_by), select(models.ProjectReviewEvent.actor_id),
                select(models.ClassroomSession.created_by).where(models.ClassroomSession.id.in_(classroom_ids)),
                select(models.ClassroomPublication.created_by).where(models.ClassroomPublication.session_id.in_(classroom_ids)),
                select(models.ClassroomControlEvent.teacher_id).where(models.ClassroomControlEvent.session_id.in_(classroom_ids)),
                select(models.ClassroomQuestionSet.created_by),
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


async def build_package(db: AsyncSession, *, class_name=None, group=None, include_identity=False, include_graph=True, include_originals=True):
    output = tempfile.TemporaryFile()
    manifest = {
        "schema_version": "cognisync-research-package/1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "filters": {"class_name": class_name, "experiment_group": group},
        "include_identity": include_identity,
        "originals": {"included": include_originals, "records": 0, "bytes": 0,
            "limitation": "Original bytes omitted only when explicitly requested; SFLS indexes are still parsed from every stored upload. See original_files.csv/jsonl for hashes and authenticated download paths."},
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
                with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=1) as archive, tempfile.TemporaryFile() as process_raw, tempfile.TemporaryFile() as process_csv, tempfile.TemporaryFile() as sfls_raw, tempfile.TemporaryFile() as sfls_csv, tempfile.TemporaryFile() as worksheet_raw, tempfile.TemporaryFile() as worksheet_csv:
                    worksheet_csv.write(b'\xef\xbb\xbf' + (','.join(WORKSHEET_FIELDS) + '\r\n').encode())
                    worksheet_count = 0
                    sfls_csv.write(b'\xef\xbb\xbf' + (','.join(SFLS_FIELDS) + '\r\n').encode())
                    sfls_count = 0
                    total_bytes += sfls_csv.tell()
                    process_csv.write(b'\xef\xbb\xbf' + (','.join(INDEX_FIELDS) + '\r\n').encode())
                    process_count = 0
                    for name, columns, query in export_queries(class_name, group, include_identity):
                        fields = [column.name for column in columns]
                        count = 0
                        with tempfile.TemporaryFile() as raw, tempfile.TemporaryFile() as csv_file:
                            csv_file.write(b"\xef\xbb\xbf" + (",".join(fields) + "\r\n").encode())
                            result = await snapshot.stream(query.execution_options(yield_per=200))
                            try:
                                async for batch in result.mappings().partitions(200):
                                    if name == 'classroom_material_receipts':
                                        batch = [{**row, 'detail': public_receipt_detail(row['detail'])} for row in batch]
                                    if name == "users":
                                        student_ids.extend(str(row["id"]) for row in batch if row["role"] in LEARNER_ROLES)
                                    await offload(encode_batch, batch, fields, raw, csv_file)
                                    if name == 'preparation_records':
                                        worksheets = [value for row in batch if (value := worksheet_row(row)) is not None]
                                        await offload(encode_batch, worksheets, WORKSHEET_FIELDS, worksheet_raw, worksheet_csv)
                                        worksheet_count += len(worksheets)
                                    if name in ('chat_messages', 'stage_events', 'preparation_records', 'learning_support_turns'):
                                        index_batch = [item for row in batch if (item := process_index(name, row)) is not None]
                                        await offload(encode_batch, index_batch, INDEX_FIELDS, process_raw, process_csv)
                                        process_count += len(index_batch)
                                    count += len(batch)
                                    if total_bytes + raw.tell() + csv_file.tell() + process_raw.tell() + process_csv.tell() + worksheet_raw.tell() + worksheet_csv.tell() > MAX_BYTES:
                                        raise HTTPException(413, "研究包超过 128 MiB，请按班级或实验组分别导出")
                            finally:
                                await result.close()
                            total_bytes += raw.tell() + csv_file.tell()
                            for extension, source in (("jsonl", raw), ("csv", csv_file)):
                                manifest["files"].append(await offload(add_file, archive, f"{name}.{extension}", source))
                        manifest["tables"][name] = {"rows": count, "columns": [{
                            "name": c.name, "type": str(c.type), "description": column_description(c),
                            "references": sorted(f.target_fullname for f in c.foreign_keys),
                        } for c in columns]}
                    total_bytes += process_raw.tell() + process_csv.tell() + worksheet_raw.tell() + worksheet_csv.tell()
                    for extension, source in (('jsonl', worksheet_raw), ('csv', worksheet_csv)):
                        manifest['files'].append(await offload(add_file, archive, f'worksheets.{extension}', source))
                    manifest['worksheets'] = {'rows': worksheet_count, 'research_id': 'S- followed by users.id',
                        'limitation': 'Student reports, not independent thinking or automatic test results. A plan save timestamp does not prove implementation had not begun.'}
                    for extension, source in (("jsonl", process_raw), ("csv", process_csv)):
                        manifest['files'].append(await offload(add_file, archive, f'learning_process.{extension}', source))
                    manifest['learning_process'] = {'version': 'process-index/v1', 'rows': process_count,
                        'order': 'source table, then original query order; sort by at and source_id for chronology',
                        'limitation': 'Exact recorded reply links only. Null means unknown; chronology does not imply adoption, authorship or mastery.'}
                    # Analysis-ready item rows use the same snapshot and student filter as raw responses.
                    answer_query = next(query for name, _, query in export_queries(class_name, group, include_identity)
                                        if name == 'assessment_responses').subquery()
                    query = select(answer_query, models.AssessmentRound.name.label('round_name'),
                                   models.AssessmentRound.questions, models.AssessmentRound.revision,
                                   models.AssessmentRound.phase).join(
                        models.AssessmentRound, models.AssessmentRound.id == answer_query.c.round_id
                    ).order_by(answer_query.c.id)
                    with tempfile.TemporaryFile() as raw, tempfile.TemporaryFile() as csv_file:
                        fields = list(ASSESSMENT_FIELDS)
                        csv_file.write(b'\xef\xbb\xbf' + (','.join(fields) + '\r\n').encode())
                        count = 0
                        result = await snapshot.stream(query.execution_options(yield_per=25))
                        try:
                            async for batch in result.mappings().partitions(25):
                                def encode_items():
                                    items = [item for row in batch for item in item_rows(row, {
                                        'name': row['round_name'], 'questions': row['questions'],
                                        'revision': row['revision'], 'phase': row['phase'],
                                    })]
                                    encode_batch(items, fields, raw, csv_file)
                                    return len(items)
                                count += await offload(encode_items)
                                if total_bytes + raw.tell() + csv_file.tell() > MAX_BYTES:
                                    raise HTTPException(413, '答题明细超过打包上限，请按班级导出')
                        finally:
                            await result.close()
                        total_bytes += raw.tell() + csv_file.tell()
                        for extension, source in (('jsonl', raw), ('csv', csv_file)):
                            manifest['files'].append(await offload(add_file, archive, f'assessment_items.{extension}', source))
                        manifest['assessment_items'] = {'version': 'assessment-items/1', 'rows': count,
                            'primary_key': ['response_id', 'question_id'], 'fields': ASSESSMENT_FIELDS,
                            'limitation': 'Submitted responses only; no inferred scores or unsubmitted attendance.'}
                    original_rows = []
                    # Private originals are separate entries, not base64 fields in every CSV row.
                    for name, _columns, query in export_queries(class_name, group, include_identity):
                        model = {'classroom_materials': models.ClassroomMaterial, 'classroom_material_receipts': models.MaterialReceipt}.get(name)
                        if model is None:
                            continue
                        selected = query.subquery()
                        original_columns = [model.id, model.content]
                        if model is models.MaterialReceipt:
                            original_columns.extend([model.user_id, model.material_id, model.created_at, model.detail])
                        result = await snapshot.stream(select(*original_columns).where(model.id.in_(select(selected.c.id)), model.content.is_not(None)).execution_options(yield_per=1))
                        try:
                            async for record in result:
                                path = f'originals/{name}/{record.id}.bin'
                                manifest['originals']['records'] += 1
                                manifest['originals']['bytes'] += len(record.content)
                                original_rows.append({'source_table': name, 'source_id': record.id,
                                    'archive_path': path if include_originals else None,
                                    'bytes': len(record.content), 'sha256': hashlib.sha256(record.content).hexdigest(),
                                    'download_path': f'/api/admin/classroom/receipts/{record.id}/file' if model is models.MaterialReceipt else None})
                                if include_originals:
                                    total_bytes += len(record.content)
                                    if total_bytes > MAX_BYTES:
                                        raise HTTPException(413, '包含原件的研究包超过 128 MiB。可取消“包含上传原件”导出结构化数据及全部过程索引，原件在任务收件页逐份下载。')
                                    with io.BytesIO(record.content) as source:
                                        manifest['files'].append(await offload(add_file, archive, path, source))
                                if model is models.MaterialReceipt:
                                    rows, size = await offload(write_index, record.content, {
                                        'receipt_id': record.id, 'user_id': record.user_id,
                                        'material_id': record.material_id, 'received_at': record.created_at,
                                        'task_validation_status': (record.detail or {}).get('task_validation', {}).get('status'),
                                    }, sfls_raw, sfls_csv, encode_batch, MAX_BYTES - total_bytes)
                                    sfls_count += rows
                                    total_bytes += size
                        finally:
                            await result.close()
                    with tempfile.TemporaryFile() as raw, tempfile.TemporaryFile() as csv_file:
                        fields = ['source_table', 'source_id', 'archive_path', 'bytes', 'sha256', 'download_path']
                        csv_file.write(b'\xef\xbb\xbf' + (','.join(fields) + '\r\n').encode())
                        await offload(encode_batch, original_rows, fields, raw, csv_file)
                        total_bytes += raw.tell() + csv_file.tell()
                        if total_bytes > MAX_BYTES:
                            raise HTTPException(413, '原件清单超过打包上限，请按班级导出')
                        for extension, source in (('jsonl', raw), ('csv', csv_file)):
                            manifest['files'].append(await offload(add_file, archive, f'original_files.{extension}', source))
                    for extension, source in (('jsonl', sfls_raw), ('csv', sfls_csv)):
                        manifest['files'].append(await offload(add_file, archive, f'sfls_process.{extension}', source))
                    manifest['sfls_process'] = {'version': 'sfls-process-index/4', 'rows': sfls_count,
                        'limitation': 'Client clocks and logs are unverified. Repeated uploads can contain the same events; do not count each receipt as new behavior. Parse errors are explicit; originals are retained.'}
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
                    dictionary = io.StringIO(newline='')
                    writer = csv.writer(dictionary)
                    writer.writerow(['table', 'field', 'type', 'description', 'references'])
                    for name, table in manifest['tables'].items():
                        for column in table['columns']:
                            writer.writerow([csv_cell(v) for v in [name, column['name'], column['type'],
                                column['description'] or '', ';'.join(column['references'])]])
                    for field, description in ASSESSMENT_FIELDS.items():
                        writer.writerow(['assessment_items', field, 'see raw definition', description, ''])
                    for name, fields in DERIVED_FIELDS.items():
                        for field in fields:
                            writer.writerow([name, field, 'see JSONL value', ANALYSIS_FIELD_DESCRIPTIONS[field], ''])
                    for name, content in [('分析说明.md', ANALYSIS_GUIDE.encode('utf-8')),
                                          ('数据字典.csv', ('\ufeff' + dictionary.getvalue()).encode('utf-8'))]:
                        with io.BytesIO(content) as source:
                            manifest['files'].append(await offload(add_file, archive, name, source))
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
student_advice 保存 /advice 的学生原文；user_id 来自登录认证，client_context 中任务与版本由客户端自报，未验证课次绑定。created_at 是首次服务器收件时间，client_created_at 是未校验的本机填写时间。按建议 id 去重；本地 student_advice_saved/received 事件可能在后续作品包中再次出现，不能重复计数。建议不是能力测验，原文可能包含个人信息，分享前仍须脱敏。
stage_event_artifacts 连接事件与产物版本，一次事件可能关联多个版本；按事件 id 去重计数。
研究任务提交中的 workspace_data 是最后保存状态；artifact_versions 是已采集的版本证据。
scaffold_events 关联提问、回答和事件；不能仅凭 AI 生成内容断言学生采用或理解。
learning_process 是可筛选的过程索引，用 source_table/source_id 回查原始表，按 user_id/session_id/at 串联。
sfls_process 是本地上传对话与操作索引；receipt_id 关联收件表，archive_path 与 line 定位原始 ZIP 中的日志。received_at 是服务器收件时间，client_at 是未核验的本机时间。status 非 ok 需回查原件；同一日志可能出现在多次提交中，不能按收件次数重复计数。索引不推断掌握程度、有效学习时长或作者身份。
elapsed_ms 是同一次客户端运行内的单调经过时间，duration_ms 是请求（可能含工具）或作品进程耗时，不是有效学习时长。support_reported 是 AI 对支持方式的自述，不是学生能力评分；quote_verified 只表示匹配本轮输入，不表示理解正确。support_record_status=missing 表示没有记录，不能补成 L0。旧版没有的新字段留空，按软件及支架版本分开检查。
preparation_records 中 kind=design 的 sfls-design/1 记录保留需求、模块和连线的每次保存版本；首次版本是初始设计，不以下载包覆盖历史记录。
worksheets.csv/jsonl 展开 kind=worksheet 的全部版本，research_id 为 S- 加 users.id。sources 为来源自述；tests 为完整嵌套测试行，非自动测试成绩。plan_revision_id 是明确点击保存本轮打算的版本，不等于首次独立构思。下载回执 detail.worksheet_context 固定包内版本，提交回执分别保留包内哈希与当时网页版本；之后的网页修改仍在原记录表，不覆盖收件快照。模板发布后冻结在 classroom_materials.configuration.worksheet，修改须重新发布，旧模板和旧答案保留。
learning_support_turns 是两组与准备区的共同支持原始账本，含策略/模型快照、阶段焦点、帮助变化、代码快照、候选教材知识点及练习证据。对应的兼容 chat_messages 和 preparation_records 仍保留，但不在 learning_process 重复计数。
learning_practice_reviews 是当前模板审核状态；练习发放时把题目、答案、评分依据与审核信息冻结在账本。understanding_check 不是 part-task practice，也不是正式能力测验；correct 只代表单题匹配。
共同支持的 applied_level 是服务端给模型的帮助边界，不是对模型实际输出深度的独立检验。status=answered 表示服务端生成并保存，不证明浏览器收到或学生阅读。paused 是学生主动选择减少提示，不是能力诊断或自动渐隐。
response_to 仅保留已明确记录的提问关联；无关联不按时间猜测。产物前后内容由 stage_event_artifacts→artifact_versions.previous_version_id 追溯。
reply_generation_ms 是服务器生成回答的耗时（含排队），不是学生思考时间或浏览器完整等待时长。旧数据为空。
所有时间保留原始时区。空表仍有 CSV 表头，JSONL 为空；缺失不补零、不代造。
默认不导出姓名/学号/邮箱，但自由文本仍需人工脱敏。教师蓝图/测试答案须保密。
问卷是自陈资料，画像是模型推断；都不能直接充当复杂问题解决能力的客观分数。
本包不导出密码、令牌、API 密钥、系统配置。图谱是否包含见 manifest.graph。
knowledge_graph 为当前原始快照（无页面 50 条上限/频次压缩），不是历史图谱；共享概念边不能归因为单个学生行为。
"""
