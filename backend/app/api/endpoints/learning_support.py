"""One classroom support path for both groups and preparation, with durable evidence."""
from datetime import datetime, timezone
from time import perf_counter
import hashlib
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.endpoints.auth import get_current_user
from app.core.security import verify_admin_key
from app.db.postgres import get_db
from app.models.sql import LearningSupportTurn, LearningPracticeReview, User
from app.models.sql import ChatMessage
from app.services.learning_evidence import turn_evidence
from app.services import common_support as policy
from app.services.classroom_service import effective_state, llm_classroom_scope
from app.services.lesson_service import lesson_for_user
from app.services.llm_config import get_chat_provider

router = APIRouter(prefix="/learning-support", tags=["Learning support"])


@router.get('/evidence-graph', dependencies=[Depends(verify_admin_key)])
async def evidence_graph(session_id: UUID, user_id: UUID | None = None, db: AsyncSession = Depends(get_db)):
    query = select(LearningSupportTurn).where(LearningSupportTurn.session_id == session_id)
    if user_id:
        query = query.where(LearningSupportTurn.user_id == user_id)
    rows = (await db.scalars(query.order_by(LearningSupportTurn.created_at.desc()).limit(501))).all()
    nodes, edges = {}, []
    for turn in rows[:500]:
        payload = turn.payload
        for mapping in payload.get('knowledge_mappings', []):
            key = f"{mapping['corpus_hash']}:{mapping['knowledge_id']}"
            nodes[key] = {'id': key, **mapping}
            edges.append({'source_turn_id': str(turn.id), 'user_id': str(turn.user_id), 'target': key,
                          'relation': payload['request']['action'], 'mapping_status': 'candidate',
                          'entry': payload['entry'], 'at': turn.created_at})
    return {'success': True, 'data': {'nodes': list(nodes.values()), 'edges': edges, 'truncated': len(rows) > 500,
        'limitation': '最近500个交互的教材候选关联，不是掌握度；完整记录在研究包。旧推断图谱未改写。'}}


async def scope_for(db, user, body):
    session, plan = await lesson_for_user(db, user)
    if session and effective_state(session) != "open":
        raise HTTPException(403, "老师已关闭 AI")
    task = None
    if plan and plan.started_at:
        snapshot = plan.configuration.get("tasks", {}).get(user.experiment_group)
        if not snapshot:
            raise HTTPException(403, "本课未给你的小组开放 AI 任务")
        if snapshot:
            from app.services.research_task_service import get_visible_task
            task = await get_visible_task(db, user, UUID(snapshot["id"]), require_active=True)
            if not snapshot.get("ai_enabled", True) or not task.ai_enabled:
                raise HTTPException(403, "老师没有开放本课 AI")
    if body.entry != "preparation" and task is None:
        raise HTTPException(403, "老师还没有开放本课任务")
    if body.task_id and (task is None or body.task_id != task.id):
        raise HTTPException(403, "本节课没有开放这个任务")
    # Entry is deliberately absent: re-entering through preparation never raises permissions.
    scope = policy.digest([str(session.id) if session else None, str(task.id) if task else None, body.stage, body.focus])
    return scope, session, task, plan


async def last_turn(db, user, scope):
    return await db.scalar(select(LearningSupportTurn).where(
        LearningSupportTurn.user_id == user.id, LearningSupportTurn.scope == scope,
    ).order_by(LearningSupportTurn.created_at.desc(), LearningSupportTurn.id.desc()).limit(1))


async def available_templates(db, knowledge_ids):
    reviews = {r.template_id: r for r in (await db.scalars(select(LearningPracticeReview))).all()}
    return [t for t in policy.PRACTICES if t["knowledge_id"] in knowledge_ids
            and t["id"] in reviews and reviews[t["id"]].approved
            and reviews[t["id"]].content_hash == policy.digest(t)]


def response(turn):
    payload = turn.payload
    return {"message": payload.get("reply", ""), "support": {
        **payload["state"], "turn_id": str(turn.id), "policy_version": policy.VERSION,
        "practice_available": payload.get("practice_available", False),
        "practice": payload.get("practice"), "status": payload["status"],
    }}


@router.get("/state")
async def state(task_id: UUID | None = None, stage: str = "build", focus: str = "workspace",
                entry: str = "classroom", db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    try:
        body = policy.SupportInput(request_id=uuid4(), task_id=task_id, stage=stage, focus=focus, entry=entry)
    except ValueError:
        raise HTTPException(422, "无效的学习上下文")
    scope, _, _, _ = await scope_for(db, user, body)
    last = await last_turn(db, user, scope)
    history = (await db.scalars(select(LearningSupportTurn).where(
        LearningSupportTurn.user_id == user.id, LearningSupportTurn.scope == scope,
    ).order_by(LearningSupportTurn.created_at.desc()).limit(12))).all()
    return {"success": True, "data": {
        **(response(last)["support"] if last else {**policy.initial_state(), "practice_available": False}),
        "history": [{"id": str(t.id), "question": t.payload["request"]["message"],
                     "reply": t.payload.get("reply", ""), "status": t.payload["status"]} for t in reversed(history)],
    }}


async def reply(body, db, user):
    scope, session, task, plan = await scope_for(db, user, body)
    request = body.model_dump(mode="json")
    await db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": user.id.int % (2**63 - 1)})
    existing = await db.scalar(select(LearningSupportTurn).where(
        LearningSupportTurn.user_id == user.id, LearningSupportTurn.request_id == body.request_id))
    if existing:
        if existing.payload["request"] != request:
            raise HTTPException(409, "请求编号已用于其他内容")
        if existing.payload["status"] == "pending":
            raise HTTPException(409, "这条问题还在处理中，请稍后刷新")
        if existing.payload["status"] == "failed":
            raise HTTPException(503, "上次请求失败，请重新提问")
        return response(existing)
    last = await last_turn(db, user, scope)
    if last and last.payload["status"] == "pending" and (datetime.now(timezone.utc) - last.created_at).total_seconds() < 150:
        raise HTTPException(409, "当前问题还在回复中")
    previous = last.payload["state"] if last else None
    current, change = policy.transition(previous, body.action)
    # Shortcut text is not a new topic. Keep the preceding explicit resource references.
    sources, mappings = policy.resources(body.message, body.focus, body.stage)
    if body.action != "message" and last:
        sources, mappings = last.payload.get("textbook_sources", []), last.payload.get("knowledge_mappings", [])
    kind = policy.support_kind(body)
    if body.action not in ("message", "rephrase") and last:
        kind = last.payload["help_type"]
    templates = await available_templates(db, [m["knowledge_id"] for m in mappings])
    practice = None
    deterministic = None
    exercise_evidence = None
    if body.action == "practice":
        if not templates:
            raise HTTPException(409, "这个知识点还没有老师审核的短题，可以继续提问或回项目")
        chosen = templates[0]
        review = await db.scalar(select(LearningPracticeReview).where(LearningPracticeReview.template_id == chosen['id']))
        practice = {**policy.public_practice(chosen), "instance_id": str(body.request_id)}
        exercise_evidence = {"template": chosen, "content_hash": policy.digest(chosen), "answer_shown": False,
                             "review": {"id": str(review.id), "reviewed_by": str(review.reviewed_by), "at": review.created_at.isoformat()}}
        deterministic = "试一道小题，随时可以回项目。这不是考试。"
    elif body.action in ("answer", "show_answer", "return_project"):
        if body.practice_id is None:
            raise HTTPException(422, "缺少练习编号")
        origin = await db.scalar(select(LearningSupportTurn).where(
            LearningSupportTurn.user_id == user.id, LearningSupportTurn.scope == scope,
            LearningSupportTurn.request_id == body.practice_id))
        if not origin or origin.payload["request"]["action"] != "practice":
            raise HTTPException(404, "找不到本次练习")
        chosen = origin.payload["exercise_evidence"]["template"]
        shown = bool(await db.scalar(select(LearningSupportTurn.id).where(
            LearningSupportTurn.user_id == user.id, LearningSupportTurn.scope == scope,
            LearningSupportTurn.payload["request"]["practice_id"].astext == str(body.practice_id),
            LearningSupportTurn.payload["request"]["action"].astext.in_(["answer", "show_answer"])).limit(1)))
        exercise_evidence = {"template": chosen, "origin_turn_id": str(origin.id),
            "content_hash": policy.digest(chosen), "answer": body.answer if body.action == "answer" else None,
            "answer_previously_shown": shown, "correct": None, "mastery": None}
        if body.action == "return_project":
            deterministic = chosen["return_hint"]
        else:
            if body.action == "answer":
                if body.answer not in chosen["options"]:
                    raise HTTPException(422, "请选一个答案")
                exercise_evidence["correct"] = body.answer == chosen["answer"]
            exercise_evidence["answer_shown"] = True
            deterministic = ("这题答对了。" if exercise_evidence["correct"] is True else "一起看一下。") + chosen["explanation"]
            practice = {**policy.public_practice(chosen), "instance_id": str(body.practice_id), "answered": True}
    elif body.action == "understood":
        deterministic = "收到，你可以继续了。需要时再叫我。"
    elif body.action == "try_self":
        deterministic = "好，你先试试。已有示例会保留，需要时点“继续帮我”。"
    if change["reason"] == "progressive_support_required":
        deterministic = "我们先把当前卡点说具体些，再一步步补全。可以点“再具体一点”。"
    recent = (await db.scalars(select(LearningSupportTurn).where(LearningSupportTurn.user_id == user.id,
        LearningSupportTurn.scope == scope).order_by(LearningSupportTurn.created_at.desc()).limit(6))).all()
    history = [{"question": t.payload["request"]["message"], "reply": t.payload.get("reply", "")} for t in reversed(recent)]
    item = LearningSupportTurn(user_id=user.id, session_id=session.id if session else None, task_id=task.id if task else None,
        request_id=body.request_id, scope=scope, payload={"request": request, "state": current, "change": change,
            "policy_version": policy.VERSION, "status": "pending", "entry": body.entry,
            "group_snapshot": user.experiment_group, "class_snapshot": user.class_name,
            "help_type": kind, "knowledge_mappings": mappings, "textbook_sources": list(sources),
            "practice_available": bool(templates), "practice": practice, "exercise_evidence": exercise_evidence,
            "previous_turn_id": str(last.id) if last else None, "code_sha256": hashlib.sha256(body.code.encode()).hexdigest(),
            "requested_level": current["level"], "applied_level": current["level"] if kind == "code_help" else None,
            "mastery": None, "adopted": None})
    db.add(item)
    await db.flush()
    # Keep existing teacher conversation readers usable; ledger links prevent double counting.
    question = None
    lesson = {"session_id": str(session.id) if session else None, "lesson_id": str(plan.id) if plan else None,
              "task_id": str(task.id) if task else None, "group": user.experiment_group}
    if body.entry != "preparation":
        question = ChatMessage(user_id=user.id, role="user", text=body.message,
            analysis={"commonSupportId": str(item.id), "lesson": lesson,
                      "learningEvidence": {**turn_evidence(body.code), "stage": body.stage, "focus_id": body.focus}})
        db.add(question)
        await db.flush()
        item.payload = {**item.payload, "student_message_id": str(question.id)}
    await db.commit()  # release connection and lock before provider queue/network wait
    started = perf_counter()
    teacher_context = (plan.configuration.get('tasks', {}).get(user.experiment_group) or {}) if plan else {}
    teacher_context = {key: teacher_context.get(key) for key in ('title', 'instructions', 'ai_prompt', 'blueprint_version_id')}
    if body.focus == 'basic-snake/v1':
        # This common classroom has one support protocol. Historical, group-
        # specific AI prompts must not silently reintroduce unequal scaffolding.
        teacher_context.pop('ai_prompt', None)
    context_token = llm_classroom_scope.set(user.class_name)
    try:
        if deterministic is not None:
            answer = deterministic
            model_info = {"source": "deterministic_feedback", "model": None}
        else:
            from app.api.endpoints.chat import _complete_chat_reply
            import json
            provider = get_chat_provider()
            model_info = {"source": "model", "provider": type(provider).__name__, "model": getattr(provider, "model", "unknown")}
            system_prompt = policy.prompt(body, current, kind, sources)
            item.payload = {**item.payload, 'prompt_hash': policy.digest(system_prompt), 'teacher_context': teacher_context,
                            'token_budget': policy.token_budget(current, kind)}
            answer = await _complete_chat_reply(provider, system_prompt=system_prompt,
                user_prompt=json.dumps({"history": history, "message": body.message, "code": body.code,
                                        "context": body.context, "stage": body.stage, "focus": body.focus,
                                        "teacher_task": teacher_context}, ensure_ascii=False),
                max_tokens=policy.token_budget(current, kind))
        item.payload = {**item.payload, "status": "answered", "reply": answer,
                        "model": model_info, "reply_generation_ms": round((perf_counter() - started) * 1000)}
        if question:
            assistant = ChatMessage(user_id=user.id, role="assistant", text=answer,
                analysis={"commonSupportId": str(item.id), "lesson": lesson,
                    "analysis_source": {"role": "user", "message_id": str(question.id)},
                    "learningEvidence": {"version": "learning-evidence/v1", "record_type": "ai_suggestion",
                        "response_to": str(question.id), "adopted": None, "mastery": None,
                        "reply_generation_ms": item.payload['reply_generation_ms']}})
            db.add(assistant)
            await db.flush()
            item.payload = {**item.payload, "assistant_message_id": str(assistant.id)}
        await db.commit()
    except Exception:
        failed_payload = {**item.payload, "status": "failed"}
        await db.rollback()
        item.payload = failed_payload
        await db.commit()
        raise
    finally:
        llm_classroom_scope.reset(context_token)
    return response(item)


@router.get("/practice-templates", dependencies=[Depends(verify_admin_key)])
async def practice_templates(db: AsyncSession = Depends(get_db)):
    reviews = {r.template_id: r for r in (await db.scalars(select(LearningPracticeReview))).all()}
    return {"success": True, "data": [{**t, "content_hash": policy.digest(t),
        "approved": bool(t["id"] in reviews and reviews[t["id"]].approved and reviews[t["id"]].content_hash == policy.digest(t))}
        for t in policy.PRACTICES]}


@router.post("/practice-templates/{template_id}/review", dependencies=[Depends(verify_admin_key)])
async def review(template_id: str, approved: bool, content_hash: str, db: AsyncSession = Depends(get_db),
                 user: User = Depends(get_current_user)):
    template = next((t for t in policy.PRACTICES if t["id"] == template_id), None)
    if not template or policy.digest(template) != content_hash:
        raise HTTPException(409, "题目版本已变化，请刷新后审核")
    await db.execute(text("SELECT pg_advisory_xact_lock(739204825)"))
    row = await db.scalar(select(LearningPracticeReview).where(LearningPracticeReview.template_id == template_id))
    if not row:
        row = LearningPracticeReview(template_id=template_id, content_hash=content_hash, reviewed_by=user.id, approved=approved)
        db.add(row)
    row.content_hash, row.reviewed_by, row.approved = content_hash, user.id, approved
    row.created_at = datetime.now(timezone.utc)
    await db.commit()
    return {"success": True, "data": {"approved": approved}}
