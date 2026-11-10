"""把客户整理的题库 xlsx 转成 import_bank 能吃的 JSON。

第一批只导选择题（single / multiple / judge / choice），其余题型后续批次再处理。

用法：
    python scripts/xlsx_to_bank.py qbank2.xlsx images.zip out.json

输出 JSON 数组，字段与 backend/bank/management/commands/import_bank.py 的
adapt_pentest 一致。
"""

import json
import re
import sys
import zipfile
from pathlib import Path

import openpyxl

# 全部题型都导。选择题有标准选项，主观题答案是文字，阅读类答案可能为空。
CHOICE_TYPES = {"single", "multiple", "judge", "choice", "seven_choice", "cloze"}

# 难度统一成三档
DIFFICULTY_MAP = {"易": "简单", "简单": "简单", "中": "中等", "难": "困难"}

# 选项分隔符：题库里是 "A.xxx / B.xxx / C.xxx"
OPTION_SPLIT = re.compile(r"\s*/\s*")
OPTION_PREFIX = re.compile(r"^[A-Za-z]\s*[\.、．]\s*")

# 题干里的 Markdown 图片：![图注](/images/xxx.png)
IMAGE_REF = re.compile(r"!\[[^\]]*\]\((/images/[^)]+)\)")


def split_options(raw):
    """把 'A.xxx / B.xxx' 拆成 ['xxx', 'xxx']，去掉字母前缀。"""
    text = str(raw or "").strip()
    if not text or text.lower() == "none":
        return []
    parts = [part.strip() for part in OPTION_SPLIT.split(text) if part.strip()]
    return [OPTION_PREFIX.sub("", part).strip() for part in parts]


def build_source(row, idx):
    """机构 + 来源类型 + 批次 + 年份 拼成一个来源标签。"""
    parts = []
    year = str(row[idx["年份"]] or "").strip()
    if year and year.lower() != "none":
        parts.append(year)
    agency = str(row[idx["机构"]] or "").strip()
    if agency and agency not in ("无机构标注", "未标注", "None"):
        parts.append(agency)
    batch = str(row[idx["批次/卷次"]] or "").strip()
    if batch and batch.lower() != "none":
        parts.append(batch)
    kind = str(row[idx["来源类型"]] or "").strip()
    if kind and kind not in ("未标注", "None"):
        parts.append(kind)
    return " ".join(parts)[:200]


def rewrite_images(text):
    """把题干里的 /images/xxx 改写成后端媒体路径 /media/questions/xxx。"""
    def replacer(match):
        path = match.group(1)
        return f"![{match.group(0).split(']')[0][2:]}](/media/questions{path[len('/images'):]})"
    return IMAGE_REF.sub(replacer, text)


def convert(xlsx_path, zip_path, out_path):
    # 校验配图是否齐全
    archive = zipfile.ZipFile(zip_path)
    available = {name.replace("\\", "/") for name in archive.namelist()}
    archive.close()

    workbook = openpyxl.load_workbook(xlsx_path, data_only=True, read_only=True)
    sheet = workbook["全部题目"]
    rows = list(sheet.iter_rows(values_only=True))
    header = rows[0]
    idx = {name: i for i, name in enumerate(header) if name}
    workbook.close()

    records = []
    stats = {"choice": 0, "skipped_type": 0, "skipped_no_answer": 0, "skipped_no_stem": 0}
    missing_images = []

    for row in rows[1:]:
        qtype = str(row[idx["题型"]] or "").strip()
        if not qtype:
            stats["skipped_type"] += 1
            continue

        stem = str(row[idx["题干"]] or "").strip()
        if not stem:
            stats["skipped_no_stem"] += 1
            continue

        options = split_options(row[idx["选项"]])
        answer_raw = str(row[idx["答案"]] or "").strip()
        if answer_raw.lower() == "none":
            answer_raw = ""
        # 选择题没有答案就没法判分，跳过；主观题允许没有标准答案
        if qtype in {"single", "multiple", "judge", "choice"} and not answer_raw:
            stats["skipped_no_answer"] += 1
            continue

        # 检查题干里引用的图片是否都在压缩包里
        for match in IMAGE_REF.finditer(stem):
            local = "配图" + match.group(1)
            if local not in available:
                missing_images.append(local)

        records.append({
            "id": str(row[idx["题目ID"]] or "").strip(),
            "category": str(row[idx["科目"]] or "").strip(),
            "chapter": str(row[idx["章节"]] or "").strip(),
            "section": str(row[idx["考点"]] or row[idx["小节"]] or "").strip(),
            "type": qtype,
            "difficulty": DIFFICULTY_MAP.get(str(row[idx["难度"]] or "").strip(), ""),
            "content": rewrite_images(stem),
            "options": options,
            "answer": answer_raw,
            "explanation": rewrite_images(str(row[idx["解析"]] or "").strip()),
            "source": build_source(row, idx),
        })
        stats["choice"] += 1

    Path(out_path).write_text(json.dumps(records, ensure_ascii=False), encoding="utf-8")

    print("=== 转换结果 ===")
    print("选择题:", stats["choice"])
    print("跳过（非选择题）:", stats["skipped_type"])
    print("跳过（无答案）:", stats["skipped_no_answer"])
    print("跳过（无题干）:", stats["skipped_no_stem"])
    print("题干引用但压缩包缺失的图片:", len(set(missing_images)))
    for item in sorted(set(missing_images))[:5]:
        print("  ", item)
    print("输出:", out_path)


if __name__ == "__main__":
    convert(sys.argv[1], sys.argv[2], sys.argv[3])
