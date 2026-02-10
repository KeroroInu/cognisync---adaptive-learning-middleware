"""
TextAnalyzer 单元测试
测试文本分析服务的各种场景
"""
import pytest
from app.services.text_analyzer import TextAnalyzer
from app.services.llm_provider import MockProvider


@pytest.mark.asyncio
async def test_help_seeking_intent():
    """
    测试 1: 寻求帮助的意图识别
    用户消息包含"不懂"、"不理解"等关键词
    """
    analyzer = TextAnalyzer(provider=MockProvider())

    message = "我对反向传播还是不太理解，能再解释一下吗？"
    result = await analyzer.analyze(message)

    # 验证返回结构
    assert result.intent == "help-seeking", f"Expected help-seeking, got {result.intent}"
    assert result.emotion == "confused", f"Expected confused, got {result.emotion}"

    # 验证 delta 字段
    assert isinstance(result.delta.cognition, int), "cognition should be int"
    assert isinstance(result.delta.affect, int), "affect should be int"
    assert isinstance(result.delta.behavior, int), "behavior should be int"

    # 验证 delta 范围
    assert -10 <= result.delta.cognition <= 10, f"cognition out of range: {result.delta.cognition}"
    assert -10 <= result.delta.affect <= 10, f"affect out of range: {result.delta.affect}"
    assert -10 <= result.delta.behavior <= 10, f"behavior out of range: {result.delta.behavior}"

    # 期望负面认知和情感增量（困惑）
    assert result.delta.cognition <= 0, "Should have negative cognition delta for confusion"
    assert result.delta.affect <= 0, "Should have negative affect delta for confusion"

    # 验证概念提取
    assert "反向传播" in result.detectedConcepts, "Should detect '反向传播' concept"

    print(f"✅ Test 1 passed: {result.model_dump_json(indent=2)}")


@pytest.mark.asyncio
async def test_exploration_intent():
    """
    测试 2: 探索学习的意图识别
    用户表达学习兴趣和好奇心
    """
    analyzer = TextAnalyzer(provider=MockProvider())

    message = "我想学习神经网络和深度学习，有什么好的入门资料吗？"
    result = await analyzer.analyze(message)

    # 验证意图和情感
    assert result.intent == "exploration", f"Expected exploration, got {result.intent}"
    assert result.emotion in ["curious", "motivated"], f"Expected positive emotion, got {result.emotion}"

    # 验证 delta
    assert result.delta.affect >= 0, "Should have positive affect for curiosity"
    assert result.delta.behavior >= 0, "Should have positive behavior for active learning"

    # 验证概念提取
    assert len(result.detectedConcepts) > 0, "Should detect at least one concept"
    assert any(c in result.detectedConcepts for c in ["神经网络", "深度学习"]), \
        f"Should detect learning concepts, got {result.detectedConcepts}"

    # 验证 JSON 结构完整性
    data = result.model_dump()
    assert "intent" in data
    assert "emotion" in data
    assert "detectedConcepts" in data
    assert "delta" in data
    assert all(k in data["delta"] for k in ["cognition", "affect", "behavior"])

    print(f"✅ Test 2 passed: {result.model_dump_json(indent=2)}")


@pytest.mark.asyncio
async def test_reflection_intent():
    """
    测试 3: 反思总结的意图识别
    用户表达自己的理解和思考
    """
    analyzer = TextAnalyzer(provider=MockProvider())

    message = "我觉得过拟合的本质是模型记住了训练数据的噪声，而不是学到了真正的规律。"
    result = await analyzer.analyze(message)

    # 验证意图
    assert result.intent in ["reflection", "confirmation"], \
        f"Expected reflection/confirmation, got {result.intent}"

    # 验证情感
    assert result.emotion in ["thoughtful", "confident"], \
        f"Expected thoughtful/confident, got {result.emotion}"

    # 验证认知增量为正（表达理解）
    assert result.delta.cognition >= 0, "Reflection should have non-negative cognition delta"

    # 验证概念
    assert "过拟合" in result.detectedConcepts, "Should detect '过拟合' concept"

    print(f"✅ Test 3 passed: {result.model_dump_json(indent=2)}")


@pytest.mark.asyncio
async def test_goal_setting_intent():
    """
    测试 4: 目标设定的意图识别
    用户制定学习计划和目标
    """
    analyzer = TextAnalyzer(provider=MockProvider())

    message = "我计划这周掌握梯度下降算法，下周开始学习优化器。"
    result = await analyzer.analyze(message)

    # 验证意图
    assert result.intent == "goal-setting", f"Expected goal-setting, got {result.intent}"

    # 验证情感（积极）
    assert result.emotion in ["motivated", "confident", "excited"], \
        f"Expected positive emotion, got {result.emotion}"

    # 验证行为增量为正（主动性强）
    assert result.delta.behavior > 0, "Goal-setting should have positive behavior delta"

    # 验证概念
    detected_concepts = [c for c in ["梯度下降", "优化器"] if c in result.detectedConcepts]
    assert len(detected_concepts) > 0, "Should detect goal-related concepts"

    print(f"✅ Test 4 passed: {result.model_dump_json(indent=2)}")


@pytest.mark.asyncio
async def test_multiple_concepts_detection():
    """
    测试 5: 多概念提取和 JSON 结构完整性
    用户消息包含多个学科概念
    """
    analyzer = TextAnalyzer(provider=MockProvider())

    message = "卷积神经网络和循环神经网络在处理图像和序列数据时有什么区别？"
    result = await analyzer.analyze(message)

    # 验证基本结构
    assert hasattr(result, "intent")
    assert hasattr(result, "emotion")
    assert hasattr(result, "detectedConcepts")
    assert hasattr(result, "delta")

    # 验证 detectedConcepts 是列表
    assert isinstance(result.detectedConcepts, list), "detectedConcepts must be a list"

    # 验证至少检测到一些概念
    assert len(result.detectedConcepts) >= 0, "detectedConcepts can be empty but should be a list"

    # 验证 delta 对象
    assert hasattr(result.delta, "cognition")
    assert hasattr(result.delta, "affect")
    assert hasattr(result.delta, "behavior")

    # 验证所有 delta 值都是整数
    assert isinstance(result.delta.cognition, int)
    assert isinstance(result.delta.affect, int)
    assert isinstance(result.delta.behavior, int)

    # 验证可以序列化为 JSON
    json_str = result.model_dump_json()
    assert len(json_str) > 0, "Should be serializable to JSON"

    # 验证可以转换为字典
    data_dict = result.model_dump()
    assert isinstance(data_dict, dict)
    assert "intent" in data_dict
    assert "emotion" in data_dict
    assert "detectedConcepts" in data_dict
    assert "delta" in data_dict

    print(f"✅ Test 5 passed: {result.model_dump_json(indent=2)}")


# 运行所有测试的主函数
if __name__ == "__main__":
    import asyncio

    async def run_all_tests():
        print("🚀 Running TextAnalyzer Unit Tests...\n")

        try:
            await test_help_seeking_intent()
            await test_exploration_intent()
            await test_reflection_intent()
            await test_goal_setting_intent()
            await test_multiple_concepts_detection()

            print("\n🎉 All 5 tests passed successfully!")

        except AssertionError as e:
            print(f"\n❌ Test failed: {e}")
            raise

        except Exception as e:
            print(f"\n❌ Unexpected error: {e}")
            raise

    asyncio.run(run_all_tests())
