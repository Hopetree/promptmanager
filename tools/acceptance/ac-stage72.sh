#!/usr/bin/env bash
# 阶段 72 端到端验收（交付态，随仓库入库）：后端数据 · 安全 · 契约（FR-155 ~ FR-159 / AC-134）
#
# 验的是什么（本阶段动的是文件权限 / 鉴权配置 / 导入导出契约 / 写路径 ⇒ 全量复跑 + 真浏览器自证）：
#   A 权限   ：服务启动路径下 pm.db / -wal / -shm 都是 0600（新建与既有两条路径见 tests/db-permissions.test.ts）
#   B PUBLIC_ORIGIN：http:// 在配置层就被拒绝且报错可指导运维（原样输出）
#   C 导入导出：超长字段两个入口同形拒绝、version_no 重复解析期拒（见 tests/import-limits.test.ts）；
#              merge 的真实语义与文档/界面一致 ⇒ **界面文案变了**，PC 1440×900 DPR2 / 移动 440×956 DPR3 双端自证
#   E 读路径 ：/api/* 带 cache-control: no-store，/healthz 不带
#   通用     ：零迁移（migrations 仍 10）、零新增依赖（package.json / lock 与 HEAD 无 diff）
set -u
cd "$(dirname "$0")/../.."
ROOT="$PWD"

OUT_DIR='tmp/stage72/shots'
DUMP_DIR='tmp/stage72/dumps'
AC_PW='ac-fixture-pw-20260918'
T1='阶段72甲'
T2='阶段72乙'
NOTE='重复条目'

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
AC_DIR=$(mktemp -d /tmp/pm-s72-XXXXXX)
JAR="$AC_DIR/cookies.txt"
PLAN_PC="$AC_DIR/plan-pc.json"
PLAN_MOBILE="$AC_DIR/plan-mobile.json"
FIXTURE="$AC_DIR/import-fixture.json"
mkdir -p "$ROOT/$OUT_DIR" "$ROOT/$DUMP_DIR"
cleanup() {
  [ -n "${SRV_PID:-}" ] && kill "$SRV_PID" 2>/dev/null
  rm -rf "$AC_DIR"
}
trap cleanup EXIT
echo "  PORT=$PORT（8767 禁用）LAN_BASE=$LAN_BASE AC_DIR=$AC_DIR"

line "1. N2：PUBLIC_ORIGIN=http:// 必须在配置层被拒绝（起不来，而不是"登录 200 但会话不保持"）"
set +e
N2_OUT=$(PUBLIC_ORIGIN="http://$LAN_IP:$PORT" DATA_DIR="$AC_DIR/n2" PORT="$PORT" node dist/server/index.js 2>&1)
N2_RC=$?
set -e
printf '%s\n' "$N2_OUT" | head -3
[ "$N2_RC" -ne 0 ] || die "PUBLIC_ORIGIN=http:// 竟然启动成功了（rc=$N2_RC）"
printf '%s\n' "$N2_OUT" | grep -q 'PUBLIC_ORIGIN' || die "报错没点名 PUBLIC_ORIGIN"
printf '%s\n' "$N2_OUT" | grep -q 'https://' || die "报错没说明该填什么"
echo "  ✅ 拒绝 http（rc=$N2_RC），报错点名 PUBLIC_ORIGIN 且给出正确形态"

line "2. 起临时服务 + 真登录 + 接口层建两条夹具"
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

python3 - "$BASE" "$SID" "$AC_DIR" "$T1" "$T2" <<'PY' || die "接口层不符"
import json, sys, urllib.parse, urllib.request

base, sid, ac_dir, t1, t2 = sys.argv[1:6]

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
for title in (t1, t2):
    status, created = call('POST', '/api/prompts', {'title': title, 'user_prompt': '正文 ' + title})
    assert status == 201, (status, created)
    ids[title] = created['id']
with open(f'{ac_dir}/ids.json', 'w') as fh:
    json.dump(ids, fh)
status, listed = call('GET', '/api/prompts?limit=50')
assert status == 200 and listed['total'] == 2, (status, listed)
print(f"  夹具：{t1}=#{ids[t1]}，{t2}=#{ids[t2]}；列表 total={listed['total']}")

# 真导出 → 作为导入弹窗的夹具文件（界面里要走"选文件 → 分析 → merge 提示"这条真实路径）
status, exported = call('GET', '/api/export')
assert status == 200 and exported['app'] == 'promptmanager', (status, exported)
with open(f'{ac_dir}/import-fixture.json', 'w') as fh:
    json.dump(exported, fh)
print(f"  导出夹具已落盘（prompts={len(exported['prompts'])}）")
PY

line "3. N1：服务启动路径下 pm.db / -wal / -shm 权限（原样）"
for f in pm.db pm.db-wal pm.db-shm; do
  MODE=$(stat -c '%a' "$AC_DIR/$f" 2>/dev/null || echo 'missing')
  printf '  %s %s\n' "$MODE" "$f"
  [ "$MODE" = "600" ] || die "$f 权限应为 600，实际 $MODE"
done
echo "  ✅ 三条都是 600"

line "4. N39：/api/* 带 cache-control: no-store（/healthz 不带）"
API_HDR=$(curl -s -D - -o /dev/null -H "cookie: pm_sid=$SID" "$BASE/api/prompts")
printf '%s\n' "$API_HDR" | grep -i '^cache-control' | sed 's/^/  /'
printf '%s\n' "$API_HDR" | grep -qi 'cache-control: no-store' || die "/api/prompts 缺 no-store"
HEALTH_HDR=$(curl -s -D - -o /dev/null "$BASE/healthz")
if printf '%s\n' "$HEALTH_HDR" | grep -qi 'cache-control'; then die "/healthz 不该带 cache-control"; fi
DENIED_HDR=$(curl -s -D - -o /dev/null "$BASE/api/prompts")
printf '%s\n' "$DENIED_HDR" | grep -qi 'cache-control: no-store' || die "未认证 401 也要带 no-store"
echo "  ✅ /api/*（含 401）带 no-store，/healthz 不带"

line "5. 真浏览器计划：PC 1440×900 DPR2 + 移动 440×956 DPR3（导入弹窗的 merge 文案）"
CHROME=$(node tools/acceptance/lib/chrome.mjs)
[ -n "$CHROME" ] || die "找不到 chrome-headless-shell"
OUT_ABS="$ROOT/$OUT_DIR"
DUMP_ABS="$ROOT/$DUMP_DIR"

python3 - "$LAN_BASE" "$LAN_IP" "$SID" "$CHROME" "$OUT_ABS" "$DUMP_ABS" "$PLAN_PC" "$PLAN_MOBILE" \
  "$FIXTURE" "$NOTE" <<'PY' || die "计划生成失败"
import json, sys

base, lan_ip, sid, chrome, out_dir, dumps_dir, plan_pc, plan_mobile, fixture, note = sys.argv[1:11]

OVERFLOW = "(() => document.documentElement.scrollWidth > window.innerWidth ? 'overflow' : 'none')()"
VIEWPORT = "`${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio}`"
MODAL = "document.querySelector('.pm-import-export') !== null"
# merge 提示的正文（Alert 的 description）：必须点明"会产生重复条目"
MERGE_NOTE = ("document.querySelector('.pm-import-export .ant-alert-description')?.innerText ?? 'no-alert'")
SIDER = "document.querySelectorAll('.ant-layout-sider').length > 0"


def plan(name, width, height, dpr, prefix):
    return {
        'name': name, 'path': '/', 'width': width, 'height': height, 'dpr': dpr, 'auth': True,
        'storage': {'pm-view-mode': 'split', 'pm-theme': 'light'},
        'waitFor': '[data-testid=pm-search-input]',
        'actions': [
            {'type': 'probe', 'name': prefix + 'viewport', 'expression': VIEWPORT},
            {'type': 'menu', 'label': '导入 / 导出'},
            {'type': 'wait', 'selector': '.pm-import-export'},
            {'type': 'file', 'selector': 'input[type=file]', 'files': [fixture]},
            {'type': 'sleep', 'ms': 900},
            {'type': 'probe', 'name': prefix + 'modal', 'expression': MODAL},
            {'type': 'probe', 'name': prefix + 'merge-note', 'expression': MERGE_NOTE},
            {'type': 'probe', 'name': prefix + 'overflow', 'expression': OVERFLOW},
            {'type': 'probe', 'name': prefix + 'sider', 'expression': SIDER},
        ],
        'dump': name,
    }


pc = plan('72-pc-import-merge-note', 1440, 900, 2, 'p-')
mobile = plan('72-mobile-import-merge-note', 440, 956, 3, 'm-')


def write(path, shots):
    json.dump({'chrome': chrome, 'baseUrl': base,
               'cookie': {'name': 'pm_sid', 'value': sid, 'domain': lan_ip},
               'outDir': out_dir, 'dumpsDir': dumps_dir, 'shots': shots},
              open(path, 'w', encoding='utf-8'), ensure_ascii=False)


write(plan_pc, [pc])
write(plan_mobile, [mobile])
print(f"  两份计划已生成（PC 1440x900 dpr=2 + 移动 440x956 dpr=3）；提示文案必须含「{note}」")
PY

: > "$DUMP_DIR/probes.txt"
for P in "$PLAN_PC" "$PLAN_MOBILE"; do
  echo "--- $(basename "$P") ---"
  PLAN_OUT=$(node tools/ui-shot.mjs "$P" 2>&1) || { printf '%s\n' "$PLAN_OUT" | tail -30; die "ui-shot 失败：$P"; }
  printf '%s\n' "$PLAN_OUT" | grep -E '^(SHOT|PROBE|ANT_CLASSES)'
  printf '%s\n' "$PLAN_OUT" >> "$DUMP_DIR/probes.txt"
done

line "6. 界面探针断言（取最后一次同名探针）"
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
assert_probe m-viewport '440x956@3' eq
# 弹窗在、merge 提示如实告知"重复导入会产生重复条目"
assert_probe p-modal 'true' eq
assert_probe m-modal 'true' eq
assert_probe p-merge-note "$NOTE" has
assert_probe m-merge-note "$NOTE" has
# 无页面级横向滚动（两端）
assert_probe p-overflow 'none' eq
assert_probe m-overflow 'none' eq
# 断点单一来源的行为面：桌面有侧栏、移动没有（同一份代码，两个 viewport）
assert_probe p-sider 'true' eq
assert_probe m-sider 'false' eq

line "7. 截图与产物落点"
ls -1 "$ROOT/$OUT_DIR" | sed 's/^/  /'
echo "  dumps: $DUMP_DIR（DOM 快照 + probes.txt）"

line "✅ ALL STAGE72 ACCEPTANCE CHECKS PASSED"
