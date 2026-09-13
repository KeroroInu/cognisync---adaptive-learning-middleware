"""Question/answer contract shared by assessments and classroom interactions."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Option(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    value: str = Field(min_length=1, max_length=100)
    label: str = Field(min_length=1, max_length=300)


class Question(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,80}$")
    text: str = Field(min_length=1, max_length=2000)
    type: Literal["choice", "text"] = "choice"
    required: bool = True
    options: list[Option] = Field(default_factory=list, max_length=12)

    @model_validator(mode="after")
    def valid_options(self):
        if self.type == "choice" and len(self.options) < 2:
            raise ValueError("选择题至少需要两个选项")
        if len({o.value for o in self.options}) != len(self.options):
            raise ValueError("选项值不能重复")
        if self.type == "text" and self.options:
            raise ValueError("简答题不应包含选项")
        return self


def validate_answer(question: dict, answer: str | None) -> None:
    if answer is None or not answer.strip():
        if question["required"]:
            raise ValueError("还有题目没有回答")
    elif len(answer) > 4000 or (question["type"] == "choice" and answer not in {o["value"] for o in question["options"]}):
        raise ValueError("答案不在题目允许的范围内")
