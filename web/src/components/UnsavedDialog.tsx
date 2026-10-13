import { Button, Flex, Modal, Typography } from 'antd';

/**
 * FR-152 / AC-133 B6：离开编辑器前的确认（继续编辑 / 放弃修改）。
 *
 * 关闭时**整体不挂载** —— 这样"确认弹窗还在不在"在 DOM 上分得清（渲染级断言要看这个）。
 */
export default function UnsavedDialog({
  open,
  onKeep,
  onDiscard,
}: {
  open: boolean;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  if (!open) return null;
  return (
    <Modal
      open
      title="放弃未保存的修改？"
      onCancel={onKeep}
      footer={null}
      width="min(420px, 92vw)"
      rootClassName="pm-unsaved"
    >
      <div data-testid="pm-unsaved-confirm">
        <Typography.Text>当前编辑还没保存，离开会丢掉这些改动。</Typography.Text>
        <Flex justify="flex-end" gap={8} style={{ marginTop: 16 }}>
          <Button data-testid="pm-unsaved-keep" onClick={onKeep}>
            继续编辑
          </Button>
          <Button danger data-testid="pm-unsaved-discard" onClick={onDiscard}>
            放弃修改
          </Button>
        </Flex>
      </div>
    </Modal>
  );
}
