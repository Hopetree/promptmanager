import {
  BarChartOutlined,
  EllipsisOutlined,
  ExportOutlined,
  KeyOutlined,
  LockOutlined,
  LogoutOutlined,
  MenuOutlined,
  MoonOutlined,
  PlusOutlined,
  SettingOutlined,
  SunOutlined,
} from '@ant-design/icons';
import { Button, Dropdown, Flex, Layout, Space, Typography, theme } from 'antd';
import type { MenuProps } from 'antd';
import { themeToggleTitle, type ThemeMode } from '../theme-mode';

interface AppHeaderProps {
  /** 当前主题模式（亮 / 暗 / 跟随系统）——图标形态与 title 都由它决定 */
  themeMode: ThemeMode;
  onCycleTheme: () => void;
  isMobile: boolean;
  /** 显示「筛选」抽屉按钮（移动端，或 768–1200px 左栏收起时） */
  showFilters: boolean;
  onOpenFilters: () => void;
  /** `＋新建`：只开**内存草稿**（FR-45），不落库 */
  onCreate: () => void;
  onOpenUsage: () => void;
  onOpenTokens: () => void;
  onOpenImportExport: () => void;
  /** 「关于」（技术信息落点）；testid 仍为 `pm-settings`（FR-48） */
  onOpenSettings: () => void;
  /** FR-67：「修改密码」弹窗（取代 v20 那个只读的登录信息项） */
  onOpenPassword: () => void;
  onLogout: () => void;
  /** 点 logo = 回主页（FR-51）：复位视图 / 搜索 / 筛选 / 选中 */
  onGoHome: () => void;
}

/**
 * 顶栏（FR-47 / FR-48 / D-23）：**只有一栏**，自左至右固定为
 * 品牌 · `＋新建`（`header-new`）· `⋯更多`（`header-more`）· 主题图标（`pm-theme-toggle`）· 登出（`header-logout`）。
 * **不显示登录用户信息**；`⋯更多` 子项顺序（FR-48 v27 修订）=
 * 使用统计 → API 令牌 → 导入 / 导出 → 关于 → **修改密码** → 登出。
 * 锚点仍是 `pm-topnav`（AC-31）。
 */
export default function AppHeader({
  themeMode,
  onCycleTheme,
  isMobile,
  showFilters,
  onOpenFilters,
  onCreate,
  onOpenUsage,
  onOpenTokens,
  onOpenImportExport,
  onOpenSettings,
  onOpenPassword,
  onLogout,
  onGoHome,
}: AppHeaderProps) {
  const { token } = theme.useToken();

  // FR-48 / FR-67（v27 修订）：顺序逐项固定（AC-67 ① 按 DOM 顺序断言）——
  // 使用统计 → API 令牌 → 导入 / 导出 → 关于 → **修改密码**（取代 v20 那个只读的登录信息项）→ 登出
  const moreItems: MenuProps['items'] = [
    { key: 'usage', icon: <BarChartOutlined />, label: '使用统计' },
    { key: 'tokens', icon: <KeyOutlined />, label: 'API 令牌' },
    { key: 'import-export', icon: <ExportOutlined />, label: '导入 / 导出' },
    { key: 'settings', icon: <SettingOutlined />, label: <span data-testid="pm-settings">关于</span> },
    {
      key: 'password',
      icon: <LockOutlined />,
      label: <span data-testid="pm-menu-password">修改密码</span>,
    },
    { key: 'logout', icon: <LogoutOutlined />, label: '登出', danger: true },
  ];

  const onMoreClick: MenuProps['onClick'] = ({ key }: { key: string }) => {
    if (key === 'usage') onOpenUsage();
    else if (key === 'tokens') onOpenTokens();
    else if (key === 'import-export') onOpenImportExport();
    else if (key === 'settings') onOpenSettings();
    else if (key === 'password') onOpenPassword();
    else if (key === 'logout') onLogout();
  };

  // FR-58：三态同一视觉体系 —— 亮 = 太阳；暗 = 月亮；跟随系统 = 太阳 + 月亮并排（不再用电脑图标）
  const themeIcon =
    themeMode === 'light' ? (
      <SunOutlined />
    ) : themeMode === 'dark' ? (
      <MoonOutlined />
    ) : (
      <span className="pm-theme-icon-both">
        <SunOutlined />
        <MoonOutlined />
      </span>
    );

  return (
    <Layout.Header
      data-testid="pm-topnav"
      className="pm-shell-header"
      style={{
        background: token.colorBgContainer,
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        display: 'flex',
        alignItems: 'center',
        paddingInline: isMobile ? 8 : 16,
      }}
    >
      {/* antd Layout.Header 的 line-height 是固定 64px：不覆盖它，品牌方块里的字会被挤到框外 */}
      <Flex align="center" justify="space-between" gap={12} style={{ width: '100%', lineHeight: 1.4 }}>
        <Flex align="center" gap={10} style={{ minWidth: 0 }}>
          {showFilters && <Button type="text" icon={<MenuOutlined />} onClick={onOpenFilters} aria-label="筛选" />}
          {/* FR-51：logo 整块可点 → 回主页 */}
          <span
            className="pm-brand"
            role="button"
            tabIndex={0}
            aria-label="回到首页"
            onClick={onGoHome}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onGoHome();
              }
            }}
          >
            {/* FR-59：全站同一枚图标（提示符 >_），顶栏用矢量版渲染 26×26 */}
            <img
              src="/promptmanager-icon.svg"
              width={26}
              height={26}
              alt=""
              className="pm-brand-mark"
              data-testid="pm-brand-mark"
            />
            {!isMobile && (
              <Typography.Text
                strong
                style={{ fontSize: 16, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}
                data-testid="pm-brand-text"
              >
                {/* FR-76 / D-31：顶栏是唯一空间受限处 ⇒ 用简称 PromptM；其余位置（<title>/登录/关于/错误文案）保持全名 */}
                PromptM
              </Typography.Text>
            )}
          </span>
        </Flex>

        {/* FR-47 顺序：新建 → 更多 → 主题 → 登出（AC-47 按 left 坐标升序断言） */}
        <Space size={4} align="center">
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={onCreate}
            data-testid="header-new"
            aria-label="新建"
          >
            {isMobile ? null : '新建'}
          </Button>
          <Dropdown menu={{ items: moreItems, onClick: onMoreClick }} trigger={['click']}>
            <Button type="text" icon={<EllipsisOutlined />} data-testid="header-more" aria-label="更多">
              {isMobile ? null : '更多'}
            </Button>
          </Dropdown>
          <Button
            type="text"
            icon={themeIcon}
            onClick={onCycleTheme}
            data-testid="pm-theme-toggle"
            title={themeToggleTitle(themeMode)}
            aria-label={themeToggleTitle(themeMode)}
          />
          <Button type="text" icon={<LogoutOutlined />} onClick={onLogout} data-testid="header-logout">
            登出
          </Button>
        </Space>
      </Flex>
    </Layout.Header>
  );
}
