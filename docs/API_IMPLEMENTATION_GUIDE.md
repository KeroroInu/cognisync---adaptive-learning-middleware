# CogniSync 后端 API 实现指南

## 目标读者
本文档面向后端工程师，提供清晰的 API 实现步骤和代码示例。

---

## 快速开始

### 1. 技术栈选择

推荐使用 **FastAPI** (Python):
- 自动生成 OpenAPI 文档
- 内置类型验证 (Pydantic)
- 异步支持
- 性能优秀

### 2. 项目初始化

```bash
# 创建项目目录
mkdir cognisync-backend
cd cognisync-backend

# 初始化 Python 环境
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 安装依赖
pip install fastapi uvicorn sqlalchemy psycopg2-binary alembic redis openai python-jose
```

### 3. 目录结构

```
cognisync-backend/
├── app/
│   ├── __init__.py
│   ├── main.py                 # FastAPI 应用入口
│   ├── config.py               # 配置管理
│   ├── database.py             # 数据库连接
│   ├── models/                 # SQLAlchemy 模型
│   │   ├── __init__.py
│   │   ├── user_profile.py
│   │   ├── knowledge_node.py
│   │   ├── chat_message.py
│   │   └── calibration_log.py
│   ├── schemas/                # Pydantic 模型
│   │   ├── __init__.py
│   │   ├── profile.py
│   │   ├── chat.py
│   │   ├── knowledge_graph.py
│   │   └── calibration.py
│   ├── api/                    # API 路由
│   │   ├── __init__.py
│   │   ├── profile.py
│   │   ├── chat.py
│   │   ├── knowledge_graph.py
│   │   └── calibration.py
│   ├── services/               # 业务逻辑
│   │   ├── __init__.py
│   │   ├── profile_service.py
│   │   ├── chat_service.py
│   │   ├── llm_service.py
│   │   └── knowledge_service.py
│   └── utils/
│       ├── __init__.py
│       └── concept_matcher.py
├── alembic/                    # 数据库迁移
├── tests/
├── .env
├── requirements.txt
└── README.md
```

---

## 核心实现步骤

### Step 1: 配置管理 (app/config.py)

```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # 数据库配置
    DATABASE_URL: str = "postgresql://user:pass@localhost/cognisync"

    # Redis 配置
    REDIS_URL: str = "redis://localhost:6379/0"

    # OpenAI 配置
    OPENAI_API_KEY: str
    OPENAI_MODEL: str = "gpt-4"

    # 应用配置
    SECRET_KEY: str
    DEBUG: bool = False
    CORS_ORIGINS: list[str] = ["http://localhost:3000"]

    class Config:
        env_file = ".env"

settings = Settings()
```

### Step 2: 数据库模型 (app/models/user_profile.py)

```python
from sqlalchemy import Column, String, Integer, DateTime
from sqlalchemy.sql import func
from app.database import Base

class UserProfile(Base):
    __tablename__ = "user_profiles"

    user_id = Column(String(255), primary_key=True)
    cognition = Column(Integer, nullable=False)
    affect = Column(Integer, nullable=False)
    behavior = Column(Integer, nullable=False)
    last_update = Column(DateTime, nullable=False)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
```

### Step 3: Pydantic Schemas (app/schemas/profile.py)

```python
from pydantic import BaseModel, Field
from datetime import datetime

class ProfileBase(BaseModel):
    cognition: int = Field(ge=0, le=100)
    affect: int = Field(ge=0, le=100)
    behavior: int = Field(ge=0, le=100)

class ProfileCreate(ProfileBase):
    user_id: str

class ProfileResponse(ProfileBase):
    user_id: str
    last_update: datetime

    class Config:
        from_attributes = True

class ProfileDelta(BaseModel):
    cognition: int = 0
    affect: int = 0
    behavior: int = 0
```

### Step 4: 业务逻辑层 (app/services/profile_service.py)

```python
from sqlalchemy.orm import Session
from app.models.user_profile import UserProfile
from app.schemas.profile import ProfileCreate, ProfileDelta
from datetime import datetime

class ProfileService:
    def __init__(self, db: Session):
        self.db = db

    def get_profile(self, user_id: str) -> UserProfile | None:
        return self.db.query(UserProfile).filter(
            UserProfile.user_id == user_id
        ).first()

    def create_profile(self, profile_data: ProfileCreate) -> UserProfile:
        profile = UserProfile(
            user_id=profile_data.user_id,
            cognition=profile_data.cognition,
            affect=profile_data.affect,
            behavior=profile_data.behavior,
            last_update=datetime.utcnow()
        )
        self.db.add(profile)
        self.db.commit()
        self.db.refresh(profile)
        return profile

    def update_profile(
        self,
        user_id: str,
        delta: ProfileDelta
    ) -> UserProfile:
        profile = self.get_profile(user_id)
        if not profile:
            raise ValueError(f"Profile not found for user_id: {user_id}")

        # 应用增量并限制范围
        profile.cognition = max(0, min(100, profile.cognition + delta.cognition))
        profile.affect = max(0, min(100, profile.affect + delta.affect))
        profile.behavior = max(0, min(100, profile.behavior + delta.behavior))
        profile.last_update = datetime.utcnow()

        self.db.commit()
        self.db.refresh(profile)
        return profile
```

### Step 5: LLM 分析服务 (app/services/llm_service.py)

```python
import openai
import json
from app.config import settings
from app.schemas.chat import MessageAnalysis

openai.api_key = settings.OPENAI_API_KEY

class LLMService:
    @staticmethod
    def analyze_message(
        user_message: str,
        current_profile: dict
    ) -> MessageAnalysis:
        prompt = f"""
你是一个教育心理学专家，负责分析学生的学习消息。

当前学生画像:
- 认知水平 (0-100): {current_profile['cognition']}
- 情感状态 (0-100): {current_profile['affect']}
- 行为参与 (0-100): {current_profile['behavior']}

学生消息: "{user_message}"

请分析以下内容并以 JSON 格式返回:
{{
  "intent": "help-seeking | confirmation | question | statement",
  "emotion": "confused | confident | frustrated | neutral",
  "detectedConcepts": ["概念1", "概念2"],
  "profileDelta": {{
    "cognition": 0,
    "affect": 0,
    "behavior": 0
  }}
}}

规则:
- intent: help-seeking (求助), confirmation (确认理解), question (提问), statement (陈述)
- emotion: confused (困惑), confident (自信), frustrated (挫败), neutral (中立)
- detectedConcepts: 提取消息中提到的技术概念
- profileDelta: 建议的画像调整值 (-20 到 +20)
  - 困惑时降低 cognition 和 affect
  - 理解时提升 cognition 和 affect
  - 提问时提升 behavior
"""

        try:
            response = openai.ChatCompletion.create(
                model=settings.OPENAI_MODEL,
                messages=[
                    {"role": "system", "content": "你是教育分析助手，只返回 JSON。"},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3,
                max_tokens=300
            )

            result = json.loads(response.choices[0].message.content)
            return MessageAnalysis(**result)

        except Exception as e:
            # 降级到规则匹配
            return LLMService._fallback_analysis(user_message)

    @staticmethod
    def _fallback_analysis(message: str) -> MessageAnalysis:
        """规则匹配降级方案"""
        message_lower = message.lower()

        # 意图识别
        intent = "statement"
        if any(word in message_lower for word in ["不懂", "困惑", "不理解", "难"]):
            intent = "help-seeking"
        elif any(word in message_lower for word in ["明白", "理解", "是的", "好的"]):
            intent = "confirmation"
        elif "?" in message or "？" in message:
            intent = "question"

        # 情感识别
        emotion = "neutral"
        if intent == "help-seeking":
            emotion = "confused"
        elif intent == "confirmation":
            emotion = "confident"

        # 概念提取 (简化版)
        concepts = []
        keywords = ["神经网络", "反向传播", "梯度下降", "过拟合", "激活函数"]
        for kw in keywords:
            if kw in message:
                concepts.append(kw)

        # 画像增量
        delta = {"cognition": 0, "affect": 0, "behavior": 2}
        if emotion == "confused":
            delta = {"cognition": -5, "affect": -10, "behavior": 5}
        elif emotion == "confident":
            delta = {"cognition": 8, "affect": 5, "behavior": 2}

        return MessageAnalysis(
            intent=intent,
            emotion=emotion,
            detectedConcepts=concepts,
            profileDelta=delta
        )

    @staticmethod
    def generate_reply(
        user_message: str,
        analysis: MessageAnalysis,
        current_profile: dict
    ) -> str:
        prompt = f"""
你是一个友好的 AI 学习导师。

学生消息: "{user_message}"
学生状态: {analysis.emotion}
学生意图: {analysis.intent}
提到的概念: {analysis.detectedConcepts}

请生成一个简短的回复 (50-100 字)，要求:
- 如果学生困惑，提供简洁的解释或引导
- 如果学生自信，给予肯定并引入新话题
- 保持鼓励和支持的语气
"""

        response = openai.ChatCompletion.create(
            model=settings.OPENAI_MODEL,
            messages=[
                {"role": "system", "content": "你是友好的学习导师。"},
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
            max_tokens=200
        )

        return response.choices[0].message.content
```

### Step 6: 对话服务 (app/services/chat_service.py)

```python
from sqlalchemy.orm import Session
from app.models.chat_message import ChatMessage
from app.schemas.chat import ChatRequest, ChatResponse
from app.services.llm_service import LLMService
from app.services.profile_service import ProfileService
from app.services.knowledge_service import KnowledgeService
from datetime import datetime
import uuid

class ChatService:
    def __init__(self, db: Session):
        self.db = db
        self.llm_service = LLMService()
        self.profile_service = ProfileService(db)
        self.knowledge_service = KnowledgeService(db)

    def process_message(self, request: ChatRequest) -> ChatResponse:
        # 1. 保存用户消息
        user_msg = self._save_message(
            user_id=request.userId,
            session_id=request.sessionId,
            role="user",
            message=request.message
        )

        # 2. 获取当前画像
        profile = self.profile_service.get_profile(request.userId)
        if not profile:
            raise ValueError(f"Profile not found for user_id: {request.userId}")

        profile_dict = {
            "cognition": profile.cognition,
            "affect": profile.affect,
            "behavior": profile.behavior
        }

        # 3. 调用 LLM 分析
        analysis = self.llm_service.analyze_message(
            request.message,
            profile_dict
        )

        # 4. 更新画像
        updated_profile = self.profile_service.update_profile(
            request.userId,
            analysis.profileDelta
        )

        # 5. 更新知识图谱
        for concept in analysis.detectedConcepts:
            self.knowledge_service.increment_concept_frequency(
                request.userId,
                concept
            )

        # 6. 生成回复
        reply_text = self.llm_service.generate_reply(
            request.message,
            analysis,
            profile_dict
        )

        # 7. 保存 AI 消息
        ai_msg = self._save_message(
            user_id=request.userId,
            session_id=request.sessionId,
            role="assistant",
            message=reply_text,
            analysis=analysis.dict()
        )

        # 8. 返回响应
        return ChatResponse(
            messageId=ai_msg.id,
            reply=reply_text,
            analysis=analysis,
            updatedProfile={
                "cognition": updated_profile.cognition,
                "affect": updated_profile.affect,
                "behavior": updated_profile.behavior
            },
            timestamp=ai_msg.timestamp
        )

    def _save_message(
        self,
        user_id: str,
        session_id: str,
        role: str,
        message: str,
        analysis: dict = None
    ) -> ChatMessage:
        msg = ChatMessage(
            id=f"msg_{uuid.uuid4().hex[:12]}",
            user_id=user_id,
            session_id=session_id,
            role=role,
            message=message,
            analysis=analysis,
            timestamp=datetime.utcnow()
        )
        self.db.add(msg)
        self.db.commit()
        self.db.refresh(msg)
        return msg
```

### Step 7: API 路由 (app/api/chat.py)

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.schemas.chat import ChatRequest, ChatResponse
from app.services.chat_service import ChatService

router = APIRouter(prefix="/api/chat", tags=["chat"])

@router.post("", response_model=ChatResponse)
def send_message(
    request: ChatRequest,
    db: Session = Depends(get_db)
):
    """
    发送消息并获取 AI 回复

    **流程**:
    1. 保存用户消息
    2. LLM 分析 (意图/情感/概念)
    3. 更新用户画像
    4. 更新知识图谱频率
    5. 生成 AI 回复
    6. 返回分析结果
    """
    try:
        service = ChatService(db)
        response = service.process_message(request)
        return response
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal error: {str(e)}")

@router.get("/history/{user_id}")
def get_chat_history(
    user_id: str,
    session_id: str = None,
    limit: int = 50,
    db: Session = Depends(get_db)
):
    """获取对话历史"""
    query = db.query(ChatMessage).filter(ChatMessage.user_id == user_id)

    if session_id:
        query = query.filter(ChatMessage.session_id == session_id)

    messages = query.order_by(ChatMessage.timestamp.desc()).limit(limit).all()

    return {
        "messages": [
            {
                "id": msg.id,
                "role": msg.role,
                "message": msg.message,
                "timestamp": msg.timestamp,
                "analysis": msg.analysis
            }
            for msg in messages
        ]
    }
```

### Step 8: 主应用入口 (app/main.py)

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.database import engine, Base
from app.api import profile, chat, knowledge_graph, calibration

# 创建数据库表
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="CogniSync API",
    description="Educational Agent Middleware",
    version="1.0.0"
)

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由
app.include_router(profile.router)
app.include_router(chat.router)
app.include_router(knowledge_graph.router)
app.include_router(calibration.router)

@app.get("/")
def root():
    return {
        "name": "CogniSync API",
        "version": "1.0.0",
        "docs": "/docs"
    }

@app.get("/health")
def health_check():
    return {"status": "ok"}
```

### Step 9: 运行应用

```bash
# 启动开发服务器
uvicorn app.main:app --reload --port 8000

# 访问文档
# http://localhost:8000/docs
```

---

## 关键接口实现清单

### ✅ P0 接口 (必须实现)

- [x] `POST /api/chat` - 对话交互
- [x] `GET /api/profile/:userId` - 获取画像
- [ ] `POST /api/profile` - 创建画像
- [ ] `GET /api/knowledge-graph/:userId` - 获取知识图谱
- [ ] `PUT /api/knowledge-graph/nodes/:nodeId` - 更新节点
- [ ] `POST /api/calibration/profile` - 提交画像校准

### 📋 P1 接口 (后续实现)

- [ ] `GET /api/chat/history/:userId` - 对话历史
- [ ] `GET /api/calibration/logs/:userId` - 校准日志
- [ ] `GET /api/export/:userId` - 导出数据

---

## 测试示例

### 测试对话接口

```bash
curl -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_123",
    "message": "什么是过拟合？",
    "sessionId": "session_abc",
    "timestamp": "2025-01-19T10:30:00Z"
  }'
```

**预期响应**:
```json
{
  "messageId": "msg_def456",
  "reply": "过拟合是指模型在训练数据上表现很好，但在新数据上泛化能力差的现象...",
  "analysis": {
    "intent": "question",
    "emotion": "neutral",
    "detectedConcepts": ["过拟合"],
    "profileDelta": {
      "cognition": 2,
      "affect": 0,
      "behavior": 5
    }
  },
  "updatedProfile": {
    "cognition": 67,
    "affect": 42,
    "behavior": 83
  },
  "timestamp": "2025-01-19T10:30:05Z"
}
```

---

## 常见问题

### Q1: LLM API 调用失败怎么办？
使用 `_fallback_analysis` 降级到规则匹配。

### Q2: 如何避免画像值超出 0-100 范围？
在 `update_profile` 中使用 `max(0, min(100, value))`。

### Q3: 如何处理并发请求？
使用数据库事务和行锁：
```python
profile = db.query(UserProfile).filter(...).with_for_update().first()
```

### Q4: 如何提高 LLM 响应速度？
- 使用更快的模型 (gpt-3.5-turbo)
- 减少 `max_tokens`
- 异步调用 + 流式返回

---

## 下一步

1. 完成剩余 P0 接口
2. 编写单元测试
3. 部署到生产环境
4. 监控 LLM API 使用量

---

**文档版本**: v1.0
**最后更新**: 2025-01-19
