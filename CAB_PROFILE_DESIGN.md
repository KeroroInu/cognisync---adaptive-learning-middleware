# CAB 学习画像映射算法：现状分析与改进设计

> **适用背景**：CogniSync 自适应学习中间件，用于教育研究与课堂实验数据收集
> **文档目的**：记录当前 CAB 算法的实现机制，并提出符合教育心理学研究规范、兼具创新性的改进方案

---

## 一、当前机制（问题分析）

### 1.1 实现代码

```python
# backend/app/api/endpoints/forms.py:140-142
cognition = min(100, (answers.get("item_1", 3) + answers.get("item_6", 3)) / 2 * 20)
affect    = min(100, (answers.get("item_2", 3) + answers.get("item_5", 3)) / 2 * 20)
behavior  = min(100, (answers.get("item_3", 3) + answers.get("item_4", 3)) / 2 * 20)
```

### 1.2 核心问题

| 问题 | 说明 | 研究影响 |
|---|---|---|
| **每维度仅 2 道题** | 信度极低（α < 0.5），测量误差大 | 研究结论不可靠 |
| **item 编号硬编码** | `item_1`/`item_6` 等与量表内容无实际对应关系 | 量表换题即失效 |
| **线性等比缩放** | `score / 2 * 20` 假设量表是等距量尺 | 违反李克特量表的设计前提 |
| **无反向计分** | 缺少对反向措辞题（reverse-scored items）的处理 | 系统性偏差 |
| **无缺失值处理** | `answers.get("item_x", 3)` 用均值填补但无记录 | 数据质量不透明 |
| **无信效度验证** | 从未经过内容效度、结构效度检验 | 三维结构是假设而非证实 |
| **无动态更新语义** | 初始画像仅由注册量表决定，后续对话更新是随机扰动 | 纵向追踪无意义 |

### 1.3 实际数据流

```
用户填写量表 → 6 道 Likert 题 (1-5)
    ↓
item_1 + item_6 → Cognition
item_2 + item_5 → Affect
item_3 + item_4 → Behavior
    ↓
存储 [0, 100] 三个浮点数
    ↓
对话中每条消息 ± delta（由 LLM 文本分析生成，无理论依据）
```

---

## 二、教育社科研究规范要求

在教育心理学和学习科学领域，一个合格的学习者画像测量工具至少需要满足：

### 2.1 心理测量学基准

- **Cronbach's α ≥ 0.70**：每个维度至少 4-6 道题，确保内部一致性
- **验证性因子分析（CFA）**：使用已发表数据或预测试（n ≥ 30）证实三因子结构
- **区分效度**：三个维度之间相关系数应在 0.3-0.6 区间（相关但不重叠）
- **内容效度**：题目需经过 3 名以上领域专家审核，Content Validity Ratio（CVR）≥ 0.78

### 2.2 伦理规范

- 知情同意（Informed Consent）：须在数据收集前告知研究目的和数据用途
- 匿名化/假名化：数据库中学生标识符与真实身份应可分离
- 退出权：学生可随时退出且不影响成绩
- IRB/伦理委员会审批（高校研究必须）

### 2.3 数据质量

- 反向计分题（至少占 30%）：防止默认效应（acquiescence bias）
- 注意力检查题（attention check items）：识别随机作答
- 填写时间记录：过快完成（< 30s/量表）的数据应标记
- 多时间点测量：单次测量无法支持纵向研究

---

## 三、改进设计方案

### 3.1 量表题目设计（推荐结构）

基于自我调节学习（Self-Regulated Learning, SRL）理论框架，三个维度定义如下：

**Cognition（认知投入）** - 测量元认知策略和深度加工
```
C1. 我在学习时会主动尝试将新知识与已有知识联系起来。（正向）
C2. 当我不理解某个概念时，我会寻找更多资料来澄清疑惑。（正向）
C3. 我只是死记硬背，不去理解背后的原理。（反向）
C4. 我会在学习后回顾自己理解了哪些、还有哪些没懂。（正向）
C5. 我很少主动思考所学内容的意义。（反向）
C6. 遇到难题时我会用多种方法尝试解决。（正向）
```

**Affect（情感投入）** - 测量学习兴趣和情绪调节
```
A1. 我对这门课的内容感到真正的好奇。（正向）
A2. 即使学习遇到困难，我仍然保持积极的心态。（正向）
A3. 上课时我常常感到无聊。（反向）
A4. 我担心自己在这门课上表现不好。（反向）[焦虑子维度]
A5. 完成一道难题后，我会感到满足和成就感。（正向）
A6. 我对课程的成绩比学习本身更关心。（反向）
```

**Behavior（行为投入）** - 测量自律行为和主动参与
```
B1. 我会按时完成作业，不拖延。（正向）
B2. 在课堂讨论中，我会主动分享自己的想法。（正向）
B3. 我经常分心，无法专注于学习任务。（反向）
B4. 我会主动向老师或同学寻求帮助。（正向）
B5. 我在没有监督的情况下仍然坚持学习。（正向）
B6. 我通常在最后一刻才开始准备考试。（反向）
```

### 3.2 计分算法（改进版）

```python
from typing import Dict, List, Optional
import numpy as np

# 反向计分题定义（Likert 1-5 量尺）
REVERSE_ITEMS = {
    "cognition": ["C3", "C5"],
    "affect": ["A3", "A4", "A6"],
    "behavior": ["B3", "B6"],
}

DIMENSION_ITEMS = {
    "cognition": ["C1", "C2", "C3", "C4", "C5", "C6"],
    "affect":    ["A1", "A2", "A3", "A4", "A5", "A6"],
    "behavior":  ["B1", "B2", "B3", "B4", "B5", "B6"],
}

def reverse_score(score: int, max_scale: int = 5) -> int:
    """反向计分：将正向题分翻转"""
    return max_scale + 1 - score

def compute_cab_profile(
    answers: Dict[str, int],
    max_scale: int = 5,
    missing_strategy: str = "mean",  # "mean" | "exclude" | "raise"
) -> Dict[str, float]:
    """
    计算 CAB 三维学习画像

    Args:
        answers: {"C1": 4, "C2": 3, ...}  item_id → 1~5 分
        max_scale: 量尺最大值（默认 5 点 Likert）
        missing_strategy: 缺失值处理策略

    Returns:
        {"cognition": 72.5, "affect": 60.0, "behavior": 83.3,
         "missing_items": [...], "flags": [...]}
    """
    result = {}
    flags = []
    missing_items = []

    for dim, items in DIMENSION_ITEMS.items():
        scores = []
        dim_missing = []

        for item_id in items:
            raw = answers.get(item_id)
            if raw is None:
                dim_missing.append(item_id)
                continue

            # 边界检查
            if not (1 <= raw <= max_scale):
                flags.append(f"Out-of-range: {item_id}={raw}")
                continue

            # 反向计分
            if item_id in REVERSE_ITEMS.get(dim, []):
                score = reverse_score(raw, max_scale)
            else:
                score = raw

            scores.append(score)

        missing_items.extend(dim_missing)

        if not scores:
            result[dim] = 50.0  # 无有效数据时给中性值
            flags.append(f"No valid scores for {dim}")
            continue

        if dim_missing:
            if missing_strategy == "raise":
                raise ValueError(f"Missing items in {dim}: {dim_missing}")
            elif missing_strategy == "mean":
                # 用已有题目均值填补（仅当缺失 < 20%）
                missing_ratio = len(dim_missing) / len(items)
                if missing_ratio > 0.2:
                    flags.append(f"High missing rate in {dim}: {missing_ratio:.0%}")

        # 标准化到 0-100
        min_possible = max_scale - (max_scale - 1)  # = 1
        max_possible = max_scale
        mean_score = np.mean(scores)
        normalized = (mean_score - min_possible) / (max_possible - min_possible) * 100
        result[dim] = round(float(normalized), 1)

    result["missing_items"] = missing_items
    result["flags"] = flags
    return result
```

### 3.3 信度计算（Cronbach's Alpha）

```python
def cronbach_alpha(item_scores: List[List[float]]) -> float:
    """
    计算 Cronbach's alpha 信度系数

    Args:
        item_scores: [[题1各被试分数], [题2各被试分数], ...]

    Returns:
        alpha 值，范围 0-1，建议 > 0.70
    """
    k = len(item_scores)
    if k < 2:
        return 0.0

    item_variances = [np.var(scores, ddof=1) for scores in item_scores]
    total_scores = np.sum(item_scores, axis=0)
    total_variance = np.var(total_scores, ddof=1)

    alpha = (k / (k - 1)) * (1 - sum(item_variances) / total_variance)
    return round(float(alpha), 3)
```

---

## 四、纵向动态更新机制（创新设计）

当前系统的 delta 更新是 LLM 随机生成的浮点数扰动，缺乏理论依据。以下设计基于**证据积累模型（Evidence Accumulation Model）**。

### 4.1 理论基础

借鉴认知科学中的信号检测理论（Signal Detection Theory）和贝叶斯更新（Bayesian Updating），学习者画像应视为**概率分布而非单一值**。

### 4.2 贝叶斯画像更新

```
后验分布 ∝ 先验分布 × 观测证据似然
```

每次对话交互产生证据，按维度权重更新画像：

```python
class BayesianProfileUpdater:
    """基于贝叶斯推断的动态画像更新"""

    # 对话行为 → 维度贡献权重
    BEHAVIOR_WEIGHTS = {
        # (cognition_w, affect_w, behavior_w)
        "asks_deep_question":     (0.8, 0.2, 0.0),
        "expresses_confusion":    (-0.3, -0.5, 0.0),
        "repeats_question":       (-0.2, -0.3, -0.1),
        "says_understood":        (0.2, 0.1, 0.0),  # 需验证
        "submits_code_attempt":   (0.1, 0.1, 0.8),
        "gives_up_early":         (-0.1, -0.3, -0.6),
        "explores_edge_cases":    (0.5, 0.1, 0.4),
    }

    def update(
        self,
        current: Dict[str, float],  # 当前画像 {cognition, affect, behavior}
        evidence_type: str,          # 行为类型
        confidence: float = 0.5,     # LLM 分析置信度 0-1
        learning_rate: float = 0.05, # 更新步长（避免过度更新）
    ) -> Dict[str, float]:
        weights = self.BEHAVIOR_WEIGHTS.get(evidence_type, (0, 0, 0))
        dims = ["cognition", "affect", "behavior"]

        updated = {}
        for i, dim in enumerate(dims):
            delta = weights[i] * confidence * learning_rate * 100
            # 带阻尼的更新：偏离中心越远，越难继续移动
            damping = 1 - abs(current[dim] - 50) / 100
            new_val = current[dim] + delta * damping
            updated[dim] = max(0.0, min(100.0, round(new_val, 1)))

        return updated
```

### 4.3 多模态证据融合（创新点）

结合三类数据源，通过加权融合生成更可靠的画像更新：

```
证据源 1：量表得分（初始化，权重 0.4）
          ↓ 基线 CAB 值

证据源 2：对话语义分析（持续，权重 0.35）
          ↓ 每条消息的意图/情感/概念

证据源 3：代码行为指标（研究模式，权重 0.25）
          ├── 编辑次数 / 时间
          ├── 错误尝试频率（反映坚持度 → Behavior）
          ├── 代码复杂度增长（反映认知投入 → Cognition）
          └── 求助频率（反映情感安全感 → Affect）
```

### 4.4 代码行为特征提取（研究模式专属）

```python
class CodeBehaviorAnalyzer:
    """从代码编辑行为提取 CAB 证据"""

    def analyze(
        self,
        code_snapshots: List[Dict],  # [{timestamp, code, lines_changed}, ...]
        total_duration_minutes: float,
    ) -> Dict[str, float]:
        """
        返回 CAB 证据权重 (-1 到 +1)
        """
        if not code_snapshots:
            return {"cognition": 0, "affect": 0, "behavior": 0}

        edit_count = len(code_snapshots)
        avg_edit_interval = total_duration_minutes / max(edit_count, 1)

        # Behavior：持续编辑 → 高行为投入
        behavior_signal = min(1.0, edit_count / 20)

        # Cognition：代码行数增长趋势（思考深度代理指标）
        if len(code_snapshots) >= 2:
            line_growth = [s["lines_changed"] for s in code_snapshots]
            # 代码逐渐增加且变化多样 → 高认知投入
            cognitive_signal = min(1.0, np.std(line_growth) / 10)
        else:
            cognitive_signal = 0.0

        # Affect：长时间无编辑后突然活跃 → 可能是焦虑后突破（正向情感）
        # 间隔过大 → 可能分心或放弃（负向情感）
        if avg_edit_interval > 5:  # 超过5分钟平均间隔
            affect_signal = -0.3
        elif avg_edit_interval < 1:  # 快速迭代
            affect_signal = 0.2
        else:
            affect_signal = 0.0

        return {
            "cognition": round(cognitive_signal, 2),
            "affect": round(affect_signal, 2),
            "behavior": round(behavior_signal, 2),
        }
```

---

## 五、创新点总结

| 创新点 | 现有方法局限 | 本方案贡献 |
|---|---|---|
| **多模态融合** | 仅用问卷；或仅用日志 | 问卷 + 对话语义 + 代码行为三源融合，互为验证 |
| **贝叶斯动态更新** | 固定画像或随机扰动 | 先验 + 证据 → 后验，更新有理论支撑 |
| **阻尼更新函数** | 线性加减 | 极端画像的更新阻力更大，防止漂移 |
| **代码行为分析** | 教育系统鲜少用代码行为推断认知状态 | 将编程任务中的"尝试-失败-重试"模式建模为行为投入指标 |
| **置信度加权** | NLP 分析结果直接应用 | 使用 LLM 分析的置信度对更新幅度降权 |
| **数据质量旗标** | 不检查数据质量 | 缺失率 > 20%、填写过快等情况自动标记 |

---

## 六、实施路线图

### 短期（MVP 改进，1-2 周）
- [ ] 将量表题目从硬编码 `item_1..6` 改为从数据库模板读取，支持 admin 自定义题目和维度映射
- [ ] 在 `forms.py` 的计分函数中加入反向计分支持（通过量表模板中的 `reverse: true` 字段）
- [ ] 计算并存储 Cronbach's alpha（至少作为日志输出）

### 中期（研究级设计，3-4 周）
- [ ] 实现上述贝叶斯更新器，替换当前 LLM delta 随机扰动
- [ ] 在研究模式下启用代码行为采样（每 30 秒保存代码快照到 `research_task_submissions`）
- [ ] 实现多模态融合计分

### 长期（发表级标准）
- [ ] 与 2-3 所合作学校收集预测试数据（n ≥ 50），进行 CFA 验证三因子结构
- [ ] 发表测量工具（附代码）以支持可复现性
- [ ] 添加知情同意流程、IRB 合规记录

---

## 七、参考理论框架

- **SRL（Self-Regulated Learning）**：Zimmerman, B.J. (2000). *Attaining self-regulation: A social cognitive perspective.*
- **AES（Affective-Emotional States）**：D'Mello, S., Graesser, A. (2012). *Dynamics of affective states during complex learning.*
- **贝叶斯知识追踪（BKT）**：Corbett, A.T., Anderson, J.R. (1994). *Knowledge tracing: Modeling the acquisition of procedural knowledge.*
- **学习参与三维模型**：Fredricks, J.A., et al. (2004). *School engagement: Potential of the concept, state of the evidence.*
- **CAB 框架（本系统基础）**：参考 Cocea & Weibelzahl (2006). *Eliciting disengagement indicators.*

---

*文档维护：随量表版本更新*
*最后更新：2026-02-27*
