"""题库导入后的链路检查。只读本地库和本地接口，不访问任何外部站点。

用法：先启动后端，再运行
    python scripts/check_bank.py
"""

import json
import os
import re
import sys
import urllib.request
from pathlib import Path

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
django.setup()

from bank.models import RENDER_KIND_BY_TYPE, BankQuestion, Subject

BASE = "http://127.0.0.1:8000"
MEDIA = Path(__file__).resolve().parents[1] / ".local" / "media" / "questions"
IMAGE_REF = re.compile(r"!\[[^\]]*\]\((/media/questions/[^)]+)\)")

failures = []


def check(name, ok, detail=""):
    print(("  OK  " if ok else "  FAIL") + "  " + name + (("  " + detail) if detail else ""))
    if not ok:
        failures.append(name)


def main():
    print("=== 1. 数据库 ===")
    total = BankQuestion.objects.count()
    check("题量与源表一致", total == 13585, str(total))

    kinds = {}
    for question in BankQuestion.objects.all().only("type", "render_kind", "stem", "options", "answer"):
        kinds[question.render_kind] = kinds.get(question.render_kind, 0) + 1
    check("三种渲染形态都有题", set(kinds) == {"choice", "fill", "subjective"}, str(kinds))

    unmapped = BankQuestion.objects.exclude(type__in=RENDER_KIND_BY_TYPE.keys()).count()
    check("题型全部有渲染映射", unmapped == 0, "未映射 " + str(unmapped))

    broken = 0
    referenced = set()
    for question in BankQuestion.objects.all().only("stem", "explanation", "render_kind", "options", "answer"):
        for field in (question.stem, question.explanation):
            for match in IMAGE_REF.finditer(field or ""):
                referenced.add(match.group(1))
                if not (MEDIA.parent.parent / match.group(1).lstrip("/")).exists() and \
                   not (MEDIA / match.group(1).split("/media/questions/", 1)[-1]).exists():
                    broken += 1
        if question.render_kind == "choice" and (not question.options or not question.answer):
            broken += 1
    check("选择题都有选项和答案", broken == 0, "异常 " + str(broken))

    missing_files = [
        path for path in referenced
        if not (MEDIA / path.split("/media/questions/", 1)[-1]).exists()
    ]
    check("题干引用的图片文件都在", not missing_files, "缺失 " + str(len(missing_files)))

    print("=== 2. 接口 ===")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def fetch(path):
        return opener.open(BASE + path, timeout=30)

    subjects = json.loads(fetch("/api/student/v1/bank/subjects/").read())
    summed = sum(item["questionCount"] for item in subjects["results"])
    check("科目题量合计等于库内题数", summed == total, str(summed))

    sample = json.loads(fetch("/api/student/v1/bank/questions/?subject=chinese&type=fill&limit=1").read())
    fill = (sample.get("results") or [None])[0]
    check("填空题能按题型取到", bool(fill) and fill["renderKind"] == "fill")

    image_page = json.loads(fetch("/api/student/v1/bank/questions/?subject=computer&limit=200").read())
    image_url = ""
    for item in image_page.get("results") or []:
        found = IMAGE_REF.search(item.get("stem") or "")
        if found:
            image_url = found.group(1)
            break
    check("计算机题干含图片路径", bool(image_url))
    if image_url:
        response = fetch(image_url)
        body = response.read()
        check("图片文件可访问且是 PNG", response.status == 200 and body[:8] == b"\x89PNG\r\n\x1a\n",
              str(len(body)) + " 字节")

    print("=== 3. 前端判分逻辑 ===")
    page = (Path(__file__).resolve().parents[2] / "miniprogram" / "pages" / "bank" / "index.js").read_text(encoding="utf-8")
    for token in ("confirmMultiple", "submitText", "revealAnswer", "markSelf", "splitStem"):
        check("做题页包含 " + token, token in page)

    print()
    print("检查项", "全部通过" if not failures else ("失败 " + str(len(failures)) + " 项"))
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
