"""
情感实验分析 Schema
"""
from typing import List, Optional

from pydantic import BaseModel, Field


class EmotionExperimentRow(BaseModel):
    rowIndex: int
    profileKey: str
    conversationId: str
    speaker: Optional[str] = None
    text: str
    expectedLabel: Optional[str] = None
    expectedLabels: List[str] = Field(default_factory=list)
    expectedMatches: Optional[bool] = None
    intent: str
    emotion: str
    emotionCode: str
    emotionName: str
    intensity: str
    confidence: float
    arousal: float
    valence: float
    deltaCognition: int
    deltaAffect: int
    deltaBehavior: int
    profileCognitionBefore: int
    profileAffectBefore: int
    profileBehaviorBefore: int
    profileCognitionAfter: int
    profileAffectAfter: int
    profileBehaviorAfter: int


class EmotionExperimentSummary(BaseModel):
    rowsProcessed: int
    rowsSkipped: int
    analyzedRows: int
    comparedRows: int
    matchedRows: int
    uniqueProfiles: int
    uniqueConversations: int


class EmotionExperimentAnalyzeResponse(BaseModel):
    experimentId: Optional[str] = Field(default=None, description="实验运行记录 ID")
    fileName: str = Field(..., description="导出文件名")
    detectedColumns: List[str] = Field(default_factory=list, description="CSV 检测到的列")
    labelMapping: dict[str, List[str]] = Field(default_factory=dict, description="标签映射配置")
    previewRows: List[EmotionExperimentRow] = Field(default_factory=list, description="预览行")
    summary: EmotionExperimentSummary
    csvContent: str = Field(..., description="可直接下载的 CSV 内容")


class EmotionExperimentRunItem(BaseModel):
    id: str
    originalFilename: str
    outputFilename: str
    textColumn: str
    conversationIdColumn: Optional[str] = None
    speakerColumn: Optional[str] = None
    expectedLabelColumn: Optional[str] = None
    profileKeyColumn: Optional[str] = None
    labelMapping: dict[str, List[str]] = Field(default_factory=dict)
    summary: EmotionExperimentSummary
    createdAt: str
