from django.urls import path

from .api import (
    BankFavoriteDetailView, BankFavoriteView, BankQuestionListView, BankWrongBookView,
    BankWrongMasterView, ChapterListView, SourceListView, SubjectListView,
)


urlpatterns = [
    path("bank/subjects/", SubjectListView.as_view(), name="student-bank-subjects"),
    path("bank/subjects/<slug:subject_id>/chapters/", ChapterListView.as_view(), name="student-bank-chapters"),
    path("bank/subjects/<slug:subject_id>/sources/", SourceListView.as_view(), name="student-bank-sources"),
    path("bank/questions/", BankQuestionListView.as_view(), name="student-bank-questions"),
    path("bank/favorites/", BankFavoriteView.as_view(), name="student-bank-favorites"),
    path("bank/favorites/<slug:question_id>/", BankFavoriteDetailView.as_view(), name="student-bank-favorite-detail"),
    path("bank/wrong-book/", BankWrongBookView.as_view(), name="student-bank-wrong-book"),
    path("bank/wrong-book/<int:record_id>/master/", BankWrongMasterView.as_view(), name="student-bank-wrong-master"),
]
