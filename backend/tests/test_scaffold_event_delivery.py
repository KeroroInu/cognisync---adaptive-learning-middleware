"""支架事件的送达语义测试。

锁定 P0-4 的修复：区分「学生发起求助」与「建议确实送达」。

- ``StageEvent(help_request)``：在请求进入时写入，AI 失败也成立；
- ``ScaffoldEvent``：只在助手回复成功保存后写入。

若两者合并在调用模型之前写入，一次超时就会留下「已应用 L3 支架」但学生什么都
没收到的假记录，使支架依赖分析失真。

⚠️ 需要真实 PostgreSQL（见 tests/conftest.py 的 TEST_DATABASE_URL）。
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import func, select

from app.models.sql.research import ResearchTask, ResearchTaskStatus
from app.models.sql.research_event import (
    ScaffoldDeliveryStatus,
    ScaffoldEvent,
    StageEvent,
    StageEventType,
)
from app.services import llm_config


async def _create_active_task(session_factory) -> uuid.UUID:
    async with session_factory() as session:
        task = ResearchTask(
            title="贪吃蛇项目工坊",
            code_content="# starter",
            language="python",
            target_group="all",
            status=ResearchTaskStatus.ACTIVE,
        )
        session.add(task)
        await session.commit()
        await session.refresh(task)
        return task.id


def _scaffold_payload(task_id: uuid.UUID, request_id: str) -> dict:
    return {
        "message": "我卡在移动模块了",
        "language": "zh",
        "isResearchMode": True,
        "scaffoldContext": {
            "requestId": request_id,
            "taskId": str(task_id),
            "stage": "build",
            "level": 2,
            "trigger": "hint_button",
            "currentModule": "move_snake",
        },
    }


class _FailingProvider:
    """模拟模型持续超时。"""

    async def complete(self, **_kwargs):
        raise TimeoutError("model timeout")

    async def health_check(self) -> bool:
        return False


@pytest.mark.asyncio
async def test_successful_scaffold_records_delivered_event(
    test_db, client, auth_headers
):
    task_id = await _create_active_task(test_db)
    request_id = f"req-{uuid.uuid4().hex[:12]}"

    response = await client.post(
        "/api/chat",
        headers=auth_headers,
        json=_scaffold_payload(task_id, request_id),
    )

    assert response.status_code == 200, response.text

    async with test_db() as session:
        scaffold = (
            await session.execute(
                select(ScaffoldEvent).where(ScaffoldEvent.request_id == request_id)
            )
        ).scalar_one()
        assert scaffold.delivery_status == ScaffoldDeliveryStatus.DELIVERED
        assert scaffold.student_message_id is not None
        assert scaffold.assistant_message_id is not None, "送达事件必须关联助手消息"
        assert scaffold.adopted is None, "任务 5 之前不得推测是否采用"

        help_events = await session.scalar(
            select(func.count(StageEvent.id)).where(
                StageEvent.event_type == StageEventType.HELP_REQUEST
            )
        )
        assert help_events == 1, "求助行为本身也应留痕"


@pytest.mark.asyncio
async def test_llm_failure_records_help_request_but_no_delivered_scaffold(
    test_db, client, auth_headers, monkeypatch
):
    """模型失败时：求助可追踪，但不得出现「已送达支架」的假记录。"""
    task_id = await _create_active_task(test_db)
    request_id = f"req-{uuid.uuid4().hex[:12]}"

    monkeypatch.setattr(llm_config, "get_chat_provider", lambda: _FailingProvider())
    monkeypatch.setattr(
        "app.api.endpoints.chat.get_chat_provider", lambda: _FailingProvider()
    )

    response = await client.post(
        "/api/chat",
        headers=auth_headers,
        json=_scaffold_payload(task_id, request_id),
    )

    assert response.status_code == 503, response.text

    async with test_db() as session:
        scaffold_count = await session.scalar(
            select(func.count(ScaffoldEvent.id)).where(
                ScaffoldEvent.request_id == request_id
            )
        )
        assert scaffold_count == 0, "模型失败不得留下已送达支架的记录"

        help_events = await session.scalar(
            select(func.count(StageEvent.id)).where(
                StageEvent.event_type == StageEventType.HELP_REQUEST,
                StageEvent.request_id == request_id,
            )
        )
        assert help_events == 1, "求助行为仍必须可追踪"


@pytest.mark.asyncio
async def test_confirmed_build_l3_returns_controlled_function_without_llm(
    test_db, client, auth_headers, monkeypatch
):
    """L3 完整函数不经模型自由改写，并照常记录已送达支架。"""
    task_id = await _create_active_task(test_db)
    request_id = f"req-{uuid.uuid4().hex[:12]}"
    payload = _scaffold_payload(task_id, request_id)
    payload["scaffoldContext"].update({
        "level": 3,
        "trigger": "l3_confirmed",
        "currentModule": "movement",
        "l3Confirmed": True,
    })

    monkeypatch.setattr(llm_config, "get_chat_provider", lambda: _FailingProvider())
    monkeypatch.setattr(
        "app.api.endpoints.chat.get_chat_provider", lambda: _FailingProvider()
    )

    response = await client.post("/api/chat", headers=auth_headers, json=payload)

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert "def move_snake(snake, direction):" in data["message"]
    assert data["scaffold"]["requestedLevel"] == 3
    assert data["scaffold"]["appliedLevel"] == 3

    async with test_db() as session:
        scaffold = (
            await session.execute(
                select(ScaffoldEvent).where(ScaffoldEvent.request_id == request_id)
            )
        ).scalar_one()
        assert scaffold.delivery_status == ScaffoldDeliveryStatus.DELIVERED
        assert scaffold.requested_level == 3
        assert scaffold.applied_level == 3


@pytest.mark.asyncio
async def test_scaffold_event_is_idempotent_per_request(test_db, client, auth_headers):
    """客户端重试同一 requestId 不得把一次求助计成两次。"""
    task_id = await _create_active_task(test_db)
    request_id = f"req-{uuid.uuid4().hex[:12]}"
    payload = _scaffold_payload(task_id, request_id)

    first = await client.post("/api/chat", headers=auth_headers, json=payload)
    second = await client.post("/api/chat", headers=auth_headers, json=payload)

    assert first.status_code == 200
    assert second.status_code == 200, "重放不得因唯一约束而 500"

    async with test_db() as session:
        scaffold_count = await session.scalar(
            select(func.count(ScaffoldEvent.id)).where(
                ScaffoldEvent.request_id == request_id
            )
        )
        assert scaffold_count == 1

        help_events = await session.scalar(
            select(func.count(StageEvent.id)).where(
                StageEvent.request_id == request_id
            )
        )
        assert help_events == 1


@pytest.mark.asyncio
async def test_legacy_jsonb_is_still_written(test_db, client, auth_headers):
    """双写：既有教师端页面与导出仍读 chat_messages.analysis.scaffoldContext。"""
    from app.models.sql.message import ChatMessage, MessageRole

    task_id = await _create_active_task(test_db)
    request_id = f"req-{uuid.uuid4().hex[:12]}"

    await client.post(
        "/api/chat",
        headers=auth_headers,
        json=_scaffold_payload(task_id, request_id),
    )

    async with test_db() as session:
        assistant = (
            await session.execute(
                select(ChatMessage)
                .where(ChatMessage.role == MessageRole.ASSISTANT)
                .order_by(ChatMessage.timestamp.desc())
                .limit(1)
            )
        ).scalar_one()
        assert assistant.analysis is not None
        assert "scaffoldContext" in assistant.analysis
        assert assistant.analysis["scaffoldContext"]["requestId"] == request_id
