#!/usr/bin/env bash
# 阶段 34 验收自检：
#   AC-92 分栏中栏在手机端撑满：① 390×844 `.pm-split-list` == 358 / right == 374（贴改前 276/292）
#        ② 与卡片/表格视图一致 ③ 无横向溢出 ④ 桌面不回归（宽度 + FR-71 比值 0.90–0.94 + 右栏在）
#        ⑤ 移动端行为（无 pm-split-detail / 点条目开抽屉 / 手柄与星标在）+ 390 亮暗截图
#   AC-93 README 用户化：① 结构断言（两种部署方式 + 负向 grep + 标题不重复）② 源码方式真跑
#        （Docker 方式由 host_manger 在 106/203 验证，本脚本只标注）③ 链接可达 ④ 迁移落点 ⑤ 用户视角
#   AC-94 移动端档位：① 移动顺序 ② 桌面顺序 ③ 默认按断点 ④ 不覆盖已有偏好 ⑤ 三档可切 ⑥ 回归
#
# 服务**自起自停**（临时 DATA_DIR + 台账范围内备用端口）；不碰 8767 测试环境、不碰 106 生产。
# 用法：bash tools/ac-stage34.sh [all|ui|readme|source]   ｜  SKIP_SOURCE=1 可跳过源码真跑（仅本地调试）
set -u
set -o pipefail

cd "$(dirname "$0")/.." || exit 1
ONLY=${1:-all}
PORT=${PORT:-auto}
AC_PW='ac-fixture-pw-20260918'
AC_USER='admin'
SHOTS='tmp/shots/stage34'
SPLIT_WIDTH_BEFORE=366   # FR-71 的改前基线（@1600 视口，阶段 21 实测）
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
py() { python3 -c "$@"; }

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
AC_DIR=$(mktemp -d /tmp/pm-ac34-XXXXXX)

# ============================================================ AC-92 / AC-94（运行时）
if [ "$ONLY" = "all" ] || [ "$ONLY" = "ui" ]; then
  line "AC-92 / AC-94：构建 + 新增单测"
  npm run build >"$AC_DIR/build.log" 2>&1
  eq "npm run build 退出码" 0 "$?"
  npm run typecheck:web >/dev/null 2>&1
  eq "npm run typecheck:web 退出码" 0 "$?"
  node --test tests/stage34-mobile-ui.test.ts tests/navigation-hygiene.test.ts >"$AC_DIR/unit.log" 2>&1
  eq "相关单测退出码" 0 "$?"
  grep -E "^ℹ (tests|pass|fail)" "$AC_DIR/unit.log" | sed 's/^/  /'

  line "运行时：临时实例（DATA_DIR=$AC_DIR，PORT=$PORT）"
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
    # 3 条 fixture（分栏列表要有条目可量、可点）
    for i in 1 2 3; do
      curl -s -b "$JAR" -H 'Content-Type: application/json' \
        -d "{\"title\":\"AC34 条目$i\",\"user_prompt\":\"正文$i\",\"notes\":\"备注$i\"}" "$BASE/api/prompts" >/dev/null
    done
    pass "夹具：3 条 prompt 已建（$AC_USER / 临时库）"
    rm -rf "$SHOTS"

    line "AC-92 / AC-94：真浏览器 + 真实像素（390×844 与 1600×900）"
    node tools/ac-stage34-probe.mjs mobile "$BASE" "$SID" "$SHOTS" | tee "$AC_DIR/probe.log"
    p() { grep -m1 "^$1=" "$AC_DIR/probe.log" | cut -d= -f2-; }

    # ---------- AC-92 ① 移动端 358 / right 374 ----------
    echo "  改前实测（host_manger，390×844）：.pm-split-list w=276 / right=292 / 容器 358 / 右侧空 82"
    pass "① 移动端像素：$(p ac92_mobile_rects)"
    eq "① 移动端 .pm-split-list 宽度 == 358" 358 "$(py "import json,sys; print(json.loads(sys.argv[1])['splitCard']['width'])" "$(p ac92_mobile_rects)")"
    eq "① 移动端 .pm-split-list right == 374" 374 "$(py "import json,sys; print(json.loads(sys.argv[1])['splitCard']['right'])" "$(p ac92_mobile_rects)")"
    eq "① 容器（pm-view-split）宽 == 358（可用宽度）" 358 "$(py "import json,sys; print(json.loads(sys.argv[1])['splitContainer']['width'])" "$(p ac92_mobile_rects)")"
    eq "① 右边缘与容器右边缘对齐（right == 容器 right == 374）" "true" "$(py "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['splitCard']['right'] == s['splitContainer']['right'] == 374 else 'false')
" "$(p ac92_mobile_rects)")"
    eq "① 不再是改前的 276/292" "true" "$(py "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['splitCard']['width'] != 276 and s['splitCard']['right'] != 292 else 'false')
" "$(p ac92_mobile_rects)")"

    # ---------- AC-92 ② 与卡片/表格视图一致 ----------
    echo "  对照表（同一 390 视口）：分栏中栏 $(py "import json,sys; print(json.loads(sys.argv[1])['splitCard'])" "$(p ac92_mobile_rects)")"
    echo "                            卡片视图 $(py "import json,sys; print(json.loads(sys.argv[1])['card'])" "$(p ac92_mobile_card_rects)")"
    echo "                            表格视图 $(py "import json,sys; print(json.loads(sys.argv[1])['table'])" "$(p ac92_mobile_table_rects)")"
    eq "② 三者内容区宽度都是 358" "true" "$(py "
import json,sys
a=json.loads(sys.argv[1])['splitCard']; b=json.loads(sys.argv[2])['card']; c=json.loads(sys.argv[3])['table']
print('true' if a['width']==b['width']==c['width']==358 else 'false')
" "$(p ac92_mobile_rects)" "$(p ac92_mobile_card_rects)" "$(p ac92_mobile_table_rects)")"
    eq "② 三者 right 都是 374" "true" "$(py "
import json,sys
a=json.loads(sys.argv[1])['splitCard']; b=json.loads(sys.argv[2])['card']; c=json.loads(sys.argv[3])['table']
print('true' if a['right']==b['right']==c['right']==374 else 'false')
" "$(p ac92_mobile_rects)" "$(p ac92_mobile_card_rects)" "$(p ac92_mobile_table_rects)")"

    # ---------- AC-92 ③ 无横向溢出 ----------
    eq "③ 390 视口下 documentElement.scrollWidth == 390" 390 "$(py "import json,sys; print(json.loads(sys.argv[1])['docScrollWidth'])" "$(p ac92_mobile_rects)")"
    eq "③ 切换三档后仍无横向溢出（三档 scrollWidth 都 == 390）" "true" "$(py "
import json,sys
ok = all(json.loads(sys.argv[i])['docScrollWidth'] == 390 for i in (1,2,3))
print('true' if ok else 'false')
" "$(p ac92_mobile_table_rects)" "$(p ac92_mobile_card_rects)" "$(p ac92_mobile_split_after_switch)")"

    # ---------- AC-92 ④ 桌面不回归 ----------
    pass "④ 桌面像素：$(p ac92_desktop_rects)"
    CARD_W=$(py "import json,sys; print(json.loads(sys.argv[1])['splitCard']['width'])" "$(p ac92_desktop_rects)")
    INNER_W=$(py "import json,sys; print(json.loads(sys.argv[1])['splitInner']['width'])" "$(p ac92_desktop_rects)")
    RATIO=$(py "print(round($INNER_W/$SPLIT_WIDTH_BEFORE, 4))")
    eq "④ 桌面中栏（.pm-split-list Card）宽度 == 350（clamp 上限，未回归）" 350 "$CARD_W"
    echo "  FR-71 口径：中栏**列表内容区** @1600 = ${INNER_W}px（改前基线 ${SPLIT_WIDTH_BEFORE}px）；比值 = ${INNER_W}/${SPLIT_WIDTH_BEFORE} = ${RATIO}"
    echo "  （stage 22 的 ac71 探针量的就是 [data-testid=\"pm-split-list\"] 这个内层元素 —— 与本探针 splitInner 是同一元素）"
    eq "④ 中栏/改前基线 比值 ∈ [0.90, 0.94]（FR-71 口径不变）" "true" "$(py "print('true' if 0.90 <= $RATIO <= 0.94 else 'false')")"
    eq "④ 桌面右栏（pm-detail）仍在且可见" "true" "$(py "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['detailPresent'] and s['detailVisible'] and s['detailWidth'] > 400 else 'false')
" "$(p ac92_desktop_rects)")"
    eq "④ 桌面无横向溢出" "true" "$(py "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['docScrollWidth'] <= s['docClientWidth'] + 2 else 'false')
" "$(p ac92_desktop_rects)")"

    # ---------- AC-92 ⑤ 移动端行为 ----------
    pass "⑤ 移动端行为：$(p ac92_mobile_behaviour)"
    eq "⑤ 移动端不渲染右栏（pm-split-detail 不在 DOM）" "true" "$(py "
import json,sys
s=json.loads(sys.argv[1]); print('true' if (not s['detailInDom']) and json.loads(sys.argv[2])['detailPresent'] is False else 'false')
" "$(p ac92_mobile_behaviour)" "$(p ac92_mobile_rects)")"
    eq "⑤ 3 条条目都渲染" 3 "$(py "import json,sys; print(json.loads(sys.argv[1])['items'])" "$(p ac92_mobile_behaviour)")"
    eq "⑤ 拖拽手柄与收藏星标都在" "true" "$(py "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['dragHandle'] and s['favStar'] else 'false')
" "$(p ac92_mobile_behaviour)")"
    eq "⑤ 点条目打开详情抽屉，且抽屉内容是该条目" "true" "$(py "
import json,sys
s=json.loads(sys.argv[1])
ok = s['drawerOpen'] and s['detailInDom'] and s['itemTitle'] is not None and s['itemTitle'] in (s['drawerText'] or '')
print('true' if ok else 'false')
" "$(p ac92_mobile_drawer)")"
    pass "⑤ 抽屉证据：$(p ac92_mobile_drawer)"
    eq "⑤ 暗色下中栏同样 358（截图 02）" 358 "$(py "import json,sys; print(json.loads(sys.argv[1])['splitCard']['width'])" "$(p ac92_mobile_dark_rects)")"

    # ---------- AC-94 ①② 顺序按断点 ----------
    pass "① 移动端档位顺序：$(p ac94_mobile_order)"
    eq "① 移动端档位文本依次为 卡片/表格/分栏" "true" "$(py "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['items'] == ['卡片','表格','分栏'] else 'false')
" "$(p ac94_mobile_order)")"
    pass "② 桌面档位顺序：$(p ac94_desktop_order)"
    eq "② 桌面档位文本依次为 分栏/表格/卡片（不得回归）" "true" "$(py "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['items'] == ['分栏','表格','卡片'] else 'false')
" "$(p ac94_desktop_order)")"
    eq "③ 档位恰好 3 个（未新增第四档）" "true" "$(py "
import json,sys
a=json.loads(sys.argv[1]); b=json.loads(sys.argv[2]); print('true' if a['segCount']==3 and b['segCount']==3 else 'false')
" "$(p ac94_mobile_order)" "$(p ac94_desktop_order)")"
    eq "⑤ 不存在 pm-view-list 锚点" "true" "$(py "
import json,sys
print('true' if json.loads(sys.argv[1])['hasList'] is False else 'false')
" "$(p ac94_mobile_order)")"

    # ---------- AC-94 ③ 默认档位按断点 ----------
    pass "③ 移动端默认：$(p ac94_mobile_default)"
    eq "③ 移动端清空偏好后默认落卡片（pm-view-card 在、pm-view-split 不在、存 'card'）" "true" "$(py "
import json,sys
s=json.loads(sys.argv[1])
print('true' if s['present'] == ['card'] and s['stored'] == 'card' and s['checked'] == '卡片' else 'false')
" "$(p ac94_mobile_default)")"
    pass "③ 桌面默认：$(p ac94_desktop_default)"
    eq "③ 桌面清空偏好后默认落分栏（pm-view-split 在、存 'split'）" "true" "$(py "
import json,sys
s=json.loads(sys.argv[1])
print('true' if s['present'] == ['split'] and s['stored'] == 'split' and s['checked'] == '分栏' else 'false')
" "$(p ac94_desktop_default)")"

    # ---------- AC-94 ④ 不覆盖已有偏好 ----------
    eq "④ 预置 table → 移动端落表格" "true" "$(py "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['present'] == ['table'] and s['stored'] == 'table' else 'false')
" "$(p ac94_mobile_pref_table)")"
    eq "④ 预置 table → 桌面也落表格" "true" "$(py "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['present'] == ['table'] and s['stored'] == 'table' else 'false')
" "$(p ac94_desktop_pref_table)")"

    # ---------- AC-94 ⑤ 移动端三档都可切 ----------
    eq "⑤ 点「表格」→ pm-view-table 出现" "true" "$(py "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['present'] == ['table'] else 'false')
" "$(p ac94_mobile_after_table)")"
    eq "⑤ 点「卡片」→ pm-view-card 出现" "true" "$(py "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['present'] == ['card'] else 'false')
" "$(p ac94_mobile_after_card)")"
    eq "⑤ 点「分栏」→ pm-view-split 出现" "true" "$(py "
import json,sys
s=json.loads(sys.argv[1]); print('true' if s['present'] == ['split'] else 'false')
" "$(p ac94_mobile_after_split)")"
    eq "⑤ 切档后分栏中栏仍是 358（AC-92 不回归）" 358 "$(py "import json,sys; print(json.loads(sys.argv[1])['splitCard']['width'])" "$(p ac92_mobile_split_after_switch)")"
    eq "页面运行时异常（390/1600 全程）" "[]" "$(p ac34_runtime_errors)"

    line "截图（$SHOTS）"
    ls -l "$SHOTS" | sed 's/^/  /'
    eq "⑤ 截图齐备（390 亮 / 390 暗 / 1600 亮 = 3）" 3 "$(find "$SHOTS" -name '*.png' | wc -l)"
  fi
fi

# ============================================================ AC-93（README 用户化）
if [ "$ONLY" = "all" ] || [ "$ONLY" = "readme" ]; then
  line "AC-93 ①：结构断言（两种部署方式 + 负向 grep + 标题不重复）"
  echo "  \$ grep -c '^## 代码质量检查' README.md   → $(grep -c '^## 代码质量检查' README.md)"
  echo "  \$ grep -c '^## 怎么验证' README.md       → $(grep -c '^## 怎么验证' README.md)"
  echo "  \$ grep -cE 'AC-[0-9]|FR-[0-9]|阶段 [0-9]+' README.md → $(grep -cE 'AC-[0-9]|FR-[0-9]|阶段 [0-9]+' README.md)"
  echo "  \$ grep -cE 'BRIEF|D-[0-9]+' README.md    → $(grep -cE 'BRIEF|D-[0-9]+' README.md)"
  eq "① 不再有 '## 代码质量检查' 节" 0 "$(grep -c '^## 代码质量检查' README.md)"
  eq "① 不再有 '## 怎么验证' 节" 0 "$(grep -c '^## 怎么验证' README.md)"
  eq "① README 无内部术语（AC-/FR-/阶段 N）" 0 "$(grep -cE 'AC-[0-9]|FR-[0-9]|阶段 [0-9]+' README.md)"
  eq "① README 无 BRIEF / D-xx" 0 "$(grep -cE 'BRIEF|D-[0-9]+' README.md)"
  eq "① 有 Docker 部署章节" 1 "$(grep -c '^## 部署方式 A：Docker' README.md)"
  eq "① 有源码部署章节" 1 "$(grep -c '^## 部署方式 B：源码运行' README.md)"
  DUP=$(python3 - <<'PY'
import collections, io, re
heads = re.findall(r'^## (.+)$', io.open('README.md', encoding='utf-8').read(), re.M)
dup = [h for h, c in collections.Counter(heads).items() if c > 1]
print('|'.join(dup) if dup else '')
PY
)
  eq "① 任意 '## ' 标题都不重复（重写顺带消除 backlog R-5）" "" "$DUP"

  line "AC-93 ③：README 里所有相对链接都指向真实存在的文件/目录"
  python3 - <<'PY' | sed 's/^/  /'
import io, os, re
raw = io.open('README.md', encoding='utf-8').read()
links = re.findall(r'\[([^\]]+)\]\(([^)]+)\)', raw)
rel = [(l, t) for l, t in links if not t.startswith(('http://', 'https://', '#'))]
missing = [(l, t) for l, t in rel if not os.path.exists(t.split('#')[0])]
for label, target in rel:
    print(('  ok   ' if os.path.exists(target.split('#')[0]) else '  FAIL ') + f'{label} → {target}')
print(f'相对链接 {len(rel)} 个，失效 {len(missing)} 个')
PY
  eq "③ 失效链接数" 0 "$(python3 - <<'PY'
import io, os, re
raw = io.open('README.md', encoding='utf-8').read()
rel = [t for _, t in re.findall(r'\[([^\]]+)\]\(([^)]+)\)', raw) if not t.startswith(('http://', 'https://', '#'))]
print(len([t for t in rel if not os.path.exists(t.split('#')[0])]))
PY
)"

  line "AC-93 ④：迁移落点（docs/development.md + docs/api.md + AGENTS.md 英文指引）"
  eq "④ docs/development.md 存在" 1 "$([ -f docs/development.md ] && echo 1 || echo 0)"
  eq "④ docs/api.md 存在" 1 "$([ -f docs/api.md ] && echo 1 || echo 0)"
  eq "④ development 承接「代码质量检查」" 1 "$(grep -c '^## 3. 代码质量检查' docs/development.md)"
  eq "④ development 承接「验证脚本清单」" 1 "$(grep -c '^### 验证脚本清单' docs/development.md)"
  eq "④ api 承接接口 curl 示例" 1 "$(grep -c 'curl -s -b /tmp/pm-jar' docs/api.md | head -1 | awk '{print ($1>0)?1:0}')"
  eq "④ api 承接 MCP 与 CLI 参考" "true" "$(python3 -c "
src = open('docs/api.md', encoding='utf-8').read()
print('true' if ('MCP server' in src and 'bin/pm.mjs' in src and 'pm-mcp.mjs' in src) else 'false')
")"
  eq "④ AGENTS.md 有英文指引指向这两份" "true" "$(python3 -c "
src = open('AGENTS.md', encoding='utf-8').read()
print('true' if ('Developer docs live in \`docs/development.md\`' in src and 'docs/api.md' in src) else 'false')
")"
  eq "④ AGENTS.md 仍是英文（无 CJK 正文行新增）" 1 "$(grep -c 'Developer docs live in' AGENTS.md)"

  line "AC-93 ⑤：用户视角抽查（README 不主推开发者命令）"
  eq "⑤ README 不出现 tools/ac-*.sh 作为主推命令" 0 "$(grep -c 'tools/ac-stage' README.md)"
  eq "⑤ README 不出现 ci-check.sh" 0 "$(grep -c 'ci-check.sh' README.md)"
  eq "⑤ README 不出现「已删除的能力」措辞（pm-view-list / 列表视图）" 0 "$(grep -c 'pm-view-list' README.md)"
  eq "⑤ README 提到三种视图（分栏/表格/卡片）" "true" "$(python3 -c "
src = open('README.md', encoding='utf-8').read()
print('true' if all(k in src for k in ['分栏', '表格', '卡片']) else 'false')
")"
fi

# ============================================================ AC-93 ② 源码方式真跑
if { [ "$ONLY" = "all" ] || [ "$ONLY" = "readme" ] || [ "$ONLY" = "source" ]; } && [ "${SKIP_SOURCE:-0}" != "1" ]; then
  line "AC-93 ②：源码方式真跑（在**临时目录**按 README 原样执行）"
  SRC_DIR=$(mktemp -d /tmp/pm-srcrun-XXXXXX)
  CACHE="$PWD/var/cache/npm"
  # 按 README「源码运行」一节原样：把仓库源码拷到临时目录（不含 node_modules/dist/tmp/var/data）
  ( cd "$PWD" && tar --exclude=./node_modules --exclude=./dist --exclude=./tmp --exclude=./var --exclude=./data \
      --exclude=./.git -cf - . ) | ( cd "$SRC_DIR" && tar -xf - )
  echo "  临时目录：$SRC_DIR（$(du -sh "$SRC_DIR" | cut -f1)）"
  SRC_PORT=$(python3 -c "
import socket
s=socket.socket(); s.bind(('127.0.0.1',0)); print(s.getsockname()[1]); s.close()
")
  (
    cd "$SRC_DIR" || exit 1
    set -e
    echo "  \$ npm ci --cache $CACHE"
    npm ci --cache "$CACHE" --no-audit --no-fund >"$SRC_DIR/npm-ci.log" 2>&1
    echo "  \$ npm run build"
    npm run build >"$SRC_DIR/build.log" 2>&1
    echo "  \$ npm run migrate"
    DATA_DIR="$SRC_DIR/data" npm run migrate 2>&1 | sed 's/^/    /'
    echo "  \$ printf '<pw>' | node bin/pm.mjs user set-password --username admin"
    printf '%s\n' "$AC_PW" | DATA_DIR="$SRC_DIR/data" node bin/pm.mjs user set-password --username admin | sed 's/^/    /'
    echo "  \$ DATA_DIR=<tmp>/data PORT=$SRC_PORT node dist/server/index.js &"
    DATA_DIR="$SRC_DIR/data" PORT="$SRC_PORT" node dist/server/index.js >"$SRC_DIR/server.log" 2>&1 &
    echo $! >"$SRC_DIR/pid"
    sleep 3
  ) && pass "源码方式：npm ci → build → migrate → 设口令 → 起服 全部 rc=0" || fail "源码方式执行失败（见 $SRC_DIR/*.log）"
  SRC_CODE=''
  for _ in $(seq 1 40); do
    SRC_CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$SRC_PORT/healthz" 2>/dev/null || true)
    [ "$SRC_CODE" = "200" ] && break
    sleep 0.3
  done
  echo "  \$ curl -s http://127.0.0.1:$SRC_PORT/healthz"
  curl -s "http://127.0.0.1:$SRC_PORT/healthz" | sed 's/^/    /'
  echo
  eq "② 源码方式 /healthz == 200" 200 "$SRC_CODE"
  eq "② /healthz 的 version 与 package.json 一致" "$(node -p "require('./package.json').version")" "$(curl -s "http://127.0.0.1:$SRC_PORT/healthz" | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])' 2>/dev/null)"
  echo "  \$ ss -ltn | grep -c ':$SRC_PORT'   # 端口已监听"
  ss -ltn | grep -c ":$SRC_PORT" | sed 's/^/  /'
  kill "$(cat "$SRC_DIR/pid" 2>/dev/null)" 2>/dev/null || true
  sleep 1
  rm -rf "$SRC_DIR"
  pass "② 收尾清理完成（临时目录已删、进程已停）"
  echo "  ⚠️ Docker 方式**不由本脚本验证**：228 上没有 Docker，按 BRIEF 分工由 host_manger 在 106/203 上"
  echo "     按 README「部署方式 A」原样真跑（docker pull → docker run → /healthz 200 → 清理）。"
fi

line "结论"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ AC-92 / AC-93 ①②③④⑤ / AC-94 全部通过（AC-93 ② 的 Docker 半由 host_manger 验证）"
else
  echo "  ❌ 有未通过项（见上方 ❌）"
fi
exit "$FAIL"
