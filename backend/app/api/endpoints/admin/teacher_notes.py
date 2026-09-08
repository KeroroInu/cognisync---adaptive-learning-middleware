"""Private teacher notes, linked to same-student evidence with immutable corrections."""
import csv
from datetime import date
import io
import json
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.endpoints.auth import get_current_user
from app.core.security import verify_admin_key
from app.db.postgres import get_db
from app.models.sql.research import ResearchTask
from app.models.sql.research_event import StageEvent
from app.models.sql.teacher_note import TeacherNote
from app.models.sql.user import User
from app.schemas.base import SuccessResponse

router = APIRouter(tags=["Admin - Classroom Notes"], dependencies=[Depends(verify_admin_key)])


class AssessmentInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, allow_inf_nan=False)
    rubric_version: str = Field(min_length=1, max_length=120)
    criterion: str = Field(min_length=1, max_length=120)
    score: float = Field(ge=0)
    max_score: float = Field(gt=0, le=1000)

    @model_validator(mode="after")
    def valid_score(self):
        if self.score > self.max_score:
            raise ValueError("得分不能大于满分")
        return self


class NoteInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    request_id: UUID
    lesson_date: date
    lesson_label: str = Field(min_length=1, max_length=120)
    observation: str = Field(min_length=1, max_length=2000)
    interpretation: str = Field(default="", max_length=1000)
    next_step: str = Field(default="", max_length=1000)
    evidence_ids: list[UUID] = Field(default_factory=list, max_length=10)
    supersedes_id: UUID | None = None
    assessment: AssessmentInput | None = None


def note_row(note: TeacherNote) -> dict:
    return {
        "id": str(note.id), "student_id": str(note.student_id),
        "teacher_id": str(note.teacher_id), "teacher_name": note.teacher_name,
        "group_snapshot": note.group_snapshot, "class_snapshot": note.class_snapshot,
        "lesson_date": note.lesson_date.isoformat(), "lesson_label": note.lesson_label,
        "observation": note.observation, "interpretation": note.interpretation,
        "next_step": note.next_step, "evidence": note.evidence,
        "assessment": note.assessment,
        "supersedes_id": str(note.supersedes_id) if note.supersedes_id else None,
        "created_at": note.created_at.isoformat(),
    }


async def require_student(student_id: UUID, db: AsyncSession) -> User:
    student = await db.get(User, student_id)
    if not student:
        raise HTTPException(404, "学生不存在")
    return student


@router.get("/users/{student_id}/teacher-notes")
async def list_notes(student_id: UUID, offset: int = Query(0, ge=0), limit: int = Query(30, ge=1, le=100), db: AsyncSession = Depends(get_db)):
    await require_student(student_id, db)
    notes = (await db.scalars(select(TeacherNote).where(TeacherNote.student_id == student_id)
             .order_by(TeacherNote.created_at.desc(), TeacherNote.id.desc()).offset(offset).limit(limit + 1))).all()
    return SuccessResponse(data={"notes": [note_row(note) for note in notes[:limit]], "has_more": len(notes) > limit})


@router.get("/users/{student_id}/teacher-note-evidence")
async def note_evidence(student_id: UUID, db: AsyncSession = Depends(get_db)):
    await require_student(student_id, db)
    rows = (await db.execute(select(StageEvent, ResearchTask.title).join(ResearchTask, StageEvent.task_id == ResearchTask.id)
            .where(StageEvent.user_id == student_id).order_by(StageEvent.created_at.desc()).limit(30))).all()
    return SuccessResponse(data={"events": [{"id": str(event.id), "task_title": title,
        "stage": event.stage.value, "event_type": event.event_type.value,
        "created_at": event.created_at.isoformat()} for event, title in rows]})


@router.post("/users/{student_id}/teacher-notes")
async def create_note(student_id: UUID, body: NoteInput, db: AsyncSession = Depends(get_db), teacher: User = Depends(get_current_user)):
    student = await require_student(student_id, db)
    existing = await db.get(TeacherNote, body.request_id)

    def same_request(note: TeacherNote) -> bool:
        return (note.student_id == student_id and note.teacher_id == teacher.id
                and note.lesson_date == body.lesson_date and note.lesson_label == body.lesson_label
                and note.observation == body.observation and note.interpretation == body.interpretation
                and note.next_step == body.next_step and note.supersedes_id == body.supersedes_id
                and note.assessment == (body.assessment.model_dump() if body.assessment else None)
                and {item["event_id"] for item in note.evidence} == {str(item) for item in body.evidence_ids})

    if existing:
        if not same_request(existing):
            raise HTTPException(409, "保存编号已被其他内容使用，请刷新后重试")
        return SuccessResponse(data=note_row(existing))
    if body.supersedes_id:
        previous = await db.get(TeacherNote, body.supersedes_id)
        if not previous or previous.student_id != student_id:
            raise HTTPException(422, "更正必须关联这位学生已有的备注")
    ids = set(body.evidence_ids)
    events = (await db.scalars(select(StageEvent).where(StageEvent.id.in_(ids), StageEvent.user_id == student_id))).all() if ids else []
    if {event.id for event in events} != ids:
        raise HTTPException(422, "只能关联这位学生真实存在的学习事件")
    note = TeacherNote(
        id=body.request_id, student_id=student_id, teacher_id=teacher.id,
        teacher_name=teacher.name, group_snapshot=student.experiment_group or "unassigned",
        class_snapshot=student.class_name or "", lesson_date=body.lesson_date, lesson_label=body.lesson_label,
        observation=body.observation, interpretation=body.interpretation, next_step=body.next_step,
        supersedes_id=body.supersedes_id,
        assessment=body.assessment.model_dump() if body.assessment else None,
        evidence=[{"event_id": str(event.id), "task_id": str(event.task_id), "stage": event.stage.value,
                   "event_type": event.event_type.value, "created_at": event.created_at.isoformat()} for event in events],
    )
    db.add(note)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        existing = await db.get(TeacherNote, body.request_id)
        if existing and same_request(existing):
            return SuccessResponse(data=note_row(existing))
        raise HTTPException(409, "备注保存冲突，原记录未改动，请重试")
    await db.refresh(note)
    return SuccessResponse(data=note_row(note))


def safe_cell(value) -> str:
    value = "" if value is None else str(value)
    # Spreadsheet applications must not execute teacher-authored text as formulas.
    return "'" + value if value.lstrip().startswith(("=", "+", "-", "@")) or value.startswith(("\t", "\r")) else value


@router.get("/export/csv/teacher-notes")
async def export_notes(student_id: UUID | None = None, db: AsyncSession = Depends(get_db)):
    query = select(TeacherNote).order_by(TeacherNote.student_id, TeacherNote.created_at, TeacherNote.id)
    if student_id:
        await require_student(student_id, db)
        query = query.where(TeacherNote.student_id == student_id)
    notes = (await db.scalars(query.limit(10001))).all()
    if len(notes) > 10000:
        raise HTTPException(422, "记录超过单次导出上限，请按学生导出")
    fields = ["id", "student_id", "teacher_id", "group_snapshot", "lesson_date", "lesson_label",
              "observation", "interpretation", "next_step", "evidence", "assessment", "supersedes_id", "created_at"]
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=fields)
    writer.writeheader()
    for note in notes:
        row = note_row(note)
        row["evidence"] = json.dumps(row["evidence"], ensure_ascii=False)
        row["assessment"] = json.dumps(row["assessment"], ensure_ascii=False) if row["assessment"] else ""
        writer.writerow({key: safe_cell(row[key]) for key in fields})
    return StreamingResponse(iter(["\ufeff" + output.getvalue()]), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": 'attachment; filename="teacher_notes.csv"'})
