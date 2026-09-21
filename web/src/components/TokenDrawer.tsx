import { CopyOutlined, KeyOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import {
  Alert,
  App as AntdApp,
  Button,
  Drawer,
  Flex,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { TableProps } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, describeError } from '../api';
import { writeClipboard } from '../clipboard';
import { formatDateTime } from '../pure';
import type { CreatedToken, TokenSummary } from '../types';
import { EmptyState } from './States';

interface TokenDrawerProps {
  open: boolean;
  onClose: () => void;
  onUnauthorized: () => void;
}

/**
 * API Token 管理（FR-15；FR-94 起**可随时查看/复制**）：浏览器用 cookie 会话管理。
 * - 新建：创建响应里给明文（模态框可复制）；
 * - 已有：`revealable=true` 的行有「复制」按钮（现取现复制，明文不落前端状态之外的地方）；
 * - 存量 token（迁移前创建，`revealable=false`）：显示"不可查看"，提示撤销后重建。
 */
export default function TokenDrawer({ open, onClose, onUnauthorized }: TokenDrawerProps) {
  const { message } = AntdApp.useApp();
  const [tokens, setTokens] = useState<TokenSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedToken | null>(null);
  const [form] = Form.useForm<{ name: string }>();

  const handleError = useCallback(
    (error: unknown): void => {
      if (error instanceof ApiError && error.status === 401) {
        onUnauthorized();
        return;
      }
      message.error(describeError(error));
    },
    [message, onUnauthorized],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.tokens();
      setTokens(response.items);
    } catch (error) {
      handleError(error);
    } finally {
      setLoading(false);
    }
  }, [handleError]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const create = async (): Promise<void> => {
    const values = await form.validateFields();
    setCreating(true);
    try {
      const token = await api.createToken(values.name);
      setCreated(token);
      form.resetFields();
      await load();
    } catch (error) {
      handleError(error);
    } finally {
      setCreating(false);
    }
  };

  /** FR-94：现取明文 → 写剪贴板（明文只在内存里过一手，不落 state、不进日志）。 */
  const copyPlaintext = async (id: number): Promise<void> => {
    try {
      const { token } = await api.revealToken(id);
      const ok = await writeClipboard(token);
      if (ok) message.success('已复制到剪贴板');
      else message.warning('浏览器不允许自动复制，请打开「显示」后手动复制');
    } catch (error) {
      handleError(error);
    }
  };

  const revoke = async (id: number): Promise<void> => {
    try {
      await api.revokeToken(id);
      message.success('已撤销（立即失效）');
      await load();
    } catch (error) {
      handleError(error);
    }
  };

  const columns: TableProps<TokenSummary>['columns'] = [
    { title: '名称', dataIndex: 'name', key: 'name', ellipsis: true, width: 200 },
    {
      title: '状态',
      key: 'state',
      width: 90,
      render: (_value, token) =>
        token.revoked_at === null ? <Tag color="green">有效</Tag> : <Tag color="default">已撤销</Tag>,
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 160,
      render: (value: string) => <Typography.Text type="secondary">{formatDateTime(value)}</Typography.Text>,
    },
    {
      title: '最近使用',
      dataIndex: 'last_used_at',
      key: 'last_used_at',
      width: 160,
      render: (value: string | null) => <Typography.Text type="secondary">{formatDateTime(value)}</Typography.Text>,
    },
    {
      title: '令牌',
      key: 'reveal',
      width: 150,
      render: (_value, token) =>
        token.revoked_at !== null ? (
          <Typography.Text type="secondary">—</Typography.Text>
        ) : token.revealable ? (
          <Button
            type="link"
            size="small"
            icon={<CopyOutlined />}
            data-testid={`pm-token-copy-${String(token.id)}`}
            onClick={() => void copyPlaintext(token.id)}
          >
            复制
          </Button>
        ) : (
          <Typography.Text
            type="secondary"
            style={{ fontSize: 12 }}
            data-testid={`pm-token-unrevealable-${String(token.id)}`}
          >
            不可查看（旧令牌，请撤销后重建）
          </Typography.Text>
        ),
    },
    {
      title: '操作',
      key: 'action',
      width: 90,
      render: (_value, token) =>
        token.revoked_at === null ? (
          <Popconfirm title="撤销这个 token？" description="撤销后立即失效。" onConfirm={() => void revoke(token.id)}>
            <Button type="link" size="small" danger>
              撤销
            </Button>
          </Popconfirm>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
  ];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      /* FR-94 新增「令牌」列（复制/不可查看）后，720 会把名称挤成 "A..." ⇒ 加宽到 880 */
      width={880}
      rootClassName="pm-tokens"
      title={
        <Space>
          <KeyOutlined />
          API 令牌
        </Space>
      }
      extra={<Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading} />}
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message="Token 与本人等价（单用户，不做权限分层）"
          description="用法：curl -H 'Authorization: Bearer <token>' …；明文加密保存在本机（可随时点「复制」再取）。"
        />

        <Form form={form} layout="inline" onFinish={() => void create()}>
          <Form.Item name="name" rules={[{ required: true, message: '给 token 起个名字' }]} style={{ flex: 1 }}>
            <Input placeholder="例如：dsh / mcp-cli" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" icon={<PlusOutlined />} loading={creating}>
              创建 token
            </Button>
          </Form.Item>
        </Form>

        <Table
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={tokens}
          loading={loading}
          pagination={false}
          locale={{ emptyText: <EmptyState title="还没有 token" hint="创建一个给 CLI 或 MCP 用；之后可随时复制" /> }}
        />
      </Space>

      <Modal
        open={created !== null}
        onCancel={() => setCreated(null)}
        onOk={() => setCreated(null)}
        okText="我已保存"
        cancelButtonProps={{ style: { display: 'none' } }}
        title="新 token"
      >
        <Flex vertical gap={12}>
          <Alert
            type="info"
            showIcon
            message="现在复制一下；之后也能在列表里点「复制」再取（明文加密存在本机）。"
          />
          <Typography.Paragraph
            copyable={{ text: created?.token ?? '', icon: [<CopyOutlined key="copy" />, <CopyOutlined key="copied" />] }}
            style={{ wordBreak: 'break-all', marginBottom: 0, fontFamily: 'monospace' }}
          >
            {created?.token ?? ''}
          </Typography.Paragraph>
        </Flex>
      </Modal>
    </Drawer>
  );
}
