#!/usr/bin/env bash
# 阶段 40 验收自检（FR-101 FIX：CLI 建的 token 没有密文）：
#   AC-103 ① CLI create 后**直接查库**：该行 token_enc 非 NULL、不是明文（不以 pm_ 开头）、长度符合 base64 密文
#        ② 两路一致：同一实例上 CLI 建的与接口建的**都是 revealable: true**；
#           POST /api/tokens/:id/reveal（会话 cookie）返回的明文 == CLI 创建时 stdout 的明文（逐字）
#        ③ CLI reveal 的 stdout == 创建时明文（逐字；改前是 error: token_not_revealable）
#        ④ 既有契约不破：create 的 stdout 最后一行仍是明文、提示仍在 stderr、list/revoke 行为不变
#        ⑤ 密钥不可用三态：创建仍成功（rc=0）、该行 token_enc IS NULL、stderr 有可读提示；恢复后新建又有密文
#        ⑥ 存量不回填：既有无密文行 reveal 仍 token_not_revealable；**已撤销行仍可查看/复制**（FR-100 不回归）
#        ⑦ 文档：docs/api.md §4 有"CLI 建的 token 可随时查看/复制"；CHANGELOG [未发布] 有这条修复（含"撤销重建"）
#        ⑧ 回归：npm test / ci-check（在脚本外另跑）
#
# 全程用**临时 DATA_DIR**；不碰 8767 测试环境、不碰 106 生产。
# 用法：bash tools/ac-stage40.sh [all|cli|regress]
set -u
set -o pipefail

cd "$(dirname "$0")/.." || exit 1
ONLY=${1:-all}
PORT=${PORT:-auto}
AC_PW='ac-fixture-pw-20260918'
AC_USER='admin'
FAIL=0

pick_port() {
  for candidate in 8765 8766 8767 8768 8769 8770; do
    if ! ss -ltn | grep -q ":$candidate "; then echo "$candidate"; return 0; fi
  done
  return 1
}
if [ "${PORT}" = "auto" ]; then
  PORT=$(pick_port) || { echo "FAIL 台账范围 8765–8770 全被占用（写 QUESTIONS 停手）"; exit 1; }
  echo "  PORT 自动选择：$PORT"
fi
BASE="http://127.0.0.1:$PORT"

line() { printf '\n=== %s ===\n' "$1"; }
pass() { printf '  ✅ %s\n' "$1"; }
fail() { printf '  ❌ %s\n' "$1"; FAIL=1; }
eq() { if [ "$2" = "$3" ]; then pass "$1 = $3"; else fail "$1 = $3（期望 $2）"; fi; }
mask() { python3 -c "
import sys
v = sys.argv[1]
print(v[:6] + '…' + v[-4:] if len(v) > 10 else '***')
" "$1"; }

DIR=''
SRV_PID=''
cleanup() {
  if [ -n "$SRV_PID" ]; then
    kill "$SRV_PID" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$SRV_PID" 2>/dev/null || break; sleep 0.3; done
    kill -9 "$SRV_PID" 2>/dev/null || true
  fi
  [ -n "$DIR" ] && [ "${KEEP_AC_DIR:-0}" != "1" ] && rm -rf "$DIR"
}
trap cleanup EXIT
DIR=$(mktemp -d /tmp/pm-ac40-XXXXXX)
DB="$DIR/pm.db"
q() { sqlite3 "$DB" "$1"; }

line "构建 + 本阶段单测"
npm run build >"$DIR/build.log" 2>&1
eq "npm run build 退出码" 0 "$?"
node --test tests/stage40-cli-token-enc.test.ts >"$DIR/unit.log" 2>&1
eq "新单测退出码" 0 "$?"
grep -E "^ℹ (tests|pass|fail)" "$DIR/unit.log" | sed 's/^/  /'

line "AC-103 ①③④：真跑 CLI（临时 DATA_DIR=$DIR）"
printf '%s\n' "$AC_PW" | DATA_DIR="$DIR" node bin/pm.mjs user set-password --username "$AC_USER" >/dev/null
CLI_OUT=$(DATA_DIR="$DIR" node bin/pm.mjs token create --name ac103-cli 2>"$DIR/create.err")
CREATE_RC=$?
CLI_TOK=$(printf '%s' "$CLI_OUT" | tail -1)
echo "  \$ node bin/pm.mjs token create --name ac103-cli"
echo "  stdout 最后一行（脱敏）：$(mask "$CLI_TOK")  长度=$(printf '%s' "$CLI_TOK" | wc -c)"
echo "  stderr："; sed 's/^/    /' "$DIR/create.err"
eq "① create 退出码" 0 "$CREATE_RC"
eq "④ stdout 只有一行（明文）" 1 "$(printf '%s\n' "$CLI_OUT" | grep -c .)"
eq "④ 明文形态 ^pm_…" "true" "$(printf '%s' "$CLI_TOK" | grep -Eq '^pm_[A-Za-z0-9_-]{40,}$' && echo true || echo false)"
eq "④ 人类可读提示仍在 stderr（ok: token created）" 1 "$(grep -c 'ok: token created' "$DIR/create.err")"
eq "④ stderr 不含明文" 0 "$(grep -c "$CLI_TOK" "$DIR/create.err" || true)"

echo "  \$ sqlite3 pm.db \"SELECT id,name,token_enc IS NOT NULL,length(token_enc),substr(token_enc,1,3)='pm_' FROM api_tokens;\""
q "SELECT id, name, token_enc IS NOT NULL, length(token_enc), substr(token_enc,1,3)='pm_' FROM api_tokens;" | sed 's/^/    /'
eq "① CLI 建的 token_enc IS NOT NULL" 1 "$(q "SELECT token_enc IS NOT NULL FROM api_tokens WHERE name='ac103-cli';")"
eq "① 密文不以 pm_ 前缀开头" 0 "$(q "SELECT substr(token_enc,1,3)='pm_' FROM api_tokens WHERE name='ac103-cli';")"
eq "① 密文长度符合 base64(12+16+46) ≈ 100" "true" "$(python3 -c "
import sqlite3,sys
n = sqlite3.connect('$DB').execute(\"SELECT length(token_enc) FROM api_tokens WHERE name='ac103-cli'\").fetchone()[0]
print('true' if 96 <= n <= 104 else 'false')
")"
eq "① 密文 ≠ 明文" "true" "$(python3 -c "
import sqlite3,sys
enc = sqlite3.connect('$DB').execute(\"SELECT token_enc FROM api_tokens WHERE name='ac103-cli'\").fetchone()[0]
print('true' if enc != sys.argv[1] else 'false')
" "$CLI_TOK")"

CLI_ID=$(q "SELECT id FROM api_tokens WHERE name='ac103-cli';")
REVEAL_OUT=$(DATA_DIR="$DIR" node bin/pm.mjs token reveal "$CLI_ID" 2>"$DIR/reveal.err")
eq "③ CLI reveal 退出码（改前是 token_not_revealable）" 0 "$?"
eq "③ CLI reveal 的 stdout == 创建时明文（逐字）" "true" "$([ "$(printf '%s' "$REVEAL_OUT" | tail -1)" = "$CLI_TOK" ] && echo true || echo false)"
eq "③ reveal 的 stderr 不含明文" 0 "$(grep -c "$CLI_TOK" "$DIR/reveal.err" || true)"
echo "  \$ node bin/pm.mjs token list / revoke"
DATA_DIR="$DIR" node bin/pm.mjs token list 2>/dev/null | sed 's/^/    /'
DATA_DIR="$DIR" node bin/pm.mjs token revoke "$CLI_ID" >/dev/null 2>&1
eq "④ revoke 退出码" 0 "$?"
eq "④ revoke 后 list 显示 status=revoked" 1 "$(DATA_DIR="$DIR" node bin/pm.mjs token list 2>/dev/null | grep -c 'status=revoked')"
eq "④ list 不含明文" 0 "$(DATA_DIR="$DIR" node bin/pm.mjs token list 2>/dev/null | grep -c "$CLI_TOK" || true)"

if [ "$ONLY" = "all" ] || [ "$ONLY" = "cli" ]; then
  line "AC-103 ⑤：密钥不可用三态（创建仍成功 / 无密文 / 有可读提示 → 恢复后有密文）"
  echo "  \$ TOKEN_ENC_KEY=abcd node bin/pm.mjs token create --name ac103-nokey"
  NOKEY_OUT=$(DATA_DIR="$DIR" TOKEN_ENC_KEY=abcd node bin/pm.mjs token create --name ac103-nokey 2>"$DIR/nokey.err")
  NOKEY_RC=$?
  echo "  stderr："; sed 's/^/    /' "$DIR/nokey.err"
  eq "⑤ 密钥不可用时 create 仍 rc=0（创建绝不因密钥失败）" 0 "$NOKEY_RC"
  eq "⑤ 明文仍正常返回（鉴权不受影响）" "true" "$(printf '%s' "$NOKEY_OUT" | tail -1 | grep -Eq '^pm_' && echo true || echo false)"
  eq "⑤ stderr 有可读提示（warn: 加密密钥不可用）" 1 "$(grep -c 'warn: 加密密钥不可用' "$DIR/nokey.err")"
  eq "⑤ 提示里不含明文" 0 "$(grep -c "$(printf '%s' "$NOKEY_OUT" | tail -1)" "$DIR/nokey.err" || true)"
  eq "⑤ 该行 token_enc IS NULL" 1 "$(q "SELECT token_enc IS NULL FROM api_tokens WHERE name='ac103-nokey';")"
  eq "⑤ 该行 token_hash 仍写入（鉴权可用）" 64 "$(q "SELECT length(token_hash) FROM api_tokens WHERE name='ac103-nokey';")"

  # 第二条不可用路径：密钥文件读不到（同名目录占位）
  mv "$DIR/token-enc.key" "$DIR/token-enc.key.bak"
  mkdir "$DIR/token-enc.key"
  DATA_DIR="$DIR" node bin/pm.mjs token create --name ac103-unreadable >/dev/null 2>"$DIR/unread.err"
  eq "⑤ 密钥文件读不到时 create 仍 rc=0" 0 "$?"
  eq "⑤ 同样有可读提示" 1 "$(grep -c 'warn: 加密密钥不可用' "$DIR/unread.err")"
  eq "⑤ 该行也无密文" 1 "$(q "SELECT token_enc IS NULL FROM api_tokens WHERE name='ac103-unreadable';")"
  rmdir "$DIR/token-enc.key"; mv "$DIR/token-enc.key.bak" "$DIR/token-enc.key"

  DATA_DIR="$DIR" node bin/pm.mjs token create --name ac103-restored >/dev/null 2>&1
  eq "⑤ 恢复密钥后新建的 token 又有密文" 1 "$(q "SELECT token_enc IS NOT NULL FROM api_tokens WHERE name='ac103-restored';")"

  line "AC-103 ⑥：存量不回填（既有无密文行仍 token_not_revealable）"
  q "UPDATE api_tokens SET token_enc = NULL WHERE name='ac103-restored';"
  DATA_DIR="$DIR" node bin/pm.mjs token reveal "$(q "SELECT id FROM api_tokens WHERE name='ac103-restored';")" >/dev/null 2>"$DIR/legacy.err"
  eq "⑥ 存量行 reveal 退出码 = 1" 1 "$?"
  eq "⑥ 错误码仍是 token_not_revealable" 1 "$(grep -c 'token_not_revealable' "$DIR/legacy.err")"

  line "AC-103 ②：两路一致（CLI 建的 vs 接口建的）"
  # 起临时实例（同一 DATA_DIR），用会话 cookie 建一个 token，与 CLI 建的对比
  DATA_DIR="$DIR" PORT="$PORT" node dist/server/index.js >"$DIR/server.log" 2>&1 &
  SRV_PID=$!
  CODE=''
  for _ in $(seq 1 60); do
    CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/healthz" 2>/dev/null || true)
    [ "$CODE" = "200" ] && break
    sleep 0.3
  done
  if [ "$CODE" != "200" ]; then
    fail "服务未起来（$DIR/server.log）"
  else
    JAR="$DIR/jar.txt"
    curl -s -c "$JAR" -o /dev/null -X POST -H 'Content-Type: application/json' \
      -d "{\"username\":\"$AC_USER\",\"password\":\"$AC_PW\"}" "$BASE/api/login"
    # CLI 再建一条（这条不做删除/清密文，保持完好）
    CLI2_OUT=$(DATA_DIR="$DIR" node bin/pm.mjs token create --name ac103-cli2 2>/dev/null)
    CLI2_TOK=$(printf '%s' "$CLI2_OUT" | tail -1)
    CLI2_ID=$(q "SELECT id FROM api_tokens WHERE name='ac103-cli2';")
    # 接口建一条
    API_JSON=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"name":"ac103-api"}' "$BASE/api/tokens")
    API_ID=$(echo "$API_JSON" | jq -r .id)

    echo "  \$ curl -s -b <jar> $BASE/api/tokens（节选两行）"
    curl -s -b "$JAR" "$BASE/api/tokens" | python3 -c "
import json,sys
items = json.load(sys.stdin)['items']
for t in items:
    if t['name'] in ('ac103-cli2','ac103-api'):
        print('   ', {k: t[k] for k in ('id','name','revealable','revoked_at')})
"
    eq "② CLI 建的 revealable=true" true "$(curl -s -b "$JAR" "$BASE/api/tokens" | jq -r ".items[] | select(.id==$CLI2_ID) | .revealable")"
    eq "② 接口建的 revealable=true" true "$(curl -s -b "$JAR" "$BASE/api/tokens" | jq -r ".items[] | select(.id==$API_ID) | .revealable")"
    HTTP_REVEAL=$(curl -s -b "$JAR" -X POST "$BASE/api/tokens/$CLI2_ID/reveal" | jq -r .token)
    eq "② 接口 reveal CLI 建的 token == CLI 创建时的明文（逐字）" "true" "$([ "$HTTP_REVEAL" = "$CLI2_TOK" ] && echo true || echo false)"
    eq "② 日志里无明文" 0 "$(grep -c "$CLI2_TOK" "$DIR/server.log" || true)"
    # 两条明文都是 46 字符且互不相同（不同 token）
    eq "② 两条明文互不相同（确实是两条 token）" "true" "$([ "$CLI2_TOK" != "$(echo "$API_JSON" | jq -r .token)" ] && echo true || echo false)"

    line "AC-103 ⑥（FR-100 不回归）：已撤销行仍可查看/复制"
    curl -s -b "$JAR" -o /dev/null -X DELETE "$BASE/api/tokens/$CLI2_ID"
    eq "⑥ 已撤销（CLI 建的）行 revealable 仍为 true" true "$(curl -s -b "$JAR" "$BASE/api/tokens" | jq -r ".items[] | select(.id==$CLI2_ID) | .revealable")"
    eq "⑥ 已撤销行的接口 reveal 仍与明文逐字一致" "true" "$([ "$(curl -s -b "$JAR" -X POST "$BASE/api/tokens/$CLI2_ID/reveal" | jq -r .token)" = "$CLI2_TOK" ] && echo true || echo false)"
    DATA_DIR="$DIR" node bin/pm.mjs token reveal "$CLI2_ID" >/dev/null 2>&1
    eq "⑥ 已撤销行的 CLI reveal 也仍可用（rc=0）" 0 "$?"
  fi

  line "AC-103 ⑦：文档"
  eq "⑦ docs/api.md §4 有「CLI 建的 token 与界面建的一样，可以随时查看/复制」" "true" "$(python3 -c "
src = open('docs/api.md', encoding='utf-8').read()
print('true' if 'CLI 建的 token 与界面建的一样，可以随时查看/复制' in src else 'false')
")"
  eq "⑦ CHANGELOG [未发布] 有这条修复且含「撤销后重建」" "true" "$(python3 -c "
src = open('CHANGELOG.md', encoding='utf-8').read()
head = src.split('## [1.1.0]')[0]
ok = ('[未发布]' in head) and ('CLI 创建的 token 现在也有加密密文' in head) and ('撤销后重建' in head)
print('true' if ok else 'false')
")"
fi

if [ "$ONLY" = "all" ] || [ "$ONLY" = "regress" ]; then
  line "回归：加密方案 / 密钥来源 / 存量语义未变"
  eq "迁移版本未变（仍 v4）" 4 "$(q 'SELECT MAX(version) FROM schema_migrations;')"
  eq "TOKEN_ENC_KEY 未入仓库（grep 源码只有解析处）" "true" "$(python3 -c "
import subprocess
out = subprocess.run(['grep','-rl','TOKEN_ENC_KEY','src/'], capture_output=True, text=True).stdout.split()
print('true' if out == ['src/services/token-crypto.ts'] else 'false')
")"
  eq "全仓 createToken 调用点仍是两处（CLI + HTTP 路由）" 2 "$(grep -rc 'createToken(' src/server/cli.ts src/server/routes/tokens.ts | awk -F: '{s+=$2} END {print s}')"
fi

line "结论"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ AC-103 全部通过"
else
  echo "  ❌ 有未通过项（见上方 ❌）"
fi
exit "$FAIL"
