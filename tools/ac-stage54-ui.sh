#!/usr/bin/env bash
# 阶段 54 · AC-118 B 段（FR-118）驱动脚本：**串行**跑 PC / 移动两批，**每界面查一次资源**，
# 触发熔断（available < 800MB 或 load1 > 20）即停手并如实报告。
#
# 资源纪律（BRIEF D-54 ②）：串行、单上下文、用完即关、结束复查无残留监听。
# 本脚本**不启动服务**（开发实例由调用者先起好），只跑浏览器探针。
#
# 用法：bash tools/ac-stage54-ui.sh <baseUrl> <sid> [输出目录]
set -u
cd "$(dirname "$0")/.." || exit 1
BASE=${1:?用法: ac-stage54-ui.sh <baseUrl> <sid> [outDir]}
SID=${2:?}
OUT=${3:-tmp/shots/stage54}
mkdir -p "$OUT"

MELT_AVAIL=800
MELT_LOAD=20

res_line() { free -m | awk 'NR==2{printf "%d", $7}'; }
load_line() { uptime | sed 's/.*load average: //' | cut -d, -f1 | tr -d ' '; }

check_melt() { # check_melt <where>
  local a l
  a=$(res_line); l=$(load_line)
  printf '    [资源] %s: available=%sMB load1=%s\n' "$1" "$a" "$l"
  if [ "$a" -lt "$MELT_AVAIL" ] || [ "${l%.*}" -ge "$MELT_LOAD" ]; then
    echo "  ⚠️ 熔断触发（阈值 available<${MELT_AVAIL}MB 或 load1>${MELT_LOAD}）—— 停止后续批次"
    return 1
  fi
  return 0
}

check_melt "开始前" || exit 1

for FORM in pc mobile; do
  echo ""
  echo "=== 批次：$FORM（$( [ "$FORM" = pc ] && echo '1440x900' || echo '440x956' )）==="
  node tools/ac-stage54-ui-probe.mjs "$BASE" "$SID" "$FORM" "$OUT" 2>&1 \
    | grep -E '^(SCENE|RES|DONE|FATAL|CLOSED)\|' | while IFS= read -r line; do
        echo "  $line"
        case "$line" in
          SCENE\|*) ;;
          RES\|*) ;;   # RES 行已含资源，外层再查一次更稳
        esac
      done
  # 批后熔断检查
  check_melt "${FORM} 批次后" || { echo "MELTDOWN"; break; }
  if [ -f "$OUT/_results-$FORM.json" ] && grep -q '"error"' "$OUT/_results-$FORM.json"; then
    echo "  ⚠️ $FORM 批次中途异常（见 _results-$FORM.json 的 error 字段）"
  fi
done

echo ""
echo "=== 截图清单 ==="
ls -la "$OUT"/*.png 2>/dev/null | awk '{print "  "$5" B  "$9}'
echo "PNG 总数: $(ls "$OUT"/*.png 2>/dev/null | wc -l)"
echo ""
echo "=== 收尾：确认本脚本没留下浏览器/服务残留 ==="
pgrep -af "chrome-headless" 2>/dev/null | head -5 || echo "  无 chrome 残留"
ss -lntp 2>/dev/null | grep -E ":(876[5-9]|877[0])\b" || echo "  8765-8770 无监听残留"
