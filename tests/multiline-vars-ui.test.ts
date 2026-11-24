/**
 * 变量值录入控件的**源码级**绊线（P0：变量值必须能输入多行）。
 *
 * 为什么需要这层：变量值经常是一整段带换行的提示词片段，antd 单行 `<Input />` 既显示不出换行、
 * 也无法正常录入；这类回归在渲染级测试里只点一次很难覆盖（用户实际操作是"粘贴一段多行文本"）。
 * 这里把「两处变量值控件都是 `Input.TextArea` + `autoSize`」钉在源码上：
 *   - 填值弹窗 `VarsDialog.tsx`（`pm-var-input-<name>`）
 *   - 变量面板 `VariablePanel.tsx`（`var-<name>`）
 * 同时锁住既有的 placeholder / data-testid 契约、预览区受控高度、以及"Enter 只换行不提交"。
 *
 * ⚠️ 只读源码（经 `tests/source-text.ts` 剥注释），不挂载组件、不需要构建产物。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readWebSource } from './source-text.ts';

const dialog = readWebSource('components/VarsDialog.tsx');
const panel = readWebSource('components/VariablePanel.tsx');

/** 两处变量值控件：文件、源码、以及定位它的 data-testid 字面量。 */
const CONTROLS = [
  { name: 'VarsDialog', source: dialog, marker: 'data-testid={`pm-var-input-${name}`}' },
  { name: 'VariablePanel', source: panel, marker: 'data-testid={`var-${name}`}' },
] as const;

/**
 * 取某个标记（这里指变量值控件的 data-testid）**前面最近的 JSX 开标签**：标签名 + 属性文本。
 *
 * 为什么要"最近的开标签"而不是直接正则扫全文件：同一个文件里还有别的单行 `<Input />`
 * （例如变量面板的标题输入之类），宽泛匹配会误伤；只有紧邻变量值 testid 的那个控件才是本任务的对象。
 */
function nearestOpeningTag(source: string, marker: string): { tag: string; body: string } | null {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return null;
  const before = source.slice(0, markerIndex);
  const matches = [...before.matchAll(/<([A-Z][A-Za-z0-9_.]*)(?=[\s/>])/g)];
  const last = matches.at(-1);
  if (last === undefined || last.index === undefined) return null;
  return { tag: last[1]!, body: source.slice(last.index, markerIndex) };
}

/** 把属性文本压成单行，便于对 `autoSize={{ minRows: 1, maxRows: 10 }}` 做空白无关断言。 */
function compact(text: string): string {
  return text.replace(/\s+/g, ' ');
}

test('变量值控件是 Input.TextArea 且带 autoSize（minRows 1 / maxRows 10）', () => {
  for (const { name, source, marker } of CONTROLS) {
    const control = nearestOpeningTag(source, marker);
    assert.ok(control !== null, `${name} 找不到变量值控件（缺 ${marker}）`);
    assert.equal(control.tag, 'Input.TextArea', `${name} 的变量值控件必须是 Input.TextArea，实际是 <${control.tag}>`);
    assert.match(
      compact(control.body),
      /autoSize=\{\{ minRows: 1, maxRows: 10 \}\}/,
      `${name} 的变量值控件必须带 autoSize={{ minRows: 1, maxRows: 10 }}`,
    );
  }
});

test('变量值输入不再使用单行 <Input />（正则精确定位到变量值那一行，不误伤其它单行 Input）', () => {
  // 每个正则都要求「单行 `<Input` 开标签」与「变量值 testid」在同一小段内相邻，
  // 因此同一个文件里其它正常单行 Input（若有）不会被误判。
  assert.equal(
    /<Input(?=[\s>])[\s\S]{0,400}?data-testid=\{`pm-var-input-/.test(dialog),
    false,
    'VarsDialog 的变量值控件不得再是单行 <Input />',
  );
  assert.equal(
    /<Input(?=[\s>])[\s\S]{0,400}?data-testid=\{`var-/.test(panel),
    false,
    'VariablePanel 的变量值控件不得再是单行 <Input />',
  );
});

test('data-testid 与「留空则用默认值」占位提示原样保留', () => {
  assert.ok(dialog.includes('data-testid={`pm-var-input-${name}`}'), 'VarsDialog 保留 pm-var-input-<name> testid');
  assert.ok(panel.includes('data-testid={`var-${name}`}'), 'VariablePanel 保留 var-<name> testid');
  for (const { name, source } of CONTROLS) {
    assert.ok(source.includes('留空则用默认值：'), `${name} 保留「留空则用默认值：」占位提示`);
    assert.match(source, /placeholder=\{[^}]*defaults/, `${name} 的占位提示仍优先显示服务端默认值`);
    assert.ok(source.includes('{{${name}}} 的值'), `${name} 保留无默认值时的占位文案`);
  }
});

test('填值弹窗的预览区仍有受控高度：maxHeight + overflow-y: auto', () => {
  const previewIndex = dialog.indexOf('data-testid="pm-vars-preview"');
  assert.ok(previewIndex >= 0, 'VarsDialog 的预览区 pm-vars-preview 必须存在');
  const styleStart = dialog.indexOf('style={{', previewIndex);
  assert.ok(styleStart > previewIndex, '预览区必须用内联 style 控制高度');
  const previewStyle = dialog.slice(styleStart, styleStart + 800);
  assert.match(previewStyle, /maxHeight:\s*\d+/, '预览区必须有显式 maxHeight（不能无限撑高）');
  assert.match(previewStyle, /overflowY:\s*'auto'/, '预览区必须竖向可滚（overflow-y: auto）');
  assert.match(previewStyle, /whiteSpace:\s*'pre-wrap'/, '预览区保留 pre-wrap（多行原样展示）');
});

test('弹窗 body 在窄视口内可滚，且不用裸 100vh 高度（本仓库无全局 border-box）', () => {
  const bodyMatch = /styles=\{\{\s*body:\s*\{([\s\S]*?)\}\s*\}\}/.exec(dialog);
  assert.ok(bodyMatch !== null, 'VarsDialog 必须给 Modal body 显式样式');
  const body = bodyMatch[1]!;
  // AC-82 的既有契约：body 显式 minHeight ≥ 340，不能被这次改动吃掉。
  assert.match(body, /minHeight:\s*360/, '保留既有的 body minHeight 360（AC-82）');
  assert.match(body, /overflowY:\s*'auto'/, 'body 必须可竖向滚动，避免移动端变量多时撑破视口');
  assert.match(body, /maxHeight:\s*'calc\(100vh - \d+px\)'/, 'maxHeight 用 calc(100vh - Npx)，不是裸 100vh 高度');
  assert.equal(
    body.replace(/calc\(100vh - \d+px\)/g, '').includes('100vh'),
    false,
    '除 calc 之外不许出现裸 100vh 高度（无全局 box-sizing: border-box，100vh+padding 会溢出）',
  );
});

test('Enter 只换行不提交；提交/渲染逻辑与"空串=未填"口径未被改动', () => {
  // 多行控件里 Enter 是换行键，不得再挂 onPressEnter 去做提交（提交仍只走按钮）。
  for (const { name, source } of CONTROLS) {
    assert.equal(source.includes('onPressEnter'), false, `${name} 不得加 onPressEnter（Enter 只换行）`);
  }
  // VarsDialog：Form.Item 绑定 / onValuesChange / filledValues 口径一字不改。
  assert.match(dialog, /<Form\.Item[\s\S]*?name=\{name\}/, 'VarsDialog 的 Form.Item 仍按变量名绑定');
  assert.match(dialog, /onValuesChange=\{\(_changed, all\)/, 'VarsDialog 仍用 onValuesChange 同步 values');
  assert.match(dialog, /setValues\(filledValues\(variables, all as Record<string, unknown>\)\)/, 'VarsDialog 仍以 filledValues 剔除空值');
  // VariablePanel：render() 仍只送非空字符串（不 trim，空串=未填）。
  assert.match(panel, /typeof value === 'string' && value !== ''/, 'VariablePanel 仍只提交非空字符串');
  assert.equal(panel.includes('.trim('), false, 'VariablePanel 不得 trim 变量值（空串=未填的口径依赖它）');
});
