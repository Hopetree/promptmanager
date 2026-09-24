#!/usr/bin/env bash
# 阶段 49 验收自检（FR-113：FIX 复制一次被记两次取用）：
#   AC-114 ① **含变量的复制**：点开后点「复制提示词」→ 填值 → 「复制结果」，
#            **复制这一步只 +1**（只保留 render 那一次；改前是 +2：多了一次为拿正文的 GET）
#        ② **不含变量的复制**：点开后点「复制提示词」，**复制这一步 +0**（改前会为拿正文发一次 GET ⇒ +1）
#        ③ **打开详情仍 = +1**
#        ④ **列表 / 搜索仍 = 0**
#        ⑤ **归因不变**：新增事件 channel='session'；令牌取用仍记 token_id（本阶段未触碰该链路，另跑既有断言）
#        ⑥ **界面数字自洽**：重开详情后 use_count == 库内该 prompt 的事件条数
#        ⑦ **无新增迁移**：migrations 目录文件数不变、schema 版本仍 v5
#        ⑧ **回归**：npm test（本脚本复跑）/ ci-check（在脚本外另跑）
#
# 本条属**取用记账（逻辑类）** ⇒ 回归范围按 D-49 ④（受影响部分 + npm test + ci-check），不必全量。
# 全程临时 DATA_DIR + 台账范围内备用端口；不碰 8767 测试环境、不碰 106 生产。
# 用法：bash tools/ac-stage49.sh
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
DIR=$(mktemp -d /tmp/pm-ac49-XXXXXX)
DB="$DIR/pm.db"
q() { sqlite3 "$DB" "$1"; }
# 某个 prompt 的取用条数
n() { q "SELECT COUNT(*) FROM usage_events WHERE prompt_id=$1;"; }
# 跑一个界面上阶段，只把请求清单打到 stdout（stderr 丢弃）
phase() { node tools/ac-stage49-probe.mjs "$BASE" "$SID" "$1" 2>/dev/null; }

line "构建 + 全量单测（取用记账属逻辑类：本脚本 + npm test + ci-check 即为选定范围）"
npm run build >"$DIR/build.log" 2>&1
eq "npm run build 退出码" 0 "$?"
npm test >"$DIR/test.log" 2>&1
eq "npm test 退出码" 0 "$?"
grep -E "^ℹ (tests|pass|fail)" "$DIR/test.log" | sed 's/^/  /'

line "AC-114 ⑦：无新增迁移（目录层面；表结构在服务起来后核）"
eq "migrations 目录文件数（004/005 之后未新增）" 5 "$(ls migrations/*.sql | wc -l)"

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

  V=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"title":"AC114 含变量","user_prompt":"你好 {{姓名}}"}' "$BASE/api/prompts" | jq -r .id)
  N=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"title":"AC114 无变量","user_prompt":"固定内容"}' "$BASE/api/prompts" | jq -r .id)
  eq "迁移版本仍是 v5（无新增迁移）" 5 "$(q 'SELECT MAX(version) FROM schema_migrations;')"
  eq "usage_events 有 5 列（未改表结构）" 5 "$(q "SELECT COUNT(*) FROM pragma_table_info('usage_events');")"
  pass "夹具：含变量 prompt=$V ｜ 无变量 prompt=$N"

  line "AC-114 ①：含变量 —— 点开(=1) 后「复制提示词 → 复制结果」**只 +1**"
  q "DELETE FROM usage_events;"
  phase open-vars >/dev/null                     # 第一步：点开（独立动作）
  echo "  \$ 点开后条数 = $(n "$V")（期望 1）"
  eq "① 点开条目记 1 条" 1 "$(n "$V")"
  OUT=$(phase copy-vars)                         # 第二步：复制（探针内部会再点开一次，故基线要按 +1 看）
  printf '%s\n' "$OUT" | sed 's/^/    /'
  # 复制那一步的请求清单：**不得**再出现计数的 GET，只保留 variables + render
  eq "① 复制步骤里**没有** GET /api/prompts/:id（不再为拿正文而计数）" 0 "$(printf '%s' "$OUT" | sed -n '/^REQS:/,$p' | grep -c "GET /api/prompts/$V$" || true)"
  eq "① 复制步骤里仍有 render（保留这一次）" 1 "$(printf '%s' "$OUT" | sed -n '/^REQS:/,$p' | grep -c "POST /api/prompts/$V/render" || true)"
  echo "  \$ 复制后条数 = $(n "$V")（= 单独点开 1 + 复制的两步 2；**关键是复制那一步只 +1**）"
  eq "① 一次「复制」动作只记 1 条（复制的两步 = 点开1 + 渲染1）" 2 "$(( $(n "$V") - 1 ))"
  echo "  \$ used_at 原样："
  q "SELECT id, prompt_id, channel, token_id, used_at FROM usage_events WHERE prompt_id=$V ORDER BY id;" | sed 's/^/      /'
  eq "① 所有新增事件的 channel 都是 session" 0 "$(q "SELECT COUNT(*) FROM usage_events WHERE prompt_id=$V AND channel <> 'session';")"
  eq "① 事件条数与上面数字一致（自洽）" "$(n "$V")" "$(q "SELECT COUNT(*) FROM usage_events WHERE prompt_id=$V;")" 
  eq "① 两条的 token_id 都是 NULL（会话取用，归因不变）" 0 "$(q "SELECT COUNT(*) FROM usage_events WHERE prompt_id=$V AND token_id IS NOT NULL;")"

  line "AC-114 ②：不含变量 —— 点开(=1) 后「复制提示词」**+0**"
  q "DELETE FROM usage_events;"
  OUT2=$(phase open-plain)
  eq "② 点开无变量条目记 1 条" 1 "$(n "$N")"
  cp "$DIR/server.log" "$DIR/server.before2.log"
  OUT2B=$(phase copy-plain)
  printf '%s\n' "$OUT2B" | sed 's/^/    /'
  echo "  \$ 复制后条数 = $(n "$N")（期望仍 1；**改前复制会再 +1 变 2**）"
  eq "② 不含变量的「复制提示词」**不额外记账**（仍 1 条）" 1 "$(n "$N")"
  eq "② 该步骤零 /api 请求（正文直接用已有数据）" "(none)" "$(printf '%s' "$OUT2B" | sed -n '/^REQS:/,$p' | sed -n '2p')"

  line "AC-114 ③：只打开详情 = +1"
  q "DELETE FROM usage_events;"
  phase open-vars >/dev/null
  eq "③ 打开详情记 1 条" 1 "$(n "$V")"

  line "AC-114 ④：列表 + 搜索 = 0"
  q "DELETE FROM usage_events;"
  curl -s -o /dev/null -b "$JAR" "$BASE/api/prompts"
  curl -s -o /dev/null -b "$JAR" "$BASE/api/prompts?q=AC114"
  curl -s -o /dev/null -b "$JAR" "$BASE/api/prompts?limit=5&offset=0"
  eq "④ 列表 / 搜索 / 翻页 都不记账" 0 "$(q 'SELECT COUNT(*) FROM usage_events;')"

  line "AC-114 ⑤：归因不变（令牌取用仍记该令牌 id）"
  RO_JSON=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"name":"AC114 只读","scope":"read"}' "$BASE/api/tokens")
  RO_ID=$(printf '%s' "$RO_JSON" | jq -r .id)
  RO=$(printf '%s' "$RO_JSON" | jq -r .token)
  q "DELETE FROM usage_events;"
  curl -s -o /dev/null -H "Authorization: Bearer $RO" "$BASE/api/prompts/$V"
  eq "⑤ 令牌取用记 1 条" 1 "$(q 'SELECT COUNT(*) FROM usage_events;')"
  eq "⑤ 该条的 token_id == 该令牌 id" "$RO_ID" "$(q 'SELECT token_id FROM usage_events ORDER BY id DESC LIMIT 1;')"
  eq "⑤ 该条的 channel == token" "token" "$(q 'SELECT channel FROM usage_events ORDER BY id DESC LIMIT 1;')"

  line "AC-114 ⑥：界面数字自洽（重开详情后 use_count == 库内条数）"
  q "DELETE FROM usage_events;"
  phase open-vars >/dev/null            # 点开 1 次
  phase copy-vars >/dev/null            # 复制 1 次（内含点开 + 渲染）
  DB_N=$(n "$V")
  # 接口的 use_count 来自同一次查询：**它会包含"这次 GET 自己"**（服务端先记后读）⇒ 期望 DB_N + 1
  API_N=$(curl -s -b "$JAR" "$BASE/api/prompts/$V" | jq -r .use_count)
  DB_AFTER=$(n "$V")
  echo "  \$ 访问接口前库内 = $DB_N ｜ 接口 use_count = $API_N ｜ 接口访问后库内 = $DB_AFTER"
  eq "⑥ 接口 use_count == 访问前的条数 + 1（即"先记后读"含本次）" "$((DB_N + 1))" "$API_N"
  eq "⑥ 接口访问后库内也真的 +1（数字与库一致）" "$((DB_N + 1))" "$DB_AFTER"

  line "收尾：无新增迁移 / 表结构未变"
  eq "迁移文件数仍 5" 5 "$(ls migrations/*.sql | wc -l)"
  eq "schema 版本仍 v5" 5 "$(q 'SELECT MAX(version) FROM schema_migrations;')"
  eq "usage_events 列数仍 5" 5 "$(q "SELECT COUNT(*) FROM pragma_table_info('usage_events');")"
fi

line "结论"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ AC-114 全部通过"
else
  echo "  ❌ 有未通过项（见上方 ❌）"
fi
exit "$FAIL"
