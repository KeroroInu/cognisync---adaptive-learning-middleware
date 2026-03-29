"""
Admin 情感实验 API
"""
import json
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import verify_admin_key
from app.db.postgres import get_db
from app.schemas.admin.emotion_experiments import EmotionExperimentAnalyzeResponse
from app.schemas.base import SuccessResponse
from app.services.emotion_dataset_service import analyze_dataset_csv
from app.services.emotion_experiment_service import (
    build_emotion_experiment_detail,
    get_emotion_experiment_run,
    list_emotion_experiment_runs,
    save_emotion_experiment_run,
)

router = APIRouter(tags=["Admin - Emotion Experiments"])


@router.post(
    "/research/emotion-experiments/analyze-csv",
    dependencies=[Depends(verify_admin_key)],
)
async def analyze_emotion_dataset_csv(
    file: UploadFile = File(...),
    text_column: str = Form(...),
    conversation_id_column: str | None = Form(default=None),
    speaker_column: str | None = Form(default=None),
    expected_label_column: str | None = Form(default=None),
    expected_label_columns_json: str | None = Form(default=None),
    positive_label_value: str = Form(default="1"),
    profile_key_column: str | None = Form(default=None),
    label_mapping_json: str | None = Form(default=None),
    preview_limit: int = Form(default=20),
    db: AsyncSession = Depends(get_db),
) -> SuccessResponse[EmotionExperimentAnalyzeResponse]:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")

    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are supported")

    raw_bytes = await file.read()
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="Uploaded CSV is empty")

    try:
        csv_content = raw_bytes.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail="CSV must be UTF-8 encoded") from exc

    try:
        label_mapping = json.loads(label_mapping_json) if label_mapping_json else None
        if label_mapping is not None and not isinstance(label_mapping, dict):
            raise ValueError("label_mapping_json must be a JSON object")
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

        result = await analyze_dataset_csv(
            csv_content=csv_content,
            filename=file.filename,
            text_column=text_column,
            conversation_id_column=conversation_id_column,
            speaker_column=speaker_column,
            expected_label_column=expected_label_column,
            expected_label_columns=expected_label_columns,
            positive_label_value=positive_label_value,
            profile_key_column=profile_key_column,
            label_mapping=label_mapping,
            preview_limit=preview_limit,
        )
        run = await save_emotion_experiment_run(
            db=db,
            result=result,
            text_column=text_column,
            conversation_id_column=conversation_id_column,
            speaker_column=speaker_column,
            expected_label_column=expected_label_column,
            profile_key_column=profile_key_column,
            original_filename=file.filename,
        )
        await db.commit()
        result.experimentId = str(run.id)
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return SuccessResponse(data=result)


@router.get(
    "/research/emotion-experiments/runs",
    dependencies=[Depends(verify_admin_key)],
)
async def list_emotion_experiment_history(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> SuccessResponse[dict]:
    runs, total = await list_emotion_experiment_runs(db=db, limit=limit, offset=offset)
    return SuccessResponse(data={"runs": runs, "total": total, "limit": limit, "offset": offset})


@router.get(
    "/research/emotion-experiments/runs/{run_id}",
    dependencies=[Depends(verify_admin_key)],
)
async def get_emotion_experiment_run_detail(
    run_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> SuccessResponse[EmotionExperimentAnalyzeResponse]:
    run = await get_emotion_experiment_run(db=db, run_id=run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Emotion experiment run not found")
    return SuccessResponse(data=build_emotion_experiment_detail(run))
