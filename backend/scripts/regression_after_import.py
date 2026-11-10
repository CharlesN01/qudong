"""导入题库后的模块回归。对着正在运行的后端发真实请求，从登录开始。

登录凭证是哈希存储，明文拿不回来，所以这里给已有学员临时签一个会话，
测完立即撤销。不新建用户，不碰题库数据。

用法：后端运行在 8000 后执行
    python scripts/regression_after_import.py
"""

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import django

django.setup()

from django.utils import timezone

from accounts.models import StudentSession, WeChatIdentity
from accounts.services import issue_student_session

BASE = "http://127.0.0.1:8000"
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

results = []


class FakeLogin:
    def __init__(self, app_id, openid):
        self.app_id = app_id
        self.openid = openid
        self.session_key = "regression-probe"


def call(method, path, token=None, body=None, expect=200):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(BASE + path, data=data, method=method)
    request.add_header("Accept", "application/json")
    if data is not None:
        request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", "Bearer " + token)
    try:
        response = OPENER.open(request, timeout=30)
        status, payload = response.status, response.read()
    except urllib.error.HTTPError as error:
        status, payload = error.code, error.read()
    parsed = {}
    if payload:
        try:
            parsed = json.loads(payload)
        except ValueError:
            parsed = {"raw": payload[:60]}
    ok = status == expect
    results.append((ok, method + " " + path, status, expect))
    return status, parsed


def main():
    identity = WeChatIdentity.objects.order_by("id").first()
    if identity is None:
        print("没有已登录学员，先在小程序里登录一次再跑。")
        return 1

    raw_token, session = issue_student_session(FakeLogin(identity.app_id, identity.openid))
    try:
        print("=== 登录与鉴权 ===")
        call("GET", "/api/student/v1/me/statistics/", token=raw_token)
        call("GET", "/api/student/v1/me/entitlements/", token=raw_token)
        call("GET", "/api/student/v1/me/preferences/", token=raw_token)
        call("GET", "/api/student/v1/orders/?page=1", token=raw_token)
        call("GET", "/api/student/v1/me/statistics/", expect=401)
        status, _ = call("POST", "/api/student/v1/auth/wechat/", body={"code": "invalid-code"}, expect=401)
        print("  假 code 登录返回", status, "（401 表示微信校验仍在工作）")

        print("=== 题库 ===")
        _, subjects = call("GET", "/api/student/v1/bank/subjects/")
        total = sum(item["questionCount"] for item in subjects.get("results", []))
        results.append((total == 13585, "科目题量合计 13585", total, 13585))

        for kind, subject in (("choice", "politics"), ("fill", "chinese"), ("subjective", "english")):
            _, page = call("GET", "/api/student/v1/bank/questions/?subject=%s&limit=5" % subject)
            got = any(item["renderKind"] == kind for item in page.get("results", [])) or page.get("count", 0) > 0
            results.append((page.get("count", 0) > 0, "%s 科目有题" % subject, page.get("count"), ">0"))

        _, chapters = call("GET", "/api/student/v1/bank/subjects/computer/chapters/")
        results.append((len(chapters.get("results", [])) > 0, "计算机章节树非空",
                        len(chapters.get("results", [])), ">0"))
        _, sources = call("GET", "/api/student/v1/bank/subjects/math1/sources/")
        results.append((sources.get("count", 0) > 0, "高数一来源聚合非空", sources.get("count"), ">0"))

        print("=== 错题本与收藏 ===")
        _, wrong = call("GET", "/api/student/v1/bank/wrong-book/", token=raw_token)
        _, fav = call("GET", "/api/student/v1/bank/favorites/", token=raw_token)
        sample = call("GET", "/api/student/v1/bank/questions/?subject=politics&limit=1")[1]
        question_id = sample["results"][0]["id"]
        call("POST", "/api/student/v1/bank/favorites/", token=raw_token, body={"questionId": question_id})
        _, fav_after = call("GET", "/api/student/v1/bank/favorites/", token=raw_token)
        added = any(item["id"] == question_id for item in fav_after.get("results", []))
        results.append((added, "收藏写入后能读回", added, True))
        call("DELETE", "/api/student/v1/bank/favorites/%s/" % question_id, token=raw_token, expect=204)
        _, fav_clean = call("GET", "/api/student/v1/bank/favorites/", token=raw_token)
        removed = all(item["id"] != question_id for item in fav_clean.get("results", []))
        results.append((removed, "取消收藏后消失", removed, True))

        print("=== 内容与资料 ===")
        call("GET", "/api/student/v1/config/")
        call("GET", "/api/student/v1/categories/?page=1")
        call("GET", "/api/student/v1/articles/?page=1")
        call("GET", "/api/student/v1/products/")
        call("GET", "/api/student/v1/resources/group/")
        call("GET", "/api/student/v1/writings/")

        print("=== 会话撤销 ===")
        StudentSession.objects.filter(pk=session.pk).update(revoked_at=timezone.now())
        call("GET", "/api/student/v1/me/statistics/", token=raw_token, expect=401)
    finally:
        StudentSession.objects.filter(pk=session.pk, revoked_at__isnull=True).update(revoked_at=timezone.now())

    print()
    failed = [item for item in results if not item[0]]
    for ok, name, actual, expect in results:
        if not ok:
            print("  FAIL  %s  实际=%s 期望=%s" % (name, actual, expect))
    print("用例 %d  通过 %d  失败 %d" % (len(results), len(results) - len(failed), len(failed)))
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
