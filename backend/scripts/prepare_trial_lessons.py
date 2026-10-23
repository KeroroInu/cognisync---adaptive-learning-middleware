"""Explicit local-only publication, normal service validation and deterministic IDs.

Run from backend: python scripts/prepare_trial_lessons.py [--lesson C01]
To publish ONE stage to both classes: --lesson C01 --apply.
Default preview does not connect to a database. Applying requires an existing
admin, reuses/creates stable class workspaces, and preserves all old evidence.
Publishing activates this stage and closes other active tasks through the normal
service. The two class publications are individually committed, not atomic.
"""
import argparse
import asyncio
import json
import sys
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select
from app.core.config import settings
from app.db.postgres import async_session_factory, engine
from app.models.sql import User
from app.services.classroom_service import current_session
from app.services.worksheet import catalog, task_text
from app.services.lesson_pack import current_course
from app.api.endpoints.materials import PackageInput, publish_package
from app.api.endpoints.classroom import WorkspaceInput, ensure_workspace

LESSONS = tuple(current_course()[1])
CLASSES = (('解构班', 'pdt'), ('开发班', 'ai_pbl'))
# The new course starts afresh; historic trial submissions keep their old project ID.
PROJECT_ID = 'snake-course'


def planned_templates(lesson=None):
    if lesson is not None and lesson not in LESSONS:
        raise ValueError('阶段必须是 C01–C05')
    return [(class_name, template) for class_name, condition in CLASSES
            for template in catalog() if template['condition'] == condition
            and (lesson is None or template['lesson_id'] == lesson)]


def package_input(session_id, template):
    lesson = template['lesson_id']
    return PackageInput(request_id=uuid5(NAMESPACE_URL, f'cognisync:{template["template_version"]}:{session_id}:{lesson}'),
        title=f'第{int(lesson[1:])}阶段 · {template["title"]}', task=task_text(template),
        runtime='sfls', phase='practice', project_id=PROJECT_ID,
        curriculum=current_course()[1][lesson]['curriculum'], inherit_previous=lesson != 'C01', worksheet=template)


async def main(apply=False, lesson=None):
    if apply and lesson is None:
        raise ValueError('--apply 必须同时指定 --lesson C01…C05；禁止一次发布全部阶段')
    targets = planned_templates(lesson)
    if apply and len(targets) != 2:
        raise RuntimeError('所选阶段必须恰好包含两班各一份任务；请检查目录')
    print(json.dumps({'apply': apply, 'count': len(targets),
        'tasks': [{'class': cls, 'lesson': template['lesson_id'], 'title': template['title']}
                  for cls, template in targets]}, ensure_ascii=False, indent=2))
    if not apply:
        return
    if settings.APP_ENV == 'production' or settings.POSTGRES_HOST not in ('localhost', '127.0.0.1') or settings.DATABASE_URL:
        raise RuntimeError('仅允许明确的本机离散数据库配置；不操作远程库')
    try:
        async with async_session_factory() as db:
            teacher = await db.scalar(select(User).where(User.student_id == 'admin', User.role == 'admin', User.is_active.is_(True)))
            if not teacher:
                raise RuntimeError('没有现有 admin 教师账号')
            # Validate both owners before any publication or container creation.
            for class_name, _ in CLASSES:
                current = await current_session(db, class_name)
                if current and current.created_by != teacher.id:
                    raise RuntimeError(f'{class_name}的工作区属于其他教师；不替换、不接管')
            for class_name, template in targets:
                await ensure_workspace(WorkspaceInput(class_name=class_name), db, teacher)
                session = await current_session(db, class_name)
                if not session or session.created_by != teacher.id:
                    raise RuntimeError(f'{class_name}工作区已变化，请人工核对')
                body = package_input(session.id, template)
                await publish_package(session.id, body, db, teacher)
                print(f'{class_name} {lesson} 已处理：{body.request_id}')
            print('仅处理两班所选阶段；已有冻结任务、学生作品和账号不覆盖。重复请求不重新开放已收起任务。')
    finally:
        await engine.dispose()


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--lesson', choices=LESSONS)
    args = parser.parse_args(argv)
    if args.apply and not args.lesson:
        parser.error('--apply 必须指定 --lesson，例如 --lesson C01 --apply')
    return args


if __name__ == '__main__':
    args = parse_args()
    asyncio.run(main(args.apply, args.lesson))
