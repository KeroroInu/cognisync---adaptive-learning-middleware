"""
Emotion Dataset Service - 公开对话数据集批处理情感分析
"""
import csv
import io
from collections.abc import Iterable
from typing import Optional

from app.schemas.admin.emotion_experiments import (
    EmotionExperimentAnalyzeResponse,
    EmotionExperimentRow,
    EmotionExperimentSummary,
)
from app.schemas.profile import UserProfile
from app.services.llm_provider import BaseProvider
from app.services.text_analyzer import TextAnalyzer

EXPERIMENT_HEADERS = [
    "rowIndex",
    "profileKey",
    "conversationId",
    "speaker",
    "text",
    "expectedLabel",
    "expectedLabels",
    "expectedMatches",
    "intent",
    "emotion",
    "emotionCode",
    "emotionName",
    "intensity",
    "confidence",
    "arousal",
    "valence",
    "deltaCognition",
    "deltaAffect",
    "deltaBehavior",
    "profileCognitionBefore",
    "profileAffectBefore",
    "profileBehaviorBefore",
    "profileCognitionAfter",
    "profileAffectAfter",
    "profileBehaviorAfter",
]


def _default_profile() -> UserProfile:
    return UserProfile(cognition=50, affect=50, behavior=50, lastUpdate=None)


def _normalize_label(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    normalized = str(value).strip().lower()
    return normalized or None


def _normalize_expected_labels(labels: list[str]) -> list[str]:
    deduplicated: list[str] = []
    seen: set[str] = set()
    for label in labels:
        normalized = str(label).strip()
        key = _normalize_label(normalized)
        if not normalized or key is None or key in seen:
            continue
        seen.add(key)
        deduplicated.append(normalized)
    return deduplicated


def _resolve_message_role(speaker: Optional[str]) -> str:
    normalized = _normalize_label(speaker)
    if normalized in {"assistant", "bot", "teacher", "tutor", "system", "ai"}:
        return "assistant"
    return "user"


def _resolve_profile_key(
    row: dict[str, str],
    profile_key_column: Optional[str],
    conversation_id_column: Optional[str],
) -> str:
    if profile_key_column:
        value = row.get(profile_key_column, "").strip()
        if value:
            return value
    if conversation_id_column:
        value = row.get(conversation_id_column, "").strip()
        if value:
            return value
    return "__default_profile__"


def _resolve_conversation_id(row: dict[str, str], conversation_id_column: Optional[str]) -> str:
    if conversation_id_column:
        value = row.get(conversation_id_column, "").strip()
        if value:
            return value
    return "__default_conversation__"


def _apply_delta(profile: UserProfile, cognition: int, affect: int, behavior: int) -> UserProfile:
    return UserProfile(
        cognition=max(0, min(100, profile.cognition + cognition)),
        affect=max(0, min(100, profile.affect + affect)),
        behavior=max(0, min(100, profile.behavior + behavior)),
        lastUpdate=profile.lastUpdate,
    )


def _build_csv_content(rows: list[EmotionExperimentRow]) -> str:
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=EXPERIMENT_HEADERS)
    writer.writeheader()
    for row in rows:
        writer.writerow(row.model_dump())
    return output.getvalue()


def normalize_label_mapping(
    label_mapping: Optional[dict[str, str | list[str]]],
) -> dict[str, list[str]]:
    normalized_mapping: dict[str, list[str]] = {}
    if not label_mapping:
        return normalized_mapping

    for raw_key, raw_values in label_mapping.items():
        normalized_key = _normalize_label(raw_key)
        if not normalized_key:
            continue

        if isinstance(raw_values, str):
            values: Iterable[str] = [raw_values]
        elif isinstance(raw_values, list):
            values = raw_values
        else:
            continue

        normalized_values = [
            normalized
            for value in values
            if (normalized := _normalize_label(value)) is not None
        ]
        if normalized_values:
            normalized_mapping[normalized_key] = sorted(set(normalized_values))

    return normalized_mapping


def _matches_expected(
    expected_labels: list[str],
    row: EmotionExperimentRow,
    label_mapping: Optional[dict[str, list[str]]] = None,
) -> Optional[bool]:
    normalized_labels = {
        normalized
        for label in expected_labels
        if (normalized := _normalize_label(label)) is not None
    }
    if not normalized_labels:
        return None
    candidates = {
        _normalize_label(row.emotion),
        _normalize_label(row.emotionCode),
        _normalize_label(row.emotionName),
    }
    acceptable: set[str] = set()
    for normalized in normalized_labels:
        acceptable.add(normalized)
        if label_mapping:
            acceptable.update(label_mapping.get(normalized, []))
    return any(candidate in acceptable for candidate in candidates if candidate is not None)


def _resolve_expected_labels(
    row: dict[str, str],
    expected_label_column: Optional[str],
    expected_label_columns: Optional[list[str]],
    positive_label_value: str,
) -> list[str]:
    if expected_label_columns:
        positive_tokens = {
            token
            for token in (
                _normalize_label(value)
                for value in positive_label_value.split(",")
            )
            if token is not None
        } or {"1"}
        labels = [
            column
            for column in expected_label_columns
            if _normalize_label(row.get(column)) in positive_tokens
        ]
        return _normalize_expected_labels(labels)

    if expected_label_column:
        value = (row.get(expected_label_column) or "").strip()
        return _normalize_expected_labels([value]) if value else []

    return []


async def analyze_dataset_csv(
    csv_content: str,
    filename: str,
    text_column: str,
    conversation_id_column: Optional[str] = None,
    speaker_column: Optional[str] = None,
    expected_label_column: Optional[str] = None,
    expected_label_columns: Optional[list[str]] = None,
    positive_label_value: str = "1",
    profile_key_column: Optional[str] = None,
    label_mapping: Optional[dict[str, str | list[str]]] = None,
    provider: Optional[BaseProvider] = None,
    preview_limit: int = 20,
) -> EmotionExperimentAnalyzeResponse:
    reader = csv.DictReader(io.StringIO(csv_content))
    fieldnames = list(reader.fieldnames or [])
    if text_column not in fieldnames:
        raise ValueError(f"CSV missing required text column: {text_column}")
    if expected_label_columns:
        missing_columns = [column for column in expected_label_columns if column not in fieldnames]
        if missing_columns:
            raise ValueError(f"CSV missing expected label columns: {', '.join(missing_columns)}")
    if expected_label_column and expected_label_column not in fieldnames:
        raise ValueError(f"CSV missing expected label column: {expected_label_column}")

    analyzer = TextAnalyzer(provider=provider)
    conversation_history: dict[str, list[dict[str, str]]] = {}
    profile_states: dict[str, UserProfile] = {}
    rows_out: list[EmotionExperimentRow] = []
    normalized_label_mapping = normalize_label_mapping(label_mapping)

    rows_processed = 0
    rows_skipped = 0
    compared_rows = 0
    matched_rows = 0

    for index, row in enumerate(reader, start=1):
        rows_processed += 1
        text = (row.get(text_column) or "").strip()
        if not text:
            rows_skipped += 1
            continue

        conversation_id = _resolve_conversation_id(row, conversation_id_column)
        profile_key = _resolve_profile_key(row, profile_key_column, conversation_id_column)
        speaker = (row.get(speaker_column) or "").strip() if speaker_column else None
        current_profile = profile_states.get(profile_key) or _default_profile()
        history = conversation_history.setdefault(conversation_id, [])

        analysis = await analyzer.analyze(
            user_message=text,
            recent_messages=history[-5:],
            current_profile=current_profile,
        )
        detail = analysis.emotionDetail
        if detail is None:
            raise ValueError("Analyzer must return emotionDetail for experiment flow")

        updated_profile = _apply_delta(
            current_profile,
            analysis.delta.cognition,
            analysis.delta.affect,
            analysis.delta.behavior,
        )
        profile_states[profile_key] = updated_profile

        expected_labels = _resolve_expected_labels(
            row=row,
            expected_label_column=expected_label_column,
            expected_label_columns=expected_label_columns,
            positive_label_value=positive_label_value,
        )

        experiment_row = EmotionExperimentRow(
            rowIndex=index,
            profileKey=profile_key,
            conversationId=conversation_id,
            speaker=speaker or None,
            text=text,
            expectedLabel=" | ".join(expected_labels) if expected_labels else None,
            expectedLabels=expected_labels,
            intent=analysis.intent,
            emotion=analysis.emotion,
            emotionCode=detail.code,
            emotionName=detail.name,
            intensity=detail.intensity,
            confidence=detail.confidence,
            arousal=detail.arousal,
            valence=detail.valence,
            deltaCognition=analysis.delta.cognition,
            deltaAffect=analysis.delta.affect,
            deltaBehavior=analysis.delta.behavior,
            profileCognitionBefore=current_profile.cognition,
            profileAffectBefore=current_profile.affect,
            profileBehaviorBefore=current_profile.behavior,
            profileCognitionAfter=updated_profile.cognition,
            profileAffectAfter=updated_profile.affect,
            profileBehaviorAfter=updated_profile.behavior,
        )
        experiment_row.expectedMatches = _matches_expected(
            experiment_row.expectedLabels,
            experiment_row,
            normalized_label_mapping,
        )
        if experiment_row.expectedLabels:
            compared_rows += 1
            if experiment_row.expectedMatches:
                matched_rows += 1

        rows_out.append(experiment_row)
        history.append({"role": _resolve_message_role(speaker), "text": text})

    csv_export = _build_csv_content(rows_out)
    summary = EmotionExperimentSummary(
        rowsProcessed=rows_processed,
        rowsSkipped=rows_skipped,
        analyzedRows=len(rows_out),
        comparedRows=compared_rows,
        matchedRows=matched_rows,
        uniqueProfiles=len(profile_states),
        uniqueConversations=len(conversation_history),
    )

    safe_filename = filename.rsplit(".", 1)[0] if "." in filename else filename
    return EmotionExperimentAnalyzeResponse(
        fileName=f"{safe_filename}_emotion_analysis.csv",
        detectedColumns=fieldnames,
        labelMapping=normalized_label_mapping,
        previewRows=rows_out[:preview_limit],
        summary=summary,
        csvContent=csv_export,
    )
