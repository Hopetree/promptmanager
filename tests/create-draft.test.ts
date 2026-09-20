// FR-45 / AC-43 的**源码级**锚点：新建必须是"内存草稿 → 点保存才 POST 创建"。
// 运行时证据（total 不变 / 保存 +1）见 tools/ac-stage13.sh。
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB_SRC = path.join(ROOT, 'web', 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files = walk(WEB_SRC)
  .filter((file) => file.endsWith('.tsx') || file.endsWith('.ts'))
  .map((file) => ({ rel: path.relative(ROOT, file), text: readFileSync(file, 'utf8') }));
const src = (rel: string): string => readFileSync(path.join(ROOT, 'web', 'src', rel), 'utf8');

test('AC-43：新建只开内存草稿——api.createPrompt 只允许出现在编辑器的"保存"路径', () => {
  const callers = files
    .filter((file) => file.text.includes('api.createPrompt('))
    .map((file) => file.rel);
  assert.deepEqual(callers, ['web/src/components/PromptEditor.tsx'], '新建流程不得在别处直接 POST 创建');
});

test('AC-43：Workspace 的 ＋新建 只设置草稿（EMPTY_DRAFT + isNew），不发请求', () => {
  const workspace = src('components/Workspace.tsx');
  const start = workspace.indexOf('const createPrompt = useCallback');
  const end = workspace.indexOf('const removePrompt = useCallback');
  assert.ok(start >= 0 && end > start, '找不到 createPrompt 的实现');
  const createSource = workspace.slice(start, end);
  assert.ok(createSource.includes('EMPTY_DRAFT'), '＋新建 必须放内存草稿（EMPTY_DRAFT）');
  assert.ok(createSource.includes('setIsNew(true)'), '＋新建 必须标记为未保存草稿');
  assert.equal(createSource.includes('api.'), false, '＋新建 不得发任何 API 请求（未保存不入库）');
});

test('AC-43：编辑器保存时按 isNew 分流（create vs update），草稿态不显示删除', () => {
  const editor = src('components/PromptEditor.tsx');
  assert.ok(
    /isNew \? await api\.createPrompt\(payload\) : await api\.updatePrompt\(prompt\.id, payload\)/.test(editor),
    '保存必须按 isNew 走 POST 创建 / PUT 更新',
  );
  assert.ok(editor.includes('{!isNew && ('), '草稿（未入库）不应显示删除按钮');
  assert.ok(editor.includes('editor-draft-badge'), '草稿态需要有「未保存」标识');
});

test('AC-43：草稿态的面板不得用 id=0 去请求服务端', () => {
  const editor = src('components/PromptEditor.tsx');
  assert.ok(editor.includes('promptId={isNew ? null : prompt.id}'), '面板在草稿态必须传 null（跳过请求）');
  for (const panel of ['components/VersionPanel.tsx', 'components/VariablePanel.tsx']) {
    const text = src(panel);
    assert.ok(text.includes('promptId === null'), `${panel} 必须处理 null（草稿）情形`);
  }
});

test('AC-43：取消 / 关闭（Esc）只丢弃草稿，不产生服务端记录', () => {
  const workspace = src('components/Workspace.tsx');
  const start = workspace.indexOf('const closeEditor = useCallback');
  const end = workspace.indexOf('const openEditor = useCallback');
  const closeSource = workspace.slice(start, end);
  assert.ok(closeSource.includes('setIsNew(false)') && closeSource.includes('setEditing(null)'), '关闭要清空草稿');
  assert.equal(closeSource.includes('api.'), false, '关闭草稿不得发 API 请求');
  assert.ok(/event\.key === 'Escape'/.test(workspace), 'Esc 必须能关闭编辑器');
});
