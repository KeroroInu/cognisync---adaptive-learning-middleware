"""
Text Analyzer - 文本分析服务
使用 LLM 分析用户消息，提取意图、情感、概念和画像增量
"""
import json
import logging
import re
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, ValidationError

from app.schemas.chat import ChatAnalysis, EmotionDetail
from app.schemas.profile import ProfileDelta, UserProfile
from app.services.emotion_coding import (
    VALID_LEGACY_EMOTIONS,
    build_emotion_detail,
    clamp_confidence,
)
from app.services.llm_config import get_analysis_provider
from app.services.llm_provider import BaseProvider

logger = logging.getLogger(__name__)

VALID_INTENTS = {
    "help-seeking",
    "goal-setting",
    "reflection",
    "chat",
    "exploration",
    "confirmation",
    "challenge",
    "application",
}


class Evidence(BaseModel):
    """证据结构"""

    spans: List[Dict[str, Any]] = Field(default_factory=list, description="文本片段标注")
    confidence: float = Field(ge=0.0, le=1.0, description="置信度 [0-1]")


class EmotionDetailResult(BaseModel):
    """模型返回的详细情感结构"""

    code: Optional[str] = None
    name: Optional[str] = None
    intensity: Optional[str] = None
    confidence: Optional[float] = None
    arousal: Optional[float] = None
    valence: Optional[float] = None
    evidence: List[str] = Field(default_factory=list)


class AnalysisResult(BaseModel):
    """完整分析结果"""

    intent: str
    emotion: str
    detectedConcepts: List[str]
    delta: ProfileDelta
    evidence: Evidence
    emotionDetail: EmotionDetail


class TextAnalyzer:
    """文本分析器"""

    SYSTEM_PROMPT = """你是一个教育心理学专家，负责分析学习者消息。

你需要结合以下信息综合判断：
1. 当前消息文本
2. 最近对话上下文
3. 学习者当前三维画像，尤其是 cognition 和 behavior

请注意：
- 低 cognition + 高 behavior 往往意味着“愿意学但还没理解”，优先考虑 confused 而不是单纯 anxious
- 低 cognition + 低 behavior 且语言消极时，优先考虑 discouraged / overwhelmed / frustrated
- 高 cognition + 高 behavior 且语言带有总结、确认、应用倾向时，优先考虑 confident / thoughtful / motivated
- 保留旧 emotion 字段用于兼容，但详细结果必须写到 emotionDetail 中

只输出 JSON，不要输出额外说明。格式如下：

```json
{
  "intent": "help-seeking | goal-setting | reflection | chat | exploration | confirmation | challenge | application",
  "emotion": "confused | neutral | frustrated | curious | excited | confident | anxious | satisfied | motivated | thoughtful",
  "emotionDetail": {
    "code": "E01-E13",
    "name": "confused | curious | frustrated | anxious | encouraged | confident | excited | motivated | thoughtful | overwhelmed | discouraged | relieved | neutral",
    "intensity": "low | medium | high",
    "confidence": 0.85,
    "arousal": -1 到 1,
    "valence": -1 到 1,
    "evidence": ["支持情感判断的简短证据1", "证据2"]
  },
  "detectedConcepts": ["概念1", "概念2"],
  "delta": {
    "cognition": 整数 [-10 到 10],
    "affect": 整数 [-10 到 10],
    "behavior": 整数 [-10 到 10]
  },
  "evidence": {
    "spans": [{"text": "关键文本片段", "label": "标签", "start": 0, "end": 4}],
    "confidence": 0.85
  }
}
```
"""

    def __init__(self, provider: Optional[BaseProvider] = None):
        self.provider = provider or get_analysis_provider()
        logger.info("TextAnalyzer initialized with provider: %s", type(self.provider).__name__)

    async def analyze(
        self,
        user_message: str,
        recent_messages: Optional[List[Dict[str, str]]] = None,
        current_profile: Optional[UserProfile] = None,
    ) -> ChatAnalysis:
        """
        分析用户消息
        """
        logger.info("Analyzing message: %s...", user_message[:100])
        user_prompt = self._build_user_prompt(
            user_message=user_message,
            recent_messages=recent_messages,
            current_profile=current_profile,
        )

        try:
            llm_response = await self.provider.complete(
                system_prompt=self.SYSTEM_PROMPT,
                user_prompt=user_prompt,
                temperature=0.3,
                max_tokens=1000,
            )
            analysis = self._parse_llm_response(llm_response)
            chat_analysis = self._build_chat_analysis(analysis, current_profile=current_profile)
            logger.info(
                "LLM analysis successful: intent=%s, emotion=%s, detail=%s",
                chat_analysis.intent,
                chat_analysis.emotion,
                chat_analysis.emotionDetail.code if chat_analysis.emotionDetail else "none",
            )
            return chat_analysis
        except Exception as exc:
            logger.warning("LLM analysis failed, falling back to rule-based: %s", exc)
            fallback = self._fallback_rule_based(user_message)
            analysis = AnalysisResult(
                intent=fallback["intent"],
                emotion=fallback["emotion"],
                detectedConcepts=fallback["detectedConcepts"],
                delta=ProfileDelta(**fallback["delta"]),
                evidence=Evidence(spans=[], confidence=0.55),
                emotionDetail=EmotionDetail(**fallback["emotionDetail"]),
            )
            return self._build_chat_analysis(analysis, current_profile=current_profile)

    def _build_user_prompt(
        self,
        user_message: str,
        recent_messages: Optional[List[Dict[str, str]]] = None,
        current_profile: Optional[UserProfile] = None,
    ) -> str:
        prompt_parts: List[str] = []

        if current_profile:
            prompt_parts.append("**学习者当前画像：**")
            prompt_parts.append(
                f"cognition={current_profile.cognition}, affect={current_profile.affect}, behavior={current_profile.behavior}"
            )
            prompt_parts.append(
                "请把 cognition 与 behavior 当作长期状态参考，不要直接照抄为情感标签。"
            )
            prompt_parts.append("")

        if recent_messages:
            prompt_parts.append("**最近对话历史：**")
            for msg in recent_messages[-4:]:
                role = "用户" if msg["role"] == "user" else "助手"
                prompt_parts.append(f"{role}: {msg['text']}")
            prompt_parts.append("")

        prompt_parts.append("**当前消息（需要分析）：**")
        prompt_parts.append(user_message)
        return "\n".join(prompt_parts)

    def _parse_llm_response(self, llm_response: str) -> AnalysisResult:
        json_text = self._extract_json(llm_response)

        try:
            data = json.loads(json_text)
        except json.JSONDecodeError as exc:
            logger.error("JSON decode error: %s\nRaw response: %s", exc, llm_response)
            raise ValueError(f"Invalid JSON from LLM: {exc}") from exc

        data = self._validate_and_clean(data)

        try:
            return AnalysisResult(**data)
        except ValidationError as exc:
            logger.error("Pydantic validation error: %s\nData: %s", exc, data)
            raise ValueError(f"Invalid analysis structure: {exc}") from exc

    def _extract_json(self, text: str) -> str:
        match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
        if match:
            return match.group(1)

        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            return match.group(0)

        return text.strip()

    def _validate_and_clean(self, data: Dict[str, Any]) -> Dict[str, Any]:
        for field in ["intent", "detectedConcepts", "delta"]:
            if field not in data:
                raise ValueError(f"Missing required field: {field}")

        if data["intent"] not in VALID_INTENTS:
            logger.warning("Invalid intent: %s, defaulting to 'chat'", data["intent"])
            data["intent"] = "chat"

        raw_emotion = str(data.get("emotion", "neutral")).strip().lower()
        if raw_emotion not in VALID_LEGACY_EMOTIONS:
            logger.warning("Invalid legacy emotion: %s, defaulting to 'neutral'", raw_emotion)
            raw_emotion = "neutral"

        if not isinstance(data["detectedConcepts"], list):
            data["detectedConcepts"] = []
        data["detectedConcepts"] = [str(item) for item in data["detectedConcepts"] if str(item).strip()]

        delta = data["delta"] if isinstance(data["delta"], dict) else {}
        for dim in ["cognition", "affect", "behavior"]:
            try:
                delta_value = int(delta.get(dim, 0))
            except (TypeError, ValueError):
                delta_value = 0
            delta[dim] = max(-10, min(10, delta_value))
        data["delta"] = delta

        evidence = data.get("evidence")
        if not isinstance(evidence, dict):
            evidence = {"spans": [], "confidence": 0.5}
        if not isinstance(evidence.get("spans"), list):
            evidence["spans"] = []
        evidence["confidence"] = clamp_confidence(evidence.get("confidence"), default=0.5)
        data["evidence"] = evidence

        raw_detail = data.get("emotionDetail")
        if not isinstance(raw_detail, dict):
            raw_detail = {}

        detail_evidence = raw_detail.get("evidence")
        if not isinstance(detail_evidence, list):
            detail_evidence = self._extract_evidence_texts(evidence.get("spans", []))
        detail_evidence = [str(item) for item in detail_evidence if str(item).strip()]

        data["emotionDetail"] = build_emotion_detail(
            code=raw_detail.get("code"),
            name=raw_detail.get("name"),
            legacy=raw_detail.get("legacyEmotion") or raw_emotion,
            intensity=raw_detail.get("intensity"),
            confidence=raw_detail.get("confidence", evidence["confidence"]),
            arousal=raw_detail.get("arousal"),
            valence=raw_detail.get("valence"),
            evidence=detail_evidence,
        )
        data["emotion"] = data["emotionDetail"]["legacyEmotion"]
        return data

    def _build_chat_analysis(
        self,
        analysis: AnalysisResult,
        current_profile: Optional[UserProfile] = None,
    ) -> ChatAnalysis:
        chat_analysis = ChatAnalysis(
            intent=analysis.intent,
            emotion=analysis.emotion,
            detectedConcepts=analysis.detectedConcepts,
            delta=analysis.delta,
            emotionDetail=analysis.emotionDetail,
        )
        return self._refine_with_profile_context(chat_analysis, current_profile=current_profile)

    def _refine_with_profile_context(
        self,
        analysis: ChatAnalysis,
        current_profile: Optional[UserProfile] = None,
    ) -> ChatAnalysis:
        if not current_profile or not analysis.emotionDetail:
            return analysis

        cognition = current_profile.cognition
        behavior = current_profile.behavior
        detail = analysis.emotionDetail
        delta = analysis.delta.model_copy(deep=True)
        evidence = list(detail.evidence)

        if cognition <= 35 and behavior >= 60 and analysis.intent in {
            "help-seeking",
            "confirmation",
            "exploration",
        }:
            evidence.append("画像提示：低认知但高行为参与")
            refined_detail = EmotionDetail(
                **build_emotion_detail(
                    code="E01",
                    intensity=self._promote_intensity(detail.intensity),
                    confidence=max(detail.confidence, 0.7),
                    evidence=evidence,
                )
            )
            delta.cognition = min(delta.cognition, -2)
            delta.behavior = max(delta.behavior, 3)
            return ChatAnalysis(
                intent=analysis.intent,
                emotion=refined_detail.legacyEmotion,
                detectedConcepts=analysis.detectedConcepts,
                delta=delta,
                emotionDetail=refined_detail,
            )

        if cognition <= 30 and behavior <= 40 and detail.code in {"E01", "E03", "E04", "E10", "E13"}:
            evidence.append("画像提示：低认知且低行为参与")
            refined_detail = EmotionDetail(
                **build_emotion_detail(
                    code="E11",
                    intensity=self._promote_intensity(detail.intensity),
                    confidence=max(detail.confidence, 0.65),
                    evidence=evidence,
                )
            )
            delta.affect = min(delta.affect, -4)
            delta.behavior = min(delta.behavior, -3)
            return ChatAnalysis(
                intent=analysis.intent,
                emotion=refined_detail.legacyEmotion,
                detectedConcepts=analysis.detectedConcepts,
                delta=delta,
                emotionDetail=refined_detail,
            )

        if cognition >= 70 and behavior >= 65 and analysis.intent in {
            "reflection",
            "confirmation",
            "application",
        } and detail.code in {"E09", "E13", "E06"}:
            evidence.append("画像提示：高认知且高行为参与")
            refined_detail = EmotionDetail(
                **build_emotion_detail(
                    code="E06",
                    intensity=self._promote_intensity(detail.intensity),
                    confidence=max(detail.confidence, 0.72),
                    evidence=evidence,
                )
            )
            delta.cognition = max(delta.cognition, 2)
            return ChatAnalysis(
                intent=analysis.intent,
                emotion=refined_detail.legacyEmotion,
                detectedConcepts=analysis.detectedConcepts,
                delta=delta,
                emotionDetail=refined_detail,
            )

        if behavior >= 75 and analysis.intent in {"goal-setting", "exploration", "application"} and detail.code in {
            "E02",
            "E05",
            "E07",
            "E08",
            "E13",
        }:
            evidence.append("画像提示：高行为参与")
            refined_detail = EmotionDetail(
                **build_emotion_detail(
                    code="E08",
                    intensity=self._promote_intensity(detail.intensity),
                    confidence=max(detail.confidence, 0.68),
                    evidence=evidence,
                )
            )
            delta.behavior = max(delta.behavior, 4)
            return ChatAnalysis(
                intent=analysis.intent,
                emotion=refined_detail.legacyEmotion,
                detectedConcepts=analysis.detectedConcepts,
                delta=delta,
                emotionDetail=refined_detail,
            )

        return analysis

    def _promote_intensity(self, intensity: str) -> str:
        if intensity == "low":
            return "medium"
        if intensity == "medium":
            return "high"
        return "high"

    def _extract_evidence_texts(self, spans: List[Dict[str, Any]]) -> List[str]:
        evidence_texts = []
        for span in spans:
            if not isinstance(span, dict):
                continue
            text = str(span.get("text", "")).strip()
            if text:
                evidence_texts.append(text)
        return evidence_texts[:3]

    def _fallback_rule_based(self, user_message: str) -> Dict[str, Any]:
        logger.info("Using rule-based fallback analysis")

        result: Dict[str, Any] = {
            "intent": "chat",
            "emotion": "neutral",
            "detectedConcepts": [],
            "delta": {"cognition": 0, "affect": 0, "behavior": 0},
            "emotionDetail": build_emotion_detail(code="E13", intensity="medium", confidence=0.55),
        }

        message_lower = user_message.lower()

        if any(word in message_lower for word in ["不懂", "不理解", "不会", "怎么", "为什么", "help", "?"]):
            result["intent"] = "help-seeking"
            result["emotion"] = "confused"
            result["delta"] = {"cognition": -5, "affect": -8, "behavior": 5}
            result["emotionDetail"] = build_emotion_detail(
                code="E01",
                intensity="high",
                confidence=0.7,
                evidence=["不懂", "不理解", "怎么"],
            )
        elif any(word in message_lower for word in ["目标", "计划", "打算", "准备", "goal", "plan"]):
            result["intent"] = "goal-setting"
            result["emotion"] = "motivated"
            result["delta"] = {"cognition": 2, "affect": 8, "behavior": 10}
            result["emotionDetail"] = build_emotion_detail(
                code="E08",
                intensity="high",
                confidence=0.68,
                evidence=["目标", "计划", "准备"],
            )
        elif any(word in message_lower for word in ["学习", "想学", "了解", "掌握", "learn", "study"]):
            result["intent"] = "exploration"
            result["emotion"] = "curious"
            result["delta"] = {"cognition": 0, "affect": 5, "behavior": 10}
            result["emotionDetail"] = build_emotion_detail(
                code="E02",
                intensity="medium",
                confidence=0.65,
                evidence=["学习", "想学", "了解"],
            )
        elif any(word in message_lower for word in ["我觉得", "我认为", "我的理解", "总结", "反思"]):
            result["intent"] = "reflection"
            result["emotion"] = "thoughtful"
            result["delta"] = {"cognition": 5, "affect": 3, "behavior": 2}
            result["emotionDetail"] = build_emotion_detail(
                code="E09",
                intensity="medium",
                confidence=0.65,
                evidence=["我觉得", "我的理解"],
            )
        elif any(word in message_lower for word in ["是不是", "对吗", "正确吗", "确认"]):
            result["intent"] = "confirmation"
            result["emotion"] = "anxious"
            result["delta"] = {"cognition": 1, "affect": -2, "behavior": 3}
            result["emotionDetail"] = build_emotion_detail(
                code="E04",
                intensity="medium",
                confidence=0.62,
                evidence=["是不是", "对吗", "确认"],
            )

        concepts = [
            "神经网络",
            "反向传播",
            "梯度下降",
            "激活函数",
            "过拟合",
            "欠拟合",
            "深度学习",
            "机器学习",
            "卷积",
            "循环神经网络",
            "RNN",
            "CNN",
            "注意力机制",
            "Transformer",
            "LSTM",
            "GRU",
            "Dropout",
            "Batch Normalization",
            "优化器",
            "损失函数",
            "正则化",
            "数据增强",
            "迁移学习",
        ]

        detected = [concept for concept in concepts if concept in user_message]
        result["detectedConcepts"] = detected

        if detected:
            result["delta"]["cognition"] += min(3, len(detected))

        return result
