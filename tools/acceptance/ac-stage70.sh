#!/usr/bin/env bash
# 阶段 70 端到端验收（交付态，随仓库入库）：结构与单一来源（二）（FR-147 ~ FR-150 / AC-132）
#
# 验的是什么（本阶段是结构改造，界面不动 ⇒ 真浏览器只走"变量路径"这一条冒烟）：
#   1) 变量语法单源之后，前端列表里的**卡片/表格按钮文案**仍按"这条有没有变量"给出（FR-147 的
#      列表变量数改走共享实现后的用户可见后果）
#   2) 点「填值后复制」打开的填值弹窗：标题含「自动记忆」、预览用共享语法渲染出默认值
#      （结构上保证「预览 = 剪贴板」）、缺失行为「未填 0 个」
#   3) PC 1440×900 与移动 440×956 两端都无页面级横向滚动
#   4) 服务端复核：`GET /api/prompts/:id/variables` 报的 variables/defaults 与前端预览一致
set -u
cd "$(dirname "$0")/../.."
ROOT="$PWD"

OUT_DIR='tmp/stage70/shots'
DUMP_DIR='tmp/stage70/dumps'
AC_PW='ac-fixture-pw-20260918'
TITLE='阶段70变量'

line() { printf '\n=== %s ===\n' "$*"; }
die() { printf '\n❌ %s\n' "$*" >&2; exit 1; }

pick_port() {
  for p in 8765 8766 8768 8769 8770; do
    if ! (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then echo "$p"; return 0; fi
  done
  return 1
}

line "0. 前置检查"
[ -f dist/web/index.html ] || die "缺 dist/web/index.html（先 npm run build）"
[ -f dist/server/index.js ] || die "缺 dist/server/index.js"
COUNT=$(ls migrations/*.sql | wc -l | tr -d ' ')
[ "$COUNT" = "10" ] || die "migrations 应为 10 个（本阶段零迁移），实际 $COUNT"
echo "  ✅ dist 产物齐、migrations=$COUNT（零迁移）"

PORT=$(pick_port) || die "8765–8770 全被占用"
BASE="http://127.0.0.1:$PORT"
LAN_IP=$(hostname -I | awk '{print $1}')
LAN_BASE="http://$LAN_IP:$PORT"
AC_DIR=$(mktemp -d /tmp/pm-s70-XXXXXX)
JAR="$AC_DIR/cookies.txt"
PLAN_PC="$AC_DIR/plan-pc.json"
PLAN_MOBILE="$AC_DIR/plan-mobile.json"
mkdir -p "$ROOT/$OUT_DIR" "$ROOT/$DUMP_DIR"
cleanup() {
  [ -n "${SRV_PID:-}" ] && kill "$SRV_PID" 2>/dev/null
  rm -rf "$AC_DIR"
}
trap cleanup EXIT
echo "  PORT=$PORT（8767 禁用）LAN_BASE=$LAN_BASE AC_DIR=$AC_DIR"

line "1. 起临时服务 + 真登录 + 接口层建变量夹具"
printf '%s\n' "$AC_PW" | DATA_DIR="$AC_DIR" node bin/pm.mjs user set-password --username admin >/dev/null || die "set-password 失败"
DATA_DIR="$AC_DIR" PORT="$PORT" node dist/server/index.js > "$AC_DIR/server.log" 2>&1 &
SRV_PID=$!
for _ in $(seq 1 60); do
  curl -sf "$BASE/healthz" >/dev/null 2>&1 && break
  sleep 0.3
done
curl -sf "$BASE/healthz" >/dev/null 2>&1 || { tail -20 "$AC_DIR/server.log"; die "服务没起来"; }
echo "  /healthz = $(curl -s "$BASE/healthz")"
curl -s -c "$JAR" -o /dev/null -X POST -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$AC_PW\"}" "$BASE/api/login"
SID=$(awk '$6 == "pm_sid" { print $7 }' "$JAR" | tail -1)
[ -n "$SID" ] || die "登录没拿到 pm_sid"
echo "  登录成功（pm_sid 长度 ${#SID}）"

python3 - "$BASE" "$SID" "$AC_DIR" <<'PY' || die "接口层不符"
import json, sys, urllib.parse, urllib.request

base, sid, ac_dir = sys.argv[1:4]

def call(method, path, body=None):
    path = urllib.parse.quote(path, safe='/?&=')
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(base + path, data=data, method=method)
    req.add_header('cookie', 'pm_sid=' + sid)
    if data is not None:
        req.add_header('content-type', 'application/json')
    with urllib.request.urlopen(req) as res:
        return res.status, json.loads(res.read().decode() or 'null')

# 含默认值、两段各一个变量 —— 覆盖 FR-147「语法单源」的默认值分支
status, created = call('POST', '/api/prompts', {
    'title': '阶段70变量',
    'user_prompt': '你好 {{项目 | default(甲)}}',
    'system_prompt': '语气 {{语气 | default(专业)}}',
})
assert status == 201, (status, created)
pid = created['id']
with open(f'{ac_dir}/pid.txt', 'w') as fh:
    fh.write(str(pid))

status, scan = call('GET', f'/api/prompts/{pid}/variables')
assert status == 200, (status, scan)
assert scan['variables'] == ['项目', '语气'], scan
assert scan['defaults'] == {'项目': '甲', '语气': '专业'}, scan
print(f"  夹具 id={pid}；/variables = {json.dumps(scan, ensure_ascii=False)}")

# 界面要显示的按钮文案应当由"这条有没有变量"决定（前端不再自带语法字面量）
status, listed = call('GET', '/api/prompts?q=阶段70变量&limit=10')
assert status == 200 and listed['total'] == 1, (status, listed)
print(f"  列表命中 {listed['total']} 条（按钮文案应为「填值后复制」）")
PY

line "2. 真浏览器（PC 1440×900 + 移动 440×956）：变量路径"
CHROME=$(node tools/acceptance/lib/chrome.mjs)
[ -n "$CHROME" ] || die "找不到 chrome-headless-shell"
OUT_ABS="$ROOT/$OUT_DIR"
DUMP_ABS="$ROOT/$DUMP_DIR"

python3 - "$LAN_BASE" "$LAN_IP" "$SID" "$CHROME" "$OUT_ABS" "$DUMP_ABS" "$PLAN_PC" "$PLAN_MOBILE" "$(cat "$AC_DIR/pid.txt")" <<'PY' || die "计划生成失败"
import json, sys

base, lan_ip, sid, chrome, out_dir, dumps_dir, plan_pc, plan_mobile, pid = sys.argv[1:10]

OVERFLOW = "(() => document.documentElement.scrollWidth > window.innerWidth ? 'overflow' : 'none')()"
SEARCH = """(() => { const el = document.querySelector('[data-testid=pm-search-input]');
  if (!el) return 'no-input'; el.value = '阶段70变量';
  el.dispatchEvent(new Event('input', { bubbles: true })); return 'typed'; })()"""
ROW_COPY = """(() => { const rows = [...document.querySelectorAll('tbody tr')];
  const row = rows.find(n => n.innerText.includes('阶段70变量'));
  if (!row) return 'no-row';
  const b = row.querySelector('[data-testid^=pm-copy-]');
  return b ? b.innerText : 'no-btn'; })()"""
CARD_COPY = """(() => { const cards = [...document.querySelectorAll('[data-testid=pm-use-card]')];
  const card = cards.find(n => n.innerText.includes('阶段70变量'));
  if (!card) return 'no-card';
  const b = card.querySelector('[data-testid^=pm-copy-]');
  return b ? b.innerText : 'no-btn'; })()"""
DIALOG_TITLE = "document.querySelector('.ant-modal-title')?.innerText ?? 'no-title'"
PREVIEW = "document.querySelector('[data-testid=pm-vars-preview]')?.innerText ?? 'no-preview'"
MISSING = "document.querySelector('[data-testid=pm-vars-missing]')?.innerText ?? 'no-missing'"

def open_dialog_probes(prefix):
    return [
        {'type': 'wait', 'selector': '[data-testid=pm-vars-dialog]'},
        {'type': 'sleep', 'ms': 700},
        {'type': 'probe', 'name': prefix + '-title', 'expression': DIALOG_TITLE},
        {'type': 'probe', 'name': prefix + '-preview', 'expression': PREVIEW},
        {'type': 'probe', 'name': prefix + '-missing', 'expression': MISSING},
        {'type': 'probe', 'name': prefix + '-overflow', 'expression': OVERFLOW},
    ]

shot_pc = {
    'name': '70-vars-pc', 'path': '/', 'width': 1440, 'height': 900, 'auth': True,
    'storage': {'pm-view-mode': 'table', 'pm-theme': 'light'},
    'waitFor': '[data-testid=pm-search-input]',
    'actions': [
        {'type': 'eval', 'expression': SEARCH}, {'type': 'sleep', 'ms': 1200},
        {'type': 'probe', 'name': 'p-copy-label', 'expression': ROW_COPY},
        {'type': 'click', 'selector': '[data-testid=pm-copy-%s]' % pid},
        *open_dialog_probes('p'),
    ],
    'dump': '70-vars-pc', 'settleMs': 700,
}

shot_mobile = {
    'name': '70-vars-mobile', 'path': '/', 'width': 440, 'height': 956, 'auth': True,
    'storage': {'pm-view-mode': 'card', 'pm-theme': 'light'},
    'waitFor': '[data-testid=pm-search-input]',
    'actions': [
        {'type': 'eval', 'expression': SEARCH}, {'type': 'sleep', 'ms': 1200},
        {'type': 'probe', 'name': 'm-copy-label', 'expression': CARD_COPY},
        {'type': 'click', 'selector': '[data-testid=pm-copy-%s]' % pid},
        *open_dialog_probes('m'),
    ],
    'dump': '70-vars-mobile', 'settleMs': 700,
}

def write(path, shots):
    json.dump({'chrome': chrome, 'baseUrl': base,
               'cookie': {'name': 'pm_sid', 'value': sid, 'domain': lan_ip},
               'outDir': out_dir, 'dumpsDir': dumps_dir, 'shots': shots},
              open(path, 'w', encoding='utf-8'), ensure_ascii=False)

write(plan_pc, [shot_pc])
write(plan_mobile, [shot_mobile])
print('  两份计划已生成（PC 1 shot + 移动 1 shot）')
PY

: > "$DUMP_DIR/probes.txt"
for P in "$PLAN_PC" "$PLAN_MOBILE"; do
  echo "--- $(basename "$P") ---"
  PLAN_OUT=$(node tools/ui-shot.mjs "$P" 2>&1) || { printf '%s\n' "$PLAN_OUT" | tail -30; die "ui-shot 失败：$P"; }
  printf '%s\n' "$PLAN_OUT" | grep -E '^(SHOT|PROBE|ANT_CLASSES)'
  printf '%s\n' "$PLAN_OUT" >> "$DUMP_DIR/probes.txt"
done

line "3. 界面探针断言（取最后一次同名探针）"
assert_probe() {
  key="$1"; want="$2"; mode="${3:-has}"
  got=$(grep -F "PROBE $key " "$DUMP_DIR/probes.txt" | tail -1 | sed "s/^PROBE $key //")
  [ -n "$got" ] || die "探针 $key 没有输出"
  case "$mode" in
    has) case "$got" in *"$want"*) ;; *) die "探针 $key 应包含「$want」，实际 $got" ;; esac ;;
    not) case "$got" in *"$want"*) die "探针 $key 不应包含「$want」，实际 $got" ;; esac ;;
    eq)  stripped=$(printf '%s' "$got" | sed 's/^"//; s/"$//')
         [ "$stripped" = "$want" ] || die "探针 $key 应等于「$want」，实际 $got" ;;
  esac
  echo "  ✅ $key ($mode) $want"
}

# FR-147：列表变量数不再本地解析 ⇒ 含变量的那条必须显示「填值后复制」
assert_probe p-copy-label '填值后复制' has
assert_probe p-title '自动记忆' has
# 弹窗预览只渲染**用户段**（VarsDialog.tsx:94 previewRender(prompt.user_prompt, values)）；
# 系统段的默认值走服务端 /render 复核（见第 4 步）
assert_probe p-preview '你好 甲' has
assert_probe p-preview '{{' not
assert_probe p-missing '未填 0 个' has
assert_probe p-overflow 'none' eq
assert_probe m-copy-label '填值后复制' has
assert_probe m-title '自动记忆' has
assert_probe m-preview '你好 甲' has
assert_probe m-overflow 'none' eq

line "4. 服务端复核（接口报的 variables/defaults 与前端预览用的是同一份）"
python3 - "$BASE" "$SID" "$AC_DIR" <<'PY' || die "服务端复核不符"
import json, sys, urllib.request

base, sid, ac_dir = sys.argv[1:4]
pid = open(f'{ac_dir}/pid.txt').read().strip()
req = urllib.request.Request(base + f'/api/prompts/{pid}/variables')
req.add_header('cookie', 'pm_sid=' + sid)
with urllib.request.urlopen(req) as res:
    scan = json.loads(res.read().decode())
print(f"  /api/prompts/{pid}/variables = {json.dumps(scan, ensure_ascii=False)}")
assert scan['variables'] == ['项目', '语气'], scan
assert scan['defaults'] == {'项目': '甲', '语气': '专业'}, scan

# 系统段的默认值也走同一张「全篇」默认值表（FR-147：前后端共用一处语法）
body = json.dumps({'values': {}}).encode()
req = urllib.request.Request(base + f'/api/prompts/{pid}/render', data=body, method='POST')
req.add_header('cookie', 'pm_sid=' + sid)
req.add_header('content-type', 'application/json')
with urllib.request.urlopen(req) as res:
    rendered = json.loads(res.read().decode())
print(f"  /render = {json.dumps(rendered, ensure_ascii=False)}")
assert rendered['user_prompt'] == '你好 甲', rendered
assert rendered['system_prompt'] == '语气 专业', rendered
assert rendered['missing'] == [], rendered
PY

line "5. 截图与产物落点"
ls -1 "$ROOT/$OUT_DIR" | sed 's/^/  /'
echo "  dumps: $DUMP_DIR"

line "✅ ALL STAGE70 ACCEPTANCE CHECKS PASSED"
