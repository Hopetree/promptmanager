#!/usr/bin/env bash
# 阶段 76（FR-167 / AC-138）Markdown 显示样式端到端验收（交付态，随仓库入库）
#
# 验的是什么（判据是**计算样式**，不是我写了哪些 CSS —— antd 的 reset 可能盖掉规则）：
#   A 基础排版：blockquote 左边框 ≥2px / 表格 collapse + 单元格 ≥1px 边框 + ≥4px 内边距 /
#              h1>h2>h3 字号严格递减且 margin≠0 / 行内 code 有底色 + 圆角或 padding /
#              ul/ol padding-left >0 且 li+li 有间距
#   B 代码块「有面」：pre 用应用 surface（与容器不同）+ 边框或圆角 + padding ≥8px + 横向可滚
#   C 主题联动（核心）：<html data-theme> 是**解析后**的实际值；**四种组合**（应用亮/暗 × 系统亮/暗）
#              下 code/pre 配色都正确（不许"应用深+系统浅 ⇒ 纯白代码块"）；token 色跟应用主题
#   D 不回归：src/services/markdown.ts 一行未改；/api/render/markdown 结构不变；零迁移、零新增依赖
#   E 双端：PC 1440×900 DPR2 / 移动 440×956 DPR3 × 亮/暗，共 6 张截图，均无页面级横向滚动
set -u
cd "$(dirname "$0")/../.."
ROOT="$PWD"

OUT_DIR='tmp/stage76/shots'
DUMP_DIR='tmp/stage76/dumps'
AC_PW='ac-fixture-pw-20260918'

line() { printf '\n=== %s ===\n' "$*"; }
die() { printf '\n❌ %s\n' "$*" >&2; exit 1; }

pick_port() {
  for p in 8765 8766 8768 8769 8770; do
    if ! (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then echo "$p"; return 0; fi
  done
  return 1
}

line "0. 前置检查（零迁移 / 零新增依赖 / 渲染管线未改 / 样式主题源正确）"
[ -f dist/web/index.html ] || die "缺 dist/web/index.html（先 npm run build）"
[ -f dist/server/index.js ] || die "缺 dist/server/index.js"
COUNT=$(ls migrations/*.sql | wc -l | tr -d ' ')
[ "$COUNT" = "10" ] || die "migrations 应为 10 个（本阶段零迁移），实际 $COUNT"
DEPS=$(git diff --stat HEAD -- package.json package-lock.json | wc -l | tr -d ' ')
[ "$DEPS" = "0" ] || die "本阶段零新增依赖，但 package.json / package-lock.json 有改动"
MARKDOWN_DIFF=$(git diff --stat HEAD -- src/services/markdown.ts | wc -l | tr -d ' ')
[ "$MARKDOWN_DIFF" = "0" ] || die "AC-138 ⑪：src/services/markdown.ts 不许改"
python3 - <<'CSSCHECK' || die "AC-138 ③：样式的主题源必须来自应用主题（不许 prefers-color-scheme / 不许 @import highlight.js 自带主题）"
import re, sys
css = re.sub(r'/\*.*?\*/', '', open('web/src/styles/markdown.css', encoding='utf-8').read(), flags=re.S)
if 'prefers-color-scheme' in css:
    print('  发现 prefers-color-scheme（应在注释之外也用不到）'); sys.exit(1)
if 'highlight.js/styles' in css:
    print('  发现 @import highlight.js 主题'); sys.exit(2)
sys.exit(0)
CSSCHECK
echo "  ✅ dist 齐、migrations=$COUNT（零迁移）、依赖无 diff、markdown.ts 无 diff、样式无 prefers-color-scheme/hljs 主题"

PORT=$(pick_port) || die "8765–8770 全被占用"
BASE="http://127.0.0.1:$PORT"
LAN_IP=$(hostname -I | awk '{print $1}')
LAN_BASE="http://$LAN_IP:$PORT"
AC_DIR=$(mktemp -d /tmp/pm-s76-XXXXXX)
JAR="$AC_DIR/cookies.txt"
PLAN="$AC_DIR/plan.json"
mkdir -p "$ROOT/$OUT_DIR" "$ROOT/$DUMP_DIR"
cleanup() {
  [ -n "${SRV_PID:-}" ] && kill "$SRV_PID" 2>/dev/null
  rm -rf "$AC_DIR"
}
trap cleanup EXIT
echo "  PORT=$PORT（8767 禁用）LAN_BASE=$LAN_BASE AC_DIR=$AC_DIR"

line "1. 起临时服务 + 真登录 + 接口层建一条富 Markdown 夹具"
printf '%s\n' "$AC_PW" | DATA_DIR="$AC_DIR" node bin/pm.mjs user set-password --username admin >/dev/null || die "set-password 失败"
DATA_DIR="$AC_DIR" PORT="$PORT" node dist/server/index.js > "$AC_DIR/server.log" 2>&1 &
SRV_PID=$!
for _ in $(seq 1 60); do
  curl -sf "$BASE/healthz" >/dev/null 2>&1 && break
  sleep 0.3
done
curl -sf "$BASE/healthz" >/dev/null 2>&1 || { tail -20 "$AC_DIR/server.log"; die "服务没起来"; }
echo "  /healthz = $(curl -s "$BASE/healthz")"
curl -s -c "$JAR" -o /dev/null -X POST -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$AC_PW\"}" "$BASE/api/login"
SID=$(awk '$6 == "pm_sid" { print $7 }' "$JAR" | tail -1)
[ -n "$SID" ] || die "登录没拿到 pm_sid"
echo "  登录成功（pm_sid 长度 ${#SID}）"

python3 - "$BASE" "$SID" "$AC_DIR" <<'PY' || die "夹具/渲染结构核对失败"
import json, sys, urllib.parse, urllib.request

base, sid, ac_dir = sys.argv[1:4] 

MARKDOWN = """# 一级标题

## 二级标题

### 三级标题

正文段落，含 **粗体**、*斜体* 和行内代码 `npm test`。

- 列表项一
- 列表项二

1. 第一步
2. 第二步

> 引用块：这是一段引用文字。

| 列一 | 列二 |
| --- | --- |
| 甲 | 乙 |

```js
// 注释：这是高亮测试
const answer = 42;
function hello(name) {
  return `hi ${name}`;
}
```

```py
def greet(name):
    return f"hi {name}"
```
"""

def call(method, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(base + path, data=data, method=method)
    req.add_header('cookie', 'pm_sid=' + sid)
    if data is not None:
        req.add_header('content-type', 'application/json')
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as err:
        return err.code, (json.loads(err.read() or b'null'))

# AC-138 ⑪：渲染结构不变 —— 服务端返回的标签与 hljs token 必须齐全，且净化仍生效
status, rendered = call('POST', '/api/render/markdown', {'markdown': MARKDOWN})
assert status == 200, (status, rendered)
html = rendered['html']
for landmark in ['<h1', '<h2', '<h3', '<ul', '<ol', '<blockquote', '<table', '<pre', 'hljs-keyword', 'hljs-string', 'hljs-comment']:
    assert landmark in html, f'渲染结构缺 {landmark}'
assert '<script' not in html and 'onerror' not in html, '净化失效'
print(f"  渲染结构核对通过（h1/h2/h3/ul/table/blockquote/pre + hljs-* token，无 script/onerror）")

status, created = call('POST', '/api/prompts', {'title': 'Markdown 样式验收', 'user_prompt': MARKDOWN})
assert status == 201, (status, created)
with open(f'{ac_dir}/fixture.json', 'w') as fh:
    json.dump({'id': created['id'], 'markdown': MARKDOWN}, fh)
print(f"  夹具：Markdown 样式验收 = #{created['id']}")
PY
FIXTURE_ID=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["id"])' "$AC_DIR/fixture.json") || die "夹具创建失败"
[ -n "$FIXTURE_ID" ] || die "夹具创建失败"
echo "  夹具 id = #$FIXTURE_ID"

line "2. 真浏览器计划：PC 四组合（应用亮/暗 × 系统亮/暗）+ 移动亮/暗"
CHROME=$(node tools/acceptance/lib/chrome.mjs)
[ -n "$CHROME" ] || die "找不到 chrome-headless-shell"
OUT_ABS="$ROOT/$OUT_DIR"
DUMP_ABS="$ROOT/$DUMP_DIR"

python3 - "$LAN_BASE" "$LAN_IP" "$SID" "$CHROME" "$OUT_ABS" "$DUMP_ABS" "$PLAN" <<'PY' || die "计划生成失败"
import json, sys

base, lan_ip, sid, chrome, out_dir, dumps_dir, plan_path = sys.argv[1:8]

# 一个探针把所有"计算样式"读数打包返回（AC-138 的判据就是 getComputedStyle）
MD_CSS = r"""
(() => {
  const root = document.querySelector('[data-testid="markdown-preview"]');
  if (root === null) return { error: 'no-preview' };
  const md = root.classList.contains('pm-markdown') ? root : root.querySelector('.pm-markdown');
  if (md === null) return { error: 'no-markdown' };
  const cs = (el) => (el === null ? null : getComputedStyle(el));
  const prop = (el, p) => (el === null ? null : cs(el).getPropertyValue(p));
  const effBg = (el) => {
    let n = el;
    while (n !== null) {
      const b = getComputedStyle(n).backgroundColor;
      if (b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent') return b;
      n = n.parentElement;
    }
    return null;
  };
  const h1 = md.querySelector('h1'), h2 = md.querySelector('h2'), h3 = md.querySelector('h3');
  const bq = md.querySelector('blockquote');
  const table = md.querySelector('table');
  const th = md.querySelector('th'), td = md.querySelector('td');
  const para = md.querySelector('p');
  const inline = para === null ? null : para.querySelector('code');
  const ul = md.querySelector('ul');
  const lis = md.querySelectorAll('ul > li');
  const li2 = lis.length > 1 ? lis[1] : null;
  const pre = md.querySelector('pre');
  const preCode = pre === null ? null : pre.querySelector('code');
  const kw = md.querySelector('.hljs-keyword');
  const size = (el) => (el === null ? null : Math.round(parseFloat(prop(el, 'font-size')) * 100) / 100);
  const px = (el, p) => (el === null ? null : Math.round(parseFloat(prop(el, p)) * 100) / 100);
  const pad = (el) => {
    if (el === null) return null;
    const parts = prop(el, 'padding').split(/\s+/).map((v) => Math.round(parseFloat(v) * 100) / 100);
    return parts;
  };
  return {
    dataTheme: document.documentElement.dataset.theme ?? null,
    systemDark: window.matchMedia('(prefers-color-scheme: dark)').matches,
    h1: { size: size(h1), marginTop: px(h1, 'margin-top') },
    h2: { size: size(h2), marginTop: px(h2, 'margin-top') },
    h3: { size: size(h3), marginTop: px(h3, 'margin-top') },
    blockquote: { borderLeftWidth: px(bq, 'border-left-width'), borderLeftStyle: prop(bq, 'border-left-style'), background: prop(bq, 'background-color'), padding: pad(bq) },
    table: { borderCollapse: prop(table, 'border-collapse'), thBorderTop: px(th, 'border-top-width'), thPadding: pad(th), thBackground: prop(th, 'background-color'), tdBorderTop: px(td, 'border-top-width'), tdPadding: pad(td) },
    inlineCode: { background: prop(inline, 'background-color'), paraBackground: prop(para, 'background-color'), borderRadius: px(inline, 'border-radius'), padding: pad(inline) },
    list: { paddingLeft: px(ul, 'padding-left'), li2MarginTop: px(li2, 'margin-top') },
    pre: {
      background: prop(pre, 'background-color'),
      containerBackground: effBg(pre === null ? null : pre.parentElement),
      borderTopWidth: px(pre, 'border-top-width'),
      borderRadius: px(pre, 'border-radius'),
      padding: pad(pre),
      overflowX: prop(pre, 'overflow-x'),
      color: prop(pre, 'color'),
      codeColor: prop(preCode, 'color'),
    },
    tokens: { keyword: prop(kw, 'color') },
    overflow: document.documentElement.scrollWidth > window.innerWidth ? 'overflow' : 'none',
  };
})()
"""

VIEWPORT = "`${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio}`"


def shot(name, width, height, dpr, system_dark, app_theme):
    actions = [
        {'type': 'probe', 'name': f'{name}-viewport', 'expression': VIEWPORT},
        {'type': 'wait', 'selector': '[data-testid=pm-split-item]'},
        {'type': 'sleep', 'ms': 1000},
        {'type': 'mouseclick', 'selector': '[data-testid=pm-split-item]'},
        {'type': 'wait', 'selector': '[data-testid=markdown-preview]'},
        {'type': 'sleep', 'ms': 1200},
        # 把 markdown 正文滚到可见处（右栏/移动 Drawer 都有自己的滚动容器）
        {'type': 'eval', 'expression': "(() => { const md = document.querySelector('[data-testid=markdown-preview] .pm-markdown'); if (md !== null) md.scrollIntoView({ block: 'start' }); return true; })()"},
        {'type': 'sleep', 'ms': 500},
        {'type': 'probe', 'name': f'{name}-css', 'expression': MD_CSS},
    ]
    return {
        'name': name, 'path': '/', 'width': width, 'height': height, 'dpr': dpr,
        'auth': True, 'dark': system_dark,
        'storage': {'pm-view-mode': 'split', 'pm-theme': app_theme},
        'waitFor': '[data-testid=pm-search-input]',
        'actions': actions,
        'settleMs': 400,
    }


shots = [
    shot('76-pc-applight-syslight', 1440, 900, 2, False, 'light'),
    shot('76-pc-applight-sysdark', 1440, 900, 2, True, 'light'),
    shot('76-pc-appdark-syslight', 1440, 900, 2, False, 'dark'),
    shot('76-pc-appdark-sysdark', 1440, 900, 2, True, 'dark'),
    shot('76-mobile-applight-syslight', 440, 956, 3, False, 'light'),
    shot('76-mobile-appdark-sysdark', 440, 956, 3, True, 'dark'),
]

json.dump({'chrome': chrome, 'baseUrl': base,
           'cookie': {'name': 'pm_sid', 'value': sid, 'domain': lan_ip},
           'outDir': out_dir, 'dumpsDir': dumps_dir, 'shots': shots},
          open(plan_path, 'w', encoding='utf-8'), ensure_ascii=False)
print(f"  计划已生成：{len(shots)} 个 shot（PC 4 组合 + 移动亮/暗）")
PY

: > "$DUMP_DIR/probes.txt"
echo "--- plan.json ---"
PLAN_OUT=$(node tools/ui-shot.mjs "$PLAN" 2>&1) || { printf '%s\n' "$PLAN_OUT" | tail -40; die "ui-shot 失败"; }
printf '%s\n' "$PLAN_OUT" | grep -E '^(SHOT|PROBE)' 
printf '%s\n' "$PLAN_OUT" >> "$DUMP_DIR/probes.txt"

line "3. 计算样式断言（AC-138 A/B/C/E）"
python3 - "$DUMP_DIR/probes.txt" <<'PY'
import json, re, sys

path = sys.argv[1]
probes = {}
for line in open(path, encoding='utf-8'):
    match = re.match(r'^PROBE (\S+) (.*)$', line.strip())
    if match is not None:
        probes[match.group(1)] = json.loads(match.group(2))

failures = []
checks = 0


def check(name, condition, detail):
    global checks
    checks += 1
    if not condition:
        failures.append(f'{name}：{detail}')


def components(value):
    """padding 简写 → 四边数值（1/2/3/4 段都归一化）。"""
    if value is None:
        return []
    nums = [float(v) if not isinstance(v, str) else float(v.replace('px', '')) for v in value]
    if len(nums) == 1:
        return nums * 4
    if len(nums) == 2:
        return [nums[0], nums[1], nums[0], nums[1]]
    if len(nums) == 3:
        return [nums[0], nums[1], nums[2], nums[1]]
    return nums


def luminance(color):
    match = re.match(r'rgba?\(([^)]+)\)', color or '')
    if match is None:
        return None
    parts = [float(v) for v in re.split(r'[,\s/]+', match.group(1).strip()) if v != '']
    r, g, b = parts[0] / 255, parts[1] / 255, parts[2] / 255

    def channel(c):
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)


combos = [
    ('76-pc-applight-syslight', 'light', False),
    ('76-pc-applight-sysdark', 'light', True),
    ('76-pc-appdark-syslight', 'dark', False),
    ('76-pc-appdark-sysdark', 'dark', True),
    ('76-mobile-applight-syslight', 'light', False),
    ('76-mobile-appdark-sysdark', 'dark', True),
]

keyword_colors = {}
for name, expected_theme, system_dark in combos:
    data = probes.get(f'{name}-css')
    if data is None or 'error' in data:
        failures.append(f'{name}：探针失败 {data}')
        continue

    # ---- AC-138 ⑧：data-theme 是解析后的应用主题（与系统偏好无关）----
    check(f'{name} data-theme', data['dataTheme'] == expected_theme,
          f'期望 {expected_theme}，实际 {data["dataTheme"]}（systemDark={data["systemDark"]}）')
    check(f'{name} 系统偏好已模拟', data['systemDark'] == system_dark,
          f'期望 systemDark={system_dark}，实际 {data["systemDark"]}')

    # ---- A 基础排版 ----
    bq = data['blockquote']
    check(f'{name} ①blockquote 左边框', (bq['borderLeftWidth'] or 0) >= 2 and bq['borderLeftStyle'] != 'none',
          f'width={bq["borderLeftWidth"]} style={bq["borderLeftStyle"]}')
    check(f'{name} ①blockquote 有浅底', bq['background'] is not None and bq['background'] != 'rgba(0, 0, 0, 0)',
          f'background={bq["background"]}')

    table = data['table']
    check(f'{name} ②表格 collapse', table['borderCollapse'] == 'collapse', f'实际 {table["borderCollapse"]}')
    check(f'{name} ②单元格边框 ≥1px', (table['thBorderTop'] or 0) >= 1 and (table['tdBorderTop'] or 0) >= 1,
          f'th={table["thBorderTop"]} td={table["tdBorderTop"]}')
    check(f'{name} ②单元格 padding ≥4px',
          min(components(table['thPadding']) + components(table['tdPadding'])) >= 4,
          f'th={table["thPadding"]} td={table["tdPadding"]}')
    check(f'{name} ②表头浅底', table['thBackground'] not in (None, 'rgba(0, 0, 0, 0)'),
          f'实际 {table["thBackground"]}')

    h1, h2, h3 = data['h1'], data['h2'], data['h3']
    check(f'{name} ③h1>h2>h3', h1['size'] > h2['size'] > h3['size'],
          f'{h1["size"]} / {h2["size"]} / {h3["size"]}')
    check(f'{name} ③标题 margin≠0', all((h['marginTop'] or 0) != 0 for h in (h1, h2, h3)),
          f'{h1["marginTop"]} / {h2["marginTop"]} / {h3["marginTop"]}')

    inline = data['inlineCode']
    check(f'{name} ④行内 code 有底色', inline['background'] != inline['paraBackground'],
          f'code={inline["background"]} p={inline["paraBackground"]}')
    check(f'{name} ④行内 code 圆角/padding', (inline['borderRadius'] or 0) > 0 or sum(components(inline['padding'])) > 0,
          f'radius={inline["borderRadius"]} padding={inline["padding"]}')

    lst = data['list']
    check(f'{name} ⑤列表缩进', (lst['paddingLeft'] or 0) > 0, f'paddingLeft={lst["paddingLeft"]}')
    check(f'{name} ⑤相邻 li 间距', (lst['li2MarginTop'] or 0) > 0, f'marginTop={lst["li2MarginTop"]}')

    # ---- B 代码块「有面」----
    pre = data['pre']
    check(f'{name} ⑥pre 与容器底色不同', pre['background'] != pre['containerBackground'],
          f'pre={pre["background"]} 容器={pre["containerBackground"]}')
    check(f'{name} ⑥pre 边框/圆角', (pre['borderTopWidth'] or 0) >= 1 or (pre['borderRadius'] or 0) > 0,
          f'border={pre["borderTopWidth"]} radius={pre["borderRadius"]}')
    check(f'{name} ⑥pre padding ≥8px', min(components(pre['padding'])) >= 8, f'padding={pre["padding"]}')
    check(f'{name} ⑦pre 横向可滚', pre['overflowX'] in ('auto', 'scroll'), f'overflowX={pre["overflowX"]}')
    check(f'{name} ⑦页面无横向滚动', data['overflow'] == 'none', f'overflow={data["overflow"]}')

    # ---- C 主题联动：应用亮 ⇒ 浅底深字；应用暗 ⇒ 深底浅字 ----
    pre_lum = luminance(pre['background'])
    text_lum = luminance(pre['color'])
    if expected_theme == 'dark':
        check(f'{name} ⑨暗色代码块（深底浅字）', pre_lum is not None and text_lum is not None and pre_lum < text_lum,
              f'pre底亮度={pre_lum} 文字亮度={text_lum}')
    else:
        check(f'{name} ⑨亮色代码块（浅底深字）', pre_lum is not None and text_lum is not None and pre_lum > text_lum,
              f'pre底亮度={pre_lum} 文字亮度={text_lum}')

    keyword = data['tokens']['keyword']
    keyword_colors.setdefault(expected_theme, set()).add(keyword)
    check(f'{name} ⑩token 色非空', isinstance(keyword, str) and keyword.startswith('rgb'), f'keyword={keyword}')

# ---- AC-138 ⑩：token 色跟随应用主题（亮/暗两套值必须不同）----
light_keywords = keyword_colors.get('light', set())
dark_keywords = keyword_colors.get('dark', set())
check('⑩ token 色随主题变化',
      len(light_keywords) == 1 and len(dark_keywords) == 1 and light_keywords != dark_keywords,
      f'亮={sorted(light_keywords)} 暗={sorted(dark_keywords)}')

# ---- 关键实测值打印（PROGRESS 要原样贴）----
for name, expected_theme, _ in combos:
    data = probes.get(f'{name}-css') or {}
    if 'error' in data or not data:
        continue
    pre = data['pre']
    print(f"  {name}: data-theme={data['dataTheme']} pre.bg={pre['background']} pre.color={pre['color']} "
          f"kw={data['tokens']['keyword']} h={data['h1']['size']}/{data['h2']['size']}/{data['h3']['size']} "
          f"overflow={data['overflow']}")

if failures:
    print(f"\n❌ 计算样式断言失败 {len(failures)} 条：")
    for failure in failures:
        print('  - ' + failure)
    sys.exit(1)
print(f"\n✅ 计算样式断言全部通过（{checks} 条，6 个 shot）")
PY
[ $? -eq 0 ] || die "计算样式断言失败"

line "4. 收尾"
echo "  截图：$OUT_DIR"
ls -l "$ROOT/$OUT_DIR"/*.png | awk '{print "    " $5 " B  " $9}'
echo
echo "=== ✅ ALL STAGE76 ACCEPTANCE CHECKS PASSED ==="
