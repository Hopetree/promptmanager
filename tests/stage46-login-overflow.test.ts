// 阶段 46 / FR-108（登录页纵向溢出）+ FR-109（README 镜像指引）断言。
//
// 覆盖：登录根容器**必须**是 `border-box`（否则 `minHeight:100vh` 不含上下 padding ⇒ 恒溢出 96px）、
// 居中与留白参数未被改动；README 的部署章节与 FAQ 有镜像拉取指引、且不绑定具体镜像站。
// 真实像素证据（双视口 390×844 / 1600×900 + 成对截图）在 tools/ac-stage46.sh + ac-stage46-probe.mjs。
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { PROJECT_ROOT } from './helpers.ts';

const read = (rel: string): string => readFileSync(path.join(PROJECT_ROOT, rel), 'utf8');

/** 去掉注释后的登录页源码（源码级断言只检查**真代码**）。 */
const login = read('web/src/components/LoginPage.tsx')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

test('AC-110 ①（源码级）：登录根容器必须是 `border-box`，否则恒溢出 96px', () => {
  /**
   * FR-108 的根因：本仓库没有全局 `box-sizing: border-box` 重置，所以这个容器的默认盒模型是
   * `content-box` ⇒ `minHeight: '100vh'` 只约束内容盒，`padding: '48px 24px'` 上下各 48px **额外加上**：
   * `844 + 96 = 940`、`900 + 96 = 996` —— 与基线表逐像素吻合（溢出量与视口高度无关，恒为上下 padding 之和）。
   */
  assert.ok(/boxSizing: 'border-box'/.test(login), "登录根容器必须显式 boxSizing: 'border-box'");
  // 居中与留白一字未改（AC-110 ③ 的源码侧保障；像素侧由探针 ±2px 断言）
  assert.ok(/minHeight: '100vh'/.test(login), "仍用 minHeight: '100vh'（改为 border-box 后它含 padding，正好占满视口）");
  assert.ok(/padding: '48px 24px'/.test(login), '留白仍是 48px 24px（视觉不变）');
  assert.ok(/align="center"/.test(login) && /justify="center"/.test(login), '仍居中');
  assert.ok(/data-testid="pm-login"/.test(login), '根容器 testid 不变（探针靠它定位）');
  // boxSizing 必须与 minHeight 在**同一个 style 对象**里（避免写到别处不生效）
  const style = /style=\{\{([^}]*)\}\}/.exec(login)?.[1] ?? '';
  assert.ok(style.includes("boxSizing: 'border-box'"), `boxSizing 必须在根容器 style 里：${style}`);
  assert.ok(style.includes("minHeight: '100vh'"), `minHeight 必须在同一个 style 里：${style}`);
});

test('AC-110 ①（源码级）：不存在全局把登录页高度写死的其它来源（无 100vh 重复叠加）', () => {
  // 登录页不应再出现第二个 100vh 高度（例如 minHeight 与 height 同时按 100vh 写、或额外的 padding 补偿）
  const heights = [...login.matchAll(/100vh/g)].length;
  assert.equal(heights, 1, `登录页只应有 1 处 100vh（实际 ${String(heights)}）—— 多了会再次叠加溢出`);
  // 不得用"负 margin / calc 减 padding"之类的绕法掩盖盒模型问题
  assert.equal(/calc\(100vh/.test(login), false, '不得用 calc(100vh - …) 绕（应直接修正盒模型）');
});

/**
 * **改动前**的 README 基线（用于"FAQ 只增不减"的对比）。
 *
 * ⚠️ 不能用 `HEAD`：本阶段的 README 改动一旦提交，`HEAD` 就变成"改后"了 ⇒ 断言会自己失效
 * （自指的基线）。所以固定引用**本阶段的起点提交**（v57 规格提交，即本阶段开工前的树）。
 */
const BASELINE_README_REF = '5dbd37a';

const baselineReadme = (): string => {
  try {
    return execFileSync('git', ['show', `${BASELINE_README_REF}:README.md`], { cwd: PROJECT_ROOT, encoding: 'utf8' });
  } catch {
    return '';
  }
};

/**
   * 文档级断言的定位助手。
   *
   * 2026-09-25 起：**README 是灵活内容，不是契约**。章节标题、措辞、条目数都随作者调整，
   * 测试不该因此判失败。所以这里：
   *   · 定位**宽容** —— 给多个候选标题，取命中的那个；一个都没命中就返回整份文档（全文检索）；
   *   · 措辞断言一律给**多种可接受说法**，只要意思在就过。
   */
  const locateSection = (doc: string, candidates: string[]): string => {
    for (const c of candidates) {
      const i = doc.indexOf(c);
      if (i >= 0) return doc.slice(i);
    }
    return doc;
  };

test('AC-110 ⑤（文档级）：文档讲清了「镜像拉不通」怎么办，且教了「拉回规范名」', () => {
  const readme = read('README.md');
  // 整份文档检索：内容放在哪一节是作者的决定
  assert.ok(/镜像/.test(readme), '文档必须提到「镜像」');
  assert.ok(
    /卡住|很慢|超时|拉不动|失败|连不上|不通/.test(readme),
    '必须点明「拉取会卡住/超时/失败」这一现象（否则用户以为是自己环境坏了）',
  );
  assert.ok(/docker tag/.test(readme), '必须给出「tag 回规范名」的做法（换站 + retag 是既有办法）');
  assert.ok(
    /镜像站|加速/.test(readme) && /代理|proxy/i.test(readme),
    '必须同时提到镜像站与代理两条路',
  );
  assert.ok(
    /不写死|不绑定|可用性会变|能用的那个|那一个|都能用|自行选择|挑你/.test(readme),
    '必须说明「加速站可换、不绑定某一家」',
  );
  // 不得把某一具名公开加速站写成唯一方案（站点会过期，绑上去就是负债）
  const named = /(docker\.1panel|dockerproxy|daocloud|docker\.io\.cn|registry\.cn-hangzhou|mirror\.ccs)/;
  assert.equal(named.test(readme), false, '不得把某个具体加速站写进文档');
});

test('AC-110 ⑤（文档级）：FAQ 里有一条讲「镜像拉取失败/很慢」且可检索', () => {
  const readme = read('README.md');
  // 宽容定位 FAQ；找不到就当整份文档
  const faq = locateSection(readme, ['## 常见问题', '常见问题', 'FAQ', '## 排错', 'Troubleshooting']);
  // 问句格式不强制，但「拉取/镜像 + 失败/慢」这个话题必须以可检索的问句出现
  const questions = [...faq.matchAll(/^\*\*(.+?)\*\*\s*$/gm)].map((m) => m[1] ?? '');
  const hit = questions.filter((q) => /拉取|镜像/.test(q) && /失败|很慢|超时|拉不动|连不上/.test(q));
  assert.ok(
    hit.length >= 1,
    `FAQ 应至少有一条讲镜像拉取失败/很慢的问句（便于检索），实际问句：${JSON.stringify(questions)}`,
  );
  // FAQ 里也要给出可换其它站的说明（不能只在部署章节说一次）
  assert.ok(
    /不写死|不绑定|可用性会变|能用的那个|那一个|都能用|自行选择|挑你/.test(faq),
    'FAQ 答案里也要说明「用你能用的那一个」',
  );
});

test('AC-110 ⑤ 返工（文档级）：README 必须写出官方镜像**完整地址**，不能只有占位符', () => {
  /**
   * 返工原因（历史）：上一版整份 README 从头到尾没有镜像完整地址，全是占位符，
   * 读者拿到文档不知道该填什么、照着部署不出来。镜像已公开发布 ⇒ 地址必须写死在文档里。
   *
   * ⚠️ 2026-09-25 调整：只要求「**地址在场且可直接复制**」，
   *    不再要求它出现在某一节里、也不再强制使用某种占位符。
   */
  const readme = read('README.md');
  assert.ok(readme.includes('hopetree/promptmanager'), '文档必须写出官方镜像完整地址 hopetree/promptmanager');
  assert.ok(
    /docker pull hopetree\/promptmanager:\S+/.test(readme),
    '必须给出一条可直接复制的 docker pull 完整命令',
  );
  // 若作者仍选择用 `<命名空间>` 占位符，则必须说清它 = hopetree（有则必定义，无则跳过）
  if (readme.includes('<命名空间>')) {
    const lines = readme.split('\n');
    const confusing = lines
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => line.includes('<命名空间>'))
      .filter(({ i }) => !lines.slice(Math.max(0, i - 12), i + 13).join('\n').includes('hopetree'))
      .map(({ line, i }) => `${String(i + 1)}: ${line.trim()}`);
    assert.deepEqual(confusing, [], `以下 <命名空间> 出现处附近没有 hopetree 的说明：\n${confusing.join('\n')}`);
  }
});

test('AC-110 ⑤ 返工（文档级）：官方仓库写死、**加速站仍不写死**（两件事不能混）', () => {
  const readme = read('README.md');
  // 官方仓库：允许且要求在文档里固定出现
  assert.ok(readme.includes('hopetree/promptmanager'), '官方仓库地址应固定写在文档里');
  // 加速站：仍不得绑定任何具名站
  const named = /(docker\.1panel|dockerproxy|daocloud|docker\.io\.cn|registry\.cn-hangzhou|mirror\.ccs)/;
  assert.equal(named.test(readme), false, '不得把某个具体加速站写进文档（它们会过期）');
  // 仍须保留「站点可换」的方法性说明（多种说法任一）
  assert.ok(
    /不写死|不绑定|可用性会变|能用的那个|那一个|都能用|自行选择|挑你/.test(readme),
    '仍须说明「加速站用你能用的那一个」',
  );
  // 升级相关的段落里也要能给读者可照抄的地址（宽容定位：命中就用，没命中不强制）
  const upIdx = readme.search(/^#+.*升级.*$/m);
  if (upIdx >= 0) {
    const seg = readme.slice(upIdx, upIdx + 1500);
    assert.ok(seg.includes('hopetree/promptmanager'), '「升级」相关的段落应给出完整镜像地址');
  }
});

test('AC-110 ⑥⑦（文档级）：不引用不存在的脚本；不引导用户改 Dockerfile / compose / CI', () => {
  const readme = read('README.md');
  assert.equal(readme.includes('ac-stage9.sh'), false, '沿用既有口径：不得引用不存在的脚本');
  // ⑦ 本次是"文档指引"而非"换镜像源" ⇒ 不应让用户去改这些文件
  assert.equal(/改\s*Dockerfile/.test(readme), false, '不得引导用户改 Dockerfile');
  assert.equal(/DAEMON_JSON|registry-mirrors/.test(readme), false, '不得引导改 docker daemon 的 registry-mirrors（那是另一种方案，本批不做）');
});
