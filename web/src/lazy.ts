/**
 * 懒加载边界（FR-61 / AC-61）：**只在真正要用时才加载**的重组件。
 *
 * 背景：阶段 18 开工前 `dist/web/assets/index-*.js` = 1,265 KB（gzip 400 KB），每次构建都触发 Vite 的
 * 500 KB 体积告警。这里把「编辑 / 预览 / 版本 diff / 导入导出 / 使用统计 / 令牌」等**非首屏必需**的
 * 重组件改成 `React.lazy` + 动态 `import()`：它们连同其 antd 依赖一起被移出首屏图，用到才取。
 *
 * 约定：
 * - 只用 `lazy()` 声明，**不在这里渲染**；每个使用点必须配 `<Suspense fallback={…}>` 兜底（首屏不空白）；
 * - 模态 / 抽屉类组件由调用方**按需挂载**（`{open && <Suspense>…}`），否则一渲染就会触发 import，懒加载失效；
 * - 功能与接口契约不变，只是加载时机变了（FR-61 的硬要求）。
 */
import { lazy } from 'react';

/** 编辑器（三栏常驻，含版本 / 变量 / 预览三块） */
export const LazyPromptEditor = lazy(() => import('./components/PromptEditor'));
/** Markdown 预览（服务端渲染 + 净化，占位较大） */
export const LazyMarkdownPreview = lazy(() => import('./components/MarkdownPreview'));
/** 版本历史（含 diff 视图与回滚） */
export const LazyVersionPanel = lazy(() => import('./components/VersionPanel'));
/** 变量填值 + 渲染复制 */
export const LazyVariablePanel = lazy(() => import('./components/VariablePanel'));
/** 导入 / 导出（含 replace 二次确认） */
export const LazyImportExportModal = lazy(() => import('./components/ImportExportModal'));
/** 使用统计抽屉 */
export const LazyUsageDrawer = lazy(() => import('./components/UsageDrawer'));
/** API 令牌抽屉 */
export const LazyTokenDrawer = lazy(() => import('./components/TokenDrawer'));
/** FR-67：修改密码弹窗（只在点菜单时加载） */
export const LazyPasswordModal = lazy(() => import('./components/PasswordModal'));
/** 关于（服务自检 / 使用指引 / 维护命令） */
export const LazyAboutModal = lazy(() => import('./components/AboutModal'));
/** 填变量对话框（复制含变量的条目时才需要） */
export const LazyVarsDialog = lazy(() => import('./components/VarsDialog'));
