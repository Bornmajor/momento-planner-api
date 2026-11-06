import type { Language } from '../../models/user.model.js';
import type { Event } from '../../modules/events/event.types.js';

export interface PersonalizeInput {
  event: Event;
  shorten: boolean;
  /** Target language. Without it, the original language is kept. */
  translateTo?: Language;
}

export interface PersonalizedText {
  title: string;
  description: string;
}

export interface AiProvider {
  /** Part of the cache key, so switching models doesn't serve another model's output. */
  readonly model: string;
  personalize(input: PersonalizeInput): Promise<PersonalizedText>;
}
