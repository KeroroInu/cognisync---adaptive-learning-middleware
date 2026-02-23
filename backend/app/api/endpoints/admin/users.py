"""
用户管理 API 端点
"""
from uuid import UUID
from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional

from app.core.security import verify_admin_key
from app.db.postgres import get_db
from app.models.sql.user import User
from app.models.sql.message import ChatMessage
from app.schemas.base import SuccessResponse
from app.schemas.admin.user_management import UserListResponse, UserSummary

router = APIRouter(tags=["Admin - User Management"])


@router.get("/users", dependencies=[Depends(verify_admin_key)])
async def list_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    query: Optional[str] = Query(None, description="搜索关键词（邮箱或用户名）"),
    db: AsyncSession = Depends(get_db)
) -> SuccessResponse[UserListResponse]:
    """获取用户列表（分页 + 搜索）"""
    base_stmt = select(User)
    count_stmt = select(func.count(User.id))

    # 支持按 email 或 name 搜索
    if query:
        like = f"%{query}%"
        condition = or_(User.email.ilike(like), User.name.ilike(like))
        base_stmt = base_stmt.where(condition)
        count_stmt = count_stmt.where(condition)

    total_result = await db.execute(count_stmt)
    total = total_result.scalar() or 0

    offset = (page - 1) * page_size
    stmt = base_stmt.offset(offset).limit(page_size).order_by(User.created_at.desc())
    result = await db.execute(stmt)
    users = result.scalars().all()

    user_summaries = []
    for user in users:
        msg_count_result = await db.execute(
            select(func.count(ChatMessage.id)).where(ChatMessage.user_id == user.id)
        )
        msg_count = msg_count_result.scalar() or 0

        last_msg_result = await db.execute(
            select(ChatMessage.timestamp)
            .where(ChatMessage.user_id == user.id)
            .order_by(ChatMessage.timestamp.desc())
            .limit(1)
        )
        last_active = last_msg_result.scalar()

        user_summaries.append(UserSummary(
            id=str(user.id),
            email=user.email,
            name=user.name or "",
            role=getattr(user, "role", "user") or "user",
            is_active=getattr(user, "is_active", True) if hasattr(user, "is_active") else True,
            created_at=user.created_at,
            message_count=msg_count,
            last_active_at=last_active
        ))

    return SuccessResponse(data=UserListResponse(
        users=user_summaries,
        total=total,
        page=page,
        pageSize=page_size
    ))


class UpdateUserRequest(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None


@router.patch("/users/{user_id}", dependencies=[Depends(verify_admin_key)])
async def update_user(
    user_id: str,
    body: UpdateUserRequest,
    db: AsyncSession = Depends(get_db)
) -> SuccessResponse[dict]:
    """更新用户信息（名称 / 激活状态）"""
    try:
        uid = UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid user_id")

    result = await db.execute(select(User).where(User.id == uid))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if body.name is not None:
        user.name = body.name
    if body.is_active is not None and hasattr(user, "is_active"):
        user.is_active = body.is_active

    await db.commit()
    await db.refresh(user)

    return SuccessResponse(data={
        "id": str(user.id),
        "email": user.email,
        "name": user.name or "",
        "is_active": getattr(user, "is_active", True),
    })


@router.delete("/users/{user_id}", dependencies=[Depends(verify_admin_key)])
async def delete_user(
    user_id: str,
    db: AsyncSession = Depends(get_db)
) -> SuccessResponse[dict]:
    """删除用户（同时删除相关消息、画像记录）"""
    try:
        uid = UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid user_id")

    result = await db.execute(select(User).where(User.id == uid))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # 删除关联数据（依赖 DB 级联或手动删除）
    from app.models.sql.message import ChatMessage
    from app.models.sql.profile import ProfileSnapshot
    from sqlalchemy import delete as sql_delete

    await db.execute(sql_delete(ChatMessage).where(ChatMessage.user_id == uid))
    await db.execute(sql_delete(ProfileSnapshot).where(ProfileSnapshot.user_id == uid))
    await db.delete(user)
    await db.commit()

    return SuccessResponse(data={"deleted": True, "user_id": user_id})
