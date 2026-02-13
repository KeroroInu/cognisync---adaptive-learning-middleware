"""
初始化量表模板数据 - 使用原始SQL
创建默认的学习画像评估量表
"""
import asyncio
import uuid
import json
from datetime import datetime, UTC
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from app.core.config import settings


async def seed_scale_templates():
    """种子量表模板数据"""

    # 创建异步引擎
    engine = create_async_engine(
        settings.DATABASE_URL,
        echo=False,
        pool_pre_ping=True
    )

    template_id = uuid.uuid4()
    now = datetime.now(UTC)

    # 构造量表数据
    schema_json = {
        "description": "通过标准化量表快速建立初始学习画像",
        "items": [
            {
                "id": "item_1",
                "text": "我能够快速理解新概念",
                "dimension": "Cognition",
                "reverse_scored": False
            },
            {
                "id": "item_2",
                "text": "学习新知识让我感到焦虑",
                "dimension": "Affect",
                "reverse_scored": True
            },
            {
                "id": "item_3",
                "text": "我喜欢主动探索新的学习资源",
                "dimension": "Behavior",
                "reverse_scored": False
            },
            {
                "id": "item_4",
                "text": "我能够有效地组织和管理学习时间",
                "dimension": "Behavior",
                "reverse_scored": False
            },
            {
                "id": "item_5",
                "text": "面对困难问题时我能保持冷静",
                "dimension": "Affect",
                "reverse_scored": False
            },
            {
                "id": "item_6",
                "text": "我能够将新知识与已有知识联系起来",
                "dimension": "Cognition",
                "reverse_scored": False
            }
        ],
        "likert_scale": {
            "min": 1,
            "max": 5,
            "labels": {
                "1": "完全不同意",
                "2": "不同意",
                "3": "中立",
                "4": "同意",
                "5": "完全同意"
            }
        }
    }

    scoring_json = {
        "method": "dimension_average",
        "dimensions": ["Cognition", "Affect", "Behavior"],
        "mapping": {
            "Cognition": ["item_1", "item_6"],
            "Affect": ["item_2", "item_5"],
            "Behavior": ["item_3", "item_4"]
        },
        "reverse_items": ["item_2"],
        "score_range": [0, 100]
    }

    mapping_json = {
        "cognition": {
            "items": ["item_1", "item_6"],
            "weight": 20
        },
        "affect": {
            "items": ["item_2", "item_5"],
            "weight": 20
        },
        "behavior": {
            "items": ["item_3", "item_4"],
            "weight": 20
        }
    }

    # 使用原始SQL插入
    async with engine.begin() as conn:
        # 检查是否已存在
        check_sql = text("""
        SELECT id FROM scale_templates
        WHERE name = '学习画像评估量表 v1.0'
        LIMIT 1
        """)
        result = await conn.execute(check_sql)
        existing = result.fetchone()

        if existing:
            print("✅ 量表模板已存在，跳过创建")
            await engine.dispose()
            return

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
                "name": "学习画像评估量表 v1.0",
                "version": 1,
                "status": "active",
                "schema_json": json.dumps(schema_json),
                "scoring_json": json.dumps(scoring_json),
                "mapping_json": json.dumps(mapping_json),
                "created_at": now,
                "updated_at": now
            }
        )

        print(f"✅ 成功创建量表模板: 学习画像评估量表 v1.0")
        print(f"   ID: {template_id}")
        print(f"   题目数: {len(schema_json['items'])}")
        print(f"   状态: active")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(seed_scale_templates())
