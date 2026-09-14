import uuid

import pytest
from httpx import AsyncClient

from test_project_blueprint_schema import blueprint_payload
from conftest import publish_test_lesson


async def register_pdt_student(client: AsyncClient, suffix: str) -> dict:
    registration = await client.post(
        "/api/auth/register",
        json={
            "student_id": f"blueprint_{suffix}_{uuid.uuid4().hex[:6]}",
            "name": f"蓝图学生{suffix}",
            "password": "testpass123",
            "mode": "scale",
        },
    )
    assert registration.status_code == 200
    data = registration.json()
    return {
        "id": data["user"]["id"],
        "headers": {"Authorization": f"Bearer {data['token']}"},
    }


@pytest.mark.asyncio
async def test_published_blueprint_is_immutable_and_frozen_per_student(
    admin_client: AsyncClient,
    client: AsyncClient,
    test_db,
):
    first_student = await register_pdt_student(client, "first")
    assign_first = await admin_client.patch(
        f"/api/admin/users/{first_student['id']}",
        json={"experiment_group": "pdt"},
    )
    assert assign_first.status_code == 200

    task_response = await admin_client.post(
        "/api/admin/research/tasks",
        json={
            "title": "版本化贪吃蛇",
            "code_content": "# project workspace",
            "language": "python",
            "target_group": "pdt",
        },
    )
    assert task_response.status_code == 200
    task_id = task_response.json()["data"]["id"]

    incomplete = blueprint_payload()
    incomplete["nodes"] = []
    draft_response = await admin_client.put(
        f"/api/admin/research/tasks/{task_id}/blueprints/draft",
        json=incomplete,
    )
    assert draft_response.status_code == 200
    draft_id = draft_response.json()["data"]["id"]
    rejected_publish = await admin_client.post(
        f"/api/admin/research/tasks/{task_id}/blueprints/{draft_id}/publish"
    )
    assert rejected_publish.status_code == 422

    v1_payload = blueprint_payload()
    save_v1 = await admin_client.put(
        f"/api/admin/research/tasks/{task_id}/blueprints/draft",
        json=v1_payload,
    )
    assert save_v1.status_code == 200
    assert save_v1.json()["data"]["id"] == draft_id
    publish_v1 = await admin_client.post(
        f"/api/admin/research/tasks/{task_id}/blueprints/{draft_id}/publish"
    )
    assert publish_v1.status_code == 200
    assert publish_v1.json()["data"]["version"] == 1
    assert publish_v1.json()["data"]["status"] == "published"

    assert (await admin_client.post(f"/api/admin/research/tasks/{task_id}/activate")).status_code == 200
    await publish_test_lesson(test_db, first_student["id"], task_id)
    first_active = await client.get(
        "/api/research/active-task",
        headers=first_student["headers"],
    )
    assert first_active.status_code == 200
    assert first_active.json()["data"]["blueprint_version_id"] == draft_id
    # 学生接口不得下发教师同义词、隐藏测试或支架内部策略。
    assert "blueprint" not in first_active.json()["data"]

    first_save = await client.post(
        f"/api/research/tasks/{task_id}/save-workspace",
        headers=first_student["headers"],
        json={"workspace_data": {"version": 1, "observations": []}},
    )
    assert first_save.status_code == 200

    mapping_response = await client.post(
        f"/api/research/tasks/{task_id}/blueprint/function-mapping-suggestions",
        headers=first_student["headers"],
        json={
            "observation_text": "蛇按照方向移动一格",
            "responsibility": "移动蛇身并更新坐标",
            "boundary_reason": "这项职责有独立的输入和输出",
            "input_text": "蛇身和方向",
            "output_text": "新蛇身",
            "knowledge": ["列表添加和删除"],
        },
    )
    assert mapping_response.status_code == 200
    mapping_data = mapping_response.json()["data"]
    assert mapping_data["blueprint_version_id"] == draft_id
    assert mapping_data["suggestions"][0]["node_id"] == "movement"
    # 学生端只获得安全建议，不泄露教师同义词、测试和前置答案。
    assert "synonyms" not in mapping_data["suggestions"][0]
    assert "tests" not in mapping_data["suggestions"][0]
    assert "prerequisiteIds" not in mapping_data["suggestions"][0]

    v2_payload = blueprint_payload()
    v2_payload["titleZh"] = "贪吃蛇项目·第二版"
    save_v2 = await admin_client.put(
        f"/api/admin/research/tasks/{task_id}/blueprints/draft",
        json=v2_payload,
    )
    assert save_v2.status_code == 200
    v2_id = save_v2.json()["data"]["id"]
    assert v2_id != draft_id
    assert save_v2.json()["data"]["version"] == 2
    assert (
        await admin_client.post(
            f"/api/admin/research/tasks/{task_id}/blueprints/{v2_id}/publish"
        )
    ).status_code == 200

    # 已产生任务记录的学生仍冻结在 v1。
    first_active_again = await client.get(
        "/api/research/active-task",
        headers=first_student["headers"],
    )
    assert first_active_again.json()["data"]["blueprint_version_id"] == draft_id

    second_student = await register_pdt_student(client, "second")
    assert (
        await admin_client.patch(
            f"/api/admin/users/{second_student['id']}",
            json={"experiment_group": "pdt"},
        )
    ).status_code == 200
    await publish_test_lesson(test_db, second_student["id"], task_id)
    second_active = await client.get(
        "/api/research/active-task",
        headers=second_student["headers"],
    )
    assert second_active.json()["data"]["blueprint_version_id"] == v2_id

    versions = await admin_client.get(
        f"/api/admin/research/tasks/{task_id}/blueprints"
    )
    assert versions.status_code == 200
    items = versions.json()["data"]["blueprints"]
    assert [item["version"] for item in items] == [2, 1]
    assert items[1]["config"]["titleZh"] == "贪吃蛇项目"

    submissions = await admin_client.get(
        f"/api/admin/research/tasks/{task_id}/submissions"
    )
    assert submissions.status_code == 200
    assert submissions.json()["data"]["submissions"][0]["blueprint_version_id"] == draft_id
