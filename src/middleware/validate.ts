import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { AppError } from '../lib/errors.js';

const LOCATIONS = ['params', 'query', 'body'] as const;
type Location = (typeof LOCATIONS)[number];

export type ValidationSchemas = Partial<Record<Location, ZodType>>;

export interface ValidationIssue {
  location: Location;
  path: string;
  message: string;
}

/**
 * Validates params, query and body with zod. Parsed values (defaults applied, numbers converted,
 * unknown fields removed) are put on `req.valid`; the parsed body also replaces `req.body`.
 * Problems from every location are reported together as 400 VALIDATION_ERROR.
 */
export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req, _res, next) => {
    const valid: Partial<Record<Location, unknown>> = {};
    const issues: ValidationIssue[] = [];

    for (const location of LOCATIONS) {
      const schema = schemas[location];
      if (!schema) continue;
      const result = schema.safeParse(req[location]);
      if (result.success) {
        valid[location] = result.data;
      } else {
        for (const issue of result.error.issues) {
          issues.push({ location, path: issue.path.join('.'), message: issue.message });
        }
      }
    }

    if (issues.length > 0) {
      next(new AppError('VALIDATION_ERROR', 'Request validation failed', issues));
      return;
    }

    req.valid = valid;
    if ('body' in valid) req.body = valid.body;
    next();
  };
}
