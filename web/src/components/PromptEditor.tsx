import {
  ArrowLeftOutlined,
  CopyOutlined,
  DeleteOutlined,
  CompressOutlined,
  ExpandOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import {
  App as AntdApp,
  Breadcrumb,
  Button,
  Space as AntdSpace,
  Card,
  Flex,
  Form,
  Grid,
  Input,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Switch,
  TreeSelect,
  Typography,
  theme,
} from 'antd';
import type { ReactNode } from 'react';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { api, ApiError, describeError } from '../api';
import { buildFolderTree, formatDateTime } from '../pure';
import type { Folder, Prompt, PromptWritable, Tag as PromptTag } from '../types';
import { LazyMarkdownPreview, LazyVariablePanel, LazyVersionPanel } from '../lazy';
import FavoriteStar from './FavoriteStar';
import LazyFallback from './LazyFallback';

interface PromptEditorProps {
  prompt: Prompt;
  /** true = **内存草稿**（FR-45）：未点「保存」前不得在服务端入库；保存时走 POST 创建 */
  isNew: boolean;
  /** 进入编辑态的来源（FR-55）：详情 → 返回详情；列表 / 新建 → 返回列表 */
  origin: 'detail' | 'list' | 'new';
  /** FR-57：编辑器里也能一键收藏 */
  onToggleFavorite: (prompt: Prompt) => void;
  folders: Folder[];
  tags: PromptTag[];
  isMobile: boolean;
  /** 三栏布局的"左（列表）"——桌面端由 Workspace 传入；手机端为 undefined（抽屉里单列） */
  left?: ReactNode;
  onClose: () => void;
  /** FR-55：返回详情（从详情进来的场景） */
  onBackToDetail: () => void;
  onSaved: (prompt: Prompt) => void;
  onDeleted: (id: number) => void;
  /** 复制一段文本（编辑器内直接复制，不必先打开变量面板） */
  onCopyText: (text: string, label: string) => void;
  onUnauthorized: () => void;
  /** FR-62：全屏态（状态由 Workspace 持有，便于 Esc 与外壳隐藏统一处理） */
  fullscreen: boolean;
  /** FR-62：切换全屏（同一个按钮进出） */
  onToggleFullscreen: () => void;
}

interface EditorForm {
  title: string;
  user_prompt: string;
  system_prompt: string;
  notes: string;
  folder_id: number | null;
  tags: string[];
  favorite: boolean;
}

/**
 * 编辑器（FR-40b 第 1 条）：**三栏常驻** —— 左（列表）· 中（编辑主体）· 右（版本历史 / 变量填值 / Markdown 预览**同屏**）。
 * 这三块**不再由标签页承载**（AC-31 ⑥ 要求详情面 `.ant-tabs-tab` = 0）。
 * 三个面板的锚点是 `pm-panel-versions` / `pm-panel-variables` / `pm-panel-markdown`（AC-31 ④⑤）。
 */
export default function PromptEditor({
  prompt,
  isNew,
  origin,
  onToggleFavorite,
  folders,
  tags,
  isMobile,
  left,
  onClose,
  onBackToDetail,
  onSaved,
  onDeleted,
  onCopyText,
  onUnauthorized,
  fullscreen,
  onToggleFullscreen,
}: PromptEditorProps) {
  const { message } = AntdApp.useApp();
  const { token } = theme.useToken();
  const screens = Grid.useBreakpoint();
  const [form] = Form.useForm<EditorForm>();
  const [submitting, setSubmitting] = useState(false);
  const [versionRefreshKey, setVersionRefreshKey] = useState(0);
  /** FR-62：窄屏 / 移动端全屏退化为单栏时的「编辑 / 预览」二选一 */
  const [fsPane, setFsPane] = useState<'edit' | 'preview'>('edit');

  // 768–1200px（无 xl）：全屏也只放一栏（FR-62 的"窄屏不横向溢出"，FR-63 未改）
  const narrow = !isMobile && (screens.xl === undefined ? window.innerWidth < 1200 : !screens.xl);
  const singleColumn = fullscreen && (isMobile || narrow);

  // FR-63：编辑器全屏是**应用内全屏** —— 页面永远不会进入浏览器全屏态
  //（不碰任何 Fullscreen API，AC-63 ① 会断言浏览器全屏元素恒为空），
  // 只隐藏内部左栏并把剩余空间 1:1 分给编辑栏与右栏。

  const fill = useCallback(
    (source: Prompt) => {
      form.setFieldsValue({
        title: source.title,
        user_prompt: source.user_prompt,
        system_prompt: source.system_prompt,
        notes: source.notes,
        folder_id: source.folder_id,
        tags: source.tags,
        favorite: source.favorite,
      });
    },
    [form],
  );

  useEffect(() => {
    fill(prompt);
  }, [fill, prompt]);

  /** 回滚后重新取服务端内容（回滚不改 prompt.id，所以要显式重取）。 */
  const reloadFromServer = useCallback(async (): Promise<void> => {
    try {
      const fresh = await api.getPrompt(prompt.id);
      fill(fresh);
      onSaved(fresh);
      setVersionRefreshKey((key) => key + 1);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onUnauthorized();
        return;
      }
      message.error(describeError(error));
    }
  }, [fill, message, onSaved, onUnauthorized, prompt.id]);

  const save = async (): Promise<void> => {
    // FR-45：新建是"内存草稿 → 点保存才创建"；这里才第一次碰服务端

    let values: EditorForm;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const payload: PromptWritable = {
      title: values.title ?? '',
      user_prompt: values.user_prompt ?? '',
      system_prompt: values.system_prompt ?? '',
      notes: values.notes ?? '',
      folder_id: values.folder_id ?? null,
      tags: values.tags ?? [],
      favorite: values.favorite ?? false,
    };
    setSubmitting(true);
    try {
      const updated = isNew ? await api.createPrompt(payload) : await api.updatePrompt(prompt.id, payload);
      onSaved(updated);
      setVersionRefreshKey((key) => key + 1);
      message.success(`已保存（v${String(updated.version_no)}）`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onUnauthorized();
        return;
      }
      message.error(describeError(error));
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (): Promise<void> => {
    try {
      await api.deletePrompt(prompt.id);
      message.success('已删除');
      onDeleted(prompt.id);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onUnauthorized();
        return;
      }
      message.error(describeError(error));
    }
  };

  const userPrompt = Form.useWatch('user_prompt', form) ?? '';
  const systemPrompt = Form.useWatch('system_prompt', form) ?? '';

  const formColumn = (
    <Card styles={{ body: { padding: 16 } }}>
      <Flex align="center" gap={8} style={{ marginBottom: 12 }}>
        {isNew ? (
          <Typography.Text style={{ fontSize: 11, color: token.colorWarning }} data-testid="editor-draft-badge">
            未保存草稿 · 点「保存」才会创建
          </Typography.Text>
        ) : (
          <>
            <Typography.Text className="pm-mono" style={{ fontSize: 11, color: token.colorTextQuaternary }}>
              #{String(prompt.id).padStart(3, '0')}
            </Typography.Text>
            <Typography.Text style={{ fontSize: 11, color: token.colorTextQuaternary }}>
              v{prompt.version_no} · 更新于 {formatDateTime(prompt.updated_at)} · 取用 {prompt.use_count}
            </Typography.Text>
          </>
        )}
      </Flex>
      <Form<EditorForm> form={form} layout="vertical" requiredMark={false}>
        <Form.Item name="title" label="标题" style={{ marginBottom: 12 }}>
          <Input placeholder="例如：代码评审助手" data-testid="editor-title" />
        </Form.Item>
        <Form.Item
          name="user_prompt"
          style={{ marginBottom: 12 }}
          label={
            <AntdSpace size={6}>
              <span>用户提示词（user_prompt）</span>
              <Button
                type="text"
                size="small"
                icon={<CopyOutlined />}
                data-testid="editor-copy-user"
                onClick={() => onCopyText(String(form.getFieldValue('user_prompt') ?? ''), '用户提示词')}
              />
            </AntdSpace>
          }
        >
          <Input.TextArea
            rows={9}
            placeholder="在这里写用户侧提示词；变量用 {{变量名}}"
            data-testid="editor-user-prompt"
            /* FR-62 ①：全屏下编辑区高度 ≥ 视口 70%（长文本不再挤在小框里） */
            style={fullscreen ? { height: '72vh', minHeight: '72vh' } : undefined}
          />
        </Form.Item>
        <Form.Item
          name="system_prompt"
          style={{ marginBottom: 12 }}
          label={
            <AntdSpace size={6}>
              <span>系统提示词（system_prompt）</span>
              <Button
                type="text"
                size="small"
                icon={<CopyOutlined />}
                data-testid="editor-copy-system"
                onClick={() => onCopyText(String(form.getFieldValue('system_prompt') ?? ''), '系统提示词')}
              />
            </AntdSpace>
          }
        >
          <Input.TextArea rows={3} placeholder="系统角色 / 约束" />
        </Form.Item>
        <Form.Item name="notes" label="备注（notes）" style={{ marginBottom: 12 }}>
          <Input.TextArea rows={2} placeholder="使用说明、来源、注意事项" />
        </Form.Item>
        <Flex gap={12} wrap>
          <Form.Item name="folder_id" label="文件夹" style={{ minWidth: 180, flex: 1, marginBottom: 12 }}>
            <TreeSelect allowClear placeholder="未归类" treeData={buildFolderTree(folders)} treeDefaultExpandAll />
          </Form.Item>
          <Form.Item name="tags" label="标签" style={{ minWidth: 180, flex: 2, marginBottom: 12 }}>
            <Select
              mode="tags"
              placeholder="输入标签后回车"
              options={tags.map((tag) => ({ value: tag.name, label: `${tag.name}（${String(tag.count)}）` }))}
            />
          </Form.Item>
        </Flex>
        <Form.Item name="favorite" label="收藏（置顶到列表）" valuePropName="checked" style={{ marginBottom: 0 }}>
          <Switch checkedChildren="已收藏" unCheckedChildren="未收藏" />
        </Form.Item>
      </Form>
    </Card>
  );

  return (
    <div
      data-testid="pm-editor"
      data-fullscreen={fullscreen ? 'true' : undefined}
      className={
        [
          isMobile ? undefined : 'pm-editor-grid',
          fullscreen ? 'pm-editor-fullscreen' : undefined,
          singleColumn ? 'pm-editor-fullscreen-single' : undefined,
        ]
          .filter((name) => name !== undefined)
          .join(' ') || undefined
      }
    >
      {/* FR-63：编辑器内部左栏「Prompt 列表」——全屏时由 CSS 隐藏（display:none ⇒ offsetParent === null），
          所以它**始终挂载**；全屏下也不再挂 .pm-editor-col，避免"可见列"统计把它（宽度 0）算进去。 */}
      {!isMobile && left !== undefined && (
        <div data-testid="editor-list" className={fullscreen ? undefined : 'pm-editor-col'}>
          {left}
        </div>
      )}

      {(!singleColumn || fsPane === 'edit') && (
        <Flex
          vertical
          gap={12}
          data-testid="editor-main"
          className={[isMobile ? undefined : 'pm-editor-col', fullscreen ? 'pm-editor-pane' : undefined]
            .filter((name) => name !== undefined)
            .join(' ')}
          style={{ minWidth: 0 }}
        >
          {/* 工具栏常驻（FR-62 ③）：全屏下不随正文滚走 */}
          <div className="pm-editor-toolbar">
            {/* FR-55：按来源返回（详情 → 返回详情；列表 / 新建 → 返回列表）+ 可点面包屑 */}
            <Flex align="center" gap={8} wrap>
              <Button
                type="text"
                size="small"
                icon={<ArrowLeftOutlined />}
                onClick={origin === 'detail' ? onBackToDetail : onClose}
                data-testid="editor-back"
              >
                {origin === 'detail' ? '返回详情' : '返回列表'}
              </Button>
              <Breadcrumb
                items={[
                  { title: <a onClick={onClose}>列表</a> },
                  { title: <a onClick={onBackToDetail}>{isNew ? '新建 prompt' : prompt.title === '' ? '(无标题)' : prompt.title}</a> },
                ]}
              />
              {singleColumn && (
                <Segmented
                  size="small"
                  value={fsPane}
                  onChange={(value) => setFsPane(value as 'edit' | 'preview')}
                  options={[
                    { value: 'edit', label: '编辑' },
                    { value: 'preview', label: '预览' },
                  ]}
                  data-testid="editor-fs-pane"
                />
              )}
            </Flex>
            <Flex align="center" gap={8} wrap>
              {!isNew && <FavoriteStar prompt={prompt} testid={`pm-fav-editor-${String(prompt.id)}`} onToggle={onToggleFavorite} />}
              <Typography.Title level={4} style={{ margin: 0, fontSize: 17, letterSpacing: '-0.015em' }}>
                {isNew ? '新建 prompt' : prompt.title === '' ? '(无标题)' : prompt.title}
              </Typography.Title>
              <Space size={8} style={{ marginLeft: 'auto' }}>
                {/* FR-63：与详情面 pm-detail-fullscreen 同款（同 Button 类型/尺寸、同图标、同文案），
                    位置在编辑器工具栏里（与 删除 / 保存 同排；上一排是 返回）。 */}
                <Button
                  type="text"
                  size="small"
                  icon={fullscreen ? <CompressOutlined /> : <ExpandOutlined />}
                  onClick={onToggleFullscreen}
                  data-testid="editor-fullscreen"
                >
                  {fullscreen ? '退出全屏' : '全屏展开'}
                </Button>
                {!isNew && (
                  <Popconfirm title="删除这条 prompt？" description="版本历史一并移除，不可恢复。" onConfirm={() => void remove()}>
                    <Button danger icon={<DeleteOutlined />} data-testid="editor-delete">
                      删除
                    </Button>
                  </Popconfirm>
                )}
                <Button type="primary" icon={<SaveOutlined />} loading={submitting} onClick={() => void save()} data-testid="editor-save">
                  保存
                </Button>
              </Space>
            </Flex>
          </div>
          <div className="pm-editor-scroll">{formColumn}</div>
        </Flex>
      )}

      {(!singleColumn || fsPane === 'preview') && (
        <Flex
          vertical
          gap={12}
          data-testid="editor-side"
          className={isMobile ? undefined : 'pm-editor-col'}
          style={{ minWidth: 0 }}
        >
          <div data-testid="pm-panel-markdown">
            <Card size="small" title="Markdown 预览" styles={{ body: { padding: 12 } }}>
              <Suspense fallback={<LazyFallback label="正在加载预览…" />}>
                <LazyMarkdownPreview
                  /* FR-68：备注**不做** Markdown 预览与渲染 —— 字段列表只留用户 / 系统提示词两项
                     （备注输入框仍是普通多行文本；它的纯文本展示由详情面的 pm-detail-notes 承担）。 */
                  fields={[
                    { key: 'user_prompt', label: '用户提示词', text: userPrompt },
                    { key: 'system_prompt', label: '系统提示词', text: systemPrompt },
                  ]}
                />
              </Suspense>
            </Card>
          </div>
          <div data-testid="pm-panel-variables">
            <Card size="small" title="变量填值" styles={{ body: { padding: 12 } }}>
              <Suspense fallback={<LazyFallback label="正在加载变量…" />}>
                <LazyVariablePanel promptId={isNew ? null : prompt.id} onUnauthorized={onUnauthorized} />
              </Suspense>
            </Card>
          </div>
          <div data-testid="pm-panel-versions">
            <Card
              size="small"
              title={
                <Space size={6}>
                  <Typography.Text style={{ fontSize: 12, fontWeight: 600 }}>版本历史</Typography.Text>
                </Space>
              }
              styles={{ body: { padding: 12 } }}
            >
              <Suspense fallback={<LazyFallback label="正在加载版本…" />}>
                <LazyVersionPanel
                  promptId={isNew ? null : prompt.id}
                  refreshKey={versionRefreshKey}
                  onRollbackDone={() => void reloadFromServer()}
                  onUnauthorized={onUnauthorized}
                />
              </Suspense>
            </Card>
          </div>
        </Flex>
      )}
    </div>
  );
}
