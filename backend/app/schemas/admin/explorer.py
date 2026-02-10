"""
数据浏览器 Schema 定义
"""
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field


class TableInfo(BaseModel):
    """表信息"""
    name: str = Field(..., description="表名")
    rowCount: int = Field(..., description="行数")
    canView: bool = Field(default=True, description="是否可查看")


class TableListResponse(BaseModel):
    """表列表响应"""
    tables: List[TableInfo] = Field(..., description="表列表")


class ColumnInfo(BaseModel):
    """列信息"""
    name: str = Field(..., description="列名")
    type: str = Field(..., description="数据类型")
    nullable: bool = Field(..., description="是否可为空")
    primary_key: bool = Field(default=False, description="是否为主键")


class TableSchemaResponse(BaseModel):
    """表结构响应"""
    table: str = Field(..., description="表名")
    columns: List[ColumnInfo] = Field(..., description="列信息列表")


class PaginationInfo(BaseModel):
    """分页信息"""
    page: int = Field(..., description="当前页码", ge=1)
    pageSize: int = Field(..., description="每页行数", ge=1, le=100)
    total: int = Field(..., description="总行数")
    totalPages: int = Field(..., description="总页数")


class TableDataResponse(BaseModel):
    """表数据响应"""
    table: str = Field(..., description="表名")
    rows: List[Dict[str, Any]] = Field(..., description="数据行列表")
    pagination: PaginationInfo = Field(..., description="分页信息")
