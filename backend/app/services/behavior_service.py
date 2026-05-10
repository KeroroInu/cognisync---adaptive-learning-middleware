"""
Behavior Service - 用户行为记录和分析服务
用于记录学习行为数据，并计算真实的 Behavior 分数
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID
from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.sql.behavior_log import BehaviorLog
from app.models.sql.chat_session import ChatSession
from app.models.sql.message import ChatMessage

logger = logging.getLogger(__name__)


class BehaviorService:
    """用户行为服务"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def record_session_behavior(
        self,
        user_id: UUID,
        session_id: UUID,
        session_duration: int,
        message_count: int,
        concept_engagement: int,
        response_time_avg: Optional[float] = None,
        task_completion_rate: Optional[float] = None
    ) -> BehaviorLog:
        """
        记录会话行为数据

        Args:
            user_id: 用户 ID
            session_id: 会话 ID
            session_duration: 会话持续时长（秒）
            message_count: 消息数量
            concept_engagement: 涉及的概念数量
            response_time_avg: 平均响应时间（秒）
            task_completion_rate: 任务完成率 [0.0-1.0]

        Returns:
            创建的 BehaviorLog 对象
        """
        # 计算连续学习天数
        consecutive_days = await self._calculate_consecutive_days(user_id)

        behavior_log = BehaviorLog(
            user_id=user_id,
            session_id=session_id,
            timestamp=datetime.now(timezone.utc),
            session_duration=session_duration,
            message_count=message_count,
            concept_engagement=concept_engagement,
            response_time_avg=response_time_avg,
            task_completion_rate=task_completion_rate,
            consecutive_days=consecutive_days
        )

        self.db.add(behavior_log)
        await self.db.commit()
        await self.db.refresh(behavior_log)

        logger.info(
            f"Behavior log recorded: user={user_id}, session={session_id}, "
            f"duration={session_duration}s, messages={message_count}, concepts={concept_engagement}"
        )

        return behavior_log

    async def _calculate_consecutive_days(self, user_id: UUID) -> int:
        """
        计算用户连续学习天数

        Args:
            user_id: 用户 ID

        Returns:
            连续学习天数
        """
        # 获取最近的行为日志（按天分组）
        query = (
            select(func.date(BehaviorLog.timestamp))
            .where(BehaviorLog.user_id == user_id)
            .distinct()
            .order_by(desc(func.date(BehaviorLog.timestamp)))
            .limit(30)  # 最多查询 30 天
        )

        result = await self.db.execute(query)
        dates = [row[0] for row in result.all()]

        if not dates:
            return 1  # 首次记录

        # 检查是否包含今天
        today = datetime.now(timezone.utc).date()
        if dates[0] != today:
            # 如果今天还没有记录，从今天开始计算
            dates.insert(0, today)

        # 计算连续天数
        consecutive = 1
        for i in range(len(dates) - 1):
            diff = (dates[i] - dates[i + 1]).days
            if diff == 1:
                consecutive += 1
            else:
                break

        return consecutive

    async def calculate_session_metrics(
        self,
        session_id: UUID
    ) -> dict:
        """
        计算会话的行为指标

        Args:
            session_id: 会话 ID

        Returns:
            包含会话指标的字典
        """
        # 获取会话
        session_query = select(ChatSession).where(ChatSession.id == session_id)
        result = await self.db.execute(session_query)
        session = result.scalar_one_or_none()

        if not session:
            logger.warning(f"Session not found: {session_id}")
            return {
                "session_duration": 0,
                "message_count": 0,
                "concept_engagement": 0,
                "response_time_avg": None
            }

        # 获取会话消息
        messages_query = (
            select(ChatMessage)
            .where(ChatMessage.session_id == session_id)
            .order_by(ChatMessage.timestamp)
        )
        result = await self.db.execute(messages_query)
        messages = result.scalars().all()

        if not messages:
            return {
                "session_duration": 0,
                "message_count": 0,
                "concept_engagement": 0,
                "response_time_avg": None
            }

        # 计算会话时长（第一条到最后一条消息的时间差）
        first_msg = messages[0]
        last_msg = messages[-1]

        first_ts = first_msg.timestamp
        last_ts = last_msg.timestamp

        if first_ts.tzinfo is None:
            first_ts = first_ts.replace(tzinfo=timezone.utc)
        if last_ts.tzinfo is None:
            last_ts = last_ts.replace(tzinfo=timezone.utc)

        session_duration = int((last_ts - first_ts).total_seconds())

        # 消息数量
        message_count = len(messages)

        # 概念参与度（从分析结果中提取）
        concepts = set()
        for msg in messages:
            if msg.analysis and isinstance(msg.analysis, dict):
                detected = msg.analysis.get("detectedConcepts", [])
                for concept in detected:
                    if isinstance(concept, str):
                        concepts.add(concept)
                    elif isinstance(concept, dict):
                        name = concept.get("name", "")
                        if name:
                            concepts.add(name)

        concept_engagement = len(concepts)

        # 平均响应时间（用户消息之间的平均间隔）
        user_messages = [m for m in messages if m.role.value == "user"]
        if len(user_messages) > 1:
            response_times = []
            for i in range(1, len(user_messages)):
                prev_ts = user_messages[i - 1].timestamp
                curr_ts = user_messages[i].timestamp
                if prev_ts.tzinfo is None:
                    prev_ts = prev_ts.replace(tzinfo=timezone.utc)
                if curr_ts.tzinfo is None:
                    curr_ts = curr_ts.replace(tzinfo=timezone.utc)
                delta = (curr_ts - prev_ts).total_seconds()
                response_times.append(delta)
            response_time_avg = sum(response_times) / len(response_times) if response_times else None
        else:
            response_time_avg = None

        return {
            "session_duration": max(session_duration, 0),
            "message_count": message_count,
            "concept_engagement": concept_engagement,
            "response_time_avg": response_time_avg
        }

    async def calculate_behavior_from_logs(self, user_id: UUID, lookback_days: int = 7) -> int:
        """
        基于行为日志计算用户的 Behavior 分数 [0-100]

        计算逻辑：
        - 30% 权重：平均会话时长（学习投入）
        - 25% 权重：会话频率（学习频次）
        - 20% 权重：消息参与度（互动积极性）
        - 15% 权重：连续学习天数（坚持度）
        - 10% 权重：概念参与度（主动探索）

        Args:
            user_id: 用户 ID
            lookback_days: 回溯天数（默认 7 天）

        Returns:
            Behavior 分数 [0-100]
        """
        logger.info(f"Calculating behavior from logs for user {user_id} (lookback={lookback_days} days)")

        # 获取最近 N 天的行为日志
        cutoff = datetime.now(timezone.utc) - timedelta(days=lookback_days)
        query = (
            select(BehaviorLog)
            .where(
                BehaviorLog.user_id == user_id,
                BehaviorLog.timestamp >= cutoff
            )
            .order_by(desc(BehaviorLog.timestamp))
        )

        result = await self.db.execute(query)
        logs = result.scalars().all()

        if not logs:
            logger.info("No behavior logs found, returning default behavior 50")
            return 50  # 无数据时返回默认值

        # Component 1: 平均会话时长 (30% 权重)
        # 假设 30 分钟会话为满分
        avg_duration = sum(log.session_duration for log in logs) / len(logs)
        duration_score = min(100, (avg_duration / 1800.0) * 100)  # 1800s = 30min

        # Component 2: 会话频率 (25% 权重)
        # 假设每天 1 次会话为满分
        session_frequency = len(logs) / lookback_days
        frequency_score = min(100, session_frequency * 100)

        # Component 3: 消息参与度 (20% 权重)
        # 假设每个会话平均 10 条消息为满分
        avg_messages = sum(log.message_count for log in logs) / len(logs)
        message_score = min(100, (avg_messages / 10.0) * 100)

        # Component 4: 连续学习天数 (15% 权重)
        # 假设连续 7 天为满分
        max_consecutive = max((log.consecutive_days for log in logs), default=1)
        consecutive_score = min(100, (max_consecutive / 7.0) * 100)

        # Component 5: 概念参与度 (10% 权重)
        # 假设每个会话平均涉及 5 个概念为满分
        avg_concepts = sum(log.concept_engagement for log in logs) / len(logs)
        concept_score = min(100, (avg_concepts / 5.0) * 100)

        # 加权求和
        behavior = (
            duration_score * 0.30 +
            frequency_score * 0.25 +
            message_score * 0.20 +
            consecutive_score * 0.15 +
            concept_score * 0.10
        )

        behavior_int = int(max(0, min(100, behavior)))

        logger.info(
            f"Behavior calculated for user {user_id}: {behavior_int} "
            f"(duration={avg_duration:.0f}s, freq={session_frequency:.2f}/day, "
            f"messages={avg_messages:.1f}, consecutive={max_consecutive}d, concepts={avg_concepts:.1f})"
        )

        return behavior_int
