from copy import deepcopy
from datetime import datetime, timezone
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.models.sql import User
from app.models.sql.assessment import AssessmentResponse, AssessmentRound
from scripts.replace_cps_draft import can_retire, definition, replace_cps, retired_definitions


def legacy_row(identifier, key, original):
    return AssessmentRound(id=identifier, **{**original.model_dump(), 'class_name': ''}, revision=1,
                           enabled=False, published_at=None)


def test_retirement_gate_preserves_answered_published_active_and_edited_content():
    identifier, (key, original) = next(iter(retired_definitions().items()))
    row = legacy_row(identifier, key, original)
    assert can_retire(row, 0, key, original)
    assert not can_retire(row, 1, key, original)
    row.published_at = datetime.now(timezone.utc)
    assert not can_retire(row, 0, key, original)
    row.published_at = None
    row.enabled = True
    assert not can_retire(row, 0, key, original)
    row.enabled = False
    row.questions = deepcopy(row.questions)
    row.questions[0]['text'] += '教师修改'
    assert not can_retire(row, 0, key, original)


@pytest.mark.asyncio
async def test_replacement_is_atomic_idempotent_and_preserves_all_answered_rounds(test_db):
    async with test_db() as db:
        originals = retired_definitions()
        rows = [legacy_row(identifier, key, original) for identifier, (key, original) in originals.items()]
        db.add_all(rows)
        user = User(student_id='G2099_cps_test', name='isolated test', role='learner')
        db.add(user)
        await db.flush()
        answer = AssessmentResponse(user_id=user.id, round_id=rows[1].id, answers={'cps1': '3'},
                                    group_snapshot='pdt', class_snapshot='解构班', started_at=datetime.now(timezone.utc))
        db.add(answer)
        unrelated = AssessmentRound(id=uuid4(), phase='pre', name='背景调查保留', class_name='解构班',
                                    source='not CPS', questions=[], enabled=True, revision=1,
                                    published_at=datetime.now(timezone.utc))
        db.add(unrelated)
        await db.commit()
        first = await replace_cps(db, apply=True, retire_unused=True)
        await db.commit()
        assert first['new_status'] == 'closed_draft_created'
        assert {item['status'] for item in first['legacy']} == {'retired_unused_draft', 'preserved_used_or_edited'}
        assert await db.get(AssessmentRound, rows[0].id) is None
        assert await db.get(AssessmentRound, rows[1].id) is rows[1]
        assert await db.get(AssessmentResponse, answer.id) is answer
        assert unrelated.enabled
        identifier, draft = definition()
        current = await db.get(AssessmentRound, identifier)
        assert not current.enabled and current.published_at is None
        assert current.questions == [question.model_dump() for question in draft.questions]
        current.name = '教师改名'
        await db.commit()
        second = await replace_cps(db, apply=True, retire_unused=True)
        await db.commit()
        assert second['new_status'] == 'existing_untouched'
        assert current.name == '教师改名'
        assert len((await db.scalars(select(AssessmentRound))).all()) == 3


@pytest.mark.asyncio
async def test_replacement_default_is_read_only(test_db):
    async with test_db() as db:
        result = await replace_cps(db)
        await db.rollback()
        assert result['new_status'] == 'would_create'
        assert list((await db.scalars(select(AssessmentRound))).all()) == []
