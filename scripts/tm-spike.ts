/**
 * T0.2 — Ticketmaster Discovery API spike.
 *
 * Calls the real API (~6 requests) to answer the open questions in spec §8 and saves the raw
 * responses as test fixtures. The API key is redacted from everything written to disk.
 *
 * Run: npx tsx --env-file=.env scripts/tm-spike.ts
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = 'https://app.ticketmaster.com/discovery/v2';
const OUT_DIR = path.resolve('test/fixtures/ticketmaster');
const apiKey = process.env.TICKETMASTER_API_KEY;

if (!apiKey) {
  console.error('TICKETMASTER_API_KEY is not set in .env');
  process.exit(1);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const redact = (text: string) => text.split(apiKey).join('REDACTED');

interface SpikeResponse {
  status: number;
  body: unknown;
}

async function call(pathname: string, params: Record<string, string> = {}): Promise<SpikeResponse> {
  const url = new URL(`${BASE}${pathname}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('apikey', apiKey!);
  await sleep(300); // stay well under 5 req/s
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(redact(text));
  } catch {
    body = redact(text);
  }
  console.log(`${res.status} ${pathname} ${JSON.stringify(params)}`);
  return { status: res.status, body };
}

async function save(name: string, data: SpikeResponse) {
  await writeFile(path.join(OUT_DIR, name), redact(JSON.stringify(data, null, 2)) + '\n');
}

type TmEvent = Record<string, unknown> & { id: string; name: string };
const eventsOf = (r: SpikeResponse): TmEvent[] =>
  ((r.body as { _embedded?: { events?: TmEvent[] } })?._embedded?.events ?? []) as TmEvent[];

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  // 1. Search: upcoming events, all locales, sorted by date.
  const search = await call('/events.json', {
    size: '20',
    sort: 'date,asc',
    startDateTime: now,
    locale: '*',
  });
  await save('search.json', search);
  const events = eventsOf(search);
  const first = events[0];
  const second = events[1];
  if (!first || !second) throw new Error('Search returned fewer than 2 events');

  // 2. Event details.
  const details = await call(`/events/${first.id}.json`, { locale: '*' });
  await save('event-details.json', details);

  // 3. Unknown / removed ID.
  const unknown = await call('/events/ZZZ-momento-does-not-exist.json', { locale: '*' });
  await save('event-unknown.json', unknown);

  // 4. Several IDs in one request.
  const multi = await call('/events.json', { id: `${first.id},${second.id}`, locale: '*' });
  await save('search-multi-id.json', multi);

  // 5. Classifications (looking for top-level segments).
  const classifications = await call('/classifications.json', { size: '100', locale: '*' });
  await save('classifications.json', classifications);

  // 6. Keyword + segment filter (sanity check of the filter params).
  const filtered = await call('/events.json', {
    keyword: 'music',
    segmentName: 'Music',
    size: '5',
    locale: '*',
  });
  await save('search-keyword-segment.json', filtered);

  // 7. Batch of all search IDs plus one unknown ID: does the batch return everything, and how are
  //    missing IDs reported? (Determines how My Events detects unavailable events.)
  const unknownId = 'ZZZ-momento-does-not-exist';
  const batchIds = [...events.map((e) => e.id), unknownId];
  const batch = await call('/events.json', { id: batchIds.join(','), size: '50', locale: '*' });
  await save('search-multi-id-with-unknown.json', batch);
  const batchReturned = eventsOf(batch).map((e) => e.id);

  // ---- Findings summary ----
  const fieldPresence = (field: string) => events.filter((e) => e[field] != null).length;
  const multiIds = eventsOf(multi).map((e) => e.id);
  const segments = new Map<string, string>();
  for (const c of ((classifications.body as { _embedded?: { classifications?: unknown[] } })?._embedded
    ?.classifications ?? []) as { segment?: { id: string; name: string } }[]) {
    if (c.segment) segments.set(c.segment.id, c.segment.name);
  }
  const page = (search.body as { page?: unknown }).page;

  console.log('\n=== Findings ===');
  console.log('Search page info:', JSON.stringify(page));
  console.log(`Unknown ID -> HTTP ${unknown.status}`, JSON.stringify(unknown.body).slice(0, 200));
  console.log(
    `Multi-id (requested 2) -> HTTP ${multi.status}, returned ${multiIds.length}:`,
    multiIds.join(', '),
  );
  console.log(`Field presence across ${events.length} search results:`);
  for (const f of ['info', 'pleaseNote', 'description', 'priceRanges', 'images', 'classifications', 'dates'])
    console.log(`  ${f}: ${fieldPresence(f)}/${events.length}`);
  console.log('Details response keys:', Object.keys(details.body as object).join(', '));
  console.log('Segments found:');
  for (const [id, name] of segments) console.log(`  ${name}: ${id}`);
  console.log(`Keyword+segment search -> HTTP ${filtered.status}, ${eventsOf(filtered).length} events`);
  console.log(
    `Batch of ${batchIds.length} IDs (1 unknown) -> HTTP ${batch.status}, returned ${batchReturned.length};`,
    `all real returned: ${events.every((e) => batchReturned.includes(e.id))};`,
    `unknown returned: ${batchReturned.includes(unknownId)}`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? redact(err.message) : err);
  process.exit(1);
});
