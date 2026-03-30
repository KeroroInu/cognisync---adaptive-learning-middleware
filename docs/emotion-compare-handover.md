# 情感对比实验交接与提测说明

## 目标

本说明用于当前第一阶段“情感对比实验”功能的本地演示、提测交接和问题收口。当前范围聚焦最小研究闭环，而不是完整论文指标平台。

当前已经完成的能力：

1. 统一数据集输入适配
2. 单页管理后台入口
3. Baseline 与 CogniSync system 双侧输出
4. 逐条 comparisonRows 对比
5. 最小 summaryMetrics
6. CSV / JSON 导出

---

## 当前可交付范围

### 已实现模块

- **backend**
  - 统一对比实验接口：[emotion_compare.py](file:///Users/kero_o/Desktop/cognisync---adaptive-learning-middleware/backend/app/api/endpoints/admin/emotion_compare.py)
  - 数据集适配与对比分析服务：[emotion_compare_service.py](file:///Users/kero_o/Desktop/cognisync---adaptive-learning-middleware/backend/app/services/emotion_compare_service.py)
  - 对比实验 schema：[emotion_compare.py](file:///Users/kero_o/Desktop/cognisync---adaptive-learning-middleware/backend/app/schemas/admin/emotion_compare.py)
- **admin-frontend**
  - 单页入口：[EmotionCompare.tsx](file:///Users/kero_o/Desktop/cognisync---adaptive-learning-middleware/admin-frontend/src/pages/EmotionCompare.tsx)
  - 路由注册：[App.tsx](file:///Users/kero_o/Desktop/cognisync---adaptive-learning-middleware/admin-frontend/src/App.tsx)
  - 左侧导航：[AdminLayout.tsx](file:///Users/kero_o/Desktop/cognisync---adaptive-learning-middleware/admin-frontend/src/components/AdminLayout.tsx)
  - API 映射：[adminApi.ts](file:///Users/kero_o/Desktop/cognisync---adaptive-learning-middleware/admin-frontend/src/lib/adminApi.ts)
- **docs**
  - 开发设计说明：[emotion-compare-dev.md](file:///Users/kero_o/Desktop/cognisync---adaptive-learning-middleware/docs/emotion-compare-dev.md)

### 当前页面入口

- 管理后台登录页：`http://localhost:8003/admin/login`
- 情感对比实验页：`http://localhost:8003/admin/emotion-compare`

### 当前后端接口

- 登录接口：`POST /api/admin/auth/login`
- 对比实验接口：`POST /api/admin/research/emotion-compare/analyze-dataset`

---

## 本地演示步骤

### 演示前准备

1. 启动完整环境：

```bash
POSTGRES_USER=cognisync POSTGRES_PASSWORD=cognisync_dev_password_2024 POSTGRES_DB=cognisync_db NEO4J_PASSWORD=cognisync_neo4j_2024 docker compose up -d --build backend admin-frontend nginx-proxy
```

2. 打开管理后台：

- `http://localhost:8003/admin/login`

3. 登录账号：

- 账号：`admin`
- 密码：`adminkero`

### 演示路径 A：中文微博单标签

推荐数据集：

- [usual_train.txt](file:///Users/kero_o/Desktop/cognisync---adaptive-learning-middleware/%E6%B5%8B%E8%AF%95/%E8%AF%84%E6%B5%8B%E6%95%B0%E6%8D%AE%E9%9B%86/train/usual_train.txt)

页面操作：

1. 进入 `情感对比实验`
2. 选择模板：`中文微博单标签`
3. 上传 `usual_train.txt`
4. 保持默认字段：
   - 文本列：`content`
   - 标签模式：`单标签列`
   - 标签列：`label`
   - 样本 ID 列：`id`
5. 点击 `开始对比实验`

预期结果：

- 页面显示 `datasetInfo`
- 页面出现 Baseline / CogniSync 两列结果
- 页面出现 comparisonRows 主表
- summary 卡片显示：
  - Accuracy
  - Macro F1
  - Weighted F1
- 可以导出：
  - CSV
  - JSON

### 演示路径 B：GoEmotions 多标签

推荐数据集：

- [goemotions_train_clean.csv](file:///Users/kero_o/Desktop/cognisync---adaptive-learning-middleware/%E6%B5%8B%E8%AF%95/goemotions_train_clean.csv)

页面操作：

1. 进入 `情感对比实验`
2. 选择模板：`GoEmotions 多标签`
3. 上传 `goemotions_train_clean.csv`
4. 保持默认字段：
   - 文本列：`text`
   - 标签模式：`多标签 0/1 列`
   - 正样本取值：`1`
5. 点击 `开始对比实验`

预期结果：

- 页面显示 `taskType = multi_label`
- summary 卡片显示：
  - Exact Match
  - Overlap Match
  - Macro F1
- 页面出现 comparisonRows 主表
- 可以导出：
  - CSV
  - JSON

---

## 提测清单

### 功能提测

- **单标签输入**
  - 上传中文微博 JSON/txt 数据集
  - 成功返回 single_label 结果
- **多标签输入**
  - 上传 GoEmotions CSV
  - 成功返回 multi_label 结果
- **双侧结果**
  - Baseline 结果非空
  - System 结果非空
- **逐条主表**
  - comparisonRows 可见
  - `winner` 可见
- **导出**
  - comparison CSV 可下载
  - JSON 可下载

### 路由提测

- 新入口：
  - `/admin/emotion-compare`
- 兼容入口：
  - `/admin/analytics/emotion`
  - `/admin/emotion-experiments`

提测预期：

- 三个地址都可进入单页实验视图

### 错误处理提测

- 缺少文本列
- 缺少标签列
- 多标签列名不存在
- TXT/JSON 不是 JSON array
- 空文件上传
- 文件过大

提测预期：

- 前端显示中文错误提示
- 后端返回 400 或明确错误语义
- 不出现裸露的 Internal Server Error 作为首要反馈

### 工程质量提测

- 后端 pytest
- 后端 ruff
- 后端 mypy
- 前端 vitest
- 前端 tsc
- 前端 lint
- 前端 build

---

## 已知问题

### P1：中文微博 xlsx 样例不应作为当前标准演示输入

当前本地冒烟结论：

- [usual_train.txt](file:///Users/kero_o/Desktop/cognisync---adaptive-learning-middleware/%E6%B5%8B%E8%AF%95/%E8%AF%84%E6%B5%8B%E6%95%B0%E6%8D%AE%E9%9B%86/train/usual_train.txt) 可正常运行
- `usual_train.xlsx` 在本地 QA 冒烟中报 `File is not a zip file`

处理建议：

- 第一阶段演示与提测统一使用 `usual_train.txt`
- 如果后续必须支持该 xlsx，需要先确认该文件是否为有效 xlsx，或重新导出一份标准 Office Open XML 文件

### P1：多标签仍是第一阶段简化方案

当前实现特点：

- 每行最终仍是单个预测标签
- 与多标签真值集合进行：
  - exact match
  - overlap match
  - macro F1 的第一阶段近似计算

不代表：

- 完整多标签集合预测
- 完整 multilabel classifier 论文方案

### P2：旧页面文件仍保留

当前情况：

- 旧页面路由已重定向到新页
- 旧页面文件仍保留在仓库中，便于兼容与回退

处理建议：

- 第二阶段如果确认不再需要，可再做代码清理

### P2：Playwright 浏览器级自动化未完全落地

当前情况：

- 已完成接口 smoke 与页面级测试
- 但本机 Playwright 运行环境未准备完整，未完成真正浏览器自动操作链

处理建议：

- 如需 UI 自动回归，后续专门补 `@playwright/test` 与浏览器安装流程

---

## 风险矩阵

- **高**
  - 中文微博 xlsx 样例文件不可靠，容易导致演示失败
  - 多标签仍是第一阶段近似实现，不适合直接当最终论文结论
- **中**
  - 当前 system 主要体现画像增强，还未完整接入更强对话上下文 / 图谱上下文
  - 默认标签映射是研究期近似映射，仍需后续校正
- **低**
  - 旧页面文件仍在，但不影响当前主入口

---

## 验收标准

当前阶段可以视为“可交付”的标准：

1. 中文微博 txt/json 数据集可跑通
2. GoEmotions csv 数据集可跑通
3. 单页能展示：
   - datasetInfo
   - summaryMetrics
   - baselineRows
   - systemRows
   - comparisonRows
4. 可导出 CSV / JSON
5. 错误输入有明确提示
6. 前后端测试、lint、build、typecheck 已通过

---

## 推荐实施顺序

### 当前阶段收口

1. 使用 `usual_train.txt` 做中文演示
2. 使用 `goemotions_train_clean.csv` 做多标签演示
3. 按本说明进行提测

### 下一阶段建议

1. 校正标签映射表
2. 引入更真实的上下文输入
3. 增加 confusion matrix、kappa、ablation 等论文指标
4. 升级多标签为真正的标签集合预测
5. 清理旧页面和兼容层

---

## 交接说明

### 关键入口文件

- 后端接口：[emotion_compare.py](file:///Users/kero_o/Desktop/cognisync---adaptive-learning-middleware/backend/app/api/endpoints/admin/emotion_compare.py)
- 后端服务：[emotion_compare_service.py](file:///Users/kero_o/Desktop/cognisync---adaptive-learning-middleware/backend/app/services/emotion_compare_service.py)
- 前端页面：[EmotionCompare.tsx](file:///Users/kero_o/Desktop/cognisync---adaptive-learning-middleware/admin-frontend/src/pages/EmotionCompare.tsx)
- 前端 API：[adminApi.ts](file:///Users/kero_o/Desktop/cognisync---adaptive-learning-middleware/admin-frontend/src/lib/adminApi.ts)
- 开发设计说明：[emotion-compare-dev.md](file:///Users/kero_o/Desktop/cognisync---adaptive-learning-middleware/docs/emotion-compare-dev.md)

### 建议先用的数据集

- 中文单标签：
  - [usual_train.txt](file:///Users/kero_o/Desktop/cognisync---adaptive-learning-middleware/%E6%B5%8B%E8%AF%95/%E8%AF%84%E6%B5%8B%E6%95%B0%E6%8D%AE%E9%9B%86/train/usual_train.txt)
- 多标签：
  - [goemotions_train_clean.csv](file:///Users/kero_o/Desktop/cognisync---adaptive-learning-middleware/%E6%B5%8B%E8%AF%95/goemotions_train_clean.csv)

### 不建议当前阶段优先使用

- `usual_train.xlsx`

原因：

- 当前本地 QA 冒烟表明该文件不是可靠的标准 xlsx 输入。
