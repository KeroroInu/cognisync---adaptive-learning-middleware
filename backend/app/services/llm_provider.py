"""
LLM Provider - 统一的 LLM 接口封装
支持 OpenAI、Ollama、LM Studio 等 OpenAI 兼容接口，以及 Mock 模式
"""
import logging
from abc import ABC, abstractmethod
from typing import Optional, Dict, Any, List
import httpx
import json

from app.core.config import settings

logger = logging.getLogger(__name__)


class BaseProvider(ABC):
    """LLM Provider 基类"""

    @abstractmethod
    async def complete(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.7,
        max_tokens: int = 1000,
    ) -> str:
        """
        完成文本生成

        Args:
            system_prompt: 系统提示词
            user_prompt: 用户提示词
            temperature: 温度参数 (0-2)
            max_tokens: 最大 token 数

        Returns:
            生成的文本
        """
        pass

    @abstractmethod
    async def health_check(self) -> bool:
        """健康检查"""
        pass


class OpenAICompatibleProvider(BaseProvider):
    """
    OpenAI 兼容接口 Provider
    支持 OpenAI、Ollama、LM Studio 等
    """

    def __init__(
        self,
        base_url: str,
        api_key: str,
        model: str,
        timeout: int = 60,
    ):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.timeout = timeout

        # 创建 HTTP 客户端
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(timeout),
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
        )

        logger.info(f"Initialized OpenAICompatibleProvider: {base_url} | {model}")

    async def complete(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.7,
        max_tokens: int = 1000,
    ) -> str:
        """调用 OpenAI 兼容的聊天完成接口"""

        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": temperature,
            "max_tokens": max_tokens,
        }

        try:
            response = await self.client.post(
                f"{self.base_url}/chat/completions",
                json=payload,
            )
            response.raise_for_status()

            data = response.json()

            # 提取生成的文本
            content = data["choices"][0]["message"]["content"]

            logger.debug(
                f"LLM response received: {len(content)} chars, "
                f"model={self.model}, tokens={data.get('usage', {})}"
            )

            return content

        except httpx.HTTPStatusError as e:
            logger.error(f"HTTP error from LLM API: {e.response.status_code} - {e.response.text}")
            raise RuntimeError(f"LLM API request failed: {e}")

        except httpx.RequestError as e:
            logger.error(f"Request error: {e}")
            raise RuntimeError(f"Failed to connect to LLM API: {e}")

        except (KeyError, IndexError) as e:
            logger.error(f"Unexpected API response format: {e}")
            raise RuntimeError(f"Invalid LLM API response: {e}")

    async def health_check(self) -> bool:
        """检查 LLM API 是否可用"""
        try:
            # 发送一个简单的请求测试连接
            response = await self.client.post(
                f"{self.base_url}/chat/completions",
                json={
                    "model": self.model,
                    "messages": [{"role": "user", "content": "Hi"}],
                    "max_tokens": 5,
                },
            )
            response.raise_for_status()
            return True

        except Exception as e:
            logger.warning(f"LLM health check failed: {e}")
            return False

    async def close(self):
        """关闭 HTTP 客户端"""
        await self.client.aclose()


class MockProvider(BaseProvider):
    """
    Mock Provider - 用于离线测试
    返回固定的 JSON 格式响应
    """

    def __init__(self):
        logger.info("Initialized MockProvider (offline mode)")

    async def complete(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.7,
        max_tokens: int = 1000,
    ) -> str:
        """返回模拟的 JSON 响应"""

        # 根据用户消息内容生成不同的模拟响应
        mock_response = self._generate_mock_response(user_prompt)

        logger.debug(f"Mock LLM response: {mock_response}")

        return json.dumps(mock_response, ensure_ascii=False)

    def _generate_mock_response(self, user_prompt: str) -> Dict[str, Any]:
        """根据用户输入生成模拟的分析结果"""

        # 默认响应
        response = {
            "intent": "chat",
            "emotion": "neutral",
            "detectedConcepts": [],
            "delta": {"cognition": 0, "affect": 0, "behavior": 0},
            "evidence": {
                "spans": [],
                "confidence": 0.8,
            },
        }

        # 基于关键词的简单规则
        if any(word in user_prompt for word in ["不懂", "不理解", "不会", "怎么", "为什么"]):
            response["intent"] = "help-seeking"
            response["emotion"] = "confused"
            response["delta"] = {"cognition": -5, "affect": -10, "behavior": 5}
            response["evidence"]["spans"] = [
                {"text": "不懂", "label": "confusion_signal", "start": 0, "end": 2}
            ]

        elif any(word in user_prompt for word in ["学习", "想学", "了解", "掌握"]):
            response["intent"] = "exploration"
            response["emotion"] = "curious"
            response["delta"] = {"cognition": 0, "affect": 5, "behavior": 10}
            response["evidence"]["spans"] = [
                {"text": "学习", "label": "learning_intent", "start": 0, "end": 2}
            ]

        elif any(word in user_prompt for word in ["我觉得", "我认为", "我的理解"]):
            response["intent"] = "reflection"
            response["emotion"] = "thoughtful"
            response["delta"] = {"cognition": 5, "affect": 3, "behavior": 2}

        elif any(word in user_prompt for word in ["目标", "计划", "打算", "准备"]):
            response["intent"] = "goal-setting"
            response["emotion"] = "motivated"
            response["delta"] = {"cognition": 2, "affect": 8, "behavior": 10}

        # 检测概念（简单的关键词匹配）
        concepts = [
            "神经网络",
            "反向传播",
            "梯度下降",
            "激活函数",
            "过拟合",
            "深度学习",
            "机器学习",
            "卷积",
            "循环神经网络",
            "注意力机制",
        ]

        detected = [concept for concept in concepts if concept in user_prompt]
        response["detectedConcepts"] = detected

        if detected:
            # 如果检测到概念，增加认知维度
            response["delta"]["cognition"] += 3

        return response

    async def health_check(self) -> bool:
        """Mock Provider 总是健康"""
        return True


def get_provider() -> BaseProvider:
    """
    工厂函数：根据配置返回对应的 Provider

    Returns:
        BaseProvider 实例
    """
    provider_type = settings.LLM_PROVIDER.lower()

    if provider_type == "mock":
        return MockProvider()

    elif provider_type == "openai":
        return OpenAICompatibleProvider(
            base_url=settings.OPENAI_BASE_URL,
            api_key=settings.OPENAI_API_KEY,
            model=settings.OPENAI_MODEL,
        )

    elif provider_type == "deepseek":
        return OpenAICompatibleProvider(
            base_url=settings.DEEPSEEK_BASE_URL,
            api_key=settings.DEEPSEEK_API_KEY,
            model=settings.DEEPSEEK_MODEL,
        )

    elif provider_type == "ollama":
        return OpenAICompatibleProvider(
            base_url=settings.OLLAMA_BASE_URL,
            api_key="ollama",  # Ollama 不需要真实 API key
            model=settings.OLLAMA_MODEL,
        )

    elif provider_type == "lmstudio":
        return OpenAICompatibleProvider(
            base_url=settings.LMSTUDIO_BASE_URL,
            api_key="lmstudio",  # LM Studio 不需要真实 API key
            model=settings.LMSTUDIO_MODEL,
        )

    else:
        logger.warning(f"Unknown provider type: {provider_type}, falling back to mock")
        return MockProvider()
