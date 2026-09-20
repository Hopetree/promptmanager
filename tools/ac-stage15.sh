#!/usr/bin/env bash
# 阶段 15 验收自检：AC-47（顶栏四块顺序 + 无用户信息）/ AC-48（⋯更多 子项顺序与删减）/
# AC-49（文件夹区新建与层级）/ AC-50（标签胶囊云）。
#
# 服务**自起自停**（临时 DATA_DIR）；端口在台账范围 8765–8770 内自动挑空闲（8767 是生产实例）。
# 用法：bash tools/ac-stage15.sh
set -u

cd "$(dirname "$0")/.." || exit 1
PORT=${PORT:-auto}
AC_PW='ac-fixture-pw-20260918'
AC_USER='admin'
PARENT_FOLDER='Agent管理'
CHILD_FOLDER='会话管理'
NEW_FOLDER='AC49 新文件夹'
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
line "运行时探针（服务自起自停 + CDP）"
if ss -ltn | grep -q ":$PORT "; then
  fail "端口 $PORT 被占用"
else
  if [ ! -f dist/web/index.html ] || [ -n "$(find web/src -newer dist/web/index.html -print -quit)" ]; then
    echo "  dist/web 缺失或源码更新 → npm run build"
    npm run build >/dev/null 2>&1 || fail "npm run build 失败"
  fi
  AC_DIR=$(mktemp -d /tmp/pm-ac15-XXXXXX)
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
    # 夹具：2 层文件夹（Agent管理 / 会话管理）+ ≥6 个标签 + 3 条 prompt
    SEED_OUT=$(python3 - "$BASE" "$SID" "$PARENT_FOLDER" "$CHILD_FOLDER" <<'PY'
import json, sys, urllib.request
base, sid, parent_name, child_name = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
def call(method, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(base + path, data=data, method=method,
        headers={'Content-Type': 'application/json', 'Cookie': 'pm_sid=' + sid})
    with urllib.request.urlopen(req) as r:
        raw = r.read()
        return json.loads(raw.decode()) if raw else None
parent = call('POST', '/api/folders', {'name': parent_name})
child = call('POST', '/api/folders', {'name': child_name, 'parent_id': parent['id']})
call('POST', '/api/folders', {'name': '写作'})
for name in ('交接', '发布', '排障', '评审', '写作', '前端', '测试'):
    call('POST', '/api/tags', {'name': name})
call('POST', '/api/prompts', {
    'title': 'AC49 夹具 · 子文件夹里的一条', 'user_prompt': '把交接内容整理成三条要点。',
    'folder_id': child['id'], 'tags': ['交接', '发布']})
call('POST', '/api/prompts', {
    'title': 'AC49 夹具 · 父文件夹里的一条', 'user_prompt': '把这段说明改写得更短。',
    'folder_id': parent['id'], 'tags': ['排障']})
call('POST', '/api/prompts', {
    'title': 'AC49 夹具 · 未归类的一条', 'user_prompt': '写一段产品说明。',
    'tags': ['评审', '写作', '前端', '测试']})
print('PARENT_ID=%d' % parent['id'])
print('CHILD_ID=%d' % child['id'])
print('SEED_TOTAL=%d' % call('GET', '/api/prompts?limit=200')['total'])
print('SEED_TAGS=%d' % len(call('GET', '/api/tags')['items']))
PY
)
    echo "$SEED_OUT" | sed 's/^/  /'
    node tools/ac-stage15-probe.mjs "$BASE" "$SID" "$AC_USER" "$PARENT_FOLDER" "$CHILD_FOLDER" "$NEW_FOLDER" | tee "$AC_DIR/probe.log"
    v() { grep -m1 "^$1=" "$AC_DIR/probe.log" | cut -d= -f2-; }

    line "AC-47 顶栏四块与顺序 + 无用户信息"
    eq "四块按 left 升序（新建<更多<主题<登出）" "true" "$(v ac47_order)"
    eq "四块都可见" "true" "$(v ac47_all_visible)"
    eq "顶栏文本不含用户名 admin" "true" "$(v ac47_no_username)"
    pass "四块坐标：$(v ac47_rects)"
    pass "顶栏文本：$(v ac47_topnav_head)"

    line "AC-48 ⋯更多 子项顺序与删减"
    eq "子项逐项顺序（v27：已登录信息 → 修改密码）" "使用统计|API 令牌|导入 / 导出|关于|修改密码|登出" "$(v ac48_items)"
    eq "菜单内无「文件夹/标签管理」" "true" "$(v ac48_no_folder_entry)"
    eq "pm-settings 文案为「关于」" "关于" "$(v ac48_settings_text)"
    eq "不再有「已登录信息」项" "true" "$(v ac48_no_account_entry)"
    pass "「修改密码」项：$(v ac48_password_entry)"
    eq "「修改密码」是普通可点项" "false" "$(echo "$(v ac48_password_entry)" | jq -r .disabled)"

    line "AC-49 文件夹区新建与层级"
    eq "folder-create 可见" "true" "$(v ac49_create_visible)"
    eq "建完文件夹：数量 +1" "true" "$(v ac49_added)"
    pass "文件夹数：$(v ac49_folders_before) → $(v ac49_folders_after)"
    eq "新文件夹名出现在界面" "true" "$(v ac49_new_name_visible)"
    eq "父文件夹有展开三角" "true" "$(v ac49_parent_has_toggle)"
    eq "折叠后子项不可见（offsetParent null）" "true" "$(v ac49_child_hidden_when_collapsed)"
    eq "再展开恢复可见" "true" "$(v ac49_child_visible_when_expanded)"
    ge "子项相对父项缩进（px）" 12 "$(v ac49_indent)"
    ge "父文件夹条目数（含子文件夹）" 1 "$(v ac49_parent_count)"
    eq "侧栏内彩色计数徽标数" 0 "$(v ac49_badge_in_sidebar)"
    eq "悬浮出现 重命名 / 删除" "true" "$(v ac49_hover_actions)"
    pass "删除二次确认：$(v ac49_delete_confirm)"
    eq "取消删除后文件夹数不变" "true" "$(v ac49_total_unchanged_after_cancel)"
    eq "取消删除不会误改当前筛选" "none" "$(v ac49_active_after_cancel)"

    line "AC-50 标签胶囊云"
    eq "标签总数（夹具 ≥6）" "$(v ac50_tag_total)" "$(v ac50_chip_count)"
    ge "夹具标签数" 6 "$(v ac50_tag_total)"
    eq "pm-tag-cloud 存在" "true" "$(v ac50_cloud_exists)"
    eq "每个胶囊以 # 开头" "true" "$(v ac50_all_hash_prefix)"
    eq "标签区计数徽标数" 0 "$(v ac50_badge_count)"
    ge "胶囊流式换行（不同 offsetTop 数）" 2 "$(v ac50_cloud_rows)"
    eq "容器无横向滚动" "true" "$(v ac50_no_h_scroll)"
    pass "列表条数：未筛选 $(v ac50_unfiltered) → 点 #$(v ac50_first_tag) 后 $(v ac50_filtered) → 再点 $(v ac50_restored)"
    eq "点胶囊筛选生效、再点恢复" "true" "$(v ac50_filter_works)"
  fi
fi

line "结论"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ AC-47 / AC-48 / AC-49 / AC-50 全部通过"
else
  echo "  ❌ 有未通过项（见上方 ❌）"
fi
exit "$FAIL"
