#!/usr/bin/env bash
# 阶段 32 验收自检（FR-87 / FR-88 / AC-89 / AC-90）：
#   AC-89 CI 在干净环境通过：① `rm -rf dist` → `bash tools/ci-check.sh` → rc=0 且 6 项全绿
#                            ② ci-check.sh 里「构建」的行号 < 「typecheck:tests」的行号
#                            ③ `rm -rf dist && npm run typecheck:tests` 的错误数（改前 38 → 改后 0）
#                            ④ GitHub Actions 实跑（推送后由人工/接口核；见 PROGRESS）
#   AC-90 登录页简化：① 用户名框 value === '' ② 源码与运行时 DOM 都不含默认账号名
#                     ③ 只留登录信息（品牌图/PromptManager/表单），四条噪音逐条为 0
#                     ④ 真鼠标登录成功 / 错误口令有提示 / 亮暗截图 / 移动端不溢出
#
# 服务**自起自停**（临时 DATA_DIR + 台账范围内的备用端口）；不碰 8767 测试环境、不碰生产文件。
# 用法：bash tools/ac-stage32.sh [all|ci|login]
# 注：`set -o pipefail` —— 探针通过 `| tee` 输出，缺了它探针崩溃会被 tee 的 0 退出码掩盖。
set -u
set -o pipefail

cd "$(dirname "$0")/.." || exit 1
ONLY=${1:-all}
PORT=${PORT:-auto}
AC_PW='ac-fixture-pw-20260918'
AC_USER='admin'
SHOTS='tmp/shots/stage32'
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
le() { if python3 -c "import sys; sys.exit(0 if float(sys.argv[1]) <= float(sys.argv[2]) else 1)" "$2" "$3"; then pass "$1 = $2（≤ $3）"; else fail "$1 = $2（期望 ≤ $3）"; fi; }

AC_DIR=''
SRV_PID=''
cleanup() {
  if [ -n "$SRV_PID" ]; then
    kill "$SRV_PID" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$SRV_PID" 2>/dev/null || break; sleep 0.3; done
    kill -9 "$SRV_PID" 2>/dev/null || true
  fi
  [ -n "$AC_DIR" ] && [ "${KEEP_AC_DIR:-0}" != "1" ] && rm -rf "$AC_DIR"
}
trap cleanup EXIT
AC_DIR=$(mktemp -d /tmp/pm-ac32-XXXXXX)

line "本阶段新增单测（FR-87 ci-check 顺序 + FR-88 登录页源码级）"
TEST_LOG="$AC_DIR/tests.log"
node --test tests/stage32-ci-order.test.ts tests/stage32-login-page.test.ts >"$TEST_LOG" 2>&1
eq "新测试退出码" 0 "$?"
grep -E "^ℹ (tests|pass|fail)" "$TEST_LOG" | sed 's/^/  /'

if [ "$ONLY" = "all" ] || [ "$ONLY" = "ci" ]; then
  line "AC-89 ③：干净环境对照实验（先删 dist，再单独跑 typecheck:tests）"
  echo "  \$ node -p \"require('./package.json').scripts['typecheck:tests']\""
  node -p "require('./package.json').scripts['typecheck:tests']" | sed 's/^/  /'
  echo "  （FR-87 两层防护：② 本脚本把构建排在类型检查前；② typecheck:tests 自带 build:server 前缀，"
  echo "    于是"裸跑"也没有未声明的前置条件 —— AC-89 ③ 的字面命令才能是 0）"
  rm -rf dist
  npm run typecheck:tests >"$AC_DIR/typecheck-clean.log" 2>&1
  CLEAN_RC=$?
  CLEAN_ERRORS=$(grep -cE 'error TS' "$AC_DIR/typecheck-clean.log")
  echo "  \$ rm -rf dist && npm run typecheck:tests   # rc=$CLEAN_RC"
  echo "  错误数 = $CLEAN_ERRORS"
  echo "  对照（改前实测，见 PROGRESS）：38 个错误（35 个 TS2307 + 3 个级联 TS7006）"
  eq "③ 干净环境下 typecheck:tests 错误数（改前 38 → 改后）" 0 "$CLEAN_ERRORS"
  eq "③ 干净环境下 typecheck:tests 退出码" 0 "$CLEAN_RC"

  line "AC-89 ②：ci-check.sh 里「构建」必须排在「typecheck:tests」之前（贴行号）"
  echo "  \$ grep -n 'npm run build\\|npm run typecheck' tools/ci-check.sh"
  grep -n 'npm run build >\|npm run typecheck' tools/ci-check.sh | sed 's/^/  /'
  BUILD_LINE=$(grep -n 'npm run build >"\$LOG_DIR/build.log"' tools/ci-check.sh | cut -d: -f1)
  TCT_LINE=$(grep -n 'npm run typecheck:tests >"\$LOG_DIR/typecheck-tests.log"' tools/ci-check.sh | cut -d: -f1)
  TCW_LINE=$(grep -n 'npm run typecheck:web >"\$LOG_DIR/typecheck-web.log"' tools/ci-check.sh | cut -d: -f1)
  if [ -n "$BUILD_LINE" ] && [ -n "$TCT_LINE" ] && [ "$BUILD_LINE" -lt "$TCT_LINE" ]; then
    pass "② 构建（第 $BUILD_LINE 行）< typecheck:tests（第 $TCT_LINE 行）"
  else
    fail "② 构建（第 ${BUILD_LINE:-?} 行）必须早于 typecheck:tests（第 ${TCT_LINE:-?} 行）"
  fi
  if [ -n "$BUILD_LINE" ] && [ -n "$TCW_LINE" ] && [ "$BUILD_LINE" -lt "$TCW_LINE" ]; then
    pass "② 构建（第 $BUILD_LINE 行）< typecheck:web（第 $TCW_LINE 行）"
  else
    fail "② 构建必须早于 typecheck:web"
  fi
  echo "  \$ grep -n '为什么.*必须.*构建\\|TS2307' tools/ci-check.sh | head -4"
  grep -n '为什么.*必须.*构建\|TS2307' tools/ci-check.sh | head -4 | sed 's/^/  /'
  eq "② 注释写明了「为什么必须先构建」（含 TS2307 与 rm -rf dist 复现）" "true" "$(python3 -c "
import sys
src = open('tools/ci-check.sh', encoding='utf-8').read()
ok = ('TS2307' in src) and ('rm -rf dist' in src) and ('38' in src) and ('为什么' in src)
print('true' if ok else 'false')
")"

  line "AC-89 ①：模拟 CI 干净环境 —— rm -rf dist 后跑完整 ci-check"
  rm -rf dist
  echo "  \$ rm -rf dist && bash tools/ci-check.sh"
  bash tools/ci-check.sh >"$AC_DIR/ci-check.log" 2>&1
  CI_RC=$?
  cat "$AC_DIR/ci-check.log" | sed 's/^/  /'
  eq "① ci-check.sh 在干净环境下的退出码" 0 "$CI_RC"
  eq "① 汇总表里 ✅ 的项数（须 6）" 6 "$(grep -cE 'rc=[0-9]+ +✅' "$AC_DIR/ci-check.log")"
  eq "① 汇总表里 ❌ 的项数" 0 "$(grep -cE 'rc=[0-9]+ +❌' "$AC_DIR/ci-check.log")"
  eq "① 脚本自报全绿" 1 "$(grep -c '代码质量检查全部通过（6 项）' "$AC_DIR/ci-check.log")"
  # 步骤行与汇总行都会出现 ③b，所以按"≥1 行显示 0 个 TS 错误"判（不锁次数）
  eq "① 干净环境下 ③b typecheck:tests = 0 个 TS 错误" "true" "$(python3 -c "
import sys
print('true' if int(sys.argv[1]) >= 1 else 'false')
" "$(grep -c '③b typecheck:tests.*0 个 TS 错误' "$AC_DIR/ci-check.log")")"
fi

if [ "$ONLY" = "all" ] || [ "$ONLY" = "login" ]; then
  line "AC-90 ②③：源码级 —— 登录页不含默认账号名、四条噪音已删、保留项齐全"
  echo "  \$ grep -c 'admin' web/src/components/LoginPage.tsx"
  grep -c 'admin' web/src/components/LoginPage.tsx | sed 's/^/  /'
  eq "② 登录页源码里默认账号名出现次数" 0 "$(grep -c 'admin' web/src/components/LoginPage.tsx)"
  eq "② 登录页源码里预填属性出现次数" 0 "$(grep -c 'initialValues' web/src/components/LoginPage.tsx)"
  echo "  \$ grep -c '<噪音串>' web/src/components/LoginPage.tsx"
  for noise in 'SELF-HOSTED' '数据只在本机' '网页不提供注册' '未认证一律'; do
    printf '    %-16s → %s\n' "$noise" "$(grep -c "$noise" web/src/components/LoginPage.tsx)"
  done
  NOISE_SUM=0
  for noise in 'SELF-HOSTED' '数据只在本机' '网页不提供注册' '未认证一律'; do
    NOISE_SUM=$((NOISE_SUM + $(grep -c "$noise" web/src/components/LoginPage.tsx)))
  done
  eq "③ 四条噪音在源码里合计出现次数" 0 "$NOISE_SUM"
  eq "③ 品牌图锚点仍在" 1 "$(grep -c 'pm-brand-art-login' web/src/components/LoginPage.tsx)"
  eq "③ 标题 PromptManager 仍在" 1 "$(grep -c 'PromptManager' web/src/components/LoginPage.tsx)"
  eq "③ 中性 placeholder「用户名」已生效" 1 "$(grep -c 'placeholder="用户名"' web/src/components/LoginPage.tsx)"
fi

if [ "$ONLY" = "all" ] || [ "$ONLY" = "login" ]; then
  line "运行时：临时实例（DATA_DIR=$AC_DIR，PORT=$PORT）"
  if [ ! -f dist/server/index.js ]; then
    npm run build >"$AC_DIR/build.log" 2>&1
    eq "补构建（前一步删过 dist）退出码" 0 "$?"
  fi
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
      pass "服务已起：$BASE/healthz = 200（夹具口令 $AC_PW，账号 $AC_USER）"
      # 造一条 fixture：登录成功后主界面才有列表（空库时是空态、没有 pm-split-list，判据会假红）。
      # 用 curl 自己的会话建，**不影响探针浏览器**（探针是独立 cookie jar，仍是未登录态）。
      JAR="$AC_DIR/jar.txt"
      curl -s -c "$JAR" -o /dev/null -X POST -H 'Content-Type: application/json' \
        -d "{\"username\":\"$AC_USER\",\"password\":\"$AC_PW\"}" "$BASE/api/login"
      curl -s -b "$JAR" -H 'Content-Type: application/json' \
        -d '{"title":"AC32 登录回归夹具","user_prompt":"登录后应看到这条"}' "$BASE/api/prompts" >/dev/null
      pass "已建 1 条 fixture（保证登录后主界面有列表）"
      rm -rf "$SHOTS"
      line "AC-90 ①③④：运行时（真鼠标 + 真实 DOM）"
      AC32_USER="$AC_USER" AC32_PW="$AC_PW" node tools/ac-stage32-probe.mjs login "$BASE" "$SHOTS" | tee "$AC_DIR/login.log"
      p() { grep -m1 "^$1=" "$AC_DIR/login.log" | cut -d= -f2-; }

      # ① 无预填
      eq "① 用户名输入框 value === ''（未登录态打开登录页）" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s is not None and s['value'] == '' else 'false')
" "$(p ac90_username_value)")"
      pass "① 用户名框 DOM：$(p ac90_username_value)"
      eq "① placeholder 是中性文案「用户名」" "用户名" "$(python3 -c "
import json,sys; print(json.loads(sys.argv[1])['placeholder'])
" "$(p ac90_username_value)")"
      eq "① 口令框 value 也是空" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s is not None and s['value'] == '' else 'false')
" "$(p ac90_password_value)")"

      # ② 运行时 DOM 不含默认账号名
      eq "② 运行时 DOM（innerHTML + innerText）里默认账号名出现次数合计 = 0" "0" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print(s['needleInHtml'] + s['needleInText'])
" "$(p ac90_scan)")"
      pass "② 运行时扫描：$(p ac90_scan)"
      eq "② 暗色下同样为 0" "0" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print(s['needleInHtml'] + s['needleInText'])
" "$(p ac90_dark_scan)")"

      # ③ 只剩登录信息
      eq "③ 四条噪音在运行时页面里合计出现次数 = 0" "0" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print(sum(s['noiseHits'].values()))
" "$(p ac90_scan)")"
      pass "③ 四条噪音逐条：$(python3 -c "
import json,sys
print(json.loads(sys.argv[1])['noiseHits'])
" "$(p ac90_scan)")"
      pass "③ 页面可见文本：$(python3 -c "
import json,sys; print(json.loads(sys.argv[1])['textSample'])
" "$(p ac90_scan)")"
      eq "③ 保留项齐全（品牌图 96×96 / PromptManager / 用户名 / 口令 / 登录按钮）" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1])
ok = s['brandArt'] and s['brandArtSize'] is not None and s['brandArtSize']['w'] == 96 and s['brandArtSize']['h'] == 96
ok = ok and s['brandArtSize']['src'] == '/promptmanager-96.png'
ok = ok and s['title'] and s['usernameInput'] and s['passwordInput'] and s['submitButton']
print('true' if ok else 'false')
" "$(p ac90_keep)")"
      pass "③ 保留项 DOM：$(p ac90_keep)"

      # ④ 功能不回归
      eq "④ 真鼠标 + 真实输入：用户名回读一致" "$AC_USER" "$(p ac90_login_typed_user)"
      eq "④ 真鼠标 + 真实输入：口令回读一致" "$AC_PW" "$(p ac90_login_typed_pw)"
      eq "④ 登录成功：登录页消失且进主界面（顶栏品牌 / 列表）" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1])
print('true' if s['loginGone'] and s['headerBrand'] == 'PromptM' and s['cardOrTable'] else 'false')
" "$(p ac90_after_login)")"
      pass "④ 登录后 DOM：$(p ac90_after_login)"
      eq "④ 错误口令：仍在登录页且有**可见**的可读错误提示" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1])
print('true' if s['visible'] and s['stillOnLogin'] and len(s['alertText']) > 0 else 'false')
" "$(p ac90_wrong_password)")"
      pass "④ 错误口令提示：$(p ac90_wrong_password)"
      eq "④ 移动端（390×844）不横向溢出（scrollWidth ≤ clientWidth+2）" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['docScrollWidth'] <= s['docClientWidth'] + 2 else 'false')
" "$(p ac90_mobile_overflow)")"
      pass "④ 移动端视口：$(p ac90_mobile_overflow)"
      eq "④ 移动端登录页仍无预填（value === ''）" '""' "$(p ac90_mobile_username_value)"
      eq "页面运行时异常（login）" "[]" "$(p ac32_runtime_errors)"

      line "截图（$SHOTS）"
      ls -l "$SHOTS" | sed 's/^/  /'
      eq "④ 截图齐备（亮 / 错误态 / 移动端 / 暗 / 登录后 = 5）" 5 "$(find "$SHOTS" -name '*.png' | wc -l)"
    fi
  fi
fi

line "结论"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ AC-89 / AC-90 全部通过"
else
  echo "  ❌ 有未通过项（见上方 ❌）"
fi
exit "$FAIL"
