#!/usr/bin/env bash
# 阶段 45 验收自检（FR-107：FIX 移动端令牌表「名称」列被压成 0 宽）：
#   AC-109 ① **390×844**（**等抽屉动画结束再量**）：6 列 width 全部 > 0、「名称」列 ≥ 60px、
#            表头第一个 th 文本 == 「名称」（贴 6 个宽度 + 表头数组）
#        ② 两端可达：初始最左「名称」列 left ≥ 0 且 right > 抽屉左边缘；滚到最右「操作」列 right ≤ 视口右边缘
#        ③ 不丢数据：首行「名称」单元格文本非空，且 == API 返回的该行 name
#        ④ 桌面 1600×900 不回归：抽屉 640、表格 scrollWidth === clientWidth、6 列宽度全 > 0、
#            名称列完整、真鼠标点状态列改权限仍可用（只读 → 读写 → 改回）
#        ⑤ 页面级不横滚：document.documentElement.scrollWidth === 390
#        ⑥ 视觉证据：390 最左 + 390 最右 + 桌面 各一张（并各自识图）
#        ⑦ 回归：npm test（本脚本复跑）/ ci-check（在脚本外另跑）
#
# 全程临时 DATA_DIR + 台账范围内备用端口；不碰 8767 测试环境、不碰 106 生产。
# 用法：bash tools/ac-stage45.sh [all|mobile|desktop]
set -u
set -o pipefail

cd "$(dirname "$0")/.." || exit 1
ONLY=${1:-all}
PORT=${PORT:-auto}
AC_PW='ac-fixture-pw-20260923'
AC_USER='admin'
SHOTS='tmp/shots/stage45'
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
DIR=$(mktemp -d /tmp/pm-ac45-XXXXXX)
DB="$DIR/pm.db"
q() { sqlite3 "$DB" "$1"; }
jget() { printf '%s' "$1" | jq -r "$2"; }
# 从探针 JSON 里取字段（`-c` 紧凑输出：探针里的 `heads` 是数组，默认 jq 会多行美化，与断言字面量对不上）
f() { printf '%s' "$1" | jq -c -r "$2"; }

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

  # 夹具：一条 prompt + 5 把令牌（含一把长名字、一把已撤销）—— 名称列要有真实内容才量得出"丢没丢"
  curl -s -b "$JAR" -o /dev/null -H 'Content-Type: application/json' -d '{"title":"AC109 夹具","user_prompt":"你好 {{姓名}}"}' "$BASE/api/prompts"
  RO_JSON=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"name":"AC109 只读","scope":"read"}' "$BASE/api/tokens")
  RO_ID=$(jget "$RO_JSON" .id)
  RO_NAME=$(jget "$RO_JSON" .name)
  curl -s -b "$JAR" -o /dev/null -H 'Content-Type: application/json' -d '{"name":"AC109 读写","scope":"write"}' "$BASE/api/tokens"
  curl -s -b "$JAR" -o /dev/null -H 'Content-Type: application/json' -d '{"name":"AC109 待撤销","scope":"read"}' "$BASE/api/tokens"
  curl -s -b "$JAR" -o /dev/null -H 'Content-Type: application/json' -d '{"name":"AC109 一个相当长的令牌名字用来测截断","scope":"write"}' "$BASE/api/tokens"
  XRV=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"name":"AC109 要撤销的另一把","scope":"read"}' "$BASE/api/tokens" | jq -r .id)
  curl -s -b "$JAR" -o /dev/null -X DELETE "$BASE/api/tokens/$XRV"
  pass "夹具：只读 id=$RO_ID name=$RO_NAME ｜ 共 5 行（第 1 行就是它，探针比对名称文本用它）"

  if [ "$ONLY" = "all" ] || [ "$ONLY" = "mobile" ]; then
    line "AC-109 ①②③⑤：手机 390×844（真浏览器 + 真实视口；**等抽屉动画结束再量**）"
    rm -rf "$SHOTS/mobile"
    node tools/ac-stage45-probe.mjs mobile "$BASE" "$SID" "$SHOTS/mobile" | tee "$DIR/mobile.log"
    m() { grep -m1 "^$1=" "$DIR/mobile.log" | cut -d= -f2-; }

    eq "视口 = 390×844" "390x844" "$(m viewport)"

    GL=$(m geo_left)
    echo "  \$ 初始（最左）逐列几何：$GL"
    echo "  \$ 表头：$(f "$GL" '.heads')"
    echo "  \$ 6 列宽度：$(f "$GL" '.widths')"
    echo "  \$ 6 列 left/right：$(f "$GL" '.rects')"
    # 动画结束的证据：探针在**量值之前**记录的抽屉左边缘，必须与随后 geo 里的 drawerLeft 一致
    eq "① 抽屉滑入动画**已结束**（量值前记录的左边缘 == 量值时的左边缘，不是中间态）" \
      "$(f "$GL" '.drawerLeft')" "$(m drawer_animation_settled_left)"
    eq "① 表头仍是 6 列且顺序不变" '["名称","Token","状态","使用","最近使用","操作"]' "$(f "$GL" '.heads')"
    eq "① **表头第一个 th 文本 == 「名称」**" "名称" "$(f "$GL" '.heads[0]')"
    eq "① **6 列宽度全部 > 0**" 6 "$(f "$GL" '[.widths[] | select(. > 0)] | length')"
    ge "① 「名称」列宽度" 60 "$(f "$GL" '.widths[0]')"
    eq "① 「名称」列 left == right（宽 0）的旧缺陷**已消失**" true "$(f "$GL" '.widths[0] > 0')"
    eq "① 其余 5 列宽度都 > 0（逐列）" true "$(f "$GL" '(.widths[1:] | map(. > 0) | all)')"
    eq "① 表格确有溢出（scrollWidth > clientWidth，390 下必然）" true "$(f "$GL" '.scrollWidth > .clientWidth')"
    eq "① 溢出量" "$(f "$GL" '.scrollWidth - .clientWidth')" "$(m scroll_applied)"

    # ② 两端可达
    eq "② 初始最左：「名称」列左边缘 ≥ 0" true "$(f "$GL" '.rects[0].left >= 0')"
    eq "② 初始最左：「名称」列右边缘 > 抽屉左边缘（**可见**）" true "$(f "$GL" '.rects[0].right > .drawerLeft')"
    eq "② 初始最左：「Token」「状态」列也可见" true "$(f "$GL" '.rects[1].left < .drawerRight and .rects[2].left < .drawerRight')"
    GR=$(m geo_right)
    echo "  \$ 滚到最右逐列几何：$GR"
    gt "② scrollLeft 推 9999 后实际变化" 0 "$(m scroll_applied)"
    eq "② 滚到最右：「操作」列右边缘 ≤ 视口右边缘（**可见**）" true "$(f "$GR" '.rects[5].right <= .innerWidth')"
    eq "② 滚到最右：「最近使用」列也可见" true "$(f "$GR" '.rects[4].right <= .innerWidth')"
    eq "② 滚到最右后「名称」列被裁在左侧（说明真的滚过去了）" true "$(f "$GR" '.rects[0].right < .drawerLeft')"
    eq "② 滚回最左后 scrollLeft = 0" 0 "$(m scroll_back)"
    eq "② 滚回最左后「名称」列仍可见（宽 > 0）" true "$(f "$(m geo_left_again)" '.widths[0] > 0')"

    # ③ 不丢数据
    eq "③ 首行「名称」单元格文本非空" true "$(f "$GL" '.nameText != ""')"
    eq "③ 首行「名称」文本 == API 返回的该行 name" "$RO_NAME" "$(f "$GL" '.nameText')"
    eq "⑤ 页面级无横向滚动（documentElement.scrollWidth）" 390 "$(m doc_scroll_width)"
    eq "列表有真实数据（行数）" 5 "$(m rows)"
    eq "运行时异常" "[]" "$(m runtime_errors)"
  fi

  if [ "$ONLY" = "all" ] || [ "$ONLY" = "desktop" ]; then
    line "AC-109 ④：桌面 1600×900（**不得回归**）"
    rm -rf "$SHOTS/desktop"
    AC109_READ_ID="$RO_ID" node tools/ac-stage45-probe.mjs desktop "$BASE" "$SID" "$SHOTS/desktop" | tee "$DIR/desktop.log"
    d() { grep -m1 "^$1=" "$DIR/desktop.log" | cut -d= -f2-; }

    eq "视口 = 1600x900" "1600x900" "$(d viewport)"
    GD=$(d geo_left)
    echo "  \$ 桌面逐列几何：$GD"
    echo "  \$ 6 列宽度：$(f "$GD" '.widths')"
    echo "  \$ 6 列 left/right：$(f "$GD" '.rects')"
    eq "④ 抽屉宽仍是 640" 640 "$(f "$GD" '.drawerWidth')"
    eq "④ 表格 **scrollWidth === clientWidth**（无横向滚动）" true "$(f "$GD" '.scrollWidth == .clientWidth')"
    eq "④ 6 列宽度全部 > 0" 6 "$(f "$GD" '[.widths[] | select(. > 0)] | length')"
    ge "④ 「名称」列宽度（桌面应比下限宽得多）" 60 "$(f "$GD" '.widths[0]')"
    eq "④ 6 列全部在抽屉内（最后一列右边缘 ≤ 抽屉右边缘）" true "$(f "$GD" '.rects[5].right <= .drawerRight')"
    eq "④ 6 列都在视口内（左起第一列 left ≥ 抽屉左边缘）" true "$(f "$GD" '.rects[0].left >= .drawerLeft')"
    eq "④ 名称列显示完整（短名字不出现省略号）" "AC109 只读" "$(f "$GD" '.nameText')"
    eq "④ 名称列的 title 是完整原名（超长名可悬停看全）" "AC109 只读" "$(f "$GD" '.nameTextFull')"
    eq "④ 表头仍是 6 列且顺序不变" '["名称","Token","状态","使用","最近使用","操作"]' "$(f "$GD" '.heads')"
    eq "④ 桌面表单仍无横滚（改权限后复测）" true "$(f "$(d geo_after_scope_change)" '.scrollWidth == .clientWidth')"
    eq "④ 点状态列前 = 有效 · 只读" "有效 · 只读" "$(d scope_text_before)"
    eq "④ 真鼠标菜单两项" '["只读","读写"]' "$(d menu_items)"
    eq "④ **点状态列改权限仍可用**（改后 = 有效 · 读写）" "有效 · 读写" "$(d scope_text_after)"
    eq "④ 真鼠标一次点中（改读写）" 1 "$(d up_attempts)"
    eq "④ 再改回 = 有效 · 只读" "有效 · 只读" "$(d scope_text_restored)"
    eq "④ 查库改回后仍是 read" "read" "$(q "SELECT scope FROM api_tokens WHERE id=$RO_ID;")"
    eq "④ 运行时异常" "[]" "$(d runtime_errors)"
  fi

  line "⑥ 视觉证据（$SHOTS）"
  find "$SHOTS" -name '*.png' | sort | sed 's/^/  /'
  SHOT_EXPECT=0
  { [ "$ONLY" = "all" ] || [ "$ONLY" = "mobile" ]; } && SHOT_EXPECT=$((SHOT_EXPECT + 2))
  { [ "$ONLY" = "all" ] || [ "$ONLY" = "desktop" ]; } && SHOT_EXPECT=$((SHOT_EXPECT + 1))
  eq "截图齐备（本档应有 $SHOT_EXPECT 张）" "$SHOT_EXPECT" "$(find "$SHOTS" -name '*.png' 2>/dev/null | wc -l)"

  line "收尾：既有能力未受影响（本阶段只改列宽定义）"
  eq "GET /api/tokens = 200" 200 "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" "$BASE/api/tokens")"
  eq "迁移版本仍是 v5（本阶段无迁移）" 5 "$(q 'SELECT MAX(version) FROM schema_migrations;')"
fi

line "结论"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ AC-109 全部通过"
else
  echo "  ❌ 有未通过项（见上方 ❌）"
fi
exit "$FAIL"
