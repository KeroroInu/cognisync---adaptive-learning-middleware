"""
数据浏览器 API 端点
提供数据库表的可视化和导出功能
"""
from fastapi import APIRouter, Depends, Query, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import verify_admin_key
from app.db.postgres import get_db
from app.schemas.base import SuccessResponse
from app.schemas.admin.explorer import (
    TableListResponse,
    TableSchemaResponse,
    TableDataResponse,
    TableInfo,
    ColumnInfo,
    PaginationInfo
)

router = APIRouter(tags=["Admin - Data Explorer"])

# 白名单：允许查看的表
ALLOWED_TABLES = ["users", "chat_messages", "profile_snapshots", "calibration_logs"]

# 黑名单：敏感字段（不返回给前端）
SENSITIVE_FIELDS = ["hashed_password", "password", "token", "api_key", "secret", "refresh_token"]


@router.get("/tables", dependencies=[Depends(verify_admin_key)])
async def list_tables(
    db: AsyncSession = Depends(get_db)
) -> SuccessResponse[TableListResponse]:
    """
    列出所有可视化表

    需要 Admin Key 认证（X-ADMIN-KEY Header）

    Returns:
        包含表列表和行数的响应
    """
    # 直接查询数据库获取所有表（PostgreSQL 语法）
    result = await db.execute(text("""
        SELECT tablename
        FROM pg_catalog.pg_tables
        WHERE schemaname = 'public'
    """))
    all_tables = [row[0] for row in result]

    tables_info = []
    for table in ALLOWED_TABLES:
        if table in all_tables:
            # 获取表的行数
            count_result = await db.execute(text(f"SELECT COUNT(*) FROM {table}"))
            count = count_result.scalar()
            tables_info.append(TableInfo(
                name=table,
                rowCount=count,
                canView=True
            ))

    return SuccessResponse(data=TableListResponse(tables=tables_info))


@router.get("/tables/{table_name}/schema", dependencies=[Depends(verify_admin_key)])
async def get_table_schema(
    table_name: str,
    db: AsyncSession = Depends(get_db)
) -> SuccessResponse[TableSchemaResponse]:
    """
    获取表结构信息

    Args:
        table_name: 表名

    Returns:
        包含列信息的表结构

    Raises:
        HTTPException: 403 如果表不在白名单中
    """
    if table_name not in ALLOWED_TABLES:
        raise HTTPException(
            status_code=403,
            detail=f"Table '{table_name}' is not allowed for viewing"
        )

    # 使用 SQL 查询获取列信息（PostgreSQL）
    result = await db.execute(text("""
        SELECT
            column_name,
            data_type,
            is_nullable,
            column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = :table_name
        ORDER BY ordinal_position
    """), {"table_name": table_name})

    # 获取主键信息
    pk_result = await db.execute(text("""
        SELECT a.attname
        FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = :table_name::regclass
        AND i.indisprimary
    """), {"table_name": table_name})

    primary_keys = {row[0] for row in pk_result}

    # 构建列信息
    columns_info = []
    for row in result:
        column_name = row[0]
        # 过滤敏感字段
        if column_name not in SENSITIVE_FIELDS:
            columns_info.append(ColumnInfo(
                name=column_name,
                type=row[1],
                nullable=(row[2] == 'YES'),
                primary_key=(column_name in primary_keys)
            ))

    return SuccessResponse(data=TableSchemaResponse(
        table=table_name,
        columns=columns_info
    ))


@router.get("/tables/{table_name}/data", dependencies=[Depends(verify_admin_key)])
async def get_table_data(
    table_name: str,
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(50, ge=1, le=100, description="每页行数"),
    order_by: str = Query(None, description="排序字段"),
    db: AsyncSession = Depends(get_db)
) -> SuccessResponse[TableDataResponse]:
    """
    获取表数据（分页）

    Args:
        table_name: 表名
        page: 页码（从 1 开始）
        page_size: 每页行数（1-100）
        order_by: 排序字段（可选）

    Returns:
        包含数据行和分页信息的响应

    Raises:
        HTTPException: 403 如果表不在白名单中
    """
    if table_name not in ALLOWED_TABLES:
        raise HTTPException(
            status_code=403,
            detail=f"Table '{table_name}' is not allowed for viewing"
        )

    offset = (page - 1) * page_size

    # 获取总行数
    result = await db.execute(text(f"SELECT COUNT(*) FROM {table_name}"))
    total = result.scalar()

    # 构建查询（防止 SQL 注入：只允许白名单表和列）
    order_clause = ""
    if order_by:
        # 简单验证：order_by 应该是有效的列名（字母数字下划线）
        if order_by.replace("_", "").isalnum():
            order_clause = f"ORDER BY {order_by}"

    query = f"SELECT * FROM {table_name} {order_clause} LIMIT {page_size} OFFSET {offset}"
    result = await db.execute(text(query))

    rows = []
    for row in result.mappings():
        # 过滤敏感字段
        row_dict = {
            k: (str(v) if not isinstance(v, (int, float, bool, type(None))) else v)
            for k, v in row.items()
            if k not in SENSITIVE_FIELDS
        }
        rows.append(row_dict)

    # 计算总页数
    total_pages = (total + page_size - 1) // page_size

    return SuccessResponse(data=TableDataResponse(
        table=table_name,
        rows=rows,
        pagination=PaginationInfo(
            page=page,
            pageSize=page_size,
            total=total,
            totalPages=total_pages
        )
    ))


@router.get("/tables/{table_name}/export", dependencies=[Depends(verify_admin_key)])
async def export_table(
    table_name: str,
    db: AsyncSession = Depends(get_db)
) -> JSONResponse:
    """
    导出表数据为 JSON

    Args:
        table_name: 表名

    Returns:
        JSON 格式的完整表数据

    Raises:
        HTTPException: 403 如果表不在白名单中
    """
    if table_name not in ALLOWED_TABLES:
        raise HTTPException(
            status_code=403,
            detail=f"Table '{table_name}' is not allowed for export"
        )

    # 获取所有数据
    result = await db.execute(text(f"SELECT * FROM {table_name}"))
    rows = [dict(row._mapping) for row in result]

    # 过滤敏感字段并转换为可序列化格式
    rows_filtered = [
        {
            k: (str(v) if not isinstance(v, (int, float, bool, type(None))) else v)
            for k, v in row.items()
            if k not in SENSITIVE_FIELDS
        }
        for row in rows
    ]

    return JSONResponse(content={
        "table": table_name,
        "rowCount": len(rows_filtered),
        "data": rows_filtered
    })
