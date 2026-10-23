"""Teacher publications and student-owned local-work receipts, outside lesson task locks."""
import asyncio
import hashlib
import io
import zipfile
from datetime import datetime, timezone
from functools import partial
from uuid import UUID, uuid4
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select, text, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.endpoints.auth import get_current_user
from app.api.endpoints.classroom import locked_session, success
from app.core.security import verify_admin_key
from app.db.postgres import get_db
from app.models.sql import ClassroomMaterial, ClassroomSession, MaterialReceipt, PreparationRecord, User
from app.services import worksheet
from app.services import material_participation
from app.services.lesson_pack import freeze as freeze_lesson_pack
from app.services.worksheet import Template as WorksheetTemplate
from app.services.classroom_service import current_session, effective_state
from app.services.classroom_files import read_upload, safe_name, inspect_zip
from app.services.pi_package import make_pi_package, freeze_pi_templates, PI_VERSION
from app.services.research_package import offload
from app.services.sfls_package import make_sfls_package, task_contract, validate_submission_contract, SFLS_VERSION, POLICY_VERSION
from app.services.sfls_package import design_files
from app.services.task_design import DesignInput, design_pair, ensure_design_material
from app.services.work_records import readme_preview
from app.services.sfls_task_access import issue_task_access, resolve_task_access, public_receipt_detail
from app.services.manual_submission import normalize_manual_submission
from app.api.endpoints.student_advice import AdviceInput, submit_advice

router = APIRouter(prefix='/materials', tags=['Classroom files'])
admin_router = APIRouter(prefix='/classroom', tags=['Admin files'], dependencies=[Depends(verify_admin_key)])
MAX_SUBMISSIONS = 20
# Buffer at most two bounded manual archives per process. Nginx can spool the
# remaining request bodies; untrusted ZIPs are never extracted or executed.
MANUAL_UPLOAD_SLOTS = asyncio.Semaphore(2)
MAX_MANUAL_UPLOAD = 50 * 1024 * 1024


def material_row(item, student=False):
    row = {k: getattr(item, k) for k in ('id', 'title', 'kind', 'configuration', 'filename', 'size', 'created_at', 'closed_at')}
    row['max_submissions'] = MAX_SUBMISSIONS
    row['configuration'] = {key: value for key, value in item.configuration.items() if key != 'lesson_pack'}
    if student:
        for key in ('statistics_started_at', 'statistics_excluded_user_ids', 'statistics_excluded_student_ids', 'agent_guidance'):
            row['configuration'].pop(key, None)
    if item.configuration.get('lesson_pack'):
        row['configuration']['lesson_pack_version'] = item.configuration['lesson_pack']['version']
    if student and item.configuration.get('worksheet'):
        row['configuration']['worksheet'] = worksheet.public_template(item.configuration['worksheet'])
    return row


def receipt_row(item):
    row = {k: getattr(item, k) for k in ('id', 'material_id', 'user_id', 'kind', 'detail', 'sha256', 'size', 'created_at')}
    row['detail'] = public_receipt_detail(row['detail'])
    return row


def is_task(item):
    return item.kind in ('pi', 'sfls') or bool(item.configuration.get('accept_submissions'))


async def open_materials(db, session_id):
    return (await db.scalars(select(ClassroomMaterial).where(
        ClassroomMaterial.session_id == session_id, ClassroomMaterial.closed_at.is_(None)
    ).order_by(ClassroomMaterial.created_at))).all()


def visible_materials(items):
    tasks = [item for item in items if is_task(item)]
    # Old classrooms may have published an entire course at once. Do not guess
    # which lesson the teacher means; an explicit open resolves that ambiguity.
    current = tasks[0] if len(tasks) == 1 else None
    return ([current] if current else []) + [item for item in items if not is_task(item)]


async def activate_material(db, item):
    # Callers hold the session row lock, so two simultaneous opens cannot leave
    # two tasks active. Reading materials and all receipts remain untouched.
    if is_task(item):
        for other in await open_materials(db, item.session_id):
            if other.id != item.id and is_task(other):
                other.closed_at = datetime.now(timezone.utc)
    item.closed_at = None


async def student_material(db, user, material_id):
    item = await db.get(ClassroomMaterial, material_id)
    session = await current_session(db, user.class_name)
    if not item or not session or item.session_id != session.id:
        raise HTTPException(404, '本班没有这份资料')
    if effective_state(session) != 'open' or item.closed_at:
        raise HTTPException(403, '老师已停止这份资料的下载和提交')
    if is_task(item) and item.id not in {row.id for row in visible_materials(await open_materials(db, session.id))}:
        raise HTTPException(403, '请等待老师开放本次任务')
    return item


async def publish_slot(db, session_id):
    session = await locked_session(db, session_id)
    if effective_state(session) != 'open':
        raise HTTPException(409, '请先开放准备区')
    count = await db.scalar(select(func.count()).select_from(ClassroomMaterial).where(ClassroomMaterial.session_id == session_id, ClassroomMaterial.closed_at.is_(None)))
    if count >= 20:
        raise HTTPException(409, '最多同时开放 20 份资料，请先收起不再使用的资料；历史记录会保留')


class PackageInput(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    request_id: UUID
    title: str = Field(min_length=1, max_length=120)
    task: str = Field(min_length=1, max_length=16000)
    support: str = Field(default='两组统一 SFLS 支架', min_length=1, max_length=8000)
    phase: Literal['pre', 'post', 'practice'] = 'practice'
    runtime: Literal['pi', 'sfls'] = 'pi'
    project_id: str = Field(default='snake-course', pattern=r'^[A-Za-z0-9_-]{1,100}$')
    curriculum: str = Field(default='', max_length=16000)
    agent_guidance: str = Field(default='', max_length=8000)
    inherit_previous: bool = False
    worksheet: WorksheetTemplate | None = None


def package_configuration(body: PackageInput):
    """Freeze identical content for manual publications and closed library entries."""
    kind = body.runtime
    if body.worksheet and (kind != 'sfls' or body.phase != 'practice'):
        raise HTTPException(422, '差异化任务单仅用于 SFLS 课堂练习，前后测不加载')
    if kind == 'sfls' and body.phase != 'practice' and body.inherit_previous:
        raise HTTPException(422, '前后测不继承课堂工程，请使用相同的测评起点')
    configuration = {'task': body.task, 'support': body.support, 'phase': body.phase, 'pi_version': PI_VERSION}
    if kind == 'sfls':
        configuration = {'task': body.task, 'phase': body.phase, 'project_id': body.project_id, 'curriculum': body.curriculum,
                         'inherit_previous': body.inherit_previous, 'sfls_version': SFLS_VERSION, 'policy_version': POLICY_VERSION}
        if body.agent_guidance:
            # Optional on new publications only: do not rewrite legacy snapshots
            # or change their retry equality / declared submission contract.
            configuration['agent_guidance'] = body.agent_guidance
        if body.worksheet:
            configuration['worksheet'] = worksheet.frozen_template(body.worksheet.model_dump())
            bundle = freeze_lesson_pack(body.worksheet.lesson_id)
            if bundle:
                configuration['lesson_pack'] = bundle
                if not configuration['curriculum']:
                    configuration['curriculum'] = bundle['curriculum']
    return configuration


@admin_router.post('/sessions/{session_id}/packages')
async def publish_package(session_id: UUID, body: PackageInput, db: AsyncSession = Depends(get_db), teacher: User = Depends(get_current_user)):
    session = await locked_session(db, session_id)
    if session.class_name == '体验组' and body.worksheet:
        raise HTTPException(422, '体验组请自定义任务，不使用实验班的课程模板')
    if body.worksheet and session.created_by != teacher.id:
        raise HTTPException(403, '只能为本人负责的课次配置任务单')
    kind = body.runtime
    configuration = package_configuration(body)
    existing = await db.get(ClassroomMaterial, body.request_id)
    if existing:
        # Keep the originally frozen files on an identical retry after a code update.
        if 'lesson_pack' in existing.configuration and 'lesson_pack' in configuration:
            configuration['lesson_pack'] = existing.configuration['lesson_pack']
            if not body.curriculum:
                configuration['curriculum'] = existing.configuration['curriculum']
        if (existing.session_id, existing.created_by, existing.title, existing.configuration, existing.kind) != (session_id, teacher.id, body.title, configuration, kind):
            raise HTTPException(409, '请求编号已用于其他发布')
        return success(material_row(existing))
    await publish_slot(db, session_id)
    frozen = await offload(freeze_pi_templates) if kind == 'pi' else b''
    item = ClassroomMaterial(id=body.request_id, session_id=session_id, created_by=teacher.id, title=body.title, kind=kind, configuration=configuration,
                             content=frozen, size=len(frozen), sha256=hashlib.sha256(frozen).hexdigest(), filename='pi-template-snapshot.zip')
    db.add(item)
    await activate_material(db, item)
    await db.commit()
    return success(material_row(item))


@admin_router.post('/sessions/{session_id}/files')
async def publish_file(session_id: UUID, request: Request, request_id: UUID, filename: str, accept_submissions: bool = False, db: AsyncSession = Depends(get_db), teacher: User = Depends(get_current_user)):
    filename = safe_name(filename)
    if filename.lower().rsplit('.', 1)[-1] not in {'pdf', 'md', 'txt', 'py', 'zip', 'png', 'jpg', 'pptx'}:
        raise HTTPException(422, '请上传 PDF、Markdown、Python、图片、PPTX 或 ZIP')
    if accept_submissions and not filename.lower().endswith('.zip'):
        raise HTTPException(422, '作业包请使用 ZIP；其他文件可作为阅读资料发布')
    data = await read_upload(request)
    if filename.lower().endswith(('.zip', '.pptx')):
        await offload(inspect_zip, data)
    digest = hashlib.sha256(data).hexdigest()
    await locked_session(db, session_id)
    existing = await db.get(ClassroomMaterial, request_id)
    if existing:
        if (existing.session_id, existing.created_by, existing.filename, existing.sha256, bool((existing.configuration or {}).get('accept_submissions'))) != (session_id, teacher.id, filename, digest, accept_submissions):
            raise HTTPException(409, '请求编号已用于其他文件')
        return success(material_row(existing))
    await publish_slot(db, session_id)
    item = ClassroomMaterial(id=request_id, session_id=session_id, created_by=teacher.id, title=filename[:120], filename=filename, kind='file', configuration={'accept_submissions': True} if accept_submissions else {}, content=data, size=len(data), sha256=digest)
    db.add(item)
    await activate_material(db, item)
    await db.commit()
    return success(material_row(item))


@admin_router.get('/sessions/{session_id}/materials')
async def teacher_materials(session_id: UUID, db: AsyncSession = Depends(get_db)):
    items = (await db.scalars(select(ClassroomMaterial).where(ClassroomMaterial.session_id == session_id).order_by(ClassroomMaterial.created_at))).all()
    visible = {item.id for item in visible_materials([item for item in items if not item.closed_at])}
    # One metadata aggregate for the whole lesson; never load submitted ZIPs.
    receipt_counts = (await db.execute(select(
        MaterialReceipt.material_id,
        func.count(MaterialReceipt.id).filter(MaterialReceipt.kind == 'submission'),
        func.count(MaterialReceipt.id).filter(MaterialReceipt.kind == 'download'),
    ).where(MaterialReceipt.material_id.in_([item.id for item in items]))
        .group_by(MaterialReceipt.material_id))).all() if items else []
    counts = {mid: {'submission_count': submissions, 'download_count': downloads}
              for mid, submissions, downloads in receipt_counts}
    participation = await material_participation.summaries(db, items)
    return success([{**material_row(item), 'student_visible': item.id in visible,
                     'participation': participation[item.id],
                     **counts.get(item.id, {'submission_count': 0, 'download_count': 0})}
                    for item in items])


@admin_router.post('/materials/{material_id}/open')
async def open_material(material_id: UUID, db: AsyncSession = Depends(get_db)):
    item = await db.get(ClassroomMaterial, material_id)
    if not item:
        raise HTTPException(404, '资料不存在')
    session = await locked_session(db, item.session_id)
    if effective_state(session) != 'open':
        raise HTTPException(409, '请先开放本班课堂')
    await db.refresh(item, ['closed_at'])
    await activate_material(db, item)
    await db.commit()
    return success(material_row(item))


@admin_router.post('/materials/{material_id}/close')
async def close_material(material_id: UUID, db: AsyncSession = Depends(get_db)):
    item = await db.get(ClassroomMaterial, material_id)
    if not item:
        raise HTTPException(404, '资料不存在')
    await locked_session(db, item.session_id)
    await db.refresh(item, ['closed_at'])
    item.closed_at = item.closed_at or datetime.now(timezone.utc)
    await db.commit()
    return success(material_row(item))


@router.get('')
async def student_materials(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    session = await current_session(db, user.class_name)
    if not session or effective_state(session) != 'open':
        return success([])
    items = visible_materials(await open_materials(db, session.id))
    # One aggregate query for this student's receipts, never another student's work.
    receipts = (await db.execute(select(MaterialReceipt.material_id, func.count(), func.max(MaterialReceipt.created_at))
        .where(MaterialReceipt.user_id == user.id, MaterialReceipt.kind == 'submission', MaterialReceipt.material_id.in_([item.id for item in items]))
        .group_by(MaterialReceipt.material_id))).all() if items else []
    summaries = {mid: {'count': count, 'last_submitted_at': at} for mid, count, at in receipts}
    return success([{**material_row(item, student=True), 'submission': summaries.get(item.id, {'count': 0, 'last_submitted_at': None})} for item in items])


@router.post('/{material_id}/download')
async def download_material(material_id: UUID, platform: Literal['mac', 'windows'] = 'mac', db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    item = await student_material(db, user, material_id)
    # Serialise per-student download/submit quotas, never the whole class.
    await db.execute(text('SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))'), {'key': f'materials:{user.id}'})
    count = await db.scalar(select(func.count()).select_from(MaterialReceipt).where(MaterialReceipt.material_id == material_id, MaterialReceipt.user_id == user.id, MaterialReceipt.kind == 'download'))
    if count >= 30:
        raise HTTPException(429, '下载次数过多，请联系老师')
    receipt = MaterialReceipt(id=uuid4(), material_id=item.id, user_id=user.id, request_id=uuid4(), kind='download', detail={'platform': platform, 'source': 'server_download_initiated', 'class_name': user.class_name, 'group': user.experiment_group})
    if item.kind == 'sfls':
        config = item.configuration
        # No class/group policy branch: only authenticated identity and the course link select work.
        scope = config['project_id'] if config['phase'] == 'practice' else str(item.id)
        designs = await design_pair(db, user.id, scope)
        previous = None
        if config.get('inherit_previous') and config['phase'] == 'practice':
            row = (await db.execute(select(MaterialReceipt.id, MaterialReceipt.material_id, MaterialReceipt.content)
                .join(ClassroomMaterial, ClassroomMaterial.id == MaterialReceipt.material_id)
                .where(MaterialReceipt.user_id == user.id, MaterialReceipt.kind == 'submission',
                       ClassroomMaterial.kind == 'sfls', ClassroomMaterial.created_by == item.created_by,
                       ClassroomMaterial.configuration['project_id'].astext == config['project_id'],
                       ClassroomMaterial.configuration['phase'].astext == 'practice', ClassroomMaterial.created_at < item.created_at)
                .where(or_(MaterialReceipt.detail['task_validation']['status'].astext.is_(None),
                           MaterialReceipt.detail['task_validation']['status'].astext == 'matched'))
                .order_by(MaterialReceipt.created_at.desc(), MaterialReceipt.id.desc()).limit(1))).first()
            previous = dict(row._mapping) if row else None
        worksheet_context = await worksheet.package_context(db, user.id, item)
        from app.core.config import settings
        task_access = None
        if settings.PUBLIC_BASE_URL:
            task_access, access_record = issue_task_access(user, item.id, receipt.id, settings.PUBLIC_BASE_URL)
            receipt.detail = {**receipt.detail, 'task_access': access_record}
        data, provenance = await offload(make_sfls_package, item, user.id, receipt.id, platform, designs['initial'], designs['current'], previous, settings.PUBLIC_BASE_URL or None, worksheet_context, task_access)
        receipt.detail = {**receipt.detail, 'sfls_provenance': provenance, 'project_id': config['project_id'], 'task_contract': task_contract(item)}
        if worksheet_context:
            receipt.detail['worksheet_context'] = worksheet.context_binding(worksheet_context)
            receipt.detail['worksheet_context']['packaged_design_revision'] = designs['current']['revision'] if designs['current'] else None
        name = f'SFLS-{platform}-{str(receipt.id)[:8]}.zip'
    elif item.kind == 'pi':
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


@router.get('/{material_id}/readme')
async def student_readme(material_id: UUID, response: Response, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await student_material(db, user, material_id)
    response.headers['Cache-Control'] = 'no-store'
    row = (await db.execute(select(MaterialReceipt.id, MaterialReceipt.created_at, MaterialReceipt.content, MaterialReceipt.detail)
        .where(MaterialReceipt.material_id == material_id, MaterialReceipt.user_id == user.id, MaterialReceipt.kind == 'submission')
        .order_by(MaterialReceipt.created_at.desc(), MaterialReceipt.id.desc()).limit(1))).first()
    if not row:
        return success(None)
    preview = await offload(readme_preview, row.content)
    return success({'receipt_id': row.id, 'created_at': row.created_at, **preview,
                    'task_validation_status': (row.detail or {}).get('task_validation', {}).get('status'),
                    'source': 'submitted_artifact_not_mastery_evidence'})


@router.post('/{material_id}/submit')
async def submit_work(material_id: UUID, request: Request, request_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return await accept_submission(material_id, request, request_id, db, user)


@router.post('/{material_id}/manual-submit')
async def submit_manual_work(material_id: UUID, request: Request, request_id: UUID, response: Response,
                             db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Authenticated web fallback; task grants cannot access this import route."""
    item = await student_material(db, user, material_id)
    if item.kind != 'sfls':
        raise HTTPException(422, '只有 SFLS 任务支持任务文件夹补交')
    response.headers['Cache-Control'] = 'no-store'
    async with MANUAL_UPLOAD_SLOTS:
        raw = bytearray()
        async for chunk in request.stream():
            raw.extend(chunk)
            if len(raw) > MAX_MANUAL_UPLOAD:
                raise HTTPException(413, '任务文件夹 ZIP 最多 50 MiB；请去掉 .sfls 环境、依赖和旧 submissions 后再压缩，保留 project、evidence 和 sfls-task.json')
        if not raw:
            raise HTTPException(422, '文件为空')
        data, imported = await offload(partial(normalize_manual_submission, user_id=str(user.id),
                                              material_id=str(item.id), project_id=item.configuration['project_id']), bytes(raw))
        del raw
        return await accept_submission(material_id, request, request_id, db, user,
                                       prepared_data=data, manual_import=imported)


async def task_access_principal(material_id, download_id, request, db, *, require_open=True):
    user, download, expires_at = await resolve_task_access(db, material_id, download_id, request.headers.get('X-SFLS-Task-Token'))
    # Closing collection must not disable an already-downloaded local project.
    # Only server writes require the task to remain open for this student.
    item = await student_material(db, user, material_id) if require_open else await db.get(ClassroomMaterial, material_id)
    if not item or item.kind != 'sfls':
        raise HTTPException(403, '此凭据只能用于对应的 SFLS 任务')
    return user, download, expires_at, item


@router.get('/{material_id}/downloads/{download_id}/access')
async def verify_task_access(material_id: UUID, download_id: UUID, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    user, _, expires_at, _ = await task_access_principal(material_id, download_id, request, db, require_open=False)
    response.headers['Cache-Control'] = 'no-store'
    return success({'user': {'id': str(user.id), 'name': user.name, 'student_id': user.student_id},
                    'material_id': str(material_id), 'download_id': str(download_id), 'expires_at': expires_at})


@router.post('/{material_id}/downloads/{download_id}/submit')
async def submit_task_work(material_id: UUID, download_id: UUID, request: Request, request_id: UUID, response: Response, db: AsyncSession = Depends(get_db)):
    user, _, _, _ = await task_access_principal(material_id, download_id, request, db)
    response.headers['Cache-Control'] = 'no-store'
    return await accept_submission(material_id, request, request_id, db, user, bound_download_id=download_id)


@router.post('/{material_id}/downloads/{download_id}/advice')
async def submit_task_advice(material_id: UUID, download_id: UUID, body: AdviceInput, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    user, _, _, item = await task_access_principal(material_id, download_id, request, db)
    expected = {'task_id': str(item.id), 'project_id': item.configuration['project_id'],
                'title': item.title, 'version': str(item.id), 'phase': item.configuration['phase']}
    if any(getattr(body.client_context, key) != value for key, value in expected.items()):
        raise HTTPException(422, '建议上下文与本课任务不一致，请在本人下载的任务文件夹内发送。')
    return await submit_advice(body, response, user, db)


async def accept_submission(material_id, request, request_id, db, user, *, bound_download_id=None,
                            prepared_data=None, manual_import=None):
    item = await student_material(db, user, material_id)
    if item.kind not in ('pi', 'sfls') and not (item.configuration or {}).get('accept_submissions'):
        raise HTTPException(422, '请在对应任务包下提交作品')
    data = prepared_data if prepared_data is not None else await read_upload(request)
    if item.kind in ('pi', 'sfls'):
        expected = {'schema': 'cognisync-local/1', 'material_id': str(item.id), 'user_id': str(user.id)}
        if bound_download_id is not None:
            expected['download_id'] = str(bound_download_id)
        detail = await offload(inspect_zip, data, expected)
        try:
            download_id = UUID(detail['client_manifest']['download_id'])
        except (ValueError, KeyError, TypeError) as error:
            raise HTTPException(422, '缺少有效下载编号') from error
        download = await db.get(MaterialReceipt, download_id)
        if not download or (download.material_id, download.user_id, download.kind) != (item.id, user.id, 'download'):
            raise HTTPException(422, '找不到本人的下载记录')
        if item.kind == 'sfls':
            from app.services.sfls_package import previous_project
            await offload(previous_project, data, user.id, item.configuration['project_id'], item.id)
            validation = await offload(validate_submission_contract, data, item, download)
            detail = {**detail, 'runtime': 'sfls', 'project_id': item.configuration['project_id'], 'source': 'sfls_local_report_not_server_execution', 'task_validation': validation}
            binding = (download.detail or {}).get('worksheet_context')
            if binding:
                web = await worksheet.latest(db, user.id, item.id)
                detail['worksheet_context'] = await offload(worksheet.submission_context, data, binding, web)
    else:
        # Teacher-authored packages have no platform manifest. Bind the receipt
        # to the authenticated student/task, not to an asserted archive author.
        detail = {**await offload(inspect_zip, data), 'source': 'unverified_teacher_package_upload'}
        download = await db.scalar(select(MaterialReceipt.id).where(MaterialReceipt.material_id == item.id, MaterialReceipt.user_id == user.id, MaterialReceipt.kind == 'download').limit(1))
        if not download:
            raise HTTPException(422, '请先下载这份作业包，再上传作品')
    if manual_import is not None:
        detail = {**detail, 'manual_import': manual_import}
    digest = hashlib.sha256(data).hexdigest()
    await db.execute(text('SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))'), {'key': f'materials:{user.id}'})
    previous = await db.scalar(select(MaterialReceipt).where(MaterialReceipt.user_id == user.id, MaterialReceipt.request_id == request_id))
    if previous:
        if (previous.material_id, previous.sha256, previous.kind) != (item.id, digest, 'submission'):
            raise HTTPException(409, '请求编号已用于其他作品')
        return success(receipt_row(previous))
    count = await db.scalar(select(func.count()).select_from(MaterialReceipt).where(MaterialReceipt.material_id == item.id, MaterialReceipt.user_id == user.id, MaterialReceipt.kind == 'submission'))
    if count >= MAX_SUBMISSIONS:
        raise HTTPException(409, f'本任务已保留 {MAX_SUBMISSIONS} 次提交，请联系老师，不要删除旧证据')
    receipt = MaterialReceipt(material_id=item.id, user_id=user.id, request_id=request_id, kind='submission', content=data, sha256=digest, size=len(data), detail={**detail, 'class_name': user.class_name, 'group': user.experiment_group})
    db.add(receipt)
    await db.commit()
    return success(receipt_row(receipt))


@router.get('/{material_id}/design')
async def read_design(material_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    item = await student_material(db, user, material_id)
    ensure_design_material(item)
    # Measurement designs are scoped to this task, never inherited from teaching.
    scope = item.configuration['project_id'] if item.configuration['phase'] == 'practice' else str(item.id)
    return success(await design_pair(db, user.id, scope))


@router.get('/{material_id}/design/download')
async def download_design(material_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    item = await student_material(db, user, material_id)
    ensure_design_material(item)
    scope = item.configuration['project_id'] if item.configuration['phase'] == 'practice' else str(item.id)
    designs = await design_pair(db, user.id, scope)
    if not designs['current']:
        raise HTTPException(404, '先保存设计再下载')
    def build():
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
            for name, content in design_files(designs['current'], 'current').items():
                archive.writestr(name, content)
        return output.getvalue()
    return Response(await offload(build), media_type='application/zip', headers={
        'Content-Disposition': 'attachment; filename="my-design.zip"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'})


@router.post('/{material_id}/design')
async def save_design(material_id: UUID, body: DesignInput, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    item = await student_material(db, user, material_id)
    ensure_design_material(item)
    scope = item.configuration['project_id'] if item.configuration['phase'] == 'practice' else str(item.id)
    await db.execute(text('SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))'), {'key': f'sfls-design:{user.id}:{scope}'})
    submitted = body.model_dump(mode='json', exclude_none=True)
    previous = await db.scalar(select(PreparationRecord).where(PreparationRecord.user_id == user.id, PreparationRecord.request_id == body.request_id))
    if previous:
        if previous.kind != 'design' or previous.payload.get('request') != submitted or previous.payload.get('material_id') != str(item.id):
            raise HTTPException(409, '请求编号已用于其他记录')
        return success(previous.payload)
    current = await design_pair(db, user.id, scope)
    if body.base_revision != current['revision']:
        raise HTTPException(409, '另一页已保存新版本。请先保留当前内容，再重新读取，不会覆盖云端')
    if not current['revision'] and not body.requirements.strip() and not body.nodes and not body.drawio_xml:
        raise HTTPException(422, '先写一句需求，或添加一个模块')
    payload = {'schema': 'sfls-design/1', 'project_id': scope, 'material_id': str(item.id),
               'revision': current['revision'] + 1, 'requirements': body.requirements,
               'nodes': [node.model_dump() for node in body.nodes], 'edges': [edge.model_dump() for edge in body.edges],
               'drawio_xml': body.drawio_xml if body.drawio_xml is not None else (current['current'] or {}).get('drawio_xml', ''),
               'request': submitted, 'source': 'student_saved_design'}
    db.add(PreparationRecord(user_id=user.id, session_id=item.session_id, request_id=body.request_id, kind='design', payload=payload))
    await db.commit()
    return success(payload)


@admin_router.get('/materials/{material_id}/participation')
async def material_participation_roster(
    material_id: UUID,
    status: material_participation.ParticipationStatus = 'all',
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    item = await db.get(ClassroomMaterial, material_id)
    if not item:
        raise HTTPException(404, '资料不存在')
    session = await db.get(ClassroomSession, item.session_id)
    if not session:
        raise HTTPException(404, '课次不存在')
    return success(await material_participation.roster(
        db, item, session.class_name, status=status, offset=offset, limit=limit,
    ))


@admin_router.get('/materials/{material_id}/receipts')
async def list_receipts(material_id: UUID, offset: int = Query(0, ge=0), db: AsyncSession = Depends(get_db)):
    query = select(MaterialReceipt, User.name, User.student_id).join(User, User.id == MaterialReceipt.user_id).where(MaterialReceipt.material_id == material_id)
    total, submissions, downloads = (await db.execute(select(
        func.count(MaterialReceipt.id),
        func.count(MaterialReceipt.id).filter(MaterialReceipt.kind == 'submission'),
        func.count(MaterialReceipt.id).filter(MaterialReceipt.kind == 'download'),
    ).where(MaterialReceipt.material_id == material_id))).one()
    rows = (await db.execute(query.order_by(MaterialReceipt.created_at.desc(), MaterialReceipt.id).offset(offset).limit(50))).all()
    return success({'total': total, 'submission_count': submissions, 'download_count': downloads,
                    'items': [{**receipt_row(row), 'name': name, 'student_id': student_id} for row, name, student_id in rows]})


@admin_router.get('/receipts/{receipt_id}/file')
async def teacher_work_file(receipt_id: UUID, db: AsyncSession = Depends(get_db)):
    data = await db.scalar(select(MaterialReceipt.content).where(MaterialReceipt.id == receipt_id, MaterialReceipt.kind == 'submission'))
    if data is None:
        raise HTTPException(404, '作品不存在')
    return Response(data, media_type='application/zip', headers={'Content-Disposition': f'attachment; filename="submission-{receipt_id}.zip"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'})
