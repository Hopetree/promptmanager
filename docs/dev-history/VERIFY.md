# promptmanager 验收报告（VERIFY）

> 由 **host_manger** 撰写。原则：不采信 dsh 的自述，只认命令输出、git 历史、
> 真起来的服务和会话日志里的过程证据。
> **本轮为阶段 1 阶段门验收**（BRIEF §11.4 阶段表）。

| 项 | 值 |
| --- | --- |
| 验收人 | host_manger |
| 验收日期 | 2026-09-18 |
| 对应 BRIEF 版本 | **v3**（v1 立项 / v2 追加组件库要求 / v3 更正 §6.8 unicode61 数字） |
| 被验收 commit | `2c82c9f`（dsh 阶段 1 收尾；验收时仓库 HEAD = `e61427c` = 我方 BRIEF v3，代码未变） |
| 本阶段应交付的 AC | AC-1、AC-2、AC-19、AC-20（+ dsh 提前交付的 AC-18、提前自检的 AC-17 / AC-21 预览） |
| **结论** | **阶段 1–9 全部过 —— P0 交付完成（未部署）** |

## 0. 验收方式（独立复现，不依赖实现方的自检脚本）

- 我在 **自己的临时数据目录**（`mktemp -d`）与 **自起自停** 的临时服务上重跑了阶段 1 的全部 AC；
  **没有**调用 dsh 的 `tools/ac-stage1.sh`（那是它的自证工具，本轮只用于过程审查比对）。
- 界面侧：**我自己起服务、自己用 headless chromium 截图**（亮色桌面 1280×800 + 移动 390×844）并**自己看图**；
  另用**更严的口径**复测了 AC-21（见 §1 AC-21 与 §4-①）。
- S0 报告：我用它文档里写的复现命令 `node tools/search-zh-poc.mjs` **独立跑了一遍**，与其报告 §3 数字逐项一致。
- 过程审查：解压它的会话日志（`session.v3.jsonl.zstd`，565 事件 / 120 次工具调用）核对"声称做了"与"实际跑了"。

## 1. 逐条验收

### AC-1 冷装与构建 — 判定：**过**

```
$ rm -rf node_modules dist && npm ci && npm run build; echo "rc=$?"
added 166 packages in 4s
> promptmanager@0.1.0 build → build:server(tsc) + build:web(vite build)
✓ 3095 modules transformed.
dist/web/index.html                  0.37 kB │ gzip:   0.25 kB
dist/web/assets/index-DZfuyTAY.js  842.53 kB │ gzip: 270.62 kB
✓ built in 504ms
rc=0
OK: dist/web + dist/server 存在
--- git status --short（应无构建产物）
（空 —— 构建产物全部被 .gitignore 覆盖，不入库）
```

附注（非缺陷，已记录）：`npm warn allow-scripts … better-sqlite3 (install: node-gyp rebuild)` —— npm 11 跳过其编译脚本，
但该包自带 `prebuilds/linux-x64.node`，**无需编译器即可用**；dsh 已把这条写进 `docs/dependencies.md` §4.1。

### AC-2 启动与监听 — 判定：**过**

```
$ DATA_DIR=<mktemp -d> PORT=8767 npm start &
$ ss -ltn | grep ':8767'
LISTEN 0      511          0.0.0.0:8767      0.0.0.0:*            ← 是 0.0.0.0，不是 127.0.0.1
$ curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8767/healthz
200
$ curl -s http://127.0.0.1:8767/healthz
{"status":"ok","version":"0.1.0"}
$ curl -s -o /dev/null -w '%{http_code}\n' http://192.168.0.228:8767/healthz      ← 走 LAN 地址
200
$ curl -s -o /dev/null -w '%{http_code} %{content_type}\n' http://127.0.0.1:8767/some/deep/path
200 text/html; charset=utf-8        ← 单端口：未知路径回落到前端入口（FR-12）
$ curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8767/api/prompts
404                                  ← 业务 API 尚未实现（属阶段 2，非本阶段失败项）
```

### AC-19 端口纪律与文档一致 — 判定：**过**

```
$ grep -rn '8767' package.json src bin deploy README.md | head
src/config.ts:92:    port: readPositiveInt(env, 'PORT', 8767, 65535),
deploy/README.md:28:| 监听 | `0.0.0.0:8767` | …
deploy/promptmanager.env.example:13:# 默认端口 8767（与 README.md / PROGRESS.md 三处一致，AC-19）
$ ss -ltn | grep -c ':8767'      # 服务在跑
1
$ ss -ltn | grep -c ':8767'      # 停服后
0
$ grep -n '8767' PROGRESS.md README.md
PROGRESS.md:83:…**8767 实测空闲**，且与 BRIEF D-4 的分配一致（8765=nextblog 验收备用、8766/8768/8770=其他项目主端口）
README.md:26:npm start              # 启动服务（默认 0.0.0.0:8767）
```

三处（配置默认值 / README / PROGRESS）一致；README 明确写 `0.0.0.0`。**并且改端口只需动这两处 + 台账，未散落魔法数。**

### AC-20 前端组件库落地 — 判定：**过**

```
$ npm ls antd @ant-design/icons --depth=0
├── @ant-design/icons@6.3.4
└── antd@6.6.4
$ npm ls @ant-design/v5-patch-for-react-19 --depth=0
└── (empty)                                            ← 正确地不需要 v5 补丁
$ grep -rnE "<(button|input|select|textarea|table|dialog)[ >/]" web/src --include='*.tsx' | wc -l
0
$ grep -rnoE "from ['\"]antd['\"]" web/src --include='*.tsx' | wc -l
5
$ grep -rnE "(cdn|unpkg|jsdelivr|googleapis)" dist/ web/src --include='*.html' --include='*.tsx' --include='*.css' | wc -l
0
```

四条全部满足。**用户 2026-09-18 的硬性要求（前端必须用组件库、不许自己造轮子）在阶段 1 就已落地并被机械证据锁住。**

### AC-18 部署文件（dsh 提前交付，本轮一并验收）— 判定：**过**

```
$ systemd-analyze verify deploy/promptmanager.service 2>&1 | grep -c error
0
$ grep -cE '^(User|Group|WorkingDirectory|EnvironmentFile|Restart)=' deploy/promptmanager.service
5
$ grep -c MemoryDenyWriteExecute deploy/promptmanager.service
0                                        ← Node 服务不得开（与 V8 JIT 冲突），已遵守
$ grep -cE '^[A-Z_]*(PASSWORD|SECRET|TOKEN|KEY)[A-Z_]*=.+$' deploy/promptmanager.env.example
0                                        ← 口令/密钥类值全部留空
```

### AC-17 凭据与产物卫生（阶段 7 正式验收，本阶段提前复测）— 判定：**过（提前项）**

```
$ git check-ignore -v data/pm.db .env _env/x
.gitignore:10:data/	data/pm.db
.gitignore:5:.env	.env
.gitignore:2:_env/	_env/x
$ git grep -nE "(password|passwd|secret|token)[[:space:]]*[:=][[:space:]]*['\"][^'\"]{8,}" -- 'src/**' 'bin/**' 'web/**' ':(exclude)tests/**'
（0 命中，grep_rc=1）
$ grep -cE '^\|.*\|' docs/dependencies.md      # 40
$ npm ls --depth=0 --parseable | tail -n +2 | wc -l   # 15（口径：直接依赖）
```

### AC-21 组件库真的在渲染（阶段 6 正式验收，本阶段预览）— 判定：**过（按修正后的严格口径）**

```
# 我独立复现（自起服务 + 自截图）
chrome=/root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell
DOM 大小 150836 字节 ｜ <style> 块 44 个 ｜ 真实 class 属性 98 处
宽松口径（我原 AC 写法，含 CSS-in-JS 样式转储）：distinct ant-* = 880
严格口径（只数元素 class 属性内）      ：distinct ant-* = 65
严格口径样例：ant-app / ant-badge / ant-badge-status / ant-btn / ant-btn-default / ant-btn-icon / ant-btn-loading …
```

**判定依据用严格口径**（65 ≥ 3）：界面确实是 antd 渲染出来的，不是手写 div 拼的。
截图我**自己看过**（亮色桌面 + 移动 390×844）：Header（深色 Layout.Header）+ Tag（阶段 1 骨架 / 亮色 / 单进程 / 单端口 / 单文件库）+
Card（服务自检 `GET /healthz` + 重新探测按钮）+ 状态图标 + Descriptions（status/version/监听 0.0.0.0:8767）+
交付清单卡片，字体与控件密度是 antd 的默认观感，无模板拼凑感；
移动端 Header 为 `style="padding-inline: 16px"`（我核对了 DOM），标题完整未裁切（略紧，属视觉细节，留阶段 6）。

## 2. 过程审查（解压它的 session.v3.jsonl.zstd，565 事件 / 120 次工具调用）

- **关键动作确实执行过**（在会话日志的 bash 调用里逐条找到，不是只在报告里声称）：
  `npm test` ×3（含最终提交后复跑）｜`tools/ac-stage1.sh` ×5｜`npm audit` ×2｜`api.osv.dev` 逐包查询 ×1（11 个直接依赖）｜
  `systemd-analyze verify` ×4｜`node tools/search-zh-poc.mjs` ×7｜`npm ci` ×1｜`ss -ltn` 端口实测 ×2｜`npm ls` ×3。
- **越界与特权动作**：全库扫描 `systemctl / sudo / /etc/ / /opt/ / chown / useradd / iptables / firewall-cmd / rm -rf /` ——
  命中 **2 处，均为 `sudo systemd-analyze verify <本项目 unit>`**（只读语法检查，STANDARDS 明确要求），**无其他特权动作**。
- **文件写入**：全部 35 个写/改目标**都在 `/root/greenhouse/projects/promptmanager` 内**，**项目外写入 = 0**；
  未改 `BRIEF.md`、未改 `STANDARDS.md`（`git log -- BRIEF.md` 只有我方 v1/v2/v3 三次提交）。
- **git 纪律**：`git add -A` **0 次**、`git commit -a` **0 次**（都用显式路径）；11 次提交，工作区干净。
- **自述与实际一致**：它 PROGRESS 里贴的 AC-1/2/18/19/20、红→绿、FTS 补测、依赖闸门数字，与我独立复现的一致；
  唯一"看起来对不上"的一处（AC-21 的 793）经查是**它在我写的命令内部（脚本里）执行的** `--dump-dom`，
  **不是伪造** —— 偏差来自**我的 AC 口径**（见 §4-①）。
- **S0 报告可复现**：我跑 `node tools/search-zh-poc.mjs`，输出与其 `docs/search-zh.md` §3 逐项一致；
  它如实报告了与我 BRIEF §6.8 的数字差异并给出正确归因（全角冒号构成分词边界），我已据此把 BRIEF 更正为 v3。

## 3. 结构与依赖抽查

- **无手搓基础设施**：HTTP 用 fastify、静态托管 `@fastify/static`、SQL 用 kysely、SQLite 用 better-sqlite3、
  UI 用 antd、构建用 vite/tsc、测试用 Node 内置 `node:test`（平台能力）。逐项都有选型理由记录在 `docs/dependencies.md` §4。
- **协议闸门**：161 个安装包协议分布 MIT 141 / ISC 6 / BlueOak 5 / BSD-3 4 / Apache-2.0 3 / **MPL-2.0 2**，
  **GPL/AGPL/无协议 = 0**；两处 MPL（`lightningcss*`）已按 STANDARDS §4.4 论证（未修改、未 vendoring）。
- **安全闸门**：`npm audit` = 0 vulnerabilities（我复跑同样为 0）；OSV 逐直接依赖 11/11 = 0 漏洞。
- **结构与命名**：`bin/ src/{config,db,server}/ migrations/ tests/ tools/ web/src/ docs/ deploy/`，小写+连字符，符合约定。

## 4. 缺口与风险（均不阻塞本轮放行）

1. **⚠️ 我方 AC 口径漏洞（已修，非实现方问题）**：AC-21 原文 `grep -o 'ant-[a-z-]*' | wc -l ≥ 3` 会被
   **CSS-in-JS 注入的 `<style>` 内容注水**（它的 793 / 我的 880 都含样式转储；严格口径只有 65）。
   → 已把「计数型断言必须写清数什么范围内的什么」固化进 BRIEF 模板 AC 自检第 ⑪ 条（合集仓 `a0f6da7`），
   并同步修正技能；**阶段 6 起 AC-21 按严格口径判**。
2. **本阶段范围内无功能缺口**；以下属后续阶段，已记录不作为缺陷：
   - `/api/*` 全部未实现（阶段 2+）、前端仅骨架 5 个 tsx（阶段 6）、测试 3 文件 / 11 用例（AC-16 要求 ≥8 文件，阶段 7）。
   - 前端 bundle 842 kB 未拆包（`vite` 已警告 >500 kB）→ 阶段 6 处理（dsh 已写入 README 已知限制）。
   - `LIKE '%…%'` 兜底是全表扫描（2000 行 0.2 ms 够用）→ 数据量到 10 万行量级需重新评估（已写入已知限制）。
   - 移动端 Header `padding-inline:16px` 偏紧（可读、未裁切）→ 阶段 6 视觉打磨。
3. **运维风险**：当前**无认证**接口（`/api/*` 尚不存在），阶段 2 交付认证前，**不得部署到不可信网络**
   （README 已知限制已写明；本项目默认不部署，符合约定）。

## 5. 下一步指令

**阶段 1 判定「过」，无需返工。** 放行阶段 2（认证与账号）：
`POST /api/login`、`POST /api/logout`、`GET /api/me`、`/api/*` 未认证一律 401、登录失败限流（窗口/阈值走 config）、
`bin/pm.mjs user set-password`（stdin 读口令、退出码 0/1/2）、`migrate` 幂等 —— 对应 **AC-3、AC-4、AC-15**。
下一阶段的提示词由 host_manger 出具（见交付汇报）。

## 6. 验收方操作留痕（可核）

- 全程只读生产：临时数据目录 `mktemp -d /tmp/hm-verify-*`、服务自起自停、跑完 **8767 监听数 = 0**、
  项目内**未残留** `data/`、`tmp/`、`git status` 为空；与实现方的会话**未被打断**（验收期间 dsh 处于待命）。
- 我改动的唯一项目内文件是本 `VERIFY.md` 与 `BRIEF.md`（v3 更正数字，提交信息已注明"仅改 BRIEF，未动代码"）。

---

# 阶段 2 验收（认证与账号）— 结论：**过**

| 项 | 值 |
| --- | --- |
| 验收人 | host_manger |
| 验收日期 | 2026-09-18 |
| 被验收 commit | `02ec6bf`（阶段 2 收尾；本阶段共 7 次提交 `03f6db2`→`02ec6bf`） |
| 应交付 AC | **AC-3（未认证拒绝）、AC-4（登录/会话/限流）、AC-15（重启持久）** |
| **结论** | **过（放行阶段 3，无返工项）** |

## 1. 逐条验收（我在自己的临时 DATA_DIR + 自起自停服务上独立复现）

### AC-3 未认证一律拒绝 — 过

```
GET /api/prompts    -> 401
POST /api/prompts   -> 401
GET /api/export     -> 401
PUT /api/prompts/1  -> 401
DELETE /api/prompts/1-> 401
伪造 cookie         -> 401        （Cookie: pm_sid=forged-sid-value）
/healthz（开放）    -> 200
```

读源码确认闸门只豁免 `/api/login`（`PUBLIC_API_PATHS`），`/healthz` 不在 `/api/` 下、天然开放 —— 与 BRIEF §6.1 一致。

### AC-4 登录 / 会话 / 限流 — 过

```
--- 正确口令
login=200
set-cookie: pm_sid=dzKaN3nuHklvs0eV9gecaEkrx7wh-emOVyT0VsaNTPk; Path=/; Expires=…; HttpOnly; SameSite=Lax
GET /api/prompts（带 cookie） -> 200
GET /api/me                  -> {"username":"admin"}
--- 错误口令 5 次 → 第 6 次 429
admin-fail#1..5 -> 401 401 401 401 401
第 6 次         -> 429  retry-after: 60   body: {"error":"rate_limited"}
锁定期间正确口令 -> 429        （契约要求：封锁期内含口令正确者一律 429）
--- 键隔离（我额外加的负向验证）
ghost 账号连打 6 次 -> 401×5 后 429；此刻 admin 正确口令仍 -> 200
```

**判定依据**：错误口令 5 次后第 6 次 429（不是第 5 次），与 AC-4 文字与 §6.1 契约一致；
`Retry-After: 60` 存在；键为 `username + 来源 IP`（ghost 被锁不影响 admin）—— 这正是"防定向爆破"的正确语义。

### AC-15 重启数据持久 — 过

```
POST /api/prompts -> 201
{"id":1,"title":"AC15 持久性夹具","user_prompt":"重启后我还在吗 {{变量A}}","system_prompt":"sys","notes":"notes",
 "folder_id":null,"tags":[],"favorite":false,"created_at":"2026-09-18T04:38:34.387Z","updated_at":"…","version_no":1}
→ 停服 → 同一 DATA_DIR 重启 →
  /healthz 200
  旧 cookie 仍有效：GET /api/me -> 200     （会话落库，重启不需重登）
  GET /api/prompts/1 -> 200
  重启前后逐字段比对： MATCH               （8 个字段逐项一致）
POST /api/logout -> 204 ；登出后同一 cookie 访问 /api/prompts -> 401
```

## 2. 我主动追加的核验（超出 AC，但属于阶段 2 范围）

- **CLI**：`user set-password` 从 stdin 读口令 → `rc=0`（未打印口令）；无参数 / 未知子命令 → `rc=2`（退出码语义正确）；
  `migrate` 连跑两次 → 均 `ok: schema at v1`、`rc=0`（**幂等**，阶段 2 范围项）。
- **口令存储**：库里为 `$argon2id$v=19$…`（长度 97），**不含明文**（我逐行比对夹具口令 → 0 命中）；
  `sessions` 与 `login_attempts` 均已落库。
- **凭据卫生**：我的夹具口令在服务日志中 0 命中、在项目文件中 0 残留。
- **依赖闸门（新增 3 个包，我复算）**：`@fastify/cookie@11.1.2`、`@fastify/rate-limit@11.2.0`、`@node-rs/argon2@2.2.1`
  —— **全 MIT、OSV 各 0 漏洞**；我复跑 `npm audit` = `found 0 vulnerabilities`；
  全量协议分布 MIT 408 / ISC 7 / BlueOak 6 / BSD-3 6 / Apache-2.0 3 / MPL-2.0 2 → **GPL/AGPL/SSPL/BUSL = 0**。
- **测试套件**：我独立跑 `npm test` → **36/36 通过（fail 0）**，**测试文件 8 个**（BRIEF AC-16 的 ≥8 文件下限**已提前达标**）。
- **未破坏既有项**：`ss -ltn` 端口纪律、`/healthz`、静态回落仍正常（dsh 在 PROGRESS §4 也做了同类复测）。

## 3. 实现决策复核（BRIEF 未逐条规定 → dsh 已记 `PROGRESS.md` §2.4 + `docs/dependencies.md` §4.5–4.7）

1. **失败限流自研 + 插件退居洪泛保护**（判断：**合理，采纳**）：`@fastify/rate-limit` 只能按**请求数**计数、无法"只计失败"，
   故 dsh 用 `login_attempts` 表自实现契约（按 username+IP、窗口 60s、满 5 次后 429 + `Retry-After`），
   插件以 `{ global: false }` 注册、只挂在 `/api/login`（30 次/60 秒 per-IP）防"拿 argon2 烧 CPU"。**实测行为与契约逐字相符**，且理由已落文档。
2. **`@node-rs/argon2` 而非 `argon2`/`bcrypt`**：决定性理由 = **不依赖 install 脚本**（阶段 1 实测 npm 11 会跳过 install 脚本，
   而 node-argon2/bcrypt 都依赖它）—— 这条经验被复用到选型上，属高质量判断。
3. **unused 的 `diff`/`marked`/`dompurify` 等包未提前装**（阶段 4/5 才需要）—— 克制，未过度引入。

## 4. 缺口与风险（不阻塞放行）

1. **`/api/prompts` 目前只有最小切片**（建 / 列表 / 单取）：属**阶段 3** 的 CRUD 与检索；
   dsh 已在 PROGRESS §5「自行判断的实现细节」里声明"检索与增删改属阶段 3"，**未据此宣称后续阶段完成**（符合 §11.5 ②）。
2. `POST /api/prompts` 的字段校验由 `InvalidBodyError` 覆盖（我复跑测试见到 `400 invalid_body + details`），
   完整字段契约在阶段 3 补全（tags/folder 校验、分页上限等）。
3. 前端仍未接认证（登录页属阶段 6）——当前"可登录"只在 API 层验证过。

## 5. 下一步指令

**放行阶段 3**（prompt/folder/tag CRUD + 中文检索 + 列表筛选分页）→ 验收 **AC-5、AC-6、AC-7、AC-14**。
提示词由 host_manger 出具。

## 6. 验收方操作留痕（含一次我自己的失误，如实记录）

- ⚠️ **我的第一版验收脚本有 bug**：调 CLI 时**漏了 `export DATA_DIR`** → `user set-password` 写进了项目默认 `data/`，
  而服务用的是临时目录 → 登录必然 401。**这是我的脚本错误，不是实现缺陷**（BRIEF §6.2 明确"CLI 与服务共用同一 DATA_DIR"）。
  我当场修正重跑，并把**我造成的项目内 `data/` 残留移入 `/tmp/agent-trash/promptmanager-data-hm-residue-*`（可恢复）**，
  同时核验我的夹具口令在项目内 0 残留。
- 其余留痕：8767 监听数 0、`git status` 干净、未打断 dsh 会话、未改任何 dsh 的代码或文档（只写本 VERIFY.md 与 BRIEF/README 之外的索引）。

---

# 阶段 3 验收（prompt/folder/tag CRUD + 中文检索 + 列表筛选分页）— 结论：**过**

| 项 | 值 |
| --- | --- |
| 验收人 | host_manger |
| 验收日期 | 2026-09-18 |
| 被验收 commit | `b7eaf43`（阶段 3 收尾；本阶段 4 次提交 `0829b04`→`b7eaf43`，改动面 20 文件 / +2235 行） |
| 应交付 AC | **AC-5、AC-6、AC-7、AC-14** |
| **结论** | **过（放行阶段 4，无返工项）** |

## 1. 夹具自检（吸取阶段 2 的教训：先确认账号落在服务的 DATA_DIR 里再往下跑）

```
CLI rc=0 ｜ 夹具自检：登录 -> 200 ｜ /api/me -> {"username":"admin"}
```

## 2. 逐条验收（我在自己的临时 DATA_DIR + 自起自停服务上独立复现）

### AC-5 prompt CRUD 与版本号 — 过

```
POST /api/prompts（全字段 + 1 标签）-> 201，version_no=1
{"id":1,"title":"AC5 夹具标题","user_prompt":"用户提示词正文","system_prompt":"系统提示词正文",
 "notes":"备注正文","folder_id":null,"tags":["标签甲"],"favorite":false,"created_at":"…","updated_at":"…","version_no":1}
GET /api/prompts/1 -> 200，字段逐项比对：MATCH
PUT {notes:"备注正文-已改"} -> 200，version_no=2，**其它字段与 tags 保持不变**（部分更新语义正确）
DELETE -> 204 ；再 GET -> 404
```

### AC-6 中文检索（长度归一化 + 特殊字符）— 过

```
q=会话交接（4 字符，走 FTS5 trigram）-> total=1，items=['AC6 甲']
q=交接    （2 字符，走 LIKE 兜底）   -> total=2      ← trigram 单走会 0 命中，兜底生效
q=上下文  （3 字符边界）            -> total=3      ← 与夹具语料一致
q=不存在的词                        -> total=0
特殊字符 q = " * - a-b C++ 100% ( _ \  -> 全部 HTTP 200（无 500、无 MATCH 语法错误）
```

**另加严格转义验证（两个串分置于不同记录，上一版夹具同置一行、判据不成立，我已重做）**：

```
库里同时有「前 axb 后」（转义A）与「前 a_b 后」（转义B）：
  q=a_b     -> total=1，items=['转义B']      ← 若 `_` 未转义会命中 axb（total=2）
库里同时有「比例 100%合格」（转义C）与「比例 100X合格」（转义D）：
  q=100%合格 -> total=1，items=['转义C']      ← `%` 已被当字面字符处理
```

### AC-6b FTS 索引随增删改同步（我额外加的"静默损坏"风险项）— 过

```
新建（苹果香蕉梨）-> q=苹果香蕉梨 = 1
PUT 改为（橙子柚子桃）-> 旧词 q=苹果香蕉梨 = 0 ；新词 q=橙子柚子桃 = 1
DELETE        -> q=橙子柚子桃 = 0
```

external-content 虚表 + 三个触发器在**三条路径**上都正确，未出现"旧内容仍命中/新内容搜不到"的静默损坏。

### AC-7 检索性能（2000 条规模基线）— 过

```
建 2000 条中文 prompt：7.4s（API 逐条 POST）
q=会话交接  -> total=2001，三次耗时 0.009s / 0.005s / 0.007s   （要求 < 0.5s）
q=交接（2 字 LIKE 兜底）-> total=2002，耗时 0.004s
```

### AC-14 文件夹与标签 — 过

```
建父子文件夹 -> GET /api/folders：[{id:1,name:'父目录',parent_id:null},{id:2,name:'子目录',parent_id:1}] ✓
prompt 归入 F2 + 打标签甲 -> ?folder_id=2 -> total=1, [10] ；?tag=标签甲 -> total=1, [10] ✓
标签改名合并：PUT 标签乙 -> {name:'标签甲'} -> 200 {id:1,name:'标签甲',count:1}，标签表内仅一条「标签甲」(count=1) ✓
删除非空文件夹 -> 409 {"error":"folder_not_empty"}（父目录有子项、F2 有 prompt，两种情形都 409）✓
PUT {"folder_id":null} 移出 -> folder_id=None，version_no 递增；随后该文件夹可删（204），?folder_id= 查询为 0 ✓
```

## 3. 我主动追加的核验（超出 AC）

- **标签重名语义**：`POST /api/tags {name:"重名测试"}` 第一次 `201 {id:1,name:'重名测试',count:0}`；
  第二次同名 `400 {"error":"invalid_body","details":[{"path":"name","message":"标签「重名测试」已存在"}]}`
  → 落在 BRIEF §6.1 允许的 400 内，且**报错信息是中文、可读**，标签表无重名行。判定：可接受。
- **分页与参数健壮性**：`limit=500` → **钳制到 200**（契约上限）✓；`limit=2&offset=0/2` → `[4,3]`/`[2,1]` 窗口正确 ✓；
  空 `q` → 按 `updated_at` 倒序 ✓；`offset=9999` → `total=4, items=0`（不报错、不越界）✓；
  非法 `limit`（`0` / `-1` / `abc`）→ 全部 `400` ✓（不静默回退成默认值）。
- **测试套件**：我独立跑 `npm test` → **60/60 通过（fail 0）**；本阶段新增 4 个测试文件
  （`api-folders-tags` 232 行、`api-prompts-crud` 271 行、`api-search` 150 行、`db-search` 189 行）——测试密度是阶段 1/2 的数倍。
- **未引入新依赖**：`git diff b46e7ed..b7eaf43 -- package.json` 为空 → 无新包、无需新的 CVE/协议审查；
  `npm audit` 在本阶段被 dsh 复跑 3 次（我此前已独立复跑为 0）。
- **未破坏既有项**：认证闸门、端口纪律、`/healthz`、静态回落均正常（我的验收脚本全程依赖它们）。

## 4. 过程审查（会话日志 seq>1183 段：58 次工具调用）

- 真实执行：`npm test` ×8、`tools/ac-stage3.sh` ×8、`npm audit` ×3、`ss -ltn` 端口实测 ×2、`git commit` ×5。
- **项目外写入 = 0**；`git add -A` = 0；特权/越界动作 = 0；写入文件 17 个全部在项目内。
- 无新依赖 → 未跑 OSV 属**合理省略**（我在阶段 2 已对全部直接依赖做过 OSV，本阶段没有新增）。

## 5. 缺口与风险（不阻塞放行）

1. **`PUT` 无"内容未变则跳过留档"优化**：同内容多次 PUT 会产生多个同内容版本（dsh 已在 PROGRESS §5.5 声明，依 §6.1 字面语义）。
   → 我判定**符合契约**，但建议阶段 4 做 diff 时顺便观察版本增长；若未来要加"内容哈希去重"，需改 BRIEF 而非默默实现。
2. `LIKE` 兜底仍是全表扫描（2000 行下接口 4 ms）→ 10 万行量级需重评（已在其 README 已知限制）。
3. 前端仍是骨架页（登录页/列表/编辑器属阶段 6）——当前所有 CRUD/检索能力只在 API 层验证过。

## 6. 下一步指令

**放行阶段 4**（版本历史接口 + 变量提取渲染 + Markdown 渲染与净化）→ 验收 **AC-8、AC-9、AC-12**。
提示词由 host_manger 出具。注意：`prompt_versions` 表与"每次变更留档"已在阶段 3 落地，阶段 4 只需补查询/diff/回滚接口与变量、Markdown 两块。

## 7. 验收方操作留痕

- 全程只读生产：临时 DATA_DIR、服务自起自停、跑完 8767 监听数 0、`git status` 干净、临时目录已清理；未打断 dsh 会话。
- **我自己的夹具失误（第二次，如实记录）**：首轮 AC-14 我用 `标签甲` 建标签，而该名字已被 AC-5 夹具建过 → 触发 400、
  我的脚本打印空 id。**这是我的夹具命名冲突，不是实现缺陷**；已改用新名补测（见 §3）并把"夹具命名要全局唯一"的自省
  一并记入技能 CHANGELOG。

---

# 阶段 4 验收（版本历史 + 变量渲染 + Markdown 渲染与净化）— 结论：**过**

| 项 | 值 |
| --- | --- |
| 验收人 | host_manger |
| 验收日期 | 2026-09-18 |
| 被验收 commit | `d23c447`（阶段 4 收尾；4 次提交 `581e2b0`→`d23c447`，17 文件 / **+1952 −27**） |
| 应交付 AC | **AC-8（变量）、AC-9（版本）、AC-12（Markdown + 净化 + 高亮）** |
| **结论** | **过（放行阶段 5）**；另提出 1 项**硬化要求**（非缺陷，已写入 BRIEF v4 §5） |

## 1. 逐条验收（我在自己的临时 DATA_DIR + 自起自停服务上独立复现）

### AC-8 变量提取与渲染 — 过

夹具（BRIEF 原文，仅 `user_prompt` 含变量）：
`你好 {{ 姓名 }}，重复 {{姓名}} 与 \{{保留}} 以及 {{var-b}}`

```
GET  /api/prompts/:id/variables -> {"variables":["姓名","var-b"]}      → 逐元素 MATCH（顺序=首次出现、去重、\{{保留}} 不算）
POST /api/prompts/:id/render {"values":{"姓名":"张三"}}
     -> user_prompt = "你好 张三，重复 张三 与 {{保留}} 以及 {{var-b}}"  → 逐字符 MATCH
     -> missing = ["var-b"]                                          → MATCH
渲染不写库：GET 复核 version_no 仍为 1、库内原文未变（含 `\{{保留}}`）  → PASS
```

**边界补测（我加的）**：`{{}}`/`{{  }}` 空名**不提取** ✓；`{{var_1}}`/`{{var-2}}`/`{{ 3name }}` 正常提取 ✓；
70 字符超长名**不提取**（契约 1–64）✓；无变量 prompt → `[]` 且渲染原样返回 ✓；多余 values 无副作用 ✓；
**`system_prompt` 里的变量也会被提取并列入 `missing`**（我首轮夹具在 system 侧写了 `{{环境}}` → 得到 3 个变量）——
这是实现的一致设计（render 同时返回两段文本），**不是缺陷**，已在此记录以免后人误判。

### AC-9 版本历史：列表 / diff / 回滚 — 过

```
建 v1 → PUT(v2) → PUT 改标题+正文(v3)
GET /versions -> [1,2,3]（升序、含首版，带 created_at 与 title）
GET /diff?from=1&to=3 -> unified diff：
   --- v1 / +++ v3 / @@ -1,7 +1,7 @@
   [title]  -AC9 版本夹具 / +AC9 版本夹具-改标题
   [user_prompt] -第一版正文 / +第三版正文     ← 含 - 行与 + 行，且按字段分节（可读性好）
POST /versions/1/rollback -> 200，version_no=4
   → 正文 = "第一版正文"（逐字符 MATCH v1）、备注 = "备注v1" MATCH、标题也回到 v1（快照整体回滚）
   → GET /versions = [1,2,3,4]（**历史一个不少**）
边界：from=1&to=99 -> 400 ；缺 to -> 400 ；回滚 n=99 -> 404 ；不存在的 prompt 取 versions -> 404
    from=2&to=2 -> 200（同版本 diff，空差异）；from=3&to=1 -> 200（反向差异）
```

**判定**：`from=to` 返回空 diff、`from>to` 返回反向 diff **属合理实现**（契约只把"缺参/越界"定为 400），
已在同处记录，避免后续把它当缺陷。

### AC-12 Markdown 渲染 + XSS 净化 + 高亮 — 过

```
输入：## 标题 + <script>alert(1)</script> + [链接](javascript:alert(1)) + ```js 代码块
输出：<h2>标题</h2><p><a>链接</a></p><pre><code class="hljs language-js"><span class="hljs-keyword">const</span> a = <span class="hljs-number">1</span>;</code></pre>
判定：不含 <script ✓  不含 javascript: ✓  含 <pre>/<code> ✓  含 hljs 高亮 ✓
```

**实现管线（我读代码确认顺序正确）**：`marked(GFM) → 自定义 code 渲染器走 highlight.js → DOMPurify 净化`，
即**净化在渲染之后**（顺序错误会导致 hljs 输出被当作可疑 HTML 剥掉，或高亮引入未净化片段）。
另见到一处**真实的性能陷阱被主动规避**：`highlightAuto` 在 200k 字符上约 3 秒 → 实现设 `MAX_AUTO_DETECT_LENGTH = 20_000`，
超出即不自动识别语言。**我实测验证**：29KB 未指定语言代码块 → **0.020s**；128KB 混合 → 0.168s；342KB 纯文本 → 0.065s。

### AC-12b XSS 绕过集（我额外加的 12 类 payload，逐条单独发送 + 属性级判据）— 过（无脚本执行向量）

判定方法（吸取上一版的教训）：**逐条 payload 单独发**，只用**属性级正则**判定
（`<tag … on*=…>`、`href/src/action` 指向 `javascript:` 或 `data:text/html`、`<script>/<iframe>`），
**不再用裸 substring**——上一版我把判据关键字写进了夹具标签（如 `img_onerror:`），导致**假阳性**。

```
case1  <img src=x onerror=alert(1)>        -> <img src="x">                        ✅ 事件属性被消除
case2  <svg/onload=alert(1)>               -> 转义为文本 &lt;svg/onload=…&gt;        ✅
case3  <a href="javascript:alert(1)">      -> <a>L</a>                             ✅
case4  <iframe src=…>                      -> 空                                     ✅
case5  <style>x{background:url("javascript:…")}</style>（块级）-> 空                  ✅
case6  <form action="javascript:…">        -> <form><input name="a"></form>         ⚠️ action 被消除，但 form/input 标签存活
case7  <a href="javascript&#58;alert(1)">  -> <a>E</a>                             ✅ 实体编码绕过无效
case8  <math><mtext><script>…              -> <p><math><mtext></mtext></math></p>  ⚠️ script 被消除，math/mtext 存活
case9  <input autofocus onfocus=alert(1)>  -> <input>                              ✅ 事件属性被消除（input 标签本身存活）
case10 [d](java\nscript:alert(1))          -> 文本原样，未生成链接                     ✅
case11 <a href="data:text/html;base64,…>   -> <a>D</a>                             ✅
case12 <IMG SRC=x ONERROR=alert(1)>        -> <img src="x">                        ✅ 大小写变体同样被消除
```

**结论：12 类 payload 中，没有任何一类能造成脚本执行**（无 `on*` 属性、无 `javascript:`/`data:text/html` URI、无 `<script>`/`<iframe>`）。
残留的 `<form>/<input>/<math>/<mtext>` 与 `style` 属性属**非脚本类**内容 ⇒ **AC-12 判过**。

## 2. 硬化要求（新增，非缺陷；已写入 BRIEF v4 §5，阶段 6 前完成）

我另测了 `style`：**DOMPurify 默认允许 `style` 属性与 `<style>` 标签**，实测原样存活：

```
<div style="position:fixed;inset:0;background:#fff">Fake UI</div>  -> 原样输出（可整页覆盖做 UI 伪装）
<p style="display:none">hidden</p>                                 -> 原样输出
前文 <style>x{color:red}</style> 后文                                -> 原样输出
```

**风险评估**：不是 XSS（不能执行脚本），但是**UI 伪装 / CSS 注入面**。单用户自用场景下攻击面有限，
但**阶段 5 引入导入、阶段 6 把 HTML 注入 DOM** 后，导入他人 prompt 集合即可覆盖应用界面（诱导性很强）。
→ 已写入 BRIEF v4：`FORBID_ATTR: ['style']` + `FORBID_TAGS: ['style','form','input','button','math','mtext','link','meta','base']`（或等价白名单），
并要求"输出 HTML 不得含 `style=` 与上述标签"成为断言。**阶段 6 前端渲染前完成即可**。

## 3. 其他核验

- **测试**：我独立跑 `npm test` → **80/80 通过**；本阶段新增 4 个测试文件（`api-versions` 147、`api-variables-markdown` 159、`markdown` 64、`variables` 55 行）。
- **新依赖闸门（我复算）**：`marked@18.0.13` MIT、`dompurify@3.4.15` **(MPL-2.0 OR Apache-2.0，按 Apache-2.0 用——合规)**、
  `jsdom@30.1.0` MIT、`highlight.js@11.12.0` BSD-3、`diff@9.0.0` BSD-3；**OSV 逐个 0 漏洞**；`npm audit` = 0。
- **无手搓**：diff / markdown 渲染 / HTML 净化 / 高亮全部用成熟库（符合"不重复造轮子"）。
- **本阶段未动 `BRIEF.md`/`STANDARDS.md`**：`git log 305bf38..d23c447 -- BRIEF.md STANDARDS.md` = **0 次**。
- **jsdom 代价（我实测）**：冷启动到 `/healthz` 200 = **1.28 s**；服务进程 **RSS 207 MB**。
  启动时间可接受；RSS 偏高（jsdom 常驻）→ 记入观察项，阶段 6/7 可考虑把净化栈改为惰性初始化（首次渲染时再加载）。

## 4. 过程审查（会话日志 seq>1467 段：46 次工具调用）

- 真实执行：`npm test` ×8、`tools/ac-stage4.sh` ×10、`npm audit` ×3、**装前 OSV 闸门** ×2、`npm install` ×1、`ss -ltn` ×4、`git commit` ×5。
- **项目外写入 = 0**；`git add -A` = 0；特权/越界动作 = 0；写入文件 10 个全部在项目内。
- 未使用 headless chromium（本阶段无界面交付，合理）。

## 5. 缺口与风险（不阻塞放行）

1. **净化硬化**（见 §2，BRIEF v4 已要求，阶段 6 前完成）。
2. `jsdom` 常驻导致 RSS 207 MB（记入观察项，可选优化）。
3. `PUT` 无"内容未变则跳过留档"，同内容多次保存会产生同内容版本（契约如此，阶段 4 后 diff 可能出现同内容对比）。
4. 前端仍为骨架页（变量填值面板、Markdown 预览的**界面**属阶段 6，当前只在 API 层验证）。
5. `LIKE` 兜底全表扫描（10 万行量级需重评，已在其 README 已知限制）。

## 6. 下一步指令

**放行阶段 5**（导入导出：`/api/export`、`/api/import` 两种模式、CLI `export`）→ 验收 **AC-10、AC-11**。
提示词由 host_manger 出具；**阶段 6 的提示词里会带上 §2 的净化硬化要求**。

## 7. 验收方操作留痕

- 全程只读生产：临时 DATA_DIR、服务自起自停、跑完 8767 监听数 0、`git status` 干净、临时目录已清理；未打断 dsh 会话（验收期间它处于待命）。
- **我自己的失误（第三次，如实记录）**：首版 XSS 检查把判据关键字写进了夹具标签（`img_onerror:` / `a_javascript:`），
  于是"残留检测"命中的是**我自己的标签文本** → 12 条里报了 3 条假阳性。改用"逐条 payload + 属性级正则"后判定清晰。
  **教训已固化**（BRIEF 模板 AC 自检 ⑬：安全断言必须逐条发送 + 属性级判据 + 判据关键字不得出现在夹具文本里）。

---

# 阶段 5 验收（导入导出）— 结论：**过**

| 项 | 值 |
| --- | --- |
| 验收人 | host_manger |
| 验收日期 | 2026-09-18 |
| 被验收 commit | `181aa60`（阶段 5 收尾；本阶段提交 `fc25484`→`181aa60`，代码 HEAD 之上的 `cde2ef6`/`3685ae7` 是我方的 BRIEF v5/v6） |
| 应交付 AC | **AC-10（导出→导入→再导出一致）、AC-11（非法导入不动数据）** |
| **结论** | **过（放行阶段 6）**；另附 2 条**硬化建议**（非缺陷） |

## 1. 逐条验收（我在自己的临时 DATA_DIR + 自起自停服务上独立复现）

### AC-10 导出 → 导入(replace) → 再导出：一致性 — 过

夹具特意做成**最容易触发缺陷的形状**：父子文件夹（`父目录A`/`子目录B`）+ 标签 + 一条有 **2 个版本** 的 prompt。

```
export#1 -> 200：结构键 = [app, exported_at, folders, prompts, schema_version, tags]；prompts/folders/tags = 1/2/1，首条内嵌 versions=2
导出后再新增一条「新增内容夹具XYZ」（用于证明 replace 真的清空重建）
import(replace) -> 200 {"mode":"replace","imported":{"folders":2,"tags":1,"prompts":1}}   ← 与文件内容一致
export#2 -> 200
除 exported_at 外深度比对：**EQUAL ✅**
replace 后 id 是否保留：**True**（契约要求保留文件里的 id）
FTS 同步：q=旧内容夹具ABC -> 1    ｜ q=新增内容夹具XYZ -> **0**（证明清空重建生效）｜ q=会话交接 -> 1
```

### AC-11 非法导入：必须 400 且数据零变化 — 过（13/13）

**方法（严格版）**：先导出规范种子作为"重置文件"，**每个用例前先 replace 重置**、**用例内部前后各取一次数据指纹**
（数量 + 首条 prompt 的 id/标题/版本号列表/正文），避免"某个合法用例改变数据后污染后续所有断言"。

```
app_missing / wrong_app / schema_missing / schema_too_new / bad_mode / no_data / data_not_object /
prompt_no_vers / versions_not_arr / folder_dangling / folder_cycle / dup_prompt_id / dup_version_no
  → 全部 HTTP 400 且指纹 = 规范指纹 ✅   （非法用例失败数：0）
```

其中 **`dup_prompt_id`（主键冲突）与 `dup_version_no`（唯一约束冲突）是"通过应用层校验、靠 DB 约束才失败"的用例**
→ 它们返回 400（`数据约束冲突：UNIQUE constraint failed`）且**指纹不变** = **单事务回滚确实生效**。

额外断言：
```
非法请求体（not-json / {} / [] / {"mode":"replace","data":null}）→ 全 400
未认证 POST /api/import → 401
失败导入后的索引一致性：q=种子提示词 -> 1（原有内容仍在）；q=dup -> 0（失败文件内容未被索引，无半截残留）
```

## 2. 我主动追加的核验

- **merge 语义**：向非空库 merge 同一文件 → `folders` 仍为 2（`父目录A`/`子目录B` 同名复用、未重复创建）、`tags` 仍为 1、`prompts` 由 0→1（重新分配 id），既有数据保留 ✅
- **较大导入**：300 条 prompts（含各 2 版本）→ **160.3 KB / 0.060 s / 200**；导入后 `q=批量会话交接` = **300**；`/api/prompts/1000/versions` = `[1,2]`（版本随文入库）；旧数据已被清掉 ✅
- **CLI 导出与 API 导出一致**：`node bin/pm.mjs export --out …` vs `GET /api/export` → 除 `exported_at` **EQUAL ✅**
- **Markdown 净化硬化（BRIEF v4 §5，它在阶段 5 顺手落地）**——我按 v4 的断言逐条实测：
```
<div style="position:fixed;inset:0;background:#fff">Fake UI</div> -> <div>Fake UI</div>   （style 属性被剥）✅
<style>body{display:none}</style>            -> （空）✅
<form action="javascript:…"><input name=a>   -> （空）✅
<math><mtext>x</mtext></math>                -> <p></p>✅
<script>alert(1)</script>                    -> （空）✅
```
  实现与规格逐字一致：`FORBID_ATTR: ['style']` + `FORBID_TAGS: ['style','form','input','button','math','mtext','link','meta','base']`（读 `src/services/markdown.ts` 确认）。
- **测试**：我独立跑 `npm test` → **96/96 通过**（测试文件 19 个）。
- **依赖**：本阶段**无新增依赖**（`docs/dependencies.md` 仅 +3/−1 行说明）。

## 3. 过程审查（会话日志 seq>1691 段：35 次工具调用）

- 真实执行：`npm test` ×11、`tools/ac-stage5.sh` ×7、`npm audit` ×3、`ss -ltn` ×5、sqlite 探针 ×2、`git commit` ×3。
- **项目外写入 = 0**；`git add -A` = 0；特权/越界动作 = 0；写入文件 7 个全部在项目内。
- **`BRIEF.md` 在本阶段的改动只有我方的 v5/v6 两次**（`git log fc25484..3685ae7 -- BRIEF.md` = 2，均为我提交）——dsh 未改规格文件。

## 4. 质量信号（这一轮特别值得记）

1. **它自己抓出了一个真实缺陷，而且是我方 AC 抓不到的那类**：`replace` 清空时写的是 `DELETE FROM folders`，
   而 `folders.parent_id` 是**自引用外键 + ON DELETE RESTRICT**，SQLite 按 rowid 顺序删（先父后子）→
   `FOREIGN KEY constraint failed`。**只有"库里已存在父子文件夹"时才触发**——它早期单测夹具恰好都是空文件夹树，
   **95 个用例全绿却漏了它**，是它的 AC 脚本夹具（父子文件夹 + prompt）一跑就暴露。修法是"反复删叶子"，
   并补了回归用例。**这条正好验证了我把 AC 写成"真实形状夹具"的价值。**
2. **它主动披露了自己的错误**：复盘里写明"红线测试期望错 2 处（是实现没错）"，以及"AC-11 里有一个'非法用例'其实是**合法**的空文件，
   被 FK bug 掩盖，修好后走到 200 才暴露，已从非法清单移除"。—— 与我独立复现的结论一致（我第一版也踩了同一个用例）。
3. **顺手交付了 v4 的净化硬化**（本属阶段 6 前置），理由写清："与导入进来的非自写内容直接相关"，并声明"阶段 6 正式验收仍以 v4 §5 断言为准"。

## 5. 硬化建议（非缺陷，不入本轮判据）

1. **导入校验可再严一格**：缺 `title` 或 `user_prompt` 的 prompt 目前被接受（实测 HTTP 200，落库为空串）。
   契约未要求拒绝，但**列表里会出现无名条目**，建议在阶段 9 收尾时补一条校验（拒绝或给默认标题）。
2. **`replace` + 合法空文件会清空整库**（实测 200、`imported` 全 0、指纹变全零）：这是 `replace` 语义的**忠实实现**，
   但对用户是"一条命令清库"。建议在阶段 8 前端加**二次确认**（或要求文件 `prompts` 非空），**不改后端契约**。

## 6. 下一步指令

**放行阶段 6**（对外可用面：API Token + CORS + 使用侧 CLI + 使用记录 + 内外网部署形态）→ 验收 **AC-22、AC-23、AC-24、AC-27、AC-28**。
注意：阶段 6 是**按 BRIEF v6** 执行（新增 FR-19 使用记录为 P0；`TRUST_PROXY` 默认关闭；`PUBLIC_ORIGIN` 控制 cookie `Secure`；交付反代样例与双形态部署文档）。

## 7. 验收方操作留痕

- 全程只读生产：临时 DATA_DIR、服务自起自停、跑完 8767 监听数 0、`git status` 干净、临时目录已清理；未打断 dsh 会话。
- **我自己的失误（第四次，同类）**：AC-11 第一版**跨用例共用一个基线**，而其中 `{"…prompts":[]}` 加未知字段那例其实是**合法空文件**
  （200 + replace 清库），它一成功就把后续所有用例判成"数据变了"；第二版也因"缺 title"那例（合法，200）再次污染。
  **改为"每个用例前重置 + 用例内前后各取指纹"后 13/13 干净通过**。教训已固化进 BRIEF 模板 AC 自检 ⑫。

---

# 阶段 6 验收（对外可用面：Token / CORS / 使用侧 CLI / 使用记录 / 内外网部署形态）— 结论：**过**

| 项 | 值 |
| --- | --- |
| 验收人 | host_manger |
| 验收日期 | 2026-09-18 |
| 被验收 commit | `de3c93f`（阶段 6 收尾；本阶段 6 次提交 `6764efe`→`de3c93f`，三单元 6A/6B/6C） |
| 应交付 AC | **AC-22、AC-23、AC-24、AC-27、AC-28** |
| **结论** | **过（放行阶段 7）**；并**据其反馈修正了一处规格缺陷**（见 §5，BRIEF → v7） |

## 1. 逐条验收（我在自己的临时 DATA_DIR + 自起自停服务上独立复现）

### AC-22 API Token — 过

```
① token create（未设 PM_API_URL ⇒ 本机引导路径）：stdout 行数=1（形如 pm_…）；stderr=(bootstrap: local admin path —— 未设置 PM_API_URL，按本机管理命令处理)
② 库中 only-hash：id=1 name=ac  len(token_hash)=64  是 64 位 hex=True  含明文=False；**整个 DB 文件里也搜不到明文**
③ Bearer 正确 200 ｜ Bearer 错误 401 ｜ 无凭据 401 ｜ 伪造 cookie 401 ｜ Bearer 可写(POST) 201 ｜ token 调 /api/logout 401 ｜ cookie 通道 200
⑤ HTTP 列 token 的字段 = [created_at, id, last_used_at, name, revoked_at]（**无明文**，列表里明文出现 0 次）
⑥ CLI list 显示 last_used 与 status；revoke 后同一 token 立即 401，而 **cookie 通道仍 200**（两通道互不影响）
⑧ 明文在服务日志出现 0 次 ｜ ⑨ 缺 --name → rc=2、未知子命令 → rc=2
```

### AC-23 CORS — 过

```
未配置 CORS_ORIGINS：/healthz 与 /api/prompts 的 ACAO 头数均为 0（默认关闭 = 完全没有 CORS 头）
配置白名单后：access-control-allow-origin: https://prompt.home.local（**精确回显**）
   白名单第 2 条（http://localhost:5173）ACAO=1 ｜ 白名单外 0 ｜ Origin: null 0
   **ACAO 为通配符 `*` 的次数 = 0** ｜ **Access-Control-Allow-Credentials 头 = 0**
预检 OPTIONS：HTTP 204 + allow-origin(精确) + allow-methods: GET, POST, PUT, DELETE, OPTIONS
             + allow-headers: Authorization, Content-Type
负向：CORS_ORIGINS="*" → 进程启动失败 rc=1，报「配置错误：CORS_ORIGINS 不允许通配符 "*"」（**不静默忽略**）
```

### AC-24 使用侧 CLI — 过

```
pm get '会话交接' --json → rc=0、JSON 数组 1 条（字段齐全）
pm get --id 2 --json → rc=0 ｜ pm get --id 99999 → rc=1 ｜ pm get（无参数）→ rc=2
pm render --id 2 --set 姓名=张三 → rc=0，stdout = "CLI 正文 会话交接 张三"
   **与 /api/render 的 user_prompt 逐字符 MATCH**
连不上：rc=1、**stdout 字节=0**、stderr="无法连接 …（fetch failed）—— 本命令只走 HTTP API，不会回退直连数据库"
只给 PM_API_URL 不给 token：rc=2、stdout=0
```

### AC-27 使用记录（FR-19）— 过

```
token 通道：2×详情 + 1×render（+我在副作用断言里又读了一次详情）= by_channel.token 计数与 top[0].count 完全对得上
summary 实测：{"days":7,"total":8,"by_channel":{"session":1,"token":7,"mcp":0},
              "top":[{"prompt_id":3,"title":"用法夹具U1","count":4,...},{"prompt_id":2,"count":3,...},{"prompt_id":4,"count":1,...}]}
cookie 会话打开详情 → session=1 ｜ mcp=0（通道取值已在代码里：UsageChannel = 'session'|'token'|'mcp'，阶段 7 验收）
**副作用断言**：取用前后 version_no 与 updated_at **完全相同**（未产生版本、未改"最近更新"）
**列表/搜索不记账**：三次列表/搜索请求前后 total 8 → 9（那 1 次增量是我自己的详情读取），列表与搜索各 0 增量
?sort=recent_used：刚用过的在最前，**从未使用过的（use_count=0、last_used_at=null）排在最后**
**导出往返仍 EQUAL**，且导出里 prompt 的字段集与 §6.4 完全一致 —— **不含 use_count/last_used_at**（usage 不参与导入导出）
```

### AC-28 部署形态（内网直连 + 公网反代）— 过

```
① 未设 TRUST_PROXY：6 次错误登录各带不同 X-Forwarded-For → 401 401 401 401 401 **429**
   （伪造 XFF 无法绕过登录限流；键仍是真实来源 IP）
② TRUST_PROXY=1：带 X-Forwarded-For: 203.0.113.9 的请求 → 服务日志中出现该值（采信 XFF）
③ 未设 PUBLIC_ORIGIN：Set-Cookie **不含 Secure**（内网 HTTP 可登录）｜设 PUBLIC_ORIGIN 后：**含 Secure**（公网 HTTPS 形态）
④ deploy/reverse-proxy.example.conf：X-Forwarded-For 转发 2 处；真实域名/证书路径残留 **0**
   deploy/README.md 覆盖「内网|公网|反代|回滚」共 24 行命中（含新增 §2.7 两种部署形态）
⑤ 端口纪律：全程只有本项目 8767 + izone 8769；跑完 8767 监听数 0；`git status` 干净
```

## 2. 其他核验

- **测试**：我独立跑 `npm test` → **123/123 通过**（25 个测试文件；本阶段新增 5 个：api-tokens / api-cors / api-deploy-shape / api-usage / cli-get-render / cli-token）。
- **新增依赖**：只有 `@fastify/cors@11.3.0`（MIT）；dsh 在**装前**跑了 OSV（0 漏洞），我复跑 `npm audit` = 0。
- **BRIEF/STANDARDS 未被改动**：`git log 3685ae7..HEAD -- BRIEF.md STANDARDS.md` = **0 次**；`VERIFY.md` 也只有我的提交。
- **red→green 记录**：三单元各自先红后绿（A 7/8 失败 → 8/8；B 6/8 → 8/8；C 9/11 → 11/11），并**主动披露了三处"期望/夹具写错（实现没错）"**，含一处"用 `includes('usage')` 命中夹具标题里的英文单词"的自伤 → 改为**结构断言**（字段集必须与 §6.4 一致），比关键词 grep 更硬。

## 3. 过程审查（会话日志 seq>1895 段：54 次工具调用）

- 真实执行：`npm test` ×12、`tools/ac-stage6.sh` ×8、`npm audit` ×3、**装前 OSV** ×2、`ss -ltn` ×5、`git commit` ×6、sqlite 探针 ×3。
- **项目外写入 = 0**（14 个文件全部在项目内）；**`git add -A` = 0**。
- 风险扫描命中 1 条（seq=2068）：核查后是**在项目内编辑 `deploy/README.md` 增补"两种部署形态"小节**（命中的是文档正文里的字面路径），**不是特权动作**。

## 4. 回复对账（本机制 2026-09-18 新增后的**首次实跑**）

把 dsh 给用户的收尾回复（seq=2158）逐条对到落盘文件：

| 回复里的结论 | 落盘 |
| --- | --- |
| commit `6764efe` / `a9af4bf` / `358dd98` / `d5dcb06` / `798c0d6` | `PROGRESS.md` 各 1 次 ✅ |
| commit `de3c93f`（**收尾提交自身**） | 0 次 —— **结构性例外**（不可能写进自身那次提交），由本报告第 1 节记录 ✅ |
| `token_hash`=64 / `by_channel` / `Access-Control-Allow-Origin` / `bootstrap` / `TRUST_PROXY` / `PUBLIC_ORIGIN` / `反代` / `EQUAL` | `PROGRESS.md` 命中 1–15 次 ✅ |
| "未改 `BRIEF.md`/`STANDARDS.md`、工作区干净" | 独立核实：0 次改动、`git status` 0 行 ✅ |

**结论：该回复没有"只存在于会话、未落盘"的信息。**

## 5. 规格缺陷修正（本轮唯一需要改规格的地方）

dsh 在开工前把一个**我写的矛盾**写成决策请我复核：FR-16 要求「`pm token *` 一律走 HTTP API」，
而 AC-22 ① 的夹具只设 `DATA_DIR`（无任何 HTTP 凭据）→ **没有第一个 token 就无法用 HTTP 创建 token**。
它实现为：`pm get`/`pm render` 纯 HTTP（连不上直接报错、绝不回退 DB）；`pm token *` 双通道，且**把所用通道打印到 stderr**（不静默）。

**我的判定：采纳其设计，并修正规格**（这正是"规格缺陷 → 改规格而不是改实现"的正确路由）：
BRIEF → **v7**，§4 FR-16、§5 CLI 段与 AC-22 ① 措辞全部按双通道口径改齐，并在 §12 记明来源。

## 6. 缺口与风险（不阻塞放行）

1. `mcp` 通道计数为 0（阶段 7 才交付 MCP），通道取值已在代码类型里；**阶段 7 验收时必须实测 `mcp` 通道计数**。
2. usage 表会随时间增长（`days` 只影响汇总窗口）→ 暂无清理策略，属可接受的运维事项，记在此备查。
3. 前端仍为骨架页（阶段 8）；`?sort=recent_used` 目前只有 API，UI 用法在阶段 8。

## 7. 下一步指令

**放行阶段 7**（MCP server，stdio，只读工具面）→ 验收 **AC-25、AC-26**。
⚠️ 阶段 7 的 AC 明确要求**真实对端**端到端（`initialize` → `tools/list` → `tools/call`），且**开工前先对齐对端协议版本**。

## 8. 验收方操作留痕（含我连续第 5、6、7 次脚本失误，如实记录）

本轮我在写验收脚本时连踩三个**纯我方**的坑，合计多花两轮排查，全部记在这里以免后人重犯：

1. **忘了设管理员口令** → cookie 那组断言全变成 401（我一度以为实现有问题）→ 修：夹具自检（migrate + set-password + 登录 200）必须是脚本第一段。
2. **`DATA_DIR=... PORT=... "$@" npm start` 里展开出来的 `CORS_ORIGINS=...` 不会被 shell 当作赋值**
   （报 `No such file or directory`）→ 服务根本没起来，而后续 `grep -c` 的 0 命中看起来像"功能没生效"（**又一类假绿**）。
   修：改用 `env DATA_DIR=... PORT=... "$@" npm start`。
3. **我把 `restart` 的诊断输出重定向掉了**（`restart >/dev/null`）→ 起不来时只看到一串 0，排查全靠猜。修：**起服务的失败诊断永不重定向**。

其它留痕：全程临时 DATA_DIR、自起自停、跑完 8767 监听数 0、`git status` 干净、临时目录已清理；未打断 dsh 会话；只改 `VERIFY.md` 与 `BRIEF.md`（后者提交信息注明"仅改 BRIEF，未动代码"）。

---

# 阶段 7 验收（MCP server，stdio 只读工具面）— 结论：**过**

| 项 | 值 |
| --- | --- |
| 验收人 | host_manger |
| 验收日期 | 2026-09-18 |
| 被验收 commit | `50d33c5`（阶段 7 收尾；本阶段 4 次提交 `04d7ec4`→`50d33c5`） |
| 应交付 AC | **AC-25（真实对端端到端）、AC-26（形态与安全）** |
| **结论** | **过（放行阶段 8）**；附 1 项遗留小项（入口文件权限）+ 1 条已升格为规格的 UI 护栏（FR-11b） |

## 1. AC-25 真实对端端到端 — 过（**用我自己的客户端，不是它的自测**）

对端：**Python `mcp` 1.30.0**，`LATEST_PROTOCOL_VERSION = 2025-11-25`（我容器内）。
执行方式：我在自己容器里用该客户端 **经 ssh 拉起 228 上的 stdio 服务**
（`ssh … sudo env PM_API_URL=http://127.0.0.1:8767 PM_API_TOKEN=… /usr/bin/node /root/greenhouse/projects/promptmanager/bin/pm-mcp.mjs`）。

```
① initialize OK ｜ 服务端 = promptmanager 0.1.0 ｜ **协商协议 = 2025-11-25 ｜ 与我方 LATEST 一致 = True**
② tools/list = ['prompt_search', 'prompt_get', 'prompt_render']   ← 恰好三个、无写工具
   prompt_search  required=['query']        props=['query','limit']
   prompt_get     required=['id']           props=['id']
   prompt_render  required=['id']           props=['id','values']
③ 三次工具调用全部 isError=False：
   prompt_search({"query":"会话交接"}) → {"total":1,"items":[{"id":1,"title":"MCP夹具搜索","tags":["MCP标签"],"use_count":0,…}]}
                                        （只回 id/标题/标签/时间/取用统计，**不回正文** —— 与工具描述一致）
   prompt_get({"id":1})             → 完整对象（user_prompt/system_prompt/notes/tags/version_no/use_count…）
   prompt_render({"id":2})          → {"user_prompt":"你好 {{姓名}}，这是渲染夹具","system_prompt":"","missing":[]}
                                        （未提供值的变量原样保留、missing 正确）
```

## 2. AC-26 形态与安全 — 过

```
① 不新增监听端口：**在一个活跃 MCP 会话打开期间**对比监听表 → 新增 = 无 ✅（8765–8770 段只有本项目 8767 + izone 8769）
② 工具面只读：tools/list 中不存在任何写操作工具（create/update/delete/import）✅
③ 未设置 PM_API_TOKEN 时调用 → isError=True，
   输出="缺少 PM_API_TOKEN：MCP 一律经本服务的 HTTP API 取数（不直连数据库）。请设置 PM_API_URL… 与 PM_API_TOKEN 后重试；
        token 用 `node bin/pm.mjs token create --name mcp` 创建（明文只显示一次）。" ✅
   （**可执行、可照做的报错**，不是空数组也不是含糊消息）
④ 端口纪律：全程只有 8767 + 8769 ✅
⑤ 停掉服务后调用 → isError=True，
   输出="无法连接 http://127.0.0.1:8767（fetch failed）—— MCP 只经本服务的 HTTP API 取数，不直连数据库；请确认服务已启动、PM_API_URL 正确。" ✅
   **这一条同时证明了"经 API 而非直连 DB"**（我先把服务 kill 掉、确认 8767 监听数=0，再发起工具调用）
```

## 3. AC-27 续：`mcp` 通道确实记账 — 过

```
调用前： {"days":30,"total":3,"by_channel":{"session":0,"token":0,"mcp":3}}
连调 prompt_search + prompt_get + prompt_render 后：
        {"days":30,"total":5,"by_channel":{"session":0,"token":0,"mcp":5}}
⇒ ① **mcp 通道被正确识别**（经 HTTP 也能区分来源）；
  ② 增量 = +2：`prompt_get` 与 `prompt_render` 各记 1 次，而 **`prompt_search` 不记账** —— 与 FR-19"只记取用、列表/搜索不记"完全一致 ✅
```

## 4. 其他核验

- **测试**：我独立跑 `npm test` → **130/130 通过**（27 个测试文件；本阶段新增 `mcp-server.test.ts`、`mcp-readonly.test.ts`）。
- **新增依赖**：`@modelcontextprotocol/sdk@1.30.0`（官方 SDK，MIT）+ `zod@4.6.5`；装前 OSV 均 0，我复跑 `npm audit` = 0；**未手写 JSON-RPC**。
- **注册样例安全**：`deploy/mcp-register.example.json` 全为占位符（`<NODE_BIN>`/`<PROJECT_DIR>`/`<PM_API_URL>`/`<PM_API_TOKEN>`），
  实测不含任何形如 `pm_…` 的真实 token ✅。
- **文档**：README 提 `pm-mcp` 3 处、`deploy/README` 提 MCP 9 处、`docs/dependencies.md` 登记 SDK 4 处。
- **BRIEF/STANDARDS 未被改动**（0 次）；工作区干净。
- **过程审查（seq>2160：53 次工具调用）**：`npm test` ×8、`tools/ac-stage7.sh` ×12、**真实客户端（`.venv/bin/python`）×6**、
  `uv venv` ×4、`npm install` ×2、`ss -ltn` ×10；**项目外写入 = 0**；`git add -A` = 0；越界/特权动作 = 0。
- **回复对账**：其收尾回复的结论关键词在 `PROGRESS.md` 里全部命中（`2025-11-25` ×17、`prompt_search/get/render` 各 14–18 次、
  `不直连` ×4、`by_channel` ×8、`mcp` ×58）→ **没有"只存在于会话、未落盘"的信息** ✅

## 5. 遗留与缺口（不阻塞放行）

1. **⚠️ 遗留小项（已记 BRIEF v8 变更记录）**：`bin/pm-mcp.mjs` 的 **git mode = `100644`**（非可执行）、工作区权限 `600`，
   与项目自身约定（阶段 1 的 `2c82c9f`「CLI/脚本置 755」）及 `bin/pm.mjs`(755) **不一致**。
   影响：以 `node <path>` 方式调用只需读权限，root 下无碍；但**部署/非 root 场景**（另一个 agent 用户或服务用户拉起 MCP）会读不到。
   → 列入**阶段 8 顺手修正**（`chmod 755` + 提交 mode 变更）。
2. **导入二次确认**（阶段 5 验收发现"合法空文件 + replace = 清空整库"）已升格为规格 **FR-11b**，在阶段 8（前端）落实。
3. `.venv`（Python 对端，15:14 由 `uv venv` 创建）是**验证工具**、已被 `.gitignore`；建议阶段 9 收尾时决定去留（重建成本=一条 `uv` 命令）。

## 6. 下一步指令

**放行阶段 8**（前端 P0：全 antd 组件 + 净化硬化的 UI 侧 + 界面自证）→ 验收 **AC-13、AC-20、AC-21**。
⚠️ 阶段 8 是**本项目最大的一块**；当前会话上下文已到 **~74%（741k/1M）**，
**建议用户在新会话里下发阶段 8**（状态全在磁盘四文档里，换会话成本≈0），避免它在中途被自动压缩。

## 7. 验收方操作留痕（含我第 8–10 次脚本失误，如实记录）

1. **`pkill -f '<绝对路径>'` 又一次自杀**：模式匹配到了**承载该命令的 ssh shell 自身** → shell 被杀、后续命令全没跑、输出为空，
   我一度以为"停服失败"（其实服务根本没被停，AC-26⑤ 因此没测到）。**正确姿势：`sudo ss -ltnp` 取 `pid=` 再 kill**（已固化到技能 §8）。
2. 第一次用非 root 的 `ss -ltnp` 取 PID → **不显示 pid**（拿到空值）→ 改用 `sudo ss -ltnp`。
3. 第一次 AC-26⑤ 因此判成"❌ 未报错"，实为我方失误；修正后判定为"✅ 明确报错且证明经 API"。

其余留痕：临时 DATA_DIR + detached 服务、跑完 8767 监听数 **0**、临时目录与 token 文件已删、项目内无 `data/` 残留、
`git status` 干净；未打断 dsh 会话；只改 `BRIEF.md`（v8）与 `VERIFY.md`。

---

# 阶段 8 验收（前端 P0：全 antd + 界面自证）— 结论：**过**

| 项 | 值 |
| --- | --- |
| 验收人 | host_manger |
| 验收日期 | 2026-09-18 |
| 被验收 commit | `b0cd81c`（阶段 8 收尾；本阶段 9 次提交 `27c82cf`→`b0cd81c`） |
| 应交付 AC | **AC-13（界面自证）、AC-20（组件库落地）、AC-21（组件库真在渲染）** + 我额外要求的 **FR-11b** |
| **结论** | **过（放行阶段 9）**；另有 1 项规格加固已升级为 BRIEF v9（FR-10b） |

## 1. AC-13 界面自证 — 过（**我自己起服务、自己截图、自己看图**）

**方法（独立复现，不用它的 `ui-shots.sh`）**：我在 228 上写了**我自己的 CDP 客户端**
（`chrome-headless-shell --remote-debugging-port` + Node 内置 `WebSocket`，零依赖），
用临时 DATA_DIR 起服务、灌 3 条中文夹具，再通过 CDP `Network.setCookie` + `Page.navigate` + `Page.captureScreenshot`
**自己截了 12 张**，并把 PNG 取回容器**逐张用视觉看过**。

| 我截的图 | 尺寸 | 我看图后的判定（四问：重叠/断词/孤标题/裁切） |
| --- | --- | --- |
| `01-login` | 1280×800 | 卡片居中、用户名预填 `admin`、口令框带眼睛图标、底部说明两行完整；**①无 ②无 ③无 ④无** |
| `02-list` | 1280×800 | 表格列（标题/标签/文件夹/版本/取用/更新于/操作）齐整，★收藏态正确，标签为 antd Tag，分页「共 3 条」；**四问皆无** |
| `03-dark-list` | 1280×800 | 暗色整套主题正确（暗底卡片/表格、文字对比度足），无黑压黑；**四问皆无** |
| `04-mobile-list` | **390×844** | 自动降级为卡片列表，☰ / … 图标在**亮色**主题下可见（它本轮修掉的正是这个缺陷）；**四问皆无** |
| `05-editor` | 1280×800 | 编辑器抽屉：标题/#1、四个 Tab、四个字段、文件夹/标签（带计数）、收藏开关状态正确；**四问皆无** |
| `11-search-clicked` | 1280×800 | 输入「周报」并点搜索 → 列表过滤为 **共 1 条 / 当前筛选命中 1 条**（我第一轮的合成输入没触发，是因为 `Input.Search` 需回车或点按钮 —— **不是缺陷**） |
| `14-import-with-file` | 1280×800 | 附真实导出文件后显示 `prompt 3 / 文件夹 0 / 标签 3`，merge 侧提示「将新增 prompt 3 条…同名文件夹/标签会复用，现有数据不动」 |
| `16-import-replace-warning` | 1280×800 | 切 replace → 警示「replace 模式会先清空现有数据 / 将清空现有全部 prompt / 文件夹 / 标签 / 版本历史」，提交按钮改名为「导入（清空重建，需二次确认）」 |
| `17-import-confirm` | 1280×800 | **二级确认弹窗**：「确认以 replace 模式导入？」+ 红字清空提示 + 「随后按文件重建：prompt 3 条…」+「此操作不可撤销；建议先导出当前数据留底。」+ `取 消` / **红色** `清空并导入`；**四问皆无** |
| `18-variables-tab` | 1280×800 | 「从 user_prompt / system_prompt 提取到 **2 个变量**（渲染不写库）」+ 项目 / 交接人 两个填值框 + 渲染/清空按钮 |
| `19-versions-tab` | 1280×800 | 版本对比选择器 + **真实统一 diff**（`--- v1 / +++ v2 / @@ -5,3 +5,4 @@ [notes] +改一次`，+ 行绿色高亮）+ 版本表（v1/v2 + 回滚）；**四问皆无** |
| `20-markdown-tab` | 1280×800 | Markdown 预览 Tab 正常渲染 |

**功能冒烟（同一轮 CDP 顺手验的）**：搜索过滤生效（1 条）、打开详情后列表「取用」由 0 → **1**（证明 FR-19 在 UI 侧也记账）、
编辑器内容与夹具一致（`{{项目}}/{{交接人}}`、收藏=已收藏）、变量面板顺序正确、版本 diff 反映真实改动的字段。

## 2. AC-20 组件库落地 — 过（四条）

```
① npm ls antd @ant-design/icons --depth=0 → antd@6.6.4 + @ant-design/icons@6.3.4（无 @ant-design/v5-patch-for-react-19）
② 源码里原生表单/表格标签 <button|input|select|textarea|table|dialog> → 计数 = 0
③ from 'antd' → **24 处 / 覆盖 18 个 .tsx 文件**（web/src 共 24 文件、19 个 .tsx）
   组件使用分布（前几）：Button 6 · Spin 6 · Tag 5 · theme 5 · App 5 · Empty 4 · Alert 4 · Select 3 · Layout 3 …
④ 源码与构建产物里的 CDN 外链（cdn|unpkg|jsdelivr|googleapis）→ 计数 = 0
```

## 3. AC-21 组件库真在渲染 — 过（**严格口径**）

我用自己的 CDP 脚本读**真实 DOM 的 `classList`**（不是页面里的 `<style>` 文本）：

```
登录页 distinct ant-* 类名 = 43 ｜ 列表页 = 129 ｜ 编辑器（含抽屉）= 186      （门槛 ≥3）
```

## 4. FR-11b 导入二次确认 — 过（真实文件注入，端到端）

通过 CDP `DOM.setFileInputFiles` 把我从 API 导出的**真实 ExportFile** 注入文件选择器（不是模拟点击）：
merge 侧显示计数与"现有数据不动"；replace 侧出现清空警示；点击提交弹出**二级确认**，按钮为红色「清空并导入」，
文案与 BRIEF FR-11b 逐字一致，并额外给出"建议先导出当前数据留底"。我点「取 消」收场（未破坏数据）。

## 5. 其他核验

- **测试**：我独立跑 `npm test` → **147/147 通过**（29 个测试文件）；`npm run typecheck:web` 由它复跑 rc=0（我未单独跑）。
- **零新增依赖**：`git diff 27c82cf~1..HEAD -- docs/dependencies.md` 无新增表格行；`package.json` 本阶段无新包。
- **未动规格与运维面**：本阶段 `BRIEF.md`/`STANDARDS.md` **0 次改动**、`deploy/` **0 次改动**。
- **过程审查（新会话 205 次工具调用）**：`npm test` ×7、`tools/ac-stage8.sh` ×10、`tools/ui-shots.sh` ×13、CDP ×13、
  `git commit` ×9、`ss -ltn` ×4、`chmod` ×1；**项目外写入 = 0**（30 个文件全在项目内）；`git add -A` = 0；越界/特权动作 = 0。
- **回复对账**：其收尾回复给出的落盘位置**逐条核实**——`green gate`（PROGRESS 1 次）、`147`（5 次）、`typecheck:web`（3 次）、
  `ui-shots`（27 次）、`识图`（24 次）全部命中；**唯一缺失是收尾 commit `b0cd81c` 自身**（结构性例外，由本报告 §1 记录）。
  它还**主动解释了"本次不重跑截图脚本"的理由**（避免时间戳churn污染已成对识图证据）并把该理由写进 PROGRESS —— 符合我要求的"落盘对账式回复"。

## 6. 上轮提出的两个小项 —— 均已闭环

1. **`tmp/removed-stage1/StageChecklist.tsx` 入库问题**：复核 `git ls-files tmp/` = **空**（未跟踪），
   `web/src/` 下已无该文件 → **最终没有入库**，`tmp/` 现在只剩 4 个日志文件（未跟踪）。✅ 无需整改。
2. **`bin/pm-mcp.mjs` 权限**：已置 **755**（提交 `9198164`，与 `bin/pm.mjs` 及项目约定一致）。✅

## 7. 缺口与后续（不阻塞放行）

1. **导入校验可再收紧**（阶段 5 验收时记录、本轮复核仍存在）：缺 `title` 或 `user_prompt` 的条目仍被接受。
   → **已升级为规格 BRIEF v9 的 FR-10b**（后端拒绝 + 不动数据），放阶段 9 收尾一起做。
2. `tmp/` 目录仅剩日志、未跟踪；建议阶段 9 收尾清理（`rm -rf tmp`）。
3. `docs/shots/` 入库 20 张 PNG（10 修后 + 10 修前）：属界面自证证据，保留合理。
4. **实际部署**仍未做（按约定：部署为单独立项，需用户点名）。阶段 9 只交付"可部署的最终状态"。

## 8. 下一步指令

**放行阶段 9（收尾）**：部署文件最终核对 + README 四要素 + 依赖登记比例 + 全量测试 + **FR-10b** + `tmp/` 清理 →
验收 **AC-16、AC-17、AC-18**（+ FR-10b 的新断言）。
⚠️ 阶段 9 之后，**是否真的部署**由用户单独决定（我不会自行部署）。

## 9. 验收方操作留痕（含我第 11–14 次脚本失误）

本轮我的 CDP harness 连踩四处，全部记下（实现都是好的）：

1. **连错端点**：先连了**浏览器级** WS（`/json/version`），`Page.*` 全部无声失败（我还把 `send()` 写成了"忽略错误"）→
   改用**页面级** target（`/json/list` 里 `type: page` 的 `webSocketDebuggerUrl`），并让 `send()` **回显协议错误**。
2. **漏写一个常量**（`const OUT`）→ `ReferenceError`，白跑一轮。
3. **合成输入不触发 `Input.Search`**：我用"设 value + 派发 input 事件"打字，列表没过滤 → 误以为搜索坏了；
   正确做法是再**点搜索按钮或按回车**（这是 antd `Input.Search` 的正常语义）。
4. **选择器误点**：用全局正则 `/导入/` 找提交按钮，点到了打开弹窗的那个按钮 → 二次确认没出现；
   正确做法是把选择范围限制在 `.ant-modal-body button` 内，且**先列出所有可见按钮文本**再挑。

---

# 阶段 9 验收（收尾：部署文件 / README 四要素 / 卫生 / FR-10b）— 结论：**过**

| 项 | 值 |
| --- | --- |
| 验收人 | host_manger |
| 验收日期 | 2026-09-18 |
| 被验收 commit | `6390ed2`（阶段 9 收尾；本阶段 5 次提交 `430543e`→`6390ed2`） |
| 应交付 AC | **AC-16（全量测试）、AC-17（卫生）、AC-18（部署文件）** + **FR-10b（导入校验收紧）** |
| **结论** | **过** |

## 1. 逐条验收

### AC-16 全量测试 — 过

```
$ npm test            → ℹ tests 149   ℹ pass 149   ℹ fail 0   （test_rc=0）
测试文件数 = 29（门槛 ≥8）
$ npm run typecheck:web → rc=0
```

### AC-17 凭据与产物卫生 — 过

```
git check-ignore -v data/pm.db .env _env/x   → 三条都有输出（.gitignore:10/5/2）
硬编码口令/密钥命中（src/bin/web，排除 tests）→ 0
docs/dependencies.md 表格行 54 ≥ 直接依赖 27
.gitignore 覆盖 node_modules/ dist/ data/ .env _env/ tmp/ → 6 项齐（实测 git check-ignore 全部命中）
仓库内被跟踪的临时产物（tmp|dist|data）→ 0
项目内 tmp/ 目录 → **已清理** ✅
```

### AC-18 部署文件（五件套，交付物 + 验收项）— 过

```
deploy/ = promptmanager.service · promptmanager.env.example · README.md · reverse-proxy.example.conf · mcp-register.example.json
systemd-analyze verify 的 error 行 → 0
必需指令 User/Group/WorkingDirectory/EnvironmentFile/Restart → 5
MemoryDenyWriteExecute → 0（Node 服务不得开）
env.example 里口令/密钥类非空值 → 0
反代样例：X-Forwarded-For 转发 2 处；真实域名/证书路径 → 0
MCP 注册样例：占位符 4 个；真实 pm_ token → 0
deploy/README 覆盖「内网|公网|反代|回滚」→ 25 行命中
```

### FR-10b 导入校验收紧 — 过（**双向都断言**）

```
基线指纹：prompts=1 ｜ 首条 1 / '种子条目' / '种子正文 会话交接'
① 缺 title        → 400  {"error":"invalid_import","details":[{"path":"data.prompts[].title","message":"缺少 title：导入不允许静默补成空串（…"}]}  指纹不变 ✅
② 缺 user_prompt  → 400  同上（path=data.prompts[].user_prompt）                                                                              指纹不变 ✅
③ 显式空串（title:"", user_prompt:""）→ **200**                                                                                               ✅ 未被误杀
④ 正常 merge 导入 → 200
```

**判定依据**：BRIEF FR-10b 的措辞是"拒绝**缺少** `title`/`user_prompt` 的条目" —— "缺字段"与"显式给空串"是两件事；
实现把两者分开处理（缺字段 400 且提示"不允许静默补成空串"；显式空串照常接受），与规格一致，且它**主动为反向断言补了单测**。

## 2. 其他核验

- 本阶段改动面：`src/db/import*`（校验）、`web/**`（把后端 details 显示出来，**前端不复刻校验**——单一真相源，判断正确）、
  测试、`README.md`（四要素终稿）、`deploy/README.md`（编号修复）、`PROGRESS.md`。`BRIEF.md`/`STANDARDS.md` **未被改动**（我方 v9 之外）。
- 它还**自查并修掉一个文档渲染缺陷**：`PROGRESS.md` §7 表格单元格里有未转义竖线导致表格被截断（提交 `6390ed2`）。
- 工作区干净、8767 无残留监听（验收后我确认 8765–8770 仅 izone 8769）。

---

# 项目总结论（P0 交付完成 · 2026-09-18）

**一句话**：自研轻量 Prompt 管理器的 **P0 全部交付并逐条验收通过**；**尚未部署**（部署为单独立项）。

## 交付统计

| 维度 | 数字 |
| --- | --- |
| 阶段 | **9/9 全部验收通过**（阶段门从未返工） |
| 需求 | **29 条 FR**（P0：认证/CRUD/检索/版本/变量/Markdown/导入导出/界面/Token/CORS/CLI/使用记录/MCP/部署文件…） |
| 验收标准 | **28 条 AC**（含 AC-27 使用记录、AC-28 双形态部署），全部由我独立复现 |
| 测试 | **149 用例 / 29 个文件**，最终 HEAD 上全绿；`typecheck:web` rc=0 |
| 依赖 | 全部 pin 精确版本；**GPL/AGPL 0**；装前 OSV 闸门 + `npm audit` 0 漏洞 |
| 我的独立复现 | 每个阶段各自起服务/临时库跑 AC；界面阶段**自建 CDP harness 自截 12 张并逐张看图** |
| 过程审查 | 9 个阶段累计数千次工具调用，**项目外写入 0**、`git add -A` 0 次 |

## 已知限制（不阻塞使用，记录在案）

1. `LIKE` 兜底是全表扫描：2000 行 4 ms，**10 万行量级需重新评估**；
2. 前端 bundle 842 KB 未做代码分割；
3. `jsdom` 常驻：冷启动 1.28 s、**RSS ≈207 MB**（可改惰性初始化）；
4. `usage_events` 无清理策略（只记取用，增长缓慢）；
5. 同一内容多次保存会产生多个同内容版本（契约如此，不做内容哈希去重）；
6. `T-2`：内网/外网两实例的数据关系未定（默认**不做同步**，用 export/import 搬运）。

## 明确未做（本期范围外）

- **P1**：多视图切换 / 拖拽排序 / 批量操作、媒体上传预览、**PromptHub JSON 格式兼容导入**、搜索增强（高亮片段）、键盘可达性；
- **P2**：关系树 / 输出格式序列 / 看板 / 图谱、私有加密文件夹、AI 改写与多模型测试 / 图片反推、外部同步（WebDAV/S3）、多端、i18n。

## 移交清单（部署前即可用）

| 事项 | 位置 / 做法 |
| --- | --- |
| 跑起来 | `npm ci && npm run build && npm start`（默认 `0.0.0.0:8767`，`DATA_DIR` 默认项目内 `data/`） |
| 设口令 | `node bin/pm.mjs user set-password --username <u>`（stdin 读，不落日志） |
| 数据 | 单文件 SQLite `$DATA_DIR/pm.db` + `data/media/`；备份 = 拷文件或 `GET /api/export` |
| 外部客户端 | CLI `pm get/render/token`（走 HTTP + Bearer）；MCP `bin/pm-mcp.mjs`（stdio，注册样例见 `deploy/mcp-register.example.json`） |
| 部署文件 | `deploy/` 五件套（systemd unit / env 模板 / 反代样例 / MCP 注册样例 / 部署与回滚说明）；**均未安装** |
| 端口 | 8767（台账已登记）；部署时另分配验收备用端口 |

## 验收方自省（本项目累计）

本项目的 9 次验收里，我自己的**脚本/方法**出过 **14 处问题**（漏设口令、`env VAR=x "$@" cmd` 不生效、
重定向掉失败诊断、按路径强杀进程自杀、非 root `ss` 取不到 pid、合成输入不触发 `Input.Search`、选择器误点按钮、
跨用例共用基线、判据关键字写进夹具、CDP 连浏览器级端点…）。
**全部已固化进技能**：`acceptance-gate.md` §8（验收脚本三条纪律）+ §4（用 `sudo ss` 取 pid）+ §9（界面类 CDP 四条要点），
`BRIEF.template.md` AC 自检 ⑪/⑫/⑬。**实现侧的缺陷只有 2 个**（folders 自引用外键导致 replace 清空失败；阶段 1 的 FTS 触发器补测），
且都是它自己抓到并修的 —— 这条对比本身说明"验收脚本比实现更容易出错"，写进技能是值得的。

---

# 部署记录（host_manger 执行，2026-09-18）

> 依据：`deploy/README.md`（交付物自带流程）+ 我方部署检查清单。**部署 = 生产变更**，本记录含原始证据与回滚步骤。

## 形态

内网直连（HTTP），不接反代/证书/DNS；`TRUST_PROXY`/`PUBLIC_ORIGIN`/`CORS_ORIGINS` 全留空。

## 执行步骤与结果

| 步骤 | 结果 |
| --- | --- |
| 建服务账号 | `useradd --system --home-dir /opt/promptmanager --shell /sbin/nologin promptmanager` → uid=984 |
| 投放代码 | 项目 → `/opt/promptmanager`（排除 node_modules/dist/data/.git/tmp），`chown` 给服务账号，并**把源码里的 600 权限修成 644/755**（dsh 写文件时是 600 root，非 root 服务读不到——这是我方部署清单里防的 EACCES 类故障） |
| 依赖与构建 | 以服务账号 `npm ci --omit=dev=false` + `npm run build` → dist 含 server/web/mcp |
| **预演** | 以服务账号 + 临时端口 8799 + 临时 DATA_DIR 起一次 → healthz 200、未认证 401 ✅（**上线前就证明了运行副本能被服务账号读起来**） |
| env 文件 | `/etc/promptmanager/promptmanager.env`（600 root，口令类值全空；HOST=0.0.0.0 / PORT=8767 / DATA_DIR=/var/lib/promptmanager） |
| unit | `promptmanager.service` 安装 + `enable --now`（开机自启）；`systemd-analyze verify` 无 error |
| ⚠️ **首次启动失败** | 见下节（AF_NETLINK）；用 **drop-in** 修补后 `active`，NRestarts=0 |
| 管理员口令 | 以服务账号 `pm.mjs user set-password --username admin`（stdin 读，**只在交付时一次性告知用户**，不进 env/git/日志） |
| API token | `pm.mjs token create --name admin-cli`（明文一次性告知；库中只存 sha256） |
| 数据迁移 | 见下节 |
| 第三方验证 | **从 host_manger 所在容器（另一台主机）** `curl http://192.168.0.228:8767/healthz` → 200；`/api/prompts` → 401 ✅ |
| 端口/监听 | `0.0.0.0:8767`（非 127.0.0.1）；验收后 8765–8770 段其余端口无新增监听 |

## ⚠️ 部署期发现并修补的交付物缺陷：unit 缺 `AF_NETLINK`

```
journald:
SystemError [ERR_SYSTEM_ERROR]: A system error occurred: uv_interface_addresses returned Unknown system error 97 (EAFNOSUPPORT)
    at Object.networkInterfaces (node:os:218:16)
    at getAddresses (/opt/promptmanager/node_modules/fastify/lib/server.js:365:29)
    at Object.logServerAddress (...381)
→ 服务 exited status=1/FAILURE，Restart 循环
```

- **根因**：Linux 上 `os.networkInterfaces()` 走 libuv 的 `uv_interface_addresses`（需要 **AF_NETLINK** socket），
  而交付 unit 的 `RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX` 未包含 AF_NETLINK → `socket()` 被 seccomp 拒 → **errno 97**。
  Fastify 启动时会调用它来打印监听地址，于是**启动即崩**。
- **为什么 AC-18 没拦住**：AC-18 只断言"`systemd-analyze verify` 无 error + 指令齐备 + 口令留空"——**语法正确 ≠ 能起来**。
  这类问题只有"以真实 unit 真起一次"才会暴露。（已列入技能改进项，见下）
- **处置（首次部署时的临时修补，已验证后撤除，见文末 FIX-1 验收）**：当时新增了 drop-in
  `/etc/systemd/system/promptmanager.service.d/10-allow-netlink.conf`：
  ```ini
  [Service]
  RestrictAddressFamilies=
  RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK
  ```
  生效值经 `systemctl show -p RestrictAddressFamilies` 确认为 `AF_INET AF_INET6 AF_NETLINK AF_UNIX`；其余加固保持不变。
- **回写实现方（建议）**：unit 里把 `AF_NETLINK` 加进允许列表（并给 AC-18 增一条"以真实 unit 真起一次"的运行时断言）。
  项目 P0 已验收，此项作为**可选 FIX-1**，由用户决定是否返工。

## 数据迁移（PromptHub → promptmanager）

| 项 | 值 |
| --- | --- |
| 源 | 203 上 PromptHub（自托管 Web）的 SQLite **只读副本**（复制 `prompthub.db`，未碰其运行中服务） |
| 映射 | 文件夹 UUID→整数 id（保留父子与排序）· prompts 重编号 · `tags` JSON 数组→名称数组 · `description`→`notes`（用途说明不丢）· `prompt_versions`→版本数组（**保留 v1/v2 历史**）· epoch 毫秒→ISO 8601 UTC |
| 明确未迁移 | `is_pinned`/`images`/`videos`/`usage_count`/`ai_response`/`*_en` 字段（本产品 P0 无对应模型；备注见迁移任务 README） |
| 导入 | `POST /api/import {"mode":"replace"}`（部署库为空，replace 得确定性结果；**users/tokens 不受影响**） |
| 结果 | `{"mode":"replace","imported":{"folders":4,"tags":14,"prompts":6}}`；核对：prompts=6 / folders=4（父子 `会话管理`→`Agent管理` 正确）/ tags=14（计数正确）/ 《上下文将满 · 会话交接》版本 [1,2] 且 v1→v2 diff 正常 / 中文检索 `巡检`=2、`交接`=1、`备份`=2 |
| 部署实例取证 | 用我方 CDP harness 重新登录已部署实例并截图：列表页真实数据（含文件夹树、14 标签、6 行表格）与版本历史抽屉 —— 见 `/tmp/hm-deployed/*.png`（临时文件，结论已记于此） |
| ⚠️ 注意 | `replace` 是**清空重建**语义：以后再导入务必确认不要覆盖现有库；日常增量请用 `merge` |

> **更新（2026-09-18 22:22）**：阶段 10B 视觉重设计（方向 A）已同步上线，见文末「阶段 10B 验收」节的上线记录。

## 回滚（可逆性）

```bash
sudo systemctl disable --now promptmanager                       # 停服务 + 取消自启（数据保留）
sudo rm -f /etc/systemd/system/promptmanager.service /etc/systemd/system/promptmanager.service.d/10-allow-netlink.conf
sudo systemctl daemon-reload
# 数据（如需彻底清除）：/var/lib/promptmanager（pm.db 等）——默认保留
```

**受影响时长与数据影响**：首次启动失败期间服务不可用（约 2 分钟，无人使用时段）；`/var/lib/promptmanager/pm.db` 全程未被损坏（失败发生在监听阶段，未写业务数据）；
导入为单事务，失败即回滚（本次一次成功）。未改动任何系统配置之外的东西：只新增 useradd 一个系统账号、`/opt/promptmanager`、`/etc/promptmanager/`、unit + drop-in、`/var/lib/promptmanager`。

---

# FIX-1 验收（unit 允许 AF_NETLINK）— 结论：**过**（2026-09-18 19:12）

| 项 | 值 |
| --- | --- |
| 被验收 commit | `9aa5155`（`fix(deploy): FIX-1 — unit 允许 AF_NETLINK …`）+ 开工前 `026d64b` |
| 规格来源 | BRIEF **v10** §5 新条款 + §8 AC-18 第 ⑤ 条（`6feab89`，由 host_manger 依首次部署缺陷回填） |
| **结论** | **过 —— 交付物已自足，drop-in 已撤除** |

## 1. 静态断言（我独立复跑，六项全过）

```
① grep -cE '^RestrictAddressFamilies=.*AF_NETLINK' deploy/promptmanager.service → 1
   （第 52 行：RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK）
② grep -c 'AF_NETLINK' deploy/README.md → 4（排查节已写）
③ systemd-analyze verify … | grep -c error → 0
④ 五个必需指令 → 5 ｜ ⑤ MemoryDenyWriteExecute → 0 ｜ ⑥ env.example 口令类非空 → 0
```

## 2. **真判据：撤掉 drop-in，用修正后的 unit 重启** — 通过

我只信"能不能起来"，因此执行了生产变更（**带自动回滚**）：

```
撤前：is-active=active ｜ 生效允许列表=AF_INET AF_INET6 AF_NETLINK AF_UNIX（来自我的 drop-in）
动作：install 修正后的 unit → 删 /etc/systemd/system/promptmanager.service.d/10-allow-netlink.conf → daemon-reload → restart
撤后：is-active=**active** ｜ 生效允许列表=AF_INET AF_INET6 AF_NETLINK AF_UNIX（**来自 unit 自身**）｜ NRestarts=**0**
      监听 0.0.0.0:8767 ｜ healthz 200 ｜ 未认证 /api/prompts=401 ｜ is-enabled=enabled
数据：**prompts=6 条仍在**（`pm.db` 315392 字节，属主 promptmanager）；重启是纯进程重启，未触数据
```

→ **交付物现在自带 AF_NETLINK，不再依赖任何 drop-in。** 后续照 `deploy/README.md` 部署的人不会再撞这个坑。

## 3. `deploy/README.md` 的排查节（质量核查）

它新增的内容包含：症状（journald 原始报错）→ 根因（libuv 需要 netlink socket；unit 只允许 AF_INET/AF_INET6/AF_UNIX）
→ **两种修法**（① v10 起的 unit 已修好，重投放即可；② 存量部署用 drop-in 覆盖，并强调 **drop-in 必须带 `[Service]` 段头**、
列表型指令是**覆盖**语义所以先写空值再写全量）→ **确认生效值的命令**（`systemctl show -p RestrictAddressFamilies --value`）。
与我在首次部署里踩到的两处（缺 netlink、drop-in 漏段头）逐条对应，写得比我的口头汇报更完整。

## 4. 过程审查（FIX 会话 seq>1333：22 次工具调用）

- `git commit` ×2（`026d64b`/`9aa5155`）；写入文件仅 `deploy/promptmanager.service` 与 `deploy/README.md`（**项目外写入 = 0**）；`git add -A` = 0。
- **未动系统**：它没有 `systemctl restart/daemon-reload/enable`，也没有写 `/etc/systemd/system`；验证 drop-in 语法时用的是
  **项目内的假根**（`tmp/verify/etc/systemd/system/...` + `systemd-analyze --root`）——严格守住了"不碰系统配置"的红线。
- 它另外主动核实了一件对我很重要的事：**测试全部用 `port: 0`（不绑定 8767），因此与生产实例不冲突**（生产已占用 8767）。

## 5. 回复对账

落盘对账式回复 ✅：它把"本次收尾 commit `9aa5155`"**单独标注为唯一不在文件里的信息**，
其余结论逐条给出落盘位置（`PROGRESS.md` 阶段 9.1 §1/§3、`BRIEF.md` v10 §5/§8、`VERIFY.md` 部署记录）。
对上账：`9aa5155`/`026d64b` 与 `PROGRESS.md` 单元表一致；引用的验收缺口与 §8 AC-18 ⑤ 一致。

## 6. 结语

**项目 P0 + 部署 + FIX-1 全部闭环**：9/9 阶段验收通过 → 228 内网已部署（8767，开机自启）→ 数据已迁移（6 prompt/4 文件夹/14 标签）
→ 交付物的部署缺陷已修复并**用真实 unit 复验**。剩余可选事项：备份接入、公网形态（反代+HTTPS）、MCP 注册到宿主、P1 功能取舍。

---

# 阶段 10B 验收（视觉重设计·全站应用，方向 A）— 结论：**过**，并**已上线**

| 项 | 值 |
| --- | --- |
| 被验收 commit | `ff5aa35`（阶段 10B，5 次提交 `9716207`→`ff5aa35`） |
| 规格 | BRIEF **v12**（FR-40/FR-40b、AC-29/30/31/32、D-19 = 方向 A + 登录页 B） |
| **结论** | **过** → **已同步 `/opt` 并重启上线**（见文末"上线记录"） |

## 1. 静态项（我独立复跑）

```
AC-29①：主题 token 真被定制 → web/src/theme.ts（token + components 两块），语义覆盖 colorPrimary/colorBgContainer/colorBorder/borderRadius/controlHeight/fontSize
AC-29②：CDN 外链（源码+产物）→ 0        AC-29③：原生表单/表格标签 → 0        from 'antd' → 27 处
AC-31 源码侧：9 个固定 testid 各出现 1 次（pm-topnav/pm-sidebar/pm-kpi-row/pm-filter-row/pm-statusbar/pm-editor/pm-panel-versions/pm-panel-variables/pm-panel-markdown）
回归：npm test → 156/156（29 文件，较阶段 8 的 149 增 7）｜ npm run typecheck:web → rc=0
自定义 CSS 克制：styles/app.css 92 行 + styles/markdown.css 28 行（合计 120 行，未引入第二套样式体系）
依赖：package.json 本阶段无变化
```

## 2. **运行时结构断言（AC-31 ④⑤⑥⑦）—— 我自己跑，且带三重自检**

方法：临时 DATA_DIR + **端口 8768**（避让生产 8767）+ 我自己的 CDP 客户端；**三重自检**保证测的是新构建：
① 服务提供的 js 哈希 == 磁盘构建产物哈希；② 夹具账号登录 200 且 `/api/me` 正常；③ CDP 里确认侧栏已渲染（=已登录）。

```
pm-kpi-row 存在 → true ｜ KPI 行内数字个数 → 6（期望 ≥4）
pm-topnav / pm-sidebar / pm-filter-row / pm-statusbar 四个骨架 testid → 全部 true
[data-testid^="pm-panel-"] 数量 → 3（期望 3）
三栏【同时可见】（offsetParent 全非空）→ true（期望 true）   ← 证明是常驻三栏，不是标签页
详情面 .ant-tabs-tab 数量 → 0（期望 0）                      ← 三块不再由标签页承载
pm-editor 存在 → true ｜ 移动端 390×844 横向溢出 → false
```

## 3. 我自己看图（不采信它的截图）

我用自己的 CDP 截了 4 张（列表亮/列表暗/编辑器/移动 390×844）并逐张看：
- **列表页**：KPI 四卡（prompt 总数 / 近 30 天取用 / 最近改动版本 / 本次检索耗时）+ 筛选行 + 密集表格 + 左侧栏（文件夹树 / 标签 / 工作区）+ **底部状态条**（数据位置 · 备份提示 · 筛选命中 ｜ 监听 · 查询耗时）——与 A 设计稿结构一致；
- **暗色**：近黑画布 + 分层表面 + 细描边 + 单一 indigo 强调色，亮/暗都成立；
- **编辑器**：左**内嵌小列表**（可搜索/高亮当前）· 中编辑主体 · 右**三栏常驻**（版本历史含真实 diff / 变量填值 / Markdown）——正是用户要的"排版重设计"；
- **移动端**：KPI 变 2×2、筛选堆叠、卡片式列表，无横向溢出。

## 4. 与设计稿的一致性（AC-32）与降级清单

它产出 **5 组并排对照**（`docs/shots/compare/`：列表亮/列表暗/编辑器/移动/导入确认，各含 .html+.png）+ `plan.json`；
**降级清单 6 条**我逐条审阅，判定**全部可接受**，其中两条**比设计稿更好**：
1. 三栏需列内滚动（三块"同时挂载且可见"，但 1280×800 下第三块要滚动才看全）——真实取舍，接受；
2. 编辑器左栏改 prompt 列表（依 FR-40b 字面"左（列表）"，规格优先）——接受；
3. 顶栏 host 用 `window.location.host` 而非写死 `pm.host:8767`——**比设计稿更诚实**（部署形态决定）；
4. KPI"最近改动版本"取**当前筛选结果的最值**（不新增接口 = 纯表现层约束）——接受；
5. KPI"检索耗时"改显示**本次前端往返毫秒**（不做假数据）——**比设计稿更有用**；
6. 左栏三块用三张 antd `Card`（视觉同族）——无害。
**无"默默简化"**：6 条全部显式登记。

## 5. 过程审查（阶段 10B：82 次工具调用）

`npm test` ×6、`ac-stage10.sh` ×13、`ui-shots.sh` ×12、`git commit` ×3；**项目外写入 = 0**；`git add -A` = 0；
风险扫描命中的 4 处"8767/`/opt`"经逐条核查**全是 PROGRESS 文本或 `git diff` 检查**——**没有碰生产实例**（时间戳证据：`/opt/promptmanager/dist` 仍是 18:08、生产 js 哈希在同步前后未变、数据 6 条完好）。
回复为**落盘对账式**（逐条给落盘位置，收尾 commit 单独标注）。

## 6. 上线记录（host_manger 执行，2026-09-18 22:22）

```
同步：项目 → /opt/promptmanager（tar→tar，排除 node_modules/dist/data/.git/tmp/docs-shots/docs-design）
权限：chown 服务账号；chmod 只作用于源码（**排除 node_modules**，否则会削掉 .bin 的可执行位 → 构建报 Permission denied）
重建：以服务账号 npm run build（package.json 未变，无需 npm ci）
重启：systemctl restart promptmanager → active / NRestarts=0 / enabled
验证：生产 js 哈希 == 新构建（index-Vj3XQ2JO.js）｜ 服务产出的 js 内含 pm-kpi-row ｜ healthz 200 ｜ 未认证 401 ｜ **数据 6 条完好** ｜ 管理员登录 200
生产实拍：CDP 登录生产实例截图 → KPI 行在、三栏同时可见（true,true,true）、真实数据 6 条（《上下文将满 · 会话交接》v2 等）
失败回滚：`systemctl stop promptmanager && 从项目目录重新同步并 build && systemctl start`（源码在项目仓，随时可重建）
```

### 我方三次折腾（如实记录，已固化进技能）
1. **8767 被生产占用** → 我第一次验收脚本的临时服务 EADDRINUSE 静默失败，**我实际上在测生产旧版**（并因此留下几条失败登录记录）→ 改为 **8768 + 三重自检**。
2. **228 没有 rsync** → 同步用 `tar → tar` 管道（全程在 228 上做）。
3. **我把远端路径写进了本地 `cd`** → tar 空跑；且**第一次 chmod 连 node_modules 一起削了执行位**，导致 `tsc` 报 Permission denied → 修正为"chmod 排除 node_modules"，并从备份还原后重做。

---

# 阶段 11 验收（使用优先改造）— 结论：**过**，并**已上线**

| 项 | 值 |
| --- | --- |
| 被验收 commit | `1f9713b`（阶段 11；7 次提交 `5dfba25`→`1f9713b`，含一轮**自我识图修正**） |
| 规格 | BRIEF **v14**（FR-41/a~f、AC-33/33b/33c/34~36、D-20）+ 用户原话纠偏 |
| **结论** | **过** → **已同步 `/opt` 并重启上线**（见文末上线记录） |

## 1. 我独立跑的运行时验收（8768 + 三重自检，全部通过）

```
自检：healthz 200 ｜ 服务提供 js 哈希 == 磁盘构建 ｜ 夹具登录 200

AC-34 使用/管理分离
  模式开关存在：true,true
  清 localStorage 后默认落「使用」：use-grid=true ｜ kpi-row=false
  使用视图内 pm-delete-* 数量：0
  切到管理 → kpi-row=true；刷新后仍记住管理模式（kpi-row=true）；顶栏大搜索 pm-search-input 在

AC-33 一键复制（实读剪贴板）
  点 pm-copy-1 → 剪贴板 = "这是一段固定文本，没有变量。"
  与 GET /api/prompts/1 的 user_prompt 比对：**MATCH**（逐字符）
  页面出现「已复制」：true；usage by_channel.session：0 → **4**

AC-33b 填变量对话框
  点含变量条目 → pm-vars-dialog 出现；输入框 = pm-var-input-姓名 / pm-var-input-项目
  未填时预览保留占位符："你好 {{姓名}}，项目 {{项目}}。"（其识图修正生效）
  填 姓名=张三 → 预览 = "你好 张三，项目 。"（无 {{）
  点「复制结果」→ 剪贴板 == 预览文本；再次打开 → 输入框**预填 "张三"**（自动记忆 ✅）

AC-33c 详情操作条
  双击卡片 → pm-detail 出现；pm-detail-actions 存在；条内按钮 = "复制提示词 | 版本历史 | 删除"

AC-36 快捷键
  "/" → document.activeElement = pm-search-input ✅ ｜ Esc → pm-detail 消失 ✅

AC-35 移动端（390×844）
  默认视图 = 使用视图 ✅ ｜ 复制按钮尺寸 = **102×44**（≥44×44）且可见 ✅

回归：npm test rc=0（30 个测试文件）｜ typecheck:web rc=0 ｜ CDN 0 ｜ 原生表单标签 0
收尾：8768 监听 0（临时服务已停）｜ 8767 生产 1（未被误碰）
```

## 2. 我自己看图（不采信它的截图）

- **使用视图**（我的截图）：标题「**拿来就用**」+ 一行说明「找到 → 一键复制 → 贴走；管理相关操作请切到「管理」」；
  大搜索（带 `（/ 聚焦，Ctrl/Cmd+K 也可以）` 提示）；排序 + **卡片/表格/列表** 三视图 + 收藏置顶开关；
  卡片 = 标题 + ★ + 正文摘要 + `#id · 文件夹 · v1 · 取用次数 · 变量数` + **`复制` / `填值后复制`** 主按钮（有变量的自动换成"填值后复制"）；
  左栏文件夹树 + 标签计数 + 底部状态条。
- **详情模态**：`用户提示词/系统提示词/备注` 字段切换 + **预览/源码** + **显示纯文本** + **全屏展开**；
  变量填值面板（提示"渲染不写库"）；**版本历史内联三视图**（表格/对比版本/详情 + 查看 diff）；
  **底部固定操作条：`复制提示词`（蓝主按钮）· `版本历史` · `删除`（红）**。

## 3. 与 BRIEF v14 的对应（FR-41e 吸收清单落地情况）

| 吸收项 | 落地情况 |
| --- | --- |
| 详情底部固定操作条 | ✅ `pm-detail-actions`（复制提示词主按钮 · 版本历史 · 删除） |
| 复制时的填变量对话框（自动记忆 + 实时预览） | ✅ `pm-vars-dialog` / `pm-var-input-*` / `pm-vars-preview` + localStorage 记忆 |
| 使用/管理分离 + 默认使用 + 记忆 | ✅ `pm-mode-use` / `pm-mode-manage` |
| 顶栏大搜索 + 快捷键 | ✅ `pm-search-input`（`/`、Ctrl/Cmd+K） |
| 纯文本 / 编辑预览 / 全屏 | ✅ 详情模态内三件套 |
| 视图切换 + 变量数·取用次数列 + 密度 S/M/L | ✅（卡片/表格/列表 + 两列 + 密度） |
| 版本历史三视图 + 变更备注 | ✅ 表格/对比版本/详情 + `pm-vnote-input`（本地备注） |
| 移动端复制按钮 ≥44×44 | ✅ 实measure 102×44 |
| FR-41f 摒弃清单 | ✅ 未引入（Skills/Rules、AI Test、图片反推、Image 类型与媒体、关系图谱、Relations/输出格式、云同步、i18n 均无） |

## 4. 缺口与建议（不阻塞放行）

1. **未填变量的复制结果会留空**（我实测：只填 `姓名` 后，复制结果 `你好 张三，项目 。` —— `{{项目}}` 变成了空）。
   当前行为：**未填 = 空**；建议改成二者之一：① 保留 `{{项目}}` 原样（让人一眼看见没填）② 未填完时禁用「复制结果」并提示"还有 N 个变量未填"。
   → 记入 **P1 建议**（用户可决定是否让实现方补一轮）。
2. bundle 体积继续增长（10B 时 1.25 MB）→ 后续可做代码分割（P1）。
3. 表头的表格/列表视图在移动端未逐一截图（我的验收覆盖了移动端使用视图与触控尺寸）。

## 5. 上线记录（host_manger，2026-09-19 01:07）

```
同步：项目 → /opt/promptmanager（tar→tar，排除 node_modules/dist/data/.git/tmp/docs-shots/docs-design）
权限：chown 服务账号；chmod 排除 node_modules（tsc 执行位保留 ✅）
构建：以服务账号 npm run build → index-UX0755DI.js
重启：systemctl restart promptmanager → active / NRestarts=0 / enabled
验证：生产 js 哈希 == 新构建 ｜ js 含 pm-use-grid ｜ healthz 200 ｜ 未认证 401 ｜ 数据 6 条完好 ｜ 管理员登录 200
生产实拍：默认落「使用视图」；6 张真实卡片；**在生产上点第一条复制 → 剪贴板拿到真实正文**（《上下文将满·会话交接》原文）
依赖：本阶段 package.json 无变化（无需 npm ci）
回滚：项目源码在 /root/greenhouse/projects/promptmanager，`git checkout <旧 commit>` 后重跑同步脚本即可
```

---

# 阶段 11.1 验收（FIX-2：未填变量原样保留）— 结论：**过**，并**已上线**

| 项 | 值 |
| --- | --- |
| 被验收 commit | `68ecb23`（`5f1fb0d` 实现 + `68ecb23` 收尾文档） |
| 规格 | BRIEF **v15**（FR-41e 第 2 条 + AC-33b 新期望），来源＝用户 2026-09-19 决定「**没填写的变量按照原样输出**」 |
| **结论** | **过** → 已同步 `/opt` 并重启上线 |

## 1. 根因确认（我独立对照了服务端行为）

```
只传已填变量：POST /api/prompts/1/render {"values":{"姓名":"张三"}}
  → {"user_prompt":"你好 张三，项目 {{项目}}。","missing":["项目"]}      ← 服务端本来就对（原样保留 + missing）
显式传空串：  {"values":{"姓名":"张三","项目":""}}
  → {"user_prompt":"你好 张三，项目 。","missing":[]}                    ← 旧前端就是这样传的，才把占位符吞掉
```
⇒ **服务端无需改动**（BRIEF §6.5 早已如此），**是前端把空串传下去**——与实现方的判断一致。

## 2. 我独立跑的运行时验收（8768 + 三重自检）

```
自检：healthz 200 ｜ 服务提供 js 哈希 == 磁盘构建（index-Bu9_bfBb.js）｜ 夹具登录 200

AC-33b（v15 新期望）
  未填时预览： "你好 {{姓名}}，项目 {{项目}}。"        未填提示："未填 2 个（预览与复制结果里保留原样占位符）"
  只填「姓名」后预览： "你好 张三，项目 {{项目}}。"
    ✅ 未填变量保留 {{项目}} = true   ❌ 被替换成空（"项目 。"）= false
    未填提示更新为："未填 1 个（…保留原样占位符）"
  点「复制结果」→ 剪贴板 = "你好 张三，项目 {{项目}}。" ｜ 含 {{项目}} = true ｜ **与预览逐字符一致 = true**
  两个都填后 → 预览 "你好 张三，项目 greenhouse。" ｜ 含 {{ = false ｜ 提示 "未填 0 个 · 已填全，可直接复制"

回归：npm test rc=0（**31** 个测试文件，新增 `tests/variables-unfilled-preserved.test.ts`）｜ typecheck:web rc=0
新增证据：`docs/shots/23-vars-dialog.png`、`docs/shots/26-vars-unfilled.png`（未填状态，预览里可见 `{{项目}}`）
收尾：8768 监听 0 ｜ 8767 生产 1（未被误碰）
```

## 3. 我自己的看图结论

对话框（我的截图）：标题「请填写变量值（自动记忆）」· 每个变量一行输入框 · **实时预览**区右上角状态徽标（"变量已全部替换" / 未填时显示未填数）·
底部左侧「未填 0 个 · 已填全，可直接复制」· 右侧 `取消` / **`复制结果`**（主按钮）。无重叠/断词/裁切。

## 4. 上线记录（host_manger，2026-09-19 11:35）

```
同步 tar→tar（排除 node_modules/dist/data/.git/tmp/docs-shots/docs-design）→ chmod 排除 node_modules → 以服务账号 npm run build → 重启
验证：is-active=active / NRestarts=0 / enabled ｜ healthz 200 ｜ 未认证 401 ｜ 生产 js 哈希 == 新构建（index-Bu9_bfBb.js）
      ｜ 数据 6 条完好 ｜ 管理员登录 200
      ｜ **新代码生效判据改用「用户可见文案」**：产物含「保留原样占位符」=1、「已填全，可直接复制」=1
        （⚠️ 我原想用变量名 `filledValues` 判定，但构建会混淆局部标识符 → 该判据无效，已改为文案判定）
生产端到端：真实含变量条目（id=6「故障排查·证据优先」）→ 点「填值后复制」→ 提示"未填 1 个（…保留原样占位符）" →
      填入「现象」→ 预览替换该变量、**剪贴板与预览逐字符一致**（该条只含 1 个变量，故无残留 `{{}}` 属正确；
      多变量场景已在我的独立环境用同一构建验证：未填的保留 `{{项目}}`）
```

## 5. 遗留

1. 生产库中的 prompt 多为**单变量**条目，双变量场景在生产上未逐一复现（已用同构建的独立环境覆盖）。
2. bundle 体积仍偏大（P1：可做代码分割）。

---

# 阶段 12 验收（导航归位 + 信息克制）— 结论：**过**，并**已上线**

| 项 | 值 |
| --- | --- |
| 被验收 commit | `7d92095`（`4c98d63` 实现 + `7d92095` 收尾文档） |
| 规格 | BRIEF **v16**（FR-42a / FR-42b、AC-37~40），来源＝用户 2026-09-19 反馈两条 |
| **结论** | **过** → 已同步 `/opt` 并重启上线 |

## 1. AC-37 使用视图"纯净度" — 过（文本级断言）

```
禁用串计数（使用视图 body.innerText）：DATA_DIR 0 ｜ /api/ 0 ｜ SQLite 0 ｜ 监听 0 ｜ 本次查询 0 ｜ 筛选命中 0
  ｜ 使用统计 0 ｜ API 令牌 0 ｜ 导入 0 ｜ 导出 0 ｜ 渲染不写库 0 ｜ version_no 0 ｜ PUBLIC_ORIGIN/TRUST_PROXY 0
内部 id 形态 `#N`：0 ｜ 状态条 `pm-statusbar` 是否仍存在：false（已从使用视图移除）
→ 判定：✅ 纯净
```

## 2. AC-38 导航归位 — 过（结构断言）

```
使用视图顶栏：P | promptmanager | 使 用 | 管 理 | 亮色 | ad | admin | 登出
  含「使用统计」false ｜「API 令牌」false ｜「导入」false ｜「导出」false ｜「新建」false   ← 全部符合期望
使用视图左栏含管理按钮（新建/重命名/删除）：无                                             ← 符合
管理视图顶栏：P | promptmanager | 使用 | 管理 | 使用统计 | API 令牌 | 导入 / 导出 | 设置 | 亮色 | admin | 登出 | 新建
  含「使用统计/API 令牌/导入/导出/新建/设置」全部 true                                     ← 符合
```

## 3. AC-39 反馈与安全提示未被误删 — 过

```
① 干净页面点复制 → 页面出现「已复制」= true；剪贴板 = "这是一段固定文本，没有变量。"
   与 GET /api/prompts/:id 的 user_prompt 比对：MATCH ✅
② 含变量条目 → 未填提示："未填 2 个（预览与复制结果里保留原样占位符）" ✅
③ 管理视图 → 导入 / 导出 → 注入真实导出文件 → 切 replace → **清空警示出现** →
   点导入 → **二次确认弹窗**：「确认以 replace 模式导入？将清空现有全部 prompt / 文件夹 / 标签 / 版本历史
   随后按文件重建：prompt 1 条 / 文件夹 0 个 / 标签 0 个。此操作不可撤销；建议先导出当前数据留底。取 消 / 清空并导入」
   （我点「取 消」收场，未破坏数据）✅
```

> 说明：首轮探针里这三项一度报 false，经查是**探针自身**的问题——① 那轮先打开了导入弹窗导致后续点击被遮挡；
> ② replace 警示本就要"选到 replace 模式"才出现；③ 导入入口在使用视图已被移除（这正是 AC-38 要的效果），必须在管理视图里验。
> 定向复验（干净页面 / 管理视图）后三项全部通过。

## 4. AC-40 技术信息有落点 — 过

```
管理视图 → 点 pm-settings → pm-about 出现 ✅
关于面板含 "pm.db" = true ｜ 含「备份」= true
面板内容（截图核对）：服务自检（GET /healthz + 重新探测）· 监听 · 认证 · 数据文件 · 备份 · 外部客户端（CLI/MCP）·
                     设置登录口令（含复制按钮）· 界面 · 依赖与许可（指向 docs/dependencies.md）
管理视图另保留：KPI 行（含"本次检索耗时"）与**极简状态条**（"数据文件：pm.db · 共 N 条"）
```

## 5. 回归 — 过

```
npm test rc=0（167 用例 / 31 个测试文件）｜ typecheck:web rc=0 ｜ CDN 外链 0 ｜ 原生表单标签 0
AC-33/34/35/36 快检：默认使用视图 true ｜ 使用视图内 pm-delete-* = 0 ｜ 复制按钮移动端 102×44 ｜ 移动端默认使用视图 true
新 testid：pm-settings / pm-about 均在
```

## 6. 我自己的看图结论

- **使用视图（净化后）**：顶栏只剩 品牌 · 使用/管理 · 主题 · 用户/登出；左栏只有"文件夹/标签"（无解释长句）；主区
  「拿来就用」+ 大搜索 + 排序 + 卡片/表格/列表 + 收藏置顶；卡片 = ★ + 标题 + 正文摘要 + **一行** `v1 变量 2 取用 0 / 09-19 13:11` + `复制 / 填值后复制`；
  底部只有"共 N 条"+分页。**没有状态条、没有内部 id、没有技术串** —— 符合"干净到能一眼用来抄"。
- **设置/关于（我的截图）**：服务自检卡片 + 一张两列信息表，把监听/认证/数据文件/备份/外部客户端/依赖许可全部收拢在此；**是移走不是丢失**。
- **管理视图**：KPI 行 + 表格 + 文件夹/标签带「新建」+ 顶栏管理工具齐备 + 极简状态条。

## 7. 两处可选小建议（不阻塞）

1. 顶栏右侧 `ad`（头像缩写）+ `admin`（名字）**信息重复**，可只留头像 + tooltip。
2. 使用视图搜索框的快捷键提示（`/`、`Ctrl/Cmd+K`）随"信息克制"一并消失，**可发现性下降** → 建议放进 placeholder 的 `title` tooltip 或「设置/关于」。

## 8. 上线记录（host_manger，2026-09-19 13:18）

```
同步 tar→tar → chmod（排除 node_modules）→ 以服务账号 npm run build → 重启
验证：active / NRestarts=0 / enabled ｜ healthz 200 ｜ 未认证 401 ｜ 生产 js 哈希 == 新构建（index-C-LSmDB5.js）
      ｜ 数据 6 条完好 ｜ 管理员登录 200 ｜ 产物含用户可见新文案「设置 / 关于」=1
生产复验（CDP）：默认使用视图 ✅ ｜ 6 张卡片 ｜ **禁用串 0 命中** ｜ 内部 id 0 ｜ 状态条已移除 ✅
```

---

# 阶段 13 验收（取消管理页 + 主题图标 + 修新建自动入库）— 结论：**过**，并**已上线**

| 项 | 值 |
| --- | --- |
| 被验收 commit | `1b2c6e7`（`9e3dfac` 实现 + `1b2c6e7` 收尾） |
| 规格 | BRIEF **v17**（FR-43/44/45、AC-41/42/43、D-21）；**v18** 为验收后的规格对齐（作废旧 AC、对齐 testid） |
| **结论** | **过** → 已同步 `/opt` 并重启上线 |

## 1. AC-43「新建未保存不得入库」— 过（本阶段核心；临时实例与**生产**双重复验）

```
【临时实例】基线 total=1
  点「新建」→ total=1 ✅ 未入库（修复前：立刻变 2 条「未命名 prompt」）
  填标题但不保存 → total=1 ✅
  Esc 关闭 → total=1 ✅
  重新新建 → 填「AC43 已保存测试」→ 点「保存」→ total=2（+1）✅ 且最新条目标题 == 输入值 ✅
【生产实例】基线 total=6（真实库）
  点「新建」→ total=6 ✅ 未入库   ｜   Esc 关闭 → total=6 ✅
```

## 2. AC-42 主题图标三态 — 过

```
清 localStorage 后：colorScheme=（未设，跟随系统）｜ tooltip=「主题：跟随系统（点击切换到亮色）」
点击 1 → light（tooltip：亮色→切换到暗色）｜点击 2 → dark（tooltip：暗色→切换到跟随系统）｜点击 3 → 跟随系统 ✅
刷新后保持上次选择 ✅ ｜ 顶栏不再有「亮色 · 跟随系统」文字标签
```

## 3. AC-41 无管理页 + 顶栏精简 + 表格承载管理 — 过

```
① 旧模式开关：pm-mode-use 不存在 ✅ ｜ pm-mode-manage 不存在 ✅（源码 grep 亦为 0）
② 顶栏文本（使用态）：P promptmanager | 新建 | 更多 | ad admin | 登出
   含 使用统计/API 令牌/导入/导出 = 全部 false ✅ ｜ 主题按钮 pm-theme-toggle 存在 ✅
③ 「更多」菜单内容：导入 / 导出 · 使用统计 · API 令牌 · 文件夹与标签 · 设置 · 已登录：admin · 登出 ✅
   菜单内点「设置」→ pm-about 出现且含 pm.db ✅（同时满足 AC-40）
④ 表格视图行内（生产实测）：每行 [pm-copy-N 复制/填值后复制] [pm-edit-N 编辑] [pm-delete-N 删除] ✅
   卡片视图 pm-delete-* 计数 = 0 ✅（管理动作只在表格里）
```

## 4. 回归 — 过

```
npm test rc=0（**177 用例 / 31 个测试文件**）｜ typecheck:web rc=0 ｜ CDN 0 ｜ 原生表单标签 0
AC-33 复制：剪贴板 = "复验正文，无变量。" ｜ 出现「已复制」 ✅ ｜ 与 API 比对 **MATCH** ✅
AC-33b 未填变量：只填「姓名」→ 预览 `你好 张三，项目 {{项目}}。`（保留 {{项目}} ✅）｜ 剪贴板含 {{项目}} 且与预览逐字符一致 ✅
AC-36 快捷键：`/` 聚焦 pm-search-input ✅ ｜ 双击卡片 → pm-detail ✅（操作条：复制提示词 | 版本历史 | 删除）｜ Esc 关闭 ✅
AC-35 移动端：复制按钮 **102×44** 且可见 ✅ ｜ AC-37 纯净度：禁用串 **0 命中** ✅
```

## 5. 规格对齐（v18，验收后仅改文档）

1. **AC-34 作废**（管理页已取消，本条的模式开关/模式记忆/使用视图内 delete=0 判定全部失效）。
2. **AC-31 部分作废**：`pm-kpi-row` / `pm-filter-row` / `pm-statusbar` 随 FR-43 移除（原属旧管理视图骨架），不再作为判据；
   仍有效：`pm-topnav` / `pm-sidebar` / 编辑器三栏 `pm-panel-*`（同时可见 + `.ant-tabs-tab`=0）。
3. **testid 漂移对齐**：卡片网格容器 `pm-use-grid` → **`pm-use-viewmode` + `pm-view-card`**（行为等价，实现侧命名演进，我实测确认后改规格而不是要求改名）。

## 6. 验收方操作留痕（本轮我的探针失误，如实记录）

首轮探针有 4 项报 false，**全部是我的问题**：
① 用文字匹配找「编辑」→ 实际是**图标按钮**（`title="编辑"`），改按 testid 后命中；
② 直接查 `pm-settings` → 它现在**在「更多」菜单里**（正是 FR-43 要的效果），需先展开菜单；
③ 用 `DispatchKeyEvent` 按 `/` 时**把字符也打进了搜索框** → 列表被过滤成空 → 后续"无卡片/详情打不开"连锁误判；去掉 `text` 参数并清空搜索框后全部通过；
④ 卡片容器 testid 已改名（见 §5-3）。
→ 教训：**探针必须"先开对入口再断言"**，且**快捷键测试不要顺带输入字符**。

## 7. 上线记录（host_manger，2026-09-19 14:35）

```
同步 tar→tar → chmod（排除 node_modules）→ 以服务账号 npm run build（构建提示 chunk 体积偏大，属已知 P1）
重启：active / NRestarts=0 / enabled ｜ healthz 200 ｜ 未认证 401
比对：生产 js 哈希 == 新构建（index-6NZC6tUP.js）｜ 数据 6 条完好 ｜ 管理员登录 200
生产复验（CDP）：AC-43（点新建 total 仍 6）✅ ｜ AC-42 三态 ✅ ｜ 更多菜单 ✅ ｜ 表格行内 pm-edit/pm-delete ✅
```

---

# 阶段 14 验收（分栏视图 + 删除列表视图）— 结论：**过**，并**已上线**

| 项 | 值 |
| --- | --- |
| 被验收 commit | `6c63d38`（`d5fc15b` 实现 + `6c63d38` 收尾） |
| 规格 | BRIEF **v19**（FR-46、D-22、AC-44/45/46） |
| **结论** | **过** → 已同步 `/opt` 并重启上线 |

## 1. AC-44 分栏视图存在且为默认 — 过

```
清空 localStorage 后进入：
  pm-view-split = true ｜ 落地视图 = split（pm-split-list + pm-detail 同时在）
  几何（1600×1000，实测像素）：
    左栏 pm-sidebar   x 16–248   （宽 232）
    中栏 pm-split-list x 271–637  （宽 366）
    右栏 pm-detail     x 673–1567 （宽 894）
    ⇒ 列表右边界 637 ≤ 详情左边界 673 → 左右不重叠 ✅
  pm-split-item 数 = 2 ｜ 恰一条选中：#1 class=pm-split-item-active、底色 rgb(236,239,251)、左侧 3px 色条 ✅
  点第 2 条 → 详情标题 = "带变量的条目"（与条目文本一致）✅
  切「表格」→ pm-view-table=true、localStorage=table → 切回「分栏」→ 结构恢复 ✅
```

## 2. AC-45 视图开关档位与「列表」删除 — 过（含旧值回退）

```
① 档位顺序 = ["分栏","表格","卡片"]（顺序断言，与 BRIEF 逐字一致）✅
② 清空 localStorage 后默认选中 = 分栏，localStorage['pm-view-mode'] = 'split' ✅
③ 切「表格」→ 刷新 → 仍是表格（记忆生效）✅
④ pm-view-list 在 DOM 中不存在；源码 grep -rc 'pm-view-list' web/src = 0 ✅
⑤ 手工写入旧值 'list' → 刷新 → 落回分栏、页面非空白、控制台无错误/警告 ✅
```

## 3. AC-46 分栏右栏复用详情面能力 — 过

```
右栏存在且可点：pm-detail-copy / pm-detail-version-jump / pm-detail-delete / pm-detail-edit / pm-detail-fullscreen = 全 true ✅
① 变量填值（分栏右栏内联）：只填「姓名」→ 点「渲染」→ 渲染结果 = 「你好 张三，请做 {{任务}}。」
   ⇒ 已填生效 ✅ + 未填变量 {{任务}} 原样保留 ✅（FR-41e 硬条款在分栏下成立）
② 复制路径（带变量条目）：点「复制提示词」→ 弹出填值对话框（正确行为）→ 对话框预览保留 {{任务}} ✅
   → 填「李四」→ 确认 → 剪贴板 = "你好 李四，请做 {{任务}}。"，含 {{任务}} 且与对话框预览逐字符一致 ✅
③ 点「删除」→ 二次确认层出现（文案「删除这条 prompt？删除后版本历史一并移除，不可恢复。」）→ 取消 → total 2→2 未删 ✅
```

## 4. 回归 — 过

```
npm test rc=0（**34 个测试文件**，阶段 13 为 31 → 只增不减）｜ typecheck:web rc=0
CDN 外链 0 ｜ 原生表单标签 0 ｜ 控制台错误/警告：无
AC-43 新建不入库：total 2 → 打开编辑器 2 → Esc 后 2 ✅
AC-41 顶栏无 使用统计/API 令牌/导入/导出/管理 ｜ pm-mode-use / pm-mode-manage 均不存在 ✅
AC-42 主题三态：light → dark → 跟随系统 ✅
AC-37 纯净度：禁用串 0 命中 ✅ ｜ AC-36 「/」→ 聚焦 pm-search-input ✅
AC-40 「⋯更多」= 导入/导出 · 使用统计 · API 令牌 · 文件夹与标签 · 设置 · 登录信息 · 登出 ✅
AC-35 移动端（390×844）：列表可见、详情隐藏（单栏降级 ✅）、无横向滚动 ✅
```

## 5. 上线记录（host_manger，2026-09-19 16:0x）

```
同步 tar→tar → chmod → 以服务账号 npm run build（构建提示 chunk 体积偏大，属已知 P1）
重启：active / NRestarts=0 / enabled ｜ healthz 200 ｜ 未认证 401
比对：生产 js 哈希 == 新构建（index-DTJZSx1w.js）｜ 依赖变化 0 行 ｜ 数据 6 条完好 ｜ 管理员登录 200
生产复验（CDP，真实库 6 条）：
  档位 = 分栏 / 表格 / 卡片；全新浏览器落地 = 分栏（split+list+detail 齐）
  几何：列表 271–637 ｜ 详情 673–1552（不重叠）✅
  点第 2 条「故障排查 · 证据优先」→ 详情标题跟随 ✅
  ⚠️ 旧记忆值行为：记忆=card → 卡片；记忆=table → 表格；记忆=list → 分栏（按 BRIEF 只回退 list）
     ⇒ 老客户端若残留 'card'（旧版本首次加载就会写入），落地仍是卡片，需手动点一次「分栏」
```

## 6. 验收方操作留痕（本轮我的失误，如实记录）

1. **脚本语法错误**：CDP 探针 mjs 有 4 行结尾多了一个反引号（`)()` + 反引号 + `);`）→ 模板字符串未闭合，`node --check` 报 "missing ) after argument list"，
   **整个脚本一行断言都没跑**（只有静态检查跑了）。修法：4 处删多余反引号（其中 1 处还需再删一个 `)`）。
   ⇒ 教训已回写技能：**探针脚本上机前先 `node --check`（本地就有 node）**，别把语法错误带到远端的验收里。
2. **读错元素**：读「渲染结果」时我取的是 `markdown-preview`（那是"当前字段 · 预览"，不随变量填值变化）→ 误判"填值没生效"；
   实际右栏另有 **「渲染结果 · 用户提示词 / 系统提示词」** 区块，读到 `你好 张三，请做 {{任务}}。` 后确认正常。
   ⇒ 教训：**先枚举 `[data-testid]` 再断言**，别按名字猜元素（与阶段 13 的"先开对入口再断言"同源）。
3. 复制断言：带变量条目点「复制提示词」**会弹填值对话框**（不是直接复制），我最初按"直接复制"预期写断言 → 误判剪贴板为空。

---

# 阶段 15 验收（顶栏重排 / 更多菜单 / 文件夹层级 / 标签胶囊云）— 结论：**过**，并**已上线**

| 项 | 值 |
| --- | --- |
| 被验收 commit | `5574981`（`f3db85a` 实现 + `5574981` 收尾） |
| 规格 | BRIEF **v20**（FR-47~FR-50、D-23/D-24、AC-47~AC-50） |
| **结论** | **过** → 已同步 `/opt` 并重启上线 |

## 1. AC-47 顶栏四块与顺序 + 无用户信息 — 过

```
顶栏四块 x 坐标（临时实例 / 生产一致）：header-new=1303 < header-more=1386 < pm-theme-toggle=1469 < header-logout=1505  ✅ 严格升序
四者均可见且可点（width>0、offsetParent!=null）✅
pm-topnav 文本 = "P promptmanager 新建 更多 登出" → 不含 admin ✅（登录用户信息已移入 ⋯更多）
```

## 2. AC-48 「⋯更多」子项顺序与删减 — 过

```
菜单项（按 DOM 顺序）: ["使用统计","API 令牌","导入 / 导出","关于","已登录：admin","登出"] → 与 BRIEF 逐项完全一致 ✅（临时实例与生产均一致）
含「文件夹与标签」: false ✅（DOM 菜单里已无该入口）
pm-settings 文本 = "关于" ✅（testid 未变，AC-40 仍可用）
「已登录：admin」项: class 含 ant-dropdown-menu-item-disabled、aria-disabled=true、颜色 rgb(154,161,171) → 实测点击后 /api/me 仍 200、不触发任何动作 ✅
```

## 3. AC-49 文件夹区新建与层级 — 过

```
① folder-create 可见可点 → 点「+」→ 填「AC49 新文件夹」→ 确认 → GET /api/folders 3 → 4（+1）✅ 且界面出现该名
② 展开/收起: 点 pm-folder-toggle-1 → 子项「会话管理」offsetParent=null（隐藏）✅；再点 → 恢复可见 ✅
③ 层级缩进: 父「Agent管理」left=75 → 子「会话管理」left=91（**+16px** ≥ 12px）✅；生产实测 25 → 41（同为 +16px）✅
④ 行内计数: 「Agent管理 1」「会话管理 0」「运维 0」；sidebar 内 .ant-badge = **0**（无彩色徽标）✅
⑤ 悬浮行 → pm-folder-add-child / pm-folder-rename / pm-folder-delete 出现 ✅
   · 新建子文件夹: 悬浮父行 → add-child → 弹窗 → 建「AC49子文件夹」→ folders +1 且 **parent_id=1**（正确落成子级）✅
   · 重命名: 点 rename → 弹窗标题「重命名文件夹」、输入框**预填当前名「运维」**✅ → 取消关闭 ✅
   · 删除: 点 delete → 确认层「删除文件夹「运维」？删除后不可恢复。」✅ → 取消后 folders 4 → 4（未删）✅
```

## 4. AC-50 标签胶囊云 — 过

```
① pm-tag-cloud 存在，pm-tag-chip 数 = 标签总数（夹具 6/6；生产 14 个）✅
② 胶囊文本: #交接 | #备份 | #巡检 | #排障 | #校验 | #派活（生产: #115 #上下文 #交接 …）→ 全部以 # 开头 ✅
③ 标签区内 .ant-badge = 0（无计数徽标）✅（生产同样为 0）
④ 流式换行: offsetTop 不同值 = 2（夹具 6 标签）/ **5 行**（生产 14 标签）✅；scrollWidth <= clientWidth（无横向滚动）✅；胶囊高 26px（24–28 区间内）✅
⑤ 点胶囊「#交接」→ 列表条目 2 → 1（筛选生效）；再点 → 恢复 2 ✅
```

## 5. 回归 — 过

```
npm test: 185 tests / 185 pass / 0 fail（阶段 14 为 181 → 只增不减）｜ typecheck:web rc=0
CDN 外链 0 ｜ 原生表单标签 0 ｜ CDP 期间未捕获异常 0
AC-45 档位顺序 ["分栏","表格","卡片"] ✅ ｜ AC-44 三栏几何 列表 271–637 / 详情 673–1567（不重叠）✅
AC-43 新建不入库 2→2→2 ✅ ｜ AC-42 主题三态 light→dark→跟随系统 ✅ ｜ AC-37 纯净度 0 命中 ✅
AC-36 「/」→ pm-search-input ✅ ｜ AC-33b 未填变量保留（张三生效 + {{任务}} 原样）✅
AC-35 移动端单栏（list=true / detail=false，无横向滚动）✅
```

## 6. 上线记录（host_manger，2026-09-19 18:0x）

```
同步 → 服务账号 npm run build → 重启：active / NRestarts=0 / enabled ｜ healthz 200 ｜ 未认证 401
比对：生产 js 哈希 == 新构建（index-2L3r0B_S.js）｜ 依赖变化 0 行 ｜ 数据 6 条完好 ｜ 管理员登录 200
生产复验（CDP，真实库）：顶栏四块 1303/1386/1469/1505 ✅ ｜ 更多菜单项序完全一致 ✅
  标签 14 个胶囊跨 5 行、badge=0 ✅ ｜ 文件夹 Agent管理 3@25 / 会话管理 1@41 / 运维 3@25 ✅
```

## 7. 观察点（不影响验收结论）

1. **一句过期注释**：`web/src/components/Workspace.tsx` 第 73 行仍写「…文件夹与标签 / 设置 收进顶栏 `⋯更多`」——该入口已按 FR-48 删除，注释与现状不符（**仅注释**，不影响行为）。建议下次顺手改掉。
2. 验收方（我）本轮首个探针脚本用的是**阶段 14 之前的 antd Tree 选择器**（`.ant-tree-treenode`），本阶段实现已换成 `pm-folder-row-*` / `pm-folder-toggle-*` 结构 → 全部断言落空，**改为先枚举 `[data-testid]` 再断言后通过**（与阶段 14 教训同源，已固化在 `acceptance-gate.md` §0）。
3. 验收方脚本自身错误 3 次（嵌套模板里多余的 `)` / 反引号）→ 靠**本地 `node --check` + 逐轮修复**拦住；最终版改成「单层调用 `q(label, expr)`」写法，从根上避免嵌套。

---

# 阶段 16 验收（Logo/关于页/删装饰块/文件夹删除 FIX/编辑页返回/右栏排序/收藏/主题图标）— 结论：**过**，并**已上线**

| 项 | 值 |
| --- | --- |
| 被验收 commit | `f74ede5`（`5a5e1d8` 实现 + `f74ede5` 收尾） |
| 规格 | BRIEF **v21**（FR-51~FR-58、AC-51~AC-58） |
| **结论** | **过** → 已同步 `/opt` 并重启上线 |

> 本轮按新规矩：**「能不能点」一律用真鼠标事件**（`Input.dispatchMouseEvent` 的 mouseMoved → mousePressed → mouseReleased），不再用 JS `.click()`。

## 1. AC-54（P0 bug）非空文件夹删除不再静默失败 — 过

```
【非空文件夹 Agent管理（含 1 子文件夹）】真鼠标：hover 行 → 点删除图标 → 弹窗 → 鼠标移到弹窗上（弹窗仍在、按钮可点）
  → 点「删除」→ **出现可见错误反馈**：没能删除「Agent管理」：该文件夹还有 1 个子文件夹。请先清空子文件夹 / 把其中的 prompt 移走，再删除。
  → 文件夹行数 2 → 2（未删）✅（服务端 409 语义正确，前端不再吞掉）
  【实现选择】删除按钮未 disabled，而是"点了给明确原因"（BRIEF 允许二选一）
【空文件夹 运维】真鼠标：hover → 点删除 → 点确认 → 行数 3 → 2 ✅ + 提示「已删除文件夹」✅（成功路径未回归）
【浮层稳定性】鼠标从行移到弹窗上：弹窗仍在 DOM、可见、按钮可点（不再被 hover 卸载）
```

## 2. AC-51 Logo 更名 + 点回主页 — 过

```
顶栏文本 = "P PromptManager 新建 更多 登出"（含 PromptManager ✅ / 不含全小写 promptmanager ✅）
logo 元素 cursor=pointer（可点）
非主页状态：切「表格」+ 搜索框输入 "zzz" + 选中标签筛选 → items=0
真鼠标点 logo → view=split ✅ ｜ 搜索框清空 ✅ ｜ 列表恢复 2 条 ✅（复位视图/搜索/筛选/选中）
```

## 3. AC-52 「关于」页重构 — 过

```
① 不含 BRIEF / AC- / 阶段 字样 ✅（0 命中）
② 无重复 label：版本 / 状态 / 访问地址 / 数据文件 / 备份方式（逐项唯一）✅
③ 分区：Collapse 3 个（服务 / 使用 / 维护）+ Descriptions 1 组 ✅（≥3）
④ 内容示例：「PromptManager 后端在线 版本 0.1.0 重新探测｜服务：版本/状态/访问地址/数据文件/备份方式｜使用：新建/编辑/复制/变量填值…」
```

## 4. AC-53 「拿来就用」装饰块已删 — 过

```
DOM 中文本等于「拿来就用」的元素数 = 0 ✅（生产同样为 0）
工具栏到列表首行的垂直间距 = 26px（此前该装饰块独占 25px + 12px 下边距，纯占屏已消除）
```

## 5. AC-55 编辑页返回详情 — 过

```
从分栏选中条目（详情标题「乙条目」）→ 点「去编辑」→ 编辑态顶部有两个入口：「返回列表」与 `editor-back`「返回详情」
真鼠标点「返回详情」→ `pm-detail` 重新出现且标题仍为「乙条目」✅
```

## 6. AC-56 编辑页右栏顺序（预览 → 变量 → 版本）— 过

```
右栏模块 top（实测，严格升序）：Markdown 预览 77 ＜ 变量填值 315 ＜ 版本历史 544 ✅
容器级复核：markdown-preview 161 ＜ pm-panel-variables 306 ＜ pm-version-views 582 ✅
```

## 7. AC-57 收藏入口显性化（四屏 + 真鼠标）— 过

```
四屏均存在常驻可点星标（`pm-fav-btn` / 表格 `pm-fav-table-N` / 详情 `pm-fav-*` / 编辑 `pm-fav-editor-N`）：
  · 元素为 <button>、`aria-label="收藏"`、`cursor=pointer`、热区 24×24、未 hover 也可见 ✅
真鼠标点「表格行内」星标：aria-label 收藏 → **取消收藏** ✅
刷新页面后仍为「取消收藏」✅（状态与 API 一致、持久）
生产实测：分栏列表 6 个星标、详情栏 1 个 ✅
```

## 8. AC-58 主题「跟随系统」图标 — 过

```
跟随系统：{sun, moon} 两个图标 + title「主题：跟随系统（点击切换到亮色）」✅（不再是 anticon-desktop）
亮色：{sun} ｜ 暗色：{moon} ✅
```

## 9. 回归 — 过

```
npm test：192 tests / 192 pass / 0 fail（阶段 15 为 185 → 只增不减）｜ typecheck:web rc=0
AC-47 顶栏四块 x 坐标 1303 ＜ 1386 ＜ 1469 ＜ 1505 ✅（生产一致）
AC-44 分栏几何（生产）：侧栏 16–248 ｜ 列表 271–637 ｜ 详情 673–1552（不重叠）✅
AC-50 标签胶囊（生产）：14 个胶囊跨 5 行、计数徽标 0 ✅ ｜ AC-37 纯净度 0 命中 ✅
CDP 期间未捕获异常 0 ✅
```

## 10. 上线记录（2026-09-19 19:2x）

```
同步 → 构建 → 重启：active / NRestarts=0 / enabled ｜ healthz 200 ｜ 未认证 401
比对：生产 js 哈希 == 新构建（index-B8W4YaA1.js）｜ 依赖变化 0 行 ｜ 数据 6 条完好 ｜ 管理员登录 200
生产复验（CDP）：顶栏 P PromptManager 新建 更多 登出 ｜ 关于页零内部引用 + 3 分区 ｜ 空态（搜不到）文案在、列表 0 项 ✅
```

## 11. 验收方记录（我的失误）

1. 首个探针里的 `api()`/`totalOf()`（浏览器内 fetch）**两次返回 undefined**（`Runtime.evaluate Invalid parameters`）→ 改用 **DOM 断言**（数文件夹行数、读星标 `aria-label`）后全部通过。
   教训：**验收探针要优先用「页面可见状态」而不是浏览器内 fetch**——少一层失败面，且更贴近用户看到的。
2. 探针曾把 `after` 写进自己的初始化表达式（ReferenceError）→ 中断后续断言；`node --check` 查不出运行期错误，**跑完要检查输出是否有断点**。
3. 两处断言因**视图状态没切回分栏**而落空（AC-44/AC-50 在编辑器态取不到）→ 教训：**探针每段开始先显式切到目标视图**，不要依赖上一段遗留状态。

---

# 阶段 17 验收（品牌图形全站统一：同一枚图标·多尺寸）— 结论：**过**，并**已上线**

| 项 | 值 |
| --- | --- |
| 被验收 commit | `d9b6f13`（`49e5b32` 实现 + `d9b6f13` 收尾） |
| 规格 | BRIEF **v22**（FR-59 / AC-59 / D-26） |
| **结论** | **过** → 已同步 `/opt` 并重启上线 |

## 1. AC-59 ① favicon 家族 — 过

```
临时实例（8768）与生产（8767）一致：
  /favicon.svg           200  image/svg+xml
  /favicon.ico           200  image/vnd.microsoft.icon
  /apple-touch-icon.png  200  image/png
  /icon-192.png          200  image/png
  /icon-512.png          200  image/png
浏览器识别到的 link：/favicon.svg , /favicon.ico , /apple-touch-icon.png
```

## 2. AC-59 ② 网页头与标题 — 过

```
web/index.html：
  7:  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  8:  <link rel="icon" href="/favicon.ico" sizes="any" />
  9:  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  11: <meta name="theme-color" content="#5e6ad2" />
  12: <title>PromptManager</title>
生产实测：curl / 的 title = <title>PromptManager</title>；icon link 计数 = 3
```

## 3. AC-59 ③ 顶栏品牌 mark — 过

```
mark = <img src="/promptmanager-icon.svg">，渲染尺寸 **26×26**（实测；临时实例与生产一致）
顶栏文本 = "PromptManager 新建 更多 登出"
亮色 / 暗色主题各截图一张（02-mark-light.png / 03-mark-dark.png）——矢量图两态均清晰
```

## 4. AC-59 ④ 三处装饰位 — 过

```
登录页：唯一图片 = /promptmanager-96.png，实测 96×96，aria-hidden="true"；真鼠标点击 → URL 未变、无弹窗、无跳转 ✅
空态（库中 0 条 prompt）：/promptmanager-72.png 实测 72×72，aria-hidden="true"，文案「还没有可用的 prompt」；
        真鼠标点击 → 无任何动作 ✅；有数据时该图**不出现**（2 条数据时可见图片只剩顶栏 26px）✅
关于页：/promptmanager-48.png 实测 48×48，aria-hidden="true" ✅
```

## 5. AC-59 ⑤ 干净度与体积 — 过

```
grep -rn "folder-art|source-1254" web/ dist/ → 0 行 ✅（插画方案未被引用）
web/public 体积：96.png 7KB ｜ 72.png 4KB ｜ 48.png 3KB ｜ icon-192 21KB ｜ icon-512 101KB ｜ svg <1KB → 全部 ≤250KB ✅
```

## 6. 回归 — 过

```
npm test：196 tests / 196 pass / 0 fail（阶段 16 为 192 → 只增不减）｜ typecheck:web rc=0
AC-44 分栏几何 271–637 / 673–1552 ✅ ｜ AC-51 顶栏文本 ✅ ｜ AC-57 分栏星标在 ✅
AC-50 标签胶囊 chips 2 / badges 0 ✅ ｜ AC-37 纯净度 0 命中 ✅ ｜ CDP 未捕获异常 0 ✅
```

## 7. 上线记录（2026-09-19 19:5x）

```
同步 → 构建 → 重启：active / NRestarts=0 / enabled ｜ healthz 200 ｜ 未认证 401
比对：生产 js 哈希 == 新构建（index-DXalHPn8.js）｜ 依赖变化 0 行 ｜ 数据 6 条完好 ｜ 管理员登录 200
生产复验：favicon 四端点 200 + Content-Type 正确 ｜ <title>PromptManager</title> ｜ 登录页 96 图标 ｜ 顶栏 mark 26×26
```

## 8. 验收方记录（我的失误）

1. **空态测错对象**：BRIEF 的"列表空态"指**库中一条 prompt 都没有**；我第一次测的是"搜索无结果"（该状态本就没有 72 图）→ 改用**空库实例**复测才验到真实行为。教训：先对齐数据前提再断言。
2. **纯净度假阳性**：「关于」弹窗未关闭，弹窗内 SQLite 字样被算成页面噪声 → 报错；关掉后重测 0 命中。教训：断言全局文本前先确认无残留浮层。
3. 统计体积时用了远端不存在的 bc（命令报错→显示 0KB）→ 改用字节数核算。

---

# 阶段 18 验收（收尾清理 + 构建体积瘦身 + 编辑器全屏）— 结论：**过**，并**已上线**

| 项 | 值 |
| --- | --- |
| 被验收 commit | `55712c9`（阶段 18 共 6 次提交：`6852a41` 清理 → `f112836` 瘦身 → `8873373` 全屏 → `5161273`/`b32dacc`/`55712c9` 收尾） |
| 规格 | BRIEF **v24**（FR-60 / FR-61 / FR-62，AC-60 / AC-61 / AC-62） |
| **结论** | **过** → 已同步 `/opt` 并重启上线 |

## 1. AC-60 注释/文案漂移清理 — 过

```
① grep -rn "文件夹与标签" web/src                  → 0 ✅
② grep -n  "使用视图|管理视图" web/src/styles/app.css → 0 ✅
③ grep -rn "不是 promptmanager" web/src            → 0 ✅（报错文案已用品牌大小写）
③' grep -c "app: 'promptmanager'" web/src/pure.ts  → 1 ✅（**契约值未被改动**）
④ 其余已废止概念在 web/src + src 的命中全为 0：pm-mode-use / pm-mode-manage / 模式记忆 / 列表视图 / pm-view-list / pm-kpi-row / pm-statusbar ✅
⑤ 回归全绿（本项未改行为）✅
```

## 2. AC-61 构建体积 — 过（1,265 KB → 467 KB）

```
前后对照（未压缩 / gzip）：
  阶段 17：index-*.js 1,265 KB（gzip 400 KB）→ **每次构建都报 500 KB 告警**
  阶段 18：index-BML-CLyM.js        45.59 KB (gzip  14.73)   ← 入口 chunk
           app-lazy-DPEfzwma.js    128.91 KB (gzip  42.02)   ← 懒加载集合
           vendor-rc-DKBEOiQR.js   290.84 KB (gzip  96.09)
           vendor-react-q4Qav0ib.js 344.79 KB (gzip 108.47)
           vendor-antd-BGglqmf3.js  **467.33 KB (gzip 140.07)** ← 最大 chunk ≤ 500 KB ✅
           style-*.css 7.56 KB ｜ rolldown-runtime 0.71 KB
  构建告警 "larger than" 输出条数 = **0** ✅（告警消失）｜ dist/web/index.html 外链 = 0 ✅（仍无 CDN）
  懒加载落地：新增 web/src/lazy.ts；六个重组件改动态 import
④ 懒加载六处逐一点开：编辑器 ✅（编辑态右栏含 MD 预览 + 版本 diff）｜使用统计抽屉 ✅｜API 令牌抽屉 ✅｜导入导出对话框 ✅
  （探针中两处"入口未找到"是我按旧 testid 找菜单项所致，改按文本匹配后即打开成功——非实现问题）
测试：**npm test 214 / 214 pass**（阶段 17 为 196 → 只增不减，含它新增的体积预算测试）｜ typecheck:web rc=0
备注：dsh 自建的体积预算测试把预算写成「开工前基线 + 已对账增量（分包边界 +0.4 KB、FR-62 新功能 +1.4 KB）」，
     并注明"只做 FR-61 时实测 398,567 B < 基线"（瘦身本身确实降体积）；**BRIEF.md / STANDARDS.md 未被改动**（diff 为空 ✅）。
```

## 3. AC-62 编辑器全屏 — 过（临时实例 + **生产** 双验，全部真鼠标）

```
① editor-fullscreen 存在、可见（26×26）✅
② 真鼠标点击 → data-fullscreen="true" 且 **document.fullscreenElement 非空**（真·Fullscreen API 生效）
   外壳三者 offsetParent === null：topnav ✅ sidebar ✅ split-list ✅
   编辑器宽 / 视口宽 = 1600 / 1600 = **1.00**（≥ 0.95）✅
③ 贴入 **5,006 字**大正文 → 编辑区高 / 视口高 = 720 / 1000 = **0.72**（≥ 0.70）✅
   编辑区可滚（scrollHeight > clientHeight）✅；滚动编辑区后 window.scrollY 仍为 0（**独立滚动**）✅；无横向滚动 ✅
④ Esc 退出 → 外壳恢复可见 ✅、data-fullscreen 移除 ✅、**正文长度仍 5,006 ✅（未丢内容）**、仍在编辑器（未误触返回）✅
⑤ 按钮切换：再点进入（true/true）→ 再点退出（null/false、外壳恢复）✅
   pm-detail-fullscreen 仍在 ✅（详情面预览全屏与编辑全屏互不顶替）
【生产复验】真实 6 条数据、真浏览器：data-fullscreen=true ｜ fullscreenElement=true ｜ 外壳隐藏 ｜ 编辑器宽比 1.00 ｜ **编辑区高比 0.72** ✅
```

## 4. 回归 — 过

```
AC-44 分栏几何 271–637 / 673–1567 ✅ ｜ AC-51 顶栏文本「PromptManager 新建 更多 登出」✅ ｜ AC-59 顶栏 mark 26 ✅
AC-57 分栏星标 ✅ ｜ AC-50 标签胶囊 chips 2 / badges 0 ✅ ｜ AC-37 纯净度 0 命中 ✅ ｜ CDP 未捕获异常 0 ✅
懒加载后首屏正常（无空白/闪烁）；生产 favicon.svg 200 image/svg+xml、favicon.ico 200、`<title>PromptManager</title>` ✅
```

## 5. 上线记录（2026-09-19 22:5x）

```
同步 → 构建（多 chunk）→ 重启：active / NRestarts=0 / enabled ｜ healthz 200 ｜ 未认证 401 ｜ 数据 prompts=6 完好 ｜ 登录 200
生产 chunk 集合与构建产物一致（index-BML-CLyM / app-lazy-DPEfzwma / vendor-antd-BGglqmf3 / vendor-rc-DKBEOiQR / vendor-react-q4Qav0ib / rolldown-runtime-hePW80VL）
生产最大 js = 467,335 B（= 构建出的 vendor-antd 体积，**≤ 500 KB**）✅
```

## 6. 验收方记录（我的失误与工具缺口）

1. **部署脚本的哈希比对已过时**：它按"单 chunk"取第一个 `assets/*.js` 比对，多 chunk 后误报"一致=否"；实际生产 chunk 集合与产物完全一致（已用集合比对 + 最大体积核对确认）。
   → 已改写为**多 chunk 集合比对**并存为 `projects/greenhouse/scripts/pm-deploy.sh`（下次直接用这版）。
2. 探针里写了一行非法 JS（`{width=undefined}={...}` 解构误写），被本地 `node --check` 拦下（未上机）。
3. 懒加载自证时按**旧 testid**找菜单项，两处"入口未找到"；改按文本匹配后全部打开成功（非实现问题）。

---

# 阶段 19 验收（编辑器全屏形态纠正 + 版本 diff 尾换行 + 复制兜底）— 结论：**过**，并**已同步到测试环境（8767）**

| 项 | 值 |
| --- | --- |
| 被验收 commit | `dc7198f`（`7665228` 19B diff → `0a4c118` 19C 复制 → `9613acb` 19A 全屏 → `c6f94f6` / `dc7198f` 收尾） |
| 规格 | BRIEF **v25**（FR-63 / FR-64 / FR-65；AC-63 / AC-64 / AC-65） |
| **结论** | **过** → 已同步到**测试环境**（8767）并重启 |

> 本轮验收按新规矩：**依赖安全上下文的能力（剪贴板）一律用「内网 IP」访问**（不再用 127.0.0.1，避免掩盖问题）。

## 1. AC-63 编辑器全屏（应用内：只藏内部左栏 + 1:1 平分）— 过

```
① 进全屏前 document.fullscreenElement === null（已不再调用 Fullscreen API）✅
② 真鼠标点 editor-fullscreen（按钮「全屏展开」/ anticon-expand）→
   · [data-testid="editor-list"] offsetParent === null（内部左栏已隐藏）✅
   · 两栏真实宽度 [776, 776] → 比值 **1.000**（要求 0.95–1.05）✅
   · document.fullscreenElement 仍为 null ✅
   · 按钮切换为「退出全屏」+ anticon-compress（与详情页同款）✅
③ Esc → editor-list 恢复可见、仍在编辑器（未误触返回）、**正文长度未丢** ✅
④ 按钮双向切换（连点 4 次实测）：展开→退出→展开→退出 状态均正确、fsEl 恒为 false ✅
⑤ 详情面 pm-detail-fullscreen 仍在且可用（两者互不顶替）✅
【测试环境同样复验】全屏后 listHidden=true、宽度 [776,776]、ratio 1.000、按钮「退出全屏」✅
（进全屏前三栏宽度实测 [300, 856, 380] → 全屏后 [776, 776]，左栏空间全部让给了编辑区与右栏）
```

## 2. AC-64 版本 diff 不再把「未改动的备注」显示成变更 — 过（正反例都验）

```
【反例前置】修复前：仅"备注尾部换行"不同就产生 `-N / \ No newline at end of file / +N`（相同文本被判变更）
【本轮正例】v1 备注 "N" vs v2 备注 "N\n" → /api/prompts/:id/diff 返回：
    ===================================================================
    --- v1
    +++ v2
   （**无任何 hunk**）→ 判定：✅ 无假变更
【反例回归】v2 "N\n" vs v3 "N2" → 正确产出 @@ -5,4 +5,4 @@ 且含 `-N` / `+N2` ✅（真变更仍能检出）
【UI 侧】测试环境选「备注尾换行测试」→ 「对比版本」diff 中 [notes] 只作为上下文出现，**无 notes 变更行** ✅
【测试环境 API 复验】同一对版本（仅尾换行不同）→ 无 hunk ✅
```

## 3. AC-65 复制在内网 HTTP 下可用 — 过（**全程用内网 IP 访问**）

```
【环境确认】http://192.168.0.228:8768 → isSecureContext=false、navigator.clipboard=undefined（正是用户环境）
【开发实例】无变量条目：真鼠标点 pm-detail-copy → 提示「已复制提示词」、**无**「浏览器拒绝了剪贴板访问」；
            变量面板：填值→渲染→点复制 → 提示「已复制用户提示词」；用安全页面读回剪贴板 = 「你好 填值X。」（与渲染结果一致）✅
【测试环境】http://192.168.0.228:8767 同法复验：提示「已复制提示词」、无拒绝文案、**剪贴板读回 = 「正文。」**（与该条 user_prompt 一致）✅
【实现统一性】`grep -rn "navigator.clipboard" web/src` → **仅 1 处**（web/src/clipboard.ts）；`VariablePanel.tsx` 直连数 = **0** ✅
```

## 4. 回归 — 过

```
npm test：**223 tests / 223 pass / 0 fail**（阶段 18 为 214 → 只增不减，含新增的 clipboard-fallback / diff-notes-newline / stage19-fullscreen 三组用例）
typecheck:web rc=0 ｜ 构建告警 "larger than" 条数 = **0** ｜ 最大 chunk = **467,320 B**（≤500KB 预算未破）
AC-44 分栏几何 271–637 / 673–1567 ✅ ｜ AC-51 顶栏「PromptManager 新建 更多 登出」✅ ｜ AC-57 星标在 ✅ ｜ AC-37 纯净度 0 命中 ✅ ｜ CDP 未捕获异常 0 ✅
```

## 5. 同步到测试环境（8767）记录（2026-09-20 01:0x）

```
同步 → 构建 → 重启：active / NRestarts=0 / enabled ｜ healthz 200 ｜ 未认证 401 ｜ 数据 prompts=6 ｜ 登录 200
chunk 集合比对：生产提供的 6 个 chunk 与构建产物**集合一致**，且**逐一字节数相同**
  app-lazy-Do8GOT-U.js 129551 ｜ index-BPz0M5bb.js 44327 ｜ rolldown-runtime-hePW80VL.js 716
  vendor-antd-Dv-mN7eq.js 467320 ｜ vendor-rc-PTcEyWTY.js 290847 ｜ vendor-react-D1Tc2LPt.js 342291
测试环境三条复验：全屏 1:1 ✅ ｜ diff 无 notes 假变更 ✅ ｜ 内网 IP 复制成功且剪贴板一致 ✅
```

## 6. 验收方记录（我的失误与工具缺口）

1. **探针选错条目**：测试环境复验复制时，我按标题找"阶段19验收测试"，但该条已被同一脚本重命名为"备注尾换行测试"→ 回退选到列表第一条（**含变量**）→ 点「复制提示词」是**弹填值对话框**而不是复制，于是"没有提示、剪贴板空"。**非实现问题**，改选无变量条目后即通过。
   → 教训：**复制类验收必须先确认"该条是否含变量"**（含变量 = 弹框路径，不含 = 直接复制路径），两条路径要分别验。
2. **部署脚本仍是单 chunk 比对**：本次同步时又打印了一次「一致=否」误报（实际 chunk 集合与字节数完全一致）。
   → 已把 `projects/greenhouse/scripts/pm-deploy.sh` 里那行改为**打印生产 chunk 集合**（多 chunk 下不再误报）。
3. 坐标助手 `box()` 在测试环境那次调用返回 undefined，但复制确实发生（有提示 + 剪贴板双重证据）；**结论仍由两个独立信号支撑**，不依赖该坐标系。

---

# 阶段 20 验收（详情页去冗余头部 + ⋯更多「修改密码」）— 结论：**过**，并**已同步到测试环境（8767）**

| 项 | 值 |
| --- | --- |
| 被验收 commit | `bce953d`（`feb83aa` 20B 后端 → `aad69cd` 20C 前端 → `a7452f5` 20D 自检 → `651ab8d` / `bce953d` 收尾） |
| 规格 | BRIEF **v27**（FR-66 / FR-67；AC-66 / AC-67；FR-48 菜单项序已被 v27 修订） |
| **结论** | **过** → 已同步到**测试环境**（8767）并重启 |

## 1. AC-66 详情页头部去冗余 — 过

```
① [data-testid="pm-detail"] 内**不存在**文本「当前字段」（`innerText.includes('当前字段') === false`）✅
   说明标签「在服务端完成渲染」也**已消失**（`innerHTML.includes('服务端完成渲染') === false`）✅
② 详情面其余控件仍在：字段页签（用户提示词 / 系统提示词 / 备注）、`pm-detail-plain`（显示纯文本）、`pm-detail-fullscreen` ✅
③ 详情面内**仍有 2 个 `ant-select`** —— 已查明是**版本历史的「对比 v1 → v1」两个选择器**（width 110px），与本次删除的头部无关 ✅
④ 间距：dsh 实测「页签行底部 → 正文区顶部」**52px → 8px**（减少 44px ≥ 30px）；验收方在改后版本无法复量"改前"值，
   故以**更硬的 DOM 层证据**为准：整行控件（Select + 说明标签）在 DOM 中已不存在 ✅
⑤ 编辑器页不受影响：Markdown 预览卡片里的字段下拉仍有**3 个选项**（用户提示词 / 系统提示词 / 备注），
   选「系统提示词」后预览内容随之切换为该系统侧文本 ✅
【测试环境同样复验】当前字段=false、说明标签=false ✅
```

## 2. AC-67「修改密码」接口层 — 过（8 组，全部在开发环境临时实例上做）

```
① 当前密码错误 → **400** `{"error":"invalid_old_password"}`（**不是 401**——避免前端误判会话失效把人踢回登录页）✅
② 出错后未改动口令：旧口令仍可登录、主会话 `/api/me` 仍 200 ✅
③ 新密码不合规 → 400 `{"error":"invalid_password","message":"新密码至少 8 个字符（按 Unicode 码点计），且不得与当前密码相同"}`；
   与当前密码相同 → 400（文案「新密码不得与当前密码相同」）✅
④ 正例 → **204**，且**响应体为空、不含任何口令明文** ✅
⑤ 改后：**新口令登录 200 / 旧口令登录 401** ✅
⑥ 会话语义：**发起改密的会话仍 200**（本人不掉线）｜**第二个会话 401**（已吊销）｜**其它账号（probe2）会话不受影响 200** ✅
⑦ 限流：probe2 连续错 5 次 → 第 6 次 **429**；admin 会话不受该限流影响 ✅
⑧ 服务端日志**无**任何明文口令（旧/新/错误口令三种均 0 命中）✅
```

## 3. AC-67「修改密码」UI 层 — 过（含真鼠标与 UI 走通的正例）

```
① ⋯更多 菜单项**逐项**为 ["使用统计","API 令牌","导入 / 导出","关于","修改密码","登出"]，**不含**「已登录」✅
② 真鼠标点「修改密码」→ 弹窗 `pm-password-modal` 出现，三个密码框 testid = `pm-old-password` / `pm-new-password` / `pm-confirm-password` ✅
③ **表单校验（不一致）**：新密码与确认不一致 → 提示「两次输入的新密码不一致」，且**没有发出 /api/password 请求**（网络层断言 0 次）✅
④ **表单校验（过短）**：7 字符 → 提示「新密码至少 8 个字符（按 Unicode 码点计），且不得与当前密码相同」✅
⑤ **正例（从 UI 提交）**：填对当前密码 + 合规新密码（两端一致）→ 提示「**密码已更新（已在其它登录会话中退出）**」+ 弹窗关闭 ✅；
   随后 curl 验证：**新口令登录 200 / 旧口令 401** ✅
⑥ 关于页「维护」区已更新：「修改登录口令 也可以从界面完成：顶栏「⋯更多」→「修改密码」（改完当前会话保持登录，其它会话退出）；下面的 CLI 方式保留。」✅
⑦ 测试环境只做**校验路径**（不提交），以免改动 8767 的口令 ✅
```

## 4. 安全红线复核 — 过

```
用已知口令登录 **8767 测试环境** → **200** ⇒ dsh 未改动测试环境口令 ✅
验收方在测试环境**只点开弹窗并触发校验**、不提交任何改密请求（网络层断言 0 次）✅
```

## 5. 回归 — 过

```
npm test：**240 tests / 240 pass / 0 fail**（阶段 19 为 223 → 只增不减，含新接口与会话语义的新用例）
typecheck:web rc=0 ｜ 构建告警 "larger than" = 0 ｜ 最大 chunk = **467,320 B**（预算未破）
AC-44 分栏几何 271–637 / 673–1567 ✅ ｜ AC-51 顶栏「PromptManager 新建 更多 登出」✅ ｜ AC-37 纯净度 0 命中 ✅
详情面 `pm-detail-fullscreen` 仍可用（stage19 的全屏能力未回归）✅
```

## 6. 同步到测试环境（8767）记录（2026-09-20 01:3x）

```
同步 → 构建 → 重启：active / NRestarts=0 / enabled ｜ healthz 200 ｜ 未认证 401 ｜ 登录 200
chunk 集合比对：6 个 chunk **集合一致**，且**逐一字节数相同** ✅
（数据 prompts=7：含我在阶段 19 验收时留下的 1 条夹具《备注尾换行测试》，按 D-27 测试环境数据可随意动）
```

## 7. 验收方记录（我的探针失误）

1. **编辑器页点错了下拉**：编辑器里共 5 个 `ant-select`，我取了"最后一个"（其实是版本选择器）→ 展开选项为空/只显示 v1。
   改为**按「Markdown 预览」卡片定位**后确认：3 个选项齐全、切换生效。教训：**控件定位要按语义容器（卡片标题）而不是索引**。
2. **间距测量参考点选错**：我取 `pm-detail pre` 当正文，实际量到的是变量面板下方的 diff 代码块（336px，无意义）。
   改以 **DOM 层证据**（整行控件是否还存在）为准，并引用 dsh 的 52→8 对照。教训：**"间距减少"这类断言要先把两端元素钉死**。
3. **疑似残留的 2 个 select**：初判像"删了一半"，查明是版本对比的两个版本选择器 → 无问题（**先查清再写结论**）。

---

# 阶段 21 验收（备注=纯文本 + 详情页标题下备注）— 结论：**过**，并**已同步到测试环境（8767）**

| 项 | 值 |
| --- | --- |
| 被验收 commit | `c1bedd7`（`6041aab` 实现 A+B → `342e4d1` 自检 → `c1bedd7` 收尾） |
| 规格 | BRIEF **v28**（FR-68 / FR-69；AC-68 / AC-69） |
| **结论** | **过** → 已同步到**测试环境**（8767）并重启 |

## 1. AC-68 备注=纯文本 — 过

```
① 编辑器页 Markdown 预览的下拉选项 **恰好** `用户提示词 / 系统提示词`（**不含备注**）✅（源码 `fields=[...]` 计数 = 2；UI 展开实测一致；测试环境同样）
② 详情面选「备注」页签 → 正文区**原样显示** Markdown 原文：
   含 `# 标题` ✅ 含 `**粗体**` ✅ 含 `[链接](http://x)` ✅
   该区域 `querySelectorAll('h1,h2,h3,strong,ul,ol,a,code')` 计数 = **0** ✅（无任何渲染元素）
③ **网络层断言**：仅切到「备注」页签 → `POST /api/render/markdown` 请求 **0 次** ✅；
   **对照**：切回「用户提示词」→ 该请求 **1 次** ✅（证明插点正确、渲染通道仍工作）
④ 回归：用户提示词仍正常渲染（渲染元素 7 个、文本「一级标题 正文里有 加粗 与列表：…」）✅
```

## 2. AC-69 详情页标题下备注行 — 过

```
① `[data-testid="pm-detail-notes"]` 存在，`innerText` = 该条备注原文（20 字以内样例：「# 标题 **粗体** - 列表 [链接](http://x)」；测试环境真实数据：「报障后的排查范式：先复现取证、区分触发条件与相关因素、修复必带回滚与验证。」）✅
② 样式与间距（实测数值）：
   · 字号 **13px**（本页标题 18px；差 5px，落在 PromptHub 的 4–6px 区间）✅
   · 颜色 `rgb(60, 64, 70)` vs 标题 `rgb(20, 22, 26)` → **明显更浅、层级清晰** ✅（= 项目自定义 token 的次级灰）
   · 行高 **20.8px**（=13×1.6）✅
   · **标题行底部 → 备注行顶部 = 4px**（要求 ≤10px）✅
   · 位置断言：备注行 top 介于标题行之下、`pm-detail-fields`（页签行）之上 = **true** ✅
③ **空备注**：选「空备注」条目 → `pm-detail-notes` **不存在**（不占位）✅
④ **长备注（240 字）**：渲染高度 42px ÷ 行高 20.8 = **2.00 行**，`-webkit-line-clamp: 2` 生效，且 `title` 属性含完整全文 ✅
⑤ 截图：有备注（亮/暗）、长备注、空备注、编辑器、备注纯文本态 —— 共 5+ 张 ✅
```

## 3. 回归 — 过

```
npm test：**248 tests / 248 pass / 0 fail**（阶段 20 为 240 → 只增不减）｜ typecheck:web rc=0
构建告警 "larger than" = 0 ｜ 最大 chunk = **467,320 B**（预算未破）
AC-44 分栏几何 271–637 / 673–1567 ✅ ｜ AC-51 顶栏「PromptManager 新建 更多 登出」✅ ｜ AC-37 纯净度 0 命中 ✅
详情面「全屏展开」（stage19）仍在且可用 ✅
```

## 4. 同步到测试环境（8767）记录（2026-09-20 10:1x）

```
同步 → 构建 → 重启：active / NRestarts=0 / enabled ｜ healthz 200 ｜ 未认证 401 ｜ 登录 200
chunk 集合：新构建 6 个 chunk 已生效（app-lazy-C_AgjMmA.js / index-B46XIreC.js / …）
测试环境真实数据复验：备注行 13px · rgb(60,64,70) · 行高 20.8px · 间距 4px · 位置正确 ✅；编辑器 Markdown 预览选项 = 用户提示词 / 系统提示词 ✅
```

## 5. 验收方记录（我的探针失误）

1. **网络层断言设计缺陷**：首轮我把「清空计数 → 点用户提示词 → 点备注」串在一起，结果把**点用户提示词时那次合法请求**误当成违规证据。
   → 改为「**只点备注**」并把「切回用户提示词应当有 1 次」作为**对照实验** ⇒ 结论才可靠。（教训：**网络断言必须做对照**，否则无法区分"没请求"和"探针没装上"。）
2. 嵌套 `await` 的取值中途返回 `undefined`（空备注那条一度没测到）→ 拆成显式分步后通过（分步 + 明确打印）。
3. 编辑器页取坐标的 `box()` 返回 undefined → 改按「Markdown 预览」卡片定位下拉并直接展开读数。

---

# 阶段 22 验收（拖拽排序 + 分栏中栏精简）— 结论：**过**，并**已同步到测试环境（8767）**

| 项 | 值 |
| --- | --- |
| 被验收 commit | `66d7345`（`30e25f0` feat(drag) → `e84e88a` test(ac) → `3e34961` test(regression) → `66d7345` docs(progress 收尾)） |
| 规格 | BRIEF **v29**（FR-70 / FR-71；AC-70 / AC-71；D-28） |
| **结论** | **过** → 已同步到**测试环境**（8767）并重启 |

## 1. AC-70 拖拽排序 — 过（真鼠标拖拽全链路）

```
① 手柄：`pm-drag-card-<id>` **24×24**、`cursor: grab`、未 hover 也可见（不占额外行高）✅；文件夹 `pm-drag-folder-<id>` 同规格 ✅
② 卡片视图真鼠标拖拽（mousePressed → 12 步 mouseMoved → mouseReleased）：
   拖前 丙 | 乙 | 甲  →  拖后 **乙 | 丙 | 甲** ✅（第 1 条落到第 2 条之后）
   轻提示「**已切换为自定义排序**」出现一次 ✅
③ 排序档位：下拉文本 **最近更新 → 自定义**；`localStorage['pm-use-sort']`：`updated → custom`；
   **刷新页面后**：下拉仍显示「自定义」、顺序仍为 乙|丙|甲（**持久化**）✅
④ 排版回归（像素级）：**未被拖动的条目差 0px**；被拖的一对按槽位各移动 333px（= 一格宽，预期行为）；
   无横向溢出（`scrollWidth <= clientWidth + 2`）✅
⑤ 文件夹树同层级拖拽：拖前 运维 | Agent管理 → 拖后 **Agent管理 | 运维**，刷新后保持 ✅
⑥ 接口负例：不存在 id → **400** `{"error":"invalid_body","details":[{"path":"ids","message":"以下 prompt id 不存在：99999"}]}`；
   重复 id → **400**（「ids 不得重复：1」）；空数组 → **400**（「must NOT have fewer than 1 items」）；
   正常重排 → **204**；`GET /api/prompts?sort=custom` 返回新顺序 ✅
```

## 2. AC-71 分栏中栏条目精简 + 宽度 -8% — 过

```
① 条目文本 = **标题 + 备注**（备注为空时只有标题）；元信息命中全为 **false**：
   版本号 `v\d` ✗ ｜ `取用` ✗ ｜ `更新于` ✗ ｜ `变量` ✗ ｜ 文件夹名 ✗ ；
   **正文片段（夹具标记 ZZZ）不出现** ✗ ⇒ 确认"只显示标题+备注、不显示其他信息"✅
② 备注固定两行：高 **38px** ÷ 行高 **19.2px** = **1.98 行**，`-webkit-line-clamp: 2` ✅
   **空备注条目高度 = 有备注条目高度 = 80px**（等高整齐，不塌陷）✅
③ 中栏宽度 **336px**（改前 366px）→ **比值 0.918**（要求 0.90–0.94）✅；左栏 232px 不变；右栏 894 → **924px**（变宽）✅
④ 单击条目仍切换右栏（点第 2 条 → 详情标题同步）✅ ｜ ⑤ 无横向滚动 ✅
⑥ 卡片/表格视图未受影响（卡片条目仍 321×154 且保留正文摘要）✅
```

## 3. 迁移与数据安全（本次动了 schema，我额外专查）— 过

```
【旧库升级路径】用仅含 001+002 的旧结构库（3 条条目，更新时间 T3>T2>T1）跑 `node bin/pm.mjs migrate`：
   → `ok: schema at v3` ✅；`prompts` 新增 `sort_order` 列 ✅；
   → **按旧默认顺序（最近更新）回填**：sort_order 依次 1/2/3 对应 id 3/2/1 ✅（**升级后顺序不乱**）
   → **幂等**：再跑一次仍 `ok: schema at v3`、值不变 ✅
【生产库】`prompts.sort_order` 列存在 ✅；`schema_migrations` 表在 ✅
```

## 4. 回归 — 过

```
npm test：**266 tests / 266 pass / 0 fail**（阶段 21 为 248 → 只增不减，含新接口/迁移/排序档的新用例）
typecheck:web rc=0 ｜ 构建告警 "larger than" = 0 ｜ 最大 chunk = **467,320 B**（预算未破）
AC-44 分栏几何 / AC-51 顶栏 / AC-37 纯净度 等复跑通过 ✅
依赖登记：`@dnd-kit/{core,sortable,utilities,modifiers}` 已入 package.json ✅
```

## 5. 同步到测试环境（8767）记录（2026-09-20 15:0x）

```
同步 → 构建 → 重启：active / NRestarts=0 / enabled ｜ healthz 200 ｜ 未认证 401 ｜ 登录 200
生产 JS（index-BN7KogWP.js）含 `pm-drag-card` / `pm-drag-folder` / `pm-use-sort` ✅（新前端已上线）
新接口在线：`GET /api/prompts?sort=custom` → 200 ✅；`PATCH /api/prompts/order` 非法 id → 400 ✅；`/api/folders` 返回 `sort_order` ✅
```

## 6. 验收方记录（我的探针失误，本轮 5 条）

1. **testid 前缀猜错**（我猜 `pm-drag-handle-*`，实际是 `pm-drag-card-*` / `pm-drag-folder-*` / `pm-drag-split-*`）→ 首轮得出"手柄 ABSENT"的**假失败**；查源码后改正。
2. 排序下拉取值用 `.ant-select-selection-item` 取不到 → 改用 `[data-testid="pm-use-sort"]` 的 `innerText`（才拿到「自定义」）。
3. 空备注条目的选择器写错（按"无备注"文本找）→ 改用"条目行数"判断，才验到"等高"。
4. 一次探针模板未闭合导致语法错 → 本地 `node --check` 拦下（未上机）。
5. 测试环境的浏览器探针里，有一句写成了**无条件 `return true`**（会假通过）→ 放弃该路径，改用"**查生产 JS + 调接口**"的硬核对。
→ **教训（重复犯）**：断言前必须**先枚举 DOM / 查源码**确认 testid 与元素形态；"探针说没有"不等于"实现没有"。

---

# 【事故与修复】阶段 22 上线后白屏（2026-09-20 15:2x，用户报"访问服务异常"）

| 项 | 内容 |
| --- | --- |
| 现象 | 用户访问 http://192.168.0.228:8767 异常（实为**白屏**） |
| 服务端 | **健康**：`active`、`NRestarts=0`、8767 在听、`/healthz` 200、首页 200、经内网 IP 200 |
| **根因** | 阶段 22 新增依赖 `@dnd-kit/*`；**我的部署脚本缺 `npm install` 步骤**（前 21 个阶段依赖从未变过，故一直未暴露）⇒ `/opt/promptmanager/node_modules` 里没有这些包 ⇒ 在 `/opt` 构建时被当作**外部依赖**留在产物里（`from"@dnd-kit/core"` 等 4 处）⇒ 浏览器 `Failed to resolve module specifier "@dnd-kit/core"` ⇒ 应用不启动 |
| 证据 | `/opt/promptmanager/node_modules/@dnd-kit` **不存在**（项目目录存在）；`/opt` 产物 `index-BN7KogWP.js` 含 4 处 `from"@dnd-kit/..."`；项目目录产物 0 处；浏览器未捕获异常原文如上 |
| **为什么我的部署检查没抓到** | healthz 200 / 登录 200 / chunk 集合与字节逐一相同 —— **白屏同样返回 200**；我的部署验证**缺"页面真的渲染"这一步** |
| 修复动作 | ① `/opt/promptmanager` 执行 `npm install`（`@dnd-kit` 5 个包就位）② 重新构建 → **产物裸引用 0 处**（新 chunk 集含 `vendor-misc-DDnOFgsM.js` = dnd-kit 已打包）③ `systemctl restart` → active、healthz 200 |
| 修复后验证 | 真浏览器：**登录页渲染**（`#root` 有内容、`pm-login` 在）✅；**登录后应用渲染**（`#root` 文本 750 字、`pm-topnav`/`pm-split-list` 在、**条目 7 条**）✅；**零未捕获异常 / 零控制台错误 / 零失败请求** ✅ |
| 测试环境拖拽冒烟 | 手柄 `pm-drag-card-18` 存在；真鼠标拖拽后顺序变化；排序档位自动落 **`自定义 / custom`** ✅ |
| 防再犯（已落地） | 部署脚本 `projects/greenhouse/scripts/pm-deploy.sh` 永久加入：**① 构建前 `npm install`**；**② 构建后"产物裸模块引用"检查（应为 0）**；**③ 部署后"真实渲染检查"**（`chrome --headless --dump-dom | grep -c 'SELF-HOSTED\|pm-login'`，>0 才算能渲染）；规则同步写入技能 `acceptance-gate.md` §0 + CHANGELOG |
| 责任归属 | **我的流程缺口**（部署环节），不是 dsh 的实现问题 —— 它的自测跑在自己的开发实例上，`node_modules` 是齐的，故在它那边无法暴露 |

---

# 阶段 23 验收（文件夹筛选含子目录 + 卡片末行贴底 + 表格拖拽）— 结论：**过**，并**已同步到测试环境（8767）**

| 项 | 值 |
| --- | --- |
| 被验收 commit | `74fdde2`（`2129bfd` feat(folder) → `35ba4e4` feat(ui) → `eac33e7` test(ac) → `6330f2c` test(fix) → `74fdde2` docs(progress 收尾)） |
| 规格 | BRIEF **v30**（FR-72 / FR-73 / FR-74；AC-72 / AC-73 / AC-74；D-29） |
| 验收时间 | 2026-09-20 17:0x–17:3x |
| **结论** | **过** → 已同步到**测试环境**（8767）并重启 |

## 1. AC-72 文件夹筛选含子目录 + 与计数一致 — 过

**【我原样执行】`bash tools/ac-stage23.sh`**（自起自停临时实例 + 临时 `DATA_DIR`；我自己的运行，非它的输出）：

```
PORT 自动选择：8765
✅ npm run build 退出码 = 0 ｜ ✅ >500KB 告警数 = 0 ｜ ✅ 最大 chunk ≤500KB（467320 B）
✅ npm run typecheck:web 退出码 = 0 ｜ ✅ 本阶段未新增依赖 = 4
✅ 两个新测试文件退出码 = 0（tests 9 / pass 9 / fail 0）
夹具：A>B>C 三层各 1 条 + 未归类 1 条 + 卡片三态 3 条（A=1 B=2 C=3）
folder_id=A(1) → total=3 items=[1,2,3] ｜ B(2) → total=2 items=[2,3] ｜ C(3) → total=1 items=[3]
✅ total == items 条数（3/2/1）｜ ✅ A 的 id 集合 = [1,2,3]
组合：✅ folder_id=A&tag=T → 1 ｜ ✅ q=乙乙乙（LIKE 兜底）→ 1 ｜ ✅ q=AC23 B（FTS5）→ 1
分页：✅ limit=2 → items=2/total=3 ｜ ✅ offset=2 → items=1
负例：✅ 不存在 id → 200 {"total":0,"items":[]} ｜ ✅ folder_id=abc → 400
UI：✅ 侧栏 A 计数徽标 = 3 ｜ ✅ 点击 A 后列表条目数 = 3（与徽标逐字一致）
✅ 跨目录拖拽：顺序不变 ["AC23 C 里的","AC23 B 里的","AC23 A 里的"] ｜ ✅ 未发出 PATCH（计数差 0）
✅ 页面运行时异常（folder）= []
=== 结论 === ✅ AC-72 / AC-73 / AC-74 全部通过（rc=0，0 个 ❌）
```

**【独立验证 ①：源码审查】** `src/db/prompt-queries.ts` 的 `filterFragment()` 用 `p.folder_id in (…)`；
**FTS5 路径（`.where(filters)` @ line 99）与 LIKE 兜底路径（`.where(filters)` @ line 122）共用同一个 `filters` 片段** ⇒ 两条路径都 inclusive；
`folderIds=[]`（根不存在）→ `1 = 0` 命中 0 条。`src/services/folders.ts` 用 `WITH RECURSIVE` 一次取回「自身 + 全部后代」。

**【独立验证 ②：测试环境真实数据（同步后实测）】** 测试环境本身有父子结构（`Agent管理` → `会话管理`）：

```
全部 7 条：id18(未归类) id2(f=2) id6(f=4) id1(f=1) id5(f=4) id4(f=4) id3(f=2)
folder_id=2（Agent管理，有子目录"会话管理"） → total=3 ids=[2,1,3]   ← 含子目录里的 id=1 ✅
folder_id=1（会话管理，子目录）            → total=1 ids=[1]
folder_id=3（23323，子目录"111"为空）      → total=0
folder_id=4（运维）                        → total=3 ids=[6,5,4]
```
⇒ **用户提的正是这个**：点父目录现在能看到子目录的卡片，且与侧栏计数同口径。

**连带修订核对（我复核）**：`FolderPanel.inclusiveCount` 由「本级 + Σ子目录」改为直接返回 `counts[id]`——这是**必要**的（接口 `total` 已含子目录，
否则 A 会显示 6 而列表只有 3）。我独立追了 `counts` 的数据源：`Workspace.tsx` 对每个文件夹调 `listPrompts({folderId, limit:1}).total` ⇒ 与列表同口径 ✅。
`deleteHint`/删除失败提示里的 `counts[folder.id]` 只在 `kids === 0` 分支被用到 ⇒ 语义未变 ✅。

## 2. AC-73 卡片末行贴底 — 过（**独立对照实验**：同一夹具 + 同一量测脚本，只差构建版本）

我用 `git worktree` 检出**阶段 23 之前的 `b053e6c`** 并重新构建（web+server），对**同一个 7 条夹具**跑同一量测脚本：

| 卡片 | 改前 `b053e6c` | 改后 `74fdde2` |
| --- | --- | --- |
| 三标签 | cardH 186 / gap **15** / bodyH 184 / 空 Flex 0 | 同 |
| 一标签 | cardH 186 / gap **15** / bodyH 184 / 空 Flex 0 | 同 |
| **无标签** | cardH 186 / gap **40** ✗ / bodyH **159** / 空 Flex **1** ✗ | cardH 186 / gap **15** ✅ / bodyH **184** ✅ / 空 Flex **0** ✅ |

⇒ 与它的自述**逐字一致**（40px → 15px），且证明成因两条：空标签区白占一个 10px `gap` + body 未撑满（`marginTop:auto` 无处可推）。
（它自己的 7 条夹具量测：`ac73_light` 全部 gap=15、tagsH=0 那张 emptyFlex=0、cols=4、无横向溢出；暗色同样全部 15 ✅）

**识图（我自己看图，非采信它的结论）**：`05-card-footer-light.png` / `06-card-footer-dark.png` —— 7 张卡片、第一行 4 张与第二行 3 张各自**底边对齐在同一条线**、
**无标签那张不留空白条**、无重叠/裁切/溢出 ✅。

## 3. AC-74 表格拖拽 + 刷新感 — 过（**独立基线对照**）

**【独立对照】** 同一夹具 + 同一探针，只差构建版本：

| 指标 | 改前 `b053e6c` | 改后 `74fdde2` |
| --- | --- | --- |
| 列宽（8 列） | `[301,183,123,83,94,106,155,275]` | **同** |
| rowHeight / headerHeight | 43 / 38 | **同** |
| 手柄 | `null`（旧版无） | `pm-drag-row-7` **24×24** `cursor: grab` |

**【我原样执行脚本的输出】**（表格段）：
```
✅ 手柄热区 ≥24×24 ｜ ✅ 行高与改前一致（43px）｜ ✅ 表头高与改前一致（38px）
✅ 列宽与改前一致（8 列实测像素）｜ ✅ 表头文案与改前一致（未新增列）
✅ 拖拽改变表格行顺序（[7,6,5,4,3,2,1] → [6,5,7,4,3,2,1]）
✅ 一次拖拽只发 1 次 PATCH（差 1）｜ ✅ 刷新后表格顺序保持 ｜ ✅ 排序档显示「自定义」
✅ AC-74 ③：拖后 500ms 内无骨架/空白（10 帧逐帧采样，全 rows=7/skeleton=0/loadingText=false）
✅ AC-74 ③：未动行像素差 ≤1px ｜ ✅ AC-74 ⑥：卡片档/分栏档拖拽仍正常
✅ 页面运行时异常（table）= []
```
**识图**：`03/04-table-*-light.png` —— 8 列表头（标题/标签/文件夹/版本/变量数/取用次数/更新于/操作）、**手柄在「标题」列内**、行高均匀、无重叠/裁切 ✅。

## 4. 回归 — 过

```
$ npm test                    → ℹ tests 275 / pass 275 / fail 0（**我自己跑**，rc=0；阶段 22 为 266，只增不减 +9）
$ npm run typecheck:web       → rc=0 ｜ 最大 chunk 467,320 B ≤500KB、无 larger-than 告警
$ tools/ac-stage17…22.sh      → 全绿（脚本内回归段，我原样执行）
$ tools/ui-shots.sh           → OK（53 张）
```
**未回归的旧断言**：它点名复核的 `api-folders-tags`（AC-14）/`api-prompts-crud`/`api-search` 三个文件夹具**都是单层目录** ⇒ inclusive 下期望值不变、无需修订（19/19 通过）——**我复核了夹具结构，认可这个判断**。

## 5. 过程审查 — 干净

```
系统侧：find /etc /usr/local/bin -newermt '09-20 15:40' ! -newermt '09-20 17:30' → 空 ✅
历史：git reflog 全为 commit: ✅ ｜ git fsck --no-progress → 无输出 ✅
别的项目：find projects -maxdepth 2 -newermt … -not -path '*promptmanager*' → 空 ✅
凭据：git log --all --name-only | grep -c '_env/' → 0 ✅
      （`git log -p --all | grep -c '<夹具口令>'` = 31 —— 命中的是**测试夹具的公开口令** `ac-fixture-pw-…`，出现在 ac 脚本里属预期，非真实凭据）
命令级线索：系统包管理 0 / 写系统路径 0 / curl|bash 0 / 全局安装 0 / sudo 0 / 读 _env 0 / 真跑测试 74 次
rm -rf 真目标：/tmp/pm-wt21、/tmp/pm-wt23、tmp/baseline、tmp/variant、tmp/wt23（全在 /tmp 或项目 tmp/）✅
提交对账：git log --format='%an' | sort | uniq -c → 167 dsh + 3 host_manger ✅（窗口内 5 个提交全为 dsh）
```

## 6. 收尾回复对账（规范 §7）

它收尾回复的每条结论**都能落到文件**：commit 表（`2129bfd`/`35ba4e4`/`eac33e7`/`6330f2c`/`74fdde2`）→ `PROGRESS.md §9`；
AC-72/73/74 原样输出 → `PROGRESS.md §3/§4/§5`；连带修订与旧断言核对 → `PROGRESS.md §6.4`；依赖未新增 → `PROGRESS.md §5` 末。
**唯一结构性缺口**（预期内）：**收尾 commit `74fdde2` 自身不可能写进它那次提交** → 由本文件记录 ✅。
**它还主动声明**「工作区仅剩 `BRIEF.md`（v29→v30，host_manger 的规格更新，未提交、未触碰）」——与我现场看到的 `M BRIEF.md` 一致，**说明它认出了那是我的改动、没有越界改规格** ✅

## 7. 同步到测试环境（8767）记录（2026-09-20 17:24）

```
同步前 chunk：assets/index-5p1M172K.js（阶段 22）  →  同步后：assets/index-Df1GpLgq.js（阶段 23）
is-active=active ｜ NRestarts=0 ｜ enabled=enabled ｜ healthz={"status":"ok","version":"0.1.0"} ｜ 未认证=401 ✅
产物残留裸模块引用（应 0）：0 ✅ ｜ 任一产物含阶段 23 特征 pm-drag-row：1 个 chunk ✅
真实渲染检查（--virtual-time-budget=5000）：1 ✅（DOM 含 SELF-HOSTED / pm-login / PromptManager / 用户名）
数据：prompts=7（用户的 6 条 + 我的验收夹具 1 条）
【冒烟（测试环境真实数据，只读）】TABLE：7 行 / **7 个手柄 24×24** / 8 列表头 / #root 72,724 字符 / 异常 []
                              CARD：7 张卡片 **全部 gap=15**（含无标签那张）/ 异常 []
【inclusive 真实数据验证】见 §1 独立验证 ②
```

## 8. 验收方记录（我的失误与缺口 —— 诚实写）

1. **部署脚本 4 个 bug（我的资产，本次验收才发现）** —— 这是本轮最重要的自省：
   - ① **跨行引号配对**：`echo "echo "=== 2.5 …==="` 与下一段 `=== 3. 构建 ==="` 的引号跨行闭合 ⇒
     **`npm install` 与「=== 3. 构建 ===」整段落在字符串里、从未执行**。`bash -n` **通过**（语法合法），所以从未被发现 ——
     **上一轮"白屏防再犯"的第 ① 条实际上一天都没生效过**（上次白屏是手动装依赖救回来的）。
   - ② `npm install` 的 cwd 是 `$SRC` 而非 `$DST`（即使能执行也装错地方）。
   - ③ **明文口令内嵌**在脚本里（违反"凭据不落工作区明文"）——已移除；**建议轮换测试环境口令**（待用户定）。
   - ④ 渲染检查缺 `--virtual-time-budget` ⇒ DOM 在 JS 执行前被 dump ⇒ **本次报「❌ 白屏」是假阴性**（加参数后 ✅）。
   - 教训：**`bash -n` 只查语法、查不出"引号配对把整段代码吃掉"**；部署脚本必须**干跑/分步验证**（或至少逐段 `echo` 验证执行路径），
     不能只看语法通过。已把 4 条修复落进脚本头注释。
2. **我改 BRIEF v30 后没有立即 commit**，留下 `M BRIEF.md` 一整天（本次验收时补提交）。规范动作是「改完即提交（host_manger 身份）」。
3. **我改 BRIEF 前没有先跑 `scripts/dsh-ctl.py sessions` 确认 dsh idle**，而是用 `git status` 干净**推断** —— 碰运气（这次侥幸没撞车）。
4. 探针复用失误：dsh 的 `ac-stage23-probe.mjs` 的 card 模式依赖新版 DOM，在旧构建上抛错（`求值失败：Uncaught`）；
   我改用它的**中性量测脚本** `tmp/measure-card.mjs` 完成改前/改后对照（它只读几何，不含版本假设）✅
5. 缺口（不阻塞，记录备查）：
   - 两个新测试文件权限 `600`（其他为 644）——不影响运行，属卫生瑕疵；
   - `ac72_list_total` 在 probe 输出中为空值（未被任何断言使用，不影响判定）；
   - FR-72 之后侧栏计数依赖「每个文件夹一次 `listPrompts(limit=1)`」且每次带递归 CTE —— **既有设计**（阶段 15 起），
     但文件夹/条目变多后是**性能观察项**（本阶段未劣化到需要处理）；
   - AC-74 ③「未动行像素差」只覆盖**位置未变**的 4 行（符合 AC 定义，但断言面偏窄）。

---

# 阶段 24 验收（FR-75 修「卡片拖动根本不生效」+ 槽位保持）— 结论：**过**，并**已同步到测试环境（8767）**

| 项 | 值 |
| --- | --- |
| 被验收 commit | `9a70f66`（`761faa1` 后端槽位保持 → `700f51b` 取消跨目录限制+本体可拖 → `5d7684d` AC 自检 → `384871e` 回归修订 → `9a70f66` 收尾） |
| 规格 | BRIEF **v31**（FR-75 / AC-75 / D-30） |
| 验收时间 | 2026-09-20 19:31–19:5x |
| **结论** | **过** → 已同步到**测试环境**（8767）并重启 |

## 0. 本轮背景：这个 bug 由**我的规格失误**引入，且**我的上轮验收漏检**

用户实测报「卡片拖动根本不生效，无法推动排序」。我在测试环境用真鼠标复现并定位到两条叠加原因：
① **D-29**（我 v30 定的「inclusive 视图下拖拽仅同 `folder_id` 内生效」）—— 在默认「全部」视图下，7 条数据分属 4 个目录，
相邻卡片几乎必然跨目录 ⇒ 只有 1 对可拖，其余**静默忽略**（顺序不变、0 请求、无提示）；
② **卡片本体不是拖拽激活点**（只有手柄绑 listeners）。
**上轮漏检原因**：AC-74 ⑥ 的夹具恰好是「3 条卡片三态 + 1 条未归类」= **4 条同目录**，落在"能生效"的组合上；
我同步后的冒烟只验了卡片数量与末行贴底，**没做一次真鼠标拖动**。→ 已在 BRIEF v31 记入规格作者自省。

## 1. AC-75 逐条 — 过（**我自己原样跑** `bash tools/ac-stage24.sh`：rc=0、**0 个 ❌**、47 条断言）

```
✅ 手柄：{"testid":"pm-drag-card-4","w":24,"h":24,"cursor":"grab","title":"按住拖动以调整顺序","visible":true}
✅ 跨目录拖拽生效：全部视图 [4,3,1,2] → [3,1,4,2]（顺序变化）
✅ 恰好 1 次 PATCH /api/prompts/order = 1 ｜ ✅ 刷新后顺序保持 = [3,1,4,2]
✅ ⑤ 无静默忽略（顺序已变 且 发过请求） = true ｜ ✅ 拖后提示文本：[]（无多余提示）
✅ ⑥ 本体拖拽：[3,1,4,2] → [1,4,3,2]（1 次 PATCH）
✅ ⑥ 单击后卡片边框色 rgb(94,106,210)（选中态）｜ ✅ 双击后详情 {"detailOpen":true,"title":"AC24 A1"}
✅ ⑥ 单击/双击未改变顺序 = true
✅ ④ 槽位保持：A 组槽位 [1,4] → [1,4]；其他条目 3/4 的 sort_order 3→3、2→2 **不变**；
   全量 sort_order 无重复 ✅；A 组最小槽位 1→1（**未被顶到全局最前**）；④ UI 顺序与落库一致
✅ ⑦ 未动项像素差 ≤1px ｜ ✅ 行高不变 [154,154,154,154] ｜ ✅ 无横向溢出（1600/1600）
✅ ⑧ 负例：不存在 id / 重复 id / 空 ids → **400**（原样贴 body）
✅ ⑨ 分栏档 [2,4,3,1]→[4,3,2,1]、表格档 [4,3,2,1]→[3,2,4,1] 真鼠标拖动均生效
✅ 页面运行时异常（card）= []
```

## 2. 独立验证：**在测试环境真实数据上**（不采信它的夹具——上轮就是被夹具骗的）

**【我自己的探针 + 真鼠标】**（测试环境 7 条 / 4 个目录：未归类1、f2×2、f4×3、f1×1）：

| 操作 | 上轮（阶段 23 构建） | 本轮（阶段 24 构建） |
| --- | --- | --- |
| 拖**手柄** #1→#2（**跨目录**） | 顺序不变、**0 次 PATCH** | **顺序变化 ✓、1 次 PATCH ✓** |
| 拖**卡片本体** | 无反应、0 次 PATCH | **顺序变化 ✓、1 次 PATCH ✓** |

**【接口级「槽位保持」独立验证】**（直接读库对照，模拟"在目录内拖拽"）：

```
① 拖前全量：  18:fNone:so1 | 4:f4:so2 | 2:f2:so3 | 1:f1:so4 | 5:f4:so5 | 6:f4:so6 | 3:f2:so7
② PATCH {ids:[6,5,4]}（反转 folder4 三条）→ HTTP 204
③ 拖后全量：  18:fNone:so1 | 6:f4:so2 | 2:f2:so3 | 1:f1:so4 | 5:f4:so5 | 4:f4:so6 | 3:f2:so7
④ 判据：其他目录条目 {18:1, 2:3, 1:4, 3:7} **完全不变** ✓
        folder4 三条只在**原占槽位 {2,5,6}** 内重排 ✓
        全量 sort_order [1..7] **无重复** ✓ ｜ 最小槽位 **2**（未被顶到最前）✓
⑤ 目录视图顺序 [6,5,4] ✓ 与提交一致 ｜ ⑥「全部」视图 [18,6,2,1,5,4,3]（按全局 sort_order，未被打乱）✓
```
⇒ **旧实现**会把这三条设成 `so=1,2,3`（与其他条目**冲突**且**顶到最前**）；新实现修掉了这个既有缺陷。

**【视觉独立复现】**（我自己拉图 + 识图）：`01/02`（全部视图拖前拖后）4 张卡片、**每张标题行右侧都有竖排三点手柄**、等高、无重叠/错位/残影/裁切；
`05`（目录视图两条已交换）与左下角「共 2 条」及文件夹计数一致、无残影。

## 3. 回归 — 过（**含它自检抓到的真回归**）

```
$ npm test                          → 281 / 281（阶段 23 为 275，只增不减 +6）—— **我自己跑**
$ bash tools/ac-stage22.sh          → rc=0、**0 个 ❌**（我跑）
$ bash tools/ac-stage23.sh          → rc=0、**0 个 ❌**（我跑；含反向修订后的 AC-72 ⑨）
    └ AC-72 ⑨ 现在是：「跨目录拖拽：顺序变化（D-30 起总是生效）」+「恰好 1 次 PATCH」——**断言更强，不是删除**✓ 符合 D-30
$ npm run typecheck:web             → rc=0 ｜ 最大 chunk 467,320 B ≤500KB ｜ 无迁移（migrations/ 仍 3 个）
```

**它自己抓到并修掉的真回归（值得记一笔）**：最初把 `onPointerDown` 从手柄"搬"到本体时，**手柄本身拖不动了** ——
`ac-stage22.sh` 的文件夹树拖拽与 `ac-stage23.sh` 的手柄拖拽立刻报红（顺序不变 + 0 请求）。
修复：手柄保留**完整**监听（指针+键盘），并在手柄的 `onPointerDown` 里先调原监听再 `stopPropagation()`（避免双激活点重复启动）；
文件夹行补挂 `rootListeners`。修完 AC-70/71/72/73/74 全部复绿（我已独立复跑确认）。

## 4. 过程审查 — 干净（含一处环境变动的溯源）

```
系统侧 find /etc /usr/local/bin（窗口 17:40~19:50）→ 有命中！**已三步溯源，判定与 dsh 无关**：
  ① 228 是 **LXC 容器**（systemd-detect-virt=lxc）；② 命中项 mtime 全为 **19:09:41**，而 journalctl 显示 **19:09:43 系统刚启动**
     （NetworkManager starting / Console Getty started / hostname→dsh）⇒ 是**容器重启时重新生成**的；
  ③ /etc/passwd 多出的 `promptmanager:x:984` 是**我自己部署时建的服务账号**（/opt/promptmanager、nologin）。
历史改写：git reflog 全为 commit: ✓ ｜ git fsck 无输出 ✓
别的项目：find projects -maxdepth 2 -newermt … -not -path '*promptmanager*' → 空 ✓
凭据：_env/ 命中 0 ✓ ｜ **真实口令命中 0** ✓（本轮专门查了我曾从部署脚本移除的那个口令）
命令级：系统包管理 0 / 写系统路径 0 / curl|bash 0 / 全局安装 0 / sudo 0 / 读 _env 0 / 真跑测试 84 次
提交对账：172 dsh + 6 host_manger ✓（窗口内 5 个提交全为 dsh，粒度正常）
```

## 5. 同步到测试环境（8767）记录（2026-09-20 19:38）

```
chunk：assets/index-Df1GpLgq.js（阶段 23）→ **assets/index-PyGYYdpC.js（阶段 24）**
is-active=active ｜ NRestarts=0 ｜ healthz={"status":"ok","version":"0.1.0"} ｜ 未认证=401 ✅
产物残留裸模块引用：0 ✅ ｜ 任一产物含阶段 23 特征 pm-drag-row：1 个 chunk ✅
**真实渲染检查（带 --virtual-time-budget=5000）：1 ✅**（上一轮我修的部署脚本四项修复全部生效）
数据：prompts=7（用户的 6 条 + 我的验收夹具 1 条）
【真实数据冒烟】拖手柄跨目录 → 生效 + 1 次 PATCH ✓ ｜ 拖本体 → 生效 ✓ ｜ 槽位保持接口级验证见 §2 ✓
```

## 6. 验收方记录（我的失误，诚实写）

1. **上轮漏检是本轮 bug 的根源**：AC-74 ⑥ 的夹具（4 条同目录）恰好落在"能生效"的组合上；同步后的冒烟只验渲染与贴底、**没验拖拽**。
   → 教训已具备可落盘价值：**① 验收夹具必须覆盖真实数据分布；② 冒烟必须覆盖本阶段的核心交互**（建议回写技能，待用户批准）。
2. **本轮我自己的验证设计错了两次**（第三次才对，如实留痕）：
   - 先用 `GET /api/prompts?sort=custom` 取 `sort_order` → **`KeyError`**：该字段**不在 API 契约里**（我误以为会返回）；
   - 改用直接读库后，第一次 `PATCH {ids:[4,5,6]}` 传的是**与当前相同的顺序** → 结果无变化（只验到幂等，没验到槽位保持）；
     第二次传反转顺序 `[6,5,4]` 才得到有效对照。
   → 教训：**验证"顺序类语义"时，必须先确认"输入真的改变了顺序"**，否则会得到"无变化"的假象。
3. **我改动了测试环境的顺序**（验证拖拽时拖了 2 次 + 1 次 PATCH）——按 D-27 属正常（测试环境数据非资产），在此说明。
4. 缺口（不阻塞，记录备查）：
   - **槽位保持的「全新数据全 0」归一化分支**只在它的脚本里验过（测试环境不是全新库，我无法独立复现该分支）→ 依赖实现方自证，记为**残余风险**；
   - `docs/shots/stage23/` 有一张截图被它**改名**（`02-folder-cross-folder-drag-ignored` → `-applied`）——与新语义一致，属正当修订。

---

# 阶段 25 验收（顶栏品牌文字 → `PromptM`）— 结论：**过**，并**已同步到测试环境（8767）**

| 项 | 值 |
| --- | --- |
| 被验收 commit | `fadffde`（`5d9c995` 实现 → `16c2307` AC 自检 → `fadffde` 回归修订） |
| 规格 | BRIEF **v32**（FR-76 / AC-76 / D-31） |
| 验收时间 | 2026-09-20 20:41–20:5x |
| **结论** | **过** → 已同步到**测试环境**（8767）并重启 |

## 0. 本轮范围（用户明确收口，这是验收的判定基准）

用户原话：「**我们只改这个logo的地方，其他地方都不要改**」⇒ 只动**顶栏**；其余四处（`<title>` / 登录页 / 关于页 / `pure.ts` 错误文案）**保持全名**；
导出契约值 `app='promptmanager'` **一字不动**（D-31：显示名 ≠ 契约值）。

## 1. AC-76 逐条 — 过（**我自己原样跑** `bash tools/ac-stage25.sh`：rc=0、**0 个 ❌**）

```
✅ 品牌文字精确 = PromptM ｜ ✅ 顶栏内不出现 PromptManager
✅ ② document.title 仍是 PromptManager ｜ ✅ 图标 26×26（src 未变）
✅ AC-47：按钮 left 严格升序（1303 < 1386 < 1469 < 1505）
✅ AC-51：点 logo 回主页（视图回到分栏 + 搜索清空）
✅ ⑤ 移动视口 390×844：不渲染品牌文字（brandTextExists=false）、仍有图标、无横向溢出
✅ ⑦ 桌面无横向溢出 ｜ ✅ 页面运行时异常 = []
```

## 2. 独立验证（**不采信它的输出**）

### 2.1 源码级 —— 精确模式核对（⚠️ 我第一遍用 `grep -c 'PromptM'` 得到"四处也命中"的**假象**：`PromptManager` 含 `PromptM` 前缀；改用负向断言 `PromptM(?!anager)` 后结论清晰）

| 文件 | `PromptManager`（全名） | `PromptM`（非全名） |
| --- | --- | --- |
| `web/index.html`（`<title>`） | **1** ✅ | 0 ✅ |
| `web/src/components/LoginPage.tsx` | **1** ✅ | 0 ✅ |
| `web/src/components/AboutModal.tsx` | **1** ✅ | 0 ✅ |
| `web/src/pure.ts`（错误文案） | **1** ✅ | 0 ✅ |
| `web/src/components/AppHeader.tsx`（顶栏） | **0** ✅ | 2 ✅ |

**契约值**：`grep -n "app: 'promptmanager'" web/src/pure.ts` → 第 107 行命中 ✅；`grep -c "app: 'PromptM'"` → **0** ✅（没被"顺手统一"）。

### 2.2 运行时（**测试环境 8767 真实渲染**，真浏览器 + 会话 cookie）

```
未登录（登录页）：bodyHasFull=true ✅ ｜ bodyHasShort=false ✅ ｜ document.title=PromptManager ✅
已登录（顶栏）：  brandText="PromptM" ✅ ｜ headerHasFull=false ✅ ｜ document.title=PromptManager ✅
运行时异常：[] ✅
```
**视觉（我自己拉图识图）**：桌面顶栏品牌区 = 「>」图标 + **`PromptM`**（逐字读出 P-r-o-m-p-t-M），无截断/换行/与右侧按钮挤压 ✅。

## 3. AC-51 的修订核对（旧断言该不该改、改了之后是否仍能证明功能对）

| 旧断言 | 修订后 | 我的判定 |
| --- | --- | --- |
| `tests/navigation-hygiene.test.ts` AC-51「品牌文字必须是 `PromptManager`」 | 「顶栏品牌文字必须是简称 `PromptM`」+ **新增**「顶栏不得再出现全名」，并注明"规格变更，不是放宽" | ✅ **恰当**：是**反向修订 + 加强**（不是删断言），与 v32/D-31 一致 |
| `tools/ac-stage16-probe.mjs` / `ac-stage16.sh` 的「顶栏含 PromptManager」 | 改为断言顶栏含 `PromptM` | ✅ 同上 |
| （**保留未动**）`navigation-hygiene.test.ts:273` AC-59 ②「`index.html` 的 title 严格等于 `PromptManager`」 | 保留 | ✅ **这正是"四处不改"的守卫**——它没有顺手把这条也改掉 |

## 4. 回归 — 过（含"定点验证范围"的合理性判断）

```
$ npm test              → 285 / 285（阶段 24 为 281，只增不减 +4）—— **我自己跑**
$ ac-stage25.sh         → ✅ AC-76 全部通过 ｜ ac-stage15.sh → ✅ AC-47 ｜ ac-stage16.sh → ✅ AC-51（含修订后断言）
$ typecheck:web rc=0 ｜ build 无 >500kB 告警（最大 chunk 467,320 B）
```
**它本次做的是「定点验证」而非全量回归**（自述称"按用户指示"）。**我无法核实该指示的来源**（用户未向我提及），
但**该范围本身合理**：本次只改 `AppHeader.tsx` 一处文字 + 一个 testid，受影响面就是顶栏（AC-47 / AC-51），
其余阶段与品牌文字无关 ⇒ 无需全量。**这也与我刚写进技能的"按改动性质分级回归"一致**。

## 5. 过程审查 — 干净

```
系统侧 find /etc /usr/local/bin（窗口 20:10~21:00）→ 空 ✅
历史改写：git reflog 全为 commit: ✅ ｜ git fsck 无输出 ✅
别的项目：find projects -maxdepth 2 -newermt … -not -path '*promptmanager*' → 空 ✅
凭据：_env/ 命中 0 ✅ ｜ 真实口令命中 0 ✅
命令级：系统包管理 0 / 写系统路径 0 / curl|bash 0 / 全局安装 0 / sudo 0 / 读 _env 0 / 真跑测试 94 次
提交对账：175 dsh + 8 host_manger ✅（窗口内 3 个提交全为 dsh）
```

## 6. 同步到测试环境（8767）记录（2026-09-20 20:47）

```
chunk：assets/index-PyGYYdpC.js（阶段 24）→ **assets/index-Ceaq0Ohn.js（阶段 25）**
is-active=active ｜ healthz ok ｜ 未认证=401 ✅ ｜ 产物裸模块引用 0 ✅ ｜ **真实渲染检查：1 ✅**
数据：prompts=7（用户的 6 条 + 我的验收夹具 1 条）
【运行时冒烟】登录页含全名 ✅ ｜ 顶栏 `PromptM` ✅ ｜ title 全名 ✅ ｜ 零异常 ✅
```

## 7. 验收方记录（我的失误 + 缺口）

1. **我自己的验证方法第三次出错**（本次）：核"四处是否被顺手改掉"时用 `grep -c 'PromptM'`，
   而 `PromptManager` **包含** `PromptM` 前缀 ⇒ 得到"四处也命中"的**假象**，我一度以为它越界改了四处。
   改用负向断言 `PromptM(?!anager)` 后结论才清晰。→ 教训：**验证"某字符串被替换"必须用词边界/负向断言，别用裸子串匹配**（与前两次"API 取 `sort_order`""PATCH 传相同顺序"同源：**先怀疑自己的验证方法**）。
2. **缺口（不阻塞）**：它按"定点验证"范围**没有重跑 `ui-shots.sh`** ⇒ `docs/shots/` 下的**通用截图集**顶栏仍显示旧的 `PromptManager`
   （它自己在 PROGRESS §3 留痕说明了）。这不影响本阶段验收（本阶段品牌证据以 `docs/shots/stage25/` 三张改后截图为准），
   下次任何阶段跑 `ui-shots.sh` 时会自动更新。
3. **一处超范围的小改动（可接受）**：它顺手给顶栏品牌文字加了 `data-testid="pm-brand-text"`（AC 需要精确取 `innerText`）——
   **不改变任何行为**，属可测性增强，已在 PROGRESS 留痕。
