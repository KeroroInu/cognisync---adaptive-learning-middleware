"""Teacher publications and student-owned local-work receipts, outside lesson task locks."""
import hashlib
from datetime import datetime, timezone
from uuid import UUID, uuid4
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.endpoints.auth import get_current_user
from app.api.endpoints.classroom import locked_session, success
from app.core.security import verify_admin_key
from app.db.postgres import get_db
from app.models.sql import ClassroomMaterial, MaterialReceipt, User
from app.services.classroom_service import current_session, effective_state
from app.services.classroom_files import read_upload, safe_name, inspect_zip
from app.services.pi_package import make_pi_package, freeze_pi_templates, PI_VERSION
from app.services.research_package import offload

router = APIRouter(prefix='/materials', tags=['Classroom files'])
admin_router = APIRouter(prefix='/classroom', tags=['Admin files'], dependencies=[Depends(verify_admin_key)])


def material_row(item):
    return {k: getattr(item, k) for k in ('id', 'title', 'kind', 'configuration', 'filename', 'size', 'created_at', 'closed_at')}


def receipt_row(item):
    return {k: getattr(item, k) for k in ('id', 'material_id', 'user_id', 'kind', 'detail', 'sha256', 'size', 'created_at')}


async def student_material(db, user, material_id):
    item = await db.get(ClassroomMaterial, material_id)
    session = await current_session(db, user.class_name)
    if not item or not session or item.session_id != session.id:
        raise HTTPException(404, '本班没有这份资料')
    if effective_state(session) != 'open' or item.closed_at:
        raise HTTPException(403, '老师已停止这份资料的下载和提交')
    return item


async def publish_slot(db, session_id):
    session = await locked_session(db, session_id)
    if effective_state(session) != 'open':
        raise HTTPException(409, '请先开放准备区')
    count = await db.scalar(select(func.count()).select_from(ClassroomMaterial).where(ClassroomMaterial.session_id == session_id))
    if count >= 20:
        raise HTTPException(409, '每课最多发布 20 份资料')


class PackageInput(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    request_id: UUID
    title: str = Field(min_length=1, max_length=120)
    task: str = Field(min_length=1, max_length=16000)
    support: str = Field(min_length=1, max_length=8000)
    phase: Literal['pre', 'post', 'practice'] = 'practice'


@admin_router.post('/sessions/{session_id}/packages')
async def publish_package(session_id: UUID, body: PackageInput, db: AsyncSession = Depends(get_db), teacher: User = Depends(get_current_user)):
    await locked_session(db, session_id)
    configuration = {**body.model_dump(exclude={'request_id', 'title'}), 'pi_version': PI_VERSION}
    existing = await db.get(ClassroomMaterial, body.request_id)
    if existing:
        if (existing.session_id, existing.created_by, existing.title, existing.configuration, existing.kind) != (session_id, teacher.id, body.title, configuration, 'pi'):
            raise HTTPException(409, '请求编号已用于其他发布')
        return success(material_row(existing))
    await publish_slot(db, session_id)
    frozen = await offload(freeze_pi_templates)
    item = ClassroomMaterial(id=body.request_id, session_id=session_id, created_by=teacher.id, title=body.title, kind='pi', configuration=configuration,
                             content=frozen, size=len(frozen), sha256=hashlib.sha256(frozen).hexdigest(), filename='pi-template-snapshot.zip')
    db.add(item)
    await db.commit()
    return success(material_row(item))


@admin_router.post('/sessions/{session_id}/files')
async def publish_file(session_id: UUID, request: Request, request_id: UUID, filename: str, db: AsyncSession = Depends(get_db), teacher: User = Depends(get_current_user)):
    filename = safe_name(filename)
    if filename.lower().rsplit('.', 1)[-1] not in {'pdf', 'md', 'txt', 'py', 'zip', 'png', 'jpg', 'pptx'}:
        raise HTTPException(422, '请上传 PDF、Markdown、Python、图片、PPTX 或 ZIP')
    data = await read_upload(request)
    if filename.lower().endswith(('.zip', '.pptx')):
        await offload(inspect_zip, data)
    digest = hashlib.sha256(data).hexdigest()
    await locked_session(db, session_id)
    existing = await db.get(ClassroomMaterial, request_id)
    if existing:
        if (existing.session_id, existing.created_by, existing.filename, existing.sha256) != (session_id, teacher.id, filename, digest):
            raise HTTPException(409, '请求编号已用于其他文件')
        return success(material_row(existing))
    await publish_slot(db, session_id)
    item = ClassroomMaterial(id=request_id, session_id=session_id, created_by=teacher.id, title=filename[:120], filename=filename, kind='file', content=data, size=len(data), sha256=digest)
    db.add(item)
    await db.commit()
    return success(material_row(item))


@admin_router.get('/sessions/{session_id}/materials')
async def teacher_materials(session_id: UUID, db: AsyncSession = Depends(get_db)):
    items = (await db.scalars(select(ClassroomMaterial).where(ClassroomMaterial.session_id == session_id).order_by(ClassroomMaterial.created_at))).all()
    return success([material_row(item) for item in items])


@admin_router.post('/materials/{material_id}/close')
async def close_material(material_id: UUID, db: AsyncSession = Depends(get_db)):
    item = await db.get(ClassroomMaterial, material_id)
    if not item:
        raise HTTPException(404, '资料不存在')
    item.closed_at = item.closed_at or datetime.now(timezone.utc)
    await db.commit()
    return success(material_row(item))


@router.get('')
async def student_materials(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    session = await current_session(db, user.class_name)
    if not session or effective_state(session) != 'open':
        return success([])
    items = (await db.scalars(select(ClassroomMaterial).where(ClassroomMaterial.session_id == session.id, ClassroomMaterial.closed_at.is_(None)).order_by(ClassroomMaterial.created_at))).all()
    return success([material_row(item) for item in items])


@router.post('/{material_id}/download')
async def download_material(material_id: UUID, platform: Literal['mac', 'windows'] = 'mac', db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    item = await student_material(db, user, material_id)
    # Serialise per-student download/submit quotas, never the whole class.
    await db.execute(text('SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))'), {'key': f'materials:{user.id}'})
    count = await db.scalar(select(func.count()).select_from(MaterialReceipt).where(MaterialReceipt.material_id == material_id, MaterialReceipt.user_id == user.id, MaterialReceipt.kind == 'download'))
    if count >= 30:
        raise HTTPException(429, '下载次数过多，请联系老师')
    receipt = MaterialReceipt(id=uuid4(), material_id=item.id, user_id=user.id, request_id=uuid4(), kind='download', detail={'platform': platform, 'source': 'server_download_initiated', 'class_name': user.class_name, 'group': user.experiment_group})
    if item.kind == 'pi':
        frozen = await db.scalar(select(ClassroomMaterial.content).where(ClassroomMaterial.id == item.id))
        if not frozen:
            raise HTTPException(409, '任务包缺少安装脚本快照，请老师重新发布')
        data = await offload(make_pi_package, item, user.id, receipt.id, platform, frozen)
        name = f'cognisync-{platform}-{str(receipt.id)[:8]}.zip'
    else:
        data = await db.scalar(select(ClassroomMaterial.content).where(ClassroomMaterial.id == item.id))
        name = item.filename
    receipt.sha256, receipt.size = hashlib.sha256(data).hexdigest(), len(data)
    db.add(receipt)
    await db.commit()
    from urllib.parse import quote
    return Response(data, media_type='application/octet-stream', headers={'Content-Disposition': f"attachment; filename*=UTF-8''{quote(name)}", 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'})


@router.post('/{material_id}/submit')
async def submit_work(material_id: UUID, request: Request, request_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    item = await student_material(db, user, material_id)
    if item.kind != 'pi':
        raise HTTPException(422, '请在对应任务包下提交作品')
    data = await read_upload(request)
    detail = await offload(inspect_zip, data, {'schema': 'cognisync-local/1', 'material_id': str(item.id), 'user_id': str(user.id)})
    try:
        download_id = UUID(detail['client_manifest']['download_id'])
    except (ValueError, KeyError, TypeError) as error:
        raise HTTPException(422, '缺少有效下载编号') from error
    download = await db.get(MaterialReceipt, download_id)
    if not download or (download.material_id, download.user_id, download.kind) != (item.id, user.id, 'download'):
        raise HTTPException(422, '找不到本人的下载记录')
    digest = hashlib.sha256(data).hexdigest()
    await db.execute(text('SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))'), {'key': f'materials:{user.id}'})
    previous = await db.scalar(select(MaterialReceipt).where(MaterialReceipt.user_id == user.id, MaterialReceipt.request_id == request_id))
    if previous:
        if (previous.material_id, previous.sha256, previous.kind) != (item.id, digest, 'submission'):
            raise HTTPException(409, '请求编号已用于其他作品')
        return success(receipt_row(previous))
    count = await db.scalar(select(func.count()).select_from(MaterialReceipt).where(MaterialReceipt.material_id == item.id, MaterialReceipt.user_id == user.id, MaterialReceipt.kind == 'submission'))
    if count >= 3:
        raise HTTPException(409, '已保留 3 次提交，请联系老师，不要删除旧证据')
    receipt = MaterialReceipt(material_id=item.id, user_id=user.id, request_id=request_id, kind='submission', content=data, sha256=digest, size=len(data), detail={**detail, 'class_name': user.class_name, 'group': user.experiment_group})
    db.add(receipt)
    await db.commit()
    return success(receipt_row(receipt))


@admin_router.get('/materials/{material_id}/receipts')
async def list_receipts(material_id: UUID, offset: int = Query(0, ge=0), db: AsyncSession = Depends(get_db)):
    query = select(MaterialReceipt, User.name, User.student_id).join(User, User.id == MaterialReceipt.user_id).where(MaterialReceipt.material_id == material_id)
    total = await db.scalar(select(func.count()).select_from(MaterialReceipt).where(MaterialReceipt.material_id == material_id))
    rows = (await db.execute(query.order_by(MaterialReceipt.created_at.desc(), MaterialReceipt.id).offset(offset).limit(50))).all()
    return success({'total': total, 'items': [{**receipt_row(row), 'name': name, 'student_id': student_id} for row, name, student_id in rows]})


@admin_router.get('/receipts/{receipt_id}/file')
async def teacher_work_file(receipt_id: UUID, db: AsyncSession = Depends(get_db)):
    data = await db.scalar(select(MaterialReceipt.content).where(MaterialReceipt.id == receipt_id, MaterialReceipt.kind == 'submission'))
    if data is None:
        raise HTTPException(404, '作品不存在')
    return Response(data, media_type='application/zip', headers={'Content-Disposition': f'attachment; filename="submission-{receipt_id}.zip"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'})
