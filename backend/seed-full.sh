#!/usr/bin/env bash
# 一键把本机演示环境跑起来：装依赖 → 建库 → 导入全部题库（13585 题）→ 提示启动。
# 用法：cd backend && ./seed-full.sh
# 区别：setup.sh 只建库和演示数据（61 题），这个脚本会把 data/bank-questions.json 全量导入。
set -euo pipefail
cd "$(dirname "$0")"

# setup.sh 会用这三个变量免交互建管理员（演示账号，可登录后台）
export DJANGO_SUPERUSER_USERNAME="${DJANGO_SUPERUSER_USERNAME:-localadmin}"
export DJANGO_SUPERUSER_EMAIL="${DJANGO_SUPERUSER_EMAIL:-localadmin@example.com}"
export DJANGO_SUPERUSER_PASSWORD="${DJANGO_SUPERUSER_PASSWORD:-local123456}"

./setup.sh

BACKEND_PY="$PWD/.venv/bin/python"
if [ ! -f data/bank-questions.json ]; then
    echo "缺少 data/bank-questions.json，无法导入题库。" >&2
    exit 1
fi

"$BACKEND_PY" manage.py import_bank --source data/bank-questions.json --per-subject 0 --reset

COUNT=$("$BACKEND_PY" manage.py shell -c "from bank.models import BankQuestion; print(BankQuestion.objects.count())" | tail -1)
echo ""
echo "题库导入完成：$COUNT 道题"
echo "启动后端：./start.sh（默认 http://127.0.0.1:8000）"
echo "然后在微信开发者工具里导入项目根目录并编译。"
