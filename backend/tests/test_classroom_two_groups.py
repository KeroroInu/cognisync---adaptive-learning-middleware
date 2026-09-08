import pytest
from sqlalchemy import select
from app.models.sql import User, ScaleTemplate, ScaleStatus
from app.db import postgres


@pytest.mark.asyncio
async def test_classroom_registration_does_not_invent_assessment(client, test_db):
    from app.models.sql import ProfileSnapshot, ScaleResponse
    from uuid import UUID
    response = await client.post('/api/auth/register', json={
        'student_id': 'classroom-only', 'name': '课堂学生', 'password': 'test123456', 'mode': 'classroom',
    })
    assert response.status_code == 200
    data = response.json()
    assert data['initialProfile'] is None
    assert data['user']['hasCompletedOnboarding'] is False
    uid = UUID(data['user']['id'])
    async with test_db() as db:
        assert await db.scalar(select(ProfileSnapshot).where(ProfileSnapshot.user_id == uid)) is None
        assert await db.scalar(select(ScaleResponse).where(ScaleResponse.user_id == uid)) is None


@pytest.mark.asyncio
async def test_new_assignments_reject_lecture_but_preserve_history(admin_client, registered_user, test_db):
    path = f'/api/admin/users/{registered_user["user_id"]}'
    assert (await admin_client.patch(path, json={"experiment_group": "lecture"})).status_code == 422
    for group in ("pdt", "ai_pbl"):
        assert (await admin_client.patch(path, json={"experiment_group": group})).status_code == 200
    async with test_db() as db:
        legacy = User(student_id="legacy-lecture", name="历史学生", experiment_group="lecture")
        db.add(legacy)
        await db.commit()
        legacy_id = str(legacy.id)
    assert (await admin_client.patch(f'/api/admin/users/{legacy_id}', json={"name": "更正姓名", "experiment_group": "lecture"})).status_code == 200
    response = await admin_client.post('/api/admin/research/tasks', json={"title": "新任务", "code_content": "", "target_group": "lecture"})
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_example_scale_never_auto_published_or_overwritten(test_db, monkeypatch):
    async with test_db() as db:
        monkeypatch.setattr(postgres, "engine", db.bind)
        await postgres._seed_default_scale()
        template = await db.scalar(select(ScaleTemplate))
        assert template.status == ScaleStatus.DRAFT
        assert template.activated_at is None
        template.name = "AI 教育研究量表 v1.0"
        template.schema_json = {"preserve": "teacher edit"}
        await db.commit()
        await postgres._seed_default_scale()
        await db.refresh(template)
        assert template.schema_json == {"preserve": "teacher edit"}
