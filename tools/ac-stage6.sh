#!/usr/bin/env bash
# 阶段 6 验收自检：AC-22（API Token）/ AC-23（CORS）/ AC-24（使用侧 CLI）/ AC-27（使用记录）/ AC-28（内外网部署形态）。
#
# 与 BRIEF §8 的"统一夹具约定"一致：**每条 AC 自带夹具、互不依赖**（各自的临时 DATA_DIR +
# 自建口令 + 自起自停服务）。跑完不留常驻服务、不留临时数据、不触碰生产文件。
#
# 用法：bash tools/ac-stage6.sh
set -u

cd "$(dirname "$0")/.." || exit 1
PORT=${PORT:-8767}
AC_PW='ac-fixture-pw-20260918'
BASE="http://127.0.0.1:$PORT"

AC_DIR=''
JAR=''
SRV_LOG=''
SRV_PID=''
NODE_PID=''

line() { printf '\n=== %s ===\n' "$1"; }

new_fixture() {
  AC_DIR=$(mktemp -d /tmp/pm-ac6-XXXXXX)
  JAR=$AC_DIR/jar.txt
  SRV_LOG=$AC_DIR/server.log
  echo "\$ AC_DIR=\$(mktemp -d /tmp/pm-ac6-XXXXXX)   # $AC_DIR"
  printf '%s\n' "$AC_PW" | DATA_DIR="$AC_DIR" node bin/pm.mjs user set-password --username admin >/dev/null
  echo "  (CLI 建库并设口令 rc=$?)"
}

start_server() {
  local extra="${1:-}"
  # shellcheck disable=SC2086
  env DATA_DIR="$AC_DIR" PORT="$PORT" $extra npm start >"$SRV_LOG" 2>&1 &
  SRV_PID=$!
  sleep 3
  NODE_PID=$(pgrep -P "$SRV_PID" 2>/dev/null | head -1)
  echo "\$ ${extra:+$extra }DATA_DIR=\$AC_DIR PORT=$PORT npm start &   (node pid=$NODE_PID)"
  ss -ltn | grep ":$PORT"
}

stop_server() {
  if [ -n "$NODE_PID" ]; then kill "$NODE_PID" 2>/dev/null; fi
  if [ -n "$SRV_PID" ]; then kill "$SRV_PID" 2>/dev/null; fi
  sleep 1
  SRV_PID=''
  NODE_PID=''
}

end_fixture() {
  stop_server
  if [ -n "$AC_DIR" ]; then rm -rf "$AC_DIR"; fi
  AC_DIR=''
}

cleanup() {
  stop_server
  if [ -n "$AC_DIR" ]; then rm -rf "$AC_DIR"; fi
}
trap cleanup EXIT

login_cookie() {
  curl -s -c "$JAR" -o /dev/null -w 'login=%{http_code}\n' -X POST -H 'Content-Type: application/json' \
    -d "{\"username\":\"admin\",\"password\":\"$AC_PW\"}" "$BASE/api/login"
}

make_prompt() { # $1=json
  curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' -d "$1" "$BASE/api/prompts"
}

########################################################################
line "AC-22 API Token（自带夹具）"
new_fixture
start_server
login_cookie

echo "\$ TOKEN=\$(DATA_DIR=\$AC_DIR node bin/pm.mjs token create --name ac | tail -1)"
TOKEN=$(DATA_DIR="$AC_DIR" node bin/pm.mjs token create --name ac 2>"$AC_DIR/token-create.err" | tail -1)
echo "  明文：$(printf '%s' "$TOKEN" | sed -E 's/^(pm_.{6}).*(.{4})$/\1…\2/')   （下同只显示前后几位）"
echo "  形如 pm_… 的一行：$(printf '%s' "$TOKEN" | grep -cE '^pm_[A-Za-z0-9_-]{40,}$')"
echo "  CLI stderr（通道提示）：$(head -1 "$AC_DIR/token-create.err")"

echo "\$ python3 -c \"...select length(token_hash) from api_tokens...\""
python3 -c "
import sqlite3
conn = sqlite3.connect('$AC_DIR/pm.db')
print('  token_hash 长度 =', conn.execute('select length(token_hash) from api_tokens').fetchone()[0])
print('  行数 =', conn.execute('select count(*) from api_tokens').fetchone()[0])
"

echo "\$ curl -H 'Authorization: Bearer \$TOKEN' $BASE/api/prompts"
curl -s -o /dev/null -w '  Bearer 正确 → %{http_code}\n' -H "Authorization: Bearer $TOKEN" "$BASE/api/prompts"
curl -s -o /dev/null -w '  Bearer 错误 → %{http_code}\n' -H "Authorization: Bearer wrong-token" "$BASE/api/prompts"
curl -s -o /dev/null -w '  无凭据      → %{http_code}\n' "$BASE/api/prompts"
curl -s -o /dev/null -w '  伪造 cookie → %{http_code}\n' -H 'Cookie: pm_sid=forged' "$BASE/api/prompts"

echo "\$ DATA_DIR=\$AC_DIR node bin/pm.mjs token list"
DATA_DIR="$AC_DIR" node bin/pm.mjs token list 2>/dev/null | sed 's/^/  /'
echo "  列表里出现明文 token 的次数：$(DATA_DIR="$AC_DIR" node bin/pm.mjs token list 2>/dev/null | grep -c "$TOKEN")"

echo "\$ DATA_DIR=\$AC_DIR node bin/pm.mjs token revoke 1   # 撤销后立即失效"
DATA_DIR="$AC_DIR" node bin/pm.mjs token revoke 1 2>/dev/null | sed 's/^/  /'
curl -s -o /dev/null -w '  撤销后再用同一 token → %{http_code}\n' -H "Authorization: Bearer $TOKEN" "$BASE/api/prompts"

echo '--- cookie 通道不回归'
curl -s -b "$JAR" -o /dev/null -w '  带 cookie 访问 /api/prompts → %{http_code}\n' "$BASE/api/prompts"
echo '--- 明文不落服务日志'
echo "  grep -c \"\$TOKEN\" server.log → $(grep -c "$TOKEN" "$SRV_LOG")"
echo '--- 创建响应里才有明文（库里/列表里都没有）'
python3 -c "
import sqlite3
conn = sqlite3.connect('$AC_DIR/pm.db')
row = conn.execute('select token_hash, name from api_tokens').fetchone()
print('  token_hash 前 12 位 =', row[0][:12], '｜name =', row[1])
print('  库中是否含明文：', 'yes' if '$TOKEN' in row[0] else 'no')
"
end_fixture

########################################################################
line "AC-23 CORS（自带夹具）"
new_fixture
start_server
echo "\$ curl -D - -H 'Origin: https://evil.example' $BASE/healthz | grep -ci access-control-allow-origin"
curl -s -D - -o /dev/null -H 'Origin: https://evil.example' "$BASE/healthz" | grep -ci 'access-control-allow-origin' | sed 's/^/  未配置时命中数 = /'
stop_server

start_server "CORS_ORIGINS=https://prompt.home.local"
echo "\$ 配置 CORS_ORIGINS=https://prompt.home.local 后重启"
echo '--- 白名单内 origin（响应头原样）'
curl -s -D - -o /dev/null -H 'Origin: https://prompt.home.local' "$BASE/healthz" | grep -iE '^(HTTP/|access-control-)' | sed 's/^/  /'
echo '--- 白名单外 origin'
curl -s -D - -o /dev/null -H 'Origin: https://evil.example' "$BASE/healthz" | grep -ci 'access-control-allow-origin' | sed 's/^/  命中数 = /'
echo '--- 预检（OPTIONS + 声明 authorization）'
curl -s -D - -o /dev/null -X OPTIONS -H 'Origin: https://prompt.home.local' \
  -H 'Access-Control-Request-Method: GET' -H 'Access-Control-Request-Headers: authorization' \
  "$BASE/api/prompts" | grep -iE '^(HTTP/|access-control-)' | sed 's/^/  /'
echo '--- 任何响应都不得有 Allow-Credentials'
echo "  白名单内 GET    : $(curl -s -D - -o /dev/null -H 'Origin: https://prompt.home.local' "$BASE/healthz" | grep -ci 'access-control-allow-credentials')"
echo "  预检            : $(curl -s -D - -o /dev/null -X OPTIONS -H 'Origin: https://prompt.home.local' -H 'Access-Control-Request-Method: GET' "$BASE/api/prompts" | grep -ci 'access-control-allow-credentials')"
end_fixture

########################################################################
line "AC-24 使用侧 CLI（自带夹具）"
new_fixture
start_server
login_cookie
PID=$(make_prompt '{"title":"会话交接模板","user_prompt":"你好 {{姓名}}，交给下一位 {{var-b}}"}' | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")
make_prompt '{"title":"无关记录","user_prompt":"别的"}' >/dev/null
TOKEN=$(DATA_DIR="$AC_DIR" node bin/pm.mjs token create --name cli 2>/dev/null | tail -1)
echo "  prompt id=$PID ｜ CLI 用的 token 已创建"

echo "\$ PM_API_URL=$BASE PM_API_TOKEN=\$TOKEN node bin/pm.mjs get '会话交接' --json"
PM_API_URL="$BASE" PM_API_TOKEN="$TOKEN" node bin/pm.mjs get '会话交接' --json >"$AC_DIR/get.json" 2>"$AC_DIR/get.err"
echo "  rc=$? ｜ stderr=$(cat "$AC_DIR/get.err" | head -1)"
python3 -c "
import json
items = json.load(open('$AC_DIR/get.json'))
print('  是 JSON 数组：', isinstance(items, list), '｜条数 =', len(items), '｜标题 =', [i['title'] for i in items])
"

echo "\$ ... node bin/pm.mjs get --id $PID --json"
PM_API_URL="$BASE" PM_API_TOKEN="$TOKEN" node bin/pm.mjs get --id "$PID" --json >"$AC_DIR/get-one.json" 2>/dev/null
python3 -c "
import json
one = json.load(open('$AC_DIR/get-one.json'))
print('  单条 id =', one['id'], '｜user_prompt =', json.dumps(one['user_prompt'], ensure_ascii=False))
"

echo "\$ ... node bin/pm.mjs get --id 99999   # 期望退出码 1"
PM_API_URL="$BASE" PM_API_TOKEN="$TOKEN" node bin/pm.mjs get --id 99999 >/dev/null 2>"$AC_DIR/get-404.err"
echo "  rc=$? ｜ stderr=$(head -1 "$AC_DIR/get-404.err")"

echo "\$ ... node bin/pm.mjs render --id $PID --set 姓名=张三"
PM_API_URL="$BASE" PM_API_TOKEN="$TOKEN" node bin/pm.mjs render --id "$PID" --set 姓名=张三 >"$AC_DIR/render.txt" 2>/dev/null
curl -s -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  -d '{"values":{"姓名":"张三"}}' "$BASE/api/prompts/$PID/render" >"$AC_DIR/api-render.json"
python3 -c "
import json
cli = open('$AC_DIR/render.txt').read()
api = json.load(open('$AC_DIR/api-render.json'))['user_prompt']
print('  CLI stdout   =', json.dumps(cli, ensure_ascii=False))
print('  /api/render  =', json.dumps(api, ensure_ascii=False))
print('  逐字符一致：', 'MATCH' if cli == api else 'DIFF')
"

echo '--- 用法错误 → 退出码 2'
for args in "get" "get --id abc" "render" "render --id 1 --set bad"; do
  PM_API_URL="$BASE" PM_API_TOKEN="$TOKEN" node bin/pm.mjs $args >/dev/null 2>/dev/null
  printf '  pm %-28s rc=%s\n' "$args" "$?"
done
echo '--- 连不上必须报错（不得静默回退直连 DB）'
PM_API_URL="http://127.0.0.1:1" PM_API_TOKEN="$TOKEN" node bin/pm.mjs get '会话交接' >"$AC_DIR/dead.out" 2>"$AC_DIR/dead.err"
echo "  rc=$? ｜ stdout 字节数=$(wc -c <"$AC_DIR/dead.out") ｜ stderr=$(head -1 "$AC_DIR/dead.err")"
echo '--- 缺 PM_API_TOKEN 也必须报错（不许悄悄用本地库）'
PM_API_URL="$BASE" node bin/pm.mjs get '会话交接' >"$AC_DIR/notoken.out" 2>/dev/null
echo "  rc=$? ｜ stdout 字节数=$(wc -c <"$AC_DIR/notoken.out")"
end_fixture

########################################################################
line "AC-27 使用记录（自带夹具）"
new_fixture
start_server
login_cookie
TOKEN=$(curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' -d '{"name":"usage"}' "$BASE/api/tokens" | python3 -c "import json,sys;print(json.load(sys.stdin)['token'])")
PID=$(make_prompt '{"title":"使用记录夹具","user_prompt":"你好 {{姓名}}"}' | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")
make_prompt '{"title":"从未取用过","user_prompt":"nobody"}' >/dev/null

echo "\$ token 调 详情×2 + render×1"
for i in 1 2; do curl -s -o /dev/null -H "Authorization: Bearer $TOKEN" "$BASE/api/prompts/$PID"; done
curl -s -o /dev/null -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d '{"values":{"姓名":"张三"}}' "$BASE/api/prompts/$PID/render"
sum() { curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/usage/summary?days=7"; }
python3 -c "
import json
s = json.loads('''$(sum)''')
print('  by_channel =', s['by_channel'], '｜total =', s['total'])
print('  top[0] =', s['top'][0])
"

echo "\$ MCP 通道（X-PM-Channel: mcp，阶段 7 的 MCP server 用同一个头）"
curl -s -o /dev/null -H "Authorization: Bearer $TOKEN" -H 'X-PM-Channel: mcp' "$BASE/api/prompts/$PID"
python3 -c "
import json
s = json.loads('''$(sum)''')
print('  by_channel =', s['by_channel'], '｜total =', s['total'])
"

echo "\$ 浏览器 cookie 通道打开详情一次"
curl -s -o /dev/null -b "$JAR" "$BASE/api/prompts/$PID"
python3 -c "
import json
s = json.loads('''$(sum)''')
print('  by_channel =', s['by_channel'], '｜total =', s['total'])
"

echo '--- ④ 副作用断言：取用前后 version_no / updated_at 必须一致'
BEFORE=$(curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/prompts/$PID")
curl -s -o /dev/null -H "Authorization: Bearer $TOKEN" "$BASE/api/prompts/$PID"
curl -s -o /dev/null -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d '{"values":{}}' "$BASE/api/prompts/$PID/render"
AFTER=$(curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/prompts/$PID")
python3 -c "
import json
b = json.loads('''$BEFORE'''); a = json.loads('''$AFTER''')
print('  version_no：', b['version_no'], '→', a['version_no'], '：', 'SAME' if b['version_no'] == a['version_no'] else 'DIFF')
print('  updated_at：', b['updated_at'], '→', a['updated_at'], '：', 'SAME' if b['updated_at'] == a['updated_at'] else 'DIFF')
print('  use_count ：', b['use_count'], '→', a['use_count'])
"

echo '--- ⑤ ?sort=recent_used：用过的在前、从未用过的排最后'
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/prompts?sort=recent_used" | python3 -c "
import json,sys
items = json.load(sys.stdin)['items']
print('  recent_used 顺序 =', [(i['title'], i['use_count']) for i in items])
"
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/prompts" | python3 -c "
import json,sys
items = json.load(sys.stdin)['items']
print('  默认（updated_at）顺序 =', [i['title'] for i in items])
"

echo '--- ⑥ usage 不参与导出：往返仍 EQUAL'
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/export" >"$AC_DIR/a.json"
python3 -c "
import json
a = json.load(open('$AC_DIR/a.json'))
print('  导出是否含 usage 字段：', any(k in json.dumps(a) for k in ('use_count', 'last_used_at')))
json.dump({'mode': 'replace', 'data': a}, open('$AC_DIR/import.json', 'w'), ensure_ascii=False)
"
curl -s -o /dev/null -H "Authorization: Bearer $TOKEN" -X POST -H 'Content-Type: application/json' -d @"$AC_DIR/import.json" "$BASE/api/import"
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/export" >"$AC_DIR/b.json"
python3 -c "
import json
a = json.load(open('$AC_DIR/a.json')); b = json.load(open('$AC_DIR/b.json'))
a.pop('exported_at'); b.pop('exported_at')
print('  导出→导入(replace)→再导出：', 'EQUAL' if a == b else 'DIFF')
"
python3 -c "
import json
s = json.loads('''$(sum)''')
print('  replace 导入后 total（旧 usage 随 prompt 级联删除）=', s['total'])
"
end_fixture

########################################################################
line "AC-28 内外网部署形态（自带夹具；① / ② / ③ 各自独立夹具，避免限流封锁互相污染）"
BASELINE_LISTEN=$(ss -ltn | grep -cE ':(876[5-9]|8770)\b')
echo "  验收前 8765-8770 监听数（基线）= $BASELINE_LISTEN"

echo '--- ① 未设 TRUST_PROXY（默认）：6 次错误登录、每次换一个 X-Forwarded-For'
new_fixture
start_server
for i in 1 2 3 4 5; do
  printf '  XFF 203.0.113.%s → %s\n' "$i" "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H "X-Forwarded-For: 203.0.113.$i" -d '{"username":"admin","password":"wrong"}' "$BASE/api/login")"
done
printf '  第 6 次（再换 XFF） → %s（期望 429：XFF 不得绕过限流）\n' "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H 'X-Forwarded-For: 203.0.113.99' -d '{"username":"admin","password":"wrong"}' "$BASE/api/login")"
end_fixture

echo '--- ② TRUST_PROXY=1：X-Forwarded-For 成为真实来源（出现在服务日志里）'
new_fixture
: >"$SRV_LOG" 2>/dev/null || true
start_server "TRUST_PROXY=1"
curl -s -o /dev/null -X POST -H 'Content-Type: application/json' -H 'X-Forwarded-For: 203.0.113.9' -d '{"username":"admin","password":"wrong"}' "$BASE/api/login"
echo "  grep -c '203.0.113.9' server.log → $(grep -c '203.0.113.9' "$SRV_LOG")（期望 >= 1）"
grep -o '"remoteAddress":"203.0.113.9"' "$SRV_LOG" | head -1 | sed 's/^/  日志片段：/'
end_fixture

echo '--- ③ PUBLIC_ORIGIN 控制 cookie 的 Secure（两种形态各自独立夹具）'
new_fixture
start_server
echo '  未设 PUBLIC_ORIGIN：'
curl -s -D - -o /dev/null -X POST -H 'Content-Type: application/json' -d "{\"username\":\"admin\",\"password\":\"$AC_PW\"}" "$BASE/api/login" | grep -i '^set-cookie' | sed 's/^/    /'
echo "    Secure 出现次数 = $(curl -s -D - -o /dev/null -X POST -H 'Content-Type: application/json' -d "{\"username\":\"admin\",\"password\":\"$AC_PW\"}" "$BASE/api/login" | grep -ciE ';[[:space:]]*Secure')（期望 0）"
end_fixture

new_fixture
start_server "PUBLIC_ORIGIN=https://prompt.example.com"
echo '  设 PUBLIC_ORIGIN=https://prompt.example.com：'
curl -s -D - -o /dev/null -X POST -H 'Content-Type: application/json' -d "{\"username\":\"admin\",\"password\":\"$AC_PW\"}" "$BASE/api/login" | grep -i '^set-cookie' | sed 's/^/    /'
echo "    Secure 出现次数 = $(curl -s -D - -o /dev/null -X POST -H 'Content-Type: application/json' -d "{\"username\":\"admin\",\"password\":\"$AC_PW\"}" "$BASE/api/login" | grep -ciE ';[[:space:]]*Secure')（期望 1）"
end_fixture

echo '--- ④ 反代样例（占位符、含 XFF/HTTPS、不含真实域名与证书路径）'
grep -nE 'X-Forwarded-For|X-Forwarded-Proto|ssl_certificate|listen +443' deploy/reverse-proxy.example.conf | sed 's/^/  /'
echo "  真实域名/证书路径命中数 = $(grep -cE 'prompt\.example\.com|/etc/letsencrypt' deploy/reverse-proxy.example.conf)（期望 0）"
echo '--- ⑤ 部署文档覆盖两种形态'
echo "  grep -cE '内网|公网|反代|回滚' deploy/README.md = $(grep -cE '内网|公网|反代|回滚' deploy/README.md)（期望 >= 4）"
echo "  三个开关在 env.example 中：$(grep -cE '^(CORS_ORIGINS|TRUST_PROXY|PUBLIC_ORIGIN)=' deploy/promptmanager.env.example)/3"
echo '--- ⑥ 不新增监听、默认监听地址未变'
echo "  8765-8770 监听：$(ss -ltn | grep -cE ':(876[5-9]|8770)\b')（基线 $BASELINE_LISTEN，两者应相等）"
echo "  配置默认：$(node -e "import('./dist/config.js').then(m=>{const c=m.loadConfig({});console.log('HOST='+c.host+' PORT='+c.port+' TRUST_PROXY='+c.trustProxy+' PUBLIC_ORIGIN='+String(c.publicOrigin))})")"

line "收尾：停服并核验端口已释放"
echo "\$ ss -ltn | grep -c ':$PORT'   # 期望 0"
ss -ltn | grep -c ":$PORT"

echo
echo "阶段 6 自检结束；夹具目录已清理，端口 $PORT 已释放。"
