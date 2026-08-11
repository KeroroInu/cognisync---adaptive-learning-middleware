"""数据库启动迁移的失败策略测试。"""

import pytest

from app.db import postgres


class _FailingConnection:
    async def execute(self, _statement):
        raise PermissionError("ddl denied")


class _FailingTransaction:
    async def __aenter__(self):
        return _FailingConnection()

    async def __aexit__(self, exc_type, exc, traceback):
        return False


class _FailingEngine:
    def begin(self):
        return _FailingTransaction()


@pytest.mark.asyncio
async def test_migration_failure_stops_startup_by_default(monkeypatch):
    monkeypatch.setattr(postgres, "engine", _FailingEngine())

    with pytest.raises(RuntimeError, match="Critical migration step failed"):
        await postgres._run_migration_sql("ALTER TABLE demo ADD COLUMN value TEXT", "demo")


@pytest.mark.asyncio
async def test_explicit_noncritical_migration_can_be_skipped(monkeypatch):
    monkeypatch.setattr(postgres, "engine", _FailingEngine())

    result = await postgres._run_migration_sql(
        "CREATE INDEX demo_idx ON demo (value)",
        "optional demo index",
        critical=False,
    )

    assert result is False
