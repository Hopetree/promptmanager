import type { FastifyInstance } from 'fastify';
import { createTag, deleteTag, listTags, renameTag } from '../../services/tags.js';
import { parsePositiveId } from '../params.js';

const nameBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: { name: { type: 'string', minLength: 1, maxLength: 64 } },
} as const;

/** FR-5 标签：列表（含计数）+ 增 / 改名（同名合并）/ 删。 */
export function registerTagRoutes(app: FastifyInstance): void {
  app.get('/api/tags', async () => ({ items: await listTags(app.qe) }));

  app.post('/api/tags', { schema: { body: nameBodySchema } }, async (request, reply) => {
    const { name } = request.body as { name: string };
    const tag = await createTag(app.qe, name);
    return reply.code(201).send(tag);
  });

  app.put('/api/tags/:id', { schema: { body: nameBodySchema } }, async (request) => {
    const id = parsePositiveId((request.params as { id?: string }).id);
    const { name } = request.body as { name: string };
    return renameTag(app.qe, id, name);
  });

  app.delete('/api/tags/:id', async (request, reply) => {
    const id = parsePositiveId((request.params as { id?: string }).id);
    await deleteTag(app.qe, id);
    return reply.code(204).send();
  });
}
