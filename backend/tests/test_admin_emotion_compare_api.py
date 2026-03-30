import io
import json

from fastapi import FastAPI
from fastapi.testclient import TestClient
from openpyxl import Workbook

from app.api.endpoints.admin.emotion_compare import router
from app.core.security import verify_admin_key


def build_client() -> TestClient:
    app = FastAPI()
    app.include_router(router, prefix="/api/admin")

    async def override_admin():
        return True

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


def test_emotion_compare_api_accepts_json_weibo_dataset():
    client = build_client()
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


def test_emotion_compare_api_accepts_xlsx_dataset():
    client = build_client()
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
