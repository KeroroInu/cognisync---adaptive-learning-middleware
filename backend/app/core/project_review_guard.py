"""Fail closed for student learning APIs during review, including in-flight responses.

Only raw auth/status/review/assessment remain accessible. No model or history API
is whitelisted. Review opening cannot retract responses already sent over the wire.
"""
from datetime import datetime, timezone
from fastapi import HTTPException
from starlette.responses import JSONResponse
from sqlalchemy import select
from app.db.postgres import get_db
from app.api.endpoints.auth import get_current_user
from app.models.sql.user import User
from app.services.project_review import held, hold_error, review_dispatch_check


class ProjectReviewGuard:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        path = scope.get('path', '')
        if scope['type'] != 'http' or not path.startswith('/api/') or path.startswith(('/api/admin/', '/api/auth/', '/api/project-review/', '/api/assessments/')) or path in ('/api/classroom/state', '/api/project-review', '/api/assessments'):
            return await self.app(scope, receive, send)
        headers = dict(scope.get('headers', []))
        authorization = headers.get(b'authorization', b'').decode()
        if not authorization:
            return await self.app(scope, receive, send)
        started = datetime.now(timezone.utc)

        async def blocked(since=None):
            async def check(db):
                try:
                    user = await get_current_user(authorization=authorization, db=db)
                except HTTPException:
                    return False  # The endpoint retains normal authentication handling.
                # held() issues a scalar SELECT (not an ORM identity-map lookup).
                # Default READ COMMITTED sees review holds committed since the
                # handler began, including when the request already has a tx.
                # Scalar role query also avoids a stale User identity-map entry
                # when authorization changes while a long request is running.
                role = await db.scalar(select(User.role).where(User.id == user.id))
                return role != 'admin' and await held(db, user.id, since)

            active_db = scope.get('state', {}).get('review_guard_session')
            # Error responses may be sent after dependency cleanup; never reopen
            # a closed request session here (its owner can no longer close it).
            # A committed session holds no pool slot, so the short check below
            # is safe in that case too.
            if active_db is not None and active_db.in_transaction():
                return await check(active_db)
            # Use the application's dependency override in isolated integration tests.
            factory = scope['app'].dependency_overrides.get(get_db, get_db)
            generator = factory()
            db = await anext(generator)
            try:
                return await check(db)
            finally:
                await generator.aclose()

        async def deny():
            error = hold_error()
            await JSONResponse({'detail': error.detail}, status_code=423, headers={'Cache-Control': 'no-store'})(scope, receive, send)

        if await blocked():
            return await deny()
        suppressed = False

        async def guarded_send(message):
            nonlocal suppressed
            if message['type'] == 'http.response.start' and await blocked(started):
                suppressed = True
                await deny()
            elif not suppressed:
                await send(message)
        async def dispatch_check():
            if await blocked(started):
                raise hold_error()
        token = review_dispatch_check.set(dispatch_check)
        try:
            await self.app(scope, receive, guarded_send)
        finally:
            review_dispatch_check.reset(token)
            scope.get('state', {}).pop('review_guard_session', None)
