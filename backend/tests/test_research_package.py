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
    assert len(manifest["tables"]) == 25
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
