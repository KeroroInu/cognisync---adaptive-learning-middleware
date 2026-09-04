"""网页迁移任务退出当前产品后的历史兼容回归。"""
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.db.postgres import _seed_experiment_tasks
from app.models.sql.research import (
    ResearchTask,
    ResearchTaskKind,
    ResearchTaskStatus,
)


@pytest.mark.asyncio
async def test_seed_only_creates_the_learning_project(test_db):
    await _seed_experiment_tasks(test_db)
    await _seed_experiment_tasks(test_db)

    async with test_db() as session:
        tasks = (await session.execute(select(ResearchTask))).scalars().all()

    assert len(tasks) == 1
    assert tasks[0].task_kind == ResearchTaskKind.LEARNING
    assert tasks[0].title == "贪吃蛇项目工坊"


@pytest.mark.asyncio
async def test_admin_cannot_create_a_new_transfer_test(admin_client):
    response = await admin_client.post(
        "/api/admin/research/tasks",
        json={
            "title": "迷宫寻宝",
            "code_content": "def next_move(state):\n    return 'right'",
            "task_kind": "transfer_test",
            "test_template": "maze_treasure_v1",
        },
    )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_legacy_transfer_task_is_readable_but_cannot_be_activated(
    test_db,
    admin_client,
):
    async with test_db() as session:
        task = ResearchTask(
            title="历史迷宫迁移测试",
            code_content="def next_move(state):\n    return 'right'",
            language="python",
            target_group="all",
            task_kind=ResearchTaskKind.TRANSFER_TEST,
            test_template="maze_treasure_v1",
            ai_enabled=True,
            status=ResearchTaskStatus.ARCHIVED,
        )
        session.add(task)
        await session.commit()
        await session.refresh(task)
        task_id = str(task.id)

    listed = await admin_client.get("/api/admin/research/tasks")
    assert listed.status_code == 200
    assert any(item["id"] == task_id for item in listed.json()["data"]["tasks"])

    activated = await admin_client.post(f"/api/admin/research/tasks/{task_id}/activate")
    assert activated.status_code == 410
    assert activated.json()["detail"]["code"] == "TRANSFER_TEST_RETIRED"


@pytest.mark.asyncio
async def test_student_active_transfer_route_is_removed(client, auth_headers):
    response = await client.get("/api/research/active-test", headers=auth_headers)
    assert response.status_code == 404
