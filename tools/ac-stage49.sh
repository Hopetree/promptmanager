#!/usr/bin/env bash
# 阶段 49 验收自检（FR-113：FIX 复制一次被记两次取用）：
#   AC-114 ① **含变量的复制**：点开后点「复制提示词」→ 填值 → 「复制结果」，
#            **复制这一步只 +1**（只保留 render 那一次；改前是 +2：多了一次为拿正文的 GET）
#        ② **不含变量 = 点一次 +1** —— 口径已由 **FR-115（v62）/ AC-116 ①** 定为「点一次 +1」，
#            落地方式为 `POST /api/prompts/:id/copy`（D-51 允许实现自由，但**不得**用"再调 GET /:id"）。
#            （本脚本原写「复制这一步 +0、零 /api 请求」= v60 口径，阶段 58 按新规格改写 ② 段。）
#        ③ **打开详情留痕但不计数**（FR-114：记 kind='view'，不计入 use_count）
#        ④ **列表 / 搜索仍 = 0**
#        ⑤ **归因不变**：新增事件 channel='session'；令牌取用仍记 token_id（本阶段未触碰该链路，另跑既有断言）
#        ⑥ **界面数字自洽**：use_count == 库内**计入型**（kind ∈ copy/mcp）条数；读详情不产生计入型记录
#        ⑦ **结构未被本阶段改动（阶段 58 换口径）**：不再拿"全局迁移数 / 全局列数"当代理量，
#            改为「基线迁移文件仍在 + schema 版本 == migrations 最大编号 + 基线列仍在」——见收尾段注释
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
# 阶段 58 修（B 类）：原断言把 migrations/ 的文件总数钉死 5（"004/005 之后未新增"）。后续阶段
# 合法新增 006_usage-kind（v61 / FR-114）后恒红。改为守**本阶段基线迁移 001–005 仍在**：
# 精确、不随阶段数漂移，误删/改名基线迁移仍会红。
MIG_MISSING=''
for m in 001_init.sql 002_tokens-and-usage.sql 003_prompt-sort-order.sql 004_token-enc.sql 005_token-scope.sql; do
  [ -f "migrations/$m" ] || MIG_MISSING="$MIG_MISSING $m"
done
eq "本阶段基线迁移文件（001–005）仍在（006 是后续阶段合法新增）" "" "$MIG_MISSING"

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
  # ── 阶段 58 修（B 类）────────────────────────────────────────────────────────
  # 原为 `eq "迁移版本仍是 v5（无新增迁移）" 5 …` / `eq "usage_events 有 5 列（未改表结构）" 5 …`。
  # 问题不在"意图"（本阶段确实没动结构），而在**代理量**：拿"全局 schema 版本号 / 全局列数"当证据，
  # 后续阶段**合法**新增 006_usage-kind（v61 / FR-114）后必然恒红。HEAD 上无法复核"当时是否新增迁移"，
  # 可复核的是「基线未被回退」⇒ 基线文件仍在 + 版本不低于基线 + 基线列仍在（后加列不再误伤）。
  MIG_MISSING=''
  for m in 001_init.sql 002_tokens-and-usage.sql 003_prompt-sort-order.sql 004_token-enc.sql 005_token-scope.sql; do
    [ -f "migrations/$m" ] || MIG_MISSING="$MIG_MISSING $m"
  done
  eq "本阶段基线迁移文件（001–005）仍在（006 是后续阶段合法新增）" "" "$MIG_MISSING"
  MIG_MAX_FILE=$(ls migrations/*.sql | sed -E 's#^migrations/0*([0-9]+).*#\1#' | sort -n | tail -1)
  eq "schema 版本 == migrations/ 里最大编号（不变式；不拿固定 v5 当代理量）" "$MIG_MAX_FILE" "$(q 'SELECT MAX(version) FROM schema_migrations;')"
  eq "usage_events 仍含本阶段基线 5 列（id/prompt_id/channel/used_at/token_id）" 5 "$(q "SELECT COUNT(*) FROM pragma_table_info('usage_events') WHERE name IN ('id','prompt_id','channel','used_at','token_id');")"
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

  line "AC-114 ②：不含变量 —— 「复制提示词」**点一次 +1**（FR-115 / AC-116 ①；阶段 58 换口径）"
  q "DELETE FROM usage_events;"
  OUT2=$(phase open-plain)
  eq "② 点开无变量条目记 1 条（打开详情留痕）" 1 "$(n "$N")"
  cp "$DIR/server.log" "$DIR/server.before2.log"
  COPY_BEFORE=$(q "SELECT COUNT(*) FROM usage_events WHERE prompt_id=$N AND kind='copy';")
  OUT2B=$(phase copy-plain)
  printf '%s\n' "$OUT2B" | sed 's/^/    /'
  COPY_AFTER=$(q "SELECT COUNT(*) FROM usage_events WHERE prompt_id=$N AND kind='copy';")
  echo "  \$ kind='copy' 条数：复制前 $COPY_BEFORE → 复制后 $COPY_AFTER（期望恰好 +1）"
  # ── 阶段 58 修（A 类）────────────────────────────────────────────────────────
  # 原断言是 v60 口径：「复制这一步 +0」「该步骤零 /api 请求」。FR-115（v62）明确「不含变量 = 点一次 +1」，
  # AC-116 ① 要求「该 prompt 的**计入型**取用数（kind='copy'）恰好 +1」；D-51 只禁止"再调 GET /:id"。
  # ⇒ 按**计入型**计数（视图行不干扰），并守住"不得为拿正文再 GET 一次"。
  eq "② 不含变量：kind='copy' 恰好 +1（FR-115「点一次 +1」/ AC-116 ①）" "$((COPY_BEFORE + 1))" "$COPY_AFTER"
  eq "② 新增那条的 channel='session'（会话取用，归因不变）" "session" "$(q "SELECT channel FROM usage_events WHERE prompt_id=$N AND kind='copy' ORDER BY id DESC LIMIT 1;")"
  REQS2=$(printf '%s' "$OUT2B" | sed -n '/^REQS:/,$p')
  eq "② 复制步骤里**没有** GET /api/prompts/$N（D-51：不得再调 GET 详情）" 0 "$(printf '%s' "$REQS2" | grep -c "GET /api/prompts/$N\$" || true)"
  eq "② 复制步骤走复制端点 POST /api/prompts/$N/copy（FR-115 的落地方式）" 1 "$(printf '%s' "$REQS2" | grep -c "POST /api/prompts/$N/copy" || true)"

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

  line "AC-114 ⑥：界面数字自洽（use_count 只计计入型 copy/mcp；打开详情不计数 —— FR-114）"
  q "DELETE FROM usage_events;"
  phase open-vars >/dev/null            # 点开 1 次 → kind='view'（留痕但不计数）
  phase copy-vars >/dev/null            # 复制 1 次（内含点开 + 渲染）
  DB_N=$(n "$V")
  DB_COUNTED=$(q "SELECT COUNT(*) FROM usage_events WHERE prompt_id=$V AND kind IN ('copy','mcp');")
  DB_VIEW=$(q "SELECT COUNT(*) FROM usage_events WHERE prompt_id=$V AND kind='view';")
  # ── 阶段 58 修（A 类）────────────────────────────────────────────────────────
  # 原断言「use_count == 访问前条数 + 1（先记后读含本次）」是 v60 口径；FR-114（v61）已明确
  # 「打开详情留痕（kind='view'）但**不计入 use_count**」「use_count 只计 copy+mcp」⇒ 旧口径被取代。
  API_N=$(curl -s -b "$JAR" "$BASE/api/prompts/$V" | jq -r .use_count)
  DB_AFTER=$(n "$V")
  DB_COUNTED_AFTER=$(q "SELECT COUNT(*) FROM usage_events WHERE prompt_id=$V AND kind IN ('copy','mcp');")
  echo "  \$ 库内总条数 = $DB_N（计入型 copy/mcp = $DB_COUNTED，view = $DB_VIEW）｜ 接口 use_count = $API_N ｜ 读接口后库内 = $DB_AFTER"
  eq "⑥ 接口 use_count == 库内计入型（copy+mcp）条数（FR-114：打开详情不计数）" "$DB_COUNTED" "$API_N"
  eq "⑥ 打开详情确实留了痕（kind='view' ≥ 1）" 1 "$([ "$DB_VIEW" -ge 1 ] && echo 1 || echo 0)"
  eq "⑥ 读接口不产生计入型记录（GET 详情不把「读」算成取用）" "$DB_COUNTED" "$DB_COUNTED_AFTER"

  line "收尾：基线未被回退（阶段 58 换口径，理由见 AC-114 ⑦ 的头部说明）"
  # 原三条把"全局迁移文件数 / 全局 schema 版本 / 全局列数"当代理量 ⇒ 后续阶段合法新增后恒红。
  # 这里守真正可复核的东西：基线迁移文件仍在、版本不低于基线、基线列仍在（后加列不再误伤）。
  MIG_MISSING=''
  for m in 001_init.sql 002_tokens-and-usage.sql 003_prompt-sort-order.sql 004_token-enc.sql 005_token-scope.sql; do
    [ -f "migrations/$m" ] || MIG_MISSING="$MIG_MISSING $m"
  done
  eq "基线迁移文件（001–005）仍在（跑完检查后也没被回退）" "" "$MIG_MISSING"
  MIG_MAX_FILE=$(ls migrations/*.sql | sed -E 's#^migrations/0*([0-9]+).*#\1#' | sort -n | tail -1)
  eq "schema 版本 == migrations/ 里最大编号（不变式；不拿固定 v5 当代理量）" "$MIG_MAX_FILE" "$(q 'SELECT MAX(version) FROM schema_migrations;')"
  eq "usage_events 仍含基线 5 列（id/prompt_id/channel/used_at/token_id）" 5 "$(q "SELECT COUNT(*) FROM pragma_table_info('usage_events') WHERE name IN ('id','prompt_id','channel','used_at','token_id');")"
fi

line "结论"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ AC-114 全部通过"
else
  echo "  ❌ 有未通过项（见上方 ❌）"
fi
exit "$FAIL"
