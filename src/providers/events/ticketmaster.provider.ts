import { LRUCache } from 'lru-cache';
import { segmentIdFor, CATEGORIES } from '../../modules/events/categories.js';
import {
  toSummary,
  type Event,
  type EventProvider,
  type SearchResult,
} from '../../modules/events/event.types.js';
import { AppError } from '../../lib/errors.js';
import { mapTicketmasterEvent, type TmEvent } from './ticketmaster.mapper.js';

const BASE_URL = 'https://app.ticketmaster.com/discovery/v2';
const MINUTE = 60_000;
const BATCH_SIZE = 20;

export interface TicketmasterOptions {
  apiKey: string;
  /** ISO country codes to search in (spec §7: English-speaking countries). */
  countries: string[];
  fetchFn?: typeof fetch;
  /** Minimum gap between calls. 250 ms keeps us at 4 per second (the limit is 5). */
  minIntervalMs?: number;
  timeoutMs?: number;
}

interface TmSearchBody {
  _embedded?: { events?: TmEvent[] };
  page?: { size?: number; totalElements?: number; totalPages?: number; number?: number };
}

const NOT_FOUND = Symbol('not-found');
// The reason is logged (as the cause), never sent to clients.
const unavailable = (reason: string) =>
  new AppError('UPSTREAM_UNAVAILABLE', 'The event service is unavailable, please try again', undefined, {
    cause: new Error(reason),
  });

export function createTicketmasterProvider(options: TicketmasterOptions): EventProvider {
  const fetchFn = options.fetchFn ?? fetch;
  const minInterval = options.minIntervalMs ?? 250;
  const timeoutMs = options.timeoutMs ?? 8_000;

  const searchCache = new LRUCache<string, SearchResult>({ max: 500, ttl: 5 * MINUTE });
  const eventCache = new LRUCache<string, Event | typeof NOT_FOUND>({ max: 2_000, ttl: 60 * MINUTE });
  const NOT_FOUND_TTL = 10 * MINUTE;

  // Simple spacing limiter: each call reserves the next free slot.
  let nextSlot = 0;
  async function waitForSlot() {
    const now = Date.now();
    const wait = Math.max(0, nextSlot - now);
    nextSlot = Math.max(now, nextSlot) + minInterval;
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  }

  /** GET a Discovery API path. Returns null on 404; any other failure becomes UPSTREAM_UNAVAILABLE. */
  async function get<T>(path: string, params: Record<string, string>): Promise<T | null> {
    const url = new URL(`${BASE_URL}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    url.searchParams.set('apikey', options.apiKey);

    await waitForSlot();
    let response: Response;
    try {
      response = await fetchFn(url.toString(), { signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      throw unavailable(err instanceof Error ? err.name : 'network error');
    }
    if (response.status === 404) return null;
    if (!response.ok) throw unavailable(`Ticketmaster responded ${response.status}`);
    return (await response.json()) as T;
  }

  function remember(event: Event) {
    eventCache.set(event.id, event);
  }

  return {
    async search({ q, categoryId, page, size }) {
      const params: Record<string, string> = {
        size: String(size),
        page: String(page),
        sort: 'date,asc',
        locale: '*',
        countryCode: options.countries.join(','),
        ...(q && { keyword: q }),
        ...(categoryId && { segmentId: segmentIdFor(categoryId) }),
      };
      const cacheKey = JSON.stringify(params);
      const cached = searchCache.get(cacheKey);
      if (cached) return cached;

      // Upcoming events only. Rounded to the minute so the cache key above stays stable.
      const startDateTime = new Date(Math.floor(Date.now() / MINUTE) * MINUTE)
        .toISOString()
        .replace('.000Z', 'Z');
      const body = await get<TmSearchBody>('/events.json', { ...params, startDateTime });
      const events = (body?._embedded?.events ?? []).map(mapTicketmasterEvent);
      events.forEach(remember);

      const result: SearchResult = {
        items: events.map(toSummary),
        page,
        size,
        totalPages: body?.page?.totalPages ?? 0,
        totalItems: body?.page?.totalElements ?? 0,
      };
      searchCache.set(cacheKey, result);
      return result;
    },

    async getById(id) {
      const cached = eventCache.get(id);
      if (cached) return cached === NOT_FOUND ? null : cached;

      const body = await get<TmEvent>(`/events/${encodeURIComponent(id)}.json`, { locale: '*' });
      if (!body) {
        eventCache.set(id, NOT_FOUND, { ttl: NOT_FOUND_TTL });
        return null;
      }
      const event = mapTicketmasterEvent(body);
      remember(event);
      return event;
    },

    async getByIds(ids) {
      const found = new Map<string, Event>();
      const toFetch: string[] = [];
      for (const id of new Set(ids)) {
        const cached = eventCache.get(id);
        if (cached === undefined) toFetch.push(id);
        else if (cached !== NOT_FOUND) found.set(id, cached);
      }

      for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
        const batch = toFetch.slice(i, i + BATCH_SIZE);
        const body = await get<TmSearchBody>('/events.json', {
          id: batch.join(','),
          size: String(BATCH_SIZE),
          locale: '*',
        });
        const requested = new Set(batch);
        for (const event of (body?._embedded?.events ?? []).map(mapTicketmasterEvent)) {
          remember(event);
          // Only return what was asked for, even if the API sends extra events back.
          if (requested.has(event.id)) found.set(event.id, event);
        }
        for (const id of batch) {
          if (!found.has(id)) eventCache.set(id, NOT_FOUND, { ttl: NOT_FOUND_TTL });
        }
      }
      return found;
    },

    listCategories() {
      return CATEGORIES.map(({ id, name }) => ({ id, name }));
    },
  };
}
