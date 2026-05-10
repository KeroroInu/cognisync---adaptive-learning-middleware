import io
import json
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from openpyxl import Workbook

from app.api.endpoints.admin.emotion_compare import router
from app.core.security import verify_admin_key
from app.db.postgres import get_db
from app.schemas.admin.emotion_compare import (
    EmotionCompareAnalyzeResponse,
    EmotionCompareDatasetInfo,
    EmotionCompareExportArtifacts,
    EmotionCompareSummaryMetrics,
    EmotionCompareSingleMetrics,
)
from app.schemas.admin.emotion_compare_ablation import EmotionCompareAblationResponse
from app.schemas.admin.emotion_compare_runs import EmotionCompareRunItem
from app.schemas.admin.emotion_compare_v2 import (
    EmotionCompareAgreementMetrics,
    EmotionCompareAnalyzeResponseV2,
    EmotionCompareConfusionAnalysis,
    EmotionCompareIntensityMetrics,
)


class FakeSession:
    def __init__(self):
        self.commit_calls = 0
        self.rollback_calls = 0

    def add(self, instance):
        if getattr(instance, "id", None) is None:
            instance.id = uuid4()

    async def flush(self):
        return None

    async def commit(self):
        self.commit_calls += 1

    async def rollback(self):
        self.rollback_calls += 1


def build_client(session: FakeSession | None = None) -> TestClient:
    app = FastAPI()
    app.include_router(router, prefix="/api/admin")
    active_session = session or FakeSession()

    async def override_db():
        yield active_session

    async def override_admin():
        return True

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[verify_admin_key] = override_admin
    return TestClient(app)


def build_xlsx_bytes(headers: list[str], rows: list[list[object]]) -> bytes:
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.append(headers)
    for row in rows:
        worksheet.append(row)
    output = io.BytesIO()
    workbook.save(output)
    workbook.close()
    return output.getvalue()


def sample_base_response() -> EmotionCompareAnalyzeResponse:
    return EmotionCompareAnalyzeResponse(
        datasetInfo=EmotionCompareDatasetInfo(
            datasetName="usual_train.txt",
            sourceFormat="json",
            taskType="single_label",
            datasetTemplate="weibo_single",
            sampleIdColumn="id",
            textColumn="content",
            expectedLabelColumn="label",
            expectedLabelColumns=[],
            positiveLabelValue=None,
            rowsProcessed=2,
            rowsSkipped=0,
            labelCount=2,
            labels=["happy", "sad"],
        ),
        summaryMetrics=EmotionCompareSummaryMetrics(
            taskType="single_label",
            support=2,
            labelCount=2,
            labels=["happy", "sad"],
            baseline=EmotionCompareSingleMetrics(accuracy=0.5, macroF1=0.4, weightedF1=0.45),
            system=EmotionCompareSingleMetrics(accuracy=1.0, macroF1=1.0, weightedF1=1.0),
        ),
        exportArtifacts=EmotionCompareExportArtifacts(
            comparisonCsvFileName="compare.csv",
            comparisonCsvContent="rowIndex,text\n1,今天真开心",
            resultJsonFileName="compare.json",
        ),
    )


def sample_v2_response() -> EmotionCompareAnalyzeResponseV2:
    return EmotionCompareAnalyzeResponseV2(
        base=sample_base_response(),
        perClassMetrics=[],
        confusionAnalysis=EmotionCompareConfusionAnalysis(
            taskType="single_label",
            labels=["happy", "sad"],
            baselineMatrix=[[0, 1], [0, 1]],
            systemMatrix=[[1, 0], [0, 1]],
            available=True,
        ),
        agreementMetrics=EmotionCompareAgreementMetrics(
            taskType="single_label",
            available=True,
        ),
        intensityMetrics=EmotionCompareIntensityMetrics(available=False),
    )


def sample_ablation_response() -> EmotionCompareAblationResponse:
    return EmotionCompareAblationResponse(
        datasetInfo=sample_base_response().datasetInfo,
        variants=[],
    )


def test_emotion_compare_api_accepts_json_weibo_dataset():
    session = FakeSession()
    client = build_client(session)
    payload = [
        {"id": 1, "content": "回忆起老爸的点点滴滴", "label": "sad"},
        {"id": 2, "content": "今天真开心", "label": "happy"},
    ]

    response = client.post(
        "/api/admin/research/emotion-compare/analyze-dataset",
        data={
            "label_mode": "single_label",
            "text_column": "content",
            "expected_label_column": "label",
            "sample_id_column": "id",
            "dataset_template": "weibo_single",
        },
        files={
            "file": (
                "usual_train.txt",
                json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                "application/json",
            )
        },
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["datasetInfo"]["taskType"] == "single_label"
    assert data["datasetInfo"]["sourceFormat"] == "json"
    assert data["datasetInfo"]["textColumn"] == "content"
    assert data["comparisonRows"][0]["groundTruthLabels"] == ["sad"]
    assert data["runId"] is not None
    assert session.commit_calls == 1


def test_emotion_compare_api_accepts_xlsx_dataset():
    session = FakeSession()
    client = build_client(session)
    workbook_bytes = build_xlsx_bytes(
        headers=["id", "content", "label"],
        rows=[[1, "今天心情不错", "happy"]],
    )

    response = client.post(
        "/api/admin/research/emotion-compare/analyze-dataset",
        data={
            "label_mode": "single_label",
            "text_column": "content",
            "expected_label_column": "label",
            "sample_id_column": "id",
        },
        files={"file": ("usual_train.xlsx", workbook_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["datasetInfo"]["sourceFormat"] == "xlsx"
    assert data["baselineRows"][0]["sampleId"] == "1"
    assert data["runId"] is not None
    assert session.commit_calls == 1


def test_emotion_compare_api_rejects_invalid_xlsx_with_actionable_message():
    client = build_client()

    response = client.post(
        "/api/admin/research/emotion-compare/analyze-dataset",
        data={
            "label_mode": "single_label",
            "text_column": "content",
            "expected_label_column": "label",
            "sample_id_column": "id",
        },
        files={"file": ("usual_train.xlsx", b"not-a-real-xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )

    assert response.status_code == 400
    assert "当前文件不是有效的 Excel 工作簿" in response.json()["detail"]
    assert "usual_train.txt" in response.json()["detail"]


def test_emotion_compare_api_rejects_missing_expected_columns():
    client = build_client()

    response = client.post(
        "/api/admin/research/emotion-compare/analyze-dataset",
        data={
            "label_mode": "multi_binary",
            "text_column": "text",
            "expected_label_columns_json": json.dumps(["joy", "anger"]),
        },
        files={"file": ("goemotions.csv", b"text,joy\nhello,1\n", "text/csv")},
    )

    assert response.status_code == 400
    assert "Dataset missing expected label columns" in response.json()["detail"]


def test_emotion_compare_api_rejects_invalid_expected_label_columns_json():
    client = build_client()

    response = client.post(
        "/api/admin/research/emotion-compare/analyze-dataset",
        data={
            "label_mode": "multi_binary",
            "text_column": "text",
            "expected_label_columns_json": '{"joy": 1}',
        },
        files={"file": ("goemotions.csv", b"text,joy\nhello,1\n", "text/csv")},
    )

    assert response.status_code == 400
    assert "expected_label_columns_json must be a JSON string array" in response.json()["detail"]


@pytest.mark.parametrize(
    "path",
    [
        "/api/admin/research/emotion-compare/analyze-dataset",
        "/api/admin/research/emotion-compare/analyze-dataset-v2",
        "/api/admin/research/emotion-compare/analyze-ablation-v2",
    ],
)
def test_emotion_compare_endpoints_reject_invalid_label_mapping_json(path: str):
    client = build_client()

    response = client.post(
        path,
        data={
            "label_mode": "single_label",
            "text_column": "content",
            "expected_label_column": "label",
            "label_mapping_json": '["happy"]',
        },
        files={
            "file": (
                "usual_train.txt",
                json.dumps([{"id": 1, "content": "今天真开心", "label": "happy"}], ensure_ascii=False).encode("utf-8"),
                "application/json",
            )
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "label_mapping_json must be a JSON object"


def test_emotion_compare_api_rejects_invalid_json_txt_dataset():
    client = build_client()

    response = client.post(
        "/api/admin/research/emotion-compare/analyze-dataset",
        data={
            "label_mode": "single_label",
            "text_column": "content",
            "expected_label_column": "label",
        },
        files={"file": ("usual_train.txt", b"not-a-json-array", "text/plain")},
    )

    assert response.status_code == 400
    assert "JSON array" in response.json()["detail"]


def test_emotion_compare_api_rejects_empty_file():
    client = build_client()

    response = client.post(
        "/api/admin/research/emotion-compare/analyze-dataset",
        data={
            "label_mode": "single_label",
            "text_column": "content",
            "expected_label_column": "label",
        },
        files={"file": ("empty.csv", b"", "text/csv")},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Uploaded dataset is empty"


def test_emotion_compare_api_v2_returns_extended_metrics():
    client = build_client()
    payload = [
        {"id": 1, "content": "回忆起老爸的点点滴滴", "label": "sad"},
        {"id": 2, "content": "今天真开心", "label": "happy"},
    ]

    response = client.post(
        "/api/admin/research/emotion-compare/analyze-dataset-v2",
        data={
            "label_mode": "single_label",
            "text_column": "content",
            "expected_label_column": "label",
            "sample_id_column": "id",
            "dataset_template": "weibo_single",
        },
        files={
            "file": (
                "usual_train.txt",
                json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                "application/json",
            )
        },
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert "base" in data
    assert "perClassMetrics" in data
    assert "confusionAnalysis" in data
    assert "agreementMetrics" in data
    assert "intensityMetrics" in data


def test_emotion_compare_api_v2_multi_label_marks_unavailable_sections():
    client = build_client()

    response = client.post(
        "/api/admin/research/emotion-compare/analyze-dataset-v2",
        data={
            "label_mode": "multi_binary",
            "text_column": "text",
            "expected_label_columns_json": json.dumps(["joy", "confusion"]),
            "positive_label_value": "1",
            "dataset_template": "goemotions_multi",
        },
        files={
            "file": (
                "goemotions.csv",
                b"text,joy,confusion\nI am excited,1,0\nI am confused,0,1\n",
                "text/csv",
            )
        },
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["base"]["datasetInfo"]["taskType"] == "multi_label"
    assert data["base"]["datasetInfo"]["expectedLabelColumns"] == ["joy", "confusion"]
    assert data["confusionAnalysis"]["available"] is False
    assert data["agreementMetrics"]["available"] is False
    assert data["intensityMetrics"]["available"] is False
    assert data["intensityMetrics"]["note"] == "当前公开数据集缺少可靠强度真值"
    assert [item["label"] for item in data["perClassMetrics"]] == ["confusion", "joy"]


def test_emotion_compare_ablation_v2_returns_variant_results():
    client = build_client()
    payload = [
        {"id": 1, "content": "回忆起老爸的点点滴滴", "label": "sad"},
        {"id": 2, "content": "今天真开心", "label": "happy"},
    ]

    response = client.post(
        "/api/admin/research/emotion-compare/analyze-ablation-v2",
        data={
            "label_mode": "single_label",
            "text_column": "content",
            "expected_label_column": "label",
            "sample_id_column": "id",
            "dataset_template": "weibo_single",
        },
        files={
            "file": (
                "usual_train.txt",
                json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                "application/json",
            )
        },
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["datasetInfo"]["taskType"] == "single_label"
    assert len(data["variants"]) == 5
    assert any(item["variantKey"] == "baseline_text_only" for item in data["variants"])
    assert any(item["variantKey"] == "system_dialogue_only" and item["implemented"] is False for item in data["variants"])


def test_emotion_compare_history_and_detail_contract(monkeypatch):
    session = FakeSession()
    client = build_client(session)
    run_id = str(uuid4())

    async def fake_list_runs(db, limit, offset):
        assert db is session
        assert limit == 10
        assert offset == 5
        return (
            [
                EmotionCompareRunItem(
                    id=run_id,
                    originalFilename="weibo.csv",
                    datasetTemplate="weibo_single",
                    labelMode="single_label",
                    sourceFormat="csv",
                    taskType="single_label",
                    textColumn="content",
                    expectedLabelColumn="label",
                    expectedLabelColumns=[],
                    sampleIdColumn="id",
                    summaryMetrics=sample_base_response().summaryMetrics,
                    createdAt="2026-03-30T10:20:30+00:00",
                )
            ],
            1,
        )

    async def fake_get_run(db, run_id):
        assert db is session
        return SimpleNamespace(id=run_id)

    def fake_build_detail(_run):
        return {
            "id": run_id,
            "originalFilename": "weibo.csv",
            "datasetTemplate": "weibo_single",
            "labelMode": "single_label",
            "sourceFormat": "csv",
            "taskType": "single_label",
            "textColumn": "content",
            "expectedLabelColumn": "label",
            "expectedLabelColumns": [],
            "positiveLabelValue": None,
            "sampleIdColumn": "id",
            "labelMapping": {"happy": ["excited"]},
            "baseResult": sample_base_response().model_dump(),
            "v2Result": sample_v2_response().model_dump(),
            "ablationResult": sample_ablation_response().model_dump(),
            "createdAt": "2026-03-30T10:20:30+00:00",
        }

    monkeypatch.setattr(
        "app.api.endpoints.admin.emotion_compare.list_emotion_compare_runs",
        fake_list_runs,
    )
    monkeypatch.setattr(
        "app.api.endpoints.admin.emotion_compare.get_emotion_compare_run",
        fake_get_run,
    )
    monkeypatch.setattr(
        "app.api.endpoints.admin.emotion_compare.build_emotion_compare_run_detail",
        fake_build_detail,
    )

    list_response = client.get("/api/admin/research/emotion-compare/runs?limit=10&offset=5")
    assert list_response.status_code == 200
    list_payload = list_response.json()["data"]
    assert list_payload["total"] == 1
    assert list_payload["runs"][0]["id"] == run_id

    detail_response = client.get(f"/api/admin/research/emotion-compare/runs/{run_id}")
    assert detail_response.status_code == 200
    detail_payload = detail_response.json()["data"]
    assert detail_payload["id"] == run_id
    assert detail_payload["baseResult"]["datasetInfo"]["datasetTemplate"] == "weibo_single"
    assert detail_payload["v2Result"]["confusionAnalysis"]["available"] is True


def test_emotion_compare_detail_returns_404_when_run_missing(monkeypatch):
    client = build_client(FakeSession())

    async def fake_get_run(db, run_id):
        del db, run_id
        return None

    monkeypatch.setattr(
        "app.api.endpoints.admin.emotion_compare.get_emotion_compare_run",
        fake_get_run,
    )

    response = client.get(f"/api/admin/research/emotion-compare/runs/{uuid4()}")

    assert response.status_code == 404
    assert response.json()["detail"] == "Emotion compare run not found"
