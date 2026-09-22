#!/usr/bin/env bash
# 阶段 41 验收自检（FR-102 FIX：编辑保存后返回详情，版本历史仍是旧的）：
#   AC-104 ① 真鼠标改备注 → 保存 → 点「返回详情」（**不刷新页面**）：版本列表条数 +1、最上方 = 新版本号
#        ② 再按 F5：条数/最新版本号与 ① 相同
#        ③ 详情上的版本号 == 版本列表最上方版本号
#        ④ 回滚不回归：点回滚 → 二次确认 → 版本列表立即多出新版本
#        ⑤ 移动端（390 宽）走详情抽屉路径重复 ①
#        ⑥ 无多余请求：回详情后反复切「用户/系统提示词」「源码/预览」⇒ /versions 请求数不增加
#        ⑦ 回归：npm test / ci-check（在脚本外另跑）；版本面板 对比/详情/备注/回滚 手工点一遍仍可用（探针覆盖回滚）
#
# 服务**自起自停**（临时 DATA_DIR + 台账范围内备用端口）；不碰 8767 测试环境、不碰 106 生产。
# 用法：bash tools/ac-stage41.sh [all|edit|regress]
set -u
set -o pipefail

cd "$(dirname "$0")/.." || exit 1
ONLY=${1:-all}
PORT=${PORT:-auto}
AC_PW='ac-fixture-pw-20260918'
AC_USER='admin'
SHOTS='tmp/shots/stage41'
FIXTURE_TITLE='AC104 版本刷新夹具'
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
DIR=$(mktemp -d /tmp/pm-ac41-XXXXXX)
DB="$DIR/pm.db"
q() { sqlite3 "$DB" "$1"; }

line "构建 + 本阶段单测"
npm run build >"$DIR/build.log" 2>&1
eq "npm run build 退出码" 0 "$?"
node --test tests/stage41-version-refresh.test.ts >"$DIR/unit.log" 2>&1
eq "新单测退出码" 0 "$?"
grep -E "^ℹ (tests|pass|fail)" "$DIR/unit.log" | sed 's/^/  /'

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

  # 夹具：一条既有 prompt（改它来产生新版本）
  FIX_JSON=$(python3 -c "
import json,sys
print(json.dumps({'title': sys.argv[1], 'user_prompt': '这是 AC104 的正文 {{变量}}', 'system_prompt': '系统角色', 'notes': '初始备注'}, ensure_ascii=False))
" "$FIXTURE_TITLE" | curl -s -b "$JAR" -H 'Content-Type: application/json' -d @- "$BASE/api/prompts")
  FIX_ID=$(echo "$FIX_JSON" | jq -r .id)
  FIX_VER=$(echo "$FIX_JSON" | jq -r .version_no)
  pass "夹具：id=$FIX_ID title=$FIXTURE_TITLE 初始 version_no=$FIX_VER"

  if [ "$ONLY" = "all" ] || [ "$ONLY" = "edit" ]; then
    line "AC-104：真浏览器（改 → 保存 → 返回详情，不刷新页面）"
    rm -rf "$SHOTS"
    AC104_TITLE="$FIXTURE_TITLE" node tools/ac-stage41-probe.mjs edit "$BASE" "$SID" "$SHOTS" | tee "$DIR/probe.log"
    p() { grep -m1 "^$1=" "$DIR/probe.log" | cut -d= -f2-; }

    echo "  ① 改前：条数=$(p before_count) 最上方 v$(p before_top) 详情版本 v$(p before_detail_version)"
    echo "  ① 改后：条数=$(p after_count) 最上方 v$(p after_top) 详情版本 v$(p after_detail_version)"
    pass "  ① 详情头部原样：$(p after_head)"
    eq "① 全程**没有刷新页面**（导航次数 = 1）" 1 "$(p page_navigations)"
    eq "① 版本列表条数 = 改前 + 1" "true" "$(python3 -c "
import sys
print('true' if int(sys.argv[1]) == int(sys.argv[2]) + 1 else 'false')
" "$(p after_count)" "$(p before_count)")"
    eq "① 最上方版本号 = 改前 + 1（即新版本）" "true" "$(python3 -c "
import sys
print('true' if int(sys.argv[1]) == int(sys.argv[2]) + 1 else 'false')
" "$(p after_top)" "$(p before_top)")"

    eq "② F5 后条数与 ① 相同" "$(p after_count)" "$(p f5_count)"
    eq "② F5 后最新版本号与 ① 相同" "$(p after_top)" "$(p f5_top)"
    eq "③ 详情版本号 == 列表最上方版本号（改后）" "$(p after_top)" "$(p after_detail_version)"
    eq "③ 详情版本号 == 列表最上方版本号（F5 后）" "$(p f5_top)" "$(p f5_detail_version)"

    eq "⑥ 切字段/切源码预览**不产生** /versions 请求" "$(p versions_requests_before_toggles)" "$(p versions_requests_after_toggles)"
    pass "⑥ /versions 请求数（切按钮前 / 后）：$(p versions_requests_before_toggles) / $(p versions_requests_after_toggles)"

    echo "  ④ 回滚前：条数=$(p rollback_before_count) 最上方 v$(p rollback_before_top)（回滚到 v$(p rollback_target)）"
    echo "  ④ 回滚后：条数=$(p rollback_after_count) 最上方 v$(p rollback_after_top) 详情版本 v$(p rollback_after_detail_version)"
    pass "  ④ 回滚二次确认：$(p rollback_confirm_text)"
    eq "④ 回滚后版本列表条数 +1（现有行为不回归）" "true" "$(python3 -c "
import sys
print('true' if int(sys.argv[1]) == int(sys.argv[2]) + 1 else 'false')
" "$(p rollback_after_count)" "$(p rollback_before_count)")"
    eq "④ 回滚后最上方是新版本号" "true" "$(python3 -c "
import sys
print('true' if int(sys.argv[1]) == int(sys.argv[2]) + 1 else 'false')
" "$(p rollback_after_top)" "$(p rollback_before_top)")"

    echo "  ⑤ 移动端（390 宽）改前：条数=$(p mobile_before_count) 最上方 v$(p mobile_before_top)"
    echo "  ⑤ 移动端改后：条数=$(p mobile_after_count) 最上方 v$(p mobile_after_top) 详情版本 v$(p mobile_after_detail_version)"
    eq "⑤ 移动端条数 = 改前 + 1" "true" "$(python3 -c "
import sys
print('true' if int(sys.argv[1]) == int(sys.argv[2]) + 1 else 'false')
" "$(p mobile_after_count)" "$(p mobile_before_count)")"
    eq "⑤ 移动端最上方 = 新版本号" "true" "$(python3 -c "
import sys
print('true' if int(sys.argv[1]) == int(sys.argv[2]) + 1 else 'false')
" "$(p mobile_after_top)" "$(p mobile_before_top)")"
    eq "⑤ 移动端详情版本号与列表一致" "$(p mobile_after_top)" "$(p mobile_after_detail_version)"
    eq "页面运行时异常" "[]" "$(p ac41_runtime_errors)"

    line "截图（$SHOTS）"
    ls -l "$SHOTS" | sed 's/^/  /'
    eq "截图齐备（保存后 / 回滚后 / 移动端 = 3）" 3 "$(find "$SHOTS" -name '*.png' 2>/dev/null | wc -l)"

    line "④ 补充：直查库确认版本真的落库（与界面数字对照）"
    echo "  \$ sqlite3 pm.db \"SELECT version_no FROM prompt_versions WHERE prompt_id=$FIX_ID ORDER BY version_no DESC LIMIT 5;\""
    q "SELECT version_no FROM prompt_versions WHERE prompt_id=$FIX_ID ORDER BY version_no DESC LIMIT 5;" | tr '\n' ' ' | sed 's/^/    /'
    echo
    DB_MAX=$(q "SELECT MAX(version_no) FROM prompt_versions WHERE prompt_id=$FIX_ID;")
    eq "④ 库里最新版本号 == 界面最上方版本号（移动端那次改后）" "$(p mobile_after_top)" "$DB_MAX"
    eq "④ prompts.version_no 与版本表一致" "$(q "SELECT version_no FROM prompts WHERE id=$FIX_ID;")" "$DB_MAX"
  fi

  if [ "$ONLY" = "all" ] || [ "$ONLY" = "regress" ]; then
    line "回归：版本面板既有能力（对比 / 详情 / 备注）接口仍可用"
    eq "GET /api/prompts/:id/versions 仍 200" 200 "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" "$BASE/api/prompts/$FIX_ID/versions")"
    V_FIRST=$(curl -s -b "$JAR" "$BASE/api/prompts/$FIX_ID/versions" | jq -r '.items[0].version_no')
    V_LAST=$(curl -s -b "$JAR" "$BASE/api/prompts/$FIX_ID/versions" | jq -r '.items[-1].version_no')
    # 实测口径：**接口按 version_no 升序**返回（最老在前）；"最新在上"是**表格显示**层的处理（见下一条）
    echo "  接口 /versions 顺序（原样）：[$(curl -s -b "$JAR" "$BASE/api/prompts/$FIX_ID/versions" | jq -c '[.items[].version_no]' | tr -d '[]')]"
    eq "接口 /versions 按 version_no 升序（最老在前）—— 本阶段未改接口" "true" "$(python3 -c "
import sys
print('true' if int(sys.argv[1]) < int(sys.argv[2]) else 'false')
" "$V_FIRST" "$V_LAST")"
    # 真实路由形状：GET /api/prompts/:id/diff?from=&to= 与 POST /api/prompts/:id/versions/:n/rollback
    eq "版本对比接口仍 200" 200 "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" "$BASE/api/prompts/$FIX_ID/diff?from=$V_FIRST&to=$V_LAST")"
    eq "回滚接口仍可用（回滚到 v1 → 200）" 200 "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -X POST "$BASE/api/prompts/$FIX_ID/versions/1/rollback")"
    eq "回滚后 version_no 又 +1（库）" "true" "$(python3 -c "
import sys
print('true' if int(sys.argv[1]) > int(sys.argv[2]) else 'false')
" "$(q "SELECT version_no FROM prompts WHERE id=$FIX_ID;")" "$DB_MAX")"
    eq "迁移版本未变（仍 v4）" 4 "$(q 'SELECT MAX(version) FROM schema_migrations;')"
  fi
fi

line "结论"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ AC-104 全部通过"
else
  echo "  ❌ 有未通过项（见上方 ❌）"
fi
exit "$FAIL"
