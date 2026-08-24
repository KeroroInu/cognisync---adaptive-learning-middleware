"""七函数覆盖检查的**离线**单元测试。

只覆盖纯逻辑：对照蓝图节点统计覆盖数量、每张卡是否命中，以及提醒问题的
生成规则。不需要数据库——端点本身的鉴权、任务可见性与蓝图冻结语义
由 ``tests/test_research_task_guard_api.py`` 覆盖。

这里最重要的一条断言是**不泄漏**：生成的提醒问题里不能出现任何教师蓝图
文本（契约名称、同义表达、输入输出、场景描述）。覆盖检查的目的是把学生
推回自己的观察，而不是换个方式把标准答案发下去。
"""
import pytest

from app.api.endpoints.research import (
    FunctionCoverageCardRequest,
    FunctionCoverageRequest,
    _coverage_questions,
    _coverage_result,
)
from app.schemas.project_blueprint import BlueprintContract, BlueprintNode


def make_nodes() -> list[BlueprintNode]:
    """两个必做节点 + 一个可选节点，便于验证 required 才计入分母。"""
    return [
        BlueprintNode(
            id="initial-state",
            titleZh="建立并重置游戏状态",
            scenarioZh="开始游戏或重新开始时，为后续功能提供一致的初始状态。",
            required=True,
            synonyms=["初始化与重置"],
            contract=BlueprintContract(inputs=["棋盘大小"], outputs=["初始得分"]),
        ),
        BlueprintNode(
            id="collision",
            titleZh="判断边界和自身碰撞",
            scenarioZh="位置更新后检查新蛇头是否越界。",
            required=True,
            synonyms=["碰撞检测"],
        ),
        BlueprintNode(
            id="bonus",
            titleZh="加速道具",
            required=False,
            synonyms=["道具"],
        ),
    ]


def card(card_id: str, responsibility: str = "", implementation: str = "", observation: str = ""):
    return FunctionCoverageCardRequest(
        card_id=card_id,
        responsibility=responsibility,
        implementation=implementation,
        observation_text=observation,
    )


# ── 覆盖统计 ──────────────────────────────────────────────────────────────────

def test_required_total_counts_only_required_nodes():
    required_total, _, _ = _coverage_result(FunctionCoverageRequest(cards=[]), make_nodes())
    assert required_total == 2


def test_no_cards_means_nothing_covered():
    required_total, covered, results = _coverage_result(
        FunctionCoverageRequest(cards=[]), make_nodes()
    )
    assert (required_total, covered, results) == (2, 0, [])


def test_matching_card_covers_its_node():
    _, covered, results = _coverage_result(
        FunctionCoverageRequest(cards=[card("c1", "初始化与重置")]), make_nodes()
    )
    assert covered == 1
    assert [(item.card_id, item.matched) for item in results] == [("c1", True)]


def test_implementation_text_participates_in_matching():
    """一句实现描述也应参与匹配，学生可能把关键词写在描述而不是名称里。"""
    _, covered, results = _coverage_result(
        FunctionCoverageRequest(
            cards=[card("c1", "开局准备", implementation="先做初始化与重置；最后返回结果")]
        ),
        make_nodes(),
    )
    assert covered == 1
    assert results[0].matched is True


def test_unmatched_card_is_reported_without_covering_anything():
    _, covered, results = _coverage_result(
        FunctionCoverageRequest(cards=[card("c1", "让画面变好看")]), make_nodes()
    )
    assert covered == 0
    assert results[0].matched is False


def test_optional_node_match_does_not_inflate_required_coverage():
    """命中可选节点不能让必做覆盖数虚高。"""
    required_total, covered, _ = _coverage_result(
        FunctionCoverageRequest(cards=[card("c1", "道具")]), make_nodes()
    )
    assert (required_total, covered) == (2, 0)


def test_duplicate_cards_do_not_double_count_one_node():
    """两张卡说同一件事只能覆盖一个节点，否则覆盖率会被凑数刷满。"""
    _, covered, results = _coverage_result(
        FunctionCoverageRequest(
            cards=[card("c1", "初始化与重置"), card("c2", "初始化与重置")]
        ),
        make_nodes(),
    )
    assert covered == 1
    assert [item.matched for item in results] == [True, True]


def test_blank_name_card_does_not_raise():
    """名称为空的旧卡不能让整次覆盖检查 422。"""
    _, covered, results = _coverage_result(
        FunctionCoverageRequest(cards=[card("c1")]), make_nodes()
    )
    assert covered == 0
    assert results[0].matched is False


# ── 提醒问题 ──────────────────────────────────────────────────────────────────

def test_questions_mention_missing_count():
    questions = _coverage_questions(3, 0, 0)
    assert any("3" in item for item in questions)


def test_questions_cover_unmatched_cards_and_unused_observations():
    questions = _coverage_questions(0, 2, 4)
    joined = "".join(questions)
    assert "2" in joined
    assert "4" in joined


def test_full_coverage_gives_a_single_closing_message():
    questions = _coverage_questions(0, 0, 0)
    assert len(questions) == 1
    assert "代码" in questions[0]


@pytest.mark.parametrize("leaked", ["建立并重置游戏状态", "初始化与重置", "判断边界和自身碰撞", "棋盘大小"])
def test_questions_never_leak_blueprint_text(leaked: str):
    """提醒问题里不得出现契约名称、同义表达或输入输出。"""
    questions = _coverage_questions(2, 1, 1)
    assert all(leaked not in item for item in questions)
