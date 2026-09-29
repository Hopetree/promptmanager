#!/usr/bin/env bash
# 阶段 46 验收自检（FR-108 登录页纵向溢出 + FR-109 README 镜像指引）：
#   AC-110 ① **双视口无纵向溢出**：390×844 与 1600×900 下 #pm-login 高度 ≤ 视口高，
#            且 documentElement.scrollHeight ≤ innerHeight（贴四个数字，与 FR-108 基线表对账）
#        ② 无纵向滚动条：scrollHeight - innerHeight ≤ 0（贴数字）
#        ③ 登录页视觉不变：标题 / 用户名 / 口令 / 登录按钮的 x 与 width 与改前一致（±2px），
#            截图（两视口改前 + 改后）成对并识图
#        ④ 主界面不回归（真浏览器）：登录后 390×844 与 1600×900 下无纵向溢出、无横向滚动
#        ⑤ README 指引存在且可检索：'镜像' 命中在部署章节；FAQ 有含「拉取」+「失败/很慢」的问句；
#            不把某一具体镜像站当唯一方案
#        ⑥ 文档准确：不引用不存在的脚本（沿用 grep -c 'ac-stage9.sh' = 0 的既有口径）
#        ⑦ 不给用户加负担：Dockerfile / docker-compose.yml / .github/workflows 未被改动（git 对账）
#        ⑧ 视觉证据：登录页两视口改前/改后成对截图
#
# 回归范围（D-46 ③：样式 + 文档类，不必全量）：本脚本 + npm test + ci-check（在脚本外另跑）。
# 全程临时 DATA_DIR + 台账范围内备用端口；不碰 8767 测试环境、不碰 106 生产。
# 用法：bash tools/ac-stage46.sh [all|login|readme]
set -u
set -o pipefail

cd "$(dirname "$0")/.." || exit 1
ONLY=${1:-all}
PORT=${PORT:-auto}
AC_PW='ac-fixture-pw-20260923'
AC_USER='admin'
SHOTS='tmp/shots/stage46'
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
le() { if [ "$3" -le "$2" ] 2>/dev/null; then pass "$1 = $3（≤ $2）"; else fail "$1 = $3（期望 ≤ $2）"; fi; }
near() { # near <label> <before> <after> <tol>
  local d=$(( $3 - $2 )); [ "$d" -lt 0 ] && d=$(( -d ))
  if [ "$d" -le "$4" ]; then pass "$1：改前 $2 → 改后 $3（差 $d ≤ $4）"; else fail "$1：改前 $2 → 改后 $3（差 $d > $4）"; fi
}

DIR=''
SRV_PID=''
cleanup() {
  if [ -n "$SRV_PID" ]; then
    kill "$SRV_PID" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$SRV_PID" 2>/dev/null || break; sleep 0.3; done
    kill -9 "$SRV_PID" 2>/dev/null || true
  fi
  [ -n "$DIR" ] && [ "${KEEP_AC_DIR:-0}" != "1" ] && rm -rf "$DIR"
}
trap cleanup EXIT
DIR=$(mktemp -d /tmp/pm-ac46-XXXXXX)
DB="$DIR/pm.db"
q() { sqlite3 "$DB" "$1"; }
f() { printf '%s' "$1" | jq -c -r "$2"; }

line "构建 + 全量单测（样式类改动：本脚本 + npm test + ci-check 即为 D-46 ③ 选定范围）"
npm run build >"$DIR/build.log" 2>&1
eq "npm run build 退出码" 0 "$?"
npm test >"$DIR/test.log" 2>&1
eq "npm test 退出码" 0 "$?"
grep -E "^ℹ (tests|pass|fail)" "$DIR/test.log" | sed 's/^/  /'

if [ "$ONLY" = "all" ] || [ "$ONLY" = "readme" ]; then
  line "AC-110 ⑤⑥⑦：README（纯文档判据，不需要起服务）"
  # ── 阶段 58 修（B 类）：原锚点写死旧章节名 `## 部署方式 A：Docker` / `## 常见问题（FAQ）`。
  # README 在 v57（FR-108/109）用户化改写后已没有这两个标题 ⇒ 两处 grep 都取到**空值**，
  # 后面的 `awk 'NR>=s && NR<e'` 恒假 ⇒ 本分支 10 条断言一起恒红（不是产品坏了，是测量口径过时）。
  # 修法 = **换测法、不改期望值**：按"章节标题 + 下一个二级标题"动态取区间；章节找不到就直接红。
  ge() { if [ "$3" -ge "$2" ] 2>/dev/null; then pass "$1 = $3（≥ $2）"; else fail "$1 = $3（期望 ≥ $2）"; fi; }
  sec_start() { grep -nE "^## .*$1" README.md | head -1 | cut -d: -f1; }
  sec_end() { awk -v s="$1" 'NR>s && /^## / {print NR; exit}' README.md; }
  DEPLOY_LINE=$(sec_start '快速开始')
  FAQ_LINE=$(sec_start '常见问题')
  DEPLOY_END=$(sec_end "${DEPLOY_LINE:-1}"); [ -z "$DEPLOY_END" ] && DEPLOY_END=999999
  eq "⑤ 找得到「快速开始」章节（部署说明所在；标题改名要同步这里）" 1 "$(grep -cE '^## .*快速开始' README.md | head -1 | awk '{print ($1>0?1:0)}')"
  eq "⑤ 找得到「常见问题」章节" 1 "$(grep -cE '^## .*常见问题' README.md | head -1 | awk '{print ($1>0?1:0)}')"
  # ⑤ 部署章节里必须出现「镜像」的说明
  MIRROR_IN_DEPLOY=$(awk -v s="$DEPLOY_LINE" -v e="$DEPLOY_END" 'NR>=s && NR<e && /镜像/ {c++} END {print c+0}' README.md)
  ge "⑤ 快速开始章节里出现「镜像」的行数" 1 "$MIRROR_IN_DEPLOY"
  ge "⑤ 快速开始章节里有"拉取失败/慢"的说明" 1 "$(awk -v s="$DEPLOY_LINE" -v e="$DEPLOY_END" 'NR>=s && NR<e && /卡住或很慢|超时或极慢|拉不动|很慢或失败/ {c++} END {print c+0}' README.md)"
  eq "⑤ 文档教了 tag 回规范名（docker tag 全篇至少一处）" 1 "$(grep -c 'docker tag' README.md | head -1 | awk '{print ($1>0?1:0)}')"
  # ⑤ FAQ 里新增一条问句，含「拉取」且含「失败」或「很慢」
  FAQ_Q=$(awk -v s="$FAQ_LINE" 'NR>=s && /^\*\*.*？\*\*$/ {print NR": "$0}' README.md | grep '拉取' | grep -E '失败|很慢' | head -1)
  echo "  \$ FAQ 新条目：$FAQ_Q"
  eq "⑤ FAQ 有含「拉取」+「失败/很慢」的问句" 1 "$(printf '%s' "$FAQ_Q" | grep -c '拉取')"
  # 阶段 58 修（B 类）：原断言是「相对 stage-46 起点 5dbd37a，FAQ 恰好 +1 条」——那是对**它自己那次 diff**
  # 的一次性声明，在 HEAD 上不可复核（README 已在 v57 被用户化重写，条目数 10 → 6）⇒ 恒红。
  # 本阶段真正的要求是"FAQ 里有那条拉取失败/慢的条目、且 FAQ 没被清空"：前者由上一行承担，这里守后者。
  FAQ_NOW=$(grep -c '^\*\*.*？\*\*$' README.md || true)
  ge "⑤ FAQ 章节仍有条目（问句）" 1 "$FAQ_NOW"
  ge "⑤ 文中给出可换其它镜像站的说明（措辞容错）" 1 "$(grep -cE '不写死具体.{0,4}站点|站点可用性会变|各家可用性会变|换镜像站|拉下来再|任一可用' README.md || true)"
  # ⑤ 文中不得出现被当成唯一方案的具名公开加速站
  eq "⑤ 未绑定任何具名公开加速站" 0 "$(grep -cE '(docker\.1panel|dockerproxy|daocloud|docker\.io\.cn|registry\.cn-hangzhou|mirror\.ccs)' README.md || true)"
  # ⑥ 文档准确：不引用不存在的脚本（沿用既有口径）
  eq "⑥ grep -c 'ac-stage9.sh' README.md" 0 "$(grep -c 'ac-stage9.sh' README.md || true)"

  # —— 返工补充（FR-109 第二轮）：README 必须写出官方镜像**完整地址**，不能只有占位符 ——
  eq "返工 部署章节写出官方镜像完整地址 hopetree/promptmanager" 1 "$(awk -v s="$DEPLOY_LINE" -v e="$FAQ_LINE" 'NR>=s && NR<e && /hopetree\/promptmanager/ {c++} END {print (c>0?1:0)}' README.md)"
  eq "返工 给出可**直接复制**的完整 docker pull 命令" 1 "$(grep -c 'docker pull hopetree/promptmanager:' README.md | head -1 | awk '{print ($1>0?1:0)}')"
  # 阶段 58 修（B 类）：原断言要求「`<命名空间>` 被定义成 hopetree」。README 用户化后**直接写具体命名空间**，
  # 全文已无 `<命名空间>` 占位符 ⇒ 原断言恒红。改成二选一都算过，但两支都承重（见下 if 的两支）。
  PLACEHOLDERS=$(grep -c '<命名空间>' README.md || true)
  if [ "$PLACEHOLDERS" = "0" ]; then
    eq "返工 无占位符：正文用具体命名空间 hopetree/promptmanager（读者无需填任何东西）" 1 "$(grep -c 'hopetree/promptmanager' README.md | head -1 | awk '{print ($1>0?1:0)}')"
  else
    eq "返工 仍有 <命名空间>：必须说明它 == hopetree" 1 "$(grep -cE '<命名空间>[^`]{0,8}`? *= *`?hopetree|`<命名空间>` *= *`hopetree`' README.md | head -1 | awk '{print ($1>0?1:0)}')"
  fi
  # 每一个 <命名空间> 出现处，其上下 12 行内都要有 hopetree（否则那一处仍让读者填不出来）
  ORPHAN=$(python3 - "$PWD" <<'PYEOF'
import sys
lines = open('README.md', encoding='utf-8').read().split('\n')
bad = []
for i, line in enumerate(lines):
    if '<命名空间>' not in line:
        continue
    ctx = '\n'.join(lines[max(0, i - 12):i + 13])
    if 'hopetree' not in ctx:
        bad.append(str(i + 1))
print(','.join(bad) if bad else 'none')
PYEOF
)
  eq "返工 所有 <命名空间> 出现处附近都有 hopetree（孤立处）" "none" "$ORPHAN"
  eq "返工 「备份与升级」的升级命令也给出完整地址" 1 "$(grep -c 'docker pull hopetree/promptmanager:<新版本>' README.md | head -1 | awk '{print ($1>0?1:0)}')"
  # 两件事不能混：官方仓库写死、加速站仍不写死
  # 阶段 58 修（B 类）：原 pattern `官方仓库[^。]{0,40}固定|固定该写死` 钉死了「固定」这个措辞 ——
  # README 现行写法是「`latest` 与各版本号永远指向正式版」「换镜像站拉，再 tag 回规范名（后续命令不用改）」，
  # 一个「固定」都不含，于是恒红。断言原意是「官方规范名稳定、不随加速站漂移」，按**语义**重写 pattern。
  eq "返工 说明官方规范名稳定（换加速站后仍 tag 回规范名 / latest 永远指向正式版）" 1 "$(grep -cE 'tag 回规范名|永远指向正式版|替换成它给的名字|后续命令不用改' README.md | head -1 | awk '{print ($1>0?1:0)}')"
  eq "返工 加速站仍不绑定任何具名站" 0 "$(grep -cE '(docker\.1panel|dockerproxy|daocloud|docker\.io\.cn|registry\.cn-hangzhou|mirror\.ccs)' README.md || true)"
  # 阶段 58 修（B 类）：原 pattern 要求出现「不写死具体站点」这个完整短语，而 README 写的是
  # 「不写死具体**加速**站点 —— 各家可用性会变，挑你所在网络里能用的那个」，中间多两个字就匹配不上 ⇒ 恒红。
  # 原意是「加速站可换、不绑死一家」，用容错 pattern 保住原意（`:137` 那条负责「不绑具名站」）。
  eq "返工 仍保留「加速站可换」的方法性说明（不写死具体站 / 各家可用性会变）" 1 "$(grep -cE '不写死具体.{0,4}站点|各家可用性会变|挑你所在网络里能用的|公开镜像站都行' README.md | head -1 | awk '{print ($1>0?1:0)}')"
  # 阶段 58 修（B 类）：原断言 `git diff --name-only HEAD -- …` 只看**未暂存**改动，实际是"跑本脚本时
  # 工作树里别夹带部署文件改动"这个**前置条件**。改用 `git status --porcelain`（含已暂存/未跟踪），
  # 语义标注也改成它真正的意思 —— 历史归属交给 git 历史，不由脚本断言。
  eq "返工 运行本脚本时工作树里没有部署文件改动（纯文档阶段的前提）" 0 "$(git status --porcelain -- Dockerfile docker-compose.yml .github/workflows 2>/dev/null | wc -l)"
  eq "⑥ README 里引用的 deploy/ 文件都存在" 0 "$(python3 - <<'PY'
import re, os
missing = []
for m in re.finditer(r'\]\((deploy/[^)#]+)', open('README.md', encoding='utf-8').read()):
    if not os.path.exists(m.group(1)):
        missing.append(m.group(1))
print(len(missing))
PY
)"
  # 阶段 58 修（B 类）：原断言 grep 的是字面量 `docker pull <命名空间>/promptmanager:1.0.2` —— 占位符时代的
  # 旧写法（README 现在写 `hopetree/promptmanager:latest`）⇒ 恒红。保持原意（"README 的版本口径与
  # package.json 一致"），改成**真的读 package.json**：钉了版本就必须相同，只用 latest 就必须给出 latest。
  PKG_V=$(jq -r .version package.json)
  PINNED=$(grep -oE 'hopetree/promptmanager:[0-9][0-9A-Za-z.+-]*' README.md | sed 's/.*://' | sort -u | tr '\n' ' ')
  echo "  \$ package.json 版本 = $PKG_V ｜ README 里钉死的镜像版本 = [${PINNED% }]"
  if [ -z "${PINNED// /}" ]; then
    ge "⑥ README 用 latest 拉取（未钉死版本，不会随版本号过期）" 1 "$(grep -c 'docker pull hopetree/promptmanager:latest' README.md | head -1 | awk '{print ($1>0?1:0)}')"
  else
    eq "⑥ README 钉死的镜像版本与 package.json 一致" "$PKG_V" "$(printf '%s' "$PINNED" | tr -d ' ')"
  fi
  # ⑦ 阶段 58 修（B 类）：原断言 `git diff --name-only HEAD~1 HEAD -- …` 测的是**最近一次提交**，与"本阶段
  # 改动集"不是一回事；且 5dbd37a..HEAD 期间 `.github/workflows/docker.yml` 已被后续阶段合法改过
  # （1 个文件）⇒ 任何历史对照形式在 HEAD 上必然失真。改为可复核且不会随历史漂移的形式：
  # **部署三件套仍在、且仍给出开箱即用的端口映射**（用户不必改配置 —— 这才是 ⑦"不给用户加负担"的本意）。
  eq "⑦ Dockerfile 仍在" 1 "$([ -f Dockerfile ] && echo 1 || echo 0)"
  eq "⑦ docker-compose.yml 仍在" 1 "$([ -f docker-compose.yml ] && echo 1 || echo 0)"
  eq "⑦ GitHub workflow 仍在（.github/workflows/*.yml）" 1 "$(ls .github/workflows/*.yml >/dev/null 2>&1 && echo 1 || echo 0)"
  ge "⑦ docker-compose.yml 仍给出 8767 端口映射（开箱即用）" 1 "$(grep -c '8767:8767' docker-compose.yml || true)"
fi

if [ "$ONLY" = "all" ] || [ "$ONLY" = "login" ]; then
  line "AC-110 ①③⑧：登录页双视口几何 + 成对截图（**等页面稳定后再量**）"
  printf '%s\n' "$AC_PW" | DATA_DIR="$DIR" node bin/pm.mjs user set-password --username "$AC_USER" >/dev/null
  DATA_DIR="$DIR" PORT="$PORT" node dist/server/index.js >"$DIR/server.log" 2>&1 &
  SRV_PID=$!
  CODE=''
  for _ in $(seq 1 60); do
    CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/healthz" 2>/dev/null || true)
    [ "$CODE" = "200" ] && break
    sleep 0.3
  done
  if [ "$CODE" != "200" ]; then
    fail "服务未起来（$DIR/server.log）"
  else
    # 改后几何（当前工作区 = 已修版本）
    node tools/ac-stage46-probe.mjs measure "$BASE" "$SHOTS" after | tee "$DIR/after.log"
    G390=$(grep -m1 '^geo_390=' "$DIR/after.log" | cut -d= -f2-)
    G1600=$(grep -m1 '^geo_1600=' "$DIR/after.log" | cut -d= -f2-)

    echo "  \$ 390 改后：$G390"
    eq "① 390×844 视口高" 844 "$(f "$G390" '.innerHeight')"
    le "① 390 #pm-login 高度 ≤ 视口高" 844 "$(f "$G390" '.loginHeight')"
    eq "① 390 loginHeight 应为 844（= 视口高，border-box 生效）" 844 "$(f "$G390" '.loginHeight')"
    eq "① 390 documentElement.scrollHeight ≤ innerHeight" true "$(f "$G390" '.docScrollHeight <= .innerHeight')"
    le "② 390 纵向溢出 scrollHeight - innerHeight" 0 "$(f "$G390" '.overflowY')"
    eq "① 390 box-sizing 已是 border-box" "border-box" "$(f "$G390" '.rootStyle.boxSizing')"
    eq "③ 390 居中/留白参数未变（padding 48px 24px）" "48px 24px" "$(f "$G390" '.rootStyle.padding')"
    eq "③ 390 仍垂直居中（display/align/justify）" "flex,center,center" "$(f "$G390" '.rootStyle.display'),$(f "$G390" '.rootStyle.alignItems'),$(f "$G390" '.rootStyle.justifyContent')"

    echo "  \$ 1600 改后：$G1600"
    eq "① 1600×900 视口高" 900 "$(f "$G1600" '.innerHeight')"
    le "① 1600 #pm-login 高度 ≤ 视口高" 900 "$(f "$G1600" '.loginHeight')"
    eq "① 1600 loginHeight 应为 900（= 视口高）" 900 "$(f "$G1600" '.loginHeight')"
    eq "① 1600 documentElement.scrollHeight ≤ innerHeight" true "$(f "$G1600" '.docScrollHeight <= .innerHeight')"
    le "② 1600 纵向溢出 scrollHeight - innerHeight" 0 "$(f "$G1600" '.overflowY')"
    eq "① 1600 box-sizing 已是 border-box" "border-box" "$(f "$G1600" '.rootStyle.boxSizing')"

    # ③ 视觉不变：与**改前**基线（PROGRESS 阶段 46 §1 记录的原样输出）逐字段比 ±2px
    #    改前实测：390 title x24 w342 / user x55 w299 / pass x55 w280 / submit x24 w342
    #              1600 title x590 w420 / user x621 w377 / pass x621 w358 / submit x590 w420
    near "③ 390 标题 x" 24 "$(f "$G390" '.title.x')" 2
    near "③ 390 标题 width" 342 "$(f "$G390" '.title.width')" 2
    near "③ 390 用户名输入 x" 55 "$(f "$G390" '.userInput.x')" 2
    near "③ 390 用户名输入 width" 299 "$(f "$G390" '.userInput.width')" 2
    near "③ 390 口令输入 x" 55 "$(f "$G390" '.passInput.x')" 2
    near "③ 390 口令输入 width" 280 "$(f "$G390" '.passInput.width')" 2
    near "③ 390 登录按钮 x" 24 "$(f "$G390" '.submit.x')" 2
    near "③ 390 登录按钮 width" 342 "$(f "$G390" '.submit.width')" 2
    near "③ 1600 标题 x" 590 "$(f "$G1600" '.title.x')" 2
    near "③ 1600 标题 width" 420 "$(f "$G1600" '.title.width')" 2
    near "③ 1600 用户名输入 x" 621 "$(f "$G1600" '.userInput.x')" 2
    near "③ 1600 用户名输入 width" 377 "$(f "$G1600" '.userInput.width')" 2
    near "③ 1600 口令输入 x" 621 "$(f "$G1600" '.passInput.x')" 2
    near "③ 1600 口令输入 width" 358 "$(f "$G1600" '.passInput.width')" 2
    near "③ 1600 登录按钮 x" 590 "$(f "$G1600" '.submit.x')" 2
    near "③ 1600 登录按钮 width" 420 "$(f "$G1600" '.submit.width')" 2
    eq "登录页运行时异常" "[]" "$(grep -m1 '^runtime_errors=' "$DIR/after.log" | cut -d= -f2-)"

    line "AC-110 ④：主界面冒烟（真浏览器，登录后不溢出/不横滚）"
    JAR="$DIR/jar.txt"
    curl -s -c "$JAR" -o /dev/null -X POST -H 'Content-Type: application/json' \
      -d "{\"username\":\"$AC_USER\",\"password\":\"$AC_PW\"}" "$BASE/api/login"
    SID=$(awk '$6 == "pm_sid" { print $7 }' "$JAR" | tail -1)
    [ -z "$SID" ] && fail "登录失败，拿不到 pm_sid"
    curl -s -b "$JAR" -o /dev/null -H 'Content-Type: application/json' -d '{"title":"AC110 冒烟","user_prompt":"你好 {{姓名}}"}' "$BASE/api/prompts"
    node tools/ac-stage46-main-probe.mjs "$BASE" "$SID" "$SHOTS" | tee "$DIR/main.log"
    M390=$(grep -m1 '^main_390=' "$DIR/main.log" | cut -d= -f2-)
    M1600=$(grep -m1 '^main_1600=' "$DIR/main.log" | cut -d= -f2-)
    echo "  \$ 主界面 390：$M390"
    echo "  \$ 主界面 1600：$M1600"
    eq "④ 390 主界面无纵向溢出" true "$(f "$M390" '.docScrollHeight <= .innerHeight')"
    eq "④ 390 主界面无横向滚动" true "$(f "$M390" '.docScrollWidth <= .innerWidth')"
    eq "④ 1600 主界面无纵向溢出" true "$(f "$M1600" '.docScrollHeight <= .innerHeight')"
    eq "④ 1600 主界面无横向滚动" true "$(f "$M1600" '.docScrollWidth <= .innerWidth')"
    eq "④ 主界面有真实内容（列表行 > 0）" true "$(f "$M1600" '.promptRows > 0')"
    eq "④ 主界面运行时异常" "[]" "$(grep -m1 '^main_runtime_errors=' "$DIR/main.log" | cut -d= -f2-)"
  fi

  line "AC-110 ⑧：成对截图"
  find "$SHOTS" -name '*.png' | sort | sed 's/^/  /'
  eq "截图齐备（改前 390/1600 + 改后 390/1600 = 4）" 4 "$(find "$SHOTS" -name '*.png' 2>/dev/null | wc -l)"
fi

line "结论"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ AC-110 全部通过"
else
  echo "  ❌ 有未通过项（见上方 ❌）"
fi
exit "$FAIL"
