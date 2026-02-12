"""
Admin 量表管理 Schema
"""
from datetime import datetime
from typing import Optional, List, Dict, Any
from uuid import UUID
from pydantic import BaseModel, Field, field_validator


class ScaleTemplateItem(BaseModel):
    """量表模板项"""
    id: UUID
    name: str
    version: int
    status: str
    created_at: datetime
    updated_at: datetime
    responses_count: int = 0


class ScaleTemplateDetail(BaseModel):
    """量表模板详情"""
    id: UUID
    name: str
    version: int
    status: str
    schema_json: Dict[str, Any]
    scoring_json: Optional[Dict[str, Any]] = None
    mapping_json: Optional[Dict[str, Any]] = None
    created_at: datetime
    updated_at: datetime


class ScaleTemplateUpload(BaseModel):
    """量表模板上传"""
    name: str = Field(..., min_length=1, max_length=200)
    schema_json: Dict[str, Any] = Field(..., description="量表结构 JSON")
    scoring_json: Optional[Dict[str, Any]] = Field(None, description="计分规则 JSON")
    mapping_json: Optional[Dict[str, Any]] = Field(None, description="维度映射 JSON")

    @field_validator('schema_json')
    @classmethod
    def validate_schema(cls, v):
        """验证 schema 必须包含基本字段"""
        if not isinstance(v, dict):
            raise ValueError("schema_json must be a dict")
        if 'questions' not in v:
            raise ValueError("schema_json must contain 'questions' field")
        if not isinstance(v['questions'], list):
            raise ValueError("questions must be a list")
        return v


class ScaleTemplateUpdate(BaseModel):
    """量表模板更新"""
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    schema_json: Optional[Dict[str, Any]] = None
    scoring_json: Optional[Dict[str, Any]] = None
    mapping_json: Optional[Dict[str, Any]] = None


class ScaleTemplatesResponse(BaseModel):
    """量表模板列表响应"""
    templates: List[ScaleTemplateItem]
    total: int
