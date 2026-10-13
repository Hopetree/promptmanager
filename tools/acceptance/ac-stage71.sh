#!/usr/bin/env bash
# 阶段 71 端到端验收（交付态，随仓库入库）：前端时序与数据保护（FR-151 ~ FR-154 / AC-133）
#
# 验的是什么（本阶段动的是"加载 / 状态 / 交互时序"，必须真浏览器自证）：
#   1) D15：PC 1440×900 DPR2 / 移动 440×956 DPR3 —— 显式 viewport（含 devicePixelRatio 实测）、
#      截图、两端都无**页面级**横向滚动；
#   2) B7/B8：真键盘事件（CDP 输入管线的 Esc）—— 输入控件里按 Esc 不关编辑器、也不弹确认；
#   3) B6/B9：改了内容 → 点编辑器左栏另一条 → 出现确认且内容仍在；「继续编辑」后仍在编辑器里、
#      「放弃修改」后真的切到那一条；改一半时 `editor-dirty-badge` 出现；
#   4) D14：清空空搜索框后的**防抖窗口内**，空态文案仍按"当前生效的筛选"（不是还没生效的输入）；
#   5) 桌面三栏 / 移动无侧栏（断点单一来源的行为面）。
set -u
cd "$(dirname "$0")/../.."
ROOT="$PWD"

OUT_DIR='tmp/stage71/shots'
DUMP_DIR='tmp/stage71/dumps'
AC_PW='ac-fixture-pw-20260918'
T_JIA='阶段71甲'
T_YI='阶段71乙'
TYPED='我改了一半还没保存'

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
AC_DIR=$(mktemp -d /tmp/pm-s71-XXXXXX)
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

line "1. 起临时服务 + 真登录 + 接口层建两条夹具"
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

python3 - "$BASE" "$SID" "$AC_DIR" "$T_JIA" "$T_YI" <<'PY' || die "接口层不符"
import json, sys, urllib.parse, urllib.request

base, sid, ac_dir, t_jia, t_yi = sys.argv[1:6]

def call(method, path, body=None):
    path = urllib.parse.quote(path, safe='/?&=')
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(base + path, data=data, method=method)
    req.add_header('cookie', 'pm_sid=' + sid)
    if data is not None:
        req.add_header('content-type', 'application/json')
    with urllib.request.urlopen(req) as res:
        return res.status, json.loads(res.read().decode() or 'null')

ids = {}
for title, body in ((t_jia, '正文甲 {{名字 | default(甲)}}'), (t_yi, '正文乙')):
    status, created = call('POST', '/api/prompts', {'title': title, 'user_prompt': body})
    assert status == 201, (status, created)
    ids[title] = created['id']
with open(f'{ac_dir}/ids.json', 'w') as fh:
    json.dump(ids, fh)
print(f"  夹具：{t_jia}=#{ids[t_jia]}，{t_yi}=#{ids[t_yi]}")

status, listed = call('GET', '/api/prompts?limit=50')
assert status == 200 and listed['total'] == 2, (status, listed)
print(f"  列表 total={listed['total']}（本阶段未改 GET /api/prompts 的返回结构与分页语义）")
PY

line "2. 真浏览器计划：PC 1440×900 DPR2（编辑保护）+ 移动 440×956 DPR3（断点/空态）"
CHROME=$(ls -d /root/.cache/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell 2>/dev/null | sort | tail -1)
[ -n "$CHROME" ] || die "找不到 chrome-headless-shell"
OUT_ABS="$ROOT/$OUT_DIR"
DUMP_ABS="$ROOT/$DUMP_DIR"

python3 - "$LAN_BASE" "$LAN_IP" "$SID" "$CHROME" "$OUT_ABS" "$DUMP_ABS" "$PLAN_PC" "$PLAN_MOBILE" \
  "$AC_DIR/ids.json" "$TYPED" <<'PY' || die "计划生成失败"
import json, sys

base, lan_ip, sid, chrome, out_dir, dumps_dir, plan_pc, plan_mobile, ids_file, typed = sys.argv[1:11]
ids = json.load(open(ids_file))
jia_id, yi_id = int(ids['阶段71甲']), int(ids['阶段71乙'])
yid = f'{jia_id:03d}'

OVERFLOW = "(() => document.documentElement.scrollWidth > window.innerWidth ? 'overflow' : 'none')()"
VIEWPORT = "`${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio}`"
DETAIL_TEXT = "document.querySelector('[data-testid=pm-detail-text]')?.innerText ?? 'no-node'"
PLAIN = ("(() => { const b = document.querySelector('[data-testid=pm-detail-plain]');"
         " if (!b) return 'no-toggle'; b.click(); return 'plain'; })()")
# 编辑器头部同时渲染 `#id` 与 `vN`（都用 .pm-mono）⇒ 取以 '#' 开头的那一个
EDITOR_ID = ("[...document.querySelectorAll('[data-testid=pm-editor] .pm-mono')]"
             ".map((n) => n.innerText).find((t) => t.startsWith('#')) ?? 'no-editor'")
EDITOR_VALUE = "document.querySelector('[data-testid=editor-user-prompt]')?.value ?? 'NO-EDITOR'"
EDITOR_OPEN = "document.querySelector('[data-testid=editor-user-prompt]') !== null"
HAS_CONFIRM = "document.querySelector('[data-testid=pm-unsaved-confirm]') !== null"
HAS_BADGE = "document.querySelector('[data-testid=editor-dirty-badge]') !== null"
EDITOR_TITLE = "document.querySelector('[data-testid=editor-title]')?.value ?? 'NO-EDITOR'"
KEEP_OPEN = ("document.querySelector('[data-testid=editor-user-prompt]') !== null"
             " && document.querySelector('[data-testid=pm-unsaved-confirm]') === null")
SIDER = "document.querySelectorAll('.ant-layout-sider').length > 0"

def pick(prefix, label):
    """点分栏左栏里含指定标题的那一条（真按钮，走 onSelect → openDetail）。"""
    return {'type': 'eval', 'expression': (
        "(() => { const items = [...document.querySelectorAll('[data-testid=pm-split-item]')];"
        f" const t = items.find((n) => n.innerText.includes({json.dumps(label)}));"
        " if (!t) return 'no-item'; t.click(); return 'clicked'; })()")}

SET_INPUT = ("(() => { const el = document.querySelector('[data-testid=pm-search-input]');"
             " if (!el) return 'no-input';"
             " const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;"
             " setter.call(el, %s); el.dispatchEvent(new Event('input', { bubbles: true })); return 'set'; })()")

shot_pc = {
    'name': '71-pc-unsaved-guard', 'path': '/', 'width': 1440, 'height': 900, 'dpr': 2, 'auth': True,
    'storage': {'pm-view-mode': 'split', 'pm-theme': 'light'},
    'waitFor': '[data-testid=pm-search-input]',
    'actions': [
        {'type': 'probe', 'name': 'p-viewport', 'expression': VIEWPORT},
        {'type': 'probe', 'name': 'p-sider', 'expression': SIDER},
        pick('p', '阶段71甲'),
        {'type': 'sleep', 'ms': 900},
        {'type': 'eval', 'expression': PLAIN},
        {'type': 'sleep', 'ms': 200},
        {'type': 'probe', 'name': 'p-detail-text', 'expression': DETAIL_TEXT},
        {'type': 'click', 'selector': '[data-testid=pm-detail-edit]'},
        {'type': 'wait', 'selector': '[data-testid=editor-user-prompt]'},
        {'type': 'probe', 'name': 'p-editor-id', 'expression': EDITOR_ID},
        # B6/B9：改一半 —— 徽标必须出现
        {'type': 'type', 'selector': '[data-testid=editor-user-prompt]', 'text': typed},
        {'type': 'sleep', 'ms': 400},
        {'type': 'probe', 'name': 'p-editor-value', 'expression': EDITOR_VALUE},
        {'type': 'probe', 'name': 'p-dirty-badge', 'expression': HAS_BADGE},
        # B8：焦点还在输入控件里 ⇒ Esc 必须交还给控件（不关编辑器、不弹确认）
        {'type': 'key', 'key': 'Escape', 'keyCode': 27},
        {'type': 'sleep', 'ms': 400},
        {'type': 'probe', 'name': 'p-esc-editor-open', 'expression': EDITOR_OPEN},
        {'type': 'probe', 'name': 'p-esc-no-confirm', 'expression': "!document.querySelector('[data-testid=pm-unsaved-confirm]')"},
        # B6/B7：编辑器左栏切到另一条 ⇒ 出现确认，内容仍在
        {'type': 'click', 'selector': f'[data-testid=pm-editor-list-item-{yi_id}]'},
        {'type': 'sleep', 'ms': 700},
        {'type': 'probe', 'name': 'p-confirm-shown', 'expression': HAS_CONFIRM},
        {'type': 'probe', 'name': 'p-typed-kept', 'expression': EDITOR_VALUE},
        {'type': 'probe', 'name': 'p-overflow-confirm', 'expression': OVERFLOW},
        {'type': 'probe', 'name': 'p-viewport-2', 'expression': VIEWPORT},
        # 「继续编辑」不是死路：确认关掉、编辑器与内容都在
        {'type': 'click', 'selector': '[data-testid=pm-unsaved-keep]'},
        {'type': 'sleep', 'ms': 400},
        {'type': 'probe', 'name': 'p-keep-open', 'expression': KEEP_OPEN},
        # 再来一次，这次「放弃修改」⇒ 真的切到乙
        {'type': 'click', 'selector': f'[data-testid=pm-editor-list-item-{yi_id}]'},
        {'type': 'sleep', 'ms': 500},
        {'type': 'click', 'selector': '[data-testid=pm-unsaved-discard]'},
        {'type': 'sleep', 'ms': 800},
        {'type': 'probe', 'name': 'p-title-after-discard', 'expression': EDITOR_TITLE},
        {'type': 'probe', 'name': 'p-overflow', 'expression': OVERFLOW},
    ],
    'dump': '71-pc-unsaved-guard', 'settleMs': 600,
}

shot_pc_confirm = {
    'name': '71-pc-unsaved-confirm', 'path': '/', 'width': 1440, 'height': 900, 'dpr': 2, 'auth': True,
    'storage': {'pm-view-mode': 'split', 'pm-theme': 'light'},
    'waitFor': '[data-testid=pm-search-input]',
    'actions': [
        pick('p', '阶段71甲'),
        {'type': 'sleep', 'ms': 900},
        {'type': 'click', 'selector': '[data-testid=pm-detail-edit]'},
        {'type': 'wait', 'selector': '[data-testid=editor-user-prompt]'},
        {'type': 'type', 'selector': '[data-testid=editor-user-prompt]', 'text': typed},
        {'type': 'sleep', 'ms': 500},
        # 切到另一条 ⇒ 确认弹窗必须出现（这一张截图就是 FR-152 / AC-133 B6 的视觉证据）
        {'type': 'click', 'selector': f'[data-testid=pm-editor-list-item-{yi_id}]'},
        {'type': 'sleep', 'ms': 700},
        {'type': 'probe', 'name': 'pc-confirm-editor-id', 'expression': EDITOR_ID},
        {'type': 'probe', 'name': 'pc-confirm-dialog', 'expression': HAS_CONFIRM},
        {'type': 'probe', 'name': 'pc-confirm-typed-kept', 'expression': EDITOR_VALUE},
        {'type': 'probe', 'name': 'pc-confirm-overflow', 'expression': OVERFLOW},
    ],
    'dump': '71-pc-unsaved-confirm', 'settleMs': 400,
}

EMPTY_HAS_FILTER = "document.body.innerText.includes('没有匹配的条目')"
EMPTY_IS_FRESH = "document.body.innerText.includes('还没有可用的 prompt')"
CARDS = "document.querySelectorAll('[data-testid=pm-use-card]').length"
# 防抖落地后：筛选真的空了 ⇒ 列表回到 2 条卡片，空态消失
EMPTY_SETTLED = EMPTY_HAS_FILTER + " === false && " + CARDS + " === 2"

shot_mobile = {
    'name': '71-mobile-filter-empty', 'path': '/', 'width': 440, 'height': 956, 'dpr': 3, 'auth': True,
    'storage': {'pm-view-mode': 'card', 'pm-theme': 'light'},
    'waitFor': '[data-testid=pm-search-input]',
    'actions': [
        {'type': 'probe', 'name': 'm-viewport', 'expression': VIEWPORT},
        {'type': 'probe', 'name': 'm-sider', 'expression': SIDER},
        {'type': 'probe', 'name': 'm-overflow', 'expression': OVERFLOW},
        # D14：搜不到东西 → 空态标题必须是"没有匹配的条目"
        {'type': 'eval', 'expression': SET_INPUT % json.dumps('zzzz')},
        {'type': 'sleep', 'ms': 900},
        {'type': 'probe', 'name': 'm-empty-filtered', 'expression': EMPTY_HAS_FILTER},
        # 清空输入 → **防抖窗口内**（生效筛选仍是 zzzz）不许说"还没有可用的 prompt"
        {'type': 'eval', 'expression': SET_INPUT % json.dumps('')},
        {'type': 'sleep', 'ms': 120},
        {'type': 'probe', 'name': 'm-empty-debounce-fresh', 'expression': EMPTY_IS_FRESH},
        {'type': 'probe', 'name': 'm-empty-debounce-filtered', 'expression': EMPTY_HAS_FILTER},
        # 防抖落地后：生效筛选为空 ⇒ 列表回到 2 条卡片，空态消失（不是"文案改口"）
        {'type': 'sleep', 'ms': 900},
        {'type': 'probe', 'name': 'm-empty-settled', 'expression': EMPTY_SETTLED},
        # 回到有结果的筛选，给移动端截图留一张真实列表
        {'type': 'eval', 'expression': SET_INPUT % json.dumps('阶段71')},
        {'type': 'sleep', 'ms': 900},
        {'type': 'probe', 'name': 'm-cards', 'expression': CARDS},
        {'type': 'probe', 'name': 'm-overflow-final', 'expression': OVERFLOW},
        {'type': 'probe', 'name': 'm-viewport-final', 'expression': VIEWPORT},
    ],
    'dump': '71-mobile-filter-empty', 'settleMs': 600,
}

def write(path, shots):
    json.dump({'chrome': chrome, 'baseUrl': base,
               'cookie': {'name': 'pm_sid', 'value': sid, 'domain': lan_ip},
               'outDir': out_dir, 'dumpsDir': dumps_dir, 'shots': shots},
              open(path, 'w', encoding='utf-8'), ensure_ascii=False)

write(plan_pc, [shot_pc, shot_pc_confirm])
write(plan_mobile, [shot_mobile])
print(f"  两份计划已生成（PC 2 shot dpr=2 + 移动 1 shot dpr=3）；甲=#{jia_id} 乙=#{yi_id}")
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

# D15：显式 viewport（含 DPR 实测）
assert_probe p-viewport '1440x900@2' eq
assert_probe p-viewport-2 '1440x900@2' eq
assert_probe m-viewport '440x956@3' eq
assert_probe m-viewport-final '440x956@3' eq
# 无页面级横向滚动（两端；确认弹窗打开时也查一次）
assert_probe p-overflow 'none' eq
assert_probe p-overflow-confirm 'none' eq
assert_probe m-overflow 'none' eq
assert_probe m-overflow-final 'none' eq
# 断点单一来源的行为面：桌面有侧栏、移动没有
assert_probe p-sider 'true' eq
assert_probe m-sider 'false' eq
# FR-151 ②/B6/B7/B8/B9
assert_probe p-editor-id "$(printf '#%03d' "$(python3 -c "import json;print(json.load(open('$AC_DIR/ids.json'))['阶段71甲'])")")" eq
assert_probe p-editor-value "$TYPED" has
assert_probe p-dirty-badge 'true' eq
assert_probe p-esc-editor-open 'true' eq
assert_probe p-esc-no-confirm 'true' eq
assert_probe p-confirm-shown 'true' eq
assert_probe p-typed-kept "$TYPED" has
assert_probe p-keep-open 'true' eq
assert_probe p-title-after-discard "$T_YI" eq
# 确认弹窗的视觉证据那一张：弹窗在、编辑器还停在甲、改的内容还在
assert_probe pc-confirm-dialog 'true' eq
assert_probe pc-confirm-editor-id "$(printf '#%03d' "$(python3 -c "import json;print(json.load(open('$AC_DIR/ids.json'))['阶段71甲'])")")" eq
assert_probe pc-confirm-typed-kept "$TYPED" has
assert_probe pc-confirm-overflow 'none' eq
# D14：空态文案与**当前生效**筛选同源（防抖窗口内不许提前改口）
assert_probe m-empty-filtered 'true' eq
assert_probe m-empty-debounce-fresh 'false' eq
assert_probe m-empty-debounce-filtered 'true' eq
assert_probe m-empty-settled 'true' eq
assert_probe m-cards '2' eq

line "4. 截图与产物落点"
ls -1 "$ROOT/$OUT_DIR" | sed 's/^/  /'
echo "  dumps: $DUMP_DIR（DOM 快照 + probes.txt）"

line "✅ ALL STAGE71 ACCEPTANCE CHECKS PASSED"
