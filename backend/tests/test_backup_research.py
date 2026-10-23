"""Backup safety tests use a fake Compose runner: no actual database commands."""
import importlib.util
import json
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location('backup_research', Path(__file__).resolve().parents[2] / 'scripts/backup-research.py')
backup_tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup_tool)


@pytest.mark.parametrize('target,confirmed', [('cognisync_db', True), ('evil;_restore_test', True), ('example_restore_test', False)])
def test_restore_refuses_unsafe_targets_before_any_io(tmp_path, monkeypatch, target, confirmed):
    monkeypatch.setattr(backup_tool, 'compose', lambda *a, **k: pytest.fail('Must not contact database'))
    with pytest.raises(ValueError):
        backup_tool.restore(tmp_path, target, confirmed)


def test_backup_hash_and_rehearsal_use_only_new_database(tmp_path, monkeypatch):
    calls = []
    def fake_compose(script, **kwargs):
        calls.append((script, kwargs))
        if 'pg_dump ' in script:
            kwargs['stdout'].write(b'PGDMP-fixture')
    monkeypatch.setattr(backup_tool, 'compose', fake_compose)
    backup_tool.backup(tmp_path)
    folder = next(tmp_path.iterdir())
    assert folder.stat().st_mode & 0o777 == 0o700
    manifest = json.loads((folder / 'manifest.json').read_text())
    assert manifest['sha256'] == backup_tool.checksum(folder / 'database.dump')
    backup_tool.restore(folder, 'new_fixture_restore_test', True)
    assert any('createdb ' in cmd for cmd, _ in calls)
    assert not any('DROP' in cmd or '--clean' in cmd for cmd, _ in calls)
    (folder / 'database.dump').write_bytes(b'corrupted')
    count = len(calls)
    with pytest.raises(ValueError, match='checksum'):
        backup_tool.restore(folder, 'another_restore_test', True)
    assert len(calls) == count


def test_backup_refuses_source_tree(monkeypatch):
    monkeypatch.setattr(backup_tool, 'compose', lambda *a, **k: pytest.fail('Must not contact database'))
    with pytest.raises(ValueError):
        backup_tool.backup(backup_tool.ROOT)
