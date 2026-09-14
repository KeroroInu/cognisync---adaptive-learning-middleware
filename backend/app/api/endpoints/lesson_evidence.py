"""Bounded lesson evidence reader. Literal mentions are not mastery measurements."""
from uuid import UUID
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import verify_admin_key
from app.db.postgres import get_db
from app.models.sql import ClassroomSession, LessonPlan, PreparationRecord, ChatMessage, StageEvent, User

router = APIRouter(prefix='/classroom', dependencies=[Depends(verify_admin_key)])


@router.get('/sessions/{session_id}/evidence')
async def lesson_evidence(session_id: UUID, source: Literal['preparation', 'chat', 'event'] = 'preparation', user_id: UUID | None = None,
                          offset: int = Query(0, ge=0), db: AsyncSession = Depends(get_db)):
    session = await db.get(ClassroomSession, session_id)
    if not session:
        raise HTTPException(404, '课次不存在')
    plan = await db.scalar(select(LessonPlan).where(LessonPlan.session_id == session_id))
    points = plan.configuration.get('knowledge_points', []) if plan else []
    model = {'preparation': PreparationRecord, 'chat': ChatMessage, 'event': StageEvent}[source]
    condition = (PreparationRecord.session_id == session_id if source == 'preparation' else
                 ChatMessage.analysis['lesson']['session_id'].astext == str(session_id) if source == 'chat' else
                 StageEvent.detail['lesson']['session_id'].astext == str(session_id))
    if user_id:
        condition = condition & (model.user_id == user_id)
    total = await db.scalar(select(func.count()).select_from(model).where(condition))
    timestamp = ChatMessage.timestamp if source == 'chat' else model.created_at
    rows = (await db.execute(select(model, User.name, User.student_id).join(User, User.id == model.user_id)
                            .where(condition).order_by(timestamp.desc(), model.id).offset(offset).limit(50))).all()
    items = []
    for row, name, student_id in rows:
        if source == 'preparation':
            request = row.payload.get('request', {})
            parts = [{'role': 'student', 'text': request.get('message', ''), 'kind': row.kind},
                     {'role': 'student_code', 'text': request.get('code', ''), 'kind': 'code_snapshot'},
                     {'role': 'assistant', 'text': row.payload.get('reply', ''), 'kind': 'reply'}]
            payload = row.payload
        elif source == 'chat':
            parts = [{'role': row.role.value, 'text': row.text, 'kind': 'message'}]
            payload = {'analysis': row.analysis}
        else:
            parts = []
            payload = {'stage': row.stage, 'event_type': row.event_type, 'detail': row.detail}
        for part in parts:
            part['mentioned_targets'] = [p for p in points if p.casefold() in part['text'].casefold()]
        items.append({'id': row.id, 'user_id': row.user_id, 'name': name, 'student_id': student_id,
                      'at': row.timestamp if source == 'chat' else row.created_at, 'parts': parts, 'payload': payload})
    return {'success': True, 'data': {'session_id': session.id, 'title': session.title, 'knowledge_points': points,
                                     'source': source, 'total': total, 'offset': offset, 'items': items,
                                     'method': 'literal-mention/v1',
                                     'limitation': '这里只定位原句中的同名知识点，不是掌握度。代码保存不等于学生独立编写；运行结果是浏览器上报。旧记录缺课次标签时不强行归课。'}}
