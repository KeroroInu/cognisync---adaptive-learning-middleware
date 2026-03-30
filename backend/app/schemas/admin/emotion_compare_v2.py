"""
情感对比实验 V2 Schema
"""
from pydantic import BaseModel, Field

from app.schemas.admin.emotion_compare import EmotionCompareAnalyzeResponse, TaskType


class EmotionComparePerClassMetricItem(BaseModel):
    label: str
    support: int = 0
    baselinePrecision: float | None = None
    baselineRecall: float | None = None
    baselineF1: float | None = None
    systemPrecision: float | None = None
    systemRecall: float | None = None
    systemF1: float | None = None


class EmotionCompareConfusionAnalysis(BaseModel):
    taskType: TaskType
    labels: list[str] = Field(default_factory=list)
    baselineMatrix: list[list[int]] = Field(default_factory=list)
    systemMatrix: list[list[int]] = Field(default_factory=list)
    available: bool = False


class EmotionCompareAgreementMetricSet(BaseModel):
    overallAgreement: float | None = None
    observedAgreement: float | None = None
    expectedAgreement: float | None = None
    cohensKappa: float | None = None


class EmotionCompareAgreementMetrics(BaseModel):
    taskType: TaskType
    baseline: EmotionCompareAgreementMetricSet = Field(default_factory=EmotionCompareAgreementMetricSet)
    system: EmotionCompareAgreementMetricSet = Field(default_factory=EmotionCompareAgreementMetricSet)
    available: bool = False


class EmotionCompareIntensityMetricSet(BaseModel):
    intensityAccuracy: float | None = None
    intensityMAE: float | None = None
    support: int = 0


class EmotionCompareIntensityMetrics(BaseModel):
    baseline: EmotionCompareIntensityMetricSet = Field(default_factory=EmotionCompareIntensityMetricSet)
    system: EmotionCompareIntensityMetricSet = Field(default_factory=EmotionCompareIntensityMetricSet)
    available: bool = False
    note: str | None = None


class EmotionCompareAnalyzeResponseV2(BaseModel):
    base: EmotionCompareAnalyzeResponse
    perClassMetrics: list[EmotionComparePerClassMetricItem] = Field(default_factory=list)
    confusionAnalysis: EmotionCompareConfusionAnalysis
    agreementMetrics: EmotionCompareAgreementMetrics
    intensityMetrics: EmotionCompareIntensityMetrics
