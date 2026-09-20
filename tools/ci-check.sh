#!/usr/bin/env bash
# 代码质量检查（**本地与 CI 跑的是同一套** —— `.github/workflows/ci.yml` 只做 `npm ci` + 调本脚本）。
#
# 步骤（与 BRIEF AC-77 ③ 一致）：
#   ① 依赖就绪（`node_modules` 存在；CI 里由 workflow 先 `npm ci`）
#   ② 类型检查（`npm run typecheck:web` + `npm run typecheck:tests`）
#   ③ 全量测试（`npm test`，自带构建与类型检查）
#   ④ 构建（`npm run build`）+ 体积预算（最大 chunk ≤ 500 KB，超了让本脚本/CI 失败）
#
# 用法：bash tools/ci-check.sh            # 全跑
#       SKIP_TEST=1 bash tools/ci-check.sh # 跳过测试（仅本地调试用；CI 不用）
set -u

cd "$(dirname "$0")/.." || exit 1

MAX_CHUNK_BYTES=500000
SKIP_TEST=${SKIP_TEST:-0}
LOG_DIR=$(mktemp -d "${TMPDIR:-/tmp}/pm-ci-XXXXXX")
FAIL=0
declare -a ROWS=()

line() { printf '\n=== %s ===\n' "$1"; }
record() { # $1=步骤 $2=rc $3=摘要
  local mark='✅'
  [ "$2" -ne 0 ] && mark='❌' && FAIL=1
  ROWS+=("$(printf '%-34s rc=%-3s %s  %s' "$1" "$2" "$mark" "$3")")
  printf '  %s %s（rc=%s）%s\n' "$mark" "$1" "$2" "${3:+  $3}"
}

printf '== 代码质量检查（本地 / CI 同一套：tools/ci-check.sh）==\n'
printf '   工作目录：%s\n' "$(pwd)"
printf '   Node：%s ｜ npm：%s\n' "$(node --version)" "$(npm --version)"
printf '   日志目录：%s\n' "$LOG_DIR"

# ---------------------------------------------------------------- ① 依赖就绪
line "① 依赖就绪"
if [ -d node_modules ] && [ -f node_modules/.package-lock.json ]; then
  record "① 依赖已安装" 0 "node_modules 存在（CI 由 workflow 先跑 npm ci）"
else
  record "① 依赖已安装" 1 "缺 node_modules：请先 npm ci"
  printf '\n  依赖没装，后续步骤跳过。\n'
  exit 1
fi

# ---------------------------------------------------------------- ② 类型检查
line "② 类型检查"
npm run typecheck:web >"$LOG_DIR/typecheck-web.log" 2>&1
record "②a typecheck:web" $? "$(grep -cE 'error TS' "$LOG_DIR/typecheck-web.log") 个 TS 错误"
npm run typecheck:tests >"$LOG_DIR/typecheck-tests.log" 2>&1
record "②b typecheck:tests" $? "$(grep -cE 'error TS' "$LOG_DIR/typecheck-tests.log") 个 TS 错误"

# ---------------------------------------------------------------- ③ 全量测试
line "③ 全量测试"
if [ "$SKIP_TEST" = "1" ]; then
  record "③ npm test" 0 "（SKIP_TEST=1 跳过；CI 不跳过）"
else
  npm test >"$LOG_DIR/test.log" 2>&1
  TEST_RC=$?
  SUMMARY=$(grep -E '^ℹ (tests|pass|fail) ' "$LOG_DIR/test.log" | tr '\n' ' ')
  record "③ npm test" "$TEST_RC" "${SUMMARY:-见日志}"
  if [ "$TEST_RC" -ne 0 ]; then
    # 失败诊断：node:test 的"文件级失败"（如 'test failed'）真正原因在 ℹ Error: / unhandledRejection 这类行里，
    # 只 grep ✖ 会把它漏掉（2026-09-20 返工：让失败可诊断）。
    printf '\n  —— 失败诊断（完整日志：%s/test.log）——\n' "$LOG_DIR"
    grep -nE '^✖|not ok|ℹ Error:|Error:|unhandledRejection|uncaughtException|test failed|ERR_|code: ' "$LOG_DIR/test.log" \
      | head -40 | sed 's/^/    /'
    printf '  —— 日志末尾 15 行 ——\n'
    tail -15 "$LOG_DIR/test.log" | sed 's/^/    /'
  fi
fi

# ---------------------------------------------------------------- ④ 构建 + 体积预算
line "④ 构建 + 体积预算"
npm run build >"$LOG_DIR/build.log" 2>&1
record "④a npm run build" $? "$(grep -c 'larger than 500' "$LOG_DIR/build.log") 条 >500KB 告警"

CHUNK_REPORT=$(node -e '
const fs = require("fs");
const path = require("path");
const dir = "dist/web/assets";
if (!fs.existsSync(dir)) { console.log(JSON.stringify({ error: "dist/web/assets 不存在" })); process.exit(0); }
const rows = fs.readdirSync(dir)
  .filter((f) => f.endsWith(".js"))
  .map((f) => ({ file: f, bytes: fs.statSync(path.join(dir, f)).size }))
  .sort((a, b) => b.bytes - a.bytes);
const total = rows.reduce((sum, r) => sum + r.bytes, 0);
console.log(JSON.stringify({ max: rows[0] ?? null, total, count: rows.length }));
')
MAX_BYTES=$(printf '%s' "$CHUNK_REPORT" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["max"]["bytes"] if d.get("max") else 0)')
MAX_FILE=$(printf '%s' "$CHUNK_REPORT" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["max"]["file"] if d.get("max") else "-")')
TOTAL_KB=$(printf '%s' "$CHUNK_REPORT" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(round(d["total"]/1024))')
if [ "$MAX_BYTES" -le "$MAX_CHUNK_BYTES" ]; then
  record "④b 体积预算（最大 chunk ≤ 500KB）" 0 "最大 $MAX_FILE = $MAX_BYTES B（全部 js 合计 ${TOTAL_KB} KB）"
else
  record "④b 体积预算（最大 chunk ≤ 500KB）" 1 "最大 $MAX_FILE = $MAX_BYTES B **超预算**"
fi

# ---------------------------------------------------------------- 汇总
printf '\n== 汇总 ==\n'
for row in "${ROWS[@]}"; do printf '  %s\n' "$row"; done
if [ "$FAIL" -eq 0 ]; then
  printf '\n  ✅ 代码质量检查全部通过（%s 项）\n' "${#ROWS[@]}"
else
  printf '\n  ❌ 有未通过项（见上表 ❌）；完整日志：%s\n' "$LOG_DIR"
fi
exit "$FAIL"
