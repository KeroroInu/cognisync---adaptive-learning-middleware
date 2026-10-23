"""Install the teacher-confirmed CPS12; retire only identified, unused CPS16 drafts.

Default: read-only plan. Back up the database before --apply --retire-unused.
Published rounds, any round with answers, and unrelated instruments are immutable.
"""
import argparse
import asyncio
import json
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import func, select, text

from app.api.endpoints.assessments import LOCK, RoundInput
from app.models.sql.assessment import AssessmentResponse, AssessmentRound

RESOURCES = Path(__file__).resolve().parents[1] / "app/resources"


def definition():
    catalog = json.loads((RESOURCES / "cps_programming_self_report_20261023.json").read_text())
    item, = catalog["instruments"]
    draft = RoundInput.model_validate(item["draft"])
    assert item["key"] == "cps12_20261023" and len(draft.questions) == 12
    identifier = uuid5(NAMESPACE_URL, f"cognisync/instruments/{item['version']}/{item['key']}")
    return identifier, draft


def retired_definitions():
    catalog = json.loads((RESOURCES / "instrument_drafts_20261012.json").read_text())
    return {
        uuid5(NAMESPACE_URL, f"cognisync/instruments/{item.get('version', catalog['version'])}/{item['key']}"):
        (item['key'], RoundInput.model_validate(item['draft']))
        for item in catalog['instruments'] if item['key'] in ('cps_pre', 'cps_post')
    }


def can_retire(row, response_count, key, original):
    """Fail closed if a known ID has been reused or its question content edited."""
    return (
        not row.enabled and row.published_at is None and response_count == 0
        and row.class_name == '' and row.phase == original.phase
        and f"题本代码：{key}；" in row.source
        and [q.model_dump() for q in RoundInput.model_validate({
            'phase': row.phase, 'name': row.name, 'class_name': row.class_name,
            'source': row.source, 'questions': row.questions,
        }).questions] == [q.model_dump() for q in original.questions]
    )


async def replace_cps(db, *, apply=False, retire_unused=False):
    if apply:
        await db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {'key': LOCK})
    else:
        await db.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"))
    identifier, draft = definition()
    legacy = retired_definitions()
    query = select(AssessmentRound).where(AssessmentRound.id.in_([identifier, *legacy]))
    rows = list((await db.scalars(query.with_for_update() if apply else query)).all())
    existing = next((row for row in rows if row.id == identifier), None)
    result = {'new_id': str(identifier), 'new_status': 'existing_untouched' if existing else 'would_create', 'legacy': []}
    if apply and not existing:
        revision = (await db.scalar(select(func.max(AssessmentRound.revision)).where(
            AssessmentRound.phase == draft.phase, AssessmentRound.class_name == draft.class_name)) or 0) + 1
        db.add(AssessmentRound(id=identifier, **draft.model_dump(), revision=revision, enabled=False, published_at=None))
        await db.flush()
        result['new_status'] = 'closed_draft_created'
    for row in rows:
        if row.id not in legacy:
            continue
        count = await db.scalar(select(func.count()).select_from(AssessmentResponse).where(AssessmentResponse.round_id == row.id))
        key, original = legacy[row.id]
        eligible = can_retire(row, count, key, original)
        status = 'eligible_unused_draft' if eligible else 'preserved_used_or_edited'
        if apply and retire_unused and eligible:
            await db.delete(row)
            status = 'retired_unused_draft'
        result['legacy'].append({'id': str(row.id), 'key': key, 'answers': count, 'status': status})
    return result


async def main(apply, retire_unused):
    from app.db.postgres import async_session_factory, engine
    try:
        async with async_session_factory() as db:
            result = await replace_cps(db, apply=apply, retire_unused=retire_unused)
            if apply:
                await db.commit()
            else:
                await db.rollback()
            print(json.dumps(result, ensure_ascii=False))
    finally:
        await engine.dispose()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--retire-unused', action='store_true', help='Requires a prior backup; never deletes a published or answered round.')
    args = parser.parse_args()
    asyncio.run(main(args.apply, args.retire_unused))
