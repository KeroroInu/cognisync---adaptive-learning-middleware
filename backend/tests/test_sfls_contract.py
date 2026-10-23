"""Declaration checks are not evidence that a local client was unmodified."""
import io
import json
import zipfile
from types import SimpleNamespace

import pytest

from app.services.sfls_package import POLICY_VERSION, task_contract, validate_submission_contract, make_sfls_package


def fixture(phase='practice', frozen=True):
    material = SimpleNamespace(id='task', configuration={'project_id': 'course', 'phase': phase, 'policy_version': POLICY_VERSION})
    contract = task_contract(material)
    download = SimpleNamespace(id='download', user_id='student', detail={'task_contract': contract} if frozen else {})
    task = {**contract, 'platform': {'user_id': 'student', 'material_id': 'task', 'download_id': 'download'}}
    return material, download, task


def archive(task, policy=POLICY_VERSION, event=None):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as package:
        package.writestr('manifest.json', json.dumps({'sfls': {'task': task, 'policy_version': policy}}))
        if event is not None:
            package.writestr('evidence/events.jsonl', json.dumps(event) + '\n')
    return output.getvalue()


@pytest.mark.parametrize('phase', ['practice', 'pre', 'post'])
def test_published_phase_and_policy_are_matched(phase):
    material, download, task = fixture(phase)
    result = validate_submission_contract(archive(task), material, download)
    assert result['status'] == 'matched'
    assert result['scope'] == 'declared_configuration_only_not_execution_attestation'


@pytest.mark.parametrize('field', ['support', 'version', 'task_id'])
def test_missing_contract_fields_are_flagged(field):
    material, download, task = fixture()
    del task[field]
    result = validate_submission_contract(archive(task), material, download)
    assert result['status'] == 'mismatch' and field in result['differences']


def test_runtime_policy_and_nested_identity_are_checked():
    material, download, task = fixture()
    task['platform']['download_id'] = 'other-download'
    result = validate_submission_contract(archive(task, policy='other'), material, download)
    assert {'task.platform', 'runtime_policy_version'} <= set(result['differences'])


def test_missing_frozen_download_is_explicitly_unverified():
    material, download, task = fixture(frozen=False)
    assert validate_submission_contract(archive(task), material, download)['status'] == 'unverified_legacy'


def test_download_snapshot_wins_over_later_material_configuration():
    material, download, task = fixture('post')
    material.configuration = {**material.configuration, 'phase': 'practice', 'policy_version': 'future'}
    assert validate_submission_contract(archive(task), material, download)['status'] == 'matched'


def test_event_contradiction_is_reported_even_when_manifest_matches():
    material, download, task = fixture('pre')
    result = validate_submission_contract(archive(task, event={'type': 'request_started', 'phase': 'practice'}), material, download)
    assert result['status'] == 'mismatch'
    assert 'event_mode_or_policy' in result['differences']


@pytest.mark.parametrize('platform,entry', [('mac', 'Start.command'), ('windows', 'Start.cmd')])
def test_launchers_find_private_install_and_use_setup_entry(platform, entry):
    material, _, _ = fixture()
    material.title = '测试课'
    material.configuration['task'] = '制作贪吃蛇'
    package, _ = make_sfls_package(material, 'student', 'download', platform, None, None)
    with zipfile.ZipFile(io.BytesIO(package)) as archive:
        script = archive.read(entry).decode()
        assert '.sfls-runtime' in script and 'launch.mjs' in script
        assert 'sfls launch' in script
        assert 'ExecutionPolicy' not in script and 'sudo' not in script
        assert '环境' in archive.read('使用说明.md').decode()
        assert not any('node_modules' in name for name in archive.namelist())
