#!/usr/bin/env bash
# 阶段 8 验收自检：AC-13（界面自证）/ AC-20（组件库落地）/ AC-21（组件库真的在渲染）。
#
# AC-13 调 `tools/ui-shots.sh`（服务**自起自停**，临时 DATA_DIR，不碰生产数据）；
# AC-21 用 ui-shots 产出的**渲染后 DOM dump**（headless chromium 真实执行 React 后的 HTML）跑 BRIEF 原命令。
#
# 用法：bash tools/ac-stage8.sh [截图输出目录，默认 docs/shots]
set -u

cd "$(dirname "$0")/.." || exit 1
SHOTS_DIR=${1:-docs/shots}
PORT=${PORT:-8767}
LOG=tmp/ac-stage8-shots.log
FAIL=0

line() { printf '\n=== %s ===\n' "$1"; }
pass() { printf '  ✅ %s\n' "$1"; }
fail() { printf '  ❌ %s\n' "$1"; FAIL=1; }
expect_eq() { if [ "$2" = "$3" ]; then pass "$1 = $3"; else fail "$1 = $3（期望 $2）"; fi; }
expect_ge() { if [ "${3:-}" != '' ] && [ "$3" -ge "$2" ] 2>/dev/null; then pass "$1 = $3（期望 ≥$2）"; else fail "$1 = ${3:-空}（期望 ≥$2）"; fi; }

mkdir -p tmp

# ---------------------------------------------------------------- AC-20
line "AC-20 ① 直接依赖（antd / @ant-design/icons）"
npm ls antd @ant-design/icons --depth=0 || FAIL=1
ANTD_V=$(node -p "require('./node_modules/antd/package.json').version")
ICONS_V=$(node -p "require('./node_modules/@ant-design/icons/package.json').version")
expect_eq "antd 安装版本" "6.6.4" "$ANTD_V"
expect_eq "@ant-design/icons 安装版本" "6.3.4" "$ICONS_V"
expect_eq "package.json 出现 v5-patch-for-react-19 次数" "0" "$(grep -c 'v5-patch-for-react-19' package.json || true)"
# AC-20 ① 的"不得出现 v5 补丁"按 VERIFY 阶段 1 的口径用 npm ls 判（docs 里那句是"不需要它"的说明）
echo "  \$ npm ls @ant-design/v5-patch-for-react-19 --depth=0"
npm ls @ant-design/v5-patch-for-react-19 --depth=0 2>&1 | tail -1
V5_PATCH=$(npm ls @ant-design/v5-patch-for-react-19 --depth=0 --parseable 2>/dev/null | tail -n +2 | wc -l)
expect_eq "安装树里的 v5-patch-for-react-19" "0" "$V5_PATCH"
expect_ge "docs/dependencies.md 登记 antd 6.6.4 的行数" 1 "$(grep -c '6\.6\.4' docs/dependencies.md || true)"

line "AC-20 ② 源码里的原生表单/表格标签（期望 = 0）"
NATIVE_HITS=$(grep -rnE "<(button|input|select|textarea|table|dialog)[ >/]" web/src --include='*.tsx' || true)
NATIVE=$(printf '%s' "$NATIVE_HITS" | grep -c . || true)
[ -z "$NATIVE_HITS" ] || printf '%s\n' "$NATIVE_HITS"
expect_eq "原生标签命中" "0" "$NATIVE"

line "AC-20 ③ from 'antd' 出现次数（期望 ≥ 5）"
ANTD_IMPORTS=$(grep -rnoE "from ['\"]antd['\"]" web/src --include='*.tsx' | wc -l)
expect_ge "from 'antd'" 5 "$ANTD_IMPORTS"

line "AC-20 ④ 源码与构建产物里的 CDN 外链（期望 = 0）"
CDN_HITS=$(grep -rnE "(cdn|unpkg|jsdelivr|googleapis)" web/src dist --include='*.html' --include='*.tsx' --include='*.css' 2>/dev/null || true)
CDN=$(printf '%s' "$CDN_HITS" | grep -c . || true)
[ -z "$CDN_HITS" ] || printf '%s\n' "$CDN_HITS"
expect_eq "CDN 外链命中" "0" "$CDN"

# ---------------------------------------------------------------- AC-13
line "AC-13 界面自证截图（bash tools/ui-shots.sh $SHOTS_DIR，服务自起自停）"
if [ ! -f tools/ui-shots.sh ]; then
  fail "tools/ui-shots.sh 不存在"
else
  bash tools/ui-shots.sh "$SHOTS_DIR" >"$LOG" 2>&1
  RC=$?
  echo "  \$ bash tools/ui-shots.sh $SHOTS_DIR  → rc=$RC（完整日志：$LOG）"
  grep -E '^(SHOT|ANT_CLASSES|SERVICE|SEED|OK|FAIL)' "$LOG" || tail -20 "$LOG"
  expect_eq "ui-shots.sh 退出码" "0" "$RC"

  PNG_COUNT=$(ls -1 "$SHOTS_DIR"/*.png 2>/dev/null | wc -l)
  expect_ge "$SHOTS_DIR 下的 png 张数" 6 "$PNG_COUNT"

  line "AC-13 尺寸断言（PNG IHDR 宽×高）"
  python3 - "$SHOTS_DIR" <<'PY'
import glob, os, struct, sys
d = sys.argv[1]
for p in sorted(glob.glob(os.path.join(d, '*.png'))):
    head = open(p, 'rb').read(24)
    w, h = struct.unpack('>II', head[16:24])
    print(f'  {os.path.basename(p)} {w}x{h}')
PY

  line "AC-13 覆盖要求（登录/列表/编辑器/搜索/移动 390×844/暗色）"
  for key in login list editor search mobile dark; do
    expect_ge "文件名含 '$key' 的截图" 1 "$(ls -1 "$SHOTS_DIR"/*"$key"*.png 2>/dev/null | wc -l)"
  done
  expect_ge "390×844 移动截图" 1 "$(python3 - "$SHOTS_DIR" <<'PY'
import glob, os, struct, sys
n = 0
for p in glob.glob(os.path.join(sys.argv[1], '*.png')):
    w, h = struct.unpack('>II', open(p, 'rb').read(24)[16:24])
    if (w, h) == (390, 844):
        n += 1
print(n)
PY
)"
  expect_ge "1280×800 桌面截图" 1 "$(python3 - "$SHOTS_DIR" <<'PY'
import glob, os, struct, sys
n = 0
for p in glob.glob(os.path.join(sys.argv[1], '*.png')):
    w, h = struct.unpack('>II', open(p, 'rb').read(24)[16:24])
    if (w, h) == (1280, 800):
        n += 1
print(n)
PY
)"
  # ⚠️ 上线准备 P1：`docs/shots/before/`（阶段 8 修前对比图）已按清理清单删除，故不再断言它；
  # 改为核"当前状态截图"与"归档里的阶段 8 识图结论"（归档 = docs/dev-history/PROGRESS.md）。
  expect_ge "当前状态截图 docs/shots/*.png" 40 "$(ls -1 docs/shots/*.png 2>/dev/null | wc -l)"
  expect_ge "归档 PROGRESS 里「识图」结论条数" 6 "$(grep -c '识图' docs/dev-history/PROGRESS.md || true)"
fi

# ---------------------------------------------------------------- AC-21
line "AC-21 组件库真的在渲染（渲染后 DOM 里不同 ant-* 类名数，期望 ≥ 3）"
for page in list editor; do
  dump="tmp/ui-shots/$page.html"
  if [ -f "$dump" ]; then
    n=$(grep -o 'ant-[a-z-]*' "$dump" | sort -u | wc -l)
    echo "  $ gzip -dc 无需；dump = $dump（$(wc -c <"$dump") 字节）"
    grep -o 'ant-[a-z-]*' "$dump" | sort -u | head -12 | tr '\n' ' '
    echo
    expect_ge "$page 页不同 ant-* 类名" 3 "$n"
  else
    fail "缺少 DOM dump：$dump（由 tools/ui-shots.sh 产出）"
  fi
done

line "结论"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ AC-13 / AC-20 / AC-21 全部通过"
else
  echo "  ❌ 有未通过项（见上方 ❌）"
fi
exit "$FAIL"
