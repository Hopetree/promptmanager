#!/usr/bin/env bash
# 阶段 52 基线快照（**改前对照用**，非验收脚本）：
# 起一个临时实例 + 夹具（有目录的 prompt / 无目录的 prompt，目录带父级以验证"只显示名字"），
# 跑 ac-stage52-probe.mjs 把卡片底部那一行的文本与间距打出来。
# 用法：bash tools/ac-stage52-baseline.sh [输出文件]
set -u
set -o pipefail
cd "$(dirname "$0")/.." || exit 1
OUT=${1:-tmp/stage52-baseline.txt}
mkdir -p "$(dirname "$OUT")"

pick_port() {
  for c in 8765 8766 8767 8768 8769 8770; do
    if ! ss -ltn | grep -q ":$c "; then echo "$c"; return 0; fi
  done
  return 1
}
PORT=$(pick_port) || { echo "FAIL 端口全占"; exit 1; }
BASE="http://127.0.0.1:$PORT"
PW='ac-fixture-pw-20260924'
DIR=$(mktemp -d /tmp/pm-ac52-base-XXXXXX)
SRV=''
cleanup() { [ -n "$SRV" ] && kill -9 "$SRV" 2>/dev/null; rm -rf "$DIR"; }
trap cleanup EXIT

printf '%s\n' "$PW" | DATA_DIR="$DIR" node bin/pm.mjs user set-password --username admin >/dev/null
DATA_DIR="$DIR" PORT="$PORT" node dist/server/index.js >"$DIR/srv.log" 2>&1 &
SRV=$!
for _ in $(seq 1 60); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/healthz" 2>/dev/null)" = "200" ] && break
  sleep 0.3
done

JAR="$DIR/jar.txt"
curl -s -c "$JAR" -o /dev/null -X POST -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$PW\"}" "$BASE/api/login"
SID=$(awk '$6 == "pm_sid" { print $7 }' "$JAR" | tail -1)
AUTH=(-b "$JAR" -H 'Content-Type: application/json')

# 目录：父目录「工作」+ 子目录「AI 协作与验收」——子目录里的 prompt 必须只显示「AI 协作与验收」
PARENT=$(curl -s "${AUTH[@]}" -d '{"name":"工作"}' "$BASE/api/folders" | jq -r .id)
CHILD=$(curl -s "${AUTH[@]}" -d "{\"name\":\"AI 协作与验收\",\"parent_id\":$PARENT}" "$BASE/api/folders" | jq -r .id)
# 有目录的 prompt（放在子目录里 ⇒ 页面若显示「工作 / AI 协作与验收」就说明没做到"只要目录名"）
F1=$(curl -s "${AUTH[@]}" -d "{\"title\":\"AC117 有目录\",\"user_prompt\":\"内容一\",\"folder_id\":$CHILD}" "$BASE/api/prompts" | jq -r .id)
# 无目录的 prompt
F2=$(curl -s "${AUTH[@]}" -d '{"title":"AC117 无目录","user_prompt":"内容二"}' "$BASE/api/prompts" | jq -r .id)
# 有目录 + 含变量的 prompt（验证"变量数"仍在）
F3=$(curl -s "${AUTH[@]}" -d "{\"title\":\"AC117 有目录含变量\",\"user_prompt\":\"你好 {{姓名}} {{城市}}\",\"folder_id\":$CHILD}" "$BASE/api/prompts" | jq -r .id)

{
  echo "=== 夹具（库内真值） ==="
  echo "目录：parent=$PARENT(name=$(curl -s "${AUTH[@]}" "$BASE/api/folders" | jq -r --argjson i "$PARENT" '.items[]|select(.id==$i)|.name')) child=$CHILD(name=$(curl -s "${AUTH[@]}" "$BASE/api/folders" | jq -r --argjson i "$CHILD" '.items[]|select(.id==$i)|.name'))"
  echo "prompt id / title / folder_id（库内）："
  sqlite3 "$DIR/pm.db" "SELECT id||' | '||title||' | folder_id='||coalesce(folder_id,'NULL')||' | vars_in_prompt' FROM prompts ORDER BY id;" | sed 's/^/  /'
  echo "PROMPT_IDS: withFolder=$F1 noFolder=$F2 withVars=$F3 childFolder=$CHILD childName=AI 协作与验收 parentName=工作"
  echo
  echo "=== 探针输出 ==="
  node tools/ac-stage52-probe.mjs "$BASE" "$SID"
} 2>&1 | tee "$OUT"
echo
echo "已写入 $OUT"
