"""
种子数据脚本 - 为测试用户创建初始知识图谱
运行方式: poetry run python scripts/seed_graph.py
"""
import asyncio
import logging
from typing import List, Dict, Any
from app.db.neo4j import init_db, close_db, execute_write, execute_query
from app.core.config import settings
from app.core.logging import setup_logging

setup_logging()
logger = logging.getLogger(__name__)


# 默认测试用户 ID
DEFAULT_USER_ID = "test-user-001"


# 示例概念数据（与前端 INITIAL_NODES 对应）
SAMPLE_CONCEPTS = [
    {
        "uid": "concept-1",
        "name": "神经网络",
        "description": "受生物神经网络启发的计算系统，由互连的人工神经元层组成。",
    },
    {
        "uid": "concept-2",
        "name": "反向传播",
        "description": "用于训练神经网络的算法，通过计算梯度来更新权重。",
    },
    {
        "uid": "concept-3",
        "name": "梯度下降",
        "description": "通过迭代移动来最小化函数的优化算法。",
    },
    {
        "uid": "concept-4",
        "name": "激活函数",
        "description": "向神经网络引入非线性的数学函数。",
    },
    {
        "uid": "concept-5",
        "name": "过拟合",
        "description": "模型学习训练数据的细节和噪声过度，影响新数据表现。",
    },
]


# 概念之间的关系（与前端 INITIAL_EDGES 对应）
SAMPLE_RELATIONS = [
    {"source": "concept-1", "target": "concept-2", "type": "PREREQUISITE_OF"},
    {"source": "concept-1", "target": "concept-4", "type": "INCLUDES"},
    {"source": "concept-2", "target": "concept-3", "type": "USES"},
    {"source": "concept-1", "target": "concept-5", "type": "RELATED_TO"},
]


async def create_student(user_id: str) -> Dict[str, Any]:
    """
    创建学生节点（幂等）

    Args:
        user_id: 用户 ID

    Returns:
        执行结果统计
    """
    query = """
    MERGE (s:Student {id: $user_id})
    ON CREATE SET s.createdAt = datetime()
    RETURN s.id as userId, s.createdAt as createdAt
    """

    result = await execute_query(query, {"user_id": user_id})

    if result:
        logger.info(f"✅ Student node: {result[0]['userId']}")

    return result[0] if result else {}


async def create_concepts(concepts: List[Dict[str, Any]]) -> int:
    """
    批量创建概念节点（幂等）

    Args:
        concepts: 概念列表

    Returns:
        创建的节点数量
    """
    query = """
    UNWIND $concepts as concept
    MERGE (c:Concept {uid: concept.uid})
    ON CREATE SET
        c.name = concept.name,
        c.description = concept.description,
        c.createdAt = datetime()
    ON MATCH SET
        c.name = concept.name,
        c.description = concept.description
    RETURN count(c) as count
    """

    result = await execute_query(query, {"concepts": concepts})
    count = result[0]["count"] if result else 0

    logger.info(f"✅ Created/updated {count} concept nodes")
    return count


async def create_concept_relations(relations: List[Dict[str, str]]) -> int:
    """
    批量创建概念之间的关系（幂等）

    Args:
        relations: 关系列表 [{source, target, type}]

    Returns:
        创建的关系数量
    """
    query = """
    UNWIND $relations as rel
    MATCH (source:Concept {uid: rel.source})
    MATCH (target:Concept {uid: rel.target})
    MERGE (source)-[r:REL {type: rel.type}]->(target)
    ON CREATE SET r.createdAt = datetime()
    RETURN count(r) as count
    """

    result = await execute_query(query, {"relations": relations})
    count = result[0]["count"] if result else 0

    logger.info(f"✅ Created {count} concept relations")
    return count


async def create_interactions(user_id: str, concepts: List[Dict[str, Any]]) -> int:
    """
    创建学生与概念的交互关系（带初始数据）

    Args:
        user_id: 用户 ID
        concepts: 概念列表

    Returns:
        创建的关系数量
    """
    # 为每个概念生成初始交互数据
    interactions = []

    # 不同概念的初始掌握度（与前端 INITIAL_NODES 对应）
    mastery_map = {
        "concept-1": 0.85,  # 神经网络 - 掌握很好
        "concept-2": 0.45,  # 反向传播 - 一般
        "concept-3": 0.60,  # 梯度下降 - 中等
        "concept-4": 0.70,  # 激活函数 - 良好
        "concept-5": 0.30,  # 过拟合 - 薄弱
    }

    frequency_map = {
        "concept-1": 8,
        "concept-2": 5,
        "concept-3": 6,
        "concept-4": 7,
        "concept-5": 7,
    }

    for concept in concepts:
        uid = concept["uid"]
        interactions.append({
            "concept_uid": uid,
            "count": frequency_map.get(uid, 5),
            "mastery": mastery_map.get(uid, 0.5),
            # 情感维度（示例数据，实际应从对话分析获得）
            "joy": 0.6,
            "trust": 0.7,
            "fear": 0.2,
            "surprise": 0.3,
            "sadness": 0.1,
            "disgust": 0.05,
            "anger": 0.05,
            "anticipation": 0.5,
        })

    query = """
    MATCH (s:Student {id: $user_id})
    UNWIND $interactions as interaction
    MATCH (c:Concept {uid: interaction.concept_uid})
    MERGE (s)-[r:INTERACTED_WITH]->(c)
    SET r.count = interaction.count,
        r.mastery = interaction.mastery,
        r.joy = interaction.joy,
        r.trust = interaction.trust,
        r.fear = interaction.fear,
        r.surprise = interaction.surprise,
        r.sadness = interaction.sadness,
        r.disgust = interaction.disgust,
        r.anger = interaction.anger,
        r.anticipation = interaction.anticipation,
        r.lastUpdated = datetime()
    RETURN count(r) as count
    """

    result = await execute_query(
        query,
        {"user_id": user_id, "interactions": interactions}
    )
    count = result[0]["count"] if result else 0

    logger.info(f"✅ Created {count} student-concept interactions")
    return count


async def verify_graph(user_id: str):
    """验证图数据是否正确创建"""
    logger.info("🔍 Verifying graph data...")

    # 检查学生节点
    student_query = "MATCH (s:Student {id: $user_id}) RETURN s"
    student_result = await execute_query(student_query, {"user_id": user_id})

    if student_result:
        logger.info(f"✅ Student node exists: {user_id}")
    else:
        logger.error(f"❌ Student node not found: {user_id}")

    # 检查概念数量
    concept_count_query = "MATCH (c:Concept) RETURN count(c) as count"
    concept_count = await execute_query(concept_count_query)
    logger.info(f"📊 Total concepts: {concept_count[0]['count']}")

    # 检查学生的交互关系
    interaction_query = """
    MATCH (s:Student {id: $user_id})-[r:INTERACTED_WITH]->(c:Concept)
    RETURN c.name as concept, r.mastery as mastery, r.count as count
    ORDER BY r.mastery DESC
    """
    interactions = await execute_query(interaction_query, {"user_id": user_id})

    logger.info(f"📊 Student interactions: {len(interactions)}")
    for interaction in interactions:
        logger.info(
            f"  - {interaction['concept']}: mastery={interaction['mastery']:.2f}, count={interaction['count']}"
        )

    # 检查概念关系
    relation_query = """
    MATCH (source:Concept)-[r:REL]->(target:Concept)
    RETURN source.name as source, r.type as type, target.name as target
    """
    relations = await execute_query(relation_query)

    logger.info(f"📊 Concept relations: {len(relations)}")
    for rel in relations:
        logger.info(f"  - {rel['source']} -[{rel['type']}]-> {rel['target']}")


async def clear_user_graph(user_id: str):
    """
    清除指定用户的所有图数据（用于重新初始化）

    Args:
        user_id: 用户 ID
    """
    logger.warning(f"⚠️  Clearing all graph data for user: {user_id}")

    # 删除学生节点及其所有关系
    query = """
    MATCH (s:Student {id: $user_id})
    DETACH DELETE s
    """

    result = await execute_write(query, {"user_id": user_id})
    logger.info(f"✅ Deleted {result['nodes_deleted']} nodes and {result['relationships_deleted']} relationships")


async def seed_graph(user_id: str, clear_existing: bool = False):
    """
    初始化知识图谱数据

    Args:
        user_id: 用户 ID
        clear_existing: 是否清除已有数据
    """
    logger.info(f"🌱 Seeding graph data for user: {user_id}")

    try:
        # 可选：清除已有数据
        if clear_existing:
            await clear_user_graph(user_id)

        # 1. 创建学生节点
        await create_student(user_id)

        # 2. 创建概念节点
        await create_concepts(SAMPLE_CONCEPTS)

        # 3. 创建概念之间的关系
        await create_concept_relations(SAMPLE_RELATIONS)

        # 4. 创建学生与概念的交互关系
        await create_interactions(user_id, SAMPLE_CONCEPTS)

        # 5. 验证数据
        await verify_graph(user_id)

        logger.info("🎉 Graph seeding completed successfully!")

    except Exception as e:
        logger.error(f"❌ Graph seeding failed: {e}", exc_info=True)
        raise


async def main():
    """主函数"""
    import sys

    # 解析命令行参数
    user_id = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_USER_ID
    clear_existing = "--clear" in sys.argv

    logger.info("🚀 Starting graph seeding...")
    logger.info(f"📍 User ID: {user_id}")
    logger.info(f"📍 Clear existing: {clear_existing}")

    try:
        # 连接数据库
        await init_db()

        # 初始化图数据
        await seed_graph(user_id, clear_existing)

    finally:
        # 关闭连接
        await close_db()


if __name__ == "__main__":
    asyncio.run(main())
