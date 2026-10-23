from types import SimpleNamespace

from app.services.learning_evidence import turn_evidence, evidence_support_prompt
from app.services.process_evidence import process_index


def test_snapshot_has_provenance_not_ability_score():
    missing = turn_evidence(None)
    empty = turn_evidence('')
    assert missing['code_sha256'] is None and empty['code_sha256'] is not None
    context = SimpleNamespace(stage='model', currentModule='my-function')
    item = turn_evidence('print(7)', context)
    assert item['stage'] == 'model' and item['focus_id'] == 'my-function'
    assert item['mastery'] is None and item['independent_authorship'] is None
    assert item['code_sha256'] == turn_evidence('print(7)')['code_sha256']
    assert item['code_sha256'] != turn_evidence('print(8)')['code_sha256']
    assert '缺失记录是未知' in evidence_support_prompt()


def test_process_index_does_not_guess_historical_links():
    row = {'id': 'm2', 'user_id': 'u1', 'session_id': 'CHAT_SESSION_NOT_LESSON', 'role': 'assistant',
           'analysis': {'lesson': {'session_id': 'lesson1'}, 'learningEvidence': {'response_to': 'm1', 'reply_generation_ms': 32}}}
    item = process_index('chat_messages', row)
    assert item['session_id'] == 'lesson1' and item['response_to'] == 'm1'
    assert item['mastery'] is None and item['adopted'] is None
    historical = process_index('chat_messages', {**row, 'analysis': None})
    assert historical['session_id'] is None and historical['response_to'] is None
    assert historical['reply_generation_ms'] is None
    assert process_index('users', row) is None
