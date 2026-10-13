#!/usr/bin/env bash
# 阶段 61（FR-127 变量记忆可控 / FR-128 填值弹窗一键清空）一次性验收脚本 —— **交付态，随仓库入库（tools/acceptance/）**。
#
# 判据：`tmp/dev-process/BRIEF.md` 的 FR-127 / FR-128 / AC-123 / D-59 四节。
# 做法：① **在「已有数据」的库上**真跑一遍 008 迁移（先只放 001–007 建库 + 灌存量行，再升级）；
#       ② 临时 DATA_DIR + 台账范围内空闲端口（避开 8767）自起自停；真实 POST /api/login 取 cookie；
#       ③ 接口层核对默认值 / 可改 / 导出导入往返 / 开关无副作用；
#       ④ 真浏览器（项目既有零安装 CDP 工具 tools/ui-shot.mjs + chrome-headless-shell）
#          PC 1440×900 与移动 440×956：勾选框默认勾上、标题「（自动记忆）」随开关变、
#          「清空」按钮全空置灰 / 一键清空 / 取消勾选即时生效（关掉再打开不预填）/ 编辑页开关同一字段。
# 用法：bash tools/acceptance/ac-stage61.sh
set -u

cd "$(dirname "$0")/../.." || exit 1
ROOT="$PWD"
OUT_DIR='tmp/stage61/shots'
DUMP_DIR='tmp/stage61/dumps'
mkdir -p "$OUT_DIR" "$DUMP_DIR"

AC_PW='ac-fixture-pw-20260918'
TITLE_A='阶段61记忆开关 A'
TITLE_B='阶段61记忆开关 B'
LEGACY='存量61'

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

AC_DIR=$(mktemp -d /tmp/pm-s61-XXXXXX)
SRV_PID=''
JAR="$AC_DIR/jar.txt"
PLAN="$AC_DIR/plan.json"
FIX="$AC_DIR/fixtures.json"
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

line "1. 迁移：在「已有数据」的库上跑 008（先 001–007 建库 + 灌存量行，再升级）"
OLD_MIG="$AC_DIR/old-migrations"
mkdir -p "$OLD_MIG"
cp migrations/00[1-7]_*.sql "$OLD_MIG/"
echo "  旧迁移目录：$(ls "$OLD_MIG" | wc -l) 个文件（001–007）"
cat > "$AC_DIR/check-migrate.mjs" <<'MJS'
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const [root, dataDir, oldMig] = process.argv.slice(2);
const { openDatabase } = await import(pathToFileURL(`${root}/dist/db/index.js`).href);
const { runMigrations } = await import(pathToFileURL(`${root}/dist/db/migrate.js`).href);

const db = openDatabase({ dataDir });
const before = runMigrations(db, oldMig);
console.log(`  旧库（只有 001–007）→ schema v${String(before.version)}`);
assert.equal(before.version, 7, '旧库必须先停在 v7');
const colsBefore = db.prepare('PRAGMA table_info(prompts)').all().map((c) => c.name);
assert.ok(!colsBefore.includes('remember_variables'), '旧库不该有 remember_variables 列');

const now = '2026-01-01T00:00:00.000Z';
const ins = db.prepare(
  'INSERT INTO prompts (title, user_prompt, system_prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
);
// 真实的存量提示词一定有 ≥1 条版本快照（FR-7）；导出 / 导入要求 versions 非空，
// 所以这里按真实形态一起灌进去（否则不是"存量数据"而是不可能存在的脏数据）。
const insV = db.prepare(
  "INSERT INTO prompt_versions (prompt_id, version_no, title, user_prompt, system_prompt, notes, created_at) VALUES (?, 1, ?, ?, ?, '', ?)",
);
for (const [title, body] of [['存量61-A', '存量正文 A：{{项目}}'], ['存量61-B', '存量正文 B']]) {
  const id = ins.run(title, body, '', now, now).lastInsertRowid;
  insV.run(id, title, body, '', now);
}

const after = runMigrations(db, `${root}/migrations`);
console.log(`  升级（跑 008_remember-variables.sql）→ schema v${String(after.version)}`);
assert.equal(after.version, 8, '升级后必须是 v8');
const colsAfter = db.prepare('PRAGMA table_info(prompts)').all().map((c) => c.name);
assert.ok(colsAfter.includes('remember_variables'), '升级后必须有 remember_variables 列');
const rows = db.prepare('SELECT title, remember_variables FROM prompts ORDER BY id').all();
console.log(`  存量行：${rows.map((r) => `${r.title}=${String(r.remember_variables)}`).join(' / ')}`);
assert.deepEqual(
  rows.map((r) => r.remember_variables),
  [1, 1],
  'AC-123 ①：存量提示词必须一律「记住」（行为一字不变）',
);
db.close();
console.log('  ✅ 已有数据的库升级后：2 条存量提示词全部 = 记住（remember_variables=1）');
MJS
node "$AC_DIR/check-migrate.mjs" "$ROOT" "$AC_DIR" "$OLD_MIG" || die "已有数据上的迁移验证失败"

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

line "3. 真实 POST /api/login 取会话 cookie"
curl -s -c "$JAR" -o /dev/null -X POST -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$AC_PW\"}" "$BASE/api/login" || die "登录请求失败"
SID=$(awk '$6 == "pm_sid" { print $7 }' "$JAR" | tail -1)
[ -n "$SID" ] || die "没有 pm_sid cookie"
echo "SID 长度=${#SID}（不打印明文）"

line "4. 接口层：存量=记住 / 新建默认=记住 / 可改 / 往返 / 开关无副作用"
python3 - "$BASE" "$SID" "$TITLE_A" "$TITLE_B" "$LEGACY" "$FIX" <<'PY' || die "接口层核对不符"
import json, sys, urllib.error, urllib.request

base, sid, title_a, title_b, legacy, fix_path = sys.argv[1:7]
USER = '项目：{{项目}}\n语气：{{语气 | default(专业)}}'

def call(method, path, body=None):
    data = None if body is None else json.dumps(body).encode('utf-8')
    headers = {'Cookie': 'pm_sid=' + sid}
    if body is not None:
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(base + path, method=method, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read().decode('utf-8')
            return None if raw == '' else json.loads(raw)
    except urllib.error.HTTPError as err:
        raise AssertionError(f'{method} {path} → HTTP {err.code}: {err.read().decode("utf-8")}') from None

def listing():
    return call('GET', '/api/prompts?limit=100')['items']

def by_title(title):
    hits = [p for p in listing() if p['title'] == title]
    assert len(hits) == 1, f'标题 {title!r} 应恰有 1 条，实际 {len(hits)}'
    return hits[0]

# ① 存量提示词（迁移前就存在）必须是「记住」
for name in ('存量61-A', '存量61-B'):
    p = by_title(name)
    assert p['remember_variables'] is True, f'{name} 存量必须是记住，实际 {p["remember_variables"]!r}'
print('  ✅ ① 存量提示词（008 之前就存在）经迁移后一律 remember_variables=true')

# ④ 导出 / 导入往返：先让一条存量「不记住」，再 replace 往返，逐字一致
legacy_b = by_title('存量61-B')
call('PUT', f'/api/prompts/{legacy_b["id"]}', {'remember_variables': False})
before = call('GET', '/api/export')
assert all('remember_variables' in p for p in before['prompts']), '导出每条都必须带 remember_variables'
flags = {p['title']: p['remember_variables'] for p in before['prompts']}
assert flags['存量61-B'] is False, '导出的「不记住」必须逐字带上 false'
call('POST', '/api/import', {'mode': 'replace', 'data': before})
after = call('GET', '/api/export')
before.pop('exported_at'); after.pop('exported_at')
assert json.dumps(after, ensure_ascii=False, sort_keys=True) == json.dumps(before, ensure_ascii=False, sort_keys=True), \
    '导出 → 导入 → 再导出必须逐字一致'
print('  ✅ ④ 导出含 remember_variables（含 false）→ /api/import replace → 再导出逐字一致')
print('      导出里 存量61-A={} 存量61-B={}'.format(flags['存量61-A'], flags['存量61-B']))

# ② 新建默认「记住」
a = call('POST', '/api/prompts', {'title': title_a, 'user_prompt': USER})
b = call('POST', '/api/prompts', {'title': title_b, 'user_prompt': USER})
assert a['remember_variables'] is True and b['remember_variables'] is True, '新建默认必须记住'
print('  ✅ ② 新建提示词（请求体省略该字段）默认 remember_variables=true')

# ③ 可改：PUT false → 再读 false → PUT true → 再读 true
call('PUT', f'/api/prompts/{a["id"]}', {'remember_variables': False})
assert call('GET', f'/api/prompts/{a["id"]}')['remember_variables'] is False, 'PUT false 后再读必须 false'
call('PUT', f'/api/prompts/{a["id"]}', {'remember_variables': True})
assert call('GET', f'/api/prompts/{a["id"]}')['remember_variables'] is True, 'PUT true 后再读必须 true'
print('  ✅ ③ PUT /api/prompts/:id 可改该字段，改完再读一致（false → true 往返）')

# ⑥ 开关在服务端没有额外副作用：渲染 / 变量提取 / 取用记账完全相同
#    用两条**同正文**的一次性提示词（一条记住、一条不记住），走完全相同的调用序列后逐字对比。
c = call('POST', '/api/prompts', {'title': '阶段61副作用 on', 'user_prompt': USER})
d = call('POST', '/api/prompts', {'title': '阶段61副作用 off', 'user_prompt': USER, 'remember_variables': False})

def probe(pid):
    variables = call('GET', f'/api/prompts/{pid}/variables')
    rendered = call('POST', f'/api/prompts/{pid}/render', {'values': {'项目': '甲'}})
    call('POST', f'/api/prompts/{pid}/copy')
    return variables, rendered, call('GET', f'/api/prompts/{pid}')['use_count']

on = probe(c['id'])
off = probe(d['id'])
assert on[0] == off[0], f'变量提取必须完全相同：{on[0]} != {off[0]}'
assert on[1] == off[1], f'渲染结果必须完全相同：{on[1]} != {off[1]}'
assert on[2] == off[2], f'取用记账必须完全相同：{on[2]} != {off[2]}'
print('  ✅ ⑥ 开关在服务端无副作用：同正文两条（on/off）走同一序列后 /variables、/render、use_count 逐字相同')
print('      on  = {} | use_count={}'.format(json.dumps(on[1], ensure_ascii=False), on[2]))

# 把浏览器要用的两条夹具 id 写出来（A 全程「记住」，B 留给「取消勾选」）
a2 = by_title(title_a); b2 = by_title(title_b)
json.dump({'a': a2['id'], 'b': b2['id']}, open(fix_path, 'w', encoding='utf-8'))
print('  浏览器夹具：A id={} （记住） / B id={} （待取消勾选）'.format(a2['id'], b2['id']))
PY

ID_A=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["a"])' "$FIX")
ID_B=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["b"])' "$FIX")
echo "  夹具：A=$ID_A  B=$ID_B"

line "5. 真浏览器（PC 1440×900 + 移动 440×956）：勾选框 / 标题 / 清空 / 取消勾选即时生效 / 编辑页同一字段"
CHROME=$(ls -d /root/.cache/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell 2>/dev/null | sort | tail -1)
[ -n "$CHROME" ] || die "找不到 chrome-headless-shell"
python3 - "$PLAN" "$OUT_DIR" "$DUMP_DIR" "$BASE" "$SID" "$CHROME" "$ID_A" "$ID_B" "$TITLE_A" "$TITLE_B" <<'PYPLAN' || die "生成计划失败"
import json, sys
plan_path, out_dir, dumps_dir, base, sid, chrome, pid_a, pid_b, title_a, title_b = sys.argv[1:11]

def open_again(pid):
    """弹窗已关、列表已过滤好：直接再点一次该条的复制按钮。"""
    return [
        {'type': 'click', 'selector': f'[data-testid=pm-copy-{pid}]'},
        {'type': 'wait', 'selector': '[data-testid=pm-vars-dialog]'},
        {'type': 'sleep', 'ms': 800},
    ]

def search_and_open(pid, title):
    return [
        {'type': 'type', 'selector': '[data-testid=pm-search-input]', 'text': title},
        {'type': 'sleep', 'ms': 900},
    ] + open_again(pid)

def fill_project(value):
    return [
        {'type': 'type', 'selector': '[data-testid=pm-var-input-项目]', 'text': value},
        {'type': 'sleep', 'ms': 400},
    ]

def probes(tag):
    return [
        {'type': 'probe', 'name': f'{tag}-title',
         'expression': '(() => { const el = document.querySelector(".ant-modal-title"); return el ? el.innerText : "(no title)"; })()'},
        # antd Checkbox 把 restProps 透传到内层 <input> ⇒ data-testid 就在 input 上（不是 label）
        {'type': 'probe', 'name': f'{tag}-remember',
         'expression': 'String(document.querySelector("[data-testid=pm-vars-remember]") ? document.querySelector("[data-testid=pm-vars-remember]").checked : "(no checkbox)")'},
        {'type': 'probe', 'name': f'{tag}-clear-disabled',
         'expression': 'String(document.querySelector("[data-testid=pm-vars-clear]") ? document.querySelector("[data-testid=pm-vars-clear]").disabled : "(no button)")'},
        {'type': 'probe', 'name': f'{tag}-missing',
         'expression': '(() => { const el = document.querySelector("[data-testid=pm-vars-missing]"); return el ? el.innerText : "(no missing)"; })()'},
        {'type': 'probe', 'name': f'{tag}-inputs',
         'expression': '[...document.querySelectorAll("[data-testid^=pm-var-input-]")].map((n) => n.value).join("|")'},
        {'type': 'probe', 'name': f'{tag}-preview',
         'expression': '(() => { const el = document.querySelector("[data-testid=pm-vars-preview]"); return el ? el.innerText : "(no preview)"; })()'},
    ]

CLOSE_DIALOG = {'type': 'eval',
                'expression': '(() => { const b = [...document.querySelectorAll(".ant-modal-footer button")].find((n) => n.innerText.includes("取消")); if (b) { b.click(); return true; } return false; })()'}
CONFIRM = {'type': 'eval',
           'expression': '(() => { const b = [...document.querySelectorAll(".ant-modal-footer button")].find((n) => n.innerText.includes("复制结果")); if (b) { b.click(); return true; } return false; })()'}
UNCHECK = {'type': 'click', 'selector': '[data-testid=pm-vars-remember]'}
CLEAR = {'type': 'click', 'selector': '[data-testid=pm-vars-clear]'}
TOGGLE_VIEW_TABLE = {'type': 'view', 'label': '表格'}

shots = [
    # ① PC：记住时的弹窗（勾选框默认勾上、标题含「自动记忆」、填一个值后「清空」可点）
    {'name': '61-remember-pc', 'path': '/', 'width': 1440, 'height': 900, 'auth': True,
     'storage': {'pm-view-mode': 'card', 'pm-theme': 'light'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': search_and_open(pid_a, title_a) + fill_project('甲') + probes('pc1'),
     'dump': 'stage61-pc1', 'settleMs': 700},

    # ② PC：一键清空（全空 ⇒ 置灰；点一下 ⇒ 输入框空、预览回占位符、未填计数立刻更新）
    {'name': '61-clear-pc', 'path': '/', 'width': 1440, 'height': 900, 'auth': True,
     'storage': {'pm-view-mode': 'card', 'pm-theme': 'light'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': search_and_open(pid_a, title_a) + fill_project('甲') + probes('pc2-before') + [CLEAR, {'type': 'sleep', 'ms': 600}] + probes('pc2'),
     'dump': 'stage61-pc2', 'settleMs': 700},

    # ③ 移动 440×956：同一弹窗，勾选框与「清空」按钮可见可点
    {'name': '61-remember-mobile', 'path': '/', 'width': 440, 'height': 956, 'auth': True,
     'storage': {'pm-view-mode': 'card', 'pm-theme': 'light'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': search_and_open(pid_a, title_a) + fill_project('甲') + probes('m') + [
         {'type': 'eval',
          'expression': '(() => { const el = document.querySelector("[data-testid=pm-vars-dialog]"); if (el) el.scrollIntoView({ block: "start" }); return !!el; })()'},
         {'type': 'sleep', 'ms': 600},
     ],
     'dump': 'stage61-mobile', 'settleMs': 700},

    # ④ PC：取消勾选即时生效（标题立刻去掉「（自动记忆）」）→ 关掉再打开 ⇒ 不预填
    {'name': '61-noremember-pc', 'path': '/', 'width': 1440, 'height': 900, 'auth': True,
     'storage': {'pm-view-mode': 'card', 'pm-theme': 'light'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': search_and_open(pid_b, title_b) + fill_project('乙') + probes('nb1') + [
         UNCHECK, {'type': 'sleep', 'ms': 1600},
     ] + probes('nb2') + [CLOSE_DIALOG, {'type': 'sleep', 'ms': 900}] + open_again(pid_b) + probes('nb3'),
     'dump': 'stage61-nb', 'settleMs': 700},

    # ⑤ PC：编辑页的「记住变量值」开关与弹窗读写同一字段（弹窗里关掉 ⇒ 编辑页刷新后也是关）
    {'name': '61-editor-noremember-pc', 'path': '/', 'width': 1440, 'height': 900, 'auth': True,
     'storage': {'pm-view-mode': 'table', 'pm-theme': 'light'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [TOGGLE_VIEW_TABLE, {'type': 'sleep', 'ms': 400}] + [
         {'type': 'type', 'selector': '[data-testid=pm-search-input]', 'text': title_b},
         {'type': 'sleep', 'ms': 900},
         {'type': 'click', 'selector': f'[data-testid=pm-edit-{pid_b}]'},
         {'type': 'wait', 'selector': '[data-testid=pm-editor]'},
         {'type': 'sleep', 'ms': 900},
     ] + [
         # 让截图自证：把「记住变量值」开关滚到视口中央再截图（否则它在 900px 之下）
         {'type': 'eval',
          'expression': '(() => { const el = document.querySelector("[data-testid=editor-remember-variables]"); if (el) el.scrollIntoView({ block: "center" }); return !!el; })()'},
         {'type': 'sleep', 'ms': 600},
         {'type': 'probe', 'name': 'ed-switch',
          'expression': 'String((document.querySelector("[data-testid=editor-remember-variables]") || {}).getAttribute ? document.querySelector("[data-testid=editor-remember-variables]").getAttribute("aria-checked") : "(no switch)")'},
         {'type': 'probe', 'name': 'ed-label',
          'expression': '(() => { const el = document.querySelector("[data-testid=editor-remember-variables]"); return el ? (el.closest(".ant-form-item") || {}).innerText : "(no item)"; })()'},
     ],
     'dump': 'stage61-ed', 'settleMs': 700},

    # ⑥ PC：勾选状态下点「复制结果」⇒ 值照旧写进记忆，下次打开自动填充（AC-123 ⑩）
    {'name': '61-prefill-pc', 'path': '/', 'width': 1440, 'height': 900, 'auth': True,
     'storage': {'pm-view-mode': 'card', 'pm-theme': 'light'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': search_and_open(pid_a, title_a) + fill_project('甲') + [CONFIRM, {'type': 'sleep', 'ms': 1200}] + open_again(pid_a) + probes('pf'),
     'dump': 'stage61-pf', 'settleMs': 700},
]

json.dump({'chrome': chrome, 'baseUrl': base,
           'cookie': {'name': 'pm_sid', 'value': sid, 'domain': '127.0.0.1'},
           'outDir': out_dir, 'dumpsDir': dumps_dir, 'shots': shots},
          open(plan_path, 'w', encoding='utf-8'), ensure_ascii=False)
PYPLAN
PLAN_OUT=$(node tools/ui-shot.mjs "$PLAN" 2>&1) || { echo "$PLAN_OUT"; die "ui-shot 失败"; }
echo "$PLAN_OUT" | grep -E '^(SHOT|ANT_CLASSES)'
echo "$PLAN_OUT" > "$DUMP_DIR/probes.txt"

line "6. 界面探针断言"
assert_probe() {
  local key="$1" want="$2" mode="$3"
  local got
  got=$(grep -F "PROBE $key " "$DUMP_DIR/probes.txt" | head -1 | sed "s/^PROBE $key //")
  [ -n "$got" ] || die "探针 $key 没有输出"
  case "$mode" in
    has) case "$got" in *"$want"*) echo "  ✅ $key 含「$want」";; *) die "$key 不含「$want」：$got";; esac ;;
    not) case "$got" in *"$want"*) die "$key 不该含「$want」：$got";; *) echo "  ✅ $key 不含「$want」";; esac ;;
    eq)
      # ui-shot 用 JSON.stringify 打印探针值 ⇒ 字符串会带一层引号，先剥掉
      got="${got%\"}"; got="${got#\"}"
      [ "$got" = "$want" ] && echo "  ✅ $key = $want" || die "$key 应为「$want」，实际「$got」"
      ;;
  esac
}

echo "--- AC-123 ⑩：勾选状态下「复制结果」把值写进记忆，下次打开自动填充 ---"
assert_probe pf-title '请填写变量值（自动记忆）' has
assert_probe pf-remember true eq
assert_probe pf-inputs '甲|' eq
assert_probe pf-preview '项目：甲' has

echo "--- AC-123 ⑦⑫⑬⑭⑮⑯⑰⑲：记住态的弹窗（PC） ---"
assert_probe pc1-title '请填写变量值（自动记忆）' has
assert_probe pc1-remember 'true' eq
assert_probe pc1-clear-disabled 'false' eq
assert_probe pc1-missing '未填 0 个' has
assert_probe pc1-inputs '甲' has
assert_probe pc1-preview '项目：甲' has
assert_probe pc1-preview '语气：专业' has

echo "--- AC-123 ⑭⑮⑯⑰：一键清空（PC） ---"
assert_probe pc2-before-clear-disabled 'false' eq
assert_probe pc2-clear-disabled 'true' eq
assert_probe pc2-inputs '|' eq
assert_probe pc2-missing '未填 1 个' has
assert_probe pc2-preview '{{项目}}' has
assert_probe pc2-preview '语气：专业' has
assert_probe pc2-remember 'true' eq

echo "--- AC-123 ⑬⑲：移动 440×956 同一弹窗 ---"
assert_probe m-title '请填写变量值（自动记忆）' has
assert_probe m-remember 'true' eq
assert_probe m-clear-disabled 'false' eq
assert_probe m-preview '项目：甲' has

echo "--- AC-123 ⑧⑫：取消勾选即时生效 + 关掉再打开不预填（PC） ---"
assert_probe nb1-remember 'true' eq
assert_probe nb1-title '自动记忆' has
assert_probe nb2-remember 'false' eq
assert_probe nb2-title '自动记忆' not
assert_probe nb3-remember 'false' eq
assert_probe nb3-title '自动记忆' not
assert_probe nb3-inputs '|' eq
assert_probe nb3-missing '未填 1 个' has

echo "--- AC-123 ⑪：编辑页开关与弹窗读写同一字段 ---"
assert_probe ed-switch 'false' eq
assert_probe ed-label '记住变量值' has

line "7. 服务端复核：弹窗里关掉的开关真的写进了服务端"
python3 - "$BASE" "$SID" "$ID_B" <<'PY2' || die "服务端复核不符"
import json, sys, urllib.request
base, sid, pid_b = sys.argv[1:4]
req = urllib.request.Request(f'{base}/api/prompts/{pid_b}', headers={'Cookie': 'pm_sid=' + sid})
with urllib.request.urlopen(req) as resp:
    p = json.load(resp)
assert p['remember_variables'] is False, f'弹窗里取消勾选后服务端必须是 false，实际 {p["remember_variables"]!r}'
print('  ✅ AC-123 ⑧⑪ 服务端复核：提示词 B 的 remember_variables = false（弹窗里改的已落库）')
PY2

line "8. 截图与 DOM dump 落点"
ls -l "$OUT_DIR"/*.png
echo "  dump：$DUMP_DIR/"
echo
echo "✅ 阶段 61 端到端验收全部通过（已有数据的库迁移 / 接口 / 真浏览器 PC+移动；临时实例已自停、临时目录已清理）"
