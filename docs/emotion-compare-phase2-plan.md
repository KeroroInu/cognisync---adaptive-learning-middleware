# 情感对比实验第二阶段规划

## 目标

第二阶段的目标不是再做一个“能跑”的实验页，而是把当前第一阶段最小闭环升级为**可支撑论文实验部分**的研究平台。相比第一阶段，第二阶段要解决以下问题：

1. 指标从最小可用升级为论文级指标集
2. 多标签评估从近似方案升级为更严格方案
3. system 从“画像增强”升级为更完整的上下文融合实验对象
4. 引入消融实验结构，证明各组件贡献
5. 让前端与导出结果可以直接映射到论文表格与图表

第一阶段关注“稳定跑通”，第二阶段关注“研究结论可信、可复现、可展示”。

---

## 任务拆解

### 1. [backend] 指标体系升级

- **输入**
  - 第一阶段 `comparisonRows`
  - 统一标签映射表
  - 单标签 / 多标签任务类型
- **输出**
  - 扩展后的 `summaryMetricsV2`
  - `perClassMetrics`
  - `confusionAnalysis`
  - `agreementMetrics`
  - `intensityMetrics`
- **任务内容**
  - 单标签增加：
    - `precision`
    - `recall`
    - `f1`
    - `macroF1`
    - `weightedF1`
    - confusion matrix
  - 多标签增加：
    - `microF1`
    - `macroF1`
    - `labelWisePrecision`
    - `labelWiseRecall`
    - `labelWiseF1`
    - 更严格的 exact / overlap 定义
  - 一致性增加：
    - `overallAgreement`
    - `cohensKappa`
  - 强度增加：
    - `intensityAccuracy`
    - `intensityMAE`
- **验收标准**
  - 单标签可导出 per-class metrics 表
  - 多标签可导出 label-wise metrics 表
  - confusion matrix 可序列化输出
  - kappa / agreement 可计算

### 2. [backend] 多标签评估升级

- **输入**
  - GoEmotions 类多标签真值
  - Baseline / system 预测输出
- **输出**
  - 更严格的多标签评估对象
- **任务内容**
  - 将当前“单预测标签 vs 多真值标签”的方案升级为：
    - 支持预测标签集合
    - 支持 micro/macro 指标
    - 支持 label-wise 结果
  - 保留第一阶段兼容指标：
    - `exactMatch`
    - `overlapMatch`
- **验收标准**
  - 多标签结果不再只依赖单个预测标签
  - 预测标签集合与真值集合可直接比较

### 3. [backend] 上下文融合与消融实验结构

- **输入**
  - 文本
  - 画像
  - 对话上下文
  - 知识上下文
- **输出**
  - 统一的 variant 结果集
- **任务内容**
  - 明确定义 5 个实验 variant：
    - `baseline_text_only`
    - `system_profile_only`
    - `system_dialogue_only`
    - `system_knowledge_only`
    - `system_full_fusion`
  - 对每个 variant 输出统一结构
  - 支持表 3 风格的消融实验结果
- **验收标准**
  - 同一份数据集可一次性产出多 variant 结果
  - 结果可直接用于展示 `Δ vs baseline`

### 4. [data] 标签映射校正与标签空间设计

- **输入**
  - 中文微博 6 类标签
  - GoEmotions 28 类标签
  - 当前系统 13 类情感 × 强度
- **输出**
  - 统一标签空间说明
  - 数据集原始标签空间 → 系统标签空间映射表
- **任务内容**
  - 明确是否采用双轨标签结构：
    - `rawDatasetLabelSpace`
    - `normalizedSystemLabelSpace`
  - 校正当前近似映射
  - 为混淆矩阵和 per-class metrics 提供统一标签索引
- **验收标准**
  - 至少输出一份可审阅的标签映射表
  - 中文微博和 GoEmotions 都可映射到统一空间

### 5. [frontend-admin] 第二阶段展示分层

- **输入**
  - 扩展后的 second-stage response
- **输出**
  - 保持首屏简洁的单页展示
- **任务内容**
  - 首屏保留：
    - datasetInfo
    - summary 卡片
    - baseline/system 对比
    - comparisonRows 主表
  - 二级展示增加：
    - per-class metrics 表
    - confusion matrix
    - intensity metrics
    - ablation results
    - case studies
- **验收标准**
  - 页面不回退成“功能过载”
  - 首屏仍适合快速演示
  - 论文级内容放到折叠区或 tab

### 6. [qa] 第二阶段验证策略

- **输入**
  - 扩展后的后端与前端
- **输出**
  - 第二阶段测试清单
- **任务内容**
  - 增加：
    - confusion matrix 契约测试
    - per-class metrics 契约测试
    - ablation 结果一致性测试
    - kappa / agreement 计算测试
    - intensity 指标测试
  - 校验第一阶段兼容层不崩
- **验收标准**
  - 第二阶段新结构有明确回归测试
  - 第一阶段接口和页面仍可运行

### 7. [devops] 可选支持

- **输入**
  - 第二阶段更重的实验输出
- **输出**
  - 更稳定的运行与导出环境
- **任务内容**
  - 如果引入更大规模评估：
    - 调整导出文件体积限制
    - 评估长耗时任务是否改为异步任务模式
  - 不作为第二阶段第一优先
- **验收标准**
  - 大样本运行不轻易超时

---

## 依赖箭头

- 标签映射校正 → 多标签评估升级 → 指标体系升级
- 上下文融合结构 → 消融实验结果 → 前端 ablation 展示
- 指标体系升级 → 前端 per-class / confusion / intensity 展示
- 所有 backend 指标扩展 → QA 契约测试 → 演示与提测更新

推荐主链路：

- `标签映射校正`
  → `多标签评估升级`
  → `summaryMetricsV2 / perClassMetrics / confusionAnalysis`
  → `ablation 结构`
  → `前端展示分层`
  → `QA`

---

## 兼容性与 Migration

### 接口兼容策略

- 第一阶段接口建议继续保留：
  - `POST /api/admin/research/emotion-compare/analyze-dataset`
- 第二阶段建议新增：
  - `POST /api/admin/research/emotion-compare/analyze-dataset-v2`

原因：

- 第二阶段输出结构会明显变复杂
- 直接扩展第一阶段接口容易让现有前端和导出逻辑变脆弱
- 新增 `v2` 可让第一阶段继续稳定演示

### 前端兼容策略

- 第一阶段单页继续作为默认入口
- 第二阶段可以在同一页面内部：
  - 通过 tab / 折叠区接入 v2 数据
  - 或增加 feature flag `emotion_compare_v2_enabled`

### 数据兼容策略

- 第一阶段的 `comparisonRows` 保持不变
- 第二阶段扩展结构建议新加字段，而不是改写旧字段语义：
  - `summaryMetricsV2`
  - `perClassMetrics`
  - `confusionAnalysis`
  - `ablationMetrics`
  - `agreementMetrics`
  - `intensityMetrics`

---

## 风险矩阵

### 高风险

- **多标签评估口径变更**
  - 会导致第一阶段与第二阶段结果不可直接横向比较
- **标签映射不稳定**
  - 会直接影响 confusion matrix、per-class metrics 和论文可信度
- **上下文融合定义不清**
  - 会使消融实验结论站不住

### 中风险

- **页面再次过载**
  - 如果把所有论文指标都塞到首屏，用户体验会退化
- **接口结构膨胀**
  - 直接扩展旧接口会提高兼容风险
- **强度指标缺少可靠真值**
  - intensity accuracy / MAE 需要稳定标注或合理构造真值

### 低风险

- **旧页面兼容层继续保留**
  - 成本不高，但会增加少量维护负担

---

## 验收标准

第二阶段完成时，至少应满足以下条件：

1. 单标签可导出 per-class metrics 表
2. 多标签可导出 label-wise metrics 表
3. 可输出 confusion matrix
4. 可输出 overall agreement 和 kappa
5. 可输出 intensity 相关指标
6. 可展示至少 5 个 ablation variant 的结果
7. 前端能形成论文风格的：
   - 表 1：总体性能
   - 表 2：各类情感性能
   - 表 3：消融实验
8. 第一阶段接口和页面仍保持可运行

---

## 推荐实施顺序

### 第一步：标签映射与标签空间统一

- 先做标签映射表校正
- 这是 confusion matrix、per-class metrics、多标签升级的基础

### 第二步：多标签评估升级

- 解决当前“单预测标签 vs 多真值标签”的结构性限制

### 第三步：summaryMetricsV2 与 per-class metrics

- 扩展单标签 / 多标签指标
- 增加 agreement / intensity

### 第四步：消融实验结构

- 定义 variant 及其输入边界
- 输出统一 ablation 结果表

### 第五步：前端展示分层

- 首屏不变
- 新增折叠区 / tab 展示第二阶段结构

### 第六步：QA 收口

- 做第二阶段契约测试、导出测试、结果一致性测试

---

## 推荐分发给后续智能体的执行顺序

- **任务 7｜backend**
  - 标签映射校正 + 多标签评估升级
- **任务 8｜backend**
  - summaryMetricsV2 + per-class metrics + confusion / agreement / intensity
- **任务 9｜backend**
  - ablation variant 设计与接口输出
- **任务 10｜frontend-admin**
  - 第二阶段前端展示分层
- **任务 11｜qa**
  - 第二阶段回归与实验结果验证
