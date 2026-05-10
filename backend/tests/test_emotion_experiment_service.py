from datetime import datetime, timezone

from app.models.sql import metadata
from app.models.sql.emotion_compare_run import EmotionCompareRun
from app.models.sql.emotion_experiment import EmotionExperimentRun
from app.schemas.admin.emotion_compare import (
    EmotionCompareAnalyzeResponse,
    EmotionCompareDatasetInfo,
    EmotionCompareExportArtifacts,
    EmotionCompareSummaryMetrics,
    EmotionCompareSingleMetrics,
)
from app.schemas.admin.emotion_compare_ablation import EmotionCompareAblationResponse
from app.schemas.admin.emotion_compare_runs import EmotionCompareRunDetail
from app.schemas.admin.emotion_compare_v2 import (
    EmotionCompareAgreementMetrics,
    EmotionCompareAnalyzeResponseV2,
    EmotionCompareConfusionAnalysis,
    EmotionCompareIntensityMetrics,
)
from app.schemas.admin.emotion_experiments import (
    EmotionExperimentAnalyzeResponse,
    EmotionExperimentRow,
    EmotionExperimentSummary,
)
from app.services.emotion_compare_run_service import build_emotion_compare_run_detail
from app.services.emotion_experiment_service import build_emotion_experiment_detail


def test_emotion_compare_run_model_registers_table_and_indexes():
    table = metadata.tables["emotion_compare_runs"]
    index_names = {index.name for index in table.indexes}

    assert EmotionCompareRun.__tablename__ == "emotion_compare_runs"
    assert {"rows_processed", "base_result", "created_at"}.issubset(table.columns.keys())
    assert index_names == {
        "ix_emotion_compare_runs_created_at",
        "ix_emotion_compare_runs_original_filename",
        "ix_emotion_compare_runs_dataset_template_created_at",
        "ix_emotion_compare_runs_task_type_created_at",
    }


def test_build_emotion_compare_run_detail_restores_response_shape():
    base_result = EmotionCompareAnalyzeResponse(
        runId=None,
        datasetInfo=EmotionCompareDatasetInfo(
            datasetName="weibo.csv",
            sourceFormat="csv",
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
            baseline=EmotionCompareSingleMetrics(accuracy=0.5, macroF1=0.4, weightedF1=0.4),
            system=EmotionCompareSingleMetrics(accuracy=1.0, macroF1=1.0, weightedF1=1.0),
        ),
        exportArtifacts=EmotionCompareExportArtifacts(
            comparisonCsvFileName="weibo_compare_results.csv",
            comparisonCsvContent="rowIndex,text\n1,今天真开心\n",
            resultJsonFileName="weibo_compare_results.json",
        ),
    )
    v2_result = EmotionCompareAnalyzeResponseV2(
        base=base_result,
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
    ablation_result = EmotionCompareAblationResponse(
        datasetInfo=base_result.datasetInfo,
        variants=[],
    )
    run = EmotionCompareRun(
        original_filename="weibo.csv",
        dataset_template="weibo_single",
        label_mode="single_label",
        source_format="csv",
        task_type="single_label",
        text_column="content",
        expected_label_column="label",
        expected_label_columns=[],
        positive_label_value=None,
        sample_id_column="id",
        label_mapping={"happy": ["excited"]},
        rows_processed=2,
        rows_skipped=0,
        label_count=2,
        dataset_info=base_result.datasetInfo.model_dump(),
        base_result=base_result.model_dump(),
        v2_result=v2_result.model_dump(),
        ablation_result=ablation_result.model_dump(),
        created_at=datetime.now(timezone.utc),
    )

    detail = build_emotion_compare_run_detail(run)

    assert isinstance(detail, EmotionCompareRunDetail)
    assert detail.originalFilename == "weibo.csv"
    assert detail.baseResult.datasetInfo.datasetTemplate == "weibo_single"
    assert detail.v2Result is not None
    assert detail.v2Result.confusionAnalysis.available is True
    assert detail.ablationResult is not None


def test_build_emotion_experiment_detail_restores_response_shape():
    run = EmotionExperimentRun(
        original_filename="dataset.csv",
        output_filename="dataset_emotion_analysis.csv",
        text_column="text",
        conversation_id_column="dialogue_id",
        speaker_column="speaker",
        expected_label_column="label",
        profile_key_column="user_id",
        detected_columns=["dialogue_id", "speaker", "text", "label"],
        label_mapping={"困惑": ["confused", "e01"]},
        rows_processed=3,
        rows_skipped=1,
        analyzed_rows=2,
        compared_rows=2,
        matched_rows=1,
        unique_profiles=1,
        unique_conversations=1,
        preview_rows=[
            EmotionExperimentRow(
                rowIndex=1,
                profileKey="u1",
                conversationId="c1",
                speaker="student",
                text="我还是不理解反向传播",
                expectedLabel="困惑",
                expectedMatches=True,
                intent="help-seeking",
                emotion="confused",
                emotionCode="E01",
                emotionName="confused",
                intensity="high",
                confidence=0.82,
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
            ).model_dump()
        ],
        csv_content="rowIndex,text\n1,我还是不理解反向传播\n",
        created_at=datetime.now(timezone.utc),
    )

    detail = build_emotion_experiment_detail(run)

    assert isinstance(detail, EmotionExperimentAnalyzeResponse)
    assert detail.fileName == "dataset_emotion_analysis.csv"
    assert detail.labelMapping == {"困惑": ["confused", "e01"]}
    assert detail.summary == EmotionExperimentSummary(
        rowsProcessed=3,
        rowsSkipped=1,
        analyzedRows=2,
        comparedRows=2,
        matchedRows=1,
        uniqueProfiles=1,
        uniqueConversations=1,
    )
    assert detail.previewRows[0].emotionCode == "E01"
