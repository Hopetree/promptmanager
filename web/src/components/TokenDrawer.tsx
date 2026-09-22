import { CopyOutlined, KeyOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import {
  Alert,
  App as AntdApp,
  Button,
  Drawer,
  Dropdown,
  Flex,
  Form,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { TableProps } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, describeError } from '../api';
import { writeClipboard } from '../clipboard';
import { formatDateTime, maskToken, truncateTokenName } from '../pure';
import type { TokenSummary } from '../types';
import { EmptyState } from './States';

/**
 * FR-107：**列宽下限来自列定义**，`scroll.x` 由它们**求和得出**（不再手写数值）。
 *
 * 为什么要有这几个常量（阶段 44 的教训）：当时 `<Table>` 上写的是硬编码 `scroll={{ x: 419 }}`，
 * 那个值**小于 6 列的实际需求**（实测 `scrollWidth 457`）⇒ `tableLayout: fixed` 下前五列的定宽分完就没有剩余，
 * **唯一没有 `width` 的「名称」列被算成 0 宽**（390 下 `left = right = 20`，表头第一列直接从「Token」开始）。
 * 改成"每列一个 `minWidth`，`x` = 它们之和"之后：**改列宽时 `x` 自动跟着变**，
 * 从根上消灭"硬编码小于实际需求"这一类 bug（D-45 ②）。
 */
const TOKEN_NAME_MIN_WIDTH = 60;
const TOKEN_MASK_MIN_WIDTH = 104;
const TOKEN_STATE_MIN_WIDTH = 104;
const TOKEN_USE_MIN_WIDTH = 76;
const TOKEN_LAST_USED_MIN_WIDTH = 123;
const TOKEN_ACTION_MIN_WIDTH = 50;

/**
 * `scroll.x` = 各列最小宽度之和。宽度**够**时（桌面 640 / 容器 600）`min-width: 100%` 让表格撑满容器 ⇒ 无横滚；
 * 宽度**不够**时（手机 390 / 容器 350）表格按这个总宽铺开 ⇒ 溢出并可横向滚动，且每列都 ≥ 自己的 `minWidth`。
 */
const TOKEN_TABLE_MIN_WIDTH =
  TOKEN_NAME_MIN_WIDTH +
  TOKEN_MASK_MIN_WIDTH +
  TOKEN_STATE_MIN_WIDTH +
  TOKEN_USE_MIN_WIDTH +
  TOKEN_LAST_USED_MIN_WIDTH +
  TOKEN_ACTION_MIN_WIDTH;

/**
 * FR-100 ③：**真不可恢复**（`revealable === false`，即迁移前创建、当时未存密文）时 `—` 的悬停说明。
 * 只说事实与出路（重建），不写成"加载失败"那样的误导文案。
 */
const UNREVEALABLE_HINT = '迁移前创建的令牌没有保存可恢复的密文，无法查看；可撤销后重建';

interface TokenDrawerProps {
  open: boolean;
  onClose: () => void;
  onUnauthorized: () => void;
  /**
   * FR-106：是否移动端（与 `SplitView` 同款断点，由 `Workspace` 下发）。
   * 移动端的抽屉被夹到视口宽（390）⇒ 创建表单必须**竖排**，否则「名称」被权限选择 + 按钮挤到只剩 ~80px。
   */
  isMobile?: boolean;
}

/**
 * API Token 管理（FR-15 / FR-94 可查看 / FR-95 同步复制 / FR-96 硬删除 / FR-97 无创建弹窗 / **FR-99 固定 6 列** /
 * **FR-100 撤销行也显示值并可复制**）。
 *
 * **FR-103（v53）令牌权限两档**：新建时可选 `只读 / 读写`（**默认只读**）；列表**不新增列** ——
 * 「状态」列显示成 `有效 · 只读` / `有效 · 读写`（已撤销同理）。权限**只作用于资源**：
 * 只读可检索 / 查看 / 渲染；读写还能新建、修改、删除。
 *
 * **FR-105（v54）权限可改**：**有效行**的「状态」列权限文本**可点击**（`Dropdown` 两项：只读 / 读写）
 * → 选中后调 `PATCH /api/tokens/:id`，用返回的摘要**只更新那一行**（立即生效、不重载页面）。
 * **已撤销行不给入口**（与"已撤销只能删除"一致）；**仍然 6 列、无横向滚动**。
 * ⚠️ 服务端把 `/api/tokens*` 整段归为"仅会话"⇒ 只有浏览器会话能改权限（防令牌自我提权）。
 *
 * **FR-106（v55）移动端可用性**：抽屉在手机上被夹到视口宽（≈390）⇒ 6 列必然放不下。
 * ① 表格加 **`scroll={{ x: TOKEN_TABLE_MIN_WIDTH }}`**（**由各列 `minWidth` 求和得出**，见文件顶部常量区）——
 *    这是**根因级**修法：antd 只有拿到 `scroll.x` 才渲染可滚动容器，
 *    否则内容溢出表格外、`scrollLeft` 推不动（实测 390 下 `scrollWidth 457 > clientWidth 350` 而滚动量恒为 0，
 *    最右列右边缘 477 > 390 ⇒ 两端列都够不着）；
 * ② `isMobile` 时创建表单 `layout="vertical"`（名称独占一行，不再被 108px 权限选择 + 按钮挤成 ~80px）；
 * ③ Alert 描述去掉了那对 `**`（Alert 不渲染 Markdown，星号会原样显示）。
 * 桌面 640 内 6 列刚好放得下 ⇒ **不出现**横向滚动条（AC-108 ⑤ 用 `scrollWidth === clientWidth` 钉住）。
 *
 * **FR-100（v50）撤销 ≠ 销毁**：撤销只是"立即失效"，密文仍在库里（`revealable` 仍为 true）⇒
 * **已撤销行照常预取明文**：Token 列显示掩码、「使用」列给「复制」（与未撤销行完全一致）。
 * 用户理由："撤销的 token 可能还在别处用着，需要核对值"。
 *
 * **FR-99（v49，用户推翻 FR-98 的折叠方案）**：**固定 6 列、没有折叠** ——
 * `名称 / Token / 状态 / 使用 / 最近使用 / 操作`；行展开（箭头 / `expandedRowRender` / 相关 testid）**全部移除**。
 * - **名称**：显示**前 20 个字符**，超出加省略号；**完整名称进单元格 `title`**（悬停看全）；
 * - **Token**：**脱敏** = 前 5 + `...` + 后 4（如 `pm_96...7LU8`），数据来自抽屉打开时**预取到内存的明文**；
 *   取不到明文的行（`revealable=false` 的旧令牌 / 已撤销行）显示 `—`；**页面上不出现完整明文**；
 * - **宽度**：抽屉 **620**、**无横向滚动**（名称按**字符**截断，不靠列宽自由收缩）。

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
export default function TokenDrawer({ open, onClose, onUnauthorized, isMobile = false }: TokenDrawerProps) {
  const { message } = AntdApp.useApp();
  const [tokens, setTokens] = useState<TokenSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  /** FR-95 ①：预取的明文（**只在内存**，抽屉关闭即清空）。 */
  const [plaintexts, setPlaintexts] = useState<Map<number, string>>(new Map());
  const [form] = Form.useForm<{ name: string; scope: 'read' | 'write' }>();
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
      /**
       * FR-100：**去掉 `revoked_at === null`** —— 已撤销的行也要预取明文（撤销 ≠ 销毁，值仍留库、仍需核对）。
       * 只按 `revealable` 过滤：迁移前创建、没存密文的旧 token 本来就取不到，不浪费请求。
       */
      const revealable = response.items.filter((token) => token.revealable);
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
   * FR-95 安全约束：**抽屉关闭即清空**预取缓存（明文不留在内存/DOM 里）。
   * 配合 Drawer 的 `destroyOnHidden`，关闭后页面文本里也搜不到明文。
   */
  useEffect(() => {
    if (!open) {
      setPlaintexts(new Map());
      prefetchFailed.current = new Set();
    }
  }, [open]);

  const create = async (): Promise<void> => {
    const values = await form.validateFields();
    // FR-103：权限缺省 read（表单初始值就是 read，用户不动就是只读）
    setCreating(true);
    try {
      // FR-97：不再弹明文 Modal —— 提示一句 + 刷新列表（新行可直接点「复制」）
      await api.createToken(values.name, values.scope);
      form.resetFields();
      // 文案保持不变（既有 AC-97/AC-99/AC-101 断言钉住它）；新建的权限在「状态」列立即可见
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
          ? '明文未能读取（加密密钥不可用？）—— 请撤销后重建，或用命令行 `pm token reveal <id>` 取明文'
          : '明文还在读取中，请稍候再点「复制」',
      );
      return;
    }
    void writeClipboard(plaintext).then((ok) => {
      if (ok) message.success('已复制到剪贴板');
      // FR-99：UI 已无「显示」入口 ⇒ 文案必须指向**真实存在**的路径（重试 / 命令行）
      else message.warning(`浏览器不允许自动复制：请重试，或用命令行 \`pm token reveal ${String(id)}\` 取明文`);
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

  /**
   * FR-105：改权限（只读 ↔ 读写）。**立即生效**（服务端不缓存权限）。
   *
   * 为什么只 `setTokens` 改那一行、**不调用 `load()`**：
   * ① 需求要"该行状态文本立即更新（不刷新页面）"—— 整表重拉会让所有行的掩码/复制按钮闪一下；
   * ② `load()` 会**重新预取全部明文**（N 次 reveal 请求），改一次权限不该有那个副作用。
   * 服务端返回的就是更新后的摘要，直接替换该行即可。
   */
  const changeScope = async (id: number, scope: 'read' | 'write'): Promise<void> => {
    try {
      const updated = await api.setTokenScope(id, scope);
      setTokens((previous) => previous.map((token) => (token.id === id ? { ...token, scope: updated.scope } : token)));
      message.success(updated.scope === 'write' ? '已改为读写（立即生效）' : '已改为只读（立即生效）');
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
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      /**
       * FR-107 ①（阶段 44 的漏网修复）：名称列是唯一**没有 `width`** 的列 ⇒ 它是被"挤"的那一列。
       * ⚠️ 阶段 44 这里写的是 `minWidth: 0`，再配上硬编码的 `scroll={{ x: 419 }}`（小于 6 列实际需求）
       * ⇒ antd 在 `tableLayout: fixed` 下分配完前五列的定宽后**已经没有剩余**，把本列算成了 **0 宽**
       * （实测 390 下 `left = right = 20`、表头第一列直接从「Token」开始 —— 用户看到的就是"少了一列数据"）。
       * 现在给它一个**可读下限 60px**（约 3 个汉字 + 省略号），并让 `scroll.x` 由各列 `minWidth` 求和得出
       * （见 `TOKEN_TABLE_MIN_WIDTH`）⇒ 任何容器宽度下它都不会被压到 0。
       */
      minWidth: TOKEN_NAME_MIN_WIDTH,
      // FR-99 ②：显示前 20 字符 + 省略号；**完整名称进 `title`**（悬停看全）
      onCell: (token) => ({ title: token.name }),
      render: (value: string, token) => (
        <span
          style={{ display: 'inline-block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          data-testid={`pm-token-name-${String(token.id)}`}
        >
          {truncateTokenName(value)}
        </span>
      ),
    },
    {
      title: 'Token',
      key: 'masked',
      minWidth: TOKEN_MASK_MIN_WIDTH,
      /**
       * FR-99 ④ + FR-100：脱敏展示（前 5 + ... + 后 4）——**已撤销行同样显示掩码**。
       * 只有"真的取不到密文"（`revealable === false`：迁移前创建、未存密文的旧 token）才给 `—`，
       * 并带上 `title` **说明原因**（FR-100 ③：不留白、不误导成"加载失败"）。
       */
      render: (_value, token) => {
        const plaintext = plaintexts.get(token.id);
        if (plaintext === undefined) {
          return (
            <Typography.Text
              type="secondary"
              data-testid={`pm-token-mask-${String(token.id)}`}
              title={UNREVEALABLE_HINT}
            >
              —
            </Typography.Text>
          );
        }
        return (
          <Typography.Text
            className="pm-mono"
            data-testid={`pm-token-mask-${String(token.id)}`}
            style={{ fontSize: 12 }}
          >
            {maskToken(plaintext)}
          </Typography.Text>
        );
      },
    },
    {
      title: '状态',
      key: 'state',
      minWidth: TOKEN_STATE_MIN_WIDTH,
      // FR-103：**不新增列** —— 权限并进「状态」列（`有效 · 只读` / `有效 · 读写` / 已撤销同理）
      // FR-105：**有效行**的这段权限文本**可点击**（真鼠标点 → 弹 只读/读写 两项菜单 → 选完该行立即变），
      //         仍然**不新增列**；**已撤销行保持纯文本**（撤销行只保留历史记录，只能删除，不提供改权限入口）。
      render: (_value, token) => {
        const scopeText = token.scope === 'write' ? '读写' : '只读';
        if (token.revoked_at !== null) {
          return (
            <Tag color="default" data-testid={`pm-token-state-${String(token.id)}`}>
              已撤销 · {scopeText}
            </Tag>
          );
        }
        return (
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'read', label: '只读' },
                { key: 'write', label: '读写' },
              ],
              selectable: true,
              selectedKeys: [token.scope],
              onClick: ({ key }) => void changeScope(token.id, key as 'read' | 'write'),
            }}
          >
            <Tag
              color="green"
              /* 指针变手型 + 悬停提示（AC-107 ⑥ 的可见入口） */
              style={{ cursor: 'pointer' }}
              title="点击切换：只读 ↔ 读写"
              data-testid={`pm-token-state-${String(token.id)}`}
              data-scope-editable="1"
            >
              有效 · {scopeText}
            </Tag>
          </Dropdown>
        );
      },
    },
    {
      title: '使用',
      key: 'use',
      minWidth: TOKEN_USE_MIN_WIDTH,
      render: (_value, token) => {
        /**
         * FR-100 ②：判断**只看 `revealable`**（不再看 `revoked_at`）——撤销行也有「复制」，
         * 行为与未撤销行**完全一致**（点击同步写剪贴板、点击不发请求）。
         * 真正没有密文的旧 token ⇒ `—` + `title` 说明原因（与 Token 列口径一致）。
         */
        if (!token.revealable) {
          return (
            <Typography.Text type="secondary" data-testid={`pm-token-use-${String(token.id)}`} title={UNREVEALABLE_HINT}>
              —
            </Typography.Text>
          );
        }
        const plaintext = plaintexts.get(token.id);
        return (
          <Button
            type="link"
            size="small"
            icon={<CopyOutlined />}
            style={{ padding: 0 }}
            data-testid={`pm-token-copy-${String(token.id)}`}
            data-prefetched={plaintext === undefined ? '0' : '1'}
            onClick={() => copyPlaintext(token.id)}
          >
            复制
          </Button>
        );
      },
    },
    {
      title: '最近使用',
      dataIndex: 'last_used_at',
      key: 'last_used_at',
      minWidth: TOKEN_LAST_USED_MIN_WIDTH,
      render: (value: string | null) => (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {formatDateTime(value)}
        </Typography.Text>
      ),
    },
    {
      title: '操作',
      key: 'action',
      minWidth: TOKEN_ACTION_MIN_WIDTH,
      render: (_value, token) =>
        token.revoked_at === null ? (
          <Popconfirm title="撤销这个 token？" description="撤销后立即失效。" onConfirm={() => void revoke(token.id)}>
            <Button type="link" size="small" danger style={{ padding: 0 }} data-testid={`pm-token-revoke-${String(token.id)}`}>
              撤销
            </Button>
          </Popconfirm>
        ) : (
          /* FR-96/FR-99：只有**已撤销**的行才有「删除」（真删行、不可恢复） */
          <Popconfirm
            title="永久删除这个 token？"
            description="永久删除、不可恢复：整行会被真删（审计记录一并消失）。"
            okText="永久删除"
            okButtonProps={{ danger: true }}
            onConfirm={() => void removePermanently(token.id)}
          >
            <Button type="link" size="small" danger style={{ padding: 0 }} data-testid={`pm-token-delete-${String(token.id)}`}>
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
      /* FR-99：6 列（名称/Token/状态/使用/最近使用/操作）在 640 内不横向滚动（判据见 AC-101 ⑦） */
      width={640}
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
          description="用法：curl -H 'Authorization: Bearer <token>' …；明文加密保存在本机，点列表里的「复制」即可取用（列表里只显示脱敏预览）；若浏览器拦截自动复制，可用命令行 `pm token reveal <id>` 取明文。权限：只读可搜索 / 查看 / 渲染，读写还能新建、修改、删除；有效令牌的权限可点「状态」列直接切换（立即生效，不用重建令牌）；令牌管理与改口令只能用界面会话。"
        />

        {/*
          * FR-106 ②：移动端抽屉只有 ~390 宽 ⇒ `layout="inline"` 会把「名称」挤成 ~80px（显示成「例如：…」）。
          * 移动端改 **vertical**：名称独占一行（可用宽度 = 整行 ≈ 350），权限 + 按钮自动折到下一行。
          * 桌面保持 `inline`（一行三件，一字不改）。
          */}
        <Form form={form} layout={isMobile ? 'vertical' : 'inline'} onFinish={() => void create()}>
          <Form.Item
            name="name"
            rules={[{ required: true, message: '给 token 起个名字' }]}
            /* 桌面：名称吃掉剩余宽度；移动端：独占一行（width 100% 由 vertical 布局给出） */
            style={isMobile ? undefined : { flex: 1 }}
          >
            <Input placeholder="例如：dsh / mcp-cli" data-testid="pm-token-name" />
          </Form.Item>
          <Form.Item
            name="scope"
            initialValue="read"
            rules={[{ required: true }]}
            tooltip="只读：可搜索 / 查看 / 渲染；读写：还能新建、修改、删除"
          >
            <Select
              style={{ width: 108 }}
              data-testid="pm-token-scope"
              options={[
                { value: 'read', label: '只读' },
                { value: 'write', label: '读写' },
              ]}
            />
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
          /**
           * FR-106 ①（**根因**）：必须给 `scroll.x`，antd 才会渲染 `.ant-table-content` 这个**可滚动容器**。
           * 不给的话窄容器里内容直接溢出到表格外（390 下 `scrollWidth 457` 而 `scrollLeft` 推不动）⇒ 两端列都够不着。
           *
           * ⚠️ 这里**刻意不用 `'max-content'`**（虽然 BRIEF 的 D-44 提了它，但它会把桌面改坏）：
           * `'max-content'` 会往表格元素写 `width: max-content`，而它是"内容不换行时的理想宽度"，
           * **不吃**单元格里的 `maxWidth: 100%` / `text-overflow: ellipsis`（那两个只在宽度已被外部限定时才裁剪）。
           * 结果：最长的那个名字（21 个汉字的夹具名）把名称列撑到 **257px** ⇒ 表格宽 **714 > 抽屉 600**
           * ⇒ **1600×900 下冒出横滚条、最右列被推出抽屉**（实测 `scrollWidth 714 / clientWidth 600`）。
           *
           * ⚠️ **FR-107（本阶段）修的正是这里的"硬编码数值"**：阶段 44 写的是 `x: 419`，它**小于 6 列的实际需求**
           * ⇒ `tableLayout: fixed` 下前五列的定宽分完已无剩余，**唯一没有 `width` 的「名称」列被算成 0 宽**
           * （390 下实测 `left = right = 20`，表头第一列直接从「Token」开始 ⇒ 用户看到"少了一列数据"）。
           * 现在改成 **`TOKEN_TABLE_MIN_WIDTH` = 各列 `minWidth` 之和**（见文件顶部常量区），于是：
           *   · **宽容器（桌面 640 / 容器 600）**：总宽 517 < 600 ⇒ `min-width: 100%` 让它撑满 ⇒ 表宽 = 600、
           *     **无横滚**，名称列自动吃掉剩余 **143px**（与加 `scroll.x` 之前逐像素一致）；
           *   · **窄容器（手机 390 / 容器 350）**：总宽 517 > 350 ⇒ **溢出并可横滚**，且**每列都 ≥ 自己的 `minWidth`**
           *     （名称列 60px 的下限就来自列定义，不会再被压成 0）。
           * 关键差异：**这个值不是手写的，是列定义推导出来的** —— 以后改任何一列的宽度，`x` 自动跟着变
           * （D-45 ② 要求的"禁止硬编码小于实际需求的 scroll.x"，用类型/结构而不是注释来保证）。
           *
           * `tableLayout="fixed"` 仍然必需：它让上面的列宽真正生效，
           * 而不是被 antd 按内容重新分配把「最近使用」挤到 ~73px 导致时间被裁。
           */
          scroll={{ x: TOKEN_TABLE_MIN_WIDTH }}
          tableLayout="fixed"
          locale={{ emptyText: <EmptyState title="还没有 token" hint="创建一个给 CLI 或 MCP 用；之后可随时复制" /> }}
        />
      </Space>
    </Drawer>
  );
}
