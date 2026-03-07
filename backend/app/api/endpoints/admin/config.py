"""
Admin LLM 配置端点
支持独立配置语义分析（analysis）和对话（chat）所使用的 LLM 提供者
"""
from typing import Optional
from fastapi import APIRouter, Depends
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


class LlmConfigRequest(BaseModel):
    """完整 LLM 配置请求体"""
    role: str = Field(..., description="角色: analysis | chat")
    config: LlmRoleConfigRequest


@router.get("/config/llm", dependencies=[Depends(verify_admin_key)])
async def get_llm_config(db: AsyncSession = Depends(get_db)) -> SuccessResponse:
    """
    获取当前 LLM 配置（分析 + 对话两个角色）

    需要 Admin Key 认证（X-ADMIN-KEY Header）
    """
    # 确保从 DB 加载最新配置
    await llm_config.load_from_db(db)
    current = llm_config.get_current_config()
    return SuccessResponse(data=current)


@router.put("/config/llm", dependencies=[Depends(verify_admin_key)])
async def save_llm_config(
    body: LlmConfigRequest,
    db: AsyncSession = Depends(get_db),
) -> SuccessResponse:
    """
    保存 LLM 配置到数据库并立即生效

    - role=analysis：用于语义分析（低温度、结构化 JSON）
    - role=chat：用于 AI 对话回复（较高温度、自然语言）

    需要 Admin Key 认证（X-ADMIN-KEY Header）
    """
    if body.role not in ("analysis", "chat"):
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="role must be 'analysis' or 'chat'")

    config_dict = {
        "provider": body.config.provider,
        "api_key": body.config.api_key or "",
        "base_url": body.config.base_url or "",
        "model": body.config.model or "",
    }

    await llm_config.save_to_db(db, body.role, config_dict)

    return SuccessResponse(data={
        "role": body.role,
        "provider": body.config.provider,
        "model": body.config.model,
    })
