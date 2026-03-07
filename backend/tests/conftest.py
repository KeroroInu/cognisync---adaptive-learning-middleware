"""
共享测试固件 - Shared test fixtures

注意：集成测试需要一个真实的 PostgreSQL 数据库（模型使用 UUID / JSONB 等 PG 专属类型，
与 SQLite 不兼容）。在运行集成测试前请确保测试数据库可用：

  createdb cognisync_test  # 或通过 docker 创建
  export TEST_DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/cognisync_test

运行方式:
  cd backend
  pytest tests/ -v
"""
import os
import uuid

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

from main import app
from app.db.postgres import get_db
from app.models.sql.base import Base
from app.core.config import settings

# 测试数据库 URL（必须是 PostgreSQL，不支持 SQLite）
TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://postgres:postgres@localhost:5432/cognisync_test",
)

# 测试用 Admin Key
TEST_ADMIN_KEY = "test_admin_key_for_testing"


@pytest.fixture
async def test_db():
    """创建干净的测试数据库，测试结束后清理所有表"""
    engine = create_async_engine(TEST_DATABASE_URL, echo=False)

    # 清理旧数据 + 创建所有表
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )

    async def override_get_db():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db

    yield session_factory

    # 测试结束后清理
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()
    app.dependency_overrides.clear()


@pytest.fixture
async def client(test_db):
    """普通用户测试客户端（无认证）"""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac


@pytest.fixture
async def admin_client(test_db):
    """带 Admin Key 的测试客户端"""
    original_key = settings.ADMIN_KEY
    settings.ADMIN_KEY = TEST_ADMIN_KEY

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"X-ADMIN-KEY": TEST_ADMIN_KEY},
    ) as ac:
        yield ac

    settings.ADMIN_KEY = original_key


@pytest.fixture
async def registered_user(client):
    """注册一个测试用户，返回凭据和 token"""
    student_id = f"test_{uuid.uuid4().hex[:8]}"
    response = await client.post(
        "/api/auth/register",
        json={
            "student_id": student_id,
            "name": "测试用户",
            "password": "testpass123",
            "mode": "scale",
        },
    )
    assert response.status_code == 200, f"Registration failed: {response.text}"
    data = response.json()
    return {
        "student_id": student_id,
        "password": "testpass123",
        "user_id": data["user"]["id"],
        "token": data["token"],
    }


@pytest.fixture
async def auth_headers(registered_user) -> dict:
    """返回 JWT 认证请求头"""
    return {"Authorization": f"Bearer {registered_user['token']}"}


@pytest.fixture
async def test_user_id(registered_user) -> str:
    """返回已注册用户的 UUID（供 onboarding 测试使用）"""
    return registered_user["user_id"]
