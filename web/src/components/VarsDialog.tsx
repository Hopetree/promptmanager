import { CopyOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { Alert, Button, Checkbox, Flex, Form, Input, Modal, Space, Spin, Tag, Typography, theme } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, describeError } from '../api';
import {
  filledValues,
  hasAnyFilled,
  missingVariables,
  previewRender,
  readRememberedVars,
  removeRememberedVars,
  varsDialogTitle,
  writeRememberedVars,
} from '../pure';
import type { Prompt } from '../types';

interface VarsDialogProps {
  /** 待填值的条目；null = 对话框关闭 */
  prompt: Prompt | null;
  busy: boolean;
  onCancel: () => void;
  /** 点「复制结果」：由调用方走服务端 /render（记取用）并写剪贴板 */
  onConfirm: (prompt: Prompt, values: Record<string, string>) => void;
  /** FR-127 / D-59 ④：弹窗里的勾选框改了 ⇒ 写服务端同一字段（由调用方 PUT + 同步本地视图）。 */
  onRememberChange: (prompt: Prompt, remember: boolean) => void;
}

// FR-41e 第 2 条「自动记忆」的读写助手已提到 `web/src/pure.ts`
// （`readRememberedVars` / `writeRememberedVars` / `removeRememberedVars`，键 `pm-vars:<id>`），
// 这样"记忆"只有一份实现，且能在 node:test 里用内存版存储机械验证（D-59 ⑦：介质仍是 localStorage）。

/**
 * 填变量对话框（FR-41e 第 2 条 / AC-33b；FR-127 / FR-128 增强）：
 * 标题（记住 ⇒ 「请填写变量值（自动记忆）」；不记住 ⇒ 去掉括号那段）+ 每个变量一个输入框
 * （`pm-var-input-<name>`）+ 实时预览（`pm-vars-preview`）+ 底部「清空」/「取消」/「复制结果」。
 * 预览用 `previewRender`（与服务端 `/render` 同规则，见 tests/variables-preview-parity.test.ts）；
 * **最终复制以服务端渲染结果为准**。
 * 所有触发位置（分栏 / 表格 / 卡片 / 详情）共用这一个组件 ⇒ 新能力各处都生效（AC-123 ㉒）。
 */
export default function VarsDialog({ prompt, busy, onCancel, onConfirm, onRememberChange }: VarsDialogProps) {
  const { token } = theme.useToken();
  const [form] = Form.useForm<Record<string, string>>();
  const [variables, setVariables] = useState<string[] | null>(null);
  /** FR-126：服务端给的默认值表（只有写了 `| default(...)` 的变量才在里面）。 */
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  /** FR-127：勾选框的本地状态；初值来自服务端字段（`prompt.remember_variables`）。 */
  const [remember, setRemember] = useState(true);

  const load = useCallback(async (target: Prompt): Promise<void> => {
    setVariables(null);
    setError(null);
    try {
      const response = await api.variables(target.id);
      // FR-127 / AC-123 ⑧：**不记住就绝不预填**（读都不读），这样"取消勾选后不点复制直接
      // 关闭再打开 ⇒ 还是空的"成立；勾选时保持既有行为。
      const wantsMemory = target.remember_variables;
      setRemember(wantsMemory);
      const remembered = wantsMemory ? readRememberedVars(target.id) : {};
      setVariables(response.variables);
      setDefaults(response.defaults);
      // 只预填**记忆里真的有的**值：未填的变量保持"未提供"，
      // 这样预览会原样显示 `{{项目}}`（与服务端一致），而不是先看到占位符凭空消失。
      const initial = filledValues(response.variables, remembered);
      setValues(initial);
      // ⚠️ antd 的 `setFieldsValue` **不会清空未提供的字段**：只传 `initial` 时，上一次打开
      // 留在 Form 里的字会原样显示 —— 看起来就像"被预填了"，与「不记住 ⇒ 打开就是空的」相悖。
      // 所以把**每个变量**都显式写一遍，没记忆的一律写空串（FR-127 / AC-123 ⑧）。
      const formValues: Record<string, string> = {};
      for (const name of response.variables) formValues[name] = initial[name] ?? '';
      form.setFieldsValue(formValues);
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
  // FR-126：**有默认值的变量不算"没填"**（留空 ⇒ 渲染时用默认值），计数与提示都不该把它算进去。
  const missing = missingVariables(variables ?? [], values, defaults);

  /** FR-127 / D-59 ⑤：取消勾选**即时生效** —— 立刻删掉已存记忆，不等「复制结果」。 */
  const toggleRemember = (next: boolean): void => {
    setRemember(next);
    if (!next) removeRememberedVars(prompt.id);
    onRememberChange(prompt, next);
  };

  const confirm = (): void => {
    if (remember) {
      writeRememberedVars(prompt.id, values);
    } else {
      // 不记住：连历史一起清掉，免得之后重新勾上时旧值"诈尸"（FR-127）。
      removeRememberedVars(prompt.id);
    }
    onConfirm(prompt, values);
  };

  /** FR-128：一键清空 = 彻底重置（清表单 **且** 删记忆；不做二次确认）。 */
  const clear = (): void => {
    form.resetFields();
    setValues({});
    removeRememberedVars(prompt.id);
  };

  return (
    <Modal
      open
      onCancel={onCancel}
      /* FR-81：宽、高各加大 ≥15%（改前实测 640×398 → 760×≥477；基线见 tools/ac-stage27.sh 的 AC82_BASELINE_*）。
         所有触发位置（分栏 / 表格 / 卡片 / 编辑器）共用这一个组件，改一处即全生效。 */
      width={760}
      /* FR-127 / AC-123 ⑫：不记住时标题**不含**「（自动记忆）」。 */
      title={varsDialogTitle(remember)}
      styles={{ body: { paddingTop: 8, minHeight: 360 } }}
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
            {/* FR-128：一键清空（与「取消」「复制结果」同一行；无二次确认；全空时置灰）。 */}
            <Button onClick={clear} disabled={!hasAnyFilled(values)} data-testid="pm-vars-clear">
              清空
            </Button>
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

        {/* FR-127 / D-59 ④：开关的**第一处入口**（另一处在提示词编辑页），读写同一个服务端字段；
            取消勾选即时生效（不必点「复制结果」）。 */}
        <Checkbox checked={remember} onChange={(event) => toggleRemember(event.target.checked)} data-testid="pm-vars-remember">
          记住这些变量值（下次自动填充）
        </Checkbox>

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
                    label={defaults[name] !== undefined ? `${name}（可留空）` : name}
                    style={{ flex: '1 1 240px', minWidth: 200, marginBottom: 8 }}
                  >
                    <Input
                      placeholder={defaults[name] !== undefined ? `留空则用默认值：${defaults[name]}` : `{{${name}}} 的值`}
                      data-testid={`pm-var-input-${name}`}
                    />
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
                  maxHeight: 280,
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
