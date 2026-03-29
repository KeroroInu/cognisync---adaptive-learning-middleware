"""
Emotion Experiment Service - 实验运行记录持久化与查询
"""
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.sql.emotion_experiment import EmotionExperimentRun
from app.schemas.admin.emotion_experiments import (
    EmotionExperimentAnalyzeResponse,
    EmotionExperimentRunItem,
    EmotionExperimentSummary,
)


def _summary_from_run(run: EmotionExperimentRun) -> EmotionExperimentSummary:
    return EmotionExperimentSummary(
        rowsProcessed=run.rows_processed,
        rowsSkipped=run.rows_skipped,
        analyzedRows=run.analyzed_rows,
        comparedRows=run.compared_rows,
        matchedRows=run.matched_rows,
        uniqueProfiles=run.unique_profiles,
        uniqueConversations=run.unique_conversations,
    )


def _run_to_item(run: EmotionExperimentRun) -> EmotionExperimentRunItem:
    return EmotionExperimentRunItem(
        id=str(run.id),
        originalFilename=run.original_filename,
        outputFilename=run.output_filename,
        textColumn=run.text_column,
        conversationIdColumn=run.conversation_id_column,
        speakerColumn=run.speaker_column,
        expectedLabelColumn=run.expected_label_column,
        profileKeyColumn=run.profile_key_column,
        labelMapping=run.label_mapping,
        summary=_summary_from_run(run),
        createdAt=run.created_at.isoformat(),
    )


async def save_emotion_experiment_run(
    db: AsyncSession,
    result: EmotionExperimentAnalyzeResponse,
    text_column: str,
    conversation_id_column: str | None,
    speaker_column: str | None,
    expected_label_column: str | None,
    profile_key_column: str | None,
    original_filename: str,
) -> EmotionExperimentRun:
    run = EmotionExperimentRun(
        original_filename=original_filename,
        output_filename=result.fileName,
        text_column=text_column,
        conversation_id_column=conversation_id_column,
        speaker_column=speaker_column,
        expected_label_column=expected_label_column,
        profile_key_column=profile_key_column,
        detected_columns=result.detectedColumns,
        label_mapping=result.labelMapping,
        rows_processed=result.summary.rowsProcessed,
        rows_skipped=result.summary.rowsSkipped,
        analyzed_rows=result.summary.analyzedRows,
        compared_rows=result.summary.comparedRows,
        matched_rows=result.summary.matchedRows,
        unique_profiles=result.summary.uniqueProfiles,
        unique_conversations=result.summary.uniqueConversations,
        preview_rows=[row.model_dump() for row in result.previewRows],
        csv_content=result.csvContent,
    )
    db.add(run)
    await db.flush()
    return run


async def list_emotion_experiment_runs(
    db: AsyncSession,
    limit: int = 20,
    offset: int = 0,
) -> tuple[list[EmotionExperimentRunItem], int]:
    total = (
        await db.scalar(select(func.count()).select_from(EmotionExperimentRun))
    ) or 0
    result = await db.execute(
        select(EmotionExperimentRun)
        .order_by(EmotionExperimentRun.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    runs = result.scalars().all()
    return [_run_to_item(run) for run in runs], total


async def get_emotion_experiment_run(
    db: AsyncSession,
    run_id: UUID,
) -> EmotionExperimentRun | None:
    result = await db.execute(
        select(EmotionExperimentRun).where(EmotionExperimentRun.id == run_id)
    )
    return result.scalar_one_or_none()


def build_emotion_experiment_detail(run: EmotionExperimentRun) -> EmotionExperimentAnalyzeResponse:
    return EmotionExperimentAnalyzeResponse(
        experimentId=str(run.id),
        fileName=run.output_filename,
        detectedColumns=run.detected_columns,
        labelMapping=run.label_mapping,
        previewRows=run.preview_rows,
        summary=_summary_from_run(run),
        csvContent=run.csv_content,
    )
