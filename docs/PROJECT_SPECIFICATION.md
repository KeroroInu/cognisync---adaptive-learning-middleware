# CogniSync 项目完整规格文档

## 目录
- [1. 项目概述](#1-项目概述)
- [2. 系统架构](#2-系统架构)
- [3. 核心功能模块](#3-核心功能模块)
- [4. 数据模型](#4-数据模型)
- [5. 后端接口规格](#5-后端接口规格)
- [6. 业务流程](#6-业务流程)
- [7. 技术实现细节](#7-技术实现细节)
- [8. 部署与配置](#8-部署与配置)

---

## 1. 项目概述

### 1.1 项目定位
CogniSync 是一个**教育智能代理中间件研究原型**，用于研究 AI-人类对齐度（AI-Human Alignment）在教育场景中的应用。

### 1.2 核心价值
- **实时学习者建模**: 通过对话交互动态构建三维学习者画像
- **知识图谱可视化**: 直观展示学习者的知识掌握程度和概念关系
- **人机协同校准**: 允许学习者纠正 AI 评估，记录分歧数据用于研究

### 1.3 研究目标
1. 量化 AI 模型预测与用户自我评估之间的差异
2. 探索用户对 AI 评估的信任度影响因素
3. 为 HCI 和教育技术研究提供实验数据

---

## 2. 系统架构

### 2.1 技术栈

#### 前端
```
框架: React 19.2 + TypeScript 5.8
构建: Vite 6.2
状态: React Hooks (自定义 store)
可视化: D3.js 7 + Recharts 3.6
样式: Tailwind CSS (内联)
```

#### 后端 (待实现)
```
框架: FastAPI / Flask / Express.js (推荐 FastAPI)
数据库: PostgreSQL / MongoDB (推荐 PostgreSQL)
缓存: Redis (可选)
AI: OpenAI API / Google Gemini API / 自部署模型
```

### 2.2 系统分层

```
┌─────────────────────────────────────┐
│   前端 UI 层 (React + TypeScript)    │
│   - 5个主要视图                       │
│   - 实时数据可视化                    │
│   - 交互式校准界面                    │
└─────────────────────────────────────┘
              ↕ REST API
┌─────────────────────────────────────┐
│   后端业务逻辑层 (FastAPI)           │
│   - 用户画像管理                      │
│   - 对话分析引擎                      │
│   - 知识图谱更新                      │
│   - 校准记录存储                      │
└─────────────────────────────────────┘
              ↕
┌─────────────────────────────────────┐
│   AI 服务层 (LLM API)                │
│   - 意图识别                          │
│   - 情感分析                          │
│   - 概念提取                          │
│   - 对话生成                          │
└─────────────────────────────────────┘
              ↕
┌─────────────────────────────────────┐
│   数据持久化层 (PostgreSQL + Redis)   │
│   - 用户画像表                        │
│   - 知识图谱表                        │
│   - 对话历史表                        │
│   - 校准日志表                        │
└─────────────────────────────────────┘
```

---

## 3. 核心功能模块

### 3.1 Dashboard (总览仪表板)

#### 功能描述
展示学习者的实时三维画像和关键指标。

#### 前端组件
- **路径**: `views/Dashboard.tsx`
- **依赖数据**:
  - `UserProfile`: 三维画像 (cognition/affect/behavior)
  - 近期变化趋势

#### 后端需求
- **接口**: `GET /api/profile/:userId`
- **返回数据**:
  ```json
  {
    "profile": {
      "cognition": 65,
      "affect": 42,
      "behavior": 78,
      "lastUpdate": "2025-01-19T10:30:00Z"
    },
    "recentChanges": [
      {"dimension": "cognition", "delta": 5, "timestamp": "..."},
      {"dimension": "affect", "delta": -3, "timestamp": "..."}
    ]
  }
  ```

#### 业务规则
- 画像分数范围: 0-100
- 每次对话后实时更新
- 低于 50 的维度显示警告色

---

### 3.2 Chat (对话交互)

#### 功能描述
用户与 AI 导师对话，系统实时分析对话内容并更新画像。

#### 前端组件
- **路径**: `views/Chat.tsx`
- **状态管理**:
  - 消息历史: `ChatMessage[]`
  - 当前输入: `string`
  - 加载状态: `boolean`

#### 后端需求

##### 3.2.1 发送消息接口
**接口**: `POST /api/chat`

**请求体**:
```json
{
  "userId": "user_123",
  "message": "我不太理解过拟合的概念",
  "sessionId": "session_abc",
  "timestamp": "2025-01-19T10:30:00Z"
}
```

**响应体**:
```json
{
  "messageId": "msg_456",
  "reply": "过拟合是指模型在训练数据上表现很好，但在新数据上泛化能力差...",
  "analysis": {
    "intent": "help-seeking",
    "emotion": "confused",
    "detectedConcepts": ["过拟合", "泛化"],
    "profileDelta": {
      "cognition": -5,
      "affect": -10,
      "behavior": 2
    }
  },
  "updatedProfile": {
    "cognition": 60,
    "affect": 32,
    "behavior": 80
  },
  "timestamp": "2025-01-19T10:30:05Z"
}
```

##### 3.2.2 分析规则

**意图识别 (Intent Detection)**
| 用户输入特征 | 意图标签 | 画像影响 |
|-------------|---------|---------|
| 包含"不懂"、"困惑"、"不理解" | `help-seeking` | cognition -5, affect -10 |
| 包含"是的"、"明白了"、"好" | `confirmation` | cognition +8, affect +5 |
| 提出问题 | `question` | cognition +2, behavior +5 |
| 陈述观点 | `statement` | behavior +3 |

**情感分析 (Emotion Recognition)**
| 情感状态 | 关键词 | 影响 |
|---------|--------|-----|
| `confused` | 困惑、不懂、难 | affect -10 |
| `confident` | 明白、简单、掌握 | affect +8 |
| `frustrated` | 烦、太难、放弃 | affect -15, behavior -5 |
| `neutral` | 默认状态 | 无影响 |

**概念提取 (Concept Extraction)**
- 从用户消息中提取技术术语
- 与知识图谱节点匹配
- 更新对应节点的频率 (frequency +1)

---

### 3.3 Knowledge Graph (知识图谱)

#### 功能描述
力导向图展示学习者的知识结构，支持拖拽、搜索、校准。

#### 前端组件
- **路径**: `views/KnowledgeGraph.tsx`
- **可视化**: D3.js force simulation
- **交互**:
  - 拖拽节点
  - 点击查看详情
  - 搜索过滤 (透明度动画)
  - 校准掌握度

#### 后端需求

##### 3.3.1 获取知识图谱
**接口**: `GET /api/knowledge-graph/:userId`

**响应体**:
```json
{
  "nodes": [
    {
      "id": "node_1",
      "name": "神经网络",
      "mastery": 85,
      "frequency": 8,
      "description": "受生物神经网络启发的计算系统",
      "isFlagged": false,
      "lastUpdated": "2025-01-19T10:30:00Z"
    }
  ],
  "edges": [
    {
      "source": "node_1",
      "target": "node_2",
      "strength": 0.8
    }
  ]
}
```

##### 3.3.2 更新节点掌握度
**接口**: `PUT /api/knowledge-graph/nodes/:nodeId`

**请求体**:
```json
{
  "userId": "user_123",
  "mastery": 60,
  "reason": "我觉得我对这个概念的理解没有那么深",
  "isFlagged": true
}
```

**响应体**:
```json
{
  "success": true,
  "updatedNode": {
    "id": "node_1",
    "mastery": 60,
    "isFlagged": true
  },
  "calibrationLogId": "cal_789"
}
```

#### 视觉编码规则
| 属性 | 映射 | 说明 |
|------|------|------|
| 节点大小 | `15 + frequency * 2` | 提及次数越多越大 |
| 节点颜色 | `mastery < 50`: 红色<br>`50-80`: 黄色<br>`>80`: 绿色 | 掌握度 |
| 边框 | `isFlagged`: 白色粗边框 | 用户曾纠偏 |

---

### 3.4 Calibration (校准面板)

#### 功能描述
用户调整三维画像，提交分歧原因和信任评分。

#### 前端组件
- **路径**: `views/Calibration.tsx`
- **核心交互**:
  - 三个滑块 (cognition/affect/behavior)
  - 双雷达图对比
  - 分歧指数实时计算
  - Likert 量表 (1-5)

#### 后端需求

##### 3.4.1 提交画像校准
**接口**: `POST /api/calibration/profile`

**请求体**:
```json
{
  "userId": "user_123",
  "modelProfile": {
    "cognition": 65,
    "affect": 42,
    "behavior": 78
  },
  "userProfile": {
    "cognition": 70,
    "affect": 50,
    "behavior": 80
  },
  "reason": "我觉得我比模型评估的要自信一些",
  "likertTrust": 4,
  "timestamp": "2025-01-19T10:30:00Z"
}
```

**响应体**:
```json
{
  "calibrationLogId": "cal_890",
  "disagreementIndex": 15,
  "success": true
}
```

#### 分歧指数计算
```python
disagreement_index = (
    abs(model.cognition - user.cognition) +
    abs(model.affect - user.affect) +
    abs(model.behavior - user.behavior)
)
```

**阈值定义**:
- `< 20`: 高度一致
- `20-50`: 中度分歧
- `> 50`: 显著分歧

---

### 3.5 Evidence (证据日志)

#### 功能描述
时间轴展示所有校准事件，支持导出 JSON。

#### 前端组件
- **路径**: `views/Evidence.tsx`
- **展示内容**:
  - 校准时间
  - 类型 (Profile / Node)
  - 模型值 vs 用户值
  - 分歧指数
  - 用户理由

#### 后端需求

##### 3.5.1 获取校准日志
**接口**: `GET /api/calibration/logs/:userId`

**查询参数**:
- `startDate`: ISO 8601 格式
- `endDate`: ISO 8601 格式
- `type`: `profile` | `node` | `all`

**响应体**:
```json
{
  "logs": [
    {
      "id": "cal_890",
      "timestamp": "2025-01-19T10:30:00Z",
      "type": "Profile",
      "targetId": null,
      "modelValue": {"cognition": 65, "affect": 42, "behavior": 78},
      "userValue": {"cognition": 70, "affect": 50, "behavior": 80},
      "reason": "我觉得我比模型评估的要自信一些",
      "disagreementIndex": 15,
      "likertTrust": 4
    },
    {
      "id": "cal_891",
      "timestamp": "2025-01-19T10:35:00Z",
      "type": "Node",
      "targetId": "node_1",
      "modelValue": 85,
      "userValue": 60,
      "reason": "我对这个概念的理解没有那么深",
      "disagreementIndex": 25,
      "likertTrust": null
    }
  ],
  "total": 2
}
```

##### 3.5.2 导出研究数据
**接口**: `GET /api/export/:userId`

**响应**: JSON 文件下载
```json
{
  "userId": "user_123",
  "exportDate": "2025-01-19T10:30:00Z",
  "profile": {...},
  "knowledgeGraph": {...},
  "messages": [...],
  "calibrationLogs": [...]
}
```

---

## 4. 数据模型

### 4.1 用户画像表 (user_profiles)

```sql
CREATE TABLE user_profiles (
    user_id VARCHAR(255) PRIMARY KEY,
    cognition INTEGER CHECK (cognition BETWEEN 0 AND 100),
    affect INTEGER CHECK (affect BETWEEN 0 AND 100),
    behavior INTEGER CHECK (behavior BETWEEN 0 AND 100),
    last_update TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

### 4.2 知识节点表 (knowledge_nodes)

```sql
CREATE TABLE knowledge_nodes (
    id VARCHAR(255) PRIMARY KEY,
    user_id VARCHAR(255) REFERENCES user_profiles(user_id),
    name VARCHAR(255) NOT NULL,
    mastery INTEGER CHECK (mastery BETWEEN 0 AND 100),
    frequency INTEGER CHECK (frequency BETWEEN 1 AND 10),
    description TEXT,
    is_flagged BOOLEAN DEFAULT FALSE,
    last_updated TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, name)
);
```

### 4.3 知识边表 (knowledge_edges)

```sql
CREATE TABLE knowledge_edges (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) REFERENCES user_profiles(user_id),
    source_node_id VARCHAR(255) REFERENCES knowledge_nodes(id),
    target_node_id VARCHAR(255) REFERENCES knowledge_nodes(id),
    strength FLOAT DEFAULT 1.0,
    UNIQUE(user_id, source_node_id, target_node_id)
);
```

### 4.4 对话消息表 (chat_messages)

```sql
CREATE TABLE chat_messages (
    id VARCHAR(255) PRIMARY KEY,
    user_id VARCHAR(255) REFERENCES user_profiles(user_id),
    session_id VARCHAR(255),
    role VARCHAR(20) CHECK (role IN ('user', 'assistant')),
    message TEXT NOT NULL,
    analysis JSONB,
    timestamp TIMESTAMP NOT NULL,
    INDEX (user_id, session_id, timestamp)
);
```

**analysis 字段结构**:
```json
{
  "intent": "help-seeking",
  "emotion": "confused",
  "detectedConcepts": ["过拟合", "泛化"],
  "profileDelta": {
    "cognition": -5,
    "affect": -10,
    "behavior": 2
  }
}
```

### 4.5 校准日志表 (calibration_logs)

```sql
CREATE TABLE calibration_logs (
    id VARCHAR(255) PRIMARY KEY,
    user_id VARCHAR(255) REFERENCES user_profiles(user_id),
    timestamp TIMESTAMP NOT NULL,
    type VARCHAR(20) CHECK (type IN ('Profile', 'Node')),
    target_id VARCHAR(255),
    model_value JSONB NOT NULL,
    user_value JSONB NOT NULL,
    reason TEXT,
    disagreement_index FLOAT NOT NULL,
    likert_trust INTEGER CHECK (likert_trust BETWEEN 1 AND 5),
    INDEX (user_id, timestamp)
);
```

---

## 5. 后端接口规格

### 5.1 接口清单

| 端点 | 方法 | 功能 | 优先级 |
|------|------|------|--------|
| `/api/profile/:userId` | GET | 获取用户画像 | P0 |
| `/api/profile` | POST | 创建用户画像 | P0 |
| `/api/chat` | POST | 发送消息并获取回复 | P0 |
| `/api/chat/history/:userId` | GET | 获取对话历史 | P1 |
| `/api/knowledge-graph/:userId` | GET | 获取知识图谱 | P0 |
| `/api/knowledge-graph/nodes/:nodeId` | PUT | 更新节点掌握度 | P0 |
| `/api/calibration/profile` | POST | 提交画像校准 | P0 |
| `/api/calibration/logs/:userId` | GET | 获取校准日志 | P1 |
| `/api/export/:userId` | GET | 导出研究数据 | P1 |

### 5.2 通用响应格式

#### 成功响应
```json
{
  "success": true,
  "data": {...},
  "timestamp": "2025-01-19T10:30:00Z"
}
```

#### 错误响应
```json
{
  "success": false,
  "error": {
    "code": "PROFILE_NOT_FOUND",
    "message": "User profile not found for user_id: user_123",
    "details": {}
  },
  "timestamp": "2025-01-19T10:30:00Z"
}
```

### 5.3 认证与授权

**推荐方案**: JWT Token

**请求头**:
```
Authorization: Bearer <token>
```

**Payload 结构**:
```json
{
  "userId": "user_123",
  "role": "learner",
  "exp": 1737300000
}
```

---

## 6. 业务流程

### 6.1 用户首次进入流程

```
1. 前端检查 localStorage 中是否有 userId
   ├─ 有 → 跳转到 Dashboard
   └─ 无 → 生成新 userId (客户端生成 UUID)

2. 前端调用 POST /api/profile 创建初始画像
   请求: { "userId": "user_123" }
   响应: 返回初始化的画像数据

3. 前端初始化知识图谱
   调用 POST /api/knowledge-graph/init
   请求: { "userId": "user_123", "domain": "machine-learning" }
   响应: 返回预设的知识节点和边

4. 跳转到 Dashboard
```

### 6.2 对话交互流程

```
1. 用户在 Chat 页面输入消息

2. 前端调用 POST /api/chat
   请求: { "userId": "user_123", "message": "什么是过拟合？" }

3. 后端处理流程:
   ├─ 保存用户消息到数据库
   ├─ 调用 LLM API 进行分析
   │   ├─ 意图识别
   │   ├─ 情感分析
   │   └─ 概念提取
   ├─ 计算画像增量 (profileDelta)
   ├─ 更新 user_profiles 表
   ├─ 更新 knowledge_nodes 频率
   ├─ 生成 AI 回复
   └─ 保存 AI 消息到数据库

4. 前端接收响应:
   ├─ 显示 AI 回复
   ├─ 更新本地画像状态
   ├─ 在侧边栏显示分析结果
   └─ 触发 Dashboard 雷达图动画
```

### 6.3 知识点校准流程

```
1. 用户在 Knowledge Graph 页面点击节点

2. 侧边栏显示节点详情:
   ├─ 当前掌握度: 85%
   ├─ 定义说明
   └─ "我不同意这个评估" 按钮

3. 用户点击校准按钮:
   ├─ 显示滑块 (0-100)
   ├─ 用户调整到 60%
   └─ 填写原因: "我还不太理解反向传播的数学原理"

4. 前端调用 PUT /api/knowledge-graph/nodes/:nodeId

5. 后端处理:
   ├─ 更新 knowledge_nodes.mastery = 60
   ├─ 设置 is_flagged = true
   ├─ 创建 calibration_logs 记录
   │   ├─ type = 'Node'
   │   ├─ model_value = 85
   │   ├─ user_value = 60
   │   └─ disagreement_index = 25
   └─ 返回成功响应

6. 前端更新:
   ├─ D3 图谱中节点颜色变化 (绿 → 黄)
   ├─ 节点边框变为白色 (标记)
   └─ 侧边栏显示"已标记"徽章
```

### 6.4 画像校准流程

```
1. 用户在 Calibration 页面看到双雷达图对比
   ├─ 紫色: AI 评估 (cognition:65, affect:42, behavior:78)
   └─ 绿色: 用户自评 (初始与 AI 相同)

2. 用户调整三个滑块:
   ├─ cognition: 70 (+5)
   ├─ affect: 50 (+8)
   └─ behavior: 80 (+2)

3. 实时计算分歧指数:
   disagreementIndex = |65-70| + |42-50| + |78-80| = 15

4. 用户选择信任评分: 4/5

5. 用户填写原因: "我觉得我比模型评估的要自信一些"

6. 前端调用 POST /api/calibration/profile

7. 后端处理:
   ├─ 保存到 calibration_logs 表
   ├─ (可选) 更新 user_profiles 使用用户值
   └─ 返回校准日志 ID

8. 前端显示成功提示 3 秒后自动消失
```

---

## 7. 技术实现细节

### 7.1 LLM 集成方案

#### 方案 A: OpenAI GPT-4
```python
import openai

def analyze_message(user_message: str, profile: dict) -> dict:
    prompt = f"""
    分析以下学生消息，输出 JSON 格式:
    {{
      "intent": "help-seeking | confirmation | question | statement",
      "emotion": "confused | confident | frustrated | neutral",
      "detectedConcepts": ["概念1", "概念2"],
      "profileDelta": {{"cognition": 0, "affect": 0, "behavior": 0}}
    }}

    当前学生画像: {profile}
    学生消息: "{user_message}"
    """

    response = openai.ChatCompletion.create(
        model="gpt-4",
        messages=[{"role": "system", "content": prompt}],
        temperature=0.3
    )

    return json.loads(response.choices[0].message.content)
```

#### 方案 B: Google Gemini
```python
import google.generativeai as genai

def analyze_message(user_message: str, profile: dict) -> dict:
    model = genai.GenerativeModel('gemini-pro')

    prompt = f"""
    分析学生消息并返回 JSON:
    学生画像: {profile}
    消息: "{user_message}"
    """

    response = model.generate_content(prompt)
    return json.loads(response.text)
```

### 7.2 实时画像更新算法

```python
def update_profile(
    current_profile: dict,
    delta: dict,
    decay_factor: float = 0.95
) -> dict:
    """
    应用增量并加入衰减因子

    Args:
        current_profile: 当前画像
        delta: 增量变化
        decay_factor: 衰减系数 (避免极值)

    Returns:
        更新后的画像
    """
    updated = {}
    for dim in ['cognition', 'affect', 'behavior']:
        raw_value = current_profile[dim] + delta.get(dim, 0)
        # 应用衰减
        if raw_value > current_profile[dim]:
            raw_value = current_profile[dim] + (raw_value - current_profile[dim]) * decay_factor
        # 限制范围
        updated[dim] = max(0, min(100, int(raw_value)))

    return updated
```

### 7.3 知识图谱初始化

```python
# 预定义的机器学习领域知识图谱
ML_KNOWLEDGE_GRAPH = {
    "nodes": [
        {"id": "ml", "name": "机器学习", "mastery": 50, "frequency": 1},
        {"id": "nn", "name": "神经网络", "mastery": 40, "frequency": 1},
        {"id": "bp", "name": "反向传播", "mastery": 30, "frequency": 1},
        {"id": "gd", "name": "梯度下降", "mastery": 35, "frequency": 1},
        {"id": "act", "name": "激活函数", "mastery": 60, "frequency": 1},
        {"id": "overfitting", "name": "过拟合", "mastery": 25, "frequency": 1},
    ],
    "edges": [
        {"source": "ml", "target": "nn"},
        {"source": "nn", "target": "bp"},
        {"source": "bp", "target": "gd"},
        {"source": "nn", "target": "act"},
        {"source": "nn", "target": "overfitting"},
    ]
}
```

### 7.4 概念匹配算法

```python
from difflib import SequenceMatcher

def match_concepts(
    user_message: str,
    knowledge_nodes: list[dict]
) -> list[str]:
    """
    从用户消息中提取匹配的概念

    Args:
        user_message: 用户输入
        knowledge_nodes: 知识节点列表

    Returns:
        匹配的概念名称列表
    """
    matched = []
    message_lower = user_message.lower()

    for node in knowledge_nodes:
        node_name_lower = node['name'].lower()

        # 精确匹配
        if node_name_lower in message_lower:
            matched.append(node['name'])
            continue

        # 模糊匹配 (相似度 > 0.8)
        ratio = SequenceMatcher(None, node_name_lower, message_lower).ratio()
        if ratio > 0.8:
            matched.append(node['name'])

    return matched
```

---

## 8. 部署与配置

### 8.1 环境变量 (.env)

```bash
# 数据库配置
DATABASE_URL=postgresql://user:pass@localhost:5432/cognisync
REDIS_URL=redis://localhost:6379/0

# AI API 配置
OPENAI_API_KEY=sk-xxx
OPENAI_MODEL=gpt-4

# 应用配置
SECRET_KEY=your-secret-key-here
DEBUG=False
CORS_ORIGINS=http://localhost:3000,https://yourdomain.com

# 日志配置
LOG_LEVEL=INFO
LOG_FORMAT=json
```

### 8.2 Docker Compose 部署

```yaml
version: '3.8'

services:
  frontend:
    build: .
    ports:
      - "3000:3000"
    environment:
      - VITE_API_URL=http://localhost:8000

  backend:
    build: ./backend
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
    depends_on:
      - postgres
      - redis

  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: cognisync
      POSTGRES_USER: cognisync_user
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  postgres_data:
```

### 8.3 API 性能指标

| 端点 | 目标响应时间 | 备注 |
|------|-------------|------|
| `GET /api/profile/:userId` | < 100ms | 简单查询 |
| `POST /api/chat` | < 3s | 依赖 LLM API |
| `GET /api/knowledge-graph/:userId` | < 200ms | 包含关联查询 |
| `POST /api/calibration/profile` | < 300ms | 写入操作 |

### 8.4 数据库索引优化

```sql
-- 用户画像查询优化
CREATE INDEX idx_user_profiles_user_id ON user_profiles(user_id);

-- 对话历史查询优化
CREATE INDEX idx_chat_messages_user_session
ON chat_messages(user_id, session_id, timestamp DESC);

-- 校准日志查询优化
CREATE INDEX idx_calibration_logs_user_time
ON calibration_logs(user_id, timestamp DESC);

-- 知识图谱查询优化
CREATE INDEX idx_knowledge_nodes_user
ON knowledge_nodes(user_id, last_updated DESC);
```

---

## 9. 后续优化建议

### 9.1 功能扩展
- [ ] 多模态输入 (语音、图片)
- [ ] 学习路径推荐 (基于知识图谱)
- [ ] 协同学习 (多用户对比)
- [ ] 实时通知 (WebSocket)

### 9.2 性能优化
- [ ] Redis 缓存画像数据
- [ ] LLM 响应流式传输
- [ ] GraphQL 替代 REST
- [ ] CDN 加速静态资源

### 9.3 研究功能
- [ ] A/B 测试框架
- [ ] 用户行为埋点
- [ ] 分歧度趋势分析
- [ ] 信任度预测模型

---

## 10. 附录

### 10.1 前端现有代码结构

```
src/
├── App.tsx                    # 主应用组件
├── types.ts                   # 全局类型定义
├── constants.ts               # 初始化数据
├── components/
│   ├── Layout.tsx            # 布局框架
│   └── RadarDisplay.tsx      # 雷达图组件
├── views/
│   ├── Dashboard.tsx         # 总览页
│   ├── Chat.tsx              # 对话页
│   ├── KnowledgeGraph.tsx    # 图谱页
│   ├── Calibration.tsx       # 校准页
│   └── Evidence.tsx          # 日志页
├── services/
│   └── store.ts              # 状态管理
└── utils/
    └── translations.ts       # 国际化
```

### 10.2 关键类型定义

```typescript
// types.ts
export interface UserProfile {
  cognition: number;
  affect: number;
  behavior: number;
  lastUpdate: string;
}

export interface Node {
  id: string;
  name: string;
  mastery: number;
  frequency: number;
  description: string;
  isFlagged?: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  analysis?: {
    intent: string;
    emotion: string;
    detectedConcepts: string[];
    delta: Partial<UserProfile>;
  };
}

export interface CalibrationLog {
  id: string;
  timestamp: string;
  type: 'Profile' | 'Node';
  targetId?: string;
  modelValue: number | UserProfile;
  userValue: number | UserProfile;
  reason: string;
  disagreementIndex: number;
  likertTrust?: number;
}
```

---

**文档版本**: v1.0
**最后更新**: 2025-01-19
**维护者**: CogniSync Team
