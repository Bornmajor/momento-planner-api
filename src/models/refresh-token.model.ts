import { model, Schema } from 'mongoose';

const refreshTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    /** SHA-256 of the raw token. The raw token is never stored. */
    tokenHash: { type: String, required: true, unique: true },
    /** Shared by every token in one rotation chain, so reuse can revoke the whole chain. */
    family: { type: String, required: true, index: true },
    /** MongoDB deletes the document once this time passes (TTL index). */
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    revokedAt: { type: Date, default: null },
    replacedBy: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true },
);

export const RefreshToken = model('RefreshToken', refreshTokenSchema);
