"""Receipt metadata counts: fast endpoint contract tests, with no production access."""
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy.dialects import postgresql

from app.api.endpoints.admin.users import list_users
from app.api.endpoints.materials import list_receipts, teacher_materials
from app.schemas.admin.user_management import UserSummary
from app.models.sql import ClassroomMaterial, MaterialReceipt
from test_classroom import classroom_actors as actors_fixture, start


NOW = datetime(2026, 10, 21, 6, 30, tzinfo=timezone.utc)
classroom_actors = actors_fixture


def student():
    return SimpleNamespace(id=uuid4(), student_id='G20260001', email=None, name='测试学生',
                           gender=None, role='learner', is_active=True, created_at=NOW,
                           class_name='解构班', school_class='高一（1）班', experiment_group='pdt')


class Result:
    def __init__(self, rows=(), scalar=None):
        self.rows, self.value = list(rows), scalar

    def all(self):
        return self.rows

    def one(self):
        assert len(self.rows) == 1
        return self.rows[0]

    def scalar(self):
        return self.value


class MetadataDB:
    """Only the rows expected by the endpoint; also capture its real SQL contract."""
    def __init__(self, user=None, material=None, receipt=None):
        self.user, self.material, self.receipt = user, material, receipt
        self.sql = []

    def capture(self, statement):
        sql = str(statement.compile(dialect=postgresql.dialect(), compile_kwargs={'literal_binds': True}))
        self.sql.append(sql)
        assert 'classroom_material_receipts.content' not in sql
        return sql

    async def scalars(self, statement):
        self.capture(statement)
        return Result([self.material])

    async def scalar(self, statement):
        self.capture(statement)
        return 52

    async def execute(self, statement):
        sql = self.capture(statement)
        if self.user:
            if 'users.student_id' not in sql:
                return Result(scalar=1)
            # The old implementation returned only User + web-message statistics.
            stats = (51, 1, NOW) if 'submission_count' in statement.selected_columns.keys() else ()
            return Result([(self.user, 0, None, *stats)])
        if self.receipt:
            if 'id' not in statement.selected_columns.keys():
                return Result([(52, 51, 1)])
            return Result([(self.receipt, '测试学生', 'G20260001')])
        if 'eligible_user_count' in statement.selected_columns.keys():
            return Result([(self.material.id, 2, 1, 1)])
        return Result([(self.material.id, 51, 1)])


def test_user_summary_exposes_zero_receipt_counts():
    user = student()
    row = UserSummary(**{**vars(user), 'id': str(user.id)}).model_dump()
    assert row['submission_count'] == 0
    assert row['download_count'] == 0
    assert row['last_submitted_at'] is None


@pytest.mark.asyncio
async def test_student_list_counts_receipts_without_web_chat_or_blob_queries():
    db = MetadataDB(user=student())
    response = await list_users(page=1, page_size=20, query=None, experiment_group=None, db=db)
    row = response.data.users[0].model_dump()
    assert row['message_count'] == 0
    assert row['submission_count'] == 51
    assert row['download_count'] == 1
    assert row['last_submitted_at'] == NOW
    assert len(db.sql) == 2  # Count + one joined page query, not N queries per learner.
    query = db.sql[-1]
    assert 'GROUP BY classroom_material_receipts.user_id' in query
    assert "kind = 'submission'" in query and "kind = 'download'" in query


@pytest.mark.asyncio
async def test_teacher_material_list_exposes_submission_and_download_counts():
    material = SimpleNamespace(id=uuid4(), title='贪吃蛇', kind='sfls', configuration={},
                               filename='', size=0, created_at=NOW, closed_at=None)
    db = MetadataDB(material=material)
    result = await teacher_materials(uuid4(), db=db)
    row = result['data'][0]
    assert row['submission_count'] == 51
    assert row['download_count'] == 1
    assert row['participation']['eligible_user_count'] == 2
    assert row['participation']['submission_user_count'] == 1
    assert row['participation']['pending_user_count'] == 1
    assert len(db.sql) == 3


@pytest.mark.asyncio
async def test_receipt_page_counts_all_rows_not_only_the_current_page():
    receipt = SimpleNamespace(id=uuid4(), material_id=uuid4(), user_id=uuid4(),
                              kind='submission', detail={}, sha256='a' * 64, size=1, created_at=NOW)
    db = MetadataDB(receipt=receipt)
    result = await list_receipts(receipt.material_id, offset=50, db=db)
    assert result['data']['total'] == 52
    assert result['data']['submission_count'] == 51
    assert result['data']['download_count'] == 1
    assert len(result['data']['items']) == 1
    assert len(db.sql) == 2
    assert 'LIMIT 50 OFFSET 50' in db.sql[-1]


@pytest.mark.asyncio
async def test_postgres_receipt_counts_cover_all_pages_and_keep_students_and_tasks_separate(client, test_db, classroom_actors):
    actors = classroom_actors
    lesson = await start(client, actors)
    first, other = uuid4(), uuid4()
    async with test_db() as db:
        db.add_all([ClassroomMaterial(id=mid, session_id=lesson['id'], created_by=actors['teacher_id'],
                                     title=f'统计测试{index}', kind='sfls', configuration={})
                    for index, mid in enumerate((first, other))])
        await db.flush()
        for material_id, user_id, kind, amount in (
            (first, actors['first_id'], 'submission', 20),
            (first, actors['first_id'], 'download', 29),
            (first, actors['second_id'], 'submission', 3),
            (first, actors['second_id'], 'download', 3),
            (other, actors['first_id'], 'submission', 2),
            (other, actors['first_id'], 'download', 1),
        ):
            db.add_all([MaterialReceipt(material_id=material_id, user_id=user_id, request_id=uuid4(),
                                        kind=kind, created_at=NOW, detail={}) for _ in range(amount)])
        await db.commit()

    prefix = '/api/admin/classroom'
    page = (await client.get(f'{prefix}/materials/{first}/receipts?offset=50', headers=actors['teacher'])).json()['data']
    assert len(page['items']) == 5
    assert (page['total'], page['submission_count'], page['download_count']) == (55, 23, 32)
    rows = (await client.get(f'{prefix}/sessions/{lesson["id"]}/materials', headers=actors['teacher'])).json()['data']
    by_material = {row['id']: row for row in rows}
    assert (by_material[str(first)]['submission_count'], by_material[str(first)]['download_count']) == (23, 32)
    assert (by_material[str(other)]['submission_count'], by_material[str(other)]['download_count']) == (2, 1)
    users = (await client.get('/api/admin/users', headers=actors['teacher'])).json()['data']['users']
    by_student = {row['id']: row for row in users}
    assert (by_student[str(actors['first_id'])]['submission_count'], by_student[str(actors['first_id'])]['download_count']) == (22, 30)
    assert (by_student[str(actors['second_id'])]['submission_count'], by_student[str(actors['second_id'])]['download_count']) == (3, 3)
    assert by_student[str(actors['teacher_id'])]['submission_count'] == 0
