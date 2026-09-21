#!/usr/bin/env bash
# 阶段 36 验收自检：
#   AC-97 FIX 同步复制（**必须在内网 IP 的非安全上下文下验**）：① isSecureContext=false + navigator.clipboard=undefined
#        ② 真鼠标「复制」→ CDP Ctrl+V 真粘贴读回 == 明文 ③ 点「复制」时 reveal 次数 = 0（预取在开抽屉时）
#        ④ 真「显示」入口（可选中）+ 文案一致 ⑤ 明文不落 localStorage/sessionStorage/URL；关抽屉后页面无明文
#        ⑥ 回归：reveal 仍只允许会话（Bearer → 403）
#   AC-98 撤销态可硬删除：① UI 真鼠标（仅已撤销行有「删除」）② 接口三态 204/409/404 ③ 真删（列表+查库）
#        ④ 撤销后调 API 仍 401 ⑤ 文档记录新路由与语义
#   AC-99 去掉创建弹窗：① 真鼠标创建后无明文 Modal ② 有提示且新行「复制」能拿明文 ③ 仍 revealable + 响应仍含明文
#
# ⚠️ 本脚本**故意用 `http://192.168.0.228:<port>`（内网 IP）**：`127.0.0.1` 是安全上下文，
#    会掩盖"内网 HTTP 下复制不进剪贴板"这个 bug（阶段 35 的 AC-96 ⑥ 就是这么漏掉的）。
# 服务**自起自停**（临时 DATA_DIR + 台账范围内备用端口）；不碰 8767 测试环境、不碰 106 生产。
# 用法：bash tools/ac-stage36.sh [all|copy|delete|create]
set -u
set -o pipefail

cd "$(dirname "$0")/.." || exit 1
ONLY=${1:-all}
PORT=${PORT:-auto}
AC_PW='ac-fixture-pw-20260918'
AC_USER='admin'
SHOTS='tmp/shots/stage36'
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
# ⚠️ 用内网 IP 而不是 127.0.0.1（AC-97 ① 的硬要求）
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
AC_DIR=$(mktemp -d /tmp/pm-ac36-XXXXXX)
DB="$AC_DIR/pm.db"
SERVER_LOG="$AC_DIR/server.log"
q() { sqlite3 "$DB" "$1"; }
reveal_count() { grep -c 'token revealed' "$SERVER_LOG" 2>/dev/null || true; }

line "构建 + 本阶段新增单测"
npm run build >"$AC_DIR/build.log" 2>&1
eq "npm run build 退出码" 0 "$?"
node --test tests/stage36-tokens-ui.test.ts >"$AC_DIR/unit.log" 2>&1
eq "新单测退出码" 0 "$?"
grep -E "^ℹ (tests|pass|fail)" "$AC_DIR/unit.log" | sed 's/^/  /'

line "运行时：临时实例（DATA_DIR=$AC_DIR，PORT=$PORT，**用内网 IP $LAN_IP 访问**）"
printf '%s\n' "$AC_PW" | DATA_DIR="$AC_DIR" node bin/pm.mjs user set-password --username "$AC_USER" >/dev/null
DATA_DIR="$AC_DIR" PORT="$PORT" PM_API_URL="$LOOPBACK_BASE" node dist/server/index.js >"$SERVER_LOG" 2>&1 &
SRV_PID=$!
CODE=''
for _ in $(seq 1 60); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "$LOOPBACK_BASE/healthz" 2>/dev/null || true)
  [ "$CODE" = "200" ] && break
  sleep 0.3
done
if [ "$CODE" != "200" ]; then
  fail "服务未起来（$SERVER_LOG）"
else
  eq "服务经内网 IP 可达（healthz）" 200 "$(curl -s -o /dev/null -w '%{http_code}' "$LAN_BASE/healthz")"
  JAR="$AC_DIR/jar.txt"
  curl -s -c "$JAR" -o /dev/null -X POST -H 'Content-Type: application/json' \
    -d "{\"username\":\"$AC_USER\",\"password\":\"$AC_PW\"}" "$LAN_BASE/api/login"
  SID=$(awk '$6 == "pm_sid" { print $7 }' "$JAR" | tail -1)
  [ -z "$SID" ] && fail "登录失败，拿不到 pm_sid"

  # 夹具：token A（可查看，供复制）、token B（先撤销，供硬删除）
  TOK_A_JSON=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"name":"AC36 token A"}' "$LAN_BASE/api/tokens")
  ID_A=$(echo "$TOK_A_JSON" | jq -r .id)
  TOK_A=$(echo "$TOK_A_JSON" | jq -r .token)
  TOK_B_JSON=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"name":"AC36 token B(已撤销)"}' "$LAN_BASE/api/tokens")
  ID_B=$(echo "$TOK_B_JSON" | jq -r .id)
  TOK_B=$(echo "$TOK_B_JSON" | jq -r .token)
  curl -s -b "$JAR" -o /dev/null -X DELETE "$LAN_BASE/api/tokens/$ID_B"
  pass "夹具：token A(id=$ID_A $(mask "$TOK_A"))、token B(id=$ID_B 已撤销 $(mask "$TOK_B"))"

  if [ "$ONLY" = "all" ] || [ "$ONLY" = "copy" ]; then
    line "AC-97：非安全上下文下的真鼠标复制 + 真粘贴（内网 IP）"
    BEFORE_OPEN=$(reveal_count)
    echo "  开抽屉前 reveal 次数 = $BEFORE_OPEN"
    rm -rf "$SHOTS"
    AC36_EXPECT_TOKEN="$TOK_A" AC36_REVOKED_ID="$ID_B" AC36_SERVER_LOG="$SERVER_LOG" \
      node tools/ac-stage36-probe.mjs tokens "$LAN_BASE" "$SID" "$SHOTS" | tee "$AC_DIR/probe.log"
    p() { grep -m1 "^$1=" "$AC_DIR/probe.log" | cut -d= -f2-; }

    eq "① 页面 origin 就是内网 IP（不是回环）" "http://$LAN_IP:$PORT" "$(p origin)"
    eq "① isSecureContext === false" false "$(p is_secure_context)"
    eq "① typeof navigator.clipboard === 'undefined'" undefined "$(p clipboard_type)"
    eq "① 兜底 execCommand 可用（function）" function "$(p exec_command_type)"
    eq "① 确实不是回环地址" false "$(p is_loopback)"

    pass "② 粘贴读回（脱敏）：$(p pasted_masked) ｜ 期望（脱敏）：$(p expected_masked)"
    eq "② 真鼠标「复制」→ Ctrl+V 粘贴内容 == 明文" true "$(p clipboard_equals_plaintext)"
    eq "② 粘贴内容形如 pm_（确实是明文）" true "$(p pasted_is_plaintext)"
    pass "② 点击后的提示：$(p toast_after_copy)"
    eq "② 粘贴测试后输入框已清空（明文不残留在表单里）" "***(0)" "$(p name_input_after_clear)"

    echo "  开抽屉后（预取完成）reveal 次数 = $(p reveal_count_after_open)"
    echo "  点「复制」之后 reveal 次数 = $(p reveal_count_after_copy_click)"
    # 此刻列表里只有 token A 是可查看且未撤销的行 ⇒ 开抽屉时恰好预取 1 次（这就是"预取发生在开抽屉时"的证据）
    eq "③ 预取确实在开抽屉时发生（次数 ≥ 1）" "true" "$(python3 -c "
import sys
print('true' if int(sys.argv[1]) >= 1 else 'false')
" "$(p reveal_count_after_open)")"
    eq "③ 点「复制」时**没有**再发 reveal（前后次数相同）" "$(p reveal_count_after_open)" "$(p reveal_count_after_copy_click)"

    eq "④ 「显示」入口渲染的明文 == 期望明文" true "$(p show_text_equals_plaintext)"
    eq "④ 明文节点可选中（computed user-select = text）" text "$(p show_user_select)"
    pass "④ 显示内容（脱敏）：$(p show_masked)"

    eq "⑤ localStorage/sessionStorage/URL 里都没有 pm_" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['local']==0 and s['session']==0 and s['url']==0 else 'false')
" "$(p storage_leak)")"
    eq "⑤ 关闭抽屉后页面里没有明文节点" 0 "$(p after_close_plaintext_nodes)"
    eq "⑤ 关闭抽屉后页面文本里搜不到 pm_" false "$(p after_close_body_has_pm)"

    line "AC-97 ⑥：回归 —— reveal 仍只允许会话"
    eq "⑥ Bearer 调 reveal → 403 session_required" 403 "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOK_A" -X POST "$LAN_BASE/api/tokens/$ID_A/reveal")"
    eq "⑥ 会话调 reveal → 200 且与创建明文一致" "true" "$([ "$(curl -s -b "$JAR" -X POST "$LAN_BASE/api/tokens/$ID_A/reveal" | jq -r .token)" = "$TOK_A" ] && echo true || echo false)"
  fi

  if [ "$ONLY" = "all" ] || [ "$ONLY" = "create" ]; then
    line "AC-99：创建流程（真鼠标，无明文弹窗）"
    if [ -f "$AC_DIR/probe.log" ]; then
      eq "① 创建后没有明文 Modal" 0 "$(grep -m1 '^modal_count_after_create=' "$AC_DIR/probe.log" | cut -d= -f2-)"
      eq "① Modal 里不含明文" false "$(grep -m1 '^modal_has_plaintext=' "$AC_DIR/probe.log" | cut -d= -f2-)"
      pass "① 创建后的提示：$(grep -m1 '^toast_after_create=' "$AC_DIR/probe.log" | cut -d= -f2-)"
      eq "② 列表刷新出新行（行数 +1）" "true" "$(python3 -c "
import sys
before = int(sys.argv[1]); after = int(sys.argv[2])
print('true' if after == before + 1 else 'false')
" "$(grep -m1 '^rows_before_create=' "$AC_DIR/probe.log" | cut -d= -f2-)" "$(grep -m1 '^rows_after_create=' "$AC_DIR/probe.log" | cut -d= -f2-)")" 
      eq "② 新行点「复制」拿到的明文 == 该行「显示」的明文" true "$(grep -m1 '^new_token_clipboard_equals_shown=' "$AC_DIR/probe.log" | cut -d= -f2-)"
      pass "② 新 token 明文（脱敏）：$(grep -m1 '^new_token_masked=' "$AC_DIR/probe.log" | cut -d= -f2-)"
    else
      fail "探针未运行（先跑 copy 模式）"
    fi
    # ③ 响应形态与 revealable 未回归
    NEW_JSON=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"name":"AC36 响应形态"}' "$LAN_BASE/api/tokens")
    NEW_ID=$(echo "$NEW_JSON" | jq -r .id)
    eq "③ POST /api/tokens 响应仍含明文一次" "true" "$(echo "$NEW_JSON" | jq -r 'has("token")')"
    eq "③ 新 token 仍 revealable=true" true "$(curl -s -b "$JAR" "$LAN_BASE/api/tokens" | jq -r ".items[] | select(.id==$NEW_ID) | .revealable")"
    eq "③ 列表响应仍不含明文" "true" "$(python3 -c "
import json,sys
body = sys.argv[1]; tok = sys.argv[2]
print('true' if tok not in body else 'false')
" "$(curl -s -b "$JAR" "$LAN_BASE/api/tokens")" "$(echo "$NEW_JSON" | jq -r .token)")"
  fi

  if [ "$ONLY" = "all" ] || [ "$ONLY" = "delete" ]; then
    line "AC-98：撤销态硬删除（接口三态 + 真删 + UI）"
    if [ -f "$AC_DIR/probe.log" ]; then
      eq "① 已撤销行有「删除」按钮" true "$(grep -m1 '^revoked_row_has_delete=' "$AC_DIR/probe.log" | cut -d= -f2-)"
      eq "① 已撤销行**没有**「复制」按钮" false "$(grep -m1 '^revoked_row_has_copy=' "$AC_DIR/probe.log" | cut -d= -f2-)"
      eq "① 所有有效行都**没有**「删除」按钮" "true" "$(python3 -c "
import json,sys
print('true' if all(json.loads(sys.argv[1])) else 'false')
" "$(grep -m1 '^valid_rows_without_delete=' "$AC_DIR/probe.log" | cut -d= -f2-)")"
      pass "① 二次确认文案：$(grep -m1 '^delete_confirm_text=' "$AC_DIR/probe.log" | cut -d= -f2-)"
      eq "① 真鼠标删除后行从列表消失（行数 -1）" "true" "$(python3 -c "
import sys
print('true' if int(sys.argv[1]) == int(sys.argv[2]) - 1 else 'false')
" "$(grep -m1 '^rows_after_delete=' "$AC_DIR/probe.log" | cut -d= -f2-)" "$(grep -m1 '^rows_after_create=' "$AC_DIR/probe.log" | cut -d= -f2-)")" 
    fi
    # 接口三态
    ACTIVE_JSON=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"name":"AC98 未撤销"}' "$LAN_BASE/api/tokens")
    ACTIVE_ID=$(echo "$ACTIVE_JSON" | jq -r .id)
    eq "② 未撤销 → 409 token_not_revoked" "409 token_not_revoked" "$(curl -s -w '%{http_code}' -b "$JAR" -X DELETE "$LAN_BASE/api/tokens/$ACTIVE_ID/permanent" -o "$AC_DIR/e1.json") $(jq -r .error "$AC_DIR/e1.json")"
    eq "② 不存在 → 404" 404 "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -X DELETE "$LAN_BASE/api/tokens/999999/permanent")"
    # ③ 真删：先撤销再删（探针已删 ID_B，这里再验一次完整链路 + 查库）
    D_JSON=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"name":"AC98 待删"}' "$LAN_BASE/api/tokens")
    D_ID=$(echo "$D_JSON" | jq -r .id)
    curl -s -b "$JAR" -o /dev/null -X DELETE "$LAN_BASE/api/tokens/$D_ID"
    eq "② 已撤销 → 204" 204 "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -X DELETE "$LAN_BASE/api/tokens/$D_ID/permanent")"
    eq "③ 列表不含该行" 0 "$(curl -s -b "$JAR" "$LAN_BASE/api/tokens" | jq "[.items[] | select(.id==$D_ID)] | length")"
    echo "  \$ sqlite3 pm.db \"SELECT count(*) FROM api_tokens WHERE id=$D_ID;\""
    q "SELECT count(*) FROM api_tokens WHERE id=$D_ID;" | sed 's/^/  /'
    eq "③ 直接查库：该行已真删（count = 0）" 0 "$(q "SELECT count(*) FROM api_tokens WHERE id=$D_ID;")"
    eq "④ 被撤销的 token 调 API 仍 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOK_B" "$LAN_BASE/api/prompts")"
    line "AC-98 ⑤：文档记录新路由与语义"
    eq "⑤ docs/api.md 记录 DELETE /api/tokens/:id/permanent + 409/404 + 真删语义" "true" "$(python3 -c "
src = open('docs/api.md', encoding='utf-8').read()
ok = ('/api/tokens/:id/permanent' in src) and ('token_not_revoked' in src) and ('真删' in src)
print('true' if ok else 'false')
")"
  fi

  line "截图（$SHOTS）"
  ls -l "$SHOTS" 2>/dev/null | sed 's/^/  /'
  if [ "$ONLY" = "all" ]; then
    eq "截图齐备（复制态 / 创建后 / 关闭后 = 3）" 3 "$(find "$SHOTS" -name '*.png' 2>/dev/null | wc -l)"
  fi
fi

line "结论"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ AC-97 / AC-98 / AC-99 全部通过"
else
  echo "  ❌ 有未通过项（见上方 ❌）"
fi
exit "$FAIL"
