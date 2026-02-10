"""
Admin API 端点集成测试
测试所有 Admin FastAPI 端点的完整流程

运行方式:
  pytest tests/test_admin_endpoints.py -v
"""
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from datetime import datetime, timedelta

from app.main import app
from app.db.postgres import get_db
from app.models.sql.base import Base
from app.models.sql.user import User
from app.models.sql.chat_message import ChatMessage
from app.models.sql.profile_snapshot import ProfileSnapshot
from app.core.config import settings


# 测试数据库 URL（使用内存 SQLite）
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

# 测试用的 Admin Key
TEST_ADMIN_KEY = "test_admin_key_for_testing"


@pytest.fixture
async def test_db():
    """创建测试数据库并填充测试数据"""
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

    # 插入测试数据
    async with async_session_factory() as session:
        # 创建测试用户
        user1 = User(
            user_id="admin-test-user-001",
            email="test1@example.com",
            cognition=65,
            affect=70,
            behavior=60,
            created_at=datetime.utcnow() - timedelta(days=7),
            last_active=datetime.utcnow() - timedelta(hours=2)
        )
        user2 = User(
            user_id="admin-test-user-002",
            email="test2@example.com",
            cognition=55,
            affect=60,
            behavior=50,
            created_at=datetime.utcnow() - timedelta(days=3),
            last_active=datetime.utcnow() - timedelta(days=1)
        )

        session.add_all([user1, user2])
        await session.flush()

        # 创建测试消息
        msg1 = ChatMessage(
            user_id=user1.user_id,
            role="user",
            content="什么是深度学习？",
            created_at=datetime.utcnow() - timedelta(hours=5)
        )
        msg2 = ChatMessage(
            user_id=user1.user_id,
            role="assistant",
            content="深度学习是机器学习的一个分支...",
            created_at=datetime.utcnow() - timedelta(hours=4)
        )
        msg3 = ChatMessage(
            user_id=user2.user_id,
            role="user",
            content="解释一下神经网络",
            created_at=datetime.utcnow() - timedelta(days=1)
        )

        session.add_all([msg1, msg2, msg3])

        # 创建测试画像快照
        snapshot1 = ProfileSnapshot(
            user_id=user1.user_id,
            cognition=65,
            affect=70,
            behavior=60,
            trigger="chat",
            created_at=datetime.utcnow() - timedelta(hours=3)
        )

        session.add(snapshot1)
        await session.commit()

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


@pytest.fixture
async def admin_client(test_db):
    """创建带有 Admin Key 的测试客户端"""
    # 临时覆盖 ADMIN_KEY 配置
    original_key = settings.ADMIN_KEY
    settings.ADMIN_KEY = TEST_ADMIN_KEY

    async with AsyncClient(
        app=app,
        base_url="http://test",
        headers={"X-ADMIN-KEY": TEST_ADMIN_KEY}
    ) as ac:
        yield ac

    # 恢复原配置
    settings.ADMIN_KEY = original_key


# ==================== 鉴权测试 ====================

@pytest.mark.asyncio
async def test_admin_auth_no_key(client):
    """
    测试 1: Admin 端点未提供 API Key 时返回 403
    """
    response = await client.get("/api/admin/explorer/tables")

    assert response.status_code == 403
    data = response.json()
    assert data["success"] is False
    assert "Invalid" in data["error"]["message"] or "missing" in data["error"]["message"]

    print(f"\n✅ Admin auth (no key) test passed: {response.status_code}")


@pytest.mark.asyncio
async def test_admin_auth_invalid_key(client):
    """
    测试 2: Admin 端点提供错误的 API Key 时返回 403
    """
    response = await client.get(
        "/api/admin/explorer/tables",
        headers={"X-ADMIN-KEY": "wrong_key"}
    )

    assert response.status_code == 403
    data = response.json()
    assert data["success"] is False

    print(f"\n✅ Admin auth (invalid key) test passed: {response.status_code}")


@pytest.mark.asyncio
async def test_admin_auth_valid_key(admin_client):
    """
    测试 3: Admin 端点提供正确的 API Key 时返回成功
    """
    response = await admin_client.get("/api/admin/explorer/tables")

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True

    print(f"\n✅ Admin auth (valid key) test passed: {response.status_code}")


# ==================== Data Explorer 测试 ====================

@pytest.mark.asyncio
async def test_list_tables(admin_client):
    """
    测试 4: GET /api/admin/explorer/tables
    列出所有可视化表
    """
    response = await admin_client.get("/api/admin/explorer/tables")

    assert response.status_code == 200

    data = response.json()
    assert data["success"] is True
    assert "tables" in data["data"]

    tables = data["data"]["tables"]
    assert isinstance(tables, list)

    # 应该包含预定义的允许表（至少 users 表）
    table_names = [t["name"] for t in tables]
    assert "users" in table_names

    # 每个表应该有 name 和 rowCount
    for table in tables:
        assert "name" in table
        assert "rowCount" in table
        assert isinstance(table["rowCount"], int)
        assert table["rowCount"] >= 0

    print(f"\n✅ List tables test passed: {len(tables)} tables, names={table_names}")


@pytest.mark.asyncio
async def test_get_table_schema(admin_client):
    """
    测试 5: GET /api/admin/explorer/tables/{table_name}/schema
    获取表结构信息
    """
    response = await admin_client.get("/api/admin/explorer/tables/users/schema")

    assert response.status_code == 200

    data = response.json()
    assert data["success"] is True
    assert "table" in data["data"]
    assert "columns" in data["data"]

    assert data["data"]["table"] == "users"

    columns = data["data"]["columns"]
    assert isinstance(columns, list)
    assert len(columns) > 0

    # 验证列结构
    for col in columns:
        assert "name" in col
        assert "type" in col
        assert "nullable" in col

    # 应该包含 users 表的关键字段
    column_names = [c["name"] for c in columns]
    assert "user_id" in column_names
    assert "email" in column_names
    assert "cognition" in column_names

    # 敏感字段应该被过滤掉
    assert "hashed_password" not in column_names

    print(f"\n✅ Get table schema test passed: {len(columns)} columns, names={column_names[:5]}...")


@pytest.mark.asyncio
async def test_get_table_schema_forbidden(admin_client):
    """
    测试 6: 访问不在白名单中的表应返回 403
    """
    response = await admin_client.get("/api/admin/explorer/tables/invalid_table/schema")

    assert response.status_code == 403

    data = response.json()
    assert data["success"] is False

    print(f"\n✅ Get table schema (forbidden) test passed: {response.status_code}")


@pytest.mark.asyncio
async def test_get_table_data(admin_client):
    """
    测试 7: GET /api/admin/explorer/tables/{table_name}/data
    获取表数据（分页）
    """
    response = await admin_client.get(
        "/api/admin/explorer/tables/users/data?page=1&page_size=10"
    )

    assert response.status_code == 200

    data = response.json()
    assert data["success"] is True
    assert "table" in data["data"]
    assert "rows" in data["data"]
    assert "pagination" in data["data"]

    assert data["data"]["table"] == "users"

    rows = data["data"]["rows"]
    assert isinstance(rows, list)
    # 测试数据中有 2 个用户
    assert len(rows) >= 1

    # 验证分页信息
    pagination = data["data"]["pagination"]
    assert pagination["page"] == 1
    assert pagination["pageSize"] == 10
    assert pagination["total"] >= 2
    assert "totalPages" in pagination

    # 验证每行数据不包含敏感字段
    if len(rows) > 0:
        first_row = rows[0]
        assert "user_id" in first_row
        assert "email" in first_row
        assert "hashed_password" not in first_row
        assert "password" not in first_row

    print(f"\n✅ Get table data test passed: {len(rows)} rows, total={pagination['total']}")


@pytest.mark.asyncio
async def test_get_table_data_pagination(admin_client):
    """
    测试 8: 验证分页功能正常工作
    """
    # 获取第 1 页（每页 1 条）
    response1 = await admin_client.get(
        "/api/admin/explorer/tables/users/data?page=1&page_size=1"
    )

    assert response1.status_code == 200
    data1 = response1.json()

    rows1 = data1["data"]["rows"]
    assert len(rows1) == 1

    pagination1 = data1["data"]["pagination"]
    assert pagination1["page"] == 1
    assert pagination1["pageSize"] == 1
    assert pagination1["total"] >= 2  # 我们有 2 个测试用户

    # 获取第 2 页（每页 1 条）
    response2 = await admin_client.get(
        "/api/admin/explorer/tables/users/data?page=2&page_size=1"
    )

    assert response2.status_code == 200
    data2 = response2.json()

    rows2 = data2["data"]["rows"]
    assert len(rows2) == 1

    # 第 1 页和第 2 页的数据应该不同
    if len(rows1) > 0 and len(rows2) > 0:
        assert rows1[0]["user_id"] != rows2[0]["user_id"]

    print(f"\n✅ Pagination test passed: page1={rows1[0]['user_id']}, page2={rows2[0]['user_id']}")


@pytest.mark.asyncio
async def test_export_table(admin_client):
    """
    测试 9: GET /api/admin/explorer/tables/{table_name}/export
    导出表数据为 JSON
    """
    response = await admin_client.get("/api/admin/explorer/tables/users/export")

    assert response.status_code == 200

    # 导出接口返回的是 JSONResponse，不是标准的 SuccessResponse
    data = response.json()
    assert isinstance(data, list)
    assert len(data) >= 2  # 应该有至少 2 个用户

    # 验证每条记录不包含敏感字段
    for row in data:
        assert "user_id" in row
        assert "email" in row
        assert "hashed_password" not in row
        assert "password" not in row

    print(f"\n✅ Export table test passed: {len(data)} rows exported")


# ==================== User Management 测试 ====================

@pytest.mark.asyncio
async def test_list_users(admin_client):
    """
    测试 10: GET /api/admin/users
    获取用户列表（分页）
    """
    response = await admin_client.get("/api/admin/users?page=1&page_size=10")

    assert response.status_code == 200

    data = response.json()
    assert data["success"] is True
    assert "users" in data["data"]
    assert "pagination" in data["data"]

    users = data["data"]["users"]
    assert isinstance(users, list)
    assert len(users) >= 2  # 测试数据中有 2 个用户

    # 验证用户数据结构
    first_user = users[0]
    assert "userId" in first_user
    assert "email" in first_user
    assert "cognition" in first_user
    assert "affect" in first_user
    assert "behavior" in first_user
    assert "createdAt" in first_user
    assert "lastActive" in first_user
    assert "messageCount" in first_user

    # 验证分页信息
    pagination = data["data"]["pagination"]
    assert pagination["page"] == 1
    assert pagination["pageSize"] == 10
    assert pagination["total"] >= 2

    print(f"\n✅ List users test passed: {len(users)} users, total={pagination['total']}")


@pytest.mark.asyncio
async def test_list_users_pagination(admin_client):
    """
    测试 11: 用户列表分页功能
    """
    # 获取第 1 页（每页 1 个用户）
    response = await admin_client.get("/api/admin/users?page=1&page_size=1")

    assert response.status_code == 200

    data = response.json()
    users = data["data"]["users"]
    assert len(users) == 1

    pagination = data["data"]["pagination"]
    assert pagination["page"] == 1
    assert pagination["pageSize"] == 1

    print(f"\n✅ User list pagination test passed")


# ==================== Analytics 测试 ====================

@pytest.mark.asyncio
async def test_analytics_overview(admin_client):
    """
    测试 12: GET /api/admin/analytics/overview
    获取系统统计概览
    """
    response = await admin_client.get("/api/admin/analytics/overview")

    assert response.status_code == 200

    data = response.json()
    assert data["success"] is True
    assert "totalUsers" in data["data"]
    assert "totalMessages" in data["data"]
    assert "activeUsersLast7Days" in data["data"]
    assert "activityTrend" in data["data"]

    # 验证统计数据
    stats = data["data"]
    assert stats["totalUsers"] >= 2  # 测试数据中有 2 个用户
    assert stats["totalMessages"] >= 3  # 测试数据中有 3 条消息
    assert stats["activeUsersLast7Days"] >= 1  # 至少 1 个用户在过去 7 天内活跃

    # 验证活跃度趋势数据
    trend = stats["activityTrend"]
    assert isinstance(trend, list)
    assert len(trend) == 7  # 应该有 7 天的数据

    for day_data in trend:
        assert "date" in day_data
        assert "activeUsers" in day_data
        assert "messages" in day_data
        assert isinstance(day_data["activeUsers"], int)
        assert isinstance(day_data["messages"], int)

    print(f"\n✅ Analytics overview test passed: "
          f"{stats['totalUsers']} users, "
          f"{stats['totalMessages']} messages, "
          f"{stats['activeUsersLast7Days']} active users")


# ==================== 完整流程测试 ====================

@pytest.mark.asyncio
async def test_complete_admin_workflow(admin_client):
    """
    测试 13: 完整的 Admin 工作流程
    模拟管理员从登录到浏览数据的完整流程
    """
    # 1. 查看系统概览
    overview_response = await admin_client.get("/api/admin/analytics/overview")
    assert overview_response.status_code == 200
    overview = overview_response.json()["data"]

    total_users = overview["totalUsers"]
    total_messages = overview["totalMessages"]

    print(f"\n   Step 1: System overview - {total_users} users, {total_messages} messages")

    # 2. 查看用户列表
    users_response = await admin_client.get("/api/admin/users?page=1&page_size=5")
    assert users_response.status_code == 200
    users = users_response.json()["data"]["users"]

    assert len(users) >= 1
    first_user_id = users[0]["userId"]

    print(f"   Step 2: User list - found {len(users)} users, first user: {first_user_id}")

    # 3. 查看所有可用表
    tables_response = await admin_client.get("/api/admin/explorer/tables")
    assert tables_response.status_code == 200
    tables = tables_response.json()["data"]["tables"]

    table_names = [t["name"] for t in tables]
    assert "users" in table_names
    assert "chat_messages" in table_names

    print(f"   Step 3: Available tables - {len(tables)} tables: {table_names}")

    # 4. 查看 users 表结构
    schema_response = await admin_client.get("/api/admin/explorer/tables/users/schema")
    assert schema_response.status_code == 200
    columns = schema_response.json()["data"]["columns"]

    column_names = [c["name"] for c in columns]

    print(f"   Step 4: Users table schema - {len(columns)} columns")

    # 5. 查看 users 表数据
    data_response = await admin_client.get("/api/admin/explorer/tables/users/data?page=1&page_size=10")
    assert data_response.status_code == 200
    rows = data_response.json()["data"]["rows"]

    assert len(rows) >= 2

    print(f"   Step 5: Users table data - {len(rows)} rows")

    # 6. 导出 chat_messages 表
    export_response = await admin_client.get("/api/admin/explorer/tables/chat_messages/export")
    assert export_response.status_code == 200
    exported_messages = export_response.json()

    assert isinstance(exported_messages, list)
    assert len(exported_messages) >= 3  # 测试数据中有 3 条消息

    print(f"   Step 6: Exported chat_messages - {len(exported_messages)} messages")

    print(f"\n✅ Complete admin workflow test passed: "
          f"verified {total_users} users, "
          f"{total_messages} messages, "
          f"{len(tables)} tables")


# 运行所有测试的主函数
if __name__ == "__main__":
    import sys

    pytest.main([__file__, "-v", "-s"] + sys.argv[1:])
