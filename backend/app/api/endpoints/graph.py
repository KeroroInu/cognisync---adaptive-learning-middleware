"""
Knowledge Graph Endpoint - 知识图谱接口
"""
import logging
from fastapi import APIRouter, HTTPException
from app.schemas.base import SuccessResponse
from app.schemas.graph import UpdateNodeRequest
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
