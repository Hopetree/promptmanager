#!/usr/bin/env bash
# 重置**开发环境的持久数据目录**（默认 <repo>/dev-data）：先备份，再清空。
#
# 用途：需要一个干净起点时。**不是日常必需** —— 开发数据是持久的，
#       平时应直接复用 dev-data 里的既有数据，不要反复重造夹具。
#
# ⚠️ 本脚本会 `rm -rf` 目标目录，因此带**路径护栏**（见下）：
#    目标必须位于**本仓库内**，且不是仓库根、不是文件系统根、不是系统目录。
#    （护栏是 dsh 2026-09-25 提出的 —— 原版无校验，`PM_DEV_DATA_DIR=/var/lib/promptmanager`
#      会把**测试环境数据**删掉。已加严：另拒仓库根本身、相对路径按仓库根解析。）
#
# 本脚本**只管 DATA_DIR，不管实例生命周期** —— 端口与起停由 dsh 自己决定。
#
# 用法：
#   bash tools/pm-dev-data-reset.sh            # 交互确认
#   bash tools/pm-dev-data-reset.sh --yes     # 跳过确认（护栏仍然生效）
#   PM_DEV_DATA_DIR=./tmp/xxx bash tools/pm-dev-data-reset.sh   # 仓库内任意目录（用于自测）
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
DEV_DIR_IN=${PM_DEV_DATA_DIR:-$REPO_ROOT/dev-data}

die() { echo "❌ 拒绝执行：$*" >&2; exit 1; }

# ---- 路径归一：相对路径按「仓库根」解析（不受调用时 cwd 影响）；解析 .. 与符号链接 ----
if [[ "$DEV_DIR_IN" = /* ]]; then
  _p="$DEV_DIR_IN"
else
  _p="$REPO_ROOT/$DEV_DIR_IN"
fi
if command -v realpath >/dev/null 2>&1; then
  DEV_DIR=$(realpath -m "$_p")
else
  DEV_DIR=$(python3 -c 'import os,sys;print(os.path.realpath(sys.argv[1]))' "$_p")
fi

# ---- 护栏 ①：必须位于仓库内 ----
case "$DEV_DIR" in
  "$REPO_ROOT"/*) ;;
  *) die "DEV_DIR 必须位于仓库内（$REPO_ROOT），当前解析为：$DEV_DIR" ;;
esac

# ---- 护栏 ②：不能是仓库根本身 ----
[[ "$DEV_DIR" == "$REPO_ROOT" ]] && die "DEV_DIR 不能是仓库根：$DEV_DIR"

# ---- 护栏 ③：显式拒绝高危路径（纵深防御，正常已被 ① 挡住）----
case "$DEV_DIR" in
  /|/root|/home|/var|/var/lib|/etc|/usr|/opt|/tmp)
    die "危险路径：$DEV_DIR" ;;
esac
# 仓库内也不许拿掉工作区根级目录（如 ./backups、./tools）。
# 注意：**不要把 dev-data 列进来** —— 它正是本脚本的合法默认目标。
case "$(basename "$DEV_DIR")" in
  .git|tools|bin|web|src|node_modules|backups|scripts|docs|tests|migrations)
    die "拒绝重置仓库根级目录：$DEV_DIR" ;;
esac

TS=$(date +%Y%m%d-%H%M%S)
BK="$REPO_ROOT/backups/dev-data/$TS-reset"

echo "仓库根：$REPO_ROOT"
echo "待重置：$DEV_DIR"
echo "备份到：$BK"
echo

if [[ "${1:-}" != "--yes" ]]; then
  echo "⚠️  这会 **删除并重建** 上面的目录（备份会先做）。"
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
# 备份已在 ① 完成，这里才敢删。整目录删掉重建，避免残留 WAL/SHM 等文件。
rm -rf "$DEV_DIR"
mkdir -p "$DEV_DIR/media"
chmod 750 "$DEV_DIR"
echo "  $DEV_DIR 已清空并重建（残留文件数 = $(find "$DEV_DIR" -type f | wc -l)）"
echo "  （若实例正在跑，请自行重启它才会取到新数据）"

cat <<EOT

✅ 重置完成。备份：$BK
   下一步 —— 目录是空的，**首次登录前必须先设口令**（口令从 stdin 读，不打印）：
     printf '你的口令' | node bin/pm.mjs user set-password --username admin
   然后照常用自己的端口起实例，例如：
     DATA_DIR=./dev-data PORT=8765 node dist/server/index.js
EOT
