#!/usr/bin/env bash
# 阶段 39 验收自检（FR-100 撤销后的 token 仍显示值并支持复制；纯前端）：
#   AC-102 ① 撤销行 Token 列 = 掩码（前 5 + ... + 后 4），**不是 `—`**
#        ② 撤销行「使用」列有「复制」；**内网 IP 非安全上下文**下真鼠标点击 → 真 Ctrl+V 粘贴读回 == 明文；
#           且**点击时不得发** POST /api/tokens/:id/reveal
#        ③ 未撤销行行为不变（掩码 + 复制可用）
#        ④ `token_enc = NULL` 的旧 token 仍 `—`，且 `—` 带 `title` 说明原因（不报错、不留白）
#        ⑤ 页面里仍不出现完整明文（复制进剪贴板不算）
#        ⑥ 操作列不变：有效行只有「撤销」、已撤销行只有「删除」；真鼠标删除 → 二次确认 → 行消失 + 直查库 0
#        ⑦ 回归：6 列顺序不变、抽屉 ≤640、无横向滚动、关抽屉后无明文、明文不落持久存储
#        ⑧ 亮 / 暗各一张截图
#
# 服务**自起自停**（临时 DATA_DIR + 台账范围内备用端口）；不碰 8767 测试环境、不碰 106 生产。
# 用法：bash tools/ac-stage39.sh [all|revoked|regress]
set -u
set -o pipefail

cd "$(dirname "$0")/.." || exit 1
ONLY=${1:-all}
PORT=${PORT:-auto}
AC_PW='ac-fixture-pw-20260918'
AC_USER='admin'
SHOTS='tmp/shots/stage39'
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
# ⚠️ AC-102 ② 要求：**必须**用内网 IP（127.0.0.1 是安全上下文，会掩盖剪贴板路径差异）
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
AC_DIR=$(mktemp -d /tmp/pm-ac39-XXXXXX)
DB="$AC_DIR/pm.db"
SERVER_LOG="$AC_DIR/server.log"
q() { sqlite3 "$DB" "$1"; }

line "构建 + 本阶段单测"
npm run build >"$AC_DIR/build.log" 2>&1
eq "npm run build 退出码" 0 "$?"
node --test tests/stage39-revoked-token.test.ts >"$AC_DIR/unit.log" 2>&1
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

  # 夹具：① 已撤销（本次的主角）② 有效 ③ 不可恢复（token_enc = NULL 的"迁移前旧 token"）
  REV_JSON=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"name":"AC102 已撤销夹具"}' "$LAN_BASE/api/tokens")
  REV_ID=$(echo "$REV_JSON" | jq -r .id)
  REV_TOK=$(echo "$REV_JSON" | jq -r .token)
  ACT_JSON=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"name":"AC102 有效夹具"}' "$LAN_BASE/api/tokens")
  ACT_ID=$(echo "$ACT_JSON" | jq -r .id)
  ACT_TOK=$(echo "$ACT_JSON" | jq -r .token)
  REV2_JSON=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"name":"AC102 已撤销夹具二（不删）"}' "$LAN_BASE/api/tokens")
  REV2_ID=$(echo "$REV2_JSON" | jq -r .id)
  LEG_JSON=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"name":"AC102 不可恢复夹具"}' "$LAN_BASE/api/tokens")
  LEG_ID=$(echo "$LEG_JSON" | jq -r .id)
  curl -s -b "$JAR" -o /dev/null -X DELETE "$LAN_BASE/api/tokens/$REV_ID"
  # 第二个已撤销行**不删**：暗色阶段与回归都要用它（删了就没得验了）
  curl -s -b "$JAR" -o /dev/null -X DELETE "$LAN_BASE/api/tokens/$REV2_ID"
  # 模拟"迁移前创建、没存密文"的旧 token：清掉密文（服务端 revealable 随之变 false）
  q "UPDATE api_tokens SET token_enc = NULL WHERE id = $LEG_ID;"
  eq "夹具前置：已撤销行 revealable 仍为 true（撤销 ≠ 销毁）" true "$(curl -s -b "$JAR" "$LAN_BASE/api/tokens" | jq -r ".items[] | select(.id==$REV_ID) | .revealable")"
  eq "夹具前置：不可恢复行 revealable = false" false "$(curl -s -b "$JAR" "$LAN_BASE/api/tokens" | jq -r ".items[] | select(.id==$LEG_ID) | .revealable")"
  pass "夹具：已撤销 id=$REV_ID（本次会删，$(mask "$REV_TOK")）、已撤销二 id=$REV2_ID（保留）、有效 id=$ACT_ID、不可恢复 id=$LEG_ID"

  if [ "$ONLY" = "all" ] || [ "$ONLY" = "revoked" ]; then
    line "AC-102：内网 IP 下撤销行的掩码 / 复制 / 真粘贴"
    rm -rf "$SHOTS"
    AC102_EXPECT_TOKEN="$REV_TOK" AC102_REVOKED_ID="$REV_ID" AC102_REVOKED2_ID="$REV2_ID" AC102_ACTIVE_ID="$ACT_ID" \
      AC102_LEGACY_ID="$LEG_ID" AC102_SERVER_LOG="$SERVER_LOG" \
      node tools/ac-stage39-probe.mjs revoked "$LAN_BASE" "$SID" "$SHOTS" | tee "$AC_DIR/probe.log"
    p() { grep -m1 "^$1=" "$AC_DIR/probe.log" | cut -d= -f2-; }

    eq "② 非安全上下文（AC-97 口径）" false "$(p is_secure_context)"
    eq "② 剪贴板 API 不存在（真内网环境）" undefined "$(p clipboard_type)"

    echo "  ① 期望掩码（脱敏）：$(p expected_revoked_mask | cut -c1-8)…"
    pass "  ① 撤销行 Token 列实际值（脱敏）：$(p revoked_mask)"
    eq "① 撤销行 Token 列 = 掩码（不是 —）" true "$(p revoked_mask_matches)"
    eq "① 撤销行 Token 列确实不是 —" false "$(p revoked_mask_is_dash)"

    eq "② 撤销行「使用」列有「复制」按钮" true "$(p revoked_has_copy)"
    pass "② 点击后的提示：$(p toast_after_revoked_copy)"
    pass "② 真粘贴读回（脱敏）：$(p pasted_masked) ｜ 期望（脱敏）：$(p expected_masked)"
    eq "② 真鼠标「复制」→ Ctrl+V 粘贴内容 == 明文" true "$(p revoked_clipboard_equals_plaintext)"
    eq "② 点击「复制」时没有发 reveal 请求（服务端计数不变）" "$(p reveal_count_before_click)" "$(p reveal_count_after_click)"

    eq "③ 未撤销行「使用」列仍有「复制」" true "$(p active_has_copy)"

    pass "④ 不可恢复行的 Token 列：$(p legacy_mask) ｜ title：$(p legacy_mask_title)"
    eq "④ 不可恢复行 Token 列仍为 —" "—" "$(p legacy_mask)"
    eq "④ 该 — 带 title 说明原因" "迁移前创建的令牌没有保存可恢复的密文，无法查看；可撤销后重建" "$(p legacy_mask_title)"
    eq "④ 不可恢复行「使用」列也是 — 且带同样说明" "—" "$(p legacy_use)"
    eq "④ 该 — 的 title 说明一致" "迁移前创建的令牌没有保存可恢复的密文，无法查看；可撤销后重建" "$(p legacy_use_title)"
    eq "④ 不可恢复行没有「复制」按钮（取不到密文）" false "$(p legacy_has_copy)"

    eq "⑤ 页面文本里不出现完整明文" false "$(p page_has_full_plaintext)"

    echo "  ⑥ 行分区：有效 $(p validRows) 行 / 已撤销 $(p revokedRows) 行"
    eq "⑥ 有效行每行都有「撤销」" "$(p validRows)" "$(p validRevoke)"
    eq "⑥ 有效行没有「删除」" 0 "$(p validDelete)"
    eq "⑥ 已撤销行没有「撤销」" 0 "$(p revokedRevoke)"
    eq "⑥ 已撤销行每行都有「删除」" "$(p revokedRows)" "$(p revokedDelete)"
    pass "⑥ 删除二次确认：$(p delete_confirm_text)"
    eq "⑥ 真鼠标删除后行消失（行数 -1）" "true" "$(python3 -c "
import sys
print('true' if int(sys.argv[1]) == int(sys.argv[2]) - 1 else 'false')
" "$(p rows_after_delete)" "$(p rows_before_delete)")"
    eq "⑥ 直查库：该 id 行数 = 0" 0 "$(q "SELECT COUNT(*) FROM api_tokens WHERE id=$REV_ID;")"

    eq "⑦ 列头仍是 6 列且顺序不变" '["名称","Token","状态","使用","最近使用","操作"]' "$(p heads)"
    echo "  ⑦ 抽屉宽度 = $(p drawer_width)｜表格 client=$(p table_client) / scroll=$(p table_scroll)"
    eq "⑦ 抽屉宽度 ≤ 640" "true" "$(python3 -c "
import sys
print('true' if int(sys.argv[1]) <= 640 else 'false')
" "$(p drawer_width)")"
    eq "⑦ 表格无横向滚动" true "$(p table_no_hscroll)"
    eq "⑦ 关抽屉后页面无完整明文" false "$(p after_close_has_full_plaintext)"
    eq "⑦ 明文不落 localStorage/sessionStorage/URL" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['local']==0 and s['session']==0 and s['url']==0 else 'false')
" "$(p storage_leak)")"
    eq "⑧ 暗色下撤销行同样显示掩码（不是 —）" true "$(p dark_revoked_mask_matches)"
    eq "⑧ 暗色下撤销行有「复制」" true "$(p dark_revoked_has_copy)"
    eq "页面运行时异常" "[]" "$(p ac39_runtime_errors)"

    line "⑧ 视觉证据（$SHOTS）"
    ls -l "$SHOTS" | sed 's/^/  /'
    eq "截图齐备（亮 / 暗各一张 = 2）" 2 "$(find "$SHOTS" -name '*.png' 2>/dev/null | wc -l)"
  fi

  if [ "$ONLY" = "all" ] || [ "$ONLY" = "regress" ]; then
    line "回归：撤销行现在也能 reveal（接口本来就允许），其余语义未变"
    eq "FR-100 服务端未改：撤销行 reveal 合法（会话）" 200 "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -X POST "$LAN_BASE/api/tokens/$REV2_ID/reveal")"
    eq "FR-100 撤销行 reveal 出来的明文与创建时一致" "true" "$([ "$(curl -s -b "$JAR" -X POST "$LAN_BASE/api/tokens/$REV2_ID/reveal" | jq -r .token)" = "$(echo "$REV2_JSON" | jq -r .token)" ] && echo true || echo false)"
    # ⚠️ Bearer 必须用**仍然有效**的 token：用被删掉的那个会先被闸门判 401（首版就这么写错了）
    eq "FR-95 reveal 仍只允许会话（Bearer → 403）" 403 "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $ACT_TOK" -X POST "$LAN_BASE/api/tokens/$REV2_ID/reveal")"
    eq "FR-96 未撤销 → 409 token_not_revoked" "409 token_not_revoked" "$(curl -s -w '%{http_code}' -b "$JAR" -X DELETE "$LAN_BASE/api/tokens/$ACT_ID/permanent" -o "$AC_DIR/e1.json") $(jq -r .error "$AC_DIR/e1.json")"
    eq "FR-96 不存在 → 404" 404 "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -X DELETE "$LAN_BASE/api/tokens/999999/permanent")"
    NEW_JSON=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"name":"AC102 响应形态"}' "$LAN_BASE/api/tokens")
    eq "FR-97 POST /api/tokens 仍含明文一次" "true" "$(echo "$NEW_JSON" | jq -r 'has("token")')"
    eq "列表仍不含明文" "true" "$(python3 -c "
import sys
print('true' if sys.argv[2] not in sys.argv[1] else 'false')
" "$(curl -s -b "$JAR" "$LAN_BASE/api/tokens")" "$REV_TOK")"
    eq "日志里无 token 明文" 0 "$(grep -c "$REV_TOK" "$SERVER_LOG" || true)"
    eq "迁移版本未变（仍 v4）" 4 "$(q 'SELECT MAX(version) FROM schema_migrations;')"
  fi
fi

line "结论"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ AC-102 全部通过"
else
  echo "  ❌ 有未通过项（见上方 ❌）"
fi
exit "$FAIL"
