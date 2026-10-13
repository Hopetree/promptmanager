#!/usr/bin/env bash
# 阶段 74 端到端验收（交付态，随仓库入库）：复制源码（模板原文）—— FR-165 / AC-136
#
# 验的是什么（本阶段动界面 ⇒ 双端真浏览器自证 + 全量复跑）：
#   位置与等级（① ②）：详情页新入口在**正文区工具行**（`pm-detail-fields`）、**不在**底部主操作条
#                       （`pm-detail-actions`），且不是 `ant-btn-primary`（对照：「复制提示词」是 primary）
#   内容与零网络（③ ④ ⑧）：点它**不发任何请求**（真浏览器里给 `window.fetch` 打桩计数，点击前后不变）
#   不计取用（⑦）：复制源码前后 `use_count` 不变（界面「取用 N 次」+ 接口 `GET /api/prompts/:id` 双证）
#   编辑器（⑥）：`editor-copy-user` 带可见文字「复制源码」，零请求
#   双端（⑫）：PC 1440×900 DPR2 / 移动 440×956 DPR3 两视口都有该入口、无页面级横向滚动
#   通用：零迁移（migrations 仍 10）、零新增依赖（package.json / lock 与 HEAD 无 diff）
set -u
cd "$(dirname "$0")/../.."
ROOT="$PWD"

OUT_DIR='tmp/stage74/shots'
DUMP_DIR='tmp/stage74/dumps'
AC_PW='ac-fixture-pw-20260918'
TITLE='阶段74甲'
USER_SRC='正文甲 {{名字 | default(甲)}}'
SYS_SRC='你是{{角色}}助手'
TYPED='改了一半 {{名字}}'

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
AC_DIR=$(mktemp -d /tmp/pm-s74-XXXXXX)
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

line "1. 起临时服务 + 真登录 + 接口层建夹具（含变量的提示词，系统提示词也带变量）"
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

python3 - "$BASE" "$SID" "$AC_DIR" "$TITLE" "$USER_SRC" "$SYS_SRC" <<'PY' || die "接口层不符"
import json, sys, urllib.parse, urllib.request

base, sid, ac_dir, title, user_src, sys_src = sys.argv[1:7]

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

status, created = call('POST', '/api/prompts', {'title': title, 'user_prompt': user_src, 'system_prompt': sys_src})
assert status == 201, (status, created)
pid = created['id']
status, before = call('GET', f'/api/prompts/{pid}')
assert status == 200 and before['use_count'] == 0, (status, before)
with open(f'{ac_dir}/ids.json', 'w') as fh:
    json.dump({'id': pid}, fh)
print(f"  夹具：{title}=#{pid}；user_prompt={before['user_prompt']!r}；system_prompt={before['system_prompt']!r}")
print(f"  use_count（复制源码之前）= {before['use_count']}")
PY
PID=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["id"])' "$AC_DIR/ids.json")

line "2. 真浏览器计划：PC 1440×900 DPR2 + 移动 440×956 DPR3（详情正文区工具行 + 编辑器）"
CHROME=$(ls -d /root/.cache/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell 2>/dev/null | sort | tail -1)
[ -n "$CHROME" ] || die "找不到 chrome-headless-shell"
OUT_ABS="$ROOT/$OUT_DIR"
DUMP_ABS="$ROOT/$DUMP_DIR"

python3 - "$LAN_BASE" "$LAN_IP" "$SID" "$CHROME" "$OUT_ABS" "$DUMP_ABS" "$PLAN_PC" "$PLAN_MOBILE" \
  "$TYPED" <<'PY' || die "计划生成失败"
import json, sys

base, lan_ip, sid, chrome, out_dir, dumps_dir, plan_pc, plan_mobile, typed = sys.argv[1:10]

OVERFLOW = "(() => document.documentElement.scrollWidth > window.innerWidth ? 'overflow' : 'none')()"
VIEWPORT = "`${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio}`"
SRC = "document.querySelector('[data-testid=pm-detail-copy-source]')"
IN_FIELDS = f"({SRC}?.closest('[data-testid=pm-detail-fields]') ?? null) !== null"
IN_ACTIONS = f"({SRC}?.closest('[data-testid=pm-detail-actions]') ?? null) !== null"
SRC_PRIMARY = f"({SRC}?.classList.contains('ant-btn-primary') ?? null)"
COPY_PRIMARY = "document.querySelector('[data-testid=pm-detail-copy]')?.classList.contains('ant-btn-primary') ?? null"
SRC_TEXT = f"{SRC}?.innerText ?? 'no-button'"
USE_COUNT = "(document.querySelector('[data-testid=pm-detail-head]')?.innerText.match(/取用 (\\d+) 次/) ?? [])[1] ?? 'none'"
TOASTS = "[...document.querySelectorAll('.ant-message-notice')].map((n) => n.innerText).join('|') || 'no-toast'"
# 给 fetch 打桩计数：证明「复制源码」零网络（AC-136 ⑧）
PATCH_FETCH = (
    "window.__pmFetchCount = 0; window.__pmFetchUrls = [];"
    "if (!window.__pmFetchPatched) { window.__pmFetchPatched = true;"
    " const orig = window.fetch; window.fetch = (...args) => { window.__pmFetchCount += 1;"
    " window.__pmFetchUrls.push(String(args[0])); return orig(...args); }; }"
    "'patched'"
)
FETCH_COUNT = "window.__pmFetchCount"
FETCH_URLS = "JSON.stringify(window.__pmFetchUrls)"
# 切到「系统提示词」页签（Segmented 项按文字找）
PICK_SYSTEM = (
    "(() => { const items = [...document.querySelectorAll('.ant-segmented-item')];"
    " const t = items.find((n) => n.innerText.includes('系统提示词'));"
    " if (!t) return 'no-tab'; t.click(); return 'ok'; })()"
)
EDITOR_SRC_TEXT = "document.querySelector('[data-testid=editor-copy-user]')?.innerText ?? 'no-button'"
TOAST_LAST = "[...document.querySelectorAll('.ant-message-notice')].map((n) => n.innerText).slice(-1)[0] ?? 'no-toast'"


def plan(name, width, height, dpr, prefix, actions, storage):
    return {
        'name': name, 'path': '/', 'width': width, 'height': height, 'dpr': dpr, 'auth': True,
        'storage': storage,
        'waitFor': '[data-testid=pm-search-input]',
        'actions': actions,
        'dump': name,
    }


detail_actions = [
    {'type': 'probe', 'name': 'p-viewport', 'expression': VIEWPORT},
    {'type': 'wait', 'selector': '[data-testid=pm-detail-copy-source]'},
    # ① 位置：正文区工具行里、**不在**底部主操作条
    {'type': 'probe', 'name': 'p-src-in-fields', 'expression': IN_FIELDS},
    {'type': 'probe', 'name': 'p-src-in-actions', 'expression': IN_ACTIONS},
    # ② 等级：新入口不是 primary，而「复制提示词」是 primary（对照）
    {'type': 'probe', 'name': 'p-src-primary', 'expression': SRC_PRIMARY},
    {'type': 'probe', 'name': 'p-copy-primary', 'expression': COPY_PRIMARY},
    {'type': 'probe', 'name': 'p-src-text', 'expression': SRC_TEXT},
    # ⑧ 零网络：先打桩 → **等页面静止**（右栏版本面板是惰性加载，会在渲染后补几个请求）
    #    → 记基线 → 点 → 再记 —— 差值才是"这一次点击产生的请求"，必须是 0。
    {'type': 'eval', 'expression': PATCH_FETCH},
    {'type': 'sleep', 'ms': 1200},
    {'type': 'probe', 'name': 'p-fetch-before', 'expression': FETCH_COUNT},
    {'type': 'probe', 'name': 'p-fetch-urls-before', 'expression': FETCH_URLS},
    {'type': 'probe', 'name': 'p-use-before', 'expression': USE_COUNT},
    {'type': 'mouseclick', 'selector': '[data-testid=pm-detail-copy-source]'},
    {'type': 'sleep', 'ms': 700},
    {'type': 'probe', 'name': 'p-toast', 'expression': TOASTS},
    {'type': 'probe', 'name': 'p-fetch-after', 'expression': FETCH_COUNT},
    {'type': 'probe', 'name': 'p-fetch-urls', 'expression': FETCH_URLS},
    {'type': 'probe', 'name': 'p-use-after', 'expression': USE_COUNT},
    # ③ 切「系统提示词」页签后也能复制它的源码（仍零请求）
    {'type': 'eval', 'expression': PICK_SYSTEM},
    {'type': 'sleep', 'ms': 1200},
    {'type': 'probe', 'name': 'p-fetch-before-system', 'expression': FETCH_COUNT},
    {'type': 'mouseclick', 'selector': '[data-testid=pm-detail-copy-source]'},
    {'type': 'sleep', 'ms': 700},
    {'type': 'probe', 'name': 'p-toast-system', 'expression': TOAST_LAST},
    {'type': 'probe', 'name': 'p-fetch-after-system', 'expression': FETCH_COUNT},
    {'type': 'probe', 'name': 'p-fetch-urls-system', 'expression': FETCH_URLS},
    {'type': 'probe', 'name': 'p-overflow', 'expression': OVERFLOW},
]

editor_actions = [
    {'type': 'wait', 'selector': '[data-testid=pm-detail-copy-source]'},
    # ⑥ 编辑器：字段复制入口带可见文字，且点它零请求（同样先等静止）
    {'type': 'mouseclick', 'selector': '[data-testid=pm-detail-edit]'},
    {'type': 'wait', 'selector': '[data-testid=editor-user-prompt]'},
    {'type': 'probe', 'name': 'p-editor-src-text', 'expression': EDITOR_SRC_TEXT},
    {'type': 'type', 'selector': '[data-testid=editor-user-prompt]', 'text': typed},
    {'type': 'probe', 'name': 'p-editor-unsaved', 'expression': "document.querySelector('[data-testid=editor-user-prompt]')?.value ?? 'no-input'"},
    {'type': 'eval', 'expression': PATCH_FETCH},
    {'type': 'sleep', 'ms': 1200},
    {'type': 'probe', 'name': 'p-editor-fetch-before', 'expression': FETCH_COUNT},
    {'type': 'mouseclick', 'selector': '[data-testid=editor-copy-user]'},
    {'type': 'sleep', 'ms': 700},
    {'type': 'probe', 'name': 'p-editor-toast', 'expression': TOAST_LAST},
    {'type': 'probe', 'name': 'p-editor-fetch-after', 'expression': FETCH_COUNT},
    {'type': 'probe', 'name': 'p-editor-fetch-urls', 'expression': FETCH_URLS},
    {'type': 'probe', 'name': 'p-editor-overflow', 'expression': OVERFLOW},
]

mobile_actions = [
    {'type': 'probe', 'name': 'm-viewport', 'expression': VIEWPORT},
    {'type': 'mouseclick', 'selector': '[data-testid=pm-split-item]'},
    {'type': 'wait', 'selector': '[data-testid=pm-detail-copy-source]'},
    # 等惰性预览渲染完再截图（否则正文区还是 Suspense 空白，截图不好读）
    {'type': 'sleep', 'ms': 1200},
    {'type': 'probe', 'name': 'm-src-in-fields', 'expression': IN_FIELDS},
    {'type': 'probe', 'name': 'm-src-in-actions', 'expression': IN_ACTIONS},
    {'type': 'probe', 'name': 'm-src-text', 'expression': SRC_TEXT},
    {'type': 'probe', 'name': 'm-overflow', 'expression': OVERFLOW},
]

pc_detail = plan('74-pc-detail-copy-source', 1440, 900, 2, 'p-', detail_actions,
                 {'pm-view-mode': 'split', 'pm-theme': 'light'})
pc_editor = plan('74-pc-editor-copy-source', 1440, 900, 2, 'p-', editor_actions,
                 {'pm-view-mode': 'split', 'pm-theme': 'light'})
mobile = plan('74-mobile-copy-source', 440, 956, 3, 'm-', mobile_actions,
              {'pm-view-mode': 'split', 'pm-theme': 'light'})


def write(path, shots):
    json.dump({'chrome': chrome, 'baseUrl': base,
               'cookie': {'name': 'pm_sid', 'value': sid, 'domain': lan_ip},
               'outDir': out_dir, 'dumpsDir': dumps_dir, 'shots': shots},
              open(path, 'w', encoding='utf-8'), ensure_ascii=False)


write(plan_pc, [pc_detail, pc_editor])
write(plan_mobile, [mobile])
print("  两份计划已生成（PC 详情 + PC 编辑器，均 1440x900 dpr=2；移动 440x956 dpr=3）")
PY

: > "$DUMP_DIR/probes.txt"
for P in "$PLAN_PC" "$PLAN_MOBILE"; do
  echo "--- $(basename "$P") ---"
  PLAN_OUT=$(node tools/ui-shot.mjs "$P" 2>&1) || { printf '%s\n' "$PLAN_OUT" | tail -30; die "ui-shot 失败：$P"; }
  printf '%s\n' "$PLAN_OUT" | grep -E '^(SHOT|PROBE|ANT_CLASSES)'
  printf '%s\n' "$PLAN_OUT" >> "$DUMP_DIR/probes.txt"
done

line "3. 探针断言（位置 / 等级 / 零网络 / 不计取用 / 双端）"
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
    # 字符串原样输出（否则比较时要带引号）；布尔/数字用 JSON 形态（true / false / 3）
    print(parsed if isinstance(parsed, str) else json.dumps(parsed, ensure_ascii=False))
PY
}
assert_same() {
  key_a="$1"; key_b="$2"
  got_a=$(probe_value "$key_a") || die "$key_a 没采到"
  got_b=$(probe_value "$key_b") || die "$key_b 没采到"
  [ "$got_a" = "$got_b" ] || die "探针 $key_a 与 $key_b 应相同（差值必须为 0），实际「$got_a」vs「$got_b」"
  echo "  ✅ $key_a == $key_b（$got_a，本次点击零新增请求）"
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

# ⑫ 显式 viewport（含 DPR 实测）
assert_probe p-viewport eq '1440x900@2'
assert_probe m-viewport eq '440x956@3'
# ① 位置：在正文区工具行、不在底部主操作条
assert_probe p-src-in-fields eq 'true'
assert_probe p-src-in-actions eq 'false'
# ② 等级：新入口不是 primary；「复制提示词」是 primary（对照）
assert_probe p-src-primary eq 'false'
assert_probe p-copy-primary eq 'true'
assert_probe p-src-text has '复制源码'
# ⑧ 零网络：三次点击（详情用户页签 / 详情系统页签 / 编辑器）各自**不新增任何请求**
assert_same p-fetch-after p-fetch-before
assert_same p-fetch-after-system p-fetch-before-system
assert_probe p-toast has '已复制'
assert_probe p-toast-system has '已复制'
# ⑦ 不计取用：界面上的「取用 N 次」前后一致
assert_probe p-use-before eq '0'
assert_probe p-use-after eq '0'
# ⑥ 编辑器入口有可见文字、复制当前编辑框内容、零请求
assert_probe p-editor-src-text has '复制源码'
assert_same p-editor-fetch-after p-editor-fetch-before
assert_probe p-editor-toast has '已复制'
# ⑫ 两端都无页面级横向滚动
assert_probe p-overflow eq 'none'
assert_probe p-editor-overflow eq 'none'
assert_probe p-editor-unsaved has '改了一半 {{名字}}'
assert_probe m-overflow eq 'none'
# ⑫ 移动端也有该入口、位置同口径
assert_probe m-src-in-fields eq 'true'
assert_probe m-src-in-actions eq 'false'
assert_probe m-src-text has '复制源码'

line "4. ⑦ 接口层对账：复制源码前后 use_count 不变（原样输出）"
USE_AFTER=$(curl -s -H "cookie: pm_sid=$SID" "$BASE/api/prompts/$PID" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["use_count"])')
USE_BEFORE=$(python3 - "$AC_DIR" "$BASE" "$SID" "$PID" <<'PY'
import json, sys, urllib.request
ac_dir, base, sid, pid = sys.argv[1:5]
req = urllib.request.Request(f'{base}/api/prompts/{pid}')
req.add_header('cookie', 'pm_sid=' + sid)
with urllib.request.urlopen(req) as resp:
    print(json.load(resp)['use_count'])
PY
)
printf '  use_count 之前 = %s / 之后 = %s\n' "$USE_BEFORE" "$USE_AFTER"
[ "$USE_BEFORE" = "0" ] || die "夹具初始 use_count 应为 0，实际 $USE_BEFORE"
[ "$USE_AFTER" = "0" ] || die "复制源码把 use_count 推高了：$USE_BEFORE → $USE_AFTER"
echo "  ✅ 复制源码（详情两次 + 编辑器一次）之后 use_count 仍为 0（零记账）"

line "5. 截图与产物落点"
ls -1 "$ROOT/$OUT_DIR" | sed 's/^/  /'
echo "  dumps: $DUMP_DIR（DOM 快照 + probes.txt）"

line "✅ ALL STAGE74 ACCEPTANCE CHECKS PASSED"
