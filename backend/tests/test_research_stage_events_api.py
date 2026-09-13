"""阶段事件与产物版本的集成测试。

⚠️ 需要真实 PostgreSQL：模型使用 UUID / JSONB 等 PG 专属类型，且本文件大量验证
``INSERT ... ON CONFLICT`` 与 ``SELECT ... FOR UPDATE`` 的真实并发语义——
这些行为无法用假 session 有意义地验证，SQLite 也不支持。

运行方式：
    cd backend
    export TEST_DATABASE_URL=postgresql+asyncpg://用户:密码@localhost:5432/cognisync_test
    pytest tests/test_research_stage_events_api.py -v
"""
from __future__ import annotations

import asyncio
import uuid

import pytest
from sqlalchemy import func, select, text

from app.models.sql.research import (
    ProjectBlueprintStatus,
    ProjectBlueprintVersion,
    ResearchTask,
    ResearchTaskStatus,
    ResearchTaskSubmission,
)
from app.models.sql.research_event import (
    ArtifactVersion,
    StageArtifact,
    StageEvent,
    StageEventArtifact,
)


# ── 辅助 ──────────────────────────────────────────────────────────────────────

async def _create_active_task(session_factory, target_group: str = "all") -> uuid.UUID:
    async with session_factory() as session:
        task = ResearchTask(
            title="贪吃蛇项目工坊",
            code_content="# starter",
            language="python",
            target_group=target_group,
            status=ResearchTaskStatus.ACTIVE,
        )
        session.add(task)
        await session.commit()
        await session.refresh(task)
        return task.id


async def _publish_blueprint(session_factory, task_id: uuid.UUID, version: int) -> uuid.UUID:
    """发布一个蓝图版本并把它设为任务当前版本。"""
    async with session_factory() as session:
        blueprint = ProjectBlueprintVersion(
            task_id=task_id,
            version=version,
            schema_version=1,
            status=ProjectBlueprintStatus.PUBLISHED,
            config={"nodes": [], "version": version},
            content_hash=f"hash-{version}",
        )
        session.add(blueprint)
        await session.flush()
        task = await session.get(ResearchTask, task_id)
        task.current_blueprint_version_id = blueprint.id
        await session.commit()
        return blueprint.id


def _function_card(responsibility: str) -> dict:
    return {
        "responsibility": responsibility,
        "input": "当前方向",
        "output": "新的蛇身坐标",
        "boundaryReason": "移动是独立可验证的行为",
    }


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
                "content": _function_card("移动蛇身"),
                "change_source": "stage_confirm",
            }
        ],
    }
    body.update(overrides)
    return body


# ── 基本写入 ──────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_stage_event_creates_artifact_version(test_db, client, auth_headers):
    task_id = await _create_active_task(test_db)

    response = await client.post(
        f"/api/research/tasks/{task_id}/stage-events",
        headers=auth_headers,
        json=_event_body(),
    )

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["event_type"] == "stage_confirm"
    assert data["replayed"] is False
    assert len(data["artifacts"]) == 1
    assert data["artifacts"][0]["version"] == 1
    assert data["artifacts"][0]["version_created"] is True


@pytest.mark.asyncio
async def test_repeated_confirm_without_change_does_not_bump_version(
    test_db, client, auth_headers
):
    """学生反复点「确认」但内容没变时，不应污染修订次数这一研究指标。"""
    task_id = await _create_active_task(test_db)
    content = _function_card("移动蛇身")

    first = await client.post(
        f"/api/research/tasks/{task_id}/stage-events",
        headers=auth_headers,
        json=_event_body(artifacts=[{
            "artifact_type": "function_card",
            "artifact_key": "fc-1",
            "content": content,
            "change_source": "stage_confirm",
        }]),
    )
    # 不同 request_id：这是一个新的关键时刻，但产物内容相同。
    second = await client.post(
        f"/api/research/tasks/{task_id}/stage-events",
        headers=auth_headers,
        json=_event_body(artifacts=[{
            "artifact_type": "function_card",
            "artifact_key": "fc-1",
            "content": dict(reversed(list(content.items()))),  # 仅键顺序不同
            "change_source": "stage_confirm",
        }]),
    )

    assert first.json()["data"]["artifacts"][0]["version_created"] is True
    assert second.json()["data"]["artifacts"][0]["version_created"] is False
    assert second.json()["data"]["artifacts"][0]["version"] == 1

    async with test_db() as session:
        count = await session.scalar(select(func.count(ArtifactVersion.id)))
        assert count == 1


# ── P0-1：事件幂等 ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_same_request_id_replays_without_duplicating_event(
    test_db, client, auth_headers
):
    """网络重试重发同一请求时，不能把一个关键时刻记成两次。"""
    task_id = await _create_active_task(test_db)
    body = _event_body()

    first = await client.post(
        f"/api/research/tasks/{task_id}/stage-events", headers=auth_headers, json=body
    )
    second = await client.post(
        f"/api/research/tasks/{task_id}/stage-events", headers=auth_headers, json=body
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["data"]["replayed"] is False
    assert second.json()["data"]["replayed"] is True
    assert first.json()["data"]["event_id"] == second.json()["data"]["event_id"]

    async with test_db() as session:
        events = await session.scalar(select(func.count(StageEvent.id)))
        versions = await session.scalar(select(func.count(ArtifactVersion.id)))
        assert events == 1, "同一 request_id 不应产生两条事件"
        assert versions == 1, "重放不应追加版本"


@pytest.mark.asyncio
async def test_different_request_ids_create_two_events(test_db, client, auth_headers):
    """两次真实的关键时刻必须各自留痕。"""
    task_id = await _create_active_task(test_db)

    await client.post(
        f"/api/research/tasks/{task_id}/stage-events",
        headers=auth_headers,
        json=_event_body(),
    )
    await client.post(
        f"/api/research/tasks/{task_id}/stage-events",
        headers=auth_headers,
        json=_event_body(artifacts=[{
            "artifact_type": "function_card",
            "artifact_key": "fc-1",
            "content": _function_card("移动蛇身并检测边界"),
            "change_source": "structure_edit",
        }]),
    )

    async with test_db() as session:
        events = await session.scalar(select(func.count(StageEvent.id)))
        versions = await session.scalar(select(func.count(ArtifactVersion.id)))
        assert events == 2
        assert versions == 2


@pytest.mark.asyncio
async def test_concurrent_same_request_id_is_safe(test_db, client, auth_headers):
    """并发重放不得让任一请求 500，也不得写入两条事件。"""
    task_id = await _create_active_task(test_db)
    body = _event_body()

    results = await asyncio.gather(
        client.post(
            f"/api/research/tasks/{task_id}/stage-events", headers=auth_headers, json=body
        ),
        client.post(
            f"/api/research/tasks/{task_id}/stage-events", headers=auth_headers, json=body
        ),
        return_exceptions=True,
    )

    for item in results:
        assert not isinstance(item, Exception), f"并发请求抛出异常: {item!r}"
        assert item.status_code == 200, item.text

    async with test_db() as session:
        events = await session.scalar(select(func.count(StageEvent.id)))
        assert events == 1


# ── P0-2：产物身份与版本号的并发安全 ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_concurrent_distinct_events_on_same_artifact(test_db, client, auth_headers):
    """同一学生开两个标签页同时改同一张卡：不得 500，版本号不得重复。"""
    task_id = await _create_active_task(test_db)

    bodies = [
        _event_body(artifacts=[{
            "artifact_type": "function_card",
            "artifact_key": "fc-shared",
            "content": _function_card(f"职责-{i}"),
            "change_source": "structure_edit",
        }])
        for i in range(2)
    ]

    results = await asyncio.gather(
        *[
            client.post(
                f"/api/research/tasks/{task_id}/stage-events",
                headers=auth_headers,
                json=body,
            )
            for body in bodies
        ],
        return_exceptions=True,
    )

    for item in results:
        assert not isinstance(item, Exception), f"并发请求抛出异常: {item!r}"
        assert item.status_code == 200, item.text

    async with test_db() as session:
        artifacts = await session.scalar(select(func.count(StageArtifact.id)))
        assert artifacts == 1, "并发创建同一产物身份应收敛为一行"

        versions = (
            await session.execute(
                select(ArtifactVersion.version).order_by(ArtifactVersion.version)
            )
        ).scalars().all()
        assert versions == [1, 2], f"版本号应连续无重复，实际 {versions}"

        artifact = (await session.execute(select(StageArtifact))).scalar_one()
        assert artifact.current_version == 2, "当前版本指针不得丢失更新"


# ── P0-5：蓝图版本冻结 ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_first_event_freezes_blueprint_against_later_publish(
    test_db, client, auth_headers
):
    """首次关键事件后教师发布新版本，学生后续事件仍必须绑定旧版本。

    否则同一个学习过程会跨越两个教师蓝图版本，准实验数据无法解释。
    """
    task_id = await _create_active_task(test_db)
    v1 = await _publish_blueprint(test_db, task_id, version=1)

    first = await client.post(
        f"/api/research/tasks/{task_id}/stage-events",
        headers=auth_headers,
        json=_event_body(),
    )
    assert first.json()["data"]["blueprint_version_id"] == str(v1)

    # 教师随后发布 v2
    v2 = await _publish_blueprint(test_db, task_id, version=2)
    assert v2 != v1

    second = await client.post(
        f"/api/research/tasks/{task_id}/stage-events",
        headers=auth_headers,
        json=_event_body(artifacts=[]),
    )

    assert second.json()["data"]["blueprint_version_id"] == str(v1), (
        "学生已开始的任务不应漂移到新蓝图版本"
    )

    async with test_db() as session:
        frozen = await session.scalar(
            select(ResearchTaskSubmission.blueprint_version_id).where(
                ResearchTaskSubmission.task_id == task_id
            )
        )
        assert frozen == v1, "首次事件应真正冻结提交记录上的蓝图版本"


# ── P0-6：一个事件关联多个产物 ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_event_links_all_artifacts_not_only_first(test_db, client, auth_headers):
    """一次关键时刻常同时涉及多个产物，全部都要可追溯。

    这里用 ``build`` 阶段的一次结构修订：测试失败后学生回头同时改功能卡、
    实现路径和机制说明。这是 ``docs/archive/PROJECT_WORKBENCH_V02.md`` 第 30 行描述的
    主线，也是唯一真实会跨多类产物的场景——阶段确认本身只确认本阶段的产物。
    """
    task_id = await _create_active_task(test_db)

    response = await client.post(
        f"/api/research/tasks/{task_id}/stage-events",
        headers=auth_headers,
        json=_event_body(stage="build", event_type="structure_change", artifacts=[
            {
                "artifact_type": "function_card",
                "artifact_key": "fc-1",
                "content": _function_card("移动蛇身"),
                "change_source": "test_revision",
            },
            {
                "artifact_type": "path",
                "artifact_key": "path-main",
                "content": {"orderedCardIds": ["fc-1", "fc-2"]},
                "change_source": "test_revision",
            },
            {
                "artifact_type": "mechanism",
                "artifact_key": "fc-1",
                "content": {"flowNodes": [{"id": "n1", "label": "开始"}]},
                "change_source": "test_revision",
            },
        ]),
    )

    assert response.status_code == 200, response.text
    assert len(response.json()["data"]["artifacts"]) == 3

    async with test_db() as session:
        links = await session.scalar(select(func.count(StageEventArtifact.id)))
        assert links == 3, "事件必须关联全部产物，而不只是第一个"


@pytest.mark.asyncio
async def test_export_contains_every_artifact_of_one_event(
    test_db, client, auth_headers, admin_client
):
    """导出应能从同一事件追溯到全部产物。"""
    task_id = await _create_active_task(test_db)

    await client.post(
        f"/api/research/tasks/{task_id}/stage-events",
        headers=auth_headers,
        json=_event_body(stage="build", event_type="structure_change", artifacts=[
            {
                "artifact_type": "function_card",
                "artifact_key": "fc-1",
                "content": _function_card("移动蛇身"),
                "change_source": "test_revision",
            },
            {
                "artifact_type": "path",
                "artifact_key": "path-main",
                "content": {"orderedCardIds": ["fc-1"]},
                "change_source": "test_revision",
            },
        ]),
    )

    response = await admin_client.get("/api/admin/export/csv/stage-events")
    assert response.status_code == 200
    body = response.text

    assert "fc-1" in body
    assert "path-main" in body
    # 同一事件的多行共享 event_id，可据此重新聚合
    lines = [line for line in body.splitlines() if "fc-1" in line or "path-main" in line]
    assert len(lines) == 2


# ── P1-1：枚举以小写 value 落库与导出 ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_enums_persist_as_lowercase_values(test_db, client, auth_headers):
    """数据库中必须是 ``decompose`` / ``stage_confirm``，不是成员名。"""
    task_id = await _create_active_task(test_db)

    await client.post(
        f"/api/research/tasks/{task_id}/stage-events",
        headers=auth_headers,
        json=_event_body(),
    )

    async with test_db() as session:
        row = (
            await session.execute(
                text("SELECT stage, event_type FROM stage_events LIMIT 1")
            )
        ).first()
        assert row.stage == "decompose", f"实际入库 {row.stage!r}"
        assert row.event_type == "stage_confirm", f"实际入库 {row.event_type!r}"

        artifact_row = (
            await session.execute(
                text("SELECT stage, artifact_type FROM stage_artifacts LIMIT 1")
            )
        ).first()
        assert artifact_row.stage == "decompose"
        assert artifact_row.artifact_type == "function_card"


@pytest.mark.asyncio
async def test_stage_event_export_uses_lowercase(test_db, client, auth_headers, admin_client):
    task_id = await _create_active_task(test_db)
    await client.post(
        f"/api/research/tasks/{task_id}/stage-events",
        headers=auth_headers,
        json=_event_body(),
    )

    response = await admin_client.get("/api/admin/export/csv/stage-events")
    assert response.status_code == 200
    body = response.text

    assert "decompose" in body
    assert "stage_confirm" in body
    assert "DECOMPOSE" not in body
    assert "STAGE_CONFIRM" not in body


# ── P1-2 / P1-3：载荷限制与稳定键校验 ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_oversized_detail_returns_413(test_db, client, auth_headers):
    task_id = await _create_active_task(test_db)

    response = await client.post(
        f"/api/research/tasks/{task_id}/stage-events",
        headers=auth_headers,
        json=_event_body(detail={"blob": "x" * (32 * 1024)}, artifacts=[]),
    )

    assert response.status_code == 413


@pytest.mark.asyncio
async def test_many_artifacts_exceeding_total_returns_413(test_db, client, auth_headers):
    """逐产物合法但总量超限时也必须拒绝。"""
    task_id = await _create_active_task(test_db)

    artifacts = [
        {
            "artifact_type": "function_card",
            "artifact_key": f"fc-{i}",
            "content": {"blob": "x" * (32 * 1024)},
            "change_source": "structure_edit",
        }
        for i in range(20)
    ]

    response = await client.post(
        f"/api/research/tasks/{task_id}/stage-events",
        headers=auth_headers,
        json=_event_body(artifacts=artifacts),
    )

    assert response.status_code == 413

    async with test_db() as session:
        events = await session.scalar(select(func.count(StageEvent.id)))
        assert events == 0, "超限请求不得留下半截证据"


@pytest.mark.asyncio
async def test_blank_artifact_key_is_rejected(test_db, client, auth_headers):
    task_id = await _create_active_task(test_db)

    response = await client.post(
        f"/api/research/tasks/{task_id}/stage-events",
        headers=auth_headers,
        json=_event_body(artifacts=[{
            "artifact_type": "function_card",
            "artifact_key": "   ",
            "content": _function_card("移动蛇身"),
            "change_source": "stage_confirm",
        }]),
    )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_artifact_key_is_stripped(test_db, client, auth_headers):
    """带空格的键不得产生第二个产物身份。"""
    task_id = await _create_active_task(test_db)

    for key in ("fc-1", " fc-1 "):
        await client.post(
            f"/api/research/tasks/{task_id}/stage-events",
            headers=auth_headers,
            json=_event_body(artifacts=[{
                "artifact_type": "function_card",
                "artifact_key": key,
                "content": _function_card(f"职责-{key.strip()}"),
                "change_source": "structure_edit",
            }]),
        )

    async with test_db() as session:
        artifacts = await session.scalar(select(func.count(StageArtifact.id)))
        assert artifacts == 1


# ── P0-7：研究证据的删除保护 ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_deleting_task_with_evidence_is_rejected(
    test_db, client, auth_headers, admin_client
):
    task_id = await _create_active_task(test_db)
    await client.post(
        f"/api/research/tasks/{task_id}/stage-events",
        headers=auth_headers,
        json=_event_body(),
    )

    response = await admin_client.delete(f"/api/admin/research/tasks/{task_id}")

    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == "RESEARCH_EVIDENCE_EXISTS"

    async with test_db() as session:
        events = await session.scalar(select(func.count(StageEvent.id)))
        assert events == 1, "研究证据不得被删除"


@pytest.mark.asyncio
async def test_deleting_user_with_evidence_is_rejected(
    test_db, client, auth_headers, admin_client, registered_user
):
    task_id = await _create_active_task(test_db)
    await client.post(
        f"/api/research/tasks/{task_id}/stage-events",
        headers=auth_headers,
        json=_event_body(),
    )

    response = await admin_client.delete(f"/api/admin/users/{registered_user['user_id']}")

    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == "RESEARCH_EVIDENCE_EXISTS"

    async with test_db() as session:
        artifacts = await session.scalar(select(func.count(StageArtifact.id)))
        assert artifacts == 1


# ── 与 workspace_data 并存 ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_workspace_snapshot_and_event_chain_coexist(test_db, client, auth_headers):
    """快照负责恢复，事件链负责研究证据，两者互不替代。"""
    task_id = await _create_active_task(test_db)

    await client.post(
        f"/api/research/tasks/{task_id}/save-workspace",
        headers=auth_headers,
        json={"workspace_data": {"observations": [{"id": "o1"}]}},
    )
    await client.post(
        f"/api/research/tasks/{task_id}/stage-events",
        headers=auth_headers,
        json=_event_body(),
    )

    async with test_db() as session:
        submission = (
            await session.execute(
                select(ResearchTaskSubmission).where(
                    ResearchTaskSubmission.task_id == task_id
                )
            )
        ).scalar_one()
        assert submission.workspace_data == {"observations": [{"id": "o1"}]}

        versions = await session.scalar(select(func.count(ArtifactVersion.id)))
        assert versions == 1


@pytest.mark.asyncio
async def test_stage_event_rejects_foreign_task(test_db, client, auth_headers):
    """学生不能向自己不可见的任务写入事件。"""
    task_id = await _create_active_task(test_db, target_group="lecture")

    response = await client.post(
        f"/api/research/tasks/{task_id}/stage-events",
        headers=auth_headers,
        json=_event_body(),
    )

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_stage_event_requires_authentication(test_db, client):
    task_id = await _create_active_task(test_db)

    response = await client.post(
        f"/api/research/tasks/{task_id}/stage-events",
        json=_event_body(),
    )

    assert response.status_code == 401
