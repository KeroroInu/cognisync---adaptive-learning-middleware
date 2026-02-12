# 数据库迁移指南

## 当前方案：SQLAlchemy create_all (MVP)

当前项目使用 `Base.metadata.create_all()` 快速创建表结构，适合 MVP 阶段。

### 初始化数据库

```bash
cd backend
python scripts/init_db.py
```

### 重置数据库（开发环境）

```bash
# 删除所有表
python scripts/init_db.py drop

# 重新创建
python scripts/init_db.py
```

---

## 迁移到 Alembic（生产环境推荐）

### 为什么需要 Alembic？

- ✅ 版本化的数据库 schema 变更
- ✅ 支持回滚和升级
- ✅ 自动生成迁移脚本
- ✅ 团队协作时保持数据库一致性

### 迁移步骤

#### 1. 安装 Alembic

```bash
pip install alembic
```

#### 2. 初始化 Alembic

```bash
cd backend
alembic init alembic
```

#### 3. 配置 `alembic.ini`

编辑 `alembic.ini`，设置数据库 URL：

```ini
# 注释掉默认的 sqlalchemy.url
# sqlalchemy.url = driver://user:pass@localhost/dbname

# 使用环境变量
sqlalchemy.url = postgresql+asyncpg://%(DB_USER)s:%(DB_PASSWORD)s@%(DB_HOST)s:%(DB_PORT)s/%(DB_NAME)s
```

#### 4. 配置 `alembic/env.py`

修改 `env.py` 以支持异步和自动检测模型：

```python
import asyncio
from logging.config import fileConfig
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context

# 导入你的模型
from app.models.sql.base import Base
from app.models.sql.user import User
from app.models.sql.message import ChatMessage
from app.models.sql.profile import ProfileSnapshot
from app.models.sql.calibration_log import CalibrationLog
from app.models.sql.chat_session import ChatSession
from app.models.sql.scale import ScaleTemplate, ScaleResponse
from app.models.sql.onboarding import OnboardingSession

# 导入配置
from app.core.config import settings

# Alembic Config object
config = context.config

# 设置数据库 URL
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL.replace("+asyncpg", ""))

# 设置 target metadata
target_metadata = Base.metadata

# ... rest of the file

def run_migrations_online() -> None:
    """Run migrations in 'online' mode with async support."""

    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async def do_run_migrations(connection: Connection) -> None:
        await connection.run_sync(do_run_migrations_sync)

    def do_run_migrations_sync(connection: Connection) -> None:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()

    asyncio.run(do_run_migrations(connectable))
```

#### 5. 生成初始迁移

```bash
# 自动检测当前模型并生成迁移
alembic revision --autogenerate -m "Initial migration"

# 查看生成的迁移文件
ls alembic/versions/
```

#### 6. 执行迁移

```bash
# 升级到最新版本
alembic upgrade head

# 查看当前版本
alembic current

# 查看迁移历史
alembic history
```

#### 7. 日常开发流程

每次修改模型后：

```bash
# 1. 生成迁移脚本
alembic revision --autogenerate -m "Add new field to User table"

# 2. 检查生成的迁移文件（非常重要！）
cat alembic/versions/xxxx_add_new_field.py

# 3. 执行迁移
alembic upgrade head
```

#### 8. 回滚操作

```bash
# 回滚一个版本
alembic downgrade -1

# 回滚到特定版本
alembic downgrade <revision_id>

# 回滚所有迁移
alembic downgrade base
```

---

## 对比：create_all vs Alembic

| 特性 | create_all | Alembic |
|------|-----------|---------|
| 快速原型开发 | ✅ 非常快 | ❌ 需要配置 |
| 版本控制 | ❌ 无 | ✅ 完整支持 |
| 团队协作 | ❌ 困难 | ✅ 容易 |
| 生产环境 | ❌ 不推荐 | ✅ 强烈推荐 |
| 数据迁移 | ❌ 会丢失数据 | ✅ 保留数据 |
| 回滚能力 | ❌ 无 | ✅ 支持 |

---

## 最佳实践

### MVP/开发阶段
- 使用 `create_all()` 快速迭代
- 数据不重要时可以随时重建

### 准生产/生产阶段
- 立即切换到 Alembic
- 所有 schema 变更通过迁移脚本
- Code Review 必须包含迁移脚本检查
- 生产部署前在 staging 环境测试迁移

### 迁移注意事项
1. **永远不要手动修改迁移脚本** - 除非是修复 autogenerate 的问题
2. **迁移前备份数据库** - 尤其是生产环境
3. **测试回滚** - 确保 downgrade 也能正常工作
4. **不要删除旧的迁移文件** - 保持完整的迁移历史
5. **大表修改要小心** - 可能需要添加索引创建的并发选项

---

## 故障排查

### 问题：Alembic 无法检测到模型变更

**原因**：模型未被导入

**解决**：确保在 `alembic/env.py` 中导入所有模型

### 问题：迁移冲突

**原因**：多人同时创建迁移

**解决**：
```bash
# 合并迁移分支
alembic merge heads -m "Merge migration branches"
```

### 问题：生产环境迁移失败

**解决步骤**：
1. 立即回滚：`alembic downgrade -1`
2. 检查错误日志
3. 在 staging 重现问题
4. 修复后重新测试
5. 确认无误后再次部署

---

## 参考资源

- [Alembic 官方文档](https://alembic.sqlalchemy.org/)
- [SQLAlchemy 异步支持](https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html)
- [FastAPI + Alembic 教程](https://fastapi.tiangolo.com/tutorial/sql-databases/#alembic-note)
