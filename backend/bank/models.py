"""科目与题库。

与 content 应用的「文学分类 / 篇目 / 题目」模型并存，互不影响：
content 服务于文学常识与文言文背诵，bank 服务于六科刷题。
"""

from django.conf import settings
from django.db import models


RENDER_KINDS = (
    ("choice", "选择题"),
    ("fill", "填空题"),
    ("subjective", "主观题"),
)

# 原始题型 -> 渲染形态。题库换源时只需要在映射表里加一行。
RENDER_KIND_BY_TYPE = {
    "single": "choice",
    "multiple": "choice",
    "judge": "choice",
    "choice": "choice",
    "fill": "fill",
    "word_explain": "fill",
    "classical_translation": "fill",
    "c2e_translation": "fill",
    "translation": "fill",
    "short": "subjective",
    "proof": "subjective",
    "poem_reading": "subjective",
    "modern_reading": "subjective",
    "practical_writing": "subjective",
    "argumentative_writing": "subjective",
    "subjective": "subjective",
    "reading": "subjective",
    "seven_choice": "subjective",
    "cloze": "subjective",
}


class Subject(models.Model):
    id = models.CharField("科目编号", primary_key=True, max_length=32)
    name = models.CharField("科目名称", max_length=32)
    sort_order = models.PositiveIntegerField("排序", default=0)
    is_active = models.BooleanField("启用", default=True)
    question_count = models.PositiveIntegerField("题目数量", default=0)

    class Meta:
        verbose_name = "科目"
        verbose_name_plural = verbose_name
        ordering = ("sort_order", "id")

    def __str__(self):
        return self.name


class BankQuestion(models.Model):
    id = models.CharField("题目编号", primary_key=True, max_length=64)
    subject = models.ForeignKey(
        Subject, verbose_name="科目", on_delete=models.CASCADE, related_name="questions"
    )
    chapter = models.CharField("章节", max_length=120, blank=True)
    section = models.CharField("考点", max_length=120, blank=True)
    type = models.CharField("原始题型", max_length=32)
    render_kind = models.CharField("渲染形态", max_length=16, choices=RENDER_KINDS, default="choice")
    stem = models.TextField("题干")
    options = models.JSONField("选项", default=list, blank=True)
    answer = models.JSONField("答案", default=list, blank=True)
    explanation = models.TextField("解析", blank=True)
    difficulty = models.CharField("难度", max_length=16, blank=True)
    source_label = models.CharField("来源", max_length=200, blank=True)
    is_published = models.BooleanField("已发布", default=True)
    sort_order = models.IntegerField("排序", default=0)

    class Meta:
        verbose_name = "题库题目"
        verbose_name_plural = verbose_name
        ordering = ("sort_order", "id")
        indexes = [
            models.Index(fields=["subject", "chapter", "section", "sort_order"]),
            models.Index(fields=["subject", "render_kind", "is_published"]),
        ]

    def __str__(self):
        return f"[{self.subject_id}] {self.stem[:24]}"


class BankFavorite(models.Model):
    """学员收藏的题库题目；与 content 的收藏互不影响。"""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, verbose_name="学员", on_delete=models.CASCADE, related_name="bank_favorites"
    )
    question = models.ForeignKey(
        BankQuestion, verbose_name="题目", on_delete=models.CASCADE, related_name="favorited_by"
    )
    created_at = models.DateTimeField("收藏时间", auto_now_add=True)

    class Meta:
        verbose_name = "题库收藏"
        verbose_name_plural = verbose_name
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(fields=["user", "question"], name="uniq_bank_favorite"),
        ]
        indexes = [models.Index(fields=["user", "created_at"])]

    def __str__(self):
        return f"{self.user_id} → {self.question_id}"


class BankWrongBook(models.Model):
    """错题本：累计答错次数，可标记已掌握。"""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, verbose_name="学员", on_delete=models.CASCADE, related_name="bank_wrong_book"
    )
    question = models.ForeignKey(
        BankQuestion, verbose_name="题目", on_delete=models.CASCADE, related_name="wrong_records"
    )
    wrong_count = models.PositiveIntegerField("答错次数", default=1)
    last_wrong_at = models.DateTimeField("最近答错时间", auto_now=True)
    mastered = models.BooleanField("已掌握", default=False)

    class Meta:
        verbose_name = "错题本"
        verbose_name_plural = verbose_name
        ordering = ("-last_wrong_at",)
        constraints = [
            models.UniqueConstraint(fields=["user", "question"], name="uniq_bank_wrong"),
        ]
        indexes = [models.Index(fields=["user", "mastered", "last_wrong_at"])]

    def __str__(self):
        return f"{self.user_id} × {self.wrong_count} {self.question_id}"
