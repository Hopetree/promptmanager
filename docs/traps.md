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
- [14. 变量记忆开关放服务端，变量值仍留本地](#14-变量记忆开关放服务端变量值仍留本地)
- [15. 「版本号只记内容变更」的三个坑](#15-版本号只记内容变更的三个坑阶段-62--fr-129)
- [16. 排序与取用历史在导入 / 云同步里的两个坑](#16-排序与取用历史在导入--云同步里的两个坑阶段-64--fr-132--fr-134)
- [17. 扫源码的断言：先剥注释，再断言](#17-扫源码的断言先剥注释再断言阶段-67--fr-139)
- [18. 性能与本地残留的四个坑（阶段 68 / FR-140 ~ FR-143）](#18-性能与本地残留的四个坑阶段-68--fr-140--fr-143)
- [19. 机械记账的三个坑（阶段 69 / FR-144 ~ FR-146）](#19-机械记账的三个坑阶段-69--fr-144--fr-146)
- [20. 鉴权分类与 `/mcp` 的 401（阶段 70 / FR-149）](#20-鉴权分类与-mcp-的-401阶段-70--fr-149)
- [21. CLI 的两条通道：为什么不是"并成一条"（阶段 70 / FR-150）](#21-cli-的两条通道为什么不是并成一条阶段-70--fr-150)

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
- **变量语法只有一处**（阶段 70 / FR-147）：`src/variable-syntax.ts` 是唯一定义，服务端门面
  （`src/services/variables.ts`）与前端 `web/src/vars.ts` 都引用它 —— 改一处两端同时生效。改前是
  「两份正则靠人肉同步」，
  `tests/variables-preview-parity.test.ts` 与 `tests/stage60-variable-defaults.test.ts`（AC-122 ⑭）会盯着。

## 14. 变量记忆开关放服务端，变量值仍留本地

**「要不要记住变量值」是提示词的属性，不是浏览器的属性 —— 开关存服务端，值仍存 localStorage。**

- 坑的形态：把开关和变量值一起塞进 `localStorage`，会出现「电脑上设了不记住、手机还在记」；
  而且导出 / 导入 / 远程同步**带不走**这个设置，换台机器就回到默认。用户要的是「有的提示词不需要记住」，
  这是**条目级**的决定，跟 `favorite` 同类。
- 做法：`prompts` 新增列 `remember_variables`（迁移 `008_remember-variables.sql`，
  `INTEGER NOT NULL DEFAULT 1 CHECK (remember_variables IN (0, 1))`）。默认 1 ⇒ **存量提示词一律"记住"，
  既有行为一字不变**；该字段随 `GET/PUT /api/prompts*`、导出 / 导入、`/api/sync/*` 一起往返
  （`import.ts` 里缺省是 `true`，与 `favorite` 缺省 `false` **相反**，别照抄）。
- ⚠️ **开关上服务端 ≠ 变量值上服务端**：本列只控制"要不要记"；填过的变量值**长期只存在浏览器
  `localStorage`**（键 `pm-vars:<id>`）。别把这句话说成"变量值永不上传服务端"——**不准确**：渲染时
  `web/src/use-copy.ts` 会走 `POST /api/prompts/:id/render`（`src/server/routes/prompts.ts`）把值放在
  请求体里发一次，服务端只是**不落库、不持久化**（进程内用完即弃）。把值**存**到服务端是另一个量级的
  改动（隐私面、并发、合并），明确不做。
- 界面**两处入口读写同一字段**（填值弹窗的勾选框 + 提示词编辑页的开关）⇒ 改一处，另一处刷新后一致；
  两处都走 `PUT /api/prompts/:id`，没有专用接口。
- **取消勾选即时生效**：不预填、点「复制结果」不写入，并**立刻删掉该提示词已存的记忆**
  （否则重新勾上时旧值"诈尸"）。弹窗里的「清空」按钮是**纯前端动作**（清表单 + 删记忆），也不新增接口。

### 14.1 已知设计后果（复核记录，**不是待修 bug**）

对抗性复核（2026-10-10，commit `8109663` 之后）量过下面几条，逐条都由**既有合同**决定，改动等于改
BRIEF，所以只记录、不修：

- ✅ **切换偏好开关会消耗内容版本历史 —— 已由 FR-129（阶段 62）修掉。** 复核时 `src/services/prompts.ts`
  的 `updatePrompt` 按 BRIEF §6.1「每次 PUT 都产生新版本」无条件 `version_no + 1` 并留快照，而 FR-86
  只留最近 10 版 ⇒ 勾 / 取消「记住变量值」满 10 次就把最早的内容版本裁掉、不可逆（复核探针：
  `current version_no = 12`、留存 3–12 全是同一版内容、回滚到最初内容已不可能）；`favorite` 与
  `bulk action=favorite` 同理。**阶段 62 起只有内容字段（title / user_prompt / system_prompt / notes）
  真的变了才产生版本**（非内容操作连 `updated_at` 都不碰）——判据见 §15。
- **服务端写失败时本地已翻**：弹窗勾选框是"先改本地、再异步 `PUT`"（取消勾选要即时删记忆，这是 FR-127
  的要求）。若 `PUT` 失败（网络 / 5xx），弹窗已显示"不记住"且本地记忆已删，而服务端仍是 `true` ⇒
  编辑页开关显示「记住」、弹窗显示「不记住」，**重开弹窗即自愈**（服务端值胜出）。401 不走这条路
  （`handleUnauthorized` 直接登出）。变量值本身没丢，属可接受的一致性窗口。
- **记忆键没有用户维度、登出不清**：`pm-vars:<id>` 是 spec 规定的键格式，不含用户名；登出只
  `api.logout()` + `onSignedOut()`，**不清 `localStorage`**。共用同一浏览器时，下一个账号打开同一条
  提示词会看到上一个账号填过的值。值本身不是机密（用户自己手打的提示词变量），但要按"共用机器要自己
  清"来理解。

## 15. 「版本号只记内容变更」的三个坑（阶段 62 / FR-129）

- ⚠️ **`updated_at` 不再是「这条记录被写过的时间」，而是「内容最后变更时间」**（D-60 ①）。点收藏、
  挪目录、切「记住变量值」、改标签、拖拽排序**都不碰它**。所以「按最近更新排序」不会再被"点了个收藏"
  污染 —— 但任何**依赖 `updated_at` 表示"记录被动过"**的新代码都会判断错。要"置顶"请用 `favorite`。
  它**不参与任何冲突合并**（`src/services/import.ts` 的 merge 是「prompt 一律新建」、不比时间戳），
  只被列表排序读（`src/db/prompt-queries.ts`）—— 这条已核实，所以改口径不影响云同步。
- ⚠️ **判据是「值真的变了」，不是「请求里带了这个字段」**。`PUT {"title": "<与当前完全相同的值>"}`
  ⇒ **不产生版本、不更新 `updated_at`**；`PUT {}` 同理。比较是**逐字**的（不 trim、不归一化）——
  多一个空格就是"变了"。回滚也吃同一条判据：回滚到**与当前内容相同**的那一版 ⇒ 不产生新版本。
- ⚠️ **「内容字段」固定为 4 个，不许顺手加**（D-60 ③）。判据不是"这个字段重不重要"，而是
  **`prompt_versions` 装得下、且回滚能恢复**：`title` / `user_prompt` / `system_prompt` / `notes` 在
  快照表里 ✅、回滚会写回 ✅；`folder_id` / `favorite` / `sort_order` / `remember_variables` / 标签
  不在快照里 ❌ ⇒ 一律不算。往快照表加列 = 改数据模型契约，要连带改 BRIEF、回滚、导入导出。
- **实现落点**（**两个**判据调用点 + 一处"恒不产生版本"）：`src/services/prompts.ts` 的 `updatePrompt`
  （单条 `PUT`）与 `src/services/versions.ts` 的 `rollbackToVersion`（回滚）**共用**同一个判据
  `hasContentChange` / `CONTENT_FIELDS`（定义在 `src/services/prompts.ts`）。
  `bulkPrompts`（批量收藏 / 移动）**不调用判据** —— 它压根不写 `version_no` / `updated_at` / 版本快照，
  **恒不产生版本**；`reorderPrompts`（拖拽排序）本来就只写 `sort_order`，是"早就对了"的那一处，保持不动。
  ⚠️ 将来若给 `bulkPrompts` 加"能写内容字段"的批量动作，必须**补上判据调用**，别以为它已经过了判据。
- ⚠️ **回滚的提示文案必须按返回值分支**：回滚到与当前内容相同的那一版时**不产生新版本**，此时若还提示
  "已生成新版本"（旧文案），用户会以为回滚失败或以为多了一版而反复操作。落点是 `web/src/notices.ts` 的
  `rollbackNotice(targetVersionNo, beforeVersionNo, afterVersionNo)`，由
  `web/src/components/VersionPanel.tsx` 的 `rollback()` 按 `updated.version_no` 调用。

---

## 16. 排序与取用历史在导入 / 云同步里的两个坑（阶段 64 / FR-132 · FR-134）

### 16.1 导出文件里漏掉 `prompts.sort_order` ⇒ 拖好的顺序静默归零

- **坑的形态**：导出文件自称"全量快照"、云同步把它当"异地副本"协议，但 `ExportPrompt` 里
  **没有 prompt 的 `sort_order`**（export/import 里出现的 `sort_order` 全是 **folder** 的）。
  于是"导出 → 导入"或"从云端恢复"之后，所有 prompt 的 `sort_order` 落回列缺省值 `0`
  —— 用户拖出来的顺序**全没了**，不报错、不提示，而且这是**数据损坏**而不是展示问题
  （`0` 会被当成"真的排在第 0 位"写进库）。
- **为什么必须带上**（D-62 ①）：拖拽是**有意的用户动作**，顺序是用户产出的数据；
  `sort_order` 本来就在表里（`migrations/003_prompt-sort-order.sql`），带上它**只是加一个字段**，
  不改存储方式、不改槽位算法、不需要迁移。
- **做法**：`ExportPrompt` / `NormalizedPrompt` 各加 `sort_order: number`，`buildExport` 的映射
  与 import 的两处插入（replace / merge）都带上它；**缺字段 ⇒ 缺省 0、不报错**
  （阶段 64 之前的备份文件必须还能导入，D-62 ⑥）；类型不对（`"7"` / `1.5`）⇒
  `400 invalid_import` + `data.prompts[].sort_order 必须是整数`。
- ⚠️ **槽位算法不受影响**：`reorderPrompts`（`PATCH /api/prompts/order`）读的是"这组 id 当前占据的
  `sort_order` 槽位"，导入进来的 `50 / 100` 会被原样当成槽位集合，再拖一次仍按槽位语义重排
  —— 别把导入值"归一化成 1..N"，那会抹平用户已有的顺序。

### 16.2 `replace` 导入会**级联清空**取用历史（`usage_events`）

- **坑的形态**：`usage_events.prompt_id` 是 `ON DELETE CASCADE`（`migrations/002_tokens-and-usage.sql`），
  而 `replace` 导入在事务里 `DELETE FROM prompts` ⇒ **本地全部取用次数与"最近使用"被连带清零**；
  导出文件只有交付数据（5 张表，**不含 usage**）⇒ "从云端恢复"等于永久丢掉取用历史，
  而且**一声不响**。用户会以为"恢复之后统计还在"，实际从零开始。
- ⚠️ **关键词是「不静默」，不是「不许清空」**（D-62 ③）：恢复本质上就是重建数据，
  清空可以是有意的取舍 —— 但**不许既清空又不告诉用户，也不许连一份都留不下**。
- **做法**：`importData` 在清库**之前**把 `usage_events` 全量读出来，
  replace 且确有记录时写一份 `<DATA_DIR>/pre-replace-usage-<时间戳>.json`（**0600**，保留最近 3 份，
  与 `pre-restore-*.json` 同目录），响应里如实回报：
  `usage_history: {action: 'cleared', count: N, backup: '<绝对路径>'}`；
  merge 不清库 ⇒ `{action: 'kept', count: N, backup: null}`；本来没有记录 ⇒ `count: 0` 且
  **不编造备份**（`backup: null`）。界面 toast 由 `web/src/notices.ts` 的 `usageHistoryNotice()` 统一措辞。
- ⚠️ **写备份与裁剪旧备份必须分开**（返工 ①，对抗性复核发现）：`replace` 的写库是**事务**，
  导入失败会整体回滚 —— 此时**根本没有清库**。若把"只留 3 份"的裁剪塞进写备份里，一次失败的导入会
  ①新增一份自称「清空前留档」却什么都没清的**误导性文件**，②把一份**真实历史备份挤出保留窗口**。
  做法：`writeUsageBackup` 只写、`pruneUsageBackups` 只在 replace **成功提交后**调用；
  失败路径 `removeUsageBackup` 删掉刚写的那份 ⇒ 备份集合与导入前逐字节一致（`AC-126 ⑪（续 3）` 盯着）。
- ⚠️ **这份备份不进导出文件、不上传云端**（D-62 ⑥）：那会把"快照 = 交付数据"的语义搅浑
  （导入别家实例的备份会把别人的取用痕迹灌进本地）。它只是本地的一次救命存档。
- ⚠️ **`usageBackupDir` 是必填参数**（`ImportOptions`，故意不给默认值）：漏传就等于静默丢历史，
  那正是这条要消灭的行为。新增 `importData` 调用方时必须一起传 `DATA_DIR`。

## 17. 扫源码的断言：先剥注释，再断言（阶段 67 / FR-139）

- **坑的形态**：把源码文本当行为契约，直接对**未剥注释**的字符串断言。两个方向都会错：
  - **假红**：源码里加一行 `// 已删除 pm-mode-use`，`blob.includes('pm-mode-use')` 就红；
    把 `width={26}` 抽成 `const MARK_SIZE = 26`（行为完全没变）也会红；
    把按钮抽成子组件（DOM 顺序没变）同样会让 `indexOf` 顺序断言红。
  - **假绿**：`assertSomewhere(/api\.diff\(/)` 把 `web/src` 全拼成一个 blob，任意一个文件命中即过
    ⇒ 把整段功能删掉、只在别的文件留一句提到它的注释，仍然全绿。
- **做法**：所有扫源码的断言走**唯一入口** `tests/source-text.ts`（`readSource` / `readWebSource` /
  `sourceFiles` / `webSourceFiles`），拿到的文本**已剥注释**；剥注释**保留换行**（注释字符换成空格），
  所以 `indexOf` 与行号定位仍然可用。确实需要未剥文本的（构建产物 / JSON / 二进制 / **断言对象就是注释本身**）
  用 `readRaw` / `readBytes` / `readJson`，并在测试里写明理由。
- **书写形式 / 位置类断言要改成行为或渲染断言**：DOM 尺寸、DOM 顺序、菜单项顺序、「卡片里没有删除按钮」
  这类"渲染出来才知道"的事放 `tests/render/`（jsdom + `react-dom/client`，基建见阶段 65 的
  `tests/render/harness.ts`）—— 它是「尺寸抽成变量 / 按钮抽成子组件」仍然绿、而「真的换成 32×32 /
  真的换了顺序」才红的那一层。
- ⚠️ **每条改造都要双向验证**：无害重构（加注释 / 抽常量 / 抽子组件）⇒ **不红**；真回归（换尺寸 / 换顺序 /
  删功能）⇒ **仍红**。只测一半会把"修好一个假红、引入一个假绿"当成功。
- ⚠️ **别在 JSX 开标签内部插注释或插元素**：那会让文件**编译失败**，整个渲染级测试文件在**加载期**挂掉，
  表现为 `✖ tests/render/… 'test failed'`（用例级计数里只多一条文件级失败）—— 排查时先分辨
  「文件级失败」还是「用例失败」。
- ⚠️ **剥注释器本身也会剥错，而它错了上下层都看不出来**：它剥**多**了会把代码/字符串一起擦掉（上层断言
  假红或语义悄悄改变），剥**少**了注释还在（上层仍可能被注释骗过而假绿）。所以它必须有自己的守卫用例
  （`tests/stage67-source-text.test.ts`，9 条，含真源码全量语料）。阶段 67 返工 ① 修掉的三处实测缺陷：
  - **JSX 外壳只认紧贴的 `{/*`**：早期版本只要注释左边（跳过空白）是 `{` 就连花括号一起擦 ⇒
    对象字面量里的 `{\n  /** JSDoc */` 与 `catch { /* 隐私模式忽略 */ }`（`web/src/clipboard.ts:3102`、
    `web/src/components/Workspace.tsx:2262`、`web/src/components/VersionPanel.tsx:1523`）会被擦成
    `const x =            ;`。判据：`{` 与 `/*` **之间不允许空白**。
  - **SQL 只认引号外的注释**：用正则 `--[^\n]*` / `/\*…\*/` 会把 `'a -- b'`、`'/* x */'` 里的内容当注释
    吃掉（`'read'` / `'view'` 这类字面量整段消失）。做法：跟踪 `'…'`（`''` 转义）与 `"…"`，只在字符串外识别。
  - **YAML / shell 的行内 `#` 也要剥**：只匹配 `^[ \t]*#` 会漏掉 `key: 1 # c` / `echo hi # c`，
    对 `.yml` / `.sh` 的源码断言仍会被行内注释骗过。做法：`#` 前必须是**空白**且不在引号内
    （`${VAR#prefix}`、`URL#frag`、`foo#bar` 都保留）。
  - 反向注意：迁移文件里 `-- 取值 'read' / 'write'` 这类**注释里**的字面量本来就该被剥，
    别把"注释里的字面量消失"当成缺陷（守卫用例只检查非注释行上的字面量）。

## 18. 性能与本地残留的四个坑（阶段 68 / FR-140 ~ FR-143）

### 18.1 FTS 的 `AFTER UPDATE` 触发器没有 `WHEN` ⇒ 改收藏也在重建整行索引

- **坑的形态**：`migrations/001_init.sql` 的 `prompts_fts_au`（`AFTER UPDATE ON prompts`）**没有 `WHEN` 子句**
  ⇒ 对 `prompts` 的**任何** `UPDATE` 都会 `DELETE` + `INSERT` 一遍 FTS 行：改收藏、拖拽排序、
  切「记住变量值」、移动目录，全都在重建全文索引（表越大越贵，而且和内容毫无关系）。
- **做法**：**不动 `001_init.sql`**（已应用的迁移在别人的库上跑过了，改它会让两份库的 schema 悄悄分叉），
  新增迁移 `009_fts-update-when.sql`：`DROP TRIGGER IF EXISTS prompts_fts_au` + 重建带 `WHEN` 的版本，
  `WHEN old.title IS NOT new.title OR old.user_prompt IS NOT new.user_prompt OR old.system_prompt IS NOT new.system_prompt OR old.notes IS NOT new.notes`。
  **用 `IS NOT` 而不是 `<>`**：`<>` 遇到 `NULL` 得 `NULL`（不算真），`notes` 从 `NULL` 改成 `''` 时就会漏建索引。
- **可观测口径（不许只推理"加了 WHEN 所以不会重建"）**：`total_changes()` 的行变更数。
  实测（`tests/stage68-fts-trigger.test.ts` ③）：改 `favorite` / `sort_order` / `remember_variables` / `updated_at` = **1**；
  改 `title` / `user_prompt` / `system_prompt` / `notes` = **9**（触发器里的 delete + insert 也计入）；
  写回**同一个值** = **1**（`IS NOT` 判为没变）。**对照**：把 001 里那份无 `WHEN` 的旧触发器装回去，
  改 `favorite` 立刻变 **9** —— 证明这个口径看得见"重建"，不是恒 1 的假指标。
- 功能不能改坏：改完 4 个内容列之一，`GET /api/prompts?q=<新值>` 必须能**真检索到**（同用例 ② 逐列实测）。
- 迁移幂等：`runMigrations` 两次第二次 `applied.length === 0`；直接 `db.exec(009 的 SQL)` 两遍后触发器仍**恰好 1 个**。

### 18.2 侧栏目录计数不要 N+1

- **坑的形态**：`web/src/components/Workspace.tsx` 曾对**每个**目录发一次 `api.listPrompts({ folderId, limit: 1 })`，
  只为拿 `total` ⇒ 单次刷新的请求数 = **目录数 + 1**（3 个目录 = 4 次）。
  顺带纠正一个错误注释：那个接口的 `folder_id` 是**含全部后代**的筛选（`descendantFolderIds`），
  所以每个目录的 `total` 本来就是**子树计数**，侧栏徽标必须与它逐个相同。
- **做法**：`GET /api/prompts` 新增**可选**参数 `include=folder_counts`（只加不改；不传则响应形状逐字不变），
  服务端用**一条递归 CTE**（`countPromptsByFolder`，口径与 `descendantFolderIds` 一致）一次算出全部目录的子树计数。
  计数失败**不影响列表**：`folder_counts: null` + 仍然 `200`，前端此时**保留上一次的数字**（不清零、不阻塞筛选）。
- **判据**：① 请求数从「目录数 + 1」降到 **≤1**（渲染级实测 4 → 1）；
  ② 数字必须与改前**逐个相同**（用例把新值 `deepEqual` 于旧口径逐个 `?folder_id=N&limit=1` 的 `total`）。
  这是"更快"，不是"换个算法"。

### 18.3 Token 抽屉不要把明文反复全量预取

- **坑的形态**：抽屉每次打开、每次创建 / 撤销都对**全部**可查看令牌重发 `reveal` 拿明文
  （3 个令牌：打开 3 次、创建后累计 7 次、撤销后累计 11 次）。
- **做法**：内存缓存（`plaintextsRef`）+ 只补**缓存里没有**的行（`fillPlaintexts`）：
  打开 = 3、创建后 = 4（只多新行）、撤销后 = **4**（撤销只从列表消失，明文本来就在缓存里）。
  列表请求次数不变（1 / 2 / 3）。
- **安全底线不许顺手改**：明文**只留内存**（不写 `localStorage` / 不落库 / 不进日志），关闭抽屉即清空；
  FR-100 的既有决定照旧 —— `revealable === false` 仍显示 `—`，**已撤销行仍预取明文**（撤销 ≠ 销毁）。

### 18.4 关掉「记住变量值」必须清本地残留

- **坑的形态**：开关存在服务端（§14），变量值存在浏览器 `localStorage`（键 `pm-vars:<id>`）。
  只在**填值弹窗**里删键是不够的：**编辑页**保存 `remember_variables` 时完全不碰 `localStorage`
  ⇒ 从编辑页关掉开关后旧值仍然躺着（"关了还在"，下次重新勾上就诈尸）。
- **做法**：**两条入口都清** —— 编辑页 `save()` 里 `if (payload.remember_variables === false) removeRememberedVars(updated.id)`；
  弹窗取消勾选 / 清空同样调 `removeRememberedVars`。删除是幂等的，重复调用无害。
- 两条入口都要有**真渲染**用例（编辑页真点开关 + 真点保存；弹窗真取消勾选），并带**反向**用例：
  开关保持"记住"时保存**不得**误删（否则就是"修好一个、弄坏另一个"）。

---

## 19. 机械记账的三个坑（阶段 69 / FR-144 ~ FR-146）

### 19.1 迁移没有内容校验：改过的、改名的、命名不合规的，全都静默通过

- **坑的形态**：`schema_migrations` 原本只有 `(version, name, applied_at)`，运行器只按**数字前缀**判断
  "跑过没有"。⇒ ① 一个**已应用**的迁移被改动（哪怕一个字节、一个注释）没有任何机制发现，两份库的
  schema 会**悄悄分叉** —— "迁移幂等由版本表保证"救不了这个（版本号没变、内容变了）；
  ② 文件名不符合 `NNN_*.sql` 的文件被 `filter` **静默丢掉**；③ 已应用的文件被改名，历史同样无法追溯。
- **做法**：新增迁移 `010_migration-checksums.sql` 加列 `checksum TEXT`（**已应用的迁移一个字都不许改**，
  加列只能走新迁移）；`src/db/migrate.ts` 在应用前**逐个校验**：文件名不合规 ⇒ 抛错并点名文件、
  与记录不符 ⇒ 抛"文件名与记录不符"、内容 sha256 不符 ⇒ 抛"已应用的迁移文件被改动过：<file>"。
- **存量库口径**：升级前已应用的迁移没有 checksum ⇒ **首次见到时补记**（`UPDATE` 补上），
  所以老库升级后不会起不来；补记之后才开始校验。
- **hash 对什么取**：**文件的原始字节**（含注释与换行）。改注释、加空行同样算改动 ——
  这条口径由 `tests/stage69-migration-checksums.test.ts` 钉住，免得下次有人改个注释就莫名其妙失败。
- **判据**：`001–009` 的内容指纹（`sha256` 拼接）冻结在测试里；删掉/改动/改名/命名不合规，
  四种情况都有用例红。
- **删除也要拦（阶段 69 返工 ①）**：记录里有、目录里没有 ⇒ 抛"已应用的迁移文件不见了：<file>"。
  只查"目录里最大版本号以内"的洞 —— 记录版本**高于**目录最大号说明这份库比当前代码新
  （用旧代码打开新库的降级场景），那不是删除，不该拦。
- **残余局限（只能文档化，本机制修不了）**：**存量库第一次升级**时没有历史 hash，
  补记用的是"当前文件"的 hash ⇒ 若某个已应用迁移是在**这次升级之前**就被篡改的，
  篡改会被补记"洗白"，此后永久受信。所以补记只是把老库**拉进**受校验状态，**不能追溯升级前的改动**；
  仓库自己的 `001–009` 另有冻结指纹（`tests/stage69-migration-checksums.test.ts` 的
  `FROZEN_APPLIED_DIGEST`）兜底。要彻底可追溯需要外部可信参照（发布物签名 / 远端校验），本阶段不做。

### 19.2 同一个数字抄在 9 个地方：抄漏一处就是静默不一致

- **坑的形态**：schema 版本被**手写**在 9 个测试文件里、迁移数写在 4 个里，另有一个文件把完整的
  迁移清单**字面量**列了一遍。加一个迁移要逐个改 —— 抄漏一处，测试就守着错的数字。
- **做法**：**一处绊线，其余派生** —— `tests/migrations.ts` 的 `CURRENT_SCHEMA_VERSION` 是**唯一手写**
  的数字（它的作用就是"迁移数变了我要知道"），`MIGRATION_FILES` / `MIGRATION_COUNT` /
  `LATEST_MIGRATION` 全部从 `migrations/` 目录读。
- **⚠️ 不许把绊线全删掉**：全改成派生 = 把"迁移数变了没人知道"重新引入。
  绊线**红了按新值更新即可**，那不是维护负担 —— 这一条是阶段 66 复核的结论，阶段 69 用双向验证钉住
  （删掉一个迁移文件 ⇒ 红；把版本号改大 ⇒ 红）。
- **实测收益**（口径：加一个迁移时必须跟着改的**测试文件数**）：**11 → 1**。

### 19.3 体积账本：常量既是账本又是阈值，而且只有上界

- **坑的形态**：预算 = `BASELINE_TOTAL_GZIP` + **20 个手工累加的 `ACCOUNTED_DELTA` 常量**，
  且只有上界（`total <= budget`）⇒ ① **体积降下来不会回收预算**（预算只随阶段单调上升）
  ② 常量既是账本又是阈值 ⇒ **自证**（改常量就能改结论）③ 测试标题里列的阶段与常量已经对不上。
- **做法**：账本搬到 `tests/bundle-budget.json`（由 `node tools/bundle-budget.mjs --record <阶段> --note "<依据>"`
  用**实测值**写入，delta 可为负 ⇒ 体积下降自动回收预算），判定是纯函数
  `evaluateBundleBudget(measured, ledger)`，**上界与下界都查**（低于 `预算 × 0.95` ⇒ 提示"账本该回收了"）；
  测试标题里的阶段清单也从账本派生。
- **⚠️ 不放宽红线**：最大 chunk ≤ 500 KB 那条**一个字都没动**（`tests/stage18-bundle.test.ts` 与
  `tools/ci-check.sh` 里的 `500_000` 都原样保留，并有断言盯着）。
- **判据**：纯函数可注入极端值 ⇒ "超预算红 / 体积被改小也红"两条都有用例；`ACCOUNTED_DELTA` 常量计数为 **0**。
- **记账工具自己的护栏（阶段 69 返工 ①）**：`--record` 一次把预算压掉超过 **5%** 会被**拒绝**并要求
  `--force` —— 否则对着半成品 / 只跑了一部分的构建记一次账，预算就被永久压扁，
  之后完整构建必然超上界（复核实证：缩小资产后 `--record 99` 会把预算从 428195 B 塌到 46 B，
  工具照样打印 `✅`、rc=0）。`--force` 只在"确实删掉了大块体积"时用。

## 20. 鉴权分类与 `/mcp` 的 401（阶段 70 / FR-149）

### 20.1 路径分类表与路由注册各写一份 ⇒ 新端点"忘了判权限"没人知道

- **坑的形态**：`src/server/auth.ts` 用四张手写路径表（公开 / 仅会话 / 资源读 / 其余）
  判定权限，而路由注册散在 `src/server/app.ts` 调用的十个 `register*Routes` 里。两处各记一份，
  语义上"同源"全靠人记得改两边。新加一个 `/api/*` 端点、却没往表里加：
  **运行时是 fail-closed 的**（落进兜底 ⇒ 需要 write 令牌），所以不会漏权限，
  但**没人分得清**它是"故意要 write"还是"忘了声明" —— 直到某天有人以为它是只读接口。
- **做法**：分类**只有一处入口** `classifyApiRequest(method, path)`（闸门的 `onRequest` 调它），
  另有 `declaredCategory(method, path)` 回答"这个路由被某张声明表**明确**覆盖了吗"（未知 ⇒ `null`）。
  `registerAuthGate` 在注册期用 `onRoute` 收集所有 `/api/*` 路由，在 `onReady` 断言**每个都被显式声明**，
  否则服务**起不来**并点名 `METHOD /path`。于是"加端点忘了分类"从静默变成启动即红，
  不需要两处人肉同步。
- **⚠️ 兜底不许删**：`classifyApiRequest` 的最后一条仍是 **fail-closed 的 `resource_write`** ——
  机械检查只保证"必须声明"，运行时的安全兜底独立存在（声明表写漏了也不会放行只读令牌）。
- **判据**（`tests/stage70-auth-classification.test.ts`）：① 真实应用的全部 `/api/*` 路由
  `category === null` 的数量为 **0**，且声明与运行时分类**逐条一致**；② 用裸 Fastify 注册
  `GET /api/undeclared-probe` ⇒ `app.ready()` 抛 `认证分类缺失（FR-149 / AC-132 C10）：GET /api/undeclared-probe`，
  而换成 `/api/prompts`（已声明前缀）⇒ 正常就绪（证明拒绝的是"没声明"，不是"新端点"）；
  ③ 权限矩阵四类仍**逐条真发请求**实测（401 / `insufficient_scope` / `session_required` / 放行），
  不许只跑测试就宣布"没回归"。

### 20.2 `/mcp` 不在 `/api/*` 闸门里，它的 401 必须单独钉住

- **坑的形态**：`/mcp` 是**顶层路径**（FR-93），`registerAuthGate` 只拦 `/api/*` ⇒ 它**不经过**那套闸门。
  很容易误以为"认证是全局的"，于是漏掉它的鉴权，或者给它错误地加上 cookie 会话（MCP 客户端不发 cookie）。
- **做法**：`src/mcp/http.ts` **自己做 Bearer 鉴权**（复用同一套 `resolveApiToken`），
  无 token / 无效 token 都回 **401 `{"error":"unauthorized"}`** —— 与 `/api/*` 的 401 **同形**，
  客户端可以用同一套错误处理；差异只有两条，且都是刻意的：**不收 cookie 会话**（只认 Bearer）、
  **无状态**（`GET` / `DELETE /mcp` 明确 405，而不是静默 404 或假装能开会话）。
- **判据**：`POST /mcp`（无凭据）与 `GET /api/prompts`（无凭据）的响应体 `deepEqual`；
  `GET /mcp` ⇒ 405。差异写在这里，而不是散落在代码注释里。

## 21. CLI 的两条通道：为什么不是"并成一条"（阶段 70 / FR-150）

### 21.1 同一个 CLI 里两套实现，通道决策散在各命令里

- **坑的形态**：`src/server/cli.ts` 有两条完全不同的执行通道 —— 直连 SQLite 的
  `openCliDatabase()`（`migrate` / `export` / `user set-password` / `token` 的本机管理）
  与走 HTTP 的 `apiRequest()`（`get` / `render`，以及设了 `PM_API_URL` 时的 `token`）。
  改前通道决策**散在实现里**：`token()` 一处判 `api.explicit`、`get`/`render` 各自
  用 `requireApiToken()`，谁也不回答"这条命令到底该走哪条路"。加一条新命令时，
  很容易复制错那一半，或者让某条命令**两条路都碰**。
- **为什么不能真的并成一条**：三条 `local-db` 命令**没有 HTTP 等价物** ——
  `migrate`（建库）与 `user set-password`（引导口令）必须在**服务启动之前**就能跑；
  `export` 是本地备份（服务器挂着时也要能导出）；而 `token reveal` / `set-scope` 的 HTTP 面
  **刻意只允许浏览器 cookie 会话**（令牌调一律 `403 session_required`，见 §20）。
  硬并成一条就会砍掉引导与备份能力 —— 这正是 AC-132 D16 要求保留的。
- **做法**：通道由一张**显式声明表**给每条命令定死（`COMMAND_TRANSPORTS`：
  `migrate`/`user`/`export` = `local-db`，`get`/`render` = `http`，`token` = `dual`），
  **决策点只有一处** `resolveTransport(command, api)`：`local-db` / `http` 命令**忽略环境**
  （它们没有第二条路），只有 `dual` 按 `PM_API_URL` 是否显式设置定型。
  表与 `runCli` 的 `switch` 由机械检查对齐（少一条或多一条 ⇒ 测试红），
  并且 `local-db` 命令体不许出现 `apiRequest(`、`http` 命令体不许出现 `openCliDatabase(`。
- **⚠️ 已知矛盾（只记录，不改行为）**：`/api/tokens*` 自 FR-105 起是 **session-only** ⇒
  CLI 的 HTTP token 通道**事实上不可用**（`token create/list/revoke` 用令牌调都是
  `403 session_required`，退出码 1）。真正可用的是本机管理路径。本阶段按 D-68 ①
  只记录这个矛盾、不动行为（改它要么改退出码、要么放松 `/api/tokens` 的会话要求，两者都超出"结构改造"）。
- **判据**（`tests/stage70-cli-transport.test.ts`）：① 声明表的键集合 == `runCli` 的 `case` 集合；
  ② `resolveTransport` 逐条（含 `local-db`/`http` 忽略环境）；③ 机械切片证明两条通道不互串；
  ④ **真跑**六条命令（`migrate` → `ok: schema at v10`、`user set-password`、`token create/list/revoke`、
  `export`、`get`/`render` 经 HTTP）退出码与输出逐字节不变；⑤ 没有服务时 `migrate` / `export`
  仍可用（引导与备份能力在）。
