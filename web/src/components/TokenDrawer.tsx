import { CopyOutlined, EyeOutlined, KeyOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import {
  Alert,
  App as AntdApp,
  Button,
  Drawer,
  Flex,
  Form,
  Input,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { TableProps } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, describeError } from '../api';
import { writeClipboard } from '../clipboard';
import { formatDateTime } from '../pure';
import type { TokenSummary } from '../types';
import { EmptyState } from './States';

interface TokenDrawerProps {
  open: boolean;
  onClose: () => void;
  onUnauthorized: () => void;
}

/**
 * API Token 管理（FR-15 / FR-94 可查看 / FR-95 同步复制 / FR-96 硬删除 / FR-97 无创建弹窗）。
 *
 * **FR-95 为什么必须"预取 + 同步写"**：真实环境是内网 HTTP（`http://192.168.0.228:8767`）⇒
 * `window.isSecureContext === false`、浏览器的异步剪贴板 API **根本不存在** ⇒ 只能走
 * 浏览器的 `execCommand` 复制兜底；而浏览器只允许在**用户激活**（点击那一刻）内写入剪贴板。
 * ⚠️ 本文件**不得**写出异步剪贴板 API 与 `execCommand` 的字面量 —— AC-65 ③ 用 `grep` 机械核对
 * "剪贴板兜底只在 `clipboard.ts` 实现一处"。
 * 旧实现是 `await reveal(id)`（网络往返）**之后**才写 ⇒ 激活可能已过期、写入被静默拒绝（界面还显示"已复制"）。
 * 因此：**抽屉打开时预取明文到内存** → 点「复制」时**同步**写（与提示词复制路径一致）。
 *
 * **安全**：明文只存在于**本组件的 React state**（内存）——不写 localStorage/sessionStorage/URL/日志；
 * **抽屉一关就清空**（见下面 `open === false` 的 effect + Drawer 的 `destroyOnHidden`）。
 */
export default function TokenDrawer({ open, onClose, onUnauthorized }: TokenDrawerProps) {
  const { message } = AntdApp.useApp();
  const [tokens, setTokens] = useState<TokenSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  /** FR-95 ①：预取的明文（**只在内存**，抽屉关闭即清空）。 */
  const [plaintexts, setPlaintexts] = useState<Map<number, string>>(new Map());
  /** FR-95 ③：哪些行正在"显示"明文（可选中、可手动 Ctrl+C）。 */
  const [shown, setShown] = useState<Set<number>>(new Set());
  const [form] = Form.useForm<{ name: string }>();
  /** 预取失败的 id（点「复制」时给出可读原因，而不是静默失败）。 */
  const prefetchFailed = useRef<Set<number>>(new Set());

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

  /** 拉列表 + **并发预取**所有可查看行的明文（后台、不显示）。 */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.tokens();
      setTokens(response.items);
      const revealable = response.items.filter((token) => token.revealable && token.revoked_at === null);
      const failed = new Set<number>();
      const results = await Promise.all(
        revealable.map(async (token) => {
          try {
            const { token: plaintext } = await api.revealToken(token.id);
            return [token.id, plaintext] as const;
          } catch {
            failed.add(token.id);
            return null;
          }
        }),
      );
      prefetchFailed.current = failed;
      const next = new Map<number, string>();
      for (const entry of results) if (entry !== null) next.set(entry[0], entry[1]);
      setPlaintexts(next);
    } catch (error) {
      handleError(error);
    } finally {
      setLoading(false);
    }
  }, [handleError]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  /**
   * FR-95 安全约束：**抽屉关闭即清空**预取缓存与"显示"状态（明文不留在内存/DOM 里）。
   * 配合 Drawer 的 `destroyOnHidden`，关闭后页面文本里也搜不到明文。
   */
  useEffect(() => {
    if (!open) {
      setPlaintexts(new Map());
      setShown(new Set());
      prefetchFailed.current = new Set();
    }
  }, [open]);

  const create = async (): Promise<void> => {
    const values = await form.validateFields();
    setCreating(true);
    try {
      // FR-97：不再弹明文 Modal —— 提示一句 + 刷新列表（新行可直接点「复制」）
      await api.createToken(values.name);
      form.resetFields();
      message.success('已创建；点列表里的「复制」取明文');
      await load();
    } catch (error) {
      handleError(error);
    } finally {
      setCreating(false);
    }
  };

  /**
   * FR-95 ②：**同步**复制 —— 明文已在内存里，点击时**不再发任何请求**。
   * ⚠️ 这里**不能**在 writeClipboard 之前 await 任何东西（否则用户激活过期、内网 HTTP 下写不进去）。
   */
  const copyPlaintext = (id: number): void => {
    const plaintext = plaintexts.get(id);
    if (plaintext === undefined) {
      message.warning(
        prefetchFailed.current.has(id)
          ? '明文未能读取（加密密钥不可用？）—— 请点「显示」查看，或撤销后重建'
          : '明文还在读取中，请稍候再点「复制」',
      );
      return;
    }
    void writeClipboard(plaintext).then((ok) => {
      if (ok) message.success('已复制到剪贴板');
      else message.warning('浏览器不允许自动复制：点「显示」后手动选中复制（Ctrl/Cmd+C）');
    });
  };

  const toggleShown = (id: number): void => {
    setShown((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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

  /** FR-96：硬删除（仅已撤销行；**真删行、审计一并消失**）。 */
  const removePermanently = async (id: number): Promise<void> => {
    try {
      await api.deleteTokenPermanently(id);
      message.success('已永久删除');
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
      width: 150,
      render: (value: string) => <Typography.Text type="secondary">{formatDateTime(value)}</Typography.Text>,
    },
    {
      title: '最近使用',
      dataIndex: 'last_used_at',
      key: 'last_used_at',
      width: 150,
      render: (value: string | null) => <Typography.Text type="secondary">{formatDateTime(value)}</Typography.Text>,
    },
    {
      title: '令牌',
      key: 'reveal',
      width: 250,
      render: (_value, token) => {
        if (token.revoked_at !== null) return <Typography.Text type="secondary">—</Typography.Text>;
        if (!token.revealable) {
          return (
            <Typography.Text
              type="secondary"
              style={{ fontSize: 12 }}
              data-testid={`pm-token-unrevealable-${String(token.id)}`}
            >
              不可查看（旧令牌，请撤销后重建）
            </Typography.Text>
          );
        }
        const plaintext = plaintexts.get(token.id);
        return (
          <Flex
            vertical
            gap={4}
            style={{ minWidth: 0 }}
            /* 预取是否就绪（AC 探针用它做确定性等待；对用户不可见） */
            data-prefetched={plaintext === undefined ? '0' : '1'}
          >
            <Space size={2}>
              <Button
                type="link"
                size="small"
                icon={<CopyOutlined />}
                data-testid={`pm-token-copy-${String(token.id)}`}
                onClick={() => copyPlaintext(token.id)}
              >
                复制
              </Button>
              {/* FR-95 ③：真正的「显示」入口 —— 剪贴板仍失败时的兜底（明文可选中、手动 Ctrl+C） */}
              <Button
                type="link"
                size="small"
                icon={<EyeOutlined />}
                data-testid={`pm-token-show-${String(token.id)}`}
                onClick={() => toggleShown(token.id)}
              >
                {shown.has(token.id) ? '隐藏' : '显示'}
              </Button>
            </Space>
            {shown.has(token.id) && (
              /* ⚠️ antd 6 的 Typography 默认 `user-select: none` 且已无 `selectable` prop ⇒
                 这里用原生文本元素 + 显式 `userSelect: 'text'`，保证明文**可选中、可手动 Ctrl+C**（FR-95 ③）。 */
              <span
                className="pm-mono"
                data-testid={`pm-token-plaintext-${String(token.id)}`}
                style={{ fontSize: 11, wordBreak: 'break-all', userSelect: 'text', padding: '2px 4px', background: 'var(--pm-surface-2, rgba(0,0,0,0.04))', borderRadius: 4 }}
              >
                {plaintext ?? '（明文读取中…）'}
              </span>
            )}
          </Flex>
        );
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 150,
      render: (_value, token) =>
        token.revoked_at === null ? (
          <Popconfirm title="撤销这个 token？" description="撤销后立即失效。" onConfirm={() => void revoke(token.id)}>
            <Button type="link" size="small" danger data-testid={`pm-token-revoke-${String(token.id)}`}>
              撤销
            </Button>
          </Popconfirm>
        ) : (
          // FR-96：只有**已撤销**的行才有「删除」（真删行、不可恢复）
          <Popconfirm
            title="永久删除这个 token？"
            description="永久删除、不可恢复：整行会被真删（审计记录一并消失）。"
            okText="永久删除"
            okButtonProps={{ danger: true }}
            onConfirm={() => void removePermanently(token.id)}
          >
            <Button type="link" size="small" danger data-testid={`pm-token-delete-${String(token.id)}`}>
              删除
            </Button>
          </Popconfirm>
        ),
    },
  ];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      /* FR-95 ⑤：关闭即卸载内容 ⇒ 页面文本里不再残留明文（配合上面的清缓存 effect） */
      destroyOnHidden
      /* FR-94 新增「令牌」列后，720 会把名称挤成 "A..." ⇒ 880 */
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
          description="用法：curl -H 'Authorization: Bearer <token>' …；明文加密保存在本机，点列表里的「复制」即可取用；若浏览器拦截自动复制，点「显示」后可手动选中复制。"
        />

        <Form form={form} layout="inline" onFinish={() => void create()}>
          <Form.Item name="name" rules={[{ required: true, message: '给 token 起个名字' }]} style={{ flex: 1 }}>
            <Input placeholder="例如：dsh / mcp-cli" data-testid="pm-token-name" />
          </Form.Item>
          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              icon={<PlusOutlined />}
              loading={creating}
              data-testid="pm-token-create"
            >
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
    </Drawer>
  );
}
