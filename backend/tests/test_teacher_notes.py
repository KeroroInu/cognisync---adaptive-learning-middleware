import csv
import io
import uuid

import jwt
import pytest

from app.core.config import settings
from app.models.sql.user import User
from app.models.sql.research import ResearchTask
from app.models.sql.research_event import StageEvent, ProjectStage, StageEventType


@pytest.fixture
async def note_context(test_db, registered_user):
    async with test_db() as db:
        teacher = User(student_id="notes-admin", name="课堂教师", role="admin")
        other = User(student_id="notes-other", name="其他学生")
        task = ResearchTask(title="课堂任务", code_content="# starter", language="python", target_group="all")
        db.add_all([teacher, other, task])
        await db.flush()
        events = [StageEvent(task_id=task.id, user_id=uid, request_id=str(uuid.uuid4()), stage=ProjectStage.BUILD, event_type=StageEventType.MODULE_TEST)
                  for uid in (uuid.UUID(registered_user["user_id"]), other.id)]
        db.add_all(events)
        await db.commit()
        token = jwt.encode({"sub": str(teacher.id), "role": "admin"}, settings.JWT_SECRET or "cognisync-dev-secret-key-change-in-production", algorithm="HS256")
        return {"headers": {"Authorization": f"Bearer {token}"}, "student": registered_user["user_id"],
                "teacher": str(teacher.id), "other": str(other.id), "event": str(events[0].id), "foreign_event": str(events[1].id)}


def payload(**kwargs):
    return {"request_id": str(uuid.uuid4()), "lesson_date": "2026-09-07", "lesson_label": "第 2 课",
            "observation": "学生发现未吃到食物时也加分，修改条件后重测。", **kwargs}


@pytest.mark.asyncio
async def test_save_retry_correction_and_export(client, note_context):
    ctx = note_context
    path = f'/api/admin/users/{ctx["student"]}/teacher-notes'
    body = payload(evidence_ids=[ctx["event"]], observation="=需要核对的原始记录")
    response = await client.post(path, headers=ctx["headers"], json=body)
    assert response.status_code == 200, response.text
    note = response.json()["data"]
    assert note["teacher_id"] == ctx["teacher"] and note["teacher_name"] == "课堂教师"
    assert note["evidence"][0]["event_id"] == ctx["event"]
    retry = await client.post(path, headers=ctx["headers"], json=body)
    assert retry.json()["data"]["id"] == note["id"]
    conflict = await client.post(path, headers=ctx["headers"], json={**body, "observation": "different"})
    assert conflict.status_code == 409
    correction = await client.post(path, headers=ctx["headers"], json=payload(supersedes_id=note["id"]))
    assert correction.status_code == 200
    listing = (await client.get(path + "?limit=1", headers=ctx["headers"])).json()["data"]
    assert len(listing["notes"]) == 1 and listing["has_more"]
    assert listing["notes"][0]["supersedes_id"] == note["id"]
    earlier = (await client.get(path + "?offset=1", headers=ctx["headers"])).json()["data"]
    assert earlier["notes"][0]["observation"] == body["observation"]
    result = await client.get(f'/api/admin/export/csv/teacher-notes?student_id={ctx["student"]}', headers=ctx["headers"])
    assert result.status_code == 200
    rows = list(csv.DictReader(io.StringIO(result.text.lstrip("\ufeff"))))
    assert len(rows) == 2 and rows[0]["observation"].startswith("'=")
    assert "teacher_name" not in rows[0] and "name" not in rows[0]
    # Notes protect both their subject and their author from physical deletion.
    for uid in (ctx["student"], ctx["teacher"]):
        deletion = await client.delete(f'/api/admin/users/{uid}', headers=ctx["headers"])
        assert deletion.status_code == 409
        assert deletion.json()["detail"]["evidence"]["teacherNotes"] == 2


@pytest.mark.asyncio
async def test_rejects_foreign_evidence_and_forged_author(client, note_context):
    ctx = note_context
    path = f'/api/admin/users/{ctx["student"]}/teacher-notes'
    for body in (payload(evidence_ids=[ctx["foreign_event"]]), payload(evidence_ids=[str(uuid.uuid4())]),
                 payload(teacher_id=ctx["other"]), payload(observation="  "), payload(supersedes_id=str(uuid.uuid4()))):
        response = await client.post(path, headers=ctx["headers"], json=body)
        assert response.status_code == 422, response.text
    events = (await client.get(f'/api/admin/users/{ctx["student"]}/teacher-note-evidence', headers=ctx["headers"])).json()["data"]["events"]
    assert [event["id"] for event in events] == [ctx["event"]]
    other_path = f'/api/admin/users/{ctx["other"]}/teacher-notes'
    foreign = await client.post(other_path, headers=ctx["headers"], json=payload())
    assert foreign.status_code == 200
    response = await client.post(path, headers=ctx["headers"], json=payload(supersedes_id=foreign.json()["data"]["id"]))
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_student_cannot_read_write_or_export_notes(client, note_context, auth_headers):
    path = f'/api/admin/users/{note_context["student"]}'
    for url in (path + "/teacher-notes", path + "/teacher-note-evidence", "/api/admin/export/csv/teacher-notes"):
        assert (await client.get(url, headers=auth_headers)).status_code == 403
        assert (await client.get(url)).status_code == 401
    assert (await client.post(path + "/teacher-notes", headers=auth_headers, json=payload())).status_code == 403


@pytest.mark.asyncio
async def test_optional_assessment_is_versioned_and_validated(client, note_context):
    ctx = note_context
    path = f'/api/admin/users/{ctx["student"]}/teacher-notes'
    assessment = {"rubric_version": "课堂评分草案 v1", "criterion": "代码理解", "score": 2, "max_score": 4}
    body = payload(assessment=assessment)
    response = await client.post(path, headers=ctx["headers"], json=body)
    assert response.status_code == 200, response.text
    assert response.json()["data"]["assessment"] == assessment
    replay = await client.post(path, headers=ctx["headers"], json=body)
    assert replay.json()["data"]["id"] == response.json()["data"]["id"]
    conflict = await client.post(path, headers=ctx["headers"], json={**body, "assessment": {**assessment, "score": 3}})
    assert conflict.status_code == 409
    for invalid in ({**assessment, "score": 5}, {**assessment, "score": -1}, {**assessment, "rubric_version": " "}, {**assessment, "max_score": 0}):
        assert (await client.post(path, headers=ctx["headers"], json=payload(assessment=invalid))).status_code == 422
    plain = await client.post(path, headers=ctx["headers"], json=payload())
    assert plain.json()["data"]["assessment"] is None
