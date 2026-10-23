from uuid import uuid4
import asyncio
import io
import json
import zipfile

import pytest
from sqlalchemy import select

from app.services import common_support as policy
from app.models.sql import LearningSupportTurn, User
from test_classroom import classroom_actors as actors_fixture, start, learning_task, change_state

classroom_actors = actors_fixture


@pytest.mark.asyncio
async def test_offline_function_discussion_is_readable_and_analysis_keeps_json():
    from types import SimpleNamespace
    from app.services.llm_provider import MockProvider

    provider = MockProvider()
    body = SimpleNamespace(entry='function_discussion', action='idea_hint')
    system = policy.prompt(body, policy.initial_state(), 'idea_discussion', [])
    assert '不要求学生猜齐七个' in system
    request = json.dumps({'context': json.dumps({'functionName': '方向移动'})})
    reply = await provider.complete(system, request)
    assert reply.startswith('【离线演示】') and '掉头' in reply
    assert 'detectedConcepts' not in reply
    body.action = 'organize'
    reply = await provider.complete(policy.prompt(body, policy.initial_state(), 'idea_discussion', []), request)
    assert '暂时不能替你整理' in reply and '```steps' not in reply
    legacy = await provider.complete('Analyze this text', '学习循环')
    assert 'detectedConcepts' in json.loads(legacy)


def test_progression_is_not_round_count_or_mastery():
    state = policy.initial_state()
    for action in ['message', 'rephrase', 'understood', 'complete']:
        state, _ = policy.transition(state, action)
        assert state['level'] == 0
    for expected in (1, 2, 2):
        state, _ = policy.transition(state, 'more')
        assert state['level'] == expected
    state, _ = policy.transition(state, 'complete')
    assert state['level'] == 3
    state, _ = policy.transition(state, 'try_self')
    assert state['paused'] and state['level'] == 3 and state['complete_seen']
    state, _ = policy.transition(state, 'restore')
    assert not state['paused'] and state['level'] == 3


async def setup_lesson(client, db, actors):
    async with db() as session:
        user = await session.get(User, actors['second_id'])
        user.experiment_group = 'ai_pbl'
        await session.commit()
    task_id = await learning_task(db)
    lesson = await start(client, actors)
    path = f"/api/admin/classroom/sessions/{lesson['id']}/lesson"
    response = await client.post(path, headers=actors['teacher'], json={
        'tasks': {'pdt': str(task_id), 'ai_pbl': str(task_id)}, 'knowledge_points': ['列表']})
    assert response.status_code == 200, response.text
    assert (await client.post(path + '/start', headers=actors['teacher'])).status_code == 200
    return lesson, task_id


async def ask(client, headers, *, action='message', task=None, stage='build', focus='workspace', **extra):
    body = {'message': '解释列表 append', 'isResearchMode': True, 'supportAction': action,
            'supportRequestId': str(uuid4()), **extra}
    if task:
        body['scaffoldContext'] = {'requestId': str(uuid4()), 'taskId': str(task), 'stage': stage,
                                  'level': 3, 'trigger': 'student_message', 'currentModule': focus}
    result = await client.post('/api/chat', headers=headers, json=body)
    assert result.status_code == 200, result.text
    return result.json()['data']


@pytest.mark.asyncio
async def test_function_shortcuts_reach_dialogue_and_preserve_action(client, test_db, classroom_actors):
    actors = classroom_actors
    _, task_id = await setup_lesson(client, test_db, actors)
    for action in ('idea_hint', 'organize'):
        request_id = str(uuid4())
        result = await client.post('/api/chat', headers=actors['first'], json={
            'message': '帮我想想方向移动', 'isResearchMode': True,
            'supportAction': action, 'supportRequestId': request_id,
            'scaffoldContext': {'requestId': request_id, 'taskId': str(task_id), 'stage':'decompose',
                'level':0, 'trigger':'student_message', 'currentModule':'function-discussion:direction',
                'interaction':'function_discussion', 'artifactSummary':json.dumps({'functionName':'方向移动'})}})
        assert result.status_code == 200, result.text
        assert result.json()['data']['message'].startswith('【离线演示】')
    async with test_db() as db:
        turns = (await db.scalars(select(LearningSupportTurn).where(LearningSupportTurn.user_id == actors['first_id']))).all()
        assert {turn.payload['request']['action'] for turn in turns} == {'idea_hint', 'organize'}


@pytest.mark.asyncio
async def test_groups_share_progression_and_preparation_cannot_bypass(client, test_db, classroom_actors):
    a = classroom_actors
    lesson, task_id = await setup_lesson(client, test_db, a)
    for who in ('first', 'second'):
        initial = await ask(client, a[who], task=task_id if who == 'first' else None)
        assert initial['support']['level'] == 0
        for expected in (1, 2):
            result = await ask(client, a[who], action='more')
            assert result['support']['level'] == expected
        result = await ask(client, a[who], action='complete')
        assert result['support']['level'] == 3
        result = await ask(client, a[who], action='try_self')
        assert result['support']['paused']
        result = await ask(client, a[who], action='understood')
        assert result['support']['paused'] and result['support']['level'] == 3
        restored = (await client.get('/api/learning-support/state', headers=a[who])).json()['data']
        assert restored['level'] == 3 and restored['paused']
        prep = await client.post('/api/preparation/records', headers=a[who], json={
            'request_id': str(uuid4()), 'kind': 'chat', 'message': '继续帮我', 'support_action': 'restore'})
        assert prep.status_code == 200, prep.text
        assert prep.json()['data']['payload']['support']['level'] == 3
    other_scope = await client.get('/api/learning-support/state?focus=another', headers=a['first'])
    assert other_scope.json()['data']['level'] == 0
    async with test_db() as db:
        turns = (await db.scalars(select(LearningSupportTurn))).all()
        assert all(t.payload['mastery'] is None for t in turns)
        assert {t.payload['group_snapshot'] for t in turns} == {'pdt', 'ai_pbl'}
    await change_state(client, a, lesson['id'], 'end')
    assert (await client.get('/api/learning-support/state', headers=a['first'])).status_code == 200


@pytest.mark.asyncio
async def test_practice_review_answer_provenance_and_exit(client, test_db, classroom_actors):
    a = classroom_actors
    lesson, _ = await setup_lesson(client, test_db, a)
    assert not (await ask(client, a['first']))['support']['practice_available']
    templates = (await client.get('/api/learning-support/practice-templates', headers=a['teacher'])).json()['data']
    template = templates[0]
    path = f"/api/learning-support/practice-templates/{template['id']}/review?approved=true&content_hash={template['content_hash']}"
    assert (await client.post(path, headers=a['first'])).status_code == 403
    assert (await client.post(path, headers=a['teacher'])).status_code == 200
    assert (await ask(client, a['first']))['support']['practice_available']
    practice = (await ask(client, a['first'], action='practice'))['support']['practice']
    pid = practice['instance_id']
    assert 'answer' not in practice and 'rubric' not in practice
    result = await ask(client, a['first'], action='answer', supportPracticeId=pid, supportAnswer='3')
    assert result['support']['practice']['answered'] and result['support']['level'] == 0
    result = await ask(client, a['first'], action='return_project', supportPracticeId=pid)
    assert result['support']['practice'] is None
    bad = await client.post('/api/chat', headers=a['second'], json={'message': '看答案', 'supportAction': 'show_answer', 'supportPracticeId': pid})
    assert bad.status_code == 404
    evidence = await client.get(f"/api/admin/classroom/sessions/{lesson['id']}/evidence?source=process", headers=a['teacher'])
    assert evidence.status_code == 200, evidence.text
    assert any(item['source'] == 'support' for item in evidence.json()['data']['items'])
    graph = await client.get(f"/api/learning-support/evidence-graph?session_id={lesson['id']}", headers=a['teacher'])
    assert graph.status_code == 200
    assert all(node['status'] == 'candidate' for node in graph.json()['data']['nodes'])
    package = await client.get('/api/admin/export/research-package?include_graph=false', headers=a['teacher'])
    assert package.status_code == 200, package.text[:200] if package.status_code != 200 else ''
    archive = zipfile.ZipFile(io.BytesIO(package.content))
    turns = [json.loads(line) for line in archive.read('learning_support_turns.jsonl').splitlines()]
    issued = next(t for t in turns if t['request_id'] == pid)
    assert issued['payload']['exercise_evidence']['review']['reviewed_by'] == str(a['teacher_id'])
    assert issued['payload']['exercise_evidence']['template']['rubric']
    index = [json.loads(line) for line in archive.read('learning_process.jsonl').splitlines()]
    assert sum(r['source_table'] == 'learning_support_turns' for r in index) == len(turns)
    assert not any(r['source_table'] == 'chat_messages' for r in index)


@pytest.mark.asyncio
async def test_common_model_policy_replay_failure_and_concurrency(client, test_db, classroom_actors, monkeypatch):
    a = classroom_actors
    await setup_lesson(client, test_db, a)
    prompts = []
    entered, release = asyncio.Event(), asyncio.Event()
    async def complete(provider, **kwargs):
        prompts.append((kwargs['system_prompt'], kwargs['max_tokens']))
        if 'WAIT_FOR_TEST' in kwargs['user_prompt']:
            entered.set()
            await release.wait()
        return '先看这个小例子。'
    monkeypatch.setattr('app.api.endpoints.chat._complete_chat_reply', complete)
    for actor in ('first', 'second'):
        await ask(client, a[actor])
    assert prompts[0] == prompts[1]
    body = {'message': 'WAIT_FOR_TEST', 'supportRequestId': str(uuid4())}
    pending = asyncio.create_task(client.post('/api/chat', headers=a['first'], json=body))
    await asyncio.wait_for(entered.wait(), 3)
    try:
        duplicate = await client.post('/api/chat', headers=a['first'], json=body)
        assert duplicate.status_code == 409
        other = await ask(client, a['second'], action='understood')
        assert other['support']['level'] == 0
    finally:
        release.set()
    first = await pending
    assert first.status_code == 200, first.text
    replay = await client.post('/api/chat', headers=a['first'], json=body)
    assert replay.status_code == 200 and replay.json()['data']['support']['turn_id'] == first.json()['data']['support']['turn_id']
    assert len(prompts) == 3
    conflict = await client.post('/api/chat', headers=a['first'], json={**body, 'message': 'different'})
    assert conflict.status_code == 409
    async def fail(*args, **kwargs):
        raise RuntimeError('simulated failure')
    monkeypatch.setattr('app.api.endpoints.chat._complete_chat_reply', fail)
    result = await client.post('/api/chat', headers=a['first'], json={'message': 'fail'})
    assert result.status_code == 500
    async with test_db() as db:
        rows = (await db.scalars(select(LearningSupportTurn).where(LearningSupportTurn.user_id == a['first_id']))).all()
        assert any(t.payload['status'] == 'failed' for t in rows)
