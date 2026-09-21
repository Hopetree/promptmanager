#!/usr/bin/env bash
# 阶段 20 验收自检：
#   AC-66 详情页头部去冗余（R-1）—— 详情面正文区无「当前字段+👁预览」头部、其余控件仍在、
#        「页签行底部 → 正文区顶部」间距前后对照（减少 ≥30px）、编辑器页 3 字段下拉仍生效
#   AC-67 ⋯更多「修改密码」（**必须用内网 IP 访问**）—— 菜单逐项、弹窗、前端校验、
#        正例（真交互改密 → 新口令可登录 / 旧口令 401 / 当前会话仍在 / 其它会话被吊销）、
#        负例（当前密码错 → 明确提示且**不是 401**）、限流 5/60s → 429、日志与响应体无明文口令
#
# 服务**自起自停**（临时 DATA_DIR + 备用端口）；**验收结束把口令改回原值并留痕**。
# 用法：bash tools/ac-stage20.sh
set -u

cd "$(dirname "$0")/.." || exit 1
PORT=${PORT:-auto}
LAN_IP=${LAN_IP:-192.168.0.228}
AC_USER='admin'
AC_PW='ac-fixture-pw-20260918'          # 原值（验收后要改回来的就是它）
AC_PW_NEW='ac-fixture-pw-20260920-NEW'  # 正例用的新口令
SHOTS='tmp/shots/stage20'
FAIL=0

pick_port() {
  for candidate in 8765 8766 8767 8768 8769 8770; do
    if ! ss -ltn | grep -q ":$candidate "; then echo "$candidate"; return 0; fi
  done
  return 1
}
if [ "${PORT}" = "auto" ]; then
  PORT=$(pick_port) || { echo "FAIL 台账范围 8765–8770 全被占用（写 QUESTIONS 停手）"; exit 1; }
  echo "  PORT 自动选择：$PORT（备用端口，不碰 8767 测试环境）"
fi
SECURE="http://127.0.0.1:$PORT"
LAN="http://$LAN_IP:$PORT"
line() { printf '\n=== %s ===\n' "$1"; }
pass() { printf '  ✅ %s\n' "$1"; }
fail() { printf '  ❌ %s\n' "$1"; FAIL=1; }
eq() { if [ "$2" = "$3" ]; then pass "$1 = $3"; else fail "$1 = $3（期望 $2）"; fi; }
ge() { if [ "${3:-}" != '' ] && [ "$3" -ge "$2" ] 2>/dev/null; then pass "$1 = $3（期望 ≥$2）"; else fail "$1 = ${3:-空}（期望 ≥$2）"; fi; }
le() { if [ "${3:-}" != '' ] && [ "$3" -le "$2" ] 2>/dev/null; then pass "$1 = $3（期望 ≤$2）"; else fail "$1 = ${3:-空}（期望 ≤$2）"; fi; }

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
AC_DIR=$(mktemp -d /tmp/pm-ac20-XXXXXX)

# ---------------------------------------------------------------- 静态侧
line "AC-66 ①③：源码侧（MarkdownPreview 单字段不渲染头部 / 详情面有测量锚点）"
eq "MarkdownPreview 有 fields.length > 1 判断" 1 "$(grep -c 'fields.length > 1' web/src/components/MarkdownPreview.tsx)"
eq "详情面测量锚点 pm-detail-fields" 1 "$(grep -c 'data-testid="pm-detail-fields"' web/src/components/PromptDetail.tsx)"
eq "详情面测量锚点 pm-detail-body" 1 "$(grep -c 'data-testid="pm-detail-body"' web/src/components/PromptDetail.tsx)"

line "AC-67 ①：源码侧（菜单顺序 + 弹窗 testid + 无「已登录」）"
eq "AppHeader 无「已登录」字样" 0 "$(grep -c '已登录' web/src/components/AppHeader.tsx)"
eq "pm-menu-password 存在" 1 "$(grep -c 'data-testid="pm-menu-password"' web/src/components/AppHeader.tsx)"
eq "修改密码弹窗 testid" 1 "$(grep -c 'data-testid="pm-password-modal"' web/src/components/PasswordModal.tsx)"
eq "三个 Input.Password" 3 "$(grep -c 'Input.Password' web/src/components/PasswordModal.tsx)"
eq "新接口 /api/password 在 api.ts" 1 "$(grep -c "'/api/password'" web/src/api.ts)"
eq "服务端路由 POST /api/password" 1 "$(grep -c "app.post('/api/password'" src/server/routes/auth.ts)"

line "构建 / 类型检查（体积预算不破）"
BUILD_LOG="$AC_DIR/build.log"
npm run build >"$BUILD_LOG" 2>&1
eq "npm run build 退出码" 0 "$?"
eq "构建输出里的 >500KB 告警数" 0 "$(grep -c 'larger than 500' "$BUILD_LOG")"
MAXCHUNK=$(node -e '
const fs=require("fs"), path=require("path");
const dir="dist/web/assets";
const rows=fs.readdirSync(dir).filter((f)=>/\.js$/.test(f)).map((f)=>({f, raw:fs.statSync(path.join(dir,f)).size})).sort((a,b)=>b.raw-a.raw);
console.log(rows[0].raw);
')
le "最大 chunk（未压缩，byte）" 500000 "$MAXCHUNK"
npm run typecheck:web >/dev/null 2>&1
eq "npm run typecheck:web 退出码" 0 "$?"

line "本阶段新增单测（AC-66 源码 / AC-67 接口与前端）"
TEST_LOG="$AC_DIR/tests.log"
node --test tests/api-password.test.ts tests/stage20-detail-header.test.ts tests/stage20-password-ui.test.ts >"$TEST_LOG" 2>&1
eq "两个新测试文件退出码" 0 "$?"
grep -E "^ℹ (tests|pass|fail)" "$TEST_LOG" | sed 's/^/  /'

# ---------------------------------------------------------------- 运行时侧
line "运行时：临时实例（0.0.0.0:$PORT，内网 IP = $LAN_IP；不碰 8767 测试环境）"
if ss -ltn | grep -q ":$PORT "; then
  fail "端口 $PORT 被占用"
else
  printf '%s\n' "$AC_PW" | DATA_DIR="$AC_DIR" node bin/pm.mjs user set-password --username "$AC_USER" >"$AC_DIR/cli.log" 2>&1
  DATA_DIR="$AC_DIR" HOST=0.0.0.0 PORT="$PORT" node dist/server/index.js >"$AC_DIR/server.log" 2>&1 &
  SRV_PID=$!
  CODE=''
  for _ in $(seq 1 60); do
    CODE=$(curl -s -o /dev/null -w '%{http_code}' "$SECURE/healthz" 2>/dev/null || true)
    [ "$CODE" = "200" ] && break
    sleep 0.3
  done
  if [ "$CODE" != "200" ]; then
    fail "服务未起来（$AC_DIR/server.log）"
  else
    pass "监听：$(ss -ltn | grep ":$PORT " | head -1 | tr -s ' ')"
    # 三份会话：jar1 = 探针/浏览器（当前会话），jar2 / jar3 = 其它会话（应被吊销）
    for n in 1 2 3; do
      curl -s -c "$AC_DIR/jar$n.txt" -o /dev/null -X POST -H 'Content-Type: application/json' \
        -d "{\"username\":\"$AC_USER\",\"password\":\"$AC_PW\"}" "$SECURE/api/login"
    done
    SID1=$(awk '$6 == "pm_sid" { print $7 }' "$AC_DIR/jar1.txt" | tail -1)
    [ -z "$SID1" ] && fail "登录失败，拿不到 pm_sid"
    # 夹具：两条 prompt（详情面/编辑器用）
    curl -s -b "$AC_DIR/jar1.txt" -H 'Content-Type: application/json' \
      -d '{"title":"AC66 详情夹具","user_prompt":"## 用户提示词\n\n这是用户侧正文（用于 AC-66 的详情面）。","system_prompt":"系统提示词内容（与用户提示词不同，便于验证切换）。","notes":"备注内容。"}' \
      "$SECURE/api/prompts" >/dev/null

    # ---------- AC-66 ----------
    line "AC-66：详情页头部去冗余（真鼠标 + 真实像素）"
    rm -rf "$SHOTS"
    node tools/ac-stage20-probe.mjs detail "$SECURE" "$SID1" "$SHOTS" | tee "$AC_DIR/detail.log"
    v() { grep -m1 "^$1=" "$AC_DIR/detail.log" | cut -d= -f2-; }
    eq "① 详情面内不含文本「当前字段」" "false" "$(v ac66_detail_text_has_currentfield)"
    eq "① 详情面内 Select 数 = 0" "0" "$(v ac66_detail_select_count)"
    eq "① 正文区无 eye 说明标签" "0" "$(v ac66_body_eye_count)"
    pass "② 详情面其余控件：$(v ac66_fields_present)"
    eq "② 页签/分段/纯文本/全屏 都在（且 FR-79 起无「备注」页签）" "true" "$(echo "$(v ac66_fields_present)" | jq -r '.tabs and (.notesTab == 0) and (.segments >= 2) and .plain and .fullscreen')"
    pass "③ 间距（修复后）：$(v ac66_gap)"
    BEFORE_GAP=52   # 修复前实测（tmp/measure-ac66-before.sh：fieldsBottom 203 → contentTop 255）
    AFTER_GAP=$(echo "$(v ac66_gap)" | jq -r .gap 2>/dev/null)
    if [ -n "$AFTER_GAP" ] && [ "$AFTER_GAP" -ge 0 ] 2>/dev/null; then
      le "③ 修复后间距（px）" 30 "$AFTER_GAP"
      ge "③ 间距减少量（修复前 $BEFORE_GAP − 修复后）" 30 "$((BEFORE_GAP - AFTER_GAP))"
    else
      fail "③ 间距测量失败（ac66_gap=$(v ac66_gap)）"
    fi
    pass "④ 编辑器页字段下拉：$(v ac66_editor_dropdown_items)（选项数 $(v ac66_editor_option_count)）"
    eq "④ 编辑器页预览字段 = 2 项（v28：备注已从预览里去掉）" "2" "$(v ac66_editor_option_count)"
    eq "④ 切换字段后预览内容随之变化" "true" "$(v ac66_editor_switched)"
    pass "④ 预览变化：$(v ac66_editor_preview_before) → $(v ac66_editor_preview_after)"
    eq "页面运行时异常" "[]" "$(v ac20_runtime_errors)"

    # ---------- AC-67 ----------
    line "AC-67：⋯更多「修改密码」（内网 IP $LAN + 真鼠标）"
    AC_OLD_PW="$AC_PW" AC_NEW_PW="$AC_PW_NEW" \
      node tools/ac-stage20-probe.mjs password "$LAN" "$SID1" "$SHOTS" | tee "$AC_DIR/password.log"
    w() { grep -m1 "^$1=" "$AC_DIR/password.log" | cut -d= -f2-; }
    eq "① 菜单项逐项（含修改密码、不含已登录）" \
      '["使用统计","API 令牌","导入 / 导出","关于","修改密码","登出"]' "$(w ac67_menu_items)"
    eq "① 菜单数组含「修改密码」（正向锚点，防日志为空假过）" 1 "$(printf '%s' "$(w ac67_menu_items)" | grep -c '修改密码')"
    eq "① 菜单数组不含「已登录」" 0 "$(printf '%s' "$(w ac67_menu_items)" | grep -c '已登录')"
    eq "② 弹窗三个密码框" "3" "$(w ac67_modal_inputs)"
    eq "② autoComplete 正确" '["current-password","new-password","new-password"]' "$(w ac67_modal_autocomplete)"
    eq "④ 两次新密码不一致 → 不发请求" "0" "$(w ac67_mismatch_requests)"
    pass "④ 不一致错误提示：$(w ac67_mismatch_error)"
    eq "④ <8 字符 → 不发请求" "0" "$(w ac67_short_requests)"
    pass "④ 长度规则提示：$(w ac67_short_error)"
    eq "⑤ 正例发起了 1 次 /api/password" "1" "$(( $(w ac67_positive_requests_after) - $(w ac67_positive_requests_before) ))"
    pass "⑤ 成功提示：$(w ac67_positive_message)"
    eq "⑤ 成功后弹窗关闭" "true" "$(w ac67_modal_closed)"
    pass "负例错误提示：$(w ac67_wrong_old_error)"
    eq "⑧ 当前密码错误后当前会话仍可用（未被 401 踢出）" "200" "$(w ac67_still_logged_in)"
    eq "⑦ 关于页维护区提到界面改密码" "true" "$(w ac67_about_mentions_password)"

    line "AC-67 ③⑤⑥：HTTP 断言（curl 原样输出）"
    echo '$ curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Content-Type: application/json" -d {"username":"admin","password":"<新口令>"} /api/login'
    eq "新口令登录" 200 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d "{\"username\":\"$AC_USER\",\"password\":\"$AC_PW_NEW\"}" "$SECURE/api/login")"
    eq "旧口令登录（应 401）" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d "{\"username\":\"$AC_USER\",\"password\":\"$AC_PW\"}" "$SECURE/api/login")"
    eq "当前会话（发起修改的那个）仍 200" 200 "$(curl -s -b "$AC_DIR/jar1.txt" -o /dev/null -w '%{http_code}' "$SECURE/api/me")"
    eq "其它会话 2 被吊销（401）" 401 "$(curl -s -b "$AC_DIR/jar2.txt" -o /dev/null -w '%{http_code}' "$SECURE/api/me")"
    eq "其它会话 3 被吊销（401）" 401 "$(curl -s -b "$AC_DIR/jar3.txt" -o /dev/null -w '%{http_code}' "$SECURE/api/me")"

    echo; echo "  当前密码错误 → 400 而非 401（原样）："
    curl -s -b "$AC_DIR/jar1.txt" -o "$AC_DIR/body1.json" -w '  HTTP %{http_code}\n' -X POST -H 'Content-Type: application/json' \
      -d "{\"old_password\":\"definitely-wrong\",\"new_password\":\"$AC_PW_NEW\"}" "$SECURE/api/password"
    cat "$AC_DIR/body1.json"; echo
    eq "响应体是 invalid_old_password" '{"error":"invalid_old_password"}' "$(cat "$AC_DIR/body1.json")"

    echo; echo "  连续错误 → 429（原样；上面已错 1 次，再错 4 次凑满 5 次，第 6 次 429）："
    for i in 2 3 4 5; do
      curl -s -b "$AC_DIR/jar1.txt" -o /dev/null -w "  第 $i 次：%{http_code}\n" -X POST -H 'Content-Type: application/json' \
        -d "{\"old_password\":\"wrong-$i\",\"new_password\":\"$AC_PW_NEW\"}" "$SECURE/api/password"
    done
    LIMITED=$(curl -s -b "$AC_DIR/jar1.txt" -o "$AC_DIR/body429.json" -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
      -d "{\"old_password\":\"wrong-6\",\"new_password\":\"$AC_PW_NEW\"}" "$SECURE/api/password")
    eq "第 6 次" 429 "$LIMITED"
    cat "$AC_DIR/body429.json"; echo

    line "AC-67 ⑥：服务端日志与响应体无明文口令"
    eq "日志含新口令（明文）次数" 0 "$(grep -c "$AC_PW_NEW" "$AC_DIR/server.log")"
    eq "日志含旧口令（明文）次数" 0 "$(grep -c "$AC_PW" "$AC_DIR/server.log")"
    cat "$AC_DIR/body1.json" "$AC_DIR/body429.json" > "$AC_DIR/bodies.txt"
    eq "响应体出现新口令的文件数" 0 "$(grep -l "$AC_PW_NEW" "$AC_DIR/body1.json" "$AC_DIR/body429.json" 2>/dev/null | wc -l)"
    eq "响应体含密码字段回显次数" 0 "$(grep -c '"old_password"\|"new_password"' "$AC_DIR/bodies.txt")"

    line "验收收尾：把口令改回原值（若正卡在限流窗口里，最多等 ~75s 重试）"
    RESTORE=''
    for _ in $(seq 1 15); do
      RESTORE=$(curl -s -b "$AC_DIR/jar1.txt" -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
        -d "{\"old_password\":\"$AC_PW_NEW\",\"new_password\":\"$AC_PW\"}" "$SECURE/api/password")
      [ "$RESTORE" = "204" ] && break
      sleep 5
    done
    eq "改回原值（204）" 204 "$RESTORE"
    eq "原值登录 200（验证方式：curl /api/login）" 200 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d "{\"username\":\"$AC_USER\",\"password\":\"$AC_PW\"}" "$SECURE/api/login")"
    eq "新值登录 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d "{\"username\":\"$AC_USER\",\"password\":\"$AC_PW_NEW\"}" "$SECURE/api/login")"
    echo "  改回时间：$(date '+%Y-%m-%d %H:%M:%S') ｜ 目标：开发环境临时实例（DATA_DIR=$AC_DIR，PORT=$PORT）"

    line "截图（$SHOTS）"
    ls -l "$SHOTS" | sed 's/^/  /'
    ge "截图张数" 8 "$(ls "$SHOTS"/*.png 2>/dev/null | wc -l)"
  fi
fi

line "结论"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ AC-66 / AC-67 全部通过"
else
  echo "  ❌ 有未通过项（见上方 ❌）"
fi
exit "$FAIL"
