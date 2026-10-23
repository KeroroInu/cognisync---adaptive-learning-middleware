"""Seed current PPT-aligned tasks CLOSED; never replace publications or receipts."""
import argparse
import asyncio
import hashlib
import json
from datetime import datetime, timezone
from uuid import NAMESPACE_URL, UUID, uuid5
from urllib.parse import quote

from sqlalchemy import select

from app.api.endpoints.materials import PackageInput, package_configuration
from app.models.sql import ClassroomMaterial, ClassroomSession, User
from app.services.lesson_pack import current_course
from app.services import worksheet


async def seed_library(db, teacher_id):
    teacher = await db.get(User, teacher_id)
    if not teacher or teacher.role != 'admin':
        raise ValueError("A valid teacher administrator is required")
    version, lessons = current_course()
    templates = worksheet.catalog()
    results = []
    for class_name, condition in (('解构班', 'pdt'), ('开发班', 'ai_pbl')):
        session = await db.scalar(select(ClassroomSession).where(
            ClassroomSession.created_by == teacher_id,
            ClassroomSession.class_name == class_name,
            ClassroomSession.is_current.is_(True),
        ).order_by(ClassroomSession.created_at.desc()).limit(1).with_for_update())
        if not session:
            raise ValueError(f"Missing teacher workspace: {class_name}")
        for template in (t for t in templates if t['condition'] == condition):
            lesson_id = template['lesson_id']
            lesson = lessons[lesson_id]
            row_id = uuid5(NAMESPACE_URL, f'sfls/course-library/{version}/{session.id}/{lesson_id}')
            existing = await db.get(ClassroomMaterial, row_id)
            if existing:
                results.append({'id': str(row_id), 'status': 'existing_untouched'})
                continue
            body = PackageInput(request_id=row_id, title=f"第{lesson['lesson_number']}课 · {lesson['title']}",
                task=worksheet.task_text(template), runtime='sfls', project_id='snake-course',
                inherit_previous=lesson_id != 'C01', worksheet=template)
            config = package_configuration(body)
            slide = 'lesson.html' if lesson_id == 'C01' else class_name + '.html'
            config['library'] = {'version': version, 'lesson_id': lesson_id,
                'lesson_number': lesson['lesson_number'],
                'slides_path': '/slides/' + quote(lesson['slides_folder'] + '/' + slide, safe='/')}
            db.add(ClassroomMaterial(id=row_id, session_id=session.id, created_by=teacher_id,
                title=body.title, kind='sfls', configuration=config, content=b'', size=0,
                sha256=hashlib.sha256(b'').hexdigest(), closed_at=datetime.now(timezone.utc)))
            await db.flush()
            results.append({'id': str(row_id), 'status': 'closed_created', 'class': class_name, 'lesson': lesson_id})
    return results


async def main(teacher_id, apply):
    if not apply:
        print(json.dumps([{'lesson': t['lesson_id'], 'condition': t['condition'], 'title': t['title']} for t in worksheet.catalog()], ensure_ascii=False))
        return
    if not teacher_id:
        raise ValueError("--teacher-id required with --apply")
    from app.db.postgres import async_session_factory, engine
    try:
        async with async_session_factory() as db:
            result = await seed_library(db, UUID(teacher_id))
            await db.commit()
            print(json.dumps(result, ensure_ascii=False))
    finally:
        await engine.dispose()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--teacher-id')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    asyncio.run(main(args.teacher_id, args.apply))
