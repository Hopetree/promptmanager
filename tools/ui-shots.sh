#!/usr/bin/env bash
# 阶段 8 界面自证（AC-13）：**服务自起自停** + 零安装 headless chromium 截图 + 渲染后 DOM dump（供 AC-21 用）。
#
# ⚠️ 输出约定（FR-84 / `/root/greenhouse/STANDARDS.md` §5.2，2026-09-21 用户定）：
#   `docs/` 只放「**最终状态的、给人看的**」东西 ⇒ `docs/shots/` **只保留一套关键页面展示图（8 张）**；
#   **过程/自证截图一律落 `tmp/`**（`tmp/` 在 `.gitignore` 里 ⇒ **不入库**，本地可随时查）。
#   因此：
#     - 默认（无参数）= **自证模式**：全套 **53** 张（主 plan 52 + 空态 1）落 `tmp/ui-shots/shots/`（给过程用，不进 git）；
#     - `--key` = **发版 / 交付模式**：只产一套「关键页面展示图」（8 张，见下方 KEY_SET）到 `docs/shots/`，
#       且**只留一套** —— 产之前先把 `docs/shots/*.png` 旧图整体归档到 `tmp/shots-archive/docs-shots/`。
#   判据（一句话）：**"最终交付 / 文档"（给人看）⇒ `docs/`；"过程中的临时产物"（给过程用）⇒ `tmp/`。**
#
# 用法：
#   bash tools/ui-shots.sh                 # 自证模式：全套 → tmp/ui-shots/shots/（默认，不入库）
#   bash tools/ui-shots.sh --key           # 发版模式：8 张关键展示图 → docs/shots/（旧的先归档到 tmp/）
#   bash tools/ui-shots.sh <输出目录>       # 显式指定输出目录（阶段脚本传 tmp/shots/stage<N> 之类）
#
# 设计口径：
# - 临时 DATA_DIR + 临时端口占用检查，**不碰生产数据**；跑完删临时目录、杀自己起的进程；
# - 会话 cookie 走**真实的** POST /api/login，不给服务端加截图后门；
# - 截图由 tools/ui-shot.mjs（Node 内置 WebSocket + CDP）完成，**不装 puppeteer/playwright**；
# - 不新增任何监听端口（仍是 8767，且脚本前后都会核对）。
set -u

cd "$(dirname "$0")/.." || exit 1

# ---- 参数解析（FR-84 ③）：默认 tmp/（自证）；--key = 发版前的一套关键展示图 → docs/shots/ ----
MODE=full
OUT_DIR=''
for arg in "$@"; do
  case "$arg" in
    --key|key) MODE=key ;;
    *) OUT_DIR="$arg" ;;
  esac
done
if [ -z "$OUT_DIR" ]; then
  if [ "$MODE" = "key" ]; then OUT_DIR='docs/shots'; else OUT_DIR='tmp/ui-shots/shots'; fi
fi
PORT=${PORT:-auto}
DUMP_DIR=${DUMP_DIR:-tmp/ui-shots}
# 发版模式：先把旧的展示图整体归档到 tmp/（"只留一套"），再产新的一套
if [ "$MODE" = "key" ]; then
  ARCHIVE='tmp/shots-archive/docs-shots'
  if ls "$OUT_DIR"/*.png >/dev/null 2>&1; then
    mkdir -p "$ARCHIVE"
    # 用日期前缀避免多次归档互相覆盖；归档是**移动**（不入库）
    STAMP=$(date +%Y-%m-%d-%H%M%S)
    mkdir -p "$ARCHIVE/$STAMP"
    mv "$OUT_DIR"/*.png "$ARCHIVE/$STAMP/"
    echo "  旧展示图已归档：$OUT_DIR/*.png → $ARCHIVE/$STAMP/（$(ls -1 "$ARCHIVE/$STAMP"/*.png | wc -l) 张）"
  fi
  echo "  发版模式：只产一套关键页面展示图（8 张）→ $OUT_DIR"
else
  echo "  自证模式：全套截图 → $OUT_DIR（tmp/ 不入库）"
fi
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

line() { printf '\n=== %s ===\n' "$1"; }
die() { printf 'FAIL %s\n' "$1"; exit 1; }

AC_DIR=$(mktemp -d /tmp/pm-shots-XXXXXX)
SRV_PID=''
SRV_LOG="$AC_DIR/server.log"
JAR="$AC_DIR/jar.txt"
PLAN="$AC_DIR/plan.json"
PLAN_EMPTY="$AC_DIR/plan-empty.json"
EXPORT_FIXTURE="$AC_DIR/export-fixture.json"

cleanup() {
  if [ -n "$SRV_PID" ]; then
    kill "$SRV_PID" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      kill -0 "$SRV_PID" 2>/dev/null || break
      sleep 0.3
    done
    kill -9 "$SRV_PID" 2>/dev/null || true
  fi
  rm -rf "$AC_DIR"
}
trap cleanup EXIT

line "0. 前置检查（端口纪律 / 构建产物）"
if ss -ltn | grep -q ":$PORT "; then
  ss -ltn | grep ":$PORT " || true
  die "端口 $PORT 已被占用 —— 先用 sudo ss -ltnp 查明占用者，不要抢别人的端口"
fi
echo "  端口 $PORT 空闲（ss -ltn 无 :$PORT 监听）"

if [ ! -f dist/web/index.html ] || [ -n "$(find web/src -newer dist/web/index.html -print -quit)" ]; then
  echo "  dist/web 缺失或前端源码比产物新 → npm run build"
  npm run build >/dev/null 2>&1 || die "npm run build 失败"
fi
echo "  dist/web 已是最新（index.html=$(stat -c %y dist/web/index.html | cut -d. -f1)）"

line "1. 起临时服务（DATA_DIR=$AC_DIR，自起自停）"
printf '%s\n' "$AC_PW" | DATA_DIR="$AC_DIR" node bin/pm.mjs user set-password --username admin >/dev/null \
  || die "建库 / 设口令失败"
DATA_DIR="$AC_DIR" PORT="$PORT" node dist/server/index.js >>"$SRV_LOG" 2>&1 &
SRV_PID=$!
CODE=''
for _ in $(seq 1 60); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/healthz" 2>/dev/null || true)
  [ "$CODE" = "200" ] && break
  sleep 0.3
done
[ "$CODE" = "200" ] || die "服务未起来（日志见 $SRV_LOG；保留在临时目录里会随清理删除，请重跑并看 stderr）"
echo "SERVICE pid=$SRV_PID url=$BASE healthz=200 data_dir=$AC_DIR"

line "2. 登录拿会话 cookie（真实 POST /api/login）"
curl -s -c "$JAR" -o /dev/null -X POST -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$AC_PW\"}" "$BASE/api/login" || die "登录请求失败"
SID=$(awk '$6 == "pm_sid" { print $7 }' "$JAR" | tail -1)
[ -n "$SID" ] || die "登录响应里没有 pm_sid cookie"
echo "SID 长度=${#SID}（不打印明文）"

# chrome 路径两种模式都要用（原先写在空态块里，发版模式下会漏定义 ⇒ 提到条件外）
CHROME=$(ls -d /root/.cache/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell 2>/dev/null | sort | tail -1)
[ -n "$CHROME" ] || die "找不到 chrome-headless-shell（见 BRIEF §6.8）"

# 空态截图只在**自证模式**跑（发版模式只产 8 张关键页面展示图，不含空态）
if [ "$MODE" = "full" ]; then
line "2a. 空态截图（**先于夹具**：库为空时才会出现 72 品牌图形）"
python3 - "$PLAN_EMPTY" "$OUT_DIR" "$DUMP_DIR" "$BASE" "$SID" "$CHROME" <<'PYPLAN' || die "生成空态计划失败"
import json
import sys

plan_path, out_dir, dumps_dir, base, sid, chrome = sys.argv[1:7]

shots = [
    {'name': '50-empty-state', 'path': '/', 'width': 1280, 'height': 800, 'auth': True,
     'storage': {'pm-view-mode': 'split', 'pm-theme': 'light'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'wait', 'selector': '[data-testid=pm-brand-art-empty]'},
         {'type': 'sleep', 'ms': 700},
         {'type': 'probe', 'name': 'empty-art',
          'expression': '(() => { const el = document.querySelector("[data-testid=pm-brand-art-empty]"); if (el === null) return "missing"; const r = el.getBoundingClientRect(); return JSON.stringify({ src: el.getAttribute("src"), w: Math.round(r.width), hidden: el.getAttribute("aria-hidden") }); })()'},
     ],
     'dump': 'empty-state', 'settleMs': 700},
]

plan = {
    'chrome': chrome,
    'baseUrl': base,
    'cookie': {'name': 'pm_sid', 'value': sid, 'domain': '127.0.0.1'},
    'outDir': out_dir,
    'dumpsDir': dumps_dir,
    'shots': shots,
}
with open(plan_path, 'w', encoding='utf-8') as handle:
    json.dump(plan, handle, ensure_ascii=False, indent=2)
print('PLAN(empty) shots=%d' % len(shots))
PYPLAN
node tools/ui-shot.mjs "$PLAN_EMPTY" || die "空态截图失败"
else
  echo "  发版模式：跳过空态截图（不在关键展示图清单内）"
fi

line "3. 造夹具数据（文件夹 / 标签 / prompt / 版本 / 导出文件）"
python3 - "$BASE" "$SID" "$EXPORT_FIXTURE" <<'PY' || die "夹具数据创建失败"
import json
import sys
import urllib.request

base, sid, export_path = sys.argv[1], sys.argv[2], sys.argv[3]


def call(method, path, body=None):
    data = None if body is None else json.dumps(body).encode('utf-8')
    request = urllib.request.Request(
        base + path,
        data=data,
        method=method,
        headers={'Content-Type': 'application/json', 'Cookie': 'pm_sid=' + sid},
    )
    with urllib.request.urlopen(request) as response:
        raw = response.read()
        return json.loads(raw.decode('utf-8')) if raw else None


work = call('POST', '/api/folders', {'name': '工作'})
ops = call('POST', '/api/folders', {'name': '运维', 'parent_id': work['id']})
for name in ('交接', '发布', '排障', '评审', '写作', '前端', '测试', '运维'):
    call('POST', '/api/tags', {'name': name})

first = call('POST', '/api/prompts', {
    'title': '会话交接模板',
    'user_prompt': (
        '你是 {{项目}} 项目的交接助手。请把当前工作上下文整理成交接文档。\n\n'
        '## 要求\n'
        '- 交接人：{{姓名}}\n'
        '- 必须包含：**已完成**、**进行中**、**下一步**\n'
        '- 风险点用 `[!]` 标出，并给出回滚办法\n\n'
        '```bash\n# 交接前先确认服务健康\ncurl -s http://127.0.0.1:8767/healthz\n```\n'
    ),
    'system_prompt': '你是严谨的工程交接助手，只写事实，不编造进度。',
    'notes': '每周五下班前用一次；交接文档发给 {{姓名}} 的接任者。',
    'folder_id': ops['id'],
    'tags': ['交接', '发布'],
    'favorite': True,
})
call('POST', '/api/prompts', {
    'title': '代码评审助手',
    'user_prompt': (
        '请评审下面这段代码，先给结论，再逐条列问题：\n\n'
        '1. 正确性（边界 / 并发 / 错误处理）\n'
        '2. 可读性（命名 / 分层 / 注释）\n'
        '3. 测试缺口\n\n```ts\nconst rows = await qe.selectFrom("prompts").selectAll().execute();\n```\n'
    ),
    'system_prompt': '你是一名严格的资深工程师，评审意见必须可执行。',
    'notes': '评审输出按「阻塞 / 建议 / 可选」三档。',
    'folder_id': work['id'],
    'tags': ['发布'],
})
call('POST', '/api/prompts', {
    'title': '发布前自检清单',
    'user_prompt': '发布前逐项确认：\n\n- [ ] 测试全绿（npm test）\n- [ ] 迁移幂等（migrate 跑两次）\n- [ ] 备份已导出\n- [ ] 回滚步骤已写清',
    'system_prompt': '',
    'notes': '面向单机自托管场景；不需要灰度和多环境。',
    'folder_id': work['id'],
    'tags': ['发布'],
})
call('POST', '/api/prompts', {
    'title': '排障：FTS5 trigram 子串检索',
    'user_prompt': '当用户反馈「中文搜不到」时，按序排查：\n\n1. 查询词长度是否 <3（走 LIKE 兜底）\n2. FTS 索引是否随写入同步\n3. 特殊字符是否被当字面短语处理',
    'notes': '2 字符查询命中 0 是 trigram 的已知下限，不是 bug。',
    'folder_id': work['id'],
    'tags': ['排障'],
})
call('POST', '/api/prompts', {
    'title': '周报生成器',
    'user_prompt': '把本周的 git log 与 issue 列表整理成周报，分「交付 / 进行中 / 风险」三节，每节不超过 5 条。',
    'notes': '输出用中文，避免流水账。',
    'folder_id': work['id'],
    'tags': ['交接'],
})
for index in range(1, 5):
    call('POST', '/api/prompts', {
        'title': f'常用片段 {index}：SQL 与迁移',
        'user_prompt': f'片段 {index}：把下面的 SQL 改写成 Kysely 查询，保持语义一致。\n\n```sql\nselect id, title from prompts where favorite = 1 limit {index * 10};\n```',
        'notes': '迁移一律写幂等 SQL。',
        'folder_id': work['id'],
        'tags': ['发布'],
    })

# 让第 1 条产生 v2 / v3，供版本面板的 diff 截图使用
call('PUT', '/api/prompts/%d' % first['id'], {'notes': '每周五下班前用一次；交接文档发给接任者，并抄送 {{项目}} 负责人。'})
call('PUT', '/api/prompts/%d' % first['id'], {
    'notes': '每周五下班前用一次；交接文档发给接任者，并抄送 {{项目}} 负责人。\n补充：交接后 24 小时内确认对方已跑通。',
})

exported = call('GET', '/api/export')
with open(export_path, 'w', encoding='utf-8') as handle:
    json.dump(exported, handle, ensure_ascii=False, indent=2)

prompts = call('GET', '/api/prompts?limit=200')
print('SEED prompts=%d folders=2 tags=3 versions(v1..v3)=3 export=%s'
      % (prompts['total'], export_path))
PY

line "4. 生成截图计划并驱动 headless chromium"
echo "  chrome=$CHROME"

python3 - "$PLAN" "$OUT_DIR" "$DUMP_DIR" "$BASE" "$SID" "$EXPORT_FIXTURE" "$CHROME" "$AC_PW" "$MODE" <<'PY' || die "生成 plan.json 失败"
import json
import sys

plan_path, out_dir, dumps_dir, base, sid, export_fixture, chrome, fixture_pw, mode = sys.argv[1:10]

REPLACE_SENTENCE = '将清空现有全部 prompt / 文件夹 / 标签 / 版本历史'

# FR-84 ①：发版模式下只产这套「关键页面展示图」（源 = 下面 shots 列表里的既有定义，只改文件名）。
# 覆盖 AC-86 要求的 8 个主题：登录 / 分栏 / 表格 / 卡片 / 编辑器 / 详情面 / 移动端 / 暗色。
KEY_SET = [
    ('01-login', '01-login'),            # 登录页
    ('32-split', '02-split'),            # 分栏（默认落地视图；右栏详情顶部：标题/备注/元信息行/页签/正文）
    ('02-list', '03-table'),             # 表格视图
    ('20-use-light', '04-cards'),        # 卡片视图
    ('03-editor', '05-editor'),          # 编辑器
    ('key-detail', '06-detail'),         # 详情面（分栏右栏下半：版本历史 + 底部固定操作条）
    ('05-mobile-list', '07-mobile'),     # 移动端 390×844
    ('40-dark-sidebar', '08-dark'),      # 暗色
]

# 关键展示图专用定义（不进自证全套）：详情面取**第一条**（会话交接模板：含变量/Markdown/文件夹/标签），
# 并把右栏滚到底 —— 与 02-split（右栏顶部）互补，展示版本历史 + 底部固定操作条。
KEY_EXTRA = {
    'key-detail': {
        'name': 'key-detail', 'path': '/', 'width': 1280, 'height': 800, 'auth': True,
        'storage': {'pm-view-mode': 'split', 'pm-theme': 'light'},
        'waitFor': '[data-testid=pm-search-input]',
        'actions': [
            {'type': 'wait', 'selector': '[data-testid=pm-view-split]'},
            {'type': 'sleep', 'ms': 900},
            {'type': 'eval',
             'expression': '(() => { const it = document.querySelector("[data-testid=pm-split-item]"); if (it) { it.click(); return true; } return false; })()'},
            {'type': 'sleep', 'ms': 900},
            {'type': 'eval',
             'expression': '(() => { const el = document.querySelector("[data-testid=pm-detail-actions]"); if (el) el.scrollIntoView({ block: "end" }); return true; })()'},
            {'type': 'sleep', 'ms': 600},
        ],
        'settleMs': 800,
    },
}

shots = [
    # 登录页（方向 B｜apple-minimal 的极简：留白 + 大标题 + 胶囊按钮）
    {'name': '01-login', 'path': '/', 'width': 1280, 'height': 800, 'auth': False,
     'waitFor': '[data-testid=pm-login]', 'settleMs': 500},

    # 表格视图（v17 主界面）：行内「复制 / 编辑 / 删除」——管理动作并入表格（FR-43 / AC-41）
    {'name': '02-list', 'path': '/', 'width': 1280, 'height': 800, 'auth': True,
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'view', 'label': '表格'},
         {'type': 'sleep', 'ms': 500},
         {'type': 'probe', 'name': 'table-edit-count',
          'expression': 'document.querySelectorAll("[data-testid^=pm-edit-]").length'},
         {'type': 'probe', 'name': 'table-delete-count',
          'expression': 'document.querySelectorAll("[data-testid^=pm-delete-]").length'},
     ],
     'dump': 'table', 'settleMs': 700},

    # 编辑器（亮）：三栏常驻（左列表 / 中表单 / 右三面板）——从表格行内「编辑」进入
    {'name': '03-editor', 'path': '/', 'width': 1280, 'height': 800, 'auth': True,
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'view', 'label': '表格'},
         {'type': 'sleep', 'ms': 400},
         {'type': 'eval',
          'expression': '(() => { const b = document.querySelector("[data-testid^=pm-edit-]"); if (!b) return false; b.click(); return true; })()'},
         {'type': 'wait', 'selector': '[data-testid=pm-editor]'},
         {'type': 'wait', 'selector': '[data-testid=pm-panel-versions]'},
         {'type': 'probe', 'name': 'panels',
          'expression': 'document.querySelectorAll("[data-testid^=pm-panel-]").length'},
         {'type': 'probe', 'name': 'tabs',
          'expression': 'document.querySelectorAll(".ant-tabs-tab").length'},
     ],
     'dump': 'editor', 'settleMs': 900},

    # 搜索结果（大搜索框）
    {'name': '04-search', 'path': '/', 'width': 1280, 'height': 800, 'auth': True,
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'type', 'selector': '[data-testid=pm-search-input]', 'text': '交接'},
         {'type': 'sleep', 'ms': 900},
         {'type': 'probe', 'name': 'search-box-value',
          'expression': 'document.querySelector("[data-testid=pm-search-input]").value'},
     ],
     'settleMs': 500},

    # 移动端 390×844：分栏的单栏降级（只见列表，点条目进详情）
    {'name': '05-mobile-list', 'path': '/', 'width': 390, 'height': 844, 'auth': True,
     'storage': {'pm-view-mode': 'split'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'wait', 'selector': '[data-testid=pm-split-list]'},
         {'type': 'sleep', 'ms': 500},
         {'type': 'probe', 'name': 'mobile-split-detail-absent',
          'expression': '!document.querySelector("[data-testid=pm-detail]")'},
         {'type': 'probe', 'name': 'mobile-split-overflow',
          'expression': 'document.documentElement.scrollWidth > window.innerWidth + 1'},
     ],
     'dump': 'mobile-list', 'settleMs': 600},

    # 表格视图（暗）
    {'name': '06-dark-list', 'path': '/', 'width': 1280, 'height': 800, 'auth': True, 'dark': True,
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'view', 'label': '表格'},
         {'type': 'sleep', 'ms': 500},
     ],
     'settleMs': 600},

    # 版本历史面板特写（滚动右侧检查器列）
    {'name': '07-versions', 'path': '/', 'width': 1280, 'height': 800, 'auth': True,
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'view', 'label': '表格'},
         {'type': 'sleep', 'ms': 400},
         {'type': 'eval',
          'expression': '(() => { const b = document.querySelector("[data-testid^=pm-edit-]"); if (!b) return false; b.click(); return true; })()'},
         {'type': 'wait', 'selector': '[data-testid=pm-panel-versions]'},
         {'type': 'eval',
          'expression': 'document.querySelector("[data-testid=pm-panel-versions]").scrollIntoView({block:"start"})'},
         {'type': 'sleep', 'ms': 500},
         {'type': 'probe', 'name': 'diff-lines',
          'expression': 'document.querySelector("[data-testid=diff-view]").innerText.split("\\n").length'},
     ],
     'settleMs': 600},

    # 变量填值面板特写（填值 + 渲染）
    {'name': '08-variables', 'path': '/', 'width': 1280, 'height': 800, 'auth': True,
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'view', 'label': '表格'},
         {'type': 'sleep', 'ms': 400},
         {'type': 'eval',
          'expression': '(() => { const b = document.querySelector("[data-testid^=pm-edit-]"); if (!b) return false; b.click(); return true; })()'},
         {'type': 'wait', 'selector': '[data-testid=pm-panel-variables]'},
         {'type': 'eval',
          'expression': 'document.querySelector("[data-testid=pm-panel-variables]").scrollIntoView({block:"start"})'},
         {'type': 'wait', 'selector': '[data-testid=render-submit]'},
         {'type': 'type', 'selector': '[data-testid="var-姓名"]', 'text': '张三'},
         {'type': 'type', 'selector': '[data-testid="var-项目"]', 'text': 'greenhouse'},
         {'type': 'click', 'selector': '[data-testid=render-submit]'},
         {'type': 'wait', 'selector': '[data-testid=copy-user]'},
         {'type': 'probe', 'name': 'render-result',
          'expression': 'document.querySelector("[data-testid=copy-user]").closest(".ant-card").querySelector("textarea").value.replace(/\\n/g, " | ").slice(0, 80)'},
     ],
     'settleMs': 700},

    # 导入 / 导出（入口在顶栏「⋯更多」；含 replace 二次确认，FR-11b 文案逐字保留）
    {'name': '09-import-confirm', 'path': '/', 'width': 1280, 'height': 800, 'auth': True,
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'menu', 'label': '导入'},
         {'type': 'wait', 'selector': '.ant-upload-drag'},
         {'type': 'file', 'selector': 'input[type=file]', 'files': [export_fixture]},
         {'type': 'wait', 'text': '导入模式'},
         {'type': 'eval',
          'expression': '[...document.querySelectorAll(".ant-segmented-item")].find(function (n) { return n.innerText.indexOf("replace") >= 0; }).click()'},
         {'type': 'wait', 'text': REPLACE_SENTENCE},
         {'type': 'click', 'selector': '[data-testid=import-submit]'},
         {'type': 'wait', 'selector': '.ant-modal-confirm'},
         {'type': 'probe', 'name': 'confirm-text',
          'expression': 'document.querySelector(".ant-modal-confirm").innerText.replace(/\\n/g, " | ")'},
     ],
     'settleMs': 700},

    # 移动端编辑器（抽屉）
    {'name': '10-mobile-editor', 'path': '/', 'width': 390, 'height': 844, 'auth': True,
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'view', 'label': '卡片'},
         {'type': 'sleep', 'ms': 400},
         {'type': 'eval',
          'expression': '(() => { const c = document.querySelector("[data-testid=pm-use-card]"); c.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); return true; })()'},
         {'type': 'wait', 'selector': '[data-testid=pm-detail-actions]'},
         {'type': 'click', 'selector': '[data-testid=pm-detail-edit]'},
         {'type': 'wait', 'selector': '[data-testid=pm-editor]'},
     ],
     'settleMs': 900},

    # Markdown 预览面板特写
    {'name': '11-markdown', 'path': '/', 'width': 1280, 'height': 800, 'auth': True,
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'view', 'label': '表格'},
         {'type': 'sleep', 'ms': 400},
         {'type': 'eval',
          'expression': '(() => { const b = document.querySelector("[data-testid^=pm-edit-]"); if (!b) return false; b.click(); return true; })()'},
         {'type': 'wait', 'selector': '[data-testid=pm-panel-markdown]'},
         {'type': 'eval',
          'expression': 'document.querySelector("[data-testid=pm-panel-markdown]").scrollIntoView({block:"start"})'},
         {'type': 'wait', 'selector': '[data-testid=markdown-preview]'},
     ],
     'settleMs': 900},

    # API 令牌抽屉（入口在「⋯更多」）
    {'name': '12-tokens', 'path': '/', 'width': 1280, 'height': 800, 'auth': True,
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'menu', 'label': 'API 令牌'},
         # antd 6.6.4 的抽屉根是 .ant-drawer（内层面板类名是 .ant-drawer-section，不是 v5 的 -content）
         {'type': 'wait', 'selector': '.ant-drawer'},
         {'type': 'sleep', 'ms': 600},
         {'type': 'probe', 'name': 'drawer-title',
          'expression': '(document.querySelector(".ant-drawer-section") || document.querySelector(".ant-drawer")).innerText.split("\\n").slice(0,3).join(" | ")'},
     ],
     'settleMs': 600},

    # 编辑器（暗）
    {'name': '13-dark-editor', 'path': '/', 'width': 1280, 'height': 800, 'auth': True, 'dark': True,
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'view', 'label': '表格'},
         {'type': 'sleep', 'ms': 400},
         {'type': 'eval',
          'expression': '(() => { const b = document.querySelector("[data-testid^=pm-edit-]"); if (!b) return false; b.click(); return true; })()'},
         {'type': 'wait', 'selector': '[data-testid=pm-panel-markdown]'},
     ],
     'settleMs': 900},

    # ===== 阶段 11（使用优先）=====
    # 卡片视图（亮）：以"用"为主，**无删除按钮**（AC-41 ⑤）
    {'name': '20-use-light', 'path': '/', 'width': 1280, 'height': 800, 'auth': True,
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'view', 'label': '卡片'},
         {'type': 'sleep', 'ms': 500},
         {'type': 'probe', 'name': 'use-cards',
          'expression': 'document.querySelectorAll("[data-testid=pm-use-card]").length'},
         {'type': 'probe', 'name': 'card-delete-count',
          'expression': 'document.querySelectorAll("[data-testid^=pm-delete-]").length'},
     ],
     'dump': 'use', 'settleMs': 700},

    {'name': '21-use-dark', 'path': '/', 'width': 1280, 'height': 800, 'auth': True, 'dark': True,
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'view', 'label': '卡片'},
         {'type': 'sleep', 'ms': 400},
     ],
     'settleMs': 700},

    {'name': '22-detail-actions', 'path': '/', 'width': 1280, 'height': 800, 'auth': True,
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'view', 'label': '卡片'},
         {'type': 'sleep', 'ms': 400},
         {'type': 'eval',
          'expression': '(() => { const c = document.querySelector("[data-testid=pm-use-card]"); c.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); return true; })()'},
         {'type': 'wait', 'selector': '[data-testid=pm-detail-actions]'},
         {'type': 'sleep', 'ms': 600},
         {'type': 'probe', 'name': 'detail-actions-text',
          'expression': 'document.querySelector("[data-testid=pm-detail-actions]").innerText.replace(/\\n/g, " | ")'},
     ],
     'dump': 'detail', 'settleMs': 900},

    {'name': '23-vars-dialog', 'path': '/', 'width': 1280, 'height': 800, 'auth': True,
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'view', 'label': '卡片'},
         {'type': 'sleep', 'ms': 400},
         # 点"填值后复制"那条卡片的复制按钮
         {'type': 'eval',
          'expression': '(() => { const btns = [...document.querySelectorAll("[data-testid^=pm-copy-]")]; const b = btns.find((x) => x.innerText.indexOf("填值") >= 0) || btns[0]; b.click(); return true; })()'},
         {'type': 'wait', 'selector': '[data-testid=pm-vars-dialog]'},
         {'type': 'sleep', 'ms': 500},
     ],
     'dump': 'vars-dialog', 'settleMs': 700},

    {'name': '24-use-mobile', 'path': '/', 'width': 390, 'height': 844, 'auth': True,
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'view', 'label': '卡片'},
         {'type': 'sleep', 'ms': 500},
         {'type': 'probe', 'name': 'mobile-copy-rect',
          'expression': '(() => { const b = document.querySelector("[data-testid^=pm-copy-]"); const r = b.getBoundingClientRect(); return JSON.stringify({ w: Math.round(r.width), h: Math.round(r.height) }); })()'},
     ],
     'settleMs': 700},

    {'name': '25-mobile-detail', 'path': '/', 'width': 390, 'height': 844, 'auth': True,
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'view', 'label': '卡片'},
         {'type': 'sleep', 'ms': 400},
         {'type': 'eval',
          'expression': '(() => { const c = document.querySelector("[data-testid=pm-use-card]"); c.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); return true; })()'},
         {'type': 'wait', 'selector': '[data-testid=pm-detail-actions]'},
         {'type': 'sleep', 'ms': 600},
     ],
     'settleMs': 800},

    # 阶段 11.1（FIX）：填变量对话框「填一个、留一个」——未填变量原样保留 {{项目}}
    {'name': '26-vars-unfilled', 'path': '/', 'width': 1280, 'height': 800, 'auth': True,
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'view', 'label': '卡片'},
         {'type': 'sleep', 'ms': 400},
         {'type': 'eval',
          'expression': '(() => { const btns = [...document.querySelectorAll("[data-testid^=pm-copy-]")]; const b = btns.find((x) => x.innerText.indexOf("填值") >= 0) || btns[0]; b.click(); return true; })()'},
         {'type': 'wait', 'selector': '[data-testid=pm-vars-dialog]'},
         {'type': 'sleep', 'ms': 400},
         {'type': 'type', 'selector': '[data-testid="pm-var-input-姓名"]', 'text': '张三'},
         {'type': 'sleep', 'ms': 500},
         {'type': 'probe', 'name': 'vars-unfilled-preview',
          'expression': 'document.querySelector("[data-testid=pm-vars-preview]").innerText.replace(/\\n/g, " | ").slice(0, 160)'},
         {'type': 'probe', 'name': 'vars-unfilled-hint',
          'expression': 'document.querySelector("[data-testid=pm-vars-missing]").innerText.replace(/\\n/g, " | ")'},
         {'type': 'probe', 'name': 'vars-unfilled-keeps-project',
          'expression': 'document.querySelector("[data-testid=pm-vars-preview]").innerText.indexOf("{{项目}}") >= 0'},
     ],
     'dump': 'vars-unfilled', 'settleMs': 700},

    # ===== 阶段 12：设置 / 关于（技术信息的唯一落点，入口在「⋯更多」）=====
    {'name': '27-settings-about', 'path': '/', 'width': 1280, 'height': 800, 'auth': True,
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'menu', 'label': '关于'},
         {'type': 'wait', 'selector': '[data-testid=pm-about]'},
         {'type': 'sleep', 'ms': 700},
         {'type': 'probe', 'name': 'about-has-pmdb',
          'expression': 'document.querySelector("[data-testid=pm-about]").innerText.indexOf("pm.db") >= 0'},
         {'type': 'probe', 'name': 'about-has-backup',
          'expression': 'document.querySelector("[data-testid=pm-about]").innerText.indexOf("备份") >= 0'},
     ],
     'dump': 'about', 'settleMs': 700},

    # ===== 阶段 13：主题图标三态（亮 → 暗 → 跟随系统）+ 新建未保存态 =====
    {'name': '28-theme-system', 'path': '/', 'width': 1280, 'height': 800, 'auth': True,
     'storage': {'pm-theme': None},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'wait', 'selector': '[data-testid=pm-theme-toggle]'},
         {'type': 'sleep', 'ms': 700},
         {'type': 'probe', 'name': 'theme-system-scheme',
          'expression': 'document.documentElement.style.colorScheme'},
         {'type': 'probe', 'name': 'theme-system-title',
          'expression': 'document.querySelector("[data-testid=pm-theme-toggle]").getAttribute("title")'},
     ],
     'settleMs': 700},

    {'name': '29-theme-light', 'path': '/', 'width': 1280, 'height': 800, 'auth': True,
     'storage': {'pm-theme': 'light'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'wait', 'selector': '[data-testid=pm-theme-toggle]'},
         {'type': 'sleep', 'ms': 700},
         {'type': 'probe', 'name': 'theme-light-scheme',
          'expression': 'document.documentElement.style.colorScheme'},
     ],
     'settleMs': 700},

    {'name': '30-theme-dark', 'path': '/', 'width': 1280, 'height': 800, 'auth': True,
     'storage': {'pm-theme': 'dark'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'wait', 'selector': '[data-testid=pm-theme-toggle]'},
         {'type': 'sleep', 'ms': 700},
         {'type': 'probe', 'name': 'theme-dark-scheme',
          'expression': 'document.documentElement.style.colorScheme'},
     ],
     'settleMs': 700},

    # 新建编辑器「未保存」态（FR-45）：type 了标题但不点保存
    {'name': '31-draft-editor', 'path': '/', 'width': 1280, 'height': 800, 'auth': True,
     'storage': {'pm-theme': 'light'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'click', 'selector': '[data-testid=header-new]'},
         {'type': 'wait', 'selector': '[data-testid=editor-draft-badge]'},
         {'type': 'type', 'selector': '[data-testid=editor-title]', 'text': '还没保存的草稿'},
         {'type': 'sleep', 'ms': 600},
         {'type': 'probe', 'name': 'draft-badge-text',
          'expression': 'document.querySelector("[data-testid=editor-draft-badge]").innerText'},
     ],
     'dump': 'draft', 'settleMs': 700},

    # ===== 阶段 14（FR-46）：分栏视图（默认落地；左筛选栏 + 中列表 + 右详情面）=====
    {'name': '32-split', 'path': '/', 'width': 1280, 'height': 800, 'auth': True,
     'storage': {'pm-view-mode': 'split'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'wait', 'selector': '[data-testid=pm-view-split]'},
         {'type': 'sleep', 'ms': 800},
         {'type': 'probe', 'name': 'split-items',
          'expression': 'document.querySelectorAll("[data-testid=pm-split-item]").length'},
         {'type': 'probe', 'name': 'split-selected',
          'expression': 'document.querySelectorAll("[data-testid=pm-split-item][data-selected=true]").length'},
         {'type': 'probe', 'name': 'split-rects',
          'expression': 'JSON.stringify((() => { const l = document.querySelector("[data-testid=pm-split-list]").getBoundingClientRect(); const d = document.querySelector("[data-testid=pm-detail]").getBoundingClientRect(); return { listLeft: Math.round(l.left), listW: Math.round(l.width), detailLeft: Math.round(d.left), detailW: Math.round(d.width) }; })())'},
     ],
     'dump': 'split', 'settleMs': 800},

    # 分栏选中态 + 右栏详情（滚到变量填值 / 底部固定操作条）
    {'name': '33-split-selected', 'path': '/', 'width': 1280, 'height': 800, 'auth': True,
     'storage': {'pm-view-mode': 'split'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'wait', 'selector': '[data-testid=pm-view-split]'},
         {'type': 'sleep', 'ms': 600},
         {'type': 'eval',
          'expression': '(() => { const items = [...document.querySelectorAll("[data-testid=pm-split-item]")]; if (items[1]) { items[1].click(); return true; } return false; })()'},
         {'type': 'sleep', 'ms': 800},
         {'type': 'eval',
          'expression': '(() => { const el = document.querySelector("[data-testid=pm-detail-actions]"); if (el) el.scrollIntoView({ block: "end" }); return true; })()'},
         {'type': 'sleep', 'ms': 600},
         {'type': 'probe', 'name': 'split-detail-title',
          'expression': 'document.querySelector("[data-testid=pm-detail-title]").innerText'},
         {'type': 'probe', 'name': 'split-detail-actions',
          'expression': 'document.querySelector("[data-testid=pm-detail-actions]").innerText.replace(/\\n/g, " | ")'},
     ],
     'dump': 'split-selected', 'settleMs': 800},

    # 768–1200px：左栏收成图标（这里不出现 pm-sidebar），中+右保留、无横向滚动
    {'name': '34-narrow-split', 'path': '/', 'width': 1024, 'height': 800, 'auth': True,
     'storage': {'pm-view-mode': 'split'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'wait', 'selector': '[data-testid=pm-view-split]'},
         {'type': 'sleep', 'ms': 700},
         {'type': 'probe', 'name': 'narrow-sidebar-inline',
          'expression': '!!document.querySelector("[data-testid=pm-sidebar]")'},
         {'type': 'probe', 'name': 'narrow-overflow',
          'expression': 'document.documentElement.scrollWidth > window.innerWidth + 1'},
     ],
     'settleMs': 700},

    # 窄屏点 ☰ → 筛选抽屉（左栏"收起态"）
    {'name': '35-narrow-drawer', 'path': '/', 'width': 1024, 'height': 800, 'auth': True,
     'storage': {'pm-view-mode': 'split'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'click', 'selector': 'button[aria-label=筛选]'},
         {'type': 'wait', 'selector': '.ant-drawer'},
         {'type': 'sleep', 'ms': 700},
         {'type': 'probe', 'name': 'drawer-sidebar',
          'expression': '!!document.querySelector(".ant-drawer [data-testid=pm-sidebar]")'},
     ],
     'settleMs': 700},

    # ===== 阶段 15（FR-47 / FR-48）：顶栏四块顺序 + ⋯更多 菜单 =====
    {'name': '36-more-menu', 'path': '/', 'width': 1280, 'height': 800, 'auth': True,
     'storage': {'pm-view-mode': 'split'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'click', 'selector': '[data-testid=header-more]'},
         {'type': 'wait', 'selector': '.ant-dropdown-menu'},
         {'type': 'sleep', 'ms': 600},
         {'type': 'probe', 'name': 'more-items',
          'expression': '[...document.querySelectorAll(".ant-dropdown-menu-item")].map((n) => n.innerText.trim()).join("|")'},
         {'type': 'probe', 'name': 'topnav-rects',
          'expression': 'JSON.stringify(["header-new","header-more","pm-theme-toggle","header-logout"].map((id) => { const el = document.querySelector("[data-testid=" + id + "]"); const r = el.getBoundingClientRect(); return [id, Math.round(r.left)]; }))'},
     ],
     'dump': 'more-menu', 'settleMs': 700},

    # ===== 阶段 15（FR-49）：文件夹树（层级 + 展开三角 + 条目数）=====
    {'name': '37-folder-tree', 'path': '/', 'width': 1280, 'height': 800, 'auth': True,
     'storage': {'pm-view-mode': 'split'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'sleep', 'ms': 800},
         {'type': 'probe', 'name': 'folder-rows',
          'expression': '[...document.querySelectorAll("[data-testid^=pm-folder-row-]")].map((n) => n.getAttribute("data-depth") + ":" + (n.innerText.split("\\n")[0] || "").trim()).join(" | ")'},
     ],
     'dump': 'folder-tree', 'settleMs': 700},

    # 文件夹行悬浮 → 行内 ＋ / ✎ / 🗑（FR-49 ⑨）
    {'name': '38-folder-hover', 'path': '/', 'width': 1280, 'height': 800, 'auth': True,
     'storage': {'pm-view-mode': 'split'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'sleep', 'ms': 700},
         {'type': 'hover', 'selector': '[data-testid^=pm-folder-row-]'},
         {'type': 'sleep', 'ms': 500},
         {'type': 'probe', 'name': 'folder-hover-actions',
          'expression': '!!document.querySelector("[data-testid=pm-folder-rename]") && !!document.querySelector("[data-testid=pm-folder-delete]")'},
     ],
     'dump': 'folder-hover', 'settleMs': 600},

    # ===== 阶段 15（FR-50）：标签胶囊云（多行）=====
    {'name': '39-tag-cloud', 'path': '/', 'width': 1280, 'height': 800, 'auth': True,
     'storage': {'pm-view-mode': 'split'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'sleep', 'ms': 800},
         {'type': 'probe', 'name': 'tag-chips',
          'expression': 'document.querySelectorAll("[data-testid=pm-tag-chip]").length'},
         {'type': 'probe', 'name': 'tag-rows',
          'expression': 'String([...new Set([...document.querySelectorAll("[data-testid=pm-tag-chip]")].map((n) => n.offsetTop))].length)'},
         # 点一个胶囊 → 选中态（主色描边 + 浅底）+ 列表按标签筛选
         {'type': 'eval',
          'expression': '(() => { const chip = document.querySelector("[data-testid=pm-tag-chip]"); if (chip) { chip.click(); return true; } return false; })()'},
         {'type': 'sleep', 'ms': 900},
         {'type': 'probe', 'name': 'tag-selected',
          'expression': 'String(document.querySelectorAll("[data-testid=pm-tag-chip][data-selected=true]").length)'},
     ],
     'dump': 'tag-cloud', 'settleMs': 700},

    # ===== 阶段 15：暗色主题下的文件夹与标签 =====
    {'name': '40-dark-sidebar', 'path': '/', 'width': 1280, 'height': 800, 'auth': True, 'dark': True,
     'storage': {'pm-theme': 'dark', 'pm-view-mode': 'split'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [{'type': 'sleep', 'ms': 800}],
     'dump': 'dark-sidebar', 'settleMs': 700},

    # ===== 阶段 16（FR-51 / FR-52 / FR-53）：PromptManager logo + 关于页重构（无「拿来就用」）=====
    {'name': '41-about', 'path': '/', 'width': 1280, 'height': 800, 'auth': True,
     'storage': {'pm-view-mode': 'split', 'pm-theme': 'light'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'menu', 'label': '关于'},
         {'type': 'wait', 'selector': '[data-testid=pm-about]'},
         {'type': 'sleep', 'ms': 800},
         {'type': 'probe', 'name': 'about-sections',
          'expression': 'document.querySelectorAll("[data-testid=pm-about] .ant-collapse-header").length'},
         {'type': 'probe', 'name': 'about-has-pmdb',
          'expression': 'document.querySelector("[data-testid=pm-about]").innerText.indexOf("pm.db") >= 0'},
     ],
     'dump': 'about', 'settleMs': 700},

    # 维护区展开态（默认折叠）
    {'name': '42-about-maintain', 'path': '/', 'width': 1280, 'height': 800, 'auth': True,
     'storage': {'pm-view-mode': 'split', 'pm-theme': 'light'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'menu', 'label': '关于'},
         {'type': 'wait', 'selector': '[data-testid=pm-about]'},
         {'type': 'sleep', 'ms': 500},
         {'type': 'eval',
          'expression': '(() => { const hs = [...document.querySelectorAll("[data-testid=pm-about] .ant-collapse-header")]; const t = hs.find((n) => n.innerText.includes("维护")); if (t) { t.click(); t.scrollIntoView({ block: "start" }); return true; } return false; })()'},
         {'type': 'sleep', 'ms': 900},
         # 展开后内容在下方：把弹窗/页面都滚到底，截到「维护」区
         {'type': 'eval',
          'expression': '(() => { const wrap = document.querySelector(".ant-modal-wrap"); if (wrap) wrap.scrollTop = wrap.scrollHeight; const body = document.querySelector(".ant-modal-body"); if (body) body.scrollTop = body.scrollHeight; const items = [...document.querySelectorAll("[data-testid=pm-about] .ant-collapse-item")]; const last = items[items.length - 1]; if (last) last.scrollIntoView({ block: "end" }); return true; })()'},
         {'type': 'sleep', 'ms': 600},
     ],
     'dump': 'about-maintain', 'settleMs': 700},

    # ===== 阶段 16（FR-54）：非空文件夹删除 —— 弹窗态 + 错误反馈态 =====
    {'name': '43-folder-delete-popup', 'path': '/', 'width': 1280, 'height': 800, 'auth': True,
     'storage': {'pm-view-mode': 'split', 'pm-theme': 'light'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'sleep', 'ms': 800},
         {'type': 'hover', 'selector': '[data-testid^=pm-folder-row-]'},
         {'type': 'sleep', 'ms': 400},
         {'type': 'click', 'selector': '[data-testid=pm-folder-delete]'},
         {'type': 'wait', 'selector': '.ant-popconfirm'},
         {'type': 'sleep', 'ms': 500},
         {'type': 'probe', 'name': 'delete-popup-text',
          'expression': 'document.querySelector(".ant-popconfirm").innerText.replace(/\\n/g, " | ")'},
     ],
     'dump': 'folder-delete-popup', 'settleMs': 500},

    {'name': '44-folder-delete-error', 'path': '/', 'width': 1280, 'height': 800, 'auth': True,
     'storage': {'pm-view-mode': 'split', 'pm-theme': 'light'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'sleep', 'ms': 800},
         {'type': 'hover', 'selector': '[data-testid^=pm-folder-row-]'},
         {'type': 'sleep', 'ms': 400},
         {'type': 'click', 'selector': '[data-testid=pm-folder-delete]'},
         {'type': 'wait', 'selector': '.ant-popconfirm'},
         {'type': 'click', 'selector': '.ant-popconfirm .ant-btn-primary'},
         {'type': 'sleep', 'ms': 800},
         {'type': 'probe', 'name': 'delete-error-message',
          'expression': '(() => { const el = document.querySelector(".ant-message"); return el === null ? "" : el.innerText.replace(/\\n/g, " | "); })()'},
     ],
     'dump': 'folder-delete-error', 'settleMs': 500},

    # ===== 阶段 16（FR-55 / FR-56 / FR-57）：编辑页返回详情 + 右栏新顺序 + 收藏星标 =====
    {'name': '45-editor-back', 'path': '/', 'width': 1280, 'height': 800, 'auth': True,
     'storage': {'pm-view-mode': 'split', 'pm-theme': 'light'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'sleep', 'ms': 800},
         {'type': 'click', 'selector': '[data-testid=pm-detail-edit]'},
         {'type': 'wait', 'selector': '[data-testid=pm-editor]'},
         {'type': 'sleep', 'ms': 700},
         {'type': 'probe', 'name': 'editor-panel-tops',
          'expression': 'JSON.stringify((() => { const top = (id) => { const el = document.querySelector("[data-testid=" + id + "]"); return el === null ? -1 : Math.round(el.getBoundingClientRect().top); }; return { markdown: top("pm-panel-markdown"), variables: top("pm-panel-variables"), versions: top("pm-panel-versions") }; })())'},
         {'type': 'probe', 'name': 'editor-back-text',
          'expression': '(() => { const el = document.querySelector("[data-testid=editor-back]"); return el === null ? "" : el.innerText.trim(); })()'},
     ],
     'dump': 'editor-back', 'settleMs': 700},
    # ===== 阶段 17（FR-59）：同一枚图标 · 多尺寸 =====
    # 浏览器标签页图标：headless shell 没有标签栏可截，这里把**服务端实际提供的**
    # favicon.svg / favicon.ico 按原生 16×16 渲染在同一份亮/暗底上（说明见 PROGRESS）。
    {'name': '46-favicon-16-light', 'path': '/', 'width': 1280, 'height': 800, 'auth': True,
     'storage': {'pm-theme': 'light', 'pm-view-mode': 'split'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'eval', 'expression': '(() => { const dark = window.matchMedia("(prefers-color-scheme: dark)").matches; const bg = dark ? "#010102" : "#ffffff"; const fg = dark ? "#f7f8f8" : "#14161a"; const bd = dark ? "#23252a" : "#e4e6ea"; document.body.innerHTML = `<div style="min-height:100vh;display:flex;flex-direction:column;gap:18px;align-items:center;justify-content:center;background:${bg};color:${fg};font:13px/1.5 Inter,sans-serif"><div style="font-size:12px;opacity:.6">浏览器标签页图标 · 按原生 16×16 渲染（服务端实际提供的文件）</div><div style="display:flex;gap:28px;align-items:center;padding:14px 18px;border:1px solid ${bd};border-radius:10px"><span style="display:inline-flex;align-items:center;gap:8px"><img src="/favicon.svg" width="16" height="16" alt=""><span class="pm-mono">favicon.svg</span></span><span style="display:inline-flex;align-items:center;gap:8px"><img src="/favicon.ico" width="16" height="16" alt=""><span class="pm-mono">favicon.ico</span></span></div></div>`; return true; })()'},
         {'type': 'sleep', 'ms': 600},
     ],
     'settleMs': 500},

    {'name': '47-favicon-16-dark', 'path': '/', 'width': 1280, 'height': 800, 'auth': True, 'dark': True,
     'storage': {'pm-theme': 'dark', 'pm-view-mode': 'split'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'eval', 'expression': '(() => { const dark = window.matchMedia("(prefers-color-scheme: dark)").matches; const bg = dark ? "#010102" : "#ffffff"; const fg = dark ? "#f7f8f8" : "#14161a"; const bd = dark ? "#23252a" : "#e4e6ea"; document.body.innerHTML = `<div style="min-height:100vh;display:flex;flex-direction:column;gap:18px;align-items:center;justify-content:center;background:${bg};color:${fg};font:13px/1.5 Inter,sans-serif"><div style="font-size:12px;opacity:.6">浏览器标签页图标 · 按原生 16×16 渲染（服务端实际提供的文件）</div><div style="display:flex;gap:28px;align-items:center;padding:14px 18px;border:1px solid ${bd};border-radius:10px"><span style="display:inline-flex;align-items:center;gap:8px"><img src="/favicon.svg" width="16" height="16" alt=""><span class="pm-mono">favicon.svg</span></span><span style="display:inline-flex;align-items:center;gap:8px"><img src="/favicon.ico" width="16" height="16" alt=""><span class="pm-mono">favicon.ico</span></span></div></div>`; return true; })()'},
         {'type': 'sleep', 'ms': 600},
     ],
     'settleMs': 500},

    {'name': '48-topbar-mark-light', 'path': '/', 'width': 1280, 'height': 800, 'auth': True,
     'storage': {'pm-theme': 'light', 'pm-view-mode': 'split'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'sleep', 'ms': 700},
         {'type': 'probe', 'name': 'mark-light',
          'expression': '(() => { const el = document.querySelector("[data-testid=pm-brand-mark]"); const r = el.getBoundingClientRect(); return JSON.stringify({ src: el.getAttribute("src"), w: Math.round(r.width), h: Math.round(r.height), text: document.querySelector("[data-testid=pm-topnav]").innerText.replace(/\\n/g, " | ").slice(0, 60) }); })()'},
     ],
     'dump': 'topbar-light', 'settleMs': 700},

    {'name': '49-topbar-mark-dark', 'path': '/', 'width': 1280, 'height': 800, 'auth': True, 'dark': True,
     'storage': {'pm-theme': 'dark', 'pm-view-mode': 'split'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'sleep', 'ms': 700},
         {'type': 'probe', 'name': 'mark-dark',
          'expression': '(() => { const el = document.querySelector("[data-testid=pm-brand-mark]"); const r = el.getBoundingClientRect(); return JSON.stringify({ src: el.getAttribute("src"), w: Math.round(r.width), h: Math.round(r.height) }); })()'},
     ],
     'dump': 'topbar-dark', 'settleMs': 700},

    # ===== 阶段 19（FR-63）：编辑器全屏 = 应用内全屏（左栏消失 + 编辑/右栏 1:1）=====
    {'name': '60-editor-fullscreen-before', 'path': '/', 'width': 1280, 'height': 800, 'auth': True,
     'storage': {'pm-view-mode': 'split', 'pm-theme': 'light'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'sleep', 'ms': 800},
         {'type': 'click', 'selector': '[data-testid=pm-detail-edit]'},
         {'type': 'wait', 'selector': '[data-testid=pm-editor]'},
         {'type': 'sleep', 'ms': 900},
         {'type': 'probe', 'name': 'before-button-text',
          'expression': '(() => { const el = document.querySelector("[data-testid=editor-fullscreen]"); return el === null ? "missing" : el.innerText.trim(); })()'},
         {'type': 'probe', 'name': 'before-editor-list-visible',
          'expression': '(() => { const el = document.querySelector("[data-testid=editor-list]"); return el === null ? "missing" : String(el.offsetParent !== null); })()'},
         {'type': 'probe', 'name': 'before-fullscreen-element',
          'expression': 'String(document.fullscreenElement === null)'},
     ],
     'dump': 'editor-fullscreen-before', 'settleMs': 700},

    {'name': '61-editor-fullscreen-after', 'path': '/', 'width': 1280, 'height': 800, 'auth': True,
     'storage': {'pm-view-mode': 'split', 'pm-theme': 'light'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'sleep', 'ms': 800},
         {'type': 'click', 'selector': '[data-testid=pm-detail-edit]'},
         {'type': 'wait', 'selector': '[data-testid=pm-editor]'},
         {'type': 'sleep', 'ms': 700},
         {'type': 'click', 'selector': '[data-testid=editor-fullscreen]'},
         {'type': 'sleep', 'ms': 900},
         {'type': 'probe', 'name': 'fs-button-text',
          'expression': '(() => { const el = document.querySelector("[data-testid=editor-fullscreen]"); return el === null ? "missing" : el.innerText.trim(); })()'},
         {'type': 'probe', 'name': 'fs-button-icon',
          'expression': '(() => { const el = document.querySelector("[data-testid=editor-fullscreen] .anticon"); return el === null ? "missing" : el.className; })()'},
         {'type': 'probe', 'name': 'fs-editor-list-offsetparent-null',
          'expression': '(() => { const el = document.querySelector("[data-testid=editor-list]"); return el === null ? "missing" : String(el.offsetParent === null); })()'},
         {'type': 'probe', 'name': 'fs-widths',
          'expression': 'JSON.stringify((() => { const w = (id) => Math.round(document.querySelector("[data-testid=" + id + "]").getBoundingClientRect().width); const main = w("editor-main"); const side = w("editor-side"); return { main, side, ratio: Number((main / side).toFixed(3)) }; })())'},
         {'type': 'probe', 'name': 'fs-fullscreen-element',
          'expression': 'String(document.fullscreenElement === null)'},
         {'type': 'probe', 'name': 'fs-visible-cols',
          'expression': 'String([...document.querySelectorAll("[data-testid=pm-editor] .pm-editor-col")].filter((el) => el.offsetParent !== null).length)'},
     ],
     'dump': 'editor-fullscreen-after', 'settleMs': 700},

    # ===== 阶段 19（FR-64）：备注没改（仅尾部换行）→ 版本对比里不得出现变更行 =====
    {'name': '62-version-diff-notes-unchanged', 'path': '/', 'width': 1280, 'height': 800, 'auth': True,
     'storage': {'pm-view-mode': 'split', 'pm-theme': 'light'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'sleep', 'ms': 1000},
         {'type': 'eval',
          'expression': '(() => { const el = [...document.querySelectorAll("[data-testid=pm-split-item]")].find((n) => n.innerText.includes("阶段19 备注未改夹具")); if (!el) return false; el.click(); return true; })()'},
         {'type': 'sleep', 'ms': 1400},
         {'type': 'probe', 'name': 'diff-notes-unchanged-text',
          'expression': '(() => { const el = document.querySelector("[data-testid=diff-view]"); return el === null ? "missing" : el.innerText.trim(); })()'},
     ],
     'dump': 'diff-notes-unchanged', 'settleMs': 900},

    # ===== 阶段 20（FR-66）：详情面去掉冗余的「当前字段 + 预览」头部 =====
    {'name': '63-detail-no-current-field', 'path': '/', 'width': 1280, 'height': 800, 'auth': True,
     'storage': {'pm-view-mode': 'split', 'pm-theme': 'light'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'sleep', 'ms': 1000},
         {'type': 'click', 'selector': '[data-testid=pm-split-item]'},
         {'type': 'wait', 'selector': '[data-testid=pm-detail-body] [data-testid=markdown-preview]'},
         {'type': 'sleep', 'ms': 900},
         {'type': 'probe', 'name': 'detail-body-select-count',
          'expression': 'document.querySelectorAll("[data-testid=pm-detail-body] .ant-select").length'},
         {'type': 'probe', 'name': 'detail-has-current-field-text',
          'expression': 'document.querySelector("[data-testid=pm-detail]").innerText.includes("当前字段")'},
         {'type': 'probe', 'name': 'detail-gap-px',
          'expression': 'JSON.stringify((() => { const f = document.querySelector("[data-testid=pm-detail-fields]").getBoundingClientRect(); const body = document.querySelector("[data-testid=pm-detail-body]"); const c = (body.querySelector("[data-testid=markdown-preview]") ?? body.querySelector("[data-testid=pm-detail-text]")).getBoundingClientRect(); return { gap: Math.round(c.top - f.bottom) }; })())'},
     ],
     'dump': 'detail-no-current-field', 'settleMs': 700},

    # ===== 阶段 20（FR-66 ④）：编辑器页仍保留 3 字段下拉 =====
    {'name': '64-editor-fields-select', 'path': '/', 'width': 1280, 'height': 800, 'auth': True,
     'storage': {'pm-view-mode': 'split', 'pm-theme': 'light'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'sleep', 'ms': 900},
         {'type': 'click', 'selector': '[data-testid=pm-split-item]'},
         {'type': 'wait', 'selector': '[data-testid=pm-detail-edit]'},
         {'type': 'click', 'selector': '[data-testid=pm-detail-edit]'},
         {'type': 'wait', 'selector': '[data-testid=pm-panel-markdown] .ant-select'},
         {'type': 'sleep', 'ms': 900},
         {'type': 'probe', 'name': 'editor-field-select-count',
          'expression': 'document.querySelectorAll("[data-testid=pm-panel-markdown] .ant-select").length'},
         {'type': 'probe', 'name': 'editor-field-select-text',
          'expression': 'String(document.querySelector("[data-testid=pm-panel-markdown] .ant-select").innerText.trim())'},
     ],
     'dump': 'editor-fields-select', 'settleMs': 700},

    # ===== 阶段 20（FR-67）：⋯更多 删「已登录」、原位置「修改密码」 =====
    {'name': '65-more-menu-password', 'path': '/', 'width': 1280, 'height': 800, 'auth': True,
     'storage': {'pm-view-mode': 'split', 'pm-theme': 'light'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'sleep', 'ms': 800},
         {'type': 'click', 'selector': '[data-testid=header-more]'},
         {'type': 'wait', 'selector': '.ant-dropdown-menu'},
         {'type': 'sleep', 'ms': 500},
         {'type': 'probe', 'name': 'more-items',
          'expression': '[...document.querySelectorAll(".ant-dropdown-menu-item")].map((n) => n.innerText.trim()).join("|")'},
         {'type': 'probe', 'name': 'more-has-account',
          'expression': '[...document.querySelectorAll(".ant-dropdown-menu-item")].some((n) => n.innerText.includes("已登录"))'},
     ],
     'dump': 'more-menu-password', 'settleMs': 500},

    {'name': '66-password-modal', 'path': '/', 'width': 1280, 'height': 800, 'auth': True,
     'storage': {'pm-view-mode': 'split', 'pm-theme': 'light'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'sleep', 'ms': 800},
         {'type': 'menu', 'label': '修改密码'},
         {'type': 'wait', 'selector': '[data-testid=pm-password-modal]'},
         {'type': 'sleep', 'ms': 600},
         {'type': 'probe', 'name': 'password-inputs',
          'expression': 'document.querySelectorAll("[data-testid=pm-password-modal] input[type=password]").length'},
     ],
     'dump': 'password-modal', 'settleMs': 500},

    {'name': '67-password-validation', 'path': '/', 'width': 1280, 'height': 800, 'auth': True,
     'storage': {'pm-view-mode': 'split', 'pm-theme': 'light'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'sleep', 'ms': 800},
         {'type': 'menu', 'label': '修改密码'},
         {'type': 'wait', 'selector': '[data-testid=pm-password-modal]'},
         {'type': 'type', 'selector': '[data-testid=pm-old-password]', 'text': 'whatever-current'},
         {'type': 'type', 'selector': '[data-testid=pm-new-password]', 'text': 'short7!'},
         {'type': 'type', 'selector': '[data-testid=pm-confirm-password]', 'text': 'short7!'},
         {'type': 'click', 'selector': '.pm-password-modal .ant-modal-footer .ant-btn-primary'},
         {'type': 'sleep', 'ms': 900},
         {'type': 'probe', 'name': 'password-rule-error',
          'expression': '[...document.querySelectorAll("[data-testid=pm-password-modal] .ant-form-item-explain-error")].map((n) => n.innerText.trim()).join(" | ")'},
     ],
     'dump': 'password-validation', 'settleMs': 500},

    {'name': '68-password-changed', 'path': '/', 'width': 1280, 'height': 800, 'auth': True,
     'storage': {'pm-view-mode': 'split', 'pm-theme': 'light'},
     'waitFor': '[data-testid=pm-search-input]',
     'actions': [
         {'type': 'sleep', 'ms': 800},
         {'type': 'menu', 'label': '修改密码'},
         {'type': 'wait', 'selector': '[data-testid=pm-password-modal]'},
         {'type': 'type', 'selector': '[data-testid=pm-old-password]', 'text': fixture_pw},
         {'type': 'type', 'selector': '[data-testid=pm-new-password]', 'text': 'ui-shots-temp-pw-2026'},
         {'type': 'type', 'selector': '[data-testid=pm-confirm-password]', 'text': 'ui-shots-temp-pw-2026'},
         {'type': 'click', 'selector': '.pm-password-modal .ant-modal-footer .ant-btn-primary'},
         {'type': 'sleep', 'ms': 1500},
         {'type': 'probe', 'name': 'password-changed-toast',
          'expression': '[...document.querySelectorAll(".ant-message")].map((n) => n.innerText.trim()).join(" | ")'},
         {'type': 'probe', 'name': 'password-modal-closed',
          'expression': 'document.querySelector("[data-testid=pm-password-modal]") === null'},
     ],
     'dump': 'password-changed', 'settleMs': 400},
]

if mode == 'key':
    by_name = {shot['name']: shot for shot in shots}
    by_name.update(KEY_EXTRA)
    missing = [src for src, _ in KEY_SET if src not in by_name]
    if missing:
        raise SystemExit('KEY_SET 引用了不存在的截图定义：%s' % missing)
    shots = [dict(by_name[src], name=dst) for src, dst in KEY_SET]

plan = {
    'chrome': chrome,
    'baseUrl': base,
    'cookie': {'name': 'pm_sid', 'value': sid, 'domain': '127.0.0.1'},
    'outDir': out_dir,
    'dumpsDir': dumps_dir,
    'shots': shots,
}
with open(plan_path, 'w', encoding='utf-8') as handle:
    json.dump(plan, handle, ensure_ascii=False, indent=2)
print('PLAN mode=%s shots=%d out=%s dumps=%s' % (mode, len(shots), out_dir, dumps_dir))
PY

line "4.5 阶段 19 / FR-64 夹具：备注只有尾部换行不同（界面自查 62-version-diff-notes-unchanged 用）"
FR64_ID=$(curl -s -b "$JAR" -H 'Content-Type: application/json' \
  -d '{"title":"阶段19 备注未改夹具","user_prompt":"U1","system_prompt":"S","notes":"N"}' \
  "$BASE/api/prompts" | jq -r '.id')
curl -s -b "$JAR" -X PUT -H 'Content-Type: application/json' -d '{"notes":"N\n"}' "$BASE/api/prompts/$FR64_ID" >/dev/null
echo "  prompt #$FR64_ID：v1 notes='N' → v2 notes='N\\n'（仅有尾部换行差异）"

node tools/ui-shot.mjs "$PLAN" || die "截图失败"
line "5. 结果（服务已停 / 临时数据已删）"
ls -1 "$OUT_DIR"/*.png | sed 's/^/  /'
echo "  张数=$(ls -1 "$OUT_DIR"/*.png | wc -l)  目录=$OUT_DIR"
echo "  DOM dump（AC-21 用）：$(ls -1 "$DUMP_DIR"/*.html 2>/dev/null | tr '\n' ' ')"
echo "OK ui-shots done"
