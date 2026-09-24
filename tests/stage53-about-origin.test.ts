// 阶段 53 / FR-117（R-9）/ AC-118 A 段：「关于」页「访问地址」必须反映**用户当前实际访问的协议**。
//
// 背景：生产上用户经 **HTTPS** 访问（https://prompt.tendcode.com），但「访问地址」显示
// `http://prompt.tendcode.com` —— 原实现把协议**硬编码**为 `http://`（`AboutModal.tsx` 第 57 行），
// 而该行**带复制按钮** ⇒ 用户复制走的就是这个错地址。
//
// 修法：取 `window.location.origin`（浏览器自身已知 scheme + host + port）。
// 本文件断言「取值来源正确 + 不写死协议 + 复制内容 = 显示内容 + 不新增网络请求 + 其它信息不变」；
// 真浏览器双场景（HTTP / HTTPS）证据见 tools/ac-stage53.sh 的 A 段。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel: string): string => readFileSync(path.join(ROOT, 'web', 'src', rel), 'utf8');

const about = src('components/AboutModal.tsx');
const api = src('api.ts');

/** 只取 address 定义那一行（含注释块），避免把注释里提到的 `http://` 误判成"还在写死协议"。 */
const addressDecl = ((): string => {
  const at = about.indexOf('const address =');
  assert.ok(at > 0, '找不到 address 的定义');
  const from = about.lastIndexOf('/**', at);
  return about.slice(from > 0 ? from : at, about.indexOf('\n', at));
})();

test('AC-118 A③：取值来自浏览器自身信息（origin），不写死任一协议', () => {
  assert.ok(
    /const address = .*window\.location\.origin/.test(about),
    'address 必须取 window.location.origin（协议+主机+端口由浏览器给出）',
  );
  // 真正的那行（去掉注释）里不得再出现任何写死的协议
  const codeLine = about.split('\n').find((l) => l.trimStart().startsWith('const address =')) ?? '';
  assert.equal(/"http:\/\/"|'http:\/\/'|`http:\/\/\$\{/.test(codeLine), false, '取值行不得再硬编码 http://');
  assert.equal(/https:\/\/\$\{/.test(codeLine), false, '取值行不得改成写死 https://（那会让内网 HTTP 直连反向出错）');
  // 注释里说明"为什么"，避免下一个把它改回写死协议
  assert.ok(/FR-117/.test(addressDecl), '取值处要留注释说明 R-9 的原因（原来没有，是疏漏）');
  assert.ok(/不新增任何网络请求|不新增任何网络请求|不新增网络请求/.test(addressDecl), '注释要写明没有新增网络请求');
});

test('AC-118 A①③：不新增网络请求（origin 是纯本地信息）', () => {
  // origin 不产生请求；关于页原有的唯一请求仍是 /healthz，不许多出别的
  const fetches = [...about.matchAll(/fetch\(([^)]*)\)/g)].map((m) => (m[1] ?? '').trim());
  assert.deepEqual(fetches, ["'/healthz', { headers: { accept: 'application/json' } }"], '关于页只应保留原有的 /healthz 一次探测');
  // 也没有为拿地址新增任何 API 方法
  assert.equal(/originUrl|accessAddress|fetchOrigin/.test(about), false, '不应为拿地址新增请求或 API 方法');
  // ⚠️ api.ts 里的 `credentials: 'same-origin'` 是既有的 CORS/凭据写法，与"访问地址"无关，
  //    所以只能断言"没有为 origin 新增端点/方法"，不能断言整个文件不含 origin 这个词。
  assert.equal(/origin\s*[:(]/.test(api), false, 'api.ts 不该为 origin 新增任何端点或调用');
});

test('AC-118 A①：复制内容与显示内容必然一致（同一个字符串）', () => {
  // CopyLine 的 copyable.text 与 children 都来自同一个 props.text ⇒ 同一个字符串
  const copyLine = about.slice(about.indexOf('function CopyLine'), about.indexOf('export default function'));
  assert.ok(/copyable=\{\{ text \}\}/.test(copyLine), '复制按钮必须用 copyable={{ text }}（与显示同一个字符串）');
  // 访问地址那一行传的正是 address
  const row = about.slice(about.indexOf("key: 'address'"), about.indexOf("key: 'data'"));
  assert.ok(/<CopyLine text=\{address\} \/>/.test(row), '「访问地址」行必须把 address 交给 CopyLine');
  assert.equal(/CopyLine text=\{`http/.test(row), false, '访问地址行不得再自己拼协议');
});

test('AC-118 A④：「关于」弹窗其它信息一个字都没变', () => {
  // 五个服务区条目（顺序 + 文案）
  const service = about.slice(about.indexOf("key: 'service'"), about.indexOf("key: 'usage'"));
  for (const key of ["key: 'version'", "key: 'status'", "key: 'address'", "key: 'data'", "key: 'backup'"]) {
    assert.ok(service.includes(key), `服务区必须仍有 ${key}`);
  }
  assert.ok(service.includes("label: '版本'"), '版本行仍在');
  assert.ok(service.includes("label: '状态'"), '状态行仍在');
  assert.ok(service.includes("label: '访问地址'"), '访问地址行仍在');
  assert.ok(service.includes("label: '数据文件'"), '数据文件行仍在');
  assert.ok(service.includes("label: '备份方式'"), '备份方式行仍在');
  assert.ok(service.includes('pm.db（服务端数据目录下的单文件 SQLite，随写随存）'), '数据文件文案未变');
  // 分区顺序：服务 / 使用 / 维护；默认展开前两个
  assert.ok(/defaultActiveKey=\{\['service', 'usage'\]\}/.test(about), '默认展开「服务」「使用」未变');
  for (const key of ['service', 'usage', 'maintain']) {
    assert.ok(about.includes(`key: '${key}'`), `分区 ${key} 仍在`);
  }
  // 顶区与锚点
  assert.ok(about.includes('data-testid="pm-about"'), 'pm-about 锚点仍在（AC-40 靠它定位）');
  assert.ok(about.includes('PromptManager'), '品牌行未变');
  assert.ok(about.includes('后端在线') && about.includes('后端离线'), '在线徽标文案未变');
  assert.ok(about.includes('重新探测'), '「重新探测」按钮未变');
  assert.ok(about.includes("pm-brand-art-about"), '品牌图仍在');
  assert.equal(about.match(/<CopyLine text="/g)?.length ?? 0, 5, '维护区的 5 条长命令仍各有一个 CopyLine');
  for (const cmd of [
    'node bin/pm.mjs user set-password --username admin',
    'journalctl -u promptmanager -f',
    'sudo systemctl restart promptmanager',
    'git checkout <上一个提交> && npm run build && sudo systemctl restart promptmanager',
    'docs/dependencies.md',
  ]) {
    assert.ok(about.includes(`<CopyLine text="${cmd}" />`), `维护区命令未变：${cmd.slice(0, 32)}…`);
  }
  // 使用区 7 条说明一行不少
  // ⚠️ 终点要用 usageLines **之后**的那个 `return (` —— CopyLine 里也有一个 `return (`（在前面），
  //    直接 indexOf 会切出空串。
  const uStart = about.indexOf('const usageLines');
  const uEnd = about.indexOf('return (', uStart);
  const usage = about.slice(uStart, uEnd);
  assert.equal([...usage.matchAll(/^ {4}'/gm)].length, 7, '使用区仍是 7 条说明');
});
