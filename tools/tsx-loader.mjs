/**
 * 渲染级测试用的 Node 加载钩子（阶段 65 / FR-136 / FR-137 / AC-127 A1）。
 *
 * 为什么需要它：本仓的前端是 `.tsx`，而 `node --test` 只能直接跑 `.ts`
 * （Node 的类型擦除**不支持 JSX**）。要在 node:test 里真的把 React 组件挂到 jsdom 上，
 * 就必须有一个把 `.tsx` 转译成 JS 的加载钩子。
 *
 * 两个钩子各做一件事：
 * - `resolve`：把 `../api`、`./pure`、`./components/PromptEditor` 这类**没有扩展名**的相对导入
 *   补成 `.ts` / `.tsx` / `/index.ts(x)`（Node 的 ESM 解析器不做扩展名猜测，浏览器打包器才做）；
 *   并把 `.css` 映射成一个空模块（测试不关心样式，也不该为了样式去跑 vite）。
 * - `load`：`.tsx` 走 vite 的 `transformWithOxc`（`jsx.runtime: 'automatic'` ⇒ 走 `react/jsx-runtime`）。
 *   `.ts` 不拦，交给 Node 原生类型擦除。
 *   ⚠️ 不能用 `transformWithEsbuild`：vite 8 里它已废弃，且要求单独安装 `esbuild`（本仓没有这个依赖）。
 *
 * 用法（只在渲染级测试里）：
 * ```ts
 * import { register } from 'node:module';
 * register('../../tools/tsx-loader.mjs', import.meta.url);
 * ```
 * 转译用的是**已在依赖里**的 vite（devDependency），**没有新增任何依赖**。
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const EXTENSIONLESS = /\.[cm]?[jt]sx?$/;

/** `.css` 一律当空模块 —— 测试断言的是行为，不是样式。 */
const EMPTY_CSS = 'data:text/javascript,export default {};';

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('.css')) {
    return { url: EMPTY_CSS, format: 'module', shortCircuit: true };
  }
  const relative =
    specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/');
  if (relative && !EXTENSIONLESS.test(specifier)) {
    for (const suffix of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
      const candidate = new URL(specifier + suffix, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) {
        return { url: candidate.href, format: undefined, shortCircuit: true };
      }
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.tsx')) {
    const { transformWithOxc } = await import('vite');
    const file = fileURLToPath(url);
    const source = readFileSync(file, 'utf8');
    const { code } = await transformWithOxc(source, file, {
      lang: 'tsx',
      jsx: { runtime: 'automatic' },
    });
    return { format: 'module', source: code, shortCircuit: true };
  }
  return nextLoad(url, context);
}
