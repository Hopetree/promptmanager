#!/usr/bin/env bash
# 阶段 23 验收自检：
#   AC-72 文件夹筛选 = 含子目录（与侧栏计数一致）+ inclusive 视图下跨目录拖拽被忽略
#   AC-73 卡片视图：无标签卡片的「元信息+复制」行贴底（14px±1）、同网格行底边对齐
#   AC-74 表格视图拖拽（同一 @dnd-kit / 同一 PATCH 接口）+ 刷新感（乐观更新，无 loading 闪烁）
#
# 服务**自起自停**（临时 DATA_DIR + 备用端口）；不碰 8767 测试环境。
# 用法：bash tools/ac-stage23.sh
set -u

cd "$(dirname "$0")/.." || exit 1
PORT=${PORT:-auto}
AC_PW='ac-fixture-pw-20260918'
AC_USER='admin'
SHOTS='docs/shots/stage23'
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
AC_DIR=$(mktemp -d /tmp/pm-ac23-XXXXXX)

line "构建 / 类型检查 / 无新增依赖（FR-74 ④）"
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
eq "本阶段未新增依赖（dnd-kit 之外无新包）" 4 "$(node -e '
const pkg=require("./package.json");
console.log(Object.keys(pkg.dependencies).filter((n)=>n.startsWith("@dnd-kit")).length);
')"

line "本阶段新增单测"
TEST_LOG="$AC_DIR/tests.log"
node --test tests/api-folder-inclusive.test.ts tests/stage23-ui.test.ts >"$TEST_LOG" 2>&1
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

    jpost() { curl -s -b "$JAR" -H 'Content-Type: application/json' -d "$2" "$BASE/api/$1"; }
    A=$(jpost folders '{"name":"AC23 A"}' | jq -r .id)
    B=$(jpost folders "{\"name\":\"AC23 B\",\"parent_id\":$A}" | jq -r .id)
    C=$(jpost folders "{\"name\":\"AC23 C\",\"parent_id\":$B}" | jq -r .id)
    mk() { python3 -c "
import json,sys
print(json.dumps({'title': sys.argv[1], 'user_prompt': sys.argv[2], 'system_prompt': 'S', 'notes': '备注', 'folder_id': (None if sys.argv[3] == '' else int(sys.argv[3])), 'tags': json.loads(sys.argv[4])}, ensure_ascii=False))
" "$1" "$2" "$3" "$4" | curl -s -b "$JAR" -H 'Content-Type: application/json' -d @- "$BASE/api/prompts"; }
    PA=$(mk 'AC23 A 里的' '甲' "$A" '[]' | jq -r .id)
    PB=$(mk 'AC23 B 里的' '乙乙乙' "$B" '["T"]' | jq -r .id)
    PC=$(mk 'AC23 C 里的' '丙' "$C" '[]' | jq -r .id)
    mk 'AC23 未归类' '丁' '' '[]' >/dev/null
    # AC-73 夹具：同一网格行内 无标签 / 1 标签 / 3 标签（标题长度不同）
    mk 'AC23 卡片无标签' '正文甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲' '' '[]' >/dev/null
    mk 'AC23 卡片一标签' '正文乙' '' '["标签一"]' >/dev/null
    mk 'AC23 卡片三标签' '正文丙' '' '["标签一","标签二","标签三"]' >/dev/null
    pass "夹具：A>$B>$C 三层各 1 条 + 未归类 1 条 + 卡片三态 3 条（A=$A B=$B C=$C）"

    line "AC-72 ②③④⑥⑦⑧：接口侧原样输出（curl + jq）"
    for pair in "A:$A:3" "B:$B:2" "C:$C:1"; do
      name=${pair%%:*}; id=$(echo "$pair" | cut -d: -f2); want=$(echo "$pair" | cut -d: -f3)
      RESP=$(curl -s -b "$JAR" "$BASE/api/prompts?folder_id=$id&limit=200")
      IDS=$(echo "$RESP" | jq -c '[.items[].id] | sort')
      echo "  folder_id=$name($id) → total=$(echo "$RESP" | jq -r .total) items=$IDS"
      eq "folder_id=$name 的 total" "$want" "$(echo "$RESP" | jq -r .total)"
      eq "total == items 条数" "$(echo "$RESP" | jq -r .total)" "$(echo "$RESP" | jq -r '.items | length')"
    done
    eq "A 的 id 集合 = {PA,PB,PC}" "$(python3 -c "import json;print(json.dumps(sorted([$PA,$PB,$PC])))" | jq -c .)" "$(curl -s -b "$JAR" "$BASE/api/prompts?folder_id=$A&limit=200" | jq -c '[.items[].id] | sort')"
    echo "  组合筛选：tag=T / q=乙乙乙（LIKE）/ q=AC23 B（FTS）"
    eq "folder_id=A&tag=T → 1" 1 "$(curl -s -b "$JAR" "$BASE/api/prompts?folder_id=$A&tag=T&limit=200" | jq -r .total)"
    eq "folder_id=A&q=乙乙乙 → 1" 1 "$(curl -s -b "$JAR" --get --data-urlencode "q=乙乙乙" --data-urlencode "folder_id=$A" "$BASE/api/prompts" | jq -r .total)"
    eq "folder_id=A&q=AC23 B → 1" 1 "$(curl -s -b "$JAR" --get --data-urlencode "q=AC23 B" --data-urlencode "folder_id=$A" "$BASE/api/prompts" | jq -r .total)"
    P1=$(curl -s -b "$JAR" "$BASE/api/prompts?folder_id=$A&limit=2")
    echo "  分页：limit=2 → items=$(echo "$P1" | jq -r '.items|length') total=$(echo "$P1" | jq -r .total)；offset=2 → items=$(curl -s -b "$JAR" "$BASE/api/prompts?folder_id=$A&limit=2&offset=2" | jq -r '.items|length')"
    eq "分页 items=2" 2 "$(echo "$P1" | jq -r '.items|length')"
    eq "分页 total=3" 3 "$(echo "$P1" | jq -r .total)"
    eq "offset=2 items=1" 1 "$(curl -s -b "$JAR" "$BASE/api/prompts?folder_id=$A&limit=2&offset=2" | jq -r '.items|length')"
    MISS=$(curl -s -b "$JAR" -o "$AC_DIR/miss.json" -w '%{http_code}' "$BASE/api/prompts?folder_id=987654")
    echo "  不存在 id：HTTP $MISS $(cat "$AC_DIR/miss.json" | jq -c '{total,items}')"
    eq "不存在 id → 200" 200 "$MISS"
    eq "不存在 id → total=0" 0 "$(jq -r .total "$AC_DIR/miss.json")"
    eq "folder_id=abc → 400" 400 "$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' "$BASE/api/prompts?folder_id=abc")"

    line "AC-72 ⑤⑨：UI 侧（侧栏计数对账 + 跨目录拖拽生效，v31/D-30 修订）"
    node tools/ac-stage23-probe.mjs folder "$BASE" "$SID" "$A" "$B" "$C" "$SHOTS" | tee "$AC_DIR/folder.log"
    v() { grep -m1 "^$1=" "$AC_DIR/folder.log" | cut -d= -f2-; }
    eq "侧栏 A 计数徽标 = 3" "3" "$(v ac72_badge)"
    eq "点击 A 后列表条目数 = 3（与徽标逐字一致）" "$(v ac72_badge)" "$(v ac72_list_count)"
    # ⚠️ v31 / D-30 修订：D-29 的"inclusive 视图下仅同 folder_id 内生效"已作废（默认「全部」视图下等于全面禁用），
    # 故这里由"顺序不变 + 0 请求"反向改为"顺序变化 + 恰好 1 次请求"（不再有静默忽略）。
    eq "跨目录拖拽：顺序变化（D-30 起总是生效）" "true" "$(python3 -c "
import json,sys
print('true' if json.loads(sys.argv[1]) != json.loads(sys.argv[2]) else 'false')
" "$(v ac72_order_before)" "$(v ac72_order_after)")"
    eq "跨目录拖拽：恰好 1 次 PATCH /api/prompts/order" "1" "$(python3 -c "print(int('$(v ac72_order_requests_after)') - int('$(v ac72_order_requests_before)'))")"
    eq "页面运行时异常（folder）" "[]" "$(v ac23_runtime_errors)"

    line "AC-73：卡片底部行贴底（真实像素）"
    node tools/ac-stage23-probe.mjs card "$BASE" "$SID" "$SHOTS" | tee "$AC_DIR/card.log"
    c() { grep -m1 "^$1=" "$AC_DIR/card.log" | cut -d= -f2-; }
    pass "亮色度量：$(c ac73_light)"
    eq "三张卡片等高（两两差 ≤1px）" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); hs=[c['cardH'] for c in s['cards']]; print('true' if max(hs)-min(hs) <= 1 else 'false')
" "$(c ac73_light)")"
    eq "末行距卡片底边 ∈ [13,15]（三张都满足）" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); gs=[c['gap'] for c in s['cards']]; print('true' if all(13 <= g <= 15 for g in gs) else 'false')
" "$(c ac73_light)")"
    eq "无标签卡片内无空 Flex 占位" "0" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print(max(c['emptyFlex'] for c in s['cards']))
" "$(c ac73_light)")"
    eq "无标签卡片标签区高度 = 0" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); z=[c for c in s['cards'] if '无标签' in c['title']][0]; print('true' if z['tagsH'] == 0 else 'false')
" "$(c ac73_light)")"
    eq "网格列数 = 4（未回归）" "4" "$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['cols'])" "$(c ac73_light)")"
    eq "无横向溢出" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['scrollWidth'] <= s['clientWidth'] + 2 else 'false')
" "$(c ac73_light)")"
    eq "暗色下同样贴底" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); gs=[c['gap'] for c in s['cards']]; print('true' if all(13 <= g <= 15 for g in gs) else 'false')
" "$(c ac73_dark)")"
    eq "页面运行时异常（card）" "[]" "$(c ac23_runtime_errors)"

    line "AC-74：表格拖拽（真鼠标）+ 刷新感"
    node tools/ac-stage23-probe.mjs table "$BASE" "$SID" "$SHOTS" | tee "$AC_DIR/table.log"
    t() { grep -m1 "^$1=" "$AC_DIR/table.log" | cut -d= -f2-; }
    pass "改后表头/列宽/行高：$(t ac74_metrics_before)"
    pass "手柄：$(t ac74_handle)"
    eq "手柄热区 ≥24×24" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['w'] >= 24 and s['h'] >= 24 else 'false')
" "$(t ac74_handle)")"
    # 基线 = 阶段 23 之前的构建（git HEAD 的 worktree 重新构建后实测）：rowHeight 43 / headerHeight 38 / cols 见下
    eq "行高与改前一致（43px）" "43" "$(echo "$(t ac74_metrics_before)" | jq -r .rowHeight)"
    eq "表头高与改前一致（38px）" "38" "$(echo "$(t ac74_metrics_before)" | jq -r .headerHeight)"
    eq "列宽与改前一致（8 列实测像素）" "[301,183,123,83,94,106,155,275]" "$(echo "$(t ac74_metrics_before)" | jq -c .cols)"
    eq "表头文案与改前一致（未新增列）" '["标题","标签","文件夹","版本","变量数","取用次数","更新于","操作"]' "$(echo "$(t ac74_metrics_before)" | jq -c '[.heads[].text]')"
    pass "表格顺序（拖前）：$(t ac74_order_before)"
    pass "表格顺序（拖后）：$(t ac74_order_after)"
    eq "拖拽改变表格行顺序" "true" "$(python3 -c "
import json,sys
print('true' if json.loads(sys.argv[1]) != json.loads(sys.argv[2]) else 'false')
" "$(t ac74_order_before)" "$(t ac74_order_after)")"
    eq "一次拖拽只发 1 次 PATCH" "1" "$(python3 -c "print(int('$(t ac74_requests_after)') - int('$(t ac74_requests_before)'))")"
    eq "刷新后表格顺序保持" "$(t ac74_order_after)" "$(t ac74_order_after_reload)"
    eq "排序档显示「自定义」" "自定义" "$(t ac74_sort_label)"
    eq "AC-74 ③：拖后 500ms 内无骨架/空白（逐帧采样）" "true" "$(python3 -c "
import json,sys
raw=json.loads(sys.argv[1]); s=[json.loads(x) for x in raw]; ok=all(x['rows'] >= 3 and x['skeleton'] == 0 and x['loadingText'] is False for x in s); print('true' if ok else 'false')
" "$(t ac74_samples)")"
    pass "采样（前 3 帧）：$(t ac74_samples | jq -c '.[0:3]')"
    eq "AC-74 ③：未动行像素差 ≤1px" "true" "$(python3 -c "
import json,sys
before=json.loads(sys.argv[1]); after=json.loads(sys.argv[2]); ob=json.loads(sys.argv[3]); oa=json.loads(sys.argv[4])
stable=[ob[i] for i in range(min(len(ob), len(oa))) if ob[i] == oa[i]]  # 键 = 行 id（不是下标）
deltas={k: max(abs(before[k][f] - after[k][f]) for f in ('top','height','left','width')) for k in stable if k in before and k in after}
print('true' if all(d <= 1 for d in deltas.values()) else 'false')
" "$(t ac74_boxes_before)" "$(t ac74_boxes_after)" "$(t ac74_order_before)" "$(t ac74_order_after)")"
    eq "AC-74 ⑥：卡片档拖拽仍正常" "true" "$(python3 -c "
import json,sys
print('true' if json.loads(sys.argv[1]) != json.loads(sys.argv[2]) else 'false')
" "$(t ac74_card_order_before)" "$(t ac74_card_order_after)")"
    eq "AC-74 ⑥：分栏档拖拽仍正常" "true" "$(python3 -c "
import json,sys
print('true' if json.loads(sys.argv[1]) != json.loads(sys.argv[2]) else 'false')
" "$(t ac74_split_order_before)" "$(t ac74_split_order_after)")"
    eq "页面运行时异常（table）" "[]" "$(t ac23_runtime_errors)"

    line "截图（$SHOTS）"
    ls -l "$SHOTS" | sed 's/^/  /'
  fi
fi

line "结论"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ AC-72 / AC-73 / AC-74 全部通过"
else
  echo "  ❌ 有未通过项（见上方 ❌）"
fi
exit "$FAIL"
