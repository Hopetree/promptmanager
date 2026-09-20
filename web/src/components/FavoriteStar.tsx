import { StarFilled, StarOutlined } from '@ant-design/icons';
import { Button, Tooltip, theme } from 'antd';
import type { Prompt } from '../types';

interface FavoriteStarProps {
  prompt: Prompt;
  /** 每个"屏"用不同 testid，便于 AC-57 在分栏/卡片/表格/详情四处分别定位 */
  testid: string;
  onToggle: (prompt: Prompt) => void;
}

/**
 * 收藏星标（FR-57 / AC-57）：**真正的可点控件**（antd Button 渲染为原生 button 元素 + cursor:pointer + aria-label），
 * 常驻可见（不依赖 hover）、热区 ≥24×24（`.pm-fav-btn`）、悬浮有「收藏 / 取消收藏」tooltip。
 * 分栏列表项 / 卡片 / 表格行 / 详情栏标题行四处共用同一组件，避免行为漂移。
 */
export default function FavoriteStar({ prompt, testid, onToggle }: FavoriteStarProps) {
  const { token } = theme.useToken();
  const label = prompt.favorite ? '取消收藏' : '收藏';
  return (
    <Tooltip title={label}>
      <Button
        type="text"
        size="small"
        className="pm-fav-btn"
        role="button"
        aria-label={label}
        data-testid={testid}
        icon={prompt.favorite ? <StarFilled /> : <StarOutlined />}
        style={{ color: prompt.favorite ? token.colorPrimary : token.colorTextQuaternary }}
        onClick={(event) => {
          event.stopPropagation();
          onToggle(prompt);
        }}
      />
    </Tooltip>
  );
}
