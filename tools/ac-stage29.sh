#!/usr/bin/env bash
# 阶段 29 验收自检（FR-82 / FR-83 / AC-84 / AC-85）：
#   AC-84 表格批量 UI 细化：① 表头复选框三态（未选 / 半选 indeterminate / 全选打勾）② 与行内尺寸一致（≤1px）
#                            ③ 工具条底部→表头行顶部 ≥6px ④ 批量动作与"1 个请求"回归 ⑤ 三态截图
#   AC-85 详情页元信息行细化：① 备注→元信息 ≥12px 且 ≤ 元信息→页签 ② 长内容（长文件夹名 + 5 标签）不溢出、
#                            「+ 添加标签」不出面板 ③ 详情 chip 与左栏同名 chip 样式一致 ④ 改文件夹/增删标签回归 ⑤ 截图
#
# 服务**自起自停**（临时 DATA_DIR + 备用端口）；不碰 8767 测试环境。
# 用法：bash tools/ac-stage29.sh [all|bulk|meta]
set -u

cd "$(dirname "$0")/.." || exit 1
ONLY=${1:-all}
PORT=${PORT:-auto}
AC_PW='ac-fixture-pw-20260918'
AC_USER='admin'
SHOTS='docs/shots/stage29'
FAIL=0
# AC-85 ② 的长文件夹名（≥20 字）
LONG_FOLDER='AC29 超长文件夹名称用于换行保护验证ABC一二三四五六七八九十'

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
ge() { if python3 -c "import sys; sys.exit(0 if float(sys.argv[1]) >= float(sys.argv[2]) else 1)" "$2" "$3"; then pass "$1 = $2（≥ $3）"; else fail "$1 = $2（期望 ≥ $3）"; fi; }
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
AC_DIR=$(mktemp -d /tmp/pm-ac29-XXXXXX)

line "构建 / 类型检查 / 无 schema 变更 / 无新依赖"
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
eq "本阶段无新依赖（package.json/lock 未改）" "" "$(git diff --name-only package.json package-lock.json)"

line "本阶段新增单测（FR-82 / FR-83 前端源码级）"
TEST_LOG="$AC_DIR/tests.log"
node --test tests/stage29-ui.test.ts >"$TEST_LOG" 2>&1
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

    mkfolder() { curl -s -b "$JAR" -H 'Content-Type: application/json' -d "$(python3 -c "
import json,sys
print(json.dumps({'name': sys.argv[1]}, ensure_ascii=False))
" "$1")" "$BASE/api/folders" | jq -r .id; }
    mk() { python3 -c "
import json,sys
print(json.dumps({'title': sys.argv[1], 'user_prompt': sys.argv[2], 'system_prompt': sys.argv[3], 'notes': sys.argv[4], 'folder_id': (None if sys.argv[5] == '' else int(sys.argv[5])), 'tags': json.loads(sys.argv[6])}, ensure_ascii=False))
" "$1" "$2" "$3" "$4" "$5" "$6" | curl -s -b "$JAR" -H 'Content-Type: application/json' -d @- "$BASE/api/prompts" | jq -r .id; }

    # ---- AC-84 夹具：6 条（表格批量） ----
    B1=$(mk 'AC29 条目1' '正文 条目1' 'S' '备注 条目1' '' '[]')
    B2=$(mk 'AC29 条目2' '正文 条目2' 'S' '备注 条目2' '' '[]')
    B3=$(mk 'AC29 条目3' '正文 条目3' 'S' '备注 条目3' '' '[]')
    B4=$(mk 'AC29 条目4' '正文 条目4' 'S' '备注 条目4' '' '[]')
    B5=$(mk 'AC29 条目5' '正文 条目5' 'S' '备注 条目5' '' '[]')
    B6=$(mk 'AC29 条目6' '正文 条目6' 'S' '备注 条目6' '' '[]')
    # ---- AC-85 夹具：常规（1 文件夹 + 2 标签 + 备注） / 长内容（长文件夹名 + 5 标签 + 备注） ----
    FN=$(mkfolder 'AC29 常规目录')
    FL=$(mkfolder "$LONG_FOLDER")
    R1=$(mk 'AC29 常规夹具' '常规正文' 'S' '常规备注（用于层级间距测量）' "$FN" '["AC29甲","AC29乙"]')
    R2=$(mk 'AC29 长内容夹具' '长内容正文' 'S' '长内容备注' "$FL" '["AC29甲","AC29乙","AC29丙","AC29丁","AC29戊"]')
    # ---- AC-78 / AC-79 回归夹具（复用 ac-stage27-probe 的既有断言） ----
    FA=$(mkfolder 'AC27 甲目录')
    FB=$(mkfolder 'AC27 目标目录')
    curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"name":"AC27乙"}' "$BASE/api/tags" >/dev/null
    E1=$(mk 'AC27 条目1' '正文 条目1' 'S' '备注 条目1' "$FA" '[]')
    E2=$(mk 'AC27 条目2' '正文 条目2' 'S' '备注 条目2' "$FA" '[]')
    E3=$(mk 'AC27 条目3' '正文 条目3' 'S' '备注 条目3' '' '[]')
    E4=$(mk 'AC27 条目4' '正文 条目4' 'S' '备注 条目4' '' '[]')
    E5=$(mk 'AC27 条目5' '正文 条目5' 'S' '备注 条目5' '' '[]')
    E6=$(mk 'AC27 条目6' '正文 条目6' 'S' '备注 条目6' '' '[]')
    VAR=$(mk 'AC27 变量夹具' '你好 {{主机}}，请检查 {{项目}}。' '系统：{{角色}}' 'AC27 备注文本' "$FA" '["AC27甲"]')
    NOVAR=$(mk 'AC27 无变量' '## 没有变量的正文' '系统提示词内容' '无变量备注' '' '[]')
    pass "夹具：AC29 条目1..6=$B1,$B2,$B3,$B4,$B5,$B6 ｜ 常规=$R1(目录$FN) ｜ 长内容=$R2(目录$FL) ｜ AC27 回归=$E1..$E6,$VAR,$NOVAR ｜ 长目录名 ${#LONG_FOLDER} 字"

    rm -rf "$SHOTS"

    if [ "$ONLY" = "all" ] || [ "$ONLY" = "bulk" ]; then
      line "AC-84：表格批量 UI 细化（真鼠标 + 真实像素）"
      node tools/ac-stage29-probe.mjs bulk-ui "$BASE" "$SID" "$SHOTS" | tee "$AC_DIR/bulk-ui.log"
      b() { grep -m1 "^$1=" "$AC_DIR/bulk-ui.log" | cut -d= -f2-; }
      eq "① 未选：indeterminate 与 checked 皆无" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if (not s['indeterminateClass']) and (not s['checkedClass']) else 'false')
" "$(b ac84_state_none)")"
      eq "① 部分选中：半选态（ant-checkbox-indeterminate 或 aria-checked=mixed）" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['indeterminateClass'] or s['ariaChecked'] == 'mixed' else 'false')
" "$(b ac84_state_partial)")"
      pass "① 部分选中 DOM 证据：$(b ac84_state_partial)"
      # ①（对抗性补强）：半选态的**视觉覆写**必须真的生效（否则被 antd 运行时 CSS-in-JS 盖回"白底+小方块"，
      #   而 class 判据仍会假绿）—— 半选外框底色/边框 == 已勾选行；::after 是白色 8×2 横杠。
      eq "① 半选态视觉覆写生效（外框底色/边框 == 已勾选行 = 同一主色填充）" "true" "$(python3 -c "
import json,sys
p=json.loads(sys.argv[1]); c=json.loads(sys.argv[2])
print('true' if p['backgroundColor'] == c['backgroundColor'] and p['borderTopColor'] == c['borderTopColor'] else 'false')
" "$(b ac84_partial_style)" "$(b ac84_checked_row_style)")"
      pass "① 半选外框 computed：$(b ac84_partial_style)"
      pass "① 已勾选行 computed：$(b ac84_checked_row_style)"
      eq "① 半选横杠 = 白色 8×2（不是 antd 默认的小方块）" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1])
print('true' if s['afterWidth'] == '8px' and s['afterHeight'] == '2px' and s['afterBackground'] == 'rgb(255, 255, 255)' else 'false')
" "$(b ac84_partial_style)")"
      eq "① 全选：打勾且无 indeterminate" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['checkedClass'] and not s['indeterminateClass'] else 'false')
" "$(b ac84_state_all)")"
      eq "① 全选后当页全部勾选" "true" "$(python3 -c "
import json,sys
n=json.loads(sys.argv[1]); print('true' if n >= 6 else 'false')
" "$(b ac84_checked_after_all)")"
      eq "① 再点取消：两者皆无" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if (not s['indeterminateClass']) and (not s['checkedClass']) else 'false')
" "$(b ac84_state_none_again)")"
      eq "① 取消后 0 行勾选" "0" "$(b ac84_checked_after_none)"
      eq "② 表头与行内复选框尺寸差 ≤1px（宽/高）" "true" "$(python3 -c "
import json,sys
h=json.loads(sys.argv[1]); r=json.loads(sys.argv[2])
print('true' if abs(h['w']-r['w']) <= 1 and abs(h['h']-r['h']) <= 1 else 'false')
" "$(b ac84_header_box_rect)" "$(b ac84_row_box_rect)")"
      pass "② 表头复选框 rect：$(b ac84_header_box_rect)"
      pass "② 行内复选框 rect：$(b ac84_row_box_rect)"
      pass "② 表头 wrapper：$(b ac84_header_wrap_rect) ｜ 行内 wrapper：$(b ac84_row_wrap_rect)"
      GAP=$(python3 -c "
import json,sys
t=json.loads(sys.argv[1]); h=json.loads(sys.argv[2]); print(h['top'] - t['bottom'])
" "$(b ac84_toolbar_rect)" "$(b ac84_header_row_rect)")
      ge "③ 工具条底部 → 表头行顶部（px）" "$GAP" 6
      pass "③ 工具条 rect：$(b ac84_toolbar_rect) ｜ 表头行 rect：$(b ac84_header_row_rect)"
      eq "页面运行时异常（bulk-ui）" "[]" "$(b ac27_runtime_errors)"

      line "AC-84 ④：批量动作回归（沿用 AC-78 断言；真鼠标 + 请求计数）"
      node tools/ac-stage27-probe.mjs bulk "$BASE" "$SID" "$SHOTS/regression-ac27" | tee "$AC_DIR/ac78.log"
      r() { grep -m1 "^$1=" "$AC_DIR/ac78.log" | cut -d= -f2-; }
      eq "④ 批量收藏：2 条 favorite=true" "true" "$(python3 -c "
import json,sys
print('true' if json.loads(sys.argv[1])['favorite'] and json.loads(sys.argv[2])['favorite'] else 'false')
" "$(r ac78_favorite_p1)" "$(r ac78_favorite_p2)")"
      eq "④ 只发 1 个 POST /api/prompts/bulk（收藏）" "1" "$(r ac78_favorite_requests)"
      eq "④ 批量移动只发 1 个请求" "1" "$(r ac78_move_requests)"
      eq "④ 批量移动：2 条 folder_id = 目标目录" "true" "$(python3 -c "
import json,sys
t=int(sys.argv[1]); a=json.loads(sys.argv[2])['folder_id']; c=json.loads(sys.argv[3])['folder_id']
print('true' if a == t and c == t else 'false')
" "$(r ac78_folder_target)" "$(r ac78_move_p1)" "$(r ac78_move_p2)")"
      eq "④ 二次确认文本含条数与「不可恢复」" "true" "$(python3 -c "
import re,sys
t=re.sub(r'\s','',sys.argv[1]); print('true' if '2条' in t and '不可恢复' in t else 'false')
" "$(r ac78_delete_confirm_text)")"
      eq "④ 先取消不删 / 再确认删 2" "true" "$(python3 -c "
import sys
b=int(sys.argv[1]); c=int(sys.argv[2]); f=int(sys.argv[3]); print('true' if b == c and f == b - 2 else 'false')
" "$(r ac78_total_before)" "$(r ac78_total_after_cancel)" "$(r ac78_total_after_confirm)")"
      eq "④ 表头全选 → 当页全部选中" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['all'] and len(s['rows']) > 0 else 'false')
" "$(r ac78_select_all)")"
      eq "④ 行内操作 / 行拖拽手柄 / 分页 / 排序 / 搜索仍在" "true" "$(python3 -c "
import json,sys
r=json.loads(sys.argv[1]); print('true' if r['edit'] > 0 and r['del'] > 0 and r['copy'] > 0 and r['dragRow'] > 0 and r['pagination'] and r['sort'] and r['search'] else 'false')
" "$(r ac78_regression)")"
      eq "页面运行时异常（AC-78 回归）" "[]" "$(r ac27_runtime_errors)"
    fi

    if [ "$ONLY" = "all" ] || [ "$ONLY" = "meta" ]; then
      line "AC-85：详情页元信息行细化（真鼠标 + 真实像素 + 长内容夹具）"
      node tools/ac-stage29-probe.mjs meta-ui "$BASE" "$SID" "$SHOTS" | tee "$AC_DIR/meta-ui.log"
      m() { grep -m1 "^$1=" "$AC_DIR/meta-ui.log" | cut -d= -f2-; }
      pass "① 层级间距（常规夹具）：$(m ac85_spacing)"
      ge "① 备注行底部 → 元信息行顶部（px）" "$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['notesToMeta'])" "$(m ac85_spacing)")" 12
      eq "① 前者 ≤ 元信息行底部 → 字段页签行顶部" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['notesToMeta'] <= s['metaToFields'] else 'false')
" "$(m ac85_spacing)")"
      pass "② 长内容元信息行：$(m ac85_meta_long)"
      eq "② 长内容不横向溢出（scrollWidth ≤ clientWidth+2）" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['scrollWidth'] <= s['clientWidth'] + 2 else 'false')
" "$(m ac85_meta_long)")"
      eq "② 「+ 添加标签」仍在面板可视区内（right ≤ 面板 right+1）" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['addRight'] is not None and s['addRight'] <= s['panelRight'] + 1 else 'false')
" "$(m ac85_meta_long)")"
      eq "② 页面整体无横向溢出" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['docScrollWidth'] <= s['docClientWidth'] + 2 else 'false')
" "$(m ac85_meta_long)")"
      eq "② 长内容夹具确实含 5 个标签" "5" "$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['tagCount'])" "$(m ac85_meta_long)")"
      pass "③ chip 样式对比：$(m ac85_chip_style)"
      eq "③ 详情 chip 与左栏同名 chip 样式一致（backgroundColor / border / borderRadius）" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); d=s['detail']; k=s['sidebar']
print('true' if k is not None and d['backgroundColor'] == k['backgroundColor'] and d['border'] == k['border'] and d['borderRadius'] == k['borderRadius'] else 'false')
" "$(m ac85_chip_style)")"
      eq "页面运行时异常（meta-ui）" "[]" "$(m ac27_runtime_errors)"

      line "AC-85 ④：改文件夹 / 加标签 / 删标签 + 三处同源回归（沿用 AC-79 断言）"
      node tools/ac-stage27-probe.mjs detail-meta "$BASE" "$SID" "$SHOTS/regression-ac27" | tee "$AC_DIR/ac79.log"
      d() { grep -m1 "^$1=" "$AC_DIR/ac79.log" | cut -d= -f2-; }
      eq "④ 元信息行位置：备注行之下、字段页签之上" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s and s['afterNotes'] and s['beforeFields'] else 'false')
" "$(d ac79_meta)")"
      eq "④ 改文件夹落库 = 目标目录" "true" "$(python3 -c "
import json,sys
t=int(sys.argv[1]); v=json.loads(sys.argv[2])['folder_id']; print('true' if v == t else 'false')
" "$(d ac79_folder_target)" "$(d ac79_folder_after_move)")"
      eq "④ 再选「未归类」→ folder_id=null" "true" "$(python3 -c "import json,sys; print('true' if json.loads(sys.argv[1])['folder_id'] is None else 'false')" "$(d ac79_folder_after_unfiled)")"
      eq "④ 加标签 → 落库 tags 增加" "true" "$(python3 -c "
import json,sys
print('true' if 'AC27乙' in json.loads(sys.argv[1])['tags'] else 'false')
" "$(d ac79_tags_after_add)")"
      eq "④ 点 ✕ 删标签 → 落库 tags 减少" "true" "$(python3 -c "
import json,sys
a=len(json.loads(sys.argv[1])['tags']); c=len(json.loads(sys.argv[2])['tags']); print('true' if c == a - 1 else 'false')
" "$(d ac79_tags_after_add)" "$(d ac79_tags_after_remove)")"
      eq "④ 三处同源：表格行含标签" "true" "$(python3 -c "import sys; print('true' if 'AC27甲' in sys.argv[1] else 'false')" "$(d ac79_table_row)")"
      eq "④ 三处同源：卡片含标签" "true" "$(python3 -c "import sys; print('true' if 'AC27甲' in sys.argv[1] else 'false')" "$(d ac79_card_text)")"
      eq "④ 三处同源：编辑器标签一致" "true" "$(python3 -c "import sys; print('true' if 'AC27甲' in sys.argv[1] else 'false')" "$(d ac79_editor_tags)")"
      eq "④ 侧栏计数同步（甲目录 −1 / 目标目录 +1）" "true" "$(python3 -c "
import json,sys
before=json.loads(sys.argv[1]); after=json.loads(sys.argv[2])
def count(rows, name):
    for r in rows:
        if name in r:
            return int(r.strip().split(' ')[-1])
    return None
ok = count(after,'AC27 甲目录') == count(before,'AC27 甲目录') - 1
ok = ok and count(after,'AC27 目标目录') == count(before,'AC27 目标目录') + 1
print('true' if ok else 'false')
" "$(d ac79_sidebar_counts_before)" "$(d ac79_sidebar_counts)")"
      eq "页面运行时异常（AC-79 回归）" "[]" "$(d ac27_runtime_errors)"
    fi

    line "截图（$SHOTS）"
    ls -l "$SHOTS" | sed 's/^/  /'
  fi
fi

line "结论"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ AC-84 / AC-85 全部通过"
else
  echo "  ❌ 有未通过项（见上方 ❌）"
fi
exit "$FAIL"
