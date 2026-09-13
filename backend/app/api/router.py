"""
API 路由聚合 - 将所有端点路由集中管理
"""
from fastapi import APIRouter, Depends

from app.api.endpoints import auth, chat, profile, graph, calibration, logs, export, forms, ai_onboarding, research, assessments
from app.api.endpoints import classroom
from app.services.classroom_service import require_classroom_access

# 创建主路由器
api_router = APIRouter()
api_router.include_router(assessments.router)
api_router.include_router(classroom.router)

# 注册各模块路由
api_router.include_router(auth.router, prefix="/auth", tags=["Authentication"])
# Legacy registration questionnaires remain reachable like the newer assessments.
api_router.include_router(forms.router, prefix="/forms", tags=["Forms"])
learning_router = APIRouter(dependencies=[Depends(require_classroom_access)])
learning_router.include_router(ai_onboarding.router, prefix="/onboarding/ai", tags=["AI Onboarding"])
learning_router.include_router(chat.router, prefix="/chat", tags=["Chat"])
learning_router.include_router(profile.router, prefix="/profile", tags=["Profile"])
learning_router.include_router(graph.router, prefix="/knowledge-graph", tags=["Knowledge Graph"])
learning_router.include_router(calibration.router, prefix="/calibration", tags=["Calibration"])
learning_router.include_router(logs.router, prefix="/logs", tags=["Logs"])
learning_router.include_router(export.router, prefix="/export", tags=["Export"])
learning_router.include_router(research.router, prefix="/research", tags=["Research"])
api_router.include_router(learning_router)
