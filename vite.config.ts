import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** 只匹配 node_modules 下的路径（分包分组用；Linux 与 Windows 的分隔符都认） */
const inNodeModules = (pattern: string): RegExp => new RegExp(`node_modules[\\\\/]${pattern}`);

/* ────────────────────────────────────────────────────────────────
 * 项目元信息：**构建期**从 package.json 注入（FR-124 / D-56 ①）。
 *
 * 为什么这样而不是在前端写死：README 曾经长期写着过时的 `1.0.2`，
 * 就是"元信息在代码里另抄一份、仓库改了页面还写着旧值"的现成教训。
 * 这里 package.json 是**唯一来源**，`__PM_META__` 由 Vite 在构建时内联，
 * 前端**读不到**也**改不了**这些值（AC-120 ⑤⑥⑦⑧ 全部由此满足）。
 *
 * ⚠️ 运行时信息（版本 / 在线状态 / 访问地址）**不在这里** —— 那三项必须
 *     每次打开弹窗实测（`/healthz` + `window.location.origin`），见 D-56 ②。
 * ──────────────────────────────────────────────────────────────── */

interface PackageJsonLike {
  description?: unknown;
  license?: unknown;
  author?: unknown;
  homepage?: unknown;
  repository?: unknown;
  bugs?: unknown;
  keywords?: unknown;
}

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
) as PackageJsonLike;

/** `git+https://github.com/O/R.git` → `https://github.com/O/R`（AC-120 ⑥：owner/repo 规范形式） */
function normalizeRepoUrl(raw: string): string {
  return raw.replace(/^git\+/, '').replace(/\.git$/, '').replace(/\/+$/, '');
}

const repositoryUrl =
  typeof pkg.repository === 'object' && pkg.repository !== null && 'url' in pkg.repository
    ? String((pkg.repository as { url?: unknown }).url ?? '')
    : typeof pkg.repository === 'string'
      ? pkg.repository
      : '';
const repoUrl = normalizeRepoUrl(repositoryUrl);
/** 从仓库地址反推 Docker 镜像名（`<owner>/<repo>` 全小写，Docker Hub 要求小写）——
 *  这样镜像名也跟着 package.json 走，不必在两处各写一遍（AC-120 ⑦）。 */
const repoMatch = /github\.com\/([^/]+)\/([^/?#]+)/.exec(repoUrl);
const dockerImage = repoMatch === null ? '' : `${String(repoMatch[1])}/${String(repoMatch[2])}`.toLowerCase();

const __PM_META__ = {
  description: String(pkg.description ?? ''),
  license: String(pkg.license ?? ''),
  author:
    typeof pkg.author === 'string'
      ? pkg.author
      : String((pkg.author as { name?: unknown } | null)?.name ?? ''),
  homepage: String(pkg.homepage ?? repoUrl),
  repoUrl,
  issuesUrl: String((pkg.bugs as { url?: unknown } | null)?.url ?? `${repoUrl}/issues`),
  licenseUrl: `${repoUrl}/blob/main/LICENSE`,
  dockerImage,
  keywords: Array.isArray(pkg.keywords) ? pkg.keywords.map((k) => String(k)) : [],
};

/**
 * 阶段 18（FR-61 / AC-61）的懒加载组件清单——**只能**在动态 `import()` 里出现的重组件。
 * 与 `web/src/lazy.ts` 一一对应；分组把它们（连同各自独占的依赖）放进 `app-lazy` 块。
 */
const LAZY_COMPONENTS =
  /web[\\/]src[\\/]components[\\/](PromptEditor|MarkdownPreview|VersionPanel|VariablePanel|ImportExportModal|UsageDrawer|TokenDrawer|AboutModal|VarsDialog)[\\/.]/;

/**
 * 前端构建：源码在 web/，产物落到 dist/web（与 dist/server 一起由单进程单端口托管，FR-12）。
 * 组件库（antd / @ant-design/icons）随构建本地打包，禁止 CDN（BRIEF §5、AC-20 ④）。
 *
 * 体积策略（FR-61 / AC-61，阶段 18）：
 * 1. **懒加载**：编辑 / 预览 / 版本 diff / 导入导出 / 使用统计 / 令牌等重组件走 `web/src/lazy.ts`
 *    的动态 `import()`，用到才加载（首屏只留首屏真正需要的代码）。
 * 2. **vendor 分包**：把体积主体（antd / rc-* / react / @ant-design 运行时）拆成若干个
 *    **各自 ≤500 KB（未压缩）** 的块，消掉「Some chunks are larger than 500 kB」告警。
 *    写法说明：Vite 8 基于 rolldown，`output.manualChunks` 已被标记 deprecated，其**等价替代**是
 *    `output.codeSplitting.groups`（rolldown 文档：两者同时指定时 manualChunks 会被忽略）。
 *    FR-61 允许的正是「manualChunks 合理分包（antd / react 等 vendor 分离）」这一手段，
 *    这里用同一语义的非弃用 API 落地；`tags: ['$initial']` = 只捕获「首屏（静态）依赖链」里的模块，
 *    这样只有懒加载组件才用得到的 antd 组件会随之进入 `app-lazy`，不占首屏。
 *    前后体积对照表见 `PROGRESS.md` 的阶段 18 小节。
 */
export default defineConfig({
  root: fileURLToPath(new URL('./web', import.meta.url)),
  base: '/',
  plugins: [react()],
  define: {
    // 构建期内联；前端只能读、不能改，也拿不到 package.json 原文
    __PM_META__: JSON.stringify(__PM_META__),
  },
  build: {
    outDir: fileURLToPath(new URL('./dist/web', import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
    // 全站只有一套自定义 CSS（app.css + markdown.css）：合并成一个文件，省一次请求
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        codeSplitting: {
          groups: [
            // React 运行时（react / react-dom / scheduler）+ antd 的样式引擎运行时（@ant-design/*）
            { name: 'vendor-react', test: inNodeModules('(react|react-dom|scheduler)[\\\\/]|@ant-design[\\\\/]') },
            // antd 的底层组件依赖（rc-* / @rc-component）与图标（@ant-design/icons）
            { name: 'vendor-rc', test: inNodeModules('(@rc-component|rc-)[^\\\\/]*[\\\\/]|@ant-design[\\\\/]icons[\\\\/]'), tags: ['$initial'] },
            // antd 组件本体
            { name: 'vendor-antd', test: inNodeModules('antd[\\\\/]'), tags: ['$initial'] },
            // 其余第三方（单个都很小，合一块避免碎片化）
            { name: 'vendor-misc', test: inNodeModules(''), tags: ['$initial'] },
            // 懒加载组件的自有代码；只在需要时才被取用
            { name: 'app-lazy', test: LAZY_COMPONENTS },
          ],
        },
      },
    },
  },
});
