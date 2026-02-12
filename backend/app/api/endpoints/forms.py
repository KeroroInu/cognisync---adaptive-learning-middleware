"""
Forms API Endpoints - 量表相关接口
"""
import uuid
from typing import Dict
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.endpoints.auth import get_current_user, save_user_profile

router = APIRouter()


class LikertOption(BaseModel):
    """Likert选项"""
    value: int
    label: str


class ScaleItem(BaseModel):
    """量表题目"""
    id: str
    text: str
    subscale: str | None = None
    required: bool = True
    reversed: bool = False


class ScaleTemplateSchema(BaseModel):
    """量表模板Schema"""
    title: str
    description: str | None = None
    items: list[ScaleItem]
    subscales: list[Dict] | None = None
    likertOptions: list[LikertOption]


class ScaleTemplate(BaseModel):
    """量表模板"""
    id: str
    name: str
    description: str
    schema_json: ScaleTemplateSchema
    version: str
    is_active: bool
    created_at: str
    updated_at: str


class ScaleSubmitRequest(BaseModel):
    """量表提交请求"""
    answers: Dict[str, int]


class InitialProfile(BaseModel):
    """初始画像"""
    cognition: float = Field(..., ge=0, le=100)
    affect: float = Field(..., ge=0, le=100)
    behavior: float = Field(..., ge=0, le=100)


class ScaleSubmitResponse(BaseModel):
    """量表提交响应"""
    success: bool
    scores: list[Dict]
    totalScore: int
    maxScore: int
    initialProfile: InitialProfile
    responseId: str


@router.get("/active")
async def get_active_template(
    current_user: Dict = Depends(get_current_user)
):
    """
    获取当前激活的量表模板

    返回一个示例量表模板（MVP版本）
    """
    # MVP: 返回示例模板
    return ScaleTemplate(
        id="template-uuid-123",
        name="学习画像评估量表 v1.0",
        description="通过标准化量表快速建立初始学习画像",
        version="1.0.0",
        is_active=True,
        created_at="2026-02-01T10:00:00Z",
        updated_at="2026-02-10T15:30:00Z",
        schema_json=ScaleTemplateSchema(
            title="学习画像评估问卷",
            description="请根据真实感受作答，没有对错之分",
            items=[
                ScaleItem(id="item_1", text="我能够快速理解新概念", subscale="认知能力"),
                ScaleItem(id="item_2", text="学习新知识让我感到焦虑", subscale="情感状态", reversed=True),
                ScaleItem(id="item_3", text="我喜欢主动探索新的学习资源", subscale="行为特征"),
                ScaleItem(id="item_4", text="我能够有效地组织和管理学习时间", subscale="行为特征"),
                ScaleItem(id="item_5", text="面对困难问题时我能保持冷静", subscale="情感状态"),
                ScaleItem(id="item_6", text="我能够将新知识与已有知识联系起来", subscale="认知能力"),
            ],
            likertOptions=[
                LikertOption(value=1, label="非常不同意"),
                LikertOption(value=2, label="不同意"),
                LikertOption(value=3, label="中立"),
                LikertOption(value=4, label="同意"),
                LikertOption(value=5, label="非常同意"),
            ]
        )
    )


@router.post("/{template_id}/submit")
async def submit_scale_answers(
    template_id: str,
    data: ScaleSubmitRequest,
    current_user: Dict = Depends(get_current_user)
):
    """
    提交量表答案

    计算得分并生成初始画像（MVP版本：简单算法）
    """
    # MVP: 简单计算
    answers = data.answers
    total_score = sum(answers.values())
    max_score = len(answers) * 5

    # 简单映射到三维画像（示例算法）
    cognition = min(100, (answers.get("item_1", 3) + answers.get("item_6", 3)) / 2 * 20)
    affect = min(100, (answers.get("item_2", 3) + answers.get("item_5", 3)) / 2 * 20)
    behavior = min(100, (answers.get("item_3", 3) + answers.get("item_4", 3)) / 2 * 20)

    # 保存用户画像
    save_user_profile(current_user["id"], cognition, affect, behavior)

    response_id = str(uuid.uuid4())

    return ScaleSubmitResponse(
        success=True,
        scores=[],
        totalScore=total_score,
        maxScore=max_score,
        initialProfile=InitialProfile(
            cognition=cognition,
            affect=affect,
            behavior=behavior
        ),
        responseId=response_id
    )
