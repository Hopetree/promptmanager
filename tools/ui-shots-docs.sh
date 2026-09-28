#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# docs/shots 关键展示图刷新（用户 2026-09-28 要求）
#
#   「docs/shots 下面的截图都太老了，也不清晰……使用测试环境的数据重新截图更新到这里……
#     照我们给的尺寸截图」
#
# 与 tools/ui-shots.sh 的区别（**不改它**，它在被 AC 脚本使用）：
#   · ui-shots.sh    ：**自起临时实例 + 临时 DATA_DIR**，尺寸 1280×800 / DPR 1（自证用）
#   · 本脚本（--key）：**打测试环境 8767**（真实数据），尺寸按规范 + DPR 2/3（给人看的展示图）
#
# 规范尺寸（/root/greenhouse/STANDARDS.md §5.2、BRIEF 双端交付基线）：
#   PC  ≡ 1440 × 900 CSS px @ DPR 2（MacBook Air M1 13.3"）
#   移动 ≡ 440 × 956 CSS px @ DPR 3（iPhone 17 Pro Max）
#
# 用法（228 上）：
#   bash tools/ui-shots-docs.sh              # 产 8 张 → docs/shots/（旧的归档到 tmp/）
#   bash tools/ui-shots-docs.sh --dry-run    # 只打印计划
# ══════════════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1

APP_URL="${UI_URL:-http://127.0.0.1:8767}"
OUT_DIR="${OUT_DIR:-docs/shots}"
ARCHIVE="tmp/shots-archive/docs-shots"
STAMP="$(date +%Y-%m-%d-%H%M%S)"
PLAN="$(mktemp /tmp/pm-shots-plan.XXXXXX.json)"
PW_FILE="${PM_TEST_PASS_FILE:-/root/.pm-test-pass}"
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

die() { echo "ERROR: $*" >&2; exit 1; }

[ -r "$PW_FILE" ] || die "读不到测试环境口令：$PW_FILE（先 node bin/pm.mjs user set-password --username admin -- 注意 DATA_DIR）"
PASS="$(cat "$PW_FILE")"
[ -n "$PASS" ] || die "口令为空：$PW_FILE"

echo "目标 : $APP_URL"
echo "输出 : $OUT_DIR"
echo "存档 : $ARCHIVE/$STAMP"

# ── 登录拿 cookie ────────────────────────────────────────────────────────────
SID="$(curl -s -m 15 -D- -o /dev/null -X POST "$APP_URL/api/login" \
  -H 'content-type: application/json' \
  -d "$(python3 -c "import json,sys;print(json.dumps({'username':'admin','password':sys.argv[1]}))" "$PASS")" \
  | tr -d '\r' | awk 'tolower($1)=="set-cookie:"{print $2}' | head -1 | cut -d';' -f1)"
[ -n "$SID" ] || die "登录失败（没拿到 cookie）—— 检查 $APP_URL 与 $PW_FILE 的口令"
echo "登录 : ok（cookie 长度 ${#SID}）"

# ── 组装 plan（8 张关键展示图，尺寸/DPR 按规范）──────────────────────────────
python3 - "$PLAN" "$OUT_DIR" "$SID" "$APP_URL" <<'PY'
import json, sys
plan_path, out_dir, sid, app_url = sys.argv[1:5]
PC_W, PC_H, PC_DPR = 1440, 900, 2
MB_W, MB_H, MB_DPR = 440, 956, 3

def shot(name, *, width, height, dpr, auth=True, dark=False, view=None, scroll_to=None, actions=None):
    acts = []
    if view is not None:
        acts += [
            {'type': 'eval', 'expression':
             "(() => {const seg=document.querySelector('[data-testid=pm-use-viewmode]');"
             "if(!seg) return false;const it=[...seg.querySelectorAll('.ant-segmented-item')]"
             ".find(e=>e.innerText.includes(%r));if(it){it.click();return true;}return false;})()" % view},
            {'type': 'sleep', 'ms': 800},
        ]
    if scroll_to is not None:
        acts += [
            {'type': 'eval', 'expression':
             "(() => {const el=document.querySelector(%r);if(el){el.scrollIntoView({block:'end'});return true;}return false;})()" % scroll_to},
            {'type': 'sleep', 'ms': 500},
        ]
    if actions:
        acts += actions
    return {
        'name': name, 'path': '/', 'width': width, 'height': height, 'dpr': dpr,
        'auth': auth, 'dark': dark,
        'storage': {'pm-theme': 'dark' if dark else 'light',
                    **({'pm-view-mode': view} if view in ('split', 'table', 'card') else {})},
        'waitFor': '[data-testid=pm-login]' if not auth else '[data-testid=pm-search-input]',
        'settleMs': 900,
        **({'actions': acts} if acts else {}),
    }

shots = [
    # 01 登录页（未登录；PC）
    shot('01-login', width=PC_W, height=PC_H, dpr=PC_DPR, auth=False),
    # 02 分栏（默认落地视图）
    shot('02-split', width=PC_W, height=PC_H, dpr=PC_DPR, view='split'),
    # 03 表格视图
    shot('03-table', width=PC_W, height=PC_H, dpr=PC_DPR, view='table'),
    # 04 卡片视图
    shot('04-cards', width=PC_W, height=PC_H, dpr=PC_DPR, view='card'),
    # 05 编辑器（点「新建」打开）
    shot('05-editor', width=PC_W, height=PC_H, dpr=PC_DPR, actions=[
        {'type': 'eval', 'expression':
         "(() => {const b=[...document.querySelectorAll('button')]"
         ".find(e=>/新建|新增/.test(e.innerText));if(b){b.click();return true;}return false;})()"},
        {'type': 'sleep', 'ms': 1000},
    ]),
    # 06 详情面（右栏滚到底：版本历史 + 底部操作条）
    shot('06-detail', width=PC_W, height=PC_H, dpr=PC_DPR, view='split',
         scroll_to='[data-testid=pm-detail-actions]'),
    # 07 移动端（440×956 @ DPR3；默认卡片）
    shot('07-mobile', width=MB_W, height=MB_H, dpr=MB_DPR),
    # 08 暗色（PC；分栏）
    shot('08-dark', width=PC_W, height=PC_H, dpr=PC_DPR, dark=True, view='split'),
]
# ui-shot.mjs 必需的顶层字段：outDir / dumpsDir / baseUrl / shots（chrome 缺省时自动探测）
json.dump({
    'outDir': out_dir,
    'dumpsDir': 'tmp/ui-shots-dumps',
    'cookie': {'name': sid.split('=')[0], 'value': sid.split('=', 1)[1], 'domain': '127.0.0.1'},
    'baseUrl': app_url,
    'shots': shots,
}, open(plan_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print('PLAN shots=%d' % len(shots))
PY

if [ "$DRY" = "1" ]; then
  echo "── 计划（dry-run，不执行）──"
  python3 -c "
import json,sys
d=json.load(open('$PLAN'))
for s in d['shots']:
    print('  %-11s %sx%s @DPR%s  %s' % (s['name'], s['width'], s['height'], s['dpr'], 'dark' if s.get('dark') else ''))
"
  exit 0
fi

# ── 归档旧图（只留一套）────────────────────────────────────────────────────
if ls "$OUT_DIR"/*.png >/dev/null 2>&1; then
  mkdir -p "$ARCHIVE/$STAMP"
  mv "$OUT_DIR"/*.png "$ARCHIVE/$STAMP/"
  echo "旧图已归档：$(ls -1 "$ARCHIVE/$STAMP"/*.png | wc -l) 张 → $ARCHIVE/$STAMP/"
fi
mkdir -p "$OUT_DIR" tmp/ui-shots-dumps

# ── 截图 ────────────────────────────────────────────────────────────────────
node tools/ui-shot.mjs "$PLAN"

echo
echo "── 产物 ──"
for f in "$OUT_DIR"/*.png; do
  [ -f "$f" ] || continue
  python3 -c "
import struct, sys
p = sys.argv[1]
with open(p,'rb') as fh:
    fh.seek(16)
    w, h = struct.unpack('>II', fh.read(8))
print('  %-16s %4dx%-5d %6.1f KB' % (p.split('/')[-1], w, h, __import__('os').path.getsize(p)/1024))
" "$f"
done
