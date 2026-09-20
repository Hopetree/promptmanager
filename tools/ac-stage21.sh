#!/usr/bin/env bash
# 阶段 21 验收自检：
#   AC-68 备注 = 纯文本 —— 编辑器预览字段只剩 用户/系统提示词；详情面「备注」原样纯文本、
#        DOM 无 h1/h2/h3/strong/ul/ol/a/code、**未发出** POST /api/render/markdown；切回用户提示词渲染恢复
#   AC-69 详情面标题下备注行 —— innerText == notes、13px/次级灰/行高 1.6、与标题行间距 ≤10px、
#        位置夹在标题行与页签行之间、空备注不渲染、长备注最多 2 行 + title 全文、亮暗三态截图
#
# 服务**自起自停**（临时 DATA_DIR + 备用端口）；不碰 8767 测试环境。
# 用法：bash tools/ac-stage21.sh
set -u

cd "$(dirname "$0")/.." || exit 1
PORT=${PORT:-auto}
AC_PW='ac-fixture-pw-20260918'
AC_USER='admin'
SHOTS='docs/shots/stage21'
FAIL=0

pick_port() {
  for candidate in 8765 8766 8767 8768 8769 8770; do
    if ! ss -ltn | grep -q ":$candidate "; then echo "$candidate"; return 0; fi
  done
  return 1
}
if [ "${PORT}" = "auto" ]; then
  PORT=$(pick_port) || { echo "FAIL 台账范围 8765–8770 全被占用（写 QUESTIONS 停手）"; exit 1; }
  echo "  PORT 自动选择：$PORT（开发环境临时实例；8767 测试环境不动）"
fi
BASE="http://127.0.0.1:$PORT"

line() { printf '\n=== %s ===\n' "$1"; }
pass() { printf '  ✅ %s\n' "$1"; }
fail() { printf '  ❌ %s\n' "$1"; FAIL=1; }
eq() { if [ "$2" = "$3" ]; then pass "$1 = $3"; else fail "$1 = $3（期望 $2）"; fi; }
le() { if [ "${3:-}" != '' ] && [ "$3" -le "$2" ] 2>/dev/null; then pass "$1 = $3（期望 ≤$2）"; else fail "$1 = ${3:-空}（期望 ≤$2）"; fi; }
ge() { if [ "${3:-}" != '' ] && [ "$3" -ge "$2" ] 2>/dev/null; then pass "$1 = $3（期望 ≥$2）"; else fail "$1 = ${3:-空}（期望 ≥$2）"; fi; }

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
AC_DIR=$(mktemp -d /tmp/pm-ac21-XXXXXX)

# ---------------------------------------------------------------- 静态侧
line "AC-68 ①/②：源码侧（编辑器字段只剩两项 / 详情面备注走纯文本分支）"
EDITOR_FIELDS=$(python3 - <<'PY'
import re
src = open('web/src/components/PromptEditor.tsx', encoding='utf-8').read()
block = src[src.index('fields={['): src.index(']}', src.index('fields={['))]
print(','.join(re.findall(r"key: '([a-z_]+)'", block)))
PY
)
eq "编辑器 Markdown 预览字段" "user_prompt,system_prompt" "$EDITOR_FIELDS"
eq "详情面备注纯文本分支" 1 "$(grep -c "sourceMode || plain || field === 'notes'" web/src/components/PromptDetail.tsx)"
eq "pm-detail-notes 锚点" 1 "$(grep -c 'data-testid="pm-detail-notes"' web/src/components/PromptDetail.tsx)"
eq "备注行空值不渲染" 1 "$(grep -c 'prompt.notes.trim() !== ' web/src/components/PromptDetail.tsx)"
eq "备注行 title 全文" 1 "$(grep -c 'title={prompt.notes}' web/src/components/PromptDetail.tsx)"
NOTES_RULE=$(awk '/^\.pm-detail-notes/,/^}/' web/src/styles/app.css)
eq "备注行 2 行截断样式（只数 .pm-detail-notes 规则）" 1 "$(printf '%s' "$NOTES_RULE" | grep -c '\-webkit-line-clamp: 2')"
eq "备注行 13px / 行高 1.6（只数该规则）" 2 "$(printf '%s' "$NOTES_RULE" | grep -cE 'font-size: 13px|line-height: 1\.6')"
eq "备注行颜色走 antd token（不写死色值）" 0 "$(printf '%s' "$NOTES_RULE" | grep -cE 'color: *[#a-zA-Z]')"
eq "不外溢：备注未进变量面板" 0 "$(grep -c 'notes' web/src/components/VariablePanel.tsx)"

line "构建 / 类型检查（体积预算不破）"
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

line "本阶段新增单测"
TEST_LOG="$AC_DIR/tests.log"
node --test tests/stage21-notes-plain.test.ts tests/stage21-detail-notes.test.ts >"$TEST_LOG" 2>&1
eq "两个新测试文件退出码" 0 "$?"
grep -E "^ℹ (tests|pass|fail)" "$TEST_LOG" | sed 's/^/  /'

# ---------------------------------------------------------------- 运行时侧
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

    # 夹具：三条（有备注含 Markdown 语法 / 无备注 / 长备注 ≥200 字）
    NOTES_MD='# 标题
**粗体** 与 - 列表
链接 [链接](http://x) 原样显示'
    LONG_NOTES=$(python3 -c "print('长备注' * 80)")
    post_prompt() {
      python3 -c "
import json, sys
print(json.dumps({'title': sys.argv[1], 'user_prompt': sys.argv[2], 'system_prompt': '你是助手。', 'notes': sys.argv[3]}, ensure_ascii=False))
" "$1" "$2" "$3" | curl -s -b "$JAR" -H 'Content-Type: application/json' -d @- "$BASE/api/prompts" >/dev/null
    }
    post_prompt 'AC21 有备注' '## 用户提示词

正文里有 **粗体** 与 [链接](http://y)。' "$NOTES_MD"
    post_prompt 'AC21 无备注' '无备注条目的正文。' ''
    post_prompt 'AC21 长备注' '长备注条目的正文。' "$LONG_NOTES"
    pass "夹具：3 条（有备注/无备注/长备注 ${#LONG_NOTES} 字）"

    rm -rf "$SHOTS"
    node tools/ac-stage21-probe.mjs notes "$BASE" "$SID" "$SHOTS" | tee "$AC_DIR/probe.log"
    v() { grep -m1 "^$1=" "$AC_DIR/probe.log" | cut -d= -f2-; }

    line "AC-68 ①：编辑器页 Markdown 预览字段下拉"
    pass "下拉选项：$(v ac68_editor_options)"
    eq "恰好 ['用户提示词','系统提示词']" '["用户提示词","系统提示词"]' "$(v ac68_editor_options)"

    line "AC-68 ②③：详情面「备注」= 纯文本 + 无渲染请求"
    pass "备注正文（原样）：$(v ac68_body_text | tr '\n' '⏎')"
    eq "原样含 # 标题 / **粗体** / - 列表 / [链接](http://x)" '{"heading":true,"bold":true,"list":true,"link":true}' "$(v ac68_body_has_markdown_chars)"
    eq "正文区渲染元素（h1/h2/h3/strong/ul/ol/a/code）计数" "0" "$(v ac68_rendered_tags)"
    eq "从切「备注」到显示完成发出的 /api/render/markdown 请求数" "0" "$(v ac68_notes_requests)"

    line "AC-68 ④：切回「用户提示词」→ Markdown 渲染恢复"
    ge "切回后发出的 /api/render/markdown 请求数" 1 "$(v ac68_back_requests)"
    ge "切回后正文区渲染元素计数" 1 "$(v ac68_back_rendered_tags)"

    line "AC-69 ①：备注行文本 == 备注原文"
    pass "pm-detail-notes.innerText：$(echo "$(v ac69_notes_text)" | jq -r . | tr '\n' '⏎')"
    eq "与 notes 原文逐字符一致（JSON 逐字符比较）" "$(v ac69_source_notes)" "$(v ac69_notes_text)"

    line "AC-69 ②③：样式 / 间距 / 位置"
    pass "computedStyle：$(v ac69_style)"
    pass "几何：$(v ac69_geometry)"
    eq "字号 ≤14px" "true" "$(awk -v v="$(echo "$(v ac69_style)" | jq -r .fontSize)" 'BEGIN{print (substr(v,1,length(v)-2)+0<=14) ? "true" : "false"}')"
    eq "行高 ≥1.5" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); lh=s['lineHeight']; fs=s['fontSize']
# lineHeight 可能是 '20.8px' 或 '1.6'
value = lh if not lh.endswith('px') else str(float(lh[:-2])/float(fs[:-2]))
print('true' if float(value) >= 1.5 else 'false')
" "$(v ac69_style)")"
    eq "颜色与标题不同（次级灰）" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['color'] != s['titleColor'] else 'false')
" "$(v ac69_style)")"
    eq "-webkit-line-clamp 生效" "2" "$(echo "$(v ac69_style)" | jq -r .clamp)"
    le "标题行底部 → 备注行顶部（px）" 10 "$(echo "$(v ac69_geometry)" | jq -r .gap)"
    eq "备注行夹在标题行与页签行之间" "true" "$(echo "$(v ac69_geometry)" | jq -r .between)"

    line "AC-69 ④⑤：空备注不渲染 / 长备注最多 2 行 + title 全文"
    eq "空备注条目：备注行不存在且详情面正常" '{"exists":false,"detailPresent":true}' "$(v ac69_empty_state)"
    pass "长备注度量：$(v ac69_long)"
    le "长备注渲染行数（≤2）" 2 "$(echo "$(v ac69_long)" | jq -r .lines)"
    eq "命中断行截断（clamp=2 且 overflow=hidden）" "2|hidden" "$(echo "$(v ac69_long)" | jq -r '.clamp + "|" + .overflow')"
    eq "title 承载全文（长度 == 正文长度）" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['titleLength'] == s['textLength'] else 'false')
" "$(v ac69_long)")"

    line "AC-69 ⑥：亮/暗三态截图"
    pass "暗色备注行：$(v ac69_dark)"
    eq "暗色下颜色仍与标题不同" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['color'] != s['titleColor'] else 'false')
" "$(v ac69_dark)")"
    ls -l "$SHOTS" | sed 's/^/  /'
    ge "截图张数（亮暗各三态 ≥6）" 6 "$(ls "$SHOTS"/*.png 2>/dev/null | wc -l)"
    eq "页面运行时异常" "[]" "$(v ac21_runtime_errors)"
  fi
fi

line "结论"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ AC-68 / AC-69 全部通过"
else
  echo "  ❌ 有未通过项（见上方 ❌）"
fi
exit "$FAIL"
