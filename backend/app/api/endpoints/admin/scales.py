"""
Admin 量表管理 API 端点
"""
from uuid import UUID
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import verify_admin_key
from app.db.postgres import get_db
from app.schemas.base import SuccessResponse
from app.schemas.admin.scale_management import (
    ScaleTemplateItem,
    ScaleTemplateDetail,
    ScaleTemplateUpload,
    ScaleTemplateUpdate,
    ScaleTemplatesResponse
)
from app.models.sql.scale import ScaleTemplate, ScaleResponse, ScaleStatus

router = APIRouter(tags=["Admin - Scale Management"])


@router.get("/scales", dependencies=[Depends(verify_admin_key)])
async def list_scale_templates(
    status: str = Query(None, description="按状态过滤：draft | active | archived"),
    db: AsyncSession = Depends(get_db)
) -> SuccessResponse[ScaleTemplatesResponse]:
    """
    获取量表模板列表

    Args:
        status: 状态过滤（可选）

    Returns:
        量表模板列表
    """
    # 构建查询
    query = select(ScaleTemplate)
    if status:
        if status not in ["draft", "active", "archived"]:
            raise HTTPException(status_code=400, detail="Invalid status")
        query = query.where(ScaleTemplate.status == ScaleStatus(status))

    query = query.order_by(ScaleTemplate.created_at.desc())

    # 查询总数
    total_query = select(func.count()).select_from(ScaleTemplate)
    if status:
        total_query = total_query.where(ScaleTemplate.status == ScaleStatus(status))
    total = await db.scalar(total_query) or 0

    # 查询模板
    result = await db.execute(query)
    templates = result.scalars().all()

    # 统计每个模板的响应数
    template_items = []
    for template in templates:
        responses_count = await db.scalar(
            select(func.count())
            .select_from(ScaleResponse)
            .where(ScaleResponse.template_id == template.id)
        ) or 0

        template_items.append(ScaleTemplateItem(
            id=template.id,
            name=template.name,
            version=template.version,
            status=template.status.value,
            created_at=template.created_at,
            updated_at=template.updated_at,
            responses_count=responses_count
        ))

    response = ScaleTemplatesResponse(
        templates=template_items,
        total=total
    )

    return SuccessResponse(data=response)


@router.post("/scales/upload", dependencies=[Depends(verify_admin_key)])
async def upload_scale_template(
    data: ScaleTemplateUpload,
    db: AsyncSession = Depends(get_db)
) -> SuccessResponse[ScaleTemplateDetail]:
    """
    上传新量表模板

    Args:
        data: 量表模板数据

    Returns:
        创建的量表模板
    """
    # 创建新模板
    template = ScaleTemplate(
        name=data.name,
        version=1,
        status=ScaleStatus.DRAFT,
        schema_json=data.schema_json,
        scoring_json=data.scoring_json,
        mapping_json=data.mapping_json
    )

    db.add(template)
    await db.commit()
    await db.refresh(template)

    template_detail = ScaleTemplateDetail(
        id=template.id,
        name=template.name,
        version=template.version,
        status=template.status.value,
        schema_json=template.schema_json,
        scoring_json=template.scoring_json,
        mapping_json=template.mapping_json,
        created_at=template.created_at,
        updated_at=template.updated_at
    )

    return SuccessResponse(data=template_detail)


@router.patch("/scales/{template_id}", dependencies=[Depends(verify_admin_key)])
async def update_scale_template(
    template_id: UUID,
    data: ScaleTemplateUpdate,
    db: AsyncSession = Depends(get_db)
) -> SuccessResponse[ScaleTemplateDetail]:
    """
    更新量表模板

    Args:
        template_id: 模板 ID
        data: 更新数据

    Returns:
        更新后的量表模板
    """
    # 查询模板
    result = await db.execute(
        select(ScaleTemplate).where(ScaleTemplate.id == template_id)
    )
    template = result.scalar_one_or_none()

    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    # 更新字段
    if data.name is not None:
        template.name = data.name
    if data.schema_json is not None:
        template.schema_json = data.schema_json
        template.version += 1  # 更新版本号
    if data.scoring_json is not None:
        template.scoring_json = data.scoring_json
    if data.mapping_json is not None:
        template.mapping_json = data.mapping_json

    template.updated_at = datetime.utcnow()

    await db.commit()
    await db.refresh(template)

    template_detail = ScaleTemplateDetail(
        id=template.id,
        name=template.name,
        version=template.version,
        status=template.status.value,
        schema_json=template.schema_json,
        scoring_json=template.scoring_json,
        mapping_json=template.mapping_json,
        created_at=template.created_at,
        updated_at=template.updated_at
    )

    return SuccessResponse(data=template_detail)


@router.post("/scales/{template_id}/activate", dependencies=[Depends(verify_admin_key)])
async def activate_scale_template(
    template_id: UUID,
    db: AsyncSession = Depends(get_db)
) -> SuccessResponse[dict]:
    """
    激活量表模板

    Args:
        template_id: 模板 ID

    Returns:
        成功消息
    """
    # 更新状态
    result = await db.execute(
        update(ScaleTemplate)
        .where(ScaleTemplate.id == template_id)
        .values(status=ScaleStatus.ACTIVE, updated_at=datetime.utcnow())
        .returning(ScaleTemplate.id)
    )

    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Template not found")

    await db.commit()

    return SuccessResponse(data={"message": "Template activated successfully"})


@router.post("/scales/{template_id}/archive", dependencies=[Depends(verify_admin_key)])
async def archive_scale_template(
    template_id: UUID,
    db: AsyncSession = Depends(get_db)
) -> SuccessResponse[dict]:
    """
    归档量表模板

    Args:
        template_id: 模板 ID

    Returns:
        成功消息
    """
    # 更新状态
    result = await db.execute(
        update(ScaleTemplate)
        .where(ScaleTemplate.id == template_id)
        .values(status=ScaleStatus.ARCHIVED, updated_at=datetime.utcnow())
        .returning(ScaleTemplate.id)
    )

    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Template not found")

    await db.commit()

    return SuccessResponse(data={"message": "Template archived successfully"})


@router.get("/scales/{template_id}/responses", dependencies=[Depends(verify_admin_key)])
async def get_scale_responses(
    template_id: UUID,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db)
) -> SuccessResponse[dict]:
    """
    获取量表的所有响应

    Args:
        template_id: 模板 ID
        limit: 限制数量
        offset: 偏移量

    Returns:
        响应列表
    """
    # 查询总数
    total = await db.scalar(
        select(func.count())
        .select_from(ScaleResponse)
        .where(ScaleResponse.template_id == template_id)
    ) or 0

    # 查询响应
    result = await db.execute(
        select(ScaleResponse)
        .where(ScaleResponse.template_id == template_id)
        .order_by(ScaleResponse.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    responses = result.scalars().all()

    response_items = [
        {
            "id": str(resp.id),
            "user_id": str(resp.user_id),
            "answers_json": resp.answers_json,
            "scores_json": resp.scores_json,
            "created_at": resp.created_at.isoformat()
        }
        for resp in responses
    ]

    return SuccessResponse(data={
        "responses": response_items,
        "total": total,
        "limit": limit,
        "offset": offset
    })
