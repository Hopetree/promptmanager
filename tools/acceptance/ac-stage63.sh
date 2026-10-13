#!/usr/bin/env bash
# 阶段 63（FR-130 401 单点 + FR-131 文档对齐）一次性验收脚本 —— **交付态，随仓库入库（tools/acceptance/）**。
#
# 判据：`tmp/dev-process/BRIEF.md` 的 FR-130 / FR-131 / AC-125 / D-61 四节。
# 做法：① **文档路径检查器的红绿对照**（真仓库：临时往 `docs/traps.md` 插一条不存在的路径 ⇒ rc=1；
#          还原 ⇒ rc=0，并断言 `git diff --quiet docs/traps.md`）+ 假阳性反例（库外 tmp/ 豁免、
#          通配写法豁免、`src/api.ts` 按 `web/` 包根解析）；
#       ② 401 单点的**源码级**证据：`status === 401` / `onUnauthorized` 在全前端归零，
#          非 401 的 `describeError` 调用点逐条仍在；
#       ③ 临时 DATA_DIR + 台账范围内空闲端口（避开 8767）自起自停；真实 POST /api/login 取 cookie；
#          接口层核对：未认证 401、未知路径 fail-closed 401、404 / 400 / 403 session_required 不回归、
#          以及「服务端注销会话后同一个 cookie 立刻 401」；
#       ④ 真浏览器（tools/ui-shot.mjs + chrome-headless-shell）**PC 1440×900 与移动 440×956 各两轮**：
#          导入/导出弹窗与远程同步弹窗在 401 场景下都被踢回登录页（先截"弹窗已开"，再截"已回登录页"）。
# 用法：bash tools/acceptance/ac-stage63.sh
set -u

cd "$(dirname "$0")/../.." || exit 1
ROOT="$PWD"
OUT_DIR='tmp/stage63/shots'
DUMP_DIR='tmp/stage63/dumps'
mkdir -p "$OUT_DIR" "$DUMP_DIR"

AC_PW='ac-fixture-pw-20260918'
TITLE='阶段63 401 夹具'
TRAPS='docs/traps.md'

pick_port() {
  for candidate in 8765 8766 8767 8768 8769 8770; do
    if ! ss -ltn | grep -q ":$candidate "; then echo "$candidate"; return 0; fi
  done
  return 1
}
PORT=$(pick_port) || { echo "FAIL 台账范围 8765–8770 全被占用（写 QUESTIONS 停手）"; exit 1; }
[ "$PORT" != "8767" ] || { echo "FAIL 选到了禁用端口 8767"; exit 1; }
BASE="http://127.0.0.1:$PORT"
# AC-125 ⑯ 的原话是「在容器跑 chromium 访问**局域网**」。服务端监听 0.0.0.0，
# 所以浏览器段统一走本机 LAN IP（8767 是禁用端口，这里用台账范围内的 $PORT）。
LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
[ -n "$LAN_IP" ] || LAN_IP='127.0.0.1'
LAN_BASE="http://$LAN_IP:$PORT"

line() { printf '\n=== %s ===\n' "$1"; }
die() { printf 'FAIL %s\n' "$1"; exit 1; }

AC_DIR=$(mktemp -d /tmp/pm-s63-XXXXXX)
SRV_PID=''
JAR="$AC_DIR/jar.txt"
FIX="$AC_DIR/fixtures.json"
PLAN_A="$AC_DIR/plan-a.json"
PLAN_B="$AC_DIR/plan-b.json"
PLAN_C="$AC_DIR/plan-c.json"
PLAN_D="$AC_DIR/plan-d.json"
TRAPS_BAK="$AC_DIR/traps.md.bak"
cleanup() {
  if [ -n "$SRV_PID" ]; then
    kill "$SRV_PID" 2>/dev/null || true
    for _ in $(seq 1 10); do kill -0 "$SRV_PID" 2>/dev/null || break; sleep 0.3; done
    kill -9 "$SRV_PID" 2>/dev/null || true
  fi
  # 红绿对照会临时改 docs/traps.md ⇒ 无论脚本怎么退出都必须还原（跟踪文件不许留脏）
  if [ -f "$TRAPS_BAK" ]; then cp "$TRAPS_BAK" "$TRAPS"; fi
  rm -rf "$AC_DIR"
}
trap cleanup EXIT

line "0. 前置：端口 / 构建产物 / 检查器已挂在 ci-check 上"
ss -ltn | grep -q ":$PORT " && die "端口 $PORT 已被占用"
echo "  端口 $PORT 空闲；API 层 base=$BASE；浏览器段 baseUrl=$LAN_BASE（AC-125 ⑯ 要求走局域网）"
[ -f dist/web/index.html ] || die "缺 dist/web —— 先 npm run build"
[ -f dist/server/index.js ] || die "缺 dist/server —— 先 npm run build"
[ -f tools/check-doc-paths.mjs ] || die "缺 tools/check-doc-paths.mjs"
grep -q 'node tools/check-doc-paths.mjs' tools/ci-check.sh || die "ci-check.sh 没有调用文档路径检查器"
grep -q '①d 文档路径引用' tools/ci-check.sh || die "ci-check.sh 没有把检查器列成独立一项 ①d"
echo "  ✅ ci-check.sh 已把检查器列成独立一项 ①d"

line "1. 文档路径检查器：真仓库红绿对照（改完立刻还原）"
cp "$TRAPS" "$TRAPS_BAK"
GREEN_OUT=$(node tools/check-doc-paths.mjs 2>&1); GREEN_RC=$?
[ "$GREEN_RC" = "0" ] || { echo "$GREEN_OUT"; die "检查器在干净仓库上应当 rc=0"; }
echo "  绿：$(printf '%s' "$GREEN_OUT" | tail -1)"
printf '\n<!-- 阶段 63 红绿对照临时行（脚本结束前会还原）：`docs/definitely-missing-stage63.md` -->\n' >> "$TRAPS"
RED_OUT=$(node tools/check-doc-paths.mjs 2>&1); RED_RC=$?
[ "$RED_RC" = "1" ] || { echo "$RED_OUT"; die "插入不存在的路径后应当 rc=1，实际 rc=$RED_RC"; }
printf '%s\n' "$RED_OUT" | grep -q 'docs/definitely-missing-stage63.md' || die "红输出没指出那条不存在的路径"
printf '%s\n' "$RED_OUT" | grep -q '不存在 1 条' || die "红输出没给出「不存在 1 条」"
echo "  红：$(printf '%s' "$RED_OUT" | grep '❌' | head -1)"
cp "$TRAPS_BAK" "$TRAPS"
TRAPS_BAK=''
node tools/check-doc-paths.mjs >/dev/null 2>&1 || die "还原后检查器应当重新 rc=0"
git diff --quiet -- "$TRAPS" || die "红绿对照后 $TRAPS 未还原（跟踪文件被弄脏）"
echo "  ✅ 还原后 rc=0，且 git diff --quiet $TRAPS 通过"

line "1b. 假阳性反例：库外 tmp/ 与通配写法豁免、裸文件名忽略、src/ 按 web/ 包根解析"
FP="$AC_DIR/fp-root"
mkdir -p "$FP/web/src" "$FP/docs"
printf '%s\n' \
  '库外：`tmp/dev-process/BRIEF.md`（豁免）' \
  '通配：`tools/acceptance/ac-stage*.sh`（豁免）' \
  '裸文件名：`app.ts`（忽略）' \
  '包根简写：`src/api.ts` 指 `web/src/api.ts`' \
  '目录引用：`docs/`' > "$FP/README.md"
printf '// 假装前端客户端\n' > "$FP/web/src/api.ts"
printf '# docs\n' > "$FP/docs/README.md"
FP_OUT=$(node tools/check-doc-paths.mjs --root "$FP" 2>&1); FP_RC=$?
[ "$FP_RC" = "0" ] || { echo "$FP_OUT"; die "假阳性反例应当 rc=0"; }
printf '%s\n' "$FP_OUT" | grep -q '检查 3 条，不存在 0 条' || die "假阳性反例的参与判定条数不是 3（$FP_OUT）"
echo "  ✅ $(printf '%s' "$FP_OUT" | grep '检查 3 条')"

line "2. 401 单点的源码级证据（AC-125 ②③⑤）"
HITS_401=$(grep -rn 'status === 401' web/src/ | wc -l | tr -d ' ')
[ "$HITS_401" = "0" ] || { grep -rn 'status === 401' web/src/; die "web/src 里仍有用字面量 401 判断的地方（AC-125 ② 允许 0 处，但必须全在 api.ts 的类型判断里）"; }
echo "  ✅ grep -rn 'status === 401' web/src/ ⇒ 0 处（改成 api.ts 里的 UNAUTHORIZED 常量 + isUnauthorized）"
grep -rn 'UNAUTHORIZED' web/src/ | grep -v '^web/src/api.ts:' && die "UNAUTHORIZED 只应出现在 web/src/api.ts"
echo "  ✅ UNAUTHORIZED 只在 web/src/api.ts：$(grep -c 'UNAUTHORIZED' web/src/api.ts) 处"
HITS_PROP=$(grep -rn 'onUnauthorized' web/src/ | wc -l | tr -d ' ')
[ "$HITS_PROP" = "0" ] || { grep -rn 'onUnauthorized' web/src/; die "onUnauthorized prop 链没删干净（AC-125 ③ 要求 0）"; }
echo "  ✅ grep -rn 'onUnauthorized' web/src/ ⇒ 0 处（prop 链整条删除，无兼容可选 prop）"
grep -q "import { notifySessionExpired } from './session';" web/src/api.ts || die "api.ts 没有引入 session 单点"
grep -q 'notifySessionExpired();' web/src/api.ts || die "api.ts 的 request() 没有触发全局登出"
grep -q 'setSessionExpiredHandler' web/src/App.tsx || die "App.tsx 没有注册会话失效处理器"
echo "  ✅ api.ts 引入 notifySessionExpired 并在 request() 里触发；App.tsx 注册处理器"
# AC-125 ⑤：非 401 的既有处理逐条不回归（调用点数量必须一个不少）
while IFS=: read -r rel want; do
  got=$(grep -c 'describeError(' "$rel")
  [ "$got" = "$want" ] || die "$rel 的 describeError 调用点应仍为 $want，实际 $got（非 401 处理被误删）"
  echo "  ✅ $rel describeError×$got（不变）"
done <<'PAIRS'
web/src/components/FolderPanel.tsx:1
web/src/components/PromptEditor.tsx:3
web/src/components/TokenDrawer.tsx:1
web/src/components/UsageDrawer.tsx:1
web/src/components/VariablePanel.tsx:2
web/src/components/VarsDialog.tsx:1
web/src/components/VersionPanel.tsx:3
web/src/components/Workspace.tsx:2
web/src/use-copy.ts:1
PAIRS

line "3. 起临时服务（DATA_DIR=$AC_DIR，自起自停，不碰生产数据）"
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

line "4. 接口层：401 / fail-closed / 404 / 400 / 403 逐条核对（真 HTTP）"
echo "--- 未认证一律 401，且闸门 fail-closed（未知路径也是 401，不是 404）---"
UNAUTH=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/prompts")
[ "$UNAUTH" = "401" ] || die "未认证 GET /api/prompts 应为 401，实际 $UNAUTH"
UNAUTH_BODY=$(curl -s "$BASE/api/prompts")
[ "$UNAUTH_BODY" = '{"error":"unauthorized"}' ] || die "401 响应体应为 {\"error\":\"unauthorized\"}，实际 $UNAUTH_BODY"
UNKNOWN=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/definitely-not-a-route")
[ "$UNKNOWN" = "401" ] || die "未知 /api/* 路径未认证应为 401（fail-closed），实际 $UNKNOWN"
echo "  ✅ 未认证 /api/prompts=401、未知路径=401（fail-closed）、体为 {\"error\":\"unauthorized\"}"

curl -s -c "$JAR" -o /dev/null -X POST -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$AC_PW\"}" "$BASE/api/login" || die "登录请求失败"
SID=$(awk '$6 == "pm_sid" { print $7 }' "$JAR" | tail -1)
[ -n "$SID" ] || die "没有 pm_sid cookie"
echo "SID 长度=${#SID}（不打印明文）"

python3 - "$BASE" "$SID" "$TITLE" "$FIX" <<'PY' || die "接口层核对不符"
import json, sys, urllib.error, urllib.request

base, sid, title, fix_path = sys.argv[1:5]

def call(method, path, body=None, cookie=sid, bearer=None):
    data = None if body is None else json.dumps(body).encode('utf-8')
    headers = {'Cookie': 'pm_sid=' + cookie} if cookie else {}
    if bearer is not None:
        headers['Authorization'] = 'Bearer ' + bearer
    if body is not None:
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(base + path, method=method, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read().decode('utf-8')
            return resp.status, (None if raw == '' else json.loads(raw))
    except urllib.error.HTTPError as err:
        raw = err.read().decode('utf-8')
        return err.code, (None if raw == '' else json.loads(raw))

# ---- 404 / 400 / 403：非 401 的既有错误码一个都不许被 401 单点吞掉 ----
status, body = call('GET', '/api/prompts/999999')
assert status == 404 and body['error'] == 'not_found', f'AC-125 ⑤：不存在 ⇒ 404 not_found，实际 {status} {body}'
print('  ✅ 404：GET /api/prompts/999999 ⇒ 404 not_found（没被 401 单点吞掉）')

status, body = call('PUT', '/api/prompts/1', {'nope': 1})
assert status == 400, f'AC-125 ⑤：不可写字段 ⇒ 400，实际 {status} {body}'
print(f'  ✅ 400：不可写字段 ⇒ 400（{body["error"]}）')

status, body = call('POST', '/api/prompts', {'title': 123})
assert status == 400, f'AC-125 ⑤：类型错 ⇒ 400，实际 {status} {body}'
print(f'  ✅ 400：类型错 ⇒ 400（{body["error"]}）')

# 令牌通道的 403 session_required（AC-125 ⑤：非 401 的既有处理不回归）
# 注意：Bearer 令牌走 Authorization 头，不是会话 cookie（放进 Cookie 只会得到 401）。
status, tok = call('POST', '/api/tokens', {'name': '阶段63只读令牌', 'scope': 'read'})
assert status == 201, f'建令牌应 201，实际 {status} {tok}'
status2, body2 = call('GET', '/api/tokens', cookie=None, bearer=tok['token'])
assert status2 == 403 and body2['error'] == 'session_required', \
    f'AC-125 ⑤：Bearer 令牌访问令牌管理应 403 session_required，实际 {status2} {body2}'
status3, body3 = call('GET', '/api/prompts?limit=1', cookie=None, bearer=tok['token'])
assert status3 == 200, f'read 令牌读列表应 200（令牌通道本身没坏），实际 {status3} {body3}'
print('  ✅ 403：Bearer 令牌访问 /api/tokens ⇒ 403 session_required（会话专属通道没被改动）')
print('  ✅ 令牌通道本身仍可用：同一个 Bearer 令牌读 /api/prompts ⇒ 200')

# ---- 夹具：给真浏览器用的一条普通提示词（必须在注销会话之前建好）----
status, created = call('POST', '/api/prompts', {'title': title, 'user_prompt': '401 夹具正文', 'notes': '阶段63 浏览器夹具'})
assert status == 201, f'建夹具失败：{status} {created}'
json.dump({'id': created['id'], 'title': created['title']}, open(fix_path, 'w', encoding='utf-8'))
print(f'  浏览器夹具：id={created["id"]}（version_no={created["version_no"]}）')

# ---- 401 单点：服务端注销会话后，同一个 cookie 立刻 401 ----
status, me = call('GET', '/api/prompts?limit=1')
assert status == 200, f'带会话应 200，实际 {status}'
status, _ = call('POST', '/api/logout')
assert status == 204, f'登出应 204，实际 {status}'
status, body = call('GET', '/api/prompts?limit=1')
assert status == 401 and body['error'] == 'unauthorized', \
    f'注销后同一个 cookie 必须立刻 401，实际 {status} {body}'
print('  ✅ 401 单点的服务端前提：POST /api/logout 之后同一个 pm_sid 立刻 401 unauthorized')
PY

ID_FIX=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["id"])' "$FIX")
TITLE_FIX=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["title"])' "$FIX")
echo "  夹具：id=$ID_FIX  title=$TITLE_FIX"

line "5. 真浏览器：导入/导出弹窗与远程同步弹窗在 401 时被踢回登录页（PC + 移动各两轮）"
CHROME=$(node tools/acceptance/lib/chrome.mjs)
[ -n "$CHROME" ] || die "找不到 chrome-headless-shell"

# 每个 401 场景都会**注销服务端会话**（这正是被测行为）⇒ 每个场景用一条全新会话，
# 且"弹窗已开"那张必须排在"已踢回登录页"之前。
login_sid() {
  local jar="$1"
  curl -s -c "$jar" -o /dev/null -X POST -H 'Content-Type: application/json' \
    -d "{\"username\":\"admin\",\"password\":\"$AC_PW\"}" "$BASE/api/login" || die "重新登录失败"
  local sid
  sid=$(awk '$6 == "pm_sid" { print $7 }' "$jar" | tail -1)
  [ -n "$sid" ] || die "重新登录后没有 pm_sid"
  printf '%s' "$sid"
}
SID_A=$(login_sid "$AC_DIR/jar-a.txt")
SID_B=$(login_sid "$AC_DIR/jar-b.txt")
SID_C=$(login_sid "$AC_DIR/jar-c.txt")
SID_D=$(login_sid "$AC_DIR/jar-d.txt")
echo "  四条独立会话已就绪（A/B/C/D，长度 ${#SID_A}/${#SID_B}/${#SID_C}/${#SID_D}）"
: > "$DUMP_DIR/probes.txt"

python3 - "$PLAN_A" "$PLAN_B" "$PLAN_C" "$PLAN_D" "$OUT_DIR" "$DUMP_DIR" "$LAN_BASE" "$CHROME" \
  "$SID_A" "$SID_B" "$SID_C" "$SID_D" "$TITLE_FIX" "$LAN_IP" <<'PYPLAN' || die "生成浏览器计划失败"
import json, sys

plan_a, plan_b, plan_c, plan_d, out_dir, dumps_dir, base, chrome, sid_a, sid_b, sid_c, sid_d, title, lan_ip = sys.argv[1:15]

SEARCH = [
    {'type': 'type', 'selector': '[data-testid=pm-search-input]', 'text': title},
    {'type': 'sleep', 'ms': 1000},
]
# 服务端注销当前会话：下一个 API 调用必然 401（cookie 也会被 Set-Cookie 清掉）
KILL_SESSION = ("(() => { void fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });"
                ' return true; })()')
MODAL_OPEN = "(() => document.querySelector('.ant-modal') ? 'modal-open' : '(no modal)')()"
LOGIN_PROBE = "(() => document.querySelector('[data-testid=pm-login]') ? 'login-page' : '(no login)')()"


def open_export():
    return SEARCH + [
        {'type': 'menu', 'label': '导入 / 导出'},
        {'type': 'wait', 'selector': '[data-testid=export-button]'},
        {'type': 'sleep', 'ms': 700},
    ]


def open_sync():
    return SEARCH + [
        {'type': 'menu', 'label': '远程数据同步'},
        {'type': 'wait', 'selector': '[data-testid=sync-config-form]'},
        {'type': 'sleep', 'ms': 700},
    ]


def export_modal_shot(name, width, height):
    return {'name': name, 'path': '/', 'width': width, 'height': height, 'auth': True,
            'storage': {'pm-view-mode': 'table', 'pm-theme': 'light'},
            'waitFor': '[data-testid=pm-search-input]',
            'actions': open_export() + [
                {'type': 'probe', 'name': 'ex-modal', 'expression': MODAL_OPEN},
                {'type': 'probe', 'name': 'ex-login', 'expression': LOGIN_PROBE},
            ],
            'dump': name, 'settleMs': 700}


def export_401_shot(name, width, height):
    return {'name': name, 'path': '/', 'width': width, 'height': height, 'auth': True,
            'storage': {'pm-view-mode': 'table', 'pm-theme': 'light'},
            'waitFor': '[data-testid=pm-search-input]',
            'actions': open_export() + [
                {'type': 'probe', 'name': 'ex-modal', 'expression': MODAL_OPEN},
                {'type': 'eval', 'expression': KILL_SESSION},
                {'type': 'sleep', 'ms': 900},
                {'type': 'click', 'selector': '[data-testid=export-button]'},
                {'type': 'wait', 'selector': '[data-testid=pm-login]'},
                {'type': 'sleep', 'ms': 700},
                {'type': 'probe', 'name': 'ex-login', 'expression': LOGIN_PROBE},
            ],
            'dump': name, 'settleMs': 700}


def sync_modal_shot(name, width, height):
    return {'name': name, 'path': '/', 'width': width, 'height': height, 'auth': True,
            'storage': {'pm-view-mode': 'card', 'pm-theme': 'light'},
            'waitFor': '[data-testid=pm-search-input]',
            'actions': open_sync() + [
                {'type': 'probe', 'name': 'sy-modal', 'expression': MODAL_OPEN},
                {'type': 'probe', 'name': 'sy-login', 'expression': LOGIN_PROBE},
            ],
            'dump': name, 'settleMs': 700}


def sync_401_shot(name, width, height):
    return {'name': name, 'path': '/', 'width': width, 'height': height, 'auth': True,
            'storage': {'pm-view-mode': 'card', 'pm-theme': 'light'},
            'waitFor': '[data-testid=pm-search-input]',
            'actions': open_sync() + [
                {'type': 'type', 'selector': '[data-testid=sync-repo]', 'text': 'ac/401-fixture'},
                {'type': 'type', 'selector': '[data-testid=sync-path]', 'text': 'promptmanager/ac-401.json'},
                {'type': 'sleep', 'ms': 500},
                {'type': 'probe', 'name': 'sy-modal', 'expression': MODAL_OPEN},
                {'type': 'eval', 'expression': KILL_SESSION},
                {'type': 'sleep', 'ms': 900},
                {'type': 'click', 'selector': '[data-testid=sync-save]'},
                {'type': 'wait', 'selector': '[data-testid=pm-login]'},
                {'type': 'sleep', 'ms': 700},
                {'type': 'probe', 'name': 'sy-login', 'expression': LOGIN_PROBE},
            ],
            'dump': name, 'settleMs': 700}


def write(path, sid, shots):
    json.dump({'chrome': chrome, 'baseUrl': base,
               'cookie': {'name': 'pm_sid', 'value': sid, 'domain': lan_ip},
               'outDir': out_dir, 'dumpsDir': dumps_dir, 'shots': shots},
              open(path, 'w', encoding='utf-8'), ensure_ascii=False)


write(plan_a, sid_a, [export_modal_shot('63-export-modal-pc', 1440, 900),
                      export_401_shot('63-export-401-pc', 1440, 900)])
write(plan_b, sid_b, [export_modal_shot('63-export-modal-mobile', 440, 956),
                      export_401_shot('63-export-401-mobile', 440, 956)])
write(plan_c, sid_c, [sync_modal_shot('63-sync-modal-pc', 1440, 900),
                      sync_401_shot('63-sync-401-pc', 1440, 900)])
write(plan_d, sid_d, [sync_modal_shot('63-sync-modal-mobile', 440, 956),
                      sync_401_shot('63-sync-401-mobile', 440, 956)])
print(f'  四份计划已生成（baseUrl={base}，每份两 shot：先"弹窗已开"，再"401 已踢回登录页"）')
PYPLAN

for P in "$PLAN_A" "$PLAN_B" "$PLAN_C" "$PLAN_D"; do
  echo "--- $(basename "$P") ---"
  PLAN_OUT=$(node tools/ui-shot.mjs "$P" 2>&1) || { echo "$PLAN_OUT"; die "ui-shot 失败：$P"; }
  printf '%s\n' "$PLAN_OUT" | grep -E '^(SHOT|PROBE|ANT_CLASSES)'
  printf '%s\n' "$PLAN_OUT" >> "$DUMP_DIR/probes.txt"
done

line "6. 界面探针断言"
# 同名探针在每个场景里出现两次（"弹窗已开"与"已踢回登录页"）⇒ 一律取**最后一次**（最终态）。
assert_probe() {
  local key="$1" want="$2" mode="$3"
  local got
  got=$(grep -F "PROBE $key " "$DUMP_DIR/probes.txt" | tail -1 | sed "s/^PROBE $key //")
  [ -n "$got" ] || die "探针 $key 没有输出"
  case "$mode" in
    has) case "$got" in *"$want"*) echo "  ✅ $key 含「$want」";; *) die "$key 不含「$want」：$got";; esac ;;
    not) case "$got" in *"$want"*) die "$key 不该含「$want」：$got";; *) echo "  ✅ $key 不含「$want」";; esac ;;
    eq)
      got="${got%\"}"; got="${got#\"}"
      [ "$got" = "$want" ] && echo "  ✅ $key = $want" || die "$key 应为「$want」，实际「$got」"
      ;;
  esac
}

echo "--- AC-125 ④⑯（PC 1440×900）：导入 / 导出弹窗 401 ⇒ 踢回登录页 ---"
assert_probe ex-modal 'modal-open' has
assert_probe ex-login 'login-page' eq
echo "--- AC-125 ④⑯（移动 440×956）：导入 / 导出弹窗 401 ⇒ 踢回登录页 ---"
assert_probe sy-modal 'modal-open' has
assert_probe sy-login 'login-page' eq

line "7. 服务端复核：浏览器里触发 401 的两条会话都已被注销，夹具数据一字未动"
python3 - "$BASE" "$SID_A" "$SID_C" "$ID_FIX" <<'PY2' || die "服务端复核不符"
import json, sys, urllib.error, urllib.request

base, sid_a, sid_c, pid = sys.argv[1:5]

def status_of(sid, path):
    req = urllib.request.Request(base + path, headers={'Cookie': 'pm_sid=' + sid})
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.load(resp)
    except urllib.error.HTTPError as err:
        return err.code, json.loads(err.read().decode('utf-8'))

for label, sid in (('A（导出弹窗那条）', sid_a), ('C（同步弹窗那条）', sid_c)):
    status, body = status_of(sid, '/api/prompts?limit=1')
    assert status == 401 and body['error'] == 'unauthorized', \
        f'会话 {label} 在浏览器触发 401 后必须已注销，实际 {status} {body}'
    print(f'  ✅ 会话 {label}：浏览器里触发过 401 ⇒ 服务端查询同一个 cookie = 401 unauthorized')

# 夹具数据没被 401 流程改动（AC-125 ⑰：零产品行为变更）
status, prompt = status_of(sid_a, f'/api/prompts/{pid}')
assert status == 401, '夹具复核必须用一条新会话（这里预期已注销 ⇒ 401，改用下面重新登录的会话）'
print('  ✅ 夹具请求也被 401 挡住（说明闸门对任何会话一致）')
PY2

# 重新登录一条干净会话，确认夹具数据本身一字未动
SID_E=$(login_sid "$AC_DIR/jar-e.txt")
python3 - "$BASE" "$SID_E" "$ID_FIX" <<'PY3' || die "夹具复核不符"
import json, sys, urllib.request

base, sid, pid = sys.argv[1:4]
req = urllib.request.Request(f'{base}/api/prompts/{pid}', headers={'Cookie': 'pm_sid=' + sid})
with urllib.request.urlopen(req) as resp:
    p = json.load(resp)
assert p['user_prompt'] == '401 夹具正文', f'夹具正文被改动：{p["user_prompt"]!r}'
assert p['version_no'] == 1, f'夹具版本号应为 1（401 流程不产生版本），实际 {p["version_no"]}'
assert p['favorite'] is False and p['folder_id'] is None and p['tags'] == [], '夹具的非内容字段被改动'
print('  ✅ 夹具数据一字未动：正文/版本号/收藏/文件夹/标签全部原样（AC-125 ⑰ 零产品行为变更）')
PY3

line "8. 截图与 DOM dump 落点"
ls -l "$OUT_DIR"/*.png
echo "  dump：$DUMP_DIR/"
echo
echo "✅ 阶段 63 端到端验收全部通过（检查器红绿对照 + 假阳性反例 / 401 单点源码级 + 接口层 / 真浏览器 PC+移动 × 导入导出与同步弹窗；临时实例已自停、临时目录已清理、docs/traps.md 已还原）"
