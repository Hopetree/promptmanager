import { CloudDownloadOutlined, CloudSyncOutlined, CloudUploadOutlined, LinkOutlined } from '@ant-design/icons';
import { Alert, App as AntdApp, Button, Card, Descriptions, Flex, Form, Input, Modal, Segmented, Space, Typography } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, describeError } from '../api';
import type { SyncConfigView, SyncPushResult, SyncTestResult } from '../types';

interface SyncModalProps {
  open: boolean;
  onClose: () => void;
  /** 从云端恢复成功后刷新列表 / 文件夹 / 标签 */
  onPulled: () => void;
}

interface ConfigFormValue {
  repo: string;
  instance?: string;
  path: string;
  branch?: string;
  token?: string;
}

const TOKEN_GUIDE =
  '建议用 fine-grained 令牌：只授权这一个仓库、只给 Contents: Read and write，不要复用个人 personal token。';
const NO_DELETE_NOTE = '删除不会传播到云端：本地删除的 prompt 不会去同步删除云端快照里的对应内容。';

/**
 * FR-125 ④.7：接口失败时优先显示**服务端写好的中文提示**（含"下一步怎么做"），
 * 而不是只丢一句 `HTTP 400 sync_xxx`（`src/services/sync-github.ts` 已经按 401/403/404/409/网络异常分好类）。
 */
const explain = (error: unknown): string =>
  error instanceof ApiError && error.serverMessage !== undefined && error.serverMessage !== ''
    ? error.serverMessage
    : describeError(error);

/**
 * FR-125 远程数据同步（阶段 59）—— **手动触发**：
 * ① 配置（repo / instance / path / token / branch，token 加密落库、界面永远拿不到明文）；
 * ② 测试连接（区分 token 无效 / 无权限 / 仓库或路径不存在 / 云端还没有文件）；
 * ③ 立即上传（**先 dry_run 再二次确认**，确认框明示条数、完整目标路径与"含正文全文"）；
 * ④ 从云端恢复（默认 merge；replace 清空重建 → 二次确认，服务端先自动写本地快照）。
 *
 * 本组件**没有任何定时器**，也不会在挂载时发出网请求：每次与 GitHub 的往来都由用户点击触发
 * （AC-121 F⑪；BRIEF `:1402`/`:2826` 的"不主动出网"口径）。
 */
export default function SyncModal({ open, onClose, onPulled }: SyncModalProps) {
  const { message, modal } = AntdApp.useApp();
  const [form] = Form.useForm<ConfigFormValue>();
  const [config, setConfig] = useState<SyncConfigView | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [test, setTest] = useState<SyncTestResult | null>(null);
  const [plan, setPlan] = useState<SyncPushResult | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');

  const applyConfig = useCallback(
    (view: SyncConfigView): void => {
      setConfig(view);
      form.setFieldsValue({
        repo: view.repo,
        instance: view.instance,
        path: view.path,
        branch: view.branch,
        token: undefined,
      });
    },
    [form],
  );

  useEffect(() => {
    if (!open) return;
    setTest(null);
    setPlan(null);
    setMode('merge');
    setLoading(true);
    api
      .syncConfig()
      .then(applyConfig)
      .catch((error: unknown) => {
        message.error(explain(error));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [open, applyConfig, message]);

  const save = async (value: ConfigFormValue): Promise<void> => {
    setSaving(true);
    try {
      const view = await api.putSyncConfig({
        repo: value.repo,
        instance: value.instance ?? '',
        path: value.path,
        branch: value.branch ?? '',
        ...(value.token === undefined || value.token === '' ? {} : { token: value.token }),
      });
      applyConfig(view);
      setTest(null);
      setPlan(null);
      message.success('同步配置已保存（令牌加密存储，界面不再显示明文）');
    } catch (error) {
      message.error(explain(error));
    } finally {
      setSaving(false);
    }
  };

  const runTest = async (): Promise<void> => {
    setTesting(true);
    setTest(null);
    try {
      const result = await api.syncTest();
      setTest(result);
    } catch (error) {
      message.error(explain(error));
    } finally {
      setTesting(false);
    }
  };

  const doPush = async (): Promise<void> => {
    setPushing(true);
    try {
      const result = await api.syncPush(false);
      setPlan(result);
      message.success(
        result.action === 'create'
          ? `已上传：新建 ${String(result.path)}（commit ${result.commit_sha?.slice(0, 7) ?? '?'}）`
          : `已上传：覆盖 ${String(result.path)}（commit ${String(result.commit_sha?.slice(0, 7) ?? '?')}）`,
      );
    } catch (error) {
      message.error(explain(error));
    } finally {
      setPushing(false);
    }
  };

  /** 上传一律**先 dry_run**（只读远端），拿条数 / 完整路径 / 新建还是覆盖再让用户确认。 */
  const startPush = async (): Promise<void> => {
    setPushing(true);
    setPlan(null);
    try {
      const preview = await api.syncPush(true);
      setPlan(preview);
      modal.confirm({
        title: preview.action === 'create' ? '确认上传到云端？' : '确认覆盖云端文件？',
        okText: preview.action === 'create' ? '上传' : '覆盖上传',
        okButtonProps: { danger: preview.action === 'overwrite' },
        cancelText: '取消',
        width: 560,
        content: (
          <Space direction="vertical" size={8}>
            <Typography.Text>
              将推送 prompt <Typography.Text strong>{preview.prompts}</Typography.Text> 条 / 文件夹{' '}
              <Typography.Text strong>{preview.folders}</Typography.Text> 个 / 标签{' '}
              <Typography.Text strong>{preview.tags}</Typography.Text> 个。
            </Typography.Text>
            <Typography.Text>
              目标文件：
              <Typography.Text code>{`${preview.repo}@${preview.branch}:${preview.path}`}</Typography.Text>
            </Typography.Text>
            <Typography.Text type="secondary">
              {preview.action === 'create'
                ? '云端还没有这个文件，将新建。'
                : `云端已有这个文件（sha ${preview.current_sha?.slice(0, 7) ?? '?'}），将被整体覆盖；远端历史提交仍可回滚。`}
            </Typography.Text>
            <Typography.Text strong type="warning">
              快照包含提示词正文全文（含 system prompt 与版本历史）。
            </Typography.Text>
          </Space>
        ),
        onOk: doPush,
      });
    } catch (error) {
      message.error(explain(error));
    } finally {
      setPushing(false);
    }
  };

  const doPull = async (confirmed: boolean): Promise<void> => {
    setPulling(true);
    try {
      const result = await api.syncPull(mode, confirmed);
      message.success(
        `已从云端恢复（${result.mode}）：prompt ${String(result.imported.prompts)} 条 / 文件夹 ${String(result.imported.folders)} 个 / 标签 ${String(result.imported.tags)} 个`,
      );
      if (result.snapshot !== null) {
        message.info(`替换前已自动写本地快照：${result.snapshot}（最多保留 ${String(result.snapshot_kept)} 份）`);
      }
      onPulled();
    } catch (error) {
      message.error(explain(error));
    } finally {
      setPulling(false);
    }
  };

  const startPull = (): void => {
    if (mode === 'replace') {
      modal.confirm({
        title: '确认用云端快照替换本地全部数据？',
        okText: '清空并恢复',
        okButtonProps: { danger: true },
        cancelText: '取消',
        width: 560,
        content: (
          <Space direction="vertical" size={8}>
            <Typography.Text strong type="danger">
              replace 会先清空本地 prompt / 文件夹 / 标签，再按云端快照重建。
            </Typography.Text>
            <Typography.Text type="secondary">
              服务端会在清空前自动写一份本地快照到数据目录（最多保留 3 份），出问题可从那里恢复。
            </Typography.Text>
            <Typography.Text type="secondary">{NO_DELETE_NOTE}</Typography.Text>
          </Space>
        ),
        onOk: () => doPull(true),
      });
      return;
    }
    void doPull(false);
  };

  const target = config !== null && config.configured ? `${config.repo}@${config.branch}:${config.path}` : null;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      onOk={onClose}
      okText="关闭"
      cancelButtonProps={{ style: { display: 'none' } }}
      title="远程数据同步"
      width="min(680px, 92vw)"
      rootClassName="pm-sync"
    >
      <Card size="small" title="同步配置" style={{ marginBottom: 12 }}>
        <Form
          form={form}
          layout="vertical"
          size="small"
          onFinish={(value) => void save(value)}
          data-testid="sync-config-form"
        >
          <Form.Item
            name="repo"
            label="仓库（owner/repo）"
            rules={[{ required: true, message: '仓库必填' }]}
            extra="可粘贴网页地址或 SSH 地址，保存时会归一化成 owner/repo"
          >
            <Input placeholder="Hopetree/sync-data-test" data-testid="sync-repo" autoComplete="off" />
          </Form.Item>
          <Flex gap={8} wrap>
            <Form.Item name="instance" label="实例名（可留空）" style={{ flex: '1 1 180px' }}>
              <Input placeholder="默认取访问地址的主机名" data-testid="sync-instance" autoComplete="off" />
            </Form.Item>
            <Form.Item name="branch" label="分支（可留空）" style={{ flex: '1 1 140px' }}>
              <Input placeholder="main" data-testid="sync-branch" autoComplete="off" />
            </Form.Item>
          </Flex>
          <Form.Item
            name="path"
            label="仓库内路径"
            rules={[{ required: true, message: '路径必填' }]}
            extra="必须包含 promptmanager/，并以 <实例名>.json 收尾，例如 promptmanager/pm.json"
          >
            <Input placeholder="promptmanager/pm.json" data-testid="sync-path" autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="token"
            label="GitHub 令牌（fine-grained）"
            extra={
              config !== null && config.token_set
                ? `已设置（尾 ${config.token_tail ?? '????'}）。留空 = 沿用已保存的令牌；只在换令牌时重新粘贴。`
                : '只在保存时提交一次；服务端加密落库，之后读接口只回"已设置"+尾 4 位。'
            }
          >
            <Input.Password
              placeholder={config !== null && config.token_set ? '留空沿用已保存的令牌' : 'github_pat_…'}
              data-testid="sync-token"
              autoComplete="new-password"
            />
          </Form.Item>
          <Alert type="info" showIcon message={TOKEN_GUIDE} style={{ marginBottom: 12 }} />
          <Button type="primary" htmlType="submit" loading={saving} data-testid="sync-save">
            保存配置
          </Button>
        </Form>

        {loading && (
          <Typography.Text type="secondary" data-testid="sync-loading">
            正在读取配置…
          </Typography.Text>
        )}

        {target !== null && (
          <Descriptions
            size="small"
            column={1}
            bordered
            style={{ marginTop: 12 }}
            data-testid="sync-resolved"
            items={[
              { key: 'target', label: '目标文件（解析后完整路径）', children: <Typography.Text code data-testid="sync-target">{target}</Typography.Text> },
              { key: 'branch', label: '分支', children: config?.branch ?? '' },
              { key: 'token', label: '令牌', children: config?.token_set === true ? `已设置（尾 ${config.token_tail ?? '????'}）` : '未设置' },
            ]}
          />
        )}
      </Card>

      <Card size="small" title="手动动作">
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Flex gap={8} wrap align="center">
            <Button icon={<LinkOutlined />} loading={testing} disabled={target === null} onClick={() => void runTest()} data-testid="sync-test">
              测试连接
            </Button>
            <Button icon={<CloudUploadOutlined />} loading={pushing} disabled={target === null} onClick={() => void startPush()} data-testid="sync-push">
              立即上传
            </Button>
            <Segmented
              value={mode}
              onChange={(value) => setMode(value as 'merge' | 'replace')}
              options={[
                { value: 'merge', label: 'merge（追加）' },
                { value: 'replace', label: 'replace（清空重建）' },
              ]}
              data-testid="sync-mode"
            />
            <Button
              icon={<CloudDownloadOutlined />}
              danger={mode === 'replace'}
              loading={pulling}
              disabled={target === null}
              onClick={startPull}
              data-testid="sync-pull"
            >
              从云端恢复
            </Button>
          </Flex>

          {test !== null && (
            <Alert
              type={test.stage === 'ok' ? 'success' : test.stage === 'no_file' ? 'info' : 'error'}
              showIcon
              data-testid="sync-test-result"
              message={test.stage === 'ok' ? '连接正常' : test.stage === 'no_file' ? '连接正常，但云端还没有这个文件' : '测试未通过'}
              description={
                <Space direction="vertical" size={2}>
                  <Typography.Text>{test.message}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {`${test.repo}@${test.branch}:${test.path}`}
                    {test.file_exists === true ? `（远端 sha ${test.file_sha?.slice(0, 7) ?? '?'}）` : ''}
                    {test.can_push === false ? '｜当前令牌对该仓库没有写权限' : ''}
                  </Typography.Text>
                </Space>
              }
            />
          )}

          {plan !== null && plan.commit_sha !== null && (
            <Alert
              type="success"
              showIcon
              data-testid="sync-push-result"
              message="上传完成"
              description={`prompt ${String(plan.prompts)} 条 / 文件夹 ${String(plan.folders)} 个 / 标签 ${String(plan.tags)} 个 → ${plan.path}（commit ${plan.commit_sha.slice(0, 7)}，尝试 ${String(plan.attempts)} 次）`}
            />
          )}

          <Alert type="warning" showIcon message={NO_DELETE_NOTE} />
        </Space>
      </Card>
    </Modal>
  );
}
