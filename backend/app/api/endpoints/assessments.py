"""Teacher-controlled, versioned assessments. Never calls the profile/LLM pipeline."""
from datetime import datetime, timezone
from typing import Literal
from uuid import UUID, uuid5

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import case, func, or_, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import load_only

from app.api.endpoints.auth import get_current_user
from app.core.security import verify_admin_key
from app.core.student_identity import TeachingClass
from app.db.postgres import get_db
from app.models.sql.assessment import AssessmentResponse, AssessmentRound
from app.models.sql.user import User
from app.schemas.assessment import Question, validate_answer, visible_question_ids

router = APIRouter(prefix="/assessments", tags=["Assessments"])
admin_router = APIRouter(prefix="/assessments", dependencies=[Depends(verify_admin_key)], tags=["Admin Assessments"])
LOCK = 739204822


class RoundInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    phase: Literal["pre", "post"]
    name: str = Field(min_length=1, max_length=200)
    class_name: str = Field(default="", max_length=100)
    source: str = Field(default="", max_length=2000)
    questions: list[Question] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def unique_questions(self):
        if len({q.id for q in self.questions}) != len(self.questions):
            raise ValueError("题目编号不能重复")
        previous = {}
        for q in self.questions:
            if q.parent_id and (q.parent_id not in previous or previous[q.parent_id].parent_id):
                raise ValueError('补充字段必须关联前面的一道主问题')
            for condition in q.show_if:
                source = previous.get(condition.question_id)
                if not source or source.type == 'text' or not set(condition.values) <= {o.value for o in source.options}:
                    raise ValueError('跳题只能依赖前面选择题的有效选项')
            previous[q.id] = q
        return self


class ToggleInput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    enabled: bool


class DistributeInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID
    class_name: TeachingClass


class AnswerInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    answers: dict[str, str | list[str] | None] = Field(max_length=100)
    started_at: datetime


def present(item, *, student=False):
    result = {"id": str(item.id), "phase": item.phase, "revision": item.revision, "questions": item.questions}
    if student:
        result["served_at"] = datetime.now(timezone.utc).isoformat()
    if not student:
        result.update(name=item.name, class_name=item.class_name, source=item.source, enabled=item.enabled,
                      published_at=item.published_at, created_at=item.created_at)
    return result


async def pending_round(db, user, *, metadata_only=False):
    # The latest class assignment wins across legacy pre/post labels. Labels are
    # retained for historical exports, not used to schedule classroom delivery.
    query = select(AssessmentRound)
    if metadata_only:
        query = query.options(load_only(AssessmentRound.id, AssessmentRound.revision))
    rounds = (await db.scalars(query.where(
        AssessmentRound.enabled.is_(True),
        or_(AssessmentRound.class_name == "", AssessmentRound.class_name == (user.class_name or "")),
    ).order_by(case((AssessmentRound.class_name != "", 0), else_=1), AssessmentRound.created_at.desc(), AssessmentRound.id.desc()).limit(1))).first()
    if not rounds:
        return None
    done = await db.scalar(select(AssessmentResponse.id).where(
        AssessmentResponse.user_id == user.id, AssessmentResponse.round_id == rounds.id))
    return None if done else rounds


@router.get("/pending")
async def pending(response: Response, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    response.headers["Cache-Control"] = "no-store"
    item = await pending_round(db, user)
    return {"success": True, "data": present(item, student=True) if item else None}


@router.get("/status")
async def assessment_status(response: Response, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Small authenticated poll: do not read or transfer the question JSON."""
    response.headers["Cache-Control"] = "no-store"
    item = await pending_round(db, user, metadata_only=True)
    return {"success": True, "data": {"id": str(item.id), "revision": item.revision} if item else None}


@admin_router.get("")
async def list_rounds(db: AsyncSession = Depends(get_db)):
    counts = select(AssessmentResponse.round_id, func.count().label("n")).group_by(AssessmentResponse.round_id).subquery()
    rows = (await db.execute(select(AssessmentRound, counts.c.n).outerjoin(counts, counts.c.round_id == AssessmentRound.id).order_by(AssessmentRound.created_at.desc()).limit(200))).all()
    return {"success": True, "data": [{**present(item), "response_count": n or 0} for item, n in rows]}


@admin_router.get('/templates/learning-background')
async def background_template():
    """Read-only template: never replaces a published round or its responses."""
    import json
    from pathlib import Path
    template = Path(__file__).resolve().parents[2] / 'resources/programming_ai_survey_v2.json'
    return {"success": True, "data": RoundInput.model_validate(json.loads(template.read_text())).model_dump()}


@admin_router.get('/{round_id}/definition')
async def export_definition(round_id: UUID, db: AsyncSession = Depends(get_db)):
    import json
    item = await db.get(AssessmentRound, round_id)
    if not item:
        raise HTTPException(404, '找不到这份题本')
    return Response(json.dumps(present(item), ensure_ascii=False, indent=2, default=str),
                    media_type='application/json', headers={
                        'Content-Disposition': f'attachment; filename="assessment-{round_id}.json"',
                        'Cache-Control': 'no-store'})


@admin_router.get('/{round_id}/export')
async def export_answers(round_id: UUID, db: AsyncSession = Depends(get_db)):
    import csv
    import io
    import json
    from app.services.research_package import csv_cell, offload
    item = await db.get(AssessmentRound, round_id)
    if not item:
        raise HTTPException(404, '找不到这份题本')
    rows = (await db.execute(select(AssessmentResponse, User.student_id).join(User, User.id == AssessmentResponse.user_id)
        .where(AssessmentResponse.round_id == round_id).order_by(AssessmentResponse.created_at, AssessmentResponse.id).limit(1001))).all()
    if len(rows) > 1000:
        raise HTTPException(413, '超过 1000 份答卷，请使用数据导出的完整研究包')
    questions, revision = item.questions, item.revision
    records = [(r.id, r.user_id, student_id, r.class_snapshot, r.group_snapshot, r.started_at, r.created_at, r.answers) for r, student_id in rows]
    await db.commit()  # Do not retain a DB connection while encoding the export.

    def encode():
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(['round_id', 'revision', 'response_id', 'user_id', 'student_id', 'class', 'group', 'started_at', 'submitted_at', 'question_id', 'question', 'type', 'status', 'answer_value', 'answer_label', 'parent_id', 'code', 'hint'])
        for rid, uid, sid, cls, group, started, submitted, answers in records:
            visible = visible_question_ids(questions, answers)
            for q in questions:
                value = answers.get(q['id'])
                empty = value in (None, '', []) or isinstance(value, str) and not value.strip()
                status = 'skipped_by_rule' if q['id'] not in visible else 'unanswered' if empty else 'answered'
                options = {o['value']: o['label'] for o in q['options']}
                label = '；'.join(options.get(v, v) for v in value) if isinstance(value, list) else options.get(value, value or '')
                if value == '__skip__' and q.get('skip_label'):
                    label = q['skip_label']
                raw = json.dumps(value, ensure_ascii=False) if isinstance(value, list) else value
                writer.writerow([csv_cell(v) for v in [str(round_id), revision, str(rid), str(uid), sid, cls, group, started.isoformat(), submitted.isoformat(), q['id'], q['text'], q['type'], status, raw, label, q.get('parent_id'), q.get('code', ''), q.get('hint', '')]])
        return ('\ufeff' + output.getvalue()).encode('utf-8')
    content = await offload(encode)
    return Response(content, media_type='text/csv; charset=utf-8', headers={'Content-Disposition': f'attachment; filename="survey-{round_id}.csv"', 'Cache-Control': 'no-store'})


@admin_router.post("")
async def create_round(data: RoundInput, db: AsyncSession = Depends(get_db)):
    await db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": LOCK})
    revision = (await db.scalar(select(func.max(AssessmentRound.revision)).where(AssessmentRound.phase == data.phase, AssessmentRound.class_name == data.class_name)) or 0) + 1
    item = AssessmentRound(**data.model_dump(), revision=revision)
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return {"success": True, "data": present(item)}


@admin_router.put("/{round_id}")
async def edit_round(round_id: UUID, data: RoundInput, db: AsyncSession = Depends(get_db)):
    item = await db.scalar(select(AssessmentRound).where(AssessmentRound.id == round_id).with_for_update())
    if not item:
        raise HTTPException(404, "找不到这份题本")
    if item.published_at:
        raise HTTPException(409, "已开放的题本不能改写，请另存新版；原答卷仍保留")
    if item.phase != data.phase or item.class_name != data.class_name:
        raise HTTPException(409, "更改测量阶段或班级请另存新版")
    item.name, item.source, item.questions = data.name, data.source, [q.model_dump() for q in data.questions]
    await db.commit()
    return {"success": True, "data": present(item)}


@admin_router.post("/{round_id}/availability")
async def toggle_round(round_id: UUID, data: ToggleInput, db: AsyncSession = Depends(get_db)):
    await db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": LOCK})
    item = await db.scalar(select(AssessmentRound).where(AssessmentRound.id == round_id).with_for_update())
    if not item:
        raise HTTPException(404, "找不到这份题本")
    if data.enabled:
        await db.execute(update(AssessmentRound).where(AssessmentRound.class_name == item.class_name, AssessmentRound.id != item.id).values(enabled=False))
        item.published_at = item.published_at or datetime.now(timezone.utc)
    item.enabled = data.enabled
    await db.commit()
    return {"success": True, "data": present(item)}


@admin_router.post("/{round_id}/distribute")
async def distribute_round(round_id: UUID, data: DistributeInput, db: AsyncSession = Depends(get_db)):
    """Freeze a class-specific copy; never retarget an existing response history."""
    await db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": LOCK})
    source = await db.get(AssessmentRound, round_id)
    if not source:
        raise HTTPException(404, "找不到这份题本")
    delivery_id = uuid5(round_id, f"classroom:{data.class_name}:{data.request_id}")
    existing = await db.get(AssessmentRound, delivery_id)
    if existing:
        # Retrying a timed-out request must not reopen a subsequently closed round.
        return {"success": True, "data": present(existing)}
    revision = (await db.scalar(select(func.max(AssessmentRound.revision)).where(
        AssessmentRound.phase == source.phase, AssessmentRound.class_name == data.class_name)) or 0) + 1
    await db.execute(update(AssessmentRound).where(
        AssessmentRound.class_name == data.class_name, AssessmentRound.enabled.is_(True)).values(enabled=False))
    item = AssessmentRound(id=delivery_id, phase=source.phase, class_name=data.class_name,
        name=source.name, source=source.source, questions=source.questions, revision=revision,
        enabled=True, published_at=datetime.now(timezone.utc))
    db.add(item)
    await db.commit()
    return {"success": True, "data": present(item)}


@router.post("/{round_id}/responses")
async def submit_answers(round_id: UUID, data: AnswerInput, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    # Shared lock allows the class to submit together; close/edit needs exclusive lock.
    item = await db.scalar(select(AssessmentRound).where(AssessmentRound.id == round_id).with_for_update(read=True))
    if not item or item.class_name not in ("", user.class_name or ""):
        raise HTTPException(404, "找不到这份问卷")
    existing = await db.scalar(select(AssessmentResponse).where(AssessmentResponse.round_id == round_id, AssessmentResponse.user_id == user.id))
    if existing:
        if existing.answers != data.answers:
            raise HTTPException(409, "这份问卷已经提交，不能覆盖原答案")
        return {"success": True, "data": {"id": str(existing.id), "already_submitted": True}}
    if not item.enabled:
        raise HTTPException(409, "老师已关闭这份问卷。你的本机草稿仍保留，可返回课堂")
    pending_item = await pending_round(db, user)
    if not pending_item or pending_item.id != item.id:
        raise HTTPException(409, "问卷安排已更新，请重新读取")
    questions = {q["id"]: q for q in item.questions}
    visible = visible_question_ids(item.questions, data.answers)
    if set(data.answers) - questions.keys():
        raise HTTPException(422, "答案包含未知题目")
    for qid, q in questions.items():
        if qid not in visible:
            if data.answers.get(qid) not in (None, '', []):
                raise HTTPException(422, '已跳过的题目不能提交答案，请重新读取题本')
            continue
        try:
            validate_answer(q, data.answers.get(qid))
        except ValueError as error:
            raise HTTPException(422, str(error)) from error
    now = datetime.now(timezone.utc)
    if data.started_at.tzinfo is None or data.started_at > now or data.started_at < item.published_at:
        raise HTTPException(422, "开始时间无效，请重新打开问卷")
    response_id = await db.scalar(insert(AssessmentResponse).values(user_id=user.id, round_id=item.id, answers=data.answers,
        started_at=data.started_at, class_snapshot=user.class_name or "", group_snapshot=user.experiment_group or "unassigned").on_conflict_do_nothing(
        constraint="uq_assessment_answer").returning(AssessmentResponse.id))
    if response_id is None:
        existing = await db.scalar(select(AssessmentResponse).where(AssessmentResponse.round_id == round_id, AssessmentResponse.user_id == user.id))
        if existing.answers != data.answers:
            raise HTTPException(409, "这份问卷已经提交，不能覆盖原答案")
        return {"success": True, "data": {"id": str(existing.id), "already_submitted": True}}
    await db.commit()
    return {"success": True, "data": {"id": str(response_id), "already_submitted": False}}
