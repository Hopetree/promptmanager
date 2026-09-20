#!/usr/bin/env bash
# 阶段 16 验收自检：AC-51（logo 回主页）/ AC-52（关于页重构）/ AC-53（删「拿来就用」）/
# AC-54（非空文件夹删除不得静默失败，真鼠标）/ AC-55（编辑页返回详情）/ AC-56（右栏顺序）/
# AC-57（收藏显性化，真鼠标）/ AC-58（主题跟随系统图标）。
#
# 服务**自起自停**（临时 DATA_DIR）；端口在台账范围 8765–8770 内自动挑空闲（8767 是生产实例）。
# 用法：bash tools/ac-stage16.sh
set -u

cd "$(dirname "$0")/.." || exit 1
PORT=${PORT:-auto}
AC_PW='ac-fixture-pw-20260918'
AC_USER='admin'
PARENT_FOLDER='Agent管理'
CHILD_FOLDER='会话管理'
EMPTY_FOLDER='AC54 空文件夹'
TAG_NAME='交接'
FIXTURE_TITLE='AC55 夹具 · 含变量'
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
ge() { if [ "${3:-}" != '' ] && [ "$3" -ge "$2" ] 2>/dev/null; then pass "$1 = $3（期望 ≥$2）"; else fail "$1 = ${3:-空}（期望 ≥$2）"; fi; }
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

# ---------------------------------------------------------------- 静态侧
line "不得回归（源码侧）：组件库硬约束 / 契约未改"
eq "原生表单标签" 0 "$(grep -rnE "<(button|input|select|textarea|table|dialog)[ >/]" web/src --include='*.tsx' | wc -l)"
ge "from 'antd'" 5 "$(grep -rnoE "from ['\"]antd['\"]" web/src --include='*.tsx' | wc -l)"
eq "CDN（源码+产物）" 0 "$(grep -rnE '(cdn|unpkg|jsdelivr|googleapis)' dist/ web/src --include='*.html' --include='*.tsx' --include='*.css' 2>/dev/null | wc -l)"
eq "纯表现层（src/migrations/package.json 未改）" 0 "$(git status --short -- src migrations package.json | wc -l)"

# ---------------------------------------------------------------- 运行时侧
line "运行时探针（服务自起自停 + CDP；AC-54/AC-57 用真鼠标事件）"
if ss -ltn | grep -q ":$PORT "; then
  fail "端口 $PORT 被占用"
else
  if [ ! -f dist/web/index.html ] || [ -n "$(find web/src -newer dist/web/index.html -print -quit)" ]; then
    echo "  dist/web 缺失或源码更新 → npm run build"
    npm run build >/dev/null 2>&1 || fail "npm run build 失败"
  fi
  AC_DIR=$(mktemp -d /tmp/pm-ac16-XXXXXX)
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
    # 夹具：父/子/空 文件夹 + ≥6 标签 + 3 条 prompt（含一条带 2 变量）
    SEED_OUT=$(python3 - "$BASE" "$SID" "$PARENT_FOLDER" "$CHILD_FOLDER" "$EMPTY_FOLDER" "$TAG_NAME" "$FIXTURE_TITLE" <<'PY'
import json, sys, urllib.request
base, sid, parent_name, child_name, empty_name, tag_name, fixture_title = sys.argv[1:8]
def call(method, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(base + path, data=data, method=method,
        headers={'Content-Type': 'application/json', 'Cookie': 'pm_sid=' + sid})
    with urllib.request.urlopen(req) as r:
        raw = r.read()
        return json.loads(raw.decode()) if raw else None
parent = call('POST', '/api/folders', {'name': parent_name})
child = call('POST', '/api/folders', {'name': child_name, 'parent_id': parent['id']})
call('POST', '/api/folders', {'name': empty_name})
for name in (tag_name, '发布', '排障', '评审', '写作', '前端', '测试'):
    call('POST', '/api/tags', {'name': name})
fixture = call('POST', '/api/prompts', {
    'title': fixture_title, 'user_prompt': '你好 {{姓名}}，项目 {{项目}}。', 'folder_id': child['id'], 'tags': [tag_name]})
call('POST', '/api/prompts', {
    'title': 'AC54 夹具 · 未归类的一条', 'user_prompt': '把交接内容整理成三条要点。', 'tags': ['发布']})
call('POST', '/api/prompts', {
    'title': 'AC54 夹具 · 第三条', 'user_prompt': '写一段产品说明。', 'tags': ['排障']})
print('PARENT_ID=%d' % parent['id'])
print('CHILD_ID=%d' % child['id'])
print('EMPTY_ID=%d' % call('GET', '/api/folders')['items'][-1]['id'])
print('FIXTURE_ID=%d' % fixture['id'])
print('SEED_TOTAL=%d' % call('GET', '/api/prompts?limit=200')['total'])
print('SEED_TAGS=%d' % len(call('GET', '/api/tags')['items']))
PY
)
    echo "$SEED_OUT" | sed 's/^/  /'
    node tools/ac-stage16-probe.mjs "$BASE" "$SID" "$AC_USER" "$PARENT_FOLDER" "$CHILD_FOLDER" "$EMPTY_FOLDER" "$TAG_NAME" "$FIXTURE_TITLE" | tee "$AC_DIR/probe.log"
    v() { grep -m1 "^$1=" "$AC_DIR/probe.log" | cut -d= -f2-; }

    line "AC-51 Logo 更名与回主页"
    # ⚠️ v32 / FR-76 / D-31 修订：顶栏品牌文字由 PromptManager 缩短为 PromptM（仅顶栏一处）
    eq "顶栏含 PromptM（v32 起为简称）" "true" "$(v ac51_has_brand)"
    eq "顶栏不含全小写 promptmanager" "true" "$(v ac51_no_lowercase)"
    eq "logo cursor=pointer 且 role=button" "true" "$(v ac51_logo_ok)"
    pass "点击前状态：$(v ac51_before_home)"
    pass "点击后状态：$(v ac51_after_home)"
    eq "点 logo 回主页（分栏 + 清搜索 + 清筛选 + 选中取消）" "true" "$(v ac51_home_ok)"

    line "AC-52 关于页重构"
    eq "不含 BRIEF / AC- / 阶段 字样" "true" "$(v ac52_no_internal)"
    eq "Descriptions 无重复 label" "true" "$(v ac52_no_duplicate)"
    ge "分区数" 3 "$(v ac52_sections)"
    pass "分区与 label：$(v ac52_labels)"
    pass "首分区：$(v ac52_first_section)"
    eq "窄屏 390 横向溢出" "false" "$(v ac52_narrow_overflow)"

    line "AC-53 删除「拿来就用」装饰块"
    eq "DOM 中无「拿来就用」文本元素" "true" "$(v ac53_no_decor)"
    le "顶栏底→搜索框顶（px，修改前 $(v ac53_gap_before)）" 23 "$(v ac53_gap_after)"
    eq "垂直空白减少 ≥30px" "true" "$(v ac53_gap_ok)"

    line "AC-54 FIX：非空文件夹删除不得静默失败（真鼠标全链路）"
    pass "弹窗文案：$(v ac54_popup_text)"
    eq "鼠标移到弹窗上后弹窗仍可见" "true" "$(v ac54_popup_alive)"
    eq "触发按钮仍被钉住（未被 hover 卸载）" "true" "$(v ac54_delete_icon_pinned)"
    eq "弹窗内确定按钮可命中（未被遮挡）" "button" "$(v ac54_ok_hit)"
    eq "弹窗完整落在视口内（未被裁切）" "true" "$(v ac54_popup_in_viewport)"
    eq "非空删除出现可见错误反馈" "true" "$(v ac54_has_feedback)"
    pass "错误反馈：$(v ac54_error_message)"
    eq "非空删除后文件夹数不变" "true" "$(v ac54_folders_unchanged)"
    pass "文件夹数：$(v ac54_folders_before) → 失败后 $(v ac54_folders_after_fail) → 空文件夹删除后 $(v ac54_folders_after_empty_delete)"
    eq "空文件夹真鼠标删除成功（-1）" "true" "$(v ac54_empty_delete_ok)"
    eq "窄屏抽屉里弹窗仍可见" "true" "$(v ac54_narrow_popup_alive)"
    eq "窄屏抽屉里确定按钮可命中" "button" "$(v ac54_narrow_ok_hit)"

    line "AC-55 / AC-56 编辑页返回详情与右栏顺序"
    eq "编辑器打开" "true" "$(v ac55_editor_open)"
    eq "顶部存在含「返回」的按钮" "true" "$(v ac55_has_back)"
    case "$(v ac55_back_text)" in
      *详情*) pass "从详情进入 → 返回按钮文案：$(v ac55_back_text)" ;;
      *) fail "从详情进入的返回按钮文案：$(v ac55_back_text)（期望含「详情」）" ;;
    esac
    pass "右栏 top 值：$(v ac56_tops)"
    eq "右栏严格升序（预览 < 变量 < 版本）" "true" "$(v ac56_order_ok)"
    eq "点返回后 pm-detail 重现且标题为该条目" "true" "$(v ac55_back_ok)"

    line "AC-57 收藏入口显性化（真鼠标点表格星标）"
    pass "分栏星标：$(v ac57_split_star)"
    pass "卡片星标：$(v ac57_card_star)"
    pass "表格星标：$(v ac57_table_star)"
    pass "详情星标：$(v ac57_detail_star)"
    eq "四处星标均为可点控件且 ≥24×24 常驻可见" "true" "$(v ac57_all_stars_ok)"
    eq "真鼠标点击后 favorite 翻转" "true" "$(v ac57_favorite_flip)"
    eq "再点一次恢复" "true" "$(v ac57_favorite_restored)"
    eq "刷新后状态保持" "true" "$(v ac57_persisted)"

    line "AC-58 主题「跟随系统」图标"
    pass "跟随系统：$(v ac58_system_icons)"
    pass "亮：$(v ac58_light_icons) ｜ 暗：$(v ac58_dark_icons)"
    eq "跟随系统 = 太阳 + 月亮（无电脑图标）" "true" "$(v ac58_system_ok)"
    eq "亮 = 仅太阳" "true" "$(v ac58_light_ok)"
    eq "暗 = 仅月亮" "true" "$(v ac58_dark_ok)"
  fi
fi

line "结论"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ AC-51 / AC-52 / AC-53 / AC-54 / AC-55 / AC-56 / AC-57 / AC-58 全部通过"
else
  echo "  ❌ 有未通过项（见上方 ❌）"
fi
exit "$FAIL"
