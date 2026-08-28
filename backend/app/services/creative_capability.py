"""创意运行器能力契约（后端侧）。

这是给教学智能体看的那份「沙箱里到底有什么」。它必须与前端注册表
``frontend/data/creativeCapabilities.ts`` 保持一致：两边漂移会直接导致
Agent 建议出沙箱里不存在的名称或字段，形成「能讨论、不能运行」的代码。
``tests/test_creative_capability_contract.py`` 会读取前端注册表做防漂移比对。

这里只描述**公开**能力。教师隐藏测试、蓝图同义词和标准答案不在此列，
也不得通过这段文字下发；能力协议本身可以公开，因为学生必须据此编程。
"""

CREATIVE_CAPABILITY_VERSION = "creative-v2"

# 学生可见的七个事件名（event.type）
CREATIVE_EVENT_TYPES: tuple[str, ...] = (
    "start",
    "key",
    "before_move",
    "move",
    "eat",
    "loop",
    "end",
)

# 允许写入的顶层状态字段。写入其它字段会被运行器拒绝。
CREATIVE_STATE_KEYS: tuple[str, ...] = (
    "snake",
    "direction",
    "food",
    "score",
    "game_over",
    "interval",
    "objects",
    "timers",
)

# 注入沙箱、无需 import 的确定性帮助函数
CREATIVE_HELPERS: tuple[tuple[str, str], ...] = (
    ("randint(min_value, max_value)", "返回闭区间内的整数"),
    ("choice(items)", "从非空列表中取一项"),
    ("random_empty_cell(state)", "返回空闲格子 [x, y]，避开蛇身、食物、实心对象和边界；没有空位返回 None"),
    ("add_object(state, object_spec)", "新增场景对象；超出上限或字段非法时返回 None 且不写入"),
    ("remove_object(state, object_id)", "按 id 删除对象，返回是否成功"),
    ("move_object(state, object_id, position)", "把对象移到棋盘内的新坐标，返回是否成功"),
    ("find_objects(state, object_type=None)", "返回对象列表，可按 type 过滤"),
    ("set_timer(state, timer_id, ticks)", "设置按帧倒数的计时器，平台每帧减一"),
    ("timer_ready(state, timer_id)", "计时器是否已数到 0"),
)

# 沙箱开放的安全内置函数。**没有** isinstance/type/dir 等反射入口。
CREATIVE_SAFE_BUILTINS: tuple[str, ...] = (
    "abs", "all", "any", "bool", "dict", "enumerate", "float", "int", "len",
    "list", "max", "min", "print", "range", "reversed", "round", "set", "sorted",
    "str", "sum", "tuple", "zip",
)

# 当前明确不支持的能力，必须如实说明而不是编造 API
CREATIVE_CAPABILITY_GAPS_ZH = "联网、读写文件、安装第三方库、图片上传、音频、DOM/JavaScript、3D 和实时多人"
CREATIVE_CAPABILITY_GAPS_EN = (
    "network access, file I/O, third-party packages, image upload, audio, DOM/JavaScript, 3D and realtime multiplayer"
)

_HELPER_LINES_ZH = "；".join(signature for signature, _ in CREATIVE_HELPERS)


def creative_contract_zh() -> str:
    """给中文 Prompt 用的创意运行器契约。"""

    return (
        f"这是创意函数（能力协议 {CREATIVE_CAPABILITY_VERSION}）。学生代码必须写在 creative_feature(event, state) 内。\n"
        f"event.type 取值：{'、'.join(CREATIVE_EVENT_TYPES)}；event.hook 保留内部钩子名。"
        "state 中的坐标是 [3, 5] 这样的 JSON 列表，不是 (3, 5) 元组；snake 是这些坐标组成的数组。\n"
        f"顶层状态**只有**这些字段可写：{'、'.join(CREATIVE_STATE_KEYS)}。"
        "写入任何其它顶层字段（例如自造的 bomb_count、timer、level）都会被运行器拒绝并报 "
        "CREATIVE_UNSUPPORTED_STATE，代码永远不会生效——需要计数或倒计时必须用 set_timer/timer_ready，"
        "需要额外数据请挂在对象的 data 里。\n"
        f"沙箱注入了这些帮助函数，无需 import 直接调用：{_HELPER_LINES_ZH}。"
        "随机由平台种子驱动，同一 seed 与同一事件序列结果可复现。\n"
        f"可用的内置函数只有：{'、'.join(CREATIVE_SAFE_BUILTINS)}。"
        "没有 isinstance、type、getattr 等反射入口，也禁止 import、文件、网络和动态执行。\n"
        "objects 最多 48 个，字段为 id、type、position [x,y]，可选 label（最多 4 字）、solid、active、data，"
        "以及表现字段 shape（rect/circle/line/text）、size、color（#rrggbb 或具名色）、strokeColor、opacity、"
        "rotation、zIndex、animation（none/pulse/blink/spin）。type 可以自定义，未知类型也能按 shape/color/label 绘制。\n"
        "**平台不会自动生成任何创意对象**：如果学生的功能要对某个对象做出反应，必须先由学生代码在 start 或其它事件里用 "
        "add_object 把它放进画面，否则相关分支永远不会执行。\n"
        "创意测试会在七个事件上各跑一遍，起始画面里没有任何自定义对象；"
        "纯 print 诊断可以运行，但不会通过要求产生可观察状态变化的启用检查。\n"
        f"当前不支持：{CREATIVE_CAPABILITY_GAPS_ZH}。遇到这类想法要如实说明是能力缺口，并给出可在本沙箱实现的近似方案，"
        "不得编造沙箱里不存在的 API。"
    )


def creative_contract_en() -> str:
    """English variant of the same contract."""

    helpers = "; ".join(signature for signature, _ in CREATIVE_HELPERS)
    return (
        f"This is a creative function (capability protocol {CREATIVE_CAPABILITY_VERSION}). "
        "Student code must stay inside creative_feature(event, state).\n"
        f"event.type is one of: {', '.join(CREATIVE_EVENT_TYPES)}; event.hook keeps the internal hook name. "
        "Coordinates in state are JSON arrays such as [3, 5], not Python tuples.\n"
        f"Only these top-level state fields are writable: {', '.join(CREATIVE_STATE_KEYS)}. "
        "Writing any other top-level field (an invented bomb_count, timer, level, ...) is rejected with "
        "CREATIVE_UNSUPPORTED_STATE and the code can never take effect — use set_timer/timer_ready for counters "
        "and an object's data dict for extra values.\n"
        f"These helpers are injected into the sandbox and need no import: {helpers}. "
        "Randomness is seeded by the platform, so the same seed and event sequence reproduce the same result.\n"
        f"The only builtins available are: {', '.join(CREATIVE_SAFE_BUILTINS)}. "
        "There is no isinstance/type/getattr, and imports, files, network and dynamic execution are blocked.\n"
        "objects holds at most 48 dictionaries with id, type, position [x,y], optional label (max 4 chars), solid, "
        "active, data, plus presentation fields shape (rect/circle/line/text), size, color (#rrggbb or a named color), "
        "strokeColor, opacity, rotation, zIndex and animation (none/pulse/blink/spin). Unknown types still render from "
        "shape/color/label.\n"
        "**The platform never spawns creative objects.** If a feature reacts to an object, the student's own code must "
        "create it first with add_object, otherwise that branch never runs.\n"
        "Creative tests run the card once per event across all seven events, starting from a board with no custom "
        "objects. A print-only diagnostic runs but does not pass the enable gate, which requires an observable change.\n"
        f"Not supported: {CREATIVE_CAPABILITY_GAPS_EN}. Say so honestly when an idea needs one of these, offer an "
        "approximation that this sandbox can actually run, and never invent a sandbox API."
    )
