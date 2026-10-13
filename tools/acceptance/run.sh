#!/usr/bin/env bash
# 验收脚本一键入口（FR-164 / AC-135 E19）。
#
# 这些脚本是**交付态**：随仓库入库，按阶段归档在 tools/acceptance/。
# 它们自己会 `cd "$(dirname "$0")/../.."` 回到仓库根，并只往 tmp/ 写运行产物（截图 / DOM 快照 / 日志），
# tmp/ 不入库（AGENTS.md §5.1）。
#
# 用法：
#   bash tools/acceptance/run.sh --list          # 盘点：按阶段列出全部脚本与探针
#   bash tools/acceptance/run.sh 71              # 跑阶段 71 的全部脚本（ac-stage71*.sh）
#   bash tools/acceptance/run.sh 71 --dry-run    # 只打印会跑哪些，不执行
#
# 前置：`npm run build` 已跑过（多数脚本从 dist/** 起服务；脚本自己也会做前置检查）。
set -u

cd "$(dirname "$0")" || exit 1
DIR=$(pwd)

list_stages() {
  local total sh_count mjs_count
  sh_count=$(ls "$DIR"/ac-stage*.sh 2>/dev/null | wc -l | tr -d ' ')
  mjs_count=$(ls "$DIR"/ac-stage*.mjs 2>/dev/null | wc -l | tr -d ' ')
  total=$((sh_count + mjs_count))
  echo "tools/acceptance/：${total} 个脚本（${sh_count} 个 .sh + ${mjs_count} 个 .mjs）"
  echo
  echo "阶段   脚本"
  echo "----   ----"
  local f stage
  for f in $(ls "$DIR"/ac-stage*.sh 2>/dev/null | sort -V); do
    stage=$(basename "$f" | sed -E 's/^ac-stage([0-9]+).*/\1/')
    printf '%-6s %s\n' "$stage" "$(basename "$f")"
  done
}

if [ "$#" -eq 0 ] || [ "${1:-}" = "--list" ] || [ "${1:-}" = "-l" ]; then
  list_stages
  exit 0
fi

STAGE=$1
shift
DRY=0
if [ "${1:-}" = "--dry-run" ]; then DRY=1; fi

MATCHES=$(ls "$DIR"/ac-stage"$STAGE"*.sh 2>/dev/null | sort -V || true)
if [ -z "$MATCHES" ]; then
  echo "没有阶段 ${STAGE} 的验收脚本。用 --list 看有哪些阶段。" >&2
  exit 1
fi
# 主脚本（ac-stageNN.sh）先跑，返工/补充脚本按名字排后面。
MAIN="$DIR/ac-stage${STAGE}.sh"
ORDERED=""
for f in $MATCHES; do
  [ "$f" = "$MAIN" ] || ORDERED="$ORDERED $f"
done
[ -f "$MAIN" ] && ORDERED="$MAIN$ORDERED"

for f in $ORDERED; do
  if [ "$DRY" = "1" ]; then
    echo "会跑：$(basename "$f")"
    continue
  fi
  echo "=== 跑 $(basename "$f") ==="
  bash "$f" || { echo "❌ $(basename "$f") 未通过（rc=$?）" >&2; exit 1; }
done
if [ "$DRY" = "1" ]; then
  echo "（--dry-run：只打印，不执行）"
else
  echo "✅ 阶段 ${STAGE} 的验收脚本全部通过"
fi
