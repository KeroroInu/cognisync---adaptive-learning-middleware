"""Batch assignment and assistant credentials; isolated *_test database only."""
import json
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select
from app.models.sql import User
from app.models.sql.system_config import SystemConfig
from app.services import llm_config
from tests.test_classroom import classroom_actors

pytestmark = pytest.mark.asyncio


async def unassigned(test_db, count=1):
    async with test_db() as db:
        rows = [User(student_id=f"setup_{uuid4().hex}", name=f"新学生{i}", role="learner", experiment_group="unassigned", school_class="高一（1）班") for i in range(count)]
        db.add_all(rows)
        await db.commit()
        return [str(row.id) for row in rows]


async def test_select_all_snapshot_across_pages_then_assign(client, test_db, classroom_actors):
    headers = classroom_actors['teacher']
    ids = await unassigned(test_db, 23)
    page = (await client.get('/api/admin/users?experiment_group=unassigned&page_size=10', headers=headers)).json()['data']
    assert page['total'] == 23 and len(page['users']) == 10
    selected = (await client.get('/api/admin/users/unassigned-ids', headers=headers)).json()['data']['ids']
    assert set(selected) == set(ids)
    searched = (await client.get('/api/admin/users/unassigned-ids?query=新学生22', headers=headers)).json()['data']['ids']
    assert len(searched) == 1
    later = await unassigned(test_db)
    result = await client.post('/api/admin/users/batch-assign', headers=headers, json={'user_ids': selected + selected[:1], 'class_name': '解构班'})
    assert result.status_code == 200 and result.json()['data']['assigned'] == 23
    async with test_db() as db:
        for uid in ids:
            student = await db.get(User, UUID(uid))
            assert (student.class_name, student.experiment_group, student.school_class) == ('解构班', 'pdt', '高一（1）班')
        assert (await db.get(User, UUID(later[0]))).experiment_group == 'unassigned'
    assert (await client.get('/api/admin/users/unassigned-ids', headers=headers)).json()['data']['ids'] == later


async def test_batch_assignment_conflicts_are_all_or_nothing(client, test_db, classroom_actors):
    headers = classroom_actors['teacher']
    ids = await unassigned(test_db, 2)
    for extra in (str(classroom_actors['teacher_id']), str(classroom_actors['first_id']), str(uuid4())):
        result = await client.post('/api/admin/users/batch-assign', headers=headers, json={'user_ids': ids + [extra], 'class_name': '开发班'})
        assert result.status_code == 409
    # Another teacher assigned one selected learner after the snapshot.
    assert (await client.patch('/api/admin/users/' + ids[0], headers=headers, json={'class_name': '解构班'})).status_code == 200
    result = await client.post('/api/admin/users/batch-assign', headers=headers, json={'user_ids': ids, 'class_name': '开发班'})
    assert result.status_code == 409
    async with test_db() as db:
        assert (await db.get(User, UUID(ids[0]))).class_name == '解构班'
        assert (await db.get(User, UUID(ids[1]))).class_name is None
    assert (await client.post('/api/admin/users/batch-assign', headers=headers, json={'user_ids': [ids[1]], 'class_name': '开发班'})).status_code == 200


async def test_new_teacher_actions_require_admin(client, classroom_actors):
    for headers in ({}, classroom_actors['first']):
        expected = 401 if not headers else 403
        assert (await client.get('/api/admin/users/unassigned-ids', headers=headers)).status_code == expected
        assert (await client.post('/api/admin/users/batch-assign', headers=headers, json={'user_ids': [str(classroom_actors['first_id'])], 'class_name': '开发班'})).status_code == expected
        assert (await client.get('/api/admin/config/llm', headers=headers)).status_code == expected
        assert (await client.put('/api/admin/config/llm', headers=headers, json={'role': 'chat', 'config': {'provider': 'mock'}})).status_code == expected


def config(**changes):
    return {'provider': 'deepseek', 'base_url': 'https://api.deepseek.com/v1', 'model': 'deepseek-chat', **changes}


async def test_key_is_write_only_persistent_and_used_by_chat(admin_client, test_db):
    secret = 'sk-test-only-not-real'
    result = await admin_client.put('/api/admin/config/llm', json={'role': 'chat', 'config': config(api_key=secret)})
    assert result.status_code == 200 and secret not in result.text
    provider = llm_config.get_chat_provider()
    assert llm_config._provider_cache['chat'][0][-1] == secret
    public = await admin_client.get('/api/admin/config/llm')
    assert secret not in public.text and 'api_key' not in public.json()['data']['chat']
    assert public.json()['data']['chat']['has_api_key'] is True
    assert public.json()['data']['analysis']['provider'] == 'mock'
    result = await admin_client.put('/api/admin/config/llm', json={'role': 'chat', 'config': config(model='another-model')})
    assert result.status_code == 200
    async with test_db() as db:
        row = await db.scalar(select(SystemConfig).where(SystemConfig.key == 'chat_llm'))
        assert json.loads(row.value)['api_key'] == secret
        llm_config._config_cache.clear()
        await llm_config.load_from_db(db)
    assert llm_config.get_current_config()['chat']['model'] == 'another-model'
    assert llm_config.get_current_config()['chat']['api_key'] == secret
    # Existing key cannot be silently sent to a different host.
    result = await admin_client.put('/api/admin/config/llm', json={'role': 'chat', 'config': config(base_url='https://other.example/v1')})
    assert result.status_code == 422
    await admin_client.put('/api/admin/config/llm', json={'role': 'chat', 'config': {'provider': 'mock', 'clear_api_key': True}})
    assert llm_config.get_current_config()['chat']['api_key'] == ''
    assert (await admin_client.get('/api/admin/config/llm')).json()['data']['chat']['has_api_key'] is False
    await llm_config.close_providers()


@pytest.mark.parametrize('invalid', ['中文key', 'sk-invalid\nline', 'sk-invalid space'])
async def test_bad_keys_are_rejected_without_echo(admin_client, invalid):
    response = await admin_client.put('/api/admin/config/llm', json={'role': 'chat', 'config': config(api_key=invalid)})
    assert response.status_code == 422 and invalid not in response.text


@pytest.mark.parametrize('body', [{'user_ids': [], 'class_name': '开发班'}, {'user_ids': [str(uuid4())], 'class_name': '未知班'}])
async def test_batch_validation(admin_client, body):
    assert (await admin_client.post('/api/admin/users/batch-assign', json=body)).status_code == 422
