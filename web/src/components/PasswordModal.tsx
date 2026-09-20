import { LockOutlined } from '@ant-design/icons';
import { App as AntdApp, Form, Input, Modal, Typography } from 'antd';
import { useState } from 'react';
import { api, ApiError, describeError } from '../api';

interface PasswordModalProps {
  open: boolean;
  onClose: () => void;
}

interface PasswordForm {
  old_password: string;
  new_password: string;
  confirm_password: string;
}

/** 与新密码规则保持同一句话（服务端 `PASSWORD_RULE_MESSAGE` 的镜像：前端先拦一道、后端做死）。 */
const MIN_LENGTH = 8;
const RULE_TEXT = `新密码至少 ${String(MIN_LENGTH)} 个字符（按 Unicode 码点计），且不得与当前密码相同`;

/**
 * 「修改密码」弹窗（FR-67）：三个密码框（当前 / 新 / 确认）+ 前端校验 + 提交 `POST /api/password`。
 *
 * 关键口径：
 * - 前端先拦：新密码 ≥8 个 **Unicode 码点**、不得与当前密码相同、两次输入必须一致（**不一致不发请求**）；
 * - 服务端把「当前密码错误」定义成 **400 `invalid_old_password`**（不是 401）—— 所以这里不会把用户踢回登录页；
 * - 成功后提示「密码已更新」并补一句「已在其它登录会话中退出」（服务端保留当前会话、吊销其它会话）；
 * - 任何提示文案里都不带密码值（不回显）。
 */
export default function PasswordModal({ open, onClose }: PasswordModalProps) {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm<PasswordForm>();
  const [submitting, setSubmitting] = useState(false);

  const close = (): void => {
    form.resetFields();
    onClose();
  };

  const submit = async (): Promise<void> => {
    let values: PasswordForm;
    try {
      values = await form.validateFields();
    } catch {
      return; // 前端校验未过 → 不发请求
    }
    setSubmitting(true);
    try {
      await api.changePassword(values.old_password, values.new_password);
      message.success('密码已更新（已在其它登录会话中退出）');
      close();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'invalid_old_password') {
        form.setFields([{ name: 'old_password', errors: ['当前密码不正确'] }]);
      } else if (error instanceof ApiError && error.code === 'invalid_password') {
        form.setFields([{ name: 'new_password', errors: [error.serverMessage ?? RULE_TEXT] }]);
      } else if (error instanceof ApiError && error.status === 429) {
        message.warning('尝试过于频繁，请稍后再试');
      } else {
        message.error(describeError(error));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={close}
      onOk={() => void submit()}
      okText="确认修改"
      cancelText="取消"
      confirmLoading={submitting}
      maskClosable
      keyboard
      width={460}
      title={
        <span>
          <LockOutlined /> 修改密码
        </span>
      }
      rootClassName="pm-password-modal"
    >
      {/* data-testid 放在弹窗内容根节点上（antd Modal 的额外 props 不一定落到 DOM） */}
      <div data-testid="pm-password-modal">
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 12 }}>
          修改成功后，当前浏览器保持登录，其它已登录的会话会被退出。
        </Typography.Paragraph>
        <Form<PasswordForm> form={form} layout="vertical" requiredMark={false} onFinish={() => void submit()}>
          <Form.Item name="old_password" label="当前密码" rules={[{ required: true, message: '请输入当前密码' }]}>
            <Input.Password autoComplete="current-password" placeholder="当前密码" data-testid="pm-old-password" />
          </Form.Item>
          <Form.Item
            name="new_password"
            label="新密码"
            dependencies={['old_password']}
            rules={[
              { required: true, message: '请输入新密码' },
              ({ getFieldValue }) => ({
                validator: (_rule, value: unknown) => {
                  const text = typeof value === 'string' ? value : '';
                  if (text === '') return Promise.resolve();
                  if ([...text].length < MIN_LENGTH) return Promise.reject(new Error(RULE_TEXT));
                  if (text === getFieldValue('old_password')) {
                    return Promise.reject(new Error('新密码不得与当前密码相同'));
                  }
                  return Promise.resolve();
                },
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" placeholder="至少 8 个字符" data-testid="pm-new-password" />
          </Form.Item>
          <Form.Item
            name="confirm_password"
            label="确认新密码"
            dependencies={['new_password']}
            rules={[
              { required: true, message: '请再次输入新密码' },
              ({ getFieldValue }) => ({
                validator: (_rule, value: unknown) =>
                  value === getFieldValue('new_password')
                    ? Promise.resolve()
                    : Promise.reject(new Error('两次输入的新密码不一致')),
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" placeholder="再次输入新密码" data-testid="pm-confirm-password" />
          </Form.Item>
        </Form>
      </div>
    </Modal>
  );
}
