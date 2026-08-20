"""项目解构式学习的 L0-L3 阶段支架规则与研究元数据。"""

from __future__ import annotations

import hashlib
from typing import Any

from app.schemas.chat import ProjectScaffoldContext
from app.schemas.project_blueprint import BlueprintScaffoldPolicy
from app.schemas.profile import UserProfile


STAGE_GOALS = {
    "observe": "依据运行证据描述可观察变化，不急于解释原因",
    "decompose": "从观察现象推断程序职责，并形成输入、处理、输出与验证约定",
    "model": "围绕一张功能卡表达内部处理、判断、分支与结果",
    "plan": "根据功能间数据和前置关系形成可执行而非唯一的实现路径",
    "build": "结合当前模块代码和测试反馈定位最小问题，修改后重新运行与解释",
}

LEVEL_RULES = {
    0: "L0 情境澄清：只帮助聚焦现象、目标、边界或当前卡点；不得透露概念答案、步骤或代码。结尾只问一个可操作的检查问题。",
    1: "L1 概念提示：指出一个相关概念、变量或原理，并解释它与当前问题的关系；不得给出完整步骤或代码。",
    2: "L2 策略提示：提供2至4个局部步骤、检查顺序或伪代码框架；关键条件、表达式和变量仍由学生完成。",
    3: "L3 最小补全：只补足阻塞推进的一个局部判断、表达式、连线建议或短代码片段；禁止给出完整模块或整套项目答案，并要求学生重新运行、解释或修改。",
}


def resolve_scaffold_rule(
    context: ProjectScaffoldContext,
    policy: BlueprintScaffoldPolicy | None = None,
) -> dict[str, Any]:
    """合并通用 L0–L3 边界与学生所绑定蓝图的阶段策略。

    蓝图可以缩小帮助边界，但不能放宽通用规则；建构阶段超过
    ``coreImplementationMaxLevel`` 的请求会被显式记录为降级，不会伪装成学生未请求。
    """

    requested_level = context.level
    applied_level = requested_level
    configured = None
    require_attempt = True
    max_implementation_level = 3

    if policy:
        require_attempt = policy.requireAttemptBeforeUpgrade
        max_implementation_level = policy.coreImplementationMaxLevel
        if context.stage == "build":
            applied_level = min(requested_level, max_implementation_level)
        configured = next(
            (
                item
                for item in policy.stageLevels.get(context.stage, [])
                if item.level == applied_level
            ),
            None,
        )

    return {
        "requestedLevel": requested_level,
        "appliedLevel": applied_level,
        "wasClamped": applied_level != requested_level,
        "goalZh": configured.goalZh if configured else STAGE_GOALS[context.stage],
        "allowedHelpZh": configured.allowedHelpZh if configured else LEVEL_RULES[applied_level],
        "maxCodeLines": configured.maxCodeLines if configured else 0,
        "requireAttemptBeforeUpgrade": require_attempt,
        "coreImplementationMaxLevel": max_implementation_level,
        "source": "teacher_blueprint" if configured else "platform_default",
    }


def _safe_list(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def summarize_project_workspace(workspace: Any, max_chars: int = 4800) -> str:
    """把当前学生在指定任务中的完整工作区压缩为可供支架读取的事实摘要。"""

    if not isinstance(workspace, dict):
        return ""

    observations = _safe_list(workspace.get("observations"))
    functions = _safe_list(workspace.get("functions"))
    path = workspace.get("path") if isinstance(workspace.get("path"), dict) else {}
    progress = workspace.get("progress") if isinstance(workspace.get("progress"), dict) else {}
    function_by_id = {
        str(item.get("id")): str(item.get("responsibility") or item.get("title") or item.get("id"))
        for item in functions
        if item.get("id")
    }

    lines = [
        f"数据库任务快照：观察卡 {len(observations)} 张，功能卡 {len(functions)} 张，模块记录 {len(progress)} 个。",
    ]
    if workspace.get("savedAt"):
        lines.append(f"最近同步：{workspace['savedAt']}")

    if observations:
        lines.append("学生观察：")
        lines.extend(
            f"- {item.get('observationText', '')}"
            for item in observations[-8:]
            if item.get("observationText")
        )

    if functions:
        lines.append("学生功能卡：")
        for item in functions[-10:]:
            responsibility = item.get("responsibility") or item.get("title") or "未命名功能"
            knowledge = item.get("knowledge") if isinstance(item.get("knowledge"), list) else []
            lines.append(
                f"- {responsibility}｜输入 {item.get('input') or '未填'}｜输出 {item.get('output') or '未填'}"
                f"｜知识 {'、'.join(map(str, knowledge)) or '未填'}｜验证 {item.get('verification') or '未填'}"
            )

    mechanisms = path.get("functionMechanisms") if isinstance(path.get("functionMechanisms"), dict) else {}
    if mechanisms:
        lines.append("功能内部流程：")
        for card_id, mechanism in list(mechanisms.items())[-10:]:
            if not isinstance(mechanism, dict):
                continue
            nodes = _safe_list(mechanism.get("flowNodes"))
            edges = _safe_list(mechanism.get("diagramEdges"))
            labels = [str(node.get("label")) for node in nodes if node.get("label")]
            lines.append(
                f"- {function_by_id.get(str(card_id), str(card_id))}："
                f"{' → '.join(labels[:8]) or '尚未放置节点'}；连线 {len(edges)} 条"
            )

    ordered_ids = path.get("orderedCardIds") if isinstance(path.get("orderedCardIds"), list) else []
    prerequisites = path.get("prerequisites") if isinstance(path.get("prerequisites"), dict) else {}
    relation_count = sum(len(ids) for ids in prerequisites.values() if isinstance(ids, list))
    if ordered_ids or relation_count:
        ordered_names = [function_by_id.get(str(card_id), str(card_id)) for card_id in ordered_ids]
        lines.append(f"项目实现路径：{' → '.join(ordered_names) or '尚未排序'}；前置关系 {relation_count} 条。")

    if progress:
        lines.append("模块建构进度：")
        for card_id, item in list(progress.items())[-10:]:
            if not isinstance(item, dict):
                continue
            attempts = _safe_list(item.get("testAttempts"))
            latest = attempts[-1] if attempts else None
            latest_result = (
                f"，最近测试 {'通过' if latest.get('passed') else '未通过'}({latest.get('resultCode', '无代码')})"
                if latest else "，尚无测试记录"
            )
            lines.append(
                f"- {function_by_id.get(str(card_id), str(card_id))}："
                f"{'已验证' if item.get('verified') else '未验证'}{latest_result}"
            )

    return "\n".join(lines)[:max_chars]


def _band(value: int) -> str:
    if value <= 35:
        return "low"
    if value <= 70:
        return "medium"
    return "high"


def build_profile_adaptation(profile: UserProfile) -> dict[str, str]:
    """画像只调节表达颗粒度与节奏，不自动改变支架等级。"""

    cognition = _band(profile.cognition)
    affect = _band(profile.affect)
    behavior = _band(profile.behavior)
    cognition_instruction = {
        "low": "使用具体变量、画面现象和短句，避免连续抽象术语",
        "medium": "在具体例子和概念解释之间保持平衡",
        "high": "允许用概念和反例追问，但不要跨越当前支架等级",
    }[cognition]
    affect_instruction = {
        "low": "先承认已经完成的有效尝试，再给一个低压力的小步",
        "medium": "保持中性、耐心，避免空泛鼓励",
        "high": "可以用适度挑战性问题促进自我解释",
    }[affect]
    behavior_instruction = {
        "low": "每轮只给一个动作，并明确完成后如何验证",
        "medium": "给出简短有序的检查路径",
        "high": "保留选择空间，优先要求学生说明自己的判断",
    }[behavior]
    return {
        "cognitionBand": cognition,
        "affectBand": affect,
        "behaviorBand": behavior,
        "cognitionInstruction": cognition_instruction,
        "affectInstruction": affect_instruction,
        "behaviorInstruction": behavior_instruction,
    }


def build_scaffold_prompt(
    context: ProjectScaffoldContext,
    profile: UserProfile,
    language: str = "zh",
    policy: BlueprintScaffoldPolicy | None = None,
) -> str:
    adaptation = build_profile_adaptation(profile)
    resolved = resolve_scaffold_rule(context, policy)
    applied_level = resolved["appliedLevel"]
    stage_goal = resolved["goalZh"]
    level_rule = LEVEL_RULES[applied_level]
    teacher_boundary = resolved["allowedHelpZh"]
    code_limit = resolved["maxCodeLines"] or 0
    upgrade_rule = (
        "Before increasing specificity, require evidence of the student's own modification, explanation, or verification attempt."
        if resolved["requireAttemptBeforeUpgrade"]
        else "An earlier attempt is recommended but is not a mandatory gate for this task."
    )
    artifact = context.artifactSummary or "学生尚未形成可读取的阶段产物，请先帮助其说清当前尝试。"

    if language == "en":
        return f"""

COGNISYNC_SCAFFOLD_MODE
You are supporting a project-deconstruction programming task. The student is at stage `{context.stage}` and explicitly requested level L{context.level}. The applied teacher-policy boundary is L{applied_level}. Never change levels on your own; only an explicit teacher-policy limit may restrict the request, and that distinction must not be hidden.
Stage goal: {stage_goal}
Universal level boundary: {level_rule}
Teacher blueprint boundary: {teacher_boundary}
Maximum code lines allowed in this turn: {code_limit}. Zero means no generated code.
Upgrade rule: {upgrade_rule}
Current artifact summary: {artifact}
Current module: {context.currentModule or "none"}
Latest test feedback: {context.testFeedback or "none"}
Profile adaptation: {adaptation['cognitionInstruction']}; {adaptation['affectInstruction']}; {adaptation['behaviorInstruction']}.
The profile may change wording and step size only. It must not be treated as ability ranking and must not change the requested L0-L3 boundary.
Reply in natural conversation without headings. Give one focused suggestion and end with one concrete action or check. Stay under 120 words.
"""

    return f"""

COGNISYNC_SCAFFOLD_MODE
你正在支持“项目解构式编程学习”。学生当前位于【{context.stage}】阶段，本轮明确请求 L{context.level}，教师蓝图实际允许到 L{applied_level}。除教师蓝图的明确限制外，不得擅自升降等级；如请求被限制，不得隐瞒这一差异。
阶段目标：{stage_goal}。
通用等级边界：{level_rule}
教师蓝图边界：{teacher_boundary}
本轮最多允许补全代码 {code_limit} 行；0 表示不允许生成代码。
支架升级规则：{'升级前必须先核对学生自己的修改、解释或验证证据。' if resolved['requireAttemptBeforeUpgrade'] else '本任务建议先尝试，但不将尝试作为强制门槛。'}
当前阶段产物摘要：{artifact}
当前实现模块：{context.currentModule or '无'}
最近测试反馈：{context.testFeedback or '无'}
画像适配方式：{adaptation['cognitionInstruction']}；{adaptation['affectInstruction']}；{adaptation['behaviorInstruction']}。
学生画像只能改变表达方式、支架颗粒度和互动节奏，不能被解释为能力排名，也不能突破本轮 L0-L3 边界。
请用自然对话回复，不写标题，不堆砌鼓励。只处理当前一个卡点，结尾给一个学生马上可以完成的动作或检查。控制在180字以内。
"""


def build_scaffold_metadata(
    context: ProjectScaffoldContext,
    profile: UserProfile,
    current_code: str | None,
    policy: BlueprintScaffoldPolicy | None = None,
    blueprint_version_id: str | None = None,
) -> dict[str, Any]:
    adaptation = build_profile_adaptation(profile)
    resolved = resolve_scaffold_rule(context, policy)
    code = current_code or ""
    return {
        **context.model_dump(),
        "requestedLevel": resolved["requestedLevel"],
        "level": resolved["appliedLevel"],
        "levelLabel": f"L{resolved['appliedLevel']}",
        "levelRule": LEVEL_RULES[resolved["appliedLevel"]],
        "policyGoal": resolved["goalZh"],
        "policyAllowedHelp": resolved["allowedHelpZh"],
        "policyMaxCodeLines": resolved["maxCodeLines"],
        "policySource": resolved["source"],
        "policyWasClamped": resolved["wasClamped"],
        # 封顶值本身也要留痕：只知道"被降级了"，无法回答"降到几、上限是多少"，
        # 而这正是分析教师策略强度与学生求助行为关系时要用的量。
        "coreImplementationMaxLevel": resolved["coreImplementationMaxLevel"],
        "requireAttemptBeforeUpgrade": resolved["requireAttemptBeforeUpgrade"],
        "blueprintVersionId": blueprint_version_id,
        "profileSnapshot": {
            "cognition": profile.cognition,
            "affect": profile.affect,
            "behavior": profile.behavior,
        },
        "profileAdaptation": adaptation,
        "codeLength": len(code),
        "codeFingerprint": hashlib.sha256(code.encode("utf-8")).hexdigest()[:16] if code else None,
    }
