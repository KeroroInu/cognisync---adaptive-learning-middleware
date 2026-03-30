# 情感对比实验开发说明

## 目标

本说明面向 CogniSync 的管理后台研究实验功能，目标不是一次性覆盖完整论文指标，而是先保证以下最小闭环稳定可运行：

1. 上传真实公开数据集
2. 同时输出两套结果
   - Baseline：仅基于文本的大模型情感判断
   - CogniSync：文本 + 上下文 + 学习者画像的系统情感判断
3. 能对照真实标签查看逐条结果
4. 能导出 CSV 供后续人工核验和论文整理

当前设计优先服务教育 AI 情感识别研究，而不是通用运营后台。

---

## 本地测试文件夹的真实数据形态

本仓库根目录下的本地忽略目录 `测试/` 当前包含四类对研究设计有直接参考价值的数据或脚本：

### 1. GoEmotions 清洗版多标签数据集

文件：[goemotions_train_clean.csv](file:///Users/kero_o/Desktop/cognisync---adaptive-learning-middleware/%E6%B5%8B%E8%AF%95/goemotions_train_clean.csv#L1-L5)

结构特征：

- 第一列：`text`
- 后续 28 列：one-hot 多标签情绪列
- 正样本值：`1`
- 负样本值：`0`
- 代表格式：多标签二值列数据集

适用配置：

- `labelMode = "multi_binary"`
- `textColumn = "text"`
- `expectedLabelColumns = [admiration, amusement, ..., neutral]`
- `positiveLabelValue = "1"`

### 2. Hugging Face 数据集加载脚本

文件：[hugging_face_load_test.py](file:///Users/kero_o/Desktop/cognisync---adaptive-learning-middleware/%E6%B5%8B%E8%AF%95/hugging_face_load_test.py#L1-L22)

说明：

- 该脚本明确表明研究原始样本来自 Hugging Face `mrm8488/goemotions`
- 也说明本地实验流程会先裁剪成 `text + emotion columns`
- 这意味着第一阶段无需优先兼容复杂元数据字段，如 `id`、`author`、网页链接等

### 3. 派生人工对照结果表

文件：[llm_test_results.csv](file:///Users/kero_o/Desktop/cognisync---adaptive-learning-middleware/%E6%B5%8B%E8%AF%95/llm_test_results.csv#L1-L20)

结构特征：

- 原文文本
- 中文翻译文本
- 多标签 one-hot 真值列
- 人工整理后的中文情绪描述
- LLM 预测标签代码
- 系统映射后的中文类别
- 对错标记

说明：

- 这类文件不是“原始数据集”，而是“研究评估派生表”
- 它提示我们最终导出结果不应只保留单个预测值，而应保留：
  - 原始文本
  - 真值标签集合
  - baseline 预测
  - system 预测
  - 人工可读映射
  - 命中情况

### 4. 其他下载脚本指向的数据集家族

文件：[main.py](file:///Users/kero_o/Desktop/cognisync---adaptive-learning-middleware/%E6%B5%8B%E8%AF%95/main.py#L10-L25)

说明：

- 当前本地测试思路不仅覆盖 GoEmotions
- 还意图引入：
  - SemEval-2018 Task 1
  - TweetEval Emotion
  - TweetEval Irony

这说明统一实验输入必须至少兼容两种主流格式：

- 多标签 one-hot 数据
- 单标签类别列数据

### 5. 中文微博单标签评测数据集

目录：[评测数据集](file:///Users/kero_o/Desktop/cognisync---adaptive-learning-middleware/%E6%B5%8B%E8%AF%95/%E8%AF%84%E6%B5%8B%E6%95%B0%E6%8D%AE%E9%9B%86)

说明文件：[readme.txt](file:///Users/kero_o/Desktop/cognisync---adaptive-learning-middleware/%E6%B5%8B%E8%AF%95/%E8%AF%84%E6%B5%8B%E6%95%B0%E6%8D%AE%E9%9B%86/readme.txt#L1-L40)

代表样例：

- 通用微博训练集：[usual_train.txt](file:///Users/kero_o/Desktop/cognisync---adaptive-learning-middleware/%E6%B5%8B%E8%AF%95/%E8%AF%84%E6%B5%8B%E6%95%B0%E6%8D%AE%E9%9B%86/train/usual_train.txt#L1)
- 疫情微博训练集：`virus_train.txt`
- 验证集：`usual_eval_labeled.txt`、`virus_eval_labeled.txt`
- 最终测试集：`usual_test_labeled.txt`、`virus_test_labeled.txt`

结构特征：

- txt 文件本质是 JSON 数组
- 每条样本包含：
  - `id`
  - `content`
  - `label`
- xlsx 文件结构等价：
  - 第一列 `id`
  - 第二列 `content`
  - 第三列 `label`

标签体系：

- `angry`
- `fear`
- `happy`
- `neutral`
- `sad`
- `surprise`

研究意义：

- 这是非常典型的中文单标签情感分类数据
- 它和 GoEmotions 不同，不是多标签 one-hot，而是标准单列标签
- 因此它应当作为第一阶段必须支持的“中文单标签基准输入”

---

## 第一阶段必须支持的数据集输入格式

### 格式 A：单标签列

示例：

```csv
text,label
I am confused,confusion
This is great,joy
```

字段约定：

- `textColumn`
- `expectedLabelColumn`

适用指标：

- accuracy
- macro_f1
- weighted_f1

中文微博数据集映射建议：

- JSON/txt 输入先转为扁平表
- `content -> textColumn`
- `label -> expectedLabelColumn`
- 保留 `id` 作为可选样本标识列

推荐上传配置：

```json
{
  "labelMode": "single_label",
  "textColumn": "content",
  "expectedLabelColumn": "label",
  "sampleIdColumn": "id"
}
```

页面填写方式建议：

- 数据集类型：`中文单标签`
- 文本列：`content`
- 标签模式：`单标签列`
- 原始标签列：`label`
- 样本 ID 列：`id`
- 说话人列：留空
- 会话列：留空

说明：

- `usual_train.txt`、`virus_train.txt` 这类 txt 本质是 JSON，不是标准 CSV
- 第一阶段建议前端支持两种导入方式：
  - 直接上传 `.xlsx`
  - 上传 `.txt/.json` 后由后端先转为扁平 DataFrame
- 当前本地 QA 冒烟表明 `usual_train.txt` 是稳定可用输入，建议优先用于演示和提测
- 当前仓库里的 `usual_train.xlsx` 不应默认当作标准演示样例，详见 [emotion-compare-handover.md](file:///Users/kero_o/Desktop/cognisync---adaptive-learning-middleware/docs/emotion-compare-handover.md)

### 格式 B：多标签 0/1 列

示例：

```csv
text,joy,confusion,anger
I am confused,0,1,0
This is great,1,0,0
```

字段约定：

- `textColumn`
- `expectedLabelColumns`
- `positiveLabelValue`

适用指标：

- exact_match
- overlap_match
- macro_f1
- label_wise_f1

GoEmotions 映射建议：

- `text -> textColumn`
- 所有情绪列 -> `expectedLabelColumns`
- `1 -> positiveLabelValue`

推荐上传配置：

```json
{
  "labelMode": "multi_binary",
  "textColumn": "text",
  "expectedLabelColumns": [
    "admiration",
    "amusement",
    "anger",
    "annoyance",
    "approval",
    "caring",
    "confusion",
    "curiosity",
    "desire",
    "disappointment",
    "disapproval",
    "disgust",
    "embarrassment",
    "excitement",
    "fear",
    "gratitude",
    "grief",
    "joy",
    "love",
    "nervousness",
    "optimism",
    "pride",
    "realization",
    "relief",
    "remorse",
    "sadness",
    "surprise",
    "neutral"
  ],
  "positiveLabelValue": "1"
}
```

页面填写方式建议：

- 数据集类型：`英文多标签`
- 文本列：`text`
- 标签模式：`多标签 0/1 列`
- 多标签列名：填全部 emotion columns
- 正样本取值：`1`
- 样本 ID 列：留空
- 说话人列：留空
- 会话列：留空

### 格式 C：派生评估表

示例来源：[llm_test_results.csv](file:///Users/kero_o/Desktop/cognisync---adaptive-learning-middleware/%E6%B5%8B%E8%AF%95/llm_test_results.csv#L1-L20)

用途：

- 供人工复查
- 供论文附录
- 不作为第一阶段上传主输入

处理策略：

- 先作为导出目标结构参考
- 不要求第一阶段直接重新导入系统

---

## 推荐的最小统一输出结构

第一阶段统一接口只保留 5 个顶层输出块：

```json
{
  "datasetInfo": {},
  "baselineRows": [],
  "systemRows": [],
  "comparisonRows": [],
  "summaryMetrics": {}
}
```

### 顶层结构设计原则

- `datasetInfo` 负责解释输入
- `baselineRows` 负责保存纯文本分析结果
- `systemRows` 负责保存 CogniSync 系统结果
- `comparisonRows` 负责提供页面主表和导出表
- `summaryMetrics` 只保留第一阶段最小指标，不提前塞入论文全量指标

### 1. datasetInfo

用于说明系统如何理解上传的数据集。

```json
{
  "datasetName": "goemotions_train_clean.csv",
  "taskType": "multi_label",
  "textColumn": "text",
  "expectedLabelColumn": null,
  "expectedLabelColumns": ["admiration", "amusement", "anger"],
  "positiveLabelValue": "1",
  "rowsProcessed": 200,
  "rowsSkipped": 3,
  "labelCount": 28
}
```

保留原因：

- 先确认输入解释正确
- 避免“系统没理解数据列”却仍然开始分析

#### 单标签时的 datasetInfo

```json
{
  "datasetName": "usual_train.xlsx",
  "taskType": "single_label",
  "sourceFormat": "xlsx",
  "sampleIdColumn": "id",
  "textColumn": "content",
  "expectedLabelColumn": "label",
  "expectedLabelColumns": [],
  "positiveLabelValue": null,
  "rowsProcessed": 27768,
  "rowsSkipped": 0,
  "labelCount": 6,
  "labels": ["angry", "fear", "happy", "neutral", "sad", "surprise"]
}
```

#### 多标签时的 datasetInfo

```json
{
  "datasetName": "goemotions_train_clean.csv",
  "taskType": "multi_label",
  "sourceFormat": "csv",
  "sampleIdColumn": null,
  "textColumn": "text",
  "expectedLabelColumn": null,
  "expectedLabelColumns": ["admiration", "amusement", "anger"],
  "positiveLabelValue": "1",
  "rowsProcessed": 5000,
  "rowsSkipped": 12,
  "labelCount": 28
}
```

### 2. baselineRows

表示“纯文本大模型分析”的逐条结果。

```json
[
  {
    "rowIndex": 1,
    "text": "I am confused",
    "predictedEmotionCode": "E01",
    "predictedEmotionName": "confused",
    "predictedIntensity": "medium",
    "confidence": 0.81
  }
]
```

约束：

- 不包含画像或 delta
- 只体现文本输入下的大模型判断

### 3. systemRows

表示 CogniSync 系统情感模块的逐条输出。

```json
[
  {
    "rowIndex": 1,
    "text": "I am confused",
    "predictedEmotionCode": "E01",
    "predictedEmotionName": "confused",
    "predictedIntensity": "high",
    "confidence": 0.88,
    "profileBefore": {
      "cognition": 50,
      "affect": 50,
      "behavior": 50
    },
    "profileAfter": {
      "cognition": 46,
      "affect": 42,
      "behavior": 54
    },
    "delta": {
      "cognition": -4,
      "affect": -8,
      "behavior": 4
    }
  }
]
```

约束：

- 这是系统方法的研究核心
- 必须保留画像前后状态，才能体现与 baseline 的机制差异

### 4. comparisonRows

这是页面主表和 CSV 导出的核心结构。

```json
[
  {
    "rowIndex": 1,
    "text": "I am confused",
    "groundTruthLabels": ["confusion"],
    "baselinePrediction": {
      "emotionCode": "E13",
      "emotionName": "neutral"
    },
    "systemPrediction": {
      "emotionCode": "E01",
      "emotionName": "confused"
    },
    "baselineMatched": false,
    "systemMatched": true,
    "winner": "system"
  }
]
```

保留原因：

- 支撑单页左右对比
- 支撑人工抽查
- 支撑导出和论文案例分析

#### comparisonRows 统一字段约束

无论单标签还是多标签，都建议统一保留以下字段：

```json
{
  "rowIndex": 1,
  "sampleId": "123",
  "text": "样本文本",
  "groundTruthLabels": ["happy"],
  "baselinePrediction": {
    "emotionCode": "E13",
    "emotionName": "neutral",
    "intensity": "medium",
    "confidence": 0.62
  },
  "systemPrediction": {
    "emotionCode": "E08",
    "emotionName": "motivated",
    "intensity": "high",
    "confidence": 0.84
  },
  "baselineMatched": false,
  "systemMatched": true,
  "winner": "system"
}
```

设计理由：

- 单标签时，`groundTruthLabels` 长度通常为 1
- 多标签时，`groundTruthLabels` 长度可以大于 1
- 前端不需要为两种数据集维护两套完全不同的表结构

#### 单标签 comparisonRows 判定方式

- `groundTruthLabels = [label]`
- `baselineMatched = baselinePrediction in groundTruthLabels`
- `systemMatched = systemPrediction in groundTruthLabels`

#### 多标签 comparisonRows 判定方式

- `groundTruthLabels = 所有值为 1 的标签列`
- 第一阶段建议默认采用：
  - `matched = 预测标签是否落在 groundTruthLabels 内`
- 后续若支持标签集合预测，再升级为：
  - exact match
  - overlap match

### 5. summaryMetrics

第一阶段不追求完整论文指标，只保留最小必要集合。

#### 单标签数据集

```json
{
  "taskType": "single_label",
  "baseline": {
    "accuracy": 0.68,
    "macroF1": 0.62,
    "weightedF1": 0.65
  },
  "system": {
    "accuracy": 0.81,
    "macroF1": 0.78,
    "weightedF1": 0.80
  }
}
```

建议额外保留：

```json
{
  "support": 27768,
  "labels": ["angry", "fear", "happy", "neutral", "sad", "surprise"]
}
```

#### 多标签数据集

```json
{
  "taskType": "multi_label",
  "baseline": {
    "exactMatch": 0.32,
    "overlapMatch": 0.61,
    "macroF1": 0.44
  },
  "system": {
    "exactMatch": 0.47,
    "overlapMatch": 0.73,
    "macroF1": 0.58
  }
}
```

建议额外保留：

```json
{
  "support": 5000,
  "labelCount": 28
}
```

### 第一阶段不建议放进 summaryMetrics 的字段

以下字段先不放进第一阶段 summary，避免系统在“尚未稳定跑通”阶段过早复杂化：

- `cohensKappa`
- `overallAgreement`
- `confusionMatrix`
- `pearsonCorrelation`
- `spearmanCorrelation`
- `ablationVariants`

这些字段后续可以作为二级扩展结构附加在：

- `extendedMetrics`
- `diagnostics`
- `ablationMetrics`

---

## 当前阶段暂不强制保留的复杂输出

以下结构有研究价值，但不应阻塞第一阶段落地：

- Cohen's Kappa
- Pearson / Spearman 相关性
- Cohen's d
- 全量 13×13 热力图矩阵
- 多模态 baseline
- 文献方法复现结果
- 全量消融组合结果

处理建议：

- 在 schema 上预留扩展位
- 第一阶段不作为页面主结构或必填输出

---

## 页面结构建议

单页只保留一个主要入口：`情感对比实验`

### 区块 1：上传与配置

- 上传 CSV
- 选择 `单标签列` / `多标签 0/1 列`
- 文本列
- 标签列或多标签列列表
- 标签映射 JSON

推荐增加一个“数据集模板”快速填充器：

- 中文微博单标签模板
- GoEmotions 多标签模板

这样用户不需要每次手动理解字段映射。

### 区块 2：总体结果

- baseline accuracy / macro_f1 / weighted_f1
- system accuracy / macro_f1 / weighted_f1
- 多标签时改成 exact match / overlap match / macro_f1

### 区块 3：左右结果对比

- 左：传统文本情感分析
- 右：CogniSync 系统情感分析

### 区块 4：逐条样本表

- 文本
- 真值标签
- baseline 预测
- system 预测
- baseline 是否命中
- system 是否命中
- winner

### 区块 5：导出

- 导出 comparison CSV
- 导出 JSON 结果

---

## 推荐实施顺序

1. 先统一支持 `single_label` 和 `multi_binary` 两类输入
2. 再优先打通中文微博单标签和 GoEmotions 多标签两套真实样例
3. 统一后端返回 `datasetInfo / baselineRows / systemRows / comparisonRows / summaryMetrics`
4. 前端增加“数据集模板”快速填写
5. 再把前端收敛为单页对比实验界面
6. 最后再扩展论文级指标

---

## 统一接口 JSON Schema 草案

建议新增一个统一实验接口：

```http
POST /api/admin/research/emotion-compare/analyze-dataset
```

该接口第一阶段只做一件事：对同一份数据集同时跑 baseline 与 CogniSync system 两套分析，并返回统一结构。

### 请求体字段草案

建议使用 `multipart/form-data`，因为需要上传文件。

#### 必填字段

```json
{
  "file": "(binary)",
  "labelMode": "single_label | multi_binary",
  "textColumn": "string"
}
```

#### 单标签场景字段

```json
{
  "expectedLabelColumn": "label",
  "sampleIdColumn": "id"
}
```

#### 多标签场景字段

```json
{
  "expectedLabelColumnsJson": "[\"joy\", \"confusion\", \"anger\"]",
  "positiveLabelValue": "1"
}
```

#### 可选扩展字段

```json
{
  "conversationIdColumn": "dialogue_id",
  "speakerColumn": "speaker",
  "profileKeyColumn": "user_id",
  "labelMappingJson": "{\"困惑\": [\"confused\", \"E01\"]}",
  "previewLimit": 50,
  "datasetTemplate": "weibo_single | goemotions_multi"
}
```

### 响应体顶层结构草案

```json
{
  "success": true,
  "data": {
    "datasetInfo": {},
    "baselineRows": [],
    "systemRows": [],
    "comparisonRows": [],
    "summaryMetrics": {},
    "exportArtifacts": {}
  }
}
```

### 顶层字段命名约定

- `datasetInfo`
  - 解释输入数据集是如何被系统识别和解析的
- `baselineRows`
  - 纯文本情感判断结果
- `systemRows`
  - 文本 + 上下文 + 画像的系统结果
- `comparisonRows`
  - 页面主表与导出主表
- `summaryMetrics`
  - 第一阶段最小指标摘要
- `exportArtifacts`
  - 导出的 CSV / JSON 文本或下载信息

### datasetInfo schema 草案

```json
{
  "datasetName": "usual_train.xlsx",
  "sourceFormat": "xlsx",
  "taskType": "single_label",
  "datasetTemplate": "weibo_single",
  "sampleIdColumn": "id",
  "textColumn": "content",
  "expectedLabelColumn": "label",
  "expectedLabelColumns": [],
  "positiveLabelValue": null,
  "rowsProcessed": 27768,
  "rowsSkipped": 0,
  "labelCount": 6,
  "labels": ["angry", "fear", "happy", "neutral", "sad", "surprise"]
}
```

字段规则：

- `taskType`
  - `single_label`
  - `multi_label`
- `datasetTemplate`
  - 用于前端快速回填配置和结果解释
- `labels`
  - 单标签时建议明确给出完整标签表
  - 多标签时可选给出标签列表

### baselineRows schema 草案

```json
[
  {
    "rowIndex": 1,
    "sampleId": "1",
    "text": "回忆起老爸的点点滴滴，心痛…为什么.接受不了",
    "predictedEmotionCode": "E12",
    "predictedEmotionName": "sadness",
    "predictedIntensity": "medium",
    "confidence": 0.73,
    "rawLabel": "sadness"
  }
]
```

字段规则：

- `sampleId`
  - 如果原数据有 `id`，则保留
  - 没有则为 `null`
- `rawLabel`
  - 保留模型直接输出的原始标签文本，便于调试映射问题

### systemRows schema 草案

```json
[
  {
    "rowIndex": 1,
    "sampleId": "1",
    "text": "回忆起老爸的点点滴滴，心痛…为什么.接受不了",
    "predictedEmotionCode": "E12",
    "predictedEmotionName": "sadness",
    "predictedIntensity": "high",
    "confidence": 0.84,
    "profileBefore": {
      "cognition": 50,
      "affect": 50,
      "behavior": 50
    },
    "profileAfter": {
      "cognition": 46,
      "affect": 39,
      "behavior": 48
    },
    "delta": {
      "cognition": -4,
      "affect": -11,
      "behavior": -2
    },
    "contextUsed": {
      "dialogue": false,
      "profile": true,
      "knowledge": false
    }
  }
]
```

字段规则：

- `contextUsed`
  - 第一阶段不需要暴露完整上下文文本
  - 但建议至少给出布尔位，说明系统是否真的使用了对应上下文

### comparisonRows schema 草案

```json
[
  {
    "rowIndex": 1,
    "sampleId": "1",
    "text": "回忆起老爸的点点滴滴，心痛…为什么.接受不了",
    "groundTruthLabels": ["sad"],
    "baselinePrediction": {
      "emotionCode": "E13",
      "emotionName": "neutral",
      "intensity": "medium",
      "confidence": 0.62
    },
    "systemPrediction": {
      "emotionCode": "E12",
      "emotionName": "sadness",
      "intensity": "high",
      "confidence": 0.84
    },
    "baselineMatched": false,
    "systemMatched": true,
    "winner": "system"
  }
]
```

字段规则：

- `groundTruthLabels`
  - 单标签：长度为 1
  - 多标签：长度 >= 1
- `winner`
  - `baseline`
  - `system`
  - `tie`
  - `none`

判定建议：

- 如果 `baselineMatched = false` 且 `systemMatched = true`，则 `winner = "system"`
- 如果 `baselineMatched = true` 且 `systemMatched = false`，则 `winner = "baseline"`
- 如果两边都对或都错，则根据业务设为 `tie` 或 `none`

### summaryMetrics schema 草案

#### 单标签

```json
{
  "taskType": "single_label",
  "support": 27768,
  "labels": ["angry", "fear", "happy", "neutral", "sad", "surprise"],
  "baseline": {
    "accuracy": 0.68,
    "macroF1": 0.62,
    "weightedF1": 0.65
  },
  "system": {
    "accuracy": 0.81,
    "macroF1": 0.78,
    "weightedF1": 0.80
  }
}
```

#### 多标签

```json
{
  "taskType": "multi_label",
  "support": 5000,
  "labelCount": 28,
  "baseline": {
    "exactMatch": 0.32,
    "overlapMatch": 0.61,
    "macroF1": 0.44
  },
  "system": {
    "exactMatch": 0.47,
    "overlapMatch": 0.73,
    "macroF1": 0.58
  }
}
```

### exportArtifacts schema 草案

```json
{
  "comparisonCsvFileName": "goemotions_compare_results.csv",
  "comparisonCsvContent": "rowIndex,text,...",
  "resultJsonFileName": "goemotions_compare_results.json"
}
```

设计原则：

- 第一阶段优先让页面能直接下载
- 不强依赖额外对象存储

---

## 页面区块到接口字段映射

### 区块 1：上传与配置

页面字段映射：

- 数据集模板 → `datasetTemplate`
- 标签模式 → `labelMode`
- 文本列 → `textColumn`
- 单标签列 → `expectedLabelColumn`
- 多标签列名 → `expectedLabelColumnsJson`
- 正样本取值 → `positiveLabelValue`
- 样本 ID 列 → `sampleIdColumn`
- 会话列 → `conversationIdColumn`
- 说话人列 → `speakerColumn`
- 画像主键列 → `profileKeyColumn`
- 标签映射 JSON → `labelMappingJson`

### 区块 2：总体指标卡片

页面读取：

- `summaryMetrics.baseline.*`
- `summaryMetrics.system.*`

显示逻辑：

- 单标签显示：
  - accuracy
  - macroF1
  - weightedF1
- 多标签显示：
  - exactMatch
  - overlapMatch
  - macroF1

### 区块 3：左右对比结果

页面读取：

- 左栏：`baselineRows`
- 右栏：`systemRows`

说明：

- 这两个数组可以按 `rowIndex` 或 `sampleId` 对齐
- 页面不必直接暴露所有调试字段
- `confidence`、`emotionName`、`intensity` 应作为首屏字段

### 区块 4：逐条样本表

页面读取：

- `comparisonRows`

首屏推荐列：

- `sampleId`
- `text`
- `groundTruthLabels`
- `baselinePrediction.emotionName`
- `systemPrediction.emotionName`
- `baselineMatched`
- `systemMatched`
- `winner`

### 区块 5：导出按钮

页面读取：

- `exportArtifacts.comparisonCsvContent`
- `exportArtifacts.comparisonCsvFileName`
- `exportArtifacts.resultJsonFileName`

---

## 字段命名建议

为了减少前后端歧义，推荐统一以下命名：

- 输入配置一律用：
  - `textColumn`
  - `expectedLabelColumn`
  - `expectedLabelColumns`
  - `sampleIdColumn`
  - `positiveLabelValue`
- 输出结果一律用：
  - `groundTruthLabels`
  - `baselinePrediction`
  - `systemPrediction`
  - `baselineMatched`
  - `systemMatched`

避免同时混用：

- `label`
- `labels`
- `expectedLabel`
- `expectedLabels`

除非这些字段明确只存在于中间转换层。

---

## 验收标准

第一阶段只要求以下结果稳定成立：

1. 上传 `goemotions_train_clean.csv` 这类多标签 one-hot 数据集可以成功运行
2. 上传中文微博这类单标签数据集可以成功运行
3. 页面能同时看到 baseline 与 system 两套结果
4. 页面能导出 comparison CSV
5. 相同数据集重复运行多次时，页面与接口不再频繁出现 400 / 413 / 500

---

## 说明

本说明基于本地忽略目录 `测试/` 中的真实测试脚本与样例数据整理，不依赖 Git 追踪历史。后续如果继续引入新的研究数据集，优先判断其是否属于以下两类之一：

- 单标签类别列（如中文微博 usual/virus 数据集）
- 多标签 one-hot 列

若超出这两类，再考虑扩展输入适配层，而不是直接扩展页面复杂度。
