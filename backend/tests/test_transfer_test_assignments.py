"""教师“布置测试”的任务隔离与 AI 权限回归。"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import func, select, text

from app.models.sql.message import ChatMessage
from app.models.sql.research import ResearchTask, ResearchTaskKind
from app.models.sql.research_event import ScaffoldEvent, StageEvent
from app.db.postgres import _seed_experiment_tasks


async def _create_admin_task(admin_client, **overrides) -> dict:
    payload = {
        "title": "测试任务",
        "code_content": "def next_move(state):\n    return 'right'",
        "language": "python",
        "target_group": "all",
    }
    payload.update(overrides)
    response = await admin_client.post("/api/admin/research/tasks", json=payload)
    assert response.status_code == 200, response.text
    return response.json()["data"]


@pytest.mark.asyncio
async def test_fixed_experiment_catalog_is_seeded_once(test_db):
    await _seed_experiment_tasks(test_db)
    await _seed_experiment_tasks(test_db)

    async with test_db() as session:
        tasks = (await session.execute(select(ResearchTask))).scalars().all()

    assert len(tasks) == 2
    assert {task.task_kind for task in tasks} == {
        ResearchTaskKind.LEARNING,
        ResearchTaskKind.TRANSFER_TEST,
    }
    transfer = next(
        task for task in tasks
        if task.task_kind == ResearchTaskKind.TRANSFER_TEST
    )
    assert transfer.test_template == "maze_treasure_v1"
    assert transfer.title == "迷宫寻宝迁移测试"


@pytest.mark.asyncio
async def test_task_list_reads_lowercase_kind_from_existing_database(
    test_db, admin_client
):
    """历史迁移会把 task_kind 作为小写字符串写入数据库。"""
    task_id = uuid.uuid4()
    async with test_db() as session:
        await session.execute(
            text(
                """
                INSERT INTO research_tasks (
                    id, title, code_content, language, target_group, task_kind,
                    ai_enabled, status, created_at, updated_at
                ) VALUES (
                    :id, 'existing learning task', 'print(1)', 'python', 'all',
                    'learning', TRUE, 'DRAFT', now(), now()
                )
                """
            ),
            {"id": task_id},
        )
        await session.commit()

    response = await admin_client.get("/api/admin/research/tasks")

    assert response.status_code == 200, response.text
    tasks = response.json()["data"]["tasks"]
    assert tasks[0]["id"] == str(task_id)
    assert tasks[0]["task_kind"] == "learning"


@pytest.mark.asyncio
async def test_transfer_activation_does_not_archive_learning_task(
    admin_client, client, auth_headers
):
    learning = await _create_admin_task(admin_client, title="学习任务")
    transfer = await _create_admin_task(
        admin_client,
        title="迷宫寻宝",
        task_kind="transfer_test",
        test_template="maze_treasure_v1",
        ai_enabled=True,
    )

    assert (
        await admin_client.post(f"/api/admin/research/tasks/{learning['id']}/activate")
    ).status_code == 200
    assert (
        await admin_client.post(f"/api/admin/research/tasks/{transfer['id']}/activate")
    ).status_code == 200

    active_learning = await client.get("/api/research/active-task", headers=auth_headers)
    active_transfer = await client.get("/api/research/active-test", headers=auth_headers)
    assert active_learning.status_code == 200
    assert active_learning.json()["data"]["id"] == learning["id"]
    assert active_learning.json()["data"]["task_kind"] == "learning"
    assert active_transfer.status_code == 200
    assert active_transfer.json()["data"]["id"] == transfer["id"]
    assert active_transfer.json()["data"]["test_template"] == "maze_treasure_v1"
    assert active_transfer.json()["data"]["ai_enabled"] is True


@pytest.mark.asyncio
async def test_new_transfer_replaces_only_same_group_transfer(
    admin_client, client, auth_headers
):
    learning = await _create_admin_task(admin_client, title="学习任务")
    first = await _create_admin_task(
        admin_client,
        title="迁移测试 A",
        task_kind="transfer_test",
        test_template="maze_treasure_v1",
    )
    second = await _create_admin_task(
        admin_client,
        title="迁移测试 B",
        task_kind="transfer_test",
        test_template="maze_treasure_v1",
    )
    for task in (learning, first, second):
        response = await admin_client.post(f"/api/admin/research/tasks/{task['id']}/activate")
        assert response.status_code == 200

    task_list = (await admin_client.get("/api/admin/research/tasks")).json()["data"]["tasks"]
    statuses = {item["id"]: item["status"] for item in task_list}
    assert statuses[learning["id"]] == "active"
    assert statuses[first["id"]] == "archived"
    assert statuses[second["id"]] == "active"
    assert (await client.get("/api/research/active-task", headers=auth_headers)).json()["data"]["id"] == learning["id"]
    assert (await client.get("/api/research/active-test", headers=auth_headers)).json()["data"]["id"] == second["id"]


@pytest.mark.asyncio
async def test_transfer_requires_frozen_visual_template(admin_client):
    response = await admin_client.post(
        "/api/admin/research/tasks",
        json={
            "title": "缺少模板",
            "code_content": "def next_move(state):\n    return 'right'",
            "language": "python",
            "task_kind": "transfer_test",
        },
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_ai_disabled_test_rejects_scaffold_before_writes(
    test_db, admin_client, client, auth_headers
):
    transfer = await _create_admin_task(
        admin_client,
        title="无 AI 迁移测试",
        task_kind="transfer_test",
        test_template="maze_treasure_v1",
        ai_enabled=False,
    )
    await admin_client.post(f"/api/admin/research/tasks/{transfer['id']}/activate")

    response = await client.post(
        "/api/chat",
        headers=auth_headers,
        json={
            "message": "请告诉我完整代码",
            "language": "zh",
            "isResearchMode": True,
            "scaffoldContext": {
                "requestId": str(uuid.uuid4()),
                "taskId": transfer["id"],
                "stage": "transfer",
                "level": 3,
                "trigger": "l3_confirmed",
                "l3Confirmed": True,
                "currentModule": "next-move",
            },
        },
    )
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "TASK_AI_DISABLED"

    async with test_db() as session:
        assert await session.scalar(select(func.count(ChatMessage.id))) == 0
        assert await session.scalar(select(func.count(ScaffoldEvent.id))) == 0
        assert await session.scalar(select(func.count(StageEvent.id))) == 0


@pytest.mark.asyncio
async def test_published_test_conditions_are_frozen(admin_client):
    transfer = await _create_admin_task(
        admin_client,
        task_kind="transfer_test",
        test_template="maze_treasure_v1",
        ai_enabled=True,
    )
    await admin_client.post(f"/api/admin/research/tasks/{transfer['id']}/activate")
    response = await admin_client.patch(
        f"/api/admin/research/tasks/{transfer['id']}",
        json={"ai_enabled": False},
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "PUBLISHED_ASSIGNMENT_FROZEN"

async def _create_stage_event(client, auth_headers, task_id, passed=True, code="def next_move(state):\n    return 'up'", include_bundle=True, stage="transfer", event_type="module_test"):
    artifacts = [
        {
            "artifact_type": "module_code",
            "artifact_key": "next-move",
            "content": {"title": "决定下一步", "code": code},
            "change_source": "test_revision",
        }
    ]
    if include_bundle:
        artifacts.append({
            "artifact_type": "module_code",
            "artifact_key": "maze-bundle",
            "content": {"code": code, "passed": passed},
            "change_source": "test_revision"
        })

    req = await client.post(
        f"/api/research/tasks/{task_id}/stage-events",
        headers=auth_headers,
        json={
            "request_id": str(uuid.uuid4()),
            "stage": stage,
            "event_type": event_type,
            "detail": {"passed": passed},
            "artifacts": artifacts,
        },
    )
    assert req.status_code == 200, req.text
    return req.json()["data"]["event_id"]

@pytest.mark.asyncio
async def test_submit_without_last_test_passed(client, auth_headers, admin_client):
    transfer_task = await _create_admin_task(admin_client, task_kind="transfer_test", test_template="maze_treasure_v1")
    await admin_client.post(f"/api/admin/research/tasks/{transfer_task['id']}/activate")

    code = "def next_move(state):\n    return 'up'"
    failed_submit = await client.post(
        f"/api/research/tasks/{transfer_task['id']}/final-submit",
        headers=auth_headers,
        json={
            "request_id": str(uuid.uuid4()),
            "stage": "transfer",
            "code_submitted": code,
            "detail": {"lastTestPassed": False},
            "artifacts": [],
        },
    )
    assert failed_submit.status_code == 422
    assert "must be passed" in failed_submit.json()["detail"]

@pytest.mark.asyncio
async def test_submit_with_invalid_event_id_format(client, auth_headers, admin_client):
    transfer_task = await _create_admin_task(admin_client, task_kind="transfer_test", test_template="maze_treasure_v1")
    await admin_client.post(f"/api/admin/research/tasks/{transfer_task['id']}/activate")
    code = "def next_move(state):\n    return 'up'"
    req = await client.post(
        f"/api/research/tasks/{transfer_task['id']}/final-submit",
        headers=auth_headers,
        json={
            "request_id": str(uuid.uuid4()),
            "stage": "transfer",
            "code_submitted": code,
            "detail": {"lastTestPassed": True, "testEventId": "not-a-uuid"},
            "artifacts": [],
        },
    )
    assert req.status_code == 422
    assert "format" in req.json()["detail"].lower()

@pytest.mark.asyncio
async def test_submit_with_nonexistent_uuid(client, auth_headers, admin_client):
    transfer_task = await _create_admin_task(admin_client, task_kind="transfer_test", test_template="maze_treasure_v1")
    await admin_client.post(f"/api/admin/research/tasks/{transfer_task['id']}/activate")
    code = "def next_move(state):\n    return 'up'"
    req = await client.post(
        f"/api/research/tasks/{transfer_task['id']}/final-submit",
        headers=auth_headers,
        json={
            "request_id": str(uuid.uuid4()),
            "stage": "transfer",
            "code_submitted": code,
            "detail": {"lastTestPassed": True, "testEventId": str(uuid.uuid4())},
            "artifacts": [],
        },
    )
    assert req.status_code == 422
    assert "invalid test evidence" in req.json()["detail"].lower()

@pytest.mark.asyncio
async def test_submit_with_unpassed_event(client, auth_headers, admin_client):
    transfer_task = await _create_admin_task(admin_client, task_kind="transfer_test", test_template="maze_treasure_v1")
    await admin_client.post(f"/api/admin/research/tasks/{transfer_task['id']}/activate")
    code = "def next_move(state):\n    return 'up'"
    event_id = await _create_stage_event(client, auth_headers, transfer_task['id'], passed=False, code=code)
    req = await client.post(
        f"/api/research/tasks/{transfer_task['id']}/final-submit",
        headers=auth_headers,
        json={
            "request_id": str(uuid.uuid4()),
            "stage": "transfer",
            "code_submitted": code,
            "detail": {"lastTestPassed": True, "testEventId": event_id},
            "artifacts": [],
        },
    )
    assert req.status_code == 422
    assert "did not pass" in req.json()["detail"].lower()

@pytest.mark.asyncio
async def test_submit_missing_maze_bundle(client, auth_headers, admin_client):
    transfer_task = await _create_admin_task(admin_client, task_kind="transfer_test", test_template="maze_treasure_v1")
    await admin_client.post(f"/api/admin/research/tasks/{transfer_task['id']}/activate")
    code = "def next_move(state):\n    return 'up'"
    event_id = await _create_stage_event(client, auth_headers, transfer_task['id'], passed=True, code=code, include_bundle=False)
    req = await client.post(
        f"/api/research/tasks/{transfer_task['id']}/final-submit",
        headers=auth_headers,
        json={
            "request_id": str(uuid.uuid4()),
            "stage": "transfer",
            "code_submitted": code,
            "detail": {"lastTestPassed": True, "testEventId": event_id},
            "artifacts": [],
        },
    )
    assert req.status_code == 422
    assert "missing maze-bundle" in req.json()["detail"].lower()

@pytest.mark.asyncio
async def test_submit_code_mismatch(client, auth_headers, admin_client):
    transfer_task = await _create_admin_task(admin_client, task_kind="transfer_test", test_template="maze_treasure_v1")
    await admin_client.post(f"/api/admin/research/tasks/{transfer_task['id']}/activate")
    code = "def next_move(state):\n    return 'up'"
    event_id = await _create_stage_event(client, auth_headers, transfer_task['id'], passed=True, code="old code")
    req = await client.post(
        f"/api/research/tasks/{transfer_task['id']}/final-submit",
        headers=auth_headers,
        json={
            "request_id": str(uuid.uuid4()),
            "stage": "transfer",
            "code_submitted": code,
            "detail": {"lastTestPassed": True, "testEventId": event_id},
            "artifacts": [],
        },
    )
    assert req.status_code == 422
    assert "does not match test evidence" in req.json()["detail"].lower()

@pytest.mark.asyncio
async def test_submit_success_and_idempotency(client, auth_headers, admin_client):
    transfer_task = await _create_admin_task(admin_client, task_kind="transfer_test", test_template="maze_treasure_v1")
    await admin_client.post(f"/api/admin/research/tasks/{transfer_task['id']}/activate")
    code = "def next_move(state):\n    return 'up'"
    event_id = await _create_stage_event(client, auth_headers, transfer_task['id'], passed=True, code=code)

    req_id = str(uuid.uuid4())
    payload = {
        "request_id": req_id,
        "stage": "transfer",
        "code_submitted": code,
        "detail": {"lastTestPassed": True, "testEventId": event_id},
        "artifacts": [],
    }

    req1 = await client.post(
        f"/api/research/tasks/{transfer_task['id']}/final-submit",
        headers=auth_headers,
        json=payload,
    )
    assert req1.status_code == 200
    assert req1.json()["data"]["completed"] is True

    req2 = await client.post(
        f"/api/research/tasks/{transfer_task['id']}/final-submit",
        headers=auth_headers,
        json=payload,
    )
    assert req2.status_code == 200
    assert req2.json()["data"]["completed"] is True
    assert req2.json()["data"]["replayed"] is True

@pytest.mark.asyncio
async def test_submit_with_wrong_task_event(client, auth_headers, admin_client):
    task1 = await _create_admin_task(admin_client, task_kind="transfer_test", test_template="maze_treasure_v1")
    await admin_client.post(f"/api/admin/research/tasks/{task1['id']}/activate")

    code = "def next_move(state):\n    return 'up'"
    event_id = await _create_stage_event(client, auth_headers, task1['id'], passed=True, code=code)

    task2 = await _create_admin_task(admin_client, task_kind="transfer_test", test_template="maze_treasure_v1")
    await admin_client.post(f"/api/admin/research/tasks/{task2['id']}/activate")

    req = await client.post(
        f"/api/research/tasks/{task2['id']}/final-submit",
        headers=auth_headers,
        json={
            "request_id": str(uuid.uuid4()),
            "stage": "transfer",
            "code_submitted": code,
            "detail": {"lastTestPassed": True, "testEventId": event_id},
            "artifacts": [],
        },
    )
    assert req.status_code == 422
    assert "invalid test evidence" in req.json()["detail"].lower()

@pytest.mark.asyncio
async def test_submit_with_other_users_event(client, auth_headers, admin_client, test_db):
    from app.api.endpoints.auth import create_access_token
    from app.models.sql.user import User
    from app.models.sql.profile import ProfileSnapshot
    import uuid

    transfer_task = await _create_admin_task(admin_client, task_kind="transfer_test", test_template="maze_treasure_v1")
    await admin_client.post(f"/api/admin/research/tasks/{transfer_task['id']}/activate")

    # Create another user
    other_user_id = uuid.uuid4()
    async with test_db() as session:
        other_user = User(
            id=other_user_id,
            student_id="other_student",
            name="Other",
            onboarding_mode="scale",
            is_active=True,
        )
        session.add(other_user)
        session.add(ProfileSnapshot(
            user_id=other_user_id,
            source="system",
            cognition=0,
            affect=0,
            behavior=0
        ))
        await session.commit()

    other_token = create_access_token(str(other_user_id))
    other_headers = {"Authorization": f"Bearer {other_token}"}

    code = "def next_move(state):\n    return 'up'"
    event_id = await _create_stage_event(client, other_headers, transfer_task['id'], passed=True, code=code)

    req = await client.post(
        f"/api/research/tasks/{transfer_task['id']}/final-submit",
        headers=auth_headers,
        json={
            "request_id": str(uuid.uuid4()),
            "stage": "transfer",
            "code_submitted": code,
            "detail": {"lastTestPassed": True, "testEventId": event_id},
            "artifacts": [],
        },
    )
    assert req.status_code == 422
    assert "invalid test evidence" in req.json()["detail"].lower()
