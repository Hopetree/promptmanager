import { CopyOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { App as AntdApp, Alert, Button, Card, Flex, Form, Input, Space, Tag, Typography } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, describeError } from '../api';
import { writeClipboard } from '../use-copy';
import type { RenderResult } from '../types';
import { ErrorState, LoadingState } from './States';

interface VariablePanelProps {
  /** null = 这条还没保存（新建草稿，FR-45）→ 不请求服务端，显示占位 */
  promptId: number | null;
  onUnauthorized: () => void;
}

/** 变量填值面板（FR-8 / FR-11）：`/variables` 取变量 → 填值 → `/render` 出成品 → 一键复制。 */
export default function VariablePanel({ promptId, onUnauthorized }: VariablePanelProps) {
  const { message } = AntdApp.useApp();
  const [variables, setVariables] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [result, setResult] = useState<RenderResult | null>(null);
  const [form] = Form.useForm<Record<string, string>>();

  useEffect(() => {
    if (promptId === null) {
      setVariables([]);
      setLoading(false);
      setResult(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setResult(null);
    void (async () => {
      try {
        const response = await api.variables(promptId);
        if (alive) setVariables(response.variables);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          onUnauthorized();
          return;
        }
        message.error(describeError(error));
        if (alive) setVariables([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [message, onUnauthorized, promptId]);

  const render = async (): Promise<void> => {
    if (promptId === null) return;
    const values = form.getFieldsValue();
    setRendering(true);
    try {
      // 只提交非空值：空串会被当成"未提供"，服务端把该变量列入 missing（BRIEF §6.5）
      const filled: Record<string, string> = {};
      for (const [key, value] of Object.entries(values)) {
        if (typeof value === 'string' && value !== '') filled[key] = value;
      }
      setResult(await api.render(promptId, filled));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onUnauthorized();
        return;
      }
      message.error(describeError(error));
    } finally {
      setRendering(false);
    }
  };

  /**
   * 复制渲染结果（FR-65）：**必须**走 `use-copy` 的 `writeClipboard`（内含内网 HTTP 的 execCommand 兜底），
   * 不能再直连 async clipboard —— 内网 IP 访问时那个 API 根本不存在，会一律失败。
   */
  const copy = async (text: string, label: string): Promise<void> => {
    const ok = await writeClipboard(text);
    if (ok) message.success(`已复制${label}`);
    else message.warning('浏览器拒绝了剪贴板访问，请手动选中复制');
  };

  if (loading) {
    return (
      <LoadingState rows={3} label="正在提取变量…" />
    );
  }

  if (promptId === null) {
    return <Alert type="info" showIcon message="保存后可以在这里填变量并渲染。" />;
  }

  if (variables === null) {
    return <ErrorState message="变量读取失败" />;
  }

  if (variables.length === 0) {
    return <Alert type="info" showIcon message="这条 prompt 没有 {{变量}}，可直接使用。" />;
  }

  const missing = result?.missing ?? [];

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message={`这条有 ${String(variables.length)} 个变量，填好后渲染`}
      />
      <Form form={form} layout="vertical" onFinish={() => void render()}>
        {variables.map((name) => (
          <Form.Item key={name} name={name} label={name} style={{ marginBottom: 8 }}>
            <Input placeholder={`{{${name}}} 的值`} data-testid={`var-${name}`} />
          </Form.Item>
        ))}
        <Flex gap={8} wrap>
          <Button type="primary" icon={<ThunderboltOutlined />} htmlType="submit" loading={rendering} data-testid="render-submit">
            渲染
          </Button>
          <Button
            onClick={() => {
              form.resetFields();
              setResult(null);
            }}
          >
            清空填值
          </Button>
        </Flex>
      </Form>

      {result !== null && (
        <>
          {missing.length > 0 && (
            <Alert
              type="warning"
              showIcon
              message={
                <Space size={4} wrap>
                  未提供值的变量会原样保留：
                  {missing.map((name) => (
                    <Tag key={name} color="orange">
                      {name}
                    </Tag>
                  ))}
                </Space>
              }
            />
          )}

          <Card
            size="small"
            title="渲染结果 · 用户提示词"
            extra={
              <Button size="small" icon={<CopyOutlined />} onClick={() => void copy(result.user_prompt, '用户提示词')} data-testid="copy-user">
                复制
              </Button>
            }
          >
            <Input.TextArea
              value={result.user_prompt}
              readOnly
              autoSize={{ minRows: 2, maxRows: 14 }}
              placeholder="（空）"
              style={{ fontFamily: 'monospace' }}
            />
          </Card>

          <Card
            size="small"
            title="渲染结果 · 系统提示词"
            extra={
              <Button size="small" icon={<CopyOutlined />} onClick={() => void copy(result.system_prompt, '系统提示词')}>
                复制
              </Button>
            }
          >
            <Input.TextArea
              value={result.system_prompt}
              readOnly
              autoSize={{ minRows: 2, maxRows: 14 }}
              placeholder="（空）"
              style={{ fontFamily: 'monospace' }}
            />
          </Card>
        </>
      )}
    </Space>
  );
}
