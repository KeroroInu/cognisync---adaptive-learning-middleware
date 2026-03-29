from types import SimpleNamespace
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.endpoints.auth import get_current_user
from app.api.endpoints.chat import router
from app.db.postgres import get_db
from app.schemas.chat import ChatAnalysis, EmotionDetail
from app.schemas.profile import ProfileDelta, UserProfile


class FakeDbSession:
    def __init__(self):
        self.added = []
        self.commit_calls = 0
        self.rollback_calls = 0
        self.refresh_calls = 0

    def add(self, obj):
        if getattr(obj, "id", None) is None:
            obj.id = uuid4()
        self.added.append(obj)

    async def commit(self):
        self.commit_calls += 1

    async def refresh(self, obj):
        self.refresh_calls += 1
        if getattr(obj, "id", None) is None:
            obj.id = uuid4()

    async def rollback(self):
        self.rollback_calls += 1


def build_chat_client(db_session: FakeDbSession) -> TestClient:
    app = FastAPI()
    app.include_router(router, prefix="/api/chat")

    async def override_db():
        yield db_session

    async def override_user():
        return SimpleNamespace(
            id=uuid4(),
            email="student@example.com",
            name="测试学生",
        )

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = override_user
    return TestClient(app)


def test_chat_endpoint_writes_emotion_log(monkeypatch):
    db_session = FakeDbSession()
    client = build_chat_client(db_session)
    session_id = uuid4()
    user_id = uuid4()
    captured: dict[str, object] = {}

    async def override_user():
        return SimpleNamespace(
            id=user_id,
            email="student@example.com",
            name="测试学生",
        )

    client.app.dependency_overrides[get_current_user] = override_user

    analysis = ChatAnalysis(
        intent="help-seeking",
        emotion="confused",
        detectedConcepts=["反向传播"],
        delta=ProfileDelta(cognition=-4, affect=-5, behavior=3),
        emotionDetail=EmotionDetail(
            code="E01",
            name="confused",
            intensity="high",
            legacyEmotion="confused",
            confidence=0.82,
            arousal=0.35,
            valence=-0.55,
            evidence=["还是不理解"],
        ),
    )
    current_profile = UserProfile(cognition=45, affect=48, behavior=54, lastUpdate=None)
    updated_profile = UserProfile(cognition=41, affect=43, behavior=57, lastUpdate=None)

    class FakeAnalyzer:
        async def analyze(self, user_message, recent_messages=None, current_profile=None):
            captured["analyze_args"] = {
                "user_message": user_message,
                "recent_messages": recent_messages,
                "current_profile": current_profile,
            }
            return analysis

    class FakeProfileService:
        def __init__(self, db):
            captured["profile_service_db"] = db

        async def get_profile(self, requested_user_id):
            captured["get_profile_user_id"] = requested_user_id
            return current_profile

        async def apply_delta(self, user_id, delta_cognition, delta_affect, delta_behavior):
            captured["apply_delta"] = {
                "user_id": user_id,
                "delta_cognition": delta_cognition,
                "delta_affect": delta_affect,
                "delta_behavior": delta_behavior,
            }
            return updated_profile

    class FakeGraphService:
        async def upsert_concepts(self, user_id, concepts):
            captured["graph_upsert"] = {"user_id": user_id, "concepts": concepts}

        async def get_graph(self, user_id):
            return SimpleNamespace(nodes=[])

    class FakeChatProvider:
        async def complete(self, **kwargs):
            captured["chat_provider"] = kwargs
            return "我们先一起拆解反向传播的步骤。"

    class FakePersonalizationService:
        def build_personalized_prompt(self, **kwargs):
            captured["personalized_prompt"] = kwargs
            return "system prompt"

        async def update_graph_from_conversation(self, **kwargs):
            captured["update_graph"] = kwargs
            return [{"name": "反向传播", "category": "机器学习", "importance": 0.8}]

    async def fake_get_or_create_active_session(db, requested_user_id):
        captured["session_request"] = {"db": db, "user_id": requested_user_id}
        return SimpleNamespace(id=session_id)

    async def fake_get_recent_messages(db, requested_user_id, limit=5):
        captured["recent_messages_request"] = {"db": db, "user_id": requested_user_id, "limit": limit}
        return [{"role": "assistant", "text": "先回顾链式法则"}]

    async def fake_get_cross_session_context(db, requested_user_id):
        captured["cross_session_request"] = {"db": db, "user_id": requested_user_id}
        return "上次讨论了梯度下降"

    async def fake_record_emotion_log(**kwargs):
        captured["emotion_log"] = kwargs
        return SimpleNamespace(id=uuid4(), emotion_code="E01")

    monkeypatch.setattr("app.api.endpoints.chat.TextAnalyzer", lambda: FakeAnalyzer())
    monkeypatch.setattr("app.api.endpoints.chat.ProfileService", FakeProfileService)
    monkeypatch.setattr("app.api.endpoints.chat.GraphService", FakeGraphService)
    monkeypatch.setattr("app.api.endpoints.chat.get_chat_provider", lambda: FakeChatProvider())
    monkeypatch.setattr(
        "app.api.endpoints.chat.get_or_create_active_session",
        fake_get_or_create_active_session,
    )
    monkeypatch.setattr("app.api.endpoints.chat.get_recent_messages", fake_get_recent_messages)
    monkeypatch.setattr("app.api.endpoints.chat.get_cross_session_context", fake_get_cross_session_context)
    monkeypatch.setattr("app.api.endpoints.chat.record_emotion_log", fake_record_emotion_log)
    monkeypatch.setattr(
        "app.services.personalization_service.PersonalizationService",
        FakePersonalizationService,
    )

    response = client.post(
        "/api/chat",
        json={
            "message": "我还是不理解反向传播",
            "language": "zh",
            "isResearchMode": False,
        },
    )

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["analysis"]["emotionDetail"]["code"] == "E01"
    assert payload["analysis"]["emotion"] == "confused"
    assert payload["updatedProfile"]["cognition"] == 41
    assert captured["emotion_log"]["user_id"] == user_id
    assert captured["emotion_log"]["session_id"] == session_id
    assert captured["emotion_log"]["message_id"] == db_session.added[0].id
    assert captured["emotion_log"]["analysis"].emotionDetail.code == "E01"
    assert captured["emotion_log"]["current_profile"].cognition == 45
    assert db_session.commit_calls >= 3
    assert len(db_session.added) == 2


def test_chat_endpoint_rejects_mismatched_request_user_id():
    db_session = FakeDbSession()
    client = build_chat_client(db_session)

    response = client.post(
        "/api/chat",
        json={
            "userId": str(uuid4()),
            "message": "测试不一致用户",
            "language": "zh",
            "isResearchMode": False,
        },
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Authenticated user does not match request.userId"
