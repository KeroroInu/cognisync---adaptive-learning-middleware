"""
Onboarding API Endpoints - 入职流程相关接口
"""
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc

from app.db.postgres import get_db
from app.models.sql.onboarding import OnboardingSession
from app.schemas.onboarding import (
    OnboardingSessionCreate,
    OnboardingSessionUpdate,
    OnboardingSessionResponse,
    OnboardingListResponse
)

router = APIRouter(prefix="/onboarding", tags=["Onboarding"])


@router.post("", response_model=OnboardingSessionResponse)
async def create_onboarding_session(
    session_data: OnboardingSessionCreate,
    db: AsyncSession = Depends(get_db)
):
    """
    创建入职会话

    用户首次使用系统时，创建一个入职会话记录。
    """
    # 创建会话
    session = OnboardingSession(
        user_id=session_data.user_id,
        mode=session_data.mode,
        raw_transcript=session_data.raw_transcript,
        extracted_json=session_data.extracted_json
    )

    db.add(session)
    await db.commit()
    await db.refresh(session)

    return session


@router.get("/{session_id}", response_model=OnboardingSessionResponse)
async def get_onboarding_session(
    session_id: UUID,
    db: AsyncSession = Depends(get_db)
):
    """获取入职会话详情"""
    result = await db.execute(
        select(OnboardingSession).where(OnboardingSession.id == session_id)
    )
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    return session


@router.patch("/{session_id}", response_model=OnboardingSessionResponse)
async def update_onboarding_session(
    session_id: UUID,
    update_data: OnboardingSessionUpdate,
    db: AsyncSession = Depends(get_db)
):
    """
    更新入职会话

    在入职过程中增量更新对话记录和提取的信息。
    """
    result = await db.execute(
        select(OnboardingSession).where(OnboardingSession.id == session_id)
    )
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # 更新字段
    if update_data.raw_transcript is not None:
        session.raw_transcript = update_data.raw_transcript
    if update_data.extracted_json is not None:
        session.extracted_json = update_data.extracted_json

    await db.commit()
    await db.refresh(session)

    return session


@router.get("/user/{user_id}", response_model=OnboardingListResponse)
async def get_user_onboarding_sessions(
    user_id: UUID,
    page: int = 1,
    page_size: int = 10,
    db: AsyncSession = Depends(get_db)
):
    """
    获取用户的入职会话列表

    返回用户的所有入职会话，按创建时间倒序。
    """
    # 计算总数
    count_result = await db.execute(
        select(func.count(OnboardingSession.id))
        .where(OnboardingSession.user_id == user_id)
    )
    total = count_result.scalar() or 0

    # 查询会话列表
    offset = (page - 1) * page_size
    result = await db.execute(
        select(OnboardingSession)
        .where(OnboardingSession.user_id == user_id)
        .order_by(desc(OnboardingSession.created_at))
        .offset(offset)
        .limit(page_size)
    )
    sessions = result.scalars().all()

    return OnboardingListResponse(
        sessions=sessions,
        total=total,
        page=page,
        page_size=page_size
    )


@router.delete("/{session_id}")
async def delete_onboarding_session(
    session_id: UUID,
    db: AsyncSession = Depends(get_db)
):
    """删除入职会话"""
    result = await db.execute(
        select(OnboardingSession).where(OnboardingSession.id == session_id)
    )
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    await db.delete(session)
    await db.commit()

    return {"success": True, "message": "Session deleted"}
