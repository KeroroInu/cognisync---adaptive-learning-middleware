"""
LLM Config Service - LLM 配置管理
支持分析（TextAnalyzer）和对话（Chat）使用不同的 LLM 提供者和模型
配置存储在数据库中，内存缓存加速读取
"""
import json
import logging
import inspect
from typing import Optional

from app.core.config import settings
from app.services.llm_provider import BaseProvider, OpenAICompatibleProvider, MockProvider

logger = logging.getLogger(__name__)

# 内存缓存：{"analysis": {...}, "chat": {...}}
_config_cache: dict = {}
# 复用 HTTP 连接池，避免每条对话都新建 AsyncClient。
_provider_cache: dict[str, tuple[tuple[str, str, str, str], BaseProvider]] = {}


async def _close_provider(provider: BaseProvider) -> None:
    close = getattr(provider, "close", None)
    if close:
        result = close()
        if inspect.isawaitable(result):
            await result


def _get_role_config(role: str) -> dict:
    """获取指定角色（analysis/chat）的 LLM 配置，未配置时回退到全局 env 设置"""
    cached = _config_cache.get(role, {})
    provider = cached.get("provider") or settings.LLM_PROVIDER

    # 如果缓存中有完整配置则直接使用
    if cached.get("provider"):
        return {
            "provider": provider,
            "api_key": cached.get("api_key", ""),
            "base_url": cached.get("base_url", ""),
            "model": cached.get("model", ""),
        }

    # 回退到 env 默认值
    if provider == "openai":
        return {
            "provider": provider,
            "api_key": settings.OPENAI_API_KEY,
            "base_url": settings.OPENAI_BASE_URL,
            "model": settings.OPENAI_MODEL,
        }
    elif provider == "deepseek":
        return {
            "provider": provider,
            "api_key": settings.DEEPSEEK_API_KEY,
            "base_url": settings.DEEPSEEK_BASE_URL,
            "model": settings.DEEPSEEK_MODEL,
        }
    elif provider == "ollama":
        return {
            "provider": provider,
            "api_key": "ollama",
            "base_url": settings.OLLAMA_BASE_URL,
            "model": settings.OLLAMA_MODEL,
        }
    elif provider == "lmstudio":
        return {
            "provider": provider,
            "api_key": "lmstudio",
            "base_url": settings.LMSTUDIO_BASE_URL,
            "model": settings.LMSTUDIO_MODEL,
        }
    else:
        return {"provider": "mock"}


def _build_provider(config: dict) -> BaseProvider:
    """根据配置字典构建 LLM Provider 实例"""
    provider_type = config.get("provider", "mock")

    if provider_type == "mock":
        return MockProvider()

    api_key = config.get("api_key", "") or "no-key"
    base_url = config.get("base_url", "")
    model = config.get("model", "")

    if not base_url or not model:
        logger.warning(f"Incomplete LLM config for provider={provider_type}, falling back to mock")
        return MockProvider()

    return OpenAICompatibleProvider(
        base_url=base_url,
        api_key=api_key,
        model=model,
    )


def _get_cached_provider(role: str) -> BaseProvider:
    config = _get_role_config(role)
    signature = (
        config.get("provider", "mock"),
        config.get("base_url", ""),
        config.get("model", ""),
        config.get("api_key", ""),
    )
    cached = _provider_cache.get(role)
    if cached and cached[0] == signature:
        return cached[1]

    provider = _build_provider(config)
    _provider_cache[role] = (signature, provider)
    return provider


def get_analysis_provider() -> BaseProvider:
    """获取语义分析专用 LLM Provider（低温度、结构化 JSON 输出）"""
    config = _get_role_config("analysis")
    logger.debug(f"Analysis provider: {config.get('provider')} / {config.get('model')}")
    return _get_cached_provider("analysis")


def get_chat_provider() -> BaseProvider:
    """获取 AI 对话专用 LLM Provider（较高温度、自然语言回复）"""
    config = _get_role_config("chat")
    logger.debug(f"Chat provider: {config.get('provider')} / {config.get('model')}")
    return _get_cached_provider("chat")


def update_cache(role: str, config: dict) -> None:
    """更新内存缓存（由 admin 配置端点调用）"""
    _config_cache[role] = config
    _provider_cache.pop(role, None)
    logger.info(f"LLM config cache updated for role={role}: provider={config.get('provider')}")


def get_current_config() -> dict:
    """返回当前两种角色的完整配置（用于 admin API 展示）"""
    return {
        "analysis": _get_role_config("analysis"),
        "chat": _get_role_config("chat"),
    }


async def load_from_db(db) -> None:
    """从数据库加载 LLM 配置到内存缓存（启动时调用）"""
    try:
        from sqlalchemy import select
        from app.models.sql.system_config import SystemConfig

        for role in ("analysis", "chat"):
            result = await db.execute(
                select(SystemConfig).where(SystemConfig.key == f"{role}_llm")
            )
            row = result.scalar_one_or_none()
            if row:
                new_config = json.loads(row.value)
                if _config_cache.get(role) != new_config:
                    old = _provider_cache.pop(role, None)
                    _config_cache[role] = new_config
                    if old:
                        await _close_provider(old[1])
                logger.info(f"Loaded LLM config for role={role} from DB")
    except Exception as e:
        logger.warning(f"Failed to load LLM config from DB (using env defaults): {e}")


async def save_to_db(db, role: str, config: dict) -> None:
    """将 LLM 配置保存到数据库并更新内存缓存"""
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    from app.models.sql.system_config import SystemConfig
    from datetime import datetime, timezone

    key = f"{role}_llm"
    value = json.dumps(config, ensure_ascii=False)

    # Upsert
    stmt = pg_insert(SystemConfig).values(
        key=key, value=value, updated_at=datetime.now(timezone.utc)
    ).on_conflict_do_update(
        index_elements=["key"],
        set_={"value": value, "updated_at": datetime.now(timezone.utc)}
    )
    await db.execute(stmt)
    await db.commit()

    old = _provider_cache.get(role)
    update_cache(role, config)
    if old:
        await _close_provider(old[1])
    logger.info(f"Saved LLM config for role={role}: {config.get('provider')}/{config.get('model')}")


async def close_providers() -> None:
    """应用关闭时释放共享 HTTP 连接池。"""
    providers = [cached[1] for cached in _provider_cache.values()]
    _provider_cache.clear()
    for provider in providers:
        await _close_provider(provider)
