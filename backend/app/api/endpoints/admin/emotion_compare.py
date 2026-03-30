"""
Admin 情感对比实验 API
"""
import json
from typing import Literal, cast

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from app.core.security import verify_admin_key
from app.schemas.admin.emotion_compare import EmotionCompareAnalyzeResponse
from app.schemas.admin.emotion_compare_v2 import EmotionCompareAnalyzeResponseV2
from app.schemas.base import SuccessResponse
from app.services.emotion_compare_service import (
    analyze_compare_dataset,
    analyze_compare_dataset_v2,
    normalize_compare_dataset,
)

router = APIRouter(tags=["Admin - Emotion Compare"])


@router.post(
    "/research/emotion-compare/analyze-dataset",
    dependencies=[Depends(verify_admin_key)],
)
async def analyze_emotion_compare_dataset(
    file: UploadFile = File(...),
    label_mode: str = Form(...),
    text_column: str = Form(...),
    expected_label_column: str | None = Form(default=None),
    expected_label_columns_json: str | None = Form(default=None),
    positive_label_value: str | None = Form(default="1"),
    sample_id_column: str | None = Form(default=None),
    conversation_id_column: str | None = Form(default=None),
    speaker_column: str | None = Form(default=None),
    profile_key_column: str | None = Form(default=None),
    label_mapping_json: str | None = Form(default=None),
    preview_limit: int = Form(default=50),
    dataset_template: str | None = Form(default=None),
) -> SuccessResponse[EmotionCompareAnalyzeResponse]:
    del conversation_id_column, speaker_column, profile_key_column

    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")

    raw_bytes = await file.read()
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="Uploaded dataset is empty")

    try:
        if label_mapping_json:
            parsed_mapping = json.loads(label_mapping_json)
            if not isinstance(parsed_mapping, dict):
                raise ValueError("label_mapping_json must be a JSON object")
        else:
            parsed_mapping = None

        expected_label_columns = (
            json.loads(expected_label_columns_json)
            if expected_label_columns_json
            else None
        )
        if expected_label_columns is not None:
            if (
                not isinstance(expected_label_columns, list)
                or not all(isinstance(column, str) for column in expected_label_columns)
            ):
                raise ValueError("expected_label_columns_json must be a JSON string array")

        if label_mode not in {"single_label", "multi_binary"}:
            raise ValueError("label_mode must be 'single_label' or 'multi_binary'")
        normalized_label_mode = cast(Literal["single_label", "multi_binary"], label_mode)

        dataset = normalize_compare_dataset(
            filename=file.filename,
            raw_bytes=raw_bytes,
            label_mode=normalized_label_mode,
            text_column=text_column,
            expected_label_column=expected_label_column,
            expected_label_columns=expected_label_columns,
            positive_label_value=positive_label_value,
            sample_id_column=sample_id_column,
            dataset_template=dataset_template,
        )
        response = await analyze_compare_dataset(
            dataset=dataset,
            preview_limit=preview_limit,
            label_mapping=parsed_mapping,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return SuccessResponse(data=response)


@router.post(
    "/research/emotion-compare/analyze-dataset-v2",
    dependencies=[Depends(verify_admin_key)],
)
async def analyze_emotion_compare_dataset_v2_endpoint(
    file: UploadFile = File(...),
    label_mode: str = Form(...),
    text_column: str = Form(...),
    expected_label_column: str | None = Form(default=None),
    expected_label_columns_json: str | None = Form(default=None),
    positive_label_value: str | None = Form(default="1"),
    sample_id_column: str | None = Form(default=None),
    conversation_id_column: str | None = Form(default=None),
    speaker_column: str | None = Form(default=None),
    profile_key_column: str | None = Form(default=None),
    label_mapping_json: str | None = Form(default=None),
    preview_limit: int = Form(default=50),
    dataset_template: str | None = Form(default=None),
) -> SuccessResponse[EmotionCompareAnalyzeResponseV2]:
    del conversation_id_column, speaker_column, profile_key_column

    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")

    raw_bytes = await file.read()
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="Uploaded dataset is empty")

    try:
        if label_mapping_json:
            parsed_mapping = json.loads(label_mapping_json)
            if not isinstance(parsed_mapping, dict):
                raise ValueError("label_mapping_json must be a JSON object")
        else:
            parsed_mapping = None

        expected_label_columns = (
            json.loads(expected_label_columns_json)
            if expected_label_columns_json
            else None
        )
        if expected_label_columns is not None:
            if (
                not isinstance(expected_label_columns, list)
                or not all(isinstance(column, str) for column in expected_label_columns)
            ):
                raise ValueError("expected_label_columns_json must be a JSON string array")

        if label_mode not in {"single_label", "multi_binary"}:
            raise ValueError("label_mode must be 'single_label' or 'multi_binary'")
        normalized_label_mode = cast(Literal["single_label", "multi_binary"], label_mode)

        dataset = normalize_compare_dataset(
            filename=file.filename,
            raw_bytes=raw_bytes,
            label_mode=normalized_label_mode,
            text_column=text_column,
            expected_label_column=expected_label_column,
            expected_label_columns=expected_label_columns,
            positive_label_value=positive_label_value,
            sample_id_column=sample_id_column,
            dataset_template=dataset_template,
        )
        response = await analyze_compare_dataset_v2(
            dataset=dataset,
            preview_limit=preview_limit,
            label_mapping=parsed_mapping,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return SuccessResponse(data=response)
