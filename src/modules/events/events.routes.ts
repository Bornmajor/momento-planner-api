import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { validate } from '../../middleware/validate.js';
import { CATEGORY_IDS } from './categories.js';
import { SEARCH_WHEN, type EventProvider, type SearchParams } from './event.types.js';

/** Ticketmaster can't page past its 1000th result (spec §7). */
const MAX_RESULT_INDEX = 1000;

export const eventIdParams = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) });

const searchQuery = z
  .object({
    q: z.string().trim().min(1).max(100).optional(),
    category: z.enum(CATEGORY_IDS).optional(),
    when: z.enum(SEARCH_WHEN).default('upcoming'),
    page: z.coerce.number().int().min(0).default(0),
    size: z.coerce.number().int().min(1).max(50).default(20),
  })
  .refine((v) => (v.page + 1) * v.size <= MAX_RESULT_INDEX, {
    message: `cannot page past result ${MAX_RESULT_INDEX}`,
    path: ['page'],
  });

export function createEventsRouter(deps: { events: EventProvider; requireAuth: RequestHandler }): Router {
  const { events } = deps;
  const router = Router();
  router.use(deps.requireAuth);

  router.get('/', validate({ query: searchQuery }), async (req, res) => {
    const { q, category, when, page, size } = req.valid.query as z.infer<typeof searchQuery>;
    const params: SearchParams = { page, size, when, ...(q && { q }), ...(category && { categoryId: category }) };
    res.json(await events.search(params));
  });

  router.get('/categories', (_req, res) => {
    res.json({ items: events.listCategories() });
  });

  router.get('/:id', validate({ params: eventIdParams }), async (req, res) => {
    const { id } = req.valid.params as z.infer<typeof eventIdParams>;
    const event = await events.getById(id);
    if (!event) throw new AppError('NOT_FOUND', 'Event not found');
    res.json({ event });
  });

  return router;
}
