"""创意能力契约的跨语言防漂移测试。

Agent 看到的能力描述（`app/services/creative_capability.py`）必须与浏览器沙箱
真正实现的能力（`frontend/data/creativeCapabilities.ts`）一致。两边一旦走散，
Agent 就会建议沙箱里不存在的名称或字段，学生拿到「能讨论、不能运行」的代码。

这类错误在真实课堂里已经发生过：沙箱新增 `timers` 与九个帮助函数后，
Prompt 里的旧契约没有同步，Agent 于是顺着学生的 `state['bomb_count']` 往下讨论，
而那个字段会被运行器直接拒绝。因此这里用测试把两边钉在一起。
"""
import re
from pathlib import Path

import pytest

from app.services.creative_capability import (
    CREATIVE_CAPABILITY_VERSION,
    CREATIVE_EVENT_TYPES,
    CREATIVE_HELPERS,
    CREATIVE_SAFE_BUILTINS,
    CREATIVE_STATE_KEYS,
    creative_contract_en,
    creative_contract_zh,
)

FRONTEND_REGISTRY = (
    Path(__file__).resolve().parents[2] / "frontend" / "data" / "creativeCapabilities.ts"
)


def registry_source() -> str:
    if not FRONTEND_REGISTRY.exists():  # pragma: no cover - 仓库结构变化时立即失败
        pytest.fail(f"找不到前端能力注册表：{FRONTEND_REGISTRY}")
    return FRONTEND_REGISTRY.read_text(encoding="utf-8")


def string_array(source: str, name: str) -> list[str]:
    """从 `export const NAME = [ 'a', 'b' ] as const;` 中取出字符串字面量。"""
    match = re.search(rf"export const {name} = \[(.*?)\] as const;", source, re.S)
    assert match, f"注册表里找不到 {name}"
    return re.findall(r"'([^']+)'", match.group(1))


# ── 与前端注册表比对 ──────────────────────────────────────────────────────────

def test_event_types_match_the_sandbox():
    assert list(CREATIVE_EVENT_TYPES) == string_array(registry_source(), "CREATIVE_EVENT_TYPES")


def test_state_keys_match_the_sandbox():
    source = registry_source()
    expected = string_array(source, "CREATIVE_STATE_KEYS_V1") + string_array(
        source, "CREATIVE_STATE_KEYS_V2_ADDED"
    )
    assert list(CREATIVE_STATE_KEYS) == expected


def test_helper_names_match_the_sandbox():
    names = re.findall(r"^    name: '([a-z_]+)',$", registry_source(), re.M)
    assert names, "注册表里没有解析到帮助函数名"
    assert [signature.split("(")[0] for signature, _ in CREATIVE_HELPERS] == names


def test_capability_version_matches_the_sandbox():
    match = re.search(r"CREATIVE_CAPABILITY_VERSION = '([^']+)'", registry_source())
    assert match and match.group(1) == CREATIVE_CAPABILITY_VERSION


# ── 契约文本必须说清关键约束 ──────────────────────────────────────────────────

@pytest.mark.parametrize("contract", [creative_contract_zh(), creative_contract_en()])
def test_contract_lists_every_helper(contract: str):
    for signature, _ in CREATIVE_HELPERS:
        assert signature.split("(")[0] in contract


@pytest.mark.parametrize("contract", [creative_contract_zh(), creative_contract_en()])
def test_contract_lists_every_writable_state_key(contract: str):
    for key in CREATIVE_STATE_KEYS:
        assert key in contract


@pytest.mark.parametrize("contract", [creative_contract_zh(), creative_contract_en()])
def test_contract_warns_that_invented_state_fields_are_rejected(contract: str):
    # 这是 bomb_count 事故的根因，必须显式写进契约
    assert "CREATIVE_UNSUPPORTED_STATE" in contract
    assert "bomb_count" in contract


@pytest.mark.parametrize("contract", [creative_contract_zh(), creative_contract_en()])
def test_contract_explains_preflight_checks_for_dormant_branches(contract: str):
    assert "CREATIVE_UNKNOWN_EVENT" in contract
    assert "timer" in contract
    assert "dynamic" in contract.lower() or "动态" in contract


@pytest.mark.parametrize("contract", [creative_contract_zh(), creative_contract_en()])
def test_contract_states_that_the_platform_never_spawns_objects(contract: str):
    assert "add_object" in contract


@pytest.mark.parametrize("contract", [creative_contract_zh(), creative_contract_en()])
def test_contract_declares_the_missing_reflection_builtins(contract: str):
    assert "isinstance" in contract
    for builtin in ("print", "range", "len"):
        assert builtin in contract
    assert "eval" not in CREATIVE_SAFE_BUILTINS


@pytest.mark.parametrize("contract", [creative_contract_zh(), creative_contract_en()])
def test_contract_declares_capability_gaps_instead_of_inventing_apis(contract: str):
    lowered = contract.lower()
    assert "3d" in lowered
    assert "import" in lowered


def test_contract_never_leaks_teacher_assets():
    for contract in (creative_contract_zh(), creative_contract_en()):
        for leaked in ("隐藏测试", "hidden test", "标准答案", "blueprint"):
            assert leaked not in contract
