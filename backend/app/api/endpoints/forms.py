"""
Forms API Endpoints - 量表相关接口
"""
import uuid
from datetime import datetime
from typing import Dict, Any, Generic, TypeVar
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.endpoints.auth import get_current_user, save_user_profile

router = APIRouter()


# 通用响应包装
T = TypeVar('T')

class ApiResponse(BaseModel, Generic[T]):
    """统一API响应格式"""
    success: bool
    data: T | None = None
    error: Dict[str, Any] | None = None


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

    返回一个示例量表模板（MVP版本），使用简化格式
    """
    # MVP: 返回简化的模板格式，匹配前端期望的结构
    template = {
        "id": "template-uuid-123",
        "name": "学习画像评估量表 v1.0",
        "description": "通过标准化量表快速建立初始学习画像",
        "questions": [
            {"id": "item_1", "text": "我能够快速理解新概念", "dimension": "Cognition"},
            {"id": "item_2", "text": "学习新知识让我感到焦虑", "dimension": "Affect"},
            {"id": "item_3", "text": "我喜欢主动探索新的学习资源", "dimension": "Behavior"},
            {"id": "item_4", "text": "我能够有效地组织和管理学习时间", "dimension": "Behavior"},
            {"id": "item_5", "text": "面对困难问题时我能保持冷静", "dimension": "Affect"},
            {"id": "item_6", "text": "我能够将新知识与已有知识联系起来", "dimension": "Cognition"},
        ]
    }

    # 返回包装格式
    return ApiResponse(success=True, data={"template": template})


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
    current_time = datetime.utcnow().isoformat()

    # 构造响应数据
    response_data = {
        "scores": {
            "cognition": cognition,
            "affect": affect,
            "behavior": behavior
        },
        "initialProfile": {
            "cognition": cognition,
            "affect": affect,
            "behavior": behavior,
            "lastUpdate": current_time
        }
    }

    # 返回包装格式以匹配前端期望的结构
    return ApiResponse(success=True, data=response_data)
