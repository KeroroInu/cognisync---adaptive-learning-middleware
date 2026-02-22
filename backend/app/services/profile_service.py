"""
Profile Service - 学习者画像服务（PostgreSQL）
与前端契约完全对齐
"""
import logging
from typing import Optional
from datetime import datetime
from uuid import UUID
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.sql.user import User
from app.models.sql.profile import ProfileSnapshot, ProfileSource
from app.models.sql.calibration_log import CalibrationLog, Dimension, ConflictLevel
from app.schemas.profile import UserProfile, ProfileChange
from app.schemas.calibration import calculate_conflict_level

logger = logging.getLogger(__name__)


class ProfileService:
    """学习者画像服务"""

    # 默认画像值
    DEFAULT_COGNITION = 50
    DEFAULT_AFFECT = 50
    DEFAULT_BEHAVIOR = 50

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_profile(self, user_id: UUID) -> UserProfile:
        """
        获取用户最新画像（如果不存在则返回默认值 50/50/50）

        Args:
            user_id: 用户 ID（字符串或 UUID）

        Returns:
            UserProfile（与前端契约对齐）
        """
        # 获取最新的 system snapshot
        profile = await self._get_latest_profile(user_id, ProfileSource.SYSTEM)

        if profile:
            return profile

        # 如果不存在，返回默认值
        logger.info(f"No profile found for user {user_id}, returning defaults (50/50/50)")
        return UserProfile(
            cognition=self.DEFAULT_COGNITION,
            affect=self.DEFAULT_AFFECT,
            behavior=self.DEFAULT_BEHAVIOR,
            lastUpdate=datetime.utcnow().isoformat() + "Z"
        )

    async def apply_delta(
        self,
        user_id: UUID,
        delta_cognition: int,
        delta_affect: int,
        delta_behavior: int
    ) -> UserProfile:
        """
        应用画像增量（从对话分析结果）

        流程：
        1. 读取当前 profile
        2. 加上 delta
        3. clamp 到 0-100
        4. 写入新的 ProfileSnapshot (source='system')

        Args:
            user_id: 用户 ID
            delta_cognition: 认知增量 [-100, 100]
            delta_affect: 情感增量 [-100, 100]
            delta_behavior: 行为增量 [-100, 100]

        Returns:
            更新后的 UserProfile
        """
        # 1. 获取当前画像
        current_profile = await self.get_profile(user_id)

        # 2. 应用增量
        new_cognition = current_profile.cognition + delta_cognition
        new_affect = current_profile.affect + delta_affect
        new_behavior = current_profile.behavior + delta_behavior

        # 3. Clamp 到 0-100
        new_cognition = max(0, min(100, new_cognition))
        new_affect = max(0, min(100, new_affect))
        new_behavior = max(0, min(100, new_behavior))

        logger.info(
            f"Applying delta for user {user_id}: "
            f"C: {current_profile.cognition} + {delta_cognition} = {new_cognition}, "
            f"A: {current_profile.affect} + {delta_affect} = {new_affect}, "
            f"B: {current_profile.behavior} + {delta_behavior} = {new_behavior}"
        )

        # 4. 创建新快照
        snapshot = await self._create_snapshot(
            user_id=user_id,
            cognition=new_cognition,
            affect=new_affect,
            behavior=new_behavior,
            source=ProfileSource.SYSTEM
        )

        return UserProfile(
            cognition=snapshot.cognition,
            affect=snapshot.affect,
            behavior=snapshot.behavior,
            lastUpdate=snapshot.created_at.isoformat() + "Z"
        )

    async def apply_user_override(
        self,
        user_id: UUID,
        cognition: Optional[int] = None,
        affect: Optional[int] = None,
        behavior: Optional[int] = None,
        user_comment: Optional[str] = None,
        likert_trust: Optional[int] = None
    ) -> UserProfile:
        """
        用户手动校准画像

        流程：
        1. 获取当前 system profile
        2. 创建 user profile snapshot
        3. 记录 CalibrationLog（自动判定 conflict_level）

        Args:
            user_id: 用户 ID
            cognition: 用户自评的认知维度 [0-100]（可选）
            affect: 用户自评的情感维度 [0-100]（可选）
            behavior: 用户自评的行为维度 [0-100]（可选）
            user_comment: 用户备注
            likert_trust: 信任度评分 [1-5]

        Returns:
            用户自评的 UserProfile
        """
        # 获取当前 system profile
        system_profile = await self.get_profile(user_id)

        # 构建用户自评 profile（未提供的维度保持系统值）
        user_cognition = cognition if cognition is not None else system_profile.cognition
        user_affect = affect if affect is not None else system_profile.affect
        user_behavior = behavior if behavior is not None else system_profile.behavior

        # Clamp
        user_cognition = max(0, min(100, user_cognition))
        user_affect = max(0, min(100, user_affect))
        user_behavior = max(0, min(100, user_behavior))

        logger.info(
            f"User override for user {user_id}: "
            f"System: C={system_profile.cognition}, A={system_profile.affect}, B={system_profile.behavior} | "
            f"User: C={user_cognition}, A={user_affect}, B={user_behavior}"
        )

        # 创建 user profile snapshot
        user_snapshot = await self._create_snapshot(
            user_id=user_id,
            cognition=user_cognition,
            affect=user_affect,
            behavior=user_behavior,
            source=ProfileSource.USER
        )

        # 记录 CalibrationLog（为每个维度创建一条记录）
        await self._record_calibration_logs(
            user_id=user_id,
            system_profile=system_profile,
            user_cognition=user_cognition,
            user_affect=user_affect,
            user_behavior=user_behavior,
            user_comment=user_comment,
            likert_trust=likert_trust
        )

        return UserProfile(
            cognition=user_snapshot.cognition,
            affect=user_snapshot.affect,
            behavior=user_snapshot.behavior,
            lastUpdate=user_snapshot.created_at.isoformat() + "Z"
        )

    async def get_recent_changes(
        self,
        user_id: UUID,
        limit: int = 5
    ) -> list[ProfileChange]:
        """
        获取用户画像的最近变化

        Args:
            user_id: 用户 ID
            limit: 返回的最大变化数量

        Returns:
            ProfileChange 列表
        """
        # 获取最近的历史快照（包括 system 和 user）
        query = (
            select(ProfileSnapshot)
            .where(ProfileSnapshot.user_id == user_id)
            .order_by(desc(ProfileSnapshot.created_at))
            .limit(limit + 1)  # 多取一个来计算变化
        )

        result = await self.db.execute(query)
        snapshots = result.scalars().all()

        if len(snapshots) < 2:
            return []

        # 计算相邻快照之间的变化
        changes = []
        for i in range(len(snapshots) - 1):
            current = snapshots[i]
            previous = snapshots[i + 1]

            # 计算各维度的变化
            delta_cog = current.cognition - previous.cognition
            delta_aff = current.affect - previous.affect
            delta_beh = current.behavior - previous.behavior

            # 只记录有变化的维度
            if delta_cog != 0:
                changes.append(ProfileChange(
                    dimension="cognition",
                    change=delta_cog,
                    timestamp=current.created_at.isoformat() + "Z",
                    trend="up" if delta_cog > 0 else "down"
                ))

            if delta_aff != 0:
                changes.append(ProfileChange(
                    dimension="affect",
                    change=delta_aff,
                    timestamp=current.created_at.isoformat() + "Z",
                    trend="up" if delta_aff > 0 else "down"
                ))

            if delta_beh != 0:
                changes.append(ProfileChange(
                    dimension="behavior",
                    change=delta_beh,
                    timestamp=current.created_at.isoformat() + "Z",
                    trend="up" if delta_beh > 0 else "down"
                ))

        return changes

    async def get_or_create_user(self, user_id_or_email: str) -> User:
        """
        获取或创建用户（MVP 简化版）

        Args:
            user_id_or_email: 用户 ID 或邮箱

        Returns:
            User
        """
        # 标准化邮箱格式
        email = f"{user_id_or_email}@cognisync.local" if "@" not in user_id_or_email else user_id_or_email

        # 尝试查询
        query = select(User).where(User.email == email)
        result = await self.db.execute(query)
        user = result.scalar_one_or_none()

        if user:
            return user

        # 创建新用户
        user = User(email=email)
        self.db.add(user)
        await self.db.commit()
        await self.db.refresh(user)

        logger.info(f"Created new user: {email} (id={user.id})")

        # 创建初始画像快照（默认 50/50/50）
        await self._create_snapshot(
            user_id=user.id,
            cognition=self.DEFAULT_COGNITION,
            affect=self.DEFAULT_AFFECT,
            behavior=self.DEFAULT_BEHAVIOR,
            source=ProfileSource.SYSTEM
        )

        return user

    # ==================== Private Methods ====================

    async def _get_latest_profile(
        self,
        user_id: UUID,
        source: ProfileSource = ProfileSource.SYSTEM
    ) -> Optional[UserProfile]:
        """获取最新画像快照（内部方法）"""
        query = (
            select(ProfileSnapshot)
            .where(
                ProfileSnapshot.user_id == user_id,
                ProfileSnapshot.source == source
            )
            .order_by(desc(ProfileSnapshot.created_at))
            .limit(1)
        )

        result = await self.db.execute(query)
        snapshot = result.scalar_one_or_none()

        if snapshot:
            return UserProfile(
                cognition=snapshot.cognition,
                affect=snapshot.affect,
                behavior=snapshot.behavior,
                lastUpdate=snapshot.created_at.isoformat() + "Z"
            )

        return None

    async def _create_snapshot(
        self,
        user_id: UUID,
        cognition: int,
        affect: int,
        behavior: int,
        source: ProfileSource = ProfileSource.SYSTEM
    ) -> ProfileSnapshot:
        """创建画像快照（内部方法）"""
        snapshot = ProfileSnapshot(
            user_id=user_id,
            cognition=cognition,
            affect=affect,
            behavior=behavior,
            source=source,
            created_at=datetime.utcnow()
        )

        self.db.add(snapshot)
        await self.db.commit()
        await self.db.refresh(snapshot)

        return snapshot

    async def _record_calibration_logs(
        self,
        user_id: UUID,
        system_profile: UserProfile,
        user_cognition: int,
        user_affect: int,
        user_behavior: int,
        user_comment: Optional[str],
        likert_trust: Optional[int]
    ):
        """记录校准日志（为每个维度创建一条）"""

        dimensions = [
            (Dimension.COGNITION, system_profile.cognition, user_cognition),
            (Dimension.AFFECT, system_profile.affect, user_affect),
            (Dimension.BEHAVIOR, system_profile.behavior, user_behavior),
        ]

        for dimension, system_value, user_value in dimensions:
            # 计算冲突等级
            conflict_level = self._calculate_conflict_level(system_value, user_value)

            # 创建 CalibrationLog
            log = CalibrationLog(
                user_id=user_id,
                timestamp=datetime.utcnow(),
                dimension=dimension,
                system_value=system_value,
                user_value=user_value,
                conflict_level=conflict_level,
                user_comment=user_comment,
                likert_trust=likert_trust
            )

            self.db.add(log)

            logger.info(
                f"Calibration log: user={user_id}, dim={dimension.value}, "
                f"system={system_value}, user={user_value}, conflict={conflict_level.value}"
            )

        await self.db.commit()

    def _calculate_conflict_level(self, system_value: int, user_value: int) -> ConflictLevel:
        """
        计算冲突等级

        规则：
        - 差值 < 15: low
        - 差值 15-30: medium
        - 差值 > 30: high
        """
        diff = abs(system_value - user_value)

        if diff < 15:
            return ConflictLevel.LOW
        elif diff <= 30:
            return ConflictLevel.MEDIUM
        else:
            return ConflictLevel.HIGH
