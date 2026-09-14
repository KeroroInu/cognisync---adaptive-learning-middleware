"""
Admin API Router - 聚合所有 admin 端点
"""
from fastapi import APIRouter
from app.api.endpoints.assessments import admin_router as assessments_router
from app.api.endpoints.classroom import admin_router as classroom_router
from app.api.endpoints.materials import admin_router as materials_router
from app.api.endpoints.lesson_evidence import router as evidence_router

from app.api.endpoints.admin import (
    users,
    analytics,
    overview,
    user_detail,
    scales,
    export as db_export,
    sessions,
    research as admin_research,
    config as admin_config,
    auth as admin_auth,
    teacher_notes,
    research_package,
)

# 创建 admin 主路由
admin_router = APIRouter(prefix="/admin")
admin_router.include_router(assessments_router)
admin_router.include_router(classroom_router)
admin_router.include_router(materials_router)
admin_router.include_router(evidence_router)

# 认证端点（PUBLIC，无需 admin key，用于登录）
admin_router.include_router(admin_auth.router, prefix="/auth", tags=["Admin - Auth"])

# 注册子路由
admin_router.include_router(overview.router, tags=["Admin - Overview"])
admin_router.include_router(users.router, tags=["Admin - User Management"])
admin_router.include_router(user_detail.router, tags=["Admin - User Detail"])
admin_router.include_router(sessions.router, tags=["Admin - Sessions"])
admin_router.include_router(analytics.router, tags=["Admin - Analytics"])
admin_router.include_router(scales.router, tags=["Admin - Scale Management"])
admin_router.include_router(db_export.router, tags=["Admin - Data Export"])
admin_router.include_router(admin_research.router, tags=["Admin - Research Management"])
admin_router.include_router(admin_config.router, tags=["Admin - Model Config"])
admin_router.include_router(teacher_notes.router)
admin_router.include_router(research_package.router)
