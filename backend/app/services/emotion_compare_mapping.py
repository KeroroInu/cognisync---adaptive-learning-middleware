"""
Emotion Compare Mapping - 统一维护数据集标签到系统情感空间的映射
"""
from dataclasses import dataclass
from typing import Literal


DatasetFamily = Literal["weibo", "goemotions"]


@dataclass(frozen=True, slots=True)
class EmotionCompareLabelMappingEntry:
    dataset_family: DatasetFamily
    raw_label: str
    normalized_label: str
    acceptable_aliases: tuple[str, ...]


DEFAULT_LABEL_MAPPING_ENTRIES: tuple[EmotionCompareLabelMappingEntry, ...] = (
    EmotionCompareLabelMappingEntry("weibo", "angry", "frustrated", ("frustrated", "discouraged", "e03", "e11")),
    EmotionCompareLabelMappingEntry("weibo", "fear", "anxious", ("anxious", "overwhelmed", "e04", "e10")),
    EmotionCompareLabelMappingEntry("weibo", "happy", "excited", ("excited", "motivated", "encouraged", "confident", "relieved", "e05", "e06", "e07", "e08", "e12")),
    EmotionCompareLabelMappingEntry("weibo", "neutral", "neutral", ("neutral", "thoughtful", "e09", "e13")),
    EmotionCompareLabelMappingEntry("weibo", "sad", "discouraged", ("discouraged", "frustrated", "overwhelmed", "e03", "e10", "e11")),
    EmotionCompareLabelMappingEntry("weibo", "surprise", "curious", ("curious", "excited", "e02", "e07")),
    EmotionCompareLabelMappingEntry("goemotions", "admiration", "encouraged", ("encouraged", "confident", "motivated", "e05", "e06", "e08")),
    EmotionCompareLabelMappingEntry("goemotions", "amusement", "excited", ("excited", "relieved", "e07", "e12")),
    EmotionCompareLabelMappingEntry("goemotions", "anger", "frustrated", ("frustrated", "discouraged", "e03", "e11")),
    EmotionCompareLabelMappingEntry("goemotions", "annoyance", "frustrated", ("frustrated", "discouraged", "e03", "e11")),
    EmotionCompareLabelMappingEntry("goemotions", "approval", "encouraged", ("encouraged", "confident", "e05", "e06")),
    EmotionCompareLabelMappingEntry("goemotions", "caring", "encouraged", ("encouraged", "thoughtful", "e05", "e09")),
    EmotionCompareLabelMappingEntry("goemotions", "confusion", "confused", ("confused", "e01")),
    EmotionCompareLabelMappingEntry("goemotions", "curiosity", "curious", ("curious", "e02")),
    EmotionCompareLabelMappingEntry("goemotions", "desire", "motivated", ("motivated", "excited", "e07", "e08")),
    EmotionCompareLabelMappingEntry("goemotions", "disappointment", "discouraged", ("discouraged", "frustrated", "e03", "e11")),
    EmotionCompareLabelMappingEntry("goemotions", "disapproval", "frustrated", ("frustrated", "thoughtful", "e03", "e09")),
    EmotionCompareLabelMappingEntry("goemotions", "disgust", "discouraged", ("discouraged", "frustrated", "e03", "e11")),
    EmotionCompareLabelMappingEntry("goemotions", "embarrassment", "anxious", ("anxious", "discouraged", "e04", "e11")),
    EmotionCompareLabelMappingEntry("goemotions", "excitement", "excited", ("excited", "e07")),
    EmotionCompareLabelMappingEntry("goemotions", "fear", "anxious", ("anxious", "e04")),
    EmotionCompareLabelMappingEntry("goemotions", "gratitude", "encouraged", ("encouraged", "relieved", "e05", "e12")),
    EmotionCompareLabelMappingEntry("goemotions", "grief", "discouraged", ("discouraged", "e11")),
    EmotionCompareLabelMappingEntry("goemotions", "joy", "excited", ("excited", "motivated", "relieved", "e07", "e08", "e12")),
    EmotionCompareLabelMappingEntry("goemotions", "love", "encouraged", ("encouraged", "excited", "e05", "e07")),
    EmotionCompareLabelMappingEntry("goemotions", "nervousness", "anxious", ("anxious", "e04")),
    EmotionCompareLabelMappingEntry("goemotions", "optimism", "motivated", ("motivated", "encouraged", "confident", "e05", "e06", "e08")),
    EmotionCompareLabelMappingEntry("goemotions", "pride", "confident", ("confident", "e06")),
    EmotionCompareLabelMappingEntry("goemotions", "realization", "thoughtful", ("thoughtful", "relieved", "e09", "e12")),
    EmotionCompareLabelMappingEntry("goemotions", "relief", "relieved", ("relieved", "e12")),
    EmotionCompareLabelMappingEntry("goemotions", "remorse", "discouraged", ("discouraged", "anxious", "e04", "e11")),
    EmotionCompareLabelMappingEntry("goemotions", "sadness", "discouraged", ("discouraged", "e11")),
    EmotionCompareLabelMappingEntry("goemotions", "surprise", "curious", ("curious", "excited", "e02", "e07")),
    EmotionCompareLabelMappingEntry("goemotions", "neutral", "neutral", ("neutral", "thoughtful", "e09", "e13")),
)


def build_default_label_mapping() -> dict[str, list[str]]:
    mapping: dict[str, list[str]] = {}
    for entry in DEFAULT_LABEL_MAPPING_ENTRIES:
        aliases = {entry.raw_label.lower(), entry.normalized_label.lower(), *[alias.lower() for alias in entry.acceptable_aliases]}
        mapping[entry.raw_label.lower()] = sorted(aliases)
    return mapping


def get_label_mapping_entry(raw_label: str) -> EmotionCompareLabelMappingEntry | None:
    normalized = raw_label.strip().lower()
    for entry in DEFAULT_LABEL_MAPPING_ENTRIES:
        if entry.raw_label.lower() == normalized:
            return entry
    return None


def get_dataset_family_entries(dataset_family: DatasetFamily) -> list[EmotionCompareLabelMappingEntry]:
    return [entry for entry in DEFAULT_LABEL_MAPPING_ENTRIES if entry.dataset_family == dataset_family]
