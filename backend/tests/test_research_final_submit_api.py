"""最终提交的原子性与幂等集成测试。

需要真实 PostgreSQL：这里验证 ``ON CONFLICT``、行锁和事务回滚，
SQLite 或假 session 无法提供有效证据。
"""
from __future__ import annotations

import asyncio
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.api.endpoints import research as research_endpoint
from app.models.sql.research import (
    ResearchTask,
    ResearchTaskStatus,
    ResearchTaskSubmission,
)
from app.models.sql.research_event import (
    ArtifactVersion,
    StageArtifact,
    StageEvent,
    StageEventType,
)


async def _create_active_task(session_factory) -> uuid.UUID:
    async with session_factory() as session:
        task = ResearchTask(
            title="贪吃蛇项目工坊",
            code_content="# starter",
            language="python",
            target_group="all",
            status=ResearchTaskStatus.ACTIVE,
        )
        session.add(task)
        await session.commit()
        await session.refresh(task)
        return task.id


def _final_body(request_id: str | None = None, code: str = "def move():\n    pass") -> dict:
    return {
        "request_id": request_id or f"final-{uuid.uuid4().hex[:16]}",
        "stage": "build",
        "code_submitted": code,
        "started_at": "2026-08-20T08:00:00Z",
        "detail": {"moduleCount": 1, "verifiedCount": 1, "codeLength": len(code)},
        "artifacts": [
            {
                "artifact_type": "module_code",
                "artifact_key": "unit-move",
                "content": {
                    "cardId": "card-move",
                    "blueprintNodeId": "move",
                    "code": code,
                    "verified": True,
                },
                "change_source": "stage_confirm",
            }
        ],
    }


async def _counts(session_factory) -> tuple[int, int, int, int]:
    async with session_factory() as session:
        return (
            await session.scalar(select(func.count(ResearchTaskSubmission.id))) or 0,
            await session.scalar(select(func.count(StageEvent.id))) or 0,
            await session.scalar(select(func.count(StageArtifact.id))) or 0,
            await session.scalar(select(func.count(ArtifactVersion.id))) or 0,
        )


@pytest.mark.asyncio
async def test_final_submit_records_event_artifact_and_completion(
    test_db, client, auth_headers, registered_user
):
    task_id = await _create_active_task(test_db)
    body = _final_body()

    response = await client.post(
        f"/api/research/tasks/{task_id}/final-submit",
        headers=auth_headers,
        json=body,
    )

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["completed"] is True
    assert data["replayed"] is False
    assert data["submitted_at"] is not None
    assert data["artifacts"][0]["version"] == 1

    async with test_db() as session:
        submission = await session.scalar(
            select(ResearchTaskSubmission).where(
                ResearchTaskSubmission.task_id == task_id,
                ResearchTaskSubmission.user_id == uuid.UUID(registered_user["user_id"]),
            )
        )
        event = await session.scalar(
            select(StageEvent).where(StageEvent.event_type == StageEventType.FINAL_SUBMIT)
        )
        assert submission is not None
        assert submission.is_completed is True
        assert submission.code_submitted == body["code_submitted"]
        assert event is not None


@pytest.mark.asyncio
async def test_final_submit_replay_does_not_duplicate_any_row(
    test_db, client, auth_headers
):
    task_id = await _create_active_task(test_db)
    body = _final_body()

    first = await client.post(
        f"/api/research/tasks/{task_id}/final-submit", headers=auth_headers, json=body
    )
    second = await client.post(
        f"/api/research/tasks/{task_id}/final-submit", headers=auth_headers, json=body
    )

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert second.json()["data"]["replayed"] is True
    assert first.json()["data"]["event_id"] == second.json()["data"]["event_id"]
    assert await _counts(test_db) == (1, 1, 1, 1)


@pytest.mark.asyncio
async def test_final_submit_reused_id_with_changed_code_is_rejected(
    test_db, client, auth_headers, registered_user
):
    task_id = await _create_active_task(test_db)
    request_id = f"final-{uuid.uuid4().hex[:16]}"
    original = _final_body(request_id=request_id, code="print('first')")
    changed = _final_body(request_id=request_id, code="print('changed')")

    first = await client.post(
        f"/api/research/tasks/{task_id}/final-submit", headers=auth_headers, json=original
    )
    second = await client.post(
        f"/api/research/tasks/{task_id}/final-submit", headers=auth_headers, json=changed
    )

    assert first.status_code == 200, first.text
    assert second.status_code == 409, second.text
    assert second.json()["detail"]["code"] == "IDEMPOTENCY_KEY_REUSED"
    assert await _counts(test_db) == (1, 1, 1, 1)

    async with test_db() as session:
        submission = await session.scalar(
            select(ResearchTaskSubmission).where(
                ResearchTaskSubmission.task_id == task_id,
                ResearchTaskSubmission.user_id == uuid.UUID(registered_user["user_id"]),
            )
        )
        assert submission is not None
        assert submission.code_submitted == original["code_submitted"]


@pytest.mark.asyncio
async def test_concurrent_identical_final_submit_is_safe(test_db, client, auth_headers):
    task_id = await _create_active_task(test_db)
    body = _final_body()

    results = await asyncio.gather(
        *[
            client.post(
                f"/api/research/tasks/{task_id}/final-submit",
                headers=auth_headers,
                json=body,
            )
            for _ in range(2)
        ],
        return_exceptions=True,
    )

    for result in results:
        assert not isinstance(result, Exception), result
        assert result.status_code == 200, result.text
    assert sorted(result.json()["data"]["replayed"] for result in results) == [False, True]
    assert await _counts(test_db) == (1, 1, 1, 1)


@pytest.mark.asyncio
async def test_final_submit_rolls_back_when_completion_write_fails(
    test_db, client, auth_headers, monkeypatch
):
    task_id = await _create_active_task(test_db)

    async def fail_completion(*args, **kwargs):
        del args, kwargs
        raise HTTPException(status_code=503, detail="simulated completion failure")

    monkeypatch.setattr(research_endpoint, "upsert_submission", fail_completion)
    response = await client.post(
        f"/api/research/tasks/{task_id}/final-submit",
        headers=auth_headers,
        json=_final_body(),
    )

    assert response.status_code == 503
    assert await _counts(test_db) == (0, 0, 0, 0)


@pytest.mark.asyncio
async def test_final_submit_rolls_back_when_event_write_fails(
    test_db, client, auth_headers, monkeypatch
):
    task_id = await _create_active_task(test_db)

    async def fail_event(*args, **kwargs):
        del args, kwargs
        raise HTTPException(status_code=503, detail="simulated event failure")

    monkeypatch.setattr(research_endpoint, "record_stage_event", fail_event)
    response = await client.post(
        f"/api/research/tasks/{task_id}/final-submit",
        headers=auth_headers,
        json=_final_body(),
    )

    assert response.status_code == 503
    assert await _counts(test_db) == (0, 0, 0, 0)


@pytest.mark.asyncio
async def test_final_submit_rejects_archived_task(test_db, client, auth_headers):
    task_id = await _create_active_task(test_db)
    async with test_db() as session:
        task = await session.get(ResearchTask, task_id)
        task.status = ResearchTaskStatus.ARCHIVED
        await session.commit()

    response = await client.post(
        f"/api/research/tasks/{task_id}/final-submit",
        headers=auth_headers,
        json=_final_body(),
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "TASK_NOT_ACTIVE"
    assert await _counts(test_db) == (0, 0, 0, 0)
