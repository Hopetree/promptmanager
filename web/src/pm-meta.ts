/**
 * 项目元信息的**唯一读取入口**（FR-124 / D-56 ①）。
 *
 * 这些值（简介 / 许可证 / 作者 / 主页 / 仓库 / Issues / 镜像名 / 关键词）**全部来自 `package.json`**，
 * 由 `vite.config.ts` 在**构建期**用 `define` 内联成 `__PM_META__`。
 *
 * 为什么不写死在组件里：README 长期写着过时的 `1.0.2` 就是"元信息另抄一份、仓库改了页面还留着旧值"
 * 的现成教训。这里前端**读不到 package.json、也改不了**这些值 —— 仓库一改，重新构建即同步。
 *
 * ⚠️ **运行时信息不在这里**：版本号、后端在线状态、访问地址必须每次打开弹窗实测
 *     （`/healthz` + `window.location.origin`），见 D-56 ②。
 */

export interface PmMeta {
  /** package.json 的 description —— 一句话定位 */
  description: string;
  /** 许可证标识（如 `MIT`） */
  license: string;
  /** 作者/维护者 */
  author: string;
  /** 文档主页 */
  homepage: string;
  /** 规范化后的仓库地址（`https://github.com/owner/repo`，无 `git+`、无 `.git`） */
  repoUrl: string;
  /** 问题反馈地址 */
  issuesUrl: string;
  /** 仓库内 LICENSE 文件地址 */
  licenseUrl: string;
  /** Docker 镜像名（由仓库地址反推，小写） */
  dockerImage: string;
  /** 技术关键词 */
  keywords: string[];
}

declare const __PM_META__: PmMeta | undefined;

/**
 * 构建产物里 `__PM_META__` 已被 Vite 替换成对象字面量；
 * 这里仍做一次 `typeof` 兜底，是为了**源码级单测 / 未经 Vite 的环境**下 import 本模块不炸。
 */
const FALLBACK: PmMeta = {
  description: '',
  license: '',
  author: '',
  homepage: '',
  repoUrl: '',
  issuesUrl: '',
  licenseUrl: '',
  dockerImage: '',
  keywords: [],
};

export const PM_META: PmMeta = typeof __PM_META__ === 'undefined' ? FALLBACK : __PM_META__;
