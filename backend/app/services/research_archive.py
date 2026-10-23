"""Read-only, lossless views over research-package metadata.

Folders are presentation indexes, never evidence of a historical class or lesson.
No uploaded bytes are parsed, extracted or executed by this module.
"""
from collections import Counter, defaultdict
from datetime import datetime
import hashlib
from pathlib import PurePosixPath
import re
import unicodedata
from urllib.parse import quote


LEARNER_ROLES = {"learner", "student", "user"}
GROUP_LABELS = {"pdt": "解构班", "ai_pbl": "开发班", "experience": "体验组",
                "lecture": "历史讲授组", "unassigned": "未分组"}
INDEX_FIELDS = {
    "索引/课次.csv": ("key", "label", "project_id", "lesson_id", "binding_status", "materials",
                       "submissions", "students", "original_bytes", "material_ids"),
    "索引/学生.csv": ("user_id", "research_id", "student_id", "name", "current_class", "current_group",
                       "school_class", "is_active", "student_path", "downloads", "submissions", "originals"),
    "索引/提交版本.csv": ("receipt_id", "user_id", "research_id", "material_id", "lesson_key", "lesson_id",
                           "project_id", "material_title", "kind", "created_at", "filename", "bytes", "sha256",
                           "has_original", "original_path", "current_class", "current_group", "record_class",
                           "record_group", "directory_class", "class_binding_source", "binding_status",
                           "binding_sources", "recorded_lesson_ids", "material_lesson_ids", "download_id",
                           "task_validation_status"),
    "索引/课次学生.csv": ("lesson_key", "lesson_id", "user_id", "research_id", "current_class", "current_group",
                           "record_classes", "record_groups", "downloads", "submissions", "originals",
                           "submission_originals", "submission_bytes", "submission_status"),
    "索引/数据范围.csv": ("item", "value", "limitation"),
}
INDEX_FIELD_DESCRIPTIONS = {
    "key": "明确发布配置产生的课次键；独立/冲突任务为material:完整UUID，不按日期或标题猜课次",
    "label": "便于选择的课次显示名；以key关联，不以同名显示文字合并任务",
    "project_id": "发布材料明确保存的项目编号；缺失不推断",
    "lesson_id": "发布材料明确保存的课次编号；C编号按其编号显示，历史L编号不映射到新课表",
    "binding_status": "材料/回执课次绑定状态；conflicting前缀须核查，不能当作已确认的本课记录",
    "materials": "该课次键关联的发布材料个数，不是学生人数",
    "submissions": "所选范围的全部submission收件次数，含不同版本与重复内容；不是已提交学生人数",
    "students": "该课次存在任意下载或提交回执的不同用户数；不是在册人数，也不代表交齐人数",
    "original_bytes": "所选课次有原件的教师材料与收件字节合计；按原始文件大小而非研究ZIP压缩大小",
    "material_ids": "该课次明确包含的完整发布材料UUID列表；同名不同材料不删除",
    "user_id": "服务器学生UUID，关联users.id；不是登录学号",
    "research_id": "S-加完整用户UUID的研究关联标识，不是不可回识的完全匿名编号",
    "student_id": "学生登记的登录学号；仅明确开启身份导出时填写",
    "name": "学生登记姓名；仅明确开启身份导出时填写",
    "current_class": "导出快照时users.class_name的当前班级，不代表记录发生时的班级",
    "current_group": "导出快照时users.experiment_group的当前教学组别，不反推历史分组",
    "school_class": "学生登记的实际行政班级，不自动等同实验组别",
    "is_active": "导出时账号是否启用，不等于出勤或参与状态",
    "student_path": "跨课公共平台记录的当前学生目录；教师及未知用户不生成该目录",
    "downloads": "download回执次数；重复下载重复计数，不是不同下载学生人数，亦非下载成功证据",
    "originals": "所选范围content确实非空的收件个数；不按size推定文件已保存",
    "receipt_id": "完整收件UUID；每个下载/提交版本保留一行，不按文件哈希去重删除",
    "material_id": "服务器发布材料UUID，关联classroom_materials.id，不是泛指第几课",
    "lesson_key": "该回执按其material_id关联的课次键；遇冲突保留原绑定并显式标记待核查",
    "material_title": "发布时保存的材料标题，仅供阅读，不能以标题推断或合并课次",
    "kind": "原始回执类型，如download/submission；下载记录不等于提交",
    "created_at": "服务器记录的收件/下载创建时间；不等于客户端事件发生时间或有效学习时长",
    "filename": "元信息保存的原始文件名；可能缺失或含身份文本，分享前需检查",
    "bytes": "服务器元信息中的原件字节数；0或非空大小本身不证明content存在",
    "sha256": "服务器保存文件的SHA-256摘要；同哈希仍保留各次收件证据",
    "has_original": "元信息查询content IS NOT NULL结果；是否确有原件，不代表含完整日志或代码正确",
    "original_path": "本次归档中唯一原件位置；未包含原件/没有原件时为空，不是公开下载链接",
    "record_class": "收件detail中保存的当时班级快照；缺失不使用当前班级代填",
    "record_group": "收件detail中保存的当时组别快照；缺失不使用当前组别代填",
    "directory_class": "原件目录采用的班级标签；优先记录快照，缺失时带当前班级_前缀",
    "class_binding_source": "record_snapshot为记录时快照；current_user_fallback_not_historical仅当前归类参考",
    "binding_sources": "材料配置与回执上下文中实际出现的课次字段路径及值，用于追溯冲突",
    "recorded_lesson_ids": "回执冻结上下文中明确出现的不同课次编号，不凭客户端时间补推",
    "material_lesson_ids": "材料多个明确课次字段的不同值列表；多值意味着材料绑定冲突",
    "download_id": "上传清单记录的原始下载回执UUID；可能缺失，不能凭时间推配",
    "task_validation_status": "上传时任务契约校验状态；matched不等于功能正确或学生掌握",
    "record_classes": "该用户本课全部回执中非空的历史班级快照集合，不等同当前班级",
    "record_groups": "该用户本课全部回执中非空的历史组别快照集合；保留改组情况",
    "submission_originals": "本课该学生submission类型且确有content的版本数，不只计最后一版",
    "submission_bytes": "本课该学生全部有原件提交版本的字节合计，重复内容仍各自计入",
    "submission_status": "received仅表示有提交回执；无记录不证明未参与或当时应参加本课",
    "item": "数据范围说明项的稳定名称，不是学生测量变量",
    "value": "该范围说明项的实际配置/状态；结合limitation解释",
    "limitation": "数据覆盖、归类与解释限制，分析时须保留",
}


def _dict(value):
    return value if isinstance(value, dict) else {}


def _id(value):
    return str(value) if value is not None else ""


def _value(value):
    return value.strip() if isinstance(value, str) else ""


def _component(value, fallback="未填写", limit=85):
    """Cross-platform component, including Windows/bidi/path traversal safety."""
    text = "".join(char for char in str(value or "")
                   if unicodedata.category(char) not in {"Cc", "Cf", "Cs"})
    text = re.sub(r'[<>:"/\\|?*]', "_", text).strip(" .")[:limit].rstrip(" .")
    if not text or text in {".", ".."}:
        text = fallback
    if text.split(".")[0].upper() in {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)),
                                        *(f"LPT{i}" for i in range(1, 10))}:
        text = "_" + text
    return text


def _time(value):
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value) if value is not None else ""


def _timestamp(value):
    # Name is only a readable label. The complete receipt UUID provides uniqueness.
    return _component(_time(value).replace(":", "-").replace("+", "_"), "时间未记录", 45)


def _bytes(row):
    value = row.get("size", row.get("bytes", 0))
    return value if type(value) is int and value >= 0 else 0


def _has_original(row):
    if "has_original" in row:
        return row["has_original"] is True
    return _bytes(row) > 0  # Compatibility only; callers should select content IS NOT NULL.


def _material_bindings(material):
    config = _dict(material.get("configuration"))
    sources = []
    for key in ("worksheet", "lesson_pack", "library"):
        value = _value(_dict(config.get(key)).get("lesson_id"))
        if value:
            sources.append((f"configuration.{key}.lesson_id", value))
    value = _value(config.get("lesson_id"))
    if value:
        sources.append(("configuration.lesson_id", value))
    return sources


def _receipt_bindings(receipt):
    detail = _dict(receipt.get("detail"))
    sources = []
    contract = _dict(detail.get("task_contract"))
    context = _dict(contract.get("learning_context"))
    value = _value(context.get("lesson_id"))
    if value:
        sources.append(("detail.task_contract.learning_context.lesson_id", value))
    worksheet = _dict(detail.get("worksheet_context"))
    # Download context and uploaded-context comparisons retain their full raw values elsewhere.
    for key, context in (("worksheet_context", worksheet),
                         ("worksheet_context.download_context", _dict(worksheet.get("download_context")))):
        value = _value(context.get("lesson_id"))
        if value:
            sources.append((f"detail.{key}.lesson_id", value))
    return sources


def _lesson_label(material, lesson_id, project_id, material_id):
    config = _dict(material.get("configuration"))
    title = (_value(_dict(config.get("worksheet")).get("title"))
             or _value(_dict(config.get("library")).get("title"))
             or _value(material.get("title")) or project_id)
    title = title[:70]
    match = re.fullmatch(r"C([0-9]{2})", lesson_id)
    if match:
        title = re.sub(r"^第\s*[0-9]+\s*课\s*[·：:—-]?\s*", "", title)
        label = f"第{int(match.group(1))}课" + (f" · {title}" if title else f" · {lesson_id}")
    else:
        label = lesson_id + (f" · {title}" if title and title != lesson_id else "")
    return label if project_id else f"{label} · 独立任务 {material_id[:8]}"


class ArchiveLayout:
    """Build joinable indexes without dropping unknown bindings or submission versions.

    ``users``, ``materials`` and ``receipts`` are lists of metadata dictionaries.
    ``has_original`` should be SQL ``content IS NOT NULL``, never the content itself.
    A lesson filter limits materials/receipts only; platform tables stay common context.
    """

    def __init__(self, users, materials, receipts, include_identity=False, lesson_key=None):
        self.include_identity = include_identity
        self.users = {_id(row.get("id")): row for row in users
                      if row.get("role", "learner") in LEARNER_ROLES and row.get("id") is not None}
        self.materials = {_id(row.get("id")): row for row in materials if row.get("id") is not None}
        self.receipts = {_id(row.get("id")): row for row in receipts if row.get("id") is not None}
        self._bindings = {}
        self._lessons = {}
        for mid, material in self.materials.items():
            sources = _material_bindings(material)
            values = sorted({value for _, value in sources})
            project = _value(_dict(material.get("configuration")).get("project_id"))
            if len(values) == 1:
                lesson = values[0]
                # Without project_id, preserve an independent material instead of guessing
                # whether equal course labels across unrelated projects describe one lesson.
                key = f"lesson:{quote(project, safe='')}:{quote(lesson, safe='')}" if project else f"material:{mid}"
                status = "explicit" if project else "explicit_lesson_project_unknown"
                label = _lesson_label(material, lesson, project, mid)
            else:
                lesson = ""
                key = f"material:{mid}"
                status = "conflicting_material_binding" if values else "lesson_not_recorded"
                label = f"{'待核对' if values else '独立任务'} · {(material.get('title') or '')[:70]} · {mid[:8]}"
            self._bindings[mid] = {"key": key, "lesson_id": lesson, "project_id": project,
                                   "binding_status": status, "sources": sources, "values": values}
            self._lessons.setdefault(key, {"key": key, "label": label, "project_id": project,
                "lesson_id": lesson, "binding_status": status, "material_ids": []})["material_ids"].append(mid)
        # Orphan receipts are still indexed and get an explicit independent task.
        for receipt in self.receipts.values():
            mid = _id(receipt.get("material_id"))
            if mid not in self._bindings:
                key = f"material:{mid}"
                self._bindings[mid] = {"key": key, "lesson_id": "", "project_id": "",
                    "binding_status": "material_missing", "sources": [], "values": []}
                self._lessons.setdefault(key, {"key": key, "label": f"材料缺失 · {mid[:8]}", "project_id": "",
                    "lesson_id": "", "binding_status": "material_missing", "material_ids": [mid]})
        if lesson_key is not None and lesson_key not in self._lessons:
            raise ValueError("未知课次，请重新选择导出范围")
        self.lesson_key = lesson_key
        mids = self.material_ids
        self.selected_materials = {mid: row for mid, row in self.materials.items() if mid in mids}
        self.selected_receipts = {rid: row for rid, row in self.receipts.items()
                                  if _id(row.get("material_id")) in mids}

    def material_ids_for(self, lesson_key=None):
        key = lesson_key if lesson_key is not None else getattr(self, "lesson_key", None)
        if key is not None:
            if key not in self._lessons:
                raise ValueError("未知课次，请重新选择导出范围")
            return set(self._lessons[key]["material_ids"])
        return set(self._bindings)

    @property
    def material_ids(self):
        return self.material_ids_for()

    @property
    def lessons(self):
        summaries = []
        for key, lesson in sorted(self._lessons.items()):
            rows = [row for row in self.receipts.values() if self._bindings[_id(row.get("material_id"))]["key"] == key]
            submissions = [row for row in rows if row.get("kind") == "submission"]
            originals = [row for row in rows if _has_original(row)]
            originals += [self.materials[mid] for mid in lesson["material_ids"]
                          if mid in self.materials and _has_original(self.materials[mid])]
            summaries.append({**lesson, "material_ids": sorted(lesson["material_ids"]),
                "materials": len(lesson["material_ids"]), "submissions": len(submissions),
                "students": len({_id(row.get("user_id")) for row in rows if row.get("user_id") is not None}),
                "original_bytes": sum(_bytes(row) for row in originals)})
        return summaries

    def _class_binding(self, user_id, receipt=None):
        user = self.users.get(_id(user_id), {})
        detail = _dict((receipt or {}).get("detail"))
        record_class = detail.get("class_name", detail.get("class_snapshot"))
        record_group = detail.get("group", detail.get("group_snapshot"))
        if _value(record_class) or _value(record_group):
            directory = GROUP_LABELS.get(record_group) or _value(record_class) or "未明确分组"
            source = "record_snapshot"
        else:
            directory = "当前班级_" + (GROUP_LABELS.get(user.get("experiment_group"))
                or _value(user.get("class_name")) or "未明确分组")
            source = "current_user_fallback_not_historical"
        return {"current_class": user.get("class_name"), "current_group": user.get("experiment_group"),
                "record_class": record_class, "record_group": record_group,
                "directory_class": directory, "class_binding_source": source}

    def _student_component(self, user_id):
        uid = _id(user_id)
        component = "S-" + _component(uid, "用户未记录", 80)
        if self.include_identity:
            user = self.users.get(uid, {})
            identity = "_".join(_value(user.get(key)) for key in ("student_id", "name") if _value(user.get(key)))
            if identity:
                component += "_" + _component(identity, limit=70)
        return component

    def student_path(self, user_id):
        if _id(user_id) not in self.users:
            return None
        binding = self._class_binding(user_id)
        return f"{_component(binding['directory_class'])}/{self._student_component(user_id)}"

    def _lesson_folder(self, mid):
        binding = self._bindings[mid]
        if binding["key"].startswith("lesson:"):
            # Sanitization/truncation must not merge otherwise distinct course folders.
            label = binding["lesson_id"] + "_" + binding["project_id"]
            safe = _component(label, limit=65)
            if safe != label:
                safe += "_" + hashlib.sha256(binding["key"].encode()).hexdigest()[:12]
            return safe
        prefix = "待核对任务" if binding["binding_status"] == "conflicting_material_binding" else "独立任务"
        return prefix + "_" + _component(mid)

    def original_path(self, table, source_id):
        sid = _id(source_id)
        if table == "classroom_material_receipts":
            row = self.selected_receipts.get(sid)
            if not row or not _has_original(row):
                return None
            mid = _id(row.get("material_id"))
            binding = self._class_binding(row.get("user_id"), row)
            filename = row.get("filename") or _dict(row.get("detail")).get("filename") or "submission.zip"
            extension = PurePosixPath(str(filename).replace("\\", "/")).suffix.lower()
            if not re.fullmatch(r"\.[a-z0-9]{1,12}", extension):
                extension = ".zip"
            return (f"课次/{self._lesson_folder(mid)}/{_component(binding['directory_class'])}/"
                    f"{self._student_component(row.get('user_id'))}/"
                    f"{'提交' if row.get('kind') == 'submission' else '原件'}_{_timestamp(row.get('created_at'))}_{_component(sid)}{extension}")
        if table == "classroom_materials":
            row = self.selected_materials.get(sid)
            if not row or not _has_original(row):
                return None
            filename = _component(row.get("filename"), "材料.bin", 100)
            return f"课次/{self._lesson_folder(sid)}/教师材料/{_component(sid)}_{filename}"
        return None

    def _receipt_index(self, rid, row):
        mid = _id(row.get("material_id"))
        binding = self._bindings[mid]
        recorded = _receipt_bindings(row)
        values = sorted({value for _, value in recorded})
        status = binding["binding_status"]
        if len(values) > 1 or (values and binding["values"] and set(values) != set(binding["values"])):
            status = "conflicting_receipt_binding"
        elif values and not binding["values"]:
            status = "receipt_only_binding_needs_review"
        detail = _dict(row.get("detail"))
        return {"receipt_id": rid, "user_id": _id(row.get("user_id")),
            "research_id": "S-" + _id(row.get("user_id")), "material_id": mid,
            "lesson_key": binding["key"], "lesson_id": binding["lesson_id"], "project_id": binding["project_id"],
            "material_title": self.materials.get(mid, {}).get("title"), "kind": row.get("kind"),
            "created_at": _time(row.get("created_at")), "filename": row.get("filename") or detail.get("filename"),
            "bytes": _bytes(row), "sha256": row.get("sha256"), "has_original": _has_original(row),
            "original_path": self.original_path("classroom_material_receipts", rid),
            **self._class_binding(row.get("user_id"), row), "binding_status": status,
            "binding_sources": dict(binding["sources"] + recorded), "recorded_lesson_ids": values,
            "material_lesson_ids": binding["values"], "download_id": _dict(detail.get("client_manifest")).get("download_id"),
            "task_validation_status": _dict(detail.get("task_validation")).get("status")}

    def index_tables(self):
        receipt_rows = [self._receipt_index(rid, row) for rid, row in sorted(self.selected_receipts.items())]
        selected_lessons = [lesson for lesson in self.lessons if self.lesson_key is None or lesson["key"] == self.lesson_key]
        by_user = defaultdict(list)
        by_lesson_user = defaultdict(list)
        for row in receipt_rows:
            by_user[row["user_id"]].append(row)
            by_lesson_user[(row["lesson_key"], row["user_id"])].append(row)
        student_rows, lesson_student_rows = [], []
        for uid, user in sorted(self.users.items()):
            rows = by_user[uid]
            counts = Counter(row["kind"] for row in rows)
            student_rows.append({"user_id": uid, "research_id": "S-" + uid,
                "student_id": user.get("student_id") if self.include_identity else None,
                "name": user.get("name") if self.include_identity else None,
                "current_class": user.get("class_name"), "current_group": user.get("experiment_group"),
                "school_class": user.get("school_class"), "is_active": user.get("is_active"),
                "student_path": self.student_path(uid), "downloads": counts["download"],
                "submissions": counts["submission"], "originals": sum(row["has_original"] for row in rows)})
            for lesson in selected_lessons:
                rows = by_lesson_user[(lesson["key"], uid)]
                counts = Counter(row["kind"] for row in rows)
                submissions = [row for row in rows if row["kind"] == "submission"]
                lesson_student_rows.append({"lesson_key": lesson["key"], "lesson_id": lesson["lesson_id"],
                    "user_id": uid, "research_id": "S-" + uid, "current_class": user.get("class_name"),
                    "current_group": user.get("experiment_group"),
                    "record_classes": sorted({row["record_class"] for row in rows if row["record_class"]}),
                    "record_groups": sorted({row["record_group"] for row in rows if row["record_group"]}),
                    "downloads": counts["download"], "submissions": counts["submission"],
                    "originals": sum(row["has_original"] for row in rows),
                    "submission_originals": sum(row["has_original"] for row in submissions),
                    "submission_bytes": sum(row["bytes"] for row in submissions if row["has_original"]),
                    "submission_status": "received" if submissions else "no_record_not_proof_of_nonparticipation"})
        tables = {"索引/课次.csv": selected_lessons, "索引/学生.csv": student_rows,
                "索引/提交版本.csv": receipt_rows, "索引/课次学生.csv": lesson_student_rows,
                "索引/数据范围.csv": [
                    {"item": "selected_lesson_key", "value": self.lesson_key,
                     "limitation": "课次仅筛选材料、收件原件与对应SFLS索引；平台原始表是跨课公共上下文。"},
                    {"item": "class_binding", "value": "record_snapshot_or_explicit_current_fallback",
                     "limitation": "原件目录优先收件时班级/组别快照，缺失时标当前班级；不反推历史改组。"},
                    {"item": "coverage", "value": "server_saved_records_only",
                     "limitation": "保留服务器已存所有提交版本；未上传的本机文件无法补回，下载回执不代表保存了下载ZIP原件。"},
                    {"item": "lesson_student_roster", "value": "all_selected_current_students_per_selected_lesson",
                     "limitation": "逐课学生表保留当前导出范围全部学生；0条收件只表示未记录，不证明当时应参加该课。"},
                ]}
        return [(name.removesuffix(".csv"), INDEX_FIELDS[name], rows) for name, rows in tables.items()]
