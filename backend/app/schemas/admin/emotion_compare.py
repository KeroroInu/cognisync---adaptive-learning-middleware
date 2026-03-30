"""
情感对比实验 Schema
"""
from typing import Literal

from pydantic import BaseModel, Field


TaskType = Literal["single_label", "multi_label"]


class EmotionCompareDatasetInfo(BaseModel):
    datasetName: str
    sourceFormat: str
    taskType: TaskType
    datasetTemplate: str | None = None
    sampleIdColumn: str | None = None
    textColumn: str
    expectedLabelColumn: str | None = None
    expectedLabelColumns: list[str] = Field(default_factory=list)
    positiveLabelValue: str | None = None
    rowsProcessed: int
    rowsSkipped: int
    labelCount: int
    labels: list[str] = Field(default_factory=list)


class EmotionComparePrediction(BaseModel):
    emotionCode: str | None = None
    emotionName: str | None = None
    intensity: str | None = None
    confidence: float | None = None
    rawLabel: str | None = None
    predictedLabels: list[str] = Field(default_factory=list)


class EmotionCompareBaselineRow(BaseModel):
    rowIndex: int
    sampleId: str | None = None
    text: str
    predictedEmotionCode: str | None = None
    predictedEmotionName: str | None = None
    predictedIntensity: str | None = None
    confidence: float | None = None
    rawLabel: str | None = None


class EmotionCompareProfileSnapshot(BaseModel):
    cognition: int
    affect: int
    behavior: int


class EmotionCompareDelta(BaseModel):
    cognition: int
    affect: int
    behavior: int


class EmotionCompareContextUsed(BaseModel):
    dialogue: bool = False
    profile: bool = False
    knowledge: bool = False


class EmotionCompareSystemRow(BaseModel):
    rowIndex: int
    sampleId: str | None = None
    text: str
    predictedEmotionCode: str | None = None
    predictedEmotionName: str | None = None
    predictedIntensity: str | None = None
    confidence: float | None = None
    profileBefore: EmotionCompareProfileSnapshot | None = None
    profileAfter: EmotionCompareProfileSnapshot | None = None
    delta: EmotionCompareDelta | None = None
    contextUsed: EmotionCompareContextUsed = Field(default_factory=EmotionCompareContextUsed)


class EmotionCompareComparisonRow(BaseModel):
    rowIndex: int
    sampleId: str | None = None
    text: str
    groundTruthLabels: list[str] = Field(default_factory=list)
    baselinePrediction: EmotionComparePrediction = Field(default_factory=EmotionComparePrediction)
    systemPrediction: EmotionComparePrediction = Field(default_factory=EmotionComparePrediction)
    baselineMatched: bool | None = None
    systemMatched: bool | None = None
    winner: Literal["baseline", "system", "tie", "none"] = "none"


class EmotionCompareSingleMetrics(BaseModel):
    accuracy: float | None = None
    macroF1: float | None = None
    weightedF1: float | None = None


class EmotionComparePerLabelMetric(BaseModel):
    label: str
    precision: float | None = None
    recall: float | None = None
    f1: float | None = None
    support: int = 0


class EmotionCompareMultiMetrics(BaseModel):
    exactMatch: float | None = None
    overlapMatch: float | None = None
    microF1: float | None = None
    macroF1: float | None = None
    labelWiseMetrics: list[EmotionComparePerLabelMetric] = Field(default_factory=list)


class EmotionCompareSummaryMetrics(BaseModel):
    taskType: TaskType
    support: int
    labelCount: int
    labels: list[str] = Field(default_factory=list)
    baseline: EmotionCompareSingleMetrics | EmotionCompareMultiMetrics
    system: EmotionCompareSingleMetrics | EmotionCompareMultiMetrics


class EmotionCompareExportArtifacts(BaseModel):
    comparisonCsvFileName: str
    comparisonCsvContent: str
    resultJsonFileName: str


class EmotionCompareAnalyzeResponse(BaseModel):
    datasetInfo: EmotionCompareDatasetInfo
    baselineRows: list[EmotionCompareBaselineRow] = Field(default_factory=list)
    systemRows: list[EmotionCompareSystemRow] = Field(default_factory=list)
    comparisonRows: list[EmotionCompareComparisonRow] = Field(default_factory=list)
    summaryMetrics: EmotionCompareSummaryMetrics
    exportArtifacts: EmotionCompareExportArtifacts
