"""
Admin API Router - 聚合所有 admin 端点
"""
from fastapi import APIRouter

from app.api.endpoints.admin import (
    explorer,
    users,
    analytics,
    overview,
    user_detail,
    scales,
    export as db_export,
    sessions
)

# 创建 admin 主路由
admin_router = APIRouter(prefix="/admin")

# 注册子路由
admin_router.include_router(overview.router, tags=["Admin - Overview"])
admin_router.include_router(explorer.router, prefix="/explorer", tags=["Admin - Data Explorer"])
admin_router.include_router(users.router, tags=["Admin - User Management"])
admin_router.include_router(user_detail.router, tags=["Admin - User Detail"])
admin_router.include_router(sessions.router, tags=["Admin - Sessions"])
admin_router.include_router(analytics.router, tags=["Admin - Analytics"])
admin_router.include_router(scales.router, tags=["Admin - Scale Management"])
admin_router.include_router(db_export.router, tags=["Admin - Data Export"])
