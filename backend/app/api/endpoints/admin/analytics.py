"""
数据分析统计 API 端点
"""
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import verify_admin_key
from app.db.postgres import get_db
from app.models.sql.emotion_log import EmotionLog
from app.models.sql.message import ChatMessage
from app.models.sql.user import User
from app.schemas.base import SuccessResponse
from app.schemas.admin.analytics import (
    AnalyticsOverviewResponse,
    EmotionDistributionItem,
    EmotionDistributionResponse,
    EmotionTrendPoint,
    EmotionTrendResponse,
    EmotionUserDetailResponse,
    EmotionUserLogItem,
    EmotionUserSummary,
    SystemOverview,
    UserActivity,
)

router = APIRouter(tags=["Admin - Analytics"])


@router.get("/analytics/overview", dependencies=[Depends(verify_admin_key)])
async def get_analytics_overview(
    db: AsyncSession = Depends(get_db)
) -> SuccessResponse[AnalyticsOverviewResponse]:
    """
    获取系统概览统计

    Returns:
        系统统计数据和活跃度趋势
    """
    # 总用户数
    total_users_result = await db.execute(select(func.count(User.id)))
    total_users = total_users_result.scalar()

    # 总消息数
    total_messages_result = await db.execute(select(func.count(ChatMessage.id)))
    total_messages = total_messages_result.scalar()

    # 人均消息数
    avg_messages = total_messages / total_users if total_users > 0 else 0

    # 7天活跃用户数（简化：有消息的用户）
    seven_days_ago = datetime.utcnow() - timedelta(days=7)
    active_users_result = await db.execute(
        select(func.count(func.distinct(ChatMessage.user_id)))
        .where(ChatMessage.timestamp >= seven_days_ago)
    )
    active_users = active_users_result.scalar()

    overview = SystemOverview(
        totalUsers=total_users,
        totalMessages=total_messages,
        totalConcepts=0,  # Neo4j 数据，暂时为 0
        avgMessagesPerUser=round(avg_messages, 2),
        activeUsersLast7Days=active_users
    )

    # 活跃度趋势（简化：最近7天的消息数）
    activity_trend = []
    for i in range(7):
        date = datetime.utcnow() - timedelta(days=6-i)
        date_start = date.replace(hour=0, minute=0, second=0, microsecond=0)
        date_end = date_start + timedelta(days=1)

        msg_count_result = await db.execute(
            select(func.count(ChatMessage.id))
            .where(ChatMessage.timestamp >= date_start)
            .where(ChatMessage.timestamp < date_end)
        )
        msg_count = msg_count_result.scalar()

        active_user_count_result = await db.execute(
            select(func.count(func.distinct(ChatMessage.user_id)))
            .where(ChatMessage.timestamp >= date_start)
            .where(ChatMessage.timestamp < date_end)
        )
        active_user_count = active_user_count_result.scalar()

        activity_trend.append(UserActivity(
            date=date.strftime("%Y-%m-%d"),
            activeUsers=active_user_count,
            totalMessages=msg_count
        ))

    return SuccessResponse(data=AnalyticsOverviewResponse(
        overview=overview,
        activityTrend=activity_trend
    ))


@router.get("/analytics/emotion", dependencies=[Depends(verify_admin_key)])
async def get_emotion_distribution(
    days: int = Query(30, ge=1, le=365),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> SuccessResponse[EmotionDistributionResponse]:
    start_time = datetime.now(timezone.utc) - timedelta(days=days)

    total_logs = (
        await db.scalar(
            select(func.count(EmotionLog.id)).where(EmotionLog.created_at >= start_time)
        )
    ) or 0

    rows = (
        await db.execute(
            select(
                EmotionLog.legacy_emotion,
                EmotionLog.emotion_code,
                EmotionLog.emotion_name,
                EmotionLog.intensity,
                func.count(EmotionLog.id).label("count"),
                func.avg(EmotionLog.confidence).label("avg_confidence"),
            )
            .where(EmotionLog.created_at >= start_time)
            .group_by(
                EmotionLog.legacy_emotion,
                EmotionLog.emotion_code,
                EmotionLog.emotion_name,
                EmotionLog.intensity,
            )
            .order_by(func.count(EmotionLog.id).desc(), EmotionLog.emotion_code.asc())
            .limit(limit)
        )
    ).all()

    items = [
        EmotionDistributionItem(
            legacyEmotion=row.legacy_emotion,
            emotionCode=row.emotion_code,
            emotionName=row.emotion_name,
            intensity=row.intensity,
            count=row.count,
            percentage=round((row.count / total_logs) * 100, 2) if total_logs else 0.0,
            avgConfidence=round(float(row.avg_confidence or 0.0), 4),
        )
        for row in rows
    ]

    return SuccessResponse(
        data=EmotionDistributionResponse(
            totalLogs=total_logs,
            items=items,
        )
    )


@router.get("/analytics/emotion/trends", dependencies=[Depends(verify_admin_key)])
async def get_emotion_trends(
    days: int = Query(14, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
) -> SuccessResponse[EmotionTrendResponse]:
    start_time = datetime.now(timezone.utc) - timedelta(days=days - 1)
    day_start = start_time.replace(hour=0, minute=0, second=0, microsecond=0)
    day_bucket = func.date_trunc("day", EmotionLog.created_at)

    per_day_rows = (
        await db.execute(
            select(
                day_bucket.label("day"),
                func.count(EmotionLog.id).label("total_count"),
                func.avg(EmotionLog.confidence).label("avg_confidence"),
                func.avg(EmotionLog.valence).label("avg_valence"),
                func.avg(EmotionLog.arousal).label("avg_arousal"),
            )
            .where(EmotionLog.created_at >= day_start)
            .group_by(day_bucket)
            .order_by(day_bucket.asc())
        )
    ).all()

    emotion_rows = (
        await db.execute(
            select(
                day_bucket.label("day"),
                EmotionLog.emotion_code,
                func.count(EmotionLog.id).label("count"),
            )
            .where(EmotionLog.created_at >= day_start)
            .group_by(day_bucket, EmotionLog.emotion_code)
            .order_by(day_bucket.asc())
        )
    ).all()

    day_lookup: dict[str, dict] = {}
    for row in per_day_rows:
        date_key = row.day.date().isoformat()
        day_lookup[date_key] = {
            "totalCount": int(row.total_count or 0),
            "averageConfidence": round(float(row.avg_confidence or 0.0), 4),
            "averageValence": round(float(row.avg_valence or 0.0), 4),
            "averageArousal": round(float(row.avg_arousal or 0.0), 4),
            "emotionCounts": {},
        }

    for row in emotion_rows:
        date_key = row.day.date().isoformat()
        if date_key not in day_lookup:
            day_lookup[date_key] = {
                "totalCount": 0,
                "averageConfidence": 0.0,
                "averageValence": 0.0,
                "averageArousal": 0.0,
                "emotionCounts": {},
            }
        day_lookup[date_key]["emotionCounts"][row.emotion_code] = int(row.count or 0)

    points: list[EmotionTrendPoint] = []
    for offset in range(days):
        current_day = day_start + timedelta(days=offset)
        date_key = current_day.date().isoformat()
        payload = day_lookup.get(
            date_key,
            {
                "totalCount": 0,
                "averageConfidence": 0.0,
                "averageValence": 0.0,
                "averageArousal": 0.0,
                "emotionCounts": {},
            },
        )
        points.append(
            EmotionTrendPoint(
                date=date_key,
                totalCount=payload["totalCount"],
                averageConfidence=payload["averageConfidence"],
                averageValence=payload["averageValence"],
                averageArousal=payload["averageArousal"],
                emotionCounts=payload["emotionCounts"],
            )
        )

    return SuccessResponse(data=EmotionTrendResponse(days=days, points=points))


@router.get("/analytics/emotion/users/{user_id}", dependencies=[Depends(verify_admin_key)])
async def get_user_emotion_detail(
    user_id: UUID,
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
) -> SuccessResponse[EmotionUserDetailResponse]:
    user = (
        await db.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    total_logs = (
        await db.scalar(select(func.count(EmotionLog.id)).where(EmotionLog.user_id == user_id))
    ) or 0

    rows = (
        await db.execute(
            select(EmotionLog)
            .where(EmotionLog.user_id == user_id)
            .order_by(EmotionLog.created_at.desc())
            .limit(limit)
        )
    ).scalars().all()

    latest = rows[0] if rows else None
    summary = EmotionUserSummary(
        userId=str(user.id),
        studentId=user.student_id,
        name=user.name,
        totalLogs=total_logs,
        lastAnalyzedAt=latest.created_at.isoformat() if latest else None,
        latestEmotionCode=latest.emotion_code if latest else None,
        latestEmotionName=latest.emotion_name if latest else None,
        currentCognition=latest.profile_cognition if latest else None,
        currentAffect=latest.profile_affect if latest else None,
        currentBehavior=latest.profile_behavior if latest else None,
    )

    logs = [
        EmotionUserLogItem(
            id=str(row.id),
            createdAt=row.created_at.isoformat(),
            sessionId=str(row.session_id) if row.session_id else None,
            messageId=str(row.message_id),
            intent=row.intent,
            emotion=row.legacy_emotion,
            emotionCode=row.emotion_code,
            emotionName=row.emotion_name,
            intensity=row.intensity,
            confidence=row.confidence,
            arousal=row.arousal,
            valence=row.valence,
            detectedConcepts=list(row.detected_concepts or []),
            evidence=list(row.evidence or []),
            deltaCognition=row.delta_cognition,
            deltaAffect=row.delta_affect,
            deltaBehavior=row.delta_behavior,
            profileCognition=row.profile_cognition,
            profileAffect=row.profile_affect,
            profileBehavior=row.profile_behavior,
        )
        for row in rows
    ]

    return SuccessResponse(data=EmotionUserDetailResponse(summary=summary, logs=logs))
