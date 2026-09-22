#!/usr/bin/env bash
# 阶段 38 验收自检（FR-99 令牌列表固定 6 列、去掉折叠；AC-101 取代已作废的 AC-100）：
#   AC-101 ① 列头按顺序恰好 6 列；折叠残留（箭头 / expand·details·lastused testid）命中 **全 0**
#        ② 名称：>20 字符的名字 → 单元格文本 == 前 20 字符 + 省略号；单元格 title == 完整名称
#        ③ Token：掩码 == 前 5 + `...` + 后 4；**页面里不出现完整明文**
#        ④ 使用列：有效行「复制」（**点击时无请求**）+ **内网 IP 非安全上下文下真 Ctrl+V 粘贴读回 == 明文**；已撤销行 `—`
#        ⑤ 操作列：有效行只有「撤销」；已撤销行只有「删除」；真鼠标删除 → 二次确认 → 行消失（**直查库行数 0**）
#        ⑥ 最近使用：`YYYY/MM/DD HH:mm` 形态；从未使用 `—`
#        ⑦ 抽屉 ≤640、表格无横向滚动；亮 / 暗各一张截图
#        ⑧ 回归：创建区可用且提示不变、无明文弹窗、关抽屉后页面无完整明文；FR-95/96/97 语义不变
#
# 服务**自起自停**（临时 DATA_DIR + 台账范围内备用端口）；不碰 8767 测试环境、不碰 106 生产。
# 用法：bash tools/ac-stage38.sh [all|columns|regress]
set -u
set -o pipefail

cd "$(dirname "$0")/.." || exit 1
ONLY=${1:-all}
PORT=${PORT:-auto}
AC_PW='ac-fixture-pw-20260918'
AC_USER='admin'
SHOTS='tmp/shots/stage38'
LAN_IP=${LAN_IP:-192.168.0.228}
# >20 个字符的名称（用 ASCII+中文混合，逐字截断，异常好判）
LONG_NAME='AC101-超长名称夹具-一二三四五六七八九十-ABCDEFG'
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
# ⚠️ AC-101 ④ 要求：**必须**用内网 IP（127.0.0.1 是安全上下文，会掩盖剪贴板路径差异）
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
AC_DIR=$(mktemp -d /tmp/pm-ac38-XXXXXX)
DB="$AC_DIR/pm.db"
SERVER_LOG="$AC_DIR/server.log"
q() { sqlite3 "$DB" "$1"; }

line "构建 + 本阶段单测"
npm run build >"$AC_DIR/build.log" 2>&1
eq "npm run build 退出码" 0 "$?"
node --test tests/stage38-token-columns.test.ts >"$AC_DIR/unit.log" 2>&1
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

  # 夹具：① >20 字符长名（有效）② 普通有效（用过一次 ⇒ 最近使用有时间）③ 已撤销（验删除）
  LONG_JSON=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d "{\"name\":\"$LONG_NAME\"}" "$LAN_BASE/api/tokens")
  LONG_ID=$(echo "$LONG_JSON" | jq -r .id)
  LONG_TOK=$(echo "$LONG_JSON" | jq -r .token)
  TOK_JSON=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"name":"AC101 有效夹具"}' "$LAN_BASE/api/tokens")
  ID_A=$(echo "$TOK_JSON" | jq -r .id)
  TOK_A=$(echo "$TOK_JSON" | jq -r .token)
  curl -s -H "Authorization: Bearer $TOK_A" "$LAN_BASE/api/prompts" >/dev/null
  ID_B=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"name":"AC101 已撤销夹具"}' "$LAN_BASE/api/tokens" | jq -r .id)
  curl -s -b "$JAR" -o /dev/null -X DELETE "$LAN_BASE/api/tokens/$ID_B"
  pass "夹具：长名 id=$LONG_ID（$(python3 -c "print(len('$LONG_NAME'))") 字符 $(mask "$LONG_TOK")）、有效 id=$ID_A、已撤销 id=$ID_B"

  if [ "$ONLY" = "all" ] || [ "$ONLY" = "columns" ]; then
    line "AC-101：内网 IP 下的 6 列排版 / 截断 / 掩码 / 真鼠标"
    rm -rf "$SHOTS"
    AC101_EXPECT_TOKEN="$LONG_TOK" AC101_LONG_NAME="$LONG_NAME" AC101_REVOKED_ID="$ID_B" AC101_SERVER_LOG="$SERVER_LOG" \
      node tools/ac-stage38-probe.mjs columns "$LAN_BASE" "$SID" "$SHOTS" | tee "$AC_DIR/probe.log"
    p() { grep -m1 "^$1=" "$AC_DIR/probe.log" | cut -d= -f2-; }

    eq "④ 非安全上下文（AC-97 口径）" false "$(p is_secure_context)"
    eq "④ 剪贴板 API 不存在（真内网环境）" undefined "$(p clipboard_type)"

    eq "① 列头按顺序恰好 6 列" '["名称","Token","状态","使用","最近使用","操作"]' "$(p heads)"
    pass "① 列头原样：$(p heads)"
    eq "① 行展开箭头命中数（须 0）" 0 "$(p expand_icons)"
    eq "① pm-token-expand-* 命中数（须 0）" 0 "$(p expand_testids)"
    eq "① pm-token-details-* 命中数（须 0）" 0 "$(p details_testids)"
    eq "① pm-token-lastused-* 命中数（须 0）" 0 "$(p lastused_testids)"

    echo "  ② 长名夹具（$(python3 -c "print(len('$LONG_NAME'))") 字符）：$LONG_NAME"
    echo "  ② 期望单元格文本：$(p long_name_expected)"
    pass "  ② 实际单元格：$(p name_cell)"
    eq "② 单元格文本 == 前 20 字符 + 省略号" true "$(p name_truncated_matches)"
    eq "② 单元格 title == 完整名称" true "$(p name_title_is_full)"

    echo "  ③ 期望掩码：$(p expected_mask)"
    pass "  ③ 页面上的掩码：$(p masks)"
    eq "③ 掩码 == 前 5 + ... + 后 4（与明文逐字对照）" true "$(p mask_matches_expected)"
    eq "③ 页面文本里**不出现完整明文**" false "$(p full_plaintext_in_page)"

    eq "④ 已撤销行「使用」列 = —" "—" "$(p revoked_use_cell)"
    eq "④ 已撤销行**没有**「复制」按钮" false "$(p revoked_row_has_copy)"
    pass "④ 复制后的真粘贴读回（脱敏）：$(p pasted_masked) ｜ 期望（脱敏）：$(p expected_masked)"
    eq "④ 真鼠标「复制」→ Ctrl+V 粘贴内容 == 明文" true "$(p clipboard_equals_plaintext)"
    pass "④ 点击后的提示：$(p toast_after_copy)"
    eq "④ 点击「复制」时**没有**发 reveal 请求（前后次数相同）" "$(p reveal_count_before_click)" "$(p reveal_count_after_click)"

    echo "  ⑤ 行分区：有效 $(p valid_rows) 行 / 已撤销 $(p revoked_rows) 行"
    eq "⑤ 有效行每行都有「撤销」（数量 == 有效行数）" "$(p valid_rows)" "$(p valid_row_revoke_buttons)"
    eq "⑤ 有效行**没有**「删除」按钮" 0 "$(p valid_row_delete_buttons)"
    eq "⑤ 已撤销行**没有**「撤销」按钮" 0 "$(p revoked_row_revoke_buttons)"
    eq "⑤ 已撤销行每行都有「删除」（数量 == 已撤销行数）" "$(p revoked_rows)" "$(p revoked_row_delete_buttons)"
    eq "⑤ 已撤销行有「删除」" true "$(p revoked_row_has_delete)"
    eq "⑤ 已撤销行**没有**「撤销」" false "$(p revoked_row_has_revoke)"
    pass "⑤ 删除二次确认：$(p delete_confirm_text)"
    eq "⑤ 真鼠标删除后行消失（行数 -1）" "true" "$(python3 -c "
import sys
print('true' if int(sys.argv[1]) == int(sys.argv[2]) - 1 else 'false')
" "$(p rows_after_delete)" "$(p rows_before_delete)")"
    eq "⑤ 直查库：该 id 行数 = 0" 0 "$(q "SELECT COUNT(*) FROM api_tokens WHERE id=$ID_B;")"

    pass "⑥ 最近使用列原样：$(p last_used_cells)"
    eq "⑥ 形态匹配 YYYY/MM/DD HH:mm" true "$(p last_used_format_ok)"
    eq "⑥ 从未使用显示 —" true "$(p last_used_never_shows_dash)"

    echo "  ⑦ 抽屉宽度 = $(p drawer_width)｜表格 client=$(p table_client) / scroll=$(p table_scroll)"
    eq "⑦ 抽屉宽度 ≤ 640" "true" "$(python3 -c "
import sys
print('true' if int(sys.argv[1]) <= 640 else 'false')
" "$(p drawer_width)")"
    eq "⑦ 表格无横向滚动（scrollWidth <= clientWidth）" true "$(p table_no_hscroll)"
    eq "⑦ 暗色下同样无横向滚动（宽 $(p dark_drawer_width)）" true "$(p dark_table_no_hscroll)"
    eq "⑦ 暗色下列头一致" '["名称","Token","状态","使用","最近使用","操作"]' "$(p dark_heads)"

    eq "⑧ 创建区可用（行数 +1）" "true" "$(python3 -c "
import sys
print('true' if int(sys.argv[1]) == int(sys.argv[2]) + 1 else 'false')
" "$(p rows_after_create)" "$(p rows_before_create)")"
    eq "⑧ 创建提示不变" "已创建；点列表里的「复制」取明文" "$(p toast_after_create)"
    eq "⑧ 创建后仍无明文弹窗" 0 "$(p modal_count_after_create)"
    eq "⑧ 关抽屉后页面无完整明文" false "$(p after_close_has_full_plaintext)"
    eq "⑧ 明文不落 localStorage/sessionStorage/URL" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['local']==0 and s['session']==0 and s['url']==0 else 'false')
" "$(p storage_leak)")"
    eq "页面运行时异常" "[]" "$(p ac38_runtime_errors)"

    line "⑦ 视觉证据（$SHOTS）"
    ls -l "$SHOTS" | sed 's/^/  /'
    eq "截图齐备（亮 / 暗各一张 = 2）" 2 "$(find "$SHOTS" -name '*.png' 2>/dev/null | wc -l)"
  fi

  if [ "$ONLY" = "all" ] || [ "$ONLY" = "regress" ]; then
    line "回归：接口语义未变（FR-95/96/97；本 FR 纯前端）"
    TOK_C_JSON=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"name":"AC101 回归待删"}' "$LAN_BASE/api/tokens")
    ID_C=$(echo "$TOK_C_JSON" | jq -r .id)
    eq "FR-96 未撤销 → 409 token_not_revoked" "409 token_not_revoked" "$(curl -s -w '%{http_code}' -b "$JAR" -X DELETE "$LAN_BASE/api/tokens/$ID_C/permanent" -o "$AC_DIR/e1.json") $(jq -r .error "$AC_DIR/e1.json")"
    curl -s -b "$JAR" -o /dev/null -X DELETE "$LAN_BASE/api/tokens/$ID_C"
    eq "FR-96 已撤销 → 204" 204 "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -X DELETE "$LAN_BASE/api/tokens/$ID_C/permanent")"
    eq "FR-96 不存在 → 404" 404 "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -X DELETE "$LAN_BASE/api/tokens/999999/permanent")"
    eq "FR-95 reveal 仍只允许会话（Bearer → 403）" 403 "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOK_A" -X POST "$LAN_BASE/api/tokens/$ID_A/reveal")"
    eq "FR-95 会话 reveal 与创建明文一致" "true" "$([ "$(curl -s -b "$JAR" -X POST "$LAN_BASE/api/tokens/$ID_A/reveal" | jq -r .token)" = "$TOK_A" ] && echo true || echo false)"
    NEW_JSON=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"name":"AC101 响应形态"}' "$LAN_BASE/api/tokens")
    eq "FR-97 POST /api/tokens 仍含明文一次" "true" "$(echo "$NEW_JSON" | jq -r 'has("token")')"
    eq "列表仍不含明文" "true" "$(python3 -c "
import sys
print('true' if sys.argv[2] not in sys.argv[1] else 'false')
" "$(curl -s -b "$JAR" "$LAN_BASE/api/tokens")" "$TOK_A")"
    eq "日志里无 token 明文" 0 "$(grep -c "$TOK_A" "$SERVER_LOG" || true)"
    eq "迁移版本未被本阶段改动（仍 v4）" 4 "$(q 'SELECT MAX(version) FROM schema_migrations;')"
  fi
fi

line "结论"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ AC-101 全部通过"
else
  echo "  ❌ 有未通过项（见上方 ❌）"
fi
exit "$FAIL"
