import { CATEGORIES } from '../../src/modules/events/categories.js';
import type { Event, EventProvider, EventSummary } from '../../src/modules/events/event.types.js';

export function sampleEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 'evt-1',
    source: 'ticketmaster',
    title: 'Jazz Night',
    url: 'https://www.ticketmaster.co.uk/event/evt-1',
    imageUrl: null,
    start: {
      localDate: '2026-12-01',
      localTime: '19:30:00',
      dateTime: '2026-12-01T19:30:00Z',
      timezone: 'Europe/London',
    },
    status: 'onsale',
    category: { id: 'music', name: 'Music' },
    genre: 'Jazz',
    venue: { name: "Ronnie Scott's", city: 'London', country: 'Great Britain', address: '47 Frith St' },
    priceRange: null,
    description: 'An evening of live jazz with three bands, late bar and a jam session to close the night.',
    notes: null,
    ...overrides,
  };
}

const toSummary = ({ description: _d, notes: _n, ...summary }: Event): EventSummary => summary;

/** In-memory EventProvider over a fixed list of events. */
export function fakeEventProvider(events: Event[] = [sampleEvent()]): EventProvider {
  const byId = new Map(events.map((e) => [e.id, e]));
  return {
    async search({ q, categoryId, page, size }) {
      const matches = events.filter(
        (e) =>
          (!q || e.title.toLowerCase().includes(q.toLowerCase())) &&
          (!categoryId || e.category?.id === categoryId),
      );
      return {
        items: matches.slice(page * size, (page + 1) * size).map(toSummary),
        page,
        size,
        totalItems: matches.length,
        totalPages: Math.ceil(matches.length / size),
      };
    },
    async getById(id) {
      return byId.get(id) ?? null;
    },
    async getByIds(ids) {
      return new Map(ids.flatMap((id) => (byId.has(id) ? [[id, byId.get(id)!] as const] : [])));
    },
    listCategories() {
      return CATEGORIES.map(({ id, name }) => ({ id, name }));
    },
  };
}
