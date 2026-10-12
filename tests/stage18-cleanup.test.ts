// 阶段 18 / FR-60（BRIEF v24 §4 + §8 AC-60）的**源码级**断言：
// 「注释与用户可见文案的漂移清理」——只改表述、不改行为；白名单见 FR-60。
// 运行时证据（全量回归）见本节收尾；这里把 AC-60 的 5 条 grep 命令固化下来，防回退。
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { readJson, readSource } from './source-text.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function sources(dir: string): Array<{ rel: string; text: string }> {
  return walk(path.join(ROOT, dir))
    .filter((file) => /\.(ts|tsx|css)$/.test(file))
    .map((file) => ({ rel: path.relative(ROOT, file), text: readSource(path.relative(ROOT, file)) }));
}

const webSrc = sources('web/src');
const serverSrc = sources('src');

function hits(pattern: RegExp): string[] {
  return [...webSrc, ...serverSrc]
    .filter((file) => pattern.test(file.text))
    .map((file) => file.rel);
}

test('AC-60 ①：web/src 不再出现「文件夹与标签」（FR-48 已删该入口）', () => {
  assert.deepEqual(hits(/文件夹与标签/), []);
});

test('AC-60 ②：app.css 不再使用 v17 前的旧术语「使用视图 / 管理视图」（现行为 分栏/表格/卡片）', () => {
  const css = readSource('web/src/styles/app.css');
  assert.equal(/使用视图|管理视图/.test(css), false);
});

test('AC-60 ③：导入报错文案用品牌大小写，且 app 契约值原样保留', () => {
  const importFile = readSource('web/src/import-file.ts');
  assert.equal(/不是 promptmanager/.test(importFile), false, '展示文案应改成「不是 PromptManager 的导出文件」');
  assert.ok(importFile.includes('不是 PromptManager 的导出文件'), '缺少改后的展示文案');
  // 契约值：必须仍是全小写 promptmanager，且**只能有一处**身份常量（改了会破坏已有导出文件兼容）
  const contract = importFile.match(/app: 'promptmanager'/g) ?? [];
  assert.equal(contract.length, 1, `import-file.ts 里 app: 'promptmanager' 应恰好 1 处，实际 ${String(contract.length)}`);
  // 比较逻辑必须走该常量，不得再出现裸字面量比较
  assert.equal(/!==\s*'promptmanager'/.test(importFile), false, '契约比较应改用具名常量，避免散落字面量');
});

test('AC-60 ④：已废止概念在 web/src、src 的注释与文案里命中 0', () => {
  const banned = /pm-mode-use|pm-mode-manage|模式记忆|列表视图|pm-view-list|pm-kpi-row|pm-filter-row|pm-statusbar|管理视图|使用视图/;
  assert.deepEqual(hits(banned), []);
});

test('AC-60 ④（补充）：菜单名「设置」已改为「关于」，且「拿来就用」只由 aria-label 承载', () => {
  const header = readSource('web/src/components/AppHeader.tsx');
  assert.ok(header.includes('关于'), '⋯更多 里的入口文案必须是「关于」');
  assert.equal(/>\s*设置\s*</.test(header), false, '不得再渲染「设置」这一菜单名');
  const workspace = readSource('web/src/components/Workspace.tsx');
  assert.equal(/拿来就用<\/Typography\.Title>/.test(workspace), false);
  assert.ok(workspace.includes('aria-label="拿来就用"'), 'FR-53：语义只能由 aria-label 承载');
});

test('AC-60 白名单：契约值、包名、文件名/路径、历史文档都不得被「清理」误伤', () => {
  // ① 服务端契约值本体
  assert.ok(
    readSource('src/services/export.ts').includes("EXPORT_APP = 'promptmanager'"),
    'src/services/export.ts 的 app 契约值必须原样',
  );
  // ② 包名
  assert.equal(readJson<{ name: string }>('package.json').name, 'promptmanager');
  // ③ 文件名/路径（图标位图与 systemd 服务名都保留小写）
  assert.ok(
    readSource('web/src/components/AboutModal.tsx').includes('systemctl restart promptmanager'),
    'systemd 服务名 promptmanager 属文件名/路径白名单，不得改',
  );
  // ④ 品牌图形资产文件名保留
  assert.ok(readSource('web/src/components/LoginPage.tsx').includes('/promptmanager-96.png'));
});
