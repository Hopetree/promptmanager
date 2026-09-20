#!/usr/bin/env bash
# 阶段 17 验收自检：AC-59（品牌图形全站统一：同一枚图标、只换尺寸）。
#   favicon 家族 200/Content-Type + index.html 头 + 顶栏 mark 26 + 三处装饰位（96/72/48，无点击）
#   + 空态有数据不出现 + 真鼠标点 logo 回主页 + 无第三种图形 + 单张 ≤250KB。
#
# 服务**自起自停**（临时 DATA_DIR，且**初始无 prompt** 以便验空态）；端口在台账范围自动挑空闲。
# 用法：bash tools/ac-stage17.sh
set -u

cd "$(dirname "$0")/.." || exit 1
PORT=${PORT:-auto}
AC_PW='ac-fixture-pw-20260918'
AC_USER='admin'
FAIL=0

pick_port() {
  for candidate in 8765 8766 8767 8768 8769 8770; do
    if ! ss -ltn | grep -q ":$candidate "; then echo "$candidate"; return 0; fi
  done
  return 1
}
if [ "${PORT}" = "auto" ]; then
  PORT=$(pick_port) || { echo "FAIL 台账范围 8765–8770 全被占用（写 QUESTIONS 停手）"; exit 1; }
  echo "  PORT 自动选择：$PORT"
fi
BASE="http://127.0.0.1:$PORT"

line() { printf '\n=== %s ===\n' "$1"; }
pass() { printf '  ✅ %s\n' "$1"; }
fail() { printf '  ❌ %s\n' "$1"; FAIL=1; }
eq() { if [ "$2" = "$3" ]; then pass "$1 = $3"; else fail "$1 = $3（期望 $2）"; fi; }
le() { if [ "${3:-}" != '' ] && [ "$3" -le "$2" ] 2>/dev/null; then pass "$1 = $3（期望 ≤$2）"; else fail "$1 = ${3:-空}（期望 ≤$2）"; fi; }

AC_DIR=''
SRV_PID=''
cleanup() {
  if [ -n "$SRV_PID" ]; then
    kill "$SRV_PID" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$SRV_PID" 2>/dev/null || break; sleep 0.3; done
    kill -9 "$SRV_PID" 2>/dev/null || true
  fi
  [ -n "$AC_DIR" ] && rm -rf "$AC_DIR"
}
trap cleanup EXIT

# ---------------------------------------------------------------- 静态侧
line "AC-59 ②：web/index.html 四条 link/meta + <title>"
grep -n 'rel="icon" type="image/svg+xml" href="/favicon.svg"' web/index.html || fail "缺少 svg icon"
grep -n 'rel="icon" href="/favicon.ico" sizes="any"' web/index.html || fail "缺少 ico icon"
grep -n 'rel="apple-touch-icon" href="/apple-touch-icon.png"' web/index.html || fail "缺少 apple-touch-icon"
grep -n 'name="theme-color" content="#5e6ad2"' web/index.html || fail "缺少 theme-color"
eq "index.html 的 <title>" "<title>PromptManager</title>" "$(grep -o '<title>.*</title>' web/index.html)"

line "AC-59 ⑤：不得引入第三种图形 + 单张 ≤250KB"
eq "grep -rn 'folder-art|source-1254' web/" 0 "$(grep -rnE 'folder-art|source-1254' web/ | wc -l)"
for f in web/public/favicon.svg web/public/favicon.ico web/public/apple-touch-icon.png web/public/icon-192.png web/public/icon-512.png web/public/promptmanager-icon.svg web/public/promptmanager-96.png web/public/promptmanager-72.png web/public/promptmanager-48.png; do
  le "$f 大小(byte)" 256000 "$(stat -c %s "$f")"
done

line "不得回归（源码侧）：组件库硬约束 / 契约未改"
eq "原生表单标签" 0 "$(grep -rnE "<(button|input|select|textarea|table|dialog)[ >/]" web/src --include='*.tsx' | wc -l)"
ge_antd=$(grep -rnoE "from ['\"]antd['\"]" web/src --include='*.tsx' | wc -l)
if [ "$ge_antd" -ge 5 ]; then pass "from 'antd' = $ge_antd（期望 ≥5）"; else fail "from 'antd' = $ge_antd（期望 ≥5）"; fi
eq "CDN（源码+产物）" 0 "$(grep -rnE '(cdn|unpkg|jsdelivr|googleapis)' dist/ web/src --include='*.html' --include='*.tsx' --include='*.css' 2>/dev/null | wc -l)"
eq "纯表现层（src/migrations/package.json 未改）" 0 "$(git status --short -- src migrations package.json | wc -l)"

# ---------------------------------------------------------------- 运行时侧
line "AC-59 ①：/favicon.ico 与 /favicon.svg 的 200 + Content-Type"
if ss -ltn | grep -q ":$PORT "; then
  fail "端口 $PORT 被占用"
else
  if [ ! -f dist/web/index.html ] || [ -n "$(find web/src web/public -newer dist/web/index.html -print -quit)" ]; then
    echo "  dist/web 缺失或源码/资产更新 → npm run build"
    npm run build >/dev/null 2>&1 || fail "npm run build 失败"
  fi
  AC_DIR=$(mktemp -d /tmp/pm-ac17-XXXXXX)
  printf '%s\n' "$AC_PW" | DATA_DIR="$AC_DIR" node bin/pm.mjs user set-password --username "$AC_USER" >/dev/null
  DATA_DIR="$AC_DIR" PORT="$PORT" node dist/server/index.js >"$AC_DIR/server.log" 2>&1 &
  SRV_PID=$!
  CODE=''
  for _ in $(seq 1 60); do
    CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/healthz" 2>/dev/null || true)
    [ "$CODE" = "200" ] && break
    sleep 0.3
  done
  if [ "$CODE" != "200" ]; then
    fail "服务未起来（$AC_DIR/server.log）"
  else
    echo "  --- curl -sI /favicon.ico ---"
    curl -sI "$BASE/favicon.ico" | sed 's/^/  /'
    echo "  --- curl -sI /favicon.svg ---"
    curl -sI "$BASE/favicon.svg" | sed 's/^/  /'
    ICO_TYPE=$(curl -sI "$BASE/favicon.ico" | tr -d '\r' | awk -F': ' 'tolower($1)=="content-type"{print $2}')
    SVG_TYPE=$(curl -sI "$BASE/favicon.svg" | tr -d '\r' | awk -F': ' 'tolower($1)=="content-type"{print $2}')
    ICO_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/favicon.ico")
    SVG_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/favicon.svg")
    eq "/favicon.ico 状态码" 200 "$ICO_CODE"
    eq "/favicon.svg 状态码" 200 "$SVG_CODE"
    case "$ICO_TYPE" in *icon*) pass "/favicon.ico Content-Type = $ICO_TYPE" ;; *) fail "/favicon.ico Content-Type = $ICO_TYPE" ;; esac
    case "$SVG_TYPE" in *svg*) pass "/favicon.svg Content-Type = $SVG_TYPE" ;; *) fail "/favicon.svg Content-Type = $SVG_TYPE" ;; esac
    # 产物 index.html 也要带上四行（构建后由 dist 提供）
    eq "dist/web/index.html 含 favicon.svg" 1 "$(grep -c 'href="/favicon.svg"' dist/web/index.html)"
    eq "dist/web/index.html 含 theme-color" 1 "$(grep -c 'name="theme-color" content="#5e6ad2"' dist/web/index.html)"

    JAR="$AC_DIR/jar.txt"
    curl -s -c "$JAR" -o /dev/null -X POST -H 'Content-Type: application/json' \
      -d "{\"username\":\"$AC_USER\",\"password\":\"$AC_PW\"}" "$BASE/api/login"
    SID=$(awk '$6 == "pm_sid" { print $7 }' "$JAR" | tail -1)
    # 注意：**不预置任何 prompt**（空态 72 只在库为空时出现）
    node tools/ac-stage17-probe.mjs "$BASE" "$SID" | tee "$AC_DIR/probe.log"
    v() { grep -m1 "^$1=" "$AC_DIR/probe.log" | cut -d= -f2-; }

    line "AC-59 ③④：顶栏 mark 与三处装饰位（真鼠标点击无动作）"
    pass "顶栏 mark：$(v ac59_brand_mark)"
    eq "顶栏 mark = /promptmanager-icon.svg@26×26" "true" "$(v ac59_mark_ok)"
    pass "登录页装饰位：$(v ac59_login_art)"
    eq "登录页 = 96 且 aria-hidden" "true" "$(v ac59_login_art_ok)"
    pass "空态装饰位：$(v ac59_empty_art)"
    eq "空态 = 72 且 aria-hidden" "true" "$(v ac59_empty_art_ok)"
    pass "关于页装饰位：$(v ac59_about_art)"
    eq "关于页 = 48 且 aria-hidden" "true" "$(v ac59_about_art_ok)"
    eq "真鼠标点登录页装饰位无动作" "true" "$(v ac59_login_art_no_action)"
    eq "真鼠标点空态装饰位无动作" "true" "$(v ac59_empty_art_no_action)"
    eq "空态点击前后状态一致" "true" "$([ "$(v ac59_empty_art_before)" = "$(v ac59_empty_art_after)" ] && echo true || echo false)"
    eq "三处装饰位 cursor 均非 pointer" "true" "$(printf '%s' "$(v ac59_art_cursors)" | grep -q 'pointer' && echo false || echo true)"
    eq "真鼠标点关于页装饰位无动作" "true" "$(v ac59_about_art_no_action)"
    eq "有数据时空态装饰位不出现" "true" "$(v ac59_empty_art_absent_with_data)"
    eq "真鼠标点 logo 仍回主页（分栏）" "true" "$(v ac59_logo_home_ok)"
    pass "点击前：$(v ac59_before_home) ｜ 点击后：$(v ac59_after_home)"

    line "AC-59 ⑤：页面实际加载的资产都 ≤250KB"
    pass "各资产字节数：$(v ac59_asset_sizes)"
    le "最大单张(byte)" 256000 "$(v ac59_asset_max)"
    eq "全部资产均可取到且 ≤250KB" "true" "$(v ac59_asset_all_ok)"
  fi
fi

line "结论"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ AC-59 全部通过"
else
  echo "  ❌ 有未通过项（见上方 ❌）"
fi
exit "$FAIL"
