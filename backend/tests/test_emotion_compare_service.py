import asyncio
import io
import json

import pytest
from openpyxl import Workbook

import app.services.emotion_compare_service as compare_service
from app.services.llm_provider import BaseProvider
from app.services.emotion_compare_service import (
    analyze_compare_dataset,
    analyze_compare_dataset_v2,
    build_emotion_compare_skeleton_response,
    normalize_compare_dataset,
)


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


class PromptAwareProvider(BaseProvider):
    async def complete(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.7,
        max_tokens: int = 1000,
    ) -> str:
        del system_prompt, temperature, max_tokens
        has_profile = "学习者当前画像" in user_prompt
        if "今天心情不错" in user_prompt:
            if has_profile:
                return json.dumps(
                    {
                        "intent": "chat",
                        "emotion": "excited",
                        "detectedConcepts": [],
                        "delta": {"cognition": 1, "affect": 6, "behavior": 2},
                        "evidence": {"spans": [], "confidence": 0.9},
                        "emotionDetail": {"code": "E07", "name": "excited", "intensity": "high"},
                    },
                    ensure_ascii=False,
                )
            return json.dumps(
                {
                    "intent": "chat",
                    "emotion": "neutral",
                    "detectedConcepts": [],
                    "delta": {"cognition": 0, "affect": 0, "behavior": 0},
                    "evidence": {"spans": [], "confidence": 0.6},
                    "emotionDetail": {"code": "E13", "name": "neutral", "intensity": "medium"},
                },
                ensure_ascii=False,
            )
        if "I am confused" in user_prompt:
            return json.dumps(
                {
                    "intent": "help-seeking",
                    "emotion": "confused",
                    "detectedConcepts": [],
                    "delta": {"cognition": -3, "affect": -2, "behavior": 2},
                    "evidence": {"spans": [], "confidence": 0.85},
                    "emotionDetail": {"code": "E01", "name": "confused", "intensity": "medium"},
                },
                ensure_ascii=False,
            )
        if "Great!" in user_prompt:
            if has_profile:
                return json.dumps(
                    {
                        "intent": "chat",
                        "emotion": "excited",
                        "detectedConcepts": [],
                        "delta": {"cognition": 1, "affect": 5, "behavior": 2},
                        "evidence": {"spans": [], "confidence": 0.88},
                        "emotionDetail": {"code": "E07", "name": "excited", "intensity": "high"},
                    },
                    ensure_ascii=False,
                )
            return json.dumps(
                {
                    "intent": "chat",
                    "emotion": "neutral",
                    "detectedConcepts": [],
                    "delta": {"cognition": 0, "affect": 0, "behavior": 0},
                    "evidence": {"spans": [], "confidence": 0.55},
                    "emotionDetail": {"code": "E13", "name": "neutral", "intensity": "medium"},
                },
                ensure_ascii=False,
            )
        return json.dumps(
            {
                "intent": "chat",
                "emotion": "neutral",
                "detectedConcepts": [],
                "delta": {"cognition": 0, "affect": 0, "behavior": 0},
                "evidence": {"spans": [], "confidence": 0.5},
                "emotionDetail": {"code": "E13", "name": "neutral", "intensity": "medium"},
            },
            ensure_ascii=False,
        )

    async def health_check(self) -> bool:
        return True


class BrokenProvider(BaseProvider):
    async def complete(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.7,
        max_tokens: int = 1000,
    ) -> str:
        del system_prompt, user_prompt, temperature, max_tokens
        raise RuntimeError("provider boom")

    async def health_check(self) -> bool:
        return True


def run_async(coro):
    return asyncio.run(coro)


def test_normalize_compare_dataset_supports_single_label_csv():
    raw_bytes = (
        "id,content,label\n"
        "1,今天心情不错,happy\n"
        "2,,sad\n"
    ).encode("utf-8")

    dataset = normalize_compare_dataset(
        filename="weibo.csv",
        raw_bytes=raw_bytes,
        label_mode="single_label",
        text_column="content",
        expected_label_column="label",
        sample_id_column="id",
        dataset_template="weibo_single",
    )

    assert dataset.task_type == "single_label"
    assert dataset.rows_processed == 1
    assert dataset.rows_skipped == 1
    assert dataset.rows[0].sample_id == "1"
    assert dataset.rows[0].ground_truth_labels == ["happy"]
    assert dataset.labels == ["happy"]


def test_normalize_compare_dataset_supports_multi_binary_csv():
    raw_bytes = (
        "text,joy,confusion,anger\n"
        "I am confused,0,1,0\n"
        "Great!,1,0,0\n"
    ).encode("utf-8")

    dataset = normalize_compare_dataset(
        filename="goemotions.csv",
        raw_bytes=raw_bytes,
        label_mode="multi_binary",
        text_column="text",
        expected_label_columns=["joy", "confusion", "anger"],
        positive_label_value="1",
        dataset_template="goemotions_multi",
    )

    assert dataset.task_type == "multi_label"
    assert dataset.rows_processed == 2
    assert dataset.rows[0].ground_truth_labels == ["confusion"]
    assert dataset.rows[1].ground_truth_labels == ["joy"]
    assert dataset.label_count == 3


def test_normalize_compare_dataset_supports_json_text_dataset():
    payload = [
        {"id": 1, "content": "回忆起老爸的点点滴滴", "label": "sad"},
        {"id": 2, "content": "今天真开心", "label": "happy"},
    ]

    dataset = normalize_compare_dataset(
        filename="usual_train.txt",
        raw_bytes=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        label_mode="single_label",
        text_column="content",
        expected_label_column="label",
        sample_id_column="id",
    )

    assert dataset.source_format == "json"
    assert dataset.rows_processed == 2
    assert dataset.rows[0].sample_id == "1"
    assert dataset.rows[0].ground_truth_labels == ["sad"]


def test_normalize_compare_dataset_supports_xlsx():
    raw_bytes = build_xlsx_bytes(
        headers=["id", "content", "label"],
        rows=[
            [1, "我竟然不知道", "surprise"],
            [2, "这里还值得注意", "neutral"],
        ],
    )

    dataset = normalize_compare_dataset(
        filename="usual_train.xlsx",
        raw_bytes=raw_bytes,
        label_mode="single_label",
        text_column="content",
        expected_label_column="label",
        sample_id_column="id",
    )

    assert dataset.source_format == "xlsx"
    assert dataset.rows_processed == 2
    assert dataset.labels == ["neutral", "surprise"]


def test_build_emotion_compare_skeleton_response_preserves_contract():
    raw_bytes = (
        "id,content,label\n"
        "1,今天心情不错,happy\n"
    ).encode("utf-8")
    dataset = normalize_compare_dataset(
        filename="weibo.csv",
        raw_bytes=raw_bytes,
        label_mode="single_label",
        text_column="content",
        expected_label_column="label",
        sample_id_column="id",
    )

    response = build_emotion_compare_skeleton_response(dataset=dataset, preview_limit=10)

    assert response.datasetInfo.datasetName == "weibo.csv"
    assert response.datasetInfo.taskType == "single_label"
    assert response.summaryMetrics.support == 1
    assert response.baselineRows[0].text == "今天心情不错"
    assert response.systemRows[0].profileBefore is not None
    assert response.comparisonRows[0].groundTruthLabels == ["happy"]
    assert response.exportArtifacts.comparisonCsvFileName.endswith("_compare_results.csv")


def test_analyze_compare_dataset_builds_single_label_metrics_and_rows():
    raw_bytes = (
        "id,content,label\n"
        "1,今天心情不错,happy\n"
        "2,今天心情不错,happy\n"
    ).encode("utf-8")
    dataset = normalize_compare_dataset(
        filename="weibo.csv",
        raw_bytes=raw_bytes,
        label_mode="single_label",
        text_column="content",
        expected_label_column="label",
        sample_id_column="id",
    )

    response = run_async(
        analyze_compare_dataset(
            dataset=dataset,
            provider=PromptAwareProvider(),
            preview_limit=10,
        )
    )

    assert response.baselineRows[0].predictedEmotionName == "neutral"
    assert response.systemRows[0].predictedEmotionName == "excited"
    assert response.comparisonRows[0].baselineMatched is False
    assert response.comparisonRows[0].systemMatched is True
    assert response.comparisonRows[0].winner == "system"
    assert response.comparisonRows[0].systemPrediction.predictedLabels == ["happy"]
    assert response.summaryMetrics.baseline.accuracy == 0.0
    assert response.summaryMetrics.system.accuracy == 1.0


def test_analyze_compare_dataset_builds_multi_label_metrics():
    raw_bytes = (
        "text,joy,confusion,anger\n"
        "I am confused,0,1,0\n"
        "Great!,1,0,0\n"
    ).encode("utf-8")
    dataset = normalize_compare_dataset(
        filename="goemotions.csv",
        raw_bytes=raw_bytes,
        label_mode="multi_binary",
        text_column="text",
        expected_label_columns=["joy", "confusion", "anger"],
        positive_label_value="1",
    )

    response = run_async(
        analyze_compare_dataset(
            dataset=dataset,
            provider=PromptAwareProvider(),
            preview_limit=10,
        )
    )

    assert response.comparisonRows[0].systemMatched is True
    assert response.comparisonRows[0].systemPrediction.predictedLabels == ["confusion"]
    assert response.comparisonRows[1].baselineMatched is False
    assert response.comparisonRows[1].systemMatched is True
    assert response.summaryMetrics.baseline.exactMatch == 0.5
    assert response.summaryMetrics.baseline.microF1 == pytest.approx(2 / 3)
    assert response.summaryMetrics.system.exactMatch == 1.0
    assert response.summaryMetrics.system.overlapMatch == 1.0
    assert response.summaryMetrics.system.microF1 == 1.0
    assert len(response.summaryMetrics.system.labelWiseMetrics) == 3
    joy_metric = next(metric for metric in response.summaryMetrics.system.labelWiseMetrics if metric.label == "joy")
    assert joy_metric.f1 == 1.0


def test_analyze_compare_dataset_tolerates_provider_failures(monkeypatch: pytest.MonkeyPatch):
    raw_bytes = (
        "id,content,label\n"
        "1,今天心情不错,happy\n"
    ).encode("utf-8")
    dataset = normalize_compare_dataset(
        filename="weibo.csv",
        raw_bytes=raw_bytes,
        label_mode="single_label",
        text_column="content",
        expected_label_column="label",
        sample_id_column="id",
    )

    async def broken_baseline(*args, **kwargs):
        raise RuntimeError("baseline boom")

    async def broken_system(*args, **kwargs):
        raise RuntimeError("system boom")

    monkeypatch.setattr(compare_service, "_analyze_baseline_row", broken_baseline)
    monkeypatch.setattr(compare_service, "_analyze_system_row", broken_system)

    response = run_async(
        analyze_compare_dataset(
            dataset=dataset,
            preview_limit=10,
        )
    )

    assert response.baselineRows[0].predictedEmotionName is None
    assert response.systemRows[0].predictedEmotionName is None
    assert response.comparisonRows[0].winner == "none"


def test_analyze_compare_dataset_v2_builds_single_label_extended_metrics():
    raw_bytes = (
        "id,content,label\n"
        "1,今天心情不错,happy\n"
        "2,今天心情不错,happy\n"
    ).encode("utf-8")
    dataset = normalize_compare_dataset(
        filename="weibo.csv",
        raw_bytes=raw_bytes,
        label_mode="single_label",
        text_column="content",
        expected_label_column="label",
        sample_id_column="id",
    )

    response = run_async(
        analyze_compare_dataset_v2(
            dataset=dataset,
            provider=PromptAwareProvider(),
            preview_limit=10,
        )
    )

    assert response.base.summaryMetrics.system.accuracy == 1.0
    assert response.confusionAnalysis.available is True
    assert response.confusionAnalysis.labels == ["happy"]
    assert response.confusionAnalysis.systemMatrix == [[2]]
    assert response.agreementMetrics.available is True
    assert response.agreementMetrics.system.overallAgreement == 1.0
    assert response.intensityMetrics.available is False
    per_class = response.perClassMetrics[0]
    assert per_class.label == "happy"
    assert per_class.systemF1 == 1.0


def test_analyze_compare_dataset_v2_builds_multi_label_extended_metrics():
    raw_bytes = (
        "text,joy,confusion,anger\n"
        "I am confused,0,1,0\n"
        "Great!,1,0,0\n"
    ).encode("utf-8")
    dataset = normalize_compare_dataset(
        filename="goemotions.csv",
        raw_bytes=raw_bytes,
        label_mode="multi_binary",
        text_column="text",
        expected_label_columns=["joy", "confusion", "anger"],
        positive_label_value="1",
    )

    response = run_async(
        analyze_compare_dataset_v2(
            dataset=dataset,
            provider=PromptAwareProvider(),
            preview_limit=10,
        )
    )

    assert response.base.summaryMetrics.system.microF1 == 1.0
    assert response.confusionAnalysis.available is False
    assert response.agreementMetrics.available is False
    assert len(response.perClassMetrics) == 3
    confusion_metric = next(metric for metric in response.perClassMetrics if metric.label == "confusion")
    assert confusion_metric.systemRecall == 1.0
