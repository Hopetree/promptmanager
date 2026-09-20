import { TagsOutlined } from '@ant-design/icons';
import { Card, Flex, Space, Typography } from 'antd';
import type { Tag } from '../types';

interface TagPanelProps {
  tags: Tag[];
  selected: string | null;
  onSelect: (name: string | null) => void;
}

/**
 * 标签筛选（FR-50 / D-24）：**胶囊云**（参考 PromptHub）——
 * 浅灰底圆角胶囊 + `#` 前缀 + 深灰字，`flex-wrap` 流式换行；标题行右侧显示 `全部 N`。
 * **不显示任何计数**（徽标/数字），需要时只用 `title` tooltip；**不提供增删改**（标签随 prompt 编辑产生/清理）。
 * 锚点：容器 `pm-tag-cloud`、每个胶囊 `pm-tag-chip`。
 */
export default function TagPanel({ tags, selected, onSelect }: TagPanelProps) {
  return (
    <Card
      size="small"
      title={
        <Space size={4}>
          <TagsOutlined />
          标签
        </Space>
      }
      extra={
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          全部 {tags.length}
        </Typography.Text>
      }
      styles={{ body: { padding: 8 } }}
    >
      {tags.length === 0 ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          还没有标签
        </Typography.Text>
      ) : (
        <Flex wrap gap={6} data-testid="pm-tag-cloud">
          {tags.map((tag) => {
            const active = tag.name === selected;
            return (
              <span
                key={tag.name}
                data-testid="pm-tag-chip"
                data-selected={active ? 'true' : 'false'}
                className={active ? 'pm-tag-chip pm-tag-chip-active' : 'pm-tag-chip'}
                title={`${tag.name}（${String(tag.count)} 条）`}
                onClick={() => onSelect(active ? null : tag.name)}
              >
                #{tag.name}
              </span>
            );
          })}
        </Flex>
      )}
    </Card>
  );
}
