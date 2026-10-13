#!/usr/bin/env bash
# 阶段 60 返工 ①（跨段默认值口径）一次性验收脚本 —— **交付态，随仓库入库**（运行产物落 `tmp/`，不入库）。
#
# 判据：同一变量名在用户段与系统段默认值不同时，
#       GET /variables 报出的 defaults ≡ POST /render 两段**实际替换进去**的值。
# 做法：临时 DATA_DIR + 台账范围内空闲端口（避开 8767）自起自停；真实 POST /api/login 取 cookie；
#       真浏览器走项目既有的零安装 CDP 工具 tools/ui-shot.mjs（chrome-headless-shell），
#       在**变量面板**（服务端渲染两段）上量系统段是否真的换成了接口报的那个默认值。
# 用法：bash tools/acceptance/ac-stage60-rework1.sh
set -u

cd "$(dirname "$0")/../.." || exit 1
OUT_DIR='tmp/stage60-rework1/shots'
DUMP_DIR='tmp/stage60-rework1/dumps'
mkdir -p "$OUT_DIR" "$DUMP_DIR"

AC_PW='ac-fixture-pw-20260918'
TITLE='阶段60返工① 跨段默认值'

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

AC_DIR=$(mktemp -d /tmp/pm-rw1-XXXXXX)
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

line "3. 返工①：跨段 7 例逐条对照（接口报的默认值 ≡ 两段实际替换的值）"
python3 - "$BASE" "$SID" "$TITLE" "$AC_DIR/first.json" <<'PY' || die "跨段口径不符"
import json, re, sys, urllib.request

base, sid, title, first_path = sys.argv[1:5]

def call(method, path, body=None):
    data = None if body is None else json.dumps(body).encode('utf-8')
    req = urllib.request.Request(base + path, method=method, data=data,
                                 headers={'Content-Type': 'application/json', 'Cookie': 'pm_sid=' + sid})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode('utf-8'))

CASES = [
    ('两段默认值不同 ⇒ 只认首次（用户段在前）', 'U={{ m | default(甲) }}', 'S={{ m | default(乙) }}', {},
     {'m': '甲'}, 'U=甲', 'S=甲', []),
    ('用户段内两次 + 系统段第三次 ⇒ 三处都用用户段首次那个', 'U={{ m | default(甲) }} 与 {{ m | default(丙) }}', 'S={{ m | default(乙) }}', {},
     {'m': '甲'}, 'U=甲 与 甲', 'S=甲', []),
    ('用户段首次没写默认值 ⇒ 该名全篇无默认值（既有首次出现口径不变）', 'U={{ m }}', 'S={{ m | default(乙) }}', {},
     {}, 'U={{ m }}', 'S={{ m | default(乙) }}', ['m']),
    ('用户段有默认值、系统段裸占位符 ⇒ 系统段也用全篇表', 'U={{ m | default(甲) }}', 'S={{ m }}', {},
     {'m': '甲'}, 'U=甲', 'S=甲', []),
    ('只在系统段有默认值', 'U=纯文本', 'S={{ m | default(乙) }}', {},
     {'m': '乙'}, 'U=纯文本', 'S=乙', []),
    ('显式值优先于两段的默认值', 'U={{ m | default(甲) }}', 'S={{ m | default(乙) }}', {'m': '显式'},
     {'m': '甲'}, 'U=显式', 'S=显式', []),
    ('显式空串 ⇒ 渲染成空（不回落默认值）', 'U={{ m | default(甲) }}', 'S={{ m | default(乙) }}', {'m': ''},
     {'m': '甲'}, 'U=', 'S=', []),
]

first_id = None
for idx, (label, user, system, values, want_defaults, want_user, want_system, want_missing) in enumerate(CASES, 1):
    created = call('POST', '/api/prompts', {'title': f'{title} #{idx}', 'user_prompt': user, 'system_prompt': system})
    pid = created['id']
    if first_id is None:
        first_id = pid
    report = call('GET', f'/api/prompts/{pid}/variables')
    assert set(report.keys()) == {'variables', 'defaults'}, f'#{idx} 顶层键不对：{sorted(report.keys())}'
    assert report['variables'] == ['m'], f'#{idx} variables 形状/内容不对：{report["variables"]}'
    assert report['defaults'] == want_defaults, f'#{idx} /variables 报的默认值 {report["defaults"]} != {want_defaults}'

    rendered = call('POST', f'/api/prompts/{pid}/render', {'values': values})
    assert set(rendered.keys()) == {'user_prompt', 'system_prompt', 'missing'}, f'#{idx} render 顶层键不对'
    assert rendered['user_prompt'] == want_user, f'#{idx} 用户段 {rendered["user_prompt"]!r} != {want_user!r}'
    assert rendered['system_prompt'] == want_system, f'#{idx} 系统段 {rendered["system_prompt"]!r} != {want_system!r}'
    assert rendered['missing'] == want_missing, f'#{idx} missing {rendered["missing"]} != {want_missing}'

    # 逐条对照（双向）：报有默认值的不得残留占位符、不得进 missing；报没有的必须进 missing 且保留占位符
    residual = re.compile(r'\\?\{\{\s*m\b')
    for name, fallback in report['defaults'].items():
        if isinstance(values.get(name), str):
            continue
        assert not residual.search(rendered['user_prompt']), f'#{idx} 用户段仍残留 {{{{{name}}}}} —— 接口报了默认值却没替换'
        assert not residual.search(rendered['system_prompt']), f'#{idx} 系统段仍残留 {{{{{name}}}}} —— 接口报了默认值却没替换'
        assert fallback in rendered['user_prompt'] or fallback in rendered['system_prompt'], \
            f'#{idx} 接口报的默认值 {fallback!r} 没出现在任何一段'
        assert name not in rendered['missing'], f'#{idx} 有默认值的变量不得进 missing：{name}'
    if report['defaults'] == {} and not isinstance(values.get('m'), str):
        assert 'm' in rendered['missing'], f'#{idx} 无默认值且没填 ⇒ 必须进 missing'
        assert residual.search(rendered['user_prompt']) or residual.search(rendered['system_prompt']), \
            f'#{idx} 无默认值 ⇒ 必须原样保留占位符'
    print(f'  ✅ #{idx} {label}')
    print(f'       /variables → defaults={json.dumps(report["defaults"], ensure_ascii=False)}')
    print(f'       /render    → user={rendered["user_prompt"]!r} system={rendered["system_prompt"]!r} missing={rendered["missing"]}')

json.dump({'id': first_id, 'title': f'{title} #1'}, open(first_path, 'w', encoding='utf-8'), ensure_ascii=False)
print(f'  逐条对照：接口报的默认值与两段实际替换的值**逐例一致**（7/7）')
PY

ID=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["id"])' "$AC_DIR/first.json")
FIX_TITLE=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["title"])' "$AC_DIR/first.json")
echo "  真浏览器要用的夹具：id=$ID title=$FIX_TITLE"

line "4. 返工①：真浏览器 —— 变量面板（服务端渲染两段）必须两段都用「甲」"
CHROME=$(ls -d /root/.cache/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell 2>/dev/null | sort | tail -1)
[ -n "$CHROME" ] || die "找不到 chrome-headless-shell"
python3 - "$PLAN" "$OUT_DIR" "$DUMP_DIR" "$BASE" "$SID" "$CHROME" "$ID" "$FIX_TITLE" <<'PYPLAN' || die "生成计划失败"
import json, sys
plan_path, out_dir, dumps_dir, base, sid, chrome, pid, title = sys.argv[1:9]

def open_panel():
    return [
        {'type': 'view', 'label': '表格'},
        {'type': 'sleep', 'ms': 500},
        # 用搜索把夹具过滤成唯一一行，再点它的「编辑」按钮进编辑器
        {'type': 'type', 'selector': '[data-testid=pm-search-input]', 'text': title},
        {'type': 'sleep', 'ms': 1000},
        {'type': 'click', 'selector': f'[data-testid=pm-edit-{pid}]'},
        {'type': 'wait', 'selector': '[data-testid=pm-panel-variables]'},
        {'type': 'sleep', 'ms': 800},
        # 不填任何值直接渲染 ⇒ 服务端应用全篇默认值（这正是用户报的现场）
        {'type': 'click', 'selector': '[data-testid=render-submit]'},
        {'type': 'sleep', 'ms': 1200},
    ]

def probes(tag):
    return [
        {'type': 'probe', 'name': f'{tag}-var-label',
         'expression': '[...document.querySelectorAll("[data-testid=pm-panel-variables] .ant-form-item-label label")].map((x) => x.innerText).join(" / ")'},
        {'type': 'probe', 'name': f'{tag}-var-placeholder',
         'expression': '(() => { const el = document.querySelector("[data-testid=var-m]"); const inp = el && (el.matches("input,textarea") ? el : el.querySelector("input,textarea")); return inp ? inp.placeholder : "(no input)"; })()'},
        {'type': 'probe', 'name': f'{tag}-panels',
         'expression': '[...document.querySelectorAll("[data-testid=pm-panel-variables] .ant-card")].map((c) => { const t = c.querySelector(".ant-card-head-title"); const a = c.querySelector("textarea"); return (t ? t.innerText : "?") + " => " + (a ? a.value : "?"); }).join(" || ")'},
    ]

shots = [
    {'name': '60-rw1-cross-defaults-pc', 'path': '/', 'width': 1440, 'height': 900, 'auth': True,
     'storage': {'pm-view-mode': 'split', 'pm-theme': 'light'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': open_panel() + probes('pc'),
     'dump': 'stage60-rw1-pc', 'settleMs': 900},
    {'name': '60-rw1-cross-defaults-mobile', 'path': '/', 'width': 440, 'height': 956, 'auth': True,
     'storage': {'pm-view-mode': 'split', 'pm-theme': 'light'},
     'waitFor': '[data-testid=pm-search-input]',
     # 移动端窄屏下变量面板在折叠下方 ⇒ 截图前滚到面板，让截图本身自证（探针仍是 DOM 读取）
     'actions': open_panel() + probes('m') + [
         {'type': 'eval', 'expression': '(() => { const el = document.querySelector("[data-testid=pm-panel-variables]"); if (el) el.scrollIntoView({ block: "start" }); return !!el; })()'},
         {'type': 'sleep', 'ms': 600},
     ],
     'dump': 'stage60-rw1-mobile', 'settleMs': 900},
]

json.dump({'chrome': chrome, 'baseUrl': base,
           'cookie': {'name': 'pm_sid', 'value': sid, 'domain': '127.0.0.1'},
           'outDir': out_dir, 'dumpsDir': dumps_dir, 'shots': shots},
          open(plan_path, 'w', encoding='utf-8'), ensure_ascii=False)
PYPLAN
PLAN_OUT=$(node tools/ui-shot.mjs "$PLAN" 2>&1) || { echo "$PLAN_OUT"; die "ui-shot 失败"; }
echo "$PLAN_OUT" | tail -20
echo "$PLAN_OUT" > "$DUMP_DIR/probes.txt"

line "5. 返工①：界面探针断言（系统段必须是甲，不是乙）"
assert_probe() {
  local key="$1" want="$2" mode="$3"
  local got
  got=$(grep -F "PROBE $key " "$DUMP_DIR/probes.txt" | head -1 | sed "s/^PROBE $key //")
  [ -n "$got" ] || die "探针 $key 没有输出"
  case "$mode" in
    has)  case "$got" in *"$want"*) echo "  ✅ $key 含「$want」";; *) die "$key 不含「$want」：$got";; esac ;;
    not)  case "$got" in *"$want"*) die "$key 不该含「$want」：$got";; *) echo "  ✅ $key 不含「$want」";; esac ;;
  esac
}
for tag in pc m; do
  assert_probe "$tag-var-label" 'm（可留空）' has
  assert_probe "$tag-var-placeholder" '留空则用默认值：甲' has
  # 关键：接口报「甲」⇒ 用户段与系统段都必须渲染成甲
  assert_probe "$tag-panels" '渲染结果 · 用户提示词 => U=甲' has
  assert_probe "$tag-panels" '渲染结果 · 系统提示词 => S=甲' has
  assert_probe "$tag-panels" 'S=乙' not
done
echo
echo "  界面原样（$tag 之一）：$(grep -F 'PROBE pc-panels ' "$DUMP_DIR/probes.txt" | sed 's/^PROBE pc-panels //')"

line "6. 截图与 DOM dump 落点"
ls -l "$OUT_DIR"/*.png
echo "  dump：$DUMP_DIR/"
echo
echo "✅ 阶段 60 返工 ① 端到端验收全部通过（临时实例已自停、临时目录已清理）"
