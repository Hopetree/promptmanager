#!/usr/bin/env bash
# 阶段 5 验收自检：AC-10（导出 → 导入(replace) → 再导出 一致性）/ AC-11（非法导入不动数据）
# 另附：导入后的 FTS 同步验证、CLI `export --out` 与 /api/export 同格式验证。
#
# 与 BRIEF §8 的"统一夹具约定"一致：**每条 AC 自带夹具、互不依赖**（各自的临时 DATA_DIR +
# 自建口令 + 自起自停服务）。跑完不留常驻服务、不留临时数据、不触碰生产文件。
#
# 用法：bash tools/ac-stage5.sh
set -u

cd "$(dirname "$0")/.." || exit 1
PORT=${PORT:-8767}
AC_PW='ac-fixture-pw-20260918'
BASE="http://127.0.0.1:$PORT"

AC_DIR=''
JAR=''
SRV_LOG=''
SRV_PID=''
NODE_PID=''

line() { printf '\n=== %s ===\n' "$1"; }

new_fixture() {
  AC_DIR=$(mktemp -d /tmp/pm-ac5-XXXXXX)
  JAR=$AC_DIR/jar.txt
  SRV_LOG=$AC_DIR/server.log
  echo "\$ AC_DIR=\$(mktemp -d /tmp/pm-ac5-XXXXXX)   # $AC_DIR"
  printf '%s\n' "$AC_PW" | DATA_DIR="$AC_DIR" node bin/pm.mjs user set-password --username admin >/dev/null
  echo "  (CLI 建库并设口令 rc=$?)"
}

start_server() {
  DATA_DIR="$AC_DIR" PORT="$PORT" npm start >"$SRV_LOG" 2>&1 &
  SRV_PID=$!
  sleep 3
  NODE_PID=$(pgrep -P "$SRV_PID" 2>/dev/null | head -1)
  echo "\$ DATA_DIR=\$AC_DIR PORT=$PORT npm start &   (node pid=$NODE_PID)"
  ss -ltn | grep ":$PORT"
}

stop_server() {
  if [ -n "$NODE_PID" ]; then kill "$NODE_PID" 2>/dev/null; fi
  if [ -n "$SRV_PID" ]; then kill "$SRV_PID" 2>/dev/null; fi
  sleep 1
  SRV_PID=''
  NODE_PID=''
}

end_fixture() {
  stop_server
  if [ -n "$AC_DIR" ]; then rm -rf "$AC_DIR"; fi
  AC_DIR=''
}

cleanup() {
  stop_server
  if [ -n "$AC_DIR" ]; then rm -rf "$AC_DIR"; fi
}
trap cleanup EXIT

login_jar() {
  curl -s -c "$JAR" -o /dev/null -w 'login=%{http_code}\n' -X POST -H 'Content-Type: application/json' \
    -d "{\"username\":\"admin\",\"password\":\"$AC_PW\"}" "$BASE/api/login"
}

# 造一份有代表性的数据：父子文件夹 + 2 标签 + 2 条 prompt（其中一条 2 个版本）
seed_data() {
  local parent child p1
  parent=$(curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' -d '{"name":"运维"}' "$BASE/api/folders" | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")
  child=$(curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' -d "{\"name\":\"交接\",\"parent_id\":$parent,\"sort_order\":3}" "$BASE/api/folders" | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")
  curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' -d '{"name":"交接"}' "$BASE/api/tags" >/dev/null
  curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' -d '{"name":"运维"}' "$BASE/api/tags" >/dev/null
  p1=$(curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' \
    -d "{\"title\":\"导出夹具甲\",\"user_prompt\":\"会话交接 {{变量A}}\",\"system_prompt\":\"sys-甲\",\"notes\":\"notes-甲\",\"folder_id\":$child,\"tags\":[\"运维\",\"交接\"],\"favorite\":true}" \
    "$BASE/api/prompts" | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")
  curl -s -b "$JAR" -X PUT -H 'Content-Type: application/json' -d '{"user_prompt":"会话交接 {{变量A}} 第二版"}' "$BASE/api/prompts/$p1" >/dev/null
  curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' -d '{"title":"导出夹具乙","user_prompt":"没有标签与文件夹"}' "$BASE/api/prompts" >/dev/null
  echo "(夹具：文件夹 2 个（父子）、标签 2 个、prompt 2 条（其中一条 2 个版本）)"
}

########################################################################
line "AC-10 导出 → 导入(replace) → 再导出：一致性（自带夹具）"
new_fixture
start_server
login_jar
seed_data

echo "\$ curl -s -b \$JAR $BASE/api/export > a.json"
curl -s -b "$JAR" "$BASE/api/export" >"$AC_DIR/a.json"
python3 - "$AC_DIR" <<'PY'
import json, sys
d = sys.argv[1]
a = json.load(open(f'{d}/a.json'))
print('app =', a['app'], '｜schema_version =', a['schema_version'], '｜exported_at =', a['exported_at'])
print('folders =', len(a['folders']), '｜tags =', len(a['tags']), '｜prompts =', len(a['prompts']))
print('prompt id 序列 =', [p['id'] for p in a['prompts']])
print('prompt[0].tags =', a['prompts'][0]['tags'], '｜favorite =', a['prompts'][0]['favorite'], '｜versions =', [v['version_no'] for v in a['prompts'][0]['versions']])
PY

python3 - "$AC_DIR" <<'PY'
import json, sys
d = sys.argv[1]
body = {"mode": "replace", "data": json.load(open(f'{d}/a.json'))}
json.dump(body, open(f'{d}/import-body.json', 'w'), ensure_ascii=False)
print('（已生成导入 body：{mode:replace, data:<a.json>}）')
PY
echo "\$ curl -s -b \$JAR -X POST -H 'Content-Type: application/json' -d @import-body.json $BASE/api/import"
curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' -d @"$AC_DIR/import-body.json" "$BASE/api/import" >"$AC_DIR/imported.json"
cat "$AC_DIR/imported.json"
echo

echo "\$ curl -s -b \$JAR $BASE/api/export > b.json"
curl -s -b "$JAR" "$BASE/api/export" >"$AC_DIR/b.json"
python3 - "$AC_DIR" <<'PY'
import json, sys
d = sys.argv[1]
a = json.load(open(f'{d}/a.json'))
b = json.load(open(f'{d}/b.json'))
imported = json.load(open(f'{d}/imported.json'))
for doc in (a, b):
    doc.pop('exported_at', None)
print('去掉 exported_at 后比对两份导出：', 'EQUAL' if a == b else 'DIFF')
print('imported.mode =', imported['mode'], '｜imported =', imported['imported'])
print('imported.prompts == 导出的 prompt 数：', 'MATCH' if imported['imported']['prompts'] == len(a['prompts']) else 'DIFF')
print('id 保留：', 'MATCH' if [p['id'] for p in a['prompts']] == [p['id'] for p in b['prompts']] else 'DIFF')
PY

echo '--- 附加：replace 真的清空重建（快照之后新增的数据必须消失），且导入内容可被检索（FTS 同步）'
curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' -d '{"title":"快照之后才加的","user_prompt":"临时记录"}' "$BASE/api/prompts" >/dev/null
curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' -d @"$AC_DIR/import-body.json" "$BASE/api/import" >/dev/null
curl -s -b "$JAR" "$BASE/api/prompts?limit=200" >"$AC_DIR/list.json"
curl -s -b "$JAR" -G --data-urlencode 'q=会话交接' "$BASE/api/prompts" >"$AC_DIR/hit.json"
curl -s -b "$JAR" -G --data-urlencode 'q=临时记录' "$BASE/api/prompts" >"$AC_DIR/miss.json"
python3 - "$AC_DIR" <<'PY'
import json, sys
d = sys.argv[1]
titles = [p['title'] for p in json.load(open(f'{d}/list.json'))['items']]
hit = json.load(open(f'{d}/hit.json'))['total']
miss = json.load(open(f'{d}/miss.json'))['total']
print('当前标题 =', titles)
print('"快照之后才加的" 已被清掉：', 'MATCH' if '快照之后才加的' not in titles else 'DIFF')
print('导入内容可检索（q=会话交接）：', 'MATCH' if hit == 1 else f'DIFF (total={hit})')
print('被清掉的数据检索不到（q=临时记录）：', 'MATCH' if miss == 0 else f'DIFF (total={miss})')
PY

echo '--- 附加：CLI `export --out` 与 /api/export 同格式（去掉 exported_at 后 EQUAL）'
echo "\$ DATA_DIR=\$AC_DIR node bin/pm.mjs export --out \$AC_DIR/cli.json"
DATA_DIR="$AC_DIR" node bin/pm.mjs export --out "$AC_DIR/cli.json"
echo "rc=$?"
curl -s -b "$JAR" "$BASE/api/export" >"$AC_DIR/api-now.json"
python3 - "$AC_DIR" <<'PY'
import json, sys
d = sys.argv[1]
cli = json.load(open(f'{d}/cli.json'))
api = json.load(open(f'{d}/api-now.json'))
cli.pop('exported_at', None); api.pop('exported_at', None)
print('CLI 文件与 API 导出：', 'EQUAL' if cli == api else 'DIFF')
print('CLI 文件 prompts 数 =', len(cli['prompts']))
PY
end_fixture

########################################################################
line "AC-11 非法导入不动数据（自带夹具）"
new_fixture
start_server
login_jar
seed_data

echo "\$ curl -s -b \$JAR $BASE/api/export > before.json   # 记录导入前的数据"
curl -s -b "$JAR" "$BASE/api/export" >"$AC_DIR/before.json"
python3 -c "
import json
d = json.load(open('$AC_DIR/before.json'))
print('导入前：prompts =', len(d['prompts']), '｜folders =', len(d['folders']), '｜tags =', len(d['tags']))
"

for payload in '{"app":"other","schema_version":1}' '{"app":"promptmanager","schema_version":99}' '{"app":"promptmanager","schema_version":1}'; do
  echo "\$ curl -s -b \$JAR -X POST -d '{\"mode\":\"replace\",\"data\":$payload}' $BASE/api/import"
  printf '  '; curl -s -w '  [HTTP %{http_code}]\n' -b "$JAR" -X POST -H 'Content-Type: application/json' \
    -d "{\"mode\":\"replace\",\"data\":$payload}" "$BASE/api/import"
done

echo "\$ curl -s -b \$JAR $BASE/api/export > after.json   # 再记录一次"
curl -s -b "$JAR" "$BASE/api/export" >"$AC_DIR/after.json"
python3 - "$AC_DIR" <<'PY'
import json, sys
d = sys.argv[1]
before = json.load(open(f'{d}/before.json'))
after = json.load(open(f'{d}/after.json'))
bp, ap = len(before['prompts']), len(after['prompts'])
before.pop('exported_at', None); after.pop('exported_at', None)
print('导入后：prompts =', ap, '｜folders =', len(after['folders']), '｜tags =', len(after['tags']))
print('prompt 数与导入前一致：', 'MATCH' if bp == ap else f'DIFF ({bp} → {ap})')
print('整库逐字段与导入前一致：', 'EQUAL' if before == after else 'DIFF')
PY
end_fixture

line "收尾：停服并核验端口已释放"
echo "\$ ss -ltn | grep -c ':$PORT'   # 期望 0"
ss -ltn | grep -c ":$PORT"

echo
echo "阶段 5 自检结束；夹具目录已清理，端口 $PORT 已释放。"
