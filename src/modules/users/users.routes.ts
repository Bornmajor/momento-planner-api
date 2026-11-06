import { Router, type RequestHandler } from 'express';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { LANGUAGES } from '../../models/user.model.js';
import { nameSchema } from '../auth/auth.schemas.js';
import { deleteAccount } from './users.service.js';

/** Accepts international numbers ("+254 712 345 678") and stores them as E.164 ("+254712345678"). */
const phoneSchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const parsed = parsePhoneNumberFromString(value);
    if (!parsed?.isValid()) {
      ctx.addIssue({
        code: 'custom',
        message: 'must be a valid phone number in international format, e.g. +254712345678',
      });
      return z.NEVER;
    }
    return parsed.number;
  });

const updateMeSchema = z.object({
  firstName: nameSchema.optional(),
  lastName: nameSchema.optional(),
  phone: z.union([z.null(), phoneSchema]).optional(),
  language: z.enum(LANGUAGES).optional(),
});
type UpdateMeInput = z.infer<typeof updateMeSchema>;

export function createUsersRouter(deps: { requireAuth: RequestHandler }): Router {
  const router = Router();

  router.get('/me', deps.requireAuth, (req, res) => {
    res.json({ user: req.user });
  });

  router.patch('/me', deps.requireAuth, validate({ body: updateMeSchema }), async (req, res) => {
    const user = req.user!;
    const changes = req.body as UpdateMeInput;
    if (changes.firstName !== undefined) user.firstName = changes.firstName;
    if (changes.lastName !== undefined) user.lastName = changes.lastName;
    if (changes.language !== undefined) user.language = changes.language;
    if (changes.phone !== undefined) user.set('phone', changes.phone ?? undefined);
    await user.save();
    res.json({ user });
  });

  // Irreversible. The app should ask the user to confirm before calling it.
  router.delete('/me', deps.requireAuth, async (req, res) => {
    await deleteAccount(req.user!.id);
    res.status(204).end();
  });

  return router;
}
