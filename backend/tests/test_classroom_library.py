from copy import deepcopy
from uuid import UUID, uuid4
import pytest
from sqlalchemy import select
from app.models.sql import User, ClassroomSession, ClassroomMaterial
from scripts.prepare_classroom_library import seed_library
from scripts.prepare_instrument_drafts import load_catalog
from app.services.lesson_pack import freeze, current_course
from app.models.sql.assessment import AssessmentResponse


@pytest.mark.asyncio
async def test_library_adds_closed_tasks_without_overwriting_active_or_edited_records(test_db):
    async with test_db() as db:
        teacher = User(student_id='library_teacher', name='Library teacher', role='admin')
        db.add(teacher)
        await db.flush()
        sessions = [ClassroomSession(class_name=name, title=name, created_by=teacher.id, is_current=True) for name in ('解构班', '开发班')]
        db.add_all(sessions)
        await db.flush()
        active = ClassroomMaterial(session_id=sessions[0].id, created_by=teacher.id,
            kind='sfls', title='Existing publication', configuration={'untouched': True})
        db.add(active)
        await db.commit()
        first = await seed_library(db, teacher.id)
        await db.commit()
        assert len(first) == 10
        rows = list((await db.scalars(select(ClassroomMaterial))).all())
        assert len(rows) == 11 and active.closed_at is None
        seeded = [r for r in rows if r.id != active.id]
        assert all(r.closed_at is not None for r in seeded)
        assert all(r.configuration['inherit_previous'] == (r.configuration['library']['lesson_id'] != 'C01') for r in seeded)
        assert all(r.configuration['library']['slides_path'].startswith('/slides/') for r in seeded)
        edited = seeded[0]
        edited.title = 'Teacher changed this'
        snapshot = deepcopy(edited.configuration)
        edited.closed_at = None
        await db.commit()
        second = await seed_library(db, teacher.id)
        await db.commit()
        assert all(r['status'] == 'existing_untouched' for r in second)
        assert edited.title == 'Teacher changed this' and edited.closed_at is None
        assert edited.configuration == snapshot
        assert active.configuration == {'untouched': True}


def test_current_papers_are_r2_not_old_or_initial_shortening():
    papers = [i for i in load_catalog()['instruments'] if i['key'].startswith('knowledge_')]
    for item in papers:
        questions = {q['id']: q for q in item['draft']['questions']}
        assert item['version'] == '20261015-r2'
        assert item['main_questions'] == 8
        assert sum(item['field_points'].values()) == item['total_points'] == 20
        assert len(questions) == 14
        assert 'data[i - 1]' in questions['q5']['code']
        assert 'best = __________' in questions['q7']['code']
        assert '暴露错误' in questions['q8']['text']
        assert questions['q8_fix']['parent_id'] == 'q8'
        assert '将第二个if改为elif' not in str(item['draft']['questions'])
        assert '将第二个if改为elif' in item['draft']['source']
        assert all(not q['required'] for q in questions.values())


def test_tasks_follow_current_ppt_and_keep_common_cases():
    assert list(current_course()[1]) == ['C01', 'C02', 'C03', 'C04', 'C05']
    assert not freeze('C01')['starter_files']
    assert '持续移动' in freeze('C02')['files']['materials/公共规则.md']
    assert '曼哈顿距离' in freeze('C03')['curriculum']
    assert 'BFS' in freeze('C04')['curriculum']
    assert '控制变量' in freeze('C05')['curriculum']
    for lesson_id in current_course()[1]:
        bundle = freeze(lesson_id)
        assert '第6课起' not in str(bundle['files'])
        assert bundle['version'] == 'snake-classroom/' + current_course()[0]


@pytest.mark.asyncio
async def test_revised_paper_delivery_preserves_every_subanswer_and_hides_scoring(admin_client, client, auth_headers, test_db, test_user_id):
    async with test_db() as db:
        student = await db.get(User, UUID(str(test_user_id)))
        student.class_name = '解构班'
        await db.commit()
    for item in (i for i in load_catalog()['instruments'] if i['key'].startswith('knowledge_')):
        created = await admin_client.post('/api/admin/assessments', json=item['draft'])
        assert created.status_code == 200, created.text
        template_id = created.json()['data']['id']
        delivery = await admin_client.post(f'/api/admin/assessments/{template_id}/distribute',
            json={'class_name': '解构班', 'request_id': str(uuid4())})
        assert delivery.status_code == 200
        mid = delivery.json()['data']['id']
        paper = (await client.get('/api/assessments/pending', headers=auth_headers)).json()['data']
        assert paper['id'] == mid and 'source' not in paper
        assert '将第二个if改为elif' not in str(paper)
        answers = {q['id']: (q['options'][0]['value'] if q['type'] == 'choice' else '保留原始回答\n含代码缩进    ') for q in paper['questions']}
        answers['q8_expected'] = None  # Missing is not an invented zero or empty answer.
        submitted = await client.post(f'/api/assessments/{mid}/responses', headers=auth_headers,
            json={'answers': answers, 'started_at': paper['served_at']})
        assert submitted.status_code == 200, submitted.text
        async with test_db() as db:
            response = await db.scalar(select(AssessmentResponse).where(AssessmentResponse.round_id == UUID(mid)))
            assert response.answers == answers
        exported = await admin_client.get(f'/api/admin/assessments/{mid}/export')
        assert exported.status_code == 200
        assert 'q8_expected' in exported.text and 'q7_condition' in exported.text
        definition = (await admin_client.get(f'/api/admin/assessments/{mid}/definition')).json()
        assert '20261015-r2' in definition['source']
