"""学员端题库接口：科目列表 + 按科目取题。

首页六格只读科目名与题数；点开一格按需取题。
"""

from django.db.models import Count
from rest_framework.response import Response

from common.api import PublicStudentAPIView, StudentAPIView

from .models import BankFavorite, BankQuestion, BankWrongBook, Subject


def serialize_question(question):
    return {
        "id": question.id,
        "subjectId": question.subject_id,
        "chapter": question.chapter,
        "section": question.section,
        "type": question.type,
        "renderKind": question.render_kind,
        "stem": question.stem,
        "options": question.options,
        "answer": question.answer,
        "explanation": question.explanation,
        "difficulty": question.difficulty,
        "source": question.source_label,
    }


class SubjectListView(PublicStudentAPIView):
    http_method_names = ("get", "head", "options")

    def get(self, request):
        subjects = Subject.objects.filter(is_active=True).order_by("sort_order", "id")
        return Response(
            {
                "count": subjects.count(),
                "next": None,
                "previous": None,
                "results": [
                    {
                        "id": subject.id,
                        "name": subject.name,
                        "questionCount": subject.question_count,
                    }
                    for subject in subjects
                ],
            }
        )


class ChapterListView(PublicStudentAPIView):
    """按科目聚合章节树，供科目页展示。"""

    http_method_names = ("get", "head", "options")

    def get(self, request, subject_id):
        subject = Subject.objects.filter(pk=subject_id, is_active=True).first()
        if subject is None:
            return Response({"detail": "科目不存在。"}, status=404)
        rows = (
            BankQuestion.objects.filter(subject=subject, is_published=True)
            .values("chapter", "section")
            .annotate(total=Count("id"))
            .order_by("chapter", "section")
        )
        chapters = []
        index = {}
        for row in rows:
            title = row["chapter"] or "未分类"
            bucket = index.get(title)
            if bucket is None:
                bucket = {"title": title, "count": 0, "sections": []}
                index[title] = bucket
                chapters.append(bucket)
            bucket["count"] += row["total"]
            if row["section"]:
                bucket["sections"].append({"title": row["section"], "count": row["total"]})
        return Response(
            {
                "subject": {"id": subject.id, "name": subject.name, "questionCount": subject.question_count},
                "count": len(chapters),
                "next": None,
                "previous": None,
                "results": chapters,
            }
        )


class BankQuestionListView(PublicStudentAPIView):
    http_method_names = ("get", "head", "options")

    def get(self, request):
        params = request.query_params
        subject_id = str(params.get("subject") or "").strip()
        try:
            limit = min(max(int(params.get("limit") or 1), 1), 50)
        except (TypeError, ValueError):
            limit = 1
        try:
            offset = max(int(params.get("offset") or 0), 0)
        except (TypeError, ValueError):
            offset = 0

        questions = BankQuestion.objects.filter(is_published=True)
        if subject_id:
            questions = questions.filter(subject_id=subject_id)
        chapter = str(params.get("chapter") or "").strip()
        if chapter:
            questions = questions.filter(chapter=chapter)
        section = str(params.get("section") or "").strip()
        if section:
            questions = questions.filter(section=section)
        qtype = str(params.get("type") or "").strip()
        if qtype:
            questions = questions.filter(type=qtype)
        source = str(params.get("source") or "").strip()
        if source:
            questions = questions.filter(source_label=source)
        kind = str(params.get("kind") or "").strip()
        if kind:
            questions = questions.filter(render_kind=kind)

        if str(params.get("random") or "") in ("1", "true", "yes"):
            questions = questions.order_by("?")
        else:
            questions = questions.order_by("sort_order", "id")

        total = questions.count()
        page = questions[offset:offset + limit]
        return Response(
            {
                "count": total,
                "offset": offset,
                "next": None,
                "previous": None,
                "results": [serialize_question(item) for item in page],
            }
        )


class SourceListView(PublicStudentAPIView):
    """按来源聚合，供真题练习选择试卷。"""

    http_method_names = ("get", "head", "options")

    def get(self, request, subject_id):
        rows = (
            BankQuestion.objects.filter(subject_id=subject_id, is_published=True)
            .exclude(source_label="")
            .values("source_label")
            .annotate(total=Count("id"))
            .order_by("-total", "source_label")[:60]
        )
        return Response(
            {
                "count": len(rows),
                "next": None,
                "previous": None,
                "results": [{"name": row["source_label"], "questionCount": row["total"]} for row in rows],
            }
        )


# ---------------------------------------------------------------------------
# 收藏与错题本（需要登录）
# ---------------------------------------------------------------------------


def subject_summary(rows, key):
    """按科目聚合数量，供前端做分类标签。"""
    buckets = {}
    for row in rows:
        question = row[key] if isinstance(row, dict) else row.question
        subject = question.subject
        item = buckets.setdefault(subject.id, {"id": subject.id, "name": subject.name, "count": 0})
        item["count"] += 1
    return sorted(buckets.values(), key=lambda item: item["id"])


class BankFavoriteView(StudentAPIView):
    http_method_names = ("get", "post")

    def get(self, request):
        rows = (
            BankFavorite.objects.filter(user=request.user)
            .select_related("question", "question__subject")
            .order_by("-created_at")
        )
        subject_id = str(request.query_params.get("subject") or "").strip()
        if subject_id:
            rows = rows.filter(question__subject_id=subject_id)
        rows = list(rows)
        return Response(
            {
                "count": len(rows),
                "next": None,
                "previous": None,
                "subjects": subject_summary(rows, "question"),
                "results": [
                    dict(
                        serialize_question(row.question),
                        subjectName=row.question.subject.name,
                        favoritedAt=row.created_at.isoformat(),
                    )
                    for row in rows
                ],
            }
        )

    def post(self, request):
        question_id = str(request.data.get("questionId") or "").strip()
        question = BankQuestion.objects.filter(pk=question_id, is_published=True).first()
        if question is None:
            return Response({"detail": "题目不存在。"}, status=404)
        favorite, _ = BankFavorite.objects.get_or_create(user=request.user, question=question)
        return Response(
            {"questionId": question.pk, "favorited": True, "favoritedAt": favorite.created_at.isoformat()},
            status=200,
        )


class BankFavoriteDetailView(StudentAPIView):
    http_method_names = ("delete",)

    def delete(self, request, question_id):
        BankFavorite.objects.filter(user=request.user, question_id=question_id).delete()
        return Response(status=204)


class BankWrongBookView(StudentAPIView):
    http_method_names = ("get", "post")

    def get(self, request):
        rows = (
            BankWrongBook.objects.filter(user=request.user, mastered=False)
            .select_related("question", "question__subject")
            .order_by("-last_wrong_at")
        )
        subject_id = str(request.query_params.get("subject") or "").strip()
        if subject_id:
            rows = rows.filter(question__subject_id=subject_id)
        rows = list(rows)
        results = []
        for row in rows:
            question = row.question
            results.append(
                {
                    "id": row.pk,
                    "questionId": question.pk,
                    "subjectId": question.subject_id,
                    "subjectName": question.subject.name,
                    "chapter": question.chapter,
                    "section": question.section,
                    "type": question.type,
                    "renderKind": question.render_kind,
                    "stem": question.stem,
                    "options": question.options,
                    "answer": question.answer,
                    "explanation": question.explanation,
                    "wrongCount": row.wrong_count,
                    "lastWrongAt": row.last_wrong_at.isoformat(),
                    "mastered": row.mastered,
                }
            )
        return Response(
            {
                "count": len(results),
                "next": None,
                "previous": None,
                "subjects": subject_summary(rows, "question"),
                "results": results,
            }
        )

    def post(self, request):
        question_id = str(request.data.get("questionId") or "").strip()
        question = BankQuestion.objects.filter(pk=question_id, is_published=True).first()
        if question is None:
            return Response({"detail": "题目不存在。"}, status=404)
        record, created = BankWrongBook.objects.get_or_create(user=request.user, question=question)
        if not created:
            record.wrong_count += 1
            record.mastered = False
            record.save(update_fields=["wrong_count", "mastered", "last_wrong_at"])
        return Response({"id": record.pk, "wrongCount": record.wrong_count}, status=200)


class BankWrongMasterView(StudentAPIView):
    http_method_names = ("post",)

    def post(self, request, record_id):
        record = BankWrongBook.objects.filter(pk=record_id, user=request.user).first()
        if record is None:
            return Response({"detail": "错题记录不存在。"}, status=404)
        record.mastered = True
        record.save(update_fields=["mastered"])
        return Response({"id": record.pk, "mastered": True})
