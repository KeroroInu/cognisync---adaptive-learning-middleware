"""Narrow download capabilities, deliberately separate from web-login JWTs.

Only the download archive receives the raw token. Receipts retain a digest;
neither that internal authorization metadata nor the credential is research data.
"""
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import re
import secrets

from fastapi import HTTPException

from app.models.sql import MaterialReceipt, User

SCHEMA = 'sfls-task-access/1'
TOKEN_PATTERN = re.compile(r'^[A-Za-z0-9_-]{43}$')
ACCESS_DAYS = 7


def public_receipt_detail(detail):
    """Remove authorization metadata without changing any research evidence."""
    return {key: value for key, value in (detail or {}).items() if key != 'task_access'}


def issue_task_access(user, material_id, download_id, server):
    if not server:
        raise ValueError('A configured public origin is required for task credentials')
    token = secrets.token_urlsafe(32)
    expires_at = (datetime.now(timezone.utc) + timedelta(days=ACCESS_DAYS)).isoformat()
    credential = {'schema': SCHEMA, 'server': server, 'user_id': str(user.id),
                  'material_id': str(material_id), 'download_id': str(download_id),
                  'token': token, 'expires_at': expires_at}
    record = {'schema': SCHEMA, 'sha256': hashlib.sha256(token.encode()).hexdigest(),
              'expires_at': expires_at, 'auth_version': user.auth_version}
    return credential, record


async def resolve_task_access(db, material_id, download_id, token):
    """Authenticate only this download; callers still check current task visibility.

    This token is never accepted by get_current_user or any Bearer endpoint.
    A common error avoids revealing which download/owner a guessed token names.
    """
    def denied():
        return HTTPException(401, '任务凭据无效或已过期，请在平台重新下载本人的任务包；原作品不用删除。')

    if not isinstance(token, str) or not TOKEN_PATTERN.fullmatch(token):
        raise denied()
    download = await db.get(MaterialReceipt, download_id)
    if not download or download.kind != 'download' or download.material_id != material_id:
        raise denied()
    record = (download.detail or {}).get('task_access')
    if not isinstance(record, dict) or record.get('schema') != SCHEMA or record.get('revoked_at'):
        raise denied()
    digest = record.get('sha256')
    if (not isinstance(digest, str) or not re.fullmatch(r'[0-9a-f]{64}', digest)
            or not hmac.compare_digest(hashlib.sha256(token.encode()).hexdigest(), digest)):
        raise denied()
    try:
        expires = datetime.fromisoformat(record['expires_at'])
        if expires.tzinfo is None or expires <= datetime.now(timezone.utc):
            raise ValueError('expired')
    except (KeyError, TypeError, ValueError, OverflowError):
        raise denied() from None
    user = await db.get(User, download.user_id)
    if (not user or not user.is_active or user.role not in ('learner', 'student', 'user')
            or record.get('auth_version') != user.auth_version):
        raise denied()
    return user, download, record['expires_at']
