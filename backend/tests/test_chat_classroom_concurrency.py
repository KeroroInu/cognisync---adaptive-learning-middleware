"""单班聊天并发基线。

这不是模型供应商的容量证明：测试使用可控假模型，专门验证
40 名独立学生同时进入分析等待点时，聊天请求没有继续占用
PostgreSQL 事务连接，且最终都能完成消息与画像写入。
"""

import asyncio
import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select

from app.api.endpoints.auth import create_access_token
from app.models.sql.classroom import ClassroomSession
from app.models.sql.message import ChatMessage
from app.models.sql.profile import ProfileSnapshot, ProfileSource
from app.models.sql.research import ResearchTask, ResearchTaskStatus
from app.models.sql.research_event import ScaffoldEvent
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


@pytest.mark.asyncio
async def test_pdt_creative_chat_releases_connections_before_provider_wait(
    client, test_db, monkeypatch,
):
    """PDT 的自由提问经过画像 refresh 后，也必须在模型排队前归还连接。

    采用真实鉴权、课堂状态、任务、画像和消息写入；只替换模型/图谱。
    40 名学生全部进入创意函数模型等待点后，池占用应为零。
    若只修普通聊天分支，PDT 留下的事务会耗尽测试连接池，本测试不能抵达屏障。
    """
    student_count = 40
    user_ids = [uuid.uuid4() for _ in range(student_count)]
    teacher_id, session_id, task_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    class_name = "PDT连接释放验收班"
    async with test_db() as db:
        db.add(User(id=teacher_id, student_id="pdt_load_teacher", name="验收教师", role="admin"))
        for index, user_id in enumerate(user_ids):
            db.add(User(
                id=user_id, student_id=f"pdt_load_{index:02d}", name=f"解构学生 {index + 1}",
                role="learner", class_name=class_name, experiment_group="pdt",
                onboarding_mode="classroom", has_completed_onboarding=True,
            ))
        # Explicitly flush parent rows before inserting FK-backed test records.
        await db.flush()
        db.add(ClassroomSession(id=session_id, class_name=class_name, title="创意函数课", created_by=teacher_id))
        db.add(ResearchTask(
            id=task_id, title="贪吃蛇创意函数", code_content="# starter", language="python",
            target_group="pdt", status=ResearchTaskStatus.ACTIVE,
        ))
        for user_id in user_ids:
            db.add(ProfileSnapshot(user_id=user_id, cognition=50, affect=50, behavior=50, source=ProfileSource.SYSTEM))
        await db.commit()

    class LocalAnalyzer:
        def analyze_with_rules(self, *args, **kwargs):
            return ChatAnalysis(
                intent="help-seeking", emotion="neutral", detectedConcepts=[],
                delta=ProfileDelta(cognition=0, affect=0, behavior=0), emotionDetail=None,
            )

    class NoopGraphService:
        async def get_graph(self, user_id):
            return SimpleNamespace(nodes=[])

        async def calculate_cognition_from_graph(self, user_id):
            return 50

    all_arrived, release_model = asyncio.Event(), asyncio.Event()
    arrivals = 0

    class BarrierChatProvider:
        async def complete(self, **kwargs):
            nonlocal arrivals
            # Same pre-dispatch authorization as the real provider, against the
            # test pool: catches the new second-connection acquisition hazard.
            from app.services.classroom_service import ensure_queued_llm_access
            await ensure_queued_llm_access()
            arrivals += 1
            if arrivals == student_count:
                all_arrived.set()
            await release_model.wait()
            return "def creative_feature(event, state):\n    # 保留当前游戏状态\n    return state"

    monkeypatch.setattr("app.core.config.settings.LLM_PROJECT_TEXT_ANALYSIS", "rules")
    monkeypatch.setattr("app.services.classroom_service.async_session_factory", test_db)
    monkeypatch.setattr("app.api.endpoints.chat.TextAnalyzer", LocalAnalyzer)
    monkeypatch.setattr("app.api.endpoints.chat.GraphService", NoopGraphService)
    monkeypatch.setattr("app.services.graph_service.GraphService", NoopGraphService)
    monkeypatch.setattr("app.api.endpoints.chat.get_chat_provider", BarrierChatProvider)

    async def send_message(user_id):
        return await client.post("/api/chat", headers={
            "Authorization": f"Bearer {create_access_token(str(user_id))}",
        }, json={
            "message": "请结合列表和条件判断，完善我当前的创意函数。",
            "language": "zh", "isResearchMode": True,
            "currentCode": "def creative_feature(event, state):\n    pass",
            "scaffoldContext": {
                "requestId": f"pdt-load-{user_id}", "taskId": str(task_id),
                "stage": "build", "level": 3, "l3Confirmed": True,
                # Must be student-authored: hint_button bypasses profile refresh
                # and would miss the exact transaction regression under test.
                "trigger": "student_message", "currentModule": f"creative::{user_id}",
            },
        })

    requests = [asyncio.create_task(send_message(user_id)) for user_id in user_ids]
    responses = []
    try:
        await asyncio.wait_for(all_arrived.wait(), timeout=15)
        assert arrivals == student_count
        assert test_db.kw["bind"].pool.checkedout() == 0, "PDT 模型等待期间仍持有 PostgreSQL 连接"
    finally:
        release_model.set()
        try:
            responses = await asyncio.wait_for(asyncio.gather(*requests, return_exceptions=True), timeout=15)
        finally:
            for request in requests:
                if not request.done():
                    request.cancel()
            await asyncio.gather(*requests, return_exceptions=True)

    errors = [(getattr(response, "status_code", "exception"), getattr(response, "text", repr(response)))
              for response in responses if isinstance(response, BaseException) or response.status_code != 200]
    assert not errors, errors
    assert all(response.json()["success"] is True for response in responses)
    async with test_db() as db:
        assert await db.scalar(select(func.count(ChatMessage.id)).where(ChatMessage.user_id.in_(user_ids))) == student_count * 2
        assert await db.scalar(select(func.count(ScaffoldEvent.id)).where(ScaffoldEvent.user_id.in_(user_ids))) == student_count
        assert await db.scalar(select(func.count(ProfileSnapshot.id)).where(ProfileSnapshot.user_id.in_(user_ids))) == student_count * 2
