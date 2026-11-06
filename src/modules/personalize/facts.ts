import type { Language } from '../../models/user.model.js';
import type { Event } from '../events/event.types.js';

const LOCALES: Record<Language, string> = { en: 'en-GB', fr: 'fr-FR', sw: 'sw-KE' };

export interface EventFacts {
  dateTimeText: string;
  venueText: string | null;
  url: string;
}

function formatDate(date: Date, locale: string, timeZone: string, withTime: boolean): string {
  const options: Intl.DateTimeFormatOptions = { dateStyle: 'full', ...(withTime && { timeStyle: 'short' }) };
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(date);
  } catch {
    // Unknown time zone name: fall back to UTC rather than failing.
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(date);
  }
}

/**
 * The exact facts for a calendar entry, built by code from the event data, never by the AI
 * (spec §7): date and time in the event's own time zone, the venue, and the ticket link.
 */
export function buildFacts(event: Event, language: Language): EventFacts {
  const locale = LOCALES[language];
  const { localDate, localTime, dateTime, timezone } = event.start;

  let dateTimeText = '';
  if (dateTime) {
    dateTimeText = formatDate(new Date(dateTime), locale, timezone ?? 'UTC', true);
  } else if (localDate) {
    dateTimeText = formatDate(new Date(`${localDate}T00:00:00Z`), locale, 'UTC', false);
    if (localTime) dateTimeText += ` ${localTime.slice(0, 5)}`;
  }

  const venueText = event.venue
    ? [event.venue.name, event.venue.city, event.venue.country].filter(Boolean).join(', ')
    : null;

  return { dateTimeText, venueText, url: event.url };
}
