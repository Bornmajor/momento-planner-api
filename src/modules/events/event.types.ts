import type { Category, CategoryId } from './categories.js';

export type EventStatus = 'onsale' | 'offsale' | 'cancelled' | 'postponed' | 'rescheduled' | 'unknown';

/** Our own event shape (spec §7). Every provider maps its data into this. */
export interface Event {
  id: string;
  source: 'ticketmaster';
  title: string;
  /** Ticket purchase link. */
  url: string;
  imageUrl: string | null;
  start: { localDate: string; localTime: string | null; dateTime: string | null; timezone: string | null };
  status: EventStatus;
  category: Category | null;
  genre: string | null;
  venue: { name: string; city: string | null; country: string | null; address: string | null } | null;
  priceRange: { min: number; max: number; currency: string } | null;
  description: string | null;
  notes: string | null;
}

/** What search returns: an Event without the long text fields. */
export type EventSummary = Omit<Event, 'description' | 'notes'>;

/**
 * upcoming: not started yet. now: started within the last HAPPENING_NOW_HOURS (Ticketmaster rarely gives end times,
 * so that's treated as "still going"). all: both, i.e. nothing that has already finished.
 */
export type SearchWhen = 'upcoming' | 'now' | 'all';
export const SEARCH_WHEN = ['upcoming', 'now', 'all'] as const satisfies readonly SearchWhen[];
export const HAPPENING_NOW_HOURS = 3;

export interface SearchParams {
  q?: string;
  categoryId?: CategoryId;
  /** Defaults to 'upcoming'. */
  when?: SearchWhen;
  page: number;
  size: number;
}

export interface SearchResult {
  items: EventSummary[];
  page: number;
  size: number;
  totalPages: number;
  totalItems: number;
}

export interface EventProvider {
  search(params: SearchParams): Promise<SearchResult>;
  /** null when the source doesn't have the event. */
  getById(id: string): Promise<Event | null>;
  /** Events the source has, keyed by id. Ids it doesn't have are absent. */
  getByIds(ids: string[]): Promise<Map<string, Event>>;
  listCategories(): Category[];
}

export function toSummary(event: Event): EventSummary {
  const { description: _description, notes: _notes, ...summary } = event;
  return summary;
}
