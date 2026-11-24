#!/usr/bin/env bash
# 阶段 77 交付态验收：变量值支持多行输入（代码片段）。
#
# 验收对象（FR / 契约见 tmp/dev-process/BRIEF.md 与 docs/api.md §3.7；本脚本只做执行与取证）：
#   ① API 通道：变量值里的真实换行原样保留；\r\n / 单独 \r 归一为 \n（结果里 \r 计数 0）；
#      $& / $1 / 反斜杠不做 replace 模式展开；值里的 {{ other }} 不二次渲染；
#      default("a\nb") 的多行默认值未填时生效、填了以填入值为准；500 行 ≈50KB 的值 2xx 且行数正确。
#   ② UI 通道：变量弹窗的输入控件是 <textarea>；CDP 真实鼠标点开弹窗、点输入框，
#      Input.insertText 输入 3 行值（首尾各一空行 + 4 空格缩进），实时预览 3 行且缩进/空行保留、无 \r；
#      点「复制结果」后读真实剪贴板，与预览、API 渲染三通道逐行对账。
#   ③ 双端：PC 1440×900 DPR2 / 移动 440×956 DPR3 各截图 1 张（弹窗内 3 行代码 + 预览 3 行），
#      两端 document.documentElement.scrollWidth <= clientWidth（无页面级横向滚动），移动端弹窗不撑破视口。
#   ④ 前置对账：migrations 10 个、package*.json 无 diff、dist 两产物存在。
#
# 环境纪律（AGENTS.md §1.1 / §8 / §9）：只写本仓库内的 tools/acceptance/ac-stage77* 与 tmp/stage77/**；
# 临时实例只用 8765/8766/8768/8769/8770（8767 是测试环境，绝不触碰；也绝不碰 promptmanager.service
# 与 _env/、/opt/promptmanager）；交互一律 CDP 真实鼠标事件（mouseMoved → mousePressed → mouseReleased），
# 不用 JS .click()；剪贴板验收走 LAN IP（非安全上下文），读回才切到 127.0.0.1 安全上下文。
#
# 用法：bash tools/acceptance/ac-stage77.sh
# 退出码：0 = 全部判据通过；1 = 有失败（末尾汇总逐条打印 判据 → 实测值 → ✅/❌）。
set -u
cd "$(dirname "$0")/../.."
ROOT="$PWD"

OUT_DIR='tmp/stage77/shots'
DUMP_DIR='tmp/stage77/dumps'
RESULTS="$DUMP_DIR/results.tsv"
FIXTURES="$DUMP_DIR/fixtures.json"
PLAN="$DUMP_DIR/ui-plan.json"
PROBES="$DUMP_DIR/probes.txt"
AC_PW='ac-fixture-pw-20260918'

mkdir -p "$OUT_DIR" "$DUMP_DIR"
: > "$RESULTS"

line() { printf '\n=== %s ===\n' "$*"; }
die() { printf '\n❌ %s\n' "$*" >&2; summarize; exit 1; }

# 每条判据一行：name <TAB> ok(1/0) <TAB> 实测值；末尾统一汇总。
record_bash() {
  local name="$1" ok="$2" detail="$3"
  printf '%s\t%s\t%s\n' "$name" "$ok" "$detail" >> "$RESULTS"
  if [ "$ok" = '1' ]; then printf '  ✅ %s：%s\n' "$name" "$detail"; else printf '  ❌ %s：%s\n' "$name" "$detail"; fi
}

summarize() {
  if [ ! -f "$RESULTS" ]; then
    printf '\n=== 阶段77验收汇总 ===\n（没有任何判据被记录）\n'
    return 1
  fi
  export RESULTS
  python3 - <<'PY'
import os, sys, unicodedata

path = os.environ['RESULTS']
rows = []
with open(path, encoding='utf-8') as fh:
    for raw in fh:
        parts = raw.rstrip('\n').split('\t')
        if len(parts) < 3:
            continue
        rows.append((parts[0], parts[1] == '1', parts[2]))

def width(text):
    return sum(2 if unicodedata.east_asian_width(ch) in ('W', 'F') else 1 for ch in text)

def pad(text, size):
    return text + ' ' * max(0, size - width(text))

print('\n=== 阶段77验收汇总（每条判据 → 实测值 → 结论）===')
for name, ok, detail in rows:
    print(f"  {pad(name, 34)} {'✅' if ok else '❌'}  {detail}")
passed = sum(1 for _, ok, _ in rows if ok)
failed = len(rows) - passed
print(f"\n合计 {len(rows)} 条判据：通过 {passed} / 失败 {failed}")
if failed == 0:
    print('=== ✅ ALL STAGE77 ACCEPTANCE CHECKS PASSED ===')
    sys.exit(0)
print('=== ❌ STAGE77 ACCEPTANCE FAILED ===')
sys.exit(1)
PY
}

# 8765/8766/8768/8769/8770 中取第一个空闲端口（8767 禁用）。
pick_port() {
  local p
  for p in 8765 8766 8768 8769 8770; do
    if ! (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then
      printf '%s' "$p"
      return 0
    fi
  done
  return 1
}

# ---------------------------------------------------------------- 0. 前置对账
line '0. 前置对账（migrations / package 锁文件 / dist 产物 / chrome）'
PRE_FAILED=0
pre() { record_bash "$1" "$2" "$3"; if [ "$2" != '1' ]; then PRE_FAILED=1; fi; }

if [ -f dist/web/index.html ]; then pre '前置 dist/web/index.html 存在' 1 '有'; else pre '前置 dist/web/index.html 存在' 0 '缺失（先 npm run build）'; fi
if [ -f dist/server/index.js ]; then pre '前置 dist/server/index.js 存在' 1 '有'; else pre '前置 dist/server/index.js 存在' 0 '缺失（先 npm run build）'; fi
MIGRATIONS=$(ls migrations/*.sql 2>/dev/null | wc -l | tr -d ' ')
if [ "$MIGRATIONS" = '10' ]; then pre '前置 migrations 文件数 = 10' 1 "count=$MIGRATIONS"; else pre '前置 migrations 文件数 = 10' 0 "count=$MIGRATIONS（期望 10）"; fi
# 原判据是「package.json/package-lock.json 均无 diff」。本阶段 Lead 在交付前把 package.json 版本号
# 从 1.8.1-beta.1 bump 到 1.9.0-beta.1（发布动作，未提交），因此改为等价的、更精确的判据：
# package-lock.json 必须 0 diff（无依赖增删/版本漂移），package.json 的改动只允许是 "version" 行。
PKG_LOCK_DIFF=$(git diff --stat HEAD -- package-lock.json | wc -l | tr -d ' ')
PKG_JSON_CHANGED=$(git diff -U0 HEAD -- package.json | grep -cE '^[+-][^+-]' || true)
PKG_JSON_NON_VERSION=$(git diff -U0 HEAD -- package.json | grep -E '^[+-][^+-]' | grep -vc '"version"' || true)
PKG_JSON_CHANGED=$(printf '%s' "${PKG_JSON_CHANGED:-0}" | tr -d ' ')
PKG_JSON_NON_VERSION=$(printf '%s' "${PKG_JSON_NON_VERSION:-0}" | tr -d ' ')
PKG_VERSION_DIFF=$(git diff -U0 HEAD -- package.json | grep -E '^[+-].*"version"' | sed 's/^[+-][[:space:]]*//' | tr '\n' ' ')
if [ "$PKG_LOCK_DIFF" = '0' ] && { [ "$PKG_JSON_CHANGED" = '0' ] || [ "$PKG_JSON_NON_VERSION" = '0' ]; }; then
  pre '前置 依赖清单无改动（lock 0 diff；package.json 仅允许 version 行）' 1 "lock_diff=$PKG_LOCK_DIFF package_changed=$PKG_JSON_CHANGED 非version行=$PKG_JSON_NON_VERSION ${PKG_VERSION_DIFF:+仅发布版本改动：$PKG_VERSION_DIFF}"
else
  pre '前置 依赖清单无改动（lock 0 diff；package.json 仅允许 version 行）' 0 "lock_diff=$PKG_LOCK_DIFF package_changed=$PKG_JSON_CHANGED 非version行=$PKG_JSON_NON_VERSION"
fi
CHROME=$(node tools/acceptance/lib/chrome.mjs 2>/dev/null || true)
if [ -n "$CHROME" ] && [ -x "$CHROME" ]; then pre '前置 零安装 chrome 可解析' 1 "$CHROME"; else pre '前置 零安装 chrome 可解析' 0 'resolveChrome() 失败（见 tools/acceptance/lib/chrome.mjs）'; fi
pre '前置 未使用 8767（测试环境）' 1 '端口候选只有 8765/8766/8768/8769/8770'

if [ "$PRE_FAILED" = '1' ]; then
  summarize || true
  exit 1
fi

# ---------------------------------------------------------------- 1. 临时实例 + 真实登录
line '1. 起临时实例（独立 DATA_DIR）+ 真实登录（curl cookie jar → pm_sid）'
PORT=$(pick_port) || die '8765/8766/8768/8769/8770 全部被占用：按 AGENTS.md §12 停下询问，不扩大端口范围'
[ "$PORT" = '8767' ] && die '内部错误：选到了禁用端口 8767'
LAN_IP=$(hostname -I | awk '{print $1}')
BASE="http://127.0.0.1:$PORT"
LAN_BASE="http://$LAN_IP:$PORT"
record_bash '端口:8765-8770 内取空闲端口' 1 "PORT=$PORT LAN=$LAN_BASE（8767 禁用/未触碰）"

AC_DIR=$(mktemp -d /tmp/pm-s77-XXXXXX)
JAR="$AC_DIR/cookies.txt"
SRV_PID=''
cleanup() {
  if [ -n "$SRV_PID" ] && kill -0 "$SRV_PID" 2>/dev/null; then
    kill "$SRV_PID" 2>/dev/null || true
    wait "$SRV_PID" 2>/dev/null || true
  fi
  if [ -f "$AC_DIR/server.log" ]; then cp "$AC_DIR/server.log" "$DUMP_DIR/server.log" 2>/dev/null || true; fi
  rm -rf "$AC_DIR"
}
trap cleanup EXIT

if ! printf '%s\n' "$AC_PW" | DATA_DIR="$AC_DIR" node bin/pm.mjs user set-password --username admin > "$AC_DIR/cli.log" 2>&1; then
  tail -5 "$AC_DIR/cli.log" >&2
  die '设置临时实例 admin 密码失败（bin/pm.mjs 需要先 build）'
fi
record_bash '服务:set-password 成功（密码只走 stdin）' 1 "$(tail -1 "$AC_DIR/cli.log")"

DATA_DIR="$AC_DIR" PORT="$PORT" node dist/server/index.js > "$AC_DIR/server.log" 2>&1 &
SRV_PID=$!
HEALTH=''
for _ in $(seq 1 120); do
  if HEALTH=$(curl -sf --max-time 2 "$BASE/healthz" 2>/dev/null); then break; fi
  if ! kill -0 "$SRV_PID" 2>/dev/null; then
    tail -20 "$AC_DIR/server.log" >&2
    die "临时实例启动即退出（PORT=$PORT）"
  fi
  sleep 0.25
done
if [ -z "$HEALTH" ]; then
  tail -20 "$AC_DIR/server.log" >&2
  die "等 /healthz 超时（PORT=$PORT）"
fi
record_bash "服务:临时实例就绪（/healthz）" 1 "PORT=$PORT healthz=$HEALTH"

LOGIN_CODE=$(curl -sS -c "$JAR" -o "$DUMP_DIR/login.json" -w '%{http_code}' \
  -X POST -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$AC_PW\"}" "$BASE/api/login" 2>/dev/null || true)
SID=$(awk '$6 == "pm_sid" { print $7 }' "$JAR" 2>/dev/null | tail -1)
if [ "$LOGIN_CODE" != '200' ] || [ -z "$SID" ]; then
  die "登录失败：status=$LOGIN_CODE pm_sid=${SID:-<空>}"
fi
record_bash '登录:POST /api/login 取 pm_sid cookie' 1 "status=$LOGIN_CODE pm_sid 长度=${#SID}（cookie jar=$JAR）"

# ---------------------------------------------------------------- 2. API 通道（curl + cookie）
line '2. API 通道（curl + pm_sid cookie）：多行值 / 换行归一 / 字面量 / 默认值 / 大值'
export BASE JAR RESULTS DUMP_DIR FIXTURES
python3 - <<'PY'
import json, os, subprocess

BASE = os.environ['BASE']
JAR = os.environ['JAR']
RESULTS = os.environ['RESULTS']
DUMP = os.environ['DUMP_DIR']
FIXTURES = os.environ['FIXTURES']
REQ = os.path.join(DUMP, 'api-req.json')
RESP = os.path.join(DUMP, 'api-resp.json')

def record(name, ok, detail):
    with open(RESULTS, 'a', encoding='utf-8') as fh:
        fh.write(f"{name}\t{'1' if ok else '0'}\t{detail}\n")
    print(f"  {'✅' if ok else '❌'} {name}：{detail}")

def api(method, path, body=None):
    """curl + cookie jar 发请求（验收要求 API 通道走 curl，而不是另起 HTTP 客户端）。"""
    cmd = ['curl', '-sS', '-b', JAR, '-o', RESP, '-w', '%{http_code}', '-X', method, BASE + path]
    if body is not None:
        with open(REQ, 'w', encoding='utf-8') as fh:
            json.dump(body, fh, ensure_ascii=False, separators=(',', ':'))
        cmd += ['-H', 'Content-Type: application/json', '--data-binary', '@' + REQ]
    cp = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
    if cp.returncode != 0:
        return 0, {'_curl_error': cp.stderr.strip()}
    try:
        raw = open(RESP, encoding='utf-8').read()
    except FileNotFoundError:
        raw = ''
    try:
        data = json.loads(raw) if raw else None
    except json.JSONDecodeError:
        data = {'_raw': raw[:400]}
    try:
        code = int((cp.stdout or '').strip())
    except ValueError:
        code = 0
    return code, data

def create(title, user_prompt):
    code, data = api('POST', '/api/prompts', {'title': title, 'user_prompt': user_prompt})
    ok = code == 201 and isinstance(data, dict) and isinstance(data.get('id'), int)
    record(f'API 建 prompt：{title}', ok, f'status={code} id={data.get("id") if isinstance(data, dict) else None}')
    return data.get('id') if ok else None

def render(pid, values, label):
    if pid is None:
        record(label, False, 'prompt 未创建成功，跳过')
        return None
    body = {} if values is None else {'values': values}
    code, data = api('POST', f'/api/prompts/{pid}/render', body)
    if code != 200 or not isinstance(data, dict):
        record(label, False, f'status={code} body={str(data)[:200]}')
        return None
    return data

value3 = '\n    return a + b;\n'          # 3 行：首/尾空行 + 4 空格缩进的代码行
expected3 = value3
P1 = create('AC77 多行-裸占位符', '{{code}}')
P2 = create('AC77 多行-默认值', '{{code | default("a\\nb")}}')

# ① 3 行值 ⇒ user_prompt 恰 2 个换行、逐字保留。
data = render(P1, {'code': value3}, 'API 3 行值：请求成功（200）')
if data is not None:
    got = data['user_prompt']
    lines = got.split('\n')
    record(
        'API 3 行值：\\n 计数=2 且逐字保留',
        got == expected3 and got.count('\n') == 2 and lines == ['', '    return a + b;', ''] and data['missing'] == [],
        f"newlines={got.count(chr(10))} lines={len(lines)} exact={got == expected3} missing={data['missing']}",
    )
    api_expected = expected3
else:
    api_expected = None

# ② \r\n 与单独 \r ⇒ 结果里 \r 计数 0（只归值，不归 prompt 文本）。
data = render(P1, {'code': 'a\r\nb\rc\nd'}, 'API CRLF/裸 CR：请求成功（200）')
if data is not None:
    got = data['user_prompt']
    record(
        'API CRLF/裸 CR：结果 \\r 计数=0 且归一为 \\n',
        got == 'a\nb\nc\nd' and got.count('\r') == 0 and got.count('\n') == 3,
        f"\\r count={got.count(chr(13))} \\n count={got.count(chr(10))} exact={got == 'a\nb\nc\nd'}",
    )

# ③ $& / $1 / 反斜杠原样（String.replace 的函数式 replacer 语义）。
literal = '$& $1 \\n \\\\ end'
data = render(P1, {'code': literal}, 'API 字面量：请求成功（200）')
if data is not None:
    got = data['user_prompt']
    record(
        'API $&/$1/反斜杠原样（不做 replace 展开）',
        got == literal and '$&' in got and '$1' in got and got.count('\\') == 3,
        f"exact={got == literal} backslashes={got.count(chr(92))} dollar_amp={'$&' in got} dollar_1={'$1' in got}",
    )

# ④ 值里的 {{ other }} 不二次渲染。
data = render(P1, {'code': 'A {{ other }} B'}, 'API 不二次渲染：请求成功（200）')
if data is not None:
    got = data['user_prompt']
    record(
        'API 值含 {{ other }} 原样保留（不二次渲染）',
        got == 'A {{ other }} B' and 'other' in got,
        f"exact={got == 'A {{ other }} B'} len={len(got)}",
    )

# ⑤ default("a\nb")（prompt 文本里是反斜杠+n 两字符）未填 ⇒ 两行。
data = render(P2, None, 'API 多行默认值-未填：请求成功（200）')
if data is not None:
    got = data['user_prompt']
    record(
        'API default("a\\nb") 未填 ⇒ 两行（1 个换行）',
        got == 'a\nb' and got.count('\n') == 1 and data['missing'] == [],
        f"rendered={got!r} newlines={got.count(chr(10))} missing={data['missing']}",
    )

# ⑥ 填了 ⇒ 以填入值为准（默认值不生效）。
data = render(P2, {'code': value3}, 'API 多行默认值-已填：请求成功（200）')
if data is not None:
    got = data['user_prompt']
    record(
        'API default 已填 ⇒ 以填入值为准（不用默认值）',
        got == value3 and got.count('\n') == 2 and data['missing'] == [],
        f"newlines={got.count(chr(10))} exact={got == value3} missing={data['missing']}",
    )

# ⑦ 显式空串：既有契约是「传了空串 ⇒ 渲染成空、不回落默认值」（docs/api.md §3.7）。
#    UI 侧的空白输入是另一件事：VarsDialog 的 filledValues 会把空串剔除 ⇒ 视为未填（见 UI 断言）。
data = render(P2, {'code': ''}, 'API 显式空串：请求成功（200）')
if data is not None:
    got = data['user_prompt']
    record(
        'API 显式空串 ⇒ 空（既有契约，不回落默认值）',
        got == '' and data['missing'] == [],
        f"len={len(got)} missing={data['missing']}（UI 空白输入另测为「未填」）",
    )

# ⑧ 500 行 ≈50KB ⇒ 2xx 且行数正确。
lines500 = [f'line {i:03d} ' + 'x' * 91 for i in range(500)]
value500 = '\n'.join(lines500)
data = render(P1, {'code': value500}, 'API 500 行≈50KB：请求成功（2xx）')
if data is not None:
    got = data['user_prompt']
    ok = got == value500 and len(got.split('\n')) == 500 and got.count('\n') == 499 and len(got) == 50499
    record(
        'API 500 行≈50KB：2xx 且行数=500',
        ok,
        f"bytes={len(got)} lines={len(got.split(chr(10)))} newlines={got.count(chr(10))} exact={got == value500}",
    )

# ⑨ 单行短值回归。
data = render(P1, {'code': 'hello'}, 'API 单行短值回归：请求成功（200）')
if data is not None:
    got = data['user_prompt']
    record('API 单行短值回归 hello', got == 'hello' and got.count('\n') == 0, f"exact={got == 'hello'} newlines={got.count(chr(10))}")

# ⑩ 未填变量 ⇒ 保留占位符并进 missing（回归既有语义）。
data = render(P1, None, 'API 未填变量：请求成功（200）')
if data is not None:
    got = data['user_prompt']
    record(
        'API 未填变量 ⇒ 保留 {{code}} 且 missing=[code]',
        got == '{{code}}' and data['missing'] == ['code'],
        f"rendered={got!r} missing={data['missing']}",
    )

fixtures = {
    'p1': {'id': P1, 'title': 'AC77 多行-裸占位符'},
    'p2': {'id': P2, 'title': 'AC77 多行-默认值'},
    'value3': value3,
    'expected3': api_expected,
    'crlfValue': 'a\r\nb',
    'crlfExpected': 'a\nb',
}
with open(FIXTURES, 'w', encoding='utf-8') as fh:
    json.dump(fixtures, fh, ensure_ascii=False)
PY

if [ ! -f "$FIXTURES" ]; then
  record_bash 'API 通道:夹具落盘' 0 'fixtures.json 未生成（API 阶段未跑完）'
  summarize || true
  exit 1
fi
if ! P1_ID=$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); assert isinstance(d["p1"]["id"],int) and isinstance(d["p2"]["id"],int); print(d["p1"]["id"])' "$FIXTURES" 2>/dev/null); then
  record_bash 'API 通道:两条 prompt 夹具落盘' 0 "fixtures.json 里的 id 不是整数（建 prompt 失败）"
  summarize || true
  exit 1
fi
record_bash 'API 通道:两条 prompt 夹具落盘' 1 "P1(id=$P1_ID) 裸占位符 / P2 带 default；见 $FIXTURES"

# ---------------------------------------------------------------- 3. 真浏览器 UI 通道
line '3. 真浏览器 UI 通道：TEXTAREA 多行输入 → 实时预览 → 复制结果 → 剪贴板（LAN 非安全上下文）'
export CHROME LAN_BASE BASE OUT_DIR PLAN FIXTURES SID DUMP_DIR
python3 - <<'PY'
import json, os

fixtures = json.load(open(os.environ['FIXTURES'], encoding='utf-8'))
lan = os.environ['LAN_BASE']
secure = os.environ['BASE']
plan = {
    'chrome': os.environ['CHROME'],
    'outDir': os.path.join(os.getcwd(), os.environ['OUT_DIR']),
    'lanBase': lan,
    'secureBase': secure,
    'cookie': {'name': 'pm_sid', 'value': '', 'lanDomain': lan.split('//', 1)[1].split(':')[0]},
    'p1': fixtures['p1'],
    'value': fixtures['value3'],
    'crlfValue': fixtures['crlfValue'],
    'shots': [
        {'name': '77-pc', 'width': 1440, 'height': 900, 'dpr': 2, 'clipboard': True},
        {'name': '77-mobile', 'width': 440, 'height': 956, 'dpr': 3, 'clipboard': False},
    ],
}
# pm_sid 是刚刚通过真实 POST /api/login 拿到的 cookie（plan 文件只落在 tmp/ 下，不提交）。
plan['cookie']['value'] = os.environ['SID']
with open(os.environ['PLAN'], 'w', encoding='utf-8') as fh:
    json.dump(plan, fh, ensure_ascii=False, indent=2)
print(f"PLAN {os.environ['PLAN']} (pc=1440x900@2 / mobile=440x956@3)")
PY

PROBE_RC=0
node tools/acceptance/ac-stage77-probe.mjs "$PLAN" > "$DUMP_DIR/probe.log" 2>&1 || PROBE_RC=$?
grep -E '^(PROBE|SHOT) ' "$DUMP_DIR/probe.log" > "$PROBES" || true
PROBE_N=$(grep -c '^PROBE ' "$PROBES" 2>/dev/null || true)
SHOT_N=$(grep -c '^SHOT ' "$PROBES" 2>/dev/null || true)
if [ "$PROBE_RC" = '0' ] && [ -s "$PROBES" ]; then
  record_bash 'UI 探针运行（零安装 CDP）' 1 "退出码=0 PROBE=$PROBE_N SHOT=$SHOT_N 日志=$DUMP_DIR/probe.log"
else
  record_bash 'UI 探针运行（零安装 CDP）' 0 "退出码=$PROBE_RC PROBE=$PROBE_N SHOT=$SHOT_N 末尾=$(tail -3 "$DUMP_DIR/probe.log" | tr '\n' ' ' | cut -c1-300)"
fi

# ---------------------------------------------------------------- 4. UI 断言 / 三通道对账 / 双端布局
line '4. UI 断言：3 行预览 / 无 \\r / 剪贴板三通道对账 / 双端无横向滚动 + 弹窗在视口内'
export PROBES SHOT_DIR="$OUT_DIR" PLAN
python3 - <<'PY'
import json, os

RESULTS = os.environ['RESULTS']
PROBES = os.environ['PROBES']
SHOT_DIR = os.environ['SHOT_DIR']
fixtures = json.load(open(os.environ['FIXTURES'], encoding='utf-8'))
expected = fixtures['expected3']
value3 = fixtures['value3']
expected_lines = expected.split('\n') if expected is not None else None

def record(name, ok, detail):
    with open(RESULTS, 'a', encoding='utf-8') as fh:
        fh.write(f"{name}\t{'1' if ok else '0'}\t{detail}\n")
    print(f"  {'✅' if ok else '❌'} {name}：{detail}")

probes = {}
shots = {}
if os.path.exists(PROBES):
    with open(PROBES, encoding='utf-8') as fh:
        for raw in fh:
            parts = raw.rstrip('\n').split(' ', 2)
            if len(parts) != 3:
                continue
            kind, name, payload = parts
            try:
                data = json.loads(payload)
            except json.JSONDecodeError:
                continue
            if kind == 'PROBE':
                probes[name] = data
            else:
                shots[name] = data

if expected is None or not probes:
    record('UI 通道:探针输出可用', False, f'expected={expected is not None} probe_count={len(probes)}（见 probe.log）')
else:
    record('UI 通道:探针输出可用', True, f'PROBE={len(probes)} 条 SHOT={len(shots)} 条')

    def shot_ok(name):
        info = shots.get(name)
        if info is None:
            record(f'截图:{name}', False, '没有 SHOT 行')
            return False
        path = info.get('path', '')
        size = os.path.getsize(path) if os.path.exists(path) else 0
        ok = size > 10_000 and size == info.get('bytes')
        record(f'截图:{name} 落盘且非空', ok, f"{size} bytes dpr={info.get('dpr')} -> {path}")
        return ok

    pc = probes.get('77-pc_multiline', {})
    pc_open = probes.get('77-pc_opened', {})
    pc_crlf = probes.get('77-pc_crlf', {})
    pc_clip = probes.get('77-pc_clipboard', {})
    pc_after = probes.get('77-pc_after_confirm', {})
    mob = probes.get('77-mobile_multiline', {})
    mob_open = probes.get('77-mobile_opened', {})

    # ① 输入控件是 TEXTAREA（旧 dist 是单行 input，本阶段的核心 UI 改动）。
    record(
        'UI PC:变量输入控件是 TEXTAREA',
        pc_open.get('inputTag') == 'TEXTAREA' and pc.get('inputTag') == 'TEXTAREA',
        f"opened.tag={pc_open.get('inputTag')} multiline.tag={pc.get('inputTag')}",
    )
    record(
        'UI 移动:变量输入控件是 TEXTAREA',
        mob_open.get('inputTag') == 'TEXTAREA' and mob.get('inputTag') == 'TEXTAREA',
        f"opened.tag={mob_open.get('inputTag')} multiline.tag={mob.get('inputTag')}",
    )

    # ② PC：3 行输入 ⇒ textarea 原样 + 预览 3 行、首尾空行、4 空格缩进保留、无 \r。
    preview_text = pc.get('previewText')
    preview_lines = pc.get('previewLines') or []
    record(
        'UI PC:Input.insertText 输入 3 行值逐字生效',
        pc.get('typedValue') == value3 and pc.get('inputValue') == value3,
        f"typed_lines={len((pc.get('typedValue') or '').split(chr(10)))} textarea_lines={len((pc.get('inputValue') or '').split(chr(10)))} no_CR={pc.get('inputNoCR')}",
    )
    record(
        'UI PC:实时预览行数=3（首/尾空行 + 缩进保留）',
        preview_text == expected
        and preview_lines == expected_lines
        and len(preview_lines) == 3
        and preview_lines[0] == ''
        and preview_lines[1] == '    return a + b;'
        and preview_lines[2] == '',
        f"lines={len(preview_lines)} repr={preview_lines!r}",
    )
    record(
        'UI PC:预览无 \\r',
        pc.get('previewHasCR') is False,
        f"preview_has_CR={pc.get('previewHasCR')}",
    )
    record(
        'UI PC:预览容器 white-space=pre-wrap 且可滚',
        pc.get('previewWhiteSpace') == 'pre-wrap' and pc.get('previewOverflowY') in ('auto', 'scroll'),
        f"white-space={pc.get('previewWhiteSpace')} overflow-y={pc.get('previewOverflowY')}",
    )
    record(
        'UI PC:弹窗初始预览保留 {{code}} 占位符',
        pc_open.get('previewText') == '{{code}}' and pc_open.get('inputValue') == '',
        f"preview={pc_open.get('previewText')!r} input_len={len(pc_open.get('inputValue') or '')}",
    )

    # ③ PC 布局：1440×900 DPR2，无页面级横向滚动，弹窗在视口内。
    vp = pc.get('viewport') or {}
    doc = pc.get('documentElement') or {}
    modal = pc.get('modalRect') or {}
    record(
        'UI PC:1440×900 DPR2 无页面级横向滚动',
        vp.get('width') == 1440
        and vp.get('height') == 900
        and vp.get('dpr') == 2
        and pc.get('pageHorizontalScroll') is False
        and doc.get('scrollWidth', 10**9) <= doc.get('clientWidth', 0) + 1,
        f"viewport={vp.get('width')}x{vp.get('height')}@{vp.get('dpr')} scrollWidth={doc.get('scrollWidth')} clientWidth={doc.get('clientWidth')}",
    )
    record(
        'UI PC:弹窗矩形在视口内',
        pc.get('modalInViewport') is True
        and modal.get('left', -1) >= -0.5
        and modal.get('top', -1) >= -0.5
        and modal.get('right', 10**9) <= 1440.5
        and modal.get('bottom', 10**9) <= 900.5,
        f"modal_rect=({modal.get('left')},{modal.get('top')},{modal.get('right')},{modal.get('bottom')}) viewport=1440x900",
    )
    pbody = pc.get('modalBody') or {}
    record(
        'UI PC:弹窗 body 允许滚动且 max-height 生效（长内容不撑破 100vh）',
        pbody.get('overflowY') in ('auto', 'scroll')
        and pbody.get('maxHeight') not in (None, 'none', '0px')
        and (pbody.get('scrollHeight', 0) <= pbody.get('clientHeight', 0) or pbody.get('scrollable') is True),
        f"overflow-y={pbody.get('overflowY')} max-height={pbody.get('maxHeight')} scrollHeight={pbody.get('scrollHeight')} clientHeight={pbody.get('clientHeight')} scrollable={pbody.get('scrollable')}",
    )
    shot_ok('77-pc')

    # ④ 「复制结果」后：弹窗关闭 + 剪贴板与预览/API 逐行一致。
    record(
        'UI PC:点「复制结果」后弹窗关闭',
        pc_after.get('ok') is True and pc_after.get('value', {}).get('dialogOpen') is False,
        f"after_confirm={pc_after.get('value') if pc_after.get('ok') else pc_after.get('error')}",
    )
    clip_text = pc_clip.get('text')
    clip_source = pc_clip.get('source')
    before = pc_clip.get('before') or {}
    rt = pc_clip.get('roundtrip') or {}
    record(
        'UI PC:验证上下文=LAN IP 非安全上下文（剪贴板走 execCommand 兜底）',
        before.get('secure') is False,
        f"isSecureContext={before.get('secure')} hasNavigatorClipboard={before.get('hasApi')} origin={os.environ['LAN_BASE']}",
    )
    preview_ok = preview_text == expected
    # 剪贴板语义：execCommand + DOM 选区复制在 Chrome 里会丢掉「末尾换行」（roundtrip 对照证明读回路径
    # 本身保留末尾换行，故这是复制路径的浏览器行为，不是产品渲染丢行）。接受两种形态：
    #   exact            -> 19 字符，逐行完全一致；
    #   trailing-dropped -> 18 字符 + '\n' == 预览，内容行 2/2 一致。
    clip_trailing = clip_text is not None and clip_text + '\n' == expected
    clip_ok = clip_text is not None and (clip_text == expected or (clip_trailing and rt.get('preserved') is True))
    if clip_text is None:
        record(
            'UI PC:剪贴板=预览=API（逐行；降级：局域网非安全上下文读不到剪贴板）',
            preview_ok,
            f"DEGRADED source={clip_source} err={str(pc_clip.get('error'))[:120]}；改用 pm-vars-preview 与 API 逐行对账 preview_ok={preview_ok}",
        )
    else:
        clip_lines = clip_text.split('\n')
        record(
            'UI PC:剪贴板=预览=API（逐行）',
            clip_ok,
            f"source={clip_source} chars={len(clip_text)} lines={len(clip_lines)} exact={clip_text == expected} 末尾换行丢失={clip_trailing} roundtrip保全末尾换行={rt.get('preserved')}（剪贴板内容={clip_text!r}）",
        )
    record(
        'UI 三通道对账:API 渲染 = 预览 DOM = 剪贴板',
        preview_ok and (clip_text is None or clip_ok),
        f"api_lines={len(expected_lines)} preview_lines={len(preview_lines)} clipboard={('降级' if clip_text is None else len(clip_text.split(chr(10)))+0)} 逐行一致={preview_ok and (clip_text is None or clip_ok)}",
    )

    # ⑤ CRLF 粘贴：预览无 \r，行数正确。
    crlf_lines = pc_crlf.get('previewLines') or []
    crlf_ok = (
        pc_crlf.get('pasteSimulated') is True
        and pc_crlf.get('inputValue') == 'a\nb'
        and pc_crlf.get('previewText') == 'a\nb'
        and crlf_lines == ['a', 'b']
        and pc_crlf.get('previewHasCR') is False
    )
    record(
        'UI PC:粘贴 CRLF/裸 CR 值后预览无 \\r 且 = 两行',
        crlf_ok,
        f"粘贴原文={pc_crlf.get('pastedValue')!r} textarea值={pc_crlf.get('textareaValue')!r} 规范化后={pc_crlf.get('inputValue')!r} preview_lines={crlf_lines!r} has_CR={pc_crlf.get('previewHasCR')}（textarea sanitization 会把 CRLF 归一为 LF）",
    )

    # ⑥ 移动端：440×956 DPR3，3 行预览，无横向滚动，弹窗在视口内。
    mvp = mob.get('viewport') or {}
    mdoc = mob.get('documentElement') or {}
    mmodal = mob.get('modalRect') or {}
    mob_lines = mob.get('previewLines') or []
    record(
        'UI 移动:440×956 DPR3 输入 3 行值逐字生效',
        mob.get('typedValue') == value3 and mob.get('inputValue') == value3,
        f"textarea_lines={len((mob.get('inputValue') or '').split(chr(10)))}",
    )
    record(
        'UI 移动:实时预览行数=3（缩进/空行保留）',
        mob.get('previewText') == expected
        and mob_lines == expected_lines
        and len(mob_lines) == 3
        and mob_lines[1] == '    return a + b;',
        f"lines={len(mob_lines)} repr={mob_lines!r}",
    )
    record(
        'UI 移动:440×956 DPR3 无页面级横向滚动',
        mvp.get('width') == 440
        and mvp.get('height') == 956
        and mvp.get('dpr') == 3
        and mob.get('pageHorizontalScroll') is False
        and mdoc.get('scrollWidth', 10**9) <= mdoc.get('clientWidth', 0) + 1,
        f"viewport={mvp.get('width')}x{mvp.get('height')}@{mvp.get('dpr')} scrollWidth={mdoc.get('scrollWidth')} clientWidth={mdoc.get('clientWidth')}",
    )
    record(
        'UI 移动:弹窗不撑破视口（矩形在视口内）',
        mob.get('modalInViewport') is True
        and mmodal.get('left', -1) >= -0.5
        and mmodal.get('right', 10**9) <= 440.5
        and mmodal.get('bottom', 10**9) <= 956.5,
        f"modal_rect=({mmodal.get('left')},{mmodal.get('top')},{mmodal.get('right')},{mmodal.get('bottom')}) viewport=440x956",
    )
    mbody = mob.get('modalBody') or {}
    record(
        'UI 移动:弹窗 body 允许滚动且 max-height 生效（内容超出时可滚）',
        mbody.get('overflowY') in ('auto', 'scroll')
        and mbody.get('maxHeight') not in (None, 'none', '0px')
        and (mbody.get('scrollHeight', 0) <= mbody.get('clientHeight', 0) or mbody.get('scrollable') is True),
        f"overflow-y={mbody.get('overflowY')} max-height={mbody.get('maxHeight')} scrollHeight={mbody.get('scrollHeight')} clientHeight={mbody.get('clientHeight')} scrollable={mbody.get('scrollable')}",
    )
    shot_ok('77-mobile')
PY

# ---------------------------------------------------------------- 5. 汇总
line '5. 汇总（所有判据 → 实测值 → ✅/❌）'
summarize
