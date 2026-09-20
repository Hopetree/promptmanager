import type { FastifyInstance } from 'fastify';
import { renderMarkdown } from '../../services/markdown.js';

const markdownBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['markdown'],
  properties: { markdown: { type: 'string', maxLength: 200_000 } },
} as const;

/** FR-9：Markdown → 净化 HTML（XSS 净化 + 代码高亮）。 */
export function registerRenderRoutes(app: FastifyInstance): void {
  app.post('/api/render/markdown', { schema: { body: markdownBodySchema } }, async (request) => {
    const { markdown } = request.body as { markdown: string };
    return { html: renderMarkdown(markdown) };
  });
}
