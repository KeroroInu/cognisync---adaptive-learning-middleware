import json
from types import SimpleNamespace
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.endpoints.admin.emotion_experiments import router
from app.core.security import verify_admin_key
from app.db.postgres import get_db
from app.schemas.admin.emotion_experiments import (
    EmotionExperimentAnalyzeResponse,
    EmotionExperimentRow,
    EmotionExperimentRunItem,
    EmotionExperimentSummary,
)


class FakeSession:
    def __init__(self):
        self.commit_calls = 0
        self.rollback_calls = 0

    async def commit(self):
        self.commit_calls += 1

    async def rollback(self):
        self.rollback_calls += 1


def build_client(session: FakeSession) -> TestClient:
    app = FastAPI()
    app.include_router(router, prefix="/api/admin")

    async def override_db():
        yield session

    async def override_admin():
        return True

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[verify_admin_key] = override_admin
    return TestClient(app)


def sample_response() -> EmotionExperimentAnalyzeResponse:
    return EmotionExperimentAnalyzeResponse(
        experimentId=None,
        fileName="dataset_emotion_analysis.csv",
        detectedColumns=["dialogue_id", "text", "label"],
        labelMapping={"困惑": ["confused", "e01"]},
        previewRows=[
            EmotionExperimentRow(
                rowIndex=1,
                profileKey="u1",
                conversationId="c1",
                speaker="student",
                text="我还是不理解反向传播",
                expectedLabel="困惑",
                expectedLabels=["困惑"],
                expectedMatches=True,
                intent="help-seeking",
                emotion="confused",
                emotionCode="E01",
                emotionName="confused",
                intensity="high",
                confidence=0.83,
                arousal=0.35,
                valence=-0.55,
                deltaCognition=-4,
                deltaAffect=-6,
                deltaBehavior=3,
                profileCognitionBefore=50,
                profileAffectBefore=50,
                profileBehaviorBefore=50,
                profileCognitionAfter=46,
                profileAffectAfter=44,
                profileBehaviorAfter=53,
            )
        ],
        summary=EmotionExperimentSummary(
            rowsProcessed=1,
            rowsSkipped=0,
            analyzedRows=1,
            comparedRows=1,
            matchedRows=1,
            uniqueProfiles=1,
            uniqueConversations=1,
        ),
        csvContent="rowIndex,text\n1,我还是不理解反向传播\n",
    )


def test_analyze_emotion_dataset_csv_contract(monkeypatch):
    session = FakeSession()
    client = build_client(session)
    captured: dict[str, object] = {}

    async def fake_analyze_dataset_csv(**kwargs):
        captured["analyze_kwargs"] = kwargs
        return sample_response()

    async def fake_save_emotion_experiment_run(**kwargs):
        captured["save_kwargs"] = kwargs
        return SimpleNamespace(id=uuid4())

    monkeypatch.setattr(
        "app.api.endpoints.admin.emotion_experiments.analyze_dataset_csv",
        fake_analyze_dataset_csv,
    )
    monkeypatch.setattr(
        "app.api.endpoints.admin.emotion_experiments.save_emotion_experiment_run",
        fake_save_emotion_experiment_run,
    )

    response = client.post(
        "/api/admin/research/emotion-experiments/analyze-csv",
        data={
            "text_column": "text",
            "conversation_id_column": "dialogue_id",
            "expected_label_column": "label",
            "label_mapping_json": json.dumps({"困惑": ["confused", "E01"]}, ensure_ascii=False),
            "preview_limit": "15",
        },
        files={"file": ("dataset.csv", "dialogue_id,text,label\nc1,hello,困惑\n", "text/csv")},
    )

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["fileName"] == "dataset_emotion_analysis.csv"
    assert payload["experimentId"] is not None
    assert payload["labelMapping"] == {"困惑": ["confused", "e01"]}
    assert captured["analyze_kwargs"]["text_column"] == "text"
    assert captured["analyze_kwargs"]["label_mapping"] == {"困惑": ["confused", "E01"]}
    assert captured["save_kwargs"]["original_filename"] == "dataset.csv"
    assert session.commit_calls == 1


def test_analyze_emotion_dataset_csv_accepts_multilabel_columns(monkeypatch):
    session = FakeSession()
    client = build_client(session)
    captured: dict[str, object] = {}

    async def fake_analyze_dataset_csv(**kwargs):
        captured["analyze_kwargs"] = kwargs
        return sample_response()

    async def fake_save_emotion_experiment_run(**kwargs):
        return SimpleNamespace(id=uuid4())

    monkeypatch.setattr(
        "app.api.endpoints.admin.emotion_experiments.analyze_dataset_csv",
        fake_analyze_dataset_csv,
    )
    monkeypatch.setattr(
        "app.api.endpoints.admin.emotion_experiments.save_emotion_experiment_run",
        fake_save_emotion_experiment_run,
    )

    response = client.post(
        "/api/admin/research/emotion-experiments/analyze-csv",
        data={
            "text_column": "text",
            "expected_label_columns_json": json.dumps(["joy", "sadness"]),
            "positive_label_value": "1,true",
        },
        files={"file": ("dataset.csv", "text,joy,sadness\nhello,1,0\n", "text/csv")},
    )

    assert response.status_code == 200
    assert captured["analyze_kwargs"]["expected_label_columns"] == ["joy", "sadness"]
    assert captured["analyze_kwargs"]["positive_label_value"] == "1,true"


def test_analyze_emotion_dataset_csv_rejects_invalid_label_mapping(monkeypatch):
    session = FakeSession()
    client = build_client(session)

    async def fake_analyze_dataset_csv(**kwargs):
        raise AssertionError("should not reach analyze_dataset_csv")

    monkeypatch.setattr(
        "app.api.endpoints.admin.emotion_experiments.analyze_dataset_csv",
        fake_analyze_dataset_csv,
    )

    response = client.post(
        "/api/admin/research/emotion-experiments/analyze-csv",
        data={
            "text_column": "text",
            "label_mapping_json": '["not-an-object"]',
        },
        files={"file": ("dataset.csv", "text\nhello\n", "text/csv")},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "label_mapping_json must be a JSON object"
    assert session.rollback_calls == 1


def test_emotion_experiment_history_and_detail_contract(monkeypatch):
    session = FakeSession()
    client = build_client(session)
    run_id = str(uuid4())

    async def fake_list_runs(db, limit, offset):
        assert db is session
        assert limit == 10
        assert offset == 5
        return (
            [
                EmotionExperimentRunItem(
                    id=run_id,
                    originalFilename="dataset.csv",
                    outputFilename="dataset_emotion_analysis.csv",
                    textColumn="text",
                    conversationIdColumn="dialogue_id",
                    speakerColumn="speaker",
                    expectedLabelColumn="label",
                    profileKeyColumn="user_id",
                    labelMapping={"困惑": ["confused", "e01"]},
                    summary=EmotionExperimentSummary(
                        rowsProcessed=3,
                        rowsSkipped=0,
                        analyzedRows=3,
                        comparedRows=2,
                        matchedRows=1,
                        uniqueProfiles=1,
                        uniqueConversations=1,
                    ),
                    createdAt="2026-03-29T10:20:30+00:00",
                )
            ],
            1,
        )

    async def fake_get_run(db, run_id):
        assert db is session
        return SimpleNamespace(id=run_id)

    def fake_build_detail(_run):
        return sample_response()

    monkeypatch.setattr(
        "app.api.endpoints.admin.emotion_experiments.list_emotion_experiment_runs",
        fake_list_runs,
    )
    monkeypatch.setattr(
        "app.api.endpoints.admin.emotion_experiments.get_emotion_experiment_run",
        fake_get_run,
    )
    monkeypatch.setattr(
        "app.api.endpoints.admin.emotion_experiments.build_emotion_experiment_detail",
        fake_build_detail,
    )

    list_response = client.get("/api/admin/research/emotion-experiments/runs?limit=10&offset=5")
    assert list_response.status_code == 200
    list_payload = list_response.json()["data"]
    assert list_payload["total"] == 1
    assert list_payload["runs"][0]["id"] == run_id

    detail_response = client.get(f"/api/admin/research/emotion-experiments/runs/{run_id}")
    assert detail_response.status_code == 200
    detail_payload = detail_response.json()["data"]
    assert detail_payload["fileName"] == "dataset_emotion_analysis.csv"
    assert detail_payload["previewRows"][0]["emotionCode"] == "E01"
