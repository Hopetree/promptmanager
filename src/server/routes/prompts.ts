import type { FastifyInstance } from 'fastify';
import { NotFoundError } from '../../errors.js';
import {
  bulkPrompts,
  createPrompt,
  reorderPrompts,
  deletePrompt,
  getPrompt,
  listPrompts,
  updatePrompt,
  type BulkPromptsInput,
  type CreatePromptInput,
  type UpdatePromptInput,
} from '../../services/prompts.js';
import { extractVariables, renderVariables } from '../../services/variables.js';
import { diffVersions, listVersions, rollbackToVersion } from '../../services/versions.js';
import { kindForChannel, recordUsage } from '../../services/usage.js';
import { currentPrincipal } from '../auth.js';
import { parseBoundedInt, parsePositiveId } from '../params.js';

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

/**
 * 查询串一律是字符串（应用关掉了 ajv 类型强转，避免 body 被静默改写）：
 * q / folder_id / tag / favorite / limit / offset（BRIEF §6.1、FR-3）。
 * `favorite` 只接受 true/false，其他值 400；`folder_id` 必须为正整数；limit 超上限按**截断**。
 */
const listQuerySchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    q: { type: 'string' },
    folder_id: { type: 'string', pattern: '^[0-9]+$' },
    tag: { type: 'string' },
    favorite: { type: 'string', enum: ['true', 'false'] },
    limit: { type: 'string', pattern: '^[0-9]+$' },
    offset: { type: 'string', pattern: '^[0-9]+$' },
    sort: { type: 'string', enum: ['updated', 'recent_used', 'custom'] },
  },
} as const;

/** FR-70：`PATCH /api/prompts/order` 的入参（当前视图内的完整顺序）。 */
const promptOrderSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['ids'],
  properties: {
    ids: { type: 'array', minItems: 1, maxItems: 5000, items: { type: 'integer', minimum: 1 } },
  },
} as const;

/** FR-77：`POST /api/prompts/bulk` 的入参（表格多选后的批量动作）。 */
const promptBulkSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['action', 'ids'],
  properties: {
    action: { type: 'string', enum: ['favorite', 'move', 'delete'] },
    ids: { type: 'array', minItems: 1, maxItems: 5000, items: { type: 'integer', minimum: 1 } },
    folder_id: { type: ['integer', 'null'], minimum: 1 },
  },
} as const;

const writableFields = {
  title: { type: 'string', maxLength: 500 },
  user_prompt: { type: 'string', maxLength: 200_000 },
  system_prompt: { type: 'string', maxLength: 200_000 },
  notes: { type: 'string', maxLength: 200_000 },
  folder_id: { type: ['integer', 'null'], minimum: 1 },
  tags: {
    type: 'array',
    maxItems: 50,
    items: { type: 'string', minLength: 1, maxLength: 64 },
  },
  favorite: { type: 'boolean' },
} as const;

const createPromptSchema = {
  type: 'object',
  additionalProperties: false,
  properties: writableFields,
} as const;

/** PUT 是"可写字段的子集"（BRIEF §6.1），因此不设 required。 */
const updatePromptSchema = {
  type: 'object',
  additionalProperties: false,
  properties: writableFields,
} as const;

/** diff 的两个版本号都是**必填**（缺参 → 400，BRIEF §6.1）。 */
const diffQuerySchema = {
  type: 'object',
  additionalProperties: true,
  required: ['from', 'to'],
  properties: {
    from: { type: 'string', pattern: '^[0-9]+$' },
    to: { type: 'string', pattern: '^[0-9]+$' },
  },
} as const;

/** render 的 body：`values` 可缺省（缺省 = 全部变量都进 missing）。 */
const renderBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    values: { type: 'object', additionalProperties: true, maxProperties: 200 },
  },
} as const;

export function registerPromptRoutes(app: FastifyInstance): void {
  app.get('/api/prompts', { schema: { querystring: listQuerySchema } }, async (request) => {
    const query = request.query as {
      q?: string;
      folder_id?: string;
      tag?: string;
      favorite?: string;
      limit?: string;
      offset?: string;
      sort?: string;
    };
    const limit = parseBoundedInt(query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT, 'limit');
    const offset = parseBoundedInt(query.offset, 0, 0, Number.MAX_SAFE_INTEGER, 'offset');
    const folderId =
      query.folder_id === undefined
        ? undefined
        : parseBoundedInt(query.folder_id, 1, 1, Number.MAX_SAFE_INTEGER, 'folder_id');

    const result = await listPrompts(app.qe, {
      q: query.q ?? '',
      folderId,
      tag: query.tag,
      favorite: query.favorite === undefined ? undefined : query.favorite === 'true',
      sort:
        query.sort === 'recent_used' ? 'recent_used' : query.sort === 'custom' ? 'custom' : 'updated',
      limit,
      offset,
    });

    return { total: result.total, limit, offset, items: result.items };
  });

  /**
   * FR-70 / D-28：拖拽排序落库 —— body `{ "ids": number[] }` = **当前视图内的完整新顺序**。
   * 校验（不存在 / 重复 / 空）→ 400 `invalid_body`；幂等；只改 `sort_order`（不动 updated_at / 版本）。
   */
  app.patch('/api/prompts/order', { schema: { body: promptOrderSchema } }, async (request, reply) => {
    const { ids } = request.body as { ids: number[] };
    await reorderPrompts(app.qe, ids);
    return reply.code(204).send();
  });

  app.post('/api/prompts', { schema: { body: createPromptSchema } }, async (request, reply) => {
    const prompt = await createPrompt(app.qe, request.body as CreatePromptInput);
    return reply.code(201).send(prompt);
  });

  /**
   * FR-77 ⑥（方案①）：**批量接口** —— 表格多选后的 批量收藏 / 批量移动 / 批量删除。
   * body `{ "action": "favorite"|"move"|"delete", "ids": number[], "folder_id"?: number|null }`；
   * 整批**一个事务**；返回 `{ action, affected }`；非法/不存在 id / 目标文件夹不存在 → 400 `invalid_body`。
   * 只**新增**接口，不改动既有单条接口的契约。
   */
  app.post('/api/prompts/bulk', { schema: { body: promptBulkSchema } }, async (request) => {
    return bulkPrompts(app.qe, request.body as BulkPromptsInput);
  });

  app.get('/api/prompts/:id', async (request) => {
    const id = parsePositiveId((request.params as { id?: string }).id);
    const prompt = await getPrompt(app.qe, id);
    if (prompt === null) throw new NotFoundError();

    /**
     * FR-114（用户原话「打开详情不要算，只有真的复制才是使用」）：
     * 打开详情**只留痕**（`kind='view'`），**不计入 `use_count`** —— 由聚合侧只统计 copy/mcp 实现。
     * 保留这条记录是为了不丢"谁在什么时候看过"的审计线索（D-50 ①）。
     * FR-104：令牌访问记该令牌 id（会话记 NULL），让"谁看的"可归因。
     */
    const principal = currentPrincipal(request);
    await recordUsage(app.qe, id, principal.channel, principal.tokenId ?? null, 'view');
    return (await getPrompt(app.qe, id)) ?? prompt;
  });

  app.put('/api/prompts/:id', { schema: { body: updatePromptSchema } }, async (request) => {
    const id = parsePositiveId((request.params as { id?: string }).id);
    return updatePrompt(app.qe, id, request.body as UpdatePromptInput);
  });

  // ---- 版本历史（FR-7 / AC-9）----
  app.get('/api/prompts/:id/versions', async (request) => {
    const id = parsePositiveId((request.params as { id?: string }).id);
    return { items: await listVersions(app.qe, id) };
  });

  app.get('/api/prompts/:id/diff', { schema: { querystring: diffQuerySchema } }, async (request) => {
    const id = parsePositiveId((request.params as { id?: string }).id);
    const query = request.query as { from: string; to: string };
    const from = parseBoundedInt(query.from, 1, 1, Number.MAX_SAFE_INTEGER, 'from');
    const to = parseBoundedInt(query.to, 1, 1, Number.MAX_SAFE_INTEGER, 'to');
    return { diff: await diffVersions(app.qe, id, from, to) };
  });

  app.post('/api/prompts/:id/versions/:n/rollback', async (request) => {
    const id = parsePositiveId((request.params as { id?: string }).id);
    const versionNo = parsePositiveId((request.params as { n?: string }).n);
    return rollbackToVersion(app.qe, id, versionNo);
  });

  // ---- 变量（FR-8 / AC-8）：提取自 user_prompt + system_prompt，渲染不写库 ----
  app.get('/api/prompts/:id/variables', async (request) => {
    const id = parsePositiveId((request.params as { id?: string }).id);
    const prompt = await getPrompt(app.qe, id);
    if (prompt === null) throw new NotFoundError();
    return { variables: extractVariables(prompt.user_prompt, prompt.system_prompt) };
  });

  app.post('/api/prompts/:id/render', { schema: { body: renderBodySchema } }, async (request) => {
    const id = parsePositiveId((request.params as { id?: string }).id);
    const prompt = await getPrompt(app.qe, id);
    if (prompt === null) throw new NotFoundError();

    const values = (request.body as { values?: Record<string, unknown> }).values ?? {};
    const user = renderVariables(prompt.user_prompt, values);
    const system = renderVariables(prompt.system_prompt, values);
    const missing = [...new Set([...user.missing, ...system.missing])];

    /**
     * FR-19 + FR-114：渲染取用记一条，并**计入**取用。
     * 事件类型由通道推导：MCP 通道 ⇒ `'mcp'`（MCP 取用仍算，D-50 ④），会话/令牌 ⇒ `'copy'`。
     */
    const renderPrincipal = currentPrincipal(request);
    await recordUsage(
      app.qe,
      id,
      renderPrincipal.channel,
      renderPrincipal.tokenId ?? null,
      kindForChannel(renderPrincipal.channel),
    );
    return { user_prompt: user.text, system_prompt: system.text, missing };
  });

  /**
   * FR-115：**"记一次复制"的轻量端点** —— 只记账，**不返回正文**、**不渲染**、**不产生 `view`**。
   *
   * 为什么需要它：不含变量的提示词在界面上是"纯本地剪贴板"复制（阶段 49 为修"复制 +2"去掉了
   * `GET /:id`）⇒ **后端没有任何记账点被触发** ⇒ 「取用 N 次」永远不涨（用户报障）。
   *
   * ⚠️ 为什么**不**复用既有接口（D-51 ② 明令）：
   * - `GET /api/prompts/:id` —— 那是"打开详情"，会记成 `kind='view'`（与"打开详情"混淆）；
   * - `POST …/render` —— 会**多做一次渲染**（用户既没填值、也不需要渲染结果），语义不符。
   * 所以这里只做一件事：**记一条计入型取用**（`copy` / MCP 通道则 `mcp`），返回 204。
   */
  app.post('/api/prompts/:id/copy', async (request, reply) => {
    const id = parsePositiveId((request.params as { id?: string }).id);
    const prompt = await getPrompt(app.qe, id);
    if (prompt === null) throw new NotFoundError();

    const copyPrincipal = currentPrincipal(request);
    await recordUsage(
      app.qe,
      id,
      copyPrincipal.channel,
      copyPrincipal.tokenId ?? null,
      kindForChannel(copyPrincipal.channel),
    );
    return reply.code(204).send();
  });

  app.delete('/api/prompts/:id', async (request, reply) => {
    const id = parsePositiveId((request.params as { id?: string }).id);
    await deletePrompt(app.qe, id);
    return reply.code(204).send();
  });
}
