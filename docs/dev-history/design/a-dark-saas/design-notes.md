# 设计说明 · 方向 A｜dark-saas（Linear 式深色 SaaS）

> 阶段 10A 打样稿。**不是产品代码**：只描述方向与决策，落地在阶段 10B（用户挑选后）。
> 依据技能：`frontend-design`（定方向/排版/避免模板俗套）+ `design-system`（三层令牌）+ `dark-saas`（风格规范）+ `web-artifact-designer`（自包含稿与质量清单）。
> 设计稿：`mockup.html`（自包含、零外链）｜截图：`shots/`（5 张）

## 1. 一句话方向 + 为什么适合这个产品

**「工程师的夜间操作台」**：近黑画布 + 逐级提亮的炭黑表面 + **唯一一个**薰衣草蓝强调色，
信息密度按"技术文档"而不是"营销页"来配。

为什么适合 promptmanager：用户是开发者，prompt 库是**长时间盯着的工具**（写、改、翻版本、比对 diff）。
深色近黑 + 表面分层能在长时间使用下减少亮度疲劳；单一强调色让"可交互"这件事永远无歧义；
等宽字体承载 id/版本/日期/取用次数，让"数据感"和"正文感"分开。这个方向不是"换个深色主题"，
而是把**层级从"边框+阴影"改成"表面亮度"**，因此在高密度下仍然干净。

## 2. 色彩（亮 / 暗两套，均可直接落到 antd token）

### 2.1 暗色（本方向的规范形态）

| 语义 | 值 | 用途 |
| --- | --- | --- |
| canvas | `#010102` | 页面底（近黑**不是纯黑**：纯黑会让面板发闷） |
| surface-1 | `#0f1011` | 卡片 / 面板 |
| surface-2 | `#141516` | 表头、分组、浮层 |
| surface-3 | `#18191a` | hover |
| surface-selected | `#191a1b` + 左侧 2px 强调条 | 选中行 |
| hairline | `#23252a` | 1px 分隔（表格行、区块） |
| hairline-strong | `#34343a` | 输入框/弹窗描边 |
| ink | `#f7f8f8` | 主文字 |
| ink-muted | `#d0d6e0` | 次级文字（表格单元格） |
| ink-subtle | `#8a8f98` | 说明、列标题 |
| ink-tertiary | `#62666d` | 占位符 |
| primary | `#5e6ad2` | **唯一强调色**：主按钮、聚焦环、选中条、链接、收藏星 |
| primary-hover | `#828fff` | 主按钮 hover |
| success / danger | `#27a644` / `#e5484d` | 语义色（只在语义位置：missing 0 / 删除） |

### 2.2 亮色（对称反转，不是"另一套设计"）

| 语义 | 值 |
| --- | --- |
| canvas / surface-1 | `#ffffff` / `#ffffff` |
| rail / topbar | `#fbfbfd` |
| surface-2 / surface-3 | `#f6f7f9` / `#eef0f3` |
| surface-selected | `#eceffb`（主色的极淡同族） |
| hairline / hairline-strong | `#e4e6ea` / `#d4d7dd` |
| ink / ink-muted / ink-subtle | `#14161a` / `#3c4046` / `#6b7280` |
| primary / primary-hover | `#5e6ad2` / `#4b57c4` |
| success / danger | `#1f8f3a` / `#d93a3f` |

**强调色纪律**：全站只有 `primary` 一个高饱和色。收藏星、选中条、聚焦环、主按钮都用它；
`success/danger` 只在语义位置出现，不做装饰。**没有第二个强调色**（这是本方向最容易被做坏的地方）。

## 3. 字体与字号阶梯

- **UI 正文字体**：`Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", "Droid Sans Fallback", sans-serif`
- **数据/代码/编号**：`ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace`
- 标题字距：**负字距**（越大越负），正文 0；中文不加字距。

| 角色 | 字号 / 行高 / 字重 / 字距 | 用在哪 |
| --- | --- | --- |
| 页面标题 h1 | 20 / 1.3 / 600 / -0.02em | 「Prompt 库」 |
| 编辑器标题 | 17 / 1.4 / 600 / -0.015em | 「会话交接模板 #014」 |
| 正文/表单 | 13 / 1.55 / 400 / 0 | 表格单元格、textarea |
| 表头/眉标 | 11 / 1.4 / 500 / **+0.10em + uppercase** | 「标题 标签 文件夹 …」 |
| 数据（mono） | 11–13 / 1.5 / 400 tabular-nums | id、版本、日期、取用次数 |
| 统计数字 | 17 / 1.2 / 500 mono | 09 / 03 / v3 / 0.3ms |

**密度**：行高 38px、控件高 32px、页面 padding 24px —— 偏"技术文档"的紧凑节奏（这是本方向的性格，不要拉松）。

## 4. 间距节奏

一套 4px 基数的阶梯：`4 / 8 / 12 / 16 / 20 / 24 / 32 / 48`。
- 页面内边距 24；面板内边距 16；控件间距 8；表单字段间 14（视觉节奏 ≈ 12/16 交替）；
- 区块之间 20–24；统计条与表格之间 16；
- 对齐：所有内容左对齐到页面左基准线，右侧操作区右对齐到同一基线（截图里可验证：页头/工具条/表格右边缘对齐）。

## 5. 圆角 / 描边 / 阴影

- 圆角：控件 8、面板/弹窗 12、chip 4、徽标 4（**最大 12，不用大圆角卡片** —— dark-saas 明确禁止 >16）。
- 描边：所有分隔用 **1px hairline**；不用粗边框、不用彩色边框（危险按钮除外）。
- 阴影：**几乎不用**（`0 1px 2px` 级别）。层级靠表面色，弹窗才用 `0 12px 32px`。
- 纹理/渐变：**无**（渐变是 dark-saas 的禁用项）。

## 6. 信息层级与重点（列表与编辑器是主战场）

- **列表页**：唯一焦点是**表格行**——标题用 13px/500 的 ink（不是蓝色链接），前面挂 mono 的 `#014` 序号与收藏星，
  选中行有左侧 2px 强调条（像代码编辑器的高亮行）。筛选控件全部"低对比"（灰描边胶囊），
  让视觉重心落在数据上；统计条只做"一眼扫过"的 mono 数字。
- **编辑器**：把现状"**切 tab**"改成"**常驻检查器列**"——左边是四字段表单（主战场），右边一列同时显示
  版本历史（含 diff）/ 变量填值 / Markdown 预览。理由：改 prompt 时最频繁的动作是"看着 diff 调文字"，
  切 tab 会打断这个循环。若用户在 10B 更想保留 tab，可退回 tab 形式，视觉语言不受影响。
- 层级规则：一屏只有**一个**主按钮（保存 / 新建），其余一律次级（描边）。

## 7. 动效（克制到什么程度）

只有 `background / border-color / color` 的 **120ms** 过渡（hover/focus）。**没有**位移、缩放、渐变扫光、页面入场动画。
理由：这是每天用几十次的工具，动效只服务"我点到哪一行了"，不服务"好看"。已实现 `prefers-reduced-motion` 全关。

## 8. 与现状的差异点（现状 = 只用 `theme.algorithm`、零 token 定制、纯 antd 默认外观）

| 维度 | 现状（阶段 8 交付） | 方向 A |
| --- | --- | --- |
| 主题 | 只切 `defaultAlgorithm`/`darkAlgorithm`，token 全默认 | 自定义 **表面色阶**（canvas→surface-3）+ 单一强调色 + 自定义 hairline |
| 强调色 | antd 默认蓝 `#1677ff` | `#5e6ad2` 薰衣草蓝（唯一强调色，含收藏/选中/焦点） |
| 层级 | 靠卡片阴影与默认边框 | 靠**表面亮度** + 1px hairline；阴影几乎不用 |
| 数据表达 | 数字/日期与正文同字体 | id/版本/日期/次数走 **mono + tabular-nums** |
| 列表行 | 默认 39px 行、hover 变灰 | 38px 行 + 选中左强调条 + hover 表面提亮 + 行内操作 hover 才出现 |
| 编辑器 | 抽屉 + 四个 Tab（切来切去） | 表单 + **常驻检查器列**（版本/变量/预览同屏） |
| 顶栏 | 深色 Header（阶段 8 的妥协） | 与画布同族的表面色 + hairline，操作收进"更多" |

## 9. 落地到 antd 的注意点（详见 `tokens.md`）

- 表面色阶**必须**显式覆盖 `colorBgLayout / colorBgContainer / colorBgElevated / colorFillQuaternary`，
  因为 antd 的暗色算法给的是它自己的灰阶，不是本方向的"炭黑阶"。
- `colorPrimary` 改成 `#5e6ad2` 后，`colorPrimaryHover/Active`、`colorInfo`、`colorLink`、`controlOutline` 要一起改，
  否则 hover/焦点环会回落到 antd 蓝。
- 表格：`Table.headerBg`、`rowHoverBg`、`borderColor`、`cellPaddingBlock` 四个组件 token 决定 80% 的观感。
- `fontFamily` 里的 `Inter` 在本机/离线环境不存在时会回落到系统栈（**不许引 CDN 字体**），因此字号字距要按"无 Inter"也能成立来配。

## 10. 已识别的风险 / 偏差（如实记录）

1. **亮色是"推导形态"**：dark-saas 的规范以暗色为准（技能也要求"亮色按同规范对称实现"）。亮色截图的观感更像"克制的灰白工具"，不如暗色有性格——这是方向本身的性质，不是缺陷，但用户若主要用亮色要知情。
2. **强调色只有一处**意味着"分类/标签"不能用彩色区分（截图里标签是灰描边 chip）。若用户希望标签有颜色，需要引入一组**低饱和**标签色板并明确"这不违反单一强调色"（暗色下低饱和色易脏，10B 需实测）。
3. **密度偏高**：13px 正文 + 38px 行在 1280 下信息量大；对 27 寸以下屏幕阅读负担略高于方向 B。10B 可把正文提到 13.5–14px（token 一处改）。
4. 本机没有 Inter/JetBrains Mono，截图里的西文是系统回退字形（DejaVu 一类）；**真实观感以装了字体的机器为准**，而中文字形三方向都一样（Droid Sans Fallback）。

## 11. 截图清单（`shots/`，1280×800 / 390×844，亮暗随系统）

| 文件 | 尺寸 | 内容 |
| --- | --- | --- |
| `list-light.png` | 1280×800 | 列表页（亮） |
| `list-dark.png` | 1280×800 | 列表页（暗，**本方向的规范形态**） |
| `editor-light.png` | 1280×800 | 编辑器 + 检查器列（亮） |
| `mobile-list.png` | 390×844 | 列表页（手机，亮） |
| `import-confirm.png` | 1280×800 | 导入 replace 二次确认（FR-11b 文案逐字保留） |
