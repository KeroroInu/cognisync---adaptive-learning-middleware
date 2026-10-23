"""Small, teacher-reviewed classroom check. No AI scoring, no competence inference."""
from datetime import datetime, timezone
from typing import Literal
from uuid import UUID, uuid4
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, text, func
from app.db.postgres import get_db
from app.api.endpoints.auth import get_current_user
from app.core.security import verify_admin_key
from app.models.sql import User, ClassroomSession, LessonPlan, ResearchTaskSubmission
from app.models.sql.project_review import ProjectReviewRound, ProjectReviewResponse, ProjectReviewEvent
from app.services.project_review import TEMPLATE, student_template, freeze_source
from app.services.common_support import digest

router = APIRouter(prefix='/project-review', tags=['Project review'])
admin_router = APIRouter(prefix='/project-review', dependencies=[Depends(verify_admin_key)])


def now():
    return datetime.now(timezone.utc)


def success(data):
    return {'success': True, 'data': data}


class Input(BaseModel):
    model_config = ConfigDict(extra='forbid')


class Create(Input):
    request_id: UUID
    session_ids: list[UUID] = Field(min_length=1, max_length=2)


class Control(Input):
    action: Literal['open', 'end', 'publish']
    template_hash: str
    confirmed_both_groups_ended: bool = False


class Snippet(Input):
    file: str = Field(max_length=200)
    start: int = Field(ge=1)
    end: int = Field(ge=1)


class Case(Input):
    expected: Literal['', '不变', '增加1', '减少1', '其他'] = ''
    before: int | None = Field(default=None, ge=0, le=10000)
    after: int | None = Field(default=None, ge=0, le=10000)
    status: Literal['', '符合预期', '不符合预期', '证据不足', '无法完成', '无法判断'] = ''
    reason: str = Field(default='', max_length=150)
    run_id: UUID | None = None


class Answers(Input):
    snippets: list[Snippet] = Field(default_factory=list, max_length=8)
    q1: str = Field(default='', max_length=200)
    q2_choice: Literal['', '4 10', '3 0', '4 0', '3 10'] = ''
    q2_reason: str = Field(default='', max_length=150)
    move: Case = Field(default_factory=Case)
    eat: Case = Field(default_factory=Case)


class Save(Input):
    request_id: UUID
    revision: int = Field(ge=0)
    action: Literal['save', 'prediction', 'plan', 'submit'] = 'save'
    answers: Answers


class Run(Input):
    request_id: UUID
    scenario: Literal['move', 'eat']
    output: list[str] = Field(default_factory=list, max_length=30)
    before: int | None = Field(default=None, ge=0, le=10000)
    after: int | None = Field(default=None, ge=0, le=10000)
    snapshot_hash: str
    length_source: Literal['browser_runner', 'student_report'] = 'student_report'
    observed_at: datetime | None = None


class Grade(Input):
    scores: list[int] = Field(min_length=3, max_length=3)
    notes: list[str] = Field(min_length=3, max_length=3)


def view(row, rnd, teacher=False):
    data = {'id': str(row.id), 'round_id': str(rnd.id), 'title': rnd.title, 'round_status': rnd.status,
            'ai_hold': row.ai_hold, 'revision': row.revision, 'started_at': row.started_at, 'submitted_at': row.submitted_at,
            'template': student_template(rnd.template), 'template_hash': rnd.template_hash,
            'snapshot': row.snapshot, 'snapshot_hash': row.snapshot_hash, 'answers': row.answers,
            'first_prediction': row.first_prediction, 'test_plan': row.test_plan,
            'results_published': rnd.results_published}
    if teacher or rnd.results_published:
        data.update(grade=row.grade, rubric=rnd.template['rubric'])
    if teacher:
        data.update(user_id=str(row.user_id), session_id=str(row.session_id), task_id=str(row.task_id),
                    group_snapshot=row.group_snapshot, class_snapshot=row.class_snapshot)
    return data


async def owned(db, ident, user, write=False):
    row = await db.get(ProjectReviewResponse, ident)
    if not row or row.user_id != user.id:
        raise HTTPException(404, '回顾不存在')
    rnd = await db.scalar(select(ProjectReviewRound).where(ProjectReviewRound.id == row.round_id).with_for_update(read=True))
    if write:
        row = await db.scalar(select(ProjectReviewResponse).where(ProjectReviewResponse.id == ident).with_for_update().execution_options(populate_existing=True))
        if not row.ai_hold or rnd.status != 'open' or row.submitted_at:
            raise HTTPException(409, '当前回顾已关闭或已提交，不能修改')
    return row, rnd


def record(db, row, actor, kind, payload, request_id=None):
    event = ProjectReviewEvent(response_id=row.id, user_id=row.user_id, actor_id=actor, kind=kind,
                               request_id=request_id or uuid4(), payload=payload)
    db.add(event)
    return event


@router.get('/current')
async def current(status_only: bool = False, db=Depends(get_db), user=Depends(get_current_user)):
    if status_only:
        item = (await db.execute(select(
            ProjectReviewResponse.id, ProjectReviewResponse.revision, ProjectReviewResponse.ai_hold,
            ProjectReviewResponse.started_at, ProjectReviewResponse.submitted_at,
            ProjectReviewRound.status.label('round_status'), ProjectReviewRound.results_published,
        ).join(ProjectReviewRound, ProjectReviewResponse.round_id == ProjectReviewRound.id)
            .where(ProjectReviewResponse.user_id == user.id)
            .order_by(ProjectReviewResponse.ai_hold.desc(), ProjectReviewResponse.created_at.desc()).limit(1))).mappings().first()
        return success(dict(item) if item else None)
    row = await db.scalar(select(ProjectReviewResponse).where(ProjectReviewResponse.user_id == user.id)
                          .order_by(ProjectReviewResponse.ai_hold.desc(), ProjectReviewResponse.created_at.desc()).limit(1))
    if not row:
        return success(None)
    rnd = await db.get(ProjectReviewRound, row.round_id)
    return success(view(row, rnd))


@router.post('/{ident}/begin')
async def begin(ident: UUID, db=Depends(get_db), user=Depends(get_current_user)):
    row, rnd = await owned(db, ident, user, True)
    if row.snapshot is None:
        submission = await db.scalar(select(ResearchTaskSubmission).where(ResearchTaskSubmission.user_id == user.id,
                                                                           ResearchTaskSubmission.task_id == row.task_id))
        row.snapshot, row.snapshot_hash = freeze_source(submission)
        row.started_at = now()
        record(db, row, user.id, 'begin', {'snapshot_hash': row.snapshot_hash, 'source': 'server_saved_submission'})
        await db.commit()
    return success(view(row, rnd))


@router.post('/{ident}/save')
async def save(ident: UUID, body: Save, db=Depends(get_db), user=Depends(get_current_user)):
    # Allow an identical completed submission retry, but never a new mutation after submit.
    row, rnd = await owned(db, ident, user)
    old = await db.scalar(select(ProjectReviewEvent).where(ProjectReviewEvent.response_id == row.id, ProjectReviewEvent.request_id == body.request_id))
    payload = body.model_dump(mode='json')
    if old:
        if old.payload.get('request') != payload:
            raise HTTPException(409, '请求编号冲突')
        return success(view(row, rnd))
    row, rnd = await owned(db, ident, user, True)
    if not row.snapshot or row.revision != body.revision:
        raise HTTPException(409, '请先开始回顾，或刷新读取最新草稿')
    if row.revision >= 1000:
        raise HTTPException(429, '保存次数过多，请联系老师')
    answers = body.answers.model_dump(mode='json')
    for part in body.answers.snippets:
        source = row.snapshot['files'].get(part.file)
        if source is None or part.end < part.start or part.end > len(source.splitlines()):
            raise HTTPException(422, '代码片段超出冻结作品范围')
    for key in ('move', 'eat'):
        case = answers[key]
        if case['run_id']:
            evidence = await db.get(ProjectReviewEvent, UUID(case['run_id']))
            if not evidence or evidence.response_id != row.id or evidence.kind != 'run' or evidence.payload['scenario'] != key:
                raise HTTPException(422, '运行记录不属于本次回顾和情境')
    if body.action == 'prediction':
        if row.first_prediction or not body.answers.q2_choice:
            raise HTTPException(409, '首次预测已保存或尚未选择输出')
        row.first_prediction = {'choice': body.answers.q2_choice, 'reason': body.answers.q2_reason, 'at': now().isoformat()}
    if body.action in ('plan', 'submit') and not row.first_prediction:
        raise HTTPException(409, '先保存首次预测')
    if body.action == 'plan':
        if row.test_plan or not all(answers[k]['expected'] for k in ('move', 'eat')):
            raise HTTPException(409, '预期已锁定或还没有选完')
        row.test_plan = {k: answers[k]['expected'] for k in ('move', 'eat')}
    if row.test_plan:
        if any(answers[k]['expected'] != row.test_plan[k] for k in ('move', 'eat')):
            raise HTTPException(409, '运行前预期已锁定；修正理由请写在依据中')
    if body.action == 'submit':
        if not row.test_plan:
            raise HTTPException(409, '先保存两种情境的预期')
        if any(not answers[k]['status'] for k in ('move', 'eat')):
            raise HTTPException(422, '请选择验证结论；无法完成也可以如实记录')
        row.submitted_at = now()  # ai_hold intentionally remains true.
    before = row.answers
    row.answers, row.revision = answers, row.revision + 1
    record(db, row, user.id, body.action, {'request': payload, 'before': before, 'after': answers,
                                        'snapshot_hash': row.snapshot_hash, 'revision': row.revision}, body.request_id)
    await db.commit()
    return success(view(row, rnd))


@router.post('/{ident}/runs')
async def run(ident: UUID, body: Run, db=Depends(get_db), user=Depends(get_current_user)):
    row, _ = await owned(db, ident, user, True)
    if not row.test_plan or not row.first_prediction or body.snapshot_hash != row.snapshot_hash:
        raise HTTPException(409, '先保存预测和预期；仅使用冻结作品验证')
    if any(len(line) > 1000 for line in body.output):
        raise HTTPException(422, '输出过长')
    payload = {**body.model_dump(mode='json'), 'source': 'browser_report',
               'scenario_source': 'student_selected',
               'verified_by_server': False}
    existing = await db.scalar(select(ProjectReviewEvent).where(ProjectReviewEvent.response_id == row.id, ProjectReviewEvent.request_id == body.request_id))
    if existing:
        if existing.payload != payload:
            raise HTTPException(409, '请求编号冲突')
        return success({'id': str(existing.id)})
    count = await db.scalar(select(func.count()).select_from(ProjectReviewEvent).where(
        ProjectReviewEvent.response_id == row.id, ProjectReviewEvent.kind == 'run'))
    if count >= 100:
        raise HTTPException(429, '本次运行记录已达上限，可继续填写结论或联系老师')
    event = record(db, row, user.id, 'run', payload, body.request_id)
    await db.commit()
    return success({'id': str(event.id)})


@admin_router.get('/template')
async def template():
    return success({'template': TEMPLATE, 'template_hash': digest(TEMPLATE)})


@admin_router.get('/rounds')
async def rounds(db=Depends(get_db)):
    rows = (await db.scalars(select(ProjectReviewRound).order_by(ProjectReviewRound.created_at.desc()).limit(50))).all()
    return success([{'id': str(r.id), 'status': r.status, 'template_hash': r.template_hash, 'template': r.template,
                     'session_ids': r.session_ids, 'results_published': r.results_published, 'created_at': r.created_at} for r in rows])


@admin_router.post('/rounds')
async def create(body: Create, db=Depends(get_db), teacher=Depends(get_current_user)):
    await db.execute(text('SELECT pg_advisory_xact_lock(739204829)'))
    ids = sorted(set(map(str, body.session_ids)))
    old = await db.get(ProjectReviewRound, body.request_id)
    if old:
        if old.session_ids != ids or old.created_by != teacher.id:
            raise HTTPException(409, '请求编号冲突')
        return success({'id': str(old.id)})
    for ident in body.session_ids:
        session = await db.get(ClassroomSession, ident)
        plan = await db.scalar(select(LessonPlan).where(LessonPlan.session_id == ident))
        if not session or not plan or not plan.started_at or not session.is_current:
            raise HTTPException(422, '请选择已开始教学的当前课次')
    row = ProjectReviewRound(id=body.request_id, created_by=teacher.id, session_ids=ids, template=TEMPLATE, template_hash=digest(TEMPLATE))
    db.add(row)
    await db.commit()
    return success({'id': str(row.id)})


@admin_router.post('/rounds/{ident}/control')
async def control(ident: UUID, body: Control, db=Depends(get_db), teacher=Depends(get_current_user)):
    await db.execute(text('SELECT pg_advisory_xact_lock(739204829)'))
    rnd = await db.scalar(select(ProjectReviewRound).where(ProjectReviewRound.id == ident).with_for_update())
    if not rnd or rnd.template_hash != body.template_hash:
        raise HTTPException(409, '请先审阅当前版本')
    if body.action == 'open':
        if rnd.status == 'open':
            return success({'status': rnd.status})
        if rnd.status != 'draft':
            raise HTTPException(409, '已结束的回顾不能重开，请新建一轮')
        count = 0
        for sid in rnd.session_ids:
            session = await db.get(ClassroomSession, UUID(sid))
            plan = await db.scalar(select(LessonPlan).where(LessonPlan.session_id == session.id))
            if not session.is_current or not plan or not plan.started_at:
                raise HTTPException(409, '课次安排已变化')
            users = (await db.scalars(select(User).where(User.class_name == session.class_name, User.role != 'admin', User.is_active.is_(True)))).all()
            for user in users:
                task = plan.configuration.get('tasks', {}).get(user.experiment_group)
                if not task:
                    continue
                if await db.scalar(select(ProjectReviewResponse.id).where(ProjectReviewResponse.user_id == user.id, ProjectReviewResponse.ai_hold.is_(True))):
                    raise HTTPException(409, '有学生仍在另一轮回顾中，请先结束')
                row = ProjectReviewResponse(round_id=rnd.id, user_id=user.id, session_id=session.id, task_id=UUID(task['id']),
                                            class_snapshot=user.class_name, group_snapshot=user.experiment_group)
                db.add(row)
                await db.flush()
                record(db, row, teacher.id, 'opened', {'template_hash': rnd.template_hash, 'ai_hold': True})
                count += 1
        if not count:
            raise HTTPException(422, '所选课次没有已分组的学生')
        rnd.status, rnd.reviewed_at = 'open', now()
    elif body.action == 'end':
        if rnd.status != 'open':
            raise HTTPException(409, '本轮没有开放')
        for row in (await db.scalars(select(ProjectReviewResponse).where(ProjectReviewResponse.round_id == rnd.id).with_for_update())).all():
            row.ai_hold = False
            record(db, row, teacher.id, 'released', {'reason': 'teacher_ended_round', 'submitted': row.submitted_at is not None})
        rnd.status, rnd.ended_at = 'ended', now()
    else:
        if rnd.status != 'ended' or not body.confirmed_both_groups_ended:
            raise HTTPException(409, '请先结束本轮，并明确确认两个班都已完成核查')
        rnd.results_published = True
        for row in (await db.scalars(select(ProjectReviewResponse).where(ProjectReviewResponse.round_id == rnd.id))).all():
            record(db, row, teacher.id, 'results_published', {'template_hash': rnd.template_hash})
    await db.commit()
    return success({'status': rnd.status})


@admin_router.get('/rounds/{ident}/responses')
async def responses(ident: UUID, db=Depends(get_db)):
    rnd = await db.get(ProjectReviewRound, ident)
    if not rnd:
        raise HTTPException(404, '回顾不存在')
    rows = (await db.scalars(select(ProjectReviewResponse).where(ProjectReviewResponse.round_id == ident).order_by(ProjectReviewResponse.created_at).limit(201))).all()
    if len(rows) > 200:
        raise HTTPException(413, '人数过多，请使用研究包导出')
    names = {u.id: u for u in (await db.scalars(select(User).where(User.id.in_([r.user_id for r in rows])))).all()}
    return success([dict(view(row, rnd, True), name=names[row.user_id].name, student_id=names[row.user_id].student_id) for row in rows])


@admin_router.get('/responses/{ident}/events')
async def events(ident: UUID, db=Depends(get_db)):
    rows = (await db.scalars(select(ProjectReviewEvent).where(ProjectReviewEvent.response_id == ident)
                            .order_by(ProjectReviewEvent.created_at).limit(1001))).all()
    return success({'items': [{'id': str(r.id), 'kind': r.kind, 'payload': r.payload, 'at': r.created_at} for r in rows[:1000]], 'truncated': len(rows) > 1000})


@admin_router.post('/responses/{ident}/grade')
async def grade(ident: UUID, body: Grade, db=Depends(get_db), teacher=Depends(get_current_user)):
    row = await db.get(ProjectReviewResponse, ident)
    if not row:
        raise HTTPException(404, '答卷不存在')
    rnd = await db.scalar(select(ProjectReviewRound).where(ProjectReviewRound.id == row.round_id).with_for_update(read=True))
    row = await db.scalar(select(ProjectReviewResponse).where(ProjectReviewResponse.id == ident).with_for_update().execution_options(populate_existing=True))
    if not row.submitted_at or rnd.results_published:
        raise HTTPException(409, '仅可评分已提交且尚未发布成绩的答卷')
    if any(s < 0 or s > maximum for s, maximum in zip(body.scores, [3, 3, 4])) or any(len(n) > 500 for n in body.notes):
        raise HTTPException(422, '分数或备注超出范围')
    previous = row.grade
    row.grade = {**body.model_dump(), 'total': sum(body.scores), 'teacher_id': str(teacher.id), 'at': now().isoformat(), 'status': 'graded'}
    record(db, row, teacher.id, 'graded', {'before': previous, 'after': row.grade})
    await db.commit()
    return success(row.grade)
