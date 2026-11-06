import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { AppError } from '../../lib/errors.js';
import { AiPersonalization, AiUsage } from '../../models/ai.models.js';
import type { Language } from '../../models/user.model.js';
import type { AiProvider } from '../../providers/ai/ai-provider.js';
import { PROMPT_VERSION } from '../../providers/ai/prompt.js';
import type { EventProvider } from '../events/event.types.js';
import { buildFacts } from './facts.js';

export interface PersonalizeOptions {
  shorten: boolean;
  translateTo?: Language;
}

export type PersonalizeService = ReturnType<typeof createPersonalizeService>;

const limitReached = () =>
  new AppError('AI_LIMIT_REACHED', 'Daily personalization limit reached, please try again tomorrow');

export function createPersonalizeService(deps: {
  events: EventProvider;
  ai: AiProvider;
  dailyLimit: number;
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());
  const today = () => now().toISOString().slice(0, 10);

  /** Counts one uncached AI call against today's limit, atomically. */
  async function reserveQuota(userId: string) {
    if (deps.dailyLimit <= 0) throw limitReached();
    try {
      // Matches only while under the limit. At the limit the upsert tries to insert a second
      // {userId, day} document, which the unique index rejects.
      await AiUsage.findOneAndUpdate(
        { userId, day: today(), count: mongoose.trusted({ $lt: deps.dailyLimit }) },
        { $inc: { count: 1 }, $setOnInsert: { createdAt: now() } },
        { upsert: true },
      );
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw limitReached();
      throw err;
    }
  }

  async function refundQuota(userId: string) {
    await AiUsage.updateOne({ userId, day: today() }, { $inc: { count: -1 } });
  }

  async function personalize(userId: string, eventId: string, options: PersonalizeOptions) {
    const event = await deps.events.getById(eventId);
    if (!event) throw new AppError('NOT_FOUND', 'Event not found');

    const facts = buildFacts(event, options.translateTo ?? 'en');

    // Version 1 events are English (spec §7), so "translate to English" alone needs no AI.
    if (!options.shorten && (options.translateTo ?? 'en') === 'en') {
      return { title: event.title, description: event.description ?? '', facts, cached: false };
    }

    const key = createHash('sha256')
      .update(
        [
          event.source,
          event.id,
          options.translateTo ?? 'original',
          options.shorten ? 'short' : 'full',
          PROMPT_VERSION,
          deps.ai.model,
        ].join(':'),
      )
      .digest('hex');

    const hit = await AiPersonalization.findOne({ key }).lean();
    if (hit?.result) {
      return { title: hit.result.title, description: hit.result.description, facts, cached: true };
    }

    await reserveQuota(userId);
    let result;
    try {
      result = await deps.ai.personalize({
        event,
        shorten: options.shorten,
        ...(options.translateTo && { translateTo: options.translateTo }),
      });
    } catch (err) {
      await refundQuota(userId);
      throw err;
    }

    await AiPersonalization.updateOne(
      { key },
      { $setOnInsert: { key, result, createdAt: now() } },
      { upsert: true },
    );
    return { ...result, facts, cached: false };
  }

  return { personalize };
}
