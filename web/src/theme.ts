import { theme } from 'antd';
import type { ThemeConfig } from 'antd';

/**
 * 方向 A｜dark-saas 的 token 落地（BRIEF D-19 + FR-40 + 阶段 10A 的 `docs/design/a-dark-saas/tokens.md`）。
 *
 * 三条纪律（照设计稿）：
 * ① **一个强调色**：`#5e6ad2`，只出现在主按钮 / 焦点环 / 选中条 / 链接 / 收藏；
 * ② **层级靠表面色 + 1px hairline**，不靠阴影（阴影只在弹窗）；
 * ③ 数据（id/版本/日期/次数）走 mono + tabular-nums。
 *
 * 只切 `algorithm` 不够：antd 的暗色灰阶不是本方向的炭黑阶，所以下面显式覆盖 §2.3 列出的那批 token。
 * 本文件**只有 token**，没有第二套样式体系；antd 表达不了的极少数地方在 `styles/app.css`。
 */
const FONT_UI =
  'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", "Droid Sans Fallback", sans-serif';
const FONT_MONO = 'ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace';

/** 亮/暗两套语义值（= tokens.md §2.1 / §2.2 的两列） */
export function palette(prefersDark: boolean) {
  return {
    canvas: prefersDark ? '#010102' : '#ffffff',
    rail: prefersDark ? '#0b0c0d' : '#fbfbfd',
    surface1: prefersDark ? '#0f1011' : '#ffffff',
    surface2: prefersDark ? '#141516' : '#f6f7f9',
    surface3: prefersDark ? '#18191a' : '#eef0f3',
    selected: prefersDark ? '#191a1b' : '#eceffb',
    hairline: prefersDark ? '#23252a' : '#e4e6ea',
    hairlineStrong: prefersDark ? '#34343a' : '#d4d7dd',
    ink: prefersDark ? '#f7f8f8' : '#14161a',
    inkMuted: prefersDark ? '#d0d6e0' : '#3c4046',
    inkSubtle: prefersDark ? '#8a8f98' : '#6b7280',
    inkTertiary: prefersDark ? '#62666d' : '#9aa1ab',
    /**
     * FR-121：卡片元信息分隔符「·」的颜色。
     *
     * 上一版（FR-116 定稿的 `#c2c7d0` / `#4a4d54`）实测对卡片底色只有 **1.70:1 / 2.25:1**，
     * 低于"非文字装饰元素可辨识"的 3:1 底线，加上字宽仅 3px ⇒ 正常视距几乎看不见。
     * 现值实测：**亮 3.26:1（#878f9b vs #ffffff）**、**深 3.51:1（#666a71 vs #0f1011）**，两套主题都达标。
     * 仍**明显浅于正文**（正文 4.83:1 / 5.86:1），保留"更淡、不喧宾夺主"的设计意图。
     * ⚠️ 本次**只调颜色**：字形「·」、宽度、`gap=6px`、`aria-hidden`、不可选中全部不动（D-55 ③）。
     */
    inkFaint: prefersDark ? '#666a71' : '#878f9b',
    primary: '#5e6ad2',
    primaryHover: prefersDark ? '#828fff' : '#4b57c4',
    primaryActive: prefersDark ? '#4b57c4' : '#3f4bb0',
    success: prefersDark ? '#27a644' : '#1f8f3a',
    error: prefersDark ? '#e5484d' : '#d93a3f',
    warning: prefersDark ? '#f2c14e' : '#b7791f',
    shadow: prefersDark ? '0 1px 2px rgba(0,0,0,.5)' : '0 1px 2px rgba(16,24,40,.06)',
    shadowPop: prefersDark ? '0 12px 32px rgba(0,0,0,.55)' : '0 8px 24px rgba(16,24,40,.10)',
  };
}

/** 把语义值写成 CSS 变量，供 `styles/app.css` 里那几处 antd 表达不了的地方使用。 */
export function cssVars(prefersDark: boolean): Record<string, string> {
  const p = palette(prefersDark);
  return {
    '--pm-primary': p.primary,
    '--pm-hairline': p.hairline,
    '--pm-surface-1': p.surface1,
    '--pm-surface-2': p.surface2,
    '--pm-surface-3': p.surface3,
    '--pm-selected': p.selected,
    '--pm-ink': p.ink,
    '--pm-ink-subtle': p.inkSubtle,
    '--pm-ink-faint': p.inkFaint,
    '--pm-success': p.success,
    '--pm-error': p.error,
    '--pm-font-mono': FONT_MONO,
  };
}

export function buildTheme(prefersDark: boolean): ThemeConfig {
  const c = palette(prefersDark);
  return {
    algorithm: prefersDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      colorBgLayout: c.canvas,
      colorBgContainer: c.surface1,
      colorBgElevated: c.surface2,
      colorFillQuaternary: c.surface2,
      colorFillTertiary: c.surface3,
      controlItemBgHover: c.surface3,
      controlItemBgActive: c.selected,
      colorBorderSecondary: c.hairline,
      colorBorder: c.hairlineStrong,
      colorText: c.ink,
      colorTextSecondary: c.inkMuted,
      colorTextTertiary: c.inkSubtle,
      colorTextQuaternary: c.inkTertiary,
      colorPrimary: c.primary,
      colorInfo: c.primary,
      colorLink: c.primary,
      colorPrimaryHover: c.primaryHover,
      colorPrimaryActive: c.primaryActive,
      colorSuccess: c.success,
      colorError: c.error,
      colorWarning: c.warning,
      borderRadius: 8,
      borderRadiusLG: 12,
      borderRadiusSM: 6,
      borderRadiusXS: 4,
      controlHeight: 32,
      controlHeightSM: 26,
      controlHeightLG: 36,
      fontSize: 13,
      fontSizeSM: 11,
      fontSizeLG: 15,
      fontSizeHeading4: 17,
      fontSizeHeading3: 20,
      fontFamily: FONT_UI,
      fontFamilyCode: FONT_MONO,
      fontWeightStrong: 600,
      lineWidth: 1,
      controlOutlineWidth: 2,
      motionDurationFast: '0.12s',
      motionDurationMid: '0.18s',
      boxShadow: c.shadow,
      boxShadowSecondary: c.shadowPop,
      boxShadowTertiary: 'none',
      wireframe: false,
    },
    components: {
      Layout: {
        headerBg: c.rail,
        headerHeight: 52,
        headerPadding: '0 16px',
        bodyBg: c.canvas,
        siderBg: c.rail,
        footerBg: c.canvas,
        footerPadding: '8px 16px',
      },
      Card: {
        colorBgContainer: c.surface1,
        borderRadiusLG: 12,
        paddingLG: 16,
        headerBg: 'transparent',
      },
      Table: {
        headerBg: c.surface2,
        headerColor: c.inkSubtle,
        headerSplitColor: 'transparent',
        borderColor: c.hairline,
        rowHoverBg: c.surface2,
        rowSelectedBg: c.selected,
        rowSelectedHoverBg: c.surface3,
        cellPaddingBlock: 7,
        cellPaddingInline: 12,
        fontSize: 13,
      },
      Button: {
        controlHeight: 32,
        fontWeight: 500,
        primaryShadow: 'none',
        defaultShadow: 'none',
        dangerShadow: 'none',
        defaultBg: 'transparent',
        defaultColor: c.inkMuted,
        defaultBorderColor: c.hairline,
      },
      Input: {
        colorBgContainer: c.surface1,
        activeBorderColor: c.primary,
        hoverBorderColor: c.hairlineStrong,
        paddingBlock: 5,
        paddingInline: 10,
      },
      Select: { optionSelectedBg: c.selected, optionActiveBg: c.surface2 },
      Tabs: { inkBarColor: c.primary, itemColor: c.inkSubtle, itemSelectedColor: c.ink, horizontalItemGutter: 8 },
      Drawer: { colorBgElevated: c.surface1, paddingLG: 20 },
      Modal: { contentBg: c.surface1, headerBg: c.surface1, titleFontSize: 16 },
      Tag: { defaultBg: 'rgba(94,106,210,0.14)', defaultColor: c.primary, borderRadiusSM: 4 },
      Segmented: { itemSelectedBg: c.surface3, itemColor: c.inkSubtle, itemSelectedColor: c.ink, trackBg: c.surface2 },
      Tooltip: { colorBgSpotlight: c.surface3, colorTextLightSolid: c.ink },
    },
  };
}
