"""Codex 二次复核 P0-B/C/D/E 与 P1-A/B 的集成测试。

⚠️ 需要真实 PostgreSQL：本文件验证的全是数据库层语义——``ON CONFLICT DO UPDATE``
的字段合并、并发写入不 500、外键与删除保护、以及跨请求的版本一致性。
用假 session 模拟这些只能断言「我的桩返回了我让它返回的东西」。

运行方式：
    cd backend
    export TEST_DATABASE_URL=postgresql+asyncpg://用户:密码@localhost:5432/cognisync_test
    pytest tests/test_research_task_guard_api.py -v
"""
from __future__ import annotations

import asyncio
import csv
import io
import uuid

import pytest
from sqlalchemy import func, select

from app.models.sql.message import ChatMessage
from app.models.sql.research import (
    ResearchTask,
    ResearchTaskStatus,
    ResearchTaskSubmission,
)
from app.models.sql.research_event import (
    ArtifactVersion,
    ScaffoldDeliveryStatus,
    ScaffoldEvent,
    StageArtifact,
    StageEvent,
    StageEventType,
)
from app.models.sql.user import User


# ── 辅助 ──────────────────────────────────────────────────────────────────────

async def _create_task(
    session_factory,
    *,
    target_group: str = "all",
    status: ResearchTaskStatus = ResearchTaskStatus.ACTIVE,
) -> uuid.UUID:
    async with session_factory() as session:
        task = ResearchTask(
            title="贪吃蛇项目工坊",
            code_content="# starter",
            language="python",
            target_group=target_group,
            status=status,
        )
        session.add(task)
        await session.commit()
        await session.refresh(task)
        return task.id


async def _set_experiment_group(session_factory, user_id: str, group: str) -> None:
    async with session_factory() as session:
        user = await session.get(User, uuid.UUID(user_id))
        user.experiment_group = group
        await session.commit()


def _event_body(**overrides) -> dict:
    body = {
        "request_id": f"req-{uuid.uuid4().hex[:12]}",
        "stage": "decompose",
        "event_type": "stage_confirm",
        "detail": {"cardCount": 1},
        "artifacts": [
            {
                "artifact_type": "function_card",
                "artifact_key": "fc-1",
                "content": {"responsibility": "移动蛇身", "input": "方向"},
                "change_source": "stage_confirm",
            }
        ],
    }
    body.update(overrides)
    return body


async def _submission(session_factory, task_id: uuid.UUID, user_id: str):
    async with session_factory() as session:
        return (
            await session.execute(
                select(ResearchTaskSubmission).where(
                    ResearchTaskSubmission.task_id == task_id,
                    ResearchTaskSubmission.user_id == uuid.UUID(user_id),
                )
            )
        ).scalar_one_or_none()


# ══ P0-B：submission 并发写入 ════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_concurrent_stage_event_and_save_workspace_do_not_500(
    test_db, client, auth_headers, registered_user
):
    """学生端自动保存与阶段确认同时触发是真实场景，不是理论并发。

    加上 (task_id,user_id) 唯一约束后，两条路径若各自「先查再插」，
    其中一个必然抛 IntegrityError 并返回 500。
    """
    task_id = await _create_task(test_db)

    results = await asyncio.gather(
        client.post(
            f"/api/research/tasks/{task_id}/stage-events",
            headers=auth_headers,
            json=_event_body(),
        ),
        client.post(
            f"/api/research/tasks/{task_id}/save-workspace",
            headers=auth_headers,
            json={"workspace_data": {"functionCards": [{"id": "fc-1"}]}},
        ),
        return_exceptions=True,
    )

    for item in results:
        assert not isinstance(item, Exception), item
        assert item.status_code == 200, item.text

    # 唯一约束保证只有一行；scalar_one_or_none 不会抛 MultipleResultsFound。
    assert await _submission(test_db, task_id, registered_user["user_id"]) is not None


@pytest.mark.asyncio
async def test_concurrent_save_workspace_calls_do_not_500(
    test_db, client, auth_headers
):
    task_id = await _create_task(test_db)

    results = await asyncio.gather(
        *[
            client.post(
                f"/api/research/tasks/{task_id}/save-workspace",
                headers=auth_headers,
                json={"workspace_data": {"round": index}},
            )
            for index in range(4)
        ],
        return_exceptions=True,
    )
    for item in results:
        assert not isinstance(item, Exception), item
        assert item.status_code == 200, item.text

    async with test_db() as session:
        count = await session.scalar(select(func.count(ResearchTaskSubmission.id)))
        assert count == 1


@pytest.mark.asyncio
async def test_stage_event_freeze_does_not_wipe_saved_workspace(
    test_db, client, auth_headers, registered_user
):
    """只负责冻结蓝图的写入不得清空学生刚保存的工作区。

    这是「共享 upsert」最容易写错的地方：冻结调用不带 workspace_data，
    若用无条件 SET 就会把学生内容覆盖成 NULL。
    """
    task_id = await _create_task(test_db)

    await client.post(
        f"/api/research/tasks/{task_id}/save-workspace",
        headers=auth_headers,
        json={"workspace_data": {"functionCards": [{"id": "fc-1", "text": "移动"}]}},
    )
    await client.post(
        f"/api/research/tasks/{task_id}/stage-events",
        headers=auth_headers,
        json=_event_body(),
    )

    submission = await _submission(test_db, task_id, registered_user["user_id"])
    assert submission.workspace_data is not None
    assert submission.workspace_data["functionCards"][0]["text"] == "移动"


@pytest.mark.asyncio
async def test_empty_autosave_does_not_erase_existing_code(
    test_db, client, auth_headers, registered_user
):
    """编辑器尚未就绪时的空自动保存不得抹掉学生已写的代码。"""
    task_id = await _create_task(test_db)

    await client.post(
        f"/api/research/tasks/{task_id}/save-progress",
        headers=auth_headers,
        json={"code_submitted": "def move():\n    pass"},
    )
    await client.post(
        f"/api/research/tasks/{task_id}/save-progress",
        headers=auth_headers,
        json={"code_submitted": ""},
    )

    submission = await _submission(test_db, task_id, registered_user["user_id"])
    assert "def move()" in submission.code_submitted


@pytest.mark.asyncio
async def test_started_at_keeps_the_earliest_value(
    test_db, client, auth_headers, registered_user
):
    """重进任务不应重置学习时长。"""
    task_id = await _create_task(test_db)

    await client.post(
        f"/api/research/tasks/{task_id}/save-progress",
        headers=auth_headers,
        json={"code_submitted": "a", "started_at": "2026-08-16T01:00:00Z"},
    )
    await client.post(
        f"/api/research/tasks/{task_id}/save-progress",
        headers=auth_headers,
        json={"code_submitted": "b", "started_at": "2026-08-16T09:00:00Z"},
    )

    submission = await _submission(test_db, task_id, registered_user["user_id"])
    assert submission.started_at.hour == 1


# ══ P0-C：任务可见性与 ACTIVE 状态 ═══════════════════════════════════════════

@pytest.mark.asyncio
async def test_stage_event_rejects_other_experiment_group_task(
    test_db, client, auth_headers, registered_user
):
    await _set_experiment_group(test_db, registered_user["user_id"], "control")
    task_id = await _create_task(test_db, target_group="experimental")

    response = await client.post(
        f"/api/research/tasks/{task_id}/stage-events",
        headers=auth_headers,
        json=_event_body(),
    )
    assert response.status_code == 404

    async with test_db() as session:
        assert await session.scalar(select(func.count(StageEvent.id))) == 0


@pytest.mark.asyncio
async def test_archived_task_rejects_new_evidence(test_db, client, auth_headers):
    """归档任务不应再接收新证据：研究数据里不该出现「任务结束后仍在产生过程数据」。"""
    task_id = await _create_task(test_db, status=ResearchTaskStatus.ARCHIVED)

    response = await client.post(
        f"/api/research/tasks/{task_id}/stage-events",
        headers=auth_headers,
        json=_event_body(),
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "TASK_NOT_ACTIVE"


@pytest.mark.asyncio
async def test_draft_task_rejects_save_workspace(test_db, client, auth_headers):
    task_id = await _create_task(test_db, status=ResearchTaskStatus.DRAFT)

    response = await client.post(
        f"/api/research/tasks/{task_id}/save-workspace",
        headers=auth_headers,
        json={"workspace_data": {}},
    )
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_nonexistent_task_returns_404_not_500(test_db, client, auth_headers):
    """伪造 UUID 应返回 404，与「存在但不可见」用同一状态码，避免存在性泄漏。"""
    response = await client.post(
        f"/api/research/tasks/{uuid.uuid4()}/stage-events",
        headers=auth_headers,
        json=_event_body(),
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_chat_scaffold_rejects_other_group_task(
    test_db, client, auth_headers, registered_user
):
    """核心组间隔离：对照组学生不得借 taskId 读取实验组的教师支架策略。

    这不只是越权——若放行，对照组的 AI 会按实验组策略作答，组间差异直接失效。
    """
    await _set_experiment_group(test_db, registered_user["user_id"], "control")
    task_id = await _create_task(test_db, target_group="experimental")

    response = await client.post(
        "/api/chat",
        headers=auth_headers,
        json={
            "message": "我卡住了",
            "language": "zh",
            "isResearchMode": True,
            "scaffoldContext": {
                "requestId": f"req-{uuid.uuid4().hex[:8]}",
                "taskId": str(task_id),
                "stage": "build",
                "level": 2,
                "trigger": "hint_button",
            },
        },
    )
    assert response.status_code == 404

    async with test_db() as session:
        assert await session.scalar(select(func.count(StageEvent.id))) == 0
        assert await session.scalar(select(func.count(ScaffoldEvent.id))) == 0
        assert await session.scalar(select(func.count(ResearchTaskSubmission.id))) == 0


@pytest.mark.asyncio
async def test_chat_scaffold_with_bogus_task_id_is_rejected_not_downgraded(
    test_db, client, auth_headers
):
    """无效 taskId 必须显式拒绝，不能静默降级成 task_id 为空的研究事件。

    静默降级会在导出里留下无法与真实数据区分的孤儿事件行。
    """
    response = await client.post(
        "/api/chat",
        headers=auth_headers,
        json={
            "message": "我卡住了",
            "language": "zh",
            "isResearchMode": True,
            "scaffoldContext": {
                "requestId": f"req-{uuid.uuid4().hex[:8]}",
                "taskId": str(uuid.uuid4()),
                "stage": "build",
                "level": 1,
                "trigger": "hint_button",
            },
        },
    )
    assert response.status_code == 404

    async with test_db() as session:
        assert await session.scalar(select(func.count(StageEvent.id))) == 0


# ══ P0-D：删除保护与导出原文 ═════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_deleting_submission_with_evidence_is_rejected(
    test_db, client, admin_client, auth_headers, registered_user
):
    """删除 submission 会让已冻结的蓝图版本漂移到教师当前版本。"""
    task_id = await _create_task(test_db)
    await client.post(
        f"/api/research/tasks/{task_id}/stage-events",
        headers=auth_headers,
        json=_event_body(),
    )

    submission = await _submission(test_db, task_id, registered_user["user_id"])
    assert submission is not None

    response = await admin_client.request(
        "DELETE",
        "/api/admin/research/submissions/batch",
        json=[str(submission.id)],
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "RESEARCH_EVIDENCE_EXISTS"

    assert await _submission(test_db, task_id, registered_user["user_id"]) is not None


@pytest.mark.asyncio
async def test_deleting_session_referenced_by_scaffold_event_is_rejected(
    test_db, client, admin_client, auth_headers
):
    """外键是 SET NULL，删除会话不会报错而是静默切断原文链路。"""
    task_id = await _create_task(test_db)
    await client.post(
        "/api/chat",
        headers=auth_headers,
        json={
            "message": "移动模块怎么写",
            "language": "zh",
            "isResearchMode": True,
            "scaffoldContext": {
                "requestId": f"req-{uuid.uuid4().hex[:8]}",
                "taskId": str(task_id),
                "stage": "build",
                "level": 2,
                "trigger": "hint_button",
            },
        },
    )

    async with test_db() as session:
        scaffold = (await session.execute(select(ScaffoldEvent))).scalar_one()
        message = await session.get(ChatMessage, scaffold.student_message_id)
        session_id = message.session_id

    response = await admin_client.delete(f"/api/admin/sessions/{session_id}")
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "RESEARCH_EVIDENCE_EXISTS"

    async with test_db() as session:
        scaffold = (await session.execute(select(ScaffoldEvent))).scalar_one()
        assert scaffold.student_message_id is not None
        assert scaffold.assistant_message_id is not None


@pytest.mark.asyncio
async def test_scaffold_export_contains_student_question_and_ai_suggestion(
    test_db, client, admin_client, auth_headers, registered_user
):
    """只有消息 ID 无法回答「AI 到底给了什么建议」，导出必须带原文。

    上一版本这条测试请求了 ``/api/admin/export/scaffold-events``——真实路由是
    ``/api/admin/export/csv/scaffold-events``。它只拿到 404 却仍然通过了，
    因为断言用的是 ``in response.text``，而 404 的 JSON 里恰好不含那些列名的
    反例。等于完全没有验证导出内容。这里改用真实路由并**真正解析 CSV**。
    """
    task_id = await _create_task(test_db)
    question = "移动模块的边界条件怎么判断"
    request_id = f"req-{uuid.uuid4().hex[:8]}"

    chat_response = await client.post(
        "/api/chat",
        headers=auth_headers,
        json={
            "message": question,
            "language": "zh",
            "isResearchMode": True,
            "scaffoldContext": {
                "requestId": request_id,
                "taskId": str(task_id),
                "stage": "build",
                "level": 2,
                "trigger": "hint_button",
            },
        },
    )
    assert chat_response.status_code == 200, chat_response.text

    response = await admin_client.get("/api/admin/export/csv/scaffold-events")
    assert response.status_code == 200, response.text

    rows = list(csv.DictReader(io.StringIO(response.text)))
    assert len(rows) == 1, f"应恰好导出一条支架事件，实际 {len(rows)}"
    row = rows[0]

    # 必需列存在
    for column in (
        "student_message_text",
        "assistant_suggestion_text",
        "requested_level",
        "applied_level",
        "adopted",
        "stage",
        "task_id",
        "user_id",
        "request_id",
    ):
        assert column in row, f"导出缺少列 {column}；实际列：{sorted(row)}"

    # 内容与关联消息一致，而不只是「列名出现在响应里」
    async with test_db() as session:
        scaffold = (await session.execute(select(ScaffoldEvent))).scalar_one()
        student_msg = await session.get(ChatMessage, scaffold.student_message_id)
        assistant_msg = await session.get(ChatMessage, scaffold.assistant_message_id)

    assert row["student_message_text"] == student_msg.text
    assert row["student_message_text"] == question
    assert row["assistant_suggestion_text"] == assistant_msg.text
    assert row["assistant_suggestion_text"], "AI 建议原文不得为空"

    # 标识列与实际记录对应
    assert row["request_id"] == request_id
    assert row["task_id"] == str(task_id)
    assert row["user_id"] == registered_user["user_id"]
    assert row["stage"] == "build", "枚举必须导出为小写 value"

    # 等级
    assert row["applied_level"] == str(scaffold.applied_level)
    assert row["requested_level"] == str(scaffold.requested_level)

    # adopted 允许为空，但任务 5 之前不得出现 True/False
    assert row["adopted"] == "", f"任务 5 之前 adopted 必须为空，实际 {row['adopted']!r}"


@pytest.mark.asyncio
async def test_session_without_scaffold_reference_can_still_be_deleted(
    test_db, client, admin_client, auth_headers
):
    """保护范围必须精确：普通对话会话仍应可以删除，否则管理能力被过度削弱。"""
    await client.post(
        "/api/chat",
        headers=auth_headers,
        json={"message": "你好", "language": "zh", "isResearchMode": False},
    )

    async with test_db() as session:
        message = (await session.execute(select(ChatMessage))).scalars().first()
        session_id = message.session_id

    response = await admin_client.delete(f"/api/admin/sessions/{session_id}")
    assert response.status_code == 200


# ══ P1-A：幂等键复用 ═════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_same_request_id_with_same_payload_is_a_replay(
    test_db, client, auth_headers
):
    task_id = await _create_task(test_db)
    body = _event_body()

    first = await client.post(
        f"/api/research/tasks/{task_id}/stage-events", headers=auth_headers, json=body
    )
    second = await client.post(
        f"/api/research/tasks/{task_id}/stage-events", headers=auth_headers, json=body
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()["data"]["replayed"] is True

    async with test_db() as session:
        assert await session.scalar(select(func.count(StageEvent.id))) == 1


@pytest.mark.asyncio
async def test_same_request_id_with_different_payload_returns_409(
    test_db, client, auth_headers
):
    """键复用但内容不同不是重试，静默返回旧事件会丢掉这次真实上报。"""
    task_id = await _create_task(test_db)
    request_id = f"req-{uuid.uuid4().hex[:12]}"

    first = await client.post(
        f"/api/research/tasks/{task_id}/stage-events",
        headers=auth_headers,
        json=_event_body(request_id=request_id),
    )
    assert first.status_code == 200

    second = await client.post(
        f"/api/research/tasks/{task_id}/stage-events",
        headers=auth_headers,
        json=_event_body(
            request_id=request_id,
            detail={"cardCount": 99},
        ),
    )
    assert second.status_code == 409
    assert second.json()["detail"]["code"] == "IDEMPOTENCY_KEY_REUSED"


@pytest.mark.asyncio
async def test_request_id_reused_across_tasks_returns_409(
    test_db, client, auth_headers
):
    """唯一键只有 (user_id, request_id)，跨任务复用最容易返回另一个任务的事件。"""
    task_a = await _create_task(test_db)
    task_b = await _create_task(test_db)
    request_id = f"req-{uuid.uuid4().hex[:12]}"

    await client.post(
        f"/api/research/tasks/{task_a}/stage-events",
        headers=auth_headers,
        json=_event_body(request_id=request_id),
    )
    response = await client.post(
        f"/api/research/tasks/{task_b}/stage-events",
        headers=auth_headers,
        json=_event_body(request_id=request_id),
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "IDEMPOTENCY_KEY_REUSED"


# ══ P1-B：重放返回事件当时的版本 ═════════════════════════════════════════════

@pytest.mark.asyncio
async def test_replay_returns_version_at_event_time_not_current(
    test_db, client, auth_headers
):
    """产物后续修订出 v2 后，重放旧 request_id 不得把旧事件报成最新版本。"""
    task_id = await _create_task(test_db)
    first_body = _event_body()

    first = await client.post(
        f"/api/research/tasks/{task_id}/stage-events",
        headers=auth_headers,
        json=first_body,
    )
    assert first.json()["data"]["artifacts"][0]["version"] == 1

    # 同一产物的实质修改，产生 v2
    second = await client.post(
        f"/api/research/tasks/{task_id}/stage-events",
        headers=auth_headers,
        json=_event_body(
            stage="build",
            event_type="structure_change",
            artifacts=[
                {
                    "artifact_type": "function_card",
                    "artifact_key": "fc-1",
                    "content": {"responsibility": "移动蛇身并检测边界"},
                    "change_source": "structure_edit",
                }
            ],
        ),
    )
    assert second.json()["data"]["artifacts"][0]["version"] == 2

    replay = await client.post(
        f"/api/research/tasks/{task_id}/stage-events",
        headers=auth_headers,
        json=first_body,
    )
    assert replay.status_code == 200
    data = replay.json()["data"]
    assert data["replayed"] is True
    assert data["artifacts"][0]["version"] == 1, "重放必须返回事件当时的版本"


# ══ P1-C：阶段—事件—产物组合 ═════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_module_test_in_observe_stage_returns_422(test_db, client, auth_headers):
    task_id = await _create_task(test_db)

    response = await client.post(
        f"/api/research/tasks/{task_id}/stage-events",
        headers=auth_headers,
        json=_event_body(stage="observe", event_type="module_test", artifacts=[]),
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_path_artifact_in_observe_stage_returns_422(
    test_db, client, auth_headers
):
    task_id = await _create_task(test_db)

    response = await client.post(
        f"/api/research/tasks/{task_id}/stage-events",
        headers=auth_headers,
        json=_event_body(
            stage="observe",
            artifacts=[
                {
                    "artifact_type": "path",
                    "artifact_key": "p-1",
                    "content": {"nodes": []},
                    "change_source": "stage_confirm",
                }
            ],
        ),
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_build_stage_revision_of_function_card_is_allowed(
    test_db, client, auth_headers
):
    """「测试失败后回到解构结果修订」是教学主线，不得被组合校验挡死。"""
    task_id = await _create_task(test_db)

    response = await client.post(
        f"/api/research/tasks/{task_id}/stage-events",
        headers=auth_headers,
        json=_event_body(stage="build", event_type="structure_change"),
    )
    assert response.status_code == 200, response.text


@pytest.mark.asyncio
async def test_invalid_combination_writes_nothing(test_db, client, auth_headers):
    """组合校验必须先于任何写入，不能留下半截证据。"""
    task_id = await _create_task(test_db)

    await client.post(
        f"/api/research/tasks/{task_id}/stage-events",
        headers=auth_headers,
        json=_event_body(stage="observe", event_type="module_test"),
    )

    async with test_db() as session:
        assert await session.scalar(select(func.count(StageEvent.id))) == 0
        assert await session.scalar(select(func.count(ResearchTaskSubmission.id))) == 0


# ══ P0-E：迁移不得自动删数据 ═════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_migration_aborts_on_duplicate_submissions_without_deleting(
    test_db, registered_user, monkeypatch
):
    """有冲突数据时迁移必须中止并**逐字段**保留全部行，由人工合并。

    自动按 updated_at 删除会不可逆地丢掉另一行的工作区、代码与冻结蓝图。

    上一版本这条测试用 ``select(User).first()`` 取用户，但没有依赖
    ``registered_user`` fixture，于是拿到 ``None``，在制造重复行之前就
    ``AttributeError`` 了——根本没有跑到迁移逻辑。这里显式创建用户与任务。

    ``monkeypatch`` 不可省略：``_run_migration_sql`` 用的是 ``app.db.postgres``
    的模块级 ``engine``，它绑定在 ``settings.database_url``（**生产库**）上，
    而 conftest 只覆盖了 ``get_db`` 依赖，没有替换这个 engine。不打补丁的话，
    重复行插在测试库、迁移却跑在生产库上：既测不到中止逻辑（生产库没有重复行，
    所以不会抛异常），又会对生产库执行 DDL。
    """
    from sqlalchemy import text as sql_text

    from app.db import postgres as postgres_module
    from app.db.postgres import _migrate_research_process_events

    # 让迁移作用于测试库。test_db 是 sessionmaker，.bind 即其 engine。
    monkeypatch.setattr(postgres_module, "engine", test_db.kw["bind"], raising=True)

    task_id = await _create_task(test_db)
    user_id = uuid.UUID(registered_user["user_id"])

    first_id = uuid.uuid4()
    second_id = uuid.uuid4()

    async with test_db() as session:
        # 制造重复：先卸掉唯一约束（若已建立），再插入两行。
        await session.execute(
            sql_text(
                "ALTER TABLE research_task_submissions "
                "DROP CONSTRAINT IF EXISTS uq_research_submission_task_user"
            )
        )
        session.add_all([
            ResearchTaskSubmission(
                id=first_id,
                task_id=task_id,
                user_id=user_id,
                code_submitted="第一份：更早但工作区更完整",
                workspace_data={"functionCards": [{"id": "fc-1"}, {"id": "fc-2"}]},
                is_completed=False,
            ),
            ResearchTaskSubmission(
                id=second_id,
                task_id=task_id,
                user_id=user_id,
                code_submitted="第二份：更晚但工作区为空",
                workspace_data=None,
                is_completed=False,
            ),
        ])
        await session.commit()

    # 记录迁移前的完整快照，用于逐字段比对
    async with test_db() as session:
        before = {
            row.id: {
                "code_submitted": row.code_submitted,
                "workspace_data": row.workspace_data,
                "blueprint_version_id": row.blueprint_version_id,
                "is_completed": row.is_completed,
            }
            for row in (
                await session.execute(select(ResearchTaskSubmission))
            ).scalars()
        }
    assert set(before) == {first_id, second_id}

    with pytest.raises(Exception) as excinfo:
        await _migrate_research_process_events()
    assert "duplicated" in str(excinfo.value).lower()

    async with test_db() as session:
        after_rows = (
            await session.execute(select(ResearchTaskSubmission))
        ).scalars().all()
        after = {
            row.id: {
                "code_submitted": row.code_submitted,
                "workspace_data": row.workspace_data,
                "blueprint_version_id": row.blueprint_version_id,
                "is_completed": row.is_completed,
            }
            for row in after_rows
        }

        # 两行都还在，且没有任何字段被自动合并、覆盖或清空
        assert set(after) == {first_id, second_id}, "迁移中止时不得删除任何一行"
        assert after == before, "迁移不得修改任何字段"

        # 唯一约束不得处于半完成状态：要么没建，要么建成且有效。
        constraint_exists = await session.scalar(
            sql_text(
                "SELECT count(*) FROM pg_constraint c "
                "JOIN pg_class t ON t.oid = c.conrelid "
                "JOIN pg_namespace n ON n.oid = t.relnamespace "
                "WHERE n.nspname = current_schema() "
                "  AND t.relname = 'research_task_submissions' "
                "  AND c.conname = 'uq_research_submission_task_user'"
            )
        )
        assert constraint_exists == 0, (
            "存在重复数据时约束不可能建成；若为 1 说明迁移处于半完成状态"
        )

        # 约束确实缺失 → 重复行能够继续共存，说明数据库没有被悄悄改动
        still_duplicated = await session.scalar(
            select(func.count(ResearchTaskSubmission.id)).where(
                ResearchTaskSubmission.task_id == task_id,
                ResearchTaskSubmission.user_id == user_id,
            )
        )
        assert still_duplicated == 2


# ══ 送达语义回归（P0-4 仍然成立） ═══════════════════════════════════════════

@pytest.mark.asyncio
async def test_successful_scaffold_still_records_delivered(
    test_db, client, auth_headers
):
    """加入授权校验后，正常路径不应被误伤。"""
    task_id = await _create_task(test_db)

    response = await client.post(
        "/api/chat",
        headers=auth_headers,
        json={
            "message": "我卡在移动模块了",
            "language": "zh",
            "isResearchMode": True,
            "scaffoldContext": {
                "requestId": f"req-{uuid.uuid4().hex[:8]}",
                "taskId": str(task_id),
                "stage": "build",
                "level": 2,
                "trigger": "hint_button",
            },
        },
    )
    assert response.status_code == 200, response.text

    async with test_db() as session:
        scaffold = (await session.execute(select(ScaffoldEvent))).scalar_one()
        assert scaffold.delivery_status == ScaffoldDeliveryStatus.DELIVERED
        assert scaffold.assistant_message_id is not None
        help_count = await session.scalar(select(func.count(StageEvent.id)))
        assert help_count == 1


# ══ A：幂等指纹必须覆盖完整语义载荷 ══════════════════════════════════════════
#
# 只把 content 纳入指纹是不够的：同一份内容换成另一张卡、另一类产物或另一种
# 修改来源，都是**不同的上报**。指纹相同就会被误判为重放，这次真实数据被静默丢弃。

def _artifact(**overrides) -> dict:
    payload = {
        "artifact_type": "function_card",
        "artifact_key": "fc-1",
        "content": {"responsibility": "移动蛇身", "input": "方向"},
        "change_source": "stage_confirm",
        "change_reason": "首次确认",
    }
    payload.update(overrides)
    return payload


async def _post_twice(client, headers, task_id, first_artifact, second_artifact):
    """用同一 request_id 发两次，返回第二次的响应。"""
    request_id = f"req-{uuid.uuid4().hex[:12]}"
    first = await client.post(
        f"/api/research/tasks/{task_id}/stage-events",
        headers=headers,
        json=_event_body(request_id=request_id, artifacts=[first_artifact]),
    )
    assert first.status_code == 200, first.text
    return await client.post(
        f"/api/research/tasks/{task_id}/stage-events",
        headers=headers,
        json=_event_body(request_id=request_id, artifacts=[second_artifact]),
    )


@pytest.mark.asyncio
async def test_identical_payload_replays(test_db, client, auth_headers):
    task_id = await _create_task(test_db)
    response = await _post_twice(
        client, auth_headers, task_id, _artifact(), _artifact()
    )
    assert response.status_code == 200
    assert response.json()["data"]["replayed"] is True


@pytest.mark.asyncio
async def test_different_artifact_key_returns_409(test_db, client, auth_headers):
    """同 key、同 content，但换了一张卡——这是不同的上报，不是重试。"""
    task_id = await _create_task(test_db)
    response = await _post_twice(
        client, auth_headers, task_id,
        _artifact(artifact_key="fc-1"),
        _artifact(artifact_key="fc-2"),
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "IDEMPOTENCY_KEY_REUSED"


@pytest.mark.asyncio
async def test_different_artifact_type_returns_409(test_db, client, auth_headers):
    task_id = await _create_task(test_db)
    response = await _post_twice(
        client, auth_headers, task_id,
        _artifact(artifact_type="function_card"),
        _artifact(artifact_type="function_mapping"),
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "IDEMPOTENCY_KEY_REUSED"


@pytest.mark.asyncio
async def test_different_change_source_returns_409(test_db, client, auth_headers):
    """修改来源是研究变量（学生自发 vs 支架跟进），不能被指纹忽略。"""
    task_id = await _create_task(test_db)
    response = await _post_twice(
        client, auth_headers, task_id,
        _artifact(change_source="stage_confirm"),
        _artifact(change_source="scaffold_followup"),
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "IDEMPOTENCY_KEY_REUSED"


@pytest.mark.asyncio
async def test_different_change_reason_returns_409(test_db, client, auth_headers):
    task_id = await _create_task(test_db)
    response = await _post_twice(
        client, auth_headers, task_id,
        _artifact(change_reason="首次确认"),
        _artifact(change_reason="测试失败后修订"),
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "IDEMPOTENCY_KEY_REUSED"


@pytest.mark.asyncio
async def test_key_order_difference_still_replays(test_db, client, auth_headers):
    """JSON 键顺序不稳定是前端序列化的常态，不构成实质修改。"""
    task_id = await _create_task(test_db)
    response = await _post_twice(
        client, auth_headers, task_id,
        _artifact(content={"responsibility": "移动蛇身", "input": "方向"}),
        _artifact(content={"input": "方向", "responsibility": "移动蛇身"}),
    )
    assert response.status_code == 200
    assert response.json()["data"]["replayed"] is True


@pytest.mark.asyncio
async def test_artifact_order_change_returns_409(test_db, client, auth_headers):
    """产物顺序会写入关联表的 position，顺序不同即为不同的上报。"""
    task_id = await _create_task(test_db)
    request_id = f"req-{uuid.uuid4().hex[:12]}"
    a = _artifact(artifact_key="fc-1")
    b = _artifact(artifact_key="fc-2")

    first = await client.post(
        f"/api/research/tasks/{task_id}/stage-events",
        headers=auth_headers,
        json=_event_body(request_id=request_id, artifacts=[a, b]),
    )
    assert first.status_code == 200

    second = await client.post(
        f"/api/research/tasks/{task_id}/stage-events",
        headers=auth_headers,
        json=_event_body(request_id=request_id, artifacts=[b, a]),
    )
    assert second.status_code == 409


@pytest.mark.asyncio
async def test_duplicate_artifact_in_one_request_returns_422(
    test_db, client, auth_headers
):
    """一次请求内重复同一 (type, key) 必须显式拒绝。

    否则关联表的唯一约束会让第二项 ON CONFLICT DO NOTHING 静默消失：
    接口返回 200 而响应里少了一个产物，客户端无从察觉；两项内容不同时
    还会凭空多出一次「修订」，污染修订次数指标。
    """
    task_id = await _create_task(test_db)

    response = await client.post(
        f"/api/research/tasks/{task_id}/stage-events",
        headers=auth_headers,
        json=_event_body(artifacts=[
            _artifact(artifact_key="fc-1", content={"responsibility": "移动"}),
            _artifact(artifact_key="fc-1", content={"responsibility": "移动并检测边界"}),
        ]),
    )
    assert response.status_code == 422
    assert "fc-1" in str(response.json()["detail"])

    async with test_db() as session:
        assert await session.scalar(select(func.count(StageEvent.id))) == 0


@pytest.mark.asyncio
async def test_same_key_different_type_is_not_a_duplicate(
    test_db, client, auth_headers
):
    """去重键是 (type, key) 而非 key：一张卡的功能卡与契约共用卡片 ID 是合法的。"""
    task_id = await _create_task(test_db)

    response = await client.post(
        f"/api/research/tasks/{task_id}/stage-events",
        headers=auth_headers,
        json=_event_body(artifacts=[
            _artifact(artifact_type="function_card", artifact_key="fc-1"),
            _artifact(artifact_type="function_mapping", artifact_key="fc-1"),
        ]),
    )
    assert response.status_code == 200, response.text
    assert len(response.json()["data"]["artifacts"]) == 2


# ══ B：删除保护落在数据库约束上 ══════════════════════════════════════════════

@pytest.mark.asyncio
async def test_referenced_message_cannot_be_deleted_at_db_level(
    test_db, client, auth_headers
):
    """绕过 API 直接删消息也必须失败——保护在外键上，不在应用检查里。"""
    from sqlalchemy.exc import IntegrityError

    task_id = await _create_task(test_db)
    await client.post(
        "/api/chat",
        headers=auth_headers,
        json={
            "message": "移动模块怎么写",
            "language": "zh",
            "isResearchMode": True,
            "scaffoldContext": {
                "requestId": f"req-{uuid.uuid4().hex[:8]}",
                "taskId": str(task_id),
                "stage": "build",
                "level": 2,
                "trigger": "hint_button",
            },
        },
    )

    async with test_db() as session:
        scaffold = (await session.execute(select(ScaffoldEvent))).scalar_one()
        message_id = scaffold.student_message_id

    with pytest.raises(IntegrityError):
        async with test_db() as session:
            message = await session.get(ChatMessage, message_id)
            await session.delete(message)
            await session.commit()

    async with test_db() as session:
        scaffold = (await session.execute(select(ScaffoldEvent))).scalar_one()
        assert scaffold.student_message_id is not None, "引用不得被置空"


@pytest.mark.asyncio
async def test_scaffold_fk_action_is_restrict_not_set_null(test_db):
    """约束层面的回归守护：改回 SET NULL 会让删除会话静默切断原文链路。"""
    from sqlalchemy import text as sql_text

    async with test_db() as session:
        rows = (
            await session.execute(
                sql_text(
                    "SELECT a.attname, c.confdeltype "
                    "FROM pg_constraint c "
                    "JOIN pg_class t ON t.oid = c.conrelid "
                    "JOIN pg_namespace n ON n.oid = t.relnamespace "
                    "JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = c.conkey[1] "
                    "WHERE c.contype = 'f' AND n.nspname = current_schema() "
                    "  AND t.relname = 'scaffold_events' "
                    "  AND a.attname IN ('student_message_id', 'assistant_message_id')"
                )
            )
        ).all()

    actions = {name: action for name, action in rows}
    assert actions, "未找到 scaffold_events 指向 chat_messages 的外键"
    for column, action in actions.items():
        # pg_constraint.confdeltype 的类型是 "char"，asyncpg 把它映射成 bytes
        # 而不是 str，因此这里统一解码后再比较。直接 == "r" 会得到
        # b'r' != 'r' 的假失败——外键其实是对的。
        normalized = action.decode() if isinstance(action, (bytes, bytearray)) else action
        assert normalized == "r", (
            f"{column} 的删除动作应为 RESTRICT('r')，实际 {action!r}"
        )


# ── F. 自审补充：并发建版、去重稳定性、批量删除竞争 ─────────────────────────
#
# 这一节覆盖第三轮自审新发现的三个问题。它们都只在并发或重复操作下暴露，
# 单次 happy path 测试看不出来。


@pytest.mark.asyncio
async def test_concurrent_events_on_same_artifact_do_not_collide(
    test_db, client, auth_headers
):
    """同一产物被两次并发确认时，必须产出两个版本，而不是撞唯一约束 500。

    ``record_artifact_version`` 对 StageArtifact 行加了 FOR UPDATE，但
    ``get_or_create_artifact`` 已经把该行放进 Session 的 identity map，
    SQLAlchemy 默认不会用新查询的列值覆盖已有对象的属性。少了
    ``populate_existing=True``，锁内读到的仍是加锁前的 current_version，
    两个请求会算出同一个版本号，撞 uq_artifact_version_seq。

    两次 content 必须不同，否则会走「内容无变化不建新版本」的去重分支，
    掩盖掉这个竞争。
    """
    task_id = await _create_task(test_db)

    responses = await asyncio.gather(
        *[
            client.post(
                f"/api/research/tasks/{task_id}/stage-events",
                headers=auth_headers,
                json=_event_body(
                    request_id=f"req-{uuid.uuid4().hex[:12]}",
                    artifacts=[_artifact(content={"responsibility": f"版本 {index}"})],
                ),
            )
            for index in range(2)
        ],
        return_exceptions=True,
    )

    for item in responses:
        assert not isinstance(item, Exception), item
        assert item.status_code == 200, item.text

    async with test_db() as session:
        versions = (
            await session.execute(
                select(ArtifactVersion.version)
                .join(StageArtifact, StageArtifact.id == ArtifactVersion.artifact_id)
                .where(StageArtifact.artifact_key == "fc-1")
                .order_by(ArtifactVersion.version)
            )
        ).scalars().all()

    assert versions == [1, 2], f"版本号应连续递增，实际 {versions}"


@pytest.mark.asyncio
async def test_repeated_identical_module_code_creates_one_version(
    test_db, client, auth_headers
):
    """同一段代码反复跑测试只应有一个代码版本。

    「修订次数」是研究指标。若产物 content 里混入每次必变的字段
    （尝试 ID、时间戳、尝试次数），去重永远不命中，学生把同一段代码
    多跑几次测试就会凭空抬高修订次数。前端 moduleCodeArtifact 因此
    只放 code/verified 等稳定字段；这里从后端侧验证去重确实生效。
    """
    task_id = await _create_task(test_db)
    content = {
        "cardId": "fc-1",
        "blueprintNodeId": "node-1",
        "code": "def move(): pass",
        "verified": True,
    }

    for _ in range(3):
        response = await client.post(
            f"/api/research/tasks/{task_id}/stage-events",
            headers=auth_headers,
            json=_event_body(
                request_id=f"req-{uuid.uuid4().hex[:12]}",
                stage="build",
                event_type="module_test",
                artifacts=[
                    _artifact(
                        artifact_type="module_code",
                        artifact_key="unit-1",
                        content=content,
                        change_source="structure_edit",
                    )
                ],
            ),
        )
        assert response.status_code == 200, response.text

    async with test_db() as session:
        version_count = await session.scalar(
            select(func.count(ArtifactVersion.id))
            .join(StageArtifact, StageArtifact.id == ArtifactVersion.artifact_id)
            .where(StageArtifact.artifact_key == "unit-1")
        )
        event_count = await session.scalar(
            select(func.count(StageEvent.id)).where(
                StageEvent.event_type == StageEventType.MODULE_TEST
            )
        )

    # 三次测试 = 三条事件，但代码没变 = 一个版本。
    assert version_count == 1, f"代码未变却产生了 {version_count} 个版本"
    assert event_count == 3, f"三次测试应留下三条事件，实际 {event_count}"


@pytest.mark.asyncio
async def test_stage_event_accepts_more_than_forty_artifacts(
    test_db, client, auth_headers
):
    """功能拆解确认会同时上报功能卡和契约采纳决定，产物数是卡数的两倍。

    上限卡在 40 时，20 张以上功能卡的学生整个阶段确认会被 Pydantic 拒成 422，
    而且前端会把它显示成「阶段与产物不匹配」——方向完全错误的排查提示。
    """
    task_id = await _create_task(test_db)

    artifacts = [
        _artifact(artifact_key=f"fc-{index}", content={"responsibility": f"职责 {index}"})
        for index in range(50)
    ]
    response = await client.post(
        f"/api/research/tasks/{task_id}/stage-events",
        headers=auth_headers,
        json=_event_body(artifacts=artifacts),
    )

    assert response.status_code == 200, response.text
    assert len(response.json()["data"]["artifacts"]) == 50


@pytest.mark.asyncio
async def test_batch_delete_racing_with_evidence_write_keeps_them_consistent(
    test_db, client, admin_client, auth_headers
):
    """批量删除提交记录与学生写证据并发时，不允许出现「证据在、冻结版本没了」。

    提交记录没有被证据表用外键引用，光靠「先查后删」挡不住并发：
    学生在检查与删除之间写入的证据不会被计入，删除照常执行，
    已冻结的教师蓝图版本随之丢失，该学生的下一条事件会按教师**当前**版本
    重建，同一学习过程跨越两个蓝图版本。

    修复方式是先对提交行加 FOR UPDATE——所有证据写入路径都会先经过
    freeze_blueprint_version -> upsert_submission 更新同一行，因此会被挡住。
    """
    task_id = await _create_task(test_db)

    # 先产生一条提交记录（尚无证据）。
    seed = await client.post(
        f"/api/research/tasks/{task_id}/save-workspace",
        headers=auth_headers,
        json={"workspace_data": {"functionCards": []}},
    )
    assert seed.status_code == 200, seed.text

    async with test_db() as session:
        submission_id = await session.scalar(
            select(ResearchTaskSubmission.id).where(
                ResearchTaskSubmission.task_id == task_id
            )
        )
    assert submission_id is not None

    delete_response, event_response = await asyncio.gather(
        admin_client.request(
            "DELETE",
            "/api/admin/research/submissions/batch",
            json=[str(submission_id)],
        ),
        client.post(
            f"/api/research/tasks/{task_id}/stage-events",
            headers=auth_headers,
            json=_event_body(),
        ),
        return_exceptions=True,
    )

    for item in (delete_response, event_response):
        assert not isinstance(item, Exception), item
        assert item.status_code != 500, item.text

    async with test_db() as session:
        evidence_count = await session.scalar(
            select(func.count(StageEvent.id)).where(StageEvent.task_id == task_id)
        )
        # 按 (task_id, user_id) 统计，而不是按被删的那个具体 id。
        #
        # 删除先成功是**合法**结果：那一刻确实还没有任何证据，删掉没问题。
        # 之后学生的事件会经 upsert_submission 重建一行新的提交记录（新 id）
        # 并冻结当前蓝图——对一个此前毫无证据的学生来说这是正确行为。
        # 早先按被删 id 断言，把这种合法情形误判成失败。
        surviving_submissions = await session.scalar(
            select(func.count(ResearchTaskSubmission.id)).where(
                ResearchTaskSubmission.task_id == task_id
            )
        )

    # 核心不变式：不允许出现「证据还在，却没有任何提交记录承载冻结的蓝图版本」。
    # 那种状态下这段学习过程的教师蓝图条件不可解释，准实验数据即作废。
    if evidence_count > 0:
        assert surviving_submissions >= 1, (
            f"该任务下存在 {evidence_count} 条研究证据，却没有任何提交记录，"
            "冻结的蓝图版本已丢失"
        )
