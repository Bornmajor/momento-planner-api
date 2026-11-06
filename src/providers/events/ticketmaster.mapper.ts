import { categoryBySegmentId } from '../../modules/events/categories.js';
import type { Event, EventStatus } from '../../modules/events/event.types.js';

/** The parts of a Ticketmaster Discovery event we read. Everything except id, name and url is optional. */
export interface TmEvent {
  id: string;
  name: string;
  url: string;
  images?: { url: string; ratio?: string; width?: number; fallback?: boolean }[];
  dates?: {
    start?: { localDate?: string; localTime?: string; dateTime?: string };
    timezone?: string;
    status?: { code?: string };
  };
  classifications?: { segment?: { id?: string }; genre?: { name?: string } }[];
  priceRanges?: { min?: number; max?: number; currency?: string }[];
  description?: string;
  info?: string;
  pleaseNote?: string;
  _embedded?: {
    venues?: {
      name?: string;
      city?: { name?: string };
      country?: { name?: string; countryCode?: string };
      address?: { line1?: string };
    }[];
  };
}

const STATUS: Record<string, EventStatus> = {
  onsale: 'onsale',
  offsale: 'offsale',
  canceled: 'cancelled',
  cancelled: 'cancelled',
  postponed: 'postponed',
  rescheduled: 'rescheduled',
};

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  eacute: 'é',
  euro: '€',
  pound: '£',
};

function decodeEntity(match: string, entity: string): string {
  if (entity.startsWith('#')) {
    const code =
      entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  }
  return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
}

/** Ticketmaster text can contain HTML. Calendars show plain text, so tags go and entities are decoded. */
export function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/\s*(p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, decodeEntity)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const clean = (value: string | undefined | null) => (value ? htmlToText(value) : '') || null;

function bestImage(images: TmEvent['images']): string | null {
  const wide = (images ?? []).filter((i) => i.ratio === '16_9' && !i.fallback);
  wide.sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  return wide[0]?.url ?? images?.[0]?.url ?? null;
}

export function mapTicketmasterEvent(tm: TmEvent): Event {
  const venue = tm._embedded?.venues?.[0];
  const classification = tm.classifications?.[0];
  const price = tm.priceRanges?.[0];
  const genre = clean(classification?.genre?.name);

  // The description comes from `description`, falling back to `info`; the remaining texts become notes.
  const description = clean(tm.description) ?? clean(tm.info);
  const notes = [tm.description ? clean(tm.info) : null, clean(tm.pleaseNote)].filter(Boolean).join('\n\n');

  return {
    id: tm.id,
    source: 'ticketmaster',
    title: tm.name,
    url: tm.url,
    imageUrl: bestImage(tm.images),
    start: {
      localDate: tm.dates?.start?.localDate ?? '',
      localTime: tm.dates?.start?.localTime ?? null,
      dateTime: tm.dates?.start?.dateTime ?? null,
      timezone: tm.dates?.timezone ?? null,
    },
    status: STATUS[tm.dates?.status?.code ?? ''] ?? 'unknown',
    category: categoryBySegmentId(classification?.segment?.id),
    genre: genre && genre !== 'Undefined' ? genre : null,
    venue: venue?.name
      ? {
          name: venue.name,
          city: clean(venue.city?.name),
          country: clean(venue.country?.name) ?? clean(venue.country?.countryCode),
          address: clean(venue.address?.line1),
        }
      : null,
    priceRange:
      price?.min !== undefined && price.max !== undefined && price.currency
        ? { min: price.min, max: price.max, currency: price.currency }
        : null,
    description,
    notes: notes || null,
  };
}
