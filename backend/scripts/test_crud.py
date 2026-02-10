"""
手动测试 CRUD 操作
运行方式: poetry run python scripts/test_crud.py
"""
import asyncio
import logging
from app.core.logging import setup_logging
from app.db.postgres import init_db, async_session_factory
from app.services.profile_service import ProfileService
from app.models.sql.profile import ProfileSource

setup_logging()
logger = logging.getLogger(__name__)


async def main():
    """主测试流程"""

    # 初始化数据库
    logger.info("Initializing database...")
    await init_db()

    # 创建会话
    async with async_session_factory() as db:
        service = ProfileService(db)

        # 1. 创建或获取用户
        logger.info("\n1️⃣ Testing get_or_create_user...")
        user = await service.get_or_create_user("test@cognisync.dev")
        logger.info(f"✅ User created: {user.id} | {user.email}")

        # 2. 获取最新画像
        logger.info("\n2️⃣ Testing get_latest_profile...")
        profile = await service.get_latest_profile(user.id, ProfileSource.SYSTEM)
        if profile:
            logger.info(f"✅ Current profile: C={profile.cognition}, A={profile.affect}, B={profile.behavior}")
        else:
            logger.warning("⚠️  No profile found")

        # 3. 应用增量
        logger.info("\n3️⃣ Testing apply_delta...")
        updated_profile = await service.apply_delta(
            user_id=user.id,
            delta_cognition=-5,
            delta_affect=-10,
            delta_behavior=5
        )
        logger.info(
            f"✅ Profile updated: C={updated_profile.cognition}, "
            f"A={updated_profile.affect}, B={updated_profile.behavior}"
        )

        # 4. 创建用户自评快照
        logger.info("\n4️⃣ Testing create_profile_snapshot (user self-assessment)...")
        user_snapshot = await service.create_profile_snapshot(
            user_id=user.id,
            cognition=75,
            affect=50,
            behavior=85,
            source=ProfileSource.USER
        )
        logger.info(f"✅ User self-assessment saved: {user_snapshot.id}")

        # 5. 对比系统评估 vs 用户自评
        logger.info("\n5️⃣ Comparing system vs user profiles...")
        system_profile = await service.get_latest_profile(user.id, ProfileSource.SYSTEM)
        user_profile = await service.get_latest_profile(user.id, ProfileSource.USER)

        if system_profile and user_profile:
            logger.info("📊 Conflict Analysis:")
            logger.info(f"  Cognition: System={system_profile.cognition}, User={user_profile.cognition}, Diff={abs(system_profile.cognition - user_profile.cognition)}")
            logger.info(f"  Affect: System={system_profile.affect}, User={user_profile.affect}, Diff={abs(system_profile.affect - user_profile.affect)}")
            logger.info(f"  Behavior: System={system_profile.behavior}, User={user_profile.behavior}, Diff={abs(system_profile.behavior - user_profile.behavior)}")

        logger.info("\n🎉 All CRUD operations completed successfully!")


if __name__ == "__main__":
    asyncio.run(main())
