/**
 * 创意运行器能力注册表（Creative Capability API V2）。
 *
 * 这是「学生可以在创意函数里用什么」的唯一事实来源：事件、可写状态、
 * 注入沙箱的帮助函数和场景对象 Schema。运行器、主线程校验、渲染器和
 * 后续的 Agent 提案校验都从这里读取，避免同一份契约在多处各写一遍后漂移。
 *
 * 兼容原则（V1 → V2）：
 * - 函数签名不变，仍是 `creative_feature(event, state)`；
 * - 七个事件名不变；
 * - V1 的七个顶层状态字段不变，V2 只**新增** `timers`；
 * - 场景对象的 V1 字段（id/type/position/label/solid/active/data）不变，
 *   V2 只新增可选的表现字段。旧卡不写新字段时，渲染结果与 V1 一致。
 *
 * 这里描述的是能力边界，不是承诺任意 Python：目标是覆盖大多数二维网格
 * 游戏机制，联网、图片上传、3D 和实时多人仍属于能力缺口。
 */

/** 能力协议版本。进入测试与研究证据，便于分析学生代码写于哪一版契约。 */
export const CREATIVE_CAPABILITY_VERSION = 'creative-v2';

/** 运行器实现版本。协议不变但执行语义调整时递增。 */
export const CREATIVE_RUNTIME_VERSION = 'creative-runtime-2';

/** V1 已公开的七个事件，顺序即一帧内的触发顺序参考。 */
export const CREATIVE_EVENT_TYPES = [
  'start',
  'key',
  'before_move',
  'move',
  'eat',
  'loop',
  'end',
] as const;

export type CreativeEventType = typeof CREATIVE_EVENT_TYPES[number];

/**
 * 代码执行前即可确定的契约错误。
 *
 * 这两类错误不能依赖样例棋盘是否刚好走到对应分支，否则测试会给出假绿勾。
 */
export const CREATIVE_PREFLIGHT_RESULT_CODES = [
  'CREATIVE_UNSUPPORTED_STATE',
  'CREATIVE_UNKNOWN_EVENT',
] as const;

/** 内部钩子名 → 学生可见事件名。两边都要保持稳定：历史卡按 hook 存储。 */
export const CREATIVE_HOOK_EVENT_TYPES = {
  game_start: 'start',
  key_input: 'key',
  before_move: 'before_move',
  after_move: 'move',
  food_eaten: 'eat',
  loop: 'loop',
  game_end: 'end',
} as const satisfies Record<string, CreativeEventType>;

/** V1 允许学生修改的顶层状态字段。**不得删减**，否则历史卡会被判非法。 */
export const CREATIVE_STATE_KEYS_V1 = [
  'snake',
  'direction',
  'food',
  'score',
  'game_over',
  'interval',
  'objects',
] as const;

/** V2 新增字段。只增不减；新增字段必须同时给出主线程校验和上限。 */
export const CREATIVE_STATE_KEYS_V2_ADDED = ['timers'] as const;

export const CREATIVE_STATE_KEYS = [
  ...CREATIVE_STATE_KEYS_V1,
  ...CREATIVE_STATE_KEYS_V2_ADDED,
] as const;

export type CreativeStateKey = typeof CREATIVE_STATE_KEYS[number];

export interface CreativeHelperSpec {
  /** 沙箱中的函数名，学生无需 import 即可调用 */
  name: string;
  signature: string;
  summaryZh: string;
  summaryEn: string;
  /** 该帮助函数会读取的顶层状态字段 */
  reads: CreativeStateKey[];
  /** 该帮助函数会写入的顶层状态字段；纯查询为空数组 */
  writes: CreativeStateKey[];
  /** 是否消耗确定性随机序列。同一 seed 下调用顺序相同则结果相同。 */
  usesRandom: boolean;
}

/**
 * 第一批注入沙箱的确定性帮助函数。
 *
 * 全部在 Python 沙箱内部实现并列入白名单：不依赖 `import random`、文件或网络。
 * 随机相关函数使用平台注入的种子，同一代码 + 初始状态 + 事件序列 + 种子
 * 必然得到同一结果，便于复现学生的运行证据。
 */
export const CREATIVE_HELPERS: CreativeHelperSpec[] = [
  {
    name: 'randint',
    signature: 'randint(min_value, max_value)',
    summaryZh: '返回 min_value 到 max_value 之间的整数，包含两端。',
    summaryEn: 'Return an integer between min_value and max_value, inclusive.',
    reads: [],
    writes: [],
    usesRandom: true,
  },
  {
    name: 'choice',
    signature: 'choice(items)',
    summaryZh: '从非空列表中取一项。',
    summaryEn: 'Pick one item from a non-empty list.',
    reads: [],
    writes: [],
    usesRandom: true,
  },
  {
    name: 'random_empty_cell',
    signature: 'random_empty_cell(state)',
    summaryZh: '返回一个空闲格子 [x, y]，避开蛇身、食物、实心对象和棋盘边界；没有空位时返回 None。',
    summaryEn: 'Return an empty cell [x, y] avoiding the snake, food, solid objects and the board edge; None when the board is full.',
    reads: ['snake', 'food', 'objects'],
    writes: [],
    usesRandom: true,
  },
  {
    name: 'add_object',
    signature: 'add_object(state, object_spec)',
    summaryZh: '按场景对象协议新增一个对象；超过上限或字段非法时返回 None，不写入状态。',
    summaryEn: 'Add one scene object; returns None without writing when the limit is exceeded or a field is invalid.',
    reads: ['objects'],
    writes: ['objects'],
    usesRandom: false,
  },
  {
    name: 'remove_object',
    signature: 'remove_object(state, object_id)',
    summaryZh: '按 id 删除对象，返回是否删除成功。',
    summaryEn: 'Remove an object by id and report whether it existed.',
    reads: ['objects'],
    writes: ['objects'],
    usesRandom: false,
  },
  {
    name: 'move_object',
    signature: 'move_object(state, object_id, position)',
    summaryZh: '把对象移动到棋盘内的新坐标，返回是否移动成功。',
    summaryEn: 'Move an object to a new in-board position and report success.',
    reads: ['objects'],
    writes: ['objects'],
    usesRandom: false,
  },
  {
    name: 'find_objects',
    signature: 'find_objects(state, object_type=None)',
    summaryZh: '返回对象列表；给出 object_type 时只返回该类型。',
    summaryEn: 'Return objects, optionally filtered by object_type.',
    reads: ['objects'],
    writes: [],
    usesRandom: false,
  },
  {
    name: 'set_timer',
    signature: 'set_timer(state, timer_id, ticks)',
    summaryZh: '设置一个按帧倒数的计时器；平台在每个游戏帧减一。',
    summaryEn: 'Set a timer counted down by one per game tick.',
    reads: ['timers'],
    writes: ['timers'],
    usesRandom: false,
  },
  {
    name: 'timer_ready',
    signature: 'timer_ready(state, timer_id)',
    summaryZh: '计时器是否已经数到 0；不存在的计时器返回 False。',
    summaryEn: 'Whether a timer has reached zero; unknown timers return False.',
    reads: ['timers'],
    writes: [],
    usesRandom: false,
  },
];

export const CREATIVE_HELPER_NAMES = CREATIVE_HELPERS.map(helper => helper.name);

/** 场景对象形状。未提供 shape 的旧对象继续按 type 的既有样式绘制。 */
export const SCENE_SHAPES = ['rect', 'circle', 'line', 'text'] as const;
export type SceneShape = typeof SCENE_SHAPES[number];

/** 受控动画。只有这四种，避免学生代码造成持续重绘。 */
export const SCENE_ANIMATIONS = ['none', 'pulse', 'blink', 'spin'] as const;
export type SceneAnimation = typeof SCENE_ANIMATIONS[number];

/**
 * 通用场景对象（V2）。
 *
 * V1 字段保持必选/可选关系不变；新增字段一律可选，缺省时按 V1 表现绘制。
 * Python 只描述状态，不提交 HTML/CSS/JS/DOM 选择器或绘制代码。
 */
export interface SceneObjectV2 {
  id: string;
  type: string;
  position: number[];
  shape?: SceneShape;
  size?: number[];
  color?: string;
  strokeColor?: string;
  opacity?: number;
  rotation?: number;
  label?: string;
  zIndex?: number;
  solid?: boolean;
  active?: boolean;
  animation?: SceneAnimation;
  data?: Record<string, string | number | boolean>;
}

/**
 * 运行期硬上限。
 *
 * 这些数字同时是安全边界和性能边界：主线程按它们校验 Worker 返回值，
 * 渲染器按它们限制每帧 DOM 数量。放宽任何一项都需要重新评估低配置电脑表现。
 */
export const SCENE_LIMITS = {
  /** 棋盘为固定 12×12，对象坐标必须落在其中 */
  boardSize: 12,
  maxObjects: 48,
  /** 单个格子最多绘制的对象数，超出部分不渲染但仍保留在状态里 */
  maxObjectsPerCell: 2,
  maxLabelChars: 4,
  maxIdChars: 48,
  maxDataEntries: 12,
  maxDataStringChars: 80,
  minOpacity: 0.1,
  maxOpacity: 1,
  minRotation: -360,
  maxRotation: 360,
  minZIndex: 0,
  maxZIndex: 9,
  /** size 为格子倍数，允许跨格但不允许铺满整块棋盘 */
  minSize: 0.2,
  maxSize: 4,
  maxTimers: 16,
  maxTimerTicks: 100_000,
  minInterval: 0.08,
  maxInterval: 2,
  maxSnakeLength: 400,
  maxScore: 1_000_000,
} as const;

/** 对象 type 命名规则：只允许小写标识符，避免注入到 class 名里。 */
export const SCENE_TYPE_PATTERN = /^[a-z0-9_-]{1,24}$/;

/** data 键名规则，与 V1 一致（不收紧：收紧会让历史卡的对象数据被判非法）。 */
export const SCENE_DATA_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;

/**
 * 计时器 ID 规则。
 *
 * `timers` 是 V2 新增面，没有历史数据，因此直接采用更严的规则：
 * 排除以双下划线开头的名字。计时器 ID 会成为 JS 对象的键，
 * `__proto__` 这类名字在按键赋值构造时会触发原型污染。
 */
export const TIMER_ID_PATTERN = /^(?!__)[A-Za-z0-9_-]{1,32}$/;

/**
 * 允许的颜色写法：`#rgb`、`#rrggbb` 或注册表中的具名颜色。
 *
 * 刻意不接受 `rgb()`、`hsl()`、`var()` 和 `url()`：它们能承载
 * 表达式或外部资源引用，而学生并不需要它们来表达二维网格机制。
 */
export const SCENE_NAMED_COLORS = [
  'lime', 'amber', 'clay', 'sage', 'ink', 'paper', 'cyan', 'violet', 'rose', 'slate',
] as const;
export type SceneNamedColor = typeof SCENE_NAMED_COLORS[number];

const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const isSafeSceneColor = (value: unknown): value is string => (
  typeof value === 'string'
  && (HEX_COLOR_PATTERN.test(value) || (SCENE_NAMED_COLORS as readonly string[]).includes(value))
);

/** 具名颜色到实际色值的映射，渲染器与测试共用。 */
export const SCENE_NAMED_COLOR_VALUES: Record<SceneNamedColor, string> = {
  lime: '#bdf52f',
  amber: '#e7a72d',
  clay: '#c8765e',
  sage: '#8ea944',
  ink: '#161713',
  paper: '#f3f0e8',
  cyan: '#78dce8',
  violet: '#a97fd0',
  rose: '#e0698b',
  slate: '#6d7169',
};

export const resolveSceneColor = (value: string): string => (
  (SCENE_NAMED_COLOR_VALUES as Record<string, string>)[value] ?? value
);

/**
 * 当前明确不支持的能力。Agent 必须如实说明缺口，而不是编造沙箱 API。
 */
export const CREATIVE_CAPABILITY_GAPS = [
  'network',
  'file-system',
  'image-upload',
  'audio',
  'third-party-packages',
  'dom-or-javascript',
  '3d',
  'realtime-multiplayer',
] as const;
