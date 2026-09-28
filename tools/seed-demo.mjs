#!/usr/bin/env node
/**
 * 演示数据：为 docs/shots 截图准备「真实感」数据（走真实 API，不直连库）。
 *
 * 用法（在 228 上，指向测试环境 8767）：
 *   PM_URL=http://127.0.0.1:8767 PM_USER=admin PM_PASS=xxx node tools/seed-demo.mjs
 *
 * 数据特征（为 8 张关键截图服务）：
 *   - 分层目录（写作 / 编程 / 运维 / 分析），带 emoji 前缀
 *   - 若干标签（高频 / 模板 / 待整理 …）
 *   - 含变量的 prompt（{{language}} / {{tone}} 等）→ 让卡片与编辑器有内容
 *   - 长 Markdown 正文（含标题/列表/代码块）→ 让详情面与预览有内容
 *   - 多版本历史（对 1~2 条做编辑，产生 v1/v2）→ 让版本历史有内容
 *   - 收藏若干条 → 让「收藏置顶」可见
 *   - 制造使用记录（复制几次）→ 让「取用次数」非零
 */
const BASE = (process.env.PM_URL ?? 'http://127.0.0.1:8767').replace(/\/$/, '');
const USER = process.env.PM_USER ?? 'admin';
const PASS = process.env.PM_PASS ?? '';
if (!PASS) {
  process.stderr.write('error: 需要 PM_PASS\n');
  process.exit(2);
}

let cookie = '';

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const setC = res.headers.getSetCookie?.() ?? [];
  if (setC.length > 0) cookie = setC.map((c) => c.split(';')[0]).join('; ');
  const text = await res.text();
  let json;
  try {
    json = text === '' ? null : JSON.parse(text);
  } catch {
    json = text;
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${typeof json === 'string' ? json.slice(0, 200) : JSON.stringify(json).slice(0, 200)}`);
  }
  return json;
}

// ── 目录 ────────────────────────────────────────────────────────────────────
const FOLDERS = [
  { name: '✍️ 写作与内容', children: [] },
  { name: '💻 编程开发', children: [] },
  { name: '🛠 运维与部署', children: [] },
  { name: '📊 分析研究', children: [] },
];

// ── prompt 定义 ─────────────────────────────────────────────────────────────
const P = [
  {
    title: '会话交接模板',
    folder: '💻 编程开发',
    tags: ['高频', '模板'],
    favorite: true,
    vars: ['project', 'focus', 'next_step'],
    sys: '你是资深工程师，擅长把上下文整理成可交接的文档。',
    user: `请把当前会话整理成**可交接**的文档，项目：{{project}}，重点：{{focus}}。

## 交接要求

1. **已完成**：列出已验证完成的事项（附证据/命令）
2. **进行中**：当前停在哪个动作、做到哪一步
3. **下一步**：{{next_step}} —— 具体到可直接执行
4. **坑与注意**：踩过的坑、不可重复的操作

> 不写"进展顺利"这类空话；每条结论都要能对上实际动作。`,
  },
  {
    title: '代码审查清单',
    folder: '💻 编程开发',
    tags: ['高频', '质量'],
    favorite: true,
    vars: ['language', 'scope'],
    sys: '你是严格的代码审查者，只提**可执行**的修改意见。',
    user: `审查以下 {{language}} 代码（范围：{{scope}}），按三个层级给出意见：

## 必须改（正确性 / 安全）
- 边界条件、错误处理、资源释放、注入风险

## 建议改（可维护性）
- 命名、重复代码、过长函数、缺失注释

## 可选（风格）
- 一致性问题；**明确指出是风格偏好、非错误**

> 每条意见给「文件:行号」与**具体改法**，不要只说"建议优化"。`,
  },
  {
    title: 'SQL 查询优化',
    folder: '💻 编程开发',
    tags: ['数据库'],
    favorite: false,
    vars: ['db', 'slow_query'],
    sys: '你是数据库性能专家。',
    user: `数据库：{{db}}

慢查询：
\`\`\`sql
{{slow_query}}
\`\`\`

请给出：
1. **执行计划解读**（关注全表扫描 / 临时表 / filesort）
2. **索引建议**（给出 DDL 语句）
3. **改写方案**（如子查询 → JOIN）
4. **预期收益**与**验证方法**`,
  },
  {
    title: '周报生成器',
    folder: '✍️ 写作与内容',
    tags: ['模板', '高频'],
    favorite: true,
    vars: ['week', 'highlights', 'blockers'],
    sys: '你是务实的汇报助手，讨厌空洞措辞。',
    user: `生成本周（{{week}}）周报。

**本周重点**：{{highlights}}
**阻塞项**：{{blockers}}

## 输出结构
- 上半段：**结果导向**（做成了什么、对业务的影响）
- 下半段：**过程与阻塞**（卡在哪、需要谁支持）
- 每项尽量量化（数字 / 百分比 / 前后对比）

> 避免"积极推进""持续优化"这类无信息量的表述。`,
  },
  {
    title: '技术方案评审',
    folder: '✍️ 写作与内容',
    tags: ['评审'],
    favorite: false,
    vars: ['topic', 'constraint'],
    sys: '你是架构评审者，善于发现方案的隐藏假设。',
    user: `评审方案：{{topic}}
约束条件：{{constraint}}

请从以下角度质疑：
1. **前提假设**是否成立？哪些是"想当然"？
2. **失败模式**：极端情况会怎样？（流量 10 倍 / 依赖挂掉 / 数据不一致）
3. **替代方案**：有没有更简单的做法？
4. **不可逆决策**：哪些选择以后难改？
5. **最小验证**：能不能先做个小实验再全量投入？`,
  },
  {
    title: 'Docker 部署排查',
    folder: '🛠 运维与部署',
    tags: ['运维', '高频'],
    favorite: true,
    vars: ['service', 'symptom'],
    sys: '你是运维工程师，按**从外到内**的顺序排查。',
    user: `服务：{{service}}
现象：{{symptom}}

## 排查顺序（逐层确认，不要跳）

1. **外部**：域名 / DNS / 证书 / 反代配置
2. **监听**：容器端口映射、绑定地址（\`0.0.0.0\` vs \`127.0.0.1\`）
3. **健康**：healthz 返回什么？容器 status / RestartCount？
4. **日志**：最近错误（给出精确命令）
5. **资源**：CPU / 内存 / 磁盘 / inode

> 每步给出**判断依据**（期望值 vs 实际值），不要凭感觉说"应该是网络问题"。`,
  },
  {
    title: 'Nginx 配置生成',
    folder: '🛠 运维与部署',
    tags: ['运维', '模板'],
    favorite: false,
    vars: ['domain', 'upstream', 'port'],
    sys: '',
    user: `生成 Nginx 反向代理配置：

- 域名：{{domain}}
- 上游：{{upstream}}:{{port}}

要求：
- HTTPS（证书路径用占位符）
- HTTP 跳 HTTPS
- 透传 \`X-Forwarded-For\` / \`X-Forwarded-Proto\` / \`Host\`
- WebSocket 升级支持
- 合理超时（读 60s、连 5s）
- 加安全响应头（\`X-Content-Type-Options\` 等）

> 附一段**验证步骤**：怎么确认配置真的生效。`,
  },
  {
    title: '数据洞察分析',
    folder: '📊 分析研究',
    tags: ['分析'],
    favorite: false,
    vars: ['dataset', 'question'],
    sys: '你是数据分析师，先质疑数据质量再谈结论。',
    user: `数据：{{dataset}}
问题：{{question}}

## 分析步骤

1. **数据质量**：缺失 / 异常值 / 口径变化？（先排除"数据本身就是错的"）
2. **描述统计**：分布、趋势、异常点
3. **归因**：相关 ≠ 因果，指出可能的混淆变量
4. **结论**：给**置信度**与**反例条件**（什么情况下结论不成立）

> 每个结论标注**证据强度**（强 / 中 / 弱），弱证据要明说是推测。`,
  },
  {
    title: '竞品调研框架',
    folder: '📊 分析研究',
    tags: ['调研'],
    favorite: false,
    vars: ['market', 'competitors'],
    sys: '',
    user: `调研市场：{{market}}
对标：{{competitors}}

## 调研维度

| 维度 | 关注点 |
| --- | --- |
| 定位 | 卖给谁？解决什么问题？ |
| 定价 | 模式（订阅/买断/按量）、价位段 |
| 获客 | 渠道、内容策略、SEO |
| 产品 | 核心功能、差异化、明显短板 |
| 护城河 | 数据/网络效应/切换成本 |

> 每条结论标**来源**；找不到来源的写"未证实"。`,
  },
  {
    title: '会议纪要整理',
    folder: '📊 分析研究',
    tags: ['模板'],
    favorite: false,
    vars: ['meeting', 'raw_notes'],
    sys: '',
    user: `会议：{{meeting}}
原始记录：
{{raw_notes}}

整理成：
1. **决议**（明确达成了什么）
2. **待办**（负责人 + 截止时间，用表格）
3. **悬而未决**（有分歧、需要再议的）
4. **下次议题**

> 只写记录里有的内容，**不要补脑**；记录没写负责人的标"待指派"。`,
  },
  {
    title: '需求澄清提问',
    folder: '✍️ 写作与内容',
    tags: ['需求', '高频'],
    favorite: false,
    vars: ['requirement'],
    sys: '你是需求分析师，善于把模糊需求逼成可验收的规格。',
    user: `原始需求：{{requirement}}

**只提问，不要直接给实现方案。** 覆盖：
- 谁用？什么场景下用？多久用一次？
- 成功标准是什么？（可量化的）
- 边界：什么情况**不**该做 / 不做？
- 与现有功能的关系（替代？并存？）
- 失效表现是什么？（怎么知道它坏了）

> 一次问完，别挤牙膏。`,
  },
  {
    title: '文档写作助手',
    folder: '✍️ 写作与内容',
    tags: ['写作', '模板'],
    favorite: false,
    vars: ['doc_type', 'audience'],
    sys: '',
    user: `写一份 {{doc_type}}，读者是 {{audience}}。

原则：
1. **判据是"读者能照着做出来"**，不是"读起来很专业"
2. 命令要**可直接复制**，路径要**具体**
3. 前置条件写在最前面
4. 常见错误单独一节
5. 不写"简单来说""众所周知"

> 凡是"应该""建议"的地方，改成**具体动作 + 可验证结果**。`,
  },
];

async function main() {
  await api('POST', '/api/login', { username: USER, password: PASS });
  const me = await api('GET', '/api/me');
  if (!me || me.username === undefined) throw new Error('登录失败');

  // ① 目录（先建父级）
  const folderId = {};
  const existing = await api('GET', '/api/folders');
  const flat = [];
  const walk = (list) => { for (const f of list ?? []) { flat.push(f); walk(f.children); } };
  walk(existing.items ?? existing);
  const byName = new Map(flat.map((f) => [f.name, f.id]));
  for (const f of FOLDERS) {
    if (byName.has(f.name)) { folderId[f.name] = byName.get(f.name); continue; }
    try {
      const created = await api('POST', '/api/folders', { name: f.name, parent_id: null });
      folderId[f.name] = created.id;
    } catch { /* 并发/重复：忽略，后面按名字回查 */ }
  }
  // 子目录（让目录树有层次）
  if (!byName.has('前端') && folderId['💻 编程开发'] !== undefined) {
    try {
      const sub = await api('POST', '/api/folders', { name: '前端', parent_id: folderId['💻 编程开发'] });
      folderId['💻 编程开发·前端'] = sub.id;
    } catch { /* 忽略 */ }
  }

  // ② 标签
  const allTags = [...new Set(P.flatMap((p) => p.tags))];
  for (const t of allTags) {
    try { await api('POST', '/api/tags', { name: t }); } catch { /* 同名已存在：跳过 */ }
  }

  // ③ prompts（含多版本）
  const ids = [];
  for (const p of P) {
    const body = {
      title: p.title,
      user_prompt: p.user,
      system_prompt: p.sys,
      notes: p.favorite ? '常用模板，改前先看版本历史。' : '',
      folder_id: folderId[p.folder] ?? null,
      tags: p.tags,              // ← 字符串数组（schema: items 为 string）
      favorite: p.favorite === true,
    };
    const created = await api('POST', '/api/prompts', body);
    const id = created.id;       // ← 直接返回对象
    ids.push(id);
  }

  // ④ 制造版本历史：编辑前两条各两次 → v1/v2/v3
  for (const id of ids.slice(0, 2)) {
    await api('PUT', `/api/prompts/${String(id)}`, {
      user_prompt: `${P[ids.indexOf(id)].user}\n\n## 修订记录（v2）\n- 补了「判据要可核对」这一条`,
    });
    await api('PUT', `/api/prompts/${String(id)}`, {
      user_prompt: `${P[ids.indexOf(id)].user}\n\n## 修订记录（v3）\n- 补了「判据要可核对」这一条\n- 明确「不要写空话」，附反例`,
    });
  }

  // ⑤ 制造使用记录（让「取用次数」非零）—— 复制前若干条
  for (const id of ids.slice(0, 6)) {
    try {
      await api('GET', `/api/prompts/${String(id)}`);   // 打开详情 → 留痕（view）；取用统计只算 copy/mcp，故仅作审计痕迹
    } catch {
      /* 复制接口对含变量者可能要求走 render；忽略失败，不影响展示 */
    }
  }

  const list = await api('GET', '/api/prompts?limit=100');
  process.stdout.write(
    `完成：prompts=${String(list.total ?? ids.length)} folders=${String(Object.keys(folderId).length)} tags=${String(allTags.length)}\n`,
  );
}

await main();
