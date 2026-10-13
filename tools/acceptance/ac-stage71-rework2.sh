#!/usr/bin/env bash
# 阶段 71 返工②（第三轮项目审视 M1 / M2 + S3）端到端验收（交付态，随仓库入库）
#
# 验的是什么（动的是界面交互 ⇒ 双端真浏览器自证）：
#   M1：编辑器里有未保存改动、**焦点不在输入框**时按 `Ctrl+K` / `/` ⇒ 必须出现「放弃未保存的修改？」确认；
#       「继续编辑」后内容还在；「放弃修改」才离开（编辑器卸载、回列表）。
#   M2：分栏视图 `↑↓` 必须让**高亮跟着动**（原来只改 activeIndex，界面没反馈）；
#       `Enter` 必须复制**界面显示的那条** —— 用接口层 `use_count` 对账：甲 +1、乙仍 0（不许记假取用）。
#   移动端：编辑器是 Drawer（`view` 仍是 list）⇒ `/` 同样必须过闸门。
#   双端：PC 1440×900 DPR2 / 移动 440×956 DPR3，均无页面级横向滚动。
#   通用：零迁移（migrations 仍 10）、零新增依赖（package.json / lock 与 HEAD 无 diff）。
set -u
cd "$(dirname "$0")/../.."
ROOT="$PWD"

OUT_DIR='tmp/stage71-rework2/shots'
DUMP_DIR='tmp/stage71-rework2/dumps'
AC_PW='ac-fixture-pw-20260918'
TYPED='改了一半还没保存'

line() { printf '\n=== %s ===\n' "$*"; }
die() { printf '\n❌ %s\n' "$*" >&2; exit 1; }

pick_port() {
  for p in 8765 8766 8768 8769 8770; do
    if ! (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then echo "$p"; return 0; fi
  done
  return 1
}

line "0. 前置检查（零迁移 / 零新增依赖 / 产物齐）"
[ -f dist/web/index.html ] || die "缺 dist/web/index.html（先 npm run build）"
[ -f dist/server/index.js ] || die "缺 dist/server/index.js"
COUNT=$(ls migrations/*.sql | wc -l | tr -d ' ')
[ "$COUNT" = "10" ] || die "migrations 应为 10 个（本阶段零迁移），实际 $COUNT"
DEPS=$(git diff --stat HEAD -- package.json package-lock.json | wc -l | tr -d ' ')
[ "$DEPS" = "0" ] || die "本阶段零新增依赖，但 package.json / package-lock.json 有改动"
echo "  ✅ dist 产物齐、migrations=$COUNT（零迁移）、依赖文件与 HEAD 无 diff（零新增依赖）"

PORT=$(pick_port) || die "8765–8770 全被占用"
BASE="http://127.0.0.1:$PORT"
LAN_IP=$(hostname -I | awk '{print $1}')
LAN_BASE="http://$LAN_IP:$PORT"
AC_DIR=$(mktemp -d /tmp/pm-s71rw2-XXXXXX)
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

line "1. 起临时服务 + 真登录 + 接口层建两条夹具（都不含变量 ⇒ Enter 复制是「直接复制 + 记一次取用」）"
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
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as err:
        return err.code, json.loads(err.read() or b'null')

ids = {}
for title, body in [('审视甲', '正文甲'), ('审视乙', '正文乙')]:
    status, created = call('POST', '/api/prompts', {'title': title, 'user_prompt': body})
    assert status == 201, (status, created)
    ids[title] = created['id']
    status, got = call('GET', f"/api/prompts/{created['id']}")
    assert status == 200 and got['use_count'] == 0, (status, got)
    print(f"  夹具：{title}=#{created['id']}（use_count=0，无变量）")
with open(f'{ac_dir}/ids.json', 'w') as fh:
    json.dump(ids, fh)
PY
JIA=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["审视甲"])' "$AC_DIR/ids.json")
YI=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["审视乙"])' "$AC_DIR/ids.json")
echo "  甲=#$JIA  乙=#$YI"

line "2. 真浏览器计划：PC 1440×900 DPR2 + 移动 440×956 DPR3"
CHROME=$(node tools/acceptance/lib/chrome.mjs)
[ -n "$CHROME" ] || die "找不到 chrome-headless-shell"
OUT_ABS="$ROOT/$OUT_DIR"
DUMP_ABS="$ROOT/$DUMP_DIR"

python3 - "$LAN_BASE" "$LAN_IP" "$SID" "$CHROME" "$OUT_ABS" "$DUMP_ABS" "$PLAN_PC" "$PLAN_MOBILE" \
  "$TYPED" <<'PY' || die "计划生成失败"
import json, sys

base, lan_ip, sid, chrome, out_dir, dumps_dir, plan_pc, plan_mobile, typed = sys.argv[1:10]

OVERFLOW = "(() => document.documentElement.scrollWidth > window.innerWidth ? 'overflow' : 'none')()"
VIEWPORT = "`${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio}`"
# 分栏里被高亮的那条（SplitView 的 data-selected 就是界面上的"当前项"）
SELECTED = "document.querySelector('[data-testid=pm-split-item][data-selected=true]')?.innerText ?? '(none)'"
# 确认弹窗（FR-152）在不在
CONFIRM = "document.querySelector('[data-testid=pm-unsaved-confirm]') !== null"
# 编辑器输入框当前值（卸载后 = '(editor gone)'）
EDITOR = "document.querySelector('[data-testid=editor-user-prompt]')?.value ?? '(editor gone)'"
# 焦点从输入框移开：M1 的场景是"焦点不在输入框时按快捷键"（在 textarea 里按键本来就该交给控件）
BLUR = "(() => { const a = document.activeElement; if (a instanceof HTMLElement) a.blur(); return 'blurred'; })()"
TOAST_LAST = "[...document.querySelectorAll('.ant-message-notice')].map((n) => n.innerText).slice(-1)[0] ?? 'no-toast'"
LIST_COUNT = "document.querySelectorAll('[data-testid=pm-split-item]').length"
# PC 上搜索框是 autoFocus（UseView `autoFocus={!isMobile}`）⇒ 焦点在输入框时按键交还控件（FR-152 的 typing 闸门）。
# 真用户要按 ↑↓/Enter 之前会先点一行 —— 这一步同时把焦点移回 body。
ACTIVE = "document.activeElement?.tagName ?? 'none'"
SECOND_ITEM = '[data-testid=pm-split-list] > [data-testid=pm-split-item]:nth-child(2)'


def plan(name, width, height, dpr, actions, storage):
    return {
        'name': name, 'path': '/', 'width': width, 'height': height, 'dpr': dpr, 'auth': True,
        'storage': storage,
        'waitFor': '[data-testid=pm-search-input]',
        'actions': actions,
        'dump': name,
    }


pc_actions = [
    {'type': 'probe', 'name': 'p-viewport', 'expression': VIEWPORT},
    {'type': 'wait', 'selector': '[data-testid=pm-split-item]'},
    {'type': 'sleep', 'ms': 1200},
    # M2 现场：先点第二行（甲）—— 界面高亮/右栏都是甲，但 activeIndex 仍是 0（默认第一条=乙）。
    # 修复前 Enter 取的是 list[activeIndex]=乙（用户看不见的那条）⇒ 复制错 + 记一次假取用。
    {'type': 'probe', 'name': 'p-selected-before', 'expression': SELECTED},
    {'type': 'mouseclick', 'selector': SECOND_ITEM},
    {'type': 'sleep', 'ms': 400},
    {'type': 'probe', 'name': 'p-selected-clicked', 'expression': SELECTED},
    {'type': 'probe', 'name': 'p-active-element', 'expression': ACTIVE},
    # M2 ①：↑↓ 必须让高亮跟着动（修复前按了没有任何反馈）
    {'type': 'key', 'key': 'ArrowUp', 'keyCode': 38},
    {'type': 'sleep', 'ms': 300},
    {'type': 'probe', 'name': 'p-selected-after-up', 'expression': SELECTED},
    {'type': 'key', 'key': 'ArrowDown', 'keyCode': 40},
    {'type': 'sleep', 'ms': 300},
    {'type': 'probe', 'name': 'p-selected-after-down', 'expression': SELECTED},
    # M2 ②：Enter 复制界面显示的那条（甲）—— 接口层 use_count 对账在脚本第 4 步
    {'type': 'probe', 'name': 'p-selected-for-enter', 'expression': SELECTED},
    {'type': 'key', 'key': 'Enter', 'keyCode': 13},
    {'type': 'sleep', 'ms': 800},
    {'type': 'probe', 'name': 'p-toast', 'expression': TOAST_LAST},
    # M1 ①：Ctrl+K（焦点移开输入框）⇒ 必须弹确认、内容还在
    {'type': 'mouseclick', 'selector': '[data-testid=pm-detail-edit]'},
    {'type': 'wait', 'selector': '[data-testid=editor-user-prompt]'},
    {'type': 'type', 'selector': '[data-testid=editor-user-prompt]', 'text': typed},
    {'type': 'sleep', 'ms': 300},
    {'type': 'probe', 'name': 'p-editor-value', 'expression': EDITOR},
    {'type': 'eval', 'expression': BLUR},
    {'type': 'key', 'key': 'k', 'keyCode': 75, 'modifiers': 2},
    {'type': 'sleep', 'ms': 500},
    {'type': 'probe', 'name': 'p-confirm-after-ctrlk', 'expression': CONFIRM},
    {'type': 'probe', 'name': 'p-editor-after-ctrlk', 'expression': EDITOR},
    # 「继续编辑」⇒ 内容还在、弹窗关掉
    {'type': 'mouseclick', 'selector': '[data-testid=pm-unsaved-keep]'},
    {'type': 'sleep', 'ms': 500},
    {'type': 'probe', 'name': 'p-confirm-after-keep', 'expression': CONFIRM},
    {'type': 'probe', 'name': 'p-editor-after-keep', 'expression': EDITOR},
    # 再来一次，这次「放弃修改」⇒ 才离开编辑器、回列表
    {'type': 'eval', 'expression': BLUR},
    {'type': 'key', 'key': 'k', 'keyCode': 75, 'modifiers': 2},
    {'type': 'sleep', 'ms': 500},
    {'type': 'mouseclick', 'selector': '[data-testid=pm-unsaved-discard]'},
    {'type': 'sleep', 'ms': 800},
    {'type': 'probe', 'name': 'p-editor-after-discard', 'expression': EDITOR},
    {'type': 'probe', 'name': 'p-list-after-discard', 'expression': LIST_COUNT},
    {'type': 'probe', 'name': 'p-overflow', 'expression': OVERFLOW},
    # 收尾再走一遍 Ctrl+K，把截图停在"确认框开着"的那一帧（图与文件名对得上）
    {'type': 'mouseclick', 'selector': '[data-testid=pm-detail-edit]'},
    {'type': 'wait', 'selector': '[data-testid=editor-user-prompt]'},
    {'type': 'type', 'selector': '[data-testid=editor-user-prompt]', 'text': typed},
    {'type': 'sleep', 'ms': 300},
    {'type': 'eval', 'expression': BLUR},
    {'type': 'key', 'key': 'k', 'keyCode': 75, 'modifiers': 2},
    {'type': 'sleep', 'ms': 600},
    {'type': 'probe', 'name': 'p-confirm-for-shot', 'expression': CONFIRM},
]

mobile_actions = [
    {'type': 'probe', 'name': 'm-viewport', 'expression': VIEWPORT},
    {'type': 'wait', 'selector': '[data-testid=pm-split-item]'},
    {'type': 'sleep', 'ms': 1200},
    {'type': 'mouseclick', 'selector': '[data-testid=pm-split-item]'},
    {'type': 'wait', 'selector': '[data-testid=pm-detail-edit]'},
    # 等详情 Drawer 动画落定再点（AGENTS.md：动画中途量到的坐标是半途值）
    {'type': 'sleep', 'ms': 800},
    {'type': 'mouseclick', 'selector': '[data-testid=pm-detail-edit]'},
    {'type': 'wait', 'selector': '[data-testid=editor-user-prompt]'},
    {'type': 'type', 'selector': '[data-testid=editor-user-prompt]', 'text': typed},
    {'type': 'sleep', 'ms': 300},
    {'type': 'eval', 'expression': BLUR},
    # 移动端编辑器是 Drawer：`view` 仍是 list，但 `editorOpen` 为真 —— `/` 也必须过闸门
    {'type': 'key', 'key': '/', 'keyCode': 191},
    {'type': 'sleep', 'ms': 500},
    {'type': 'probe', 'name': 'm-confirm', 'expression': CONFIRM},
    {'type': 'probe', 'name': 'm-editor-value', 'expression': EDITOR},
    {'type': 'probe', 'name': 'm-overflow', 'expression': OVERFLOW},
]

pc = plan('71rw2-pc-ctrlk-confirm', 1440, 900, 2, pc_actions,
          {'pm-view-mode': 'split', 'pm-theme': 'light'})
mobile = plan('71rw2-mobile-drawer-confirm', 440, 956, 3, mobile_actions,
              {'pm-view-mode': 'split', 'pm-theme': 'light'})


def write(path, shots):
    json.dump({'chrome': chrome, 'baseUrl': base,
               'cookie': {'name': 'pm_sid', 'value': sid, 'domain': lan_ip},
               'outDir': out_dir, 'dumpsDir': dumps_dir, 'shots': shots},
              open(path, 'w', encoding='utf-8'), ensure_ascii=False)


write(plan_pc, [pc])
write(plan_mobile, [mobile])
print("  两份计划已生成（PC 1440x900 dpr=2；移动 440x956 dpr=3）")
PY

: > "$DUMP_DIR/probes.txt"
for P in "$PLAN_PC" "$PLAN_MOBILE"; do
  echo "--- $(basename "$P") ---"
  PLAN_OUT=$(node tools/ui-shot.mjs "$P" 2>&1) || { printf '%s\n' "$PLAN_OUT" | tail -30; die "ui-shot 失败：$P"; }
  printf '%s\n' "$PLAN_OUT" | grep -E '^(SHOT|PROBE|ANT_CLASSES)'
  printf '%s\n' "$PLAN_OUT" >> "$DUMP_DIR/probes.txt"
done

line "3. 探针断言（M1 过闸门 / M2 反馈 / 双端无横向滚动）"
probe_value() {
  python3 - "$DUMP_DIR/probes.txt" "$1" <<'PY'
import json, sys
path, key = sys.argv[1], sys.argv[2]
value = None
for line in open(path, encoding='utf-8'):
    if line.startswith('PROBE ' + key + ' '):
        value = line[len('PROBE ' + key + ' '):].strip()
if value is None:
    raise SystemExit(f'缺探针 {key}')
try:
    parsed = json.loads(value)
except json.JSONDecodeError:
    print(value)
else:
    print(parsed if isinstance(parsed, str) else json.dumps(parsed, ensure_ascii=False))
PY
}
assert_probe() {
  key="$1"; mode="$2"; want="${3:-}"
  got=$(probe_value "$key") || die "$key 没采到"
  case "$mode" in
    eq) [ "$got" = "$want" ] || die "探针 $key 应等于「$want」，实际「$got」" ;;
    has) case "$got" in *"$want"*) ;; *) die "探针 $key 应包含「$want」，实际「$got」" ;; esac ;;
    not) case "$got" in *"$want"*) die "探针 $key 不应包含「$want」，实际「$got」" ;; esac ;;
  esac
  echo "  ✅ $key（$mode $want）"
}

assert_probe p-viewport eq '1440x900@2'
assert_probe m-viewport eq '440x956@3'
# M2：默认高亮第一条（乙）→ 点第二行（甲）→ ↑ 回乙 → ↓ 回甲 ⇒ 高亮必须跟着动；
# 然后 Enter 必须复制界面显示的那条（甲）
assert_probe p-selected-before has '审视乙'
assert_probe p-selected-clicked has '审视甲'
assert_probe p-active-element eq 'BODY'
assert_probe p-selected-after-up has '审视乙'
assert_probe p-selected-after-down has '审视甲'
assert_probe p-selected-for-enter has '审视甲'
assert_probe p-toast has '已复制'
# M1 ①：Ctrl+K ⇒ 弹确认、内容还在；「继续编辑」⇒ 内容还在；「放弃修改」⇒ 才离开
assert_probe p-editor-value has '改了一半还没保存'
assert_probe p-confirm-after-ctrlk eq 'true'
assert_probe p-editor-after-ctrlk has '改了一半还没保存'
assert_probe p-confirm-after-keep eq 'false'
assert_probe p-editor-after-keep has '改了一半还没保存'
assert_probe p-editor-after-discard eq '(editor gone)'
assert_probe p-list-after-discard eq '2'
assert_probe p-confirm-for-shot eq 'true'
# 移动端 Drawer：`/` 同样过闸门
assert_probe m-confirm eq 'true'
assert_probe m-editor-value has '改了一半还没保存'
# 双端无页面级横向滚动
assert_probe p-overflow eq 'none'
assert_probe m-overflow eq 'none'

line "4. M2 接口层对账：Enter 复制的是界面显示的那条（甲 +1、乙仍 0，不许记假取用）"
USE_JIA=$(curl -s -H "cookie: pm_sid=$SID" "$BASE/api/prompts/$JIA" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["use_count"])')
USE_YI=$(curl -s -H "cookie: pm_sid=$SID" "$BASE/api/prompts/$YI" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["use_count"])')
printf '  use_count：甲(#%s)=%s  乙(#%s)=%s\n' "$JIA" "$USE_JIA" "$YI" "$USE_YI"
[ "$USE_JIA" = "1" ] || die "Enter 应当给界面显示的那条（甲）记 1 次取用，实际 $USE_JIA"
[ "$USE_YI" = "0" ] || die "乙没有被复制，use_count 必须仍为 0（假取用回归），实际 $USE_YI"
echo "  ✅ 甲 +1、乙仍 0（修复前 Enter 取 list[activeIndex]=乙 ⇒ 复制错条 + 给乙记一次假取用）"

line "5. 截图与产物落点"
ls -1 "$ROOT/$OUT_DIR" | sed 's/^/  /'
echo "  dumps: $DUMP_DIR（DOM 快照 + probes.txt）"

line "✅ ALL STAGE71-REWORK2 ACCEPTANCE CHECKS PASSED"
