# 令牌草案 · 方向 A｜dark-saas

> 阶段 10A 打样。**三层令牌**（Primitive → Semantic → Component），按 `design-system` 技能的结构，
> 但**落地目标只有一个**：阶段 10B 直接翻译成 antd `ConfigProvider` 的 `theme.token` / `theme.components`。
> **不引入第二套 CSS 框架/样式体系**；少量自定义 CSS 只用在 antd token 表达不了的地方（见 §6）。
> 值是 `mockup.html` 里实际使用的那一套（不是纸面设计）。

## 0. 映射原则（先看这个）

1. **Primitive 不进 `ConfigProvider`**：它只是"给语义层取值的原料"，实现时可省成注释或 TS 常量。
2. **Semantic = `theme.token`**：antd 的 seed/map token 名与原语的对应关系逐条写在 §2 的"antd token"列。
3. **Component = `theme.components`**：组件级覆盖写在 §3，**只覆盖观感差异大的组件**（Table/Card/Button/Input/Tabs/Drawer/Tag/Modal）。
4. **亮/暗**：用 `theme.algorithm = darkAlgorithm`（跟随系统）**加**本文件 §2.3 的显式覆盖；
   仅切 algorithm 不够——antd 的暗色灰阶不是本方向的炭黑阶。
5. 所有值**必须来自本表**，组件里不许写裸色值（`design-system` 的硬要求）。

---

## 1. L1 · Primitive（原始值，无语义）

| 令牌 | 值 | 令牌 | 值 |
| --- | --- | --- | --- |
| `--p-void` | `#010102` | `--p-snow-50` | `#f7f8f8` |
| `--p-carbon-900` | `#0b0c0d` | `--p-snow-200` | `#d0d6e0` |
| `--p-carbon-800` | `#0f1011` | `--p-snow-400` | `#8a8f98` |
| `--p-carbon-700` | `#141516` | `--p-snow-600` | `#62666d` |
| `--p-carbon-600` | `#18191a` | `--p-indigo-500` | `#5e6ad2` |
| `--p-carbon-500` | `#191a1b` | `--p-indigo-400` | `#828fff` |
| `--p-carbon-400` | `#23252a` | `--p-green-400` / `--p-green-500` | `#27a644` / `#1f8f3a` |
| `--p-carbon-300` | `#34343a` | `--p-red-400` / `--p-red-500` | `#e5484d` / `#d93a3f` |
| `--p-neutral-0/50/100/200/300` | `#ffffff` `#f6f7f9` `#eef0f3` `#e4e6ea` `#d4d7dd` | `--p-neutral-500/700/900/950` | `#6b7280` `#3c4046` `#14161a` `#0b0c0f` |
| 间距 `--p-space-1..12` | 4 / 8 / 12 / 16 / 20 / 24 / 32 / 48 | 圆角 `--p-radius-xs/sm/md/lg` | 4 / 6 / 8 / 12 |
| 动效 `--p-dur-fast` / `--p-dur-base` | 120ms / 180ms | 字体 | 见 §4 |

## 2. L2 · Semantic（= antd `theme.token`）

### 2.1 表面与文字（暗色为规范形态）

| 语义令牌 | 暗色值 | 亮色值 | 对应 antd token |
| --- | --- | --- | --- |
| `--canvas` | `#010102` | `#ffffff` | `colorBgLayout` |
| `--surface-1` | `#0f1011` | `#ffffff` | `colorBgContainer` |
| `--surface-2` | `#141516` | `#f6f7f9` | `colorFillQuaternary` / `colorBgElevated`（弹窗） |
| `--surface-3` | `#18191a` | `#eef0f3` | `controlItemBgHover` / `colorFillTertiary` |
| `--surface-selected` | `#191a1b` | `#eceffb` | `controlItemBgActive` |
| `--hairline` | `#23252a` | `#e4e6ea` | `colorBorderSecondary` |
| `--hairline-strong` | `#34343a` | `#d4d7dd` | `colorBorder` |
| `--ink` | `#f7f8f8` | `#14161a` | `colorText` |
| `--ink-muted` | `#d0d6e0` | `#3c4046` | `colorTextSecondary` |
| `--ink-subtle` | `#8a8f98` | `#6b7280` | `colorTextTertiary` |
| `--ink-tertiary` | `#62666d` | `#9aa1ab` | `colorTextQuaternary`（占位符） |

### 2.2 强调与语义色

| 语义令牌 | 暗色 | 亮色 | 对应 antd token |
| --- | --- | --- | --- |
| `--primary` | `#5e6ad2` | `#5e6ad2` | `colorPrimary`、`colorInfo`、`colorLink` |
| `--primary-hover` | `#828fff` | `#4b57c4` | `colorPrimaryHover` |
| （按下态） | `#4b57c4` | `#3f4bb0` | `colorPrimaryActive` |
| （聚焦环） | `primary @40%` | 同 | `controlOutline`（+ `controlOutlineWidth: 2`） |
| `--success` | `#27a644` | `#1f8f3a` | `colorSuccess` |
| `--danger` | `#e5484d` | `#d93a3f` | `colorError`（+ `colorErrorHover/Active`） |
| `--warn` | `#f2c14e` | `#b7791f` | `colorWarning` |

> ⚠️ 只改 `colorPrimary` 不改 `colorPrimaryHover/Active`/`colorInfo`/`colorLink` 是常见错误：
> hover 与焦点环会回落到 antd 默认蓝，破坏"唯一强调色"。

### 2.3 仅切 algorithm 不够，需要显式覆盖的 token

antd `darkAlgorithm` 给的是它自己的灰阶（`#141414` 系），与本方向的炭黑阶不同，**必须显式覆盖**：

```ts
// 10B 参考写法（值全部取自本表）
theme={{
  algorithm: prefersDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
  token: {
    colorBgLayout: dark ? '#010102' : '#ffffff',
    colorBgContainer: dark ? '#0f1011' : '#ffffff',
    colorBgElevated: dark ? '#141516' : '#ffffff',
    colorFillQuaternary: dark ? '#141516' : '#f6f7f9',
    colorFillTertiary: dark ? '#18191a' : '#eef0f3',
    controlItemBgActive: dark ? '#191a1b' : '#eceffb',
    colorBorderSecondary: dark ? '#23252a' : '#e4e6ea',
    colorBorder: dark ? '#34343a' : '#d4d7dd',
    colorText: dark ? '#f7f8f8' : '#14161a',
    colorTextSecondary: dark ? '#d0d6e0' : '#3c4046',
    colorTextTertiary: dark ? '#8a8f98' : '#6b7280',
    colorTextQuaternary: dark ? '#62666d' : '#9aa1ab',
    colorPrimary: '#5e6ad2', colorInfo: '#5e6ad2', colorLink: '#5e6ad2',
    colorPrimaryHover: dark ? '#828fff' : '#4b57c4',
    colorPrimaryActive: dark ? '#4b57c4' : '#3f4bb0',
    colorSuccess: dark ? '#27a644' : '#1f8f3a',
    colorError: dark ? '#e5484d' : '#d93a3f',
    borderRadius: 8, borderRadiusLG: 12, borderRadiusSM: 6, borderRadiusXS: 4,
    controlHeight: 32, controlHeightSM: 26, controlHeightLG: 36,
    fontSize: 13, fontSizeSM: 11, fontSizeLG: 15, fontSizeHeading4: 17, fontSizeHeading3: 20,
    fontFamily: '…见 §4…',
    fontFamilyCode: '…mono 栈…',
    lineWidth: 1, controlOutlineWidth: 2,
    motionDurationFast: '0.12s', motionDurationMid: '0.18s',
    boxShadow: dark ? '0 1px 2px rgba(0,0,0,.5)' : '0 1px 2px rgba(16,24,40,.06)',
    boxShadowSecondary: dark ? '0 12px 32px rgba(0,0,0,.55)' : '0 8px 24px rgba(16,24,40,.10)',
    wireframe: false,
  },
}}
```

## 3. L3 · Component（= antd `theme.components`）

```ts
components: {
  Layout:  { headerBg: '<surface-2>', headerHeight: 52, headerPadding: '0 16px', bodyBg: '<canvas>', siderBg: '<surface-2>' },
  Card:    { colorBgContainer: '<surface-1>', borderRadiusLG: 12, paddingLG: 16, headerBg: 'transparent', boxShadowTertiary: 'none' },
  Table:   { headerBg: '<surface-2>', headerColor: '<ink-subtle>', headerSplitColor: 'transparent',
             borderColor: '<hairline>', rowHoverBg: '<surface-2>', cellPaddingBlock: 8, cellPaddingInline: 12,
             rowSelectedBg: '<surface-selected>', rowSelectedHoverBg: '<surface-3>', fontSize: 13 },
  Button:  { controlHeight: 32, fontWeight: 500, primaryShadow: 'none', defaultShadow: 'none', dangerShadow: 'none',
             defaultBg: 'transparent', defaultColor: '<ink-muted>', defaultBorderColor: '<hairline>' },
  Input:   { colorBgContainer: '<surface-1>', activeBorderColor: '<primary>', hoverBorderColor: '<hairline-strong>',
             activeShadow: '0 0 0 2px <primary@40%>', paddingBlock: 5, paddingInline: 10 },
  Select:  { optionSelectedBg: '<surface-selected>', optionActiveBg: '<surface-2>' },
  Tabs:    { inkBarColor: '<primary>', itemColor: '<ink-subtle>', itemSelectedColor: '<ink>', horizontalItemGutter: 8 },
  Drawer:  { colorBgElevated: '<surface-1>', paddingLG: 20 },
  Modal:   { contentBg: '<surface-1>', headerBg: '<surface-1>', titleFontSize: 16 },
  Tag:     { defaultBg: '<primary@14%>', defaultColor: '<primary>', borderRadiusSM: 4 },
  Tooltip: { colorBgSpotlight: '<surface-3>', colorTextLightSolid: '<ink>' },
  Segmented: { itemSelectedBg: '<surface-3>', itemColor: '<ink-subtle>', itemSelectedColor: '<ink>', trackBg: '<surface-2>' },
  Message: { contentBg: '<surface-2>' },
}
```

**组件令牌表（实现时对照）**

| 组件 | 关键令牌 | 方向 A 的取值逻辑 |
| --- | --- | --- |
| Table | `headerBg` / `borderColor` / `rowHoverBg` / `cellPaddingBlock` | 表头=surface-2、行线=hairline、hover=surface-2、行高 38（paddingBlock 8） |
| Button | `primaryShadow` / `defaultBg` / `defaultBorderColor` | 主按钮无阴影；次按钮透明底 + hairline |
| Card | `boxShadowTertiary` | 无阴影（靠 hairline + 表面色分层） |
| Input | `activeShadow` | 2px 40% 主色环（与 `controlOutlineWidth: 2` 一致） |
| Tabs | `inkBarColor` | 主色下划线 2px |
| Tag | `defaultBg` / `defaultColor` | 主色 14% 透明底 + 主色字（**不给标签加彩虹色**） |

## 4. 字体令牌

```
fontFamily      = Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans SC",
                  "PingFang SC", "Microsoft YaHei", "Droid Sans Fallback", sans-serif
fontFamilyCode  = ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace
```

字号阶梯（`theme.token`）：`fontSize 13` / `fontSizeSM 11` / `fontSizeLG 15` / `fontSizeHeading4 17` / `fontSizeHeading3 20`。
标题用 `fontWeightStrong: 600`；**中文不加 letter-spacing**，只对拉丁眉标加 `0.10em`（在组件里用 `style` 表达，不上 token）。

## 5. 间距 / 圆角 / 动效令牌

| 类别 | 值 | 落地 |
| --- | --- | --- |
| 间距 | 4 / 8 / 12 / 16 / 20 / 24 / 32 / 48 | antd 用 `padding*` 系列 token + `Flex`/`Space` 的 gap；**不写自有 CSS 间距体系** |
| 圆角 | xs4 / sm6 / md8 / lg12 | `borderRadiusXS/SM/Base/LG` |
| 描边 | 1px；聚焦 2px 40% 环 | `lineWidth` / `controlOutlineWidth` |
| 阴影 | 极淡（弹窗才明显） | `boxShadow` / `boxShadowSecondary` |
| 动效 | 120ms（hover）/ 180ms（浮层） | `motionDurationFast/Mid`；`prefers-reduced-motion` 下由浏览器/antd 处理，实现时不自造动画 |

## 6. 允许的少量自定义 CSS（清单式，10B 直接照做）

antd token 表达不了、但本方向必需的，只有这几处（**都是"少量"**）：

1. **选中行的左侧 2px 强调条**：`box-shadow: inset 2px 0 0 <primary>`（表格行 `onRow` 加类名）。
2. **mono 数据的字距**：`font-variant-numeric: tabular-nums`（一行 CSS，作用于数字列）。
3. **diff 着色块**：`color-mix(in srgb, <success|error> 14%, transparent)` 的行底色（版本面板）。
4. **滚动条**（可选）：暗色下细滚动条，避免系统亮色滚动条破坏暗色观感。

**禁止**：引入 Tailwind/Bootstrap 等第二套体系；自建 Button/Input/Table 等基础组件；改 antd 源码；引 CDN 字体。

## 7. 与验收标准的对齐（10B 用）

| AC | 本令牌如何满足 |
| --- | --- |
| AC-29 ①「token 真被定制」 | §2.3 的 `token: {...}` + §3 的 `components: {...}` 落在 `web/src/App.tsx` |
| AC-29 ②「无 CDN」 | 字体走系统栈（`fontFamily` 字符串里没有 URL） |
| AC-29 ③「不使用原生表单/表格标签」 | 全部观感通过 antd 组件 token 表达 |
| AC-30「亮暗 + 手机」 | §2.1/§2.2 的亮暗两列 + `Grid.useBreakpoint`（手机端行为见 `design-notes.md` §6 与截图 `mobile-list.png`） |
