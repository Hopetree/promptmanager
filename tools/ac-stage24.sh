#!/usr/bin/env bash
# 阶段 24 验收自检（FR-75 / D-30）：
#   AC-75 ①-③ 全部视图跨目录拖拽生效（真鼠标）+ 恰好 1 次 PATCH + 刷新保持
#   AC-75 ④   具体目录视图内拖拽 = 槽位保持（全量 sort_order 前后对照，其他条目完全不变、不顶到最前）
#   AC-75 ⑤   无静默忽略（拖拽路径上不存在"顺序不变 + 无请求 + 无提示"）
#   AC-75 ⑥   卡片本体可拖；单击仍选中、双击仍开详情
#   AC-75 ⑦⑧⑨ 手感回归 / 负例 400 / 分栏与表格档拖拽仍正常
#
# 服务**自起自停**（临时 DATA_DIR + 备用端口）；不碰 8767 测试环境。
set -u

cd "$(dirname "$0")/.." || exit 1
PORT=${PORT:-auto}
AC_PW='ac-fixture-pw-20260918'
AC_USER='admin'
SHOTS='docs/shots/stage24'
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
AC_DIR=$(mktemp -d /tmp/pm-ac24-XXXXXX)

# 直接读库拿全量 sort_order（AC-75 ④ 的核心证据；接口对象里没有这个字段）
dump_orders() {
  node -e '
const Database = require("better-sqlite3");
const db = new Database(process.argv[1], { readonly: true });
const rows = db.prepare("SELECT id, folder_id, sort_order FROM prompts ORDER BY sort_order ASC, id ASC").all();
console.log(JSON.stringify(rows));
db.close();
' "$AC_DIR/pm.db"
}

line "构建 / 类型检查 / 无 schema 变更"
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
eq "本阶段无迁移（migrations/ 仍是 3 个）" 3 "$(ls migrations/*.sql | wc -l)"

line "本阶段新增单测（槽位保持 + 前端源码）"
TEST_LOG="$AC_DIR/tests.log"
node --test tests/api-order.test.ts tests/stage24-ui.test.ts tests/stage23-ui.test.ts >"$TEST_LOG" 2>&1
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

    # AC-75 ①：同一视图内 ≥4 条分属 3 个目录（2 条在 A、1 条在 B、1 条未归类）
    FA=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"name":"AC24 A"}' "$BASE/api/folders" | jq -r .id)
    FB=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"name":"AC24 B"}' "$BASE/api/folders" | jq -r .id)
    mk() { python3 -c "
import json,sys
print(json.dumps({'title': sys.argv[1], 'user_prompt': sys.argv[2], 'system_prompt': 'S', 'notes': '备注', 'folder_id': (None if sys.argv[3] == '' else int(sys.argv[3]))}, ensure_ascii=False))
" "$1" "$2" "$3" | curl -s -b "$JAR" -H 'Content-Type: application/json' -d @- "$BASE/api/prompts" | jq -r .id; }
    A1=$(mk 'AC24 A1' '正文 A1' "$FA")
    A2=$(mk 'AC24 A2' '正文 A2' "$FA")
    B1=$(mk 'AC24 B1' '正文 B1' "$FB")
    L1=$(mk 'AC24 未归类' '正文 L1' '')
    pass "夹具：A1=$A1 A2=$A2（目录 A=$FA）/ B1=$B1（目录 B=$FB）/ 未归类=$L1"

    # 先建立非平凡全局顺序（模拟用户此前拖过）：L1, B1, A1, A2
    curl -s -b "$JAR" -X PATCH -H 'Content-Type: application/json' -d "{\"ids\":[$L1,$B1,$A1,$A2]}" -o /dev/null -w '  PATCH order（建初值）HTTP %{http_code}\n' "$BASE/api/prompts/order"
    pass "初始全量 sort_order：$(dump_orders)"

    rm -rf "$SHOTS"
    line "AC-75 ②③⑤⑥⑦：默认「全部」视图（跨目录）真鼠标拖拽"
    node tools/ac-stage24-probe.mjs card "$BASE" "$SID" "$SHOTS" | tee "$AC_DIR/card.log"
    v() { grep -m1 "^$1=" "$AC_DIR/card.log" | cut -d= -f2-; }
    pass "手柄：$(v ac75_handle)"
    eq "手柄热区 ≥24×24 且常显" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['w'] >= 24 and s['h'] >= 24 and s['visible'] else 'false')
" "$(v ac75_handle)")"
    eq "手柄有 title 提示" "按住拖动以调整顺序" "$(echo "$(v ac75_handle)" | jq -r .title)"
    pass "全部视图顺序（拖前）：$(v ac75_order_before)"
    pass "全部视图顺序（拖后）：$(v ac75_order_after)"
    eq "跨目录拖拽生效（顺序变化）" "true" "$(python3 -c "
import json,sys
print('true' if json.loads(sys.argv[1]) != json.loads(sys.argv[2]) else 'false')
" "$(v ac75_order_before)" "$(v ac75_order_after)")"
    eq "恰好 1 次 PATCH /api/prompts/order" "1" "$(python3 -c "print(int('$(v ac75_requests_after)') - int('$(v ac75_requests_before)'))")"
    eq "刷新后顺序保持" "$(v ac75_order_after)" "$(v ac75_order_after_reload)"
    pass "拖后提示文本：$(v ac75_messages)"
    eq "⑤ 无静默忽略（顺序已变 且 发过请求）" "true" "$(python3 -c "
import json,sys
changed = json.loads(sys.argv[1]) != json.loads(sys.argv[2]); req = int(sys.argv[3]) - int(sys.argv[4]) > 0
print('true' if changed and req else 'false')
" "$(v ac75_order_before)" "$(v ac75_order_after)" "$(v ac75_requests_after)" "$(v ac75_requests_before)")"
    eq "⑦ 未动项像素差 ≤1px" "true" "$(python3 -c "
import json,sys
before=json.loads(sys.argv[1]); after=json.loads(sys.argv[2]); ob=json.loads(sys.argv[3]); oa=json.loads(sys.argv[4])
stable=[('pm-drag-card-%d' % ob[i]) for i in range(min(len(ob), len(oa))) if ob[i] == oa[i]]
deltas={k: max(abs(before[k][f] - after[k][f]) for f in ('left','top','width','height')) for k in stable if k in before and k in after}
print('true' if all(d <= 1 for d in deltas.values()) else 'false')
" "$(v ac75_boxes_before)" "$(v ac75_boxes_after)" "$(v ac75_order_before)" "$(v ac75_order_after)")"
    eq "⑦ 行高不变" "$(v ac75_heights_before)" "$(v ac75_heights_before)"
    eq "⑦ 无横向溢出" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['scrollWidth'] <= s['clientWidth'] + 2 else 'false')
" "$(v ac75_scroll)")"
    pass "⑥ 本体拖拽：$(v ac75_body_before) → $(v ac75_body_after)（请求 $(v ac75_body_requests) 次）"
    eq "⑥ 拖卡片本体也能改变顺序" "true" "$(python3 -c "
import json,sys
print('true' if json.loads(sys.argv[1]) != json.loads(sys.argv[2]) else 'false')
" "$(v ac75_body_before)" "$(v ac75_body_after)")"
    eq "⑥ 本体拖拽也走同一接口（1 次）" "1" "$(v ac75_body_requests)"
    pass "⑥ 单击后卡片边框色：$(echo "$(v ac75_single_click)" | jq -r .selectedBorder)"
    pass "⑥ 双击后详情：$(v ac75_double_click)"
    eq "⑥ 双击打开详情（标题非空）" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['detailOpen'] and s['title'] != '' else 'false')
" "$(v ac75_double_click)")"
    eq "⑥ 单击/双击未改变顺序" "true" "$(v ac75_click_ids_unchanged)"
    eq "页面运行时异常（card）" "[]" "$(v ac23_runtime_errors)"

    line "AC-75 ④：具体目录视图内拖拽 = 槽位保持（全量 sort_order 前后对照）"
    BEFORE_ORDERS=$(dump_orders)
    pass "拖前全量 sort_order：$BEFORE_ORDERS"
    node tools/ac-stage24-probe.mjs folder "$BASE" "$SID" "$FA" "$SHOTS" | tee "$AC_DIR/folder.log"
    f() { grep -m1 "^$1=" "$AC_DIR/folder.log" | cut -d= -f2-; }
    AFTER_ORDERS=$(dump_orders)
    pass "拖后全量 sort_order：$AFTER_ORDERS"
    pass "目录视图内顺序：$(f ac75_folder_order_before) → $(f ac75_folder_order_after)"
    eq "目录视图内拖拽生效" "true" "$(python3 -c "
import json,sys
print('true' if json.loads(sys.argv[1]) != json.loads(sys.argv[2]) else 'false')
" "$(f ac75_folder_order_before)" "$(f ac75_folder_order_after)")"
    python3 - "$BEFORE_ORDERS" "$AFTER_ORDERS" "$FA" "$A1" "$A2" "$B1" "$L1" <<'PY'
import json, sys
before = {row['id']: row for row in json.loads(sys.argv[1])}
after = {row['id']: row for row in json.loads(sys.argv[2])}
fa, a1, a2, b1, l1 = (int(x) for x in sys.argv[3:8])
ok = True
# ① A 组两条只在原槽位之间交换
slots_before = sorted(before[i]['sort_order'] for i in (a1, a2))
slots_after = sorted(after[i]['sort_order'] for i in (a1, a2))
print(f"  A 组槽位：{slots_before} → {slots_after}")
ok &= slots_before == slots_after
# ② 其他目录条目完全不变
for i in (b1, l1):
    same = before[i]['sort_order'] == after[i]['sort_order']
    print(f"  其他条目 {i}: sort_order {before[i]['sort_order']} → {after[i]['sort_order']} {'✅不变' if same else '❌变了'}")
    ok &= same
# ③ 无重复
orders = [row['sort_order'] for row in json.loads(sys.argv[2])]
dup = len(orders) != len(set(orders))
print(f"  全量 sort_order 无重复：{'✅' if not dup else '❌ 有重复'}")
ok &= not dup
# ④ A 组没有被顶到全局最前：这组占据的**最小槽位不得变小**（若被顶到最前，槽位会变成 1..k 的更小值）
min_before = min(before[i]['sort_order'] for i in (a1, a2))
min_after = min(after[i]['sort_order'] for i in (a1, a2))
print(f"  A 组最小槽位：{min_before} → {min_after} {'✅未变小' if min_after >= min_before else '❌ 被顶到最前'}")
ok &= min_after >= min_before
print('RESULT', 'true' if ok else 'false')
PY
    eq "槽位保持（A 组只换槽位 / 其他不变 / 无重复 / 不顶到最前）" "true" "$(python3 - "$BEFORE_ORDERS" "$AFTER_ORDERS" "$FA" "$A1" "$A2" "$B1" "$L1" <<'PY'
import json, sys
before = {row['id']: row for row in json.loads(sys.argv[1])}
after = {row['id']: row for row in json.loads(sys.argv[2])}
fa, a1, a2, b1, l1 = (int(x) for x in sys.argv[3:8])
ok = sorted(before[i]['sort_order'] for i in (a1, a2)) == sorted(after[i]['sort_order'] for i in (a1, a2))
ok &= all(before[i]['sort_order'] == after[i]['sort_order'] for i in (b1, l1))
orders = [row['sort_order'] for row in json.loads(sys.argv[2])]
ok &= len(orders) == len(set(orders))
ok &= min(before[i]['sort_order'] for i in (a1, a2)) <= min(after[i]['sort_order'] for i in (a1, a2))
print('true' if ok else 'false')
PY
)"
    eq "④ 恰好 1 次 PATCH" "1" "$(python3 -c "print(int('$(f ac75_folder_requests_after)') - int('$(f ac75_folder_requests_before)'))")"
    # ④ 一致性：回「全部」视图的第一张，必须等于库里 sort_order 最小的那条（UI 顺序 == 落库顺序）
    FIRST_ID=$(jq -r '.[0].id' <<< "$AFTER_ORDERS")
    EXPECT_FIRST=$(python3 -c "m={$A1:'AC24 A1',$A2:'AC24 A2',$B1:'AC24 B1',$L1:'AC24 未归类'}; print(m[$FIRST_ID])")
    pass "④ 回「全部」视图：第一张 = $(f ac75_first_card_title)（拖前第一张 = $(f ac75_all_first_before)）"
    eq "④ UI 顺序与落库一致（第一张 = sort_order 最小的那条）" "$EXPECT_FIRST" "$(f ac75_first_card_title)"
    eq "页面运行时异常（folder）" "[]" "$(f ac23_runtime_errors)"

    line "AC-75 ⑧：接口负例（原样输出）"
    CODE1=$(curl -s -b "$JAR" -X PATCH -H 'Content-Type: application/json' -d "{\"ids\":[$A1,999999]}" -o "$AC_DIR/n1.json" -w '%{http_code}' "$BASE/api/prompts/order")
    echo "  不存在 id：HTTP $CODE1 $(cat "$AC_DIR/n1.json")"
    eq "不存在 id → 400" 400 "$CODE1"
    CODE2=$(curl -s -b "$JAR" -X PATCH -H 'Content-Type: application/json' -d "{\"ids\":[$A1,$A1]}" -o "$AC_DIR/n2.json" -w '%{http_code}' "$BASE/api/prompts/order")
    echo "  重复 id：HTTP $CODE2 $(cat "$AC_DIR/n2.json")"
    eq "重复 id → 400" 400 "$CODE2"
    CODE3=$(curl -s -b "$JAR" -X PATCH -H 'Content-Type: application/json' -d '{"ids":[]}' -o "$AC_DIR/n3.json" -w '%{http_code}' "$BASE/api/prompts/order")
    echo "  空 ids：HTTP $CODE3 $(cat "$AC_DIR/n3.json")"
    eq "空 ids → 400" 400 "$CODE3"

    line "AC-75 ⑨：分栏档与表格档拖拽仍正常"
    node tools/ac-stage24-probe.mjs other "$BASE" "$SID" "$SHOTS" | tee "$AC_DIR/other.log"
    o() { grep -m1 "^$1=" "$AC_DIR/other.log" | cut -d= -f2-; }
    pass "分栏档：$(o ac75_split_before) → $(o ac75_split_after)"
    eq "分栏档拖拽生效" "true" "$(python3 -c "
import json,sys
print('true' if json.loads(sys.argv[1]) != json.loads(sys.argv[2]) else 'false')
" "$(o ac75_split_before)" "$(o ac75_split_after)")"
    pass "表格档：$(o ac75_table_before) → $(o ac75_table_after)"
    eq "表格档拖拽生效" "true" "$(python3 -c "
import json,sys
print('true' if json.loads(sys.argv[1]) != json.loads(sys.argv[2]) else 'false')
" "$(o ac75_table_before)" "$(o ac75_table_after)")"
    eq "页面运行时异常（other）" "[]" "$(o ac23_runtime_errors)"

    line "截图（$SHOTS）"
    ls -l "$SHOTS" | sed 's/^/  /'
  fi
fi

line "结论"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ AC-75 全部通过"
else
  echo "  ❌ 有未通过项（见上方 ❌）"
fi
exit "$FAIL"
