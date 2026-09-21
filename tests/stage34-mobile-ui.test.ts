// 阶段 34（BRIEF v45 §4 FR-90 / FR-92）的**源码级 / 纯逻辑**断言。
// 运行时段（真浏览器 + CDP 量 getBoundingClientRect 的 358/374、档位顺序 DOM、默认档位按断点、截图）
// 见 tools/ac-stage34.sh 与 tools/ac-stage34-probe.mjs。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { VIEW_MODE_VALUES, defaultViewMode, viewModeOptions } from '../web/src/pure.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel: string): string => readFileSync(path.join(ROOT, 'web', 'src', rel), 'utf8');

const split = src('components/SplitView.tsx');
const useView = src('components/UseView.tsx');
const workspace = src('components/Workspace.tsx');

test('FR-90：分栏中栏宽度按断点 —— 移动端撑满（1 1 100%），桌面仍是三档 clamp', () => {
  // 移动端：撑满可用宽度（单栏降级时右栏不渲染，中栏独占整行）
  assert.ok(
    /flex:\s*isMobile\s*\?\s*'1 1 100%'\s*:/.test(split),
    '移动端中栏必须 flex: 1 1 100%（撑满可用宽度）',
  );
  // 桌面：阶段 22 FR-71 的三档 clamp 一字未改
  assert.ok(
    split.includes("'0 0 clamp(276px, 31.3%, 350px)'"),
    '桌面中栏必须仍是 clamp(276px, 31.3%, 350px)（FR-71 口径不得回归）',
  );
  assert.ok(/minWidth:\s*0/.test(split), 'minWidth: 0 必须保留（flex 子项可收缩）');
  // 单栏降级：右栏只在非移动端渲染
  assert.ok(/\{!isMobile && \(/.test(split), '右栏（pm-split-detail）必须仍只在非移动端渲染');
  assert.ok(split.includes('pm-split-detail'), '右栏锚点 pm-split-detail 保留');
  // 不引入新的断点体系：SplitView 只吃 isMobile 这个 prop，不自己读 window/媒体查询
  assert.equal(/window\.innerWidth|matchMedia/.test(split), false, 'SplitView 不得自行引入新的断点判断');
});

test('FR-92 ①：档位顺序按断点（桌面 分栏→表格→卡片；移动 卡片→表格→分栏）', () => {
  assert.deepEqual(viewModeOptions(false), [
    { value: 'split', label: '分栏' },
    { value: 'table', label: '表格' },
    { value: 'card', label: '卡片' },
  ]);
  assert.deepEqual(viewModeOptions(true), [
    { value: 'card', label: '卡片' },
    { value: 'table', label: '表格' },
    { value: 'split', label: '分栏' },
  ]);
  // 移动端就是桌面的**倒序**（用户原话"顺序变成卡片，表格，分栏"）
  assert.deepEqual(
    viewModeOptions(true).map((option) => option.value),
    [...viewModeOptions(false).map((option) => option.value)].reverse(),
  );
  // 组件确实取用该函数（顺序只有一处定义）
  assert.ok(/options=\{viewModeOptions\(isMobile\)\}/.test(useView), 'UseView 必须用 viewModeOptions(isMobile)');
  assert.ok(/data-testid="pm-use-viewmode"/.test(useView), '档位开关锚点 pm-use-viewmode 保留');
});

test('FR-92 ②：默认档位按断点（移动 card / 桌面 split），且只在无本地偏好时生效', () => {
  assert.equal(defaultViewMode(false), 'split', '桌面默认分栏');
  assert.equal(defaultViewMode(true), 'card', '移动端默认卡片');
  // Workspace：把 defaultViewMode(isMobile) 作为 readPref 的 fallback（readPref 先读存储 ⇒ 不覆盖已有偏好）
  assert.ok(
    /readPref<UseViewMode>\('pm-view-mode', defaultViewMode\(isMobile\), \['split', 'table', 'card'\]\)/.test(workspace),
    'Workspace 必须以 defaultViewMode(isMobile) 为 fallback，且 allowed 集合不变',
  );
  // readPref 的实现必须是"存储里有且合法才用存储值"（否则"不覆盖已有偏好"就不成立）
  const readPrefBody = workspace.slice(workspace.indexOf('function readPref'), workspace.indexOf('function readBoolPref'));
  assert.ok(/localStorage\.getItem\(key\)/.test(readPrefBody), 'readPref 必须读 localStorage');
  assert.ok(/includes\(raw\)/.test(readPrefBody), 'readPref 必须校验取值在 allowed 内（非法/旧值回退 fallback）');
});

test('FR-92 ③：取值集合不变（仍是 split/table/card，不新增第四个档位），键名不变', () => {
  assert.deepEqual([...VIEW_MODE_VALUES], ['split', 'table', 'card'], '取值集合不得变');
  assert.equal(/value: 'list'/.test(useView), false, "不得再有 'list' 档");
  assert.ok(/localStorage.*pm-view-mode|'pm-view-mode'/.test(workspace), "localStorage 键名仍是 pm-view-mode");
  assert.equal(/pm-view-mode-[a-z]/.test(workspace), false, '不得新增 pm-view-mode 的其它键');
  // 桌面顺序不得被改成移动顺序：纯函数按 isMobile 分支，两者互不影响
  assert.notDeepEqual(viewModeOptions(true), viewModeOptions(false), '移动与桌面顺序必须不同（倒序）');
});
