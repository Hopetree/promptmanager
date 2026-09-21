#!/usr/bin/env bash
# 阶段 19 验收自检：
#   AC-63 编辑器全屏（v25 修订版）—— 真鼠标 + 真实像素：不进入浏览器全屏、只隐藏 editor-list、编辑栏:右栏 = 1:1、
#        按钮与详情面同款、Esc 只退全屏（正文不丢）、双向切换、详情面 pm-detail-fullscreen 仍在
#   AC-64 版本 diff 不再把「未改动的备注」显示成变更 —— 修复后同一组夹具的 diff 原文 + 单测输出
#   AC-65 复制在内网 HTTP 下可用 —— **必须用内网 IP 访问**（127.0.0.1 是安全上下文，会掩盖此 bug）
#
# 服务**自起自停**（临时 DATA_DIR，端口在台账 8765–8770 内自动挑空闲）。
# 用法：bash tools/ac-stage19.sh
set -u

cd "$(dirname "$0")/.." || exit 1
PORT=${PORT:-auto}
LAN_IP=${LAN_IP:-192.168.0.228}
AC_PW='ac-fixture-pw-20260918'
AC_USER='admin'
SHOTS='tmp/shots/stage19'
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
SECURE="http://127.0.0.1:$PORT"
LAN="http://$LAN_IP:$PORT"

line() { printf '\n=== %s ===\n' "$1"; }
pass() { printf '  ✅ %s\n' "$1"; }
fail() { printf '  ❌ %s\n' "$1"; FAIL=1; }
eq() { if [ "$2" = "$3" ]; then pass "$1 = $3"; else fail "$1 = $3（期望 $2）"; fi; }
ge() { if [ "${3:-}" != '' ] && [ "$3" -ge "$2" ] 2>/dev/null; then pass "$1 = $3（期望 ≥$2）"; else fail "$1 = ${3:-空}（期望 ≥$2）"; fi; }
le() { if [ "${3:-}" != '' ] && [ "$3" -le "$2" ] 2>/dev/null; then pass "$1 = $3（期望 ≤$2）"; else fail "$1 = ${3:-空}（期望 ≤$2）"; fi; }
in01() { if [ "${2:-}" != '' ] && awk -v v="$2" 'BEGIN{exit !(v>=0.95 && v<=1.05)}'; then pass "$1 = $2（期望 0.95–1.05）"; else fail "$1 = ${2:-空}（期望 0.95–1.05）"; fi; }

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
AC_DIR=$(mktemp -d /tmp/pm-ac19-XXXXXX)

# ---------------------------------------------------------------- 静态侧
line "AC-63 ①：源码里不得再出现浏览器 Fullscreen API（撤销 FR-62 形态）"
for pat in requestFullscreen exitFullscreen fullscreenchange fullscreenEnabled; do
  eq "web/src 里 $pat 命中数" 0 "$(grep -rn "$pat" web/src | wc -l)"
done
eq "web/src 里 pm-shell-hidden 命中数（隐藏外壳的旧规则）" 0 "$(grep -rn 'pm-shell-hidden' web/src | wc -l)"

line "AC-63 ②：editor-list / editor-main / editor-side 锚点 + 1:1 网格 + 左栏隐藏规则"
eq 'editor-list 锚点' 1 "$(grep -c 'data-testid="editor-list"' web/src/components/PromptEditor.tsx)"
eq 'editor-main 锚点' 1 "$(grep -c 'data-testid="editor-main"' web/src/components/PromptEditor.tsx)"
eq 'editor-side 锚点' 1 "$(grep -c 'data-testid="editor-side"' web/src/components/PromptEditor.tsx)"
eq '全屏两列等宽网格' 1 "$(grep -c 'grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)' web/src/styles/app.css)"
eq '全屏隐藏 editor-list' 1 "$(grep -c "\[data-testid='editor-list'\]" web/src/styles/app.css)"

line "AC-65 ③：全仓 navigator.clipboard 只允许 1 处"
grep -rn "navigator.clipboard" web/src | sed 's/^/  /'
eq "命中行数" 1 "$(grep -rn 'navigator.clipboard' web/src | wc -l)"
eq "document.execCommand 实现处（仅 clipboard.ts）" 1 "$(grep -rl 'document.execCommand' web/src | wc -l)"
eq "VariablePanel 调用统一实现（await writeClipboard 恰 1 次）" 1 "$(grep -c 'await writeClipboard' web/src/components/VariablePanel.tsx)"
eq "use-copy 再导出 writeClipboard" 1 "$(grep -c 'export { writeClipboard }' web/src/use-copy.ts)"

# ---------------------------------------------------------------- 构建
line "构建（体积预算不破：最大 chunk ≤500KB、无 >500KB 告警）"
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
le "最大 chunk（未压缩，byte）" 500000 "$MAXCHUNK"
npm run typecheck:web >/dev/null 2>&1
eq "npm run typecheck:web 退出码" 0 "$?"

# ---------------------------------------------------------------- 单测
line "AC-64 ③ / AC-65 ④：本阶段新增单测"
TEST_LOG="$AC_DIR/tests.log"
node --test tests/diff-notes-newline.test.ts tests/clipboard-fallback.test.ts tests/stage19-fullscreen.test.ts >"$TEST_LOG" 2>&1
eq "三个新测试文件退出码" 0 "$?"
grep -E "^ℹ (tests|pass|fail)" "$TEST_LOG" | sed 's/^/  /'

# ---------------------------------------------------------------- 运行时侧
line "运行时：起临时实例（0.0.0.0:$PORT，内网 IP = $LAN_IP）"
if ss -ltn | grep -q ":$PORT "; then
  fail "端口 $PORT 被占用"
else
  printf '%s\n' "$AC_PW" | DATA_DIR="$AC_DIR" node bin/pm.mjs user set-password --username "$AC_USER" >/dev/null
  DATA_DIR="$AC_DIR" HOST=0.0.0.0 PORT="$PORT" node dist/server/index.js >"$AC_DIR/server.log" 2>&1 &
  SRV_PID=$!
  CODE=''
  for _ in $(seq 1 60); do
    CODE=$(curl -s -o /dev/null -w '%{http_code}' "$SECURE/healthz" 2>/dev/null || true)
    [ "$CODE" = "200" ] && break
    sleep 0.3
  done
  if [ "$CODE" != "200" ]; then
    fail "服务未起来（$AC_DIR/server.log）"
  else
    pass "监听：$(ss -ltn | grep ":$PORT " | head -1 | tr -s ' ')"
    JAR="$AC_DIR/jar.txt"
    curl -s -c "$JAR" -o /dev/null -X POST -H 'Content-Type: application/json' \
      -d "{\"username\":\"$AC_USER\",\"password\":\"$AC_PW\"}" "$SECURE/api/login"
    SID=$(awk '$6 == "pm_sid" { print $7 }' "$JAR" | tail -1)
    [ -z "$SID" ] && fail "登录失败，拿不到 pm_sid"

    # ---------- AC-64：同一组夹具的 diff 原文（修复后） ----------
    line "AC-64 ①：仅备注尾部换行不同 → diff 不得出现变更行（修复后原文）"
    P64=$(curl -s -b "$JAR" -H 'Content-Type: application/json' \
      -d '{"title":"AC64 夹具","user_prompt":"U1","system_prompt":"S","notes":"N"}' "$SECURE/api/prompts" | jq -r .id)
    curl -s -b "$JAR" -X PUT -H 'Content-Type: application/json' -d '{"notes":"N\n"}' "$SECURE/api/prompts/$P64" >/dev/null
    DIFF12=$(curl -s -b "$JAR" "$SECURE/api/prompts/$P64/diff?from=1&to=2" | jq -r .diff)
    printf '%s\n' "$DIFF12" | sed 's/^/  /'
    eq "diff 里 [notes] 段变更行数（-N/+N）" 0 "$(printf '%s\n' "$DIFF12" | grep -cE '^-N$|^\+N$')"
    eq "diff 里 No newline 标记数" 0 "$(printf '%s\n' "$DIFF12" | grep -c 'No newline at end of file')"

    line "AC-64 ②：备注真改了（N → N2）→ 仍要显示变更"
    curl -s -b "$JAR" -X PUT -H 'Content-Type: application/json' -d '{"notes":"N2"}' "$SECURE/api/prompts/$P64" >/dev/null
    DIFF23=$(curl -s -b "$JAR" "$SECURE/api/prompts/$P64/diff?from=2&to=3" | jq -r .diff)
    printf '%s\n' "$DIFF23" | sed 's/^/  /'
    eq "含 -N" 1 "$(printf '%s\n' "$DIFF23" | grep -cE '^-N$')"
    eq "含 +N2" 1 "$(printf '%s\n' "$DIFF23" | grep -cE '^\+N2$')"
    eq "含 No newline 标记" 0 "$(printf '%s\n' "$DIFF23" | grep -c 'No newline at end of file')"

    # ---------- AC-63 夹具 + 探针 ----------
    line "AC-63：编辑器全屏（真鼠标 + 真实像素）"
    for n in 1 2 3; do
      curl -s -b "$JAR" -H 'Content-Type: application/json' \
        -d "{\"title\":\"AC63 夹具 $n\",\"user_prompt\":\"第 $n 条正文\",\"system_prompt\":\"S\",\"notes\":\"N\"}" "$SECURE/api/prompts" >/dev/null
    done
    rm -rf "$SHOTS"
    node tools/ac-stage19-probe.mjs editor "$SECURE" "$SID" none "$SHOTS" | tee "$AC_DIR/editor.log"
    v() { grep -m1 "^$1=" "$AC_DIR/editor.log" | cut -d= -f2-; }

    eq "① 进全屏前：浏览器全屏元素为空" "true" "$(v ac63_fullscreen_element_before)"
    eq "② 点全屏后：浏览器全屏元素仍为空（不进入浏览器全屏）" "true" "$(v ac63_fullscreen_element_after)"
    pass "② 内部左栏：$(v ac63_list_before) → 全屏 $(v ac63_list_in_fullscreen)"
    eq "② 全屏下 editor-list offsetParent === null" "true" "$(echo "$(v ac63_list_in_fullscreen)" | jq -r .offsetParentNull)"
    pass "② 宽度（常态）：$(v ac63_widths_before)"
    pass "② 宽度（全屏）：$(v ac63_widths_fullscreen)"
    in01 "② 编辑栏 / 右栏 比值" "$(echo "$(v ac63_widths_fullscreen)" | jq -r .ratio)"
    eq "② 全屏下可见的 .pm-editor-col 列数" 2 "$(v ac63_visible_cols_fullscreen)"
    pass "③ 按钮（常态）：$(v ac63_button_before)"
    pass "③ 按钮（全屏）：$(v ac63_button_in_fullscreen)"
    eq "③ 全屏文案 = 退出全屏" "退出全屏" "$(echo "$(v ac63_button_in_fullscreen)" | jq -r .text)"
    case "$(echo "$(v ac63_button_in_fullscreen)" | jq -r .icon)" in
      *anticon-compress*) pass "③ icon = anticon-compress" ;;
      *) fail "③ icon = $(echo "$(v ac63_button_in_fullscreen)" | jq -r .icon)" ;;
    esac
    eq "④ Esc 后 editor-list 恢复可见" "false" "$(echo "$(v ac63_list_after_esc)" | jq -r .offsetParentNull)"
    pass "④ Esc 后宽度：$(v ac63_widths_after_esc)"
    eq "④ 宽度回到原布局（与进入前一致）" "$(v ac63_widths_before)" "$(v ac63_widths_after_esc)"
    eq "④ 未保存正文长度不变（1200）" "1200" "$(v ac63_body_after_esc)"
    eq "④ 仍在编辑器（未触发返回）" "true" "$(v ac63_still_editor_after_esc)"
    eq "④ 未误触「返回详情」" "false" "$(v ac63_returned_to_detail_after_esc)"
    eq "⑤ 再点进入全屏" "true" "$(v ac63_reenter_ok)"
    eq "⑤ 再点退出全屏（双向切换）" "true" "$(v ac63_toggle_exit_ok)"
    eq "⑥ 详情面 pm-detail-fullscreen 仍在" "true" "$(v ac63_detail_fullscreen_exists)"
    eq "⑥ 详情面全屏仍可用（铺满视口）" "true" "$(echo "$(v ac63_detail_fullscreen_state)" | jq -r '.cls and (.w == .vw) and (.h == .vh)')"
    eq "页面运行时异常" "[]" "$(v ac19_runtime_errors)"

    # ---------- AC-65 夹具 + 探针（内网 IP） ----------
    line "AC-65：复制在内网 HTTP 下可用（真鼠标 + 内网 IP + 剪贴板读回）"
    curl -s -b "$JAR" -H 'Content-Type: application/json' \
      -d '{"title":"AC65 无变量","user_prompt":"固定的用户提示词，无变量。","system_prompt":"你是助手"}' "$SECURE/api/prompts" >/dev/null
    curl -s -b "$JAR" -H 'Content-Type: application/json' \
      -d '{"title":"AC65 有变量","user_prompt":"你好 {{姓名}}，请确认。","system_prompt":"你是助手 {{称呼}}。"}' "$SECURE/api/prompts" >/dev/null
    node tools/ac-stage19-probe.mjs copy "$LAN" "$SID" "$SECURE" "$SHOTS" | tee "$AC_DIR/copy.log"
    w() { grep -m1 "^$1=" "$AC_DIR/copy.log" | cut -d= -f2-; }

    pass "① 访问地址：$(w ac65_url)"
    eq "① window.isSecureContext === false（真实内网环境）" "false" "$(w ac65_is_secure_context)"
    eq "① navigator.clipboard 不存在" "undefined" "$(w ac65_clipboard_type)"
    eq "① navigator.clipboard.writeText 不存在" "undefined" "$(w ac65_write_text_type)"
    eq "① document.execCommand 可用（兜底路径存在）" "function" "$(w ac65_exec_command_type)"
    pass "② 详情面复制提示：$(w ac65_detail_message)"
    eq "② 详情面复制不出现拒绝提示" 0 "$(printf '%s' "$(w ac65_detail_message)" | grep -c '浏览器拒绝了剪贴板访问')"
    eq "② 详情面复制提示含 已复制" 1 "$(printf '%s' "$(w ac65_detail_message)" | grep -c '已复制')"
    eq "② 详情面剪贴板内容 == 源文本" "$(w ac65_detail_source)" "$(w ac65_detail_clipboard)"
    pass "② 变量面板复制提示：$(w ac65_varpanel_message)"
    eq "② 变量面板复制不出现拒绝提示" 0 "$(printf '%s' "$(w ac65_varpanel_message)" | grep -c '浏览器拒绝了剪贴板访问')"
    eq "② 变量面板复制提示含 已复制" 1 "$(printf '%s' "$(w ac65_varpanel_message)" | grep -c '已复制')"
    eq "② 变量面板剪贴板内容 == 渲染结果" "$(w ac65_rendered_text)" "$(w ac65_varpanel_clipboard)"

    line "截图（$SHOTS）"
    ls -l "$SHOTS" | sed 's/^/  /'
    ge "截图张数" 6 "$(ls "$SHOTS"/*.png 2>/dev/null | wc -l)"
  fi
fi

line "结论"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ AC-63 / AC-64 / AC-65 全部通过"
else
  echo "  ❌ 有未通过项（见上方 ❌）"
fi
exit "$FAIL"
