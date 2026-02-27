"""
初始化量表模板数据 - 使用原始SQL
创建 AI 教育研究前/后测量表（6维度，41题）

维度 → CAB 画像映射：
  Cognition ← CT (0.35) + CPS (0.35) + AIL (0.30)
  Affect    ← SE (0.50) + LM (0.50)
  Behavior  ← PA (1.00)
"""
import asyncio
import uuid
import json
from datetime import datetime, UTC
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from app.core.config import settings


TEMPLATE_NAME = "AI 教育研究量表 v1.0"


async def seed_scale_templates():
    """种子量表模板数据"""

    engine = create_async_engine(
        settings.DATABASE_URL,
        echo=False,
        pool_pre_ping=True
    )

    template_id = uuid.uuid4()
    now = datetime.now(UTC)

    # ─── 量表题目（41 题，6 维度）────────────────────────────────────────────

    schema_json = {
        "description": "AI 教育研究前/后测问卷（计算思维 · 自我效能感 · 学习动机 · 复杂问题解决 · 编程能力 · AI 素养）",
        "questions": [
            # ── 一、计算思维 (CT) ─────────────────────────────────────────────
            {"id": "ct1", "text": "遇到问题时，我喜欢尝试不同或有创意的解决方式。", "dimension": "CT", "reverse_scored": False},
            {"id": "ct2", "text": "面对任务时，我会将大问题拆成若干小步骤。",         "dimension": "CT", "reverse_scored": False},
            {"id": "ct3", "text": "写代码前，我通常会先理清逻辑或流程。",             "dimension": "CT", "reverse_scored": False},
            {"id": "ct4", "text": "看到一段代码时，我能大致判断其功能。",             "dimension": "CT", "reverse_scored": False},
            {"id": "ct5", "text": "遇到困难时，我愿意与同伴合作解决问题。",           "dimension": "CT", "reverse_scored": False},
            {"id": "ct6", "text": "面对 AI 或他人提供的代码，我会先判断是否合理。",   "dimension": "CT", "reverse_scored": False},
            {"id": "ct7", "text": "程序运行失败时，我会逐步排查错误原因。",           "dimension": "CT", "reverse_scored": False},

            # ── 二、自我效能感 (SE) ───────────────────────────────────────────
            {"id": "se1", "text": "我相信自己能够在本课程中取得好成绩。",             "dimension": "SE", "reverse_scored": False},
            {"id": "se2", "text": "即使很难，我也有信心理解课程中的内容。",           "dimension": "SE", "reverse_scored": False},
            {"id": "se3", "text": "我确信自己能理解课程的关键概念。",                 "dimension": "SE", "reverse_scored": False},
            {"id": "se4", "text": "我能在作业和测验中表现良好。",                     "dimension": "SE", "reverse_scored": False},
            {"id": "se5", "text": "我觉得自己能够掌握本课程教授的技能。",             "dimension": "SE", "reverse_scored": False},
            {"id": "se6", "text": "我相信只要努力我可以学好本课程。",                 "dimension": "SE", "reverse_scored": False},

            # ── 三、学习动机 (LM) ─────────────────────────────────────────────
            {"id": "lm1", "text": "我喜欢具有挑战性的学习内容。",                     "dimension": "LM", "reverse_scored": False},
            {"id": "lm2", "text": "即使内容困难，只要能激发好奇心我也愿意学。",       "dimension": "LM", "reverse_scored": False},
            {"id": "lm3", "text": "比起得高分，我更看重是否学到东西。",               "dimension": "LM", "reverse_scored": False},
            {"id": "lm4", "text": "在本课程中取得好成绩对我很重要。",                 "dimension": "LM", "reverse_scored": False},
            {"id": "lm5", "text": "我希望自己的表现优于多数同学。",                   "dimension": "LM", "reverse_scored": False},
            {"id": "lm6", "text": "我希望通过本课程的表现展示自己的能力。",           "dimension": "LM", "reverse_scored": False},

            # ── 四、复杂问题解决倾向 (CPS) ───────────────────────────────────
            {"id": "cps1", "text": "面对复杂问题时，我会先分析问题的真正原因。",       "dimension": "CPS", "reverse_scored": False},
            {"id": "cps2", "text": "当一种方法失败时，我会思考失败的原因。",           "dimension": "CPS", "reverse_scored": False},
            {"id": "cps3", "text": "遇到难题时，我通常能想到多种解决方案。",           "dimension": "CPS", "reverse_scored": False},
            {"id": "cps4", "text": "面对复杂问题时，我会制定分步骤的计划。",           "dimension": "CPS", "reverse_scored": False},
            {"id": "cps5", "text": "遇到问题时，我有时会不加思考直接执行。",           "dimension": "CPS", "reverse_scored": True},
            {"id": "cps6", "text": "我愿意查资料或请教他人来解决问题。",               "dimension": "CPS", "reverse_scored": False},
            {"id": "cps7", "text": "连续失败时，我仍然相信自己能找到解决方案。",       "dimension": "CPS", "reverse_scored": False},
            {"id": "cps8", "text": "解决问题后，我会回顾哪些做法有效。",               "dimension": "CPS", "reverse_scored": False},

            # ── 五、编程能力与项目表现 (PA) ───────────────────────────────────
            {"id": "pa1", "text": "我能独立实现课程项目要求的主要功能。",               "dimension": "PA", "reverse_scored": False},
            {"id": "pa2", "text": "我写的代码结构清晰、容易理解。",                     "dimension": "PA", "reverse_scored": False},
            {"id": "pa3", "text": "遇到错误时，我能通过调试定位问题。",                 "dimension": "PA", "reverse_scored": False},
            {"id": "pa4", "text": "我能把课堂上学到的知识运用到新的任务中。",           "dimension": "PA", "reverse_scored": False},
            {"id": "pa5", "text": "与 AI 协作时，我能判断哪些建议适合任务。",           "dimension": "PA", "reverse_scored": False},
            {"id": "pa6", "text": "我能够清楚解释我的程序是如何工作的。",               "dimension": "PA", "reverse_scored": False},

            # ── 六、AI 素养 (AIL) ────────────────────────────────────────────
            {"id": "ail1", "text": "我大致了解常见 AI 技术（如大模型、图像识别）的工作方式。", "dimension": "AIL", "reverse_scored": False},
            {"id": "ail2", "text": "我能举出 AI 在生活或学习中的应用实例。",             "dimension": "AIL", "reverse_scored": False},
            {"id": "ail3", "text": "我知道如何向 AI 清晰表达需求。",                     "dimension": "AIL", "reverse_scored": False},
            {"id": "ail4", "text": "当 AI 的回答可能有误时，我会进行查证或比对。",       "dimension": "AIL", "reverse_scored": False},
            {"id": "ail5", "text": "我意识到 AI 输出中可能存在偏见或不公平。",           "dimension": "AIL", "reverse_scored": False},
            {"id": "ail6", "text": "处理敏感信息时，我会谨慎输入 AI。",                   "dimension": "AIL", "reverse_scored": False},
            {"id": "ail7", "text": "我能区分哪些内容是我完成的、哪些是 AI 生成的。",     "dimension": "AIL", "reverse_scored": False},
            {"id": "ail8", "text": "我认为自己具备基本且负责任的 AI 使用能力。",         "dimension": "AIL", "reverse_scored": False},
        ],
        "likert_scale": {
            "min": 1,
            "max": 5,
            "labels": {
                "1": "非常不同意",
                "2": "不同意",
                "3": "一般",
                "4": "同意",
                "5": "非常同意"
            }
        }
    }

    # ─── 各维度题目归属与反向计分────────────────────────────────────────────

    scoring_json = {
        "method": "dimension_average",
        "dimensions": ["CT", "SE", "LM", "CPS", "PA", "AIL"],
        "mapping": {
            "CT":  ["ct1", "ct2", "ct3", "ct4", "ct5", "ct6", "ct7"],
            "SE":  ["se1", "se2", "se3", "se4", "se5", "se6"],
            "LM":  ["lm1", "lm2", "lm3", "lm4", "lm5", "lm6"],
            "CPS": ["cps1", "cps2", "cps3", "cps4", "cps5", "cps6", "cps7", "cps8"],
            "PA":  ["pa1", "pa2", "pa3", "pa4", "pa5", "pa6"],
            "AIL": ["ail1", "ail2", "ail3", "ail4", "ail5", "ail6", "ail7", "ail8"],
        },
        "reverse_items": ["cps5"],
        "score_range": [0, 100]
    }

    # ─── 六维度 → CAB 三维画像映射 ──────────────────────────────────────────
    # Cognition：认知投入（计算思维 + 复杂问题解决 + AI 素养）
    # Affect：情感投入（自我效能感 + 学习动机）
    # Behavior：行为投入（编程能力与项目表现）

    mapping_json = {
        "cognition": {
            "source_dimensions": ["CT", "CPS", "AIL"],
            "weights": [0.35, 0.35, 0.30]
        },
        "affect": {
            "source_dimensions": ["SE", "LM"],
            "weights": [0.50, 0.50]
        },
        "behavior": {
            "source_dimensions": ["PA"],
            "weights": [1.0]
        }
    }

    # ─── 写入数据库 ──────────────────────────────────────────────────────────

    async with engine.begin() as conn:
        # 检查是否已存在
        check_sql = text("""
        SELECT id FROM scale_templates
        WHERE name = :name
        LIMIT 1
        """)
        result = await conn.execute(check_sql, {"name": TEMPLATE_NAME})
        existing = result.fetchone()

        if existing:
            print(f"✅ 量表模板已存在，跳过创建：{TEMPLATE_NAME}")
            await engine.dispose()
            return

        # 归档旧的 active 模板（如果有）
        archive_sql = text("""
        UPDATE scale_templates SET status = 'archived', updated_at = :now
        WHERE status = 'active'
        """)
        archived = await conn.execute(archive_sql, {"now": now})
        if archived.rowcount:
            print(f"📦 已归档 {archived.rowcount} 个旧 active 模板")

        # 插入新模板
        insert_sql = text("""
        INSERT INTO scale_templates (
            id, name, version, status, schema_json,
            scoring_json, mapping_json, created_at, updated_at
        ) VALUES (
            :id, :name, :version, :status, :schema_json::jsonb,
            :scoring_json::jsonb, :mapping_json::jsonb, :created_at, :updated_at
        )
        """)

        await conn.execute(
            insert_sql,
            {
                "id": template_id,
                "name": TEMPLATE_NAME,
                "version": 1,
                "status": "active",
                "schema_json": json.dumps(schema_json, ensure_ascii=False),
                "scoring_json": json.dumps(scoring_json, ensure_ascii=False),
                "mapping_json": json.dumps(mapping_json, ensure_ascii=False),
                "created_at": now,
                "updated_at": now
            }
        )

        total_items = len(schema_json["questions"])
        print(f"✅ 成功创建量表模板：{TEMPLATE_NAME}")
        print(f"   ID: {template_id}")
        print(f"   题目数: {total_items}（CT×7 + SE×6 + LM×6 + CPS×8 + PA×6 + AIL×8）")
        print(f"   反向计分题: cps5")
        print(f"   CAB 映射: Cognition←CT+CPS+AIL  Affect←SE+LM  Behavior←PA")
        print(f"   状态: active")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(seed_scale_templates())
