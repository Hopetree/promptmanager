#!/usr/bin/env bash
# 阶段 53 · AC-118 A 段（FR-117 / R-9）：「关于」页「访问地址」双场景实测。
#
#   A① HTTPS 下正确：以 HTTPS 访问时显示 https://…，复制到的内容也是 https://…
#   A② HTTP 下不回归：以 HTTP 访问时仍显示 http://…
#   A③ 不含硬编码协议：贴取值代码 + 改前改后对比 + 无新增网络请求
#   A④ 关于弹窗其它信息不变（版本/状态/数据文件/备份/使用区/维护区）
#
# 关键做法：应用只提供 HTTP，生产前面有 HTTPS 反代 ⇒ 这里用**一次性自签证书 + Node 内置 https**
# 起一个**测试用**反代（tools/ac-stage53-https-proxy.mjs），让浏览器**真的**从 https:// 加载，
# 这样 window.location.origin 才如实反映用户实际访问的协议（不靠"假装"）。浏览器侧接受自签证书。
# 全程临时 DATA_DIR + 8765–8770 内备用端口；不碰 8767 测试环境、不碰生产。
#
# 用法：bash tools/ac-stage53-about.sh
set -u
set -o pipefail

cd "$(dirname "$0")/.." || exit 1
FAIL=0
AC_PW='ac-fixture-pw-20260924'
AC_USER='admin'

line() { printf '\n=== %s ===\n' "$1"; }
pass() { printf '  ✅ %s\n' "$1"; }
fail() { printf '  ❌ %s\n' "$1"; FAIL=1; }
eq() { if [ "$2" = "$3" ]; then pass "$1 = $3"; else fail "$1 = $3（期望 $2）"; fi; }

free_ports() {
  # 从台账 8765–8770 里挑两个空闲端口（一个给后端 HTTP，一个给 HTTPS 反代）
  local found='' c
  for c in 8765 8766 8767 8768 8769 8770; do
    if ! ss -ltn | grep -q ":$c "; then found="$found $c"; fi
  done
  echo "$found"
}
PORTS=$(free_ports)
HTTP_PORT=$(echo "$PORTS" | awk '{print $1}')
HTTPS_PORT=$(echo "$PORTS" | awk '{print $2}')
if [ -z "$HTTP_PORT" ] || [ -z "$HTTPS_PORT" ]; then
  echo "FAIL 8765–8770 里凑不齐两个空闲端口（写 QUESTIONS 停手）"; exit 1
fi
echo "  端口：后端 HTTP=$HTTP_PORT ｜ HTTPS 反代=$HTTPS_PORT"
BASE_HTTP="http://127.0.0.1:$HTTP_PORT"
BASE_HTTPS="https://127.0.0.1:$HTTPS_PORT"

DIR=$(mktemp -d /tmp/pm-s53-about-XXXXXX)
DB="$DIR/pm.db"
SRV_PID=''
PROXY_PID=''
cleanup() {
  # 结束时 kill 掉自己起的反代/后端属于预期，bash 会打一行 "Killed" 的作业通知；
  # 把它静音，免得混进验收输出里让人误以为出了故障。
  { [ -n "$PROXY_PID" ] && kill -9 "$PROXY_PID" 2>/dev/null; } 2>/dev/null
  if [ -n "$SRV_PID" ]; then kill "$SRV_PID" 2>/dev/null; for _ in $(seq 1 10); do kill -0 "$SRV_PID" 2>/dev/null || break; sleep 0.3; done; kill -9 "$SRV_PID" 2>/dev/null; fi
  [ -n "$DIR" ] && [ "${KEEP_AC_DIR:-0}" != "1" ] && rm -rf "$DIR"
  wait 2>/dev/null
  return 0
}
trap cleanup EXIT

line "启动：临时后端（HTTP:$HTTP_PORT）+ 一次性自签证书的 HTTPS 反代（:$HTTPS_PORT）"
printf '%s\n' "$AC_PW" | DATA_DIR="$DIR" node bin/pm.mjs user set-password --username "$AC_USER" >/dev/null
DATA_DIR="$DIR" PORT="$HTTP_PORT" node dist/server/index.js >"$DIR/server.log" 2>&1 &
SRV_PID=$!
CODE=''
for _ in $(seq 1 60); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_HTTP/healthz" 2>/dev/null || true)
  [ "$CODE" = "200" ] && break
  sleep 0.3
done
[ "$CODE" = "200" ] || { fail "后端未起来（$DIR/server.log）"; exit 1; }

# 一次性自签证书（只在本机 tmp 下，测完即删，不入库）
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$DIR/key.pem" -out "$DIR/cert.pem" \
  -days 2 -subj "/CN=127.0.0.1" -addext "subjectAltName=IP:127.0.0.1,DNS:localhost" >"$DIR/openssl.log" 2>&1
eq "自签证书生成" 0 "$?"
node tools/ac-stage53-https-proxy.mjs "$HTTPS_PORT" "$HTTP_PORT" "$DIR/cert.pem" "$DIR/key.pem" >"$DIR/proxy.log" 2>&1 &
PROXY_PID=$!
READY=''
for _ in $(seq 1 40); do
  if grep -q HTTPS_PROXY_READY "$DIR/proxy.log" 2>/dev/null; then READY=1; break; fi
  sleep 0.2
done
[ -n "$READY" ] || { fail "HTTPS 反代未起来（$DIR/proxy.log）"; exit 1; }
pass "HTTPS 反代就绪：$BASE_HTTPS → $BASE_HTTP"

# 登录拿到会话 cookie（对 HTTPS 侧也要能登录；同源反代会把 cookie 带到后端）
JAR_HTTP="$DIR/jar-http.txt"
curl -s -c "$JAR_HTTP" -o /dev/null -X POST -H 'Content-Type: application/json' \
  -d "{\"username\":\"$AC_USER\",\"password\":\"$AC_PW\"}" "$BASE_HTTP/api/login"
SID=$(awk '$6 == "pm_sid" { print $7 }' "$JAR_HTTP" | tail -1)
[ -n "$SID" ] && pass "登录拿到会话（HTTP 侧）" || { fail "登录失败"; exit 1; }

line "A③  取值代码：不写死协议（改前 → 改后）"
echo "  改前（HEAD）：$(git show HEAD:web/src/components/AboutModal.tsx | grep -n 'const address =')"
echo "  改后（现在）：$(grep -n 'const address =' web/src/components/AboutModal.tsx)"
eq "改后取值用 window.location.origin" 1 "$(grep -c 'const address = .*window\.location\.origin' web/src/components/AboutModal.tsx || true)"
eq "改后取值行不再硬编码 http://" 0 "$(grep -n 'const address =' web/src/components/AboutModal.tsx | grep -c 'http://' || true)"
eq "改后取值行也不写死 https://" 0 "$(grep -n 'const address =' web/src/components/AboutModal.tsx | grep -c 'https://' || true)"
echo "  取值代码（原样）："
grep -n 'const address = .*window.location.origin' web/src/components/AboutModal.tsx | sed 's/^/    /'
eq "关于页只保留原有 /healthz 一次请求（未为拿地址新增）" 1 "$(grep -c "fetch('/healthz'" web/src/components/AboutModal.tsx || true)"

line "A②  HTTP 场景：仍显示 http://…（内网直连）"
OUT_HTTP=$(node tools/ac-stage53-about-probe.mjs "$BASE_HTTP" "$SID" 2>&1)
printf '%s\n' "$OUT_HTTP" | sed 's/^/    /'
H_ORIGIN=$(printf '%s' "$OUT_HTTP" | grep '^LOCATION_ORIGIN:' | cut -d: -f2-)
H_ADDR=$(printf '%s' "$OUT_HTTP" | grep '^ABOUT_ADDRESS:' | cut -d: -f2-)
H_COPIED=$(printf '%s' "$OUT_HTTP" | grep '^COPIED:' | cut -d: -f2-)
H_REQS=$(printf '%s' "$OUT_HTTP" | grep '^REQS:' | cut -d: -f2-)
eq "A② HTTP 场景浏览器 origin 是 http://" "http://127.0.0.1:$HTTP_PORT" "$H_ORIGIN"
eq "A② HTTP 场景「访问地址」显示 http://…（带主机与端口）" "http://127.0.0.1:$HTTP_PORT" "$H_ADDR"
eq "A② HTTP 场景复制内容也是同一个 http:// 地址" "true" "$(printf '%s' "$H_COPIED" | jq -r --arg a "$H_ADDR" 'any(.[]; . == $a)')"
eq "A③ 打开关于弹窗只发 /healthz（无新增请求）" 1 "$(printf '%s' "$H_REQS" | jq 'length')"
eq "A③ 那唯一一次请求是 GET /healthz" 1 "$(printf '%s' "$H_REQS" | jq -r '[.[] | select(. == "GET /healthz")] | length')"

line "A①  HTTPS 场景：显示 https://…，复制也是 https://…（反向代理）"
OUT_HTTPS=$(node tools/ac-stage53-about-probe.mjs "$BASE_HTTPS" "$SID" 2>&1)
printf '%s\n' "$OUT_HTTPS" | sed 's/^/    /'
S_ORIGIN=$(printf '%s' "$OUT_HTTPS" | grep '^LOCATION_ORIGIN:' | cut -d: -f2-)
S_PROTO=$(printf '%s' "$OUT_HTTPS" | grep '^LOCATION_PROTO:' | cut -d: -f2-)
S_ADDR=$(printf '%s' "$OUT_HTTPS" | grep '^ABOUT_ADDRESS:' | cut -d: -f2-)
S_COPIED=$(printf '%s' "$OUT_HTTPS" | grep '^COPIED:' | cut -d: -f2-)
S_REQS=$(printf '%s' "$OUT_HTTPS" | grep '^REQS:' | cut -d: -f2-)
eq "A① HTTPS 场景浏览器 origin 是 https://（真 TLS，不是假装）" "https://127.0.0.1:$HTTPS_PORT" "$S_ORIGIN"
eq "A① HTTPS 场景协议是 https:" "https:" "$S_PROTO"
eq "A① HTTPS 场景「访问地址」显示 https://…（R-9 修好了）" "https://127.0.0.1:$HTTPS_PORT" "$S_ADDR"
eq "A① HTTPS 场景复制到的内容同为 https://…（显示=复制）" "true" "$(printf '%s' "$S_COPIED" | jq -r --arg a "$S_ADDR" 'any(.[]; . == $a)')"
eq "A③ HTTPS 侧打开关于也只发 /healthz（无新增请求）" 1 "$(printf '%s' "$S_REQS" | jq 'length')"
echo "  >>> 关键对照：同一个页面，HTTP 侧显示 [$(basename "$H_ADDR")]，HTTPS 侧显示 [$(basename "$S_ADDR")] —— 随实际访问协议变化 ✅"

line "A④  「关于」弹窗其它信息不变（两个场景都核）"
for tag in HTTP HTTPS; do
  if [ "$tag" = HTTP ]; then OTH=$(printf '%s' "$OUT_HTTP" | grep '^ABOUT_OTHERS:' | cut -d: -f2-); else OTH=$(printf '%s' "$OUT_HTTPS" | grep '^ABOUT_OTHERS:' | cut -d: -f2-); fi
  echo "  --- $tag ---"
  echo "  \$ $(printf '%s' "$OTH" | jq -c '.rows')"
  echo "  \$ 版本区文字：$(printf '%s' "$OTH" | jq -r '.versionText')"
  echo "  \$ 分区：$(printf '%s' "$OTH" | jq -c '.panels')"
  echo "  \$ 使用区条数：$(printf '%s' "$OTH" | jq -r '.usageLines')"
  echo "  \$ 维护区命令：$(printf '%s' "$OTH" | jq -c '.maintCommands')"
  eq "A④ [$tag] 服务区 5 行（版本/状态/访问地址/数据文件/备份方式）" 5 "$(printf '%s' "$OTH" | jq '.rows | length')"
  eq "A④ [$tag] 状态徽标仍是「后端在线」" "后端在线" "$(printf '%s' "$OTH" | jq -r '.statusTag')"
  eq "A④ [$tag] 三个分区（服务/使用/维护）都在" 3 "$(printf '%s' "$OTH" | jq '.panels | length')"
  eq "A④ [$tag] 使用区仍是 7 条说明" 7 "$(printf '%s' "$OTH" | jq -r '.usageLines')"
  eq "A④ [$tag] 维护区仍是 5 条命令" 5 "$(printf '%s' "$OTH" | jq -r '.maintCommands | length')"
  eq "A④ [$tag] 品牌图仍在" "true" "$(printf '%s' "$OTH" | jq -r '.hasBrandArt')"
  VEXP=$(printf '%s' "$OTH" | jq -r '.versionText' | grep -o '版本 [0-9.]*' | awk '{print $2}')
  eq "A④ [$tag] 版本号与 /healthz 一致" "$(curl -s "$BASE_HTTP/healthz" | jq -r .version)" "$VEXP"
done

line "A 段结论"
if [ "$FAIL" = "0" ]; then echo "  ✅ AC-118 A①–④（FR-117）全部通过：HTTP 与 HTTPS 都显示各自实际协议，复制一致，无新增请求，其它信息不变"; else echo "  ❌ 有判据未通过（见上方 ❌）"; fi
exit "$FAIL"
