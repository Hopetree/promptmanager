# 令牌草案 · 方向 C｜japanese-minimal（dsh 自选）

> 三层令牌（Primitive → Semantic → Component），落地目标是 antd `ConfigProvider` 的 `theme.token` / `theme.components`。
> **不引入第二套样式体系**；少量自定义 CSS 见 §6（含印章与竖排落款两处"签名"）。
> 值取自 `mockup.html` 实际使用的一套。

## 0. 映射原则

1. Primitive 只作原料（实现时可为 TS 常量 / 注释）。
2. Semantic → `theme.token`（§2 最后一列逐条对应）。
3. Component → `theme.components`（§3）。
4. **亮/暗**：`algorithm` 跟随系统 + §2.3 显式覆盖（纸 ↔ 墨色纸）。
5. 衬线**不进全局 `fontFamily`**：只通过组件 `style` 局部指定（页面标题/条目标题/统计/弹窗标题），
   否则表单与表格会难读。

---

## 1. L1 · Primitive

| 令牌 | 值 | 令牌 | 值 |
| --- | --- | --- | --- |
| `--p-paper-0 / 50 / 100 / 200` | `#ffffff` / `#fbfbf8` / `#f4f4f0` / `#eceae3` | `--p-line-300 / 400` | `#dcdcd6` / `#c8c8c0` |
| `--p-sumi-500 / 600 / 700 / 900` | `#6f6f68` / `#4a4a45` / `#2c2e30` / `#16181a` | `--p-vermilion-600 / 400` | `#b7282e` / `#d4483f` |
| `--p-moss-600` | `#4a6047` | `--p-indigo-700` | `#2f4a6b` |
| 间距 | 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 | 圆角 | 2 / 3 / 4 |
| 字体 | 衬线栈 + 黑体栈 + 等宽栈（见 §4） | 动效 | 仅 border-color（≈90ms），无位移 |

## 2. L2 · Semantic（= antd `theme.token`）

### 2.1 表面与文字

| 语义令牌 | 亮色（纸） | 暗色（墨色纸） | 对应 antd token |
| --- | --- | --- | --- |
| `--paper` | `#fbfbf8` | `#101112` | `colorBgLayout` |
| `--paper-raised` | `#ffffff` | `#161718` | `colorBgContainer` / `colorBgElevated` |
| `--paper-sunken` | `#f4f4f0` | `#0b0c0d` | `colorFillTertiary`（表头/代码块） |
| `--line` | `#dcdcd6` | `#2a2b2c` | `colorBorderSecondary` |
| `--line-strong` | `#c8c8c0` | `#3a3c3d` | `colorBorder` |
| `--ink` | `#16181a` | `#f2f1ea` | `colorText` |
| `--ink-muted` | `#4a4a45` | `#b9b6ab` | `colorTextSecondary` |
| `--ink-subtle` | `#6f6f68` | `#8d8a80` | `colorTextTertiary` |
| `--vermilion` | `#b7282e` | `#d4483f` | `colorError`（**同时是唯一点缀色**） |
| `--success` | `#4a6047` | `#8fae8a` | `colorSuccess` |
| `--link` | `#2f4a6b` | `#9db8d8` | `colorLink`、`colorPrimary`（见 §2.3 说明） |

> ⚠️ 本方向**没有"品牌主色"**：`colorPrimary` 取低饱和靛（`#2f4a6b` / `#9db8d8`），只用于链接与聚焦；
> 朱红留给 `colorError` 与"印章/收藏"两处语义。这样既满足"点缀 ≤2 处"，又不会让 antd 的 primary 到处渗色。

### 2.2 层级规则

- **无卡片、无阴影**：层级 = 1px 细线 + 留白。`colorBgContainer` 与 `colorBgLayout` 只差 5% 明度。
- 表格无竖线；表头只有下边线一条。

### 2.3 需要显式覆盖的 token

```ts
theme={{
  algorithm: prefersDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
  token: {
    colorBgLayout: dark ? '#101112' : '#fbfbf8',
    colorBgContainer: dark ? '#161718' : '#ffffff',
    colorBgElevated: dark ? '#161718' : '#ffffff',
    colorFillTertiary: dark ? '#0b0c0d' : '#f4f4f0',
    colorBorderSecondary: dark ? '#2a2b2c' : '#dcdcd6',
    colorBorder: dark ? '#3a3c3d' : '#c8c8c0',
    colorText: dark ? '#f2f1ea' : '#16181a',
    colorTextSecondary: dark ? '#b9b6ab' : '#4a4a45',
    colorTextTertiary: dark ? '#8d8a80' : '#6f6f68',
    colorPrimary: dark ? '#9db8d8' : '#2f4a6b',      // 低饱和：不与朱红抢
    colorInfo: dark ? '#9db8d8' : '#2f4a6b',
    colorLink: dark ? '#9db8d8' : '#2f4a6b',
    colorError: dark ? '#d4483f' : '#b7282e',        // 朱红
    colorErrorHover: dark ? '#e0645c' : '#9d2026',
    colorSuccess: dark ? '#8fae8a' : '#4a6047',
    borderRadius: 3, borderRadiusLG: 4, borderRadiusSM: 2, borderRadiusXS: 2,
    controlHeight: 34, controlHeightSM: 28, controlHeightLG: 38,
    fontSize: 15, fontSizeSM: 12, fontSizeLG: 16, fontSizeHeading3: 24, fontSizeHeading2: 32,
    lineHeight: 1.8,                                  // 「間」体现在行距上
    fontFamily: '<黑体栈，见 §4>',                      // 全局=黑体（可读性）
    fontFamilyCode: '<等宽栈>',
    fontWeightStrong: 500,                            // 本方向**不用 700**
    lineWidth: 1, lineWidthBold: 1,
    controlOutline: 'transparent', controlOutlineWidth: 0,
    motionDurationFast: '0.09s', motionDurationMid: '0.12s',
    boxShadow: 'none', boxShadowSecondary: 'none', boxShadowTertiary: 'none',
    wireframe: false,
  },
}}
```

## 3. L3 · Component（= antd `theme.components`）

```ts
components: {
  Layout:   { headerBg: '<paper>', headerHeight: 56, headerPadding: '0 24px', bodyBg: '<paper>', siderBg: '<paper>' },
  Card:     { colorBgContainer: 'transparent', boxShadowTertiary: 'none', paddingLG: 0, borderRadiusLG: 0 },
  Table:    { headerBg: 'transparent', headerColor: '<ink-subtle>', headerSplitColor: 'transparent',
              borderColor: '<line>', rowHoverBg: '<paper-raised>', cellPaddingBlock: 12, cellPaddingInline: 12, fontSize: 14 },
  Button:   { borderRadius: 3, borderRadiusSM: 2, controlHeight: 34, fontWeight: 400,
              primaryShadow: 'none', defaultShadow: 'none', dangerShadow: 'none',
              defaultBg: 'transparent', defaultColor: '<ink-muted>', defaultBorderColor: '<line-strong>',
              primaryColor: '<paper>', colorPrimary: '<ink>' },   // 主按钮=墨色底（不是朱红）
  Input:    { colorBgContainer: '<paper-raised>', activeBorderColor: '<vermilion>', hoverBorderColor: '<line-strong>',
              activeShadow: 'none', paddingBlock: 10, paddingInline: 13, borderRadius: 3, fontSize: 14.5 },
  Select:   { optionSelectedBg: '<paper-sunken>', borderRadius: 3, controlHeight: 34 },
  Tabs:     { inkBarColor: '<ink>', itemColor: '<ink-subtle>', itemSelectedColor: '<ink>', horizontalItemGutter: 24 },
  Drawer:   { colorBgElevated: '<paper-raised>', paddingLG: 24 },
  Modal:    { contentBg: '<paper-raised>', headerBg: '<paper-raised>', titleFontSize: 17, borderRadiusLG: 0 },
  Tag:      { defaultBg: 'transparent', defaultColor: '<ink-muted>', defaultBorderColor: '<line>', borderRadiusSM: 2 },
  Segmented:{ trackBg: '<paper-sunken>', itemSelectedBg: '<paper-raised>', itemColor: '<ink-muted>', itemSelectedColor: '<ink>', borderRadius: 2 },
  Tooltip:  { colorBgSpotlight: '<ink>', colorTextLightSolid: '<paper>' },
}
```

| 组件 | 关键点 | 说明 |
| --- | --- | --- |
| Card | 透明底 + 无阴影 + 0 padding | 本方向"没有卡片"：区块靠 `border-top: 1px` 与留白分组（见 §6.1） |
| Table | 无竖线、行高 56（paddingBlock 12）、表头只有下边线 | 目录感来自细线 |
| Button | 圆角 3、主按钮墨色底、danger 才是朱红 | 朱红不与主操作抢 |
| Input | 纸色底 + 朱红聚焦边 + 方角 | 输入区是"稿纸" |
| Modal | `borderRadiusLG: 0` + 强描边 | 无阴影下的层级靠描边 |

## 4. 字体令牌（三栈，分工明确）

```
fontFamily      = "Hiragino Kaku Gothic ProN","Yu Gothic","PingFang SC","Noto Sans SC","Microsoft YaHei",
                  "Droid Sans Fallback",system-ui,sans-serif          // 全局=黑体（正文/表单/表格）
fontFamilyCode  = ui-monospace, SFMono-Regular, Menlo, Consolas, monospace

// 衬线（明朝体）**只局部使用**（页面标题 / 条目标题 / 统计数字 / 弹窗标题 / 变量渲染结果）：
SERIF = "Hiragino Mincho ProN","Yu Mincho","Noto Serif SC","Songti SC","Source Han Serif SC",
        "Noto Serif CJK SC",SimSun,"Droid Sans Fallback",Georgia,serif
```

字号阶梯：`fontSize 15` / `fontSizeSM 12` / `fontSizeLG 16` / `fontSizeHeading3 24` / `fontSizeHeading2 32`；
`lineHeight 1.8`；小标签用 `fontSize:11 + letterSpacing:'0.22em'`（内联）。

**字体可得性与回退**（重要）：228 上只有 `Droid Sans Fallback`，中文标题看不到明朝体。
10B 若选本方向，需要在"系统衬线栈 / 自托管字体（非 CDN，+3–8MB）/ 只在少数点题处用衬线"三者中拍板；
本稿按第三种做（退化也成立）。**本阶段不引任何字体文件**。

## 5. 间距 / 圆角 / 描边 / 阴影 / 动效

| 类别 | 值 | 落地 |
| --- | --- | --- |
| 间距 | 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 | 区块 32–48；行距 1.8（`lineHeight` token） |
| 圆角 | 2 / 3 / 4 | `borderRadiusXS/SM/Base/LG`（近乎直角） |
| 描边 | 1px，全站唯一的"边" | `lineWidth: 1`；`controlOutlineWidth: 0`（聚焦改用朱红描边） |
| 阴影 | 全无 | 三个 `boxShadow*` 全 `none`；弹窗用强描边 |
| 动效 | 仅 border-color ≈90ms | `motionDurationFast`；无位移/缩放 |

## 6. 允许的少量自定义 CSS（清单式）

1. **区块分组**：`border-top: 1px solid var(--line)`（Card 被置为透明无阴影后，用它代替卡片边界）。
2. **朱红印章**：26×26、`background: vermilion`、`transform: rotate(-2deg)`、衬线单字。
3. **竖排落款**：`writing-mode: vertical-rl; letter-spacing: .4em`（左栏「整 理 之 所」/ 编辑器头「原 稿」）。
4. **细线表头字距**：`letter-spacing: .22em`（小标签）。
5. **diff 行着色**：`color-mix(in srgb, <success|error> 8%, transparent)`。

**禁止清单（本方向的命门）**：给标签/分类上彩色；在印章与收藏之外使用朱红；加阴影或渐变；
把全局 `fontFamily` 换成衬线；引入第二套 CSS 体系或自建组件。

## 7. 与验收标准的对齐（10B 用）

| AC | 本令牌如何满足 |
| --- | --- |
| AC-29 ① | §2.3 `token` + §3 `components` 落 `web/src/App.tsx`（含 `boxShadow: none`、`borderRadius: 3` 等明显偏离默认值的项，一眼可验） |
| AC-29 ② | 无任何字体/图标 URL（衬线与黑体都是系统栈） |
| AC-29 ③ | 印记与竖排用 `div` + CSS，**不改组件库、不建基础组件** |
| AC-30 | §2.1 亮/暗两列 + 390×844 断点（印章缩小、行内 meta 单行，见 `shots/mobile-list.png`） |
