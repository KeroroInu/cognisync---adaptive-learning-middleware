"""
测试 DeepSeek LLM Provider
快速验证 DeepSeek API 连接和配置

运行方式: poetry run python scripts/test_deepseek.py
"""
import asyncio
import logging
from app.core.logging import setup_logging
from app.services.llm_provider import get_provider
from app.services.text_analyzer import TextAnalyzer

setup_logging()
logger = logging.getLogger(__name__)


async def test_deepseek_basic():
    """测试 DeepSeek 基础连接"""
    logger.info("\n1️⃣ 测试 DeepSeek Provider 基础连接...")

    provider = get_provider()
    logger.info(f"   Provider type: {type(provider).__name__}")

    # 健康检查
    try:
        health = await provider.health_check()
        if health:
            logger.info("   ✅ DeepSeek API 连接成功")
        else:
            logger.error("   ❌ DeepSeek API 健康检查失败")
            return False
    except Exception as e:
        logger.error(f"   ❌ DeepSeek API 连接失败: {e}")
        return False

    return True


async def test_deepseek_completion():
    """测试 DeepSeek 文本生成"""
    logger.info("\n2️⃣ 测试 DeepSeek 文本生成...")

    provider = get_provider()

    try:
        response = await provider.complete(
            system_prompt="你是一个教育助手，负责回答学习相关的问题。",
            user_prompt="什么是神经网络？请用简单的语言解释（50字以内）。",
            temperature=0.7,
            max_tokens=200
        )

        logger.info(f"   ✅ DeepSeek 回复:\n   {response}\n")
        return True

    except Exception as e:
        logger.error(f"   ❌ DeepSeek 文本生成失败: {e}")
        return False


async def test_text_analyzer_with_deepseek():
    """测试 TextAnalyzer 使用 DeepSeek"""
    logger.info("\n3️⃣ 测试 TextAnalyzer (使用 DeepSeek)...")

    analyzer = TextAnalyzer()

    test_messages = [
        "我对神经网络的反向传播不太理解",
        "我想学习深度学习",
        "我觉得过拟合是因为模型太复杂"
    ]

    for i, message in enumerate(test_messages, 1):
        logger.info(f"\n   --- 测试用例 {i} ---")
        logger.info(f"   消息: {message}")

        try:
            result = await analyzer.analyze(message)

            logger.info(f"   Intent:   {result.intent}")
            logger.info(f"   Emotion:  {result.emotion}")
            logger.info(f"   Concepts: {', '.join(result.detectedConcepts) if result.detectedConcepts else '无'}")
            logger.info(f"   Delta:    C={result.delta.cognition:+3}, A={result.delta.affect:+3}, B={result.delta.behavior:+3}")

        except Exception as e:
            logger.error(f"   ❌ 分析失败: {e}")
            return False

    logger.info("\n   ✅ TextAnalyzer 测试通过")
    return True


async def test_chat_response():
    """测试完整的对话回复（带 emotion-based prompt）"""
    logger.info("\n4️⃣ 测试完整对话回复...")

    provider = get_provider()

    # 模拟 chat.py 中的 system prompt 构建
    system_prompt = """你是一个耐心、专业的教育助手，帮助学习者理解和掌握知识。

**当前情境：**
用户感到困惑，请用简单、清晰的语言解释，多用类比和例子。

**回答风格：**
直接、清晰地回答问题，提供具体的解释和例子。

**回答要求：**
- 使用 ZH 语言回答
- 保持回答简洁（200-300 字）
- 如果涉及技术概念，提供通俗易懂的解释
- 如果用户有误解，温和地纠正
"""

    user_prompt = """**当前用户消息：**
我对反向传播不太理解，能帮我解释一下吗？

**请根据上述情境生成回复。**"""

    try:
        response = await provider.complete(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            temperature=0.7,
            max_tokens=500
        )

        logger.info("   ✅ DeepSeek 回复:\n")
        logger.info(f"   {response}\n")
        return True

    except Exception as e:
        logger.error(f"   ❌ 对话回复失败: {e}")
        return False


async def main():
    """主测试函数"""
    logger.info("=" * 80)
    logger.info("🚀 开始测试 DeepSeek LLM Provider")
    logger.info("=" * 80)

    results = []

    # 1. 基础连接测试
    results.append(await test_deepseek_basic())

    # 2. 文本生成测试
    if results[-1]:
        results.append(await test_deepseek_completion())

    # 3. TextAnalyzer 测试
    if all(results):
        results.append(await test_text_analyzer_with_deepseek())

    # 4. 完整对话测试
    if all(results):
        results.append(await test_chat_response())

    # 总结
    logger.info("\n" + "=" * 80)
    if all(results):
        logger.info("🎉 所有测试通过！DeepSeek 配置成功")
    else:
        logger.error("❌ 部分测试失败，请检查配置")
    logger.info("=" * 80)


if __name__ == "__main__":
    asyncio.run(main())
