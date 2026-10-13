#!/usr/bin/env bash
# 阶段 68 端到端验收（交付态，随仓库入库）：性能与本地残留（FR-140 ~ FR-143 / AC-130）
#
# 验的是什么：
#   1) 迁移 009 在**已有数据的库**上真的应用（v8 → v9），且 FTS 触发器带上 WHEN
#   2) 可观测口径：改非索引列 = 1 行变更、改内容列 = 9 行变更（对照：旧触发器下改收藏也是 9）
#   3) 接口层：include=folder_counts 的数字与"逐个 ?folder_id=N&limit=1 的 total"逐条相同；
#      不传 include 时响应里**没有**这个键；改内容列后真检索能命中新内容
#   4) 真浏览器 PC 1440×900 + 移动 440×956：侧栏计数、编辑页关开关后 localStorage 键被删、
#      变量弹窗取消勾选后键被删、移动端令牌抽屉掩码显示且明文不落 Web Storage
#   5) 服务端复核：schema=v9、触发器定义含 WHEN、库里的开关值真的落盘
set -u
cd "$(dirname "$0")/../.."
ROOT="$PWD"

OUT_DIR='tmp/stage68/shots'
DUMP_DIR='tmp/stage68/dumps'
AC_PW='ac-fixture-pw-20260918'
FIX="$ROOT/tmp/stage68/fixture.json"

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
[ "$COUNT" = "9" ] || die "migrations 应为 9 个（本阶段新增 009），实际 $COUNT"
[ -f migrations/009_fts-update-when.sql ] || die "缺 migrations/009_fts-update-when.sql"
echo "  ✅ dist 产物齐、migrations=$COUNT（含 009_fts-update-when.sql）"

PORT=$(pick_port) || die "8765–8770 全被占用"
BASE="http://127.0.0.1:$PORT"
LAN_IP=$(hostname -I | awk '{print $1}')
LAN_BASE="http://$LAN_IP:$PORT"
AC_DIR=$(mktemp -d /tmp/pm-s68-XXXXXX)
JAR="$AC_DIR/cookies.txt"
PLAN_PC="$AC_DIR/plan-pc.json"
PLAN_MOBILE="$AC_DIR/plan-mobile.json"
mkdir -p "$ROOT/$OUT_DIR" "$ROOT/$DUMP_DIR" "$ROOT/tmp/stage68" "$AC_DIR/legacy-migrations"
cp migrations/00[1-8]_*.sql "$AC_DIR/legacy-migrations/"
cleanup() {
  [ -n "${SRV_PID:-}" ] && kill "$SRV_PID" 2>/dev/null
  rm -rf "$AC_DIR"
}
trap cleanup EXIT
echo "  PORT=$PORT（8767 禁用）LAN_BASE=$LAN_BASE AC_DIR=$AC_DIR"

line "1. 已有数据的库上跑迁移（001–008 建库 + 灌存量行 → 应用 009）与 FTS 可观测口径"
cat > "$AC_DIR/check-migrate.mjs" <<'MJS'
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [dir, root] = process.argv.slice(2);
const load = async (rel) => import(pathToFileURL(path.join(root, rel)).href);
const { openDatabase } = await load('dist/db/index.js');
const { runMigrations } = await load('dist/db/migrate.js');
const { loadConfig } = await load('dist/config.js');

const db = openDatabase(loadConfig({ DATA_DIR: dir }));
const legacyDir = path.join(dir, 'legacy-migrations');
const first = runMigrations(db, legacyDir);
if (first.version !== 8) throw new Error(`旧库应停在 v8，实际 ${String(first.version)}`);
console.log(`  旧库（001–008）= v${String(first.version)}`);

const NOW = '2026-10-12T00:00:00.000Z';
db.exec(`INSERT INTO prompts (title, user_prompt, system_prompt, notes, created_at, updated_at)
         VALUES ('阶段68存量', '存量正文', '', '', '${NOW}', '${NOW}')`);
const row = db.prepare('SELECT id FROM prompts ORDER BY id DESC LIMIT 1').get();
db.exec(`INSERT INTO prompt_versions (prompt_id, version_no, title, user_prompt, created_at)
         VALUES (${String(row.id)}, 1, '阶段68存量', '存量正文', '${NOW}')`);
console.log(`  存量数据：prompt id=${String(row.id)}（含 1 个版本快照）`);

const second = runMigrations(db, path.join(root, 'migrations'));
if (second.version !== 9) throw new Error(`迁移后应为 v9，实际 ${String(second.version)}`);
console.log(`  迁移后 = v${String(second.version)}（应用了 ${JSON.stringify(second.applied)}）`);

const triggers = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='trigger' AND name='prompts_fts_au'").all();
if (triggers.length !== 1) throw new Error(`prompts_fts_au 应恰好 1 个，实际 ${String(triggers.length)}`);
const triggerSql = triggers[0].sql;
if (!/WHEN old\.title IS NOT new\.title/.test(triggerSql)) throw new Error('触发器定义里没有 WHEN 子句');
if (!/IS NOT new\.notes/.test(triggerSql)) throw new Error('触发器 WHEN 没覆盖 notes');
console.log('  触发器定义含 WHEN（4 个内容列）✅');

const delta = (sql) => {
  const before = db.prepare('SELECT total_changes() AS n').get().n;
  db.exec(sql);
  return db.prepare('SELECT total_changes() AS n').get().n - before;
};
const favorite = delta(`UPDATE prompts SET favorite = 1 WHERE id = ${String(row.id)}`);
const title = delta(`UPDATE prompts SET title = '阶段68存量改' WHERE id = ${String(row.id)}`);
const same = delta(`UPDATE prompts SET title = '阶段68存量改' WHERE id = ${String(row.id)}`);
console.log(`  total_changes：favorite=${String(favorite)} title=${String(title)} 同值写回=${String(same)}`);
if (favorite !== 1) throw new Error(`改非索引列应 1 行变更，实际 ${String(favorite)}`);
if (title !== 9) throw new Error(`改内容列应 9 行变更（触发器 delete+insert），实际 ${String(title)}`);
if (same !== 1) throw new Error(`写回同值应 1 行变更，实际 ${String(same)}`);

const hits = db.prepare('SELECT count(*) AS n FROM prompts_fts WHERE prompts_fts MATCH ?').get('阶段68存量改').n;
if (hits < 1) throw new Error('改了内容列之后真检索不到新内容（FTS 索引没建）');
console.log(`  真检索 MATCH '阶段68存量改' 命中 ${String(hits)} 条 ✅`);

// 对照：把 001 里那份**无 WHEN** 的旧触发器装回去，改收藏立刻变 9 ⇒ 证明这个口径看得见"重建"
const legacy = db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='prompts_fts_au'").get().sql
  .replace(/AFTER UPDATE ON prompts\s+WHEN[\s\S]*?BEGIN/, 'AFTER UPDATE ON prompts\nBEGIN');
db.exec('DROP TRIGGER prompts_fts_au');
db.exec(legacy);
const control = delta(`UPDATE prompts SET favorite = 0 WHERE id = ${String(row.id)}`);
console.log(`  对照（装回无 WHEN 的旧触发器）改收藏 = ${String(control)} 行变更`);
if (control !== 9) throw new Error(`对照应 9（看得见重建），实际 ${String(control)}`);

// 对照会把旧触发器留在库里 ⇒ 把 009 重新执行一遍装回正确版本（DROP IF EXISTS + CREATE，幂等）
db.exec(fs.readFileSync(path.join(root, 'migrations/009_fts-update-when.sql'), 'utf8'));
const restored = db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='prompts_fts_au'").get().sql;
if (!/WHEN old\.title IS NOT new\.title/.test(restored)) throw new Error('对照之后没能把带 WHEN 的触发器装回去');
console.log('  已装回带 WHEN 的触发器（对照不留副作用）');
db.close();
console.log('  ✅ 迁移在已有数据的库上成功、触发器带 WHEN、口径可观测且有对照');
MJS
node "$AC_DIR/check-migrate.mjs" "$AC_DIR" "$ROOT" || die "迁移 / FTS 口径不符"

line "2. 起临时服务（DATA_DIR 就是上面那个已迁移的库，自起自停，不碰生产数据）"
printf '%s\n' "$AC_PW" | DATA_DIR="$AC_DIR" node bin/pm.mjs user set-password --username admin >/dev/null || die "设口令失败"
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

line "4. 接口层：folder_counts 同口径 + 不传就没有这个键 + 改内容列后真检索（AC-130 ②⑥⑦）"
python3 - "$BASE" "$SID" "$FIX" <<'PY' || die "接口层不符"
import json, sys, urllib.error, urllib.request

base, sid, fix_path = sys.argv[1:4]


def call(method, path, body=None):
    data = None if body is None else json.dumps(body).encode('utf-8')
    headers = {'Cookie': 'pm_sid=' + sid}
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


# ① 三层目录（根甲 → 子甲 → 孙甲）+ 独立根乙；prompt 分布：孙 1、子 1、根 1、根乙 0
def mkfolder(name, parent=None):
    status, folder = call('POST', '/api/folders', {'name': name, 'parent_id': parent})
    expect(status == 201, f'建目录 {name} 应 201，实际 {status} {folder}')
    return folder['id']


root_a = mkfolder('阶段68根甲')
sub_a = mkfolder('阶段68子甲', root_a)
grand_a = mkfolder('阶段68孙甲', sub_a)
root_b = mkfolder('阶段68根乙')


def mkprompt(title, user, folder):
    status, prompt = call('POST', '/api/prompts', {'title': title, 'user_prompt': user, 'folder_id': folder})
    expect(status == 201, f'建 prompt {title} 应 201，实际 {status} {prompt}')
    return prompt['id']


pid_grand = mkprompt('阶段68孙条目', '孙正文', grand_a)
pid_sub = mkprompt('阶段68子条目', '子正文', sub_a)
pid_root = mkprompt('阶段68根条目', '根正文', root_a)
pid_mem_edit = mkprompt('阶段68记忆编辑', '项目：{{项目}}', root_a)
pid_mem_dialog = mkprompt('阶段68记忆弹窗', '项目：{{项目}}', root_a)

status, listed = call('GET', '/api/prompts?limit=1&include=folder_counts')
expect(status == 200, f'带 include 的列表应 200，实际 {status} {listed}')
counts = listed.get('folder_counts')
expect(isinstance(counts, dict), f'folder_counts 应是对象，实际 {counts!r}')
# 根甲自己 3 条（根条目 + 两条变量夹具）+ 子甲 1 条 + 孙甲 1 条 = 5（子树计数）
want = {str(root_a): 5, str(sub_a): 2, str(grand_a): 1, str(root_b): 0}
for key, value in want.items():
    expect(counts.get(key) == value, f'folder_counts[{key}] 应为 {value}，实际 {counts.get(key)!r}')

# 旧口径（改前前端就是这么算的）：逐个 ?folder_id=N&limit=1 的 total —— 必须逐个相同
for folder_id in (root_a, sub_a, grand_a, root_b):
    status, one = call('GET', f'/api/prompts?folder_id={folder_id}&limit=1')
    expect(status == 200, f'逐个列表应 200，实际 {status}')
    expect(one['total'] == want[str(folder_id)],
           f'folder_id={folder_id} 的 total={one["total"]} 与 folder_counts={want[str(folder_id)]} 不一致')
print(f'  ✅ folder_counts={counts} 与逐个 ?folder_id 的 total 逐条相同（含后代）')

status, plain = call('GET', '/api/prompts?limit=1')
expect(status == 200, f'不带 include 应 200，实际 {status}')
expect('folder_counts' not in plain, '不传 include 时响应里不得出现 folder_counts（只加不改）')
print('  ✅ 不传 include ⇒ 响应里没有 folder_counts 键')

# ② 改内容列 ⇒ 真检索命中新内容；改非索引列 ⇒ 检索不受影响
status, updated = call('PUT', f'/api/prompts/{pid_root}', {'user_prompt': '阶段68新正文甲乙'})
expect(status == 200, f'改正文应 200，实际 {status} {updated}')
status, hit = call('GET', '/api/prompts?q=' + urllib.parse.quote('阶段68新正文甲乙'))
expect(status == 200, f'检索应 200，实际 {status}')
expect(hit['total'] == 1 and hit['items'][0]['id'] == pid_root,
       f'改内容列后应能检索到新内容，实际 total={hit["total"]}')
status, fav = call('PUT', f'/api/prompts/{pid_root}', {'favorite': True})
expect(status == 200 and fav['favorite'] is True, f'改收藏应 200/true，实际 {status} {fav}')
status, still = call('GET', '/api/prompts?q=' + urllib.parse.quote('阶段68新正文甲乙'))
expect(still['total'] == 1, f'改收藏后检索结果不得变，实际 {still["total"]}')
print('  ✅ 改内容列能检索到新内容；改收藏不影响检索')

# ③ 令牌：移动端抽屉要用（明文只回一次，服务端不落库）
status, t1 = call('POST', '/api/tokens', {'name': '阶段68令牌一', 'scope': 'read'})
expect(status == 201, f'建令牌应 201，实际 {status} {t1}')
status, t2 = call('POST', '/api/tokens', {'name': '阶段68令牌二', 'scope': 'read'})
expect(status == 201, f'建令牌应 201，实际 {status} {t2}')
expect(t1.get('token', '').startswith('pm_'), '创建响应应带明文 token（只回一次）')
print('  ✅ 两个令牌已建（明文只在创建响应里出现）')

json.dump({'pidEdit': pid_mem_edit, 'pidDialog': pid_mem_dialog, 'pidRoot': pid_root,
           'titleRoot': '阶段68根条目', 'titleEdit': '阶段68记忆编辑', 'titleDialog': '阶段68记忆弹窗',
           'folders': {'root_a': root_a, 'sub_a': sub_a, 'grand_a': grand_a, 'root_b': root_b},
           'counts': want}, open(fix_path, 'w', encoding='utf-8'))
print(f'  夹具：编辑页变量条目={pid_mem_edit} 弹窗变量条目={pid_mem_dialog} 根条目={pid_root}')
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
pid_edit = fixture['pidEdit']
pid_dialog = fixture['pidDialog']
pid_root = fixture['pidRoot']
title_root = fixture['titleRoot']
title_edit = fixture['titleEdit']
title_dialog = fixture['titleDialog']
counts = fixture['counts']
folders = fixture['folders']
expected_counts = '|'.join(str(counts[str(folders[k])]) for k in ('root_a', 'sub_a', 'grand_a', 'root_b'))

OVERFLOW = "(() => document.documentElement.scrollWidth > window.innerWidth ? 'overflow' : 'none')()"
TOASTS = "[...document.querySelectorAll('.ant-message-notice')].map(n => n.innerText).join(' | ')"
FOLDER_COUNTS = "[...document.querySelectorAll('.pm-folder-count')].map(n => n.innerText.trim()).join('|')"
ROW_TEXT = """(() => { const rows = [...document.querySelectorAll('tbody tr')];
  const row = rows.find(n => n.innerText.includes(%s));
  return row ? row.innerText : 'no-row'; })()""" % json.dumps(title_root, ensure_ascii=False)
VARS_ROW_TEXT = """(() => { const rows = [...document.querySelectorAll('tbody tr')];
  const row = rows.find(n => n.innerText.includes(%s));
  return row ? row.innerText : 'no-row'; })()""" % json.dumps(title_dialog, ensure_ascii=False)
SEED_KEY = """(() => { localStorage.setItem('pm-vars:%d', JSON.stringify({项目: '甲'}));
  return String(localStorage.getItem('pm-vars:%d')); })()""" % (pid_edit, pid_edit)
READ_KEY = "String(localStorage.getItem('pm-vars:%d'))" % pid_edit
SEED_KEY_DIALOG = """(() => { localStorage.setItem('pm-vars:%d', JSON.stringify({项目: '甲'}));
  return String(localStorage.getItem('pm-vars:%d')); })()""" % (pid_dialog, pid_dialog)
READ_KEY_DIALOG = "String(localStorage.getItem('pm-vars:%d'))" % pid_dialog
SWITCH_REMEMBER = "document.querySelector('[data-testid=editor-remember-variables]')?.getAttribute('aria-checked') ?? ''"
EDITOR_USER = "document.querySelector('[data-testid=editor-user-prompt]')?.value ?? ''"
DIALOG_TITLE = "document.querySelector('.ant-modal-title')?.innerText ?? ''"
MASK_TEXT = "[...document.querySelectorAll('[data-testid^=pm-token-mask-]')].map(n => n.innerText.trim()).join('|')"
STORAGE_KEYS = "Object.keys(localStorage).join(',')"
SECRET_LEAK = """(() => { const dump = JSON.stringify(localStorage) + ' ' + document.body.innerText;
  return /pm_[A-Za-z0-9_-]{20,}/.test(dump) ? 'leaked' : 'clean'; })()"""
SELECT_SPLIT_ITEM = """(() => { const items = [...document.querySelectorAll('[data-testid="pm-split-item"]')];
  const item = items.find(n => n.innerText.includes(%s));
  if (!item) return 'no-item'; item.click(); return 'clicked'; })()""" % json.dumps(title_edit, ensure_ascii=False)
DBLCLICK_CARD = """(() => { const cards = [...document.querySelectorAll('[data-testid="pm-use-card"]')];
  const card = cards.find(n => n.innerText.includes(%s));
  if (!card) return 'no-card';
  card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
  return 'dblclicked'; })()""" % json.dumps(title_root, ensure_ascii=False)
OPEN_TOKENS = """(() => { const items = [...document.querySelectorAll('.ant-dropdown-menu-item')];
  const item = items.find(n => n.innerText.includes('API 令牌'));
  if (!item) return 'no-item'; item.click(); return 'clicked'; })()"""

SEARCH_ROOT = {'type': 'type', 'selector': '[data-testid=pm-search-input]', 'text': title_root}
SEARCH_EDIT = {'type': 'type', 'selector': '[data-testid=pm-search-input]', 'text': title_edit}
SEARCH_DIALOG = {'type': 'type', 'selector': '[data-testid=pm-search-input]', 'text': title_dialog}

# PC ①：侧栏计数（AC-130 ⑥⑦ 的界面侧）
shot_counts_pc = {
    'name': '68-counts-pc', 'path': '/', 'width': 1440, 'height': 900, 'auth': True,
    'storage': {'pm-view-mode': 'table', 'pm-theme': 'light'},
    'waitFor': '[data-testid=pm-search-input]',
    'actions': [
        SEARCH_ROOT, {'type': 'sleep', 'ms': 1000},
        {'type': 'probe', 'name': 'c-counts', 'expression': FOLDER_COUNTS},
        {'type': 'probe', 'name': 'c-row', 'expression': ROW_TEXT},
        {'type': 'probe', 'name': 'c-overflow', 'expression': OVERFLOW},
    ],
    'dump': '68-counts-pc', 'settleMs': 700,
}

# PC ②：编辑页关掉「记住变量值」→ 保存 ⇒ localStorage 键被删（AC-130 ⑬）
shot_remember_pc = {
    'name': '68-remember-pc', 'path': '/', 'width': 1440, 'height': 900, 'auth': True,
    'storage': {'pm-view-mode': 'split', 'pm-theme': 'light'},
    'waitFor': '[data-testid=pm-search-input]',
    'actions': [
        SEARCH_EDIT, {'type': 'sleep', 'ms': 800},
        {'type': 'eval', 'expression': SELECT_SPLIT_ITEM},
        {'type': 'wait', 'selector': '[data-testid=pm-detail-body]'},
        {'type': 'sleep', 'ms': 700},
        {'type': 'click', 'selector': '[data-testid=pm-detail-edit]'},
        {'type': 'wait', 'selector': '[data-testid=pm-editor]'},
        {'type': 'sleep', 'ms': 600},
        {'type': 'eval', 'expression': SEED_KEY},
        {'type': 'probe', 'name': 'r-seeded', 'expression': READ_KEY},
        {'type': 'probe', 'name': 'r-switch', 'expression': SWITCH_REMEMBER},
        {'type': 'eval', 'expression': "(() => { const el = document.querySelector('[data-testid=editor-remember-variables]'); if (el) el.scrollIntoView({ block: 'center' }); return 'scrolled'; })()"},
        {'type': 'click', 'selector': '[data-testid=editor-remember-variables]'},
        {'type': 'sleep', 'ms': 400},
        {'type': 'probe', 'name': 'r-switch-off', 'expression': SWITCH_REMEMBER},
        {'type': 'click', 'selector': '[data-testid=editor-save]'},
        {'type': 'sleep', 'ms': 1500},
        {'type': 'probe', 'name': 'r-toast', 'expression': TOASTS},
        {'type': 'probe', 'name': 'r-key', 'expression': READ_KEY},
        {'type': 'probe', 'name': 'r-user', 'expression': EDITOR_USER},
        {'type': 'probe', 'name': 'r-overflow', 'expression': OVERFLOW},
    ],
    'dump': '68-remember-pc', 'settleMs': 700,
}

# PC ③：变量弹窗里取消勾选 ⇒ 键被删（AC-130 ⑭）
shot_dialog_pc = {
    'name': '68-dialog-pc', 'path': '/', 'width': 1440, 'height': 900, 'auth': True,
    'storage': {'pm-view-mode': 'table', 'pm-theme': 'light'},
    'waitFor': '[data-testid=pm-search-input]',
    'actions': [
        SEARCH_DIALOG, {'type': 'sleep', 'ms': 900},
        {'type': 'eval', 'expression': VARS_ROW_TEXT},
        {'type': 'eval', 'expression': SEED_KEY_DIALOG},
        {'type': 'click', 'selector': '[data-testid=pm-copy-%d]' % pid_dialog},
        {'type': 'wait', 'selector': '[data-testid=pm-vars-dialog]'},
        {'type': 'sleep', 'ms': 600},
        {'type': 'probe', 'name': 'd-title', 'expression': DIALOG_TITLE},
        {'type': 'probe', 'name': 'd-seeded', 'expression': READ_KEY_DIALOG},
        {'type': 'click', 'selector': '[data-testid=pm-vars-remember]'},
        {'type': 'sleep', 'ms': 500},
        {'type': 'probe', 'name': 'd-key', 'expression': READ_KEY_DIALOG},
        {'type': 'probe', 'name': 'd-overflow', 'expression': OVERFLOW},
    ],
    'dump': '68-dialog-pc', 'settleMs': 700,
}

# 移动端：卡片进详情 + 令牌抽屉（掩码显示、明文不落 Web Storage）
shot_mobile = {
    'name': '68-mobile', 'path': '/', 'width': 440, 'height': 956, 'auth': True,
    'storage': {'pm-view-mode': 'card', 'pm-theme': 'light'},
    'waitFor': '[data-testid=pm-search-input]',
    'actions': [
        SEARCH_ROOT, {'type': 'sleep', 'ms': 900},
        {'type': 'eval', 'expression': DBLCLICK_CARD},
        {'type': 'wait', 'selector': '[data-testid=pm-detail-body]'},
        {'type': 'sleep', 'ms': 700},
        {'type': 'probe', 'name': 'm-body', 'expression': "document.querySelector('[data-testid=pm-detail-body]')?.innerText ?? ''"},
        {'type': 'click', 'selector': '[data-testid=header-more]'},
        {'type': 'sleep', 'ms': 500},
        {'type': 'eval', 'expression': OPEN_TOKENS},
        {'type': 'wait', 'selector': '[data-testid^=pm-token-mask-]'},
        {'type': 'sleep', 'ms': 900},
        {'type': 'probe', 'name': 'm-mask', 'expression': MASK_TEXT},
        {'type': 'probe', 'name': 'm-storage', 'expression': STORAGE_KEYS},
        {'type': 'probe', 'name': 'm-secret', 'expression': SECRET_LEAK},
        {'type': 'probe', 'name': 'm-overflow', 'expression': OVERFLOW},
    ],
    'dump': '68-mobile', 'settleMs': 700,
}


def write(path, shots):
    json.dump({'chrome': chrome, 'baseUrl': base,
               'cookie': {'name': 'pm_sid', 'value': sid, 'domain': lan_ip},
               'outDir': out_dir, 'dumpsDir': dumps_dir, 'shots': shots},
              open(path, 'w', encoding='utf-8'), ensure_ascii=False)


write(plan_pc, [shot_counts_pc, shot_remember_pc, shot_dialog_pc])
write(plan_mobile, [shot_mobile])
print(f'  两份计划已生成（PC 3 shot + 移动 1 shot；期望计数={expected_counts}）')
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

EXPECTED_COUNTS=$(python3 -c "import json;f=json.load(open('$FIX'));c=f['counts'];d=f['folders'];print('|'.join(str(c[str(d[k])]) for k in ('root_a','sub_a','grand_a','root_b')))")
echo "--- 侧栏计数（期望 $EXPECTED_COUNTS）---"
assert_probe c-counts "$EXPECTED_COUNTS" eq
assert_probe c-row '阶段68根条目' has
assert_probe c-overflow 'none' eq
echo "--- 编辑页关开关 → 保存 ⇒ 本地记忆被删（AC-130 ⑬）---"
assert_probe r-seeded '"{\"项目\":\"甲\"}"' has
assert_probe r-switch 'true' eq
assert_probe r-switch-off 'false' eq
assert_probe r-toast '已保存' has
assert_probe r-key 'null' eq
assert_probe r-user '项目：{{项目}}' eq
assert_probe r-overflow 'none' eq
echo "--- 变量弹窗取消勾选 ⇒ 本地记忆被删（AC-130 ⑭）---"
assert_probe d-title '自动记忆' has
assert_probe d-seeded '甲' has
assert_probe d-key 'null' eq
assert_probe d-overflow 'none' eq
echo "--- 移动端：详情正文 + 令牌抽屉掩码 + 明文不落 Web Storage（AC-130 ⑩⑱）---"
assert_probe m-body '阶段68新正文甲乙' has
assert_probe m-mask '...' has
assert_probe m-mask 'pm_' has
assert_probe m-secret 'clean' eq
assert_probe m-storage 'pm-vars' not
assert_probe m-overflow 'none' eq

line "7. 服务端复核：schema=v9、触发器含 WHEN、开关真的落盘"
python3 - "$AC_DIR" "$ROOT" "$BASE" "$SID" "$FIX" <<'PY' || die "服务端复核不符"
import json, subprocess, sys

ac_dir, root, base, sid, fix_path = sys.argv[1:6]
fixture = json.load(open(fix_path, encoding='utf-8'))
pid_edit = fixture['pidEdit']

check = subprocess.run(['node', '-e', '''
import path from "node:path";
import { pathToFileURL } from "node:url";
const [dir, root] = process.argv.slice(1);
const load = async (rel) => import(pathToFileURL(path.join(root, rel)).href);
const { openDatabase } = await load("dist/db/index.js");
const { loadConfig } = await load("dist/config.js");
const db = openDatabase(loadConfig({ DATA_DIR: dir }));
const version = db.prepare("SELECT max(version) AS v FROM schema_migrations").get().v;
const trigger = db.prepare("SELECT sql FROM sqlite_master WHERE type=\\'trigger\\' AND name=\\'prompts_fts_au\\'").get().sql;
const count = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type=\\'trigger\\' AND name=\\'prompts_fts_au\\'").get().n;
console.log(JSON.stringify({ version, hasWhen: trigger.includes("WHEN old.title IS NOT new.title"), count }));
''', ac_dir, root], capture_output=True, text=True)
if check.returncode != 0:
    print(check.stdout + check.stderr)
    sys.exit(1)
info = json.loads(check.stdout.strip().splitlines()[-1])
if info['version'] != 9:
    print(f"FAIL schema 版本应为 9，实际 {info['version']}")
    sys.exit(1)
if not info['hasWhen'] or info['count'] != 1:
    print(f"FAIL 触发器定义不对：{info}")
    sys.exit(1)
print(f"  ✅ 库里：schema_migrations max={info['version']}、prompts_fts_au 恰 1 个且含 WHEN")

import urllib.error, urllib.request
request = urllib.request.Request(base + f'/api/prompts/{pid_edit}', headers={'Cookie': 'pm_sid=' + sid})
with urllib.request.urlopen(request, timeout=20) as response:
    prompt = json.loads(response.read().decode('utf-8'))
if prompt['remember_variables'] is not False:
    print(f"FAIL 浏览器关掉开关后库里应为 false，实际 {prompt['remember_variables']!r}")
    sys.exit(1)
print('  ✅ 浏览器关掉的开关真的落盘（remember_variables=false）')
PY

line "8. 截图与产物落点"
ls -l "$OUT_DIR" | tail -8
echo "  截图目录：$OUT_DIR（交付态，随仓库入库）"
echo "  探针全文：$DUMP_DIR/probes.txt"
printf '\nALL STAGE68 ACCEPTANCE CHECKS PASSED\n'
