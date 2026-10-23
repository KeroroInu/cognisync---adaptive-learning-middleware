"""模型共享并发预算与优先级调度。"""
import asyncio
import json

import httpx
import pytest
from fastapi import HTTPException

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
@pytest.mark.parametrize('model', [
    'deepseek-chat', 'deepseek-reasoner', 'deepseek-v4-flash',
    'deepseek-v4-flash-vision-exp', 'deepseek-flash',
])
async def test_official_deepseek_legacy_configuration_uses_current_flash(monkeypatch, model):
    """An existing saved model must work without the teacher re-entering the key."""
    original_client = httpx.AsyncClient
    requests = []

    def handle(request):
        payload = json.loads(request.content)
        requests.append(payload)
        assert request.url == 'https://api.deepseek.com/v1/chat/completions'
        assert request.headers['authorization'] == 'Bearer sk-unit-test-only'
        assert payload['model'] == 'deepseek-flash'
        assert payload['thinking'] == {'type': 'disabled'}
        return httpx.Response(200, json={'choices': [{'message': {'content': '先确定蛇头的位置。'}}]})

    monkeypatch.setattr(llm_provider.httpx, 'AsyncClient', lambda **kwargs:
        original_client(transport=httpx.MockTransport(handle), **kwargs))
    provider = OpenAICompatibleProvider('https://api.deepseek.com/v1', 'sk-unit-test-only', model)
    try:
        assert await provider.complete('system', 'user', max_tokens=600) == '先确定蛇头的位置。'
        assert await provider.health_check()
        assert len(requests) == 2
    finally:
        await provider.close()


@pytest.mark.asyncio
@pytest.mark.parametrize('base_url,model', [
    ('https://gateway.example/v1', 'deepseek-chat'),
    ('https://api.deepseek.com.evil.example/v1', 'deepseek-chat'),
    ('https://api.deepseek.com/v1', 'custom-model'),
    ('https://api.deepseek.com/v1', 'deepseek-v4-pro'),
])
async def test_deepseek_migration_does_not_override_custom_endpoints_or_models(base_url, model):
    provider = OpenAICompatibleProvider(base_url, 'sk-unit-test-only', model)
    try:
        assert provider.model == model
    finally:
        await provider.close()


@pytest.mark.parametrize('base_url', [
    'https://api.deepseek.com:invalid/v1',
    'https://api.deepseek.com:99999/v1',
    'https://[api.deepseek.com/v1',
])
def test_official_deepseek_detection_rejects_malformed_urls_without_raising(base_url):
    # Exercise only detection: no HTTP client, network, or configuration writes.
    provider = OpenAICompatibleProvider.__new__(OpenAICompatibleProvider)
    provider.base_url = base_url
    assert provider._is_official_deepseek() is False
    assert provider.base_url == base_url


def test_deepseek_default_is_current_flash():
    from app.core.config import Settings
    assert Settings.model_fields['DEEPSEEK_MODEL'].default == 'deepseek-flash'


@pytest.mark.asyncio
@pytest.mark.parametrize('content', [None, '', '   ', ['not a text answer']])
async def test_provider_rejects_empty_or_non_text_answers_and_health_check(monkeypatch, content):
    original_client = httpx.AsyncClient
    monkeypatch.setattr(llm_provider.httpx, 'AsyncClient', lambda **kwargs:
        original_client(transport=httpx.MockTransport(lambda request:
            httpx.Response(200, json={'choices': [{'message': {'content': content}}]})), **kwargs))
    provider = OpenAICompatibleProvider('https://api.deepseek.com', 'sk-unit-test-only', 'deepseek-flash')
    try:
        with pytest.raises(RuntimeError, match='Invalid LLM API response'):
            await provider.complete('system', 'user')
        assert not await provider.health_check()
    finally:
        await provider.close()


@pytest.mark.asyncio
async def test_upstream_errors_do_not_log_or_return_echoed_credentials(monkeypatch, caplog):
    original_client = httpx.AsyncClient
    secret = 'sk-unit-test-do-not-echo'
    monkeypatch.setattr(llm_provider.httpx, 'AsyncClient', lambda **kwargs:
        original_client(transport=httpx.MockTransport(lambda request:
            httpx.Response(401, json={'error': {'message': f'Invalid key: {secret}'}})), **kwargs))
    provider = OpenAICompatibleProvider('https://api.deepseek.com', secret, 'deepseek-flash')
    try:
        with pytest.raises(RuntimeError) as error:
            await provider.complete('system', 'user')
        assert secret not in str(error.value)
        assert secret not in caplog.text
        assert '401' in str(error.value)
    finally:
        await provider.close()


@pytest.mark.asyncio
@pytest.mark.parametrize('base_url,model,role,disabled', [
    ('https://api.deepseek.com/v1', 'deepseek-flash', 'chat', True),
    ('https://api.deepseek.com', 'deepseek-v4-flash', 'chat', True),
    ('https://api.deepseek.com/v1', 'deepseek-flash', 'analysis', False),
    ('https://api.deepseek.com/v1', 'deepseek-v4-pro', 'chat', False),
    ('https://example.invalid/v1', 'deepseek-flash', 'chat', False),
])
async def test_flash_classroom_disables_thinking_without_affecting_other_models(monkeypatch, base_url, model, role, disabled):
    requests = []

    class FakeClient:
        def __init__(self, **kwargs):
            pass

        async def post(self, *args, **kwargs):
            requests.append(kwargs['json'])
            return _SuccessResponse()

        async def aclose(self):
            pass

    monkeypatch.setattr(llm_provider.httpx, 'AsyncClient', FakeClient)
    provider = OpenAICompatibleProvider(base_url, 'test-key', model, request_role=role)
    assert await provider.complete('system', 'user', max_tokens=600) == 'ok'
    assert await provider.health_check()
    for request in requests:
        assert request.get('thinking') == ({'type':'disabled'} if disabled else None)
    assert requests[0]['max_tokens'] == 600


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


@pytest.mark.asyncio
async def test_queue_bounds_timeout_and_cancel_cleanup():
    gate = SharedLLMConcurrencyGate(1, max_waiters=1, wait_timeout=0.02)
    await gate.acquire()
    waiting = asyncio.create_task(gate.acquire())
    await asyncio.sleep(0)
    with pytest.raises(HTTPException) as busy:
        await gate.acquire()
    assert busy.value.detail["code"] == "AI_BUSY"
    with pytest.raises(HTTPException) as timed_out:
        await waiting
    assert timed_out.value.detail["code"] == "AI_QUEUE_TIMEOUT"
    assert gate.waiting == 0 and not gate._waiters
    # Repeated cancellation cannot grow a stale heap behind a slow active call.
    for _ in range(20):
        waiting = asyncio.create_task(gate.acquire())
        await asyncio.sleep(0)
        waiting.cancel()
        with pytest.raises(asyncio.CancelledError):
            await waiting
    assert gate.active == 1 and not gate._waiters
    await gate.release()
    async with gate.slot():
        assert gate.active == 1
    assert gate.active == 0


@pytest.mark.asyncio
async def test_queued_request_rechecks_classroom_before_http_dispatch(monkeypatch):
    from app.services import classroom_service
    gate = SharedLLMConcurrencyGate(1)
    await gate.acquire()
    calls = []
    closed = False

    async def check_access():
        assert classroom_service.llm_classroom_scope.get() == "排队班"
        if closed:
            raise classroom_service.denied("closed")

    class FakeClient:
        def __init__(self, **kwargs):
            pass

        async def post(self, *args, **kwargs):
            calls.append(True)
            return _SuccessResponse()

        async def aclose(self):
            pass

    monkeypatch.setattr(llm_provider, "get_shared_llm_gate", lambda: gate)
    monkeypatch.setattr(llm_provider.httpx, "AsyncClient", FakeClient)
    monkeypatch.setattr(classroom_service, "ensure_queued_llm_access", check_access)
    provider = OpenAICompatibleProvider("https://example.invalid/v1", "unused", "test")
    token = classroom_service.llm_classroom_scope.set("排队班")
    try:
        request = asyncio.create_task(provider.complete("system", "user"))
        for _ in range(10):
            await asyncio.sleep(0)
            if gate.waiting:
                break
        assert gate.waiting == 1
        closed = True
        await gate.release()
        with pytest.raises(HTTPException) as rejected:
            await request
        assert rejected.value.detail["code"] == "CLASSROOM_CLOSED"
        assert not calls and gate.active == 0
    finally:
        classroom_service.llm_classroom_scope.reset(token)
