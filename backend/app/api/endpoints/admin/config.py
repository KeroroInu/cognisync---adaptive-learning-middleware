"""
Admin LLM 配置端点
支持独立配置语义分析（analysis）和对话（chat）所使用的 LLM 提供者
"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from urllib.parse import urlsplit
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import verify_admin_key
from app.db.postgres import get_db
from app.schemas.base import SuccessResponse
from app.services import llm_config

router = APIRouter(tags=["Admin - Model Config"])


class LlmRoleConfigRequest(BaseModel):
    """单个角色的 LLM 配置"""
    provider: str = Field(..., description="提供者: openai | deepseek | ollama | lmstudio | mock")
    api_key: Optional[str] = Field(None, description="API Key（ollama/lmstudio 可留空）")
    base_url: Optional[str] = Field(None, description="API Base URL")
    model: Optional[str] = Field(None, description="模型名称")
    clear_api_key: bool = False


class LlmConfigRequest(BaseModel):
    """完整 LLM 配置请求体"""
    role: str = Field(..., description="角色: analysis | chat")
    config: LlmRoleConfigRequest


@router.get("/config/llm", dependencies=[Depends(verify_admin_key)])
async def get_llm_config(db: AsyncSession = Depends(get_db)) -> SuccessResponse:
    """
    获取当前 LLM 配置（分析 + 对话两个角色）

    需要已登录管理员的 Bearer JWT。
    """
    # 确保从 DB 加载最新配置
    await llm_config.load_from_db(db)
    current = llm_config.get_current_config()
    # Never send server credentials back to a browser (even an administrator).
    public = {role: {key: value for key, value in config.items() if key != "api_key"}
              | {"has_api_key": bool(config.get("api_key"))} for role, config in current.items()}
    return SuccessResponse(data=public)


@router.put("/config/llm", dependencies=[Depends(verify_admin_key)])
async def save_llm_config(
    body: LlmConfigRequest,
    db: AsyncSession = Depends(get_db),
) -> SuccessResponse:
    """
    保存 LLM 配置到数据库并立即生效

    - role=analysis：用于语义分析（低温度、结构化 JSON）
    - role=chat：用于 AI 对话回复（较高温度、自然语言）

    需要已登录管理员的 Bearer JWT。
    """
    if body.role not in ("analysis", "chat"):
        raise HTTPException(status_code=400, detail="role must be 'analysis' or 'chat'")

    if body.config.provider not in ("openai", "deepseek", "ollama", "lmstudio", "mock"):
        raise HTTPException(422, "请选择有效的模型服务")
    await llm_config.load_from_db(db)
    previous = llm_config.get_current_config()[body.role]
    base_url = (body.config.base_url or "").strip().rstrip("/")
    model = (body.config.model or "").strip()
    key = (body.config.api_key or "").strip()
    # Validate here rather than Pydantic: validation errors must not echo keys.
    if key and (len(key) > 4096 or any(ord(char) < 33 or ord(char) > 126 for char in key)):
        raise HTTPException(422, "API key 只能包含英文字符，不能包含空格或换行，请重新复制")
    if body.config.clear_api_key:
        key = ""
    elif not key and previous.get("provider") == body.config.provider and (previous.get("base_url") or "").rstrip("/") == base_url:
        key = previous.get("api_key", "")
    if body.config.provider != "mock":
        try:
            parsed = urlsplit(base_url)
            valid_url = parsed.scheme in ("http", "https") and bool(parsed.hostname) and not (parsed.username or parsed.password or parsed.query or parsed.fragment)
        except ValueError:
            valid_url = False
        if not valid_url or not model or len(model) > 200:
            raise HTTPException(422, "请填写完整的 API 地址和模型名称，地址不要包含密钥或查询参数")
        if body.config.provider in ("openai", "deepseek") and (parsed.scheme != "https" or not key):
            raise HTTPException(422, "云端模型需要 HTTPS API 地址和 API key；更换服务或地址后请重新填 key")

    config_dict = {
        "provider": body.config.provider,
        "api_key": key,
        "base_url": base_url,
        "model": model,
    }

    await llm_config.save_to_db(db, body.role, config_dict)

    return SuccessResponse(data={
        "role": body.role,
        "provider": body.config.provider,
        "model": body.config.model,
    })
