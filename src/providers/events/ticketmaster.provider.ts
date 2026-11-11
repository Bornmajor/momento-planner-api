import { LRUCache } from 'lru-cache';
import { segmentIdFor, CATEGORIES } from '../../modules/events/categories.js';
import {
  HAPPENING_NOW_HOURS,
  toSummary,
  type Event,
  type EventSummary,
  type SearchWhen,
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

const isoSeconds = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * Safety net on top of Ticketmaster's own date filter (and for cached pages). Events without a UTC start (time not
 * announced) are kept for "upcoming" (Ticketmaster already filtered them by date) and left out of "now".
 */
export function matchesWhen(item: Pick<EventSummary, 'start'>, when: SearchWhen, nowMs: number): boolean {
  const start = item.start.dateTime ? Date.parse(item.start.dateTime) : null;
  const recent = nowMs - HAPPENING_NOW_HOURS * 60 * MINUTE;
  if (when === 'upcoming') return start === null || start >= nowMs;
  if (when === 'all') return start === null || start > recent;
  return start !== null && start <= nowMs && start > recent;
}
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
    async search({ q, categoryId, when = 'upcoming', page, size }) {
      const params: Record<string, string> = {
        size: String(size),
        page: String(page),
        sort: 'date,asc',
        locale: '*',
        countryCode: options.countries.join(','),
        ...(q && { keyword: q }),
        ...(categoryId && { segmentId: segmentIdFor(categoryId) }),
      };
      const cacheKey = JSON.stringify({ ...params, when });
      const cached = searchCache.get(cacheKey);
      // A cached page can be up to 5 minutes old: drop anything that has started since (upcoming) or that is no
      // longer "happening now".
      if (cached)
        return { ...cached, items: cached.items.filter((item) => matchesWhen(item, when, Date.now())) };

      // Ticketmaster filters on the start time: startDateTime = "starts after", endDateTime = "starts before".
      // Rounded to the minute (Ticketmaster wants whole seconds; minutes keep requests comparable).
      const now = Math.floor(Date.now() / MINUTE) * MINUTE;
      const recent = isoSeconds(now - HAPPENING_NOW_HOURS * 60 * MINUTE);
      const window: Record<string, string> =
        when === 'now'
          ? { startDateTime: recent, endDateTime: isoSeconds(now) }
          : when === 'all'
            ? { startDateTime: recent }
            : { startDateTime: isoSeconds(now) };
      const body = await get<TmSearchBody>('/events.json', { ...params, ...window });
      const events = (body?._embedded?.events ?? []).map(mapTicketmasterEvent);
      events.forEach(remember);

      const result: SearchResult = {
        items: events.map(toSummary).filter((item) => matchesWhen(item, when, Date.now())),
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
