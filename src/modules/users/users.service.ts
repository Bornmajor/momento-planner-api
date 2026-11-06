import { AiUsage } from '../../models/ai.models.js';
import { RefreshToken } from '../../models/refresh-token.model.js';
import { SavedEvent } from '../../models/saved-event.model.js';
import { User } from '../../models/user.model.js';

/**
 * Permanently deletes a user and everything tied to them: sessions (refresh tokens), saved events
 * and AI usage counters. Shared AI cache entries hold no personal data and are kept.
 * Sessions go first, so no refresh can succeed while the deletion is in progress.
 */
export async function deleteAccount(userId: string): Promise<void> {
  await RefreshToken.deleteMany({ userId });
  await Promise.all([SavedEvent.deleteMany({ userId }), AiUsage.deleteMany({ userId })]);
  await User.deleteOne({ _id: userId });
}
