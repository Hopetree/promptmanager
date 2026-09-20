#!/usr/bin/env bash
# 阶段 14 验收自检：AC-44（分栏视图存在且为默认）/ AC-45（档位顺序与「列表」档删除）/
# AC-46（分栏右栏复用详情面能力）。
#
# 服务**自起自停**（临时 DATA_DIR）；端口在台账范围 8765–8770 内自动挑空闲（8767 是生产实例）。
# 用法：bash tools/ac-stage14.sh
set -u

cd "$(dirname "$0")/.." || exit 1
PORT=${PORT:-auto}
AC_PW='ac-fixture-pw-20260918'
VARS_TITLE='阶段14 夹具 · 含变量'
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
line "AC-45 ④（源码侧）：pm-view-list 已删除 + 组件库硬约束 + 契约未改"
eq "grep -rc 'pm-view-list' web/src 命中" 0 "$(grep -rho 'pm-view-list' web/src --include='*.tsx' --include='*.ts' | wc -l)"
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
  AC_DIR=$(mktemp -d /tmp/pm-ac14-XXXXXX)
  printf '%s\n' "$AC_PW" | DATA_DIR="$AC_DIR" node bin/pm.mjs user set-password --username admin >/dev/null
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
      -d "{\"username\":\"admin\",\"password\":\"$AC_PW\"}" "$BASE/api/login"
    SID=$(awk '$6 == "pm_sid" { print $7 }' "$JAR" | tail -1)
    # 夹具：≥3 条（分栏列表要有多条才能验"点第 2 个切换右栏"）+ 1 条含 2 变量
    SEED_OUT=$(python3 - "$BASE" "$SID" "$VARS_TITLE" <<'PY'
import json, sys, urllib.request
base, sid, vars_title = sys.argv[1], sys.argv[2], sys.argv[3]
def call(method, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(base + path, data=data, method=method,
        headers={'Content-Type': 'application/json', 'Cookie': 'pm_sid=' + sid})
    with urllib.request.urlopen(req) as r:
        raw = r.read()
        return json.loads(raw.decode()) if raw else None
work = call('POST', '/api/folders', {'name': '工作'})
call('POST', '/api/tags', {'name': '交接'})
call('POST', '/api/prompts', {
    'title': '阶段14 夹具 · 无变量', 'user_prompt': '把今天的进展整理成三条要点。\n第二行不该出现在摘要里。',
    'system_prompt': '', 'notes': 'AC-44 夹具', 'folder_id': work['id'], 'tags': ['交接']})
vars_p = call('POST', '/api/prompts', {
    'title': vars_title, 'user_prompt': '你好 {{姓名}}，项目 {{项目}}。', 'favorite': True})
call('POST', '/api/prompts', {
    'title': '阶段14 夹具 · 第三条', 'user_prompt': '把这段说明改写成更短的三句话。'})
print('VARS_ID=%d' % vars_p['id'])
print('SEED_TOTAL=%d' % call('GET', '/api/prompts?limit=200')['total'])
PY
)
    echo "$SEED_OUT" | sed 's/^/  /'
    node tools/ac-stage14-probe.mjs "$BASE" "$SID" "$VARS_TITLE" | tee "$AC_DIR/probe.log"
    v() { grep -m1 "^$1=" "$AC_DIR/probe.log" | cut -d= -f2-; }

    line "AC-44 分栏视图存在且为默认"
    eq "pm-view-split 存在" "true" "$(v ac44_split_exists)"
    eq "中栏与右栏同屏可见" "true" "$(v ac44_both_visible)"
    eq "中栏与右栏不重叠" "true" "$(v ac44_not_overlap)"
    pass "中栏 rect：$(v ac44_list_rect)"
    pass "右栏 rect：$(v ac44_detail_rect)"
    ge "pm-split-item 数" 1 "$(v ac44_item_count)"
    eq "选中态恰好一个" 1 "$(v ac44_selected_count)"
    eq "点第 2 条 → 右栏标题随之改变" "true" "$(v ac44_detail_title_switched)"
    pass "首条 / 第二条 / 切换后右栏标题：$(v ac44_first_title) / $(v ac44_second_title) / $(v ac44_after_click_detail_title)"
    eq "切表格再切回分栏 → 结构恢复" "true" "$(v ac44_split_restored)"

    line "AC-45 视图档位顺序与「列表」档删除"
    eq "档位依次为 分栏|表格|卡片" "分栏|表格|卡片" "$(v ac45_labels)"
    eq "不存在 pm-view-list" "true" "$(v ac45_no_list_view)"
    eq "清空 localStorage 后默认选中" "分栏" "$(v ac45_default_label)"
    eq "默认写入 localStorage['pm-view-mode']" "split" "$(v ac45_default_storage)"
    eq "切表格后刷新仍落在表格" "表格" "$(v ac45_after_reload_label)"
    eq "旧值 list → 回退到分栏" "分栏" "$(v ac45_legacy_label)"
    eq "旧值 list 下分栏结构仍在" "true" "$(v ac45_legacy_split)"
    eq "旧值 list 下控制台报错数" 0 "$(v ac45_legacy_console_errors)"
    ge "旧值 list 下页面不空白（innerText 长度）" 20 "$(v ac45_legacy_body_len)"

    line "AC-46 分栏右栏复用详情面能力"
    pass "右栏选中的条目：$(v ac46_selected_title)"
    eq "右栏五个操作按钮都存在且可点" "true" "$(v ac46_all_buttons_clickable)"
    eq "只填一个变量 → 预览保留另一个 {{项目}}" "true" "$(v ac46_preview_keeps_placeholder)"
    pass "预览：$(v ac46_preview)"
    eq "剪贴板 == 预览（逐字符）" "true" "$(v ac46_clipboard_matches_preview)"
    pass "删除二次确认：$(v ac46_delete_confirm)"
    eq "取消删除后 total 不变" "true" "$(v ac46_total_unchanged)"
    pass "total 轨迹：$(v ac46_total_before) → $(v ac46_total_after)"
  fi
fi

line "结论"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ AC-44 / AC-45 / AC-46 全部通过"
else
  echo "  ❌ 有未通过项（见上方 ❌）"
fi
exit "$FAIL"
