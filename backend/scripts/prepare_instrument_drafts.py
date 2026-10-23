"""Add the reviewed-source catalog as CLOSED drafts, never replace or publish a round.

Run from backend with configured environment. Default is validation only; --apply
is explicit. Deterministic IDs make retries safe, including after teacher edits.
"""

import argparse
import asyncio
import json
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import func, select, text

from app.api.endpoints.assessments import LOCK, RoundInput
from app.models.sql.assessment import AssessmentRound

CATALOG = Path(__file__).resolve().parents[1] / "app/resources/instrument_drafts_20261012.json"


def load_catalog():
    catalog = json.loads(CATALOG.read_text())
    # Old records remain immutable; only new library imports use the revised papers.
    papers = json.loads(CATALOG.with_name("python_papers_20261015.json").read_text())
    catalog["instruments"] = [i for i in catalog["instruments"] if not i["key"].startswith("knowledge_")] + papers["instruments"]
    cps = json.loads(CATALOG.with_name("cps_programming_self_report_20261023.json").read_text())
    # The same scale can be distributed repeatedly; no duplicate pre/post cards.
    # Retired CPS16 definitions stay in the historical source file, not the active catalog.
    catalog["instruments"] = [i for i in catalog["instruments"] if i["key"] not in ("ct_post", "cps_pre", "cps_post")] + cps["instruments"]
    names = {"background": "编程学习与 AI 使用现状调查 · 19题",
             "ct_pre": "计算思维量表 · 20题"}
    for item in catalog["instruments"]:
        if item["key"] in names:
            item["draft"]["name"] = names[item["key"]]
        item["draft"]["class_name"] = ""
        item["validated"] = RoundInput.model_validate(item["draft"])
        assert (
            len([q for q in item["validated"].questions if not q.parent_id])
            == item["main_questions"]
        )
        item["id"] = uuid5(
            NAMESPACE_URL, f"cognisync/instruments/{item.get('version', catalog['version'])}/{item['key']}"
        )
    return catalog


async def seed_drafts(db):
    catalog = load_catalog()
    await db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": LOCK})
    result = []
    for item in catalog["instruments"]:
        existing = await db.get(AssessmentRound, item["id"])
        if existing:
            result.append(
                {"id": str(existing.id), "key": item["key"], "status": "existing_untouched"}
            )
            continue
        draft = item["validated"]
        revision = (
            await db.scalar(
                select(func.max(AssessmentRound.revision)).where(
                    AssessmentRound.phase == draft.phase,
                    AssessmentRound.class_name == draft.class_name,
                )
            )
            or 0
        ) + 1
        row = AssessmentRound(
            id=item["id"], **draft.model_dump(), revision=revision, enabled=False, published_at=None
        )
        db.add(row)
        await db.flush()
        result.append({"id": str(row.id), "key": item["key"], "status": "closed_draft_created"})
    return result


async def main(apply):
    if not apply:
        print(
            json.dumps(
                [
                    {
                        "key": i["key"],
                        "main_questions": i["main_questions"],
                        "fields": len(i["draft"]["questions"]),
                    }
                    for i in load_catalog()["instruments"]
                ],
                ensure_ascii=False,
            )
        )
        return
    from app.db.postgres import async_session_factory, engine

    try:
        async with async_session_factory() as db:
            result = await seed_drafts(db)
            await db.commit()
            print(json.dumps(result, ensure_ascii=False))
    finally:
        await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    asyncio.run(main(args.apply))
