"""
Demo Script - 演示对话 → 画像更新 → 图谱更新的完整流程
运行方式: poetry run python scripts/demo_conversation.py
"""
import asyncio
import logging
from app.core.logging import setup_logging
from app.db.postgres import init_db as init_postgres_db, close_db as close_postgres_db, get_db
from app.db.neo4j import init_db as init_neo4j_db, close_db as close_neo4j_db
from app.services.profile_service import ProfileService
from app.services.graph_service import GraphService
from app.services.text_analyzer import TextAnalyzer
from app.services.llm_provider import MockProvider

setup_logging()
logger = logging.getLogger(__name__)


# 测试用户 ID
TEST_USER_EMAIL = "user123@cognisync.local"


async def print_separator(title: str):
    """打印分隔符"""
    logger.info(f"\n{'=' * 80}")
    logger.info(f"  {title}")
    logger.info(f"{'=' * 80}\n")


async def display_profile(profile, title: str):
    """显示用户画像"""
    logger.info(f"\n📊 {title}")
    logger.info(f"   认知 (Cognition):  {profile.cognition:>3}/100")
    logger.info(f"   情感 (Affect):     {profile.affect:>3}/100")
    logger.info(f"   行为 (Behavior):   {profile.behavior:>3}/100")
    logger.info(f"   更新时间: {profile.lastUpdate}")


async def display_graph(graph_data, title: str):
    """显示知识图谱"""
    logger.info(f"\n🕸️  {title}")
    logger.info(f"   节点数: {len(graph_data.nodes)}")
    logger.info(f"   边数:   {len(graph_data.edges)}")

    if graph_data.nodes:
        logger.info("\n   概念列表:")
        for node in graph_data.nodes:
            logger.info(
                f"     - {node.name:12} | "
                f"掌握度: {node.mastery:5.1f}% | "
                f"频次: {node.frequency:2}/10 | "
                f"标记: {'是' if node.isFlagged else '否'}"
            )


async def demo_conversation():
    """演示完整的对话流程"""

    # ========== 初始化 ==========
    await print_separator("🚀 初始化数据库")

    await init_postgres_db()
    await init_neo4j_db()

    logger.info("✅ PostgreSQL 和 Neo4j 已初始化\n")

    # ========== 创建服务实例 ==========
    async for db in get_db():
        profile_service = ProfileService(db)
        graph_service = GraphService()
        analyzer = TextAnalyzer(provider=MockProvider())

        # ========== 创建/获取用户 ==========
        await print_separator("👤 创建测试用户")

        user = await profile_service.get_or_create_user(TEST_USER_EMAIL)
        user_id = user.id

        logger.info(f"✅ 用户已创建: {user.email}")
        logger.info(f"   UUID: {user_id}\n")

        # 获取初始画像
        initial_profile = await profile_service.get_profile(user_id)
        await display_profile(initial_profile, "初始画像（默认 50/50/50）")

        # 获取初始图谱
        initial_graph = await graph_service.get_graph(str(user_id))
        await display_graph(initial_graph, "初始知识图谱（空）")

        # ========== 测试对话 ==========
        test_messages = [
            {
                "text": "我对神经网络和反向传播不太理解，能帮我解释一下吗？",
                "expected_intent": "help-seeking",
                "expected_concepts": ["神经网络", "反向传播"]
            },
            {
                "text": "我想深入学习深度学习和梯度下降算法，有什么推荐的资料？",
                "expected_intent": "exploration",
                "expected_concepts": ["深度学习", "梯度下降"]
            },
            {
                "text": "我觉得过拟合是因为模型太复杂，记住了训练数据的噪声而不是真正的规律。",
                "expected_intent": "reflection",
                "expected_concepts": ["过拟合"]
            }
        ]

        profiles = [initial_profile]  # 存储画像历史

        for i, msg_data in enumerate(test_messages, 1):
            await print_separator(f"💬 消息 {i}/3")

            message = msg_data["text"]
            logger.info(f"用户消息: {message}\n")

            # 1. 分析消息
            logger.info("🧠 分析中...")
            analysis = await analyzer.analyze(message)

            logger.info(f"   意图 (Intent):   {analysis.intent}")
            logger.info(f"   情感 (Emotion):  {analysis.emotion}")
            logger.info(f"   检测概念:        {', '.join(analysis.detectedConcepts) if analysis.detectedConcepts else '无'}")
            logger.info(
                f"   画像增量:        "
                f"C={analysis.delta.cognition:+3}, "
                f"A={analysis.delta.affect:+3}, "
                f"B={analysis.delta.behavior:+3}"
            )

            # 2. 更新画像
            logger.info("\n📊 更新画像...")
            updated_profile = await profile_service.apply_delta(
                user_id=user_id,
                delta_cognition=analysis.delta.cognition,
                delta_affect=analysis.delta.affect,
                delta_behavior=analysis.delta.behavior
            )

            # 显示画像变化
            prev_profile = profiles[-1]
            logger.info(f"   认知: {prev_profile.cognition:>3} → {updated_profile.cognition:>3} (变化: {updated_profile.cognition - prev_profile.cognition:+3})")
            logger.info(f"   情感: {prev_profile.affect:>3} → {updated_profile.affect:>3} (变化: {updated_profile.affect - prev_profile.affect:+3})")
            logger.info(f"   行为: {prev_profile.behavior:>3} → {updated_profile.behavior:>3} (变化: {updated_profile.behavior - prev_profile.behavior:+3})")

            profiles.append(updated_profile)

            # 3. 更新知识图谱
            if analysis.detectedConcepts:
                logger.info("\n🕸️  更新知识图谱...")
                upsert_result = await graph_service.upsert_concepts(
                    user_id=str(user_id),
                    concepts=analysis.detectedConcepts
                )

                logger.info(
                    f"   概念节点: {upsert_result.get('created_concepts', 0)} 个"
                )
                logger.info(
                    f"   交互关系: {upsert_result.get('updated_relationships', 0)} 个"
                )

                # 获取更新后的图谱
                updated_graph = await graph_service.get_graph(str(user_id))
                await display_graph(updated_graph, f"知识图谱（消息 {i} 后）")

            # 等待一下，模拟真实对话间隔
            await asyncio.sleep(0.5)

        # ========== 最终总结 ==========
        await print_separator("📈 最终统计")

        final_profile = profiles[-1]
        final_graph = await graph_service.get_graph(str(user_id))

        logger.info("🎯 画像变化总结:")
        logger.info(f"   认知: {initial_profile.cognition} → {final_profile.cognition} (变化: {final_profile.cognition - initial_profile.cognition:+3})")
        logger.info(f"   情感: {initial_profile.affect} → {final_profile.affect} (变化: {final_profile.affect - initial_profile.affect:+3})")
        logger.info(f"   行为: {initial_profile.behavior} → {final_profile.behavior} (变化: {final_profile.behavior - initial_profile.behavior:+3})")

        logger.info("\n🕸️  知识图谱总结:")
        logger.info(f"   总概念数: {len(final_graph.nodes)}")
        logger.info(f"   总边数:   {len(final_graph.edges)}")

        if final_graph.nodes:
            logger.info("\n   概念详情:")
            for node in sorted(final_graph.nodes, key=lambda n: n.frequency, reverse=True):
                logger.info(
                    f"     - {node.name:12} | "
                    f"掌握度: {node.mastery:5.1f}% | "
                    f"频次: {node.frequency:2}/10"
                )

        # ========== 测试用户校准功能 ==========
        await print_separator("✏️  用户校准测试")

        logger.info("用户认为自己对'神经网络'的掌握度应该是 75%（系统估计 50%）\n")

        # 模拟用户校准画像
        user_override_profile = await profile_service.apply_user_override(
            user_id=user_id,
            cognition=55,  # 用户自评认知稍高
            affect=None,   # 不修改情感
            behavior=None, # 不修改行为
            user_comment="我觉得我对神经网络的理解还不错",
            likert_trust=4  # 信任度 4/5
        )

        await display_profile(user_override_profile, "用户校准后的画像")

        # 测试节点更新
        if final_graph.nodes:
            first_node = final_graph.nodes[0]
            logger.info(f"\n用户标记概念 '{first_node.name}' 的掌握度为 75%\n")

            from app.schemas.graph import UpdateNodeRequest
            updated_node = await graph_service.update_node(
                user_id=str(user_id),
                node_id=first_node.id,
                updates=UpdateNodeRequest(mastery=75.0, isFlagged=False)
            )

            if updated_node:
                logger.info("✅ 节点已更新:")
                logger.info(f"   概念: {updated_node.name}")
                logger.info(f"   掌握度: {first_node.mastery:.1f}% → {updated_node.mastery:.1f}%")
                logger.info(f"   频次: {updated_node.frequency}/10")

        await print_separator("✅ 演示完成")

        logger.info("🎉 所有功能测试成功！\n")
        logger.info("你可以查看:")
        logger.info("  - PostgreSQL: 用户画像、快照、校准日志")
        logger.info("  - Neo4j: 学生节点、概念节点、交互关系\n")

        break  # 退出 async for 循环

    # ========== 清理 ==========
    await close_postgres_db()
    await close_neo4j_db()


async def main():
    """主函数"""
    try:
        await demo_conversation()
    except Exception as e:
        logger.error(f"\n❌ Demo failed: {e}", exc_info=True)
        raise


if __name__ == "__main__":
    asyncio.run(main())
