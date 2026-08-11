"""
知识图谱更新的回归测试

锁定两个曾经存在的缺陷，防止回退：

1. update_graph_from_conversation 内部重新调用 TextAnalyzer.analyze()，
   导致同一条消息在一次请求中被分析两次（浪费 token，且第二次缺少对话历史
   与画像上下文，结果更差）。

2. 该方法把 _merge_concepts() 合并后的整张图传给 upsert_concepts()，
   而 Cypher 是 `ON MATCH SET r.count = r.count + 1`，导致用户历史上的
   每一个概念在每轮对话中交互次数都 +1。frequency 用于计算 importance，
   几轮对话后全部饱和，知识图谱数据被系统性污染。

现在该方法是纯计算：只负责合成返回给前端的图谱视图，持久化由调用方
（chat 接口）统一负责，且只写入本轮真实提到的概念。
"""
import ast
import inspect

import pytest

from app.schemas.profile import UserProfile
from app.services.personalization_service import PersonalizationService


@pytest.fixture
def profile() -> UserProfile:
    return UserProfile(cognition=60, affect=55, behavior=70, lastUpdate=None)


def _function_body_names(func) -> set[str]:
    """提取函数体内引用的所有名称，剥离 docstring 以免把说明文字误判为调用。"""
    tree = ast.parse(inspect.getsource(func).lstrip())
    fn = tree.body[0]
    body = list(fn.body)
    if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant):
        body = body[1:]

    names: set[str] = set()
    for stmt in body:
        for node in ast.walk(stmt):
            if isinstance(node, ast.Name):
                names.add(node.id)
            elif isinstance(node, ast.Attribute):
                names.add(node.attr)
    return names


def test_update_graph_does_not_reanalyze_message():
    """该方法不得自行调用 LLM 分析——调用方已经分析过同一条消息。"""
    names = _function_body_names(PersonalizationService.update_graph_from_conversation)

    assert "TextAnalyzer" not in names, "不应在此重新构造 TextAnalyzer"
    assert "analyze" not in names, "不应在此重新分析消息"


def test_update_graph_does_not_write_to_graph():
    """
    该方法不得写图谱——否则与调用方的 upsert 叠加，同一轮对话使概念计数 +2。
    """
    names = _function_body_names(PersonalizationService.update_graph_from_conversation)

    assert "upsert_concepts" not in names, "持久化应由调用方统一负责，避免重复计数"


def test_update_graph_accepts_detected_concepts_not_raw_message():
    """签名应接收已识别的概念，而不是原始消息文本。"""
    params = inspect.signature(
        PersonalizationService.update_graph_from_conversation
    ).parameters

    assert "detected_concepts" in params
    assert "message" not in params


@pytest.mark.asyncio
async def test_merges_new_concepts_into_existing_graph(profile):
    """本轮新概念应并入现有图谱一并返回，且不丢失历史概念。"""
    service = PersonalizationService()
    current_graph = [
        {"name": "神经网络", "category": "general", "importance": 0.6},
    ]

    result = await service.update_graph_from_conversation(
        user_id="u-1",
        detected_concepts=["反向传播"],
        current_graph=current_graph,
        user_profile=profile,
    )

    names = {c["name"] for c in result}
    assert names == {"神经网络", "反向传播"}


@pytest.mark.asyncio
async def test_empty_concepts_returns_graph_unchanged(profile):
    """没有识别到概念时应原样返回，不产生任何副作用。"""
    service = PersonalizationService()
    current_graph = [{"name": "神经网络", "category": "general", "importance": 0.6}]

    result = await service.update_graph_from_conversation(
        user_id="u-1",
        detected_concepts=[],
        current_graph=current_graph,
        user_profile=profile,
    )

    assert result == current_graph


@pytest.mark.asyncio
async def test_blank_concept_names_are_ignored(profile):
    """空概念名不应污染图谱。"""
    service = PersonalizationService()

    result = await service.update_graph_from_conversation(
        user_id="u-1",
        detected_concepts=[{"name": ""}, {"name": "   "}],
        current_graph=[],
        user_profile=profile,
    )

    assert result == []
