"""Classroom distribution must not inherit a template's trial-class restriction."""
from uuid import UUID, uuid4
import asyncio

import pytest
from sqlalchemy import select, func

from app.models.sql import AssessmentRound, AssessmentResponse, User
from tests.test_assessments import draft, publish
from app.api.endpoints.auth import create_access_token


@pytest.mark.asyncio
async def test_trial_template_distributes_to_real_class_without_retargeting_history(admin_client, client, auth_headers, test_db, test_user_id):
    async with test_db() as db:
        user = await db.get(User, test_user_id)
        user.class_name = '解构班'
        await db.commit()
    template = await publish(admin_client, draft(class_name='预试班'))
    assert (await client.get('/api/assessments/pending', headers=auth_headers)).json()['data'] is None
    path = f"/api/admin/assessments/{template['id']}/distribute"
    body = {'request_id': str(uuid4()), 'class_name': '解构班'}
    assert (await admin_client.post(path, json={**body, 'class_name': '预试班'})).status_code == 422
    responses = await asyncio.gather(*(admin_client.post(path, json=body) for _ in range(2)))
    assert all(r.status_code == 200 for r in responses)
    delivered = responses[0].json()['data']
    assert responses[1].json()['data']['id'] == delivered['id'] != template['id']
    assert delivered['questions'] == template['questions']
    assert delivered['class_name'] == '解构班'
    pending = (await client.get('/api/assessments/pending', headers=auth_headers)).json()['data']
    assert pending['id'] == delivered['id']
    assert (await client.post(f"/api/assessments/{delivered['id']}/responses", headers=auth_headers,
                             json={'answers': {'q1': '1'}, 'started_at': pending['served_at']})).status_code == 200
    assert (await client.get('/api/assessments/pending', headers=auth_headers)).json()['data'] is None
    # The other class gets its own round, with no effect on the first one's record.
    other = (await admin_client.post(path, json={**body, 'class_name': '开发班'})).json()['data']
    assert other['id'] != delivered['id']
    assert (await client.get('/api/assessments/pending', headers=auth_headers)).json()['data'] is None
    await admin_client.post(f"/api/admin/assessments/{delivered['id']}/availability", json={'enabled': False})
    retried = (await admin_client.post(path, json=body)).json()['data']
    assert not retried['enabled'], 'retry must not reactivate a closed classroom round'
    async with test_db() as db:
        original = await db.get(AssessmentRound, UUID(template['id']))
        assert original.class_name == '预试班' and original.enabled
        assert await db.scalar(select(func.count()).select_from(AssessmentResponse)) == 1


@pytest.mark.asyncio
async def test_distribution_has_one_active_assignment_across_legacy_phases(admin_client, client, auth_headers, test_db, test_user_id):
    async with test_db() as db:
        user = await db.get(User, test_user_id)
        user.class_name = '解构班'
        await db.commit()
    # A legacy global pre survey must not block a newly distributed post-labelled test.
    await publish(admin_client, draft())
    first = await publish(admin_client, draft(class_name='解构班'))
    template = (await admin_client.post('/api/admin/assessments', json=draft('post', '预试班'))).json()['data']
    path = f"/api/admin/assessments/{template['id']}/distribute"
    new = (await admin_client.post(path, json={'request_id': str(uuid4()), 'class_name': '解构班'})).json()['data']
    pending = (await client.get('/api/assessments/pending', headers=auth_headers)).json()['data']
    assert pending['id'] == new['id'] and pending['phase'] == 'post'
    async with test_db() as db:
        assert not (await db.get(AssessmentRound, UUID(first['id']))).enabled
        assert await db.scalar(select(func.count()).select_from(AssessmentRound).where(
            AssessmentRound.enabled.is_(True), AssessmentRound.class_name == '解构班')) == 1
    await client.post(f"/api/assessments/{new['id']}/responses", headers=auth_headers,
                      json={'answers': {'q1': '2'}, 'started_at': pending['served_at']})
    assert (await client.get('/api/assessments/pending', headers=auth_headers)).json()['data'] is None
    # Another intentional delivery creates a new response identity, preserving the old answer.
    again = (await admin_client.post(path, json={'request_id': str(uuid4()), 'class_name': '解构班'})).json()['data']
    assert again['id'] != new['id']
    assert (await client.get('/api/assessments/pending', headers=auth_headers)).json()['data']['id'] == again['id']
    async with test_db() as db:
        assert await db.scalar(select(func.count()).select_from(AssessmentResponse)) == 1


@pytest.mark.asyncio
async def test_delivery_requires_teacher_without_admin_fixture_override(client, auth_headers):
    path = f'/api/admin/assessments/{uuid4()}/distribute'
    body = {'request_id': str(uuid4()), 'class_name': '解构班'}
    assert (await client.post(path, headers=auth_headers, json=body)).status_code == 403
    assert (await client.post(path, json=body)).status_code in (401, 403)


@pytest.mark.asyncio
async def test_lightweight_status_and_40_student_submission_burst(admin_client, client, test_db):
    """Bounded local concurrency check in *_test only, not a production benchmark."""
    from time import perf_counter
    from sqlalchemy import event
    users = [User(student_id=f'burst-{i}', name=f'测试{i}', class_name='解构班', experiment_group='pdt') for i in range(40)]
    other = User(student_id='burst-other', name='另一班', class_name='开发班')
    async with test_db() as db:
        db.add_all([*users, other])
        await db.commit()
    headers = [{'Authorization': f'Bearer {create_access_token(str(u.id))}'} for u in users]
    other_headers = {'Authorization': f'Bearer {create_access_token(str(other.id))}'}
    assert (await client.get('/api/assessments/status')).status_code in (401, 403)
    item = await publish(admin_client, draft(class_name='解构班'))
    queries = []
    engine = test_db.kw['bind'].sync_engine
    def record(_conn, _cursor, statement, _params, _context, _many):
        queries.append(statement)
    event.listen(engine, 'before_cursor_execute', record)
    start = perf_counter()
    try:
        statuses = await asyncio.gather(*(client.get('/api/assessments/status', headers=h) for h in headers))
    finally:
        event.remove(engine, 'before_cursor_execute', record)
    poll_ms = (perf_counter() - start) * 1000
    assert all(r.status_code == 200 and r.json()['data'] == {'id': item['id'], 'revision': item['revision']} for r in statuses)
    assert all(r.headers['cache-control'] == 'no-store' and len(r.content) < 150 for r in statuses)
    assert not any('assessment_rounds.questions' in q for q in queries)
    assert (await client.get('/api/assessments/status', headers=other_headers)).json()['data'] is None
    start = perf_counter()
    papers = await asyncio.gather(*(client.get('/api/assessments/pending', headers=h) for h in headers))
    assert all(r.status_code == 200 and r.headers['cache-control'] == 'no-store' for r in papers)
    submissions = await asyncio.gather(*(client.post(f"/api/assessments/{item['id']}/responses", headers=h,
        json={'answers': {'q1': '1'}, 'started_at': paper.json()['data']['served_at']}) for h, paper in zip(headers, papers)))
    submit_ms = (perf_counter() - start) * 1000
    assert all(r.status_code == 200 for r in submissions)
    completed = await asyncio.gather(*(client.get('/api/assessments/status', headers=h) for h in headers))
    assert all(r.json()['data'] is None for r in completed)
    async with test_db() as db:
        assert await db.scalar(select(func.count()).select_from(AssessmentResponse)) == 40
    print(f'LOCAL_ONLY: 40 status requests {poll_ms:.0f} ms; 40 full-fetch + submissions {submit_ms:.0f} ms; no losses')
