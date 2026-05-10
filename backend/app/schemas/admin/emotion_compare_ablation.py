"""
情感对比实验 Ablation Schema
"""
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.admin.emotion_compare import EmotionCompareDatasetInfo, TaskType


EmotionCompareAblationVariantKey = Literal[
    "baseline_text_only",
    "system_profile_only",
    "system_dialogue_only",
    "system_knowledge_only",
    "system_full_fusion",
]


class EmotionCompareAblationContexts(BaseModel):
    profile: bool = False
    dialogue: bool = False
    knowledge: bool = False


class EmotionCompareAblationSummary(BaseModel):
    accuracy: float | None = None
    macroF1: float | None = None
    weightedF1: float | None = None
    exactMatch: float | None = None
    overlapMatch: float | None = None
    microF1: float | None = None


class EmotionCompareAblationDelta(BaseModel):
    deltaAccuracy: float | None = None
    deltaMacroF1: float | None = None
    deltaWeightedF1: float | None = None
    deltaExactMatch: float | None = None
    deltaOverlapMatch: float | None = None
    deltaMicroF1: float | None = None


class EmotionCompareAblationVariantResult(BaseModel):
    variantKey: EmotionCompareAblationVariantKey
    variantName: str
    taskType: TaskType
    implemented: bool
    note: str | None = None
    contexts: EmotionCompareAblationContexts = Field(default_factory=EmotionCompareAblationContexts)
    support: int = 0
    summary: EmotionCompareAblationSummary = Field(default_factory=EmotionCompareAblationSummary)
    deltaVsBaseline: EmotionCompareAblationDelta = Field(default_factory=EmotionCompareAblationDelta)


class EmotionCompareAblationResponse(BaseModel):
    datasetInfo: EmotionCompareDatasetInfo
    variants: list[EmotionCompareAblationVariantResult] = Field(default_factory=list)
