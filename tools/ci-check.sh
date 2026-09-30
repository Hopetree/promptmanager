#!/usr/bin/env bash
# 代码质量检查（**本地与 CI 跑的是同一套** —— `.github/workflows/ci.yml` 只做 `npm ci` + 调本脚本）。
#
# 步骤：
#   ⓪ 文档体积预算（`AGENTS.md` 必须留在 AI 代理的指令预算内）
#   ① 依赖就绪（`node_modules` 存在；CI 里由 workflow 先 `npm ci`）
#   ①b 静态检查（`npm run lint` = oxlint）
#   ①c 依赖台账一致性（`docs/dependencies.md` 必须与实际版本相符）
#   ② 构建（`npm run build`）
#   ③ 类型检查（`npm run typecheck:web` + `npm run typecheck:tests`）
#   ④ 全量测试（`npm test`，自带构建与类型检查）
#   ⑤ 体积预算（最大 chunk ≤ 500 KB，超了让本脚本/CI 失败）
#
# ⚠️ **为什么"构建"必须排在 `typecheck:tests` 之前**（2026-09-21 修）：
#   `tests/**/*.test.ts` 里写的是 `import ... from '../dist/…'` —— **类型检查解析的是构建产物**。
#   干净环境（CI 的 checkout 里没有 `dist/`）若先跑 `typecheck:tests`，会得到 **38 个 TS2307**
#   （`Cannot find module '../dist/…'`，外加 3 个级联的 TS7006）⇒ **CI 必红**。
#   本地之所以"看起来正常"，是因为本地一直留着历史 `dist/`（`dist/` 在 .gitignore 里，CI 拿不到）。
#   复现对照：`rm -rf dist && npm run typecheck:tests` → **38 个错误**；
#            `npm run build && npm run typecheck:tests` → **0 个错误**。
#   注意：`npm test`（④）自身会先 `build`，所以它在旧顺序下一直是绿的 —— 问题只暴露在 ③ 之前没有 dist 时。
#   代价说明：② 与 ④ 各构建一次（`npm test` 是项目官方入口、内部自带构建，不改它）；两次构建合计约 5 秒。
#
# 两层防护（第二层是为了让"裸跑"也不再有未声明前置条件）：
#   ① 本脚本顺序：**构建（②）在类型检查（③）之前**；
#   ② `package.json` 的 `typecheck:tests` 自带 `npm run build:server &&` 前缀 —— 于是
#      **任何**调用点（人、CI、别的脚本）都不会再遇到 38 个 TS2307，字面命令
#      `rm -rf dist && npm run typecheck:tests` 也直接是 0 个错误。
#      代价：`npm test` 会多一次服务端 tsc（实测约 +1.5 秒），换来"前置条件被显式声明"。
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

# ---------------------------------------------------------------- ⓪ 文档体积预算
# 为什么有这个门禁：AI 代理（dsh）会把「全局指令文件 + 本仓库 AGENTS.md」注入到每轮上下文，
# 预算由 dsh-base 固定为 **65536 B**（`dsh-base/cordis.patch.yml` 的 `agent-instructions.config.maxBytes`）。
# 超预算的处理是：**先整体丢弃最宽泛的文件，再从尾部截断最具体的** —— 也就是会先丢全局文件、
# 再砍掉 AGENTS.md 的**尾部章节**，而新会话只会看到一行 budget 提示、不知道丢了什么。
# 所以 AGENTS.md 的体积极限是一个**硬约束**，不是风格问题：宁可 CI 红灯，也不要静默丢约束。
#
# 阈值：按 65536 的百分比留白，而不是拍一个绝对数 ——
#   预警 55%（36000 B）：还有余量，但该准备精简了；
#   红线 61%（40000 B）：余下约 25 KB 留给「全局指令文件（约 2.7 KB）+ 后续正常增长」。
# 计量口径：**渲染后**的字节（文件本身 + `Instructions from: <path>` 段头），不是裸 `stat`。
line "⓪ 文档体积预算（AGENTS.md）"
DOC_BUDGET=65536
DOC_WARN=36000
DOC_FAIL=40000
DOC_BYTES=$(node -e '
const fs=require("fs");
const p="AGENTS.md";
const body=fs.readFileSync(p,"utf8");
const header="Instructions from: "+p+"\n\n";
process.stdout.write(String(Buffer.byteLength(header+body,"utf8")));
')
if [ "$DOC_BYTES" -gt "$DOC_FAIL" ]; then
  record "⓪ AGENTS.md 体积预算" 1 "$DOC_BYTES B = $((DOC_BYTES * 100 / DOC_BUDGET))% 指令预算（$DOC_BUDGET B）**超红线** —— 精简后再提交"
elif [ "$DOC_BYTES" -gt "$DOC_WARN" ]; then
  record "⓪ AGENTS.md 体积预算" 0 "$DOC_BYTES B = $((DOC_BYTES * 100 / DOC_BUDGET))% 指令预算（已过预警线 $DOC_WARN）"
else
  record "⓪ AGENTS.md 体积预算" 0 "$DOC_BYTES B = $((DOC_BYTES * 100 / DOC_BUDGET))% 指令预算"
fi

# ---------------------------------------------------------------- ① 依赖就绪
line "① 依赖就绪"
if [ -d node_modules ] && [ -f node_modules/.package-lock.json ]; then
  record "① 依赖已安装" 0 "node_modules 存在（CI 由 workflow 先跑 npm ci）"
else
  record "① 依赖已安装" 1 "缺 node_modules：请先 npm ci"
  printf '\n  依赖没装，后续步骤跳过。\n'
  exit 1
fi

# ---------------------------------------------------------------- ①b 静态检查（lint）
# oxlint（Rust 实现，全仓 170 个文件毫秒级）。范围 = 全仓（`npm run lint` = `oxlint .`）。
# 一次性验收脚本已移出仓库（过程态不入库），所以这里不再需要排除任何目录。
line "①b 静态检查（oxlint）"
npm run lint >"$LOG_DIR/lint.log" 2>&1
record "①b npm run lint" $? "$(grep -oE 'Found [0-9]+ warnings? and [0-9]+ errors?' "$LOG_DIR/lint.log" | tail -1)"

# ---------------------------------------------------------------- ①c 依赖台账一致性
# 为什么：`docs/dependencies.md` 是**手工维护**的版本台账，而版本会被自动化改动
# （dependabot / `npm install`）改掉 —— 一次合并就可能让台账过期，**且没有任何东西会发现**。
# 2026-09-30 的 dependabot 合并（vite / marked / MCP SDK）就是这样把台账弄过期的。
# 判据：package.json 的每个直接依赖都必须在台账里有一行 `| \`name\` | <version> |`。
line "①c 依赖台账一致性"
node tools/check-deps-ledger.mjs >"$LOG_DIR/deps-ledger.log" 2>&1
record "①c 依赖台账一致性" $? "$(tail -1 "$LOG_DIR/deps-ledger.log")"

# ---------------------------------------------------------------- ② 构建
# 必须在 ③ 之前：tests 的类型检查依赖 ../dist/**（见文件头"为什么必须先构建"）。
line "② 构建（必须先于类型检查）"
npm run build >"$LOG_DIR/build.log" 2>&1
record "② npm run build" $? "$(grep -c 'larger than 500' "$LOG_DIR/build.log") 条 >500KB 告警"

# ---------------------------------------------------------------- ③ 类型检查
# 依赖 ② 的构建产物；`typecheck:tests` 自己也带 build:server 前缀（双保险，见文件头"两层防护"）。
line "③ 类型检查（依赖 ② 的构建产物）"
npm run typecheck:web >"$LOG_DIR/typecheck-web.log" 2>&1
record "③a typecheck:web" $? "$(grep -cE 'error TS' "$LOG_DIR/typecheck-web.log") 个 TS 错误"
npm run typecheck:tests >"$LOG_DIR/typecheck-tests.log" 2>&1
record "③b typecheck:tests" $? "$(grep -cE 'error TS' "$LOG_DIR/typecheck-tests.log") 个 TS 错误"

# ---------------------------------------------------------------- ④ 全量测试
line "④ 全量测试"
if [ "$SKIP_TEST" = "1" ]; then
  record "④ npm test" 0 "（SKIP_TEST=1 跳过；CI 不跳过）"
else
  npm test >"$LOG_DIR/test.log" 2>&1
  TEST_RC=$?
  SUMMARY=$(grep -E '^ℹ (tests|pass|fail) ' "$LOG_DIR/test.log" | tr '\n' ' ')
  record "④ npm test" "$TEST_RC" "${SUMMARY:-见日志}"
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

# ---------------------------------------------------------------- ⑤ 体积预算
line "⑤ 体积预算"
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
  record "⑤ 体积预算（最大 chunk ≤ 500KB）" 0 "最大 $MAX_FILE = $MAX_BYTES B（全部 js 合计 ${TOTAL_KB} KB）"
else
  record "⑤ 体积预算（最大 chunk ≤ 500KB）" 1 "最大 $MAX_FILE = $MAX_BYTES B **超预算**"
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
