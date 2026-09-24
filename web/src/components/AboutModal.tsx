import { CheckCircleOutlined, CloudServerOutlined, ReloadOutlined, SettingOutlined, ToolOutlined } from '@ant-design/icons';
import { Alert, Button, Collapse, Descriptions, Flex, List, Modal, Tag, Typography, theme } from 'antd';
import { useCallback, useEffect, useState } from 'react';

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

/**
 * 关于（FR-52 / D-25）：受众 = **日常使用者**，不是开发者。
 * 顶区一行状态条（品牌 + 版本 + 在线徽标 + 重新探测）；下面按 **服务 / 使用 / 维护（默认折叠）** 三分区；
 * **不出现**内部资料引用（需求合同 / 验收标准 / 阶段编号），不出现重复条目。
 * 锚点：`pm-about`（AC-40 仍按它定位，且仍含 `pm.db` 与 `备份`）。
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
   * FR-117 / R-9：「访问地址」必须是**用户当前实际访问的地址**（协议 + 主机 + 端口）。
   *
   * 原实现写死 `http://` + `window.location.host` ⇒ 用户经 **HTTPS**（反向代理）访问时也显示
   * `http://…`，而这一行**带复制按钮**，等于把错误协议发给用户。
   *
   * 取 `window.location.origin`：浏览器**自身**已知协议与主机端口（`scheme://host[:port]`），
   * HTTP 直连与 HTTPS 反代都正确；**不写死任一协议**，也**不新增任何网络请求**。
   * 复制按钮的 `copyable={{ text }}` 用的就是同一个 `address`，故"显示 = 复制内容"天然一致。
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
        {/* 顶区：一行状态条（取代原来的大块 Result） */}
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
        {error !== null && <Alert type="warning" showIcon message={`探测失败：${error}`} />}

        <Collapse
          defaultActiveKey={['service', 'usage']}
          items={[
            {
              key: 'service',
              label: (
                <Flex align="center" gap={6}>
                  <CloudServerOutlined />
                  服务
                </Flex>
              ),
              children: (
                <Descriptions
                  size="small"
                  column={1}
                  bordered
                  items={[
                    { key: 'version', label: '版本', children: version },
                    { key: 'status', label: '状态', children: online ? '在线' : '离线' },
                    { key: 'address', label: '访问地址', children: <CopyLine text={address} /> },
                    {
                      key: 'data',
                      label: '数据文件',
                      children: 'pm.db（服务端数据目录下的单文件 SQLite，随写随存）',
                    },
                    {
                      key: 'backup',
                      label: '备份方式',
                      children: '拷贝 pm.db 文件；或在「⋯更多 → 导入 / 导出」里导出全部 JSON（含版本历史）。',
                    },
                  ]}
                />
              ),
            },
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
                    <SettingOutlined /> 以上命令只在服务器上由管理员执行。
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
