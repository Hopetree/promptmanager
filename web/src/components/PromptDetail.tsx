import {
  CompressOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  ExpandOutlined,
  HistoryOutlined,
} from '@ant-design/icons';
import { Button, Drawer, Flex, Modal, Popconfirm, Segmented, Space, Switch, Typography, theme } from 'antd';
import { Suspense, useRef, useState } from 'react';
import { formatDateTime } from '../pure';
import type { Prompt } from '../types';
import { LazyMarkdownPreview, LazyVariablePanel, LazyVersionPanel } from '../lazy';
import FavoriteStar from './FavoriteStar';
import LazyFallback from './LazyFallback';

export interface PromptDetailPanelProps {
  prompt: Prompt;
  busy: boolean;
  /** 复制提示词（含变量时由调用方弹填值对话框） */
  onCopy: (prompt: Prompt) => void;
  /** 删除（危险色 + 二次确认；testid 用 pm-detail-delete，**不以 pm-delete- 开头**） */
  onDelete: (prompt: Prompt) => void;
  /** 去编辑（打开编辑器改这一条） */
  onEdit: (prompt: Prompt) => void;
  /** 回滚后重新取这条 prompt（保持详情打开、内容刷新） */
  onReload: (prompt: Prompt) => void;
  onUnauthorized: () => void;
  /** FR-57：详情栏标题行也能一键收藏 */
  onToggleFavorite: (prompt: Prompt) => void;
  /** 移动端隐藏全屏按钮（抽屉本身就是全屏） */
  isMobile?: boolean;
}

type DetailField = 'user_prompt' | 'system_prompt' | 'notes';

/**
 * 详情面内容（FR-41b ② / FR-41e ①②③ / FR-46 / AC-33c、AC-36、AC-46）：
 * - 标题 + 元信息 + `去编辑`；
 * - 正文区：字段切换 + **渲染预览 / 源码** 双模式 + **显示纯文本** + 全屏；
 * - 变量填值 + 版本历史（含 diff / 回滚）同屏；
 * - **底部固定操作条**（`pm-detail-actions`）：复制提示词（主按钮）· 版本历史 · 删除（危险色 + 二次确认）。
 *
 * **同一个组件**既被 `PromptDetail`（桌面模态 / 移动抽屉）包一层使用，也被分栏视图直接放进右栏
 * （FR-46 / D-22：右栏原样复用详情面）。
 */
export function PromptDetailPanel({
  prompt,
  busy,
  onCopy,
  onDelete,
  onEdit,
  onReload,
  onUnauthorized,
  onToggleFavorite,
  isMobile = false,
}: PromptDetailPanelProps) {
  const { token } = theme.useToken();
  const [field, setField] = useState<DetailField>('user_prompt');
  const [sourceMode, setSourceMode] = useState(false);
  const [plain, setPlain] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [versionKey, setVersionKey] = useState(0);
  const versionsRef = useRef<HTMLDivElement | null>(null);

  const fieldText =
    field === 'user_prompt' ? prompt.user_prompt : field === 'system_prompt' ? prompt.system_prompt : prompt.notes;

  return (
    <Flex
      vertical
      gap={16}
      data-testid="pm-detail"
      className={fullscreen ? 'pm-detail-fullscreen' : undefined}
      style={fullscreen ? { padding: 20 } : undefined}
    >
      {/* FR-69：标题行 + 其下紧跟一行备注（纯文本 / 13px 次级灰 / 最多 2 行省略 + title 全文；空备注不占位） */}
      <Flex vertical gap={4} data-testid="pm-detail-head">
      <Flex align="center" gap={8} wrap>
        <FavoriteStar prompt={prompt} testid={`pm-fav-detail-${String(prompt.id)}`} onToggle={onToggleFavorite} />
        <Typography.Title
          level={4}
          data-testid="pm-detail-title"
          style={{ margin: 0, fontSize: 18, letterSpacing: '-0.015em' }}
        >
          {prompt.title === '' ? '(无标题)' : prompt.title}
        </Typography.Title>
        <Typography.Text style={{ fontSize: 12, color: token.colorTextTertiary }}>
          v{prompt.version_no} · 更新于 {formatDateTime(prompt.updated_at)} · 取用 {prompt.use_count} 次
        </Typography.Text>
        <Space size={8} style={{ marginLeft: 'auto' }}>
          <Button size="small" icon={<EditOutlined />} onClick={() => onEdit(prompt)} data-testid="pm-detail-edit">
            去编辑
          </Button>
        </Space>
      </Flex>

      {prompt.notes.trim() !== '' && (
        <Typography.Paragraph
          data-testid="pm-detail-notes"
          title={prompt.notes}
          className="pm-detail-notes"
          style={{ color: token.colorTextSecondary }}
        >
          {prompt.notes}
        </Typography.Paragraph>
      )}
      </Flex>

      {/* 正文阅读区：字段 / 模式 / 纯文本 / 全屏 */}
      <div>
        {/* AC-66 ③ 的测量锚点：`pm-detail-fields` = 页签行，`pm-detail-body` = 正文区 */}
        <Flex data-testid="pm-detail-fields" align="center" gap={8} wrap style={{ marginBottom: 8 }}>
          <Segmented
            size="small"
            value={field}
            onChange={(value) => setField(value as DetailField)}
            options={[
              { value: 'user_prompt', label: '用户提示词' },
              { value: 'system_prompt', label: '系统提示词' },
              { value: 'notes', label: '备注' },
            ]}
          />
          <Segmented
            size="small"
            value={sourceMode ? 'source' : 'render'}
            onChange={(value) => setSourceMode(value === 'source')}
            options={[
              { value: 'render', label: '预览' },
              { value: 'source', label: '源码' },
            ]}
          />
          <Space size={6}>
            <Switch size="small" data-testid="pm-detail-plain" checked={plain} onChange={setPlain} />
            <Typography.Text style={{ fontSize: 12, color: token.colorTextSecondary }}>显示纯文本</Typography.Text>
          </Space>
          {!isMobile && (
            <Button
              size="small"
              type="text"
              icon={fullscreen ? <CompressOutlined /> : <ExpandOutlined />}
              onClick={() => setFullscreen((value) => !value)}
              data-testid="pm-detail-fullscreen"
            >
              {fullscreen ? '退出全屏' : '全屏展开'}
            </Button>
          )}
        </Flex>

        <div data-testid="pm-detail-body">
        {/* FR-68：备注 = 纯文本 —— 无论「预览 / 源码」都按原样文本显示（<pre> + React 文本节点自动转义），
            因此查看备注**不会**请求 POST /api/render/markdown；两个切换控件保留（对备注页签等价，见 PROGRESS 决策）。 */}
        {sourceMode || plain || field === 'notes' ? (
          <pre
            className="pm-mono"
            data-testid="pm-detail-text"
            style={{
              margin: 0,
              padding: 12,
              maxHeight: fullscreen ? '52vh' : 260,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              borderRadius: token.borderRadius,
              border: `1px solid ${token.colorBorderSecondary}`,
              background: token.colorFillQuaternary,
              fontSize: 12.5,
            }}
          >
            {fieldText === '' ? '（这个字段是空的）' : fieldText}
          </pre>
        ) : (
          <Suspense fallback={<LazyFallback label="正在加载预览…" />}>
            <LazyMarkdownPreview fields={[{ key: field, label: '当前字段', text: fieldText }]} />
          </Suspense>
        )}
        </div>
      </div>

      <div ref={versionsRef}>
        <Typography.Text style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 8 }}>
          变量填值
        </Typography.Text>
        <Suspense fallback={<LazyFallback label="正在加载变量…" />}>
          <LazyVariablePanel promptId={prompt.id} onUnauthorized={onUnauthorized} />
        </Suspense>
      </div>

      <div>
        <Typography.Text style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 8 }}>
          版本历史
        </Typography.Text>
        <Suspense fallback={<LazyFallback label="正在加载版本…" />}>
          <LazyVersionPanel
            promptId={prompt.id}
            refreshKey={versionKey}
            onRollbackDone={() => {
              setVersionKey((key) => key + 1);
              onReload(prompt);
            }}
            onUnauthorized={onUnauthorized}
          />
        </Suspense>
      </div>

      {/* 底部固定操作条（AC-33c） */}
      <Flex
        data-testid="pm-detail-actions"
        align="center"
        gap={8}
        wrap
        style={{
          position: 'sticky',
          bottom: 0,
          marginTop: 4,
          paddingTop: 10,
          paddingBottom: 6,
          background: token.colorBgContainer,
          borderTop: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Button
          type="primary"
          icon={<CopyOutlined />}
          loading={busy}
          onClick={() => onCopy(prompt)}
          data-testid="pm-detail-copy"
        >
          复制提示词
        </Button>
        <Button
          icon={<HistoryOutlined />}
          onClick={() => versionsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          data-testid="pm-detail-version-jump"
        >
          版本历史
        </Button>
        <Popconfirm
          title="删除这条 prompt？"
          description="删除后版本历史一并移除，不可恢复。"
          okText="删除"
          cancelText="取消"
          onConfirm={() => onDelete(prompt)}
        >
          <Button danger icon={<DeleteOutlined />} data-testid="pm-detail-delete">
            删除
          </Button>
        </Popconfirm>
      </Flex>
    </Flex>
  );
}

interface PromptDetailProps extends Omit<PromptDetailPanelProps, 'prompt' | 'isMobile'> {
  /** 要展示的条目；null = 关闭 */
  prompt: Prompt | null;
  isMobile: boolean;
  onClose: () => void;
}

/**
 * 详情弹层（桌面 = 模态，移动 = 全屏抽屉，FR-41d）。
 * 内容全部来自 `PromptDetailPanel`，与分栏视图的右栏是**同一个组件**（D-22）。
 */
export default function PromptDetail({
  prompt,
  isMobile,
  busy,
  onClose,
  onCopy,
  onDelete,
  onEdit,
  onReload,
  onUnauthorized,
  onToggleFavorite,
}: PromptDetailProps) {
  if (prompt === null) return null;

  const panel = (
    <PromptDetailPanel
      key={prompt.id}
      prompt={prompt}
      busy={busy}
      isMobile={isMobile}
      onCopy={onCopy}
      onDelete={onDelete}
      onEdit={onEdit}
      onReload={onReload}
      onUnauthorized={onUnauthorized}
      onToggleFavorite={onToggleFavorite}
    />
  );

  if (isMobile) {
    return (
      <Drawer open placement="right" width="100%" onClose={onClose} title="详情" styles={{ body: { padding: 12 } }}>
        {panel}
      </Drawer>
    );
  }

  return (
    <Modal
      open
      onCancel={onClose}
      footer={null}
      width={920}
      styles={{ body: { maxHeight: '72vh', overflow: 'auto' } }}
      title={`${prompt.title === '' ? '(无标题)' : prompt.title} · 详情`}
    >
      {panel}
    </Modal>
  );
}
