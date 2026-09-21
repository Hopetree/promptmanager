import {
  CloseOutlined,
  CompressOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  ExpandOutlined,
  HistoryOutlined,
} from '@ant-design/icons';
import { Button, Drawer, Flex, Modal, Popconfirm, Segmented, Select, Space, Switch, Tag, TreeSelect, Typography, theme } from 'antd';
import { Suspense, useRef, useState } from 'react';
import { buildFolderTree, formatDateTime } from '../pure';
import type { Folder, Prompt, Tag as PromptTag } from '../types';
import { LazyMarkdownPreview, LazyVersionPanel } from '../lazy';
import FavoriteStar from './FavoriteStar';
import LazyFallback from './LazyFallback';

/** FR-78：详情页内联可改的元信息（folder_id / tags —— 与编辑器同一批字段、同一个 PUT 落库）。 */
export interface PromptMetaPatch {
  folder_id?: number | null;
  tags?: string[];
}

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
  /** FR-78：文件夹下拉的选项（全部文件夹树 + 「未归类」） */
  folders: Folder[];
  /** FR-78：添加标签时可选的已有标签 */
  tags: PromptTag[];
  /** FR-78：改文件夹 / 增删标签 → 由外层落库（PUT /api/prompts/:id）并给反馈 */
  onMetaChange: (prompt: Prompt, patch: PromptMetaPatch) => void;
  /** 移动端隐藏全屏按钮（抽屉本身就是全屏） */
  isMobile?: boolean;
}

type DetailField = 'user_prompt' | 'system_prompt';

/**
 * 详情面内容（FR-41b ② / FR-41e ①②③ / FR-46 / AC-33c、AC-36、AC-46）：
 * - 标题 + **标题下备注行（FR-69）** + **元信息行（FR-78：文件夹下拉可改 + 标签胶囊可增删）**；
 * - 正文区：字段切换（**FR-79：只剩 用户提示词 / 系统提示词 两个页签**）+ **渲染预览 / 源码** 双模式 + **显示纯文本** + 全屏；
 * - 版本历史（含 diff / 回滚）同屏；**FR-80：不再渲染变量区块**（能力保留在编辑器与 VarsDialog）；
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
  folders,
  tags,
  onMetaChange,
  isMobile = false,
}: PromptDetailPanelProps) {
  const { token } = theme.useToken();
  const [field, setField] = useState<DetailField>('user_prompt');
  const [sourceMode, setSourceMode] = useState(false);
  const [plain, setPlain] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [versionKey, setVersionKey] = useState(0);
  const versionsRef = useRef<HTMLDivElement | null>(null);

  const fieldText = field === 'user_prompt' ? prompt.user_prompt : prompt.system_prompt;

  /** FR-78：文件夹下拉的选项 —— 「未归类」(value 0) + 全部文件夹树（同编辑器用的 buildFolderTree）。 */
  const folderTreeData = [{ value: 0, title: '未归类', key: 0, children: [] }, ...buildFolderTree(folders)];

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

      {/* FR-78：元信息行 —— 位置在**备注行之下、字段页签之上**（排版参考 PromptHub：小字号、次级色、不抢重心）；
          文件夹下拉可改（含「未归类」）、标签以 `#` 前缀胶囊显示且每个带 ✕、另有「添加标签」入口；
          改完立即生效（PUT 落库）并给出反馈，与编辑器 / 卡片 / 表格同源。
          FR-83 ①：间距做成**层级对称** —— 与备注行拉开（父容器 gap 16 + marginTop 4 = 20px，≥12px），
          且不大于与字段页签行的间距（gap 16 + marginBottom 8 = 24px），读起来是"独立的一行"而非备注的第二行。
          FR-83 ④：minWidth:0 + wrap —— 长文件夹名 / 多标签时换行，不把「+ 添加标签」顶出面板。 */}
      <Flex
        data-testid="pm-detail-meta"
        className="pm-detail-meta"
        align="center"
        gap={10}
        wrap
        style={{ fontSize: 12.5, color: token.colorTextSecondary, marginTop: 4, marginBottom: 8, minWidth: 0 }}
      >
        <TreeSelect
          data-testid="pm-detail-folder"
          aria-label="文件夹"
          size="small"
          value={prompt.folder_id ?? 0}
          onChange={(value) => onMetaChange(prompt, { folder_id: Number(value) === 0 ? null : Number(value) })}
          treeData={folderTreeData}
          treeDefaultExpandAll
          showSearch
          treeNodeFilterProp="title"
          popupMatchSelectWidth={220}
          style={{ minWidth: 140, maxWidth: 220, flex: '0 1 auto' }}
        />
        <Flex align="center" gap={4} wrap style={{ minWidth: 0, flex: '1 1 auto' }}>
          {prompt.tags.map((tag) => (
            <Tag
              key={tag}
              data-testid="pm-detail-tag"
              /* FR-83 ⑤：与左栏「胶囊云」同一套 chip 视觉（样式在 app.css 的 .pm-detail-meta .ant-tag.pm-tag-chip） */
              className="pm-tag-chip pm-detail-tag"
              closable
              closeIcon={<CloseOutlined data-testid="pm-detail-tag-remove" />}
              onClose={(event) => {
                event.preventDefault();
                onMetaChange(prompt, { tags: prompt.tags.filter((item) => item !== tag) });
              }}
            >
              #{tag}
            </Tag>
          ))}
          <Select
            data-testid="pm-detail-tag-add"
            aria-label="添加标签"
            size="small"
            mode="tags"
            value={[]}
            placeholder="+ 添加标签"
            style={{ minWidth: 110, flex: '0 0 auto' }}
            options={tags.map((tag) => ({ value: tag.name, label: tag.name }))}
            onChange={(values: string[]) => {
              const next = [...prompt.tags];
              for (const value of values) if (!next.includes(value)) next.push(value);
              if (next.length !== prompt.tags.length) onMetaChange(prompt, { tags: next });
            }}
          />
        </Flex>
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
        {/* FR-68：备注 = 纯文本（详情面由标题下的 `pm-detail-notes` 承担，FR-79 起不再有「备注」页签）；
            正文区只处理用户 / 系统提示词，`源码 / 显示纯文本` 时按原样文本显示（不请求 /api/render/markdown）。 */}
        {sourceMode || plain ? (
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

      {/* FR-80：详情面**不再渲染变量区块**（能力保留在编辑器右栏与复制时的 VarsDialog）。 */}
      <div ref={versionsRef}>
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
  folders,
  tags,
  onMetaChange,
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
      folders={folders}
      tags={tags}
      onMetaChange={onMetaChange}
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
