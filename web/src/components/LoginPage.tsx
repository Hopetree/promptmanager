import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { Alert, App as AntdApp, Button, Flex, Form, Input, Typography, theme } from 'antd';
import { useState } from 'react';
import { api, describeError } from '../api';

interface LoginPageProps {
  onSuccess: (username: string) => void;
}

interface LoginForm {
  username: string;
  password: string;
}

/**
 * 登录页（BRIEF D-19：登录页按方向 B｜apple-minimal 的极简做——纯白画布、大号细字重标题、
 * 大留白、胶囊按钮；亮/暗仍跟随系统：暗色下按同一套原语取近黑画布 + 深灰输入区）。
 */
export default function LoginPage({ onSuccess }: LoginPageProps) {
  const { message } = AntdApp.useApp();
  const { token } = theme.useToken();
  const prefersDark = token.colorBgLayout === '#010102' || token.colorText === '#f7f8f8';
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (values: LoginForm): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.login(values.username, values.password);
      message.success(`欢迎回来，${result.username}`);
      onSuccess(result.username);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setSubmitting(false);
    }
  };

  const canvas = prefersDark ? '#010102' : '#ffffff';
  const ink = prefersDark ? '#f7f8f8' : '#1d1d1f';
  const muted = prefersDark ? '#a1a1a6' : '#6e6e73';
  const field = prefersDark ? '#161617' : '#f5f5f7';

  return (
    <Flex
      vertical
      align="center"
      justify="center"
      style={{ minHeight: '100vh', background: canvas, padding: '48px 24px' }}
      data-testid="pm-login"
    >
      <div style={{ width: '100%', maxWidth: 420 }}>
        {/* FR-59：品牌图形（同一枚图标，登录页用 96） */}
        <Flex justify="center" style={{ marginBottom: 20 }}>
          <img
            src="/promptmanager-96.png"
            width={96}
            height={96}
            alt=""
            aria-hidden="true"
            className="pm-brand-art"
            data-testid="pm-brand-art-login"
          />
        </Flex>
        <Flex vertical gap={10} style={{ marginBottom: 36 }}>
          <Typography.Title
            level={1}
            style={{ margin: 0, fontSize: 40, fontWeight: 600, letterSpacing: '-0.021em', lineHeight: 1.08, color: ink }}
          >
            PromptManager
          </Typography.Title>
        </Flex>

        {error !== null && <Alert type="error" showIcon message={error} style={{ marginBottom: 20 }} />}

        {/* FR-88 ①（P0 安全）：**不得**给表单任何"初始值"属性 —— 页面加载即出现默认账号名
            等于向未认证访客暴露账号名。用户名框必须初始为空，且 placeholder 用中性文案（不带任何真实账号名）。
            ⚠️ 本文件源码里**既不得出现那个默认账号名、也不得出现预填属性名**（AC-90 ② 是纯文本 grep 断言）。 */}
        <Form<LoginForm>
          layout="vertical"
          requiredMark={false}
          onFinish={(values) => void submit(values)}
        >
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input
              prefix={<UserOutlined style={{ color: muted }} />}
              placeholder="用户名"
              autoComplete="username"
              size="large"
              variant="filled"
              style={{ background: field, borderRadius: 12, height: 46 }}
            />
          </Form.Item>
          <Form.Item name="password" label="口令" rules={[{ required: true, message: '请输入口令' }]}>
            <Input.Password
              prefix={<LockOutlined style={{ color: muted }} />}
              placeholder="口令"
              autoComplete="current-password"
              size="large"
              variant="filled"
              style={{ background: field, borderRadius: 12, height: 46 }}
            />
          </Form.Item>
          <Form.Item style={{ marginTop: 28, marginBottom: 28 }}>
            <Button
              type="primary"
              htmlType="submit"
              size="large"
              block
              loading={submitting}
              style={{ height: 46, borderRadius: 980, fontWeight: 500, background: ink, color: canvas }}
            >
              登录
            </Button>
          </Form.Item>
        </Form>
      </div>
    </Flex>
  );
}
