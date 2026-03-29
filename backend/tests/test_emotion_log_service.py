from app.schemas.chat import ChatAnalysis, EmotionDetail
from app.schemas.profile import ProfileDelta, UserProfile
from app.services.emotion_log_service import build_emotion_log_payload


def test_build_emotion_log_payload_uses_emotion_detail_and_profile_snapshot():
    analysis = ChatAnalysis(
        intent="help-seeking",
        emotion="confused",
        detectedConcepts=["反向传播"],
        delta=ProfileDelta(cognition=-4, affect=-6, behavior=3),
        emotionDetail=EmotionDetail(
            code="E01",
            name="confused",
            intensity="high",
            legacyEmotion="confused",
            confidence=0.82,
            arousal=0.35,
            valence=-0.55,
            evidence=["还是不理解"],
        ),
    )
    profile = UserProfile(cognition=32, affect=41, behavior=77, lastUpdate=None)

    payload = build_emotion_log_payload(analysis=analysis, current_profile=profile)

    assert payload["intent"] == "help-seeking"
    assert payload["legacy_emotion"] == "confused"
    assert payload["emotion_code"] == "E01"
    assert payload["emotion_name"] == "confused"
    assert payload["intensity"] == "high"
    assert payload["detected_concepts"] == ["反向传播"]
    assert payload["evidence"] == ["还是不理解"]
    assert payload["delta_cognition"] == -4
    assert payload["profile_cognition"] == 32
    assert payload["profile_behavior"] == 77


def test_build_emotion_log_payload_falls_back_when_detail_missing():
    analysis = ChatAnalysis(
        intent="chat",
        emotion="neutral",
        detectedConcepts=[],
        delta=ProfileDelta(cognition=0, affect=0, behavior=0),
        emotionDetail=None,
    )

    payload = build_emotion_log_payload(analysis=analysis, current_profile=None)

    assert payload["emotion_code"] == "E13"
    assert payload["emotion_name"] == "neutral"
    assert payload["intensity"] == "medium"
    assert payload["profile_cognition"] is None
