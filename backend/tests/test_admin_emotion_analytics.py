from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.endpoints.admin.analytics import router
from app.core.security import verify_admin_key
from app.db.postgres import get_db


class FakeScalarRows:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class FakeResult:
    def __init__(self, *, rows=None, scalar_one=None, scalars_rows=None):
        self._rows = rows or []
        self._scalar_one = scalar_one
        self._scalars_rows = scalars_rows or []

    def all(self):
        return self._rows

    def scalar_one_or_none(self):
        return self._scalar_one

    def scalars(self):
        return FakeScalarRows(self._scalars_rows)


class FakeSession:
    def __init__(self, *, scalar_values=None, execute_results=None):
        self.scalar_values = list(scalar_values or [])
        self.execute_results = list(execute_results or [])

    async def scalar(self, _query):
        return self.scalar_values.pop(0)

    async def execute(self, _query):
        return self.execute_results.pop(0)


def build_test_client(session: FakeSession) -> TestClient:
    app = FastAPI()
    app.include_router(router, prefix="/api/admin")

    async def override_db():
        yield session

    async def override_admin():
        return True

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[verify_admin_key] = override_admin
    return TestClient(app)


def test_emotion_distribution_endpoint():
    session = FakeSession(
        scalar_values=[4],
        execute_results=[
            FakeResult(
                rows=[
                    SimpleNamespace(
                        legacy_emotion="confused",
                        emotion_code="E01",
                        emotion_name="confused",
                        intensity="high",
                        count=2,
                        avg_confidence=0.755,
                    ),
                    SimpleNamespace(
                        legacy_emotion="motivated",
                        emotion_code="E08",
                        emotion_name="motivated",
                        intensity="high",
                        count=1,
                        avg_confidence=0.74,
                    ),
                ]
            )
        ],
    )
    client = build_test_client(session)

    response = client.get("/api/admin/analytics/emotion?days=7&limit=10")
    assert response.status_code == 200

    payload = response.json()["data"]
    assert payload["totalLogs"] == 4
    assert len(payload["items"]) == 2
    assert payload["items"][0]["emotionCode"] == "E01"
    assert payload["items"][0]["count"] == 2
    assert payload["items"][0]["percentage"] == 50.0


def test_emotion_trends_endpoint():
    now = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    session = FakeSession(
        execute_results=[
            FakeResult(
                rows=[
                    SimpleNamespace(
                        day=now - timedelta(days=1),
                        total_count=2,
                        avg_confidence=0.77,
                        avg_valence=0.12,
                        avg_arousal=0.41,
                    ),
                    SimpleNamespace(
                        day=now,
                        total_count=2,
                        avg_confidence=0.74,
                        avg_valence=0.08,
                        avg_arousal=0.35,
                    ),
                ]
            ),
            FakeResult(
                rows=[
                    SimpleNamespace(day=now - timedelta(days=1), emotion_code="E01", count=1),
                    SimpleNamespace(day=now - timedelta(days=1), emotion_code="E08", count=1),
                    SimpleNamespace(day=now, emotion_code="E01", count=1),
                    SimpleNamespace(day=now, emotion_code="E06", count=1),
                ]
            ),
        ]
    )
    client = build_test_client(session)

    response = client.get("/api/admin/analytics/emotion/trends?days=3")
    assert response.status_code == 200

    payload = response.json()["data"]
    assert payload["days"] == 3
    assert len(payload["points"]) == 3
    assert sum(point["totalCount"] for point in payload["points"]) == 4
    assert any(point["emotionCounts"].get("E01", 0) == 1 for point in payload["points"])


def test_user_emotion_detail_endpoint():
    user_id = uuid4()
    latest_created_at = datetime.now(timezone.utc)
    session = FakeSession(
        scalar_values=[3],
        execute_results=[
            FakeResult(
                scalar_one=SimpleNamespace(
                    id=user_id,
                    student_id="analytics_u1",
                    name="分析用户一",
                )
            ),
            FakeResult(
                scalars_rows=[
                    SimpleNamespace(
                        id=uuid4(),
                        created_at=latest_created_at,
                        session_id=uuid4(),
                        message_id=uuid4(),
                        intent="reflection",
                        legacy_emotion="confident",
                        emotion_code="E06",
                        emotion_name="confident",
                        intensity="medium",
                        confidence=0.79,
                        arousal=0.4,
                        valence=0.72,
                        detected_concepts=[],
                        evidence=["开始理解了"],
                        delta_cognition=3,
                        delta_affect=4,
                        delta_behavior=1,
                        profile_cognition=50,
                        profile_affect=58,
                        profile_behavior=63,
                    ),
                    SimpleNamespace(
                        id=uuid4(),
                        created_at=latest_created_at - timedelta(hours=1),
                        session_id=uuid4(),
                        message_id=uuid4(),
                        intent="goal-setting",
                        legacy_emotion="motivated",
                        emotion_code="E08",
                        emotion_name="motivated",
                        intensity="high",
                        confidence=0.74,
                        arousal=0.7,
                        valence=0.8,
                        detected_concepts=["梯度下降"],
                        evidence=["计划这周掌握"],
                        delta_cognition=2,
                        delta_affect=6,
                        delta_behavior=8,
                        profile_cognition=47,
                        profile_affect=54,
                        profile_behavior=62,
                    ),
                ]
            ),
        ],
    )
    client = build_test_client(session)

    response = client.get(f"/api/admin/analytics/emotion/users/{user_id}?limit=10")
    assert response.status_code == 200

    payload = response.json()["data"]
    assert payload["summary"]["userId"] == str(user_id)
    assert payload["summary"]["studentId"] == "analytics_u1"
    assert payload["summary"]["totalLogs"] == 3
    assert payload["summary"]["latestEmotionCode"] == "E06"
    assert len(payload["logs"]) == 2
    assert payload["logs"][0]["emotionCode"] == "E06"
