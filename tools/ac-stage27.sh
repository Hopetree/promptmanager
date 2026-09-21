#!/usr/bin/env bash
# 阶段 27 验收自检（FR-77 ~ FR-81 / AC-78 ~ AC-82）：
#   AC-78 表格批量操作（首列复选框 + 表头全选 + 工具条 + 批量收藏/移动/删除 + 二次确认；真鼠标 + 请求计数）
#   AC-79 分栏详情页「文件夹 + 标签」显示与修改（真鼠标 + 落库读数 + 侧栏计数同步）
#   AC-80 分栏详情页字段页签恰好 2 个（无「备注」页签）
#   AC-81 分栏详情页不再有「变量填值」区块（编辑器与复制弹窗保留）
#   AC-82 「变量填值对话框」(VarsDialog) 宽高各 +≥15%（真实像素；改前基线见 AC82_BASELINE_*）
#
# 服务**自起自停**（临时 DATA_DIR + 备用端口）；不碰 8767 测试环境。
# 用法：bash tools/ac-stage27.sh [all|bulk|detail|vars]
set -u

cd "$(dirname "$0")/.." || exit 1
ONLY=${1:-all}
PORT=${PORT:-auto}
AC_PW='ac-fixture-pw-20260918'
AC_USER='admin'
SHOTS='tmp/shots/stage27'
FAIL=0

# AC-82 改前基线（改 VarsDialog 之前用本脚本 vars 模式实测的真实像素；见 PROGRESS「阶段 27」）
AC82_BASELINE_W=${AC82_BASELINE_W:-640}
AC82_BASELINE_H=${AC82_BASELINE_H:-398}

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
AC_DIR=$(mktemp -d /tmp/pm-ac27-XXXXXX)

line "构建 / 类型检查 / 无 schema 变更 / 新增依赖"
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

line "本阶段新增单测（批量接口 + 前端源码）"
TEST_LOG="$AC_DIR/tests.log"
node --test tests/api-prompts-bulk.test.ts tests/stage27-ui.test.ts >"$TEST_LOG" 2>&1
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

    # ---- 夹具：2 个文件夹 + 1 个未使用标签 + 8 条 prompt（6 条批量 + 变量夹具 + 无变量） ----
    FA=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"name":"AC27 甲目录"}' "$BASE/api/folders" | jq -r .id)
    FB=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"name":"AC27 目标目录"}' "$BASE/api/folders" | jq -r .id)
    curl -s -b "$JAR" -H 'Content-Type: application/json' -d '{"name":"AC27乙"}' "$BASE/api/tags" >/dev/null
    mk() { python3 -c "
import json,sys
print(json.dumps({'title': sys.argv[1], 'user_prompt': sys.argv[2], 'system_prompt': sys.argv[3], 'notes': sys.argv[4], 'folder_id': (None if sys.argv[5] == '' else int(sys.argv[5])), 'tags': json.loads(sys.argv[6])}, ensure_ascii=False))
" "$1" "$2" "$3" "$4" "$5" "$6" | curl -s -b "$JAR" -H 'Content-Type: application/json' -d @- "$BASE/api/prompts" | jq -r .id; }
    E1=$(mk 'AC27 条目1' '正文 条目1' 'S' '备注 条目1' "$FA" '[]')
    E2=$(mk 'AC27 条目2' '正文 条目2' 'S' '备注 条目2' "$FA" '[]')
    E3=$(mk 'AC27 条目3' '正文 条目3' 'S' '备注 条目3' '' '[]')
    E4=$(mk 'AC27 条目4' '正文 条目4' 'S' '备注 条目4' '' '[]')
    E5=$(mk 'AC27 条目5' '正文 条目5' 'S' '备注 条目5' '' '[]')
    E6=$(mk 'AC27 条目6' '正文 条目6' 'S' '备注 条目6' '' '[]')
    VAR=$(mk 'AC27 变量夹具' '你好 {{主机}}，请检查 {{项目}}。' '系统：{{角色}}' 'AC27 备注文本（用于详情页标题下的纯文本行）' "$FA" '["AC27甲"]')
    NOVAR=$(mk 'AC27 无变量' '## 没有变量的正文' '系统提示词内容' '无变量备注' '' '[]')
    pass "夹具：条目1..6 = $E1,$E2,$E3,$E4,$E5,$E6 ｜ 变量夹具=$VAR ｜ 无变量=$NOVAR ｜ 甲目录=$FA ｜ 目标目录=$FB"

    rm -rf "$SHOTS"

    if [ "$ONLY" = "all" ] || [ "$ONLY" = "bulk" ]; then
      line "AC-78：表格批量操作（真鼠标 + 请求计数）"
      node tools/ac-stage27-probe.mjs bulk "$BASE" "$SID" "$SHOTS" | tee "$AC_DIR/bulk.log"
      b() { grep -m1 "^$1=" "$AC_DIR/bulk.log" | cut -d= -f2-; }
      eq "① 首列复选框（每行都有）" "true" "$(b ac78_has_selection_column)"
      eq "① 表头全选复选框" "true" "$(b ac78_header_checkbox)"
      eq "② 未选中时工具条不占位" "false" "$(b ac78_toolbar_before)"
      pass "② 勾选 3 条后的选中集合：$(b ac78_checked_3)"
      eq "② 恰好选中 3 条" "3" "$(python3 -c "import json,sys; print(len(json.loads(sys.argv[1])))" "$(b ac78_checked_3)")"
      eq "② 工具条文本含「已选择 3 项」" "true" "$(python3 -c "
import json,re,sys
t=json.loads(sys.argv[1]); print('true' if '已选择3项' in re.sub(r'\\s','',t['text']) else 'false')
" "$(b ac78_toolbar)")"
      eq "② 四个动作齐备（批量收藏/移动/删除/取消）" "true" "$(python3 -c "
import json,sys
t=json.loads(sys.argv[1]); print('true' if t['favorite'] and t['move'] and t['del'] and t['cancel'] and '批量收藏' in t['text'] and '批量移动' in t['text'] and '批量删除' in t['text'] and '取消' in t['text'] else 'false')
" "$(b ac78_toolbar)")"
      eq "③ 取消 → 选中清空 + 工具条消失" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if len(json.loads(s['checked'])) == 0 and s['toolbar'] is False else 'false')
" "$(b ac78_after_cancel)")"
      eq "④ 批量收藏：2 条 favorite=true" "true" "$(python3 -c "
import json,sys
print('true' if json.loads(sys.argv[1])['favorite'] and json.loads(sys.argv[2])['favorite'] else 'false')
" "$(b ac78_favorite_p1)" "$(b ac78_favorite_p2)")"
      eq "④ 只发 1 个 POST /api/prompts/bulk" "1" "$(b ac78_favorite_requests)"
      pass "④ 反馈文本：$(b ac78_favorite_messages)"
      eq "④ 批量操作后选中态清空" "[]" "$(b ac78_after_favorite_checked)"
      eq "⑤ 批量移动：2 条 folder_id = 目标目录" "true" "$(python3 -c "
import json,sys
target=int(sys.argv[1]); a=json.loads(sys.argv[2])['folder_id']; c=json.loads(sys.argv[3])['folder_id']
print('true' if a == target and c == target else 'false')
" "$(b ac78_folder_target)" "$(b ac78_move_p1)" "$(b ac78_move_p2)")"
      eq "⑤ 批量移动只发 1 个请求" "1" "$(b ac78_move_requests)"
      eq "⑤ 侧栏计数同步（目标目录 0→2，甲目录不变）" "true" "$(python3 -c "
import json,sys
before=json.loads(sys.argv[1]); after=json.loads(sys.argv[2])
def count(rows, name):
    for r in rows:
        if name in r:
            return r.strip().split(' ')[-1]
    return None
ok = count(before,'AC27 目标目录') == '0' and count(after,'AC27 目标目录') == '2'
ok = ok and count(before,'AC27 甲目录') == count(after,'AC27 甲目录')
print('true' if ok else 'false')
" "$(b ac78_sidebar_counts_before)" "$(b ac78_sidebar_counts)")"
      pass "⑤ 移动前第一条 folder_id：$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['folder_id'])" "$(b ac78_move_folder_before)")"
      eq "⑥ 二次确认文本含「2 条」与「不可恢复」" "true" "$(python3 -c "
import re,sys
t=re.sub(r'\\s','',sys.argv[1])
print('true' if '2条' in t and '不可恢复' in t else 'false')
" "$(b ac78_delete_confirm_text)")"
      eq "⑥ 先取消：未删除（total 不变）" "$(b ac78_total_before)" "$(b ac78_total_after_cancel)"
      eq "⑥ 再确认：已删 2 条（total −2）" "$(python3 -c "import sys; print(int(sys.argv[1]) - 2)" "$(b ac78_total_before)")" "$(b ac78_total_after_confirm)"
      eq "⑥ 被删条目 GET → 404" "404" "$(b ac78_deleted_404)"
      eq "⑦ 表头全选 → 当页全部选中" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['all'] and len(s['rows']) > 0 else 'false')
" "$(b ac78_select_all)")"
      eq "⑦ 全选计数文本 = 已选择 N 项" "true" "$(python3 -c "
import json,sys
print('true' if '已选择' in sys.argv[1] and '项' in sys.argv[1] else 'false')
" "$(b ac78_select_all_text)")"
      eq "⑧ 行内操作 / 行拖拽手柄 / 分页 / 排序 / 搜索仍在" "true" "$(python3 -c "
import json,sys
r=json.loads(sys.argv[1]); print('true' if r['edit'] > 0 and r['del'] > 0 and r['copy'] > 0 and r['dragRow'] > 0 and r['pagination'] and r['sort'] and r['search'] else 'false')
" "$(b ac78_regression)")"
      eq "页面运行时异常（bulk）" "[]" "$(b ac27_runtime_errors)"

      line "AC-78 ⑨：批量接口负例（原样输出）"
      CODE1=$(curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' -d "{\"action\":\"favorite\",\"ids\":[$E1,999999]}" -o "$AC_DIR/n1.json" -w '%{http_code}' "$BASE/api/prompts/bulk")
      echo "  不存在 id：HTTP $CODE1 $(cat "$AC_DIR/n1.json")"
      eq "不存在 id → 400" 400 "$CODE1"
      CODE2=$(curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' -d '{"action":"delete","ids":[]}' -o "$AC_DIR/n2.json" -w '%{http_code}' "$BASE/api/prompts/bulk")
      echo "  空 ids：HTTP $CODE2 $(cat "$AC_DIR/n2.json")"
      eq "空 ids → 400" 400 "$CODE2"
      CODE3=$(curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' -d "{\"action\":\"move\",\"ids\":[$E1],\"folder_id\":999999}" -o "$AC_DIR/n3.json" -w '%{http_code}' "$BASE/api/prompts/bulk")
      echo "  目标文件夹不存在：HTTP $CODE3 $(cat "$AC_DIR/n3.json")"
      eq "目标文件夹不存在 → 400" 400 "$CODE3"
    fi

    if [ "$ONLY" = "all" ] || [ "$ONLY" = "detail" ]; then
      line "AC-79：分栏详情页「文件夹 + 标签」显示与修改"
      node tools/ac-stage27-probe.mjs detail-meta "$BASE" "$SID" "$SHOTS" | tee "$AC_DIR/detail-meta.log"
      m() { grep -m1 "^$1=" "$AC_DIR/detail-meta.log" | cut -d= -f2-; }
      eq "① 元信息行存在且在备注行之下、字段页签之上" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s and s['afterNotes'] and s['beforeFields'] and s['folderSelect'] and s['addTag'] else 'false')
" "$(m ac79_meta)")"
      pass "① 元信息行文本：$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['text'])" "$(m ac79_meta)")"
      eq "① 含当前文件夹名与全部标签" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if 'AC27 甲目录' in s['text'] and 'AC27甲' in s['text'] else 'false')
" "$(m ac79_meta)")"
      eq "② 改文件夹：落库 folder_id = 目标目录" "$(m ac79_folder_target)" "$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['folder_id'])" "$(m ac79_folder_after_move)")"
      eq "② 侧栏计数同步（甲目录 −1，目标目录 +1）" "true" "$(python3 -c "
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
" "$(m ac79_sidebar_counts_before)" "$(m ac79_sidebar_counts)")"
      pass "② 反馈文本：$(m ac79_move_messages)"
      eq "② 再选「未归类」→ folder_id=null" "true" "$(python3 -c "import json,sys; print('true' if json.loads(sys.argv[1])['folder_id'] is None else 'false')" "$(m ac79_folder_after_unfiled)")"
      eq "③ 加标签 → 落库 tags 增加" "true" "$(python3 -c "
import json,sys
print('true' if 'AC27乙' in json.loads(sys.argv[1])['tags'] else 'false')
" "$(m ac79_tags_after_add)")"
      eq "④ 点 ✕ 删标签 → 落库 tags 减少" "true" "$(python3 -c "
import json,sys
a=len(json.loads(sys.argv[1])['tags']); c=len(json.loads(sys.argv[2])['tags']); print('true' if c == a - 1 else 'false')
" "$(m ac79_tags_after_add)" "$(m ac79_tags_after_remove)")"
      eq "⑤ 一致性：表格行显示标签" "true" "$(python3 -c "import sys; print('true' if 'AC27甲' in sys.argv[1] and '未归类' in sys.argv[1] else 'false')" "$(m ac79_table_row)")"
      eq "⑤ 一致性：卡片显示标签" "true" "$(python3 -c "import sys; print('true' if 'AC27甲' in sys.argv[1] else 'false')" "$(m ac79_card_text)")"
      eq "⑤ 一致性：编辑器标签一致" "true" "$(python3 -c "import sys; print('true' if 'AC27甲' in sys.argv[1] else 'false')" "$(m ac79_editor_tags)")"
      eq "⑤ 一致性：编辑器备注一致" "true" "$(python3 -c "import sys; print('true' if 'AC27 备注文本' in sys.argv[1] else 'false')" "$(m ac79_editor_notes)")"
      eq "⑥ 元信息行字号 < 标题" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if float(s['metaFontSize'].replace('px','')) < float(s['titleFontSize'].replace('px','')) else 'false')
" "$(m ac79_style)")"
      eq "⑥ 元信息行颜色为次级色（与标题不同）" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['metaColor'] != s['titleColor'] else 'false')
" "$(m ac79_style)")"
      eq "⑥ 窄屏（1100px）无横向溢出" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['scrollWidth'] <= s['clientWidth'] + 2 and s['metaPresent'] else 'false')
" "$(m ac79_narrow_scroll)")"
      eq "页面运行时异常（detail-meta）" "[]" "$(m ac27_runtime_errors)"

      line "AC-80：分栏详情页字段页签恰好两个"
      node tools/ac-stage27-probe.mjs detail-tabs "$BASE" "$SID" "$SHOTS" | tee "$AC_DIR/detail-tabs.log"
      t() { grep -m1 "^$1=" "$AC_DIR/detail-tabs.log" | cut -d= -f2-; }
      eq "① 页签恰好 2 个且文本 = 用户提示词 / 系统提示词" "true" "$(python3 -c "
import json,sys
t=json.loads(sys.argv[1]); print('true' if t == ['用户提示词','系统提示词'] else 'false')
" "$(t ac80_tabs)")"
      eq "② 文本为「备注」的页签计数 = 0" "0" "$(t ac80_notes_tab_count)"
      eq "③ 两个页签切换后 Markdown 渲染仍生效" "true" "$(python3 -c "
import sys
print('true' if len(sys.argv[1].strip()) > 0 and len(sys.argv[2].strip()) > 0 else 'false')
" "$(t ac80_user_render)" "$(t ac80_system_render)")"
      eq "④ 编辑器里的「备注」输入框仍在" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['present'] and s['textarea'] else 'false')
" "$(t ac80_editor_notes)")"
      eq "页面运行时异常（detail-tabs）" "[]" "$(t ac27_runtime_errors)"

      line "AC-81：分栏详情页不再有「变量填值」区块"
      node tools/ac-stage27-probe.mjs detail-vars "$BASE" "$SID" "$SHOTS" | tee "$AC_DIR/detail-vars.log"
      vv() { grep -m1 "^$1=" "$AC_DIR/detail-vars.log" | cut -d= -f2-; }
      eq "① 详情右栏不存在「变量填值」区块" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if not s['hasVariableBlock'] and not s['variablePanel'] else 'false')
" "$(vv ac81_detail)")"
      eq "② 「预览 / 源码」「版本历史」仍在" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['markdownPreview'] and s['previewToggle'] and s['versionHistory'] else 'false')
" "$(vv ac81_detail)")"
      eq "③ 编辑器里的变量面板仍可用" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['panel'] and '变量' in s['text'] else 'false')
" "$(vv ac81_editor_panel)")"
      eq "④ 复制含变量 prompt 仍弹填值对话框" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['present'] and s['preview'] and '请填写变量值' in s['title'] else 'false')
" "$(vv ac81_vars_dialog)")"
      eq "页面运行时异常（detail-vars）" "[]" "$(vv ac27_runtime_errors)"
    fi

    if [ "$ONLY" = "all" ] || [ "$ONLY" = "vars" ]; then
      line "AC-82：「变量填值对话框」(VarsDialog) 宽高各 +≥15%（真实像素）"
      node tools/ac-stage27-probe.mjs vars-size "$BASE" "$SID" "$SHOTS" | tee "$AC_DIR/vars.log"
      s() { grep -m1 "^$1=" "$AC_DIR/vars.log" | cut -d= -f2-; }
      eq "① 确认弹窗 = VarsDialog（复制含变量 prompt 触发）" "true" "$(python3 -c "
import json,sys
d=json.loads(sys.argv[1]); print('true' if d['dialogPresent'] and '请填写变量值' in d['title'] else 'false')
" "$(s ac82_dialog)")"
      pass "① 触发步骤：$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['trigger'])" "$(s ac82_dialog)")"
      NOW_W=$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['w'])" "$(s ac82_split)")
      NOW_H=$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['h'])" "$(s ac82_split)")
      pass "② 改前基线：${AC82_BASELINE_W}×${AC82_BASELINE_H} ｜ 改后：${NOW_W}×${NOW_H}"
      ge "② 宽度增幅" "$(python3 -c "print(round($NOW_W / $AC82_BASELINE_W, 4))")" 1.15
      ge "② 高度增幅" "$(python3 -c "print(round($NOW_H / $AC82_BASELINE_H, 4))")" 1.15
      eq "③ 弹窗内无横向溢出" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['scrollWidth'] <= s['clientWidth'] + 2 else 'false')
" "$(s ac82_split)")"
      eq "③ 变量输入区可见" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['inputs'] > 0 and s['inputsVisible'] else 'false')
" "$(s ac82_split)")"
      eq "④ 分栏 / 表格 / 卡片三档尺寸一致（同一组件）" "true" "$(python3 -c "
import json,sys
a=json.loads(sys.argv[1]); b=json.loads(sys.argv[2]); c=json.loads(sys.argv[3])
print('true' if a['w']==b['w']==c['w'] and a['h']==b['h']==c['h'] else 'false')
" "$(s ac82_split)" "$(s ac82_table)" "$(s ac82_card)")"
      eq "页面运行时异常（vars-size）" "[]" "$(s ac27_runtime_errors)"
    fi

    line "截图（$SHOTS）"
    ls -l "$SHOTS" | sed 's/^/  /'
  fi
fi

line "结论"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ AC-78 / AC-79 / AC-80 / AC-81 / AC-82 全部通过"
else
  echo "  ❌ 有未通过项（见上方 ❌）"
fi
exit "$FAIL"
