"""从题库 JSON 导入科目与题目。

题库源格式（pentest_json 适配）::

    [{"id": "...", "category": "高数一", "chapter": "...", "section": "...",
      "type": "single", "difficulty": "medium", "content": "题干",
      "options": ["选项一", "选项二"], "answer": "A", "explanation": "..."}]

换源时新增一个适配函数即可，模型不动。
"""

import json
import re
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from bank.models import RENDER_KIND_BY_TYPE, BankQuestion, Subject


# 科目顺序与首页六格一致；未列出的科目仍会入库，但不排进首页。
SUBJECT_ORDER = {
    "高数一": ("math1", 1),
    "高数二": ("math2", 2),
    "高数三": ("math3", 3),
    "计算机": ("computer", 4),
    "大学语文": ("chinese", 5),
    "英语": ("english", 6),
    "政治": ("politics", 7),
}
HOME_SUBJECTS = ("math1", "math2", "math3", "computer", "chinese", "english")


def normalize_answer(raw, options):
    """把各种答案写法统一成 list。"""
    if isinstance(raw, list):
        values = [str(item).strip() for item in raw if str(item).strip()]
    else:
        text = str(raw or "").strip()
        if not text:
            values = []
        elif re.fullmatch(r"[A-Za-z][\s,，、/]*", text):
            values = [char.upper() for char in text if char.isalpha()]
        elif re.fullmatch(r"[A-Za-z][,，、/][A-Za-z][A-Za-z,，、/]*", text):
            values = [part.strip().upper() for part in re.split(r"[,，、/]", text) if part.strip()]
        else:
            values = [text]
    # 选择题答案必须是选项范围内的字母
    if options and values and all(len(value) == 1 and value.isalpha() for value in values):
        limit = len(options)
        values = [value for value in values if ord(value) - ord("A") < limit]
    return values


def adapt_pentest(rows):
    """pentest_json 适配：字段名映射。"""
    for row in rows:
        options = [str(item) for item in (row.get("options") or []) if str(item).strip()]
        yield {
            "id": str(row.get("id") or "").strip(),
            "category": str(row.get("category") or "").strip(),
            "chapter": str(row.get("chapter") or "").strip(),
            "section": str(row.get("section") or "").strip(),
            "type": str(row.get("type") or "").strip(),
            "difficulty": str(row.get("difficulty") or "").strip(),
            "stem": str(row.get("content") or "").strip(),
            "options": options,
            "answer": normalize_answer(row.get("answer"), options),
            "explanation": str(row.get("explanation") or "").strip(),
            "source_label": str(row.get("source") or "").strip()[:200],
        }


class Command(BaseCommand):
    help = "从题库 JSON 导入科目与题目（默认每科 50 题，够跑通即可）。"

    def add_arguments(self, parser):
        parser.add_argument("--source", required=True, help="questions.json 路径")
        parser.add_argument("--per-subject", type=int, default=50, help="每科导入题数，0 表示不限")
        parser.add_argument("--reset", action="store_true", help="导入前清空 bank 应用数据")
        parser.add_argument("--dry-run", action="store_true", help="只统计不写库")

    def handle(self, *args, **options):
        source = Path(options["source"])
        if not source.exists():
            raise CommandError(f"题库文件不存在：{source}")
        rows = json.loads(source.read_text(encoding="utf-8"))
        if not isinstance(rows, list):
            raise CommandError("题库文件应为 JSON 数组。")

        per_subject = int(options["per_subject"])
        records = list(adapt_pentest(rows))

        skipped = {"no_id": 0, "no_stem": 0, "unknown_category": 0, "no_answer": 0}
        grouped = {}
        for record in records:
            if not record["id"]:
                skipped["no_id"] += 1
                continue
            if not record["stem"]:
                skipped["no_stem"] += 1
                continue
            if record["category"] not in SUBJECT_ORDER:
                skipped["unknown_category"] += 1
                continue
            # 选择题必须有答案才能判分；主观题和阅读题允许没有标准答案
            if not record["answer"] and RENDER_KIND_BY_TYPE.get(record["type"], "subjective") == "choice":
                skipped["no_answer"] += 1
                continue
            grouped.setdefault(record["category"], []).append(record)

        # 每科优先取选择题，保证首页弹层能直接渲染
        picked = {}
        for category, items in grouped.items():
            def rank(item):
                return 0 if RENDER_KIND_BY_TYPE.get(item["type"], "subjective") == "choice" else 1

            ordered = sorted(items, key=rank)
            picked[category] = ordered if per_subject <= 0 else ordered[:per_subject]

        total = sum(len(items) for items in picked.values())
        self.stdout.write(f"源题数 {len(records)}，命中 {total} 题，跳过 {skipped}")
        for category in SUBJECT_ORDER:
            if category in picked:
                self.stdout.write(f"  {category}: {len(picked[category])} 题")
        if options["dry_run"]:
            self.stdout.write(self.style.WARNING("dry-run，未写入数据库。"))
            return

        with transaction.atomic():
            if options["reset"]:
                BankQuestion.objects.all().delete()
                Subject.objects.all().delete()

            for category, (subject_id, order) in SUBJECT_ORDER.items():
                Subject.objects.update_or_create(
                    id=subject_id,
                    defaults={"name": category, "sort_order": order, "is_active": True},
                )

            created_total = 0
            for category, items in picked.items():
                subject_id = SUBJECT_ORDER[category][0]
                subject = Subject.objects.get(pk=subject_id)
                payload = []
                for index, item in enumerate(items, 1):
                    payload.append(
                        BankQuestion(
                            id=item["id"],
                            subject=subject,
                            chapter=item["chapter"][:120],
                            section=item["section"][:120],
                            type=item["type"][:32] or "single",
                            render_kind=RENDER_KIND_BY_TYPE.get(item["type"], "subjective"),
                            stem=item["stem"],
                            options=item["options"],
                            answer=item["answer"],
                            explanation=item["explanation"],
                            difficulty=item["difficulty"][:16],
                            source_label=item["source_label"],
                            is_published=True,
                            sort_order=index,
                        )
                    )
                BankQuestion.objects.bulk_create(payload, ignore_conflicts=True, batch_size=200)
                created_total += len(payload)
                Subject.objects.filter(pk=subject_id).update(question_count=len(payload))

        self.stdout.write(self.style.SUCCESS(f"导入完成：{created_total} 题，科目 {Subject.objects.count()} 个。"))
