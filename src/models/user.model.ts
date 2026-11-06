import { model, Schema, type HydratedDocument, type InferSchemaType } from 'mongoose';

export const LANGUAGES = ['en', 'fr', 'sw'] as const;
export type Language = (typeof LANGUAGES)[number];

export type AuthProvider = 'password' | 'google';

/** The only user shape the API ever returns (spec §7). */
export interface PublicUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  language: Language;
  authProviders: AuthProvider[];
  createdAt: Date;
}

const userSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, unique: true, maxlength: 254 },
    passwordHash: { type: String },
    googleId: { type: String, unique: true, sparse: true },
    firstName: { type: String, required: true, trim: true, maxlength: 50 },
    // Google profiles can lack a family name, so the model allows ''. The API requires one on register.
    lastName: { type: String, trim: true, maxlength: 50, default: '' },
    phone: { type: String },
    language: { type: String, enum: LANGUAGES, default: 'en' },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret) => toPublicUser(ret as unknown as RawUser),
    },
  },
);

type RawUser = InferSchemaType<typeof userSchema> & { _id: { toString(): string }; createdAt: Date };

function toPublicUser(raw: RawUser): PublicUser {
  const authProviders: AuthProvider[] = [];
  if (raw.passwordHash) authProviders.push('password');
  if (raw.googleId) authProviders.push('google');
  return {
    id: raw._id.toString(),
    email: raw.email,
    firstName: raw.firstName,
    lastName: raw.lastName ?? '',
    phone: raw.phone ?? null,
    language: raw.language as Language,
    authProviders,
    createdAt: raw.createdAt,
  };
}

export const User = model('User', userSchema);
export type UserDocument = HydratedDocument<InferSchemaType<typeof userSchema>>;
