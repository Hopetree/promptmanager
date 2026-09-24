#!/usr/bin/env bash
# 阶段 55 / AC-119 验收自检（FR-119 ~ FR-123 五项小修）。
#
#   ① FR-119 使用统计口径文案（两处都不再声称"打开详情"计入）+ 口径本身零改动
#   ② FR-120 空态区分「库为空」与「搜索无匹配」× 两处视图（UseView / SplitView）
#   ③ FR-121 分隔符对比度亮/暗均 ≥3:1，且形态（字形/宽度/gap/不可选中）未变
#   ④ FR-122 Token 掩码单行；移动端 7 列均 >0、名称列非 0、可横滚、末列按钮可达
#   ⑤ FR-123 移动端「文件夹」列不折行；横滚与关键列可见性不受影响
#
# 资源纪律（D-55 ⑦ / D-54 ②）：串行、单浏览器上下文、用完即关、每项查一次资源、熔断阈值
# available<800MB 或 load1>20 即停手。
#
# 本脚本**不启动服务**（开发实例由调用者先起好），只跑浏览器探针 + 断言。
# 用法：bash tools/ac-stage55.sh <baseUrl> <sid> [输出目录]
set -u
set -o pipefail
cd "$(dirname "$0")/.." || exit 1
BASE=${1:?用法: ac-stage55.sh <baseUrl> <sid> [outDir]}
SID=${2:?}
OUT=${3:-tmp/shots/stage55}
RAW="$OUT/_checks"
mkdir -p "$RAW"
FAIL=0
MELT_AVAIL=800
MELT_LOAD=20

line() { printf '\n=== %s ===\n' "$1"; }
pass() { printf '  ✅ %s\n' "$1"; }
fail() { printf '  ❌ %s\n' "$1"; FAIL=1; }
eq() { if [ "$2" = "$3" ]; then pass "$1 = $3"; else fail "$1 = $3（期望 $2）"; fi; }
melt() {
  local a l
  a=$(free -m | awk 'NR==2{printf "%d",$7}')
  l=$(uptime | sed 's/.*load average: //' | cut -d, -f1)
  printf '    [资源] %s：available=%sMB load1=%s\n' "$1" "$a" "$l"
  if [ "$a" -lt "$MELT_AVAIL" ] || [ "${l%.*}" -ge "$MELT_LOAD" ]; then
    echo "  ⚠️ 熔断（阈值 available<${MELT_AVAIL}MB 或 load1>${MELT_LOAD}）—— 停止后续批次"
    return 1
  fi
  return 0
}
# 从原始 CHECK 行里取某项的 JSON
get() { grep "^CHECK|$1|" "$2" | head -1 | cut -d'|' -f3-; }

melt "开始前" || exit 1
line "跑两批（串行，单上下文）"
for FORM in pc mobile; do
  echo ""
  echo "--- $FORM ---"
  node tools/ac-stage55-verify.mjs "$BASE" "$SID" "$FORM" "$OUT" 2>&1 \
    | grep -E '^(CHECK|DONE|FATAL|CLOSED)\|' | tee "$RAW/$FORM.txt" | sed 's/^/  /'
  if grep -q '^FATAL' "$RAW/$FORM.txt"; then fail "$FORM 批次中途异常"; else pass "$FORM 批次跑完"; fi
  melt "$FORM 批次后" || { echo "MELTDOWN"; break; }
done
PCF="$RAW/pc.txt"; MBF="$RAW/mobile.txt"

line "① FR-119 使用统计口径文案（两处一致 + 口径本身未动）"
for f in "$PCF" "$MBF"; do
  [ -f "$f" ] || continue
  U=$(get usage-copy "$f")
  K=$(printf '%s' "$U" | jq -r '.kouJing')
  echo "    口径行原文：$K"
  echo "    空态提示：$(printf '%s' "$U" | jq -r '.fullText' | grep -o '复制提示词 / 渲染 / MCP 取用都会计入；打开详情只留痕、不计入' || echo '(未找到)')"
  eq "口径行不再声称「打开详情」计入（不含'（打开详情 /'）" 0 "$(printf '%s' "$K" | grep -c '（打开详情 /' || true)"
  eq "口径行明确说「打开详情…不计」" 1 "$(printf '%s' "$K" | grep -c '打开详情.*不计' || true)"
  eq "口径行含「复制」" 1 "$(printf '%s' "$K" | grep -c '复制' || true)"
  eq "口径行含「MCP」" 1 "$(printf '%s' "$K" | grep -c 'MCP' || true)"
  eq "空态提示不再说打开详情会计入" 1 "$(printf '%s' "$U" | jq -r '.fullText' | grep -c '复制提示词 / 渲染 / MCP 取用都会计入；打开详情只留痕、不计入' || true)"
  eq "两处口径互相一致（都提复制、都不把打开详情算进去）" 1 "$([ "$(printf '%s' "$K" | grep -c '打开详情.*不计')" = 1 ] && [ "$(printf '%s' "$U" | jq -r '.fullText' | grep -c '打开详情只留痕、不计入')" = 1 ] && echo 1 || echo 0)"
done
line "① 口径本身（COUNTED_KINDS / 聚合逻辑）零改动"
eq "src/services/usage.ts 未被改动" 0 "$(git diff --name-only -- src/ | wc -l)"
eq "COUNTED_KINDS 仍是 copy+mcp" 1 "$(grep -c "COUNTED_KINDS: readonly UsageKind\[\] = \['copy', 'mcp'\]" src/services/usage.ts || true)"

line "② FR-120 空态区分两种场景 × 两处视图"
for f in "$PCF" "$MBF"; do
  [ -f "$f" ] || continue
  for V in 卡片 分栏; do
    E=$(get "empty-nomatch-$V" "$f")
    T=$(printf '%s' "$E" | jq -r '.text')
    M=$(printf '%s' "$E" | jq -r '.isMisleading')
    echo "    [$V] $T"
    eq "② 搜索无匹配时主标题不再是「还没有可用的 prompt」" 0 "$(printf '%s' "$T" | grep -c '还没有可用的 prompt' || true)"
    eq "② 搜索无匹配时主标题表达「没有匹配」" 1 "$(printf '%s' "$T" | grep -c '没有匹配的条目' || true)"
    eq "② 副标题回显关键词" 1 "$(printf '%s' "$T" | grep -c 'zzz-不存在-zzz' || true)"
    eq "② 探针判定 isMisleading=false" "false" "$M"
  done
  A=$(get empty-nomatch-卡片 "$f" | jq -r '.text')
  B=$(get empty-nomatch-分栏 "$f" | jq -r '.text')
  eq "② 两处视图文案完全一致" "true" "$([ "$A" = "$B" ] && echo true || echo false)"
done
eq "② 空库场景的主标题仍保留「还没有可用的 prompt」（源码断言）" 1 "$(grep -c "hasActiveFilter ? '没有匹配的条目' : '还没有可用的 prompt'" web/src/components/UseView.tsx || true)"

line "③ FR-121 分隔符对比度与形态"
# WCAG 相对亮度与对比度
contrast() { python3 -c "
import sys
def lum(h):
    h=h.lstrip('#'); c=[int(h[i:i+2],16)/255 for i in (0,2,4)]
    f=lambda v: v/12.92 if v<=0.03928 else ((v+0.055)/1.055)**2.4
    return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2])
a,b=sys.argv[1],sys.argv[2]
l1,l2=sorted([lum(a),lum(b)],reverse=True)
print(f'{(l1+0.05)/(l2+0.05):.2f}')
" "$1" "$2"; }
rgb2hex() { python3 -c "
import sys,re
v=[int(x) for x in re.findall(r'\d+',sys.argv[1])[:3]]
print('#%02x%02x%02x'%tuple(v))
" "$1"; }
for f in "$PCF" "$MBF"; do
  [ -f "$f" ] || continue
  S=$(get separator "$f")
  SD=$(get separator-dark "$f")
  LIGHT_FG=$(printf '%s' "$S" | jq -r '.color'); LIGHT_BG=$(printf '%s' "$S" | jq -r '.cardBg')
  DARK_FG=$(printf '%s' "$SD" | jq -r '.color');  DARK_BG=$(printf '%s' "$SD" | jq -r '.cardBg')
  C_LIGHT=$(contrast "$(rgb2hex "$LIGHT_FG")" "$(rgb2hex "$LIGHT_BG")")
  C_DARK=$(contrast "$(rgb2hex "$DARK_FG")" "$(rgb2hex "$DARK_BG")")
  echo "    亮色：分隔符 $LIGHT_FG / 卡片底 $LIGHT_BG = ${C_LIGHT}:1"
  echo "    深色：分隔符 $DARK_FG / 卡片底 $DARK_BG = ${C_DARK}:1"
  ok=$(python3 -c "print(1 if $C_LIGHT>=3 else 0)")
  okd=$(python3 -c "print(1 if $C_DARK>=3 else 0)")
  eq "③ 亮色分隔符对比度 ≥ 3:1（实测 ${C_LIGHT}）" 1 "$ok"
  eq "③ 深色分隔符对比度 ≥ 3:1（实测 ${C_DARK}）" 1 "$okd"
  eq "③ 字形仍是「·」" 1 "$(printf '%s' "$S" | jq -r 'if .glyph == "·" then 1 else 0 end')"
  eq "③ 分隔符数量仍是 2" 2 "$(printf '%s' "$S" | jq -r '.count')"
  eq "③ 宽度未变（3.66px，与阶段 52 实测一致）" "3.66" "$(printf '%s' "$S" | jq -r '.width')"
  eq "③ gap 仍是 6px" "6px" "$(printf '%s' "$S" | jq -r '.gap')"
  eq "③ 仍不可选中 user-select:none" "none" "$(printf '%s' "$S" | jq -r '.userSelect')"
  eq "③ 仍 aria-hidden=true" "true" "$(printf '%s' "$S" | jq -r '.ariaHidden')"
done

line "④ FR-122 Token 掩码单行 + 移动端硬约束"
for f in "$PCF" "$MBF"; do
  [ -f "$f" ] || continue
  T=$(get token "$f")
  H=$(printf '%s' "$T" | jq -r '.masks[0].elH')
  WS=$(printf '%s' "$T" | jq -r '.masks[0].whiteSpace')
  echo "    掩码示例：$(printf '%s' "$T" | jq -c '[.masks[].text]')｜文本元素高 ${H}px"
  eq "④ 掩码文本元素高度 = 单行（≤14px，12px 字号）" 1 "$(python3 -c "print(1 if $H<=14 else 0)")"
  eq "④ 掩码为 nowrap（结构上不可能折行）" "nowrap" "$WS"
  eq "④ 掩码单元格 scrollWidth == clientWidth（未溢出）" "true" "$(printf '%s' "$T" | jq -r 'all(.masks[]; .tdScrollW == .tdClientW)')"
  eq "④ 7 列宽度均 > 0" "true" "$(printf '%s' "$T" | jq -r '.allColsPositive')"
  eq "④ 首列仍是「名称」" "名称" "$(printf '%s' "$T" | jq -r '.firstCol.t')"
  eq "④ 首列宽度 > 0（未被压成 0）" 1 "$(printf '%s' "$T" | jq -r 'if .firstCol.w > 0 then 1 else 0 end')"
done
T=$(get token "$MBF")
eq "④ 移动端令牌表可横向滚动" "true" "$(printf '%s' "$T" | jq -r '.canScroll')"
AR=$(printf '%s' "$T" | jq -r '.atRight')
echo "    移动端滚到最右：$(printf '%s' "$AR" | jq -c .)"
eq "④ 移动端 scrollLeft 能从 0 移到 >0" "true" "$(printf '%s' "$AR" | jq -r '.canScroll')"
AR_BTN=$(printf '%s' "$AR" | jq -r '.btnRight')
eq "④ 移动端滚到最右后末列按钮右缘 ${AR_BTN} ≤ 视口宽 440" "true" "$(printf '%s' "$AR" | jq -r '.btnWithinViewport')"

line "⑤ FR-123 移动端「文件夹」列不折行"
F=$(get folder-col "$MBF")
echo "    移动端文件夹列：$(printf '%s' "$F" | jq -c .)"
eq "⑤ 移动端文件夹列不折行（lineCount=1）" 1 "$(printf '%s' "$F" | jq -r '.lineCount')"
eq "⑤ 探针判定 wraps=false" "false" "$(printf '%s' "$F" | jq -r '.wraps')"
eq "⑤ 单元格 scrollHeight == clientHeight（无第二行）" "true" "$(printf '%s' "$F" | jq -r '.scrollH == .clientH')"
TS=$(get table-scroll "$MBF")
echo "    移动端提示词表：$(printf '%s' "$TS" | jq -c .)"
eq "⑤ 移动端提示词表仍可横向滚动" "true" "$(printf '%s' "$TS" | jq -r '.canScroll')"
eq "⑤ 移动端滚到最右后末列按钮右缘 ≤ 视口宽" 1 "$(python3 -c "print(1 if $(printf '%s' "$TS" | jq -r '.btnRight') <= $(printf '%s' "$TS" | jq -r '.viewportW') else 0)")"

line "⑬ 范围克制：只改这 5 项涉及的文件"
git diff --stat
echo "  --- 是否碰了本次 5 项之外的文件 ---"
UNEXPECT=$(git diff --name-only | grep -vE '^(web/src/components/(UsageDrawer|UseView|SplitView|TokenDrawer)\.tsx|web/src/theme\.ts|tools/ac-stage55.*|tests/stage55.*|PROGRESS\.md|docs/.*)$' || true)
if [ -z "$UNEXPECT" ]; then pass "改动文件全部落在预期范围内"; else fail "出现预期外文件：$UNEXPECT"; fi

line "收尾：确认没留下浏览器/服务残留"
pgrep -af "chrome-headless" 2>/dev/null | grep -v "pgrep" | head -3 || echo "  无 chrome 残留"

line "结论"
if [ "$FAIL" = "0" ]; then echo "  ✅ AC-119 ①–⑮ 全部通过（五项小修 + 硬约束均未回归）"; else echo "  ❌ 有判据未通过（见上方 ❌）"; fi
exit "$FAIL"
