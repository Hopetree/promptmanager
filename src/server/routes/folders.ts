import type { FastifyInstance } from 'fastify';
import {
  createFolder,
  deleteFolder,
  listFolders,
  reorderFolders,
  updateFolder,
  type CreateFolderInput,
  type UpdateFolderInput,
} from '../../services/folders.js';
import { parsePositiveId } from '../params.js';

const folderFields = {
  name: { type: 'string', minLength: 1, maxLength: 200 },
  parent_id: { type: ['integer', 'null'], minimum: 1 },
  sort_order: { type: 'integer', minimum: 0, maximum: 1_000_000 },
} as const;

const createFolderSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: folderFields,
} as const;

const updateFolderSchema = {
  type: 'object',
  additionalProperties: false,
  properties: folderFields,
} as const;

/** FR-70 / D-28：同一父级下的文件夹重排（`parent_id` 必须与 ids 的实际父级一致，不做跨父级移动）。 */
const folderOrderSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['parent_id', 'ids'],
  properties: {
    parent_id: { type: ['integer', 'null'], minimum: 1 },
    ids: { type: 'array', minItems: 1, maxItems: 5000, items: { type: 'integer', minimum: 1 } },
  },
} as const;

/** FR-4 文件夹：扁平列表（含 parent_id）+ 增改删；删除非空/有子项 → 409 folder_not_empty。 */
export function registerFolderRoutes(app: FastifyInstance): void {
  app.get('/api/folders', async () => ({ items: await listFolders(app.qe) }));

  /** FR-70：同层级文件夹重排（校验不存在 / 重复 / 跨父级 → 400；幂等）。 */
  app.patch('/api/folders/order', { schema: { body: folderOrderSchema } }, async (request, reply) => {
    const { parent_id: parentId, ids } = request.body as { parent_id: number | null; ids: number[] };
    await reorderFolders(app.qe, parentId, ids);
    return reply.code(204).send();
  });

  app.post('/api/folders', { schema: { body: createFolderSchema } }, async (request, reply) => {
    const folder = await createFolder(app.qe, request.body as CreateFolderInput);
    return reply.code(201).send(folder);
  });

  app.put('/api/folders/:id', { schema: { body: updateFolderSchema } }, async (request) => {
    const id = parsePositiveId((request.params as { id?: string }).id);
    return updateFolder(app.qe, id, request.body as UpdateFolderInput);
  });

  app.delete('/api/folders/:id', async (request, reply) => {
    const id = parsePositiveId((request.params as { id?: string }).id);
    await deleteFolder(app.qe, id);
    return reply.code(204).send();
  });
}
