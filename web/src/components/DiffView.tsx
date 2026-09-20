import { theme } from 'antd';
import { classifyDiffLines, type DiffLineType } from '../pure';

interface DiffViewProps {
  diff: string;
}

/** 版本 diff 的着色展示（文本来自服务端 `/api/prompts/:id/diff` 的 unified diff）。 */
export default function DiffView({ diff }: DiffViewProps) {
  const { token } = theme.useToken();

  const background: Record<DiffLineType, string> = {
    add: token.colorSuccessBg,
    del: token.colorErrorBg,
    meta: token.colorFillTertiary,
    ctx: 'transparent',
  };
  const foreground: Record<DiffLineType, string> = {
    add: token.colorSuccessText,
    del: token.colorErrorText,
    meta: token.colorTextTertiary,
    ctx: token.colorText,
  };

  return (
    <pre
      data-testid="diff-view"
      style={{
        margin: 0,
        padding: 12,
        maxHeight: 360,
        overflow: 'auto',
        fontSize: 12,
        lineHeight: 1.6,
        borderRadius: token.borderRadius,
        background: token.colorFillQuaternary,
      }}
    >
      {classifyDiffLines(diff).map((line, index) => (
        <div
          key={`${String(index)}-${line.type}`}
          title={line.text}
          style={{
            background: background[line.type],
            color: foreground[line.type],
            // 不折行：diff 在 380px 的检查器列里宁可截断，也不要在 {{变量}} 中间硬断词
            whiteSpace: 'pre',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            minHeight: '1.6em',
          }}
        >
          {line.text === '' ? ' ' : line.text}
        </div>
      ))}
    </pre>
  );
}
