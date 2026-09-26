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
  const copyLine = about.slice(about.indexOf('function CopyLine'), about.indexOf('/** 外链'));
  assert.ok(/copyable=\{\{ text \}\}/.test(copyLine), '复制按钮必须用 copyable={{ text }}（与显示同一个字符串）');
  // 访问地址传给 CopyLine 的正是 address
  // （v68 FR-124 起它从「服务区」移到了「身份区」，锚点由 key:'address' 变为 pm-about-address）
  const row = about.slice(about.indexOf('data-testid="pm-about-address"'), about.indexOf('data-testid="pm-about-keywords"'));
  assert.ok(/<CopyLine text=\{address\} \/>/.test(row), '「访问地址」必须把 address 交给 CopyLine');
  assert.equal(/CopyLine text=\{`http/.test(row), false, '访问地址不得再自己拼协议');
  assert.equal(/CopyLine text=\{`https/.test(row), false, '访问地址不得写死 https');
});

test('AC-118 A④：「关于」弹窗的访问地址与状态展示仍完整（v68 FR-124 移位后）', () => {
  // ⚠️ v68（FR-124）**取消**了「服务区」：版本/状态/访问地址移入身份区继续展示，
  //    「数据文件」「备份方式」两行随整区去掉 —— 其中「备份方式」原文「拷贝 pm.db」是**错的**
  //    （WAL 模式下直接拷主库会丢未落盘写入），故按 D-56 ④「直接去掉即可」，不改写成别的样子。
  //    本条随该规格更新：钉住「身份区仍完整」与「旧的服务区确已移除」。
  assert.ok(about.includes('data-testid="pm-about-identity"'), '身份区仍在');
  assert.ok(about.includes('data-testid="pm-about-address"'), '访问地址仍在（已移入身份区）');
  assert.ok(/访问地址/.test(about), '「访问地址」标签仍在（身份区，普通文本节点而非旧 Descriptions 的 label）');
  assert.ok(about.includes('版本 {version}'), '版本显示仍在（运行时动态）');
  assert.ok(about.includes('后端在线'), '状态徽标仍在');
  assert.equal(about.includes("key: 'service'"), false, '「服务」区已按 FR-124 取消');
  assert.equal(about.includes("label: '数据文件'"), false, '「数据文件」行随服务区去掉');
  // ⚠️ 先剥注释再查「拷贝 pm.db」：组件里那段注释**恰好记录了"为什么删掉这句错文案"**，
  //    全文匹配会把它当成"文案还在"。
  const aboutCode = about.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.equal(aboutCode.includes('拷贝 pm.db'), false, '不得再教用户拷贝 pm.db（WAL 下会丢数据）');
  // 使用 / 维护两个折叠分区仍在
  for (const key of ['usage', 'maintain']) {
    assert.ok(about.includes(`key: '${key}'`), `分区 ${key} 仍在`);
  }
});

test('AC-118 A④：品牌、状态条、维护区命令与使用区条数均未变', () => {
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
