from django.contrib import admin
from unfold.admin import ModelAdmin

from .models import BankQuestion, Subject


@admin.register(Subject)
class SubjectAdmin(ModelAdmin):
    list_display = ("id", "name", "question_count", "sort_order", "is_active")
    list_editable = ("sort_order", "is_active")
    search_fields = ("id", "name")
    ordering = ("sort_order", "id")


@admin.register(BankQuestion)
class BankQuestionAdmin(ModelAdmin):
    list_display = ("id", "subject", "chapter", "type", "render_kind", "is_published", "sort_order")
    list_filter = ("subject", "render_kind", "is_published")
    search_fields = ("id", "stem", "chapter", "section")
    ordering = ("subject", "sort_order", "id")
    readonly_fields = ("render_kind",)
