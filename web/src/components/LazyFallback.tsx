import { Flex, Spin, Typography } from 'antd';

interface LazyFallbackProps {
  /** 给用户的短说明（不暴露"分包 / chunk"这类实现词） */
  label?: string;
}

/**
 * 懒加载占位（FR-61 / AC-61 ④）：`<Suspense>` 的默认兜底。
 * 只占位不空白——小尺寸 `Spin` + 一行说明，避免首屏"闪一下空框"。
 */
export default function LazyFallback({ label = '正在加载…' }: LazyFallbackProps) {
  return (
    <Flex align="center" justify="center" gap={8} style={{ padding: 24, minHeight: 88 }}>
      <Spin size="small" />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {label}
      </Typography.Text>
    </Flex>
  );
}
