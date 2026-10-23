from copy import deepcopy
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.api.endpoints.assessments import RoundInput
from app.models.sql import AssessmentRound
from app.schemas.assessment import Question, validate_answer, visible_question_ids
from app.core.security import verify_admin_key
from main import app
from scripts.prepare_instrument_drafts import load_catalog, seed_drafts


def test_source_catalog_and_branches():
    catalog = {i["key"]: i for i in load_catalog()["instruments"]}
    assert len(catalog) == 5
    assert "ct_post" not in catalog and "cps_post" not in catalog and "cps_pre" not in catalog
    assert catalog['cps12_20261023']['main_questions'] == 12
    bg = catalog["background"]["draft"]["questions"]
    visible = visible_question_ids(bg, {"q3": "5", "q8": "1"})
    assert all(f"q{i}" in visible for i in range(14, 20))
    assert all(f"q{i}" not in visible for i in [4, 5, 6, 7, 9, 10, 11, 12, 13])
    q8 = next(q for q in bg if q["id"] == "q8")
    assert [o["label"] for o in q8["options"]][4:6] == ["使用了11—20天", "使用了21天及以上"]
    q10 = next(q for q in bg if q["id"] == "q10")
    assert q10["skip_label"] == "不记得名称"
    validate_answer(q10, "__skip__")
    with pytest.raises(ValueError):
        validate_answer({"type": "text", "required": False, "options": []}, "__skip__")
    a = catalog["knowledge_a"]["draft"]["questions"]
    assert len(a) == 14 and len(a[0]["options"]) == 4
    assert len([q for q in a if not q.get("parent_id")]) == 8
    assert "    data[i] = data[i] + data[i - 1]" in next(q for q in a if q["id"] == "q5")["code"]
    assert catalog["knowledge_a"]["total_points"] == 20
    assert sum(catalog["knowledge_a"]["field_points"].values()) == 20
    assert all(not q["required"] for item in catalog.values() for q in item["draft"]["questions"])


def test_parent_and_skip_contract():
    draft = deepcopy(load_catalog()["instruments"][0]["draft"])
    draft["questions"][0]["parent_id"] = "nonexistent"
    with pytest.raises(ValueError):
        RoundInput.model_validate(draft)
    with pytest.raises(ValueError):
        Question(
            id="q",
            text="题目",
            type="choice",
            skip_label="不知道",
            options=[{"value": "1", "label": "一"}, {"value": "2", "label": "二"}],
        )


@pytest.mark.asyncio
async def test_seed_idempotent_preserves_existing_and_edited_drafts(test_db):
    async with test_db() as db:
        old = AssessmentRound(
            phase="pre",
            class_name="",
            name="旧题本",
            revision=1,
            source="旧来源",
            questions=[],
            enabled=True,
        )
        db.add(old)
        await db.commit()
        first = await seed_drafts(db)
        await db.commit()
        rows = list((await db.scalars(select(AssessmentRound))).all())
        assert len(rows) == 6
        assert old.enabled
        new = next(r for r in rows if r.id != old.id)
        assert all(not r.enabled and r.published_at is None for r in rows if r.id != old.id)
        new.name = "教师修改后的草稿"
        await db.commit()
        second = await seed_drafts(db)
        await db.commit()
        assert all(r["status"] == "existing_untouched" for r in second)
        assert new.name == "教师修改后的草稿"
        assert {r["id"] for r in first} == {r["id"] for r in second}


@pytest.mark.asyncio
async def test_definition_and_new_answer_fields(admin_client, client, auth_headers):
    draft = {
        "phase": "pre",
        "name": "电子化测试",
        "source": "教师专用计分说明",
        "questions": [
            {
                "id": "q10",
                "text": "工具名称",
                "type": "text",
                "required": False,
                "skip_label": "不记得名称",
            },
            {
                "id": "q11",
                "text": "输出",
                "type": "text",
                "required": False,
                "code": "for i in range(2):\n    print(i)",
            },
        ],
    }
    created = await admin_client.post("/api/admin/assessments", json=draft)
    assert created.status_code == 200, created.text
    item = created.json()["data"]
    rid = item["id"]
    assert not item["enabled"]
    definition = await admin_client.get(f"/api/admin/assessments/{rid}/definition")
    assert definition.json()["source"] == draft["source"]
    override = app.dependency_overrides.pop(verify_admin_key)
    try:
        assert (
            await client.get(f"/api/admin/assessments/{rid}/definition", headers=auth_headers)
        ).status_code in (401, 403)
    finally:
        app.dependency_overrides[verify_admin_key] = override
    await admin_client.post(f"/api/admin/assessments/{rid}/availability", json={"enabled": True})
    pending = (await client.get("/api/assessments/pending", headers=auth_headers)).json()["data"]
    assert "source" not in pending
    assert pending["questions"][1]["code"] == draft["questions"][1]["code"]
    result = await client.post(
        f"/api/assessments/{rid}/responses",
        headers=auth_headers,
        json={
            "answers": {"q10": "__skip__", "q11": "0\n1"},
            "started_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    assert result.status_code == 200, result.text
    exported = await admin_client.get(f"/api/admin/assessments/{rid}/export")
    assert "__skip__,不记得名称" in exported.text
    assert "    print(i)" in exported.text
