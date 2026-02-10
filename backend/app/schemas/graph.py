"""
Graph Schemas - 知识图谱数据结构
与前端契约完全对齐
"""
from typing import Optional, List
from pydantic import BaseModel, Field


class Node(BaseModel):
    """知识图谱节点（前端契约）"""
    id: str = Field(..., description="节点 ID（Concept uid）")
    name: str = Field(..., description="概念名称")
    mastery: float = Field(..., ge=0, le=100, description="掌握度 [0-100]")
    frequency: int = Field(..., ge=1, le=10, description="出现频率 [1-10]（影响节点大小）")
    description: str = Field(default="", description="概念描述")
    x: Optional[float] = Field(None, description="节点 X 坐标（可选）")
    y: Optional[float] = Field(None, description="节点 Y 坐标（可选）")
    isFlagged: Optional[bool] = Field(False, description="用户是否标记/质疑")


class Edge(BaseModel):
    """知识图谱边（前端契约）"""
    source: str = Field(..., description="源节点 ID")
    target: str = Field(..., description="目标节点 ID")


class GraphData(BaseModel):
    """完整的知识图谱数据"""
    nodes: List[Node] = Field(default_factory=list, description="节点列表")
    edges: List[Edge] = Field(default_factory=list, description="边列表")


class UpdateNodeRequest(BaseModel):
    """更新节点请求"""
    mastery: Optional[float] = Field(None, ge=0, le=100, description="更新掌握度")
    isFlagged: Optional[bool] = Field(None, description="更新标记状态")
