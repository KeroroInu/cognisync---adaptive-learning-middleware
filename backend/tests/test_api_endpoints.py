"""
API 端点集成测试
测试所有 FastAPI 端点的完整流程

注意：需要 PostgreSQL 测试数据库（见 conftest.py）

运行方式:
  cd backend
  pytest tests/test_api_endpoints.py -v
"""
import pytest
from httpx import AsyncClient


# ==================== 认证测试 ====================


@pytest.mark.asyncio
async def test_auth_register(client: AsyncClient):
    """测试 POST /api/auth/register - 用户注册"""
    response = await client.post(
        "/api/auth/register",
        json={
            "student_id": "reg_test_001",
            "name": "注册测试用户",
            "password": "testpass123",
            "mode": "scale",
        },
    )
    assert response.status_code == 200

    data = response.json()
    assert "token" in data
    assert "user" in data
    assert data["user"]["student_id"] == "reg_test_001"
    assert data["user"]["name"] == "注册测试用户"

    print(f"\n✅ Register test passed: user_id={data['user']['id']}")


@pytest.mark.asyncio
async def test_auth_register_duplicate_student_id(client: AsyncClient):
    """测试重复学号注册时返回 400"""
    payload = {
        "student_id": "dup_test_001",
        "name": "用户甲",
        "password": "testpass123",
        "mode": "scale",
    }
    r1 = await client.post("/api/auth/register", json=payload)
    assert r1.status_code == 200

    payload2 = {**payload, "name": "用户乙"}
    r2 = await client.post("/api/auth/register", json=payload2)
    assert r2.status_code == 400

    print(f"\n✅ Duplicate register test passed")


@pytest.mark.asyncio
async def test_auth_login(client: AsyncClient, registered_user: dict):
    """测试 POST /api/auth/login - 用学号登录"""
    response = await client.post(
        "/api/auth/login",
        json={
            "student_id": registered_user["student_id"],
            "password": registered_user["password"],
        },
    )
    assert response.status_code == 200

    data = response.json()
    assert "token" in data
    assert "user" in data
    assert data["user"]["student_id"] == registered_user["student_id"]

    print(f"\n✅ Login test passed")


@pytest.mark.asyncio
async def test_auth_login_wrong_password(client: AsyncClient, registered_user: dict):
    """测试错误密码时返回 401"""
    response = await client.post(
        "/api/auth/login",
        json={
            "student_id": registered_user["student_id"],
            "password": "wrongpassword!",
        },
    )
    assert response.status_code == 401

    print(f"\n✅ Login (wrong password) test passed")


@pytest.mark.asyncio
async def test_auth_me(client: AsyncClient, registered_user: dict, auth_headers: dict):
    """测试 GET /api/auth/me - 获取当前用户信息（需要 JWT）"""
    response = await client.get("/api/auth/me", headers=auth_headers)
    assert response.status_code == 200

    data = response.json()
    assert data["success"] is True
    user = data["data"]["user"]
    assert user["student_id"] == registered_user["student_id"]

    print(f"\n✅ Me test passed: {user['name']}")


@pytest.mark.asyncio
async def test_auth_me_no_token(client: AsyncClient):
    """测试无 token 时 /api/auth/me 返回 401"""
    response = await client.get("/api/auth/me")
    assert response.status_code == 401

    print(f"\n✅ Me (no token) test passed")


# ==================== 聊天测试 ====================


@pytest.mark.asyncio
async def test_chat_endpoint(
    client: AsyncClient, auth_headers: dict, registered_user: dict
):
    """
    测试 POST /api/chat
    发送聊天消息并验证响应（需要 JWT 认证）
    """
    response = await client.post(
        "/api/chat",
        json={
            "message": "我对神经网络的反向传播不太理解",
            "language": "zh",
            "isResearchMode": False,
        },
        headers=auth_headers,
    )
    assert response.status_code == 200

    data = response.json()
    assert data["success"] is True

    chat_response = data["data"]
    assert "message" in chat_response
    assert "analysis" in chat_response
    assert "updatedProfile" in chat_response

    # 验证分析结果结构
    analysis = chat_response["analysis"]
    assert "intent" in analysis
    assert "emotion" in analysis
    assert "detectedConcepts" in analysis
    assert "delta" in analysis

    # 验证画像值域 0-100
    profile = chat_response["updatedProfile"]
    assert 0 <= profile["cognition"] <= 100
    assert 0 <= profile["affect"] <= 100
    assert 0 <= profile["behavior"] <= 100

    print(
        f"\n✅ Chat test passed: intent={analysis['intent']}, emotion={analysis['emotion']}"
    )


@pytest.mark.asyncio
async def test_chat_requires_auth(client: AsyncClient):
    """测试未提供 JWT 时 /api/chat 返回 401"""
    response = await client.post(
        "/api/chat",
        json={"message": "测试", "language": "zh"},
    )
    assert response.status_code == 401

    print(f"\n✅ Chat (no auth) test passed")


# ==================== 画像测试 ====================


@pytest.mark.asyncio
async def test_get_profile(client: AsyncClient, registered_user: dict):
    """
    测试 GET /api/profile/{userId}
    获取用户画像（注册时已创建初始画像 50/50/50）
    """
    user_id = registered_user["user_id"]
    response = await client.get(f"/api/profile/{user_id}")
    assert response.status_code == 200

    data = response.json()
    assert data["success"] is True

    profile = data["data"]
    assert 0 <= profile["cognition"] <= 100
    assert 0 <= profile["affect"] <= 100
    assert 0 <= profile["behavior"] <= 100
    assert "lastUpdate" in profile

    print(f"\n✅ Profile test passed: {profile}")


# ==================== 完整流程测试 ====================


@pytest.mark.asyncio
async def test_complete_auth_and_chat_flow(client: AsyncClient):
    """
    测试完整用户流程：注册 → 聊天 → 获取画像 → 获取日志
    """
    # 1. 注册
    reg_response = await client.post(
        "/api/auth/register",
        json={
            "student_id": "flow_test_001",
            "name": "流程测试用户",
            "password": "flowpass123",
            "mode": "ai",
        },
    )
    assert reg_response.status_code == 200
    token = reg_response.json()["token"]
    user_id = reg_response.json()["user"]["id"]
    auth = {"Authorization": f"Bearer {token}"}

    # 2. 发送聊天消息
    chat_response = await client.post(
        "/api/chat",
        json={"message": "我想学习深度学习", "language": "zh"},
        headers=auth,
    )
    assert chat_response.status_code == 200
    profile_after_chat = chat_response.json()["data"]["updatedProfile"]
    assert 0 <= profile_after_chat["cognition"] <= 100

    # 3. 获取画像
    profile_response = await client.get(f"/api/profile/{user_id}")
    assert profile_response.status_code == 200
    assert profile_response.json()["success"] is True

    # 4. 获取日志
    logs_response = await client.get(f"/api/logs/{user_id}")
    assert logs_response.status_code == 200
    logs = logs_response.json()["data"]
    assert "messages" in logs
    assert "calibrationLogs" in logs
    assert len(logs["messages"]) >= 1

    print(
        f"\n✅ Complete flow test passed: "
        f"user={user_id[:8]}..., "
        f"profile=C{profile_after_chat['cognition']}"
        f"/A{profile_after_chat['affect']}"
        f"/B{profile_after_chat['behavior']}"
    )


if __name__ == "__main__":
    import sys
    import pytest as _pytest

    _pytest.main([__file__, "-v", "-s"] + sys.argv[1:])
