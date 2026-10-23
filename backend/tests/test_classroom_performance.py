"""Opt-in bounded API bursts, never a production capacity certification.

Run with RUN_CLASSROOM_PERFORMANCE=1 and an explicit TEST_DATABASE_URL ending
in cognisync_performance_test. Fixtures create/drop tables ONLY in that database.
No network, TLS, Nginx, Neo4j, external model calls, or browser rendering measured.
"""
import asyncio
import hashlib
import io
import json
import math
import os
import random
import time
import zipfile
from uuid import uuid4

import pytest
from sqlalchemy import func, select
from sqlalchemy.engine import make_url

from app.api.endpoints.auth import create_access_token
from app.models.sql import (AssessmentResponse, ClassroomMaterial, ClassroomPublication,
                            ClassroomResponse, ClassroomSession, MaterialReceipt, User)
from tests.test_assessments import draft, publish


def isolated_performance_database():
    url = os.getenv('TEST_DATABASE_URL', '')
    return bool(url and make_url(url).database == 'cognisync_performance_test')


pytestmark = [pytest.mark.asyncio, pytest.mark.skipif(
    os.getenv('RUN_CLASSROOM_PERFORMANCE') != '1' or not isolated_performance_database(),
    reason='Opt-in benchmark requires its own cognisync_performance_test database')]


async def burst(label, operations):
    async def measured(operation):
        start = time.perf_counter()
        response = await operation()
        return response, (time.perf_counter() - start) * 1000
    start = time.perf_counter()
    results = await asyncio.wait_for(asyncio.gather(*(measured(op) for op in operations)), 90)
    times = sorted(t for _, t in results)
    errors = [r.status_code for r, _ in results if r.status_code != 200]
    print('LOCAL_API_BURST ' + json.dumps({
        'label': label, 'requests': len(results), 'wall_ms': round((time.perf_counter() - start) * 1000),
        'p50_ms': round(times[math.ceil(len(times) * .50) - 1], 1),
        'p95_ms': round(times[math.ceil(len(times) * .95) - 1], 1),
        'max_ms': round(times[-1], 1), 'errors': errors,
    }))
    assert not errors, [(r.status_code, r.text[:200]) for r, _ in results if r.status_code != 200]
    return [r for r, _ in results]


@pytest.mark.parametrize('students', [40, 80])
async def test_classroom_bursts_and_complete_receipts(students, client, admin_client, test_db):
    teacher = User(student_id='performance-teacher', name='隔离测试教师', role='admin')
    users = [User(student_id=f'perf-{i}', name=f'隔离{i}', class_name='解构班' if i < 40 else '开发班',
                  experiment_group='pdt' if i < 40 else 'ai_pbl') for i in range(students)]
    async with test_db() as db:
        db.add_all([teacher, *users]); await db.flush()
        classes = [ClassroomSession(class_name=name, title='隔离压测', created_by=teacher.id)
                   for name in sorted({u.class_name for u in users})]
        db.add_all(classes); await db.flush()
        publications = {s.class_name: ClassroomPublication(session_id=s.id, created_by=teacher.id,
            question={'kind': 'poll', 'text': '先测试哪一项？', 'type': 'choice', 'options':
                      [{'value': 'a', 'label': '移动'}, {'value': 'b', 'label': '边界'}]}) for s in classes}
        materials = {s.class_name: ClassroomMaterial(session_id=s.id, created_by=teacher.id,
            title='隔离作品包', kind='file', filename='test.zip', configuration={'accept_submissions': True},
            content=b'test', size=4) for s in classes}
        db.add_all([*publications.values(), *materials.values()]); await db.flush()
        db.add_all([MaterialReceipt(material_id=materials[u.class_name].id, user_id=u.id,
            request_id=uuid4(), kind='download') for u in users])
        await db.commit()
    headers = [{'Authorization': f'Bearer {create_access_token(str(u.id))}'} for u in users]
    body = draft()
    body['questions'] = [{**body['questions'][0], 'id': f'q{i}', 'text': f'测试题{i}：列表与条件判断'} for i in range(10)]
    paper = await publish(admin_client, body)
    statuses = await burst(f'{students}/assessment_status', [lambda h=h: client.get('/api/assessments/status', headers=h) for h in headers])
    assert all(r.json()['data']['id'] == paper['id'] and len(r.content) < 150 for r in statuses)
    papers = await burst(f'{students}/paper_fetch', [lambda h=h: client.get('/api/assessments/pending', headers=h) for h in headers])
    await burst(f'{students}/paper_submit', [lambda h=h, p=p: client.post(f"/api/assessments/{paper['id']}/responses", headers=h,
        json={'answers': {f'q{i}': '1' for i in range(10)}, 'started_at': p.json()['data']['served_at']}) for h, p in zip(headers, papers)])
    await burst(f'{students}/classroom_state', [lambda h=h: client.get('/api/classroom/state', headers=h) for h in headers])
    await burst(f'{students}/vote_submit', [lambda u=u, h=h: client.post(
        f'/api/classroom/prompts/{publications[u.class_name].id}/responses', headers=h, json={'answer': 'a'}) for u, h in zip(users, headers)])

    # Noncompressible, deterministic 1 MiB fixture models a modest evidence ZIP.
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_STORED) as archive:
        archive.writestr('evidence.bin', random.Random(7).randbytes(1024 * 1024))
    payload = output.getvalue()
    requests = [uuid4() for _ in users]
    async def upload(u, h, rid):
        return await client.post(f'/api/materials/{materials[u.class_name].id}/submit?request_id={rid}',
                                 headers={**h, 'Content-Type': 'application/zip'}, content=payload)
    await burst(f'{students}/upload_1MiB', [lambda u=u, h=h, rid=rid: upload(u, h, rid) for u, h, rid in zip(users, headers, requests)])
    # A duplicate network retry must not create a second accepted version.
    await burst(f'{students}/upload_retry', [lambda u=u, h=h, rid=rid: upload(u, h, rid) for u, h, rid in zip(users, headers, requests)])
    mixed = await burst(f'{students}/export_plus_status', [
        lambda: admin_client.get('/api/admin/export/research-package?include_graph=false'),
        *[lambda h=h: client.get('/api/assessments/status', headers=h) for h in headers]])
    with zipfile.ZipFile(io.BytesIO(mixed[0].content)) as exported:
        raw = [json.loads(line) for line in exported.read('classroom_material_receipts.jsonl').splitlines()]
        submitted = [r for r in raw if r['kind'] == 'submission']
        assert len(submitted) == students
        for row in submitted:
            original = exported.read(f"originals/classroom_material_receipts/{row['id']}.bin")
            assert hashlib.sha256(original).hexdigest() == hashlib.sha256(payload).hexdigest()
    async with test_db() as db:
        assert await db.scalar(select(func.count()).select_from(AssessmentResponse)) == students
        assert await db.scalar(select(func.count()).select_from(ClassroomResponse)) == students
        assert await db.scalar(select(func.count()).select_from(MaterialReceipt).where(MaterialReceipt.kind == 'submission')) == students
