"""Isolated *_test DB only; worksheets remain student reports, not scores."""
import csv
import io
import json
from uuid import uuid4
import zipfile

import pytest

from app.api.endpoints.admin.auth import _create_admin_token
from app.models.sql import User
from app.services.worksheet import catalog
from test_classroom import classroom_actors as actors_fixture, start
from test_sfls_materials import unpack, work_archive

classroom_actors = actors_fixture
pytestmark = pytest.mark.asyncio
ADMIN = '/api/admin/classroom'


async def publish(client, a, session, index=0, **kwargs):
    template = catalog()[index]
    body = {'request_id': str(uuid4()), 'title': template['title'], 'task': template['objective'],
        'runtime': 'sfls', 'phase': 'practice', 'project_id': 'snake-course', 'worksheet': template, **kwargs}
    response = await client.post(f'{ADMIN}/sessions/{session}/packages', headers=a['teacher'], json=body)
    return response, body


def answer(a, revision=0, action='plan', **kwargs):
    return {'request_id': str(uuid4()), 'expected_user_id': str(a['first_id']), 'base_revision': revision,
        'action': action, 'analysis_note': '先验证输入怎样更新坐标', 'change_plan': '待验证', 'sources': ['ai'],
        'tests': [{'case': '向右', 'expected': 'x加一', 'actual': '', 'status': 'not_run', 'next_action': ''}], **kwargs}


async def test_catalog_privacy_and_assessment_boundary(client, classroom_actors):
    a = classroom_actors
    assert (await client.get(f'{ADMIN}/worksheet-templates', headers=a['first'])).status_code == 403
    response = await client.get(f'{ADMIN}/worksheet-templates', headers=a['teacher'])
    templates = response.json()['data']
    assert len(templates) == 10
    assert {t['lesson_id'] for t in templates} == {f'C{n:02d}' for n in range(1, 6)}
    for first, second in zip(templates[::2], templates[1::2]):
        assert first['objective'] == second['objective'] and first['acceptance'] == second['acceptance']
        assert (first['analysis_prompt'] == second['analysis_prompt']) == (first['lesson_id'] == 'C01')
    sid = (await start(client, a))['id']
    for phase in ('pre', 'post'):
        response, _ = await publish(client, a, sid, phase=phase)
        assert response.status_code == 422
    response, body = await publish(client, a, sid)
    assert response.status_code == 200, response.text
    assert (await client.post(f'{ADMIN}/sessions/{sid}/packages', headers=a['teacher'], json=body)).json() == response.json()
    modified = {**body, 'worksheet': {**body['worksheet'], 'analysis_prompt': '变更'}}
    assert (await client.post(f'{ADMIN}/sessions/{sid}/packages', headers=a['teacher'], json=modified)).status_code == 409
    item = response.json()['data']
    student = await client.get('/api/materials', headers=a['first'])
    student_text = student.text
    assert 'condition' not in student_text and 'teacher_review' not in student_text and 'common_exit' not in student_text
    base = f'/api/materials/{item["id"]}'
    files = unpack(await client.post(base+'/download', headers=a['first']))
    doc = json.loads(files['design/current/worksheet.json'])
    assert doc['worksheet_revision_id'] is None
    assert doc['answers']['analysis_note'] == ''
    assert 'design/initial/worksheet.json' not in files
    for name, content in files.items():
        if name.endswith(('.md', '.json')):
            text = content.decode()
            assert body['worksheet']['teacher_review'] not in text
            assert body['worksheet']['common_exit'] not in text
            assert templates[3]['analysis_prompt'] not in text
            assert '"condition"' not in text


async def test_version_chain_conflict_identity_history_and_teacher_permissions(client, classroom_actors, test_db):
    a = classroom_actors
    sid = (await start(client, a))['id']
    response, _ = await publish(client, a, sid)
    mid = response.json()['data']['id']
    base = f'/api/materials/{mid}/worksheet'
    assert (await client.get(base, headers=a['other'])).status_code == 404
    body = answer(a)
    first = await client.post(base, headers=a['first'], json=body)
    assert first.status_code == 200, first.text
    saved = first.json()['data']
    assert saved['plan_revision_id'] == saved['worksheet_revision_id']
    assert (await client.post(base, headers=a['first'], json=body)).json() == first.json()
    assert (await client.post(base, headers=a['first'], json={**body, 'analysis_note': 'different'})).status_code == 409
    assert (await client.post(base, headers=a['first'], json=answer(a))).status_code == 409
    assert (await client.post(base, headers=a['second'], json=answer(a))).status_code == 409
    assert (await client.get(base, headers=a['second'])).json()['data']['current'] is None
    second = (await client.post(base, headers=a['first'], json=answer(a, 1, 'closing', closing_note='未完成'))).json()['data']
    assert second['plan_revision_id'] == saved['worksheet_revision_id']
    assert second['parent_revision_id'] == saved['worksheet_revision_id']
    history = (await client.get(base+'/history', headers=a['first'])).json()['data']
    assert history['total'] == 2
    assert history['items'][1]['answers']['analysis_note'] == body['analysis_note']
    assert 'condition' not in json.dumps(history)
    async with test_db() as db:
        other_teacher = User(student_id='other_worksheet_teacher', name='其他教师', role='admin', auth_version=0)
        db.add(other_teacher)
        await db.commit()
        token = _create_admin_token(str(other_teacher.id))
    assert (await client.get(f'{ADMIN}/materials/{mid}/worksheets', headers={'Authorization': f'Bearer {token}'})).status_code == 404
    teacher = await client.get(f'{ADMIN}/materials/{mid}/worksheets', headers=a['teacher'])
    assert teacher.status_code == 200 and teacher.json()['data']['total'] == 2
    assert (await client.get(f'{ADMIN}/materials/{mid}/worksheets', headers=a['first'])).status_code == 403
    following, _ = await publish(client, a, sid, index=2)
    next_base = f'/api/materials/{following.json()["data"]["id"]}/worksheet'
    assert (await client.get(next_base, headers=a['first'])).json()['data']['current'] is None
    assert (await client.get(next_base+'/history?previous=true', headers=a['first'])).json()['data']['total'] == 2
    assert (await client.get(next_base+'/history?previous=true', headers=a['second'])).json()['data']['total'] == 0


async def test_package_receipt_web_versions_and_lossless_export(client, classroom_actors):
    a = classroom_actors
    sid = (await start(client, a))['id']
    response, _ = await publish(client, a, sid)
    mid = response.json()['data']['id']
    base = f'/api/materials/{mid}'
    design = await client.post(base+'/design', headers=a['first'], json={'request_id': str(uuid4()), 'base_revision': 0, 'requirements': '原图', 'nodes': [], 'edges': []})
    assert design.status_code == 200
    body = answer(a, analysis_note='=HYPERLINK("bad")\n第二行', closing_note='逗号,引号"保留')
    plan = (await client.post(base+'/worksheet', headers=a['first'], json=body)).json()['data']
    current = (await client.post(base+'/worksheet', headers=a['first'], json=answer(a, 1, 'progress', decision_note='调整判断', record_source='ai_assisted'))).json()['data']
    downloaded = unpack(await client.post(base+'/download', headers=a['first']))
    task = json.loads(downloaded['sfls-task.json'])
    assert json.loads(downloaded['design/initial/worksheet.json'])['worksheet_revision_id'] == plan['worksheet_revision_id']
    assert json.loads(downloaded['design/current/worksheet.json'])['worksheet_revision_id'] == current['worksheet_revision_id']
    assert json.loads(downloaded['design/current/worksheet.json'])['answers']['record_source'] == 'ai_assisted'
    assert 'AI帮我整理'.encode() in downloaded['design/current/worksheet.md']
    assert task['provenance']['worksheet_context']['plan_revision_id'] == plan['worksheet_revision_id']
    assert current['design_revision'] == 1
    web = (await client.post(base+'/worksheet', headers=a['first'], json=answer(a, 2, 'closing', closing_note='后补'))).json()['data']
    # An actual SFLS-style archive: materials/design copied under evidence/context.
    from app.services.sfls_package import encoded
    with zipfile.ZipFile(io.BytesIO(work_archive(task))) as archive:
        entries = {name: archive.read(name) for name in archive.namelist()}
    entries.update({'evidence/context/'+name: content for name, content in downloaded.items() if name.startswith('design/')})
    import hashlib
    manifest = json.loads(entries.pop('manifest.json'))
    manifest['files'] = [{'path': name, 'sha256': hashlib.sha256(content).hexdigest(), 'size': len(content)} for name, content in entries.items()]
    entries['manifest.json'] = encoded(manifest)
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as archive:
        for name, content in entries.items():
            archive.writestr(name, content)
    receipt = await client.post(base+f'/submit?request_id={uuid4()}', headers=a['first'], content=output.getvalue())
    assert receipt.status_code == 200, receipt.text
    context = receipt.json()['data']['detail']['worksheet_context']
    assert context['matches_download'] is True
    assert context['submitted_version_unverified']['worksheet_revision_id'] == current['worksheet_revision_id']
    assert context['download_context']['worksheet_revision_id'] == current['worksheet_revision_id']
    assert context['web_at_receipt']['worksheet_revision_id'] == web['worksheet_revision_id']
    # Local context edits are reported, not silently replaced with later web answers.
    from app.services.worksheet import submission_context
    edited = io.BytesIO()
    with zipfile.ZipFile(edited, 'w') as archive:
        for name, content in entries.items():
            archive.writestr(name, b'{invalid json' if name == 'evidence/context/design/current/worksheet.json' else content)
    changed = submission_context(edited.getvalue(), context['download_context'], None)
    assert changed['matches_download'] is False
    assert changed['submitted_version_unverified'] is None and changed['web_at_receipt'] is None
    exported = unpack(await client.get('/api/admin/export/research-package?include_graph=false', headers=a['teacher']))
    rows = [json.loads(line) for line in exported['worksheets.jsonl'].splitlines()]
    assert len(rows) == 3
    first = next(r for r in rows if r['worksheet_revision_id'] == plan['worksheet_revision_id'])
    assert first['record_source'] == 'unspecified'
    assert next(r for r in rows if r['worksheet_revision_id'] == current['worksheet_revision_id'])['record_source'] == 'ai_assisted'
    assert first['analysis_note'] == body['analysis_note'] and first['closing_note'] == body['closing_note']
    assert first['tests'][0]['status'] == 'not_run'
    assert first['research_id'] == 'S-' + str(a['first_id'])
    csv_rows = list(csv.DictReader(io.StringIO(exported['worksheets.csv'].decode('utf-8-sig'))))
    assert next(r for r in csv_rows if r['worksheet_revision_id'] == current['worksheet_revision_id'])['record_source'] == 'ai_assisted'
    assert next(r for r in csv_rows if r['worksheet_revision_id'] == plan['worksheet_revision_id'])['analysis_note'].startswith("'=")
    assert exported[f'originals/classroom_material_receipts/{receipt.json()["data"]["id"]}.bin'] == output.getvalue()


async def test_empty_plan_allowed_without_fake_answers(client, classroom_actors):
    a = classroom_actors
    sid = (await start(client, a))['id']
    response, _ = await publish(client, a, sid)
    base = f'/api/materials/{response.json()["data"]["id"]}'
    body = {'request_id': str(uuid4()), 'expected_user_id': str(a['first_id']), 'base_revision': 0, 'action': 'plan'}
    response = await client.post(base+'/worksheet', headers=a['first'], json=body)
    assert response.status_code == 200, response.text
    assert response.json()['data']['answers']['tests'] == []
    assert response.json()['data']['answers']['analysis_note'] == ''
