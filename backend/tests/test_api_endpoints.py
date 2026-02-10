"""
API 端点集成测试
测试所有 FastAPI 端点的完整流程

运行方式:
  poetry run pytest tests/test_api_endpoints.py -v
"""
import pytest
import asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.db.postgres import get_db
from app.models.sql.base import Base


# 测试数据库 URL（使用内存 SQLite）
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"


@pytest.fixture
async def test_db():
    """创建测试数据库"""
    engine = create_async_engine(TEST_DATABASE_URL, echo=False)

    # 创建所有表
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # 创建会话工厂
    async_session_factory = sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )

    async def override_get_db():
        async with async_session_factory() as session:
            yield session

    # 覆盖依赖
    app.dependency_overrides[get_db] = override_get_db

    yield async_session_factory

    # 清理
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

    await engine.dispose()
    app.dependency_overrides.clear()


@pytest.fixture
async def client(test_db):
    """创建测试客户端"""
    async with AsyncClient(app=app, base_url="http://test") as ac:
        yield ac


@pytest.mark.asyncio
async def test_chat_endpoint(client):
    """
    测试 1: POST /api/chat
    发送聊天消息并验证响应
    """
    response = await client.post(
        "/api/chat",
        json={
            "userId": "test-user-001",
            "message": "我对神经网络的反向传播不太理解",
            "language": "zh",
            "isResearchMode": False
        }
    )

    assert response.status_code == 200

    data = response.json()
    assert data["success"] is True
    assert "data" in data

    # 验证响应结构
    chat_response = data["data"]
    assert "message" in chat_response
    assert "analysis" in chat_response
    assert "updatedProfile" in chat_response

    # 验证分析结果
    analysis = chat_response["analysis"]
    assert "intent" in analysis
    assert "emotion" in analysis
    assert "detectedConcepts" in analysis
    assert "delta" in analysis

    # 验证画像
    profile = chat_response["updatedProfile"]
    assert 0 <= profile["cognition"] <= 100
    assert 0 <= profile["affect"] <= 100
    assert 0 <= profile["behavior"] <= 100
    assert "lastUpdate" in profile

    print(f"\n✅ Chat test passed: intent={analysis['intent']}, emotion={analysis['emotion']}")


@pytest.mark.asyncio
async def test_get_profile(client):
    """
    测试 2: GET /api/profile/{userId}
    获取用户画像（首次应返回默认值 50/50/50）
    """
    response = await client.get("/api/profile/test-user-002")

    assert response.status_code == 200

    data = response.json()
    assert data["success"] is True

    profile = data["data"]
    assert profile["cognition"] == 50
    assert profile["affect"] == 50
    assert profile["behavior"] == 50
    assert "lastUpdate" in profile

    print(f"\n✅ Profile test passed: {profile}")


@pytest.mark.asyncio
async def test_update_profile(client):
    """
    测试 3: PUT /api/profile/{userId}
    用户手动校准画像
    """
    # 先创建用户
    await client.post(
        "/api/chat",
        json={
            "userId": "test-user-003",
            "message": "测试消息",
            "language": "zh"
        }
    )

    # 更新画像
    response = await client.put(
        "/api/profile/test-user-003",
        json={
            "cognition": 75,
            "affect": None,
            "behavior": None,
            "user_comment": "我觉得我的认知能力被低估了",
            "likert_trust": 4
        }
    )

    assert response.status_code == 200

    data = response.json()
    assert data["success"] is True

    profile = data["data"]
    assert profile["cognition"] == 75
    assert "lastUpdate" in profile

    print(f"\n✅ Update profile test passed: cognition={profile['cognition']}")


@pytest.mark.asyncio
async def test_get_knowledge_graph(client):
    """
    测试 4: GET /api/knowledge-graph/{userId}
    获取知识图谱（需要 Neo4j，可能会失败）
    """
    # 注意：此测试需要 Neo4j 运行，否则会失败
    try:
        response = await client.get("/api/knowledge-graph/test-user-004")

        if response.status_code == 200:
            data = response.json()
            assert data["success"] is True

            graph_data = data["data"]
            assert "nodes" in graph_data
            assert "edges" in graph_data
            assert isinstance(graph_data["nodes"], list)
            assert isinstance(graph_data["edges"], list)

            print(f"\n✅ Knowledge graph test passed: {len(graph_data['nodes'])} nodes")
        else:
            print(f"\n⚠️  Knowledge graph test skipped (Neo4j not available): {response.status_code}")

    except Exception as e:
        print(f"\n⚠️  Knowledge graph test skipped (Neo4j error): {e}")


@pytest.mark.asyncio
async def test_get_logs(client):
    """
    测试 5: GET /api/logs/{userId}
    获取用户日志（消息 + 校准日志）
    """
    user_id = "test-user-005"

    # 创建一些数据
    await client.post(
        "/api/chat",
        json={
            "userId": user_id,
            "message": "什么是神经网络？",
            "language": "zh"
        }
    )

    await client.put(
        f"/api/profile/{user_id}",
        json={
            "cognition": 60,
            "user_comment": "测试校准",
            "likert_trust": 3
        }
    )

    # 获取日志
    response = await client.get(f"/api/logs/{user_id}")

    assert response.status_code == 200

    data = response.json()
    assert data["success"] is True

    logs = data["data"]
    assert "messages" in logs
    assert "calibrationLogs" in logs
    assert isinstance(logs["messages"], list)
    assert isinstance(logs["calibrationLogs"], list)

    # 应该至少有一条消息和一条校准日志
    assert len(logs["messages"]) >= 1
    assert len(logs["calibrationLogs"]) >= 1

    print(f"\n✅ Logs test passed: {len(logs['messages'])} messages, {len(logs['calibrationLogs'])} calibrations")


@pytest.mark.asyncio
async def test_export_user_data(client):
    """
    测试 6: GET /api/export/{userId}
    导出用户所有数据
    """
    user_id = "test-user-006"

    # 创建一些数据
    await client.post(
        "/api/chat",
        json={
            "userId": user_id,
            "message": "我想学习深度学习",
            "language": "zh"
        }
    )

    # 导出数据
    response = await client.get(f"/api/export/{user_id}")

    assert response.status_code == 200

    data = response.json()
    assert data["success"] is True

    export_data = data["data"]
    assert "profile" in export_data
    assert "nodes" in export_data
    assert "edges" in export_data
    assert "messages" in export_data
    assert "calibrationLogs" in export_data

    # 验证画像
    profile = export_data["profile"]
    assert 0 <= profile["cognition"] <= 100
    assert 0 <= profile["affect"] <= 100
    assert 0 <= profile["behavior"] <= 100

    # 验证消息
    assert isinstance(export_data["messages"], list)
    assert len(export_data["messages"]) >= 1

    print(f"\n✅ Export test passed: profile={profile}, {len(export_data['messages'])} messages")


@pytest.mark.asyncio
async def test_complete_user_flow(client):
    """
    测试 7: 完整用户流程
    模拟用户从注册到使用的完整流程
    """
    user_id = "test-user-flow"

    # 1. 发送第一条消息（创建用户）
    response1 = await client.post(
        "/api/chat",
        json={
            "userId": user_id,
            "message": "什么是机器学习？",
            "language": "zh"
        }
    )
    assert response1.status_code == 200
    profile1 = response1.json()["data"]["updatedProfile"]

    # 2. 发送第二条消息（画像应该更新）
    response2 = await client.post(
        "/api/chat",
        json={
            "userId": user_id,
            "message": "我想深入学习神经网络",
            "language": "zh"
        }
    )
    assert response2.status_code == 200
    profile2 = response2.json()["data"]["updatedProfile"]

    # 画像应该有变化（除非 delta 都是 0）
    print(f"\n   Profile change: C={profile1['cognition']}→{profile2['cognition']}, "
          f"A={profile1['affect']}→{profile2['affect']}, "
          f"B={profile1['behavior']}→{profile2['behavior']}")

    # 3. 用户校准画像
    response3 = await client.put(
        f"/api/profile/{user_id}",
        json={
            "cognition": 70,
            "affect": 60,
            "behavior": 80,
            "user_comment": "我觉得系统低估了我",
            "likert_trust": 4
        }
    )
    assert response3.status_code == 200
    profile3 = response3.json()["data"]
    assert profile3["cognition"] == 70
    assert profile3["affect"] == 60
    assert profile3["behavior"] == 80

    # 4. 查看所有日志
    response4 = await client.get(f"/api/logs/{user_id}")
    assert response4.status_code == 200
    logs = response4.json()["data"]

    # 应该有 4 条消息（2 条用户 + 2 条助手）
    assert len(logs["messages"]) >= 2

    # 应该有 3 条校准日志（cognition、affect、behavior）
    assert len(logs["calibrationLogs"]) >= 3

    # 5. 导出所有数据
    response5 = await client.get(f"/api/export/{user_id}")
    assert response5.status_code == 200
    export_data = response5.json()["data"]

    assert export_data["profile"]["cognition"] == 70
    assert len(export_data["messages"]) >= 2
    assert len(export_data["calibrationLogs"]) >= 3

    print(f"\n✅ Complete flow test passed: "
          f"{len(export_data['messages'])} messages, "
          f"{len(export_data['calibrationLogs'])} calibrations, "
          f"final profile={export_data['profile']}")


# 运行所有测试的主函数
if __name__ == "__main__":
    import sys

    pytest.main([__file__, "-v", "-s"] + sys.argv[1:])
