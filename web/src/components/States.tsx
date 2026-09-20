import { ExclamationCircleOutlined, InboxOutlined, ReloadOutlined } from '@ant-design/icons';
import { Button, Flex, Skeleton, Typography, theme } from 'antd';

/**
 * 空态 / 加载态 / 错误态（FR-40b 第 5 条）：用本方向的 token 语言表达，
 * 不是 antd 默认的干瘪 `Empty` / 裸 `Spin`：
 * - 空态 = 一个描边图标 + 一句"这里是什么" + 一个行动按钮；
 * - 加载态 = 骨架行（保持列表的行高节奏，避免布局跳动）；
 * - 错误态 = 明确的错误文本 + 重试按钮。
 */

interface EmptyStateProps {
  title: string;
  hint: string;
  actionLabel?: string;
  onAction?: () => void;
  /** FR-59：列表"一条 prompt 都没有"时显示品牌图形（72）；有数据 / 只是筛不到 时不传 */
  withBrandIcon?: boolean;
}

export function EmptyState({ title, hint, actionLabel, onAction, withBrandIcon = false }: EmptyStateProps) {
  const { token } = theme.useToken();
  return (
    <Flex vertical align="center" gap={6} style={{ padding: '40px 16px' }}>
      {withBrandIcon ? (
        <img
          src="/promptmanager-72.png"
          width={72}
          height={72}
          alt=""
          aria-hidden="true"
          className="pm-brand-art"
          data-testid="pm-brand-art-empty"
        />
      ) : (
        <InboxOutlined style={{ fontSize: 26, color: token.colorTextQuaternary }} />
      )}
      <Typography.Text style={{ color: token.colorTextSecondary, fontWeight: 500 }}>{title}</Typography.Text>
      <Typography.Text style={{ fontSize: 12, color: token.colorTextTertiary }}>{hint}</Typography.Text>
      {actionLabel === undefined || onAction === undefined ? null : (
        <Button type="primary" size="small" style={{ marginTop: 8 }} onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </Flex>
  );
}

interface LoadingStateProps {
  rows?: number;
  label?: string;
}

export function LoadingState({ rows = 8, label = '正在读取…' }: LoadingStateProps) {
  const { token } = theme.useToken();
  return (
    <div style={{ padding: '12px 16px' }}>
      <Typography.Text style={{ fontSize: 12, color: token.colorTextTertiary }}>{label}</Typography.Text>
      <Flex vertical gap={10} style={{ marginTop: 10 }}>
        {Array.from({ length: rows }, (_, index) => (
          <Skeleton.Input key={index} active size="small" block style={{ height: 22 }} />
        ))}
      </Flex>
    </div>
  );
}

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  const { token } = theme.useToken();
  return (
    <Flex vertical align="center" gap={6} style={{ padding: '40px 16px' }}>
      <ExclamationCircleOutlined style={{ fontSize: 26, color: token.colorError }} />
      <Typography.Text style={{ color: token.colorTextSecondary, fontWeight: 500 }}>没能读到数据</Typography.Text>
      <Typography.Text style={{ fontSize: 12, color: token.colorTextTertiary }}>{message}</Typography.Text>
      {onRetry === undefined ? null : (
        <Button size="small" icon={<ReloadOutlined />} style={{ marginTop: 8 }} onClick={onRetry}>
          重试
        </Button>
      )}
    </Flex>
  );
}
