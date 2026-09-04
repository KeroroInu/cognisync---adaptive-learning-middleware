"""模型共享并发预算与优先级调度。"""
import asyncio

import pytest

from app.services import llm_provider
from app.services.llm_provider import OpenAICompatibleProvider, SharedLLMConcurrencyGate


class _SuccessResponse:
    status_code = 200
    headers: dict[str, str] = {}

    def raise_for_status(self):
        return None

    def json(self):
        return {"choices": [{"message": {"content": "ok"}}], "usage": {}}


@pytest.mark.asyncio
async def test_chat_waiter_runs_before_queued_analysis_waiter():
    gate = SharedLLMConcurrencyGate(limit=1)
    await gate.acquire()
    order: list[str] = []

    async def use_slot(label: str, priority: int):
        async with gate.slot(priority):
            order.append(label)

    analysis = asyncio.create_task(use_slot("analysis", 10))
    await asyncio.sleep(0)
    chat = asyncio.create_task(use_slot("chat", 0))
    await asyncio.sleep(0)

    await gate.release()
    await asyncio.gather(analysis, chat)

    assert order == ["chat", "analysis"]


@pytest.mark.asyncio
async def test_cancelled_waiter_does_not_leak_a_slot():
    gate = SharedLLMConcurrencyGate(limit=1)
    await gate.acquire()
    waiting = asyncio.create_task(gate.acquire(priority=10))
    await asyncio.sleep(0)
    waiting.cancel()
    with pytest.raises(asyncio.CancelledError):
        await waiting

    await gate.release()
    wait_ms = await asyncio.wait_for(gate.acquire(priority=0), timeout=0.1)
    assert wait_ms >= 0
    await gate.release()


@pytest.mark.asyncio
async def test_separate_analysis_and_chat_providers_share_one_budget(monkeypatch):
    active = 0
    max_active = 0
    counter_lock = asyncio.Lock()

    class FakeClient:
        def __init__(self, **kwargs):
            pass

        async def post(self, *args, **kwargs):
            nonlocal active, max_active
            async with counter_lock:
                active += 1
                max_active = max(max_active, active)
            await asyncio.sleep(0.01)
            async with counter_lock:
                active -= 1
            return _SuccessResponse()

        async def aclose(self):
            return None

    monkeypatch.setattr(llm_provider.httpx, "AsyncClient", FakeClient)
    monkeypatch.setattr(llm_provider.settings, "LLM_MAX_CONCURRENCY", 2)
    monkeypatch.setattr(llm_provider.settings, "LLM_MAX_RETRIES", 0)

    analysis = OpenAICompatibleProvider(
        "https://example.invalid/v1",
        "key",
        "analysis-model",
        request_role="analysis",
        request_priority=10,
    )
    chat = OpenAICompatibleProvider(
        "https://example.invalid/v1",
        "key",
        "chat-model",
        request_role="chat",
        request_priority=0,
    )

    await asyncio.gather(*[
        provider.complete("system", "user")
        for provider in (analysis, chat, analysis, chat, analysis, chat)
    ])

    assert max_active == 2
