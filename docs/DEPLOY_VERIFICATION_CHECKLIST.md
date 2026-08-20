# CogniSync 上线前验证清单（学生解构流程）

面向"部署到服务器让外部测试者走完整流程"这一目标。**按顺序执行**，任何一步不通过就不要继续下一步。

前四步在你本机跑（需要 Docker）；第五步之后才涉及服务器。

> **为什么必须先跑这一遍**：Task 1 的证据链代码（5 张新表 + 建表迁移 + 87 条集成测试）
> **从未在真实 PostgreSQL 上执行过**——之前的开发环境是 Python 3.10 且无 PostgreSQL。
> `init_db()` 捕获异常后会 `raise`（`backend/app/db/postgres.py:106-108`），
> 也就是说迁移一旦出错，后端不是降级而是**根本起不来**。这一步不能跳过。

---

## 第 0 步：准备环境变量

```bash
cd ~/Documents/系统开发/cognisync---adaptive-learning-middleware

# 根目录 .env —— compose 解析时用，backend/.env 喂不进去
cp .env.example .env

# 至少改这两个（生产环境 main.py 会校验强度，弱口令直接拒绝启动）
#   ADMIN_KEY     ≥24 位，生成：openssl rand -base64 36
#   NEO4J_AUTH    格式 neo4j/密码，必须与 backend/.env 的 NEO4J_PASSWORD 一致
$EDITOR .env

# 后端 .env
cp backend/.env.example backend/.env
$EDITOR backend/.env   # POSTGRES_PASSWORD、JWT_SECRET(≥32位)、LLM 的 API Key
```

**验收**：`docker compose config > /dev/null && echo OK`
报错说明变量没配全，不要往下走。

---

## 第 1 步：起测试库

```bash
docker compose up -d postgres
docker compose ps postgres          # 等 STATUS 变成 healthy

# 建一个专用测试库（conftest 强制要求库名以 _test 结尾）
docker compose exec postgres psql -U cognisync -d postgres \
  -c "CREATE DATABASE cognisync_test;"
```

---

## 第 2 步：跑全量后端测试 ← **最关键的一步**

```bash
cd backend
python3 -m venv venv && source venv/bin/activate    # 需要 Python 3.11+
pip install -r requirements.txt

export TEST_DATABASE_URL='postgresql+asyncpg://cognisync:你的密码@localhost:5432/cognisync_test'
pytest -q
```

**预期**：约 167 条用例全部通过（80 条离线 + 87 条需要数据库）。

**重点看这三个文件的结果**，它们覆盖的是本轮新写、从未实跑过的逻辑：

| 文件 | 条数 | 覆盖什么 |
|---|---|---|
| `tests/test_research_task_guard_api.py` | 40 | 幂等、并发建版、跨实验组隔离、删除保护、迁移中止 |
| `tests/test_research_stage_events_api.py` | 20 | 事件与产物关联、组合校验、导出 |
| `tests/test_scaffold_event_delivery.py` | 4 | 支架事件只在送达后记录 |

**失败了怎么办**：把完整的失败用例名和 traceback 发给我，不要自己改断言让它变绿——
这些测试断言的是研究数据的正确性，改断言等于把问题藏起来。

顺带跑一下静态检查：

```bash
ruff check app/ tests/
git diff --check
```

---

## 第 3 步：SQL 脚本验收

```bash
cd ..
export ADMIN_DATABASE_URL='postgresql://cognisync:你的密码@localhost:5432/postgres'
bash scripts/verify_task1_scripts.sh
```

这个脚本会在一次性库 `cognisync_script_check` 上构造四种 schema 状态，
验证三个 SQL 脚本在每种状态下都干净运行。**它同样从未实际执行过**，只做过语法检查。

---

## 第 4 步：整栈起来 + 建表迁移实跑

```bash
docker compose up -d --build
docker compose logs -f backend        # 盯着看，Ctrl-C 退出
```

**必须看到**：

- `✅ Database tables created successfully`
- `📊 Created tables:` 里包含这五张新表：
  `stage_artifacts`、`artifact_versions`、`stage_events`、`stage_event_artifacts`、`scaffold_events`
- **没有** `❌ Database initialization failed`

验证外键动作真的是 RESTRICT（这是研究证据不被误删的最后一道防线）：

```bash
docker compose exec postgres psql -U cognisync -d cognisync_db -c "
SELECT a.attname, c.confdeltype
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid
JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = c.conkey[1]
WHERE c.contype='f' AND t.relname='scaffold_events'
  AND a.attname IN ('student_message_id','assistant_message_id');"
```

两行的 `confdeltype` 都必须是 `r`。出现 `n`（SET NULL）说明迁移没生效。

健康检查：

```bash
curl -s localhost/health | python3 -m json.tool
```

> 注意 `/health` 目前只把 postgres 计入 `healthy`，**Neo4j 挂了也返回 200**。
> 所以要单独确认图谱连上了：`docker compose logs backend | grep -i neo4j`
> 看到认证失败就是 `.env` 的 `NEO4J_AUTH` 和 `backend/.env` 的 `NEO4J_PASSWORD` 对不上。

---

## 第 5 步：Pyodide 自托管验证（国内部署必看）

建构阶段在浏览器里跑 Python 完全依赖 Pyodide。原先从 `cdn.jsdelivr.net` 加载，
国内课堂环境经常极慢甚至不可达，已改为同源自托管。

```bash
# 运行时文件是否打进镜像了（约 13 MB）
docker compose exec frontend ls -lh /usr/share/nginx/html/pyodide/ | head

# wasm 的 MIME 必须是 application/wasm，不能是 octet-stream
curl -sI localhost/pyodide/pyodide.asm.wasm | grep -i content-type
```

预期 `Content-Type: application/wasm`。
如果是 `application/octet-stream`，浏览器的流式编译会失效，加载明显变慢。

**浏览器实测**：开 DevTools → Network，进入建构阶段点"运行测试"，
确认请求打到的是你自己的域名 `/pyodide/...`，**不应该出现任何 jsdelivr 请求**。

---

## 第 6 步：让测试者有活可干

种子数据只建了默认管理员、`kero/kero` 测试学生和默认量表，**没有研究任务**。
测试者进去会看到空白，所以必须先手工配置：

1. 用 `ADMIN_KEY` 登录管理后台
2. 研究管理 → 新建任务，`experiment_group` 设为 **pdt**（解构流程），状态设为 **ACTIVE**
3. 进入该任务的蓝图编辑器，导入 `docs/teacher-blueprints/snake-project-v2.json`
4. 依次配好关系、测试、支架三页，然后**发布**蓝图

> 任务不是 ACTIVE 的话，学生端每次确认阶段都会被 409 挡掉，
> 界面会提示"这个任务已归档"。这是刻意设计，不是 bug。

---

## 第 7 步：端到端走一遍（你自己先走，别让测试者当小白鼠）

注册一个新学生账号，完整走一遍：

观察 → 拆解 → 建模 → 规划 → 建构 → 最终提交

每个阶段确认后，验证证据真的落库了：

```bash
docker compose exec postgres psql -U cognisync -d cognisync_db -c "
SELECT stage, event_type, count(*)
FROM stage_events GROUP BY 1,2 ORDER BY 1,2;"
```

**重点验证这两条本轮新改的行为**（它们只有前端类型检查，没有自动化测试）：

- **上报失败必须阻断推进**：确认阶段时断网 → 应该**停在原地**并提示，
  而不是进入下一阶段。恢复网络后再点一次应该成功。
- **重复测试不制造版本**：同一段代码连跑 3 次测试，
  `artifact_versions` 里该模块应该只有 **1 个版本**（`stage_events` 里有 3 条 `module_test`）：

```bash
docker compose exec postgres psql -U cognisync -d cognisync_db -c "
SELECT sa.artifact_key, count(av.id) AS versions
FROM stage_artifacts sa LEFT JOIN artifact_versions av ON av.artifact_id = sa.id
WHERE sa.artifact_type = 'module_code' GROUP BY 1;"
```

最后确认导出可用：

```bash
curl -s -H "X-Admin-Key: $ADMIN_KEY" \
  "localhost/api/admin/export/csv/stage-events" | head -3
```

> 这三个新导出（`stage-events`、`artifact-versions`、`scaffold-events`）
> **管理后台还没有界面入口**，目前只能这样用 curl 取。

---

## 已知的、这轮不阻断但你该心里有数的

- **README 的 E01–E13 情感编码表与代码不符**，13 个里错了 9 个。E13 在代码里是
  `neutral` 且是解析失败的兜底桶，README 却写成 `discouraged`。
  拿 README 解码导出的 `emotion_code` 会得到完全错误的结论。分析数据前务必以
  `backend/app/services/emotion_coding.py` 为准。
- `/docs`、`/redoc`、`/openapi.json` 目前公网可访问，没有生产环境开关。
  对外测试期间如果不想暴露接口文档，在 `nginx-proxy/nginx.conf` 里先屏蔽掉。
- 研究任务**建完改不了**（编辑接口有但管理后台没接入口），
  配错了只能删任务重建，而删除会牵连已有提交记录。**所以第 6 步要一次配对**。
- 前端没有任何自动化测试，第 7 步的人工验证不能省。
