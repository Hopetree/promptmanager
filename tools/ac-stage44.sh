#!/usr/bin/env bash
# 阶段 44 验收自检（FR-106：FIX 移动端令牌页不可用）：
#   AC-108 ① **390×844** 打开令牌抽屉：表格确有溢出（scrollWidth > clientWidth）**且能横向滚动**
#            （scrollLeft 设 9999 后实际变化）；滚到最右「操作」列可见、滚回最左「名称」列可见（贴像素数）
#        ② 创建表单不挤：名称输入框实际宽度 ≥ 120px；权限选择与「创建 token」按钮仍在视口内且真鼠标能建出一行
#        ③ Alert 描述里不再出现 `**`
#        ④ 页面级无横向滚动：document.documentElement.scrollWidth === 390
#        ⑤ 桌面 1600×900 不回归：抽屉 640、表格 scrollWidth === clientWidth（无横滚）、6 列同序、
#            真鼠标点状态列改权限仍可用（只读 → 读写 → 改回）
#        ⑥ 视觉证据：390 亮 + 桌面亮各一张（并各自识图）
#        ⑦ 回归：npm test / ci-check（在脚本外另跑，本脚本也复跑 npm test）
#
# 全程临时 DATA_DIR + 台账范围内备用端口；不碰 8767 测试环境、不碰 106 生产。
# 用法：bash tools/ac-stage44.sh [all|mobile|desktop]
set -u
set -o pipefail

cd "$(dirname "$0")/.." || exit 1
ONLY=${1:-all}
PORT=${PORT:-auto}
AC_PW='ac-fixture-pw-20260923'
AC_USER='admin'
SHOTS='tmp/shots/stage44'
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
ge() { if [ "$3" -ge "$2" ] 2>/dev/null; then pass "$1 = $3（≥ $2）"; else fail "$1 = $3（期望 ≥ $2）"; fi; }
le() { if [ "$3" -le "$2" ] 2>/dev/null; then pass "$1 = $3（≤ $2）"; else fail "$1 = $3（期望 ≤ $2）"; fi; }
gt() { if [ "$3" -gt "$2" ] 2>/dev/null; then pass "$1 = $3（> $2）"; else fail "$1 = $3（期望 > $2）"; fi; }

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
DIR=$(mktemp -d /tmp/pm-ac44-XXXXXX)
DB="$DIR/pm.db"
q() { sqlite3 "$DB" "$1"; }
jget() { printf '%s' "$1" | jq -r "$2"; }

line "构建 + 全量单测（本阶段是纯前端修复，回归为主）"
npm run build >"$DIR/build.log" 2>&1
eq "npm run build 退出码" 0 "$?"
npm test >"$DIR/test.log" 2>&1
eq "npm test 退出码" 0 "$?"
grep -E "^ℹ (tests|pass|fail)" "$DIR/test.log" | sed 's/^/  /'

line "运行时：临时实例（DATA_DIR=$DIR，PORT=$PORT）"
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

  # 夹具：一条 prompt + 三把令牌（只读 / 读写 / 已撤销）—— 列表里**必须有 6 列的真实数据**才量得出列宽
  curl -s -b "$JAR" -o /dev/null -H 'Content-Type: application/json' -d '{"title":"AC108 夹具","user_prompt":"你好 {{姓名}}"}' "$BASE/api/prompts"
  RO_JSON=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"name":"AC108 只读","scope":"read"}' "$BASE/api/tokens")
  RO_ID=$(jget "$RO_JSON" .id)
  RW_JSON=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"name":"AC108 读写","scope":"write"}' "$BASE/api/tokens")
  RW_ID=$(jget "$RW_JSON" .id)
  RV_JSON=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"name":"AC108 待撤销","scope":"read"}' "$BASE/api/tokens")
  RV_ID=$(jget "$RV_JSON" .id)
  # 名字长一点，确保「名称」列真的要截断（更接近真实使用）
  curl -s -b "$JAR" -o /dev/null -H 'Content-Type: application/json' -d '{"name":"AC108 一个相当长的令牌名字用来测截断","scope":"write"}' "$BASE/api/tokens"
  XRV_JSON=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"name":"AC108 要撤销的另一把","scope":"read"}' "$BASE/api/tokens")
  XRV_ID=$(jget "$XRV_JSON" .id)
  curl -s -b "$JAR" -o /dev/null -X DELETE "$BASE/api/tokens/$XRV_ID"
  pass "夹具：只读 id=$RO_ID ｜ 读写 id=$RW_ID ｜ 待撤销 id=$RV_ID ｜ 已撤销 id=$XRV_ID（共 5 行）"
  echo "  \$ sqlite3 pm.db \"SELECT id,name,scope,revoked_at IS NOT NULL FROM api_tokens ORDER BY id;\""
  q "SELECT id, name, scope, revoked_at IS NOT NULL FROM api_tokens ORDER BY id;" | sed 's/^/    /'

  if [ "$ONLY" = "all" ] || [ "$ONLY" = "mobile" ]; then
    line "AC-108 ①②③④：手机 390×844（真浏览器 + 真实视口 + 真鼠标）"
    rm -rf "$SHOTS/mobile"
    node tools/ac-stage44-probe.mjs mobile "$BASE" "$SID" "$SHOTS/mobile" | tee "$DIR/mobile.log"
    m() { grep -m1 "^$1=" "$DIR/mobile.log" | cut -d= -f2-; }

    eq "视口 = 390×844" "390x844" "$(m viewport)"
    eq "innerWidth = 390" 390 "$(m innerWidth)"
    eq "列头仍是 6 列且顺序不变" '["名称","Token","状态","使用","最近使用","操作"]' "$(m heads)"
    ge "列表有真实数据（行数）" 4 "$(m rows)"

    GEO_BEFORE=$(m geo_before)
    echo "  \$ 改前几何：$GEO_BEFORE"
    eq "① 表格**确有溢出**（scrollWidth > clientWidth）" true "$(printf '%s' "$GEO_BEFORE" | jq -r '.scrollWidth > .clientWidth')"
    gt "① 溢出像素（scrollWidth - clientWidth）" 0 "$(printf '%s' "$GEO_BEFORE" | jq -r '.overflow')"
    eq "① 容器确实可横向滚动（overflow-x）" "auto" "$(printf '%s' "$GEO_BEFORE" | jq -r '.canScroll')"
    gt "① scrollLeft 设 9999 后**实际发生变化**" 0 "$(m scroll_applied)"
    eq "① 实际滚到了最大可滚位置" "$(m scroll_max)" "$(m scroll_applied)"

    GEO_RIGHT=$(m geo_right)
    echo "  \$ 滚到最右几何：$GEO_RIGHT"
    eq "① 最右时「操作」列**可见**（右边缘 ≤ 抽屉右边缘）" true "$(printf '%s' "$GEO_RIGHT" | jq -r '.lastRight <= .drawerRight')"
    eq "① 最右时「名称」列已被移出左侧（left < 抽屉左边缘）" true "$(printf '%s' "$GEO_RIGHT" | jq -r '.firstLeft < .drawerLeft')"

    GEO_LEFT=$(m geo_left)
    echo "  \$ 滚回最左几何：$GEO_LEFT"
    eq "① 最左时「名称」列**可见**（左边缘 ≥ 抽屉左边缘）" true "$(printf '%s' "$GEO_LEFT" | jq -r '.firstLeft >= .drawerLeft')"
    eq "① 滚回最左后 scrollLeft = 0" 0 "$(m scroll_back)"

    eq "② 表单在移动端是**竖排**（layout=vertical）" "vertical" "$(m form_layout)"
    ge "② 名称输入框实际宽度" 120 "$(m name_input_width)"
    eq "② 权限选择仍在视口内" true "$(m scope_select_in_view)"
    eq "② 「创建 token」按钮仍在视口内" true "$(m create_button_in_view)"
    eq "② 真鼠标点「创建 token」⇒ 列表 +1（控件真的可用）" true "$(m created)"
    eq "② 创建前后行数" "$(( $(m rows_before_create) + 1 ))" "$(m rows_after_create)"

    eq "③ Alert 描述里不再出现 \`**\`" false "$(m alert_text_has_stars)"
    eq "③ 文案其余部分保留（点状态列切换那句仍在）" 1 "$(printf '%s' "$(m alert_description)" | grep -c '点「状态」列直接切换')"
    eq "④ 页面级无横向滚动（documentElement.scrollWidth）" 390 "$(m doc_scroll_width)"
    eq "④ 页面级无横向滚动（探针内量）" 390 "$(m doc_scroll_width)"
    eq "① 运行时异常" "[]" "$(m runtime_errors)"

    eq "③ 源码里 Alert 描述已无星号" 0 "$(grep -c '只读可搜索 / 查看 / 渲染，读写还能新建、修改、删除；\*\*有效令牌' web/src/components/TokenDrawer.tsx || true)"
  fi

  if [ "$ONLY" = "all" ] || [ "$ONLY" = "desktop" ]; then
    line "AC-108 ⑤：桌面 1600×900（**不得回归**）"
    rm -rf "$SHOTS/desktop"
    AC108_READ_ID="$RO_ID" node tools/ac-stage44-probe.mjs desktop "$BASE" "$SID" "$SHOTS/desktop" | tee "$DIR/desktop.log"
    d() { grep -m1 "^$1=" "$DIR/desktop.log" | cut -d= -f2-; }

    eq "视口 = 1600x900" "1600x900" "$(d viewport)"
    GEO_D=$(d geo_desktop)
    echo "  \$ 桌面几何：$GEO_D"
    eq "⑤ 抽屉宽仍是 640" 640 "$(printf '%s' "$GEO_D" | jq -r '.drawerWidth')"
    eq "⑤ 表格 **scrollWidth === clientWidth**（无横向滚动）" true "$(printf '%s' "$GEO_D" | jq -r '.scrollWidth == .clientWidth')"
    eq "⑤ 无横向滚动 ⇒ scrollLeft 推不动（值仍是 0）" 0 "$(d scroll_applied_desktop)"
    eq "⑤ 列头仍是 6 列且顺序不变" '["名称","Token","状态","使用","最近使用","操作"]' "$(d heads)"
    echo "  \$ 桌面列宽：$(d column_widths)"
    eq "⑤ 6 列都在抽屉内（最后一列右边缘 ≤ 抽屉右边缘）" true "$(printf '%s' "$GEO_D" | jq -r '.lastRight <= .drawerRight')"
    eq "⑤ 桌面表单仍是 inline（一行三件，一字未改）" "inline" "$(d form_layout)"
    eq "⑤ 点状态列前 = 有效 · 只读" "有效 · 只读" "$(d scope_text_before)"
    eq "⑤ 真鼠标菜单两项" '["只读","读写"]' "$(d menu_items)"
    eq "⑤ **点状态列改权限仍可用**（改后 = 有效 · 读写）" "有效 · 读写" "$(d scope_text_after)"
    eq "⑤ 再改回 = 有效 · 只读" "有效 · 只读" "$(d scope_text_restored)"
    eq "⑤ 改权限后桌面仍无横滚" true "$(printf '%s' "$(d geo_desktop_after)" | jq -r '.scrollWidth == .clientWidth')"
    eq "⑤ 运行时异常" "[]" "$(d runtime_errors)"
    eq "⑤ 库里改回后仍是 read" "read" "$(q "SELECT scope FROM api_tokens WHERE id=$RO_ID;")"
    eq "⑤ 移动端与桌面共用一个 Alert（都无星号）" false "$(d alert_text_has_stars)"
  fi

  line "⑥ 视觉证据（$SHOTS）"
  find "$SHOTS" -name '*.png' | sort | sed 's/^/  /'
  # 只跑单档时按该档的应有张数核（移动端 3 张 / 桌面 1 张），all 时核总数
  SHOT_EXPECT=0
  { [ "$ONLY" = "all" ] || [ "$ONLY" = "mobile" ]; } && SHOT_EXPECT=$((SHOT_EXPECT + 3))
  { [ "$ONLY" = "all" ] || [ "$ONLY" = "desktop" ]; } && SHOT_EXPECT=$((SHOT_EXPECT + 1))
  eq "截图齐备（本档应有 $SHOT_EXPECT 张）" "$SHOT_EXPECT" "$(find "$SHOTS" -name '*.png' 2>/dev/null | wc -l)"

  line "收尾：既有令牌接口未受影响（本阶段只改前端）"
  eq "GET /api/tokens = 200" 200 "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" "$BASE/api/tokens")"
  eq "迁移版本仍是 v5（本阶段无迁移）" 5 "$(q 'SELECT MAX(version) FROM schema_migrations;')"
fi

line "结论"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ AC-108 全部通过"
else
  echo "  ❌ 有未通过项（见上方 ❌）"
fi
exit "$FAIL"
