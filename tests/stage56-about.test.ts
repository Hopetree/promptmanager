// 阶段 56 / FR-124 / AC-120：关于页改为开源项目形态的自动化断言。
//
// 本文件是**源码级**断言（不依赖浏览器）；真浏览器的渲染/几何/截图证据见
// tools/ac-stage56-about.sh 与 tools/ac-stage56-about-probe.mjs。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

const about = src('web/src/components/AboutModal.tsx');
const viteConfig = src('vite.config.ts');
const pmMeta = src('web/src/pm-meta.ts');
const pkg = JSON.parse(src('package.json')) as Record<string, unknown>;

/** 去掉块注释与行注释，避免注释里的文字被当成实现（探针/测试都栽过这个）。 */
const code = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ══════════════ ① 身份区：一句话定位 + 运行时动态 + 访问地址 + 关键词 ══════════════

test('AC-120 ①：有一句话定位，且取自 package.json 的 description（非硬编码）', () => {
  const desc = String(pkg.description ?? '');
  assert.ok(desc.length > 0, 'package.json 应该有 description');
  // 定位文案从 PM_META.description 取，而不是在组件里另写一句
  assert.match(about, /data-testid="pm-about-positioning"[\s\S]{0,200}PM_META\.description/,
    '定位文案必须来自 PM_META.description');
  // 组件里不得出现另抄一份的项目简介
  const c = code(about);
  assert.equal(c.includes(desc), false, '不得在组件里硬编码一份与 package.json 相同的简介');
  // 与 README 首句口径一致：都点明「轻量」+「自托管」
  const readme = src('README.md');
  const firstMeaningful = readme.split('\n').find((l) => l.includes('轻量') && l.includes('管理')) ?? '';
  assert.match(firstMeaningful, /轻量/, 'README 首句应含「轻量」');
  assert.match(firstMeaningful, /自托管/, 'README 首句应含「自托管」');
  assert.match(desc, /轻量/, 'package.json description 应含「轻量」');
  assert.match(desc, /自托管/, 'package.json description 应含「自托管」');
});

test('AC-120 ②：版本/状态仍是运行时动态获取（不是从 package.json 取）', () => {
  assert.match(about, /fetch\('\/healthz'/, '版本必须来自 /healthz 实测');
  assert.match(about, /const version = health\?\.version \?\? '—'/, '版本取自 health 响应');
  assert.match(about, /后端在线|后端离线/, '在线状态徽标保留');
  assert.match(about, /重新探测/, '「重新探测」按钮保留');
  // 静态元信息里**不得**混进版本号（版本只能来自 /healthz，否则会和运行时值打架）
  assert.equal(/version:\s*String\(pkg\.version/.test(viteConfig), false,
    '不应把 package.json 的 version 注入前端 —— 页面版本必须来自 /healthz');
});

test('AC-120 ③b：访问地址在身份区、仍取 location.origin（R-9 不得回归）', () => {
  assert.match(about, /data-testid="pm-about-address"/, '访问地址必须在身份区有自己的锚点');
  // 取值仍是 origin，绝不写死协议
  assert.match(code(about), /const address = typeof window === 'undefined' \? '' : window\.location\.origin;/,
    '访问地址必须取 window.location.origin（FR-117 修复不得回归）');
  assert.equal(/`http:\/\/\$\{/.test(code(about)), false, '不得写死 http://');
  assert.equal(/`https:\/\/\$\{/.test(code(about)), false, '不得写死 https://');
  // 仍带复制
  assert.match(about, /pm-about-address[\s\S]{0,220}<CopyLine text=\{address\} \/>/, '访问地址必须仍可复制');
});

// ══════════════ ③c 不做版本检查 ══════════════

test('AC-120 ③c：页面无「检查更新」入口，也不发起任何出网请求', () => {
  const c = code(about);
  for (const banned of ['检查更新', '检查新版本', '查看更新', '有新版本', 'releases/latest', 'api.github.com']) {
    assert.equal(c.includes(banned), false, `不得出现「${banned}」`);
  }
  // 唯一的网络请求仍是 /healthz
  const fetchTargets = [...about.matchAll(/fetch\(\s*'([^']+)'/g)].map((m) => m[1] ?? '');
  assert.deepEqual(fetchTargets, ['/healthz'], `关于页只应有 /healthz 一次请求，实际：${JSON.stringify(fetchTargets)}`);
  // 也不该引入更新检查相关依赖
  const deps = Object.keys({ ...((pkg.dependencies ?? {}) as object), ...((pkg.devDependencies ?? {}) as object) });
  for (const banned of ['update-electron-app', 'electron-updater', 'semver-diff', 'latest-version']) {
    assert.equal(deps.includes(banned), false, `不得引入更新检查依赖 ${banned}`);
  }
});

// ══════════════ ② 出处与去向区 ══════════════

test('AC-120 ④⑤：五项齐全，且外链一律 target=_blank + rel 含 noopener', () => {
  for (const label of ['代码仓库', 'Docker 镜像', '文档说明', '问题反馈', '许可证']) {
    assert.ok(about.includes(`label: '${label}'`), `出处区必须有「${label}」`);
  }
  // 统一走 ExtLink（target/rel 写在一处，避免 5 处各写一遍漏掉）
  assert.match(about, /function ExtLink[\s\S]*?target="_blank" rel="noopener noreferrer"/,
    'ExtLink 必须同时带 target="_blank" 与 rel="noopener noreferrer"');
  // 五项里的四个链接都走 ExtLink；镜像走复制
  const extLinkUses = [...code(about).matchAll(/<ExtLink href=\{PM_META\.(\w+)\}>/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(extLinkUses)].sort(), ['homepage', 'issuesUrl', 'licenseUrl', 'repoUrl'],
    '仓库/文档/反馈/许可证四项都应走 ExtLink');
  assert.match(about, /label: 'Docker 镜像'[\s\S]{0,320}<CopyLine text=\{PM_META\.dockerImage\} \/>/,
    '镜像名必须可复制');
});

test('AC-120 ⑥⑦⑧：仓库规范形式、镜像名与 CI 一致、许可证 MIT', () => {
  // 仓库地址在 vite.config 里规范化：去掉 git+ 前缀与 .git 后缀
  assert.match(viteConfig, /replace\(\/\^git\\\+\/, ''\)/, '必须剥掉 git+ 前缀');
  assert.match(viteConfig, /replace\(\/\\\.git\$\/, ''\)/, '必须剥掉 .git 后缀（AC-120 ⑥）');
  // 镜像名由仓库地址反推（不另写一份），并小写（Docker Hub 要求）
  assert.match(viteConfig, /github\\\.com\\\/\(\[\^\/\]\+\)\\\/\(\[\^\/\?\#\]\+\)/, '镜像名应从仓库地址反推');
  assert.match(viteConfig, /\.toLowerCase\(\)/, '镜像名必须小写');
  // package.json 的原始值确实是 git+…git 形式（证明规范化确有必要）
  const repoUrl = ((pkg.repository ?? {}) as { url?: string }).url ?? '';
  assert.match(repoUrl, /^git\+https:\/\/github\.com\/.+\.git$/, `package.json repository 应是 git+ 形式，实际 ${repoUrl}`);
  // 许可证来自 package.json，且当前就是 MIT（与 LICENSE 首行一致由 shell 侧核对）
  assert.match(viteConfig, /license:\s*String\(pkg\.license/, '许可证必须取自 package.json');
  assert.equal(String(pkg.license), 'MIT', 'package.json 许可证应为 MIT');
  // 镜像提示不得写死任何历史版本号（D-56 ③）
  const c = code(about);
  assert.equal(/hopetree\/promptmanager:\d/.test(c), false, '镜像提示不得写死版本号');
  assert.match(c, /:latest/, '镜像提示应引导用 :latest');
});

// ══════════════ D-56 ①：元信息单一来源，不硬编码 ══════════════

test('AC-120 / D-56 ①：项目元信息单一来源 = package.json（构建期注入）', () => {
  // vite.config 从 package.json 读取并 define 注入
  assert.match(viteConfig, /JSON\.parse\([\s\S]{0,120}readFileSync\(fileURLToPath\(new URL\('\.\/package\.json'/, '必须读 package.json');
  assert.match(viteConfig, /__PM_META__:\s*JSON\.stringify\(__PM_META__\)/, '必须 define 注入 __PM_META__');
  // 前端从 pm-meta.ts 读
  assert.match(pmMeta, /declare const __PM_META__/, 'pm-meta.ts 需声明注入的全局常量');
  assert.match(pmMeta, /export const PM_META: PmMeta = typeof __PM_META__ === 'undefined' \? FALLBACK : __PM_META__;/,
    'pm-meta.ts 需在无注入环境下兜底（源码级单测不会炸）');
  // 组件里不得出现任何 GitHub / 镜像 / 许可证的字面量
  const c = code(about);
  for (const banned of ['github.com', 'Hopetree', 'hopetree', 'MIT', 'npmjs.com', 'gitee.com']) {
    assert.equal(c.includes(banned), false, `组件里不得硬编码「${banned}」`);
  }
  // 前端也不该直接 import package.json（那会把整包打进产物）
  assert.equal(/from '\.\.\/\.\.\/package\.json'/.test(about), false, '不得在组件里 import package.json');
});

// ══════════════ ② 服务区整个去掉 ══════════════

test('AC-120 / D-56 ④：「服务区」整个去掉（含那句错误的「拷贝 pm.db」）', () => {
  const c = code(about);
  assert.equal(/label: '服务'/.test(c), false, '不得再有「服务」分区');
  assert.equal(c.includes('拷贝 pm.db'), false, '不得再教用户拷贝 pm.db（WAL 下会丢数据）');
  assert.equal(c.includes('数据文件'), false, '「数据文件」行随服务区一起去掉');
  // 版本/状态/访问地址都有去处，不能是"删了就没了"
  assert.ok(/版本 \{version\}/.test(c), '版本显示须保留（已移到身份区）');
  assert.ok(/后端在线/.test(c), '状态徽标须保留');
  assert.ok(/pm-about-address/.test(c), '访问地址须保留（已移到身份区）');
});

// ══════════════ ③ 使用 / 维护区 ══════════════

test('AC-120 ⑫：维护区 5 条命令保留（AC-120 ⑬ 的使用 7 条见下条）', () => {
  for (const cmd of [
    'node bin/pm.mjs user set-password --username admin',
    'journalctl -u promptmanager -f',
    'sudo systemctl restart promptmanager',
    'git checkout <上一个提交> && npm run build && sudo systemctl restart promptmanager',
    'docs/dependencies.md',
  ]) {
    assert.ok(about.includes(cmd), `维护区命令须保留：${cmd.slice(0, 40)}`);
  }
});

test('AC-120 ⑬：「使用」区 7 条与当前界面实际交互一致', () => {
  const usageBlock = about.slice(about.indexOf('const usageLines'), about.indexOf('];', about.indexOf('const usageLines')));
  const lines = [...usageBlock.matchAll(/'([^']+)'/g)].map((m) => m[1] ?? '');
  assert.equal(lines.length, 7, `使用区应 7 条，实际 ${String(lines.length)}`);
  assert.ok(lines.some((l) => l.includes('＋新建')), '第 1 条应指向顶栏「＋新建」');
  assert.ok(lines.some((l) => l.includes('复制提示词')), '应有复制入口');
  assert.ok(lines.some((l) => l.includes('按 / 聚焦搜索')), '应有「/ 聚焦搜索」快捷键');
  assert.ok(lines.some((l) => l.includes('Esc 关闭详情')), '应有「Esc 关闭详情」快捷键');
});

// ══════════════ ⑭ 移动端默认折叠 ══════════════

test('AC-120 ⑭：移动端「使用 / 维护」默认折叠（PC 默认展开使用）', () => {
  assert.match(about, /defaultActiveKey=\{isNarrowHint\(\) \? \[\] : \['usage'\]\}/,
    '折叠默认值应按视口宽度决定：窄屏全折叠，宽屏展开「使用」');
  assert.match(about, /function isNarrowHint\(\): boolean \{\s*return typeof window !== 'undefined' && window\.innerWidth < 768;/,
    'isNarrowHint 判据应是视口宽度 < 768，且不依赖任何数据');
});
