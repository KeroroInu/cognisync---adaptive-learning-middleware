"""校准上报的契约测试。

学生端补上上报之后，``calibration_logs`` 才第一次有数据；这批断言锁住的是
「谁来决定这条记录属于谁」和「越界值必须被拒」，两者一旦松动都会污染元认知分析。
"""

import pytest
from pydantic import ValidationError

from app.schemas.calibration import CalibrationLogCreate, calculate_conflict_level


def test_user_id_is_optional_because_identity_comes_from_the_token():
    """学生端不传 userId：归属由 JWT 决定，请求体里的值从不生效。

    这个字段以前是必填的，等于逼客户端伪造一个服务端根本不看的值。改为可选之后
    仍保留字段本身，是为了老调用方多传一个 userId 不会被 422 拒掉。
    """
    payload = CalibrationLogCreate(
        dimension="cognition", systemValue=62, userValue=80, userComment="偏低", likertTrust=3
    )

    assert payload.user_id is None
    assert payload.system_value == 62
    assert payload.user_value == 80


def test_legacy_caller_passing_user_id_is_still_accepted():
    payload = CalibrationLogCreate(
        userId="123e4567-e89b-12d3-a456-426614174000",
        dimension="affect",
        systemValue=50,
        userValue=55,
    )

    assert str(payload.user_id) == "123e4567-e89b-12d3-a456-426614174000"


@pytest.mark.parametrize("system_value,user_value", [(101, 0), (0, -1), (50, 200)])
def test_out_of_range_scores_are_rejected(system_value: int, user_value: int):
    """0–100 的边界必须守住：越界值会让冲突等级的阈值失去意义。"""
    with pytest.raises(ValidationError):
        CalibrationLogCreate(
            dimension="behavior", systemValue=system_value, userValue=user_value
        )


def test_unknown_dimension_is_rejected():
    with pytest.raises(ValidationError):
        CalibrationLogCreate(dimension="motivation", systemValue=50, userValue=50)


@pytest.mark.parametrize(
    "system_value,user_value,expected",
    [
        (50, 50, "low"),
        (50, 64, "low"),    # 差 14，仍在 low
        (50, 65, "medium"),  # 差 15，进入 medium
        (50, 80, "medium"),  # 差 30，仍是 medium
        (50, 81, "high"),    # 差 31，进入 high
        (81, 50, "high"),    # 方向相反，取绝对值
    ],
)
def test_conflict_level_thresholds(system_value: int, user_value: int, expected: str):
    """冲突等级只在后端算一次；前端不得复制这套阈值，否则两处会走样。"""
    assert calculate_conflict_level(system_value, user_value) == expected
