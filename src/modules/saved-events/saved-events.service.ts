import { AppError } from '../../lib/errors.js';
import { SavedEvent, type SavedEventFields } from '../../models/saved-event.model.js';
import type { Event, EventProvider } from '../events/event.types.js';

export const SAVED_EVENTS_LIMIT = 100;
const SOURCE = 'ticketmaster';

export interface SavedEventView {
  eventId: string;
  savedAt: Date;
  available: boolean;
  event: Event | null;
}

export type SavedEventsService = ReturnType<typeof createSavedEventsService>;

export function createSavedEventsService(deps: { events: EventProvider; limit?: number }) {
  const limit = deps.limit ?? SAVED_EVENTS_LIMIT;

  /** Saves an event for the user. Saving twice is a no-op (`created: false`). */
  async function save(userId: string, eventId: string) {
    const existing = await SavedEvent.findOne({ userId, source: SOURCE, eventId });
    if (existing) return { savedEvent: existing, created: false };

    if (!(await deps.events.getById(eventId))) throw new AppError('NOT_FOUND', 'Event not found');
    if ((await SavedEvent.countDocuments({ userId })) >= limit) {
      throw new AppError('SAVED_LIMIT_REACHED', `You can save at most ${limit} events`);
    }

    try {
      return { savedEvent: await SavedEvent.create({ userId, source: SOURCE, eventId }), created: true };
    } catch (err) {
      // Two concurrent saves of the same event: the unique index lets only one through.
      if ((err as { code?: number }).code === 11000) {
        return {
          savedEvent: (await SavedEvent.findOne({ userId, source: SOURCE, eventId }))!,
          created: false,
        };
      }
      throw err;
    }
  }

  /** A page of saved events, newest first, with current details loaded in one batch call. */
  async function list(userId: string, page: number, size: number) {
    const [totalItems, docs] = await Promise.all([
      SavedEvent.countDocuments({ userId }),
      SavedEvent.find({ userId })
        .sort({ createdAt: -1, _id: -1 })
        .skip(page * size)
        .limit(size)
        .lean<SavedEventFields[]>(),
    ]);
    const found = await deps.events.getByIds(docs.map((d) => d.eventId));
    const items: SavedEventView[] = docs.map((doc) => {
      const event = found.get(doc.eventId) ?? null;
      return { eventId: doc.eventId, savedAt: doc.createdAt, available: event !== null, event };
    });
    return { items, page, size, totalItems };
  }

  async function remove(userId: string, eventId: string) {
    await SavedEvent.deleteOne({ userId, source: SOURCE, eventId });
  }

  return { save, list, remove };
}
