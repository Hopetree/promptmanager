#!/usr/bin/env bash
# 阶段 65（FR-136 两个用户可见缺陷 + FR-137 前端状态收敛）一次性验收脚本 —— **交付态，随仓库入库（tools/acceptance/）**。
#
# 判据：`tmp/dev-process/BRIEF.md` 的 FR-136 / FR-137 / AC-127 / D-63 四节。
# 做法：① 源码级：四个旧 setter 名归零、`setData` 消失、无手写 merge、渲染级测试网与 tsconfig 三件齐备、
#          没有引入状态管理库；`Workspace.tsx` 行数 < 941（收敛前 941 行 / 41 次 setter）；
#       ② 零迁移：`migrations/` 仍 8 个、不存在 `009_*.sql`（FR-137 不碰数据层）；
#       ③ 渲染级测试网自证：`node --test "tests/render/*.test.ts"` 必须 7/7 全绿；
#       ④ 临时 DATA_DIR + 台账范围内空闲端口（避开 8767）自起自停；真 POST /api/login 取 cookie；
#          接口层造三版夹具（v1 正文一 → v2 正文二 → v3 正文三），并回归「非内容字段不产生新版本」；
#       ⑤ 真浏览器（tools/ui-shot.mjs + chrome-headless-shell）**PC 1440×900 / 移动 440×956**：
#          - 分栏进编辑器 → 改正文 → 点收藏 ⇒ 未保存正文仍在（FR-136 ① 的浏览器实证）；
#          - 保存 → 返回详情 ⇒ 分栏右栏立刻显示**新**正文（FR-136 ② 的浏览器实证）；
#          - 版本面板切「表格」→ 回滚到 v1 ⇒ 编辑器表单拿到服务端旧正文（B6：显式重取，不被"同一条不重填"挡住）；
#          - 分栏视图点列表星标 ⇒ 列表项与右栏星标**立刻一致**（AC-127 ⑩：不出现"列表变了、右栏没变"）；
#          - 移动端抽屉里同样验「改正文 → 点收藏不丢」。
# 用法：bash tools/acceptance/ac-stage65.sh
set -u

cd "$(dirname "$0")/../.." || exit 1
ROOT="$PWD"
OUT_DIR='tmp/stage65/shots'
DUMP_DIR='tmp/stage65/dumps'
mkdir -p "$OUT_DIR" "$DUMP_DIR"

AC_PW='ac-fixture-pw-20260918'
TITLE='阶段65 收敛夹具'

pick_port() {
  for candidate in 8765 8766 8767 8768 8769 8770; do
    if ! ss -ltn | grep -q ":$candidate "; then echo "$candidate"; return 0; fi
  done
  return 1
}
PORT=$(pick_port) || { echo "FAIL 台账范围 8765–8770 全被占用（写 QUESTIONS 停手）"; exit 1; }
[ "$PORT" != "8767" ] || { echo "FAIL 选到了禁用端口 8767"; exit 1; }
BASE="http://127.0.0.1:$PORT"
LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
[ -n "$LAN_IP" ] || LAN_IP='127.0.0.1'
LAN_BASE="http://$LAN_IP:$PORT"

line() { printf '\n=== %s ===\n' "$1"; }
die() { printf 'FAIL %s\n' "$1"; exit 1; }

AC_DIR=$(mktemp -d /tmp/pm-s65-XXXXXX)
SRV_PID=''
JAR="$AC_DIR/jar.txt"
FIX="$AC_DIR/fixtures.json"
PLAN_PC="$AC_DIR/plan-pc.json"
PLAN_MOBILE="$AC_DIR/plan-mobile.json"
cleanup() {
  if [ -n "$SRV_PID" ]; then
    kill "$SRV_PID" 2>/dev/null || true
    for _ in $(seq 1 10); do kill -0 "$SRV_PID" 2>/dev/null || break; sleep 0.3; done
    kill -9 "$SRV_PID" 2>/dev/null || true
  fi
  rm -rf "$AC_DIR"
}
trap cleanup EXIT

line "0. 前置：端口 / 构建产物 / 渲染级基建 / 零迁移"
ss -ltn | grep -q ":$PORT " && die "端口 $PORT 已被占用"
echo "  端口 $PORT 空闲；API 层 base=$BASE；浏览器段 baseUrl=$LAN_BASE"
[ -f dist/web/index.html ] || die "缺 dist/web —— 先 npm run build"
[ -f dist/server/index.js ] || die "缺 dist/server —— 先 npm run build"
[ -f tools/tsx-loader.mjs ] || die "缺 tools/tsx-loader.mjs（渲染级测试的 .tsx 加载钩子）"
[ -f tsconfig.render-tests.json ] || die "缺 tsconfig.render-tests.json"
[ -f tests/render/harness.ts ] || die "缺 tests/render/harness.ts"
ls migrations/009_*.sql >/dev/null 2>&1 && die "本阶段零迁移，却出现了 009_*.sql"
MIG_COUNT=$(ls migrations/*.sql | wc -l | tr -d ' ')
[ "$MIG_COUNT" = "8" ] || die "migrations 应仍为 8 个，实际 $MIG_COUNT"
echo "  ✅ 零迁移：migrations/ 仍 8 个文件，无 009"

line "1. 源码级：收敛是否真的落地（AC-127 D11 / D12 / D13 / A1 / A3）"
WS='web/src/components/Workspace.tsx'
for old in 'setData(' 'setSelected(' 'setDetail(' 'setEditing('; do
  got=$(grep -c -- "$old" "$WS")
  [ "$got" = "0" ] || die "旧 setter 名 $old 在 $WS 里仍出现 $got 次（四份手写副本必须删掉）"
  echo "  ✅ $old ⇒ 0 次"
done
SETPROMPTS=$(grep -c 'setPrompts(' "$WS")
[ "$SETPROMPTS" = "2" ] || die "setPrompts( 应恰好 2 次（声明 + mergePrompts 里的更新），实际 $SETPROMPTS"
MERGE=$(grep -c 'mergePrompts(' "$WS")
[ "$MERGE" -ge 8 ] || die "mergePrompts( 调用点应 ≥8，实际 $MERGE"
grep -q 'const \[prompts, setPrompts\] = useState<Map<number, Prompt>>' "$WS" || die "Workspace 没有单一数据源 Map<number, Prompt>"
grep -q 'const selected = selectedId === null' "$WS" || die "selected 不是派生出来的"
WS_LINES=$(wc -l < "$WS" | tr -d ' ')
[ "$WS_LINES" -lt 941 ] || die "Workspace.tsx 行数应 < 941（收敛前），实际 $WS_LINES"
echo "  ✅ 单一数据源 Map + 派生 selected；setPrompts 恰好 2 次、mergePrompts ${MERGE} 次；Workspace.tsx ${WS_LINES} 行（收敛前 941）"
grep -q 'items.map((item)' "$WS" && die "仍存在手写 items 映射合并"
grep -qE '(prev|previous)\.items' "$WS" && die "仍存在手写 items 合并（previous.items）"
echo "  ✅ 无手写 items 映射合并（D12）"
grep -q 'const lastFilled = useRef<Prompt | null>(null)' web/src/components/PromptEditor.tsx || die "编辑器没有 lastFilled 稳定标识"
grep -q '}, \[fill, isNew, prompt\]);' web/src/components/PromptEditor.tsx || die "编辑器重填 effect 的依赖不是 [fill, isNew, prompt]"
grep -q '}, \[fill, prompt\]);' web/src/components/PromptEditor.tsx && die "编辑器仍按对象引用重填（FR-136 ① 会复发）"
echo "  ✅ 编辑器按稳定标识（prompt.id / 草稿身份）判重填（FR-136 ①）"
grep -q 'varsPrompt: varsPromptId === null ? null : resolvePrompt(varsPromptId)' web/src/use-copy.ts || die "填值弹窗仍持有 Prompt 对象副本"
grep -q 'if (loadedIdRef.current === prompt.id) return;' web/src/components/VarsDialog.tsx || die "VarsDialog 仍按对象引用重新 load()（会冲掉填一半的值）"
echo "  ✅ 弹窗只存 id（use-copy）+ 按 id 判 load（VarsDialog）"
grep -q 'setData(' web/src/use-copy.ts && die "use-copy 里仍有 setData"
for lib in zustand redux mobx jotai recoil valtio xstate; do
  grep -q "\"$lib\"" package.json && die "引入了状态管理库 $lib（D-63 禁止）"
done
grep -q '"jsdom"' package.json || die "jsdom 不在依赖里"
echo "  ✅ 无状态管理库；jsdom 在依赖里（渲染级测试不引入新依赖）"
grep -A3 '"exclude"' tsconfig.tests.json | grep -q '"tests/render/\*\*"' || die "tsconfig.tests.json 没有排除 tests/render"
grep -q 'tsconfig.render-tests.json' package.json || die "typecheck:tests 没有串跑 tsconfig.render-tests.json"
grep -q "from 'react-dom/client'" tests/render/harness.ts || die "渲染级 harness 没有用 react-dom/client"
grep -q "import './dom-env.ts'" tests/render/harness.ts || die "渲染级 harness 没有先加载 dom-env"
echo "  ✅ tsconfig 三件齐备（tests 排除 render / 独立 render-tests / typecheck:tests 串跑）"

line "1b. 渲染级测试网自证（真挂载组件，不需要浏览器）"
RENDER_OUT=$(node --test "tests/render/*.test.ts" 2>&1) || { printf '%s\n' "$RENDER_OUT" | tail -20; die "渲染级测试未全绿"; }
printf '%s\n' "$RENDER_OUT" | grep -E '^ℹ (tests|pass|fail)'
printf '%s\n' "$RENDER_OUT" | grep -q '^ℹ fail 0' || die "渲染级测试有失败"
RENDER_CASES=$(printf '%s\n' "$RENDER_OUT" | grep '^ℹ tests ' | awk '{print $3}')
[ "$RENDER_CASES" = "7" ] || die "渲染级用例数应为 7，实际 $RENDER_CASES"
echo "  ✅ tests/render 7/7 全绿（A1 挂载冒烟 / B4 改正文点收藏不丢 / B7 点星标后收藏开关同步 / B5 换条目必须重填 / B6 回滚后重取 / C8 保存后右栏是新正文 / C9 收藏四视图一致）"

line "2. 起临时服务（DATA_DIR=$AC_DIR，自起自停，不碰生产数据）"
printf '%s\n' "$AC_PW" | DATA_DIR="$AC_DIR" node bin/pm.mjs user set-password --username admin >/dev/null || die "建库/设口令失败"
DATA_DIR="$AC_DIR" PORT="$PORT" node dist/server/index.js >"$AC_DIR/server.log" 2>&1 &
SRV_PID=$!
CODE=''
for _ in $(seq 1 60); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/healthz" 2>/dev/null || true)
  [ "$CODE" = "200" ] && break
  sleep 0.3
done
[ "$CODE" = "200" ] || { cat "$AC_DIR/server.log"; die "服务未起来"; }
echo "SERVICE pid=$SRV_PID healthz=200"

line "3. 真登录 + 接口层造三版夹具"
curl -s -c "$JAR" -o /dev/null -X POST -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$AC_PW\"}" "$BASE/api/login" || die "登录请求失败"
SID=$(awk '$6 == "pm_sid" { print $7 }' "$JAR" | tail -1)
[ -n "$SID" ] || die "没有 pm_sid cookie"
echo "SID 长度=${#SID}（不打印明文）"

python3 - "$BASE" "$SID" "$TITLE" "$FIX" <<'PY' || die "接口层夹具不符"
import json, sys, urllib.error, urllib.request

base, sid, title, fix_path = sys.argv[1:5]

def call(method, path, body=None, cookie=sid):
    data = None if body is None else json.dumps(body).encode('utf-8')
    headers = {'Cookie': 'pm_sid=' + cookie} if cookie else {}
    if body is not None:
        headers['Content-Type'] = 'application/json'
    request = urllib.request.Request(base + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return response.status, json.loads(response.read().decode('utf-8') or 'null')
    except urllib.error.HTTPError as error:
        raw = error.read().decode('utf-8')
        try:
            return error.code, json.loads(raw or 'null')
        except json.JSONDecodeError:
            return error.code, raw

def expect(condition, message):
    if not condition:
        print('FAIL ' + message)
        sys.exit(1)

status, body = call('POST', '/api/prompts',
                    {'title': title, 'user_prompt': '正文一', 'system_prompt': '', 'notes': ''})
expect(status == 201, f'新建 prompt 应 201，实际 {status} {body}')
pid = body['id']
expect(body['version_no'] == 1, f'新建后 version_no 应为 1，实际 {body["version_no"]}')
expect(body['user_prompt'] == '正文一', '新建正文不符')

status, body = call('PUT', f'/api/prompts/{pid}', {'user_prompt': '正文二'})
expect(status == 200 and body['version_no'] == 2, f'第二次内容变更后应为 v2，实际 {status} {body}')

status, body = call('PUT', f'/api/prompts/{pid}', {'user_prompt': '正文三'})
expect(status == 200 and body['version_no'] == 3, f'第三次内容变更后应为 v3，实际 {status} {body}')

status, versions = call('GET', f'/api/prompts/{pid}/versions')
expect(status == 200, f'版本列表应 200，实际 {status}')
expect(len(versions['items']) == 3, f'应有 3 个版本，实际 {len(versions["items"])}')

# FR-129 回归：非内容字段不产生新版本（浏览器段点收藏后 version_no 必须仍是 3）
status, body = call('PUT', f'/api/prompts/{pid}', {'favorite': True})
expect(status == 200 and body['version_no'] == 3, '非内容字段 favorite 不得产生新版本')
status, body = call('PUT', f'/api/prompts/{pid}', {'favorite': False})
expect(status == 200 and body['version_no'] == 3, 'favorite 往返后仍不得产生新版本')

json.dump({'id': pid, 'title': title}, open(fix_path, 'w', encoding='utf-8'))
print(f'  夹具 id={pid}：v1 正文一 / v2 正文二 / v3 正文三；favorite 往返不产生版本 ✅')
PY

line "4. 真浏览器：PC 1440×900（改正文点收藏不丢 / 保存后右栏是新正文 / 回滚后重取）"
CHROME=$(ls -d /root/.cache/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell 2>/dev/null | sort | tail -1)
[ -n "$CHROME" ] || die "找不到 chrome-headless-shell"
OUT_ABS="$ROOT/$OUT_DIR"
DUMP_ABS="$ROOT/$DUMP_DIR"

python3 - "$LAN_BASE" "$LAN_IP" "$SID" "$CHROME" "$OUT_ABS" "$DUMP_ABS" "$PLAN_PC" "$PLAN_MOBILE" "$FIX" <<'PY' || die "计划生成失败"
import json, sys

base, lan_ip, sid, chrome, out_dir, dumps_dir, plan_pc, plan_mobile, fix_path = sys.argv[1:10]
fixture = json.load(open(fix_path, encoding='utf-8'))
pid = fixture['id']
title = fixture['title']

EDITOR_VALUE = "document.querySelector('[data-testid=\"editor-user-prompt\"]')?.value ?? ''"
DETAIL_BODY = "document.querySelector('[data-testid=\"pm-detail-body\"]')?.innerText ?? ''"
TOASTS = "[...document.querySelectorAll('.ant-message-notice')].map(n => n.innerText).join(' | ')"

CLEAR_EDITOR = """(() => { const el = document.querySelector('[data-testid="editor-user-prompt"]');
  if (!el) return 'no-input';
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, '');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return 'cleared'; })()"""

SELECT_SPLIT_ITEM = """(() => { const items = [...document.querySelectorAll('[data-testid="pm-split-item"]')];
  const item = items.find(n => n.innerText.includes(%s));
  if (!item) return 'no-item'; item.click(); return 'clicked'; })()""" % json.dumps(title, ensure_ascii=False)

DBLCLICK_CARD = """(() => { const cards = [...document.querySelectorAll('[data-testid="pm-use-card"]')];
  const card = cards.find(n => n.innerText.includes(%s));
  if (!card) return 'no-card';
  card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
  return 'dblclicked'; })()""" % json.dumps(title, ensure_ascii=False)

SWITCH_EDITOR_VERSION_TABLE = """(() => { const root = document.querySelector('[data-testid="pm-editor"]');
  if (!root) return 'no-editor';
  const seg = root.querySelector('[data-testid="pm-version-views"]');
  if (!seg) return 'no-seg';
  const tab = [...seg.querySelectorAll('.ant-segmented-item')].find(n => n.innerText.includes('表格'));
  if (!tab) return 'no-tab'; tab.click(); return 'ok'; })()"""

SEARCH = {'type': 'type', 'selector': '[data-testid=pm-search-input]', 'text': title}
OPEN_EDITOR_FROM_DETAIL = [
    {'type': 'sleep', 'ms': 600},
    {'type': 'click', 'selector': '[data-testid=pm-detail-edit]'},
    {'type': 'wait', 'selector': '[data-testid=pm-editor]'},
    {'type': 'sleep', 'ms': 400},
]


def star_label(testid):
    """收藏星标（web/src/components/FavoriteStar.tsx）的可探测量是 aria-label：「收藏」/「取消收藏」。"""
    return f"document.querySelector('[data-testid={testid}]')?.getAttribute('aria-label') ?? ''"


def split_shot(name, width, height, actions, open_editor=True):
    base_actions = [SEARCH, {'type': 'sleep', 'ms': 700},
                    {'type': 'eval', 'expression': SELECT_SPLIT_ITEM},
                    {'type': 'wait', 'selector': '[data-testid=pm-detail-body]'},
                    {'type': 'sleep', 'ms': 700}]
    if open_editor:
        base_actions += [{'type': 'click', 'selector': '[data-testid=pm-detail-edit]'},
                         {'type': 'wait', 'selector': '[data-testid=pm-editor]'},
                         {'type': 'sleep', 'ms': 400}]
    return {'name': name, 'path': '/', 'width': width, 'height': height, 'auth': True,
            'storage': {'pm-view-mode': 'split', 'pm-theme': 'light'},
            'waitFor': '[data-testid=pm-search-input]',
            'actions': base_actions + actions,
            'dump': name, 'settleMs': 700}


# PC ①：改正文 → 点收藏 ⇒ 未保存正文不得被重置（FR-136 ①）
shot_edit_fav = split_shot('65-edit-fav-pc', 1440, 900, [
    {'type': 'eval', 'expression': CLEAR_EDITOR},
    {'type': 'type', 'selector': '[data-testid=editor-user-prompt]', 'text': '改了一半的正文'},
    {'type': 'sleep', 'ms': 400},
    {'type': 'click', 'selector': f'[data-testid=pm-fav-editor-{pid}]'},
    {'type': 'sleep', 'ms': 1200},
    {'type': 'probe', 'name': 'ef-value', 'expression': EDITOR_VALUE},
    {'type': 'probe', 'name': 'ef-switch', 'expression': "document.querySelector('[data-testid=editor-favorite]')?.getAttribute('aria-checked') ?? ''"},
    {'type': 'probe', 'name': 'ef-fav', 'expression': f"document.querySelector('[data-testid=\"pm-fav-editor-{pid}\"]')?.getAttribute('aria-checked') ?? ''"},
    {'type': 'probe', 'name': 'ef-toast', 'expression': TOASTS},
])

# PC ②：保存 → 返回详情 ⇒ 分栏右栏立刻显示新正文（FR-136 ②）
shot_save_detail = split_shot('65-save-detail-pc', 1440, 900, [
    {'type': 'eval', 'expression': CLEAR_EDITOR},
    {'type': 'type', 'selector': '[data-testid=editor-user-prompt]', 'text': '改了一半的正文'},
    {'type': 'sleep', 'ms': 400},
    {'type': 'click', 'selector': '[data-testid=editor-save]'},
    {'type': 'sleep', 'ms': 1500},
    {'type': 'probe', 'name': 'sd-toast', 'expression': TOASTS},
    {'type': 'click', 'selector': '[data-testid=editor-back]'},
    {'type': 'sleep', 'ms': 1200},
    {'type': 'probe', 'name': 'sd-detail', 'expression': DETAIL_BODY},
])

# PC ③：版本面板切「表格」→ 回滚到 v1 ⇒ 编辑器表单拿到服务端旧正文（B6）
shot_rollback = split_shot('65-rollback-pc', 1440, 900, [
    {'type': 'eval', 'expression': SWITCH_EDITOR_VERSION_TABLE},
    {'type': 'sleep', 'ms': 900},
    {'type': 'click', 'selector': f'[data-testid="pm-editor"] [data-testid="rollback-1"]'},
    {'type': 'wait', 'selector': '.ant-popconfirm'},
    {'type': 'sleep', 'ms': 300},
    {'type': 'click', 'selector': '.ant-popconfirm-buttons .ant-btn-primary'},
    {'type': 'sleep', 'ms': 1800},
    {'type': 'probe', 'name': 'rb-value', 'expression': EDITOR_VALUE},
    {'type': 'probe', 'name': 'rb-toast', 'expression': TOASTS},
])

# PC ④：分栏视图点列表星标 ⇒ 列表项与右栏星标立刻一致（AC-127 ⑩）
shot_fav_split = split_shot('65-fav-split-pc', 1440, 900, [
    {'type': 'probe', 'name': 'fs-list-before', 'expression': star_label(f'pm-fav-split-{pid}')},
    {'type': 'probe', 'name': 'fs-detail-before', 'expression': star_label(f'pm-fav-detail-{pid}')},
    {'type': 'click', 'selector': f'[data-testid=pm-fav-split-{pid}]'},
    {'type': 'sleep', 'ms': 1500},
    {'type': 'probe', 'name': 'fs-list-after', 'expression': star_label(f'pm-fav-split-{pid}')},
    {'type': 'probe', 'name': 'fs-detail-after', 'expression': star_label(f'pm-fav-detail-{pid}')},
    {'type': 'probe', 'name': 'fs-toast', 'expression': TOASTS},
], open_editor=False)

# 移动端：卡片视图双击进详情 → 抽屉编辑器 → 改正文 → 点收藏 ⇒ 不丢（FR-136 ① 移动端）
shot_mobile = {'name': '65-edit-fav-mobile', 'path': '/', 'width': 440, 'height': 956, 'auth': True,
               'storage': {'pm-view-mode': 'card', 'pm-theme': 'light'},
               'waitFor': '[data-testid=pm-search-input]',
               'actions': [SEARCH, {'type': 'sleep', 'ms': 700},
                           {'type': 'eval', 'expression': DBLCLICK_CARD},
                           {'type': 'wait', 'selector': '[data-testid=pm-detail-edit]'},
                           {'type': 'sleep', 'ms': 700},
                           {'type': 'click', 'selector': '[data-testid=pm-detail-edit]'},
                           {'type': 'wait', 'selector': '[data-testid=pm-editor]'},
                           {'type': 'sleep', 'ms': 500},
                           {'type': 'eval', 'expression': CLEAR_EDITOR},
                           {'type': 'type', 'selector': '[data-testid=editor-user-prompt]', 'text': '移动端改了一半'},
                           {'type': 'sleep', 'ms': 400},
                           {'type': 'click', 'selector': f'[data-testid=pm-fav-editor-{pid}]'},
                           {'type': 'sleep', 'ms': 1200},
                           {'type': 'probe', 'name': 'mf-value', 'expression': EDITOR_VALUE},
                           {'type': 'probe', 'name': 'mf-switch', 'expression': "document.querySelector('[data-testid=editor-favorite]')?.getAttribute('aria-checked') ?? ''"},
                           {'type': 'probe', 'name': 'mf-fav', 'expression': f"document.querySelector('[data-testid=\"pm-fav-editor-{pid}\"]')?.getAttribute('aria-checked') ?? ''"},
                           ],
               'dump': '65-edit-fav-mobile', 'settleMs': 700}


def write(path, shots):
    json.dump({'chrome': chrome, 'baseUrl': base,
               'cookie': {'name': 'pm_sid', 'value': sid, 'domain': lan_ip},
               'outDir': out_dir, 'dumpsDir': dumps_dir, 'shots': shots},
              open(path, 'w', encoding='utf-8'), ensure_ascii=False)


write(plan_pc, [shot_edit_fav, shot_save_detail, shot_rollback, shot_fav_split])
write(plan_mobile, [shot_mobile])
print(f'  两份计划已生成（PC 4 shot + 移动 1 shot；baseUrl={base}）')
PY

: > "$DUMP_DIR/probes.txt"
for P in "$PLAN_PC" "$PLAN_MOBILE"; do
  echo "--- $(basename "$P") ---"
  PLAN_OUT=$(node tools/ui-shot.mjs "$P" 2>&1) || { printf '%s\n' "$PLAN_OUT" | tail -30; die "ui-shot 失败：$P"; }
  printf '%s\n' "$PLAN_OUT" | grep -E '^(SHOT|PROBE|ANT_CLASSES)'
  printf '%s\n' "$PLAN_OUT" >> "$DUMP_DIR/probes.txt"
done

line "5. 界面探针断言（取最后一次同名探针）"
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

echo "--- FR-136 ① 改正文后点收藏，未保存正文仍在（PC）---"
assert_probe ef-value '改了一半的正文' has
assert_probe ef-value '正文三' not
echo "--- FR-136 ① 的代价：点星标后表单里的收藏开关必须同步（否则保存会把收藏改回去）---"
assert_probe ef-switch 'true' eq
echo "--- FR-136 ② 保存后分栏右栏立刻显示新正文（PC）---"
assert_probe sd-detail '改了一半的正文' has
assert_probe sd-detail '正文三改了一半' not
echo "--- B6 回滚到 v1 后编辑器表单拿到服务端旧正文（PC）---"
assert_probe rb-value '正文一' eq
assert_probe rb-toast '已回滚到 v1' has
echo "--- FR-136 ① 移动端抽屉里同样不丢 ---"
assert_probe mf-value '移动端改了一半' has
assert_probe mf-value '正文一' not
assert_probe mf-switch 'true' eq
echo "--- AC-127 ⑩ 分栏右栏在收藏后立刻反映（列表星标与右栏星标一致）---"
probe_value() { grep -F "PROBE $1 " "$DUMP_DIR/probes.txt" | tail -1 | sed "s/^PROBE $1 //" | sed 's/^"//; s/"$//'; }
fs_lb=$(probe_value fs-list-before); fs_db=$(probe_value fs-detail-before)
fs_la=$(probe_value fs-list-after);  fs_da=$(probe_value fs-detail-after)
[ -n "$fs_lb" ] && [ -n "$fs_db" ] && [ -n "$fs_la" ] && [ -n "$fs_da" ] || die "分栏星标探针没有输出"
[ "$fs_lb" = "$fs_db" ] || die "收藏前列表星标「$fs_lb」与右栏星标「$fs_db」应一致（不出现『列表变了、右栏没变』）"
[ "$fs_la" = "$fs_da" ] || die "收藏后列表星标「$fs_la」与右栏星标「$fs_da」应一致（不出现『列表变了、右栏没变』）"
[ "$fs_lb" != "$fs_la" ] || die "点列表星标后状态应切换，实际仍是「$fs_la」"
echo "  ✅ 收藏前 列表=$fs_lb 右栏=$fs_db；收藏后 列表=$fs_la 右栏=$fs_da（两边一致且已切换）"

line "6. 服务端复核：浏览器流程真的落到了库里（FR-136 ② / B6 / FR-129）"
python3 - "$BASE" "$SID" "$FIX" <<'PY' || die "服务端复核不符"
import json, sys, urllib.error, urllib.request

base, sid, fix_path = sys.argv[1:4]
fixture = json.load(open(fix_path, encoding='utf-8'))
pid = fixture['id']

def call(method, path):
    request = urllib.request.Request(base + path, headers={'Cookie': 'pm_sid=' + sid}, method=method)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return response.status, json.loads(response.read().decode('utf-8') or 'null')
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode('utf-8')

def expect(condition, message):
    if not condition:
        print('FAIL ' + message)
        sys.exit(1)

status, prompt = call('GET', f'/api/prompts/{pid}')
expect(status == 200, f'取 prompt 应 200，实际 {status} {prompt}')
expect(prompt['user_prompt'] == '正文一', f'回滚后正文应为 v1 的「正文一」，实际 {prompt["user_prompt"]!r}')
# v1 建 → v2 → v3 → 保存（PC ②）→ 回滚到 v1 ⇒ v5；
# 收藏（PC ① 与移动端各一次）是非内容字段，不产生版本 ⇒ 若它产生了版本这里会对不上
expect(prompt['version_no'] == 5, f'version_no 应为 5（3 次内容变更 + 1 次保存 + 1 次回滚），实际 {prompt["version_no"]}')

status, versions = call('GET', f'/api/prompts/{pid}/versions')
expect(status == 200, f'版本列表应 200，实际 {status}')
expect(len(versions['items']) == 5, f'版本行数应为 5，实际 {len(versions["items"])}')
expect(max(v['version_no'] for v in versions['items']) == 5, '最新版本号应为 5')
print(f'  ✅ 库里：user_prompt=正文一、version_no=5、版本行数=5（收藏未产生版本 ⇒ FR-129 不回归）')
PY

line "7. 截图与产物落点"
ls -l "$OUT_DIR" | tail -8
echo "  截图目录：$OUT_DIR（交付态，随仓库入库）"
echo "  探针全文：$DUMP_DIR/probes.txt"
printf '\nALL STAGE65 ACCEPTANCE CHECKS PASSED\n'
