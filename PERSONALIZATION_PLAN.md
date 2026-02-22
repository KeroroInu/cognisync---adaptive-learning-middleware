# 个性化学习系统实现方案

## 需求概述

1. **清空前端写死内容**，基于用户注册画像生成初始知识图谱和个性化对话内容
2. **设计评分机制**（三维度：认知、情感、行为），让系统操作符合预设
3. **量表注册用户**初始知识图谱为空，通过对话逐步浮现

---

## 一、清空前端写死内容

### 1.1 Dashboard.tsx 修改

**问题**：
- "Recent Shifts"卡片中的"Cognitive Load +5"和"Frustration +12"是写死的

**解决方案**：
```typescript
// 移除写死的 Recent Shifts 卡片
// 改为动态获取最近的变化数据

// 在类型定义中添加
interface ProfileChange {
  dimension: string;
  change: number;
  trend: 'up' | 'down' | 'stable';
}

// 从后端 API 获取最近的变化
const [recentChanges, setRecentChanges] = useState<ProfileChange[]>([]);

useEffect(() => {
  const fetchRecentChanges = async () => {
    try {
      const response = await fetch(`/api/profile/recent-changes?userId=${userId}`);
      const data = await response.json();
      setRecentChanges(data.changes || []);
    } catch (error) {
      console.error('Failed to fetch recent changes:', error);
    }
  };

  fetchRecentChanges();
}, [userId]);
```

### 1.2 Chat.tsx 修改

**问题**：
- 写死的 userId: 'user123'

**解决方案**：
```typescript
// 从认证上下文获取真实的用户 ID
import { useAuth } from '../features/auth/hooks';

const { user } = useAuth();

// 在 handleSubmit 中使用真实的用户 ID
const response = await sendChatMessage({
  userId: user?.id || 'guest', // 使用真实的用户 ID
  message: userText,
  language,
  isResearchMode
});
```

---

## 二、基于用户画像生成初始知识图谱

### 2.1 三维度评分机制设计

基于教育心理学文献，设计如下评分规则：

#### **认知维度 (Cognition) [0-100]**

| 分数段 | 描述 | 教学策略 |
|--------|------|----------|
| 0-30 | 基础认知水平，需要大量指导 | 提供详细步骤，减少认知负荷，使用简单语言 |
| 31-60 | 中等认知水平，需要一定指导 | 提供概念框架，逐步引导，鼓励主动思考 |
| 61-80 | 较高认知水平，需要较少指导 | 提供挑战性任务，鼓励自主探索，强调应用 |
| 81-100 | 高级认知水平，可自主学习 | 提供开放性问题，引导深度思考，鼓励创新 |

#### **情感维度 (Affect) [0-100]**

| 分数段 | 描述 | 教学策略 |
|--------|------|----------|
| 0-30 | 消极情绪，容易放弃 | 增加鼓励，降低难度，强调进步 |
| 31-60 | 中性情绪，动力不足 | 增加趣味性，设置小目标，及时反馈 |
| 61-80 | 积极情绪，有兴趣 | 提供有趣内容，保持挑战性 |
| 81-100 | 非常积极，高度投入 | 提供深度内容，鼓励探索，给予认可 |

#### **行为维度 (Behavior) [0-100]**

| 分数段 | 描述 | 教学策略 |
|--------|------|----------|
| 0-30 | 行为不稳定，缺乏规律 | 建立学习习惯，设置提醒，减少干扰 |
| 31-60 | 行为较稳定，有规律 | 提供学习计划，鼓励坚持 |
| 61-80 | 行为稳定，有良好习惯 | 鼓励自主学习，提供多样化资源 |
| 81-100 | 行为非常稳定，高度自律 | 提供高级资源，鼓励分享和教学 |

### 2.2 生成初始知识图谱

**原理**：根据用户的三维度评分，生成相关的概念和知识点

**算法**：
```python
async def generate_initial_graph(
    cognition: float,
    affect: float,
    behavior: float
) -> List[Concept]:
    """
    根据用户画像生成初始知识图谱

    Args:
        cognition: 认知维度 [0-100]
        affect: 情感维度 [0-100]
        behavior: 行为维度 [0-100]

    Returns:
        初始概念列表
    """
    # 根据认知维度选择知识深度
    if cognition <= 30:
        depth = "basic"
    elif cognition <= 60:
        depth = "intermediate"
    elif cognition <= 80:
        depth = "advanced"
    else:
        depth = "expert"

    # 根据情感维度选择知识点类型
    if affect <= 30:
        topic_type = "engaging"  # 需要有趣的内容
    elif affect <= 60:
        topic_type = "balanced"  # 平衡的内容
    elif affect <= 80:
        topic_type = "challenging"  # 有挑战性的内容
    else:
        topic_type = "exploratory"  # 探索性的内容

    # 根据行为维度选择学习路径
    if behavior <= 30:
        path_type = "guided"  # 需要引导的路径
    elif behavior <= 60:
        path_type = "structured"  # 结构化的路径
    elif behavior <= 80:
        path_type = "flexible"  # 灵活的路径
    else:
        path_type = "self_directed"  # 自主学习的路径

    # 生成初始概念
    concepts = await llm_provider.generate_concepts(
        depth=depth,
        topic_type=topic_type,
        path_type=path_type,
        num_concepts=10  # 初始生成10个概念
    )

    return concepts
```

### 2.3 个性化对话内容生成

**系统提示词生成**：
```python
def build_personalized_prompt(
    user_profile: UserProfile,
    knowledge_graph: List[Concept],
    emotion: str,
    language: str
) -> str:
    """
    构建个性化系统提示词

    Args:
        user_profile: 用户画像
        knowledge_graph: 知识图谱
        emotion: 当前情感状态
        language: 界面语言

    Returns:
        个性化系统提示词
    """

    # 1. 基础角色定义
    base_role = {
        "zh": f"你是一个专业的教育助手，帮助学习者理解和掌握知识。",
        "en": "You are a professional educational assistant helping learners understand and master knowledge."
    }[language]

    # 2. 根据认知维度调整内容深度
    cognition_instruction = {
        "zh": {
            "basic": "使用简单、清晰的语言，避免专业术语，多用类比和例子。",
            "intermediate": "使用中等难度的语言，可以适当使用专业术语，但要解释清楚。",
            "advanced": "可以使用专业术语，提供深入的内容和复杂的概念。",
            "expert": "可以使用高度专业的语言，提供最前沿的知识和深度分析。"
        },
        "en": {
            "basic": "Use simple, clear language. Avoid jargon. Use analogies and examples.",
            "intermediate": "Use moderate language. You can use some technical terms but explain them clearly.",
            "advanced": "Use technical terms. Provide in-depth content and complex concepts.",
            "expert": "Use highly professional language. Provide cutting-edge knowledge and deep analysis."
        }
    }

    cognition_level = get_cognition_level(user_profile.cognition)
    cognition_msg = cognition_instruction[language][cognition_level]

    # 3. 根据情感维度调整语气
    affect_instruction = {
        "zh": {
            "low": "保持温和、鼓励的语气。多用积极的话语，避免让用户感到压力。",
            "medium": "保持友好、耐心的态度。适当使用鼓励的话语。",
            "high": "保持积极、热情的语气。鼓励用户深入探索。",
            "very_high": "保持挑战性、探索性的语气。鼓励用户创新和独立思考。"
        },
        "en": {
            "low": "Be gentle and encouraging. Use positive words. Avoid making the user feel pressured.",
            "medium": "Be friendly and patient. Use some encouraging words.",
            "high": "Be positive and enthusiastic. Encourage the user to explore deeply.",
            "very_high": "Be challenging and exploratory. Encourage the user to innovate and think independently."
        }
    }

    affect_level = get_affect_level(user_profile.affect)
    affect_msg = affect_instruction[language][affect_level]

    # 4. 根据行为维度调整互动方式
    behavior_instruction = {
        "zh": {
            "guided": "提供明确的指导和建议，帮助用户建立学习习惯。",
            "structured": "提供结构化的学习路径，鼓励用户按照计划学习。",
            "flexible": "提供灵活的学习建议，允许用户按照自己的节奏学习。",
            "self_directed": "尊重用户的自主学习，只在必要时提供建议。"
        },
        "en": {
            "guided": "Provide clear guidance and suggestions to help the user establish learning habits.",
            "structured": "Provide structured learning paths and encourage the user to follow the plan.",
            "flexible": "Provide flexible learning suggestions and allow the user to learn at their own pace.",
            "self_directed": "Respect the user's self-directed learning and only provide suggestions when necessary."
        }
    }

    behavior_level = get_behavior_level(user_profile.behavior)
    behavior_msg = behavior_instruction[language][behavior_level]

    # 5. 根据知识图谱提供针对性内容
    key_concepts = [c.name for c in knowledge_graph[:5]]  # 取前5个关键概念
    concepts_msg = {
        "zh": f"用户当前关注的知识点：{', '.join(key_concepts)}。在对话中，尽量围绕这些知识点展开。",
        "en": f"User's current focus areas: {', '.join(key_concepts)}. Try to center the conversation around these topics."
    }[language]

    # 6. 组合完整的系统提示词
    system_prompt = f"""{base_role}

当前用户画像：
- 认知维度: {user_profile.cognition}/100 ({get_cognition_description(user_profile.cognition)})
- 情感维度: {user_profile.affect}/100 ({get_affect_description(user_profile.affect)})
- 行为维度: {user_profile.behavior}/100 ({get_behavior_description(user_profile.behavior)})

教学指导：
1. 内容深度：{cognition_msg}
2. 语气调整：{affect_msg}
3. 互动方式：{behavior_msg}
4. 知识点：{concepts_msg}

当前情感状态：{emotion}

请根据上述指导，为用户提供个性化的学习支持。
"""

    return system_prompt
```

---

## 三、量表注册用户的知识图谱

### 3.1 初始状态

**AI 引导入职**：
- 有完整的初始画像（cognition, affect, behavior）
- 生成初始知识图谱（10-15个概念）

**量表入职**：
- 有完整的初始画像（cognition, affect, behavior）
- 初始知识图谱为空（`[]`）

### 3.2 逐步浮现机制

```python
async def update_graph_from_conversation(
    user_id: str,
    message: str,
    current_graph: List[Concept],
    user_profile: UserProfile
) -> List[Concept]:
    """
    根据对话内容更新知识图谱

    Args:
        user_id: 用户 ID
        message: 用户消息
        current_graph: 当前知识图谱
        user_profile: 用户画像

    Returns:
        更新后的知识图谱
    """
    # 1. 分析消息中的概念
    analyzer = TextAnalyzer()
    analysis = await analyzer.analyze(
        user_message=message,
        recent_messages=[]
    )

    # 2. 如果有检测到新概念，添加到图谱
    if analysis.detectedConcepts:
        # 对于量表注册用户，初始图谱为空，这是浮现的起点
        new_concepts = [
            Concept(
                id=str(uuid.uuid4()),
                name=concept.name,
                category=concept.category,
                importance=calculate_importance(
                    concept,
                    user_profile
                ),
                related_concepts=find_related_concepts(
                    concept,
                    current_graph
                )
            )
            for concept in analysis.detectedConcepts
        ]

        # 合并新旧概念（去重）
        updated_graph = merge_concepts(current_graph, new_concepts)

        # 保存到数据库
        graph_service = GraphService()
        await graph_service.upsert_concepts(
            user_id=user_id,
            concepts=updated_graph
        )

        return updated_graph

    # 3. 如果没有新概念，返回当前图谱
    return current_graph
```

---

## 四、实现步骤

### 步骤 1：后端 API 扩展

**新增 API 端点**：

```python
# backend/app/api/endpoints/profile.py

@router.get("/recent-changes", response_model=SuccessResponse[ProfileChangesResponse])
async def get_recent_changes(
    user_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    获取用户画像的最近变化

    返回最近5次对话导致的画像变化
    """
    profile_service = ProfileService(db)
    changes = await profile_service.get_recent_changes(
        user_id=uuid.UUID(user_id),
        limit=5
    )

    return SuccessResponse(data={"changes": changes})
```

### 步骤 2：修改注册接口

```python
# backend/app/api/endpoints/auth.py

@router.post("/register", response_model=AuthResponse)
async def register(data: RegisterRequest, db: AsyncSession = Depends(get_db)):
    # ... 现有代码 ...

    # 创建新用户并生成初始画像
    new_user = User(...)
    await db.commit()
    await db.refresh(new_user)

    # 生成初始画像
    initial_profile = await generate_initial_profile(
        mode=data.mode,
        db=db,
        user=new_user
    )

    # 生成初始知识图谱（仅AI入职模式）
    initial_graph = []
    if data.mode == 'ai':
        initial_graph = await generate_initial_graph(
            cognition=initial_profile.cognition,
            affect=initial_profile.affect,
            behavior=initial_profile.behavior
        )

    # 保存初始知识图谱到 Neo4j
    if initial_graph:
        graph_service = GraphService()
        await graph_service.initialize_user_graph(
            user_id=str(new_user.id),
            concepts=initial_graph
        )

    # 生成 token
    token = create_access_token(str(new_user.id))

    # 构造响应（包含初始画像和知识图谱）
    user_info = UserInfo(
        id=str(new_user.id),
        email=new_user.email,
        name=new_user.name,
        createdAt=new_user.created_at.isoformat(),
        hasCompletedOnboarding=True,
        onboardingMode=new_user.onboarding_mode
    )

    return AuthResponse(
        token=token,
        user=user_info,
        initialProfile=initial_profile,
        initialGraph=initial_graph
    )
```

### 步骤 3：修改对话接口

```python
# backend/app/api/endpoints/chat.py

@router.post("", response_model=SuccessResponse[ChatResponse])
async def chat(request: ChatRequest, db: AsyncSession = Depends(get_db)):
    # ... 现有代码 ...

    # 获取用户当前画像和知识图谱
    profile_service = ProfileService(db)
    current_profile = await profile_service.get_latest_profile(user_id)

    graph_service = GraphService()
    current_graph = await graph_service.get_user_graph(user_id=str(user_id))

    # 构建个性化系统提示词
    system_prompt = build_personalized_prompt(
        user_profile=current_profile,
        knowledge_graph=current_graph,
        emotion=analysis.emotion,
        language=request.language
    )

    # 生成 AI 回复（使用个性化提示词）
    ai_response = await llm_provider.chat(
        messages=[
            {"role": "system", "content": system_prompt},
            *recent_messages,
            {"role": "user", "content": request.message}
        ]
    )

    # 更新知识图谱（根据对话内容）
    updated_graph = await update_graph_from_conversation(
        user_id=str(user_id),
        message=request.message,
        current_graph=current_graph,
        user_profile=current_profile
    )

    # 返回响应（包含更新后的画像和图谱）
    return SuccessResponse(data=ChatResponse(
        message=ai_response,
        analysis=analysis,
        updatedProfile=updated_profile,
        updatedGraph=updated_graph
    ))
```

### 步骤 4：前端修改

**Dashboard.tsx**：
```typescript
// 移除写死的 Recent Shifts
// 从 API 获取真实数据

const [recentChanges, setRecentChanges] = useState<ProfileChange[]>([]);

useEffect(() => {
  const fetchRecentChanges = async () => {
    try {
      const response = await fetch(`/api/profile/recent-changes?userId=${user.id}`);
      const data = await response.json();
      setRecentChanges(data.data?.changes || []);
    } catch (error) {
      console.error('Failed to fetch recent changes:', error);
    }
  };

  if (user?.id) {
    fetchRecentChanges();
  }
}, [user?.id]);
```

**Chat.tsx**：
```typescript
// 使用真实的用户 ID
import { useAuth } from '../features/auth/hooks';

const { user } = useAuth();

const response = await sendChatMessage({
  userId: user?.id || 'guest',
  message: userText,
  language,
  isResearchMode
});
```

---

## 五、技术栈总结

### 后端
- **FastAPI**: REST API
- **PostgreSQL**: 存储用户画像、对话历史
- **Neo4j**: 存储知识图谱
- **LLM Provider**: 生成个性化内容

### 前端
- **React + TypeScript**: 用户界面
- **Zustand**: 状态管理
- **Tailwind CSS**: 样式

### 核心算法
1. **三维度评分机制**: cognition/affect/behavior 各0-100分
2. **初始知识图谱生成**: 基于画像使用 LLM 生成概念
3. **个性化提示词**: 根据画像和图谱动态生成
4. **知识图谱更新**: 对话中检测新概念并浮现

---

## 六、测试计划

### 1. 单元测试
- [ ] 三维度评分函数
- [ ] 初始知识图谱生成
- [ ] 个性化提示词生成

### 2. 集成测试
- [ ] AI 入职后，知识图谱是否正确生成
- [ ] 量表入职后，知识图谱是否为空
- [ ] 对话中，知识图谱是否逐步浮现
- [ ] 画像是否正确更新

### 3. 用户测试
- [ ] 注册流程是否顺畅
- [ ] 对话内容是否个性化
- [ ] Dashboard 显示是否正确

---

## 七、预期效果

1. **AI 入职用户**：
   - 注册后立即获得个性化知识图谱
   - 对话内容根据画像调整深度、语气、互动方式
   - 知识图谱随对话动态更新

2. **量表入职用户**：
   - 注册后知识图谱为空
   - 通过对话逐步浮现知识图谱
   - 对话内容逐渐个性化

3. **整体效果**：
   - 清除了所有写死内容
   - 系统完全基于用户画像运行
   - 提供真正的个性化学习体验

---

## 八、后续优化方向

1. **知识图谱可视化**：使用 D3.js 或 Cytoscape.js 实现交互式图谱
2. **画像预测**：使用机器学习预测用户画像变化趋势
3. **自适应难度**：根据画像动态调整学习内容难度
4. **学习路径推荐**：基于知识图谱推荐最优学习路径
