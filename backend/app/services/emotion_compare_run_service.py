"""
Emotion Compare Run Service - 情感对比实验运行记录持久化与查询
"""
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.sql.emotion_compare_run import EmotionCompareRun
from app.schemas.admin.emotion_compare import EmotionCompareAnalyzeResponse
from app.schemas.admin.emotion_compare_ablation import EmotionCompareAblationResponse
from app.schemas.admin.emotion_compare_runs import EmotionCompareRunDetail, EmotionCompareRunItem
from app.schemas.admin.emotion_compare_v2 import EmotionCompareAnalyzeResponseV2


async def save_emotion_compare_run(
    db: AsyncSession,
    *,
    original_filename: str,
    label_mode: str,
    label_mapping: dict[str, str | list[str]] | None,
    base_result: EmotionCompareAnalyzeResponse,
    v2_result: EmotionCompareAnalyzeResponseV2 | None,
    ablation_result: EmotionCompareAblationResponse | None,
) -> EmotionCompareRun:
    dataset_info = base_result.datasetInfo
    run = EmotionCompareRun(
        original_filename=original_filename,
        dataset_template=dataset_info.datasetTemplate,
        label_mode=label_mode,
        source_format=dataset_info.sourceFormat,
        task_type=dataset_info.taskType,
        text_column=dataset_info.textColumn,
        expected_label_column=dataset_info.expectedLabelColumn,
        expected_label_columns=dataset_info.expectedLabelColumns,
        positive_label_value=dataset_info.positiveLabelValue,
        sample_id_column=dataset_info.sampleIdColumn,
        label_mapping=label_mapping or {},
        rows_processed=dataset_info.rowsProcessed,
        rows_skipped=dataset_info.rowsSkipped,
        label_count=dataset_info.labelCount,
        dataset_info=dataset_info.model_dump(),
        base_result=base_result.model_dump(),
        v2_result=v2_result.model_dump() if v2_result else None,
        ablation_result=ablation_result.model_dump() if ablation_result else None,
    )
    db.add(run)
    await db.flush()
    return run


def _build_run_item(run: EmotionCompareRun) -> EmotionCompareRunItem:
    summary_metrics = EmotionCompareAnalyzeResponse.model_validate(run.base_result).summaryMetrics
    return EmotionCompareRunItem(
        id=str(run.id),
        originalFilename=run.original_filename,
        datasetTemplate=run.dataset_template,
        labelMode=run.label_mode,
        sourceFormat=run.source_format,
        taskType=run.task_type,
        textColumn=run.text_column,
        expectedLabelColumn=run.expected_label_column,
        expectedLabelColumns=run.expected_label_columns,
        sampleIdColumn=run.sample_id_column,
        summaryMetrics=summary_metrics,
        createdAt=run.created_at.isoformat(),
    )


async def list_emotion_compare_runs(
    db: AsyncSession,
    limit: int,
    offset: int,
) -> tuple[list[EmotionCompareRunItem], int]:
    total_result = await db.execute(
        select(func.count()).select_from(EmotionCompareRun)
    )
    total = total_result.scalar_one()

    rows_result = await db.execute(
        select(EmotionCompareRun)
        .order_by(EmotionCompareRun.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    runs = rows_result.scalars().all()
    return ([_build_run_item(run) for run in runs], total)


async def get_emotion_compare_run(
    db: AsyncSession,
    run_id: UUID,
) -> EmotionCompareRun | None:
    result = await db.execute(
        select(EmotionCompareRun).where(EmotionCompareRun.id == run_id)
    )
    return result.scalar_one_or_none()


def build_emotion_compare_run_detail(run: EmotionCompareRun) -> EmotionCompareRunDetail:
    return EmotionCompareRunDetail(
        id=str(run.id),
        originalFilename=run.original_filename,
        datasetTemplate=run.dataset_template,
        labelMode=run.label_mode,
        sourceFormat=run.source_format,
        taskType=run.task_type,
        textColumn=run.text_column,
        expectedLabelColumn=run.expected_label_column,
        expectedLabelColumns=run.expected_label_columns,
        positiveLabelValue=run.positive_label_value,
        sampleIdColumn=run.sample_id_column,
        labelMapping=run.label_mapping,
        baseResult=EmotionCompareAnalyzeResponse.model_validate(run.base_result),
        v2Result=(
            EmotionCompareAnalyzeResponseV2.model_validate(run.v2_result)
            if run.v2_result is not None
            else None
        ),
        ablationResult=(
            EmotionCompareAblationResponse.model_validate(run.ablation_result)
            if run.ablation_result is not None
            else None
        ),
        createdAt=run.created_at.isoformat(),
    )
