"""
Neo4j 数据库连接管理 - 用于知识图谱存储
使用 AsyncGraphDatabase 实现异步操作
"""
import logging
from typing import Optional, Dict, Any, List
from contextlib import asynccontextmanager
from neo4j import AsyncGraphDatabase, AsyncDriver, AsyncSession

from app.core.config import settings

logger = logging.getLogger(__name__)

# 全局 Neo4j 驱动实例
_driver: Optional[AsyncDriver] = None


async def init_db():
    """
    初始化 Neo4j 连接
    在应用启动时调用
    """
    global _driver

    try:
        logger.info(f"Connecting to Neo4j at {settings.NEO4J_URI}...")

        _driver = AsyncGraphDatabase.driver(
            settings.NEO4J_URI,
            auth=(settings.NEO4J_USER, settings.NEO4J_PASSWORD),
            max_connection_lifetime=3600,
            max_connection_pool_size=50,
            connection_acquisition_timeout=60,
        )

        # 验证连接
        await _driver.verify_connectivity()
        logger.info("✅ Neo4j connection verified")

        # 获取 Neo4j 版本信息
        async with _driver.session() as session:
            result = await session.run("CALL dbms.components() YIELD name, versions RETURN name, versions[0] as version")
            record = await result.single()
            if record:
                logger.info(f"📊 Neo4j version: {record['name']} {record['version']}")

    except Exception as e:
        logger.error(f"❌ Neo4j connection failed: {e}")
        raise


async def close_db():
    """
    关闭 Neo4j 连接
    在应用关闭时调用
    """
    global _driver
    if _driver:
        await _driver.close()
        logger.info("✅ Neo4j connection closed")
        _driver = None


def get_driver() -> AsyncDriver:
    """
    获取 Neo4j 驱动实例

    Returns:
        AsyncDriver

    Raises:
        RuntimeError: 如果驱动未初始化
    """
    if _driver is None:
        raise RuntimeError("Neo4j driver not initialized. Call init_db() first.")
    return _driver


@asynccontextmanager
async def get_session():
    """
    获取 Neo4j 会话（上下文管理器）

    用法：
        async with get_session() as session:
            result = await session.run("MATCH (n) RETURN n LIMIT 1")

    Yields:
        AsyncSession
    """
    driver = get_driver()
    async with driver.session() as session:
        try:
            yield session
        except Exception as e:
            logger.error(f"Neo4j session error: {e}")
            raise


async def execute_query(
    query: str,
    parameters: Optional[Dict[str, Any]] = None,
    database: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    执行 Cypher 查询并返回结果

    Args:
        query: Cypher 查询语句
        parameters: 查询参数
        database: 数据库名称（可选）

    Returns:
        查询结果列表
    """
    async with get_session() as session:
        result = await session.run(query, parameters or {})
        return [dict(record) for record in await result.data()]


async def execute_write(
    query: str,
    parameters: Optional[Dict[str, Any]] = None,
    database: Optional[str] = None
) -> Dict[str, Any]:
    """
    执行写入操作（CREATE, MERGE, SET, DELETE 等）

    Args:
        query: Cypher 查询语句
        parameters: 查询参数
        database: 数据库名称（可选）

    Returns:
        执行结果统计信息
    """
    async with get_session() as session:
        result = await session.run(query, parameters or {})
        summary = await result.consume()

        return {
            "nodes_created": summary.counters.nodes_created,
            "relationships_created": summary.counters.relationships_created,
            "properties_set": summary.counters.properties_set,
            "nodes_deleted": summary.counters.nodes_deleted,
            "relationships_deleted": summary.counters.relationships_deleted,
        }


async def check_constraint_exists(constraint_name: str) -> bool:
    """
    检查约束是否存在（幂等性检查）

    Args:
        constraint_name: 约束名称

    Returns:
        bool: 约束是否存在
    """
    query = "SHOW CONSTRAINTS YIELD name WHERE name = $constraint_name RETURN count(*) > 0 as exists"

    try:
        result = await execute_query(query, {"constraint_name": constraint_name})
        return result[0]["exists"] if result else False
    except Exception as e:
        # 兼容旧版 Neo4j（不支持 SHOW CONSTRAINTS）
        logger.debug(f"SHOW CONSTRAINTS not supported, using legacy method: {e}")

        # 使用 CALL db.constraints() 作为回退
        query_legacy = """
        CALL db.constraints() YIELD name
        WHERE name = $constraint_name
        RETURN count(*) > 0 as exists
        """
        result = await execute_query(query_legacy, {"constraint_name": constraint_name})
        return result[0]["exists"] if result else False


async def check_index_exists(index_name: str) -> bool:
    """
    检查索引是否存在（幂等性检查）

    Args:
        index_name: 索引名称

    Returns:
        bool: 索引是否存在
    """
    query = "SHOW INDEXES YIELD name WHERE name = $index_name RETURN count(*) > 0 as exists"

    try:
        result = await execute_query(query, {"index_name": index_name})
        return result[0]["exists"] if result else False
    except Exception as e:
        # 兼容旧版 Neo4j
        logger.debug(f"SHOW INDEXES not supported, using legacy method: {e}")

        query_legacy = """
        CALL db.indexes() YIELD name
        WHERE name = $index_name
        RETURN count(*) > 0 as exists
        """
        result = await execute_query(query_legacy, {"index_name": index_name})
        return result[0]["exists"] if result else False


async def create_constraint_if_not_exists(constraint_name: str, constraint_query: str):
    """
    创建约束（幂等）

    Args:
        constraint_name: 约束名称
        constraint_query: 创建约束的 Cypher 语句
    """
    exists = await check_constraint_exists(constraint_name)

    if exists:
        logger.debug(f"⏭️  Constraint already exists: {constraint_name}")
        return

    try:
        await execute_write(constraint_query)
        logger.info(f"✅ Created constraint: {constraint_name}")
    except Exception as e:
        logger.warning(f"⚠️  Failed to create constraint {constraint_name}: {e}")


async def create_index_if_not_exists(index_name: str, index_query: str):
    """
    创建索引（幂等）

    Args:
        index_name: 索引名称
        index_query: 创建索引的 Cypher 语句
    """
    exists = await check_index_exists(index_name)

    if exists:
        logger.debug(f"⏭️  Index already exists: {index_name}")
        return

    try:
        await execute_write(index_query)
        logger.info(f"✅ Created index: {index_name}")
    except Exception as e:
        logger.warning(f"⚠️  Failed to create index {index_name}: {e}")


async def get_database_stats() -> Dict[str, Any]:
    """
    获取数据库统计信息

    Returns:
        统计信息字典
    """
    queries = {
        "student_count": "MATCH (s:Student) RETURN count(s) as count",
        "concept_count": "MATCH (c:Concept) RETURN count(c) as count",
        "interaction_count": "MATCH ()-[r:INTERACTED_WITH]->() RETURN count(r) as count",
        "relation_count": "MATCH ()-[r:REL]->() RETURN count(r) as count",
    }

    stats = {}
    for key, query in queries.items():
        try:
            result = await execute_query(query)
            stats[key] = result[0]["count"] if result else 0
        except Exception as e:
            logger.error(f"Failed to get stats for {key}: {e}")
            stats[key] = -1

    return stats
