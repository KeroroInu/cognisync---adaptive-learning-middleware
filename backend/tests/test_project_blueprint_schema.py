import pytest
from pydantic import ValidationError

from app.schemas.project_blueprint import (
    ProjectBlueprintConfig,
    validate_blueprint_for_publish,
)


def blueprint_payload() -> dict:
    return {
        "schemaVersion": 1,
        "projectKey": "snake",
        "demoKey": "snake-v1",
        "titleZh": "贪吃蛇项目",
        "phenomena": [
            {
                "id": "movement-evidence",
                "labelZh": "蛇按方向移动",
                "evidenceType": "moved",
                "required": True,
            }
        ],
        "nodes": [
            {
                "id": "initial-state",
                "titleZh": "初始化状态",
                "contract": {
                    "functionTemplate": "def create_initial_state():",
                    "outputs": ["蛇身", "方向", "得分"],
                    "postconditions": ["蛇身至少包含一个坐标"],
                },
            },
            {
                "id": "movement",
                "titleZh": "更新蛇身位置",
                "prerequisiteIds": ["initial-state"],
                "synonyms": ["移动", "坐标更新"],
                "contract": {
                    "functionTemplate": "def move_snake(snake, direction):",
                    "inputs": ["蛇身", "方向"],
                    "outputs": ["新蛇身"],
                },
                "knowledge": [
                    {"labelZh": "列表添加和删除", "responsibility": "student_core"}
                ],
                "tests": [
                    {
                        "id": "move-right",
                        "labelZh": "向右移动一格",
                        "category": "example",
                        "inputData": {"snake": [[2, 2]], "direction": "right"},
                        "expectedData": [[3, 2]],
                        "hidden": True,
                    }
                ],
            },
        ],
        "alternatives": [
            {
                "id": "merge-loop-move",
                "kind": "merge",
                "nodeIds": ["movement"],
                "descriptionZh": "短任务中可把移动纳入单步循环。",
            }
        ],
        "scaffoldPolicy": {
            "requireAttemptBeforeUpgrade": True,
            "coreImplementationMaxLevel": 2,
            "stageLevels": {
                "decompose": [
                    {
                        "level": 0,
                        "goalZh": "先说清观察到的现象",
                        "allowedHelpZh": "只追问职责，不提供模块名",
                    }
                ]
            },
        },
    }


def test_publishable_blueprint_accepts_versioned_contracts():
    config = ProjectBlueprintConfig.model_validate(blueprint_payload())
    validate_blueprint_for_publish(config)
    assert config.nodes[1].prerequisiteIds == ["initial-state"]
    assert config.scaffoldPolicy.requireAttemptBeforeUpgrade is True


def test_blueprint_rejects_duplicate_node_ids():
    payload = blueprint_payload()
    payload["nodes"].append(dict(payload["nodes"][0]))
    with pytest.raises(ValidationError, match="Duplicate node id"):
        ProjectBlueprintConfig.model_validate(payload)


def test_publish_rejects_unknown_prerequisite():
    payload = blueprint_payload()
    payload["nodes"][1]["prerequisiteIds"] = ["missing-node"]
    config = ProjectBlueprintConfig.model_validate(payload)
    with pytest.raises(ValueError, match="unknown prerequisites"):
        validate_blueprint_for_publish(config)


def test_publish_rejects_cyclic_prerequisites():
    payload = blueprint_payload()
    payload["nodes"][0]["prerequisiteIds"] = ["movement"]
    config = ProjectBlueprintConfig.model_validate(payload)

    with pytest.raises(ValueError, match="contain a cycle"):
        validate_blueprint_for_publish(config)


def test_blueprint_rejects_duplicate_scaffold_levels_in_one_stage():
    payload = blueprint_payload()
    payload["scaffoldPolicy"]["stageLevels"]["decompose"].append(
        dict(payload["scaffoldPolicy"]["stageLevels"]["decompose"][0])
    )

    with pytest.raises(ValidationError, match="Duplicate scaffold level"):
        ProjectBlueprintConfig.model_validate(payload)
