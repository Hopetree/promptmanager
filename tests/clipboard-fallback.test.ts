// 阶段 19 / FR-65（BRIEF v25 §4 + §8 AC-65）：
// 内网 IP + HTTP 不是安全上下文 → `navigator.clipboard` 不存在，写剪贴板必须走
// `document.execCommand('copy')` 兜底（jsdom 单测；真实内网 IP 的端到端验收见 tools/ac-stage19.sh）。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { writeClipboard } from '../web/src/clipboard.ts';

interface Harness {
  /** 最近一次被"复制"到的文本（由 execCommand 的桩记录） */
  execCopied: string[];
  execCalls: number;
  setClipboard: (value: unknown) => void;
  setExecResult: (ok: boolean) => void;
  restore: () => void;
}

function makeHarness(): Harness {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const doc = dom.window.document as Document & { execCommand?: (command: string) => boolean };
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  const state = { clipboard: undefined as unknown, execResult: true, execCalls: 0, execCopied: [] as string[] };
  doc.execCommand = (command: string): boolean => {
    state.execCalls += 1;
    const area = doc.querySelector('textarea');
    if (area !== null) state.execCopied.push(area.value);
    return state.execResult && command === 'copy';
  };

  Object.defineProperty(globalThis, 'document', { value: doc, configurable: true, writable: true });
  const setNavigator = (clipboard: unknown): void => {
    Object.defineProperty(globalThis, 'navigator', {
      value: clipboard === undefined ? {} : { clipboard },
      configurable: true,
      writable: true,
    });
  };
  setNavigator(undefined);

  return {
    get execCopied() {
      return state.execCopied;
    },
    get execCalls() {
      return state.execCalls;
    },
    setClipboard: setNavigator,
    setExecResult: (ok: boolean) => {
      state.execResult = ok;
    },
    restore: () => {
      if (previousDocument === undefined) delete (globalThis as { document?: unknown }).document;
      else Object.defineProperty(globalThis, 'document', previousDocument);
      if (previousNavigator === undefined) delete (globalThis as { navigator?: unknown }).navigator;
      else Object.defineProperty(globalThis, 'navigator', previousNavigator);
    },
  };
}

test('AC-65 ④：navigator.clipboard 缺失（内网 HTTP）→ 走 execCommand 且成功', async () => {
  const h = makeHarness();
  try {
    h.setClipboard(undefined); // 模拟非安全上下文：navigator.clipboard === undefined
    const ok = await writeClipboard('内网复制内容');
    assert.equal(ok, true, '兜底必须成功（否则用户看到"浏览器拒绝了剪贴板访问"）');
    assert.equal(h.execCalls, 1, '必须调用一次 document.execCommand');
    assert.deepEqual(h.execCopied, ['内网复制内容'], 'execCommand 复制到的文本必须与输入一致');
  } finally {
    h.restore();
  }
});

test('AC-65：安全上下文下优先用 navigator.clipboard，不落兜底', async () => {
  const h = makeHarness();
  try {
    const written: string[] = [];
    h.setClipboard({ writeText: (text: string) => { written.push(text); return Promise.resolve(); } });
    const ok = await writeClipboard('安全上下文内容');
    assert.equal(ok, true);
    assert.deepEqual(written, ['安全上下文内容']);
    assert.equal(h.execCalls, 0, 'async clipboard 可用时不应再动 execCommand');
  } finally {
    h.restore();
  }
});

test('AC-65：async clipboard 存在但拒绝（Promise reject）→ 仍回落 execCommand', async () => {
  const h = makeHarness();
  try {
    h.setClipboard({ writeText: () => Promise.reject(new Error('NotAllowedError')) });
    const ok = await writeClipboard('拒绝后兜底');
    assert.equal(ok, true);
    assert.equal(h.execCalls, 1);
    assert.deepEqual(h.execCopied, ['拒绝后兜底']);
  } finally {
    h.restore();
  }
});

test('AC-65 ②：两条路都失败 → 返回 false（调用方据此提示"请手动选中复制"）', async () => {
  const h = makeHarness();
  try {
    h.setClipboard({ writeText: () => Promise.reject(new Error('NotAllowedError')) });
    h.setExecResult(false);
    const ok = await writeClipboard('都失败');
    assert.equal(ok, false);
  } finally {
    h.restore();
  }
});
