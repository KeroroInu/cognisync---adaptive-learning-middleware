from datetime import datetime, timezone

from app.models.sql.emotion_experiment import EmotionExperimentRun
from app.schemas.admin.emotion_experiments import (
    EmotionExperimentAnalyzeResponse,
    EmotionExperimentRow,
    EmotionExperimentSummary,
)
from app.services.emotion_experiment_service import build_emotion_experiment_detail


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
