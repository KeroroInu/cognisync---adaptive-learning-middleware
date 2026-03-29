"""
Emotion Log Service - 情感日志持久化
"""
import uuid
from typing import Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.sql.emotion_log import EmotionLog
from app.schemas.chat import ChatAnalysis
from app.schemas.profile import UserProfile
from app.services.emotion_coding import build_emotion_detail


def build_emotion_log_payload(
    analysis: ChatAnalysis,
    current_profile: Optional[UserProfile] = None,
) -> dict[str, Any]:
    detail = analysis.emotionDetail
    if detail is None:
        detail = build_emotion_detail(legacy=analysis.emotion)

    return {
        "intent": analysis.intent,
        "legacy_emotion": analysis.emotion,
        "emotion_code": detail["code"] if isinstance(detail, dict) else detail.code,
        "emotion_name": detail["name"] if isinstance(detail, dict) else detail.name,
        "intensity": detail["intensity"] if isinstance(detail, dict) else detail.intensity,
        "confidence": detail["confidence"] if isinstance(detail, dict) else detail.confidence,
        "arousal": detail["arousal"] if isinstance(detail, dict) else detail.arousal,
        "valence": detail["valence"] if isinstance(detail, dict) else detail.valence,
        "detected_concepts": list(analysis.detectedConcepts),
        "evidence": (
            list(detail["evidence"]) if isinstance(detail, dict) else list(detail.evidence)
        ),
        "delta_cognition": analysis.delta.cognition,
        "delta_affect": analysis.delta.affect,
        "delta_behavior": analysis.delta.behavior,
        "profile_cognition": current_profile.cognition if current_profile else None,
        "profile_affect": current_profile.affect if current_profile else None,
        "profile_behavior": current_profile.behavior if current_profile else None,
    }


async def record_emotion_log(
    db: AsyncSession,
    user_id: uuid.UUID,
    session_id: Optional[uuid.UUID],
    message_id: uuid.UUID,
    analysis: ChatAnalysis,
    current_profile: Optional[UserProfile] = None,
) -> EmotionLog:
    payload = build_emotion_log_payload(analysis=analysis, current_profile=current_profile)
    emotion_log = EmotionLog(
        user_id=user_id,
        session_id=session_id,
        message_id=message_id,
        **payload,
    )
    db.add(emotion_log)
    await db.flush()
    return emotion_log
