import ast

import pytest

from app.services.beginner_snake_templates import SOLUTIONS, GUIDED, BALANCED
from app.services.textbook_library import retrieve_textbook, textbook_prompt


def test_retrieval_is_bounded_traceable_and_does_not_mutate_cache():
    sources = retrieve_textbook("movement", "列表 坐标 for if")
    assert 1 <= len(sources) <= 3
    assert "lists" in {row["id"] for row in sources}
    assert all(row["pages"] and row["pdfPages"] and row["version"] for row in sources)
    assert all(len(row["sourceHash"]) == len(row["corpusHash"]) == 64 for row in sources)
    sources[0]["summary"] = "changed by caller"
    assert retrieve_textbook("movement", "列表 坐标 for if")[0]["summary"] != "changed by caller"


def test_no_hit_does_not_claim_textbook_grounding():
    assert retrieve_textbook(query="海底探险") == ()
    assert "不得声称" in textbook_prompt(())
    assert retrieve_textbook("movement", stage="observe") == ()


@pytest.mark.parametrize("module", SOLUTIONS)
def test_short_gap_templates_compile_without_advanced_comprehensions(module):
    for templates, gaps in ((GUIDED, 1), (BALANCED, 2), (SOLUTIONS, 0)):
        code = templates[module]
        parsed = ast.parse(code)
        assert code.count("TODO") == gaps
        assert not any(isinstance(node, (ast.ListComp, ast.DictComp, ast.SetComp, ast.Lambda)) for node in ast.walk(parsed))
        assert all(len(line.strip()) <= 42 for line in code.splitlines() if line.strip().startswith("#"))


def test_complete_functions_compose_and_only_eating_changes_score():
    ns = {}
    for code in SOLUTIONS.values():
        exec(code, ns)
    snake, direction, score = ns["create_initial_state"]()
    assert len(snake) == 3 and direction == "right" and score == 0
    state = {"snake": snake, "direction": direction, "score": score, "food": (11, 11), "game_over": False}
    ns["step_game"](state, None)
    assert state["score"] == 0 and len(state["snake"]) == 3
    x, y = state["snake"][0]
    state["food"] = (x + 1, y)
    ns["step_game"](state, None)
    assert state["score"] == 10 and len(state["snake"]) == 4
    assert state["food"] not in state["snake"]


def test_loop_preserves_legacy_two_value_food_result():
    ns = {}
    for code in SOLUTIONS.values():
        exec(code, ns)
    current = ns["apply_food_effect"]
    ns["apply_food_effect"] = lambda *args: current(*args)[:2]
    state = {"snake": [(3, 3), (2, 3)], "direction": "right", "score": 0, "food": (4, 3), "game_over": False}
    ns["step_game"](state, None)
    assert state["score"] == 10 and state["food"] not in state["snake"]
