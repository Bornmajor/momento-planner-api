import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { eventIdParams } from '../events/events.routes.js';
import type { SavedEventsService } from './saved-events.service.js';

const listQuery = z.object({
  page: z.coerce.number().int().min(0).default(0),
  size: z.coerce.number().int().min(1).max(50).default(20),
});
const saveBody = z.object({ eventId: eventIdParams.shape.id });
const removeParams = z.object({ eventId: eventIdParams.shape.id });

export function createSavedEventsRouter(deps: {
  savedEvents: SavedEventsService;
  requireAuth: RequestHandler;
}): Router {
  const { savedEvents } = deps;
  const router = Router();
  router.use(deps.requireAuth);

  router.get('/', validate({ query: listQuery }), async (req, res) => {
    const { page, size } = req.valid.query as z.infer<typeof listQuery>;
    res.json(await savedEvents.list(req.user!.id, page, size));
  });

  router.post('/', validate({ body: saveBody }), async (req, res) => {
    const { eventId } = req.body as z.infer<typeof saveBody>;
    const { savedEvent, created } = await savedEvents.save(req.user!.id, eventId);
    res.status(created ? 201 : 200).json({ savedEvent });
  });

  router.delete('/:eventId', validate({ params: removeParams }), async (req, res) => {
    const { eventId } = req.valid.params as z.infer<typeof removeParams>;
    await savedEvents.remove(req.user!.id, eventId);
    res.status(204).end();
  });

  return router;
}
