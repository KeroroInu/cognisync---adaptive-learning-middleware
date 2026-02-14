"""
Knowledge Graph Endpoint - 知识图谱接口
"""
import logging
from fastapi import APIRouter, HTTPException
from app.schemas.base import SuccessResponse
from app.schemas.graph import UpdateNodeRequest, CreateNodeRequest, CreateEdgeRequest
from app.services.graph_service import GraphService

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/{userId}")
async def get_knowledge_graph(userId: str):
    """获取用户的知识图谱"""
    logger.info(f"Fetching knowledge graph for user: {userId}")

    try:
        graph_service = GraphService()
        graph_data = await graph_service.get_graph(userId)

        return SuccessResponse(data=graph_data.model_dump())

    except Exception as e:
        logger.error(f"Failed to fetch graph for user {userId}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to fetch knowledge graph: {str(e)}")


@router.post("/node")
async def create_node(userId: str, node_data: CreateNodeRequest):
    """创建新的知识节点"""
    logger.info(f"Creating node '{node_data.name}' for user {userId}")

    try:
        graph_service = GraphService()
        new_node = await graph_service.create_node(
            userId,
            node_data.name,
            node_data.description or "",
            node_data.mastery or 50.0
        )

        return SuccessResponse(data=new_node.model_dump())

    except Exception as e:
        logger.error(f"Failed to create node: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to create node: {str(e)}")


@router.put("/node/{nodeId}")
async def update_node(userId: str, nodeId: str, updates: UpdateNodeRequest):
    """更新知识节点"""
    logger.info(f"Updating node {nodeId} for user {userId}")

    try:
        graph_service = GraphService()
        updated_node = await graph_service.update_node(userId, nodeId, updates)

        if not updated_node:
            raise HTTPException(status_code=404, detail=f"Node {nodeId} not found for user {userId}")

        return SuccessResponse(data=updated_node.model_dump())

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update node {nodeId}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to update node: {str(e)}")


@router.delete("/node/{nodeId}")
async def delete_node(userId: str, nodeId: str):
    """删除知识节点"""
    logger.info(f"Deleting node {nodeId} for user {userId}")

    try:
        graph_service = GraphService()
        deleted = await graph_service.delete_node(userId, nodeId)

        if not deleted:
            raise HTTPException(status_code=404, detail=f"Node {nodeId} not found for user {userId}")

        return SuccessResponse(data={"deleted": True, "nodeId": nodeId})

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete node {nodeId}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to delete node: {str(e)}")


@router.post("/edge")
async def create_edge(userId: str, edge_data: CreateEdgeRequest):
    """创建概念之间的关系"""
    logger.info(f"Creating edge {edge_data.source} -> {edge_data.target} for user {userId}")

    try:
        graph_service = GraphService()
        new_edge = await graph_service.create_edge(userId, edge_data.source, edge_data.target)

        return SuccessResponse(data=new_edge.model_dump())

    except Exception as e:
        logger.error(f"Failed to create edge: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to create edge: {str(e)}")


@router.delete("/edge")
async def delete_edge(userId: str, source: str, target: str):
    """删除概念之间的关系"""
    logger.info(f"Deleting edge {source} -> {target} for user {userId}")

    try:
        graph_service = GraphService()
        deleted = await graph_service.delete_edge(userId, source, target)

        if not deleted:
            raise HTTPException(status_code=404, detail=f"Edge {source} -> {target} not found")

        return SuccessResponse(data={"deleted": True, "source": source, "target": target})

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete edge: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to delete edge: {str(e)}")
