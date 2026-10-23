"""Synthetic ASGI and SQL-contract coverage; no live DB, ZIP reads or model calls."""
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
import pytest
from sqlalchemy.dialects import postgresql

from app.api.endpoints.admin import conversation_browser as api
from app.api.endpoints.admin.auth import _create_admin_token
from app.api.endpoints.auth import create_access_token
from app.db.postgres import get_db
from app.models.sql.message import MessageRole
from app.services import conversation_browser as service


NOW = datetime(2026, 10, 22, 8, 0, tzinfo=timezone.utc)


def sql(statement):
    return str(statement.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))


class Rows:
    def __init__(self, rows):
        self.rows = rows

    def mappings(self):
        return self

    def all(self):
        return self.rows


@pytest.fixture
async def browser_http():
    admin = SimpleNamespace(id=uuid4(), role="admin", is_active=True, auth_version=0)
    student, stranger, material, receipt = uuid4(), uuid4(), uuid4(), uuid4()
    identity = {"user_id": student, "user_name": "测试同学", "student_id": "G20260001",
                "school_class": "高一（1）班", "class_name": "解构班"}
    artifact = {**identity, "receipt_id": receipt, "material_id": material,
                "created_at": NOW, "size": 1234, "sha256": "a" * 64,
                "detail": {"filename": "测试作品.zip", "task_validation": {"status": "matched"}},
                "task_title": "基础贪吃蛇", "task_kind": "sfls", "version_count": 3}
    web = {**identity, "message_count": 2, "created_at": NOW, "updated_at": NOW}
    message = {"id": uuid4(), "role": MessageRole.USER,
               "text": "我准备先检查蛇身移动。", "timestamp": NOW}
    statements = []

    async def scalar(statement):
        compiled = sql(statement)
        statements.append(compiled)
        if "count(" in compiled:
            return 2 if "chat_messages" in compiled and "GROUP BY" not in compiled else 1
        return None if str(stranger) in compiled else student

    async def execute(statement):
        compiled = sql(statement)
        statements.append(compiled)
        assert "classroom_material_receipts.content" not in compiled
        assert "chat_messages.analysis" not in compiled
        if "artifact_versions" in compiled:
            return Rows([artifact])
        if "GROUP BY" in compiled:
            return Rows([web])
        return Rows([message])

    db = SimpleNamespace(scalar=AsyncMock(side_effect=scalar), execute=AsyncMock(side_effect=execute),
                         get=AsyncMock(return_value=admin))
    app = FastAPI()
    app.include_router(api.router, prefix="/api/admin")
    app.dependency_overrides[get_db] = lambda: db
    headers = {"Authorization": "Bearer " + _create_admin_token(str(admin.id))}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield SimpleNamespace(client=client, db=db, admin=admin, student=student, stranger=stranger,
                              receipt=receipt, artifact=artifact, web=web, message=message,
                              statements=statements, headers=headers)


def test_artifact_latest_ranks_by_student_and_task_without_loading_zip():
    compiled = sql(service.artifact_rows(query="蛇", class_name="解构班"))
    assert "PARTITION BY classroom_material_receipts.user_id, classroom_material_receipts.material_id" in compiled
    assert "ORDER BY classroom_material_receipts.created_at DESC, classroom_material_receipts.id DESC" in compiled
    assert "artifact_versions.version_rank = 1" in compiled
    assert "classroom_sessions.class_name = '解构班'" in compiled
    assert "users.class_name =" not in compiled
    assert "classroom_materials.title ILIKE" in compiled
    assert "classroom_material_receipts.kind = 'submission'" in compiled
    assert "classroom_material_receipts.content" not in compiled
    assert "chat_messages" not in compiled


def test_all_versions_preserves_count_but_removes_rank_filter():
    compiled = sql(service.artifact_rows(versions="all"))
    assert "version_count" in compiled and "PARTITION BY" in compiled
    assert "artifact_versions.version_rank = 1" not in compiled


def test_search_characters_are_literal_and_not_sql_wildcards():
    compiled = sql(service.artifact_rows(query="100%_"))
    assert "100/%%/_" in compiled
    assert "ESCAPE '/'" in compiled


def test_web_rows_are_student_metadata_not_legacy_sessions():
    compiled = sql(service.web_rows(query="测试", class_name="开发班"))
    assert "GROUP BY users.id" in compiled
    assert "min(chat_messages.timestamp)" in compiled and "max(chat_messages.timestamp)" in compiled
    assert "users.class_name = '开发班'" in compiled
    assert "chat_sessions" not in compiled
    assert "chat_messages.text" not in compiled and "analysis" not in compiled
    assert "password" not in compiled


@pytest.mark.asyncio
async def test_artifact_endpoint_is_metadata_only_with_stable_pagination(browser_http):
    t = browser_http
    response = await t.client.get("/api/admin/conversations/artifacts?page=2&page_size=10", headers=t.headers)
    assert response.status_code == 200 and response.headers["cache-control"] == "no-store"
    body = response.json()["data"]
    assert body["total"] == 1 and body["page"] == 2 and body["page_size"] == 10
    row = body["items"][0]
    assert row["receipt_id"] == str(t.receipt) and row["user_id"] == str(t.student)
    assert row["version_count"] == 3 and row["class_name"] == "解构班"
    assert row["download_url"].endswith(f"/receipts/{t.receipt}/file")
    assert "detail" not in row and "version_rank" not in row
    assert len(t.statements) == 2
    assert "ORDER BY artifact_versions.created_at DESC, artifact_versions.receipt_id DESC" in t.statements[-1]
    assert "LIMIT 10 OFFSET 10" in t.statements[-1]
    assert all("classroom_material_receipts.content" not in value for value in t.statements)


@pytest.mark.asyncio
async def test_filters_and_all_versions_reach_both_count_and_page(browser_http):
    t = browser_http
    response = await t.client.get("/api/admin/conversations/artifacts", params={
        "query": " 贪吃蛇 ", "class_name": " 解构班 ", "versions": "all"}, headers=t.headers)
    assert response.status_code == 200
    assert len(t.statements) == 2
    for compiled in t.statements:
        assert "classroom_sessions.class_name = '解构班'" in compiled
        assert "贪吃蛇" in compiled
        assert "artifact_versions.version_rank = 1" not in compiled


@pytest.mark.asyncio
async def test_web_endpoint_groups_students_and_omits_message_body(browser_http):
    t = browser_http
    response = await t.client.get("/api/admin/conversations/web?page=2&page_size=10", headers=t.headers)
    assert response.status_code == 200 and response.headers["cache-control"] == "no-store"
    row = response.json()["data"]["items"][0]
    assert row["user_id"] == str(t.student) and row["message_count"] == 2
    assert "text" not in row and "analysis" not in row and "id" not in row
    assert len(t.statements) == 2
    assert "ORDER BY max(chat_messages.timestamp) DESC, users.id DESC" in t.statements[-1]
    assert "LIMIT 10 OFFSET 10" in t.statements[-1]


@pytest.mark.asyncio
async def test_web_message_page_is_ascending_bound_to_student_and_masked(browser_http):
    t = browser_http
    secret = "sk-" + "syntheticneverissuedcredential" * 2
    t.message["text"] = 'api_key="' + secret + '"\n先检查移动。'
    response = await t.client.get(f"/api/admin/conversations/web/{t.student}/messages?limit=10&offset=20", headers=t.headers)
    assert response.status_code == 200 and response.headers["cache-control"] == "no-store"
    body = response.json()["data"]
    assert body["total"] == 2 and body["limit"] == 10 and body["offset"] == 20
    assert body["messages"][0]["role"] == "user"
    assert secret not in response.text and "REDACTED" in body["messages"][0]["text"]
    assert set(body["messages"][0]) == {"id", "role", "text", "timestamp"}
    assert len(t.statements) == 3
    assert all(str(t.student) in value for value in t.statements)
    assert "ORDER BY chat_messages.timestamp ASC, chat_messages.id ASC" in t.statements[-1]
    assert "LIMIT 10 OFFSET 20" in t.statements[-1]


@pytest.mark.asyncio
async def test_unknown_or_nonstudent_message_subject_is_not_read(browser_http):
    t = browser_http
    response = await t.client.get(f"/api/admin/conversations/web/{t.stranger}/messages", headers=t.headers)
    assert response.status_code == 404
    assert len(t.statements) == 1 and not t.db.execute.called
    assert "users.role IN" in t.statements[0]


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["artifacts", "web", "web/00000000-0000-4000-8000-000000000000/messages"])
async def test_anonymous_and_students_cannot_read_conversation_browser(browser_http, path):
    t = browser_http
    url = "/api/admin/conversations/" + path
    assert (await t.client.get(url)).status_code == 401
    headers = {"Authorization": "Bearer " + create_access_token(str(t.student))}
    assert (await t.client.get(url, headers=headers)).status_code == 403
    assert not t.statements


@pytest.mark.asyncio
@pytest.mark.parametrize("state", ["disabled", "demoted", "revoked"])
async def test_admin_is_revalidated_for_new_browser_endpoints(browser_http, state):
    t = browser_http
    if state == "disabled":
        t.admin.is_active = False
    elif state == "demoted":
        t.admin.role = "learner"
    else:
        t.admin.auth_version = 1
    for path in ("artifacts", "web", f"web/{t.student}/messages"):
        response = await t.client.get("/api/admin/conversations/" + path, headers=t.headers)
        assert response.status_code in (401, 403)
    assert not t.statements


@pytest.mark.asyncio
@pytest.mark.parametrize("path", [
    "artifacts?page=0", "artifacts?page_size=51", "artifacts?versions=unknown",
    "web?page=0", "web?page_size=0", "web?page_size=51",
    "web/not-a-uuid/messages", "web/00000000-0000-4000-8000-000000000000/messages?limit=101",
    "web/00000000-0000-4000-8000-000000000000/messages?offset=-1",
])
async def test_invalid_query_parameters_are_rejected_before_evidence_query(browser_http, path):
    t = browser_http
    response = await t.client.get("/api/admin/conversations/" + path, headers=t.headers)
    assert response.status_code == 422 and not t.statements


@pytest.mark.asyncio
async def test_empty_sources_are_valid_not_an_error(browser_http):
    t = browser_http
    t.db.scalar.side_effect = None
    t.db.scalar.return_value = 0
    t.db.execute.side_effect = None
    t.db.execute.return_value = Rows([])
    for path in ("artifacts", "web"):
        response = await t.client.get("/api/admin/conversations/" + path, headers=t.headers)
        assert response.status_code == 200
        assert response.json()["data"] == {"items": [], "total": 0, "page": 1, "page_size": 30}
