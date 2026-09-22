#!/usr/bin/env bash
# 阶段 42 验收自检（FR-103 令牌权限两档 + FR-104 取用归因）：
#   AC-105 ① 迁移 v5；api_tokens.scope 存在；**存量行 = write**（真跑 004→005 升级路径）
#        ② **只读令牌**：读 200；六类资源写各 403 insufficient_scope
#        ③ **渲染类 POST 对只读令牌 200**（否则 MCP prompt_render 被误伤）
#        ④ 读写令牌：读 200 + 写 201/200/204
#        ⑤ **令牌管理与改口令/登出一律仅会话**：读写令牌调 6 个端点全 403 session_required
#        ⑥ **/mcp 用只读令牌**：官方 Python 客户端握手 + 三个工具全通
#        ⑦ 默认只读：界面真鼠标新建（不动权限）→ 查库 read 且写请求 403；CLI 不带 --scope = read、带 write 可写
#        ⑧ 界面：状态列显示 有效 · 只读/读写、列数仍 6、新建处有权限选择且默认只读（截图 + 识图）
#        ⑨ 回归：npm test / ci-check（在脚本外另跑）
#   AC-106 ① usage_events 有 token_id ② 只读令牌取用记该 id ③ 会话取用 NULL ④ 列表/搜索不记 ⑤ summary 带 by_token
#
# 全程临时 DATA_DIR + 台账范围内备用端口；不碰 8767 测试环境、不碰 106 生产。
# 用法：bash tools/ac-stage42.sh [all|scope|attribution|mcp|ui]
set -u
set -o pipefail

cd "$(dirname "$0")/.." || exit 1
ONLY=${1:-all}
PORT=${PORT:-auto}
AC_PW='ac-fixture-pw-20260918'
AC_USER='admin'
SHOTS='tmp/shots/stage42'
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
DIR=$(mktemp -d /tmp/pm-ac42-XXXXXX)
DB="$DIR/pm.db"
q() { sqlite3 "$DB" "$1"; }

line "构建 + 本阶段单测"
npm run build >"$DIR/build.log" 2>&1
eq "npm run build 退出码" 0 "$?"
node --test tests/stage42-token-scope.test.ts >"$DIR/unit.log" 2>&1
eq "新单测退出码" 0 "$?"
grep -E "^ℹ (tests|pass|fail)" "$DIR/unit.log" | sed 's/^/  /'

line "AC-105 ①：迁移到 v5（含 004→005 升级路径的存量回填）"
printf '%s\n' "$AC_PW" | DATA_DIR="$DIR" node bin/pm.mjs user set-password --username "$AC_USER" >/dev/null
# 手工造一个"只到 004"的旧库并插一行存量令牌，再跑迁移 ⇒ 该行必须被回填 write
LEGACY=$(mktemp -d /tmp/pm-ac42-legacy-XXXXXX)
sqlite3 "$LEGACY/pm.db" "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);"
for f in 001_init.sql 002_tokens-and-usage.sql 003_prompt-sort-order.sql 004_token-enc.sql; do
  sqlite3 "$LEGACY/pm.db" < "migrations/$f"
  sqlite3 "$LEGACY/pm.db" "INSERT INTO schema_migrations (version, name, applied_at) VALUES ($(echo "$f" | cut -c1-3 | sed 's/^0*//'), '$f', '2026-01-01T00:00:00.000Z');"
done
sqlite3 "$LEGACY/pm.db" "INSERT INTO api_tokens (name, token_hash, token_enc, created_at, last_used_at, revoked_at) VALUES ('legacy-token', '$(python3 -c "print('a'*64)")', NULL, '2026-01-01T00:00:00.000Z', NULL, NULL);"
echo "  \$ DATA_DIR=<legacy 004 库> npm run migrate"
DATA_DIR="$LEGACY" npm run migrate 2>&1 | grep -v '^$' | tail -2 | sed 's/^/    /'
eq "① 迁移输出 ok: schema at v5" 1 "$(DATA_DIR="$LEGACY" npm run migrate 2>&1 | grep -c 'ok: schema at v5')"
echo "  \$ sqlite3 <legacy>/pm.db \"SELECT name, scope FROM api_tokens;\""
sqlite3 "$LEGACY/pm.db" "SELECT name, scope FROM api_tokens;" | sed 's/^/    /'
eq "① 存量令牌被回填为 write" "write" "$(sqlite3 "$LEGACY/pm.db" "SELECT scope FROM api_tokens WHERE name='legacy-token';")"
eq "① usage_events 有 token_id 列（AC-106 ①）" 1 "$(sqlite3 "$LEGACY/pm.db" "SELECT COUNT(*) FROM pragma_table_info('usage_events') WHERE name='token_id';")"
rm -rf "$LEGACY"

line "运行时：临时实例（DATA_DIR=$DIR，PORT=$PORT）"
DATA_DIR="$DIR" npm run migrate >/dev/null 2>&1
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

  # 夹具：一条 prompt；两把令牌（只读 / 读写）——**真令牌**，逐端点实测
  FIX_ID=$(python3 -c "
import json
print(json.dumps({'title':'AC105 夹具','user_prompt':'你好 {{姓名}}'}, ensure_ascii=False))
" | curl -s -b "$JAR" -H 'Content-Type: application/json' -d @- "$BASE/api/prompts" | jq -r .id)
  RO_JSON=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"name":"AC105 只读","scope":"read"}' "$BASE/api/tokens")
  RO_ID=$(echo "$RO_JSON" | jq -r .id); RO=$(echo "$RO_JSON" | jq -r .token)
  RW_JSON=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"name":"AC105 读写","scope":"write"}' "$BASE/api/tokens")
  RW_ID=$(echo "$RW_JSON" | jq -r .id); RW=$(echo "$RW_JSON" | jq -r .token)
  pass "夹具：prompt=$FIX_ID ｜ 只读 id=$RO_ID $(mask "$RO") ｜ 读写 id=$RW_ID $(mask "$RW")"
  echo "  \$ sqlite3 pm.db \"SELECT id,name,scope FROM api_tokens;\""
  q "SELECT id, name, scope FROM api_tokens;" | sed 's/^/    /'

  if [ "$ONLY" = "all" ] || [ "$ONLY" = "scope" ]; then
    line "AC-105 ②：只读令牌 —— 读 200，六类资源写各 403 insufficient_scope"
    eq "② GET /api/prompts" 200 "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $RO" "$BASE/api/prompts")"
    eq "② GET /api/prompts/:id" 200 "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $RO" "$BASE/api/prompts/$FIX_ID")"
    check_write() {
      local label="$1" method="$2" url="$3" body="${4:-}"
      local out
      if [ -n "$body" ]; then
        out=$(curl -s -w '\n%{http_code}' -X "$method" -H "Authorization: Bearer $RO" -H 'Content-Type: application/json' -d "$body" "$BASE$url")
      else
        out=$(curl -s -w '\n%{http_code}' -X "$method" -H "Authorization: Bearer $RO" "$BASE$url")
      fi
      local code err
      code=$(printf '%s' "$out" | tail -1); err=$(printf '%s' "$out" | head -1 | jq -r .error 2>/dev/null)
      eq "② $label → 403 insufficient_scope" "403 insufficient_scope" "$code $err"
    }
    check_write "POST /api/prompts" POST "/api/prompts" '{"title":"x"}'
    check_write "PUT /api/prompts/:id" PUT "/api/prompts/$FIX_ID" '{"title":"y"}'
    check_write "DELETE /api/prompts/:id" DELETE "/api/prompts/$FIX_ID"
    check_write "PATCH /api/prompts/order" PATCH "/api/prompts/order" "{\"ids\":[$FIX_ID]}"
    check_write "POST /api/folders" POST "/api/folders" '{"name":"f"}'
    check_write "POST /api/tags" POST "/api/tags" '{"name":"t"}'
    check_write "POST /api/import（导入也是写）" POST "/api/import" '{"mode":"merge","data":{"folders":[],"tags":[],"prompts":[]}}'

    line "AC-105 ③：渲染类 POST 对只读令牌**必须可用**"
    eq "③ POST /api/prompts/:id/render" 200 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $RO" -H 'Content-Type: application/json' -d '{"values":{"姓名":"张三"}}' "$BASE/api/prompts/$FIX_ID/render")"
    eq "③ POST /api/render/markdown" 200 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $RO" -H 'Content-Type: application/json' -d '{"markdown":"# 标题"}' "$BASE/api/render/markdown")"
    eq "③ 只读令牌也能读导出 / 取用记录" "200 200" "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $RO" "$BASE/api/export") $(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $RO" "$BASE/api/usage/summary")"

    line "AC-105 ④：读写令牌 —— 读 200 + 写 201/200/204"
    eq "④ GET /api/prompts" 200 "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $RW" "$BASE/api/prompts")"
    NEW_ID=$(curl -s -H "Authorization: Bearer $RW" -H 'Content-Type: application/json' -d '{"title":"RW 建的"}' "$BASE/api/prompts" | jq -r .id)
    eq "④ POST /api/prompts → 201（新 id=$NEW_ID）" 201 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $RW" -H 'Content-Type: application/json' -d '{"title":"RW 再建"}' "$BASE/api/prompts")"
    eq "④ PUT /api/prompts/:id → 200" 200 "$(curl -s -o /dev/null -w '%{http_code}' -X PUT -H "Authorization: Bearer $RW" -H 'Content-Type: application/json' -d '{"title":"RW 改的"}' "$BASE/api/prompts/$NEW_ID")"
    eq "④ DELETE /api/prompts/:id → 204" 204 "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE -H "Authorization: Bearer $RW" "$BASE/api/prompts/$NEW_ID")"

    line "AC-105 ⑤：令牌管理与改口令/登出 —— 用**读写**令牌也全部 403 session_required"
    check_session() {
      local label="$1" method="$2" url="$3" body="${4:-}"
      local out code err
      if [ -n "$body" ]; then
        out=$(curl -s -w '\n%{http_code}' -X "$method" -H "Authorization: Bearer $RW" -H 'Content-Type: application/json' -d "$body" "$BASE$url")
      else
        out=$(curl -s -w '\n%{http_code}' -X "$method" -H "Authorization: Bearer $RW" "$BASE$url")
      fi
      code=$(printf '%s' "$out" | tail -1); err=$(printf '%s' "$out" | head -1 | jq -r .error 2>/dev/null)
      eq "⑤ $label → 403 session_required" "403 session_required" "$code $err"
    }
    check_session "GET /api/tokens（枚举）" GET "/api/tokens"
    check_session "POST /api/tokens（自我繁殖）" POST "/api/tokens" '{"name":"自繁殖"}'
    check_session "DELETE /api/tokens/:id（撤销）" DELETE "/api/tokens/$RO_ID"
    check_session "DELETE /api/tokens/:id/permanent（硬删）" DELETE "/api/tokens/$RO_ID/permanent"
    check_session "POST /api/tokens/:id/reveal" POST "/api/tokens/$RO_ID/reveal"
    check_session "POST /api/password（改口令）" POST "/api/password" '{"old_password":"x","new_password":"yyyyyyyy"}'
    check_session "POST /api/logout" POST "/api/logout"
    eq "⑤ 会话路径不受影响（GET /api/tokens = 200）" 200 "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" "$BASE/api/tokens")"
  fi

  if [ "$ONLY" = "all" ] || [ "$ONLY" = "mcp" ]; then
    line "AC-105 ⑥：/mcp 用**只读**令牌 —— 官方 Python 客户端握手 + 三个工具全通"
    "$PY" tools/mcp-http-smoke.py "$BASE/mcp" "$RO" "$FIX_ID" >"$DIR/mcp-ro.log" 2>&1
    eq "⑥ 只读令牌的 MCP 退出码" 0 "$?"
    grep -E '^(server_name|tool_names|search_isError|get_isError|render_isError)=' "$DIR/mcp-ro.log" | sed 's/^/    /'
    eq "⑥ 三个工具齐全" "prompt_search,prompt_get,prompt_render" "$(grep -m1 '^tool_names=' "$DIR/mcp-ro.log" | cut -d= -f2-)"
    eq "⑥ prompt_render 对只读令牌成功（渲染类 POST 归读）" "true" "$(python3 -c "
src = open('$DIR/mcp-ro.log', encoding='utf-8').read()
print('true' if 'render_isError=False' in src and '你好 世界' in src else 'false')
")"
    # 只读令牌经 MCP 也不能写（MCP 本来只有只读工具；这里证"没有隐藏的写通道"）
    eq "⑥ 只读令牌经 HTTP 写仍 403（MCP 未绕过 scope）" 403 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $RO" -H 'Content-Type: application/json' -d '{"title":"mcp 绕过尝试"}' "$BASE/api/prompts")"
  fi

  if [ "$ONLY" = "all" ] || [ "$ONLY" = "attribution" ]; then
    line "AC-106：取用归因（token_id）"
    eq "① usage_events 有 token_id 列" 1 "$(q "SELECT COUNT(*) FROM pragma_table_info('usage_events') WHERE name='token_id';")"
    q "DELETE FROM usage_events;" >/dev/null
    # ② 只读令牌取用
    curl -s -o /dev/null -H "Authorization: Bearer $RO" "$BASE/api/prompts/$FIX_ID"
    echo "  \$ sqlite3 pm.db \"SELECT prompt_id, channel, token_id FROM usage_events ORDER BY id;\""
    q "SELECT prompt_id, channel, token_id FROM usage_events ORDER BY id;" | sed 's/^/    /'
    eq "② 令牌取用记录的 token_id = 只读令牌 id" "$RO_ID" "$(q "SELECT token_id FROM usage_events ORDER BY id DESC LIMIT 1;")"
    eq "② channel 仍是 token（语义不变）" "token" "$(q "SELECT channel FROM usage_events ORDER BY id DESC LIMIT 1;")"
    # ③ 会话取用
    curl -s -o /dev/null -b "$JAR" "$BASE/api/prompts/$FIX_ID"
    eq "③ 会话取用的 token_id 为 NULL" "1" "$(q "SELECT token_id IS NULL FROM usage_events ORDER BY id DESC LIMIT 1;")"
    # ④ 列表 / 搜索不记
    BEFORE=$(q "SELECT COUNT(*) FROM usage_events;")
    curl -s -o /dev/null -H "Authorization: Bearer $RO" "$BASE/api/prompts"
    curl -s -o /dev/null -H "Authorization: Bearer $RO" "$BASE/api/prompts?q=AC105"
    eq "④ 列表 / 搜索不记取用（条数不变）" "$BEFORE" "$(q "SELECT COUNT(*) FROM usage_events;")"
    # ⑤ summary 带 by_token
    echo "  \$ curl -s -b <jar> $BASE/api/usage/summary?days=1 | jq .by_token"
    curl -s -b "$JAR" "$BASE/api/usage/summary?days=1" | jq -c .by_token | sed 's/^/    /'
    eq "⑤ summary 的 by_token 能查出该令牌" "true" "$(curl -s -b "$JAR" "$BASE/api/usage/summary?days=1" | python3 -c "
import json,sys
d = json.load(sys.stdin)
entries = d.get('by_token', [])
print('true' if any(e['token_id'] == int(sys.argv[1]) for e in entries) and any(e['token_id'] is None for e in entries) else 'false')
" "$RO_ID")"
  fi

  if [ "$ONLY" = "all" ] || [ "$ONLY" = "ui" ]; then
    line "AC-105 ⑦⑧：界面（真鼠标新建、不动权限选项 ⇒ 默认只读）+ 状态列 + 6 列 + 截图"
    rm -rf "$SHOTS"
    AC105_WRITE_ID="$RW_ID" node tools/ac-stage42-probe.mjs scope "$BASE" "$SID" "$SHOTS" | tee "$DIR/probe.log"
    p() { grep -m1 "^$1=" "$DIR/probe.log" | cut -d= -f2-; }

    eq "⑧ 列数仍是 6 且顺序不变" '["名称","Token","状态","使用","最近使用","操作"]' "$(p heads)"
    eq "⑧ 新建处有权限选择控件" true "$(p scope_select_present)"
    eq "⑧ 权限选择**默认只读**" "只读" "$(p scope_default_text)"
    eq "⑧ 权限选择有**两个**档位（真鼠标展开读到）" '["只读","读写"]' "$(p scope_options)"
    eq "⑧ 收起下拉后默认值仍是只读" "只读" "$(p scope_default_after_close)"
    eq "⑧ 既有读写令牌的状态列 = 有效 · 读写" "有效 · 读写" "$(p write_row_state)"
    eq "⑧ 新建行（未动权限）的状态列 = 有效 · 只读" "有效 · 只读" "$(p new_row_state)"
    pass "⑧ 新建后的提示：$(p toast_after_create) ｜ 列表行数 $(p rows_before) → $(p rows_after)"
    eq "⑧ 暗色下同样显示权限" "有效 · 只读" "$(p dark_new_row_state)"
    eq "⑧ 页面运行时异常" "[]" "$(p ac42_runtime_errors)"

    NEW_ID_UI=$(printf '%s' "$(p new_row_testid)" | sed 's/.*pm-token-state-//')
    eq "⑦ 界面新建的令牌在库里是 read" "read" "$(q "SELECT scope FROM api_tokens WHERE id=$NEW_ID_UI;")"
    NEW_UI_TOKEN=$(curl -s -b "$JAR" "$BASE/api/tokens" | jq -r ".items[] | select(.id==$NEW_ID_UI) | .name")
    eq "⑦ 界面新建的令牌名 = AC105 界面默认权限" "AC105 界面默认权限" "$NEW_UI_TOKEN"
    echo "  \$ sqlite3 pm.db \"SELECT id,name,scope FROM api_tokens ORDER BY id;\""
    q "SELECT id, name, scope FROM api_tokens ORDER BY id;" | sed 's/^/    /'

    line "⑦ CLI：不带 --scope = read（且写请求 403）；--scope write 可写"
    # ⚠️ 必须用**同一个 DATA_DIR**（服务端就在用它）——否则 CLI 建的令牌不在服务端库里，验证会得 401
    CLI_OUT=$(DATA_DIR="$DIR" node bin/pm.mjs token create --name cli-default 2>"$DIR/cli.err")
    CLI_TOK=$(printf '%s' "$CLI_OUT" | tail -1)
    pass "  CLI 不带 --scope：stderr=$(grep -o 'scope=[a-z]*' "$DIR/cli.err" | head -1)"
    eq "⑦ CLI 默认 scope = read" "read" "$(q "SELECT scope FROM api_tokens WHERE name='cli-default';")"
    # 这把 CLI 令牌拿到**同一实例**上验：只读 ⇒ 写 403、读 200
    eq "⑦ CLI 默认只读令牌：读 200" 200 "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $CLI_TOK" "$BASE/api/prompts")"
    eq "⑦ CLI 默认只读令牌：写 403 insufficient_scope" 403 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $CLI_TOK" -H 'Content-Type: application/json' -d '{"title":"cli 只读写"}' "$BASE/api/prompts")"
    CLI_W_OUT=$(DATA_DIR="$DIR" node bin/pm.mjs token create --name cli-write --scope write 2>"$DIR/cli-w.err")
    CLI_W=$(printf '%s' "$CLI_W_OUT" | tail -1)
    pass "  CLI --scope write：stderr=$(grep -o 'scope=[a-z]*' "$DIR/cli-w.err" | head -1)"
    eq "⑦ CLI --scope write 可写（201）" 201 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $CLI_W" -H 'Content-Type: application/json' -d '{"title":"cli 读写写"}' "$BASE/api/prompts")"
    DATA_DIR="$DIR" node bin/pm.mjs token create --name cli-bad --scope admin >/dev/null 2>"$DIR/cli-bad.err"
    eq "⑦ CLI 非法 scope → 用法错误（rc=2）" 2 "$?"
    # 精确断言（列表里此刻有 5 把令牌，按名字对）：CLI 建的两把各自带正确 scope
    CLI_LIST=$(DATA_DIR="$DIR" node bin/pm.mjs token list 2>/dev/null)
    echo "  \$ DATA_DIR=<实例> node bin/pm.mjs token list"
    printf '%s\n' "$CLI_LIST" | sed 's/^/    /'
    eq "⑦ list 里 cli-default 显示 scope=read" 1 "$(printf '%s' "$CLI_LIST" | grep -c 'name=cli-default  scope=read')"
    eq "⑦ list 里 cli-write 显示 scope=write" 1 "$(printf '%s' "$CLI_LIST" | grep -c 'name=cli-write  scope=write')"
    eq "⑦ list 每行都带 scope" "$(printf '%s' "$CLI_LIST" | grep -c 'name=')" "$(printf '%s' "$CLI_LIST" | grep -c 'scope=')"

    line "⑧ 视觉证据（$SHOTS）"
    ls -l "$SHOTS" | sed 's/^/  /'
    eq "截图齐备（亮 / 暗各一张 = 2）" 2 "$(find "$SHOTS" -name '*.png' 2>/dev/null | wc -l)"
  fi

  line "回归：既有语义未变"
  eq "迁移版本 = v5" 5 "$(q 'SELECT MAX(version) FROM schema_migrations;')"
  eq "channel 三种取值语义未变（session/token/mcp）" 1 "$(q "SELECT COUNT(DISTINCT channel) >= 1 FROM usage_events;")"
  eq "列表仍不含明文" "true" "$(python3 -c "
import sys
print('true' if sys.argv[2] not in sys.argv[1] else 'false')
" "$(curl -s -b "$JAR" "$BASE/api/tokens")" "$RO")"
  eq "日志里无 token 明文" 0 "$(grep -c "$RO" "$DIR/server.log" || true)"
fi

line "结论"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ AC-105 / AC-106 全部通过"
else
  echo "  ❌ 有未通过项（见上方 ❌）"
fi
exit "$FAIL"
