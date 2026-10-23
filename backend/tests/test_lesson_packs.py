"""Trial fixture validation, not a student-facing judge or a capacity claim."""
from collections import deque
import json
from types import SimpleNamespace
from uuid import uuid4
import io
import zipfile

from app.services.lesson_pack import freeze, scenarios, VERSION
from app.services.sfls_package import make_sfls_package


def reachable(case):
    """Search full moving/growing body states, not just static head reachability."""
    initial = (tuple(map(tuple, case['snake'])), frozenset(map(tuple, case['foods'])))
    queue, seen = deque([(initial, 0)]), {initial}
    walls = set(map(tuple, case['obstacles']))
    while queue:
        (snake, foods), steps = queue.popleft()
        if not foods:
            return steps
        if steps >= case['step_limit']:
            continue
        for dr, dc in ((0, 1), (1, 0), (0, -1), (-1, 0)):
            head = (snake[0][0]+dr, snake[0][1]+dc)
            eating = head in foods
            if not (0 <= head[0] < case['rows'] and 0 <= head[1] < case['cols']) or head in walls or head in (snake if eating else snake[:-1]):
                continue
            following = ((head,) + (snake if eating else snake[:-1]), foods - {head})
            if following not in seen:
                seen.add(following)
                queue.append((following, steps+1))
    return None


def test_maps_have_valid_states_and_full_body_reachability():
    for lesson in range(3, 11):
        for case in scenarios(f'L{lesson:02d}'):
            all_cells = case['snake']+case['foods']+case['obstacles']
            assert len(set(map(tuple, all_cells))) == len(all_cells)
            assert all(0 <= r < case['rows'] and 0 <= c < case['cols'] for r, c in all_cells)
            if lesson >= 6:
                steps = reachable(case)
                assert (steps is None) == (case['id'] == 'enclosed'), (lesson, case['id'], steps)


def test_frozen_pack_files_and_no_solution():
    for lesson in range(3, 11):
        bundle = freeze(f'L{lesson:02d}')
        material = SimpleNamespace(id=uuid4(), title='试用', configuration={
            'phase': 'practice', 'project_id': 'trial', 'task': '当前目标', 'lesson_pack': bundle})
        for platform in ('mac', 'windows'):
            data, provenance = make_sfls_package(material, uuid4(), uuid4(), platform, None, None)
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                assert provenance['lesson_pack_version'] == VERSION
                assert json.loads(archive.read('materials/environment.json'))['packages'] == ['pygame==2.6.1']
                assert archive.read('project/main.py').startswith(b'#')
                compile(archive.read('project/board.py'), 'board.py', 'exec')
                assert 'teacher_review' not in '\n'.join(archive.namelist())
                assert len(json.loads(archive.read('materials/samples.json'))['cases']) > 0
                assert ('Start.command' if platform == 'mac' else 'Start.cmd') in archive.namelist()
        material.configuration['phase'] = 'post'
        data, _ = make_sfls_package(material, uuid4(), uuid4(), 'mac', None, None)
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            assert 'materials/samples.json' not in archive.namelist()
            assert 'project/board.py' not in archive.namelist()
