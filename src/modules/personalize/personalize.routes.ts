import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { LANGUAGES } from '../../models/user.model.js';
import { eventIdParams } from '../events/events.routes.js';
import type { PersonalizeService } from './personalize.service.js';

/** The AI runs only on an explicit choice: shorten and/or translate (spec §7, decision 6). */
const personalizeBody = z
  .object({
    shorten: z.boolean().default(false),
    translateTo: z.enum(LANGUAGES).optional(),
  })
  .refine((b) => b.shorten || b.translateTo !== undefined, {
    message: 'choose shorten and/or translateTo',
  });

export function createPersonalizeRouter(deps: {
  personalize: PersonalizeService;
  requireAuth: RequestHandler;
}): Router {
  const router = Router();

  router.post(
    '/:id/personalize',
    deps.requireAuth,
    validate({ params: eventIdParams, body: personalizeBody }),
    async (req, res) => {
      const { id } = req.valid.params as z.infer<typeof eventIdParams>;
      const body = req.body as z.infer<typeof personalizeBody>;
      res.json(
        await deps.personalize.personalize(req.user!.id, id, {
          shorten: body.shorten,
          ...(body.translateTo && { translateTo: body.translateTo }),
        }),
      );
    },
  );

  return router;
}
