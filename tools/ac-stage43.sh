#!/usr/bin/env bash
# 阶段 43 验收自检（FR-105：允许修改「已有令牌」的权限）：
#   AC-107 ① **防自我提权**：只读令牌 PATCH 自己 → 403 session_required；查库仍是 read；写仍 403；读写令牌同样 403
#        ② 只读 → 读写：会话 PATCH 200；查库 write；**同一个令牌**紧接着 POST /api/prompts → 201；列表 scope=write
#        ③ 读写 → 只读：同法改回；紧随 POST → 403 insufficient_scope；GET 仍 200
#        ④ 已撤销令牌 → 409 token_revoked（贴响应体）
#        ⑤ 入参校验：scope=admin / {} / {"name":"x"} → 400；不存在 id → 404
#        ⑥ 界面（真鼠标）：有效行点状态列权限文本 → 选读写 → 该行文本立即变（**不刷新页面**）→ 再改回；
#           已撤销行无入口；列头仍 6 列；抽屉无横向滚动；亮/暗截图 + 识图
#        ⑦ CLI：token set-scope <id> write 生效；非法值明确报错 + 非 0 退出
#        ⑧ 回归：只读的 6 个写端点仍 403 insufficient_scope；令牌管理（含本 PATCH）与改口令仍 403 session_required；
#           渲染类 POST 对只读仍 200（npm test / ci-check 在脚本外另跑）
#        ⑨ 日志：改权限成功有一条**不含明文/不含令牌值**的记录
#
# 全程临时 DATA_DIR + 台账范围内备用端口；不碰 8767 测试环境、不碰 106 生产。
# 用法：bash tools/ac-stage43.sh [all|api|ui|cli|regression]
set -u
set -o pipefail

cd "$(dirname "$0")/.." || exit 1
ONLY=${1:-all}
PORT=${PORT:-auto}
AC_PW='ac-fixture-pw-20260922'
AC_USER='admin'
SHOTS='tmp/shots/stage43'
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
DIR=$(mktemp -d /tmp/pm-ac43-XXXXXX)
DB="$DIR/pm.db"
q() { sqlite3 "$DB" "$1"; }

# 打一个 PATCH 并回显 "code|error|body"
patch_as_session() { # $1=id $2=json
  curl -s -b "$JAR" -w '\n%{http_code}' -X PATCH -H 'Content-Type: application/json' -d "$2" "$BASE/api/tokens/$1"
}
patch_as_token() { # $1=token $2=id $3=json
  curl -s -w '\n%{http_code}' -X PATCH -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3" "$BASE/api/tokens/$2"
}
code_of() { printf '%s' "$1" | tail -1; }
body_of() { printf '%s' "$1" | head -1; }
err_of() { body_of "$1" | jq -r '.error // "-"' 2>/dev/null; }

line "构建 + 本阶段单测"
npm run build >"$DIR/build.log" 2>&1
eq "npm run build 退出码" 0 "$?"
node --test tests/stage43-token-set-scope.test.ts >"$DIR/unit.log" 2>&1
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

  # 夹具：一条 prompt；只读 / 读写 / 待撤销三把令牌 —— **真令牌**，逐端点实测
  FIX_ID=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"title":"AC107 夹具","user_prompt":"你好 {{姓名}}"}' "$BASE/api/prompts" | jq -r .id)
  RO_JSON=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"name":"AC107 只读","scope":"read"}' "$BASE/api/tokens")
  RO_ID=$(echo "$RO_JSON" | jq -r .id); RO=$(echo "$RO_JSON" | jq -r .token)
  RW_JSON=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"name":"AC107 读写","scope":"write"}' "$BASE/api/tokens")
  RW_ID=$(echo "$RW_JSON" | jq -r .id); RW=$(echo "$RW_JSON" | jq -r .token)
  RV_JSON=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"name":"AC107 待撤销","scope":"read"}' "$BASE/api/tokens")
  RV_ID=$(echo "$RV_JSON" | jq -r .id)
  curl -s -b "$JAR" -o /dev/null -X DELETE "$BASE/api/tokens/$RV_ID"
  pass "夹具：prompt=$FIX_ID ｜ 只读 id=$RO_ID $(mask "$RO") ｜ 读写 id=$RW_ID $(mask "$RW") ｜ 已撤销 id=$RV_ID"
  echo "  \$ sqlite3 pm.db \"SELECT id,name,scope,revoked_at IS NOT NULL FROM api_tokens;\""
  q "SELECT id, name, scope, revoked_at IS NOT NULL FROM api_tokens;" | sed 's/^/    /'

  if [ "$ONLY" = "all" ] || [ "$ONLY" = "api" ]; then
    line "AC-107 ①：**防自我提权** —— 用令牌调 PATCH 一律 403 session_required，且库里不变"
    OUT=$(patch_as_token "$RO" "$RO_ID" '{"scope":"write"}')
    echo "  \$ curl -X PATCH -H 'Authorization: Bearer <只读>' -d '{\"scope\":\"write\"}' $BASE/api/tokens/$RO_ID"
    printf '    %s\n' "$(body_of "$OUT")"
    eq "① 只读令牌改**自己** → 403 session_required" "403 session_required" "$(code_of "$OUT") $(err_of "$OUT")"
    echo "  \$ sqlite3 pm.db \"SELECT scope FROM api_tokens WHERE id=$RO_ID;\""
    q "SELECT scope FROM api_tokens WHERE id=$RO_ID;" | sed 's/^/    /'
    eq "① 被拒后库里**仍是 read**" "read" "$(q "SELECT scope FROM api_tokens WHERE id=$RO_ID;")"
    eq "① 被拒后它写资源**仍 403**" 403 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $RO" -H 'Content-Type: application/json' -d '{"title":"提权尝试"}' "$BASE/api/prompts")"
    OUT=$(patch_as_token "$RO" "$RW_ID" '{"scope":"read"}')
    eq "① 只读令牌改**别人** → 403 session_required" "403 session_required" "$(code_of "$OUT") $(err_of "$OUT")"
    OUT=$(patch_as_token "$RW" "$RW_ID" '{"scope":"read"}')
    eq "① **读写**令牌改自己 → 403 session_required" "403 session_required" "$(code_of "$OUT") $(err_of "$OUT")"
    OUT=$(patch_as_token "$RW" "$RO_ID" '{"scope":"write"}')
    eq "① **读写**令牌改别人 → 403 session_required" "403 session_required" "$(code_of "$OUT") $(err_of "$OUT")"
    eq "① 令牌通道一次也没改动库（读写那把仍是 write）" "write" "$(q "SELECT scope FROM api_tokens WHERE id=$RW_ID;")"

    line "AC-107 ②：只读 → 读写（会话改，**立即生效**：同一个令牌紧接着就能写）"
    OUT=$(patch_as_session "$RO_ID" '{"scope":"write"}')
    echo "  \$ curl -b <jar> -X PATCH -d '{\"scope\":\"write\"}' $BASE/api/tokens/$RO_ID"
    printf '    %s\n' "$(body_of "$OUT")"
    eq "② 会话 PATCH → 200" 200 "$(code_of "$OUT")"
    eq "② 响应体回带新权限" "write" "$(body_of "$OUT" | jq -r .scope)"
    eq "② 查库 scope=write" "write" "$(q "SELECT scope FROM api_tokens WHERE id=$RO_ID;")"
    # **同一个令牌**（没有重建、没有重新登录）
    eq "② 同一个令牌紧接着 POST /api/prompts → 201" 201 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $RO" -H 'Content-Type: application/json' -d '{"title":"提权后就能写了"}' "$BASE/api/prompts")"
    eq "② GET /api/tokens 该行 scope=write" "write" "$(curl -s -b "$JAR" "$BASE/api/tokens" | jq -r ".items[] | select(.id==$RO_ID) | .scope")"

    line "AC-107 ③：读写 → 只读（同法改回，**立即生效**）"
    OUT=$(patch_as_session "$RO_ID" '{"scope":"read"}')
    eq "③ 会话 PATCH → 200" 200 "$(code_of "$OUT")"
    eq "③ 查库 scope=read" "read" "$(q "SELECT scope FROM api_tokens WHERE id=$RO_ID;")"
    OUT2=$(curl -s -w '\n%{http_code}' -X POST -H "Authorization: Bearer $RO" -H 'Content-Type: application/json' -d '{"title":"改回只读后不该成功"}' "$BASE/api/prompts")
    eq "③ 紧随其后 POST → 403 insufficient_scope" "403 insufficient_scope" "$(code_of "$OUT2") $(err_of "$OUT2")"
    eq "③ GET /api/prompts 仍 200" 200 "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $RO" "$BASE/api/prompts")"
    eq "③ 幂等：再改成 read 仍 200" 200 "$(code_of "$(patch_as_session "$RO_ID" '{"scope":"read"}')")"

    line "AC-107 ④：已撤销的令牌 → 409 token_revoked（贴响应体）"
    OUT=$(patch_as_session "$RV_ID" '{"scope":"write"}')
    echo "  \$ curl -b <jar> -X PATCH -d '{\"scope\":\"write\"}' $BASE/api/tokens/$RV_ID   # 该 id 已撤销"
    printf '    %s\n' "$(body_of "$OUT")"
    eq "④ 已撤销 → 409" 409 "$(code_of "$OUT")"
    eq "④ 错误码 = token_revoked" "token_revoked" "$(err_of "$OUT")"
    eq "④ 消息讲清出路（重建）" 1 "$(body_of "$OUT" | jq -r '.message // ""' | grep -c '重建')"
    eq "④ 409 不得改动库" "read" "$(q "SELECT scope FROM api_tokens WHERE id=$RV_ID;")"
    # 既有 409 形状未被 FR-105 改动（只有带 detail 的 409 才多 message）
    eq "④ 既有 409 仍是 {\"error\":\"token_not_revoked\"}" '{"error":"token_not_revoked"}' "$(curl -s -b "$JAR" -X DELETE "$BASE/api/tokens/$RO_ID/permanent")"

    line "AC-107 ⑤：入参校验（只收 scope；additionalProperties:false）"
    for payload in '{"scope":"admin"}' '{}' '{"name":"x"}' '{"scope":"write","name":"x"}'; do
      OUT=$(patch_as_session "$RO_ID" "$payload")
      eq "⑤ body=$payload → 400 invalid_body" "400 invalid_body" "$(code_of "$OUT") $(err_of "$OUT")"
    done
    eq "⑤ 被拒的请求不得改动库" "read" "$(q "SELECT scope FROM api_tokens WHERE id=$RO_ID;")"
    eq "⑤ 不存在的 id → 404" 404 "$(code_of "$(patch_as_session 999999 '{"scope":"write"}')")"
    eq "⑤ 非正整数 id → 404（既有口径）" 404 "$(code_of "$(patch_as_session 0 '{"scope":"write"}')")"
  fi

  if [ "$ONLY" = "all" ] || [ "$ONLY" = "regression" ]; then
    line "AC-107 ⑧：阶段 42 的边界不回归"
    check_write() {
      local label="$1" method="$2" url="$3" body="${4:-}"
      local out code err
      if [ -n "$body" ]; then
        out=$(curl -s -w '\n%{http_code}' -X "$method" -H "Authorization: Bearer $RO" -H 'Content-Type: application/json' -d "$body" "$BASE$url")
      else
        out=$(curl -s -w '\n%{http_code}' -X "$method" -H "Authorization: Bearer $RO" "$BASE$url")
      fi
      code=$(printf '%s' "$out" | tail -1); err=$(printf '%s' "$out" | head -1 | jq -r .error 2>/dev/null)
      eq "⑧ $label → 403 insufficient_scope" "403 insufficient_scope" "$code $err"
    }
    check_write "POST /api/prompts" POST "/api/prompts" '{"title":"x"}'
    check_write "PUT /api/prompts/:id" PUT "/api/prompts/$FIX_ID" '{"title":"y"}'
    check_write "DELETE /api/prompts/:id" DELETE "/api/prompts/$FIX_ID"
    check_write "PATCH /api/prompts/order" PATCH "/api/prompts/order" "{\"ids\":[$FIX_ID]}"
    check_write "POST /api/folders" POST "/api/folders" '{"name":"f"}'
    check_write "POST /api/tags" POST "/api/tags" '{"name":"t"}'

    check_session() {
      local label="$1" method="$2" url="$3" body="${4:-}"
      local out code err
      if [ -n "$body" ]; then
        out=$(curl -s -w '\n%{http_code}' -X "$method" -H "Authorization: Bearer $RW" -H 'Content-Type: application/json' -d "$body" "$BASE$url")
      else
        out=$(curl -s -w '\n%{http_code}' -X "$method" -H "Authorization: Bearer $RW" "$BASE$url")
      fi
      code=$(printf '%s' "$out" | tail -1); err=$(printf '%s' "$out" | head -1 | jq -r .error 2>/dev/null)
      eq "⑧ $label → 403 session_required" "403 session_required" "$code $err"
    }
    check_session "GET /api/tokens（枚举）" GET "/api/tokens"
    check_session "POST /api/tokens（自我繁殖）" POST "/api/tokens" '{"name":"自繁殖"}'
    check_session "PATCH /api/tokens/:id（**本阶段新增，也仅会话**）" PATCH "/api/tokens/$RO_ID" '{"scope":"write"}'
    check_session "DELETE /api/tokens/:id（撤销）" DELETE "/api/tokens/$RW_ID"
    check_session "DELETE /api/tokens/:id/permanent（硬删）" DELETE "/api/tokens/$RW_ID/permanent"
    check_session "POST /api/tokens/:id/reveal" POST "/api/tokens/$RW_ID/reveal"
    check_session "POST /api/password（改口令）" POST "/api/password" '{"old_password":"x","new_password":"yyyyyyyy"}'
    check_session "POST /api/logout" POST "/api/logout"
    eq "⑧ 会话路径不受影响（GET /api/tokens = 200）" 200 "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" "$BASE/api/tokens")"

    eq "⑧ 渲染类 POST 对只读仍 200（prompt render）" 200 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $RO" -H 'Content-Type: application/json' -d '{"values":{"姓名":"张三"}}' "$BASE/api/prompts/$FIX_ID/render")"
    eq "⑧ 渲染类 POST 对只读仍 200（markdown）" 200 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $RO" -H 'Content-Type: application/json' -d '{"markdown":"# 标题"}' "$BASE/api/render/markdown")"
    eq "⑧ 迁移版本仍是 v5（本阶段无新迁移）" 5 "$(q 'SELECT MAX(version) FROM schema_migrations;')"
  fi

  if [ "$ONLY" = "all" ] || [ "$ONLY" = "cli" ]; then
    line "AC-107 ⑦：CLI token set-scope（本机管理路径，直接开库）"
    # ⚠️ 必须用**同一个 DATA_DIR**（服务端就在用它），否则改的是另一个库
    DATA_DIR="$DIR" node bin/pm.mjs token set-scope "$RW_ID" read >"$DIR/cli1.out" 2>"$DIR/cli1.err"
    eq "⑦ set-scope <读写> read 退出码" 0 "$?"
    echo "  \$ DATA_DIR=<实例> node bin/pm.mjs token set-scope $RW_ID read"
    sed 's/^/    /' "$DIR/cli1.out"
    eq "⑦ 回显结果（旧 → 新）" "ok: token $RW_ID scope: write → read" "$(cat "$DIR/cli1.out")"
    eq "⑦ 查库生效 = read" "read" "$(q "SELECT scope FROM api_tokens WHERE id=$RW_ID;")"
    DATA_DIR="$DIR" node bin/pm.mjs token set-scope "$RW_ID" write >/dev/null 2>&1
    eq "⑦ 改回 write 也生效" "write" "$(q "SELECT scope FROM api_tokens WHERE id=$RW_ID;")"

    DATA_DIR="$DIR" node bin/pm.mjs token set-scope "$RW_ID" admin >"$DIR/cli-bad.out" 2>"$DIR/cli-bad.err"
    RC=$?
    echo "  \$ DATA_DIR=<实例> node bin/pm.mjs token set-scope $RW_ID admin   # 非法取值"
    head -1 "$DIR/cli-bad.err" | sed 's/^/    /'
    eq "⑦ 非法 scope → 非 0 退出（用法错误 rc=2）" 2 "$RC"
    eq "⑦ 非法 scope → 明确报错文案" 1 "$(grep -c 'scope 只能是 read 或 write' "$DIR/cli-bad.err")"
    eq "⑦ 非法取值不得改动库" "write" "$(q "SELECT scope FROM api_tokens WHERE id=$RW_ID;")"

    DATA_DIR="$DIR" node bin/pm.mjs token set-scope abc write >/dev/null 2>"$DIR/cli-bad2.err"
    eq "⑦ 非法 id → 非 0 退出" 2 "$?"
    DATA_DIR="$DIR" node bin/pm.mjs token set-scope "$RW_ID" >/dev/null 2>"$DIR/cli-bad3.err"
    eq "⑦ 缺参数 → 非 0 退出" 2 "$?"

    DATA_DIR="$DIR" node bin/pm.mjs token set-scope "$RV_ID" read >/dev/null 2>"$DIR/cli-rev.err"
    eq "⑦ 已撤销令牌 → 非 0 退出" 1 "$?"
    eq "⑦ 已撤销令牌 → 明确报错（不是裸错误码）" 1 "$(grep -c '已撤销' "$DIR/cli-rev.err")"

    PM_API_URL="http://127.0.0.1:$PORT" PM_API_TOKEN="$RW" DATA_DIR="$DIR" node bin/pm.mjs token set-scope "$RW_ID" read >/dev/null 2>"$DIR/cli-http.err"
    eq "⑦ 设了 PM_API_URL → 明确拒绝（本机管理路径，不回退）" 2 "$?"
    eq "⑦ 拒绝理由可读" 1 "$(grep -c 'token set-scope 只支持本机管理路径' "$DIR/cli-http.err")"

    line "⑦ CLI 结果在 list 里可见"
    echo "  \$ DATA_DIR=<实例> node bin/pm.mjs token list"
    DATA_DIR="$DIR" node bin/pm.mjs token list 2>/dev/null | sed 's/^/    /'
  fi

  if [ "$ONLY" = "all" ] || [ "$ONLY" = "ui" ]; then
    line "AC-107 ⑥：界面（真鼠标改权限、断言不打刷新）+ 6 列 + 无横向滚动 + 截图"
    rm -rf "$SHOTS"
    AC107_READ_ID="$RO_ID" AC107_WRITE_ID="$RW_ID" AC107_REVOKED_ID="$RV_ID" \
      node tools/ac-stage43-probe.mjs scope "$BASE" "$SID" "$SHOTS" | tee "$DIR/probe.log"
    p() { grep -m1 "^$1=" "$DIR/probe.log" | cut -d= -f2-; }

    eq "⑥ 列头仍是 6 列且顺序不变" '["名称","Token","状态","使用","最近使用","操作"]' "$(p heads)"
    eq "⑥ 抽屉无横向滚动（body/table 溢出均为 0）" '{"body":0,"table":0}' "$(p drawer_scroll)"
    eq "⑥ 改前该行 = 有效 · 只读" "有效 · 只读" "$(p before_read_row)"
    eq "⑥ 有效行可点击标记" "1" "$(p read_row_editable)"
    eq "⑥ 指针变手型" "pointer" "$(p read_row_cursor)"
    eq "⑥ 悬停提示文案" "点击切换：只读 ↔ 读写" "$(p read_row_title)"
    eq "⑥ 点开后菜单两项" '["只读","读写"]' "$(p menu_items)"
    eq "⑥ 菜单标出当前档位" '["只读"]' "$(p menu_open_selected)"
    eq "⑥ 选「读写」后该行立即 = 有效 · 读写" "有效 · 读写" "$(p after_read_row)"
    eq "⑥ 改权限由**浏览器真发的 PATCH** 完成（200）" '[{"url":"/api/tokens/'"$RO_ID"'","method":"PATCH","status":200},{"url":"/api/tokens/'"$RO_ID"'","method":"PATCH","status":200}]' "$(p browser_patch_calls)"
    eq "⑥ 成功提示（改为读写）" "已改为读写（立即生效）" "$(p toast_up)"
    eq "⑥ 真鼠标一次点中（上行改读写用的尝试次数）" 1 "$(p up_attempts)"
    eq "⑥ **页面没有被刷新**（页内哨兵变量仍在）" true "$(p page_mark_alive)"
    eq "⑥ **URL 未变**" true "$(p page_url_unchanged)"
    eq "⑥ 导航条目数仍是 1（没有发生重新加载）" 1 "$(p navigation_entries)"
    eq "⑥ 再点一次选「只读」→ 该行变回 有效 · 只读" "有效 · 只读" "$(p restored_read_row)"
    eq "⑥ 改回也是真鼠标一次点中" 1 "$(p down_attempts)"
    eq "⑥ 成功提示（改回只读）" "已改为只读（立即生效）" "$(p toast_down)"
    eq "⑥ 改回后页面仍未刷新" true "$(p page_mark_alive_after_restore)"
    eq "⑥ 既有读写行 = 有效 · 读写" "有效 · 读写" "$(p write_row_state)"
    eq "⑥ 已撤销行 = 已撤销 · 只读" "已撤销 · 只读" "$(p revoked_row_state)"
    eq "⑥ 已撤销行**没有**可点击标记" "null" "$(p revoked_row_editable)"
    eq "⑥ 点已撤销行**不弹菜单**（没有改权限入口）" "[]" "$(p revoked_menu_after_click)"
    eq "⑥ 暗色下同样可改（菜单两项）" '["只读","读写"]' "$(p dark_menu_items)"
    eq "⑥ 暗色下该行仍是 有效 · 只读" "有效 · 只读" "$(p dark_read_row)"
    eq "⑥ 页面运行时异常" "[]" "$(p ac43_runtime_errors)"

    eq "② 界面改完（最后停在 read）后库里 = read" "read" "$(q "SELECT scope FROM api_tokens WHERE id=$RO_ID;")"

    line "⑥ 视觉证据（$SHOTS）"
    ls -l "$SHOTS" | sed 's/^/  /'
    eq "截图齐备（亮 2 + 暗 1 = 3）" 3 "$(find "$SHOTS" -name '*.png' 2>/dev/null | wc -l)"
  fi

  line "AC-107 ⑨：日志（改权限成功有一条**不含明文**的记录）"
  ge "⑨ 有 'token scope changed' 记录" 1 "$(grep -c 'token scope changed' "$DIR/server.log")"
  echo "  \$ grep -m2 'token scope changed' \$DIR/server.log"
  grep -m2 'token scope changed' "$DIR/server.log" | sed 's/^/    /'
  ge "⑨ 该记录带 id 与两档权限（tokenId/from/to）" 1 "$(grep -c '"tokenId":' "$DIR/server.log")"
  eq "⑨ 日志里**没有**只读令牌明文" 0 "$(grep -c "$RO" "$DIR/server.log" || true)"
  eq "⑨ 日志里**没有**读写令牌明文" 0 "$(grep -c "$RW" "$DIR/server.log" || true)"
  eq "⑨ 日志里没有 token_hash / token_enc 字段" 0 "$(grep -c 'token_hash\|token_enc' "$DIR/server.log" || true)"

  line "收尾：会话仍可用（改权限没有把会话或令牌体系弄坏）"
  eq "GET /api/tokens = 200" 200 "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" "$BASE/api/tokens")"
  eq "读写令牌仍可读" 200 "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $RW" "$BASE/api/prompts")"
fi

line "结论"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ AC-107 全部通过"
else
  echo "  ❌ 有未通过项（见上方 ❌）"
fi
exit "$FAIL"
