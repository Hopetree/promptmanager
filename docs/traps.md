# 陷阱与实测值（为什么某些代码长这样）

> **这份文档回答"为什么"**。`AGENTS.md` 只写「不许怎么做」的红线；**每条红线的根因、当时的实测值、
> 以及复现方式在这里**。改到相关代码前读对应小节 —— 这些数字都是当时真跑出来的，不是估算。
>
> 约定：新增一条红线时，**红线进 `AGENTS.md`（≤3 行），证据进这里**。这样 `AGENTS.md` 不会随阶段无限膨胀
> （它受 AI 代理的指令预算硬约束，见 `AGENTS.md` 开头）。

## 目录

- [1. 令牌与权限](#1-令牌与权限)
- [2. 令牌表与抽屉（移动端）](#2-令牌表与抽屉移动端)
- [3. 登录页与布局](#3-登录页与布局)
- [4. 取用计数](#4-取用计数)
- [5. 卡片视图底部元信息](#5-卡片视图底部元信息)
- [6. 令牌状态列配色](#6-令牌状态列配色)
- [7. 中文全文检索](#7-中文全文检索)
- [8. 版本保留上限](#8-版本保留上限)
- [9. 导入 `replace` 的清理顺序](#9-导入-replace-的清理顺序)
- [10. 内网 HTTP 下的剪贴板](#10-内网-http-下的剪贴板)
- [11. 沙箱与运行环境](#11-沙箱与运行环境)
- [12. 文档与截图的落点](#12-文档与截图的落点)
- [13. 变量默认值只认 `default`](#13-变量默认值只认-default)

---

## 1. 令牌与权限

**令牌权限两档（`read` / `write`）只作用于资源。**

- `read`（新令牌缺省）允许资源读，**包含渲染类 POST**（`/api/prompts/:id/render`、`/api/render/markdown`）
  —— 渲染不改数据，且 MCP 的 `prompt_render` 依赖它。
- `write` 额外允许资源写。
- **令牌管理**（`/api/tokens*`）、改口令、登出、`/api/sync/*` 一律**仅会话可用**（`403 session_required`）
  —— 泄漏的令牌不得能枚举令牌或签发新令牌。
- **令牌不能改自己的 scope**（`PATCH /api/tokens/:id` 对令牌主体返回 `403 session_required`）：
  否则 `read` 令牌能把自己提成 `write`，整条权限边界失效。界面入口是「状态」列里可点的权限文字
  （**仅有效行**，仍是 6 列、不横滚）；本机管理路径是 `pm token set-scope <id> <read|write>`，
  每次成功变更写一行日志（`token scope changed`，只记 id 与 from/to，**绝不记令牌值**）。
- `scope` 为 `NULL`（迁移前的存量）按 `write` 处理，向后兼容。

**令牌在库里存两份**（`api_tokens`）：`token_hash`（sha256）是**唯一**用于鉴权的字段；
`token_enc`（AES-256-GCM，密钥来自 `TOKEN_ENC_KEY` 或 `<DATA_DIR>/token-enc.key`，**模式 600**）
只为让明文能经 `POST /api/tokens/:id/reveal`（**仅会话 cookie**）或 `pm token reveal <id>` 再读出来。
**密钥丢失不影响鉴权**，只让已存令牌不可读。

## 2. 令牌表与抽屉（移动端）

**抽屉必须能在手机上用**：抽屉宽度被夹到视口宽（390），所以 6 列表格**必须**有 `scroll.x`
—— 那是让 antd 渲染出可滚 `.ant-table-content` 容器的唯一条件。

**`scroll.x` 绝不能手写。** 曾写死 `scroll={{ x: 419 }}`，**小于 6 列实际所需**，于是
`tableLayout: fixed` 下五个定宽列吃光预算，**唯一没有 `width` 的名称列被算成 0px**
（390 视口实测 `left === right === 20`，且第一个表头是 `Token` —— 用户看到的是「少了一列」）。
现在该值来自 `TOKEN_TABLE_MIN_WIDTH`，即**各列 `minWidth` 常量之和**（名称 ≥ 60px），改任何一列宽度
`scroll.x` 会跟着动。不要用 `'max-content'`：它会写出 `width: max-content`，无视单元格的
`maxWidth: 100%` 省略号并把名称列撑大（实测 257px、表格 714 > 抽屉 600）⇒ **桌面端反而出现横滚**
且把操作列挤出可视区。

`TokenDrawer` 还接一个 `isMobile`（由 `Workspace` 传入，断点与 `SplitView` 相同）把创建表单切到
`layout="vertical"`。改这里必须在**真实视口**（390×844 与 1600×900）验证。

**测宽高一定要等动画落定**：抽屉滑入动画期间 `getBoundingClientRect` 返回的是飞行中间值 ——
阶段 44 的验收就是这么被骗过去的。

## 3. 登录页与布局

**登录页不得纵向溢出。** 本仓库**没有全局 `box-sizing: border-box` 重置**（连 `web/index.html` 里都没有），
所以元素默认是 `content-box`，`minHeight: '100vh'` **不含** padding。`LoginPage` 根容器有
`padding: '48px 24px'`，于是它在**任何**视口都占 `100vh + 96px`（实测 390×844 上是 940、1600×900 上是 996
—— 溢出量就是纵向 padding 之和，与视口高度无关）。修法是给该根容器显式 `boxSizing: 'border-box'`；
居中与留白未动（标题/输入/按钮实测 ±2px 内一致）。**以后在任何地方加 `100vh` 高度，都要同时设 `border-box`。**

## 4. 取用计数

**「取用」= 真的用了，不是看了一眼。**

`usage_events.kind`（迁移 006）三档：`view`（打开详情 —— **只留痕、不计入**）/ `copy`（复制 + 渲染）/
`mcp`（MCP 渲染），缺省 `copy`。**所有对外展示的计数** —— 详情页的 `use_count`、列表里的、以及
`GET /api/usage/summary` 的每个数字 —— 都必须过滤 `kind in ('copy','mcp')`，且**必须用同一个 filter**
（否则页面与统计互相打架）。注意 MCP 的 `prompt_get` 是 MCP 版的「打开详情」，算 `view`；
只有 `prompt_render` 算 `mcp`。存量行**有意**回填为 `copy`：**历史不重算**。

**取用按「用户动作」记，不按请求记。** `GET /api/prompts/:id` 记一条（打开详情算取用），
`POST /api/prompts/:id/render` 也记；列表/搜索不记。所以复制路径**不得**为了拿正文去调
`api.getPrompt()` —— 那是同一条计数路由，一次复制会记**两条**（实测 +2：open + render）。
`usePromptCopy` 复用已加载的 `prompt.user_prompt`（列表行是 `selectAll('p')`），于是复制不含变量的
prompt **零请求**，含变量的路径恰好一条事件（`render`）。

改这里要**对着数据库验**，不要看界面数字 —— 抽屉里的「取用 N 次」在详情重开前不会刷新。

**复制两条路径都必须恰好记一次。** 含变量路径开弹窗（那一步只发 `GET …/variables`、**不记任何东西**），
在「复制结果」时经 `POST …/render` 记一次；**不含变量**路径是纯本地写剪贴板，所以必须显式调
**`POST /api/prompts/:id/copy`** —— 一个只记账的瘦端点（记 `copy`，MCP 通道记 `mcp`），返回 **204**，
不渲染、**绝不记 `view`**。**不要**拿 `GET /api/prompts/:id` 来「复用」：那是打开详情的路由，会记 `view`。
该端点归**资源读**（与渲染 POST 同类），只读令牌可以调。前端**顺序**很重要：**先写剪贴板、再记账**
（写剪贴板需要用户激活）。

## 5. 卡片视图底部元信息

**卡片底部只显示「目录 + 版本 + 变量数」，别的都不显示。** 元信息行是
`folderNameOf(folders, prompt.folder_id)`，**目录图标在最前**，然后 `v{n}`，然后 `变量 {n}`；
**取用数与日期已去掉**（表格视图保留全部 —— **只动卡片**）。目录缺失渲染 **「未分组」**
（`CARD_FOLDER_FALLBACK`），绝不空白/`null`；表格仍说「未归类」，所以两处用词**有意不同**。
**不要往接口契约里加 `folder_name`**：`Prompt.folder_id` 保持数字，名字由前端从 `Workspace` 已经传给
`UseView` 的 `folders` 数组映射（目录名本来就在库里，**无需迁移**）。

相邻项之间用可见的 **「·」**（`<span aria-hidden className="pm-meta-sep">`），flex gap **6px**（原 10px），
分隔符比正文**更淡**（走专门的 `inkFaint` 调色板项）。两个坑：
①「更淡」必须断言为**对卡片底色的对比度**，不是绝对亮度 —— 暗色下更淡的颜色**亮度更低**，
用亮度比较会静默反向；②分隔符**绝不能进复制内容** —— 它是 `aria-hidden` + `user-select: none`，
且复制路径只把 `prompt.user_prompt` 传给 `copyText`、从不取 DOM 文本。
**只改那一个 Flex 的 gap**：卡片内部间距（纵向 10px、标签行 4px）与另两个视图都保持原样。

## 6. 令牌状态列配色

**令牌状态必须靠颜色区分，不能只靠文字。** 「状态」列从 `TOKEN_SCOPE_TAG_COLOR`
（read=`green`、write=`gold`）与 `TOKEN_REVOKED_TAG_COLOR`（`default`）渲染
`有效 · 只读` / `有效 · 读写` / `已撤销 · …`。**绝不给两个分支写死同一个 `color`** —— 那正是原来的 bug：
`scope` 只改**文字**，于是只读/读写的 `backgroundColor` 完全相同（实测亮 `rgb(246,255,237)`、
暗 `rgb(22,35,18)`）。用 **antd 预设色名**，绝不用 hex/rgb 字面量：预设自带随主题的 bg+fg 对，
亮暗都能用。保持语义次序（write 必须看起来比 read **更重**），且**不要**给 read 用红色 ——
本产品里红色 = 危险/已撤销。

## 7. 中文全文检索

`FTS5 trigram` 只支持 ≥3 个 Unicode 码点，**<3 走 `LIKE '%…%'` 全表扫描兜底**；
2000 行量级实测 0.2 ms，但数据量到 **10 万行量级需要重新评估**。`bm25` 在小语料可能同分，
此时按 `updated_at` 倒序。完整实测见 [`search-zh.md`](search-zh.md)。

## 8. 版本保留上限

`prompt_versions` **每个 prompt 最多保留最新 10 行**（`VERSION_KEEP_LIMIT`，
`src/db/prompt-versions.ts`）。每条插入版本的代码路径都必须在**同一事务内**调
`pruneVersions(qe, promptId)` —— 今天是 create / PUT / 回滚 / 批量收藏·移动 / 导入（replace + merge）。
裁剪只删行：**绝不重编号 `version_no`**，且 `prompts.version_no` 永远豁免删除。存量数据**没有迁移** ——
旧行会在该 prompt 下次产生版本时被裁掉。当导出文件里某个 prompt 的版本多于 10 个时，
这个上限**优先于**「`replace` 导出→导入→再导出字节相等」的保证（见 `README.md` 已知限制）。

## 9. 导入 `replace` 的清理顺序

`replace` **不能一把清表**：`folders.parent_id` 是自引用外键且声明 `ON DELETE RESTRICT`
（`migrations/001_init.sql`），所以目录必须**从叶子往上反复删**。

## 10. 内网 HTTP 下的剪贴板

**`navigator.clipboard` 在内网明文 HTTP 下根本不存在。** 在 `http://192.168.x.x:<port>` 页面不是安全上下文
（`window.isSecureContext === false`），所以复制必须回退到 `document.execCommand('copy')`。
**用 `127.0.0.1` 验证会掩盖这个 bug**（它算安全上下文）。所以涉及剪贴板/安全上下文的验收
**必须走内网 IP**。实现见 `web/src/clipboard.ts`，单测见 `tests/clipboard-fallback.test.ts`。

## 11. 沙箱与运行环境

- **`npm ci` 在本沙箱会 EROFS**：`/root/.npm` 是只读的。修法是把缓存放仓库内 ——
  **`npm ci --cache var/cache/npm`**（`var/` 已 gitignore）。任何会写缓存的 npm 命令同理。
- **`npm ci` 会跳过 better-sqlite3 的 install 脚本**（npm 11 allow-scripts 策略，会打印
  `npm warn allow-scripts ... better-sqlite3@13.0.3 (install: node-gyp rebuild)`）。**这无害**：
  该包在 `prebuilds/` 里带了各平台二进制，**部署主机不需要 gcc / node-gyp**。
- **`bin/pm.mjs` 与 `node --test` 都从 `dist/**` 加载**：`npm run build` 之前调 CLI 会报
  `dist/server/cli.js` 找不到并退出 1；而测试从 `../dist/**` import，所以**改了 `src/` 不重建 = 在测旧代码**。
- **`npm run typecheck:tests` 是对构建产物做类型检查**，所以 `dist/` 必须先存在：
  `tests/**/*.test.ts` 从 `../dist/**` import，干净检出（CI、无 `dist/`）下会报
  **38 个 `TS2307`**（外加 3 个级联 `TS7006`），而本地因为残留 `dist/` 反而是绿的。
  这就是 `tools/ci-check.sh` 把构建排在类型检查**之前**、且 `typecheck:tests` 脚本自身带
  `npm run build:server &&` 前缀的原因。复现：`rm -rf dist && npm run typecheck:tests` —— 修前 38、修后 0。
- **Markdown 渲染用的 `jsdom` 是模块级单例，常驻约 200 MB RSS**（`src/services/markdown.ts` 在模块加载时
  `new JSDOM('')`，完整起服务后 VmRSS ≈ 204 MB）。多个测试文件并发加载 jsdom 会造内存压力，
  表现为**文件级 `test failed`**（不是断言失败）。见 `README.md` 已知限制。
- **`node --test` 下 CLI 子进程必须 `detached: true`，否则测试会 flaky**：与测试运行器同进程组的子进程
  会在环境清理整组时被一起杀掉（`kill -PGID`、`bwrap --die-with-parent`），断言看到 `code=null`；
  加诊断后是 `signal=SIGSEGV`。这个失败形态下 `node:test` 只报文件级 `✖ <file> 'test failed'`、无细节。
  修法是用共享 helper（`tests/helpers.ts` 的 `runCliProcess()`：`detached`、吞 EPIPE、30s 安全阀）
  —— **不是重试**。

## 12. 文档与截图的落点

**判据**：*最终交付物 / 给人读的文档 → `docs/`；只有过程需要的东西 → `tmp/`。*

- **`docs/` 只放最终态、给人读的东西**：产品文档、依赖台账、版本规则、检索报告、以及**唯一一套**关键页截图。
- **`tmp/` 放过程产物且永不入库**（已在 `.gitignore`）：逐阶段验收截图、自查截图批次、AC 探针中间产物、
  调试 dump、临时脚本、日志、备份。**`git ls-files tmp` 必须恒为 `0`**。
- **截图分层**：关键页截图 → `docs/shots/`（**恰好一套 8 张**：`01-login` `02-split` `03-table` `04-cards`
  `05-editor` `06-detail` `07-mobile` `08-dark`）；过程截图 → `tmp/shots/`；被替换的一律**归档（移动）**
  到 `tmp/shots-archive/`，**绝不留在 `docs/`**。
- `bash tools/ui-shots.sh` 缺省输出到 `tmp/ui-shots/shots/`（自查，不入库）；只有
  `bash tools/ui-shots.sh --key` 才产出唯一一套关键截图到 `docs/shots/`，且会先把上一套归档。
- **仓库里不放过程态**（2026-09-30 起）：需求合同、进度日志、验收记录、一次性验收脚本、设计打样归档
  都已移出仓库到**本地** `tmp/dev-process/`（镜像布局）。它们**不是**交付物，**不要**再提交回去。

## 13. 变量默认值只认 `default`

**判据**：*不认识的写法一律按字面原样输出 —— 宁可不生效，也不静默给错值。*

- **只实现 `default` 一个过滤器**（`{{ 名字 | default(默认值) }}`，Jinja 系）。`{{ x | upper }}`、
  `{{ x | default }}`（无括号）、`{{ x | Default(x) }}`（**区分大小写**）、`{{ x | default(x) | upper }}`
  全部**不识别**，按字面文本原样输出：不报错、不猜、更不静默换成别的值。
  理由：引入通用过滤器就要引入模板引擎（表达式 / 循环 / 函数），而现有契约是「不匹配即字面」
  （`{{a b}}`、`{{}}`、`{{x!}}` 都按字面），多一个过滤器不生效比猜错值安全得多。**这不是功能缺口，是刻意的边界。**
- **默认值是字面文本**，不是模板：`{{ k | default({{x}}) }}` 的默认值就是字符串 `{{x}}`，**不再递归解析**
  （旧版本会把内层 `{{x}}` 当变量提取出来 —— 这是本阶段唯一一处授权的行为变化，已记入 AC-122 ⑧）。
- **两端成对引号会被剥掉**：`default('y')` / `default("y")` ⇒ `y`；只有一个引号则保留原样。
- **取「紧跟 `}}` 的那个 `)`」之间的内容**：所以 `default(a)b)` ⇒ `a)b`、`default(x:y)` ⇒ `x:y`、
  `default(a}}b)` ⇒ `a}}b`。正则用 **lazy**（`[\s\S]*?`）而非 greedy —— greedy 会跨过占位符边界，
  把后面另一个占位符的 `)` 和 `}}` 一起吞掉。
- **竖线在 Markdown 表格里必须转义**（`{{ 名字 \| default(值) }}`，否则表格单元格会被竖线切开），
  所以正则同时接受 `|` 与 `\|` 两种写法，**语义完全等价**。
- **「没填」= `values` 里根本没有这个键**；**显式传空串 ⇒ 渲染成空**（不回落默认值）。
  有默认值的变量**不再进 `missing`**，界面「还有 N 个没填」只统计无默认值的。
- **同名多处默认值不同 ⇒ 取首次出现**，全篇一致（`scanVariables` 只记首次）。
- **默认值表是「全篇」的，两段必须共用同一张**（返工 ①）。一条提示词有用户段 + 系统段，
  `POST /render` 原先对两段**各扫各的**（`renderVariables` 内部 `scanVariables(text)` 只看本段），
  于是 `U={{ m | default(甲) }}` + `S={{ m | default(乙) }}` 会出现
  `GET /variables → {"defaults":{"m":"甲"}}` 而 `POST /render → {"user_prompt":"U=甲","system_prompt":"S=乙"}`
  —— **界面说甲、成品填乙**。修法：`/render` 先算一次
  `scanVariables(user_prompt, system_prompt).defaults`（与 `/variables` **同一张表**）再传给两段。
  实测口径（`tests/stage60-variable-defaults.test.ts` 返工① b 七例逐条对照）：
  两段默认值不同 ⇒ 只认首次（用户段在前）；用户段首次没写 ⇒ 该名**全篇无默认值**
  （接口不进 `defaults`、两段保留占位符并进 `missing`）；用户段有、系统段裸占位符 ⇒ 系统段也用全篇表；
  显式值 / 显式空串仍优先于默认值。**「接口报的默认值 ≡ 渲染替换进去的值」是判据**，
  任何"报一个、填另一个"的写法都是 bug，不是可接受的近似。
- **默认值只写在正文里**：不落库、不新增迁移、不新增列 ⇒ 复制 / 导出 / 导入 / 云同步天然带上它，
  `variables` 接口形状不变、只加平行的 `defaults` 字段（加法 ⇒ MINOR 版本）。
- **前后端两份正则必须逐字一致**（`src/services/variables.ts` 的 `PLACEHOLDER` 与 `web/src/pure.ts` 的
  `PM_PLACEHOLDER`）：前端实时预览与服务端渲染结果要求**逐字符相同**，改一份必须同步改另一份，
  `tests/variables-preview-parity.test.ts` 与 `tests/stage60-variable-defaults.test.ts`（AC-122 ⑭）会盯着。
