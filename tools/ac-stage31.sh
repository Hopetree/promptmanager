#!/usr/bin/env bash
# 阶段 31 验收自检（FR-85 / FR-86 / AC-87 / AC-88）：
#   AC-87 表格「标签」列加间距：① 相邻 <Tag> 水平间隙 ≥4px（贴 3 个间隙值）② 与卡片视图一致
#                               ③ 单元格不溢出 + 列宽未被撑破（前后对照）④ 单标签/无标签不受影响 ⑤ 截图
#   AC-88 版本保留策略（**数据层**）：① PUT 15 次后 COUNT(*) 恰好 10 ② 保留最新 10 个连号、最旧的已不存在
#                               ③ prompts.version_no 在保留集内 ④ 不重编号（逐字对照）
#                               ⑤ 回滚两态（存在 → 新版本仍 ≤10；被裁 → 404）⑥ 导入 15 版本 → ≤10
#                               ⑦ 边界（恰好 10 不删 / 第 11 个删最旧）⑧ 文案（版本面板 DOM + README）
#                               ⑨ 回归（版本列表 / diff / 回滚 / 导出导入 的既有 AC）
#
# 数据层断言**一律直接查库**（`sqlite3 "$AC_DIR/pm.db"`），不看界面、不看接口回包。
# 服务**自起自停**（临时 DATA_DIR + 台账范围内的备用端口）；不碰 8767 测试环境、不碰生产文件。
# 用法：bash tools/ac-stage31.sh [all|tags|retention]
# 注：`set -o pipefail` —— 探针通过 `| tee` 输出，缺了它探针崩溃会被 tee 的 0 退出码掩盖。
set -u
set -o pipefail

cd "$(dirname "$0")/.." || exit 1
ONLY=${1:-all}
PORT=${PORT:-auto}
AC_PW='ac-fixture-pw-20260918'
AC_USER='admin'
SHOTS='tmp/shots/stage31'
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
ge() { if python3 -c "import sys; sys.exit(0 if float(sys.argv[1]) >= float(sys.argv[2]) else 1)" "$2" "$3"; then pass "$1 = $2（≥ $3）"; else fail "$1 = $2（期望 ≥ $3）"; fi; }
le() { if python3 -c "import sys; sys.exit(0 if float(sys.argv[1]) <= float(sys.argv[2]) else 1)" "$2" "$3"; then pass "$1 = $2（≤ $3）"; else fail "$1 = $2（期望 ≤ $3）"; fi; }
contains() { case "$2" in *"$3"*) pass "$1（含「$3」）";; *) fail "$1：未找到「$3」，实际=$2";; esac; }

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
AC_DIR=$(mktemp -d /tmp/pm-ac31-XXXXXX)
DB="$AC_DIR/pm.db"

# 直查库（AC-88 的纪律要求：数据层断言必须直接查库）
q() { sqlite3 "$DB" "$1"; }
# 逐字对照用（TAB 分隔，保留正文里的空格/换行语义）
qlines() { sqlite3 -separator "$(printf '\t')" "$DB" "$1"; }
# 版本号列表（逗号分隔、升序）
vlist() { q "SELECT group_concat(version_no, ',') FROM (SELECT version_no FROM prompt_versions WHERE prompt_id=$1 ORDER BY version_no);"; }
vcount() { q "SELECT COUNT(*) FROM prompt_versions WHERE prompt_id=$1;"; }

line "构建 / 类型检查 / 无 schema 变更 / 无新依赖"
BUILD_LOG="$AC_DIR/build.log"
npm run build >"$BUILD_LOG" 2>&1
eq "npm run build 退出码" 0 "$?"
eq "构建输出里的 >500KB 告警数" 0 "$(grep -c 'larger than 500' "$BUILD_LOG")"
npm run typecheck:web >/dev/null 2>&1
eq "npm run typecheck:web 退出码" 0 "$?"
eq "本阶段无迁移（migrations/ 仍是 3 个）" 3 "$(ls migrations/*.sql | wc -l)"
eq "本阶段无新依赖（package.json/lock 未改）" "" "$(git diff --name-only package.json package-lock.json)"

line "本阶段新增单测（FR-85 前端源码级 + FR-86 数据层直查库）"
TEST_LOG="$AC_DIR/tests.log"
node --test tests/stage31-tags-ui.test.ts tests/stage31-versions-retention.test.ts >"$TEST_LOG" 2>&1
eq "新测试退出码" 0 "$?"
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

    mk() { python3 -c "
import json,sys
print(json.dumps({'title': sys.argv[1], 'user_prompt': sys.argv[2], 'system_prompt': sys.argv[3], 'notes': sys.argv[4], 'folder_id': None, 'tags': json.loads(sys.argv[5])}, ensure_ascii=False))
" "$1" "$2" "$3" "$4" "$5" | curl -s -b "$JAR" -H 'Content-Type: application/json' -d @- "$BASE/api/prompts" | jq -r .id; }
    putv() { python3 -c "
import json,sys
print(json.dumps({'user_prompt': sys.argv[1]}, ensure_ascii=False))
" "$2" | curl -s -b "$JAR" -H 'Content-Type: application/json' -X PUT -d @- "$BASE/api/prompts/$1" >/dev/null; }
    post() { curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -X POST "$BASE/api/prompts/$1/versions/$2/rollback"; }

    # ---- AC-87 夹具 ----
    # 短标签名（单字）保证「3 个标签」能在列内**同一行**排下 ⇒ 能按 AC 要求贴出**三个以上**间隙值；
    # 「多标签夹具」（7 个）用来验证 ≥3 个标签时的换行 / 不溢出 / 不撑破列宽。
    M=$(mk 'AC31 三标签夹具' '三标签正文' '' '' '["甲","乙","丙"]')
    MANY=$(mk 'AC31 多标签夹具' '多标签正文' '' '' '["甲","乙","丙","丁","戊","己","庚"]')
    S=$(mk 'AC31 单标签夹具' '单标签正文' '' '' '["甲"]')
    N=$(mk 'AC31 无标签夹具' '无标签正文' '' '' '[]')
    # ---- AC-88 夹具 ----
    V=$(mk 'AC31 版本夹具' '版本夹具正文' '' '' '[]')
    putv "$V" '版本夹具第二次'; putv "$V" '版本夹具第三次'
    P15=$(mk 'AC88 十五次更新' '初始正文' '' '' '[]')
    for i in $(seq 1 15); do putv "$P15" "更新$i"; done
    P14=$(mk 'AC88 共十五版' '初始正文' '' '' '[]')
    for i in $(seq 1 14); do putv "$P14" "更新$i"; done
    PNR=$(mk 'AC88 不重编号' '初始正文' '' '' '[]')
    P11=$(mk 'AC88 边界' '初始正文' '' '' '[]')
    PR=$(mk 'AC88 回滚两态' '初始正文' '' '' '[]')
    for i in $(seq 1 15); do putv "$PR" "更新$i"; done
    pass "夹具：AC87 三标签=$M 多标签=$MANY 单标签=$S 无标签=$N ｜ 版本夹具=$V ｜ AC88 P15=$P15 P14=$P14 PNR=$PNR P11=$P11 PR=$PR"

    rm -rf "$SHOTS"

    if [ "$ONLY" = "all" ] || [ "$ONLY" = "tags" ]; then
      line "AC-87：表格「标签」列间距（真鼠标 + 真实像素）"
      AC31_MULTI_ID="$M" node tools/ac-stage31-probe.mjs tags-ui "$BASE" "$SID" "$SHOTS" | tee "$AC_DIR/tags-ui.log"
      t() { grep -m1 "^$1=" "$AC_DIR/tags-ui.log" | cut -d= -f2-; }
      # ① 间隙值全部 ≥4px（贴原样 JSON：三标签行 + 多标签行，合起来 >3 个间隙值）
      pass "① 表格三标签单元格像素：$(t ac87_table_multi)"
      pass "① 表格多标签（7 标签）单元格像素：$(t ac87_table_many)"
      eq "① 三标签同一行（perLine=[3]，间隙数 = 2）" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['lineCount'] == 1 and s['tagCount'] == 3 and s['gapCount'] == 2 else 'false')
" "$(t ac87_table_multi)")"
      eq "① 所有相邻标签的水平间隙都 ≥4px（三标签 + 多标签合计 ≥3 个值）" "true" "$(python3 -c "
import json,sys
a=json.loads(sys.argv[1]); b=json.loads(sys.argv[2]); g=a['gaps']+b['gaps']
print('true' if len(g) >= 3 and all(x >= 4 for x in g) else 'false')
" "$(t ac87_table_multi)" "$(t ac87_table_many)")"
      eq "① 间隙恰好 = 4px（与卡片视图同一档；改前 = 0px）" "true" "$(python3 -c "
import json,sys
a=json.loads(sys.argv[1]); b=json.loads(sys.argv[2]); g=a['gaps']+b['gaps']
print('true' if g and all(x == 4 for x in g) else 'false')
" "$(t ac87_table_multi)" "$(t ac87_table_many)")"
      pass "① 全部间隙值：三标签 $(python3 -c "import json,sys; print(json.loads(sys.argv[1])['gaps'])" "$(t ac87_table_multi)") ｜ 多标签 $(python3 -c "import json,sys; print(json.loads(sys.argv[1])['gaps'])" "$(t ac87_table_many)")"
      # ② 与卡片视图一致
      pass "② 卡片多标签单元格像素：$(t ac87_card_multi)"
      eq "② 表格与卡片的标签间隙一致（同一 prompt 对照）" "true" "$(python3 -c "
import json,sys
t=json.loads(sys.argv[1]); c=json.loads(sys.argv[2])
print('true' if t['gaps'] and c['gaps'] and t['gaps'][0] == c['gaps'][0] >= 4 else 'false')
" "$(t ac87_table_multi)" "$(t ac87_card_multi)")"
      eq "② 卡片视图间隙 = 4px（未回归）" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if all(x == 4 for x in s['gaps']) else 'false')
" "$(t ac87_card_multi)")"
      # ③ 不溢出 + 列宽未被撑破（**前后对照**：改前基线 175px，由 tmp/stage31-before.sh 在 HEAD 的临时
      #    worktree 里实测得到；修复后必须仍 ≤ 基线 ⇒ 说明"内容换行而不是把列撑宽"）
      pass "③ 表头「标签」列 rect：$(t ac87_tag_header_rect)"
      eq "③ 多标签（7 个，会换行）单元格不横向溢出" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['scrollWidth'] <= s['clientWidth'] + 2 else 'false')
" "$(t ac87_table_many)")"
      eq "③ 多标签确实发生了换行（wrap 生效：行数 >1）" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['lineCount'] > 1 and s['tagCount'] == 7 else 'false')
" "$(t ac87_table_many)")"
      le "③ 标签列渲染宽度 ≤ 改前基线 175px（未被撑破）" "$(python3 -c "
import json,sys; print(json.loads(sys.argv[1])['width'])
" "$(t ac87_tag_header_rect)")" 175
      eq "③ 列宽与改前基线一致（175 → 175，配置的 width:128 只是下限提示）" 175 "$(python3 -c "
import json,sys; print(json.loads(sys.argv[1])['width'])
" "$(t ac87_tag_header_rect)")"
      eq "③ 页面整体无横向溢出" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['docScrollWidth'] <= s['docClientWidth'] + 2 else 'false')
" "$(t ac87_doc_overflow)")"
      # ④ 单标签 / 无标签不受影响
      pass "④ 单标签单元格：$(t ac87_table_single)"
      pass "④ 无标签单元格：$(t ac87_table_none)"
      pass "④ 四种行的 tr 高度对照：$(t ac87_row_heights)"
      eq "④ 单标签：恰好 1 个 Tag、无间隙可量、单元格不溢出" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['tagCount'] == 1 and s['gaps'] == [] and s['scrollWidth'] <= s['clientWidth'] + 2 else 'false')
" "$(t ac87_table_single)")"
      eq "④ 无标签：0 个 Tag 且容器 0×0（antd Flex 的 :empty ⇒ display:none，不占位、不撑高）" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1])
print('true' if s['tagCount'] == 0 and s['display'] == 'none' and s['containerRect']['width'] == 0 and s['containerRect']['height'] == 0 else 'false')
" "$(t ac87_table_none)")"
      eq "④ 无标签行与单标签行等高（标签区不改变行高）" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['none'] == s['single'] else 'false')
" "$(t ac87_row_heights)")"
      eq "页面运行时异常（tags-ui）" "[]" "$(t ac27_runtime_errors)"
    fi

    if [ "$ONLY" = "all" ] || [ "$ONLY" = "retention" ]; then
      line "AC-88 ① ② ③：PUT 15 次 ⇒ 库里恰好 10 个（sqlite3 直查）"
      echo "  \$ sqlite3 pm.db \"SELECT COUNT(*) FROM prompt_versions WHERE prompt_id=$P15;\""
      echo "  $(q "SELECT COUNT(*) FROM prompt_versions WHERE prompt_id=$P15;")"
      eq "① COUNT(*) 恰好 10" 10 "$(vcount "$P15")"
      echo "  \$ sqlite3 pm.db \"SELECT version_no ... ORDER BY version_no;\""
      echo "  $(vlist "$P15")"
      eq "② 保留的是最新 10 个连号 [7..16]（首版 v1 + 15 次 PUT = v1..v16）" "7,8,9,10,11,12,13,14,15,16" "$(vlist "$P15")"
      eq "② 最旧的 v1 已不存在" 0 "$(q "SELECT COUNT(*) FROM prompt_versions WHERE prompt_id=$P15 AND version_no=1;")"
      CUR=$(q "SELECT version_no FROM prompts WHERE id=$P15;")
      eq "③ prompts.version_no = 16" 16 "$CUR"
      eq "③ 当前版本在保留集合内" 1 "$(q "SELECT COUNT(*) FROM prompt_versions WHERE prompt_id=$P15 AND version_no=$CUR;")"
      eq "②（BRIEF 举例形态）建 + 14 次 PUT（共 15 版）⇒ 保留 [6..15]" "6,7,8,9,10,11,12,13,14,15" "$(vlist "$P14")"

      line "AC-88 ④：不重编号（裁剪前后重叠版本逐字对照）"
      for i in $(seq 1 9); do putv "$PNR" "更新$i"; done
      qlines "SELECT version_no, user_prompt FROM prompt_versions WHERE prompt_id=$PNR ORDER BY version_no;" >"$AC_DIR/nr-before.tsv"
      echo "  [裁剪前] version_no→正文：$(vlist "$PNR")"
      echo "  [裁剪前] 逐字：$(paste -sd' ' "$AC_DIR/nr-before.tsv")"
      for i in $(seq 10 15); do putv "$PNR" "更新$i"; done
      qlines "SELECT version_no, user_prompt FROM prompt_versions WHERE prompt_id=$PNR ORDER BY version_no;" >"$AC_DIR/nr-after.tsv"
      echo "  [裁剪后] version_no→正文：$(vlist "$PNR")"
      echo "  [裁剪后] 逐字：$(paste -sd' ' "$AC_DIR/nr-after.tsv")"
      eq "④ 裁剪前恰好 10 行且为 [1..10]" "1,2,3,4,5,6,7,8,9,10" "$(python3 -c "
import sys
print(','.join(str(int(l.split(chr(9))[0])) for l in open(sys.argv[1],encoding='utf-8') if l.strip()))
" "$AC_DIR/nr-before.tsv")"
      eq "④ 裁剪后 = [7..16]" "7,8,9,10,11,12,13,14,15,16" "$(python3 -c "
import sys
print(','.join(str(int(l.split(chr(9))[0])) for l in open(sys.argv[1],encoding='utf-8') if l.strip()))
" "$AC_DIR/nr-after.tsv")"
      eq "④ 不重编号：重叠版本（v7..v10）的 version_no→正文 逐字一致" "true" "$(python3 - "$AC_DIR/nr-before.tsv" "$AC_DIR/nr-after.tsv" <<'PY'
import sys
def load(p):
    out = {}
    for line in open(p, encoding='utf-8'):
        line = line.rstrip('\n')
        if not line:
            continue
        no, text = line.split('\t', 1)
        out[int(no)] = text
    return out
before, after = load(sys.argv[1]), load(sys.argv[2])
overlap = {k: v for k, v in before.items() if k in after}
print('true' if overlap and all(after[k] == v for k, v in overlap.items()) else 'false')
PY
)"

      line "AC-88 ⑦：边界 —— 恰好 10 个不删；第 11 个只删最旧的那个"
      for i in $(seq 1 9); do putv "$P11" "更新$i"; done
      eq "⑦ 恰好 10 个时不删（COUNT=10）" 10 "$(vcount "$P11")"
      eq "⑦ 此时列表 = [1..10]" "1,2,3,4,5,6,7,8,9,10" "$(vlist "$P11")"
      putv "$P11" '更新10'
      eq "⑦ 产生第 11 个后仍恰好 10 个" 10 "$(vcount "$P11")"
      eq "⑦ 只删了最旧的 v1（列表 = [2..11]）" "2,3,4,5,6,7,8,9,10,11" "$(vlist "$P11")"
      eq "⑦ v1 已不存在 / v11 已存在" "0/1" "$(q "SELECT COUNT(*) FROM prompt_versions WHERE prompt_id=$P11 AND version_no=1;")/$(q "SELECT COUNT(*) FROM prompt_versions WHERE prompt_id=$P11 AND version_no=11;")"

      line "AC-88 ⑤：回滚两态（已存在的版本 / 已被裁剪的版本）"
      eq "⑤ 前置：PR 有 15 次 PUT ⇒ 恰好 10 行 [7..16]" "7,8,9,10,11,12,13,14,15,16" "$(vlist "$PR")"
      RB1=$(post "$PR" 12)
      eq "⑤ 回滚到仍存在的 v12 → 200" 200 "$RB1"
      eq "⑤ 回滚后仍恰好 10 行" 10 "$(vcount "$PR")"
      eq "⑤ 回滚生成新版本（prompts.version_no = 17）" 17 "$(q "SELECT version_no FROM prompts WHERE id=$PR;")"
      eq "⑤ 回滚后的保留集 = [8..17]（只挤掉最旧的 v7）" "8,9,10,11,12,13,14,15,16,17" "$(vlist "$PR")"
      RB2=$(post "$PR" 1)
      eq "⑤ 回滚到已被裁剪掉的 v1 → 404（既有语义不变）" 404 "$RB2"
      eq "⑤ 404 那次没有改动版本表" "8,9,10,11,12,13,14,15,16,17" "$(vlist "$PR")"

      line "AC-88 ⑧：文案（版本面板 DOM + README）"
      node tools/ac-stage31-probe.mjs retention-ui "$BASE" "$SID" "$SHOTS" | tee "$AC_DIR/retention-ui.log"
      u() { grep -m1 "^$1=" "$AC_DIR/retention-ui.log" | cut -d= -f2-; }
      pass "⑧ 版本面板文案 DOM：$(u ac88_note_text)"
      eq "⑧ 版本面板存在且**可见**的「最多保留最近 10 个版本」文案" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1])
print('true' if s is not None and s['visible'] and '最多保留最近 10 个版本' in s['text'] else 'false')
" "$(u ac88_note_text)")"
      eq "⑧ 版本面板回归：切到「表格」视图后回滚入口仍在（真鼠标点 Segmented）" "true" "$(python3 -c "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['rollbackButtons'] > 0 and s['viewSwitcher'] and s['noteStillVisible'] else 'false')
" "$(u ac88_version_regression)")"
      pass "⑧ 切到表格视图后的回归证据：$(u ac88_version_regression)"
      echo "  \$ grep -n '最多保留最近 10 个版本' README.md"
      grep -n '最多保留最近 10 个版本' README.md | sed 's/^/  /'
      eq "⑧ README 写明保留策略" 1 "$(grep -c '最多保留最近 10 个版本' README.md)"
      eq "⑧ README 写明导入张力（以本 FR 为准）" 1 "$(grep -c '已知张力' README.md)"
      eq "页面运行时异常（retention-ui）" "[]" "$(u ac27_runtime_errors)"
    fi

    line "AC-88 ⑨：回归 —— 版本列表 / diff / 回滚 / 导出导入 的既有语义（真实 HTTP）"
    RG=$(mk 'AC31 回归夹具' '回归第一版' '' '' '[]')
    putv "$RG" '回归第二版'; putv "$RG" '回归第三版'
    eq "⑨ 版本列表升序含首版 [1,2,3]" "1,2,3" "$(vlist "$RG")"
    DIFF=$(curl -s -b "$JAR" "$BASE/api/prompts/$RG/diff?from=1&to=3" | jq -r .diff)
    contains "⑨ diff 含删除行" "$DIFF" '-回归第一版'
    contains "⑨ diff 含新增行" "$DIFF" '+回归第三版'
    eq "⑨ 回滚 v1 → 200 且生成 v4" 200 "$(post "$RG" 1)"
    eq "⑨ 回滚后 prompts.version_no = 4" 4 "$(q "SELECT version_no FROM prompts WHERE id=$RG;")"
    eq "⑨ 回滚后正文回到 v1" '回归第一版' "$(q "SELECT user_prompt FROM prompts WHERE id=$RG;")"
    eq "⑨ 越界 diff（v9）→ 400" 400 "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" "$BASE/api/prompts/$RG/diff?from=1&to=9")"

    # AC-10 往返一致性：**≤10 版**时导出 → 导入(replace) → 再导出必须逐字一致（本阶段不得回归）
    curl -s -b "$JAR" "$BASE/api/export" | jq 'del(.exported_at)' >"$AC_DIR/exp1.json"
    curl -s -b "$JAR" -H 'Content-Type: application/json' \
      -d "$(python3 -c "
import json,sys
data=json.load(open(sys.argv[1],encoding='utf-8'))
print(json.dumps({'mode':'replace','data':{**data,'exported_at':'2026-09-21T00:00:00.000Z'}}, ensure_ascii=False))
" "$AC_DIR/exp1.json")" "$BASE/api/import" | jq -c .
    curl -s -b "$JAR" "$BASE/api/export" | jq 'del(.exported_at)' >"$AC_DIR/exp2.json"
    eq "⑨ 导出 → 导入(replace) → 再导出 逐字一致（AC-10 未回归）" "same" "$(cmp -s "$AC_DIR/exp1.json" "$AC_DIR/exp2.json" && echo same || echo different)"
    eq "⑨ 往返后版本数不变（4 版 ≤10，不触发裁剪）" 4 "$(vcount "$RG")"

    line "AC-88 ⑨：既有版本 / 导入导出 单测复跑"
    REG_LOG="$AC_DIR/regression.log"
    node --test tests/api-versions.test.ts tests/api-import.test.ts tests/api-export.test.ts tests/cli-export.test.ts tests/api-prompts-crud.test.ts >"$REG_LOG" 2>&1
    eq "既有 AC 单测退出码" 0 "$?"
    grep -E "^ℹ (tests|pass|fail)" "$REG_LOG" | sed 's/^/  /'

    line "AC-88 ⑥：导入含 15 个版本的文件 → 最终 ≤10（放在最后：replace 会清库）"
    python3 - "$AC_DIR/import15.json" <<'PY'
import json, sys
versions = [
    {"version_no": i, "title": "AC88 导入夹具", "user_prompt": f"导入版{i}", "system_prompt": "", "notes": "",
     "created_at": "2026-09-21T00:00:00.000Z"}
    for i in range(1, 16)
]
data = {
    "app": "promptmanager", "schema_version": 1, "exported_at": "2026-09-21T00:00:00.000Z",
    "folders": [], "tags": [],
    "prompts": [{"id": 42, "title": "AC88 导入夹具", "user_prompt": "导入版15", "system_prompt": "", "notes": "",
                 "folder_id": None, "tags": [], "favorite": False,
                 "created_at": "2026-09-21T00:00:00.000Z", "updated_at": "2026-09-21T00:00:00.000Z",
                 "versions": versions}],
}
json.dump({"mode": "replace", "data": data}, open(sys.argv[1], "w", encoding="utf-8"), ensure_ascii=False)
print(f"  夹具文件：{sys.argv[1]}（该 prompt 含 {len(versions)} 个版本）")
PY
    IMP=$(curl -s -w '\n%{http_code}' -b "$JAR" -H 'Content-Type: application/json' -d @"$AC_DIR/import15.json" "$BASE/api/import")
    eq "⑥ 导入返回 200" 200 "$(printf '%s' "$IMP" | tail -1)"
    pass "⑥ 导入响应：$(printf '%s' "$IMP" | head -1)"
    echo "  \$ sqlite3 pm.db \"SELECT COUNT(*) FROM prompt_versions WHERE prompt_id=42;\""
    echo "  $(vcount 42)"
    eq "⑥ 导入 15 个版本后库里恰好 10 个" 10 "$(vcount 42)"
    eq "⑥ 保留最新 10 个 [6..15]（v1..v5 被裁）" "6,7,8,9,10,11,12,13,14,15" "$(vlist 42)"
    eq "⑥ prompts.version_no 仍 = 文件里的最大版本号 15" 15 "$(q "SELECT version_no FROM prompts WHERE id=42;")"
    eq "⑥ 导入后无任何 prompt 超过 10 个版本（全库不变式）" 0 "$(q "SELECT COUNT(*) FROM (SELECT prompt_id, COUNT(*) c FROM prompt_versions GROUP BY prompt_id HAVING c > 10);")"

    line "截图（$SHOTS）"
    ls -l "$SHOTS" | sed 's/^/  /'
    if [ "$ONLY" = "all" ]; then
      eq "⑤ 截图齐备（AC-87 三张 + AC-88 文案/表格两张 = 5）" 5 "$(find "$SHOTS" -name '*.png' | wc -l)"
    fi
  fi
fi

line "结论"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ AC-87 / AC-88 全部通过"
else
  echo "  ❌ 有未通过项（见上方 ❌）"
fi
exit "$FAIL"
