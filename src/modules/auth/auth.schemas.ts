import { z } from 'zod';
import { passwordSchema } from './password.js';

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());
export const nameSchema = z.string().trim().min(1).max(50);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  firstName: nameSchema,
  lastName: nameSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const googleSchema = z.object({ idToken: z.string().min(1).max(4096) });

export const refreshTokenSchema = z.object({ refreshToken: z.string().min(1).max(200) });
