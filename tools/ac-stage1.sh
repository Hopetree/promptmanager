#!/usr/bin/env bash
# 阶段 1 验收自检：AC-1 / AC-2 / AC-18 / AC-19 / AC-20（附带 AC-21 的预览检查）。
# 特点：自起自停（临时 DATA_DIR + 临时端口进程），跑完不留常驻服务；不触碰生产文件。
# 用法：bash tools/ac-stage1.sh
set -u

cd "$(dirname "$0")/.." || exit 1
PROJ=$PWD
PORT=${PORT:-8767}
AC_DIR=$(mktemp -d /tmp/pm-ac-XXXXXX)
SRV_LOG=$AC_DIR/server.log

AC_PW='ac-fixture-pw-20260918'   # 仅为夹具口令，不是真实凭据

line() { printf '\n=== %s ===\n' "$1"; }

SRV_PID=''
NODE_PID=''
cleanup() {
  [ -n "$NODE_PID" ] && kill "$NODE_PID" 2>/dev/null
  [ -n "$SRV_PID" ] && kill "$SRV_PID" 2>/dev/null
  sleep 1
  rm -rf "$AC_DIR"
}
trap cleanup EXIT

line "AC-1 冷装与构建"
rm -rf node_modules dist && npm ci && npm run build
echo "rc=$?"
test -d dist && echo "dist 存在：$(ls -d dist/web dist/server | tr '\n' ' ')" || echo "dist 不存在！"
echo "--- git status --short（应无构建产物）"
git status --short

line "AC-2 启动与监听（PORT=$PORT，HOST 不设 → 走默认 0.0.0.0）"
DATA_DIR="$AC_DIR" PORT="$PORT" npm start >"$SRV_LOG" 2>&1 &
SRV_PID=$!
sleep 3
NODE_PID=$(pgrep -P "$SRV_PID" | head -1)
echo "--- ss -ltn | grep ':$PORT'"
ss -ltn | grep ":$PORT"
echo "--- curl -o /dev/null -w '%{http_code}' /healthz"
curl -s -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:$PORT/healthz"
echo "--- curl /healthz"
curl -s "http://127.0.0.1:$PORT/healthz"
echo
echo "--- 启动日志（打印实际监听地址）"
grep -o 'promptmanager listening on[^"]*' "$SRV_LOG" | head -2

line "AC-19 端口纪律与文档一致"
echo "--- grep -rn '$PORT' package.json src bin deploy README.md"
grep -rn "$PORT" package.json src bin deploy README.md | head
echo "--- ss -ltn | grep -c ':$PORT'（服务在跑，期望 1）"
ss -ltn | grep -c ":$PORT"
echo "--- grep -n '$PORT' PROGRESS.md README.md"
grep -n "$PORT" PROGRESS.md README.md | head

line "AC-21 预览：组件库真的在渲染（阶段 6 正式验收）"
CHROME=$(ls -d /root/.cache/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell 2>/dev/null | tail -1)
if [ -n "$CHROME" ]; then
  echo "chrome: $CHROME"
  "$CHROME" --headless --no-sandbox --disable-gpu --hide-scrollbars --window-size=1280,800 \
    --virtual-time-budget=6000 --dump-dom "http://127.0.0.1:$PORT/" 2>/dev/null >"$AC_DIR/dom.html"
  echo "distinct ant-* class 数：$(grep -o 'ant-[a-z-]*' "$AC_DIR/dom.html" | sort -u | wc -l)"
  echo "样例：$(grep -o 'ant-[a-z-]*' "$AC_DIR/dom.html" | sort -u | head -8 | tr '\n' ' ')"
else
  echo "未找到 headless chromium，跳过"
fi

line "停止服务并核验端口已释放"
cleanup
SRV_PID=''; NODE_PID=''
echo "ss -ltn | grep -c ':$PORT'（期望 0）: $(ss -ltn | grep -c ":$PORT")"

line "AC-18 部署文件（交付物验收）"
echo "--- sudo systemd-analyze verify deploy/promptmanager.service 2>&1 | grep -c error"
sudo systemd-analyze verify deploy/promptmanager.service 2>&1 | grep -c error
echo "--- grep -cE '^(User|Group|WorkingDirectory|EnvironmentFile|Restart)=' deploy/promptmanager.service"
grep -cE '^(User|Group|WorkingDirectory|EnvironmentFile|Restart)=' deploy/promptmanager.service
echo "--- grep -c MemoryDenyWriteExecute deploy/promptmanager.service"
grep -c MemoryDenyWriteExecute deploy/promptmanager.service
echo "--- grep -cE '^[A-Z_]*(PASSWORD|SECRET|TOKEN|KEY)[A-Z_]*=.+$' deploy/promptmanager.env.example"
grep -cE '^[A-Z_]*(PASSWORD|SECRET|TOKEN|KEY)[A-Z_]*=.+$' deploy/promptmanager.env.example

line "AC-20 前端组件库落地"
echo "--- ① npm ls antd @ant-design/icons --depth=0"
npm ls antd @ant-design/icons --depth=0
echo "--- ①b 不得出现 v5 补丁包：npm ls @ant-design/v5-patch-for-react-19 --depth=0"
npm ls @ant-design/v5-patch-for-react-19 --depth=0 2>&1 | tail -2
echo "--- ② grep -rnE '<(button|input|select|textarea|table|dialog)[ >/]' web/src --include='*.tsx' | wc -l"
grep -rnE "<(button|input|select|textarea|table|dialog)[ >/]" web/src --include='*.tsx' | wc -l
echo "--- ③ grep -rnoE \"from ['\\\"]antd['\\\"]\" web/src --include='*.tsx' | wc -l"
grep -rnoE "from ['\"]antd['\"]" web/src --include='*.tsx' | wc -l
echo "--- ④ grep -rnE '(cdn|unpkg|jsdelivr|googleapis)' dist/ web/src --include='*.html' --include='*.tsx' --include='*.css' | wc -l"
grep -rnE "(cdn|unpkg|jsdelivr|googleapis)" dist/ web/src --include='*.html' --include='*.tsx' --include='*.css' | wc -l

line "AC-16（部分）全量测试"
npm test 2>&1 | tail -12

echo
echo "AC 自检结束；夹具目录已清理，端口 $PORT 已释放。"
