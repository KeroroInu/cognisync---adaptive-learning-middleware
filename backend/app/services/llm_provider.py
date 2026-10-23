"""
LLM Provider - 统一的 LLM 接口封装
支持 OpenAI、Ollama、LM Studio 等 OpenAI 兼容接口，以及 Mock 模式
"""
import asyncio
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
import heapq
import itertools
import logging
import random
from time import perf_counter
from abc import ABC, abstractmethod
from typing import Dict, Any
import httpx
import json
import re
from urllib.parse import urlsplit
from fastapi import HTTPException

from app.core.config import settings

logger = logging.getLogger(__name__)


@dataclass(order=True)
class _GateWaiter:
    priority: int
    sequence: int
    future: asyncio.Future[None] = field(compare=False)


class SharedLLMConcurrencyGate:
    """同一后端进程内所有模型角色共用的并发预算。

    数字越小优先级越高；同优先级保持先来先服务。所有队列操作均在锁内；
    超时/取消会移除等待者，不让过期请求占用内存或槽位。
    """

    def __init__(self, limit: int, max_waiters: int = 128, wait_timeout: float = 25):
        self.limit = max(1, limit)
        self.max_waiters = max_waiters
        self.wait_timeout = wait_timeout
        self._active = 0
        self._waiters: list[_GateWaiter] = []
        self._sequence = itertools.count()
        self._lock = asyncio.Lock()

    @property
    def active(self) -> int:
        return self._active

    @property
    def waiting(self) -> int:
        return sum(not item.future.done() for item in self._waiters)

    async def acquire(self, priority: int = 0) -> float:
        started = perf_counter()
        loop = asyncio.get_running_loop()
        waiter: _GateWaiter | None = None
        async with self._lock:
            if self._active < self.limit and not self._waiters:
                self._active += 1
                return 0.0
            if self.waiting >= self.max_waiters:
                raise HTTPException(503, detail={"code": "AI_BUSY", "message": "提问较多，请稍后再试。"})
            waiter = _GateWaiter(priority, next(self._sequence), loop.create_future())
            heapq.heappush(self._waiters, waiter)

        try:
            await asyncio.wait_for(waiter.future, timeout=self.wait_timeout)
        except BaseException as error:
            async with self._lock:
                granted = waiter.future.done() and not waiter.future.cancelled()
                if granted:
                    self._active = max(0, self._active - 1)
                else:
                    waiter.future.cancel()
                self._waiters = [item for item in self._waiters if not item.future.done()]
                heapq.heapify(self._waiters)
                self._wake_waiters()
            if isinstance(error, TimeoutError):
                raise HTTPException(503, detail={"code": "AI_QUEUE_TIMEOUT", "message": "等待 AI 超时，请稍后再试。"}) from error
            raise
        return (perf_counter() - started) * 1000

    async def release(self) -> None:
        async with self._lock:
            self._active = max(0, self._active - 1)
            self._wake_waiters()

    def _wake_waiters(self) -> None:
        while self._active < self.limit and self._waiters:
            waiter = heapq.heappop(self._waiters)
            if waiter.future.done():
                continue
            self._active += 1
            waiter.future.set_result(None)

    @asynccontextmanager
    async def slot(self, priority: int = 0):
        wait_ms = await self.acquire(priority)
        try:
            yield wait_ms
        finally:
            await self.release()


_shared_gate_loop: asyncio.AbstractEventLoop | None = None
_shared_gate: SharedLLMConcurrencyGate | None = None


def get_shared_llm_gate() -> SharedLLMConcurrencyGate:
    """按事件循环复用一个闸门；测试切换事件循环时自动重建。"""

    global _shared_gate_loop, _shared_gate
    loop = asyncio.get_running_loop()
    if (
        _shared_gate is None
        or _shared_gate_loop is not loop
        or _shared_gate.limit != settings.LLM_MAX_CONCURRENCY
        or _shared_gate.max_waiters != settings.LLM_MAX_QUEUE
        or _shared_gate.wait_timeout != settings.LLM_QUEUE_TIMEOUT_SECONDS
    ):
        _shared_gate_loop = loop
        _shared_gate = SharedLLMConcurrencyGate(settings.LLM_MAX_CONCURRENCY, settings.LLM_MAX_QUEUE, settings.LLM_QUEUE_TIMEOUT_SECONDS)
    return _shared_gate


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
        request_role: str = "chat",
        request_priority: int = 0,
    ):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        # Upgrade retired official aliases at the request boundary, including
        # already-saved DB configurations. Do not rewrite third-party models.
        self.model = model
        if self._is_official_deepseek() and model in {
            "deepseek-chat", "deepseek-reasoner", "deepseek-v4-flash",
            "deepseek-v4-flash-vision-exp",
        }:
            self.model = "deepseek-flash"
        self.timeout = timeout
        self.request_role = request_role
        self.request_priority = request_priority

        # 创建 HTTP 客户端
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(timeout),
            limits=httpx.Limits(
                max_connections=settings.LLM_MAX_CONCURRENCY,
                max_keepalive_connections=max(2, settings.LLM_MAX_CONCURRENCY // 2),
            ),
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
        )

        logger.info("Initialized OpenAICompatibleProvider: host=%s model=%s",
                    urlsplit(self.base_url).hostname, self.model)

    def _is_official_deepseek(self) -> bool:
        try:
            parsed = urlsplit(self.base_url)
            return (parsed.scheme == "https" and parsed.hostname == "api.deepseek.com"
                    and not (parsed.username or parsed.password or parsed.query or parsed.fragment)
                    and parsed.port in (None, 443) and parsed.path in ("", "/v1"))
        except ValueError:
            return False

    @staticmethod
    def _response_content(data: Any) -> str:
        content = data["choices"][0]["message"]["content"]
        if not isinstance(content, str) or not content.strip():
            raise ValueError("missing visible text")
        return content

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
        payload.update(self._classroom_options())

        try:
            response: httpx.Response | None = None
            total_wait_ms = 0.0
            upstream_ms = 0.0
            retry_count = 0
            for attempt in range(settings.LLM_MAX_RETRIES + 1):
                gate = get_shared_llm_gate()
                async with gate.slot(self.request_priority) as wait_ms:
                    # Class may end while this request waits behind another student.
                    from app.services.classroom_service import ensure_queued_llm_access
                    await ensure_queued_llm_access()
                    total_wait_ms += wait_ms
                    request_started = perf_counter()
                    response = await self.client.post(
                        f"{self.base_url}/chat/completions",
                        json=payload,
                    )
                    upstream_ms += (perf_counter() - request_started) * 1000
                if response.status_code not in {429, 500, 502, 503, 504}:
                    break
                if attempt < settings.LLM_MAX_RETRIES:
                    retry_count += 1
                    retry_after = response.headers.get("Retry-After")
                    delay = float(retry_after) if retry_after and retry_after.isdigit() else (0.5 * (2 ** attempt) + random.random() * 0.25)
                    # 退避不占共享槽位，后到的学生回复可以继续推进。
                    await asyncio.sleep(min(delay, 5.0))
            assert response is not None
            response.raise_for_status()

            data = response.json()

            # 提取生成的文本
            content = self._response_content(data)

            logger.debug(
                f"LLM response received: {len(content)} chars, "
                f"model={self.model}"
            )
            logger.info(
                "LLM request complete role=%s model=%s status=%s queue_wait_ms=%.1f "
                "upstream_ms=%.1f retries=%s",
                self.request_role,
                self.model,
                response.status_code,
                total_wait_ms,
                upstream_ms,
                retry_count,
            )

            return content

        except httpx.HTTPStatusError as e:
            # Upstreams may echo an invalid API key in their error body.
            # Record only the status, never response bodies or request headers.
            logger.error("HTTP error from LLM API: status=%s model=%s",
                         e.response.status_code, self.model)
            raise RuntimeError(f"LLM API request failed (HTTP {e.response.status_code})") from None

        except httpx.RequestError as e:
            logger.error("LLM connection error: %s", type(e).__name__)
            raise RuntimeError("Failed to connect to LLM API") from None

        except (KeyError, IndexError, TypeError, ValueError) as e:
            logger.error("Unexpected LLM API response format: %s", type(e).__name__)
            raise RuntimeError("Invalid LLM API response: missing visible answer") from None

    def _classroom_options(self) -> dict:
        # Flash defaults to reasoning. Short classroom replies need the token
        # budget for the visible answer, not an invisible reasoning preamble.
        if (self.request_role == "chat"
                and self._is_official_deepseek()
                and self.model == "deepseek-flash"):
            return {"thinking": {"type": "disabled"}}
        return {}

    async def health_check(self) -> bool:
        """检查 LLM API 是否可用"""
        try:
            # 发送一个简单的请求测试连接
            async with get_shared_llm_gate().slot(priority=20):
                response = await self.client.post(
                    f"{self.base_url}/chat/completions",
                    json={
                        "model": self.model,
                        "messages": [{"role": "user", "content": "Hi"}],
                        "max_tokens": 5,
                        **self._classroom_options(),
                    },
                )
            response.raise_for_status()
            self._response_content(response.json())
            return True

        except Exception as e:
            logger.warning("LLM health check failed: %s", type(e).__name__)
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
        """对话返回明确标注的离线文本，旧分析接口仍返回 JSON。"""

        # Common classroom dialogue is not the legacy analysis endpoint.
        if "COGNISYNC_COMMON_SUPPORT_V1" in system_prompt:
            try:
                request = json.loads(user_prompt)
                request = request if isinstance(request, dict) else {}
                context = json.loads(request.get('context') or '{}')
            except (ValueError, TypeError):
                request, context = {}, {}
            context = context if isinstance(context, dict) else {}
            name = str(context.get('functionName', ''))
            if "COGNISYNC_FUNCTION_IDEAS_V1" in system_prompt:
                if '当前操作：organize' in system_prompt:
                    return '【离线演示】真实 AI 尚未接通，暂时不能替你整理对话。可以点“我想自己写步骤”，按“先做什么 → 什么情况下做什么 → 最后怎样”写短句。'
                hint = '什么时候会用到这个功能？发生之后，画面或数据要改变什么？'
                if any(word in name for word in ('方向', '转向')):
                    hint = '蛇正在向右走，这时按下左键，应该立刻掉头吗？'
                elif any(word in name for word in ('吃', '进食', '得分', '增长')):
                    hint = '蛇头碰到食物后，你想让蛇身和分数各发生什么变化？'
                elif any(word in name for word in ('移动', '前进')):
                    hint = '蛇向前走一格，头部和尾部分别要怎样变化？'
                return '【离线演示】' + hint
            return '【离线演示】当前未接通真实 AI。可以先记录你的问题或自己尝试；请老师在模型设置中接通对话模型后再继续讨论。'

        # 项目支架对话在离线开发模式下也返回可读建议；文本分析仍返回 JSON。
        if "COGNISYNC_SCAFFOLD_MODE" in system_prompt:
            level_match = re.search(r"(?:请求|level)\s*L([0-3])", system_prompt, re.IGNORECASE)
            level = int(level_match.group(1)) if level_match else 0
            replies = {
                0: "先别急着改答案。请指出当前画面、卡片或测试结果中，哪一个具体变化和你的预期不同？",
                1: "这里先关注“状态”与“状态更新”：输入发生后，应该由哪个变量保存变化？请先圈出那个变量。",
                2: "可以按三步检查：确认输入，再定位更新状态的判断，最后核对返回值。你先完成第一步并重新运行。",
                3: "先只补阻塞的一步：让相关判断返回更新后的状态，不要改其他模块。运行后请解释实际结果为什么变化。",
            }
            return replies[level]

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
            response["delta"] = {"cognition": -5, "affect": -10, "behavior": 1}
            response["evidence"]["spans"] = [
                {"text": "不懂", "label": "confusion_signal", "start": 0, "end": 2}
            ]

        elif any(word in user_prompt for word in ["学习", "想学", "了解", "掌握"]):
            response["intent"] = "exploration"
            response["emotion"] = "curious"
            response["delta"] = {"cognition": 0, "affect": 5, "behavior": 2}
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
            response["delta"] = {"cognition": 2, "affect": 8, "behavior": 4}

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
            timeout=settings.LLM_TIMEOUT_SECONDS,
        )

    elif provider_type == "deepseek":
        return OpenAICompatibleProvider(
            base_url=settings.DEEPSEEK_BASE_URL,
            api_key=settings.DEEPSEEK_API_KEY,
            model=settings.DEEPSEEK_MODEL,
            timeout=settings.LLM_TIMEOUT_SECONDS,
        )

    elif provider_type == "ollama":
        return OpenAICompatibleProvider(
            base_url=settings.OLLAMA_BASE_URL,
            api_key="ollama",  # Ollama 不需要真实 API key
            model=settings.OLLAMA_MODEL,
            timeout=settings.LLM_TIMEOUT_SECONDS,
        )

    elif provider_type == "lmstudio":
        return OpenAICompatibleProvider(
            base_url=settings.LMSTUDIO_BASE_URL,
            api_key="lmstudio",  # LM Studio 不需要真实 API key
            model=settings.LMSTUDIO_MODEL,
            timeout=settings.LLM_TIMEOUT_SECONDS,
        )

    else:
        logger.warning(f"Unknown provider type: {provider_type}, falling back to mock")
        return MockProvider()
