from app.services.emotion_compare_mapping import (
    build_default_label_mapping,
    get_dataset_family_entries,
    get_label_mapping_entry,
)


def test_default_label_mapping_contains_weibo_and_goemotions_aliases():
    mapping = build_default_label_mapping()

    assert "happy" in mapping
    assert "excited" in mapping["happy"]
    assert "confusion" in mapping
    assert "confused" in mapping["confusion"]
    assert "neutral" in mapping
    assert "e13" in mapping["neutral"]


def test_get_label_mapping_entry_returns_normalized_definition():
    entry = get_label_mapping_entry("joy")

    assert entry is not None
    assert entry.dataset_family == "goemotions"
    assert entry.normalized_label == "excited"
    assert "motivated" in entry.acceptable_aliases


def test_get_dataset_family_entries_filters_by_family():
    weibo_entries = get_dataset_family_entries("weibo")
    goemotion_entries = get_dataset_family_entries("goemotions")

    assert any(entry.raw_label == "happy" for entry in weibo_entries)
    assert all(entry.dataset_family == "weibo" for entry in weibo_entries)
    assert any(entry.raw_label == "joy" for entry in goemotion_entries)
    assert all(entry.dataset_family == "goemotions" for entry in goemotion_entries)
