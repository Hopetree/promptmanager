# 令牌草案 · 方向 B｜apple-minimal

> 三层令牌（Primitive → Semantic → Component），落地目标是 antd `ConfigProvider` 的 `theme.token` / `theme.components`。
> **不引入第二套样式体系**；少量自定义 CSS 见 §6。值取自 `mockup.html` 实际使用的一套。

## 0. 映射原则

1. Primitive 只做"原料"，实现时可为 TS 常量或注释。
2. Semantic → `theme.token`（§2 的最后一列逐条对应）。
3. Component → `theme.components`（§3）。
4. **亮/暗**：`algorithm` 跟随系统 + §2.3 显式覆盖（纯白/纯黑与 antd 默认灰阶不同）。
5. 组件里不许写裸色值。

---

## 1. L1 · Primitive

| 令牌 | 值 | 令牌 | 值 |
| --- | --- | --- | --- |
| `--p-gray-0 / 50 / 100` | `#ffffff` / `#fbfbfd` / `#f5f5f7` | `--p-gray-200 / 300` | `#e8e8ed` / `#d2d2d7` |
| `--p-gray-500 / 600 / 800` | `#86868b` / `#6e6e73` / `#424245` | `--p-gray-900 / black` | `#1d1d1f` / `#000000` |
| `--p-blue-600 / 500 / 400` | `#0066cc` / `#0071e3` / `#2997ff` | `--p-green-600 / 400` | `#1d7d3f` / `#30d158` |
| `--p-red-600 / 500` | `#c7251f` / `#ff3b30` | `--p-orange-500` | `#b25000` |
| 间距 | 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 | 圆角 | 8 / 12 / 18 / 980(全圆) |
| 动效 | 220ms `cubic-bezier(.28,.11,.32,1)` | 字体 | 见 §4 |

## 2. L2 · Semantic（= antd `theme.token`）

### 2.1 表面与文字

| 语义令牌 | 亮色 | 暗色 | 对应 antd token |
| --- | --- | --- | --- |
| `--canvas` | `#ffffff` | `#000000` | `colorBgLayout` |
| `--canvas-alt` | `#f5f5f7` | `#0d0d0f` | `colorFillQuaternary`（内容区底） |
| `--surface` | `#ffffff` | `#161617` | `colorBgContainer` / `colorBgElevated` |
| `--surface-soft` | `#fbfbfd` | `#101011` | `colorFillTertiary`（输入区底色） |
| `--hairline` | `#e8e8ed` | `#2d2d2f` | `colorBorderSecondary` |
| `--ink` | `#1d1d1f` | `#f5f5f7` | `colorText` |
| `--ink-muted` | `#6e6e73` | `#a1a1a6` | `colorTextSecondary` |
| `--ink-subtle` | `#6e6e73`（**偏离技能原值 `#86868b`，为 AA 对比度**） | `#a1a1a6` | `colorTextTertiary` |
| `--accent` | `#0066cc` | `#2997ff` | `colorPrimary`、`colorInfo`、`colorLink` |
| `--accent-hover` | `#0071e3` | `#5cb8ff` | `colorPrimaryHover` |
| `--success` / `--danger` / `--warn` | `#1d7d3f` / `#c7251f` / `#b25000` | `#30d158` / `#ff3b30` / `#ff9f0a` | `colorSuccess` / `colorError` / `colorWarning` |
| 阴影 | `0 4px 24px rgba(0,0,0,.08)` | `0 4px 24px rgba(0,0,0,.6)` | `boxShadow` / `boxShadowSecondary` |

### 2.2 层级规则（本方向的核心，不是颜色而是"面"）

- **白卡片 + 浅灰底**：内容区 `colorBgLayout = #f5f5f7`，卡片 `colorBgContainer = #ffffff`。
  （与方向 A 相反：A 是"深底 + 稍亮卡片"，B 是"浅灰底 + 纯白卡片"。）
- 表格**不用竖线**：`colorBorderSecondary` 只出现在行之间。

### 2.3 需要显式覆盖的 token（仅切 algorithm 不够）

```ts
theme={{
  algorithm: prefersDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
  token: {
    colorBgLayout: dark ? '#000000' : '#ffffff',
    colorBgContainer: dark ? '#161617' : '#ffffff',
    colorBgElevated: dark ? '#161617' : '#ffffff',
    colorFillQuaternary: dark ? '#0d0d0f' : '#f5f5f7',
    colorFillTertiary: dark ? '#101011' : '#fbfbfd',
    colorBorderSecondary: dark ? '#2d2d2f' : '#e8e8ed',
    colorText: dark ? '#f5f5f7' : '#1d1d1f',
    colorTextSecondary: dark ? '#a1a1a6' : '#6e6e73',
    colorTextTertiary: dark ? '#a1a1a6' : '#6e6e73',
    colorPrimary: dark ? '#2997ff' : '#0066cc',
    colorInfo: dark ? '#2997ff' : '#0066cc',
    colorLink: dark ? '#2997ff' : '#0066cc',
    colorPrimaryHover: dark ? '#5cb8ff' : '#0071e3',
    colorSuccess: dark ? '#30d158' : '#1d7d3f',
    colorError: dark ? '#ff3b30' : '#c7251f',
    colorWarning: dark ? '#ff9f0a' : '#b25000',
    borderRadius: 12, borderRadiusLG: 18, borderRadiusSM: 10, borderRadiusXS: 8,
    controlHeight: 36, controlHeightSM: 30, controlHeightLG: 44,
    fontSize: 15, fontSizeSM: 13, fontSizeLG: 17, fontSizeHeading3: 28, fontSizeHeading2: 40,
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, "Helvetica Neue", "PingFang SC", "Noto Sans SC", "Microsoft YaHei", "Droid Sans Fallback", sans-serif',
    fontWeightStrong: 600,
    lineWidth: 1, lineWidthBold: 2,
    motionDurationFast: '0.22s', motionEaseInOut: 'cubic-bezier(.28,.11,.32,1)',
    boxShadow: dark ? '0 4px 24px rgba(0,0,0,.6)' : '0 4px 24px rgba(0,0,0,.08)',
    boxShadowSecondary: dark ? '0 12px 40px rgba(0,0,0,.7)' : '0 12px 40px rgba(0,0,0,.14)',
    wireframe: false,
  },
}}
```

## 3. L3 · Component（= antd `theme.components`）

```ts
components: {
  Layout:   { headerBg: '<canvas>', headerHeight: 48, headerPadding: '0 24px', bodyBg: '<canvas-alt>', siderBg: '<canvas>' },
  Card:     { borderRadiusLG: 18, paddingLG: 24, colorBgContainer: '<surface>', boxShadowTertiary: '0 4px 24px rgba(0,0,0,.08)' },
  Table:    { headerBg: 'transparent', headerColor: '<ink-subtle>', headerSplitColor: 'transparent',
              borderColor: '<hairline>', rowHoverBg: '<surface-soft>', cellPaddingBlock: 18, cellPaddingInline: 20,
              fontSize: 15 },
  Button:   { borderRadius: 980, borderRadiusSM: 980, borderRadiusLG: 980, controlHeight: 36,
              fontWeight: 500, primaryShadow: 'none', defaultShadow: 'none', dangerShadow: 'none',
              defaultBg: 'transparent', defaultBorderColor: '<hairline>' },
  Input:    { colorBgContainer: '<surface-soft>', activeBg: '<surface>', hoverBg: '<surface-soft>',
              activeBorderColor: '<accent>', borderColor: 'transparent', activeShadow: 'none',
              paddingBlock: 10, paddingInline: 14, borderRadius: 12, borderRadiusLG: 12 },
  Select:   { optionSelectedBg: '<canvas-alt>', borderRadius: 980, controlHeight: 36 },
  Tabs:     { inkBarColor: '<ink>', itemColor: '<ink-subtle>', itemSelectedColor: '<ink>', horizontalItemGutter: 24, titleFontSize: 14 },
  Drawer:   { colorBgElevated: '<surface>', paddingLG: 24, borderRadiusLG: 18 },
  Modal:    { contentBg: '<surface>', borderRadiusLG: 18, titleFontSize: 17 },
  Tag:      { defaultBg: '<canvas-alt>', defaultColor: '<ink-muted>', borderRadiusSM: 980 },
  Segmented:{ trackBg: '<canvas-alt>', itemSelectedBg: '<surface>', itemColor: '<ink-muted>', itemSelectedColor: '<ink>', borderRadius: 980 },
  Tooltip:  { colorBgSpotlight: '<ink>', colorTextLightSolid: '<canvas>' },
}
```

| 组件 | 关键点 | 说明 |
| --- | --- | --- |
| Table | `cellPaddingBlock: 18`（≈60px 行高）、`headerBg: transparent`、`headerSplitColor: transparent` | "目录感"来自行高与去线，不来自颜色 |
| Button | 三个 `borderRadius*` 全设 980 | 胶囊按钮是本方向的识别特征 |
| Card | `boxShadowTertiary` 极淡 | 浮起感靠阴影 + 浅灰底 |
| Input | `borderColor: transparent` + 底色 | "无框输入"，聚焦才出现蓝边 |

## 4. 字体令牌

```
fontFamily = -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, "Helvetica Neue",
             "PingFang SC", "Noto Sans SC", "Microsoft YaHei", "Droid Sans Fallback", sans-serif
fontFamilyCode = ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace
fontWeightStrong = 600        // 本方向**不用 700**
```

字号阶梯：`fontSize 15` / `fontSizeSM 13` / `fontSizeLG 17` / `fontSizeHeading3 28` / `fontSizeHeading2 40`；
列表标题用 17/500，靠字号跨度而非颜色做层级。

## 5. 间距 / 圆角 / 阴影 / 动效

| 类别 | 值 | 落地 |
| --- | --- | --- |
| 间距 | 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 | `Flex/Space` gap + `padding*` token；区块间距 ≥32 |
| 圆角 | 8 / 12 / 18 / 980 | `borderRadiusXS/SM/Base/LG` + Button 的 980 |
| 描边 | 只有行分隔与输入框；聚焦用蓝边 | `lineWidth: 1`、`lineWidthBold: 2` |
| 阴影 | 极淡（卡片）/ 稍强（弹窗） | `boxShadow` / `boxShadowSecondary` |
| 动效 | 220ms 缓动 | `motionDurationFast` / `motionEaseInOut`；无位移/缩放动画 |

## 6. 允许的少量自定义 CSS（清单式）

1. **40px 大标题的字距**：`letter-spacing:-0.021em`（antd `fontSizeHeading2` 不带这个字距，用一次内联 style）。
2. **表格行高**：若 `cellPaddingBlock` 在目标 antd 版本上不足，补一条 `padding-block` 覆盖（仍是 token 优先）。
3. **暗色下的卡片边界**：暗色 `boxShadow` 表达力弱，补 `border: 1px solid <hairline>`（一行）。
4. **滚动条**（可选）：暗色细滚动条。

**禁止**：第二套 CSS 框架、自建基础组件、改 antd 源码、CDN 字体/图标。

## 7. 与验收标准的对齐（10B 用）

| AC | 本令牌如何满足 |
| --- | --- |
| AC-29 ① | §2.3 的 `token` + §3 的 `components` 落地到 `web/src/App.tsx` |
| AC-29 ② | 字体为系统栈，无 URL |
| AC-29 ③ | 观感全部经 antd token/组件表达；无一原生表单标签 |
| AC-30 | §2.1 亮暗两列 + 手机断点（行高与胶囊按钮在 390 宽下已验证，见 `shots/mobile-list.png`） |
