# 依赖与开源协议登记（promptmanager）

> 规范依据：`STANDARDS.md` §4（能不造轮子就别造；安全 + 协议两道闸门；依赖必须登记）
> 与 BRIEF §5 / §7 / D-10。**本文件只登记事实与理由，不代替 lockfile**。
> 最后更新：2026-09-20（**上线准备 P1：全量复核** —— 逐条对照 `package.json` / `package-lock.json`（31 个直接依赖：23 生产 + 8 开发，
> 0 缺失 / 0 版本不一致），并按当前版本重跑 OSV 查询（31/31 = 0 漏洞，见 §5 ② 的"本次复核"段）。
> 包管理器：**npm 11.16.0**（BRIEF §7 固定；`npm ci` 复现）。

## 1. 运行时与工具链（环境既有，非本项目安装）

| 项 | 版本 | 来源 |
| --- | --- | --- |
| Node.js | v24.18.0 | 228 系统自带（BRIEF §5 不允许换版本/装 nvm） |
| npm | 11.16.0 | 同上 |
| SQLite（内嵌于 better-sqlite3） | 3.53.4 | better-sqlite3 预编译二进制自带 |
| systemd-analyze | 250 | 用于 `deploy/promptmanager.service` 语法自检（AC-18） |

## 2. 直接依赖（阶段 1 已安装并 pin 版本）

> 判据：**安全**（无未修高危 CVE、维护活跃、pin 精确版本 + 提交 lockfile）+ **协议**（MIT/Apache/BSD/ISC 直接用；
> MPL/LGPL 可用；GPL/AGPL/无协议先问）。全部满足，无需 `QUESTIONS.md`。

### 2.1 生产依赖（`dependencies`）

| 包 | 版本 | 协议 | 用途 / 选型理由 |
| --- | --- | --- | --- |
| `fastify` | 5.12.5 | MIT | HTTP 框架（BRIEF §5 推荐）。自带 pino 日志、schema/校验钩子、`inject()` 便于测试；不手写路由/请求解析 |
| `@fastify/static` | 10.1.4 | MIT | 静态托管前端构建产物，实现**单进程单端口**（FR-12）；不自写静态文件服务 |
| `@fastify/cookie` | 11.1.2 | MIT | 会话 cookie 的读写/签名/清除（FR-1 阶段 2）；不自写 cookie 解析与序列化（STANDARDS §4.2） |
| `@fastify/rate-limit` | 11.2.0 | MIT | `/api/login` 的 per-IP 请求级洪泛保护（防"拿 argon2 烧 CPU"）。**只计请求数**，失败阈值语义见 §4.7 |
| `@fastify/cors` | 11.3.0 | MIT | FR-17 CORS 精确白名单（默认不注册 = 关闭）、预检处理；不自写 CORS 头与 OPTIONS 逻辑，见 §4.10 |
| `@modelcontextprotocol/sdk` | 1.30.0 | MIT | **官方 MCP TypeScript SDK**（FR-18）：`McpServer` + `StdioServerTransport`；STANDARDS §4.2 禁止手写 JSON-RPC 框架，见 §4.11 |
| `zod` | 4.6.5 | MIT | MCP 工具的入参 schema（SDK 的 `registerTool` 用 zod raw shape；zod 同时是 SDK 的 peerDependency，故必须直接声明） |
| `@node-rs/argon2` | 2.2.1 | MIT | 口令哈希 Argon2id（BRIEF §5「argon2 优先」，阶段 2）。选择理由见 §4.5 |
| `better-sqlite3` | 13.0.3 | MIT | SQLite 驱动（BRIEF §5 二选一，理由见 §4.1）。同步 API、事务原语、FTS5 可用 |
| `kysely` | 0.29.6 | MIT | 类型安全 SQL 查询构造器（STANDARDS §4.2 禁止手搓 ORM/SQL 拼装）。`SqliteDialect` 内建 better-sqlite3 支持，无额外包 |
| `react` | 19.3.0 | MIT | 前端框架（BRIEF §5） |
| `react-dom` | 19.3.0 | MIT | React 渲染器 |
| `antd` | 6.6.4 | MIT | **指定组件库**（BRIEF D-11 / AC-20 / AC-21）。peer `react >=18`，React 19 原生支持，**不需要** `@ant-design/v5-patch-for-react-19` |
| `@ant-design/icons` | 6.3.4 | MIT | 组件库配套图标（BRIEF §5；不手绘图标、不引图标字体 CDN） |
| `marked` | 18.0.13 | MIT | Markdown 渲染（FR-9；BRIEF §5 指定 `marked` 或 `markdown-it`，取前者，见 §4.8） |
| `@dnd-kit/core` | 6.3.1 | MIT | **拖拽排序引擎**（FR-70 / D-28）：DndContext / sensors / 碰撞检测。BRIEF 明确"禁止自己手写拖拽引擎"，它是 React 生态最主流的无 jQuery 拖拽库（peer `react >=16.8`，React 19 可用），见 §4.12 |
| `@dnd-kit/sortable` | 10.0.0 | MIT | 列表/网格排序策略（`SortableContext` / `useSortable` / `arrayMove` / 键盘坐标），与 core 同作者、peer `@dnd-kit/core ^6.3.0` |
| `@dnd-kit/utilities` | 3.2.2 | MIT | `CSS.Transform` 等小工具（core/sortable 的传递依赖，显式声明便于版本固定） |
| `@dnd-kit/modifiers` | 9.0.0 | MIT | 官方修饰器（`restrictToVerticalAxis` / `restrictToParentElement`）：把竖直列表的拖动限制在容器内，避免拖出边界 |
| `dompurify` | 3.4.15 | **MPL-2.0 OR Apache-2.0** → 按 **Apache-2.0** 使用 | 服务端 HTML 净化（FR-9 / AC-12）：`<script>`、`javascript:`、事件属性一律消除 |
| `jsdom` | 30.1.0 | MIT | 给 DOMPurify 提供 Node 侧 DOM（DOMPurify 需要 DOM 才能工作），见 §4.8 |
| `highlight.js` | 11.12.0 | BSD-3-Clause | 代码块高亮（FR-9）；用 `highlight.js/lib/common` 入口（常用语言子集） |
| `diff` | 9.0.0 | BSD-3-Clause | 版本 unified diff（FR-7 / AC-9，jsdiff）；STANDARDS §4.2 禁止手写 diff 算法 |

### 2.2 开发依赖（`devDependencies`）

| 包 | 版本 | 协议 | 用途 / 选型理由 |
| --- | --- | --- | --- |
| `typescript` | 7.0.2 | Apache-2.0 | 类型检查与服务端编译（BRIEF §5：TS strict + Node ESM） |
| `vite` | 8.3.0 | MIT | 前端构建（BRIEF §5）；不自写打包器 |
| `@vitejs/plugin-react` | 6.1.1 | MIT | React JSX/Fast Refresh 支持 |
| `@types/node` | 24.13.5 | MIT | Node 类型；**对齐运行时大版本 24**（非 latest 26）以避免用到 Node 24 不存在的 API |
| `@types/react` | 19.3.0 | MIT | React 类型 |
| `@types/react-dom` | 19.3.0 | MIT | ReactDOM 类型 |
| `@types/better-sqlite3` | 9.6.0 | MIT | better-sqlite3 类型（该包自身不发布类型） |
| `@types/jsdom` | 30.0.0 | MIT | jsdom 类型（该包自身不发布类型） |

**未引入的包（有意为之）**

- **无测试框架依赖**：用 Node 内置 `node:test` + `node:assert`（平台能力，非手搓；`npm test` 见 §5）。
- **无 Tailwind / 第二套样式体系**（BRIEF §5 明令默认不引）。
- **无 CDN 资源**（AC-20 ④：构建产物与源码零外链）。
- **无 lodash/axios/moment 之类**：能一个包解决就不叠三个（STANDARDS §4.3 第 5 条）。
- **无 bcrypt**：口令哈希统一走 Argon2id（见 §4.5），不同时堆两套哈希库。
- **无 zod**：请求校验用 fastify 自带的 JSON Schema/ajv（框架能力），未额外引校验库（需要更复杂校验时再评估）。

## 3. 传递依赖（由 lockfile 固定，不手工干预）

口径：`node_modules` 实际安装 **281** 个包（含上表 27 个直接依赖；阶段 7 新增 2 个直接依赖，
MCP SDK 自身带来一批传递依赖 —— 见 §4.11 的取舍说明）。

**协议分布（逐包读取各包 `package.json` 的 license 字段统计，阶段 6 复测）**

```
installed_packages=207
--- license tally ---
 176  MIT
   7  BSD-3-Clause
   7  ISC
   5  BlueOak-1.0.0
   4  Apache-2.0
   2  MIT-0
   2  BSD-2-Clause
   2  MPL-2.0
   1  (MPL-2.0 OR Apache-2.0)   ← dompurify
   1  CC0-1.0                   ← mdn-data（jsdom 的 CSS 数据）
--- copyleft/restricted ---
(none)
--- no license field ---
(none)
```

- **无 GPL / AGPL / SSPL / BUSL / Commons Clause，无"无协议"包**（全部命中 0）。
- **MPL-2.0 两处**：`lightningcss@1.33.0`、`lightningcss-linux-x64-gnu@1.33.0`
  （Vite 8 的 CSS 转换依赖）。按 STANDARDS §4.4，MPL-2.0 可用，条件是**不修改其实体**——本项目未修改、未 vendoring，仅作为依赖使用。
- `BlueOak-1.0.0`（glob / lru-cache / minimatch / minipass / path-scurry）是 OSI 认可的宽松协议，等价放行。
- **`dompurify` 是 `MPL-2.0 OR Apache-2.0` 双许可** → 本项目**按 Apache-2.0 使用**（STANDARDS §4.4 明确 Apache-2.0 可直接用），
  避免 MPL 的"修改即披露"义务带来的解释成本。
- `MIT-0`（@csstools/*）、`BSD-2-Clause`（entities / webidl-conversions）、`CC0-1.0`（mdn-data）均为宽松/公共领域，
  随 jsdom 一起进来，等价放行。
- 传递依赖按 STANDARDS §4.3 的宽口径处理：**无已知高危 + 协议宽松 + 已登记**（本节即登记）。

## 4. 选型说明（BRIEF 授权 dsh 决定或需留痕的部分）

### 4.1 SQLite 驱动：`better-sqlite3@13.0.3`（而非内置 `node:sqlite`）

| 维度 | `better-sqlite3@13.0.3` | `node:sqlite` |
| --- | --- | --- |
| API 稳定性 | 成熟稳定（v13 长期维护） | Node 24 仍标注 **experimental**，跨 Node 小版本可能变 |
| 事务原子性 | `db.transaction()` 原语，导入导出（FR-10 原子性）直接用 | 需手写 BEGIN/COMMIT/ROLLBACK 编排 |
| 安装 | 包内自带 `prebuilds/linux-x64.node`，**无需编译器**（228 实测 `npm ci` 4 秒） | 零依赖 |
| FTS5 + trigram | 实测通过（SQLite 3.53.4） | 实测通过（SQLite 3.53.1） |

**结论**：选 `better-sqlite3`。决定性因素是 **API 稳定性 + 事务原语**，而非安装成本（两者都便宜）。
`node:sqlite` 作为备选保留在案：若将来要在更老/更杂的 Node 上跑，切回内置驱动只需替换 `src/db/index.ts` 的连接层。

**已知坑（实测）**：npm 11 的 allow-scripts 策略会**跳过** better-sqlite3 的 `install: node-gyp rebuild` 脚本并给出
`npm warn allow-scripts` 警告——**不影响使用**：该包把各平台预编译 `.node` 放在 `prebuilds/` 里随 tarball 分发。
AC-1 的 `rm -rf node_modules && npm ci` 已实测通过（见 PROGRESS）。**部署机无需 gcc/node-gyp。**

### 4.2 查询层：`kysely`（而非手写 SQL 字符串）

STANDARDS §4.2 禁止"手搓 ORM / SQL 拼装"。CRUD 查询通过 kysely 构造（类型安全、参数化）；
仅 FTS5 `MATCH` / `LIKE ... ESCAPE` 这类 SQLite 方言用 kysely 的 `sql` 模板标签写**参数化**片段
（仍由驱动绑定参数，不拼接用户输入）。

### 4.3 静态托管：`@fastify/static`（而非自写 sendFile）

单端口交付（FR-12）需要把 `dist/web` 交给同一个 HTTP 进程托管；用官方插件，避免自写路径穿越防护、
Content-Type 推断、Range/ETag 等基础设施。

### 4.4 测试框架：Node 内置 `node:test`

STANDARDS §4.2 禁止手搓测试框架。`node:test` 是 Node 运行时自带能力（成熟、零依赖），
配合 Node 24 的 TypeScript 类型擦除可直接运行 `tests/*.test.ts`，无需 ts-node/tsx/jest/vitest 这类额外工具链。

### 4.5 口令哈希：`@node-rs/argon2@2.2.1`（而非 `argon2@0.45.1` 或 bcrypt）

| 维度 | `@node-rs/argon2@2.2.1` | `argon2@0.45.1`（node-argon2） | `bcrypt@6.0.0` |
| --- | --- | --- | --- |
| 算法 | Argon2id（RFC 9106 推荐，BRIEF §5 首选） | 同 | bcrypt（BRIEF 允许但非首选） |
| 安装方式 | 平台二进制走 **optionalDependencies**（`@node-rs/argon2-linux-x64-gnu`），需 npm 正常解析依赖，**不依赖 install 脚本** | node-gyp 编译 / 预编译下载，**依赖 install 脚本** | node-gyp 编译，依赖 install 脚本 |
| 与 228 的兼容性 | ✅ 实测直接可用（`npm i` 秒级，无编译） | ⚠️ npm 11 的 allow-scripts 会跳过 install 脚本（阶段 1 已在 better-sqlite3 上踩到该策略） | 同左 |
| 默认参数 | `$argon2id$v=19$m=19456,t=2,p=1`（库默认即规范推荐值） | 需显式传参 | cost 10 |
| 协议 | MIT | MIT | MIT |

**结论**：选 `@node-rs/argon2`。决定性因素是**不依赖 install 脚本**（阶段 1 实测 npm 11 会跳过它们），
其次是与 BRIEF「argon2 优先」一致、默认参数即规范推荐值。**不手写哈希、不自己拼盐/参数**（STANDARDS §4.2）。

### 4.6 会话 cookie：`@fastify/cookie@11.1.2`

FR-1 要求 `HttpOnly; SameSite=Lax; Path=/` 的会话 cookie 与"登出即清 cookie"。
用官方插件完成解析/序列化/清除（含 `Expires`/`Max-Age` 计算），**不自写 Cookie 头解析**（STANDARDS §4.2）。
会话本身**不用** cookie 承载状态：cookie 里只放随机 token，状态在 `sessions` 表（BRIEF D-6）。

### 4.7 登录限流：`@fastify/rate-limit@11.2.0` + 领域失败策略（职责划分，重要）

BRIEF §6.3 定义了两个参数：`LOGIN_MAX_FAILURES`（默认 5，**失败**阈值）与 `LOGIN_WINDOW_SECONDS`（默认 60），
AC-4 规定时序："连续 5 次错误口令后第 6 次 → 429"。

**能力探测（读 `node_modules/@fastify/rate-limit/index.js` 与 `types/index.d.ts`，非猜测）**：
该插件**只按请求计数**——没有 `skipSuccessfulRequests` 之类的"只计失败"选项，store 也没有 reset 接口
（store 接口只有 `incr` / `read` / `child`）。因此它**无法表达**本契约的失败阈值语义。

**职责划分**：

| 层 | 实现 | 作用 |
| --- | --- | --- |
| 请求级洪泛保护 | `@fastify/rate-limit`（每 IP 30 次/60 秒，仅 `/api/login`） | 廉价拒绝高频请求，保护昂贵的 Argon2 校验（CPU DoS） |
| 失败阈值策略 | `src/services/auth.ts` 的 `attemptLogin`（窗口内按 `username + remote_addr` 统计 `login_attempts` 表的失败行） | 实现 BRIEF §6.3 + AC-4 的精确语义：达阈值后（含口令正确者）返回 429 + `Retry-After`，直到窗口过期；登录成功清除该键失败记录 |

**为什么不写 QUESTIONS**：限流的"基础设施"（窗口存储、键、标准响应头、per-IP 限速算法）由插件承担；
自研的部分是**对本项目已有表的领域查询**，且契约（`LOGIN_MAX_FAILURES`/`LOGIN_MAX_FAILURES 窗口`/AC-4 时序）
明确要求"按失败计数"，属于业务规则而非重造轮子。若 host_manger 认为应改为纯库方案，需要同时修订 AC-4 的时序定义
（已在 PROGRESS 阶段 2 §4 决策 1 留痕）。

### 4.8 Markdown 渲染 / 净化 / 高亮：`marked` + `dompurify`(+`jsdom`) + `highlight.js`

**管线**（`src/services/markdown.ts`）：`marked`（GFM）→ 自定义 `renderer.code` 用 `highlight.js` 高亮 → `DOMPurify.sanitize`。

- **为什么净化放在最后**：标记语言允许内联 HTML，所以"先净化再渲染"没有意义（渲染又会生成新 HTML）；
  正确顺序是**渲染出 HTML，再整体净化**。AC-12 的 `<script>` / `javascript:` / 事件属性全部由 DOMPurify 消除，
  而 `highlight.js` 生成的 `<span class="hljs-*">` 保留。
- **为什么用 `dompurify` + `jsdom` 而不是 `isomorphic-dompurify`**：BRIEF §5 的措辞是"服务端 **DOMPurify**"，
  直接引 `dompurify` 与该措辞逐字对应，DOM 依赖（jsdom）显式可见；包装层只是把同样两件事合起来，收益不大。
  `jsdom` 是 Node 侧 DOM 的标准实现，也是 DOMPurify 官方文档给的服务端用法。
- **代码内容转义由库负责**（`highlight.js` 会转义代码文本），本项目**没有手写 HTML 转义**；
  只有在"代码块超过 20000 字符"时才跳过 `highlightAuto`（实测 200k 字符约 3 秒），改用 `hljs.highlight(..., 'plaintext')`
  ——仍然由库转义，只是不做语言识别。
- `highlight.js/lib/common` 入口只打包常用语言，避免全量语言包体积。

### 4.12 拖拽排序：为什么是 `@dnd-kit`

- **BRIEF 的硬要求**：`FR-70` 明确"拖拽用成熟库（建议 `@dnd-kit/core` + `@dnd-kit/sortable`），**禁止自己手写拖拽引擎**"；
- **选它的理由**：① 唯一主流、活跃维护的 React 拖拽/排序库（react-dnd 需要 HTML5 后端且 HTML5 DnD API 在触屏上不可用；
  自研 pointer 事件方案正是被禁止的"手写引擎"）；② **MIT**、无 jQuery、无外链资源、可与 antd 共存（手柄用 antd `Button`）；
  ③ 内置 `KeyboardSensor`（FR-70 的"有余力再做"的键盘可达直接满足）；④ 排序以 `transform` 实现 → 拖动中**不重排 DOM**，
  天然满足"其它条目不闪烁、拖后像素差 ≤1px"；⑤ 可配置 `transition.duration`，满足"过渡 ≤150ms"。
- **不引的**：`react-beautiful-dnd`（已归档/不再维护）、`react-dnd`（HTML5 backend 触屏不可用）、`sortablejs`（非 React 语义，需手写 DOM 绑定）。
- **代价**：新增 5 个包（含传递依赖 `@dnd-kit/accessibility`），构建体积 +约 45KB（落在 `vendor-misc` 块，最大 chunk 仍 467KB ≤500KB）。

### 4.11 MCP：`@modelcontextprotocol/sdk@1.30.0`（+ `zod@4.6.5`）

FR-18/D-15 要求 stdio MCP server；STANDARDS §4.2 与 BRIEF §5 **明令禁止手写 JSON-RPC 框架**，故使用**官方 TS SDK**。
协议版本对齐（BRIEF §5 硬要求）实测：SDK 的 `LATEST_PROTOCOL_VERSION = '2025-11-25'`，与真实对端
（Python `mcp` 1.30.0）**完全相同** —— 详见 `PROGRESS.md` 阶段 7 开工前 §2 与收尾节的真实对端输出。

**取舍说明（如实登记）**：该 SDK 同时内置 HTTP/SSE 等传输，会带来较多传递依赖（本阶段 `node_modules` 从 207 → 281 个包，
其中 74 个来自 SDK 依赖树：express/hono/jose/ajv 等）。我们只用到 `stdio` 传输与 `McpServer`。
接受这一体积的原因是：**自研 JSON-RPC/MCP 实现是被规格禁止的**，而 SDK 是官方维护、MIT、且当前版本
`osv_vulns=0`（历史 3 条 GHSA 的修复上界分别为 1.26.0 / 1.25.2 / 1.24.0，均早于 1.30.0）。

### 4.10 CORS：`@fastify/cors@11.3.0`

FR-17 要求"默认关闭、按 env 精确白名单开放、禁 `*`、不用 `Access-Control-Allow-Credentials`"：
这些语义用官方插件一行配置即可表达（`origin` 回调 + `credentials: false` + `methods`/`allowedHeaders` 白名单），
**CORS 头与 OPTIONS 预检处理属于标准协议逻辑，不该自己写**。注意：`CORS_ORIGINS` 为空时**根本不注册插件**
（默认关闭 ⇒ 任何响应都没有 CORS 头）；配置里出现 `*` 时启动即报错（见 `src/config.ts` 的 `readCorsOrigins`）。

### 4.9 版本 diff：`diff`（jsdiff）

`createTwoFilesPatch('v<N>', 'v<M>', …)` 直接产出 unified diff；STANDARDS §4.2 明确禁止手写 diff 算法，
BRIEF §5 也把"diff 算法"列进禁止手搓清单。diff 的输入是版本快照拼成的规范文本（见 `src/services/versions.ts`
的 `snapshotText`——BRIEF 未规定 diff 文本形态，这里用四段带标记的文本，多行值安全）。

## 5. 安全闸门实测记录（2026-09-18）

**① `npm audit`（官方 registry；npmmirror 未实现 audit 端点，见下）**

```
$ npm audit --registry=https://registry.npmjs.org
found 0 vulnerabilities
```

**② OSV 逐直接依赖查询（`api.osv.dev`，查询 package+version）**

阶段 1（11 个直接依赖）：

```
fastify                    5.12.5     osv_vulns=0
@fastify/static            10.1.4     osv_vulns=0
better-sqlite3             13.0.3     osv_vulns=0
kysely                     0.29.6     osv_vulns=0
antd                       6.6.4      osv_vulns=0
@ant-design/icons          6.3.4      osv_vulns=0
react                      19.3.0     osv_vulns=0
react-dom                  19.3.0     osv_vulns=0
vite                       8.3.0      osv_vulns=0
typescript                 7.0.2      osv_vulns=0
@vitejs/plugin-react       6.1.1      osv_vulns=0
```

阶段 22 新增（4 个，FR-70 拖拽排序）：

```
@dnd-kit/core             6.3.1      osv_vulns=0
@dnd-kit/sortable        10.0.0      osv_vulns=0
@dnd-kit/utilities        3.2.2      osv_vulns=0
@dnd-kit/accessibility    3.1.1      osv_vulns=0   （core 的传递依赖，一并查）
@dnd-kit/modifiers        9.0.0      osv_vulns=0
```

```
$ npm audit --registry=https://registry.npmjs.org
found 0 vulnerabilities
```
（注：228 的默认 registry 是 npmmirror，其 `/-/npm/v1/security/advisories/bulk` 未实现 → 故用 OSV 逐包查询，
与阶段 1/2/7 同一口径；四个 dnd-kit 包均为 MIT、仓库活跃、无未修漏洞。）

**③ 本次复核（2026-09-20，上线准备 P1）—— 全量 31 个直接依赖、按当前版本重查**

```
$ python3 - <<'PY'   # 逐包 POST api.osv.dev/v1/query（package+version）
…（31 个直接依赖，输出节选）
@ant-design/icons          6.3.4      osv_vulns=0
@dnd-kit/core              6.3.1      osv_vulns=0
@dnd-kit/modifiers         9.0.0      osv_vulns=0
@dnd-kit/sortable         10.0.0      osv_vulns=0
@dnd-kit/utilities         3.2.2      osv_vulns=0
@fastify/cookie           11.1.2      osv_vulns=0
@fastify/cors             11.3.0      osv_vulns=0
@fastify/rate-limit       11.2.0      osv_vulns=0
@fastify/static           10.1.4      osv_vulns=0
@modelcontextprotocol/sdk 1.30.0      osv_vulns=0
@node-rs/argon2            2.2.1      osv_vulns=0
antd                       6.6.4      osv_vulns=0
better-sqlite3            13.0.3      osv_vulns=0
diff                       9.0.0      osv_vulns=0
dompurify                 3.4.15      osv_vulns=0
fastify                    5.12.5     osv_vulns=0
highlight.js              11.12.0     osv_vulns=0
jsdom                     30.1.0      osv_vulns=0
kysely                    0.29.6      osv_vulns=0
marked                    18.0.13     osv_vulns=0
react                     19.3.0      osv_vulns=0
react-dom                 19.3.0      osv_vulns=0
zod                        4.6.5      osv_vulns=0
@types/better-sqlite3      9.6.0      osv_vulns=0
@types/jsdom              30.0.0      osv_vulns=0
@types/node               24.13.5     osv_vulns=0
@types/react              19.3.0      osv_vulns=0
@types/react-dom          19.3.0      osv_vulns=0
@vitejs/plugin-react       6.1.1      osv_vulns=0
typescript                 7.0.2      osv_vulns=0
vite                       8.3.0      osv_vulns=0
--- 直接依赖 31 个，OSV 命中漏洞合计 0
```

**版本与协议对照（同一脚本核对）**：`package.json` 的 23 个 `dependencies` + 8 个 `devDependencies` **全部**能在
§2.1 / §2.2 表格里找到同名同版本的行（0 缺失、0 不一致、0 多余）；协议均为 **MIT / Apache-2.0 / BSD / ISC** 之一（无 GPL/AGPL/无协议）。
**上次查询时间**：阶段 1（11 个）、阶段 2（3 个）、阶段 7（2 个）、阶段 22（4 个 + 1 传递依赖）；本次（2026-09-20）为**全量重查**。
⚠️ 依赖版本此后若有升级，需重新查询（本文件的 OSV 结论只对表中列出的版本有效）。

阶段 2 新增（3 个）：

```
@fastify/cookie            11.1.2     osv_vulns=0
@fastify/rate-limit        11.2.0     osv_vulns=0
@node-rs/argon2            2.2.1      osv_vulns=0
```

阶段 4 新增（5 个，**装前**查 + 装后复跑 audit 均为 0）：

```
marked                     18.0.13    osv_vulns=0
dompurify                  3.4.15     osv_vulns=0
jsdom                      30.1.0     osv_vulns=0
highlight.js               11.12.0    osv_vulns=0
diff                       9.0.0      osv_vulns=0
```

阶段 6 新增（1 个，装前查 + 装后复跑 audit 均为 0）：

```
@fastify/cors              11.3.0     osv_vulns=0
```

阶段 7 新增（2 个，装前查 + 装后复跑 audit 均为 0）：

```
@modelcontextprotocol/sdk  1.30.0     osv_vulns=0（历史 GHSA 上界 ≤1.26.0）
zod                        4.6.5      osv_vulns=0
```

阶段 8（前端 P0）新增：**0 个**。UI 全部用阶段 1 已固定的 `antd@6.6.4` + `@ant-design/icons@6.3.4`（均 MIT，见 §2.1）；
Markdown 预览的代码高亮**样式表**复用既有 `highlight.js@11.12.0` 的 `styles/github.css` / `styles/github-dark.css`
（`web/src/styles/markdown.css` 按 `prefers-color-scheme` 用带媒体查询的 `@import` 引入 → 随 Vite 本地打包，仍**零 CDN**）。
**刻意没有引入**：react-router（列表↔编辑器用应用内视图状态）、状态管理库（只有会话 + 列表两处共享状态）、
任何第二套 CSS 框架（不引 Tailwind）；理由与取舍记在 `PROGRESS.md`「阶段 8 开工前 §3 决策 1/4」。

**③ 维护活跃度**：27 个直接依赖的 `npm view <pkg> time.modified` 全部在 2025-08 ~ 2026-09 之间
（近一年有发布/维护），符合 STANDARDS §4.3 第 2 条。

> 注：沿用系统 npm 配置（`registry=https://registry.npmmirror.com`）时 `npm audit` 会报
> `[NOT_IMPLEMENTED] /-/npm/v1/security/*`。这是镜像站未实现 audit 端点，**不是本项目的问题**；
> 查漏洞时显式加 `--registry=https://registry.npmjs.org`（或走 OSV）。

## 6. 后续阶段计划引入的依赖（**尚未安装**）

**暂无**：阶段 8（前端 P0）已按计划**零新增依赖**完成（只用已固定的 antd 6.6.4 + 既有 React/Vite/highlight.js）；
阶段 9 只做收尾（README/截图/测试），预计不需要新依赖。若后续确需新依赖，按 STANDARDS §4.3/§4.4 两道闸门先查后装并登记在此。

> 上述包**未进入当前依赖树**；阶段门只按当前 `package.json` / lockfile 计数与审计。
> `zod` 已决定**不引入**（用 fastify 自带 JSON Schema），见 §2.2 之后的"未引入的包"。
