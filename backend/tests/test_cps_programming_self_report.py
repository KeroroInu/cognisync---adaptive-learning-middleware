"""Definition checks and an isolated-test-DB API regression for the 12-item draft.

Only the async integration test uses the guarded ``test_db`` fixture; it never
connects to production. The other checks read repository definitions only.
"""
from copy import deepcopy
import csv
from datetime import datetime, timezone
import io
import json
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

from app.api.endpoints.assessments import RoundInput
from app.api.endpoints.auth import create_access_token
from app.models.sql import AssessmentResponse, AssessmentRound, ProfileSnapshot, User
from app.models.sql.profile import ProfileSource
from app.schemas.assessment import validate_answer, visible_question_ids


RESOURCE = Path(__file__).resolve().parents[1] / "app/resources/cps_programming_self_report_20261023.json"
EXPECTED_TEXTS = [
    "面对编程任务，我能说清楚需要解决的主要问题。",
    "我能识别编程任务中需要考虑的主要要求。",
    "我能找到解决当前编程问题所需的信息。",
    "我能根据已有信息提出解决编程问题的办法。",
    "我能比较不同解决办法的优点和不足。",
    "我能判断提出的解决办法在当前条件下是否可行。",
    "我能把选定的解决办法转化为具体的实施步骤。",
    "我能按照制订的步骤推进编程任务。",
    "遇到与预期不符的情况时，我能调整接下来的做法。",
    "我能检查程序的运行结果是否达到任务目标。",
    "我能根据检验结果判断原先的解决办法是否合适。",
    "完成任务后，我能解释所用的解决办法为什么有效或无效。",
]
EXPECTED_OPTIONS = [
    {"value": "1", "label": "非常不同意"},
    {"value": "2", "label": "不同意"},
    {"value": "3", "label": "中立"},
    {"value": "4", "label": "同意"},
    {"value": "5", "label": "非常同意"},
]


def load_instrument():
    catalog = json.loads(RESOURCE.read_text(encoding="utf-8"))
    assert catalog["schema"] == "classroom-instrument-catalog/1"
    assert catalog["version"] == "20261023-teacher-confirmed1"
    assert len(catalog["instruments"]) == 1
    return catalog["instruments"][0]


def test_exact_twelve_item_screenshot_transcription_and_contract():
    instrument = load_instrument()
    assert instrument["key"] == "cps12_20261023"
    assert instrument["version"] == "20261023-teacher-confirmed1"
    assert instrument["main_questions"] == 12
    raw = instrument["draft"]
    validated = RoundInput.model_validate(raw)
    assert validated.name == "复杂编程问题解决自评问卷"
    assert validated.class_name == ""
    assert validated.phase == "pre"  # Storage compatibility, not the administration-stage label.
    assert [question.text for question in validated.questions] == EXPECTED_TEXTS
    assert [question.id for question in validated.questions] == [f"cps12_{index:02}" for index in range(1, 13)]
    assert len(validated.questions) == 12
    for question in raw["questions"]:
        assert question["type"] == "choice"
        assert question["required"] is False
        assert question["options"] == EXPECTED_OPTIONS
        assert not question.get("parent_id")
        assert not question.get("show_if")
        assert not question.get("code")


def test_student_instruction_and_teacher_only_provenance_are_explicit():
    draft = load_instrument()["draft"]
    assert draft["questions"][0]["hint"] == (
        "请回想需要同时考虑多个要求、不能直接套用现成步骤的编程任务，根据你目前的情况选择认同程度。\n"
        "每题单选，选项统一为：非常不同意、不同意、中立、同意、非常同意，依次计1—5分，全部正向计分。"
    )
    assert all(not question.get("hint") for question in draft["questions"][1:])
    for statement in ["题本代码：cps12_20261023", "教师确认课堂使用稿", "自陈问卷", "不是客观能力测试", "不宣称已经完成测量效度验证", "全部正向计分，无反向题", "缺失答案保留为缺答，不记0分", "旧版历史答卷保留"]:
        assert statement in draft["source"]
    assert "前测" not in draft["name"] and "后测" not in draft["name"]


@pytest.mark.parametrize("answer", [None, "", "   "])
def test_missing_responses_are_allowed_without_synthesizing_zero(answer):
    questions = load_instrument()["draft"]["questions"]
    for question in questions:
        validate_answer(question, answer)
        with pytest.raises(ValueError):
            validate_answer(question, "0")
    assert visible_question_ids(questions, {}) == {question["id"] for question in questions}


@pytest.mark.parametrize("value", ["1", "2", "3", "4", "5"])
def test_every_positive_scale_value_is_an_allowed_single_response(value):
    for question in load_instrument()["draft"]["questions"]:
        validate_answer(question, value)
        with pytest.raises(ValueError):
            validate_answer(question, [value])


@pytest.mark.asyncio
async def test_isolated_api_two_classes_raw_answers_exports_and_unchanged_profiles(admin_client, client, test_db):
    """Real API + dedicated *_test PG: no mock answers, live server, or production rows."""
    draft = deepcopy(load_instrument()["draft"])
    expected_questions = RoundInput.model_validate(draft).model_dump()["questions"]
    students = [
        User(student_id="G209901CPS12A", name="12题回归解构学生", class_name="解构班", experiment_group="pdt"),
        User(student_id="G209901CPS12B", name="12题回归开发学生", class_name="开发班", experiment_group="ai_pbl"),
    ]
    async with test_db() as db:
        db.add_all(students)
        await db.flush()
        db.add_all([
            ProfileSnapshot(user_id=student.id, cognition=61 + index, affect=52 + index, behavior=43 + index, source=ProfileSource.SYSTEM)
            for index, student in enumerate(students)
        ])
        await db.commit()
        existing_profiles = list((await db.scalars(select(ProfileSnapshot).order_by(ProfileSnapshot.user_id))).all())
        profile_before = [
            (item.id, item.user_id, item.cognition, item.affect, item.behavior, item.source, item.created_at)
            for item in existing_profiles
        ]
    headers = [{"Authorization": f"Bearer {create_access_token(str(student.id))}"} for student in students]
    created = await admin_client.post("/api/admin/assessments", json=draft)
    assert created.status_code == 200, created.text
    template = created.json()["data"]
    assert not template["enabled"] and template["published_at"] is None
    assert template["questions"] == expected_questions
    assert template["phase"] == "pre" and template["source"] == draft["source"]

    deliveries = []
    for student in students:
        distributed = await admin_client.post(
            f"/api/admin/assessments/{template['id']}/distribute",
            json={"class_name": student.class_name, "request_id": str(uuid4())},
        )
        assert distributed.status_code == 200, distributed.text
        delivered = distributed.json()["data"]
        assert delivered["id"] != template["id"]
        assert delivered["class_name"] == student.class_name
        assert delivered["questions"] == expected_questions
        assert delivered["phase"] == "pre"
        deliveries.append(delivered)
    assert deliveries[0]["id"] != deliveries[1]["id"]

    # Include all five valid values, explicit null/empty/whitespace, and omitted fields.
    answer_sets = [
        {"cps12_01": "1", "cps12_02": "2", "cps12_03": "3", "cps12_04": "4", "cps12_05": "5", "cps12_06": None, "cps12_07": "", "cps12_08": "   ", "cps12_10": "1", "cps12_11": "5", "cps12_12": "3"},
        {"cps12_01": "5", "cps12_02": "4", "cps12_03": "3", "cps12_04": "2", "cps12_05": "1", "cps12_06": None, "cps12_07": "", "cps12_09": "4", "cps12_10": "5", "cps12_11": None, "cps12_12": "2"},
    ]
    started_times, submitted_ids = [], []
    for index, (student, delivery, auth, answers) in enumerate(zip(students, deliveries, headers, answer_sets)):
        pending_response = await client.get("/api/assessments/pending", headers=auth)
        assert pending_response.status_code == 200, pending_response.text
        pending = pending_response.json()["data"]
        assert pending["id"] == delivery["id"] and pending["phase"] == "pre"
        assert pending["questions"] == expected_questions and "source" not in pending
        started_times.append(datetime.fromisoformat(pending["served_at"]))
        body = {"answers": answers, "started_at": pending["served_at"]}
        other_delivery = deliveries[1 - index]
        cross_class = await client.post(f"/api/assessments/{other_delivery['id']}/responses", headers=auth, json=body)
        assert cross_class.status_code == 404
        invalid_zero = await client.post(
            f"/api/assessments/{delivery['id']}/responses", headers=auth,
            json={**body, "answers": {**answers, "cps12_06": "0"}},
        )
        assert invalid_zero.status_code == 422
        submitted = await client.post(f"/api/assessments/{delivery['id']}/responses", headers=auth, json=body)
        assert submitted.status_code == 200, submitted.text
        submitted_ids.append(submitted.json()["data"]["id"])
        assert submitted.json()["data"]["already_submitted"] is False
        retry = await client.post(f"/api/assessments/{delivery['id']}/responses", headers=auth, json=body)
        assert retry.status_code == 200 and retry.json()["data"]["already_submitted"] is True
        assert (await client.get("/api/assessments/pending", headers=auth)).json()["data"] is None

        exported = await admin_client.get(f"/api/admin/assessments/{delivery['id']}/export")
        assert exported.status_code == 200, exported.text
        rows = list(csv.DictReader(io.StringIO(exported.content.decode("utf-8-sig"))))
        assert len(rows) == 12
        by_id = {row["question_id"]: row for row in rows}
        for question in expected_questions:
            row = by_id[question["id"]]
            raw = answers.get(question["id"])
            unanswered = raw is None or not raw.strip()
            assert row["round_id"] == delivery["id"]
            assert row["revision"] == str(delivery["revision"])
            assert row["response_id"] == submitted_ids[-1]
            assert row["user_id"] == str(student.id) and row["student_id"] == student.student_id
            assert row["class"] == student.class_name and row["group"] == student.experiment_group
            assert row["question"] == question["text"] and row["type"] == "choice"
            assert row["status"] == ("unanswered" if unanswered else "answered")
            assert row["answer_value"] == (raw if raw is not None else "")
            assert row["answer_value"] != "0"
            assert row["answer_label"] == (dict((option["value"], option["label"]) for option in question["options"]).get(raw, raw or ""))
            assert datetime.fromisoformat(row["started_at"]) == started_times[-1]
            assert started_times[-1] <= datetime.fromisoformat(row["submitted_at"]) <= datetime.now(timezone.utc)
        # phase and the original definition are exported independently and joined via round_id.
        definition = await admin_client.get(f"/api/admin/assessments/{delivery['id']}/definition")
        assert definition.status_code == 200
        assert definition.json()["id"] == rows[0]["round_id"]
        assert definition.json()["phase"] == "pre"
        assert definition.json()["source"] == draft["source"]
        assert definition.json()["questions"] == expected_questions

    # A post-labelled copy is a fresh definition/round; the student-visible instrument is identical.
    post_draft = deepcopy(draft)
    post_draft["phase"] = "post"
    post_created = await admin_client.post("/api/admin/assessments", json=post_draft)
    assert post_created.status_code == 200, post_created.text
    post_template = post_created.json()["data"]
    assert post_template["id"] != template["id"] and post_template["phase"] == "post"
    assert post_template["name"] == template["name"]
    assert post_template["questions"] == template["questions"] == expected_questions
    for student, auth, pre_delivery in zip(students, headers, deliveries):
        response = await admin_client.post(
            f"/api/admin/assessments/{post_template['id']}/distribute",
            json={"class_name": student.class_name, "request_id": str(uuid4())},
        )
        assert response.status_code == 200, response.text
        post_delivery = response.json()["data"]
        assert post_delivery["id"] != pre_delivery["id"] and post_delivery["phase"] == "post"
        assert post_delivery["questions"] == pre_delivery["questions"]
        pending = (await client.get("/api/assessments/pending", headers=auth)).json()["data"]
        assert pending["id"] == post_delivery["id"] and pending["phase"] == "post"
        assert pending["questions"] == expected_questions
        definition = (await admin_client.get(f"/api/admin/assessments/{post_delivery['id']}/definition")).json()
        assert definition["phase"] == "post" and definition["questions"] == expected_questions

    async with test_db() as db:
        original = await db.get(AssessmentRound, UUID(template["id"]))
        assert not original.enabled and original.published_at is None
        assert original.phase == "pre" and original.questions == expected_questions
        answers_in_db = list((await db.scalars(select(AssessmentResponse).order_by(AssessmentResponse.user_id))).all())
        assert len(answers_in_db) == 2
        for student, delivery, answers, started in zip(students, deliveries, answer_sets, started_times):
            stored = next(item for item in answers_in_db if item.user_id == student.id)
            assert str(stored.round_id) == delivery["id"]
            assert stored.answers == answers  # No synthetic zero, null filling, trimming, or missing-key expansion.
            assert stored.started_at == started
            assert stored.class_snapshot == student.class_name and stored.group_snapshot == student.experiment_group
        profiles_after = list((await db.scalars(select(ProfileSnapshot).order_by(ProfileSnapshot.user_id))).all())
        assert [(item.id, item.user_id, item.cognition, item.affect, item.behavior, item.source, item.created_at) for item in profiles_after] == profile_before
    rows = (await admin_client.get("/api/admin/assessments")).json()["data"]
    counts = {item["id"]: item["response_count"] for item in rows}
    assert all(counts[item["id"]] == 1 for item in deliveries)
    assert counts[template["id"]] == 0 and counts[post_template["id"]] == 0
