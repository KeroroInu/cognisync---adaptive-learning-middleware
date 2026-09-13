"""Slow password work must not block the classroom's asyncio event loop."""
import asyncio
import threading
from uuid import UUID

from fastapi import HTTPException
import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.endpoints import auth
from app.api.endpoints.admin import auth as admin_auth
from app.models.sql.scale import ScaleTemplate
from app.models.sql.user import User


@pytest.fixture
async def legacy_template(test_db):
    async with test_db() as db:
        template = ScaleTemplate(name="test-only", schema_json={}, scoring_json={}, mapping_json={})
        db.add(template)
        await db.commit()
        return str(template.id)


@pytest.mark.parametrize("operation", ["login", "register", "register-with-scale", "scale-resume", "admin-login"])
async def test_slow_password_work_leaves_other_student_requests_responsive(client, registered_user, test_db, legacy_template, monkeypatch, operation):
    entered, finished, release = threading.Event(), threading.Event(), threading.Event()
    verify = operation in {"login", "admin-login"}

    def slow_password(*args):
        entered.set()
        try:
            # The timeout lets the old blocking implementation fail cleanly,
            # instead of hanging the entire test event loop.
            release.wait(timeout=0.5)
            return True if verify else "test-only-password-hash"
        finally:
            finished.set()

    if operation == "admin-login":
        monkeypatch.setattr(admin_auth, "_verify_password", slow_password)
    else:
        monkeypatch.setattr(auth, "verify_password" if verify else "hash_password", slow_password)
    payload = {"student_id": registered_user["student_id"], "password": registered_user["password"]}
    if not verify:
        payload.update(name="并发验证学生", mode="classroom" if operation == "register" else "scale")
        if operation != "scale-resume":
            payload["student_id"] = "threaded-registration"
        payload.update(template_id=legacy_template, answers={})
    endpoint = "register-with-scale" if operation == "scale-resume" else operation
    url = "/api/admin/auth/login" if operation == "admin-login" else f"/api/auth/{endpoint}"
    request = asyncio.create_task(client.post(url, json=payload))
    try:
        async with asyncio.timeout(3):
            while not entered.is_set():
                await asyncio.sleep(0.001)
            assert test_db.kw["bind"].pool.checkedout() == 0, "Password wait retained a SQL connection"
            # A separate student's identity endpoint should finish while bcrypt
            # is still pending. Assert actual progress, not calls to a mock pool.
            other = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {registered_user['token']}"})
            assert other.status_code == 200
            assert not finished.is_set(), "Password work blocked unrelated classroom requests"
    finally:
        release.set()
        response = await request
    assert response.status_code == (403 if operation == "admin-login" else 200)
    if response.status_code == 200:
        token = response.json()["token"]
        current = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert current.status_code == 200


async def test_password_workers_are_bounded_and_keep_original_results(monkeypatch):
    active = 0
    peak = 0
    lock = threading.Lock()
    release = threading.Event()

    def slow_verify(*args):
        nonlocal active, peak
        with lock:
            active += 1
            peak = max(active, peak)
        try:
            release.wait(timeout=1)
            return True
        finally:
            with lock:
                active -= 1

    monkeypatch.setattr(auth, "verify_password", slow_verify)
    calls = [asyncio.create_task(auth.verify_password_async("plain", "hash")) for _ in range(10)]
    try:
        async with asyncio.timeout(2):
            while active < 2:
                await asyncio.sleep(0.001)
        # Give waiting tasks a scheduling turn: only two may enter CPU work.
        await asyncio.sleep(0.02)
        assert peak == 2
        assert not any(call.done() for call in calls)
    finally:
        release.set()
        results = await asyncio.gather(*calls)
    assert results == [True] * 10
    assert peak == 2


async def test_async_password_wrappers_preserve_bcrypt_checks():
    hashed = await auth.hash_password_async("sixteen-character-password")
    assert hashed.startswith("$2b$")
    assert await auth.verify_password_async("sixteen-character-password", hashed)
    assert not await auth.verify_password_async("wrong-password", hashed)
    assert not await auth.verify_password_async("password", "invalid-hash")


async def test_queue_overflow_timeout_and_running_cancellation_do_not_free_cpu_slot():
    queue = auth.PasswordWorkQueue(workers=1, max_waiters=1, wait_timeout=0.03)
    entered, release = threading.Event(), threading.Event()

    def slow():
        entered.set()
        release.wait(timeout=1)
        return "finished"

    running = asyncio.create_task(queue.run(slow))
    waiter = None
    try:
        async with asyncio.timeout(2):
            while not entered.is_set():
                await asyncio.sleep(0.001)
        running.cancel()
        with pytest.raises(asyncio.CancelledError):
            await running
        # The real worker has not finished; cancellation must not admit another.
        assert queue.slots.locked()
        waiter = asyncio.create_task(queue.run(lambda: "should not execute"))
        while not queue.waiting:
            await asyncio.sleep(0)
        with pytest.raises(HTTPException) as full:
            await queue.run(lambda: None)
        assert full.value.detail["code"] == "AUTH_BUSY"
        with pytest.raises(HTTPException) as expired:
            await waiter
        assert expired.value.detail["code"] == "AUTH_QUEUE_TIMEOUT"
        assert queue.waiting == 0
    finally:
        release.set()
        if waiter and not waiter.done():
            waiter.cancel()
            await asyncio.gather(waiter, return_exceptions=True)
        async with asyncio.timeout(2):
            while queue.slots.locked():
                await asyncio.sleep(0.001)
    assert await queue.run(lambda: "recovered") == "recovered"


@pytest.mark.parametrize("route,change", [
    ("/api/auth/login", {"auth_version": 1}),
    ("/api/auth/login", {"password_hash": "reset-hash"}),
    ("/api/auth/login", {"is_active": False}),
    ("/api/admin/auth/login", {"auth_version": 1}),
    ("/api/admin/auth/login", {"role": "learner"}),
])
async def test_login_rechecks_account_after_password_wait(client, registered_user, test_db, monkeypatch, route, change):
    entered, release = threading.Event(), threading.Event()
    user_id = UUID(registered_user["user_id"])
    if "/admin/" in route:
        async with test_db() as db:
            await db.execute(update(User).where(User.id == user_id).values(role="admin"))
            await db.commit()

    def slow_verify(*args):
        entered.set()
        release.wait(timeout=2)
        return True

    monkeypatch.setattr(admin_auth if "/admin/" in route else auth,
                        "_verify_password" if "/admin/" in route else "verify_password", slow_verify)
    login = asyncio.create_task(client.post(route, json={"student_id": registered_user["student_id"], "password": registered_user["password"]}))
    try:
        async with asyncio.timeout(2):
            while not entered.is_set():
                await asyncio.sleep(0.001)
        async with test_db() as db:
            await db.execute(update(User).where(User.id == user_id).values(**change))
            await db.commit()
    finally:
        release.set()
        result = await login
    assert result.status_code in {401, 403}
    assert "token" not in result.json()


async def test_legacy_resume_does_not_overwrite_reset_while_hashing(client, registered_user, test_db, legacy_template, monkeypatch):
    entered, release = threading.Event(), threading.Event()

    def slow_hash(*args):
        entered.set()
        release.wait(timeout=2)
        return "stale-password-hash"

    monkeypatch.setattr(auth, "hash_password", slow_hash)
    user_id = UUID(registered_user["user_id"])
    request = asyncio.create_task(client.post("/api/auth/register-with-scale", json={
        "student_id": registered_user["student_id"], "password": registered_user["password"],
        "name": "原账号", "mode": "scale", "template_id": legacy_template, "answers": {},
    }))
    try:
        async with asyncio.timeout(2):
            while not entered.is_set():
                await asyncio.sleep(0.001)
        async with test_db() as db:
            await db.execute(update(User).where(User.id == user_id).values(auth_version=1, password_hash="teacher-reset"))
            await db.commit()
    finally:
        release.set()
        response = await request
    assert response.status_code == 409
    async with test_db() as db:
        user = await db.get(User, user_id)
        assert user.password_hash == "teacher-reset"
        assert not user.has_completed_onboarding


@pytest.mark.parametrize("endpoint", ["register", "register-with-scale"])
async def test_registration_never_issues_reset_version_token_after_commit(client, test_db, legacy_template, monkeypatch, endpoint):
    original_refresh = AsyncSession.refresh

    async def reset_before_refresh(db, instance, *args, **kwargs):
        if isinstance(instance, User) and instance.student_id == "commit-window":
            async with test_db() as teacher:
                await teacher.execute(update(User).where(User.id == instance.id).values(auth_version=1, password_hash="teacher-reset"))
                await teacher.commit()
        await original_refresh(db, instance, *args, **kwargs)

    monkeypatch.setattr(AsyncSession, "refresh", reset_before_refresh)
    response = await client.post(f"/api/auth/{endpoint}", json={
        "student_id": "commit-window", "password": "testpass123", "name": "新同学",
        "mode": "classroom" if endpoint == "register" else "scale", "template_id": legacy_template, "answers": {},
    })
    assert response.status_code == 401
    assert "token" not in response.json()
    async with test_db() as db:
        user = await db.scalar(select(User).where(User.student_id == "commit-window"))
        assert user.auth_version == 1
        assert user.password_hash == "teacher-reset"
