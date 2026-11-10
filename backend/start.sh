#!/usr/bin/env bash
# macOS / Linux 版启动脚本，等价于 start.ps1。
# 用法：./start.sh            仅本机（默认 127.0.0.1:8000）
#       ./start.sh --lan      监听 0.0.0.0，供真机预览连局域网 IP
#       ./start.sh --port=8001
set -euo pipefail
cd "$(dirname "$0")"

HOST="127.0.0.1"
PORT="8000"
for arg in "$@"; do
    case "$arg" in
        --lan) HOST="0.0.0.0" ;;
        --port=*) PORT="${arg#*=}" ;;
        *) echo "未知参数：$arg" >&2; exit 2 ;;
    esac
done

BACKEND_PY="$PWD/.venv/bin/python"
if [ ! -x "$BACKEND_PY" ] || [ ! -f .env ]; then
    echo "请先运行 ./setup.sh" >&2
    exit 1
fi

if [ "$HOST" = "0.0.0.0" ]; then
    echo "局域网模式：手机请访问 http://<本机局域网IP>:$PORT"
    echo "查看本机 IP：ipconfig getifaddr en0"
fi
exec "$BACKEND_PY" manage.py runserver "$HOST:$PORT"
