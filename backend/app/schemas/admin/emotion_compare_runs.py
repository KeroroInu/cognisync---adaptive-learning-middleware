"""
情感对比实验运行记录 Schema
"""
from typing import Any

from pydantic import BaseModel, Field

from app.schemas.admin.emotion_compare import EmotionCompareAnalyzeResponse, EmotionCompareSummaryMetrics
from app.schemas.admin.emotion_compare_ablation import EmotionCompareAblationResponse
from app.schemas.admin.emotion_compare_v2 import EmotionCompareAnalyzeResponseV2


class EmotionCompareRunItem(BaseModel):
    id: str
    originalFilename: str
    datasetTemplate: str | None = None
    labelMode: str
    sourceFormat: str
    taskType: str
    textColumn: str
    expectedLabelColumn: str | None = None
    expectedLabelColumns: list[str] = Field(default_factory=list)
    sampleIdColumn: str | None = None
    summaryMetrics: EmotionCompareSummaryMetrics
    createdAt: str


class EmotionCompareRunListResponse(BaseModel):
    runs: list[EmotionCompareRunItem] = Field(default_factory=list)
    total: int
    limit: int
    offset: int


class EmotionCompareRunDetail(BaseModel):
    id: str
    originalFilename: str
    datasetTemplate: str | None = None
    labelMode: str
    sourceFormat: str
    taskType: str
    textColumn: str
    expectedLabelColumn: str | None = None
    expectedLabelColumns: list[str] = Field(default_factory=list)
    positiveLabelValue: str | None = None
    sampleIdColumn: str | None = None
    labelMapping: dict[str, Any] = Field(default_factory=dict)
    baseResult: EmotionCompareAnalyzeResponse
    v2Result: EmotionCompareAnalyzeResponseV2 | None = None
    ablationResult: EmotionCompareAblationResponse | None = None
    createdAt: str
