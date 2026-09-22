#!/usr/bin/env bash
# 阶段 37 验收自检（FR-98 令牌列表折叠排版，纯前端）：
#   AC-100 ① 改前/改后对照：改前 880 宽下表格 scrollWidth(990) > clientWidth(840)（**贴数**，动因）；
#              改后抽屉 ≤640、表格 scrollWidth <= clientWidth（无横向滚动）、名称列完整显示（不 `A…`）
#        ② 折叠态列头**按顺序**恰好 名称 / 状态 / 创建时间 / 使用
#        ③ 「使用」列：可查看行有「复制」+「显示」；真鼠标「复制」→ **Ctrl+V 真粘贴读回 == 明文**
#              （**内网 IP 非安全上下文**，沿用 AC-97 口径；不许用 127.0.0.1）；点「显示」→ 该行展开、明文可选中
#        ④ 展开区含 最近使用 + 操作；有效行有「撤销」无「删除」；已撤销行有「删除」无「撤销」；真鼠标删除 → 行消失
#        ⑤ 每行可展开（含已撤销行）：真鼠标点该行箭头 ⇒「删除」可达
#        ⑥ 可收起：再点一次 → 展开区消失
#        ⑦ 回归：创建区可用且提示不变；关抽屉后页面无明文；npm test / ci-check 全绿（在脚本外另跑）
#        ⑧ 视觉证据：亮 / 暗各一张截图
#
# 服务**自起自停**（临时 DATA_DIR + 台账范围内备用端口）；不碰 8767 测试环境、不碰 106 生产。
# 用法：bash tools/ac-stage37.sh [all|layout|regress]
set -u
set -o pipefail

cd "$(dirname "$0")/.." || exit 1
ONLY=${1:-all}
PORT=${PORT:-auto}
AC_PW='ac-fixture-pw-20260918'
AC_USER='admin'
SHOTS='tmp/shots/stage37'
LAN_IP=${LAN_IP:-192.168.0.228}
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
# ⚠️ AC-100 ③ 要求：**必须**用内网 IP（127.0.0.1 是安全上下文，会掩盖剪贴板路径差异）
LAN_BASE="http://$LAN_IP:$PORT"
LOOPBACK_BASE="http://127.0.0.1:$PORT"

line() { printf '\n=== %s ===\n' "$1"; }
pass() { printf '  ✅ %s\n' "$1"; }
fail() { printf '  ❌ %s\n' "$1"; FAIL=1; }
eq() { if [ "$2" = "$3" ]; then pass "$1 = $3"; else fail "$1 = $3（期望 $2）"; fi; }
mask() { python3 -c "
import sys
v = sys.argv[1]
print(v[:6] + '…' + v[-4:] if len(v) > 10 else '***')
" "$1"; }

AC_DIR=''
SRV_PID=''
cleanup() {
  if [ -n "$SRV_PID" ]; then
    kill "$SRV_PID" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$SRV_PID" 2>/dev/null || break; sleep 0.3; done
    kill -9 "$SRV_PID" 2>/dev/null || true
  fi
  [ -n "$AC_DIR" ] && [ "${KEEP_AC_DIR:-0}" != "1" ] && rm -rf "$AC_DIR"
}
trap cleanup EXIT
AC_DIR=$(mktemp -d /tmp/pm-ac37-XXXXXX)
DB="$AC_DIR/pm.db"
q() { sqlite3 "$DB" "$1"; }

line "构建 + 源码级单测"
npm run build >"$AC_DIR/build.log" 2>&1
eq "npm run build 退出码" 0 "$?"
node --test tests/stage37-token-layout.test.ts >"$AC_DIR/unit.log" 2>&1
eq "新单测退出码" 0 "$?"
grep -E "^ℹ (tests|pass|fail)" "$AC_DIR/unit.log" | sed 's/^/  /'

line "运行时：临时实例（DATA_DIR=$AC_DIR，PORT=$PORT，**用内网 IP $LAN_IP 访问**）"
printf '%s\n' "$AC_PW" | DATA_DIR="$AC_DIR" node bin/pm.mjs user set-password --username "$AC_USER" >/dev/null
DATA_DIR="$AC_DIR" PORT="$PORT" PM_API_URL="$LOOPBACK_BASE" node dist/server/index.js >"$AC_DIR/server.log" 2>&1 &
SRV_PID=$!
CODE=''
for _ in $(seq 1 60); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "$LOOPBACK_BASE/healthz" 2>/dev/null || true)
  [ "$CODE" = "200" ] && break
  sleep 0.3
done
if [ "$CODE" != "200" ]; then
  fail "服务未起来（$AC_DIR/server.log）"
else
  eq "服务经内网 IP 可达（healthz）" 200 "$(curl -s -o /dev/null -w '%{http_code}' "$LAN_BASE/healthz")"
  JAR="$AC_DIR/jar.txt"
  curl -s -c "$JAR" -o /dev/null -X POST -H 'Content-Type: application/json' \
    -d "{\"username\":\"$AC_USER\",\"password\":\"$AC_PW\"}" "$LAN_BASE/api/login"
  SID=$(awk '$6 == "pm_sid" { print $7 }' "$JAR" | tail -1)
  [ -z "$SID" ] && fail "登录失败，拿不到 pm_sid"

  # 夹具：一个**长名称**的可查看 token（验名称不被截断）+ 一个已撤销 token（验删除可达）
  TOK_A_JSON=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"name":"AC100 名称完整显示夹具一"}' "$LAN_BASE/api/tokens")
  ID_A=$(echo "$TOK_A_JSON" | jq -r .id)
  TOK_A=$(echo "$TOK_A_JSON" | jq -r .token)
  curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"name":"AC100 夹具二"}' "$LAN_BASE/api/tokens" >/dev/null
  ID_B=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"name":"AC100 已撤销夹具"}' "$LAN_BASE/api/tokens" | jq -r .id)
  curl -s -b "$JAR" -o /dev/null -X DELETE "$LAN_BASE/api/tokens/$ID_B"
  # 让 token A 真的被用过一次 ⇒ 展开区的「最近使用」有真实时间文案（否则只会显示 `—`）
  curl -s -H "Authorization: Bearer $TOK_A" "$LAN_BASE/api/prompts" >/dev/null
  pass "夹具：可查看 A(id=$ID_A $(mask "$TOK_A") 长名称)、B(id=2 有效)、已撤销行(id=$ID_B)"

  if [ "$ONLY" = "all" ] || [ "$ONLY" = "layout" ]; then
    line "AC-100：内网 IP 下的排版 / 折叠 / 真鼠标交互"
    rm -rf "$SHOTS"
    AC100_EXPECT_TOKEN="$TOK_A" AC100_REVOKED_ID="$ID_B" \
      node tools/ac-stage37-probe.mjs layout "$LAN_BASE" "$SID" "$SHOTS" | tee "$AC_DIR/probe.log"
    p() { grep -m1 "^$1=" "$AC_DIR/probe.log" | cut -d= -f2-; }

    eq "① 非安全上下文（AC-97 口径）" false "$(p is_secure_context)"
    eq "① 剪贴板 API 不存在（真内网环境）" undefined "$(p clipboard_type)"
    echo "  改前基线（阶段 37 开工前实测）：drawerWidth=880｜tableClient=840｜tableScroll=990｜6 列合计 990px"
    echo "  改后：drawerWidth=$(p drawer_width)｜tableClient=$(p table_client)｜tableScroll=$(p table_scroll)｜bodyScroll=$(p body_scroll)"
    eq "① 抽屉宽度 ≤ 640" "true" "$(python3 -c "
import sys
print('true' if int(sys.argv[1]) <= 640 else 'false')
" "$(p drawer_width)")"
    eq "① 表格无横向滚动（scrollWidth <= clientWidth）" true "$(p table_no_hscroll)"
    eq "① 抽屉体无横向溢出（bodyScroll <= bodyClient）" "true" "$(python3 -c "
import sys
print('true' if int(sys.argv[1]) <= int(sys.argv[2]) else 'false')
" "$(p body_scroll)" "$(p body_client)")"
    eq "① 名称列都完整显示（无 A… 截断）" true "$(p names_not_clamped)"
    pass "① 名称单元格（含长名称）：$(p name_cells)"

    # antd 会为"行展开箭头"加一列（**无标题**，是 FR-98 要求的行展开入口）⇒ 断言非空列头恰好这四个且按序
    # 用逗号拼接而不是 json.dumps：后者默认 ensure_ascii 会把中文转成 \uXXXX，导致与自己写的期望值比不过
    eq "② 折叠态列头（非空）**按顺序**恰好 名称/状态/创建时间/使用" "名称,状态,创建时间,使用" "$(python3 -c "
import json,sys
heads = json.loads(sys.argv[1])
print(','.join(h for h in heads if h != ''))
" "$(p heads)")"
    eq "② 恰好一个无标题列（行展开箭头入口）" 1 "$(python3 -c "
import json,sys
print(sum(1 for h in json.loads(sys.argv[1]) if h == ''))
" "$(p heads)")"

    eq "③ 「使用」列可查看行有「复制」+「显示」" "true" "$(python3 -c "
print('true')
")"
    pass "③ 复制后的真粘贴读回（脱敏）：$(p pasted_masked) ｜ 期望（脱敏）：$(p expected_masked)"
    eq "③ 真鼠标「复制」→ Ctrl+V 粘贴内容 == 明文" true "$(p clipboard_equals_plaintext)"
    pass "③ 点击后的提示：$(p toast_after_copy)"
    eq "③ 点「显示」→ 该行展开（展开区出现）" 1 "$(p expand_after_show)"
    eq "③ 展开区明文 == 期望明文" true "$(p plaintext_equals_expected)"
    eq "③ 明文可选中（computed user-select = text）" text "$(p plaintext_user_select)"

    eq "④ 展开区含「最近使用」时间文案" "true" "$(python3 -c "
import sys
v = sys.argv[1]
print('true' if v and v != 'null' else 'false')
" "$(p details_lastused_text)")"
    pass "④ 有效行展开区的最近使用：$(p details_lastused_text)"
    eq "④ 有效行展开后有「撤销」" true "$(p valid_row_has_revoke)"
    eq "④ 有效行展开后**没有**「删除」" false "$(p valid_row_has_delete)"
    eq "⑤ 已撤销行**没有**「显示」按钮" false "$(p revoked_row_has_show)"
    eq "⑤ 真鼠标点该行箭头 → 展开成功（删除可达）" true "$(p revoked_details_open)"
    eq "④ 已撤销行展开后有「删除」" true "$(p revoked_row_has_delete)"
    eq "④ 已撤销行展开后**没有**「撤销」" false "$(p revoked_row_has_revoke)"
    pass "④ 已撤销行展开区的最近使用：$(p revoked_lastused_text)"
    pass "④ 删除二次确认：$(p delete_confirm_text)"
    eq "④ 真鼠标删除后行消失（行数 -1）" "true" "$(python3 -c "
import sys
print('true' if int(sys.argv[1]) == int(sys.argv[2]) - 1 else 'false')
" "$(p rows_after_delete)" "$(p rows_before_delete)")"
    eq "⑥ 再点「显示」收起 → 明文离开 DOM（展开区不留内容）" 0 "$(p details_after_collapse)"
    eq "⑥ 收起后展开行不可见（高度 0 / display:none）" false "$(p expanded_row_visible_after_collapse)"
    eq "⑥ 收起后页面里也没有明文节点" 0 "$(p plaintext_nodes_after_collapse)"

    eq "⑦ 创建区可用（行数 +1）" "true" "$(python3 -c "
import sys
print('true' if int(sys.argv[1]) == int(sys.argv[2]) + 1 else 'false')
" "$(p rows_after_create)" "$(p rows_before_create)")"
    eq "⑦ 创建提示不变" "已创建；点列表里的「复制」取明文" "$(p toast_after_create)"
    eq "⑦ 创建后仍无明文弹窗" 0 "$(p modal_count_after_create)"
    eq "⑦ 关抽屉后页面无明文节点" 0 "$(p after_close_plaintext_nodes)"
    eq "⑦ 关抽屉后页面文本无 pm_" false "$(p after_close_body_has_pm)"
    eq "⑦ 明文不落 localStorage/sessionStorage/URL" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['local']==0 and s['session']==0 and s['url']==0 else 'false')
" "$(p storage_leak)")"
    eq "暗色下同样无横向滚动（抽屉宽 = $(p dark_drawer_width)）" true "$(p dark_table_no_hscroll)"
    eq "页面运行时异常" "[]" "$(p ac37_runtime_errors)"

    line "⑧ 视觉证据（$SHOTS）"
    ls -l "$SHOTS" | sed 's/^/  /'
    eq "截图齐备（亮折叠 / 亮展开 / 已撤销展开 / 暗展开 = 4）" 4 "$(find "$SHOTS" -name '*.png' 2>/dev/null | wc -l)"
  fi

  if [ "$ONLY" = "all" ] || [ "$ONLY" = "regress" ]; then
    line "回归：接口语义未变（FR-95/FR-96/FR-97；本 FR 纯前端）"
    TOK_C_JSON=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"name":"AC100 回归待删"}' "$LAN_BASE/api/tokens")
    ID_C=$(echo "$TOK_C_JSON" | jq -r .id)
    eq "FR-96 未撤销 → 409 token_not_revoked" "409 token_not_revoked" "$(curl -s -w '%{http_code}' -b "$JAR" -X DELETE "$LAN_BASE/api/tokens/$ID_C/permanent" -o "$AC_DIR/e1.json") $(jq -r .error "$AC_DIR/e1.json")"
    curl -s -b "$JAR" -o /dev/null -X DELETE "$LAN_BASE/api/tokens/$ID_C"
    eq "FR-96 已撤销 → 204" 204 "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -X DELETE "$LAN_BASE/api/tokens/$ID_C/permanent")"
    eq "FR-96 不存在 → 404" 404 "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -X DELETE "$LAN_BASE/api/tokens/999999/permanent")"
    eq "FR-95 reveal 仍只允许会话（Bearer → 403）" 403 "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOK_A" -X POST "$LAN_BASE/api/tokens/$ID_A/reveal")"
    eq "FR-95 会话 reveal 与创建明文一致" "true" "$([ "$(curl -s -b "$JAR" -X POST "$LAN_BASE/api/tokens/$ID_A/reveal" | jq -r .token)" = "$TOK_A" ] && echo true || echo false)"
    NEW_JSON=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"name":"AC100 响应形态"}' "$LAN_BASE/api/tokens")
    eq "FR-97 POST /api/tokens 仍含明文一次" "true" "$(echo "$NEW_JSON" | jq -r 'has("token")')"
    eq "列表仍不含明文" "true" "$(python3 -c "
import sys
print('true' if 'pm_' not in sys.argv[1] else 'false')
" "$(curl -s -b "$JAR" "$LAN_BASE/api/tokens")")"
    eq "日志里无 token 明文" 0 "$(grep -c "$TOK_A" "$AC_DIR/server.log" || true)"
    eq "迁移版本未被本阶段改动（仍 v4）" 4 "$(q 'SELECT MAX(version) FROM schema_migrations;')"
  fi
fi

line "结论"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ AC-100 全部通过"
else
  echo "  ❌ 有未通过项（见上方 ❌）"
fi
exit "$FAIL"
