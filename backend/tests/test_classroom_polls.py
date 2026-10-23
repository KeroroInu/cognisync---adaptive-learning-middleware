"""Real PostgreSQL/JWT tests. Uses only the dedicated *_test database."""

import asyncio
import io
import json
import zipfile
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.models.sql.classroom import ClassroomResponse
from tests import test_classroom as classroom_tests
from tests.test_classroom import start, change_state, publish

poll_actors = classroom_tests.classroom_actors

pytestmark = pytest.mark.asyncio
ADMIN = "/api/admin/classroom"
STUDENT = "/api/classroom"


def poll_body():
    return {
        "request_id": str(uuid4()),
        "topic": "先试哪种方法？",
        "option_a": "列表",
        "option_b": "字典",
    }


async def test_poll_lifecycle_scope_retry_and_raw_storage(
    client, test_db, poll_actors, monkeypatch
):
    a = poll_actors
    session = await start(client, a)
    path = f"{ADMIN}/sessions/{session['id']}/polls"
    body = poll_body()
    assert (await client.post(path, headers=a["first"], json=body)).status_code == 403
    created = await client.post(path, headers=a["teacher"], json=body)
    assert created.status_code == 200, created.text
    poll = created.json()["data"]
    assert poll["kind"] == "poll"
    assert (await client.post(path, headers=a["teacher"], json=body)).json() == created.json()
    assert (
        await client.post(path, headers=a["teacher"], json={**body, "topic": "different"})
    ).status_code == 409
    assert (await client.post(path, headers=a["teacher"], json=poll_body())).status_code == 409
    state = (await client.get(f"{STUDENT}/state", headers=a["first"])).json()["data"]
    assert state["prompt"]["id"] == poll["id"]
    assert state["prompt"]["kind"] == "poll"
    assert (await client.get(f"{STUDENT}/state", headers=a["other"])).json()["data"][
        "prompt"
    ] is None
    vote = f"{STUDENT}/prompts/{poll['id']}/responses"
    assert (await client.post(vote, headers=a["other"], json={"answer": "a"})).status_code == 404
    for invalid in (None, "c", "", ["a"], 1):
        assert (
            await client.post(vote, headers=a["first"], json={"answer": invalid})
        ).status_code == 422
    replies = await asyncio.gather(
        *(client.post(vote, headers=a["first"], json={"answer": "a"}) for _ in range(3))
    )
    assert all(r.status_code == 200 for r in replies)
    assert (await client.post(vote, headers=a["first"], json={"answer": "b"})).status_code == 409
    assert (await client.get(f"{STUDENT}/state", headers=a["first"])).json()["data"][
        "prompt"
    ] is None
    assert (await client.get(path, headers=a["first"])).status_code == 403
    counts = (await client.get(path, headers=a["teacher"])).json()["data"]
    assert counts["total"] == 1 and counts["items"][0]["counts"] == {"a": 1, "b": 0}
    # Closing cannot erase votes, and retries after closure remain idempotent.
    close = f"{ADMIN}/prompts/{poll['id']}/close"
    assert (await client.post(close, headers=a["teacher"], json={})).status_code == 200
    assert (await client.post(vote, headers=a["second"], json={"answer": "b"})).status_code == 409
    assert (await client.post(vote, headers=a["first"], json={"answer": "a"})).status_code == 200
    assert (await client.get(f"{STUDENT}/state", headers=a["second"])).json()["data"][
        "prompt"
    ] is None
    async with test_db() as db:
        rows = (await db.scalars(select(ClassroomResponse))).all()
        assert len(rows) == 1
        assert rows[0].class_snapshot == "测试一班" and rows[0].group_snapshot == "pdt"
        assert rows[0].created_at is not None and rows[0].user_id == a["first_id"]
    from app.services import research_package

    async def empty_graph(ids):
        yield []

    monkeypatch.setattr(research_package, "graph_batches", empty_graph)
    exported = await client.get(
        "/api/admin/export/research-package?class_name=测试一班", headers=a["teacher"]
    )
    assert exported.status_code == 200, exported.text[:100] if exported.status_code != 200 else ""
    with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
        frozen = json.loads(archive.read("classroom_publications.jsonl"))
        saved = json.loads(archive.read("classroom_responses.jsonl"))
        assert frozen["question"]["kind"] == "poll"
        assert frozen["id"] == saved["publication_id"] == poll["id"]
        assert saved["answer"] == "a" and saved["created_at"]


async def test_poll_validation_history_and_explicit_end(client, poll_actors):
    a = poll_actors
    session = await start(client, a)
    path = f"{ADMIN}/sessions/{session['id']}/polls"
    for extra in (
        {"topic": " "},
        {"option_a": ""},
        {"option_a": "x", "option_b": " X "},
        {"option_b": "x" * 81},
        {"option_c": "third"},
    ):
        assert (
            await client.post(path, headers=a["teacher"], json={**poll_body(), **extra})
        ).status_code == 422
    for _ in range(2):
        poll = (await client.post(path, headers=a["teacher"], json=poll_body())).json()["data"]
        await client.post(f"{ADMIN}/prompts/{poll['id']}/close", headers=a["teacher"], json={})
    third = (await client.post(path, headers=a["teacher"], json=poll_body())).json()["data"]
    await client.post(f"{ADMIN}/prompts/{third['id']}/close", headers=a["teacher"], json={})
    results = (await client.get(path + "?limit=1&offset=1", headers=a["teacher"])).json()["data"]
    assert results["total"] == 3 and len(results["items"]) == 1
    assert (await client.get(path, headers=a["teacher"])).json()["data"]["items"][0]["closed_at"]
    assert (
        await client.post(
            f"{STUDENT}/prompts/{third['id']}/responses", headers=a["first"], json={"answer": "a"}
        )
    ).status_code == 409
    assert (await client.get(f"{STUDENT}/state", headers=a["first"])).json()["data"][
        "prompt"
    ] is None
    await start(client, a)
    assert (await client.post(path, headers=a["teacher"], json=poll_body())).status_code == 409
    assert (await client.get(path, headers=a["teacher"])).json()["data"]["total"] == 3


async def test_poll_does_not_replace_legacy_question(client, poll_actors):
    a = poll_actors
    s = await start(client, a)
    await publish(client, a, s["id"])
    path = f"{ADMIN}/sessions/{s['id']}/polls"
    assert (await client.post(path, headers=a["teacher"], json=poll_body())).status_code == 409
    assert (await client.get(path, headers=a["teacher"])).json()["data"] == {
        "total": 0,
        "items": [],
    }
