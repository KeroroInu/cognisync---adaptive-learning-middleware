"""
Neo4j 健康检查和状态查询脚本
运行方式: poetry run python scripts/check_neo4j.py
"""
import asyncio
import logging
from app.db.neo4j import init_db, close_db, get_database_stats, execute_query
from app.core.config import settings
from app.core.logging import setup_logging

setup_logging()
logger = logging.getLogger(__name__)


async def check_connection():
    """检查 Neo4j 连接"""
    logger.info("🔌 Checking Neo4j connection...")

    try:
        # 简单查询测试
        result = await execute_query("RETURN 'Hello Neo4j!' as message")
        logger.info(f"✅ Connection OK: {result[0]['message']}")
        return True
    except Exception as e:
        logger.error(f"❌ Connection failed: {e}")
        return False


async def show_database_info():
    """显示数据库信息"""
    logger.info("📊 Database Information:")

    # 版本信息
    try:
        version_query = "CALL dbms.components() YIELD name, versions RETURN name, versions[0] as version"
        version_result = await execute_query(version_query)
        if version_result:
            logger.info(f"  - {version_result[0]['name']} {version_result[0]['version']}")
    except Exception as e:
        logger.warning(f"⚠️  Could not get version: {e}")

    # 统计信息
    stats = await get_database_stats()
    logger.info(f"  - Students: {stats.get('student_count', 0)}")
    logger.info(f"  - Concepts: {stats.get('concept_count', 0)}")
    logger.info(f"  - Interactions: {stats.get('interaction_count', 0)}")
    logger.info(f"  - Relations: {stats.get('relation_count', 0)}")


async def list_constraints():
    """列出所有约束"""
    logger.info("📋 Constraints:")

    try:
        query = "SHOW CONSTRAINTS YIELD name, type, labelsOrTypes, properties RETURN name, type, labelsOrTypes, properties"
        result = await execute_query(query)

        if result:
            for constraint in result:
                logger.info(
                    f"  - {constraint['name']}: {constraint['type']} on "
                    f"{constraint['labelsOrTypes']}({','.join(constraint.get('properties', []))})"
                )
        else:
            logger.info("  (No constraints found)")
    except Exception as e:
        logger.warning(f"⚠️  Could not list constraints: {e}")


async def list_indexes():
    """列出所有索引"""
    logger.info("📋 Indexes:")

    try:
        query = "SHOW INDEXES YIELD name, type, labelsOrTypes, properties RETURN name, type, labelsOrTypes, properties"
        result = await execute_query(query)

        if result:
            for index in result:
                logger.info(
                    f"  - {index['name']}: {index['type']} on "
                    f"{index['labelsOrTypes']}({','.join(index.get('properties', []))})"
                )
        else:
            logger.info("  (No indexes found)")
    except Exception as e:
        logger.warning(f"⚠️  Could not list indexes: {e}")


async def sample_query():
    """执行示例查询"""
    logger.info("🔍 Sample Query: Get first 3 concepts")

    query = """
    MATCH (c:Concept)
    RETURN c.uid as uid, c.name as name, c.description as description
    LIMIT 3
    """

    result = await execute_query(query)

    if result:
        for concept in result:
            logger.info(f"  - {concept['name']} ({concept['uid']})")
            logger.info(f"    {concept.get('description', 'No description')[:60]}...")
    else:
        logger.info("  (No concepts found)")


async def main():
    """主函数"""
    logger.info("🚀 Neo4j Health Check")
    logger.info(f"📍 URI: {settings.NEO4J_URI}")

    try:
        # 连接数据库
        await init_db()

        # 检查连接
        if not await check_connection():
            logger.error("❌ Health check failed")
            return

        # 显示数据库信息
        await show_database_info()

        # 列出约束和索引
        await list_constraints()
        await list_indexes()

        # 示例查询
        await sample_query()

        logger.info("✅ Health check completed")

    except Exception as e:
        logger.error(f"❌ Health check failed: {e}", exc_info=True)

    finally:
        # 关闭连接
        await close_db()


if __name__ == "__main__":
    asyncio.run(main())
