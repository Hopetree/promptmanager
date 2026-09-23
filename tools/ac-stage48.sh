#!/usr/bin/env bash
# 阶段 48 验收自检（FR-112：令牌「状态」列只读 / 读写 用不同背景色区分）：
#   AC-113 ① 有效行两类 Tag 的 backgroundColor **不相等**（贴完整 bg/color）
#        ② 只读 / 读写 / 已撤销 **三者两两不等**
#        ③ 读写视觉重量 ≥ 只读（色号与理由见 PROGRESS；**不得**用红色系表达只读）
#        ④ 亮色 + 暗色**两套主题**下各测一次 ①②
#        ⑤ 真鼠标点「有效」状态 → 弹菜单 → 选另一项 → **文本与背景色都跟着变**（贴前后值）
#        ⑥ 列结构与文案不变：表头仍 7 列；文字仍是 有效 · 只读 / 有效 · 读写 / 已撤销 · …
#        ⑦ 视觉证据：亮 + 暗各一张（含只读与读写同时可见）
#        ⑧ 回归：npm test（本脚本复跑）/ ci-check（在脚本外另跑）
#
# 本条属**前端样式**类 ⇒ 回归范围按 D-48 ④（受影响部分 + npm test + ci-check），不必全量。
# 全程临时 DATA_DIR + 台账范围内备用端口；不碰 8767 测试环境、不碰 106 生产。
# 用法：bash tools/ac-stage48.sh
set -u
set -o pipefail

cd "$(dirname "$0")/.." || exit 1
PORT=${PORT:-auto}
AC_PW='ac-fixture-pw-20260923'
AC_USER='admin'
SHOTS='tmp/shots/stage48'
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
neq() { if [ "$2" != "$3" ]; then pass "$1：$3 ≠ $2"; else fail "$1：两者相同（$3）"; fi; }

DIR=''
SRV_PID=''
cleanup() {
  if [ -n "$SRV_PID" ]; then
    kill "$SRV_PID" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$SRV_PID" 2>/dev/null || break; sleep 0.3; done
    kill -9 "$SRV_PID" 2>/dev/null || true
  fi
  [ -n "$DIR" ] && [ "${KEEP_AC_DIR:-0}" != "1" ] && rm -rf "$DIR"
}
trap cleanup EXIT
DIR=$(mktemp -d /tmp/pm-ac48-XXXXXX)
DB="$DIR/pm.db"
q() { sqlite3 "$DB" "$1"; }
f() { printf '%s' "$1" | jq -c -r "$2"; }

line "构建 + 全量单测（前端样式类：本脚本 + npm test + ci-check 即为选定范围）"
npm run build >"$DIR/build.log" 2>&1
eq "npm run build 退出码" 0 "$?"
npm test >"$DIR/test.log" 2>&1
eq "npm test 退出码" 0 "$?"
grep -E "^ℹ (tests|pass|fail)" "$DIR/test.log" | sed 's/^/  /'

line "运行时：临时实例（DATA_DIR=$DIR，PORT=$PORT）+ 三类行夹具"
printf '%s\n' "$AC_PW" | DATA_DIR="$DIR" node bin/pm.mjs user set-password --username "$AC_USER" >/dev/null
DATA_DIR="$DIR" PORT="$PORT" node dist/server/index.js >"$DIR/server.log" 2>&1 &
SRV_PID=$!
CODE=''
for _ in $(seq 1 60); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/healthz" 2>/dev/null || true)
  [ "$CODE" = "200" ] && break
  sleep 0.3
done
if [ "$CODE" != "200" ]; then
  fail "服务未起来（$DIR/server.log）"
else
  JAR="$DIR/jar.txt"
  curl -s -c "$JAR" -o /dev/null -X POST -H 'Content-Type: application/json' \
    -d "{\"username\":\"$AC_USER\",\"password\":\"$AC_PW\"}" "$BASE/api/login"
  SID=$(awk '$6 == "pm_sid" { print $7 }' "$JAR" | tail -1)
  [ -z "$SID" ] && fail "登录失败，拿不到 pm_sid"

  RO_JSON=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"name":"AC113 只读","scope":"read"}' "$BASE/api/tokens")
  RO_ID=$(f "$RO_JSON" '.id')
  RW_JSON=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"name":"AC113 读写","scope":"write"}' "$BASE/api/tokens")
  RW_ID=$(f "$RW_JSON" '.id')
  RV_JSON=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"name":"AC113 已撤销","scope":"read"}' "$BASE/api/tokens")
  RV_ID=$(f "$RV_JSON" '.id')
  curl -s -b "$JAR" -o /dev/null -X DELETE "$BASE/api/tokens/$RV_ID"
  pass "夹具：只读 id=$RO_ID ｜ 读写 id=$RW_ID ｜ 已撤销 id=$RV_ID"

  for THEME in light dark; do
    line "AC-113 ①②③④⑤⑥：${THEME} 主题（真浏览器，等抽屉动画结束再量）"
    rm -rf "$SHOTS/$THEME"
    AC113_READ_ID="$RO_ID" AC113_WRITE_ID="$RW_ID" AC113_REVOKED_ID="$RV_ID" \
      node tools/ac-stage48-probe.mjs colors "$BASE" "$SID" "$SHOTS/$THEME" "$THEME" | tee "$DIR/$THEME.log"
    c() { grep -m1 "^$1=" "$DIR/$THEME.log" | cut -d= -f2-; }
    C=$(c colors)

    READ_BG=$(f "$C" '.read.bg'); WRITE_BG=$(f "$C" '.write.bg'); REVOKED_BG=$(f "$C" '.revoked.bg')
    READ_FG=$(f "$C" '.read.color'); WRITE_FG=$(f "$C" '.write.color')
    echo "  \$ ${THEME} 只读 bg/fg = $READ_BG / $READ_FG"
    echo "  \$ ${THEME} 读写 bg/fg = $WRITE_BG / $WRITE_FG"
    echo "  \$ ${THEME} 已撤销 bg = $REVOKED_BG"

    eq "④ 主题 = $THEME" "$THEME" "$(c theme)"
    neq "① **只读 与 读写 背景色不同**" "$READ_BG" "$WRITE_BG"
    neq "② 只读 与 已撤销 背景色不同" "$READ_BG" "$REVOKED_BG"
    neq "② 读写 与 已撤销 背景色不同" "$WRITE_BG" "$REVOKED_BG"
    eq "② 三态背景色两两不等（去重后仍是 3 个）" 3 "$(printf '%s' "$C" | jq -r '[.read.bg, .write.bg, .revoked.bg] | unique | length')"
    neq "① 只读 与 读写 文字色也不同（颜色之外的第二重线索）" "$READ_FG" "$WRITE_FG"
    # ③ 只读不得用红色系：红通道明显高于绿/蓝即视为红系（只读=green ⇒ 绿占优）
    eq "③ 只读**不是红色系**（绿通道 ≥ 红通道）" true "$(printf '%s' "$C" | jq -r '
      (.read.color | [scan("[0-9]+")] | map(tonumber)) as $c | ($c[1] >= $c[0])')"
    eq "③ 读取写 也不是红色系（红通道不占绝对优势：读写=gold）" true "$(printf '%s' "$C" | jq -r '
      (.write.color | [scan("[0-9]+")] | map(tonumber)) as $c | ($c[0] < 250)')"
    # ⑥ 列结构与文案
    eq "⑥ 表头仍是 7 列（含创建时间/最近使用）" '["名称","Token","状态","使用","创建时间","最近使用","操作"]' "$(f "$C" '.heads')"
    eq "⑥ 三类行文字仍是 有效 · 只读 / 有效 · 读写 / 已撤销 · …" "有效 · 只读|有效 · 读写|已撤销 · 只读" "$(printf '%s' "$C" | jq -r '[.scan[].text] | join("|")')"
    # ⑤ 真鼠标点状态列改权限 → 文本 + 背景色都变
    eq "⑤ 改前文本" "有效 · 只读" "$(f "$(c before)" '.text')"
    eq "⑤ 弹菜单两项" '["只读","读写"]' "$(c menu_items)"
    eq "⑤ 真鼠标一次点中（改为读写）" 1 "$(c up_attempts)"
    eq "⑤ 改后文本" "有效 · 读写" "$(f "$(c after_write)" '.text')"
    neq "⑤ **改后背景色跟着新权限变**" "$(f "$(c before)" '.bg')" "$(f "$(c after_write)" '.bg')"
    eq "⑤ 改后背景色 == 该主题下读写色" "$WRITE_BG" "$(f "$(c after_write)" '.bg')"
    eq "⑤ 再改回后文本" "有效 · 只读" "$(f "$(c after_read)" '.text')"
    eq "⑤ 改回后背景色 == 该主题下只读色" "$READ_BG" "$(f "$(c after_read)" '.bg')"
    eq "⑤ 真鼠标一次点中（改回只读）" 1 "$(c down_attempts)"
    eq "运行时异常" "[]" "$(c runtime_errors)"
  done

  line "AC-113 ⑦：视觉证据（$SHOTS）"
  find "$SHOTS" -name '*.png' | sort | sed 's/^/  /'
  # 每个主题 3 张：抽屉整页（含只读+读写同行可见）+ 翻转后的两种状态 ⇒ 2 主题共 6 张
eq "截图齐备（亮 3 + 暗 3）" 6 "$(find "$SHOTS" -name '*.png' 2>/dev/null | wc -l)"

  line "收尾：接口与数据未受影响（本阶段只改样式）"
  eq "GET /api/tokens = 200" 200 "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" "$BASE/api/tokens")"
  eq "迁移版本仍是 v5（本阶段无迁移）" 5 "$(q 'SELECT MAX(version) FROM schema_migrations;')"
  eq "查库：只读那把仍是 read（改权限链路正常）" "read" "$(q "SELECT scope FROM api_tokens WHERE id=$RO_ID;")"
fi

line "结论"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ AC-113 全部通过"
else
  echo "  ❌ 有未通过项（见上方 ❌）"
fi
exit "$FAIL"
