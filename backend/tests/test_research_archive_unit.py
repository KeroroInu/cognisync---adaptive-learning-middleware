"""Pure metadata tests; do not require PostgreSQL or execute student files."""
from copy import deepcopy
from pathlib import PurePosixPath
import unittest
from uuid import UUID

from app.services.research_archive import ArchiveLayout, INDEX_FIELDS, INDEX_FIELD_DESCRIPTIONS


def uid(number):
    return str(UUID(int=number))


def indexes(layout):
    return {name + ".csv": rows for name, _fields, rows in layout.index_tables()}


class ArchiveLayoutTests(unittest.TestCase):
    def setUp(self):
        self.users = [{"id": uid(1), "role": "learner", "name": "甲同学", "student_id": "G2026001",
                       "class_name": "解构班", "experiment_group": "pdt", "is_active": True},
                      {"id": uid(2), "role": "learner", "name": "乙", "class_name": "开发班", "experiment_group": "ai_pbl"},
                      {"id": uid(3), "role": "admin", "name": "不计入学生"}]
        self.materials = [{"id": uid(10), "title": "同名任务", "configuration": {"project_id": "snake", "worksheet": {"lesson_id": "C01"}}, "has_original": False},
                          {"id": uid(11), "title": "同名任务", "configuration": {"project_id": "snake", "lesson_id": "C01"}, "has_original": False},
                          {"id": uid(12), "title": "第2课（不能按标题猜测）", "configuration": {"project_id": "snake"}, "has_original": False}]
        self.receipts = [{"id": uid(20), "user_id": uid(1), "material_id": uid(10), "kind": "download", "size": 100,
                          "has_original": False, "detail": {"class_name": "解构班", "group": "pdt"}},
                         {"id": uid(21), "user_id": uid(1), "material_id": uid(10), "kind": "submission", "size": 101,
                          "sha256": "same-hash", "created_at": "2026-10-23T10:00:00+08:00", "has_original": True,
                          "detail": {"class_name": "旧开发班", "group": "ai_pbl"}},
                         {"id": uid(22), "user_id": uid(1), "material_id": uid(10), "kind": "submission", "size": 101,
                          "sha256": "same-hash", "created_at": "2026-10-23T10:00:00+08:00", "has_original": True, "detail": {}}]

    def layout(self, **options):
        return ArchiveLayout(self.users, self.materials, self.receipts, **options)

    def test_two_groups_merge_only_explicit_same_project_and_lesson_and_never_deduplicate_versions(self):
        layout = self.layout()
        self.assertEqual(layout.material_ids_for("lesson:snake:C01"), {uid(10), uid(11)})
        lesson = next(row for row in layout.lessons if row["key"] == "lesson:snake:C01")
        self.assertEqual((lesson["materials"], lesson["submissions"], lesson["original_bytes"]), (2, 2, 202))
        self.assertNotEqual(layout.original_path("classroom_material_receipts", uid(21)),
                            layout.original_path("classroom_material_receipts", uid(22)))
        self.assertIn(uid(21), layout.original_path("classroom_material_receipts", uid(21)))

    def test_record_snapshot_and_current_fallback_remain_distinct(self):
        layout = self.layout()
        rows = {row["receipt_id"]: row for row in indexes(layout)["索引/提交版本.csv"]}
        row = rows[uid(21)]
        self.assertEqual(row["record_group"], "ai_pbl")
        self.assertEqual(row["current_group"], "pdt")
        self.assertIn("/开发班/", row["original_path"])
        self.assertEqual(row["class_binding_source"], "record_snapshot")
        self.assertIn("/当前班级_解构班/", rows[uid(22)]["original_path"])
        self.assertEqual(rows[uid(22)]["class_binding_source"], "current_user_fallback_not_historical")

    def test_all_roster_and_zero_submissions_are_present_and_teacher_excluded(self):
        tables = indexes(self.layout())
        students = {row["user_id"]: row for row in tables["索引/学生.csv"]}
        self.assertEqual(set(students), {uid(1), uid(2)})
        self.assertEqual(students[uid(2)]["submissions"], 0)
        self.assertIsNone(students[uid(1)]["name"])
        self.assertIsNone(students[uid(1)]["student_id"])
        lessons = [row for row in tables["索引/课次学生.csv"] if row["user_id"] == uid(2)]
        self.assertEqual(len(lessons), 2)
        self.assertTrue(all(row["submissions"] == 0 for row in lessons))

    def test_has_original_not_download_size_decides_original_and_no_double_paths(self):
        layout = self.layout()
        self.assertIsNone(layout.original_path("classroom_material_receipts", uid(20)))
        self.assertIsNone(layout.original_path("classroom_material_receipts", uid(999)))
        self.assertIsNone(layout.original_path("unknown_table", uid(21)))
        self.assertIsNone(layout.original_path("classroom_materials", uid(10)))

    def test_conflicting_material_or_receipt_bindings_are_not_silently_assigned(self):
        self.materials[0]["configuration"]["library"] = {"lesson_id": "C02"}
        self.receipts[2]["detail"] = {"task_contract": {"learning_context": {"lesson_id": "C03"}}}
        layout = self.layout()
        rows = {row["receipt_id"]: row for row in indexes(layout)["索引/提交版本.csv"]}
        self.assertEqual(rows[uid(21)]["lesson_key"], f"material:{uid(10)}")
        self.assertEqual(rows[uid(21)]["binding_status"], "conflicting_material_binding")
        self.assertEqual(rows[uid(22)]["binding_status"], "conflicting_receipt_binding")
        self.assertEqual(rows[uid(22)]["material_lesson_ids"], ["C01", "C02"])
        self.assertEqual(rows[uid(22)]["recorded_lesson_ids"], ["C03"])

    def test_receipt_snapshot_conflict_includes_nested_download_context(self):
        self.receipts[1]["detail"]["worksheet_context"] = {"download_context": {"lesson_id": "C09"}}
        row = next(row for row in indexes(self.layout())["索引/提交版本.csv"] if row["receipt_id"] == uid(21))
        self.assertEqual(row["binding_status"], "conflicting_receipt_binding")
        self.assertIn("detail.worksheet_context.download_context.lesson_id", row["binding_sources"])

    def test_lesson_filter_only_metadata_and_unknown_filter_rejected(self):
        layout = self.layout(lesson_key="lesson:snake:C01")
        self.assertEqual(set(layout.selected_materials), {uid(10), uid(11)})
        self.assertEqual(len(layout.selected_receipts), 3)
        self.assertEqual(len(indexes(layout)["索引/课次.csv"]), 1)
        self.assertEqual(len(indexes(layout)["索引/学生.csv"]), 2)
        with self.assertRaises(ValueError):
            self.layout(lesson_key="C01")
        with self.assertRaises(ValueError):
            layout.material_ids_for("not-real")

    def test_unbound_task_never_infers_lesson_from_title_or_date(self):
        row = next(row for row in self.layout().lessons if row["key"] == f"material:{uid(12)}")
        self.assertEqual(row["lesson_id"], "")
        self.assertEqual(row["binding_status"], "lesson_not_recorded")

    def test_identity_is_opt_in_and_path_components_cannot_escape_or_collide(self):
        self.users[0].update(name="../../甲\\乙\x00\u202e", student_id="G20/001")
        layout = self.layout(include_identity=True)
        path = layout.student_path(uid(1))
        self.assertIn("G20_001", path)
        self.assertIn("S-" + uid(1), path)
        self.assertNotIn("..", PurePosixPath(path).parts)
        self.assertNotIn("\x00", path)
        self.assertNotIn("\u202e", path)
        plain = self.layout().student_path(uid(1))
        self.assertNotIn("G20", plain)

    def test_orphan_receipt_and_teacher_material_original_are_preserved(self):
        self.materials[0].update(has_original=True, filename="../../材料.zip", size=99)
        self.receipts.append({"id": uid(23), "user_id": uid(1), "material_id": uid(99), "kind": "submission",
                              "has_original": True, "detail": {}})
        layout = self.layout()
        row = next(row for row in indexes(layout)["索引/提交版本.csv"] if row["receipt_id"] == uid(23))
        self.assertEqual(row["binding_status"], "material_missing")
        self.assertTrue(row["original_path"].endswith(uid(23) + ".zip"))
        self.assertIn("/教师材料/", layout.original_path("classroom_materials", uid(10)))
        self.assertNotIn("..", PurePosixPath(layout.original_path("classroom_materials", uid(10))).parts)

    def test_input_metadata_is_never_modified_and_empty_tables_have_schema(self):
        originals = deepcopy((self.users, self.materials, self.receipts))
        layout = self.layout()
        layout.index_tables()
        self.assertEqual(originals, (self.users, self.materials, self.receipts))
        empty = indexes(ArchiveLayout([], [], []))
        self.assertEqual(set(empty), set(INDEX_FIELDS))
        self.assertTrue(all(fields for fields in INDEX_FIELDS.values()))
        self.assertTrue(all(INDEX_FIELD_DESCRIPTIONS.get(field) for fields in INDEX_FIELDS.values() for field in fields))
        self.assertEqual(empty["索引/学生.csv"], [])

    def test_student_path_excludes_teachers_and_unknown_users(self):
        layout = self.layout()
        self.assertIsNone(layout.student_path(uid(3)))
        self.assertIsNone(layout.student_path(uid(999)))
        self.assertIsNotNone(layout.student_path(uid(1)))

    def test_sanitized_course_labels_do_not_merge_distinct_project_folders(self):
        self.materials[0]["configuration"]["project_id"] = "snake/a"
        self.materials[1]["configuration"]["project_id"] = "snake_a"
        self.receipts[2]["material_id"] = uid(11)
        layout = self.layout()
        first = layout.original_path("classroom_material_receipts", uid(21))
        second = layout.original_path("classroom_material_receipts", uid(22))
        self.assertNotEqual(PurePosixPath(first).parts[1], PurePosixPath(second).parts[1])

    def test_human_label_uses_frozen_title_but_never_remaps_legacy_lesson_number(self):
        self.materials[0]["configuration"]["worksheet"]["title"] = "AI会写代码以后"
        self.materials[1]["configuration"]["lesson_id"] = "L03"
        labels = {row["key"]: row["label"] for row in self.layout().lessons}
        self.assertEqual(labels["lesson:snake:C01"], "第1课 · AI会写代码以后")
        self.assertTrue(labels["lesson:snake:L03"].startswith("L03 ·"))
        self.assertNotIn("第3课", labels["lesson:snake:L03"])


if __name__ == "__main__":
    unittest.main()
