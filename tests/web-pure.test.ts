// 阶段 8 前端纯逻辑单测（红→绿：先写测试，web/src/pure.ts 尚不存在时应整组失败）。
// 这些函数被界面真实调用（列表 query 组装 / 文件夹树 / 导入文件预览计数 / diff 行分类）。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REPLACE_WARNING,
  analyzeImportFile,
  buildFolderTree,
  buildPromptListQuery,
  classifyDiffLines,
  extractVariablesLocal,
  formatImportDetails,
  hasVariables,
  orderPrompts,
  previewRender,
  promptExcerpt,
  type FolderLike,
} from '../web/src/pure.ts';

test('buildPromptListQuery：只带非默认参数，顺序稳定', () => {
  assert.equal(buildPromptListQuery({}), '');
  assert.equal(
    buildPromptListQuery({ q: '会话交接', folderId: 3, tag: '交接', favorite: true, sort: 'recent_used', limit: 20, offset: 40 }),
    '?q=%E4%BC%9A%E8%AF%9D%E4%BA%A4%E6%8E%A5&folder_id=3&tag=%E4%BA%A4%E6%8E%A5&favorite=true&sort=recent_used&limit=20&offset=40',
  );
});

test('buildPromptListQuery：空串/纯空白/默认排序不发参数；favorite=false 要发', () => {
  assert.equal(buildPromptListQuery({ q: '   ', folderId: null, tag: '  ', favorite: false, sort: 'updated', limit: 50, offset: 0 }), '?favorite=false&limit=50&offset=0');
});

test('buildFolderTree：按 sort_order→id 排序、挂到 parent 下、孤儿提到根', () => {
  const folders: FolderLike[] = [
    { id: 2, name: '运维', parent_id: 1, sort_order: 0 },
    { id: 1, name: '工作', parent_id: null, sort_order: 0 },
    { id: 3, name: '孤儿', parent_id: 999, sort_order: 5 },
  ];
  const tree = buildFolderTree(folders);
  assert.deepEqual(
    tree.map((n) => ({ value: n.value, title: n.title, children: (n.children ?? []).map((c) => c.value) })),
    [
      { value: 1, title: '工作', children: [2] },
      { value: 3, title: '孤儿', children: [] },
    ],
  );
});

test('analyzeImportFile：合法文件给出三类条目数', () => {
  const result = analyzeImportFile(
    JSON.stringify({
      app: 'promptmanager',
      schema_version: 1,
      folders: [{ id: 1, name: '运维' }],
      tags: [{ id: 1, name: '交接' }, { id: 2, name: '发布' }],
      prompts: [{ id: 1, title: 'a' }],
    }),
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok ? result.counts : null, { folders: 1, tags: 2, prompts: 1 });
});

test('analyzeImportFile：坏 JSON / 错 app / schema 过高 / 字段不是数组都要被拒', () => {
  assert.equal(analyzeImportFile('{oops').ok, false);
  assert.equal(analyzeImportFile('{"app":"other","schema_version":1}').ok, false);
  assert.equal(analyzeImportFile('{"app":"promptmanager","schema_version":99}').ok, false);
  assert.equal(analyzeImportFile('{"app":"promptmanager","schema_version":1,"prompts":{}}').ok, false);
  assert.equal(analyzeImportFile('{"app":"promptmanager","schema_version":1}').ok, true);
});

test('formatImportDetails：把服务端 invalid_import 的 details 变成界面可读的逐条说明', () => {
  assert.deepEqual(
    formatImportDetails([
      { path: 'data.prompts[].title', message: '缺少 title：导入不允许静默补成空串（FR-10b）' },
      { path: 'data.prompts[].user_prompt', message: '缺少 user_prompt（FR-10b）' },
    ]),
    [
      'data.prompts[].title：缺少 title：导入不允许静默补成空串（FR-10b）',
      'data.prompts[].user_prompt：缺少 user_prompt（FR-10b）',
    ],
  );
  assert.deepEqual(formatImportDetails(undefined), [], '非数组 → 空数组（不抛错）');
  assert.deepEqual(formatImportDetails(['裸字符串']), ['裸字符串']);
  assert.deepEqual(formatImportDetails([{ message: '只有 message' }]), ['data：只有 message']);
  assert.deepEqual(formatImportDetails([{ path: 'data.prompts[]' }]), ['data.prompts[]：{"path":"data.prompts[]"}']);
});

test('REPLACE_WARNING 与 BRIEF FR-11b 逐字一致', () => {
  assert.equal(REPLACE_WARNING, '将清空现有全部 prompt / 文件夹 / 标签 / 版本历史');
});

test('classifyDiffLines：区分新增/删除/上下文/元信息', () => {
  const diff = ['--- a', '+++ b', '@@ -1 +1 @@', ' 上下文', '-旧', '+新', '\\ No newline at end of file'].join('\n');
  assert.deepEqual(classifyDiffLines(diff).map((l) => l.type), ['meta', 'meta', 'meta', 'ctx', 'del', 'add', 'meta']);
});

test('extractVariablesLocal：顺序=首次出现、去重、转义不算、{{name:示例}} 不算变量（FR-41e ⑦）', () => {
  assert.deepEqual(extractVariablesLocal('你好 {{ 姓名 }}，重复 {{姓名}} 与 \\{{保留}} 以及 {{var-b}}'), ['姓名', 'var-b']);
  assert.deepEqual(extractVariablesLocal('{{项目}} 和 {{项目}}'), ['项目']);
  // FR-41e 第 7 条：`{{name:示例值}}` 在本契约下**不得**判成变量（`:` 不在变量名字符集内）
  assert.deepEqual(extractVariablesLocal('默认值写法 {{name:张三}} 不算变量'), []);
  assert.deepEqual(extractVariablesLocal(undefined, '{{a_b-c}}'), ['a_b-c']);
  assert.equal(hasVariables('这里是 {{项目}}'), true);
  assert.equal(hasVariables('这里没有变量'), false);
  assert.equal(hasVariables('转义的 \\{{项目}} 不算'), false);
});

test('previewRender：与服务端 renderVariables 同规则（提供了就替换、未提供原样保留、转义去反斜杠）', () => {
  assert.equal(previewRender('你好 {{姓名}}，项目 {{ 项目 }}', { 姓名: '张三', 项目: 'greenhouse' }), '你好 张三，项目 greenhouse');
  assert.equal(previewRender('你好 {{姓名}} 与 {{项目}}', { 姓名: '张三' }), '你好 张三 与 {{项目}}');
  assert.equal(previewRender('转义 \\{{姓名}} 保持字面', { 姓名: '张三' }), '转义 {{姓名}} 保持字面');
  assert.equal(previewRender('{{name:张三}} 不算变量', { name: '李四' }), '{{name:张三}} 不算变量');
});

test('promptExcerpt：卡片摘要去 markdown 记号、折叠空白、超长截断', () => {
  const md = '# 标题\n\n- 交接人：{{姓名}}\n\n```bash\ncurl -s http://127.0.0.1:8767/healthz\n```';
  const out = promptExcerpt(md, 40);
  assert.equal(out.includes('#'), false);
  assert.equal(out.includes('```'), false);
  assert.equal(out.includes('\n'), false);
  assert.ok(out.length <= 41, `摘要应被截断，实际 ${out.length}`);
});

test('orderPrompts：收藏置顶 + 标题排序（当前页内）——分栏/表格/卡片共用', () => {
  const items = [
    { title: 'b', favorite: false },
    { title: 'a', favorite: true },
    { title: 'c', favorite: false },
  ];
  assert.deepEqual(orderPrompts(items, 'updated', false).map((p) => p.title), ['b', 'a', 'c']);
  assert.deepEqual(orderPrompts(items, 'updated', true).map((p) => p.title), ['a', 'b', 'c']);
  assert.deepEqual(orderPrompts(items, 'title', false).map((p) => p.title), ['a', 'b', 'c']);
  assert.deepEqual(orderPrompts(items, 'title', true).map((p) => p.title), ['a', 'b', 'c']);
  // 不改原数组
  assert.deepEqual(items.map((p) => p.title), ['b', 'a', 'c']);
});
