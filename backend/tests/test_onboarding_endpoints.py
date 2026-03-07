"""
入职流程 API 集成测试
测试所有 Onboarding 端点

注意：需要 PostgreSQL 测试数据库（见 conftest.py）
fixtures（client, test_user_id）由 conftest.py 提供

运行方式:
  cd backend
  pytest tests/test_onboarding_endpoints.py -v
"""
import pytest
from httpx import AsyncClient
from uuid import uuid4


@pytest.mark.asyncio
async def test_create_onboarding_session(client: AsyncClient, test_user_id: str):
    """测试创建入职会话"""
    response = await client.post(
        "/api/onboarding",
        json={
            "user_id": test_user_id,
            "mode": "scale",
            "raw_transcript": "用户：你好\n系统：欢迎使用",
            "extracted_json": {"interests": ["math", "science"]},
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["user_id"] == test_user_id
    assert data["mode"] == "scale"
    assert "id" in data
    assert "created_at" in data

    print(f"\n✅ Create onboarding session test passed: id={data['id'][:8]}...")


@pytest.mark.asyncio
async def test_get_onboarding_session(client: AsyncClient, test_user_id: str):
    """测试获取入职会话详情"""
    # 先创建一个会话
    create_response = await client.post(
        "/api/onboarding",
        json={
            "user_id": test_user_id,
            "mode": "ai",
            "raw_transcript": "测试对话",
        },
    )
    assert create_response.status_code == 200
    session_id = create_response.json()["id"]

    # 获取会话详情
    response = await client.get(f"/api/onboarding/{session_id}")

    assert response.status_code == 200
    data = response.json()
    assert data["id"] == session_id
    assert data["mode"] == "ai"

    print(f"\n✅ Get onboarding session test passed: id={session_id[:8]}...")


@pytest.mark.asyncio
async def test_update_onboarding_session(client: AsyncClient, test_user_id: str):
    """测试更新入职会话"""
    # 先创建一个会话
    create_response = await client.post(
        "/api/onboarding",
        json={
            "user_id": test_user_id,
            "mode": "scale",
        },
    )
    assert create_response.status_code == 200
    session_id = create_response.json()["id"]

    # 更新会话
    response = await client.patch(
        f"/api/onboarding/{session_id}",
        json={
            "raw_transcript": "更新后的对话",
            "extracted_json": {"skills": ["programming"]},
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["raw_transcript"] == "更新后的对话"
    assert data["extracted_json"]["skills"] == ["programming"]

    print(f"\n✅ Update onboarding session test passed")


@pytest.mark.asyncio
async def test_get_user_onboarding_sessions(client: AsyncClient, test_user_id: str):
    """测试获取用户的入职会话列表"""
    # 创建多个会话
    for i in range(3):
        await client.post(
            "/api/onboarding",
            json={
                "user_id": test_user_id,
                "mode": "scale" if i % 2 == 0 else "ai",
            },
        )

    # 获取会话列表
    response = await client.get(
        f"/api/onboarding/user/{test_user_id}",
        params={"page": 1, "page_size": 10},
    )

    assert response.status_code == 200
    data = response.json()
    assert "sessions" in data
    assert "total" in data
    assert data["total"] >= 3
    assert len(data["sessions"]) >= 3

    print(f"\n✅ Get user onboarding sessions test passed: total={data['total']}")


@pytest.mark.asyncio
async def test_delete_onboarding_session(client: AsyncClient, test_user_id: str):
    """测试删除入职会话"""
    # 先创建一个会话
    create_response = await client.post(
        "/api/onboarding",
        json={
            "user_id": test_user_id,
            "mode": "scale",
        },
    )
    assert create_response.status_code == 200
    session_id = create_response.json()["id"]

    # 删除会话
    response = await client.delete(f"/api/onboarding/{session_id}")

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True

    # 验证已删除
    get_response = await client.get(f"/api/onboarding/{session_id}")
    assert get_response.status_code == 404

    print(f"\n✅ Delete onboarding session test passed")


@pytest.mark.asyncio
async def test_get_nonexistent_session(client: AsyncClient):
    """测试获取不存在的会话返回 404"""
    fake_id = str(uuid4())
    response = await client.get(f"/api/onboarding/{fake_id}")

    assert response.status_code == 404

    print(f"\n✅ Get nonexistent session test passed")
