"""
快速测试 LLM Provider 和 TextAnalyzer
运行方式: poetry run python scripts/test_analyzer.py
"""
import asyncio
import logging
from app.core.logging import setup_logging
from app.services.llm_provider import MockProvider, get_provider
from app.services.text_analyzer import TextAnalyzer

setup_logging()
logger = logging.getLogger(__name__)


async def test_mock_provider():
    """测试 Mock Provider"""
    logger.info("\n1️⃣ Testing MockProvider...")

    provider = MockProvider()

    # 测试健康检查
    health = await provider.health_check()
    logger.info(f"✅ Health check: {health}")

    # 测试生成
    response = await provider.complete(
        system_prompt="You are a helpful assistant.",
        user_prompt="我不太理解反向传播算法",
    )

    logger.info(f"✅ Mock response:\n{response}")


async def test_text_analyzer():
    """测试 TextAnalyzer"""
    logger.info("\n2️⃣ Testing TextAnalyzer with MockProvider...")

    analyzer = TextAnalyzer(provider=MockProvider())

    # 测试用例
    test_messages = [
        "我对神经网络的反向传播不太理解，能帮我解释一下吗？",
        "我想学习深度学习和机器学习，有什么推荐的资料？",
        "我觉得过拟合是因为模型太复杂，记住了训练数据的噪声。",
        "我计划这周学完卷积神经网络，下周开始学循环神经网络。",
        "你好，今天天气不错。",
    ]

    for i, message in enumerate(test_messages, 1):
        logger.info(f"\n--- Test Case {i} ---")
        logger.info(f"Message: {message}")

        result = await analyzer.analyze(message)

        logger.info(f"Intent: {result.intent}")
        logger.info(f"Emotion: {result.emotion}")
        logger.info(f"Concepts: {result.detectedConcepts}")
        logger.info(f"Delta: cognition={result.delta.cognition}, affect={result.delta.affect}, behavior={result.delta.behavior}")


async def test_with_context():
    """测试带上下文的分析"""
    logger.info("\n3️⃣ Testing TextAnalyzer with conversation context...")

    analyzer = TextAnalyzer(provider=MockProvider())

    # 模拟对话历史
    recent_messages = [
        {"role": "user", "text": "什么是神经网络？"},
        {"role": "assistant", "text": "神经网络是一种模仿人脑神经元工作方式的计算模型..."},
        {"role": "user", "text": "那反向传播是什么？"},
    ]

    current_message = "我还是不太明白反向传播的原理"

    result = await analyzer.analyze(current_message, recent_messages)

    logger.info(f"Intent: {result.intent}")
    logger.info(f"Emotion: {result.emotion}")
    logger.info(f"Concepts: {result.detectedConcepts}")
    logger.info(f"Delta: {result.delta.model_dump()}")


async def test_configured_provider():
    """测试配置的 Provider（可能是 OpenAI、Ollama 等）"""
    logger.info("\n4️⃣ Testing configured provider (from settings)...")

    provider = get_provider()
    logger.info(f"Provider type: {type(provider).__name__}")

    # 健康检查
    try:
        health = await provider.health_check()
        logger.info(f"✅ Health check: {health}")
    except Exception as e:
        logger.warning(f"⚠️  Health check failed: {e}")

    # 简单测试
    try:
        analyzer = TextAnalyzer(provider=provider)
        result = await analyzer.analyze("我想学习机器学习")

        logger.info(f"✅ Analysis successful:")
        logger.info(f"   Intent: {result.intent}")
        logger.info(f"   Emotion: {result.emotion}")

    except Exception as e:
        logger.warning(f"⚠️  Analysis failed: {e}")


async def main():
    """主测试函数"""
    logger.info("🚀 Starting LLM Provider and TextAnalyzer Tests...\n")

    try:
        # 1. 测试 Mock Provider
        await test_mock_provider()

        # 2. 测试 TextAnalyzer
        await test_text_analyzer()

        # 3. 测试带上下文
        await test_with_context()

        # 4. 测试配置的 Provider
        await test_configured_provider()

        logger.info("\n🎉 All tests completed successfully!")

    except Exception as e:
        logger.error(f"\n❌ Test failed: {e}", exc_info=True)
        raise


if __name__ == "__main__":
    asyncio.run(main())
