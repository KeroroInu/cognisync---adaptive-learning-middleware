"""Experience classrooms are independent of the two research conditions.

Run with a dedicated *_test database. No student/lesson is created by startup.
"""
import io
import json
import zipfile
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

from app.models.sql import AssessmentResponse, ClassroomResponse, ResearchTask, User
from tests.test_assessments import draft
from tests.test_classroom import classroom_actors
from tests.test_student_registration import registration
from tests.test_teacher_setup import unassigned

pytestmark = pytest.mark.asyncio


async def experience_actor(client, test_db, actors):
    async with test_db() as db:
        student = await db.get(User, actors["first_id"])
        student.class_name = "体验组"
        student.experiment_group = "experience"
        other = await db.get(User, actors["other_id"])
        other.class_name = "开发班"
        await db.commit()
    return actors["first"]


async def workspace(client, actors, class_name="体验组"):
    response = await client.post("/api/admin/classroom/workspace", headers=actors["teacher"],
                                 json={"class_name": class_name})
    assert response.status_code == 200, response.text
    return response.json()["data"]["id"]


async def test_experience_assignment_preserves_school_class_and_research_conditions(client, test_db, classroom_actors):
    actors = classroom_actors
    # Ordinary school registration still waits for a teacher to select a group.
    response = await client.post("/api/auth/register", json=registration(className=None, schoolClass="高二（5）班"))
    assert response.status_code == 200
    registered = response.json()["user"]
    assert registered["experimentGroup"] == "unassigned" and registered["className"] is None
    ids = [registered["id"], *(await unassigned(test_db, 2))]
    body = {"user_ids": ids, "class_name": "体验组"}
    assert (await client.post("/api/admin/users/batch-assign", headers=actors["other"], json=body)).status_code == 403
    result = await client.post("/api/admin/users/batch-assign", headers=actors["teacher"], json=body)
    assert result.status_code == 200 and result.json()["data"]["assigned"] == 3
    async with test_db() as db:
        students = (await db.scalars(select(User).where(User.id.in_([UUID(uid) for uid in ids])))).all()
        assert {(student.class_name, student.experiment_group) for student in students} == {("体验组", "experience")}
        assert (await db.get(User, UUID(ids[0]))).school_class == "高二（5）班"
        assert (await db.get(User, actors["first_id"])).experiment_group == "pdt"
        assert (await db.get(User, actors["other_id"])).experiment_group == "ai_pbl"
    listing = (await client.get("/api/admin/users?experiment_group=experience", headers=actors["teacher"])).json()["data"]
    assert listing["total"] == 3 and {row["id"] for row in listing["users"]} == set(ids)
    # Editing the class maps to the new group, while conflicting conditions fail.
    uid = ids[0]
    changed = await client.patch(f"/api/admin/users/{uid}", headers=actors["teacher"], json={"class_name": "开发班"})
    assert changed.status_code == 200 and changed.json()["data"]["experiment_group"] == "ai_pbl"
    assert (await client.patch(f"/api/admin/users/{uid}", headers=actors["teacher"],
                              json={"class_name": "体验组", "experiment_group": "pdt"})).status_code == 422
    assert (await client.patch(f"/api/admin/users/{uid}", headers=actors["teacher"],
                              json={"class_name": "体验组", "experiment_group": "experience"})).status_code == 200
    assert (await client.patch(f"/api/admin/users/{uid}", headers=actors["teacher"],
                              json={"experiment_group": "lecture"})).status_code == 422


async def test_experience_workspace_notice_assessment_and_poll_are_scoped(client, test_db, classroom_actors):
    actors = classroom_actors
    student = await experience_actor(client, test_db, actors)
    sid = await workspace(client, actors)
    assert await workspace(client, actors) == sid
    assert await workspace(client, actors, "开发班") != sid
    notice = {"request_id": str(uuid4()), "class_name": "体验组", "content": "体验课程资料", "target_user_ids": [str(actors["first_id"])]}
    published = await client.post("/api/admin/classroom/notices", headers=actors["teacher"], json=notice)
    assert published.status_code == 200, published.text
    state = (await client.get("/api/classroom/state", headers=student)).json()["data"]
    assert state["session"]["id"] == sid and state["notice"]["content"] == "体验课程资料"
    assert (await client.get("/api/classroom/state", headers=actors["other"])).json()["data"]["notice"] is None
    students = await client.get("/api/admin/classroom/notices/students?class_name=体验组", headers=actors["teacher"])
    assert students.status_code == 200 and [row["id"] for row in students.json()["data"]] == [str(actors["first_id"])]

    source = await client.post("/api/admin/assessments", headers=actors["teacher"], json=draft())
    assert source.status_code == 200
    source_id = source.json()["data"]["id"]
    delivery = await client.post(f"/api/admin/assessments/{source_id}/distribute", headers=actors["teacher"],
                                 json={"request_id": str(uuid4()), "class_name": "体验组"})
    assert delivery.status_code == 200, delivery.text
    rid = delivery.json()["data"]["id"]
    pending = (await client.get("/api/assessments/pending", headers=student)).json()["data"]
    assert pending["id"] == rid
    assert (await client.get("/api/assessments/pending", headers=actors["other"])).json()["data"] is None
    answered = await client.post(f"/api/assessments/{rid}/responses", headers=student,
                                json={"answers": {"q1": "1"}, "started_at": pending["served_at"]})
    assert answered.status_code == 200

    poll = await client.post(f"/api/admin/classroom/sessions/{sid}/polls", headers=actors["teacher"],
                            json={"request_id": str(uuid4()), "topic": "先做什么？", "option_a": "说明想法", "option_b": "完善代码"})
    assert poll.status_code == 200
    pid = poll.json()["data"]["id"]
    assert (await client.get("/api/classroom/state", headers=actors["other"])).json()["data"]["prompt"] is None
    assert (await client.post(f"/api/classroom/prompts/{pid}/responses", headers=actors["other"], json={"answer": "a"})).status_code == 404
    assert (await client.post(f"/api/classroom/prompts/{pid}/responses", headers=student, json={"answer": "a"})).status_code == 200
    async with test_db() as db:
        for model in (AssessmentResponse, ClassroomResponse):
            saved = await db.scalar(select(model).where(model.user_id == actors["first_id"]))
            assert saved.class_snapshot == "体验组" and saved.group_snapshot == "experience"


async def test_experience_research_task_is_custom_not_a_snake_condition(client, test_db, classroom_actors):
    actors = classroom_actors
    student = await experience_actor(client, test_db, actors)
    sid = await workspace(client, actors)
    body = {"title": "制作一份课堂图书管理器", "description": "自行选择实现方式", "instructions": "添加和查询图书", "ai_prompt": "先让学生描述目标", "code_content": "# book project", "target_group": "experience"}
    result = await client.post("/api/admin/research/tasks", headers=actors["teacher"], json=body)
    assert result.status_code == 200, result.text
    task_id = result.json()["data"]["id"]
    assert (await client.patch(f"/api/admin/research/tasks/{task_id}", headers=actors["teacher"],
                              json={"target_group": "experience", "title": "自选图书管理器"})).status_code == 200
    assert (await client.post(f"/api/admin/research/tasks/{task_id}/activate", headers=actors["teacher"])).status_code == 200
    path = f"/api/admin/classroom/sessions/{sid}/lesson"
    assert (await client.post(path, headers=actors["teacher"], json={"tasks": {"pdt": task_id}})).status_code == 422
    assigned = await client.post(path, headers=actors["teacher"], json={"tasks": {"experience": task_id}, "knowledge_points": ["字典", "输入输出"]})
    assert assigned.status_code == 200, assigned.text
    snapshot = assigned.json()["data"]["configuration"]["tasks"]["experience"]
    assert snapshot["ai_prompt"] == body["ai_prompt"] and snapshot["code_content"] == body["code_content"]
    assert (await client.post(f"/api/admin/classroom/sessions/{sid}/lesson/start", headers=actors["teacher"])).status_code == 200
    active = await client.get("/api/research/active-task", headers=student)
    assert active.status_code == 200 and active.json()["data"]["id"] == task_id
    assert (await client.get("/api/research/active-task", headers=actors["other"])).status_code == 404
    async with test_db() as db:
        task = await db.get(ResearchTask, UUID(task_id))
        assert task.target_group == "experience" and task.code_content == "# book project"


async def test_experience_export_is_explicit_and_keeps_research_groups_separate(client, test_db, classroom_actors):
    actors = classroom_actors
    await experience_actor(client, test_db, actors)
    async with test_db() as db:
        legacy = User(student_id="experience-legacy", name="历史讲授组", experiment_group="lecture", class_name="讲授班")
        db.add(legacy)
        await db.commit()
        legacy_id = str(legacy.id)

    async def exported_students(group):
        response = await client.get(f"/api/admin/export/research-package?group={group}&include_graph=false", headers=actors["teacher"])
        assert response.status_code == 200, response.text[:200] if response.status_code != 200 else ""
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            assert manifest["filters"]["experiment_group"] == group
            users = [json.loads(line) for line in archive.read("users.jsonl").splitlines()]
            return {row["id"] for row in users if row["role"] in ("learner", "student", "user")}

    assert await exported_students("experience") == {str(actors["first_id"])}
    assert await exported_students("ai_pbl") == {str(actors["other_id"])}
    assert await exported_students("pdt") == {str(actors["second_id"])}
    assert await exported_students("lecture") == {legacy_id}
