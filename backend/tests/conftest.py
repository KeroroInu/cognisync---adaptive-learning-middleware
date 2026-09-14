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
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

from main import app
from app.db.postgres import get_db
from app.models.sql.base import Base
from app.core.config import settings
from app.core.security import verify_admin_key
from app.services import llm_config

# 测试数据库 URL（必须是 PostgreSQL，不支持 SQLite）
TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://cognisync:cognisync_dev_password_2024@localhost:5432/cognisync_test",
)

# 测试用 Admin Key
TEST_ADMIN_KEY = "test_admin_key_for_testing"


async def publish_test_lesson(session_factory, user_id, task_id):
    """Explicit lesson fixture for older tests of blueprint/task behavior, not legacy auto-routing."""
    from datetime import datetime, timezone
    from app.models.sql import User, ResearchTask, ClassroomSession, LessonPlan
    async with session_factory() as db:
        user = await db.get(User, uuid.UUID(str(user_id)))
        task = await db.get(ResearchTask, uuid.UUID(str(task_id)))
        user.class_name = f"lesson-{user.id}"
        session = ClassroomSession(class_name=user.class_name, title="任务回归课次", created_by=user.id)
        db.add(session)
        await db.flush()
        snapshot = {key: getattr(task, key) for key in ("title", "description", "instructions", "ai_prompt", "code_content", "ai_enabled")}
        snapshot.update(id=str(task.id), blueprint_version_id=str(task.current_blueprint_version_id) if task.current_blueprint_version_id else None)
        db.add(LessonPlan(session_id=session.id, configuration={"version": 1, "tasks": {user.experiment_group: snapshot}, "knowledge_points": []}, started_at=datetime.now(timezone.utc)))
        await db.commit()


@pytest.fixture(autouse=True)
def force_mock_llm():
    """集成测试不访问外部 LLM，保证离线可重复且不消耗 API 配额。"""
    previous_config = dict(llm_config._config_cache)
    previous_providers = dict(llm_config._provider_cache)
    llm_config._config_cache.clear()
    llm_config._config_cache.update({
        "analysis": {"provider": "mock"},
        "chat": {"provider": "mock"},
    })
    llm_config._provider_cache.clear()
    yield
    llm_config._config_cache.clear()
    llm_config._config_cache.update(previous_config)
    llm_config._provider_cache.clear()
    llm_config._provider_cache.update(previous_providers)


@pytest.fixture
async def test_db():
    """创建干净的测试数据库，测试结束后清理所有表"""
    test_url = make_url(TEST_DATABASE_URL)
    database_name = test_url.database or ""
    if not database_name.endswith("_test") or not database_name.replace("_", "").isalnum() or database_name == settings.POSTGRES_DB:
        raise RuntimeError("TEST_DATABASE_URL must point to a dedicated *_test database")
    admin_engine = create_async_engine(test_url.set(database="postgres"), isolation_level="AUTOCOMMIT")
    async with admin_engine.connect() as conn:
        exists = await conn.scalar(text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": database_name})
        if not exists:
            await conn.execute(text(f'CREATE DATABASE "{database_name}"'))
    await admin_engine.dispose()

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
    """已通过管理员鉴权的端点测试客户端。鉴权本身由独立测试覆盖。"""
    async def override_admin_auth():
        return True

    app.dependency_overrides[verify_admin_key] = override_admin_auth

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": "Bearer integration-test-admin"},
    ) as ac:
        yield ac

    app.dependency_overrides.pop(verify_admin_key, None)


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
