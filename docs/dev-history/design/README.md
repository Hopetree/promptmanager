# 设计打样索引（阶段 10A）

> 用户反馈「目前的 UI 效果不太行、太单调，要有设计感和美感」→ BRIEF v11 **FR-40**。
> 本目录是**打样**产物：三套自包含 HTML 设计稿 + 令牌草案 + 截图，**不改产品代码**（`web/src/` 零改动）。
> 挑选方式：在 `QUESTIONS.md` 的 **Q-1** 里选 A / B / C；选定后由阶段 10B 用 antd token 落地到全站。

## 三方向一览

| 方向 | 风格技能 | 一句话 | 设计稿 | 截图 | 说明 |
| --- | --- | --- | --- | --- | --- |
| **A** | `dark-saas`（Linear 式深色 SaaS） | 工程师的夜间操作台：近黑画布 + 表面色阶 + 唯一薰衣草蓝 | [`a-dark-saas/mockup.html`](a-dark-saas/mockup.html) | [`a-dark-saas/shots/`](a-dark-saas/shots/) | [design-notes](a-dark-saas/design-notes.md) ｜ [tokens](a-dark-saas/tokens.md) |
| **B** | `apple-minimal`（苹果极简白） | 把 prompt 当作品陈列：纯白 + 超大细字重标题 + 胶囊按钮 | [`b-apple-minimal/mockup.html`](b-apple-minimal/mockup.html) | [`b-apple-minimal/shots/`](b-apple-minimal/shots/) | [design-notes](b-apple-minimal/design-notes.md) ｜ [tokens](b-apple-minimal/tokens.md) |
| **C** | `japanese-minimal`（和式极简，**dsh 自选**） | 把 prompt 当文稿来管：纸感底 + 明朝体标题 + 细线 + 一枚朱红印章 | [`c-japanese-minimal/mockup.html`](c-japanese-minimal/mockup.html) | [`c-japanese-minimal/shots/`](c-japanese-minimal/shots/) | [design-notes](c-japanese-minimal/design-notes.md) ｜ [tokens](c-japanese-minimal/tokens.md) |

## 怎么打开看

```bash
# 直接用浏览器打开（自包含、离线可用、零外链）
open docs/design/a-dark-saas/mockup.html      # macOS；Linux 用 xdg-open，或直接把文件拖进浏览器
# 设计稿内的切换：#list（列表）/ #editor（编辑器）/ #import（导入导出）/ #import-confirm（二次确认）
# 截图模式：在 URL 后加 ?shot=1 隐藏底部的"设计稿导航"药丸
```

每个 `mockup.html` 都覆盖**真实功能结构**：顶栏（使用统计 / API 令牌 / 导入导出）、文件夹树 + 标签计数、
搜索/筛选/排序/只看收藏、九条真实夹具数据、分页、编辑器四字段 + 文件夹/标签/收藏、
版本历史 diff + 回滚、变量填值 + 渲染结果、Markdown 预览、导入导出与 **replace 二次确认**（文案与 FR-11b 逐字一致）。

## 重新截图

```bash
bash docs/design/tools/shoot.sh a-dark-saas        # 或 b-apple-minimal / c-japanese-minimal
```

零安装（`chrome-headless-shell` + Node 内置 WebSocket 直连 CDP），走 `file://`，**不起服务、不占 8767**；
每方向 5 张：`list-light` / `list-dark` / `editor-light` / `mobile-list`(390×844) / `import-confirm`。
