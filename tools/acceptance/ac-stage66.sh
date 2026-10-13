#!/usr/bin/env bash
# 阶段 66 端到端验收（交付态，随仓库入库）：字段集单一来源（FR-138 / AC-128）
#
# 验的是什么：
#   1) 源码级/编译期自证：`tests/stage66-field-source.test.ts` 6 条（含四处派生类型与改前字面形状逐字段等价的编译期证明）
#   2) 接口层：**所有 8 个可写字段**建得进去、读得出来、导出得出来（AC-128 的"零行为变更"硬证据）
#   3) 导出 → 导入(replace) → 再导出 **逐字一致**（AC-128 交付要求里的实证）
#   4) 真浏览器 PC 1440×900 + 移动 440×956：编辑器四个字段回填正确、列表/卡片/详情显示正常、无变更保存不产生新版本
#   5) 服务端复核：浏览器动作真的落在库里
set -u
cd "$(dirname "$0")/../.."
ROOT="$PWD"

OUT_DIR='tmp/stage66/shots'
DUMP_DIR='tmp/stage66/dumps'
AC_PW='ac-fixture-pw-20260918'
FIX="$ROOT/tmp/stage66/fixture.json"

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
[ "$COUNT" = "8" ] || die "migrations 应为 8 个（零迁移），实际 $COUNT"
ls migrations/009_*.sql >/dev/null 2>&1 && die "不该存在 009 迁移（AC-128 ⑩ 零迁移）"
echo "  ✅ dist 产物齐、migrations=$COUNT、无 009（零迁移）"

line "1. 源码级 + 编译期自证（AC-128 ①②③⑩⑬）"
SRC_OUT=$(node --test tests/stage66-field-source.test.ts 2>&1) || { printf '%s\n' "$SRC_OUT" | tail -20; die "stage66-field-source 测试未全绿"; }
printf '%s\n' "$SRC_OUT" | grep -E '^ℹ (tests|pass|fail) '
printf '%s\n' "$SRC_OUT" | grep -q '^ℹ pass 10' || die "应有 10 条通过（返工 ① 加了 4 条守卫）"
printf '%s\n' "$SRC_OUT" | grep -q '^ℹ fail 0' || die "不得有失败"
echo "  ✅ 6/6（含四处派生类型的编译期等价证明）"

PORT=$(pick_port) || die "8765–8770 全被占用"
BASE="http://127.0.0.1:$PORT"
LAN_IP=$(hostname -I | awk '{print $1}')
LAN_BASE="http://$LAN_IP:$PORT"
AC_DIR=$(mktemp -d /tmp/pm-s66-XXXXXX)
JAR="$AC_DIR/cookies.txt"
PLAN_PC="$AC_DIR/plan-pc.json"
PLAN_MOBILE="$AC_DIR/plan-mobile.json"
mkdir -p "$ROOT/$OUT_DIR" "$ROOT/$DUMP_DIR" "$ROOT/tmp/stage66"
cleanup() {
  [ -n "${SRV_PID:-}" ] && kill "$SRV_PID" 2>/dev/null
  rm -rf "$AC_DIR"
}
trap cleanup EXIT
echo "  PORT=$PORT（8767 禁用）LAN_BASE=$LAN_BASE"

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

line "3. 真登录"
curl -s -c "$JAR" -o /dev/null -X POST -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$AC_PW\"}" "$BASE/api/login" || die "登录请求失败"
SID=$(awk '$6 == "pm_sid" { print $7 }' "$JAR" | tail -1)
[ -n "$SID" ] || die "没有 pm_sid cookie"
echo "SID 长度=${#SID}（不打印明文）"

line "4. 接口层：8 个可写字段 + 导出/导入/再导出逐字一致（AC-128）"
python3 - "$BASE" "$SID" "$FIX" <<'PY' || die "接口层不符"
import json, sys, urllib.error, urllib.request

base, sid, fix_path = sys.argv[1:4]

# 服务端契约对象（PromptObject）的键集合：11 个进契约的列字段 + 3 个派生字段（FR-138 单一来源）
# 注意 `sort_order` 的 `api: 'none'` ⇒ **不进**接口对象，只进导出文件
API_KEYS = ['created_at', 'favorite', 'folder_id', 'id', 'last_used_at', 'notes',
            'remember_variables', 'system_prompt', 'tags', 'title',
            'updated_at', 'use_count', 'user_prompt', 'version_no']
# 导出对象（ExportPrompt）的键集合：13 个（列字段里去掉 last_used_at/use_count 之外的派生，带 versions）
EXPORT_KEYS = ['created_at', 'favorite', 'folder_id', 'id', 'notes', 'remember_variables',
               'sort_order', 'system_prompt', 'tags', 'title', 'updated_at', 'user_prompt', 'versions']


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


def canon(value):
    if isinstance(value, dict):
        return {k: canon(v) for k, v in sorted(value.items())}
    if isinstance(value, list):
        return [canon(v) for v in value]
    return value


# ① 目录 + 两条夹具：A 把所有可写字段都写上，B 只写最小字段（验缺省）
status, folder = call('POST', '/api/folders', {'name': '阶段66目录'})
expect(status == 201, f'建目录应 201，实际 {status} {folder}')
fid = folder['id']

status, a = call('POST', '/api/prompts', {
    'title': '阶段66字段 A', 'user_prompt': '正文 A', 'system_prompt': '系统 A',
    'notes': '备注 A', 'folder_id': fid, 'tags': ['66标签乙', '66标签甲'],
    'favorite': True, 'remember_variables': False,
})
expect(status == 201, f'建 A 应 201，实际 {status} {a}')
expect(a['favorite'] is True, f'favorite 应为 true，实际 {a.get("favorite")!r}')
expect(a['remember_variables'] is False, f'remember_variables 应为 false，实际 {a.get("remember_variables")!r}')
expect(a['folder_id'] == fid, f'folder_id 应为 {fid}，实际 {a.get("folder_id")!r}')
TAGS_SORTED = sorted(['66标签乙', '66标签甲'])  # 甲=U+7532、乙=U+4E59 ⇒ 按码点排序「乙」在前
expect(sorted(a['tags']) == TAGS_SORTED, f'tags 应为两条（名称升序），实际 {a.get("tags")!r}')
expect(a['notes'] == '备注 A' and a['system_prompt'] == '系统 A', 'notes/system_prompt 未落库')
expect(sorted(a.keys()) == API_KEYS, f'接口对象键集合必须等于 14 个契约字段，实际 {sorted(a.keys())}')
pid_a = a['id']

status, b = call('POST', '/api/prompts', {'title': '阶段66字段 B', 'user_prompt': '正文 B'})
expect(status == 201, f'建 B 应 201，实际 {status} {b}')
expect(b['favorite'] is False, f'B 的 favorite 缺省应为 false，实际 {b.get("favorite")!r}')
expect(b['remember_variables'] is True, f'B 的 remember_variables 缺省应为 true，实际 {b.get("remember_variables")!r}')
expect(b['folder_id'] is None and b['tags'] == [], 'B 的 folder_id/tags 缺省不对')
pid_b = b['id']

# ② 排序（sort_order 列）真的生效，且能随导出/导入往返
status, order = call('PATCH', '/api/prompts/order', {'ids': [pid_b, pid_a]})
expect(status in (200, 204), f'重排应 200/204，实际 {status} {order}')
status, listed = call('GET', '/api/prompts?limit=50')
expect(status == 200, f'列表应 200，实际 {status}')
# `sort_order` 的 `api: 'none'` ⇒ 接口对象里**没有**这个键，只能从导出文件里看（这正是"单一来源"的一条判据）
expect('sort_order' not in listed['items'][0], '接口对象不应含 sort_order（api: none）')
status, ordered = call('GET', '/api/export')
expect(status == 200, f'导出应 200，实际 {status}')
by_export = {p['id']: p for p in ordered['prompts']}
expect(by_export[pid_b]['sort_order'] < by_export[pid_a]['sort_order'],
       f'重排后 B 的 sort_order 应小于 A，实际 {by_export[pid_b]["sort_order"]} vs {by_export[pid_a]["sort_order"]}')
print(f'  重排后 sort_order（导出文件）：B={by_export[pid_b]["sort_order"]} A={by_export[pid_a]["sort_order"]} ✅')

# ③ 导出 → 键集合/键顺序 → 导入(replace) → 再导出 ⇒ 逐字一致
status, first = call('GET', '/api/export')
expect(status == 200, f'导出应 200，实际 {status}')
expect('exported_at' in first, '导出文件应有 exported_at')
expect(sorted(first['prompts'][0].keys()) == EXPORT_KEYS,
       f'导出对象键集合必须等于 13 个契约字段，实际 {sorted(first["prompts"][0].keys())}')
order_before = list(first['prompts'][0].keys())
print(f'  导出对象键顺序：{order_before}')

status, result = call('POST', '/api/import', {'mode': 'replace', 'data': first})
expect(status == 200, f'导入(replace)应 200，实际 {status} {result}')
expect(result['imported']['prompts'] == 2, f'应导入 2 条，实际 {result["imported"]}')

status, second = call('GET', '/api/export')
expect(status == 200, f'再导出应 200，实际 {status}')
first_stripped = {k: v for k, v in first.items() if k != 'exported_at'}
second_stripped = {k: v for k, v in second.items() if k != 'exported_at'}
expect(canon(first_stripped) == canon(second_stripped),
       '导出 → 导入(replace) → 再导出 必须逐字一致（除 exported_at）')
expect(json.dumps(first['prompts'], ensure_ascii=False) == json.dumps(second['prompts'], ensure_ascii=False),
       'prompts 段必须逐字一致')
expect(list(second['prompts'][0].keys()) == order_before, '再导出的键顺序必须不变')
print('  ✅ 导出 → 导入(replace) → 再导出：整份（除 exported_at）与 prompts 段逐字一致，键顺序不变')

# ④ 导入后每个字段仍读得出来（不是"导入成功但字段丢了"）
status, again = call('GET', f'/api/prompts/{pid_a}')
expect(status == 200, f'导入后取 A 应 200，实际 {status}')
for field, want in [('title', '阶段66字段 A'), ('user_prompt', '正文 A'), ('system_prompt', '系统 A'),
                    ('notes', '备注 A'), ('folder_id', fid), ('favorite', True), ('remember_variables', False)]:
    expect(again[field] == want, f'导入后 {field} 应为 {want!r}，实际 {again[field]!r}')
expect(sorted(again['tags']) == TAGS_SORTED, f'导入后 tags 不对：{again["tags"]!r}')
by_second = {p['id']: p for p in second['prompts']}
expect(by_second[pid_a]['sort_order'] == by_export[pid_a]['sort_order'], '导入后 sort_order 应保持')
print('  ✅ 导入后 8 个可写字段 + sort_order 全部读回原值')

json.dump({'a': pid_a, 'b': pid_b, 'titleA': '阶段66字段 A', 'titleB': '阶段66字段 B',
           'folder': fid, 'folderName': '阶段66目录', 'tags': ['66标签甲', '66标签乙']},
          open(fix_path, 'w', encoding='utf-8'))
print(f'  夹具 A={pid_a} B={pid_b} 目录={fid}')
PY

line "5. 真浏览器：PC 1440×900 + 移动 440×956"
CHROME=$(node tools/acceptance/lib/chrome.mjs)
[ -n "$CHROME" ] || die "找不到 chrome-headless-shell"
OUT_ABS="$ROOT/$OUT_DIR"
DUMP_ABS="$ROOT/$DUMP_DIR"

python3 - "$LAN_BASE" "$LAN_IP" "$SID" "$CHROME" "$OUT_ABS" "$DUMP_ABS" "$PLAN_PC" "$PLAN_MOBILE" "$FIX" <<'PY' || die "计划生成失败"
import json, sys

base, lan_ip, sid, chrome, out_dir, dumps_dir, plan_pc, plan_mobile, fix_path = sys.argv[1:10]
fixture = json.load(open(fix_path, encoding='utf-8'))
pid = fixture['a']
title = fixture['titleA']
tags = fixture['tags']
folder = fixture['folderName']

EDITOR_TITLE = "document.querySelector('[data-testid=\"editor-title\"]')?.value ?? ''"
EDITOR_USER = "document.querySelector('[data-testid=\"editor-user-prompt\"]')?.value ?? ''"
SWITCH_FAV = "document.querySelector('[data-testid=editor-favorite]')?.getAttribute('aria-checked') ?? ''"
SWITCH_REMEMBER = "document.querySelector('[data-testid=editor-remember-variables]')?.getAttribute('aria-checked') ?? ''"
DETAIL_TEXT = "document.querySelector('[data-testid=pm-detail]')?.innerText ?? ''"
DETAIL_BODY = "document.querySelector('[data-testid=pm-detail-body]')?.innerText ?? ''"
TOASTS = "[...document.querySelectorAll('.ant-message-notice')].map(n => n.innerText).join(' | ')"

SELECT_SPLIT_ITEM = """(() => { const items = [...document.querySelectorAll('[data-testid="pm-split-item"]')];
  const item = items.find(n => n.innerText.includes(%s));
  if (!item) return 'no-item'; item.click(); return 'clicked'; })()""" % json.dumps(title, ensure_ascii=False)

DBLCLICK_CARD = """(() => { const cards = [...document.querySelectorAll('[data-testid="pm-use-card"]')];
  const card = cards.find(n => n.innerText.includes(%s));
  if (!card) return 'no-card';
  card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
  return 'dblclicked'; })()""" % json.dumps(title, ensure_ascii=False)

ROW_TEXT = """(() => { const rows = [...document.querySelectorAll('tbody tr')];
  const row = rows.find(n => n.innerText.includes(%s));
  return row ? row.innerText : 'no-row'; })()""" % json.dumps(title, ensure_ascii=False)

CARD_TEXT = """(() => { const cards = [...document.querySelectorAll('[data-testid="pm-use-card"]')];
  const card = cards.find(n => n.innerText.includes(%s));
  return card ? card.innerText : 'no-card'; })()""" % json.dumps(title, ensure_ascii=False)

SEARCH = {'type': 'type', 'selector': '[data-testid=pm-search-input]', 'text': title}

# PC ①：分栏 → 编辑器四个字段回填正确 + 详情里有标签与目录 → 无变更保存（不得产生新版本）
shot_fields_pc = {
    'name': '66-fields-pc', 'path': '/', 'width': 1440, 'height': 900, 'auth': True,
    'storage': {'pm-view-mode': 'split', 'pm-theme': 'light'},
    'waitFor': '[data-testid=pm-search-input]',
    'actions': [
        SEARCH, {'type': 'sleep', 'ms': 800},
        {'type': 'eval', 'expression': SELECT_SPLIT_ITEM},
        {'type': 'wait', 'selector': '[data-testid=pm-detail-body]'},
        {'type': 'sleep', 'ms': 700},
        {'type': 'probe', 'name': 'fp-detail', 'expression': DETAIL_TEXT},
        {'type': 'click', 'selector': '[data-testid=pm-detail-edit]'},
        {'type': 'wait', 'selector': '[data-testid=pm-editor]'},
        {'type': 'sleep', 'ms': 500},
        {'type': 'probe', 'name': 'fp-title', 'expression': EDITOR_TITLE},
        {'type': 'probe', 'name': 'fp-user', 'expression': EDITOR_USER},
        {'type': 'probe', 'name': 'fp-fav', 'expression': SWITCH_FAV},
        {'type': 'probe', 'name': 'fp-remember', 'expression': SWITCH_REMEMBER},
        {'type': 'click', 'selector': '[data-testid=editor-save]'},
        {'type': 'sleep', 'ms': 1500},
        {'type': 'probe', 'name': 'fp-toast', 'expression': TOASTS},
    ],
    'dump': '66-fields-pc', 'settleMs': 700,
}

# PC ②：表格视图一行显示标题 / 标签 / 目录 / 版本（字段渲染未变）
shot_list_pc = {
    'name': '66-list-pc', 'path': '/', 'width': 1440, 'height': 900, 'auth': True,
    'storage': {'pm-view-mode': 'table', 'pm-theme': 'light'},
    'waitFor': '[data-testid=pm-search-input]',
    'actions': [
        SEARCH, {'type': 'sleep', 'ms': 900},
        {'type': 'probe', 'name': 'lp-row', 'expression': ROW_TEXT},
    ],
    'dump': '66-list-pc', 'settleMs': 700,
}

# 移动端：卡片显示标题 → 双击进详情 → 详情正文
shot_mobile = {
    'name': '66-fields-mobile', 'path': '/', 'width': 440, 'height': 956, 'auth': True,
    'storage': {'pm-view-mode': 'card', 'pm-theme': 'light'},
    'waitFor': '[data-testid=pm-search-input]',
    'actions': [
        SEARCH, {'type': 'sleep', 'ms': 900},
        {'type': 'probe', 'name': 'mf-card', 'expression': CARD_TEXT},
        {'type': 'eval', 'expression': DBLCLICK_CARD},
        {'type': 'wait', 'selector': '[data-testid=pm-detail-body]'},
        {'type': 'sleep', 'ms': 800},
        {'type': 'probe', 'name': 'mf-body', 'expression': DETAIL_BODY},
    ],
    'dump': '66-fields-mobile', 'settleMs': 700,
}


def write(path, shots):
    json.dump({'chrome': chrome, 'baseUrl': base,
               'cookie': {'name': 'pm_sid', 'value': sid, 'domain': lan_ip},
               'outDir': out_dir, 'dumpsDir': dumps_dir, 'shots': shots},
              open(path, 'w', encoding='utf-8'), ensure_ascii=False)


write(plan_pc, [shot_fields_pc, shot_list_pc])
write(plan_mobile, [shot_mobile])
print(f'  两份计划已生成（PC 2 shot + 移动 1 shot；baseUrl={base}；标签={tags}；目录={folder}）')
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

echo "--- 编辑器四个字段回填正确（AC-128 零行为变更：界面照旧）---"
assert_probe fp-title '阶段66字段 A' eq
assert_probe fp-user '正文 A' eq
assert_probe fp-fav 'true' eq
assert_probe fp-remember 'false' eq
echo "--- 详情面板仍显示标签与目录 ---"
assert_probe fp-detail '66标签甲' has
assert_probe fp-detail '66标签乙' has
assert_probe fp-detail '阶段66目录' has
echo "--- 无内容变更保存：成功提示，且不得产生新版本（FR-129 不回归）---"
assert_probe fp-toast '已保存' has
assert_probe fp-toast 'v1' has
echo "--- 表格视图一行渲染正常 ---"
assert_probe lp-row '阶段66字段 A' has
assert_probe lp-row '阶段66目录' has
assert_probe lp-row '66标签甲' has
echo "--- 移动端卡片 + 详情正文 ---"
assert_probe mf-card '阶段66字段 A' has
assert_probe mf-body '正文 A' has

line "7. 服务端复核：浏览器流程真的没改变数据（版本号仍为 1）"
python3 - "$BASE" "$SID" "$FIX" <<'PY' || die "服务端复核不符"
import json, sys, urllib.error, urllib.request

base, sid, fix_path = sys.argv[1:4]
fixture = json.load(open(fix_path, encoding='utf-8'))
pid = fixture['a']


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
expect(prompt['version_no'] == 1, f'浏览器只做了无变更保存 ⇒ version_no 应仍为 1，实际 {prompt["version_no"]}')
expect(prompt['title'] == '阶段66字段 A' and prompt['user_prompt'] == '正文 A', '字段值被改动')
expect(prompt['favorite'] is True and prompt['remember_variables'] is False, '开关字段被改动')
expect(sorted(prompt['tags']) == sorted(['66标签乙', '66标签甲']), f'tags 被改动：{prompt["tags"]!r}')
expect(prompt['folder_id'] == fixture['folder'], 'folder_id 被改动')

status, versions = call('GET', f'/api/prompts/{pid}/versions')
expect(status == 200, f'版本列表应 200，实际 {status}')
expect(len(versions['items']) == 1, f'版本行数应仍为 1，实际 {len(versions["items"])}')
print('  ✅ 库里：8 个可写字段 + sort_order 原值，version_no=1，版本行数=1')
PY

line "8. 截图与产物落点"
ls -l "$OUT_DIR" | tail -8
echo "  截图目录：$OUT_DIR（交付态，随仓库入库）"
echo "  探针全文：$DUMP_DIR/probes.txt"
printf '\nALL STAGE66 ACCEPTANCE CHECKS PASSED\n'
