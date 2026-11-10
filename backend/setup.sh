#!/usr/bin/env bash
# macOS / Linux 版初始化脚本，等价于 setup.ps1。
# 用法：cd backend && ./setup.sh
set -euo pipefail
cd "$(dirname "$0")"

# 1) 找 Python 3.14
PYBIN=""
for candidate in python3.14 /opt/homebrew/bin/python3.14 /usr/local/bin/python3.14; do
    if command -v "$candidate" >/dev/null 2>&1; then
        if "$candidate" -c 'import sys; sys.exit(0 if sys.version_info[:2]==(3,14) else 1)' >/dev/null 2>&1; then
            PYBIN="$candidate"
            break
        fi
    fi
done
if [ -z "$PYBIN" ]; then
    echo "未找到 Python 3.14。macOS 安装：brew install python@3.14" >&2
    exit 1
fi
echo "使用 Python: $PYBIN ($("$PYBIN" -V))"

# 2) 虚拟环境
if [ ! -x .venv/bin/python ]; then
    "$PYBIN" -m venv .venv
fi
BACKEND_PY="$PWD/.venv/bin/python"

# 3) 依赖
"$BACKEND_PY" -m pip install --upgrade pip
"$BACKEND_PY" -m pip install -r requirements.txt

# 4) 本机配置
if [ ! -f .env ]; then
    "$BACKEND_PY" scripts/initialize_env.py
fi

# 5) 数据库与基础数据（全部幂等，不会覆盖已有数据）
"$BACKEND_PY" manage.py migrate --noinput
"$BACKEND_PY" manage.py seed_demo
"$BACKEND_PY" manage.py setup_roles
"$BACKEND_PY" manage.py setup_business_roles
"$BACKEND_PY" manage.py seed_product

# 6) 管理员检查
if "$BACKEND_PY" manage.py shell -c "from accounts.models import User; import sys; sys.exit(0 if User.objects.filter(is_superuser=True,is_active=True).exists() else 1)" >/dev/null 2>&1; then
    echo "已存在管理员账号，跳过创建。"
else
    "$BACKEND_PY" manage.py createsuperuser
fi

echo ""
echo "准备完成。启动后端：./start.sh  然后打开 http://127.0.0.1:8000/admin/"
echo "别忘了在 .env 里填 WECHAT_APP_ID 与 WECHAT_APP_SECRET。"
