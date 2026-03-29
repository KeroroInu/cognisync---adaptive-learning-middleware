import asyncio

from app.services.emotion_dataset_service import analyze_dataset_csv
from app.services.llm_provider import MockProvider


def run_async(coro):
    return asyncio.run(coro)


def test_analyze_dataset_csv_generates_rows_profiles_and_csv():
    csv_content = (
        "dialogue_id,speaker,text,label\n"
        "c1,student,我还是不理解反向传播,confused\n"
        "c1,student,我计划这周掌握梯度下降,motivated\n"
    )

    result = run_async(
        analyze_dataset_csv(
            csv_content=csv_content,
            filename="demo.csv",
            text_column="text",
            conversation_id_column="dialogue_id",
            speaker_column="speaker",
            expected_label_column="label",
            provider=MockProvider(),
            preview_limit=10,
        )
    )

    assert result.fileName == "demo_emotion_analysis.csv"
    assert result.detectedColumns == ["dialogue_id", "speaker", "text", "label"]
    assert result.summary.rowsProcessed == 2
    assert result.summary.analyzedRows == 2
    assert result.summary.rowsSkipped == 0
    assert result.summary.uniqueConversations == 1
    assert result.summary.uniqueProfiles == 1
    assert len(result.previewRows) == 2
    assert "emotionCode" in result.csvContent
    assert result.previewRows[0].emotion == "confused"
    assert result.previewRows[0].profileCognitionAfter <= result.previewRows[0].profileCognitionBefore
    assert result.previewRows[1].profileBehaviorAfter >= result.previewRows[1].profileBehaviorBefore


def test_analyze_dataset_csv_supports_profile_key_and_skips_empty_rows():
    csv_content = (
        "user_id,dialogue_id,text\n"
        "u1,c1,\n"
        "u1,c1,我想学习神经网络\n"
        "u2,c2,我觉得过拟合是记住了噪声\n"
    )

    result = run_async(
        analyze_dataset_csv(
            csv_content=csv_content,
            filename="profiles.csv",
            text_column="text",
            conversation_id_column="dialogue_id",
            profile_key_column="user_id",
            provider=MockProvider(),
            preview_limit=10,
        )
    )

    assert result.summary.rowsProcessed == 3
    assert result.summary.rowsSkipped == 1
    assert result.summary.analyzedRows == 2
    assert result.summary.uniqueProfiles == 2
    assert result.previewRows[0].profileKey == "u1"
    assert result.previewRows[1].profileKey == "u2"


def test_analyze_dataset_csv_supports_label_mapping():
    csv_content = (
        "dialogue_id,text,label\n"
        "c1,我还是不理解反向传播,困惑\n"
    )

    result = run_async(
        analyze_dataset_csv(
            csv_content=csv_content,
            filename="mapping.csv",
            text_column="text",
            conversation_id_column="dialogue_id",
            expected_label_column="label",
            label_mapping={"困惑": ["confused", "E01"]},
            provider=MockProvider(),
            preview_limit=10,
        )
    )

    assert result.labelMapping == {"困惑": ["confused", "e01"]}
    assert result.summary.comparedRows == 1
    assert result.summary.matchedRows == 1
    assert result.previewRows[0].expectedMatches is True


def test_analyze_dataset_csv_supports_multi_binary_label_columns():
    csv_content = (
        "text,joy,confused,anger\n"
        "我还是不理解反向传播,0,1,0\n"
        "这周我很想把模型跑通,1,0,0\n"
    )

    result = run_async(
        analyze_dataset_csv(
            csv_content=csv_content,
            filename="multilabel.csv",
            text_column="text",
            expected_label_columns=["joy", "confused", "anger"],
            positive_label_value="1",
            label_mapping={
                "joy": ["motivated", "confident", "E08", "E06"],
                "confused": ["confused", "E01"],
            },
            provider=MockProvider(),
            preview_limit=10,
        )
    )

    assert result.summary.rowsProcessed == 2
    assert result.summary.comparedRows == 2
    assert result.summary.matchedRows == 1
    assert result.previewRows[0].expectedLabels == ["confused"]
    assert result.previewRows[0].expectedLabel == "confused"
    assert result.previewRows[1].expectedLabels == ["joy"]
    assert result.previewRows[1].expectedMatches is False
