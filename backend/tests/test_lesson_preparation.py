"""Preparation is shared; only teacher-published lesson bindings select classroom tasks."""
import asyncio
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.models.sql import LessonPlan, PreparationRecord, ResearchTask, ResearchTaskStatus, StageEvent, ChatMessage
from test_classroom import classroom_actors as actors_fixture, start, learning_task, change_state

classroom_actors = actors_fixture

pytestmark = pytest.mark.asyncio
ADMIN = "/api/admin/classroom"


async def configured(client, actors, task_id):
    session = await start(client, actors)
    response = await client.post(f"{ADMIN}/sessions/{session['id']}/lesson", headers=actors["teacher"], json={
        "tasks": {"pdt": str(task_id)}, "knowledge_points": ["条件判断", "列表"],
    })
    assert response.status_code == 200, response.text
    return session, response.json()["data"]


async def test_teacher_starts_explicit_task_not_old_all_task(client, test_db, classroom_actors):
    actors = classroom_actors
    task_id = await learning_task(test_db)
    assert (await client.get("/api/research/active-task", headers=actors["first"])).status_code == 404
    session, plan = await configured(client, actors, task_id)
    state = (await client.get("/api/classroom/state", headers=actors["first"])).json()["data"]
    assert state["lesson_entry"] is None
    assert (await client.get("/api/research/active-task", headers=actors["first"])).status_code == 403
    assert (await client.post(f"{ADMIN}/sessions/{session['id']}/lesson/start", headers=actors["first"])).status_code == 403
    started = await client.post(f"{ADMIN}/sessions/{session['id']}/lesson/start", headers=actors["teacher"])
    assert started.status_code == 200
    again = await client.post(f"{ADMIN}/sessions/{session['id']}/lesson/start", headers=actors["teacher"])
    assert again.json() == started.json()
    active = (await client.get("/api/research/active-task", headers=actors["first"])).json()["data"]
    assert active["id"] == str(task_id)
    assert active["ai_prompt"] is None
    state = (await client.get("/api/classroom/state", headers=actors["first"])).json()["data"]
    assert state["lesson_entry"]["lesson_id"] == plan["id"]
    other = await learning_task(test_db)
    assert (await client.post(f"/api/research/tasks/{other}/save-progress", headers=actors["first"], json={"code_submitted": "print(1)"})).status_code == 404
    changed = await client.post(f"{ADMIN}/sessions/{session['id']}/lesson", headers=actors["teacher"], json={"tasks": {"pdt": str(other)}})
    assert changed.status_code == 409
    assert (await client.get("/api/classroom/state", headers=actors["other"])).json()["data"]["lesson_entry"] is None


async def test_lesson_snapshot_does_not_overwrite_student_code(client, test_db, classroom_actors):
    actors = classroom_actors
    task_id = await learning_task(test_db, user_id=actors["first_id"])
    session, _ = await configured(client, actors, task_id)
    await client.post(f"{ADMIN}/sessions/{session['id']}/lesson/start", headers=actors["teacher"])
    async with test_db() as db:
        task = await db.get(ResearchTask, task_id)
        task.code_content = "# changed later"
        await db.commit()
    data = (await client.get("/api/research/active-task", headers=actors["first"])).json()["data"]
    assert data["code_content"] == "# starter"
    assert data["code_submitted"] == "score = 1"
    await change_state(client, actors, session["id"], "end")
    # Same lesson still accepts its existing workspace during the saving grace.
    saved = await client.post(f"/api/research/tasks/{task_id}/save-progress", headers=actors["first"], json={"code_submitted": "score = 2"})
    assert saved.status_code == 200, saved.text


async def test_invalid_group_or_unpublished_task_rejected(client, test_db, classroom_actors):
    actors = classroom_actors
    session = await start(client, actors)
    old_task = await learning_task(test_db)
    blocked = await client.post(f"/api/research/tasks/{old_task}/save-progress", headers=actors["first"], json={"code_submitted": "print(7)"})
    assert blocked.status_code == 403 and blocked.json()["detail"]["code"] == "LESSON_NOT_STARTED"
    async with test_db() as db:
        task = ResearchTask(title="Not for this group", code_content="", target_group="ai_pbl", status=ResearchTaskStatus.ACTIVE)
        db.add(task)
        await db.commit()
        task_id = str(task.id)
    assert (await client.post(f"{ADMIN}/sessions/{session['id']}/lesson", headers=actors["teacher"], json={"tasks": {"pdt": task_id}})).status_code == 422


async def test_preparation_is_private_idempotent_and_not_a_task_submission(client, test_db, classroom_actors):
    actors = classroom_actors
    assert (await client.get("/api/preparation/records")).status_code == 401
    body = {"request_id": str(uuid4()), "kind": "save", "code": "print(7)"}
    responses = await asyncio.gather(*[client.post("/api/preparation/records", headers=actors["first"], json=body) for _ in range(3)])
    assert all(r.status_code == 200 for r in responses)
    assert len({r.json()["data"]["id"] for r in responses}) == 1
    assert (await client.get("/api/preparation/records", headers=actors["second"])).json()["data"] == []
    assert (await client.post("/api/preparation/records", headers=actors["first"], json={**body, "code": "print(8)"})).status_code == 409
    async with test_db() as db:
        records = (await db.scalars(select(PreparationRecord))).all()
        assert len(records) == 1 and records[0].session_id is None


async def test_preparation_chat_scope_and_closed_class(client, test_db, classroom_actors, monkeypatch):
    actors = classroom_actors
    from app.api.endpoints import preparation
    captured = []
    async def reply(provider, **kwargs):
        captured.append(kwargs)
        return "试试 print(7)"
    monkeypatch.setattr(preparation, "_complete_chat_reply", reply)
    session = await start(client, actors)
    body = {"request_id": str(uuid4()), "kind": "chat", "code": "print(7)", "message": "这句是什么意思"}
    response = await client.post("/api/preparation/records", headers=actors["first"], json=body)
    assert response.status_code == 200, response.text
    assert response.json()["data"]["session_id"] == session["id"]
    assert "尚未进入分组课堂" in captured[0]["system_prompt"]
    assert "print(7)" in captured[0]["user_prompt"]
    await client.post("/api/preparation/records", headers=actors["first"], json=body)
    assert len(captured) == 1
    await change_state(client, actors, session["id"], "end")
    assert (await client.post("/api/preparation/records", headers=actors["first"], json={**body, "request_id": str(uuid4())})).status_code == 403
    assert (await client.post("/api/preparation/records", headers=actors["first"], json={"kind": "run", "request_id": str(uuid4()), "code": "print(7)", "output": ["7"]})).status_code == 200
    assert (await client.get("/api/preparation/records", headers=actors["first"])).status_code == 200


async def test_new_records_are_in_export_allowlist(client, test_db, classroom_actors):
    from app.services.research_package import EXPORT_MODELS
    assert LessonPlan in EXPORT_MODELS and PreparationRecord in EXPORT_MODELS


async def test_invalid_preparation_payload_is_bounded(client, classroom_actors):
    body = {"request_id": str(uuid4()), "kind": "run", "output": ["x" * 16001]}
    assert (await client.post("/api/preparation/records", headers=classroom_actors["first"], json=body)).status_code == 422
    body = {"request_id": str(uuid4()), "kind": "chat", "message": " ", "user_id": str(uuid4())}
    assert (await client.post("/api/preparation/records", headers=classroom_actors["first"], json=body)).status_code == 422


async def test_stage_evidence_uses_server_lesson_not_client_detail(client, test_db, classroom_actors):
    actors = classroom_actors
    task_id = await learning_task(test_db)
    session, plan = await configured(client, actors, task_id)
    await client.post(f"{ADMIN}/sessions/{session['id']}/lesson/start", headers=actors["teacher"])
    response = await client.post(f"/api/research/tasks/{task_id}/stage-events", headers=actors["first"], json={
        "request_id": str(uuid4()), "stage": "decompose", "event_type": "stage_confirm",
        "detail": {"lesson": {"lesson_id": "forged"}}, "artifacts": [],
    })
    assert response.status_code == 200, response.text
    async with test_db() as db:
        event = await db.scalar(select(StageEvent).where(StageEvent.user_id == actors["first_id"]))
        assert event.detail["lesson"]["lesson_id"] == plan["id"]
        assert event.detail["lesson"]["user_id"] == str(actors["first_id"])


async def test_current_task_ai_disable_overrides_published_allow(client, test_db, classroom_actors):
    actors = classroom_actors
    task_id = await learning_task(test_db)
    session, _ = await configured(client, actors, task_id)
    await client.post(f"{ADMIN}/sessions/{session['id']}/lesson/start", headers=actors["teacher"])
    async with test_db() as db:
        task = await db.get(ResearchTask, task_id)
        task.ai_enabled = False
        await db.commit()
    response = await client.post("/api/chat", headers=actors["first"], json={"message": "你好"})
    assert response.status_code == 403, response.text


async def test_history_projection_preserves_lesson_binding(test_db, classroom_actors):
    from app.api.endpoints.chat import get_recent_messages
    from app.models.sql.message import MessageRole
    async with test_db() as db:
        db.add(ChatMessage(user_id=classroom_actors["first_id"], role=MessageRole.USER, text="本课问题",
                           analysis={"lesson": {"lesson_id": "lesson-a"}}))
        await db.commit()
        rows = await get_recent_messages(db, classroom_actors["first_id"])
        assert rows[0]["lesson"]["lesson_id"] == "lesson-a"


async def test_entry_blueprint_honors_frozen_lesson_only_for_current_student():
    from app.services.classroom_service import lesson_evidence_context
    from app.services.research_task_service import entry_blueprint_version
    task = ResearchTask(id=uuid4(), title="蓝图", code_content="", current_blueprint_version_id=uuid4())
    user_id, original = uuid4(), uuid4()
    token = lesson_evidence_context.set({"task_id": str(task.id), "user_id": str(user_id), "blueprint_version_id": str(original)})
    try:
        assert entry_blueprint_version(task, user_id) == original
        assert entry_blueprint_version(task, uuid4()) == task.current_blueprint_version_id
    finally:
        lesson_evidence_context.reset(token)


async def test_classroom_chat_keeps_lesson_and_student_evidence(client, test_db, classroom_actors, monkeypatch):
    from types import SimpleNamespace
    from app.models.sql.message import MessageRole
    from app.schemas.chat import ChatAnalysis
    from app.schemas.profile import ProfileDelta
    actors = classroom_actors
    task_id = await learning_task(test_db)
    session, plan = await configured(client, actors, task_id)
    await client.post(f"{ADMIN}/sessions/{session['id']}/lesson/start", headers=actors["teacher"])
    async with test_db() as db:
        db.add(ChatMessage(user_id=actors["first_id"], role=MessageRole.USER, text="OLD_LESSON_MARKER",
                           analysis={"lesson": {"lesson_id": "old"}}))
        await db.commit()
    observed = []
    class Analyzer:
        async def analyze(self, **kwargs):
            observed.append(kwargs)
            return ChatAnalysis(intent="help-seeking", emotion="neutral", detectedConcepts=[],
                                delta=ProfileDelta(cognition=0, affect=0, behavior=0))
    class Graph:
        async def get_graph(self, user_id):
            return SimpleNamespace(nodes=[])
        async def calculate_cognition_from_graph(self, user_id):
            return 50
    class Provider:
        async def complete(self, **kwargs):
            return "先看当前代码。"
    monkeypatch.setattr("app.api.endpoints.chat.TextAnalyzer", Analyzer)
    monkeypatch.setattr("app.api.endpoints.chat.GraphService", Graph)
    monkeypatch.setattr("app.services.graph_service.GraphService", Graph)
    monkeypatch.setattr("app.api.endpoints.chat.get_chat_provider", Provider)
    response = await client.post("/api/chat", headers=actors["first"], json={"message": "这句为什么输出 7", "currentCode": "print(7)"})
    assert response.status_code == 200, response.text
    assert "OLD_LESSON_MARKER" not in str(observed)
    async with test_db() as db:
        messages = (await db.scalars(select(ChatMessage).where(ChatMessage.user_id == actors["first_id"]))).all()
        current = [m for m in messages if (m.analysis or {}).get("lesson", {}).get("lesson_id") == plan["id"]]
        assert len(current) == 2
        question = next(m for m in current if m.role == MessageRole.USER)
        reply = next(m for m in current if m.role == MessageRole.ASSISTANT)
        assert reply.analysis["analysis_source"] == {"role": "user", "message_id": str(question.id)}
