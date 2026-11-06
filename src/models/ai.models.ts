import { model, Schema } from 'mongoose';

const DAY_SECONDS = 86_400;

/** Cached AI results, shared by all users, deleted after 30 days (spec §5). */
const aiPersonalizationSchema = new Schema({
  key: { type: String, required: true, unique: true },
  result: {
    title: { type: String, required: true },
    description: { type: String, required: true },
  },
  createdAt: { type: Date, required: true, expires: 30 * DAY_SECONDS },
});

export const AiPersonalization = model('AiPersonalization', aiPersonalizationSchema);

/** Uncached AI calls per user per UTC day, deleted after 7 days (spec §5). */
const aiUsageSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  day: { type: String, required: true },
  count: { type: Number, required: true, default: 0 },
  createdAt: { type: Date, required: true, expires: 7 * DAY_SECONDS },
});
aiUsageSchema.index({ userId: 1, day: 1 }, { unique: true });

export const AiUsage = model('AiUsage', aiUsageSchema);
