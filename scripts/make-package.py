# 打包脚本：生成两个交付包
# 1) 小程序前端包：可直接导入开发者工具看效果
# 2) 完整项目包：含 Django 后端源码，可二次开发

import os
import shutil
import sqlite3
import tempfile
import zipfile
from datetime import datetime

SRC = r"D:\WorkBuddy-AI-Output\wxz-"
OUT_DIR = r"D:\WorkBuddy-AI-Output"
STAMP = datetime.now().strftime("%Y%m%d")

# 任何包里都不带的东西
# 注意：不要排除 media —— 题库配图在 backend/.local/media 下，运行时必需。
COMMON_EXCLUDE_DIRS = {
    "node_modules", ".git", ".venv", "__pycache__", ".devtools",
    ".preview", "staticfiles", ".pytest_cache",
}
COMMON_EXCLUDE_FILES = {".DS_Store", ".env", "project.private.config.json"}
COMMON_EXCLUDE_EXT = {".pyc", ".pyo", ".log"}

# 图片只在这些目录里排除（历史验收截图、原型图，占 20 多 M）。
# miniprogram/assets 下的图标和二维码是运行时必需的，一张都不能少。
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
IMAGE_HEAVY_DIRS = ("doc/", "ui/", "outputs/")

# 包内使用的数据库副本：清掉登录会话，避免把自己的登录凭证发给别人
# 工作库本身不动，打包结束后也不受影响
_CLEAN_DB = os.path.join(tempfile.gettempdir(), "wxz_package_db.sqlite3")


def prepare_clean_db():
    """复制一份数据库，只保留题库与配置，清空登录会话。"""
    src = os.path.join(SRC, "backend", "db.sqlite3")
    if not os.path.exists(src):
        return None
    shutil.copy2(src, _CLEAN_DB)
    conn = sqlite3.connect(_CLEAN_DB)
    try:
        tables = {
            row[0]
            for row in conn.execute(
                "select name from sqlite_master where type='table'"
            )
        }
        # 清登录会话
        if "accounts_studentsession" in tables:
            conn.execute("delete from accounts_studentsession")
        # 清掉用本机密钥加密的字段，否则对方初始化 .env 时会被判定为
        # “存在旧加密数据”而拒绝生成新密钥，导致 setup 直接失败
        if "accounts_wechatidentity" in tables:
            conn.execute(
                "update accounts_wechatidentity set encrypted_session_key = ''"
            )
        if "payments_accesstokencache" in tables:
            conn.execute("delete from payments_accesstokencache")
        conn.commit()
    finally:
        conn.close()
    return _CLEAN_DB


def should_skip(rel_path, extra_dirs=(), extra_ext=()):
    parts = rel_path.replace("\\", "/").split("/")
    for part in parts[:-1]:
        if part in COMMON_EXCLUDE_DIRS or part in extra_dirs:
            return True
    name = parts[-1]
    if name in COMMON_EXCLUDE_FILES:
        return True
    # 数据库备份、编辑器临时文件不进包
    if ".bak-" in name or name.endswith(".bak") or name.endswith(".sqlite3.bak"):
        return True
    ext = os.path.splitext(name)[1].lower()
    if ext in COMMON_EXCLUDE_EXT or ext in extra_ext:
        return True
    normalized = rel_path.replace("\\", "/")
    if ext in IMAGE_EXT and normalized.startswith(IMAGE_HEAVY_DIRS):
        return True
    return False


def build(zip_name, extra_dirs=(), extra_ext=(), root_filter=None):
    out_path = os.path.join(OUT_DIR, zip_name)
    count = 0
    total = 0
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for dirpath, dirnames, filenames in os.walk(SRC):
            rel_dir = os.path.relpath(dirpath, SRC)
            if rel_dir == ".":
                rel_dir = ""
            # 剪枝，避免走进大目录
            dirnames[:] = [
                d for d in dirnames
                if d not in COMMON_EXCLUDE_DIRS and d not in extra_dirs
            ]
            for filename in filenames:
                rel_path = os.path.join(rel_dir, filename) if rel_dir else filename
                if should_skip(rel_path, extra_dirs, extra_ext):
                    continue
                if root_filter and not root_filter(rel_path.replace("\\", "/")):
                    continue
                abs_path = os.path.join(dirpath, filename)
                # db.sqlite3 用清理过会话的副本，避免把登录凭证打进包
                if filename == "db.sqlite3" and os.path.exists(_CLEAN_DB):
                    abs_path = _CLEAN_DB
                try:
                    zf.write(abs_path, os.path.join("wxz", rel_path))
                    count += 1
                    total += os.path.getsize(abs_path)
                except OSError as error:
                    print(f"  跳过 {rel_path}: {error}")
    size_mb = os.path.getsize(out_path) / 1024 / 1024
    print(f"{zip_name}")
    print(f"  {count} 个文件，原始 {total/1024/1024:.1f} MB，压缩后 {size_mb:.1f} MB")
    return out_path


prepare_clean_db()

print("=== 1. 小程序前端包 ===")
FRONT_ROOTS = ("miniprogram", "scripts", "tests", "doc", "ui", "outputs")
build(
    f"文常记小程序-前端-{STAMP}.zip",
    extra_dirs=("backend",),
    extra_ext=(".docx", ".xlsx"),
    root_filter=lambda p: p.split("/")[0] in FRONT_ROOTS or "/" not in p,
)

print()
print("=== 2. 完整项目包 ===")
# 完整包保留后端源码与题库，但不带虚拟环境、密钥和历史截图
build(
    f"文常记完整项目-{STAMP}.zip",
    extra_ext=(".docx",),
)
