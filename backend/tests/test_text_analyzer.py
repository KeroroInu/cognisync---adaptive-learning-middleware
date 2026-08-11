"""
TextAnalyzer 单元测试
"""
import asyncio
import json

from app.schemas.profile import UserProfile
from app.services.llm_provider import BaseProvider, MockProvider
from app.services.text_analyzer import TextAnalyzer


class StaticProvider(BaseProvider):
    def __init__(self, payload: dict):
        self.payload = payload

    async def complete(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.7,
        max_tokens: int = 1000,
    ) -> str:
        return json.dumps(self.payload, ensure_ascii=False)

    async def health_check(self) -> bool:
        return True


class BrokenProvider(BaseProvider):
    async def complete(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.7,
        max_tokens: int = 1000,
    ) -> str:
        return "not-json"

    async def health_check(self) -> bool:
        return True


def run_async(coro):
    return asyncio.run(coro)


def test_help_seeking_intent_includes_emotion_detail():
    analyzer = TextAnalyzer(provider=MockProvider())
    result = run_async(analyzer.analyze("我对反向传播还是不理解，能再解释一下吗？"))

    assert result.intent == "help-seeking"
    assert result.emotion == "confused"
    assert result.emotionDetail is not None
    assert result.emotionDetail.code == "E01"
    assert result.emotionDetail.legacyEmotion == "confused"
    assert result.emotionDetail.intensity in {"medium", "high"}
    assert "反向传播" in result.detectedConcepts
    assert -10 <= result.delta.cognition <= 10
    assert -10 <= result.delta.affect <= 10
    assert -10 <= result.delta.behavior <= 10


def test_exploration_intent_keeps_detail_and_concepts():
    analyzer = TextAnalyzer(provider=MockProvider())
    result = run_async(analyzer.analyze("我想学习神经网络和深度学习，有什么好的入门资料吗？"))

    assert result.intent == "exploration"
    assert result.emotion in {"curious", "motivated"}
    assert result.emotionDetail is not None
    assert result.emotionDetail.code in {"E02", "E08"}
    assert result.delta.affect >= 0
    assert result.delta.behavior >= 0
    assert any(concept in result.detectedConcepts for concept in ["神经网络", "深度学习"])


def test_profile_context_promotes_confused_for_low_cognition_high_behavior():
    analyzer = TextAnalyzer(
        provider=StaticProvider(
            {
                "intent": "help-seeking",
                "emotion": "anxious",
                "emotionDetail": {"code": "E04", "intensity": "medium", "confidence": 0.62},
                "detectedConcepts": ["梯度下降"],
                "delta": {"cognition": -1, "affect": -2, "behavior": 1},
                "evidence": {
                    "spans": [{"text": "还是不会", "label": "difficulty", "start": 0, "end": 4}],
                    "confidence": 0.62,
                },
            }
        )
    )

    result = run_async(
        analyzer.analyze(
            "我还是不会梯度下降",
            current_profile=UserProfile(cognition=28, affect=45, behavior=82, lastUpdate=None),
        )
    )

    assert result.emotion == "confused"
    assert result.emotionDetail is not None
    assert result.emotionDetail.code == "E01"
    assert result.delta.cognition <= -1
    assert result.delta.behavior <= 1


def test_help_seeking_question_does_not_auto_boost_behavior():
    analyzer = TextAnalyzer(
        provider=StaticProvider(
            {
                "intent": "help-seeking",
                "emotion": "confused",
                "emotionDetail": {"code": "E01", "intensity": "medium", "confidence": 0.7},
                "detectedConcepts": ["Django"],
                "delta": {"cognition": -2, "affect": -3, "behavior": 10},
                "evidence": {
                    "spans": [{"text": "怎么保存", "label": "question", "start": 0, "end": 4}],
                    "confidence": 0.7,
                },
            }
        )
    )

    result = run_async(analyzer.analyze("Django 表单数据怎么保存到数据库？"))

    assert result.intent == "help-seeking"
    assert result.delta.behavior <= 1


def test_exploration_question_is_not_promoted_by_existing_high_behavior():
    analyzer = TextAnalyzer(
        provider=StaticProvider(
            {
                "intent": "exploration",
                "emotion": "curious",
                "emotionDetail": {"code": "E02", "intensity": "medium", "confidence": 0.7},
                "detectedConcepts": ["Django"],
                "delta": {"cognition": 0, "affect": 3, "behavior": 10},
                "evidence": {
                    "spans": [{"text": "想了解", "label": "exploration", "start": 0, "end": 3}],
                    "confidence": 0.7,
                },
            }
        )
    )

    result = run_async(
        analyzer.analyze(
            "我想了解 Django 表单，有什么入门资料吗？",
            current_profile=UserProfile(cognition=60, affect=72, behavior=90, lastUpdate=None),
        )
    )

    assert result.intent == "exploration"
    assert result.delta.behavior <= 2


def test_profile_context_promotes_discouraged_for_low_cognition_low_behavior():
    analyzer = TextAnalyzer(
        provider=StaticProvider(
            {
                "intent": "help-seeking",
                "emotion": "neutral",
                "emotionDetail": {"code": "E13", "intensity": "medium", "confidence": 0.58},
                "detectedConcepts": [],
                "delta": {"cognition": -1, "affect": -1, "behavior": 0},
                "evidence": {
                    "spans": [{"text": "算了", "label": "withdrawal", "start": 0, "end": 2}],
                    "confidence": 0.58,
                },
            }
        )
    )

    result = run_async(
        analyzer.analyze(
            "算了我不想继续了",
            current_profile=UserProfile(cognition=20, affect=38, behavior=25, lastUpdate=None),
        )
    )

    assert result.emotion == "frustrated"
    assert result.emotionDetail is not None
    assert result.emotionDetail.code == "E11"
    assert result.delta.affect <= -4
    assert result.delta.behavior <= -3


def test_invalid_llm_response_falls_back_and_keeps_emotion_detail():
    analyzer = TextAnalyzer(provider=BrokenProvider())
    result = run_async(analyzer.analyze("我计划这周掌握梯度下降算法"))

    assert result.intent == "goal-setting"
    assert result.emotion == "motivated"
    assert result.emotionDetail is not None
    assert result.emotionDetail.code == "E08"
    assert result.delta.behavior > 0


def test_detected_concepts_are_trimmed_before_graph_persistence():
    analyzer = TextAnalyzer(
        provider=StaticProvider(
            {
                "intent": "exploration",
                "emotion": "curious",
                "detectedConcepts": ["  Python  ", "   ", "Python"],
                "delta": {"cognition": 0, "affect": 1, "behavior": 1},
            }
        )
    )

    result = run_async(analyzer.analyze("我想了解 Python"))

    assert result.detectedConcepts == ["Python"]
