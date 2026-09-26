import {
  CheckCircleOutlined,
  CodeOutlined,
  ContainerOutlined,
  GithubOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { Alert, Button, Collapse, Flex, List, Modal, Space, Tag, Typography, theme } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { PM_META } from '../pm-meta';

interface AboutModalProps {
  open: boolean;
  onClose: () => void;
}

interface HealthBody {
  status: string;
  version: string;
}

/** 长命令 / 路径：等宽 + 可一键复制（窄屏换行，不横向滚动）。 */
function CopyLine({ text }: { text: string }) {
  return (
    <Typography.Text code copyable={{ text }} className="pm-about-pre" style={{ fontSize: 12 }}>
      {text}
    </Typography.Text>
  );
}

/** 外链：一律新标签打开 + `rel` 含 `noopener`（AC-120 ⑤；`noopener` 断掉 `window.opener` 反向控制）。 */
function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Typography.Link href={href} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12.5 }}>
      {children}
    </Typography.Link>
  );
}

/**
 * 关于（FR-124 / D-56）：把纯运维视角改成**开源项目该有的样子** —— 按「访问者的问题」分三区：
 * ① 身份（这是什么 / 你从哪访问到它）② 出处与去向（代码、镜像、文档、反馈、许可证）③ 使用与维护。
 *
 * 三条硬口径：
 * - **不做版本检查**（D-56 ⑧）：页面上没有任何"检查更新"入口，也不发起任何出网请求。
 * - **服务区整个去掉**（D-56 ④ + FR-124 ②）：「访问地址」移到身份区继续展示；
 *   原「备份方式」那句"拷贝 pm.db"是**错的**（WAL 模式下会丢未落盘写入），随整区一起去掉，不改写成别的样子。
 * - **项目元信息不硬编码**（D-56 ①）：license / author / homepage / repository / bugs / 镜像名
 *   全部来自 `package.json`（构建期注入，见 `pm-meta.ts`）；版本 / 状态 / 访问地址保持运行时动态获取。
 *
 * 锚点：`pm-about`（既有 AC 仍按它定位）。
 */
export default function AboutModal({ open, onClose }: AboutModalProps) {
  const { token } = theme.useToken();
  const [health, setHealth] = useState<HealthBody | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const probe = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const response = await fetch('/healthz', { headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
      setHealth((await response.json()) as HealthBody);
      setError(null);
    } catch (caught) {
      setHealth(null);
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void probe();
  }, [open, probe]);

  const online = health !== null;
  const version = health?.version ?? '—';
  /**
   * FR-117 / R-9（**不得因取消服务区而删掉或改回写死协议**）：「访问地址」是"你从哪访问到本服务"的第一手信息，
   * 取 `window.location.origin` —— 浏览器自身已知的 `scheme://host[:port]`，HTTP 直连与 HTTPS 反代都对，
   * 且不新增任何网络请求；复制按钮用的就是同一个字符串，故"显示 = 复制内容"。
   */
  const address = typeof window === 'undefined' ? '' : window.location.origin;

  const usageLines = [
    '新建：点顶栏「＋新建」，填好标题与提示词后点「保存」才入库。',
    '编辑：分栏右上角「去编辑」，或表格行内的铅笔图标。',
    '复制：卡片、表格行内或详情底部的「复制提示词」；含变量时会先让你填值。',
    '变量填值：在详情面的「变量填值」里填好，点「渲染」得到成品，未填的变量会原样保留。',
    '导入 / 导出：顶栏「⋯更多 → 导入 / 导出」。',
    '快捷键：按 / 聚焦搜索，按 Esc 关闭详情。',
    '命令行：node bin/pm.mjs get <id> / render <id>；MCP：node bin/pm-mcp.mjs（标准输入输出，只读）。',
  ];

  return (
    <Modal open={open} onCancel={onClose} footer={null} width={720} title="关于">
      <Flex vertical gap={12} data-testid="pm-about" style={{ width: '100%' }}>
        {/* FR-59：品牌图形（同一枚图标，关于页用 48） */}
        <Flex justify="center">
          <img
            src="/promptmanager-48.png"
            width={48}
            height={48}
            alt=""
            aria-hidden="true"
            className="pm-brand-art"
            data-testid="pm-brand-art-about"
          />
        </Flex>

        {/* ───────── ① 身份区：这是什么 + 你从哪访问到它 ───────── */}
        <Flex vertical gap={8} data-testid="pm-about-identity">
          <Flex align="center" gap={8} wrap className="pm-about-status">
            <Typography.Text strong style={{ fontSize: 14 }}>
              PromptManager
            </Typography.Text>
            <Tag color={online ? 'green' : 'red'} style={{ marginInlineEnd: 0 }}>
              {online ? '后端在线' : '后端离线'}
            </Tag>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              版本 {version}
            </Typography.Text>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              loading={loading}
              onClick={() => void probe()}
              style={{ marginLeft: 'auto' }}
            >
              重新探测
            </Button>
          </Flex>
          {/* 一句话定位：来自 package.json 的 description（构建期注入，非硬编码） */}
          <Typography.Text type="secondary" style={{ fontSize: 12.5 }} data-testid="pm-about-positioning">
            {PM_META.description}
          </Typography.Text>
          <Flex align="center" gap={6} wrap data-testid="pm-about-address">
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              访问地址
            </Typography.Text>
            <CopyLine text={address} />
          </Flex>
          {PM_META.keywords.length > 0 && (
            <Flex gap={4} wrap data-testid="pm-about-keywords">
              {PM_META.keywords.map((word) => (
                <Tag key={word} style={{ marginInlineEnd: 0, fontSize: 11 }}>
                  {word}
                </Tag>
              ))}
            </Flex>
          )}
        </Flex>
        {error !== null && <Alert type="warning" showIcon message={`探测失败：${error}`} />}

        {/* ───────── ② 出处与去向区 ───────── */}
        <div data-testid="pm-about-links">
          <Descriptions2
            rows={[
              {
                icon: <GithubOutlined />,
                label: '代码仓库',
                value: (
                  <ExtLink href={PM_META.repoUrl}>{PM_META.repoUrl.replace(/^https:\/\//, '')}</ExtLink>
                ),
              },
              {
                icon: <ContainerOutlined />,
                label: 'Docker 镜像',
                value: (
                  <Flex vertical gap={2}>
                    <CopyLine text={PM_META.dockerImage} />
                    <Typography.Text type="secondary" style={{ fontSize: 11.5 }}>
                      拉取时可用 <code>:latest</code> 或某个具体版本标签
                    </Typography.Text>
                  </Flex>
                ),
              },
              {
                icon: <CodeOutlined />,
                label: '文档说明',
                value: <ExtLink href={PM_META.homepage}>README · 使用与部署</ExtLink>,
              },
              {
                icon: <ContainerOutlined />,
                label: '问题反馈',
                value: <ExtLink href={PM_META.issuesUrl}>GitHub Issues</ExtLink>,
              },
              {
                icon: <SafetyCertificateOutlined />,
                label: '许可证',
                value: <ExtLink href={PM_META.licenseUrl}>{PM_META.license}</ExtLink>,
              },
            ]}
          />
        </div>

        {/* ───────── ③ 使用 / 维护（移动端默认折叠，避免弹窗更高） ───────── */}
        <Collapse
          defaultActiveKey={isNarrowHint() ? [] : ['usage']}
          items={[
            {
              key: 'usage',
              label: (
                <Flex align="center" gap={6}>
                  <CheckCircleOutlined />
                  使用
                </Flex>
              ),
              children: (
                <List
                  size="small"
                  dataSource={usageLines}
                  renderItem={(line) => (
                    <List.Item style={{ paddingInline: 0, border: 'none' }}>
                      <Typography.Text style={{ fontSize: 12.5 }}>{line}</Typography.Text>
                    </List.Item>
                  )}
                />
              ),
            },
            {
              key: 'maintain',
              label: (
                <Flex align="center" gap={6}>
                  <ToolOutlined />
                  维护
                </Flex>
              ),
              children: (
                <Flex vertical gap={10}>
                  <Flex vertical gap={4}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      修改登录口令
                    </Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      也可以从界面完成：顶栏「⋯更多」→「修改密码」（改完当前会话保持登录，其它会话退出）；
                      下面的 CLI 方式保留。
                    </Typography.Text>
                    <CopyLine text="node bin/pm.mjs user set-password --username admin" />
                  </Flex>
                  <Flex vertical gap={4}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      查看日志
                    </Typography.Text>
                    <CopyLine text="journalctl -u promptmanager -f" />
                  </Flex>
                  <Flex vertical gap={4}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      重启服务
                    </Typography.Text>
                    <CopyLine text="sudo systemctl restart promptmanager" />
                  </Flex>
                  <Flex vertical gap={4}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      回滚到上一个版本
                    </Typography.Text>
                    <CopyLine text="git checkout <上一个提交> && npm run build && sudo systemctl restart promptmanager" />
                  </Flex>
                  <Flex vertical gap={4}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      依赖与许可清单
                    </Typography.Text>
                    <CopyLine text="docs/dependencies.md" />
                  </Flex>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    <SettingOutlined /> 以上命令只在服务器上由管理员执行；用 Docker 部署时对应
                    <code> docker logs -f promptmanager </code>与
                    <code> docker restart promptmanager </code>。
                  </Typography.Text>
                </Flex>
              ),
            },
          ]}
          style={{ background: token.colorBgContainer }}
        />
      </Flex>
    </Modal>
  );
}

/**
 * 移动端默认折叠「使用 / 维护」区（AC-120 ⑭）：窄屏下弹窗本来就偏高要滚动，
 * 再默认展开两个长分区会更高。判断只看**视口宽度**，不涉及任何数据。
 */
function isNarrowHint(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < 768;
}

/** 出处与去向区：图标 + 名称 + 值，逐行排列（窄屏也能读）。 */
function Descriptions2({
  rows,
}: {
  rows: Array<{ icon: React.ReactNode; label: string; value: React.ReactNode }>;
}) {
  return (
    <Flex vertical gap={6}>
      {rows.map((row) => (
        <Flex key={row.label} align="start" gap={8} wrap>
          <Space size={4} style={{ minWidth: 92, flex: '0 0 auto' }}>
            <span style={{ color: tokenColor() }}>{row.icon}</span>
            <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
              {row.label}
            </Typography.Text>
          </Space>
          <div style={{ minWidth: 0, flex: '1 1 160px' }}>{row.value}</div>
        </Flex>
      ))}
    </Flex>
  );
}

/** 次要文字取色（跟随主题，亮暗自适应）。 */
function tokenColor(): string {
  return 'currentColor';
}
