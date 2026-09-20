#!/usr/bin/env bash
# 阶段 10B 验收自检（v17 修订）：AC-13/AC-20/AC-21（回归）+ AC-29（token/无 CDN/组件库）+ AC-31（结构判据）。
# ⚠️ v17（FR-43 / D-21）取消管理页后，AC-31 里的「KPI 行 / 状态条 / pm-filter-row」随管理页移除；
#    仍有效的部分（顶栏 / 侧栏 / 编辑器三栏 / 组件库 / token）继续按本脚本判定。
#
# AC-13/AC-30 的截图由 `tools/ui-shots.sh` 单独产出（本脚本只跑结构断言，避免重复截图）。
# 服务**自起自停**（临时 DATA_DIR，不碰生产实例的 8767 数据）；chrome 走零安装 CDP（tools/ac-stage10-probe.mjs）。
# 用法：bash tools/ac-stage10.sh
set -u

cd "$(dirname "$0")/.." || exit 1
PORT=${PORT:-auto}
# 阶段 10B 起：生产实例已占用 8767，因此默认**在台账范围 8765–8770 内自动挑一个空闲端口**
# （STANDARDS §3.1 只允许这个范围；全被占 → 报错停手，不自行扩范围）。
pick_port() {
  for candidate in 8765 8766 8767 8768 8769 8770; do
    if ! ss -ltn | grep -q ":$candidate "; then echo "$candidate"; return 0; fi
  done
  return 1
}
if [ "${PORT}" = "auto" ]; then
  PORT=$(pick_port) || { echo "FAIL 台账范围 8765–8770 全被占用，无法起临时实例（写 QUESTIONS 停手）"; exit 1; }
  echo "  PORT 自动选择：$PORT（8767 被已部署实例占用，故避开）"
fi
AC_PW='ac-fixture-pw-20260918'
BASE="http://127.0.0.1:$PORT"
FAIL=0

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

# ---------------------------------------------------------------- AC-29 / AC-20（源码侧）
line "AC-29 ① theme.token 与 theme.components 真的被定制"
TOKEN_HITS=$(grep -rnE 'token:[[:space:]]*\{|components:[[:space:]]*\{' web/src --include='*.tsx' --include='*.ts' | wc -l)
[ "$TOKEN_HITS" -ge 1 ] || grep -rnE 'token:[[:space:]]*\{' web/src --include='*.ts'
ge "theme.token/components 命中" 1 "$TOKEN_HITS"

line "AC-29 ② 源码与产物零 CDN"
CDN=$(grep -rnE '(cdn|unpkg|jsdelivr)' web/src dist --include='*.html' --include='*.tsx' --include='*.ts' --include='*.css' 2>/dev/null | wc -l)
eq "CDN 命中" 0 "$CDN"

line "AC-20 ② 源码里不出现原生表单/表格标签"
NATIVE=$(grep -rnE "<(button|input|select|textarea|table|dialog)[ >/]" web/src --include='*.tsx' | wc -l)
eq "原生标签命中" 0 "$NATIVE"

line "AC-20 ③ from 'antd' 出现次数（期望 ≥5）"
IMPORTS=$(grep -rnoE "from ['\"]antd['\"]" web/src --include='*.tsx' | wc -l)
ge "from 'antd'" 5 "$IMPORTS"

line "AC-31（v17 修订）源码侧的结构 testid + pm-panel-* 恰好 3 个"
eq 'data-testid="pm-panel-versions"' 1 "$(grep -rc 'data-testid="pm-panel-versions"' web/src --include='*.tsx' | awk -F: '{s+=$2} END{print s+0}')"
eq 'pm-panel-* 总数' 3 "$(grep -rho 'data-testid="pm-panel-' web/src --include='*.tsx' | wc -l)"
for id in pm-topnav pm-sidebar pm-editor; do
  eq "data-testid=\"$id\"" 1 "$(grep -rho "data-testid=\"$id\"" web/src --include='*.tsx' | wc -l)"
done

line "不得回归：zh_CN / 亮暗跟随系统 / Markdown 仍走服务端净化"
ge "zh_CN" 1 "$(grep -rn 'zh_CN' web/src --include='*.tsx' | wc -l)"
ge "prefers-color-scheme" 1 "$(grep -rn 'prefers-color-scheme' web/src web/index.html | wc -l)"
ge "/api/render/markdown" 1 "$(grep -rn '/api/render/markdown' web/src --include='*.tsx' | wc -l)"
eq "纯表现层（src/migrations/package.json 未改）" 0 "$(git status --short -- src migrations package.json | wc -l)"

# ---------------------------------------------------------------- 运行时侧（AC-31 ④–⑦ + 密度 + AC-21）
line "运行时探针（服务自起自停 + CDP；数据用临时 DATA_DIR）"
if ss -ltn | grep -q ":$PORT "; then
  fail "端口 $PORT 被占用（生产实例在跑？）—— 本脚本需要独占该端口；请先确认没有别的实例"
else
  if [ ! -f dist/web/index.html ] || [ -n "$(find web/src -newer dist/web/index.html -print -quit)" ]; then
    echo "  dist/web 缺失或源码更新 → npm run build"
    npm run build >/dev/null 2>&1 || fail "npm run build 失败"
  fi
  AC_DIR=$(mktemp -d /tmp/pm-ac10-XXXXXX)
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
    fail "服务未起来（见 $AC_DIR/server.log）"
  else
    JAR="$AC_DIR/jar.txt"
    curl -s -c "$JAR" -o /dev/null -X POST -H 'Content-Type: application/json' \
      -d "{\"username\":\"admin\",\"password\":\"$AC_PW\"}" "$BASE/api/login"
    SID=$(awk '$6 == "pm_sid" { print $7 }' "$JAR" | tail -1)
    # 夹具：2 文件夹 / 3 标签 / 12 条 prompt（>10 才能验"一屏 ≥10 行"）
    python3 - "$BASE" "$SID" <<'PY'
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
call('POST', '/api/folders', {'name': '运维', 'parent_id': work['id']})
for name in ('交接', '发布', '排障'):
    call('POST', '/api/tags', {'name': name})
first = call('POST', '/api/prompts', {
    'title': '会话交接模板', 'user_prompt': '你是 {{项目}} 项目的交接助手。\\n\\n- 交接人：{{姓名}}\\n- 风险点用 `[!]` 标出',
    'system_prompt': '你是严谨的工程交接助手。', 'notes': '每周五用一次。',
    'folder_id': work['id'], 'tags': ['交接', '发布'], 'favorite': True})
call('PUT', '/api/prompts/%d' % first['id'], {'notes': '每周五用一次；抄送 {{项目}} 负责人。'})
for i in range(2, 13):
    call('POST', '/api/prompts', {
        'title': '夹具 prompt %02d · SQL 与迁移' % i,
        'user_prompt': '把下面的 SQL 改写成 Kysely 查询：#%02d' % i,
        'notes': '迁移一律写幂等 SQL。', 'folder_id': work['id'], 'tags': ['发布']})
print('SEED prompts=%d' % call('GET', '/api/prompts?limit=200')['total'])
PY
    node tools/ac-stage10-probe.mjs "$BASE" "$SID" | tee "$AC_DIR/probe.log"
    v() { grep -m1 "^$1=" "$AC_DIR/probe.log" | cut -d= -f2; }

    line "AC-31（v17 修订）④⑤⑥（运行时）"
    eq "④ pm-panel-* 元素数" 3 "$(v AC31_04_PANELS)"
    eq "⑤ 三块同时可见" "true" "$(v AC31_05_PANELS_ALL_VISIBLE)"
    eq "⑥ 详情面 .ant-tabs-tab 数" 0 "$(v AC31_06_TABS)"
    eq "面板 testid 组合（v21 使用优先顺序：预览→变量→版本）" "pm-panel-markdown,pm-panel-variables,pm-panel-versions" "$(v AC31_PANEL_IDS)"
    eq "主界面 5 个结构 testid 全在" "true,true,true,true,true" "$(v AC31_LIST_TESTIDS)"

    line "表格视图密度（1280×800 一屏可见行数 ≥10）"
    echo "  ℹ 渲染行数=$(v AC31_ROWS_RENDERED) ｜ 视口内=$(v AC31_ROWS_VISIBLE) ｜ 最后一行底边=$(v AC31_ROWS_LAST_BOTTOM)px"
    ge "可见表格行数" 10 "$(v AC31_ROWS_VISIBLE)"

    line "AC-21 组件库真的在渲染（渲染后 DOM 的 ant-* 类名数）"
    ge "ant-* 类名数" 3 "$(v AC21_ANT_CLASSES)"
    # 参考信息（非判据）：AC-20 ② 的真判据是源码侧 grep（上面已 =0）；这里只显示"一个 ant-* 类都没有"的元素
    echo "  ℹ 运行时不带任何 ant-* 类的原生表单/表格元素 = $(v AC20_NATIVE_TAGS)（样本：$(v AC20_NATIVE_SAMPLE)）"
  fi
fi

line "结论"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ AC-13（结构侧）/ AC-20 / AC-21 / AC-29 / AC-31 全部通过（截图见 tools/ui-shots.sh）"
else
  echo "  ❌ 有未通过项（见上方 ❌）"
fi
exit "$FAIL"
