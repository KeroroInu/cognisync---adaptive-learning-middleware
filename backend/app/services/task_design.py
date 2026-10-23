"""Student-authored design versions stored in the existing immutable evidence ledger."""
from uuid import UUID

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select

from app.models.sql import PreparationRecord
from app.services.drawio import diagram_models


class ModuleNode(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    id: str = Field(pattern=r'^[A-Za-z0-9_-]{1,100}$')
    title: str = Field(min_length=1, max_length=32)
    purpose: str = Field(default='', max_length=300)
    x: float = Field(ge=0, le=830, allow_inf_nan=False)
    y: float = Field(ge=0, le=516, allow_inf_nan=False)


class ModuleLink(BaseModel):
    model_config = ConfigDict(extra='forbid')
    source: str = Field(max_length=100)
    target: str = Field(max_length=100)


class DesignInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_id: UUID
    base_revision: int = Field(ge=0)
    requirements: str = Field(default='', max_length=6000)
    nodes: list[ModuleNode] = Field(default_factory=list, max_length=24)
    edges: list[ModuleLink] = Field(default_factory=list, max_length=48)
    drawio_xml: str | None = Field(default=None, max_length=250000)

    @model_validator(mode='after')
    def valid_links(self):
        if self.drawio_xml:
            diagram_models(self.drawio_xml)
        ids = {node.id for node in self.nodes}
        if len(ids) != len(self.nodes):
            raise ValueError('模块编号不能重复')
        links = {(edge.source, edge.target) for edge in self.edges}
        if len(links) != len(self.edges) or any(a not in ids or b not in ids or a == b for a, b in links):
            raise ValueError('连接必须指向两个不同的现有模块，且不能重复')
        return self


def design_query(user_id, project_id):
    return select(PreparationRecord).where(PreparationRecord.user_id == user_id, PreparationRecord.kind == 'design',
        PreparationRecord.payload['schema'].astext == 'sfls-design/1', PreparationRecord.payload['project_id'].astext == project_id)


async def design_pair(db, user_id, project_id):
    query = design_query(user_id, project_id)
    initial = await db.scalar(query.order_by(PreparationRecord.created_at, PreparationRecord.id).limit(1))
    current = await db.scalar(query.order_by(PreparationRecord.created_at.desc(), PreparationRecord.id.desc()).limit(1))
    return {'initial': initial.payload if initial else None, 'current': current.payload if current else None,
            'revision': current.payload['revision'] if current else 0}


def ensure_design_material(item):
    if item.kind != 'sfls':
        raise HTTPException(422, '请在 SFLS 任务中保存设计')
