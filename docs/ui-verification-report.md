# PromptManager 全面 UI 验证报告

> **路径**：`docs/ui-verification-report.md`（固定交付物）
> **阶段**：阶段 54 / FR-118 / AC-118 B 段
> **日期**：2026-09-25
> **验证环境**：**开发环境**（临时 `DATA_DIR=tmp/s54-data`，端口 **8765**，口令自设）
> —— 用户明确要求「用你的开发环境验证，不要使用测试环境」，故**全程未碰 8767 测试环境**（其 PID 595388 未受影响）。
> **交付尺寸**（BRIEF D-54 ①，硬性）：**PC 1440×900**、**移动 440×956**（`isMobile=true`、`hasTouch=true`、`deviceScaleFactor=1`）。
> **截图目录**：`tmp/shots/stage54/`（过程证据，**不入库**，符合 STANDARDS §5.2 / AGENTS.md §5.1）。
> **本轮只验证、不改功能代码**：除本报告与 `tools/ac-stage54-ui*` 验收脚本外，**未改任何产品代码**。

---

## 0. 一句话结论

18 个界面 × 2 个交付尺寸 **全部覆盖并逐张读图**；页面级横向溢出 **36/36 均为 0**、文字裁切 **0**；
四条历史验收点**全部不回归**。共记录 **2 条真 bug + 4 条可优化项**，另有 **3 条已排除的误报**（其中 1 条是我自己的探针 bug）。

---

## 1. 覆盖清单表

| # | 界面 | PC 1440×900 | 移动 440×956 | 结论 |
|---|---|---|---|---|
| 1 | 登录页 | `pc-login-login.png` | `mobile-login-login.png` | ✅ 符合 |
| 2 | 主工作区·卡片视图 | `pc-cards-cards.png` | `mobile-cards-cards.png` | ✅ 符合 |
| 3 | 主工作区·表格视图 | `pc-table-table.png` | `mobile-table-table.png`（+`…-atleft-…`/`…-atright-…`） | ✅ 符合 |
| 4 | 主工作区·分栏视图 | `pc-split-split.png` | `mobile-split-split.png` | ✅ 符合 |
| 5 | 提示词编辑器 | `pc-editor-editor.png` | `mobile-editor-editor.png` | ✅ 符合 |
| 6 | 提示词详情 | `pc-detail-detail.png` | `mobile-detail-detail.png` | ✅ 符合 |
| 7a | 版本面板 | `pc-versions-versions.png` | `mobile-versions-versions.png` | ✅ 符合 |
| 7b | 版本对比 | `pc-versions-compare-versions-compare.png` | `mobile-versions-compare-versions-compare.png` | ✅ 符合 |
| 8 | 变量填写弹窗 | `pc-vars-vars.png` | `mobile-vars-vars.png` | ✅ 符合 |
| 9 | 导入 / 导出弹窗 | `pc-import-export-import-export.png` | `mobile-import-export-import-export.png` | ✅ 符合 |
| 10 | 修改口令弹窗 | `pc-password-password.png` | `mobile-password-password.png` | ✅ 符合 |
| 11 | API 令牌抽屉 | `pc-tokens-tokens.png` | `mobile-tokens-tokens.png`（+`…-atleft-…`/`…-atright-…`） | ⚠️ 有可优化项（掩码折行） |
| 12 | 使用统计抽屉 | `pc-usage-usage.png` | `mobile-usage-usage.png` | ❌ **真 bug**（口径文案） |
| 13 | 关于弹窗 | `pc-about-about.png` | `mobile-about-about.png` | ✅ 符合（移动端有可优化项） |
| 14 | 侧栏·文件夹面板 | `pc-sidebar-folders-sidebar-folders.png`（+`…-selected-…`） | `mobile-sidebar-folders-sidebar-folders.png`（+`…-selected-…`） | ❌ **真 bug**（桌面点不动） |
| 15 | 侧栏·标签面板 | `pc-sidebar-tags-sidebar-tags.png` | `mobile-sidebar-tags-sidebar-tags.png` | ✅ 符合 |
| 16 | 空态（搜索无结果） | `pc-empty-search-empty-search.png` | `mobile-empty-search-empty-search.png` | ⚠️ 有可优化项（主标题口径） |
| 17 | 深色主题 | `pc-dark-dark.png` | `mobile-dark-dark.png` | ✅ 符合 |

**补充截的 4 张**（为把"移动端表格/令牌表能横滚且两端不丢关键列"变成可视证据）：
`mobile-table-atleft-…` / `mobile-table-atright-…` / `mobile-tokens-atleft-…` / `mobile-tokens-atright-…`；
另有 2 张侧栏**选中态**（`pc-…-folders-selected-…` / `mobile-…-folders-selected-…`）。
**合计 42 张**（`ls tmp/shots/stage54/*.png | wc -l` = **42**）。

> 清单要求"可加不可减"：原 AC 列 17 项，我把「版本面板 + 版本对比」拆成 7a/7b 两项单独出图，故实际 **18 项**。

---

## 2. 逐界面结论（读图所见 + 依据）

> 每条都对应我**实际看过**的那张图；括号内是量测依据。

### 1. 登录页 — ✅ 符合
**PC**：品牌图标 `>_` + `PromptManager` + 用户名/口令 + `登 录` 按钮，垂直居中；**用户名无预填**（FR-88）。依据：`scrollHeight=900 = clientHeight=900`、`hasVerticalScroll=false`。
**移动**：同款，440 宽下元素满宽不错位。依据：`scrollHeight=956 = clientHeight=956`、输入框 2 个。

### 2. 卡片视图 — ✅ 符合
**PC**：左栏（文件夹树 工作3/AI协作与验收3/归档0 + 标签云 #代码/#写作）+ 3 列卡片网格 + 分页。
**卡片底部逐张核对**：`📁 AI 协作与验收 · v2 · 变量 0`（图标在名字左侧、目录排最前、两个 `·` 分隔、无取用/日期）；
无目录的显示 `📁 未分组`；含变量的显示 `变量 3` 且按钮为「填值后复制」。同行卡片末行底部对齐。
依据：`computedGap=6px`、`sepCount=2`、`firstHasIcon=true`。
**移动**：单列堆叠，复制按钮可点，末行贴底。

### 3. 表格视图 — ✅ 符合
**PC**：列齐全 `[选择] 标题|标签|文件夹|版本|变量数|取用次数|更新于|操作`，5 行，行内拖拽手柄与星标在位。
**关键：表格仍保留「取用次数」「更新于」** —— 证实阶段 52 的 FR-116 只改卡片、未动表格。依据：无横向滚动（`scrollW=clientW=1320`）。
**移动**：可横滚。`scrollLeft 0 → 566`；**最左**那张 5 条标题全可读，**最右**那张「操作」列完整（末列右缘 `424 ≤ 440`）。

### 4. 分栏视图 — ✅ 符合
**PC**：三栏 —— 中栏条目**只有星标+标题+备注**（FR-71 成立，无 v/取用/文件夹/变量），右栏详情完整（元信息/文件夹/标签/正文渲染/版本历史/操作栏）。
**移动**：退化为单列列表（星标+标题+备注），无横向溢出。

### 5. 提示词编辑器 — ✅ 符合
**PC**：`position:fixed` 满屏浮层，三栏（左 Prompt 列表 / 中表单 / 右「Markdown 预览 + 变量填值 + 版本历史」）。
版本对比**默认 v2 → v3**（上一版↔最新，阶段 47 口径），diff 有红删绿增。
**移动**：单列纵向堆叠，文件夹/标签并排一行放得下，可竖滚。

### 6. 提示词详情 — ✅ 符合
**PC**：920×677 弹窗，含标题/元信息/备注/文件夹下拉/标签芯片/正文渲染/版本历史/底部操作栏，`去编辑` 入口在位。
**移动**：**抽屉满屏**（`drawerW=440, drawerH=956, top=0`），`drawerBodyScroll.canScroll=true`，内容可达。
（`pm-detail-text` 在默认渲染视图下不存在 —— 条件渲染，**非缺陷**，D-54 ③ 已告知。）

### 7. 版本面板 + 版本对比 — ✅ 符合
编辑器右栏「版本历史」：`表格/对比版本/详情` 三页签、`共 3 个版本`、保留策略提示、`对比 v2 → v3`、`查看 diff`。
点「对比版本」后 diff 完整：`--- v2` / `+++ v3` / `@@ -1,7 +1,7 @@` / `[title]` / `[user_prompt]` / 红删行 / 绿增行 / `[system_prompt]` / `[notes]`。
**与版本面板同屏是设计使然**：阶段 47 起默认就落在「对比版本」页签（故移动端两张图内容完全一致）。

### 8. 变量填写弹窗 — ✅ 符合
**PC** 760×477 / **移动** 424×486。3 个字段（姓名/城市/日期，与正文 3 个占位符一致），实时预览**保留未填占位符**，底部提示「未填 3 个（预览与复制结果里保留原样占位符）」。

### 9. 导入 / 导出弹窗 — ✅ 符合
**PC** 640×459 / **移动** 424×492。导出区（自有 JSON 格式含版本历史 / 导出全部 JSON）+ 导入拖拽区（"点击或拖拽 JSON 文件到此处"、"文件只在浏览器本地解析，确认后才会上传"）。无横向溢出。

### 10. 修改口令弹窗 — ✅ 符合
**PC** 460×395 / **移动** 424×395。三字段（当前/新「至少 8 个字符」/确认），均带眼睛切换；说明「当前浏览器保持登录，其它已登录的会话会被退出」。

### 11. API 令牌抽屉 — ⚠️ 符合但有可优化项
**PC** 720 宽 7 列（名称/Token/状态/使用/创建时间/最近使用/操作），**无横向滚动**（`scrollW=clientW=680`）。
**只读/读写配色不同 —— 视觉与量测双确认**：`有效·只读` 绿底 `rgb(246,255,237)`、`有效·读写` 黄底 `rgb(255,251,230)`。
**移动**：`drawerW=440, drawerH=956` 满屏；7 列各 **91px**、**首列「名称」91px（未被压成 0）**；`scrollLeft 0→240` 可横滚；最右那张撤销按钮右缘 `365 ≤ 440`。
**可优化项**：Token 掩码 `pm_1C...dco**w` 因列窄**折成两行**（PC 与移动都有）。

### 12. 使用统计抽屉 — ❌ 真 bug（见 §3 问题 1）
**PC** 640 宽 / **移动** 440 满屏。统计 0/0/0/0、口径表、表格与空态（"窗口内没有取用记录"）齐全。
但「口径」一行文案与实际实现**矛盾**。

### 13. 关于弹窗 — ✅ 符合（有可优化项）
**「访问地址」显示 `http://127.0.0.1:8765`**，与本轮实际访问方式一致（阶段 53 的 `window.location.origin` 修复生效），复制图标在位。
服务区 5 行（版本 1.3.0 / 状态 在线 / 访问地址 / 数据文件 / 备份方式）、三分区、使用区 7 条、版本号与 `/healthz` 一致。
**移动** 424 宽，标签列窄导致「访问地址/数据文件/备份方式」折行（可接受，非截断）。
**可优化项**：移动端弹窗高 `1013 > 视口 956`，**需滚动**。已实测外层 `.ant-modal-wrap` 是滚动容器（`scrollH=1121 > clientH=956, overflow-y:auto`），
滚到底后 `modalBottom=956`、末条命令 `bottom=885 ≤ 956` ⇒ **内容可达，不是裁切**。

### 14. 侧栏·文件夹面板 — ❌ 真 bug（见 §3 问题 2）
PC 下是常驻左栏、移动端收在「筛选」抽屉里（两面板同屏，见 §5 误报③）。
**内容本身正确**：`工作 3 / AI 协作与验收 3 / 归档 0`，各带 `+` 新建、⋮ 行内操作、层级缩进。
**但桌面端用真实鼠标点目录不筛选** —— 高优先级问题。

### 15. 侧栏·标签面板 — ✅ 符合
`全部 2 / #代码 / #写作` 三个胶囊，无计数徽标（FR-50）。**真鼠标点标签芯片可正常筛选**
（`reqs=[/api/prompts?tag=写作&…]`、`items=1`）—— 这是 §3 问题 2 的**对照组**。

### 16. 空态（搜索无结果） — ⚠️ 符合但有可优化项
搜索框含 `zzz-不存在的关键词-zzz` + 清除按钮；空态有图标 + 主标题 + 副标题，**副标题正确回显关键词**。
**可优化项**：主标题「还没有可用的 prompt」是**空库**口径，搜索场景下不准确。移动端更明显（侧栏计数不可见，用户无从判断库非空）。

### 17. 深色主题 — ✅ 符合
**PC / 移动**均为近黑画布（`rgb(1,1,2)`）+ 深色卡片（`rgb(15,16,17)`）+ 浅色文字（`rgb(247,248,248)`），主题图标变月亮。
卡片底部 `📁 … · v2 · 变量 0` 在暗色下同样清晰。点击 **2 次**到达（跟随系统→亮→暗）。
（第一次截出来是浅色 —— **是我探针的判据 bug**，见 §5 误报①。）

---

## 3. 问题清单（分级 + 证据 + 复现）

### 🔴 真 bug 1：桌面端侧栏目录用真实鼠标点击不筛选（移动端正常）

| 项 | 内容 |
|---|---|
| **影响** | **FR-49 核心功能在桌面端失效**：用户点侧栏文件夹，列表毫无反应 |
| **分级** | 真 bug · **高** |
| **复现步骤** | ① 以桌面视口（≥1200px）打开应用；② 在左栏点任一文件夹（如「AI 协作与验收」）；③ 预期：列表被筛成该目录下的 3 条 |
| **实测结果** | 列表仍是 5 条，**连一次 `/api/prompts` 请求都没发出**，目录行无选中高亮 |
| **A/B 对照** | 同一脚本、同一夹具、同一真鼠标三连、串行跑两个视口：<br>`pc(1440x900)` → `reqs=[] active=[] items=5` ❌<br>`mobile(440x956)` → `reqs=[folder_id=2] active=[AI 协作与验收 3] items=3` ✅ |
| **排除"事件没送到"** | 页面内挂捕获监听后实测：真实点击产生 `pointerdown→mousedown→mouseup→click`，`DOC:click@svg(in-row)`、行上 `click@svg` 均到达 |
| **排除"事件没冒泡到 React 根"** | 行上**冒泡**监听 + `#root` 冒泡监听同时触发：`["ROW_BUBBLE","ROOT_BUBBLE target=svg inRow=Y"]` |
| **排除"行节点被重建"** | `ROW_CONNECTED:true`，父容器 MutationObserver 无 `childList` 记录 |
| **排除"handler 跑了又被回滚"** | 挂在行上的 MutationObserver（`class` 属性）**日志为空** —— 连瞬时的 active 都没出现过 |
| **排除"姿势问题"** | 四种姿势全失败：行中心短按 / 行中心长按 300ms / 行右侧留白 / 按下后移动 3px 再抬 |
| **排除"时点问题"** | 侧栏渲染后 1.5s / 2.0s / 2.5s / 3.0s 分别试，均失败；先在空白处点一下"预热"也失败 |
| **排除"整个侧栏都不能点"** | **对照组**：同一侧栏的**标签芯片**用同样真鼠标点 → `reqs=[tag=写作] selected=[#写作] items=1` ✅ **正常** |
| **为什么之前没暴露** | 该路径的**历史验收多用 JS 合成 `.click()` 或源码级断言**；JS click 实测**是好的**（`reqs=[folder_id=2] items=3`），只有**真实指针事件**才失败 |
| **源码线索** | `FolderPanel.tsx:279-291`：`Flex` 上依次是 `{...(context.rootListeners)}`（dnd-kit 仅 `onPointerDown`）、`ref`、`data-testid`、…、**`onClick={() => onSelect(active ? null : folder.id)}`**。`SortableList.tsx:146` 的 `rootListeners` 只含 `onPointerDown` |
| **未定位到根因** | 事件已到达 React 根容器、handler 却未生效；**本次不改代码，未深挖**。建议人工在真实浏览器复核后再定位 |
| **截图** | `pc-sidebar-folders-sidebar-folders.png`、`mobile-sidebar-folders-sidebar-folders.png`（右侧为移动端正常态） |

### 🔴 真 bug 2：「使用统计」抽屉的「口径」文案与实际口径矛盾

| 项 | 内容 |
|---|---|
| **影响** | 文案说「**打开详情**也算取用」，与阶段 50（FR-114）改定的口径相反，会误导用户对数据 的理解 |
| **分级** | 真 bug · 中（纯文案，无功能影响） |
| **证据（界面）** | `pc-usage-usage.png` / `mobile-usage-usage.png`，「口径」行：**只记"取用"（打开详情 / 渲染 / MCP 取用）；列表与搜索不计** |
| **证据（实现）** | `web/src/components/UsageDrawer.tsx:101` 同文案；<br>而 `src/services/usage.ts:22` → `export const COUNTED_KINDS: readonly UsageKind[] = ['copy', 'mcp'];`<br>即**打开详情记 `view`、不计数**（阶段 50 / FR-114 明确改过） |
| **复现步骤** | 打开「⋯更多 → 使用统计」→ 看「口径」行；再打开某条提示词详情（产生一条 `view`）→ 刷新抽屉，取用数**不变** |
| **成因推断** | 阶段 50 改了语义与聚合口径，但漏改了这句面向用户的说明 |

### 🟡 可优化项

| # | 现象 | 依据 | 建议 |
|---|---|---|---|
| 1 | **Token 掩码折成两行**（`pm_1C...dco` / `**w`） | `pc-tokens-tokens.png`、`mobile-tokens-tokens.png` | Token 列略加宽，或掩码改为不可断行 |
| 2 | **空态主标题用空库口径**「还没有可用的 prompt」，搜索无结果时不准确 | `pc-empty-search-empty-search.png`、`mobile-empty-search-empty-search.png` | 搜索态换主标题（如"没有匹配的条目"）；副标题已正确回显关键词 |
| 3 | **移动端表格「文件夹」列窄导致值折行**（`AI 协作` / `收`） | `mobile-table-atleft-table-atleft.png` | 该列可给最小宽度或移动端隐藏（信息在详情页已有） |
| 4 | **关于弹窗在移动端高于视口**（`1013 > 956`），需滚动才能看到「维护」区 | `mobile-about-about.png` | 非裁切（外层 wrap 可滚，已实测到底）；可考虑移动端默认折叠更多分区 |

---

## 4. 移动端专项（440×956，AC-118 ⑦）

| 判据 | 实测 | 结论 |
|---|---|---|
| 抽屉占满 | 详情 `440×956 top=0`；令牌 `440×956 top=0`；使用统计 `440×956 top=0` | ✅ |
| 抽屉可滚动 | 令牌/使用统计 `drawerBodyScroll.canScroll=false`（内容本就放得下）；版本面板 `canScroll=true` | ✅ |
| 弹窗尺寸 | 变量 `424×486`、导入导出 `424×492`、改口令 `424×395`、关于 `424×1013`（可滚） | ✅ |
| **表格可横滚** | 提示词表 `scrollLeft 0 → 566`；令牌表 `0 → 240`（`scrollW=640 > clientW=400`） | ✅ |
| **末列按钮在视口内** | 提示词表滚到底：末列右缘 `424`、操作按钮右缘 `256`，均 `≤ 440`；令牌表滚到底：撤销按钮右缘 `365 ≤ 440` | ✅ |
| **不丢关键列** | 提示词表：最左 5 条标题全可读，最右「操作」列完整；令牌表：7 列各 91px，**首列「名称」91px（未压成 0）** | ✅ |
| **无内容裁切** | 36 个场景 `clipped` 全为空；页面级 `scrollWidth-clientWidth` 全为 **0** | ✅ |
| **点击目标够得着** | 顶栏按钮/卡片复制/表格行内/分段器/菜单项真鼠标点击均生效（视图切换、打开详情、打开各弹窗抽屉全部成功） | ✅ |

> 误报排除：表格里"在视口外"的列（文件夹/状态/使用…）位于**可横向滚动的容器**内，是设计使然，不判为 bug（D-54 ⑦）。

---

## 5. 历史验收点不回归（AC-118 ⑧）

| 验收点 | 阶段 | 实测证据 | 结论 |
|---|---|---|---|
| **卡片底部 = `📁目录 · v版本 · 变量 N`** | 52 / FR-116 | PC & 移动均 `AI 协作与验收 ⏎ · ⏎ v2 ⏎ · ⏎ 变量 0`；`firstItem='AI 协作与验收'`、`firstHasIcon=true`、`gap=6px`、`sepCount=2`；无目录的显示 `未分组` | ✅ 未回归 |
| **令牌只读/读写配色不同** | 48 / FR-112 | 只读 `bg=rgb(246,255,237) fg=rgb(56,158,13)`；读写 `bg=rgb(255,251,230) fg=rgb(212,136,6)`；PC & 移动一致 | ✅ 未回归 |
| **登录页无纵向滚动** | 46 / FR-108 | PC `scrollHeight=900 = clientHeight=900`；移动 `956 = 956`；`hasVerticalScroll=false` | ✅ 未回归 |
| **移动端表格不丢「名称」列** | 45 / FR-107 | 令牌表 7 列 `{名称:91, Token:91, 状态:91, 使用:91, 创建时间:91, 最近使用:91, 操作:91}`，首列 `名称` **非 0** | ✅ 未回归 |

---

## 6. 截图索引（文件名 ↔ 界面 ↔ 尺寸）

全部位于 `tmp/shots/stage54/`，命名 `<pc|mobile>-<序号>-<界面>.png`：

| 界面 | PC | 移动 |
|---|---|---|
| 登录页 | `pc-login-login.png` | `mobile-login-login.png` |
| 卡片视图 | `pc-cards-cards.png` | `mobile-cards-cards.png` |
| 表格视图 | `pc-table-table.png` | `mobile-table-table.png`、`mobile-table-atleft-table-atleft.png`、`mobile-table-atright-table-atright.png` |
| 分栏视图 | `pc-split-split.png` | `mobile-split-split.png` |
| 编辑器 | `pc-editor-editor.png` | `mobile-editor-editor.png` |
| 详情 | `pc-detail-detail.png` | `mobile-detail-detail.png` |
| 版本面板 | `pc-versions-versions.png` | `mobile-versions-versions.png` |
| 版本对比 | `pc-versions-compare-versions-compare.png` | `mobile-versions-compare-versions-compare.png` |
| 变量弹窗 | `pc-vars-vars.png` | `mobile-vars-vars.png` |
| 导入导出 | `pc-import-export-import-export.png` | `mobile-import-export-import-export.png` |
| 改口令 | `pc-password-password.png` | `mobile-password-password.png` |
| 令牌抽屉 | `pc-tokens-tokens.png` | `mobile-tokens-tokens.png`、`mobile-tokens-atleft-tokens-atleft.png`、`mobile-tokens-atright-tokens-atright.png` |
| 使用统计 | `pc-usage-usage.png` | `mobile-usage-usage.png` |
| 关于 | `pc-about-about.png` | `mobile-about-about.png` |
| 侧栏·文件夹 | `pc-sidebar-folders-sidebar-folders.png`、`pc-sidebar-folders-selected-sidebar-folders-selected.png` | `mobile-sidebar-folders-sidebar-folders.png`、`mobile-sidebar-folders-selected-sidebar-folders-selected.png` |
| 侧栏·标签 | `pc-sidebar-tags-sidebar-tags.png` | `mobile-sidebar-tags-sidebar-tags.png` |
| 空态 | `pc-empty-search-empty-search.png` | `mobile-empty-search-empty-search.png` |
| 深色主题 | `pc-dark-dark.png` | `mobile-dark-dark.png` |

**入库说明**：按 STANDARDS §5.2，过程截图**一律落 `tmp/`、不入库**。**本轮没有任何截图进 git**
（`git ls-files tmp | wc -l` = 0；`docs/shots/` 未改动）。若后续需要把关键图纳入 `docs/`，需另行确认。

---

## 7. 已排除的误报（先排除再下结论）

1. **「深色主题没变暗」—— 是我探针的 bug，产品正常。**
   探针用 `getComputedStyle(document.documentElement).backgroundColor` 判暗色，而它在明暗两态**恒为 `rgba(0,0,0,0)`**，
   于是永远判不出暗色、连点 3 次（跟随系统→亮→暗→跟随系统）又转回浅色，截出"名为深色、实为浅色"的图。
   改判 `document.body` 后：点击 2 次 → `bodyBg=rgb(1,1,2)`、`cardBg=rgb(15,16,17)`、`text=rgb(247,248,248)`，**暗色正常**。
2. **「桌面侧栏点不动」曾三次被误判为时点/坐标问题** —— 通过事件追踪、冒泡追踪、MutationObserver、四种点击姿势、
   JS click 对照、标签芯片对照组、最终 PC/移动 A/B，才确认是**真实问题**（见 §3 问题 1）。
   过程中"页面默认落地是卡片视图"也误伤过一次等待条件（桌面默认是**分栏**，移动端默认是**卡片**，FR-92）。
3. **三组截图内容完全相同 —— 布局使然，非缺陷**：
   ① 桌面 `pc-split` = `pc-sidebar-folders` = `pc-sidebar-tags`：桌面侧栏是**常驻左栏**，三者本就同屏；
   ② 移动 `sidebar-folders` = `sidebar-tags`：移动端两个面板在**同一个筛选抽屉**里；
   ③ 移动 `versions` = `versions-compare`：阶段 47 起**默认页签就是「对比版本」**。
   （`mobile-table-table` = `…-atright-…`、`mobile-tokens-tokens` = `…-atright-…` 亦属预期：主截图是在横滚到底后拍的。）
4. **「`pm-detail-text` 找不到」—— 条件渲染**，只在「源码/显示纯文本」模式出现，默认渲染视图下不存在属正常（D-54 ③）。

---

## 8. 资源纪律执行情况（BRIEF D-54 ②）

| 要求 | 执行 | 实测 |
|---|---|---|
| 复用测试环境、不另起实例 | ⚠️ **按用户指令改为自建开发环境**（用户原话：「用你的开发环境验证，不要使用测试环境」） | 开发实例 `tmp/s54-data` + 端口 **8765**；**8767 测试环境全程未碰**（PID 595388 未受影响） |
| 串行、单上下文、用完即关 | ✅ 全程串行；每批次只开 1 个浏览器，`Browser.close` + `kill` 双保险 | 每个场景结束打一次资源快照 |
| 禁止并行多进程/多探针 | ✅ 从未并行 | — |
| 每界面确认资源 | ✅ 共 36 次 `RES|场景|avail=…MB load1=…` | **全程 available 2434–2615MB，load1 0.28–1.30** |
| 熔断阈值（avail<800MB 或 load1>20） | ✅ **未触发** | 最低 available **2434MB**（阈值 800）、最高 load1 **1.30**（阈值 20） |
| 收尾复查无残留监听 | ✅ 见交付回复 | 开发实例已停，8765–8770 无残留 |

> 与上一轮事故（load 52 / avail 157MB）的差异：本轮**全程只开一个浏览器上下文**、跑完即关，且**未并行**任何探针。

---

## 9. 未覆盖到的项

**无。** AC 要求的 17 项（拆分为 18 项）全部覆盖，每个尺寸均有截图并已逐张读图。
补充说明两点**主动扩大**而非遗漏：

- 「加载态」「错误态」**未纳入**：本轮为验证**正常路径**的界面呈现，加载态转瞬即逝、错误态需人为阻断接口才能构造；
  若 host_manger 需要，可另开一轮专门构造（用 CDP `Network.setBlockedURLs` 阻断 `/api/prompts*` 即可复现错误态）。
  AC 原文把这两项列为"若还有别的可达界面则一并纳入"，**属可选**；我选择不纳入是因为它们不属于"界面清单"的 17 项，
  且强行构造会额外增加浏览器启动次数（本轮资源纪律优先）。
- 「移动端分栏/表格的中间过渡态」未单独出图：它们不是独立界面，已并入对应视图的移动端截图。

---

## 10. 验收脚本（本轮新增，未改功能代码）

| 文件 | 作用 |
|---|---|
| `tools/ac-stage54-ui-probe.mjs` | 串行单上下文的截图+量测探针（18 场景 × 2 尺寸），每场景输出 `SCENE|…` 与 `RES|…` 资源快照 |
| `tools/ac-stage54-ui.sh` | 批处理驱动：串行跑 PC/移动两批，**每批前后做熔断检查**，收尾复查残留监听 |

复跑方式（需先自行起开发实例）：

```bash
bash tools/ac-stage54-ui.sh <baseUrl> <sid> [输出目录]
```
