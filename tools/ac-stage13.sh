#!/usr/bin/env bash
# 阶段 13 验收自检：AC-41（无管理页 + 顶栏精简）/ AC-42（主题图标三态）/ AC-43（新建未保存不入库）。
#
# 服务**自起自停**（临时 DATA_DIR）；端口在台账范围 8765–8770 内自动挑空闲（8767 是生产实例）。
# 用法：bash tools/ac-stage13.sh
set -u

cd "$(dirname "$0")/.." || exit 1
PORT=${PORT:-auto}
AC_PW='ac-fixture-pw-20260918'
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
line "不得回归（源码侧）：双模式已删除 / 组件库约束 / 契约未改"
eq "web/src 里 pm-mode-use/pm-mode-manage 命中" 0 \
  "$(grep -rhoE 'pm-mode-(use|manage)' web/src --include='*.tsx' --include='*.ts' | wc -l)"
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
  AC_DIR=$(mktemp -d /tmp/pm-ac13-XXXXXX)
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
    # 夹具：几条 prompt 让表格/卡片非空（AC-43 的 total 基线也来自它们）
    SEED_OUT=$(python3 - "$BASE" "$SID" <<'PY'
import json, sys, urllib.request
base, sid = sys.argv[1], sys.argv[2]
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
    'title': '阶段13 夹具 · 无变量', 'user_prompt': '把今天的进展整理成三条要点。',
    'system_prompt': '', 'notes': 'AC-41 夹具', 'folder_id': work['id'], 'tags': ['交接']})
call('POST', '/api/prompts', {
    'title': '阶段13 夹具 · 含变量', 'user_prompt': '你好 {{姓名}}，项目 {{项目}}。', 'favorite': True})
print('SEED_TOTAL=%d' % call('GET', '/api/prompts?limit=200')['total'])
PY
)
    echo "$SEED_OUT" | sed 's/^/  /'
    node tools/ac-stage13-probe.mjs "$BASE" "$SID" | tee "$AC_DIR/probe.log"
    v() { grep -m1 "^$1=" "$AC_DIR/probe.log" | cut -d= -f2-; }

    line "AC-41 无管理页 + 顶栏精简"
    eq "pm-mode-use 不存在" "true" "$(v ac41_mode_use_absent)"
    eq "pm-mode-manage 不存在" "true" "$(v ac41_mode_manage_absent)"
    eq "顶栏含「新建」" "true" "$(v ac41_topnav_has_new)"
    eq "顶栏含「更多」" "true" "$(v ac41_topnav_has_more)"
    eq "顶栏有主题图标按钮" "true" "$(v ac41_theme_button)"
    eq "顶栏不常驻「使用统计」" "true" "$(v ac41_topnav_absent_usage)"
    eq "顶栏不常驻「API 令牌」" "true" "$(v ac41_topnav_absent_token)"
    eq "顶栏不常驻「导入」" "true" "$(v ac41_topnav_absent_import)"
    eq "顶栏不常驻「导出」" "true" "$(v ac41_topnav_absent_export)"
    pass "顶栏文本：$(v ac41_topnav_head)"
    ge "表格视图行内 pm-edit-* 计数" 1 "$(v ac41_table_edit_count)"
    ge "表格视图行内 pm-delete-* 计数" 1 "$(v ac41_table_delete_count)"
    eq "卡片视图 pm-delete-* 计数" 0 "$(v ac41_card_delete_count)"

    line "AC-42 主题图标三态（亮 → 暗 → 跟随系统）"
    eq "初始 = 跟随系统（colorScheme 为空）" "" "$(v ac42_initial_scheme)"
    case "$(v ac42_initial_title)" in *跟随系统*) pass "初始 title 体现跟随系统：$(v ac42_initial_title)" ;; *) fail "初始 title：$(v ac42_initial_title)" ;; esac
    eq "点 1 次 → light" "light" "$(v ac42_click1_scheme)"
    eq "点 2 次 → dark" "dark" "$(v ac42_click2_scheme)"
    eq "点 3 次 → 跟随系统（空）" "" "$(v ac42_click3_scheme)"
    eq "刷新前（亮）" "light" "$(v ac42_before_reload_scheme)"
    eq "刷新后仍保持 light（localStorage 记忆）" "light" "$(v ac42_after_reload_scheme)"

    line "AC-43 新建未保存不得入库"
    eq "草稿态标识出现" "true" "$(v ac43_draft_badge)"
    eq "点新建后 total 不变" "true" "$(v ac43_unchanged_after_new)"
    eq "填了标题但不保存 total 不变" "true" "$(v ac43_unchanged_after_typing)"
    eq "Esc 关闭后 total 不变" "true" "$(v ac43_unchanged_after_esc)"
    eq "Esc 真的关掉了编辑器" "true" "$(v ac43_editor_closed_by_esc)"
    eq "点保存后 total +1" "1" "$(v ac43_saved_delta)"
    eq "新条目标题 == 输入值" "阶段13 草稿保存用例" "$(v ac43_saved_title)"
    eq "库里没有「未命名 prompt」残留" "0" "$(v ac43_no_junk)"
    pass "total 轨迹：新建前=$(v ac43_total_before) → 新建后=$(v ac43_total_after_new) → 填标题=$(v ac43_total_after_typing) → Esc=$(v ac43_total_after_esc) → 保存=$(v ac43_total_after_save)"
  fi
fi

line "结论"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ AC-41 / AC-42 / AC-43 全部通过"
else
  echo "  ❌ 有未通过项（见上方 ❌）"
fi
exit "$FAIL"
