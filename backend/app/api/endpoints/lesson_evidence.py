"""Bounded lesson evidence reader. Literal mentions are not mastery measurements."""
from uuid import UUID
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, literal, union_all
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import verify_admin_key
from app.db.postgres import get_db
from app.models.sql import ClassroomSession, LessonPlan, PreparationRecord, ChatMessage, StageEvent, User
from app.services.process_evidence import artifact_changes, change_parts
from app.models.sql import LearningSupportTurn

router = APIRouter(prefix='/classroom', dependencies=[Depends(verify_admin_key)])


@router.get('/sessions/{session_id}/evidence')
async def lesson_evidence(session_id: UUID, source: Literal['preparation', 'chat', 'event', 'process'] = 'preparation', user_id: UUID | None = None,
                          offset: int = Query(0, ge=0), db: AsyncSession = Depends(get_db)):
    session = await db.get(ClassroomSession, session_id)
    if not session:
        raise HTTPException(404, '课次不存在')
    plan = await db.scalar(select(LessonPlan).where(LessonPlan.session_id == session_id))
    points = plan.configuration.get('knowledge_points', []) if plan else []
    if source == 'process':
        branches = []
        for kind, model, timestamp, condition in [
            ('support', LearningSupportTurn, LearningSupportTurn.created_at, LearningSupportTurn.session_id == session_id),
            ('preparation', PreparationRecord, PreparationRecord.created_at, PreparationRecord.session_id == session_id),
            ('chat', ChatMessage, ChatMessage.timestamp, ChatMessage.analysis['lesson']['session_id'].astext == str(session_id)),
            ('event', StageEvent, StageEvent.created_at, StageEvent.detail['lesson']['session_id'].astext == str(session_id)),
        ]:
            query = select(model.id.label('id'), literal(kind).label('kind'), timestamp.label('at')).where(condition)
            if kind == 'chat':
                query = query.where(ChatMessage.analysis['commonSupportId'].astext.is_(None))
            elif kind == 'preparation':
                query = query.where(PreparationRecord.payload['support']['turn_id'].astext.is_(None))
            branches.append(query.where(model.user_id == user_id) if user_id else query)
        index = union_all(*branches).subquery()
        total = await db.scalar(select(func.count()).select_from(index))
        page = (await db.execute(select(index).order_by(index.c.at.desc(), index.c.kind, index.c.id).offset(offset).limit(50))).all()
        records = {}
        for kind, model in [('support', LearningSupportTurn), ('preparation', PreparationRecord), ('chat', ChatMessage), ('event', StageEvent)]:
            ids = [r.id for r in page if r.kind == kind]
            if ids:
                records.update({(kind, r.id): (r, name, student_id) for r, name, student_id in
                    (await db.execute(select(model, User.name, User.student_id).join(User, User.id == model.user_id).where(model.id.in_(ids)))).all()})
        rows = [(r.kind, *records[(r.kind, r.id)]) for r in page]
    else:
        total, rows = await source_rows(db, source, session_id, user_id, offset)
        rows = [(source, *row) for row in rows]
    changes = await artifact_changes(db, [row.id for kind, row, _name, _student_id in rows if kind == 'event'])
    items = []
    for kind, row, name, student_id in rows:
        if kind == 'support':
            request = row.payload['request']
            parts = [{'role': 'student', 'text': request['message'], 'kind': 'support_action'},
                     {'role': 'student_code', 'text': request['code'], 'kind': 'code_snapshot'},
                     {'role': 'assistant', 'text': row.payload.get('reply', ''), 'kind': 'reply'},
                     {'role': '知识点关联（待确认，不是掌握）', 'text': '、'.join(m['title'] for m in row.payload.get('knowledge_mappings', [])), 'kind': 'knowledge_evidence'}]
            payload = row.payload
        elif kind == 'preparation':
            request = row.payload.get('request', {})
            parts = [{'role': 'student', 'text': request.get('message', ''), 'kind': row.kind},
                     {'role': 'student_code', 'text': request.get('code', ''), 'kind': 'code_snapshot'},
                     {'role': 'assistant', 'text': row.payload.get('reply', ''), 'kind': 'reply'}]
            payload = row.payload
            if row.kind == 'design' and payload.get('schema') == 'sfls-design/1':
                import json
                parts = [{'role': 'student', 'text': payload.get('requirements', ''), 'kind': 'requirements'},
                         {'role': 'student_design', 'text': json.dumps({'nodes': payload.get('nodes', []), 'edges': payload.get('edges', [])}, ensure_ascii=False), 'kind': 'architecture'}]
        elif kind == 'chat':
            parts = [{'role': row.role.value, 'text': row.text, 'kind': 'message'}]
            evidence = (row.analysis or {}).get('learningEvidence') or {}
            if evidence.get('code_snapshot') is not None:
                parts.append({'role': 'student_code', 'text': evidence['code_snapshot'], 'kind': 'code_snapshot'})
            payload = {'analysis': row.analysis}
        else:
            parts = change_parts(changes.get(row.id, []))
            payload = {'stage': row.stage, 'event_type': row.event_type, 'detail': row.detail, 'artifact_changes': changes.get(row.id, [])}
        for part in parts:
            part['text'] = part['text'] or ''
            part['mentioned_targets'] = [p for p in points if p.casefold() in part['text'].casefold()]
        items.append({'id': row.id, 'source': kind,
                      'kind': row.payload['request']['action'] if kind == 'support' else row.event_type.value if kind == 'event' else row.role.value if kind == 'chat' else row.kind,
                      'user_id': row.user_id, 'name': name, 'student_id': student_id,
                      'at': row.timestamp if kind == 'chat' else row.created_at, 'parts': parts, 'payload': payload})
    return {'success': True, 'data': {'session_id': session.id, 'title': session.title, 'knowledge_points': points,
                                     'source': source, 'total': total, 'offset': offset, 'items': items,
                                     'method': 'literal-mention/v1',
                                     'limitation': '按时间查看原话、编辑器快照和产物版本。先后发生不代表采纳或理解；知识点提及不是掌握度。运行结果是浏览器上报。旧记录缺课次标签时不强行归课。'}}


async def source_rows(db, source, session_id, user_id, offset):
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
    return total, rows
