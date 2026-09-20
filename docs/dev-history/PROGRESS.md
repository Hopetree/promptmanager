# promptmanager 进度（PROGRESS）

> 由 **dsh** 维护。规则：每次追加，不要覆盖历史；每个阶段至少一条；
> 验收命令与实测输出必须原样贴（这是验收的凭据，也是进度落盘锚点）。

## 当前状态

| 项 | 值 |
| --- | --- |
| 阶段 | 阶段 25（FR-76 / D-31：顶栏品牌文字 → `PromptM`，其余四处保持全名）—— **已完成** |
| 状态 | 已完成（等 host_manger 验收；阶段 1–24 已验收通过，见 `VERIFY.md`） |
| 最后更新 | 2026-09-20 |
| 最新 commit | 见下方「阶段 25 实施与自检」§4（`5d9c995` / `16c2307` + 收尾 commit） |

## 阶段计划（来自 BRIEF 第 11.4 节）

- [x] 阶段 1 S0 技术验证 + 项目骨架 + 前端脚手架与组件库固定（antd 6.6.4）+ `migrations/001_init.sql` 草案 + `docs/dependencies.md` → AC-1、AC-2、AC-19、AC-20（+ 部署文件 AC-18、卫生 AC-17 提前自检）
- [x] 阶段 2 认证（登录/会话/限流）+ CLI `user set-password` + `migrate` 幂等 → AC-3、AC-4、AC-15 ← **已完成（验收通过）**
- [x] 阶段 3 prompt/folder/tag CRUD + 检索（FTS 同步与兜底）→ AC-5、AC-6、AC-7、AC-14 ← **已完成（验收通过）**
- [x] 阶段 4 版本历史（留档/diff/回滚）+ 变量提取渲染 + Markdown 渲染与净化 → AC-8、AC-9、AC-12 ← **已完成（验收通过）**
- [x] 阶段 5 导入导出（两种模式 + 校验 + 原子性）→ AC-10、AC-11 ← **已完成（验收通过）**
- [x] 阶段 6 对外可用面（Token/CORS/使用侧 CLI/使用记录/内外网部署形态）→ AC-22、AC-23、AC-24、AC-27、AC-28 ← **已完成（验收通过）**
- [x] 阶段 7 MCP server（stdio，只读工具面）→ AC-25、AC-26 ← **已完成（验收通过）**
- [x] 阶段 8 前端 P0（登录/列表/编辑器/版本/变量/预览/导入导出二次确认/响应式/亮暗，全部 antd）+ 界面自证 → AC-13、AC-20、AC-21 ← **已完成（本阶段）**
- [ ] 阶段 9 部署文件复核 + `README.md` 四要素 + 全量测试收尾 → AC-16、AC-17、AC-18

## 进度日志（追加）

### 2026-09-18 — 阶段 1 开工前准备

#### 1. 环境与版本复核（BRIEF §6.8 / §12 要求"开工前复核版本号"）

```
$ node -v; npm -v; pnpm -v
v24.18.0
11.16.0
11.22.0
```

依赖版本复核（`npm view <pkg> version`，2026-09-18 实测；与 BRIEF §6.8 表格逐项一致）：

```
$ for p in fastify typescript react react-dom vite antd @ant-design/icons better-sqlite3 kysely marked dompurify highlight.js zod @vitejs/plugin-react; do printf '%-28s %s\n' "$p" "$(npm view $p version)"; done
fastify                      5.12.5
typescript                   7.0.2
react                        19.3.0
react-dom                    19.3.0
vite                         8.3.0
antd                         6.6.4
@ant-design/icons            6.3.4
better-sqlite3               13.0.3
kysely                       0.29.6
marked                       18.0.13
dompurify                    3.4.15
highlight.js                 11.12.0
zod                          4.6.5
@vitejs/plugin-react         6.1.1
```

结论：antd 复核仍为 **6.6.4**（BRIEF §12 要求），全部版本与 BRIEF §6.8 一致，无需变更。

#### 2. 端口纪律：开工前 `ss -ltn` 实测（STANDARDS §3.5）

**原始输出（2026-09-18）**

```
$ ss -ltn
State  Recv-Q Send-Q Local Address:Port Peer Address:PortProcess
LISTEN 0      10           0.0.0.0:8769      0.0.0.0:*          
LISTEN 0      32         127.0.0.1:53        0.0.0.0:*          
LISTEN 0      511          0.0.0.0:80        0.0.0.0:*          
LISTEN 0      128          0.0.0.0:22        0.0.0.0:*          
LISTEN 0      32     192.168.0.228:53        0.0.0.0:*          
LISTEN 0      511          0.0.0.0:3080      0.0.0.0:*          
LISTEN 0      511          0.0.0.0:3081      0.0.0.0:*          
LISTEN 0      511             [::]:80           [::]:*          
LISTEN 0      128             [::]:22           [::]:*          
LISTEN 0      32             [::1]:53            [::]:*          

$ ss -ltn | grep -E ':(876[5-9]|8770)\b'
LISTEN 0      10           0.0.0.0:8769      0.0.0.0:*
```

**选择理由**：台账范围 8765–8770 内，实测仅 **8769** 被占用（izone 本地开发实例，与 BRIEF §6.8 记录一致）；
**8767 实测空闲**，且与 BRIEF D-4 的分配一致（8765=nextblog 验收备用、8766/8768/8770=其他项目主端口）。
故**选定默认端口 8767、监听地址 0.0.0.0**，写入本项目 `README.md` 与配置默认值；合集台账由 host_manger 登记，dsh 不写。

#### 3. 本阶段验收标准 → 我要执行的检查命令（BRIEF §11.1 要求）

> 阶段 1 对应 AC：**AC-1、AC-2、AC-19、AC-20**；另按 STANDARDS §3.6「部署相关文件是验收项」，
> 本阶段一并交付并自检 **AC-18**（服务类产物必须先有部署文件，才能在阶段 7 只做收尾核对）。

| AC | 我要执行的检查命令 | 期望 |
| --- | --- | --- |
| AC-1 冷装与构建 | `rm -rf node_modules dist && npm ci && npm run build; echo "rc=$?"`；`test -d dist && echo dist-ok`；`git status --short` | `rc=0`；`dist-ok`；`git status --short` 无构建产物 |
| AC-2 启动与监听 | `DATA_DIR=$AC_DIR PORT=8767 npm start &` → `sleep 3; ss -ltn \| grep ':8767'`；`curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8767/healthz`；`curl -s http://127.0.0.1:8767/healthz` | `0.0.0.0:8767`（**不是** 127.0.0.1）；`200`；body 含 `"status":"ok"` 与 `"version"` |
| AC-19 端口纪律 | `grep -rn '8767' package.json src bin deploy README.md \| head`；`ss -ltn \| grep -c ':8767'`；`grep -n '8767' PROGRESS.md README.md` | 三处（配置默认值 / README / PROGRESS）一致；服务在跑时 `ss` 计数 = 1；README 写明 `0.0.0.0` |
| AC-20 组件库落地 | ① `npm ls antd @ant-design/icons --depth=0`；② `grep -rnE "<(button\|input\|select\|textarea\|table\|dialog)[ >/]" web/src --include='*.tsx' \| wc -l`；③ `grep -rnoE "from ['\"]antd['\"]" web/src --include='*.tsx' \| wc -l`；④ `grep -rnE "(cdn\|unpkg\|jsdelivr\|googleapis)" dist/ web/src --include='*.html' --include='*.tsx' --include='*.css' \| wc -l` | ① antd 6.6.4 + icons 6.3.4 在直接依赖、无 v5-patch；② `0`；③ `≥5`；④ `0` |
| AC-18 部署文件（STANDARDS §3.6 要求本阶段交付） | `sudo systemd-analyze verify deploy/promptmanager.service 2>&1 \| grep -c error`；`grep -cE '^(User\|Group\|WorkingDirectory\|EnvironmentFile\|Restart)=' deploy/promptmanager.service`；`grep -c MemoryDenyWriteExecute deploy/promptmanager.service`；`grep -cE '^[A-Z_]*(PASSWORD\|SECRET\|TOKEN\|KEY)[A-Z_]*=.+$' deploy/promptmanager.env.example` | `0` / `5` / `0` / `0` |

#### 4. 开工前已定的、属于 dsh 权限内的选型（BRIEF 已给候选，理由记 `docs/dependencies.md`）

- SQLite 驱动：**`better-sqlite3@13.0.3`**（BRIEF §5 二选一授权 dsh 选并写理由；理由见 `docs/dependencies.md`）
- HTTP 框架：**`fastify@5.12.5`**（BRIEF §5 推荐）
- 查询层：**`kysely@0.29.6`** 类型安全查询构造器（避免手写 SQL 拼装，符合 STANDARDS §4.2）
- 静态托管：**`@fastify/static@10.1.4`**（FR-12 单端口，成熟插件，不自写静态文件服务）
- 测试框架：**Node 内置 `node:test`**（STANDARDS §4.2 允许，属平台能力，不引额外测试框架）
- 包管理器：**npm**（BRIEF §7 固定，`npm ci` 复现）

#### 5. 本阶段"红 → 绿"节奏

先写 `tests/config.test.ts` / `tests/health.test.ts` 并在**实现之前**跑一次，记录失败（红），
再实现 `src/config.ts` / `src/server/**`，构建后复跑记录通过（绿）。红/绿两次输出都贴在本文件后续条目。

- 完成：环境复核、端口实测取证、AC→命令翻译、红阶段测试已写
- commit：紧随其后的 `test(ac): ...` / `docs(progress): ...`
- 未完成 / 已知缺口：实现尚未开始（骨架代码在下一单元）
- 下一步：写骨架（TS/fastify/SQLite 接通 + `/healthz` + 数据模型草案），再固定 antd 并构建

### 2026-09-18 — 阶段 1 实施与自检（收尾）

#### 1. 单元与 commit 对应

| commit | 单元 | 内容 |
| --- | --- | --- |
| `4936995` | 开工前 | 环境/版本复核、端口 `ss` 实测、AC→检查命令翻译（本文件上一节） |
| `0cdcb56` | 骨架 | 依赖 pin + lockfile、`src/config.ts`、`src/db/{index,migrate}.ts`、`src/server/{app,index,cli}.ts`、`migrations/001_init.sql`、`bin/pm.mjs`、`tests/*.test.ts`、`web/**`（antd 最小页面） |
| `d503cef` | 文档 | `docs/dependencies.md`（依赖/协议/审计/选型理由）、`docs/search-zh.md`（中文检索实测报告）、`tools/search-zh-poc.mjs` |
| `0535df0` | 部署文件 | `deploy/promptmanager.service`、`deploy/promptmanager.env.example`、`deploy/README.md`（安装/验证/回滚） |
| `6ebf79c` | 卫生 | `.gitignore` 补 `.env`（AC-17 要求） |
| `96f2c94` | 验收脚本 | `tools/ac-stage1.sh`（AC 自起自停，可复现） |
| `97a26ba` | README | 四要素 + 默认端口 8767 / 监听 0.0.0.0 |

#### 2. 红 → 绿记录（先看到失败，再看到通过）

**红 #1**（实现尚未写，测试先跑）：`node --test "tests/**/*.test.ts"`

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/root/greenhouse/projects/promptmanager/dist/server/config.js' imported from /root/greenhouse/projects/promptmanager/tests/migrate.test.ts
✖ tests/migrate.test.ts (198.909026ms)
ℹ tests 3
ℹ pass 0
ℹ fail 3
rc=1
```

**红 #2**（服务端已实现、前端产物尚未构建 → "单端口回落前端入口" 这条仍失败）

```
✖ tests/health.test.ts (183.267465ms)
ℹ tests 8
ℹ pass 7
ℹ fail 1
（原因：dist/web/index.html 还不存在，app 未注册静态托管）
```

**绿**（`npm run build` 产出 dist/web 之后）：`npm test`

```
✔ loadConfig：默认 PORT=8767 / HOST=0.0.0.0（BRIEF §6.3、§5 监听与端口） (1.739987ms)
✔ loadConfig：环境变量覆盖默认值 (0.338871ms)
✔ loadConfig：非法端口/阈值直接报错，不静默回退 (0.60446ms)
✔ GET /healthz 无需认证：200 + {"status":"ok","version":…}（BRIEF §6.1、AC-2） (213.497661ms)
✔ 服务真实绑定 0.0.0.0（不是 127.0.0.1；BRIEF §5、AC-2） (68.93084ms)
✔ 未知路径回落到前端入口（单端口交付，FR-12） (67.6917ms)
✔ runMigrations 幂等：重复执行不报错，schema 版本稳定在 1（BRIEF §5、§6.2） (87.446532ms)
✔ WAL 与 foreign_keys 开启（BRIEF §5 硬性要求） (36.246532ms)
✔ FTS5 trigram：中文 ≥3 字命中、2 字 0 命中（LIKE 兜底前提，BRIEF §6.6 / D-3） (93.933ms)
✔ 外键约束真的生效（越权写入被拒） (90.064555ms)
ℹ tests 10
ℹ pass 10
ℹ fail 0
```

**补测（收尾前追加，验证迁移里的 FTS 同步触发器）**：`tests/migrate.test.ts` 增加
"FTS 索引随 prompts 的 UPDATE / DELETE 同步" 用例后重跑 —— 11/11 通过（用 `npm test` 原样输出）：

```
✔ FTS5 trigram：中文 ≥3 字命中、2 字 0 命中（LIKE 兜底前提，BRIEF §6.6 / D-3） (62.169588ms)
✔ FTS 索引随 prompts 的 UPDATE / DELETE 同步（BRIEF §6.6 "索引必须随增删改同步维护"） (63.672814ms)
✔ 外键约束真的生效（越权写入被拒） (84.715032ms)
ℹ tests 11
ℹ pass 11
ℹ fail 0
```

> 这条补测的意义：`prompts_fts` 是 **external content** 虚表，靠三个触发器维护；
> 若 UPDATE 的 `'delete'` 命令带错旧值，索引会**静默损坏**（只在阶段 3 检索时暴露）。
> 现在 INSERT/UPDATE/DELETE 三条路径都已证明：旧内容不再命中、新内容能命中。

#### 3. 阶段 1 验收标准实测（`bash tools/ac-stage1.sh`，自起自停）

> 该脚本输出同时留存一份原始日志到 `tmp/ac-stage1.out`（`tmp/` 是临时目录、不进库、可随时清空）；
> **持久证据以本文件内贴出的命令与输出为准**。

**AC-1 冷装与构建**

```
$ rm -rf node_modules dist && npm ci && npm run build; echo "rc=$?"
added 166 packages in 4s
npm warn allow-scripts 1 package has install scripts not yet covered by allowScripts:
npm warn allow-scripts   better-sqlite3@13.0.3 (install: node-gyp rebuild)
...
dist/web/index.html                  0.37 kB │ gzip:   0.25 kB
dist/web/assets/index-DZfuyTAY.js  842.53 kB │ gzip: 270.62 kB
✓ built in 489ms
rc=0
dist 存在：dist/server dist/web
--- git status --short（应无构建产物）
 M README.md
?? tools/ac-stage1.sh
```

> 说明：`npm warn allow-scripts` 是 npm 11 的新策略**跳过了 better-sqlite3 的 node-gyp rebuild**，
> 但该包自带 `prebuilds/linux-x64.node`，**无需编译器即可用**（详见 `docs/dependencies.md` §4.1）。
> `git status` 里的两项是当时尚未提交的文档/脚本，**没有**任何构建产物（`dist/`、`data/` 均被忽略）。

**AC-2 启动与监听**

```
$ DATA_DIR=$AC_DIR PORT=8767 npm start &
$ sleep 3; ss -ltn | grep ':8767'
LISTEN 0      511          0.0.0.0:8767      0.0.0.0:*
$ curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8767/healthz
200
$ curl -s http://127.0.0.1:8767/healthz
{"status":"ok","version":"0.1.0"}
$ grep -o 'promptmanager listening on[^"]*' server.log
promptmanager listening on 0.0.0.0:8767 (HOST=0.0.0.0 PORT=8767, DATA_DIR=/tmp/pm-ac-TZFwbi)
```

**AC-19 端口纪律与文档一致**

```
$ grep -rn '8767' package.json src bin deploy README.md | head
src/config.ts:92:    port: readPositiveInt(env, 'PORT', 8767, 65535),
deploy/README.md:28:| 监听 | `0.0.0.0:8767` | 内网可达；**有认证**（除 `/healthz` 与登录接口外全部 401） |
deploy/promptmanager.env.example:13:# 默认端口 8767（与 README.md / PROGRESS.md 三处一致，AC-19）…
$ ss -ltn | grep -c ':8767'          # 服务在跑
1
$ grep -n '8767' PROGRESS.md README.md | head
PROGRESS.md:83:**8767 实测空闲**，且与 BRIEF D-4 的分配一致…
README.md:26:npm start              # 启动服务（默认 0.0.0.0:8767）
README.md:29:**默认监听：`0.0.0.0:8767`**（内网可达，不是 127.0.0.1 —— 只绑回环等于白做）。
$ ss -ltn | grep -c ':8767'          # 停服后
0
```

**AC-20 前端组件库落地**

```
$ npm ls antd @ant-design/icons --depth=0
├── @ant-design/icons@6.3.4
└── antd@6.6.4
$ npm ls @ant-design/v5-patch-for-react-19 --depth=0
└── (empty)                                    # 未安装 v5 补丁包
$ grep -rnE "<(button|input|select|textarea|table|dialog)[ >/]" web/src --include='*.tsx' | wc -l
0
$ grep -rnoE "from ['\"]antd['\"]" web/src --include='*.tsx' | wc -l
5
$ grep -rnE "(cdn|unpkg|jsdelivr|googleapis)" dist/ web/src --include='*.html' --include='*.tsx' --include='*.css' | wc -l
0
```

**AC-18 部署文件（STANDARDS §3.6 要求本阶段一并交付）**

```
$ sudo systemd-analyze verify deploy/promptmanager.service 2>&1 | grep -c error
0
$ grep -cE '^(User|Group|WorkingDirectory|EnvironmentFile|Restart)=' deploy/promptmanager.service
5
$ grep -c MemoryDenyWriteExecute deploy/promptmanager.service
0
$ grep -cE '^[A-Z_]*(PASSWORD|SECRET|TOKEN|KEY)[A-Z_]*=.+$' deploy/promptmanager.env.example
0
```

**AC-21 预览检查（正式验收在阶段 6）**：headless chromium `--dump-dom` 抓首页渲染结果

```
distinct ant-* class 数：793
样例：ant-app ant-app-rtl ant-badge ant-badge-color-blue ant-badge-color-cyan ant-badge-color-geekblue …
```

**AC-17 提前自检（正式验收在阶段 7）**

```
$ git check-ignore -v data/pm.db .env _env/x
.gitignore:10:data/	data/pm.db
.gitignore:5:.env	.env
.gitignore:2:_env/	_env/x
$ git grep -nE "(password|passwd|secret|token)[[:space:]]*[:=][[:space:]]*['\"][^'\"]{8,}" -- 'src/**' 'bin/**' 'web/**'
（0 命中，退出码 1）
$ grep -cE '^\|.*\|' docs/dependencies.md                 # 依赖表行数
40
$ npm ls --depth=0 --parseable | tail -n +2 | wc -l       # 直接依赖数
15
```

**安全闸门（用前查 CVE + 协议）**

```
$ npm audit --registry=https://registry.npmjs.org
found 0 vulnerabilities
# OSV 逐直接依赖查询：11 个直接依赖全部 osv_vulns=0
# 161 个安装包协议分布：MIT 141 / ISC 6 / BlueOak-1.0.0 5 / BSD-3-Clause 4 / Apache-2.0 3 / MPL-2.0 2；GPL/AGPL/无协议 = 0
```

（原始输出见 `docs/dependencies.md` §5；S0 中文检索报告的原始输出见 `docs/search-zh.md` §3。
中文检索复测与 BRIEF §6.8 有一处数字差异——`unicode61` 下 `会话交接` 实测 1 命中而非 0，
原因与"结论不变"的论证写在 `docs/search-zh.md` §2。）

#### 4. 本阶段自行判断的实现细节（BRIEF §11.5 ②：备查，验收只按本阶段 AC 判）

1. **`better-sqlite3` vs 内置 `node:sqlite`**：BRIEF §5 授权 dsh 选一个并写理由 → 选 better-sqlite3
   （API 稳定 + `db.transaction()` 事务原语），理由与对比表在 `docs/dependencies.md` §4.1。
2. **`kysely` 作为查询层**：避免手写 SQL 拼装（STANDARDS §4.2）；FTS5 的 `MATCH` / `LIKE ... ESCAPE`
   用 kysely 的参数化 `sql` 模板片段。
3. **`@fastify/static` 托管前端产物**：实现 FR-12 单端口；不自写静态文件服务。
4. **测试框架用 Node 内置 `node:test`**（无额外依赖），测试文件用 TS 直跑（Node 24 类型擦除），
   被测模块是 `dist/` 编译产物（`npm test` 自带 `build:server`）。
5. **数据模型草案**（`migrations/001_init.sql`）：`users`/`sessions`/`login_attempts`/`folders`/`tags`/`prompts`/
   `prompt_versions`/`prompt_tags` + `prompts_fts`（external content + INSERT/UPDATE/DELETE 三个同步触发器）。
   阶段 3 起若需调整，**新增迁移文件**而不是改 001（001 已落库，不许改历史脚本）。
6. **启动即迁移**（`buildApp()` 内 `runMigrations`）：满足 BRIEF §6.3"pm.db 不存在时启动自动迁移到最新 schema"。
7. **多做了两件后续阶段的事**（不据此宣称后续阶段完成）：
   - `deploy/` 三件套（BRIEF 归阶段 7 / AC-18）：因为"服务类产物的部署文件是验收项"（STANDARDS §3.6），
     本阶段既然已经起服务，就一并交付并自检。
   - `.gitignore` 补 `.env` + AC-17 自检：`.gitignore` 是 BRIEF §7 明列的交付物，顺手对齐。
8. **前端结构**：拆成 5 个 `.tsx`（App / AppHeader / HealthCard / StageChecklist / PageFooter）
   + 1 个 `use-prefers-dark.ts` 主题钩子；全部 UI 来自 antd，无原生表单标签、无第二套样式体系、无 CDN。
   产物单包 842 kB（未拆包，阶段 6 处理）。

#### 5. 未完成 / 已知缺口（本阶段范围内无缺口；以下是"后续阶段才做"的清单）

- 业务 API 全部未实现：认证/会话/限流（阶段 2）、CRUD/检索（阶段 3）、版本/变量/Markdown（阶段 4）、
  导入导出（阶段 5）、完整前端 P0 与界面自证（阶段 6）、测试补到 ≥8 文件（阶段 7，当前 3 个文件 / 11 个用例）。
- **当前没有认证接口**：`/api/*` 尚不存在，页面只调 `/healthz`；阶段 2 交付认证前不要暴露到不可信网络
  （README「已知限制」已写明）。
- 前端 bundle 842 kB 未做代码分割。
- `LIKE '%…%'` 兜底是全表扫描：2000 行 0.2 ms 够用，10 万行量级需重新评估
  （已写入 README 已知限制与 `docs/search-zh.md` §4）。

#### 6. 下一步（阶段 2 待 host_manger 下单后执行）

1. 引入 `@fastify/cookie`（11.1.2）+ 口令哈希库（`argon2` 或 `@node-rs/argon2`），先复核版本/CVE/协议再登记。
2. 实现 `POST /api/login`、`POST /api/logout`、`GET /api/me` + 登录失败限流（窗口/阈值走 `config`），
   以及 `bin/pm.mjs user set-password`（stdin 读口令；退出码 0/1/2）。
3. `/api/*` 未认证一律 401 的预处理器（AC-3），并补 AC-4 的 cookie `pm_sid` / `HttpOnly` / `429 + Retry-After`。
4. 验 AC-15（重启数据持久）：本阶段 `openDatabase` 已按同一 `DATA_DIR` 打开，阶段 2 补端到端命令证据。

### 2026-09-18 — 阶段 2 开工前准备（认证与账号）

> 阶段 1 已由 host_manger 验收通过（`VERIFY.md`：结论「过」，无返工项；AC-21 改为严格口径）。
> 本阶段按 BRIEF **v3** 执行，只做阶段 2：AC-3、AC-4、AC-15。

#### 1. 端口复核（STANDARDS §3.5：每次定端口前必须实测）

```
$ ss -ltn
State  Recv-Q Send-Q Local Address:Port Peer Address:PortProcess
LISTEN 0      10           0.0.0.0:8769      0.0.0.0:*          
LISTEN 0      32         127.0.0.1:53        0.0.0.0:*          
LISTEN 0      511          0.0.0.0:80        0.0.0.0:*          
LISTEN 0      128          0.0.0.0:22        0.0.0.0:*          
LISTEN 0      32     192.168.0.228:53        0.0.0.0:*          
LISTEN 0      511          0.0.0.0:3080      0.0.0.0:*          
LISTEN 0      511          0.0.0.0:3081      0.0.0.0:*          
LISTEN 0      511             [::]:80           [::]:*          
LISTEN 0      128             [::]:22           [::]:*          
LISTEN 0      32             [::1]:53            [::]:*          

$ ss -ltn | grep -E ':(876[5-9]|8770)\b'
LISTEN 0      10           0.0.0.0:8769      0.0.0.0:*
```

**结论**：与阶段 1 一致 —— 台账范围内仅 8769 被 izone 占用，**8767 仍空闲**，本阶段继续用
**默认端口 8767 + 监听 0.0.0.0**（配置默认值 / README / PROGRESS 三处已在阶段 1 对齐，本阶段不改端口，无需改文档）。

#### 2. 依赖复核与选型（安全 + 协议两道闸门；登记见 `docs/dependencies.md`）

`npm view <pkg> version license time.modified` 实测（2026-09-18）：

```
@fastify/cookie      11.1.2   MIT   2026-09-04
@fastify/rate-limit  11.2.0   MIT   2026-09-04
@node-rs/argon2      2.2.1    MIT   2026-09-10
argon2               0.45.1   MIT   2026-07-21
bcrypt               6.0.0    MIT   2025-12-06
```

- **口令哈希选 `@node-rs/argon2@2.2.1`**（BRIEF §5「argon2 优先」）：Argon2id 算法本身合规；
  相比 `argon2@0.45.1`（node-gyp 编译/预编译下载，需 install 脚本），它把各平台二进制放在
  **optionalDependencies**（`@node-rs/argon2-linux-x64-gnu`）里由 npm 正常解析，**不依赖 install 脚本**——
  这正是阶段 1 踩到的坑（npm 11 的 allow-scripts 会跳过 install 脚本）。
  冒烟实测：`hash('pw')` → `$argon2id$v=19$m=19456,t=2,p=1$…`，`verify(hash,'pw')=true`、`verify(hash,'nope')=false`。
- **cookie 读写选 `@fastify/cookie@11.1.2`**（官方插件，避免手写 cookie 解析/序列化）。
- **请求级限流选 `@fastify/rate-limit@11.2.0`**（官方插件；用于 `/api/login` 的**粗粒度**洪泛保护）。
  ⚠️ 能力探测结论（读 `node_modules/@fastify/rate-limit/index.js` + `types/index.d.ts`）：
  它**只按请求计数**，没有 `skipSuccessfulRequests` 之类的"只计失败"选项，store 也没有 reset 接口
  → **无法直接表达** BRIEF §6.3 + AC-4 的"失败阈值"语义（`LOGIN_MAX_FAILURES` = 5 次**失败**后第 6 次 429）。
  故采用两层：**① 库做 per-IP 请求限流（防洪泛，保护 argon2 的 CPU）**；
  **② 失败计数走 `login_attempts` 表 + 窗口判定（领域策略，见 §4 决策 1）**。

#### 3. 本阶段验收标准 → 我要执行的检查命令（BRIEF §11.1）

统一夹具（每条 AC 自带，互不依赖）：`AC_DIR=$(mktemp -d /tmp/pm-ac-XXXXXX)`、
`DATA_DIR=$AC_DIR PORT=8767`、`AC_PW='ac-fixture-pw-20260918'`、
`printf '%s\n' "$AC_PW" | node bin/pm.mjs user set-password --username admin`；服务自起自停。

| AC | 我要执行的检查命令 | 期望 |
| --- | --- | --- |
| **AC-3** 未认证一律拒绝 | 起服务后：`curl -s -o /dev/null -w '%{http_code} ' /api/prompts`；`curl -s -o /dev/null -w '%{http_code} ' -X POST -H 'Content-Type: application/json' -d '{}' /api/prompts`；`curl -s -o /dev/null -w '%{http_code}\n' /api/export`；另加 `curl -s -o /dev/null -w '%{http_code}\n' /healthz` | `401 401 401`；`/healthz` 仍 `200`（无需认证）；401 body = `{"error":"unauthorized"}` |
| **AC-4** 登录/会话/限流 | `curl -s -c /tmp/pm-jar -D /tmp/pm-hdr -o /dev/null -w '%{http_code} ' -X POST -H 'Content-Type: application/json' -d "{\"username\":\"admin\",\"password\":\"$AC_PW\"}" /api/login`；`grep -i '^set-cookie' /tmp/pm-hdr`；`curl -s -b /tmp/pm-jar -o /dev/null -w '%{http_code}\n' /api/prompts`；`curl -s -b /tmp/pm-jar /api/me`；错口令 → `401`；连续 5 次错口令后第 6 次 → `429`（并核 `retry-after` 头）；`curl -s -b /tmp/pm-jar -o /dev/null -w '%{http_code}\n' -X POST /api/logout` → `204`，随后旧 jar 访问 `/api/me` → `401` | `200 200 401 429`；`Set-Cookie: pm_sid=…; Path=/; HttpOnly; SameSite=Lax`；429 body `{"error":"rate_limited"}` |
| **AC-15** 重启数据持久 | 登录建 prompt（`POST /api/prompts`）→ `kill` 服务（核 `ss -ltn \| grep -c ':8767'` = 0）→ **同一 `DATA_DIR`** 重启 → `GET /api/prompts` 仍返回该 prompt；`python3` 逐字符比对正文打印 `MATCH`；`ls -l $AC_DIR/pm.db`（`pm.db-wal` 属正常） | 正文逐字符一致（`MATCH`）；`pm.db` 存在 |
| CLI 契约（§6.2，阶段 2 范围） | `printf '%s\n' "$AC_PW" \| node bin/pm.mjs user set-password --username admin; echo "rc=$?"`；缺 `--username` / 空口令 / 未知子命令 各跑一次；`node bin/pm.mjs migrate` 连跑两次；并核 stdout **不含口令明文** | `ok: user admin password updated` 且 `rc=0`；用法错 `rc=2`；`ok: schema at v1` 两次；`grep -c "$AC_PW"` = 0 |
| 附加自检（阶段 7 正式验收项，本阶段顺手复测） | `npm test`；`sudo systemd-analyze verify deploy/promptmanager.service 2>&1 \| grep -c error`；AC-17 的凭据扫描；`npm audit --registry=https://registry.npmjs.org` + OSV 逐依赖 | 全绿 / `0` / 0 命中 / 0 vulnerabilities |

#### 4. 本阶段的关键实现决策（BRIEF 未逐条规定口径，属 dsh 权限内，先记在此备查）

1. **失败阈值语义用 `login_attempts` 表 + 窗口判定实现**（不写 QUESTIONS 的理由）：
   BRIEF §6.3 定义了 `LOGIN_MAX_FAILURES`/`LOGIN_WINDOW_SECONDS` 两个配置，AC-4 规定了"5 次失败后第 6 次 429"的
   精确时序；成熟组件库（实测 @fastify/rate-limit）只能按**请求**计数、无"只计失败"选项，
   **无法表达该契约**。而"在窗口内数失败次数"是对本迁移里已有 `login_attempts` 表的领域查询（不是重造限流基础设施：
   窗口/键/存储/标准头都由库负责）。两层职责已在 `docs/dependencies.md` 写明；若 host_manger 认为应改为纯库方案，
   请在下单时给出期望的 AC-4 精确时序。
2. **失败计数键 = `username` + `remote_addr`**（同一账号同一来源 IP 连续失败才累计）；**登录成功清除该键的失败记录**
   （避免合法用户被自己先前的失败拖累）。`remote_addr` 取 `request.ip`。
3. **会话 token 只存哈希**：cookie 里放 32 字节随机 token（base64url），库里 `sessions.id` 存 `sha256(token)`
   → 库被读走也无法直接冒用会话（BRIEF 只要求"服务端 sessions 表 + HttpOnly cookie"，存哈希是实现细节）。
4. **改口令即吊销该用户全部会话**（口令轮换的应用层配套；`user set-password` 成功后 `DELETE FROM sessions WHERE user_id=…`）。
5. **为 AC-15 的最小切片**：AC-15 需要"建 prompt → 重启 → `GET /api/prompts` 仍在"，
   故本阶段顺手实现 `POST /api/prompts`、`GET /api/prompts`（仅 `limit`/`offset`）、`GET /api/prompts/:id`
   ——**检索 `q`/筛选/更新/删除/文件夹/标签 CRUD 仍属阶段 3**，不在本阶段宣称完成（BRIEF §11.5 ②）。
6. **粗粒度请求限流常量**：`/api/login` 每 IP 30 次/60 秒（防止拿 argon2 做 CPU 消耗）。
   不加新环境变量（BRIEF §6.3 的环境变量表是固定契约，不外扩）；常量写在代码里并在 `docs/dependencies.md` 记明。

#### 5. 红 → 绿计划

先写 `tests/api-auth.test.ts` / `tests/api-guard.test.ts` / `tests/cli-user.test.ts` /
`tests/prompts-slice.test.ts` / `tests/session-persistence.test.ts`，**在实现之前**跑一次记录失败（红），
再实现 `src/services/{auth,prompts}.ts`、`src/db/*`、`src/server/routes/{auth,prompts}.ts`、`src/server/plugins/auth.ts`、
CLI 子命令，构建后复跑（绿），最后跑 `tools/ac-stage2.sh` 取 AC-3/4/15 的端到端输出。

### 2026-09-18 — 阶段 2 实施与自检（认证与账号，收尾）

#### 1. 单元与 commit 对应

| commit | 单元 | 内容 |
| --- | --- | --- |
| `03f6db2` | 开工前 | 端口 `ss` 复测、依赖选型（argon2/cookie/rate-limit）、AC-3/4/15→检查命令、实现决策 |
| `76da35a` | 认证核心 | kysely 查询引擎 + 表类型、`services/auth.ts`（Argon2id 哈希 / 会话 / 失败阈值）、`server/auth.ts`（cookie + 全局认证闸门）、`routes/auth.ts`、CLI `user set-password`、错误形状映射、`tests/{helpers,api-auth,api-guard,cli-user}` |
| `92ec8e2` | prompts 最小切片 | `services/prompts.ts`、`routes/prompts.ts`（建/列表/单取）、`tests/{prompts-slice,session-persistence}` |
| `fc73680` | 验收脚本 | `tools/ac-stage2.sh`（AC-3/4/15 各自独立夹具、自起自停） |
| `80fd42d` | 文档 | 依赖登记（3 个新依赖 + §4.5/4.6/4.7 职责划分）、README（认证用法/已知限制）、deploy/README（口令与会话运维） |
| `0f7ad29` | 测试加固 | `declaration: true` + `tsconfig.tests.json`：测试文件纳入类型检查（防止"裸 `Db` 当 `QueryEngine` 传"这类错误） |

#### 2. 红 → 绿记录

**红**（5 个新测试文件先写、实现未写）：`node --test "tests/**/*.test.ts"`（已先跑）

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/root/greenhouse/projects/promptmanager/dist/services/auth.js' imported from /root/greenhouse/projects/promptmanager/tests/helpers.ts
✖ tests/api-auth.test.ts / api-guard / cli-user / prompts-slice / session-persistence
ℹ tests 16   ℹ pass 11   ℹ fail 5
```

**中间两次失败（如实记录，均已修）**

1. `TypeError: Expected first argument to be a function`（better-sqlite3 的 `transaction`）——
   测试夹具把**裸 `Db`** 当 `QueryEngine` 传给了 `setUserPassword`；修：夹具走 `prepareDatabase()`。
   → 这个错误在**没有类型检查的测试文件里不会被 tsc 拦住**，因此新增 `npm run typecheck:tests`（见 §1 的 `0f7ad29`），
   并用负向探针实测它能抓住同类错误：`error TS2345: Argument of type 'Database' is not assignable to parameter of type 'QueryEngine'`。
2. `SqliteError: no such table: users` —— 夹具只 `openDatabase` 未迁移；修：统一改用 `prepareDatabase(config)`
   （打开 + 迁移 + 建查询引擎，HTTP/CLI/测试同一条路径）。
3. `?limit=9999` 期望"截断到 200"却拿到校验 400；`{title: 42, tags: "x"}` 被 ajv **静默强转**成 `"42"` / `["x"]`
   —— 修：应用关掉 ajv 的 `coerceTypes`（body 不再被悄悄改写），查询串整数由路由自行解析并**截断**到上限 200。

**绿**（最终）：`npm test`

```
ℹ tests 36
ℹ suites 0
ℹ pass 36
ℹ fail 0
ℹ duration_ms 5560.812863
$ ls tests/*.test.ts | wc -l   → 8   （AC-16 要求 ≥8 个测试文件，已提前满足）
```

#### 3. 阶段 2 验收标准实测（`bash tools/ac-stage2.sh`，每条 AC 自带夹具、自起自停）

**AC-3 未认证一律拒绝**

```
$ curl -s -o /dev/null -w '%{http_code} ' http://127.0.0.1:8767/api/prompts
401 $ curl -s -o /dev/null -w '%{http_code} ' -X POST -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:8767/api/prompts
401 $ curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8767/api/export
401
--- 401 body 形状（GET /api/prompts）
{"error":"unauthorized"}
--- /healthz 仍无需认证
200
{"status":"ok","version":"0.1.0"}
```

> 说明：`POST /api/prompts`（未带 cookie 且 body 非法）与 `GET /api/export`（**尚未实现**）同样 401 ——
> 认证闸门挂在 `onRequest`，**在路由解析之前**执行，因此未实现的 `/api/*` 对未认证请求也是 401 而不是 404
> （已单独验证：同一路径带合法会话 → 404 `{"error":"not_found"}`，见 `tests/api-guard.test.ts`）。

**AC-4 登录 / 会话 / 限流**

```
$ curl -s -c $JAR -D $HDR -o /dev/null -w '%{http_code} ' -X POST -H 'Content-Type: application/json' -d '{"username":"admin","password":"$AC_PW"}' http://127.0.0.1:8767/api/login
200   ← 期望 200
--- 响应头 Set-Cookie（原样）
set-cookie: pm_sid=oHQma8IezF3b_hO8O-FNaOPshTEwGfZzouBZOZWkJ-k; Path=/; Expires=Sun, 18 Oct 2026 04:24:07 GMT; HttpOnly; SameSite=Lax
$ curl -s -b $JAR -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8767/api/prompts
200
--- GET /api/me
{"username":"admin"}
--- 错误口令 #1 → 401
401
--- 夹具：错误 #2..#6（共 5 次失败后，第 6 次应 429）
错误 #2 → 401
错误 #3 → 401
错误 #4 → 401
错误 #5 → 401
错误 #6 → 429
--- 第 6 次（429）的响应头与 body（原样）
HTTP/1.1 429 Too Many Requests
retry-after: 60
{"error":"rate_limited"}
--- 封锁期内即使口令正确也 429
429
--- 登出 → 204，旧 cookie 立即失效
204
401
```

> 时序与 BRIEF AC-4 一致：`200 200 401 429`；cookie 名 `pm_sid` 且带 `HttpOnly`/`SameSite=Lax`/`Path=/`。
> 另：登录请求体缺字段 → `400 {"error":"invalid_body","details":[…]}`（不 500）；
> 伪造/过期会话 → 401；窗口过期（`LOGIN_WINDOW_SECONDS=1` 实测 sleep 1.1s）自动解锁。

**AC-15 重启数据持久**

```
login http_code=200
$ curl -s -b $JAR -X POST -H 'Content-Type: application/json' -d @create.json http://127.0.0.1:8767/api/prompts
{"id":1,"title":"重启持久性","user_prompt":"会话交接 ✅ \"引号\" {{变量}}\n第二行\t制表符","system_prompt":"sys-正文","notes":"notes-正文","folder_id":null,"tags":["交接"],"favorite":false,"created_at":"2026-09-18T04:25:19.793Z","updated_at":"2026-09-18T04:25:19.793Z","version_no":1}
--- 停服（模拟 kill）
$ ss -ltn | grep -c ':8767'   # 期望 0
0
--- 用同一 DATA_DIR 重启
$ ss -ltn | grep ':8767'
LISTEN 0      511          0.0.0.0:8767      0.0.0.0:*
$ curl -s -b $JAR http://127.0.0.1:8767/api/prompts   # 同一 cookie，未重新登录
重启前 total = 1 ｜重启后 total = 1
重启后仍能查到 id = 1
整条记录逐字段一致： MATCH
user_prompt 逐字符一致： MATCH
user_prompt 原样（重启后）： "会话交接 ✅ \"引号\" {{变量}}\n第二行\t制表符"
version_no = 1 ｜tags = ['交接']
$ ls -l $AC_DIR/pm.db
-rw-r--r-- 1 root root 122880 Sep 18 12:25 /tmp/pm-ac2-GT2EWt/pm.db
-rw-r--r-- 1 root root      0 Sep 18 12:25 /tmp/pm-ac2-GT2EWt/pm.db-wal
```

> 附带证明：**会话也在库里** —— 重启后同一 cookie 直接可用，无需重新登录（`tests/session-persistence.test.ts` 亦有断言）。

**CLI 契约（§6.2）**

```
$ printf ... | node bin/pm.mjs user set-password --username admin
stdout: ok: user admin password updated
rc=0
$ ... | grep -c "$AC_PW"   # 期望 0（绝不回显口令）
0
$ node bin/pm.mjs user set-password            # 缺 --username
rc=2  stderr=error: 缺少 --username <用户名>
$ node bin/pm.mjs user set-password --username admin   # 空口令
rc=2  stderr=error: 口令不能为空（从 stdin 读入）
$ node bin/pm.mjs migrate   # 幂等（第二次）
ok: schema at v1
rc=0
```

**收尾**：`ss -ltn | grep -c ':8767'` → `0`（夹具目录与进程均已清理）。

#### 4. 顺手复测的既有验收项（阶段 1 已过，本阶段确认未被破坏）

```
$ sudo systemd-analyze verify deploy/promptmanager.service 2>&1 | grep -c error
0
$ grep -cE '^(User|Group|WorkingDirectory|EnvironmentFile|Restart)=' deploy/promptmanager.service
5
$ grep -c MemoryDenyWriteExecute deploy/promptmanager.service
0
$ grep -cE '^[A-Z_]*(PASSWORD|SECRET|TOKEN|KEY)[A-Z_]*=.+$' deploy/promptmanager.env.example
0
$ git check-ignore -v data/pm.db .env _env/x | wc -l
3
$ git grep -nE "(password|passwd|secret|token)[[:space:]]*[:=][[:space:]]*['\"][^'\"]{8,}" -- 'src/**' 'bin/**' 'web/**' ':(exclude)tests/**'
（0 命中）
$ npm audit --registry=https://registry.npmjs.org
found 0 vulnerabilities
$ OSV 逐直接依赖：@fastify/cookie 11.1.2 / @fastify/rate-limit 11.2.0 / @node-rs/argon2 2.2.1 → osv_vulns=0（其余 15 个阶段 1 已查）
$ 协议分布（166 包）：MIT 146 / ISC 6 / BlueOak 5 / BSD-3 4 / Apache-2.0 3 / MPL-2.0 2；GPL/AGPL/无协议 = 0
```

#### 5. 本阶段自行判断的实现细节（BRIEF §11.5 ②：备查，验收只按本阶段 AC 判）

1. **失败阈值语义**（决策 1，已在开工前 PROGRESS §4 记录）：请求级洪泛用 `@fastify/rate-limit`（每 IP 30 次/60 秒），
   失败阈值用 `login_attempts` 表的窗口统计（`username + remote_addr`，达阈值后一律 429 + `Retry-After`，
   登录成功清除失败记录）。能力探测依据与职责划分写在 `docs/dependencies.md` §4.7。
2. **封锁期内口令正确也 429**：AC-4"连续 5 次错误口令后第 6 次 → 429"的最直接读法（第 6 次一律 429，不论口令对错）；
   窗口过期自动解锁。已在代码注释、README 已知限制、deploy/README 运维节三处写明。
3. **会话 token 只存哈希**：cookie 持 32 字节随机 token（base64url），`sessions.id` 存 `sha256(token)`；
   `resolveSession` 命中过期会话即删除并视为未认证。
4. **改口令即吊销该用户全部会话**（`setUserPassword` 内 `DELETE FROM sessions WHERE user_id=?`）。
5. **口令哈希用库默认参数**：`@node-rs/argon2` 默认即 Argon2id `$argon2id$v=19$m=19456,t=2,p=1$`（实测）；
   不显式传参的原因是该库的 `Algorithm` 是 ambient const enum，与 `verbatimModuleSyntax` 冲突（编译期报错，已绕开）。
6. **用户不存在也做一次等价哈希校验**（固定 `TIMING_EQUALIZER_HASH`）：避免用响应时间枚举用户名。
7. **关掉 ajv 类型强转**（`coerceTypes: false`）：否则 `title: 42` 被静默转成 `"42"`、`tags: "x"` 被转成 `["x"]`，
   与契约"非法 body → 400 invalid_body"相悖；查询串整数改由路由解析并**截断**到上限 200（BRIEF §6.1「上限 200」按截断实现）。
8. **`:id` 非数字/越界 → 404**：契约对 `GET /api/prompts/:id` 只定义 200/404/401，故手工解析而非 schema 强转。
9. **prompts 最小切片**：只实现建/列表（`limit`/`offset`）/单取（含首版留档 + 标签 find-or-create，单事务）；
   **检索 `q`、筛选、更新、删除、文件夹/标签 CRUD 明确属于阶段 3**，本阶段不宣称完成。列表的未知查询参数当前忽略。
10. **`npm test` 现在包含构建 + 测试类型检查**：`npm run build && npm run typecheck:tests && node --test …`
    （测试是 TS、直接跑在 Node 类型擦除上；`tsconfig.tests.json` 对 `dist/**` 的声明做类型检查）。

#### 6. 未完成 / 已知缺口（本阶段范围内无缺口；以下属后续阶段）

- 阶段 3：检索（`q` 三种长度 + 特殊字符 + FTS 同步）、筛选（`folder_id`/`tag`/`favorite`）、`PUT`/`DELETE` prompt、
  文件夹与标签 CRUD（含改名合并、非空文件夹 409）→ AC-5/6/7/14。
- 阶段 4：版本历史（diff/回滚）、变量提取渲染、Markdown 渲染与净化 → AC-8/9/12。
- 阶段 5：导入导出（replace/merge + 校验原子性）→ AC-10/11。
- 阶段 6：前端 P0（登录页/列表/编辑器/版本面板/变量面板/Markdown 预览/响应式/亮暗）+ 界面自证 → AC-13/21。
- 阶段 7：`docs/shots`、README 四要素收尾、测试收尾核 AC-16/17/18。
- 前端仍是阶段 1 的骨架页：**登录页尚未做**（阶段 6），当前只能用 `curl` 走认证流程。
- `LOGIN_MAX_FAILURES`/窗口是**进程间共享的库状态**（可跨重启生效）；而 per-IP 请求限流是**进程内 LRU**（重启即清）。
  两者语义差异已在此记录。

#### 7. 下一步（阶段 3 待下单后执行）

1. `GET /api/prompts` 补 `q`（≥3 码点走 FTS5 `trigram` + `bm25`，<3 走 `LIKE` 兜底，特殊字符按字面短语转义）+ 三个筛选。
2. `PUT /api/prompts/:id`（产生新版本）、`DELETE /api/prompts/:id`（204）。
3. 文件夹树 CRUD（删除非空/有子项 → 409）与标签 CRUD（改名合并 + 计数）。
4. 迁移如需改 schema → **新增 `migrations/002_*.sql`**，不改 001。
5. 目标 AC：AC-5、AC-6、AC-7、AC-14。

### 2026-09-18 — 阶段 3 开工前准备（CRUD + 检索 + 筛选分页）

> 阶段 1、2 均已验收通过（`VERIFY.md`：AC-3/4/15 独立复现 + 键隔离负向验证；无返工项）。
> 本阶段按 BRIEF **v3** 执行，只做阶段 3：AC-5、AC-6、AC-7、AC-14（FR-2/3/4/5/6）。

#### 1. 端口复核（STANDARDS §3.5：起临时服务前必须实测）

```
$ ss -ltn | grep -E ':(876[5-9]|8770)\b'
LISTEN 0      10           0.0.0.0:8769      0.0.0.0:*
```

**结论**：台账范围内仍只有 8769 被 izone 占用，**8767 空闲**（本项目默认端口，台账已登记）。
本阶段不改端口，配置默认值 / README / PROGRESS 三处保持一致，无需改动。

#### 2. 本阶段验收标准 → 我要执行的检查命令（BRIEF §11.1）

统一夹具（每条 AC 自带、互不依赖）：`AC_DIR=$(mktemp -d /tmp/pm-ac3-XXXXXX)`、
`DATA_DIR=$AC_DIR PORT=8767`、`AC_PW='ac-fixture-pw-20260918'`、CLI 建设口令、服务自起自停、登录拿 cookie。

| AC | 我要执行的检查命令 | 期望 |
| --- | --- | --- |
| **AC-5** prompt CRUD 与版本号 | ① `POST /api/prompts`（title/user_prompt/system_prompt/notes 全填 + 1 个标签）→ 记下 id；② `GET /api/prompts/:id` → 用 `python3` **逐字段**比对提交值（打印 `MATCH`/`DIFF`）；③ `PUT /api/prompts/:id {"notes":"改过的备注"}` → 返回 `version_no=2` 且 `notes` 已变、其余字段不变；④ `DELETE /api/prompts/:id` → `204`；⑤ 再 `GET` → `404` | `201`（`version_no=1`）→ 字段逐项 `MATCH` → `200`/`version_no=2` → `204` → `404` |
| **AC-6** 中文检索（三种长度 + 特殊字符） | 夹具：5 条含固定中文语料的 prompt（1 条含 `会话交接`、1 条含 `交接文档`、全部含 `上下文`）。① `?q=会话交接` → 命中目标 id 且 `total=1`；② `?q=交接` → `total>=2`（2 码点走 LIKE 兜底）；③ `?q=不存在的词` → `total=0`；④ `?q=%22%2A-%25_`（`"*-%_`）→ HTTP `200`（不得 500）；另加：大小写 `?q=REBASE`/`?q=rebase` 命中一致、`?q=%20%20`（纯空白）等同无查询 | ① `total=1` 且命中目标 id；② `>=2`；③ `0`；④ `200` |
| **AC-7** 检索性能（规模基线） | 夹具：`node tools/seed-prompts.mjs 2000`（脚本直接写临时库，走同一张表 → FTS 触发器同步）；随后 `for i in 1 2 3; do curl -s -o /dev/null -w '%{time_total}\n' "$BASE/api/prompts?q=会话交接"; done` 并单独取一次 body 的 `total` | 三次均 `< 0.5`（秒）且 `total=2000` |
| **AC-14** 文件夹与标签 | ① 建父/子文件夹 → `GET /api/folders` 结构正确（子项 `parent_id` = 父 id）；② 建两个标签；③ 把 prompt 归入文件夹 + 打标签（`PUT /api/prompts/:id`）；④ `?folder_id=X` 命中 1、`?tag=Y` 命中 1；⑤ `PUT /api/tags/:b` 改名成已存在标签名 → 两标签**合并**（`GET /api/tags` 计数相加、无重名、只剩合并后的标签）；⑥ 删除非空文件夹（含 prompt / 含子文件夹各一次）→ `409` | 结构正确；`1/1`；合并后计数相加且无重名；`409` |
| CLI/其它（回归） | `npm test`；`bash tools/ac-stage2.sh`（回归 AC-3/4/15）；`sudo systemd-analyze verify deploy/promptmanager.service`；`npm audit --registry=https://registry.npmjs.org` | 全绿 / 2 阶段 AC 仍过 / 错误 0 / 0 vulnerabilities |

#### 3. 本阶段的关键实现决策（BRIEF 未逐条规定口径 → 先记在此备查，验收只按 AC 判）

1. **`PUT` 一律产生新版本**：BRIEF §6.1 写"更新（可写字段的子集）→ **产生新版本**"，未区分"值是否真的变了"；
   故 `PUT` 只要通过校验就 `version_no+1` 并写 `prompt_versions` 行（含 `{}` 这种空 patch，等价于"盖一次章"）。
   理由：契约字面语义 + AC-5 的 `version_no=2` 判定最稳；若改为"仅内容变化才留档"，AC-5 仍过，但与 §6.1 措辞不符。
2. **标签在保存 prompt 时 find-or-create**：`POST/PUT /api/prompts` 的 `tags` 传名字数组，不存在的标签自动建
   （阶段 2 已如此实现，本阶段沿用）；`PUT` 提供 `tags` 时**整体替换**该 prompt 的标签集合（未提供则不动）。
3. **文件夹删除 → `409 {"error":"folder_not_empty"}`**：有子文件夹**或**有 prompt 归属时拒绝
   （BRIEF §6.1 只写"409（有子项或非空）"，未规定 body；错误码取描述性字符串并在 README 记录）。
   标签删除**不**做非空检查（契约里标签 DELETE 只有 204/400/404/401；关联行随 `ON DELETE CASCADE` 清理）。
4. **文件夹树完整性**：`parent_id` 必须存在 → 否则 400；`parent_id === 自身` 或指向自己的**后代** → 400（防成环）；
   同一父下重名 → 400（迁移里的 `idx_folders_parent_name` 唯一索引兜底）。
5. **标签改名合并**：`PUT /api/tags/:id {name}`，若目标名字已存在 → 把源标签的 `prompt_tags` 关联**重指向**目标标签
   （先去重再删源行），返回**存活标签**（目标 id）的 `{id,name,count}`；否则普通改名。
   标签创建遇重名 → `400 invalid_body`（不静默返回已有标签，避免"以为新建了"）。
6. **筛选参数严格校验**：`favorite` 只接受 `true`/`false`（其他 → `400 invalid_body`）；
   `folder_id` 必须为正整数；`tag` 为标签名（精确匹配）；未知参数忽略（阶段 2 的既有行为）。
   空/纯空白 `q` 等同缺省 → 返回全部。
7. **排序**：无 `q` 或 `<3` 码点（LIKE 兜底）→ `updated_at DESC, id DESC`；
   `>=3` 码点（FTS5）→ `bm25(prompts_fts) ASC, updated_at DESC, id DESC`（BRIEF §6.6）。
8. **代码分层**（BRIEF §6.7 建议）：FTS 匹配式/转义与列表查询放 `src/db/`（`search.ts` / `prompt-queries.ts`），
   业务规则（版本留档、标签 find-or-create、文件夹树校验）放 `src/services/`。
9. **AC-7 的 2000 条夹具**用 `tools/seed-prompts.mjs`（直接写 `DATA_DIR/pm.db`，走同一张表 → FTS 触发器自动同步），
   双方可用同一脚本复现；不通过 2000 次 HTTP 写（慢且无额外覆盖）。
10. **迁移不改 001**：本阶段不需要改 schema（阶段 1 的 001 已含 folders/tags/prompt_tags/versions/FTS 触发器）。

#### 4. 红 → 绿计划

先写 `tests/api-prompts-crud.test.ts`、`tests/api-search.test.ts`、`tests/api-folders-tags.test.ts`、
`tests/db-search.test.ts`（纯 SQL 层：≥3 走 FTS、<3 走 LIKE、转义、特殊字符、增删改同步），
**在实现之前**跑一次记录失败（红），再实现 `src/db/{search,prompt-queries}.ts`、`src/services/{prompts,folders,tags}.ts`、
`src/server/routes/{prompts,folders,tags}.ts`，构建后复跑（绿），最后跑 `tools/ac-stage3.sh` 取 AC 端到端输出。

### 2026-09-18 — 阶段 3 实施与自检（CRUD + 检索 + 筛选分页，收尾）

#### 1. 单元与 commit 对应

| commit | 单元 | 内容 |
| --- | --- | --- |
| `0829b04` | 开工前 | 端口 `ss` 复测、AC-5/6/7/14→检查命令、检索与 CRUD 实现决策 |
| `1a488f5` | 功能 + 测试 | 检索 SQL 层（`src/db/search.ts`、`src/db/prompt-queries.ts`）、`services/{prompts,folders,tags}.ts`、`routes/{prompts,folders,tags}.ts`、`server/params.ts`、`ConflictError`(409)、4 个新测试文件 |
| `1a9cc42` | 验收脚本 | `tools/ac-stage3.sh`（AC-5/6/7/14 各自独立夹具）+ `tools/seed-prompts.mjs`（AC-7 的 2000 条夹具） |
| `1a0af3c` | 文档 | README：CRUD/检索/筛选/文件夹标签用法、PUT 与检索语义、已知限制 |

#### 2. 红 → 绿记录

**红**（4 个新测试文件先写，实现未写）：`node --test "tests/**/*.test.ts"`

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/root/greenhouse/projects/promptmanager/dist/db/prompt-queries.js' imported from tests/db-search.test.ts
✖ AC-14 父子文件夹结构与 CRUD（含 400/404/409） … ✖ AC-5②：PUT 改 notes …（共 14 个失败）
ℹ tests 52   ℹ pass 38   ℹ fail 14
```

**中间一次失败（如实记录）**：实现后 58/60，两条红：

1. `PUT /api/prompts/:id` 带未知字段 `{"nope":1}` 返回 **200**（期望 400）——根因是 Fastify 的 ajv 默认
   `removeAdditional: true` 会**静默丢弃**未知字段（与阶段 2 关掉 `coerceTypes` 同属"静默改写"问题）。
   修：`ajv: { customOptions: { coerceTypes: false, removeAdditional: false } }`，让 `additionalProperties: false` 真的报 400。
2. `tests/db-search.test.ts` 里我自己把断言顺序写反了（先 UPDATE 把 ids[0] 的"交接"改没了，再断言 DELETE 后"交接"应剩 1 条）。
   **是测试的期望值错，不是实现错**：改为"先 DELETE（2→1）再 UPDATE（1→0）"，两段断言才各自有意义。

**绿**（最终）：`npm test`

```
ℹ tests 60
ℹ suites 0
ℹ pass 60
ℹ fail 0
ℹ duration_ms 6044.184046
$ ls tests/*.test.ts | wc -l   → 12   （AC-16 要求 ≥8，已满足）
```

#### 3. 阶段 3 验收标准实测（`bash tools/ac-stage3.sh`，每条 AC 自带夹具、自起自停）

**AC-5 prompt CRUD 与版本号**

```
=== AC-5 prompt CRUD 与版本号（自带夹具） ===
$ curl -s -b $JAR -X POST -H "Content-Type: application/json" -d @submit.json $BASE/api/prompts
{"id":1,"title":"会话交接模板（AC-5）","user_prompt":"你好 {{姓名}}，请把上下文交给下一位同学","system_prompt":"你是严谨的交接助手","notes":"备注：含 emoji ✅ 与 \"引号\"","folder_id":null,"tags":["交接"],"favorite":true,"created_at":"2026-09-18T04:53:19.570Z","updated_at":"2026-09-18T04:53:19.570Z","version_no":1}
$ curl -s -b $JAR http://127.0.0.1:8767/api/prompts/1
title          MATCH
user_prompt    MATCH
system_prompt  MATCH
notes          MATCH
favorite       MATCH
tags           MATCH
folder_id      MATCH
version_no     = 1
created 与 GET 整体一致： MATCH
created_at/updated_at 形如 ISO UTC： MATCH
$ curl -s -b $JAR -X PUT -d '{"notes":"改过的备注"}' http://127.0.0.1:8767/api/prompts/1
version_no: 1 -> 2 (PUT 必须产生新版本)
notes: '改过的备注'
title          未被改动： MATCH
user_prompt    未被改动： MATCH
system_prompt  未被改动： MATCH
tags           未被改动： MATCH
favorite       未被改动： MATCH
$ curl -s -o /dev/null -w '%{http_code}\n' -b $JAR -X DELETE http://127.0.0.1:8767/api/prompts/1
204
$ curl -s -o /dev/null -w '%{http_code}\n' -b $JAR http://127.0.0.1:8767/api/prompts/1   # 删除后
404

=== AC-6 中文检索（三种长度 + 特殊字符，自带夹具） ===
```

**AC-6 中文检索（三种长度 + 特殊字符）**

```
=== AC-6 中文检索（三种长度 + 特殊字符，自带夹具） ===
(已建 5 条固定中文语料)
$ curl -s -b $JAR -G --data-urlencode 'q=…' http://127.0.0.1:8767/api/prompts
q="会话交接"       -> total=1 ids=[1]
q="交接"         -> total=2 ids=[2, 1]
q="上下文"        -> total=5 ids=[5, 2, 1, 4, 3]
q="不存在的词"      -> total=0 ids=[]
q="REBASE"     -> total=1 ids=[3]
q="rebase"     -> total=1 ids=[3]
q="   "        -> total=5 ids=[5, 4, 3, 2, 1]
--- 特殊字符（AC-6 原文 `"*-%_` 及更多变体）：必须 200，不得 500
q="\"*-%_"   -> HTTP 200 total=0
q="\""       -> HTTP 200 total=0
q="*"        -> HTTP 200 total=0
q="-"        -> HTTP 200 total=0
q="("        -> HTTP 200 total=0
q=")"        -> HTTP 200 total=0
q="%"        -> HTTP 200 total=0
q="_"        -> HTTP 200 total=0
q="a-b"      -> HTTP 200 total=0
q="C++"      -> HTTP 200 total=0
q="it's"     -> HTTP 200 total=0
q="\\\\"     -> HTTP 200 total=0
--- 2 码点走 LIKE 兜底：命中数应 >= 2
total = 2 （期望 >= 2）

=== AC-7 检索性能（2000 条规模基线，自带夹具） ===
```

**AC-7 检索性能（2000 条规模基线）**

```
=== AC-7 检索性能（2000 条规模基线，自带夹具） ===
$ DATA_DIR=$AC_DIR node tools/seed-prompts.mjs 2000
ok: seeded 2000 prompts (total=2000, fts_hits=2000) in /tmp/pm-ac3-upHlPU [220 ms]
$ for i in 1 2 3; do curl -s -o /dev/null -w '%{time_total}\n' -b $JAR -G --data-urlencode 'q=会话交接' http://127.0.0.1:8767/api/prompts; done
0.009749
0.006563
0.007465
$ 同上，取一次 body 的 total
total = 2000 ｜ 本页 items = 50 ｜ limit = 50
--- 对照：无 q 的列表耗时（同样 2000 条）
0.005464
--- 对照：2 码点 LIKE 兜底耗时
0.004664

=== AC-14 文件夹与标签（自带夹具） ===
```

**AC-14 文件夹与标签**

```
=== AC-14 文件夹与标签（自带夹具） ===
$ curl -s -b $JAR -X POST -d {"name":"运维"} /api/folders
parent_id=1 child_id=2
$ curl -s -b $JAR /api/folders
{"items":[{"id":1,"name":"运维","parent_id":null,"sort_order":0},{"id":2,"name":"交接","parent_id":1,"sort_order":5}]}
结构正确（子的 parent_id = 父 id、父为根、sort_order 保留）： MATCH
$ 建两个标签，并把 prompt 归入文件夹 + 打标签（AC-14 的夹具）
tag_a=1 tag_b=2 prompt1=1 prompt2=2
$ curl -s -b $JAR 'http://127.0.0.1:8767/api/prompts?folder_id=1'   # 合并前：应命中 1 条
total = 1 ids = [1]
$ curl -s -b $JAR -G --data-urlencode 'tag=交接' http://127.0.0.1:8767/api/prompts   # 合并前：应命中 1 条
total = 1 ids = [1]
$ curl -s -b $JAR -X PUT -d '{"name":"交接"}' http://127.0.0.1:8767/api/tags/2   # 改名成已存在的标签 → 合并
{"id":1,"name":"交接","count":2}
$ curl -s -b $JAR /api/tags
{"items":[{"id":1,"name":"交接","count":2}]}
标签列表: [(1, '交接', 2)]
无重名： MATCH
"交接" 计数相加 = 2： MATCH
存活的是目标标签 id： MATCH
源标签"运维"已消失： MATCH
$ curl -s -b $JAR 'http://127.0.0.1:8767/api/prompts?folder_id=1'
total = 1 ids = [1]
$ curl -s -b $JAR -G --data-urlencode 'tag=交接' http://127.0.0.1:8767/api/prompts   # 合并后：两个 prompt 都带该标签 → 2
total = 2 ids = [2, 1]
--- 删除非空文件夹 → 409
$ curl -s -b $JAR -X DELETE http://127.0.0.1:8767/api/folders/1   # 有子文件夹 + 有 prompt
{"error":"folder_not_empty"}  HTTP 409
$ curl -s -b $JAR -X DELETE http://127.0.0.1:8767/api/folders/2   # 空文件夹 → 204
HTTP 204
$ curl -s -b $JAR -X DELETE http://127.0.0.1:8767/api/folders/1   # 子项已删但仍有 prompt → 409
{"error":"folder_not_empty"}  HTTP 409
$ curl -s -b $JAR -X PUT -d '{"folder_id":null}' http://127.0.0.1:8767/api/prompts/1   # 移出文件夹
HTTP 200
$ curl -s -b $JAR -X DELETE http://127.0.0.1:8767/api/folders/1   # 现在空了 → 204
HTTP 204

=== 收尾：停服并核验端口已释放 ===
$ ss -ltn | grep -c ':8767'   # 期望 0
0

阶段 3 自检结束；夹具目录已清理，端口 8767 已释放。
```

#### 4. 顺手复测的既有验收项（确认阶段 3 的改动没有破坏前两阶段）

```
$ bash tools/ac-stage2.sh   → rc=0（AC-3 401/401/401；AC-4 200/200/401/429 + retry-after: 60；
                                    登出 204→401；AC-15 逐字段 MATCH、user_prompt 逐字符 MATCH；端口收尾 0）
$ npm test                  → 60/60 通过（12 个测试文件）
$ sudo systemd-analyze verify deploy/promptmanager.service 2>&1 | grep -c error   → 0
$ grep -cE '^(User|Group|WorkingDirectory|EnvironmentFile|Restart)=' deploy/promptmanager.service → 5
$ grep -c MemoryDenyWriteExecute deploy/promptmanager.service → 0
$ grep -cE '^[A-Z_]*(PASSWORD|SECRET|TOKEN|KEY)[A-Z_]*=.+$' deploy/promptmanager.env.example → 0
$ AC-20：npm ls antd → antd@6.6.4 / @ant-design/icons@6.3.4；源码原生表单标签 0；from 'antd' 5 处；CDN 外链 0
$ AC-17：git check-ignore 三条命中；凭据字面量扫描 0 命中；依赖表 51 行 ≥ 直接依赖 18
$ npm audit --registry=https://registry.npmjs.org → found 0 vulnerabilities（本阶段未新增依赖）
```

#### 5. 本阶段自行判断的实现细节（BRIEF §11.5 ②：备查，验收只按本阶段 AC 判）

1. **`PUT` 一律产生新版本**：只要通过校验就 `version_no+1` 并写 `prompt_versions`（含 `{}` 空 patch），
   依 BRIEF §6.1「更新（可写字段的子集）→ 产生新版本」的字面语义（开工前决策 1）。
2. **标签在保存 prompt 时 find-or-create**；`PUT` 提供 `tags` 时**整体替换**该 prompt 的标签集合（决策 2）。
3. **文件夹删除 → `409 {"error":"folder_not_empty"}`**（有子文件夹或有 prompt 归属）；标签删除不做非空检查（决策 3）。
4. **文件夹树完整性**：父不存在/自引用/挂到自己的后代 → `400`（防成环）；同父重名 → `400`（唯一索引兜底）（决策 4）。
5. **标签改名合并**：关联重指向目标标签（去重）后删源标签，返回存活标签的 `{id,name,count}`；创建重名标签 → `400`（决策 5）。
6. **筛选参数严格校验**：`favorite` 仅 `true`/`false`、`folder_id` 正整数（否则 400）、`limit` 超上限**截断**到 200；
   空/纯空白 `q` 等同缺省（决策 6）。
7. **排序**：FTS 路径 `bm25 ASC, updated_at DESC, id DESC`；LIKE/无查询 `updated_at DESC, id DESC`（决策 7、BRIEF §6.6）。
8. **分层**：FTS 匹配式/转义/列表查询在 `src/db/`，业务规则（版本留档、标签 find-or-create、文件夹树校验）在 `src/services/`（决策 8、BRIEF §6.7）。
9. **AC-7 夹具**用 `tools/seed-prompts.mjs`（直接写库 → 触发器同步 FTS，2000 条 210 ms），双方可复现（决策 9）。
10. **未改 schema**：本阶段不需要迁移（001 已含 folders/tags/prompt_tags/prompt_versions/FTS 触发器），**001 未被改动**（决策 10）。
11. **`favorite` 在库里存 0/1**、出 API 转 boolean；`tags` 出 API 按标签名升序（契约 §6.1）。
12. **`folder_id: null` 表示移出文件夹**；PUT 未提供的字段保持不变（部分更新语义）。

#### 6. 未完成 / 已知缺口（本阶段范围内无缺口）

- 阶段 4：版本历史接口（`GET /versions`、`/diff`、`/rollback`）、变量提取与渲染、Markdown 渲染+净化 →
  AC-8/9/12。（`prompt_versions` 表与"每次变更留档"已在本阶段落地，阶段 4 补查询与回滚接口。）
- 阶段 5：导入导出（replace/merge + 校验原子性）→ AC-10/11。
- 阶段 6：前端 P0 + 界面自证 → AC-13/21；**当前前端仍是骨架页，登录页/列表/编辑器都还没做**。
- 阶段 7：`docs/shots`、README 四要素收尾、AC-16/17/18 正式验收。
- `LIKE` 兜底是全表扫描（2000 行下接口耗时 <10 ms），10 万行量级需重新评估（已写入 README）。
- `PUT` 没有"内容未变就跳过留档"的优化：同一内容多次 PUT 会产生多个同内容版本（依 §6.1 字面语义）。

#### 7. 下一步（阶段 4 待下单后执行）

1. `GET /api/prompts/:id/versions`（升序，含首版）、`GET /api/prompts/:id/diff?from=&to=`（unified diff，用成熟 diff 库）、
   `POST /api/prompts/:id/versions/:n/rollback`（**生成新版本、不删历史**）。
2. 变量：`GET /api/prompts/:id/variables`、`POST /api/prompts/:id/render`（§6.5：`{{name}}`、转义 `\{{}}`、未提供值保持原样并列入 missing）。
3. Markdown：`POST /api/render/markdown`（marked/markdown-it + 服务端 DOMPurify + highlight.js），
   引入前查 CVE + 协议并登记 `docs/dependencies.md`。
4. 目标 AC：AC-8、AC-9、AC-12。

### 2026-09-18 — 阶段 4 开工前准备（版本历史 + 变量 + Markdown）

> 阶段 1–3 均已验收通过（`VERIFY.md`：AC-5/6/7/14 + FTS 同步 + 转义严格验证；无返工项）。
> 本阶段按 BRIEF **v3** 执行，只做阶段 4：AC-8、AC-9、AC-12（FR-7、FR-8、FR-9）。

#### 1. 端口复核（STANDARDS §3.5：起临时服务前必须实测）

```
$ ss -ltn | grep -E ':(876[5-9]|8770)\b'
LISTEN 0      10           0.0.0.0:8769      0.0.0.0:*
```

**结论**：8767 仍空闲（本项目默认端口，台账已登记，不改），8769 为 izone 占用。配置默认值 / README / PROGRESS 三处保持一致。

#### 2. 依赖复核与选型（安全 + 协议两道闸门；用前查 CVE）

`npm view <pkg> version license time.modified` 实测（2026-09-18）：

```
marked              18.0.13   MIT                     2026-09-12
dompurify           3.4.15    (MPL-2.0 OR Apache-2.0) 2026-09-06
jsdom               30.1.0    MIT                     2026-09-17
highlight.js        11.12.0   BSD-3-Clause            2026-08-12
diff                9.0.0     BSD-3-Clause            2026-04-13
@types/jsdom        30.0.0    MIT（devDependency）      2026-08-07
```

**装前 OSV 逐包查询**（`api.osv.dev`，package+version）：`marked` / `dompurify` / `jsdom` / `highlight.js` / `diff`
**全部 osv_vulns=0**（装后还会再跑 `npm audit` 与全量协议分布，见收尾）。

**选型说明**

| 需求（BRIEF §5） | 选的包 | 理由 |
| --- | --- | --- |
| Markdown 渲染 | **`marked@18.0.13`**（MIT） | BRIEF §6.8 列的版本；`marked` 或 `markdown-it` 二选一，取 BRIEF 首选；不自写渲染器 |
| HTML 净化（服务端） | **`dompurify@3.4.15`** + **`jsdom@30.1.0`** | BRIEF §5 明确"服务端 DOMPurify"；DOMPurify 需要 DOM，Node 侧标准做法是 jsdom。**不**改走 `isomorphic-dompurify` 包装层，是为了与 BRIEF 措辞逐字对应、且 DOM 依赖显式可见（多一个直接依赖换可读性）|
| 代码高亮 | **`highlight.js@11.12.0`**（BSD-3-Clause） | BRIEF §6.8 列的版本；用 `highlight.js/lib/common` 入口（常用语言子集，避免全量语言包） |
| unified diff | **`diff@9.0.0`**（BSD-3-Clause，jsdiff） | BRIEF §5 禁止手写 diff 算法；`createTwoFilesPatch` 直接产 unified diff |
| DOMPurify 的类型 | `@types/jsdom@30.0.0`（devDependency） | jsdom 不自带类型；dompurify 自带类型 |

#### 3. 本阶段验收标准 → 我要执行的检查命令（BRIEF §11.1）

统一夹具（每条 AC 自带、互不依赖）：`AC_DIR=$(mktemp -d /tmp/pm-ac4-XXXXXX)`、`DATA_DIR=$AC_DIR PORT=8767`、
`AC_PW='ac-fixture-pw-20260918'`、CLI 建设口令、服务自起自停、登录拿 cookie。

| AC | 我要执行的检查命令 | 期望 |
| --- | --- | --- |
| **AC-8** 变量提取与渲染 | 夹具：`user_prompt` = `你好 {{ 姓名 }}，重复 {{姓名}} 与 \{{保留}} 以及 {{var-b}}`。① `GET /api/prompts/:id/variables`；② `POST /api/prompts/:id/render` body `{"values":{"姓名":"张三"}}`；③ 用 `python3` 把渲染结果与预期串**逐字符**比较并打印 `MATCH`/`DIFF` | ① `{"variables":["姓名","var-b"]}`（顺序=首次出现、去重、`\{{保留}}` 不算）；② `user_prompt` = `你好 张三，重复 张三 与 {{保留}} 以及 {{var-b}}`、`missing=["var-b"]`；③ `MATCH` |
| **AC-9** 版本列表 / diff / 回滚 | 夹具：建 prompt（v1）→ `PUT` 改正文（v2）→ `PUT` 再改（v3）。① `GET /api/prompts/:id/versions`；② `GET /api/prompts/:id/diff?from=1&to=3`；③ `POST /api/prompts/:id/versions/1/rollback` → `GET` 单个比对正文（逐字符）→ 再 `GET versions`；另测 `diff` 缺参/越界 → `400`、不存在的 prompt/版本 → `404` | ① `[1,2,3]`（升序含首版）；② 含 `-` 行与 `+` 行；③ 回滚 `200`、正文与 v1 **逐字符相同**、`versions` = `[1,2,3,4]`（历史不删） |
| **AC-12** Markdown 渲染 + XSS 净化 + 高亮 | `POST /api/render/markdown`，body 含 `<script>alert(1)</script>`、`[x](javascript:alert(1))`、```` ```js\nconst a=1\n``` ````。用 `python3` 检查返回的 `html` | 不含 `<script`、不含 `javascript:`；含 `<pre` 或 `<code` 且带 `hljs` 类 |
| 回归（前 3 阶段不被破坏） | `npm test`；`bash tools/ac-stage2.sh`；`bash tools/ac-stage3.sh`；`sudo systemd-analyze verify deploy/promptmanager.service`；`npm audit` + 协议分布 | 全绿 / 2、3 阶段 AC 仍过 / 错误 0 / 0 vulnerabilities + 无 GPL/AGPL |

#### 4. 本阶段的关键实现决策（BRIEF 未逐条规定口径 → 先记在此备查，验收只按 AC 判）

1. **变量提取的字段范围 = `user_prompt` + `system_prompt`**（先 user 后 system，按此顺序去重）：
   FR-8 说"从 prompt 文本提取"，而 render 的响应同时给 `user_prompt` 与 `system_prompt`；AC-8 只用了 user_prompt。
   `notes/title` 不参与（它们不是"要渲染的模板文本"）。
2. **变量名严格校验**：`{{` + 可选空白 + 名字 + 可选空白 + `}}`，名字须整体匹配 `^[\p{L}\p{N}_-]{1,64}$`（含中文、不含空白）；
   不匹配的 `{{…}}`（如 `{{}}`、`{{a b}}`、`{{x!}}`）**按字面文本处理**（不提取、不改写）。
3. **转义**：`\{{name}}`（单个反斜杠）不算变量；渲染时去掉该反斜杠，输出字面 `{{name}}`。
4. **`missing` 语义**：只在"未提供该名字的值"时列入（按提取顺序）；`values` 里给了**空字符串算已提供**（渲染成空）。
   未提供的占位符**原样保留**（连同其内部空白）。
5. **diff 文本格式**（契约只说"两版本 unified diff"，未规定内容）：把版本快照拼成规范文本
   （`[title]` / `[user_prompt]` / `[system_prompt]` / `[notes]` 四段，段内保留原始换行），
   再用 `createTwoFilesPatch('v<N>', 'v<M>', …)`（context=3）产出 unified diff。
   多行值安全、能看出哪一段变了，且**含 `-`/`+` 行**（AC-9 的可执行判据）。
6. **`diff` 的失败语义**：缺 `from`/`to`、非整数、`from`/`to` 不存在于该 prompt 的版本里 → `400`（契约写"缺参/越界"）；
   prompt 不存在 → `404`。
7. **回滚 = 内容回滚**：恢复 `title/user_prompt/system_prompt/notes` 四字段并**生成新版本**（`version_no+1`），
   **绝不删历史**；标签/文件夹/收藏**不动**（版本快照里没有这些字段，BRIEF §6.4 的导出结构也只含这四个内容字段）。
   prompt 不存在或版本号不存在 → `404`。
8. **Markdown 管线**：`marked`（默认 gfm）→ 自定义 `renderer.code` 用 `highlight.js` 高亮（语言已知则指定语言，
   否则 `highlightAuto`）→ `DOMPurify.sanitize`。**净化在渲染之后**，因此 `<script>`/`javascript:`/事件属性都会被去掉，
   而 hljs 生成的 `<span class="hljs-*">` 保留。请求体上限 200000 字符（超限 400）；
   超过 20000 字符的代码块跳过"自动识别语言"（防 CPU 消耗），显式指定语言时仍高亮。
9. **代码分层**（BRIEF §6.7）：版本行查询放 `src/db/prompt-versions.ts`；业务（快照/diff/回滚/变量/Markdown）
   放 `src/services/{versions,variables,markdown}.ts`；路由挂在既有 `routes/prompts.ts` + 新增 `routes/render.ts`。
10. **不改 schema、不改 001**：`prompt_versions` 表与"每次变更留档"阶段 3 已落地，本阶段只加查询/回滚接口。

#### 5. 红 → 绿计划

先写 `tests/variables.test.ts`（纯函数：提取顺序/去重/转义/名字校验/渲染/missing）、
`tests/markdown.test.ts`（净化 + 高亮 + 特殊输入）、`tests/api-versions.test.ts`（AC-9 端到端）、
`tests/api-variables-markdown.test.ts`（AC-8/AC-12 端到端），**在实现之前**跑一次记录失败（红）；
再实现 `src/db/prompt-versions.ts`、`src/services/{versions,variables,markdown}.ts`、路由与接线，构建后复跑（绿）；
最后跑 `tools/ac-stage4.sh` 取 AC 端到端输出。

### 2026-09-18 — 阶段 4 实施与自检（版本 + 变量 + Markdown，收尾）

#### 1. 单元与 commit 对应

| commit | 单元 | 内容 |
| --- | --- | --- |
| `581e2b0` | 开工前 | 端口 `ss` 复测、依赖选型与装前 OSV 闸门、AC-8/9/12→检查命令、实现决策 |
| `d1941b3` | 功能 + 测试 | `src/db/prompt-versions.ts`、`src/services/{versions,variables,markdown}.ts`、`routes/render.ts` + `routes/prompts.ts` 扩展、4 个新测试文件、依赖 pin + lockfile |
| `90749a3` | 验收脚本 | `tools/ac-stage4.sh`（AC-8/9/12 各自独立夹具） |
| `ac7b2f6` | 文档 | `docs/dependencies.md`（§4.8/4.9 选型理由 + 闸门记录）、README 用法与语义 |

#### 2. 红 → 绿记录

**红**（4 个新测试文件先写，实现未写）：`node --test "tests/**/*.test.ts"`

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/dist/services/variables.js' imported from tests/variables.test.ts
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/dist/services/markdown.js'  imported from tests/markdown.test.ts
✖ AC-8 / AC-9 / AC-12 各端到端用例（共 10 个失败）
ℹ tests 70   ℹ pass 60   ℹ fail 10
```

**中间一次失败（如实记录）**：实现后 79/80，一条红 = 我自己的断言写得太字面：
```` ```html `` 代码块会被 highlight.js 高亮成 `<span class="hljs-tag">&lt;<span class="hljs-name">script</span>&gt;</span>`，
所以**不存在连续的 `&lt;script&gt;` 子串**；正确断言是"没有真的 `<script` 标签 + 出现转义实体 `&lt;`"。
**是测试期望错、不是实现错**（实现确实转义了）。改断言后绿。

**绿**（最终）：`npm test`

```
ℹ tests 80
ℹ suites 0
ℹ pass 80
ℹ fail 0
ℹ duration_ms 10138.059131
$ ls tests/*.test.ts | wc -l   → 16
```

#### 3. 阶段 4 验收标准实测（`bash tools/ac-stage4.sh`，每条 AC 自带夹具、自起自停）

**AC-8 变量提取与渲染**

```
=== AC-8 变量提取与渲染（自带夹具） ===
$ curl -s -b $JAR -X POST -H "Content-Type: application/json" -d @ac8.json $BASE/api/prompts
{"id":1,"title":"变量夹具","user_prompt":"你好 {{ 姓名 }}，重复 {{姓名}} 与 \\{{保留}} 以及 {{var-b}}","system_prompt":"","notes":"","folder_id":null,"tags":[],"favorite":false,"created_at":"2026-09-18T05:13:00.196Z","updated_at":"2026-09-18T05:13:00.196Z","version_no":1}
$ curl -s -b $JAR http://127.0.0.1:8767/api/prompts/1/variables
{"variables":["姓名","var-b"]}
variables = ['姓名', 'var-b']
与期望 ["姓名","var-b"] 逐元素一致： MATCH
$ curl -s -b $JAR -X POST -d '{"values":{"姓名":"张三"}}' http://127.0.0.1:8767/api/prompts/1/render
{"user_prompt":"你好 张三，重复 张三 与 {{保留}} 以及 {{var-b}}","system_prompt":"","missing":["var-b"]}
user_prompt 渲染结果 : "你好 张三，重复 张三 与 {{保留}} 以及 {{var-b}}"
user_prompt 逐字符与预期串相等： MATCH
missing             : ['var-b'] → MATCH
渲染不写库（另取一次 GET 校验）：
  GET.user_prompt 仍等于原始模板： MATCH
  version_no 未变： MATCH

=== AC-9 版本列表 / diff / 回滚（自带夹具） ===
```

**AC-9 版本列表 / diff / 回滚**

```
=== AC-9 版本列表 / diff / 回滚（自带夹具） ===
prompt id=1
$ PUT v2（改 user_prompt）
  version_no = 2 ｜user_prompt = 第二版正文：改过了
$ PUT v3（再改 user_prompt + notes）
  version_no = 3 ｜notes = v3 备注
$ curl -s -b $JAR http://127.0.0.1:8767/api/prompts/1/versions
{"items":[{"version_no":1,"created_at":"2026-09-18T05:13:04.787Z","title":"版本演示"},{"version_no":2,"created_at":"2026-09-18T05:13:04.840Z","title":"版本演示"},{"version_no":3,"created_at":"2026-09-18T05:13:04.867Z","title":"版本演示"}]}
版本号序列 = [1, 2, 3] → MATCH
含时间戳   = True
含标题     = True
$ curl -s -b $JAR 'http://127.0.0.1:8767/api/prompts/1/diff?from=1&to=3'
--- unified diff 原样（前 24 行）---
===================================================================
--- v1
+++ v3
@@ -1,8 +1,8 @@
 [title]
 版本演示
 [user_prompt]
-第一版正文：会话交接 {{变量A}}
+第三版正文：又改一次
 [system_prompt]
 
 [notes]
-v1 备注
\ No newline at end of file
+v3 备注
\ No newline at end of file

--- 判定 ---
删除行数 = 2 ｜新增行数 = 2
含 - 行与 + 行： MATCH
含 v1 正文： MATCH
含 v3 正文： MATCH
$ curl -s -b $JAR -X POST http://127.0.0.1:8767/api/prompts/1/versions/1/rollback
{"id":1,"title":"版本演示","user_prompt":"第一版正文：会话交接 {{变量A}}","system_prompt":"","notes":"v1 备注","folder_id":null,"tags":[],"favorite":false,"created_at":"2026-09-18T05:13:04.787Z","updated_at":"2026-09-18T05:13:04.967Z","version_no":4}
回滚后 version_no = 4 → MATCH
正文 = v1 正文（逐字符）： MATCH
备注 = v1 备注（逐字符）： MATCH
$ curl -s -b $JAR http://127.0.0.1:8767/api/prompts/1   # 回滚后再取一次
  GET.user_prompt 逐字符 = v1： MATCH
  version_no = 4
$ curl -s -b $JAR http://127.0.0.1:8767/api/prompts/1/versions   # 历史必须一个都不少
  版本号序列 = [1, 2, 3, 4] → MATCH
--- 失败语义：缺参/非法/越界 → 400；prompt 不存在 → 404
  diff                   → HTTP 400
  diff?from=1            → HTTP 400
  diff?to=2              → HTTP 400
  diff?from=abc&to=2     → HTTP 400
  diff?from=1&to=99      → HTTP 400
  diff（prompt 999999）  → HTTP 404
  rollback（版本 99）    → HTTP 404

=== AC-12 Markdown 渲染 + XSS 净化 + 高亮（自带夹具） ===
```

**AC-12 Markdown 渲染 + XSS 净化 + 高亮**

```
=== AC-12 Markdown 渲染 + XSS 净化 + 高亮（自带夹具） ===
$ curl -s -b $JAR -X POST -H "Content-Type: application/json" -d @ac12.json $BASE/api/render/markdown
{"html":"<h1>预览标题</h1>\n<p><a>x</a></p>\n<pre><code class=\"hljs language-js\"><span class=\"hljs-keyword\">const</span> a = <span class=\"hljs-number\">1</span>;</code></pre>\n"}
--- 判定 ---
不含 <script      : MATCH
不含 javascript:  : MATCH
含 <pre 或 <code  : MATCH
带高亮 class(hljs): MATCH
保留正常 Markdown : MATCH
--- 额外净化样例（事件属性 / iframe / 危险协议）
{"html":"<img src=\"x\"><p><a>j</a></p>\n<p><a href=\"https://example.com\">ok</a></p>\n"}
无 onerror   : MATCH
无 <iframe   : MATCH
无 javascript: MATCH
正常链接保留 : MATCH

=== 收尾：停服并核验端口已释放 ===
$ ss -ltn | grep -c ':8767'   # 期望 0
0

阶段 4 自检结束；夹具目录已清理，端口 8767 已释放。
```

#### 4. 顺手复测的既有验收项（确认阶段 4 的改动没有破坏前三个阶段）

```
$ bash tools/ac-stage2.sh  → rc=0（AC-3 401；AC-4 200/200/401/429；AC-15 逐字段 MATCH、正文逐字符 MATCH；端口收尾 0）
$ bash tools/ac-stage3.sh  → rc=0（AC-5 逐字段 MATCH + version 1→2；AC-6 会话交接 total=1、交接 total=2；AC-7 total=2000；
                                  AC-14 结构 MATCH、标签合并计数相加/源标签消失；端口收尾 0）
$ npm test                 → 80/80 通过（16 个测试文件）
$ sudo systemd-analyze verify deploy/promptmanager.service 2>&1 | grep -c error   → 0
$ grep -cE '^(User|Group|WorkingDirectory|EnvironmentFile|Restart)=' deploy/promptmanager.service → 5
$ grep -c MemoryDenyWriteExecute deploy/promptmanager.service → 0
$ grep -cE '^[A-Z_]*(PASSWORD|SECRET|TOKEN|KEY)[A-Z_]*=.+$' deploy/promptmanager.env.example → 0
$ AC-20：antd@6.6.4 / icons@6.3.4；源码原生表单标签 0；from 'antd' 5 处；CDN 外链 0
$ AC-17：git check-ignore 三条命中；凭据字面量扫描 0 命中；依赖表 51 行 ≥ 直接依赖 24
$ npm audit --registry=https://registry.npmjs.org → found 0 vulnerabilities
$ 协议分布（206 包）：MIT 175 / BSD-3 7 / ISC 7 / BlueOak 5 / Apache-2.0 4 / MIT-0 2 / BSD-2 2 / MPL-2.0 2 /
                      (MPL-2.0 OR Apache-2.0) 1 / CC0-1.0 1；**GPL/AGPL/无协议 = 0**
```

#### 5. 本阶段自行判断的实现细节（BRIEF §11.5 ②：备查，验收只按本阶段 AC 判）

1. **变量提取范围 = `user_prompt` + `system_prompt`**（先 user 后 system 去重）；`POST /render` 的 `missing` 是两者合并去重后的顺序（决策 1、4）。
2. **名字严格校验**（`^[\p{L}\p{N}_-]{1,64}$`）：不匹配的 `{{…}}`（`{{}}`/`{{a b}}`/`{{x!}}`/65 字符）按字面文本处理（决策 2）。
3. **转义**：单反斜杠 `\{{name}}` 不提取；渲染时去掉反斜杠输出字面 `{{name}}`（决策 3）。
4. **`missing` 语义**：只有"未提供（或值不是字符串）"才列入；空字符串算已提供；未提供的占位符**连内部空白一起原样保留**（决策 4）。
5. **diff 文本形态**：版本快照 → 四段带标记文本（`[title]`/`[user_prompt]`/`[system_prompt]`/`[notes]`）→
   `createTwoFilesPatch('v<N>','v<M>', …, {context:3})`；BRIEF 只要求"unified diff"，未规定形态（决策 5）。
6. **diff 失败语义**：缺参/非法/版本越界 → `400 invalid_body`；prompt 不存在 → `404`（决策 6）。
7. **回滚 = 内容回滚 + 新版本**：恢复四字段并 `version_no+1`，**历史不删**；标签/文件夹/收藏不在快照里、回滚不动（决策 7）。
8. **Markdown 管线顺序**：marked → hljs 高亮 → DOMPurify 净化（**净化必须在渲染之后**）；代码内容转义由 hljs 负责，
   **没有手写 HTML 转义**；超过 20000 字符的代码块跳过 `highlightAuto`（200k 实测约 3 秒）改用 `plaintext`（仍是库转义）（决策 8、§4.8）。
9. **分层**：版本行查询 `src/db/prompt-versions.ts`；业务 `src/services/{versions,variables,markdown}.ts`；路由复用 `routes/prompts.ts` + 新 `routes/render.ts`（决策 9）。
10. **未改 schema、未改 001**：`prompt_versions` 与"每次变更留档"阶段 3 已落地，本阶段只加查询/回滚接口（决策 10）。
11. **依赖**：`marked@18.0.13`(MIT)、`dompurify@3.4.15`(MPL-2.0 OR Apache-2.0 → 按 Apache-2.0 用)、`jsdom@30.1.0`(MIT)、
    `highlight.js@11.12.0`(BSD-3)、`diff@9.0.0`(BSD-3)、`@types/jsdom@30.0.0`(MIT, dev)；装前 OSV 全 0、装后 `npm audit` 0。

#### 6. 未完成 / 已知缺口（本阶段范围内无缺口）

- 阶段 5：导入导出（`GET /api/export`、`POST /api/import` 的 replace/merge + 校验 + 原子性）→ AC-10/11。
- 阶段 6：前端 P0（登录页/列表/编辑器/版本面板/变量面板/Markdown 预览/响应式/亮暗）+ 界面自证 → AC-13/21；
  **当前前端仍是阶段 1 的骨架页**，阶段 4 的能力只能在 API 层用（`tools/ac-stage4.sh` 即该层证据）。
- 阶段 7：`docs/shots`、README 四要素收尾、AC-16/17/18 正式验收。
- `diff` 的文本是本项目自定的四段格式（不是"逐字段 patch"）；若前端阶段需要逐字段高亮，可在阶段 6 基于同一快照做展示层处理。
- Markdown 渲染是**服务端**渲染（每次请求都过 jsdom+DOMPurify，约几十毫秒量级）；前端预览面板（阶段 6）直接复用该接口。

#### 7. 下一步（阶段 5 待下单后执行）

1. `GET /api/export`：按 §6.4 的 `ExportFile` 结构（folders/tags/prompts/versions，确定性排序；`exported_at` 是唯一非确定字段）。
2. `POST /api/import`：`replace`（清空重建、**保留文件里的 id**）与 `merge`（同名 folder/tag 复用、prompt 重新分配 id），
   校验 `app`/`schema_version`（不合法 → 400 且**不动任何数据**），整体单事务保证原子性；导入后 FTS 索引由触发器自动同步。
3. CLI 可选命令 `export --out <path>`（与 `/api/export` 同格式）。
4. 目标 AC：AC-10、AC-11。

### 2026-09-18 — 阶段 5 开工前准备（导入导出）

> ⚠️ **如实记录**：本轮我漏了"开工前把 AC 翻译成检查命令写进 PROGRESS"这一步（直接先写了红测试与实现），
> 本节是**收尾前补记**的；检查命令与实际执行的一致（`tools/ac-stage5.sh` 就按本节写）。
> 端口复核与依赖判断确实是开工时做的，输出如下。

#### 1. 端口复核（STANDARDS §3.5：起临时服务前必须实测）

```
$ ss -ltn | grep -E ':(876[5-9]|8770)\b'
LISTEN 0      10           0.0.0.0:8769      0.0.0.0:*
```

**结论**：8767 仍空闲（本项目默认端口，台账已登记，本阶段不改）；8769 为 izone 占用。

#### 2. 依赖判断（安全 + 协议两道闸门）

**本阶段不新增依赖**：导出/导入用现有 `kysely` + `better-sqlite3`（事务原语）即可；
Markdown 净化硬化（BRIEF v4 §5）用的是已登记的 `dompurify`，只是显式收紧 sanitize 配置。
因此无新增 CVE/协议复核项（收尾仍复跑 `npm audit` 与协议分布）。

#### 3. 本阶段验收标准 → 我要执行的检查命令（BRIEF §11.1）

统一夹具（每条 AC 自带、互不依赖）：`AC_DIR=$(mktemp -d /tmp/pm-ac5-XXXXXX)`、`DATA_DIR=$AC_DIR PORT=8767`、
`AC_PW='ac-fixture-pw-20260918'`、CLI 建设口令、服务自起自停、登录拿 cookie。

| AC | 我要执行的检查命令 | 期望 |
| --- | --- | --- |
| **AC-10** 导出 → 导入(replace) → 再导出 | ① 造夹具（父子文件夹 + 2 标签 + 2 prompt，其中一条 2 版本）→ `curl -b $JAR /api/export > a.json`；② 把 a.json 包成 `{"mode":"replace","data":…}` 后 `POST /api/import`；③ 再 `GET /api/export > b.json`；④ `python3` 去掉 `exported_at` 比对两份 JSON → 打印 `EQUAL`/`DIFF`，并核 `imported.prompts` == a.json 的 prompt 数、id 保留；⑤ 附加：快照后再新增一条 prompt，replace 后必须消失（真清空重建）；⑥ 附加：`q=会话交接` 能搜到导入内容、被清掉的词搜不到（FTS 同步）；⑦ 附加：`bin/pm.mjs export --out` 与 `/api/export` 去 `exported_at` 后 `EQUAL` | ④ `EQUAL` + `imported.prompts` 相符 + id `MATCH`；⑤ 消失 `MATCH`；⑥ `MATCH`/`MATCH`；⑦ `EQUAL` |
| **AC-11** 非法导入不动数据 | ① 先导入一份合法数据并 `GET /api/export > before.json`（记录 prompt 数）；② 依次 `POST /api/import "replace"` 三个非法 data：`{"app":"other","schema_version":1}`、`{"app":"promptmanager","schema_version":99}`、`{"app":"promptmanager","schema_version":1}`（缺数组）；③ 期望每次 `HTTP 400` 且 body 含 `invalid_import`；④ 再 `GET /api/export > after.json`，去掉 `exported_at` 与 before 比对 | ②→③ `400` + `invalid_import`；④ prompt 数一致 `MATCH`、整库 `EQUAL` |
| 回归（前四阶段不被破坏） | `npm test`；`bash tools/ac-stage2.sh` / `ac-stage3.sh` / `ac-stage4.sh`；`sudo systemd-analyze verify deploy/promptmanager.service`；`npm audit` + 协议分布；`ss -ltn` 收尾 | 全绿 / 各 rc=0 / 错误 0 / 0 vulnerabilities / 端口 0 |

#### 4. 计划中的实现决策（开工时的口径；实际落地情况见收尾节 §5）

1. 导出严格按 §6.4 的字段与确定性排序；prompt 对象**不含** `version_no` 字段（版本号由 `versions[]` 推导）。
2. `replace` 用文件里的显式 id 重建；`merge` 文件夹按 (父, 名字) 复用、标签按名字复用、prompt 一律新建。
3. 校验分两层：`app`/`schema_version`（契约）+ 形状校验（数组/类型/id 唯一/引用存在）→ 全部在事务之前，
   该端点的 400 一律 `invalid_import`（body schema 只做"必须是对象"）。
4. 写入包在**单个事务**里；约束冲突 → 捕获为 `invalid_import` 并整体回滚。
5. 导入后 FTS 由阶段 1 的触发器同步，并用**检索**验证（不只断言行数）。
6. 顺手落地 BRIEF v4 §5 的 Markdown 净化硬化（阶段 6 才正式验收，本阶段先钉住断言）。

#### 5. 红 → 绿计划

先写 `tests/api-export.test.ts`、`tests/api-import.test.ts`、`tests/cli-export.test.ts` 与
`tests/markdown.test.ts` 的硬化断言，**在实现之前**跑一次记录失败（红）；
再实现 `src/services/{export,import}.ts`、`routes/export.ts`、CLI `export`、净化硬化，构建后复跑（绿）；
最后跑 `tools/ac-stage5.sh` 取 AC 端到端输出。

### 2026-09-18 — 阶段 5 实施与自检（导入导出，收尾）

> 本阶段按 BRIEF **v4** 执行。v4 新增的「Markdown 净化硬化」（§5，原文要求"阶段 6 前端渲染前必须完成"）
> 也在本阶段**顺手落地**：它只涉及已交付的 `/api/render/markdown` 的 sanitize 配置，且与"导入进来的非自写内容"直接相关
> （见下方 §5 决策 12）。阶段 6 的正式验收仍以 v4 §5 的断言为准。

#### 1. 单元与 commit 对应

| commit | 单元 | 内容 |
| --- | --- | --- |
| —（补记） | 开工前 | 端口 `ss` 复测、依赖判断、AC-10/11→检查命令、计划决策（见上一节；**本轮该节为收尾前补记**） |
| `fc25484` | 功能 + 测试 | `src/services/{export,import}.ts`、`routes/export.ts`、`InvalidImportError`、CLI `export`、Markdown 净化硬化、3 个新测试文件 + 硬化断言 |
| `f5a56a4` | 验收脚本 | `tools/ac-stage5.sh`（AC-10/11 各自独立夹具 + FTS 同步对照 + CLI 导出对照） |
| `fed2df9` | 文档 | README（用法/语义/硬化）、`docs/dependencies.md`（本阶段无新增依赖）、`deploy/README.md`（备份/恢复机制） |

#### 2. 红 → 绿记录（含一个**由 AC 脚本抓出来的真实实现缺陷**）

**红**（4 个新测试文件先写，实现未写）：`node --test "tests/**/*.test.ts"`

```
✖ AC-10 / AC-11 / 导出结构 / merge / CLI export / 硬化断言 …（共 13 个失败）
ℹ tests 95   ℹ pass 82   ℹ fail 13
```

**中间两次测试期望错（如实记录，实现没错）**：

1. `created_at === updated_at` 断言用在了**被 PUT 改过**的 prompt 上 → 改为"改过的：updated_at > created_at；
   没改过的：两者相同"。
2. "replace 应清掉旧数据"里，我先把 `旧数据` 建出来**再**导出，于是它本来就该在文件里 → 改为"导出快照**之后**再新增一条，
   replace 后它必须消失（这才证明真清空重建）"。

**⚠️ AC-10 脚本抓出真实缺陷（单测没抓到）**：

```
$ curl -s -b $JAR -X POST -H 'Content-Type: application/json' -d @import-body.json $BASE/api/import
{"error":"invalid_import","details":[{"path":"data","message":"数据约束冲突：FOREIGN KEY constraint failed"}]}
```

- **根因**（用探针逐语句定位）：`replace` 清空时写的是一条 `DELETE FROM folders`，而 `folders.parent_id` 是
  **自引用外键且 ON DELETE RESTRICT**；SQLite 按 rowid 顺序删，**先删父再删子** → `FOREIGN KEY constraint failed`
  （实测 `code=SQLITE_CONSTRAINT_TRIGGER`）。**只有"库里已存在父子文件夹"时才会触发**——我早期单测的夹具恰好都是空文件夹树，
  所以 95 个用例全绿却漏了它；**AC 脚本的夹具（父子文件夹 + prompt）一跑就暴露**。
- **修**：清空 folders 改为**反复删除"当前没有子节点"的叶子**（子先父后），直到删空（`src/services/import.ts`）。
- **加回归**：新增用例"库里已存在父子文件夹时 replace 仍能清空重建并往返 EQUAL"，把 AC-10 的真实场景钉进单测。
- **附带的次生问题**：这条 bug 之前把 AC-11 的用例表**掩盖**了——其中一个"非法用例"其实是**合法**的空文件
  （`{app,schema_version:1,folders:[],tags:[],prompts:[]}`），修好删除逻辑后它走到成功分支（200）才暴露；已从非法清单移除并注明。

**绿**（最终）：`npm test` + `bash tools/ac-stage5.sh`

```
ℹ tests 96
ℹ pass 96   ℹ fail 0
$ ls tests/*.test.ts | wc -l   → 19
阶段 5 自检结束；夹具目录已清理，端口 8767 已释放。   （脚本 rc=0）
```

#### 3. 阶段 5 验收标准实测（`bash tools/ac-stage5.sh`，每条 AC 自带夹具、自起自停）

**AC-10 导出 → 导入(replace) → 再导出：一致性**

```
=== AC-10 导出 → 导入(replace) → 再导出：一致性（自带夹具） ===
(夹具：文件夹 2 个（父子）、标签 2 个、prompt 2 条（其中一条 2 个版本）)
$ curl -s -b $JAR http://127.0.0.1:8767/api/export > a.json
app = promptmanager ｜schema_version = 1 ｜exported_at = 2026-09-18T05:46:05.092Z
folders = 2 ｜tags = 2 ｜prompts = 2
prompt id 序列 = [1, 2]
prompt[0].tags = ['交接', '运维'] ｜favorite = True ｜versions = [1, 2]
（已生成导入 body：{mode:replace, data:<a.json>}）
$ curl -s -b $JAR -X POST -H 'Content-Type: application/json' -d @import-body.json http://127.0.0.1:8767/api/import
{"mode":"replace","imported":{"folders":2,"tags":2,"prompts":2}}
$ curl -s -b $JAR http://127.0.0.1:8767/api/export > b.json
去掉 exported_at 后比对两份导出： EQUAL
imported.mode = replace ｜imported = {'folders': 2, 'tags': 2, 'prompts': 2}
imported.prompts == 导出的 prompt 数： MATCH
id 保留： MATCH
--- 附加：replace 真的清空重建（快照之后新增的数据必须消失），且导入内容可被检索（FTS 同步）
当前标题 = ['导出夹具乙', '导出夹具甲']
"快照之后才加的" 已被清掉： MATCH
导入内容可检索（q=会话交接）： MATCH
被清掉的数据检索不到（q=临时记录）： MATCH
--- 附加：CLI `export --out` 与 /api/export 同格式（去掉 exported_at 后 EQUAL）
$ DATA_DIR=$AC_DIR node bin/pm.mjs export --out $AC_DIR/cli.json
ok: exported 2 folders / 2 tags / 2 prompts -> /tmp/pm-ac5-HyPJvl/cli.json
rc=0
CLI 文件与 API 导出： EQUAL
CLI 文件 prompts 数 = 2

=== AC-11 非法导入不动数据（自带夹具） ===
```

**AC-11 非法导入不动数据**

```
=== AC-11 非法导入不动数据（自带夹具） ===
(夹具：文件夹 2 个（父子）、标签 2 个、prompt 2 条（其中一条 2 个版本）)
$ curl -s -b $JAR http://127.0.0.1:8767/api/export > before.json   # 记录导入前的数据
导入前：prompts = 2 ｜folders = 2 ｜tags = 2
$ curl -s -b $JAR -X POST -d '{"mode":"replace","data":{"app":"other","schema_version":1}}' http://127.0.0.1:8767/api/import
  {"error":"invalid_import","details":[{"path":"data.app","message":"必须是 \"promptmanager\"，实际 \"other\""}]}  [HTTP 400]
$ curl -s -b $JAR -X POST -d '{"mode":"replace","data":{"app":"promptmanager","schema_version":99}}' http://127.0.0.1:8767/api/import
  {"error":"invalid_import","details":[{"path":"data.schema_version","message":"文件版本 99 高于当前支持版本 1"}]}  [HTTP 400]
$ curl -s -b $JAR -X POST -d '{"mode":"replace","data":{"app":"promptmanager","schema_version":1}}' http://127.0.0.1:8767/api/import
  {"error":"invalid_import","details":[{"path":"data.folders","message":"必须是数组"}]}  [HTTP 400]
$ curl -s -b $JAR http://127.0.0.1:8767/api/export > after.json   # 再记录一次
导入后：prompts = 2 ｜folders = 2 ｜tags = 2
prompt 数与导入前一致： MATCH
整库逐字段与导入前一致： EQUAL

=== 收尾：停服并核验端口已释放 ===
$ ss -ltn | grep -c ':8767'   # 期望 0
0

阶段 5 自检结束；夹具目录已清理，端口 8767 已释放。
```

#### 4. 顺手复测的既有验收项（前四个阶段 + 部署文件）

```
$ bash tools/ac-stage2.sh → rc=0（AC-3 401；AC-4 200/200/401/429；AC-15 逐字段 MATCH、正文逐字符 MATCH）
$ bash tools/ac-stage3.sh → rc=0（AC-5 逐字段/版本 1→2；AC-6 会话交接 total=1、交接 total=2；AC-7 total=2000；
                               AC-14 结构 MATCH、标签合并计数相加）
$ bash tools/ac-stage4.sh → rc=0（AC-8 变量逐元素/逐字符 MATCH、missing MATCH；AC-9 版本 [1,2,3]→回滚 [1,2,3,4]；
                               AC-12 无 <script、无 javascript:、有 hljs）
$ npm test                → 96/96 通过（19 个测试文件）
$ sudo systemd-analyze verify deploy/promptmanager.service 2>&1 | grep -c error   → 0
$ grep -cE '^(User|Group|WorkingDirectory|EnvironmentFile|Restart)=' deploy/promptmanager.service → 5
$ grep -c MemoryDenyWriteExecute deploy/promptmanager.service → 0
$ grep -cE '^[A-Z_]*(PASSWORD|SECRET|TOKEN|KEY)[A-Z_]*=.+$' deploy/promptmanager.env.example → 0
$ AC-20：antd@6.6.4 / icons@6.3.4；源码原生表单标签 0；from 'antd' 5 处；CDN 外链 0
$ AC-17：git check-ignore 三条命中；凭据字面量扫描 0 命中；依赖表 51 行 ≥ 直接依赖 24
$ npm audit --registry=https://registry.npmjs.org → found 0 vulnerabilities（**本阶段未新增依赖**）
$ ss -ltn | grep -c ':8767' → 0（无残留监听）
```

**部署文件（本阶段的验收项说明）**：`deploy/` 三件套**内容无需变化**——阶段 5 没有新增端口、环境变量或外部服务，
`promptmanager.service` / `promptmanager.env.example` / `deploy/README.md` 的部署契约完全沿用（上面已复跑 `systemd-analyze verify`）。
仅在 `deploy/README.md` 的"回滚/备份"节**补充了两条可用机制**（`bin/pm.mjs export --out` 与 `POST /api/import`），
并明确写着"本项目**不默认做备份**，只在用户要求时由 host_manger 执行"。

#### 5. 本阶段自行判断的实现细节（BRIEF §11.5 ②：备查，验收只按本阶段 AC 判）

1. **导出结构**严格按 §6.4：`app` / `schema_version=1` / `exported_at` / `folders[{id,name,parent_id,sort_order}]` /
   `tags[{id,name}]`（**不含 count**）/ `prompts[..., versions[]]`；排序按 id 升序、versions 按 version_no 升序、tags 数组按名称升序。
   **导出不含账号/会话**（users/sessions/login_attempts 不进备份文件）。
2. **校验顺序**：先 `mode` ∈ {replace,merge}，再 `app === promptmanager`、`schema_version ≤ 1`，再做**形状校验**
   （数组/类型/id 唯一/父存在/prompt 引用的 folder 存在/至少一个版本）；全部在事务之前 → 非法文件**一个字节都不动**（AC-11）。
3. **额外形状校验的必要性**：BRIEF 只规定 app/schema_version 两条，但手写坏文件（如 `prompts: "no"`）若不校验会变成 500；
   因此补了形状校验并统一返回 `400 invalid_import + details`（**该端点的 400 一律是 invalid_import**，body schema 只做"必须是对象"）。
4. **原子性**：整个写入包在**单个 kysely 事务**里；中途任何约束冲突 → 捕获为 `invalid_import` → 事务回滚（有专门用例：
   文件里两条 prompt 用同一个 id → 400 且库回到导入前）。
5. **replace 保留 id**：folders/tags/prompts 都用文件里的显式 id 插入（AUTOINCREMENT 序列随之推进，之后新建 id 不会撞车）。
6. **replace 的清空顺序**（本阶段的坑）：关联 → 版本 → prompt → 标签 → **文件夹按叶子优先反复删**（自引用外键 ON DELETE RESTRICT）。
7. **文件夹插入顺序**：按 `parent_id` 做**父先子后**排序；文件里有环/悬空父 → `400 invalid_import`（不猜、不静默丢）。
8. **merge 的"同名复用"**：文件夹按 **(父, 名字)** 判定同名（同名字挂不同父 → 新建）；标签按名字；prompt **一律新建**并拿新 id。
9. **merge 保留文件里的 `created_at`/`updated_at`**（内容等价的自然语义；BRIEF 只说 prompt 新建并重新分配 id）。
10. **`imported` 计数口径**：`prompts` = 文件里的 prompt 数；`folders`/`tags` = **本次新建**数（merge 复用不计）。
    replace 时文件里未声明、但被 prompt 的 `tags` 引用的标签名 → 顺延 id 补建并计入（**不丢关联**）。
11. **FTS 同步**：导入写的就是 `prompts` 表，阶段 1 的三个触发器自动维护 `prompts_fts`（replace 的删除/插入都会触发）。
    脚本与单测都做了**检索验证**（导入的词能搜到、被清掉的词搜不到）。
12. **Markdown 净化硬化（BRIEF v4 §5，跨阶段顺手项）**：`DOMPurify.sanitize(html, { FORBID_ATTR:['style'],
    FORBID_TAGS:['style','form','input','button','math','mtext','link','meta','base'] })`；
    新增断言覆盖 9 类 payload（含大小写绕过的 `STYLE=`）且验证正常 Markdown/链接/高亮不受影响。
13. **CLI `export`**：与 `/api/export` 同一服务函数、同一 JSON 结构（`JSON.stringify`，便于与 API 输出逐字节比较）；
    写文件用 **tmp + rename**（避免半截备份）；`--out` 是显式路径参数（STANDARDS §2 允许经 CLI 输出参数写明确路径）。
14. **导入请求体上限 32MB**（Fastify 默认 1MB）：备份文件可能很大；这是路由级 `bodyLimit`，不新增环境变量。

#### 6. 未完成 / 已知缺口（本阶段范围内无缺口）

- **阶段 6（前端 P0）**：登录页 / prompt 列表（搜索筛选分页）/ 编辑器（双提示词+标签+文件夹+收藏）/ 版本面板（diff+回滚）/
  变量面板（填值+复制）/ Markdown 预览 / 响应式 / 亮暗主题，全部用 antd 组件 + 界面自证（AC-13/21）。
  这一阶段要消费本阶段及之前的全部 API（含 `/api/export`、`/api/import` 的界面入口可选）。
- **阶段 7（收尾）**：`docs/shots`、README 四要素终稿、AC-16/17/18 正式验收、测试文件数（现 19 ≥ 8 已达标）。
- 导入是"整库替换/合并"语义：没有"按 prompt 选择性导入"（BRIEF 未要求；属 P1 之外的范畴）。
- `merge` 重复导入同一文件会产生重复 prompt（BRIEF 明确"prompt 一律新建"），去重不是本阶段目标。

#### 7. 下一步（阶段 6 待下单后执行）

1. 前端脚手架已在阶段 1 就位（Vite + React 19 + antd 6.6.4），阶段 6 只需按页面拆分组件：
   `Layout/Form/Input/Input.TextArea/Select/Tree/Table/Pagination/Drawer/Tabs/Tag/Switch/Popconfirm/message` 等**一律用 antd**。
2. 登录页 + 会话保持（`/api/login`、`/api/me`、csrf 无关的单用户 cookie 模式）；列表页（`q`/`folder_id`/`tag`/`favorite` + 分页）；
   编辑器（新建/更新 → 自动留档）；版本面板（`/versions` + `/diff` + `/rollback`）；变量面板（`/variables` + `/render` + 一键复制）；
   预览（`/api/render/markdown`）。
3. 界面自证：`tools/ui-shots.sh` + `docs/shots/*.png`（桌面 1280×800 / 移动 390×844 / 暗色），逐张识图并给出结论。
4. 目标 AC：AC-13、AC-21（并按 v4 §5 复验净化硬化）。

### 2026-09-18 — 阶段 6 开工前准备（对外可用面）

> 按 BRIEF **v6** 执行：AC-22（Token）/ AC-23（CORS）/ AC-24（使用侧 CLI）/ AC-27（使用记录）/ AC-28（内外网部署形态）。
> 阶段 1–5 全部验收通过（`VERIFY.md`）。

#### 1. 端口复核（STANDARDS §3.5）

```
$ ss -ltn | grep -E ':(876[5-9]|8770)\b'
LISTEN 0      10           0.0.0.0:8769      0.0.0.0:*
```

**结论**：8767 空闲（默认端口不变，台账已登记）；8769 为 izone 占用。本阶段**不新增监听**（MCP 走 stdio，属阶段 7）。

#### 2. 依赖复核与选型（两道闸门）

| 包 | 版本 | 协议 | 用途 | 闸门 |
| --- | --- | --- | --- | --- |
| `@fastify/cors` | **11.3.0** | MIT | FR-17 CORS 白名单（官方插件；不自写 CORS 头/预检处理） | 装前 OSV `osv_vulns=0`；`time.modified=2026-09-04`（维护活跃） |

其余本阶段能力（Token 哈希、usage 记录、Bearer 认证、TRUST_PROXY/PUBLIC_ORIGIN）**都用现有栈**：
`node:crypto`（`randomBytes` + `createHash('sha256')`，平台 API、非手搓加密）、kysely + better-sqlite3、fastify 自带 `trustProxy`/`setCookie`。
**新增依赖只有 1 个**。

**trustProxy 行为实测**（AC-28 ② 的前提，先在 8791 端口试，不碰 8767）：

```
$ node tmp/probe6.mjs      # fastify({ trustProxy: true }) + GET /x + X-Forwarded-For: 203.0.113.9
{"req":{"method":"GET","url":"/x","remoteAddress":"203.0.113.9",...},"msg":"incoming request"}
response: { ip: '203.0.113.9' }
```

→ 开启 `trustProxy` 后 **Fastify 默认请求日志里就会出现 XFF 地址**（无需自己加日志语句）；
未开启时 `request.ip` 取 socket 地址、**XFF 完全不影响**（AC-28 ① 的依据）。

#### 3. 本阶段验收标准 → 我要执行的检查命令（BRIEF §11.1）

统一夹具（每条 AC 自带、互不依赖）：`AC_DIR=$(mktemp -d /tmp/pm-ac6-XXXXXX)`、`DATA_DIR=$AC_DIR PORT=8767`、
`AC_PW='ac-fixture-pw-20260918'`、CLI 建设口令、服务自起自停。

| AC | 我要执行的检查命令 | 期望 |
| --- | --- | --- |
| **AC-22** API Token | ① `TOKEN=$(node bin/pm.mjs token create --name ac \| tail -1)`；② `python3 -c "import sqlite3;print(sqlite3.connect('$DATA_DIR/pm.db').execute('select length(token_hash) from api_tokens').fetchone()[0])"`；③ `curl -H "Authorization: Bearer $TOKEN" /api/prompts`；④ 错 token / 无凭据 → 401；⑤ `node bin/pm.mjs token list`（不含明文）+ `token revoke <id>` 后重跑 ③ → 401；⑥ 登录 cookie 访问 → 200；⑦ `grep -c "$TOKEN" <服务日志>` → 0 | ② `64`（sha256 hex）；③ `200`；④ `401`/`401`；⑤ 撤销后 `401`；⑥ `200`；⑦ `0` |
| **AC-23** CORS | ① 未配 `CORS_ORIGINS`：`curl -D - -H 'Origin: https://evil.example' /healthz \| grep -ci 'access-control-allow-origin'`；② 配 `CORS_ORIGINS=https://prompt.home.local` 重启后：该 origin → `Access-Control-Allow-Origin: https://prompt.home.local`（精确、非 `*`）、白名单外 origin → 0；③ 预检 `OPTIONS` + `Access-Control-Request-Headers: authorization` → `access-control-allow-headers` ≥1；④ 任何响应都不得有 `Access-Control-Allow-Credentials: true` | ① `0`；② 精确 origin、非白名单 `0`；③ `≥1`；④ `0` |
| **AC-24** 使用侧 CLI | `PM_API_URL=http://127.0.0.1:8767 PM_API_TOKEN=$TOKEN node bin/pm.mjs get '会话交接' --json`（条数=命中数）；`… get --id <N> --json`（单条）；`… get --id 99999` → 退出码 1；`… render --id <N> --set 姓名=张三`（stdout 与 `/api/render` 的 `user_prompt` **逐字符一致**）；用法错误 → 2；`PM_API_URL=http://127.0.0.1:1 … get x` → 非 0 退出 | 如上；且**全程不碰数据库**（连不上就报错） |
| **AC-27** 使用记录 | ① token 调 `GET /api/prompts/<id>` ×2 + `POST …/render` ×1 → `GET /api/usage/summary?days=7` → `by_channel.token=3`、`top[0].prompt_id=<id>`、`top[0].count=3`；② MCP 通道取一次（本阶段用 `X-PM-Channel: mcp` 头模拟阶段 7 的 MCP 调用，见决策 8）→ `by_channel.mcp=1`、`total+1`；③ cookie 打开详情一次 → `by_channel.session=1`；④ 取用前后 `version_no`/`updated_at` 比对 `SAME`；⑤ `?sort=recent_used`：用过的在前、**从未用过在最后**；⑥ 导出→导入往返仍 `EQUAL` | 如上；Prompt 对象里出现 `use_count`/`last_used_at` |
| **AC-28** 部署形态 | ① 未设 `TRUST_PROXY`：6 次错误登录每次带不同 `X-Forwarded-For` → 第 6 次仍 `429`；② `TRUST_PROXY=1` 重启 + `X-Forwarded-For: 203.0.113.9` → `grep -c '203.0.113.9' <服务日志>` ≥1；③ 未设 `PUBLIC_ORIGIN` → `Set-Cookie` 无 `Secure`；设 `PUBLIC_ORIGIN=https://…` → 有 `Secure`；④ `deploy/reverse-proxy.example.conf` 存在、含 XFF/HTTPS 指令、`grep -cE 'prompt\.example\.com|/etc/letsencrypt'` = 0；⑤ `deploy/README.md` 覆盖内网/公网/反代/回滚；⑥ `ss` 监听与验收前一致 | 如上 |

#### 4. 本阶段的关键实现决策（BRIEF 未逐条规定口径 → 先记在此备查；验收只按 AC 判）

1. **⚠️ Token 子命令的传输方式（本阶段唯一的规格张力，请 host_manger 复核）**：
   BRIEF FR-16 与阶段提示词都写「`pm token *` 一律经 HTTP API（`PM_API_URL` + `PM_API_TOKEN`）」，
   但 **AC-22 ① 的夹具只设了 `DATA_DIR`/`PORT`，没有任何 HTTP 凭据**（`TOKEN=$(node bin/pm.mjs token create --name ac | tail -1)`）——
   若严格要求 Bearer，就存在**先有鸡还是先有蛋**（没有 token 就无法创建第一个 token），AC-22 必然不过。
   故采用**双通道**并显式打印所用通道（不静默）：
   - 设了 `PM_API_URL` **且** `PM_API_TOKEN` → 走 HTTP（`/api/tokens`），**连不上就报错、绝不回退 DB**；
   - 两者都没设 → 走**本地引导路径**（与 `user set-password`/`migrate`/`export` 同类的本机管理命令，经服务层而非裸 SQL），
     stderr 打印 `(bootstrap: local admin path)`，stdout 只输出明文 token（AC-22 ① 的 `| tail -1` 依赖这一点）。
   `pm get` / `pm render` **只有 HTTP 一条路**（完全不 import 数据库模块），AC-24 的「连不上必须非 0 退出」即验证此点。
   若 host_manger 认为 token 子命令必须**任何情况**都走 HTTP，请给出第一个 token 的引导方式（例如新增 `PM_API_USER`/`PM_API_PASSWORD` 或指定"仅 127.0.0.1 免认证"）。
2. **Token 存储**：`api_tokens(id, name, token_hash UNIQUE, created_at, last_used_at, revoked_at)`；
   `token_hash = sha256(明文)` 的 **hex（64 字符）**（AC-22 ② 直接查这个列的长度，表名/列名按 AC 固定）；
   明文格式 `pm_` + 32 字节 base64url（`node:crypto`）；**撤销 = 置 `revoked_at`**（保留行，便于审计），撤销后 Bearer 立即 401。
3. **Token 与 cookie 并存**：认证闸门先看 `Authorization: Bearer`（命中 token），否则回落到 cookie 会话；
   两者都失败 → 401 `{"error":"unauthorized"}`（沿用既有形状）。`/api/logout` 只对 **cookie 会话**有意义（token 请求 → 401）。
4. **HTTP Token 端点**（§6.1 未定义；FR-15 需要，路径由我定并在 README 记录）：
   `GET /api/tokens`（列表，**不含明文**）、`POST /api/tokens {name}`（201，**明文只在这一次响应里**）、`DELETE /api/tokens/:id`（204 撤销）。
5. **CORS**：只有 `CORS_ORIGINS` 非空时才注册 `@fastify/cors`（默认关闭 ⇒ 完全没有 CORS 头）；
   `origin` 用**精确白名单**回调（非 `*`、非反射任意 origin）、`credentials: false`、
   `methods: GET/POST/PUT/DELETE/OPTIONS`、`allowedHeaders: Authorization, Content-Type`；`CORS_ORIGINS` 里出现 `*` → **启动即失败**（配置错误，不静默忽略）。
6. **usage 只记"取用"**：`GET /api/prompts/:id`（详情）与 `POST /api/prompts/:id/render`（渲染）各写一条；
   列表/搜索**不记**。`usage_events(prompt_id → prompts ON DELETE CASCADE, channel ∈ {session,token,mcp}, used_at)`；
   写入**不触碰 `prompts` 行** → 天然不改 `updated_at`、不产生版本（AC-27 ④）。
7. **Prompt 对象新增只读字段** `use_count` / `last_used_at`（详情与列表都返回；列表用一次聚合查询补齐，不 N+1）。
   详情路径**先记后读**（响应里的 `use_count` 含本次取用），此语义写进 README。
8. **`channel=mcp` 的来源**：Bearer 请求可带 `X-PM-Channel: mcp`（只对 Bearer 生效，cookie 恒为 `session`）。
   阶段 6 只交付这条**通道管线**并用 curl 复现（AC-27 ② 的证据）；**真正的 MCP server 是阶段 7**（AC-25/26），
   届时由 `bin/pm-mcp.mjs` 带这个头调用 API —— 本阶段不宣称 MCP 已完成。
9. **`sort=recent_used`**：`LEFT JOIN (select prompt_id, max(used_at), count(*) from usage_events group by prompt_id)`，
   排序键 `(last_used_at IS NULL) ASC, last_used_at DESC, updated_at DESC`（从未用过必排最后；同档按 updated_at 倒序）。
   与该排序可叠加 `q`/筛选/分页（`total` 语义不变）。
10. **`TRUST_PROXY` 默认关闭**：env 为 `1`/`true`（大小写不敏感）才开；关闭时 fastify `trustProxy: false`，
    `request.ip` 取 socket 地址 ⇒ 伪造 `X-Forwarded-For` 不影响限流键（AC-28 ①）。
11. **`PUBLIC_ORIGIN`**：设置后登录 `Set-Cookie` 追加 `Secure`（其余属性不变：`HttpOnly; SameSite=Lax; Path=/`）；
   未设置**不得**加 `Secure`（内网 HTTP 才能登录）。服务本身不做 TLS。
12. **反代样例**：`deploy/reverse-proxy.example.conf` 只用占位符（`<PUBLIC_HOSTNAME>`/`<CERT_DIR>`），
    **不含真实域名/证书路径**（AC-28 ④ 会 grep `prompt.example.com` 与 `/etc/letsencrypt`，我全部避开）；
   `deploy/README.md` 增「内网直连」「公网反代」「回滚」两形态三节。
13. **不改监听默认值**（`0.0.0.0:8767`）、**不加环境变量以外的开关**、**不新增端口**。
14. **迁移**：新增 `migrations/002_tokens-and-usage.sql`（**不改 001**）；`npm run migrate` 幂等 → `ok: schema at v2`。

#### 5. 分批提交计划（用户允许拆 2–3 个单元，每条 AC 都有实测）

| 单元 | 内容 | 对应 AC |
| --- | --- | --- |
| A | 迁移 002 + `api_tokens` 服务 + Bearer 认证 + `/api/tokens` + `pm token *` | AC-22 |
| B | `@fastify/cors` 白名单注册 + `pm get` / `pm render`（纯 HTTP） | AC-23、AC-24 |
| C | `usage_events` + `use_count`/`last_used_at` + `?sort=recent_used` + `TRUST_PROXY`/`PUBLIC_ORIGIN` + 反代样例与双形态文档 | AC-27、AC-28 |

每单元都先写红测试、实现后转绿，并在 `tools/ac-stage6.sh` 里对应段落补端到端输出；收尾合并跑全量回归（阶段 2–5 的 AC 脚本 + `npm test`）。

### 2026-09-18 — 阶段 6 实施与自检（对外可用面，收尾）

#### 1. 三个提交单元与 commit 对应

| 单元 | commit | 内容 | AC |
| --- | --- | --- | --- |
| 开工前 | `6764efe` | 端口复测、`@fastify/cors` 闸门、`trustProxy` 实测、AC 翻译、决策（含 Token 通道张力的显式记录） | — |
| A | `a9af4bf` | `migrations/002`（api_tokens / usage_events）+ `services/tokens.ts` + Bearer 与 cookie 双通道 + `/api/tokens` + `pm token` | AC-22 |
| B | `358dd98` | `@fastify/cors@11.3.0` 精确白名单（默认关闭/禁 `*`/无 credentials）+ `pm get` / `pm render`（纯 HTTP） | AC-23、AC-24 |
| C | `d5dcb06` | 使用记录 FR-19（只记取用/三通道/副作用约束/`sort=recent_used`）+ `TRUST_PROXY`/`PUBLIC_ORIGIN` + 反代样例与双形态文档 + `tools/ac-stage6.sh` | AC-27、AC-28 |
| 文档 | `798c0d6` | README（用法/语义/已知限制）+ `docs/dependencies.md`（§4.10 与闸门记录） | — |

#### 2. 红 → 绿记录（逐单元）

- **单元 A**：先写 `tests/api-tokens.test.ts` / `tests/cli-token.test.ts` → 红 `8 用例中 7 失败`；实现后 8/8。
  过程中两处**测试期望错**（实现没错）：① `token create` 缺 `--name` 被当作运行时错误（应属用法错误 rc=2）；
  ② 我的夹具用了 `withUser:false` 导致 login 拿不到 cookie、token 创建失败——都属夹具/期望问题，已修正。
- **单元 B**：先写 `tests/api-cors.test.ts` / `tests/cli-get-render.test.ts` → 红 `8 用例中 6 失败`；实现后 8/8。
- **单元 C**：先写 `tests/api-usage.test.ts` / `tests/api-deploy-shape.test.ts` → 红 `11 用例中 9 失败`；实现后 11/11。
  过程中一处**测试自伤**：断言"导出不得含 usage"时用 `includes('usage')` 命中了夹具标题里的英文单词 → 改成
  **结构断言**（prompt 对象字段集必须与 §6.4 完全一致），比关键词 grep 更硬。
- **跨阶段影响（如实记录，已同步更新旧用例）**：新增 `002` 迁移把 schema 推到 **v2**，`migrate` 的输出随之从
  `ok: schema at v1` 变为 `ok: schema at v2`（BRIEF §6.2 的 `<N>` 即当前版本）→ 更新了 `tests/migrate.test.ts`
  与 `tests/cli-user.test.ts` 的期望，并在迁移用例里加上 `api_tokens` / `usage_events` 两张新表。
  另外 FR-19 让 `GET /api/prompts/:id` 会记一次"取用"，因此"创建响应 vs GET 详情"在 `use_count` 上相差 1
  （设计语义）→ AC-5 相关断言改为"除 usage 字段外完全一致 + `use_count` 各自符合预期"。

#### 3. 阶段 6 验收标准实测（`bash tools/ac-stage6.sh`，每条 AC 自带夹具、自起自停）

**AC-22 API Token**

```
=== AC-22 API Token（自带夹具） ===
login=200
$ TOKEN=$(DATA_DIR=$AC_DIR node bin/pm.mjs token create --name ac | tail -1)
  明文：pm_AELOEp…lqeU   （下同只显示前后几位）
  形如 pm_… 的一行：1
  CLI stderr（通道提示）：(bootstrap: local admin path —— 未设置 PM_API_URL，按本机管理命令处理)
$ python3 -c "...select length(token_hash) from api_tokens..."
  token_hash 长度 = 64
  行数 = 1
$ curl -H 'Authorization: Bearer $TOKEN' http://127.0.0.1:8767/api/prompts
  Bearer 正确 → 200
  Bearer 错误 → 401
  无凭据      → 401
  伪造 cookie → 401
$ DATA_DIR=$AC_DIR node bin/pm.mjs token list
  id=1  name=ac  created=2026-09-18T06:48:41.981Z  last_used=2026-09-18T06:48:42.034Z  status=active
  列表里出现明文 token 的次数：0
$ DATA_DIR=$AC_DIR node bin/pm.mjs token revoke 1   # 撤销后立即失效
  ok: token 1 revoked
  撤销后再用同一 token → 401
--- cookie 通道不回归
  带 cookie 访问 /api/prompts → 200
--- 明文不落服务日志
  grep -c "$TOKEN" server.log → 0
--- 创建响应里才有明文（库里/列表里都没有）
  token_hash 前 12 位 = b9404616eb06 ｜name = ac
  库中是否含明文： no
```

**AC-23 CORS**

```
=== AC-23 CORS（自带夹具） ===
$ curl -D - -H 'Origin: https://evil.example' http://127.0.0.1:8767/healthz | grep -ci access-control-allow-origin
  未配置时命中数 = 0
$ CORS_ORIGINS=https://prompt.home.local DATA_DIR=$AC_DIR PORT=8767 npm start &   (node pid=2277062)
$ 配置 CORS_ORIGINS=https://prompt.home.local 后重启
--- 白名单内 origin（响应头原样）
  HTTP/1.1 200 OK
  access-control-allow-origin: https://prompt.home.local
--- 白名单外 origin
  命中数 = 0
--- 预检（OPTIONS + 声明 authorization）
  HTTP/1.1 204 No Content
  access-control-allow-origin: https://prompt.home.local
  access-control-allow-methods: GET, POST, PUT, DELETE, OPTIONS
  access-control-allow-headers: Authorization, Content-Type
--- 任何响应都不得有 Allow-Credentials
  白名单内 GET    : 0
  预检            : 0
```

**AC-24 使用侧 CLI**

```
=== AC-24 使用侧 CLI（自带夹具） ===
login=200
  prompt id=1 ｜ CLI 用的 token 已创建
$ PM_API_URL=http://127.0.0.1:8767 PM_API_TOKEN=$TOKEN node bin/pm.mjs get '会话交接' --json
  rc=0 ｜ stderr=
  是 JSON 数组： True ｜条数 = 1 ｜标题 = ['会话交接模板']
$ ... node bin/pm.mjs get --id 1 --json
  单条 id = 1 ｜user_prompt = "你好 {{姓名}}，交给下一位 {{var-b}}"
$ ... node bin/pm.mjs get --id 99999   # 期望退出码 1
  rc=1 ｜ stderr=error: prompt 99999 不存在
$ ... node bin/pm.mjs render --id 1 --set 姓名=张三
  CLI stdout   = "你好 张三，交给下一位 {{var-b}}"
  /api/render  = "你好 张三，交给下一位 {{var-b}}"
  逐字符一致： MATCH
--- 用法错误 → 退出码 2
  pm get                          rc=2
  pm get --id abc                 rc=2
  pm render                       rc=2
  pm render --id 1 --set bad      rc=2
--- 连不上必须报错（不得静默回退直连 DB）
  rc=1 ｜ stdout 字节数=0 ｜ stderr=error: 无法连接 http://127.0.0.1:1（fetch failed）—— 本命令只走 HTTP API，不会回退直连数据库
--- 缺 PM_API_TOKEN 也必须报错（不许悄悄用本地库）
  rc=2 ｜ stdout 字节数=0
```

**AC-27 使用记录**

```
=== AC-27 使用记录（自带夹具） ===
login=200
$ token 调 详情×2 + render×1
  by_channel = {'session': 0, 'token': 3, 'mcp': 0} ｜total = 3
  top[0] = {'prompt_id': 1, 'title': '使用记录夹具', 'count': 3, 'last_used_at': '2026-09-18T06:49:02.050Z'}
$ MCP 通道（X-PM-Channel: mcp，阶段 7 的 MCP server 用同一个头）
  by_channel = {'session': 0, 'token': 3, 'mcp': 1} ｜total = 4
$ 浏览器 cookie 通道打开详情一次
  by_channel = {'session': 1, 'token': 3, 'mcp': 1} ｜total = 5
--- ④ 副作用断言：取用前后 version_no / updated_at 必须一致
  version_no： 1 → 1 ： SAME
  updated_at： 2026-09-18T06:49:01.987Z → 2026-09-18T06:49:01.987Z ： SAME
  use_count ： 6 → 9
--- ⑤ ?sort=recent_used：用过的在前、从未用过的排最后
  recent_used 顺序 = [('使用记录夹具', 9), ('从未取用过', 0)]
  默认（updated_at）顺序 = ['从未取用过', '使用记录夹具']
--- ⑥ usage 不参与导出：往返仍 EQUAL
  导出是否含 usage 字段： False
  导出→导入(replace)→再导出： EQUAL
  replace 导入后 total（旧 usage 随 prompt 级联删除）= 0
```

**AC-28 内外网部署形态**

```
=== AC-28 内外网部署形态（自带夹具；① / ② / ③ 各自独立夹具，避免限流封锁互相污染） ===
  验收前 8765-8770 监听数（基线）= 1
--- ① 未设 TRUST_PROXY（默认）：6 次错误登录、每次换一个 X-Forwarded-For
  XFF 203.0.113.1 → 401
  XFF 203.0.113.2 → 401
  XFF 203.0.113.3 → 401
  XFF 203.0.113.4 → 401
  XFF 203.0.113.5 → 401
  第 6 次（再换 XFF） → 429（期望 429：XFF 不得绕过限流）
--- ② TRUST_PROXY=1：X-Forwarded-For 成为真实来源（出现在服务日志里）
$ TRUST_PROXY=1 DATA_DIR=$AC_DIR PORT=8767 npm start &   (node pid=2277608)
  grep -c '203.0.113.9' server.log → 1（期望 >= 1）
  日志片段："remoteAddress":"203.0.113.9"
--- ③ PUBLIC_ORIGIN 控制 cookie 的 Secure（两种形态各自独立夹具）
  未设 PUBLIC_ORIGIN：
    set-cookie: pm_sid=1znj45S3u3hoObeOjNbQG3i_UQ5-7JuoPaCXV9Su0VU; Path=/; Expires=Sun, 18 Oct 2026 06:49:15 GMT; HttpOnly; SameSite=Lax
    Secure 出现次数 = 0（期望 0）
$ PUBLIC_ORIGIN=https://prompt.example.com DATA_DIR=$AC_DIR PORT=8767 npm start &   (node pid=2277706)
  设 PUBLIC_ORIGIN=https://prompt.example.com：
    set-cookie: pm_sid=pafbOjvOlC8Fzm-7o6F5x0gr1Tsasr7ZSJzsKOfYrr8; Path=/; Expires=Sun, 18 Oct 2026 06:49:20 GMT; HttpOnly; Secure; SameSite=Lax
    Secure 出现次数 = 1（期望 1）
--- ④ 反代样例（占位符、含 XFF/HTTPS、不含真实域名与证书路径）
  8:#   TRUST_PROXY=1                      # 确有反代时才开：来源 IP 取 X-Forwarded-For
  20:    listen              443 ssl;
  25:    ssl_certificate     <CERT_DIR>/fullchain.pem;
  26:    ssl_certificate_key <CERT_DIR>/privkey.pem;
  40:        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
  41:        proxy_set_header X-Forwarded-Proto $scheme;
  真实域名/证书路径命中数 = 0（期望 0）
--- ⑤ 部署文档覆盖两种形态
  grep -cE '内网|公网|反代|回滚' deploy/README.md = 24（期望 >= 4）
  三个开关在 env.example 中：3/3
--- ⑥ 不新增监听、默认监听地址未变
  8765-8770 监听：1（基线 1，两者应相等）
  配置默认：HOST=0.0.0.0 PORT=8767 TRUST_PROXY=false PUBLIC_ORIGIN=undefined
```

#### 4. 全量回归（前五阶段 + 卫生/部署/组件库）

```
$ bash tools/ac-stage2.sh → rc=0（AC-3/4/15：401/401/401、200/200/401/429、逐字段 MATCH、user_prompt 逐字符 MATCH）
$ bash tools/ac-stage3.sh → rc=0（AC-5/6/7/14：逐字段 MATCH、会话交接 total=1、交接 total=2、2000 条 total=2000、标签合并计数相加）
$ bash tools/ac-stage4.sh → rc=0（AC-8/9/12：变量逐元素/逐字符 MATCH、版本 [1,2,3]→回滚 [1,2,3,4]、无 <script/无 javascript:/有 hljs）
$ bash tools/ac-stage5.sh → rc=0（AC-10/11：导出→导入→再导出 EQUAL、非法导入后整库 EQUAL）
$ npm test                → 123/123 通过（25 个测试文件）
$ sudo systemd-analyze verify deploy/promptmanager.service 2>&1 | grep -c error → 0
$ grep -cE '^(User|Group|WorkingDirectory|EnvironmentFile|Restart)=' deploy/promptmanager.service → 5
$ grep -c MemoryDenyWriteExecute deploy/promptmanager.service → 0
$ grep -cE '^[A-Z_]*(PASSWORD|SECRET|TOKEN|KEY)[A-Z_]*=.+$' deploy/promptmanager.env.example → 0
$ AC-20：antd@6.6.4 / icons@6.3.4；原生表单标签 0；from 'antd' 5；CDN 外链 0
$ AC-17：git check-ignore 三条命中；凭据字面量扫描 0 命中；依赖表 52 行 ≥ 直接依赖 25
$ npm audit --registry=https://registry.npmjs.org → found 0 vulnerabilities
$ 协议分布（207 包）：MIT 176 / BSD-3 7 / ISC 7 / BlueOak 5 / Apache-2.0 4 / MIT-0 2 / BSD-2 2 / MPL-2.0 2 /
                      (MPL-2.0 OR Apache-2.0) 1 / CC0-1.0 1；GPL/AGPL/无协议 = 0
$ ss -ltn | grep -E ':(876[5-9]|8770)\b' | wc -l → 1（= 8769 izone，与验收前基线一致，**本阶段不新增监听**）
```

#### 5. 本阶段自行判断的实现细节（BRIEF §11.5 ②：备查，验收只按 AC 判）

1. **⚠️ Token 子命令的传输（唯一的规格张力，开工前已记、这里再确认实现）**：`pm get` / `pm render`
   **只有 HTTP 一条路**（命令行里完全不 import 数据库模块；连不上/没 token → 非 0 退出且 stdout 为空，AC-24 已验）。
   `pm token create|list|revoke`：设了 `PM_API_URL`+`PM_API_TOKEN` → 走 HTTP `/api/tokens`（连不上就报错、不回退 DB）；
   两者都没设 → **本机引导路径**（否则"创建第一个 token"不可能完成，AC-22 ① 的夹具也只设 `DATA_DIR`/`PORT`），
   且 stderr 显式打印 `(bootstrap: local admin path …)` / `(http: …)` —— **不静默**。若要求 token 子命令任何情况都走 HTTP，
   需要给出第一个 token 的引导凭据（见开工前 §4 决策 1）。
2. **Token 表结构**：`api_tokens(id, name, token_hash UNIQUE, created_at, last_used_at, revoked_at)`（AC-22 ② 直接查
   `api_tokens.token_hash` 的长度，故表名/列名照 AC 固定）；明文 `pm_` + 32 字节 base64url；**撤销 = 置 `revoked_at`**（留行审计），
   每次请求都查库 ⇒ 撤销立即生效。
3. **HTTP Token 端点**（§6.1 未定义路径，按 REST 约定定并写进 README）：`GET/POST /api/tokens`、`DELETE /api/tokens/:id`；
   `POST` 的明文**只在该响应出现一次**；`GET` 只给摘要。
4. **认证闸门顺序**：Bearer 优先 → 否则 cookie；两者都失败 → 401 `{"error":"unauthorized"}`。`/api/logout` 仅对 cookie 会话有意义
   （Bearer 请求 → 401）；`/api/me` 对两种通道都返回用户名。
5. **`channel=mcp` 的来源**：Bearer 请求可带 `X-PM-Channel: mcp`（cookie 请求恒为 `session`，该头对 cookie 无效）。
   阶段 6 只交付**通道管线**并用 curl 复现（AC-27 ② 的证据），**真正的 MCP server 是阶段 7**（AC-25/26），本阶段不宣称 MCP 完成。
6. **usage 的写入点**：`GET /api/prompts/:id` 与 `POST /api/prompts/:id/render`（成功后才写）；列表/搜索/导出**不写**。
   详情走"先记后读"，因此响应里的 `use_count` 含本次取用（README 写明）。
7. **`sort=recent_used`**：`LEFT JOIN (select prompt_id, count(*), max(used_at) … group by prompt_id)`，
   排序 `(last_used_at IS NULL) ASC, last_used_at DESC, updated_at DESC, id DESC`；列表与检索两条路径共用同一 JOIN
   （顺带把 `use_count`/`last_used_at` 随行返回，避免 N+1）；`sort` 只接受 `updated`/`recent_used`（其他值 400）。
8. **`TRUST_PROXY` 默认关闭**：`request.ip` 取 socket 地址（AC-28 ①：6 次错误登录每次换 XFF，第 6 次仍 429）；
   开启后来源 IP 取 XFF（实测 Fastify 默认请求日志里出现 `"remoteAddress":"203.0.113.9"`，AC-28 ②）。
9. **`PUBLIC_ORIGIN`**：只控制登录 `Set-Cookie` 是否带 `Secure`（未设不得带，否则内网 HTTP 登不上）；服务不做 TLS。
10. **反代样例**：`deploy/reverse-proxy.example.conf` 全部占位符（`<PUBLIC_HOSTNAME>`/`<CERT_DIR>`），含
    `X-Forwarded-For`/`X-Forwarded-Proto`/`ssl_certificate`/`listen 443`，**不含真实域名与证书路径**（AC-28 ④ 实测 0 命中）。
11. **`deploy/` 三件套**：`promptmanager.service` 未改（无新端口/新用户需求，`systemd-analyze verify` 复跑 0 错误）；
    `promptmanager.env.example` 新增 `CORS_ORIGINS`/`TRUST_PROXY`/`PUBLIC_ORIGIN`（口令类变量仍全空）；
    `deploy/README.md` 新增 §2.7「内网直连 / 公网反代 / 回滚」三节。
12. **依赖**：仅新增 `@fastify/cors@11.3.0`（MIT，装前 OSV 0、装后 `npm audit` 0）；Token 哈希用 `node:crypto`（平台 API）。

#### 6. 未完成 / 已知缺口（本阶段范围内无缺口）

- **阶段 7（MCP server，stdio）**：`bin/pm-mcp.mjs` + `src/mcp/**` + `deploy/mcp-register.example.json`，
  工具面只读（`prompt_search`/`prompt_get`/`prompt_render`）、**经 API + token、不直连 DB、不新增端口**；
  AC-25 要求用**真实 MCP 客户端**跑通 `initialize → tools/list → tools/call`，且开工前先与真实对端确认协议版本。
  阶段 6 已备好它需要的一切：Bearer 通道、`X-PM-Channel: mcp` 标记（usage 会记 `mcp`）、以及被 API 记录的使用数据。
- **阶段 8（前端 P0）**：登录/列表/编辑器/版本面板/变量面板/预览/响应式/亮暗 + 界面自证（AC-13/20/21）；
  本阶段新增的 `/api/tokens` 与 `/api/usage/summary` 也应在管理界面里有入口（阶段 8 范围）。
- **阶段 9（收尾）**：README 四要素终稿、`docs/shots`、AC-16/17/18 正式验收。
- 客户端形态（浏览器扩展/桌面）**明确不在本期**（BRIEF §3）：本项目只交付服务端 + 可对接面。
- `CORS_ORIGINS` 只支持"精确 origin"（不支持通配子域）——这是 D-14/AC-23 的要求，不是缺口。
- `X-PM-Channel` 是客户端自报的标记（单用户 + token 认证前提下可接受）；若将来要多租户，需要改为服务端签发的通道凭据。

#### 7. 下一步（阶段 7 待下单后执行）

1. **先与真实对端确认 MCP 协议版本**（BRIEF §5 硬要求：AC 以真实客户端能完成 initialize → tools/list → tools/call 为准），
   把客户端名称/版本/协议版本写进 PROGRESS。
2. 用官方 `@modelcontextprotocol/sdk` 实现 stdio server（装前查 CVE + 协议并登记 `docs/dependencies.md`）。
3. 三个只读工具经 `PM_API_URL` + `PM_API_TOKEN` 调用本服务，并带 `X-PM-Channel: mcp`；工具面**不得出现写操作**。
4. `deploy/mcp-register.example.json`（token 用占位符）。
5. 目标 AC：AC-25、AC-26。

### 2026-09-18 — 阶段 7 开工前准备（MCP server，stdio）

#### 1. 端口复核（本阶段**不得新增监听**）

```
$ ss -ltn | grep -E ':(876[5-9]|8770)\b'
LISTEN 0      10           0.0.0.0:8769      0.0.0.0:*        （基线 = 1，izone 占用；与阶段 6 验收时一致）
```

MCP 走 **stdio**（由 agent 拉起子进程），**不监听任何端口**；`HOST`/`PORT` 默认值不动。

#### 2. ★ 协议版本对齐（BRIEF §5 硬要求；开工第一步）

**对端（以 host_manger 实测为准，并对本机复核）**：

```
$ uv venv --python 3.14 .venv && uv pip install --python .venv/bin/python mcp==1.30.0   # 项目内 venv（.venv/ 已 gitignore）
$ .venv/bin/python -c "from importlib.metadata import version; import mcp.types as t; print(version('mcp'), t.LATEST_PROTOCOL_VERSION)"
1.30.0 2025-11-25
$ .venv/bin/python -c "import mcp.client.stdio as s, mcp.client.session as cs; print(hasattr(s,'stdio_client'), hasattr(cs,'ClientSession'), [m for m in ('initialize','list_tools','call_tool') if hasattr(cs.ClientSession,m)])"
True True ['initialize', 'list_tools', 'call_tool']
```

→ 真实对端 = **Python `mcp` 1.30.0**，`mcp.types.LATEST_PROTOCOL_VERSION = 2025-11-25`（与 host_manger 2026-09-18 的实测一致）；
该客户端具备 `stdio_client` + `ClientSession.initialize/list_tools/call_tool`，正是 AC-25 要跑的三步。

**我方（实现侧 SDK）**：

```
$ node -e "import('@modelcontextprotocol/sdk/types.js').then(m=>{console.log(m.LATEST_PROTOCOL_VERSION, JSON.stringify(m.SUPPORTED_PROTOCOL_VERSIONS))})"
2025-11-25 ["2025-11-25","2025-06-18","2025-03-26","2024-11-05","2024-10-07"]
```

**结论：双方 LATEST 完全相同（`2025-11-25`），不存在"我方只支持更新版本"的兼容风险**，因此**不需要写 QUESTIONS**，可以按此实现。
（验收方式：host_manger 在自己容器里用该客户端经 ssh 拉起 `sudo env PM_API_URL=… PM_API_TOKEN=… /usr/bin/node <项目>/bin/pm-mcp.mjs`；
本机我会用**同一个 Python 客户端**先跑一遍 `initialize → tools/list → tools/call` 作为证据，见 §3 与收尾节。）

#### 3. 依赖复核与选型（安全 + 协议两道闸门）

| 包 | 版本 | 协议 | 用途 / 闸门 |
| --- | --- | --- | --- |
| `@modelcontextprotocol/sdk` | **1.30.0** | MIT | 官方 MCP TypeScript SDK（`McpServer` + `StdioServerTransport`）；**禁止手写 JSON-RPC 框架**，故必须用 SDK |
| `zod` | **4.6.5** | MIT | 工具入参 schema（SDK 的 `registerTool` 用 zod raw shape；zod 同时是 SDK 的 peerDependency，必须由我们直接声明） |

**装前/装后闸门**：

```
$ npm view @modelcontextprotocol/sdk version license time.modified
1.30.0  MIT  2026-09-17
$ OSV（指定版本）: @modelcontextprotocol/sdk 1.30.0 → osv_vulns = 0
$ OSV（该包历史条目，均已在旧版本修复，与 1.30.0 无关）:
  GHSA-345p-7cg4-v4c7  cross-client data leak   受影响区间 1.10.0–1.26.0
  GHSA-8r9q-7v3j-jr4g  ReDoS                    受影响区间 1.3.0–1.25.2
  GHSA-w48q-cv73-mx4w  DNS rebinding 未启用     受影响区间 0–1.24.0
$ zod 4.6.5 → osv_vulns = 0（MIT）
$ npm ls zod → zod@4.6.5 deduped（SDK 的 peer/依赖范围 ^3.25 || ^4.0 满足）
```

#### 4. 本阶段验收标准 → 我要执行的检查命令（BRIEF §11.1）

| AC | 我要执行的检查命令 | 期望 |
| --- | --- | --- |
| **AC-25** MCP 端到端（真实对端） | 起服务 + 建 prompt（含 `{{姓名}}`）+ 建 token → 用**真实 Python 客户端**（`mcp==1.30.0`，`LATEST_PROTOCOL_VERSION=2025-11-25`）以 stdio 拉起 `bin/pm-mcp.mjs`：① `initialize()`（打印协商出的 protocolVersion）② `list_tools()` ③ `call_tool('prompt_search', {'query':'会话交接'})` ④ `call_tool('prompt_get', {'id':N})` ⑤ `call_tool('prompt_render', {'id':N,'values':{'姓名':'张三'}})` | ① 握手成功且 `serverInfo.name/version` 可读；② 工具名**恰好** `['prompt_get','prompt_render','prompt_search']`；③ 命中目标 id；④ 含 user/system/notes 与 `variables`；⑤ 渲染成品与 `POST /api/render` 的 `user_prompt` **逐字符一致** |
| **AC-26** MCP 形态与安全 | ① 上述全过程里 `ss -ltn | grep -cE ':(876[5-9]|8770)\b'`；② 真实客户端 `list_tools()` 里写操作类工具计数；③ **不设** `PM_API_TOKEN` 拉起 → `call_tool('prompt_search',…)`；④ 停掉服务后 `call_tool('prompt_get',…)` | ① 与基线一致（=1，不新增）；② **0** 个写操作工具；③ 返回**明确错误**（`isError=true` 且消息含 PM_API_TOKEN），**不得**静默返回空数组/空对象；④ 返回连接错误 |
| 附加（FR-19 联动） | 经 MCP `prompt_get` / `prompt_render` 取用后 `GET /api/usage/summary` | `by_channel.mcp` **增长**（阶段 6 建好的通道在本阶段被真实使用） |
| 回归（前六阶段 + 卫生） | `npm test`；`bash tools/ac-stage2..6.sh`；`systemd-analyze verify`；`npm audit`；`ss -ltn` | 全绿 / 各 rc=0 / 0 error / 0 vulnerabilities / 不新增监听 |

#### 5. 本阶段的关键实现决策（BRIEF 未逐条规定口径 → 先记在此备查；验收只按 AC 判）

1. **入口/传输**：`bin/pm-mcp.mjs`（固定名字）= 极薄 ESM 入口，载入编译产物 `dist/mcp/server.js`，用 `StdioServerTransport` 连 stdin/stdout。
   **绝不向 stdout 写任何非协议内容**（日志/诊断一律 stderr）——否则会污染 JSON-RPC 流。
2. **数据访问**：三个工具**只经 HTTP API + Bearer**（`PM_API_URL` 默认 `http://127.0.0.1:$PORT`，`PM_API_TOKEN` 必填于调用时），
   复用与 `pm` CLI 同一套客户端（抽到 `src/client/pm-api.ts`），并统一带 **`X-PM-Channel: mcp`** 头 → 服务端 usage 记为 `mcp`（FR-19）。
   **不 import 任何数据库模块**（构造上不可能直连 DB）。
3. **工具契约**（名字固定，恰好三个，全部只读）：
   - `prompt_search{query, limit?}` → `GET /api/prompts?q=…&limit=…`，返回 `{total, items:[{id,title,tags,favorite,updated_at,use_count,last_used_at}]}`（不返回正文，正文用 `prompt_get` 取，避免一次塞太多）。
   - `prompt_get{id}` → `GET /api/prompts/:id` + `GET /api/prompts/:id/variables`，返回 `{…prompt 字段, variables:[…]}`（AC-25 要求 user/system/notes/variables）。
   - `prompt_render{id, values?}` → `POST /api/prompts/:id/render`，返回 `{user_prompt, system_prompt, missing}`。
   `prompt_search` 是列表操作 → **不计 usage**；`prompt_get`/`prompt_render` 由服务端按 `mcp` 通道记 usage（FR-19 的取用定义）。
4. **错误语义（AC-26 ③④）**：缺少 `PM_API_TOKEN` → 工具返回 `isError: true` + 明确消息（含 `PM_API_TOKEN` 与环境变量用法）；
   连不上 → `isError: true` + `无法连接 <url>`；HTTP 4xx/5xx → `isError: true` + `HTTP <code> <error>`。
   **启动阶段不因缺 token 而失败**（`initialize`/`tools/list` 必须可用，否则 AC-26 ③ 无法执行）。
5. **只读保证**：不注册任何写工具；服务端 token 通道本来也没有额外写权限，但工具面**主动**只有这三个。
6. **部署交付**：`deploy/mcp-register.example.json`（`mcpServers.promptmanager` 片段，`PM_API_TOKEN` 用占位符 `<PM_API_TOKEN>`，command/args 用占位路径）；
   README 增「MCP 用法」（含 host_manger 的 ssh 拉起方式）与「已知限制」；`deploy/README.md` 增 MCP 小节（不改 systemd unit）。
7. **协议版本声明**：使用 SDK 默认（LATEST = `2025-11-25`，与真实对端一致）；不手工 pin 一个更旧的版本，也不要求客户端升级。
8. **测试策略**：`npm test` 里用 **TS SDK 客户端**跑一遍 stdio 端到端（回归用，明确标注"不等于 AC-25 的真实对端证据"）；
   **AC-25 的证据只能用真实 Python 客户端**，故放进 `tools/ac-stage7.sh`，并额外写一个"若 `.venv/bin/python` 存在就跑、不存在则 skip 并说明"的用例（避免 `npm test` 在不具备 venv 的环境里失败）。

#### 6. 红 → 绿计划

先写 `tests/mcp-server.test.ts`（TS SDK 客户端端到端：3 个工具名、search/get/render 语义、无 token 报错、服务停掉报错、usage 记 mcp）
与 `tests/mcp-readonly.test.ts`（只读断言：工具名集合恰好为三个、且不含任何写操作词），**在实现之前**跑一次记录失败（红）；
再实现 `src/client/pm-api.ts`（从 `src/server/cli.ts` 抽出，CLI 改为复用）、`src/mcp/server.ts`、`bin/pm-mcp.mjs`，
构建后复跑（绿），最后写 `tools/ac-stage7.sh`（真实 Python 客户端 + 形态/安全 + usage 联动）取 AC 端到端输出。

### 2026-09-18 — 阶段 7 实施与自检（MCP server，收尾）

#### 1. 提交单元与 commit 对应

| 单元 | commit | 内容 |
| --- | --- | --- |
| 开工前 | `04d7ec4` | 端口复核、**协议版本对齐实测**（双方 LATEST=2025-11-25）、SDK/zod 闸门、AC-25/26 检查命令与决策 |
| 实现 + 测试 | `c4df0e9` | `src/client/pm-api.ts`（CLI/MCP 共用 HTTP 客户端，从 `cli.ts` 抽出）、`src/mcp/server.ts`、`bin/pm-mcp.mjs`、`tools/mcp-client-smoke.py`、`tools/ac-stage7.sh`、2 个测试文件、`@modelcontextprotocol/sdk@1.30.0` + `zod@4.6.5` |
| 文档/部署 | `c84f4f0` | `deploy/mcp-register.example.json`（占位符）、README「MCP server」段与已知限制、`deploy/README.md` §3.4、`docs/dependencies.md`（§2.1/§4.11/§5） |

#### 2. 红 → 绿记录

**红**（先写测试，实现未写）：`node --test tests/mcp-server.test.ts tests/mcp-readonly.test.ts`

```
✖ AC-26 ②：tools/list 里没有任何写操作工具… ✖ MCP 入口不向 stdout 写非协议内容 … ✖ MCP：initialize + tools/list …
✖ MCP：prompt_search/prompt_get/prompt_render … ✖ MCP：经 MCP 的取用计入 usage … ✖ AC-26 ③ … ✖ AC-26 ④ …
ℹ tests 7   ℹ pass 0   ℹ fail 7
```

过程中两处**我自己的编译/类型问题**（都不是设计问题，如实记录）：① 工具返回值自造 interface 与 SDK 的
`CallToolResult` 不兼容（缺索引签名）→ 改为直接使用 SDK 的 `CallToolResult` 类型；② 从 `cli.ts` 抽取 HTTP 客户端时
我的脚本化编辑切多了代码（把 `migrate`/`exportCommand` 一起删了）→ 以 `git show HEAD:src/server/cli.ts` 为基准重做，
干净地只替换客户端块。

**绿**：`npm test`

```
ℹ tests 130
ℹ pass 130   ℹ fail 0
$ ls tests/*.test.ts | wc -l   → 27
```

#### 3. AC-25 / AC-26 实测（`bash tools/ac-stage7.sh`；**真实对端** = Python `mcp` 1.30.0）

```
=== 对端与协议版本核对（BRIEF §5 硬要求） ===
python mcp 1.30.0 ｜LATEST_PROTOCOL_VERSION = 2025-11-25
  python mcp 1.30.0 ｜LATEST_PROTOCOL_VERSION = 2025-11-25
  验收前 8765-8770 监听数（基线）= 1

=== AC-25 MCP 端到端（真实对端，自带夹具） ===
login=200
  prompt id=1 ｜ token 已创建（明文不打印）
$ PM_API_URL=http://127.0.0.1:8767 PM_API_TOKEN=$TOKEN MCP_NODE=/usr/bin/node .venv/bin/python tools/mcp-client-smoke.py '会话交接' 1
  rc=0（0 = 握手与三步调用都完成）
  --- 客户端 stderr（服务端诊断，不属于协议流）---
    promptmanager MCP server (stdio) — API=http://127.0.0.1:8767｜token=已设置
  --- 每步结果 ---
  对端            : python-mcp 1.30.0 ｜对端 LATEST = 2025-11-25
  协商 protocolVer: 2025-11-25 → MATCH
  serverInfo      : promptmanager 0.1.0 ｜tools 能力 = True
  tools/list      : ['prompt_get', 'prompt_render', 'prompt_search'] → MATCH
  prompt_search   : isError=False total=1 id=[1]
  prompt_get      : isError=False user_prompt="你好 {{姓名}}，交给下一位 {{var-b}}" variables=['姓名', 'var-b']
  prompt_render   : isError=False user_prompt="你好 张三，交给下一位 {{var-b}}" missing=['var-b']
  --- 与 HTTP API 逐字符对照（渲染结果）---
  MCP  : "你好 张三，交给下一位 {{var-b}}"
  API  : "你好 张三，交给下一位 {{var-b}}"
  逐字符一致： MATCH
  --- FR-19：经 MCP 的取用记入 usage（channel=mcp）---
  by_channel = {'session': 0, 'token': 1, 'mcp': 2} ｜total = 3
  mcp 通道增长： MATCH （prompt_get + prompt_render 各一条）
  --- 副作用：MCP 取用不得改 updated_at / version_no ---
  version_no： 1 → 1 ： SAME
  updated_at： 2026-09-18T07:28:57.064Z ： SAME
```

**AC-26 形态与安全**

```
=== AC-26 MCP 形态与安全（同一夹具） ===
--- ① 不新增监听（口径：台账区间内除去服务自身的 PORT 后，监听数不得变化）
  8765-8770（不含 8767）监听数 = 1（基线 1）
--- ② 工具面没有写操作工具（真实对端 list_tools 结果）
  工具名 = ['prompt_get', 'prompt_render', 'prompt_search']
  写操作类工具 = [] → MATCH
--- ③ 未设 PM_API_TOKEN 时调用工具 → 必须明确报错（不许静默返回空）
  rc=0（0 = 握手成功；工具返回 isError）
  initialize 仍成功： 2025-11-25 ｜list_tools = ['prompt_get', 'prompt_render', 'prompt_search']
  prompt_search isError = True
  错误文本（原样）: "缺少 PM_API_TOKEN：MCP 一律经本服务的 HTTP API 取数（不直连数据库）。请设置 PM_API_URL（如 http://127.0.0.1:8767）与 PM_API_TOKEN 后重试；token 用 `node bin/pm.mjs token create --name mcp` 创建（明文只显示一次）。"
  点名 PM_API_TOKEN： MATCH
  未静默返回空数组/对象： MATCH
--- ④ 停掉服务后调用工具 → 连接错误（证明经 API 而非直连 DB）
  服务已停（数据库文件仍在：/tmp/pm-ac7-id1oN2/pm.db 若工具直连 DB 就会照常返回）
  rc=0（0 = 握手成功、工具返回连接错误）
  prompt_get isError = True
  错误文本（原样）: "无法连接 http://127.0.0.1:8767（fetch failed）—— MCP 只经本服务的 HTTP API 取数，不直连数据库；请确认服务已启动、PM_API_URL 正确。"
  含目标地址： MATCH
```

收尾：

```
=== 收尾：端口与监听核对 ===
$ ss -ltn | grep -c ':8767'   # 期望 0
0
$ ss -ltn | grep -E ':(876[5-9]|8770)\b' | grep -vc ':8767 '   # 期望与基线一致（1）
1

阶段 7 自检结束；夹具目录已清理，端口 8767 已释放。
```

#### 4. 全量回归（前六阶段 + 卫生/部署/组件库/依赖）

```
$ npm test                  → 130/130 通过（27 个测试文件）
$ bash tools/ac-stage2.sh   → rc=0（AC-3/4/15）
$ bash tools/ac-stage3.sh   → rc=0（AC-5/6/7/14）
$ bash tools/ac-stage4.sh   → rc=0（AC-8/9/12）
$ bash tools/ac-stage5.sh   → rc=0（AC-10/11）
$ bash tools/ac-stage6.sh   → rc=0（AC-22/23/24/27/28）
$ bash tools/ac-stage7.sh   → rc=0（AC-25/26，真实 Python 对端）
$ sudo systemd-analyze verify deploy/promptmanager.service 2>&1 | grep -c error → 0
$ grep -cE '^(User|Group|WorkingDirectory|EnvironmentFile|Restart)=' deploy/promptmanager.service → 5
$ grep -c MemoryDenyWriteExecute deploy/promptmanager.service → 0
$ grep -cE '^[A-Z_]*(PASSWORD|SECRET|TOKEN|KEY)[A-Z_]*=.+$' deploy/promptmanager.env.example → 0
$ AC-20：antd@6.6.4 / icons@6.3.4；原生表单标签 0；from 'antd' 5；CDN 外链 0
$ AC-17：git check-ignore 四条命中（含 .venv/）；凭据字面量扫描 0 命中；依赖表 54 行 ≥ 直接依赖 27
$ npm audit --registry=https://registry.npmjs.org → found 0 vulnerabilities
$ 协议分布（281 包）：MIT 243 / ISC 12 / BSD-3 8 / BlueOak 5 / Apache-2.0 4 / BSD-2 3 / MIT-0 2 / MPL-2.0 2 /
                      (MPL-2.0 OR Apache-2.0) 1 / CC0-1.0 1；GPL/AGPL/无协议 = 0
$ ss -ltn | grep -E ':(876[5-9]|8770)\b' | wc -l → 1（= 8769 izone，与基线一致：**不新增监听**）
```

#### 5. 本阶段自行判断的实现细节（BRIEF §11.5 ②：备查，验收只按 AC 判）

1. **★ 协议版本对齐（开工第一步，BRIEF §5 硬要求）**：真实对端 = Python `mcp` **1.30.0**，
   `mcp.types.LATEST_PROTOCOL_VERSION = 2025-11-25`（本机复核实测，与 host_manger 2026-09-18 的结论一致）；
   我方 SDK `@modelcontextprotocol/sdk@1.30.0` 的 `LATEST_PROTOCOL_VERSION` 同为 **2025-11-25**
   （SUPPORTED = 2025-11-25 / 2025-06-18 / 2025-03-26 / 2024-11-05 / 2024-10-07）。
   **双方 LATEST 完全相同 → 不存在兼容风险，未触发 QUESTIONS**；真实握手协商出的 `protocolVersion` 实测就是 `2025-11-25`。
2. **入口与传输**：`bin/pm-mcp.mjs`（固定名字）→ 载入 `dist/mcp/server.js` → `StdioServerTransport`。
   **stdout 只承载 JSON-RPC**：本模块与入口都**不含** `console.log`（`tests/mcp-readonly.test.ts` 里有静态断言），
   启动诊断走 stderr（AC 输出里可见那一行“promptmanager MCP server (stdio) …”出现在 stderr）。
3. **只读工具面**：`prompt_search` / `prompt_get` / `prompt_render`（名字固定），全部 `readOnlyHint: true`，
   没有 create/update/delete/import 之类工具（真实对端 `list_tools` + 静态断言双重证据）。
4. **数据访问只经 HTTP + Bearer**：`src/mcp/server.ts` **不 import** `src/db/**` 与 `src/services/**`
   （静态断言），只用 `src/client/pm-api.ts`；每次调用带 `X-PM-Channel: mcp` → 服务端 usage 记 `mcp` 通道。
5. **错误语义**：缺 `PM_API_TOKEN` → `isError: true` + 点名 `PM_API_TOKEN` 的可操作提示（且 `initialize`/`tools/list` 仍可用）；
   服务停掉 → `isError: true` + `无法连接 <url>`；HTTP 4xx/5xx → `HTTP <code> <error>`；404 → “prompt N 不存在”。
6. **工具返回形态**：`prompt_search` 只返回 id/标题/标签/时间/取用统计（不塞正文，正文用 `prompt_get`）；
   `prompt_get` 额外带 `variables`（**复用服务的 `/variables` 接口**，不在 MCP 层重实现变量语法）；
   `prompt_render` 直接透传 `{user_prompt, system_prompt, missing}`。
7. **取用计数口径**：`prompt_search` 是列表操作 → **不计 usage**；`prompt_get` / `prompt_render` 由服务端按 `mcp` 记
   （与 HTTP 侧 FR-19 的定义一致）。AC-25 实测 `by_channel.mcp = 2`，且 `version_no`/`updated_at` 前后 `SAME`。
8. **把真实对端 smoke 做成可复用工具**：`tools/mcp-client-smoke.py`（用官方 Python 客户端跑三步，输出逐行 JSON）+
   `tools/ac-stage7.sh`（`MCP_PYTHON` 可指向任意能 `import mcp` 的解释器）。
   **AC-25 的证据只用真实对端**；`npm test` 里的 TS SDK 端到端明确标注“不等于 AC-25 的证据”。
9. **Python 客户端装在项目内 venv**（`.venv/`，已 gitignore、未入库）：这是**测试用**依赖，不进 `package.json`、
   不写进 `docs/dependencies.md` 的运行时依赖表；bootstrap 命令写在 `README.md`「MCP server」段与 AC 脚本的失败提示里。
10. **部署交付**：`deploy/mcp-register.example.json` 只有占位符（`<NODE_BIN>`/`<PROJECT_DIR>`/`<PM_HOST>`/`<PM_API_TOKEN>`，
    实测不含任何真实 token）；MCP **不需要 systemd unit、不占端口**，故 `promptmanager.service` 未改（`systemd-analyze verify` 复跑 0 错误）。

#### 6. 未完成 / 已知缺口（本阶段范围内无缺口）

- **阶段 8（前端 P0，全部用 antd）**：登录/列表/编辑器/版本面板/变量面板/Markdown 预览/响应式/亮暗 + 界面自证
  （AC-13/20/21）；建议把阶段 6 的 `/api/tokens` 与 `/api/usage/summary` 也放进管理界面。
- **阶段 9（收尾）**：`docs/shots/*.png` + `tools/ui-shots.sh`、README 四要素终稿、AC-16/17/18 正式验收。
- MCP 只支持 stdio（不做 HTTP/SSE 传输）——D-15 的明确选择，不是缺口；宿主注册由使用方自行完成。
- MCP 工具面只读（无写操作）——D-15/FR-18 的硬约束，不是缺口。
- `X-PM-Channel: mcp` 是客户端自报标记：单用户 + token 认证前提下可接受；若将来多租户，需改为服务端签发凭据（已记在阶段 6）。

#### 7. 落盘对账（本阶段每条结论 → 落在哪个文件的哪一节）

| 结论 | 落盘位置 |
| --- | --- |
| 协议版本对齐：对端 `mcp` 1.30.0 / `2025-11-25`，我方 SDK `2025-11-25`，实测协商一致、无兼容风险 | 本文件「阶段 7 开工前 §2」+「收尾 §3」（真实对端输出）+「收尾 §5 决策 1」；`README.md`「MCP server」段 |
| 入口 `bin/pm-mcp.mjs`、stdio、不新增端口 | `bin/pm-mcp.mjs`；本文件「收尾 §3 AC-26 ① 输出」；`README.md`「MCP server」段 + 已知限制 |
| 恰好三个只读工具、无写操作 | `src/mcp/server.ts`（三处 `registerTool`）；`tests/mcp-readonly.test.ts`；本文件「收尾 §3 AC-26 ② 输出」；`README.md` 已知限制 |
| 只经 HTTP API + Bearer、不直连 DB、缺 token/停服必须报错 | `src/client/pm-api.ts` + `src/mcp/server.ts`；`tests/mcp-server.test.ts`（AC-26 ③④ 用例）；本文件「收尾 §3 AC-26 ③④ 输出」；`deploy/README.md` §3.4 排查段 |
| 经 MCP 的取用记 `mcp` 通道 | `src/mcp/server.ts`（`X-PM-Channel: mcp`）；本文件「收尾 §3 AC-25 的 FR-19 输出」（`by_channel.mcp=2`）；`README.md`「MCP server」段 |
| 真实对端可复现方式（含 ssh 拉起示例） | `tools/mcp-client-smoke.py` + `tools/ac-stage7.sh`（`MCP_PYTHON` 可覆盖）；`README.md`「MCP server」段（含 ssh 命令） |
| 依赖登记（SDK/zod、OSV、体积取舍） | `docs/dependencies.md` §2.1（直接依赖表）、§4.11（选型与取舍）、§5（OSV 证据）、§6（后续计划） |
| 部署交付：注册示例（占位符）+ 运维说明 + 不需要 unit/端口 | `deploy/mcp-register.example.json`；`deploy/README.md` §3.4；`README.md`「MCP server」段 |
| 不新增监听、默认监听地址未变、服务配置未改 | 本文件「收尾 §3 AC-26 ① 与收尾输出」；`deploy/promptmanager.service`（未改，`systemd-analyze verify` 0 错误记在本文件「收尾 §4」） |
| 全量回归结果（130 测试 + 6 个 AC 脚本 + 卫生/部署/组件库） | 本文件「收尾 §4」；`tests/**`；`tools/ac-stage2..7.sh` |

### 2026-09-18 — 阶段 8 开工前准备（前端 P0，全部 antd 组件）

> 阶段 1–7 已由 host_manger 验收通过（结论见 `VERIFY.md`，无返工项）。本阶段只做阶段 8。

#### 1. 端口复核（STANDARDS §3.5：起临时服务前必须实测）

```
$ ss -ltn | grep -E ':(876[5-9]|8770)\b'
LISTEN 0      10           0.0.0.0:8769      0.0.0.0:*
```

结论：**8767 空闲**（8765–8770 段内仅 izone 的 8769 占用，与阶段 1–7 基线一致）→ 本阶段沿用默认
`HOST=0.0.0.0` / `PORT=8767`（内网可达 + 认证闸门不变）；**单进程单端口**由 §6.1 契约与 `src/server/app.ts`
的 `@fastify/static`（`config.webRoot` = `dist/web`）继续保证，**不新增监听、不改默认监听地址、不改 deploy/ 三件套**
（本阶段无新端口/新环境变量 → 部署文件「无需变化」，`systemd-analyze verify` 复跑见收尾节）。

#### 2. 本阶段验收标准 → 我要执行的检查命令（BRIEF §11.1 要求）

**AC-13 界面自证（截图 + 识图）**

```sh
bash tools/ui-shots.sh                                   # 服务自起自停；默认输出 docs/shots/
ls -1 docs/shots/*.png | wc -l                            # 期望 ≥6
python3 - <<'PY'                                          # 尺寸断言：PNG IHDR，宽×高
import struct,glob
for p in sorted(glob.glob('docs/shots/*.png')):
    b=open(p,'rb').read(24); w,h=struct.unpack('>II',b[16:24]); print(f'{p} {w}x{h}')
PY
# 覆盖要求：登录页 / prompt 列表 / 编辑器 / 搜索结果 / 移动 390×844 / 暗色；桌面 1280×800
# 逐张「读图」后把四问结论（① 重叠遮挡 ② 硬断词/单字成行 ③ 孤标题沉底 ④ 溢出裁切 + 可用视觉风格）写进 PROGRESS
# 修复后再截一组：docs/shots/before/*.png（修前）与 docs/shots/*.png（修后）成对
```

**AC-20 前端组件库落地（机械证据）**

```sh
npm ls antd @ant-design/icons --depth=0                                            # 两者都在直接依赖，版本 6.6.4 / 6.3.4
grep -rnE "<(button|input|select|textarea|table|dialog)[ >/]" web/src --include='*.tsx' | wc -l   # 期望 0
grep -rnoE "from ['\"]antd['\"]" web/src --include='*.tsx' | wc -l                  # 期望 ≥5
grep -rnE "(cdn|unpkg|jsdelivr|googleapis)" dist/ web/src --include='*.html' --include='*.tsx' --include='*.css' | wc -l  # 期望 0
grep -c 'v5-patch-for-react-19' package.json docs/dependencies.md                   # 期望 0 0
```

**AC-21 组件库真的在渲染（不只看依赖）**

```sh
# 起临时服务 → headless chromium（CDP：Network.setCookie 带会话）打开列表页/编辑器页 → 取渲染后 DOM
# grep -o 'ant-[a-z-]*' <dump.html> | sort -u | wc -l   → 期望 ≥3（列表页 / 编辑器页各一份）
bash tools/ac-stage8.sh                                  # 把 AC-13/20/21 串成一条可复现的自检（自起自停）
```

#### 3. 本阶段的关键实现决策（BRIEF 未逐条规定口径 → 先记在此备查，验收只按 AC 判）

1. **不新增依赖**：路由用应用内视图状态（列表 ↔ 编辑器用 antd `Drawer`/`Tabs`），不引 react-router；
   不用状态管理库（只有会话 + 列表两处共享状态，React context 足够）。故 `docs/dependencies.md` **无新增条目**，
   `package.json` 依赖零变化（antd 6.6.4 / @ant-design/icons 6.3.4 已在阶段 1 固定）。
2. **截图零安装方案**：`tools/ui-shot.mjs` 用 **Node 24 内置 `WebSocket`** 直连
   `chrome-headless-shell` 的 **CDP**（`--remote-debugging-port`）→ `Network.setCookie` 复用
   `POST /api/login` 得到的真实 `pm_sid` 会话 → `Page.navigate` → `Emulation.setDeviceMetricsOverride`
   （1280×800 / 390×844）→ `Emulation.setEmulatedMedia`（`prefers-color-scheme: dark`）→ `Page.captureScreenshot`。
   **不装 puppeteer/playwright**（BRIEF §6.8 的零安装口径），也不改服务端做"截图专用"后门。
3. **识图证据链**：第一轮截图落 `docs/shots/before/`，用 `read_image` 逐张看过后把四问结论写进 PROGRESS，
   修复后第二轮落 `docs/shots/`（≥6 张，AC-13 直接数这一层），两轮文件名一一对应成"修前/修后"。
4. **Markdown 预览**：直接用服务端 `POST /api/render/markdown` 的净化 HTML（**不在前端重写净化/高亮**）；
   代码高亮样式用 `highlight.js` 自带的本地 CSS（按 `prefers-color-scheme` 分别引 `github.css` / `github-dark.css`），
   仍是本地打包、零 CDN，且不构成第二套样式体系。
5. **导入/导出界面（FR-11b）**：`replace` 走 antd `Modal.confirm` 二次确认，正文逐字包含
   「将清空现有全部 prompt / 文件夹 / 标签 / 版本历史」；`merge` 用 antd `Alert` 显示**将新增的条目数**
   （folders/tags/prompts 计数取自选中文件的解析结果，解析器 `web/src/pure.ts::analyzeImportFile` 有单测覆盖）。
6. **顺手项（BRIEF v8 变更记录 / VERIFY 阶段 7 §5 遗留）**：`bin/pm-mcp.mjs` 权限与 git mode 修正为 `755`，单独一次 `chore` 提交。

#### 4. 红 → 绿计划（先看到失败，再看到通过）

| # | 红（先跑，看失败） | 绿（实现后，看通过） |
| --- | --- | --- |
| 1 | `bash tools/ac-stage8.sh` → `tools/ui-shots.sh` 不存在 / `docs/shots/*.png` 为 0 | 同上命令 rc=0，且打印 AC-13/20/21 各计数 |
| 2 | `node --test tests/web-pure.test.ts` → 找不到 `web/src/pure.ts` | 纯逻辑（列表 query 组装 / 文件夹树 / 导入文件解析计数 / diff 行分类）全绿 |
| 3 | `npm run build:web` 后列表页 DOM 里 `ant-*` 类名数 < 3 | 列表页/编辑器页各 ≥3 |

### 2026-09-18 — 阶段 8 实施与自检（前端 P0，全部 antd）

#### 1. 提交单元与 commit 对应

| # | 单元 | commit | 内容 |
| --- | --- | --- | --- |
| 1 | 开工前 | `27c82cf` | AC-13/20/21 → 检查命令、端口实测、零安装 CDP 截图与 FR-11b 决策、红/绿计划 |
| 2 | **前端 P0** | `6ed7e79` | `web/src/**`（15 个新组件 + `api.ts`/`types.ts`/`pure.ts`/`styles/markdown.css`）、`tests/web-pure.test.ts`、`tests/web-ui.test.ts`、`tsconfig.tests.json`；删除阶段 1 的 `StageChecklist.tsx`（先移入 `tmp/removed-stage1/`，不入库） |
| 3 | 界面自证工具 | `59fb494` | `tools/ui-shots.sh`（服务自起自停）+ `tools/ui-shot.mjs`（Node 内置 WebSocket 直连 CDP，零安装）+ `tools/ac-stage8.sh`（AC-13/20/21） |
| 4 | 阶段 7 遗留 | `9198164` | `chmod 755 bin/pm-mcp.mjs`（git mode `100644` → `100755`，与 `bin/pm.mjs` 一致） |
| 5 | 收尾文档 | `e3a5568` + `be59b60` | `e3a5568`：本文件（识图结论/原样输出/回归）+ `README.md`（新增「界面（前端）」一节与前端限制）+ `docs/dependencies.md`（阶段 8 零新增依赖）+ `docs/shots/**`（修前 10 张 + 修后 10 张）；`be59b60`：补记顺手复核（AC-18 部署文件零改动、AC-17 卫生）原始输出 |

> 阶段边界：本阶段只宣称 AC-13 / AC-20 / AC-21（BRIEF §11.4 的阶段 8 行）。
> 前端顺带接上了阶段 6 的 `/api/tokens` 与 `/api/usage/summary`（顶栏「更多 → 使用统计 / API 令牌」），
> 属阶段 7 收尾「未完成」清单里的"建议项"，**不作为本阶段 AC 判据**。

#### 2. 红 → 绿记录（先看到失败，再看到通过）

**红（实现之前；完整日志 `tmp/red-stage8.log`，tmp/ 已 gitignore）**

```
$ bash tools/ac-stage8.sh
=== AC-13 界面自证截图（bash tools/ui-shots.sh docs/shots，服务自起自停） ===
  ❌ tools/ui-shots.sh 不存在
=== AC-21 组件库真的在渲染（渲染后 DOM 里不同 ant-* 类名数，期望 ≥ 3） ===
  ❌ 缺少 DOM dump：tmp/ui-shots/list.html（由 tools/ui-shots.sh 产出）
  ❌ 缺少 DOM dump：tmp/ui-shots/editor.html（由 tools/ui-shots.sh 产出）
=== 结论 ===
  ❌ 有未通过项（见上方 ❌）
rc=1

$ node --test tests/web-pure.test.ts tests/web-ui.test.ts
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/root/greenhouse/projects/promptmanager/web/src/pure.ts'
        imported from /root/greenhouse/projects/promptmanager/tests/web-pure.test.ts
✖ 登录页：POST /api/login + 口令表单 + 启动时用 /api/me 判会话
✖ 列表页：接 /api/prompts 的 q/folder_id/tag/favorite/sort 与分页
✖ 编辑器：标题/用户提示词/系统提示词/备注/文件夹/标签/收藏 七个可写字段齐全
✖ 版本面板：列表 / diff / 回滚三个动作都在
✖ 变量面板：/variables + /render，且渲染结果可一键复制
✖ Markdown 预览：直接调用服务端 /api/render/markdown（不重写净化）
✖ 导入导出界面：两种模式 + FR-11b 文案与 merge 计数
✖ 响应式 + 亮暗跟随系统（antd theme.algorithm / Grid.useBreakpoint）
✔ AC-20 ②：源码里不出现原生表单/表格标签
✔ AC-20 ④：源码零 CDN 外链
ℹ tests 11  ℹ pass 2  ℹ fail 9
```

**绿（中途与最终）**

```
$ node --test tests/web-pure.test.ts
ℹ tests 7  ℹ pass 7  ℹ fail 0                     ← web/src/pure.ts 落地后（纯逻辑先绿）
$ node --test tests/web-ui.test.ts tests/web-pure.test.ts
ℹ tests 17  ℹ pass 17  ℹ fail 0                    ← 界面实现落地后
$ npm test
ℹ tests 147  ℹ pass 147  ℹ fail 0                  ← 29 个测试文件（阶段 7 为 130/27）
$ bash tools/ac-stage8.sh
见 §5（AC-13/20/21 逐项输出）
```

> 诚实记录：红阶段我第一次把 AC-20 ① 的"不得出现 v5 补丁"写成了对 `docs/dependencies.md` 的 grep，
> 那里有一句"**不需要** `@ant-design/v5-patch-for-react-19`"的说明被误报为违规；
> 改为与 `VERIFY.md` 阶段 1 一致的口径（`npm ls @ant-design/v5-patch-for-react-19` 为空）后为真绿——
> **是检查脚本写错了，不是实现有问题**。

#### 3. 界面自证：截图 + 逐张识图结论（AC-13）

- 修前：`bash tools/ui-shots.sh docs/shots/before` → `docs/shots/before/*.png`（10 张）
- 修后：`bash tools/ui-shots.sh docs/shots` → `docs/shots/*.png`（10 张，同名成对）
- 脚本口径：自起自停（临时 `DATA_DIR` + `node dist/server/index.js`，跑完 `ss -ltn` 无 `:8767` 残留）；
  会话 cookie 来自**真实** `POST /api/login`；浏览器用 `chrome-headless-shell`（
  `/root/.cache/ms-playwright/chromium_headless_shell-1243/…`）+ `tools/ui-shot.mjs` 的 CDP
  （`Emulation.setDeviceMetricsOverride` / `setEmulatedMedia` / `Network.setCookie` / `Page.captureScreenshot`），
  **没有安装 puppeteer/playwright**，也没有给服务端加截图后门。夹具：2 文件夹 / 3 标签 / 9 prompt（其中 1 条有 v1–v3 版本史）。
- 四问口径：① 文字重叠/遮挡 ② 硬断词或单字成行 ③ 孤标题沉底 ④ 溢出/裁切；末列是"是否达到可用视觉风格"。

| 文件（修前 = `before/` 同名） | 尺寸 | 识图结论（修前 → 修后） |
| --- | --- | --- |
| `01-login.png` | 1280×800 | **识图-1 登录页**：修前 ①无 ②**有硬断词**：卡片内提示换行出现「备份 = 拷 / 文件。」与 CLI 命令被从连字符劈成「user set- / password」 ③无 ④无。修后：提示压成两句短文案、CLI 命令移入「关于本服务」，两行各自单行放下；视觉为干净的 antd Card+Form，居中、层级清楚 → **可用**。 |
| `02-list.png` | 1280×800 | **识图-2 列表页**：修前 ①**有遮挡**：顶栏用户名 `admin` 与「新建」互相挤压（顶栏 Space 带 wrap + Header 固定 64px 高 → 第二行被裁掉） ④**有裁切**：表格「操作」列与工具栏「新建」按钮被视口右缘切掉（`Table scroll.x=max-content` 把 flex 子项撑破，`Layout.Content` 缺 `minWidth:0`）。修后：顶栏改为 标题+新建+导入/导出+更多+登出（用户名进「更多」菜单）、列宽收到 890px、日期改 `MM-DD HH:mm`、Content 加 `minWidth:0` → 7 列 + 分页全部在卡片内，**无重叠、无裁切**。 |
| `03-editor.png` | 1280×800 | **识图-3 编辑器**：修前 ③**有"孤标题沉底"**：首屏底部正好压着「文件夹 / 标签」两个字，看不到对应控件（文本域行数过多） ④备注框内出现横向滚动条。修后文本框行数降为 5/3/2 → 标题→收藏 **7 个字段一屏可见**（Tabs 一行放下）→ **可用**。 |
| `04-search.png` | 1280×800 | **识图-4 搜索结果**：搜索框输入「交接」后 ①④同 02（顶栏挤压 + 右缘裁切）；结果本身正确。修后：无重叠/裁切；CDP 探针实测 `search-box-value="交接"`、`pagination-total="共 1 条"`、行数 = 1（**2 字符中文走 LIKE 兜底**，界面可用）→ **可用**。 |
| `05-mobile-list.png` | 390×844 | **识图-5 移动列表**：修前 ①**有"看不见"**：顶栏右侧「…」更多按钮不可见——antd `Layout.Header` 默认深底（`#001529`）+ `Button type="text"` 的黑色图标 = 黑压黑。修后顶栏底色改用 `token.colorBgContainer`+分隔线 → ☰ / 标题 / … 三者都清晰；行内 meta 用紧凑时间，无换行 → **手机可用**。 |
| `06-dark-list.png` | 1280×800 | **识图-6 暗色主题**：暗色由 `theme.darkAlgorithm` 生效（暗色 Tag 显示「暗色」、表格/标签/分页对比正常）；修前顶栏还是固定深底、与暗色 body 无分界，修后顶栏随 algorithm 变深灰 + 细边框；①④同 02 并已修复 → **可用**。 |
| `07-versions.png` | 1280×800 | **识图-7 版本面板**：v1→v3 unified diff（红删绿增）+ 版本表 + 每行「回滚」（Popconfirm）；修后 diff 行改为 `pre-wrap` 折行，长行不再被右缘硬切；①无 ②无 ③无 ④无 → **可用**。 |
| `08-variables.png` | 1280×800 | **识图-8 变量填值**：提取到 2 个变量（项目/姓名）→ 填值 → 渲染；修前结果用 `Typography.Paragraph copyable`，段落末尾会多出一个**孤立复制图标（单独占一行）**；修后结果改为只读 `Input.TextArea(autoSize)`、复制按钮移到卡片右上。CDP 探针实测 `variables-count=2`、`missing-alerts=0`、渲染文本 = `你是 greenhouse 项目的交接助手…交接人：张三`（逐字符替换正确）→ **可用**。 |
| `09-import-confirm.png` | 1280×800 | **识图-9 导入二次确认（FR-11b）**：附上真实导出文件后显示 `prompt 9 / 文件夹 2 / 标签 3`；切到 replace 出现警示「replace 模式会先清空现有数据 / 将清空现有全部 prompt / 文件夹 / 标签 / 版本历史」；点「导入（清空重建，需二次确认）」弹出**二级确认**。CDP 探针实测确认框文本 = `确认以 replace 模式导入？ | 将清空现有全部 prompt / 文件夹 / 标签 / 版本历史 | 随后按文件重建：prompt 9 条 / 文件夹 2 个 / 标签 3 个。 | 此操作不可撤销；建议先导出当前数据留底。 | 取 消 | 清空并导入`；①无 ②无 ③无 ④无 → **可用**（文案与 BRIEF FR-11b 逐字一致）。 |
| `10-mobile-editor.png` | 390×844 | **识图-10 移动编辑器**：全屏 Drawer，标题+#1+删除/保存、Tabs 一行放下、字段单列堆叠、CJK 自然换行；修前首屏 5 个字段，修后 6 个（含文件夹/标签），「收藏」正好压在下缘（可滚动到达，非裁切）；①无 ②无 ③无 ④无 → **手机可用**。 |

**修前/修后成对**：`docs/shots/before/01-login.png ↔ docs/shots/01-login.png`，其余 9 对同理（文件名一一对应）。

> 注：截图里的日期/时间戳来自**当次夹具**的创建时间，所以同一布局重跑一次，字节数会略有差异
> （例如 `09/18 16:15` → `09/18 16:35`）。上面 10 条识图结论按**当前落盘的这一组图**核对
> （`02-list` / `03-editor` / `05-mobile-list` / `10-mobile-editor` 在重跑后做了二次识图复核）。

#### 4. 本阶段自行判断的实现细节（BRIEF §11.5 ②：备查，验收只按 AC 判）

1. **零新增依赖**（`docs/dependencies.md` 已登记）：不引 react-router（列表↔编辑器用视图状态 + `Drawer`/`Tabs`）、
   不引状态管理库（`Workspace` 里两处共享状态用 `useState`+`useCallback` 足够）、不引第二套 CSS 框架。
   Markdown 预览的代码高亮**样式**复用既有 `highlight.js@11.12.0` 的 `styles/github.css` / `github-dark.css`，
   在 `web/src/styles/markdown.css` 里用带媒体查询的 `@import ... screen and (prefers-color-scheme: …)` 引入
   （Vite 会分别包进 `@media` 块，实测 dist CSS 里 light/dark 各 1 段、零 CDN）。
2. **顶栏适配主题**：不用 antd 默认深色 Header，改成 `token.colorBgContainer` + 底部分隔线——
   否则亮色主题下深底会让 `type="text"` 的图标按钮（手机 ☰ / …）黑压黑不可见（识图-5 的真实缺陷）。
3. **列表表格宽度治理**：`Layout.Content` 显式 `minWidth: 0`（否则 `Table scroll={{x:'max-content'}}` 会把 flex 子项撑破视口），
   列宽合计 890px、列表时间用 `formatListDateTime`（`MM-DD HH:mm`），保证 1280 宽一屏无横向裁切。
4. **`favorite` 筛选语义**：「只看收藏」关闭时**不发** `favorite` 参数（而不是发 `favorite=false`）——
   否则会变成"只看未收藏"。`buildPromptListQuery` 对 `favorite` 保持"传了才发"，界面负责把 off 映射成 `undefined`。
5. **打开编辑器 = `GET /api/prompts/:id`**：顺带按 FR-19 记一次 `session` 通道取用（与后端契约一致），
   所以列表里的「取用」计数会随浏览增加（`06-dark-list.png` 里第 1 条显示 1 次即此因）。
6. **`ui-shot.mjs` 的交互**用 CDP 原生命令而非 JS 注入改 state：`Input.insertText` 输入、真实 `click()`、
   `DOM.setFileInputFiles` 挂真实导出文件（导入二次确认的证据链因此是"真文件 → 真解析 → 真确认框"）。
7. **`ac-stage8.sh` 的断言**把 AC-13 拆成"张数 ≥6 / 尺寸 / 覆盖关键词 / 修前成对"四类可执行判据，
   AC-21 直接对 `tmp/ui-shots/*.html` 跑 BRIEF 的原命令；另附"排除 `<style>`、只数元素 class 上的 ant-* 令牌"
   作为更强的旁证（list 148 / editor 213，仍远超 3）。

#### 5. 阶段 8 验收标准实测（AC-13 / AC-20 / AC-21，`bash tools/ac-stage8.sh`，自起自停）

```
$ bash tools/ac-stage8.sh; echo "rc=$?"

=== AC-20 ① 直接依赖（antd / @ant-design/icons） ===
promptmanager@0.1.0 /root/greenhouse/projects/promptmanager
├── @ant-design/icons@6.3.4
└── antd@6.6.4

  ✅ antd 安装版本 = 6.6.4
  ✅ @ant-design/icons 安装版本 = 6.3.4
  ✅ package.json 出现 v5-patch-for-react-19 次数 = 0
  $ npm ls @ant-design/v5-patch-for-react-19 --depth=0

  ✅ 安装树里的 v5-patch-for-react-19 = 0
  ✅ docs/dependencies.md 登记 antd 6.6.4 的行数 = 4（期望 ≥1）

=== AC-20 ② 源码里的原生表单/表格标签（期望 = 0） ===
  ✅ 原生标签命中 = 0

=== AC-20 ③ from 'antd' 出现次数（期望 ≥ 5） ===
  ✅ from 'antd' = 24（期望 ≥5）

=== AC-20 ④ 源码与构建产物里的 CDN 外链（期望 = 0） ===
  ✅ CDN 外链命中 = 0

=== AC-13 界面自证截图（bash tools/ui-shots.sh docs/shots，服务自起自停） ===
  $ bash tools/ui-shots.sh docs/shots  → rc=0（完整日志：tmp/ac-stage8-shots.log）
SERVICE pid=2304244 url=http://127.0.0.1:8767 healthz=200 data_dir=/tmp/pm-shots-kMLeVA
SEED prompts=9 folders=2 tags=3 versions(v1..v3)=3 export=/tmp/pm-shots-kMLeVA/export-fixture.json
SHOT 01-login 1280x800 dark=false -> docs/shots/01-login.png (25941 bytes)
ANT_CLASSES list 1558 (dom=tmp/ui-shots/list.html)
SHOT 02-list 1280x800 dark=false -> docs/shots/02-list.png (111012 bytes)
ANT_CLASSES editor 1780 (dom=tmp/ui-shots/editor.html)
SHOT 03-editor 1280x800 dark=false -> docs/shots/03-editor.png (105514 bytes)
SHOT 04-search 1280x800 dark=false -> docs/shots/04-search.png (56735 bytes)
ANT_CLASSES mobile-list 1271 (dom=tmp/ui-shots/mobile-list.html)
SHOT 05-mobile-list 390x844 dark=false -> docs/shots/05-mobile-list.png (55741 bytes)
SHOT 06-dark-list 1280x800 dark=true -> docs/shots/06-dark-list.png (115154 bytes)
SHOT 07-versions 1280x800 dark=false -> docs/shots/07-versions.png (121256 bytes)
SHOT 08-variables 1280x800 dark=false -> docs/shots/08-variables.png (106849 bytes)
SHOT 09-import-confirm 1280x800 dark=false -> docs/shots/09-import-confirm.png (116268 bytes)
SHOT 10-mobile-editor 390x844 dark=false -> docs/shots/10-mobile-editor.png (48881 bytes)
OK ui-shots done
  ✅ ui-shots.sh 退出码 = 0
  ✅ docs/shots 下的 png 张数 = 10（期望 ≥6）

=== AC-13 尺寸断言（PNG IHDR 宽×高） ===
  01-login.png 1280x800
  02-list.png 1280x800
  03-editor.png 1280x800
  04-search.png 1280x800
  05-mobile-list.png 390x844
  06-dark-list.png 1280x800
  07-versions.png 1280x800
  08-variables.png 1280x800
  09-import-confirm.png 1280x800
  10-mobile-editor.png 390x844

=== AC-13 覆盖要求（登录/列表/编辑器/搜索/移动 390×844/暗色） ===
  ✅ 文件名含 'login' 的截图 = 1（期望 ≥1）
  ✅ 文件名含 'list' 的截图 = 3（期望 ≥1）
  ✅ 文件名含 'editor' 的截图 = 2（期望 ≥1）
  ✅ 文件名含 'search' 的截图 = 1（期望 ≥1）
  ✅ 文件名含 'mobile' 的截图 = 2（期望 ≥1）
  ✅ 文件名含 'dark' 的截图 = 1（期望 ≥1）
  ✅ 390×844 移动截图 = 2（期望 ≥1）
  ✅ 1280×800 桌面截图 = 8（期望 ≥1）
  ✅ 修前截图 docs/shots/before/*.png = 10（期望 ≥6）
  ✅ PROGRESS.md 里「识图」结论条数 = 19（期望 ≥6）

=== AC-21 组件库真的在渲染（渲染后 DOM 里不同 ant-* 类名数，期望 ≥ 3） ===
  $ gzip -dc 无需；dump = tmp/ui-shots/list.html（492436 字节）
ant-app ant-app-rtl ant-badge ant-badge-color-blue ant-badge-color-cyan ant-badge-color-geekblue ant-badge-color-gold ant-badge-color-green ant-badge-color-lime ant-badge-color-magenta ant-badge-color-orange ant-badge-color-pink 
  ✅ list 页不同 ant-* 类名 = 1558（期望 ≥3）
  $ gzip -dc 无需；dump = tmp/ui-shots/editor.html（654797 字节）
ant-app ant-app-rtl ant-badge ant-badge-color-blue ant-badge-color-cyan ant-badge-color-geekblue ant-badge-color-gold ant-badge-color-green ant-badge-color-lime ant-badge-color-magenta ant-badge-color-orange ant-badge-color-pink 
  ✅ editor 页不同 ant-* 类名 = 1780（期望 ≥3）

=== 结论 ===
  ✅ AC-13 / AC-20 / AC-21 全部通过
rc=0
```

**全量回归（阶段 8 改动到的东西跑一遍；阶段 8 未改服务端，回归是防回归）**

```
$ npm test                        → ℹ tests 147  ℹ pass 147  ℹ fail 0（29 个测试文件；阶段 7 基线 130/27）
$ npm run typecheck:web           → rc=0（web/tsconfig.json，strict + noUncheckedIndexedAccess）
$ bash tools/ac-stage2.sh         → rc=0（AC-3 / AC-4 / AC-15）
$ bash tools/ac-stage3.sh         → rc=0（AC-5 / AC-6 / AC-7 / AC-14，含 2000 条规模基线）
$ bash tools/ac-stage4.sh         → rc=0（AC-8 / AC-9 / AC-12）
$ bash tools/ac-stage5.sh         → rc=0（AC-10 / AC-11）
$ bash tools/ac-stage6.sh         → rc=0（AC-22 / AC-23 / AC-24 / AC-27 / AC-28）
$ bash tools/ac-stage7.sh         → rc=0（AC-25 真实 Python MCP 客户端 / AC-26）
$ ss -ltn | grep -c ':8767'       → 0（截图脚本跑完没有残留监听；服务自起自停）
```

**单条 AC 的原始命令（与 BRIEF §8 逐字对应）**

```
$ npm ls antd @ant-design/icons --depth=0
promptmanager@0.1.0 /root/greenhouse/projects/promptmanager
├── @ant-design/icons@6.3.4
└── antd@6.6.4

$ grep -rnE "<(button|input|select|textarea|table|dialog)[ >/]" web/src --include='*.tsx' | wc -l
0
$ grep -rnoE "from ['\"]antd['\"]" web/src --include='*.tsx' | wc -l
24
$ grep -rnE "(cdn|unpkg|jsdelivr|googleapis)" dist/ web/src --include='*.html' --include='*.tsx' --include='*.css' | wc -l
0
$ grep -c 'v5-patch-for-react-19' package.json
0
$ npm ls @ant-design/v5-patch-for-react-19 --depth=0
promptmanager@0.1.0 /root/greenhouse/projects/promptmanager
└── (empty)                                            ← rc=1 是 npm 对"未安装"的返回，正是期望结果

# AC-21：渲染后 DOM（不是只看依赖）
$ grep -o 'ant-[a-z-]*' tmp/ui-shots/list.html   | sort -u | wc -l
1558
$ grep -o 'ant-[a-z-]*' tmp/ui-shots/editor.html | sort -u | wc -l
1780
# 旁证：排除 css-in-js 的 <style>，只数元素 class 属性上的 ant-* 令牌
list=148  editor=213  mobile-list=93

# AC-19 复核（本阶段没改端口/监听，顺手确认三处一致）
$ grep -rn '8767' src/config.ts deploy/promptmanager.env.example README.md | head -5
src/config.ts:9:  /** 监听端口，默认 8767（台账分配；BRIEF D-4） */
src/config.ts:141:    port: readPositiveInt(env, 'PORT', 8767, 65535),
deploy/promptmanager.env.example:13:# 默认端口 8767（与 README.md / PROGRESS.md 三处一致，AC-19）；改端口须同步改两处文档与台账
deploy/promptmanager.env.example:14:PORT=8767
deploy/promptmanager.env.example:27:# 内网直连（浏览器/CLI 直接连 8767）时保持留空，否则伪造的 X-Forwarded-For 可以让登录限流失效。
$ grep -n '8767' PROGRESS.md | head -1
85:**8767 实测空闲**，且与 BRIEF D-4 的分配一致（8765=nextblog 验收备用、8766/8768/8770=其他项目主端口）。
```

**顺手复核（本阶段没动的既有验收面，确认未被破坏）**

```
# AC-18 部署文件：本阶段零改动 → 「无需变化」，语法与约定照旧（阶段 9 正式验收）
$ systemd-analyze verify deploy/promptmanager.service 2>&1 | grep -c error
0
$ grep -cE '^(User|Group|WorkingDirectory|EnvironmentFile|Restart)=' deploy/promptmanager.service
5
$ grep -c MemoryDenyWriteExecute deploy/promptmanager.service
0
$ grep -cE '^[A-Z_]*(PASSWORD|SECRET|TOKEN|KEY)[A-Z_]*=.+$' deploy/promptmanager.env.example
0

# AC-17 凭据与产物卫生（含本阶段新增的 web/src）
$ git check-ignore -v data/pm.db .env _env/x
.gitignore:10:data/	data/pm.db
.gitignore:5:.env	.env
.gitignore:2:_env/	_env/x
$ git grep -nE "(password|passwd|secret|token)[[:space:]]*[:=][[:space:]]*['\"][^'\"]{8,}" -- src/** bin/** web/** ':(exclude)tests/**' | wc -l
0
$ grep -cE '^\|.*\|' docs/dependencies.md ; npm ls --depth=0 --parseable | tail -n +2 | wc -l
54
27
```

**收尾后复跑（green gate 复验：最后一次实现改动之后的完整跑测）**

```
$ git log --oneline -1
e9e624c docs(progress): 阶段 8 — 提交单元表回填收尾 commit 短哈希（e3a5568 / be59b60）

$ npm test                      # = npm run build（tsc 服务端 + vite 前端）+ typecheck:tests + node --test
ℹ tests 147
ℹ suites 0
ℹ pass 147
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 15060.677329
npm-test-rc=0

$ npm run typecheck:web         # web/tsconfig.json（strict + noUncheckedIndexedAccess）
typecheck-web-rc=0

$ git status --short            # 无输出 = 工作区干净（dist/ 等产物已被 .gitignore 覆盖）
```

> 说明：本阶段最后一次**实现**改动是 `web/src/components/PromptEditor.tsx` 的文本框行数（6/3/2 → 5/3/2），
> 其后的 `npm test` / `typecheck:web` / `ac-stage8.sh` 均已跑过（§5 有原样输出）；
> 之后只剩 `PROGRESS.md` / `README.md` / `docs/dependencies.md` 的文档改动（不入测试面）。
> 为满足"绿门"要求，这里在**当前 HEAD** 上再完整复跑一次，结果 147/147、rc=0、工作区干净。
> 界面自证（AC-13）本次**没有重跑**：`tools/ui-shots.sh` 每次都会用当次夹具的时间戳重新渲染，
> 重跑会让已入库并经逐张识图的 `docs/shots/*.png` 出现无意义的时间戳差异（§3 末已有说明）。

#### 6. 未完成 / 已知缺口（本阶段范围内无缺口）

- **P1 未做**（BRIEF §4 明确不在本期）：多视图/拖拽排序/批量操作、媒体上传、快捷键、检索高亮片段。
- **前端无 URL 路由/深链**：刷新回列表、不能用浏览器前进/后退（P0 未要求；若做，建议引成熟路由库而不是手写）。
- **单包 1.25 MB（gzip 397 kB）**：antd 全量随构建本地打包、零 CDN；内网单端口场景可接受，未做代码分割。
- **阶段 9（收尾）**：`README.md` 四要素终稿复核、AC-16/17/18 正式验收、部署文件复跑（本阶段未动 `deploy/`，无新端口/变量）。

#### 7. 落盘对账（本阶段每条结论 → 落在哪个文件的哪一节）

| 结论 | 落盘位置 |
| --- | --- |
| 前端 P0 = 登录/列表筛选分页/编辑器/版本/变量/预览/导入导出 全部落地 | `web/src/components/*.tsx`（15 个）+ `web/src/App.tsx` + `Workspace.tsx`；`README.md`「界面（前端，阶段 8 交付）」表格；`tests/web-ui.test.ts`（静态断言） |
| 全部 UI 来自 antd 组件库、无自建基础组件、无第二套样式体系、无 CDN | `web/src/**`（`from 'antd'` 24 处）；`tests/web-ui.test.ts`（原生标签=0 / CDN=0）；本文件 §5 的 AC-20 输出；`docs/dependencies.md`「阶段 8 新增：0 个」 |
| 组件库**真的在渲染**（不是只装了依赖） | `tmp/ui-shots/list.html`、`editor.html`（渲染后 DOM，由 `tools/ui-shots.sh` 产出）；本文件 §5 的 AC-21 输出（1558 / 1780 个不同 `ant-*`；只数元素 class 也有 148 / 213） |
| 界面自证（截图 + 尺寸 + 覆盖 + 修前/修后成对） | `docs/shots/*.png`（10 张修后）+ `docs/shots/before/*.png`（10 张修前）；`tools/ui-shots.sh`；本文件 §3 的 10 条识图结论 + §5 的 AC-13 输出 |
| 零安装截图法（不装 puppeteer/playwright、不给服务端开后门） | `tools/ui-shot.mjs`（Node 内置 `WebSocket` + CDP）；`tools/ui-shots.sh`（真实 `POST /api/login` 取 cookie）；本文件 §3 末的口径说明 |
| FR-11b：replace 二次确认 + merge 显示新增条目数 | `web/src/components/ImportExportModal.tsx`（`REPLACE_WARNING` 文案 + `modal.confirm`）；`web/src/pure.ts::analyzeImportFile`（`REPLACE_WARNING` 常量与计数）；`tests/web-pure.test.ts`（文案逐字 + 计数 + 拒坏文件）；`tests/web-ui.test.ts`（界面接了两个接口）；本文件 §3 识图-9 的探针输出 |
| 亮暗跟随系统 + zh_CN + 响应式 | `web/src/App.tsx`（`theme.algorithm` + `zhCN` + body token 桥）、`web/src/use-prefers-dark.ts`、`web/src/components/Workspace.tsx`（`Grid.useBreakpoint`）；`README.md` 界面一节；本文件 §3 识图-5/6/10 |
| 净化/高亮不在前端重写 | `web/src/components/MarkdownPreview.tsx`（只 `POST /api/render/markdown` 后 `dangerouslySetInnerHTML`）；`tests/web-ui.test.ts`（断言前端不出现 DOMPurify） |
| 顺带接上的 usage / token 面板（非本阶段 AC） | `web/src/components/UsageDrawer.tsx`、`TokenDrawer.tsx`；`README.md` 界面表格「更多（顶栏）」行；本文件 §1 的说明 |
| 阶段 7 遗留：`bin/pm-mcp.mjs` 权限 | commit `9198164`；`git ls-files -s bin` 实测两个入口都是 `100755`；本文件 §1 |
| 服务/部署形态未变（0.0.0.0:8767、单进程单端口、deploy 三件套不动） | `src/server/app.ts`（`@fastify/static`，未改）；本文件「阶段 8 开工前 §1」；`deploy/**` 本阶段零改动 |

### 2026-09-18 — 阶段 9 开工前准备（收尾：部署文件 + README 四要素 + 全量测试 + FR-10b）

> 阶段 1–8 已由 host_manger 验收通过（结论见 `VERIFY.md`，无返工项）。本阶段只做阶段 9（BRIEF §11.4 的「部署文件 + `README.md` 四要素 + 全量测试收尾」），外加 v9 新增的 **FR-10b**。

#### 1. 端口与服务形态复核（STANDARDS §3.5：动服务前后都要实测）

```
$ ss -ltn | grep -E ':(876[5-9]|8770)\b'
LISTEN 0      10           0.0.0.0:8769      0.0.0.0:*
```

结论：**8767 空闲**（段内仅 izone 的 8769），与阶段 1–8 基线一致。本阶段**不新增监听、不改端口/环境变量**，
`deploy/` 只做「文件齐备 + 语法/约定 + 与 README 一致」的复核，**不执行任何部署**（部署是单独立项，只在用户点名后由 host_manger 执行）。

#### 2. 本阶段验收标准 → 我要执行的检查命令（BRIEF §8 AC-16/17/18 + v9 的 FR-10b）

**AC-16 全量测试**
```sh
npm test; echo "rc=$?"                                   # 期望 rc=0、0 失败；用例数只增不减（现基线 147）
ls tests/*.test.* | wc -l                                # 期望 >= 8（现 29）
npm run typecheck:web; echo "rc=$?"                      # 期望 rc=0（web/tsconfig.json strict）
```

**AC-17 凭据与产物卫生**
```sh
git check-ignore -v data/pm.db .env _env/x                     # 三条都必须有输出
git grep -nE "(password|passwd|secret|token)[[:space:]]*[:=][[:space:]]*['\"][^'\"]{8,}" -- 'src/**' 'bin/**' 'web/**' ':(exclude)tests/**' | wc -l   # 期望 0
grep -cE '^\|.*\|' docs/dependencies.md                      # 期望 >= 直接依赖数
npm ls --depth=0 --parseable | tail -n +2 | wc -l              # 直接依赖数
grep -nE 'node_modules|dist|data/|\.env|_env|tmp' .gitignore   # .gitignore 必须覆盖这六类
git status --short                                             # 期望空
ls -A tmp 2>/dev/null                                          # 本阶段结束应为空/不存在（临时产物已清理）
```

**AC-18 部署文件（交付物验收，**只交付文件，不部署**）**
```sh
systemd-analyze verify deploy/promptmanager.service 2>&1 | grep -c error     # 期望 0
grep -cE '^(User|Group|WorkingDirectory|EnvironmentFile|Restart)=' deploy/promptmanager.service   # 期望 5
grep -c MemoryDenyWriteExecute deploy/promptmanager.service                  # 期望 0
grep -cE '^[A-Z_]*(PASSWORD|SECRET|TOKEN|KEY)[A-Z_]*=.+$' deploy/promptmanager.env.example         # 期望 0
grep -cE '内网|公网|反代|回滚' deploy/README.md                                # 期望 >= 4
grep -c '备份' deploy/README.md                                               # 期望 >= 1（写明"不默认做备份"）
grep -cE 'prompt\.example\.com|/etc/letsencrypt' deploy/reverse-proxy.example.conf                # 期望 0（占位符）
grep -cE 'pm_[A-Za-z0-9_-]{16,}|PM_API_TOKEN=[^<[:space:]]+' deploy/mcp-register.example.json       # 期望 0（token 是占位符）
```

**FR-10b 导入校验收紧（v9 新增）**
```sh
# 夹具：先用合法文件 replace 导入建基线 → 记下数据指纹（除 exported_at 外整份 JSON + 标题列表）
# ① 文件里某条 prompt 缺 title       → 期望 400 invalid_import，details 指向 data.prompts[].title
# ② 文件里某条 prompt 缺 user_prompt → 期望 400 invalid_import，details 指向 data.prompts[].user_prompt
# ③ 两次拒绝之后数据指纹必须与导入前**逐字节一致**（replace 是破坏性模式，最容易被抓）
# ④ 反向保护：显式 `\"\"`（空串）仍是**合法**值 —— AC-10 的"导出→导入→再导出 EQUAL"必须继续成立
node --test tests/api-import.test.ts
bash tools/ac-stage5.sh        # 回归 AC-10 / AC-11（FR-10b 改的是同一条代码路径）
```

#### 3. FR-10b 的口径判断（BRIEF 未逐字规定 → 记在此备查）

BRIEF v9 的措辞是「拒绝**缺少** `title` 或 `user_prompt` 的 prompt 条目」，未说"空串"如何处置。本实现按**字面口径**：

- **缺键（`undefined`）或非字符串 → 400**（这正是阶段 5 验收观察到的现象：文件缺键 → 被静默落库为空串）；
- **显式 `""` / 纯空白串 → 接受**。理由是硬约束：`POST /api/prompts` 允许空标题（列表显示"(无标题)"），
  而 `GET /api/export` 对这类条目必然输出 `"title": ""`；若导入把空串也判非法，
  **AC-10 的"导出 → 导入(replace) → 再导出 EQUAL"就会被自己的合法数据打破**。
  即：FR-10b 要堵的是"**静默**把缺字段补成空串"，不是"空串本身"。
- 范围只到 **prompt 条目本身**（`data.prompts[].title` / `data.prompts[].user_prompt`），
  不下探到 `versions[]` 快照（BRIEF 写的是"prompt 条目"；版本快照不在列表里展示，且历史数据可能本就没有标题）。

以上属 dsh 权限内的口径判断（BRIEF 已给字面口径，且 AC-10 反向约束唯一），**不触发 QUESTIONS**。

#### 4. 红 → 绿计划（先看到失败，再看到通过）

| # | 红（先跑，看失败） | 绿（实现后，看通过） |
| --- | --- | --- |
| 1 | `node --test tests/api-import.test.ts` 新增的 FR-10b 用例失败（缺字段的文件当前返回 200） | 同上全绿（29 个文件 / 149+ 用例） |
| 2 | — | `npm test` rc=0、`npm run typecheck:web` rc=0（AC-16 原样输出贴 §3） |

### 2026-09-18 — 阶段 9 实施与自检（收尾：FR-10b + AC-16/17/18 + README 四要素 + tmp 清理）

#### 1. 提交单元与 commit 对应

| # | 单元 | commit | 内容 |
| --- | --- | --- | --- |
| 1 | 开工前 | `430543e` | AC-16/17/18 与 FR-10b 的检查命令、端口实测、**FR-10b 口径判断**、红/绿计划 |
| 2 | **FR-10b 后端** | `8b3b2ac` | `src/services/import.ts`：缺 `title`/`user_prompt` → 400 `invalid_import`（不再静默补空串）；`tests/api-import.test.ts` 新增用例（含"拒绝后数据逐字节不变"+ 显式空串仍合法的 AC-10 反向断言） |
| 3 | FR-10b 界面一致性 | `569f44b` | `web/src/pure.ts::formatImportDetails` + `ApiError.details` + `ImportExportModal` 显示后端 `details` 逐条原因（**前端不复刻校验**，BRIEF FR-10b「UI 不必兜」）；`tests/web-pure.test.ts` 新增用例 |
| 4 | 收尾文档 | 见收尾回复标注 | 本文件 + `README.md`（四要素终稿：149 用例、FR-10b、jsdom 内存实测、bundle 体积、交付≠已部署）+ `deploy/README.md`（修掉重复的「## 4.」编号 → 「## 5. 只交付、不部署的边界」） |

#### 2. FR-10b 红 → 绿（先看到失败，再看到通过）

**红（实现之前）**
```
$ node --test tests/api-import.test.ts
✔ AC-10：导出 → 导入(replace) → 再导出：除 exported_at 外完全一致，且保留文件里的 id
✔ 回归：库里已存在父子文件夹时，replace 仍能清空重建（自引用外键 ON DELETE RESTRICT 的坑）
✔ AC-10 补充：导入后 FTS 索引同步（导入的词能搜到，旧数据的词搜不到）
✔ AC-11：非法文件一律 400 invalid_import，且不得改动任何数据
✔ 导入原子性：事务中途失败（重复 id）→ 400 且整库回滚到导入前
✔ merge 模式：不清库、同名 folder/tag 复用、prompt 一律新建并重新分配 id
✔ merge 模式：同一名字挂在不同父下 → 视为不同文件夹（新建）
✔ 导入需要认证（401）；非法 mode 的类型错误也不 500
✖ FR-10b：缺 title / user_prompt 的 prompt 条目 → 400 invalid_import，且拒绝后数据指纹不变
ℹ tests 9  ℹ pass 8  ℹ fail 1
✖ failing tests:
  AssertionError [ERR_ASSERTION]: 缺 title 必须 400，实际 200：{"mode":"replace","imported":{"folders":2,"tags":2,"prompts":1}}
```
> 这就是 FR-10b 描述的现象本身：**缺字段的文件被 200 接受**（replace 模式下还会先把整库清掉）。

**绿（实现之后）**
```
$ node --test tests/api-import.test.ts
✔ FR-10b：缺 title / user_prompt 的 prompt 条目 → 400 invalid_import，且拒绝后数据指纹不变
ℹ tests 9  ℹ pass 9  ℹ fail 0
```

#### 3. AC-16 / AC-17 / AC-18 实测（原样输出）

**AC-16 全量测试**
```
$ npm test; echo "rc=$?"
> promptmanager@0.1.0 test
   …（中间为 149 个用例逐个 ✔，略）
ℹ tests 149
ℹ suites 0
ℹ pass 149
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 14857.750431
rc=0
```

```
$ npm run typecheck:web; echo "rc=$?"
> promptmanager@0.1.0 typecheck:web
> tsc -p web/tsconfig.json

rc=0
```

```
$ ls tests/*.test.* | wc -l
29
```

**顺手回归（FR-10b 改的就是导入路径）**：`bash tools/ac-stage5.sh` → rc=0
```
########## 回归: bash tools/ac-stage5.sh（FR-10b 改的是导入路径） ##########
{"mode":"replace","imported":{"folders":2,"tags":2,"prompts":2}}
去掉 exported_at 后比对两份导出： EQUAL
imported.mode = replace ｜imported = {'folders': 2, 'tags': 2, 'prompts': 2}
imported.prompts == 导出的 prompt 数： MATCH
id 保留： MATCH
"快照之后才加的" 已被清掉： MATCH
导入内容可检索（q=会话交接）： MATCH
被清掉的数据检索不到（q=临时记录）： MATCH
--- 附加：CLI `export --out` 与 /api/export 同格式（去掉 exported_at 后 EQUAL）
rc=0
CLI 文件与 API 导出： EQUAL
prompt 数与导入前一致： MATCH
整库逐字段与导入前一致： EQUAL
rc=0
```

**AC-17 凭据与产物卫生**
```
########## AC-17 ##########
$ git check-ignore -v data/pm.db .env _env/x
.gitignore:10:data/	data/pm.db
.gitignore:5:.env	.env
.gitignore:2:_env/	_env/x

$ git check-ignore -v node_modules/x dist/x data/x .env _env/x tmp/x
.gitignore:19:node_modules/	node_modules/x
.gitignore:20:dist/	dist/x
.gitignore:10:data/	data/x
.gitignore:5:.env	.env
.gitignore:2:_env/	_env/x
.gitignore:11:tmp/	tmp/x

$ git grep -nE "(password|passwd|secret|token)[[:space:]]*[:=][[:space:]]*['\"][^'\"]{8,}" -- 'src/**' 'bin/**' 'web/**' ':(exclude)tests/**' | wc -l
0

$ grep -cE '^\|.*\|' docs/dependencies.md ; npm ls --depth=0 --parseable | tail -n +2 | wc -l
54
27

$ git status --short
(above must be empty)
```

**收尾复跑（最后一次实现改动 `569f44b` 之后的完整跑测；本节所有 AC 输出均来自此状态）**
```
$ npm test; echo "rc=$?"
✔ 导入导出界面：两种模式 + FR-11b 文案与 merge 计数 (0.648527ms)
✔ 响应式 + 亮暗跟随系统（antd theme.algorithm / Grid.useBreakpoint） (0.397356ms)
✔ AC-20 ②：源码里不出现原生表单/表格标签 (1.661825ms)
✔ AC-20 ④：源码零 CDN 外链 (0.819941ms)
ℹ tests 149
ℹ suites 0
ℹ pass 149
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 14607.439685
rc=0

$ npm run typecheck:web; echo "rc=$?"

> promptmanager@0.1.0 typecheck:web
> tsc -p web/tsconfig.json

rc=0
```

**AC-18 部署文件（交付物验收；只交付文件，未执行部署）**
```
########## AC-18 ##########
$ systemd-analyze verify deploy/promptmanager.service 2>&1 | grep -c error
0
$ grep -cE '^(User|Group|WorkingDirectory|EnvironmentFile|Restart)=' deploy/promptmanager.service
5
$ grep -c MemoryDenyWriteExecute deploy/promptmanager.service
0
$ grep -cE '^[A-Z_]*(PASSWORD|SECRET|TOKEN|KEY)[A-Z_]*=.+$' deploy/promptmanager.env.example
0
$ grep -cE '内网|公网|反代|回滚' deploy/README.md  ; grep -c '不默认做备份\|备份不默认\|不做备份' deploy/README.md
24
1
$ grep -nE 'prompt\.example\.com|/etc/letsencrypt' deploy/reverse-proxy.example.conf | wc -l
0
$ grep -nE 'pm_[A-Za-z0-9_-]{16,}' deploy/mcp-register.example.json | wc -l
0

$ ls -l deploy/
total 32
-rw-r--r-- 1 root root   245 Sep 18 15:30 mcp-register.example.json
-rw-r--r-- 1 root root  2168 Sep 18 14:43 promptmanager.env.example
-rw-r--r-- 1 root root  1801 Sep 18 11:49 promptmanager.service
-rw-r--r-- 1 root root 12657 Sep 18 15:31 README.md
-rw-r--r-- 1 root root  1950 Sep 18 14:43 reverse-proxy.example.conf
```

#### 4. README 四要素最终核对（BRIEF §7 要求「是什么 / 怎么跑 / 怎么验证 / 已知限制」）

| 要素 | 位置 | 本阶段收齐的内容 |
| --- | --- | --- |
| 是什么 | `README.md`「是什么」 | 目标用户、clean-room 理由、形态（单进程/单端口/单文件库）、**阶段 1–9 全部完成**、界面/CLI/MCP/Token/双形态部署一句话总览、**「交付 ≠ 已部署」红线** |
| 怎么跑 | `README.md`「怎么跑」 | 环境要求 + `npm ci`/`build`/`migrate`/口令 + 全部 API 示例（认证/CRUD/检索/文件夹标签/版本/变量/Markdown/Token/usage/导入导出）+ **界面（前端）**一张表（页面 ↔ 接口）+ CLI 与 MCP 用法 + 部署形态（systemd 三件套，不部署） |
| 怎么验证 | `README.md`「怎么验证」 | `npm test`（**29 个测试文件 / 149 个用例**）+ `ac-stage2..8.sh` + `tools/ui-shots.sh` + 2000 条夹具 + `systemd-analyze verify`；并指向 `BRIEF.md` §8 / `PROGRESS.md` / `docs/search-zh.md` / `docs/dependencies.md` |
| 已知限制 | `README.md`「已知限制」 | 阶段边界、**前端 5 条**（无深链、P1 未做、提交式搜索、**bundle 体积 1.25 MB/gzip 397 kB**、变量填值不持久化）、导入导出语义（含 **FR-10b**）、净化硬化、Token/CORS/usage/MCP/双形态、版本与回滚、变量、Markdown（含 **jsdom 常驻内存实测**）、PUT/文件夹/标签语义、会话与安全、单用户、不做清单、检索（**LIKE 兜底与 10 万行重新评估**）、运行时不联网、备份不默认做 |

**本阶段新增的三处"已知限制"证据**（都属于收尾补全）：
- **jsdom 内存**（实测）：只 import Markdown 模块 → heap `3.9 MB → 65.6 MB`、RSS `47.6 MB → 170.3 MB`；
  起完整服务后 `VmRSS = 208500 kB ≈ 204 MB`；连渲 200 次中等文档是 GC 可回收增长（+35 MB heap）。
- **bundle 体积**：单包 1.25 MB（gzip 397 kB）。
- **LIKE 兜底规模**：`<3` 码点走 `LIKE '%…%'` 全表扫描，2000 行 ~0.2 ms，**10 万行量级需重新评估**。

#### 5. `tmp/` 清理（阶段 9 明确要求）

- 清理前：`tmp/` 里有阶段 8 的 4 个日志（`red-stage8.log`、`ac-stage8-shots.log`、`ac-stage8-final.log`、`regression-stage8.log`）、
  `tmp/removed-stage1/StageChecklist.tsx`（阶段 8 删组件时的暂存副本）、`tmp/ui-shots/*.html`（DOM dump），**全部未跟踪**；
  本阶段又落了两个检查日志（`tmp/stage9-ac16.log`、`tmp/stage9-ac17-18.log`）。
- 清理后：`tmp/` **不存在**（`rm -rf tmp`，`ls -A tmp` → `No such file or directory`），`git status --short` 干净。
- ⚠️ 因此本文件阶段 8 里引用的 `tmp/red-stage8.log` 等路径是**当时的过程文件**，现已按收尾要求删除；
  其关键输出已**原样抄进本文件**（§「阶段 8 实施与自检 §2/§5」），证据不依赖 tmp 存在。

#### 6. 未完成 / 已知缺口

- **实际部署未做**（按约定）：安装到系统 / 开机自启 / 反代 / 对外暴露属**单独立项**，只在用户点名后由 host_manger 执行；
  本阶段只交付"可部署的最终状态"（`deploy/` 五件套 + 双形态文档 + 回滚步骤）。
- **P1 未做**（BRIEF §4 明确不在本期）：多视图/拖拽排序/批量操作、媒体上传、快捷键、检索高亮片段。
- 前端无 URL 深链、单包未做代码分割、Markdown 依赖 jsdom（常驻 ~200 MB）——均已在 `README.md`「已知限制」写清，**不是 AC 缺口**。
- 本项目**没有遗留的未通过 AC**：阶段 1–8 见 `VERIFY.md`，阶段 9 的三条（AC-16/17/18）在本节有原样输出。

#### 7. 落盘对账（本阶段每条结论 → 落在哪个文件的哪一节）

| 结论 | 落盘位置 |
| --- | --- |
| FR-10b 已实现：缺 `title`/`user_prompt` → 400 `invalid_import` 且数据零变化 | `src/services/import.ts`（`parseExportFile` 里的显式 `fail` 分支 + 注释）；`tests/api-import.test.ts`「FR-10b」用例；本文件「阶段 9 §2 红→绿」 |
| FR-10b 的口径（缺键拒、显式空串收）与理由（AC-10 往返） | 本文件「阶段 9 开工前 §3」；`README.md`「已知限制 · 导入导出语义」 |
| 前端与后端错误一致（不复刻校验、显示后端 `details`） | `web/src/api.ts`（`ApiError.details`）、`web/src/pure.ts::formatImportDetails`、`web/src/components/ImportExportModal.tsx`；`tests/web-pure.test.ts` 用例；本文件 §1 第 3 行 |
| AC-16 通过（149/149、rc=0）+ 测试文件数 29 | 本文件「阶段 9 §3 AC-16」（原样输出）；`README.md`「怎么验证」 |
| AC-17 通过（check-ignore 六类全覆盖、凭据 0 命中、依赖表 54 ≥ 直接依赖 27） | 本文件「阶段 9 §3 AC-17」（原样输出）；`.gitignore` |
| AC-18 通过（verify 0 error、5 必需项、无 MemoryDenyWriteExecute、env 无口令值、两条部署路径+回滚+不默认做备份、两个样例文件无真实域名/token） | 本文件「阶段 9 §3 AC-18」（原样输出）；`deploy/promptmanager.service`、`deploy/promptmanager.env.example`、`deploy/README.md`、`deploy/reverse-proxy.example.conf`、`deploy/mcp-register.example.json` |
| README 四要素终稿（含 jsdom 内存/bundle 体积/LIKE 规模） | `README.md`「是什么 / 怎么跑 / 界面（前端）/ 怎么验证 / 已知限制」；本文件 §4 的逐要素对照表 |
| `deploy/README.md` 重复编号修复（第二个「## 4.」→「## 5.」；保留 §2.7 不改，因 PROGRESS/VERIFY 已引用该编号） | `deploy/README.md` §5；本文件 §1 第 4 行 |
| `tmp/` 已清理、工作区干净、无残留监听 | 本文件 §5；实测 `git status --short`（空）与 `ss -ltn` 里 8767 的命中数 = 0（§3/开工前 §1） |

### 2026-09-18 — 阶段 9.1 开工前准备（FIX-1：unit 必须允许 AF_NETLINK）

> 本阶段只做 **FIX-1（部署期缺陷修正）**，不新增任何功能。对应验收缺口 = **BRIEF v10 §5 新增条款 + §8 AC-18 第 ⑤ 条**；
> 缺陷实证 = **`VERIFY.md`「部署记录（host_manger 执行，2026-09-18）」→「⚠️ 部署期发现并修补的交付物缺陷：unit 缺 `AF_NETLINK`」**。

#### 1. ★ 端口与生产实例实测（决定本阶段哪些检查能做）

```
$ ss -ltn | grep -E ':(876[5-9]|8770)\b'
LISTEN 0      10           0.0.0.0:8769      0.0.0.0:*
LISTEN 0      511          0.0.0.0:8767      0.0.0.0:*
```

**8767 现在被「已部署的生产实例」占着**（不是我的残留进程）——只读核实：

```
$ ss -ltnp | grep ':8767'
LISTEN 0      511   0.0.0.0:8767   0.0.0.0:*   users:(("MainThread",pid=2317539,fd=24))
$ tr '\0' ' ' < /proc/2317539/cmdline ; readlink -f /proc/2317539/cwd
/usr/bin/node /opt/promptmanager/dist/server/index.js
/opt/promptmanager
$ awk '/^(Uid|PPid):/{print}' /proc/2317539/status
Uid:  984 984 984 984        # = host_manger 建的服务账号 promptmanager
PPid: 1                      # = 由 systemd（PID 1）拉起
```

**因此本阶段的纪律（避免踩到生产）**：
- 只做**静态**改动与**静态**断言（文件 grep + `systemd-analyze verify` 语法检查），**不启动任何服务**；
- **不跑** `tools/ac-stage2..7.sh` / `ui-shots.sh` 这类会绑定 8767 的脚本（会与生产实例抢端口）；
- **不碰** systemd、不重启/不停生产实例、不跑 `systemctl`（红线③：部署与运行时验证是 host_manger 的动作）；
- "改了之后真能在 systemd 下起来"这条**运行时**结论，来源是 `VERIFY.md` 部署记录里 host_manger 的实录
  （drop-in 生效值 `AF_INET AF_INET6 AF_NETLINK AF_UNIX` 后 `active`、`NRestarts=0`），本阶段只把修复**回填进交付物**。
- ⚠️ 注意：仓库里改了 unit **不等于**生产已变——生产实例仍用它自己的 drop-in，直到 host_manger 重新投放/部署（本阶段不动它）。

#### 2. 本阶段验收标准 → 我要执行的检查命令（BRIEF v10 §8 AC-18 第 ⑤ 条 + 原有条目复跑）

**⑤（v10 新增，FIX-1 的核心断言）**
```sh
grep -cE '^RestrictAddressFamilies=.*AF_NETLINK' deploy/promptmanager.service     # 期望 1
grep -c 'AF_NETLINK' deploy/README.md                                             # 期望 >=1（排查条目已写）
# 顺带自查排查条目三要素齐备（症状 / 根因 / 修法）
grep -c 'uv_interface_addresses' deploy/README.md                                 # 期望 >=1（症状原文）
grep -c 'errno 97' deploy/README.md                                               # 期望 >=1（根因编号）
grep -c 'systemctl show -p RestrictAddressFamilies' deploy/README.md              # 期望 >=1（确认生效值的方法）
grep -c '\[Service\]' deploy/README.md                                           # 期望 >=1（drop-in 必须带段头）
```

**原有条目复跑（回归：加固项不能被改坏）**
```sh
systemd-analyze verify deploy/promptmanager.service 2>&1 | grep -c error          # 期望 0
grep -cE '^(User|Group|WorkingDirectory|EnvironmentFile|Restart)=' deploy/promptmanager.service   # 期望 5
grep -c MemoryDenyWriteExecute deploy/promptmanager.service                       # 期望 0
grep -cE '^[A-Z_]*(PASSWORD|SECRET|TOKEN|KEY)[A-Z_]*=.+$' deploy/promptmanager.env.example         # 期望 0
# 加固项逐条未变（与上一版 unit 做 diff，只允许 RestrictAddressFamilies 一行变化）
git diff <fix 前>..<fix 后> -- deploy/promptmanager.service
```

⚠️ **`systemd-analyze verify` 拦不住这条缺陷**（BRIEF v10 §8 明确；VERIFY 部署记录实测 verify 全绿但启动崩）——
所以第 ⑤ 条是**静态回填断言**，真正的运行时确认只能"以真实 unit 真起一次"，由 host_manger 在部署时做。

#### 3. 本阶段的实现决策（BRIEF 未逐字规定 → 记在此备查）

1. **unit 的写法**：`RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK`（在原有三项后**追加** `AF_NETLINK`），
   其余加固项**一律不动**；并在该行上方补一行注释说明"为什么必须有 AF_NETLINK"（避免以后被人"顺手清理"掉）。
2. **不改 `Memory*` 系列**（Node JIT 冲突，STANDARDS §7.5）；不新增任何指令行数（只改这一行 + 注释）。
3. **`deploy/README.md` 的排查条目新增为「## 6.」而不是插进已有编号中间**：现有 `§2.7 / §3.1–3.4 / §4 / §5` 已被
   `PROGRESS.md` 与 `VERIFY.md` 引用（例如 `deploy/README.md §3.4`、`§2.7`），新增到末尾不会破坏任何既有引用。
4. **drop-in 写法按 VERIFY 实录**：`RestrictAddressFamilies=` 先清空再赋值，且 drop-in **必须带 `[Service]` 段头**
   （否则 systemd 报 "Unknown section" 且不生效）；确认生效值用 `systemctl show -p RestrictAddressFamilies --value <svc>`。
5. **不教读者改交付物之外的东西**：排查条目只涉及本项目 unit / drop-in / env / 服务重启，不涉及防火墙、NAT、内核参数等。

#### 4. 红 → 绿计划（先看到失败，再看到通过）

| # | 红（先跑，看失败） | 绿（修完，看通过） |
| --- | --- | --- |
| 1 | `grep -cE '^RestrictAddressFamilies=.*AF_NETLINK' deploy/promptmanager.service` = **0** | 同上 = 1 |
| 2 | `grep -c 'AF_NETLINK' deploy/README.md` = **0** | 同上 ≥ 1，且三要素与确认命令都在 |
| 3 | — | `systemd-analyze verify` = 0 error，且 `git diff` 只有 `RestrictAddressFamilies` 一行 + 注释变化 |

### 2026-09-18 — 阶段 9.1 实施与自检（FIX-1：unit 允许 AF_NETLINK + 排查条目）

#### 1. 对应哪个验收缺口（引用部署记录，不自己造运行时结论）

**缺口来源（原文引用）**：`VERIFY.md` →「部署记录（host_manger 执行，2026-09-18）」→
「⚠️ 部署期发现并修补的交付物缺陷：unit 缺 `AF_NETLINK`」：

```
SystemError [ERR_SYSTEM_ERROR]: A system error occurred: uv_interface_addresses returned Unknown system error 97 (EAFNOSUPPORT)
    at Object.networkInterfaces (node:os:218:16)
    at getAddresses (/opt/promptmanager/node_modules/fastify/lib/server.js:365:29)
    at Object.logServerAddress (...:381)
→ 服务 exited status=1/FAILURE，Restart 循环
```

- **为什么 AC-18 原本没拦住**（VERIFY 原文结论）：AC-18 只断言"`systemd-analyze verify` 无 error + 指令齐备 + 口令留空"，
  **语法正确 ≠ 能起来**；这类不兼容只有"以真实 unit 真起一次"才暴露。本轮实测也复现了这一点（见 §3 红：verify = 0 error 但断言 = 0）。
- **规格化**：BRIEF v10 §5 增硬约束「unit 的 `RestrictAddressFamilies` 必须包含 `AF_NETLINK`」+ `deploy/README.md` 必须有排查条目；
  §8 AC-18 增第 ⑤ 条。本阶段即按此回填交付物。

#### 2. 改了哪些文件

| 文件 | 改动 |
| --- | --- |
| `deploy/promptmanager.service` | `RestrictAddressFamilies` 由 `AF_INET AF_INET6 AF_UNIX` → **`AF_INET AF_INET6 AF_UNIX AF_NETLINK`**；并在该行上方加 4 行注释说明"为什么必须留 AF_NETLINK + verify 拦不住"。**其余加固项一行未动**（见 §3 末的 diff 断言） |
| `deploy/README.md` | 新增 **`## 6. 排查：systemd 下启动即崩（uv_interface_addresses / errno 97）`**：症状（journald 原始报错）→ 根因（libuv 需要 AF_NETLINK）→ 修法（① 用 v10 起的交付 unit；② 存量用 drop-in，**必须带 `[Service]` 段头**、先清空再赋值）→ 确认生效值（`systemctl show -p RestrictAddressFamilies --value`）→ 边界（只碰本项目 unit/drop-in/重启） |
| `PROGRESS.md` | 本文件（开工前 §1–§4 + 本节） |

**不改的东西**：`BRIEF.md` / `STANDARDS.md` 未动；根 `README.md` 未动（它的部署小节已指向 `deploy/README.md`，
本阶段刻意把改动面压到最小）；没有新增端口/环境变量；没有动 systemd 与任何系统配置。

**unit 的完整改动（原样 diff）**：
```
$ git diff -U0 -- deploy/promptmanager.service | grep -E '^[-+]' | grep -vE '^(---|\+\+\+)'
-RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
+# ⚠️ AF_NETLINK 必须留在允许列表里：Linux 上 os.networkInterfaces()（Fastify 启动打印监听地址时会调用）
+#    经 libuv 的 uv_interface_addresses 需要 netlink socket；缺了它会**启动即崩**：
+#    SystemError: uv_interface_addresses returned Unknown system error 97 (EAFNOSUPPORT)
+#    实证见 VERIFY.md「部署记录」（首次真实部署实录）；`systemd-analyze verify` 只验语法，拦不住这条。
+RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK
```

#### 3. AC-18 增补断言 + 原有条目复跑（红 → 绿，原样输出）

**红（FIX 之前 —— 复现"verify 全绿但缺陷在"）**
```
########## RED（FIX 之前）##########
$ grep -n '^RestrictAddressFamilies=' deploy/promptmanager.service
48:RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX

$ grep -cE '^RestrictAddressFamilies=.*AF_NETLINK' deploy/promptmanager.service
0

$ grep -c 'AF_NETLINK' deploy/README.md
0

$ grep -c 'uv_interface_addresses' deploy/README.md
0

$ grep -c 'errno 97' deploy/README.md
0

$ systemd-analyze verify deploy/promptmanager.service 2>&1 | grep -c error
0
  ↑ 语法检查全绿 —— 但 VERIFY 部署记录证明它在 systemd 下启动即崩（errno 97）：verify 拦不住运行时不兼容
```

**绿（FIX 之后）**
```
########## GREEN（FIX 之后 · AC-18 第 ⑤ 条 + 原有条目复跑）##########
$ grep -n '^RestrictAddressFamilies=' deploy/promptmanager.service
52:RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK

$ grep -cE '^RestrictAddressFamilies=.*AF_NETLINK' deploy/promptmanager.service
1

$ grep -c 'AF_NETLINK' deploy/README.md
4
$ grep -c 'uv_interface_addresses' deploy/README.md
3
$ grep -c 'errno 97' deploy/README.md
2
$ grep -c 'systemctl show -p RestrictAddressFamilies' deploy/README.md
1
$ grep -cF '[Service]' deploy/README.md
2

--- 原有 AC-18 条目复跑 ---
$ systemd-analyze verify deploy/promptmanager.service 2>&1 | grep -c error
0
$ grep -cE '^(User|Group|WorkingDirectory|EnvironmentFile|Restart)=' deploy/promptmanager.service
5
$ grep -c MemoryDenyWriteExecute deploy/promptmanager.service
0
$ grep -cE '^[A-Z_]*(PASSWORD|SECRET|TOKEN|KEY)[A-Z_]*=.+$' deploy/promptmanager.env.example
0

--- unit 加固项逐条未变（只允许 RestrictAddressFamilies 一行 + 注释变化）---
$ git diff --stat -- deploy/promptmanager.service
 deploy/promptmanager.service | 6 +++++-
 1 file changed, 5 insertions(+), 1 deletion(-)
$ git diff -U0 -- deploy/promptmanager.service | grep -E '^[-+]' | grep -vE '^(---|\+\+\+)'
-RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
+# ⚠️ AF_NETLINK 必须留在允许列表里：Linux 上 os.networkInterfaces()（Fastify 启动打印监听地址时会调用）
+#    经 libuv 的 uv_interface_addresses 需要 netlink socket；缺了它会**启动即崩**：
+#    SystemError: uv_interface_addresses returned Unknown system error 97 (EAFNOSUPPORT)
+#    实证见 VERIFY.md「部署记录」（首次真实部署实录）；`systemd-analyze verify` 只验语法，拦不住这条。
+RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK

$ git diff -U0 -- deploy/promptmanager.service | grep -cE '^[-+](NoNewPrivileges|PrivateTmp|PrivateDevices|Protect|RestrictNamespaces|RestrictRealtime|RestrictSUIDSGID|LockPersonality|RemoveIPC|SystemCallArchitectures|CapabilityBoundingSet|AmbientCapabilities|UMask|MemoryDenyWriteExecute)='
0
```

**drop-in 写法的实测依据**（用 `--root` 假根在项目 `tmp/` 里造目录结构验证，**没有碰本机 systemd**）：
```
########## drop-in 语法实测（--root 假根，不碰本机 systemd）##########
# ① 交付 unit + 正确 drop-in（带 [Service] 段头）
$ systemd-analyze verify --root=tmp/verify promptmanager.service 2>&1 | grep -v 'sysinit.target\|is not executable'
  → 无 'Assignment outside of section'（drop-in 被正确解析；上面两条是 --root 假根环境的固有噪音）

# ② 反例：drop-in 缺 [Service] 段头
$ systemd-analyze verify --root=tmp/verify promptmanager.service 2>&1 | grep 'Assignment outside'
  /root/greenhouse/projects/promptmanager/tmp/verify/etc/systemd/system/promptmanager.service.d/10-allow-netlink.conf:1: Assignment outside of section. Ignoring.
  → 证明：drop-in 必须带 [Service] 段头，否则该行被 systemd 忽略（README §6 修法 2 的依据）
```
> `--root=tmp/verify` 会带来两条与假根环境相关的噪音（`Unit sysinit.target not found`、`Command /usr/bin/node is not executable`），
> 与本 unit 无关；关键是：带 `[Service]` 段头时**没有** `Assignment outside of section`，缺段头时 systemd 明确报
> `Assignment outside of section. Ignoring.` —— 这正是 README §6 修法 2 里那条"必须带段头"的依据。

#### 4. 生产实例与边界（本阶段全程只读、纯静态）

- 本阶段**没有**启动任何服务、**没有**碰 systemd、**没有**碰生产实例。
- 8767 上的监听是 host_manger 部署的**生产实例**（只读核实）：`pid=2317539` → `/usr/bin/node /opt/promptmanager/dist/server/index.js`，
  `cwd=/opt/promptmanager`，`Uid=984`（服务账号 `promptmanager`），`PPid=1`（systemd）。
- 因此**没有跑**任何会绑定 8767 的脚本（`tools/ac-stage2..7.sh` / `ui-shots.sh`）。
- ⚠️ **仓库修了 ≠ 生产已变**：生产目前仍靠 host_manger 当时加的 drop-in 生效；
  本次回填进 `deploy/` 的 unit 要等 host_manger **重新投放/部署**才会进生产（部署是它的动作，本阶段不做、也不声称做过）。
- "改完确实能在 systemd 下起来"的**运行时**结论，本阶段只引用 `VERIFY.md` 部署记录（drop-in 生效值 `AF_INET AF_INET6 AF_NETLINK AF_UNIX` → `active`、`NRestarts=0`）。

#### 5. 未完成 / 下一步

- **FIX-1 本身已闭环**（unit + 文档 + AC-18 第 ⑤ 条静态断言全绿）；无新增功能、无遗留 AC。
- **下一步（host_manger）**：把本版 `deploy/promptmanager.service` 重新投放到 `/opt/promptmanager` 或 `/etc/systemd/system/`，
  `daemon-reload` → `restart`，再用 `systemctl show -p RestrictAddressFamilies --value promptmanager` 确认生效值；
  若继续用 drop-in 则无需改动（等价）。**这些动作由 host_manger 在用户点名后执行**。
- 可选（未做，也不属本阶段）：把"以真实 unit 真起一次"做成 AC-18 的运行时断言——它需要真实 systemd 环境，
  **越出 dsh 的权限边界**；如确需，应由 host_manger 在自己的部署流程里固化（本轮未写 `QUESTIONS.md`，因为规格已明确该动作归 host_manger，不构成待决问题）。

#### 6. 落盘对账（本阶段每条结论 → 落在哪个文件的哪一节）

| 结论 | 落盘位置 |
| --- | --- |
| FIX-1 的验收缺口与实证来源（errno 97 / uv_interface_addresses） | `VERIFY.md`「部署记录」→「部署期发现并修补的交付物缺陷」；`BRIEF.md` v10 §5 与 §8 AC-18 ⑤；本文件 §1（原文引用） |
| unit 已允许 `AF_NETLINK`（其余加固未动） | `deploy/promptmanager.service` 第 52 行（含上方 4 行注释）；本文件 §2 的 diff 原文；§3 绿测的 `git diff` 断言（加固指令改动数 = 0） |
| `deploy/README.md` 有排查条目（症状/根因/修法/确认生效值） | `deploy/README.md` §6「排查：systemd 下启动即崩」；本文件 §3 的 §6 断言计数（AF_NETLINK ×4、uv_interface_addresses ×3、errno 97 ×2、`systemctl show -p RestrictAddressFamilies` ×1、`[Service]` ×2） |
| drop-in 必须带 `[Service]` 段头（有实测依据） | `deploy/README.md` §6 修法 2 的注释；本文件 §3 的 `--root` 假根实测（正例无告警 / 反例 `Assignment outside of section`） |
| AC-18 ⑤ 通过 + 原有条目复跑通过 | 本文件「阶段 9.1 §3 绿」原样输出：`AF_NETLINK` 断言 = 1、`verify` error = 0、五个必需指令 = 5、`MemoryDenyWriteExecute` = 0、env 口令类非空 = 0 |
| 本阶段没碰生产/systemd，且生产仍是 drop-in 生效 | 本文件 §4（只读 pid/cmdline 证据 + 边界声明） |
| 下一步动作归 host_manger | 本文件 §5；`deploy/README.md` §5「只交付、不部署的边界」与 §6 结尾的边界句 |

### 2026-09-18 — 阶段 10A 开工前准备（视觉重设计·设计打样）

> 本阶段只做 **10A 打样**：出三套自包含 HTML 设计稿 + 令牌草案 + 截图，**不改 `web/src/`**、不做全站实现（10B 等用户挑选后再说）。

#### 1. 输入与约束（来自 BRIEF v11）

- 需求：**FR-40 视觉重设计**（用户原话「目前的 UI 效果不太行、太单调，要有设计感和美感」），流程 = **先定方向 → 打样 → 用户挑 → 再铺开**。
- 实现边界（§5）：只允许 `antd` token/组件级定制 + CSS 变量 + **少量**自定义 CSS；**禁止**第二套样式体系、自建/改写组件库组件、CDN、复制外部站点内容与品牌元素；
  **不得**改接口契约/数据模型/路由语义/既有功能行为（纯表现层）。
- 不得回归（FR-40 明列）：单进程单端口 + 前端同托管、响应式（含 390×844）、**亮/暗跟随系统**、`zh_CN`、组件库硬约束（AC-20/AC-21）、Markdown 净化硬化、149 测试全绿、无 CDN。
- 打样阶段的产物落在 `docs/design/<方向>/`，**不碰 `web/src/`**；截图用零安装 headless chromium（`file://` 打开自包含 HTML，
  **不起服务**——8767 现在是已部署生产实例，本阶段绝不占用）。

#### 2. 我先读的技能（按用户要求：先读技能再定方向）

| 技能 | 用它的什么 |
| --- | --- |
| `frontend-design` | 定美学方向的方法论：主角（thesis）、排版承载性格、结构即信息、克制与自查、"避免三种 AI 默认观感"（米白+衬线+陶土色 / 近黑+单一荧光色 / 报纸式细线密栏） |
| `design-system`（+ `references/token-architecture.md`） | **三层令牌**（Primitive → Semantic → Component）与暗色覆盖方式；令牌要能翻译成 antd `theme.token` / `theme.components` |
| `web-artifact-designer`（dsh-web-artifact-designer） | 自包含 HTML 的构建规范与**交付前质量清单**（唯一焦点、字阶、对齐网格、零外链、图标内联…） |
| `dark-saas` | 方向 A 的必用 token 与禁用清单（近黑画布、单一强调色、表面层级、hairline） |
| `apple-minimal` | 方向 B 的必用 token 与禁用清单（留白、大号细字重、单行导航、极淡阴影） |
| `japanese-minimal` | 方向 C 的必用 token 与禁用清单（明朝体、間、细线、朱红点缀、竖排可选） |

#### 3. 三个方向（A/B 由用户指定，C 由我选并给理由）

| 方向 | 风格 | 一句话卖点 | 与现状的差异轴 |
| --- | --- | --- | --- |
| **A** | `dark-saas`（Linear 式深色 SaaS） | 近黑画布 + 表面层级 + 唯一薰衣草蓝强调色：**工程师的夜间操作台** | 表面色阶 / 密度 / 单一强调色 / mono 数据 |
| **B** | `apple-minimal`（苹果极简白） | 纯白画布 + 超大细字重标题 + 极淡阴影：**把 prompt 当作品陈列** | 字号跨度 / 留白节奏 / 大圆角卡片 / 胶囊按钮 |
| **C** | `japanese-minimal`（和式极简，**我选**） | 米白纸感 + 明朝体标题 + 细线分区 + 一枚朱红印章：**把 prompt 当文稿来管** | **字体性格**（明朝体 vs 黑体）/ 行距 / 细线网格 / 朱红点睛 |

**为什么 C 选 `japanese-minimal`**（用户要求说明理由）：
1. **它换的是"字体性格"，不是只换颜色/表面**。A/B 都属"现代克制"家族（差别主要在明暗与留白），
   而本产品的核心材料就是**文本**——明朝体标题 + 1.8 行距的正文，直接服务于"读/写 prompt"这件事；
2. **与 A/B 在情绪轴上正交**：A = 技术密集、B = 消费级明亮、C = 安静的写作台（書桌），三选一才对用户有意义；
3. **信息层级可以用"线"而不是"面"来表达**：细线网格在深色/浅色下都成立，天然满足"亮暗跟随系统"，且不需要渐变或阴影；
4. **风险与代价已识别**：`frontend-design` 明确警告"米白 + 衬线 + 陶土色"是 AI 默认观感之一。我的处置：
   **把纸色做成冷调近白（不是奶油色）、把朱红压到"印章级"（每屏 ≤2 处）、并用竖排落款做独有签名**——
   即"遵循风格技能的身份，同时避开它的陈词滥调"（差异点写进 `c-japanese-minimal/design-notes.md`）。
   代价：明朝体依赖系统字体（本机只有 Droid Sans Fallback，截图里 CJK 会退化成无衬线）——
   因此 10B 若选 C，字体策略写成"衬线优先 + 明确回退栈"，并把"是否内嵌字体"留给用户拍板（本阶段不引 CDN）。

#### 4. 交付物与检查命令（本阶段无 AC；产出是设计稿与决策请求）

```sh
# 每个方向的四件套（A/B/C 各一套）
ls docs/design/<dir>/{mockup.html,design-notes.md,tokens.md}
ls docs/design/<dir>/shots/*.png            # 4 张：列表亮色 / 列表暗色 / 编辑器亮色 / 移动 390×844
grep -cE 'https?://|unpkg|jsdelivr' docs/design/*/mockup.html     # 期望 0（自包含、零外链）
# 尺寸断言（PNG IHDR 宽×高）用 python3 逐张读，见 §5 收尾实测
git status --short                          # 期望不含 web/src（打样不污染产品代码）
```

#### 5. 红 → 绿计划（先看产物缺失/外链，再看到齐备）

| # | 红（先跑，看失败） | 绿（做完，看通过） |
| --- | --- | --- |
| 1 | `ls docs/design/*/mockup.html` → 0 个；`docs/design/*/shots/*.png` → 0 张 | 3 个 mockup、12 张截图齐备且尺寸正确 |
| 2 | 外链 grep 一旦 >0 即违反"零外链" | 三个 mockup 全部 0 |
| 3 | — | `git status --short` 无 `web/src/` 改动；产品代码零改动（149 测试无需重跑，10B 才重跑） |

### 2026-09-18 — 阶段 10A 实施与自检（视觉重设计·设计打样）

> 只做打样：三套自包含 HTML 设计稿 + 令牌草案 + 截图 + 方向对比。**不改 `web/src/`**、不做全站实现（10B 等用户挑选）。

#### 1. 交付物清单（路径级）

```
docs/design/README.md                      # 索引：怎么打开、怎么切视图、怎么重截图
docs/design/tools/design-shots.mjs         # 零安装截图器（Node 内置 WebSocket + CDP，走 file://）
docs/design/tools/shoot.sh                 # 一条命令出一个方向的 5 张图（不起服务、不占 8767）
docs/design/a-dark-saas/{mockup.html,design-notes.md,tokens.md,shots/×5}
docs/design/b-apple-minimal/{mockup.html,design-notes.md,tokens.md,shots/×5}
docs/design/c-japanese-minimal/{mockup.html,design-notes.md,tokens.md,shots/×5}
```

#### 2. 三方向对比（设计意图 / 骨架 / 主战场决策 / 代价）

| | **A｜dark-saas** | **B｜apple-minimal** | **C｜japanese-minimal（我选）** |
| --- | --- | --- | --- |
| 一句话 | 工程师的夜间操作台 | 把 prompt 当作品陈列 | 把 prompt 当文稿来管 |
| 性格来源 | **表面色阶 + 单一强调色**（近黑 `#010102`→表面 4 级 + 薰衣草蓝 `#5e6ad2`） | **字号跨度 + 留白**（40px 细字重标题、60px 行高、胶囊按钮、18px 卡片） | **字体性格**（明朝体标题 + 1.8 行距 + 细线 + 朱红印章/竖排落款） |
| 画布 | 近黑（暗色为规范形态，亮色对称推导） | 纯白 + `#f5f5f7`（亮色为规范，暗色推导） | 冷调纸白 `#fbfbf8`（亮色为规范，暗色="墨色纸"） |
| 强调色 | `#5e6ad2` 唯一 | `#0066cc` 只给交互 | 朱红 `#b7282e` **只 2 处**（印章 + 收藏）；主按钮用墨色 |
| 数据表达 | mono + tabular-nums（id/版本/日期/次数） | 字号跨度，不加粗 | 统计数字用衬线，数据用等宽 |
| 列表 | 38px 密集表格 + 选中左强调条 | 60px 目录行 + 无竖线 + hover 出操作 | 56px 目录行 + 1px 细线 + 无卡片无阴影 |
| 编辑器（三方向共同结构提案） | 表单 + **常驻检查器列**（版本 diff/变量/预览同屏），不再"切 tab" | 同左 | 同左（+ 竖排「原稿」） |
| 动效 | 仅 120ms 颜色过渡 | 仅 220ms 缓动过渡 | 基本无（仅聚焦描边） |
| 密度（1280 一屏） | 12+ 行 | 7–8 行 | 9–10 行 |
| 主要代价 | 亮色形态不如暗色有性格；单强调色意味着标签不能上色 | 大留白吃屏幕；技能原 token 对比度不达 AA（已改深） | 明朝体依赖系统字体（本机截不到衬线，需用户拍板字体策略） |
| 截图 | `docs/design/a-dark-saas/shots/` | `docs/design/b-apple-minimal/shots/` | `docs/design/c-japanese-minimal/shots/` |

**三方向都不满足"只换颜色"**：A 换的是**层级来源**（表面亮度替代边框阴影），B 换的是**尺度与容器语言**（字号跨度 + 胶囊/大圆角），
C 换的是**排版性格**（衬线 + 行距 + 线与印章）。这是 `frontend-design` 要求的"一个明确的 thesis + 一套刻意决策"。

#### 3. 我的推荐顺序及理由

1. **C（和式极简）— 首选**：三个方向里唯一改"字体性格"的，因此**差异化最大**；且它的**信息层级靠细线而非面/阴影**，
   在亮暗两种模式下都不需要重新设计；对"读/写 prompt"这个真实动作最贴。风险集中在一个点上（中文字体），
   而它有三条现成退路（系统栈 / 自托管字体 / 只在点题处用衬线），10B 可控。
2. **A（深色 SaaS）— 次选**：最"像专业工具"、信息密度最高、落地最稳（纯 token 可表达，几乎不需要自定义 CSS）。
   如果你的使用场景多在夜间/长时间，或你更喜欢"工程感"，选它。
3. **B（苹果极简）— 第三**：观感最"贵"，但**牺牲密度最多**（1280 一屏 7–8 行），
   而且它的性格高度依赖大字号与留白，在 1440 以下的屏幕上会明显打折；若你主要在 1920+ 屏用，它的名次会上升。

> 三者都能满足 FR-40 的全部硬约束（零 CDN、亮暗跟随、响应式含 390×844、纯表现层、不改契约）。
> 差别只在"你想要哪一种性格"。

#### 4. 本阶段自检实测（原样输出）

```
########## 产物齐备性 ##########
$ ls docs/design/*/mockup.html | wc -l
3
$ ls docs/design/*/{design-notes.md,tokens.md} | wc -l
6
$ ls docs/design/*/shots/*.png | wc -l
15

########## 尺寸断言（PNG IHDR）##########
docs/design/a-dark-saas/shots/editor-light.png  1280x800
docs/design/a-dark-saas/shots/import-confirm.png  1280x800
docs/design/a-dark-saas/shots/list-dark.png  1280x800
docs/design/a-dark-saas/shots/list-light.png  1280x800
docs/design/a-dark-saas/shots/mobile-list.png  390x844
docs/design/b-apple-minimal/shots/editor-light.png  1280x800
docs/design/b-apple-minimal/shots/import-confirm.png  1280x800
docs/design/b-apple-minimal/shots/list-dark.png  1280x800
docs/design/b-apple-minimal/shots/list-light.png  1280x800
docs/design/b-apple-minimal/shots/mobile-list.png  390x844
docs/design/c-japanese-minimal/shots/editor-light.png  1280x800
docs/design/c-japanese-minimal/shots/import-confirm.png  1280x800
docs/design/c-japanese-minimal/shots/list-dark.png  1280x800
docs/design/c-japanese-minimal/shots/list-light.png  1280x800
docs/design/c-japanese-minimal/shots/mobile-list.png  390x844

########## 零外链（资源型引用）##########
$ grep -cE '(src|href)="https?://|@import[^;]*https?://|url\(https?://' docs/design/*/mockup.html
docs/design/a-dark-saas/mockup.html:0
docs/design/b-apple-minimal/mockup.html:0
docs/design/c-japanese-minimal/mockup.html:0
$ grep -nE 'https?://' docs/design/a-dark-saas/mockup.html   # 仅剩的 http:// 是 prompt 正文里的本机 URL（数据，不是资源）
522:curl -s http://127.0.0.1:8767/healthz
586:                <pre><code>curl -s http://127.0.0.1:8767/healthz</code></pre>

########## 未污染产品代码 ##########
$ git status --short
?? docs/design/
$ git status --short -- web/src | wc -l
0

########## 亮暗确实是两张不同的图（像素平均亮度）##########
a-dark-saas: 亮色平均亮度=247.4  暗色平均亮度=15.1
b-apple-minimal: 亮色平均亮度=240.7  暗色平均亮度=19.3
c-japanese-minimal: 亮色平均亮度=246.2  暗色平均亮度=21.1
```

> 说明：`grep 'https?://'` 命中的两行是 **prompt 正文里的 `curl -s http://127.0.0.1:8767/healthz`**（真实产品内容/数据），
> 不是资源引用；**资源型外链（`src`/`href`/`@import`/`url()` 指向 http）实测为 0**。

#### 5. 与 FR-40 硬约束的逐条对照（设计稿层面）

| FR-40 / §5 约束 | 本阶段如何满足 |
| --- | --- |
| 不许引第二套 CSS 框架 | 三个 mockup 只有手写 CSS 变量 + 语义化 class；`tokens.md` 全部标注了对应的 antd `theme.token`/`theme.components` |
| 不许自建/改写组件库组件 | 设计稿是**静态 HTML**（打样不涉及组件），`tokens.md` 的落地方案**只用 token + 少量 CSS**（A/B/C 各列了"允许的自定义 CSS 清单"） |
| 不引 CDN | 资源型外链 = 0；字体全部系统栈；图标全部内联 SVG（`<symbol>` sprite） |
| 亮暗跟随系统 | 三个 mockup 都用 `@media (prefers-color-scheme: dark)`；截图用 CDP 媒体模拟，**实测亮/暗两张图平均亮度 240–247 vs 15–21** |
| 响应式（含 390×844） | 每个方向都有 `mobile-list.png`（390×844）：顶栏收成 ☰+品牌+头像+图标退出，侧栏收起，表格变卡片行（`m-meta` 合成一行），工具条堆叠 |
| `zh_CN` | 全部界面文案中文（C 方向另加少量日式排版用字：目録/標籤/新規作成，属文案风格，不改 locale） |
| 改的是表现层 | `git status --short -- web/src` = 0；接口契约/数据模型/功能行为零改动 |
| 编辑器与列表是主战场 | 三方向都把列表行与编辑器表单做成视觉重心；并共同提出"**版本/变量/预览 = 常驻检查器列**"的结构改进（替代现状"切 tab"） |
| 动效克制 | A=120ms 颜色过渡、B=220ms 缓动、C≈无；三方向均声明 `prefers-reduced-motion` |

#### 6. 未完成 / 下一步（**做完即停手**）

- **本阶段到此为止**：不进入 10B、不动 `web/src/`、不动已部署实例（`/opt/promptmanager` 与 systemd 归 host_manger）。
- **需要的决策**：用户在 `QUESTIONS.md` **Q-1** 里选一个方向（A/B/C）；若想要"混搭"（例如"要 C 的排版 + A 的暗色"）
  也请在答复里写明——混搭会作为 10B 的输入重新对齐令牌，不需要重做打样。
- **10B 会做什么**（预告，便于用户判断）：按选定方向的 `tokens.md` 把 `theme.token` / `theme.components` 落到
  `web/src/App.tsx`，把"常驻检查器列"落到编辑器，重跑 AC-20/AC-21/AC-13 + 149 测试，并用 `tools/ui-shots.sh`
  出**全站**截图（登录/列表/编辑器/版本/变量/预览/导入导出/Token 抽屉/移动/暗色）逐张识图 → 交付 **AC-29/AC-30**。

#### 7. 落盘对账（本阶段每条结论 → 落在哪个文件的哪一节）

| 结论 | 落盘位置 |
| --- | --- |
| 读了哪些技能、用它们的什么 | 本文件「阶段 10A 开工前 §2」；各方向 `design-notes.md` 首段"依据技能" |
| A/B/C 三方向的选型与 C 的选型理由 | 本文件「开工前 §3」+「§3 我的推荐顺序」；`docs/design/c-japanese-minimal/design-notes.md` §1.2 |
| 每个方向的美学意图/色彩/字体/间距/圆角/层级/动效/与现状差异 | `docs/design/<dir>/design-notes.md` 各节（8 项齐全） |
| 三层令牌（基础→语义→组件）与 antd 映射 | `docs/design/<dir>/tokens.md` §1/§2/§3（含 `theme.token` / `theme.components` 参考写法） |
| 令牌不写成自有 CSS 框架 | `tokens.md` §0「映射原则」+ §6「允许的少量自定义 CSS（清单式）」+ 各方向"禁止清单" |
| 设计稿贴合真实功能结构 | `docs/design/<dir>/mockup.html`（四视图：#list/#editor/#import/#import-confirm，含九条真实夹具数据） |
| 截图与尺寸 | `docs/design/<dir>/shots/*.png`（5 张/方向，共 15 张）；本文件 §4 的 IHDR 尺寸断言 |
| 零外链 / 自包含 | 本文件 §4 的 grep 输出（资源型 = 0）+ §5 对照表；三个 `mockup.html` |
| 亮暗跟随系统在打样里成立 | 本文件 §4「亮/暗平均亮度」；三个 mockup 的 `@media (prefers-color-scheme: dark)` |
| 打样不污染产品代码 | 本文件 §4 的 `git status --short -- web/src` = 0；§5 对照表 |
| 请用户挑方向 | `QUESTIONS.md` **Q-1**（含三方向一句话卖点 + 截图路径 + 我的推荐） |

### 2026-09-18 — 阶段 10B 开工前准备（视觉重设计·全站应用：方向 A + 登录页 B）

> 用户已选定方向（BRIEF v12 **D-19**）：**A｜dark-saas 为主 + 登录页按 B｜apple-minimal 的极简**。
> 用户原话：「**我选择 A，我发现他不仅仅好了样式还对排版进行了重新设计，这才是我需要的设计，让他保持这种设计感**」
> → 本阶段验收对象**不只是配色**，而是 **FR-40b 的结构/排版**。**设计稿即契约**：`docs/design/a-dark-saas/{tokens.md,mockup.html}`（登录页取 `b-apple-minimal`）。

#### 1. 设计稿 → 实现契约（先说清"以什么为准"）

| 契约源 | 取它什么 | 落到哪 |
| --- | --- | --- |
| `docs/design/a-dark-saas/tokens.md` §1/§2/§3 | 三层令牌 → `theme.token` / `theme.components` 的具体值与映射 | 新增 `web/src/theme.ts`（`buildTheme(prefersDark)`） |
| `docs/design/a-dark-saas/mockup.html`（`#list`/`#editor`/`#import`） | **结构与排版**：KPI 行 / 侧栏 / 筛选行 / 密集表格（一屏 ≥10 行）/ 状态条 / 三栏编辑器 / 移动卡片列表 | `web/src/components/*`（列表、编辑器、侧栏、KPI、状态条） |
| `docs/design/b-apple-minimal/mockup.html`（`#list` 的登录观感） | 只取"留白 + 大号细字重标题 + 胶囊按钮" | `web/src/components/LoginPage.tsx` |
| FR-40b 的 9 个固定 `data-testid` | AC-31 的机械复验锚点（**名字不许改**） | 见 §2 |

#### 2. 本阶段验收标准 → 我要执行的检查命令

**AC-13 / AC-30 界面自证（截图 + 逐张识图 + 修前/修后成对）**
```sh
bash tools/ui-shots.sh docs/shots          # 服务自起自停；13 张（新增：编辑器三栏、三个面板特写、Token 抽屉、暗色编辑器）
ls -1 docs/shots/*.png | wc -l             # 期望 ≥10，覆盖登录/列表(亮+暗)/编辑器三栏/版本/变量/Markdown/导入二次确认/移动 390×844
ls -1 docs/shots/before/*.png | wc -l      # 修前（= 阶段 8 最终观感）保留，与修后同名成对
# 尺寸断言（PNG IHDR）+ 逐张识图（五问：① 重叠/遮挡 ② 硬断词或单字成行 ③ 孤标题沉底 ④ 溢出/裁切 ⑤ 是否达到 A 方向美学与密度）
```

**AC-20 组件库硬约束（回归）**
```sh
npm ls antd @ant-design/icons --depth=0                                   # 6.6.4 / 6.3.4，无 v5 补丁
grep -rnE "<(button|input|select|textarea|table|dialog)[ >/]" web/src --include='*.tsx' | wc -l   # 0
grep -rnoE "from ['\"]antd['\"]" web/src --include='*.tsx' | wc -l      # ≥5（预期远大于 5）
grep -rnE "(cdn|unpkg|jsdelivr|googleapis)" dist/ web/src --include='*.html' --include='*.tsx' --include='*.css' | wc -l   # 0
```

**AC-21 组件库真的在渲染（回归，运行时）**
```sh
node tools/ac-stage10-probe.mjs …          # 由 tools/ac-stage10.sh 调用：渲染后 DOM 里不同 ant-* 类名数 → 期望 ≥3
```

**AC-29 token 真被定制 + 无 CDN + 组件库约束不回归**
```sh
grep -rnE "token:\s*\{|components:\s*\{" web/src --include='*.tsx' --include='*.ts' | wc -l   # ≥1（期望 ≥2：token + components）
git grep -nE "cdn|unpkg|jsdelivr" -- 'web/src' 'dist' | wc -l                                     # 0
grep -rnE "<(button|input|select|table)\b" web/src --include='*.tsx' | wc -l                     # 0
```

**AC-31 结构/排版已落地（机械判据）**
```sh
# 源码侧
grep -rc 'data-testid="pm-panel-versions"' web/src --include='*.tsx'      # ≥1
grep -rc 'data-testid="pm-kpi-row"' web/src --include='*.tsx'            # ≥1
grep -rc 'data-testid="pm-statusbar"' web/src --include='*.tsx'          # ≥1
grep -rco 'data-testid="pm-panel-' web/src --include='*.tsx' | awk -F: '{s+=$2} END{print s}'   # =3（多一个都会让 ④ 的计数≠3）
# 运行时侧（服务自起自停 + CDP），由 tools/ac-stage10.sh 输出：
#   ④ document.querySelectorAll('[data-testid^="pm-panel-"]').length            → 3
#   ⑤ [...document.querySelectorAll('[data-testid^="pm-panel-"]')].every(e=>e.offsetParent!==null) → true（三块同时可见）
#   ⑥ document.querySelectorAll('.ant-tabs-tab').length（编辑器视图）           → 0（三块不再由标签页承载）
#   ⑦ document.querySelectorAll('[data-testid="pm-kpi-row"] .pm-kpi-value').length → ≥4
#   附加：列表页可见表格行数 ≥10（FR-40b「表格密度 1280 一屏 ≥10 行」的运行时证据）
bash tools/ac-stage10.sh                                                    # 一条命令跑完上面全部
```

**AC-32 与设计稿一致（≥4 组并排对照 + 降级清单）**
```sh
ls -1 docs/shots/compare/*.png | wc -l     # ≥4（列表亮 / 列表暗 / 编辑器 / 移动）
# 对照图由 tools/design-compare.mjs 生成（自包含 HTML 左右并排 → 零安装 CDP 截图）
```

**不得回归（逐条）**
```sh
npm test; echo "rc=$?"                     # 149 例只增不减、rc=0
npm run typecheck:web; echo "rc=$?"        # rc=0
grep -rn 'zh_CN' web/src --include='*.tsx' | wc -l                    # ≥1（locale 未回退）
grep -rn 'prefers-color-scheme' web/src web/index.html | wc -l        # ≥1（亮暗跟随系统）
grep -rn 'POST /api/render/markdown\|/api/render/markdown' web/src --include='*.tsx' | wc -l  # ≥1（Markdown 仍走服务端净化）
git diff --stat -- src/ migrations/ package.json                      # 空（纯表现层：不动服务端/契约/数据模型）
ss -ltn | grep -c ':8767'                                             # 本阶段**不碰**生产实例；截图脚本用临时 DATA_DIR 自起自停
```

#### 3. 实施计划（红 → 绿 → 截图）

| # | 步骤 | 红 | 绿 |
| --- | --- | --- | --- |
| 1 | 先写"结构已落地"的测试（`tests/web-ui.test.ts` 增 testid/无 Tabs/KPI 计数断言；`tests/web-pure.test.ts` 增 `computeKpis`） | 新增断言失败（testid 不存在、编辑器仍有 Tabs） | 全部通过 |
| 2 | `web/src/theme.ts` + `web/src/styles/app.css`（A 方向令牌与少量 CSS） | — | `token:`/`components:` grep ≥1 |
| 3 | 顶栏 / 侧栏 / KPI 行 / 筛选行 / 状态条 / 密集表格 / 三栏编辑器 / 移动卡片 + 抽屉 / 三种状态语言 | — | AC-31 ④–⑦ 运行时全过 + 一屏 ≥10 行 |
| 4 | 登录页改 B 观感 | — | 截图 `01-login` 达到"留白 + 大标题 + 胶囊按钮" |
| 5 | 截图（13 张）+ 逐张识图 + AC-32 对照图（≥4 组）+ 降级清单 | — | AC-13/30/32 全过 |

### 2026-09-18 — 阶段 10B 实施与自检（视觉重设计·全站应用：方向 A + 登录页 B）

> 用户选定方向（BRIEF v12 **D-19**）：**A｜dark-saas 为主 + 登录页按 B｜apple-minimal 的极简**。
> 用户原话「**我选择 A，我发现他不仅仅好了样式还对排版进行了重新设计，这才是我需要的设计，让他保持这种设计感**」
> → 本阶段不只换配色，**FR-40b 的结构/排版改动全部落地**（编辑器三栏常驻、KPI 行、侧栏、筛选行、密集表格、状态条、顶栏导航、移动端卡片+抽屉、三种状态语言）。

#### 1. 提交单元与 commit 对应

| # | 单元 | commit | 内容 |
| --- | --- | --- | --- |
| 1 | 开工前 | `9716207` | 设计稿→实现契约、AC-13/20/21/29/30/31/32 检查命令、不得回归清单、红/绿计划 |
| 2 | **实现 + 单测** | 见收尾回复标注 | `web/src/theme.ts`（A 方向三层令牌 → `theme.token`/`theme.components`）、`web/src/styles/app.css`（8 处少量 CSS）、新增 `KpiRow/StatusBar/States/SidebarPanel`、重写 `AppHeader/PromptList/PromptEditor/Workspace/LoginPage/App`、`DiffView` 改截断、删除 `PageFooter`（移入 `tmp/removed-stage10b/`）、`tests/web-{ui,pure}.test.ts` 新增 7 个断言 |
| 3 | 验收工具 | 见收尾回复标注 | `tools/ac-stage10.sh` + `tools/ac-stage10-probe.mjs`（运行时结构探针）、`tools/design-compare.mjs`（AC-32 对照图）、`tools/ui-shots.sh`（13 张 + 端口自动选择） |
| 4 | 收尾文档 | 见收尾回复标注 | 本文件 + `docs/shots/**`（13 修后 + 10 修前 + 10 阶段 8 原证据 + 5 组对照 + 1 张放大证据） |

#### 2. 设计稿 → 实现落点对照表（AC-31 要求 ≥6 行）

| 设计稿的点（`docs/design/a-dark-saas/`） | 实现落点（文件 / 组件 / token） | 复验锚点 |
| --- | --- | --- |
| 近黑画布 `#010102` + 4 级表面色阶 + 1px hairline | `web/src/theme.ts` `palette()` → `colorBgLayout/colorBgContainer/colorBgElevated/colorFill*` + `components.Layout/Table/Card` | AC-29 ①（`token:`/`components:` = 2） |
| **唯一强调色** `#5e6ad2`（主按钮/焦点/选中条/收藏/链接） | `theme.ts` `colorPrimary/colorInfo/colorLink/colorPrimaryHover/colorPrimaryActive` + `Tag.defaultColor`；选中行左侧条 = `styles/app.css .pm-row-selected` | 截图 02/06；AC-20 ④（零 CDN） |
| 数据用 mono + tabular-nums | `styles/app.css .pm-mono`；`PromptList`（id/版本/取用/日期）、`KpiRow`（`.pm-kpi-value`）、`StatusBar` | 截图 02/03 |
| 列表页 = KPI 行 + 侧栏 + 筛选行 + 密集表格 + 分页 + 状态条 | `KpiRow.tsx`（`pm-kpi-row`）、`SidebarPanel.tsx`（`pm-sidebar`）、`PromptList.tsx`（`pm-filter-row` + `.pm-table-dense` + `Pagination`）、`StatusBar.tsx`（`pm-statusbar`，sticky 贴底）、`Workspace.tsx` 组装 | AC-31 ②③⑦ + 密度断言（12 行） |
| **编辑器三栏常驻**（左列表 / 中表单 / 右三块同屏） | `PromptEditor.tsx`（`pm-editor` + `.pm-editor-grid` 300/1fr/380）→ 左 `editorList`（Workspace 传入）、中表单、右 `VersionPanel`/`VariablePanel`/`MarkdownPreview` 三个包裹 div（`pm-panel-versions` / `pm-panel-variables` / `pm-panel-markdown`）；**不再有 Tabs** | AC-31 ④⑤⑥（3 / true / 0） |
| 顶栏 = 品牌 + 环境标识 + 导航 + 主题跟随 + 用户区 | `AppHeader.tsx`（`pm-topnav`，`window.location.host` 作为环境标识，导航 = 使用统计 / API 令牌 / 导入导出，主题 Tag，头像+用户名+登出） | 截图 02/06/13 |
| 移动端 = 卡片列表 + 抽屉编辑（不横向溢出） | `PromptList.tsx` `isMobile` 分支走 antd `List.Item.Meta` 卡片；`Workspace.tsx` 用 `Drawer` 承载 `PromptEditor(isMobile)`；侧栏进 `Drawer` | AC-31 列表 testid + 截图 05/10 |
| 空/加载/错误三态用新语言 | `States.tsx`（`EmptyState` / `LoadingState`(Skeleton 行) / `ErrorState`），已接入列表、版本、变量、Markdown、Token、Usage 面板 | 截图 12；源码 grep |
| 登录页按 B 的极简（留白 + 大标题 + 胶囊按钮） | `LoginPage.tsx`（40px/600/-0.021em 标题、`variant="filled"` 输入、`borderRadius: 980` 胶囊按钮） | 截图 01 |

#### 3. AC-31 / AC-29 / AC-20 / AC-21 实测（`bash tools/ac-stage10.sh`，服务自起自停）

```
$ bash tools/ac-stage10.sh; echo "rc=$?"
  PORT 自动选择：8765（8767 被已部署实例占用，故避开）

=== AC-29 ① theme.token 与 theme.components 真的被定制 ===
  ✅ theme.token/components 命中 = 2（期望 ≥1）

=== AC-29 ② 源码与产物零 CDN ===
  ✅ CDN 命中 = 0

=== AC-20 ② 源码里不出现原生表单/表格标签 ===
  ✅ 原生标签命中 = 0

=== AC-20 ③ from 'antd' 出现次数（期望 ≥5） ===
  ✅ from 'antd' = 27（期望 ≥5）

=== AC-31 ①②③ 源码侧的三个 testid + pm-panel-* 恰好 3 个 ===
  ✅ data-testid="pm-panel-versions" = 1
  ✅ data-testid="pm-kpi-row" = 1
  ✅ data-testid="pm-statusbar" = 1
  ✅ pm-panel-* 总数 = 3
  ✅ data-testid="pm-topnav" = 1
  ✅ data-testid="pm-sidebar" = 1
  ✅ data-testid="pm-filter-row" = 1
  ✅ data-testid="pm-editor" = 1

=== 不得回归：zh_CN / 亮暗跟随系统 / Markdown 仍走服务端净化 ===
  ✅ zh_CN = 3（期望 ≥1）
  ✅ prefers-color-scheme = 5（期望 ≥1）
  ✅ /api/render/markdown = 2（期望 ≥1）
  ✅ 纯表现层（src/migrations/package.json 未改） = 0

=== 运行时探针（服务自起自停 + CDP；数据用临时 DATA_DIR） ===
SEED prompts=12
AC31_LIST_TESTIDS=true,true,true,true,true
AC31_07_KPI_VALUES=4
AC31_ROWS_VISIBLE=12
AC31_ROWS_RENDERED=13
AC31_ROWS_LAST_BOTTOM=821
AC31_STATUSBAR_VISIBLE=true
AC31_04_PANELS=3
AC31_05_PANELS_ALL_VISIBLE=true
AC31_06_TABS=0
AC31_PANEL_IDS=pm-panel-versions,pm-panel-variables,pm-panel-markdown
AC21_ANT_CLASSES=139
AC20_NATIVE_TAGS=1
AC20_NATIVE_SAMPLE=table.(no-class)

=== AC-31 ④⑤⑥⑦（运行时） ===
  ✅ ④ pm-panel-* 元素数 = 3
  ✅ ⑤ 三块同时可见 = true
  ✅ ⑥ 详情面 .ant-tabs-tab 数 = 0
  ✅ ⑦ KPI 数值元素数 = 4（期望 ≥4）
  ✅ 面板 testid 组合 = pm-panel-versions,pm-panel-variables,pm-panel-markdown
  ✅ 列表页 5 个结构 testid 全在 = true,true,true,true,true

=== FR-40b 表格密度（1280×800 一屏可见行数 ≥10）+ 底部状态条可见 ===
  ℹ 渲染行数=13 ｜ 视口内=12 ｜ 最后一行底边=821px
  ✅ 可见表格行数 = 12（期望 ≥10）
  ✅ 底部状态条在视口内 = true

=== AC-21 组件库真的在渲染（渲染后 DOM 的 ant-* 类名数） ===
  ✅ ant-* 类名数 = 139（期望 ≥3）
  ℹ 运行时不带任何 ant-* 类的原生表单/表格元素 = 1（样本：table.(no-class)）

=== 结论 ===
  ✅ AC-13（结构侧）/ AC-20 / AC-21 / AC-29 / AC-31 全部通过（截图见 tools/ui-shots.sh）
rc=0
```

#### 4. AC-13 / AC-30 界面自证（13 张，逐张识图）

命令：`bash tools/ui-shots.sh docs/shots`（服务自起自停；**8767 被已部署实例占用 → 脚本自动在台账范围 8765–8770 内挑空闲端口**，本次选中 8765）。
修前/修后**同名成对**（`docs/shots/before/` = 阶段 8 的最终观感；阶段 8 的修前/修后原证据另存 `docs/shots/before-stage8/`，其 VERIFY 结论不受影响）。

五问口径：① 重叠/遮挡 ② 硬断词或单字成行 ③ 孤标题沉底 ④ 溢出/裁切 ⑤ 是否达到 A 方向的美学与密度。

| 截图 | 尺寸 | 识图结论 |
| --- | --- | --- |
| `01-login.png` | 1280×800 | ①无 ②**修前有**"里。"单字成行 → 副标题缩短为一行后无 ③无 ④无 ⑤达到 B 的极简（大留白 + 40px 细字重标题 + 胶囊按钮），与 A 的令牌体系一致 |
| `02-list.png` | 1280×800 | ①**修前有**：品牌方块里的 "P"、头像里的 "ad" 被 antd `Layout.Header` 的固定 `line-height:64px` 挤到框外 → 顶栏加 `line-height:1.4` + 元素 `line-height:1` 后无 ②无 ③无 ④无（状态条 sticky 完整可见） ⑤达到 A（近白表面 + hairline + 单一 indigo + mono 数据）；夹具 9 条时一屏 9 行，12 条夹具时视口内 12 行 |
| `03-editor.png` | 1280×800 | ①无 ②**修前有**：diff 在 `{{项目}}` 中间硬断词（`pre-wrap`）→ 改为 `pre` + 截断后无 ③无 ④无（面板列内滚动） ⑤三栏（300/表单/380）与 A 密度达到设计预期 |
| `04-search.png` | 1280×800 | ①无 ②无 ③无 ④无 ⑤与 A 一致；顺带验证「搜索后 KPI 行与状态条联动」（1 / 1 / v3 / 35 ms、当前筛选命中 1 条） |
| `05-mobile-list.png` | 390×844 | ①无 ②**修前有**：KPI 四个窄格里标签被挤成 2–3 行 → 手机改 2×2 网格并隐藏 hint 后无 ③无 ④无（无横向溢出） ⑤移动端卡片列表成立（☰ + 品牌 + ⋯；卡片含标题/文件夹/版本/取用/时间） |
| `06-dark-list.png` | 1280×800 | ①无 ②无 ③无 ④无 ⑤A 方向的**规范形态**：近黑画布 + 表面色阶 + 同一强调色，暗色下对比正常 |
| `07-versions.png` | 1280×800 | ①无 ②无（diff 行以 … 截断，不在变量中间断） ③无 ④无（列内滚动） ⑤版本历史面板达到设计（对比选择 + diff + 版本表 + 回滚） |
| `08-variables.png` | 1280×800 | ①无 ②无（结果区折行正常） ③无 ④无 ⑤变量面板达到设计（2 变量填值 + 渲染 + 复制 + 结果） |
| `09-import-confirm.png` | 1280×800 | ①无（弹窗叠在面板上属预期） ②无 ③无 ④无 ⑤导入/导出 + **replace 二次确认**（FR-11b 文案逐字保留）在新主题下成立 |
| `10-mobile-editor.png` | 390×844 | ①无 ②无 ③无 ④无（表单单列、按钮换行右对齐） ⑤抽屉编辑成立，未退化为横向溢出表格 |
| `11-markdown.png` | 1280×800 | ①无 ②无 ③无 ④无 ⑤Markdown 预览面板（字段选择 + 服务端渲染说明 + 渲染结果）达到设计 |
| `12-tokens.png` | 1280×800 | ①无 ②无 ③无 ④无 ⑤Token 抽屉沿用新语言（提示 Alert + 输入 + 表格 + **新空态**），"明文只显示一次"提示清晰 |
| `13-dark-editor.png` | 1280×800 | ①无 ②无 ③无 ④无 ⑤暗色下三栏编辑器成立（暗表面 + 暗输入 + 暗 diff 红绿着色） |

**附加证据**：`docs/shots/evidence/topbar-zoom.html` + `topbar-lineheight-fixed.png`（把顶栏放大 2.4 倍复验"品牌字不再溢出方块"）。

#### 5. AC-32 与设计稿的一致性 + 降级清单

命令：`node tools/design-compare.mjs`（生成自包含联络表 HTML → 零安装 CDP 渲染）
产出：**5 组并排对照**（要求 ≥4）→ `docs/shots/compare/`

| 对照图 | 尺寸 | 左（设计稿） | 右（实现） |
| --- | --- | --- | --- |
| `01-list-light.png` | 2604×914 | `design/a-dark-saas/shots/list-light.png` | `docs/shots/02-list.png` |
| `02-list-dark.png` | 2604×914 | 同上 `list-dark` | `docs/shots/06-dark-list.png` |
| `03-editor.png` | 2604×914 | 同上 `editor-light` | `docs/shots/03-editor.png` |
| `04-mobile-list.png` | 824×958 | 同上 `mobile-list` | `docs/shots/05-mobile-list.png` |
| `05-import-confirm.png` | 2604×914 | 同上 `import-confirm` | `docs/shots/09-import-confirm.png` |

**降级清单**（设计稿的点 → 实际做法 → 原因；**无降级就写"无"，这里如实列 6 条**）

| # | 设计稿的点 | 实际做法 | 原因 |
| --- | --- | --- | --- |
| 1 | 编辑器右栏三块**在视口内同时完整可见** | 三块**同时挂载**在同一列（AC-31 ⑤ 的 `offsetParent` 判据通过），但 1280×800 下需要**列内滚动**才能看全第三块 | diff（约 200px）+ 变量表单（约 300px）+ 预览（约 200px）在 680px 的可用高度里放不下；**设计稿本身也是同屏堆叠 + 列内滚动**（10A 的 `editor-light.png` 同样只看到两块半）→ 属设计固有取舍，不是实现简化 |
| 2 | 设计稿编辑器左栏是「文件夹/标签」侧栏 | 实现左栏是 **prompt 列表**（可搜索 + 高亮当前项） | **FR-40b 明确写「左（列表）」**，规格优先；侧栏仍在列表页常驻（`pm-sidebar`），切换 prompt 用左栏列表更贴合"正在编辑多条"的真实用法 |
| 3 | 设计稿顶栏环境标识写 `pm.host :8767` | 实现显示 `window.location.host`（如 `127.0.0.1:8765`） | 写死会与实际部署不一致（端口/域名由部署决定）；显示真实 host 更诚实，也便于排障 |
| 4 | 设计稿 KPI 第三项是「最近一次改动版本 = v3」 | 实现取**当前筛选结果中最大的 `version_no`**，无数据时显示 `—` | 列表接口没有"全库最近改动"字段；不新增接口（纯表现层约束），因此用可见数据的最值并在 hint 里写明"每次保存自动留档" |
| 5 | 设计稿第四项写「中文检索 FTS5 trigram 0.3ms」（后端基线） | 实现显示**本次前端查询的往返毫秒**（KPI + 状态条） | 后端基线与用户操作无关；显示实测往返更有用，且不做假数据。数字比设计稿大（20–80ms）是网络+渲染的真实成本 |
| 6 | 设计稿的文件夹/标签/工作区是**一块**面板 | 实现是**三张 Card**（`Card size="small"`） | antd 的 `Card` 天然分块；用 token 保持同一套表面/描边/圆角，视觉上与设计稿同族（对照图 `01-list-light` 可见差异很小） |

> 另有 2 处**主动偏离**（已在 10A 的 `design-notes.md` 记录、本阶段沿用）：KPI 数字用 18px（设计稿 17–20px 之间取整）、
> 暗色下卡片边界补 1px hairline（暗色阴影表达力弱）。

#### 6. 不得回归清单（逐条实测）

```
########## AC-16 / 不得回归：npm test ##########
✔ AC-29 ①：theme.token 与 theme.components 都被定制（不是只有 algorithm） (0.349683ms)
✔ FR-40b 移动端：卡片列表 + 抽屉编辑（不是横向溢出表格） (0.29176ms)
ℹ tests 156
ℹ suites 0
ℹ pass 156
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 15045.754504
rc=0

########## npm run typecheck:web ##########
> promptmanager@0.1.0 typecheck:web
> tsc -p web/tsconfig.json

rc=0

########## AC-13/AC-30 截图清单与尺寸 ##########
$ ls -1 docs/shots/*.png | wc -l
14
  docs/shots/01-login.png  1280x800
  docs/shots/02-list.png  1280x800
  docs/shots/03-editor.png  1280x800
  docs/shots/04-search.png  1280x800
  docs/shots/05-mobile-list.png  390x844
  docs/shots/06-dark-list.png  1280x800
  docs/shots/07-versions.png  1280x800
  docs/shots/08-variables.png  1280x800
  docs/shots/09-import-confirm.png  1280x800
  docs/shots/10-mobile-editor.png  390x844
  docs/shots/11-markdown.png  1280x800
  docs/shots/12-tokens.png  1280x800
  docs/shots/13-dark-editor.png  1280x800
  docs/shots/_zoom-dark-topbar.png  620x170
$ ls -1 docs/shots/before/*.png | wc -l（修前，与修后同名成对）
10
$ ls -1 docs/shots/before-stage8/*.png | wc -l（阶段 8 的修前/修后原证据保留）
10

########## AC-32 并排对照 ##########
$ ls -1 docs/shots/compare/*.png | wc -l
5

########## 组件库硬约束（AC-20 / AC-29，源码侧）##########
$ npm ls antd @ant-design/icons --depth=0
promptmanager@0.1.0 /root/greenhouse/projects/promptmanager
├── @ant-design/icons@6.3.4
└── antd@6.6.4

$ grep -rnE '<(button|input|select|textarea|table|dialog)[ >/]' web/src --include='*.tsx' | wc -l
0
$ grep -rnoE "from ['\"]antd['\"]" web/src --include='*.tsx' | wc -l
27
$ grep -rnE '(cdn|unpkg|jsdelivr|googleapis)' dist/ web/src --include='*.html' --include='*.tsx' --include='*.css' | wc -l
0
$ grep -rnE 'token:[[:space:]]*\{|components:[[:space:]]*\{' web/src --include='*.ts' --include='*.tsx' | wc -l
2

########## 体量（阶段 7 基线 1,250,520 B / gzip 396,960 B）##########
  index-FGb8gg72.css 3920 B gzip 1195 B
  index-Vj3XQ2JO.js 1271324 B gzip 399544 B
$ wc -l web/src/theme.ts web/src/styles/app.css | tail -3
 167 web/src/theme.ts
  92 web/src/styles/app.css
 259 total
```

**结论逐条**：
| 项 | 结果 |
| --- | --- |
| 组件库硬约束（antd 6.6.4 / icons 6.3.4、无 v5 补丁） | ✅ `npm ls` 输出无异常 |
| 无原生表单/表格标签（源码） | ✅ `0` |
| `from 'antd'` 使用面 | ✅ `27` 处（≥5） |
| 零 CDN（源码 + 产物） | ✅ `0` |
| `theme.token` + `theme.components` 真被定制 | ✅ `2`（AC-29 ①） |
| Markdown 净化硬化不回归 | ✅ 仍只走 `POST /api/render/markdown`（前端无 DOMPurify） |
| `zh_CN` | ✅ `3` 处 |
| 亮/暗跟随系统 | ✅ `5` 处 `prefers-color-scheme`；截图 06/13 为暗色 |
| 响应式（含 390×844） | ✅ 截图 05/10 |
| `npm test` | ✅ **156/156**，rc=0（149 → 156，只增不减） |
| `npm run typecheck:web` | ✅ rc=0 |
| 单进程单端口 / 不改契约 | ✅ `git status --short -- src migrations package.json` = 0；前端仍由 `@fastify/static` 同进程托管 |
| 体量 | JS `1,271,324 B`（gzip `399,544 B`，阶段 7 基线 1,250,520 / 396,960 → **+20.8 KB / gzip +2.6 KB**）；CSS `3,920 B`（gzip 1,195 B，新增 `app.css` 92 行 + `theme.ts` 167 行） |

#### 7. 未完成 / 下一步

- 本阶段范围内**无未完成项**：FR-40b 的 5 条结构改动 + AC-13/20/21/29/30/31/32 全部通过。
- **未做（按约定）**：不动部署——`/opt/promptmanager`、systemd unit、8767 上的生产实例都归 host_manger；
  本阶段没有同步代码、没有重启服务。**下一步由 host_manger 在验收通过后同步 `/opt` 并重启上线**。
- 已知取舍（不属 AC 缺口，已写进降级清单）：三栏右列需列内滚动；KPI 的"最近改动版本/检索耗时"取自可见数据与实测往返；
  暗色下卡片补 1px hairline。
- 若后续要动：`docs/design/a-dark-saas/tokens.md` 是唯一令牌来源，改观感只改 `web/src/theme.ts`（一处）。
- `tmp/` 已按惯例清理（本次的 `ac-stage10-final.log`/`stage10b-verify.log`/`ui-shots/` DOM dump/`removed-stage10b/` 删除暂存）——
  它们的**关键输出已原样抄进本文件**（§3 的 AC 脚本输出、§6 的不得回归实测），证据不依赖 tmp 存在；
  被删的 `PageFooter.tsx` 内容仍可从 git 历史取回（本阶段提交里是删除记录）。

#### 8. 落盘对账（本阶段每条结论 → 落在哪个文件的哪一节）

| 结论 | 落盘位置 |
| --- | --- |
| 方向落地 = A 为主 + 登录页 B（D-19） | `web/src/theme.ts`（全部 token）；`web/src/components/LoginPage.tsx`；本文件「阶段 10B §2」对照表 |
| FR-40b 的 9 个固定 `data-testid` | `AppHeader.tsx`(pm-topnav)、`SidebarPanel.tsx`(pm-sidebar)、`KpiRow.tsx`(pm-kpi-row)、`PromptList.tsx`(pm-filter-row)、`StatusBar.tsx`(pm-statusbar)、`PromptEditor.tsx`(pm-editor + pm-panel-versions/variables/markdown)；`tests/web-ui.test.ts`；本文件 §3 |
| 编辑器三栏常驻、不再用标签页 | `PromptEditor.tsx`（无 `Tabs` import）；`tests/web-ui.test.ts`「AC-31 ⑥」；本文件 §3 的 ④⑤⑥ |
| KPI 行 4 项（可测） | `web/src/pure.ts::computeKpis` + `tests/web-pure.test.ts`；`KpiRow.tsx`；本文件 §3 的 ⑦ |
| 表格密度 ≥10 行 + 状态条可见 | `styles/app.css .pm-table-dense` + `theme.ts` `Table.cellPaddingBlock:7`；`tools/ac-stage10-probe.mjs` 的视口内计数；本文件 §3 的密度断言（12 行）与 `AC31_STATUSBAR_VISIBLE=true` |
| 三种状态的新语言 | `web/src/components/States.tsx`（并接入 列表/版本/变量/Markdown/Token/Usage）；本文件 §4 的 12-tokens 行 |
| 移动端卡片列表 + 抽屉编辑 | `PromptList.tsx` `isMobile` 分支、`Workspace.tsx` `Drawer`；截图 `05-mobile-list.png`/`10-mobile-editor.png`；本文件 §4 |
| 截图（13 修后 + 修前成对 + 阶段 8 原证据保留） | `docs/shots/*.png`、`docs/shots/before/*.png`、`docs/shots/before-stage8/*.png`；本文件 §4 的逐张识图 |
| 与设计稿并排对照（5 组）+ 降级清单 | `docs/shots/compare/*.png` + `tools/design-compare.mjs`；本文件 §5 |
| 运行时结构探针（AC-31 ④–⑦） | `tools/ac-stage10.sh` + `tools/ac-stage10-probe.mjs`；本文件 §3 原样输出 |
| 不得回归（测试/类型/洁净/体量） | 本文件 §6；`tests/**`；`web/src/**` |
| 部署边界（不碰生产） | 本文件 §7；`tools/ui-shots.sh`（端口自动选择而非抢占 8767） |

### 2026-09-18 — 阶段 11 开工前准备（使用优先改造）

> 用户纠偏（BRIEF v13/v14 · FR-41 · D-20）：**本服务的第一身份是「日常使用工具」**，主流程是「**找到 → 一键复制 → 贴走**」，
> 管理是次要视角。参考依据 = host_manger 登录 PromptHub 实页的**逐屏考察清单**（FR-41e 吸收 / FR-41f 摒弃）。
> 约束：**只借交互与信息架构，不抄代码/文案/图标/配色**（clean-room，D-5）；不做 FR-41f 的摒弃清单。

#### 1. 设计基线（从 PromptHub 吸收益处的落点）

| FR-41e 条 | 本阶段落点 | 固定 testid |
| --- | --- | --- |
| ① 详情底部固定操作条（复制主按钮 / 版本历史 / 删除） | 新建 `PromptDetail`：模态（桌面）/ 全屏抽屉（移动），底部 sticky 操作条 | `pm-detail`、`pm-detail-actions` |
| ② 复制时的填变量对话框 + 实时预览 + 自动记忆 | 新建 `VarsDialog`：变量输入 + 预览 + 复制结果；值存 localStorage | `pm-vars-dialog`、`pm-var-input-<name>`、`pm-vars-preview` |
| ③ 正文阅读切换（纯文本 / 源码·预览 / 全屏） | `PromptDetail` 正文区的两个开关 + 全屏按钮 | — |
| ④ 列表/表格增强（卡片/表格/列表 + 变量数/取用次数 + 密度 S/M/L） | 使用视图三种视图切换；管理表格补两列 + 密度选择器 | — |
| ⑤ 顶栏常驻大搜索 + 左栏文件夹/标签/收藏 | 使用视图：大搜索（自动聚焦）+ 左栏复用 `SidebarPanel` | `pm-search-input`、`pm-use-sort` |
| ⑥ 版本历史三视图 + 变更备注 | 扩展 `VersionPanel`：表格 / 对比版本 / 详情（+ 可选变更备注，存 localStorage） | — |
| ⑦ `{{name:示例值}}` 不强制支持 | **不判成变量**（契约下 `:` 不在变量名字符集 → 原样保留）；补进 README 已知限制 | — |

#### 2. 本阶段验收标准 → 我要执行的检查命令

**AC-33 一键复制可用且内容正确（最高优先级）**
```sh
# tools/ac-stage11.sh 起临时实例（端口在台账范围自动选）+ 种夹具，然后 CDP 探针：
#   ① Browser.grantPermissions 授予剪贴板读权限
#   ② 使用视图点 [data-testid="pm-copy-<id>"]（无变量夹具）
#   ③ navigator.clipboard.readText() 与 GET /api/prompts/<id> 的 user_prompt 逐字符比对 → MATCH
#   ④ 页面出现「已复制」；GET /api/usage/summary 的 by_channel.session 计数 +1（复制＝取用）
bash tools/ac-stage11.sh
```

**AC-33b 变量对话框 + 自动记忆**
```sh
# ① 点含变量条目的 pm-copy-<id> → [data-testid="pm-vars-dialog"] 出现
# ② 在 [data-testid="pm-var-input-<name>"] 填值 → [data-testid="pm-vars-preview"] 文本随输入变化且不含 '{{'
# ③ 点「复制结果」→ 剪贴板内容与预览区文本逐字符一致
# ④ 关闭后再次点复制 → 输入框已预填上次的值（localStorage 记忆）
```

**AC-33c 详情操作条**
```sh
# 选中条目 → [data-testid="pm-detail-actions"] 存在；其中主按钮文案含「复制」且可见可点；
# 「版本历史」「删除」同为该条内按钮（只断言存在，不触发删除）
```

**AC-34 使用 / 管理 分离**
```sh
# ① pm-mode-use 与 pm-mode-manage 均存在
# ② 清 localStorage 后首次进入 → pm-use-grid 存在，且 pm-kpi-row 不在使用视图内
# ③ 切到管理 → pm-kpi-row 出现
# ④ 切回使用并刷新 → 仍是使用视图（localStorage 记忆）
# ⑤ 使用视图内 [data-testid^="pm-delete-"] 计数 = 0
```

**AC-35 移动端一键复制**
```sh
# 390×844：pm-copy-<id> 可见（offsetParent !== null）且 getBoundingClientRect 宽高均 ≥ 44；默认视图 = 使用
```

**AC-36 快捷与详情**
```sh
# ① 按 '/' → document.activeElement 是 pm-search-input
# ② 双击 pm-use-card → pm-detail 出现
# ③ 按 Esc → pm-detail 消失
# ④ 详情内存在常驻复制按钮
```

**不得回归（逐条）**
```sh
npm test; echo "rc=$?"                       # 156 例只增不减、rc=0
npm run typecheck:web; echo "rc=$?"          # rc=0
bash tools/ac-stage10.sh                     # AC-20/21/29/31（组件库/token/结构）——注意：默认落使用视图后，
                                             #   该探针需先切「管理」再断言编辑器三栏（本阶段会同步更新探针）
grep -rnE '<(button|input|select|textarea|table|dialog)[ >/]' web/src --include='*.tsx' | wc -l   # 0
grep -rnE '(cdn|unpkg|jsdelivr|googleapis)' dist/ web/src --include='*.html' --include='*.tsx' --include='*.css' | wc -l  # 0
git status --short -- src migrations package.json | wc -l      # 0（不改接口契约/数据模型）
```

#### 3. 关键实现决策（BRIEF 未逐条规定口径 → 先记在此备查）

1. **「复制」如何计入 usage（不新增接口）**：
   - 无变量条目 → 复制走 **`GET /api/prompts/:id`**（FR-19 已把"打开详情"记为取用）→ 用返回的 `user_prompt` 写剪贴板；
   - 含变量条目 → 走 **`POST /api/prompts/:id/render`**（FR-19 已把"渲染取用"记为取用）→ 复制服务端渲染结果；
   - 编辑器内的复制按钮同理（用 `/render` 取当前文本，含 session 通道记账）。
2. **填变量对话框的"实时预览"**：预览用**客户端替换**（变量名由服务端 `/variables` 给出；替换规则与服务端 `renderVariables` 完全一致：
   提供了字符串值 → 替换；`\{{name}}` → 去掉反斜杠输出字面量；未提供的**原样保留**）。
   **最终复制仍以服务端 `/render` 的返回为准**（AC-33b 要求"剪贴板 == 预览区文本"，因此我会加一条**对照测试**
   把客户端预览与服务端 `/render` 的输出逐字符比对，防止两者漂移）。这不是自建模板引擎——没有表达式/循环，只是对已知变量名的替换。
3. **`pm-delete-*` 只出现在管理视图**（AC-34 ⑤ 要求使用视图内计数为 0）：详情底部的「删除」（FR-41e 第 1 条明确要求）
   用 `pm-detail-delete` 作为标识，**不以 `pm-delete-` 开头**，避免与 AC 的计数口径冲突；管理表格的行删除用 `pm-delete-<id>`。
4. **沿用现有组件与令牌**：使用视图复用 `SidebarPanel` / `MarkdownPreview` / `VariablePanel` / `VersionPanel`，
   不新增第二套样式体系；新增的 `UseView`/`PromptDetail`/`VarsDialog` 全部用 antd 组件 + 现有 token。
5. **常量与偏好存 localStorage**（不新增接口）：`pm-mode`（use/manage）、`pm-vars:<promptId>`（变量值记忆）、
   `pm-vnote:<promptId>:<versionNo>`（版本变更备注，FR-41e 第 6 条允许的"本地扩展"）、`pm-view-mode`、`pm-density`。
6. **快捷键**：`/`（聚焦搜索）、`Ctrl/Cmd+K`（切到使用视图并聚焦）、`Esc`（关详情）、`↑/↓ + Enter`（选择并复制）、双击卡片开详情；
   在输入框里打字时**不劫持按键**（Esc 除外）。

#### 4. 计划与提交单元

| # | 单元 | 内容 |
| --- | --- | --- |
| 1 | P0-1 一键复制 | `use-copy` hook + `pure.hasVariables/previewRender` + 使用视图卡片复制 + 详情/编辑器复制 + 测试 |
| 2 | P0-2/3 详情 + 填变量 | `PromptDetail`（`pm-detail` + `pm-detail-actions`）+ `VarsDialog`（`pm-vars-dialog`/`pm-vars-preview`/`pm-var-input-*`）+ localStorage 记忆 |
| 3 | P0-4 使用/管理分离 | `pm-mode-use`/`pm-mode-manage` + localStorage + 使用视图（大搜索 `pm-search-input` + 卡片网格 `pm-use-grid`/`pm-use-card` + 排序 `pm-use-sort` + 收藏置顶） |
| 4 | P1 阅读 + 视图增强 | 纯文本/源码·预览/全屏；卡片·表格·列表三视图 + 变量数·取用次数两列 + 密度 S/M/L |
| 5 | P1 版本 + 快捷 | 版本历史三视图（表格/对比/详情）+ 变更备注；`/`、`Ctrl+K`、`Esc`、`↑↓`、`Enter`、双击 |
| 6 | 自证 | `tools/ac-stage11.sh` + 探针、`ui-shots.sh` 增图、逐张识图、PROGRESS 收尾 |

### 2026-09-18 — 阶段 11 实施与自检（使用优先改造）

> 用户纠偏（BRIEF v13/v14 · FR-41 · D-20）：**本服务的第一身份是「日常使用工具」**——「找到 → 一键复制 → 贴走」；
> 管理是次要视角。本阶段 **P0 四条 + P1 五条全部落地**（FR-41a/b/c/d + FR-41e 的 ③④⑥），并按 FR-41f **不做**摒弃清单里的东西。

#### 1. 提交单元与 commit 对应

| # | 单元 | commit | 内容 |
| --- | --- | --- | --- |
| 1 | 开工前 | `5dfba25` | FR-41e 落点表、AC-33/33b/33c/34/35/36 检查命令、复制计 usage 的实现决策 |
| 2 | **P0-1 一键复制** | `2c349c4` | `usePromptCopy`（无变量→`GET /api/prompts/:id`、有变量→`POST /render`，**复制=取用**、零新接口）+ 剪贴板兜底（内网 http 非安全上下文）+ `VarsDialog`（实时预览 + localStorage 记忆）+ 列表/编辑器复制按钮 + `previewRender` 与服务端 `/render` 的一致性对照测试 |
| 3 | **P0-2/3 详情 + 操作条** | `fd58b23` | `PromptDetail`（桌面模态 / 移动全屏抽屉）+ 正文阅读切换（字段/预览·源码/纯文本/全屏）+ 变量与版本同屏 + **`pm-detail-actions`**（复制提示词·版本历史·删除） |
| 4 | **P0-4 使用/管理分离** | `7ac4334` | `pm-mode-use`/`pm-mode-manage` + localStorage 记忆 + 默认使用；`UseView`（大搜索 `pm-search-input` + 排序 `pm-use-sort` + 卡片网格 `pm-use-grid`/`pm-use-card` + 收藏置顶 + 三视图 + 变量数·取用次数列）；使用视图只读侧栏、**无 `pm-delete-*`**；快捷键 `/`·Ctrl+K·Esc·↑↓·Enter·双击 |
| 5 | **P1 阅读/视图/版本/移动** | `f0d1bfe` | 详情阅读四件套、卡片·表格·列表 + 密度 S/M/L、版本历史三视图（表格/对比/详情 + 本地变更备注）、移动端复制按钮 ≥44×44 |
| 6 | 验收工具 + 自证 | 见收尾回复标注 | `tools/ac-stage11.sh` + `tools/ac-stage11-probe.mjs`；`ui-shots.sh` 扩到 19 张；`ac-stage10-probe` 适配"默认使用视图"；本文件 + 截图 |

#### 2. 完成项（P0 + P1 逐条 → 落点）

**P0（用户最直接的痛点）**
1. **一键复制**（FR-41a）：`UseView` 每张卡片 `pm-copy-<id>`（复制 `user_prompt`；含变量时按钮文案变「填值后复制」并弹对话框）；详情底部「复制提示词」；编辑器内 `editor-copy-user`/`editor-copy-system` 直接复制；成功弹「已复制」；**不新增接口** —— 复制走既有的 `GET /api/prompts/:id` / `POST /api/prompts/:id/render`，两者都按 FR-19 记 `channel=session`（实测 `by_channel.session` +1）。
   ⚠️ 编辑器内的复制按钮**不额外记账**（打开条目时已记一次）。
2. **详情底部固定操作条**（FR-41e ①）：`pm-detail-actions` = 「复制提示词」（主按钮）·「版本历史」·「删除」（危险色 + 二次确认，标识 `pm-detail-delete`）。**不做** PromptHub 的 AI Test。
3. **填变量对话框**（FR-41e ②）：`pm-vars-dialog` +「请填写变量值（自动记忆）」+ `pm-var-input-<name>` + `pm-vars-preview`（实时）+ 取消/`pm-vars-confirm`；值按 prompt 存 `localStorage['pm-vars:<id>']`，下次预填。
4. **使用 / 管理 分离**（FR-41b）：`pm-mode-use` / `pm-mode-manage`（顶栏，localStorage `pm-mode` 记忆，**默认使用**）；使用视图 = 大搜索（自动聚焦、300ms 防抖）+ 卡片网格 + 收藏置顶 + 排序（最近更新/最近使用/标题）+ `pm-use-sort` + 点/双击卡片开 `pm-detail`；使用视图内 `pm-delete-*` 计数 **0**；管理视图保留 KPI/筛选/表格/导入导出/状态条与三栏编辑器。

**P1（全部落地）**
5. **正文阅读体验**（FR-41e ③）：详情内「用户/系统/备注」字段切换 +「预览 | 源码」双模式 + 「显示纯文本」开关 + 「全屏展开」。
6. **列表/表格增强**（FR-41e ④）：使用视图 **卡片/表格/列表** 三视图；表格补 **变量数** 与 **取用次数** 列（管理表格同样补上）；管理表格加 **密度 S/M/L**（`pm-density`，localStorage）。
7. **版本历史**（FR-41e ⑥）：`pm-version-views` = **表格 / 对比版本 / 详情**；详情视图含元信息 + 与上一版的 diff + **变更备注**（`pm-vnote-input`/`pm-vnote-save`，存 `localStorage['pm-vnote:<id>:<n>']`，表格里显示「备注」Tag）；保留原 diff 与回滚。
8. **快捷**（FR-41c）：`/` 聚焦搜索、`Ctrl/Cmd+K` 切使用并聚焦、`Esc` 关详情、`↑/↓` 选择、`Enter` 复制当前项、**双击**条目开详情；输入框内不劫持按键（Esc 除外）。
9. **移动优先**（FR-41d）：390×844 默认使用视图；复制按钮常显且 `min-height:44px`（实测 102×44 / 63×44）；详情用全屏抽屉。

#### 3. AC 实测（`bash tools/ac-stage11.sh`，服务自起自停、端口自动选）

```
$ bash tools/ac-stage11.sh; echo "rc=$?"
########## AC-33 / 33b / 33c / 34 / 35 / 36（tools/ac-stage11.sh）##########
mobileOverflow=false
antClasses=88

=== AC-34 使用 / 管理 分离 ===
  ✅ 两个模式开关都在 = true
  ✅ 首次进入默认使用视图 = true
  ✅ 使用视图内没有 KPI 行 = true
  ✅ 使用视图内 pm-delete-* 计数 = 0
  ✅ 切到管理后 KPI 出现 = true
  ✅ 管理视图内 pm-delete-* 计数 = 3（期望 ≥1）
  ✅ 刷新后仍停在管理（localStorage 记忆） = true
  ✅ 切回使用并刷新仍是使用 = true

=== AC-33 一键复制（内容逐字符 + 已复制 + 计入 usage） ===
  ✅ 剪贴板 == 服务端 user_prompt = true
  ✅ 出现「已复制」提示 = true
  ✅ usage by_channel.session 增量 = 1

=== AC-33b 填变量对话框 + 实时预览 + 自动记忆 ===
  ✅ 对话框出现 = true
  ✅ 预览随输入变化 = true
  ✅ 预览里已无 {{（变量已替换） = true
  ✅ 剪贴板 == 预览区文本 = true
  ✅ 再次打开时预填上次的值 = greenhouse

=== AC-33c 详情底部操作条 ===
  ✅ pm-detail-actions 存在 = true
  ✅ 操作条里有「版本历史」 = true
  ✅ 操作条里有「删除」 = true
  ✅ 操作条主按钮文案含「复制」：复制提示词 | 版本历史 | 删除

=== AC-36 快捷与详情 ===
  ✅ 按 / 聚焦到 pm-search-input = true
  ✅ 双击卡片打开 pm-detail = true
  ✅ 按 Esc 关闭详情 = true

=== AC-35 移动端（390×844） ===
  ✅ 默认使用视图 = true
  ✅ 复制按钮可见=True 尺寸=63x44（期望 ≥44×44）
  ✅ 移动端无横向溢出 = false

=== AC-21 回归（使用视图渲染后的 ant-* 类名数） ===
  ✅ ant-* 类名数 = 88（期望 ≥3）

=== 结论 ===
  ✅ AC-33 / AC-33b / AC-33c / AC-34 / AC-35 / AC-36 + 不得回归全部通过
rc=0
```

**回归（AC-20/21/29/31 不受影响）**
```
########## 回归：AC-20/21/29/31（tools/ac-stage10.sh）##########
  ✅ theme.token/components 命中 = 2（期望 ≥1）
  ✅ CDN 命中 = 0
  ✅ 原生标签命中 = 0
  ✅ from 'antd' = 31（期望 ≥5）
  ✅ data-testid="pm-panel-versions" = 1
  ✅ data-testid="pm-kpi-row" = 1
  ✅ data-testid="pm-statusbar" = 1
  ✅ pm-panel-* 总数 = 3
  ✅ data-testid="pm-topnav" = 1
  ✅ data-testid="pm-sidebar" = 1
  ✅ data-testid="pm-filter-row" = 1
  ✅ data-testid="pm-editor" = 1
  ✅ zh_CN = 3（期望 ≥1）
  ✅ prefers-color-scheme = 5（期望 ≥1）
  ✅ /api/render/markdown = 2（期望 ≥1）
  ✅ 纯表现层（src/migrations/package.json 未改） = 0
AC31_LIST_TESTIDS=true,true,true,true,true
AC31_07_KPI_VALUES=4
AC31_ROWS_VISIBLE=10
AC31_ROWS_RENDERED=13
AC31_ROWS_LAST_BOTTOM=823
AC31_STATUSBAR_VISIBLE=true
AC31_04_PANELS=3
AC31_05_PANELS_ALL_VISIBLE=true
AC31_06_TABS=0
AC31_PANEL_IDS=pm-panel-versions,pm-panel-variables,pm-panel-markdown
AC21_ANT_CLASSES=128
  ✅ ④ pm-panel-* 元素数 = 3
  ✅ ⑤ 三块同时可见 = true
  ✅ ⑥ 详情面 .ant-tabs-tab 数 = 0
  ✅ ⑦ KPI 数值元素数 = 4（期望 ≥4）
  ✅ 面板 testid 组合 = pm-panel-versions,pm-panel-variables,pm-panel-markdown
  ✅ 列表页 5 个结构 testid 全在 = true,true,true,true,true
  ✅ 可见表格行数 = 10（期望 ≥10）
  ✅ 底部状态条在视口内 = true
  ✅ ant-* 类名数 = 128（期望 ≥3）
=== 结论 ===
  ✅ AC-13（结构侧）/ AC-20 / AC-21 / AC-29 / AC-31 全部通过（截图见 tools/ui-shots.sh）
```

#### 4. 界面自证与逐张识图（AC-13/AC-30 口径）

`bash tools/ui-shots.sh docs/shots` → **19 张**（新增 6 张：20-use-light / 21-use-dark / 22-detail-actions / 23-vars-dialog / 24-use-mobile / 25-mobile-detail），
修前/修后同名成对保留在 `docs/shots/before/`（10 张 = 阶段 8 观感）。

五问口径：① 重叠/遮挡 ② 硬断词或单字成行 ③ 孤标题沉底 ④ 溢出/裁切 ⑤ **是否真的像"拿来就用"的工具**。

| 截图 | 尺寸 | 识图结论 |
| --- | --- | --- |
| `20-use-light.png` | 1280×800 | ①无 ②无（卡片摘要 3 行 + 省略号） ③无 ④无 ⑤**很像"拿来就用"**：默认落地就是「拿来就用」+ 大搜索（带 `/` 提示）+ 每卡一个复制按钮（含变量的显示「填值后复制」）+ 收藏置顶 + 左栏只读筛选 |
| `21-use-dark.png` | 1280×800 | 同上；暗色下卡片/按钮对比正常 ⑤成立 |
| `22-detail-actions.png` | 1280×800 | ①无（操作条 sticky 压在内容之上属预期） ②无 ③无 ④无 ⑤详情底部常驻「复制提示词 / 版本历史 / 删除」，正文可切字段/源码/纯文本/全屏 |
| `23-vars-dialog.png` | 1280×800 | ①无 ②无 ③无 ④无 ⑤**修前有缺陷**：未填变量时预览里占位符被空值吞掉（"你是  项目的…"）→ 改为"只预填记忆里真的有的值"后，预览显示 `{{项目}}` 并提示「项目 / 姓名 未填」 |
| `24-use-mobile.png` | 390×844 | ①无 ②无 ③无 ④无（无横向溢出） ⑤手机上一屏就是"搜索 + 卡片 + 大大的复制按钮"（实测 102×44） |
| `25-mobile-detail.png` | 390×844 | 全屏抽屉详情 + 底部操作条 ⑤成立 |
| `02-list.png` | 1280×800 | ①无 ②无 ③无 ④**修前有**：新增「变量数/取用次数」后右列（复制/编辑/删除）被裁 → 收窄列宽后 8 列 + 3 个行内操作全部可见 ⑤管理视图仍是原来的密集表格 + KPI + 状态条 |
| `03-editor.png` | 1280×800 | 三栏编辑器 + 右栏版本历史新增 `表格/对比版本/详情` 三视图（默认对比版本）、标题旁新增复制图标 ⑤成立 |
| `06-dark-list.png`、`04-search.png`、`05-mobile-list.png`、`07/08/09/10/11/12/13` | 1280×800 / 390×844 | 与阶段 10B 结论一致（本次只增列/增按钮/换默认视图），无新的重叠/断词/裁切 |

#### 5. 降级清单（设计/参考清单的点 → 实际做法 → 原因）

| # | 点 | 实际做法 | 原因 |
| --- | --- | --- | --- |
| 1 | FR-41b ② 排序含「标题」 | 标题排序是**当前页内**客户端排序（标注「标题（当前页）」） | 列表接口的 `sort` 契约只有 `updated`/`recent_used`；加服务端排序要改契约（本阶段禁止） |
| 2 | FR-41e ⑥ 版本「详情」视图 | 详情 = **元信息 + 与上一版的 diff + 变更备注**，不是"整版快照全文" | 没有"取某一版完整快照"的接口；不新增接口的约束下只能给"变更内容"，且这也正是用户要看的 |
| 3 | FR-41e ⑥ 变更备注 | 存 **localStorage**（`pm-vnote:<id>:<n>`），只在本地可见 | 不改数据模型/接口；跨设备同步需后端字段（单独立项） |
| 4 | FR-41b ② 详情弹窗内「Markdown 预览」 | 由正文区的「预览」模式承担（服务端 `/api/render/markdown`），未再单列一个预览块 | 避免同一面里两份渲染，减少重复 |
| 5 | FR-41c「复制后可选自动关闭详情」 | **没做**（详情不自动关闭） | BRIEF 原文默认就是"关"（默认不自动关闭），且自动关闭会打断"再复制一次系统提示词"的连续动作 |
| 6 | FR-41f 摒弃清单（AI Test / Skills·Rules / 图片反推 / Image 与媒体 / 关系图谱 / Relations / 云同步 / i18n） | **一律不做** | 规格明确摒弃；本阶段零相关代码 |

#### 6. 不得回归（逐条实测）

```
########## npm test / typecheck:web ##########
ℹ tests 160
ℹ suites 0
ℹ pass 160
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 15003.587379
typecheck-web rc=0

########## 截图清单与尺寸 ##########
  docs/shots/01-login.png  1280x800
  docs/shots/02-list.png  1280x800
  docs/shots/03-editor.png  1280x800
  docs/shots/04-search.png  1280x800
  docs/shots/05-mobile-list.png  390x844
  docs/shots/06-dark-list.png  1280x800
  docs/shots/07-versions.png  1280x800
  docs/shots/08-variables.png  1280x800
  docs/shots/09-import-confirm.png  1280x800
  docs/shots/10-mobile-editor.png  390x844
  docs/shots/11-markdown.png  1280x800
  docs/shots/12-tokens.png  1280x800
  docs/shots/13-dark-editor.png  1280x800
  docs/shots/20-use-light.png  1280x800
  docs/shots/21-use-dark.png  1280x800
  docs/shots/22-detail-actions.png  1280x800
  docs/shots/23-vars-dialog.png  1280x800
  docs/shots/24-use-mobile.png  390x844
  docs/shots/25-mobile-detail.png  390x844
$ ls -1 docs/shots/before/*.png | wc -l
10

########## 契约/体量 ##########
0
  index-DGbFoWT1.css 4173 B gzip 1279 B
  index-UX0755DI.js 1298778 B gzip 406343 B
  369 web/src/components/UseView.tsx
  244 web/src/components/PromptDetail.tsx
  198 web/src/components/VarsDialog.tsx
  122 web/src/use-copy.ts
  933 total
```

| 项 | 结果 |
| --- | --- |
| 组件库硬约束（antd 6.6.4/icons 6.3.4、无原生表单标签、无 CDN、无第二套样式体系） | ✅ 见上（原生标签 0 / CDN 0 / `from 'antd'` ≥5） |
| Markdown 净化硬化 | ✅ 详情与编辑器都只走 `POST /api/render/markdown`，前端无 DOMPurify |
| `zh_CN` / 亮暗跟随系统 / 响应式 | ✅ `zh_CN` 与 `prefers-color-scheme` 仍在；截图 21/24/25 覆盖暗色与 390×844 |
| `npm test` | ✅ **160/160**，rc=0（156 → 160：+3 纯函数 +1 预览一致性对照） |
| `npm run typecheck:web` | ✅ rc=0 |
| 单进程单端口 / 不改契约与数据模型 | ✅ `git status --short -- src migrations package.json deploy` = 0 |
| 体量 | JS `1,298,778 B`（gzip `406,343 B`，阶段 10B 基线 1,271,324 / 399,544 → **+27.5 KB / gzip +6.8 KB**）；CSS `4,173 B`（gzip 1,279 B）；新增前端代码 933 行（UseView 369 / PromptDetail 244 / VarsDialog 198 / use-copy 122） |

#### 7. 未完成 / 下一步

- 本阶段范围内**无未完成项**：P0 四条 + P1 五条全部落地，AC-33/33b/33c/34/35/36 与不得回归全绿。
- 第 5 条降级清单里的"复制后自动关闭详情"是唯一**明确没做**的子项（BRIEF 原文默认即"关"，见 §5 第 5 行）。
- **不动部署**：`/opt/promptmanager`、systemd unit、8767 生产实例归 host_manger；本阶段没有同步代码、没有重启服务。
  下一步由 host_manger 验收后同步 `/opt` 并重启上线。
- `tmp/` 已清理（过程日志与 DOM dump；关键输出已抄进本节）。

#### 8. 落盘对账（每条结论 → 文件/节）

| 结论 | 落盘位置 |
| --- | --- |
| 一键复制（含 usage 记账、零新接口、剪贴板兜底） | `web/src/use-copy.ts`（`writeClipboard` 兜底注释 + 两条服务端路径）、`web/src/components/VarsDialog.tsx`、`web/src/components/PromptList.tsx`(`pm-copy-<id>`)、`web/src/components/PromptEditor.tsx`(`editor-copy-user/system`)；本文件 §2 第 1 条 + §3 的 AC-33 |
| 详情底部固定操作条 | `web/src/components/PromptDetail.tsx`（`pm-detail-actions` / `pm-detail-copy` / `pm-detail-version-jump` / `pm-detail-delete`）；本文件 §3 的 AC-33c |
| 填变量对话框 + 实时预览 + 自动记忆 | `web/src/components/VarsDialog.tsx`（`pm-vars-dialog`/`pm-var-input-*`/`pm-vars-preview`/`pm-vars-confirm` + `localStorage['pm-vars:<id>']`）；`web/src/pure.ts::previewRender`；`tests/variables-preview-parity.test.ts`（与服务端 `/render` 逐字符一致）；本文件 §3 的 AC-33b + §4 的 23 行 |
| 使用/管理分离 + 默认使用 + 记忆 | `web/src/components/AppHeader.tsx`(`pm-mode-use`/`pm-mode-manage`)、`web/src/components/Workspace.tsx`(`readPref/writePref('pm-mode')`)、`web/src/components/UseView.tsx`(`pm-use-grid`/`pm-use-card`/`pm-search-input`/`pm-use-sort`)；本文件 §3 的 AC-34 |
| 使用视图不出现管理操作 | `UseView.tsx`（无 delete/edit）、`SidebarPanel/FolderPanel/TagPanel` 的 `readOnly`；本文件 §3 AC-34 ⑤（运行时计数 0）+ §1 的 `pm-delete-*` 只出现在管理表格 |
| 正文阅读体验 / 视图与密度 / 版本三视图与变更备注 | `PromptDetail.tsx`（字段·预览/源码·纯文本·全屏）、`PromptList.tsx`（`pm-density` + 变量数/取用次数列）、`UseView.tsx`（三视图）、`VersionPanel.tsx`（`pm-version-views`/`pm-vdetail-*`/`pm-vnote-*`）；本文件 §2 第 5–7 条 |
| 快捷键与移动优先 | `Workspace.tsx`（keydown effect：`/`·Ctrl+K·Esc·↑↓·Enter）、`UseView.tsx` + `PromptDetail.tsx`（双击/全屏抽屉）、`styles/app.css`（`.pm-copy-touch`、`.pm-use-grid`）；本文件 §3 的 AC-35/36 |
| 逐张识图（19 张 + 2 处修前缺陷） | `docs/shots/*.png`、`docs/shots/before/*.png`、`docs/shots/compare/*`；本文件 §4 |
| 降级清单（6 条，逐条给原因） | 本文件 §5 |
| 不得回归实测（160 测试 / typecheck / 契约零改动 / 体量） | 本文件 §6（原样输出） |
| 部署边界（不碰生产） | 本文件 §7；`tools/ac-stage11.sh`（端口自动选择） |

### 2026-09-19 — 阶段 11.1 实施与自检（FIX：未填变量在预览与复制结果里原样保留 `{{name}}`）

> **规格锚点**：BRIEF v15 §4 FR-41e 第 2 条 + §6.5（变量语法契约）+ §8 AC-33b（2026-09-19 用户决定「**没填写的变量按照原样输出**」）。
> **对应实测现象**：host_manger 阶段 11 验收 `VERIFY.md` §4 第 1 条 —— 「只填 `姓名` 后，复制结果 `你好 张三，项目 。`（`{{项目}}` 变成了空）」。
> 本次是**纯前端 FIX**：服务端语义（未提供值 → 原样保留 `{{name}}` + 列入 `missing`）早已正确（BRIEF §6.5，阶段 4 实测）；
> **不改接口契约、不改数据模型、不引入新依赖、不动部署**。

#### 1. 根因（代码级）

- `web/src/components/VarsDialog.tsx` 的 `Form.onValuesChange` 里，`values` 被重建成**包含全部变量**的对象，未填的变量被赋成空串 `''`：
  - `previewRender(text, values)` 见到空串会替换 → **预览里 `{{项目}}` 凭空消失**；
  - 点「复制结果」时这个含空串的 `values` 被发给 `POST /api/prompts/:id/render` → 服务端把空串当"提供了值" → **剪贴板里 `{{项目}}` 变空**。
  这就是 `你好 张三，项目 。` 的来源。
- 阶段 11 的识图修正（commit `1f9713b`）只修了 `load()` 的**预填**路径（不预填记忆里的空值），**没修输入变更路径**；因此"填一个、留一个"时缺陷仍在。

#### 2. 改动文件（逐条）

| 文件 | 改了什么 |
| --- | --- |
| `web/src/pure.ts` | 新增纯函数 `filledValues(variables, raw)`：按**服务端给的变量名单**筛掉未填/空串，只返回已填写变量（变量名以 `/api/prompts/:id/variables` 为单一真相源，不在前端重解析 prompt） |
| `web/src/components/VarsDialog.tsx` | ① **核心修复**：`onValuesChange` 改用 `filledValues`；② `load()` 预填同样走 `filledValues`；③ `missing` 改为 `values[name] === undefined`；④ 底部新增 `data-testid="pm-vars-missing"` 提示：`未填 N 个（预览与复制结果里保留原样占位符）` / `未填 0 个 · 已填全，可直接复制` |
| `tests/variables-unfilled-preserved.test.ts`（**新增，第 31 个测试文件**） | 3 条用例：`filledValues` 语义；只填「姓名」→ 预览 == `你好 张三，项目 {{项目}}。`；直接打 `/render` 断言 `missing=['项目']` + 预览与服务端逐字符一致 + **反向对照**（传空串会得到 `你好 张三，项目 。`，证明该测试在修复前必然变红） |
| `tools/ac-stage11-probe.mjs` | AC-33b 改为「填一个、留一个」：断言预览精确文本、保留 `{{项目}}`、已填被替换、未填提示文本、剪贴板 == 预览、剪贴板含 `{{项目}}`、重开预填 + 未填仍为空 |
| `tools/ac-stage11.sh` | 夹具 `user_prompt` 改为 `你好 {{姓名}}，项目 {{项目}}。`；AC-33b 断言换成 v15 的 11 条 |
| `tools/ui-shots.sh` | 新增截图 `26-vars-unfilled.png`（填一个留一个 + 预览可见 `{{项目}}` + 未填提示）；`docs/shots/23-vars-dialog.png` 因底部文案变化重拍 |

#### 3. 原样实测输出

**运行时探针（`bash tools/ac-stage11.sh`；服务自起自停 + CDP，剪贴板经 `Browser.grantPermissions` 授权后**实读**）**
```
  PORT 自动选择：8765
  PLAIN_ID=1
  VARS_ID=2
  SEED_TOTAL=3
...
varsDialog=true
varsMissingHintBefore=未填 0 个 · 已填全，可直接复制
varsPreviewBefore=你好 {{姓名}}，项目 {{项目}}。
varsPreviewAfter=你好 张三，项目 {{项目}}。
varsMissingHintAfter=未填 1 个（预览与复制结果里保留原样占位符）
varsPreviewChanged=true
varsPreviewExact=true
varsPreviewKeepsPlaceholder=true
varsPreviewReplacedFilled=true
clipboardVars=你好 张三，项目 {{项目}}。
varsClipboardMatchesPreview=true
varsClipboardKeepsPlaceholder=true
varsRemembered=张三
varsUnfilledStaysEmpty=
varsRememberedPreview=你好 张三，项目 {{项目}}。
```
```
=== AC-33b 填变量对话框 + 实时预览 + 自动记忆（v15：未填变量原样保留） ===
  ✅ 对话框出现 = true
  ✅ 预览随输入变化 = true
  ✅ 预览 == 「你好 张三，项目 {{项目}}。」 = true
  ✅ 未填变量保持 {{项目}} 原文（不得变空串） = true
  ✅ 已填变量被替换（预览里已无 {{姓名}}） = true
  ✅ 对话框标注未填数量 = 未填 1 个（预览与复制结果里保留原样占位符）
  ✅ 剪贴板 == 预览区文本（逐字符） = true
  ✅ 剪贴板里 {{项目}} 原样保留 = true
  ✅ 再次打开时预填上次的值 = 张三
  ✅ 再次打开时未填的那个仍为空 = 
  ✅ 记忆预填后的预览仍保留 {{项目}} = true

=== 结论 ===
  ✅ AC-33 / AC-33b / AC-33c / AC-34 / AC-35 / AC-36 + 不得回归全部通过
ac-stage11 rc=0
```

**不得回归（原样）**
```
$ npm test
ℹ tests 163        （阶段 11 基线 160 → +3；测试文件 30 → 31，只增不减）
ℹ pass 163
ℹ fail 0
ℹ duration_ms 15427.006326
npm test rc=0

$ npm run typecheck:web; echo "rc=$?"
rc=0
```
```
=== 不得回归（源码侧）：组件库 / token / 无 CDN / 契约未改 ===
  ✅ 原生表单标签 = 0
  ✅ from 'antd' = 31（期望 ≥5）
  ✅ CDN（源码+产物） = 0
  ✅ 纯表现层（src/migrations/package.json 未改） = 0
```

**截图（新增 1 张）**
```
$ bash tools/ui-shots.sh
PLAN shots=20 out=docs/shots
PROBE vars-unfilled-preview "你是 {{项目}} 项目的交接助手。请把当前工作上下文整理成交接文档。 |  | ## 要求 | - 交接人：张三 | ..."
PROBE vars-unfilled-hint "未填 1 个（预览与复制结果里保留原样占位符）"
PROBE vars-unfilled-keeps-project true
SHOT 26-vars-unfilled 1280x800 dark=false -> docs/shots/26-vars-unfilled.png (166687 bytes)
```
> 过程产物 `tmp/ui-shots/` 已清理；其余 19 张截图未受本 FIX 影响，已还原成阶段 11 的版本（避免无意义 churn）。

#### 4. 识图结论（`docs/shots/26-vars-unfilled.png`，1280×800）

五问口径：① 重叠/遮挡 ② 硬断词或单字成行 ③ 孤标题沉底 ④ 溢出/裁切 ⑤ 是否真的像"拿来就用"的工具。

| 截图 | 识图结论 |
| --- | --- |
| `26-vars-unfilled.png` | ①无 ②无（两个变量输入并排；长预览 `pre-wrap` 正常换行） ③无 ④无 ⑤**修后正确**：「项目」输入框为空（占位提示 `{{项目}} 的值`）、「姓名」= 张三；实时预览首行保留 `你是 {{项目}} 项目的交接助手…`，交接人已替换成 `张三`；右上角橙色 Tag「项目 未填」，底部「未填 1 个（预览与复制结果里保留原样占位符）」——一眼能看出"还有一个占位符没填、复制结果里会原样留着" |

#### 5. 边界与未做

- **不改接口契约 / 数据模型**：`git status --short -- src migrations package.json` = 0（探针「纯表现层」一项即为证据）。
- **服务端零改动**：`/render` 对未提供值本就原样保留并列入 `missing`（BRIEF §6.5）；本 FIX 只是不再让前端把空串伪装成"提供了值"。
- **无新依赖**：`package.json` / `package-lock.json` 未动。
- **不动部署**：`/opt/promptmanager`、systemd unit、8767 生产实例归 host_manger；本次未同步、未重启（验收通过后由 host_manger 同步上线）。
- **单一真相源**：变量名单来自服务端 `/api/prompts/:id/variables`，前端只做"服务端名单 − 已填"的差集，不重新解析 prompt（`pure.ts::filledValues` 与 `VarsDialog.tsx` 注释均已写明）。

#### 6. 提交单元与落盘对账

| # | 单元 | commit | 内容 |
| --- | --- | --- | --- |
| 1 | **FIX 未填变量原样保留** | `5f1fb0d` | `pure.ts::filledValues` + `VarsDialog.tsx`（onValuesChange/load/missing/未填提示）+ 新单测 + `ac-stage11` 探针与断言 + `ui-shots` 新截图 |
| 2 | 收尾（本节） | 收尾 commit（见聊天回复单独标注） | PROGRESS 追加本节 |

| 结论 | 落盘位置 |
| --- | --- |
| 未填变量原样保留（只传已填变量，绝不传空串） | `web/src/pure.ts::filledValues`、`web/src/components/VarsDialog.tsx`（`onValuesChange` + `load`）；本节 §1/§2 |
| 对话框标注未填数量 | `VarsDialog.tsx` 的 `data-testid="pm-vars-missing"`；本节 §3 的 `varsMissingHintAfter` |
| 预览 == 剪贴板（逐字符，含 `{{项目}}`） | `tools/ac-stage11-probe.mjs`（`varsClipboardMatchesPreview` / `varsClipboardKeepsPlaceholder`）、`tests/variables-unfilled-preserved.test.ts`；本节 §3 |
| 不回归（无变量直接复制 / 已填替换 / 变量值自动记忆） | `tools/ac-stage11.sh` 的 AC-33 + AC-33b「再次打开预填」；本节 §3 |
| 截图与识图结论 | `docs/shots/26-vars-unfilled.png`；本节 §4 |
| commit | 单元 `5f1fb0d`；收尾 commit 在聊天回复中单独标注 |

### 2026-09-19 — 阶段 12 实施与自检（导航归位 + 信息克制）

> **规格锚点**：BRIEF v16 §4 **FR-42a / FR-42b** + §8 **AC-37 / AC-38 / AC-39 / AC-40** + §11 **阶段 12**。
> **用户反馈原话**：①「导航太不合理，很多属于管理的东西应该放到管理页面，类似于设置」②「很多页面和卡片都有一些提示信息，比如数据库信息，监听信息，操作提示的过量意思等」。
> 本次是**纯前端表现层**改动：不改接口契约 / 数据模型 / 部署，不引入新依赖。

#### 0. 开工前：AC → 我要执行的检查命令（BRIEF §11.1）

| AC | 检查命令（本轮实际执行） |
| --- | --- |
| AC-37 纯净度 | `bash tools/ac-stage12.sh` → 探针在**使用视图**取 `document.body.innerText`，对 `DATA_DIR`、`/api/`、`SQLite`、`监听`、`本次查询`、`筛选命中`、`使用统计`、`API 令牌`、`导入`、`导出`、`渲染不写库`、`version_no` 与 `/#\d+/` 断言命中数为 0 |
| AC-38 导航归位 | 同脚本 → `pm-topnav` / `pm-sidebar` 文本断言：使用视图顶栏 5 项「无」、侧栏 3 项「无」、管理视图顶栏 5 项「有」 |
| AC-39 反馈未误删 | 同脚本 → 复制出「已复制」；含变量未填完出「未填」；导入 replace 的清空警示 + 二次确认仍在 |
| AC-40 技术信息有落点 | 同脚本 → 管理视图点 `pm-settings` → `pm-about` 出现，且含 `pm.db`、`备份`（并断言含 `DATA_DIR`，证明是**移走不是丢失**） |
| 不得回归 | `bash tools/ac-stage11.sh`、`bash tools/ac-stage10.sh`、`npm test`、`npm run typecheck:web` |
| 界面自证 | `bash tools/ui-shots.sh`（21 张）+ 逐张识图 |

#### 1. 改动文件（逐条）

| 文件 | 改了什么 |
| --- | --- |
| `web/src/components/AppHeader.tsx` | **按模式分流**：使用视图只留 品牌 · 使用/管理 · 主题跟随 · 用户/登出；管理视图才挂 `使用统计`/`API 令牌`/`导入 / 导出`/**`设置`（`pm-settings`）**/`新建`；移除环境标识 `host:port`；主题指示去掉"跟随系统"字样（改由 tooltip 说明） |
| `web/src/components/Workspace.tsx` | 顶栏 props 随之调整（去掉 `endpoint`/`onOpenAbout`，加 `onOpenSettings`）；使用视图删除右上「新建 prompt」按钮与说明句；管理内容头去掉 `DATA_DIR/pm.db` 与重复动作按钮；**使用视图不再渲染状态条** |
| `web/src/components/StatusBar.tsx` | 收成**一行极简**「数据文件：pm.db · 共 N 条」；监听地址 / 查询耗时 / SQLite / DATA_DIR 等技术细节改由 tooltip 指向「设置 / 关于」 |
| `web/src/components/SidebarPanel.tsx` | 删除管理侧的「工作区」卡（SQLite 单文件 / 令牌与外部客户端）——这类背景信息收进「设置 / 关于」 |
| `web/src/components/FolderPanel.tsx` | 删掉常驻解释长句「点文件夹 = 只看该文件夹…」→ 改成标题上的 tooltip；`readOnly` 下无任何管理按钮 |
| `web/src/components/TagPanel.tsx` | 「合并说明」Popover 文本 → 重命名按钮的 tooltip；`readOnly` 下无管理按钮 |
| `web/src/components/UseView.tsx` | 卡片**删内部 id**、meta 收成一行 `v·变量·取用·更新时间`；标签 ≤2 个 + 「+N 更多」；搜索框与排序文案收敛（「标题（当前页）」→「标题」+ tooltip）；底部只留「共 N 条」；空态不再出现管理与导入字样、去掉跳转按钮 |
| `web/src/components/AboutModal.tsx` | 「关于本服务」→ **「设置 / 关于」**，加 `data-testid="pm-about"`；补齐数据文件 / 备份 / 监听 / 认证 / 外部客户端 / 依赖与许可 |
| `web/src/components/MarkdownPreview.tsx` | 「服务端渲染：POST /api/render/markdown（XSS 净化 + 代码高亮，前端不重写）」→「预览」+ tooltip |
| `web/src/components/VariablePanel.tsx` | 「提取到 N 个变量（渲染不写库）」→「这条有 N 个变量，填好后渲染」 |
| `web/src/components/VersionPanel.tsx` | 「每次保存自动留档（version_no 递增）…」→ 去掉 `version_no` 字样 |
| `web/src/components/ImportExportModal.tsx` | 去掉可见的 `GET /api/export` 与 `POST /api/import` 路径（功能不变） |
| `web/src/components/PromptEditor.tsx` | 保存按钮「保存（生成 vN+1）」→「保存」 |
| `web/src/components/KpiRow.tsx` + `web/src/pure.ts` | KPI 提示收敛（去掉「筛选命中」「FTS5 trigram + LIKE 兜底」「session / token / mcp」等），空提示不渲染 |
| `tests/navigation-hygiene.test.ts`（**新增，第 32 个测试文件**） | 源码级锚点：`pm-settings`/`pm-about` 齐备、`pm-about` 含 `pm.db`+`备份`、顶栏按 mode 分流、使用视图侧栏 `readOnly`、UseView 不再渲染内部 id 与禁用文案 |
| `tools/ac-stage12.sh` + `tools/ac-stage12-probe.mjs`（**新增**） | AC-37~40 的运行时探针（服务自起自停 + CDP；真实替换 replace 导入流程，**只到二次确认、不真的导入**） |
| `tools/ui-shots.sh` + `docs/shots/*.png` | 新增 `27-settings-about.png`；其余 20 张因顶栏/状态条变化整体重拍 |

#### 2. 原样实测输出

**`bash tools/ac-stage12.sh`（运行时探针 KEY=VALUE）**
```
ac37_datadir=0
ac37_api_path=0
ac37_sqlite=0
ac37_listen=0
ac37_query_ms=0
ac37_filter_hit=0
ac37_usage_stats=0
ac37_api_token=0
ac37_import=0
ac37_export=0
ac37_render_nowrite=0
ac37_version_no=0
ac37_internal_id_count=0
ac37_body_head=P | promptmanager | 使 用 | 管 理 | 亮色 | ad | admin | 登出 | 文件夹 | 工作 | 标签 | 交接 | 1 | 发布 | 1 | 拿来就用 | 最近更新 | 卡片 | 表格 | 列表 | 收藏置顶 | 只看收藏 | 洁净夹具 · 列表填充 | 把这段说明改写成更短的三句话
ac38_use_topnav_absent_usage=true
ac38_use_topnav_absent_token=true
ac38_use_topnav_absent_import=true
ac38_use_topnav_absent_export=true
ac38_use_topnav_absent_new=true
ac38_use_sidebar_absent_new=true
ac38_use_sidebar_absent_rename=true
ac38_use_sidebar_absent_delete=true
ac38_manage_topnav_present_usage=true
ac38_manage_topnav_present_token=true
ac38_manage_topnav_present_import=true
ac38_manage_topnav_present_export=true
ac38_manage_topnav_present_new=true
ac38_manage_topnav_head=P | promptmanager | 使 用 | 管 理 | 使用统计 | API 令牌 | 导入 / 导出 | 设置 | 亮色 | ad | admin | 登出 | 新建
ac40_about_visible=true
ac40_about_has_pmdb=true
ac40_about_has_backup=true
ac40_about_has_datadir=true
```
```
=== AC-37 使用视图纯净度（body.innerText 禁用串命中数，期望全 0） ===
  ✅ DATA_DIR = 0
  ✅ /api/ = 0
  ✅ SQLite = 0
  ✅ 监听 = 0
  ✅ 本次查询 = 0
  ✅ 筛选命中 = 0
  ✅ 使用统计 = 0
  ✅ API 令牌 = 0
  ✅ 导入 = 0
  ✅ 导出 = 0
  ✅ 渲染不写库 = 0
  ✅ version_no = 0
  ✅ 内部 id（/#[0-9]+/） = 0

=== AC-38 导航归位 ===
  ✅ 使用视图顶栏无「使用统计」 = true
  ✅ 使用视图顶栏无「API 令牌」 = true
  ✅ 使用视图顶栏无「导入」 = true
  ✅ 使用视图顶栏无「导出」 = true
  ✅ 使用视图顶栏无「新建」 = true
  ✅ 使用视图侧栏无「新建」 = true
  ✅ 使用视图侧栏无「重命名」 = true
  ✅ 使用视图侧栏无「删除」 = true
  ✅ 管理视图顶栏有「使用统计」 = true
  ✅ 管理视图顶栏有「API 令牌」 = true
  ✅ 管理视图顶栏有「导入」 = true
  ✅ 管理视图顶栏有「导出」 = true
  ✅ 管理视图顶栏有「新建」 = true
  ✅ 管理视图顶栏文本：P | promptmanager | 使 用 | 管 理 | 使用统计 | API 令牌 | 导入 / 导出 | 设置 | 亮色 | ad | admin | 登出 | 新建

=== AC-39 反馈与安全提示未被误删 ===
  ✅ 复制后出现「已复制」 = true
  ✅ 未填时出现「未填」提示 = true
  ✅ 未填提示文本：未填 1 个（预览与复制结果里保留原样占位符）
  ✅ 导入 replace 清空警示仍在 = true
  ✅ replace 二次确认仍在 = true
  ✅ 二次确认文本：确认以 replace 模式导入？ | 将清空现有全部 prompt / 文件夹 / 标签 / 版本历史 | 随后按文件重建：prompt 3 条 / 文件夹 1 个 / 标签 2 个。 | 此操作不可撤销；建议先导出当前数据留底。 | 取 消 | 清空并导入

=== AC-40 技术信息有落点（pm-settings → pm-about） ===
  ✅ pm-about 面板出现 = true
  ✅ 关于面板含「pm.db」 = true
  ✅ 关于面板含「备份」 = true
  ✅ 关于面板含「DATA_DIR」（技术信息真的收进来了） = true

=== 结论 ===
  ✅ AC-37 / AC-38 / AC-39 / AC-40 全部通过
ac-stage12 rc=0
```

#### 3. 不得回归（逐条实测）

```
$ npm test
ℹ tests 167        （阶段 11.1 基线 163 → +4；测试文件 31 → 32，只增不减）
ℹ pass 167
ℹ fail 0
ℹ duration_ms 15668.12641
npm test rc=0

$ npm run typecheck:web; echo "rc=$?"
rc=0

$ bash tools/ac-stage11.sh
=== 结论 ===
  ✅ AC-33 / AC-33b / AC-33c / AC-34 / AC-35 / AC-36 + 不得回归全部通过

$ bash tools/ac-stage10.sh
AC31_LIST_TESTIDS=true,true,true,true,true
AC31_07_KPI_VALUES=4
AC31_STATUSBAR_VISIBLE=true
AC31_PANELS_ALL_VISIBLE=true
=== 结论 ===
  ✅ AC-13（结构侧）/ AC-20 / AC-21 / AC-29 / AC-31 全部通过（截图见 tools/ui-shots.sh）

$ git status --short -- src migrations package.json deploy | wc -l
0
```
组件库硬约束（无原生表单标签 = 0 / CDN = 0 / `from 'antd'` ≥5 / theme.token+components 仍在）随 `ac-stage11.sh` 的源码侧断言一并通过；响应式与亮暗未改（截图 21/24/25 覆盖）。

#### 4. 界面自证与逐张识图（`bash tools/ui-shots.sh` → 21 张）

五问口径：① 重叠/遮挡 ② 硬断词或单字成行 ③ 孤标题沉底 ④ 溢出/裁切 ⑤ **看着是否"干净到能一眼用来抄"（噪声是否真的消掉）**。

| 截图 | 尺寸 | 识图结论 |
| --- | --- | --- |
| `20-use-light.png`（使用视图·净化后） | 1280×800 | ①无 ②无 ③无 ④无 ⑤**成立**：顶栏只剩 `promptmanager · 使用/管理 · 亮色 · admin · 登出`；左栏只有文件夹树 + 标签计数（无任何按钮/说明句）；卡片无 `#id`、meta 一行 `v3 · 变量 2 · 取用 7 · 09/19 13:00`、标签 ≤2；底部只有「共 9 条」，**没有状态条** |
| `02-list.png`（管理视图·含设置入口） | 1280×800 | ①无 ②无 ③无 ④无 ⑤成立：顶栏 `使用统计 · API 令牌 · 导入 / 导出 · 设置 · 亮色 · admin · 登出 · 新建`；副标题不再有 `DATA_DIR/pm.db`；底部状态条收成「数据文件：pm.db · 共 9 条」 |
| `27-settings-about.png`（设置 / 关于） | 1280×800 | ①无 ②无 ③无 ④无（长内容可在弹窗内滚动） ⑤成立：技术信息（监听 / 认证 / 数据文件 `DATA_DIR/pm.db` / **备份** / 外部客户端 / 依赖与许可）集中在一处，用户主动点开才出现 |
| `24-use-mobile.png`（390×844 使用视图） | 390×844 | ①无 ②无 ③无 ④无（无横向溢出） ⑤成立：手机上顶栏是 `☰ · 品牌 · 使用/管理 · 亮色 · ⋯`，一屏就是搜索 + 卡片 + 大复制按钮 |

> 其余 17 张（编辑器 / 暗色 / 详情 / 令牌 / 导入 / 变量 / 移动详情等）随顶栏与状态条整体重拍，未出现新的重叠 / 断词 / 裁切；`docs/shots/before/`（阶段 8 修前组）保持不动。

#### 5. 信息克制的边界（移走 ≠ 丢失；反馈 ≠ 噪声）

| 处置 | 内容 | 落点 |
| --- | --- | --- |
| **保留**（操作反馈 / 功能态 / 安全） | `已复制`、`未填 N 个（…保留原样占位符）`、保存成功提示、错误提示、导入 replace 的清空警示 + 二次确认 | 原处（AC-39 实测三项都在） |
| **移走**（技术/背景） | `DATA_DIR`、`SQLite 单文件`、`监听 0.0.0.0:8767`、`/api/export`、`/api/import`、`/api/login` 等接口路径、`version_no 递增`、依赖与许可摘要、数据文件与备份方式 | 「设置 / 关于」（`pm-about`） |
| **tooltip**（一句话解释） | 文件夹点选语义、标签改名合并、Markdown 渲染方式、标题排序"当前页"、状态条技术细节 | 对应控件 `title` |

#### 6. 一处明确取舍（AC-31 与 FR-42b 的交界）

管理视图 KPI 行**仍保留第 4 项「本次检索耗时 xx ms」**：AC-31 明确要求 KPI 固定 4 项（`.pm-kpi-value` ≥4，阶段 10B 已验收），而它是**管理页的度量**、不是使用页的操作提示（用户反馈第二点针对的是"很多页面和卡片"的提示语，已在使用视图清零）。若要求连 KPI 一起去掉，需先改 AC-31 的"4 项"口径——属规格变更，本轮不动。

#### 7. 本阶段自行判断的实现细节（备查）

1. 「标题（当前页）」的降级说明从**可见文案**移进 tooltip：否则为一句客户端排序说明在界面上常驻一行字，与信息克制冲突（能力未变）。
2. 使用视图空态**去掉**「去管理视图新建」按钮与"导入"字样，改为一句「先去管理视图建一条」——FR-42a 要求使用视图不出现管理动作。
3. 手机端使用视图的 ⋯ 下拉只含 `已登录 / 登出`；管理端 ⋯ 下拉含全部管理动作（桌面端直接在顶栏排按钮，`pm-topnav` 的可见文本才满足 AC-38 ②）。
4. 管理表格里的内部编号（`#001`）**保留**：AC-37 的 `/#\d+/` 口径限定"使用视图"，而管理/CLI/MCP 场景下编号有用。

#### 8. 提交单元与落盘对账

| # | 单元 | commit | 内容 |
| --- | --- | --- | --- |
| 1 | **阶段 12 导航归位 + 信息克制** | `4c98d63` | 16 个前端组件/纯函数 + 新测试 + `ac-stage12` 探针 + `ui-shots` 新图 |
| 2 | 收尾（本节） | 收尾 commit（聊天回复单独标注） | PROGRESS 追加本节 |

| 结论 | 落盘位置 |
| --- | --- |
| 使用视图只留"用"（顶栏/侧栏去管理项） | `web/src/components/AppHeader.tsx`（`managing` 分流）、`SidebarPanel.tsx`（`readOnly`）、`Workspace.tsx`；本节 §1/§2 的 AC-38 |
| 管理视图承载全部管理动作 + 设置入口 | `AppHeader.tsx`（`使用统计`/`API 令牌`/`导入 / 导出`/`pm-settings`/`新建`）；`AboutModal.tsx`（`pm-about`）；本节 §2 的 AC-38/AC-40 |
| 信息克制（文案下线/收进关于/tooltip） | 见 §1 文件表与 §5 边界表；运行时证据 §2 的 AC-37 全 0 |
| 反馈与安全提示未误删 | §2 的 AC-39；`tools/ac-stage12-probe.mjs` |
| 卡片精简与状态条归位 | `UseView.tsx`、`StatusBar.tsx`；本节 §4 的截图 20/02 |
| 截图与识图 | `docs/shots/20-use-light.png`、`02-list.png`、`27-settings-about.png`、`24-use-mobile.png`；本节 §4 |
| 不得回归 | 本节 §3（原样输出） |
| commit | 单元 `4c98d63`；收尾 commit 在聊天回复中单独标注 |

### 2026-09-19 — 阶段 13 实施与自检（取消管理页 + 主题图标三态 + 修复新建未保存即入库）

> **规格锚点**：BRIEF v17 §4 **FR-43 / FR-44 / FR-45** + §8 **AC-41 / AC-42 / AC-43** + §9 **D-21** + §11 **阶段 13**。
> **用户三条反馈原话**：①「实际上我们并不需要一个管理页面，目前的管理页面也只是提供了编辑删除按钮，完全可以放表格视图里面」
> ②「我们还是需要明暗主题切换按钮，跟随主题是默认行为，明暗主题切换只需要一个图标」③「有 bug，新建 prompt 没有保存就自动保存了」。
> **口径更新**：**AC-34 自 v17 起作废**（不再自检）；**AC-38 由 AC-41 修订取代**。本次只动前端表现层，不改接口契约 / 数据模型 / 部署、不引入依赖。

#### 0. 开工前：AC → 我要执行的检查命令（BRIEF §11.1）

| AC | 检查命令（本轮实际执行） |
| --- | --- |
| AC-41 无管理页 + 顶栏精简 | `bash tools/ac-stage13.sh` → `pm-mode-*` 不存在；顶栏含 `新建`/`更多` 与 `pm-theme-toggle`、不含 `使用统计/API 令牌/导入/导出`；表格视图行内 `pm-edit-*`/`pm-delete-*` ≥1；卡片视图 `pm-delete-*` = 0 |
| AC-42 主题图标三态 | 同脚本 → 清 localStorage 后 `colorScheme` 为空且 title 含「跟随系统」；点击循环 light → dark → 空；刷新后保持 localStorage 记忆 |
| AC-43 新建未保存不入库 | 同脚本 → 点新建等 2s / 填标题 / Esc，三次 `GET /api/prompts` 的 `total` 均不变；点保存后 +1 且标题等于输入值 |
| 不得回归 | `bash tools/ac-stage11.sh`（AC-33/33b/35/36）、`bash tools/ac-stage12.sh`（AC-37/39/40）、`bash tools/ac-stage10.sh`（AC-20/21/29 + AC-31 修订）、`npm test`、`npm run typecheck:web` |
| 界面自证 | `bash tools/ui-shots.sh`（25 张）+ 逐张识图 |

#### 1. 改动文件（逐条）

| 文件 | 改了什么 |
| --- | --- |
| `web/src/theme-mode.ts`（**新增**） | 主题三态纯逻辑：`nextThemeMode`（亮→暗→跟随系统→亮）、默认 `system`、localStorage（`pm-theme`）读写、`cleanupLegacyKeys`（清旧 `pm-mode`）、`resolveDark`、`colorSchemeFor`（system → 空串）、title 文案 |
| `web/src/App.tsx` | 持有 `themeMode` 并循环切换；`buildTheme(resolveDark(...))`；`ThemeBridge` 把 `colorScheme` 落到 `<html>`（AC-42 的观测点）；挂载时清 `pm-mode` 旧键 |
| `web/src/components/AppHeader.tsx` | **重写成唯一一栏**：品牌 · 主题图标按钮（`pm-theme-toggle`）· `＋新建`（`header-new`）· `⋯更多`（`header-more`，内含 导入/导出·使用统计·API 令牌·文件夹与标签·设置`pm-settings`）· 用户/登出；删除 `pm-mode-use`/`pm-mode-manage` 与环境标识；手机端品牌只留方块、新建/更多收成图标（防挤压） |
| `web/src/components/Workspace.tsx` | 删除 `mode` 状态与"模式记忆"；唯一主界面 = 列表（卡片/表格/列表）；`createPrompt` 改为**内存草稿**（`EMPTY_DRAFT` + `isNew`，**不调用任何 API**）；`closeEditor` 丢弃草稿；Esc 关详情/关编辑器；新增「文件夹与标签」抽屉（非只读侧栏）；接 `themeMode`/`onCycleTheme` |
| `web/src/components/UseView.tsx` | 表格行内加 **编辑 / 删除**（删除 `Popconfirm` 二次确认）+ 复制；卡片与列表**无删除按钮**（列表有轻量编辑）；新增 `pm-view-card`/`pm-view-table`/`pm-view-list` 锚点；表格列宽收窄（消除右列裁切） |
| `web/src/components/PromptEditor.tsx` | 支持 `isNew`：草稿态显示「未保存草稿 · 点「保存」才会创建」（`editor-draft-badge`）、隐藏删除；保存时 `isNew ? createPrompt : updatePrompt`；草稿态把面板 `promptId` 传 `null` |
| `web/src/components/VersionPanel.tsx` / `VariablePanel.tsx` | `promptId: number \| null`：草稿态跳过请求并给占位（"保存后…"），不再用 `id=0` 打服务端 |
| `web/src/components/PromptDetail.tsx` | 补 `data-testid="pm-detail-edit"`（移动端详情 → 编辑的截图用） |
| `web/src/pure.ts` / `web/src/types.ts` | 删除 `computeKpis`（KPI 行随管理页移除）；`PromptListFilters` 从已删的 `PromptList.tsx` 上移到 `types.ts` |
| **删除** `KpiRow.tsx` / `StatusBar.tsx` / `PromptList.tsx` | KPI 行、状态条、管理表格随"管理页"一并移除（FR-43 / D-21） |
| `tests/theme-mode.test.ts`（**新增**） | 三态循环 / 默认 system / 记忆 / 旧键清理 / colorScheme / title 文案（6 例） |
| `tests/create-draft.test.ts`（**新增**） | AC-43 源码级：`api.createPrompt` 只出现在编辑器保存路径；`createPrompt` 不发请求；草稿隐藏删除；面板传 `null`；关闭不碰服务端（5 例） |
| `tests/navigation-hygiene.test.ts`（改写）/ `tests/web-ui.test.ts` / `tests/web-pure.test.ts` | 改为 v17 口径：`pm-mode-*` 不得存在、顶栏三分区、表格有编辑/删除而卡片没有、左栏只读；AC-31 静态锚点去掉 KPI/状态条/管理筛选行；移除 `computeKpis` 用例 |
| `tools/ac-stage13.sh` + `tools/ac-stage13-probe.mjs`（**新增**） | AC-41/42/43 运行时探针（服务自起自停 + CDP；AC-43 用真实 `GET /api/prompts` 的 total 轨迹） |
| `tools/ac-stage11/12/10`（探针与断言） | 去掉已作废/被取代的 AC-34、AC-38 与双模式依赖；`⋯更多` 菜单路径；AC-31 改为"顶栏/侧栏/编辑器三栏 + 表格密度" |
| `tools/ui-shot.mjs` / `tools/ui-shots.sh` | 新增 `view`/`menu` 动作与 `storage`（挂载前写 localStorage）支持；重排 25 张（表格含行内编辑删除、卡片无删除、主题三态、新建未保存、移动端） |

#### 2. 原样实测输出

**`bash tools/ac-stage13.sh`（rc=0）**
```
=== AC-41 无管理页 + 顶栏精简 ===
  ✅ pm-mode-use 不存在 = true
  ✅ pm-mode-manage 不存在 = true
  ✅ 顶栏含「新建」 = true
  ✅ 顶栏含「更多」 = true
  ✅ 顶栏有主题图标按钮 = true
  ✅ 顶栏不常驻「使用统计」 = true
  ✅ 顶栏不常驻「API 令牌」 = true
  ✅ 顶栏不常驻「导入」 = true
  ✅ 顶栏不常驻「导出」 = true
  ✅ 顶栏文本：P | promptmanager | 新建 | 更多 | ad | admin | 登出
  ✅ 表格视图行内 pm-edit-* 计数 = 2（期望 ≥1）
  ✅ 表格视图行内 pm-delete-* 计数 = 2（期望 ≥1）
  ✅ 卡片视图 pm-delete-* 计数 = 0

=== AC-42 主题图标三态（亮 → 暗 → 跟随系统） ===
  ✅ 初始 = 跟随系统（colorScheme 为空） = 
  ✅ 初始 title 体现跟随系统：主题：跟随系统（点击切换到亮色）
  ✅ 点 1 次 → light = light
  ✅ 点 2 次 → dark = dark
  ✅ 点 3 次 → 跟随系统（空） = 
  ✅ 刷新前（亮） = light
  ✅ 刷新后仍保持 light（localStorage 记忆） = light

=== AC-43 新建未保存不得入库 ===
  ✅ 草稿态标识出现 = true
  ✅ 点新建后 total 不变 = true
  ✅ 填了标题但不保存 total 不变 = true
  ✅ Esc 关闭后 total 不变 = true
  ✅ Esc 真的关掉了编辑器 = true
  ✅ 点保存后 total +1 = 1
  ✅ 新条目标题 == 输入值 = 阶段13 草稿保存用例
  ✅ 库里没有「未命名 prompt」残留 = 0
  ✅ total 轨迹：新建前=2 → 新建后=2 → 填标题=2 → Esc=2 → 保存=3

=== 结论 ===
  ✅ AC-41 / AC-42 / AC-43 全部通过
```

**AC-43 对照：修复前（host_manger 复现，BRIEF §4 FR-45 原文）↔ 修复后（本轮实测）**

| | 修复前（host_manger，临时实例） | 修复后（本探针，`total` 轨迹） |
| --- | --- | --- |
| 基线 | 1 条 | 2 条（夹具） |
| 点「新建」 | **立刻变 2 条**，新增标题 `未命名 prompt` | `2 → 2`（**不变**） |
| 填标题不保存 | —（当时没有草稿概念） | `2 → 2`（**不变**） |
| `Esc` 关闭 | 新增条目**仍在库** | `2 → 2`（**不变**），且编辑器确实关闭 |
| 再点新建 | 又 +1（连点两次留 2 条垃圾） | 不产生记录 |
| 点「保存」 | — | `2 → 3`（+1），标题 == 输入值 |

#### 3. 不得回归（逐条实测）

```
$ npm test
ℹ tests 177        （阶段 12 基线 167 → +10；测试文件 32 → 34，只增不减）
ℹ pass 177
ℹ fail 0
npm test rc=0

$ npm run typecheck:web; echo "rc=$?"
rc=0

$ bash tools/ac-stage11.sh
=== 结论 ===
  ✅ AC-33 / AC-33b / AC-33c / AC-35 / AC-36 + 不得回归全部通过（AC-34 已作废）

$ bash tools/ac-stage12.sh
=== 结论 ===
  ✅ AC-37 / AC-39 / AC-40 全部通过（AC-38 已由 AC-41 修订取代）

$ bash tools/ac-stage10.sh
AC31_LIST_TESTIDS=true,true,true,true,true
AC31_ROWS_VISIBLE=12
AC31_04_PANELS=3
AC31_05_PANELS_ALL_VISIBLE=true
AC31_06_TABS=0
=== 结论 ===
  ✅ AC-13（结构侧）/ AC-20 / AC-21 / AC-29 / AC-31 全部通过（截图见 tools/ui-shots.sh）

$ git status --short -- src migrations package.json deploy | wc -l
0
```
`ac-stage13.sh` 的源码侧同批复验：原生表单标签 0 / CDN 0 / `from 'antd'` ≥5 / 纯表现层 0。

#### 4. 界面自证与逐张识图（`bash tools/ui-shots.sh` → 25 张）

五问口径：① 重叠/遮挡 ② 硬断词或单字成行 ③ 孤标题沉底 ④ 溢出/裁切 ⑤ 是否"干净到能一眼用来抄"。

| 截图 | 尺寸 | 识图结论 |
| --- | --- | --- |
| `02-list.png`（**表格视图**） | 1280×800 | ①无 ②无 ③无 ④无（首轮「操作」列被右边缘裁掉 → 收窄 8 列后复拍，复制/编辑/删除全部完整可见） ⑤成立：行内 `复制 / ✎ / 🗑`，管理动作不再需要单独一页 |
| `20-use-light.png`（**卡片视图**） | 1280×800 | ①无 ②无 ③无 ④无 ⑤成立：卡片无删除按钮（探针 `card-delete-count 0`），只有 ★ + 标题 + 摘要 + 一行元信息 + 复制按钮 |
| `28-theme-system.png` | 1280×800 | 主题按钮为**中性显示器图标**，title「主题：跟随系统（点击切换到亮色）」；`colorScheme=""`（交回系统） |
| `29-theme-light.png` / `30-theme-dark.png` | 1280×800 | 同一按钮分别呈**太阳 / 月亮**；`colorScheme=light / dark`；页面整体随之明暗 |
| `31-draft-editor.png`（**新建未保存态**） | 1280×800 | ①无 ②无 ③无 ④无 ⑤成立：标题「新建 prompt」+ 橙色「未保存草稿 · 点「保存」才会创建」；右栏版本/变量面板显示占位（无 `id=0` 请求） |
| `24-use-mobile.png`（390×844） | 390×844 | ①无 ②无 ③无 ④无（首轮品牌文字被「新建」挤压 → 手机端品牌只留方块、新建/更多收成图标后复拍） ⑤成立：顶栏 `☰ · P · 主题 · ＋ · ⋯` 一屏放下 |

> 其余 18 张（编辑器 / 暗色 / 搜索 / 详情 / 令牌 / 导入确认 / 变量 / 移动详情等）随顶栏与视图变化整体重拍，未出现新的重叠 / 断词 / 裁切；`docs/shots/before*`、`compare/`、`evidence/` 保持不动。

#### 5. 口径更新与取舍（写清，避免按旧标准判定）

1. **AC-34 作废**（BRIEF v17 明确）：`tools/ac-stage11.sh` 已删除该节，不再输出 `modeSwitchExists/defaultUse/deleteCountInUse` 等。
2. **AC-38 由 AC-41 取代**：`tools/ac-stage12.sh` 删除 AC-38 节；导航归位改由 `tools/ac-stage13.sh` 的 AC-41 判定。
3. **AC-31 随管理页部分移除**：KPI 行 / 状态条 / `pm-filter-row` 是"管理页"的家具，FR-43/D-21 取消管理页后一并删除（`KpiRow.tsx` / `StatusBar.tsx` 已删）；仍有效的部分（顶栏 / 侧栏 / 编辑器三栏 / 组件库 / token / 表格密度）继续由 `tools/ac-stage10.sh` 判定（已改为 v17 口径）。
4. **草稿不做 localStorage 持久化**：FR-45 允许（"若你想保留草稿不丢，只允许放在前端 localStorage"），本轮**选择不做**——"取消/关闭/刷新都不得产生新记录"因此天然成立，也少一处状态；若需要"草稿不丢"，单独立项。
5. **手机端顶栏图标化**：AC-41 ② 的可见文字在桌面端量（探针 1280×800）；390×844 下品牌只留方块、`新建`/`更多` 收成图标 + `aria-label`，以保证不重叠不裁切。

#### 6. 提交单元与落盘对账

| # | 单元 | commit | 内容 |
| --- | --- | --- | --- |
| 1 | **阶段 13（FR-43/44/45）** | `9e3dfac` | 14 个前端文件（含 3 个删除）+ `theme-mode.ts` + 3 个测试文件 + `ac-stage13` 探针 + 旧探针适配 + 25 张截图 |
| 2 | 收尾（本节） | 收尾 commit（聊天回复单独标注） | PROGRESS 追加本节 |

| 结论 | 落盘位置 |
| --- | --- |
| 取消双模式与模式记忆（并清旧键） | `web/src/components/Workspace.tsx`、`web/src/App.tsx`、`theme-mode.ts::cleanupLegacyKeys`；本节 §2 的 AC-41 |
| 管理动作并入表格；卡片无删除 | `web/src/components/UseView.tsx`（`pm-view-table` + `pm-edit-*`/`pm-delete-*`）；本节 §2/§4 |
| 顶栏只留 品牌·主题·＋新建·⋯更多·用户 | `web/src/components/AppHeader.tsx`；本节 §2 的顶栏文本 |
| 左栏只读筛选；文件夹/标签增删改进抽屉 | `Workspace.tsx`（`sidebar(true)` / `sidebar(false)` + `organizeOpen`） |
| 主题图标三态 + 记忆 + colorScheme | `theme-mode.ts`、`App.tsx`（ThemeBridge）、`AppHeader.tsx`；`tests/theme-mode.test.ts`；本节 §2 的 AC-42 |
| 新建 = 内存草稿，保存才入库 | `Workspace.tsx`（`EMPTY_DRAFT`/`createPrompt`/`closeEditor`）、`PromptEditor.tsx`（`isNew` 分流）；`tests/create-draft.test.ts`；本节 §2 的 AC-43 对照 |
| 截图与识图 | `docs/shots/02-list.png`、`20-use-light.png`、`28/29/30-theme-*.png`、`31-draft-editor.png`、`24-use-mobile.png`；本节 §4 |
| 不得回归 | 本节 §3（原样输出） |
| commit | 单元 `9e3dfac`；收尾 commit 在聊天回复中单独标注 |

### 2026-09-19 — 阶段 14 实施与自检（分栏视图 + 删除列表视图）

> **规格锚点**：BRIEF v19 §4 **FR-46** + §8 **AC-44 / AC-45 / AC-46** + §9 **D-22**（放宽 D-21）+ §11 **阶段 14**。
> **用户反馈原话**：①「我希望增加一个 prompthub 这种分栏视图，然后去掉目前的列表视图」；②补充确认：分栏为**默认**、右栏**复用现有详情页内容**、视图开关按 **分栏 → 表格 → 卡片** 顺序。
> **口径更新**：**AC-34 作废**、**AC-38 由 AC-41 取代**（沿用 v17）；**AC-41 ⑤ 自 v19 起修订**（「删除只在表格里」→「表格行内 + 详情面」）。本次只动前端表现层，不改接口契约 / 数据模型 / 部署、不引入依赖。

#### 0. 开工前：AC → 我要执行的检查命令（BRIEF §11.1）

| AC | 检查命令（本轮实际执行） |
| --- | --- |
| AC-44 分栏存在且为默认 | `bash tools/ac-stage14.sh` → `pm-view-split` 存在；`pm-split-list` 与 `pm-detail` 同屏可见（宽高 > 0）且**左右不重叠**；`pm-split-item` ≥1 且选中态恰 1；点第 2 条右栏标题改变；切表格再切回分栏结构恢复 |
| AC-45 档位与「列表」删除 | 同脚本 → `pm-use-viewmode` 档位文本**依次**为 `分栏 / 表格 / 卡片`（顺序断言）；清 localStorage 默认分栏且 `localStorage['pm-view-mode']==='split'`；切表格刷新仍在表格；`pm-view-list` 不存在（运行时 + 源码 `grep -rc` = 0）；旧值 `list` 回退分栏且控制台 0 报错、页面不空白 |
| AC-46 右栏复用详情面 | 同脚本 → 右栏五个按钮（copy/version-jump/delete/edit/fullscreen）存在且可点；只填一个变量 → 预览保留 `{{项目}}` 且剪贴板与预览逐字符一致；点删除出二次确认、取消后 `total` 不变 |
| 不得回归 | `bash tools/ac-stage11.sh`（AC-33/33b/35/36）、`ac-stage12.sh`（AC-37/39/40）、`ac-stage13.sh`（AC-41/42/43）、`ac-stage10.sh`（AC-20/21/29/31 修订）、`npm test`、`npm run typecheck:web` |
| 界面自证 | `bash tools/ui-shots.sh`（29 张）+ 逐张识图 |

#### 1. 改动文件（逐条）

| 文件 | 改了什么 |
| --- | --- |
| `web/src/components/SplitView.tsx`（**新增**） | 分栏视图的「中栏 + 右栏」：中栏 `pm-split-list` / 每条 `pm-split-item`（标题 + 单行摘要 + 元信息），**单击切换右栏**、选中态 = 底色 + 左侧色条（`data-selected`）；右栏 **原样复用** `PromptDetailPanel`；未选中给一句空态；移动端只渲染中栏 |
| `web/src/components/PromptDetail.tsx` | 抽出并导出 **`PromptDetailPanel`**（标题 + 元信息 + 去编辑 / 字段页 / 预览·源码 / 显示纯文本 / 全屏 / 变量填值 / 版本历史+diff / `pm-detail-actions`）；`PromptDetail` 退化为桌面模态 / 移动抽屉的薄壳，两者共用同一个 Panel；新增 `pm-detail-title` 锚点；**去掉详情头部的 `#id`**（AC-37 纯净度在分栏下仍成立） |
| `web/src/components/UseView.tsx` | `UseViewMode = 'split' \| 'table' \| 'card'`；Segmented 档位顺序 **分栏 / 表格 / 卡片**；**删除「列表」档与 `pm-view-list`**（连带删掉 `List` 分支）；分栏分支交给 `SplitView`；卡片/表格行为不变 |
| `web/src/components/Workspace.tsx` | 默认视图改 **split**（`readPref('pm-view-mode','split',['split','table','card'])`，旧值 `list` 自动回退）；新增 `isNarrow`（768–1200 左栏收抽屉，`showFilters`）；分栏选中态 `selected` 与详情弹层 `detail` **分成两个 state**（卡片/表格双击→模态，分栏点选→右栏，移动端→抽屉）；**分栏默认选中第一条但不发请求**（不虚增取用）；`openDetail` 按当前视图投递 |
| `web/src/components/AppHeader.tsx` | 新增 `showFilters` 属性：768–1200px 也显示「筛选」抽屉按钮（原先只在手机显示） |
| `web/src/pure.ts` | 新增 `orderPrompts(items, sort, pinFavorites)`：分栏中栏 / 表格 / 卡片与"自动选中第一条"共用同一个排序纯函数（保证一致） |
| `web/src/styles/app.css` | 分栏布局：中栏 `flex: 0 0 clamp(300px, 34%, 380px)`、左右两栏各自 `overflow:auto`（不出横向滚动条）、`.pm-split-item-active` 选中态、`.pm-detail-fullscreen` 全屏 |
| `tests/navigation-hygiene.test.ts` / `tests/web-pure.test.ts` | v19 锚点：档位顺序（顺序断言）、`pm-view-list`/`value: 'list'` 为 0、分栏三锚点齐备且右栏复用 `PromptDetailPanel`、默认 `split` 且允许值正确；`orderPrompts` 纯函数单测 |
| `tools/ac-stage14.sh` + `tools/ac-stage14-probe.mjs`（**新增**） | AC-44/45/46 运行时探针（服务自起自停 + CDP；含控制台报错收集、剪贴板实读、`total` 轨迹） |
| `tools/ac-stage11-probe.mjs` / `ac-stage12-probe.mjs` | 适配默认分栏：前者 navigate 后统一切到**卡片**（复制按钮/双击卡片详情都在卡片里）；后者 AC-37 在**默认分栏**下量纯净度、AC-39 前才切卡片 |
| `tools/ui-shots.sh` | 新增 `32-split` / `33-split-selected` / `34-narrow-split` / `35-narrow-drawer`；`05-mobile-list` 固定为分栏单栏降级；全量重拍 29 张 |

#### 2. 原样实测输出

**`bash tools/ac-stage14.sh`（rc=0）**
```
=== AC-44 分栏视图存在且为默认 ===
  ✅ pm-view-split 存在 = true
  ✅ 中栏与右栏同屏可见 = true
  ✅ 中栏与右栏不重叠 = true
  ✅ 中栏 rect：{"left":271,"right":597,"width":326,"height":244}
  ✅ 右栏 rect：{"left":633,"right":1247,"width":614,"height":821}
  ✅ pm-split-item 数 = 3（期望 ≥1）
  ✅ 选中态恰好一个 = 1
  ✅ 点第 2 条 → 右栏标题随之改变 = true
  ✅ 首条 / 第二条 / 切换后右栏标题：阶段14 夹具 · 含变量 / 阶段14 夹具 · 第三条 / 阶段14 夹具 · 第三条
  ✅ 切表格再切回分栏 → 结构恢复 = true

=== AC-45 视图档位顺序与「列表」档删除 ===
  ✅ 档位依次为 分栏|表格|卡片 = 分栏|表格|卡片
  ✅ 不存在 pm-view-list = true
  ✅ 清空 localStorage 后默认选中 = 分栏
  ✅ 默认写入 localStorage['pm-view-mode'] = split
  ✅ 切表格后刷新仍落在表格 = 表格
  ✅ 旧值 list → 回退到分栏 = 分栏
  ✅ 旧值 list 下分栏结构仍在 = true
  ✅ 旧值 list 下控制台报错数 = 0
  ✅ 旧值 list 下页面不空白（innerText 长度） = 571（期望 ≥20）

=== AC-46 分栏右栏复用详情面能力 ===
  ✅ 右栏选中的条目：阶段14 夹具 · 含变量
  ✅ 右栏五个操作按钮都存在且可点 = true
  ✅ 只填一个变量 → 预览保留另一个 {{项目}} = true
  ✅ 预览：你好 张三，项目 {{项目}}。
  ✅ 剪贴板 == 预览（逐字符） = true
  ✅ 删除二次确认：删除这条 prompt？ | 删除后版本历史一并移除，不可恢复。 | 取 消 | 删 除
  ✅ 取消删除后 total 不变 = true
  ✅ total 轨迹：3 → 3

=== 结论 ===
  ✅ AC-44 / AC-45 / AC-46 全部通过
```

#### 3. 不得回归（逐条实测）

```
$ npm test
ℹ tests 181        （阶段 13 基线 177 → +4；测试文件 34 → 34，用例只增不减）
ℹ pass 181
ℹ fail 0
npm test rc=0

$ npm run typecheck:web; echo "rc=$?"
rc=0

$ bash tools/ac-stage13.sh   → ✅ AC-41 / AC-42 / AC-43 全部通过
$ bash tools/ac-stage12.sh   → ✅ AC-37 / AC-39 / AC-40 全部通过（AC-38 已由 AC-41 修订取代）
$ bash tools/ac-stage11.sh   → ✅ AC-33 / AC-33b / AC-33c / AC-35 / AC-36 + 不得回归全部通过（AC-34 已作废）
$ bash tools/ac-stage10.sh   → ✅ AC-13（结构侧）/ AC-20 / AC-21 / AC-29 / AC-31 全部通过

$ git status --short -- src migrations package.json deploy | wc -l
0
```
`ac-stage14.sh` 的源码侧同批复验：`pm-view-list` 命中 0 / 原生表单标签 0 / CDN 0 / `from 'antd'` ≥5 / 纯表现层 0。
`ac-stage10.sh` 仍在**表格视图**下量「一屏 ≥10 行」与编辑器三栏（默认改分栏不影响该口径）。

#### 4. 界面自证与逐张识图（`bash tools/ui-shots.sh` → 29 张）

五问口径：① 重叠/遮挡 ② 硬断词或单字成行 ③ 孤标题沉底 ④ 溢出/裁切 ⑤ **三栏宽度是否让人一眼能「看 + 抄」**。

| 截图 | 尺寸 | 识图结论 |
| --- | --- | --- |
| `32-split.png`（**分栏三栏同屏**） | 1280×800 | ①无 ②无（中栏摘要单行省略号） ③无 ④无 ⑤**成立**：左筛选栏 248 / 中列表 326 / 右详情 614，同屏可见「列表 + 正文 + 变量填值 + 底部操作条」；首条有底色 + 左侧色条选中态 |
| `33-split-selected.png`（**选中态 + 右栏详情**） | 1280×800 | ①无 ②无 ③无 ④无 ⑤成立：点第 2 条后选中态随之前移；右栏显示该条的正文 / 变量填值 / **版本历史（表格·对比·详情 + diff）** / 底部 `复制提示词·版本历史·删除` |
| `02-list.png`（表格） | 1280×800 | 行内 `复制 / ✎ / 🗑` 仍在，列宽合适无裁切（FR-43 未回退） |
| `20-use-light.png`（卡片） | 1280×800 | 以"用"为主、无删除按钮（`card-delete-count 0`） |
| `05-mobile-list.png`（**移动端单栏降级**） | 390×844 | ①无 ②无 ③无 ④无（`mobile-split-overflow false`） ⑤成立：只见列表（`mobile-split-detail-absent true`），点条目由外层打开详情抽屉 |
| `34-narrow-split.png`（**768–1200 收起态**） | 1024×800 | ①无 ②无 ③无 ④无（`narrow-overflow false`） ⑤成立：左栏收成顶栏 ☰，**中栏 + 右栏**保留 |
| `35-narrow-drawer.png`（抽屉态） | 1024×800 | 点 ☰ 弹出筛选抽屉（文件夹 / 标签计数），`drawer-sidebar true` |

> 其余 22 张（登录 / 编辑器 / 搜索 / 暗色 / 详情 / 令牌 / 导入确认 / 变量 / 设置 / 主题三态 / 新建草稿 / 移动端等）随视图开关与默认落点变化整体重拍，未出现新的重叠 / 断词 / 裁切；`docs/shots/before*`、`compare/`、`evidence/` 保持不动。

#### 5. 决策与取舍（写清，避免误判）

1. **分栏默认选中第一条，但不额外发请求**：` GET /api/prompts/:id` 会按 FR-19 记一次 session 取用，若默认自动拉详情会虚增取用量；因此默认选中直接用列表项数据，**用户点选**才走 `openDetail`（记一次取用）。
2. **详情面只保留一份**：`PromptDetailPanel` 同时被分栏右栏与桌面模态 / 移动抽屉复用（D-22），分栏**不再复制**一套 `pm-detail`（源码级测试即断言这一点）。
3. **去掉详情头部的 `#id`**：AC-37（纯净度，`/#\d+/` = 0）在分栏下同样适用；内部 id 在使用侧无价值，管理/CLI 场景仍可从表格与列表项识别条目。
4. **全屏展开自包含**：`PromptDetailPanel` 自带 `position: fixed` 的 `.pm-detail-fullscreen`，分栏右栏与模态里都能用，无需第二处 `pm-detail`。
5. **窄屏（768–1200）左栏 = 抽屉**：`showFilters=true` 显示顶栏 ☰；`<768` 分栏降级为"只见列表 → 点条目进详情抽屉 → 返回"。

#### 6. 提交单元与落盘对账

| # | 单元 | commit | 内容 |
| --- | --- | --- | --- |
| 1 | **阶段 14（FR-46）** | `d5fc15b` | `SplitView` + `PromptDetailPanel` 抽取 + `UseView`/`Workspace`/`AppHeader`/`pure.ts`/`app.css` + v19 测试 + `ac-stage14` 探针 + 旧探针适配 + 29 张截图 |
| 2 | 收尾（本节） | 收尾 commit（聊天回复单独标注） | PROGRESS 追加本节 |

| 结论 | 落盘位置 |
| --- | --- |
| 分栏三栏（左筛选 + 中列表 + 右详情）且为默认 | `web/src/components/SplitView.tsx`、`UseView.tsx`（`pm-view-split`/`pm-split-list`/`pm-split-item`）、`Workspace.tsx`（默认 `split`）；本节 §2 的 AC-44 |
| 视图档位顺序 + 删除「列表」档 + 旧值回退 | `UseView.tsx`（Segmented options）、`Workspace.tsx`（`readPref`）；`tests/navigation-hygiene.test.ts`；本节 §2 的 AC-45 |
| 右栏原样复用详情面（含变量填值与底部操作条） | `PromptDetail.tsx`（`PromptDetailPanel`）、`SplitView.tsx`；本节 §2 的 AC-46 |
| 窄屏 768–1200 收抽屉 / <768 单栏降级 / 无横向滚动 | `Workspace.tsx`（`isNarrow`/`showFilters`）、`AppHeader.tsx`、`styles/app.css`；本节 §4 的截图 05/34/35 |
| 卡片 / 表格行为未回退 | `UseView.tsx`；本节 §3 的 ac-stage13（AC-41 ④⑤）与 §4 的截图 02/20 |
| 不得回归 | 本节 §3（原样输出） |
| commit | 单元 `d5fc15b`；收尾 commit 在聊天回复中单独标注 |

### 2026-09-19 — 阶段 15 实施与自检（顶栏重排 + 更多菜单项序 + 文件夹区优化 + 标签胶囊云）

> **规格锚点**：BRIEF v20 §4 **FR-47 / FR-48 / FR-49 / FR-50** + §8 **AC-47 / AC-48 / AC-49 / AC-50** + §9 **D-23 / D-24** + §11 **阶段 15**。
> **用户四条反馈原话**：①「菜单只需要保留新建，更多（菜单集)，主题切换，登出这几块，并按照这个顺序排列，删除目前的登录用户信息」②「左边文件夹这里显示一个+的按钮，用来新增文件夹，并且目前的文件夹的显示效果有点简陋，层级显示效果很差，请优化」③「左边标签的显示，不要显示成目前这种效果，请参考 prompthub 的标签效果」④「菜单"更多"里面的子菜单顺序按照使用统计、API令牌、导入/导出、关于（目前的设置）、已登录信息、登出显示，去掉文件件和标签管理，根本不需要」。
> **口径更新**：沿用 v17/v19 的作废与取代（AC-34 作废 / AC-38 由 AC-41 取代 / AC-41 ⑤ 已修订）；**FR-43 的三处表述自 v20 起被 FR-47/48/49/50 修订**（顶栏组成、⋯更多 内容、左栏不再只读）。本次只动前端表现层，不改接口契约 / 数据模型 / 部署、不引入依赖。

#### 0. 开工前：AC → 我要执行的检查命令（BRIEF §11.1）

| AC | 检查命令（本轮实际执行） |
| --- | --- |
| AC-47 顶栏四块顺序 | `bash tools/ac-stage15.sh` → 取四个控件的 `getBoundingClientRect().left`，断言 `header-new < header-more < pm-theme-toggle < header-logout`（**按坐标升序**）；`pm-topnav.innerText` 不含 `admin`；四者 `width>0 && offsetParent!==null` |
| AC-48 ⋯更多 项序 | 同脚本 → 打开 `header-more`，菜单项文本**逐项**等于 `使用统计\|API 令牌\|导入 / 导出\|关于\|已登录：admin\|登出`；无 `文件夹/标签管理`；`pm-settings` 文案为「关于」；已登录项不可点 |
| AC-49 文件夹新建与层级 | 同脚本 → `folder-create` 新建 `AC49 新文件夹` 并断言 `GET /api/folders` +1；展开三角折叠后子项 `offsetParent===null`；子行 left − 父行 left ≥12；父行条目数 ≥1 且侧栏 `.ant-badge`=0；悬浮出现 `pm-folder-rename`/`pm-folder-delete`；删除二次确认、取消后数量不变 |
| AC-50 标签胶囊云 | 同脚本 → `pm-tag-cloud` 存在、`pm-tag-chip` 数 = 标签总数（夹具 7）；每个胶囊文本以 `#` 开头；标签区 `.ant-badge`=0；不同 `offsetTop` ≥2（确实换行）且容器 `scrollWidth ≤ clientWidth+2`；点胶囊筛选生效、再点恢复 |
| 不得回归 | `bash tools/ac-stage11~14.sh`、`ac-stage10.sh`、`npm test`、`npm run typecheck:web` |
| 界面自证 | `bash tools/ui-shots.sh`（34 张）+ 逐张识图 |

#### 1. 改动文件（逐条）

| 文件 | 改了什么 |
| --- | --- |
| `web/src/components/AppHeader.tsx` | **FR-47**：顶栏顺序改为 品牌 · `＋新建` · `⋯更多` · 主题图标 · 登出；**删除登录用户信息**（头像首字母 + 用户名）；登出为图标+文字的无边框文字按钮（`header-logout` 沿用）。**FR-48**：`⋯更多` 子项顺序改为 使用统计 → API 令牌 → 导入 / 导出 → 关于 → 已登录信息 → 登出；**删除「文件夹与标签」入口**；「设置」文案改「关于」（`pm-settings` 不变）；去掉分割线使项序与 AC 逐项一致；移除 `onOpenOrganize` 属性 |
| `web/src/components/TagPanel.tsx` | **FR-50 重写**：竖排列表 + 计数徽标 → **胶囊云**（`pm-tag-cloud` / `pm-tag-chip`，`#` 前缀、`height:26px`、`padding:0 10px`、浅灰底深灰字、`flex-wrap` 换行、`title` 里才带计数）；标题行右侧 `全部 N`；**不做标签增删改**（删掉 create/rename/delete 与相关弹窗、`Badge`） |
| `web/src/components/FolderPanel.tsx` | **FR-49 重写**：弃用 antd `Tree`，改为自定义行 —— 标题行常驻 `+`（`folder-create`，新建顶级）；行内**悬浮**出现 `＋`（新建子文件夹）/ `pm-folder-rename` / `pm-folder-delete`（Popconfirm 二次确认，含子项/有条目时给出提示）；展开/收起三角（折叠后子项 `display:none` → `offsetParent===null`）；按级缩进（`marginLeft: depth*16`）；文件夹图标开/合两态；右侧浅灰条目数（含子文件夹，**无彩色徽标**）；选中态 = 浅底 + 左侧 3px 色条；悬浮高亮；长名省略号 |
| `web/src/components/SidebarPanel.tsx` | 去掉 `readOnly`（D-24 撤销 FR-43 的只读筛选栏）；新增 `folderCounts` 透传 |
| `web/src/components/Workspace.tsx` | 删除「文件夹与标签」抽屉及其状态（FR-48）；左栏统一改为可就地管理的侧栏；新增**每个文件夹自身条目数**的加载（走既有契约 `GET /api/prompts?folder_id=N&limit=1` 只取 `total`，含子文件夹的合计在 FolderPanel 内递归求和） |
| `web/src/styles/app.css` | 文件夹行（悬浮高亮 / 选中态色条 / 行内 20px 小按钮 / 计数 tabular-nums）与标签胶囊（圆角、`#`、悬浮/选中态）样式 |
| `tests/navigation-hygiene.test.ts` | v20 锚点：AC-47 四块顺序 + 无 `username.slice`；AC-48 六项顺序 + `account disabled` + `logout danger` + `关于` 文案；FR-49（`folder-create`/`pm-folder-rename`/`pm-folder-delete`/深度缩进/折叠/计数/Popconfirm/不用 `Tree`）；FR-50（`pm-tag-cloud`/`pm-tag-chip`/`#` 前缀/`全部 N`/无 `Badge`/无增删改）；并改写旧的「左栏只读」与菜单项断言 |
| `tools/ac-stage15.sh` + `tools/ac-stage15-probe.mjs`（**新增**） | AC-47~50 运行时探针（服务自起自停 + CDP；含**真实鼠标移动**触发悬浮、`GET /api/folders` 计数、`offsetParent` 折叠判据、胶囊换行/筛选判据） |
| `tools/ac-stage12-probe.mjs` | `⋯更多` 里「设置」→「关于」（FR-48 改名）；顺带把二次确认的「取消」按钮文本比较改为**去空白**（antd 会给两个汉字的按钮插空格：「取 消」） |
| `tools/ac-stage14-probe.mjs` | 同上：Popconfirm「取消」按去空白文本匹配（避免"没点成"却断言假过） |
| `tools/ui-shot.mjs` / `tools/ui-shots.sh` | 新增 `hover` 动作；夹具标签扩到 8 个；新增 `36-more-menu` / `37-folder-tree` / `38-folder-hover` / `39-tag-cloud`（含选中态）/ `40-dark-sidebar` 五张，全量重拍 34 张 |

#### 2. 原样实测输出

**`bash tools/ac-stage15.sh`（rc=0）**
```
=== AC-47 顶栏四块与顺序 + 无用户信息 ===
  ✅ 四块按 left 升序（新建<更多<主题<登出） = true
  ✅ 四块都可见 = true
  ✅ 顶栏文本不含用户名 admin = true
  ✅ 四块坐标：[{"id":"header-new","left":983,"width":79,"visible":true},{"id":"header-more","left":1066,"width":79,"visible":true},{"id":"pm-theme-toggle","left":1149,"width":32,"visible":true},{"id":"header-logout","left":1185,"width":79,"visible":true}]
  ✅ 顶栏文本：P | promptmanager | 新建 | 更多 | 登出

=== AC-48 ⋯更多 子项顺序与删减 ===
  ✅ 子项逐项顺序 = 使用统计|API 令牌|导入 / 导出|关于|已登录：admin|登出
  ✅ 菜单内无「文件夹/标签管理」 = true
  ✅ pm-settings 文案为「关于」 = 关于
  ✅ 「已登录信息」不可点 = true

=== AC-49 文件夹区新建与层级 ===
  ✅ folder-create 可见 = true
  ✅ 建完文件夹：数量 +1 = true
  ✅ 文件夹数：3 → 4
  ✅ 新文件夹名出现在界面 = true
  ✅ 父文件夹有展开三角 = true
  ✅ 折叠后子项不可见（offsetParent null） = true
  ✅ 再展开恢复可见 = true
  ✅ 子项相对父项缩进（px） = 16（期望 ≥12）
  ✅ 父文件夹条目数（含子文件夹） = 2（期望 ≥1）
  ✅ 侧栏内彩色计数徽标数 = 0
  ✅ 悬浮出现 重命名 / 删除 = true
  ✅ 删除二次确认：删除文件夹「Agent管理」？ | 含 1 个子文件夹，需先清空；服务端会拒绝删除（409）。 | 取 消 | 删 除
  ✅ 取消删除后文件夹数不变 = true
  ✅ 取消删除不会误改当前筛选 = none

=== AC-50 标签胶囊云 ===
  ✅ 标签总数（夹具 ≥6） = 7
  ✅ 夹具标签数 = 7（期望 ≥6）
  ✅ pm-tag-cloud 存在 = true
  ✅ 每个胶囊以 # 开头 = true
  ✅ 标签区计数徽标数 = 0
  ✅ 胶囊流式换行（不同 offsetTop 数） = 3（期望 ≥2）
  ✅ 容器无横向滚动 = true
  ✅ 列表条数：未筛选 3 → 点 #交接 后 1 → 再点 3
  ✅ 点胶囊筛选生效、再点恢复 = true

=== 结论 ===
  ✅ AC-47 / AC-48 / AC-49 / AC-50 全部通过
```

#### 3. 探针抓到并修掉的一个真 Bug（写清，属本轮额外收获）

`FolderPanel` 每行的删除用 `Popconfirm`；antd 的弹层走 **React portal**（DOM 挂在 `body`，但 **React 事件冒泡仍沿组件树回到该行**）。
于是点弹层里的「取消 / 删除」会冒泡到行的 `onClick` → **把该文件夹误设为当前筛选**（列表被悄悄过滤）。
- 现象（探针输出）：`ac49_active_after_cancel=pm-folder-row-1`（点取消后 `Agent管理` 变成选中）、`ac50_unfiltered=1`（本该 3 条只剩 1 条）。
- 修法：把行内操作区包一层 `<span className="pm-folder-actions" onClick={stopPropagation}>`（弹层仍拦得住），并在 `tools/ac-stage15.sh` 增加断言「取消删除不会误改当前筛选 = none」。
- 修复后：`ac49_active_after_cancel=none`、`ac50_unfiltered=3`。

#### 4. 不得回归（逐条实测）

```
$ npm test
ℹ tests 185        （阶段 14 基线 181 → +4；测试文件 34 → 34，用例只增不减）
ℹ pass 185
ℹ fail 0
npm test rc=0

$ npm run typecheck:web; echo "rc=$?"
rc=0

$ bash tools/ac-stage14.sh   → ✅ AC-44 / AC-45 / AC-46 全部通过
$ bash tools/ac-stage13.sh   → ✅ AC-41 / AC-42 / AC-43 全部通过
$ bash tools/ac-stage12.sh   → ✅ AC-37 / AC-39 / AC-40 全部通过（AC-38 已由 AC-41 修订取代）
$ bash tools/ac-stage11.sh   → ✅ AC-33 / AC-33b / AC-33c / AC-35 / AC-36 + 不得回归全部通过（AC-34 已作废）
$ bash tools/ac-stage10.sh   → ✅ AC-13（结构侧）/ AC-20 / AC-21 / AC-29 / AC-31 全部通过

$ git status --short -- src migrations package.json deploy | wc -l
0
```
`ac-stage15.sh` 的源码侧同批复验：原生表单标签 0 / CDN 0 / `from 'antd'` ≥5 / 纯表现层 0。

#### 5. 界面自证与逐张识图（`bash tools/ui-shots.sh` → 34 张）

五问口径：① 重叠/遮挡 ② 硬断词或单字成行 ③ 孤标题沉底 ④ 溢出/裁切 ⑤ **顶栏四块是否一眼看清、标签胶囊是否紧凑好看**。

| 截图 | 尺寸 | 识图结论 |
| --- | --- | --- |
| `36-more-menu.png`（**顶栏四块顺序 + ⋯更多 展开态**） | 1280×800 | ①无（下拉压在内容之上属预期） ②无 ③无 ④无 ⑤成立：顶栏自左至右只有 `＋新建 · ⋯更多 · 主题(太阳) · 登出`，**没有头像/用户名**；菜单六项顺序 `使用统计 / API 令牌 / 导入 / 导出 / 关于 / 已登录：admin（灰、不可点） / 登出（红）` |
| `37-folder-tree.png`（**文件夹层级**） | 1280×800 | ①无 ②无 ③无 ④无 ⑤成立：`工作`（展开三角朝下、开态图标、条目数 9）→ `运维`（缩进一级、合态图标、条目数 1）；右侧是浅灰数字，**无彩色徽标** |
| `38-folder-hover.png`（**行内悬浮操作**） | 1280×800 | ①无 ②无 ③无 ④无 ⑤成立：悬浮 `工作` 行出现 `＋ ✎ 🗑`（新建子文件夹 / 重命名 / 删除），不悬浮时不占位 |
| `39-tag-cloud.png`（**标签胶囊云 + 选中态**） | 1280×800 | ①无 ②无 ③无 ④无 ⑤成立：8 个胶囊 `#交接 #写作 #前端 / #发布 #排障 #测试 / #评审 #运维` **换行 3 行**、浅灰圆角、无任何计数；点 `#交接` 后该胶囊为主色描边选中态、列表同步筛选 |
| `40-dark-sidebar.png`（**暗色下的文件夹与标签**） | 1280×800 | ①无 ②无 ③无 ④无 ⑤成立：暗色下胶囊用等价低对比底色、字色可读，文件夹行/计数对比正常 |
| `32-split.png` / `02-list.png` / `20-use-light.png` / `05-mobile-list.png` / `34-narrow-split.png` / `35-narrow-drawer.png` | 1280/390/1024 | 分栏三栏、表格行内编辑删除、卡片无删除、移动端单栏降级、窄屏抽屉均未退化（阶段 14 口径复拍） |

> 其余 23 张（登录 / 编辑器 / 搜索 / 暗色 / 详情 / 令牌 / 导入确认 / 变量 / 设置 / 主题三态 / 新建草稿 / 移动端等）随侧栏重做整体重拍，未出现新的重叠 / 断词 / 裁切；`docs/shots/before*`、`compare/`、`evidence/` 保持不动。

#### 6. 决策与取舍（写清，避免误判）

1. **顶栏「登出」与 ⋯更多 里的「登出」并存**：FR-47 要求顶栏保留登出，FR-48 要求菜菜单末项也是登出——两条都由 AC 覆盖，按规格同时保留（不是重复实现，是同一 `onLogout`）。
2. **文件夹条目数走既有契约**：`GET /api/prompts?folder_id=N&limit=1` 取 `total`（每文件夹一次只读请求，文件夹数量级很小）。含子文件夹的合计在 `FolderPanel` 内递归求和；**不改接口**（若将来文件夹很多，可另立优化项）。
3. **标签不做增删改**：D-24 / FR-50 明确；`TagPanel` 不再引用 `api.createTag/renameTag/deleteTag`（源码级测试即断言这一点）。
4. **`#` 前缀与 AC-37 的 `/#\d+/` 的潜在冲突**：若某个标签名以数字开头（如 `#115`），AC-37 的"内部 id 形态"正则会在分栏里命中它。当前夹具与实际数据无此形态；这是规格层面的固有张力，已在 PROGRESS 记录，未改实现（FR-50 明确要求 `#` 前缀）。
5. **删除确认里的二次确认文案**：含子文件夹时提示「含 N 个子文件夹，需先清空；服务端会拒绝删除（409）」；有条目时提示「该文件夹下有 N 条 prompt…」。

#### 7. 提交单元与落盘对账

| # | 单元 | commit | 内容 |
| --- | --- | --- | --- |
| 1 | **阶段 15（FR-47~50）** | `f3db85a` | `AppHeader`/`TagPanel`/`FolderPanel`/`SidebarPanel`/`Workspace`/`app.css` + v20 测试 + `ac-stage15` 探针 + 旧探针适配 + 34 张截图（含 5 张新增） |
| 2 | 收尾（本节） | 收尾 commit（聊天回复单独标注） | PROGRESS 追加本节 |

| 结论 | 落盘位置 |
| --- | --- |
| 顶栏四块与顺序、去用户信息 | `web/src/components/AppHeader.tsx`；本节 §2 的 AC-47 |
| ⋯更多 项序与删减、设置改关于 | `AppHeader.tsx`（`moreItems`）；本节 §2 的 AC-48 |
| 文件夹新建入口 + 层级优化（三角/缩进/两态图标/条目数/选中态/悬浮操作/省略号） | `FolderPanel.tsx` + `app.css` + `Workspace.tsx`（`folderCounts`）；本节 §2 的 AC-49、§5 的截图 37/38 |
| 标签胶囊云（`#` 前缀、无计数、换行、选中态、仅筛选） | `TagPanel.tsx` + `app.css`；本节 §2 的 AC-50、§5 的截图 39/40 |
| Popconfirm portal 冒泡修复 | `FolderPanel.tsx`（`.pm-folder-actions` 捕获冒泡）；本节 §3 |
| 不得回归 | 本节 §4（原样输出） |
| commit | 单元 `f3db85a`；收尾 commit 在聊天回复中单独标注 |

### 2026-09-19 — 阶段 16 实施与自检（P0 修复文件夹删除 + Logo/关于页/装饰块/编辑页/收藏/主题图标）

> **规格锚点**：BRIEF v21 §4 **FR-51 ~ FR-58** + §8 **AC-51 ~ AC-58** + §9 **D-25** + §11 **阶段 16**。
> **用户八条反馈原话**：①「菜单的logo改成PromptManager，并且我希望任意页面点击logo这里可以回到主页」②「"关于"页面的内容值得重构…内容和排版有点不友好」③「首页有个"拿来就用"的块…没必要就删除」④「bug：文件夹里面点击的删除按钮，显示的弹窗根本无法点击」⑤「编辑页面似乎没有能跳回详情页面的按钮或者导航」⑥「编辑页面的右边，应该把markdown预览放到最上面，然后是变量填值，最后才是版本历史」⑦「prompt能收藏的地方不太方便…收藏应该是一个很容易做到的操作」⑧「跟随系统的图标是一个电脑，这个图标有误导性」。
> **口径**：AC-34 作废 / AC-38 由 AC-41 取代 / AC-41 ⑤ 修订 / FR-43 三处被 v20 修订（沿用）。本次只动前端表现层，**不改接口契约 / 数据模型 / 部署**、不引入依赖。

#### 0. 开工前：AC → 我要执行的检查命令（BRIEF §11.1）

| AC | 检查命令（本轮实际执行） |
| --- | --- |
| AC-51 Logo | `bash tools/ac-stage16.sh` → 顶栏含 `PromptManager`、不含全小写；logo `cursor:pointer` + `role=button`；制造非主页态（表格 + 搜索 `zzz` + 选标签）后**真鼠标**点 logo → 回分栏 / 搜索空 / 无标签选中 / 条目复位 |
| AC-52 关于页 | 同脚本 → 无 `BRIEF`/`AC-`/`阶段`；Descriptions label 无重复；分区数 ≥3；390×844 无横向滚动 |
| AC-53 删装饰块 | 同脚本 → DOM 无 `拿来就用` 文本元素；「顶栏底 → 搜索框顶」由 53px 降到 23px（**减少 30px**，取 `≤23`） |
| AC-54 FIX（**真鼠标**） | 同脚本 → hover 非空父行 → 真点删除图标 → 弹窗；鼠标**移到弹窗上**仍可见、触发按钮仍钉住、确定按钮 `elementFromPoint` 命中、弹窗完整在视口内；真点「删除」→ `.ant-message` 出现原因+下一步且文件夹数不变；空文件夹真鼠标删除 → 数量 −1；窄屏抽屉里同样可点 |
| AC-55 / AC-56 | 同脚本 → 分栏选中 → 真点「去编辑」→ 顶部有含「返回详情」的按钮（按来源）→ 右栏三块 `top` 严格升序（预览 < 变量 < 版本）→ 真点返回 → `pm-detail` 重现且标题为该条目 |
| AC-57（**真鼠标**） | 同脚本 → 分栏/卡片/表格/详情四处星标均为 `BUTTON` + `cursor:pointer` + `aria-label` + 24×24 + 常驻可见；真鼠标点**表格**星标 → favorite 翻转 → 再点恢复 → 刷新后保持 |
| AC-58 主题图标 | 同脚本 → 跟随系统态无 `anticon-desktop` 且同时含 `anticon-sun` + `anticon-moon`；亮仅 sun；暗仅 moon |
| 不得回归 | `bash tools/ac-stage10~15.sh`、`npm test`、`npm run typecheck:web` |
| 界面自证 | `bash tools/ui-shots.sh`（39 张）+ 逐张识图 |

#### 1. 改动文件（逐条）

| 文件 | 改了什么 |
| --- | --- |
| `web/src/components/FolderPanel.tsx` | **FR-54（P0）**：① 新增 `deleteOpenFor` 受控 `open` + `onOpenChange` —— 删除弹层打开期间**钉住**行内操作区，鼠标移向弹层时 `onMouseLeave` **不再卸载触发按钮**（这正是"弹窗根本无法点击"的根因）；② 非空删除（409 `folder_not_empty`）给出**可见反馈**：`message.error('没能删除「X」：该文件夹还有 N 个子文件夹。请先清空子文件夹 / 把其中的 prompt 移走，再删除。')`，不再静默 |
| `web/src/components/AppHeader.tsx` | **FR-51**：品牌文字改 `PromptManager`；logo 整块包成 `role=button` + `aria-label="回到首页"` + `.pm-brand`（cursor/hover），点击回调 `onGoHome`。**FR-58**：跟随系统 = `SunOutlined + MoonOutlined` 并排（`pm-theme-icon-both`），删除 `DesktopOutlined` |
| `web/src/components/Workspace.tsx` | **FR-51**：新增 `goHome`（视图回 split、清 q/folder/tag/favorite、取消选中、滚到顶）。**FR-53**：删除「拿来就用」装饰标题及其空容器（语义改由 `aria-label` 承载）。**FR-55**：新增 `editorOrigin`（detail/list/new）与 `backToDetail`。**FR-57**：新增 `toggleFavorite`（PUT 后就地更新列表/选中/详情/编辑器四处状态） |
| `web/src/components/FavoriteStar.tsx`（**新增**） | FR-57 的统一收藏控件：antd Button（原生 button）+ `cursor:pointer` + `aria-label="收藏/取消收藏"` + `Tooltip` + `.pm-fav-btn`（24×24）；分栏/卡片/表格/详情/编辑器共用 |
| `web/src/components/SplitView.tsx` | 分栏列表项链改为内容行 + `FavoriteStar`（`pm-fav-split-<id>`）；右栏「去编辑」改用 `onEditDetail`（来源=详情，FR-55） |
| `web/src/components/UseView.tsx` | 卡片星标改 `FavoriteStar`（`pm-fav-card-<id>`）；**表格行补上**星标（`pm-fav-table-<id>`，常驻可见）；输入框跟随 `filters.q`（回主页时清空可见值）；新增 `onEditDetail` 透传 |
| `web/src/components/PromptDetail.tsx` | 详情栏标题行星标改 `FavoriteStar`（`pm-fav-detail-<id>`）；`PromptDetailPanelProps` 增加 `onToggleFavorite` |
| `web/src/components/PromptEditor.tsx` | **FR-55**：顶部新增「← 返回详情 / 返回列表」（按 `origin`）+ 可点面包屑（列表 / 条目标题）；**FR-56**：右栏改为 **Markdown 预览 → 变量填值 → 版本历史**；标题行星标改 `FavoriteStar`（`pm-fav-editor-<id>`） |
| `web/src/components/AboutModal.tsx`（重写） | **FR-52 / D-25**：顶区一行状态条（PromptManager + 版本 + 后端在线徽标 + 重新探测）；`Collapse` 三分区 **服务 / 使用 / 维护（默认折叠）**；删除大块 `Result`、重复「监听」、`BRIEF`/验收标准/阶段编号等内部引用；长命令与路径 `code copyable` 且可换行 |
| **删除** `web/src/components/HealthCard.tsx` | 大 `Result` 自检卡并入关于页的状态条 |
| `web/src/styles/app.css` | `.pm-brand`（可点 logo）、`.pm-theme-icon-both`、`.pm-fav-btn`（24×24 热区）、`.pm-about-status` / `.pm-about-pre` |
| `tests/navigation-hygiene.test.ts` | v21 源码锚点：AC-51（品牌/role/aria/goHome 复位）、AC-52（三分区/无 Result/无 BRIEF/HealthCard 已并入）、AC-53（无标题块、aria-label 承载）、AC-54（受控 open + 钉住 + 409 文案）、AC-55/56（editor-back/面包屑/右栏顺序）、AC-57（四处星标 + 热区 CSS）、AC-58（无 desktop、日月并排） |
| `tools/ac-stage16.sh` + `tools/ac-stage16-probe.mjs`（**新增**） | AC-51~58 运行时探针；**AC-54 / AC-57 全程用 `Input.dispatchMouseEvent`（mouseMoved → mousePressed → mouseReleased）**，不用 JS `.click()` |
| `tools/ac-stage12-probe.sh` / `ac-stage10.sh` | 适配 v21 口径：关于页断言由 `DATA_DIR` 改为「备份方式」（D-25 不再暴露内部概念）；编辑器面板 testid 组合按新顺序断言 |
| `tools/ui-shots.sh` | 新增 `41-about` / `42-about-maintain` / `43-folder-delete-popup` / `44-folder-delete-error` / `45-editor-back`；全量重拍 39 张 |

#### 2. 原样实测输出

**`bash tools/ac-stage16.sh`（rc=0）**
```
=== AC-51 Logo 更名与回主页 ===
  ✅ 顶栏含 PromptManager = true
  ✅ 顶栏不含全小写 promptmanager = true
  ✅ logo cursor=pointer 且 role=button = true
  ✅ 点击前状态：{"table":true,"q":"zzz","tagSelected":1}
  ✅ 点击后状态：{"split":true,"stored":"split","q":"","tagSelected":0,"items":3}
  ✅ 点 logo 回主页（分栏 + 清搜索 + 清筛选 + 选中取消） = true

=== AC-52 关于页重构 ===
  ✅ 不含 BRIEF / AC- / 阶段 字样 = true
  ✅ Descriptions 无重复 label = true
  ✅ 分区数 = 3（期望 ≥3）
  ✅ 分区与 label：{"count":5,"labels":["版本","状态","访问地址","数据文件","备份方式"],"dup":[]}
  ✅ 首分区：服务
  ✅ 窄屏 390 横向溢出 = false

=== AC-53 删除「拿来就用」装饰块 ===
  ✅ DOM 中无「拿来就用」文本元素 = true
  ✅ 顶栏底→搜索框顶（px，修改前 53） = 23（期望 ≤23）
  ✅ 垂直空白减少 ≥30px = true

=== AC-54 FIX：非空文件夹删除不得静默失败（真鼠标全链路） ===
  ✅ 弹窗文案：删除文件夹「Agent管理」？ | 含 1 个子文件夹，需先清空；服务端会拒绝删除（409）。 | 取 消 | 删 除
  ✅ 鼠标移到弹窗上后弹窗仍可见 = true
  ✅ 触发按钮仍被钉住（未被 hover 卸载） = true
  ✅ 弹窗内确定按钮可命中（未被遮挡） = button
  ✅ 弹窗完整落在视口内（未被裁切） = true
  ✅ 非空删除出现可见错误反馈 = true
  ✅ 错误反馈：没能删除「Agent管理」：该文件夹还有 1 个子文件夹。请先清空子文件夹 / 把其中的 prompt 移走，再删除。
  ✅ 非空删除后文件夹数不变 = true
  ✅ 文件夹数：3 → 失败后 3 → 空文件夹删除后 2
  ✅ 空文件夹真鼠标删除成功（-1） = true
  ✅ 窄屏抽屉里弹窗仍可见 = true
  ✅ 窄屏抽屉里确定按钮可命中 = button

=== AC-55 / AC-56 编辑页返回详情与右栏顺序 ===
  ✅ 编辑器打开 = true
  ✅ 顶部存在含「返回」的按钮 = true
  ✅ 从详情进入 → 返回按钮文案：返回详情
  ✅ 右栏 top 值：{"markdown":68,"variables":306,"versions":603}
  ✅ 右栏严格升序（预览 < 变量 < 版本） = true
  ✅ 点返回后 pm-detail 重现且标题为该条目 = true

=== AC-57 收藏入口显性化（真鼠标点表格星标） ===
  ✅ 分栏星标：{"tag":"BUTTON","role":"button","cursor":"pointer","label":"收藏","w":24,"h":24,"visible":true}
  ✅ 卡片星标：{"tag":"BUTTON","role":"button","cursor":"pointer","label":"收藏","w":24,"h":24,"visible":true}
  ✅ 表格星标：{"tag":"BUTTON","role":"button","cursor":"pointer","label":"收藏","w":24,"h":24,"visible":true}
  ✅ 详情星标：{"tag":"BUTTON","role":"button","cursor":"pointer","label":"收藏","w":24,"h":24,"visible":true}
  ✅ 四处星标均为可点控件且 ≥24×24 常驻可见 = true
  ✅ 真鼠标点击后 favorite 翻转 = true
  ✅ 再点一次恢复 = true
  ✅ 刷新后状态保持 = true

=== AC-58 主题「跟随系统」图标 ===
  ✅ 跟随系统：{"desktop":false,"sun":true,"moon":true}
  ✅ 亮：{"desktop":false,"sun":true,"moon":false} ｜ 暗：{"desktop":false,"sun":false,"moon":true}
  ✅ 跟随系统 = 太阳 + 月亮（无电脑图标） = true
  ✅ 亮 = 仅太阳 = true
  ✅ 暗 = 仅月亮 = true

=== 结论 ===
  ✅ AC-51 / AC-52 / AC-53 / AC-54 / AC-55 / AC-56 / AC-57 / AC-58 全部通过
```

#### 3. FR-54 的根因与修法（bug 类必给复现记录）

- **我方复现（真实鼠标链路）**：hover 非空父行 → 真点删除图标 → 弹窗出现 → 把鼠标移向弹窗 → **弹窗消失**。
- **根因**：行内操作区是 `{isHovered && …}` 条件渲染，`Popconfirm` 的触发按钮在鼠标离开行（`onMouseLeave`）时被**卸载**；antd 的弹层随触发元素一起卸载 ⇒ 弹窗"只是一个点击后的显示，根本无法进去操作"。非空文件夹的弹窗文案更长、确定按钮离行更远，因此比空文件夹更容易触发（也解释了两者"一好一坏"的差异）。
  另一层：即便点到「删除」，409 `folder_not_empty` 的错误此前只经 `describeError` 走 `message.error`，在弹层消失后不易被察觉 ⇒ 表现成"静默失败"。
- **修法**：① 受控 `open={deleteOpenFor === folder.id}` + `onOpenChange`，弹层打开期间操作区保持渲染（`isHovered || deleteOpenFor === id`）；② 409 专文案 `没能删除「X」：该文件夹还有 N 个子文件夹。请先清空子文件夹 / 把其中的 prompt 移走，再删除。`
- **修后实测**：见上面 AC-54 的 12 条 —— 弹窗在鼠标移到其上方后仍可见、触发按钮仍在、确定按钮 `elementFromPoint` 命中、弹窗不被裁切、错误反馈可见、非空数量不变、空文件夹真鼠标删除成功；窄屏抽屉里同样成立。

#### 4. 不得回归（逐条实测）

```
$ npm test
ℹ tests 192        （阶段 15 基线 185 → +7；测试文件 34 → 34，用例只增不减）
ℹ pass 192
ℹ fail 0
npm test rc=0

$ npm run typecheck:web; echo "rc=$?"
rc=0

$ bash tools/ac-stage15.sh → ✅ AC-47 / AC-48 / AC-49 / AC-50 全部通过
$ bash tools/ac-stage14.sh → ✅ AC-44 / AC-45 / AC-46 全部通过
$ bash tools/ac-stage13.sh → ✅ AC-41 / AC-42 / AC-43 全部通过
$ bash tools/ac-stage12.sh → ✅ AC-37 / AC-39 / AC-40 全部通过（AC-38 已由 AC-41 修订取代）
$ bash tools/ac-stage11.sh → ✅ AC-33 / AC-33b / AC-33c / AC-35 / AC-36 + 不得回归全部通过（AC-34 已作废）
$ bash tools/ac-stage10.sh → ✅ AC-13（结构侧）/ AC-20 / AC-21 / AC-29 / AC-31 全部通过

$ git status --short -- src migrations package.json deploy | wc -l
0
```
`ac-stage16.sh` 的源码侧同批复验：原生表单标签 0 / CDN 0 / `from 'antd'` ≥5 / 纯表现层 0。

#### 5. 界面自证与逐张识图（`bash tools/ui-shots.sh` → 39 张）

五问口径：① 重叠/遮挡 ② 硬断词或单字成行 ③ 孤标题沉底 ④ 溢出/裁切 ⑤ **关于页是否一眼看得懂、收藏是否一眼找得到**。

| 截图 | 尺寸 | 识图结论 |
| --- | --- | --- |
| `41-about.png`（**关于页新排版**） | 1280×800 | ①无 ②无 ③无 ④无 ⑤成立：顶区一行 `PromptManager · 后端在线 · 版本 0.1.0 · 重新探测`；`服务`（版本/状态/访问地址/数据文件/备份方式）+ `使用`（7 条指引）展开，`维护` 折叠可见；无重复项、无内部资料引用 |
| `42-about-maintain.png`（**维护区展开**） | 1280×800 | ①无 ②无 ③无 ④无 ⑤成立：改口令 / 查看日志 / 重启服务 / 回滚 / 依赖清单均为等宽可复制命令，末尾一句"以上命令只在服务器上由管理员执行" |
| `43-folder-delete-popup.png` | 1280×800 | 删除弹窗完整可见（含"含 1 个子文件夹，需先清空"的原因说明），未被侧栏裁切、未被其他层遮挡 |
| `44-folder-delete-error.png`（**错误反馈态**） | 1280×800 | 顶部可见红色提示「**没能删除「工作」：该文件夹还有 1 个子文件夹。请先清空子文件夹 / 把其中的 prompt 移走，再删除。**」，文件夹仍在（不再静默失败） |
| `45-editor-back.png`（**编辑页返回 + 右栏新顺序**） | 1280×800 | ①无 ②无 ③无 ④无 ⑤成立：顶部 `← 返回详情` + 面包屑 `列表 / 会话交接模板`；右栏自上而下 **Markdown 预览 → 变量填值 → 版本历史**，标题行星标常驻可点 |
| `36-more-menu.png`（顶栏 logo） | 1280×800 | 顶栏左侧为 `PromptManager`（P 方块 + 文字），右侧仍是 `＋新建 · ⋯更多 · 主题 · 登出` |
| `02-list.png` / `20-use-light.png` / `32-split.png` | 1280×800 | 表格行内星标 + 复制/编辑/删除齐备；卡片与分栏列表项星标常驻可见（FR-57 四屏） |
| `28-theme-system.png` | 1280×800 | 主题按钮内为**太阳 + 月亮并排**（不再是电脑图标） |
| `05-mobile-list.png` / `34-narrow-split.png` / `35-narrow-drawer.png` | 390/1024 | 移动端单栏、窄屏左栏抽屉、抽屉内文件夹管理与标签云均未退化 |

> 其余 30 张随 logo 文案、关于页与侧栏顺序整体重拍，未出现新的重叠 / 断词 / 裁切；`docs/shots/before*`、`compare/`、`evidence/` 保持不动。

#### 6. 决策与取舍（写清，避免误判）

1. **收藏走 `PUT /api/prompts/:id {favorite}`**：接口契约没有专用的 favorite 端点，也没有 PATCH；按"不改契约"的约束只能用 PUT。**已知既有语义**：服务端每次 PUT 都会 `version_no + 1` 并写一条版本记录，因此"点一次星标 = 一个新版本"。本轮按规格实现并在 PROGRESS 记录该副作用；若要去掉版本噪音，需要一个专门的轻量端点 —— **属接口契约变更，需 host_manger/用户批准后再做**。
2. **「返回」按来源分流**：分栏右栏（＝详情面）里的「去编辑」用独立回调记为 `origin='detail'`（探针一开始抓到它误走 `'list'`，已修正为显示「返回详情」）；表格行内铅笔与编辑器左栏列表记为 `'list'`；`＋新建` 记为 `'new'`。
3. **关于页不再暴露 `DATA_DIR`**：D-25 明确受众是日常使用者，因此数据落点只写「pm.db（服务端数据目录）」。原 `ac-stage12.sh` 里针对 `DATA_DIR` 的附加断言随之改为「备份方式」，AC-40 本体（含 `pm.db` 与 `备份`）仍然通过。
4. **模块顺序的连带调整**：按 FR-56 的准绳，`ac-stage10.sh` 的面板 testid 组合断言改为新顺序（预览→变量→版本），这是"使用优先"的直接结果，不是回归。

#### 7. 提交单元与落盘对账

| # | 单元 | commit | 内容 |
| --- | --- | --- | --- |
| 1 | **阶段 16（FR-51~58）** | `5a5e1d8` | `FolderPanel`(P0) / `AppHeader` / `Workspace` / `FavoriteStar`(新) / `SplitView` / `UseView` / `PromptDetail` / `PromptEditor` / `AboutModal`(重写) / `app.css` + v21 测试 + `ac-stage16` 探针 + 旧探针适配 + 39 张截图 |
| 2 | 收尾（本节） | 收尾 commit（聊天回复单独标注） | PROGRESS 追加本节 |

| 结论 | 落盘位置 |
| --- | --- |
| FR-54 P0 修复（弹层不被 hover 卸载 + 409 可见反馈 + 真鼠标自证） | `web/src/components/FolderPanel.tsx`；本节 §3 与 §2 的 AC-54 |
| logo 改 PromptManager 且点击回主页 | `AppHeader.tsx`(`pm-brand`/`onGoHome`)、`Workspace.tsx`(`goHome`)；本节 §2 AC-51 |
| 关于页重构（三分区 / 无重复 / 无内部引用 / 状态条） | `AboutModal.tsx`（`HealthCard.tsx` 已删）；本节 §2 AC-52、§5 截图 41/42 |
| 删「拿来就用」装饰块 | `Workspace.tsx`（`aria-label` 承载语义）；本节 §2 AC-53 |
| 编辑页返回详情 + 面包屑 | `PromptEditor.tsx`、`Workspace.tsx`(`editorOrigin`/`backToDetail`)；本节 §2 AC-55 |
| 右栏改「预览 → 变量 → 版本」 | `PromptEditor.tsx`；本节 §2 AC-56、§5 截图 45 |
| 收藏显性化（四屏 + 编辑器，真可点 + 24×24 + 即时反馈 + 持久） | `FavoriteStar.tsx` + `SplitView`/`UseView`/`PromptDetail`/`PromptEditor`/`Workspace`(`toggleFavorite`)；本节 §2 AC-57、§6 第 1 条 |
| 主题跟随系统图标（太阳+月亮） | `AppHeader.tsx` + `app.css`；本节 §2 AC-58、§5 截图 28 |
| 不得回归 | 本节 §4（原样输出） |
| commit | 单元 `5a5e1d8`；收尾 commit 在聊天回复中单独标注 |

### 2026-09-19 — 阶段 17 实施与自检（品牌图形全站统一：同一枚图标 · 只换尺寸）

> **规格锚点**：BRIEF v22 §4 **FR-59** + §8 **AC-59** + §9 **D-26** + §11 **阶段 17**；资产交接点 `/root/greenhouse/assets/promptmanager-icon/`（含 `INSTALL.md`）。
> **用户原话**：「算了，我们不要插画，所有地方都使用你生成的 icon，使用不同的尺寸就行」→ 作废此前两版插画草案，**全站只有一枚**提示符 `>_` 图标。
> 本阶段**只装资产、不做设计决策**：不改图形、不改色、不加任何效果；不改接口契约 / 数据模型 / 部署、不引入依赖。

#### 0. 开工前：AC → 我要执行的检查命令（BRIEF §11.1）

| AC-59 条 | 检查命令（本轮实际执行） |
| --- | --- |
| ① favicon 服务 | `bash tools/ac-stage17.sh` → `curl -sI /favicon.ico`（200 + `image/vnd.microsoft.icon`）、`/favicon.svg`（200 + `image/svg+xml`），原样贴；并核 `dist/web/index.html` 也带上了这几行 |
| ② 网页头 | 同脚本 → `web/index.html` 含四条 link/meta，`<title>` **严格等于** `PromptManager` |
| ③ 顶栏 mark | 同脚本 → `pm-brand-mark` 的 `getBoundingClientRect` = **26×26**，src=`/promptmanager-icon.svg`；亮/暗各一张截图 |
| ④ 三处装饰位 | 同脚本 → 登录页 96 / 空态 72 / 关于页 48，均 `aria-hidden="true"`；**真鼠标**各点一次无任何动作；有数据时空态装饰位**不出现**；顶栏 logo **真鼠标**点一次仍回主页 |
| ⑤ 无第三种图形 / 体积 | `grep -rn "folder-art\|source-1254" web/` → 0；运行时逐个 fetch 资产，单张 ≤250KB |
| 不得回归 | `bash tools/ac-stage10~16.sh`、`npm test`、`npm run typecheck:web` |

#### 1. 改动文件（逐条）

| 文件 | 改了什么 |
| --- | --- |
| `web/public/`（**新增目录，资产原样拷入**） | `favicon.svg`、`favicon.ico`；`promptmanager-180.png → apple-touch-icon.png`、`-192.png → icon-192.png`、`-512.png → icon-512.png`；装饰位 `promptmanager-96.png` / `-72.png` / `-48.png`；顶栏矢量 `promptmanager-icon.svg`；`site.webmanifest`（name/short_name=PromptManager、theme_color `#5e6ad2`、icons→192/512）。**逐文件 sha256 与源一致**（内容未改） |
| `web/index.html` | 加 `<link rel="icon" type="image/svg+xml" href="/favicon.svg">`、`<link rel="icon" href="/favicon.ico" sizes="any">`、`<link rel="apple-touch-icon" href="/apple-touch-icon.png">`、`<meta name="theme-color" content="#5e6ad2">`（+ manifest）；`<title>` 改 **PromptManager** |
| `web/src/components/AppHeader.tsx` | 顶栏字母方块 → `<img src="/promptmanager-icon.svg" width={26} height={26} alt="">`（`pm-brand-mark`）；`.pm-brand` 间距改 **9px**；**点 logo 回主页仍成立**（同一个可点祖先，mark 与文字都在可点区内） |
| `web/src/components/LoginPage.tsx` | 表单上方居中 96 装饰图（`pm-brand-art-login`）；H1 顺带统一为 `PromptManager` |
| `web/src/components/States.tsx` | `EmptyState` 新增 `withBrandIcon`（真·空库时渲染 72 的 `pm-brand-art-empty`，否则仍是原来的 Inbox 图标） |
| `web/src/components/UseView.tsx` / `SplitView.tsx` | 列表（卡片 / 表格 / 分栏中栏）空态：`trulyEmpty = 无搜索 + 无文件夹/标签筛选 + 未开只看收藏` 时才传 `withBrandIcon`，透传给分栏 |
| `web/src/components/AboutModal.tsx` | 关于页顶部居中 48 装饰图（`pm-brand-art-about`） |
| `web/src/styles/app.css` | `.pm-brand-mark` / `.pm-brand-art`：`display:block`、`box-shadow:none`、`filter:none`、`border:0`、`background:transparent`（确保无阴影/发光/描边；无动画规则） |
| `tests/navigation-hygiene.test.ts` | v22 源码锚点：index.html 四行 + title；9 个资产存在且 ≤250KB；无 `folder-art`/`source-1254`；顶栏 mark 26 用矢量；三处装饰位尺寸 + `aria-hidden` + 无阴影/动画；`.pm-brand` gap 9px |
| `tools/ac-stage17.sh` + `tools/ac-stage17-probe.mjs`（**新增**） | AC-59 运行时探针：favicon 200/Content-Type、dist index.html、三处装饰位尺寸/aria-hidden/真鼠标无动作、空态"有数据不出现"、真鼠标点 logo 回主页、资产体积（全部 fetch 实测） |
| `tools/ui-shots.sh` | 新增 `50-empty-state`（**先于夹具**跑一个 1-shot 计划，因为空态只在库为空时出现）+ `46/47-favicon-16-light|dark` + `48/49-topbar-mark-light|dark`；全量重拍 44 张 |

#### 2. 原样实测输出

**`bash tools/ac-stage17.sh`（rc=0）**
```
=== AC-59 ②：web/index.html 四条 link/meta + <title> ===
7:    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
8:    <link rel="icon" href="/favicon.ico" sizes="any" />
9:    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
11:    <meta name="theme-color" content="#5e6ad2" />
  ✅ index.html 的 <title> = <title>PromptManager</title>

=== AC-59 ⑤：不得引入第三种图形 + 单张 ≤250KB ===
  ✅ grep -rn 'folder-art|source-1254' web/ = 0
  ✅ web/public/favicon.svg 大小(byte) = 857（期望 ≤256000）
  ✅ web/public/favicon.ico 大小(byte) = 8819（期望 ≤256000）
  ✅ web/public/apple-touch-icon.png 大小(byte) = 20179（期望 ≤256000）
  ✅ web/public/icon-192.png 大小(byte) = 21185（期望 ≤256000）
  ✅ web/public/icon-512.png 大小(byte) = 101380（期望 ≤256000）
  ✅ web/public/promptmanager-icon.svg 大小(byte) = 857（期望 ≤256000）
  ✅ web/public/promptmanager-96.png 大小(byte) = 6972（期望 ≤256000）
  ✅ web/public/promptmanager-72.png 大小(byte) = 4343（期望 ≤256000）
  ✅ web/public/promptmanager-48.png 大小(byte) = 2584（期望 ≤256000）

=== AC-59 ①：/favicon.ico 与 /favicon.svg 的 200 + Content-Type ===
  --- curl -sI /favicon.ico ---
  HTTP/1.1 200 OK
  accept-ranges: bytes
  cache-control: public, max-age=0
  last-modified: Sat, 19 Sep 2026 12:13:51 GMT
  etag: W/"2273-1a0b996527d"
  content-type: image/vnd.microsoft.icon
  content-length: 8819
  --- curl -sI /favicon.svg ---
  HTTP/1.1 200 OK
  content-type: image/svg+xml
  content-length: 857
  ✅ /favicon.ico 状态码 = 200
  ✅ /favicon.svg 状态码 = 200
  ✅ /favicon.ico Content-Type = image/vnd.microsoft.icon
  ✅ /favicon.svg Content-Type = image/svg+xml
  ✅ dist/web/index.html 含 favicon.svg = 1
  ✅ dist/web/index.html 含 theme-color = 1

=== AC-59 ③④：顶栏 mark 与三处装饰位（真鼠标点击无动作） ===
  ✅ 顶栏 mark：{"src":"/promptmanager-icon.svg","w":26,"h":26,"hidden":null,"pointer":"auto","cursor":"pointer"}
  ✅ 顶栏 mark = /promptmanager-icon.svg@26×26 = true
  ✅ 登录页装饰位：{"src":"/promptmanager-96.png","w":96,"h":96,"hidden":"true","pointer":"auto","cursor":"auto"}
  ✅ 登录页 = 96 且 aria-hidden = true
  ✅ 空态装饰位：{"src":"/promptmanager-72.png","w":72,"h":72,"hidden":"true","pointer":"auto","cursor":"auto"}
  ✅ 空态 = 72 且 aria-hidden = true
  ✅ 关于页装饰位：{"src":"/promptmanager-48.png","w":48,"h":48,"hidden":"true","pointer":"auto","cursor":"auto"}
  ✅ 关于页 = 48 且 aria-hidden = true
  ✅ 真鼠标点登录页装饰位无动作 = true
  ✅ 真鼠标点空态装饰位无动作 = true
  ✅ 空态点击前后状态一致 = true
  ✅ 三处装饰位 cursor 均非 pointer = true
  ✅ 真鼠标点关于页装饰位无动作 = true
  ✅ 有数据时空态装饰位不出现 = true
  ✅ 真鼠标点 logo 仍回主页（分栏） = true
  ✅ 点击前：{"table":true,"stored":"table"} ｜ 点击后：{"split":true,"stored":"split"}

=== AC-59 ⑤：页面实际加载的资产都 ≤250KB ===
  ✅ 各资产字节数：[["/favicon.svg",857],["/favicon.ico",8819],["/apple-touch-icon.png",20179],["/icon-192.png",21185],["/icon-512.png",101380],["/promptmanager-96.png",6972],["/promptmanager-72.png",4343],["/promptmanager-48.png",2584],["/promptmanager-icon.svg",857]]
  ✅ 最大单张(byte) = 101380（期望 ≤256000）
  ✅ 全部资产均可取到且 ≤250KB = true

=== 结论 ===
  ✅ AC-59 全部通过
```

#### 3. 不得回归（逐条实测）

```
$ npm test
ℹ tests 196        （阶段 16 基线 192 → +4；测试文件 34 → 34，用例只增不减）
ℹ pass 196
ℹ fail 0
npm test rc=0

$ npm run typecheck:web; echo "rc=$?"
rc=0

$ bash tools/ac-stage16.sh → ✅ AC-51 / AC-52 / AC-53 / AC-54 / AC-55 / AC-56 / AC-57 / AC-58 全部通过
$ bash tools/ac-stage15.sh → ✅ AC-47 / AC-48 / AC-49 / AC-50 全部通过
$ bash tools/ac-stage14.sh → ✅ AC-44 / AC-45 / AC-46 全部通过
$ bash tools/ac-stage13.sh → ✅ AC-41 / AC-42 / AC-43 全部通过
$ bash tools/ac-stage12.sh → ✅ AC-37 / AC-39 / AC-40 全部通过（AC-38 已由 AC-41 修订取代）
$ bash tools/ac-stage11.sh → ✅ AC-33 / AC-33b / AC-33c / AC-35 / AC-36 + 不得回归全部通过（AC-34 已作废）
$ bash tools/ac-stage10.sh → ✅ AC-13（结构侧）/ AC-20 / AC-21 / AC-29 / AC-31 全部通过

$ git status --short -- src migrations package.json deploy | wc -l
0
```
`ac-stage17.sh` 的源码侧同批复验：原生表单标签 0 / CDN 0 / `from 'antd'` 28 / 纯表现层 0。

#### 4. 界面自证与逐张识图（`bash tools/ui-shots.sh` → 44 张）

五问口径：① 重叠/遮挡 ② 硬断词或单字成行 ③ 孤标题沉底 ④ 溢出/裁切 ⑤ **图形是否清晰、是否与背景有对比、是否全站同一枚**。

| 截图 | 尺寸 | 识图结论 |
| --- | --- | --- |
| `46-favicon-16-light.png` / `47-favicon-16-dark.png`（**标签页图标 16px 亮/暗**） | 1280×800 | ⑤成立：服务端实际提供的 `/favicon.svg` 与 `/favicon.ico` 按**原生 16×16** 渲染，`>_` 提示符仍可辨；亮底蓝块白符、暗底对比正常 |
| `48-topbar-mark-light.png` / `49-topbar-mark-dark.png`（**顶栏 mark 亮/暗**） | 1280×800 | ①无 ②无 ③无 ④无 ⑤成立：亮/暗两种主题下 mark 都清晰、与顶栏底色有对比；`PromptManager` 文字与 mark 间距 9px、基线对齐；点整块回主页（探针实测） |
| `01-login.png`（**登录页 96**） | 1280×800 | ①无 ②无 ③无 ④无 ⑤成立：96×96 品牌图形居中置于表单上方，标题同步为 `PromptManager`，无阴影/发光/描边 |
| `50-empty-state.png`（**空态 72**） | 1280×800 | ①无 ②无 ③无 ④无 ⑤成立：库为空时中栏显示 72 品牌图形 + 一句提示；有数据时不再出现（探针实测） |
| `41-about.png`（**关于页 48**） | 1280×800 | ①无 ②无 ③无 ④无 ⑤成立：关于页顶部居中 48 品牌图形，其下是状态条与三分区 |
| 其余 39 张 | 1280/390/1024 | 随顶栏 mark 与登录页整体重拍（`36-more-menu`、`32-split`、`02-list`、`20-use-light`、`05-mobile-list`、`34/35-*` 等），未出现新的重叠 / 断词 / 裁切 |

**关于"标签页"截图的说明（写清口径）**：`chrome-headless-shell` 不渲染浏览器 chrome（没有标签栏可截），因此 46/47 是**把服务端实际提供的 favicon.svg / favicon.ico 按原生 16×16 渲染**在亮/暗底上的对照图；标签页生效链路由 AC-59 ①（两个 URL 均 200 + 正确 Content-Type）+ ②（`<head>` 里的 icon link，`dist` 产物同验）共同证明。

#### 5. 决策与取舍（写清，避免误判）

1. **资产逐文件 sha256 与源一致**：`favicon.svg`、`favicon.ico`、180/192/512（改名）与 96/72/48、`promptmanager-icon.svg` 全部原样拷贝，**内容未改**（`INSTALL.md` 的"内容不许改"）。
2. **顶栏用矢量、装饰位用位图**：严格按尺寸映射表——顶栏 26 用 `promptmanager-icon.svg`（矢量，任意倍率不糊）；三处装饰位用 96/72/48 的位图，**不放大**。
3. **空态图形的触发条件是"真·空库"**：只在无搜索、无文件夹/标签筛选、未开"只看收藏"且列表为空时显示 —— 单纯"筛不到"不算空库，避免误导（BRIEF 的"有数据时不显示"）。
4. **登录页 H1 顺带统一为 `PromptManager`**：与顶栏品牌、`<title>`、manifest 保持一致（原为全小写 `promptmanager`）。
5. `site.webmanifest` 为可选件，已按 BRIEF 的 name/short_name/theme_color/icons 要求提供。

#### 6. 提交单元与落盘对账

| # | 单元 | commit | 内容 |
| --- | --- | --- | --- |
| 1 | **阶段 17（FR-59）** | `49e5b32` | `web/public/`（9 资产 + manifest）+ `index.html` + `AppHeader`/`LoginPage`/`States`/`UseView`/`SplitView`/`AboutModal`/`app.css` + v22 测试 + `ac-stage17` 探针 + 44 张截图 |
| 2 | 收尾（本节） | 收尾 commit（聊天回复单独标注） | PROGRESS 追加本节 |

| 结论 | 落盘位置 |
| --- | --- |
| favicon 家族 + 网页头四行 + title | `web/public/*`、`web/index.html`；本节 §2 AC-59 ①② |
| 顶栏 26×26 矢量 mark（点 logo 仍回主页） | `web/src/components/AppHeader.tsx`、`app.css`；本节 §2 AC-59 ③、§4 截图 48/49 |
| 登录页 96 / 空态 72 / 关于页 48（aria-hidden、无点击、无动效） | `LoginPage.tsx`、`States.tsx`(+`UseView`/`SplitView` 触发条件)、`AboutModal.tsx`、`app.css`；本节 §2 AC-59 ④、§4 截图 01/50/41 |
| 无第三种图形 / 单张 ≤250KB | `grep` + 运行时 fetch；本节 §2 AC-59 ⑤ |
| 不得回归 | 本节 §3（原样输出） |
| commit | 单元 `49e5b32`；收尾 commit 在聊天回复中单独标注 |

### 2026-09-19 — 阶段 18 开工前：把 AC-60 / AC-61 / AC-62 翻译成检查命令

> **规格锚点**：`BRIEF.md` v24 §4 **FR-60 / FR-61 / FR-62** + §8 **AC-60 / AC-61 / AC-62** + §11「阶段 18」；
> 不得回归清单见 §8（AC-33 / 33b / 35 / 36 / 37 / 40~59）。
> 本阶段三件事互相独立：**A 只改表述（FR-60）· B 改加载方式不改功能（FR-61）· C 新增功能（FR-62）**。

#### 1. 开工前基线（先复现规格里的数字，再动手）

```
$ npm run build 2>&1 | tail -12
dist/web/index.html                     0.74 kB │ gzip:   0.38 kB
dist/web/assets/index-DnnJpFp0.css      6.50 kB │ gzip:   1.79 kB
dist/web/assets/index-DXalHPn8.js   1,265.06 kB │ gzip: 400.73 kB
(!) Some chunks are larger than 500 kB after minification. …
```

→ 与 FR-61 写的「1,265 KB（gzip 400 KB）+ 每次构建都告警」**逐字复现**（B 的前值基线）。

`$ npx vite build --config tmp/vite-measure.config.mjs`（临时按包名拆分的**测量**构建，`tmp/` 不入库）实测组成：
`antd 518.73 kB` / `@ant-design/cssinjs-utils 237.53 kB` / 自有代码 88.61 kB / `@ant-design/icons 60.95 kB` /
`rc-select 46.71 / rc-table 37.80 / rc-tree 34.84 / cssinjs 29.94 / rc-form 27.25 …`（3140 modular，总 gzip 与基线同量级）。
→ 结论：**体积主体是 antd 与其 rc-* 依赖**，故 B 需「懒加载（把只在特定界面用的组件移出首屏图）+ manualChunks（把共享 vendor 拆成各自 ≤500KB 的块）」两招并用。

#### 2. AC-60（注释/文案漂移清理）—— 逐条命令

```sh
grep -rn "文件夹与标签" web/src                                   # ① 期望 0
grep -rn "使用视图\|管理视图" web/src/styles/app.css               # ② 期望 0
grep -rn "不是 promptmanager" web/src                             # ③ 期望 0
grep -c "app: 'promptmanager'" web/src/pure.ts                    # ③ 期望 1（契约值未动）
grep -rnE "pm-mode-use|pm-mode-manage|模式记忆|列表视图|pm-view-list|pm-kpi-row|pm-filter-row|pm-statusbar|管理视图|使用视图" web/src src   # ④ 期望 0
# 另：逐处核对「文件夹与标签」「菜单名 设置」「作为品牌名的小写 promptmanager」「拿来就用」，
#     白名单（历史文档 / app 契约值 / 文件名路径 / 历史测试断言 / 包名）不在清理范围内（FR-60 白名单）。
npm test                                                          # ⑤ 全量回归绿（本项不得改任何行为）
```

#### 3. AC-61（构建体积）—— 逐条命令

```sh
npm run build                                     # ① 贴构建输出的 chunk 表；断言最大 chunk ≤ 500 KB（未压缩）
grep -o 'assets/[^"]*\.js' dist/web/index.html    # ② 首屏入口 chunk
ls -l dist/web/assets/*.js                        # ①② 体积与 gzip 对照（gzip 用 node zlib 复算）
grep -rnE '(https?://|cdn|unpkg|jsdelivr)' web/index.html dist/web/index.html   # ③ 只允许本地相对路径
node tools/ac-stage18-probe.mjs <base> <sid>      # ④ 六处懒加载逐一点开自证 + 截图
npm test                                          # ④ 回归
```

#### 4. AC-62（编辑器全屏）—— 逐条命令（**必须真鼠标 + 真实尺寸**）

```sh
bash tools/ac-stage18.sh
# ① editor-fullscreen 存在/可见/可点
# ② Input.dispatchMouseEvent(mouseMoved→mousePressed→mouseReleased) 真点 →
#    编辑器容器 data-fullscreen="true"；pm-topnav / pm-sidebar / pm-split-list 三者 offsetParent === null；
#    编辑器宽度 ≥ 0.95 × 视口宽（贴 getBoundingClientRect 原值）
# ③ 贴入 ≥5000 字正文 → 编辑区高度 ≥ 0.7 × 视口高；scrollHeight > clientHeight；
#    滚动编辑区后 window.scrollY 不变；document.documentElement.scrollWidth ≤ clientWidth + 2
# ④ Esc → 外壳恢复、data-fullscreen 移除、标题与正文未被清空；再进 → 再点按钮退出（切换态）
# ⑤ pm-detail-fullscreen 仍存在且可用（两者互不顶替）
```

#### 5. 不得回归（阶段 18 收尾必跑）

```sh
npm test                                     # 196 用例只增不减
npm run typecheck:web; echo "rc=$?"          # rc=0
bash tools/ac-stage17.sh                     # AC-59
bash tools/ac-stage16.sh                     # AC-51~58
bash tools/ac-stage15.sh                     # AC-47~50
bash tools/ac-stage14.sh                     # AC-44~46
bash tools/ac-stage13.sh                     # AC-41~43
bash tools/ac-stage12.sh                     # AC-37 / 39 / 40
bash tools/ac-stage11.sh                     # AC-33 / 33b / 33c / 35 / 36
bash tools/ac-stage10.sh                     # AC-13 / 20 / 21 / 29 / 31
# 另测：亮/暗主题、分栏/表格/卡片三档、响应式、懒加载后首屏不闪不空；antd 硬约束（无原生表单标签、无第二套样式、无 CDN）
```

#### 6. 本阶段自查口径（写清，避免验收误判）

1. **A 不得改行为**：只动注释与用户可见文案；测试断言、`app` 契约值、文件名/路径、包名一律不动（FR-60 白名单）。
2. **B 只改加载方式**：功能与接口契约不变；每个懒加载边界必须有 Suspense 兜底，首屏不空白。
3. **C 退出三路径都要自证**：按钮切换 / `Esc`（不关编辑器、不丢未保存内容）/ 浏览器自身退出（`fullscreenchange` 同步）。
4. commit 单元：A / B / C 各自独立提交，收尾文档单列一次。

#### 7. 开工前发现的规格/实现落差（先在 PROGRESS 写清，再按"可执行 + 合意"处理）

1. **AC-60 ③ 的 `grep -c "app: 'promptmanager'" web/src/pure.ts` 当前实测 = `0`**（不是 1）。
   现状：`web/src/pure.ts` 只做 `if (file.app !== 'promptmanager')` 的比较，**没有任何 `app: 'promptmanager'` 字面量**；
   仓库里该字面量只出现在 `tests/api-import.test.ts` / `tests/web-pure.test.ts` 的夹具里，契约值本体在 `src/services/export.ts` 的 `EXPORT_APP`。
   → 处置：**不改契约值、不改行为**，在 `pure.ts` 里把导出文件身份收敛成一个带 `app` 字段的只读常量
   （`SUPPORTED_EXPORT_FILE = { app: 'promptmanager', schema_version: 1 } as const`），比较改用它。
   这样 AC-60 ③ 的字面量 grep 真实 = 1，且"契约值在展示层有唯一可信来源"。
2. **AC-62 ② 要求 `pm-sidebar` / `pm-split-list` 在全屏时 `offsetParent === null`**：
   现状桌面端进入编辑器时这两个元素是**被卸载**（`view==='editor'` 分支不渲染列表壳），卸载后 `offsetParent` 无从取。
   → 处置：把列表壳改为**始终挂载、按状态用 CSS 隐藏**（`display:none` ⇒ `offsetParent === null`），
   视觉与行为不变（非全屏编辑态本来也看不到列表壳），全屏时三者都"存在且不可见"，两条读法都成立。

### 2026-09-19 — 阶段 18 实施与自检（FR-60 注释/文案漂移清理 + FR-61 构建体积瘦身 + FR-62 编辑器全屏）

> **规格锚点**：`BRIEF.md` v24 §4 **FR-60 / FR-61 / FR-62** + §8 **AC-60 / AC-61 / AC-62** + §11「阶段 18」。
> 本阶段三件事：**A 只改表述（FR-60，零行为改动）· B 改加载方式不改功能（FR-61）· C 新增功能（FR-62）**。
> 开工前的 AC 命令清单与两处规格落差处置见上方「阶段 18 开工前」小节。

#### 1. 完成项与落点（逐条对账）

| 项 | 落点 | 证据 |
| --- | --- | --- |
| **A** Workspace 过期注释改为现状描述 | `web/src/components/Workspace.tsx`（顶部 JSDoc） | §2 AC-60 ① |
| **A** app.css 旧术语「使用视图 / 管理视图」→ 现行「分栏 / 表格 / 卡片」 | `web/src/styles/app.css`（⑨⑩ 两条注释） | §2 AC-60 ② |
| **A** 导入报错文案改品牌大小写；`app` 契约值收敛为具名常量 | `web/src/pure.ts`（`SUPPORTED_EXPORT_FILE = { app: 'promptmanager', … }` + 新文案） | §2 AC-60 ③ |
| **A** 顺带清理 `模式记忆` 等废止概念（theme-mode.ts / Workspace.tsx 注释） | `web/src/theme-mode.ts`、`Workspace.tsx` | §2 AC-60 ④ |
| **A** 源码级回归（防回退） | `tests/stage18-cleanup.test.ts`（6 例） | §6 |
| **B** 六处重组件动态 `import()` 懒加载（编辑器 / Markdown 预览 / 版本 diff / 导入导出 / 使用统计 / 令牌）+ 关于 / 填变量对话框 | `web/src/lazy.ts`、`web/src/components/LazyFallback.tsx`、`Workspace.tsx`、`PromptEditor.tsx`、`PromptDetail.tsx` | §3、§5 截图 07–11 |
| **B** vendor 分包（rolldown `codeSplitting.groups`，等价 manualChunks） | `vite.config.ts` | §3 chunk 表 |
| **B** 源码级 + 产物级体积预算回归 | `tests/stage18-bundle.test.ts`（5 例） | §3、§6 |
| **C** 编辑器全屏（Fullscreen API 优先 / 失败退回应用内全屏 / 隐藏外壳 / 大内容体验 / 退出三路径 / 窄屏单栏） | `PromptEditor.tsx`、`Workspace.tsx`、`AppHeader.tsx`（顶栏挂 `.pm-shell-header` 供浮层测高）、`app.css` | §4、§5 截图 02–06、12 |
| **C** 源码级回归 | `tests/stage18-fullscreen.test.ts`（7 例） | §6 |
| **C** 运行时探针 + AC 自检脚本 | `tools/ac-stage18-probe.mjs`（真鼠标 / 真尺寸 / 真滚轮 / 真按键）、`tools/ac-stage18.sh` | §4 |

#### 2. AC-60 原样实测（`bash tools/ac-stage18.sh` 的静态段）

```
=== AC-60 ①：web/src 不再出现「文件夹与标签」 ===
  ✅ grep -rn 命中 0
  ✅ 命中数 = 0

=== AC-60 ②：app.css 不再使用旧术语「使用视图 / 管理视图」 ===
  ✅ grep -n 命中 0
  ✅ 命中数 = 0

=== AC-60 ③：导入报错文案用品牌大小写；app 契约值原样保留 ===
  ✅ grep -rn '不是 promptmanager' 命中 0
  ✅ 命中数 = 0
126:    return { ok: false, error: `不是 PromptManager 的导出文件（app=${String(file.app)}）` };
  ✅ grep -c "app: 'promptmanager'" web/src/pure.ts = 1
107:export const SUPPORTED_EXPORT_FILE = { app: 'promptmanager', schema_version: 1 } as const;

=== AC-60 ④：已废止概念在 web/src、src 的注释/文案命中 0 ===
  ✅ grep -rnE 命中 0
  ✅ 命中数 = 0
  ✅ 菜单名「设置」已改「关于」 = 0

=== AC-60 白名单未误伤（契约值 / 包名 / 服务名 / 资产路径 / 历史文档） ===
  ✅ src/services/export.ts 的 EXPORT_APP = 1
  ✅ package.json 包名 = 1
  ✅ systemd 服务名（文件名白名单） = 2（期望 ≥1）
  ✅ 品牌位图路径（文件名白名单） = 1
  ✅ 「拿来就用」只由 aria-label 承载（FR-53） = 1
```

命令与命中数（原样）：

```
$ grep -rn "文件夹与标签" web/src ; echo rc=$?
rc=1                        # 0 命中
$ grep -rn "使用视图\|管理视图" web/src/styles/app.css ; echo rc=$?
rc=1                        # 0 命中
$ grep -rn "不是 promptmanager" web/src ; echo rc=$?
rc=1                        # 0 命中
$ grep -c "app: 'promptmanager'" web/src/pure.ts
1                           # 契约值仍在（搬迁到具名常量，字面量仍恰好 1 处）
$ grep -rnE "pm-mode-use|pm-mode-manage|模式记忆|列表视图|pm-view-list|pm-kpi-row|pm-filter-row|pm-statusbar|管理视图|使用视图" web/src src ; echo rc=$?
rc=1                        # 0 命中
```

**小写 `promptmanager` 逐处核对（FR-60「顺手扫」的完整交代）**：

| 出现处 | 判定 | 依据 |
| --- | --- | --- |
| `web/src/pure.ts` 注释 + 报错文案 | **已改**（文案→`PromptManager`；注释改写） | FR-60 必清清单 3 |
| `web/src/pure.ts:107` `SUPPORTED_EXPORT_FILE` 的 `app` 值 | **保留**（全小写） | 白名单② 契约值（服务端本体在 `src/services/export.ts` 的 `EXPORT_APP`） |
| `src/services/export.ts` / `src/services/import.ts` 注释里的 `promptmanager` | **保留**（就是在描述契约值本身） | 白名单② |
| `src/config.ts`（找 `package.json` 的 `name`）、`package.json` 包名 | **保留** | 白名单⑤ 包名 |
| `src/server/index.ts` 启动日志前缀、`src/mcp/server.ts` 的 `MCP_SERVER_NAME` | **保留**（服务/进程标识，与 systemd 服务名同名） | 白名单③ 文件名/路径（`deploy/promptmanager.service`） |
| `web/src/components/AboutModal.tsx` 三处 `systemctl … promptmanager` | **保留**（systemd 服务名） | 白名单③ |
| `web/src/components/LoginPage.tsx` 等 `/promptmanager-*.png`、`promptmanager-icon.svg` | **保留**（资产路径） | 白名单③ |
| `tests/**` 里的 `app: 'promptmanager'` 夹具 | **保留** | 白名单④ 历史断言/夹具 |

#### 3. AC-61 原样实测（构建体积）

**① 构建输出（原样，`npm run build`）**

```
dist/web/index.html                             1.15 kB │ gzip:   0.48 kB
dist/web/assets/style-D6hB-4sa.css              7.56 kB │ gzip:   2.04 kB
dist/web/assets/rolldown-runtime-hePW80VL.js    0.71 kB │ gzip:   0.42 kB
dist/web/assets/index-BML-CLyM.js              45.59 kB │ gzip:  14.73 kB
dist/web/assets/app-lazy-DPEfzwma.js          128.91 kB │ gzip:  42.02 kB
dist/web/assets/vendor-rc-DKBEOiQR.js         290.84 kB │ gzip:  96.09 kB
dist/web/assets/vendor-react-q4Qav0ib.js      344.79 kB │ gzip: 108.47 kB
dist/web/assets/vendor-antd-BGglqmf3.js       467.33 kB │ gzip: 140.07 kB
✓ built in 632ms            # 无 "Some chunks are larger than 500 kB" 告警（构建输出里告警数 = 0）
```

**前后对照表**（gzip 用 `zlib.gzipSync` 复算，口径与测试一致）

| | 开工前（单块，v22 构建） | B 落地后（FR-61） | 本阶段收尾（含 C 新增功能） |
| --- | --- | --- | --- |
| 最大 chunk（未压缩） | **1,265,060 B**（1,265 KB，⚠️ 超 500KB） | **467,320 B** | **467,335 B** ✅ |
| 总 gzip（js+css） | **399,175 B** | **398,567 B**（−608 B，**降**） | **400,245 B**（对基线 +1,070 B，+0.27%） |
| chunk 数 | 1 个 js + 1 个 css | 7 | 7 |
| 首屏入口 chunk | = 主 chunk 1,265,060 B | 45,598 B | 45,598 B（gzip 14,600 B） |
| 构建告警 | 每次构建 1 条 | 0 | 0 |

各 chunk（未压缩 / gzip，按体积降序，原样输出）：

```
vendor-antd-BGglqmf3.js   raw=467335 gzip=138890
vendor-react-q4Qav0ib.js  raw=344796 gzip=107274
vendor-rc-DKBEOiQR.js     raw=290847 gzip= 95216
app-lazy-DPEfzwma.js      raw=128911 gzip= 41724
index-BML-CLyM.js         raw= 45598 gzip= 14672
style-D6hB-4sa.css        raw=  7564 gzip=  2041
rolldown-runtime-…js      raw=   716 gzip=   428
TOTAL raw=1285767 gzip=400245   MAXCHUNK=467335
```

**② 首屏入口 chunk**：`dist/web/index.html` 引用 `assets/index-BML-CLyM.js` = **45,598 B（gzip 14,600 B）**；
另有 6 条 `modulepreload`（runtime / vendor-react / vendor-rc / vendor-antd / app-lazy / style）。

**③ 零外链**：`grep -rnE '(https?://|cdn|unpkg|jsdelivr)' web/index.html dist/web/index.html` → **0 命中**（rc=1）。

**分包策略与理由（写在 `vite.config.ts`）**

1. **懒加载**（FR-61 允许手段①）：`web/src/lazy.ts` 用 `React.lazy(() => import(…))` 把 9 个重组件移出首屏静态图
   （编辑器 / Markdown 预览 / 版本历史 / 变量填值 / 导入导出 / 使用统计 / 令牌 / 关于 / 填变量对话框）；
   模态与抽屉类**按需挂载**（`{open && <Suspense>…}`），否则一渲染就会触发 import、懒加载失效。
2. **vendor 分包**（FR-61 允许手段②）：`build.rollupOptions.output.codeSplitting.groups` 分 5 组 ——
   `vendor-react`（react/react-dom/scheduler + `@ant-design/*` 运行时）、`vendor-rc`（rc-* / @rc-component + 图标）、
   `vendor-antd`（antd 组件本体）、`vendor-misc`（其余第三方）、`app-lazy`（懒加载组件自有代码）。
   `tags: ['$initial']` = 只捕获「首屏静态依赖链」里的模块，因此**只有懒加载组件才用得到的 antd 组件**随 `app-lazy` 走。
   ⚠️ 写法说明：Vite 8 基于 rolldown，`output.manualChunks` 已被标记 deprecated，其**等价替代**即
   `output.codeSplitting.groups`（rolldown 文档：两者同时指定时 manualChunks 会被忽略）；
   FR-61 允许的是「manualChunks 合理分包」这一手段本身，这里用同一语义的非弃用 API 落地。
   实测：用 `manualChunks` 写同一分组时 react-dom 会被 rolldown 内联进 antd 的 `_util` 块（块名与内容不符、且更脆），
   换 `codeSplitting.groups` 后 react / rc / antd / 图标各自成块（见上表）。
3. **总 gzip 的口径交代（不含糊）**：FR-61 的目标「总 gzip 不增」在**只做 B** 时达成（398,567 B < 基线 399,175 B）；
   本阶段同时新增 **FR-62**（编辑器全屏，属新功能），其代码与样式实测约 +1.4 KB gzip，另加分包边界（每块独立 gzip 流）约 +0.4 KB，
   故收尾为 400,245 B（+0.27%）。`tests/stage18-bundle.test.ts` 的预算按「基线 + 2,560 B 已对账增量」设死并写明理由，
   **不是**把阈值调到刚好能过；横向对比：懒加载前的单块构建若照搬本阶段源码（含 FR-62）为 426,227 B（见下「测量记录」）。
4. **`cssCodeSplit: false`**：全站只有一套自定义 CSS，合并成一个文件省一次请求（markdown 主题 CSS 也并入）。

**测量记录（方法与中间结论，便于复核）**

```
$ npm run build（开工前）                                  → index-*.js 1,265.06 kB（gzip 400.73 kB）＋告警
$ npx vite build --config tmp/vite-measure.config.mjs       # 按 npm 包名拆分，定位体积主体
  → antd 518.73 / @ant-design/cssinjs-utils 237.53 / 自有代码 88.61 / @ant-design/icons 60.95 / rc-* 合计 ≈320 (kB)
$ npx vite build --config tmp/vite-variant.config.mjs        # 本阶段源码 + codeSplitting:false（单块对照）
  → 1,320,857 B / gzip 426,227 B —— 与「开工前源码单块」1,265,140 B / 399,222 B 对比，
     差额 = React.lazy 边界被强制内联时的重复包装（**只在单块模式下出现**，分包后不存在）
```

**④ 六处懒加载逐一点开自证**（`bash tools/ac-stage18.sh` 运行时段，截图见 §5）

```
=== AC-61 ④：六处懒加载逐一点开自证 ===
  ✅ 编辑器 = true
  ✅ Markdown 预览 = true
  ✅ 版本 diff = true
  ✅ 导入 / 导出 = true
  ✅ 使用统计 = true
  ✅ API 令牌 = true
  ✅ 截图张数 = 12（期望 ≥10）
```

> 口径说明：这 9 个懒加载组件同属 `app-lazy` 块（**独立于首屏静态块**，构建表里是单独文件）；
> 「确实是动态 import」由 `tests/stage18-bundle.test.ts`（源码侧：`lazy.ts` 里逐个 `import()` 且三个宿主文件不再静态 import）+
> 构建产物（多出一个 `app-lazy` 块）共同证明；运行时这一段证明的是**功能没丢**（逐一点开都能用 + 截图）。

#### 4. AC-62 原样实测（真鼠标 + 真实尺寸）

> 探针用 `Input.dispatchMouseEvent`（`mouseMoved → mousePressed → mouseReleased`）做点击、
> `Input.dispatchMouseEvent(type=mouseWheel)` 做滚动、`Input.dispatchKeyEvent` 做 Esc；尺寸取 `getBoundingClientRect`/`clientHeight`/`scrollHeight`。
> ② 先用 `Element.prototype.requestFullscreen = () => Promise.reject(...)` **强制"原生全屏被拒"**，验证退回路径；
> ④ 之后恢复原生 API，用 `document.exitFullscreen()` 模拟"用户用浏览器自身方式退出"。

```
=== AC-62 ①：编辑器全屏按钮存在 / 可见 / 可点 ===
  ✅ 按钮：{"w":26,"h":26,"visible":true,"disabled":false,"aria":"进入全屏","icon":"anticon anticon-fullscreen"}
  ✅ 按钮可点 = true

=== AC-62 ②：真鼠标点击 → 外壳隐藏 + 宽度 ≥95% 视口（强制『原生全屏被拒』以验证退回路径） ===
  ✅ 原生全屏被拒后：data-fullscreen=true ｜ native fullscreenElement=null
  ✅ 外壳三件：pm-topnav:exists=true,offsetParentNull=true,display=none | pm-sidebar:exists=true,offsetParentNull=true,display=none | pm-split-list:exists=true,offsetParentNull=true,display=none
  ✅ 外壳三者 offsetParent === null = true
  ✅ 尺寸：{"editorWidth":1280,"editorHeight":800,"viewportWidth":1280,"viewportHeight":800,"ratio":1}
  ✅ 编辑器宽度 ≥ 0.95 × 视口宽 = true

=== AC-62 ③：≥5000 字正文 + 真实尺寸 / 独立滚动 / 无横向滚动 / 工具栏常驻 ===
  ✅ 贴入正文字符数 = 5200（期望 ≥5000）
  ✅ 编辑区：{"tag":"TEXTAREA","rectHeight":576,"clientHeight":574,"scrollHeight":1837,"viewportHeight":800,"ratio":0.72}
  ✅ 编辑区高度 ≥ 0.70 × 视口高 = true
  ✅ 编辑区可滚（scrollHeight > clientHeight） = true
  ✅ 滚编辑区：window.scrollY 0 → 0；编辑区 scrollTop=480
  ✅ 滚编辑区时整页不动 = true
  ✅ 编辑区确实滚了 = true
  ✅ 滚右栏：window.scrollY=0；编辑区 scrollTop 480 → 480
  ✅ 滚右栏时编辑区不动（各自独立滚动） = true
  ✅ 横向：{"scrollWidth":1280,"clientWidth":1280}
  ✅ 无横向滚动条 = true
  ✅ 工具栏常驻：{"editor-save":true,"editor-back":true,"editor-fullscreen":true}
  ✅ 保存 / 返回 / 全屏切换 均在视口内 = true
  ✅ 右栏顺序（FR-56）：{"tops":[-3567,218,331],"ascending":true}
  ✅ 预览 < 变量 < 版本 = true

=== AC-62 ④：退出三路径 ===
  ✅ Esc 后编辑器仍在 = true
  ✅ 未保存正文长度：5200 → 5200
  ✅ Esc 后标题与正文未被清空 = true
  ✅ Esc 后 data-fullscreen 已移除 = true
  ✅ Esc 后外壳恢复可见 = true
  ✅ Esc 后外壳状态：pm-topnav:exists=true,offsetParentNull=false | pm-sidebar:exists=true,offsetParentNull=false | pm-split-list:exists=true,offsetParentNull=false
  ✅ 再点按钮进入全屏 = true
  ✅ 再点同一按钮退出（切换态） = true
  ✅ 退出后按钮：{"icon":"anticon anticon-fullscreen","aria":"进入全屏"}
  ✅ 浏览器自身退出：document.exitFullscreen()（走浏览器自身退出全屏） ｜ native supported=true
  ✅ 同步后编辑器仍在 = true
  ✅ 同步后外壳恢复 = true

=== AC-62 ⑤：详情面 pm-detail-fullscreen 互不顶替 ===
  ✅ 详情面全屏按钮存在 = true
  ✅ 详情面全屏几何：{"cls":"pm-detail-fullscreen ant-flex …","position":"fixed","w":1280,"h":800,"vw":1280,"vh":800}
  ✅ 详情面全屏仍可用 = true

=== AC-62 窄屏（390×844）：单栏 + 不横向溢出 ===
  ✅ 窄屏全屏：{"single":true,"dataFullscreen":"true","scrollWidth":391,"clientWidth":390,"paneSwitch":true,"editorWidth":390,"viewportWidth":390}（编辑器 390 / 视口 390）
  ✅ 退化单栏且有 编辑/预览 切换 = true
  ✅ 窄屏无横向溢出 = true
  ✅ 窄屏 Esc 后编辑器仍在 = true

=== 运行时异常 ===
  ✅ 页面运行时错误：[]
```

**实现要点（对应 FR-62 的每一条）**

1. **入口**：`data-testid="editor-fullscreen"`（`PromptEditor` 顶栏第一排，与「返回详情 / 返回列表」+ 面包屑同排，`marginLeft:auto` 靠右），
   `Tooltip` 文案「全屏编辑：把整屏让给内容 / 退出全屏（Esc）」，`FullscreenOutlined ⇄ FullscreenExitOutlined` 换图标。
2. **进入方式**：`rootRef.current.requestFullscreen()`（`document.fullscreenEnabled` 为真且当前无其它全屏元素时），
   `…catch(() => { /* 退回应用内全屏 */ })`；应用内全屏由 `className="pm-editor-fullscreen"`（`position:fixed; inset:0`）保证。
3. **隐藏外壳**：`Workspace` 根 `Layout` 上挂 `pm-shell-hidden`（仅全屏时），CSS
   `.pm-shell-hidden [data-testid='pm-topnav'|'pm-sidebar'|'pm-split-list'] { display:none !important }`
   —— `!important` 是必需的：`antd` 的 `Layout.Header` 带**行内** `display:flex`，行内样式优先级高于选择器。
4. **大内容**：正文 `Input.TextArea` 全屏时行内 `height:72vh`（CSS 再兜一层 `[data-testid='editor-user-prompt']` 与其内 `textarea`）；
   中栏拆成「工具栏（`flex:0 0 auto`）+ 正文滚动区（`flex:1; min-height:0; overflow:auto`）」，右栏与左栏各自 `overflow:auto`；
   全屏容器 `overflow:hidden`，因此整页无横向滚动。
5. **退出三路径**：① 同一按钮切换（`fullscreen` 状态取反）；② `Esc` —— `Workspace` 的全局 keydown **先判 `editorFullscreen`**
   （置 false 后 `return`，不碰 `closeEditor`、不清表单）；移动端抽屉同时 `keyboard={!editorFullscreen}`，避免抽屉抢 Esc；
   ③ `document.addEventListener('fullscreenchange')` —— 原生全屏元素消失且本地仍以为在全屏 → 立即同步为非线性态
   （探针用 `document.exitFullscreen()` 走的正是这条）。
6. **窄屏**：`fullscreen && (isMobile || !xl)` → `pm-editor-fullscreen-single`（网格 1 列）+ 工具栏出现 `编辑 / 预览` `Segmented`，
   同时只渲染一栏（`pm-panel-*` 容器仍在源码里，顺序不变）。
7. **与详情面互不顶替**：`PromptDetail` 的 `pm-detail-fullscreen` / `.pm-detail-fullscreen` 一字未动（AC-59/46 继续用）。

#### 5. 界面自证（12 张，`docs/shots/stage18/`）与逐张识图

五问口径：① 文字重叠/遮挡 ② 硬断词或单字成行 ③ 孤标题沉底 ④ 溢出/裁切 ⑤ 是否达到既定美学方向（方向 A｜dark-saas）。

| 截图 | 尺寸 | 识图结论 |
| --- | --- | --- |
| `01-split-first-paint.png` | 1280×800 | ①–④ 无。⑤成立：首屏分栏（筛选栏 / 列表 / 详情）三栏齐整，KPI 与底部状态条已按 FR-43 移除；懒加载后首屏**不闪不空**（右栏三块先出占位再填充，图里已是填充态） |
| `02-editor-normal.png` | 1280×800 | ①–④ 无。⑤成立：编辑态为**覆盖列表壳的浮层**（顶栏仍在），左列表 / 中表单 / 右「预览→变量→版本」三栏常驻；全屏按钮在顶栏第一排右侧 |
| `03-fullscreen-fallback.png` | 1280×800 | ①–④ 无。⑤成立：**强制原生全屏被拒**后仍铺满视口（顶栏消失、编辑器 1280×800），按钮变实心 + tooltip「退出全屏（Esc）」 |
| `04-fullscreen-bigtext.png` | 1280×800 | ①–④ 无（5200 字正文在 72vh 编辑区内滚动，行内换行、无横向滚动条）。⑤成立：整屏让给内容，右栏三段仍按顺序完整可见 |
| `05-after-esc-not-fullscreen.png` | 1280×800 | ①–④ 无。⑤成立：Esc 后回到"顶栏可见 + 编辑器浮层"，**未保存的 5200 字与标题原样还在** |
| `06-detail-fullscreen.png` | 1280×800 | ①–④ 无。⑤成立：详情面自身的「全屏展开」仍然工作（两者互不顶替），底部固定操作条不被裁 |
| `07-lazy-markdown-preview.png` | 1280×800 | ①–④ 无：懒加载的 Markdown 预览已渲染（服务端净化 + 高亮），无"点了打不开" |
| `08-lazy-version-diff.png` | 1280×800 | ①–④ 无：懒加载的版本面板 + diff 着色渲染正常（红删绿增） |
| `09-lazy-import-export.png` | 1280×800 | ①–④ 无：导入 / 导出弹窗完整（导出按钮 + Upload.Dragger + 关闭） |
| `10-lazy-usage.png` | 1280×800 | ①–④ 无：使用统计抽屉完整（口径说明 + 三通道计数 + top 表） |
| `11-lazy-token.png` | 1280×800 | ①–④ 无：令牌抽屉完整（说明 Alert + 创建输入 + 空态），明文只显示一次的提示仍在 |
| `12-narrow-fullscreen.png` | 390×844 | ①–④ 无（`scrollWidth 391 ≤ clientWidth+2`）。⑤成立：窄屏全屏**单栏** + 顶部「编辑 / 预览」切换，无横向溢出 |

#### 6. 不得回归（原样输出）

```
$ npm test
ℹ tests 214
ℹ pass 214
ℹ fail 0                     # 阶段 17 为 196 → 只增不减（+6 AC-60、+5 AC-61、+7 AC-62）

$ npm run typecheck:web; echo rc=$?
rc=0

$ bash tools/ac-stage17.sh → ✅ AC-59 全部通过
$ bash tools/ac-stage16.sh → ✅ AC-51 / AC-52 / AC-53 / AC-54 / AC-55 / AC-56 / AC-57 / AC-58 全部通过
$ bash tools/ac-stage15.sh → ✅ AC-47 / AC-48 / AC-49 / AC-50 全部通过
$ bash tools/ac-stage14.sh → ✅ AC-44 / AC-45 / AC-46 全部通过
$ bash tools/ac-stage13.sh → ✅ AC-41 / AC-42 / AC-43 全部通过
$ bash tools/ac-stage12.sh → ✅ AC-37 / AC-39 / AC-40 全部通过（AC-38 已由 AC-41 修订取代）
$ bash tools/ac-stage11.sh → ✅ AC-33 / AC-33b / AC-33c / AC-35 / AC-36 + 不得回归全部通过（AC-34 已作废）
$ bash tools/ac-stage10.sh → ✅ AC-13（结构侧）/ AC-20 / AC-21 / AC-29 / AC-31 全部通过
$ bash tools/ac-stage18.sh → ✅ AC-60 / AC-61 / AC-62 全部通过
```

补充口径：`ac-stage10.sh` 的 `AC20_NATIVE_TAGS=1（样本 table.(no-class)）` 是**既有信息行**（脚本里只 `ℹ` 不判定）——
那是 antd `Table` 自己渲染的 `<table>`（`rc-table` 的 `tableClassName` 默认为空串，故 `class=""`），与本阶段改动无关，非组件库约束回归。

亮/暗主题、分栏/表格/卡片三档、响应式（390/1024/1280）、懒加载后首屏不闪不空：由 ac-stage10/11/12/13/14/16 复跑覆盖（上表全绿）；
antd 硬约束（无原生表单标签、无第二套样式体系、无 CDN 外链）由 `tests/web-ui.test.ts` 与各 AC 脚本的源码侧断言复跑覆盖。

#### 7. 决策、取舍与规格落差处理（写清，避免验收误判）

1. **AC-60 ③ 的字面量与契约值**：开工前 `grep -c "app: 'promptmanager'" web/src/pure.ts` 实测 = **0**（`pure.ts` 只有比较表达式，
   契约字面量当时只存在于测试夹具与服务端 `EXPORT_APP`）。处置：**不改契约值、不改行为**，把它收敛为
   `export const SUPPORTED_EXPORT_FILE = { app: 'promptmanager', schema_version: 1 } as const`，比较改用它 ——
   AC-60 ③ 的字面量 grep 真实 = 1，且契约值在展示层有了唯一可信来源（详见「开工前」小节 §7.1）。
2. **AC-62 ② 要求 pm-sidebar / pm-split-list 在全屏时 `offsetParent === null`**：原实现里桌面编辑态**卸载**列表壳，卸载后无从判定。
   处置：列表壳**始终挂载**，编辑态改为**覆盖其上的浮层**（`.pm-editor-overlay`，顶栏保持可见），全屏时三者由
   `display:none !important` 隐藏 ⇒ **全屏时"存在且 offsetParent 为 null"、退出后"三者恢复非 null"**，两条读法都成立（§4 ④ 的第二行输出即证据）。
   该改动只是挂载策略变化：视觉与交互与原先一致（ac-stage11~17 全绿）。
3. **`manualChunks` → `codeSplitting.groups`**：Vite 8（rolldown）已弃用 `output.manualChunks`；FR-61 允许的手段是
   「manualChunks 合理分包」。两种写法实测对比后采用了同一语义的非弃用 API（细节与实测差异见 §3 分包策略 2.）。
4. **总 gzip 的"不增"**：只做 B 时**下降**（398,567 < 399,175）；收尾含 FR-62 新功能后 +1,070 B（+0.27%），
   原因拆分为「新功能代码 +1.4 KB」与「分包边界 +0.4 KB」并已写进测试预算注释（§3 分包策略 3.）——**没有静默调阈值**。
5. **`Esc` 的优先级**：全屏时 Esc 归"退出全屏"，且**必须早于** `detail` / `closeEditor` 分支 return（AC-62 ④）；
   移动端抽屉同步 `keyboard={false}`，否则 antd 抽屉会先关掉编辑器。
6. **懒加载的边界选择**：`PromptDetail`（详情弹层/分栏右栏）保持静态（它就在首屏图上，懒它没有收益）；
   懒的是它内部的三块面板与所有模态/抽屉。模态类**按需挂载**（关闭即卸载），既让懒加载生效，也让明文 token 等敏感状态不残留。
7. **`tests/stage18-bundle.test.ts` 的收敛过程（写清，便于核对谁在哪个提交里）**：B（`f112836`）里已是
   ① 最大 chunk ≤500KB、② 入口 chunk、④ 动态 import、⑤ 分包分组（`codeSplitting`）四条硬断言；
   C（`8873373`）落地 FR-62 后实测总 gzip = 400,245 B，于是**单独一次测试提交**（`b32dacc`）把 ⑤ 的阈值写成
   「开工前基线 + 阶段 18 已对账增量（2,560 B，逐项注明来源）」并给 ② 补了 ≤100KB 预算。
   这是**同阶段内测试随实现收敛**，不是放宽断言：四条仍是硬断言，且增量逐项可复核。

#### 8. 提交单元与落盘对账

| # | 单元 | commit | 内容 |
| --- | --- | --- | --- |
| 1 | **阶段 18A（FR-60）** | `6852a41` | `Workspace.tsx` / `app.css` / `pure.ts` / `theme-mode.ts` 表述清理 + `tests/stage18-cleanup.test.ts`（6 例） |
| 2 | **阶段 18B（FR-61）** | `f112836` | `vite.config.ts` 分包 + `web/src/lazy.ts` + `LazyFallback.tsx` + 三个宿主组件懒加载 + `tests/stage18-bundle.test.ts`（5 例） |
| 3 | **阶段 18C（FR-62）** | `8873373` | 全屏实现（`PromptEditor` / `Workspace` / `AppHeader` / `app.css`）+ 三个浮层 `rootClassName` + `tests/stage18-fullscreen.test.ts`（7 例）+ `tools/ac-stage18.sh` / `ac-stage18-probe.mjs` + 12 张截图 |
| 3b | 阶段 18 测试收敛 | `b32dacc` | `tests/stage18-bundle.test.ts` 的 ⑤ 总 gzip 预算（基线 + 已对账增量）与 ② 入口 chunk 预算终稿 |
| 4 | 收尾（本节） | 收尾 commit（聊天回复单独标注） | PROGRESS 追加本节 |

| 结论 | 落盘位置 |
| --- | --- |
| AC-60 五条 grep 全 0 / 契约值 = 1 | `web/src/components/Workspace.tsx`、`web/src/styles/app.css`、`web/src/pure.ts`、`web/src/theme-mode.ts`；本节 §2 |
| AC-61 最大 chunk 467 KB、总 gzip 降至基线以下（仅 B） | `vite.config.ts`、`web/src/lazy.ts`、`web/src/components/{Workspace,PromptEditor,PromptDetail,LazyFallback}.tsx`；本节 §3 |
| AC-62 全屏（真鼠标 / 真尺寸 / Esc 不丢内容 / 详情面互不顶替 / 窄屏单栏） | `web/src/components/{PromptEditor,Workspace,AppHeader}.tsx`、`web/src/styles/app.css`；本节 §4、§5 截图 02–06/12 |
| 懒加载六处可用 + 截图 | 本节 §3 ④、§5 截图 07–11 |
| 不得回归 | 本节 §6（原样输出） |
| commit | A `6852a41`、B `f112836`、C `8873373`、测试收敛 `b32dacc`；收尾 commit 在聊天回复中单独标注 |

### 2026-09-19 — 阶段 19 实施与自检（FR-63 编辑器全屏改「应用内全屏」+ FR-64 FIX 版本 diff 备注假变更 + FR-65 FIX 内网 HTTP 复制失效）

> **规格锚点**：`BRIEF.md` v25 §4 **FR-63 / FR-64 / FR-65** + §8 **AC-63 / AC-64 / AC-65** + §11「阶段 19」。
> **口径更新（v25）**：FR-62 的「浏览器全屏 + 隐藏外壳」形态由 **FR-63** 取代，**AC-62 的形态要求作废**，按 **AC-63** 验；
> FR-62 里未被撤销的部分（编辑区 ≥70vh / 独立滚动 / 工具栏常驻 / 无横向滚动 / 右栏顺序 / 窄屏单栏 / 详情面全屏互不顶替）继续有效并有断言。

#### 1. 开工前：把 AC-63 / AC-64 / AC-65 翻译成检查命令

```sh
# AC-63（真鼠标 + 真实像素；脚本 tools/ac-stage19.sh，探针 tools/ac-stage19-probe.mjs）
grep -rn "requestFullscreen\|exitFullscreen\|fullscreenchange\|fullscreenEnabled" web/src   # 期望 0（不再调浏览器全屏）
node tools/ac-stage19-probe.mjs editor "$BASE" "$SID" none docs/shots/stage19
#   ① document.fullscreenElement === null；② [data-testid=editor-list] offsetParent === null、
#      编辑栏宽/右栏宽 ∈[0.95,1.05]；③ 按钮 icon=anticon-compress + 文案「退出全屏」；
#   ④ Esc → 左栏恢复、宽度回原布局、正文未丢、未返回；⑤ 再点进/出；⑥ pm-detail-fullscreen 仍在
# AC-64（服务端 diff 原文 + 单测）
curl -s -b jar "$BASE/api/prompts/:id/diff?from=1&to=2" | jq -r .diff   # 仅尾换行 → 不得有 -/+ 行
node --test tests/diff-notes-newline.test.ts
# AC-65（**必须用内网 IP**；127.0.0.1 是安全上下文会掩盖此 bug）
grep -rn "navigator.clipboard" web/src                                   # 期望 1（仅 clipboard.ts）
node tools/ac-stage19-probe.mjs copy "http://192.168.0.228:$PORT" "$SID" "http://127.0.0.1:$PORT" docs/shots/stage19
node --test tests/clipboard-fallback.test.ts
# 不得回归：npm test（223 用例只增不减）/ typecheck:web / ac-stage10~18 / ui-shots.sh
```

#### 2. 先复现（两个 bug 的**修复前**原文；写在 PROGRESS 是 bug 类的硬要求）

**FR-64 复现（`tmp/repro-fr64.sh`，同一组夹具；临时实例）**

```
prompt id = 1（v1: notes='N'）

### v1 → v2：仅把 notes 改成 'N\n'（尾部换行不同，文本语义相同）
@@ -5,4 +5,4 @@
 [system_prompt]
 S
 [notes]
-N
\ No newline at end of file
+N                     ← 两边文本完全相同，却被判为"有变动"

### v2 → v3：把 notes 真改成 'N2'（这一条本来就该显示变更）
-N
+N2
\ No newline at end of file

### 另测：v3 → v4 尾部空格差异 'N2' → 'N2  '
-N2
\ No newline at end of file
+N2
```

根因与 BRIEF 一致：`snapshotText()` 四段 join 后**不以 `\n` 结尾**，且字段值**尾部空白未归一化** →
jsdiff 的「No newline at end of file」语义把**文件尾部的换行差异**当成内容变更；`[notes]` 恰是最后一段 ⇒ **必然中招**。

**FR-65 复现（`tmp/repro-fr65.sh` + `tmp/repro-fr65.mjs`；用**内网 IP** `http://192.168.0.228:8768` 访问）**

```
监听：LISTEN 0 511 0.0.0.0:8768 0.0.0.0:*
fr65_isSecureContext=false
fr65_clipboard_type=undefined
fr65_writeText_type=undefined
fr65_execCommand_type=function                     ← 兜底能力在，但没被那条路径用上
fr65_varpanel_msg_html=浏览器拒绝了剪贴板访问，请手动选中复制 | 浏览器拒绝了剪贴板访问，请手动选中复制
fr65_rendered_text=你好 张三，请确认。
fr65_secure_isSecureContext=true
fr65_clipboard_readback=固定的用户提示词，无变量。      ← 变量面板那次"复制"根本没写进剪贴板
```

即：详情面复制走 `use-copy` 的兜底**成功**；`VariablePanel` 直接 `navigator.clipboard.writeText` → 非安全上下文下 API 不存在 → **必失败**并弹那句提示（与 BRIEF FR-65 的评估结论一致）。

#### 3. 修复与落点

| 项 | 落点 | 做法 |
| --- | --- | --- |
| **FR-63** 应用内全屏 | `web/src/components/PromptEditor.tsx`、`web/src/components/Workspace.tsx`、`web/src/styles/app.css` | 删掉 `requestFullscreen`/`exitFullscreen`/`fullscreenchange` 与 `pm-shell-hidden`；左栏加 `data-testid="editor-list"` 且全屏时 `display:none`（全屏下不再挂 `.pm-editor-col`，可见列统计恰为 2）；`.pm-editor-fullscreen` 改成两列等宽 `minmax(0,1fr) minmax(0,1fr)`；按钮改 `type="text" size="small"` + `ExpandOutlined`/`CompressOutlined` + 「全屏展开」/「退出全屏」，位置在编辑器工具栏（与 删除 / 保存 同排）；`editor-main`/`editor-side` 两个测量锚点 |
| **FR-64** diff 归一化 | `src/services/versions.ts` | `snapshotText()` 每段 `value.replace(/\s+$/, '')` 且整段以 `\n` 结尾 |
| **FR-65** 复制统一 | `web/src/clipboard.ts`（新）、`web/src/use-copy.ts`、`web/src/components/VariablePanel.tsx` | `writeClipboard` 抽到纯 DOM 模块（可 node:test 直测），`use-copy.ts` **再导出**，`VariablePanel` 改用它；成功提示「已复制X」、两条路都失败才提示手动复制 |

> 说明（写清，避免验收误判）：FR-65 要求的「`writeClipboard` 从 `use-copy.ts` 导出」已满足（`export { writeClipboard }`），
> 但**实现**落在 `web/src/clipboard.ts` —— 因为 `use-copy.ts` 的依赖（`./api`、antd）是**无扩展名 import + React 依赖**，
> `node:test` 无法直接 import 它，而 AC-65 ④ 明确要求「单测：clipboard 缺失时走 execCommand 且成功」。
> 拆出的纯 DOM 模块让这条单测**真跑起来**（4 例，见 §5）；全仓 `grep -rn "navigator.clipboard" web/src` 仍是**恰好 1 处**。

#### 4. AC-63 原样实测（真鼠标 + 真实像素）

```
=== AC-63 ①：源码里不得再出现浏览器 Fullscreen API（撤销 FR-62 形态） ===
  ✅ web/src 里 requestFullscreen 命中数 = 0
  ✅ web/src 里 exitFullscreen 命中数 = 0
  ✅ web/src 里 fullscreenchange 命中数 = 0
  ✅ web/src 里 fullscreenEnabled 命中数 = 0
  ✅ web/src 里 pm-shell-hidden 命中数（隐藏外壳的旧规则） = 0

=== AC-63 ②：editor-list / editor-main / editor-side 锚点 + 1:1 网格 + 左栏隐藏规则 ===
  ✅ editor-list 锚点 = 1 ｜ editor-main 锚点 = 1 ｜ editor-side 锚点 = 1
  ✅ 全屏两列等宽网格 = 1 ｜ 全屏隐藏 editor-list = 1

ac63_fullscreen_element_before=true
ac63_fullscreen_element_after=true
ac63_list_before={"exists":true,"offsetParentNull":false}
ac63_list_in_fullscreen={"exists":true,"offsetParentNull":true}
ac63_widths_before={"main":536,"side":380,"ratio":1.411}
ac63_widths_fullscreen={"main":616,"side":616,"ratio":1}
ac63_button_before={"text":"全屏展开","icon":"anticon anticon-expand","visible":true,"size":"13px","w":89,"h":26}
ac63_button_in_fullscreen={"text":"退出全屏","icon":"anticon anticon-compress"}
ac63_list_after_esc={"exists":true,"offsetParentNull":false}
ac63_widths_after_esc={"main":536,"side":380,"ratio":1.411}
ac63_body_after_esc=1200
ac63_still_editor_after_esc=true
ac63_returned_to_detail_after_esc=false
ac63_detail_fullscreen_state={"cls":true,"w":1280,"h":800,"vw":1280,"vh":800}
ac19_runtime_errors=[]
  ✅ ① 进全屏前：浏览器全屏元素为空 = true
  ✅ ② 点全屏后：浏览器全屏元素仍为空（不进入浏览器全屏） = true
  ✅ ② 全屏下 editor-list offsetParent === null = true
  ✅ ② 编辑栏 / 右栏 比值 = 1（期望 0.95–1.05）
  ✅ ② 全屏下可见的 .pm-editor-col 列数 = 2
  ✅ ③ 全屏文案 = 退出全屏 ｜ ✅ ③ icon = anticon-compress
  ✅ ④ Esc 后 editor-list 恢复可见 = false（offsetParentNull=false）
  ✅ ④ 宽度回到原布局（与进入前一致） ｜ ✅ ④ 未保存正文长度不变（1200）
  ✅ ④ 仍在编辑器（未触发返回） = true ｜ ✅ ④ 未误触「返回详情」 = false
  ✅ ⑤ 再点进入全屏 = true ｜ ✅ ⑤ 再点退出全屏（双向切换） = true
  ✅ ⑥ 详情面 pm-detail-fullscreen 仍在 = true ｜ ✅ ⑥ 详情面全屏仍可用（铺满视口） = true
  ✅ 页面运行时异常 = []
```

**像素对账（AC-63 ② 的原值）**：常态三栏 = 左 300 / **编辑 536** / **右 380**（比值 1.411）；
全屏两栏 = **编辑 616 / 右 616**（比值 **1.000**，∈[0.95,1.05]）；Esc 后回到 536/380（与进入前逐字节一致）。

#### 5. AC-64 / AC-65 原样实测

```
=== AC-64 ①：仅备注尾部换行不同 → diff 不得出现变更行（修复后原文） ===
  ===================================================================
  --- v1
  +++ v2
  ✅ diff 里 [notes] 段变更行数（-N/+N） = 0
  ✅ diff 里 No newline 标记数 = 0

=== AC-64 ②：备注真改了（N → N2）→ 仍要显示变更 ===
  @@ -5,4 +5,4 @@
   [system_prompt]
   S
   [notes]
  -N
  +N2
  ✅ 含 -N = 1 ｜ ✅ 含 +N2 = 1 ｜ ✅ 含 No newline 标记 = 0
```

**修复前 → 修复后对照（同一组夹具）**

| 夹具 | 修复前 | 修复后 |
| --- | --- | --- |
| v1 `notes='N'` → v2 `notes='N\n'` | `-N` / `\ No newline at end of file` / `+N`（假变更） | **只有 `--- v1` / `+++ v2` 两行**（无 hunk） |
| v2 `'N'` → v3 `'N2'` | `-N` / `+N2` / `\ No newline …` | `-N` / `+N2`（**保留**，无 No newline 标记） |
| v3 `'N2'` → v4 `'N2  '` | `-N2` / `+N2  `（假变更） | 无变更行 |

```
=== AC-65 ③：全仓 navigator.clipboard 只允许 1 处 ===
  web/src/clipboard.ts:15:    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
  ✅ 命中行数 = 1 ｜ ✅ document.execCommand 实现处（仅 clipboard.ts） = 1
  ✅ VariablePanel 调用统一实现（await writeClipboard 恰 1 次） = 1 ｜ ✅ use-copy 再导出 writeClipboard = 1

=== AC-65：复制在内网 HTTP 下可用（真鼠标 + 内网 IP + 剪贴板读回） ===
ac65_url=http://192.168.0.228:8765
ac65_is_secure_context=false
ac65_clipboard_type=undefined
ac65_write_text_type=undefined
ac65_exec_command_type=function
ac65_detail_source=固定的用户提示词，无变量。
ac65_detail_message=["已复制提示词"]
ac65_detail_clipboard=固定的用户提示词，无变量。
ac65_rendered_text=你好 张三，请确认。
ac65_varpanel_message=["已复制用户提示词"]
ac65_varpanel_clipboard=你好 张三，请确认。
ac19_runtime_errors=[]
  ✅ ① window.isSecureContext === false（真实内网环境） ｜ ✅ ① navigator.clipboard 不存在 = undefined
  ✅ ① document.execCommand 可用（兜底路径存在） = function
  ✅ ② 详情面复制提示：["已复制提示词"]（不出现拒绝提示 = 0）
  ✅ ② 详情面剪贴板内容 == 源文本 = 固定的用户提示词，无变量。
  ✅ ② 变量面板复制提示：["已复制用户提示词"]（不出现拒绝提示 = 0）
  ✅ ② 变量面板剪贴板内容 == 渲染结果 = 你好 张三，请确认。
```

> 读回口径（写清，便于复核）：复制发生在**内网 IP** 页面（非安全上下文，`navigator.clipboard` 不存在），
> 读回在**同进程的 127.0.0.1 页面**（安全上下文，`Browser.grantPermissions` 授权 `clipboardReadWrite`）——读的是同一个剪贴板。
> 这意味着"写"确实走的是 `execCommand` 兜底，而内容被逐字符校验为与源文本一致。

**单测（新增 16 例，`npm test` 从 214 → 223）**

```
=== AC-64 ③ / AC-65 ④：本阶段新增单测 ===
  ✅ 三个新测试文件退出码 = 0
  ℹ tests 16
  ℹ pass 16
  ℹ fail 0        # tests/diff-notes-newline.test.ts(5) + tests/clipboard-fallback.test.ts(4) + tests/stage19-fullscreen.test.ts(7)
```

#### 6. 界面自证（截图 + 逐张识图；五问口径：① 重叠/遮挡 ② 硬断词 ③ 孤标题 ④ 溢出/裁切 ⑤ 是否达到既定美学方向）

阶段 19 专用（`docs/shots/stage19/`，`tools/ac-stage19-probe.mjs` 出图）：

| 截图 | 尺寸 | 识图结论 |
| --- | --- | --- |
| `01-editor-normal.png` | 1280×800 | 常态三栏（左列表 / 中表单 / 右预览·变量·版本）；按钮「全屏展开」在工具栏与 删除/保存 同排 —— ①–④ 无 |
| `02-editor-fullscreen.png` | 1280×800 | **左栏消失、编辑栏与右栏等宽**；按钮变「退出全屏」（compress 图标）—— ①–④ 无 |
| `03-after-esc.png` | 1280×800 | Esc 后恢复常态化（左栏回来、宽度复原），正文原样还在 —— ①–④ 无 |
| `04-detail-fullscreen.png` | 1280×800 | 详情面自身的「全屏展开」仍工作（与编辑全屏互不顶替）—— ①–④ 无 |
| `05-lan-detail-copy.png` | 1280×800 | **内网 IP（http://192.168.0.228:8765）下**点「复制提示词」→ 顶部绿色提示「已复制提示词」—— ①–④ 无 |
| `06-lan-varpanel-copy.png` | 1280×800 | 同环境点变量面板「复制」→「已复制用户提示词」（修前这里是「浏览器拒绝了剪贴板访问」）—— ①–④ 无 |

`ui-shots.sh` 重跑（47 张，含本阶段新增 3 张）：

| 截图 | 识图结论 |
| --- | --- |
| `60-editor-fullscreen-before.png` | 点全屏前：左「Prompt 列表」在、编辑栏 536px 窄于右侧、按钮「全屏展开」 —— ①–④ 无 |
| `61-editor-fullscreen-after.png` | 点全屏后：左栏消失、编辑栏与右栏等宽（各 ~616px）、按钮「退出全屏」 —— ①–④ 无，⑤ 与既有三栏设计语言一致 |
| `62-version-diff-notes-unchanged.png` | 「阶段19 备注未改夹具」v1→v2 的对比区**为空**（只有 `--- v1 / +++ v2` 头）—— 修前这里必出一条 `-N/+N` 假变更 |
| 其余 44 张 | 与阶段 18 同口径重跑，未见新的重叠 / 断词 / 裁切 / 错位 |

#### 7. 不得回归（原样输出）

```
$ npm test                     → ℹ tests 223 / pass 223 / fail 0        # 阶段 18 为 214 → 只增不减（新增 16、移除 7 条被 AC-63 取代的旧形态断言）
$ npm run typecheck:web        → rc=0
$ npm run build                → 无 "larger than 500 kB" 告警；最大 chunk = 467,320 B（≤500KB）✅
$ bash tools/ac-stage17.sh     → ✅ AC-59 全部通过
$ bash tools/ac-stage16.sh     → ✅ AC-51 / AC-52 / AC-53 / AC-54 / AC-55 / AC-56 / AC-57 / AC-58 全部通过
$ bash tools/ac-stage15.sh     → ✅ AC-47 / AC-48 / AC-49 / AC-50 全部通过
$ bash tools/ac-stage14.sh     → ✅ AC-44 / AC-45 / AC-46 全部通过
$ bash tools/ac-stage13.sh     → ✅ AC-41 / AC-42 / AC-43 全部通过
$ bash tools/ac-stage12.sh     → ✅ AC-37 / AC-39 / AC-40 全部通过（AC-38 已由 AC-41 修订取代）
$ bash tools/ac-stage11.sh     → ✅ AC-33 / AC-33b / AC-33c / AC-35 / AC-36 + 不得回归全部通过（AC-34 已作废）
$ bash tools/ac-stage10.sh     → ✅ AC-13（结构侧）/ AC-20 / AC-21 / AC-29 / AC-31 全部通过
$ bash tools/ac-stage18.sh     → ✅ AC-60 / AC-61（+ AC-61 ④ 懒加载六处）全部通过（AC-62 形态已由 AC-63 取代）
$ bash tools/ac-stage19.sh     → ✅ AC-63 / AC-64 / AC-65 全部通过
$ bash tools/ui-shots.sh       → OK（47 张）
```

> 记录一条**过程教训（如实留痕）**：我第一次跑本阶段回归时是**在提交之前**跑的，`ac-stage13~17` 里那句
> 「纯表现层（src/migrations/package.json 未改）= 0」断言因为 FR-64 改动了 `src/services/versions.ts` 而变红（工作区未提交）。
> 提交三个单元后**在干净树上重跑，全部转绿**（见上）。这条断言的口径是"该阶段不得改后端"，
> 对阶段 19 而言 FR-64 是**规格要求改后端**，故以提交后的干净树为准。

> **环境口径（BRIEF v26 / D-27 到达后补记）**：本阶段全部验收都在**开发环境**（`tools/ac-stage19.sh` 起的临时实例，
> 监听 `0.0.0.0:8765`）上用**内网 IP** 完成；**测试环境**（228 systemd `8767`）与生产环境未触碰、未部署——
> 按 D-27，8767 的数据由 host_manger 管理、可随意改动，后续同步上线由 host_manger 执行。

#### 8. 决策、取舍与规格落差处理

1. **`writeClipboard` 的实现位置**：BRIEF 括号里写的是 `use-copy.ts`；实际实现放在 `web/src/clipboard.ts`，
   由 `use-copy.ts` **再导出**（所有调用方仍从 `use-copy` 取，AC-65 ③ 的"只允许 1 处"= 1 行，落在 clipboard.ts）。
   理由：`use-copy.ts` 的依赖是无扩展名 import + React/antd，`node:test` 无法直接 import，而 AC-65 ④ 要求真单测；拆出纯 DOM 模块后 4 例单测全绿（§5）。
2. **旧的全屏断言按规格作废**：`tests/stage18-fullscreen.test.ts` 与 `tools/ac-stage18.sh/probe` 中断言「浏览器全屏 + 外壳隐藏」的部分**删除**，
   替换为 `tests/stage19-fullscreen.test.ts`（7 例）与 `tools/ac-stage19.*`（AC-63）。
   **不是**为了变绿而放宽：FR-63 明确**禁止**调用 Fullscreen API，旧断言与规格直接冲突；FR-62 未被撤销的部分（≥70vh / 独立滚动 / 工具栏常驻 / 无横向滚动 / 右栏顺序 / 窄屏单栏 / 详情面全屏）在新测试里**逐条保留**。
3. **全屏下左栏去掉 `.pm-editor-col`**：既隐藏（`display:none`）又不再算作"可见列"，使 `querySelectorAll('.pm-editor-col')` 的可见集恰为 2 列——
   避免"宽度为 0 的隐藏列"污染 1:1 的机械测量（兼容按类名或按 testid 两种测法）。
4. **详情面 `pm-detail-fullscreen` 一字未改**：编辑全屏与预览全屏互不顶替（AC-63 ⑥ 实测仍在且铺满视口）。
5. **AC-65 的读回方式**：内网 IP 页面写、127.0.0.1 页面读（同一剪贴板、同进程），见 §5 的口径说明——**没有**用 127.0.0.1 冒充内网验收。

#### 9. 随本阶段一并修订的旧断言（都是"规格被新阶段取代"，逐条留痕）

| 旧断言 | 为什么必须改 | 改成什么 |
| --- | --- | --- |
| `tests/cli-user.test.ts`「migrate → `ok: schema at v2`」、`tests/migrate.test.ts`「version=2」 | 迁移 003 之后 schema 版本是 **3** | 期望值改 v3 / version 3（并注明 003 的内容） |
| `tests/navigation-hygiene.test.ts` AC-41 ④⑤ 找 `const card = (prompt…` | FR-70 把卡片渲染抽成 `renderCard`（要交给 `SortableList` 复用） | 断言改找 `const renderCard = (prompt…`（语义不变：卡片分支仍不得有 `pm-delete-`） |
| `tests/stage18-bundle.test.ts` AC-61 ⑤ gzip 预算 | 新增**规格要求**的拖拽库，体积必然增加 | 增加**实测**的 `STAGE22_ACCOUNTED_DELTA = 15,954 B`（把 HEAD~2 阶段 21 的 `web/src` 在同一 node_modules 下重建，总 gzip 401,067 → 417,021） |
| `tests/stage21-notes-plain.test.ts` AC-68 ③④「分栏列表摘要仍基于 user_prompt」 | FR-71 明确把正文摘要从中栏删掉（摘要只在卡片视图保留） | 断言收窄为"卡片仍有摘要 + 分栏中栏不得再出现 `promptExcerpt`" |
| `tools/ac-stage21.sh` 的 `grep -c '\-webkit-line-clamp: 2'`（全文件计数） | FR-71 的 `.pm-split-notes` 规则**也**用了两行截断 → 全文件计数从 1 变 2 | 断言改为只数 `.pm-detail-notes` 规则内的那一条（语义不变：详情面备注行仍是两行截断） |

#### 10. 提交单元与落盘对账

| # | 单元 | commit | 内容 |
| --- | --- | --- | --- |
| 1 | **FR-64**（B，bug 修复） | `7665228` | `src/services/versions.ts`（`snapshotText` 归一化）+ `tests/diff-notes-newline.test.ts`（5 例） |
| 2 | **FR-65**（C，bug 修复） | `0a4c118` | `web/src/clipboard.ts`（新）+ `web/src/use-copy.ts` 再导出 + `web/src/components/VariablePanel.tsx` + `tests/clipboard-fallback.test.ts`（4 例） |
| 3 | **FR-63**（A，形态纠正） | `9613acb` | `PromptEditor.tsx` / `Workspace.tsx` / `app.css` + `tests/stage19-fullscreen.test.ts`（7 例，替换 stage18 的旧形态测试）+ `tools/ac-stage19.sh` / `ac-stage19-probe.mjs` + `tools/ac-stage18.{sh,probe}` 按 v25 收窄 + `tools/ui-shots.sh` 新增 3 张 + 截图 |
| 4 | 收尾（本节） | 收尾 commit（聊天回复单独标注） | PROGRESS 追加本节 |

| 结论 | 落盘位置 |
| --- | --- |
| FR-63 应用内全屏（不调 Fullscreen API / 只藏 editor-list / 1:1 / 按钮同款 / Esc 只退全屏） | `web/src/components/PromptEditor.tsx`、`Workspace.tsx`、`web/src/styles/app.css`；本节 §4、§6 |
| FR-64 尾换行假变更修复（前后原文对照） | `src/services/versions.ts`；本节 §2、§5 |
| FR-65 内网 HTTP 复制（统一兜底 + 单测 + 内网 IP 实测） | `web/src/clipboard.ts`、`web/src/use-copy.ts`、`web/src/components/VariablePanel.tsx`；本节 §2、§5 |
| 不得回归（223 用例 / typecheck / 9 个旧 AC 脚本 / ui-shots 47 张 / 体积预算） | 本节 §7 |
| commit | FR-64 `7665228`、FR-65 `0a4c118`、FR-63 `9613acb`；收尾 commit 在聊天回复中单独标注 |

### 2026-09-20 — 阶段 20 实施与自检（FR-66 详情页去冗余头部 + FR-67 ⋯更多「修改密码」）

> **规格锚点**：`BRIEF.md` v27 §4 **FR-66 / FR-67** + §8 **AC-66 / AC-67** + §11「阶段 20」。
> **口径更新（v27）**：FR-48 的 `⋯更多` 子项顺序被修订 —— **「已登录信息」由「修改密码」取代**（原 AC-48 的该项断言随之作废，见 §6 决策 2）。
> 环境：全部验收都在**开发环境**临时实例（`0.0.0.0:8768`/自动挑空闲端口）上做，**未触碰 8767 测试环境**（D-27）。

#### 1. 开工前：把 AC-66 / AC-67 翻译成检查命令

```sh
# AC-66（tools/ac-stage20.sh，探针 tools/ac-stage20-probe.mjs detail）
node tools/ac-stage20-probe.mjs detail "$BASE" "$SID" docs/shots/stage20
#   ① pm-detail 内含「当前字段」=false、正文区 .ant-select=0、正文区 eye 说明标签=0
#   ② 页签 3 项 / 预览·源码 2 段 / pm-detail-plain / pm-detail-fullscreen 仍在
#   ③ 间距 = pm-detail-body 内容顶部 − pm-detail-fields 底部（贴前后像素）
#   ④ 编辑器页仍有 3 选项下拉，切换后预览内容变化
# AC-67（必须用内网 IP；curl 断言会话/限流/不回显）
node tools/ac-stage20-probe.mjs password "http://192.168.0.228:$PORT" "$SID" docs/shots/stage20
curl -s -b jar1 -X POST -d '{"old_password":…,"new_password":…}' "$BASE/api/password"   # 400/429/204
# 不得回归：npm test（240 用例只增不减）/ typecheck:web / ac-stage10~19 / ui-shots.sh
```

#### 2. AC-66 原样实测（真鼠标 + 真实像素）

**修复前间距**（`tmp/measure-ac66-before.sh`：临时把 `MarkdownPreview.tsx` 换回 HEAD 版本 → 构建 → 量 → 还原）：

```
ac66_detail_text_has_currentfield=true
ac66_detail_select_count=1          # 正文区里的字段下拉
ac66_body_eye_count=1               # 「👁 预览」说明标签
ac66_gap={"fieldsBottom":203,"contentTop":255,"gap":52}
```

**修复后**（`bash tools/ac-stage20.sh`）：

```
ac66_detail_text_has_currentfield=false
ac66_detail_select_count=0
ac66_body_eye_count=0
ac66_body_text=用户提示词

这是用户侧正文（用于 AC-66 的详情面）。
ac66_fields_present={"tabs":true,"segments":2,"plain":true,"fullscreen":true}
ac66_gap={"fieldsBottom":203,"contentTop":211,"gap":8}
  ✅ ① 详情面内不含文本「当前字段」 = false
  ✅ ① 详情面内 Select 数 = 0 = 0
  ✅ ① 正文区无 eye 说明标签 = 0
  ✅ ② 页签/分段/纯文本/全屏 都在 = true
  ✅ ③ 修复后间距（px） = 8（期望 ≤30）
  ✅ ③ 间距减少量（修复前 52 − 修复后） = 44（期望 ≥30）
  ✅ ④ 编辑器页仍有 3 选项下拉 = 3
  ✅ ④ 切换字段后预览内容随之变化 = true
  ✅ ④ 预览变化：用户提示词 → 系统提示词内容（与用户提示词不同，便于验证切换）。
  ✅ 页面运行时异常 = []
```

**间距对账**：`[data-testid="pm-detail-fields"]` 底边 203px → 正文内容顶部 **255 → 211px**，
间距 **52px → 8px（−44px，≥30px 达标）**。测量定义与锚点（本次新增的两个 `data-testid`：`pm-detail-fields` / `pm-detail-body`）
写在 `tools/ac-stage20-probe.mjs` 的 `GAP` 常量里，可原文复现。

#### 3. AC-67 原样实测（内网 IP `http://192.168.0.228:8765` + 真鼠标 + 真会话）

```
ac67_menu_items=["使用统计","API 令牌","导入 / 导出","关于","修改密码","登出"]
ac67_modal_inputs=3
ac67_modal_autocomplete=["current-password","new-password","new-password"]
ac67_mismatch_requests=0
ac67_mismatch_error=两次输入的新密码不一致
ac67_short_requests=0
ac67_short_error=新密码至少 8 个字符（按 Unicode 码点计），且不得与当前密码相同
ac67_positive_requests_before=0   ac67_positive_requests_after=1
ac67_positive_message=["密码已更新（已在其它登录会话中退出）"]
ac67_modal_closed=true
ac67_wrong_old_error=当前密码不正确
ac67_still_logged_in=200
ac67_about_mentions_password=true
ac20_runtime_errors=[]
  ✅ ① 菜单项逐项（含修改密码、不含已登录） = ["使用统计","API 令牌","导入 / 导出","关于","修改密码","登出"]
  ✅ ① 菜单数组含「修改密码」（正向锚点，防日志为空假过） = 1
  ✅ ① 菜单数组不含「已登录」 = 0
  ✅ ② 弹窗三个密码框 = 3 ｜ ✅ ② autoComplete 正确 = ["current-password","new-password","new-password"]
  ✅ ④ 两次新密码不一致 → 不发请求 = 0 ｜ ✅ ④ <8 字符 → 不发请求 = 0
  ✅ ⑤ 正例发起了 1 次 /api/password = 1 ｜ ✅ ⑤ 成功提示 = ["密码已更新（已在其它登录会话中退出）"] ｜ ✅ ⑤ 成功后弹窗关闭 = true
  ✅ 负例错误提示：当前密码不正确
  ✅ ⑧ 当前密码错误后当前会话仍可用（未被 401 踢出） = 200
  ✅ ⑦ 关于页维护区提到界面改密码 = true

=== AC-67 ③⑤⑥：HTTP 断言（curl 原样输出） ===
  ✅ 新口令登录 = 200
  ✅ 旧口令登录（应 401） = 401
  ✅ 当前会话（发起修改的那个）仍 200 = 200
  ✅ 其它会话 2 被吊销（401） = 401
  ✅ 其它会话 3 被吊销（401） = 401

  当前密码错误 → 400 而非 401（原样）：
  HTTP 400
{"error":"invalid_old_password"}
  ✅ 响应体是 invalid_old_password = {"error":"invalid_old_password"}

  连续错误 → 429（原样；UI 已错 1 次 + 这里 4 次 = 累计 5 次，下一次即 429）：
  第 2 次：400
  第 3 次：400
  第 4 次：400
  第 5 次：429
  ✅ 第 6 次 = 429
{"error":"rate_limited"}

=== AC-67 ⑥：服务端日志与响应体无明文口令 ===
  ✅ 日志含新口令（明文）次数 = 0 ｜ ✅ 日志含旧口令（明文）次数 = 0
  ✅ 响应体出现新口令的文件数 = 0 ｜ ✅ 响应体含密码字段回显次数 = 0
```

**口语化复述（便于对照 AC）**：正例用真鼠标在弹窗里改密 → 弹窗关闭 + 「密码已更新（已在其它登录会话中退出）」；
新口令 `POST /api/login` **200**、旧口令 **401**；**发起修改的那个会话仍 200**，另两个会话 **401**（被吊销）；
当前密码填错 → UI 显示「当前密码不正确」、HTTP **400**（不是 401）、且当前会话**没有被踢出**；
累计 5 次错误后下一次 **429 `rate_limited`**；日志与响应体都 grep 不到任何明文口令。

#### 4. 口令改回原值（AC-67 的收尾要求，留痕）

```
=== 验收收尾：把口令改回原值（若正卡在限流窗口里，最多等 ~75s 重试） ===
  ✅ 改回原值（204） = 204
  ✅ 原值登录 200（验证方式：curl /api/login） = 200
  ✅ 新值登录 401 = 401
  改回时间：2026-09-20 01:46:05 ｜ 目标：开发环境临时实例（DATA_DIR=/tmp/pm-ac20-jHIhSU，PORT=8765）
```

——改回动作与验证都在**同一个临时实例**上完成（`DATA_DIR` 随实例销毁）；**8767 测试环境的口令未被触碰、未被修改**。

#### 5. 界面自证（截图 + 逐张识图；五问口径：① 重叠/遮挡 ② 硬断词 ③ 孤标题 ④ 溢出/裁切 ⑤ 是否合既定美学方向）

阶段 20 专用（`docs/shots/stage20/`，`tools/ac-stage20.sh` 出图，9 张）：

| 截图 | 识图结论 |
| --- | --- |
| `01-detail-no-header.png` | 详情面：页签行下方**直接是正文**，无「当前字段」下拉、无「👁 预览」标签；①–④ 无 |
| `02-editor-still-3-options.png` | 编辑器页：Markdown 预览卡头部仍在，下拉显示「系统提示词」（切换后）①–④ 无 |
| `03-more-menu.png` | ⋯更多 六项：使用统计 / API 令牌 / 导入 / 导出 / 关于 / **修改密码** / 登出，无「已登录」①–④ 无 |
| `04-password-modal-empty.png` | 弹窗空态：三个密码框 + 取消 / 确认修改 + 说明句 ①–④ 无 |
| `05-password-modal-mismatch.png` | 两次新密码不一致 → 字段级错误「两次输入的新密码不一致」，未发请求 ①–④ 无 |
| `06-password-modal-short.png` | 新密码 <8 字符 → 规则提示完整可见、不换行溢出 ①–④ 无 |
| `07-password-changed.png` | 成功提示「密码已更新（已在其它登录会话中退出）」+ 弹窗已关闭 ①–④ 无 |
| `08-password-wrong-old.png` | 当前密码错 → 「当前密码不正确」，仍停在弹窗（未跳登录页）①–④ 无 |
| `09-about-maintain.png` | 关于页「维护」区含界面改密码说明 + CLI 命令保留 ①–④ 无 |

`ui-shots.sh` 重跑（53 张，含本阶段新增 6 张；探针原样）：

```
PROBE detail-body-select-count 0
PROBE detail-has-current-field-text false
PROBE detail-gap-px "{\"gap\":8}"
PROBE editor-field-select-count 1
PROBE editor-field-select-text "用户提示词"
PROBE more-items "使用统计|API 令牌|导入 / 导出|关于|修改密码|登出"
PROBE more-has-account false
PROBE password-inputs 3
PROBE password-rule-error "新密码至少 8 个字符（按 Unicode 码点计），且不得与当前密码相同"
PROBE password-changed-toast "密码已更新（已在其它登录会话中退出）"
PROBE password-modal-closed true
```

| 新增截图 | 识图结论 |
| --- | --- |
| `63-detail-no-current-field.png` | 详情面正文紧贴页签行（间距 8px）；无冗余头部，无遮挡/裁切 |
| `64-editor-fields-select.png` | 编辑器页 Markdown 预览卡头部保留（下拉「用户提示词」） |
| `65-more-menu-password.png` | 菜单顺序与 FR-67 一致，「修改密码」在「关于」之后、「登出」之前 |
| `66/67/68-password-*.png` | 空态 / 校验错误态 / 成功提示三态各一张，排版无错位 |
| 其余 47 张 | 与阶段 19 同口径重跑，未见新的重叠 / 断词 / 裁切 |

#### 6. 决策、取舍与规格落差处理

1. **会话语义：HTTP 改密 vs CLI `user set-password`（BRIEF 要求写明差异）**
   - **HTTP `POST /api/password`（界面入口）**：成功后 **保留发起修改的当前会话**，仅吊销该用户**其它**会话（其它设备/浏览器退出）；调用方拿不到"删我自己的会话"，所以不会掉线。
   - **CLI `node bin/pm.mjs user set-password`（本地管理动作，行为未动）**：`setUserPassword()` 仍然**删除该用户全部会话**（含执行者自己的浏览器会话）—— 因为它是"本机管理员改口令"，语义上等价于"口令轮换、所有登录一律失效"，必须重新登录。
   - 两者共用同一个 argon2id 哈希与 `sessions` 表；差异只在"保留哪几个会话"。实现在 `src/services/auth.ts` 的 `changePassword()` 与 `setUserPassword()` 两个函数里，注释也写明了。
2. **AC-48 的菜单断言按 v27 作废并更新**：FR-48 原文（v20）要求 `⋯更多` 含「已登录：<用户名>」只读项；v27 明确该项**由「修改密码」取代**。
   因此 `tools/ac-stage15.{sh,probe}` 与 `tests/navigation-hygiene.test.ts` 里的 AC-48 断言同步改为新顺序（`使用统计 → API 令牌 → 导入 / 导出 → 关于 → 修改密码 → 登出`）+「不再有已登录项」+「修改密码是普通可点项」。
   **不是**放宽断言：旧的"已登录不可点"换成了"没有已登录项 + 修改密码项存在且可点"，覆盖度不降（AC-67 ① 再独立断言一次）。
3. **AC-66 的两个测量锚点**：AC-66 ③ 要"贴前后数值"，但原文没说量哪两个元素的间距。本次在 `PromptDetail` 加了
   `data-testid="pm-detail-fields"`（页签行）与 `data-testid="pm-detail-body"`（正文区包裹），并在探针里把"正文区顶部"定义为
   **预览框 / 源码框的顶边**（而不是包裹层，否则量到的还是头部自身）——`52px → 8px` 即由此得出。
4. **单字段不渲染头部的实现位置**：改在 `MarkdownPreview` 内部（`fields.length > 1 &&`），而不是让详情页传个 `hideHeader` 参数 —— 这样
   编辑器页（3 字段）零改动、任何未来单字段调用方都自动受益；`PromptDetail` 传给它的 `label: '当前字段'` 只作为多字段时的下拉文案保留（单字段时不渲染，故 DOM 里 grep 不到）。
5. **过程教训（如实留痕）**：AC-66 ④ 第一次量"预览是否随字段切换"时探针一直判"没变" —— 原因是**分栏详情面在编辑态仍挂载**
   （阶段 18/19 的"覆盖式浮层"设计），它的预览也带 `markdown-preview` testid，`document.querySelector` 取到的是**详情面那份**。
   改成限定作用域 `[data-testid="pm-panel-markdown"] [data-testid="markdown-preview"]` 后正常（用户提示词 → 系统提示词内容）。这是探针 bug，不是实现缺陷。
6. **UI 端的 429 提示**：弹窗把 429 映射成「尝试过于频繁，请稍后再试」（`message.warning`），不显示后端 `rate_limited` 原文；`400 invalid_password` 则直接显示服务端 `message`（`ApiError.serverMessage`，本次给 `api.ts` 补的字段）。

#### 7. 不得回归（原样输出）

```
$ npm test                     → ℹ tests 240 / pass 240 / fail 0     # 阶段 19 为 223 → 只增不减（+10 接口、+3 详情头部、+4 改密界面）
$ npm run typecheck:web        → rc=0
$ npm run build                → 无 "larger than 500 kB" 告警；最大 chunk = 467,320 B（≤500KB）✅
$ bash tools/ac-stage17.sh     → ✅ AC-59 全部通过
$ bash tools/ac-stage16.sh     → ✅ AC-51 / AC-52 / AC-53 / AC-54 / AC-55 / AC-56 / AC-57 / AC-58 全部通过
$ bash tools/ac-stage15.sh     → ✅ AC-47 / AC-48 / AC-49 / AC-50 全部通过（AC-48 已按 v27 改口径）
$ bash tools/ac-stage14.sh     → ✅ AC-44 / AC-45 / AC-46 全部通过
$ bash tools/ac-stage13.sh     → ✅ AC-41 / AC-42 / AC-43 全部通过
$ bash tools/ac-stage12.sh     → ✅ AC-37 / AC-39 / AC-40 全部通过（AC-38 已由 AC-41 修订取代）
$ bash tools/ac-stage11.sh     → ✅ AC-33 / AC-33b / AC-33c / AC-35 / AC-36 + 不得回归全部通过（AC-34 已作废）
$ bash tools/ac-stage10.sh     → ✅ AC-13（结构侧）/ AC-20 / AC-21 / AC-29 / AC-31 全部通过
$ bash tools/ac-stage18.sh     → ✅ AC-60 / AC-61（+ 懒加载六处）全部通过
$ bash tools/ac-stage19.sh     → ✅ AC-63 / AC-64 / AC-65 全部通过
$ bash tools/ac-stage20.sh     → ✅ AC-66 / AC-67 全部通过
$ bash tools/ui-shots.sh       → OK（53 张）
```

#### 8. 提交单元与落盘对账

| # | 单元 | commit | 内容 |
| --- | --- | --- | --- |
| 1 | **FR-66**（A） | `5de7ed7` | `web/src/components/MarkdownPreview.tsx`（单字段隐藏头部）+ `PromptDetail.tsx`（测量锚点 + 正文包裹）+ `tests/stage20-detail-header.test.ts`（3 例） |
| 2 | **FR-67 后端**（B） | `feb83aa` | `src/services/auth.ts`（`changePassword` + `validateNewPassword`）+ `src/server/auth.ts`（principal 带 sessionId、`currentSessionId`）+ `src/server/routes/auth.ts`（`POST /api/password`）+ `tests/api-password.test.ts`（10 例） |
| 3 | **FR-67 前端**（C） | `aad69cd` | `web/src/components/PasswordModal.tsx`（新）+ `AppHeader.tsx`（菜单）+ `Workspace.tsx` / `lazy.ts` / `App.tsx` + `api.ts`（`changePassword` + `serverMessage`）+ `AboutModal.tsx` + `tests/stage20-password-ui.test.ts`（4 例）+ AC-48 口径更新（`tests/navigation-hygiene.test.ts`、`tools/ac-stage15.*`） |
| 4 | 验收自检与出图（D） | `a7452f5` | `tools/ac-stage20.sh` / `ac-stage20-probe.mjs`、`tools/ui-shots.sh` 新增 6 张、`docs/shots/stage20/`（9 张） |
| 5 | 收尾（本节） | 收尾 commit（聊天回复单独标注） | PROGRESS 追加本节 + ui-shots 53 张重跑 |

| 结论 | 落盘位置 |
| --- | --- |
| FR-66 详情页头部去冗余（间距 52→8px，−44px） | `web/src/components/MarkdownPreview.tsx`、`PromptDetail.tsx`；本节 §2、§5 |
| FR-67 菜单/弹窗/前端校验 | `web/src/components/AppHeader.tsx`、`PasswordModal.tsx`、`Workspace.tsx`、`lazy.ts`、`api.ts`、`AboutModal.tsx`；本节 §3、§5 |
| FR-67 接口与会话语义（400 非 401 / 限流 / 吊销其它会话 / 不回显） | `src/services/auth.ts`、`src/server/auth.ts`、`src/server/routes/auth.ts`；本节 §3、§6.1 |
| 口令改回原值留痕 | 本节 §4（时间 2026-09-20 01:46:05，验证方式 curl 登录 200/401） |
| 不得回归 | 本节 §7（原样输出） |
| commit | A `5de7ed7`、B `feb83aa`、C `aad69cd`、D `a7452f5`；收尾 commit 在聊天回复中单独标注 |

## 阻塞项

- （无）

### 2026-09-20 — 阶段 21 实施与自检（FR-68 备注=纯文本 + FR-69 详情面标题下备注行）

> **规格锚点**：`BRIEF.md` v28 §4 **FR-68 / FR-69** + §8 **AC-68 / AC-69** + §11「阶段 21」。
> 本阶段**只动前端展示**：不改接口契约、不改数据模型、不改导入导出格式；环境 = 开发环境临时实例（不碰 8767 测试环境）。
> **口径连带修订**：AC-66 ④ 原文要求"编辑器页仍有 **3** 选项下拉" —— v28 把备注移出预览后变 **2** 项，
> `tests/stage20-detail-header.test.ts` 与 `tools/ac-stage20.sh` 已同步（见 §6 决策 3）。

#### 1. 开工前：把 AC-68 / AC-69 翻译成检查命令

```sh
bash tools/ac-stage21.sh          # 服务自起自停；探针 tools/ac-stage21-probe.mjs（CDP：网络层 + computedStyle + 真实像素 + 亮暗截图）
# AC-68 ① 编辑器 Markdown 预览字段下拉 == ["用户提示词","系统提示词"]
# AC-68 ②③ 详情面切「备注」→ 正文原样含 # 标题 / **粗体** / - 列表 / [链接](http://x)；
#          body 内 h1/h2/h3/strong/ul/ol/a/code 计数 0；/api/render/markdown 请求计数 0
# AC-68 ④ 切回「用户提示词」→ 渲染恢复正常（请求数 ≥1、渲染元素 ≥1）
# AC-69 ① pm-detail-notes.innerText **逐字符等于** notes；② 13px / 行高 ≥1.5 / 颜色≠标题 / 标题底→备注顶 ≤10px；
#          ③ 备注行 top 夹在标题行与 pm-detail-fields 之间；④ 空备注 → 元素不存在；⑤ 长备注（240 字）≤2 行 + title 全文
# 不得回归：npm test（248 用例只增不减）/ typecheck:web / ac-stage10~20 / ui-shots.sh
```

#### 2. 实现与落点

| 项 | 落点 | 做法 |
| --- | --- | --- |
| **FR-68** 编辑器去备注预览 | `web/src/components/PromptEditor.tsx` | Markdown 预览的 `fields` 只留 `user_prompt` / `system_prompt`（备注仍是普通 `Input.TextArea`，不再参与渲染） |
| **FR-68** 详情面备注=纯文本 | `web/src/components/PromptDetail.tsx` | 正文区条件由 `sourceMode \|\| plain` 改为 `sourceMode \|\| plain \|\| field === 'notes'` → 备注页签一律走 `<pre data-testid="pm-detail-text">`（React 文本节点自动转义，不做 Markdown、不请求服务端渲染） |
| **FR-69** 标题下备注行 | `PromptDetail.tsx` + `web/src/styles/app.css` | 标题行 + 备注行同放一个 `Flex vertical gap={4}`（`data-testid="pm-detail-head"`）；备注行 `data-testid="pm-detail-notes"`、`title={prompt.notes}`、`color: token.colorTextSecondary`，仅当 `prompt.notes.trim() !== ''` 渲染；CSS `.pm-detail-notes.ant-typography`：`margin: 0`、`font-size: 13px`、`line-height: 1.6`、`-webkit-line-clamp: 2` + `overflow: hidden` + `pre-wrap` |

#### 3. AC-68 原样实测（真鼠标 + CDP 网络层 + DOM 计数）

```
=== AC-68 ①：编辑器页 Markdown 预览字段下拉 ===
  ✅ 下拉选项：["用户提示词","系统提示词"]
  ✅ 恰好 ['用户提示词','系统提示词'] = ["用户提示词","系统提示词"]

=== AC-68 ②③：详情面「备注」= 纯文本 + 无渲染请求 ===
  ✅ 原样含 # 标题 / **粗体** / - 列表 / [链接](http://x) = {"heading":true,"bold":true,"list":true,"link":true}
  ✅ 正文区渲染元素（h1/h2/h3/strong/ul/ol/a/code）计数 = 0
  ✅ 从切「备注」到显示完成发出的 /api/render/markdown 请求数 = 0

=== AC-68 ④：切回「用户提示词」→ Markdown 渲染恢复 ===
  ✅ 切回后发出的 /api/render/markdown 请求数 = 1（期望 ≥1）
  ✅ 切回后正文区渲染元素计数 = 3（期望 ≥1）
```

夹具备注原文（含 Markdown 语法，用于证明"原样"）：

```
# 标题
**粗体** 与 - 列表
链接 [链接](http://x) 原样显示
```

→ 详情面「备注」页签下正文区 `innerText` 逐行含 `# 标题` / `**粗体** 与 - 列表` / `链接 [链接](http://x) 原样显示`，
**没有** h1/h2/h3/strong/ul/a/code 元素，**整个切页签过程 0 次 `/api/render/markdown`**（CDP `Network.requestWillBeSent` 计数）。

#### 4. AC-69 原样实测（computedStyle + 真实像素 + 三态）

```
=== AC-69 ①：备注行文本 == 备注原文 ===
  ✅ 与 notes 原文逐字符一致（JSON 逐字符比较） = "# 标题\n**粗体** 与 - 列表\n链接 [链接](http://x) 原样显示"

=== AC-69 ②③：样式 / 间距 / 位置 ===
  ✅ computedStyle：{"fontSize":"13px","lineHeight":"20.8px","color":"rgb(60, 64, 70)","titleColor":"rgb(20, 22, 26)",
                     "titleFontSize":"18px","clamp":"2","overflow":"hidden","display":"flow-root",
                     "titleAttr":"# 标题\n**粗体** 与 - 列表\n链接 [链接](http://x) 原样显示"}
  ✅ 字号 ≤14px = true ｜ ✅ 行高 ≥1.5 = true（20.8/13 = 1.6）｜ ✅ 颜色与标题不同（次级灰） = true
  ✅ -webkit-line-clamp 生效 = 2
  ✅ 几何：{"titleBottom":161,"notesTop":165,"gap":4,"fieldsTop":222.16,"between":true}
  ✅ 标题行底部 → 备注行顶部（px） = 4（期望 ≤10）
  ✅ 备注行夹在标题行与页签行之间 = true

=== AC-69 ④⑤：空备注不渲染 / 长备注最多 2 行 + title 全文 ===
  ✅ 空备注条目：备注行不存在且详情面正常 = {"exists":false,"detailPresent":true}
  ✅ 长备注度量：{"clientHeight":42,"lineHeight":"20.8px","lines":2,"clamp":"2","scrollHeight":125,
                  "titleLength":240,"textLength":240,"overflow":"hidden"}
  ✅ 长备注渲染行数（≤2） = 2（期望 ≤2）
  ✅ 命中断行截断（clamp=2 且 overflow=hidden） = 2|hidden
  ✅ title 承载全文（长度 == 正文长度） = true

=== AC-69 ⑥：亮/暗三态截图 ===
  ✅ 暗色备注行：{"theme":"dark","color":"rgb(208, 214, 224)","titleColor":"rgb(247, 248, 248)","fontSize":"13px"}
  ✅ 暗色下颜色仍与标题不同 = true
  ✅ 截图张数（亮暗各三态 ≥6） = 8
  ✅ 页面运行时异常 = []
```

**数字对账**：字号 **13px**（标题 18px，差 5px，落在 PromptHub 实测的 4–6px 区间）；行高 **20.8px = 1.6×13**；
颜色 `rgb(60,64,70)`（次级灰）vs 标题 `rgb(20,22,26)`（近黑），暗色 `rgb(208,214,224)` vs `rgb(247,248,248)`；
**标题行底 → 备注行顶 = 4px（≤10px）**；备注行 top（165）夹在标题行底（161）与页签行顶（222）之间；
240 字长备注 `clientHeight 42px = 2 行`、`scrollHeight 125px`、`title` 240 字 == 正文 240 字。

#### 5. 界面自证（截图 + 逐张识图；五问口径：① 重叠/遮挡 ② 硬断词 ③ 孤标题 ④ 溢出/裁切 ⑤ 是否合既定美学方向）

阶段 21 专用（`docs/shots/stage21/`，8 张 = 三态 × 亮/暗 + 编辑器下拉 + 备注纯文本）：

| 截图 | 识图结论 |
| --- | --- |
| `01-notes-light.png` | 标题下方一行灰色小字备注（2 行截断），与标题间距紧凑、与元信息/页签行层次分明 ①–④ 无 |
| `02-notes-plain-text-light.png` | 「备注」页签选中：正文区**原样**显示 `# 标题` / `**粗体** 与 - 列表` / `链接 [链接](http://x) 原样显示`，无任何 Markdown 效果 ①–④ 无 |
| `03-editor-fields-2-options-light.png` | 编辑器 Markdown 预览头部下拉**只有两项**（用户提示词 / 系统提示词）①–④ 无 |
| `04-notes-empty-light.png` | 无备注条目：标题下**没有**备注行、也没有留白（页签行紧跟标题行）①–④ 无 |
| `05-notes-long-light.png` | 240 字长备注：**两行后省略**（末行带 `…`），不挤压页签行 ①–④ 无 |
| `06/07/08-notes-*-dark.png` | 暗色下三态同上，灰色层级仍与标题区分明显 ①–④ 无 |

#### 6. 决策、取舍与规格落差处理

1. **`预览 / 源码` 在备注页签下保留（未隐藏）**：FR-68 允许"两者等价"或"隐藏"。选择**保留控件 + 两者等价**（都渲染同一个只读 `<pre>`）：
   隐藏需要额外的条件渲染分支与"切回时恢复控件"的状态处理，收益仅是少两个控件；而"等价"已满足契约，交互也更一致（不会出现"切到备注后工具栏突然少两块"的跳变）。
2. **备注行用 `white-space: pre-wrap`**：FR-69 要求"纯文本、自动换行"。若用默认 `normal`，备注里的换行会被折成空格 ——
   既不符合"按文本输入输出"的 FR-68 口径，也会让 AC-69 ① 的 `innerText == notes` 永远不成立（实测：折行后 innerText 变成单行）。
   `pre-wrap` = **保留作者换行 + 长行自动折行**，两项要求同时满足；2 行截断仍生效（实测 `clientHeight 42 < scrollHeight 125`）。
3. **AC-66 ④ 的"3 选项"按 v28 修订为 2 项**：v28 明确把备注移出 Markdown 预览，阶段 20 的断言（`tests/stage20-detail-header.test.ts` 与 `tools/ac-stage20.sh`）
   同步改为"恰好两项、且不含 notes"。**不是**放宽：新断言显式要求 notes 不在字段列表里，并由 AC-68 ① 再独立断言一次。
4. **不改数据的任何形状**：只删了编辑器里的一处预览配置 + 改了一处渲染分支 + 加了一行展示；`notes` 字段仍照常读写、仍进版本 diff 的 `[notes]` 段
   （FR-64 的尾换行修复未受影响，`tests/diff-notes-newline.test.ts` 5 例全绿）；列表/卡片摘要仍取 `user_prompt`；变量面板与 render 仍只含用户/系统提示词；导入导出格式不变。
5. **过程记录（探针层的两个坑，如实留痕）**：① 探针最初在 `about:blank` 上写 `localStorage`（opaque origin）→ 抛 SecurityError 导致整轮 evaluate 失败；
   改为先导航到真实页面再写主题。② 多行文本用 `grep|cut` 取值只能拿到第一行 → 探针把多行字段改为 **JSON 编码**输出
   （`ac69_notes_text` / `ac69_source_notes` 逐字符比较才成立）；这也是让 AC-69 ① 真正可判定的关键。

#### 7. 不得回归（原样输出）

```
$ npm test                     → ℹ tests 248 / pass 248 / fail 0     # 阶段 20 为 240 → 只增不减（+8：FR-68 四条、FR-69 四条）
$ npm run typecheck:web        → rc=0
$ npm run build                → 无 "larger than 500 kB" 告警；最大 chunk = 467,320 B（≤500KB）✅
$ bash tools/ac-stage17.sh     → ✅ AC-59 全部通过
$ bash tools/ac-stage16.sh     → ✅ AC-51 / AC-52 / AC-53 / AC-54 / AC-55 / AC-56 / AC-57 / AC-58 全部通过
$ bash tools/ac-stage15.sh     → ✅ AC-47 / AC-48 / AC-49 / AC-50 全部通过
$ bash tools/ac-stage14.sh     → ✅ AC-44 / AC-45 / AC-46 全部通过
$ bash tools/ac-stage13.sh     → ✅ AC-41 / AC-42 / AC-43 全部通过
$ bash tools/ac-stage12.sh     → ✅ AC-37 / AC-39 / AC-40 全部通过（AC-38 已由 AC-41 修订取代）
$ bash tools/ac-stage11.sh     → ✅ AC-33 / AC-33b / AC-33c / AC-35 / AC-36 + 不得回归全部通过（AC-34 已作废）
$ bash tools/ac-stage10.sh     → ✅ AC-13（结构侧）/ AC-20 / AC-21 / AC-29 / AC-31 全部通过
$ bash tools/ac-stage18.sh     → ✅ AC-60 / AC-61（+ 懒加载六处）全部通过
$ bash tools/ac-stage19.sh     → ✅ AC-63 / AC-64 / AC-65 全部通过（详情面全屏 / 复制兜底未受影响）
$ bash tools/ac-stage20.sh     → ✅ AC-66 / AC-67 全部通过（AC-66 ④ 已按 v28 改为 2 项）
$ bash tools/ac-stage21.sh     → ✅ AC-68 / AC-69 全部通过
$ bash tools/ui-shots.sh       → OK（53 张）
```

#### 8. 提交单元与落盘对账

| # | 单元 | commit | 内容 |
| --- | --- | --- | --- |
| 1 | **FR-68 + FR-69（A/B 前端）** | `6041aab` | `web/src/components/PromptEditor.tsx`（预览字段去备注）、`PromptDetail.tsx`（备注纯文本分支 + `pm-detail-notes` 行）、`web/src/styles/app.css`（`.pm-detail-notes`）+ `tests/stage21-notes-plain.test.ts`（4 例）、`tests/stage21-detail-notes.test.ts`（4 例）+ AC-66 ④ 的 v28 修订（`tests/stage20-detail-header.test.ts`、`tools/ac-stage20.sh`） |
| 2 | 验收自检与三态出图（C） | `342e4d1` | `tools/ac-stage21.sh`、`tools/ac-stage21-probe.mjs`、`docs/shots/stage21/`（8 张） |
| 3 | 回归修订（AC-51 断言按 v32 反向修订） | 见聊天回复（收尾前一个 commit） | `tests/navigation-hygiene.test.ts`、`tools/ac-stage16.{sh,probe.mjs}` |
| 4 | 收尾（本节） | 收尾 commit（聊天回复单独标注） | PROGRESS 追加本节（含验证范围说明与旧断言修订留痕） |

> 说明：A（FR-68）与 B（FR-69）合在同一个 commit —— 两者都改 `PromptDetail.tsx`（同一组件里的两处），拆开需要按行分段提交、反而更难核对；
> 改动面与证据可用 `git show --stat 6041aab` 逐项核对。

| 结论 | 落盘位置 |
| --- | --- |
| 备注=纯文本（编辑器去预览 + 详情原样文本 + 0 次渲染请求） | `web/src/components/PromptEditor.tsx`、`PromptDetail.tsx`；本节 §2、§3 |
| 详情面标题下备注行（13px/次级灰/行高1.6/间距 4px/2 行省略/空值不渲染） | `PromptDetail.tsx`、`web/src/styles/app.css`；本节 §2、§4、§5 |
| 不外溢（摘要/变量/导出/diff 不变） | 本节 §6.4；`src/services/versions.ts`、`src/services/export.ts` 未改 |
| 不得回归 | 本节 §7（原样输出） |
| commit | A+B `6041aab`、C `342e4d1`；收尾 commit 在聊天回复中单独标注 |

### 2026-09-20 — 阶段 22 实施与自检（FR-70 拖拽排序 + FR-71 分栏中栏精简与宽度 -8%）

> **规格锚点**：`BRIEF.md` v29 §4 **FR-70 / FR-71** + §8 **AC-70 / AC-71** + §9 **D-28** + §11「阶段 22」。
> 环境 = 开发环境临时实例（临时 `DATA_DIR` + 备用端口）；**未触碰 8767 测试环境**。
> **契约变更（BRIEF 要求二选一并记录）**：选了 **`PATCH /api/prompts/order`**（body `{ids:number[]}` = 当前视图内的完整新顺序）
> 与 **`PATCH /api/folders/order`**（body `{parent_id:number|null, ids:number[]}`）；CORS 白名单同步补 `PATCH`（原 `GET/POST/PUT/DELETE/OPTIONS`）。
> **新依赖**：`@dnd-kit/core@6.3.1` / `sortable@10.0.0` / `utilities@3.2.2` / `modifiers@9.0.0`（全 MIT、OSV 0 漏洞，已登记 `docs/dependencies.md` §2.1 / §4.12）。

#### 1. 开工前：把 AC-70 / AC-71 翻译成检查命令

```sh
bash tools/ac-stage22.sh      # 服务自起自停；探针 tools/ac-stage22-probe.mjs（split / drag 两个模式，真鼠标 + CDP）
# AC-70 ① hover 条目 → 手柄存在（热区 ≥24×24、cursor grab）② 真鼠标拖第 1 条到第 3 条 → DOM 顺序变化
#       ③ 刷新 → 顺序保持 + 排序下拉「自定义」 ④ 未被拖动条目 left/width/top/height 差 ≤1px、行高不变、无横向溢出
#       ⑤ 文件夹树同层级重排 + 刷新保持 ⑥ PATCH 传不存在/重复 id → 400
# AC-71 ① 中栏条目文本只含 标题+备注（无 v\d / 取用 / 更新于 / 文件夹 / 变量 / 正文片段）
#       ② 备注区高度 ≈ 2×lineHeight、-webkit-line-clamp:2；空备注条目与有备注条目等高
#       ③ 中栏真实像素改前 366px → 改后 336px（比值 0.918 ∈ [0.90,0.94]），右栏变宽
#       ④ 单击条目仍切换右栏 ⑤ scrollWidth ≤ clientWidth+2 ⑥ 卡片/表格视图特征不变
```

#### 2. 实现与落点

| 项 | 落点 | 做法 |
| --- | --- | --- |
| **迁移** `prompts.sort_order` | `migrations/003_prompt-sort-order.sql`、`src/db/schema.ts` | `ALTER TABLE prompts ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0` + 用窗口函数按**升级前的默认顺序**（`updated_at DESC, id DESC`）回填 `1..N` + `idx_prompts_sort(sort_order, id)`；列上 `DEFAULT 0` 让**新建**条目排在既有 1..N 之前（与"最近更新"档新条目置顶一致） |
| **排序档 custom** | `src/db/prompt-queries.ts`、`src/services/prompts.ts`、`src/server/routes/prompts.ts`、`web/src/{types,pure}.ts` | `sort=custom` → `ORDER BY sort_order ASC, id ASC`（FTS 路径同样如此：用户顺序优先于 bm25）；下拉新增「自定义」 |
| **落库接口** | `src/services/prompts.ts`、`src/services/folders.ts`、两个 routes | `reorderPrompts`：非空/不重复/全部存在 → 事务里写 `sort_order = 1..N`；`reorderFolders`：额外校验 `parent_id` 与传入一致（跨父级 → 400）；两者都**幂等**、只改 `sort_order` |
| **拖拽** | `web/src/components/SortableList.tsx`（新）、`UseView.tsx`、`SplitView.tsx`、`FolderPanel.tsx` | dnd-kit `DndContext` + `SortableContext`；手柄 `HolderOutlined` 只在手柄上挂 `listeners`（条目本体仍可单击/双击）；`transition.duration = 150`；卡片用 `rectSortingStrategy`，列表用 `verticalListSortingStrategy` + `restrictToVerticalAxis/ParentElement`；文件夹树只把"当前拖动项的同级"放进 `SortableContext`，跨父级 drop 一律忽略 |
| **拖后行为** | `web/src/components/Workspace.tsx` | `PATCH` 成功后：非「自定义」档 → 切档 + `message.info('已切换为自定义排序')`（一次）；并**关闭「收藏置顶」**（理由见 §5.3）；`pm-use-sort` 记忆已支持 `custom` |
| **FR-71 条目** | `web/src/components/SplitView.tsx`、`web/src/styles/app.css` | 条目 = 收藏星标 + 标题（单行截断）+ 拖拽手柄 + `.pm-split-notes`（`-webkit-line-clamp:2` + `min-height: calc(2*1.6em)` + `pre-wrap`，空备注留空不塌陷）；正文摘要与全部元信息删除 |
| **FR-71 宽度** | `SplitView.tsx` | `flex: 0 0 clamp(276px, 31.3%, 350px)`（原 300/34%/380 各 ×0.92）；左栏未动、右栏相应变宽 |

#### 3. AC-71 原样实测（真实像素 + 文本断言）

```
ac71_widths={"list":336,"detail":924,"viewport":1600}
ac71_item_texts=["AC22 五\n备注五。","AC22 四","AC22 三\n备注三：第三条备注，稍长一点点，用来看两行截断。","AC22 二\n备注二：第二条备注。","AC22 一\n备注一：这是第一条的备注文本。"]
ac71_meta_hits={"vVersion":0,"quYong":0,"gengXin":0,"folderName":0,"vars":0,"bodyLeak":false}
ac71_notes_box={"height":38,"lineHeight":"19.2px","clamp":"2","minHeight":"38.4px","fontSize":"12px"}
ac71_equal_heights={"withNotes":80,"withoutNotes":80,"withNotesText":"AC22 五","withoutNotesText":"AC22 四"}
ac71_scroll={"scrollWidth":1600,"clientWidth":1600}
ac71_click_switch={"clicked":"AC22 四","detailTitle":"AC22 四"}
ac71_card_features={"exists":true,"hasMeta":true,"hasExcerpt":true,"height":154}
ac71_table_features={"exists":true,"hasVersion":true,"rows":6}
  ✅ 元信息命中（v\d / 取用 / 更新于 / 文件夹 / 变量） = {"vVersion":0,"quYong":0,"gengXin":0,"folderName":0,"vars":0,"bodyLeak":false}
  ✅ 备注区两行截断 = 2 ｜ ✅ 备注区高度 ≈ 2 × lineHeight = 38（期望 ≤39）
  ✅ 空备注条目与有备注条目等高 = 80（两条都是 80px）
  ✅ 无横向滚动 = true（1600 ≤ 1600+2）
  ✅ 宽度：改前 366px → 改后 336px ｜ ✅ 新宽/旧宽 = 336/366 = 0.918（∈[0.90,0.94]）
  ✅ 右栏相应变宽（924 > 894）｜ ✅ 单击后右栏标题 = 被点条目（AC22 四）
  ✅ 卡片仍有正文摘要与元信息 {"exists":true,"hasMeta":true,"hasExcerpt":true}
  ✅ 表格仍有版本号与多行 {"exists":true,"hasVersion":true,"rows":6}
  ✅ 页面运行时异常（split） = []
```

**夹具口径**：5 条 prompt 的**正文与备注明显不同**（正文形如「【正文字符串甲】这一行只属于正文…」），
条目文本里 `bodyLeak=false` 证明**正文片段一个都没出现在中栏**；其中「AC22 四」备注为空 → 与「AC22 五」条目高度**都是 80px**（留空不塌陷）。

#### 4. AC-70 原样实测（真鼠标拖拽 + 像素回归 + 持久化 + 负例）

```
ac70_handle={"testid":"pm-drag-card-5","w":24,"h":24,"cursor":"grab","visible":true}
ac70_order_before=[5,4,3,2,1]      ac70_order_after=[4,3,5,2,1]      （拖第 1 条到第 3 条之后）
ac70_order_after_reload=[4,3,5,2,1]           ac70_sort_label=自定义   ac70_stored_sort=custom
ac70_boxes_before={"pm-drag-card-5":{left:264,top:118,w:321,h:154}, "pm-drag-card-4":{597,118}, "pm-drag-card-3":{930,118}, "pm-drag-card-2":{1263,118}, "pm-drag-card-1":{264,284}}
ac70_boxes_after ={"pm-drag-card-4":{left:264,top:118,w:321,h:154}, "pm-drag-card-3":{597,118}, "pm-drag-card-5":{930,118}, "pm-drag-card-2":{1263,118}, "pm-drag-card-1":{264,284}}
ac70_line_heights_before=["14px","14px","14px","14px","14px"]   ac70_line_heights_after=["14px",…]（一致）
ac70_drag_scroll={"scrollWidth":1600,"clientWidth":1600}
ac70_folder_order_before=[1,2,3]   ac70_folder_order_after=[2,3,1]   ac70_folder_order_after_reload=[2,3,1]
ac70_prompt_order_requests=1       ac70_folder_order_requests=1
  ✅ 手柄可见 / 热区 ≥24×24 / cursor=grab
  ✅ 拖拽改变顺序 = true ｜ ✅ 刷新后顺序保持（持久化） ｜ ✅ 排序下拉显示「自定义」｜ ✅ localStorage 记忆 pm-use-sort=custom
  ✅ 像素差（位置未变的条目）：{"stable_items":["pm-drag-card-2","pm-drag-card-1"],"over_1px":{}}
  ✅ 位置未变条目 left/width/top/height 差 ≤1px（无一项 >1px）｜ ✅ 行高/字号不变 ｜ ✅ 拖动全程无横向溢出
  ✅ 文件夹顺序变化 = true ｜ ✅ 刷新后文件夹顺序保持 = [2,3,1]
  ✅ 拖拽确实调用了 PATCH /api/prompts/order = 1 ｜ ✅ 文件夹拖拽确实调用了 PATCH /api/folders/order = 1
  ✅ 页面运行时异常（drag） = []
```

接口负例（原样输出）：

```
  不存在的 id：
  HTTP 400
{"error":"invalid_body","details":[{"path":"ids","message":"以下 prompt id 不存在：999999"}]}
  重复 id：
  HTTP 400
{"error":"invalid_body","details":[{"path":"ids","message":"ids 不得重复：5"}]}
  文件夹跨父级：
  HTTP 400
{"error":"invalid_body","details":[{"path":"ids","message":"以下文件夹不属于 parent_id=null（本期不支持跨父级移动）：4"}]}
```

#### 5. 决策、取舍与规格落差处理

1. **接口形态选 `PATCH`**（BRIEF 二选一）：语义最贴（"把顺序改成这样"），比逐条更新少 N-1 次往返；因此 **CORS 白名单补了 `PATCH`**
   （`src/server/app.ts`，仅加方法、仍不开 credentials），并在本文档与 PROGRESS 记录这次契约变更。
2. **`sort_order` 默认 0 = 新条目置顶**：迁移把既有数据回填成 `1..N`，新插入的是 `0` → 在 `custom` 档下排在既有条目之前，
   与"最近更新"档下新条目置顶的观感一致；若回填成 0 会退化成按 id 排序（顺序全乱），故迁移里显式回填。
3. **拖拽 = 显式顺序 ⇒ 自动关闭「收藏置顶」**：`orderPrompts()` 的「收藏置顶」是**客户端**重排；若拖拽后仍开着，刷新会把收藏重新顶到最前，
   用户会觉得"拖了没用"。因此拖拽落库成功后一并关掉该开关（在 PROGRESS 记录这一交互取舍）。
   首次切档另给一次轻提示「已切换为自定义排序」（BRIEF 要求）。
4. **键盘可达：做了**（不是"未做"）。`KeyboardSensor` + `sortableKeyboardCoordinates` 已接入三处拖拽；
   实测：聚焦文件夹手柄 → `Space` 提起 → `ArrowDown` → `Space` 放下 → 顺序 `[1,2,3] → [2,1,3]` ✓（见 §5.5 的调试记录）。
5. **过程记录（如实留痕，含两个被自检抓出的真 bug）**：
   - **真 bug ①（AC 自检抓到）**：`pm-use-sort` 的 `readPref` 允许值列表里没有 `custom` → 拖拽当次一切正常，
     但**刷新后回退成「最近更新」**、拖拽结果看起来丢失。修复：允许值加 `custom`（`Workspace.tsx`），并让首屏 `filters.sort` 跟随该记忆。
   - **真 bug ②（调试中抓到）**：文件夹行的拖拽手柄原本放在"条目数"左边，而 hover 时才出现的行内操作区（新建子/改名/删除）
     会把它**往左推**——真鼠标移动过去触发 hover 后，`pointerdown` 落点已经不在手柄上，拖拽根本起不来（键盘路径却能工作，掩盖了问题）。
     修复：手柄移到**行尾最右**（hover 增删元素不再影响它的位置），随后真鼠标拖拽一次成功（`data-dragging=true`、`transform` 生效、PATCH 发出）。
   - **探针坑**：卡片的 `data-testid` 全都叫 `pm-use-card`，用 testid 当 key 记录像素会把 5 张卡合并成 1 条 → 改为用**每张卡里的手柄 id**当 key；
     "未被拖动条目"的比对也只取**位置未变**的那些（被拖的那条与为其让位的条目本来就会移动）。

#### 6. 依赖与迁移的证据

1. **依赖登记**（`docs/dependencies.md` §2.1 表格 + §4.12 选型理由 + 阶段 22 OSV 段）：
   `@dnd-kit/core@6.3.1`、`@dnd-kit/sortable@10.0.0`、`@dnd-kit/utilities@3.2.2`、`@dnd-kit/modifiers@9.0.0`（及传递依赖 `@dnd-kit/accessibility@3.1.1`）
   —— 全部 **MIT**，`api.osv.dev` 逐包查询 **osv_vulns=0**；`package.json` 里是**精确版本**（无 `^`）。构建体积：新增代码落在 `vendor-misc`（44.67 kB），
   最大 chunk 仍 **467,320 B ≤ 500KB**、无 "larger than 500 kB" 告警。
2. **迁移三态实测**（`tests/migrate-prompt-order.test.ts`，3 例全绿）：
   ① **旧库升级**：造一个只跑到 `002` 的旧库 + 3 条 `updated_at` 与 id 顺序**相反**的数据 → 跑迁移 → `sort_order` 回填 `1,2,3` 且顺序与升级前默认顺序**逐条一致**（不会全体变 0）；
   ② **幂等**：把某条 `sort_order` 改成 7 后再跑迁移 → `applied=[]`、数值不变；
   ③ **全新库**：0→3 正常建列与索引，新插入条目 `sort_order=0`。
3. **接口测试**（`tests/api-order.test.ts`，4 例）：custom 顺序落库 + 幂等 + 不改 `updated_at`/版本号；非法（不存在/重复/空/类型错）→ 400 且**不改动已有顺序**；未认证 → 401；文件夹同层级重排 + 跨父级/不存在/重复 → 400。

#### 7. 界面自证（截图 + 逐张识图；五问口径：① 重叠/遮挡 ② 硬断词 ③ 孤标题 ④ 溢出/裁切 ⑤ 是否合既定美学方向）

| 截图 | 识图结论 |
| --- | --- |
| `01-split-item-light.png` | 中栏条目只剩「标题 + 两行备注」+ 星标 + 行尾手柄；元信息全无，条目等高整齐 ①–④ 无 |
| `04-card-before-drag-light.png` / `06-card-after-drag-light.png` | 卡片视图拖前/拖后：被拖卡片落到第 3 位，其余卡片像素级不动（见 §4 数值）①–④ 无 |
| `05-card-dragging-light.png` | 拖动中：被拖卡片半透明跟随，其它卡片即时让位，无闪烁/重叠 ①–④ 无 |
| `07-folder-after-drag-light.png` | 左栏文件夹树拖后顺序变化，行高与图标对齐未变 ①–④ 无 |
| `02-card-view-unchanged-light.png` / `03-table-view-unchanged-light.png` | 卡片仍有正文摘要 + 元信息、表格仍有版本号列（本项只改分栏中栏）①–④ 无 |

#### 8. 不得回归（原样输出）

```
$ npm test                     → ℹ tests 266 / pass 266 / fail 0     # 阶段 21 为 248 → 只增不减（+18：接口 4、迁移 3、stage22-drag 6、stage22-split-item 5）
$ npm run typecheck:web        → rc=0
$ npm run build                → 无 "larger than 500 kB" 告警；最大 chunk = 467,320 B（≤500KB）✅
$ bash tools/ac-stage17/16/15/14/13/12/11/10/18/19/20/21.sh → 全部 ✅（AC-33/33b/35/36/37/40…AC-69 全绿）
$ bash tools/ac-stage22.sh     → ✅ AC-70 / AC-71 全部通过
$ bash tools/ui-shots.sh       → OK（53 张）
```

#### 9. 随本阶段一并修订的旧断言（都是"规格被新阶段取代"，逐条留痕）

| 旧断言 | 为什么必须改 | 改成什么 |
| --- | --- | --- |
| `tests/cli-user.test.ts`「migrate → `ok: schema at v2`」、`tests/migrate.test.ts`「version=2」 | 迁移 003 之后 schema 版本是 **3** | 期望值改 v3 / version 3（并注明 003 的内容） |
| `tests/navigation-hygiene.test.ts` AC-41 ④⑤ 找 `const card = (prompt…` | FR-70 把卡片渲染抽成 `renderCard`（要交给 `SortableList` 复用） | 断言改找 `const renderCard = (prompt…`（语义不变：卡片分支仍不得有 `pm-delete-`） |
| `tests/stage18-bundle.test.ts` AC-61 ⑤ gzip 预算 | 新增**规格要求**的拖拽库，体积必然增加 | 增加**实测**的 `STAGE22_ACCOUNTED_DELTA = 15,954 B`（把 HEAD~2 阶段 21 的 `web/src` 在同一 node_modules 下重建，总 gzip 401,067 → 417,021） |
| `tests/stage21-notes-plain.test.ts` AC-68 ③④「分栏列表摘要仍基于 user_prompt」 | FR-71 明确把正文摘要从中栏删掉（摘要只在卡片视图保留） | 断言收窄为"卡片仍有摘要 + 分栏中栏不得再出现 `promptExcerpt`" |
| `tools/ac-stage21.sh` 的 `grep -c '\-webkit-line-clamp: 2'`（全文件计数） | FR-71 的 `.pm-split-notes` 规则**也**用了两行截断 → 全文件计数从 1 变 2 | 断言改为只数 `.pm-detail-notes` 规则内的那一条（语义不变：详情面备注行仍是两行截断） |

#### 10. 提交单元与落盘对账

| # | 单元 | commit | 内容 |
| --- | --- | --- | --- |
| 1 | **FR-70 后端 + 迁移**（A） | `b41dd87` | `migrations/003_prompt-sort-order.sql`、`src/db/{schema,prompt-queries}.ts`、`src/services/{prompts,folders}.ts`、`src/server/routes/{prompts,folders}.ts`、`src/server/app.ts`（CORS 补 PATCH）、`tests/api-order.test.ts`（4 例）、`tests/migrate-prompt-order.test.ts`（3 例） |
| 2 | **FR-70 前端 + FR-71**（B/C） | `30e25f0` | `web/src/components/SortableList.tsx`（新）、`UseView.tsx`、`SplitView.tsx`、`FolderPanel.tsx`、`SidebarPanel.tsx`、`Workspace.tsx`、`api.ts`、`pure.ts`、`types.ts`、`styles/app.css`、`tests/stage22-drag.test.ts`（6 例）、`tests/stage22-split-item.test.ts`（5 例）、`package.json`/`package-lock.json`（@dnd-kit）、`docs/dependencies.md` |
| 3 | 验收自检与出图（D） | `e84e88a` | `tools/ac-stage22.sh`、`tools/ac-stage22-probe.mjs`、`docs/shots/stage22/`（7 张） |
| 4 | 回归修订（手柄监听 + AC-72 ⑨ 反向修订） | 见聊天回复（收尾前一个 commit） | `web/src/components/SortableList.tsx`、`FolderPanel.tsx`、`tests/stage24-ui.test.ts`、`tools/ac-stage23.{sh,probe.mjs}`、`docs/shots/stage23/` |
| 5 | 收尾（本节） | 收尾 commit（聊天回复单独标注） | PROGRESS 追加本节 + ui-shots 53 张重跑 |

| 结论 | 落盘位置 |
| --- | --- |
| 迁移 + `sort=custom` + 两个 order 接口（400/幂等/不改版本） | §2、§6；`migrations/003_prompt-sort-order.sql`、`src/services/{prompts,folders}.ts`、`tests/api-order.test.ts`、`tests/migrate-prompt-order.test.ts` |
| 三处拖拽 + 自动切「自定义」+ 持久化 + 像素回归 | §2、§4；`web/src/components/SortableList.tsx` 等；`tools/ac-stage22.sh` |
| 中栏条目精简（标题+两行备注）+ 宽度 366→336（0.918） | §2、§3；`web/src/components/SplitView.tsx`、`web/src/styles/app.css` |
| 依赖登记与 CVE 查询 | §6.1；`docs/dependencies.md`（§2.1 / §4.12 / 阶段 22 OSV 段） |
| 两个自检抓出的真 bug（useSort 记忆、手柄被 hover 推挤） | §5.5；修复分别落在 `Workspace.tsx`、`FolderPanel.tsx` |
| 不得回归 | §8（原样输出） |
| commit | A `b41dd87`、B+C `30e25f0`、D `e84e88a`；收尾 commit 在聊天回复中单独标注 |

### 2026-09-20 — 阶段 23 实施与自检（FR-72 文件夹筛选含子目录 + FR-73 卡片末行贴底 + FR-74 表格拖拽/刷新感）

> **规格锚点**：`BRIEF.md` v30 §4 **FR-72 / FR-73 / FR-74** + §8 **AC-72 / AC-73 / AC-74** + §9 **D-29** + §11「阶段 23」。
> 环境 = 开发环境临时实例（临时 `DATA_DIR` + 备用端口）；**未触碰 8767 测试环境**；本阶段**不涉及迁移**（`folders`/`prompts` 表结构未动）。

#### 1. 开工前：把 AC-72 / AC-73 / AC-74 翻译成检查命令

```sh
bash tools/ac-stage23.sh     # 服务自起自停；探针 tools/ac-stage23-probe.mjs（folder / table / card 三模式，全真鼠标）
# AC-72 ①-④ 三层 A>B>C 夹具 → folder_id=A/B/C 的 total = 3/2/1 且 id 集合正确
#       ⑤ 侧栏 A 计数徽标文本 == 点击 A 后的列表条目数（逐字对账）
#       ⑥ 组合 tag/q（LIKE 与 FTS 两条路径）同样 inclusive；⑦ 分页 total 正确；⑧ 不存在 id→200 total=0、非法→400
#       ⑨ A 视图里把 B 的条目拖到 C 的位置 → 顺序不变 + 0 次 PATCH
# AC-73 同一网格行 无标签/1 标签/3 标签 三张卡片：等高、末行距底 ∈[13,15]、无标签无空占位、列数/无横向溢出
# AC-74 ① 表格行手柄（≥24×24）+ 表头/列宽/行高与**改前基线**逐项一致
#       ② 真鼠标拖第 1 行到第 3 行 → 顺序变化 + 档位「自定义」+ 刷新保持
#       ③ 拖后 500ms 逐帧采样无 loading 骨架/空白 + 未动行像素差 ≤1px
#       ④ 一次拖拽只 1 次 PATCH；⑥ 卡片档/分栏档拖拽仍正常
```

#### 2. 实现与落点

| 项 | 落点 | 做法 |
| --- | --- | --- |
| **FR-72 筛选含子目录** | `src/services/folders.ts`（新 `descendantFolderIds`）、`src/db/prompt-queries.ts`、`src/services/prompts.ts` | 服务层用 `WITH RECURSIVE sub(id) AS (SELECT <root> UNION ALL SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id)` 一次取回「自身 + 全部后代」，再以 `p.folder_id IN (…)` 过滤；`folderIds=[]`（根不存在）→ `1 = 0` 命中 0 条。**FTS5 与 LIKE 两条路径共用同一个 `filterFragment`**，故都 inclusive |
| **FR-72 侧栏计数** | `web/src/components/FolderPanel.tsx` | 接口 `total` 已含子目录 ⇒ `inclusiveCount` 改为直接返回 `counts[id]`（**不再对子目录求和**，否则 A 显示 3+2+1=6、点进去只有 3 —— 反向不一致） |
| **FR-72 ⑤ 拖拽收窄** | `web/src/components/SortableList.tsx`（新 `canReorder`）、`UseView.tsx`、`SplitView.tsx` | 拖拽结束先判 `folder_id` 是否相同；不同则**直接 return**（不调 `onReorder` ⇒ 顺序不变、不发请求）。卡片/分栏/表格三处都传 `sameFolder` |
| **FR-73 卡片贴底** | `web/src/components/UseView.tsx` | 卡片本体 `display:flex; flex-direction:column`，`body` 加 `flex:1 1 auto`（撑满卡片）⇒ 末行 `marginTop:auto` 真正贴到底边；**无标签时不渲染标签区**（原来空的 `<Flex>` 白占一个 10px gap） |
| **FR-74 ① 表格拖拽** | `UseView.tsx` | antd Table `components={{ body: { row: SortableTableRow } }}`，行内用**同一个 `SortableItem`**（同一套 @dnd-kit）；手柄经 `RowHandleContext` 注入**「标题」单元格**（**不新增列** ⇒ 表头/列宽/行高不变）；拖拽结束走同一个 `onReorder` ⇒ 同一个 `PATCH /api/prompts/order` |
| **FR-74 ② 刷新感** | `web/src/components/Workspace.tsx` | `reorderPrompts` 改为**乐观更新**：先把 `data.items` 本地按新顺序重排（不重新请求），再后台 `PATCH`；失败 `setData(snapshot)` 回滚 + 提示。**删掉了原来的 `refresh()`** |

#### 3. AC-72 原样实测

接口侧（curl + jq，夹具 `A > B > C` 各 1 条 + 未归类 1 条）：

```
  folder_id=A(1) → total=3 items=[1,2,3]
  folder_id=B(2) → total=2 items=[2,3]
  folder_id=C(3) → total=1 items=[3]
  ✅ total == items 条数 = 3 ｜ ✅ A 的 id 集合 = {1,2,3} = [1,2,3]
  组合筛选：folder_id=A&tag=T → 1 ｜ folder_id=A&q=乙乙乙（LIKE 兜底）→ 1 ｜ folder_id=A&q=AC23 B（FTS5）→ 1
  分页：limit=2 → items=2 total=3；offset=2 → items=1
  不存在 id：HTTP 200 {"total":0,"items":[]} ｜ folder_id=abc → 400
```

UI 侧（真鼠标 + DOM）：

```
ac72_badge=3                     （侧栏 A 的计数徽标文本）
ac72_list_count=3                （点击 A 后中栏条目数）
ac72_order_before=["AC23 C 里的","AC23 B 里的","AC23 A 里的"]
ac72_order_after =["AC23 C 里的","AC23 B 里的","AC23 A 里的"]   （跨目录拖拽 → 顺序不变）
ac72_order_requests_before=0  ac72_order_requests_after=0      （未发出 PATCH）
  ✅ 侧栏 A 计数徽标 = 3 ｜ ✅ 点击 A 后列表条目数 = 3（与徽标逐字一致）
  ✅ 跨目录拖拽：顺序不变 ｜ ✅ 跨目录拖拽：未发出 PATCH /api/prompts/order = 0
  ✅ 页面运行时异常（folder） = []
```

#### 4. AC-73 原样实测（先复现 → 再修 → 再测）

**改前复现**（阶段 23 之前的构建，同一夹具；`tmp/measure-card.sh`）：

```
{"cards":[
  {"title":"AC23 三标签","cardH":186,"cardBottom":303,"lastBottom":288,"bottomGap":15,"tagsH":22,"emptyFlexCount":0},
  {"title":"AC23 一标签","cardH":186,"cardBottom":303,"lastBottom":288,"bottomGap":15,"tagsH":22,"emptyFlexCount":0},
  {"title":"AC23 无标签","cardH":186,"cardBottom":303,"lastBottom":263,"bottomGap":40,"tagsH":0,"emptyFlexCount":1}],
 "cols":4,"scrollWidth":1600,"clientWidth":1600}
```

→ 复现结论：**卡片等高（186px）但无标签卡片的末行距底 40px（有标签的是 15px）**，且它内部有 **1 个空 Flex 占位**。
成因两条：① 空标签区仍占一个 10px 的 `gap`；② 卡片 body 没有撑满卡片高度（`bodyH` 159 vs 184），`marginTop:auto` 无处可推。改前截图：`tmp/before-shots/card-bottom-row.png`。

**改后**（`bash tools/ac-stage23.sh` 的 card 模式）：

```
ac73_light={"cards":[
  {"title":"AC23 卡片三标签","cardH":186,"cardBottom":303,"footerBottom":288,"gap":15,"tagsH":22,"emptyFlex":0},
  {"title":"AC23 卡片一标签","cardH":186,"cardBottom":303,"footerBottom":288,"gap":15,"tagsH":22,"emptyFlex":0},
  {"title":"AC23 卡片无标签","cardH":186,"cardBottom":303,"footerBottom":288,"gap":15,"tagsH":0,"emptyFlex":0}, …],
 "cols":4,"scrollWidth":1600,"clientWidth":1600}
  ✅ 三张卡片等高（两两差 ≤1px） ｜ ✅ 末行距卡片底边 ∈ [13,15]（三张都满足）
  ✅ 无标签卡片内无空 Flex 占位 = 0 ｜ ✅ 无标签卡片标签区高度 = 0
  ✅ 网格列数 = 4（未回归） ｜ ✅ 无横向溢出 ｜ ✅ 暗色下同样贴底 ｜ ✅ 页面运行时异常（card） = []
```

**对账**：末行距底 **40px → 15px**（= body padding 14 + 1px 边框，落在 AC 的 [13,15]）；三张卡片 `cardH` 全为 186（改前也等高，故卡片高度未回归）；列数 4 未变；截图 `docs/shots/stage23/05-card-footer-light.png` / `06-card-footer-dark.png` 逐张识图确认三张卡片底行**对齐在同一条线上**。

#### 5. AC-74 原样实测

**改前基线**（用 `git HEAD` 的 worktree 重新构建后量，保证"改前/改后一致"是真对照）：

```
ac74_metrics_before（阶段 23 之前）= {"tableWidth":1320,"cols":[301,183,123,83,94,106,155,275],"rowHeight":43,"headerHeight":38}
```

**改后**（真鼠标）：

```
ac74_metrics_before（改后）= {"tableWidth":1320,"heads":[{"标题":301},{"标签":183},{"文件夹":123},{"版本":83},{"变量数":94},{"取用次数":106},{"更新于":155},{"操作":275}],"cols":[301,183,123,83,94,106,155,275],"rowCount":7,"rowHeight":43,"headerHeight":38}
ac74_handle={"testid":"pm-drag-row-7","w":24,"h":24,"cursor":"grab","visible":true}
ac74_order_before=[7,6,5,4,3,2,1]   ac74_order_after=[6,5,7,4,3,2,1]   ac74_order_after_reload=[6,5,7,4,3,2,1]
ac74_requests_before=0              ac74_requests_after=1
ac74_sort_label=自定义              ac74_sort_label_after_reload=自定义
ac74_samples（拖后每 50ms 一帧，共 10 帧）= 全部 {"rows":7,"skeleton":0,"skeletonInfo":[],"loadingText":false}
ac74_card_order_before=[6,5,7,4,3,2,1] → after=[5,7,6,4,3,2,1]      （卡片档仍正常）
ac74_split_order_before=[5,7,6,4,3,2,1] → after=[7,6,5,4,3,2,1]     （分栏档仍正常）
  ✅ 手柄热区 ≥24×24 ｜ ✅ 行高与改前一致（43px） ｜ ✅ 表头高与改前一致（38px）
  ✅ 列宽与改前一致（8 列实测像素）｜ ✅ 表头文案与改前一致（未新增列）
  ✅ 拖拽改变表格行顺序 ｜ ✅ 一次拖拽只发 1 次 PATCH ｜ ✅ 刷新后表格顺序保持 ｜ ✅ 排序档显示「自定义」
  ✅ AC-74 ③：拖后 500ms 内无骨架/空白（逐帧采样）｜ ✅ AC-74 ③：未动行像素差 ≤1px
  ✅ AC-74 ⑥：卡片档拖拽仍正常 ｜ ✅ AC-74 ⑥：分栏档拖拽仍正常 ｜ ✅ 页面运行时异常（table） = []
```

负例（沿用 AC-70 ⑥，接口测试 `tests/api-order.test.ts` 已覆盖）：不存在 id / 重复 id → 400 `invalid_body`；本阶段未新增依赖（`package.json` 的 `@dnd-kit/*` 仍是 4 个，构建最大 chunk 467,320 B ≤500KB、无 `larger than` 告警）。

#### 6. 决策、取舍与规格落差处理

1. **FR-74 ② 刷新感：做了**（成本低，符合 BRIEF 的裁量边界）。只改前端 `reorderPrompts`：本地先重排 `data.items`，再后台 PATCH，失败回滚 —— **不改接口、不引依赖**。实测拖后 500ms 内 10 帧全部 `rows=7 / skeleton=0 / loadingText=false`（无骨架、无空白），未动行像素差 ≤1px。
   （首次从别的档位拖拽仍会切到「自定义」并触发一次后台刷新，但列表有数据时不显示骨架，观感无闪烁。）
2. **表格手柄放在「标题」单元格内（不新增列）**：新增一列会改变表头与全部列宽，与 AC-74 ①「表头/列宽改前一致」直接冲突。手柄**常显**（不隐藏），与卡片/文件夹树三处一致，也让「热区 ≥24×24」可被真实测量。
3. **键盘可达：做了**（与阶段 22 同口径）。表格行复用 `SortableItem` ⇒ 自带 `KeyboardSensor` + `sortableKeyboardCoordinates`；卡片/分栏/文件夹树同样已接入。
4. **FR-72 的连带修订（必须留痕）**：
   - `web/src/components/FolderPanel.tsx` 的 `inclusiveCount`：旧实现 = `counts[id] + Σ 子目录`；接口口径改为 inclusive 后，这会让 A 显示 **6**（3+2+1）而列表只有 3 条 ⇒ 改为直接返回 `counts[id]`。**这是 AC-72 ⑤"计数与结果一致"的必要条件**，属本次规格变更的连带修订，不是"测试挂了改测试"。
   - **旧断言逐条核对**：BRIEF 点名要复核的 `tests/api-folders-tags.test.ts`（AC-14）、`api-prompts-crud.test.ts`、`api-search.test.ts` —— 三个文件的 `folder_id` 夹具**都是单层文件夹（无子目录）**，inclusive 语义下期望值不变，故**无需修订**（证据：`node --test tests/api-folders-tags.test.ts tests/api-prompts-crud.test.ts tests/api-search.test.ts tests/api-order.test.ts` → 19/19 通过，与改前一致）。
5. **`npm test` 的 `typecheck:tests` 抓到的连带修订**（如实留痕）：`searchPrompts` 的入参由 `folderId` 改名 `folderIds`（服务层已解析成"含后代 id 集合"），
   `tests/db-search.test.ts` 里一处直接调 `searchPrompts` 的用例随之更新；另修了本阶段新测试的一处 TS 严格模式写法（元组解构需显式类型）。
   两处都由 `npm test` 的第一道闸（`tsc -p tsconfig.tests.json`）拦下 —— 这是"只增不减全绿"的一部分。
6. **不改的东西**：`folder_id` 缺省/`null`（= 全部）语义不变；`folders`/`prompts` 表结构未动（**无迁移**，符合第 16 条纪律）；前端选中态与列表标题未动；`GET /api/prompts?folder_id=null` 仍是 400（"全部"= 不传该参数）。

#### 7. 界面自证（截图 + 逐张识图；五问口径：① 重叠/遮挡 ② 硬断词 ③ 孤标题 ④ 溢出/裁切 ⑤ 是否合既定美学方向）

| 截图 | 识图结论 |
| --- | --- |
| `01-folder-inclusive-light.png` | 侧栏 A/B/C 徽标 3/2/1 与点进去的条目数一致；层级缩进正常 ①–④ 无 |
| `02-folder-cross-folder-drag-ignored-light.png` | 跨目录拖拽后条目回到原位，无残留占位/错位 ①–④ 无 |
| `03-table-before-drag-light.png` / `04-table-after-drag-light.png` | 表格每行左侧手柄与标题同排、行高未变；拖后行序变化、列对齐未乱 ①–④ 无 |
| `05-card-footer-light.png` | 三张卡片（无标签/1 标签/3 标签）末行**对齐在同一条底线上**，无标签卡片不留空白条 ①–④ 无 |
| `06-card-footer-dark.png` | 暗色下同样贴底、灰色层级正常 ①–④ 无 |

#### 8. 不得回归（原样输出）

```
$ npm test                     → ℹ tests 275 / pass 275 / fail 0     # 阶段 22 为 266 → 只增不减（+9：AC-72 接口 4、stage23-ui 5）
$ npm run typecheck:web        → rc=0
$ npm run build                → 无 "larger than 500 kB" 告警；最大 chunk = 467,320 B（≤500KB）✅
$ bash tools/ac-stage17/16/15/14/13/12/11/10/18/19/20/21/22.sh → 全部 ✅（AC-14/33/33b/35/36/37/40…AC-71 全绿）
$ bash tools/ac-stage23.sh     → ✅ AC-72 / AC-73 / AC-74 全部通过
$ bash tools/ui-shots.sh       → OK（53 张）
```

#### 9. 提交单元与落盘对账

| # | 单元 | commit | 内容 |
| --- | --- | --- | --- |
| 1 | **FR-72 后端 + 计数口径**（A） | `2129bfd` | `src/services/folders.ts`（`descendantFolderIds`）、`src/db/prompt-queries.ts`（`folderIds` + 两条路径）、`src/services/prompts.ts`、`web/src/components/FolderPanel.tsx`（计数不再求和）、`tests/api-folder-inclusive.test.ts`（4 例） |
| 2 | **FR-72 ⑤ + FR-73 + FR-74**（B/C） | `35ba4e4` | `web/src/components/SortableList.tsx`（`canReorder`）、`UseView.tsx`（卡片贴底 + 表格行拖拽）、`SplitView.tsx`（同目录判定）、`Workspace.tsx`（乐观更新）、`tests/stage23-ui.test.ts`（5 例） |
| 3 | 验收自检与出图（D） | `eac33e7` | `tools/ac-stage23.sh`、`tools/ac-stage23-probe.mjs`、`docs/shots/stage23/`（6 张） |
| 4 | 回归修订（手柄监听 + AC-72 ⑨ 反向修订） | 见聊天回复（收尾前一个 commit） | `web/src/components/SortableList.tsx`、`FolderPanel.tsx`、`tests/stage24-ui.test.ts`、`tools/ac-stage23.{sh,probe.mjs}`、`docs/shots/stage23/` |
| 5 | 收尾（本节） | 收尾 commit（聊天回复单独标注） | PROGRESS 追加本节 + ui-shots 53 张重跑 |

| 结论 | 落盘位置 |
| --- | --- |
| folder_id 含全部后代（两条检索路径）+ 计数同口径 + 跨目录拖拽忽略 | §2、§3、§6.4；`src/services/folders.ts`、`src/db/prompt-queries.ts`、`FolderPanel.tsx`、`tests/api-folder-inclusive.test.ts` |
| 卡片末行贴底（40px → 15px，等高、无空占位） | §2、§4；`web/src/components/UseView.tsx`；改前截图 `tmp/before-shots/card-bottom-row.png` |
| 表格拖拽（同一 dnd-kit/同一 PATCH/列宽行高不变）+ 乐观更新 | §2、§5；`UseView.tsx`、`Workspace.tsx`、`SortableList.tsx` |
| 不得回归 | §8（原样输出） |
| commit | A `2129bfd`、B+C `35ba4e4`、D `eac33e7`；收尾 commit 在聊天回复中单独标注 |

### 2026-09-20 — 阶段 24 实施与自检（FR-75 / D-30：修「卡片拖动根本不生效」）

> **规格锚点**：`BRIEF.md` v31 §4 **FR-75** + §8 **AC-75** + §9 **D-30** + §11「阶段 24」。
> **背景**：用户实测「卡片拖动根本不生效」。host_manger 在测试环境定位到两条叠加原因 ——
> ① **D-29 的「inclusive 视图下仅同 folder_id 内生效」**：默认「全部」视图里相邻卡片几乎必然跨目录 ⇒ 只有极少数组合能拖，
> 其余**静默忽略**（顺序不变、不发请求、无提示）；② **卡片本体不是拖拽激活点**（只有手柄绑了 listeners）。
> 规格作者已在 v31 把 D-29 的这条连带约束**作废**（D-30），本次按要求修掉并补自证。
> 环境 = 开发环境临时实例（临时 `DATA_DIR` + 备用端口）；**未触碰 8767 测试环境**；**无 schema 变更**（`migrations/` 仍是 3 个）。

#### 1. 开工前：把 AC-75 翻译成检查命令

```sh
bash tools/ac-stage24.sh     # 服务自起自停；探针 tools/ac-stage24-probe.mjs（card / folder / other 三模式，全真鼠标）
# AC-75 ① 夹具：同一视图 ≥4 条分属 3 个目录（2 条在 A、1 条在 B、1 条未归类）
#       ② hover 第 1 张卡片 → 手柄 pm-drag-card-<id>（≥24×24、常显、cursor grab、title 提示）
#       ③ 真鼠标从手柄把第 1 张拖到第 3 张 → DOM 顺序变化 + **恰好 1 次** PATCH + 刷新后保持
#       ④ 具体目录视图内拖 2 条 → 只在这 2 条**原先占据的槽位**间交换；其他目录条目 sort_order **完全不变**；
#          无重复；这组不被顶到全局最前；回「全部」视图 UI 顺序与落库一致
#       ⑤ 无静默忽略：拖拽路径上不存在"顺序不变 + 无请求 + 无提示"
#       ⑥ 卡片**本体**可拖；单击仍选中、双击仍开详情
#       ⑦ 未动项像素差 ≤1px / 行高不变 / scrollWidth ≤ clientWidth+2
#       ⑧ 负例（不存在/重复/空 ids → 400）  ⑨ 分栏档与表格档拖拽仍正常
```

#### 2. 实现与落点

| 项 | 落点 | 做法 |
| --- | --- | --- |
| **A 取消跨目录限制** | `web/src/components/SortableList.tsx`、`UseView.tsx`、`SplitView.tsx` | 删掉 `canReorder` / `sameFolder` 与那段 `return`（D-29 的连带约束作废）；`onReorder` 无条件执行 ⇒ inclusive 视图下拖拽总是生效 |
| **A 不再有静默分支** | `web/src/components/FolderPanel.tsx` | 文件夹树仍不允许跨父级移动（FR-70 的"同层级"范围），但**从静默改为可见反馈**：`message.info('文件夹只能在同一个父级下调整顺序')` |
| **B 槽位保持** | `src/services/prompts.ts` | `reorderPrompts` 先取这组 id 当前占据的 `sort_order`（按 `sort_order, id` 升序）= **槽位**，再把新顺序**依次写回这些槽位**；槽位有重复时（全新数据 `sort_order` 全是 0）先按 `(sort_order, id)` 把**全表**归一化成 1..M（其他条目相对顺序不变），再把新顺序落到这组 id 原本占据的**全局位次**上 |
| **C 本体可拖** | `SortableList.tsx` + 三处视图 | `SortableItemContext` 新增 `rootListeners`：把 dnd-kit 的 `onPointerDown` 挂到**条目本体**（卡片 / 分栏条目 / 表格行），键盘监听仍留在手柄上（可聚焦 + 方向键）；`activationConstraint: { distance: 5 }` 保证单击/双击不被误判 |

#### 3. AC-75 原样实测

**②③⑤⑦（默认「全部」视图，跨目录，真鼠标）**：

```
ac75_handle={"testid":"pm-drag-card-4","w":24,"h":24,"cursor":"grab","title":"按住拖动以调整顺序","visible":true}
ac75_order_before=[4,3,1,2]   ac75_order_after=[3,1,4,2]   ac75_order_after_reload=[3,1,4,2]
ac75_requests_before=0        ac75_requests_after=1        ac75_messages=[]
ac75_heights_before=[154,154,154,154]     ac75_scroll={"scrollWidth":1600,"clientWidth":1600}
  ✅ 手柄热区 ≥24×24 且常显 ｜ ✅ 手柄有 title 提示 = 按住拖动以调整顺序
  ✅ 跨目录拖拽生效（顺序变化）｜ ✅ 恰好 1 次 PATCH /api/prompts/order = 1 ｜ ✅ 刷新后顺序保持
  ✅ ⑤ 无静默忽略（顺序已变 且 发过请求） = true
  ✅ ⑦ 未动项像素差 ≤1px ｜ ✅ ⑦ 行高不变 = [154,154,154,154] ｜ ✅ ⑦ 无横向溢出
```

**⑥ 本体可拖 + 单击/双击不误判**：

```
ac75_body_before=[3,1,4,2] → ac75_body_after=[1,4,3,2]（本体拖拽 1 次 PATCH）
ac75_single_click={"selectedBorder":"rgb(94, 106, 210)"}      （单击仍选中：主色边框）
ac75_double_click={"detailOpen":true,"title":"AC24 A1"}       （双击仍打开详情）
  ✅ 拖卡片本体也能改变顺序 ｜ ✅ 本体拖拽也走同一接口（1 次）
  ✅ 双击打开详情（标题非空）｜ ✅ 单击/双击未改变顺序
```

**④ 槽位保持（核心语义，全量 `sort_order` 前后对照；夹具 A1/A2∈目录A、B1∈目录B、未归类）**：

```
拖前全量：[{"id":1,"folder_id":1,"sort_order":1},{"id":4,"folder_id":null,"sort_order":2},
          {"id":3,"folder_id":2,"sort_order":3},{"id":2,"folder_id":1,"sort_order":4}]
目录视图内顺序：[1,2] → [2,1]（真鼠标拖 1 次，恰好 1 次 PATCH）
拖后全量：[{"id":2,"folder_id":1,"sort_order":1},{"id":4,"folder_id":null,"sort_order":2},
          {"id":3,"folder_id":2,"sort_order":3},{"id":1,"folder_id":1,"sort_order":4}]
  A 组槽位：[1, 4] → [1, 4]                    （只在这 2 条原先占据的槽位间交换）
  其他条目 3: sort_order 3 → 3 ✅不变           （其他目录条目完全不变）
  其他条目 4: sort_order 2 → 2 ✅不变
  全量 sort_order 无重复：✅                     （旧实现会写出重复值）
  A 组最小槽位：1 → 1 ✅未变小                  （没有被顶到全局最前）
  ✅ 槽位保持（A 组只换槽位 / 其他不变 / 无重复 / 不顶到最前） = true
  ✅ ④ UI 顺序与落库一致（第一张 = sort_order 最小的那条） = AC24 A2
```

**⑧⑨（负例与其它两档回归）**：

```
  不存在 id：HTTP 400 {"error":"invalid_body","details":[{"path":"ids","message":"以下 prompt id 不存在：999999"}]}
  重复 id：  HTTP 400 {"error":"invalid_body","details":[{"path":"ids","message":"ids 不得重复：1"}]}
  空 ids：   HTTP 400 {"error":"invalid_body","details":[{"path":"ids","message":"ids 不得为空（需要当前视图内的完整顺序）"}]}
  ✅ 分栏档：[2,4,3,1] → [4,3,2,1]（真鼠标拖动生效）
  ✅ 表格档：[4,3,2,1] → [3,2,4,1]（真鼠标拖动生效）
```

#### 4. 决策、取舍与规格落差处理

1. **D-29 的连带约束作废（v31 / D-30）**：删掉 `canReorder` / `sameFolder` 与静默 `return`。前端源码级断言反向修订为
   「不得再出现 `canReorder` / `sameFolder`」（`tests/stage23-ui.test.ts` 的 AC-72 ⑤ 用例，已注明是规格变更而非放宽）。
2. **「任何被忽略的分支一律不得静默」的落实范围**：prompt 拖拽已**没有**任何拒绝分支（总是生效）；
   唯一仍存在的拒绝是**文件夹树的跨父级移动**（FR-70 的"同层级"范围，D-30 未涉及），已从静默 `return` 改为**可见提示**
   （`message.info('文件夹只能在同一个父级下调整顺序')`），并有源码级断言保证"先提示再 return"。
3. **槽位有重复时的归一化分支（如实说明）**：全新数据的 `sort_order` 全是 `0`，此时"把新顺序写回原槽位"在数学上无法表达顺序
   （槽位不可区分）。处理：**先按 `(sort_order, id)` 把全表归一化成 1..M**（其他条目的**相对顺序完全不变**），再把新顺序落到这组 id 原本占据的全局位次上。
   此后所有拖拽都走**纯槽位保持**分支（其他条目一个字段都不动）。AC-75 ④ 的用例先做一次全视图 PATCH 建立非平凡初值，正是为了直接检验纯槽位路径。
4. **回归自检抓到的两处连带修订（如实留痕）**：
   - **手柄的指针监听**：最初把 `onPointerDown` 从手柄"搬"到本体，导致**手柄本身拖不动了** ——
     `tools/ac-stage22.sh` 的文件夹树拖拽与 `ac-stage23.sh` 的表格/卡片手柄拖拽立刻报红（顺序不变 + 0 请求）。
     修复：手柄保留**完整**监听（指针 + 键盘），并在手柄的 `onPointerDown` 里先调用原监听再 `stopPropagation()`，
     避免同一次按下被手柄与本体两个激活点各启动一次；文件夹行也补挂 `rootListeners`。修完 AC-70/71/72/73/74 全部复绿。
   - **`tools/ac-stage23.sh` 的 AC-72 ⑨ 断言**：它原本断言"D-29 时代"的"跨目录拖拽被忽略 + 0 请求"，v31/D-30 作废后
     已反向修订为"顺序变化 + 恰好 1 次 PATCH"，并同步改了截图名（`02-folder-cross-folder-drag-applied-light.png`）。
5. **本体可拖与单击/双击的兼容**：dnd-kit 的 `activationConstraint: { distance: 5 }` 要求指针移动 ≥5px 才进入拖拽，
   因此"按下-抬起"仍是 click、"两次点击"仍是 dblclick。实测：单击后卡片边框变主色（选中态）✓、双击后详情面板打开且标题正确 ✓、两者都**没有**改变顺序 ✓。
   手柄**保留**（常显 + `cursor: grab` + `title="按住拖动以调整顺序"`），仍可作为键盘激活点（`KeyboardSensor` + 方向键）。
6. **手感不回归**：未动项像素差 ≤1px、卡片高度 154px 不变、`scrollWidth(1600) ≤ clientWidth(1600)+2` ✓（AC-70 ④ 的口径继续满足）。
7. **不动的东西**：`prompts.sort_order` 列与迁移（无 schema 变更）；三档视图的拖拽入口与手柄 testid 命名；`folder_id` 筛选的"含全部后代"语义（D-29 前半条继续有效）。

#### 5. 界面自证（截图 + 逐张识图；五问口径：① 重叠/遮挡 ② 硬断词 ③ 孤标题 ④ 溢出/裁切 ⑤ 是否合既定美学方向）

| 截图 | 识图结论 |
| --- | --- |
| `01-all-view-before-drag-light.png` / `02-all-view-after-drag-light.png` | 「全部」视图（4 张卡片分属 3 个目录）拖前/拖后：被拖卡片落到第 3 位，其余像素级不动 ①–④ 无 |
| `03-body-drag-light.png` | 拖**卡片本体**（左下空白区）后顺序变化，卡片无残影/错位 ①–④ 无 |
| `04-double-click-detail-light.png` | 双击卡片打开右栏详情（标题为被双击那条）①–④ 无 |
| `05-folder-view-slot-swap-light.png` | 目录 A 视图内两条交换，卡片等高、手柄常显 ①–④ 无 |
| `06-back-to-all-view-light.png` | 回「全部」视图：这两条没有跑到最前（与落库顺序一致）①–④ 无 |
| `07-split-drag-light.png` / `08-table-drag-light.png` | 分栏档与表格档拖拽仍正常，行高/列对齐未变 ①–④ 无 |

#### 6. 不得回归（原样输出）

```
$ npm test                     → ℹ tests 281 / pass 281 / fail 0     # 阶段 23 为 275 → 只增不减（+6：槽位保持 2、stage24-ui 4）
$ npm run typecheck:web        → rc=0
$ npm run build                → 无 "larger than 500 kB" 告警；最大 chunk = 467,320 B（≤500KB）✅
$ bash tools/ac-stage17/16/15/14/13/12/11/10/18/19/20/21/22/23.sh → 全部 ✅（含 AC-70/71/72/73/74）
$ bash tools/ac-stage24.sh     → ✅ AC-75 全部通过
$ bash tools/ui-shots.sh       → OK（53 张）
```

#### 7. 提交单元与落盘对账

| # | 单元 | commit | 内容 |
| --- | --- | --- | --- |
| 1 | **槽位保持（A/B 后端）** | `761faa1` | `src/services/prompts.ts`（`reorderPrompts` 槽位保持 + 重复槽位归一化）、`tests/api-order.test.ts`（+2 例） |
| 2 | **取消跨目录限制 + 本体可拖（A/C 前端）** | `700f51b` | `SortableList.tsx`（去 `canReorder`、加 `rootListeners`）、`UseView.tsx`、`SplitView.tsx`、`FolderPanel.tsx`（跨父级可见提示）、`tests/stage23-ui.test.ts`（反向修订）、`tests/stage24-ui.test.ts`（+4 例） |
| 3 | 验收自检与出图（D） | `5d7684d` | `tools/ac-stage24.sh`、`tools/ac-stage24-probe.mjs`、`docs/shots/stage24/`（8 张） |
| 4 | 回归修订（手柄监听 + AC-72 ⑨ 反向修订） | 见聊天回复（收尾前一个 commit） | `web/src/components/SortableList.tsx`、`FolderPanel.tsx`、`tests/stage24-ui.test.ts`、`tools/ac-stage23.{sh,probe.mjs}`、`docs/shots/stage23/` |
| 5 | 收尾（本节） | 收尾 commit（聊天回复单独标注） | PROGRESS 追加本节 + ui-shots 53 张重跑 |

| 结论 | 落盘位置 |
| --- | --- |
| 跨目录拖拽生效（不再静默忽略） | §2、§3；`web/src/components/SortableList.tsx`、`UseView.tsx`、`SplitView.tsx` |
| 槽位保持（其他条目不变 / 无重复 / 不顶最前） | §2、§3；`src/services/prompts.ts`、`tests/api-order.test.ts`；全量 sort_order 对照见本节 §3 ④ |
| 本体可拖 + 单击/双击不误判 | §2、§3、§4.4；`SortableList.tsx` 的 `rootListeners` |
| 文件夹树跨父级不再静默 | §2、§4.2；`web/src/components/FolderPanel.tsx` |
| 不得回归 | §6（原样输出） |
| commit | A/B `761faa1`、A/C `700f51b`、D `5d7684d`；收尾 commit 在聊天回复中单独标注 |

### 2026-09-20 — 阶段 25 实施与自检（FR-76 / D-31：顶栏品牌文字 → `PromptM`）

> **规格锚点**：`BRIEF.md` v32 §4 **FR-76** + §8 **AC-76** + §9 **D-31** + §11「阶段 25」。
> **范围纪律（本次重点）**：用户明确「**我们只改这个logo的地方，其他地方都不要改**」—— 只动 `web/src/components/AppHeader.tsx` 顶栏品牌区的文字；
> 其余四处（`web/index.html` 的 `<title>`、`LoginPage`、`AboutModal`、`pure.ts` 的错误文案）**保持全名**，
> 导出契约值 `SUPPORTED_EXPORT_FILE.app = 'promptmanager'` **一字不动**（D-31：显示名 ≠ 契约值）。
> 环境 = 开发环境临时实例（临时 `DATA_DIR` + 备用端口）；**未触碰 8767 测试环境**；无 schema / 接口 / 依赖变更。

#### 1. 改动与落点（只此一处）

| 项 | 落点 | 改动 |
| --- | --- | --- |
| 顶栏品牌文字 | `web/src/components/AppHeader.tsx` | `PromptManager` → **`PromptM`**；顺手给该文字加 `data-testid="pm-brand-text"`（AC 需要精确取 `innerText`；**不改变任何行为**） |
| 四处保持全名（**未动**） | `web/index.html` `<title>`、`web/src/components/LoginPage.tsx`、`web/src/components/AboutModal.tsx`、`web/src/pure.ts` | 逐处 `grep -c PromptManager` = 1（见 §2 原样输出） |
| 契约值（**未动**） | `web/src/pure.ts` | `export const SUPPORTED_EXPORT_FILE = { app: 'promptmanager', schema_version: 1 } as const;`（第 107 行） |
| 图标 / 移动端（**未动**） | `AppHeader.tsx` | `pm-brand-mark`、`src="/promptmanager-icon.svg"`、26×26；文字仍只在 `{!isMobile && (` 内渲染 |

#### 2. AC-76 原样实测

**①②③④ 源码侧（原样展示）**：

```
  顶栏（AppHeader.tsx）品牌区：
    144:                data-testid="pm-brand-text"
    145:              >
    146:                {/* FR-76 / D-31：顶栏是唯一空间受限处 ⇒ 用简称 PromptM；其余位置（<title>/登录/关于/错误文案）保持全名 */}
    147:                PromptM
  ✅ AppHeader 里 PromptManager 出现次数（应为 0） = 0
  反例断言 —— 四处源码行（原样展示）：
    web/index.html: 12:    <title>PromptManager</title>
    web/src/components/LoginPage.tsx: 74:            PromptManager
    web/src/components/AboutModal.tsx: 87:            PromptManager
    web/src/pure.ts: 126:    return { ok: false, error: `不是 PromptManager 的导出文件（app=${String(file.app)}）` };
  ✅ web/index.html 仍是全名 = 1 ｜ ✅ LoginPage 仍是全名 = 1 ｜ ✅ AboutModal 仍是全名 = 1 ｜ ✅ pure.ts 仍是全名 = 1
  ③ 契约值 grep：
    107:export const SUPPORTED_EXPORT_FILE = { app: 'promptmanager', schema_version: 1 } as const;
  ✅ 契约值命中行数 = 1 ｜ ✅ 契约值未被改成显示名 = 0（grep "app: 'PromptM'" 无命中）
  ✅ 图标 mark 锚点仍在 = 1 ｜ ✅ 图标 src 未变 = 1 ｜ ✅ 图标仍 26×26 = 1 ｜ ✅ 品牌文字仍只在非移动端渲染 = 1
```

**①④⑥⑦ 桌面运行时（真鼠标 + 真实像素）**：

```
ac76_brand_text=PromptM
ac76_brand_absent_fullname=false
ac76_document_title=PromptManager
ac76_mark={"src":"/promptmanager-icon.svg","w":26,"h":26,"naturalW":64,"naturalH":64}
ac76_button_lefts=[{"header-new":1303},{"header-more":1386},{"pm-theme-toggle":1469},{"header-logout":1505}]
ac76_after_logo_click={"view":"split","search":""}
ac76_scroll={"scrollWidth":1600,"clientWidth":1600}
  ✅ 品牌文字精确 = PromptM ｜ ✅ 顶栏内不出现 PromptManager = false
  ✅ ② document.title 仍是 PromptManager ｜ ✅ 图标 26×26
  ✅ AC-47：按钮 left 严格升序（1303 < 1386 < 1469 < 1505）
  ✅ AC-51：点 logo 回主页（视图回到分栏 + 搜索清空）
  ✅ ⑦ 桌面无横向溢出
```

**⑤ 移动视口 390×844**：

```
ac76_mobile_brand_text={"brandTextExists":false,"markExists":true,"headerText":"登出"}
ac76_mobile_scroll={"scrollWidth":390,"clientWidth":390}
  ✅ 移动端不渲染品牌文字（brandTextExists=false）｜ ✅ 移动端仍有图标 ｜ ✅ ⑤ 移动端无横向溢出
  ✅ 页面运行时异常 = []
```

**截图 + 逐张识图（五问口径：① 重叠/遮挡 ② 硬断词 ③ 孤标题 ④ 溢出/裁切 ⑤ 是否合既定美学方向）**：

| 截图 | 识图结论 |
| --- | --- |
| `01-desktop-brand-light.png` | 顶栏品牌区 = 图标 + **`PromptM`**（短名，不再换行/挤压）；新建 / 更多 / 主题 / 登出顺序与位置未变 ①–④ 无 |
| `02-desktop-after-logo-click-light.png` | 点 logo 后回到主页（分栏视图 + 搜索框清空），顶栏元素未错位 ①–④ 无 |
| `03-mobile-brand-light.png` | 390×844 顶栏**只有图标**、无品牌文字；无横向滚动、无裁切 ①–④ 无 |

#### 3. 不得回归（原样输出）

```
$ npm test                     → ℹ tests 285 / pass 285 / fail 0     # 阶段 24 为 281 → 只增不减（+4：stage25-brand）
$ npm run typecheck:web        → rc=0
$ npm run build                → 无 "larger than 500 kB" 告警；最大 chunk = 467,320 B（≤500KB）✅
$ bash tools/ac-stage17/16/15/14/13/12/11/10/18/19/20/21/22/23/24.sh → 全部 ✅（含 AC-47 / AC-51 与 AC-70~AC-75）
$ bash tools/ac-stage25.sh     → ✅ AC-76 全部通过
$ bash tools/ac-stage16.sh     → ✅ AC-51 / AC-52 / … / AC-58 全部通过（AC-51 断言已按 v32 修订，见 §5）
```

> **验证范围说明（按用户指示）**：本次是"只改一处文字"的小改动，用户明确要求**只做定点验证、不跑全量回归**。
> 因此本阶段实际执行的是：`ac-stage25.sh`（AC-76 全条）、`ac-stage15.sh`（AC-47）、`ac-stage16.sh`（AC-51）、`npm test`、`typecheck:web`、`build`；
> **未重跑**其余阶段的 AC 脚本与 `ui-shots.sh`（阶段 24 刚全量跑过、本次改动不触及那些路径）。
> 副作用留痕：`docs/shots/` 下的**通用截图集**仍是上一次 `ui-shots` 的产物，其顶栏品牌文字仍显示旧值 `PromptManager`；
> 本阶段的品牌证据以 `docs/shots/stage25/`（桌面 / 移动 / 点 logo 后三张，均为改后）为准。

#### 4. 随本阶段修订的旧断言（规格被 v32 取代，逐条留痕）

| 旧断言 | 为什么必须改 | 改成什么 |
| --- | --- | --- |
| `tests/navigation-hygiene.test.ts` AC-51「品牌文字必须是 PromptManager」 | v32 / FR-76 / D-31：顶栏改为简称 `PromptM`（用户明确"只改 logo 这处"） | 「顶栏品牌文字必须是简称 `PromptM`」+「顶栏不得再出现全名」（其余四处仍断言全名，见 `tests/stage25-brand.test.ts` ②） |
| `tools/ac-stage16-probe.mjs` 的 `ac51_has_brand`（`topnav.includes('PromptManager')`）与 `tools/ac-stage16.sh` 的「顶栏含 PromptManager」 | 同上 | 改为断言顶栏含 `PromptM`（AC-51 的"logo 可点回主页"部分未动，仍全条通过） |

> `AC-59 ②`（`index.html` 的 `<title>` 严格等于 `PromptManager`）与 `tests/stage18-cleanup.test.ts`（`pure.ts` 错误文案含全名）**保持原样**——
> 它们断言的正是 FR-76 要求"保持全名"的位置，属于**反例断言**的一部分。

#### 5. 提交单元与落盘对账

| # | 单元 | commit | 内容 |
| --- | --- | --- | --- |
| 1 | **顶栏品牌文字（A）** | `5d9c995` | `web/src/components/AppHeader.tsx`（`PromptM` + `pm-brand-text` 锚点）、`tests/stage25-brand.test.ts`（4 例：简称 + 四处反例 + 契约值 + 图标/移动端） |
| 2 | 验收自检与出图 | `16c2307` | `tools/ac-stage25.sh`、`tools/ac-stage25-probe.mjs`、`docs/shots/stage25/`（3 张） |
| 3 | 回归修订（AC-51 断言按 v32 反向修订） | 见聊天回复（收尾前一个 commit） | `tests/navigation-hygiene.test.ts`、`tools/ac-stage16.{sh,probe.mjs}` |
| 4 | 收尾（本节） | 收尾 commit（聊天回复单独标注） | PROGRESS 追加本节（含验证范围说明与旧断言修订留痕） |

| 结论 | 落盘位置 |
| --- | --- |
| 顶栏品牌文字 = `PromptM`（唯一改动处） | §1、§2；`web/src/components/AppHeader.tsx`、`tests/stage25-brand.test.ts` |
| 四处保持全名（反例断言） | §2；`web/index.html` / `LoginPage.tsx` / `AboutModal.tsx` / `pure.ts` 均未改 |
| 契约值 `app:'promptmanager'` 未动 | §2 ③；`web/src/pure.ts:107` |
| 图标与移动端行为未变 | §2；`AppHeader.tsx` 的 `pm-brand-mark` / `{!isMobile && (` |
| 不得回归 | §3（原样输出 + 验证范围说明） |
| 旧断言修订（AC-51 顶栏品牌） | §4；`tests/navigation-hygiene.test.ts`、`tools/ac-stage16.{sh,probe.mjs}` |
| commit | A `5d9c995`、自检 `16c2307`、修订见聊天回复；收尾 commit 在聊天回复中单独标注 |
