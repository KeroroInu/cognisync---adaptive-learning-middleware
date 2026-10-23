"""Analysis-ready long table; raw answers remain the authority, never inferred scores."""
from app.schemas.assessment import visible_question_ids

FIELDS = {
    "user_id": "学生稳定 UUID，关联 users.id；不要用姓名关联",
    "research_id": "S- 加 user_id，供研究标记使用，不等于完全匿名",
    "response_id": "本次答卷 ID，关联 assessment_responses.id",
    "round_id": "本次发放的试卷 ID，关联 assessment_rounds.id",
    "round_name": "教师保存的题本名称",
    "revision": "题本版本；不同发放仍须按 round_id 区分",
    "phase": "历史 pre/post 标签，不代表实际测量时点，须结合发放安排",
    "class_snapshot": "提交时班级，不是学生当前班级",
    "group_snapshot": "提交时分组",
    "started_at": "首次获取题本/草稿起始时间（ISO 8601），不是逐题开始时间",
    "submitted_at": "服务器接受答卷的时间（ISO 8601）",
    "question_order": "题本中的顺序，从 1 起；含补充字段",
    "question_id": "题号，仅在同一 round_id 内唯一",
    "parent_id": "补充字段对应的主问题 ID；无则 null",
    "question": "发放时的完整题干",
    "question_type": "choice 单选 / multiple 多选 / text 文本",
    "required": "是否必填",
    "code": "题干代码，原样保留",
    "options": "选项 value/label 等原始定义（JSON）",
    "status": "answered 已回答 / unanswered 可见未答 / skipped_by_rule 跳题 / explicit_skip 主动选择不会等出口",
    "answer_present": "原始 answers 是否实际包含该题，区分缺字段与显式 null",
    "answer_value": "原始答案值；多选为 JSON 数组，null 不补 0",
    "answer_label": "按发布时选项转换的文字；多选为 JSON 数组",
}


def item_rows(response, definition):
    questions, answers = definition["questions"], response["answers"]
    visible = visible_question_ids(questions, answers)
    for index, q in enumerate(questions, 1):
        value = answers.get(q["id"])
        explicit_skip = value == "__skip__" and bool(q.get("skip_label"))
        empty = value in (None, "", []) or isinstance(value, str) and not value.strip()
        status = ("skipped_by_rule" if q["id"] not in visible else "explicit_skip" if explicit_skip
                  else "unanswered" if empty else "answered")
        options = {o["value"]: o["label"] for o in q.get("options", [])}
        label = ([options.get(v, v) for v in value] if isinstance(value, list)
                 else q["skip_label"] if explicit_skip else options.get(value, value))
        yield {
            "user_id": response["user_id"], "research_id": f'S-{response["user_id"]}',
            "response_id": response["id"], "round_id": response["round_id"],
            "round_name": definition["name"], "revision": definition["revision"], "phase": definition["phase"],
            "class_snapshot": response["class_snapshot"], "group_snapshot": response["group_snapshot"],
            "started_at": response["started_at"], "submitted_at": response["created_at"],
            "question_order": index, "question_id": q["id"], "parent_id": q.get("parent_id"),
            "question": q["text"], "question_type": q["type"], "required": q.get("required", False),
            "code": q.get("code", ""), "options": q.get("options", []), "status": status,
            "answer_present": q["id"] in answers, "answer_value": value, "answer_label": label,
        }


ANALYSIS_GUIDE = """# 实验数据分析说明

## 从哪里开始

| 文件 | 一行代表什么 | 用法 |
| --- | --- | --- |
| assessment_items.csv / .jsonl | 一份已提交答卷中的一道题（含补充题） | 整理问卷、试卷的原始回答 |
| assessment_rounds.csv / .jsonl | 一次题本/发放 | 查看原题、版本和发放时间 |
| users.csv / .jsonl | 一位用户 | 以 id 关联；默认不含姓名学号 |
| learning_process.csv / .jsonl | 一条已采集的平台过程记录 | 按 user_id、at、source_id 排序并回查原表 |
| sfls_process.csv / .jsonl | 上传包中解析到的一条 SFLS 记录 | 用 receipt_id、archive_path、line 回查原件 |
| worksheets.csv / .jsonl | 一次任务单保存版本 | 比较学生历次设计与反思 |
| classroom_material_receipts.csv / .jsonl | 一次任务下载或提交回执 | 按 material_id 找任务，按 user_id 找学生 |
| classroom_responses.csv / .jsonl | 一次课堂互动回答 | 用 publication_id 关联发布时的题目 |
| teacher_notes.csv / .jsonl | 一次教师备注 | 区分观察事实与教师解释 |
| originals/ | 已接收的任务包与学生提交原件 | 文件名是记录 ID；原文件名/类型在回执或材料表 |
| original_files.csv / .jsonl | 每份服务器已保存原件的清单 | 核对 SHA-256、大小、来源 ID；是否嵌入见 manifest.originals.included |
| knowledge_graph.csv / .jsonl | 当前知识图谱记录（若勾选） | 不是每节课的历史图谱 |

所有原始表同时保留 CSV 与 JSONL。manifest.json 提供导出范围、字段类型、外键、行数、文件校验值；
数据字典.csv 提供字段含义。主键都按字符串读取，不能转换成数字。

## 问卷与试卷

assessment_items 的唯一键为 response_id + question_id；跨次发放不能只按题号合并。
单选保留选项编码与文字；多选保留 JSON 数组，分析时按发布选项展开 0/1 列，并保留未作答状态。
status 区分 answered、unanswered、skipped_by_rule、explicit_skip；null、空字符串、跳题均不自动当作 0 分。
尚未提交的学生没有答卷行，不补造未答记录；当前 users 名单不一定等于历史发放时名单。
代码试题的正确性、反向计分、量表总分及前后测配对规则须在分析计划中明确；导出不自动赋予能力分。

## 关联每节课

以 material_id / task_id、题本 round_id 与教师的课时安排表关联。
材料的课时模板编号在 classroom_materials.configuration.worksheet.lesson_id；课堂实际安排仍以教师课表为准。
classroom session_id 是班级工作区，可能跨多节课复用，不应直接当作课时编号。
学生当时班级优先用 class_snapshot / group_snapshot；users 中是当前班级。
保留原始时区，统一转成 Asia/Shanghai 后再按课堂日期分组。开始到提交的间隔不是有效学习时长。
本地 SFLS 的 client_at 是未校验的电脑时间，received_at 是服务器收件时间；不要混作同一时钟。
重复上传可能包含相同日志，先按原日志标识/来源核对去重，不要将每个收件包都算作一次新行为。
SFLS 操作日志优先按 user_id + run_id + sequence 查重；会话消息按 user_id + archive_path + event_id 查重。
缺少这些标识时保留原记录，使用 receipt_id + archive_path + line 定位人工核对，不用正文相同就自动去重。
同键内容冲突时不能直接删掉，需比较原件并标记；不同学生、不同运行的同文消息不能合并。
自动提取的知识点/画像是待人工核验的分析线索，不能直接当作学生掌握证据。

## 保存与隐私

保留一份只读原始 ZIP，在副本中清洗与编码。JSONL 保留嵌套结构和 null；CSV 用 UTF-8 BOM，
文本以 =、+、-、@ 等字符开头时加单引号防止 Excel 执行公式，还原原文请读 JSONL。
此包不是数据库备份；请另外备份数据库和原始文件。密码、令牌、系统配置、课堂密钥通知不导出。
默认嵌入原件；显式取消“包含上传原件”时只省略 ZIP 内原件字节，仍逐份解析 SFLS 过程索引。
此时用 original_files 清单与任务收件页核对并下载原件，不能把这个结构化包当作原件备份。
自由文本和上传原件仍可能含身份信息或学生自行粘贴的密钥，分享前必须检查脱敏。
只包含服务器已接收的数据；未上传的本机对话和仅存浏览器的未提交草稿不在包中。
打包失败不会删除数据库记录，也不会返回悄悄截断的“完整包”。
"""
