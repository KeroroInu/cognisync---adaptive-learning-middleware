"""Question/answer contract shared by assessments and classroom interactions."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Option(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    value: str = Field(min_length=1, max_length=100)
    label: str = Field(min_length=1, max_length=300)
    exclusive: bool = False


class Condition(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question_id: str
    values: list[str] = Field(min_length=1, max_length=12)


class Question(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,80}$")
    text: str = Field(min_length=1, max_length=2000)
    hint: str = Field(default='', max_length=1000)
    code: str = Field(default='', max_length=6000)
    skip_label: str = Field(default='', max_length=100)
    parent_id: str | None = Field(default=None, pattern=r'^[A-Za-z0-9_-]{1,80}$')
    type: Literal["choice", "multiple", "text"] = "choice"
    required: bool = True
    options: list[Option] = Field(default_factory=list, max_length=12)
    max_selections: int | None = Field(default=None, ge=1, le=12)
    show_if: list[Condition] = Field(default_factory=list, max_length=10)

    @model_validator(mode="after")
    def valid_options(self):
        if self.skip_label and self.type != 'text':
            raise ValueError('不知道/不记得勾选项只用于简答题')
        if self.type != "text" and len(self.options) < 2:
            raise ValueError("选择题至少需要两个选项")
        if len({o.value for o in self.options}) != len(self.options):
            raise ValueError("选项值不能重复")
        if self.type == "text" and self.options:
            raise ValueError("简答题不应包含选项")
        if self.max_selections is not None and (self.type != 'multiple' or self.max_selections > len(self.options)):
            raise ValueError('最多选择数只能用于多选且不能超过选项数')
        return self


def validate_answer(question: dict, answer: str | list[str] | None) -> None:
    if answer is None or answer == [] or (isinstance(answer, str) and not answer.strip()):
        if question["required"]:
            raise ValueError("还有题目没有回答")
        return
    if question['type'] == 'multiple':
        options = {o['value']: o for o in question['options']}
        if (not isinstance(answer, list) or any(not isinstance(v, str) or v not in options for v in answer)
                or len(set(answer)) != len(answer) or len(answer) > (question.get('max_selections') or len(options))
                or (len(answer) > 1 and any(options[v].get('exclusive') for v in answer))):
            raise ValueError('多选答案超出数量限制、包含重复或互斥选项')
    elif not isinstance(answer, str) or len(answer) > 4000 or (answer == '__skip__' and not question.get('skip_label')) or (question["type"] == "choice" and answer not in {o["value"] for o in question["options"]}):
        raise ValueError("答案不在题目允许的范围内")


def visible_question_ids(questions: list[dict], answers: dict) -> set[str]:
    visible = set()
    for q in questions:
        if (not q.get('parent_id') or q['parent_id'] in visible) and all(c['question_id'] in visible and any(value in (answers.get(c['question_id']) if isinstance(answers.get(c['question_id']), list) else [answers.get(c['question_id'])]) for value in c['values']) for c in q.get('show_if', [])):
            visible.add(q['id'])
    return visible
