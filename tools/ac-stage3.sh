#!/usr/bin/env bash
# 阶段 3 验收自检：AC-5（prompt CRUD 与版本号）/ AC-6（中文检索三种长度 + 特殊字符）/
# AC-7（检索性能规模基线）/ AC-14（文件夹与标签）。
#
# 与 BRIEF §8 的"统一夹具约定"一致：**每条 AC 自带夹具、互不依赖**（各自的临时 DATA_DIR +
# 自建口令 + 自起自停服务）。跑完不留常驻服务、不留临时数据、不触碰生产文件。
#
# 用法：bash tools/ac-stage3.sh
set -u

cd "$(dirname "$0")/.." || exit 1
PORT=${PORT:-8767}
AC_PW='ac-fixture-pw-20260918'
BASE="http://127.0.0.1:$PORT"

AC_DIR=''
JAR=''
HDR=''
SRV_LOG=''
SRV_PID=''
NODE_PID=''

line() { printf '\n=== %s ===\n' "$1"; }

new_fixture() {
  AC_DIR=$(mktemp -d /tmp/pm-ac3-XXXXXX)
  JAR=$AC_DIR/jar.txt
  HDR=$AC_DIR/headers.txt
  SRV_LOG=$AC_DIR/server.log
  echo "\$ AC_DIR=\$(mktemp -d /tmp/pm-ac3-XXXXXX)   # $AC_DIR"
  printf '%s\n' "$AC_PW" | DATA_DIR="$AC_DIR" node bin/pm.mjs user set-password --username admin
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

########################################################################
line "AC-5 prompt CRUD 与版本号（自带夹具）"
new_fixture
start_server
login_jar

cat >"$AC_DIR/submit.json" <<'JSON'
{"title":"会话交接模板（AC-5）","user_prompt":"你好 {{姓名}}，请把上下文交给下一位同学","system_prompt":"你是严谨的交接助手","notes":"备注：含 emoji ✅ 与 \"引号\"","tags":["交接"],"favorite":true}
JSON
echo '$ curl -s -b $JAR -X POST -H "Content-Type: application/json" -d @submit.json $BASE/api/prompts'
curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' -d @"$AC_DIR/submit.json" "$BASE/api/prompts" >"$AC_DIR/created.json"
cat "$AC_DIR/created.json"
echo
ID=$(python3 -c "import json;print(json.load(open('$AC_DIR/created.json'))['id'])")

echo "\$ curl -s -b \$JAR $BASE/api/prompts/$ID"
curl -s -b "$JAR" "$BASE/api/prompts/$ID" >"$AC_DIR/fetched.json"
python3 - "$AC_DIR" <<'PY'
import json, sys
d = sys.argv[1]
submitted = json.load(open(f'{d}/submit.json'))
created = json.load(open(f'{d}/created.json'))
fetched = json.load(open(f'{d}/fetched.json'))
checks = [
    ('title', submitted['title'], fetched['title']),
    ('user_prompt', submitted['user_prompt'], fetched['user_prompt']),
    ('system_prompt', submitted['system_prompt'], fetched['system_prompt']),
    ('notes', submitted['notes'], fetched['notes']),
    ('favorite', submitted['favorite'], fetched['favorite']),
    ('tags', sorted(submitted['tags']), fetched['tags']),
    ('folder_id', None, fetched['folder_id']),
]
for name, expected, actual in checks:
    print(f'{name:14s} {"MATCH" if expected == actual else "DIFF"}')
print('version_no     =', fetched['version_no'])
print('created 与 GET 整体一致：', 'MATCH' if created == fetched else 'DIFF')
print('created_at/updated_at 形如 ISO UTC：',
      'MATCH' if fetched['created_at'].endswith('Z') and fetched['updated_at'].endswith('Z') else 'DIFF')
PY

echo "\$ curl -s -b \$JAR -X PUT -d '{\"notes\":\"改过的备注\"}' $BASE/api/prompts/$ID"
curl -s -b "$JAR" -X PUT -H 'Content-Type: application/json' -d '{"notes":"改过的备注"}' "$BASE/api/prompts/$ID" >"$AC_DIR/updated.json"
python3 - "$AC_DIR" <<'PY'
import json, sys
d = sys.argv[1]
before = json.load(open(f'{d}/fetched.json'))
after = json.load(open(f'{d}/updated.json'))
print('version_no:', before['version_no'], '->', after['version_no'], '(PUT 必须产生新版本)')
print('notes:', repr(after['notes']))
for field in ['title', 'user_prompt', 'system_prompt', 'tags', 'favorite']:
    print(f'{field:14s} 未被改动：', 'MATCH' if before[field] == after[field] else 'DIFF')
PY

echo "\$ curl -s -o /dev/null -w '%{http_code}\n' -b \$JAR -X DELETE $BASE/api/prompts/$ID"
curl -s -o /dev/null -w '%{http_code}\n' -b "$JAR" -X DELETE "$BASE/api/prompts/$ID"
echo "\$ curl -s -o /dev/null -w '%{http_code}\n' -b \$JAR $BASE/api/prompts/$ID   # 删除后"
curl -s -o /dev/null -w '%{http_code}\n' -b "$JAR" "$BASE/api/prompts/$ID"
end_fixture

########################################################################
line "AC-6 中文检索（三种长度 + 特殊字符，自带夹具）"
new_fixture
start_server
login_jar

post_prompt() {
  curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' -d "$1" "$BASE/api/prompts" >/dev/null
}
post_prompt '{"title":"会话交接模板","user_prompt":"把上下文交给下一个同学"}'
post_prompt '{"title":"交接文档规范","user_prompt":"写清楚背景与上下文"}'
post_prompt '{"title":"rebase 流程","user_prompt":"rebase 之前先备份，保留上下文"}'
post_prompt '{"title":"FTS5 笔记","user_prompt":"trigram 与上下文"}'
post_prompt '{"title":"无关记录","user_prompt":"今天的天气与上下文"}'
echo '(已建 5 条固定中文语料)'

q_show() {
  curl -s -b "$JAR" -G --data-urlencode "q=$1" "$BASE/api/prompts" >"$AC_DIR/q.json"
  python3 -c "
import json
d = json.load(open('$AC_DIR/q.json'))
print('q=%-12s -> total=%s ids=%s' % (json.dumps('$1', ensure_ascii=False), d['total'], [i['id'] for i in d['items']]))
"
}
echo "\$ curl -s -b \$JAR -G --data-urlencode 'q=…' $BASE/api/prompts"
q_show '会话交接'
q_show '交接'
q_show '上下文'
q_show '不存在的词'
q_show 'REBASE'
q_show 'rebase'
q_show '   '

echo '--- 特殊字符（AC-6 原文 `"*-%_` 及更多变体）：必须 200，不得 500'
for q in '"*-%_' '"' '*' '-' '(' ')' '%' '_' 'a-b' 'C++' "it's" '\\'; do
  code=$(curl -s -o "$AC_DIR/nasty.json" -w '%{http_code}' -b "$JAR" -G --data-urlencode "q=$q" "$BASE/api/prompts")
  total=$(python3 -c "import json;print(json.load(open('$AC_DIR/nasty.json')).get('total'))" 2>/dev/null || echo 'parse-error')
  printf 'q=%-10s -> HTTP %s total=%s\n' "$(printf '%s' "$q" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')" "$code" "$total"
done

echo '--- 2 码点走 LIKE 兜底：命中数应 >= 2'
curl -s -b "$JAR" -G --data-urlencode 'q=交接' "$BASE/api/prompts" | python3 -c "
import json,sys
d = json.load(sys.stdin)
print('total =', d['total'], '（期望 >= 2）')
"
end_fixture

########################################################################
line "AC-7 检索性能（2000 条规模基线，自带夹具）"
new_fixture
start_server
login_jar
echo "\$ DATA_DIR=\$AC_DIR node tools/seed-prompts.mjs 2000"
DATA_DIR="$AC_DIR" node tools/seed-prompts.mjs 2000
echo "\$ for i in 1 2 3; do curl -s -o /dev/null -w '%{time_total}\n' -b \$JAR -G --data-urlencode 'q=会话交接' $BASE/api/prompts; done"
for i in 1 2 3; do
  curl -s -o /dev/null -w '%{time_total}\n' -b "$JAR" -G --data-urlencode 'q=会话交接' "$BASE/api/prompts"
done
echo "\$ 同上，取一次 body 的 total"
curl -s -b "$JAR" -G --data-urlencode 'q=会话交接' "$BASE/api/prompts" | python3 -c "
import json,sys
d = json.load(sys.stdin)
print('total =', d['total'], '｜ 本页 items =', len(d['items']), '｜ limit =', d['limit'])
"
echo '--- 对照：无 q 的列表耗时（同样 2000 条）'
curl -s -o /dev/null -w '%{time_total}\n' -b "$JAR" "$BASE/api/prompts?limit=200"
echo '--- 对照：2 码点 LIKE 兜底耗时'
curl -s -o /dev/null -w '%{time_total}\n' -b "$JAR" -G --data-urlencode 'q=交接' "$BASE/api/prompts"
end_fixture

########################################################################
line "AC-14 文件夹与标签（自带夹具）"
new_fixture
start_server
login_jar

echo '$ curl -s -b $JAR -X POST -d {"name":"运维"} /api/folders'
PARENT=$(curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' -d '{"name":"运维"}' "$BASE/api/folders" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['id'])")
CHILD=$(curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' -d "{\"name\":\"交接\",\"parent_id\":$PARENT,\"sort_order\":5}" "$BASE/api/folders" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['id'])")
echo "parent_id=$PARENT child_id=$CHILD"
echo '$ curl -s -b $JAR /api/folders'
curl -s -b "$JAR" "$BASE/api/folders" >"$AC_DIR/folders.json"
cat "$AC_DIR/folders.json"
echo
python3 - "$AC_DIR" "$PARENT" "$CHILD" <<'PY'
import json, sys
d, parent, child = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
items = json.load(open(f'{d}/folders.json'))['items']
by_id = {f['id']: f for f in items}
ok = by_id[child]['parent_id'] == parent and by_id[parent]['parent_id'] is None and by_id[child]['sort_order'] == 5
print('结构正确（子的 parent_id = 父 id、父为根、sort_order 保留）：', 'MATCH' if ok else 'DIFF')
PY

echo '$ 建两个标签，并把 prompt 归入文件夹 + 打标签（AC-14 的夹具）'
TAG_A=$(curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' -d '{"name":"交接"}' "$BASE/api/tags" | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")
TAG_B=$(curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' -d '{"name":"运维"}' "$BASE/api/tags" | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")
P1=$(curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' -d "{\"title\":\"归入文件夹并打标签 A\",\"folder_id\":$PARENT,\"tags\":[\"交接\"]}" "$BASE/api/prompts" | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")
P2=$(curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' -d '{"title":"另一个带标签 B","tags":["运维"]}' "$BASE/api/prompts" | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")
echo "tag_a=$TAG_A tag_b=$TAG_B prompt1=$P1 prompt2=$P2"

echo "\$ curl -s -b \$JAR '$BASE/api/prompts?folder_id=$PARENT'   # 合并前：应命中 1 条"
curl -s -b "$JAR" "$BASE/api/prompts?folder_id=$PARENT" | python3 -c "import json,sys;d=json.load(sys.stdin);print('total =',d['total'],'ids =',[i['id'] for i in d['items']])"
echo "\$ curl -s -b \$JAR -G --data-urlencode 'tag=交接' $BASE/api/prompts   # 合并前：应命中 1 条"
curl -s -b "$JAR" -G --data-urlencode 'tag=交接' "$BASE/api/prompts" | python3 -c "import json,sys;d=json.load(sys.stdin);print('total =',d['total'],'ids =',[i['id'] for i in d['items']])"

echo "\$ curl -s -b \$JAR -X PUT -d '{\"name\":\"交接\"}' $BASE/api/tags/$TAG_B   # 改名成已存在的标签 → 合并"
curl -s -b "$JAR" -X PUT -H 'Content-Type: application/json' -d '{"name":"交接"}' "$BASE/api/tags/$TAG_B"
echo
curl -s -b "$JAR" "$BASE/api/tags" >"$AC_DIR/tags.json"
echo "\$ curl -s -b \$JAR /api/tags"
cat "$AC_DIR/tags.json"
echo
python3 - "$AC_DIR" "$TAG_A" <<'PY'
import json, sys
d, tag_a = sys.argv[1], int(sys.argv[2])
items = json.load(open(f'{d}/tags.json'))['items']
names = [t['name'] for t in items]
merged = [t for t in items if t['name'] == '交接']
print('标签列表:', [(t['id'], t['name'], t['count']) for t in items])
print('无重名：', 'MATCH' if len(names) == len(set(names)) else 'DIFF')
print('"交接" 计数相加 = 2：', 'MATCH' if merged and merged[0]['count'] == 2 else 'DIFF')
print('存活的是目标标签 id：', 'MATCH' if merged and merged[0]['id'] == tag_a else 'DIFF')
print('源标签"运维"已消失：', 'MATCH' if '运维' not in names else 'DIFF')
PY

echo "\$ curl -s -b \$JAR '$BASE/api/prompts?folder_id=$PARENT'"
curl -s -b "$JAR" "$BASE/api/prompts?folder_id=$PARENT" | python3 -c "import json,sys;d=json.load(sys.stdin);print('total =',d['total'],'ids =',[i['id'] for i in d['items']])"
echo "\$ curl -s -b \$JAR -G --data-urlencode 'tag=交接' $BASE/api/prompts   # 合并后：两个 prompt 都带该标签 → 2"
curl -s -b "$JAR" -G --data-urlencode 'tag=交接' "$BASE/api/prompts" | python3 -c "import json,sys;d=json.load(sys.stdin);print('total =',d['total'],'ids =',[i['id'] for i in d['items']])"

echo '--- 删除非空文件夹 → 409'
echo "\$ curl -s -b \$JAR -X DELETE $BASE/api/folders/$PARENT   # 有子文件夹 + 有 prompt"
curl -s -w '  HTTP %{http_code}\n' -b "$JAR" -X DELETE "$BASE/api/folders/$PARENT"
echo "\$ curl -s -b \$JAR -X DELETE $BASE/api/folders/$CHILD   # 空文件夹 → 204"
curl -s -o /dev/null -w 'HTTP %{http_code}\n' -b "$JAR" -X DELETE "$BASE/api/folders/$CHILD"
echo "\$ curl -s -b \$JAR -X DELETE $BASE/api/folders/$PARENT   # 子项已删但仍有 prompt → 409"
curl -s -w '  HTTP %{http_code}\n' -b "$JAR" -X DELETE "$BASE/api/folders/$PARENT"
echo "\$ curl -s -b \$JAR -X PUT -d '{\"folder_id\":null}' $BASE/api/prompts/$P1   # 移出文件夹"
curl -s -o /dev/null -w 'HTTP %{http_code}\n' -b "$JAR" -X PUT -H 'Content-Type: application/json' -d '{"folder_id":null}' "$BASE/api/prompts/$P1"
echo "\$ curl -s -b \$JAR -X DELETE $BASE/api/folders/$PARENT   # 现在空了 → 204"
curl -s -o /dev/null -w 'HTTP %{http_code}\n' -b "$JAR" -X DELETE "$BASE/api/folders/$PARENT"
end_fixture

line "收尾：停服并核验端口已释放"
echo "\$ ss -ltn | grep -c ':$PORT'   # 期望 0"
ss -ltn | grep -c ":$PORT"

echo
echo "阶段 3 自检结束；夹具目录已清理，端口 $PORT 已释放。"
