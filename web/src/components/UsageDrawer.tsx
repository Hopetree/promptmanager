import { BarChartOutlined, ReloadOutlined } from '@ant-design/icons';
import { Button, Descriptions, Drawer, Flex, Select, Space, Spin, Statistic, Table, Tag, Typography } from 'antd';
import type { TableProps } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, describeError } from '../api';
import { formatDateTime } from '../pure';
import type { UsageSummary } from '../types';
import { EmptyState, ErrorState, LoadingState } from './States';

interface UsageDrawerProps {
  open: boolean;
  onClose: () => void;
  onUnauthorized: () => void;
}

/** 使用记录（FR-19）：`GET /api/usage/summary?days=N` —— 回答"这个库到底有没有被用出去"。 */
export default function UsageDrawer({ open, onClose, onUnauthorized }: UsageDrawerProps) {
  const [days, setDays] = useState(30);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSummary(await api.usageSummary(days));
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        onUnauthorized();
        return;
      }
      setError(describeError(caught));
    } finally {
      setLoading(false);
    }
  }, [days, onUnauthorized]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const columns: TableProps<UsageSummary['top'][number]>['columns'] = [
    { title: 'prompt', dataIndex: 'title', key: 'title', ellipsis: true },
    { title: '取用次数', dataIndex: 'count', key: 'count', width: 100, render: (value: number) => <Tag color="blue">{value}</Tag> },
    {
      title: '最近取用',
      dataIndex: 'last_used_at',
      key: 'last_used_at',
      width: 170,
      render: (value: string | null) => <Typography.Text type="secondary">{formatDateTime(value)}</Typography.Text>,
    },
  ];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={640}
      rootClassName="pm-usage"
      title={
        <Space>
          <BarChartOutlined />
          使用统计
        </Space>
      }
      extra={
        <Space>
          <Select
            value={days}
            style={{ width: 110 }}
            options={[
              { value: 7, label: '近 7 天' },
              { value: 30, label: '近 30 天' },
              { value: 90, label: '近 90 天' },
            ]}
            onChange={(value: number) => setDays(value)}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading} />
        </Space>
      }
    >
      {error !== null && <ErrorState message={error} />}
      {error === null && (
        <Spin spinning={loading}>
          {summary === null ? (
            <LoadingState rows={4} label="正在汇总取用记录…" />
          ) : (
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <Flex gap={24} wrap>
                <Statistic title={`近 ${String(summary.days)} 天取用总次数`} value={summary.total} />
                <Statistic title="浏览器会话" value={summary.by_channel.session} />
                <Statistic title="API Token" value={summary.by_channel.token} />
                <Statistic title="MCP" value={summary.by_channel.mcp} />
              </Flex>
              <Descriptions
                size="small"
                column={1}
                bordered
                items={[
                  { key: 'note', label: '口径', children: '只记"取用"（打开详情 / 渲染 / MCP 取用）；列表与搜索不计' },
                  { key: 'side', label: '副作用', children: '写使用记录不产生版本、不改 updated_at' },
                ]}
              />
              <Table
                rowKey="prompt_id"
                size="small"
                columns={columns}
                dataSource={summary.top}
                pagination={false}
                locale={{ emptyText: <EmptyState title="窗口内没有取用记录" hint="浏览器打开详情 / 渲染 / MCP 取用都会计入" /> }}
              />
            </Space>
          )}
        </Spin>
      )}
    </Drawer>
  );
}
