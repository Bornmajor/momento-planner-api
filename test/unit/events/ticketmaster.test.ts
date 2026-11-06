import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { mapTicketmasterEvent } from '../../../src/providers/events/ticketmaster.mapper.js';
import { createTicketmasterProvider } from '../../../src/providers/events/ticketmaster.provider.js';

const fixture = (name: string) =>
  JSON.parse(readFileSync(`test/fixtures/ticketmaster/${name}.json`, 'utf8')) as {
    status: number;
    // Raw Ticketmaster JSON; tests reach into it freely.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    body: any;
  };

const search = fixture('search');
const details = fixture('event-details');

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('mapTicketmasterEvent', () => {
  it('maps real Ticketmaster events into our Event shape', () => {
    const events = search.body._embedded.events.map(mapTicketmasterEvent);
    expect(events).toHaveLength(20);
    const event = mapTicketmasterEvent(details.body);
    expect(event).toMatchObject({
      id: details.body.id,
      source: 'ticketmaster',
      title: details.body.name,
      url: details.body.url,
      imageUrl: expect.stringMatching(/^https:/),
      start: { localDate: details.body.dates.start.localDate, timezone: details.body.dates.timezone },
    });
    expect(['onsale', 'offsale', 'cancelled', 'postponed', 'rescheduled', 'unknown']).toContain(event.status);
  });

  it('converts HTML in descriptions to plain text (calendars show plain text)', () => {
    const event = mapTicketmasterEvent({
      id: 'x',
      name: 'Club night',
      url: 'https://example.com',
      description: '<p>Big &amp; <strong>loud</strong><br/>night&rsquo;s &#8211; 18+</p><p>No refunds</p>',
    });
    expect(event.description).toBe('Big & loud\nnight’s – 18+\nNo refunds');
  });

  it('turns missing optional fields into null and spells "cancelled" our way', () => {
    const event = mapTicketmasterEvent({
      id: 'x',
      name: 'Bare event',
      url: 'https://example.com',
      dates: { start: { localDate: '2026-12-01' }, status: { code: 'canceled' } },
    });
    expect(event).toMatchObject({
      status: 'cancelled',
      imageUrl: null,
      venue: null,
      priceRange: null,
      category: null,
      description: null,
    });
  });
});

describe('Ticketmaster provider', () => {
  const build = (fetchFn: typeof fetch) =>
    createTicketmasterProvider({ apiKey: 'test-key', countries: ['GB', 'US'], fetchFn, minIntervalMs: 0 });

  it('searches English-speaking countries with our filters, and caches the result', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, search.body));
    const provider = build(fetchFn);

    const result = await provider.search({ q: 'jazz', categoryId: 'music', page: 1, size: 20 });
    await provider.search({ q: 'jazz', categoryId: 'music', page: 1, size: 20 });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const url = new URL(fetchFn.mock.calls[0]![0] as string);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      keyword: 'jazz',
      segmentId: 'KZFzniwnSyZfZ7v7nJ',
      countryCode: 'GB,US',
      page: '1',
      size: '20',
      sort: 'date,asc',
      locale: '*',
    });
    expect(result.items).toHaveLength(20);
    expect(result.items[0]).not.toHaveProperty('description');
    expect(result.totalItems).toBe(search.body.page.totalElements);
  });

  it('returns null for an unknown event id (404)', async () => {
    const provider = build(vi.fn().mockResolvedValue(jsonResponse(404, fixture('event-unknown').body)));
    await expect(provider.getById('nope')).resolves.toBeNull();
  });

  it('loads several events in one batch call; missing ids are simply absent', async () => {
    const batch = fixture('search-multi-id-with-unknown');
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, batch.body));
    const ids = batch.body._embedded.events.map((e: { id: string }) => e.id).slice(0, 3);

    const found = await build(fetchFn).getByIds([...ids, 'missing-id']);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(new URL(fetchFn.mock.calls[0]![0] as string).searchParams.get('id')).toBe(
      [...ids, 'missing-id'].join(','),
    );
    expect([...found.keys()].sort()).toEqual([...ids].sort());
  });

  it('reports Ticketmaster failures as UPSTREAM_UNAVAILABLE without leaking the API key', async () => {
    const provider = build(vi.fn().mockResolvedValue(jsonResponse(500, { error: 'boom' })));
    const error = await provider.getById('x').catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
    expect(JSON.stringify(error) + String(error)).not.toContain('test-key');
  });
});
