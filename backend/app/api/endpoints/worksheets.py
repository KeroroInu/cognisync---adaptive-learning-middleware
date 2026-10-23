"""Student-owned worksheets and teacher-owned class review."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import String, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.endpoints.auth import get_current_user
from app.api.endpoints.classroom import success
from app.api.endpoints.materials import student_material
from app.core.security import verify_admin_key
from app.db.postgres import get_db
from app.models.sql import ClassroomMaterial, PreparationRecord, User
from app.services import worksheet as service

router = APIRouter(prefix='/materials', tags=['Worksheets'])
admin_router = APIRouter(prefix='/classroom', dependencies=[Depends(verify_admin_key)])


def ensure_template(item):
    if item.kind != 'sfls' or item.configuration.get('phase') != 'practice' or not item.configuration.get('worksheet'):
        raise HTTPException(404, '本任务没有课堂任务单')


@router.get('/{material_id}/worksheet')
async def read_worksheet(material_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    item = await student_material(db, user, material_id)
    ensure_template(item)
    current = await service.latest(db, user.id, material_id)
    template = service.public_template(item.configuration['worksheet'])
    return success({'template': template, 'current': service.public_record(current),
        'markdown': service.markdown(current or {}, template)})


@router.post('/{material_id}/worksheet')
async def save_worksheet(material_id: UUID, body: service.SaveInput, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    item = await student_material(db, user, material_id)
    ensure_template(item)
    return success(service.public_record(await service.save(db, user, item, body)))


@router.get('/{material_id}/worksheet/history')
async def worksheet_history(material_id: UUID, previous: bool = False, offset: int = Query(0, ge=0), db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    item = await student_material(db, user, material_id)
    ensure_template(item)
    query = service.query(user.id, material_id)
    if previous:
        # Archived prior lessons remain read-only, always scoped to this learner and teacher.
        prior = select(cast(ClassroomMaterial.id, String)).where(ClassroomMaterial.created_by == item.created_by,
            ClassroomMaterial.configuration['project_id'].astext == item.configuration['project_id'],
            ClassroomMaterial.configuration['phase'].astext == 'practice', ClassroomMaterial.created_at < item.created_at)
        query = select(PreparationRecord).where(PreparationRecord.user_id == user.id, PreparationRecord.kind == 'worksheet',
            PreparationRecord.payload['task_id'].astext.in_(prior))
    total = await db.scalar(select(func.count()).select_from(query.subquery()))
    rows = (await db.scalars(query.order_by(PreparationRecord.created_at.desc(), PreparationRecord.id.desc()).offset(offset).limit(30))).all()
    return success({'total': total, 'items': [service.public_record(row.payload) for row in rows]})


@admin_router.get('/worksheet-templates')
async def templates():
    return success(service.catalog())


@admin_router.get('/materials/{material_id}/worksheets')
async def teacher_worksheets(material_id: UUID, offset: int = Query(0, ge=0), db: AsyncSession = Depends(get_db), teacher: User = Depends(get_current_user)):
    item = await db.get(ClassroomMaterial, material_id)
    if not item or item.created_by != teacher.id:
        raise HTTPException(404, '没有权限查看这份任务')
    ensure_template(item)
    query = select(PreparationRecord, User.name, User.student_id).join(User, User.id == PreparationRecord.user_id).where(
        PreparationRecord.kind == 'worksheet', PreparationRecord.payload['task_id'].astext == str(item.id))
    total = await db.scalar(select(func.count()).select_from(query.subquery()))
    rows = (await db.execute(query.order_by(PreparationRecord.created_at.desc(), PreparationRecord.id.desc()).offset(offset).limit(50))).all()
    return success({'template': item.configuration['worksheet'], 'total': total,
        'items': [{'name': name, 'student_id': student_id, **record.payload} for record, name, student_id in rows]})
