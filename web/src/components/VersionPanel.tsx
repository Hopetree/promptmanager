import { HistoryOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import {
  App as AntdApp,
  Alert,
  Button,
  Empty,
  Flex,
  Input,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  theme,
} from 'antd';
import type { TableProps } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError, describeError } from '../api';
import { formatDateTime } from '../pure';
import type { VersionSummary } from '../types';
import DiffView from './DiffView';
import { EmptyState, LoadingState } from './States';

interface VersionPanelProps {
  /** null = 这条还没保存（新建草稿，FR-45）→ 不请求服务端，显示占位 */
  promptId: number | null;
  /** 变化即重新拉版本列表（保存 / 回滚之后由编辑器 +1） */
  refreshKey: number;
  /** 回滚会生成新版本 → 通知外层刷新列表与编辑器内容 */
  onRollbackDone: () => void;
  onUnauthorized: () => void;
}

type VersionView = 'table' | 'compare' | 'detail';

/** 变更备注按「prompt+版本」存在本地（FR-41e 第 6 条允许的本地扩展；**不改 API 契约**）。 */
const noteKey = (promptId: number, versionNo: number): string => `pm-vnote:${String(promptId)}:${String(versionNo)}`;

function readNote(promptId: number, versionNo: number): string {
  try {
    return window.localStorage.getItem(noteKey(promptId, versionNo)) ?? '';
  } catch {
    return '';
  }
}

function writeNote(promptId: number, versionNo: number, value: string): void {
  try {
    if (value === '') window.localStorage.removeItem(noteKey(promptId, versionNo));
    else window.localStorage.setItem(noteKey(promptId, versionNo), value);
  } catch {
    /* 隐私模式忽略 */
  }
}

/**
 * 版本历史（FR-7 + FR-41e 第 6 条）：**表格 / 对比版本 / 详情** 三个视图 + 可选**变更备注**。
 * 保留原有能力：版本列表、两版本 unified diff、回滚（生成新版本；FR-86 起最多保留最近 10 个版本）。
 * 视图切换用 antd `Segmented`（不是 `Tabs`——AC-31 ⑥ 要求编辑器面 `.ant-tabs-tab` = 0）。
 */
export default function VersionPanel({ promptId, refreshKey, onRollbackDone, onUnauthorized }: VersionPanelProps) {
  const { message } = AntdApp.useApp();
  const { token } = theme.useToken();
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  // 默认落在「对比版本」：打编辑器和详情时最想先看到的就是 diff（表格/详情一键可达）
  const [view, setView] = useState<VersionView>('compare');
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);
  const [diff, setDiff] = useState('');
  const [diffLoading, setDiffLoading] = useState(false);
  const [detailNo, setDetailNo] = useState<number | null>(null);
  const [note, setNote] = useState('');

  const loadDiff = useCallback(
    async (fromValue: number | null, toValue: number | null) => {
      if (fromValue === null || toValue === null || promptId === null) return;
      setDiffLoading(true);
      try {
        const result = await api.diff(promptId, fromValue, toValue);
        setDiff(result.diff);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          onUnauthorized();
          return;
        }
        message.error(describeError(error));
      } finally {
        setDiffLoading(false);
      }
    },
    [message, onUnauthorized, promptId],
  );

  useEffect(() => {
    if (promptId === null) {
      setVersions([]);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    void (async () => {
      try {
        const result = await api.versions(promptId);
        if (!alive) return;
        setVersions(result.items);
        const first = result.items[0]?.version_no ?? null;
        const last = result.items[result.items.length - 1]?.version_no ?? null;
        setFrom(first);
        setTo(last);
        setDetailNo(last);
        if (first !== null && last !== null) await loadDiff(first, last);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          onUnauthorized();
          return;
        }
        message.error(describeError(error));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [loadDiff, message, onUnauthorized, promptId, refreshKey]);

  useEffect(() => {
    if (detailNo !== null && promptId !== null) setNote(readNote(promptId, detailNo));
  }, [detailNo, promptId]);

  const rollback = async (versionNo: number): Promise<void> => {
    if (promptId === null) return;
    try {
      await api.rollback(promptId, versionNo);
      message.success(`已回滚到 v${String(versionNo)}（已生成新版本）`);
      onRollbackDone();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onUnauthorized();
        return;
      }
      message.error(describeError(error));
    }
  };

  const notes = useMemo(() => {
    const map = new Map<number, string>();
    if (promptId === null) return map;
    for (const version of versions) {
      const value = readNote(promptId, version.version_no);
      if (value !== '') map.set(version.version_no, value);
    }
    return map;
  }, [promptId, versions]);

  const versionOptions = versions.map((version) => ({
    value: version.version_no,
    label: `v${String(version.version_no)}`,
  }));

  const columns: TableProps<VersionSummary>['columns'] = [
    {
      title: '版本',
      dataIndex: 'version_no',
      key: 'version_no',
      width: 74,
      render: (value: number) => <Tag color="blue">v{value}</Tag>,
    },
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true,
      render: (value: string, version) =>
        notes.get(version.version_no) === undefined ? (
          value
        ) : (
          <Space size={6}>
            <span>{value}</span>
            <Tag icon={<SaveOutlined />} data-testid={`pm-vnote-tag-${String(version.version_no)}`}>
              备注
            </Tag>
          </Space>
        ),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 150,
      render: (value: string) => (
        <Typography.Text className="pm-mono" style={{ color: token.colorTextTertiary }}>
          {formatDateTime(value)}
        </Typography.Text>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 160,
      render: (_value, version) => (
        <Space size={4}>
          <Button
            type="link"
            size="small"
            onClick={() => {
              setDetailNo(version.version_no);
              setView('detail');
            }}
            data-testid={`pm-vdetail-${String(version.version_no)}`}
          >
            详情
          </Button>
          <Popconfirm
            title={`回滚到 v${String(version.version_no)}？`}
            description="会生成一个新版本；最多保留最近 10 个版本。"
            onConfirm={() => void rollback(version.version_no)}
          >
            <Button
              type="link"
              size="small"
              icon={<HistoryOutlined />}
              data-testid={`rollback-${String(version.version_no)}`}
            >
              回滚
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  if (loading) return <LoadingState rows={4} label="正在读取版本历史…" />;
  if (versions.length === 0) return <EmptyState title="暂无版本" hint="保存一次内容就会产生 v1" />;

  const detailVersion = versions.find((version) => version.version_no === detailNo) ?? null;
  const previous =
    detailNo === null ? null : (versions.find((version) => version.version_no === detailNo - 1)?.version_no ?? null);

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Flex align="center" gap={8} wrap>
        <Segmented
          size="small"
          value={view}
          onChange={(value) => setView(value as VersionView)}
          options={[
            { value: 'table', label: '表格' },
            { value: 'compare', label: '对比版本' },
            { value: 'detail', label: '详情' },
          ]}
          data-testid="pm-version-views"
        />
        <Typography.Text style={{ fontSize: 11.5, color: token.colorTextTertiary }}>
          共 <span className="pm-mono">{versions.length}</span> 个版本
        </Typography.Text>
        {/* FR-86：保留策略必须有**可见文案**（用户明确要求）。数字与 src/db/prompt-versions.ts 的
            VERSION_KEEP_LIMIT 保持一致；前端不 import 服务端常量（Vite 不打包 src/），故这里硬编码并注明出处。 */}
        <Typography.Text
          type="secondary"
          style={{ fontSize: 11.5 }}
          data-testid="pm-version-retention-note"
        >
          最多保留最近 10 个版本（更早的版本会在产生新版本时自动清理）
        </Typography.Text>
      </Flex>

      {view === 'compare' && (
        <>
          <Flex gap={8} wrap align="center">
            <Typography.Text type="secondary">对比</Typography.Text>
            <Select
              style={{ width: 110 }}
              value={from ?? undefined}
              options={versionOptions}
              onChange={(value: number) => setFrom(value)}
            />
            <Typography.Text type="secondary">→</Typography.Text>
            <Select
              style={{ width: 110 }}
              value={to ?? undefined}
              options={versionOptions}
              onChange={(value: number) => setTo(value)}
            />
            <Button
              icon={<ReloadOutlined />}
              loading={diffLoading}
              disabled={from === null || to === null}
              onClick={() => void loadDiff(from, to)}
            >
              查看 diff
            </Button>
          </Flex>
          <DiffView diff={diff} />
        </>
      )}

      {view === 'detail' && (
        <>
          <Flex gap={8} wrap align="center">
            <Typography.Text type="secondary">版本</Typography.Text>
            <Select
              style={{ width: 120 }}
              value={detailNo ?? undefined}
              options={versionOptions}
              onChange={(value: number) => setDetailNo(value)}
            />
            <Button
              size="small"
              disabled={previous === null}
              data-testid="pm-vdetail-compare-prev"
              onClick={() => {
                setFrom(previous);
                setTo(detailNo);
                setView('compare');
                void loadDiff(previous, detailNo);
              }}
            >
              与上一版对比
            </Button>
            {detailNo !== null && (
              <Popconfirm
                title={`回滚到 v${String(detailNo)}？`}
                description="会生成一个新版本；最多保留最近 10 个版本。"
                onConfirm={() => void rollback(detailNo)}
              >
                <Button size="small" danger icon={<HistoryOutlined />}>
                  回滚到此版本
                </Button>
              </Popconfirm>
            )}
          </Flex>

          {detailVersion === null ? (
            <Empty description="选一个版本" />
          ) : (
            <>
              <Flex vertical gap={4} style={{ fontSize: 12.5 }}>
                <Typography.Text>
                  <Tag color="blue">v{detailVersion.version_no}</Tag>
                  {detailVersion.title}
                </Typography.Text>
                <Typography.Text className="pm-mono" style={{ color: token.colorTextTertiary }}>
                  创建于 {formatDateTime(detailVersion.created_at)}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {previous === null
                    ? '这是首版，没有更早的版本可比。'
                    : `下面是与上一版 v${String(previous)} 的差异（本产品没有"整版快照"接口，详情 = 变更内容 + 元信息）。`}
                </Typography.Text>
              </Flex>

              <div>
                <Typography.Text style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>
                  变更备注（CHANGE NOTE · 仅本地保存，不改接口）
                </Typography.Text>
                <Flex gap={8}>
                  <Input
                    value={note}
                    placeholder="例如：补充了回滚办法"
                    onChange={(event) => setNote(event.target.value)}
                    data-testid="pm-vnote-input"
                  />
                  <Button
                    icon={<SaveOutlined />}
                    data-testid="pm-vnote-save"
                    onClick={() => {
                      if (promptId === null) return;
                      writeNote(promptId, detailVersion.version_no, note.trim());
                      message.success('备注已保存（本地）');
                      setVersions((list) => [...list]);
                    }}
                  >
                    保存备注
                  </Button>
                </Flex>
              </div>

              {previous === null ? null : (
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  loading={diffLoading}
                  onClick={() => void loadDiff(previous, detailNo)}
                >
                  载入与上一版的 diff
                </Button>
              )}
              <DiffView diff={previous === null ? '' : diff} />
            </>
          )}
        </>
      )}

      {view === 'table' && (
        <>
          <Alert
            type="info"
            showIcon
            message="每次保存自动留档；回滚会生成新版本。最多保留最近 10 个版本，更早的会自动清理。"
          />
          <Table<VersionSummary>
            rowKey="version_no"
            size="small"
            columns={columns}
            dataSource={versions}
            pagination={false}
            scroll={{ x: 'max-content' }}
          />
        </>
      )}
    </Space>
  );
}
