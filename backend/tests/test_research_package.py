import csv
from datetime import date
import hashlib
import io
import json
import uuid
import zipfile

import pytest
from sqlalchemy import text

from app.models.sql import (User, ResearchTask, ResearchTaskSubmission, TeacherNote,
    ClassroomSession, ClassroomPublication, ClassroomResponse, ClassroomControlEvent)
from app.services import research_package as package_service


@pytest.fixture
def mock_graph(monkeypatch):
    async def batches(ids):
        yield [{"user_id": ids[0], "kind": "interaction", "data": {"count": 99}}]
    monkeypatch.setattr(package_service, "graph_batches", batches)


@pytest.fixture(autouse=True)
def use_mock_graph(mock_graph):
    pass


@pytest.fixture
async def package_context(test_db):
    async with test_db() as db:
        student = User(student_id="package-student", name="小同学", role="student", email="private@example.com", password_hash="SECRET_HASH", class_name="一班", experiment_group="pdt")
        other = User(student_id="package-other", name="其他同学", class_name="二班", experiment_group="ai_pbl")
        teacher = User(student_id="package-teacher", name="教师甲", role="admin")
        task = ResearchTask(title="贪吃蛇", code_content="teacher private starter")
        db.add_all([student, other, teacher, task])
        await db.flush()
        for user in (student, other):
            db.add(ResearchTaskSubmission(task_id=task.id, user_id=user.id, code_submitted="print('中文')\n" * 500,
                workspace_data={"observationCards": [{"id": "stable-id", "text": "观察"}]}))
        db.add(TeacherNote(student_id=student.id, teacher_id=teacher.id, teacher_name=teacher.name,
            group_snapshot="pdt", class_snapshot="一班", lesson_date=date(2026, 9, 9),
            lesson_label="第1课", observation="=1+1", interpretation="尚需核对", next_step="", evidence=[]))
        await db.commit()
        return {"student": str(student.id), "other": str(other.id), "teacher": str(teacher.id)}


def unpack(response):
    assert response.status_code == 200, response.text if response.status_code != 200 else ""
    archive = zipfile.ZipFile(io.BytesIO(response.content))
    manifest = json.loads(archive.read("manifest.json"))
    for item in manifest["files"]:
        content = archive.read(item["path"])
        assert hashlib.sha256(content).hexdigest() == item["sha256"]
        assert len(content) == item["bytes"]
    return archive, manifest


@pytest.mark.asyncio
async def test_package_complete_joinable_and_private(admin_client, package_context):
    archive, manifest = unpack(await admin_client.get('/api/admin/export/research-package?class_name=一班'))
    assert len(manifest["tables"]) == 36
    assert "student_advice" in manifest["tables"]
    assert manifest["tables"]["research_task_submissions"]["rows"] == 1
    assert manifest["tables"]["stage_events"]["rows"] == 0
    assert archive.read("stage_events.csv").startswith(b"\xef\xbb\xbf")
    assert archive.read("stage_events.jsonl") == b""
    users = [json.loads(line) for line in archive.read("users.jsonl").splitlines()]
    assert {u["id"] for u in users} == {package_context["student"], package_context["teacher"]}
    assert all(not ({"name", "email", "student_id", "password_hash"} & u.keys()) for u in users)
    submission = json.loads(archive.read("research_task_submissions.jsonl"))
    assert submission["user_id"] == package_context["student"]
    assert submission["code_submitted"] == "print('中文')\n" * 500
    assert json.loads(archive.read("teacher_notes.jsonl"))["observation"] == "=1+1"
    csv_rows = list(csv.DictReader(io.StringIO(archive.read("teacher_notes.csv").decode("utf-8-sig"))))
    assert csv_rows[0]["observation"] == "'=1+1"
    assert "system_config.jsonl" not in archive.namelist()
    assert json.loads(archive.read("knowledge_graph.jsonl"))["data"]["count"] == 99
    assert manifest['learning_process']['rows'] == 0
    assert archive.read('learning_process.csv').startswith(b'\xef\xbb\xbfsource_table,source_id')
    assert archive.read('learning_process.jsonl') == b''
    assert '数据字典.csv' in archive.namelist()
    assert '分析说明.md' in archive.namelist()
    assert all(column['description'] for table in manifest['tables'].values() for column in table['columns'])
    assert manifest['assessment_items']['rows'] == 0
    assert archive.read('assessment_items.csv').startswith(b'\xef\xbb\xbfuser_id')


@pytest.mark.asyncio
async def test_assessment_long_table_preserves_missing_skips_versions_and_scope(admin_client, test_db, package_context):
    from datetime import datetime, timezone
    from app.models.sql import AssessmentRound, AssessmentResponse
    questions = [
        {'id': 'q1', 'text': '经历', 'type': 'choice', 'required': True, 'options': [{'value': 'no', 'label': '没有'}]},
        {'id': 'q2', 'text': '经历详情', 'type': 'text', 'options': [], 'show_if': [{'question_id': 'q1', 'values': ['yes']}]},
        {'id': 'q3', 'text': '多选', 'type': 'multiple', 'options': [{'value': 'a', 'label': '甲'}, {'value': 'b', 'label': '乙'}]},
        {'id': 'q4', 'text': '可留空', 'type': 'text', 'options': []},
        {'id': 'q5', 'text': '不会可跳过', 'type': 'text', 'options': [], 'skip_label': '不会'},
        {'id': 'q6', 'text': '补充', 'type': 'text', 'options': [], 'parent_id': 'q1'},
    ]
    async with test_db() as db:
        for revision in (1, 2):
            paper = AssessmentRound(name=f'冻结卷{revision}', phase='pre', revision=revision, questions=questions)
            db.add(paper)
            await db.flush()
            for student in ('student', 'other'):
                db.add(AssessmentResponse(user_id=uuid.UUID(package_context[student]), round_id=paper.id,
                    answers={'q1': 'no', 'q3': ['b', 'a'], 'q4': None, 'q5': '__skip__', 'q6': '=原文'},
                    started_at=datetime.now(timezone.utc), class_snapshot='提交时班级', group_snapshot='pdt'))
        await db.commit()
    archive, manifest = unpack(await admin_client.get('/api/admin/export/research-package?class_name=一班'))
    items = [json.loads(line) for line in archive.read('assessment_items.jsonl').splitlines()]
    assert len(items) == manifest['assessment_items']['rows'] == 12
    assert {i['user_id'] for i in items} == {package_context['student']}
    assert len({(i['response_id'], i['question_id']) for i in items}) == 12
    assert {i['revision'] for i in items} == {1, 2}
    by_id = {i['question_id']: i for i in items}
    assert by_id['q2']['status'] == 'skipped_by_rule' and by_id['q2']['answer_present'] is False
    assert by_id['q4']['status'] == 'unanswered' and by_id['q4']['answer_present'] is True
    assert by_id['q4']['answer_value'] is None and by_id['q4']['answer_label'] is None
    assert by_id['q3']['answer_value'] == ['b', 'a'] and by_id['q3']['answer_label'] == ['乙', '甲']
    assert by_id['q5']['status'] == 'explicit_skip' and by_id['q5']['answer_label'] == '不会'
    assert by_id['q6']['answer_value'] == '=原文' and by_id['q6']['parent_id'] == 'q1'
    assert by_id['q1']['class_snapshot'] == '提交时班级'
    csv_rows = list(csv.DictReader(io.StringIO(archive.read('assessment_items.csv').decode('utf-8-sig'))))
    assert next(r for r in csv_rows if r['question_id'] == 'q6')['answer_value'] == "'=原文"


@pytest.mark.asyncio
async def test_process_index_keeps_explicit_reply_links(admin_client, test_db, package_context):
    from app.models.sql import ChatMessage
    async with test_db() as db:
        question = ChatMessage(user_id=uuid.UUID(package_context['student']), role='user', text='为什么',
                               analysis={'lesson': {'session_id': 'lesson-a'}, 'learningEvidence': {'code_sha256': 'code-hash'}})
        db.add(question)
        await db.flush()
        db.add(ChatMessage(user_id=question.user_id, role='assistant', text='先看结果', analysis={
            'lesson': {'session_id': 'lesson-a'}, 'learningEvidence': {'response_to': str(question.id), 'reply_generation_ms': 42}}))
        db.add(ChatMessage(user_id=uuid.UUID(package_context['other']), role='user', text='OTHER_PRIVATE'))
        await db.commit()
    archive, manifest = unpack(await admin_client.get('/api/admin/export/research-package?class_name=一班'))
    index = [json.loads(line) for line in archive.read('learning_process.jsonl').splitlines()]
    assert manifest['learning_process']['rows'] == len(index) == 2
    assert {r['user_id'] for r in index} == {package_context['student']}
    answer = next(r for r in index if r['kind'] == 'assistant')
    assert answer['response_to'] == str(question.id) and answer['session_id'] == 'lesson-a'
    assert answer['reply_generation_ms'] == 42 and answer['adopted'] is None


@pytest.mark.asyncio
async def test_classroom_batch_answers_export_with_frozen_questions(admin_client, test_db, package_context):
    from app.models.sql.classroom import ClassroomQuestionSet
    from datetime import datetime, timezone
    questions = [{"id": "q1", "text": "先做什么？", "type": "text", "required": True, "options": []}]
    async with test_db() as db:
        teacher_id = uuid.UUID(package_context["teacher"])
        template = ClassroomQuestionSet(title="课中问答", questions=questions, source="调查出处", created_by=teacher_id)
        session = ClassroomSession(class_name="一班", title="第一课", created_by=teacher_id)
        db.add_all([template, session])
        await db.flush()
        publication = ClassroomPublication(session_id=session.id, created_by=teacher_id, source=template.source,
            question={"kind": "set", "set_id": str(template.id), "title": template.title, "questions": questions})
        db.add(publication)
        await db.flush()
        db.add(ClassroomResponse(user_id=uuid.UUID(package_context["student"]), publication_id=publication.id,
            answer=None, answers={"q1": "=先看结果"}, started_at=datetime.now(timezone.utc), class_snapshot="一班", group_snapshot="pdt"))
        await db.commit()
    archive, _ = unpack(await admin_client.get('/api/admin/export/research-package?class_name=一班'))
    saved = json.loads(archive.read("classroom_responses.jsonl"))
    assert saved["answers"] == {"q1": "=先看结果"}
    assert saved["started_at"] and saved["created_at"]
    frozen = json.loads(archive.read("classroom_publications.jsonl"))
    assert frozen["id"] == saved["publication_id"] and frozen["question"]["questions"] == questions
    assert json.loads(archive.read("classroom_question_sets.jsonl"))["id"] == frozen["question"]["set_id"]


@pytest.mark.asyncio
async def test_identity_opt_in_and_empty_class(admin_client, package_context):
    archive, _ = unpack(await admin_client.get('/api/admin/export/research-package?include_identity=true&group=pdt'))
    data = archive.read("users.jsonl").decode()
    assert "小同学" in data and "private@example.com" in data
    assert "SECRET_HASH" not in data and "password_hash" not in data
    _, manifest = unpack(await admin_client.get('/api/admin/export/research-package?class_name=不存在'))
    assert manifest["tables"]["users"]["rows"] == 0
    assert manifest["tables"]["research_task_submissions"]["rows"] == 0


@pytest.mark.asyncio
async def test_package_size_guard_and_lock(admin_client, test_db, package_context, monkeypatch):
    async with test_db() as db:
        await db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": package_service.EXPORT_LOCK})
        response = await admin_client.get('/api/admin/export/research-package')
        assert response.status_code == 429
        await db.rollback()
    monkeypatch.setattr(package_service, "MAX_BYTES", 10)
    assert (await admin_client.get('/api/admin/export/research-package')).status_code == 413


@pytest.mark.asyncio
async def test_package_requires_teacher(client, auth_headers):
    path = '/api/admin/export/research-package'
    assert (await client.get(path)).status_code == 401
    assert (await client.get(path, headers=auth_headers)).status_code == 403


def test_csv_keeps_numbers_and_guards_text():
    assert package_service.csv_cell(-4) == -4
    assert package_service.csv_cell("  =1+1") == "'  =1+1"
    assert package_service.csv_cell(None) == ""
    assert package_service.json_default(uuid.UUID(int=0)) == str(uuid.UUID(int=0))


def test_derived_dictionary_covers_every_index_column():
    for fields in package_service.DERIVED_FIELDS.values():
        assert all(package_service.ANALYSIS_FIELD_DESCRIPTIONS.get(field) for field in fields)


@pytest.mark.asyncio
async def test_original_opt_out_keeps_all_versions_sfls_lines_and_auditable_files(admin_client, test_db, package_context, monkeypatch):
    from app.models.sql import ClassroomMaterial, MaterialReceipt
    def blob(version):
        target = io.BytesIO()
        with zipfile.ZipFile(target, 'w') as z:
            z.writestr('manifest.json', json.dumps({'sfls': {}}))
            z.writestr('project/main.py', f'print({version})\n' + '# padding\n' * 20000)
            z.writestr('evidence/events.jsonl', json.dumps({'type': 'request_settled', 'run_id': 'same-run', 'sequence': 1}) + '\n')
            z.writestr('evidence/sessions/one.jsonl', json.dumps({'type': 'message', 'id': 'same-event',
                'message': {'role': 'user', 'content': '列表怎么用'}}) + '\ninvalid-json\n')
        return target.getvalue()
    versions = [blob(1), blob(2)]
    async with test_db() as db:
        session = ClassroomSession(class_name='一班', title='跨课工作区', created_by=uuid.UUID(package_context['teacher']))
        db.add(session)
        await db.flush()
        material = ClassroomMaterial(session_id=session.id, created_by=session.created_by, title='第3课', kind='sfls',
            configuration={'lesson_id': 'lesson-3', 'project_id': 'snake'}, filename='task.zip')
        db.add(material)
        await db.flush()
        receipts = []
        for index, content in enumerate(versions):
            row = MaterialReceipt(material_id=material.id, user_id=uuid.UUID(package_context['student']),
                request_id=uuid.uuid4(), kind='submission', content=content, size=len(content),
                sha256=hashlib.sha256(content).hexdigest(), detail={'class_name': '一班', 'stage': index + 1})
            db.add(row)
            receipts.append(row)
        db.add(MaterialReceipt(material_id=material.id, user_id=uuid.UUID(package_context['other']),
            request_id=uuid.uuid4(), kind='submission', content=blob('OTHER_PRIVATE'), detail={}))
        await db.commit()
        receipt_ids = [str(row.id) for row in receipts]
        material_id = str(material.id)
    path = '/api/admin/export/research-package?class_name=一班&include_graph=false'
    archive, manifest = unpack(await admin_client.get(path))
    assert manifest['originals']['included'] is True and manifest['originals']['records'] == 2
    for receipt_id, content in zip(receipt_ids, versions):
        assert archive.read(f'originals/classroom_material_receipts/{receipt_id}.bin') == content
    full_index = archive.read('sfls_process.jsonl')
    # Force the original bytes over a bounded package limit, while indexes still fit.
    monkeypatch.setattr(package_service, 'MAX_BYTES', 150000)
    failure = await admin_client.get(path)
    assert failure.status_code == 413 and '原件' in failure.text
    structured, manifest = unpack(await admin_client.get(path + '&include_originals=false'))
    assert manifest['originals']['included'] is False
    assert manifest['originals']['bytes'] == sum(map(len, versions))
    assert not any(name.startswith('originals/') for name in structured.namelist())
    assert structured.read('sfls_process.jsonl') == full_index
    index = [json.loads(line) for line in full_index.splitlines()]
    assert len(index) == 6 and {row['receipt_id'] for row in index} == set(receipt_ids)
    assert {row['material_id'] for row in index} == {material_id}
    assert sum(row['status'] == 'invalid_json_line' for row in index) == 2
    # Keep repeated-upload observations, with sufficient provenance for later deduplication.
    assert len({(row['user_id'], row['run_id'], row['sequence']) for row in index if row['run_id']}) == 1
    files = [json.loads(line) for line in structured.read('original_files.jsonl').splitlines()]
    assert {row['source_id'] for row in files} == set(receipt_ids)
    assert all(row['archive_path'] is None and row['download_path'].startswith('/api/admin/classroom/receipts/') for row in files)
    assert {row['sha256'] for row in files} == {hashlib.sha256(content).hexdigest() for content in versions}
    dictionary = list(csv.DictReader(io.StringIO(structured.read('数据字典.csv').decode('utf-8-sig'))))
    for table, fields in package_service.DERIVED_FIELDS.items():
        assert {row['field'] for row in dictionary if row['table'] == table and row['description']} == set(fields)
    # Opting out of originals must never bypass the structured-data guard either.
    monkeypatch.setattr(package_service, 'MAX_BYTES', 10)
    assert (await admin_client.get(path + '&include_originals=false')).status_code == 413


@pytest.mark.asyncio
async def test_preparation_export_keeps_original_lesson_after_student_moves(admin_client, test_db, package_context):
    from app.models.sql import LessonPlan, PreparationRecord, ChatMessage
    from app.models.sql.message import MessageRole
    async with test_db() as db:
        session = ClassroomSession(class_name="旧班级", title="准备课", created_by=uuid.UUID(package_context["teacher"]))
        chat_session = ClassroomSession(class_name="另一旧班级", title="正式课", created_by=uuid.UUID(package_context["teacher"]))
        db.add_all([session, chat_session])
        await db.flush()
        db.add(LessonPlan(session_id=session.id, configuration={"tasks": {}, "knowledge_points": ["列表"]}))
        db.add(PreparationRecord(user_id=uuid.UUID(package_context["student"]), session_id=session.id,
                                request_id=uuid.uuid4(), kind="run", payload={"source": "browser_report"}))
        db.add(ChatMessage(user_id=uuid.UUID(package_context["student"]), role=MessageRole.USER,
                           text="条件判断", analysis={"lesson": {"session_id": str(chat_session.id)}}))
        await db.commit()
        ids = {str(session.id), str(chat_session.id)}
    archive, _ = unpack(await admin_client.get('/api/admin/export/research-package?class_name=一班&include_graph=false'))
    assert {json.loads(line)["id"] for line in archive.read("classroom_sessions.jsonl").splitlines()} == ids
    assert json.loads(archive.read("preparation_records.jsonl"))["session_id"] in ids
    assert json.loads(archive.read("classroom_lesson_plans.jsonl"))["configuration"]["knowledge_points"] == ["列表"]


@pytest.mark.asyncio
async def test_graph_failure_never_silently_omitted(admin_client, package_context, monkeypatch):
    async def failed(ids):
        raise RuntimeError("offline")
        yield  # async generator contract
    monkeypatch.setattr(package_service, "graph_batches", failed)
    assert (await admin_client.get('/api/admin/export/research-package')).status_code == 503
    archive, manifest = unpack(await admin_client.get('/api/admin/export/research-package?include_graph=false'))
    assert not manifest["graph"]["included"]
    assert 'knowledge_graph.jsonl' not in archive.namelist()


@pytest.mark.asyncio
async def test_classroom_export_keeps_question_and_author_after_student_moves(admin_client, test_db, package_context):
    async with test_db() as db:
        teacher = User(student_id="interaction-teacher", name="新教师", role="admin", password_hash="NEVER_EXPORT")
        db.add(teacher)
        await db.flush()
        lesson = ClassroomSession(class_name="原三班", title="旧课次", created_by=teacher.id)
        db.add(lesson)
        await db.flush()
        prompt = ClassroomPublication(session_id=lesson.id, created_by=teacher.id,
            question={"id": "reason", "text": "你的理由？", "type": "text", "required": False, "options": []}, source="课堂追问")
        db.add(prompt)
        await db.flush()
        db.add(ClassroomResponse(user_id=uuid.UUID(package_context["student"]), publication_id=prompt.id,
            answer=None, class_snapshot="原三班", group_snapshot="ai_pbl"))
        db.add(ClassroomControlEvent(session_id=lesson.id, teacher_id=teacher.id, action="create"))
        await db.commit()
        teacher_id, prompt_id = str(teacher.id), str(prompt.id)
    archive, _ = unpack(await admin_client.get('/api/admin/export/research-package?class_name=一班&include_graph=false'))
    users = [json.loads(line) for line in archive.read("users.jsonl").splitlines()]
    assert teacher_id in {u["id"] for u in users}
    assert "NEVER_EXPORT" not in archive.read("users.jsonl").decode()
    assert all("auth_version" not in u and "password_hash" not in u for u in users)
    answer = json.loads(archive.read("classroom_responses.jsonl"))
    assert answer["answer"] is None and answer["class_snapshot"] == "原三班"
    assert answer["publication_id"] == prompt_id
    assert json.loads(archive.read("classroom_publications.jsonl"))["id"] == prompt_id
    assert json.loads(archive.read("classroom_sessions.jsonl"))["class_name"] == "原三班"
    assert json.loads(archive.read("classroom_control_events.jsonl"))["teacher_id"] == teacher_id
