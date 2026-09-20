#!/usr/bin/env bash
# 阶段 2 验收自检：AC-3（未认证一律拒绝）/ AC-4（登录·会话·限流）/ AC-15（重启数据持久）
# + CLI `user set-password` / `migrate` 契约（BRIEF §6.2）。
#
# 与 BRIEF §8 的"统一夹具约定"一致：**每条 AC 自带夹具、互不依赖**（各自的临时 DATA_DIR +
# 自建口令 + 自起自停服务），因此 AC-4 的限流封锁不会影响 AC-15。
# 跑完不留常驻服务、不留临时数据、不触碰生产文件。
#
# 用法：bash tools/ac-stage2.sh
set -u

cd "$(dirname "$0")/.." || exit 1
PORT=${PORT:-8767}
AC_PW='ac-fixture-pw-20260918'
BASE="http://127.0.0.1:$PORT"

AC_DIR=''
JAR=''
HDR=''
SRV_LOG=''
SRV_PID=''
NODE_PID=''

line() { printf '\n=== %s ===\n' "$1"; }

new_fixture() {
  AC_DIR=$(mktemp -d /tmp/pm-ac2-XXXXXX)
  JAR=$AC_DIR/jar.txt
  HDR=$AC_DIR/headers.txt
  SRV_LOG=$AC_DIR/server.log
  echo "\$ AC_DIR=\$(mktemp -d /tmp/pm-ac2-XXXXXX)   # $AC_DIR"
  echo "\$ printf '%s\\n' \"\$AC_PW\" | DATA_DIR=\$AC_DIR node bin/pm.mjs user set-password --username admin"
  printf '%s\n' "$AC_PW" | DATA_DIR="$AC_DIR" node bin/pm.mjs user set-password --username admin
  echo "rc=$?"
}

end_fixture() {
  stop_server
  if [ -n "$AC_DIR" ]; then rm -rf "$AC_DIR"; fi
  AC_DIR=''
}

start_server() {
  DATA_DIR="$AC_DIR" PORT="$PORT" npm start >"$SRV_LOG" 2>&1 &
  SRV_PID=$!
  sleep 3
  NODE_PID=$(pgrep -P "$SRV_PID" 2>/dev/null | head -1)
  echo "\$ DATA_DIR=\$AC_DIR PORT=$PORT npm start &   (node pid=$NODE_PID)"
  echo "\$ ss -ltn | grep ':$PORT'"
  ss -ltn | grep ":$PORT"
}

stop_server() {
  if [ -n "$NODE_PID" ]; then kill "$NODE_PID" 2>/dev/null; fi
  if [ -n "$SRV_PID" ]; then kill "$SRV_PID" 2>/dev/null; fi
  sleep 1
  SRV_PID=''
  NODE_PID=''
}

cleanup() {
  stop_server
  if [ -n "$AC_DIR" ]; then rm -rf "$AC_DIR"; fi
}
trap cleanup EXIT

########################################################################
line "AC-3 未认证一律拒绝（自带夹具）"
new_fixture
start_server
echo "\$ curl -s -o /dev/null -w '%{http_code} ' $BASE/api/prompts"
curl -s -o /dev/null -w '%{http_code} ' "$BASE/api/prompts"
echo "\$ curl -s -o /dev/null -w '%{http_code} ' -X POST -H 'Content-Type: application/json' -d '{}' $BASE/api/prompts"
curl -s -o /dev/null -w '%{http_code} ' -X POST -H 'Content-Type: application/json' -d '{}' "$BASE/api/prompts"
echo "\$ curl -s -o /dev/null -w '%{http_code}\n' $BASE/api/export"
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/api/export"
echo "--- 401 body 形状（GET /api/prompts）"
curl -s "$BASE/api/prompts"
echo
echo "--- /healthz 仍无需认证"
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/healthz"
curl -s "$BASE/healthz"
echo
end_fixture

########################################################################
line "AC-4 登录 / 会话 / 限流（自带夹具）"
new_fixture
start_server
echo "\$ curl -s -c \$JAR -D \$HDR -o /dev/null -w '%{http_code} ' -X POST -H 'Content-Type: application/json' -d '{\"username\":\"admin\",\"password\":\"\$AC_PW\"}' $BASE/api/login"
curl -s -c "$JAR" -D "$HDR" -o /dev/null -w '%{http_code} ' -X POST -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$AC_PW\"}" "$BASE/api/login"
echo "  ← 期望 200"
echo "--- 响应头 Set-Cookie（原样）"
grep -i '^set-cookie' "$HDR"
echo "\$ curl -s -b \$JAR -o /dev/null -w '%{http_code}\n' $BASE/api/prompts"
curl -s -b "$JAR" -o /dev/null -w '%{http_code}\n' "$BASE/api/prompts"
echo "--- GET /api/me"
curl -s -b "$JAR" "$BASE/api/me"
echo
echo "--- 错误口令 #1 → 401"
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"wrong-password-1"}' "$BASE/api/login"
echo "--- 夹具：错误 #2..#6（共 5 次失败后，第 6 次应 429）"
for i in 2 3 4 5 6; do
  printf '错误 #%s → ' "$i"
  curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' \
    -d "{\"username\":\"admin\",\"password\":\"wrong-password-$i\"}" "$BASE/api/login"
done
echo "--- 第 6 次（429）的响应头与 body（原样）"
curl -s -D - -o "$AC_DIR/429.json" -X POST -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"wrong-password-7"}' "$BASE/api/login" | grep -iE '^(HTTP/|retry-after)'
cat "$AC_DIR/429.json"
echo
echo "--- 封锁期内即使口令正确也 429（AC-4 的最直接读法：第 6 次一律 429）"
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$AC_PW\"}" "$BASE/api/login"
echo "--- 登出（用封锁前拿到的会话）→ 204，旧 cookie 立即失效"
echo "\$ curl -s -b \$JAR -o /dev/null -w '%{http_code}\n' -X POST $BASE/api/logout"
curl -s -b "$JAR" -o /dev/null -w '%{http_code}\n' -X POST "$BASE/api/logout"
echo "\$ curl -s -b \$JAR -o /dev/null -w '%{http_code}\n' $BASE/api/me   # 旧 cookie"
curl -s -b "$JAR" -o /dev/null -w '%{http_code}\n' "$BASE/api/me"
end_fixture

########################################################################
line "AC-15 重启数据持久（自带夹具，与 AC-4 的限流状态无关）"
new_fixture
start_server
curl -s -c "$JAR" -o /dev/null -w 'login http_code=%{http_code}\n' -X POST -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$AC_PW\"}" "$BASE/api/login"

cat >"$AC_DIR/create.json" <<'JSON'
{"title":"重启持久性","user_prompt":"会话交接 ✅ \"引号\" {{变量}}\n第二行\t制表符","system_prompt":"sys-正文","notes":"notes-正文","tags":["交接"]}
JSON
echo "\$ curl -s -b \$JAR -X POST -H 'Content-Type: application/json' -d @create.json $BASE/api/prompts"
curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' -d @"$AC_DIR/create.json" "$BASE/api/prompts" >"$AC_DIR/created.json"
cat "$AC_DIR/created.json"
echo
curl -s -b "$JAR" "$BASE/api/prompts" >"$AC_DIR/list-before.json"

echo "--- 停服（模拟 kill）"
stop_server
echo "\$ ss -ltn | grep -c ':$PORT'   # 期望 0"
ss -ltn | grep -c ":$PORT"

echo "--- 用同一 DATA_DIR 重启"
start_server
echo "\$ curl -s -b \$JAR $BASE/api/prompts   # 同一 cookie，未重新登录"
curl -s -b "$JAR" "$BASE/api/prompts" >"$AC_DIR/list-after.json"
python3 - "$AC_DIR" <<'PY'
import json, sys
d = sys.argv[1]
before = json.load(open(f'{d}/list-before.json'))
after = json.load(open(f'{d}/list-after.json'))
created = json.load(open(f'{d}/created.json'))
pid = created['id']
a = next(i for i in before['items'] if i['id'] == pid)
b = next(i for i in after['items'] if i['id'] == pid)
print('重启前 total =', before['total'], '｜重启后 total =', after['total'])
print('重启后仍能查到 id =', pid)
print('整条记录逐字段一致：', 'MATCH' if a == b else 'DIFF')
print('user_prompt 逐字符一致：', 'MATCH' if a['user_prompt'] == b['user_prompt'] else 'DIFF')
print('user_prompt 原样（重启后）：', json.dumps(b['user_prompt'], ensure_ascii=False))
print('version_no =', b['version_no'], '｜tags =', b['tags'])
PY
echo "\$ ls -l \$AC_DIR/pm.db"
ls -l "$AC_DIR/pm.db"
ls -l "$AC_DIR"/pm.db-wal 2>/dev/null || echo "(pm.db-wal 已合并，属正常)"

line "CLI 契约（BRIEF §6.2）：输出文案 / 退出码 / 绝不回显口令"
echo '$ printf ... | node bin/pm.mjs user set-password --username admin'
OUT=$(printf '%s\n' "$AC_PW" | DATA_DIR="$AC_DIR" node bin/pm.mjs user set-password --username admin 2>&1)
RC=$?
echo "stdout: $OUT"
echo "rc=$RC"
echo "\$ ... | grep -c \"\$AC_PW\"   # 期望 0"
printf '%s\n' "$OUT" | grep -c "$AC_PW"
echo '$ node bin/pm.mjs user set-password   # 缺 --username'
DATA_DIR="$AC_DIR" node bin/pm.mjs user set-password </dev/null >/dev/null 2>"$AC_DIR/e1"
echo "rc=$?  stderr=$(head -1 "$AC_DIR/e1")"
echo '$ node bin/pm.mjs user set-password --username admin   # 空口令'
DATA_DIR="$AC_DIR" node bin/pm.mjs user set-password --username admin </dev/null >/dev/null 2>"$AC_DIR/e2"
echo "rc=$?  stderr=$(head -1 "$AC_DIR/e2")"
echo '$ node bin/pm.mjs migrate   # 幂等（第二次）'
DATA_DIR="$AC_DIR" node bin/pm.mjs migrate
echo "rc=$?"

line "收尾：停服并核验端口已释放"
end_fixture
echo "\$ ss -ltn | grep -c ':$PORT'   # 期望 0"
ss -ltn | grep -c ":$PORT"

echo
echo "阶段 2 自检结束；夹具目录已清理，端口 $PORT 已释放。"
