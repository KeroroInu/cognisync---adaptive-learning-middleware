"""
Emotion Coding - 13 种情感 × 3 级强度定义与兼容映射
"""
from typing import Any, Dict, Optional


VALID_INTENSITIES = {"low", "medium", "high"}

EMOTION_CATALOG: Dict[str, Dict[str, Any]] = {
    "E01": {"name": "confused", "legacy": "confused", "valence": -0.55, "arousal": 0.35},
    "E02": {"name": "curious", "legacy": "curious", "valence": 0.35, "arousal": 0.45},
    "E03": {"name": "frustrated", "legacy": "frustrated", "valence": -0.75, "arousal": 0.7},
    "E04": {"name": "anxious", "legacy": "anxious", "valence": -0.65, "arousal": 0.8},
    "E05": {"name": "encouraged", "legacy": "motivated", "valence": 0.55, "arousal": 0.35},
    "E06": {"name": "confident", "legacy": "confident", "valence": 0.75, "arousal": 0.45},
    "E07": {"name": "excited", "legacy": "excited", "valence": 0.9, "arousal": 0.9},
    "E08": {"name": "motivated", "legacy": "motivated", "valence": 0.8, "arousal": 0.7},
    "E09": {"name": "thoughtful", "legacy": "thoughtful", "valence": 0.15, "arousal": 0.15},
    "E10": {"name": "overwhelmed", "legacy": "frustrated", "valence": -0.8, "arousal": 0.9},
    "E11": {"name": "discouraged", "legacy": "frustrated", "valence": -0.85, "arousal": 0.3},
    "E12": {"name": "relieved", "legacy": "satisfied", "valence": 0.7, "arousal": 0.2},
    "E13": {"name": "neutral", "legacy": "neutral", "valence": 0.0, "arousal": 0.0},
}

VALID_LEGACY_EMOTIONS = {entry["legacy"] for entry in EMOTION_CATALOG.values()} | {
    "satisfied"
}

NAME_TO_CODE = {entry["name"]: code for code, entry in EMOTION_CATALOG.items()}
LEGACY_TO_DEFAULT_CODE = {
    "confused": "E01",
    "curious": "E02",
    "frustrated": "E03",
    "anxious": "E04",
    "confident": "E06",
    "excited": "E07",
    "motivated": "E08",
    "thoughtful": "E09",
    "satisfied": "E12",
    "neutral": "E13",
}
INTENSITY_ALIASES = {
    "weak": "low",
    "mild": "low",
    "low": "low",
    "medium": "medium",
    "moderate": "medium",
    "mid": "medium",
    "high": "high",
    "strong": "high",
    "intense": "high",
}


def clamp_confidence(value: Any, default: float = 0.5) -> float:
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return default


def clamp_activation(value: Any, default: float = 0.0) -> float:
    try:
        return max(-1.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return default


def normalize_intensity(value: Optional[str], emotion_code: Optional[str] = None) -> str:
    if emotion_code == "E13":
        return "medium"

    if not value:
        return "medium"

    normalized = INTENSITY_ALIASES.get(str(value).strip().lower())
    return normalized if normalized in VALID_INTENSITIES else "medium"


def infer_emotion_code(
    code: Optional[str] = None,
    name: Optional[str] = None,
    legacy: Optional[str] = None,
) -> str:
    if code and code in EMOTION_CATALOG:
        return code

    if name:
        normalized_name = str(name).strip().lower()
        if normalized_name in NAME_TO_CODE:
            return NAME_TO_CODE[normalized_name]

    if legacy:
        normalized_legacy = str(legacy).strip().lower()
        if normalized_legacy in LEGACY_TO_DEFAULT_CODE:
            return LEGACY_TO_DEFAULT_CODE[normalized_legacy]

    return "E13"


def get_emotion_entry(code: str) -> Dict[str, Any]:
    return EMOTION_CATALOG.get(code, EMOTION_CATALOG["E13"])


def build_emotion_detail(
    code: Optional[str] = None,
    name: Optional[str] = None,
    legacy: Optional[str] = None,
    intensity: Optional[str] = None,
    confidence: Any = 0.5,
    arousal: Any = None,
    valence: Any = None,
    evidence: Optional[list[str]] = None,
) -> Dict[str, Any]:
    resolved_code = infer_emotion_code(code=code, name=name, legacy=legacy)
    entry = get_emotion_entry(resolved_code)

    resolved_intensity = normalize_intensity(intensity, emotion_code=resolved_code)
    resolved_confidence = clamp_confidence(confidence, default=0.5)
    resolved_arousal = clamp_activation(arousal, default=entry["arousal"])
    resolved_valence = clamp_activation(valence, default=entry["valence"])

    return {
        "code": resolved_code,
        "name": entry["name"],
        "intensity": resolved_intensity,
        "legacyEmotion": entry["legacy"],
        "confidence": resolved_confidence,
        "arousal": resolved_arousal,
        "valence": resolved_valence,
        "evidence": evidence or [],
    }
