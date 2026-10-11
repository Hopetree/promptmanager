// 阶段 63（FR-130 / AC-125 A）：**401 单点处理**。
//
// 为什么一半是运行时断言、一半是源码级断言：
// - `web/src/session.ts` **零 import**（见该文件头注释），Node ESM 能直接加载 ⇒ 运行时断言；
// - `web/src/api.ts` 里有 `./pure` 这种无扩展名相对导入（给 Vite 解析），Node ESM 加载不了 ⇒
//   对它只能做源码级断言。
//
// 判据（FR-130 / AC-125 ①②③）：
// ① 401 的**判断**只允许出现在 `api.ts` 的 `request()` 里；
// ② `onUnauthorized` 整条 prop 链必须消失（不留兼容可选 prop）；
// ③ 既有**非 401** 错误处理逐条保留（`describeError` 调用数不得减少）。
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { notifySessionExpired, setSessionExpiredHandler } from '../web/src/session.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readSource(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

/** 前端全部 `.ts` / `.tsx` 源码（相对仓库根的路径，已排序）。 */
function listFrontendSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (/\.tsx?$/.test(entry.name)) out.push(rel);
    }
  };
  walk('web/src');
  return out.sort();
}

// —— 运行时：`web/src/session.ts` 的订阅语义 ————————————————————————————————

test('阶段63 ①a：没有处理器时通知是静默的（登录页上的登录失败也是 401，不该炸）', () => {
  setSessionExpiredHandler(null);
  assert.doesNotThrow(() => {
    notifySessionExpired();
  });
});

test('阶段63 ①b：注册后通知会调用一次；取消订阅后不再调用', () => {
  let calls = 0;
  const unsubscribe = setSessionExpiredHandler(() => {
    calls += 1;
  });
  notifySessionExpired();
  assert.equal(calls, 1, '注册后第一次通知必须调用处理器');
  unsubscribe();
  notifySessionExpired();
  assert.equal(calls, 1, '取消订阅后不得再调用');
});

test('阶段63 ①c：后注册者覆盖先注册者；先注册者的取消订阅不得误伤后注册者', () => {
  let first = 0;
  let second = 0;
  const unsubscribeFirst = setSessionExpiredHandler(() => {
    first += 1;
  });
  setSessionExpiredHandler(() => {
    second += 1;
  });
  unsubscribeFirst(); // 当前注册的已经不是自己 ⇒ 必须什么都不清
  notifySessionExpired();
  assert.equal(first, 0, '被覆盖的处理器不得再被调用');
  assert.equal(second, 1, '后注册的处理器必须还在');
  setSessionExpiredHandler(null);
});

test('阶段63 ①d：session.ts 必须保持零 import（否则 tests 无法直接 import 做运行时断言）', () => {
  assert.doesNotMatch(readSource('web/src/session.ts'), /^\s*import\s/m, 'session.ts 不得有任何 import');
});

// —— 源码级：401 判断的单点 ————————————————————————————————————————————

test('阶段63 ②a：整个前端只有 api.ts 判断 401（`status === 401` / `status === UNAUTHORIZED`）', () => {
  const judge = /status\s*===\s*(?:401|UNAUTHORIZED)/;
  const offenders = listFrontendSources().filter((rel) => judge.test(readSource(rel)));
  assert.deepEqual(offenders, ['web/src/api.ts'], '401 判断只允许出现在 web/src/api.ts 里');
});

test('阶段63 ②b：`onUnauthorized` prop 链已整条删除（不许留兼容可选 prop）', () => {
  const offenders = listFrontendSources().filter((rel) => readSource(rel).includes('onUnauthorized'));
  assert.deepEqual(offenders, [], 'onUnauthorized 在 web/src 里必须一处都不剩');
});

test('阶段63 ②c：单点通知的形状固定 —— request() 里收到 401 先通知、再照常抛错', () => {
  const api = readSource('web/src/api.ts');
  assert.match(api, /import \{ notifySessionExpired \} from '\.\/session';/, 'api.ts 必须从 session.ts 引入通知');
  assert.equal((api.match(/const UNAUTHORIZED = 401;/g) ?? []).length, 1, '401 的状态码常量只许定义一次');
  assert.match(
    api,
    /if \(response\.status === UNAUTHORIZED\) notifySessionExpired\(\);/,
    'request() 必须在 !response.ok 分支里通知会话失效',
  );
  // `isUnauthorized` 是 `api.me()` 的会话探测用的，判断本身也必须留在 api.ts 内
  const isUnauthorized = listFrontendSources().filter((rel) => readSource(rel).includes('isUnauthorized'));
  assert.deepEqual(isUnauthorized, ['web/src/api.ts'], 'isUnauthorized 只允许出现在 api.ts');
});

test('阶段63 ②d：App.tsx 注册「踢回登录页」的处理器（回调只切状态、不弹提示）', () => {
  const app = readSource('web/src/App.tsx');
  assert.match(app, /import \{ setSessionExpiredHandler \} from '\.\/session';/);
  assert.match(
    app,
    /useEffect\(\(\) => setSessionExpiredHandler\(\(\) => \{ setUsername\(null\); \}\), \[\]\);/,
    'App.tsx 必须把处理器注册进 session.ts（effect 返回取消订阅函数）',
  );
  assert.doesNotMatch(app, /notifySessionExpired\(/, 'App.tsx 只注册处理器，不自己通知');
});

// —— 源码级：非 401 错误处理逐条保留 ————————————————————————————————————

/** 本阶段删掉 `onUnauthorized` prop 的文件，以及它们**改动前**的 `describeError(` 调用数。 */
const DESCRIBE_ERROR_USES: Record<string, number> = {
  'web/src/components/FolderPanel.tsx': 1,
  'web/src/components/PromptEditor.tsx': 3,
  'web/src/components/TokenDrawer.tsx': 1,
  'web/src/components/UsageDrawer.tsx': 1,
  'web/src/components/VariablePanel.tsx': 2,
  'web/src/components/VarsDialog.tsx': 1,
  'web/src/components/VersionPanel.tsx': 3,
  'web/src/components/Workspace.tsx': 2,
  'web/src/use-copy.ts': 1,
};

test('阶段63 ③：既有非 401 错误处理逐条保留（describeError 调用数不减）', () => {
  for (const [rel, expected] of Object.entries(DESCRIBE_ERROR_USES)) {
    const actual = (readSource(rel).match(/describeError\(/g) ?? []).length;
    assert.equal(actual, expected, `${rel} 的 describeError 调用数必须保持 ${String(expected)}（实际 ${String(actual)}）`);
  }
});
