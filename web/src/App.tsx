import { App as AntdApp, ConfigProvider, Flex, Spin, Typography, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import LoginPage from './components/LoginPage';
import Workspace from './components/Workspace';
import './styles/app.css';
import { buildTheme, cssVars } from './theme';
import {
  cleanupLegacyKeys,
  colorSchemeFor,
  nextThemeMode,
  readThemeMode,
  resolveDark,
  type ThemeMode,
  writeThemeMode,
} from './theme-mode';
import { usePrefersDark } from './use-prefers-dark';

/**
 * 应用外壳（FR-40 / D-19 / FR-44）：
 * - 令牌来自 `theme.ts`（方向 A｜dark-saas）+ zh_CN；
 * - **明暗三态**（亮 / 暗 / 跟随系统）由顶栏的图标按钮循环，默认跟随系统，选择写 localStorage（AC-42）。
 * 全部 UI 来自 antd 组件库；自定义 CSS 只有 `styles/app.css` 里那几处 antd 表达不了的地方。
 */
export default function App() {
  const prefersDark = usePrefersDark();
  // 默认（无记忆 / 清空 localStorage）= 跟随系统（AC-42 ①）
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readThemeMode(window.localStorage));
  const [username, setUsername] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);

  // v17 起取消「使用 / 管理」双模式 → 清掉旧键（FR-43；一次性，写在 UI 之前）
  useEffect(() => {
    cleanupLegacyKeys(window.localStorage);
  }, []);

  const cycleTheme = useCallback((): void => {
    setThemeMode((current) => {
      const next = nextThemeMode(current);
      writeThemeMode(window.localStorage, next);
      return next;
    });
  }, []);

  const resolvedDark = resolveDark(themeMode, prefersDark);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const me = await api.me();
        if (alive) setUsername(me === null ? null : me.username);
      } catch {
        if (alive) setUsername(null);
      } finally {
        if (alive) setBooting(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <ConfigProvider locale={zhCN} theme={buildTheme(resolvedDark)}>
      <AntdApp>
        <ThemeBridge prefersDark={resolvedDark} mode={themeMode} />
        {booting ? (
          <Flex align="center" justify="center" vertical gap={8} style={{ minHeight: '100vh' }}>
            <Spin size="large" />
            <Typography.Text style={{ fontSize: 12 }} type="secondary">
              正在检查会话…
            </Typography.Text>
          </Flex>
        ) : username === null ? (
          <LoginPage onSuccess={(name) => setUsername(name)} />
        ) : (
          <Workspace themeMode={themeMode} onCycleTheme={cycleTheme} onSignedOut={() => setUsername(null)} />
        )}
      </AntdApp>
    </ConfigProvider>
  );
}

/**
 * 把 antd 的 token 落到 `<body>` 与 CSS 变量上（Drawer/Modal 走 portal，拿不到 Layout 的内联样式；
 * `styles/app.css` 里那几处也需要 `--pm-*`）。只消费组件库 token，不写死色值。
 * 同时把主题模式写成 `<html>` 的 `colorScheme`（AC-42 的观测点：system = 空串）。
 */
function ThemeBridge({ prefersDark, mode }: { prefersDark: boolean; mode: ThemeMode }) {
  const { token } = theme.useToken();

  useEffect(() => {
    const root = document.documentElement;
    for (const [name, value] of Object.entries(cssVars(prefersDark))) {
      root.style.setProperty(name, value);
    }
    root.dataset['pmTheme'] = prefersDark ? 'dark' : 'light';
    root.dataset['pmThemeMode'] = mode;
    // system → 空串 = 移除内联 colorScheme，交回系统（AC-42 ①）
    root.style.colorScheme = colorSchemeFor(mode);
    document.body.style.margin = '0';
    document.body.style.fontFamily = token.fontFamily;
    document.body.style.backgroundColor = token.colorBgLayout;
    document.body.style.color = token.colorText;
  }, [prefersDark, mode, token]);

  return null;
}
