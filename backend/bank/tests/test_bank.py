"""题库模块测试：模型、导入命令、学员接口。"""

import json
import tempfile
from pathlib import Path

from django.test import TestCase
from django.urls import reverse

from bank.models import BankQuestion, Subject


SAMPLE = [
    {
        "id": "m1",
        "category": "高数一",
        "chapter": "第一章 函数",
        "section": "第一节 函数",
        "type": "single",
        "difficulty": "medium",
        "content": "函数 f(x)=x 的定义域是？",
        "options": ["R", "空集", "[0,1]", "(-1,1)"],
        "answer": "A",
        "explanation": "全体实数。",
        "source": "2025 智博二模 高数一 第1题",
    },
    {
        "id": "m2",
        "category": "高数一",
        "chapter": "第一章 函数",
        "section": "第二节 极限",
        "type": "fill",
        "difficulty": "easy",
        "content": "lim x->0 sinx/x = ____",
        "options": [],
        "answer": "1",
        "explanation": "重要极限。",
        "source": "2025 智博二模 高数一 第2题",
    },
    {
        "id": "c1",
        "category": "计算机",
        "chapter": "第一章 信息",
        "section": "",
        "type": "judge",
        "difficulty": "medium",
        "content": "数据是信息的表现形式。",
        "options": ["正确", "错误"],
        "answer": "A",
        "explanation": "正确。",
        "source": "",
    },
    {
        "id": "bad-no-answer",
        "category": "高数一",
        "chapter": "第一章 函数",
        "section": "第一节 函数",
        "type": "single",
        "content": "没有答案的题",
        "options": ["A", "B"],
        "answer": "",
        "explanation": "",
        "source": "",
    },
    {
        "id": "bad-category",
        "category": "未知科目",
        "chapter": "",
        "section": "",
        "type": "single",
        "content": "科目不在白名单",
        "options": ["A", "B"],
        "answer": "A",
        "explanation": "",
        "source": "",
    },
]


class ImportCommandTests(TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(
            "w", suffix=".json", delete=False, encoding="utf-8"
        )
        json.dump(SAMPLE, self.tmp, ensure_ascii=False)
        self.tmp.close()
        self.path = Path(self.tmp.name)

    def tearDown(self):
        self.path.unlink(missing_ok=True)

    def run_import(self, *args):
        from django.core.management import call_command
        from io import StringIO

        out = StringIO()
        call_command("import_bank", "--source", str(self.path), *args, stdout=out)
        return out.getvalue()

    def test_dry_run_writes_nothing(self):
        output = self.run_import("--dry-run")
        self.assertIn("dry-run", output)
        self.assertEqual(BankQuestion.objects.count(), 0)

    def test_import_keeps_valid_rows_only(self):
        self.run_import()
        self.assertEqual(BankQuestion.objects.count(), 3)
        self.assertNotIn("bad-no-answer", BankQuestion.objects.values_list("id", flat=True))
        self.assertNotIn("bad-category", BankQuestion.objects.values_list("id", flat=True))

    def test_render_kind_mapping(self):
        self.run_import()
        self.assertEqual(BankQuestion.objects.get(pk="m1").render_kind, "choice")
        self.assertEqual(BankQuestion.objects.get(pk="m2").render_kind, "fill")
        self.assertEqual(BankQuestion.objects.get(pk="c1").render_kind, "choice")

    def test_answer_normalised_to_list(self):
        self.run_import()
        self.assertEqual(BankQuestion.objects.get(pk="m1").answer, ["A"])
        self.assertEqual(BankQuestion.objects.get(pk="m2").answer, ["1"])

    def test_subject_counter_and_order(self):
        self.run_import()
        self.assertEqual(Subject.objects.get(pk="math1").question_count, 2)
        self.assertEqual(Subject.objects.get(pk="computer").question_count, 1)
        self.assertEqual(Subject.objects.get(pk="math1").sort_order, 1)
        self.assertEqual(Subject.objects.get(pk="computer").sort_order, 4)

    def test_idempotent_import(self):
        self.run_import()
        first = BankQuestion.objects.count()
        self.run_import()
        self.assertEqual(BankQuestion.objects.count(), first)

    def test_reset_clears_then_reimports(self):
        self.run_import()
        self.run_import("--reset")
        self.assertEqual(BankQuestion.objects.count(), 3)

    def test_per_subject_limit(self):
        self.run_import("--per-subject", "1")
        self.assertEqual(BankQuestion.objects.filter(subject_id="math1").count(), 1)


class SubjectApiTests(TestCase):
    def setUp(self):
        math = Subject.objects.create(id="math1", name="高数一", sort_order=1, question_count=2)
        Subject.objects.create(id="computer", name="计算机", sort_order=4, question_count=1)
        Subject.objects.create(id="off", name="停用科目", sort_order=9, is_active=False)
        BankQuestion.objects.create(
            id="m1", subject=math, chapter="第一章 函数", section="第一节 函数",
            type="single", render_kind="choice", stem="定义域？",
            options=["R", "空集"], answer=["A"], source_label="智博二模",
        )
        BankQuestion.objects.create(
            id="m2", subject=math, chapter="第一章 函数", section="第二节 极限",
            type="fill", render_kind="fill", stem="sinx/x 极限？",
            options=[], answer=["1"], source_label="师大三模",
        )

    def test_subject_list_excludes_inactive(self):
        response = self.client.get("/api/student/v1/bank/subjects/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["count"], 2)
        self.assertEqual([item["id"] for item in payload["results"]], ["math1", "computer"])

    def test_chapter_tree_groups_by_chapter(self):
        response = self.client.get("/api/student/v1/bank/subjects/math1/chapters/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["count"], 1)
        chapter = payload["results"][0]
        self.assertEqual(chapter["title"], "第一章 函数")
        self.assertEqual(chapter["count"], 2)
        self.assertEqual(len(chapter["sections"]), 2)

    def test_chapter_tree_404_for_unknown_subject(self):
        response = self.client.get("/api/student/v1/bank/subjects/nope/chapters/")
        self.assertEqual(response.status_code, 404)

    def test_source_list(self):
        response = self.client.get("/api/student/v1/bank/subjects/math1/sources/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["count"], 2)
        names = {item["name"] for item in payload["results"]}
        self.assertEqual(names, {"智博二模", "师大三模"})


class QuestionApiTests(TestCase):
    def setUp(self):
        math = Subject.objects.create(id="math1", name="高数一", question_count=3)
        for index in range(3):
            BankQuestion.objects.create(
                id="m%d" % index, subject=math,
                chapter="第一章" if index < 2 else "第二章",
                section="第一节" if index == 0 else "第二节",
                type="single" if index != 1 else "fill",
                render_kind="choice" if index != 1 else "fill",
                stem="题目 %d" % index, options=["A", "B"], answer=["A"],
                source_label="卷A" if index < 2 else "卷B", sort_order=index,
            )

    def test_default_limit_is_one(self):
        payload = self.client.get("/api/student/v1/bank/questions/?subject=math1").json()
        self.assertEqual(payload["count"], 3)
        self.assertEqual(len(payload["results"]), 1)

    def test_filter_by_chapter(self):
        payload = self.client.get("/api/student/v1/bank/questions/?subject=math1&chapter=第一章").json()
        self.assertEqual(payload["count"], 2)

    def test_filter_by_section(self):
        payload = self.client.get("/api/student/v1/bank/questions/?subject=math1&section=第一节").json()
        self.assertEqual(payload["count"], 1)

    def test_filter_by_type(self):
        payload = self.client.get("/api/student/v1/bank/questions/?subject=math1&type=fill").json()
        self.assertEqual(payload["count"], 1)

    def test_filter_by_kind(self):
        payload = self.client.get("/api/student/v1/bank/questions/?subject=math1&kind=choice").json()
        self.assertEqual(payload["count"], 2)

    def test_filter_by_source(self):
        payload = self.client.get("/api/student/v1/bank/questions/?subject=math1&source=卷B").json()
        self.assertEqual(payload["count"], 1)

    def test_offset_paging(self):
        first = self.client.get("/api/student/v1/bank/questions/?subject=math1&limit=2&offset=0").json()
        second = self.client.get("/api/student/v1/bank/questions/?subject=math1&limit=2&offset=2").json()
        self.assertEqual(len(first["results"]), 2)
        self.assertEqual(len(second["results"]), 1)
        self.assertNotEqual(first["results"][0]["id"], second["results"][0]["id"])

    def test_limit_is_clamped(self):
        payload = self.client.get("/api/student/v1/bank/questions/?subject=math1&limit=999").json()
        self.assertLessEqual(len(payload["results"]), 50)

    def test_invalid_limit_falls_back(self):
        payload = self.client.get("/api/student/v1/bank/questions/?subject=math1&limit=abc").json()
        self.assertEqual(len(payload["results"]), 1)

    def test_random_returns_valid_rows(self):
        payload = self.client.get("/api/student/v1/bank/questions/?subject=math1&random=1&limit=3").json()
        self.assertEqual(len(payload["results"]), 3)
        self.assertEqual(payload["count"], 3)

    def test_payload_shape(self):
        payload = self.client.get("/api/student/v1/bank/questions/?subject=math1&limit=1").json()
        question = payload["results"][0]
        for key in ("id", "subjectId", "chapter", "section", "type", "renderKind",
                    "stem", "options", "answer", "explanation", "difficulty", "source"):
            self.assertIn(key, question)

    def test_unknown_subject_returns_empty(self):
        payload = self.client.get("/api/student/v1/bank/questions/?subject=nope").json()
        self.assertEqual(payload["count"], 0)
        self.assertEqual(payload["results"], [])
