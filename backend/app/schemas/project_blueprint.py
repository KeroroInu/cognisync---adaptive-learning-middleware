"""教师项目蓝图的受约束数据结构。"""

from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, model_validator


BlueprintStage = Literal["observe", "decompose", "model", "plan", "build", "transfer"]
KnowledgeResponsibility = Literal["student_core", "ai_supported", "generated_process"]


class BlueprintPhenomenon(BaseModel):
    id: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")
    labelZh: str = Field(min_length=1, max_length=200)
    evidenceType: str = Field(min_length=1, max_length=80)
    required: bool = True
    descriptionZh: Optional[str] = Field(default=None, max_length=500)


class BlueprintKnowledgeItem(BaseModel):
    labelZh: str = Field(min_length=1, max_length=100)
    responsibility: KnowledgeResponsibility = "student_core"


class BlueprintContract(BaseModel):
    functionTemplate: str = Field(default="", max_length=1000)
    inputs: list[str] = Field(default_factory=list, max_length=20)
    outputs: list[str] = Field(default_factory=list, max_length=20)
    preconditions: list[str] = Field(default_factory=list, max_length=20)
    postconditions: list[str] = Field(default_factory=list, max_length=20)


class BlueprintTestCase(BaseModel):
    id: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")
    labelZh: str = Field(min_length=1, max_length=200)
    category: Literal["example", "edge", "rule"] = "example"
    inputData: Any = None
    expectedData: Any = None
    hidden: bool = True


class BlueprintNode(BaseModel):
    id: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")
    titleZh: str = Field(min_length=1, max_length=200)
    scenarioZh: str = Field(default="", max_length=500)
    required: bool = True
    synonyms: list[str] = Field(default_factory=list, max_length=30)
    contract: BlueprintContract = Field(default_factory=BlueprintContract)
    knowledge: list[BlueprintKnowledgeItem] = Field(default_factory=list, max_length=30)
    prerequisiteIds: list[str] = Field(default_factory=list, max_length=30)
    tests: list[BlueprintTestCase] = Field(default_factory=list, max_length=30)
    visualizationBehaviorKey: Optional[str] = Field(default=None, max_length=100)


class BlueprintAlternative(BaseModel):
    id: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")
    kind: Literal["split", "merge", "substitute"]
    nodeIds: list[str] = Field(min_length=1, max_length=20)
    descriptionZh: str = Field(min_length=1, max_length=500)


class BlueprintScaffoldLevel(BaseModel):
    level: int = Field(ge=0, le=3)
    goalZh: str = Field(min_length=1, max_length=300)
    allowedHelpZh: str = Field(min_length=1, max_length=1000)
    maxCodeLines: Optional[int] = Field(default=None, ge=0, le=100)


class BlueprintScaffoldPolicy(BaseModel):
    requireAttemptBeforeUpgrade: bool = True
    coreImplementationMaxLevel: int = Field(default=2, ge=0, le=3)
    stageLevels: dict[BlueprintStage, list[BlueprintScaffoldLevel]] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_unique_stage_levels(self) -> "BlueprintScaffoldPolicy":
        for stage, levels in self.stageLevels.items():
            values = [item.level for item in levels]
            if len(values) != len(set(values)):
                raise ValueError(f"Duplicate scaffold level in stage '{stage}'")
        return self


class ProjectBlueprintConfig(BaseModel):
    """可保存为草稿的完整教师蓝图。发布时执行更严格的关联校验。"""

    schemaVersion: Literal[1] = 1
    projectKey: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_-]+$")
    demoKey: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_-]+$")
    titleZh: str = Field(min_length=1, max_length=200)
    phenomena: list[BlueprintPhenomenon] = Field(default_factory=list, max_length=50)
    nodes: list[BlueprintNode] = Field(default_factory=list, max_length=80)
    alternatives: list[BlueprintAlternative] = Field(default_factory=list, max_length=50)
    scaffoldPolicy: BlueprintScaffoldPolicy = Field(default_factory=BlueprintScaffoldPolicy)

    @model_validator(mode="after")
    def validate_unique_ids(self) -> "ProjectBlueprintConfig":
        for label, values in (
            ("phenomenon", [item.id for item in self.phenomena]),
            ("node", [item.id for item in self.nodes]),
            ("alternative", [item.id for item in self.alternatives]),
        ):
            if len(values) != len(set(values)):
                raise ValueError(f"Duplicate {label} id")
        return self


def validate_blueprint_for_publish(config: ProjectBlueprintConfig) -> None:
    """草稿允许不完整；发布版本必须形成可引用且无悬空关系的蓝图。"""

    if not config.phenomena:
        raise ValueError("At least one observable phenomenon is required")
    if not config.nodes:
        raise ValueError("At least one blueprint node is required")

    node_ids = {node.id for node in config.nodes}
    for node in config.nodes:
        unknown = set(node.prerequisiteIds) - node_ids
        if unknown:
            raise ValueError(
                f"Node '{node.id}' references unknown prerequisites: {sorted(unknown)}"
            )
        if node.id in node.prerequisiteIds:
            raise ValueError(f"Node '{node.id}' cannot depend on itself")
        test_ids = [test.id for test in node.tests]
        if len(test_ids) != len(set(test_ids)):
            raise ValueError(f"Node '{node.id}' has duplicate test ids")

    # 发布版本必须是有向无环图，否则学生会遇到互相等待、永远无法解锁的模块。
    visit_state: dict[str, int] = {node.id: 0 for node in config.nodes}
    node_map = {node.id: node for node in config.nodes}
    visit_path: list[str] = []

    def visit(node_id: str) -> None:
        if visit_state[node_id] == 2:
            return
        if visit_state[node_id] == 1:
            cycle_start = visit_path.index(node_id)
            cycle = visit_path[cycle_start:] + [node_id]
            raise ValueError(f"Blueprint prerequisites contain a cycle: {' -> '.join(cycle)}")
        visit_state[node_id] = 1
        visit_path.append(node_id)
        for prerequisite_id in node_map[node_id].prerequisiteIds:
            visit(prerequisite_id)
        visit_path.pop()
        visit_state[node_id] = 2

    for node in config.nodes:
        visit(node.id)

    for alternative in config.alternatives:
        unknown = set(alternative.nodeIds) - node_ids
        if unknown:
            raise ValueError(
                f"Alternative '{alternative.id}' references unknown nodes: {sorted(unknown)}"
            )
