"""
CogniSync Backend - Main Application Entry Point
本地 MVP 版本，与前端状态结构完全对齐
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.core.logging import setup_logging
from app.db.postgres import init_db as init_postgres
from app.db.neo4j import init_db as init_neo4j, close_db as close_neo4j
from app.api.router import api_router
from app.api.admin_router import admin_router

# 设置日志
setup_logging()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    logger.info("🚀 Starting CogniSync Backend...")

    # 生产环境配置检查
    if settings.APP_ENV == "production":
        if not settings.ADMIN_KEY:
            raise RuntimeError("❌ ADMIN_KEY must be set in production environment!")
        if settings.LLM_PROVIDER == "mock":
            logger.warning("⚠️ LLM_PROVIDER is 'mock' in production - AI features will not work!")
        logger.info("✅ Production config validated")

    # 启动时初始化数据库连接
    try:
        await init_postgres()
        logger.info("✅ PostgreSQL connected")
    except Exception as e:
        logger.error(f"❌ PostgreSQL connection failed: {e}")

    try:
        await init_neo4j()
        logger.info("✅ Neo4j connected")
    except Exception as e:
        logger.error(f"❌ Neo4j connection failed: {e}")

    logger.info(f"🌐 Server running at http://{settings.HOST}:{settings.PORT}")
    logger.info(f"📚 API Docs: http://{settings.HOST}:{settings.PORT}/docs")
    logger.info(f"🔧 Environment: {settings.APP_ENV}")
    logger.info(f"🤖 LLM Provider: {settings.LLM_PROVIDER}")

    yield

    # 关闭时清理资源
    logger.info("🛑 Shutting down CogniSync Backend...")
    await close_neo4j()
    logger.info("✅ Resources cleaned up")


# 创建 FastAPI 应用
app = FastAPI(
    title="CogniSync API",
    description="Adaptive Learning Middleware - 与前端完全对齐的 MVP 后端",
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    lifespan=lifespan,
)

# CORS 配置（允许前端访问）
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Health Check Endpoint
@app.get("/health", tags=["Health"])
async def health_check():
    """健康检查端点"""
    return JSONResponse(
        content={
            "status": "ok",
            "app": settings.APP_NAME,
            "env": settings.APP_ENV,
            "version": "0.1.0",
        }
    )


# 根路径
@app.get("/", tags=["Root"])
async def root():
    """根路径 - 返回 API 信息"""
    return {
        "message": "CogniSync API - Adaptive Learning Middleware",
        "version": "0.1.0",
        "docs": "/docs",
        "health": "/health",
    }


# 注册 API 路由（前缀为 /api）
app.include_router(api_router, prefix=settings.API_PREFIX)

# 注册 Admin API 路由（前缀为 /api/admin）
app.include_router(admin_router, prefix=settings.API_PREFIX)


# 全局异常处理
@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """全局异常处理器"""
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "error": {
                "code": "INTERNAL_ERROR",
                "message": "An internal error occurred. Please try again later.",
            },
        },
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
        log_level=settings.LOG_LEVEL.lower(),
    )
