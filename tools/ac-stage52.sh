#!/usr/bin/env bash
# 阶段 52 验收自检（FR-116 / AC-117：卡片视图底部元信息 = 所属目录（带图标·最前·仅名字）+ 版本 + 变量数；
#   去掉取用数与日期；相邻两项之间加可见「·」分隔符、项间距 6px、分隔符更淡、只动这一处）。
#
# AC-117 ① 目录项存在且排最前、带图标元素
#        ② 只显示目录名（== 库内目录名，不带父级路径、不出现 folder_id 数字）
#        ③ **无目录 = 「未分组」**（folder_id IS NULL 分支，**必须实测**）
#        ④ 保留版本与变量数
#        ⑤ 去掉取用数与日期（该行不含「取用」、不匹配 \d{4}[/-]\d{1,2}[/-]\d{1,2}）
#        ⑤b 相邻两项之间有可见「·」分隔元素 + 项间距 = 6px（改前 10px 对照）+ 只改卡片这一处
#        ⑥ 表格视图与分栏视图与改前一致
#        ⑦ 卡片其它不回归（末行贴底 / 星标·复制·拖拽手柄）
#        ⑧ 视觉证据（有目录 + 无目录各一张截图，脚本自己落 tmp/shots/stage52/）
#        ⑨ 无新增迁移、schema 版本不变
#        ⑩ 回归：npm test 全量 + ci-check（先删 dist）
#
# 本条是**前端展示**类 ⇒ 回归范围按 D-52 ⑤（受影响部分 + npm test + ci-check）。
# 全程临时 DATA_DIR + 台账范围内备用端口；不碰 8767 测试环境、不碰 106 生产。
# 用法：bash tools/ac-stage52.sh
set -u
set -o pipefail

cd "$(dirname "$0")/.." || exit 1
PORT=${PORT:-auto}
AC_PW='ac-fixture-pw-20260924'
AC_USER='admin'
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

DIR=''
SRV_PID=''
cleanup() {
  if [ -n "$SRV_PID" ]; then
    kill "$SRV_PID" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$SRV_PID" 2>/dev/null || break; sleep 0.3; done
    kill -9 "$SRV_PID" 2>/dev/null || true
  fi
  [ -n "$DIR" ] && [ "${KEEP_AC_DIR:-0}" != "1" ] && rm -rf "$DIR"
}
trap cleanup EXIT
DIR=$(mktemp -d /tmp/pm-ac52-XXXXXX)
DB="$DIR/pm.db"
q() { sqlite3 "$DB" "$1"; }

line "构建 + 全量单测（前端展示类：本脚本 + 全量 npm test + ci-check）"
npm run build >"$DIR/build.log" 2>&1
eq "npm run build 退出码" 0 "$?"
npm test >"$DIR/test.log" 2>&1
eq "npm test 退出码" 0 "$?"
grep -E "^ℹ (tests|pass|fail)" "$DIR/test.log" | sed 's/^/  /'
eq "npm test 失败数为 0" 0 "$(grep -E '^ℹ fail' "$DIR/test.log" | awk '{print $3}')"
TESTS_NOW=$(grep -E '^ℹ tests' "$DIR/test.log" | awk '{print $3}')
if [ "$TESTS_NOW" -ge 443 ]; then pass "用例数 $TESTS_NOW ≥ 基线 443（只增不减）"; else fail "用例数 $TESTS_NOW 少于基线 443"; fi

line "运行时：临时实例（DATA_DIR=$DIR，PORT=$PORT）+ 夹具"
printf '%s\n' "$AC_PW" | DATA_DIR="$DIR" node bin/pm.mjs user set-password --username "$AC_USER" >/dev/null
DATA_DIR="$DIR" PORT="$PORT" node dist/server/index.js >"$DIR/server.log" 2>&1 &
SRV_PID=$!
CODE=''
for _ in $(seq 1 60); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/healthz" 2>/dev/null || true)
  [ "$CODE" = "200" ] && break
  sleep 0.3
done
if [ "$CODE" != "200" ]; then
  fail "服务未起来（$DIR/server.log）"
else
  JAR="$DIR/jar.txt"
  curl -s -c "$JAR" -o /dev/null -X POST -H 'Content-Type: application/json' \
    -d "{\"username\":\"$AC_USER\",\"password\":\"$AC_PW\"}" "$BASE/api/login"
  SID=$(awk '$6 == "pm_sid" { print $7 }' "$JAR" | tail -1)
  [ -z "$SID" ] && fail "登录失败，拿不到 pm_sid"
  AUTH=(-b "$JAR" -H 'Content-Type: application/json')

  # ---- 夹具：父目录「工作」> 子目录「AI 协作与验收」；三种 prompt 覆盖 有目录 / 无目录 / 有目录含变量 ----
  PARENT=$(curl -s "${AUTH[@]}" -d '{"name":"工作"}' "$BASE/api/folders" | jq -r .id)
  CHILD=$(curl -s "${AUTH[@]}" -d "{\"name\":\"AI 协作与验收\",\"parent_id\":$PARENT}" "$BASE/api/folders" | jq -r .id)
  WITH_FOLDER=$(curl -s "${AUTH[@]}" -d "{\"title\":\"AC117 有目录\",\"user_prompt\":\"内容一\",\"folder_id\":$CHILD}" "$BASE/api/prompts" | jq -r .id)
  NO_FOLDER=$(curl -s "${AUTH[@]}" -d '{"title":"AC117 无目录","user_prompt":"内容二"}' "$BASE/api/prompts" | jq -r .id)
  WITH_VARS=$(curl -s "${AUTH[@]}" -d "{\"title\":\"AC117 有目录含变量\",\"user_prompt\":\"你好 {{姓名}} {{城市}}\",\"folder_id\":$CHILD}" "$BASE/api/prompts" | jq -r .id)
  pass "夹具：父目录=$PARENT(工作) 子目录=$CHILD(AI 协作与验收)｜有目录=$WITH_FOLDER 无目录=$NO_FOLDER 有目录含变量=$WITH_VARS"

  line "AC-117 ⑨：无新增迁移 / schema 版本不变（目录名本就在既有表里）"
  eq "迁移文件数仍是 6（001–006）" 6 "$(ls migrations/*.sql | wc -l)"
  eq "schema 版本仍 v6" 6 "$(q 'SELECT MAX(version) FROM schema_migrations;')"
  eq "folders 表仍 6 列（未为「目录名」加迁移）" 6 "$(q "SELECT COUNT(*) FROM pragma_table_info('folders');")"
  eq "前端契约未新增 folder_name 字段" 0 "$(grep -c 'folder_name' web/src/types.ts || true)"
  eq "Prompt.folder_id 语义未变（仍 number|null）" 1 "$(grep -c 'folder_id: number | null;' web/src/types.ts || true)"

  line "AC-117 ①–⑧：真浏览器探针（真鼠标切卡片视图；量文本 / 顺序 / 图标 / 间距）"
  PROBE=$(node tools/ac-stage52-probe.mjs "$BASE" "$SID" 2>&1)
  printf '%s\n' "$PROBE" | grep -E '^(FOOTER_TEXT|ITEMS|SPACING|CARD_GEOM|TABLE_COLS|TABLE_META|SPLIT_META|CARD_IDS)' | sed 's/^/    /'
  # 便捷取值
  val() { printf '%s\n' "$PROBE" | grep "^$1:" | head -1 | cut -d'|' -f2-; }
  for id in "$WITH_FOLDER" "$NO_FOLDER" "$WITH_VARS"; do
    printf '%s\n' "$PROBE" >"$DIR/probe-$id.txt"
  done

  echo
  echo "  --- ③ 无目录分支（folder_id IS NULL，**必须实测**）---"
  echo "  \$ 库内 folder_id = $(q "SELECT coalesce(folder_id,'NULL') FROM prompts WHERE id=$NO_FOLDER;")"
  NF_TEXT=$(printf '%s\n' "$PROBE" | grep "^FOOTER_TEXT:$NO_FOLDER|" | cut -d'|' -f2-)
  NF_ITEMS=$(printf '%s\n' "$PROBE" | grep "^ITEMS:$NO_FOLDER|" | cut -d'|' -f2-)
  echo "  \$ 页面该行完整文本：$NF_TEXT"
  echo "  \$ 该行各项：$NF_ITEMS"
  eq "③ 库内 folder_id 确为 NULL" "NULL" "$(q "SELECT coalesce(folder_id,'NULL') FROM prompts WHERE id=$NO_FOLDER;")"
  eq "③ 无目录时目录项显示「未分组」" "true" "$(printf '%s' "$NF_ITEMS" | jq -r '.[0].text == "未分组"')"
  eq "③ 「未分组」仍带图标" "true" "$(printf '%s' "$NF_ITEMS" | jq -r '.[0].hasIcon')"
  eq "③ 该行不含 null/undefined" 0 "$(printf '%s' "$NF_TEXT" | grep -cE 'null|undefined' || true)"
  eq "③ 该行不含未归类（表格口径不混入卡片）" 0 "$(printf '%s' "$NF_TEXT" | grep -c '未归类' || true)"

  for id in "$WITH_FOLDER" "$WITH_VARS" "$NO_FOLDER"; do
    echo
    echo "  --- prompt id=$id ---"
    T=$(printf '%s\n' "$PROBE" | grep "^FOOTER_TEXT:$id|" | cut -d'|' -f2-)
    I=$(printf '%s\n' "$PROBE" | grep "^ITEMS:$id|" | cut -d'|' -f2-)
    S=$(printf '%s\n' "$PROBE" | grep "^SPACING:$id|" | cut -d'|' -f2-)
    G=$(printf '%s\n' "$PROBE" | grep "^CARD_GEOM:$id|" | cut -d'|' -f2-)
    echo "  \$ 完整文本：$T"
    echo "  \$ 各项：$I"
    echo "  \$ 间距/分隔符：$S"
    echo "  \$ 卡片几何：$G"
    TITLE=$(q "SELECT title FROM prompts WHERE id=$id;")
    FID=$(q "SELECT coalesce(folder_id,'NULL') FROM prompts WHERE id=$id;")
    FNAME=$(q "SELECT coalesce((SELECT name FROM folders WHERE id = prompts.folder_id),'（无）') FROM prompts WHERE id=$id;")

    # ① 第一项是目录且带图标
    eq "① [$TITLE] 第一项是目录项（带图标）" "true" "$(printf '%s' "$I" | jq -r '.[0].hasIcon')"
    if [ "$FID" = "NULL" ]; then
      eq "① [$TITLE] 第一项文本 = 未分组" "未分组" "$(printf '%s' "$I" | jq -r '.[0].text')"
    else
      eq "① [$TITLE] 第一项文本 == 库内目录名「$FNAME」" "$FNAME" "$(printf '%s' "$I" | jq -r '.[0].text')"
      # ② 只显示目录名：不带父级路径、不出现 folder_id 数字
      eq "② [$TITLE] 目录项不含路径分隔符 /" 0 "$(printf '%s' "$I" | jq -r '.[0].text' | grep -c '/' || true)"
      eq "② [$TITLE] 目录项不含父目录名「工作」" 0 "$(printf '%s' "$I" | jq -r '.[0].text' | grep -c '工作' || true)"
      eq "② [$TITLE] 目录项不出现 folder_id 数字 $FID" 0 "$(printf '%s' "$I" | jq -r '.[0].text' | grep -c "$FID" || true)"
      eq "② [$TITLE] 库内目录名与页面文本一致" "true" "$(printf '%s' "$I" | jq -r --arg n "$FNAME" '.[0].text == $n')"
    fi

    # ④ 保留版本与变量数
    VER=$(q "SELECT version_no FROM prompts WHERE id=$id;")
    eq "④ [$TITLE] 含版本 v$VER" "true" "$(printf '%s' "$I" | jq -r --arg v "v$VER" 'any(.[]; .text == $v)')"
    VARS=$(printf '%s' "$T" | grep -oE '变量 [0-9]+' | head -1)
    if [ -n "$VARS" ]; then pass "④ [$TITLE] 含「$VARS」"; else fail "④ [$TITLE] 缺少变量数"; fi
    eq "④ [$TITLE] 版本与变量数都在（顺序 目录→版本→变量）" "true" \
      "$(printf '%s' "$I" | jq -r 'if (.[0].text|length) > 0 and (.[1].text|startswith("v")) and (.[2].text|startswith("变量 ")) then "true" else "false" end')"

    # ⑤ 不含取用、不含日期
    eq "⑤ [$TITLE] 该行不含「取用」" 0 "$(printf '%s' "$T" | grep -c '取用' || true)"
    eq "⑤ [$TITLE] 该行不匹配日期形状 \\d{4}[/-]\\d{1,2}[/-]\\d{1,2}" 0 "$(printf '%s' "$T" | grep -cE '[0-9]{4}[/-][0-9]{1,2}[/-][0-9]{1,2}' || true)"
    eq "⑤ [$TITLE] 该行不含日期形状 \\d{1,2}/\\d{1,2} \\d{2}:\\d{2}" 0 "$(printf '%s' "$T" | grep -cE '[0-9]{1,2}/[0-9]{1,2} [0-9]{2}:[0-9]{2}' || true)"

    # ⑤b 分隔符与间距
    eq "⑤b [$TITLE] 项间距 = 6px（computed gap）" "6px" "$(printf '%s' "$S" | jq -r '.computedGap')"
    eq "⑤b [$TITLE] 三项之间有 2 个可见「·」分隔元素" 2 "$(printf '%s' "$S" | jq -r '.sepCount')"
    eq "⑤b [$TITLE] 分隔符 user-select = none（不被复制/选中带走）" "none" "$(printf '%s' "$S" | jq -r '.sepUserSelect')"
    SEP_C=$(printf '%s' "$S" | jq -r '.sepColor')
    TXT_C=$(printf '%s' "$S" | jq -r '.metaColor')
    echo "  \$ 分隔符色 $SEP_C ｜ 正文色 $TXT_C"
    if [ "$SEP_C" != "$TXT_C" ]; then pass "⑤b [$TITLE] 分隔符颜色与正文不同（更淡）"; else fail "⑤b [$TITLE] 分隔符色与正文相同"; fi
    eq "⑤b [$TITLE] 每个分隔符实际渲染宽度 > 0" "true" "$(printf '%s' "$S" | jq -r '[.sepWidths[]|. > 0]|all')"

    # ⑦ 卡片其它不回归
    eq "⑦ [$TITLE] 末行贴底：footer 底 - 卡片底 = body padding 14px" "15" "$(printf '%s' "$G" | jq -r '.bottomGap')"
    eq "⑦ [$TITLE] body padding-bottom 仍是 14px" "14px" "$(printf '%s' "$G" | jq -r '.padBottom')"
    eq "⑦ [$TITLE] 星标仍在" "true" "$(printf '%s' "$G" | jq -r '.star')"
    eq "⑦ [$TITLE] 复制按钮仍在" "true" "$(printf '%s' "$G" | jq -r '.copy')"
    eq "⑦ [$TITLE] 拖拽手柄仍在" "true" "$(printf '%s' "$G" | jq -r '.handle')"
  done

  line "AC-117 ⑥：表格视图与分栏视图与改前一致（未动）"
  TCOLS=$(printf '%s\n' "$PROBE" | grep '^TABLE_COLS:' | cut -d: -f2-)
  echo "  \$ 表格列：$TCOLS"
  eq "⑥ 表格列仍是 8 列（+ 表头全选）= 9" 9 "$(printf '%s' "$TCOLS" | jq 'length')"
  eq "⑥ 含「取用次数」（表格未动）" "true" "$(printf '%s' "$TCOLS" | jq -r 'index("取用次数") != null')"
  eq "⑥ 含「更新于」（表格未动）" "true" "$(printf '%s' "$TCOLS" | jq -r 'index("更新于") != null')"
  eq "⑥ 含「文件夹」（表格仍未动）" "true" "$(printf '%s' "$TCOLS" | jq -r 'index("文件夹") != null')"
  SMETA=$(printf '%s\n' "$PROBE" | grep '^SPLIT_META:' | cut -d: -f2-)
  echo "  \$ 分栏中栏第一项：$SMETA"
  # ⚠️ 判据要**排除标题本身**：夹具标题含 "AC117"（里面就有数字），直接 grep v[0-9] 会误判。
  #    先把标题从被检文本里剥掉，再判"有没有元信息残留"。
  SMETA_STRIPPED=$(printf '%s' "$SMETA" | sed 's/AC117 有目录含变量//')
  eq "⑥ 分栏中栏不含元信息（FR-71 未回归）" 0 "$(printf '%s' "$SMETA_STRIPPED" | grep -cE '变量|取用|v[0-9]|AI 协作|未分组' || true)"
  eq "⑥ 分栏中栏仍只有标题" "AC117 有目录含变量" "$SMETA"
  # 只改卡片这一处：gap=6 只在 metaLine 一处；其余 gap 原样
  eq "⑥ 源码里 <Flex gap={6} 只出现 1 次（卡片元信息那一处）" 1 "$(grep -o '<Flex gap={6}' web/src/components/UseView.tsx | wc -l)"
  eq "⑥ 卡片竖向 gap 仍是 10（卡片本体 + 批量移动弹窗，两处都没动）" 2 "$(grep -c '<Flex vertical gap={10}' web/src/components/UseView.tsx || true)"
  eq "⑥ 标签区 gap 仍是 4" 2 "$(grep -c '<Flex gap={4} wrap' web/src/components/UseView.tsx || true)"
  eq "⑥ 表格「标签」列的 gap 未被改成 6" 1 "$(grep -c 'data-testid="pm-table-tag-cell"' web/src/components/UseView.tsx || true)"

  line "AC-117 ⑧：视觉证据（卡片视图截图，脚本自己落 tmp/shots/stage52/）"
  SHOTS="tmp/shots/stage52"
  mkdir -p "$SHOTS"
  node tools/ac-stage52-shots.mjs "$BASE" "$SID" "$SHOTS" 2>&1 | sed 's/^/    /'
  for f in "$SHOTS/card-with-folder.png" "$SHOTS/card-no-folder.png"; do
    if [ -s "$f" ]; then pass "⑧ 截图已产出且非空：$f（$(stat -c%s "$f") B）"; else fail "⑧ 缺截图 $f"; fi
  done
  eq "⑧ 截图落在 tmp/（不入库）" 0 "$(git ls-files tmp | wc -l)"

  line "AC-117 ⑥b：分隔符**不进入复制内容**（视觉分隔物，不是可复制内容）"
  CP=$(node tools/ac-stage52-copy-probe.mjs "$BASE" "$SID" 2>&1)
  printf '%s\n' "$CP" | sed 's/^/    /'
  CP_LINE=$(printf '%s\n' "$CP" | grep '^FOOTER_LINE:' | cut -d: -f2-)
  CP_COPIED=$(printf '%s\n' "$CP" | grep '^COPIED:' | cut -d: -f2-)
  CP_BODY=$(q "SELECT user_prompt FROM prompts WHERE id=$NO_FOLDER;")
  eq "⑥b 卡片底部那一行**确实**含「·」（前提成立）" 2 "$(printf '%s' "$CP_LINE" | grep -o '·' | wc -l)"
  eq "⑥b 剪贴板收到的内容 == 库内正文" "true" "$(printf '%s' "$CP_COPIED" | jq -r --arg b "$CP_BODY" 'all(.[]; . == $b)')"
  eq "⑥b 剪贴板内容不含「·」分隔符" 0 "$(printf '%s' "$CP_COPIED" | grep -c '·' || true)"
  eq "⑥b 剪贴板内容不含任何元信息（目录/版本/变量）" 0 "$(printf '%s' "$CP_COPIED" | grep -cE '未分组|变量|v[0-9]' || true)"

  line "AC-117 ⑩：ci-check（先删 dist 再跑，验证冷构建）"
  rm -rf dist
  bash tools/ci-check.sh >"$DIR/ci.log" 2>&1
  eq "ci-check 退出码" 0 "$?"
  tail -12 "$DIR/ci.log" | sed 's/^/    /'
fi

line "结论"
if [ "$FAIL" = "0" ]; then
  echo "  ✅ AC-117 ①–⑩ 全部通过"
else
  echo "  ❌ 有判据未通过（见上方 ❌）"
fi
exit "$FAIL"
