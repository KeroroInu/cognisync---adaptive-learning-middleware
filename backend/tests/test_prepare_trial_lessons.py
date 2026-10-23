"""Local publication CLI safety, using fake services only; never publishes data."""
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from scripts import prepare_trial_lessons as script


@pytest.mark.parametrize('args', [['--apply'], ['--apply', '--lesson', 'C00'], ['--lesson', 'C09'], ['--lesson', 'C06']])
def test_cli_rejects_unbounded_or_invalid_apply(args):
    with pytest.raises(SystemExit):
        script.parse_args(args)


@pytest.mark.asyncio
async def test_default_preview_lists_every_stage_without_database(monkeypatch, capsys):
    monkeypatch.setattr(script, 'async_session_factory', lambda: pytest.fail('Preview must not open a database'))
    monkeypatch.setattr(script, 'ensure_workspace', AsyncMock(side_effect=AssertionError('No writes')))
    await script.main()
    output = json.loads(capsys.readouterr().out)
    assert output['apply'] is False and output['count'] == 10
    assert {row['lesson'] for row in output['tasks']} == set(script.LESSONS)
    await script.main(lesson='C01')
    assert json.loads(capsys.readouterr().out)['count'] == 2


@pytest.mark.asyncio
@pytest.mark.parametrize('config', [
    {'APP_ENV': 'production', 'POSTGRES_HOST': 'localhost', 'DATABASE_URL': ''},
    {'APP_ENV': 'development', 'POSTGRES_HOST': 'remote.example', 'DATABASE_URL': ''},
    {'APP_ENV': 'development', 'POSTGRES_HOST': 'localhost', 'DATABASE_URL': 'postgresql://remote/db'},
])
async def test_apply_rejects_remote_or_production_before_io(monkeypatch, config):
    monkeypatch.setattr(script, 'settings', SimpleNamespace(**config))
    monkeypatch.setattr(script, 'async_session_factory', lambda: pytest.fail('No database contact permitted'))
    with pytest.raises(RuntimeError, match='本机'):
        await script.main(True, 'C01')


@pytest.mark.asyncio
async def test_apply_uses_stable_workspaces_and_only_two_current_briefs(monkeypatch):
    teacher = SimpleNamespace(id=uuid4())
    workspaces = {name: SimpleNamespace(id=uuid4(), created_by=teacher.id, state='closed') for name, _ in script.CLASSES}
    class FakeDatabase:
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def scalar(self, stmt): return teacher
    db = FakeDatabase()
    monkeypatch.setattr(script, 'settings', SimpleNamespace(APP_ENV='development', POSTGRES_HOST='localhost', DATABASE_URL=''))
    monkeypatch.setattr(script, 'async_session_factory', lambda: db)
    monkeypatch.setattr(script, 'current_session', AsyncMock(side_effect=lambda db, name: workspaces[name]))
    ensure, publish, dispose = AsyncMock(), AsyncMock(), AsyncMock()
    monkeypatch.setattr(script, 'ensure_workspace', ensure)
    monkeypatch.setattr(script, 'publish_package', publish)
    monkeypatch.setattr(script, 'engine', SimpleNamespace(dispose=dispose))
    await script.main(True, 'C02')
    assert ensure.await_count == publish.await_count == 2
    for call, (name, template) in zip(publish.await_args_list, script.planned_templates('C02')):
        sid, body, passed_db, actor = call.args
        assert sid == workspaces[name].id and passed_db is db and actor is teacher
        assert body.worksheet.lesson_id == 'C02' and body.task == script.task_text(template).strip()
        assert body.inherit_previous and body.project_id == script.PROJECT_ID
        assert body.request_id == script.package_input(sid, template).request_id
    assert not script.package_input(uuid4(), script.planned_templates('C01')[0][1]).inherit_previous
    dispose.assert_awaited_once()
    # Ownership preflight must fail before changing either class.
    workspaces['开发班'].created_by = uuid4()
    publish.reset_mock(); ensure.reset_mock()
    with pytest.raises(RuntimeError, match='其他教师'):
        await script.main(True, 'C02')
    publish.assert_not_awaited(); ensure.assert_not_awaited()
