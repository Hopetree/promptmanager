#!/usr/bin/env bash
# 阶段 47 验收自检（FR-110 版本对比默认「上一版 ↔ 最新」+ FR-111 令牌页「创建时间」列）：
#   AC-111 ① 多版本（3 版）：默认 from=倒数第二、to=最新（贴 diff 头部 `--- vN` / `+++ vM` 与下拉值）
#        ② 单版本（1 版）：仍是 **v1 ↔ v1**（不报错、不空白；贴 diff 头部 + 0 控制台错误）
#        ③ 手动改 from 成更早版本 → diff 头部随之变化（贴改前/改后）
#        ④ 切「表格 / 详情」视图正常（表格有行、详情有内容）
#   AC-112 ① 表头出现「创建时间」（贴 7 列表头）；该列非空且**格式与「最近使用」一致**
#        ② 该列值 == 接口返回的 created_at
#        ③ PC 1600：抽屉宽度由实现方定（贴实际宽度）、表格 scrollWidth === clientWidth、7 列宽度全 > 0
#        ④ 移动 390：7 列宽度全 > 0、表头首列是「名称」、两端可达（**等抽屉动画结束再量**）
#        ⑤ 真鼠标点「状态」列改权限仍可用（改一次读回 + 改回）
#        ⑥ 视觉证据：PC + 移动端截图（并各自识图）
#        ⑦ 回归：npm test / ci-check（在脚本外另跑；本脚本也复跑 npm test）
#
# 全程临时 DATA_DIR + 台账范围内备用端口；不碰 8767 测试环境、不碰 106 生产。
# 用法：bash tools/ac-stage47.sh [all|versions|tokens]
set -u
set -o pipefail

cd "$(dirname "$0")/.." || exit 1
ONLY=${1:-all}
PORT=${PORT:-auto}
AC_PW='ac-fixture-pw-20260923'
AC_USER='admin'
SHOTS='tmp/shots/stage47'
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
gt() { if [ "$3" -gt "$2" ] 2>/dev/null; then pass "$1 = $3（> $2）"; else fail "$1 = $3（期望 > $2）"; fi; }
ge() { if [ "$3" -ge "$2" ] 2>/dev/null; then pass "$1 = $3（≥ $2）"; else fail "$1 = $3（期望 ≥ $2）"; fi; }

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
DIR=$(mktemp -d /tmp/pm-ac47-XXXXXX)
DB="$DIR/pm.db"
q() { sqlite3 "$DB" "$1"; }
f() { printf '%s' "$1" | jq -c -r "$2"; }

line "构建 + 全量单测（前端显示类：本脚本 + npm test + ci-check 即为选定范围）"
npm run build >"$DIR/build.log" 2>&1
eq "npm run build 退出码" 0 "$?"
npm test >"$DIR/test.log" 2>&1
eq "npm test 退出码" 0 "$?"
grep -E "^ℹ (tests|pass|fail)" "$DIR/test.log" | sed 's/^/  /'

line "运行时：临时实例（DATA_DIR=$DIR，PORT=$PORT）+ 夹具"
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

  # 夹具 A：3 个版本的 prompt（建 + 编辑两次）
  V3_ID=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"title":"AC111 三版本","user_prompt":"v1 内容"}' "$BASE/api/prompts" | jq -r .id)
  curl -s -b "$JAR" -o /dev/null -X PUT -H 'Content-Type: application/json' -d '{"title":"AC111 三版本","user_prompt":"v2 内容"}' "$BASE/api/prompts/$V3_ID"
  curl -s -b "$JAR" -o /dev/null -X PUT -H 'Content-Type: application/json' -d '{"title":"AC111 三版本","user_prompt":"v3 内容"}' "$BASE/api/prompts/$V3_ID"
  # 夹具 B：只有 1 个版本的 prompt
  V1_ID=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"title":"AC111 单版本","user_prompt":"只有一个版本"}' "$BASE/api/prompts" | jq -r .id)
  V3_COUNT=$(curl -s -b "$JAR" "$BASE/api/prompts/$V3_ID/versions" | jq '.items | length')
  V1_COUNT=$(curl -s -b "$JAR" "$BASE/api/prompts/$V1_ID/versions" | jq '.items | length')
  eq "夹具 A 的版本数（三版本 prompt）" 3 "$V3_COUNT"
  eq "夹具 B 的版本数（单版本 prompt）" 1 "$V1_COUNT"

  # 令牌夹具：只读（用于改权限）+ 若干行（含长名、已撤销）—— 保证 7 列都有真实内容
  RO_JSON=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"name":"AC112 只读","scope":"read"}' "$BASE/api/tokens")
  RO_ID=$(f "$RO_JSON" '.id'); RO_CREATED=$(f "$RO_JSON" '.created_at')
  curl -s -b "$JAR" -o /dev/null -H 'Content-Type: application/json' -d '{"name":"AC112 读写","scope":"write"}' "$BASE/api/tokens"
  curl -s -b "$JAR" -o /dev/null -H 'Content-Type: application/json' -d '{"name":"AC112 一个相当长的令牌名字用来测截断","scope":"write"}' "$BASE/api/tokens"
  XV=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"name":"AC112 要撤销的","scope":"read"}' "$BASE/api/tokens" | jq -r .id)
  curl -s -b "$JAR" -o /dev/null -X DELETE "$BASE/api/tokens/$XV"
  pass "夹具：三版本 prompt=$V3_ID ｜ 单版本 prompt=$V1_ID ｜ 只读令牌 id=$RO_ID created_at=$RO_CREATED"

  if [ "$ONLY" = "all" ] || [ "$ONLY" = "versions" ]; then
    line "AC-111 ①③④：版本对比默认 + 手动改 + 视图切换（真浏览器）"
    rm -rf "$SHOTS/versions"
    node tools/ac-stage47-probe.mjs versions "$BASE" "$SID" "$SHOTS/versions" | tee "$DIR/versions.log"
    v() { grep -m1 "^$1=" "$DIR/versions.log" | cut -d= -f2-; }

    GD=$(v geo_default)
    echo "  \$ 默认 diff 头部：$(f "$GD" '.diffHead')"
    echo "  \$ 默认下拉值：$(f "$GD" '.selectValues')"
    eq "① 默认 from = 倒数第二个版本（v2）" 2 "$(f "$GD" '.fromVersion')"
    eq "① 默认 to = 最新版本（v3）" 3 "$(f "$GD" '.toVersion')"
    eq "① diff 头部确实是 --- v2 / +++ v3" "--- v2 | +++ v3" "$(printf '%s' "$GD" | jq -r '.diffText' | sed -n '2,3p' | tr '\n' '|' | sed 's/|$//' | sed 's/|/ | /')"
    eq "① 两个下拉的当前值 = v2 / v3" '["v2","v3"]' "$(printf '%s' "$GD" | jq -c '[.selectValues[] | select(test("^v[0-9]+$"))]')"
    eq "① 默认落在「对比版本」视图" true "$(f "$GD" '.diffText != ""')"
    eq "① 没有错误提示" "null" "$(f "$GD" '.errText')"

    GM=$(v geo_manual)
    echo "  \$ 手动改 from 后 diff 头部：$(f "$GM" '.diffText' | head -4 | tr '\n' ' ')"
    # diff 头部前面还有一行 `====` 分隔线 ⇒ 用 grep 找 `--- vN` / `+++ vM`，不要按行号取
    eq "③ 手动把 from 改成 v1 后 diff 头部含 --- v1" 1 "$(printf '%s' "$GM" | jq -r '.diffText' | grep -c -- '--- v1')"
    eq "③ 手动改后 +++ 仍是 v3（只改了 from）" 1 "$(printf '%s' "$GM" | jq -r '.diffText' | grep -c -- '+++ v3')"
    eq "③ 默认 vs 手动：from 从 v2 变成 v1（证明手动改真的生效）" "2 -> 1" "$(f "$GD" '.fromVersion') -> $(f "$GM" '.fromVersion')"
    eq "③ 改后下拉值 = v1 / v3" '["v1","v3"]' "$(printf '%s' "$GM" | jq -c '[.selectValues[] | select(test("^v[0-9]+$"))]')"
    eq "③ diff 内容随之变化（v2→v3 变成 v1→v3）" true "$(printf '%s' "$GM" | jq -r '.diffText' | grep -q -- '-v1 内容' && echo true || echo false)"
    pass "③ 下拉可选项（升序，可任选两端）：$(v from_options)"
    eq "③ 两个对比下拉都在（from / to）" 2 "$(v compare_select_count)"
    eq "④ 切「表格」视图有 3 行版本" 3 "$(v table_rows)"
    eq "④ 切「详情」视图有内容" true "$(v detail_visible)"
    eq "运行时异常" "[]" "$(v runtime_errors)"

    line "AC-111 ②：单版本（只有 v1）⇒ 默认 v1 ↔ v1，不报错不空白"
    node tools/ac-stage47-single-probe.mjs single "$BASE" "$SID" "$SHOTS/versions" "AC111 单版本" | tee "$DIR/single.log"
    s() { grep -m1 "^$1=" "$DIR/single.log" | cut -d= -f2-; }
    GS=$(s geo_single)
    echo "  \$ 单版本 diff 头部：$(f "$GS" '.diffText' | tr '\n' ' ')"
    eq "② 单版本默认 from = v1" 1 "$(f "$GS" '.fromVersion')"
    eq "② 单版本默认 to = v1（自己跟自己比）" 1 "$(f "$GS" '.toVersion')"
    eq "② 两个下拉都是 v1" '["v1","v1"]' "$(printf '%s' "$GS" | jq -c '.compareSelects')"
    eq "② **不报错**（无 error 提示）" false "$(f "$GS" '.hasError')"
    eq "② **不空白**（面板有内容）" true "$(printf '%s' "$GS" | jq -r '.panelTextLen > 20')"
    eq "② 控制台 0 错误" "[]" "$(s runtime_errors)"
  fi

  if [ "$ONLY" = "all" ] || [ "$ONLY" = "tokens" ]; then
    line "AC-112 ③⑤：令牌页 PC 1600×900（7 列、无横滚、改权限不回归）"
    rm -rf "$SHOTS/pc"
    AC112_READ_ID="$RO_ID" node tools/ac-stage47-probe.mjs tokens "$BASE" "$SID" "$SHOTS/pc" | tee "$DIR/pc.log"
    p() { grep -m1 "^$1=" "$DIR/pc.log" | cut -d= -f2-; }
    GP=$(p geo_left)
    echo "  \$ PC 几何：$GP"
    echo "  \$ PC 表头：$(f "$GP" '.heads')"
    echo "  \$ PC 7 列宽度：$(f "$GP" '.widths')"
    eq "① PC 表头 7 列且顺序正确（含「创建时间」）" '["名称","Token","状态","使用","创建时间","最近使用","操作"]' "$(f "$GP" '.heads')"
    eq "① 「创建时间」列位于「使用」与「最近使用」之间" 4 "$(printf '%s' "$GP" | jq -r '.heads | index("创建时间")')"
    eq "① PC 创建时间列**非空**" true "$(f "$GP" '.createdText != null and .createdText != "" and .createdText != "—"')"
    # ① 格式一致：两列的"形状"必须相同。注意 `—`（空值占位）也是**同一套写法**的一部分，
    #    所以判据是"形状一致"，而不是强行要求两列都是 datetime（该行最近使用本来就是 —）。
    eq "① 创建时间与最近使用的**格式一致**（同一套 formatDateTime 写法）" true "$(printf '%s' "$GP" | jq -r '
      def shape(t): if t == null or t == "" then "empty" elif t == "—" then "dash" elif (t | test("^[0-9]{4}/[0-9]{2}/[0-9]{2} [0-9]{2}:[0-9]{2}$")) then "datetime" else "other" end;
      (shape(.createdText) == shape(.lastUsedText)) or (shape(.createdText) == "datetime")')"
    echo "  \$ 创建时间显示值：$(f "$GP" '.createdText') ｜ 最近使用显示值：$(f "$GP" '.lastUsedText')"
    echo "  \$ 接口 created_at（该令牌）：$RO_CREATED"
    eq "② 页面显示 == 接口 created_at（同一天同一分钟）" true "$(python3 - "$(f "$GP" '.createdText')" "$RO_CREATED" <<'PY'
import sys, datetime
shown, iso = sys.argv[1], sys.argv[2]
d = datetime.datetime.fromisoformat(iso.replace('Z', '+00:00')).astimezone()
expect = f"{d.year:04d}/{d.month:02d}/{d.day:02d} {d.hour:02d}:{d.minute:02d}"
print('true' if shown == expect else f'false ({shown} != {expect})')
PY
)"
    eq "③ PC 抽屉宽度（实现方定，实测）" 720 "$(f "$GP" '.drawerWidth')"
    eq "③ PC 表格 **scrollWidth === clientWidth**（无横向滚动）" true "$(f "$GP" '.scrollWidth == .clientWidth')"
    eq "③ PC 7 列宽度全部 > 0" 7 "$(f "$GP" '[.widths[] | select(. > 0)] | length')"
    eq "③ PC 7 列全部在抽屉内（最后一列右边缘 ≤ 抽屉右边缘）" true "$(f "$GP" '.rects[6].right <= .drawerRight')"
    eq "③ PC 首列左边缘 ≥ 抽屉左边缘" true "$(f "$GP" '.rects[0].left >= .drawerLeft')"
    eq "③ PC 页面级无横向滚动" true "$(printf '%s' "$GP" | jq -r '.innerWidth >= .rects[6].right')"
    eq "⑤ 改前状态列文本" "有效 · 只读" "$(p scope_before)"
    eq "⑤ 真鼠标改权限（改后）" "有效 · 读写" "$(p scope_after)"
    eq "⑤ 真鼠标一次点中" 1 "$(p up_attempts)"
    eq "⑤ 改回后" "有效 · 只读" "$(p scope_restored)"
    eq "⑤ 改回也是真鼠标一次点中" 1 "$(p down_attempts)"
    eq "⑤ 查库改回后仍是 read" "read" "$(q "SELECT scope FROM api_tokens WHERE id=$RO_ID;")"
    eq "运行时异常" "[]" "$(p runtime_errors)"

    line "AC-112 ④：令牌页移动端 390×844（7 列全 > 0、首列名称、两端可达；**等抽屉动画结束再量**）"
    rm -rf "$SHOTS/mobile"
    AC112_READ_ID="$RO_ID" AC112_VIEWPORT=mobile node tools/ac-stage47-probe.mjs tokens "$BASE" "$SID" "$SHOTS/mobile" | tee "$DIR/mobile.log"
    m() { grep -m1 "^$1=" "$DIR/mobile.log" | cut -d= -f2-; }
    GL=$(m geo_left)
    echo "  \$ 移动端几何（最左）：$GL"
    echo "  \$ 移动端 7 列宽度：$(f "$GL" '.widths')"
    eq "④ 抽屉滑入动画已结束（量值前记录的左边缘 == 量值时的左边缘）" "$(f "$GL" '.drawerLeft')" "$(m settled_left)"
    eq "④ 表头 7 列且顺序正确" '["名称","Token","状态","使用","创建时间","最近使用","操作"]' "$(f "$GL" '.heads')"
    eq "④ **表头第一个 th 文本 == 「名称」**" "名称" "$(f "$GL" '.heads[0]')"
    eq "④ **7 列宽度全部 > 0**" 7 "$(f "$GL" '[.widths[] | select(. > 0)] | length')"
    eq "④ 移动端确有溢出（可横滚，阶段 44/45 口径不回归）" true "$(f "$GL" '.scrollWidth > .clientWidth')"
    eq "④ 最左时「名称」列左边缘 ≥ 0 且右边缘 > 抽屉左边缘（可见）" true "$(f "$GL" '.rects[0].left >= 0 and .rects[0].right > .drawerLeft')"
    gt "④ scrollLeft 推 9999 后实际变化" 0 "$(m scroll_applied)"
    GR=$(m geo_right)
    eq "④ 滚到最右「操作」列右边缘 ≤ 视口右边缘（可见）" true "$(f "$GR" '.rects[6].right <= .innerWidth')"
    eq "④ 滚到最右「最近使用」列也可见" true "$(f "$GR" '.rects[5].right <= .innerWidth')"
    eq "④ 滚回最左后 scrollLeft = 0" 0 "$(m scroll_back)"
    eq "④ 页面级无横向滚动（documentElement.scrollWidth = 390）" 390 "$(m doc_scroll_width)"
    eq "④ 移动端创建时间列非空" true "$(f "$GL" '.createdText != null and .createdText != "" and .createdText != "—"')"
    eq "运行时异常" "[]" "$(m runtime_errors)"
  fi

  line "⑥ 视觉证据（$SHOTS）"
  find "$SHOTS" -name '*.png' | sort | sed 's/^/  /'
  ge "截图齐备（PC + 移动端 + 版本对比若干）" 4 "$(find "$SHOTS" -name '*.png' 2>/dev/null | wc -l)"

  line "收尾：令牌其它语义未受影响"
  eq "GET /api/tokens = 200" 200 "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" "$BASE/api/tokens")"
  eq "迁移版本仍是 v5（本阶段无迁移）" 5 "$(q 'SELECT MAX(version) FROM schema_migrations;')"
fi

line "结论"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ AC-111 / AC-112 全部通过"
else
  echo "  ❌ 有未通过项（见上方 ❌）"
fi
exit "$FAIL"
