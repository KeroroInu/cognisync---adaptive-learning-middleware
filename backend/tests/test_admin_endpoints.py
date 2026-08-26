"""
Admin API 端点集成测试
测试所有 Admin FastAPI 端点的完整流程

注意：需要 PostgreSQL 测试数据库（见 conftest.py）

运行方式:
  cd backend
  pytest tests/test_admin_endpoints.py -v
"""
import pytest
from httpx import AsyncClient


# ==================== 鉴权测试 ====================


@pytest.mark.asyncio
async def test_admin_auth_no_key(client: AsyncClient):
    """测试 1: 未登录时返回 401"""
    response = await client.get("/api/admin/overview")
    assert response.status_code == 401

    print(f"\n✅ Admin auth (no key) test passed: {response.status_code}")


@pytest.mark.asyncio
async def test_admin_auth_invalid_key(client: AsyncClient):
    """测试 2: 提供无效 Bearer token 时返回 401"""
    response = await client.get(
        "/api/admin/overview",
        headers={"Authorization": "Bearer wrong-token"},
    )
    assert response.status_code == 401

    print(f"\n✅ Admin auth (invalid key) test passed: {response.status_code}")


@pytest.mark.asyncio
async def test_admin_auth_valid_key(admin_client: AsyncClient):
    """测试 3: 提供正确 Admin Key 时返回成功"""
    response = await admin_client.get("/api/admin/overview")
    assert response.status_code == 200

    print(f"\n✅ Admin auth (valid key) test passed: {response.status_code}")


# ==================== 概览统计测试 ====================


@pytest.mark.asyncio
async def test_admin_overview_empty(admin_client: AsyncClient):
    """
    测试 4: GET /api/admin/overview
    空数据库时统计数量均为 0
    """
    response = await admin_client.get("/api/admin/overview")
    assert response.status_code == 200

    data = response.json()
    assert data["success"] is True
    stats = data["data"]

    # 验证字段存在
    assert "users_count" in stats
    assert "sessions_count" in stats
    assert "messages_count" in stats
    assert "templates_count" in stats
    assert "responses_count" in stats

    # 空数据库时均为 0
    assert stats["users_count"] == 0
    assert stats["messages_count"] == 0

    print(f"\n✅ Admin overview (empty) test passed: {stats}")


@pytest.mark.asyncio
async def test_admin_overview_with_data(
    admin_client: AsyncClient, client: AsyncClient
):
    """
    测试 5: GET /api/admin/overview
    注册用户后统计数据应增加
    """
    await client.post(
        "/api/auth/register",
        json={
            "student_id": "overview_test_001",
            "name": "概览测试用户",
            "password": "testpass123",
            "mode": "scale",
        },
    )

    response = await admin_client.get("/api/admin/overview")
    assert response.status_code == 200

    data = response.json()
    stats = data["data"]
    assert stats["users_count"] >= 1

    print(f"\n✅ Admin overview (with data) test passed: {stats}")


# ==================== 用户管理测试 ====================


@pytest.mark.asyncio
async def test_list_users_empty(admin_client: AsyncClient):
    """
    测试 6: GET /api/admin/users
    空数据库时返回空列表
    """
    response = await admin_client.get("/api/admin/users?page=1&page_size=10")
    assert response.status_code == 200

    data = response.json()
    assert data["success"] is True
    assert "users" in data["data"]
    assert "total" in data["data"]
    assert data["data"]["total"] == 0
    assert isinstance(data["data"]["users"], list)

    print("\n✅ List users (empty) test passed")


@pytest.mark.asyncio
async def test_list_users_with_data(
    admin_client: AsyncClient, client: AsyncClient
):
    """
    测试 7: GET /api/admin/users
    注册用户后列表中应包含用户，并验证字段结构
    """
    for i in range(2):
        await client.post(
            "/api/auth/register",
            json={
                "student_id": f"list_test_{i:03d}",
                "name": f"列表测试用户{i}",
                "password": "testpass123",
                "mode": "scale",
            },
        )

    response = await admin_client.get("/api/admin/users?page=1&page_size=10")
    assert response.status_code == 200

    data = response.json()
    users = data["data"]["users"]
    assert len(users) >= 2
    assert data["data"]["total"] >= 2

    # 验证 UserSummary 字段结构（当前字段名）
    first_user = users[0]
    assert "id" in first_user
    assert "student_id" in first_user
    assert "name" in first_user
    assert "created_at" in first_user
    assert "message_count" in first_user

    # 确认无密码字段泄露
    assert "password_hash" not in first_user
    assert "password" not in first_user

    print(
        f"\n✅ List users (with data) test passed: "
        f"{len(users)} users, total={data['data']['total']}"
    )


@pytest.mark.asyncio
async def test_list_users_pagination(admin_client: AsyncClient, client: AsyncClient):
    """测试 8: 用户列表分页功能"""
    for i in range(3):
        await client.post(
            "/api/auth/register",
            json={
                "student_id": f"page_test_{i:03d}",
                "name": f"分页测试用户{i}",
                "password": "testpass123",
                "mode": "scale",
            },
        )

    response = await admin_client.get("/api/admin/users?page=1&page_size=1")
    assert response.status_code == 200

    data = response.json()
    assert len(data["data"]["users"]) == 1
    assert data["data"]["total"] >= 3

    print("\n✅ User pagination test passed")


# ==================== 数据分析测试 ====================


@pytest.mark.asyncio
async def test_analytics_overview(admin_client: AsyncClient):
    """
    测试 9: GET /api/admin/analytics/overview
    获取系统分析概览
    """
    response = await admin_client.get("/api/admin/analytics/overview")
    assert response.status_code == 200

    data = response.json()
    assert data["success"] is True

    overview = data["data"]["overview"]
    assert "totalUsers" in overview
    assert "totalMessages" in overview

    print(
        f"\n✅ Analytics overview test passed: "
        f"users={overview['totalUsers']}, messages={overview['totalMessages']}"
    )


@pytest.mark.asyncio
async def test_experiment_group_assignment_and_task_isolation(
    admin_client: AsyncClient, client: AsyncClient
):
    """管理员分组后，学生只能看到并提交所在实验组的任务。"""
    registration = await client.post(
        "/api/auth/register",
        json={
            "student_id": "group_test_001",
            "name": "分组测试学生",
            "password": "testpass123",
            "mode": "scale",
            "className": "高二1班",
        },
    )
    assert registration.status_code == 200
    registered = registration.json()
    user_id = registered["user"]["id"]
    auth = {"Authorization": f"Bearer {registered['token']}"}

    assigned = await admin_client.patch(
        f"/api/admin/users/{user_id}",
        json={"class_name": "高二1班", "experiment_group": "pdt"},
    )
    assert assigned.status_code == 200
    assert assigned.json()["data"]["experiment_group"] == "pdt"

    detail = await admin_client.get(f"/api/admin/users/{user_id}")
    assert detail.status_code == 200
    assert detail.json()["data"]["class_name"] == "高二1班"
    assert detail.json()["data"]["experiment_group"] == "pdt"

    async def create_task(title: str, target_group: str) -> str:
        response = await admin_client.post(
            "/api/admin/research/tasks",
            json={
                "title": title,
                "code_content": "print('hello')",
                "language": "python",
                "target_group": target_group,
            },
        )
        assert response.status_code == 200
        return response.json()["data"]["id"]

    pdt_task_id = await create_task("PDT 任务", "pdt")
    lecture_task_id = await create_task("讲授组任务", "lecture")
    assert (await admin_client.post(f"/api/admin/research/tasks/{pdt_task_id}/activate")).status_code == 200
    assert (await admin_client.post(f"/api/admin/research/tasks/{lecture_task_id}/activate")).status_code == 200

    active = await client.get("/api/research/active-task", headers=auth)
    assert active.status_code == 200
    assert active.json()["data"]["id"] == pdt_task_id
    assert active.json()["data"]["target_group"] == "pdt"

    workspace = {
        "version": 1,
        "savedAt": "2026-01-01T00:00:00Z",
        "evidence": [],
        "observations": [{"id": "o1", "observationText": "蛇向右移动"}],
        "functions": [{"id": "f1", "responsibility": "移动蛇身"}],
        "path": {"orderedCardIds": ["f1"], "prerequisites": {}, "relationKinds": {}},
        "progress": {},
    }
    workspace_save = await client.post(
        f"/api/research/tasks/{pdt_task_id}/save-workspace",
        json={"workspace_data": workspace},
        headers=auth,
    )
    assert workspace_save.status_code == 200

    restored = await client.get("/api/research/active-task", headers=auth)
    assert restored.status_code == 200
    assert restored.json()["data"]["workspace_data"] == workspace

    forbidden_save = await client.post(
        f"/api/research/tasks/{lecture_task_id}/save-progress",
        json={"code_submitted": "print('not allowed')"},
        headers=auth,
    )
    assert forbidden_save.status_code == 404


# ==================== 完整 Admin 工作流测试 ====================


@pytest.mark.asyncio
async def test_complete_admin_workflow(admin_client: AsyncClient, client: AsyncClient):
    """
    测试 13: 完整 Admin 工作流程
    注册用户 → 查看概览 → 查看用户列表
    """
    for i in range(2):
        await client.post(
            "/api/auth/register",
            json={
                "student_id": f"admin_wf_{i:03d}",
                "name": f"工作流测试用户{i}",
                "password": "testpass123",
                "mode": "scale",
            },
        )

    # 1. 查看系统概览
    overview_response = await admin_client.get("/api/admin/overview")
    assert overview_response.status_code == 200
    overview = overview_response.json()["data"]
    assert overview["users_count"] >= 2

    # 2. 查看用户列表
    users_response = await admin_client.get("/api/admin/users?page=1&page_size=10")
    assert users_response.status_code == 200
    users = users_response.json()["data"]["users"]
    assert len(users) >= 2

    print(
        f"\n✅ Complete admin workflow test passed: "
        f"users={overview['users_count']}"
    )


if __name__ == "__main__":
    import sys
    import pytest as _pytest

    _pytest.main([__file__, "-v", "-s"] + sys.argv[1:])
