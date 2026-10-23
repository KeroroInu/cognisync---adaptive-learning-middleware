"""Private, read-only teacher navigation of uploaded and web conversations."""
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import verify_admin_key
from app.db.postgres import get_db
from app.schemas.base import SuccessResponse
from app.services import conversation_browser

router = APIRouter(prefix="/conversations", tags=["Admin - Conversation Browser"],
                   dependencies=[Depends(verify_admin_key)])


@router.get("/artifacts")
async def list_artifacts(
    response: Response,
    query: str | None = Query(None, max_length=100),
    class_name: str | None = Query(None, max_length=100),
    versions: Literal["latest", "all"] = "latest",
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
):
    response.headers["Cache-Control"] = "no-store"
    return SuccessResponse(data=await conversation_browser.list_artifacts(
        db, query=query, class_name=class_name, versions=versions, page=page, page_size=page_size,
    ))


@router.get("/web")
async def list_web(
    response: Response,
    query: str | None = Query(None, max_length=100),
    class_name: str | None = Query(None, max_length=100),
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
):
    response.headers["Cache-Control"] = "no-store"
    return SuccessResponse(data=await conversation_browser.list_web(
        db, query=query, class_name=class_name, page=page, page_size=page_size,
    ))


@router.get("/web/{user_id}/messages")
async def web_messages(
    user_id: UUID,
    response: Response,
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    response.headers["Cache-Control"] = "no-store"
    return SuccessResponse(data=await conversation_browser.web_messages(
        db, user_id, limit=limit, offset=offset,
    ))
