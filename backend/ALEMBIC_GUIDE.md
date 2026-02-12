# Alembic 数据库迁移指南

## 概述

本项目已配置 Alembic 进行数据库版本管理和迁移。

## 迁移从 `create_all()` 到 Alembic

### 步骤 1: 安装依赖

```bash
cd backend
pip install -r requirements.txt
```

### 步骤 2: 生成初始迁移

如果这是全新的数据库：

```bash
# 生成初始迁移（自动检测所有模型）
alembic revision --autogenerate -m "Initial migration"
```

如果数据库已存在（使用 create_all 创建）：

```bash
# 1. 先标记当前数据库状态为最新
alembic stamp head

# 或者，如果需要重新生成迁移：
# 删除现有表，然后生成初始迁移
alembic revision --autogenerate -m "Initial migration"
```

### 步骤 3: 应用迁移

```bash
# 升级到最新版本
alembic upgrade head

# 查看当前版本
alembic current

# 查看迁移历史
alembic history --verbose
```

## 常用命令

### 创建新迁移

```bash
# 自动生成迁移（推荐）
alembic revision --autogenerate -m "Add new column to users"

# 手动创建空迁移
alembic revision -m "Custom migration"
```

### 应用迁移

```bash
# 升级到最新版本
alembic upgrade head

# 升级到特定版本
alembic upgrade <revision_id>

# 升级一步
alembic upgrade +1
```

### 回滚迁移

```bash
# 回滚到上一版本
alembic downgrade -1

# 回滚到特定版本
alembic downgrade <revision_id>

# 回滚所有迁移
alembic downgrade base
```

### 查看状态

```bash
# 查看当前版本
alembic current

# 查看迁移历史
alembic history

# 查看详细历史
alembic history --verbose
```

## 迁移文件结构

```
backend/
├── alembic/
│   ├── versions/              # 迁移脚本目录
│   │   └── xxxx_initial_migration.py
│   ├── env.py                 # Alembic 环境配置
│   └── script.py.mako         # 迁移模板
├── alembic.ini                # Alembic 配置文件
└── app/
    └── models/sql/            # SQLAlchemy 模型
```

## 最佳实践

### 1. 在开发环境中测试迁移

```bash
# 应用迁移
alembic upgrade head

# 测试应用是否正常工作

# 如果有问题，回滚
alembic downgrade -1
```

### 2. 审查自动生成的迁移

自动生成的迁移可能不完美，需要手动审查：

```python
def upgrade() -> None:
    # 检查这些操作是否正确
    op.create_table(...)
    op.add_column(...)

def downgrade() -> None:
    # 确保有正确的回滚逻辑
    op.drop_column(...)
    op.drop_table(...)
```

### 3. 数据迁移

对于包含数据转换的迁移：

```python
from alembic import op
import sqlalchemy as sa

def upgrade() -> None:
    # 先修改结构
    op.add_column('users', sa.Column('full_name', sa.String(255)))

    # 然后迁移数据
    connection = op.get_bind()
    connection.execute(
        sa.text("UPDATE users SET full_name = name || ' ' || email")
    )

def downgrade() -> None:
    op.drop_column('users', 'full_name')
```

### 4. 生产环境迁移流程

```bash
# 1. 备份数据库
pg_dump -U postgres -d cognisync > backup_$(date +%Y%m%d_%H%M%S).sql

# 2. 测试迁移（在测试数据库）
alembic upgrade head

# 3. 如果成功，在生产环境执行
alembic upgrade head

# 4. 验证应用是否正常工作
```

### 5. 团队协作

```bash
# 拉取最新代码后
git pull

# 应用新的迁移
alembic upgrade head

# 创建新迁移前，先拉取最新代码
git pull
alembic revision --autogenerate -m "Your migration message"
```

## 环境变量

Alembic 从 `.env` 文件读取数据库连接：

```bash
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/cognisync
```

## 常见问题

### 1. 迁移冲突

如果多人同时创建迁移，可能会出现冲突：

```bash
# 合并迁移
alembic merge -m "Merge branches" <revision1> <revision2>
```

### 2. 检测不到模型更改

确保在 `alembic/env.py` 中导入了所有模型：

```python
from app.models.sql.user import User
from app.models.sql.chat_message import ChatMessage
# ... 导入所有模型
```

### 3. 异步引擎问题

本项目使用异步 SQLAlchemy，`env.py` 已配置支持异步操作。

## 从 create_all() 迁移的完整步骤

如果你的数据库是使用 `Base.metadata.create_all()` 创建的：

### 选项 1: 标记现有数据库（推荐，保留数据）

```bash
# 1. 生成初始迁移
alembic revision --autogenerate -m "Initial migration"

# 2. 不要运行 upgrade，而是标记数据库已是最新状态
alembic stamp head
```

### 选项 2: 重新创建数据库（仅开发环境）

```bash
# 1. 删除所有表
# 在 PostgreSQL 中：
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;

# 2. 生成并应用初始迁移
alembic revision --autogenerate -m "Initial migration"
alembic upgrade head
```

### 选项 3: 逐步迁移（生产环境）

```bash
# 1. 创建一个空的初始迁移
alembic revision -m "Initial migration - marking existing tables"

# 2. 编辑生成的迁移文件，清空 upgrade() 和 downgrade()
def upgrade() -> None:
    pass

def downgrade() -> None:
    pass

# 3. 标记数据库
alembic stamp head

# 4. 之后的更改使用正常的迁移流程
```

## 更新 main.py

迁移到 Alembic 后，从 `main.py` 中移除 `init_db()` 调用：

```python
# 移除或注释掉
# await init_db()

# 改为在启动前运行迁移
# 或者在部署脚本中运行：alembic upgrade head
```
