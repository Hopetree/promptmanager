#!/usr/bin/env bash
# 阶段 71 **返工 ①** 端到端验收（交付态，随仓库入库）
# 返工题目：未保存编辑的「离开路径」漏了一条 —— 从**详情**进编辑器（origin === 'detail'，
# 返回按钮文案「返回详情」）改了内容后点它 ⇒ 改前会无确认直接关闭、未保存内容静默丢失。
#
# 验什么（全部真浏览器 + 真鼠标/真键盘事件）：
#   A) 详情来源的「返回详情」（editor-back）⇒ 必须出现确认；「继续编辑」内容还在；
#      「放弃修改」才真的离开，且**服务端正文仍是原值**（既没丢、也没偷偷保存）；
#   B) 编辑器内第二个返回入口（面包屑条目名）同样过闸；
#   C) 头部三条换壳路径（新建 / logo 回主页 / 登出）同样过闸 —— 登出被拦时**不得**真的登出；
#   D) 移动端（440×956 DPR3）同一道闸可用、无页面级横向滚动；
#   E) 收尾 `--check`：服务端正文未变、总数未变。
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
AC_DIR=$(mktemp -d /tmp/pm-s71r-XXXXXX)
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
PY

line "2. 真浏览器计划：PC 1440×900 DPR2（返工的 5 条离开路径）+ 移动 440×956 DPR3（同一道闸）"
CHROME=$(node tools/acceptance/lib/chrome.mjs)
[ -n "$CHROME" ] || die "找不到 chrome-headless-shell"
OUT_ABS="$ROOT/$OUT_DIR"
DUMP_ABS="$ROOT/$DUMP_DIR"

python3 - "$LAN_BASE" "$LAN_IP" "$SID" "$CHROME" "$OUT_ABS" "$DUMP_ABS" "$PLAN_PC" "$PLAN_MOBILE" \
  "$AC_DIR/ids.json" "$TYPED" <<'PY' || die "计划生成失败"
import json, sys

base, lan_ip, sid, chrome, out_dir, dumps_dir, plan_pc, plan_mobile, ids_file, typed = sys.argv[1:11]
ids = json.load(open(ids_file))
jia_title, yi_title = '阶段71甲', '阶段71乙'
jia_id, yi_id = int(ids[jia_title]), int(ids[yi_title])

OVERFLOW = "(() => document.documentElement.scrollWidth > window.innerWidth ? 'overflow' : 'none')()"
VIEWPORT = "`${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio}`"
# 详情正文：用**容器**的 innerText（`pm-detail-plain` 是 Switch，连点两次会切回 markdown）
DETAIL_BODY = "document.querySelector('[data-testid=pm-detail-body]')?.innerText ?? 'no-node'"
EDITOR_VALUE = "document.querySelector('[data-testid=editor-user-prompt]')?.value ?? 'NO-EDITOR'"
EDITOR_OPEN = "document.querySelector('[data-testid=editor-user-prompt]') !== null"
HAS_CONFIRM = "document.querySelector('[data-testid=pm-unsaved-confirm]') !== null"
HAS_BADGE = "document.querySelector('[data-testid=editor-dirty-badge]') !== null"
BACK_LABEL = "document.querySelector('[data-testid=editor-back]')?.innerText ?? 'no-back'"
DIALOG_TITLE = "document.querySelector('.ant-modal-title')?.innerText ?? 'no-title'"
DIALOG_BODY = "document.querySelector('[data-testid=pm-unsaved-confirm]')?.innerText ?? 'no-body'"
SEARCH_ALIVE = "document.querySelector('[data-testid=pm-search-input]') !== null"
CARDS = "document.querySelectorAll('[data-testid=pm-use-card]').length"


def pick(label):
    """点分栏左栏里含指定标题的那一条（真鼠标 ⇒ onSelect ⇒ openDetail）。"""
    return {'type': 'eval', 'expression': (
        "(() => { const items = [...document.querySelectorAll('[data-testid=pm-split-item]')];"
        f" const t = items.find((n) => n.innerText.includes({json.dumps(label)}));"
        " if (!t) return 'no-item'; t.click(); return 'clicked'; })()")}


# 面包屑里的条目名（编辑器内第二个返回入口，同样吃 onBackToDetail）
CRUMB = {'type': 'eval', 'expression': (
    "(() => { const links = [...document.querySelectorAll('[data-testid=pm-editor] .ant-breadcrumb a')];"
    f" const t = links.find((n) => n.innerText.includes({json.dumps(jia_title)}));"
    " if (!t) return 'no-crumb'; t.click(); return 'clicked'; })()")}

KEEP = {'type': 'click', 'selector': '[data-testid=pm-unsaved-keep]'}

shot_pc = {
    'name': '71-pc-detail-back-paths', 'path': '/', 'width': 1440, 'height': 900, 'dpr': 2, 'auth': True,
    'storage': {'pm-view-mode': 'split', 'pm-theme': 'light'},
    'waitFor': '[data-testid=pm-search-input]',
    'actions': [
        {'type': 'probe', 'name': 'r-viewport', 'expression': VIEWPORT},
        # 从「详情」进编辑器：分栏左栏选中甲 → 右栏详情 → 点「编辑」（openEditor(id,'detail')）
        # 等左栏列表真的渲染出来再点（否则 pick 会拿到 'no-item'，默认选中会落到另一条）
        {'type': 'wait', 'selector': '[data-testid=pm-split-item]'},
        pick(jia_title),
        {'type': 'sleep', 'ms': 900},
        {'type': 'probe', 'name': 'r-detail-body', 'expression': DETAIL_BODY},
        {'type': 'click', 'selector': '[data-testid=pm-detail-edit]'},
        {'type': 'wait', 'selector': '[data-testid=editor-user-prompt]'},
        {'type': 'probe', 'name': 'r-back-label', 'expression': BACK_LABEL},
        {'type': 'type', 'selector': '[data-testid=editor-user-prompt]', 'text': typed},
        {'type': 'sleep', 'ms': 400},
        {'type': 'probe', 'name': 'r-dirty-badge', 'expression': HAS_BADGE},
        # A) 详情来源的「返回详情」⇒ 必须出现确认
        {'type': 'click', 'selector': '[data-testid=editor-back]'},
        {'type': 'sleep', 'ms': 700},
        {'type': 'probe', 'name': 'r-a-confirm', 'expression': HAS_CONFIRM},
        {'type': 'probe', 'name': 'r-a-dialog-title', 'expression': DIALOG_TITLE},
        {'type': 'probe', 'name': 'r-a-dialog-body', 'expression': DIALOG_BODY},
        {'type': 'probe', 'name': 'r-a-typed-kept', 'expression': EDITOR_VALUE},
        {'type': 'probe', 'name': 'r-a-viewport', 'expression': VIEWPORT},
        {'type': 'probe', 'name': 'r-a-overflow', 'expression': OVERFLOW},
        # 「继续编辑」⇒ 还在编辑器里、内容还在
        KEEP,
        {'type': 'sleep', 'ms': 400},
        {'type': 'probe', 'name': 'r-a-keep-open', 'expression': EDITOR_OPEN + " && !(" + HAS_CONFIRM + ")"},
        {'type': 'probe', 'name': 'r-a-keep-typed', 'expression': EDITOR_VALUE},
        # B) 面包屑条目名（第二个返回入口）⇒ 同样必须确认
        CRUMB,
        {'type': 'sleep', 'ms': 600},
        {'type': 'probe', 'name': 'r-b-crumb-confirm', 'expression': HAS_CONFIRM},
        KEEP,
        {'type': 'sleep', 'ms': 400},
        # C1) 头部「新建」换壳 ⇒ 必须确认，且编辑器里还是甲的内容
        {'type': 'click', 'selector': '[data-testid=header-new]'},
        {'type': 'sleep', 'ms': 600},
        {'type': 'probe', 'name': 'r-c1-new-confirm', 'expression': HAS_CONFIRM},
        {'type': 'probe', 'name': 'r-c1-new-typed', 'expression': EDITOR_VALUE},
        KEEP,
        {'type': 'sleep', 'ms': 400},
        # C2) logo 回主页 ⇒ 必须确认
        {'type': 'click', 'selector': '[aria-label="回到首页"]'},
        {'type': 'sleep', 'ms': 600},
        {'type': 'probe', 'name': 'r-c2-home-confirm', 'expression': HAS_CONFIRM},
        KEEP,
        {'type': 'sleep', 'ms': 400},
        # C3) 登出 ⇒ 必须确认，且**没有真的登出**（工作区还在）
        {'type': 'click', 'selector': '[data-testid=header-logout]'},
        {'type': 'sleep', 'ms': 600},
        {'type': 'probe', 'name': 'r-c3-logout-confirm', 'expression': HAS_CONFIRM},
        {'type': 'probe', 'name': 'r-c3-still-in', 'expression': SEARCH_ALIVE},
        KEEP,
        {'type': 'sleep', 'ms': 400},
        # A 收尾）真的点「返回详情」并「放弃修改」⇒ 才离开，回详情且正文是服务端原值
        {'type': 'click', 'selector': '[data-testid=editor-back]'},
        {'type': 'sleep', 'ms': 600},
        {'type': 'probe', 'name': 'r-d-dialog-again', 'expression': HAS_CONFIRM},
        {'type': 'click', 'selector': '[data-testid=pm-unsaved-discard]'},
        {'type': 'sleep', 'ms': 900},
        {'type': 'probe', 'name': 'r-d-editor-gone', 'expression': "!(" + EDITOR_OPEN + ")"},
        {'type': 'probe', 'name': 'r-d-confirm-gone', 'expression': "!(" + HAS_CONFIRM + ")"},
        {'type': 'probe', 'name': 'r-d-detail-body', 'expression': DETAIL_BODY},
        {'type': 'probe', 'name': 'r-d-overflow', 'expression': OVERFLOW},
    ],
    'dump': '71-pc-detail-back-paths', 'settleMs': 600,
}

shot_mobile = {
    'name': '71-m-back-after-discard', 'path': '/', 'width': 440, 'height': 956, 'dpr': 3, 'auth': True,
    'storage': {'pm-view-mode': 'card', 'pm-theme': 'light'},
    'waitFor': '[data-testid=pm-search-input]',
    'actions': [
        {'type': 'probe', 'name': 'm-viewport', 'expression': VIEWPORT},
        {'type': 'probe', 'name': 'm-overflow', 'expression': OVERFLOW},
        # 移动端同一道闸：新建（草稿）→ 改 → 返回 ⇒ 必须确认
        {'type': 'click', 'selector': '[data-testid=header-new]'},
        {'type': 'wait', 'selector': '[data-testid=editor-user-prompt]'},
        {'type': 'type', 'selector': '[data-testid=editor-user-prompt]', 'text': typed},
        {'type': 'sleep', 'ms': 400},
        {'type': 'probe', 'name': 'm-back-label', 'expression': BACK_LABEL},
        {'type': 'click', 'selector': '[data-testid=editor-back]'},
        {'type': 'sleep', 'ms': 700},
        {'type': 'probe', 'name': 'm-confirm', 'expression': HAS_CONFIRM},
        {'type': 'probe', 'name': 'm-dialog-title', 'expression': DIALOG_TITLE},
        {'type': 'probe', 'name': 'm-typed-kept', 'expression': EDITOR_VALUE},
        {'type': 'probe', 'name': 'm-overflow-confirm', 'expression': OVERFLOW},
        KEEP,
        {'type': 'sleep', 'ms': 400},
        {'type': 'probe', 'name': 'm-keep-open', 'expression': EDITOR_OPEN + " && !(" + HAS_CONFIRM + ")"},
        # 再来一次，这次「放弃修改」⇒ 回到列表（卡片还在）
        {'type': 'click', 'selector': '[data-testid=editor-back]'},
        {'type': 'sleep', 'ms': 600},
        {'type': 'click', 'selector': '[data-testid=pm-unsaved-discard]'},
        {'type': 'sleep', 'ms': 800},
        {'type': 'probe', 'name': 'm-editor-gone', 'expression': "!(" + EDITOR_OPEN + ")"},
        {'type': 'probe', 'name': 'm-cards', 'expression': CARDS},
        {'type': 'probe', 'name': 'm-overflow-final', 'expression': OVERFLOW},
        {'type': 'probe', 'name': 'm-viewport-final', 'expression': VIEWPORT},
    ],
    'dump': '71-m-back-after-discard', 'settleMs': 600,
}

shot_pc_confirm = {
    'name': '71-pc-detail-back-confirm', 'path': '/', 'width': 1440, 'height': 900, 'dpr': 2, 'auth': True,
    'storage': {'pm-view-mode': 'split', 'pm-theme': 'light'},
    'waitFor': '[data-testid=pm-search-input]',
    'actions': [
        # 等左栏列表真的渲染出来再点（否则 pick 会拿到 'no-item'，默认选中会落到另一条）
        {'type': 'wait', 'selector': '[data-testid=pm-split-item]'},
        pick(jia_title),
        {'type': 'sleep', 'ms': 900},
        {'type': 'probe', 'name': 'r-detail-body', 'expression': DETAIL_BODY},
        {'type': 'click', 'selector': '[data-testid=pm-detail-edit]'},
        {'type': 'wait', 'selector': '[data-testid=editor-user-prompt]'},
        {'type': 'probe', 'name': 'r-back-label', 'expression': BACK_LABEL},
        {'type': 'type', 'selector': '[data-testid=editor-user-prompt]', 'text': typed},
        {'type': 'sleep', 'ms': 400},
        {'type': 'probe', 'name': 'r-dirty-badge', 'expression': HAS_BADGE},
        # 返工主判据：详情来源的「返回详情」⇒ 确认弹窗（这一张截图就停在这里）
        {'type': 'click', 'selector': '[data-testid=editor-back]'},
        {'type': 'sleep', 'ms': 700},
        {'type': 'probe', 'name': 'r-a-confirm', 'expression': HAS_CONFIRM},
        {'type': 'probe', 'name': 'r-a-dialog-title', 'expression': DIALOG_TITLE},
        {'type': 'probe', 'name': 'r-a-dialog-body', 'expression': DIALOG_BODY},
        {'type': 'probe', 'name': 'r-a-typed-kept', 'expression': EDITOR_VALUE},
        {'type': 'probe', 'name': 'r-a-viewport', 'expression': VIEWPORT},
        {'type': 'probe', 'name': 'r-a-overflow', 'expression': OVERFLOW},
    ],
    'dump': '71-pc-detail-back-confirm', 'settleMs': 400,
}

shot_m_confirm = {
    'name': '71-m-detail-back-confirm', 'path': '/', 'width': 440, 'height': 956, 'dpr': 3, 'auth': True,
    'storage': {'pm-view-mode': 'card', 'pm-theme': 'light'},
    'waitFor': '[data-testid=pm-search-input]',
    'actions': [
        {'type': 'probe', 'name': 'm-viewport', 'expression': VIEWPORT},
        {'type': 'probe', 'name': 'm-overflow', 'expression': OVERFLOW},
        {'type': 'click', 'selector': '[data-testid=header-new]'},
        {'type': 'wait', 'selector': '[data-testid=editor-user-prompt]'},
        {'type': 'type', 'selector': '[data-testid=editor-user-prompt]', 'text': typed},
        {'type': 'sleep', 'ms': 400},
        {'type': 'probe', 'name': 'm-back-label', 'expression': BACK_LABEL},
        {'type': 'click', 'selector': '[data-testid=editor-back]'},
        {'type': 'sleep', 'ms': 700},
        {'type': 'probe', 'name': 'm-confirm', 'expression': HAS_CONFIRM},
        {'type': 'probe', 'name': 'm-dialog-title', 'expression': DIALOG_TITLE},
        {'type': 'probe', 'name': 'm-typed-kept', 'expression': EDITOR_VALUE},
        {'type': 'probe', 'name': 'm-overflow-confirm', 'expression': OVERFLOW},
    ],
    'dump': '71-m-detail-back-confirm', 'settleMs': 400,
}

def write(path, shots):
    json.dump({'chrome': chrome, 'baseUrl': base,
               'cookie': {'name': 'pm_sid', 'value': sid, 'domain': lan_ip},
               'outDir': out_dir, 'dumpsDir': dumps_dir, 'shots': shots},
              open(path, 'w', encoding='utf-8'), ensure_ascii=False)

# ⚠️ 排序约束（实测踩到）：**结束时仍有未保存修改**（dirty=true ⇒ beforeunload 被挂上）的那一张
# 必须放在该 ui-shot 进程的最后一张 —— 否则下一次 `Page.navigate` 会被 beforeunload 拦住，
# 30s 后报 `CDP 超时：Page.navigate`。这本身也是「beforeunload 保护真的生效」的反向证据。
write(plan_pc, [shot_pc, shot_pc_confirm])
write(plan_mobile, [shot_mobile, shot_m_confirm])
print(f"  两份计划已生成（PC 2 shot dpr=2：确认弹窗 + 走完 5 条路径；移动 2 shot dpr=3）；甲=#{jia_id} 乙=#{yi_id}")
PY

: > "$DUMP_DIR/rework-probes.txt"
for P in "$PLAN_PC" "$PLAN_MOBILE"; do
  echo "--- $(basename "$P") ---"
  PLAN_OUT=$(node tools/ui-shot.mjs "$P" 2>&1) || { printf '%s\n' "$PLAN_OUT" | tail -30; die "ui-shot 失败：$P"; }
  printf '%s\n' "$PLAN_OUT" | grep -E '^(SHOT|PROBE|ANT_CLASSES)'
  printf '%s\n' "$PLAN_OUT" >> "$DUMP_DIR/rework-probes.txt"
done

line "3. 界面探针断言（取最后一次同名探针）"
assert_probe() {
  key="$1"; want="$2"; mode="${3:-has}"
  got=$(grep -F "PROBE $key " "$DUMP_DIR/rework-probes.txt" | tail -1 | sed "s/^PROBE $key //")
  [ -n "$got" ] || die "探针 $key 没有输出"
  case "$mode" in
    has) case "$got" in *"$want"*) ;; *) die "探针 $key 应包含「$want」，实际 $got" ;; esac ;;
    not) case "$got" in *"$want"*) die "探针 $key 不应包含「$want」，实际 $got" ;; esac ;;
    eq)  stripped=$(printf '%s' "$got" | sed 's/^"//; s/"$//')
         [ "$stripped" = "$want" ] || die "探针 $key 应等于「$want」，实际 $got" ;;
  esac
  echo "  ✅ $key ($mode) $want"
}
JIA_ID=$(python3 -c "import json;print(json.load(open('$AC_DIR/ids.json'))['阶段71甲'])")

# 出发点：确实是「从详情进编辑器」（按钮文案是「返回详情」）
assert_probe r-viewport '1440x900@2' eq
assert_probe r-detail-body '正文甲' has
assert_probe r-back-label '返回详情' has
assert_probe m-back-label '返回列表' has
assert_probe r-dirty-badge 'true' eq
# A) 返工主判据：详情来源的「返回详情」必须出现确认，且改了的内容还在（改前这里是致命的）
assert_probe r-a-confirm 'true' eq
assert_probe r-a-dialog-title '放弃未保存的修改？' has
assert_probe r-a-dialog-body '当前编辑还没保存，离开会丢掉这些改动。' has
assert_probe r-a-typed-kept "$TYPED" has
assert_probe r-a-viewport '1440x900@2' eq
assert_probe r-a-overflow 'none' eq
# 「继续编辑」⇒ 内容还在
assert_probe r-a-keep-open 'true' eq
assert_probe r-a-keep-typed "$TYPED" has
# B) 面包屑条目名（同一 prop 的第二个入口）
assert_probe r-b-crumb-confirm 'true' eq
# C) 头部三条换壳路径
assert_probe r-c1-new-confirm 'true' eq
assert_probe r-c1-new-typed "$TYPED" has
assert_probe r-c2-home-confirm 'true' eq
assert_probe r-c3-logout-confirm 'true' eq
assert_probe r-c3-still-in 'true' eq
# D) 「放弃修改」⇒ 才离开；确认消失；回详情且正文是服务端原值（既没丢也没偷偷保存）
assert_probe r-d-dialog-again 'true' eq
assert_probe r-d-editor-gone 'true' eq
assert_probe r-d-confirm-gone 'true' eq
assert_probe r-d-detail-body '正文甲' has
assert_probe r-d-detail-body "$TYPED" not
assert_probe r-d-overflow 'none' eq
# 移动端同一道闸 + 双端无页面级横向滚动
assert_probe m-viewport '440x956@3' eq
assert_probe m-viewport-final '440x956@3' eq
assert_probe m-overflow 'none' eq
assert_probe m-overflow-confirm 'none' eq
assert_probe m-overflow-final 'none' eq
assert_probe m-confirm 'true' eq
assert_probe m-typed-kept "$TYPED" has
assert_probe m-keep-open 'true' eq
assert_probe m-editor-gone 'true' eq
assert_probe m-cards '2' eq

line "4. 服务端对账：改了一半的内容既没丢到哪儿、也没有被偷偷保存"
python3 - "$BASE" "$SID" "$JIA_ID" "$TYPED" <<'PY' || die "服务端对账不符"
import json, sys, urllib.request

base, sid, jia_id, typed = sys.argv[1:5]

def get(path):
    req = urllib.request.Request(base + path)
    req.add_header('cookie', 'pm_sid=' + sid)
    with urllib.request.urlopen(req) as res:
        return res.status, json.loads(res.read().decode() or 'null')

status, prompt = get(f'/api/prompts/{jia_id}')
assert status == 200, status
assert prompt['user_prompt'] == '正文甲 {{名字 | default(甲)}}', prompt['user_prompt']
assert typed not in prompt['user_prompt'], prompt['user_prompt']
print(f"  服务端 #{jia_id} user_prompt = {prompt['user_prompt']!r}（未被未保存内容污染）")

status, listed = get('/api/prompts?limit=50')
assert status == 200 and listed['total'] == 2, (status, listed.get('total'))
print(f"  列表 total={listed['total']}（丢弃草稿没有产生任何记录）")
PY

line "5. 截图与产物落点"
ls -1t "$ROOT/$OUT_DIR" | head -6 | sed 's/^/  /'
echo "  dumps: $DUMP_DIR/rework-probes.txt（+ DOM 快照）"

line "✅ ALL STAGE71 REWORK ① CHECKS PASSED"
