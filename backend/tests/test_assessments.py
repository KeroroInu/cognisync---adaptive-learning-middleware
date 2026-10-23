from datetime import datetime, timezone

import pytest
from sqlalchemy import func, select

from app.models.sql import AssessmentResponse, ProfileSnapshot, User


def draft(phase="pre", class_name=""):
    return {"phase": phase, "name": "测试题本", "class_name": class_name, "source": "接口测试，不是正式量表", "questions": [
        {"id": "q1", "text": "测试问题", "type": "choice", "required": True, "options": [{"value": "1", "label": "选项一"}, {"value": "2", "label": "选项二"}]},
        {"id": "q2", "text": "可以补充", "type": "text", "required": False, "options": []},
    ]}


async def publish(admin_client, body):
    response = await admin_client.post('/api/admin/assessments', json=body)
    assert response.status_code == 200, response.text
    item = response.json()['data']
    assert (await admin_client.post(f"/api/admin/assessments/{item['id']}/availability", json={"enabled": True})).status_code == 200
    return item


@pytest.mark.asyncio
async def test_background_template_readonly_and_valid(admin_client, client, auth_headers):
    before = (await admin_client.get('/api/admin/assessments')).json()['data']
    url = '/api/admin/assessments/templates/learning-background'
    response = await admin_client.get(url)
    assert response.status_code == 200, response.text
    template = response.json()['data']
    assert len(template['questions']) == 12
    assert all(not q['required'] for q in template['questions'])
    assert any(q['show_if'] for q in template['questions'])
    assert (await admin_client.get('/api/admin/assessments')).json()['data'] == before
    created = await admin_client.post('/api/admin/assessments', json=template)
    assert created.status_code == 200, created.text
    assert created.json()['data']['enabled'] is False


@pytest.mark.asyncio
async def test_assessment_closed_open_submit_resume_no_profile(admin_client, client, auth_headers, test_db):
    assert (await client.get('/api/assessments/pending', headers=auth_headers)).json()['data'] is None
    response = await admin_client.post('/api/admin/assessments', json=draft())
    item = response.json()['data']
    assert (await client.get('/api/assessments/pending', headers=auth_headers)).json()['data'] is None
    await admin_client.post(f"/api/admin/assessments/{item['id']}/availability", json={"enabled": True})
    pending = (await client.get('/api/assessments/pending', headers=auth_headers)).json()['data']
    assert pending['phase'] == 'pre' and 'source' not in pending
    async with test_db() as db:
        profiles = await db.scalar(select(func.count()).select_from(ProfileSnapshot))
    body = {"answers": {"q1": "2"}, "started_at": pending['served_at']}
    url = f"/api/assessments/{item['id']}/responses"
    assert (await client.post(url, json=body, headers=auth_headers)).status_code == 200
    assert (await client.post(url, json=body, headers=auth_headers)).json()['data']['already_submitted']
    assert (await client.post(url, json={**body, "answers": {"q1": "1"}}, headers=auth_headers)).status_code == 409
    assert (await client.get('/api/assessments/pending', headers=auth_headers)).json()['data'] is None
    # Reopening the same publication does not create a new test round.
    for enabled in (False, True):
        await admin_client.post(f"/api/admin/assessments/{item['id']}/availability", json={"enabled": enabled})
    assert (await client.get('/api/assessments/pending', headers=auth_headers)).json()['data'] is None
    async with test_db() as db:
        assert await db.scalar(select(func.count()).select_from(ProfileSnapshot)) == profiles
        assert await db.scalar(select(func.count()).select_from(AssessmentResponse)) == 1


@pytest.mark.asyncio
async def test_version_freeze_scope_and_post_round(admin_client, client, auth_headers, test_db, test_user_id):
    async with test_db() as db:
        user = await db.get(User, test_user_id)
        user.class_name = '一班'
        await db.commit()
    first = await publish(admin_client, draft())
    assert (await admin_client.put(f"/api/admin/assessments/{first['id']}", json=draft())).status_code == 409
    specific = await publish(admin_client, draft(class_name='一班'))
    assert (await client.get('/api/assessments/pending', headers=auth_headers)).json()['data']['id'] == specific['id']
    other = await publish(admin_client, draft(class_name='二班'))
    assert (await client.post(f"/api/assessments/{other['id']}/responses", headers=auth_headers,
        json={"answers": {"q1": "1"}, "started_at": datetime.now(timezone.utc).isoformat()})).status_code == 404
    post = await publish(admin_client, draft('post'))
    for item in (first, specific):
        await admin_client.post(f"/api/admin/assessments/{item['id']}/availability", json={"enabled": False})
    assert (await client.get('/api/assessments/pending', headers=auth_headers)).json()['data']['id'] == post['id']


@pytest.mark.asyncio
async def test_validation_close_and_single_active_version(admin_client, client, auth_headers):
    first = await publish(admin_client, draft())
    pending = (await client.get('/api/assessments/pending', headers=auth_headers)).json()['data']
    url = f"/api/assessments/{first['id']}/responses"
    for answers in ({}, {"q1": "99"}, {"q1": "1", "fake": "1"}, {"q1": "1", "q2": "x" * 4001}):
        assert (await client.post(url, headers=auth_headers, json={"answers": answers, "started_at": pending['served_at']})).status_code == 422
    second = await publish(admin_client, draft())
    assert second['revision'] == first['revision'] + 1
    assert (await client.post(url, headers=auth_headers, json={"answers": {"q1": "1"}, "started_at": pending['served_at']})).status_code == 409
    rows = (await admin_client.get('/api/admin/assessments')).json()['data']
    assert sum(item['enabled'] for item in rows) == 1
    invalid = draft()
    invalid['questions'].append(invalid['questions'][0])
    assert (await admin_client.post('/api/admin/assessments', json=invalid)).status_code == 422
    invalid = draft()
    invalid['questions'][0]['options'][1]['value'] = '1'
    assert (await admin_client.post('/api/admin/assessments', json=invalid)).status_code == 422


@pytest.mark.asyncio
async def test_assessment_authorization(client, auth_headers):
    from uuid import uuid4
    assert (await client.get('/api/assessments/pending')).status_code in (401, 403)
    assert (await client.get('/api/admin/assessments', headers=auth_headers)).status_code == 403
    assert (await client.get('/api/admin/assessments/templates/learning-background', headers=auth_headers)).status_code == 403
    assert (await client.get(f'/api/admin/assessments/{uuid4()}/export', headers=auth_headers)).status_code == 403
    assert (await client.post('/api/admin/assessments', headers=auth_headers, json=draft())).status_code == 403


@pytest.mark.asyncio
async def test_survey_branch_validation_and_csv(admin_client, client, auth_headers):
    import csv
    import io
    import json
    from pathlib import Path
    survey = json.loads((Path(__file__).parents[1] / 'app/resources/programming_ai_survey_v1.json').read_text())
    item = await publish(admin_client, survey)
    pending = (await client.get('/api/assessments/pending', headers=auth_headers)).json()['data']
    answers = {'q1': ['none'], 'q2': ['none'], 'q3': 'none', 'q8': 'never', 'q17': ['comments', 'blanks'], 'q18': ['unused'], 'q19': None}
    url = f"/api/assessments/{item['id']}/responses"
    for invalid in ({**answers, 'q12': ['generate']}, {**answers, 'q17': ['none', 'comments']}, {**answers, 'q17': ['comments'] * 2}, {**answers, 'q17': ['comments', 'blanks', 'debug', 'test']}, {**answers, 'q1': 'none'}):
        assert (await client.post(url, headers=auth_headers, json={'answers': invalid, 'started_at': pending['served_at']})).status_code == 422
    body = {'answers': answers, 'started_at': pending['served_at']}
    assert (await client.post(url, headers=auth_headers, json=body)).status_code == 200
    assert (await client.post(url, headers=auth_headers, json=body)).json()['data']['already_submitted']
    export_url = f"/api/admin/assessments/{item['id']}/export"
    exported = await admin_client.get(export_url)
    assert exported.status_code == 200, exported.text
    rows = {row['question_id']: row for row in csv.DictReader(io.StringIO(exported.content.decode('utf-8-sig')))}
    assert len(rows) == 20
    assert rows['q12']['status'] == 'skipped_by_rule'
    assert rows['q19']['status'] == 'unanswered'
    assert rows['q17']['status'] == 'answered'
    assert json.loads(rows['q17']['answer_value']) == ['comments', 'blanks']
    assert '简短注释' in rows['q17']['answer_label']


@pytest.mark.asyncio
async def test_cyclic_or_unknown_branch_rejected(admin_client):
    body = draft()
    body['questions'][0]['show_if'] = [{'question_id': 'q2', 'values': ['1']}]
    assert (await admin_client.post('/api/admin/assessments', json=body)).status_code == 422
    body = draft()
    body['questions'][1]['show_if'] = [{'question_id': 'q1', 'values': ['fake']}]
    assert (await admin_client.post('/api/admin/assessments', json=body)).status_code == 422
