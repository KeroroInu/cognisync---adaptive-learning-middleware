"""
API 路由聚合 - 将所有端点路由集中管理
"""
from fastapi import APIRouter

from app.api.endpoints import chat, profile, graph, calibration, logs, export, onboarding

# 创建主路由器
api_router = APIRouter()

# 注册各模块路由
api_router.include_router(chat.router, prefix="/chat", tags=["Chat"])
api_router.include_router(profile.router, prefix="/profile", tags=["Profile"])
api_router.include_router(graph.router, prefix="/knowledge-graph", tags=["Knowledge Graph"])
api_router.include_router(calibration.router, prefix="/calibration", tags=["Calibration"])
api_router.include_router(logs.router, prefix="/logs", tags=["Logs"])
api_router.include_router(export.router, prefix="/export", tags=["Export"])
api_router.include_router(onboarding.router, prefix="/onboarding", tags=["Onboarding"])
