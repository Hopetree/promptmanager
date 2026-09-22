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

/** git 里的 HEAD 版本（用于与"改动前"对比 FAQ 条数）。 */
const headReadme = (): string => {
  try {
    return execFileSync('git', ['show', 'HEAD:README.md'], { cwd: PROJECT_ROOT, encoding: 'utf8' });
  } catch {
    return '';
  }
};

test('AC-110 ⑤（文档级）：部署章节有镜像拉取失败说明，且教了「拉回规范名」', () => {
  const readme = read('README.md');
  const deployStart = readme.indexOf('## 部署方式 A：Docker');
  const faqStart = readme.indexOf('## 常见问题（FAQ）');
  assert.ok(deployStart >= 0 && faqStart > deployStart, '必须能定位部署章节与 FAQ 章节');
  const deploy = readme.slice(deployStart, faqStart);

  assert.ok(deploy.includes('镜像'), '部署章节必须提到「镜像」');
  assert.ok(/卡住或很慢|超时或极慢/.test(deploy), '必须点明"拉取会卡住/超时"这一现象（否则用户以为是自己环境坏了）');
  assert.ok(/docker tag/.test(deploy), '必须给出「tag 回规范名」的做法（我们的既有办法就是换站 + retag）');
  assert.ok(/镜像站/.test(deploy) && /代理/.test(deploy), '必须同时提到镜像站与代理两条路');
  // 不许把某一站点写成唯一方案
  assert.ok(/不写死具体站点|任一可用的镜像站|站点可用性会变/.test(deploy), '必须说明"站点可换、不绑定某一家"');
  // 不得出现具名公开加速站（站点会过期，绑上去就是负债）
  const named = /(docker\.1panel|dockerproxy|daocloud|docker\.io\.cn|registry\.cn-hangzhou|mirror\.ccs)/;
  assert.equal(named.test(readme), false, '不得把某个具体加速站写进文档');
});

test('AC-110 ⑤（文档级）：FAQ 新增一条「拉取…失败/很慢」且可检索', () => {
  const readme = read('README.md');
  const faqStart = readme.indexOf('## 常见问题（FAQ）');
  const faq = readme.slice(faqStart);
  const questions = [...faq.matchAll(/^\*\*(.+？)\*\*$/gm)].map((m) => m[1] ?? '');
  const hit = questions.filter((q) => q.includes('拉取') && /失败|很慢/.test(q));
  assert.equal(hit.length, 1, `FAQ 里应恰好有 1 条含「拉取」+「失败/很慢」的问句，实际：${JSON.stringify(hit)}`);
  assert.ok(questions.some((q) => q.includes('镜像')), '该条问句里应含「镜像」关键词（便于检索）');

  // 与 HEAD 比：FAQ **只增不减**，且本次恰好 +1
  const base = headReadme();
  if (base !== '') {
    const baseFaq = base.slice(base.indexOf('## 常见问题（FAQ）'));
    const baseQuestions = [...baseFaq.matchAll(/^\*\*(.+？)\*\*$/gm)].map((m) => m[1] ?? '');
    assert.equal(questions.length, baseQuestions.length + 1, `FAQ 条数应 +1（HEAD ${String(baseQuestions.length)} → 现 ${String(questions.length)}）`);
    for (const q of baseQuestions) assert.ok(questions.includes(q), `既有 FAQ 条目不得被删除：${q}`);
  }

  // FAQ 里也要给出可换其它站的说明（不能只在部署章节说一次）
  assert.ok(/不写死具体站点|可用的那一个|都能用/.test(faq), 'FAQ 答案里也要说明"用你能用的那一个"');
});

test('AC-110 ⑥⑦（文档级）：不引用不存在的脚本；不引导用户改 Dockerfile / compose / CI', () => {
  const readme = read('README.md');
  assert.equal(readme.includes('ac-stage9.sh'), false, '沿用既有口径：不得引用不存在的脚本');
  // ⑦ 本次是"文档指引"而非"换镜像源" ⇒ 不应让用户去改这些文件
  assert.equal(/改\s*Dockerfile/.test(readme), false, '不得引导用户改 Dockerfile');
  assert.equal(/DAEMON_JSON|registry-mirrors/.test(readme), false, '不得引导改 docker daemon 的 registry-mirrors（那是另一种方案，本批不做）');
});
