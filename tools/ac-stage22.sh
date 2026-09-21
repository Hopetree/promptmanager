#!/usr/bin/env bash
# 阶段 22 验收自检：
#   AC-70 拖拽排序（卡片视图 + 文件夹树，真鼠标；含持久化、像素回归、接口负例）
#   AC-71 分栏中栏条目精简（标题 + 备注固定两行）+ 中栏宽度 -8%
#
# 服务**自起自停**（临时 DATA_DIR + 备用端口）；不碰 8767 测试环境。
# 用法：bash tools/ac-stage22.sh
set -u

cd "$(dirname "$0")/.." || exit 1
PORT=${PORT:-auto}
AC_PW='ac-fixture-pw-20260918'
AC_USER='admin'
SHOTS='tmp/shots/stage22'
SPLIT_WIDTH_BEFORE=366   # 阶段 21 实测（@1600 视口，见 PROGRESS §3）
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
AC_DIR=$(mktemp -d /tmp/pm-ac22-XXXXXX)

line "AC-70：依赖纪律（@dnd-kit pin 精确版本 + docs/dependencies.md 已登记 + OSV 0 漏洞）"
for p in "@dnd-kit/core" "@dnd-kit/sortable" "@dnd-kit/utilities" "@dnd-kit/modifiers"; do
  if grep -q "\"$p\": \"" package.json; then pass "package.json 已 pin $p = $(grep "\"$p\": \"" package.json | cut -d\" -f4)"; else fail "缺少依赖 $p"; fi
done
ge_dnd=$(grep -c '@dnd-kit/core' docs/dependencies.md)
if [ "$ge_dnd" -ge 1 ]; then pass "docs/dependencies.md 登记 @dnd-kit/core 出现 $ge_dnd 次"; else fail "docs/dependencies.md 未登记 @dnd-kit/core"; fi
eq "docs/dependencies.md 记录 OSV 结果" 1 "$(grep -c '@dnd-kit/core             6.3.1      osv_vulns=0' docs/dependencies.md)"
eq "不手写拖拽引擎（SortableList 无 mousemove 监听）" 0 "$(grep -c "addEventListener('mousemove'\|addEventListener(\"mousemove\"" web/src/components/SortableList.tsx)"
eq "中栏宽度已改为 -8% 档" 1 "$(grep -c "clamp(276px, 31.3%, 350px)" web/src/components/SplitView.tsx)"

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

line "本阶段新增单测（接口 / 迁移 / 前端源码）"
TEST_LOG="$AC_DIR/tests.log"
node --test tests/api-order.test.ts tests/migrate-prompt-order.test.ts tests/stage22-split-item.test.ts tests/stage22-drag.test.ts >"$TEST_LOG" 2>&1
eq "四个新测试文件退出码" 0 "$?"
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

    # 夹具：5 条 prompt（正文与备注明显不同；其中 1 条备注为空）+ 3 个根级文件夹
    mk() { # $1=标题 $2=正文 $3=备注
      python3 -c "
import json,sys
print(json.dumps({'title': sys.argv[1], 'user_prompt': sys.argv[2], 'system_prompt': 'S', 'notes': sys.argv[3]}, ensure_ascii=False))
" "$1" "$2" "$3" | curl -s -b "$JAR" -H 'Content-Type: application/json' -d @- "$BASE/api/prompts" >/dev/null
    }
    mk 'AC22 一' '【正文字符串甲】这一行只属于正文，绝不出现在备注里。' '备注一：这是第一条的备注文本。'
    mk 'AC22 二' '【正文字符串乙】正文二号，与备注不同。' '备注二：第二条备注。'
    mk 'AC22 三' '【正文字符串丙】正文三号。' '备注三：第三条备注，稍长一点点，用来看两行截断。'
    mk 'AC22 四' '【正文字符串丁】正文四号。' ''
    mk 'AC22 五' '【正文字符串戊】正文五号。' '备注五。'
    for name in 甲 乙 丙; do
      curl -s -b "$JAR" -H 'Content-Type: application/json' -d "{\"name\":\"AC22 夹$name\"}" "$BASE/api/folders" >/dev/null
    done
    pass "夹具：5 条 prompt（含 1 条空备注）+ 3 个根级文件夹"

    rm -rf "$SHOTS"
    node tools/ac-stage22-probe.mjs split "$BASE" "$SID" "$SHOTS" | tee "$AC_DIR/split.log"
    v() { grep -m1 "^$1=" "$AC_DIR/split.log" | cut -d= -f2-; }

    line "AC-71 ①②：条目只剩 标题 + 备注（固定两行），不再有元信息与正文摘要"
    pass "条目文本：$(v ac71_item_texts | jq -r '.[0]' | tr '\n' '⏎')"
    eq "元信息命中（v\\d / 取用 / 更新于 / 文件夹 / 变量）" '{"vVersion":0,"quYong":0,"gengXin":0,"folderName":0,"vars":0,"bodyLeak":false}' "$(v ac71_meta_hits)"
    pass "备注区度量：$(v ac71_notes_box)"
    eq "备注区两行截断" "2" "$(echo "$(v ac71_notes_box)" | jq -r .clamp)"
    le "备注区高度 ≈ 2 × lineHeight" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); lh=float(s['lineHeight'].replace('px','')); print(int(2*lh+1))
" "$(v ac71_notes_box)")" "$(echo "$(v ac71_notes_box)" | jq -r .height)"
    pass "空/非空备注条目等高：$(v ac71_equal_heights)"
    eq "空备注条目与有备注条目等高" "$(echo "$(v ac71_equal_heights)" | jq -r .withNotes)" "$(echo "$(v ac71_equal_heights)" | jq -r .withoutNotes)"
    eq "无横向滚动" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['scrollWidth'] <= s['clientWidth'] + 2 else 'false')
" "$(v ac71_scroll)")"

    line "AC-71 ③：中栏宽度 -8%（真实像素）"
    pass "宽度：$(v ac71_widths)（改前基线 ${SPLIT_WIDTH_BEFORE}px @1600）"
    NOW=$(echo "$(v ac71_widths)" | jq -r .list)
    RATIO=$(python3 -c "print(round($NOW/$SPLIT_WIDTH_BEFORE, 4))")
    pass "新宽/旧宽 = $NOW/$SPLIT_WIDTH_BEFORE = $RATIO"
    eq "比值 ∈ [0.90, 0.94]" "true" "$(python3 -c "print('true' if 0.90 <= $RATIO <= 0.94 else 'false')")"
    eq "右栏相应变宽（> 894px 的改前值）" "true" "$(python3 -c "print('true' if $(echo "$(v ac71_widths)" | jq -r .detail) > 894 else 'false')")"

    line "AC-71 ④⑥：单击切换右栏 / 卡片与表格视图未变"
    pass "单击切换：$(v ac71_click_switch)"
    eq "单击后右栏标题 = 被点条目" "true" "$(echo "$(v ac71_click_switch)" | jq -r '.clicked == .detailTitle')"
    pass "卡片视图特征：$(v ac71_card_features)"
    eq "卡片仍有正文摘要与元信息" '{"exists":true,"hasMeta":true,"hasExcerpt":true}' "$(echo "$(v ac71_card_features)" | jq -c '{exists,hasMeta,hasExcerpt}')"
    pass "表格视图特征：$(v ac71_table_features)"
    eq "表格仍有版本号与多行" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['exists'] and s['hasVersion'] and s['rows'] >= 4 else 'false')
" "$(v ac71_table_features)")"
    eq "页面运行时异常（split）" "[]" "$(v ac22_runtime_errors)"

    line "AC-70：真鼠标拖拽（卡片视图 + 文件夹树）"
    node tools/ac-stage22-probe.mjs drag "$BASE" "$SID" "$SHOTS" | tee "$AC_DIR/drag.log"
    w() { grep -m1 "^$1=" "$AC_DIR/drag.log" | cut -d= -f2-; }
    pass "拖拽手柄：$(w ac70_handle)"
    eq "手柄可见" "true" "$(echo "$(w ac70_handle)" | jq -r .visible)"
    eq "手柄热区 ≥24×24" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['w'] >= 24 and s['h'] >= 24 else 'false')
" "$(w ac70_handle)")"
    eq "手柄 cursor 可拖提示" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['cursor'] in ('grab','grabbing') else 'false')
" "$(w ac70_handle)")"
    pass "卡片顺序（拖前）：$(w ac70_order_before)"
    pass "卡片顺序（拖后）：$(w ac70_order_after)"
    eq "拖拽改变顺序" "true" "$(python3 -c "
import json,sys
print('true' if json.loads(sys.argv[1]) != json.loads(sys.argv[2]) else 'false')
" "$(w ac70_order_before)" "$(w ac70_order_after)")"
    eq "刷新后顺序保持（持久化）" "$(w ac70_order_after)" "$(w ac70_order_after_reload)"
    eq "排序下拉显示「自定义」" "自定义" "$(w ac70_sort_label)"
    eq "localStorage 记忆 pm-use-sort=custom" "custom" "$(w ac70_stored_sort)"

    line "AC-70 ④：排版回归（未被拖动条目像素差 ≤1px / 行高不变 / 无横向溢出）"
    DELTA=$(python3 -c "
import json,sys
before=json.loads(sys.argv[1]); after=json.loads(sys.argv[2]); order_before=json.loads(sys.argv[3]); order_after=json.loads(sys.argv[4])
def key_of(order, testid):
    return 'pm-drag-card-%d' % order[testid]
# 只比较"索引前后未变"的条目（被拖的那条以及因此让位的条目本来就该移动）
stable = [key_of(order_before, i) for i in range(min(len(order_before), len(order_after))) if order_before[i] == order_after[i]]
deltas = {k: max(abs(before[k][f] - after[k][f]) for f in ('left','top','width','height')) for k in stable if k in before and k in after}
print(json.dumps({'stable_items': stable, 'over_1px': {k: d for k, d in deltas.items() if d > 1}}, ensure_ascii=False))
" "$(w ac70_boxes_before)" "$(w ac70_boxes_after)" "$(w ac70_order_before)" "$(w ac70_order_after)")
    pass "像素差（位置未变的条目）：$DELTA"
    eq "位置未变条目 left/width/top/height 差 ≤1px" "{}" "$(echo "$DELTA" | jq -c .over_1px)"
    eq "行高/字号不变" "$(w ac70_line_heights_before)" "$(w ac70_line_heights_after)"
    eq "拖动全程无横向溢出" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['scrollWidth'] <= s['clientWidth'] + 2 else 'false')
" "$(w ac70_drag_scroll)")"

    line "AC-70 ⑤：文件夹树同层级拖拽 + 刷新保持"
    pass "文件夹顺序（拖前）：$(w ac70_folder_order_before)"
    pass "文件夹顺序（拖后）：$(w ac70_folder_order_after)"
    eq "文件夹顺序变化" "true" "$(python3 -c "
import json,sys
print('true' if json.loads(sys.argv[1]) != json.loads(sys.argv[2]) else 'false')
" "$(w ac70_folder_order_before)" "$(w ac70_folder_order_after)")"
    eq "刷新后文件夹顺序保持" "$(w ac70_folder_order_after)" "$(w ac70_folder_order_after_reload)"
    eq "拖拽确实调用了 PATCH /api/prompts/order" 1 "$(w ac70_prompt_order_requests)"
    eq "文件夹拖拽确实调用了 PATCH /api/folders/order" 1 "$(w ac70_folder_order_requests)"
    eq "页面运行时异常（drag）" "[]" "$(w ac22_runtime_errors)"

    line "AC-70 ⑥：接口负例（不存在的 id / 重复 id → 400，原样输出）"
    FIRST_ID=$(curl -s -b "$JAR" "$BASE/api/prompts?limit=1" | jq -r '.items[0].id')
    echo "  不存在的 id："
    CODE1=$(curl -s -b "$JAR" -X PATCH -H 'Content-Type: application/json' \
      -d "{\"ids\":[$FIRST_ID,999999]}" -o "$AC_DIR/neg1.json" -w '%{http_code}' "$BASE/api/prompts/order")
    echo "  HTTP $CODE1"; cat "$AC_DIR/neg1.json"; echo
    eq "不存在 id → 400" 400 "$CODE1"
    eq "错误码 error=invalid_body" '"invalid_body"' "$(jq -c .error "$AC_DIR/neg1.json")"
    echo "  重复 id："
    CODE2=$(curl -s -b "$JAR" -X PATCH -H 'Content-Type: application/json' \
      -d "{\"ids\":[$FIRST_ID,$FIRST_ID]}" -o "$AC_DIR/neg2.json" -w '%{http_code}' "$BASE/api/prompts/order")
    echo "  HTTP $CODE2"; cat "$AC_DIR/neg2.json"; echo
    eq "重复 id → 400" 400 "$CODE2"
    eq "错误码 error=invalid_body" '"invalid_body"' "$(jq -c .error "$AC_DIR/neg2.json")"
    echo "  文件夹跨父级："
    ROOT_ID=$(curl -s -b "$JAR" "$BASE/api/folders" | jq -r '.items[0].id')
    CHILD_ID=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d "{\"name\":\"AC22 子\",\"parent_id\":$ROOT_ID}" "$BASE/api/folders" | jq -r .id)
    CODE3=$(curl -s -b "$JAR" -X PATCH -H 'Content-Type: application/json' \
      -d "{\"parent_id\":null,\"ids\":[$ROOT_ID,$CHILD_ID]}" -o "$AC_DIR/neg3.json" -w '%{http_code}' "$BASE/api/folders/order")
    echo "  HTTP $CODE3"; cat "$AC_DIR/neg3.json"; echo
    eq "跨父级 → 400" 400 "$CODE3"
    eq "错误码 error=invalid_body" '"invalid_body"' "$(jq -c .error "$AC_DIR/neg3.json")"

    line "截图（$SHOTS）"
    ls -l "$SHOTS" | sed 's/^/  /'
  fi
fi

line "结论"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ AC-70 / AC-71 全部通过"
else
  echo "  ❌ 有未通过项（见上方 ❌）"
fi
exit "$FAIL"
