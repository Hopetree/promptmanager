import {
  CopyOutlined,
  DownOutlined,
  EyeOutlined,
  KeyOutlined,
  PlusOutlined,
  ReloadOutlined,
  RightOutlined,
} from '@ant-design/icons';
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
import type { ReactNode } from 'react';
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
 * API Token 管理（FR-15 / FR-94 可查看 / FR-95 同步复制 / FR-96 硬删除 / FR-97 无创建弹窗 / FR-98 折叠排版）。
 *
 * **FR-98 折叠排版**：折叠态只留 4 列（`名称 / 状态 / 创建时间 / 使用`），把 `最近使用` 与 `操作` 折叠进**行展开区**
 * （连同明文）。动因：改前 6 列固定宽合计 **990px** 而抽屉只有 880 ⇒ 表格 `scrollWidth(990) > clientWidth(840)`，
 * 用户必须横向滑动才能看全。抽屉收窄到 **620** 后必须**无横向滚动**，名称列靠**换行**保证完整显示（不再 `ellipsis`）。
 * ⚠️ **每行都必须能展开**（antd 行展开箭头）：已撤销行没有「显示」按钮，只能靠箭头到达「删除」。

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
  /**
   * FR-98：哪些行**处于展开态**（行展开区里放 明文 + 最近使用 + 操作）。
   * 两个入口都改这一个状态：「显示」按钮（FR-95 语义不变：点它就能看到明文）与 antd 的行展开箭头。
   */
  const [expanded, setExpanded] = useState<number[]>([]);
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
      setExpanded([]);
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

  /** FR-98：「显示」= **展开该行**（同一个展开状态；再点一次收起）。 */
  const toggleExpanded = (id: number): void => {
    setExpanded((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
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
    // 折叠态只留 4 列（FR-98）：名称**不设固定宽 + 不 ellipsis**（换行显示完整名称，避免出现 "A…"）
    { title: '名称', dataIndex: 'name', key: 'name', render: (value: string, token) => (
        <span data-testid={`pm-token-name-${String(token.id)}`}>{value}</span>
      ) },
    {
      title: '状态',
      key: 'state',
      width: 84,
      render: (_value, token) =>
        token.revoked_at === null ? <Tag color="green">有效</Tag> : <Tag color="default">已撤销</Tag>,
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 132,
      render: (value: string) => <Typography.Text type="secondary">{formatDateTime(value)}</Typography.Text>,
    },
    {
      title: '使用',
      key: 'use',
      width: 150,
      render: (_value, token) => {
        // 已撤销 / 不可查看 ⇒ 该列给 `—`（保持既有语义）；展开区里再给相应操作
        if (token.revoked_at !== null || !token.revealable) {
          return <Typography.Text type="secondary">—</Typography.Text>;
        }
        const plaintext = plaintexts.get(token.id);
        return (
          <Space
            size={2}
            /* 预取是否就绪（AC 探针用它做确定性等待；对用户不可见） */
            data-prefetched={plaintext === undefined ? '0' : '1'}
          >
            <Button
              type="link"
              size="small"
              icon={<CopyOutlined />}
              data-testid={`pm-token-copy-${String(token.id)}`}
              onClick={() => copyPlaintext(token.id)}
            >
              复制
            </Button>
            <Button
              type="link"
              size="small"
              icon={<EyeOutlined />}
              data-testid={`pm-token-show-${String(token.id)}`}
              onClick={() => toggleExpanded(token.id)}
            >
              {expanded.includes(token.id) ? '收起' : '显示'}
            </Button>
          </Space>
        );
      },
    },
  ];

  /**
   * FR-98 展开区（三块）：① 明文（可选中，FR-95 语义不变）② 最近使用 ③ 操作（有效→撤销；已撤销→删除）。
   * 已撤销行没有「显示」按钮 ⇒ 靠**行展开箭头**进来，这样「删除」才可达。
   */
  const renderDetails = (token: TokenSummary): ReactNode => {
    const plaintext = plaintexts.get(token.id);
    return (
      <Flex vertical gap={8} data-testid={`pm-token-details-${String(token.id)}`}>
        {token.revoked_at === null && token.revealable && (
          <Flex gap={6} align="baseline" wrap>
            <Typography.Text type="secondary" style={{ whiteSpace: 'nowrap' }}>
              明文：
            </Typography.Text>
            {/* 可选中、可手动 Ctrl/Cmd+C（FR-95 ③；antd 6 的 Typography 默认 user-select:none） */}
            <span
              className="pm-mono"
              data-testid={`pm-token-plaintext-${String(token.id)}`}
              style={{
                fontSize: 12,
                wordBreak: 'break-all',
                userSelect: 'text',
                padding: '2px 6px',
                background: 'var(--pm-surface-2, rgba(0,0,0,0.04))',
                borderRadius: 4,
                flex: 1,
                minWidth: 0,
              }}
            >
              {plaintext ?? '（明文读取中…）'}
            </span>
          </Flex>
        )}
        {token.revoked_at === null && !token.revealable && (
          <Typography.Text type="secondary" data-testid={`pm-token-unrevealable-${String(token.id)}`}>
            不可查看（旧令牌，请撤销后重建）
          </Typography.Text>
        )}
        <Flex gap={6} align="baseline">
          <Typography.Text type="secondary" style={{ whiteSpace: 'nowrap' }}>
            最近使用：
          </Typography.Text>
          <Typography.Text type="secondary" data-testid={`pm-token-lastused-${String(token.id)}`}>
            {formatDateTime(token.last_used_at)}
          </Typography.Text>
        </Flex>
        <Space size={4}>
          {token.revoked_at === null ? (
            <Popconfirm title="撤销这个 token？" description="撤销后立即失效。" onConfirm={() => void revoke(token.id)}>
              <Button size="small" danger data-testid={`pm-token-revoke-${String(token.id)}`}>
                撤销
              </Button>
            </Popconfirm>
          ) : (
            /* FR-96：只有**已撤销**的行才有「删除」（真删行、不可恢复） */
            <Popconfirm
              title="永久删除这个 token？"
              description="永久删除、不可恢复：整行会被真删（审计记录一并消失）。"
              okText="永久删除"
              okButtonProps={{ danger: true }}
              onConfirm={() => void removePermanently(token.id)}
            >
              <Button size="small" danger data-testid={`pm-token-delete-${String(token.id)}`}>
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      </Flex>
    );
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      /* FR-95 ⑤：关闭即卸载内容 ⇒ 页面文本里不再残留明文（配合上面的清缓存 effect） */
      destroyOnHidden
      /* FR-98：折叠掉「最近使用 / 令牌 / 操作」三列后，620 就够（改前 880 仍要横向滑动） */
      width={620}
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
          /* 不设 scroll.x：让表格自适应容器宽度（FR-98 的目标是**没有横向滚动**） */
          expandable={{
            expandedRowKeys: expanded,
            onExpandedRowsChange: (keys) => setExpanded(keys.map((key) => Number(key))),
            /**
             * ⚠️ 收起时**不放内容**：rc-table 会把最后一行展开区留在 DOM 里（`display:none`，视觉上已消失），
             * 但明文会因此**留在 DOM 中**直到关抽屉。这里显式按展开态返回 null ⇒ 一收起明文就离开 DOM，
             * 只依赖"关抽屉即清"就不够干净了（AC-100 ⑥/⑦）。
             */
            expandedRowRender: (token) => (expanded.includes(token.id) ? renderDetails(token) : null),
            /* 每行都能展开（含已撤销行）——「删除」可达的前提 */
            rowExpandable: () => true,
            expandIcon: ({ expanded: isExpanded, onExpand, expandable, record }) =>
              expandable ? (
                <Button
                  type="text"
                  size="small"
                  aria-label={isExpanded ? '收起' : '展开'}
                  data-testid={`pm-token-expand-${String((record as TokenSummary).id)}`}
                  icon={isExpanded ? <DownOutlined /> : <RightOutlined />}
                  onClick={(event) => onExpand(record, event)}
                />
              ) : null,
          }}
          locale={{ emptyText: <EmptyState title="还没有 token" hint="创建一个给 CLI 或 MCP 用；之后可随时复制" /> }}
        />
      </Space>
    </Drawer>
  );
}
