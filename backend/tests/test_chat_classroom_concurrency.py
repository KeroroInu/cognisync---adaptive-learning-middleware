"""单班聊天并发基线。

这不是模型供应商的容量证明：测试使用可控假模型，专门验证
40 名独立学生同时进入分析等待点时，聊天请求没有继续占用
PostgreSQL 事务连接，且最终都能完成消息与画像写入。
"""

import asyncio
import uuid
from types import SimpleNamespace

import pytest

from app.api.endpoints.auth import create_access_token
from app.models.sql.profile import ProfileSnapshot, ProfileSource
from app.models.sql.user import User
from app.schemas.chat import ChatAnalysis
from app.schemas.profile import ProfileDelta


@pytest.mark.asyncio
async def test_single_class_chat_releases_db_connections_while_analysis_waits(
    client,
    test_db,
    monkeypatch,
):
    student_count = 40
    user_ids = [uuid.uuid4() for _ in range(student_count)]

    async with test_db() as db:
        for index, user_id in enumerate(user_ids):
            db.add(
                User(
                    id=user_id,
                    student_id=f"load_student_{index:02d}",
                    name=f"并发学生 {index + 1}",
                    role="learner",
                    has_completed_onboarding=True,
                    onboarding_mode="ai",
                    experiment_group="ai_pbl",
                )
            )
            db.add(
                ProfileSnapshot(
                    user_id=user_id,
                    cognition=50,
                    affect=50,
                    behavior=50,
                    source=ProfileSource.SYSTEM,
                )
            )
        await db.commit()

    all_arrived = asyncio.Event()
    release_analysis = asyncio.Event()
    arrivals = 0
    arrivals_lock = asyncio.Lock()

    class BarrierAnalyzer:
        async def analyze(self, **kwargs):
            nonlocal arrivals
            async with arrivals_lock:
                arrivals += 1
                if arrivals == student_count:
                    all_arrived.set()
            await release_analysis.wait()
            return ChatAnalysis(
                intent="help-seeking",
                emotion="neutral",
                detectedConcepts=[],
                delta=ProfileDelta(cognition=0, affect=0, behavior=0),
                emotionDetail=None,
            )

    class NoopGraphService:
        async def get_graph(self, user_id):
            return SimpleNamespace(nodes=[])

        async def calculate_cognition_from_graph(self, user_id):
            return 50

    class ChatProvider:
        async def complete(self, **kwargs):
            return "先根据你当前的运行结果定位一个最小问题。"

    monkeypatch.setattr(
        "app.api.endpoints.chat.TextAnalyzer",
        lambda: BarrierAnalyzer(),
    )
    monkeypatch.setattr(
        "app.api.endpoints.chat.GraphService",
        NoopGraphService,
    )
    monkeypatch.setattr(
        "app.services.graph_service.GraphService",
        NoopGraphService,
    )
    monkeypatch.setattr(
        "app.api.endpoints.chat.get_chat_provider",
        lambda: ChatProvider(),
    )

    async def send_message(user_id):
        return await client.post(
            "/api/chat",
            headers={"Authorization": f"Bearer {create_access_token(str(user_id))}"},
            json={
                "message": "我的代码没有按预期运行，请帮我定位。",
                "language": "zh",
                "isResearchMode": False,
            },
        )

    requests = [asyncio.create_task(send_message(user_id)) for user_id in user_ids]
    try:
        await asyncio.wait_for(all_arrived.wait(), timeout=10)

        # 所有请求都阻塞在假模型中；此时不应有任何请求因为
        # 历史 SELECT 而持续占用事务连接。
        engine = test_db.kw["bind"]
        assert engine.pool.checkedout() == 0
    finally:
        release_analysis.set()

    responses = await asyncio.gather(*requests)
    assert all(response.status_code == 200 for response in responses), [
        (response.status_code, response.text) for response in responses
        if response.status_code != 200
    ]
    assert all(response.json()["success"] is True for response in responses)
