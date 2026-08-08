"""AI 引导注册画像一致性回归测试。"""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from app.api.endpoints import ai_onboarding


@pytest.mark.asyncio
async def test_preview_profile_is_the_same_profile_saved_on_finish(monkeypatch):
    """注册页的最终预览与完成注册时入库的画像必须来自同一次 AI 分析。"""
    session_id = str(uuid4())
    user_id = uuid4()
    final_analysis = {
        "profile": {"cognition": 82.0, "affect": 91.0, "behavior": 67.0},
        "attributes": {
            "learningGoals": ["Python"],
            "strengths": [],
            "weaknesses": [],
            "interests": [],
            "preferredStyle": "实践为主",
            "background": "高中",
        },
        "conceptSeeds": [],
    }

    session_model = SimpleNamespace(
        extracted_json={
            "user_id": str(user_id),
            "step": 3,
            "summary": [],
            "answers": ["回答1", "回答2", "回答3"],
            "completed": False,
        },
        raw_transcript="[]",
    )

    class FakeDb:
        async def flush(self):
            return None

    db = FakeDb()

    next_question = AsyncMock(return_value={
        "extracted_info": {"key": "学习方式", "value": "实践", "confidence": 0.9},
        "is_complete": True,
    })
    analyze_profile = AsyncMock(return_value=final_analysis)
    save_profile = AsyncMock()
    load_session = AsyncMock(return_value=session_model)
    monkeypatch.setattr(ai_onboarding, "call_llm_for_next_question", next_question)
    monkeypatch.setattr(ai_onboarding, "analyze_all_answers_for_profile", analyze_profile)
    monkeypatch.setattr(ai_onboarding, "save_user_profile", save_profile)
    monkeypatch.setattr(ai_onboarding, "_load_session", load_session)

    user = SimpleNamespace(id=user_id)
    step_response = await ai_onboarding.step_ai_onboarding(
        ai_onboarding.AiStepRequest(sessionId=session_id, answer="回答4"),
        db=db,
        current_user=user,
    )
    preview = step_response.data.draftProfile

    finish_response = await ai_onboarding.finish_ai_onboarding(
        ai_onboarding.AiFinishRequest(sessionId=session_id),
        db=db,
        current_user=user,
    )
    saved = finish_response.data.initialProfile

    assert preview.model_dump() == saved.model_dump() == {
        "cognition": 82.0,
        "affect": 91.0,
        "behavior": 67.0,
    }
    analyze_profile.assert_awaited_once()
    save_profile.assert_awaited_once_with(db, user_id, 82.0, 91.0, 67.0)
    assert session_model.extracted_json["completed"] is True
    assert session_model.extracted_json["final_analysis"] == final_analysis
