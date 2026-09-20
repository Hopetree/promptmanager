import { EyeOutlined } from '@ant-design/icons';
import { Alert, Flex, Select, Space, Spin, Tooltip, Typography, theme } from 'antd';
import { useEffect, useState } from 'react';
import { api, describeError } from '../api';
import '../styles/markdown.css';
import { EmptyState } from './States';

export interface PreviewField {
  key: string;
  label: string;
  text: string;
}

interface MarkdownPreviewProps {
  fields: PreviewField[];
}

/**
 * Markdown 预览（FR-9 / FR-11）：**直接把文本交给服务端** `POST /api/render/markdown`，
 * 返回的是服务端净化 + 高亮后的 HTML —— 前端不重写净化、不引第三方渲染器。
 */
export default function MarkdownPreview({ fields }: MarkdownPreviewProps) {
  const { token } = theme.useToken();
  const [activeKey, setActiveKey] = useState<string>(fields[0]?.key ?? '');
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = fields.find((field) => field.key === activeKey) ?? fields[0];
  const text = active?.text ?? '';

  useEffect(() => {
    if (text === '') {
      setHtml('');
      setError(null);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void (async () => {
        try {
          const response = await api.renderMarkdown(text);
          if (alive) {
            setHtml(response.html);
            setError(null);
          }
        } catch (caught) {
          if (alive) setError(describeError(caught));
        } finally {
          if (alive) setLoading(false);
        }
      })();
    }, 300);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [text]);

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      {/*
        FR-66（R-1）：**单字段**场景（详情面 —— 字段切换已由上方页签负责）不再渲染这行头部：
        下拉会退化成只有一个选项的摆设，右侧「👁 预览」也只是说明标签。
        多字段场景（编辑器页的 用户提示词/系统提示词/备注 三项）保持现状。
      */}
      {fields.length > 1 && (
        <Flex gap={8} wrap align="center">
          <Select
            style={{ width: 200 }}
            value={active?.key}
            options={fields.map((field) => ({ value: field.key, label: field.label }))}
            onChange={(value: string) => setActiveKey(value)}
          />
          <Typography.Text type="secondary">
            <Tooltip title="在服务端完成渲染（净化 + 代码高亮）">
              <EyeOutlined /> 预览
            </Tooltip>
          </Typography.Text>
        </Flex>
      )}

      {error !== null && <Alert type="error" showIcon message={error} />}

      {active === undefined || text === '' ? (
        <EmptyState title="这个字段还是空的" hint="写点 Markdown，右侧会实时渲染" />
      ) : (
        <Spin spinning={loading}>
          <div
            data-testid="markdown-preview"
            className="pm-markdown"
            style={{
              padding: 16,
              borderRadius: token.borderRadius,
              border: `1px solid ${token.colorBorderSecondary}`,
              background: token.colorBgContainer,
              minHeight: 120,
            }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </Spin>
      )}
    </Space>
  );
}
