#!/usr/bin/env bash
# 阶段 59 / FR-125 / AC-121：远程数据同步的**真浏览器**自证（双端 + 零出网 + dry_run 不改远端）。
#
# 用法：`bash tools/ac-stage59-sync.sh`
# 前置：`npm run build` 已产出 `dist/`（本脚本不自己 build，避免长时间占用机器）。
#
# 形态：起一个**本地 GitHub 桩**（tools/ac-stage59-sync-stub.mjs，演 Contents API）+ 一个本地应用服务
# （临时 DATA_DIR，`SYNC_GITHUB_API_BASE` 指向桩），然后用真浏览器把「配置 → 测试连接 → 立即上传（dry_run
# 二次确认）→ 取消」点一遍，PC（1440×900 @DPR2）与移动（440×956 @DPR3）各来一次。
# ⛔ 全程不接触真实 GitHub、不使用真实 token（令牌是仓库级凭据，进代码/日志就等于泄漏）。
#
# 退出码：0 = 全绿；1 = 有断言不过；2 = 环境/资源前置不满足（没跑）。
set -u
set -o pipefail

cd "$(dirname "$0")/.." || exit 1

FAIL=0
AC_PW='ac-fixture-pw-20260924'
AC_USER='admin'
# 纯假令牌：只喂本地桩。
FAKE_TOKEN='github_pat_FAKE_local_stub_only_0001'
SHOT_DIR='tmp/shots/stage59-sync'
CLOUD_PATH='promptmanager/pm.json'
REPO='Hopetree/sync-data-test'

line() { printf '\n=== %s ===\n' "$1"; }
pass() { printf '  ✅ %s\n' "$1"; }
fail() { printf '  ❌ %s\n' "$1"; FAIL=1; }
eq() { if [ "$2" = "$3" ]; then pass "$1 = $3"; else fail "$1 = $3（期望 $2）"; fi; }
has() { case "$3" in *"$2"*) pass "$1（含「$2」）" ;; *) fail "$1 不含「$2」：$3" ;; esac; }

line '0. 资源与端口自检（熔断：available<800MB 或 load(1m)>20 直接停手）'
AV=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)
LD=$(awk '{print $1}' /proc/loadavg)
echo "MemAvailable=${AV}MB  load(1m)=${LD}"
if [ "${AV:-0}" -lt 800 ]; then echo '⛔ MemAvailable < 800MB：按资源纪律停手'; exit 2; fi
if awk -v l="$LD" 'BEGIN{exit !(l > 20)}'; then echo '⛔ load(1m) > 20：按资源纪律停手'; exit 2; fi
if [ ! -f dist/server/index.js ]; then echo '⛔ dist/server/index.js 不存在：请先 npm run build'; exit 2; fi

HTTP_PORT=''
for c in 8765 8766 8768 8769 8770; do
  # 8767 归 host_manger 的测试环境，**跳过不使用**。
  if ! ss -ltn | grep -q ":$c "; then HTTP_PORT="$c"; break; fi
done
if [ -z "$HTTP_PORT" ]; then echo '⛔ 8765–8770（8767 除外）没有空闲端口'; exit 2; fi
echo "选用 HTTP 端口：$HTTP_PORT"
echo '--- ss -ltn | grep 876x（原始输出）---'
ss -ltn | grep -E '876[0-9]' || echo '（876x 当前无监听）'

TMP=$(mktemp -d /tmp/pm-s59-sync-XXXXXX)
DIR="$TMP/data"
JAR="$TMP/cookies.txt"
SERVER_PID=''
STUB_PID=''

cleanup() {
  if [ -n "$SERVER_PID" ]; then kill "$SERVER_PID" 2>/dev/null; fi
  if [ -n "$STUB_PID" ]; then kill "$STUB_PID" 2>/dev/null; fi
  wait 2>/dev/null
  if [ "${KEEP_AC_DIR:-0}" = '1' ]; then echo "现场保留：$TMP"; else rm -rf "$TMP"; fi
}
trap cleanup EXIT

line '1. 起本地 GitHub 桩（Contents API，含 /__stats 与 /__mode 控制面）'
STUB_LOG="$TMP/stub.log"
STUB_TOKEN="$FAKE_TOKEN" node tools/ac-stage59-sync-stub.mjs >"$STUB_LOG" 2>&1 &
STUB_PID=$!
STUB_URL=''
for _i in $(seq 1 100); do
  STUB_URL=$(sed -n 's/^STUB_URL=//p' "$STUB_LOG" | head -1)
  if [ -n "$STUB_URL" ]; then break; fi
  sleep 0.1
done
if [ -z "$STUB_URL" ]; then
  echo '⛔ 桩没能启动：'
  cat "$STUB_LOG"
  exit 2
fi
echo "桩地址：$STUB_URL"
eq '桩初始请求数' 0 "$(curl -s "$STUB_URL/__stats" | jq -r '.requests')"

line '2. 起应用服务（临时 DATA_DIR、HOST=0.0.0.0、SYNC_GITHUB_API_BASE 指向桩）'
DATA_DIR="$DIR" node bin/pm.mjs migrate >/dev/null
printf '%s\n' "$AC_PW" | DATA_DIR="$DIR" node bin/pm.mjs user set-password --username "$AC_USER" >/dev/null
DATA_DIR="$DIR" PORT="$HTTP_PORT" HOST=0.0.0.0 SYNC_GITHUB_API_BASE="$STUB_URL" \
  node dist/server/index.js >"$TMP/server.log" 2>&1 &
SERVER_PID=$!
BASE="http://127.0.0.1:$HTTP_PORT"
CODE=''
for _i in $(seq 1 200); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/healthz" || true)
  if [ "$CODE" = '200' ]; then break; fi
  sleep 0.3
done
eq '应用服务 /healthz' 200 "${CODE:-000}"
if [ "${CODE:-000}" != '200' ]; then
  echo '--- server.log ---'
  cat "$TMP/server.log"
  exit 2
fi

line '3. 登录 + 造数据（1 prompt 中文 emoji / 1 文件夹 / 1 标签 —— 供确认框显示条数）'
curl -s -c "$JAR" -o /dev/null -X POST -H 'Content-Type: application/json' \
  -d "{\"username\":\"$AC_USER\",\"password\":\"$AC_PW\"}" "$BASE/api/login"
SID=$(awk '$6 == "pm_sid" { print $7 }' "$JAR" | tail -1)
if [ -n "$SID" ]; then pass "登录拿到 pm_sid（${SID:0:8}…）"; else fail '登录没拿到 pm_sid'; fi

FOLDER_ID=$(curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"name":"阶段59 目录"}' "$BASE/api/folders" | jq -r '.id // empty')
TAG_CODE=$(curl -s -o "$TMP/tag.json" -w '%{http_code}' -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"name":"发布"}' "$BASE/api/tags")
PROMPT_FOLDER='null'
if [ -n "$FOLDER_ID" ]; then PROMPT_FOLDER="$FOLDER_ID"; fi
PROMPT_CODE=$(curl -s -o "$TMP/prompt.json" -w '%{http_code}' -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"title\":\"阶段59 中文标题 🚀\",\"user_prompt\":\"中文 + emoji ✅ 往返\",\"system_prompt\":\"系统提示\",\"folder_id\":$PROMPT_FOLDER,\"tags\":[\"发布\"]}" \
  "$BASE/api/prompts")
if [ -n "$FOLDER_ID" ]; then pass "建文件夹 id=$FOLDER_ID"; else fail '建文件夹失败'; fi
eq '建标签 201' 201 "$TAG_CODE"
eq '建 prompt 201' 201 "$PROMPT_CODE"
eq '导出里 prompt 条数' 1 "$(curl -s -b "$JAR" "$BASE/api/export" | jq -r '.prompts | length')"
eq '导出里文件夹个数' 1 "$(curl -s -b "$JAR" "$BASE/api/export" | jq -r '.folders | length')"
eq '导出里标签个数' 1 "$(curl -s -b "$JAR" "$BASE/api/export" | jq -r '.tags | length')"

probe_asserts() { # probe_asserts <pc|mobile> <期望宽> <期望高> <期望DPR> <结果文本>
  local label="$1" w="$2" h="$3" dpr="$4" res="$5"
  local vp html hh dp
  vp=$(printf '%s\n' "$res" | sed -n 's/^VIEWPORT://p' | head -1)
  html=$(printf '%s' "$vp" | jq -r '.innerWidth')
  hh=$(printf '%s' "$vp" | jq -r '.innerHeight')
  dp=$(printf '%s' "$vp" | jq -r '.devicePixelRatio')
  eq "$label 视口 innerWidth（CSS px）" "$w" "$html"
  eq "$label 视口 innerHeight（CSS px）" "$h" "$hh"
  eq "$label devicePixelRatio" "$dpr" "$dp"
  eq "$label ⋯更多 里有「远程数据同步」" true "$(printf '%s\n' "$res" | sed -n 's/^MENU_SYNC://p' | head -1)"
  eq "$label 不点按钮 ⇒ 零出网（桩请求数不增）" true "$(printf '%s\n' "$res" | sed -n 's/^ZERO_OUTBOUND://p' | head -1)"
  eq "$label 打开弹窗只发了一条同步 API（读配置）" '["GET /api/sync/config"]' "$(printf '%s\n' "$res" | sed -n 's/^SYNC_API_CALLS://p' | head -1)"
  eq "$label 保存后界面显示解析后完整路径" true "$(printf '%s\n' "$res" | sed -n 's/^CONFIG_SAVED://p' | head -1)"
  eq "$label 解析后目标路径" "$REPO@main:$CLOUD_PATH" "$(printf '%s\n' "$res" | sed -n 's/^TARGET://p' | head -1)"
  eq "$label 测试连接（空仓库）阶段" no_file "$(printf '%s\n' "$res" | sed -n 's/^TEST_STAGE://p' | head -1)"
  has "$label 测试连接中文结果" '云端还没有' "$(printf '%s\n' "$res" | sed -n 's/^TEST_TEXT://p' | head -1)"
  has "$label 401 形态中文可执行提示" '令牌无效或已过期' "$(printf '%s\n' "$res" | sed -n 's/^TEST_ERROR_ZH://p' | head -1)"
  has "$label 上传确认框条数" '将推送 prompt 1 条 / 文件夹 1 个 / 标签 1 个' "$(printf '%s\n' "$res" | sed -n 's/^CONFIRM_TEXT://p' | head -1)"
  has "$label 上传确认框完整路径" "$REPO@main:$CLOUD_PATH" "$(printf '%s\n' "$res" | sed -n 's/^CONFIRM_TEXT://p' | head -1)"
  has "$label 上传确认框明示含正文全文" '包含提示词正文全文' "$(printf '%s\n' "$res" | sed -n 's/^CONFIRM_TEXT://p' | head -1)"
  eq "$label 取消后确认框关闭" true "$(printf '%s\n' "$res" | sed -n 's/^CONFIRM_CANCELLED://p' | head -1)"
  eq "$label dry_run 没写远端（桩 PUT 次数）" 0 "$(printf '%s\n' "$res" | sed -n 's/^DRYRUN_PUTS://p' | head -1)"
  eq "$label 页面级横向溢出" 0 "$(printf '%s\n' "$res" | sed -n 's/^OVERFLOW://p' | head -1)"
  local shot="$SHOT_DIR/$label-1-modal.png" shot2="$SHOT_DIR/$label-2-confirm.png"
  if [ -s "$shot" ] && [ -s "$shot2" ]; then pass "$label 截图两张都在（$shot / $shot2）"; else fail "$label 缺截图（$shot / $shot2）"; fi
}

line '4. 真浏览器实测（PC 1440×900 @DPR2）'
RES_PC=$(AC59_SHOT_DIR="$SHOT_DIR" node tools/ac-stage59-sync-probe.mjs "$BASE" "$SID" "$STUB_URL" pc "$FAKE_TOKEN" 2>&1)
printf '%s\n' "$RES_PC"
probe_asserts pc 1440 900 2 "$RES_PC"

line '5. 真浏览器实测（移动 440×956 @DPR3）'
RES_MB=$(AC59_SHOT_DIR="$SHOT_DIR" node tools/ac-stage59-sync-probe.mjs "$BASE" "$SID" "$STUB_URL" mobile "$FAKE_TOKEN" 2>&1)
printf '%s\n' "$RES_MB"
probe_asserts mobile 440 956 3 "$RES_MB"

line '6. 收尾：桩全程无写入（两次都只走 dry_run + 取消）'
eq '桩累计 PUT 次数' 0 "$(curl -s "$STUB_URL/__stats" | jq -r '.puts')"
eq '桩累计 commit 次数' 0 "$(curl -s "$STUB_URL/__stats" | jq -r '.commits | length')"

line '7. 端口复查（应用服务已随 trap 退出；8767 是 host_manger 的，全程没碰）'
ss -ltn | grep -E '876[0-9]' || echo '（876x 无监听）'

line '结果'
if [ "$FAIL" = '0' ]; then echo '✅ 全部通过'; else echo '❌ 有未通过项'; fi
exit "$FAIL"
