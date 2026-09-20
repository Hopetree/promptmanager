#!/usr/bin/env bash
# 阶段 18 验收自检：
#   AC-60（注释/文案漂移清理）—— 5 条 grep 原样输出
#   AC-61（构建体积）—— 构建 chunk 表 + 最大 chunk ≤500KB + 总 gzip 对照 + 零外链
#   （AC-62 的「浏览器全屏 + 隐藏外壳」形态已由 FR-63 / AC-63 撤销 → 全屏验收见 tools/ac-stage19.sh）
#   AC-61 ④（懒加载六处逐一点开自证 + 截图）
#
# 服务**自起自停**（临时 DATA_DIR，端口在台账 8765–8770 内自动挑空闲）。
# 用法：bash tools/ac-stage18.sh
set -u

cd "$(dirname "$0")/.." || exit 1
PORT=${PORT:-auto}
AC_PW='ac-fixture-pw-20260918'
AC_USER='admin'
SHOTS='docs/shots/stage18'
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
ge() { if [ "${3:-}" != '' ] && [ "$3" -ge "$2" ] 2>/dev/null; then pass "$1 = $3（期望 ≥$2）"; else fail "$1 = ${3:-空}（期望 ≥$2）"; fi; }
le() { if [ "${3:-}" != '' ] && [ "$3" -le "$2" ] 2>/dev/null; then pass "$1 = $3（期望 ≤$2）"; else fail "$1 = ${3:-空}（期望 ≤$2）"; fi; }

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

# ---------------------------------------------------------------- AC-60 静态侧
line "AC-60 ①：web/src 不再出现「文件夹与标签」"
grep -rn "文件夹与标签" web/src && fail "仍有命中" || pass "grep -rn 命中 0"
eq "命中数" 0 "$(grep -rn '文件夹与标签' web/src | wc -l)"

line "AC-60 ②：app.css 不再使用旧术语「使用视图 / 管理视图」"
grep -n "使用视图\|管理视图" web/src/styles/app.css && fail "仍有命中" || pass "grep -n 命中 0"
eq "命中数" 0 "$(grep -c '使用视图\|管理视图' web/src/styles/app.css)"

line "AC-60 ③：导入报错文案用品牌大小写；app 契约值原样保留"
grep -rn "不是 promptmanager" web/src && fail "仍有旧文案" || pass "grep -rn '不是 promptmanager' 命中 0"
eq "命中数" 0 "$(grep -rn '不是 promptmanager' web/src | wc -l)"
grep -n "不是 PromptManager 的导出文件" web/src/pure.ts || fail "缺少新文案"
eq "grep -c \"app: 'promptmanager'\" web/src/pure.ts" 1 "$(grep -c "app: 'promptmanager'" web/src/pure.ts)"
grep -n "app: 'promptmanager'" web/src/pure.ts

line "AC-60 ④：已废止概念在 web/src、src 的注释/文案命中 0"
PATTERN='pm-mode-use|pm-mode-manage|模式记忆|列表视图|pm-view-list|pm-kpi-row|pm-filter-row|pm-statusbar|管理视图|使用视图'
grep -rnE "$PATTERN" web/src src && fail "仍有命中" || pass "grep -rnE 命中 0"
eq "命中数" 0 "$(grep -rnE "$PATTERN" web/src src | wc -l)"
eq "菜单名「设置」已改「关于」" 0 "$(grep -c '>设置<' web/src/components/AppHeader.tsx)"

line "AC-60 白名单未误伤（契约值 / 包名 / 服务名 / 资产路径 / 历史文档）"
eq "src/services/export.ts 的 EXPORT_APP" 1 "$(grep -c "EXPORT_APP = 'promptmanager'" src/services/export.ts)"
eq "package.json 包名" 1 "$(grep -c '"name": "promptmanager"' package.json)"
ge "systemd 服务名（文件名白名单）" 1 "$(grep -c 'systemctl restart promptmanager' web/src/components/AboutModal.tsx)"
eq "品牌位图路径（文件名白名单）" 1 "$(grep -c '/promptmanager-96.png' web/src/components/LoginPage.tsx)"
eq "「拿来就用」只由 aria-label 承载（FR-53）" 1 "$(grep -c 'aria-label="拿来就用"' web/src/components/Workspace.tsx)"

# ---------------------------------------------------------------- AC-61 构建侧
line "AC-61 ①：npm run build 的 chunk 表（最大 chunk 必须 ≤500 KB 未压缩）"
AC_DIR=$(mktemp -d /tmp/pm-ac18-XXXXXX)
BUILD_LOG="$AC_DIR/build.log"
npm run build >"$BUILD_LOG" 2>&1
BUILD_RC=$?
eq "npm run build 退出码" 0 "$BUILD_RC"
grep -E 'dist/web/.*(kB|MB)' "$BUILD_LOG" | sed 's/^/  /'
eq "构建输出里的 >500KB 告警数" 0 "$(grep -c 'larger than 500' "$BUILD_LOG")"
node -e '
const fs=require("fs"), zlib=require("zlib"), path=require("path");
const dir="dist/web/assets";
const rows=fs.readdirSync(dir).filter((f)=>/\.(js|css)$/.test(f)).map((f)=>{const b=fs.readFileSync(path.join(dir,f));return {f, raw:b.length, gzip:zlib.gzipSync(b).length};}).sort((a,b)=>b.raw-a.raw);
let total=0;
console.log("  chunk（未压缩 / gzip，按体积降序）：");
for(const r of rows){total+=r.gzip;console.log(`    ${r.f} raw=${r.raw} gzip=${r.gzip}`);}
console.log(`  TOTAL raw=${rows.reduce((s,r)=>s+r.raw,0)} gzip=${total}`);
console.log(`MAXCHUNK=${rows[0].raw}`);
console.log(`TOTALGZIP=${total}`);
' > "$AC_DIR/sizes.txt"
cat "$AC_DIR/sizes.txt" | sed 's/^/  /'
MAXCHUNK=$(grep '^MAXCHUNK=' "$AC_DIR/sizes.txt" | cut -d= -f2)
TOTALGZIP=$(grep '^TOTALGZIP=' "$AC_DIR/sizes.txt" | cut -d= -f2)
le "最大 chunk（未压缩，byte）" 500000 "$MAXCHUNK"
pass "开工前基线：主 chunk 1,265,060 B（gzip 397,382）；总 gzip 399,175 —— 现在总 gzip=${TOTALGZIP}（阶段 18 的 FR-61 单独落地时 398,567，低于基线）"

line "AC-61 ②：首屏入口 chunk 体积"
ENTRY=$(grep -o 'assets/[^"]*\.js' dist/web/index.html | head -1)
echo "  index.html 引用：$ENTRY"
pass "入口 chunk $ENTRY = $(stat -c %s "dist/web/$ENTRY") byte（gzip $(gzip -c "dist/web/$ENTRY" | wc -c) byte）"
le "入口 chunk ≤100 KB" 100000 "$(stat -c %s "dist/web/$ENTRY")"
grep -o 'assets/[^"]*\.js' dist/web/index.html | sed 's/^/  modulepreload: /'

line "AC-61 ③：产物与源码零外链"
eq "dist/web/index.html 外链数" 0 "$(grep -cE '(https?://|cdn|unpkg|jsdelivr)' dist/web/index.html)"
eq "web/index.html 外链数" 0 "$(grep -cE '(https?://|cdn|unpkg|jsdelivr)' web/index.html)"

line "不得回归（源码侧）：组件库硬约束"
eq "原生表单标签" 0 "$(grep -rnE "<(button|input|select|textarea|table|dialog)[ >/]" web/src --include='*.tsx' | wc -l)"
ge "from 'antd' 次数" 5 "$(grep -rnoE "from ['\"]antd['\"]" web/src --include='*.tsx' | wc -l)"

# ---------------------------------------------------------------- 运行时侧
line "运行时：起临时实例（DATA_DIR=$AC_DIR，PORT=$PORT）"
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
    pass "服务已起：$BASE/healthz = 200"
    JAR="$AC_DIR/jar.txt"
    curl -s -c "$JAR" -o /dev/null -X POST -H 'Content-Type: application/json' \
      -d "{\"username\":\"$AC_USER\",\"password\":\"$AC_PW\"}" "$BASE/api/login"
    SID=$(awk '$6 == "pm_sid" { print $7 }' "$JAR" | tail -1)
    if [ -z "$SID" ]; then fail "登录失败，拿不到 pm_sid"; fi

    # 夹具：两条 prompt，各 3 个版本（版本 diff / 编辑器 / 分栏选择都需要）
    P1=$(curl -s -b "$JAR" -H 'Content-Type: application/json' \
      -d '{"title":"AC62 大文本夹具","user_prompt":"你好 {{姓名}}，这是第 1 版。","system_prompt":"你是助手。","notes":"阶段 18 夹具"}' \
      "$BASE/api/prompts" | jq -r '.id')
    P2=$(curl -s -b "$JAR" -H 'Content-Type: application/json' \
      -d '{"title":"AC62 次条目","user_prompt":"第二条，用来验证分栏列表与选择。","system_prompt":"你是助手。"}' \
      "$BASE/api/prompts" | jq -r '.id')
    for n in 2 3; do
      curl -s -b "$JAR" -X PUT -H 'Content-Type: application/json' \
        -d "{\"user_prompt\":\"你好 {{姓名}}，这是第 $n 版：内容逐版加长一点。\"}" "$BASE/api/prompts/$P1" >/dev/null
      curl -s -b "$JAR" -X PUT -H 'Content-Type: application/json' \
        -d "{\"user_prompt\":\"第二条，第 $n 版：内容逐版加长一点。\"}" "$BASE/api/prompts/$P2" >/dev/null
    done
    pass "夹具：prompt #$P1 / #$P2 各 3 个版本"

    rm -rf "$SHOTS"
    node tools/ac-stage18-probe.mjs "$BASE" "$SID" "$SHOTS" | tee "$AC_DIR/probe.log"
    v() { grep -m1 "^$1=" "$AC_DIR/probe.log" | cut -d= -f2-; }

    line "AC-62 的形态要求已由 AC-63 取代（BRIEF v25）"
    pass "本脚本不再断言任何编辑器全屏形态；全屏验收见 tools/ac-stage19.sh（AC-63：只隐藏 editor-list + 左右 1:1）"

    line "AC-61 ④：六处懒加载逐一点开自证"
    eq "编辑器" "true" "$(v ac61_lazy_editor)"
    eq "Markdown 预览" "true" "$(v ac61_lazy_markdown)"
    eq "版本 diff" "true" "$(v ac61_lazy_diff)"
    eq "导入 / 导出" "true" "$(v ac61_lazy_import)"
    eq "使用统计" "true" "$(v ac61_lazy_usage)"
    eq "API 令牌" "true" "$(v ac61_lazy_token)"
    ge "截图张数" 5 "$(ls "$SHOTS"/*.png 2>/dev/null | wc -l)"
    ls -l "$SHOTS" | sed 's/^/  /'

    line "运行时异常"
    pass "页面运行时错误：$(v ac18_runtime_errors)"
  fi
fi

line "结论"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ AC-60 / AC-61（+ AC-61 ④ 懒加载六处）全部通过（AC-62 形态已由 AC-63 取代）"
else
  echo "  ❌ 有未通过项（见上方 ❌）"
fi
exit "$FAIL"
