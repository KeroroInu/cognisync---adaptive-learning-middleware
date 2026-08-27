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


@pytest.mark.asyncio
async def test_transfer_module_test_and_final_submit_are_valid_evidence(
    admin_client, client, auth_headers
):
    transfer = await _create_admin_task(
        admin_client,
        task_kind="transfer_test",
        test_template="maze_treasure_v1",
    )
    await admin_client.post(f"/api/admin/research/tasks/{transfer['id']}/activate")
    artifact = {
        "artifact_type": "module_code",
        "artifact_key": "next-move",
        "content": {"title": "决定下一步", "code": "def next_move(state):\n    return 'up'"},
        "change_source": "test_revision",
    }
    tested = await client.post(
        f"/api/research/tasks/{transfer['id']}/stage-events",
        headers=auth_headers,
        json={
            "request_id": str(uuid.uuid4()),
            "stage": "transfer",
            "event_type": "module_test",
            "detail": {"passed": False, "resultCode": "HIT_WALL"},
            "artifacts": [artifact],
        },
    )
    assert tested.status_code == 200, tested.text

    submitted = await client.post(
        f"/api/research/tasks/{transfer['id']}/final-submit",
        headers=auth_headers,
        json={
            "request_id": str(uuid.uuid4()),
            "stage": "transfer",
            "code_submitted": artifact["content"]["code"],
            "detail": {"lastTestPassed": True},
            "artifacts": [{**artifact, "change_source": "stage_confirm"}],
        },
    )
    assert submitted.status_code == 200, submitted.text
    assert submitted.json()["data"]["completed"] is True
    assert submitted.json()["data"]["stage"] == "transfer"

@pytest.mark.asyncio
async def test_transfer_final_submit_rejects_unpassed_test(
    admin_client, client, auth_headers
):
    transfer = await _create_admin_task(
        admin_client,
        task_kind="transfer_test",
        test_template="maze_treasure_v1",
    )
    await admin_client.post(f"/api/admin/research/tasks/{transfer['id']}/activate")
    artifact = {
        "artifact_type": "module_code",
        "artifact_key": "next-move",
        "content": {"title": "决定下一步", "code": "def next_move(state):\n    return 'up'"},
        "change_source": "stage_confirm",
    }
    
    # Attempting to submit with lastTestPassed: False
    failed_submit = await client.post(
        f"/api/research/tasks/{transfer['id']}/final-submit",
        headers=auth_headers,
        json={
            "request_id": str(uuid.uuid4()),
            "stage": "transfer",
            "code_submitted": artifact["content"]["code"],
            "detail": {"lastTestPassed": False},
            "artifacts": [artifact],
        },
    )
    assert failed_submit.status_code == 422
    assert "must be passed" in failed_submit.json()["detail"]
    
    # Attempting to submit without lastTestPassed
    missing_submit = await client.post(
        f"/api/research/tasks/{transfer['id']}/final-submit",
        headers=auth_headers,
        json={
            "request_id": str(uuid.uuid4()),
            "stage": "transfer",
            "code_submitted": artifact["content"]["code"],
            "detail": {},
            "artifacts": [artifact],
        },
    )
    assert missing_submit.status_code == 422
    assert "must be passed" in missing_submit.json()["detail"]
