from types import SimpleNamespace
import asyncio

import pytest

from app.services import common_support as policy
from app.services.project_review import freeze_source
from test_common_support import classroom_actors as actors_fixture, setup_lesson, ask
from test_classroom import change_state

classroom_actors = actors_fixture


def test_basic_prompt_has_one_contract_and_keeps_legacy_prompt():
    basic = policy.prompt(SimpleNamespace(focus='basic-snake/v1', entry='classroom', action='message'), policy.initial_state(), 'code_help', [])
    assert '10×10' in basic and '（行，列）' in basic and 'won=True' in basic
    assert '12×12' not in basic and 'set_timer(' not in basic
    assert '异步while循环' in basic and 'WASD只改变下一轮方向' in basic
    assert '每按一次只走一格' not in basic
    legacy = policy.prompt(SimpleNamespace(focus='workspace', entry='classroom', action='message'), policy.initial_state(), 'code_help', [])
    assert '12×12' in legacy


def test_frozen_basic_work_cannot_pick_legacy_modules():
    saved = SimpleNamespace(id='saved', code_submitted='new code', workspace_data={
        'basicSnake': {'runtime': 'basic-snake/v1', 'code': 'new code'},
        'progress': {'base::movement': {'code': 'legacy'}}, 'creativeFunctions': []})
    frozen, _ = freeze_source(saved)
    assert frozen['files'] == {'main.py': 'new code'}
    assert frozen['runtime'] == 'basic-snake/v1'
    saved.workspace_data.pop('basicSnake')
    frozen, _ = freeze_source(saved)
    assert frozen['files']['base::movement'] == 'legacy'


@pytest.mark.asyncio
async def test_atomic_save_preserves_legacy_and_isolates_students(client, test_db, classroom_actors):
    actors = classroom_actors
    _, task_id = await setup_lesson(client, test_db, actors)
    root = f'/api/research/tasks/{task_id}'
    legacy = {'progress': {'base::movement': {'code': 'old module'}}, 'observations': ['old card']}
    assert (await client.post(root + '/save-workspace', headers=actors['first'], json={'workspace_data': legacy})).status_code == 200
    assert (await client.post(root + '/save-progress', headers=actors['first'], json={'code_submitted': 'old submitted'})).status_code == 200
    body = {'runtime': 'basic-snake/v1', 'code': 'new code', 'revision': 0}
    saved = await client.post(root + '/save-basic-snake', headers=actors['first'], json=body)
    assert saved.status_code == 200, saved.text
    assert saved.json()['data']['revision'] == 1
    assert (await client.post(root + '/save-basic-snake', headers=actors['first'], json=body)).json()['data']['revision'] == 1
    conflict = await client.post(root + '/save-basic-snake', headers=actors['first'], json={**body, 'code': 'stale tab'})
    assert conflict.status_code == 409
    loaded = (await client.get('/api/research/active-task', headers=actors['first'])).json()['data']
    assert loaded['workspace_data']['progress'] == legacy['progress']
    assert loaded['workspace_data']['observations'] == legacy['observations']
    assert loaded['workspace_data']['basicSnake']['legacy_code_submitted'] == 'old submitted'
    assert loaded['code_submitted'] == 'new code'
    second = (await client.get('/api/research/active-task', headers=actors['second'])).json()['data']
    assert not (second.get('workspace_data') or {}).get('basicSnake')
    empty = await client.post(root + '/save-basic-snake', headers=actors['first'], json={**body, 'code': '', 'revision': 1})
    assert empty.status_code == 200
    loaded = (await client.get('/api/research/active-task', headers=actors['first'])).json()['data']
    assert loaded['code_submitted'] == '' and loaded['workspace_data']['basicSnake']['code'] == ''
    assert (await client.post(root + '/save-basic-snake', json=body)).status_code == 401
    assert (await client.post(root + '/save-basic-snake', headers=actors['first'], json={**body, 'code': 'x' * 50001})).status_code == 422


@pytest.mark.asyncio
async def test_both_classes_use_same_basic_ai_scope(client, test_db, classroom_actors):
    _, task_id = await setup_lesson(client, test_db, classroom_actors)
    for who in ('first', 'second'):
        reply = await ask(client, classroom_actors[who], task=task_id, focus='basic-snake/v1')
        assert reply['support']['level'] == 0
        state = await client.get(f'/api/learning-support/state?task_id={task_id}&stage=build&focus=basic-snake/v1&entry=classroom', headers=classroom_actors[who])
        assert state.status_code == 200
        assert len(state.json()['data']['history']) == 1
    from sqlalchemy import select
    from app.models.sql import LearningSupportTurn
    async with test_db() as db:
        turns = (await db.scalars(select(LearningSupportTurn))).all()
        assert len(turns) == 2
        assert all('ai_prompt' not in turn.payload['teacher_context'] for turn in turns)
        assert turns[0].payload['prompt_hash'] == turns[1].payload['prompt_hash']


@pytest.mark.asyncio
async def test_retired_end_control_allows_both_students_to_save(client, test_db, classroom_actors):
    actors = classroom_actors
    lesson, task_id = await setup_lesson(client, test_db, actors)
    path = f'/api/research/tasks/{task_id}/save-basic-snake'
    body = {'runtime': 'basic-snake/v1', 'code': 'code', 'revision': 0}
    assert (await client.post(path, headers=actors['first'], json=body)).status_code == 200
    await change_state(client, actors, lesson['id'], 'end')
    assert (await client.post(path, headers=actors['first'], json={**body, 'code': 'last edit', 'revision': 1})).status_code == 200
    assert (await client.post(path, headers=actors['second'], json=body)).status_code == 200


@pytest.mark.asyncio
async def test_parallel_first_save_conflicts_and_teacher_ai_off_is_respected(client, test_db, classroom_actors):
    actors = classroom_actors
    _, task_id = await setup_lesson(client, test_db, actors)
    path = f'/api/research/tasks/{task_id}/save-basic-snake'
    responses = await asyncio.gather(*[
        client.post(path, headers=actors['first'], json={'runtime': 'basic-snake/v1', 'revision': 0, 'code': code})
        for code in ('tab one', 'tab two')
    ])
    assert sorted(r.status_code for r in responses) == [200, 409]
    from app.models.sql import ResearchTask
    async with test_db() as db:
        task = await db.get(ResearchTask, task_id)
        task.ai_enabled = False
        await db.commit()
    for who in ('first', 'second'):
        visible = (await client.get('/api/research/active-task', headers=actors[who])).json()['data']
        assert visible['ai_enabled'] is False
        response = await client.post('/api/chat', headers=actors[who], json={'message': '帮我', 'isResearchMode': True})
        assert response.status_code == 403
