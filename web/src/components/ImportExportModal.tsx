import { DownloadOutlined, InboxOutlined, UploadOutlined } from '@ant-design/icons';
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Descriptions,
  Divider,
  Flex,
  Modal,
  Segmented,
  Space,
  Typography,
  Upload,
} from 'antd';
import type { UploadFile } from 'antd';
import { useState } from 'react';
import { api, ApiError, describeError } from '../api';
import { analyzeImportFile, formatImportDetails, REPLACE_WARNING, type ImportAnalysis } from '../pure';
import type { ImportResult } from '../types';

interface ImportExportModalProps {
  open: boolean;
  onClose: () => void;
  /** 导入成功后刷新列表 / 文件夹 / 标签 */
  onImported: () => void;
}

/**
 * 导入 / 导出（FR-10 / FR-11b）：
 * - 导出：`GET /api/export` 全量 JSON（浏览器下载，不经第三方）；
 * - 导入：先本地解析出"将新增 N 条"，`replace` 模式**二次确认**并逐字提示会清空什么（FR-11b）。
 */
export default function ImportExportModal({ open, onClose, onImported }: ImportExportModalProps) {
  const { message, modal } = AntdApp.useApp();
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);

  const reset = (): void => {
    setFileList([]);
    setAnalysis(null);
    setResult(null);
    setImportErrors([]);
    setMode('merge');
  };

  const close = (): void => {
    reset();
    onClose();
  };

  const doExport = async (): Promise<void> => {
    setExporting(true);
    try {
      const data = await api.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `promptmanager-export-${data.exported_at.slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      message.success(
        `已导出：prompt ${String(data.prompts.length)} 条 / 文件夹 ${String(data.folders.length)} 个 / 标签 ${String(data.tags.length)} 个`,
      );
    } catch (error) {
      message.error(describeError(error));
    } finally {
      setExporting(false);
    }
  };

  const readFile = (file: File): void => {
    const reader = new FileReader();
    reader.onload = () => {
      setAnalysis(analyzeImportFile(typeof reader.result === 'string' ? reader.result : ''));
      setResult(null);
    };
    reader.onerror = () => {
      setAnalysis({ ok: false, error: '文件读取失败' });
    };
    reader.readAsText(file);
  };

  const doImport = async (): Promise<void> => {
    if (analysis === null || !analysis.ok) return;
    setImporting(true);
    try {
      const imported = await api.importAll(mode, analysis.file);
      setResult(imported);
      setImportErrors([]);
      message.success(
        `导入完成：prompt ${String(imported.imported.prompts)} 条 / 文件夹 ${String(imported.imported.folders)} 个 / 标签 ${String(imported.imported.tags)} 个`,
      );
      onImported();
    } catch (error) {
      // 服务端校验（如 FR-10b 的"缺 title/user_prompt"）→ 把后端给的原因如实显示，前端不复刻校验
      if (error instanceof ApiError) {
        const lines = formatImportDetails(error.details);
        if (lines.length > 0) {
          setImportErrors(lines);
          message.error(`${describeError(error)}：${lines[0] ?? ''}`);
          return;
        }
      }
      setImportErrors([]);
      message.error(describeError(error));
    } finally {
      setImporting(false);
    }
  };

  const confirmImport = (): void => {
    if (analysis === null || !analysis.ok) return;
    const counts = analysis.counts;
    if (mode === 'replace') {
      // FR-11b：replace 必须二次确认，并明示会被清空的对象
      modal.confirm({
        title: '确认以 replace 模式导入？',
        okText: '清空并导入',
        okButtonProps: { danger: true },
        cancelText: '取消',
        width: 520,
        content: (
          <Space direction="vertical" size={8}>
            <Typography.Text strong type="danger">
              {REPLACE_WARNING}
            </Typography.Text>
            <Typography.Text>
              随后按文件重建：prompt {counts.prompts} 条 / 文件夹 {counts.folders} 个 / 标签 {counts.tags} 个。
            </Typography.Text>
            <Typography.Text type="secondary">此操作不可撤销；建议先导出当前数据留底。</Typography.Text>
          </Space>
        ),
        onOk: doImport,
      });
      return;
    }
    modal.confirm({
      title: '确认以 merge 模式导入？',
      okText: '开始导入',
      cancelText: '取消',
      content: (
        <Space direction="vertical" size={8}>
          <Typography.Text>
            不清空现有数据，将新增 prompt {counts.prompts} 条；文件夹 {counts.folders} 个、标签 {counts.tags} 个（同名复用）。
          </Typography.Text>
        </Space>
      ),
      onOk: doImport,
    });
  };

  return (
    <Modal
      open={open}
      onCancel={close}
      onOk={close}
      okText="关闭"
      cancelButtonProps={{ style: { display: 'none' } }}
      title="导入 / 导出"
      width={640}
      rootClassName="pm-import-export"
    >
      <Card size="small" title="导出（备份）" style={{ marginBottom: 12 }}>
        <Flex justify="space-between" align="center" gap={12} wrap>
          <Typography.Text type="secondary">
            自有 JSON 格式（含版本历史）；备份 = 保存这个文件。
          </Typography.Text>
          <Button icon={<DownloadOutlined />} loading={exporting} onClick={() => void doExport()} data-testid="export-button">
            导出全部 JSON
          </Button>
        </Flex>
      </Card>

      <Card size="small" title="导入">
        <Upload.Dragger
          accept=".json,application/json"
          maxCount={1}
          fileList={fileList}
          beforeUpload={(file) => {
            setFileList([file as unknown as UploadFile]);
            readFile(file);
            return false;
          }}
          onRemove={() => {
            reset();
          }}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">点击或拖拽 JSON 文件到此处</p>
          <p className="ant-upload-hint">文件只在浏览器本地解析，确认后才会上传</p>
        </Upload.Dragger>

        {analysis !== null && !analysis.ok && (
          <Alert type="error" showIcon style={{ marginTop: 12 }} message="这个文件不能导入" description={analysis.error} />
        )}

        {analysis !== null && analysis.ok && (
          <Space direction="vertical" size={12} style={{ width: '100%', marginTop: 12 }}>
            <Descriptions
              size="small"
              column={3}
              bordered
              items={[
                { key: 'prompts', label: 'prompt', children: analysis.counts.prompts },
                { key: 'folders', label: '文件夹', children: analysis.counts.folders },
                { key: 'tags', label: '标签', children: analysis.counts.tags },
              ]}
            />
            <Flex gap={8} align="center" wrap>
              <Typography.Text>导入模式</Typography.Text>
              <Segmented
                value={mode}
                onChange={(value) => setMode(value as 'merge' | 'replace')}
                options={[
                  { value: 'merge', label: 'merge（追加，不清库）' },
                  { value: 'replace', label: 'replace（清空重建）' },
                ]}
              />
            </Flex>

            {mode === 'replace' ? (
              <Alert
                type="warning"
                showIcon
                message="replace 模式会先清空现有数据"
                description={REPLACE_WARNING}
              />
            ) : (
              <Alert
                type="info"
                showIcon
                message={`merge 模式：将新增 prompt ${String(analysis.counts.prompts)} 条、文件夹 ${String(analysis.counts.folders)} 个、标签 ${String(analysis.counts.tags)} 个`}
                description="同名文件夹 / 标签会复用，现有数据不动。"
              />
            )}

            <Button
              type="primary"
              danger={mode === 'replace'}
              icon={<UploadOutlined />}
              loading={importing}
              onClick={confirmImport}
              data-testid="import-submit"
            >
              {mode === 'replace' ? '导入（清空重建，需二次确认）' : '导入（merge）'}
            </Button>
          </Space>
        )}

        {importErrors.length > 0 && (
          <Alert
            type="error"
            showIcon
            style={{ marginTop: 12 }}
            message="服务端拒绝了这个文件（数据未被改动）"
            description={
              <Space direction="vertical" size={2}>
                {importErrors.map((line) => (
                  <Typography.Text key={line} style={{ fontSize: 12 }}>
                    {line}
                  </Typography.Text>
                ))}
              </Space>
            }
          />
        )}

        {result !== null && (
          <>
            <Divider style={{ margin: '12px 0' }} />
            <Alert
              type="success"
              showIcon
              message={`导入完成（${result.mode}）`}
              description={`prompt ${String(result.imported.prompts)} 条 / 文件夹 ${String(result.imported.folders)} 个 / 标签 ${String(result.imported.tags)} 个`}
            />
          </>
        )}
      </Card>
    </Modal>
  );
}
