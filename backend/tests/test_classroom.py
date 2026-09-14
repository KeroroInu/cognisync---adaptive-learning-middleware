"""Classroom controls: real JWT authorization, scoped raw evidence, and save grace.

Run only against the dedicated ``cognisync_classroom_control_test`` database.
These tests intentionally do not use admin_client's authentication override.
"""
from datetime import datetime, timedelta, timezone
import asyncio
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select

from app.api.endpoints.admin.auth import _create_admin_token
from app.api.endpoints.auth import create_access_token, hash_password, verify_password
from app.models.sql.classroom import (
    ClassroomControlEvent,
    ClassroomPublication,
    ClassroomResponse,
    ClassroomSession,
)
from app.models.sql.research import ResearchTask, ResearchTaskStatus, ResearchTaskSubmission
from app.models.sql.user import User

pytestmark = pytest.mark.asyncio
ADMIN = "/api/admin/classroom"
STUDENT = "/api/classroom"


@pytest.fixture
async def classroom_actors(test_db):
    """Two classmates, one other-class learner, and a real database administrator."""
    async with test_db() as db:
        teacher = User(student_id="classroom_teacher", name="课堂测试教师", role="admin", auth_version=0)
        first = User(student_id="classroom_a1", name="一班甲", role="learner", class_name="测试一班", experiment_group="pdt", auth_version=0)
        second = User(student_id="classroom_a2", name="一班乙", role="learner", class_name="测试一班", experiment_group="pdt", auth_version=0)
        other = User(student_id="classroom_b1", name="二班甲", role="learner", class_name="测试二班", experiment_group="ai_pbl", auth_version=0)
        db.add_all([teacher, first, second, other])
        await db.commit()
        return {
            "teacher_id": teacher.id,
            "teacher": {"Authorization": f"Bearer {_create_admin_token(str(teacher.id))}"},
            "first_id": first.id,
            "first": {"Authorization": f"Bearer {create_access_token(str(first.id))}"},
            "second_id": second.id,
            "second": {"Authorization": f"Bearer {create_access_token(str(second.id))}"},
            "other_id": other.id,
            "other": {"Authorization": f"Bearer {create_access_token(str(other.id))}"},
        }


def question(*, required=True, kind="choice"):
    return {
        "id": "q_check", "text": "你这次先检查了什么？", "type": kind, "required": required,
        "options": [{"value": "result", "label": "运行结果"}, {"value": "code", "label": "代码"}] if kind == "choice" else [],
    }


async def start(client, actors, *, class_name="测试一班", title="课堂控制接口测试", request_id=None):
    body = {"request_id": request_id or str(uuid4()), "class_name": class_name, "title": title}
    response = await client.post(f"{ADMIN}/sessions", headers=actors["teacher"], json=body)
    assert response.status_code == 200, response.text
    return response.json()["data"]


async def publish(client, actors, session_id, *, request_id=None, item=None):
    body = {"request_id": request_id or str(uuid4()), "question": item or question(), "source": "集成测试草稿，不是正式量表"}
    response = await client.post(f"{ADMIN}/sessions/{session_id}/prompts", headers=actors["teacher"], json=body)
    assert response.status_code == 200, response.text
    return response.json()["data"]


async def change_state(client, actors, session_id, action):
    response = await client.post(f"{ADMIN}/sessions/{session_id}/state", headers=actors["teacher"], json={"action": action})
    assert response.status_code == 200, response.text
    return response.json()["data"]


async def learning_task(test_db, *, user_id=None):
    async with test_db() as db:
        task = ResearchTask(title="课堂贪吃蛇", code_content="# starter", status=ResearchTaskStatus.ACTIVE, target_group="all")
        db.add(task)
        await db.flush()
        if user_id:
            db.add(ResearchTaskSubmission(task_id=task.id, user_id=user_id, code_submitted="score = 1", workspace_data={"original": True}))
        await db.commit()
        return task.id


async def expire_grace(test_db, session_id):
    async with test_db() as db:
        session = await db.get(ClassroomSession, UUID(session_id))
        session.closes_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await db.commit()


async def test_teacher_controls_require_real_active_admin(client, test_db, classroom_actors):
    actors = classroom_actors
    body = {"class_name": "测试一班", "title": "不应创建"}
    assert (await client.get(f"{ADMIN}/sessions")).status_code == 401
    assert (await client.post(f"{ADMIN}/sessions", headers=actors["first"], json=body)).status_code == 403
    forged_role = {"Authorization": f"Bearer {_create_admin_token(str(actors['first_id']))}"}
    assert (await client.post(f"{ADMIN}/sessions", headers=forged_role, json=body)).status_code == 403
    session = await start(client, actors)
    prompt = await publish(client, actors, session["id"])
    for path, body in (
        (f"/sessions/{session['id']}/state", {"action": "end"}),
        (f"/sessions/{session['id']}/prompts", {"question": question()}),
        (f"/prompts/{prompt['id']}/close", {}),
    ):
        assert (await client.post(f"{ADMIN}{path}", headers=actors["first"], json=body)).status_code == 403
    assert (await client.get(f"{ADMIN}/prompts/{prompt['id']}/responses", headers=actors["first"])).status_code == 403
    async with test_db() as db:
        teacher = await db.get(User, actors["teacher_id"])
        teacher.is_active = False
        await db.commit()
    assert (await client.get(f"{ADMIN}/sessions", headers=actors["teacher"])).status_code == 403


async def test_cross_class_cannot_read_or_submit_another_prompt(client, test_db, classroom_actors):
    actors = classroom_actors
    await learning_task(test_db)
    session = await start(client, actors)
    prompt = await publish(client, actors, session["id"])
    own = (await client.get(f"{STUDENT}/state", headers=actors["first"])).json()["data"]
    assert own["session"]["id"] == session["id"]
    assert own["prompt"]["id"] == prompt["id"]
    assert "source" not in own["prompt"]
    other = (await client.get(f"{STUDENT}/state", headers=actors["other"])).json()["data"]
    assert other == {"session": None, "prompt": None, "lesson_entry": None}
    response = await client.post(f"{STUDENT}/prompts/{prompt['id']}/responses", headers=actors["other"], json={"answer": "code"})
    assert response.status_code == 404
    # Another class keeps its preparation area; no legacy task is auto-assigned.
    await change_state(client, actors, session["id"], "end")
    assert (await client.get("/api/preparation/records", headers=actors["other"])).status_code == 200


async def test_create_and_publish_request_ids_are_idempotent_but_new_publications_are_distinct(client, test_db, classroom_actors):
    actors = classroom_actors
    session_request_id = str(uuid4())
    session = await start(client, actors, request_id=session_request_id)
    repeated = await start(client, actors, request_id=session_request_id)
    assert repeated["id"] == session["id"]
    conflict = await client.post(f"{ADMIN}/sessions", headers=actors["teacher"], json={"request_id": session_request_id, "class_name": "测试一班", "title": "不同课次"})
    assert conflict.status_code == 409
    publication_id = str(uuid4())
    first = await publish(client, actors, session["id"], request_id=publication_id)
    retry = await publish(client, actors, session["id"], request_id=publication_id)
    assert first["id"] == retry["id"]
    conflict = await client.post(f"{ADMIN}/sessions/{session['id']}/prompts", headers=actors["teacher"], json={
        "request_id": publication_id, "question": {**question(), "text": "换了题目"}, "source": "集成测试草稿，不是正式量表",
    })
    assert conflict.status_code == 409
    second = await publish(client, actors, session["id"])
    assert second["id"] != first["id"]
    async with test_db() as db:
        assert await db.scalar(select(func.count()).select_from(ClassroomSession)) == 1
        assert await db.scalar(select(func.count()).select_from(ClassroomPublication)) == 2
        previous = await db.get(ClassroomPublication, UUID(first["id"]))
        assert previous.closed_at is not None
    current = (await client.get(f"{STUDENT}/state", headers=actors["first"])).json()["data"]
    assert current["prompt"]["id"] == second["id"]


async def test_new_session_archives_old_pointer_without_erasing_raw_answers(client, test_db, classroom_actors):
    actors = classroom_actors
    first = await start(client, actors)
    prompt = await publish(client, actors, first["id"])
    answer = await client.post(f"{STUDENT}/prompts/{prompt['id']}/responses", headers=actors["first"], json={"answer": "result"})
    assert answer.status_code == 200
    second = await start(client, actors, title="下一节课")
    assert second["id"] != first["id"]
    assert (await client.post(f"{ADMIN}/sessions/{first['id']}/state", headers=actors["teacher"], json={"action": "open"})).status_code == 409
    history = await client.get(f"{ADMIN}/prompts/{prompt['id']}/responses", headers=actors["teacher"])
    assert history.status_code == 200
    assert history.json()["data"]["responses"][0]["answer"] == "result"
    async with test_db() as db:
        assert await db.scalar(select(func.count()).select_from(ClassroomSession)) == 2
        assert await db.scalar(select(func.count()).select_from(ClassroomSession).where(ClassroomSession.is_current.is_(True))) == 1
        assert await db.scalar(select(func.count()).select_from(ClassroomResponse)) == 1


async def test_answers_validate_freeze_and_paginate_without_rewriting_evidence(client, test_db, classroom_actors):
    actors = classroom_actors
    session = await start(client, actors)
    prompt = await publish(client, actors, session["id"])
    url = f"{STUDENT}/prompts/{prompt['id']}/responses"
    for body in ({}, {"answer": None}, {"answer": "not-an-option"}, {"answer": 1}, {"answer": "code", "user_id": str(actors["second_id"])}):
        invalid = await client.post(url, headers=actors["first"], json=body)
        assert invalid.status_code == 422, invalid.text
    first = await client.post(url, headers=actors["first"], json={"answer": "code"})
    assert first.status_code == 200, first.text
    retry = await client.post(url, headers=actors["first"], json={"answer": "code"})
    assert retry.status_code == 200 and retry.json()["data"]["already_submitted"]
    assert retry.json()["data"]["id"] == first.json()["data"]["id"]
    assert (await client.post(url, headers=actors["first"], json={"answer": "result"})).status_code == 409
    assert (await client.post(url, headers=actors["second"], json={"answer": "result"})).status_code == 200
    assert (await client.get(f"{STUDENT}/state", headers=actors["first"])).json()["data"]["prompt"] is None
    page1 = (await client.get(f"{ADMIN}/prompts/{prompt['id']}/responses?limit=1&offset=0", headers=actors["teacher"])).json()["data"]
    page2 = (await client.get(f"{ADMIN}/prompts/{prompt['id']}/responses?limit=1&offset=1", headers=actors["teacher"])).json()["data"]
    assert page1["total"] == page2["total"] == page1["total_students"] == 2
    assert len(page1["responses"]) == len(page2["responses"]) == 1
    assert page1["responses"][0]["id"] != page2["responses"][0]["id"]
    assert page1["prompt"]["source"] == "集成测试草稿，不是正式量表"
    async with test_db() as db:
        rows = (await db.scalars(select(ClassroomResponse))).all()
        assert len(rows) == 2
        assert {row.user_id for row in rows} == {actors["first_id"], actors["second_id"]}
        assert all(row.class_snapshot == "测试一班" and row.group_snapshot == "pdt" for row in rows)


async def test_optional_text_and_closed_prompt_semantics(client, classroom_actors):
    actors = classroom_actors
    session = await start(client, actors)
    prompt = await publish(client, actors, session["id"], item=question(required=False, kind="text"))
    url = f"{STUDENT}/prompts/{prompt['id']}/responses"
    assert (await client.post(url, headers=actors["first"], json={"answer": "x" * 4001})).status_code == 422
    assert (await client.post(url, headers=actors["first"], json={"answer": None})).status_code == 200
    closed = await client.post(f"{ADMIN}/prompts/{prompt['id']}/close", headers=actors["teacher"], json={})
    assert closed.status_code == 200
    # Identical retries remain safe after close; new answers are refused.
    retry = await client.post(url, headers=actors["first"], json={"answer": None})
    assert retry.status_code == 200 and retry.json()["data"]["already_submitted"]
    assert (await client.post(url, headers=actors["second"], json={"answer": "后到的答案"})).status_code == 409
    assert (await client.get(f"{STUDENT}/state", headers=actors["second"])).json()["data"]["prompt"] is None


async def test_closing_grace_only_allows_existing_own_workspace_and_progress(client, test_db, classroom_actors):
    actors = classroom_actors
    existing_task = await learning_task(test_db, user_id=actors["first_id"])
    new_task = await learning_task(test_db)
    session = await start(client, actors)
    assert (await client.post(f"{ADMIN}/sessions/{session['id']}/lesson", headers=actors["teacher"], json={"tasks": {"pdt": str(existing_task)}})).status_code == 200
    assert (await client.post(f"{ADMIN}/sessions/{session['id']}/lesson/start", headers=actors["teacher"])).status_code == 200
    before = datetime.now(timezone.utc)
    closing = await change_state(client, actors, session["id"], "end")
    deadline = datetime.fromisoformat(closing["closes_at"].replace("Z", "+00:00"))
    assert 8 <= (deadline - before).total_seconds() <= 12
    assert closing["state"] == "closing"
    repeat = await change_state(client, actors, session["id"], "end")
    assert repeat["closes_at"] == closing["closes_at"]
    for endpoint, body in (
        ("save-workspace", {"workspace_data": {"saved_during_grace": True}}),
        ("save-progress", {"code_submitted": "score = 2"}),
    ):
        saved = await client.post(f"/api/research/tasks/{existing_task}/{endpoint}", headers=actors["first"], json=body)
        assert saved.status_code == 200, saved.text
        # A classmate's existing submission cannot authorize this student's new one.
        denied = await client.post(f"/api/research/tasks/{existing_task}/{endpoint}", headers=actors["second"], json=body)
        assert denied.status_code == 403 and denied.json()["detail"]["code"] == "CLASSROOM_CLOSING"
        denied = await client.post(f"/api/research/tasks/{new_task}/{endpoint}", headers=actors["first"], json=body)
        assert denied.status_code == 403
    denied = await client.get("/api/research/active-task", headers=actors["first"])
    assert denied.status_code == 403 and denied.json()["detail"]["code"] == "CLASSROOM_CLOSING"
    async with test_db() as db:
        submissions = (await db.scalars(select(ResearchTaskSubmission))).all()
        assert len(submissions) == 1
        assert submissions[0].code_submitted == "score = 2"
        assert submissions[0].workspace_data["saved_during_grace"] is True
        assert await db.scalar(select(func.count()).select_from(ClassroomControlEvent).where(ClassroomControlEvent.action == "end")) == 1


async def test_expired_class_blocks_learning_but_preserves_identity_assessments_admin_and_reopen(client, test_db, classroom_actors):
    actors = classroom_actors
    task_id = await learning_task(test_db, user_id=actors["first_id"])
    session = await start(client, actors)
    assert (await client.post(f"{ADMIN}/sessions/{session['id']}/lesson", headers=actors["teacher"], json={"tasks": {"pdt": str(task_id)}})).status_code == 200
    assert (await client.post(f"{ADMIN}/sessions/{session['id']}/lesson/start", headers=actors["teacher"])).status_code == 200
    await change_state(client, actors, session["id"], "end")
    await expire_grace(test_db, session["id"])
    for endpoint, body in (
        ("save-workspace", {"workspace_data": {"too_late": True}}),
        ("save-progress", {"code_submitted": "too late"}),
    ):
        response = await client.post(f"/api/research/tasks/{task_id}/{endpoint}", headers=actors["first"], json=body)
        assert response.status_code == 403 and response.json()["detail"]["code"] == "CLASSROOM_CLOSED"
    assert (await client.get("/api/research/active-task", headers=actors["first"])).status_code == 403
    for path in ("/api/auth/me", f"{STUDENT}/state", "/api/assessments/pending"):
        response = await client.get(path, headers=actors["first"])
        assert response.status_code == 200, response.text
    state = (await client.get(f"{STUDENT}/state", headers=actors["first"])).json()["data"]
    assert state["session"]["state"] == "closed"
    assert (await client.get(f"{ADMIN}/sessions", headers=actors["teacher"])).status_code == 200
    refused = await client.post(f"{ADMIN}/sessions/{session['id']}/prompts", headers=actors["teacher"], json={"question": question()})
    assert refused.status_code == 409
    opened = await change_state(client, actors, session["id"], "open")
    assert opened["state"] == "open" and opened["closes_at"] is None
    assert (await client.get("/api/research/active-task", headers=actors["first"])).status_code == 200
    saved = await client.post(f"/api/research/tasks/{task_id}/save-progress", headers=actors["first"], json={"code_submitted": "score = 3"})
    assert saved.status_code == 200


async def test_reset_password_revokes_old_token_without_replacing_student_or_evidence(client, test_db, classroom_actors):
    actors = classroom_actors
    old_password, new_password = "old-pass-123", "new-pass-456"
    async with test_db() as db:
        user = await db.get(User, actors["first_id"])
        user.password_hash = hash_password(old_password)
        user.gender = "female"
        await db.commit()
    task_id = await learning_task(test_db, user_id=actors["first_id"])
    session = await start(client, actors)
    prompt = await publish(client, actors, session["id"])
    assert (await client.post(f"{STUDENT}/prompts/{prompt['id']}/responses", headers=actors["first"], json={"answer": "code"})).status_code == 200
    reset_url = f"/api/admin/users/{actors['first_id']}/reset-password"
    assert (await client.post(reset_url, headers=actors["second"], json={"new_password": new_password})).status_code == 403
    assert (await client.post(reset_url, headers=actors["teacher"], json={"new_password": "123"})).status_code == 400
    reset = await client.post(reset_url, headers=actors["teacher"], json={"new_password": new_password})
    assert reset.status_code == 200 and reset.json()["data"]["reset"] is True
    assert new_password not in reset.text and "password_hash" not in reset.text
    assert (await client.get("/api/auth/me", headers=actors["first"])).status_code == 401
    assert (await client.get(f"{STUDENT}/state", headers=actors["first"])).status_code == 401
    assert (await client.post("/api/auth/login", json={"student_id": "classroom_a1", "password": old_password})).status_code == 401
    login = await client.post("/api/auth/login", json={"student_id": "classroom_a1", "password": new_password})
    assert login.status_code == 200, login.text
    assert login.json()["user"]["id"] == str(actors["first_id"])
    new_headers = {"Authorization": f"Bearer {login.json()['token']}"}
    assert (await client.get("/api/auth/me", headers=new_headers)).status_code == 200
    async with test_db() as db:
        user = await db.get(User, actors["first_id"])
        assert (user.name, user.student_id, user.class_name, user.experiment_group, user.gender) == ("一班甲", "classroom_a1", "测试一班", "pdt", "female")
        assert user.auth_version == 1 and verify_password(new_password, user.password_hash)
        assert user.password_hash != new_password
        assert await db.scalar(select(func.count()).select_from(User)) == 4
        assert await db.scalar(select(func.count()).select_from(ClassroomResponse).where(ClassroomResponse.user_id == user.id)) == 1
        submission = await db.scalar(select(ResearchTaskSubmission).where(ResearchTaskSubmission.task_id == task_id, ResearchTaskSubmission.user_id == user.id))
        assert submission.code_submitted == "score = 1"
    admin_reset = await client.post(f"/api/admin/users/{actors['teacher_id']}/reset-password", headers=actors["teacher"], json={"new_password": new_password})
    assert admin_reset.status_code == 422


async def test_admin_login_carries_password_version(client, test_db, classroom_actors):
    actors = classroom_actors
    async with test_db() as db:
        teacher = await db.get(User, actors["teacher_id"])
        teacher.auth_version = 2
        teacher.password_hash = hash_password("teacher-new-pass")
        await db.commit()
    assert (await client.get(f"{ADMIN}/sessions", headers=actors["teacher"])).status_code == 401
    login = await client.post("/api/admin/auth/login", json={"student_id": "classroom_teacher", "password": "teacher-new-pass"})
    assert login.status_code == 200, login.text
    headers = {"Authorization": f"Bearer {login.json()['data']['token']}"}
    assert (await client.get("/api/admin/auth/me", headers=headers)).status_code == 200
    assert (await client.post(f"{ADMIN}/sessions", headers=headers, json={"class_name": "测试一班", "title": "新课次"})).status_code == 200


async def test_student_registration_minimal_and_password_private(client, test_db):
    response = await client.post("/api/auth/register", json={"student_id": "new_minimal", "name": "体验学生", "password": "student-self-pass", "mode": "classroom", "gender": "female"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["user"]["gender"] == "female"
    assert "password_hash" not in response.text and "student-self-pass" not in response.text
    async with test_db() as db:
        student = await db.get(User, UUID(body["user"]["id"]))
        assert student.email is None and student.gender == "female"
        assert verify_password("student-self-pass", student.password_hash)
        assert not await db.scalar(select(func.count()).select_from(ResearchTaskSubmission).where(ResearchTaskSubmission.user_id == student.id))
    response = await client.post("/api/auth/register", json={"student_id": "new_no_gender", "name": "体验乙", "password": "student-self-pass", "mode": "classroom"})
    assert response.status_code == 200 and response.json()["user"]["gender"] is None


async def test_classmates_submit_concurrently_with_retry_deduplication(client, test_db, classroom_actors):
    lesson = await start(client, classroom_actors)
    prompt = await publish(client, classroom_actors, lesson["id"])
    async with test_db() as db:
        students = [User(student_id=f"answer-load-{i}", name=f"并发{i}", role="learner", class_name="测试一班") for i in range(20)]
        db.add_all(students)
        await db.commit()
        ids = [s.id for s in students]
    async def submit(user_id):
        return await client.post(f"{STUDENT}/prompts/{prompt['id']}/responses", headers={"Authorization": f"Bearer {create_access_token(str(user_id))}"}, json={"answer": "code"})
    responses = await asyncio.wait_for(asyncio.gather(*(submit(user_id) for user_id in ids + ids)), 10)
    assert all(r.status_code == 200 for r in responses)
    async with test_db() as db:
        assert await db.scalar(select(func.count()).select_from(ClassroomResponse)) == 20
