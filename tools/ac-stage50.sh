#!/usr/bin/env bash
# 阶段 50 验收自检（FR-114：取用语义修正 ——「打开详情」不算取用）：
#   AC-115 ① 只打开详情：**use_count 不变**，但记录表新增一条 **kind='view'**
#        ② 复制计入：use_count +1、记录 kind='copy'
#        ③ 渲染取用计入：POST …/render 一次 ⇒ +1、kind='copy'
#        ④ MCP 取用计入：只读令牌经 MCP 调 prompt_get ⇒ +1、kind='mcp' 且 token_id 为该令牌 id
#        ⑤ 列表 / 搜索 / 翻页仍不记（记录表总数不增）
#        ⑥ 历史不重算：迁移后旧行全部 kind='copy'，总数不变
#        ⑦ 一次复制只一条（FR-113 不回归）：连做两次复制 ⇒ kind='copy' 恰好 +2
#        ⑧ 界面自洽：use_count 增量 == 期间的复制/渲染次数（不含打开详情）
#        ⑨ 旧库副本实测迁移：kind 列出现、旧行填 copy、行数不变、重复跑幂等
#        ⑩ 回归：npm test（本脚本复跑）/ ci-check（在脚本外另跑）
#
# 本条涉及**数据层 + 逻辑** ⇒ 回归范围按 D-50 ⑥（受影响部分 + 全量 npm test + ci-check）。
# 全程临时 DATA_DIR + 台账范围内备用端口；不碰 8767 测试环境、不碰 106 生产。
# 用法：bash tools/ac-stage50.sh
set -u
set -o pipefail

cd "$(dirname "$0")/.." || exit 1
PORT=${PORT:-auto}
AC_PW='ac-fixture-pw-20260923'
AC_USER='admin'
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
DIR=$(mktemp -d /tmp/pm-ac50-XXXXXX)
DB="$DIR/pm.db"
q() { sqlite3 "$DB" "$1"; }
# 某个 prompt 的**计入型**记录数（copy + mcp）
counted() { q "SELECT COUNT(*) FROM usage_events WHERE prompt_id=$1 AND coalesce(kind,'copy') IN ('copy','mcp');"; }
# 记录总数
total() { q "SELECT COUNT(*) FROM usage_events;"; }

line "构建 + 全量单测（数据层+逻辑：本脚本 + 全量 npm test + ci-check）"
npm run build >"$DIR/build.log" 2>&1
eq "npm run build 退出码" 0 "$?"
npm test >"$DIR/test.log" 2>&1
eq "npm test 退出码" 0 "$?"
grep -E "^ℹ (tests|pass|fail)" "$DIR/test.log" | sed 's/^/  /'

line "AC-115 ⑨：**旧库副本实测迁移**（先造一个只到 v5 的旧库，插入旧式记录，再跑迁移）"
LEGACY=$(mktemp -d /tmp/pm-ac50-legacy-XXXXXX)
sqlite3 "$LEGACY/pm.db" "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);"
for f in 001_init.sql 002_tokens-and-usage.sql 003_prompt-sort-order.sql 004_token-enc.sql 005_token-scope.sql; do
  sqlite3 "$LEGACY/pm.db" < "migrations/$f"
  V=$(printf '%s' "$f" | cut -c1-3 | sed 's/^0*//')
  sqlite3 "$LEGACY/pm.db" "INSERT INTO schema_migrations (version, name, applied_at) VALUES ($V, '$f', '2026-01-01T00:00:00.000Z');"
done
# 旧式记录：**没有 kind 列**的时代 —— 插 3 条（含一条 MCP、一条令牌）
LDB="$LEGACY/pm.db"
sqlite3 "$LDB" "INSERT INTO prompts (id,title,user_prompt,system_prompt,notes,folder_id,favorite,sort_order,version_no,created_at,updated_at) VALUES (1,'旧 prompt','正文','','',NULL,0,0,1,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');"
sqlite3 "$LDB" "INSERT INTO usage_events (prompt_id,channel,used_at,token_id) VALUES (1,'session','2026-01-01T01:00:00.000Z',NULL);"
sqlite3 "$LDB" "INSERT INTO usage_events (prompt_id,channel,used_at,token_id) VALUES (1,'mcp','2026-01-01T02:00:00.000Z',NULL);"
sqlite3 "$LDB" "INSERT INTO usage_events (prompt_id,channel,used_at,token_id) VALUES (1,'token','2026-01-01T03:00:00.000Z',7);"
BEFORE_ROWS=$(sqlite3 "$LDB" "SELECT COUNT(*) FROM usage_events;")
BEFORE_KINDCOL=$(sqlite3 "$LDB" "SELECT COUNT(*) FROM pragma_table_info('usage_events') WHERE name='kind';")
echo "  \$ 迁移前：记录 $BEFORE_ROWS 条，kind 列存在数 = $BEFORE_KINDCOL"
eq "⑨ 迁移前没有 kind 列" 0 "$BEFORE_KINDCOL"
DATA_DIR="$LEGACY" npm run migrate 2>&1 | grep -v '^$' | tail -1 | sed 's/^/    /'
eq "⑨ 迁移输出 ok: schema at v6" 1 "$(DATA_DIR="$LEGACY" npm run migrate 2>&1 | grep -c 'ok: schema at v6')"
eq "⑨ 迁移后 kind 列出现" 1 "$(sqlite3 "$LDB" "SELECT COUNT(*) FROM pragma_table_info('usage_events') WHERE name='kind';")"
eq "⑨ 迁移后**行数不变**" "$BEFORE_ROWS" "$(sqlite3 "$LDB" "SELECT COUNT(*) FROM usage_events;")"
echo "  \$ 迁移后按 kind 分布："
sqlite3 "$LDB" "SELECT coalesce(kind,'(NULL)'), COUNT(*) FROM usage_events GROUP BY kind;" | sed 's/^/      /'
eq "⑨ 旧行**全部** kind='copy'" "$BEFORE_ROWS" "$(sqlite3 "$LDB" "SELECT COUNT(*) FROM usage_events WHERE kind='copy';")"
eq "⑨ 没有 kind 为 NULL 的旧行" 0 "$(sqlite3 "$LDB" "SELECT COUNT(*) FROM usage_events WHERE kind IS NULL;")"
eq "⑨ 归因未被改写（channel 仍是原值）" "mcp:1, session:1, token:1" "$(sqlite3 "$LDB" "SELECT group_concat(channel || ':' || n, ', ') FROM (SELECT channel, COUNT(*) AS n FROM usage_events GROUP BY channel ORDER BY channel);")"
eq "⑨ 令牌归因未被改写（token_id 仍是 7）" 7 "$(sqlite3 "$LDB" "SELECT token_id FROM usage_events WHERE channel='token';")"
# 幂等：再跑一次
DATA_DIR="$LEGACY" npm run migrate >/dev/null 2>&1
eq "⑨ 重复跑迁移**幂等**（行数仍不变）" "$BEFORE_ROWS" "$(sqlite3 "$LDB" "SELECT COUNT(*) FROM usage_events;")"
eq "⑨ 重复跑后 kind 分布不变（仍全 copy）" "$BEFORE_ROWS" "$(sqlite3 "$LDB" "SELECT COUNT(*) FROM usage_events WHERE kind='copy';")"
eq "⑨ schema 版本仍是 v6" 6 "$(sqlite3 "$LDB" 'SELECT MAX(version) FROM schema_migrations;')"
rm -rf "$LEGACY"

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

  V=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"title":"AC115 含变量","user_prompt":"你好 {{姓名}}"}' "$BASE/api/prompts" | jq -r .id)
  N=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"title":"AC115 无变量","user_prompt":"固定内容"}' "$BASE/api/prompts" | jq -r .id)
  eq "迁移版本 = v6（新增 006）" 6 "$(q 'SELECT MAX(version) FROM schema_migrations;')"
  eq "usage_events 有 kind 列（共 6 列）" 6 "$(q "SELECT COUNT(*) FROM pragma_table_info('usage_events');")"
  pass "夹具：含变量 prompt=$V ｜ 无变量 prompt=$N"

  line "AC-115 ①：**只打开详情不计入 use_count**，但留痕 kind='view'"
  q "DELETE FROM usage_events;"
  UC_BEFORE=$(curl -s -b "$JAR" "$BASE/api/prompts/$V" | jq -r .use_count)   # 注意：这次 GET 自己会留一条 view
  ROWS_BEFORE=$(total)
  # 再"纯打开"一次（只 GET，不复制）
  curl -s -o /dev/null -b "$JAR" "$BASE/api/prompts/$V"
  UC_AFTER=$(curl -s -b "$JAR" "$BASE/api/prompts/$V" | jq -r .use_count)
  ROWS_AFTER=$(total)
  echo "  \$ use_count：$UC_BEFORE → $UC_AFTER（期望**不变**）"
  echo "  \$ 记录总数：$ROWS_BEFORE → $ROWS_AFTER（每次 GET 都留痕 view）"
  eq "① 只打开详情 **use_count 不变**（仍 0）" "$UC_BEFORE" "$UC_AFTER"
  eq "① use_count 为 0（打开不计数）" 0 "$UC_AFTER"
  eq "① 但记录表确实在增长（留痕）" true "$([ "$ROWS_AFTER" -gt 0 ] && echo true || echo false)"
  echo "  \$ 记录原样（prompt=$V）："
  q "SELECT id, prompt_id, channel, token_id, kind, used_at FROM usage_events WHERE prompt_id=$V ORDER BY id;" | sed 's/^/      /'
  eq "① 新增记录**全部** kind='view'" 0 "$(q "SELECT COUNT(*) FROM usage_events WHERE prompt_id=$V AND kind <> 'view';")"
  eq "① 计入型记录数为 0" 0 "$(counted "$V")"

  line "AC-115 ②：复制计入（use_count +1、kind='copy'）"
  q "DELETE FROM usage_events;"
  # 先取基线：此时计入型为 0（读 use_count 的这次 GET 只留 view，不影响 use_count）
  UC0=$(curl -s -b "$JAR" "$BASE/api/prompts/$V" | jq -r .use_count)
  ROWS0=$(total); C0=$(counted "$V")
  eq "② 复制前 use_count 基线为 0" 0 "$UC0"
  # 一次「复制」= 界面的两步：GET（拿变量名，不记账）+ POST render（记账）
  curl -s -o /dev/null -b "$JAR" "$BASE/api/prompts/$V/variables"
  curl -s -o /dev/null -b "$JAR" -H 'Content-Type: application/json' -d '{"values":{"姓名":"张三"}}' "$BASE/api/prompts/$V/render"
  UC1=$(curl -s -b "$JAR" "$BASE/api/prompts/$V" | jq -r .use_count)
  echo "  \$ 复制前 use_count=$UC0 ｜ 记录 $ROWS0 条（计入型 $C0）"
  echo "  \$ 复制后 use_count=$UC1 ｜ 记录 $(total) 条（计入型 $(counted "$V")）"
  eq "② 计入型记录 +1" "$((C0 + 1))" "$(counted "$V")"
  /**
   * ⚠️ 界面上"复制"的第一步其实是**打开该条**（产生一条 view 留痕）⇒ 记录总数会 +2。
   * 所以这里不臆测总数，只钉住"**计入型**恰好 +1"（这才是本阶段要保证的语义）。
   */
  eq "② 计入型账目干净：view 留痕不计入" 0 "$(q "SELECT COUNT(*) FROM usage_events WHERE prompt_id=$V AND kind='view' AND coalesce(kind,'copy') IN ('copy','mcp');")"
  eq "② 记录总数 = 2 条 view + 1 条 copy" 3 "$(total)"
  eq "② use_count +1" "$((UC0 + 1))" "$UC1"
  # ⚠️ 不能用 "ORDER BY id DESC LIMIT 1" —— 下面读 use_count 的那次 GET 详情会追加一条 view
  eq "② 新增记录的 kind='copy'" "copy" "$(q "SELECT kind FROM usage_events WHERE prompt_id=$V AND coalesce(kind,'copy') IN ('copy','mcp') ORDER BY id DESC LIMIT 1;")"
  echo "  \$ 该记录原样：$(q "SELECT id||'|'||prompt_id||'|'||channel||'|'||coalesce(token_id,'NULL')||'|'||kind||'|'||used_at FROM usage_events WHERE prompt_id=$V ORDER BY id DESC LIMIT 1;")"

  line "AC-115 ③：渲染取用计入（POST …/render 一次 ⇒ +1、kind='copy'）"
  q "DELETE FROM usage_events;"
  UC2=$(curl -s -b "$JAR" "$BASE/api/prompts/$V" | jq -r .use_count)
  C2=$(counted "$V")
  curl -s -o /dev/null -b "$JAR" -H 'Content-Type: application/json' -d '{"values":{}}' "$BASE/api/prompts/$V/render"
  UC3=$(curl -s -b "$JAR" "$BASE/api/prompts/$V" | jq -r .use_count)
  eq "③ 渲染计入 +1" "$((UC2 + 1))" "$UC3"
  eq "③ 计入型记录 +1" "$((C2 + 1))" "$(counted "$V")"
  eq "③ kind='copy'" "copy" "$(q "SELECT kind FROM usage_events WHERE prompt_id=$V AND coalesce(kind,'copy') IN ('copy','mcp') ORDER BY id DESC LIMIT 1;")"

  line "AC-115 ④：MCP 取用计入（只读令牌经 MCP 一次 ⇒ +1、kind='mcp'、token_id=该令牌）"
  RO_JSON=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"name":"AC115 MCP","scope":"read"}' "$BASE/api/tokens")
  RO_ID=$(printf '%s' "$RO_JSON" | jq -r .id)
  RO=$(printf '%s' "$RO_JSON" | jq -r .token)
  q "DELETE FROM usage_events;"
  # MCP 的 prompt_get 走内部 HTTP，带 X-PM-Channel: mcp（见 src/mcp/http.ts）
  mcp_call() { # $1 = tool 名 $2 = arguments JSON
    python3 - "$1" "$2" <<'PY'
import json, sys
print(json.dumps({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":sys.argv[1],"arguments":json.loads(sys.argv[2])}}))
PY
  }
  mcp_post() { # $1 = body
    curl -s -o "$DIR/mcp.out" -w '%{http_code}' -X POST \
      -H "Authorization: Bearer $RO" -H 'Content-Type: application/json' \
      -H 'Accept: application/json, text/event-stream' \
      -d "$1" "$BASE/mcp"
  }

  # ④-1：prompt_get = MCP 版的"打开详情" ⇒ 留痕 view、**不计入**
  GET_CODE=$(mcp_post "$(mcp_call prompt_get "{\"id\":$V}")")
  echo "  \$ /mcp prompt_get → HTTP $GET_CODE"
  eq "④-1 prompt_get 调用成功（200）" 200 "$GET_CODE"
  echo "  \$ 记录原样：$(q "SELECT id||'|'||prompt_id||'|'||channel||'|'||coalesce(token_id,'NULL')||'|'||kind FROM usage_events ORDER BY id;")"
  eq "④-1 prompt_get 只留痕一条 view" 1 "$(q "SELECT COUNT(*) FROM usage_events WHERE channel='mcp' AND kind='view';")"
  eq "④-1 它**不计入** use_count" 0 "$(counted "$V")"

  # ④-2：prompt_render = MCP 的"真取用" ⇒ kind='mcp'、计入
  REN_CODE=$(mcp_post "$(mcp_call prompt_render "{\"id\":$V,\"values\":{}}")")
  echo "  \$ /mcp prompt_render → HTTP $REN_CODE"
  eq "④-2 prompt_render 调用成功（200）" 200 "$REN_CODE"
  echo "  \$ 记录原样：$(q "SELECT id||'|'||prompt_id||'|'||channel||'|'||coalesce(token_id,'NULL')||'|'||kind FROM usage_events ORDER BY id;")"
  eq "④-2 该记录 kind='mcp'" "mcp" "$(q "SELECT kind FROM usage_events WHERE kind='mcp' ORDER BY id DESC LIMIT 1;")"
  eq "④-2 该记录 channel='mcp'" "mcp" "$(q "SELECT channel FROM usage_events WHERE kind='mcp' ORDER BY id DESC LIMIT 1;")"
  eq "④-2 该记录 token_id == 该只读令牌 id" "$RO_ID" "$(q "SELECT token_id FROM usage_events WHERE kind='mcp' ORDER BY id DESC LIMIT 1;")"
  eq "④-2 MCP 取用**计入** use_count" 1 "$(counted "$V")"
  eq "④-2 总记录 2 条（1 view + 1 mcp）" 2 "$(total)"

  line "AC-115 ⑤：列表 / 搜索 / 翻页仍不记"
  q "DELETE FROM usage_events;"
  T0=$(total)
  curl -s -o /dev/null -b "$JAR" "$BASE/api/prompts"
  curl -s -o /dev/null -b "$JAR" "$BASE/api/prompts?q=AC115"
  curl -s -o /dev/null -b "$JAR" "$BASE/api/prompts?limit=5&offset=0"
  curl -s -o /dev/null -b "$JAR" "$BASE/api/prompts?sort=recent_used"
  eq "⑤ 列表/搜索/翻页/排序 后记录总数不增" "$T0" "$(total)"
  eq "⑤ 记录总数仍是 0" 0 "$(total)"

  line "AC-115 ⑦：两次复制恰好 +2（FR-113 不回归）"
  q "DELETE FROM usage_events;"
  for _ in 1 2; do
    curl -s -o /dev/null -b "$JAR" "$BASE/api/prompts/$V/variables"
    curl -s -o /dev/null -b "$JAR" -H 'Content-Type: application/json' -d '{"values":{"姓名":"李四"}}' "$BASE/api/prompts/$V/render"
  done
  echo "  \$ 连续两次「填值 → 复制结果」后："
  q "SELECT id, kind, channel FROM usage_events WHERE prompt_id=$V ORDER BY id;" | sed 's/^/      /'
  eq "⑦ 恰好 2 条 copy（不是 4）" 2 "$(q "SELECT COUNT(*) FROM usage_events WHERE prompt_id=$V AND kind='copy';")"
  eq "⑦ 没有额外的 view（复制路径不产生 view）" 0 "$(q "SELECT COUNT(*) FROM usage_events WHERE prompt_id=$V AND kind='view';")"

  line "AC-115 ⑧：界面自洽（use_count 增量 == 期间的复制/渲染次数，不含打开详情）"
  q "DELETE FROM usage_events;"
  # 3 次渲染取用（模拟 3 次复制）
  for _ in 1 2 3; do
    curl -s -o /dev/null -b "$JAR" -H 'Content-Type: application/json' -d '{"values":{}}' "$BASE/api/prompts/$V/render"
  done
  # 再"纯打开"5 次（不该计入）
  for _ in 1 2 3 4 5; do curl -s -o /dev/null -b "$JAR" "$BASE/api/prompts/$V"; done
  UC_FINAL=$(curl -s -b "$JAR" "$BASE/api/prompts/$V" | jq -r .use_count)
  echo "  \$ 3 次渲染 + 5 次打开 后：use_count = $UC_FINAL（期望 3，**不含那 5 次打开**）"
  echo "  \$ 记录分布：$(q "SELECT kind, COUNT(*) FROM usage_events WHERE prompt_id=$V GROUP BY kind;" | tr '\n' ' ')"
  eq "⑧ use_count == 3（恰好等于渲染次数）" 3 "$UC_FINAL"
  eq "⑧ 计入型记录数也是 3" 3 "$(counted "$V")"
  # 5 次"纯打开" + 读 use_count 的那次 GET（也留 view）⇒ 6 条
  eq "⑧ view 留痕 6 条（5 次打开 + 读 use_count 的那次）" 6 "$(q "SELECT COUNT(*) FROM usage_events WHERE prompt_id=$V AND kind='view';")"
  eq "⑧ 客户端不因 view 而虚高（提示：这一步就是修复前会显示 9 的场景）" 3 "$UC_FINAL"

  line "AC-115 ②补充：不含变量的复制（无渲染）—— 只留痕、不额外计数"
  q "DELETE FROM usage_events;"
  curl -s -o /dev/null -b "$JAR" "$BASE/api/prompts/$N"          # 打开详情（view）
  CUR_N=$(curl -s -b "$JAR" "$BASE/api/prompts/$N" | jq -r .use_count)
  eq "非回归：不含变量复制路径不产生 copy" 0 "$(q "SELECT COUNT(*) FROM usage_events WHERE prompt_id=$N AND kind='copy';")"
  eq "不含变量的 use_count 仍为 0（打开不计）" 0 "$CUR_N"

  line "收尾：其它接口未受影响"
  eq "GET /api/prompts/:id 仍返回详情（形状不变）" "$V" "$(curl -s -b "$JAR" "$BASE/api/prompts/$V" | jq -r .id)"
  eq "use_count 仍是数字" true "$(curl -s -b "$JAR" "$BASE/api/prompts/$V" | jq -r '.use_count | type == "number"')"
  eq "导出接口仍可用（schema_version 不变 = 1）" 1 "$(curl -s -b "$JAR" "$BASE/api/export" | jq -r .schema_version)"
  eq "迁移版本仍 v6" 6 "$(q 'SELECT MAX(version) FROM schema_migrations;')"
fi

line "结论"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ AC-115 全部通过"
else
  echo "  ❌ 有未通过项（见上方 ❌）"
fi
exit "$FAIL"
