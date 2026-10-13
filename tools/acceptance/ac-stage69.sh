#!/usr/bin/env bash
# 阶段 69 端到端验收（交付态，随仓库入库）：机械记账（FR-144 ~ FR-146 / AC-131）
#
# 验的是什么（本阶段不动界面 ⇒ 真浏览器只做一次冒烟）：
#   1) 迁移校验：存量库（001–009、没有 checksum 列）走**真 CLI** 升到 v10、历史迁移首次补记、重复执行幂等
#   2) 篡改 / 改名 / 命名不合规三种情况都由**真运行器**明确报错并点名文件（改前是静默通过/静默跳过）
#   3) 服务能在已迁移的库上正常起来（服务端启动也会跑迁移）
#   4) 真浏览器冒烟 PC 1440×900 + 移动 440×956：登录 → 列表 → 打开编辑器，无页面级横向滚动
#   5) 服务端复核：schema=v10、10 行 checksum 全非 null、存量数据仍在
set -u
cd "$(dirname "$0")/../.."
ROOT="$PWD"

OUT_DIR='tmp/stage69/shots'
DUMP_DIR='tmp/stage69/dumps'
AC_PW='ac-fixture-pw-20260918'

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
[ "$COUNT" = "10" ] || die "migrations 应为 10 个（本阶段新增 010），实际 $COUNT"
[ -f migrations/010_migration-checksums.sql ] || die "缺 migrations/010_migration-checksums.sql"
echo "  ✅ dist 产物齐、migrations=$COUNT（含 010_migration-checksums.sql）"

PORT=$(pick_port) || die "8765–8770 全被占用"
BASE="http://127.0.0.1:$PORT"
LAN_IP=$(hostname -I | awk '{print $1}')
LAN_BASE="http://$LAN_IP:$PORT"
AC_DIR=$(mktemp -d /tmp/pm-s69-XXXXXX)
JAR="$AC_DIR/cookies.txt"
PLAN_PC="$AC_DIR/plan-pc.json"
PLAN_MOBILE="$AC_DIR/plan-mobile.json"
mkdir -p "$ROOT/$OUT_DIR" "$ROOT/$DUMP_DIR" "$AC_DIR/legacy/legacy-migrations"
cp migrations/00[1-9]_*.sql "$AC_DIR/legacy/legacy-migrations/"
cleanup() {
  [ -n "${SRV_PID:-}" ] && kill "$SRV_PID" 2>/dev/null
  rm -rf "$AC_DIR"
}
trap cleanup EXIT
echo "  PORT=$PORT（8767 禁用）LAN_BASE=$LAN_BASE AC_DIR=$AC_DIR"

line "1. 存量库（001–009、无 checksum 列）→ 真 CLI 升到 v10、补记 checksum、幂等"
mkdir -p "$ROOT/var/stage69"
cat > "$ROOT/var/stage69/checks.mjs" <<'MJS'
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const [root, dir] = process.argv.slice(2);
const load = async (rel) => import(pathToFileURL(path.join(root, rel)).href);
const { openDatabase } = await load('dist/db/index.js');
const { runMigrations } = await load('dist/db/migrate.js');
const { loadConfig } = await load('dist/config.js');

const dbPath = path.join(dir, 'pm.db');

// ① 造一个"只跑到 v9 的存量库"：三列 schema_migrations（**没有** checksum）+ 手工应用 001–009 + 一条数据
const legacy = new Database(dbPath);
legacy.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);`);
const legacyDir = path.join(dir, 'legacy-migrations');
for (const file of fs.readdirSync(legacyDir).filter((n) => n.endsWith('.sql')).sort()) {
  legacy.exec(fs.readFileSync(path.join(legacyDir, file), 'utf8'));
  legacy.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
    .run(Number.parseInt(file, 10), file, new Date().toISOString());
}
const NOW = '2026-10-12T00:00:00.000Z';
legacy.exec(`INSERT INTO prompts (title, user_prompt, system_prompt, notes, created_at, updated_at)
             VALUES ('阶段69存量', '存量正文', '', '', '${NOW}', '${NOW}')`);
legacy.exec(`INSERT INTO prompt_versions (prompt_id, version_no, title, user_prompt, created_at)
             VALUES (1, 1, '阶段69存量', '存量正文', '${NOW}')`);
const cols = legacy.prepare('PRAGMA table_info(schema_migrations)').all().map((c) => c.name);
const version = legacy.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations').get().v;
legacy.close();
if (cols.includes('checksum')) throw new Error('存量库不该有 checksum 列（本脚本要造升级前的形状）');
if (version !== 9) throw new Error(`存量库应停在 v9，实际 ${String(version)}`);
console.log(`  存量库 = v${String(version)}，schema_migrations 列 = ${cols.join(',')}（无 checksum）`);

// ② 应用 010（走真运行器）⇒ v10 + 10 行 checksum 全非 null
const db = openDatabase(loadConfig({ DATA_DIR: dir }));
const applied = runMigrations(db, path.join(root, 'migrations'));
if (applied.version !== 10) throw new Error(`升级后应为 v10，实际 ${String(applied.version)}`);
if (JSON.stringify(applied.applied) !== JSON.stringify(['010_migration-checksums.sql'])) {
  throw new Error(`只该应用 010，实际 ${JSON.stringify(applied.applied)}`);
}
const rows = db.prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version').all();
const missing = rows.filter((r) => r.checksum === null || r.checksum === undefined).length;
if (rows.length !== 10) throw new Error(`应有 10 行，实际 ${String(rows.length)}`);
if (missing !== 0) throw new Error(`存量迁移首次见到应补记 checksum，实际缺 ${String(missing)} 行`);
const prompt = db.prepare('SELECT title FROM prompts WHERE id = 1').get();
if (prompt?.title !== '阶段69存量') throw new Error('升级不得动数据');
const second = runMigrations(db, path.join(root, 'migrations'));
if (second.applied.length !== 0) throw new Error(`重复执行应为空操作，实际 ${JSON.stringify(second.applied)}`);
console.log(`  ✅ 真运行器：v10、补记 checksum ${String(rows.length - missing)}/${String(rows.length)}、数据完好、二次 applied=[]`);

// ③ 篡改 / 改名 / 命名护栏（在临时副本上，真运行器必须明确报错并点名文件）
const copy = (mutate) => {
  const tmp = fs.mkdtempSync('/tmp/pm69-copy-');
  fs.cpSync(path.join(root, 'migrations'), tmp, { recursive: true });
  mutate(tmp);
  try {
    runMigrations(db, tmp);
  } catch (error) {
    fs.rmSync(tmp, { recursive: true, force: true });
    return error instanceof Error ? error.message : String(error);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  return null;
};
const tamper = copy((tmp) => {
  const target = path.join(tmp, '002_tokens-and-usage.sql');
  fs.writeFileSync(target, `${fs.readFileSync(target, 'utf8')}\n-- 篡改\n`);
});
if (tamper === null || !tamper.includes('002_tokens-and-usage.sql') || !tamper.includes('checksum')) {
  throw new Error(`篡改未被检出：${String(tamper)}`);
}
console.log(`  ✅ 篡改检出：${tamper}`);
const rename = copy((tmp) => {
  fs.renameSync(path.join(tmp, '002_tokens-and-usage.sql'), path.join(tmp, '002_tokens.sql'));
});
if (rename === null || !rename.includes('002_tokens-and-usage.sql')) throw new Error(`改名未被检出：${String(rename)}`);
console.log(`  ✅ 改名检出：${rename}`);
const badName = copy((tmp) => { fs.writeFileSync(path.join(tmp, 'add-something.sql'), 'SELECT 1;'); });
if (badName === null || !badName.includes('add-something.sql') || !badName.includes('NNN_*.sql')) {
  throw new Error(`命名不合规未被检出（改前是静默跳过）：${String(badName)}`);
}
console.log(`  ✅ 命名护栏：${badName}`);

db.close();
MJS
node "$ROOT/var/stage69/checks.mjs" "$ROOT" "$AC_DIR/legacy" || die "迁移校验链路不符"

# 版本号从 migrations/ 目录派生（旧版写死 v10：加下一个迁移就恒红；第三轮审视 S1）
MIG_MAX=$(ls migrations/*.sql | sed -E 's#^migrations/0*([0-9]+).*#\1#' | sort -n | tail -1)
line "2. 真 CLI：DATA_DIR 指向上面的存量库 ⇒ 幂等输出 ok: schema at v$MIG_MAX"
DATA_DIR="$AC_DIR/legacy" node bin/pm.mjs migrate > "$AC_DIR/cli-1.txt" 2>&1 || die "CLI migrate 失败"
DATA_DIR="$AC_DIR/legacy" node bin/pm.mjs migrate > "$AC_DIR/cli-2.txt" 2>&1 || die "CLI migrate 第二次失败"
echo "  第一次：$(cat "$AC_DIR/cli-1.txt")"
echo "  第二次：$(cat "$AC_DIR/cli-2.txt")"
grep -q "^ok: schema at v$MIG_MAX\$" "$AC_DIR/cli-1.txt" || die "第一次输出不是 ok: schema at v$MIG_MAX"
grep -q "^ok: schema at v$MIG_MAX\$" "$AC_DIR/cli-2.txt" || die "第二次输出不是 ok: schema at v$MIG_MAX"

line "3. 起临时服务（DATA_DIR = 已迁移的库）+ 真登录 + 接口冒烟"
printf '%s\n' "$AC_PW" | DATA_DIR="$AC_DIR/legacy" node bin/pm.mjs user set-password --username admin >/dev/null || die "set-password 失败"
DATA_DIR="$AC_DIR/legacy" PORT="$PORT" node dist/server/index.js > "$AC_DIR/server.log" 2>&1 &
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

python3 - "$BASE" "$SID" "$AC_DIR" <<'PY' || die "接口冒烟不符"
import json, sys, urllib.request

base, sid, ac_dir = sys.argv[1:4]

def call(method, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(base + path, data=data, method=method)
    req.add_header('cookie', 'pm_sid=' + sid)
    if data is not None:
        req.add_header('content-type', 'application/json')
    with urllib.request.urlopen(req) as res:
        return res.status, json.loads(res.read().decode() or 'null')

status, listed = call('GET', '/api/prompts?limit=10')
assert status == 200, status
titles = [p['title'] for p in listed['items']]
assert '阶段69存量' in titles, titles
print(f"  存量条目仍在：{titles}")

status, created = call('POST', '/api/prompts', {'title': '阶段69冒烟', 'user_prompt': '冒烟正文', 'system_prompt': ''})
assert status == 201, (status, created)
with open(f'{ac_dir}/pid.txt', 'w') as fh:
    fh.write(str(created['id']))
print(f"  新建冒烟条目 id={created['id']}")

status, counts = call('GET', '/api/prompts?limit=1&include=folder_counts')
assert status == 200 and 'folder_counts' in counts, counts
print(f"  接口冒烟：include=folder_counts → {counts['folder_counts']}")
PY

line "4. 真浏览器冒烟（PC 1440×900 + 移动 440×956）"
CHROME=$(node tools/acceptance/lib/chrome.mjs)
[ -n "$CHROME" ] || die "找不到 chrome-headless-shell"
OUT_ABS="$ROOT/$OUT_DIR"
DUMP_ABS="$ROOT/$DUMP_DIR"

python3 - "$LAN_BASE" "$LAN_IP" "$SID" "$CHROME" "$OUT_ABS" "$DUMP_ABS" "$PLAN_PC" "$PLAN_MOBILE" "$(cat "$AC_DIR/pid.txt")" <<'PY' || die "计划生成失败"
import json, sys

base, lan_ip, sid, chrome, out_dir, dumps_dir, plan_pc, plan_mobile, pid = sys.argv[1:10]

OVERFLOW = "(() => document.documentElement.scrollWidth > window.innerWidth ? 'overflow' : 'none')()"
ROW_TEXT = """(() => { const rows = [...document.querySelectorAll('tbody tr')];
  const row = rows.find(n => n.innerText.includes('阶段69冒烟'));
  return row ? row.innerText : 'no-row'; })()"""
SEARCH = """(() => { const el = document.querySelector('[data-testid=pm-search-input]');
  if (!el) return 'no-input'; el.value = '阶段69冒烟';
  el.dispatchEvent(new Event('input', { bubbles: true })); return 'typed'; })()"""
EDITOR_PRESENT = "String(Boolean(document.querySelector('[data-testid=pm-editor]')))"
EDITOR_TITLE = "document.querySelector('[data-testid=editor-title]')?.value ?? ''"
MOBILE_TITLE = "(() => { const c = [...document.querySelectorAll('[data-testid=pm-use-card]')].find(n => n.innerText.includes('阶段69冒烟')); return c ? c.innerText : 'no-card'; })()"

shot_pc = {
    'name': '69-smoke-pc', 'path': '/', 'width': 1440, 'height': 900, 'auth': True,
    'storage': {'pm-view-mode': 'table', 'pm-theme': 'light'},
    'waitFor': '[data-testid=pm-search-input]',
    'actions': [
        {'type': 'eval', 'expression': SEARCH}, {'type': 'sleep', 'ms': 900},
        {'type': 'probe', 'name': 'p-row', 'expression': ROW_TEXT},
        {'type': 'click', 'selector': '[data-testid=pm-edit-%s]' % pid},
        {'type': 'wait', 'selector': '[data-testid=pm-editor]'},
        {'type': 'sleep', 'ms': 700},
        {'type': 'probe', 'name': 'p-editor', 'expression': EDITOR_PRESENT},
        {'type': 'probe', 'name': 'p-editor-title', 'expression': EDITOR_TITLE},
        {'type': 'probe', 'name': 'p-overflow', 'expression': OVERFLOW},
    ],
    'dump': '69-smoke-pc', 'settleMs': 700,
}

shot_mobile = {
    'name': '69-smoke-mobile', 'path': '/', 'width': 440, 'height': 956, 'auth': True,
    'storage': {'pm-view-mode': 'card', 'pm-theme': 'light'},
    'waitFor': '[data-testid=pm-search-input]',
    'actions': [
        {'type': 'eval', 'expression': SEARCH}, {'type': 'sleep', 'ms': 900},
        {'type': 'probe', 'name': 'm-card', 'expression': MOBILE_TITLE},
        {'type': 'probe', 'name': 'm-overflow', 'expression': OVERFLOW},
    ],
    'dump': '69-smoke-mobile', 'settleMs': 700,
}

def write(path, shots):
    json.dump({'chrome': chrome, 'baseUrl': base,
               'cookie': {'name': 'pm_sid', 'value': sid, 'domain': lan_ip},
               'outDir': out_dir, 'dumpsDir': dumps_dir, 'shots': shots},
              open(path, 'w', encoding='utf-8'), ensure_ascii=False)

write(plan_pc, [shot_pc])
write(plan_mobile, [shot_mobile])
print('  两份计划已生成（PC 1 shot + 移动 1 shot）')
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

assert_probe p-row '阶段69冒烟' has
assert_probe p-editor 'true' eq
assert_probe p-editor-title '阶段69冒烟' eq
assert_probe p-overflow 'none' eq
assert_probe m-card '阶段69冒烟' has
assert_probe m-overflow 'none' eq

line "6. 服务端复核（库结构 + 校验列 + 存量数据）"
python3 - "$AC_DIR" "$ROOT" <<'PY' || die "服务端复核不符"
import sqlite3, sys

ac_dir, root = sys.argv[1:3]
db = sqlite3.connect(f'{ac_dir}/legacy/pm.db')
cols = [r[1] for r in db.execute('PRAGMA table_info(schema_migrations)')]
assert 'checksum' in cols, cols
version = db.execute('SELECT COALESCE(MAX(version), 0) FROM schema_migrations').fetchone()[0]
rows = db.execute('SELECT COUNT(*), COUNT(checksum) FROM schema_migrations').fetchone()
prompt = db.execute("SELECT title FROM prompts WHERE title = '阶段69存量'").fetchone()
print(f'  schema_migrations：version={version} 行数={rows[0]} 有 checksum 的={rows[1]} 列={cols}')
print(f'  存量数据仍在：{prompt}')
assert version == 10, version
assert rows[0] == 10 and rows[1] == 10, rows
assert prompt is not None
PY

line "7. 截图与产物落点"
ls -1 "$ROOT/$OUT_DIR" | sed 's/^/  /'
echo "  dumps: $DUMP_DIR"

line "✅ ALL STAGE69 ACCEPTANCE CHECKS PASSED"
