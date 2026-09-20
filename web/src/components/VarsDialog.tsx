import { CopyOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { Alert, Button, Flex, Form, Input, Modal, Space, Spin, Tag, Typography, theme } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, describeError } from '../api';
import { filledValues, previewRender } from '../pure';
import type { Prompt } from '../types';

interface VarsDialogProps {
  /** 待填值的条目；null = 对话框关闭 */
  prompt: Prompt | null;
  busy: boolean;
  onCancel: () => void;
  /** 点「复制结果」：由调用方走服务端 /render（记取用）并写剪贴板 */
  onConfirm: (prompt: Prompt, values: Record<string, string>) => void;
}

/** 变量值按 prompt 记忆（FR-41e 第 2 条「自动记忆」）——localStorage，不新增接口。 */
const storageKey = (promptId: number): string => `pm-vars:${String(promptId)}`;

function readRemembered(promptId: number): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(storageKey(promptId));
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function writeRemembered(promptId: number, values: Record<string, string>): void {
  try {
    window.localStorage.setItem(storageKey(promptId), JSON.stringify(values));
  } catch {
    /* 隐私模式等场景写不进就算了，不影响复制 */
  }
}

/**
 * 填变量对话框（FR-41e 第 2 条 / AC-33b）：
 * 「请填写变量值（自动记忆）」+ 每个变量一个输入框（`pm-var-input-<name>`）+
 * 实时预览（`pm-vars-preview`）+ 底部「取消」/「复制结果」。
 * 预览用 `previewRender`（与服务端 `/render` 同规则，见 tests/variables-preview-parity.test.ts）；
 * **最终复制以服务端渲染结果为准**。
 */
export default function VarsDialog({ prompt, busy, onCancel, onConfirm }: VarsDialogProps) {
  const { token } = theme.useToken();
  const [form] = Form.useForm<Record<string, string>>();
  const [variables, setVariables] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});

  const load = useCallback(async (target: Prompt): Promise<void> => {
    setVariables(null);
    setError(null);
    try {
      const response = await api.variables(target.id);
      const remembered = readRemembered(target.id);
      setVariables(response.variables);
      // 只预填**记忆里真的有的**值：未填的变量保持"未提供"，
      // 这样预览会原样显示 `{{项目}}`（与服务端一致），而不是先看到占位符凭空消失。
      const initial = filledValues(response.variables, remembered);
      setValues(initial);
      form.setFieldsValue(initial);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setError('会话已失效，请重新登录');
        return;
      }
      setError(describeError(caught));
    }
  }, [form]);

  useEffect(() => {
    if (prompt !== null) void load(prompt);
  }, [load, prompt]);

  if (prompt === null) return null;

  const preview = previewRender(prompt.user_prompt, values);
  // 变量名单来自服务端 `/variables`（单一真相源，不在前端另解析 prompt）；
  // `values` 只含已填项（`filledValues` 已剔除空串），因此"不在 values 里" == 未填。
  const missing = (variables ?? []).filter((name) => values[name] === undefined);

  const confirm = (): void => {
    writeRemembered(prompt.id, values);
    onConfirm(prompt, values);
  };

  return (
    <Modal
      open
      onCancel={onCancel}
      width={640}
      title="请填写变量值（自动记忆）"
      styles={{ body: { paddingTop: 8 } }}
      footer={
        <Flex justify="space-between" align="center" gap={8}>
          <Typography.Text
            style={{ fontSize: 12, color: missing.length === 0 ? token.colorTextTertiary : token.colorWarning }}
          >
            <span data-testid="pm-vars-missing">
              {missing.length === 0
                ? '未填 0 个 · 已填全，可直接复制'
                : `未填 ${String(missing.length)} 个（预览与复制结果里保留原样占位符）`}
            </span>
          </Typography.Text>
          <Space>
            <Button onClick={onCancel}>取消</Button>
            <Button type="primary" icon={<CopyOutlined />} loading={busy} onClick={confirm} data-testid="pm-vars-confirm">
              复制结果
            </Button>
          </Space>
        </Flex>
      }
    >
      <Flex vertical gap={12} data-testid="pm-vars-dialog">
        <Typography.Text style={{ fontSize: 12, color: token.colorTextTertiary }}>
          {prompt.title === '' ? '(无标题)' : prompt.title} · <span className="pm-mono">#{String(prompt.id)}</span>
        </Typography.Text>

        {error !== null && <Alert type="error" showIcon message={error} />}

        {variables === null && error === null && (
          <Flex align="center" justify="center" style={{ padding: 24 }}>
            <Spin tip="正在读取变量…">
              <div style={{ width: 120, height: 40 }} />
            </Spin>
          </Flex>
        )}

        {variables !== null && (
          <>
            <Form
              form={form}
              layout="vertical"
              onValuesChange={(_changed, all) => {
                // 只把已填写的变量放进 values；未填的（空串/undefined）一律剔除，
                // 服务端才会按 §6.5 把它们原样保留成 `{{name}}`。
                setValues(filledValues(variables, all as Record<string, unknown>));
              }}
            >
              <Flex gap={12} wrap>
                {variables.map((name) => (
                  <Form.Item
                    key={name}
                    name={name}
                    label={name}
                    style={{ flex: '1 1 240px', minWidth: 200, marginBottom: 8 }}
                  >
                    <Input placeholder={`{{${name}}} 的值`} data-testid={`pm-var-input-${name}`} />
                  </Form.Item>
                ))}
              </Flex>
            </Form>

            <div>
              <Flex align="center" gap={8} style={{ marginBottom: 6 }}>
                <ThunderboltOutlined style={{ color: token.colorPrimary }} />
                <Typography.Text style={{ fontSize: 12, fontWeight: 600 }}>实时预览</Typography.Text>
                {missing.length === 0 ? (
                  <Tag color="green" style={{ marginInlineStart: 'auto' }}>
                    变量已全部替换
                  </Tag>
                ) : (
                  <Tag color="orange" style={{ marginInlineStart: 'auto' }}>
                    {missing.join(' / ')} 未填
                  </Tag>
                )}
              </Flex>
              <div
                data-testid="pm-vars-preview"
                className="pm-mono"
                style={{
                  maxHeight: 220,
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  padding: 12,
                  borderRadius: token.borderRadius,
                  border: `1px solid ${token.colorBorderSecondary}`,
                  background: token.colorFillQuaternary,
                  fontSize: 12,
                }}
              >
                {preview}
              </div>
            </div>
          </>
        )}
      </Flex>
    </Modal>
  );
}
