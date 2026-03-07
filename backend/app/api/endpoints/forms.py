"""
Forms API Endpoints - 量表相关接口
"""
import uuid
from datetime import datetime, timezone, UTC
from typing import Dict, Any, Generic, TypeVar, Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.endpoints.auth import get_current_user, save_user_profile
from app.db.postgres import get_db
from app.models.sql.scale import ScaleTemplate as ScaleTemplateModel, ScaleStatus, ScaleResponse as ScaleResponseModel

router = APIRouter()


# 通用响应包装
T = TypeVar('T')

class ApiResponse(BaseModel, Generic[T]):
    """统一API响应格式"""
    success: bool
    data: T | None = None
    error: Dict[str, Any] | None = None


class ScaleSubmitRequest(BaseModel):
    """量表提交请求"""
    answers: Dict[str, int]
    started_at: Optional[str] = None  # ISO 8601 字符串，前端记录的开始填写时间


class InitialProfile(BaseModel):
    """初始画像"""
    cognition: float = Field(..., ge=0, le=100)
    affect: float = Field(..., ge=0, le=100)
    behavior: float = Field(..., ge=0, le=100)


def _compute_dim_scores(
    answers: Dict[str, int],
    scoring_json: Dict[str, Any],
    schema_json: Dict[str, Any],
) -> Dict[str, float]:
    """
    根据 scoring_json 配置，把原始 Likert 答案转换为各维度 0-100 分。
    支持反向计分题。缺失题目用维度内现有题目均值替代。
    """
    likert = schema_json.get("likert_scale", {})
    MIN_SCALE = int(likert.get("min", 1))
    MAX_SCALE = int(likert.get("max", 5))
    reverse_items = set(scoring_json.get("reverse_items", []))
    dim_mapping: Dict[str, list] = scoring_json.get("mapping", {})

    dim_scores: Dict[str, float] = {}
    for dim, item_ids in dim_mapping.items():
        scores = []
        for item_id in item_ids:
            raw = answers.get(item_id)
            if raw is None:
                continue
            raw = max(MIN_SCALE, min(MAX_SCALE, raw))  # 边界裁剪
            score = (MAX_SCALE + MIN_SCALE - raw) if item_id in reverse_items else raw
            scores.append(score)

        if scores:
            avg = sum(scores) / len(scores)
            dim_scores[dim] = round((avg - MIN_SCALE) / (MAX_SCALE - MIN_SCALE) * 100, 1)
        else:
            dim_scores[dim] = 50.0  # 无有效数据时用中性值

    return dim_scores


def _compute_cab(
    dim_scores: Dict[str, float],
    mapping_json: Dict[str, Any],
) -> tuple[float, float, float]:
    """
    根据 mapping_json 把 6 个维度分数加权合并为 CAB 三维画像。
    """
    def _weighted(cab_key: str) -> float:
        config = mapping_json.get(cab_key, {})
        sources = config.get("source_dimensions", [])
        weights = config.get("weights", [])
        if not sources:
            return 50.0
        if len(weights) != len(sources):
            weights = [1.0 / len(sources)] * len(sources)
        total_w = sum(weights)
        if total_w == 0:
            return 50.0
        val = sum(dim_scores.get(src, 50.0) * w for src, w in zip(sources, weights))
        return round(val / total_w, 1)

    return _weighted("cognition"), _weighted("affect"), _weighted("behavior")




@router.get("/list")
async def list_active_templates(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    获取所有激活的量表，并标记当前用户是否已完成。
    无需登录即可访问（未登录时 is_completed 均为 False）。
    """
    import jwt
    import uuid as _uuid

    stmt = select(ScaleTemplateModel).where(
        ScaleTemplateModel.status == ScaleStatus.ACTIVE
    ).order_by(ScaleTemplateModel.created_at.desc())

    result = await db.execute(stmt)
    templates = result.scalars().all()

    last_submit: dict = {}

    # 尝试解析 token，有则查已完成记录
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
        try:
            from app.api.endpoints.auth import SECRET_KEY, ALGORITHM
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            user_id = payload.get("sub")
            if user_id:
                uid = _uuid.UUID(user_id)
                resp_result = await db.execute(
                    select(ScaleResponseModel.template_id, ScaleResponseModel.created_at)
                    .where(ScaleResponseModel.user_id == uid)
                )
                for row in resp_result.all():
                    tid, created_at = row[0], row[1]
                    if tid not in last_submit or created_at > last_submit[tid]:
                        last_submit[tid] = created_at
        except Exception:
            pass  # token 无效则忽略

    items = [
        {
            "id": str(t.id),
            "name": t.name,
            "description": t.schema_json.get("description", ""),
            "question_count": len(
                t.schema_json.get("questions") or t.schema_json.get("items") or []
            ),
            "is_completed": (
                t.id in last_submit
                and (t.activated_at is None or last_submit[t.id] >= t.activated_at)
            ),
        }
        for t in templates
    ]

    return ApiResponse(success=True, data={"templates": items})


@router.get("/templates/{template_id}")
async def get_template_by_id(
    template_id: str,
    db: AsyncSession = Depends(get_db),
):
    """按 ID 获取量表模板（格式同 /active，供用户端填写使用）"""
    try:
        tid = uuid.UUID(template_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid template_id")

    result = await db.execute(
        select(ScaleTemplateModel).where(ScaleTemplateModel.id == tid)
    )
    template_model = result.scalar_one_or_none()
    if not template_model:
        raise HTTPException(status_code=404, detail="Scale template not found")

    raw_items = (
        template_model.schema_json.get("questions")
        or template_model.schema_json.get("items")
        or []
    )
    questions = [
        {
            "id": item["id"],
            "text": item["text"],
            "dimension": item.get("dimension", "General"),
        }
        for item in raw_items
    ]
    template = {
        "id": str(template_model.id),
        "name": template_model.name,
        "description": template_model.schema_json.get("description", ""),
        "questions": questions,
    }
    return ApiResponse(success=True, data={"template": template})


@router.get("/active")
async def get_active_template(
    db: AsyncSession = Depends(get_db)
):
    """
    获取当前激活的量表模板

    从数据库读取 ACTIVE 状态的量表模板，返回前端期望的格式（含 questions 数组）。
    公开接口，无需认证。
    """
    stmt = select(ScaleTemplateModel).where(
        ScaleTemplateModel.status == ScaleStatus.ACTIVE
    ).order_by(ScaleTemplateModel.created_at.desc())

    result = await db.execute(stmt)
    template_model = result.scalar_one_or_none()

    if not template_model:
        raise HTTPException(status_code=404, detail="No active scale template found")

    # 支持 schema_json 用 "questions" 或旧版 "items" 两种 key
    raw_items = (
        template_model.schema_json.get("questions")
        or template_model.schema_json.get("items")
        or []
    )

    questions = [
        {
            "id": item["id"],
            "text": item["text"],
            "dimension": item.get("dimension", "General"),
        }
        for item in raw_items
    ]

    template = {
        "id": str(template_model.id),
        "name": template_model.name,
        "description": template_model.schema_json.get("description", ""),
        "questions": questions,
    }

    return ApiResponse(success=True, data={"template": template})


@router.post("/{template_id}/submit")
async def submit_scale_answers(
    template_id: str,
    data: ScaleSubmitRequest,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """
    提交量表答案

    根据模板的 scoring_json 和 mapping_json 动态计算维度分数，
    再映射为 CAB 三维画像并持久化。
    """
    import logging
    logger = logging.getLogger(__name__)

    answers = data.answers

    # ── 加载模板配置 ──────────────────────────────────────────────────────────
    try:
        tid = uuid.UUID(template_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid template_id")

    template_result = await db.execute(
        select(ScaleTemplateModel).where(ScaleTemplateModel.id == tid)
    )
    template_model = template_result.scalar_one_or_none()
    if not template_model:
        raise HTTPException(status_code=404, detail="Scale template not found")

    scoring_json = template_model.scoring_json or {}
    mapping_json = template_model.mapping_json or {}
    schema_json = template_model.schema_json or {}

    # ── 计算各维度分数 (0-100) ────────────────────────────────────────────────
    dim_scores = _compute_dim_scores(answers, scoring_json, schema_json)

    # ── 映射到 CAB ────────────────────────────────────────────────────────────
    cognition, affect, behavior = _compute_cab(dim_scores, mapping_json)

    logger.info(
        f"Scale submission user={current_user.id} template={template_id} "
        f"dim_scores={dim_scores} CAB=({cognition},{affect},{behavior})"
    )

    # ── 保存用户画像 ──────────────────────────────────────────────────────────
    await save_user_profile(db, current_user.id, cognition, affect, behavior)

    # ── 保存量表响应记录 ──────────────────────────────────────────────────────
    total_score = sum(answers.values())
    max_score = len(answers) * int(schema_json.get("likert_scale", {}).get("max", 5))

    try:
        scale_resp = ScaleResponseModel(
            user_id=current_user.id,
            template_id=tid,
            answers_json=answers,
            started_at=datetime.fromisoformat(data.started_at.replace('Z', '+00:00')) if data.started_at else None,
            scores_json={
                "dimensions": dim_scores,
                "cognition": cognition,
                "affect": affect,
                "behavior": behavior,
                "total_score": total_score,
                "max_score": max_score,
            }
        )
        db.add(scale_resp)
        await db.commit()
        logger.info(f"Scale response saved for user {current_user.id}, template {template_id}")
    except Exception as e:
        await db.rollback()
        logger.error(f"Failed to save scale response: {e}", exc_info=True)

    current_time = datetime.now(timezone.utc).isoformat()

    response_data = {
        "scores": {
            "dimensions": dim_scores,
            "cognition": cognition,
            "affect": affect,
            "behavior": behavior,
        },
        "initialProfile": {
            "cognition": cognition,
            "affect": affect,
            "behavior": behavior,
            "lastUpdate": current_time
        }
    }

    return ApiResponse(success=True, data=response_data)
