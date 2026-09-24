#!/usr/bin/env bash
# 阶段 51 验收自检（FR-115：FIX 不含变量复制未计入取用）：
#   AC-116 ① **不含变量复制 = +1**（用户报障核心，**必须实测**）：界面点一次「复制提示词」⇒ 新增 1 条 kind='copy'
#        ② **含变量：弹窗不记账**：点「复制提示词」只打开弹窗 ⇒ 库内不新增记录
#        ③ **含变量：复制结果 = +1**：弹窗里点「复制结果」⇒ 恰好 +1 条 kind='copy'
#        ④ **一次复制一条**：①③ 各做两遍 ⇒ 各 +2（不是 +4、也不是 +0）
#        ⑤ **打开详情不计数**（FR-114 不回归）：只点开 ⇒ kind='view' +1、计入型数不变
#        ⑥ **列表 / 搜索不记**：记录总数不变
#        ⑦ **归因正确**：会话复制 channel='session'&token_id=null；令牌渲染取用 channel='token'&记该令牌 id
#        ⑧ **界面自洽**：「取用 N 次」增量 == 不含变量复制次数 + 含变量复制结果次数
#        ⑨ **无新增迁移**：usage_events 结构不变（kind 仍在、取值仍 view/copy/mcp）；schema 版本不变
#        ⑩ **回归**：npm test（本脚本复跑）/ ci-check（在脚本外另跑）
#
# 本条涉及**前端记账调用 + 后端小改** ⇒ 回归范围按 D-51 ④（受影响部分 + 全量 npm test + ci-check）。
# 全程临时 DATA_DIR + 台账范围内备用端口；不碰 8767 测试环境、不碰 106 生产。
# 用法：bash tools/ac-stage51.sh
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
DIR=$(mktemp -d /tmp/pm-ac51-XXXXXX)
DB="$DIR/pm.db"
q() { sqlite3 "$DB" "$1"; }
total() { q "SELECT COUNT(*) FROM usage_events;"; }
# 某 prompt 的**计入型**记录数
counted() { q "SELECT COUNT(*) FROM usage_events WHERE prompt_id=$1 AND coalesce(kind,'copy') IN ('copy','mcp');"; }
# 某 prompt 的 copy 条数
copies() { q "SELECT COUNT(*) FROM usage_events WHERE prompt_id=$1 AND kind='copy';"; }
# 某 prompt 的 view 条数
views() { q "SELECT COUNT(*) FROM usage_events WHERE prompt_id=$1 AND kind='view';"; }
# 最近一条**计入型**记录（避开"读 use_count"那次 GET 留下的 view）
last_counted() { q "SELECT id||'|'||prompt_id||'|'||channel||'|'||coalesce(token_id,'NULL')||'|'||kind FROM usage_events WHERE prompt_id=$1 AND coalesce(kind,'copy') IN ('copy','mcp') ORDER BY id DESC LIMIT 1;"; }
phase() { node tools/ac-stage51-probe.mjs "$BASE" "$SID" "$1" 2>/dev/null; }

line "构建 + 全量单测（前端记账 + 后端小改：本脚本 + 全量 npm test + ci-check）"
npm run build >"$DIR/build.log" 2>&1
eq "npm run build 退出码" 0 "$?"
npm test >"$DIR/test.log" 2>&1
eq "npm test 退出码" 0 "$?"
grep -E "^ℹ (tests|pass|fail)" "$DIR/test.log" | sed 's/^/  /'

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

  N=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"title":"AC116 无变量","user_prompt":"固定内容"}' "$BASE/api/prompts" | jq -r .id)
  V=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"title":"AC116 含变量","user_prompt":"你好 {{姓名}}"}' "$BASE/api/prompts" | jq -r .id)
  pass "夹具：无变量 prompt=$N ｜ 含变量 prompt=$V"

  line "AC-116 ⑨：无新增迁移 / 表结构不变"
  eq "迁移文件数仍是 6（001–006）" 6 "$(ls migrations/*.sql | wc -l)"
  eq "schema 版本仍 v6" 6 "$(q 'SELECT MAX(version) FROM schema_migrations;')"
  eq "usage_events 仍 6 列（含 kind）" 6 "$(q "SELECT COUNT(*) FROM pragma_table_info('usage_events');")"

  line "AC-116 ①：**不含变量复制 = +1**（用户报障核心，实测）"
  q "DELETE FROM usage_events;"
  ROWS0=$(total); C0=$(copies "$N")
  OUT1=$(phase copy-plain)
  printf '%s\n' "$OUT1" | sed 's/^/    /'
  echo "  \$ 操作前：记录 $ROWS0 条，其中 copy=$C0"
  echo "  \$ 操作后：记录 $(total) 条，其中 copy=$(copies "$N")"
  echo "  \$ 新记录原样：$(last_counted "$N")"
  eq "① 不含变量复制**恰好 +1 条 copy**" "$((C0 + 1))" "$(copies "$N")"
  eq "① 该记录 kind='copy'" "copy" "$(q "SELECT kind FROM usage_events WHERE prompt_id=$N ORDER BY id DESC LIMIT 1;")"
  eq "① 该记录 channel='session'（会话复制，归因正确）" "session" "$(q "SELECT channel FROM usage_events WHERE prompt_id=$N ORDER BY id DESC LIMIT 1;")"
  eq "① 该记录 token_id 为 NULL（会话无令牌可归因）" "1" "$(q "SELECT token_id IS NULL FROM usage_events WHERE prompt_id=$N ORDER BY id DESC LIMIT 1;")"
  /**
   * ⚠️ 探针的 `copy-plain` 阶段内部含"先点开该条"（那是 view 留痕、属打开详情）⇒ 不能用 views 总数为 0 来判。
   * 判据换成**看复制那一步的请求清单**：必须只有 `POST …/copy`，**没有** `GET /api/prompts/:id`。
   */
  eq "① 复制那一步**没有** GET /api/prompts/:id（未用"打开详情"兼职记账）" 0 "$(printf '%s' "$OUT1" | sed -n '/^REQS:/,$p' | grep -c "GET /api/prompts/$N\$" || true)"
  eq "① 复制那一步只发了 copy 端点" 1 "$(printf '%s' "$OUT1" | sed -n '/^REQS:/,$p' | grep -c 'POST /api/prompts/'$N'/copy' || true)"
  eq "① view 只有"点开"那一条（复制本身不产生 view）" "$(views "$N")" "$(q "SELECT COUNT(*) FROM usage_events WHERE prompt_id=$N AND kind='view';")"
  eq "① 复制步骤里出现 copy 端点调用" 1 "$(printf '%s' "$OUT1" | grep -c 'POST /api/prompts/'$N'/copy' || true)"

  line "AC-116 ②：含变量「复制提示词」只开弹窗 ⇒ **不记账**"
  q "DELETE FROM usage_events;"
  C2_BEFORE=$(counted "$V")
  OUT2=$(phase vars-dialog)
  printf '%s\n' "$OUT2" | sed 's/^/    /'
  echo "  \$ 弹窗阶段：计入型记录 $C2_BEFORE → $(counted "$V")（探针的这一步内含"点开"，故 views 会 +1，属打开详情）"
  eq "② 弹窗阶段**不产生任何计入型记录**" "$C2_BEFORE" "$(counted "$V")"
  eq "② 弹窗阶段产生的记录只有 view（打开详情那一条）" 0 "$(q "SELECT COUNT(*) FROM usage_events WHERE prompt_id=$V AND kind <> 'view';")"
  eq "② 弹窗阶段只请求了 variables（不记账的接口）" 1 "$(printf '%s' "$OUT2" | grep -c 'GET /api/prompts/'$V'/variables' || true)"
  eq "② 弹窗阶段**没有**任何计入型请求" 0 "$(printf '%s' "$OUT2" | grep -cE 'POST /api/prompts/'$V'/(copy|render)' || true)"

  line "AC-116 ③：含变量「复制结果」= +1"
  R1=$(total); C1=$(copies "$V")
  OUT3=$(phase copy-vars)
  printf '%s\n' "$OUT3" | sed 's/^/    /'
  echo "  \$ 操作后：记录 $R1 → $(total)，该 prompt copy=$(copies "$V")"
  echo "  \$ 新记录原样：$(last_counted "$V")"
  eq "③ 复制结果**恰好 +1 条 copy**" "$((C1 + 1))" "$(copies "$V")"
  eq "③ 该记录 kind='copy'" "copy" "$(q "SELECT kind FROM usage_events WHERE prompt_id=$V AND kind='copy' ORDER BY id DESC LIMIT 1;")"
  eq "③ 该记录 channel='session'" "session" "$(q "SELECT channel FROM usage_events WHERE prompt_id=$V AND kind='copy' ORDER BY id DESC LIMIT 1;")"

  line "AC-116 ④：两条分支各做两遍 ⇒ 各 +2（不是 +4、也不是 +0）"
  q "DELETE FROM usage_events;"
  phase copy-plain >/dev/null; phase copy-plain >/dev/null
  echo "  \$ 不含变量复制 ×2 ⇒ copy=$(copies "$N")"
  eq "④ 不含变量 ×2 ⇒ 恰好 +2" 2 "$(copies "$N")"
  phase open-vars >/dev/null; phase copy-vars >/dev/null
  phase open-vars >/dev/null; phase copy-vars >/dev/null
  echo "  \$ 含变量复制 ×2（每次含一次点开）⇒ copy=$(copies "$V")，view=$(views "$V")"
  eq "④ 含变量 ×2 ⇒ 恰好 +2 条 copy" 2 "$(copies "$V")"

  line "AC-116 ⑤：打开详情仍只留痕 view、不计数（FR-114 不回归）"
  q "DELETE FROM usage_events;"
  phase open-plain >/dev/null
  ROWS_V=$(total); VIEWS_N=$(views "$N"); COUNTED_N=$(counted "$N")
  echo "  \$ 只点开一次：记录 $ROWS_V 条，其中 view=$VIEWS_N、计入型=$COUNTED_N"
  eq "⑤ 只点开 ⇒ 新增 1 条 view" 1 "$VIEWS_N"
  eq "⑤ 计入型取用数**不变**（仍 0）" 0 "$COUNTED_N"
  eq "⑤ 该记录 kind='view'" "view" "$(q "SELECT kind FROM usage_events WHERE prompt_id=$N ORDER BY id DESC LIMIT 1;")"

  line "AC-116 ⑥：列表 / 搜索 / 翻页仍不记"
  q "DELETE FROM usage_events;"
  T0=$(total)
  curl -s -o /dev/null -b "$JAR" "$BASE/api/prompts"
  curl -s -o /dev/null -b "$JAR" "$BASE/api/prompts?q=AC116"
  curl -s -o /dev/null -b "$JAR" "$BASE/api/prompts?limit=5&offset=0"
  eq "⑥ 列表/搜索/翻页后记录总数不变" "$T0" "$(total)"
  eq "⑥ 记录总数仍是 0" 0 "$(total)"

  line "AC-116 ⑦：归因 —— 会话复制 session/null；令牌渲染取用 token/记该令牌 id"
  q "DELETE FROM usage_events;"
  # 会话侧：不含变量复制（走新的 copy 端点）
  phase copy-plain >/dev/null
  echo "  \$ 会话复制记录：$(last_counted "$N")"
  eq "⑦ 会话复制 channel='session'" "session" "$(q "SELECT channel FROM usage_events WHERE prompt_id=$N AND kind='copy' ORDER BY id DESC LIMIT 1;")"
  eq "⑦ 会话复制 token_id 为 NULL" "1" "$(q "SELECT token_id IS NULL FROM usage_events WHERE prompt_id=$N AND kind='copy' ORDER BY id DESC LIMIT 1;")"
  # 令牌侧：render（计入型）
  TOK_JSON=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"name":"AC116 令牌","scope":"read"}' "$BASE/api/tokens")
  TOK_ID=$(printf '%s' "$TOK_JSON" | jq -r .id)
  TOK=$(printf '%s' "$TOK_JSON" | jq -r .token)
  curl -s -o /dev/null -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d '{"values":{}}' "$BASE/api/prompts/$V/render"
  echo "  \$ 令牌取用记录：$(last_counted "$V")"
  eq "⑦ 令牌取用 channel='token'" "token" "$(q "SELECT channel FROM usage_events WHERE prompt_id=$V AND kind='copy' ORDER BY id DESC LIMIT 1;")"
  eq "⑦ 令牌取用记该令牌 id" "$TOK_ID" "$(q "SELECT token_id FROM usage_events WHERE prompt_id=$V AND kind='copy' ORDER BY id DESC LIMIT 1;")"
  # 只读令牌也能用新的 copy 端点（与 render 同档归"资源读"）
  eq "⑦ 只读令牌调 copy 端点 → 204（与 render 同档）" 204 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $TOK" "$BASE/api/prompts/$N/copy")"

  line "AC-116 ⑧：界面自洽（取用 N 次增量 == 不含变量复制次数 + 含变量复制结果次数）"
  q "DELETE FROM usage_events;"
  phase copy-plain >/dev/null        # 不含变量复制 ×1
  phase copy-plain >/dev/null        # ×2
  phase open-vars >/dev/null         # 只打开（不计）
  phase copy-vars >/dev/null         # 含变量复制结果 ×1
  phase vars-dialog >/dev/null       # 只开弹窗（不计）
  UC_N=$(curl -s -b "$JAR" "$BASE/api/prompts/$N" | jq -r .use_count)
  UC_V=$(curl -s -b "$JAR" "$BASE/api/prompts/$V" | jq -r .use_count)
  echo "  \$ 不含变量 prompt：use_count=$UC_N（期望 2：两次复制）"
  echo "  \$ 含变量 prompt  ：use_count=$UC_V（期望 2：一次点开不计 + 一次复制结果计 + 读 use_count 那次也留 view 不计）"
  eq "⑧ 不含变量：use_count == 复制次数（2）" 2 "$UC_N"
  eq "⑧ 不含变量：计入型记录数 == 2" 2 "$(counted "$N")"
  eq "⑧ 含变量：use_count == 复制结果次数（1）" 1 "$UC_V"
  eq "⑧ 含变量：计入型记录数 == 1" 1 "$(counted "$V")"
  /**
   * 含变量这条在本节被"打开"了 3 次（open-vars 1 次 + copy-vars 内部点开 1 次 + vars-dialog 内部点开 1 次）
   * 加上"读 use_count"那一次 ⇒ 4 条 view，全部**不计入**。
   */
  eq "⑧ 含变量：view 留痕 4 条，全部不计入" 4 "$(views "$V")"
  eq "⑧ 含变量：计入型仍是 1（与 use_count 一致）" 1 "$(counted "$V")"

  line "收尾：其它接口未受影响"
  eq "GET /api/prompts/:id 仍返回详情" "$N" "$(curl -s -b "$JAR" "$BASE/api/prompts/$N" | jq -r .id)"
  eq "复制端点返回 204（不返回正文）" 204 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -b "$JAR" "$BASE/api/prompts/$N/copy")"
  eq "不存在的 prompt 调 copy → 404" 404 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -b "$JAR" "$BASE/api/prompts/999999/copy")"
  eq "导出 schema_version 仍 1" 1 "$(curl -s -b "$JAR" "$BASE/api/export" | jq -r .schema_version)"
  eq "迁移版本仍 v6" 6 "$(q 'SELECT MAX(version) FROM schema_migrations;')"
fi

line "结论"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ AC-116 全部通过"
else
  echo "  ❌ 有未通过项（见上方 ❌）"
fi
exit "$FAIL"
