"""
Graph Service - 知识图谱服务（Neo4j）
与前端契约完全对齐
"""
import logging
from typing import List, Optional, Dict, Any
from datetime import datetime
import re

from app.db.neo4j import execute_query, execute_write
from app.schemas.graph import Node, Edge, GraphData, UpdateNodeRequest

logger = logging.getLogger(__name__)


class GraphService:
    """知识图谱服务"""

    @staticmethod
    def _slugify(name: str) -> str:
        """
        将概念名称转换为 slug 格式的 uid

        Args:
            name: 概念名称（如"神经网络"）

        Returns:
            slug 格式的 uid（如"concept-神经网络"）
        """
        # 移除特殊字符，保留中英文、数字、空格
        cleaned = re.sub(r'[^\w\s\u4e00-\u9fff-]', '', name)
        # 转换空格为连字符
        slug = cleaned.strip().replace(' ', '-')
        return f"concept-{slug}"

    async def upsert_concepts(
        self,
        user_id: str,
        concepts: List[str]
    ) -> Dict[str, Any]:
        """
        为用户创建或更新概念节点，并建立 INTERACTED_WITH 关系

        流程：
        1. 确保 Student 节点存在
        2. 为每个 concept 创建/更新 Concept 节点（uid 使用 slugify）
        3. 建立/更新 INTERACTED_WITH 关系（count +1，mastery 初始化为 0.5）

        Args:
            user_id: 用户 ID
            concepts: 概念名称列表（如 ["神经网络", "反向传播"]）

        Returns:
            {
                "created_concepts": 新创建的概念数,
                "updated_relationships": 更新的关系数
            }
        """
        if not concepts:
            return {"created_concepts": 0, "updated_relationships": 0}

        logger.info(f"Upserting {len(concepts)} concepts for user {user_id}")

        # 1. 确保 Student 节点存在
        student_query = """
        MERGE (s:Student {id: $user_id})
        ON CREATE SET s.createdAt = datetime()
        RETURN s.id as userId
        """
        await execute_write(student_query, {"user_id": user_id})

        # 2. 批量创建/更新 Concept 节点和 INTERACTED_WITH 关系
        concepts_data = [
            {
                "uid": self._slugify(name),
                "name": name,
                "description": f"学习者提到的概念：{name}"
            }
            for name in concepts
        ]

        upsert_query = """
        MATCH (s:Student {id: $user_id})
        UNWIND $concepts as concept
        MERGE (c:Concept {uid: concept.uid})
        ON CREATE SET
            c.name = concept.name,
            c.description = concept.description,
            c.createdAt = datetime()
        ON MATCH SET
            c.name = concept.name

        MERGE (s)-[r:INTERACTED_WITH]->(c)
        ON CREATE SET
            r.count = 1,
            r.mastery = 0.5,
            r.isFlagged = false,
            r.lastUpdated = datetime()
        ON MATCH SET
            r.count = r.count + 1,
            r.lastUpdated = datetime()

        RETURN
            count(DISTINCT c) as created_concepts,
            count(DISTINCT r) as updated_relationships
        """

        result = await execute_write(
            upsert_query,
            {"user_id": user_id, "concepts": concepts_data}
        )

        stats = result[0] if result else {"created_concepts": 0, "updated_relationships": 0}

        logger.info(
            f"Upserted concepts for user {user_id}: "
            f"{stats.get('created_concepts', 0)} concepts, "
            f"{stats.get('updated_relationships', 0)} relationships"
        )

        return stats

    async def get_graph(self, user_id: str) -> GraphData:
        """
        获取用户的知识图谱（nodes + edges）

        返回结构与前端契约完全对齐：
        - Node: {id, name, mastery, frequency, description, isFlagged}
        - Edge: {source, target}

        Args:
            user_id: 用户 ID

        Returns:
            GraphData 对象（包含 nodes 和 edges）
        """
        logger.info(f"Fetching knowledge graph for user {user_id}")

        # 1. 获取节点（Student 的所有 INTERACTED_WITH 关系）
        nodes_query = """
        MATCH (s:Student {id: $user_id})-[r:INTERACTED_WITH]->(c:Concept)
        RETURN
            c.uid as id,
            c.name as name,
            c.description as description,
            r.mastery * 100 as mastery,
            CASE
                WHEN r.count > 10 THEN 10
                ELSE r.count
            END as frequency,
            COALESCE(r.isFlagged, false) as isFlagged
        ORDER BY r.lastUpdated DESC
        """

        nodes_result = await execute_query(nodes_query, {"user_id": user_id})

        nodes = [
            Node(
                id=row["id"],
                name=row["name"],
                description=row.get("description", ""),
                mastery=float(row["mastery"]),
                frequency=int(row["frequency"]),
                isFlagged=row.get("isFlagged", False)
            )
            for row in (nodes_result or [])
        ]

        # 2. 获取边（Concept 之间的关系）
        edges_query = """
        MATCH (s:Student {id: $user_id})-[:INTERACTED_WITH]->(c1:Concept)
        MATCH (s)-[:INTERACTED_WITH]->(c2:Concept)
        MATCH (c1)-[:REL]->(c2)
        RETURN DISTINCT c1.uid as source, c2.uid as target
        """

        edges_result = await execute_query(edges_query, {"user_id": user_id})

        edges = [
            Edge(source=row["source"], target=row["target"])
            for row in (edges_result or [])
        ]

        logger.info(f"Retrieved graph for user {user_id}: {len(nodes)} nodes, {len(edges)} edges")

        return GraphData(nodes=nodes, edges=edges)

    async def update_node(
        self,
        user_id: str,
        node_id: str,
        updates: UpdateNodeRequest
    ) -> Optional[Node]:
        """
        更新知识节点（在 Student->Concept 的 INTERACTED_WITH 关系上）

        可更新字段：
        - mastery: 掌握度 [0-100]（用户校准）
        - isFlagged: 是否标记/质疑

        Args:
            user_id: 用户 ID
            node_id: 节点 ID（Concept uid）
            updates: 更新内容

        Returns:
            更新后的 Node 对象（如果节点不存在则返回 None）
        """
        logger.info(f"Updating node {node_id} for user {user_id}: {updates.model_dump(exclude_none=True)}")

        # 构建动态 SET 子句
        set_clauses = []
        params = {"user_id": user_id, "node_id": node_id}

        if updates.mastery is not None:
            # 前端传入 0-100，Neo4j 存储 0.0-1.0
            set_clauses.append("r.mastery = $mastery")
            params["mastery"] = updates.mastery / 100.0

        if updates.isFlagged is not None:
            set_clauses.append("r.isFlagged = $isFlagged")
            params["isFlagged"] = updates.isFlagged

        if not set_clauses:
            logger.warning("No updates provided")
            # 即使没有更新，也返回当前节点
            return await self._get_single_node(user_id, node_id)

        # 添加 lastUpdated 时间戳
        set_clauses.append("r.lastUpdated = datetime()")

        update_query = f"""
        MATCH (s:Student {{id: $user_id}})-[r:INTERACTED_WITH]->(c:Concept {{uid: $node_id}})
        SET {', '.join(set_clauses)}
        RETURN
            c.uid as id,
            c.name as name,
            c.description as description,
            r.mastery * 100 as mastery,
            CASE
                WHEN r.count > 10 THEN 10
                ELSE r.count
            END as frequency,
            COALESCE(r.isFlagged, false) as isFlagged
        """

        result = await execute_write(update_query, params)

        if not result:
            logger.warning(f"Node not found or update failed: {node_id}")
            return None

        row = result[0]
        node = Node(
            id=row["id"],
            name=row["name"],
            description=row.get("description", ""),
            mastery=float(row["mastery"]),
            frequency=int(row["frequency"]),
            isFlagged=row.get("isFlagged", False)
        )

        logger.info(f"Node updated successfully: {node_id}")
        return node

    async def _get_single_node(self, user_id: str, node_id: str) -> Optional[Node]:
        """内部方法：获取单个节点"""
        query = """
        MATCH (s:Student {id: $user_id})-[r:INTERACTED_WITH]->(c:Concept {uid: $node_id})
        RETURN
            c.uid as id,
            c.name as name,
            c.description as description,
            r.mastery * 100 as mastery,
            CASE
                WHEN r.count > 10 THEN 10
                ELSE r.count
            END as frequency,
            COALESCE(r.isFlagged, false) as isFlagged
        """

        result = await execute_query(query, {"user_id": user_id, "node_id": node_id})

        if not result:
            return None

        row = result[0]
        return Node(
            id=row["id"],
            name=row["name"],
            description=row.get("description", ""),
            mastery=float(row["mastery"]),
            frequency=int(row["frequency"]),
            isFlagged=row.get("isFlagged", False)
        )
