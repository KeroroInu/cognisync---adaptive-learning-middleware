"""
初始化 Neo4j 知识图谱 - 创建约束和索引（幂等）
运行方式: poetry run python -m app.db.init_graph
"""
import asyncio
import logging
from app.db.neo4j import (
    init_db,
    close_db,
    create_constraint_if_not_exists,
    create_index_if_not_exists,
    get_database_stats,
    execute_query,
)
from app.core.config import settings
from app.core.logging import setup_logging

setup_logging()
logger = logging.getLogger(__name__)


async def create_constraints():
    """
    创建约束（幂等）

    约束：
    1. Student.id 唯一
    2. Concept.uid 唯一
    """
    logger.info("📋 Creating constraints...")

    constraints = [
        {
            "name": "constraint_student_id_unique",
            "query": "CREATE CONSTRAINT constraint_student_id_unique IF NOT EXISTS FOR (s:Student) REQUIRE s.id IS UNIQUE"
        },
        {
            "name": "constraint_concept_uid_unique",
            "query": "CREATE CONSTRAINT constraint_concept_uid_unique IF NOT EXISTS FOR (c:Concept) REQUIRE c.uid IS UNIQUE"
        },
    ]

    for constraint in constraints:
        await create_constraint_if_not_exists(
            constraint_name=constraint["name"],
            constraint_query=constraint["query"]
        )

    logger.info("✅ All constraints created/verified")


async def create_indexes():
    """
    创建索引（幂等）

    索引：
    1. Concept.name - 加速按名称查询
    2. Student.id - 加速学生查询（如果约束未自动创建索引）
    """
    logger.info("📋 Creating indexes...")

    indexes = [
        {
            "name": "index_concept_name",
            "query": "CREATE INDEX index_concept_name IF NOT EXISTS FOR (c:Concept) ON (c.name)"
        },
    ]

    for index in indexes:
        await create_index_if_not_exists(
            index_name=index["name"],
            index_query=index["query"]
        )

    logger.info("✅ All indexes created/verified")


async def create_vector_index():
    """
    创建向量索引（可选，根据环境变量决定）

    向量索引：
    - Concept.embedding - 用于语义相似度搜索
    """
    if not settings.ENABLE_NEO4J_VECTOR_INDEX:
        logger.info("⏭️  Vector index disabled (ENABLE_NEO4J_VECTOR_INDEX=false)")
        return

    logger.info("📋 Creating vector index...")

    # 检查 Neo4j 版本是否支持向量索引（需要 5.11+）
    try:
        version_query = "CALL dbms.components() YIELD versions RETURN versions[0] as version"
        result = await execute_query(version_query)
        version = result[0]["version"] if result else "unknown"

        # 简单版本检查（提取主版本号）
        major_version = int(version.split(".")[0]) if version != "unknown" else 0
        minor_version = int(version.split(".")[1]) if "." in version else 0

        if major_version < 5 or (major_version == 5 and minor_version < 11):
            logger.warning(
                f"⚠️  Neo4j version {version} does not support vector indexes "
                f"(requires 5.11+). Skipping vector index creation."
            )
            return

    except Exception as e:
        logger.warning(f"⚠️  Could not determine Neo4j version: {e}. Skipping vector index.")
        return

    # 创建向量索引
    vector_index_query = f"""
    CREATE VECTOR INDEX index_concept_embedding IF NOT EXISTS
    FOR (c:Concept) ON (c.embedding)
    OPTIONS {{
        indexConfig: {{
            `vector.dimensions`: {settings.EMBED_DIM},
            `vector.similarity_function`: 'cosine'
        }}
    }}
    """

    await create_index_if_not_exists(
        index_name="index_concept_embedding",
        index_query=vector_index_query
    )

    logger.info(f"✅ Vector index created (dimension={settings.EMBED_DIM})")


async def verify_schema():
    """验证图模式是否正确创建"""
    logger.info("🔍 Verifying graph schema...")

    # 获取统计信息
    stats = await get_database_stats()

    logger.info("📊 Database statistics:")
    logger.info(f"  - Students: {stats.get('student_count', 0)}")
    logger.info(f"  - Concepts: {stats.get('concept_count', 0)}")
    logger.info(f"  - Interactions: {stats.get('interaction_count', 0)}")
    logger.info(f"  - Relations: {stats.get('relation_count', 0)}")

    # 验证约束
    constraints_query = "SHOW CONSTRAINTS YIELD name, type RETURN name, type"
    try:
        constraints = await execute_query(constraints_query)
        logger.info(f"📋 Active constraints: {len(constraints)}")
        for c in constraints:
            logger.debug(f"  - {c['name']} ({c['type']})")
    except Exception as e:
        logger.warning(f"⚠️  Could not list constraints: {e}")

    # 验证索引
    indexes_query = "SHOW INDEXES YIELD name, type RETURN name, type"
    try:
        indexes = await execute_query(indexes_query)
        logger.info(f"📋 Active indexes: {len(indexes)}")
        for idx in indexes:
            logger.debug(f"  - {idx['name']} ({idx['type']})")
    except Exception as e:
        logger.warning(f"⚠️  Could not list indexes: {e}")


async def main():
    """主函数 - 初始化图模式"""
    logger.info("🚀 Initializing Neo4j graph schema...")
    logger.info(f"📍 Neo4j URI: {settings.NEO4J_URI}")

    try:
        # 连接数据库
        await init_db()

        # 创建约束
        await create_constraints()

        # 创建索引
        await create_indexes()

        # 创建向量索引（可选）
        await create_vector_index()

        # 验证模式
        await verify_schema()

        logger.info("🎉 Graph schema initialization completed successfully!")

    except Exception as e:
        logger.error(f"❌ Graph schema initialization failed: {e}", exc_info=True)
        raise

    finally:
        # 关闭连接
        await close_db()


if __name__ == "__main__":
    asyncio.run(main())
