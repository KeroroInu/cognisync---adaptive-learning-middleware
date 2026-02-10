"""
Admin API Router - 聚合所有 admin 端点
"""
from fastapi import APIRouter

from app.api.endpoints.admin import explorer, users, analytics

# 创建 admin 主路由
admin_router = APIRouter(prefix="/admin")

# 注册子路由
admin_router.include_router(explorer.router, prefix="/explorer", tags=["Admin - Data Explorer"])
admin_router.include_router(users.router, tags=["Admin - User Management"])
admin_router.include_router(analytics.router, tags=["Admin - Analytics"])
