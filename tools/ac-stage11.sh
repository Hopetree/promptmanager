#!/usr/bin/env bash
# 阶段 11 验收自检（v17 修订）：AC-33（一键复制）/ AC-33b（填变量对话框+记忆）/ AC-33c（详情操作条）/
# AC-35（移动端一键复制）/ AC-36（快捷与详情）+ 不得回归（AC-20/21/29 + 契约未改）。
# ⚠️ AC-34（使用·管理分离、模式记忆、使用视图 delete=0）自 BRIEF v17 起作废，本节已移除。
#
# 服务**自起自停**（临时 DATA_DIR）；端口在台账范围 8765–8770 内自动挑空闲（8767 被生产实例占用）。
# 用法：bash tools/ac-stage11.sh
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
line "固定 testid 齐备（FR-41 锚点；v17 去掉双模式）"
for id in pm-theme-toggle pm-use-card pm-view-card pm-view-table pm-detail pm-search-input pm-use-sort \
          pm-detail-actions pm-vars-dialog pm-vars-preview; do
  ge "data-testid=\"$id\"" 1 "$(grep -rho "data-testid=\"$id\"" web/src --include='*.tsx' | wc -l)"
done
ge "pm-copy-<id>（模板）" 1 "$(grep -rho 'data-testid={`pm-copy-' web/src --include='*.tsx' | wc -l)"
ge "pm-var-input-<name>（模板）" 1 "$(grep -rho 'data-testid={`pm-var-input-' web/src --include='*.tsx' | wc -l)"

line "不得回归（源码侧）：组件库 / token / 无 CDN / 契约未改"
eq "原生表单标签" 0 "$(grep -rnE "<(button|input|select|textarea|table|dialog)[ >/]" web/src --include='*.tsx' | wc -l)"
ge "from 'antd'" 5 "$(grep -rnoE "from ['\"]antd['\"]" web/src --include='*.tsx' | wc -l)"
eq "CDN（源码+产物）" 0 "$(grep -rnE '(cdn|unpkg|jsdelivr|googleapis)' dist/ web/src --include='*.html' --include='*.tsx' --include='*.css' 2>/dev/null | wc -l)"
ge "theme.token/components" 1 "$(grep -rnE 'token:[[:space:]]*\{|components:[[:space:]]*\{' web/src --include='*.ts' --include='*.tsx' | wc -l)"
eq "纯表现层（src/migrations/package.json 未改）" 0 "$(git status --short -- src migrations package.json | wc -l)"
ge "Markdown 仍走服务端净化" 1 "$(grep -rn '/api/render/markdown' web/src --include='*.tsx' | wc -l)"
ge "zh_CN" 1 "$(grep -rn 'zh_CN' web/src --include='*.tsx' | wc -l)"
ge "亮暗跟随系统" 1 "$(grep -rn 'prefers-color-scheme' web/src web/index.html | wc -l)"

# ---------------------------------------------------------------- 运行时侧
line "运行时探针（服务自起自停 + CDP；剪贴板经 Browser.grantPermissions 授权）"
if ss -ltn | grep -q ":$PORT "; then
  fail "端口 $PORT 被占用"
else
  if [ ! -f dist/web/index.html ] || [ -n "$(find web/src -newer dist/web/index.html -print -quit)" ]; then
    echo "  dist/web 缺失或源码更新 → npm run build"
    npm run build >/dev/null 2>&1 || fail "npm run build 失败"
  fi
  AC_DIR=$(mktemp -d /tmp/pm-ac11-XXXXXX)
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
    # 夹具：① 无变量条目（验 AC-33 逐字符复制）② 含 {{变量}} 条目（验 AC-33b）③ 收藏条目（收藏置顶）
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
plain = call('POST', '/api/prompts', {
    'title': '复制夹具 · 无变量', 'user_prompt': '请把今天的工作整理成三条要点，不要编造。',
    'system_prompt': '你是一名严谨的工程助手。', 'notes': 'AC-33 夹具'})
vars_p = call('POST', '/api/prompts', {
    'title': '复制夹具 · 含变量',
    'user_prompt': '你好 {{姓名}}，项目 {{项目}}。',
    'system_prompt': '', 'notes': 'AC-33b 夹具（v15：未填变量原样保留）', 'tags': ['交接']})
call('POST', '/api/prompts', {
    'title': '复制夹具 · 收藏', 'user_prompt': '这是一条收藏夹具。', 'favorite': True})
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
      node tools/ac-stage11-probe.mjs "$BASE" "$SID" "$PLAIN_ID" "$VARS_ID" | tee "$AC_DIR/probe.log"
      v() { grep -m1 "^$1=" "$AC_DIR/probe.log" | cut -d= -f2-; }

      line "AC-33 一键复制（内容逐字符 + 已复制 + 计入 usage）"
      eq "剪贴板 == 服务端 user_prompt" "true" "$(v plainMatchesApi)"
      eq "出现「已复制」提示" "true" "$(v toastAfterCopy)"
      eq "usage by_channel.session 增量" 1 "$(v usageSessionDelta)"

      line "AC-33b 填变量对话框 + 实时预览 + 自动记忆（v15：未填变量原样保留）"
      eq "对话框出现" "true" "$(v varsDialog)"
      eq "预览随输入变化" "true" "$(v varsPreviewChanged)"
      eq "预览 == 「你好 张三，项目 {{项目}}。」" "true" "$(v varsPreviewExact)"
      eq "未填变量保持 {{项目}} 原文（不得变空串）" "true" "$(v varsPreviewKeepsPlaceholder)"
      eq "已填变量被替换（预览里已无 {{姓名}}）" "true" "$(v varsPreviewReplacedFilled)"
      eq "对话框标注未填数量" "未填 1 个（预览与复制结果里保留原样占位符）" "$(v varsMissingHintAfter)"
      eq "剪贴板 == 预览区文本（逐字符）" "true" "$(v varsClipboardMatchesPreview)"
      eq "剪贴板里 {{项目}} 原样保留" "true" "$(v varsClipboardKeepsPlaceholder)"
      eq "再次打开时预填上次的值" "张三" "$(v varsRemembered)"
      eq "再次打开时未填的那个仍为空" "" "$(v varsUnfilledStaysEmpty)"
      eq "记忆预填后的预览仍保留 {{项目}}" "true" "$(printf '%s' "$(v varsRememberedPreview)" | grep -q '{{项目}}' && echo true || echo false)"

      line "AC-33c 详情底部操作条"
      eq "pm-detail-actions 存在" "true" "$(v detailActions)"
      eq "操作条里有「版本历史」" "true" "$(v detailActionsHasVersions)"
      eq "操作条里有「删除」" "true" "$(v detailActionsHasDelete)"
      case "$(v detailActionsCopyPrimary)" in
        *复制*) pass "操作条主按钮文案含「复制」：$(v detailActionsCopyPrimary)" ;;
        *) fail "操作条主按钮文案：$(v detailActionsCopyPrimary)" ;;
      esac

      line "AC-36 快捷与详情"
      eq "按 / 聚焦到 pm-search-input" "true" "$(v slashFocusesSearch)"
      eq "双击卡片打开 pm-detail" "true" "$(v detailOpenedByDblClick)"
      eq "按 Esc 关闭详情" "true" "$(v detailClosedByEsc)"

      line "AC-35 移动端（390×844）"
      eq "移动端主界面出现" "true" "$(v mobileDefaultUse)"
      python3 - "$(v mobileCopyRect)" <<'PY'
import json, sys
try:
    rect = json.loads(sys.argv[1])
except Exception:
    print('  ❌ 复制按钮矩形读不到：%s' % sys.argv[1]); sys.exit(1)
ok = rect.get('visible') is True and rect.get('w', 0) >= 44 and rect.get('h', 0) >= 44
print('  %s 复制按钮可见=%s 尺寸=%sx%s（期望 ≥44×44）' % ('✅' if ok else '❌', rect.get('visible'), rect.get('w'), rect.get('h')))
sys.exit(0 if ok else 1)
PY
      [ $? -eq 0 ] || FAIL=1
      eq "移动端无横向溢出" "false" "$(v mobileOverflow)"

      line "AC-21 回归（使用视图渲染后的 ant-* 类名数）"
      ge "ant-* 类名数" 3 "$(v antClasses)"
    fi
  fi
fi

line "结论"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ AC-33 / AC-33b / AC-33c / AC-35 / AC-36 + 不得回归全部通过（AC-34 已作废）"
else
  echo "  ❌ 有未通过项（见上方 ❌）"
fi
exit "$FAIL"
