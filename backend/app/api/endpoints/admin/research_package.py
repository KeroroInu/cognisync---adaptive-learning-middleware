"""Teacher-only complete SQL evidence package."""
import asyncio
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.background import BackgroundTask

from app.core.security import verify_admin_key
from app.db.postgres import get_db
from app.services.research_package import build_package

router = APIRouter(tags=["Admin - Research Package"], dependencies=[Depends(verify_admin_key)])


@router.get("/export/research-package")
async def export_research_package(
    class_name: str | None = Query(None, min_length=1, max_length=100),
    group: Literal["pdt", "ai_pbl", "experience", "lecture", "unassigned"] | None = None,
    include_identity: bool = False,
    include_graph: bool = True,
    include_originals: bool = True,
    db: AsyncSession = Depends(get_db),
):
    try:
        package = await build_package(db, class_name=class_name, group=group, include_identity=include_identity, include_graph=include_graph, include_originals=include_originals)
    except TimeoutError:
        raise HTTPException(503, "导出超时，请缩小班级范围后重试")

    async def chunks():
        try:
            while chunk := await asyncio.to_thread(package.read, 64 * 1024):
                yield chunk
        finally:
            package.close()

    filename = f'cognisync_research_{datetime.now(timezone.utc):%Y%m%d_%H%M%S}.zip'
    return StreamingResponse(chunks(), media_type="application/zip", background=BackgroundTask(package.close),
        headers={"Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "no-store"})
