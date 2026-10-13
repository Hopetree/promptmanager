#!/usr/bin/env bash
# 阶段 64（FR-132 / FR-133 / FR-134 / FR-135 / AC-126 / D-62）一次性验收脚本 —— **交付态，随仓库入库（tools/acceptance/）**。
#
# 判据：`tmp/dev-process/BRIEF.md` 的 FR-132~FR-135 / AC-126 / D-62 三节。
# 做法：① **在「已有数据」的库上**跑迁移：先只放 001–008 建库，灌存量行（含 `sort_order=5/7` 与
#          `usage_events` 4 行：copy×2 + mcp×1 + view×1），再跑全量迁移 → 断言**没有 009**
#          （阶段 64 零迁移）、`prompts.sort_order` 列本来就在、存量数据一个字节都不动；
#       ② 临时 DATA_DIR + 台账范围内空闲端口（避开 8767）自起自停；**本地 GitHub 桩**（把
#          `SYNC_GITHUB_API_BASE` 指过去）⇒ 走**真实的** push / pull 链路，不碰真仓库、不用真 token；
#       ③ 接口层逐条核对 AC-126 A/B/C/D 组 + 直查 SQLite（`sort_order` 到底落成几、取用行还剩几条，
#          回包看不出来）；
#       ④ 真浏览器（tools/ui-shot.mjs + chrome-headless-shell）PC 1440×900 与移动 440×956：
#          **排序在「推送到云端 → 清库 → 从云端恢复」之后仍在**。
# 用法：bash tools/acceptance/ac-stage64.sh
set -u

cd "$(dirname "$0")/../.." || exit 1
ROOT="$PWD"
OUT_DIR='tmp/stage64/shots'
DUMP_DIR='tmp/stage64/dumps'
mkdir -p "$OUT_DIR" "$DUMP_DIR"

AC_PW='ac-fixture-pw-20260918'
REPO='Hopetree/sync-data-test'
INSTANCE='pm'
CLOUD_PATH='promptmanager/pm.json'
TITLE_A='阶段64排序 A'
TITLE_B='阶段64排序 B'
TITLE_C='阶段64排序 C'
TITLE_LEGACY='存量64-正常'

pick_port() {
  for candidate in 8765 8766 8767 8768 8769 8770; do
    if ! ss -ltn | grep -q ":$candidate "; then echo "$candidate"; return 0; fi
  done
  return 1
}
PORT=$(pick_port) || { echo "FAIL 台账范围 8765–8770 全被占用（写 QUESTIONS 停手）"; exit 1; }
[ "$PORT" != "8767" ] || { echo "FAIL 选到了禁用端口 8767"; exit 1; }
STUB_PORT=''
for candidate in 8765 8766 8767 8768 8769 8770; do
  if [ "$candidate" != "$PORT" ] && ! ss -ltn | grep -q ":$candidate "; then STUB_PORT="$candidate"; break; fi
done
[ -n "$STUB_PORT" ] || { echo "FAIL 找不到第二个空闲端口给 GitHub 桩"; exit 1; }
[ "$STUB_PORT" != "8767" ] || { echo "FAIL 桩选到了禁用端口 8767"; exit 1; }
BASE="http://127.0.0.1:$PORT"
STUB_BASE="http://127.0.0.1:$STUB_PORT"

line() { printf '\n=== %s ===\n' "$1"; }
die() { printf 'FAIL %s\n' "$1"; exit 1; }

AC_DIR=$(mktemp -d /tmp/pm-s64-XXXXXX)
SRV_PID=''
STUB_PID=''
JAR="$AC_DIR/jar.txt"
PLAN="$AC_DIR/plan.json"
FIX="$AC_DIR/fixtures.json"
cleanup() {
  for pid in "$SRV_PID" "$STUB_PID"; do
    if [ -n "$pid" ]; then
      kill "$pid" 2>/dev/null || true
      for _ in $(seq 1 10); do kill -0 "$pid" 2>/dev/null || break; sleep 0.3; done
      kill -9 "$pid" 2>/dev/null || true
    fi
  done
  rm -rf "$AC_DIR"
}
trap cleanup EXIT

line "0. 前置：端口 / 构建产物 / 阶段 64 必须零迁移"
ss -ltn | grep -q ":$PORT " && die "端口 $PORT 已被占用"
echo "  服务端口 $PORT 空闲；GitHub 桩端口 $STUB_PORT；BASE=$BASE"
[ -f dist/web/index.html ] || die "缺 dist/web —— 先 npm run build"
[ -f dist/server/index.js ] || die "缺 dist/server —— 先 npm run build"
if ls migrations/009_*.sql >/dev/null 2>&1; then die "阶段 64 是零迁移，不该存在 009_*.sql"; fi
echo "  ✅ migrations/ 最新仍是 008（阶段 64 零迁移）：$(ls migrations | tail -1)"

line "1. 迁移：在「已有数据」的库上跑全量迁移（先 001–008 建库 + 灌存量行，再升级）"
OLD_MIG="$AC_DIR/old-migrations"
mkdir -p "$OLD_MIG"
cp migrations/00[1-8]_*.sql "$OLD_MIG/"
echo "  旧迁移目录：$(ls "$OLD_MIG" | wc -l) 个文件（001–008）"
cat > "$AC_DIR/check-migrate.mjs" <<'MJS'
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const [root, dataDir, oldMig] = process.argv.slice(2);
const { openDatabase } = await import(pathToFileURL(`${root}/dist/db/index.js`).href);
const { runMigrations } = await import(pathToFileURL(`${root}/dist/db/migrate.js`).href);

const db = openDatabase({ dataDir });
const before = runMigrations(db, oldMig);
console.log(`  旧库（只有 001–008）→ schema v${String(before.version)}`);
assert.equal(before.version, 8, '旧库必须先停在 v8');

// `prompts.sort_order` 由 003 建立 —— FR-132 的前提是「列本来就有」，只差没进导出文件。
const columns = db.prepare('PRAGMA table_info(prompts)').all().map((c) => c.name);
assert.ok(columns.includes('sort_order'), 'D-62 ⑤：零迁移的前提是 prompts.sort_order 本来就在（003）');

const now = '2026-01-01T00:00:00.000Z';
const ins = db.prepare(
  'INSERT INTO prompts (title, user_prompt, system_prompt, created_at, updated_at, version_no, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
);
const insV = db.prepare(
  'INSERT INTO prompt_versions (prompt_id, version_no, title, user_prompt, system_prompt, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
);
const insU = db.prepare(
  'INSERT INTO usage_events (prompt_id, channel, used_at, kind) VALUES (?, ?, ?, ?)',
);

const id = ins.run('存量64-正常', '存量正文', '', now, now, 1, 5).lastInsertRowid;
insV.run(id, 1, '存量64-正常', '存量正文', '', '', now);
// 取用行的 used_at 用**一小时内**的时间戳：`/api/usage/summary` 只看最近 30 天，
// 写 2026-01-01 会让存量事件落在窗口外，于是"列表页次数 vs 统计页 total"这条对照就失去意义。
const recent = new Date(Date.now() - 3600_000).toISOString();
insU.run(id, 'session', recent, 'copy');
insU.run(id, 'session', recent, 'mcp');
insU.run(id, 'session', recent, 'view');

const after = runMigrations(db, `${root}/migrations`);
console.log(`  升级（重跑同一批 001–008）→ schema v${String(after.version)}`);
assert.equal(after.version, 8, '阶段 64 零迁移 ⇒ 升级后仍是 v8');

const row = db.prepare('SELECT sort_order, version_no FROM prompts WHERE id = ?').get(id);
assert.equal(row.sort_order, 5, 'D-62 ⑤：存量 sort_order 不许被改');
assert.equal(row.version_no, 1, 'D-62 ⑤：存量 version_no 不许被改');
const usage = db.prepare('SELECT kind FROM usage_events WHERE prompt_id = ? ORDER BY id').all(id);
assert.deepEqual(usage.map((u) => u.kind), ['copy', 'mcp', 'view'], 'D-62 ⑤：存量取用行不许被改');
db.close();
console.log('  ✅ 已有数据的库升级后：schema v8；存量 sort_order=5 / version_no=1 / 3 条取用行原样保留');
MJS
node "$AC_DIR/check-migrate.mjs" "$ROOT" "$AC_DIR" "$OLD_MIG" || die "已有数据上的迁移验证失败"

line "2. 本地 GitHub 桩 + 临时服务（DATA_DIR=$AC_DIR，自起自停，不碰生产数据）"
cat > "$AC_DIR/github-stub.py" <<'PYSTUB'
import base64, json, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

PORT = int(sys.argv[1])
REPO_PATH = '/repos/Hopetree/sync-data-test'
STORE = {}

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send_json(self, code, payload):
        raw = json.dumps(payload).encode('utf-8')
        self.send_response(code)
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == REPO_PATH:
            return self.send_json(200, {'default_branch': 'main', 'permissions': {'push': True}})
        if path.startswith('/__store/'):
            key = path[len('/__store/'):]
            if key in STORE:
                return self.send_json(200, {'content': STORE[key][0].decode('utf-8')})
            return self.send_json(404, {'message': 'empty'})
        marker = '/contents/'
        if marker in path:
            key = path.split(marker, 1)[1]
            if key in STORE:
                content, sha = STORE[key]
                return self.send_json(200, {
                    'content': base64.b64encode(content).decode('ascii'),
                    'sha': sha,
                    'encoding': 'base64',
                })
            return self.send_json(404, {'message': 'Not Found'})
        return self.send_json(404, {'message': 'Not Found'})

    def do_PUT(self):
        path = urlparse(self.path).path
        length = int(self.headers.get('content-length') or 0)
        body = json.loads(self.rfile.read(length) or b'{}')
        marker = '/contents/'
        if marker not in path:
            return self.send_json(404, {'message': 'Not Found'})
        key = path.split(marker, 1)[1]
        content = base64.b64decode(body.get('content') or '')
        sha = 'sha-%d' % (len(STORE) + 1)
        STORE[key] = (content, sha)
        return self.send_json(200, {'content': {'sha': sha}, 'commit': {'sha': 'commit-' + sha}})

ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
PYSTUB
python3 "$AC_DIR/github-stub.py" "$STUB_PORT" >"$AC_DIR/stub.log" 2>&1 &
STUB_PID=$!
for _ in $(seq 1 40); do
  curl -s -o /dev/null "$STUB_BASE/repos/$REPO" && break
  sleep 0.2
done
curl -s "$STUB_BASE/repos/$REPO" | grep -q 'default_branch' || { cat "$AC_DIR/stub.log"; die "GitHub 桩没起来"; }
echo "  GitHub 桩 pid=$STUB_PID（$STUB_BASE），不碰真仓库、不用真 token"

printf '%s\n' "$AC_PW" | DATA_DIR="$AC_DIR" node bin/pm.mjs user set-password --username admin >/dev/null || die "建库/设口令失败"
SYNC_GITHUB_API_BASE="$STUB_BASE" DATA_DIR="$AC_DIR" PORT="$PORT" node dist/server/index.js >"$AC_DIR/server.log" 2>&1 &
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

line "4. 接口层：AC-126 A/B/C/D 组逐条核对（真 HTTP + 真 SQLite + 真同步往返）"
python3 - "$BASE" "$AC_DIR" "$SID" "$TITLE_A" "$TITLE_B" "$TITLE_C" "$TITLE_LEGACY" "$FIX" "$REPO" "$CLOUD_PATH" <<'PY' || die "接口层核对不符"
import json, sqlite3, sys, time, urllib.error, urllib.request

base, data_dir, sid, title_a, title_b, title_c, title_legacy, fix_path, repo, cloud_path = sys.argv[1:11]

def call(method, path, body=None, headers=None):
    data = None if body is None else json.dumps(body).encode('utf-8')
    hdrs = {'Cookie': 'pm_sid=' + sid}
    if body is not None:
        hdrs['Content-Type'] = 'application/json'
    if headers:
        hdrs.update(headers)
    req = urllib.request.Request(base + path, method=method, data=data, headers=hdrs)
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read().decode('utf-8')
            return None if raw == '' else json.loads(raw)
    except urllib.error.HTTPError as err:
        raise AssertionError(f'{method} {path} → HTTP {err.code}: {err.read().decode("utf-8")}') from None

def call_status(method, path, body=None):
    """要「拿到错误码和错误体」的用例用它（`call` 会把 4xx 变成 AssertionError）。"""
    data = None if body is None else json.dumps(body).encode('utf-8')
    hdrs = {'Cookie': 'pm_sid=' + sid}
    if body is not None:
        hdrs['Content-Type'] = 'application/json'
    req = urllib.request.Request(base + path, method=method, data=data, headers=hdrs)
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, resp.read().decode('utf-8')
    except urllib.error.HTTPError as err:
        return err.code, err.read().decode('utf-8')

def db():
    con = sqlite3.connect(f'{data_dir}/pm.db')
    con.row_factory = sqlite3.Row
    return con

def db_sort_orders():
    con = db()
    rows = con.execute('SELECT id, sort_order FROM prompts ORDER BY id').fetchall()
    con.close()
    return {row['id']: row['sort_order'] for row in rows}

def db_usage_rows():
    con = db()
    rows = con.execute('SELECT prompt_id, channel, kind FROM usage_events ORDER BY id').fetchall()
    con.close()
    return [dict(row) for row in rows]

def listing(sort='custom'):
    return call('GET', f'/api/prompts?limit=200&sort={sort}')['items']

def by_title(title):
    hits = [p for p in listing() if p['title'] == title]
    assert len(hits) == 1, f'标题 {title!r} 应恰有 1 条，实际 {len(hits)}'
    return hits[0]

def create(title, body='正文 v1'):
    p = call('POST', '/api/prompts', {'title': title, 'user_prompt': body, 'system_prompt': '', 'notes': ''})
    assert p['version_no'] == 1, f'新建 {title!r} 应 version_no=1'
    return p

def strip_volatile(file):
    copy = json.loads(json.dumps(file))
    copy.pop('exported_at', None)
    return copy

# ================= 存量口径：零迁移后历史数据不被重算（AC-126 ⑩）=================
# 放在 A 组**之前**：A 组要跑 replace 导入，而 replace 会 DELETE FROM prompts ⇒ usage_events 级联清空
# （这正是 FR-134 的坑，4c 会专门验）。存量事件一旦被清，就没法再验"历史不被重算"了。
legacy_p = by_title(title_legacy)
assert legacy_p['use_count'] == 2, f'AC-126 ⑩：存量行 use_count 应仍为 2（copy+mcp），实际 {legacy_p["use_count"]}'
legacy_summary = call('GET', '/api/usage/summary')
assert legacy_summary['total'] == 2, f'AC-126 ⑩：存量阶段统计 total 应为 2，实际 {legacy_summary["total"]}'
con = db()
null_kind = con.execute('SELECT COUNT(*) AS n FROM usage_events WHERE kind IS NULL').fetchone()['n']
con.close()
assert null_kind == 0, 'AC-126 ⑩：本阶段不该产生 kind 为空的行'
print('  ✅ AC-126 ⑩：零迁移后存量行 use_count 仍为 2、统计 total 仍为 2（历史数据没有被重算）')

# ================= A 组：sort_order 随导出 / 导入往返（AC-126 ①②③④⑥）=================
a = create(title_a)
b = create(title_b)
c = create(title_c)

# 拖拽的落库动作就是 PATCH /api/prompts/order（UI 拖拽调它）—— 把顺序改成 C, A, B
call('PATCH', '/api/prompts/order', {'ids': [c['id'], a['id'], b['id']]})
orders = db_sort_orders()
assert orders[c['id']] < orders[a['id']] < orders[b['id']], f'AC-126 ①：库里的顺序必须真的变成 C < A < B，实际 {orders}'
trio = {c['id'], a['id'], b['id']}
seen = [p['id'] for p in listing() if p['id'] in trio]
assert seen == [c['id'], a['id'], b['id']], f'AC-126 ①：列表（sort=custom）里这三条的顺序应为 C,A,B，实际 {seen}'
print(f'  ✅ AC-126 ①：PATCH /api/prompts/order ⇒ 库里 sort_order C={orders[c["id"]]} A={orders[a["id"]]} B={orders[b["id"]]}，列表顺序 C,A,B')

first = call('GET', '/api/export')
exported = {p['id']: p for p in first['prompts']}
for pid, want in orders.items():
    assert 'sort_order' in exported[pid], f'AC-126 ①：导出里必须有 sort_order（prompt {pid}）'
    assert exported[pid]['sort_order'] == want, f'AC-126 ①：导出的 sort_order 必须等于库里的值（prompt {pid}：{exported[pid]["sort_order"]} vs {want}）'
print('  ✅ AC-126 ①：导出的 prompts[].sort_order 逐条等于库里的值')

assert call('POST', '/api/import', {'mode': 'replace', 'data': first}) is not None
orders2 = db_sort_orders()
assert orders2 == orders, f'AC-126 ②：replace 导入后 sort_order 必须原样落地，实际 {orders2} vs {orders}'
second = call('GET', '/api/export')
assert strip_volatile(second) == strip_volatile(first), 'AC-126 ③：导出 → replace 导入 → 再导出，必须逐条相同'
print('  ✅ AC-126 ②③：replace 导入后 sort_order 原样落地；导出→导入→再导出逐条相同')

merged = call('POST', '/api/import', {'mode': 'merge', 'data': first})
orders3 = db_sort_orders()
assert orders3[c['id']] < orders3[a['id']] < orders3[b['id']], f'AC-126 ②：merge 导入也必须带上 sort_order，实际 {orders3}'
print('  ✅ AC-126 ②：merge 导入同样带上 sort_order（新建的副本也拿到同一个值）')

# 老文件：整段删掉 sort_order ⇒ 必须成功且缺省 0（不是报错）
legacy = json.loads(json.dumps(first))
for p in legacy['prompts']:
    p.pop('sort_order', None)
call('POST', '/api/import', {'mode': 'replace', 'data': legacy})
orders4 = db_sort_orders()
assert set(orders4.values()) == {0}, f'AC-126 ④：老文件（无 sort_order）必须缺省 0，实际 {orders4}'
print('  ✅ AC-126 ④：整段删掉 sort_order 的老文件仍能导入，全表缺省 0')

bad = json.loads(json.dumps(first))
bad['prompts'][0]['sort_order'] = '7'
code, body = call_status('POST', '/api/import', {'mode': 'replace', 'data': bad})
assert code == 400 and 'sort_order' in body, f'AC-126 ④：sort_order 非整数必须 400 且点名字段，实际 {code} {body}'
bad['prompts'][0]['sort_order'] = 1.5
code, body = call_status('POST', '/api/import', {'mode': 'replace', 'data': bad})
assert code == 400 and 'sort_order' in body, f'AC-126 ④：sort_order 小数也必须 400，实际 {code} {body}'
print('  ✅ AC-126 ④：sort_order 写成字符串 / 小数都 400 且报 data.prompts[].sort_order')

# 复原：重新导入带顺序的那份，并确认槽位算法仍可重排
call('POST', '/api/import', {'mode': 'replace', 'data': first})
assert db_sort_orders() == orders, '复原导入失败'
call('PATCH', '/api/prompts/order', {'ids': [b['id'], a['id'], c['id']]})
seen = [p['id'] for p in listing() if p['id'] in trio]
assert seen == [b['id'], a['id'], c['id']], f'AC-126 ⑥：导入后槽位算法仍可重排，实际 {seen}'
call('PATCH', '/api/prompts/order', {'ids': [c['id'], a['id'], b['id']]})
seen = [p['id'] for p in listing() if p['id'] in trio]
assert seen == [c['id'], a['id'], b['id']], 'AC-126 ⑥：重排回 C,A,B 失败'
print('  ✅ AC-126 ⑥：导入之后 PATCH /api/prompts/order 的槽位算法不回归（B,A,C → C,A,B 都真的生效）')

# ================= B 组：取用口径单一来源（AC-126 ⑦⑧⑨⑩）=================
# 三种 kind 各一次：copy×2（会话复制）、mcp×1（Bearer 令牌 + x-pm-channel，**只有 Bearer 才认这个头**）、view×1（打开详情）
call('POST', f'/api/prompts/{c["id"]}/copy')
call('POST', f'/api/prompts/{c["id"]}/copy')
token = call('POST', '/api/tokens', {'name': 'AC126 mcp', 'scope': 'read'})
assert isinstance(token, dict) and isinstance(token.get('token'), str), f'建令牌失败：{token}'
call('POST', f'/api/prompts/{c["id"]}/render', {'values': {}},
     headers={'Authorization': 'Bearer ' + token['token'], 'x-pm-channel': 'mcp'})
call('GET', f'/api/prompts/{a["id"]}')  # 打开详情 ⇒ kind='view'
kinds = [row['kind'] for row in db_usage_rows()]
assert kinds.count('copy') == 2 and kinds.count('mcp') == 1 and kinds.count('view') == 1, f'AC-126 ⑨：造的事件不对：{kinds}'
c_use = by_title(title_c)['use_count']
assert c_use == 3, f'AC-126 ⑨：列表页 use_count 应为 copy×2 + mcp×1 = 3（view 不计），实际 {c_use}'
summary = call('GET', '/api/usage/summary')
assert summary['total'] == 3, f'AC-126 ⑨：统计页 total 应为 3（copy×2 + mcp；view 不计），实际 {summary["total"]}'
print(f'  ✅ AC-126 ⑨：copy×2 + mcp×1 + view×1 ⇒ 列表 use_count={c_use}、统计 total={summary["total"]}（两处同数，view 不计）')

# ================= 同步：推送 → 清库 → 从云端恢复（AC-126 ⑤）=================
cfg = call('PUT', '/api/sync/config', {'repo': repo, 'instance': 'pm', 'path': cloud_path, 'token': 'ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'branch': 'main'})
assert cfg['configured'] is True, f'同步配置失败：{cfg}'
push = call('POST', '/api/sync/push', {})  # 路由要求 JSON 对象体（空对象即可）
assert push['remote_sha'], f'AC-126 ⑤：push 必须回 remote_sha，实际 {push}'
assert push['prompts'] == len(first['prompts']), f'AC-126 ⑤：push 的条数应为 {len(first["prompts"])}，实际 {push["prompts"]}'
print(f'  ✅ 同步配置 + push 成功：{push["prompts"]} 条 prompt，云端 sha={push["remote_sha"][:12]}…，action={push["action"]}')
PY

line "4b. 云端快照内容（从桩里读回来）必须带 sort_order"
CLOUD_JSON=$(curl -s "$STUB_BASE/__store/$CLOUD_PATH" | python3 -c 'import json,sys; print(json.load(sys.stdin)["content"])')
printf '%s' "$CLOUD_JSON" > "$AC_DIR/cloud.json"
python3 - "$AC_DIR/cloud.json" "$FIX" <<'PY2' || die "云端快照缺 sort_order"
import json, sys
cloud = json.load(open(sys.argv[1], encoding='utf-8'))
assert cloud['app'] == 'promptmanager', f'云端快照的 app 必须是 promptmanager，实际 {cloud["app"]!r}'
missing = [p['id'] for p in cloud['prompts'] if 'sort_order' not in p]
assert missing == [], f'AC-126 ⑤：云端快照里这些 prompt 缺 sort_order：{missing}'
print(f'  ✅ 云端快照：{len(cloud["prompts"])} 条 prompt，全部带 sort_order')
json.dump({p['title']: p['sort_order'] for p in cloud['prompts']}, open(sys.argv[2], 'w', encoding='utf-8'))
PY2

line "4c. 清库（replace 导入空文件）+ 从云端恢复（merge）—— 排序必须还在，取用历史必须如实回报"
python3 - "$BASE" "$AC_DIR" "$SID" "$TITLE_A" "$TITLE_B" "$TITLE_C" "$FIX" <<'PY3' || die "清库 / 恢复链路不符"
import json, os, sqlite3, stat, sys, urllib.error, urllib.request

base, data_dir, sid, title_a, title_b, title_c, fix_path = sys.argv[1:8]

def call(method, path, body=None):
    data = None if body is None else json.dumps(body).encode('utf-8')
    hdrs = {'Cookie': 'pm_sid=' + sid}
    if body is not None:
        hdrs['Content-Type'] = 'application/json'
    req = urllib.request.Request(base + path, method=method, data=data, headers=hdrs)
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read().decode('utf-8')
            return None if raw == '' else json.loads(raw)
    except urllib.error.HTTPError as err:
        raise AssertionError(f'{method} {path} → HTTP {err.code}: {err.read().decode("utf-8")}') from None

def db():
    con = sqlite3.connect(f'{data_dir}/pm.db')
    con.row_factory = sqlite3.Row
    return con

con = db()
before_rows = con.execute('SELECT COUNT(*) AS n FROM usage_events').fetchone()['n']
before_prompts = con.execute('SELECT COUNT(*) AS n FROM prompts').fetchone()['n']
con.close()
# 注意：A 组的 replace 导入已经用 CASCADE 把第 1 步灌的 3 条存量取用行清掉了（FR-134 的坑），
# 所以此刻库里只剩 B 组造的 4 条（copy×2 + mcp + view）。
assert before_rows == 4, f'清库前应有 4 条取用行（copy×2 + mcp + view），实际 {before_rows}'

empty = {'app': 'promptmanager', 'schema_version': 1, 'exported_at': '2026-01-01T00:00:00.000Z', 'folders': [], 'tags': [], 'prompts': []}
result = call('POST', '/api/import', {'mode': 'replace', 'data': empty})
history = result['usage_history']
assert history['action'] == 'cleared', f'AC-126 ⑪：replace 必须回报 action=cleared，实际 {history}'
assert history['count'] == before_rows, f'AC-126 ⑪：条数必须是清空前的 {before_rows}，实际 {history["count"]}'
backup = history['backup']
assert isinstance(backup, str) and backup != '', f'AC-126 ⑫：必须给出备份落点，实际 {backup!r}'
assert os.path.isabs(backup), f'AC-126 ⑫：备份落点应是绝对路径，实际 {backup}'
assert os.path.dirname(backup) == data_dir, f'AC-126 ⑫：备份必须落在 DATA_DIR 里，实际 {backup}'
mode = stat.S_IMODE(os.stat(backup).st_mode)
assert mode == 0o600, f'AC-126 ⑫：备份必须是 0600，实际 {oct(mode)}'
saved = json.load(open(backup, encoding='utf-8'))
assert saved['count'] == before_rows and len(saved['rows']) == before_rows, f'AC-126 ⑫：备份内容条数不对：{saved.get("count")} / {len(saved.get("rows", []))}'
kinds = sorted(row['kind'] for row in saved['rows'])
assert kinds == ['copy', 'copy', 'mcp', 'view'], f'AC-126 ⑫：备份里必须是那 4 条真实事件，实际 {kinds}'
con = db()
after_rows = con.execute('SELECT COUNT(*) AS n FROM usage_events').fetchone()['n']
after_prompts = con.execute('SELECT COUNT(*) AS n FROM prompts').fetchone()['n']
con.close()
assert after_rows == 0, f'AC-126 ⑪：replace 确实会清空取用历史（这是有意的取舍，只是不许静默），实际剩 {after_rows}'
assert after_prompts == 0, f'清库后 prompts 应为 0，实际 {after_prompts}'
print(f'  ✅ AC-126 ⑪⑫：replace 回报 action=cleared / count={history["count"]} / backup={backup}')
print(f'     备份 0600、落在 DATA_DIR、内含 {len(saved["rows"])} 条真实事件；库内 usage_events 已从 {before_rows} 变 0（清空是有意取舍，但不是静默）')
print('     —— 同一件事在 A 组那次 replace 导入上就发生过一次：存量 3 条取用行被级联清掉且当时**没有任何提示**，这正是 FR-134 要修的坑')
print(f'     清库前 prompts={before_prompts} → 清库后 0（用于验证下面的恢复链路）')

# 从云端恢复（merge）—— 排序必须还在
pull = call('POST', '/api/sync/pull', {'mode': 'merge'})
ph = pull['usage_history']
assert ph['action'] == 'kept', f'AC-126 ⑭：merge 必须回报 action=kept，实际 {ph}'
assert ph['count'] == 0, f'AC-126 ⑭：merge 报的条数应是当前库里剩下的取用行数，实际 {ph["count"]}'
assert ph['backup'] is None, f'AC-126 ⑭：merge 不该写备份，实际 {ph["backup"]!r}'
print(f'  ✅ AC-126 ⑭：merge 恢复回报 action=kept / count={ph["count"]} / backup=null（merge 本来就不清库）')

listing = call('GET', '/api/prompts?limit=200&sort=custom')['items']
by_title = {p['title']: p for p in listing}
assert len(listing) == before_prompts, f'AC-126 ⑤：从云端恢复后条数应为 {before_prompts}，实际 {len(listing)}'
order = [by_title[t]['id'] for t in (title_c, title_a, title_b)]
con = db()
rows = {row['id']: row['sort_order'] for row in con.execute('SELECT id, sort_order FROM prompts').fetchall()}
con.close()
assert rows[order[0]] < rows[order[1]] < rows[order[2]], f'AC-126 ⑤：恢复后 sort_order 必须仍是 C<A<B，实际 {rows}'
seen = [p['id'] for p in listing if p['title'] in (title_a, title_b, title_c)]
assert seen == order, f'AC-126 ⑤：恢复后列表顺序必须仍是 C,A,B，实际 {seen}'
print(f'  ✅ AC-126 ⑤：清库 → 从云端 merge 恢复后，{len(listing)} 条 prompt 回来了，顺序仍是 C,A,B（库里 sort_order C={rows[order[0]]} A={rows[order[1]]} B={rows[order[2]]}）')

json.dump({'a': by_title[title_a]['id'], 'b': by_title[title_b]['id'], 'c': by_title[title_c]['id'],
           'titles': [title_a, title_b, title_c]}, open(fix_path, 'w', encoding='utf-8'))
PY3

line "4d. AC-126 D 组：updatePrompt 同事务 + 约束错误按类型分派"
python3 - "$BASE" "$AC_DIR" "$SID" <<'PY4' || die "D 组核对不符"
import json, sqlite3, sys, urllib.error, urllib.request

base, data_dir, sid = sys.argv[1:4]

def call(method, path, body=None):
    data = None if body is None else json.dumps(body).encode('utf-8')
    hdrs = {'Cookie': 'pm_sid=' + sid}
    if body is not None:
        hdrs['Content-Type'] = 'application/json'
    req = urllib.request.Request(base + path, method=method, data=data, headers=hdrs)
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read().decode('utf-8')
            return None if raw == '' else json.loads(raw)
    except urllib.error.HTTPError as err:
        return None

def call_status(method, path, body=None):
    data = None if body is None else json.dumps(body).encode('utf-8')
    hdrs = {'Cookie': 'pm_sid=' + sid}
    if body is not None:
        hdrs['Content-Type'] = 'application/json'
    req = urllib.request.Request(base + path, method=method, data=data, headers=hdrs)
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, resp.read().decode('utf-8')
    except urllib.error.HTTPError as err:
        return err.code, err.read().decode('utf-8')

def db():
    con = sqlite3.connect(f'{data_dir}/pm.db')
    con.row_factory = sqlite3.Row
    return con

p = call('POST', '/api/prompts', {'title': '阶段64并发夹具', 'user_prompt': '正文 v1', 'system_prompt': '', 'notes': ''})
pid = p['id']

# ① 唯一约束冲突：直接占掉"下一个 version_no"（模拟另一个写入者已经抢到），再让 PUT 去撞它
con = db()
con.execute(
    'INSERT INTO prompt_versions (prompt_id, version_no, title, user_prompt, system_prompt, notes, created_at)'
    ' VALUES (?, ?, ?, ?, ?, ?, ?)',
    (pid, 2, '占位', '占位正文', '', '', '2026-01-01T00:00:00.000Z'),
)
con.commit()
con.close()
code, body = call_status('PUT', f'/api/prompts/{pid}', {'user_prompt': '正文 v2'})
assert code == 400, f'AC-126 ⑯：撞唯一约束必须是 400（不是 500），实际 {code} {body}'
assert 'folder_id 引用了不存在的文件夹' not in body, f'AC-126 ⑯：唯一约束冲突**不许**报成 folder 文案，实际 {body}'
assert ('版本' in body) or ('冲突' in body) or ('重试' in body), f'AC-126 ⑯：错误信息必须能让人看懂是版本冲突，实际 {body}'
after = call('GET', f'/api/prompts/{pid}')
assert after['user_prompt'] == '正文 v1', f'AC-126 ⑯：这次编辑必须整体回滚，实际 {after["user_prompt"]!r}'
con = db()
vn = con.execute('SELECT version_no FROM prompts WHERE id = ?', (pid,)).fetchone()['version_no']
rows = con.execute('SELECT COUNT(*) AS n FROM prompt_versions WHERE prompt_id = ?', (pid,)).fetchone()['n']
con.close()
assert vn == 1 and rows == 2, f'AC-126 ⑯：回滚后 version_no 仍 1、版本行仍 2（1 真实 + 1 占位），实际 {vn} / {rows}'
print(f'  ✅ AC-126 ⑯：撞 UNIQUE(prompt_id, version_no) ⇒ 400「{body.split(chr(34))[3] if chr(34) in body else body[:60]}…」')
print('     不是 folder 文案；主体与版本号整体回滚（version_no=1、版本行 2 行未变）')

# ② 真 folder 外键错误 ⇒ 仍然报 folder 文案
code, body = call_status('PUT', f'/api/prompts/{pid}', {'folder_id': 999999})
assert code == 400 and 'folder_id 引用了不存在的文件夹' in body, f'AC-126 ⑰：真 FK 错误必须仍报 folder 文案，实际 {code} {body}'
print('  ✅ AC-126 ⑰：真 folder FK（folder_id=999999）仍报「folder_id 引用了不存在的文件夹」')

# ③ 并发写同一条：两个 PUT 同时发 ⇒ 要么串行成功、要么给可理解的错误（不许 500）
import threading
codes = []
def worker(text):
    codes.append(call_status('PUT', f'/api/prompts/{pid}', {'user_prompt': text})[0])

threads = [threading.Thread(target=worker, args=(f'并发 #{i}',)) for i in range(2)]
for t in threads:
    t.start()
for t in threads:
    t.join()
assert all(code in (200, 400) for code in codes), f'AC-126 ⑱：并发 PUT 不许出现 5xx，实际 {codes}'
final = call('GET', f'/api/prompts/{pid}')
con = db()
rows = con.execute('SELECT COUNT(*) AS n FROM prompt_versions WHERE prompt_id = ?', (pid,)).fetchone()['n']
con.close()
print(f'  ✅ AC-126 ⑱：两个并发 PUT ⇒ 状态码 {sorted(codes)}（无 5xx）；终态 version_no={final["version_no"]}、版本行 {rows} 行')
PY4

line "5. 真浏览器（PC 1440×900 + 移动 440×956）：排序在「推送云端 → 清库 → 恢复」之后仍在"
CHROME=$(ls -d /root/.cache/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell 2>/dev/null | sort | tail -1)
[ -n "$CHROME" ] || die "找不到 chrome-headless-shell"
ID_A=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["a"])' "$FIX")
ID_B=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["b"])' "$FIX")
ID_C=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["c"])' "$FIX")
echo "  夹具：A=$ID_A  B=$ID_B  C=$ID_C（期望顺序 C,A,B）"
python3 - "$PLAN" "$OUT_DIR" "$DUMP_DIR" "$BASE" "$SID" "$CHROME" "$ID_A" "$ID_B" "$ID_C" <<'PYPLAN' || die "生成计划失败"
import json, sys
plan_path, out_dir, dumps_dir, base, sid, chrome, id_a, id_b, id_c = sys.argv[1:10]

# 列表顺序探针：直接按 DOM 顺序读每行的 id（表格行 / 卡片都从各自的 testid 反推）
# antd 的 tbody 里还有测量行（没有 pm-edit-*）⇒ 取不到 id 的行直接滤掉，只看真实数据行
ORDER_TABLE = ('(() => [...document.querySelectorAll("[data-testid=pm-view-table] .ant-table-tbody tr")]'
               '.map((tr) => { const el = tr.querySelector("[data-testid^=pm-edit-]");'
               ' return el ? el.getAttribute("data-testid").replace("pm-edit-", "") : null; })'
               '.filter((id) => id !== null).join(","))()')
ORDER_CARD = ('(() => [...document.querySelectorAll("[data-testid=pm-use-card]")]'
              '.map((card) => { const el = card.querySelector("[data-testid^=pm-fav-card-]");'
              ' return el ? el.getAttribute("data-testid").replace("pm-fav-card-", "") : null; })'
              '.filter((id) => id !== null).join(","))()')
# antd 6 的选中值节点是 `.ant-select-content`（不是 antd 5 的 `.ant-select-selection-item`，踩过）
SORT_LABEL = ('(() => { const el = document.querySelector("[data-testid=pm-use-sort] .ant-select-content");'
              ' return el ? el.innerText.trim() : "(no sort)"; })()')

# 排序下拉默认是「最近更新」⇒ 必须先切到「自定义」（= 拖拽出来的 sort_order 顺序），否则看到的不是顺序
def search(text):
    return [
        {'type': 'type', 'selector': '[data-testid=pm-search-input]', 'text': text},
        {'type': 'sleep', 'ms': 1400},
    ]

shots = [
    # ① PC 1440×900：表格视图，顺序 C,A,B（清库 → 从云端恢复之后）
    {'name': '64-order-table-pc', 'path': '/', 'width': 1440, 'height': 900, 'auth': True,
     'storage': {'pm-view-mode': 'table', 'pm-use-sort': 'custom', 'pm-theme': 'light'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': search('阶段64排序') + [
         {'type': 'sleep', 'ms': 800},
         {'type': 'probe', 'name': 'pc-sort', 'expression': SORT_LABEL},
         {'type': 'probe', 'name': 'pc-order', 'expression': ORDER_TABLE},
     ],
     'dump': 'stage64-order-pc', 'settleMs': 700},

    # ② 移动 440×956：卡片视图，同一顺序
    {'name': '64-order-card-mobile', 'path': '/', 'width': 440, 'height': 956, 'auth': True,
     'storage': {'pm-view-mode': 'card', 'pm-use-sort': 'custom', 'pm-theme': 'light'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': search('阶段64排序') + [
         {'type': 'sleep', 'ms': 800},
         {'type': 'probe', 'name': 'm-sort', 'expression': SORT_LABEL},
         {'type': 'probe', 'name': 'm-order', 'expression': ORDER_CARD},
     ],
     'dump': 'stage64-order-mobile', 'settleMs': 700},
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
      got="${got%\"}"; got="${got#\"}"
      [ "$got" = "$want" ] && echo "  ✅ $key = $want" || die "$key 应为「$want」，实际「$got」"
      ;;
  esac
}

echo "--- AC-126 ㉒：PC 1440×900 表格视图，排序切到「自定义」后顺序 = C,A,B ---"
assert_probe pc-sort '自定义' has
assert_probe pc-order "$ID_C,$ID_A,$ID_B" eq
echo "--- AC-126 ㉒：移动 440×956 卡片视图，同一顺序 ---"
assert_probe m-sort '自定义' has
assert_probe m-order "$ID_C,$ID_A,$ID_B" eq

line "7. 服务端复核：恢复后的顺序确实来自库里的 sort_order"
python3 - "$BASE" "$AC_DIR" "$SID" "$ID_A" "$ID_B" "$ID_C" <<'PY5' || die "服务端复核不符"
import json, sqlite3, sys, urllib.request
base, data_dir, sid, id_a, id_b, id_c = sys.argv[1:7]
def listing():
    req = urllib.request.Request(f'{base}/api/prompts?limit=200&sort=custom', headers={'Cookie': 'pm_sid=' + sid})
    with urllib.request.urlopen(req) as resp:
        return json.load(resp)['items']
items = listing()
trio = {int(id_a), int(id_b), int(id_c)}
ids = [p['id'] for p in items if p['id'] in trio]
assert ids == [int(id_c), int(id_a), int(id_b)], f'服务端 sort=custom 里这三条的顺序应为 C,A,B，实际 {ids}'
print(f'     全表顺序（sort=custom）：{[p["id"] for p in items]}（另有并发夹具 sort_order=0、存量行 sort_order=4）')
con = sqlite3.connect(f'{data_dir}/pm.db')
con.row_factory = sqlite3.Row
rows = {row['id']: row['sort_order'] for row in con.execute('SELECT id, sort_order FROM prompts').fetchall()}
con.close()
assert rows[int(id_c)] < rows[int(id_a)] < rows[int(id_b)], f'库里的 sort_order 必须支撑这个顺序，实际 {rows}'
print(f'  ✅ 服务端复核：sort=custom ⇒ C,A,B；库里 sort_order C={rows[int(id_c)]} A={rows[int(id_a)]} B={rows[int(id_b)]}')
print('     —— 这三条是「推送到云端 → replace 清库 → 从云端 merge 恢复」之后的状态')
PY5

line "8. 截图与 DOM dump 落点"
ls -l "$OUT_DIR"/*.png
echo "  dump：$DUMP_DIR/"
echo
echo "✅ 阶段 64 端到端验收全部通过（存量库零迁移 / 接口 AC-126 A–D / 真同步往返 / 真浏览器 PC+移动顺序；临时实例与 GitHub 桩已自停、临时目录已清理）"
