"""
Text Analyzer - 文本分析服务
使用 LLM 分析用户消息，提取意图、情感、概念和画像增量
"""
import logging
import json
import re
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field, ValidationError

from app.services.llm_provider import BaseProvider, get_provider
from app.schemas.chat import ChatAnalysis
from app.schemas.profile import ProfileDelta

logger = logging.getLogger(__name__)


# 意图枚举（可扩展）
VALID_INTENTS = {
    "help-seeking",      # 寻求帮助
    "goal-setting",      # 设定目标
    "reflection",        # 反思总结
    "chat",              # 闲聊
    "exploration",       # 探索学习
    "confirmation",      # 确认理解
    "challenge",         # 质疑挑战
    "application",       # 应用实践
}

# 情感枚举（基于 Plutchik 情感轮简化版）
VALID_EMOTIONS = {
    "confused",          # 困惑
    "neutral",           # 中性
    "frustrated",        # 沮丧
    "curious",           # 好奇
    "excited",           # 兴奋
    "confident",         # 自信
    "anxious",           # 焦虑
    "satisfied",         # 满意
    "motivated",         # 有动力
    "thoughtful",        # 深思
}


class Evidence(BaseModel):
    """证据结构（用于可解释性）"""
    spans: List[Dict[str, Any]] = Field(default_factory=list, description="文本片段标注")
    confidence: float = Field(ge=0.0, le=1.0, description="置信度 [0-1]")


class AnalysisResult(BaseModel):
    """完整的分析结果（包含 evidence）"""
    intent: str
    emotion: str
    detectedConcepts: List[str]
    delta: ProfileDelta
    evidence: Evidence


class TextAnalyzer:
    """文本分析器"""

    # System Prompt - 指导 LLM 返回结构化 JSON
    SYSTEM_PROMPT = """你是一个教育心理学专家，负责分析学习者的对话消息。

请严格按照以下 JSON 格式输出分析结果（不要添加任何额外的文字说明）：

```json
{
  "intent": "意图类型（从以下选择）: help-seeking | goal-setting | reflection | chat | exploration | confirmation | challenge | application",
  "emotion": "情感状态（从以下选择）: confused | neutral | frustrated | curious | excited | confident | anxious | satisfied | motivated | thoughtful",
  "detectedConcepts": ["概念1", "概念2"],
  "delta": {
    "cognition": 整数 [-10 到 +10]（认知维度变化：正数表示提升，负数表示困惑/退步）,
    "affect": 整数 [-10 到 +10]（情感维度变化：正数表示积极情绪，负数表示消极情绪）,
    "behavior": 整数 [-10 到 +10]（行为维度变化：正数表示主动参与，负数表示被动/逃避）
  },
  "evidence": {
    "spans": [{"text": "关键文本片段", "label": "标签", "start": 起始位置, "end": 结束位置}],
    "confidence": 0.85
  }
}
```

**分析维度说明：**

1. **intent（意图）**：用户的主要意图是什么？
   - help-seeking: 寻求帮助、不理解、请求解释
   - exploration: 探索新知识、主动学习
   - reflection: 反思总结、自我评估
   - goal-setting: 设定学习目标、制定计划
   - confirmation: 确认理解、验证认知
   - challenge: 质疑观点、提出反驳
   - application: 应用知识、实践操作
   - chat: 闲聊、寒暄

2. **emotion（情感）**：用户的情感状态？
   - confused: 困惑、迷茫
   - curious: 好奇、感兴趣
   - frustrated: 沮丧、受挫
   - excited: 兴奋、热情
   - confident: 自信、笃定
   - anxious: 焦虑、担忧
   - neutral: 中性、平淡
   - satisfied: 满意、满足
   - motivated: 有动力、积极
   - thoughtful: 深思、沉思

3. **detectedConcepts（概念）**：提取消息中涉及的学科概念（如"神经网络"、"反向传播"等）

4. **delta（画像增量）**：这条消息对学习者三维画像的影响
   - cognition: 认知维度（理解程度、知识掌握）
   - affect: 情感维度（学习情绪、动机状态）
   - behavior: 行为维度（参与度、主动性）

5. **evidence（证据）**：支持你分析结论的关键文本片段和置信度

**重要：只输出 JSON，不要添加任何其他文字！**"""

    def __init__(self, provider: Optional[BaseProvider] = None):
        """
        初始化文本分析器

        Args:
            provider: LLM Provider（如不提供则使用默认配置）
        """
        self.provider = provider or get_provider()
        logger.info(f"TextAnalyzer initialized with provider: {type(self.provider).__name__}")

    async def analyze(
        self,
        user_message: str,
        recent_messages: Optional[List[Dict[str, str]]] = None,
    ) -> ChatAnalysis:
        """
        分析用户消息

        Args:
            user_message: 用户消息文本
            recent_messages: 最近的对话历史（可选）[{"role": "user"|"assistant", "text": "..."}]

        Returns:
            ChatAnalysis 对象（符合前端契约）
        """
        logger.info(f"Analyzing message: {user_message[:100]}...")

        # 构建用户提示词（包含上下文）
        user_prompt = self._build_user_prompt(user_message, recent_messages)

        try:
            # 调用 LLM 分析
            llm_response = await self.provider.complete(
                system_prompt=self.SYSTEM_PROMPT,
                user_prompt=user_prompt,
                temperature=0.3,  # 较低温度以获得更稳定的 JSON 输出
                max_tokens=800,
            )

            # 解析 LLM 返回的 JSON
            analysis = self._parse_llm_response(llm_response)

            logger.info(
                f"LLM analysis successful: intent={analysis.intent}, "
                f"emotion={analysis.emotion}, concepts={len(analysis.detectedConcepts)}"
            )

            # 转换为前端 Schema（去掉 evidence）
            return ChatAnalysis(
                intent=analysis.intent,
                emotion=analysis.emotion,
                detectedConcepts=analysis.detectedConcepts,
                delta=analysis.delta,
            )

        except Exception as e:
            logger.warning(f"LLM analysis failed, falling back to rule-based: {e}")

            # Fallback 到基于规则的分析
            analysis = self._fallback_rule_based(user_message)

            return ChatAnalysis(
                intent=analysis["intent"],
                emotion=analysis["emotion"],
                detectedConcepts=analysis["detectedConcepts"],
                delta=ProfileDelta(**analysis["delta"]),
            )

    def _build_user_prompt(
        self,
        user_message: str,
        recent_messages: Optional[List[Dict[str, str]]] = None,
    ) -> str:
        """构建用户提示词（包含上下文）"""

        prompt_parts = []

        # 添加对话历史（如果有）
        if recent_messages and len(recent_messages) > 0:
            prompt_parts.append("**对话历史：**")
            for msg in recent_messages[-3:]:  # 只取最近 3 条
                role = "用户" if msg["role"] == "user" else "助手"
                prompt_parts.append(f"{role}: {msg['text']}")
            prompt_parts.append("")

        # 添加当前消息
        prompt_parts.append("**当前消息（需要分析）：**")
        prompt_parts.append(user_message)

        return "\n".join(prompt_parts)

    def _parse_llm_response(self, llm_response: str) -> AnalysisResult:
        """
        解析 LLM 返回的 JSON

        Args:
            llm_response: LLM 返回的文本

        Returns:
            AnalysisResult 对象

        Raises:
            ValueError: 如果解析失败
        """
        # 提取 JSON（可能包含在 markdown 代码块中）
        json_text = self._extract_json(llm_response)

        try:
            data = json.loads(json_text)
        except json.JSONDecodeError as e:
            logger.error(f"JSON decode error: {e}\nRaw response: {llm_response}")
            raise ValueError(f"Invalid JSON from LLM: {e}")

        # 验证和清洗数据
        data = self._validate_and_clean(data)

        # 使用 Pydantic 验证
        try:
            analysis = AnalysisResult(**data)
            return analysis
        except ValidationError as e:
            logger.error(f"Pydantic validation error: {e}\nData: {data}")
            raise ValueError(f"Invalid analysis structure: {e}")

    def _extract_json(self, text: str) -> str:
        """
        从文本中提取 JSON（处理 markdown 代码块等情况）

        Args:
            text: 包含 JSON 的文本

        Returns:
            纯 JSON 字符串
        """
        # 尝试提取 markdown 代码块中的 JSON
        match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
        if match:
            return match.group(1)

        # 尝试提取第一个 JSON 对象
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            return match.group(0)

        # 如果都失败，返回原文本
        return text.strip()

    def _validate_and_clean(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        验证和清洗 LLM 返回的数据

        Args:
            data: 原始数据字典

        Returns:
            清洗后的数据字典
        """
        # 验证必需字段
        required_fields = ["intent", "emotion", "detectedConcepts", "delta"]
        for field in required_fields:
            if field not in data:
                raise ValueError(f"Missing required field: {field}")

        # 验证 intent
        if data["intent"] not in VALID_INTENTS:
            logger.warning(f"Invalid intent: {data['intent']}, defaulting to 'chat'")
            data["intent"] = "chat"

        # 验证 emotion
        if data["emotion"] not in VALID_EMOTIONS:
            logger.warning(f"Invalid emotion: {data['emotion']}, defaulting to 'neutral'")
            data["emotion"] = "neutral"

        # 确保 detectedConcepts 是列表
        if not isinstance(data["detectedConcepts"], list):
            data["detectedConcepts"] = []

        # 验证 delta
        delta = data["delta"]
        for dim in ["cognition", "affect", "behavior"]:
            if dim not in delta:
                delta[dim] = 0
            else:
                # 限制范围在 [-10, +10]
                delta[dim] = max(-10, min(10, int(delta[dim])))

        # 确保 evidence 存在
        if "evidence" not in data:
            data["evidence"] = {"spans": [], "confidence": 0.5}

        # 验证 evidence.confidence
        if "confidence" not in data["evidence"]:
            data["evidence"]["confidence"] = 0.5
        else:
            data["evidence"]["confidence"] = max(0.0, min(1.0, float(data["evidence"]["confidence"])))

        return data

    def _fallback_rule_based(self, user_message: str) -> Dict[str, Any]:
        """
        基于规则的 Fallback 分析（当 LLM 失败时使用）

        Args:
            user_message: 用户消息

        Returns:
            分析结果字典
        """
        logger.info("Using rule-based fallback analysis")

        result = {
            "intent": "chat",
            "emotion": "neutral",
            "detectedConcepts": [],
            "delta": {"cognition": 0, "affect": 0, "behavior": 0},
        }

        message_lower = user_message.lower()

        # 意图识别规则
        if any(word in message_lower for word in ["不懂", "不理解", "不会", "怎么", "为什么", "help", "?"]):
            result["intent"] = "help-seeking"
            result["emotion"] = "confused"
            result["delta"] = {"cognition": -5, "affect": -8, "behavior": 5}

        elif any(word in message_lower for word in ["学习", "想学", "了解", "掌握", "learn", "study"]):
            result["intent"] = "exploration"
            result["emotion"] = "curious"
            result["delta"] = {"cognition": 0, "affect": 5, "behavior": 10}

        elif any(word in message_lower for word in ["我觉得", "我认为", "我的理解", "总结", "反思"]):
            result["intent"] = "reflection"
            result["emotion"] = "thoughtful"
            result["delta"] = {"cognition": 5, "affect": 3, "behavior": 2}

        elif any(word in message_lower for word in ["目标", "计划", "打算", "准备", "goal", "plan"]):
            result["intent"] = "goal-setting"
            result["emotion"] = "motivated"
            result["delta"] = {"cognition": 2, "affect": 8, "behavior": 10}

        elif any(word in message_lower for word in ["是不是", "对吗", "正确吗", "确认"]):
            result["intent"] = "confirmation"
            result["emotion"] = "anxious"
            result["delta"] = {"cognition": 1, "affect": -2, "behavior": 3}

        # 概念检测（简单关键词匹配）
        concepts = [
            "神经网络", "反向传播", "梯度下降", "激活函数", "过拟合", "欠拟合",
            "深度学习", "机器学习", "卷积", "循环神经网络", "RNN", "CNN",
            "注意力机制", "Transformer", "LSTM", "GRU", "Dropout", "Batch Normalization",
            "优化器", "损失函数", "正则化", "数据增强", "迁移学习",
        ]

        detected = [concept for concept in concepts if concept in user_message]
        result["detectedConcepts"] = detected

        # 如果检测到概念，调整认知维度
        if detected:
            result["delta"]["cognition"] += min(3, len(detected))

        return result
