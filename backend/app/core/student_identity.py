"""School identity rules; UUIDs, not changeable school numbers, own research data."""
from typing import Literal

TeachingClass = Literal["解构班", "开发班", "体验组"]
TeachingGroup = Literal["pdt", "ai_pbl", "experience"]

# Experience classes are separate from both research conditions. The legacy
# ``lecture`` group is historical evidence only and must not be reused.
TEACHING_GROUPS: dict[TeachingClass, TeachingGroup] = {
    "解构班": "pdt", "开发班": "ai_pbl", "体验组": "experience",
}


def clean_school_class(value):
    import re
    if value is None:
        return None
    value = value.strip()
    if not re.fullmatch(r"高[一二三]（[1-7]）班", value):
        raise ValueError("请选择高一至高三、1—7 班")
    return value


def student_id_filter(column, value: str):
    from sqlalchemy import func
    # Compatibility for a previously stored lowercase g20xx school ID.
    return func.lower(column) == value.lower() if value[:3].lower() == 'g20' else column == value


def clean_student_id(value: str) -> str:
    value = value.strip()
    if not value or len(value) > 50 or any(char.isspace() for char in value):
        raise ValueError("请填写完整学号（不超过 50 个字符），不要包含空格")
    # No invented fixed length. Existing non-school test IDs remain case-sensitive.
    if value[:3].lower() == "g20":
        value = "G" + value[1:]
    return value
