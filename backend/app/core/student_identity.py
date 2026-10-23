"""School identity rules; UUIDs, not changeable school numbers, own research data."""
TEACHING_GROUPS = {"解构班": "pdt", "开发班": "ai_pbl"}


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
