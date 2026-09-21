#!/usr/bin/env bash
# 阶段 35 验收自检：
#   AC-95 MCP Streamable HTTP：① 真客户端（官方 Python mcp 1.30.0）握手 + 三工具
#        ② 鉴权负向（无/错 token → 401 且不触碰内部 API）③ 凭据透传（env 无 token 也通、只有请求 token 被用）
#        ④ stdio 不回归（bin/pm-mcp.mjs + env）⑤ 契约与文档 ⑥ 不泄密（日志无明文）
#   AC-96 Token 可随时查看：① 迁移 v4 + token_enc ② 新建可查看且与创建明文逐字相同 ③ 旧 token 409 但鉴权可用
#        ④ Bearer 调 reveal → 403 ⑤ 密文落库 + 密钥 600 + 重启仍可查看 ⑥ UI 复制（真鼠标 + 剪贴板读回）
#        ⑦ 密钥缺失/恢复 ⑧ 不泄密
#
# 服务**自起自停**（临时 DATA_DIR + 台账范围内备用端口）；不碰 8767 测试环境、不碰 106 生产。
# 用法：bash tools/ac-stage35.sh [all|mcp|token]
set -u
set -o pipefail

cd "$(dirname "$0")/.." || exit 1
ONLY=${1:-all}
PORT=${PORT:-auto}
AC_PW='ac-fixture-pw-20260918'
AC_USER='admin'
SHOTS='tmp/shots/stage35'
PY='.venv/bin/python'
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
AC_DIR=$(mktemp -d /tmp/pm-ac35-XXXXXX)
DB="$AC_DIR/pm.db"
q() { sqlite3 "$DB" "$1"; }

line "构建 + 本阶段新增单测"
npm run build >"$AC_DIR/build.log" 2>&1
eq "npm run build 退出码" 0 "$?"
node --test tests/stage35-mcp-http.test.ts tests/stage35-token-reveal.test.ts >"$AC_DIR/unit.log" 2>&1
eq "新单测退出码" 0 "$?"
grep -E "^ℹ (tests|pass|fail)" "$AC_DIR/unit.log" | sed 's/^/  /'

line "AC-96 ①：迁移到 v4（临时库）+ 列存在"
printf '%s\n' "$AC_PW" | DATA_DIR="$AC_DIR" node bin/pm.mjs user set-password --username "$AC_USER" >/dev/null
echo "  \$ DATA_DIR=<tmp> npm run migrate"
DATA_DIR="$AC_DIR" npm run migrate 2>&1 | grep -v '^$' | tail -3 | sed 's/^/  /'
eq "① migrate 输出 ok: schema at v4" 1 "$(DATA_DIR="$AC_DIR" npm run migrate 2>&1 | grep -c 'ok: schema at v4')"
eq "① api_tokens 有 token_enc 列" 1 "$(q "SELECT COUNT(*) FROM pragma_table_info('api_tokens') WHERE name='token_enc';")"

line "运行时：临时实例（DATA_DIR=$AC_DIR，PORT=$PORT；**故意不设 PM_API_TOKEN**）"
DATA_DIR="$AC_DIR" PORT="$PORT" PM_API_URL="$BASE" node dist/server/index.js >"$AC_DIR/server.log" 2>&1 &
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
  pass "服务已起：$BASE/healthz = 200（env 里**没有** PM_API_TOKEN）"
  JAR="$AC_DIR/jar.txt"
  curl -s -c "$JAR" -o /dev/null -X POST -H 'Content-Type: application/json' \
    -d "{\"username\":\"$AC_USER\",\"password\":\"$AC_PW\"}" "$BASE/api/login"
  SID=$(awk '$6 == "pm_sid" { print $7 }' "$JAR" | tail -1)
  [ -z "$SID" ] && fail "登录失败，拿不到 pm_sid"

  mkprompt() { python3 -c "
import json,sys
print(json.dumps({'title': sys.argv[1], 'user_prompt': sys.argv[2]}, ensure_ascii=False))
" "$1" "$2" | curl -s -b "$JAR" -H 'Content-Type: application/json' -d @- "$BASE/api/prompts" | jq -r .id; }
  mkprompt_json() { python3 -c "
import json,sys
print(json.dumps({'name': sys.argv[1]}, ensure_ascii=False))
" "$1" | curl -s -b "$JAR" -H 'Content-Type: application/json' -d @- "$BASE/api/tokens"; }

  PID=$(mkprompt 'AC35 MCP 夹具' '你好 {{姓名}}')
  TOK_A_JSON=$(mkprompt_json 'AC35 token A')
  TOK_A=$(echo "$TOK_A_JSON" | jq -r .token)
  ID_A=$(echo "$TOK_A_JSON" | jq -r .id)
  TOK_B_JSON=$(mkprompt_json 'AC35 token B')
  ID_B=$(echo "$TOK_B_JSON" | jq -r .id)
  TOK_OLD_JSON=$(mkprompt_json 'AC35 旧令牌')
  TOK_OLD=$(echo "$TOK_OLD_JSON" | jq -r .token)
  ID_OLD=$(echo "$TOK_OLD_JSON" | jq -r .id)
  # 模拟"迁移前创建的旧令牌"：清掉密文
  q "UPDATE api_tokens SET token_enc = NULL WHERE id = $ID_OLD;"
  pass "夹具：prompt=$PID ｜ token A(id=$ID_A $(mask "$TOK_A")) ｜ token B(id=$ID_B) ｜ 旧令牌(id=$ID_OLD $(mask "$TOK_OLD"))"

  if [ "$ONLY" = "all" ] || [ "$ONLY" = "mcp" ]; then
    line "AC-95 ①②③：真客户端（官方 Python mcp 1.30.0）+ 鉴权负向 + 凭据透传"
    echo "  \$ .venv/bin/python tools/mcp-http-smoke.py $BASE/mcp <token A> $PID"
    "$PY" tools/mcp-http-smoke.py "$BASE/mcp" "$TOK_A" "$PID" >"$AC_DIR/mcp.log" 2>&1
    MCP_RC=$?
    grep -E '^(server_name|server_version|tool_names|tool_count|search_isError|get_isError|render_isError)=' "$AC_DIR/mcp.log" | sed 's/^/  /'
    eq "① 真客户端退出码" 0 "$MCP_RC"
    eq "① 工具面恰好三个只读工具" "prompt_search,prompt_get,prompt_render" "$(grep -m1 '^tool_names=' "$AC_DIR/mcp.log" | cut -d= -f2-)"
    eq "① prompt_search 成功且命中夹具" "true" "$(python3 -c "
import re,sys
src = open('$AC_DIR/mcp.log', encoding='utf-8').read()
line = [l for l in src.splitlines() if l.startswith('search_text=')]
print('true' if line and 'AC35 MCP 夹具' in line[0] and 'search_isError=False' in src else 'false')
")"
    eq "① prompt_get 返回正文与变量" "true" "$(python3 -c "
src = open('$AC_DIR/mcp.log', encoding='utf-8').read()
line = [l for l in src.splitlines() if l.startswith('get_text=')]
print('true' if line and '你好 {{姓名}}' in line[0] and '姓名' in line[0] and 'get_isError=False' in src else 'false')
")"
    eq "① prompt_render 渲染正确" "true" "$(python3 -c "
src = open('$AC_DIR/mcp.log', encoding='utf-8').read()
print('true' if '你好 世界' in src and 'render_isError=False' in src else 'false')
")"

    # ② 鉴权负向 + 未触碰内部 API
    BEFORE_USAGE=$(q "SELECT COUNT(*) FROM usage_events WHERE prompt_id=$PID;")
    echo "  \$ curl -X POST $BASE/mcp（不带 Authorization）"
    eq "② 无 Authorization → 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
      -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"prompt_get\",\"arguments\":{\"id\":$PID}}}" "$BASE/mcp")"
    echo "  \$ curl -X POST $BASE/mcp（Bearer 错 token）"
    eq "② 错 token → 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Authorization: Bearer pm_wrong-token' -H 'Content-Type: application/json' \
      -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"prompt_get\",\"arguments\":{\"id\":$PID}}}" "$BASE/mcp")"
    eq "② 两次 401 都没去调内部 API（usage_events 未增加）" "$BEFORE_USAGE" "$(q "SELECT COUNT(*) FROM usage_events WHERE prompt_id=$PID;")"

    # ③ 凭据透传：只有 A 被标记使用；usage 记 mcp 通道
    eq "③ token A 被标记使用（last_used_at 非空）" 1 "$(q "SELECT last_used_at IS NOT NULL FROM api_tokens WHERE id=$ID_A;")"
    eq "③ token B 一次都没被用过（证明没有回退到 env/别的凭据）" 0 "$(q "SELECT last_used_at IS NOT NULL FROM api_tokens WHERE id=$ID_B;")"
    echo "  \$ sqlite3 pm.db \"SELECT prompt_id, channel, COUNT(*) FROM usage_events GROUP BY 1,2;\""
    q "SELECT prompt_id, channel, COUNT(*) FROM usage_events GROUP BY 1,2;" | sed 's/^/  /'
    eq "③ usage 记到 mcp 通道（prompt_get + prompt_render ≥2 条）" "true" "$(python3 -c "
import sys
n = int(sys.argv[1]); print('true' if n >= 2 else 'false')
" "$(q "SELECT COUNT(*) FROM usage_events WHERE prompt_id=$PID AND channel='mcp';")")"
    echo "  \$ curl -s $BASE/api/usage/summary?days=1（会话）"
    curl -s -b "$JAR" "$BASE/api/usage/summary?days=1" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("  by_channel =", d["by_channel"])'

    line "AC-95 ④：stdio 不回归（bin/pm-mcp.mjs + env 方式）"
    echo "  \$ PM_API_URL=$BASE PM_API_TOKEN=<token A> .venv/bin/python tools/mcp-client-smoke.py AC35 $PID"
    PM_API_URL="$BASE" PM_API_TOKEN="$TOK_A" "$PY" tools/mcp-client-smoke.py 'AC35' "$PID" >"$AC_DIR/stdio.log" 2>&1
    STDIO_RC=$?
    grep -E '^\{' "$AC_DIR/stdio.log" | head -3 | cut -c1-160 | sed 's/^/  /'
    eq "④ stdio 握手与三工具调用退出码" 0 "$STDIO_RC"
    eq "④ stdio tools/list = 三个工具" "true" "$(python3 -c "
import json,sys
ok = False
for line in open('$AC_DIR/stdio.log', encoding='utf-8'):
    if line.startswith('{'):
        d = json.loads(line)
        if d.get('step') == 'tools/list' and sorted(d['tools']) == ['prompt_get','prompt_render','prompt_search']:
            ok = True
print('true' if ok else 'false')
")"

    line "AC-95 ⑤：契约与文档"
    eq "⑤ docs/api.md 有 /mcp 契约（方法/必需头/401/无状态）" "true" "$(python3 -c "
src = open('docs/api.md', encoding='utf-8').read()
ok = all(k in src for k in ['POST /mcp', 'Authorization: Bearer', '401', '无状态'])
print('true' if ok else 'false')
")"
    eq "⑤ README 有「远程 MCP 接入」且不含内部术语" "true" "$(python3 -c "
import re
src = open('README.md', encoding='utf-8').read()
has = '远程 MCP 接入' in src and '/mcp' in src and 'Authorization' in src
clean = len(re.findall(r'AC-[0-9]|FR-[0-9]|阶段 [0-9]+', src)) == 0
print('true' if has and clean else 'false')
")"
    eq "⑤ AGENTS.md 有英文一行（Streamable HTTP + /mcp）" "true" "$(python3 -c "
src = open('AGENTS.md', encoding='utf-8').read()
print('true' if 'Streamable HTTP' in src and 'POST /mcp' in src else 'false')
")"
    eq "⑤ deploy/container.md 说明反代路径与 Authorization 透传" "true" "$(python3 -c "
src = open('deploy/container.md', encoding='utf-8').read()
print('true' if 'location /mcp' in src and 'Authorization' in src else 'false')
")"

    line "AC-95 ⑥：不泄密（服务日志里搜不到 token 明文）"
    eq "⑥ token A 明文在日志里出现次数" 0 "$(grep -c "$TOK_A" "$AC_DIR/server.log" || true)"
    eq "⑥ token B 明文在日志里出现次数" 0 "$(grep -c "$TOK_B_JSON" "$AC_DIR/server.log" || true)"
    eq "⑥ 旧令牌明文在日志里出现次数" 0 "$(grep -c "$TOK_OLD" "$AC_DIR/server.log" || true)"
  fi

  if [ "$ONLY" = "all" ] || [ "$ONLY" = "token" ]; then
    line "AC-96 ②：新建可查看（reveal 与创建明文逐字相同；列表 revealable 且不含明文）"
    echo "  \$ curl -X POST $BASE/api/tokens/$ID_A/reveal（会话 cookie）"
    REVEAL=$(curl -s -b "$JAR" -X POST "$BASE/api/tokens/$ID_A/reveal")
    REVEALED=$(printf '%s' "$REVEAL" | jq -r .token)
    echo "  返回明文（脱敏）：$(mask "$REVEALED")"
    eq "② reveal 与创建响应里的明文逐字相同" "true" "$([ "$REVEALED" = "$TOK_A" ] && echo true || echo false)"
    LIST=$(curl -s -b "$JAR" "$BASE/api/tokens")
    echo "  \$ curl -s $BASE/api/tokens"
    printf '%s' "$LIST" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("  ", [(t["id"], t["name"], t["revealable"]) for t in d["items"]])'
    eq "② 列表该条 revealable=true" true "$(printf '%s' "$LIST" | jq -r ".items[] | select(.id==$ID_A) | .revealable")"
    eq "② 列表响应不含明文" "true" "$(python3 -c "
import sys
body = sys.argv[1]; tok = sys.argv[2]
print('true' if tok not in body and 'pm_' not in body else 'false')
" "$LIST" "$TOK_A")"

    line "AC-96 ③④：旧 token 两态 + reveal 权限"
    eq "③ 旧令牌 revealable=false" false "$(printf '%s' "$LIST" | jq -r ".items[] | select(.id==$ID_OLD) | .revealable")"
    echo "  \$ curl -X POST $BASE/api/tokens/$ID_OLD/reveal（会话）"
    OLD_REVEAL=$(curl -s -w '\n%{http_code}' -b "$JAR" -X POST "$BASE/api/tokens/$ID_OLD/reveal")
    eq "③ 旧令牌 reveal → 409" 409 "$(printf '%s' "$OLD_REVEAL" | tail -1)"
    eq "③ 错误码 token_not_revealable" token_not_revealable "$(printf '%s' "$OLD_REVEAL" | head -1 | jq -r .error)"
    eq "③ 旧令牌鉴权仍可用（打 /api/prompts → 200）" 200 "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOK_OLD" "$BASE/api/prompts")"
    echo "  \$ curl -X POST $BASE/api/tokens/$ID_A/reveal（Bearer，不允许自窥）"
    eq "④ Bearer 调 reveal → 403 session_required" 403 "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOK_A" -X POST "$BASE/api/tokens/$ID_A/reveal")"
    eq "④ 完全不认证 → 401（闸门）" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/tokens/$ID_A/reveal")"

    line "AC-96 ⑤⑦：密文落库 / 密钥 600 / 重启仍可查看 / 密钥缺失与恢复"
    echo "  \$ sqlite3 pm.db \"SELECT id, substr(token_enc,1,20), token_enc LIKE '%pm_%' FROM api_tokens;\""
    q "SELECT id, substr(token_enc,1,20), length(token_enc), substr(token_enc,1,3)='pm_' FROM api_tokens;" | sed 's/^/  /'
    # ⚠️ 口径：判据是"**不含 `pm_` 前缀**"（= 不以明文开头），不是"全文任何位置都不出现 pm_" ——
    # base64 字符集含 p/m/_，密文里**偶然出现**子串 `pm_` 完全正常（本阶段首版就踩了这个假红）。
    eq "⑤ 可查看行的密文不以 pm_ 开头（不是明文）" 0 "$(q "SELECT substr(token_enc,1,3)='pm_' FROM api_tokens WHERE id=$ID_A;")"
    eq "⑤ 密文长度符合 base64(12+16+46 字节) ≈ 100 字符" "true" "$(python3 -c "
import sys
n = int(sys.argv[1]); print('true' if 96 <= n <= 104 else 'false')
" "$(q "SELECT length(token_enc) FROM api_tokens WHERE id=$ID_A;")")"
    eq "⑤ 密文 ≠ 明文（逐字比较）" "true" "$(python3 -c "
import sqlite3, sys
enc = sqlite3.connect('$DB').execute('SELECT token_enc FROM api_tokens WHERE id=$ID_A').fetchone()[0]
print('true' if enc != '''$TOK_A''' else 'false')
")"
    echo "  \$ ls -l <DATA_DIR>/token-enc.key"
    ls -l "$AC_DIR/token-enc.key" | awk '{print "  ", $1, $NF}'
    eq "⑤ 密钥文件权限 600" "-rw-------" "$(stat -c '%A' "$AC_DIR/token-enc.key")"

    # 重启服务（同一 DATA_DIR）→ 仍能 reveal
    kill "$SRV_PID" 2>/dev/null; sleep 1
    DATA_DIR="$AC_DIR" PORT="$PORT" PM_API_URL="$BASE" node dist/server/index.js >>"$AC_DIR/server.log" 2>&1 &
    SRV_PID=$!
    for _ in $(seq 1 60); do
      [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/healthz" 2>/dev/null || true)" = "200" ] && break
      sleep 0.3
    done
    JAR2="$AC_DIR/jar2.txt"
    curl -s -c "$JAR2" -o /dev/null -X POST -H 'Content-Type: application/json' \
      -d "{\"username\":\"$AC_USER\",\"password\":\"$AC_PW\"}" "$BASE/api/login"
    eq "⑤ 重启后仍能 reveal（密钥与密文都持久）" "true" "$([ "$(curl -s -b "$JAR2" -X POST "$BASE/api/tokens/$ID_A/reveal" | jq -r .token)" = "$TOK_A" ] && echo true || echo false)"

    # ⑦ 密钥缺失 → 明确错误；恢复 → 又能查看
    mv "$AC_DIR/token-enc.key" "$AC_DIR/token-enc.key.bak"
    MISSING=$(curl -s -w '\n%{http_code}' -b "$JAR2" -X POST "$BASE/api/tokens/$ID_A/reveal")
    echo "  \$ （临时移走密钥文件）curl -X POST .../reveal"
    echo "  $(printf '%s' "$MISSING" | head -1 | cut -c1-120)"
    eq "⑦ 密钥缺失 → 500 token_enc_key_unavailable（明确错误、不崩）" "500 token_enc_key_unavailable" "$(printf '%s' "$MISSING" | tail -1) $(printf '%s' "$MISSING" | head -1 | jq -r .error)"
    eq "⑦ 错误体不含明文" "true" "$(python3 -c "
import sys
print('true' if sys.argv[2] not in sys.argv[1] else 'false')
" "$MISSING" "$TOK_A")"
    eq "⑦ 密钥缺失时鉴权仍可用（Bearer 打 /api/prompts → 200）" 200 "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOK_A" "$BASE/api/prompts")"
    rm -f "$AC_DIR/token-enc.key"   # 清掉"自动生成的新密钥"
    mv "$AC_DIR/token-enc.key.bak" "$AC_DIR/token-enc.key"
    eq "⑦ 恢复密钥后仍可 reveal" "true" "$([ "$(curl -s -b "$JAR2" -X POST "$BASE/api/tokens/$ID_A/reveal" | jq -r .token)" = "$TOK_A" ] && echo true || echo false)"

    line "AC-96 ⑥：UI —— 真鼠标点「复制」+ 剪贴板读回（旧令牌显示不可查看）"
    rm -rf "$SHOTS"
    AC35_EXPECT_TOKEN="$TOK_A" AC35_LEGACY_ID="$ID_OLD" node tools/ac-stage35-probe.mjs tokens "$BASE" "$SID" "$SHOTS" | tee "$AC_DIR/probe.log"
    pr() { grep -m1 "^$1=" "$AC_DIR/probe.log" | cut -d= -f2-; }
    eq "⑥ 「复制」按钮存在" true "$(pr copy_button_present)"
    eq "⑥ 真鼠标点击后剪贴板内容 == reveal 返回的明文" true "$(pr clipboard_matches_expected)"
    pass "⑥ 剪贴板（脱敏）：$(pr clipboard_masked) ｜ 期望（脱敏）：$(pr expected_masked)"
    eq "⑥ 旧令牌显示「不可查看」提示" true "$(pr legacy_hint_present)"
    pass "⑥ 提示文案：$(pr legacy_hint_text)"
    eq "⑥ 令牌表三行（token A / token B / 旧令牌）" 3 "$(pr rows)"
    eq "⑥ 页面运行时异常" "[]" "$(pr ac35_runtime_errors)"
    ls -l "$SHOTS" | sed 's/^/  /'

    line "AC-96 ⑧：不泄密（日志与列表响应都不含明文）"
    eq "⑧ 应用日志里 token A 明文出现次数" 0 "$(grep -c "$TOK_A" "$AC_DIR/server.log" || true)"
    eq "⑧ 应用日志里 token B 明文出现次数" 0 "$(grep -c "$TOK_B_JSON" "$AC_DIR/server.log" || true)"
    eq "⑧ reveal 成功有日志（≥1 条）且**不含值**" "true" "$(python3 -c "
import sys
print('true' if int(sys.argv[1]) >= 1 else 'false')
" "$(grep -c 'token revealed' "$AC_DIR/server.log" || true)")"
    eq "⑧ 列表响应不含 pm_ 明文" "true" "$(python3 -c "
import sys
body = sys.argv[1]
print('true' if 'pm_' not in body else 'false')
" "$(curl -s -b "$JAR2" "$BASE/api/tokens")")"

    line "AC-96：CLI token reveal（本机管理路径，读同一密钥）"
    echo "  \$ DATA_DIR=<tmp> node bin/pm.mjs token reveal $ID_A"
    CLI_OUT=$(DATA_DIR="$AC_DIR" node bin/pm.mjs token reveal "$ID_A" 2>"$AC_DIR/cli-reveal.err")
    CLI_RC=$?
    eq "CLI token reveal 退出码" 0 "$CLI_RC"
    eq "CLI token reveal 输出 == 明文" "true" "$([ "$CLI_OUT" = "$TOK_A" ] && echo true || echo false)"
    sed 's/^/  /' "$AC_DIR/cli-reveal.err"
    eq "CLI 提示行不含明文" "true" "$(python3 -c "
import sys
print('true' if sys.argv[2] not in open(sys.argv[1], encoding='utf-8').read() else 'false')
" "$AC_DIR/cli-reveal.err" "$TOK_A")"
  fi
fi

line "结论"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ AC-95 / AC-96 全部通过"
else
  echo "  ❌ 有未通过项（见上方 ❌）"
fi
exit "$FAIL"
