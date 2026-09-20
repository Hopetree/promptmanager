#!/usr/bin/env bash
# 阶段 12 验收自检（v17 修订）：AC-37（主界面纯净度）/ AC-39（反馈与安全提示未误删）/
# AC-40（技术信息有落点：⋯更多 → 设置 → 关于）。
# ⚠️ AC-38（导航归位）自 BRIEF v17 起由 AC-41 修订取代，本节已移除（见 tools/ac-stage13.sh）。
#
# 服务**自起自停**（临时 DATA_DIR）；端口在台账范围 8765–8770 内自动挑空闲（8767 是生产实例）。
# 用法：bash tools/ac-stage12.sh
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

# ---------------------------------------------------------------- 运行时侧
line "运行时探针（服务自起自停 + CDP）"
if ss -ltn | grep -q ":$PORT "; then
  fail "端口 $PORT 被占用"
else
  if [ ! -f dist/web/index.html ] || [ -n "$(find web/src -newer dist/web/index.html -print -quit)" ]; then
    echo "  dist/web 缺失或源码更新 → npm run build"
    npm run build >/dev/null 2>&1 || fail "npm run build 失败"
  fi
  AC_DIR=$(mktemp -d /tmp/pm-ac12-XXXXXX)
  EXPORT_FIXTURE="$AC_DIR/export-fixture.json"
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
    # 夹具：① 无变量条目（AC-39 的「已复制」）② 含变量条目（AC-39 的「未填」）③ 若干条目让列表非空
    SEED_OUT=$(python3 - "$BASE" "$SID" "$EXPORT_FIXTURE" <<'PY'
import json, sys, urllib.request
base, sid, export_path = sys.argv[1], sys.argv[2], sys.argv[3]
def call(method, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(base + path, data=data, method=method,
        headers={'Content-Type': 'application/json', 'Cookie': 'pm_sid=' + sid})
    with urllib.request.urlopen(req) as r:
        raw = r.read()
        return json.loads(raw.decode()) if raw else None
work = call('POST', '/api/folders', {'name': '工作'})
for name in ('交接', '发布'):
    call('POST', '/api/tags', {'name': name})
plain = call('POST', '/api/prompts', {
    'title': '洁净夹具 · 无变量', 'user_prompt': '请把今天的工作整理成三条要点，不要编造。',
    'system_prompt': '你是一名严谨的工程助手。', 'notes': 'AC-39 夹具', 'folder_id': work['id'], 'tags': ['交接']})
vars_p = call('POST', '/api/prompts', {
    'title': '洁净夹具 · 含变量', 'user_prompt': '你好 {{姓名}}，项目 {{项目}}。',
    'system_prompt': '', 'notes': 'AC-39 未填提示夹具', 'tags': ['发布']})
call('POST', '/api/prompts', {
    'title': '洁净夹具 · 列表填充', 'user_prompt': '把这段说明改写成更短的三句话。', 'favorite': True})
exported = call('GET', '/api/export')
with open(export_path, 'w', encoding='utf-8') as handle:
    json.dump(exported, handle, ensure_ascii=False)
print('PLAIN_ID=%d' % plain['id'])
print('VARS_ID=%d' % vars_p['id'])
print('SEED_TOTAL=%d' % call('GET', '/api/prompts?limit=200')['total'])
PY
)
    echo "$SEED_OUT" | sed 's/^/  /'
    PLAIN_ID=$(printf '%s\n' "$SEED_OUT" | awk -F= '/^PLAIN_ID=/{print $2}')
    VARS_ID=$(printf '%s\n' "$SEED_OUT" | awk -F= '/^VARS_ID=/{print $2}')
    if [ -z "$PLAIN_ID" ] || [ -z "$VARS_ID" ]; then
      fail "夹具创建失败"
    else
      node tools/ac-stage12-probe.mjs "$BASE" "$SID" "$PLAIN_ID" "$VARS_ID" "$EXPORT_FIXTURE" | tee "$AC_DIR/probe.log"
      v() { grep -m1 "^$1=" "$AC_DIR/probe.log" | cut -d= -f2-; }

      line "AC-37 使用视图纯净度（body.innerText 禁用串命中数，期望全 0）"
      eq "DATA_DIR" 0 "$(v ac37_datadir)"
      eq "/api/" 0 "$(v ac37_api_path)"
      eq "SQLite" 0 "$(v ac37_sqlite)"
      eq "监听" 0 "$(v ac37_listen)"
      eq "本次查询" 0 "$(v ac37_query_ms)"
      eq "筛选命中" 0 "$(v ac37_filter_hit)"
      eq "使用统计" 0 "$(v ac37_usage_stats)"
      eq "API 令牌" 0 "$(v ac37_api_token)"
      eq "导入" 0 "$(v ac37_import)"
      eq "导出" 0 "$(v ac37_export)"
      eq "渲染不写库" 0 "$(v ac37_render_nowrite)"
      eq "version_no" 0 "$(v ac37_version_no)"
      eq "内部 id（/#[0-9]+/）" 0 "$(v ac37_internal_id_count)"

      line "AC-39 反馈与安全提示未被误删"
      eq "复制后出现「已复制」" "true" "$(v ac39_copied_toast)"
      eq "未填时出现「未填」提示" "true" "$(v ac39_unfilled_present)"
      pass "未填提示文本：$(v ac39_unfilled_hint)"
      eq "导入 replace 清空警示仍在" "true" "$(v ac39_replace_warning)"
      eq "replace 二次确认仍在" "true" "$(v ac39_replace_confirm)"
      pass "二次确认文本：$(v ac39_replace_confirm_head)"

      line "AC-40 技术信息有落点（pm-settings → pm-about）"
      eq "pm-about 面板出现" "true" "$(v ac40_about_visible)"
      eq "关于面板含「pm.db」" "true" "$(v ac40_about_has_pmdb)"
      eq "关于面板含「备份」" "true" "$(v ac40_about_has_backup)"
      eq "关于面板含「备份方式」（技术信息真的收进来了）" "true" "$(v ac40_about_has_backup_way)"
      pass "关于面板文本：$(v ac40_about_head)"
    fi
  fi
fi

line "结论"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ AC-37 / AC-39 / AC-40 全部通过（AC-38 已由 AC-41 修订取代）"
else
  echo "  ❌ 有未通过项（见上方 ❌）"
fi
exit "$FAIL"
