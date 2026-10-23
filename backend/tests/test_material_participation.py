"""Participation views never mutate receipts or read submitted ZIP content."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.dialects import postgresql

from app.api.endpoints.materials import material_participation_roster, material_row
from app.models.sql import ClassroomMaterial, ClassroomSession, MaterialReceipt, User
from app.services import material_participation as participation
from test_classroom import classroom_actors as actors_fixture, start


NOW = datetime(2026, 10, 22, 8, tzinfo=timezone.utc)
classroom_actors = actors_fixture


def material(configuration=None):
    return SimpleNamespace(id=uuid4(), session_id=uuid4(), title='贪吃蛇', kind='sfls',
                           configuration=configuration or {}, filename='', size=0,
                           created_at=NOW, closed_at=None)


def sql(statement):
    rendered = str(statement.compile(dialect=postgresql.dialect(), compile_kwargs={'literal_binds': True}))
    assert 'classroom_material_receipts.content' not in rendered
    assert 'classroom_materials.content' not in rendered
    assert 'password_hash' not in rendered
    return rendered


@pytest.mark.parametrize('value', [None, '', 'not-a-date', '2026-10-22T08:00:00', [], 1, True,
                                  '2026-99-22T08:00:00Z', 'x' * 101])
def test_invalid_or_naive_window_is_all_time(value):
    assert participation.statistics_started_at({'statistics_started_at': value}) is None
    item = material({'statistics_started_at': value})
    assert participation.summary_row(item)['statistics_started_at'] is None
    assert 'created_at >=' not in sql(participation.summary_statement([item]))


def test_window_normalizes_utc_and_exclusions_only_accept_exact_ids():
    uid = uuid4()
    config = {'statistics_started_at': '2026-10-22T16:00:00+08:00',
              'statistics_excluded_student_ids': ['1', ' 1 ', 1, None, '', 'G20260001'],
              'statistics_excluded_user_ids': [str(uid), str(uid), 'invalid', 1, None]}
    item = material(config)
    assert participation.statistics_started_at(config) == NOW
    assert participation.excluded_student_ids(config) == ['1', 'G20260001']
    assert participation.excluded_user_ids(config) == [uid]
    summary = participation.summary_row(item)
    assert summary['statistics_started_at'] == NOW.isoformat()
    assert summary['has_exclusions'] is True
    assert 'statistics_excluded_user_ids' not in summary
    assert str(uid) not in str(summary)


def test_sql_roster_scope_status_and_stable_pagination_use_only_metadata():
    uid = uuid4()
    item = material({'statistics_started_at': NOW.isoformat(),
                     'statistics_excluded_student_ids': ['1'],
                     'statistics_excluded_user_ids': [str(uid)]})
    summary = sql(participation.summary_statement([item, material()]))
    assert "users.role = 'learner'" in summary
    assert 'users.class_name = classroom_sessions.class_name' in summary
    assert 'users.is_active IS true' in summary
    assert 'count(DISTINCT classroom_material_receipts.user_id) FILTER' in summary
    assert 'users.student_id IN' in summary and 'users.id IN' in summary
    for status in ('all', 'pending', 'submitted', 'not_downloaded'):
        query = sql(participation.roster_statement(item, '解构班', status=status, offset=50, limit=20))
        assert "users.class_name = '解构班'" in query
        assert "users.role = 'learner'" in query and 'users.is_active IS true' in query
        assert 'users.student_id NOT IN' in query and 'users.id NOT IN' in query
        assert 'ORDER BY users.student_id, users.id' in query
        assert 'LIMIT 20 OFFSET 50' in query
        assert 'row_number() OVER' in query
        assert 'classroom_material_receipts.id DESC' in query


def test_student_material_does_not_expose_teacher_statistics_controls():
    item = material({'statistics_started_at': NOW.isoformat(),
                     'statistics_excluded_user_ids': [str(uuid4())],
                     'statistics_excluded_student_ids': ['1'], 'task': '制作贪吃蛇'})
    before = dict(item.configuration)
    assert material_row(item, student=True)['configuration'] == {'task': '制作贪吃蛇'}
    assert item.configuration == before
    assert material_row(item)['configuration'] == before


class Rows:
    def __init__(self, rows):
        self.rows = rows

    def all(self):
        return self.rows


class MetadataDB:
    def __init__(self, item, rows=None):
        self.item = item
        self.rows = rows or []
        self.statements = []
        self.gets = []

    async def get(self, model, identity):
        self.gets.append((model, identity))
        if model is ClassroomMaterial:
            return self.item
        return SimpleNamespace(id=identity, class_name='解构班')

    async def execute(self, statement):
        self.statements.append(sql(statement))
        if 'eligible_user_count' in statement.selected_columns.keys():
            return Rows([(self.item.id, 3, 1, 1)])
        return Rows([SimpleNamespace(_mapping=row) for row in self.rows])


@pytest.mark.asyncio
async def test_page_counts_and_unsubmitted_users_are_joined_without_n_plus_one():
    item = material()
    db = MetadataDB(item, [{'user_id': uuid4(), 'name': '尚未下载', 'student_id': 'G20260001',
                            'school_class': '高一（1）班', 'download_count': 0, 'submission_count': 0,
                            'last_downloaded_at': None, 'last_submitted_at': None,
                            'latest_submission_id': None}])
    result = await material_participation_roster(item.id, status='pending', offset=0, limit=50, db=db)
    page = result['data']
    assert page['total'] == 2
    assert page['summary']['eligible_user_count'] == 3
    assert page['items'][0]['downloaded'] is False
    assert page['items'][0]['submitted'] is False
    assert len(db.statements) == 2
    assert len(db.gets) == 2


@pytest.mark.asyncio
async def test_missing_material_is_404_before_roster_queries():
    db = MetadataDB(None)
    with pytest.raises(HTTPException) as error:
        await material_participation_roster(uuid4(), status='all', offset=0, limit=50, db=db)
    assert error.value.status_code == 404
    assert db.statements == []


@pytest.mark.asyncio
async def test_empty_material_list_does_not_query_database():
    db = MetadataDB(None)
    assert await participation.summaries(db, []) == {}
    assert db.statements == []


@pytest.mark.asyncio
async def test_postgres_participation_deduplicates_current_roster_window_and_keeps_all_zips(
    client, test_db, classroom_actors,
):
    actors = classroom_actors
    lesson = await start(client, actors)
    first, history = uuid4(), uuid4()
    async with test_db() as db:
        second = await db.get(User, actors['second_id'])
        second.school_class = '高一（1）班'
        inactive = User(student_id='inactive', name='停用学生', role='learner', class_name='测试一班', is_active=False)
        new = User(student_id='classroom_a3', name='尚未下载', role='learner', class_name='测试一班')
        demo = User(student_id='1', name='演示账号', role='learner', class_name='测试一班')
        excluded = User(student_id='old_test', name='历史测试号', role='learner', class_name='测试一班')
        db.add_all([inactive, new, demo, excluded])
        await db.flush()
        db.add_all([
            ClassroomMaterial(id=first, session_id=lesson['id'], created_by=actors['teacher_id'],
                              title='当前任务', kind='sfls', configuration={
                                  'statistics_started_at': NOW.isoformat(),
                                  'statistics_excluded_student_ids': ['1'],
                                  'statistics_excluded_user_ids': [str(excluded.id)]}),
            ClassroomMaterial(id=history, session_id=lesson['id'], created_by=actors['teacher_id'],
                              title='旧任务', kind='sfls', configuration={}, closed_at=NOW),
        ])
        await db.flush()
        receipts = []
        for material_id, user_id, kind, at, amount in (
            (first, actors['first_id'], 'download', NOW - timedelta(seconds=1), 1),
            (first, actors['first_id'], 'submission', NOW - timedelta(seconds=1), 1),
            (first, actors['second_id'], 'download', NOW, 3),
            (first, actors['second_id'], 'submission', NOW + timedelta(seconds=1), 2),
            (first, actors['other_id'], 'submission', NOW, 1),
            (first, actors['teacher_id'], 'submission', NOW, 1),
            (first, inactive.id, 'submission', NOW, 1),
            (first, demo.id, 'submission', NOW, 1),
            (first, excluded.id, 'submission', NOW, 1),
            (history, actors['first_id'], 'submission', NOW, 2),
        ):
            for _ in range(amount):
                receipt = MaterialReceipt(id=uuid4(), material_id=material_id, user_id=user_id,
                                          request_id=uuid4(), kind=kind, created_at=at,
                                          content=b'keep every raw ZIP', detail={})
                receipts.append(receipt)
        db.add_all(receipts)
        await db.commit()
        expected_latest = max((r.id for r in receipts if r.material_id == first and
                               r.user_id == actors['second_id'] and r.kind == 'submission'), key=str)
        before = await db.scalar(select(func.count()).select_from(MaterialReceipt))

    path = f'/api/admin/classroom/materials/{first}/participation'
    assert (await client.get(path)).status_code == 401
    assert (await client.get(path, headers=actors['first'])).status_code == 403
    response = await client.get(path, headers=actors['teacher'])
    assert response.status_code == 200, response.text
    page = response.json()['data']
    assert page['total'] == 3
    assert page['summary'] == {
        'eligible_user_count': 3, 'download_user_count': 1, 'submission_user_count': 1,
        'pending_user_count': 2, 'statistics_started_at': NOW.isoformat(),
        'excluded_student_ids': ['1'], 'has_exclusions': True,
    }
    by_user = {row['user_id']: row for row in page['items']}
    submitted = by_user[str(actors['second_id'])]
    assert (submitted['download_count'], submitted['submission_count']) == (3, 2)
    assert submitted['latest_submission_id'] == str(expected_latest)
    assert submitted['school_class'] == '高一（1）班'
    assert by_user[str(actors['first_id'])]['download_count'] == 0
    for status, total in [('pending', 2), ('submitted', 1), ('not_downloaded', 2)]:
        filtered = (await client.get(path, params={'status': status, 'limit': 1}, headers=actors['teacher'])).json()['data']
        assert filtered['total'] == total
        assert len(filtered['items']) == 1
        assert filtered['summary'] == page['summary']
    assert (await client.get(path, params={'limit': 101}, headers=actors['teacher'])).status_code == 422
    assert (await client.get(path, params={'status': 'invalid'}, headers=actors['teacher'])).status_code == 422
    assert (await client.get('/api/admin/classroom/materials/' + str(uuid4()) + '/participation',
                             headers=actors['teacher'])).status_code == 404
    cards = (await client.get(f'/api/admin/classroom/sessions/{lesson["id"]}/materials', headers=actors['teacher'])).json()['data']
    current = next(row for row in cards if row['id'] == str(first))
    old = next(row for row in cards if row['id'] == str(history))
    assert current['participation'] == page['summary']
    assert current['submission_count'] == 8  # Every attempt, including historic/test evidence.
    assert current['download_count'] == 4
    assert old['participation'] == {
        'eligible_user_count': 5, 'download_user_count': 0, 'submission_user_count': 1,
        'pending_user_count': 4, 'statistics_started_at': None,
        'excluded_student_ids': [], 'has_exclusions': False,
    }
    assert old['submission_count'] == 2
    async with test_db() as db:
        assert await db.scalar(select(func.count()).select_from(MaterialReceipt)) == before
        bodies = (await db.scalars(select(MaterialReceipt.content))).all()
        assert all(body == b'keep every raw ZIP' for body in bodies)
