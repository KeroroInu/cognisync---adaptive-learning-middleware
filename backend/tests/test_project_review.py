import asyncio
import io
import json
import zipfile
from uuid import uuid4, UUID
import pytest
from sqlalchemy import select
from app.models.sql import ProjectReviewResponse, ProjectReviewEvent, ResearchTaskSubmission
from test_classroom import classroom_actors as actors_fixture
from test_common_support import setup_lesson

classroom_actors = actors_fixture
pytestmark = pytest.mark.asyncio
ADMIN = '/api/admin/project-review'


async def prepared(client, db, a):
    lesson, task = await setup_lesson(client, db, a)
    async with db() as session:
        session.add(ResearchTaskSubmission(task_id=task, user_id=a['first_id'], code_submitted='def move(snake):\n    return snake[1:]'))
        await session.commit()
    spec = (await client.get(ADMIN + '/template', headers=a['teacher'])).json()['data']
    rid = str(uuid4())
    r = await client.post(ADMIN + '/rounds', headers=a['teacher'], json={'request_id':rid, 'session_ids':[lesson['id']]})
    assert r.status_code == 200, r.text
    return rid, spec['template_hash'], task


async def control(client, a, rid, hash, action, **extra):
    return await client.post(f'{ADMIN}/rounds/{rid}/control', headers=a['teacher'], json={'action':action, 'template_hash':hash, **extra})


async def current(client, headers):
    r = await client.get('/api/project-review/current', headers=headers)
    assert r.status_code == 200, r.text
    return r.json()['data']


async def save(client, a, row, action, answers):
    body = {'request_id':str(uuid4()), 'revision':row['revision'], 'action':action, 'answers':answers}
    r = await client.post(f"/api/project-review/{row['id']}/save", headers=a['first'], json=body)
    assert r.status_code == 200, r.text
    return r.json()['data'], body


async def test_lifecycle_freeze_prediction_scoring_and_export(client, test_db, classroom_actors):
    a=classroom_actors
    rid, hash, task = await prepared(client,test_db,a)
    assert await current(client,a['first']) is None
    assert (await control(client,a,rid,hash,'open')).status_code == 200
    row = await current(client,a['first'])
    assert row['ai_hold'] and 'rubric' not in row and 'grade' not in row
    status=(await client.get('/api/project-review/current?status_only=true',headers=a['first'])).json()['data']
    assert status['id']==row['id'] and status['ai_hold']
    assert not {'snapshot','answers','template','grade','rubric'} & status.keys()
    assert (await current(client,a['second']))['template_hash'] == hash
    assert await current(client,a['other']) is None
    r = await client.post(f"/api/project-review/{row['id']}/begin", headers=a['second'])
    assert r.status_code == 404
    row=(await client.post(f"/api/project-review/{row['id']}/begin",headers=a['first'])).json()['data']
    assert row['snapshot']['files']['main.py'].startswith('def move')
    async with test_db() as db:
        source=await db.scalar(select(ResearchTaskSubmission).where(ResearchTaskSubmission.user_id==a['first_id']))
        source.code_submitted='changed later'
        await db.commit()
    assert (await current(client,a['first']))['snapshot_hash']==row['snapshot_hash']
    answer={'snippets':[{'file':'main.py','start':1,'end':2}], 'q1':'切片处理尾部', 'q2_choice':'3 0', 'q2_reason':'条件为假'}
    row,_=await save(client,a,row,'prediction',answer)
    answer.update(q2_choice='4 10',move={'expected':'不变','status':'无法完成','reason':'我的代码还没接好'},eat={'expected':'增加1','status':'证据不足'})
    row,_=await save(client,a,row,'plan',answer)
    run={'request_id':str(uuid4()),'scenario':'move','before':3,'after':3,'snapshot_hash':row['snapshot_hash'],'output':['browser observation']}
    rr=await client.post(f"/api/project-review/{row['id']}/runs",headers=a['first'],json=run)
    assert rr.status_code==200,rr.text
    answer['move']['run_id']=rr.json()['data']['id']
    row,body=await save(client,a,row,'submit',answer)
    assert row['first_prediction']['choice']=='3 0' and row['answers']['q2_choice']=='4 10' and row['ai_hold']
    assert (await client.post(f"/api/project-review/{row['id']}/save",headers=a['first'],json=body)).status_code==200
    assert (await client.post(f"/api/project-review/{row['id']}/save",headers=a['first'],json={**body,'request_id':str(uuid4())})).status_code==409
    gr=await client.post(f"{ADMIN}/responses/{row['id']}/grade",headers=a['teacher'],json={'scores':[2,3,2],'notes':['','','']})
    assert gr.status_code==200,gr.text
    assert 'grade' not in await current(client,a['first'])
    assert (await control(client,a,rid,hash,'publish',confirmed_both_groups_ended=True)).status_code==409
    assert (await control(client,a,rid,hash,'end')).status_code==200
    assert not (await current(client,a['first']))['ai_hold']
    assert (await control(client,a,rid,hash,'publish')).status_code==409
    assert (await control(client,a,rid,hash,'publish',confirmed_both_groups_ended=True)).status_code==200
    assert (await current(client,a['first']))['grade']['total']==7
    assert (await current(client,a['second']))['grade'] is None
    package=await client.get('/api/admin/export/research-package?include_graph=false',headers=a['teacher'])
    assert package.status_code==200,package.text[:200]
    archive=zipfile.ZipFile(io.BytesIO(package.content))
    assert all(name+'.jsonl' in archive.namelist() for name in ['project_review_rounds','project_review_responses','project_review_events'])
    records=[json.loads(line) for line in archive.read('project_review_events.jsonl').splitlines()]
    assert any(r['kind']=='run' and r['payload']['verified_by_server'] is False for r in records)


async def test_all_learning_ai_and_history_blocked_until_teacher_end(client,test_db,classroom_actors):
    a=classroom_actors
    rid,hash,_=await prepared(client,test_db,a)
    assert (await client.get(ADMIN+'/template',headers=a['first'])).status_code==403
    assert (await control(client,a,rid,'wrong','open')).status_code==409
    await control(client,a,rid,hash,'open')
    for method,path,body in [('POST','/api/chat',{'message':'给答案'}),('POST','/api/preparation/records',{'kind':'chat'}),
                              ('GET','/api/learning-support/state',None),('GET','/api/chat/sessions',None),
                              ('POST','/api/onboarding/ai/start',{}),('GET','/api/knowledge-graph',None),
                              ('GET','/api/research/active-task',None)]:
        r=await client.request(method,path,headers=a['first'],json=body)
        assert r.status_code==423,(path,r.text)
    assert (await client.get('/api/classroom/state',headers=a['first'])).status_code==200
    await control(client,a,rid,hash,'end')
    assert (await client.get('/api/research/active-task',headers=a['first'])).status_code==200


async def test_inflight_ai_response_suppressed_when_review_opens(client,test_db,classroom_actors,monkeypatch):
    a=classroom_actors
    rid,hash,_=await prepared(client,test_db,a)
    entered,release=asyncio.Event(),asyncio.Event()
    async def reply(*args,**kwargs):
        entered.set()
        await release.wait()
        return 'THIS_ANSWER_MUST_NOT_BE_DELIVERED'
    monkeypatch.setattr('app.api.endpoints.chat._complete_chat_reply',reply)
    pending=asyncio.create_task(client.post('/api/chat',headers=a['first'],json={'message':'解释列表'}))
    await asyncio.wait_for(entered.wait(),5)
    try:
        assert (await control(client,a,rid,hash,'open')).status_code==200
    finally:
        release.set()
    result=await pending
    assert result.status_code==423 and 'THIS_ANSWER' not in result.text


async def test_no_run_before_prediction_or_false_references(client,test_db,classroom_actors):
    a=classroom_actors
    rid,hash,_=await prepared(client,test_db,a)
    await control(client,a,rid,hash,'open')
    row=await current(client,a['first'])
    row=(await client.post(f"/api/project-review/{row['id']}/begin",headers=a['first'])).json()['data']
    r=await client.post(f"/api/project-review/{row['id']}/runs",headers=a['first'],json={'request_id':str(uuid4()),'scenario':'eat','snapshot_hash':row['snapshot_hash']})
    assert r.status_code==409
    for answers in [{'q1':'字'*201},{'snippets':[{'file':'missing','start':1,'end':1}]},{'move':{'run_id':str(uuid4())}}]:
        r=await client.post(f"/api/project-review/{row['id']}/save",headers=a['first'],json={'request_id':str(uuid4()),'revision':0,'answers':answers})
        assert r.status_code==422,r.text
    async with test_db() as db:
        assert (await db.get(ProjectReviewResponse,UUID(row['id']))).grade is None
        assert len((await db.scalars(select(ProjectReviewEvent).where(ProjectReviewEvent.response_id==UUID(row['id'])))).all())==2


async def test_queued_model_rechecks_before_dispatch(client,test_db,classroom_actors,monkeypatch):
    from app.services.classroom_service import ensure_queued_llm_access
    a=classroom_actors
    rid,hash,_=await prepared(client,test_db,a)
    entered,release=asyncio.Event(),asyncio.Event()
    dispatched=[]
    async def reply(*args,**kwargs):
        entered.set()
        await release.wait()
        await ensure_queued_llm_access()
        dispatched.append(True)
        return 'not dispatched'
    monkeypatch.setattr('app.api.endpoints.chat._complete_chat_reply',reply)
    pending=asyncio.create_task(client.post('/api/chat',headers=a['first'],json={'message':'解释列表'}))
    await asyncio.wait_for(entered.wait(),5)
    try:
        assert (await control(client,a,rid,hash,'open')).status_code==200
        # A short round ending before the queued request resumes must not revive it.
        assert (await control(client,a,rid,hash,'end')).status_code==200
    finally:
        release.set()
    result=await pending
    assert result.status_code==423 and not dispatched
