# Admin API 测试文档

## 概述

本文档说明 CogniSync Admin API 的测试套件，包含 13 个集成测试用例，覆盖所有核心功能。

## 快速开始

### 安装测试依赖

```bash
cd backend
pip install -r requirements-dev.txt
```

### 运行所有 Admin 测试

```bash
# 方式 1: 使用测试脚本（推荐）
./test-admin.sh

# 方式 2: 直接使用 pytest
pytest tests/test_admin_endpoints.py -v

# 方式 3: 运行并显示详细输出
pytest tests/test_admin_endpoints.py -v -s
```

### 运行特定测试用例

```bash
# 运行单个测试
pytest tests/test_admin_endpoints.py::test_list_tables -v

# 运行鉴权相关的所有测试
pytest tests/test_admin_endpoints.py -k "auth" -v

# 运行数据浏览器相关的所有测试
pytest tests/test_admin_endpoints.py -k "table" -v
```

---

## 测试用例列表

### 1. 鉴权测试（3 个测试）

#### test_admin_auth_no_key
- **目的**: 验证未提供 Admin Key 时返回 403
- **预期结果**: 返回 403 状态码，错误信息包含 "Invalid" 或 "missing"

#### test_admin_auth_invalid_key
- **目的**: 验证提供错误 Admin Key 时返回 403
- **预期结果**: 返回 403 状态码，success = false

#### test_admin_auth_valid_key
- **目的**: 验证提供正确 Admin Key 时可以访问
- **预期结果**: 返回 200 状态码，success = true

---

### 2. 数据浏览器测试（6 个测试）

#### test_list_tables
- **端点**: `GET /api/admin/explorer/tables`
- **目的**: 列出所有可视化表
- **验证点**:
  - 返回表名列表（users, chat_messages, profile_snapshots, calibration_logs）
  - 每个表包含 name 和 rowCount 字段
  - rowCount 为非负整数

#### test_get_table_schema
- **端点**: `GET /api/admin/explorer/tables/{table_name}/schema`
- **目的**: 获取指定表的结构信息
- **验证点**:
  - 返回表名和列信息列表
  - 每列包含 name, type, nullable, primary_key 字段
  - 敏感字段（hashed_password）已被过滤

#### test_get_table_schema_forbidden
- **端点**: `GET /api/admin/explorer/tables/invalid_table/schema`
- **目的**: 验证访问不在白名单中的表时返回 403
- **预期结果**: 返回 403 状态码

#### test_get_table_data
- **端点**: `GET /api/admin/explorer/tables/{table_name}/data?page=1&page_size=10`
- **目的**: 获取表数据（分页）
- **验证点**:
  - 返回表名、行数据、分页信息
  - 行数据不包含敏感字段
  - 分页信息包含 page, pageSize, total, totalPages

#### test_get_table_data_pagination
- **端点**: `GET /api/admin/explorer/tables/users/data?page=1&page_size=1`
- **目的**: 验证分页功能正常工作
- **验证点**:
  - 第 1 页和第 2 页返回不同的数据
  - 每页数据条数符合 page_size 参数

#### test_export_table
- **端点**: `GET /api/admin/explorer/tables/{table_name}/export`
- **目的**: 导出表数据为 JSON 格式
- **验证点**:
  - 返回 JSON 数组
  - 每条记录不包含敏感字段
  - 数据条数与表总行数一致

---

### 3. 用户管理测试（2 个测试）

#### test_list_users
- **端点**: `GET /api/admin/users?page=1&page_size=10`
- **目的**: 获取用户列表（分页）
- **验证点**:
  - 返回用户列表和分页信息
  - 每个用户包含完整画像数据（cognition, affect, behavior）
  - 包含消息统计（messageCount）
  - 包含时间信息（createdAt, lastActive）

#### test_list_users_pagination
- **端点**: `GET /api/admin/users?page=1&page_size=1`
- **目的**: 验证用户列表分页功能
- **验证点**:
  - 分页参数正确生效
  - 返回数据条数符合 page_size

---

### 4. 数据分析测试（1 个测试）

#### test_analytics_overview
- **端点**: `GET /api/admin/analytics/overview`
- **目的**: 获取系统统计概览
- **验证点**:
  - 返回总用户数（totalUsers）
  - 返回总消息数（totalMessages）
  - 返回 7 日活跃用户数（activeUsersLast7Days）
  - 返回 7 日活跃度趋势（activityTrend）
  - 趋势数据包含 7 个元素，每个包含 date, activeUsers, messages

---

### 5. 完整工作流测试（1 个测试）

#### test_complete_admin_workflow
- **目的**: 模拟管理员从登录到浏览数据的完整流程
- **流程步骤**:
  1. 查看系统概览（analytics/overview）
  2. 查看用户列表（users）
  3. 查看所有可用表（explorer/tables）
  4. 查看 users 表结构（explorer/tables/users/schema）
  5. 查看 users 表数据（explorer/tables/users/data）
  6. 导出 chat_messages 表（explorer/tables/chat_messages/export）
- **验证点**: 所有步骤都成功完成，数据一致性正确

---

## 测试数据

测试使用内存 SQLite 数据库，包含以下预置数据：

### 用户（2 个）
- `admin-test-user-001`:
  - email: test1@example.com
  - 画像: C=65, A=70, B=60
  - 创建时间: 7 天前
  - 最后活跃: 2 小时前

- `admin-test-user-002`:
  - email: test2@example.com
  - 画像: C=55, A=60, B=50
  - 创建时间: 3 天前
  - 最后活跃: 1 天前

### 消息（3 条）
- 用户 1 的对话（2 条消息）
- 用户 2 的对话（1 条消息）

### 画像快照（1 个）
- 用户 1 的快照（3 小时前）

---

## 测试配置

### Admin Key
测试使用的 Admin Key：`test_admin_key_for_testing`

在测试期间，原配置会被临时覆盖，测试结束后自动恢复。

### 数据库
测试使用内存 SQLite 数据库（`sqlite+aiosqlite:///:memory:`），所有数据在测试结束后自动清理，不会影响生产数据。

### 测试隔离
每个测试用例都是独立的：
- 使用独立的数据库会话
- 测试数据在测试结束后自动清理
- 不会相互影响

---

## 测试覆盖率

当前测试覆盖的功能模块：

✅ **Admin 鉴权**（100%）
- 无 Key 访问
- 错误 Key 访问
- 正确 Key 访问

✅ **数据浏览器**（100%）
- 列出所有表
- 获取表结构
- 获取表数据（分页）
- 导出表数据
- 敏感字段过滤
- 表白名单验证

✅ **用户管理**（100%）
- 用户列表查询
- 分页功能

✅ **数据分析**（100%）
- 系统概览统计
- 活跃度趋势分析

---

## 故障排查

### 测试失败：ModuleNotFoundError
**问题**: 找不到 pytest 或其他测试依赖

**解决方案**:
```bash
pip install -r requirements-dev.txt
```

### 测试失败：数据库错误
**问题**: SQLite 相关错误

**解决方案**:
```bash
pip install aiosqlite
```

### 测试失败：导入错误
**问题**: 找不到 app 模块

**解决方案**: 确保在 backend 目录下运行测试
```bash
cd backend
pytest tests/test_admin_endpoints.py -v
```

### 测试超时
**问题**: 测试运行时间过长

**解决方案**: 检查数据库连接是否正常
```bash
# 使用 -s 标志查看详细输出
pytest tests/test_admin_endpoints.py -v -s
```

---

## 添加新测试

### 1. 测试新的 Admin 端点

```python
@pytest.mark.asyncio
async def test_new_endpoint(admin_client):
    """
    测试 X: GET /api/admin/new-endpoint
    端点功能描述
    """
    response = await admin_client.get("/api/admin/new-endpoint")

    assert response.status_code == 200

    data = response.json()
    assert data["success"] is True

    # 添加更多验证...

    print(f"\n✅ New endpoint test passed")
```

### 2. 测试数据准备

在 `test_db` fixture 中添加测试数据：

```python
@pytest.fixture
async def test_db():
    # ... 现有代码 ...

    async with async_session_factory() as session:
        # 添加新的测试数据
        new_record = YourModel(
            field1="value1",
            field2="value2"
        )
        session.add(new_record)
        await session.commit()

    yield async_session_factory

    # ... 清理代码 ...
```

---

## CI/CD 集成

### GitHub Actions 示例

```yaml
name: Admin API Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
    - uses: actions/checkout@v2

    - name: Set up Python
      uses: actions/setup-python@v2
      with:
        python-version: '3.13'

    - name: Install dependencies
      run: |
        cd backend
        pip install -r requirements.txt
        pip install -r requirements-dev.txt

    - name: Run Admin API tests
      run: |
        cd backend
        pytest tests/test_admin_endpoints.py -v
```

---

## 最佳实践

1. **运行测试前**: 确保虚拟环境已激活
2. **添加新测试**: 为每个新的 Admin 端点添加对应测试
3. **测试数据**: 使用 fixture 准备测试数据，保持测试独立
4. **断言**: 使用详细的断言消息，便于调试
5. **清理**: 测试结束后自动清理数据，避免污染
6. **文档**: 每个测试用例都要有清晰的 docstring 说明
7. **覆盖率**: 定期检查测试覆盖率，确保核心功能都被测试

---

## 许可证

MIT License
