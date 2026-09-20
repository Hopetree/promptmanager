#!/usr/bin/env bash
# 阶段 10A 设计稿截图：对一个方向目录产出 5 张 png（列表亮/列表暗/编辑器亮/移动/二次确认）。
# 用法：bash docs/design/tools/shoot.sh a-dark-saas
# 说明：全部走 file:// + 零安装 chromium（CDP），**不起服务、不占 8767**。
set -u
cd "$(dirname "$0")/../../.." || exit 1   # → 项目根

DIR=${1:-}
[ -n "$DIR" ] || { echo "用法：bash docs/design/tools/shoot.sh <a-dark-saas|b-apple-minimal|c-japanese-minimal>"; exit 2; }
MOCKUP="$PWD/docs/design/$DIR/mockup.html"
[ -f "$MOCKUP" ] || { echo "FAIL 找不到 $MOCKUP"; exit 1; }

PLAN=$(mktemp /tmp/pm-design-plan-XXXXXX.json)
TARGET="$PWD/docs/design/$DIR/shots"
mkdir -p "$TARGET"

python3 - "$PLAN" "$MOCKUP" "$TARGET" <<'PY'
import json, sys
plan_path, mockup, out_dir = sys.argv[1], sys.argv[2], sys.argv[3]
url = "file://" + mockup + "?shot=1"
shots = [
    {"name": "list-light",     "url": url + "#list",            "width": 1280, "height": 800, "dark": False, "waitFor": "#view-list"},
    {"name": "list-dark",      "url": url + "#list",            "width": 1280, "height": 800, "dark": True,  "waitFor": "#view-list"},
    {"name": "editor-light",   "url": url + "#editor",          "width": 1280, "height": 800, "dark": False, "waitFor": "#view-editor"},
    {"name": "mobile-list",    "url": url + "#list",            "width": 390,  "height": 844, "dark": False, "waitFor": "#view-list"},
    {"name": "import-confirm", "url": url + "#import-confirm",  "width": 1280, "height": 800, "dark": False, "waitFor": "#confirm-mask:not([hidden])"},
]
json.dump({"outDir": out_dir, "shots": shots}, open(plan_path, "w"), ensure_ascii=False, indent=2)
print(f"PLAN {len(shots)} shots -> {out_dir}")
PY

node docs/design/tools/design-shots.mjs "$PLAN" || { rm -f "$PLAN"; exit 1; }
rm -f "$PLAN"
echo "OK $DIR 张数=$(ls -1 "$TARGET"/*.png | wc -l)"
