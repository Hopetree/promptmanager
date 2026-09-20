#!/usr/bin/env bash
# 阶段 7 验收自检：AC-25（MCP 端到端，**真实对端**）/ AC-26（形态与安全）+ FR-19 的 mcp 通道联动。
#
# ⚠️ AC-25 明确要求"真实对端"：本脚本用 **官方 Python MCP 客户端（mcp==1.30.0，LATEST_PROTOCOL_VERSION=2025-11-25）**
#    经 stdio 拉起 bin/pm-mcp.mjs，跑 initialize → tools/list → tools/call。
#    TS SDK 的自测（npm test 里的 tests/mcp-server.test.ts）**不作为 AC-25 的证据**。
#    若没有 Python 客户端，可用 MCP_PYTHON 指向你自己的解释器（需能 import mcp）。
#
# 用法：bash tools/ac-stage7.sh
set -u

cd "$(dirname "$0")/.." || exit 1
PORT=${PORT:-8767}
AC_PW='ac-fixture-pw-20260918'
BASE="http://127.0.0.1:$PORT"
MCP_PYTHON=${MCP_PYTHON:-.venv/bin/python}
MCP_NODE=${MCP_NODE:-$(command -v node)}

AC_DIR=''
JAR=''
SRV_LOG=''
SRV_PID=''
NODE_PID=''

line() { printf '\n=== %s ===\n' "$1"; }

new_fixture() {
  AC_DIR=$(mktemp -d /tmp/pm-ac7-XXXXXX)
  JAR=$AC_DIR/jar.txt
  SRV_LOG=$AC_DIR/server.log
  echo "\$ AC_DIR=\$(mktemp -d /tmp/pm-ac7-XXXXXX)   # $AC_DIR"
  printf '%s\n' "$AC_PW" | DATA_DIR="$AC_DIR" node bin/pm.mjs user set-password --username admin >/dev/null
  echo "  (CLI 建库并设口令 rc=$?)"
}

start_server() {
  DATA_DIR="$AC_DIR" PORT="$PORT" npm start >"$SRV_LOG" 2>&1 &
  SRV_PID=$!
  sleep 3
  NODE_PID=$(pgrep -P "$SRV_PID" 2>/dev/null | head -1)
  echo "\$ DATA_DIR=\$AC_DIR PORT=$PORT npm start &   (node pid=$NODE_PID)"
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

line "对端与协议版本核对（BRIEF §5 硬要求）"
if ! "$MCP_PYTHON" -c 'import mcp.types as t; from importlib.metadata import version; print("python mcp", version("mcp"), "｜LATEST_PROTOCOL_VERSION =", t.LATEST_PROTOCOL_VERSION)' 2>/dev/null; then
  echo "✗ 找不到可用的真实对端解释器：$MCP_PYTHON"
  echo "  请任选其一后重跑本脚本："
  echo "    uv venv --python 3.14 .venv && uv pip install --python .venv/bin/python mcp==1.30.0"
  echo "    MCP_PYTHON=/path/to/python bash tools/ac-stage7.sh   # 你自己的、能 import mcp 的解释器"
  exit 1
fi
"$MCP_PYTHON" -c 'import mcp.types as t; from importlib.metadata import version; print("  python mcp", version("mcp"), "｜LATEST_PROTOCOL_VERSION =", t.LATEST_PROTOCOL_VERSION)'

BASELINE_LISTEN=$(ss -ltn | grep -cE ':(876[5-9]|8770)\b')
echo "  验收前 8765-8770 监听数（基线）= $BASELINE_LISTEN"

########################################################################
line "AC-25 MCP 端到端（真实对端，自带夹具）"
new_fixture
start_server
curl -s -c "$JAR" -o /dev/null -w 'login=%{http_code}\n' -X POST -H 'Content-Type: application/json' -d "{\"username\":\"admin\",\"password\":\"$AC_PW\"}" "$BASE/api/login"
TOKEN=$(curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' -d '{"name":"mcp"}' "$BASE/api/tokens" | python3 -c "import json,sys;print(json.load(sys.stdin)['token'])")
PID=$(curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' -d '{"title":"MCP 会话交接","user_prompt":"你好 {{姓名}}，交给下一位 {{var-b}}","notes":"mcp 备注"}' "$BASE/api/prompts" | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")
curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' -d '{"title":"无关记录","user_prompt":"x"}' "$BASE/api/prompts" >/dev/null
echo "  prompt id=$PID ｜ token 已创建（明文不打印）"

echo "\$ PM_API_URL=$BASE PM_API_TOKEN=\$TOKEN MCP_NODE=$MCP_NODE $MCP_PYTHON tools/mcp-client-smoke.py '会话交接' $PID"
PM_API_URL="$BASE" PM_API_TOKEN="$TOKEN" MCP_NODE="$MCP_NODE" \
  "$MCP_PYTHON" tools/mcp-client-smoke.py '会话交接' "$PID" >"$AC_DIR/smoke.jsonl" 2>"$AC_DIR/smoke.err"
echo "  rc=$?（0 = 握手与三步调用都完成）"
echo "  --- 客户端 stderr（服务端诊断，不属于协议流）---"
sed 's/^/    /' "$AC_DIR/smoke.err"
echo "  --- 每步结果 ---"
python3 - "$AC_DIR" "$PID" <<'PY'
import json, sys
d, pid = sys.argv[1], int(sys.argv[2])
steps = [json.loads(line) for line in open(f'{d}/smoke.jsonl', encoding='utf-8') if line.strip()]
by = {step['step']: step for step in steps}
peer = by['peer']; init = by['initialize']; tools = by['tools/list']
search = json.loads(by['prompt_search']['text']); got = json.loads(by['prompt_get']['text']); render = json.loads(by['prompt_render']['text'])
print('  对端            :', peer['client'], peer['client_version'], '｜对端 LATEST =', peer['peer_latest_protocol_version'])
print('  协商 protocolVer:', init['protocolVersion'], '→', 'MATCH' if init['protocolVersion'] == '2025-11-25' else 'DIFF')
print('  serverInfo      :', init['serverName'], init['serverVersion'], '｜tools 能力 =', init['hasToolsCapability'])
print('  tools/list      :', tools['tools'], '→', 'MATCH' if tools['tools'] == ['prompt_get','prompt_render','prompt_search'] else 'DIFF')
print('  prompt_search   : isError=%s total=%s id=%s' % (by['prompt_search']['isError'], search['total'], [i['id'] for i in search['items']]))
print('  prompt_get      : isError=%s user_prompt=%s variables=%s' % (by['prompt_get']['isError'], json.dumps(got['user_prompt'], ensure_ascii=False), got['variables']))
print('  prompt_render   : isError=%s user_prompt=%s missing=%s' % (by['prompt_render']['isError'], json.dumps(render['user_prompt'], ensure_ascii=False), render['missing']))
PY

echo '  --- 与 HTTP API 逐字符对照（渲染结果）---'
curl -s -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d '{"values":{"姓名":"张三"}}' "$BASE/api/prompts/$PID/render" >"$AC_DIR/api-render.json"
python3 - "$AC_DIR" <<'PY'
import json, sys
d = sys.argv[1]
steps = [json.loads(line) for line in open(f'{d}/smoke.jsonl', encoding='utf-8') if line.strip()]
mcp_render = json.loads({s['step']: s for s in steps}['prompt_render']['text'])['user_prompt']
api_render = json.load(open(f'{d}/api-render.json', encoding='utf-8'))['user_prompt']
print('  MCP  :', json.dumps(mcp_render, ensure_ascii=False))
print('  API  :', json.dumps(api_render, ensure_ascii=False))
print('  逐字符一致：', 'MATCH' if mcp_render == api_render else 'DIFF')
PY

echo '  --- FR-19：经 MCP 的取用记入 usage（channel=mcp）---'
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/usage/summary?days=7" | python3 -c "
import json,sys
s = json.load(sys.stdin)
print('  by_channel =', s['by_channel'], '｜total =', s['total'])
print('  mcp 通道增长：', 'MATCH' if s['by_channel']['mcp'] >= 2 else 'DIFF', '（prompt_get + prompt_render 各一条）')
"
echo '  --- 副作用：MCP 取用不得改 updated_at / version_no ---'
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/prompts/$PID" >"$AC_DIR/after.json"
python3 - "$AC_DIR" <<'PY'
import json, sys
d = sys.argv[1]
after = json.load(open(f'{d}/after.json', encoding='utf-8'))
steps = [json.loads(line) for line in open(f'{d}/smoke.jsonl', encoding='utf-8') if line.strip()]
got = json.loads({s['step']: s for s in steps}['prompt_get']['text'])
print('  version_no：', got['version_no'], '→', after['version_no'], '：', 'SAME' if got['version_no'] == after['version_no'] else 'DIFF')
print('  updated_at：', got['updated_at'], '：', 'SAME' if got['updated_at'] == after['updated_at'] else 'DIFF')
PY

########################################################################
line "AC-26 MCP 形态与安全（同一夹具）"
echo '--- ① 不新增监听（口径：台账区间内除去服务自身的 PORT 后，监听数不得变化）'
RANGE_OTHERS=$(ss -ltn | grep -E ':(876[5-9]|8770)\b' | grep -vc ":$PORT ")
echo "  8765-8770（不含 $PORT）监听数 = $RANGE_OTHERS（基线 $BASELINE_LISTEN）"

echo '--- ② 工具面没有写操作工具（真实对端 list_tools 结果）'
python3 - "$AC_DIR" <<'PY'
import json, sys
d = sys.argv[1]
steps = [json.loads(line) for line in open(f'{d}/smoke.jsonl', encoding='utf-8') if line.strip()]
tools = {s['step']: s for s in steps}['tools/list']['tools']
hints = ['create','update','delete','remove','import','export','set','put','post','add','write','edit','rollback']
offenders = [t for t in tools if any(h in t.lower() for h in hints)]
print('  工具名 =', tools)
print('  写操作类工具 =', offenders, '→', 'MATCH' if not offenders else 'DIFF')
PY

echo '--- ③ 未设 PM_API_TOKEN 时调用工具 → 必须明确报错（不许静默返回空）'
PM_API_URL="$BASE" MCP_NODE="$MCP_NODE" "$MCP_PYTHON" tools/mcp-client-smoke.py '会话交接' "$PID" >"$AC_DIR/notoken.jsonl" 2>"$AC_DIR/notoken.err"
echo "  rc=$?（0 = 握手成功；工具返回 isError）"
python3 - "$AC_DIR" <<'PY'
import json, sys
d = sys.argv[1]
steps = {json.loads(l)['step']: json.loads(l) for l in open(f'{d}/notoken.jsonl', encoding='utf-8') if l.strip()}
init = steps['initialize']; search = steps['prompt_search']
print('  initialize 仍成功：', init['protocolVersion'], '｜list_tools =', steps['tools/list']['tools'])
print('  prompt_search isError =', search['isError'])
print('  错误文本（原样）:', json.dumps(search['text'], ensure_ascii=False))
print('  点名 PM_API_TOKEN：', 'MATCH' if 'PM_API_TOKEN' in search['text'] else 'DIFF')
print('  未静默返回空数组/对象：', 'MATCH' if search['text'].strip() not in ('[]', '{}') else 'DIFF')
PY

echo '--- ④ 停掉服务后调用工具 → 连接错误（证明经 API 而非直连 DB）'
stop_server
echo "  服务已停（数据库文件仍在：$AC_DIR/pm.db 若工具直连 DB 就会照常返回）"
PM_API_URL="$BASE" PM_API_TOKEN="$TOKEN" MCP_NODE="$MCP_NODE" "$MCP_PYTHON" tools/mcp-client-smoke.py '会话交接' "$PID" >"$AC_DIR/down.jsonl" 2>"$AC_DIR/down.err"
echo "  rc=$?（0 = 握手成功、工具返回连接错误）"
python3 - "$AC_DIR" "$BASE" <<'PY'
import json, sys
d, base = sys.argv[1], sys.argv[2]
steps = {json.loads(l)['step']: json.loads(l) for l in open(f'{d}/down.jsonl', encoding='utf-8') if l.strip()}
get = steps['prompt_get']
print('  prompt_get isError =', get['isError'])
print('  错误文本（原样）:', json.dumps(get['text'], ensure_ascii=False))
print('  含目标地址：', 'MATCH' if base in get['text'] else 'DIFF')
PY
end_fixture

line "收尾：端口与监听核对"
echo "\$ ss -ltn | grep -c ':$PORT'   # 期望 0"
ss -ltn | grep -c ":$PORT"
echo "\$ ss -ltn | grep -E ':(876[5-9]|8770)\b' | grep -vc ':$PORT '   # 期望与基线一致（$BASELINE_LISTEN）"
ss -ltn | grep -E ':(876[5-9]|8770)\b' | grep -vc ":$PORT "

echo
echo "阶段 7 自检结束；夹具目录已清理，端口 $PORT 已释放。"
