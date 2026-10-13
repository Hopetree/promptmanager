#!/usr/bin/env bash
# 阶段 62（FR-129 版本号只记「内容变更」）一次性验收脚本 —— **交付态，随仓库入库（tools/acceptance/）**。
#
# 判据：`tmp/dev-process/BRIEF.md` 的 FR-129 / AC-124 / D-60 三节。
# 做法：① **在「已有数据」的库上**跑迁移：先只放 001–007 建库，灌**真实的存量形态**（含一条
#          "version_no=12 但只留 10 行、内容只有 1 种"的记录，即生产库里 id=2/6/18 的样子），
#          再跑全量迁移 → 断言**没有 009**（阶段 62 零迁移）、存量数据一个字节都不动；
#       ② 临时 DATA_DIR + 台账范围内空闲端口（避开 8767）自起自停；真实 POST /api/login 取 cookie；
#       ③ 接口层逐条核对 AC-124：内容变更 +1 / 非内容变更三者都不动 / 值没真变不动 / 回滚吃同一判据 /
#          存量重复版本不被清理；
#       ④ 真浏览器（tools/ui-shot.mjs + chrome-headless-shell）PC 1440×900 与移动 440×956：
#          版本面板「点收藏不新增、正文编辑后新增一条」。
# 用法：bash tools/acceptance/ac-stage62.sh
set -u

cd "$(dirname "$0")/../.." || exit 1
ROOT="$PWD"
OUT_DIR='tmp/stage62/shots'
DUMP_DIR='tmp/stage62/dumps'
mkdir -p "$OUT_DIR" "$DUMP_DIR"

AC_PW='ac-fixture-pw-20260918'
TITLE_MAIN='阶段62版本号 主夹具'
TITLE_LEGACY='存量62-正常'
TITLE_DUP='存量62-重复版本'

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

AC_DIR=$(mktemp -d /tmp/pm-s62-XXXXXX)
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

line "0. 前置：端口 / 构建产物 / 阶段 62 必须零迁移"
ss -ltn | grep -q ":$PORT " && die "端口 $PORT 已被占用"
echo "  端口 $PORT 空闲；BASE=$BASE"
[ -f dist/web/index.html ] || die "缺 dist/web —— 先 npm run build"
[ -f dist/server/index.js ] || die "缺 dist/server —— 先 npm run build"
if ls migrations/009_*.sql >/dev/null 2>&1; then die "阶段 62 是零迁移，不该存在 009_*.sql"; fi
echo "  ✅ migrations/ 最新仍是 008（阶段 62 零迁移）：$(ls migrations | tail -1)"

line "1. 迁移：在「已有数据」的库上跑全量迁移（先 001–007 建库 + 灌存量行，再升级）"
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

const now = '2026-01-01T00:00:00.000Z';
const ins = db.prepare(
  'INSERT INTO prompts (title, user_prompt, system_prompt, created_at, updated_at, version_no) VALUES (?, ?, ?, ?, ?, ?)',
);
const insV = db.prepare(
  'INSERT INTO prompt_versions (prompt_id, version_no, title, user_prompt, system_prompt, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
);

// ① 正常存量：1 条内容 + 1 条版本行。
const normalId = ins.run('存量62-正常', '存量正文', '', now, now, 1).lastInsertRowid;
insV.run(normalId, 1, '存量62-正常', '存量正文', '', '', now);

// ② 真实生产库里 id=2/6/18 的形态：version_no=12，但只留了 10 行，且**内容只有 1 种**
//    （D-60 ②：存量数据一个字节都不动 —— 不清理、不重编号）。
const dupId = ins.run('存量62-重复版本', '同一份正文', '', now, now, 12).lastInsertRowid;
for (let n = 3; n <= 12; n += 1) insV.run(dupId, n, '存量62-重复版本', '同一份正文', '', '', now);

const after = runMigrations(db, `${root}/migrations`);
console.log(`  升级（跑 008_remember-variables.sql）→ schema v${String(after.version)}`);
assert.equal(after.version, 8, '升级后必须是 v8（阶段 62 没有新迁移）');

const dup = db.prepare('SELECT version_no FROM prompts WHERE title = ?').get('存量62-重复版本');
const dupRows = db.prepare('SELECT version_no, title, user_prompt FROM prompt_versions WHERE prompt_id = ? ORDER BY version_no').all(dupId);
console.log(`  存量「重复版本」：version_no=${String(dup.version_no)}，留存 ${String(dupRows.length)} 行（3–12）`);
assert.equal(dup.version_no, 12, 'D-60 ②：存量 version_no 不许被改');
assert.equal(dupRows.length, 10, 'D-60 ②：存量 10 行重复版本不许被清理');
assert.deepEqual(
  dupRows.map((r) => r.user_prompt),
  Array.from({ length: 10 }, () => '同一份正文'),
  'D-60 ②：存量重复行的内容不许被改',
);
db.close();
console.log('  ✅ 已有数据的库升级后：schema v8；存量 10 行重复版本原样保留（不清理、不重编号）');
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

line "4. 接口层：AC-124 A/B/C/D 组逐条核对（真 HTTP + 真 SQLite）"
python3 - "$BASE" "$SID" "$TITLE_MAIN" "$TITLE_LEGACY" "$TITLE_DUP" "$FIX" <<'PY' || die "接口层核对不符"
import json, sys, time, urllib.error, urllib.request

base, sid, title_main, title_legacy, title_dup, fix_path = sys.argv[1:7]
BODY = {'title': title_main, 'user_prompt': '正文 v1', 'system_prompt': '系统 v1', 'notes': '备注 v1'}

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
    return call('GET', '/api/prompts?limit=200')['items']

def by_title(title):
    hits = [p for p in listing() if p['title'] == title]
    assert len(hits) == 1, f'标题 {title!r} 应恰有 1 条，实际 {len(hits)}'
    return hits[0]

def versions(pid):
    return call('GET', f'/api/prompts/{pid}/versions')['items']

def snap(p):
    """(version_no, updated_at, 版本行数) —— 非内容变更必须三者都不动。"""
    return (p['version_no'], p['updated_at'], len(versions(p['id'])))

def sleep(ms=30):
    time.sleep(ms / 1000)

# ---------- A. 内容变更 ----------
a = call('POST', '/api/prompts', BODY)
assert a['version_no'] == 1 and len(versions(a['id'])) == 1, 'AC-124 ①：新建 ⇒ version_no=1 + 1 行版本'
sleep()
u = call('PUT', f'/api/prompts/{a["id"]}', {'user_prompt': '正文 v2'})
assert u['version_no'] == 2, f'AC-124 ①：改 user_prompt ⇒ +1，实际 {u["version_no"]}'
rows = versions(a['id'])
assert len(rows) == 2, 'AC-124 ①：版本行 +1'
assert rows[-1]['version_no'] == 2 and rows[-1]['title'] == u['title'], 'AC-124 ①：新版本行的 title 必须等于更新后的主体'
assert rows[-1]['created_at'] == u['updated_at'], 'AC-124 ③：新版本行 created_at == 主体 updated_at'
assert u['updated_at'] != a['updated_at'], 'AC-124 ③：内容变更后 updated_at 必须变'
print('  ✅ AC-124 ①③：改 user_prompt ⇒ version_no 1→2、版本行 +1、新行 created_at == 主体 updated_at')

# ② title / system_prompt / notes 各自单独验证（每次都换一个真不同的值）
for field, value in (('title', title_main + ' 改'), ('system_prompt', '系统 v2'), ('notes', '备注 v2')):
    pid = a['id']
    cur = call('GET', f'/api/prompts/{pid}')
    sleep()
    got = call('PUT', f'/api/prompts/{pid}', {field: value})
    assert got['version_no'] == cur['version_no'] + 1, f'AC-124 ②：改 {field} 必须 +1（{cur["version_no"]} → {got["version_no"]}）'
    assert got[field] == value, f'AC-124 ②：改 {field} 必须真的写进去'
    print(f'  ✅ AC-124 ②：单独改 {field} ⇒ version_no {cur["version_no"]} → {got["version_no"]}')

# ④ 一次改多个内容字段只 +1
cur = call('GET', f'/api/prompts/{a["id"]}')
sleep()
got = call('PUT', f'/api/prompts/{a["id"]}', {'user_prompt': '正文 v3', 'system_prompt': '系统 v3', 'notes': '备注 v3'})
assert got['version_no'] == cur['version_no'] + 1, f'AC-124 ④：一次改 3 个内容字段只能 +1（{cur["version_no"]} → {got["version_no"]}）'
print(f'  ✅ AC-124 ④：一次改多个内容字段 ⇒ 只 +1（{cur["version_no"]} → {got["version_no"]}）')

# ---------- B. 非内容变更 ----------
folder = call('POST', '/api/folders', {'name': '阶段62 目录'})
cases = [
    ('AC-124 ⑤ favorite', {'favorite': True}),
    ('AC-124 ⑥ folder_id', {'folder_id': folder['id']}),
    ('AC-124 ⑦ remember_variables', {'remember_variables': False}),
    ('AC-124 ⑧ tags', {'tags': ['阶段62标签']}),
]
for label, payload in cases:
    before = snap(call('GET', f'/api/prompts/{a["id"]}'))
    sleep()
    after = call('PUT', f'/api/prompts/{a["id"]}', payload)
    now = snap(after)
    assert now == before, f'{label}：非内容变更必须三者都不动，{before} → {now}'
    print(f'  ✅ {label}：version_no={now[0]}、updated_at 与版本行数（{now[2]}）都不动')

# 往返：把上面四项改回去，同样不许动
for label, payload in (('favorite', {'favorite': False}), ('folder_id', {'folder_id': None}),
                       ('remember_variables', {'remember_variables': True}), ('tags', {'tags': []})):
    before = snap(call('GET', f'/api/prompts/{a["id"]}'))
    sleep()
    now = snap(call('PUT', f'/api/prompts/{a["id"]}', payload))
    assert now == before, f'AC-124 ⑤–⑧ 往返：{label} 改回去同样不许动，{before} → {now}'
print('  ✅ AC-124 ⑤–⑧ 往返：四项改回原值，version_no / updated_at / 版本行数依旧不动')

# ⑨ 批量 favorite / move：3 条混合批（有的变、有的没变）
b1 = call('POST', '/api/prompts', dict(BODY, title='阶段62批量 1'))
b2 = call('POST', '/api/prompts', dict(BODY, title='阶段62批量 2', favorite=True))
b3 = call('POST', '/api/prompts', dict(BODY, title='阶段62批量 3', folder_id=folder['id']))
mixed = [b1['id'], b2['id'], b3['id']]
before = {pid: snap(call('GET', f'/api/prompts/{pid}')) for pid in mixed}
sleep()
call('POST', '/api/prompts/bulk', {'action': 'favorite', 'ids': mixed})
sleep()
call('POST', '/api/prompts/bulk', {'action': 'move', 'ids': mixed, 'folder_id': folder['id']})
after = {pid: snap(call('GET', f'/api/prompts/{pid}')) for pid in mixed}
assert after == before, f'AC-124 ⑨：批量 favorite+move 三者都不许动，{before} → {after}'
assert call('GET', f'/api/prompts/{b1["id"]}')['favorite'] is True, 'AC-124 ⑨：批量收藏必须真的生效'
assert call('GET', f'/api/prompts/{b1["id"]}')['folder_id'] == folder['id'], 'AC-124 ⑨：批量移动必须真的生效'
print(f'  ✅ AC-124 ⑨：批量 favorite+move（3 条混合批）生效，但 version_no 全仍为 {after[b1["id"]][0]}')

# ⑩ 拖拽排序（不得回归）
before = {pid: snap(call('GET', f'/api/prompts/{pid}')) for pid in mixed}
call('PATCH', '/api/prompts/order', {'ids': list(reversed(mixed))})
after = {pid: snap(call('GET', f'/api/prompts/{pid}')) for pid in mixed}
assert after == before, f'AC-124 ⑩：拖拽排序不许动版本，{before} → {after}'
print('  ✅ AC-124 ⑩（不得回归）：PATCH /api/prompts/order 不动 version_no / updated_at / 版本行数')

# ---------- C. 值没真变 ----------
pid = a['id']
for label, payload in (('AC-124 ⑪ 传同值 title', {'title': call('GET', f'/api/prompts/{pid}')['title']}),
                       ('AC-124 ⑬ PUT {}', {})):
    before = snap(call('GET', f'/api/prompts/{pid}'))
    sleep()
    now = snap(call('PUT', f'/api/prompts/{pid}', payload))
    assert now == before, f'{label}：值没真变必须都不动，{before} → {now}'
    print(f'  ✅ {label}：三者都不动')

cur = call('GET', f'/api/prompts/{pid}')
all_same = {'title': cur['title'], 'user_prompt': cur['user_prompt'], 'system_prompt': cur['system_prompt'], 'notes': cur['notes']}
before = snap(cur)
sleep()
now = snap(call('PUT', f'/api/prompts/{pid}', all_same))
assert now == before, f'AC-124 ⑫：四个内容字段全传同值必须都不动，{before} → {now}'
print('  ✅ AC-124 ⑫：一次传全部 4 个内容字段且都同值 ⇒ 三者都不动')

# ⑭ 回滚到与当前完全相同的那一版 ⇒ 不产生新版本
rows = versions(pid)
cur = call('GET', f'/api/prompts/{pid}')
same_no = cur['version_no']
before = snap(cur)
sleep()
now = snap(call('POST', f'/api/prompts/{pid}/versions/{same_no}/rollback'))
assert now == before, f'AC-124 ⑭：回滚到与当前相同的内容不许产生版本，{before} → {now}'
print(f'  ✅ AC-124 ⑭：回滚到与当前完全相同的那一版（v{same_no}）⇒ 不产生新版本')

# ---------- D. 回滚与既有能力不回归 ----------
call('PUT', f'/api/prompts/{pid}', {'favorite': True, 'folder_id': folder['id'], 'remember_variables': False, 'tags': ['回滚标签']})
sleep()
before_p = call('GET', f'/api/prompts/{pid}')
v1 = versions(pid)[0]['version_no']
sleep()
rb = call('POST', f'/api/prompts/{pid}/versions/{v1}/rollback')
assert rb['version_no'] == before_p['version_no'] + 1, 'AC-124 ⑮：回滚到不同内容 ⇒ +1'
assert rb['user_prompt'] == BODY['user_prompt'], 'AC-124 ⑮：回滚必须恢复 v1 的 user_prompt'
assert rb['favorite'] is True and rb['folder_id'] == folder['id'], 'AC-124 ⑮：回滚不许碰 favorite / folder_id'
assert rb['remember_variables'] is False, 'AC-124 ⑮：回滚不许碰 remember_variables'
assert rb['tags'] == ['回滚标签'], 'AC-124 ⑮：回滚不许碰标签'
print(f'  ✅ AC-124 ⑮：回滚到 v{v1} ⇒ +1（{before_p["version_no"]} → {rb["version_no"]}），只恢复 4 个内容字段，其余不受影响')

# ⑯ FR-86：连续 12 次内容变更 ⇒ 版本行 ≤ 10
r = call('POST', '/api/prompts', dict(BODY, title='阶段62保留上限'))
for i in range(1, 13):
    sleep()
    call('PUT', f'/api/prompts/{r["id"]}', {'user_prompt': f'正文 #{i}'})
r = call('GET', f'/api/prompts/{r["id"]}')
assert r['version_no'] == 13, f'AC-124 ⑯：新建 v1 + 12 次内容变更 ⇒ version_no 应为 13，实际 {r["version_no"]}'
assert len(versions(r['id'])) == 10, 'AC-124 ⑯：版本行必须 ≤ 10'
print('  ✅ AC-124 ⑯（不得回归）：新建 + 12 次内容变更 ⇒ version_no=13、版本行 10（FR-86 上限不变）')

# ⑰ 取用记账不产生版本
before = snap(call('GET', f'/api/prompts/{pid}'))
call('POST', f'/api/prompts/{pid}/render', {'values': {}})
call('POST', f'/api/prompts/{pid}/copy')
now = snap(call('GET', f'/api/prompts/{pid}'))
assert now == before, f'AC-124 ⑰：取用记账不许产生版本，{before} → {now}'
print('  ✅ AC-124 ⑰（不得回归）：/render 与 /api/prompts/:id/copy 不产生新版本')

# ⑱ 导出 / 导入往返：版本按文件内容保留
before_exp = call('GET', '/api/export')
target = [p for p in before_exp['prompts'] if p['title'] == '阶段62保留上限'][0]
call('POST', '/api/import', {'mode': 'replace', 'data': before_exp})
after_exp = call('GET', '/api/export')
before_exp.pop('exported_at'); after_exp.pop('exported_at')
assert json.dumps(after_exp, ensure_ascii=False, sort_keys=True) == json.dumps(before_exp, ensure_ascii=False, sort_keys=True), \
    'AC-124 ⑱：导出 → replace 导入 → 再导出必须逐字一致'
new_target = [p for p in after_exp['prompts'] if p['title'] == '阶段62保留上限'][0]
# 导出文件里没有顶层 version_no：当前版本号 = versions 里最大的 version_no（FR-7 的约定）
def top_version(p):
    return max(v['version_no'] for v in p['versions'])
assert top_version(new_target) == top_version(target), 'AC-124 ⑱：导入后 version_no 必须按文件保留'
assert len(new_target['versions']) == len(target['versions']), 'AC-124 ⑱：导入后版本行数必须按文件保留'
print(f'  ✅ AC-124 ⑱：导出 → /api/import replace → 再导出逐字一致；version_no={top_version(new_target)}、版本行 {len(new_target["versions"])} 按文件保留')

# ---------- D-60 ② 存量数据一个字节都不动 ----------
dup = by_title(title_dup)
assert dup['version_no'] == 12, f'D-60 ②：存量 version_no 必须仍为 12，实际 {dup["version_no"]}'
assert len(versions(dup['id'])) == 10, 'D-60 ②：存量 10 行重复版本必须仍在（不许清理）'
normal = by_title(title_legacy)
assert normal['version_no'] == 1, 'D-60 ②：存量正常记录不许被改'
print('  ✅ D-60 ②：走完全部读写路径后，存量「version_no=12 / 10 行重复版本」与存量正常记录一个字节都没动')

# 浏览器夹具：一条全新的、只有 1 个版本的提示词
fx = call('POST', '/api/prompts', {'title': '阶段62面板夹具', 'user_prompt': '面板正文 v1', 'notes': '浏览器夹具'})
assert fx['version_no'] == 1 and len(versions(fx['id'])) == 1
# 返工① 夹具：同样只有 1 个版本 —— 对它点「回滚」就是**回滚到与当前内容相同的那一版**，
# 服务端不产生新版本 ⇒ 提示必须是 info「内容与当前相同，未生成新版本」（不许说"已生成新版本"）。
rb = call('POST', '/api/prompts', {'title': '阶段62回滚夹具', 'user_prompt': '回滚正文 v1', 'notes': '回滚夹具'})
assert rb['version_no'] == 1 and len(versions(rb['id'])) == 1
json.dump({'panel': fx['id'], 'title': fx['title'],
           'rollback': rb['id'], 'rollbackTitle': rb['title']}, open(fix_path, 'w', encoding='utf-8'))
print(f'  浏览器夹具：id={fx["id"]}（version_no=1，1 行版本）；回滚夹具：id={rb["id"]}（version_no=1）')
PY

ID_PANEL=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["panel"])' "$FIX")
TITLE_PANEL=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["title"])' "$FIX")
ID_RB=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["rollback"])' "$FIX")
TITLE_RB=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["rollbackTitle"])' "$FIX")
echo "  夹具：panel=$ID_PANEL  title=$TITLE_PANEL  |  rollback=$ID_RB  title=$TITLE_RB"

line "5. 真浏览器（PC 1440×900 + 移动 440×956）：版本面板点收藏不新增、正文编辑后新增一条"
CHROME=$(ls -d /root/.cache/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell 2>/dev/null | sort | tail -1)
[ -n "$CHROME" ] || die "找不到 chrome-headless-shell"
python3 - "$PLAN" "$OUT_DIR" "$DUMP_DIR" "$BASE" "$SID" "$CHROME" "$ID_PANEL" "$TITLE_PANEL" "$ID_RB" "$TITLE_RB" <<'PYPLAN' || die "生成计划失败"
import json, sys
plan_path, out_dir, dumps_dir, base, sid, chrome, pid, title, rb_id, rb_title = sys.argv[1:11]

def search(title):
    return [
        {'type': 'type', 'selector': '[data-testid=pm-search-input]', 'text': title},
        {'type': 'sleep', 'ms': 1000},
    ]

COUNT = ('(() => { const el = [...document.querySelectorAll("span")]'
         '.find((n) => /^共\\s*\\d+\\s*个版本$/.test((n.innerText || "").trim()));'
         ' return el ? el.innerText.trim() : "(no count)"; })()')

TOGGLE_VIEW_SPLIT = {'type': 'view', 'label': '分栏'}
TOGGLE_VIEW_TABLE = {'type': 'view', 'label': '表格'}

# 返工① 用的两个探针：Popconfirm 的说明文字、以及 antd message 的提示文字
POPCONFIRM_TEXT = ('(() => { const el = document.querySelector(".ant-popconfirm .ant-popconfirm-description");'
                   ' return el ? el.innerText.trim() : "(no popconfirm)"; })()')
# 注意：这套 antd 的 message 文字节点是 `.ant-message-notice-title`，
# 容器是 `.ant-message-notice`；**没有** `.ant-message-notice-content`（踩过）。
TOAST = ('(() => { const els = [...document.querySelectorAll(".ant-message-notice")];'
         ' return els.length ? els.map((n) => n.innerText.trim()).join(" | ") : "(no toast)"; })()')

shots = [
    # ① PC 1440×900：详情弹窗里的版本面板 —— 点收藏后**不新增**
    {'name': '62-panel-favorite-pc', 'path': '/', 'width': 1440, 'height': 900, 'auth': True,
     'storage': {'pm-view-mode': 'split', 'pm-theme': 'light'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': search(title) + [
         {'type': 'click', 'selector': '[data-testid=pm-split-item]'},
         {'type': 'wait', 'selector': '[data-testid=pm-detail]'},
         {'type': 'wait', 'selector': '[data-testid=pm-version-views]'},
         {'type': 'sleep', 'ms': 900},
         {'type': 'probe', 'name': 'fav-before', 'expression': COUNT},
         {'type': 'click', 'selector': f'[data-testid=pm-fav-detail-{pid}]'},
         {'type': 'sleep', 'ms': 1500},
         {'type': 'probe', 'name': 'fav-after', 'expression': COUNT},
     ],
     'dump': 'stage62-fav', 'settleMs': 700},

    # ② PC 1440×900：编辑正文保存后 —— 版本面板**新增一条**
    {'name': '62-panel-edit-pc', 'path': '/', 'width': 1440, 'height': 900, 'auth': True,
     'storage': {'pm-view-mode': 'table', 'pm-theme': 'light'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': search(title) + [
         {'type': 'click', 'selector': f'[data-testid=pm-edit-{pid}]'},
         {'type': 'wait', 'selector': '[data-testid=pm-editor]'},
         {'type': 'sleep', 'ms': 900},
         {'type': 'eval',
          'expression': '(() => { const el = document.querySelector("[data-testid=pm-version-views]"); if (el) el.scrollIntoView({ block: "center" }); return !!el; })()'},
         {'type': 'sleep', 'ms': 800},
         {'type': 'probe', 'name': 'edit-before', 'expression': COUNT},
         {'type': 'type', 'selector': '[data-testid=editor-user-prompt]', 'text': '（浏览器追加）'},
         {'type': 'sleep', 'ms': 400},
         {'type': 'click', 'selector': '[data-testid=editor-save]'},
         {'type': 'sleep', 'ms': 2000},
         {'type': 'probe', 'name': 'edit-after', 'expression': COUNT},
     ],
     'dump': 'stage62-edit', 'settleMs': 700},

    # ③ 移动 440×956：同一版本面板（详情抽屉）—— 内容已改过 ⇒ 共 2 个版本
    {'name': '62-panel-mobile', 'path': '/', 'width': 440, 'height': 956, 'auth': True,
     'storage': {'pm-view-mode': 'card', 'pm-theme': 'light'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': search(title) + [
         # 卡片视图靠**双击**打开详情（UseView 的 onDoubleClick）。星标按钮 onClick 里 stopPropagation，
         # 点它不会冒泡到卡片 ⇒ 直接对卡片元素派发一个冒泡的 dblclick 原生事件。
         {'type': 'eval',
          'expression': '(() => { const star = document.querySelector("[data-testid=pm-fav-card-'
                        + str(pid) + ']"); const card = star ? star.closest(".ant-card") : null;'
                        ' if (!card) return false;'
                        ' card.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, view: window }));'
                        ' return true; })()'},
         {'type': 'wait', 'selector': '[data-testid=pm-detail]'},
         {'type': 'wait', 'selector': '[data-testid=pm-version-views]'},
         {'type': 'sleep', 'ms': 900},
         {'type': 'probe', 'name': 'm-card-count', 'expression': COUNT},
         {'type': 'eval',
          'expression': '(() => { const el = document.querySelector("[data-testid=pm-detail]"); if (el) el.scrollIntoView({ block: "start" }); return !!el; })()'},
         {'type': 'sleep', 'ms': 600},
     ],
     'dump': 'stage62-mobile', 'settleMs': 700},

    # ④ PC 1440×900（返工①）：只有 1 个版本时点「回滚」= 回滚到与当前内容相同的那一版
    #    ⇒ 服务端**不产生新版本** ⇒ 提示必须是「内容与当前相同，未生成新版本」，且版本数不变。
    #    这条正是独立对抗性复核 finding 1 的回归点（旧文案无条件说"已生成新版本"）。
    {'name': '62-rollback-same-pc', 'path': '/', 'width': 1440, 'height': 900, 'auth': True,
     'storage': {'pm-view-mode': 'table', 'pm-theme': 'light'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': search(rb_title) + [
         {'type': 'click', 'selector': f'[data-testid=pm-edit-{rb_id}]'},
         {'type': 'wait', 'selector': '[data-testid=pm-editor]'},
         {'type': 'sleep', 'ms': 900},
         {'type': 'eval',
          'expression': '(() => { const el = document.querySelector("[data-testid=pm-version-views]"); if (el) el.scrollIntoView({ block: "center" }); return !!el; })()'},
         {'type': 'sleep', 'ms': 800},
         {'type': 'probe', 'name': 'rb-before', 'expression': COUNT},
         # 版本面板**默认落在「对比版本」**（`VersionPanel` 的 `useState<VersionView>('compare')`），
         # 而「回滚」按钮在**表格**视图的操作列里 ⇒ 先切到「表格」（`view` 动作写死了主界面的
         # `pm-use-viewmode`，这里用 eval 直接点 `pm-version-views` 里的那一段）。
         {'type': 'eval',
          'expression': '(() => { const items = [...document.querySelectorAll(\'[data-testid="pm-version-views"] .ant-segmented-item\')];'
                        ' const target = items.find((n) => (n.innerText || "").includes("表格"));'
                        ' if (!target) return false; target.click(); return true; })()'},
         {'type': 'wait', 'selector': '[data-testid=rollback-1]'},
         {'type': 'click', 'selector': '[data-testid=rollback-1]'},
         {'type': 'wait', 'selector': '.ant-popconfirm-buttons .ant-btn-primary'},
         {'type': 'sleep', 'ms': 400},
         {'type': 'probe', 'name': 'rb-confirm-text', 'expression': POPCONFIRM_TEXT},
         {'type': 'click', 'selector': '.ant-popconfirm-buttons .ant-btn-primary'},
         {'type': 'sleep', 'ms': 1200},
         {'type': 'probe', 'name': 'rb-toast', 'expression': TOAST},
         {'type': 'probe', 'name': 'rb-after', 'expression': COUNT},
     ],
     'dump': 'stage62-rollback-same', 'settleMs': 700},
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

echo "--- AC-124 ⑲：详情弹窗里点收藏，版本面板不新增 ---"
assert_probe fav-before '共 1 个版本' eq
assert_probe fav-after '共 1 个版本' eq

echo "--- AC-124 ⑲：编辑正文保存后，版本面板新增一条 ---"
assert_probe edit-before '共 1 个版本' eq
assert_probe edit-after '共 2 个版本' eq

echo "--- AC-124 ⑳：移动 440×956 同一面板（内容已改过 ⇒ 2 个版本） ---"
assert_probe m-card-count '共 2 个版本' eq

echo "--- 返工①（对抗性复核 finding 1）：回滚到「内容与当前相同」的那一版，提示不许说「已生成新版本」 ---"
assert_probe rb-before '共 1 个版本' eq
assert_probe rb-confirm-text '内容与当前不同时会生成一个新版本' has
assert_probe rb-toast '内容与当前相同，未生成新版本' has
assert_probe rb-toast '已生成新版本' not
assert_probe rb-after '共 1 个版本' eq

line "7. 服务端复核：收藏生效、版本号恰好 +1、updated_at 只被内容变更推动"
python3 - "$BASE" "$SID" "$ID_PANEL" "$ID_RB" <<'PY2' || die "服务端复核不符"
import json, sys, urllib.request
base, sid, pid, rb_id = sys.argv[1:5]
def get(prompt_id):
    req = urllib.request.Request(f'{base}/api/prompts/{prompt_id}', headers={'Cookie': 'pm_sid=' + sid})
    with urllib.request.urlopen(req) as resp:
        return json.load(resp)
def version_count(prompt_id):
    req = urllib.request.Request(f'{base}/api/prompts/{prompt_id}/versions', headers={'Cookie': 'pm_sid=' + sid})
    with urllib.request.urlopen(req) as resp:
        return len(json.load(resp)['items'])
p = get(pid)
assert p['favorite'] is True, '浏览器里点的收藏必须落库'
assert p['version_no'] == 2, f'浏览器路径下 version_no 应为 2（新建 1 + 正文编辑 1），实际 {p["version_no"]}'
assert '（浏览器追加）' in p['user_prompt'], '浏览器里改的正文必须落库'
print('  ✅ 服务端复核：favorite=true、version_no=2、正文含「（浏览器追加）」')
print('     —— 中间那次收藏没有产生版本（否则这里会是 3）')
rb = get(rb_id)
assert rb['version_no'] == 1, f'回滚到与当前相同的内容 ⇒ version_no 必须仍为 1，实际 {rb["version_no"]}'
assert version_count(rb_id) == 1, '回滚到与当前相同的内容 ⇒ 版本行数必须仍为 1'
print('  ✅ 返工① 服务端复核：点过「回滚」后 version_no=1、版本行数=1（内容相同 ⇒ 一个版本都没多）')
PY2

line "8. 截图与 DOM dump 落点"
ls -l "$OUT_DIR"/*.png
echo "  dump：$DUMP_DIR/"
echo
echo "✅ 阶段 62 端到端验收全部通过（存量库迁移零迁移 / 接口 AC-124 / 真浏览器 PC+移动+回滚文案；临时实例已自停、临时目录已清理）"
