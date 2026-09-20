#!/usr/bin/env bash
# 阶段 4 验收自检：AC-8（变量提取与渲染）/ AC-9（版本列表 / diff / 回滚）/ AC-12（Markdown 渲染 + 净化 + 高亮）。
#
# 与 BRIEF §8 的"统一夹具约定"一致：**每条 AC 自带夹具、互不依赖**（各自的临时 DATA_DIR +
# 自建口令 + 自起自停服务）。跑完不留常驻服务、不留临时数据、不触碰生产文件。
#
# 用法：bash tools/ac-stage4.sh
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
  AC_DIR=$(mktemp -d /tmp/pm-ac4-XXXXXX)
  JAR=$AC_DIR/jar.txt
  SRV_LOG=$AC_DIR/server.log
  echo "\$ AC_DIR=\$(mktemp -d /tmp/pm-ac4-XXXXXX)   # $AC_DIR"
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

########################################################################
line "AC-8 变量提取与渲染（自带夹具）"
new_fixture
start_server
login_jar

# BRIEF AC-8 的原样夹具（JSON 里 \\{{保留}} 表示文本中的一个反斜杠）
cat >"$AC_DIR/ac8.json" <<'JSON'
{"title":"变量夹具","user_prompt":"你好 {{ 姓名 }}，重复 {{姓名}} 与 \\{{保留}} 以及 {{var-b}}"}
JSON
echo '$ curl -s -b $JAR -X POST -H "Content-Type: application/json" -d @ac8.json $BASE/api/prompts'
curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' -d @"$AC_DIR/ac8.json" "$BASE/api/prompts" >"$AC_DIR/p.json"
cat "$AC_DIR/p.json"
echo
PID=$(python3 -c "import json;print(json.load(open('$AC_DIR/p.json'))['id'])")

echo "\$ curl -s -b \$JAR $BASE/api/prompts/$PID/variables"
curl -s -b "$JAR" "$BASE/api/prompts/$PID/variables" >"$AC_DIR/vars.json"
cat "$AC_DIR/vars.json"
echo
python3 - "$AC_DIR" <<'PY'
import json, sys
d = sys.argv[1]
variables = json.load(open(f'{d}/vars.json'))['variables']
print('variables =', variables)
print('与期望 ["姓名","var-b"] 逐元素一致：', 'MATCH' if variables == ['姓名', 'var-b'] else 'DIFF')
PY

echo "\$ curl -s -b \$JAR -X POST -d '{\"values\":{\"姓名\":\"张三\"}}' $BASE/api/prompts/$PID/render"
curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"values":{"姓名":"张三"}}' "$BASE/api/prompts/$PID/render" >"$AC_DIR/render.json"
cat "$AC_DIR/render.json"
echo
python3 - "$AC_DIR" <<'PY'
import json, sys
d = sys.argv[1]
rendered = json.load(open(f'{d}/render.json'))
expected = '你好 张三，重复 张三 与 {{保留}} 以及 {{var-b}}'
print('user_prompt 渲染结果 :', json.dumps(rendered['user_prompt'], ensure_ascii=False))
print('user_prompt 逐字符与预期串相等：', 'MATCH' if rendered['user_prompt'] == expected else 'DIFF')
print('missing             :', rendered['missing'], '→', 'MATCH' if rendered['missing'] == ['var-b'] else 'DIFF')
print('渲染不写库（另取一次 GET 校验）：')
PY
curl -s -b "$JAR" "$BASE/api/prompts/$PID" | python3 -c "
import json,sys
p = json.load(sys.stdin)
expected = open('$AC_DIR/ac8.json').read()
submitted = json.loads(expected)['user_prompt']
print('  GET.user_prompt 仍等于原始模板：', 'MATCH' if p['user_prompt'] == submitted else 'DIFF')
print('  version_no 未变：', 'MATCH' if p['version_no'] == 1 else 'DIFF')
"
end_fixture

########################################################################
line "AC-9 版本列表 / diff / 回滚（自带夹具）"
new_fixture
start_server
login_jar

cat >"$AC_DIR/v1.json" <<'JSON'
{"title":"版本演示","user_prompt":"第一版正文：会话交接 {{变量A}}","notes":"v1 备注"}
JSON
PID=$(curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' -d @"$AC_DIR/v1.json" "$BASE/api/prompts" | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")
V1_BODY=$(python3 -c "import json;print(json.load(open('$AC_DIR/v1.json'))['user_prompt'])")
echo "prompt id=$PID"
echo '$ PUT v2（改 user_prompt）'
curl -s -b "$JAR" -X PUT -H 'Content-Type: application/json' -d '{"user_prompt":"第二版正文：改过了"}' "$BASE/api/prompts/$PID" | python3 -c "import json,sys;p=json.load(sys.stdin);print('  version_no =',p['version_no'],'｜user_prompt =',p['user_prompt'])"
echo '$ PUT v3（再改 user_prompt + notes）'
curl -s -b "$JAR" -X PUT -H 'Content-Type: application/json' -d '{"user_prompt":"第三版正文：又改一次","notes":"v3 备注"}' "$BASE/api/prompts/$PID" | python3 -c "import json,sys;p=json.load(sys.stdin);print('  version_no =',p['version_no'],'｜notes =',p['notes'])"

echo "\$ curl -s -b \$JAR $BASE/api/prompts/$PID/versions"
curl -s -b "$JAR" "$BASE/api/prompts/$PID/versions" >"$AC_DIR/versions.json"
cat "$AC_DIR/versions.json"
echo
python3 - "$AC_DIR" <<'PY'
import json, sys
d = sys.argv[1]
items = json.load(open(f'{d}/versions.json'))['items']
nums = [i['version_no'] for i in items]
print('版本号序列 =', nums, '→', 'MATCH' if nums == [1, 2, 3] else 'DIFF')
print('含时间戳   =', all(i['created_at'].endswith('Z') for i in items))
print('含标题     =', all(i['title'] == '版本演示' for i in items))
PY

echo "\$ curl -s -b \$JAR '$BASE/api/prompts/$PID/diff?from=1&to=3'"
curl -s -b "$JAR" "$BASE/api/prompts/$PID/diff?from=1&to=3" >"$AC_DIR/diff.json"
python3 - "$AC_DIR" <<'PY'
import json, sys
d = sys.argv[1]
diff = json.load(open(f'{d}/diff.json'))['diff']
print('--- unified diff 原样（前 24 行）---')
print('\n'.join(diff.split('\n')[:24]))
print('--- 判定 ---')
lines = diff.split('\n')
minus = [l for l in lines if l.startswith('-') and not l.startswith('---')]
plus = [l for l in lines if l.startswith('+') and not l.startswith('+++')]
print('删除行数 =', len(minus), '｜新增行数 =', len(plus))
print('含 - 行与 + 行：', 'MATCH' if minus and plus else 'DIFF')
print('含 v1 正文：', 'MATCH' if '第一版正文：会话交接 {{变量A}}' in diff else 'DIFF')
print('含 v3 正文：', 'MATCH' if '第三版正文：又改一次' in diff else 'DIFF')
PY

echo "\$ curl -s -b \$JAR -X POST $BASE/api/prompts/$PID/versions/1/rollback"
curl -s -b "$JAR" -X POST "$BASE/api/prompts/$PID/versions/1/rollback" >"$AC_DIR/rolled.json"
cat "$AC_DIR/rolled.json"
echo
python3 - "$AC_DIR" "$V1_BODY" <<'PY'
import json, sys
d, v1 = sys.argv[1], sys.argv[2]
rolled = json.load(open(f'{d}/rolled.json'))
print('回滚后 version_no =', rolled['version_no'], '→', 'MATCH' if rolled['version_no'] == 4 else 'DIFF')
print('正文 = v1 正文（逐字符）：', 'MATCH' if rolled['user_prompt'] == v1 else 'DIFF')
print('备注 = v1 备注（逐字符）：', 'MATCH' if rolled['notes'] == 'v1 备注' else 'DIFF')
PY
echo "\$ curl -s -b \$JAR $BASE/api/prompts/$PID   # 回滚后再取一次"
curl -s -b "$JAR" "$BASE/api/prompts/$PID" | python3 -c "
import json,sys
p = json.load(sys.stdin)
print('  GET.user_prompt 逐字符 = v1：', 'MATCH' if p['user_prompt'] == '''$V1_BODY''' else 'DIFF')
print('  version_no =', p['version_no'])
"
echo "\$ curl -s -b \$JAR $BASE/api/prompts/$PID/versions   # 历史必须一个都不少"
curl -s -b "$JAR" "$BASE/api/prompts/$PID/versions" | python3 -c "
import json,sys
nums = [i['version_no'] for i in json.load(sys.stdin)['items']]
print('  版本号序列 =', nums, '→', 'MATCH' if nums == [1,2,3,4] else 'DIFF')
"
echo '--- 失败语义：缺参/非法/越界 → 400；prompt 不存在 → 404'
for q in '' '?from=1' '?to=2' '?from=abc&to=2' '?from=1&to=99'; do
  printf '  diff%-18s → HTTP %s\n' "$q" "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" "$BASE/api/prompts/$PID/diff$q")"
done
printf '  diff（prompt 999999）  → HTTP %s\n' "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" "$BASE/api/prompts/999999/diff?from=1&to=2")"
printf '  rollback（版本 99）    → HTTP %s\n' "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -X POST "$BASE/api/prompts/$PID/versions/99/rollback")"
end_fixture

########################################################################
line "AC-12 Markdown 渲染 + XSS 净化 + 高亮（自带夹具）"
new_fixture
start_server
login_jar

cat >"$AC_DIR/ac12.json" <<'JSON'
{"markdown":"# 预览标题\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1))\n\n```js\nconst a = 1;\n```\n"}
JSON
echo '$ curl -s -b $JAR -X POST -H "Content-Type: application/json" -d @ac12.json $BASE/api/render/markdown'
curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' -d @"$AC_DIR/ac12.json" "$BASE/api/render/markdown" >"$AC_DIR/md.json"
cat "$AC_DIR/md.json"
echo
python3 - "$AC_DIR" <<'PY'
import json, sys
d = sys.argv[1]
html = json.load(open(f'{d}/md.json'))['html']
print('--- 判定 ---')
print('不含 <script      :', 'MATCH' if '<script' not in html else 'DIFF')
print('不含 javascript:  :', 'MATCH' if 'javascript:' not in html else 'DIFF')
print('含 <pre 或 <code  :', 'MATCH' if ('<pre' in html or '<code' in html) else 'DIFF')
print('带高亮 class(hljs):', 'MATCH' if 'hljs' in html else 'DIFF')
print('保留正常 Markdown :', 'MATCH' if '<h1' in html else 'DIFF')
PY

echo '--- 额外净化样例（事件属性 / iframe / 危险协议）'
cat >"$AC_DIR/ac12b.json" <<'JSON'
{"markdown":"<img src=x onerror=alert(1)>\n\n<iframe src=\"http://evil\"></iframe>\n\n<a href=\"javascript:alert(1)\">j</a>\n\n<a href=\"https://example.com\">ok</a>\n"}
JSON
curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' -d @"$AC_DIR/ac12b.json" "$BASE/api/render/markdown" >"$AC_DIR/md2.json"
cat "$AC_DIR/md2.json"
echo
python3 - "$AC_DIR" <<'PY'
import json, sys, re
d = sys.argv[1]
html = json.load(open(f'{d}/md2.json'))['html']
print('无 onerror   :', 'MATCH' if not re.search('onerror', html, re.I) else 'DIFF')
print('无 <iframe   :', 'MATCH' if '<iframe' not in html else 'DIFF')
print('无 javascript:', 'MATCH' if 'javascript:' not in html else 'DIFF')
print('正常链接保留 :', 'MATCH' if 'https://example.com' in html else 'DIFF')
PY
end_fixture

line "收尾：停服并核验端口已释放"
echo "\$ ss -ltn | grep -c ':$PORT'   # 期望 0"
ss -ltn | grep -c ":$PORT"

echo
echo "阶段 4 自检结束；夹具目录已清理，端口 $PORT 已释放。"
