from app.services.emotion_coding import build_emotion_detail, infer_emotion_code, normalize_intensity


def test_infer_emotion_code_from_legacy_emotion():
    assert infer_emotion_code(legacy="confused") == "E01"
    assert infer_emotion_code(legacy="satisfied") == "E12"
    assert infer_emotion_code(legacy="unknown") == "E13"


def test_neutral_intensity_is_normalized_to_medium():
    assert normalize_intensity("high", emotion_code="E13") == "medium"
    assert normalize_intensity("weak", emotion_code="E01") == "low"


def test_build_emotion_detail_generates_legacy_mapping_and_clamped_scores():
    detail = build_emotion_detail(
        code="E10",
        intensity="strong",
        confidence=1.3,
        arousal=1.7,
        valence=-1.5,
        evidence=["信息量太大"],
    )

    assert detail["name"] == "overwhelmed"
    assert detail["legacyEmotion"] == "frustrated"
    assert detail["intensity"] == "high"
    assert detail["confidence"] == 1.0
    assert detail["arousal"] == 1.0
    assert detail["valence"] == -1.0
    assert detail["evidence"] == ["信息量太大"]
