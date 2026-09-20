#!/usr/bin/env bash
# 阶段 25 验收自检（FR-76 / D-31）：
#   AC-76 ① 桌面顶栏品牌文字精确 = PromptM（≠ PromptManager）
#         ② 反例断言：四处源码行仍是全名（<title>/登录页/关于页/pure.ts 错误文案）+ 运行时 document.title
#         ③ 契约值 app: 'promptmanager' 一字不动（贴 grep 行）
#         ④ 图标 mark 存在、26×26、src 未变
#         ⑤ 移动视口（390×844）不渲染品牌文字（只有图标）
#         ⑥ 回归：AC-51（点 logo 回主页）/ AC-47（顶栏按钮 left 升序）
#         ⑦ 顶栏无横向溢出
set -u

cd "$(dirname "$0")/.." || exit 1
PORT=${PORT:-auto}
AC_PW='ac-fixture-pw-20260918'
AC_USER='admin'
SHOTS='docs/shots/stage25'
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

AC_DIR=''
SRV_PID=''
cleanup() {
  if [ -n "$SRV_PID" ]; then
    kill "$SRV_PID" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$SRV_PID" 2>/dev/null || break; sleep 0.3; done
    kill -9 "$SRV_PID" 2>/dev/null || true
  fi
  [ -n "$AC_DIR" ] && rm -rf "$AC_DIR"
}
trap cleanup EXIT
AC_DIR=$(mktemp -d /tmp/pm-ac25-XXXXXX)

line "AC-76 ①②③④：源码侧（顶栏简称 / 四处保持全名 / 契约值 / 图标）"
echo "  顶栏（AppHeader.tsx）品牌区："
grep -n "data-testid=\"pm-brand-text\"" -A 6 web/src/components/AppHeader.tsx | sed 's/^/    /'
eq "AppHeader 里 PromptManager 出现次数（应为 0）" 0 "$(grep -c 'PromptManager' web/src/components/AppHeader.tsx)"
echo "  反例断言 —— 四处源码行（原样展示）："
for pair in "web/index.html:PromptManager" "web/src/components/LoginPage.tsx:PromptManager" "web/src/components/AboutModal.tsx:PromptManager" "web/src/pure.ts:PromptManager"; do
  file=${pair%%:*}
  echo "    $file: $(grep -n 'PromptManager' "$file" | head -1 | sed 's/^[[:space:]]*//')"
  eq "$file 仍是全名" 1 "$(grep -c 'PromptManager' "$file")"
done
echo "  ③ 契约值 grep："
grep -n "app: 'promptmanager'" web/src/pure.ts | sed 's/^/    /'
eq "契约值命中行数" 1 "$(grep -c "app: 'promptmanager'" web/src/pure.ts)"
eq "契约值未被改成显示名" 0 "$(grep -c "app: 'PromptM'" web/src/pure.ts)"
eq "图标 mark 锚点仍在" 1 "$(grep -c 'data-testid="pm-brand-mark"' web/src/components/AppHeader.tsx)"
eq "图标 src 未变" 1 "$(grep -c 'src="/promptmanager-icon.svg"' web/src/components/AppHeader.tsx)"
eq "图标仍 26×26" 1 "$(grep -c 'width={26}' web/src/components/AppHeader.tsx)"
eq "品牌文字仍只在非移动端渲染" 1 "$(grep -c '{!isMobile && (' web/src/components/AppHeader.tsx)"

line "构建 / 类型检查 / 体积"
BUILD_LOG="$AC_DIR/build.log"
npm run build >"$BUILD_LOG" 2>&1
eq "npm run build 退出码" 0 "$?"
eq "构建输出里的 >500KB 告警数" 0 "$(grep -c 'larger than 500' "$BUILD_LOG")"
MAXCHUNK=$(node -e '
const fs=require("fs"), path=require("path");
const dir="dist/web/assets";
const rows=fs.readdirSync(dir).filter((f)=>/\.js$/.test(f)).map((f)=>({f, raw:fs.statSync(path.join(dir,f)).size})).sort((a,b)=>b.raw-a.raw);
console.log(rows[0].raw);
')
if [ "$MAXCHUNK" -le 500000 ]; then pass "最大 chunk ≤500KB（$MAXCHUNK B）"; else fail "最大 chunk = $MAXCHUNK B（>500KB）"; fi
npm run typecheck:web >/dev/null 2>&1
eq "npm run typecheck:web 退出码" 0 "$?"

line "本阶段新增单测"
TEST_LOG="$AC_DIR/tests.log"
node --test tests/stage25-brand.test.ts >"$TEST_LOG" 2>&1
eq "测试退出码" 0 "$?"
grep -E "^ℹ (tests|pass|fail)" "$TEST_LOG" | sed 's/^/  /'

line "运行时：临时实例（DATA_DIR=$AC_DIR，PORT=$PORT）"
if ss -ltn | grep -q ":$PORT "; then
  fail "端口 $PORT 被占用"
else
  printf '%s\n' "$AC_PW" | DATA_DIR="$AC_DIR" node bin/pm.mjs user set-password --username "$AC_USER" >/dev/null
  DATA_DIR="$AC_DIR" PORT="$PORT" node dist/server/index.js >"$AC_DIR/server.log" 2>&1 &
  SRV_PID=$!
  CODE=''
  for _ in $(seq 1 60); do
    CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/healthz" 2>/dev/null || true)
    [ "$CODE" = "200" ] && break
    sleep 0.3
  done
  if [ "$CODE" != "200" ]; then
    fail "服务未起来（$AC_DIR/server.log）"
  else
    JAR="$AC_DIR/jar.txt"
    curl -s -c "$JAR" -o /dev/null -X POST -H 'Content-Type: application/json' \
      -d "{\"username\":\"$AC_USER\",\"password\":\"$AC_PW\"}" "$BASE/api/login"
    SID=$(awk '$6 == "pm_sid" { print $7 }' "$JAR" | tail -1)
    [ -z "$SID" ] && fail "登录失败，拿不到 pm_sid"
    curl -s -b "$JAR" -H 'Content-Type: application/json' \
      -d '{"title":"AC25 夹具","user_prompt":"正文","system_prompt":"S","notes":"备注"}' "$BASE/api/prompts" >/dev/null

    rm -rf "$SHOTS"
    node tools/ac-stage25-probe.mjs "$BASE" "$SID" "$SHOTS" | tee "$AC_DIR/probe.log"
    v() { grep -m1 "^$1=" "$AC_DIR/probe.log" | cut -d= -f2-; }

    line "AC-76 ①④：桌面顶栏（真鼠标 + 真实像素）"
    eq "品牌文字精确 = PromptM" "PromptM" "$(v ac76_brand_text)"
    eq "顶栏内不出现 PromptManager" "false" "$(v ac76_brand_absent_fullname)"
    pass "运行时 document.title：$(v ac76_document_title)"
    eq "② document.title 仍是 PromptManager" "PromptManager" "$(v ac76_document_title)"
    pass "图标 mark：$(v ac76_mark)"
    eq "图标 26×26" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['w'] == 26 and s['h'] == 26 and s['naturalW'] > 0 else 'false')
" "$(v ac76_mark)")"

    line "AC-76 ⑥⑦：回归（点 logo 回主页 / 按钮顺序 / 无横向溢出）"
    pass "顶栏按钮 left 坐标：$(v ac76_button_lefts)"
    eq "AC-47：按钮 left 严格升序" "true" "$(python3 -c "
import json,sys
xs=[x['left'] for x in json.loads(sys.argv[1])]
print('true' if all(xs[i] < xs[i+1] for i in range(len(xs)-1)) else 'false')
" "$(v ac76_button_lefts)")"
    pass "点 logo 后：$(v ac76_after_logo_click)"
    eq "AC-51：点 logo 回主页（视图回到分栏 + 搜索清空）" '{"view":"split","search":""}' "$(v ac76_after_logo_click)"
    eq "⑦ 桌面无横向溢出" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['scrollWidth'] <= s['clientWidth'] + 2 else 'false')
" "$(v ac76_scroll)")"

    line "AC-76 ⑤：移动视口 390×844（只有图标、无品牌文字）"
    pass "移动端：$(v ac76_mobile_brand_text)"
    eq "移动端不渲染品牌文字" "false" "$(echo "$(v ac76_mobile_brand_text)" | jq -r .brandTextExists)"
    eq "移动端仍有图标" "true" "$(echo "$(v ac76_mobile_brand_text)" | jq -r .markExists)"
    eq "⑤ 移动端无横向溢出" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['scrollWidth'] <= s['clientWidth'] + 2 else 'false')
" "$(v ac76_mobile_scroll)")"
    eq "页面运行时异常" "[]" "$(v ac25_runtime_errors)"

    line "截图（$SHOTS）"
    ls -l "$SHOTS" | sed 's/^/  /'
  fi
fi

line "结论"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ AC-76 全部通过"
else
  echo "  ❌ 有未通过项（见上方 ❌）"
fi
exit "$FAIL"
