"""研究导出中「版本差异在导出时计算」这一约定的单元测试。

版本表保存的是每个产物的完整快照，差异不作为独立数据源存储。本文件锁定
差异摘要函数的行为，避免后续为了省事把增量 diff 变成唯一真相。
"""
from app.api.endpoints.admin.export import _summarize_change


def test_first_version_is_marked_created():
    assert _summarize_change(None, {"responsibility": "移动蛇身"}) == "created"


def test_unchanged_content_reports_nothing():
    payload = {"responsibility": "移动蛇身", "input": "方向"}
    assert _summarize_change(payload, dict(payload)) == ""


def test_modified_field_is_listed():
    before = {"responsibility": "移动蛇身", "input": "方向"}
    after = {"responsibility": "移动蛇身并检测边界", "input": "方向"}

    assert _summarize_change(before, after) == "responsibility"


def test_added_and_removed_fields_use_signs():
    before = {"responsibility": "移动蛇身", "legacy": "x"}
    after = {"responsibility": "移动蛇身", "boundaryReason": "独立可验证"}

    assert _summarize_change(before, after) == "+boundaryReason|-legacy"


def test_multiple_changes_are_sorted_for_stable_output():
    before = {"a": 1, "b": 1, "c": 1}
    after = {"a": 2, "b": 2, "c": 1}

    # 排序保证同一份数据每次导出得到一致的列内容，便于比对分析结果
    assert _summarize_change(before, after) == "a|b"


def test_non_dict_content_is_tolerated():
    assert _summarize_change({"a": 1}, None) == ""
    assert _summarize_change("not-a-dict", {"a": 1}) == "created"
