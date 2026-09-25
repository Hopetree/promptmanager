#!/usr/bin/env bash
# 重置**开发环境的持久数据目录**（默认 <repo>/dev-data）：先备份，再清空。
#
# 用途：需要一个干净起点时。**不是日常必需** —— 开发数据是持久的，
#       平时应直接复用 dev-data 里的既有数据，不要反复重造夹具。
#
# 注意：本脚本**只管 DATA_DIR，不管实例生命周期** ——
#       实例（起哪个端口、何时起停）由 dsh 自己决定。
#
# 用法：
#   bash tools/pm-dev-data-reset.sh            # 交互确认
#   bash tools/pm-dev-data-reset.sh --yes     # 跳过确认
#   PM_DEV_DATA_DIR=/path/to/dir bash tools/pm-dev-data-reset.sh
set -euo pipefail

# 仓库根 = 本脚本所在 tools/ 的上一级
REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
DEV_DIR=${PM_DEV_DATA_DIR:-$REPO_ROOT/dev-data}
TS=$(date +%Y%m%d-%H%M%S)
BK="$REPO_ROOT/backups/dev-data/$TS-reset"

if [[ "${1:-}" != "--yes" ]]; then
  echo "⚠️  这会清空开发数据目录：$DEV_DIR"
  echo "   （会先备份到 $BK）"
  read -r -p "确认继续？输入 yes：" ans
  [[ "$ans" == "yes" ]] || { echo "已取消"; exit 1; }
fi

echo "=== ① 备份 → $BK ==="
mkdir -p "$BK"
if [[ -d "$DEV_DIR" ]] && [[ -n "$(ls -A "$DEV_DIR" 2>/dev/null)" ]]; then
  cp -a "$DEV_DIR/." "$BK/"
  echo "  已备份 $(du -sh "$BK" | cut -f1)"
else
  echo "  目录为空或不存在，跳过备份"
fi

echo "=== ② 清空并重建 ==="
mkdir -p "$DEV_DIR/media"
chmod 750 "$DEV_DIR"
echo "  $DEV_DIR 已重置"
echo "  （若实例正在跑，请自行重启它才会取到新数据）"

cat <<EOT

✅ 重置完成。备份：$BK
   下一步 —— 目录是空的，**首次登录前必须先设口令**（口令从 stdin 读，不打印）：
     printf '你的口令' | node bin/pm.mjs user set-password --username admin
   然后照常用自己的端口起实例，例如：
     DATA_DIR=./dev-data PORT=8765 node dist/server/index.js
EOT
