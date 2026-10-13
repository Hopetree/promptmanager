#!/usr/bin/env bash
# 阶段 60（FR-126 变量默认值）一次性验收脚本 —— **交付态，随仓库入库**（运行产物落 `tmp/`，不入库）。
#
# 覆盖：AC-122 ⑮（接口形状）⑯（render 请求体形状）⑰（MCP 源码）⑱（零迁移）⑳（界面占位提示 /
#        「可留空」/「未填 N 个」只统计无默认值）㉑（PC 1440×900 + 移动 440×956 **真浏览器**）。
# 做法：临时 DATA_DIR + 台账范围内空闲端口（避开 8767）自起自停；真实 POST /api/login 取 cookie；
#       真浏览器走项目既有的零安装 CDP 工具 tools/ui-shot.mjs（chrome-headless-shell）。
# 用法：bash tools/acceptance/ac-stage60.sh
set -u

cd "$(dirname "$0")/../.." || exit 1
ROOT=$(pwd)
OUT_DIR='tmp/stage60/shots'
DUMP_DIR='tmp/stage60/dumps'
mkdir -p "$OUT_DIR" "$DUMP_DIR"

AC_PW='ac-fixture-pw-20260918'
TITLE='阶段60 默认值夹具'

pick_port() {
  for candidate in 8765 8766 8767 8768 8769 8770; do
    if ! ss -ltn | grep -q ":$candidate "; then echo "$candidate"; return 0; fi
  done
  return 1
}
PORT=$(pick_port) || { echo "FAIL 台账范围 8765–8770 全被占用（写 QUESTIONS 停手）"; exit 1; }
[ "$PORT" != "8767" ] || { echo "FAIL 选到了禁用端口 8767"; exit 1; }
BASE="http://127.0.0.1:$PORT"

line() { printf '\n=== %s ===\n' "$1"; }
die() { printf 'FAIL %s\n' "$1"; exit 1; }

AC_DIR=$(mktemp -d /tmp/pm-stage60-XXXXXX)
SRV_PID=''
JAR="$AC_DIR/jar.txt"
PLAN="$AC_DIR/plan.json"
cleanup() {
  if [ -n "$SRV_PID" ]; then
    kill "$SRV_PID" 2>/dev/null || true
    for _ in $(seq 1 10); do kill -0 "$SRV_PID" 2>/dev/null || break; sleep 0.3; done
    kill -9 "$SRV_PID" 2>/dev/null || true
  fi
  rm -rf "$AC_DIR"
}
trap cleanup EXIT

line "0. 前置：端口 / 构建产物"
ss -ltn | grep -q ":$PORT " && die "端口 $PORT 已被占用"
echo "  端口 $PORT 空闲；BASE=$BASE"
[ -f dist/web/index.html ] || die "缺 dist/web —— 先 npm run build"
[ -f dist/server/index.js ] || die "缺 dist/server —— 先 npm run build"

line "1. 起临时服务（DATA_DIR=$AC_DIR，自起自停，不碰生产数据）"
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

line "2. 真实 POST /api/login 取会话 cookie"
curl -s -c "$JAR" -o /dev/null -X POST -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$AC_PW\"}" "$BASE/api/login" || die "登录请求失败"
SID=$(awk '$6 == "pm_sid" { print $7 }' "$JAR" | tail -1)
[ -n "$SID" ] || die "没有 pm_sid cookie"
echo "SID 长度=${#SID}（不打印明文）"

line "3. 建夹具 prompt（正文含全部默认值形态）"
FIXTURE="$AC_DIR/fixture.json"
python3 - "$FIXTURE" "$TITLE" <<'PYFIX' || die "生成夹具失败"
import json, sys
path, title = sys.argv[1:3]
text = '\n'.join([
    '你是 {{项目}} 的交接助手。',
    "语气：{{语气 | default(专业)}}；署名：{{署名 | default('匿名')}}。",
    '空默认：{{空默认 | default()}}；不认识的：{{x | upper}}；无括号：{{y | default}}。',
    '转义：\\{{转义默认 | default(z)}}。',
    '重复：{{重复默认 | default(第一)}} 与 {{重复默认 | default(第二)}}。',
])
json.dump({'title': title, 'user_prompt': text, 'system_prompt': ''}, open(path, 'w', encoding='utf-8'), ensure_ascii=False)
PYFIX
CREATED=$(curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' --data-binary @"$FIXTURE" "$BASE/api/prompts")
ID=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["id"])' "$CREATED") || die "建 prompt 失败：$CREATED"
echo "  prompt id=$ID"

line "4. AC-122 ⑮：GET /variables 形状不变 + defaults 平行字段"
VARS=$(curl -s -b "$JAR" "$BASE/api/prompts/$ID/variables")
echo "  原样返回：$VARS"
python3 - "$VARS" <<'PYV' || die "variables 契约不符"
import json, sys
got = json.loads(sys.argv[1])
assert set(got.keys()) == {'variables', 'defaults'}, f'顶层键不对：{sorted(got.keys())}'
assert got['variables'] == ['项目', '语气', '署名', '空默认', '重复默认'], got['variables']
assert got['defaults'] == {'语气': '专业', '署名': '匿名', '空默认': '', '重复默认': '第一'}, got['defaults']
print('  ✅ variables 是纯字符串数组（形状不变）；defaults 只含有默认值的项，空默认是空串')
PYV

line "5. AC-122 ⑨⑩⑪⑫：render 语义（请求体形状不变）"
R0=$(curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' -d '{"values":{}}' "$BASE/api/prompts/$ID/render")
echo "  values={} → $R0"
python3 - "$R0" <<'PYR' || die "render 语义不符（未填）"
import json, sys
got = json.loads(sys.argv[1])
assert set(got.keys()) == {'user_prompt', 'system_prompt', 'missing'}, sorted(got.keys())
t = got['user_prompt']
assert got['missing'] == ['项目'], got['missing']
assert '你是 {{项目}} 的交接助手。' in t, t
assert '语气：专业；' in t, t
assert '署名：匿名。' in t, t
assert '空默认：；' in t, t
assert '{{x | upper}}' in t and '{{y | default}}' in t, t
assert '转义：{{转义默认 | default(z)}}。' in t, t
assert '重复：第一 与 第一。' in t, t
print('  ✅ 没填→默认值且不进 missing；显式字面保留；转义去反斜杠；同名取首次；不认识的按字面')
PYR
R1=$(curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' -d '{"values":{"语气":""}}' "$BASE/api/prompts/$ID/render")
echo "  values={\"语气\":\"\"} → 前 60 字：$(python3 -c 'import json,sys;print(json.loads(sys.argv[1])["user_prompt"][:60].replace(chr(10)," | "))' "$R1")"
python3 - "$R1" <<'PYR1' || die "显式空串语义不符"
import json, sys
got = json.loads(sys.argv[1])
assert '语气：；' in got['user_prompt'], got['user_prompt']
assert got['missing'] == ['项目'], got['missing']
print('  ✅ 显式空串渲染成空（不回落默认值），也不进 missing')
PYR1

line "6. AC-122 ⑰⑱：MCP prompt_get 带 defaults；零迁移"
grep -q 'defaults: variables.data.defaults' src/mcp/server.ts || die "MCP prompt_get 没带 defaults"
echo "  ✅ src/mcp/server.ts prompt_get 返回 defaults"
MIG=$(ls migrations/ | sort | tr '\n' ' ')
WANT='001_init.sql 002_tokens-and-usage.sql 003_prompt-sort-order.sql 004_token-enc.sql 005_token-scope.sql 006_usage-kind.sql 007_sync-config.sql '
[ "$MIG" = "$WANT" ] || die "migrations/ 清单变了（阶段 60 要求零迁移）：$MIG"
echo "  ✅ migrations/ 仍是开工前那 7 个文件、逐字未变 ⇒ 零迁移"

line "7. AC-122 ⑳㉑：真浏览器（PC 1440×900 + 移动 440×956）"
CHROME=$(ls -d /root/.cache/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell 2>/dev/null | sort | tail -1)
[ -n "$CHROME" ] || die "找不到 chrome-headless-shell"
python3 - "$PLAN" "$OUT_DIR" "$DUMP_DIR" "$BASE" "$SID" "$CHROME" "$TITLE" <<'PYPLAN' || die "生成计划失败"
import json, sys
plan_path, out_dir, dumps_dir, base, sid, chrome, title = sys.argv[1:8]

def open_dialog():
    return [
        {'type': 'view', 'label': '卡片'},
        {'type': 'sleep', 'ms': 400},
        # 用搜索把夹具过滤成唯一一张卡，再点它的「填值」复制按钮
        {'type': 'type', 'selector': '[data-testid=pm-search-input]', 'text': title},
        {'type': 'sleep', 'ms': 900},
        {'type': 'eval',
         'expression': '(() => { const btns = [...document.querySelectorAll("[data-testid^=pm-copy-]")]; if (btns.length === 0) return false; btns[0].click(); return true; })()'},
        {'type': 'wait', 'selector': '[data-testid=pm-vars-dialog]'},
        {'type': 'sleep', 'ms': 700},
    ]

def probes(tag):
    return [
        {'type': 'probe', 'name': f'{tag}-labels',
         'expression': '[...document.querySelectorAll("[data-testid=pm-vars-dialog] .ant-form-item-label label")].map((x) => x.innerText).join(" / ")'},
        {'type': 'probe', 'name': f'{tag}-placeholder-语气',
         'expression': 'document.querySelector("[data-testid=\\"pm-var-input-语气\\"]").placeholder'},
        {'type': 'probe', 'name': f'{tag}-placeholder-项目',
         'expression': 'document.querySelector("[data-testid=\\"pm-var-input-项目\\"]").placeholder'},
        {'type': 'probe', 'name': f'{tag}-missing-none-filled',
         'expression': 'document.querySelector("[data-testid=pm-vars-missing]").innerText'},
        {'type': 'probe', 'name': f'{tag}-preview',
         'expression': 'document.querySelector("[data-testid=pm-vars-preview]").innerText.replace(/\\n/g, " | ")'},
    ]

def after_fill(tag):
    return [
        {'type': 'type', 'selector': '[data-testid="pm-var-input-项目"]', 'text': '温室'},
        {'type': 'sleep', 'ms': 700},
        {'type': 'probe', 'name': f'{tag}-missing-all-filled',
         'expression': 'document.querySelector("[data-testid=pm-vars-missing]").innerText'},
        {'type': 'probe', 'name': f'{tag}-preview-filled',
         'expression': 'document.querySelector("[data-testid=pm-vars-preview]").innerText.replace(/\\n/g, " | ")'},
    ]

shots = [
    # 未填状态（未填 1 个 —— 只算没有默认值的那个）
    {'name': '60-vars-defaults-pc-unfilled', 'path': '/', 'width': 1440, 'height': 900, 'auth': True,
     'storage': {'pm-view-mode': 'split', 'pm-theme': 'light'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': open_dialog() + probes('pc0'),
     'dump': 'stage60-vars-pc-unfilled', 'settleMs': 900},
    {'name': '60-vars-defaults-pc', 'path': '/', 'width': 1440, 'height': 900, 'auth': True,
     'storage': {'pm-view-mode': 'split', 'pm-theme': 'light'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': open_dialog() + probes('pc') + after_fill('pc'),
     'dump': 'stage60-vars-pc', 'settleMs': 900},
    {'name': '60-vars-defaults-mobile', 'path': '/', 'width': 440, 'height': 956, 'auth': True,
     'storage': {'pm-view-mode': 'split', 'pm-theme': 'light'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': open_dialog() + probes('m') + after_fill('m'),
     'dump': 'stage60-vars-mobile', 'settleMs': 900},
]

json.dump({'chrome': chrome, 'baseUrl': base,
           'cookie': {'name': 'pm_sid', 'value': sid, 'domain': '127.0.0.1'},
           'outDir': out_dir, 'dumpsDir': dumps_dir, 'shots': shots},
          open(plan_path, 'w', encoding='utf-8'), ensure_ascii=False)
PYPLAN
PLAN_OUT=$(node tools/ui-shot.mjs "$PLAN" 2>&1) || { echo "$PLAN_OUT"; die "ui-shot 失败"; }
echo "$PLAN_OUT"
echo "$PLAN_OUT" > "$DUMP_DIR/probes.txt"

line "8. AC-122 ⑳：界面探针断言"
assert_probe() {
  local key="$1" want="$2" mode="$3"
  local got
  got=$(grep -F "PROBE $key " "$DUMP_DIR/probes.txt" | head -1 | sed "s/^PROBE $key //")
  [ -n "$got" ] || die "探针 $key 没有输出"
  case "$mode" in
    has)  case "$got" in *"$want"*) echo "  ✅ $key 含「$want」：$got";; *) die "$key 不含「$want」：$got";; esac ;;
    not)  case "$got" in *"$want"*) die "$key 不该含「$want」：$got";; *) echo "  ✅ $key 不含「$want」";; esac ;;
  esac
}
for tag in pc m; do
  assert_probe "$tag-labels" '语气（可留空）' has
  assert_probe "$tag-labels" '署名（可留空）' has
  assert_probe "$tag-labels" '空默认（可留空）' has
  assert_probe "$tag-placeholder-语气" '留空则用默认值：专业' has
  assert_probe "$tag-placeholder-项目" '{{项目}} 的值' has
  assert_probe "$tag-missing-none-filled" '未填 1 个' has
  assert_probe "$tag-missing-all-filled" '未填 0 个' has
  assert_probe "$tag-preview" '语气：专业' has
  assert_probe "$tag-preview" '署名：匿名' has
  assert_probe "$tag-preview-filled" '语气：专业' has
  assert_probe "$tag-preview-filled" '你是 温室 的交接助手' has
done
assert_probe 'pc0-missing-none-filled' '未填 1 个' has
assert_probe 'pc0-preview' '语气：专业' has
assert_probe 'pc0-preview' '{{项目}}' has

line "9. 截图与 DOM dump 落点"
ls -l "$OUT_DIR"/*.png
echo "  dump：$DUMP_DIR/"
echo
echo "✅ 阶段 60 端到端验收全部通过（临时实例已自停、临时目录已清理）"
