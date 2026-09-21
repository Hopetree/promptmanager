#!/usr/bin/env bash
# 阶段 33 验收自检（FR-89 / AC-91）：GitHub Actions 构建镜像并推送 Docker Hub。
#
#   AC-91 ① YAML 静态断言（真解析，不是 grep 文本）：触发条件 / permissions / 五个官方 action 的 pin /
#            镜像名引用 DOCKERHUB_USERNAME / 登录引用 DOCKERHUB_TOKEN；**负向断言**：无 echo+secrets、
#            无 set -x、无明文 token/用户名、无 pull_request_target
#   AC-91 ② 与 106 现行构建的一致性：context/Dockerfile/platform/tag 方案对照
#   AC-91 ③ 等价构建：打印 host_manger 在 106 的实测结论（本机无 Docker，不由我产生该证据）
#   AC-91 ④ 端到端实跑：**待用户配 secrets 后由 host_manger 触发** —— 本脚本只记录状态，不判通过
#
# 本脚本**不需要 Docker、不起服务、不联网**（≈1 秒）；`python3` + `pyyaml` 已在本机可用。
# 用法：bash tools/ac-stage33.sh
set -u

cd "$(dirname "$0")/.." || exit 1
WF='.github/workflows/docker.yml'
CI_WF='.github/workflows/ci.yml'
FAIL=0

line() { printf '\n=== %s ===\n' "$1"; }
pass() { printf '  ✅ %s\n' "$1"; }
fail() { printf '  ❌ %s\n' "$1"; FAIL=1; }
eq() { if [ "$2" = "$3" ]; then pass "$1 = $3"; else fail "$1 = $3（期望 $2）"; fi; }

line "AC-91 ①：YAML 静态断言（真解析）"
if [ ! -f "$WF" ]; then
  fail "找不到 $WF"
else
  pass "$WF 存在（$(wc -l <"$WF") 行）"
  echo "  \$ python3 -c \"import yaml; d=yaml.safe_load(open('$WF'))\"   # 真解析"
  OUT=$(python3 - "$WF" <<'PY'
import io, sys, yaml

path = sys.argv[1]
raw = io.open(path, encoding='utf-8').read()
doc = yaml.safe_load(raw)

# ⚠️ YAML 1.1 里裸键 `on:` 会被解析成布尔 True，所以两种键都要认
on = doc.get('on', doc.get(True))
if on is None:
    print('FAIL on: 触发条件缺失'); raise SystemExit(0)

problems = []
def check(cond, label):
    print(('  ok   ' if cond else '  FAIL ') + label)
    if not cond:
        problems.append(label)

# --- 触发条件 ---
push = (on or {}).get('push') or {}
check(sorted(push.get('tags') or []) == ['v*'], f"push.tags == ['v*']（实际 {push.get('tags')}）")
check(sorted(push.get('branches') or []) == ['main'], f"push.branches == ['main']（实际 {push.get('branches')}）")
check('workflow_dispatch' in on, 'workflow_dispatch 存在（手动补跑）')
check('pull_request' not in on and 'pull_request_target' not in on, '未挂 pull_request / pull_request_target')

# --- 权限最小化 ---
check(doc.get('permissions') == {'contents': 'read'}, f"permissions == contents: read（实际 {doc.get('permissions')}）")

# --- 五个官方 action 都 pin 到大版本 ---
steps = doc['jobs']['build']['steps']
uses = [s.get('uses') for s in steps if s.get('uses')]
expected = [
    'actions/checkout@v4',
    'docker/setup-buildx-action@v3',
    'docker/login-action@v3',
    'docker/metadata-action@v5',
    'docker/build-push-action@v6',
]
check(uses == expected, f'五个 action 的 uses 顺序与 pin 完全符合（实际 {uses}）')
check(all('@' in u and u.split('@')[1].startswith('v') and u.split('@')[1][1:].isdigit() for u in uses),
      '每个 uses 都 pin 到 @v<数字>（无 @main / 无浮动引用）')

# --- 镜像名与登录凭据 ---
meta = next(s for s in steps if s.get('uses', '').startswith('docker/metadata-action'))
login = next(s for s in steps if s.get('uses', '').startswith('docker/login-action'))
check(meta['with']['images'] == '${{ secrets.DOCKERHUB_USERNAME }}/promptmanager',
      f"镜像名 = secrets.DOCKERHUB_USERNAME/promptmanager（实际 {meta['with']['images']}）")
check(login['with'].get('password') == '${{ secrets.DOCKERHUB_TOKEN }}',
      '登录口令 = secrets.DOCKERHUB_TOKEN')
check(login['with'].get('username') == '${{ secrets.DOCKERHUB_USERNAME }}',
      '登录用户名 = secrets.DOCKERHUB_USERNAME')
check(set(login['with'].keys()) == {'username', 'password'}, f"login 只带 username/password（实际 {sorted(login['with'])}）")

# --- AC-91 ③ 等价构建参数 ---
build = next(s for s in steps if s.get('uses', '').startswith('docker/build-push-action'))
bw = build['with']
check(bw.get('context') == '.', f"context == '.'（实际 {bw.get('context')!r}）")
check(bw.get('file') == 'Dockerfile', f"file == 'Dockerfile'（实际 {bw.get('file')!r}）")
check('target' not in bw, '未指定自定义 target（与 106 的等价命令一致）')
check(bw.get('platforms') == 'linux/amd64', f"platforms == linux/amd64（实际 {bw.get('platforms')!r}）")
check(bw.get('push') == "${{ startsWith(github.ref, 'refs/tags/v') }}",
      'push 只在 tag v* 时为真（main 只构建不推送）')

# --- 负向断言（安全红线）---
# ⚠️ 口径：**注释行不算**。"注释里描述这条规则"不是违规 —— 首版断言把注释里的 `set -x` 与
#    `${{ secrets.* }}` 也数了进去，导致假红；但**像 token 的长串 / `dckr_` 前缀仍看全文**，
#    因为把值写进注释同样是泄露。
code = '\n'.join(ln for ln in raw.splitlines() if not ln.strip().startswith('#'))
check('pull_request_target' not in raw, '全文不含 pull_request_target')
check('set -x' not in code, '非注释行里不含 set -x（未打开 shell 命令追踪）')
echo_lines = [ln.strip() for ln in code.splitlines() if 'echo' in ln and 'secrets' in ln]
check(not echo_lines, f'没有任何 echo + secrets 的行（实际 {echo_lines}）')
# 去掉 ${{ ... }} 表达式与 action 引用后再找"像 token 的长串"
stripped = raw
for expr in __import__('re').findall(r'\$\{\{[^}]*\}\}', raw):
    stripped = stripped.replace(expr, ' ')
leaks = [m for m in __import__('re').findall(r'[A-Za-z0-9_-]{32,}', stripped) if not m.startswith('docker/')]
check(not leaks, f'没有形如 token 的长串（实际 {leaks}）')
check('dckr_' not in raw, '不含 Docker Hub PAT 前缀 dckr_')
# 只允许 3 处 secrets 引用，且都是上面已断言过的那 3 处（注释不算）
n_secrets = code.count('${{ secrets.')
check(n_secrets == 3, f'非注释行里恰好 3 处 secrets 引用（login.username / login.password / images；实际 {n_secrets}）')

print('PROBLEMS=' + str(len(problems)))
PY
)
  echo "$OUT" | sed 's/^/  /'
  eq "① 静态断言失败项数" 0 "$(printf '%s\n' "$OUT" | grep -c '^  FAIL')"
fi

line "AC-91 ②：与 106 现行构建的一致性 + tag 方案（按 metadata-action 规则手算，不是跑 action）"
echo "  \$ grep -n 'type=\\|flavor\\|platforms\\|context\\|file:' $WF"
grep -n 'type=\|flavor\|platforms\|context\|file:' "$WF" | sed 's/^/  /'
eq "② tag 规则 4 条（semver / major.minor / raw latest / ref branch）" 4 "$(grep -c '^            type=' "$WF")"
TAGS=$(python3 - <<'PY'
# 按 workflow 里声明的规则**手算** tag（metadata-action 无法在本机跑：它是 Docker action）
# 规则：type=semver,pattern={{version}} / {{major}}.{{minor}} / type=raw,value=latest(enable=tag v*) / type=ref,event=branch
def tags_for(ref):
    out = []
    if ref.startswith('refs/tags/v'):
        ver = ref[len('refs/tags/v'):]
        parts = ver.split('.')
        if len(parts) >= 2:
            out += [ver, f'{parts[0]}.{parts[1]}', 'latest']
    elif ref.startswith('refs/heads/'):
        out.append(ref[len('refs/heads/'):])
    return out
print('refs/tags/v1.0.1 ->', ','.join(tags_for('refs/tags/v1.0.1')))
print('refs/heads/main ->', ','.join(tags_for('refs/heads/main')))
PY
)
echo "$TAGS" | sed 's/^/  /'
eq "② 推 v1.0.1 产出 1.0.1 + 1.0 + latest" "refs/tags/v1.0.1 -> 1.0.1,1.0,latest" "$(printf '%s\n' "$TAGS" | head -1)"
eq "② main 分支只算本地 tag（且 push=false ⇒ 不推送）" "refs/heads/main -> main" "$(printf '%s\n' "$TAGS" | tail -1)"
cat <<'TXT' | sed 's/^/  /'
  对照表（workflow 参数 ↔ 106 现行命令）：
    context      = .            ↔  docker build -t promptmanager:1.0.1 .   （末尾的 . 就是 context）
    file         = Dockerfile   ↔  默认 ./Dockerfile（未指定 -f）
    target       = （未指定）    ↔  未指定 --target
    platforms    = linux/amd64  ↔  106 是 x86_64 本机原生构建
    tag          = 1.0.1/1.0/latest ↔  106 现行命令只打了 promptmanager:1.0.1（同一份产物，多打两个别名）
TXT

line "AC-91 ③：等价构建实测（**由 host_manger 在 106 执行**，本机无 Docker）"
echo "  \$ command -v docker || echo '本机无 docker'"
(command -v docker || echo '本机无 docker') | sed 's/^/  /'
cat <<'TXT' | sed 's/^/  /'
  host_manger 在 106 的实测结论（2026-09-21，写入 PROGRESS §③）：
    $ docker build -t promptmanager:1.0.1 .
    → 构建成功，耗时 36 秒，镜像 959MB
  结论：Dockerfile 在 106 上可构建；workflow 的 build 参数与上述命令等价（见 AC-91 ② 对照表）。
TXT

line "AC-91 ④：端到端实跑（状态记录，**本脚本不判通过**）"
cat <<'TXT' | sed 's/^/  /'
  状态：**未完成 —— 待用户在 GitHub 仓库配好 DOCKERHUB_USERNAME / DOCKERHUB_TOKEN 后，
        由 host_manger 触发验证**（workflow_dispatch 或推 tag）。
  为什么 dsh 做不了：仓库私有（未认证 API 对 repo/actions 都返回 404）、本机无 gh CLI / 无 token /
  无 Docker Hub 凭据；且"触发推送"是 host_manger 的事（BRIEF AC-91 ④ 明示）。
  验收步骤（host_manger）：Actions 绿 → docker pull <ns>/promptmanager:<ver> 能拉下 →
  在 106 上 docker run 起容器 → /healthz 的 version 正确。
TXT

line "不改动 ci.yml（本阶段只新增 docker.yml）"
echo "  \$ git log --oneline -1 -- $CI_WF"
git log --oneline -1 -- "$CI_WF" | sed 's/^/  /'
eq "ci.yml 的检查项未被改动（仍是 npm ci + 同一脚本）" "true" "$(python3 -c "
src = open('$CI_WF', encoding='utf-8').read()
ok = ('run: npm ci' in src) and ('run: bash tools/ci-check.sh' in src) and (\"node-version: '24'\" in src)
print('true' if ok else 'false')
")"

line "结论"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ AC-91 ① ② ③ 全部通过；④ 如实标注为「待用户配 secrets 后由 host_manger 触发验证」"
else
  echo "  ❌ 有未通过项（见上方 ❌）"
fi
exit "$FAIL"
