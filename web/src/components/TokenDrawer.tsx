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
import { formatDateTime } from '../pure';
import type { CreatedToken, TokenSummary } from '../types';
import { EmptyState } from './States';

interface TokenDrawerProps {
  open: boolean;
  onClose: () => void;
  onUnauthorized: () => void;
}

/** API Token 管理（FR-15）：浏览器用 cookie 会话管理；**明文只在创建时显示一次**。 */
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
    { title: '名称', dataIndex: 'name', key: 'name', ellipsis: true },
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
      width={720}
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
          description="用法：curl -H 'Authorization: Bearer <token>' …；明文只在创建时显示一次，库里只存 sha256。"
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
          locale={{ emptyText: <EmptyState title="还没有 token" hint="创建一个给 CLI 或 MCP 用；明文只显示一次" /> }}
        />
      </Space>

      <Modal
        open={created !== null}
        onCancel={() => setCreated(null)}
        onOk={() => setCreated(null)}
        okText="我已保存"
        cancelButtonProps={{ style: { display: 'none' } }}
        title="新 token（只显示这一次）"
      >
        <Flex vertical gap={12}>
          <Alert type="warning" showIcon message="关闭后无法再看到明文，请立刻复制保存。" />
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
