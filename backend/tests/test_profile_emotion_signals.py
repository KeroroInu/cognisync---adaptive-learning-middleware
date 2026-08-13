from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.services.profile_service import ProfileService


class ScalarRows:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class ExecuteResult:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return ScalarRows(self._rows)


class FakeSession:
    def __init__(self, results):
        self._results = list(results)
        self.execute_count = 0

    async def execute(self, _query):
        self.execute_count += 1
        return ExecuteResult(self._results.pop(0))


@pytest.mark.asyncio
async def test_recent_profile_changes_include_batched_emotion_signal():
    now = datetime.now(timezone.utc)
    current = SimpleNamespace(
        cognition=62,
        affect=55,
        behavior=70,
        created_at=now,
    )
    previous = SimpleNamespace(
        cognition=60,
        affect=58,
        behavior=68,
        created_at=now - timedelta(minutes=1),
    )
    emotion = SimpleNamespace(
        created_at=now - timedelta(seconds=10),
        emotion_code="E01",
        emotion_name="confused",
        intensity="medium",
        confidence=0.81,
        arousal=0.35,
        valence=-0.55,
    )
    session = FakeSession([[current, previous], [emotion]])

    changes = await ProfileService(session).get_recent_changes(uuid4(), limit=8)

    assert session.execute_count == 2, "画像快照和情感日志应各批量查询一次"
    assert {change.dimension for change in changes} == {"cognition", "affect", "behavior"}
    assert all(change.emotionDetail is not None for change in changes)
    assert {change.emotionDetail.code for change in changes if change.emotionDetail} == {"E01"}
    assert {change.emotionDetail.intensity for change in changes if change.emotionDetail} == {"medium"}


@pytest.mark.asyncio
async def test_recent_profile_changes_work_without_emotion_log():
    now = datetime.now(timezone.utc)
    snapshots = [
        SimpleNamespace(cognition=61, affect=60, behavior=70, created_at=now),
        SimpleNamespace(cognition=60, affect=60, behavior=70, created_at=now - timedelta(minutes=1)),
    ]
    session = FakeSession([snapshots, []])

    changes = await ProfileService(session).get_recent_changes(uuid4(), limit=8)

    assert len(changes) == 1
    assert changes[0].dimension == "cognition"
    assert changes[0].emotionDetail is None
